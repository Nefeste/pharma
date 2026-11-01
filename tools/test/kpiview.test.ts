// Б5ж: окно «Показатели» и «Итоги месяца» (src/sim/kpi.ts). Вид — без полей истины: у двух заводов, которые различаются
// только ими, вид один и тот же, с «Почему?» каждого показателя; строка «Почему?» ведёт к записи завода — серии, заказу,
// отклонению, партии, отказу, человеку, показателю МОК; вкладки — взятые места первыми; число месяца — то же, что даёт
// функция движка; «Итоги месяца» — только на первой планёрке после закрытия, у руководителя не больше двух сдвинувшихся
// показателей с противовесом; первый закрытый месяц — сравнивать не с чем. Карточка заказа — его строки и статус.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { db } from '../../src/content';
import { SEATS } from '../../src/content/types';
import { DAY, momentOf } from '../../src/engine/core/calendar';
import { apply, MORNING } from '../../src/engine/engine';
import { currentPeriod, KPI, kpiCtx, KPIS, kpiValues, monthPeriod } from '../../src/engine/kpi';
import { fromSave } from '../../src/engine/save';
import type { PlantState } from '../../src/engine/types';
import { CLOSE_MAX, CLOSE_MIN, HIST, headsOf, kpiView, type KpiWhyRow, monthClose, WHY, WHY_MAX, whyRows } from '../../src/sim/kpi';
import { morningView } from '../../src/sim/report';
import { viewOf } from '../../src/sim/views';

// образец схемы 33: закрыты сентябрь и октябрь, идёт ноябрь
const s: PlantState = fromSave(db, readFileSync(new URL('./fixtures/save-v33.json', import.meta.url), 'utf8'));

/** Завод с другими полями истины: свойства партий и серий, причины, запас узлов. */
function otherTruth(x: PlantState): PlantState {
  const b: PlantState = structuredClone(x);
  for (const lot of Object.values(b.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
  for (const bt of Object.values(b.batches)) {
    for (const k of Object.keys(bt.truth) as (keyof typeof bt.truth)[]) bt.truth[k] = (bt.truth[k] ?? 0) + 777;
    bt.causes = [];
  }
  for (const p of Object.values(b.parts)) p.budget += 12345;
  return b;
}

describe('окно «Показатели»', () => {
  test('вкладки — все места, взятые первыми; строки — руководители вкладки; у плитки — 12 месяцев истории', () => {
    for (const tab of SEATS) {
      const v = kpiView(db, s, { view: 'kpi', tab });
      expect([...v.tabs].sort()).toEqual([...SEATS].sort());
      const held = (s.seats ?? []).filter(x => x.to === undefined).map(x => x.seat);
      expect(v.tabs.slice(0, held.length).sort()).toEqual([...held].sort());
      expect(v.rows.map(r => r.head)).toEqual(headsOf(tab));
      for (const r of v.rows) for (const c of r.cells) expect(c.hist.length).toBe(HIST);
    }
    // у директора — он сам и отдел кадров; у четырёх постов — их отделы; каждый показатель — хотя бы на одной вкладке
    expect(headsOf('director')).toEqual(['dir', 'hr']);
    const seen = new Set(SEATS.flatMap(tab => kpiView(db, s, { view: 'kpi', tab }).rows.flatMap(r => r.cells.map(c => c.id))));
    expect(seen.size).toBe(KPIS.length);
  });

  test('число месяца — функции движка за текущий месяц; прошлый — итог закрытого; стрелка — по направлению', () => {
    const now = kpiValues(db, s, currentPeriod(db, s));
    const last = s.kpi.months.at(-1)!;
    const cells = SEATS.flatMap(tab => kpiView(db, s, { view: 'kpi', tab }).rows.flatMap(r => r.cells));
    for (const c of cells) {
      expect(c.now).toBe(now[c.id]);
      expect(c.prev).toBe(last.v[c.id]);
      expect(c.hist.at(-1)).toBe(last.v[c.id] ?? null);
      if (c.now !== undefined && c.prev !== undefined && !KPI[c.id].acc) expect(c.trend).toBe(Math.sign((c.now - c.prev) * KPI[c.id].dir) as 1 | -1 | 0);
    }
    // месяц — ноябрь 2027 и с полуночи 1-го; история — закрытые месяцы, старые первыми
    const v = kpiView(db, s, { view: 'kpi', tab: 'director' });
    expect(v.month).toMatchObject({ y: 2027, m: 11, from: last.to });
    expect(v.months).toEqual(s.kpi.months.map(m => ({ y: m.y, m: m.m, from: m.from })));
    expect(v.older).toBe(last.from);
    expect(v.newer).toBeUndefined();
  });

  test('закрытый месяц: итог, как его записал движок, прошлый — месяц до него, «Почему?» — записи его периода; соседи', () => {
    const [sep, oct] = s.kpi.months;
    const v = kpiView(db, s, { view: 'kpi', tab: 'commerce', month: oct.from, why: 'otif' });
    expect(v.month).toEqual({ y: oct.y, m: oct.m, from: oct.from, closed: true });
    expect([v.older, v.newer]).toEqual([sep.from, null]);
    expect(v.months.map(m => m.from)).toEqual([sep.from, oct.from]);
    for (const c of v.rows.flatMap(r => r.cells)) {
      expect(c.now).toBe(oct.v[c.id]);
      expect(c.prev).toBe(sep.v[c.id]);
      expect(c.hist.at(-1)).toBe(oct.v[c.id] ?? null);
    }
    expect(v.why?.rows).toEqual(whyRows(db, s, kpiCtx(db, s, monthPeriod(s, oct)), 'otif').slice(0, WHY_MAX));
    // первый закрытый — раньше него ничего, позже — октябрь; неизвестное мгновение — нынешний месяц
    const first = kpiView(db, s, { view: 'kpi', tab: 'commerce', month: sep.from });
    expect([first.older, first.newer]).toEqual([undefined, oct.from]);
    expect(first.rows.flatMap(r => r.cells).every(c => c.prev === undefined && c.trend === undefined)).toBe(true);
    expect(kpiView(db, s, { view: 'kpi', tab: 'commerce', month: 12345 }).month.closed).toBeUndefined();
  });

  test('сумма месяца сравнивается с прошлым в сутки: неполный месяц не «хуже» полного только потому, что он короче', () => {
    const last = s.kpi.months.at(-1)!;
    const p = currentPeriod(db, s);
    const v = kpiView(db, s, { view: 'kpi', tab: 'commerce' });
    const rev = v.rows.flatMap(r => r.cells).find(c => c.id === 'revenue')!;
    expect(rev.acc).toBe(true);
    if (rev.now !== undefined && rev.prev !== undefined) {
      const per = rev.now / (p.to - p.from) - rev.prev / (last.to - last.from);
      expect(rev.trend).toBe(Math.sign(per) as 1 | -1 | 0);
    }
  });

  test('без истины: у двух заводов с разными полями истины вид один и тот же — и у «Почему?» каждого показателя', () => {
    const b = otherTruth(s);
    for (const tab of SEATS) expect(JSON.stringify(kpiView(db, b, { view: 'kpi', tab }))).toBe(JSON.stringify(kpiView(db, s, { view: 'kpi', tab })));
    for (const id of WHY) expect(JSON.stringify(kpiView(db, b, { view: 'kpi', tab: 'director', why: id }).why)).toBe(JSON.stringify(kpiView(db, s, { view: 'kpi', tab: 'director', why: id }).why));
  });

  test('«Почему?» каждого показателя ведёт к записям завода — в нынешнем месяце и в закрытых; в окне не больше 30 строк', () => {
    for (const id of WHY) {
      const why = kpiView(db, s, { view: 'kpi', tab: 'director', why: id }).why!;
      expect(why.id).toBe(id);
      expect(why.rows.length).toBeLessThanOrEqual(WHY_MAX);
      if (why.all !== undefined) expect(why.all).toBeGreaterThan(WHY_MAX);
    }
    let rows = 0;
    const kinds = new Set<string>();
    const periods = [currentPeriod(db, s), ...s.kpi.months.map(m => monthPeriod(s, m))];
    const all: KpiWhyRow[] = periods.flatMap(p => [...WHY].flatMap(id => whyRows(db, s, kpiCtx(db, s, p), id)));
    {
      for (const r of all) {
        rows++;
        kinds.add(r.k);
        switch (r.k) {
          case 'batch':
            expect(s.batches[`B${r.batch}`]).toBeDefined();
            break;
          case 'order':
            expect(s.orders[`O${r.order}`]).toBeDefined();
            expect(['short', 'late']).toContain(s.orders[`O${r.order}`].status);
            break;
          case 'dev':
            expect(s.deviations[`D${r.n}`]).toBeDefined();
            if (r.prev !== undefined) expect(s.deviations[`D${r.prev}`]).toBeDefined();
            break;
          case 'lot':
            expect(Object.values(s.lots).some(l => l.code.y === r.code[0] && l.code.m === r.code[1] && l.code.n === r.code[2] && l.material === r.material)).toBe(true);
            if (r.unit !== undefined) expect(s.units[`U${r.unit}`]).toBeDefined();
            break;
          case 'fail':
            expect(s.maintLog.some(e => e.part === r.part && e.t === r.t)).toBe(true);
            expect(r.thing).toBeDefined();
            expect(r.type).toBeDefined();
            break;
          case 'person':
            expect(s.people[`E${r.person}`] ?? Object.values(s.former).find(p => p.tab === r.tab)).toBeDefined();
            break;
          case 'cpk':
            expect(db.recipes[r.recipe]).toBeDefined();
            expect(db.tests[r.test]).toBeDefined();
            break;
        }
      }
    }
    expect(rows).toBeGreaterThan(10);
    // за два месяца с небольшим — серии, заказы, отклонения, партии, люди, МОК; отказов в образце ещё нет
    for (const k of ['batch', 'order', 'dev', 'lot', 'person', 'cpk']) expect(kinds.has(k)).toBe(true);
    // неизвестный показатель и показатель без «Почему?» — без списка
    expect(kpiView(db, s, { view: 'kpi', tab: 'director', why: 'nope' }).why).toBeUndefined();
    expect(kpiView(db, s, { view: 'kpi', tab: 'director', why: 'cashMin' }).why).toBeUndefined();
  });

  test('«Почему?» у OTIF — заказы, отгруженные не полностью или не вовремя; карточка заказа — его строки и статус', () => {
    const p = { from: s.kpi.months[0].from, to: s.kpi.months.at(-1)!.to };
    // за закрытые месяцы ищем заказ с недопоставкой, чтобы карточка была не пустой
    const bad = Object.values(s.orders).find(o => (o.status === 'short' || o.status === 'late') && o.due >= p.from);
    const why = kpiView(db, s, { view: 'kpi', tab: 'commerce', why: 'otif' }).why!;
    for (const r of why.rows) expect(r.k).toBe('order');
    if (bad) {
      const n = Number(bad.id.slice(1));
      const v = viewOf(db, s, { id: 'card', view: 'card', thing: { kind: 'order', n } });
      expect(v.view).toBe('card');
      const c = v.view === 'card' ? v.card : undefined;
      expect(c).toMatchObject({ kind: 'order', order: n, customer: bad.customer, status: bad.status });
      if (c?.kind === 'order') {
        expect(c.lines).toEqual(bad.lines.map(l => ({ sku: l.sku, cases: l.cases, shipped: l.shipped })));
        expect(c.lines.some(l => l.shipped < l.cases) || bad.status === 'late').toBe(true);
      }
    }
    // заказа нет — «этого больше нет»
    const gone = viewOf(db, s, { id: 'card', view: 'card', thing: { kind: 'order', n: 999_999 } });
    expect(gone.view === 'card' && gone.card.kind).toBe('gone');
  });
});

describe('итоги месяца', () => {
  const oct = s.kpi.months.at(-1)!;

  test('только на первой планёрке после закрытия: 1 ноября в 08:00 есть, 2 ноября и до закрытия — нет', () => {
    expect(monthClose(s, oct.to + MORNING)).toBeDefined();
    expect(monthClose(s, oct.to + DAY + MORNING)).toBeUndefined();
    expect(monthClose(s, oct.to - DAY + MORNING)).toBeUndefined();
  });

  test('у руководителя — не больше двух показателей, сдвинувшихся не меньше чем на 5 %; стрелка — по направлению; противовес', () => {
    const x = monthClose(s, oct.to + MORNING)!;
    const before = s.kpi.months.at(-2)!;
    expect(x).toMatchObject({ y: oct.y, m: oct.m });
    expect(x.first).toBeUndefined();
    for (const h of x.heads) {
      expect(h.rows.length).toBeGreaterThan(0);
      expect(h.rows.length).toBeLessThanOrEqual(CLOSE_MAX);
      for (const r of h.rows) {
        const k = KPI[r.id];
        expect(k.head).toBe(h.head);
        expect(r.v).toBe(oct.v[r.id]);
        expect(r.was).toBe(before.v[r.id]);
        expect(Math.round((Math.abs(r.v - r.was) * 10000) / Math.max(Math.abs(r.v), Math.abs(r.was)))).toBeGreaterThanOrEqual(CLOSE_MIN);
        expect(r.trend).toBe(Math.sign((r.v - r.was) * k.dir) as 1 | -1 | 0);
        if (k.pair) expect(r.pair).toMatchObject({ id: k.pair, ...(oct.v[k.pair] !== undefined ? { v: oct.v[k.pair] } : {}) });
      }
      // по порядку сдвига: первый сдвинулся не меньше второго
      if (h.rows.length === 2) {
        const sc = (r: (typeof h.rows)[number]) => Math.abs(r.v - r.was) / Math.max(Math.abs(r.v), Math.abs(r.was));
        expect(sc(h.rows[0])).toBeGreaterThanOrEqual(sc(h.rows[1]));
      }
    }
    expect(x.heads.length).toBeGreaterThan(0);
  });

  test('первый закрытый месяц — сравнивать не с чем', () => {
    const one: PlantState = structuredClone(s);
    one.kpi.months = one.kpi.months.slice(0, 1);
    const sep = one.kpi.months[0];
    expect(monthClose(one, sep.to + MORNING)).toEqual({ y: sep.y, m: sep.m, from: sep.from, first: true, heads: [] });
  });

  test('на планёрке 1-го числа — раздел «Итоги месяца», на другой — нет; без извещения и автопаузы', () => {
    // день планёрки — номер дня от 1970-01-01
    const first = momentOf(s.start, oct.to).day;
    expect(morningView(db, s, { view: 'morning', day: first }).month).toEqual(monthClose(s, oct.to + MORNING));
    expect(morningView(db, s, { view: 'morning', day: first + 1 }).month).toBeUndefined();
    // закрытие месяца не пишет извещений: ход через полночь на 1-е — те же извещения, что без показателей
    const c: PlantState = structuredClone(s);
    const notes = apply(db, c, { kind: 'advance', seconds: DAY });
    expect(notes.some(n => (n.kind as string) === 'kpi' || (n.kind as string) === 'month')).toBe(false);
  });
});
