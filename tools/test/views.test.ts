// Часть 3б: виды для панелей (docs/specs/2026-10-panels.md, 3б). Склад — партии с тарой на заводе: фильтр, сортировка,
// страницы; карточка партии — история из отметок движка; стол видов шлёт вид, только когда данные изменились, и не чаще
// 10 раз в секунду, кроме нового запроса и команды; виды не читают истины: два завода, у которых различаются только
// истинные поля, дают одинаковые виды; поток расчёта прикладывает виды к срезу.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { partType, wearAt } from '../../src/engine/maint';
import { planOf } from '../../src/engine/plant';
import type { LotStatus, PlantState } from '../../src/engine/types';
import { createSim } from '../../src/sim/host';
import { cardView, type Hist, PAGE, type StockQuery, type StockSort, stockView, type Thing, VIEW_EVERY, type ViewQuery, ViewDesk } from '../../src/sim/views';

const SC = 'scn.proto';
const plan = planOf(db, db.scenarios[SC].plant);
const stock = (o: Partial<StockQuery> = {}): StockQuery => ({ view: 'stock', status: [], kinds: [], sort: 'code', desc: false, page: 0, lang: 'ru', ...o });

/** Завод после трёх недель: партии поставщиков пришли и решены, серии идут, ГП отгружается. */
const s: PlantState = newPlant(db, { scenario: SC });
apply(db, s, { kind: 'advance', seconds: 21 * DAY });

/** Партии с тарой на заводе — прямо по учёту. */
function onFloor(st: PlantState) {
  const lots = new Map<string, number>();
  for (const c of Object.values(st.containers)) lots.set(c.lot, (lots.get(c.lot) ?? 0) + c.qty);
  return lots;
}

describe('склад', () => {
  test('строки — партии с тарой на заводе: остаток — по таре, места — паллеты партии, первая — меньший номер', () => {
    const v = stockView(db, s, stock({ page: 0 }));
    const floor = onFloor(s);
    expect(v.total).toBe(floor.size);
    expect(v.total).toBeGreaterThan(10);
    for (const r of v.rows) {
      expect(r.left).toBe(floor.get(r.lot)!);
      expect(r.places.length + r.more).toBeGreaterThan(0);
      expect(r.places.length).toBeLessThanOrEqual(3);
      const u = s.units[`U${r.unit}`];
      expect(u.items.some(id => s.containers[id].lot === r.lot)).toBe(true);
    }
  });

  test('фильтр по статусу и виду материала; сортировка по каждому столбцу в обе стороны; страницы по 50', () => {
    const all = stockView(db, s, stock()).total;
    const released = stockView(db, s, stock({ status: ['released'] }));
    expect(released.rows.every(r => r.status === 'released')).toBe(true);
    expect(released.total).toBe([...onFloor(s).keys()].filter(id => s.lots[id].status === 'released').length);
    const pk = stockView(db, s, stock({ kinds: ['packaging'] }));
    expect(pk.rows.every(r => db.materials[r.material].kind === 'packaging')).toBe(true);
    for (const sort of ['code', 'material', 'supplier', 'status', 'left', 'expiry'] as StockSort[]) {
      const up = stockView(db, s, stock({ sort })).rows;
      const down = stockView(db, s, stock({ sort, desc: true })).rows;
      expect(up.length).toBe(Math.min(PAGE, all));
      // остаток — по возрастанию, срок — по убыванию
      if (sort === 'left') for (let i = 1; i < up.length; i++) expect(up[i].left).toBeGreaterThanOrEqual(up[i - 1].left);
      if (sort === 'expiry') for (let i = 1; i < down.length; i++) expect(down[i].expiry).toBeLessThanOrEqual(down[i - 1].expiry);
    }
    // страницы: всё вместе — все строки, без повторов
    const st: PlantState = structuredClone(s);
    const seen = new Set<string>();
    const pages = stockView(db, st, stock()).pages;
    for (let p = 0; p < pages; p++) for (const r of stockView(db, st, stock({ page: p })).rows) seen.add(r.lot);
    expect(seen.size).toBe(all);
    expect(stockView(db, st, stock({ page: 99 })).page).toBe(pages - 1);
  });
});

describe('карточка', () => {
  test('партия поставщика: приход, пробы, испытания с результатами, решение — по времени, как в учёте', () => {
    const onUnit = (id: string) => Object.values(s.units).find(x => x.items.some(c => s.containers[c].lot === id));
    const lot = Object.values(s.lots).find(l => !l.batch && l.supplier !== 'start' && l.status === 'released' && l.sample && onUnit(l.id))!;
    expect(lot).toBeDefined();
    const u = onUnit(lot.id)!;
    const c = cardView(db, s, { kind: 'unit', n: Number(u.id.slice(1)) }).card;
    if (c.kind !== 'unit') throw new Error(c.kind);
    expect(c.lot?.code).toEqual([lot.code.y, lot.code.m, lot.code.n]);
    const h = c.history;
    expect(h[0]).toEqual({ k: 'arrived', t: lot.received, ...(lot.po ? { po: lot.po } : {}) });
    const sm = s.samples[lot.sample!];
    expect(h.find(x => x.k === 'sampled')).toEqual({ k: 'sampled', t: sm.taken!, containers: sm.plan.length });
    const tests = h.filter((x): x is Extract<Hist, { k: 'test' }> => x.k === 'test');
    expect(tests.length).toBe(sm.tests.length);
    for (const t of tests) {
      const q = sm.tests.map(id => s.tests[id]).find(x => x.method === t.method && x.done === t.t)!;
      expect([t.result, t.pass]).toEqual([q.result!, !!q.pass]);
    }
    expect(h.find(x => x.k === 'decided')).toEqual({ k: 'decided', t: lot.since, status: 'released' });
    const times = h.map(x => x.t ?? Number.MAX_SAFE_INTEGER);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(c.why).toContainEqual({ k: 'decided', status: 'released', t: lot.since });
  });

  test('запас на старте: без прихода фурой и решения; резерв заданий на серию — одной строкой, выдача — с номером серии', () => {
    const s0 = newPlant(db, { scenario: SC });
    apply(db, s0, { kind: 'advance', seconds: 3600 });
    const before = (b: (typeof s0.batches)[string]) => b.status === 'waiting' || b.status === 'reserved';
    const qtyOf = (b: (typeof s0.batches)[string], lot: string) => b.kit.filter(k => k.lot === lot).reduce((n, k) => n + k.qty, 0);
    const onUnit = (id: string) => Object.values(s0.units).find(x => x.items.some(c => s0.containers[c].lot === id));
    const lot = Object.values(s0.lots).find(l => l.supplier === 'start' && onUnit(l.id) && Object.values(s0.batches).some(b => before(b) && qtyOf(b, l.id) > 0))!;
    expect(lot).toBeDefined();
    const c = cardView(db, s0, { kind: 'unit', n: Number(onUnit(lot.id)!.id.slice(1)) }).card;
    if (c.kind !== 'unit') throw new Error(c.kind);
    expect(c.history[0]).toEqual({ k: 'start', t: lot.received });
    expect(c.history.some(h => h.k === 'arrived' || h.k === 'decided')).toBe(false);
    expect(c.why).toContainEqual({ k: 'start' });
    expect(c.why.some(w => w.k === 'decided')).toBe(false);
    const waiting = Object.values(s0.batches).filter(b => before(b) && qtyOf(b, lot.id) > 0);
    expect(c.history.filter(h => h.k === 'reserved')).toEqual([{ k: 'reserved', orders: waiting.length, qty: waiting.reduce((n, b) => n + qtyOf(b, lot.id), 0) }]);
    // выдачи — только сериям, которые пошли дальше резерва
    const kits = c.history.filter(h => h.k === 'kit');
    expect(kits.length).toBe(Object.values(s0.batches).filter(b => !before(b) && qtyOf(b, lot.id) > 0).length);
  });

  test('помещение, оборудование, машина, человек, техника; ушедшая вещь — «нет на заводе»', () => {
    const r = cardView(db, s, { kind: 'room', i: plan.plant.rooms.findIndex(x => x.type === 'compression') }).card;
    expect(r.kind).toBe('room');
    const e = cardView(db, s, { kind: 'equipment', i: plan.plant.equipment.findIndex(x => x.id === 'press-1') }).card;
    if (e.kind !== 'equipment') throw new Error(e.kind);
    expect(e.parts.map(p => p.type)).toContain('punches');
    // износ — как в журнале оборудования: наработка к ресурсу узла
    const punches = Object.values(s.parts).find(x => x.machine === 'press-1' && x.type === 'punches')!;
    expect(punches.done).toBeGreaterThan(0);
    expect(e.parts.find(p => p.type === 'punches')!.wear).toBe(wearAt(partType(db, punches), punches.done));
    // журнал актива (Б3в): отказы, ремонты и замены — и записи квалификации
    expect(e.history.filter(h => h.k === 'maint').length).toBe(s.maintLog.filter(x => x.machine === 'press-1').length);
    expect(e.history.filter(h => h.k === 'rec').length).toBe(s.assets['press-1'].recs.length);
    expect(e.asset?.inv).toBe(s.assets['press-1'].inv);
    const m = cardView(db, s, { kind: 'machine', line: 0, k: 0 }).card;
    expect(m.kind).toBe('machine');
    const p = cardView(db, s, { kind: 'person', n: 1 }).card;
    expect(p.kind).toBe('person');
    const v = cardView(db, s, { kind: 'vehicle', n: 1 }).card;
    expect(v.kind).toBe('vehicle');
    expect(cardView(db, s, { kind: 'unit', n: 999_999 }).card).toEqual({ kind: 'gone' });
  });
});

describe('стол видов', () => {
  test('вид уходит, когда изменился; версия — на единицу больше; без нового запроса — не чаще 10 раз в секунду', () => {
    const st: PlantState = structuredClone(s);
    const desk = new ViewDesk(db);
    const q: ViewQuery = { id: 'stock', ...stock() };
    desk.set([q]);
    const first = desk.out(st, 0)!;
    expect(first.map(x => [x.id, x.v])).toEqual([['stock', 1]]);
    // ничего не изменилось — ничего не уходит, даже после паузы
    expect(desk.out(st, 1000)).toBeUndefined();
    // время идёт, а сборка — не раньше `VIEW_EVERY`
    apply(db, st, { kind: 'advance', seconds: 2 * DAY });
    expect(desk.out(st, 1000 + VIEW_EVERY / 2)).toBeUndefined();
    const second = desk.out(st, 1000 + VIEW_EVERY)!;
    expect(second?.[0].v).toBe(2);
    // новый запрос — сразу, даже без хода времени
    desk.set([q, { id: 'card', view: 'card', thing: { kind: 'person', n: 1 } }]);
    const third = desk.out(st, 1000 + VIEW_EVERY + 1)!;
    expect(third.map(x => [x.id, x.v])).toEqual([['card', 1]]);
    // закрытый вид забыт: открыт снова — придёт заново
    desk.set([q]);
    desk.set([q, { id: 'card', view: 'card', thing: { kind: 'person', n: 1 } }]);
    expect(desk.out(st, 99_999)!.map(x => [x.id, x.v])).toEqual([['card', 1]]);
  });

  test('поток расчёта прикладывает виды к срезу: на запрос — сразу, дальше — когда изменились', () => {
    const sim = createSim(db);
    sim.handle({ kind: 'start', scenario: SC });
    const a = sim.handle({ kind: 'views', views: [{ id: 'stock', ...stock() }] });
    if (a.kind !== 'slice') throw new Error(a.kind);
    expect(a.views?.map(x => x.id)).toEqual(['stock']);
    expect(a.tick).toBeUndefined();
    const b = sim.handle({ kind: 'tick', seconds: 0, budgetMs: 50 });
    if (b.kind !== 'slice') throw new Error(b.kind);
    expect(b.views).toBeUndefined();
    expect(b.tick).toBe(true);
  });
});

describe('без истины', () => {
  test('два завода с разными истинными свойствами партий и серий, причинами и запасом узлов — одни и те же виды', () => {
    const a: PlantState = structuredClone(s);
    const b: PlantState = structuredClone(s);
    for (const lot of Object.values(b.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
    for (const bt of Object.values(b.batches)) {
      for (const k of Object.keys(bt.truth) as (keyof typeof bt.truth)[]) bt.truth[k] = (bt.truth[k] ?? 0) + 777;
      bt.causes = [];
    }
    for (const p of Object.values(b.parts)) p.budget += 12345;
    const things: Thing[] = [
      ...Object.keys(a.units).map(id => ({ kind: 'unit', n: Number(id.slice(1)) }) as Thing),
      ...plan.plant.rooms.map((_, i) => ({ kind: 'room', i }) as Thing),
      ...plan.plant.equipment.map((_, i) => ({ kind: 'equipment', i }) as Thing),
      ...plan.plant.lines.flatMap((ln, line) => ln.machines.map((_, k) => ({ kind: 'machine', line, k }) as Thing)),
      ...Object.keys(a.people).map(id => ({ kind: 'person', n: Number(id.slice(1)) }) as Thing),
      ...Object.keys(a.vehicles).map(id => ({ kind: 'vehicle', n: Number(id.slice(1)) }) as Thing),
    ];
    for (const t of things) expect(JSON.stringify(cardView(db, b, t))).toBe(JSON.stringify(cardView(db, a, t)));
    for (const status of [[], ['released'], ['quarantine', 'testing']] as LotStatus[][]) {
      expect(JSON.stringify(stockView(db, b, stock({ status })))).toBe(JSON.stringify(stockView(db, a, stock({ status }))));
    }
  });
});
