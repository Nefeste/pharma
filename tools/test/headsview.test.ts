// Б5б: предложения руководителей в видах (docs/specs/2026-10-vertical-slice.md, «Проверки Б5б», «Виды» и «Окно»): журнал —
// «Ждут вашего решения» сверху и полоса режимов взятых постов; планёрка — «Предложения»; карточка — «Кто решил» с ответом,
// без устаревших и ненужных; окно «Заказ поставщику» (src/sim/po.ts) — «Предложить» те же строки, что снабжение в тот же
// час, отказ причиной и материалом строки; узлы машины — порог, запчасть, почему заменить нельзя; без истины.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR, isWorkday, MIN, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { MODED } from '../../src/engine/heads';
import { BATCH_HOUR } from '../../src/engine/mes';
import { pairKey } from '../../src/engine/partners';
import { planOf } from '../../src/engine/plant';
import { ORDER_KEY } from '../../src/engine/planner';
import type { Notice, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { journalView } from '../../src/sim/journal';
import { poView } from '../../src/sim/po';
import { morningView } from '../../src/sim/report';
import { cardView, type PartInfo } from '../../src/sim/views';

const SC = 'scn.proto';
const plan = planOf(db, db.scenarios[SC].plant);
const fresh = (): PlantState => newPlant(db, { scenario: SC });
const refusals = (n: Notice[]) => n.flatMap(x => (x.kind === 'refused' ? [[x.why, x.detail]] : []));
const open = (s: PlantState) => s.journal.filter(r => r.ask && !r.ask.end);
const until = (s: PlantState, t: number) => apply(db, s, { kind: 'advance', seconds: t - s.t });
/** Ближайшее мгновение `sec` рабочего дня после нынешнего. */
function nextWork(s: PlantState, sec: number): number {
  const cal = calOf(db, s);
  let t = Math.floor(s.t / DAY) * DAY + sec;
  if (t <= s.t) t += DAY;
  while (!isWorkday(cal, momentOf(s.start, t).day)) t += DAY;
  return t;
}
const today = (s: PlantState) => momentOf(s.start, s.t).day;
const press = plan.plant.equipment.findIndex(e => e.id === 'press-1');
const parts = (s: PlantState): PartInfo[] => {
  const c = cardView(db, s, { kind: 'equipment', i: press }).card;
  return c.kind === 'equipment' ? c.parts : [];
};

describe('журнал и планёрка', () => {
  test('пост «Производство»: задание на серию в 07:00 — сверху журнала и в «Предложениях» планёрки, с причиной; ответить может игрок', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    const at = nextWork(s, BATCH_HOUR);
    until(s, at + 2 * HOUR);
    const r = open(s).find(x => x.ask!.key === ORDER_KEY)!;
    const v = journalView(db, s, { view: 'journal', page: 0 });
    expect(v.asks.map(x => x.n)).toEqual(open(s).map(x => x.n).sort((a, b) => b - a));
    const row = v.asks.find(x => x.n === r.n)!;
    expect(row).toMatchObject({ by: 'plan', post: 'production', t: at, d: { kind: 'order' }, ask: { can: true } });
    expect(row.d.kind === 'order' && row.d.why?.rule).toBeTruthy();
    // номера задания у предложения ещё нет; в общем списке — та же строка
    expect(row.ref).toEqual({});
    expect(v.rows.find(x => x.n === r.n)).toEqual(row);
    // полоса режимов — отделы взятого поста: планирование, начальник производства, техслужба — «советует»
    expect(v.modes).toEqual([
      { head: 'plan', seat: 'production', mode: 'advise' },
      { head: 'mes', seat: 'production', mode: 'advise' },
      { head: 'maint', seat: 'production', mode: 'advise' },
    ]);
    const m = morningView(db, s, { view: 'morning', day: today(s) });
    expect(m.asks.map(x => x.n)).toContain(r.n);
    // «Принять» — запись с номером задания и «принято вами»; из «Ждут вашего решения» и «Предложений» ушло
    expect(refusals(apply(db, s, { kind: 'accept', n: r.n }))).toEqual([]);
    const w = journalView(db, s, { view: 'journal', page: 0 });
    expect(w.asks.some(x => x.n === r.n)).toBe(false);
    const done = w.rows.find(x => x.n === r.n)!;
    expect(done.ask).toEqual({ end: { how: 'ok', t: s.t, seat: 'production' } });
    expect(done.ref.bn).toBeDefined();
    expect(morningView(db, s, { view: 'morning', day: today(s) }).asks.some(x => x.n === r.n)).toBe(false);
  });

  test('мест нет — полосы режимов нет; директор — все отделы с выбором, по умолчанию «сам»', () => {
    const s = fresh();
    expect(journalView(db, s, { view: 'journal', page: 0 }).modes).toEqual([]);
    apply(db, s, { kind: 'seat', seats: ['director'] });
    const v = journalView(db, s, { view: 'journal', page: 0 });
    expect(v.modes.map(x => x.head)).toEqual([...MODED]);
    expect(v.modes.every(x => x.mode === 'auto')).toBe(true);
    apply(db, s, { kind: 'mode', head: 'wms', mode: 'manual' });
    expect(journalView(db, s, { view: 'journal', page: 0 }).modes.find(x => x.head === 'wms')!.mode).toBe('manual');
    // смена режима — запись журнала «вы»
    expect(s.journal.at(-1)).toMatchObject({ by: 'player', seat: 'director', d: { kind: 'mode', head: 'wms', mode: 'manual' } });
  });
});

describe('карточка: «Кто решил»', () => {
  test('замена узла: предложение техслужбы с ответом в карточке пресса; «не нужно» и «устарело» — не строки', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    s.parts['press-1/punches'].done *= 1000;
    until(s, Math.floor(s.t / HOUR) * HOUR + HOUR + MIN);
    const r = open(s).find(x => x.ask!.key === 'replace/press-1/punches')!;
    const card = () => {
      const c = cardView(db, s, { kind: 'equipment', i: press }).card;
      return c.kind === 'equipment' ? (c.who ?? []) : [];
    };
    expect(card().find(x => x.n === r.n)).toMatchObject({ kind: 'replace', by: 'maint', ask: { can: true } });
    // игрок заменяет сам — предложение «не нужно»: в «Кто решил» — только решение игрока
    expect(refusals(apply(db, s, { kind: 'maintain', machine: 'press-1', part: 'punches' }))).toEqual([]);
    expect(r.ask!.end?.how).toBe('moot');
    const rows = card();
    expect(rows.some(x => x.n === r.n)).toBe(false);
    expect(rows.at(-1)).toMatchObject({ kind: 'replace', by: 'player', seat: 'production' });
  });
});

describe('окно «Заказ поставщику»', () => {
  // пост «Снабжение и склад» сценарий прототипа не даёт: снабжение «советует» по выбору директора
  const s = fresh();
  apply(db, s, { kind: 'seat', seats: ['director'] });
  apply(db, s, { kind: 'mode', head: 'supply', mode: 'advise' });
  // ровно 09:00 — мгновение предложений: окно считает то же правило в то же мгновение
  until(s, nextWork(s, 9 * HOUR));
  const asked = open(s).filter(r => r.by === 'supply');

  test('поставщики — с одобренной парой; у материала — наименьшая партия, тара и цена', () => {
    const v = poView(db, s, { view: 'po', lines: [] });
    expect(v.suppliers.length).toBeGreaterThan(0);
    for (const sup of v.suppliers) {
      expect(sup.items.some(i => i.ok)).toBe(true);
      expect(sup.lead).toEqual(db.suppliers[sup.id].lead);
      for (const i of sup.items) {
        expect(i.moq).toBe(db.suppliers[sup.id].items[i.material].moq);
        expect(i.cap).toBe(db.containers[db.materials[i.material].container].capacity);
        expect(i.list).toBeGreaterThan(0);
      }
    }
    // поставщик не указан — первый; ответа без строк нет
    expect(v.supplier).toBe(v.suppliers[0].id);
    expect(v.answer).toBeUndefined();
  });

  test('«Предложить» — те же строки, что предложение снабжения в тот же час; ответ — те же строки до целой тары и предоплата', () => {
    expect(asked.length).toBeGreaterThan(0);
    const v = poView(db, s, { view: 'po', lines: [] });
    for (const r of asked) {
      if (r.d.kind !== 'po' || r.ask!.cmd.kind !== 'po') throw new Error('не заказ');
      const cmd = r.ask!.cmd;
      const p = v.plan.find(x => x.supplier === cmd.supplier)!;
      expect(p.lines).toEqual(cmd.lines.map(l => ({ material: l.material, qty: l.qty })));
      const a = poView(db, s, { view: 'po', supplier: cmd.supplier, lines: p.lines }).answer!;
      if ('why' in a) throw new Error(a.why);
      const ref = journalView(db, s, { view: 'journal', page: 0 }).asks.find(x => x.n === r.n)!.ref;
      expect(a.lines.map(l => ({ material: l.material, qty: l.qty }))).toEqual(ref.po!.lines);
      expect(a.prepaid).toBe(r.d.prepaid);
      expect(a.net + a.vat).toBeGreaterThan(a.prepaid);
    }
  });

  test('отказ — причиной и материалом строки, как у команды `po`: меньше наименьшей партии, не продаёт, нет одобренной пары', () => {
    const v = poView(db, s, { view: 'po', lines: [] });
    const sup = v.suppliers[0];
    const item = sup.items.find(i => i.ok)!;
    const ask = (lines: { material: string; qty: number }[], x: PlantState = s) => poView(db, x, { view: 'po', supplier: sup.id, lines }).answer;
    expect(ask([{ material: item.material, qty: item.moq - 1 }])).toEqual({ why: 'belowMoq', detail: item.material });
    expect(refusals(apply(db, structuredClone(s), { kind: 'po', supplier: sup.id, lines: [{ material: item.material, qty: item.moq - 1 }] }))).toEqual([['belowMoq', item.material]]);
    const other = Object.keys(db.materials).find(m => !db.suppliers[sup.id].items[m])!;
    expect(ask([{ material: other, qty: 1 }])).toEqual({ why: 'notSold', detail: other });
    // пара не одобрена — материал у поставщика «не одобрен», заказ — отказ
    const c = structuredClone(s);
    delete c.pairs[pairKey(sup.id, item.maker)];
    expect(ask([{ material: item.material, qty: item.moq }], c)).toEqual({ why: 'pair', detail: item.material });
    const at = poView(db, c, { view: 'po', lines: [] }).suppliers.find(x => x.id === sup.id);
    expect(at?.items.find(i => i.material === item.material)?.ok ?? false).toBe(false);
  });

  test('без истины: два завода с разными истинными свойствами партий и серий и запасом узлов — один и тот же вид', () => {
    const b: PlantState = structuredClone(s);
    for (const lot of Object.values(b.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
    for (const bt of Object.values(b.batches)) for (const k of Object.keys(bt.truth) as (keyof typeof bt.truth)[]) bt.truth[k] = (bt.truth[k] ?? 0) + 777;
    for (const p of Object.values(b.parts)) p.budget += 12345;
    const sup = asked[0].ask!.cmd.kind === 'po' ? asked[0].ask!.cmd : undefined;
    for (const q of [{ view: 'po' as const, lines: [] }, { view: 'po' as const, supplier: sup!.supplier, lines: sup!.lines }]) expect(poView(db, b, q)).toEqual(poView(db, s, q));
    expect(journalView(db, b, { view: 'journal', page: 0 })).toEqual(journalView(db, s, { view: 'journal', page: 0 }));
    expect(morningView(db, b, { view: 'morning', day: today(s) })).toEqual(morningView(db, s, { view: 'morning', day: today(s) }));
  });
});

describe('узлы машины: «Заменить»', () => {
  test('порог по наработке, запчасти, время замены; решено — «занят»; запчасти нет — «нет запчасти»; запаса до отказа нет', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    apply(db, s, { kind: 'mode', head: 'maint', mode: 'manual' });
    const p = parts(s).find(x => x.type === 'punches')!;
    const pt = s.parts['press-1/punches'];
    const ty = db.equipment[pt.of].parts!.find(x => x.id === 'punches')!;
    expect(p).toMatchObject({ failed: false, repair: false, work: ty.replace });
    expect(p.at).toBe(db.scenarios[SC].maint[pt.id]);
    expect(p.no).toBeUndefined();
    expect(p.spare).toBeGreaterThan(0);
    // запаса до отказа — истины — в виде нет
    expect(JSON.stringify(parts(s))).not.toContain(String(pt.budget));
    expect(Object.keys(p).sort()).toEqual(['at', 'failed', 'repair', 'spare', 'type', 'wear', 'work'].filter(k => k in p).sort());
    // «Заменить» — решено: «занят»; второй раз — отказ той же причиной
    expect(refusals(apply(db, s, { kind: 'maintain', machine: 'press-1', part: 'punches' }))).toEqual([]);
    expect(parts(s).find(x => x.type === 'punches')).toMatchObject({ plan: true, no: 'busy' });
    expect(refusals(apply(db, s, { kind: 'maintain', machine: 'press-1', part: 'punches' })).map(x => x[0])).toEqual(['busy']);
    // запчастей в мастерской нет — «нет запчасти»
    const c = fresh();
    c.spares[ty.spare].qty = c.spares[ty.spare].reserved;
    expect(parts(c).find(x => x.type === 'punches')!.no).toBe('noSpare');
  });
});
