// Б6е: правки плана и замороженный горизонт (src/engine/planner.ts, src/engine/commerce.ts, src/engine/plan/price.ts;
// docs/specs/2026-10-vertical-slice.md, «Б6е»; геймдизайн, §9.2, §9.3). Правило ставит задание на край горизонта
// политики; события коммерции — от зерна, от одного до четырёх в месяц; крупный заказ — заказ покупателя; снятый спрос
// уменьшает ближайшие заказы; коллеги в горизонте не правят; цена правки на примере; команды игрока в горизонте — запись
// журнала с ценой; показатель; виды расписания и планёрки без истины; образец схемы 43; сборщик базы.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import { cutOrder, EVENT_HOUR } from '../../src/engine/commerce';
import { addWorkdays, DAY, daysFromCivil, HOUR, isWorkday, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { monthAt } from '../../src/engine/forecast';
import { check } from '../../src/engine/invariants';
import { kpiPick, sincePeriod } from '../../src/engine/kpi';
import { BATCH_HOUR } from '../../src/engine/mes';
import { editInFrozen, editPrice, frozenEdge, inFrozen, priceDays } from '../../src/engine/plan/price';
import { forecast } from '../../src/engine/plan/schedule';
import { AHEAD_WORK, casesOf, frozenDays, frozenOf } from '../../src/engine/planner';
import { POL } from '../../src/engine/policies';
import { fromSave } from '../../src/engine/save';
import { type Notice, type PlantState, SCHEMA } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { ganttView } from '../../src/sim/plan';
import { morningView } from '../../src/sim/report';
import { buildDb } from '../content/load';
import { legacy } from './legacy';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const start = daysFromCivil(sc.start.date);
const today = (s: PlantState) => momentOf(s.start, s.t).day;
const dayOf = (s: PlantState, t: number) => momentOf(s.start, t).day;
/** Секунды завода до 00:00 дня `day`. */
const tOf = (day: number) => (day - start) * DAY;

/** Прожить `days` суток часами и собрать извещения. */
function live(s: PlantState, days: number): Notice[] {
  const out: Notice[] = [];
  for (let h = 0; h < days * 24; h++) out.push(...apply(db, s, { kind: 'advance', seconds: HOUR }));
  return out;
}

/** Ближайшее задание, которое ещё не комплектуют, — на запас позиции. */
const nextOpen = (s: PlantState) =>
  Object.values(s.batches)
    .filter(b => (b.status === 'waiting' || b.status === 'reserved') && b.for?.kind !== 'order')
    .sort((a, b) => a.notBefore - b.notBefore)[0];

describe('замороженный горизонт', () => {
  test('правило ставит задание на край горизонта политики — 5, 10 и 15 рабочих дней; спрос — на горизонт в сутках', () => {
    expect(sc.plan!.frozen).toBe(AHEAD_WORK);
    expect([frozenDays(5), frozenDays(10), frozenDays(15)]).toEqual([7, 14, 21]);
    for (const F of [5, 10, 15]) {
      const s = newPlant(db, { scenario: SC });
      if (F !== sc.plan!.frozen) expect(apply(db, s, { kind: 'policy', policy: POL.frozen, value: F }).some(n => n.kind === 'refused')).toBe(false);
      expect(frozenOf(db, s)).toBe(F);
      const t0 = s.t;
      live(s, 21);
      const mine = Object.values(s.batches).filter(b => b.by === 'head:plan' && b.ordered >= t0);
      expect(mine.length).toBeGreaterThan(5);
      for (const b of mine) expect(dayOf(s, b.notBefore)).toBe(addWorkdays(calOf(db, s), dayOf(s, b.ordered), F));
      // причина — запас на горизонт в сутках и запас позиций сверх него
      const rec = s.journal.filter(r => r.by === 'plan' && r.d.kind === 'order' && r.d.why && r.d.why.rule !== 'turn');
      for (const r of rec) if (r.d.kind === 'order') expect(r.d.why!.ahead).toBe(Math.floor(((frozenDays(F) + r.d.why!.cover!) * 5000) / 7));
      expect(check(db, s)).toEqual([]);
    }
  });

  test('край горизонта — рабочий день через горизонт; «не раньше» до его дня — в горизонте', () => {
    const s = newPlant(db, { scenario: SC });
    live(s, 3);
    const edge = frozenEdge(db, s);
    expect(edge).toBe(addWorkdays(calOf(db, s), today(s), 10));
    expect(inFrozen(db, s, tOf(edge) - 1)).toBe(true);
    expect(inFrozen(db, s, tOf(edge) + BATCH_HOUR)).toBe(false);
    const b = nextOpen(s)!;
    expect(editInFrozen(db, s, { drop: [b.id] })).toBe(inFrozen(db, s, b.notBefore));
    // сдвиг в горизонте — если в нём прежний или новый «не раньше»
    expect(editInFrozen(db, s, { changes: [{ batch: b.id, notBefore: tOf(edge + 30) }] })).toBe(inFrozen(db, s, b.notBefore));
    expect(editInFrozen(db, s, { fresh: [{ recipe: sc.plan!.items[0].recipe, sku: sc.plan!.items[0].sku, notBefore: tOf(edge) + BATCH_HOUR }] })).toBe(false);
    expect(editInFrozen(db, s, { fresh: [{ recipe: sc.plan!.items[0].recipe, sku: sc.plan!.items[0].sku }] })).toBe(true);
  });
});

/** События коммерции за `days` суток — с мгновением: журнал хранит записи 90 суток, извещения — нет. */
function eventsOf(s: PlantState, days: number): { t: number; n: Extract<Notice, { kind: 'bigOrder' | 'demandCut' }> }[] {
  const out: { t: number; n: Extract<Notice, { kind: 'bigOrder' | 'demandCut' }> }[] = [];
  for (let h = 0; h < days * 24; h++) for (const n of apply(db, s, { kind: 'advance', seconds: HOUR })) if (n.kind === 'bigOrder' || n.kind === 'demandCut') out.push({ t: s.t, n });
  return out;
}

describe('события коммерции', () => {
  const s = newPlant(db, { scenario: SC });
  const evs = eventsOf(s, 183);
  const events = evs.map(e => e.n);
  const recs = s.journal.filter(r => r.d.kind === 'bigOrder' || r.d.kind === 'demandCut');

  test('от одного до четырёх в месяц, в 12:00 рабочего дня, — запись начальника отдела продаж; от зерна — те же', () => {
    const c = sc.commerce!;
    expect(c.perMonth).toEqual([1, 4]);
    const byMonth = new Map<number, number>();
    for (const e of evs) byMonth.set(monthAt(s, e.t), (byMonth.get(monthAt(s, e.t)) ?? 0) + 1);
    // полные месяцы — с первого дня по последний
    const first = monthAt(s, 0);
    for (let m = first; m < monthAt(s, s.t); m++) {
      const n = byMonth.get(m) ?? 0;
      expect(n).toBeGreaterThanOrEqual(c.perMonth[0]);
      expect(n).toBeLessThanOrEqual(c.perMonth[1]);
    }
    // запись — у каждого события в сроке журнала, в 12:00 рабочего дня
    for (const e of evs) {
      expect(e.t % DAY).toBe(EVENT_HOUR);
      expect(isWorkday(calOf(db, s), dayOf(s, e.t))).toBe(true);
    }
    const kept = evs.filter(e => e.t >= recs[0].t);
    expect(recs.map(r => [r.t, r.by, r.d])).toEqual(kept.map(e => [e.t, 'sales', { ...e.n }]));
    // те же события у того же зерна
    const again = newPlant(db, { scenario: SC });
    expect(eventsOf(again, 183)).toEqual(evs);
    expect(new Set(events.map(e => e.kind))).toEqual(new Set(['bigOrder', 'demandCut']));
  }, 60_000);

  test('крупный заказ — заказ покупателя: ящики — серия позиции ±20 %, срок через 14–42 суток, в рабочий день', () => {
    const big = events.filter((n): n is Extract<Notice, { kind: 'bigOrder' }> => n.kind === 'bigOrder');
    expect(big.length).toBeGreaterThan(0);
    for (const e of big) {
      const o = s.orders[e.order];
      expect(o.big).toBe(true);
      expect(o.customer).toBe(e.customer);
      expect(o.lines).toEqual([expect.objectContaining({ sku: e.sku, cases: e.cases })]);
      const it = sc.plan!.items.find(x => x.sku === e.sku)!;
      const per = casesOf(db.recipes[it.recipe], db.skus[e.sku]);
      expect(e.cases).toBeGreaterThanOrEqual(Math.floor((per * 80) / 100));
      expect(e.cases).toBeLessThanOrEqual(Math.floor((per * 120) / 100));
      const lead = dayOf(s, o.due) - dayOf(s, o.placed);
      expect(lead).toBeGreaterThanOrEqual(14);
      expect(lead).toBeLessThanOrEqual(42 + 3);
      expect(isWorkday(calOf(db, s), dayOf(s, o.due))).toBe(true);
      expect(o.due % DAY).toBe(15 * HOUR);
    }
    // отгружены, как все заказы: в срок, позже или не полностью — но не потеряны
    expect(big.filter(e => s.orders[e.order].status !== 'open').length).toBeGreaterThan(0);
  });

  test('снятый спрос: рынок вычитает его из ближайших заказов позиции покупателя', () => {
    const c = newPlant(db, { scenario: SC });
    c.planning.commerce = { month: monthAt(c, c.t), days: [], cut: { 'cus.national': { 'sku.paracetamol500.n20': 30 } } };
    expect(cutOrder(c, 'cus.national', 'sku.paracetamol500.n20', 12)).toBe(0);
    expect(c.planning.commerce.cut['cus.national']['sku.paracetamol500.n20']).toBe(18);
    expect(cutOrder(c, 'cus.national', 'sku.paracetamol500.n20', 25)).toBe(7);
    expect(c.planning.commerce.cut['cus.national']['sku.paracetamol500.n20']).toBeUndefined();
    expect(cutOrder(c, 'cus.regional', 'sku.paracetamol500.n20', 25)).toBe(25);
    // в заказе: снято всё — строки позиции нет, у другого покупателя — есть
    const d = newPlant(db, { scenario: SC });
    d.planning.commerce = { month: monthAt(d, d.t), days: [], cut: { 'cus.national': { 'sku.paracetamol500.n20': 1_000_000 } } };
    live(d, 7);
    const lines = Object.values(d.orders).filter(o => !o.big).flatMap(o => o.lines.map(l => ({ customer: o.customer, sku: l.sku })));
    expect(lines.some(l => l.customer === 'cus.national' && l.sku === 'sku.paracetamol500.n20')).toBe(false);
    expect(lines.some(l => l.customer === 'cus.regional' && l.sku === 'sku.paracetamol500.n20')).toBe(true);
  });

  test('коллеги в горизонте не правят: задания коллеги — на краю, записей с ценой правки нет', () => {
    for (const b of Object.values(s.batches).filter(x => x.by === 'head:plan')) expect(dayOf(s, b.notBefore)).toBe(addWorkdays(calOf(db, s), dayOf(s, b.ordered), 10));
    expect(s.journal.some(r => (r.d.kind === 'order' || r.d.kind === 'cancel' || r.d.kind === 'shift') && r.d.frozen !== undefined)).toBe(false);
    expect(check(db, s)).toEqual([]);
  });

  test('сценарий без записи `commerce` — событий нет', () => {
    const l = newPlant(legacy, { scenario: SC });
    expect(legacy.scenarios[SC].commerce).toBeUndefined();
    for (let h = 0; h < 40 * 24; h++) expect(apply(legacy, l, { kind: 'advance', seconds: HOUR }).some(n => n.kind === 'bigOrder' || n.kind === 'demandCut')).toBe(false);
    expect(l.planning.commerce).toBeUndefined();
  });
});

describe('цена правки', () => {
  const s = newPlant(db, { scenario: SC });
  live(s, 40);
  const b = nextOpen(s)!;
  const other = sc.plan!.items.find(it => db.recipes[it.recipe].product !== b.product)!;
  const same = sc.plan!.items.find(it => db.recipes[it.recipe].product === b.product)!;
  const tomorrow = tOf(addWorkdays(calOf(db, s), today(s), 1)) + BATCH_HOUR;

  test('задание другого продукта завтра — генеральные уборки и переналадка; того же — малые; снять — уборок меньше', () => {
    const o = editPrice(db, s, { fresh: [{ recipe: other.recipe, sku: other.sku, notBefore: tomorrow }] });
    expect(o.major).toBeGreaterThan(0);
    expect(o.majorSec).toBeGreaterThan(0);
    expect(o.formats).toBeGreaterThan(0);
    const m = editPrice(db, s, { fresh: [{ recipe: same.recipe, sku: same.sku, notBefore: tomorrow }] });
    expect(m.minor).toBeGreaterThan(0);
    expect(m.major).toBeLessThan(o.major);
    const d = editPrice(db, s, { drop: [b.id] });
    expect(d.minor + d.major).toBeLessThan(0);
    expect(d.later.some(x => x.batch === b.id)).toBe(false);
    // тот же прогон: цена — разница двух прогонов, состояние не меняется
    const before = JSON.stringify(s);
    expect(editPrice(db, s, { drop: [b.id] })).toEqual(d);
    expect(JSON.stringify(s)).toBe(before);
    expect(priceDays(db, s)).toBe(sc.plan!.price!);
  });

  test('команды игрока в горизонте — запись журнала с ценой; за горизонтом — без цены, сдвиг там — без записи', () => {
    const c = structuredClone(s);
    apply(db, c, { kind: 'seat', seats: ['production'] });
    const n0 = c.journal.length;
    const fresh = { recipe: other.recipe, sku: other.sku, notBefore: tomorrow };
    const want = editPrice(db, c, { fresh: [fresh] });
    apply(db, c, { kind: 'order', ...fresh, by: 'player' });
    const r1 = c.journal[c.journal.length - 1];
    expect(c.journal.length).toBe(n0 + 1);
    expect(r1.by).toBe('player');
    expect(r1.d.kind === 'order' && r1.d.frozen).toEqual(want);
    // сдвиг в горизонте — новая запись с прежним и новым «не раньше»
    const x = nextOpen(c)!;
    const to = x.notBefore + 2 * DAY;
    const sh = editPrice(db, c, { changes: [{ batch: x.id, notBefore: to }] });
    apply(db, c, { kind: 'shift', batch: x.id, notBefore: to, by: 'player' });
    const r2 = c.journal[c.journal.length - 1];
    expect(r2.d).toEqual({ kind: 'shift', batch: x.id, ...(x.sku ? { sku: x.sku } : {}), from: x.notBefore - 2 * DAY, notBefore: to, frozen: sh });
    // за горизонтом: задание — без цены; сдвиг — без записи
    const far = tOf(frozenEdge(db, c) + 7) + BATCH_HOUR;
    apply(db, c, { kind: 'order', recipe: same.recipe, sku: same.sku, notBefore: far, by: 'player' });
    const r3 = c.journal[c.journal.length - 1];
    expect(r3.d.kind === 'order' && r3.d.frozen).toBe(undefined);
    const farBatch = Object.values(c.batches).at(-1)!;
    const n3 = c.journal.length;
    apply(db, c, { kind: 'shift', batch: farBatch.id, notBefore: far + DAY, by: 'player' });
    expect(c.journal.length).toBe(n3);
    // снять в горизонте — запись отмены с ценой
    const y = nextOpen(c)!;
    const cp = editPrice(db, c, { drop: [y.id] });
    apply(db, c, { kind: 'cancel', batch: y.id, by: 'player' });
    const r4 = c.journal[c.journal.length - 1];
    expect(r4.d.kind === 'cancel' && r4.d.frozen).toEqual(cp);
    // показатель начальника отдела планирования — правок в горизонте с начала суток: период — до нынешнего мига, без него
    const t3 = c.t;
    apply(db, c, { kind: 'advance', seconds: HOUR });
    const p = sincePeriod(c, tOf(dayOf(c, t3)));
    expect(kpiPick(db, c, p, ['frozenEdits']).frozenEdits).toBe(3);
    expect(check(db, c)).toEqual([]);
  });
});

describe('виды', () => {
  const s = newPlant(db, { scenario: SC });
  live(s, 30);

  test('расписание: край горизонта; черновик в горизонте — цена тех же двух прогонов, за горизонтом — нет', () => {
    const q = { view: 'gantt' as const, from: s.t, to: s.t + 21 * DAY };
    const v = ganttView(db, s, q);
    expect(v.frozen).toEqual({ edge: tOf(frozenEdge(db, s)), days: 10 });
    expect(v.price).toBeUndefined();
    const b = nextOpen(s)!;
    const drop = ganttView(db, s, { ...q, drop: [b.id] });
    expect(drop.price).toEqual(editPrice(db, s, { drop: [b.id] }));
    const far = ganttView(db, s, { ...q, fresh: [{ recipe: sc.plan!.items[0].recipe, sku: sc.plan!.items[0].sku, notBefore: tOf(frozenEdge(db, s) + 7) + BATCH_HOUR }] });
    expect(far.price).toBeUndefined();
    // прогон без горизонта цены и с ним — до горизонта цены одинаковы
    const until = s.t + priceDays(db, s) * DAY;
    const a = forecast(db, s).bars.filter(x => x.from < until && x.when !== 'past');
    const c = forecast(db, s, [], [], [], until).bars.filter(x => x.from < until && x.when !== 'past');
    expect(c.length).toBeGreaterThan(0);
    expect(a.filter(x => x.kind === 'roomClean').length).toBe(c.filter(x => x.kind === 'roomClean').length);
  });

  test('планёрка: «Правки плана» — события коммерции и правки в горизонте за сутки до 08:00; без истины', () => {
    const c = newPlant(db, { scenario: SC });
    let day = 0;
    // до первой планёрки после события
    for (let h = 0; h < 60 * 24; h++) {
      apply(db, c, { kind: 'advance', seconds: HOUR });
      const m = momentOf(c.start, c.t);
      if (m.sec === 8 * HOUR && c.journal.some(r => (r.d.kind === 'bigOrder' || r.d.kind === 'demandCut') && r.t >= c.t - DAY)) {
        day = m.day;
        break;
      }
    }
    expect(day).toBeGreaterThan(0);
    apply(db, c, { kind: 'seat', seats: ['production'] });
    const b = nextOpen(c)!;
    apply(db, c, { kind: 'cancel', batch: b.id, by: 'player' });
    const v = morningView(db, c, { view: 'morning', day });
    expect(v.edits!.events.length).toBeGreaterThan(0);
    for (const e of v.edits!.events) expect(e.t).toBeGreaterThanOrEqual(c.t - DAY - HOUR);
    // правка после 08:00 — на завтрашней планёрке
    expect(v.edits!.edits).toEqual([]);
    const next = morningView(db, c, { view: 'morning', day: day + 1 });
    expect(next.edits?.edits.map(e => [e.kind, e.batch, e.by])).toEqual([['cancel', b.id, 'player']]);
    expect(JSON.stringify(v)).not.toContain('truth');
  });
});

describe('сохранение и сборщик базы', () => {
  test('образец схемы 43 открывается нынешней схемой: снятого спроса нет, дни событий — с первого часа событий', () => {
    const raw = readFileSync(join(import.meta.dir, 'fixtures/save-v43.json'), 'utf8');
    const s = fromSave(db, raw);
    expect(s.schema).toBe(SCHEMA);
    expect(s.planning.commerce).toBeUndefined();
    expect(frozenOf(db, s)).toBe(10);
    live(s, 40);
    expect(s.planning.commerce?.month).toBe(monthAt(s, s.t));
    expect(check(db, s)).toEqual([]);
  });

  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  function broken(edits: Record<string, [string, string][]>): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'pharma-content-'));
    dirs.push(dir);
    cpSync(join(import.meta.dir, '../../content'), dir, { recursive: true });
    for (const [file, e] of Object.entries(edits)) {
      const p = join(dir, file);
      let text = readFileSync(p, 'utf8');
      for (const [a, b] of e) {
        expect(text.includes(a)).toBe(true);
        text = text.replace(a, b);
      }
      writeFileSync(p, text);
    }
    return buildDb(dir).errors;
  }

  test('горизонт — от 1 до 20 рабочих дней; горизонт цены не короче горизонта; у событий «от» не больше «до»', () => {
    expect(broken({})).toEqual([]);
    expect(broken({ 'policies/plan/frozen.yaml': [['max: 15', 'max: 25']] }).some(e => e.includes('от 1 до 20'))).toBe(true);
    expect(broken({ 'policies/plan/frozen.yaml': [['min: 5', 'min: 0']] }).length).toBeGreaterThan(0);
    expect(broken({ 'scenarios/proto.yaml': [['price: 21', 'price: 20']] }).some(e => e.includes('горизонт цены'))).toBe(true);
    expect(broken({ 'scenarios/proto.yaml': [['perMonth: [1, 4]', 'perMonth: [5, 4]']] }).some(e => e.includes('«от» больше «до»'))).toBe(true);
    expect(broken({ 'scenarios/proto.yaml': [['due: [14, 42]', 'due: [42, 14]']] }).some(e => e.includes('«от» больше «до»'))).toBe(true);
    expect(broken({ 'scenarios/proto.yaml': [['frozen: 10', 'frozen: 25']] }).length).toBeGreaterThan(0);
  });
});
