// Виды Б6а (docs/specs/2026-10-vertical-slice.md, «Б6а», «Проверки Б6а»): вкладка «Задания» — строки заданий, состояние,
// ожидаемый выпуск по прогону расписания и медиане выпущенных, опоздание к сроку, отбор за 7 суток, «Полосы»; заказы без
// покрытия — по свободной ГП и выпускам к сроку, без зарезервированных ящиков и с остаточным сроком годности; отмена в
// черновике — прогон без задания, «Утвердить» даёт тот же план; строка планёрки; полей истины нет.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR, momentOf } from '../../src/engine/core/calendar';
import { apply, MORNING, newPlant } from '../../src/engine/engine';
import { type Bar, forecast } from '../../src/engine/plan/schedule';
import { casesOf } from '../../src/engine/planner';
import type { Batch, Order, PlantState } from '../../src/engine/types';
import { JOBS_KEEP, type JobRow, jobsOf, TAIL_DAYS } from '../../src/sim/jobs';
import { ganttView } from '../../src/sim/plan';
import { morningView } from '../../src/sim/report';
import { cancelsOf } from '../../src/ui/draft';
import { filterOf } from '../../src/ui/Jobs';

const SC = 'scn.proto';

/** Завод игры в 08:00 суток `day`. */
function at(day: number): PlantState {
  const s = newPlant(db, { scenario: SC });
  apply(db, s, { kind: 'advance', seconds: day * DAY + MORNING });
  return s;
}

/** Медиана целых — нижняя из двух средних. */
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
const bulkEnd = (b: Batch) => Math.max(...b.records.map(r => r.end));
const lastStage = (b: Batch) => db.recipes[b.recipe].stages.at(-1)!.id;
const pending = (s: PlantState) => Object.values(s.batches).filter(b => (b.status === 'waiting' || b.status === 'reserved') && b.notBefore > s.t);

/** Заказ покупателя, которого не было: на позицию, со сроком и остаточным сроком годности. */
function order(s: PlantState, sku: string, cases: number, due: number, minShelf = 0): Order {
  const o: Order = { id: 'O9999', customer: Object.keys(s.customers)[0], lines: [{ sku, cases, reserved: 0, shipped: 0 }], placed: s.t, due, minShelf, status: 'open', cases: [], units: [] };
  s.orders[o.id] = o;
  return o;
}

/** Свободная ГП позиции «сейчас»: незарезервированные ящики разрешённых партий — в обороте или выйдут к мгновению `t`. */
function freeNow(s: PlantState, sku: string, pub: number, t: number): number {
  const fg = db.skus[sku].fg;
  let n = 0;
  for (const c of Object.values(s.containers)) {
    const l = s.lots[c.lot];
    if (c.reserved || l?.material !== fg || l.status !== 'released') continue;
    if (l.circulation !== undefined || Math.max(s.t, (l.since ?? s.t) + pub) <= t) n++;
  }
  return n;
}

describe('строки заданий', () => {
  const s = at(40);
  const f = forecast(db, s);
  const v = jobsOf(db, s, f);

  test('в списке — все задания, кроме выпущенных, отклонённых и отменённых раньше 7 суток; по сроку, потом «не раньше»', () => {
    const want = Object.values(s.batches).filter(b => {
      if (b.status === 'released' || b.status === 'rejected') return (b.released ?? b.phaseAt) >= s.t - JOBS_KEEP * DAY;
      return b.status !== 'cancelled' || b.cancelled! >= s.t - JOBS_KEEP * DAY;
    });
    expect(v.rows.map(r => r.id).sort()).toEqual(want.map(b => b.id).sort());
    expect(v.rows.length).toBeGreaterThan(10);
    const key = (r: JobRow) => [r.due ?? Number.MAX_SAFE_INTEGER, r.notBefore, r.n];
    for (let i = 1; i < v.rows.length; i++) {
      const [a, b] = [key(v.rows[i - 1]), key(v.rows[i])];
      expect(a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))).toBe(true);
    }
  });

  test('состояние: ждёт материала — какого, на стадии — какой; отменить можно только до комплектовки', () => {
    for (const r of v.rows) {
      const b = s.batches[r.id];
      expect(r.status).toBe(b.status);
      expect(r.open).toBe(b.status === 'waiting' || b.status === 'reserved');
      expect(r.material).toBe(b.status === 'waiting' ? b.short?.[0]?.material : undefined);
      expect(r.stage).toBe(b.status === 'process' ? db.recipes[b.recipe].stages[b.stage].id : undefined);
      expect(r.due).toBe(b.due);
      expect(r.goal?.kind).toBe(b.for?.kind);
    }
    expect(v.rows.some(r => r.status === 'process')).toBe(true);
    expect(v.rows.some(r => r.open)).toBe(true);
  });

  test('медианы — по записям выпущенных за 90 суток: от балка до выпуска и от выпуска до оборота', () => {
    const recent = Object.values(s.batches).filter(b => b.status === 'released' && b.released! >= s.t - TAIL_DAYS * DAY);
    expect(recent.length).toBeGreaterThan(3);
    expect(v.tail).toBe(median(recent.filter(b => b.records.length > 0).map(b => b.released! - bulkEnd(b))));
    const fg = (b: Batch) => (b.pack?.fg ? s.lots[b.pack.fg] : undefined);
    expect(v.pub).toBe(median(recent.filter(b => fg(b)?.circulation !== undefined).map(b => fg(b)!.circulation! - b.released!)));
  });

  test('ожидаемый выпуск: выпущенная — когда выпущена; стадии прошли — конец по досье; иначе — конец последней стадии по прогону; и медиана', () => {
    const planned = (b: Batch) => Math.max(...f.bars.filter((x: Bar) => x.batch === b.id && x.kind === 'stage' && x.stage === lastStage(b)).map(x => x.to));
    let plan = 0;
    let done = 0;
    for (const r of v.rows) {
      const b = s.batches[r.id];
      if (b.status === 'released') {
        expect(r.expect).toBe(b.released);
        expect(r.late).toBeUndefined();
        continue;
      }
      if (b.status === 'rejected' || b.status === 'cancelled') {
        expect(r.expect).toBeUndefined();
        continue;
      }
      const past = b.stage >= db.recipes[b.recipe].stages.length;
      const end = past ? bulkEnd(b) : planned(b);
      if (!Number.isFinite(end)) {
        expect(r.expect).toBeUndefined();
        continue;
      }
      past ? done++ : plan++;
      expect(r.expect).toBe(Math.max(s.t, end + v.tail!));
      // в оборот — ещё медиана от выпуска до оборота; позже срока — на столько опоздает
      const circ = r.expect! + v.pub!;
      expect(r.late).toBe(b.due !== undefined && circ > b.due ? circ - b.due : undefined);
    }
    expect(plan).toBeGreaterThan(3);
    expect(done).toBeGreaterThan(0);
  });

  test('«Полосы» — с начала его полос: прошли стадии — первая запись досье, иначе первая полоса прогона', () => {
    for (const r of v.rows) {
      const b = s.batches[r.id];
      const bars = f.bars.filter(x => x.batch === b.id).map(x => x.from);
      expect(r.at).toBe(b.records.length > 0 ? Math.min(...b.records.map(x => x.start)) : bars.length > 0 ? Math.min(...bars) : b.notBefore);
    }
  });

  test('отбор: до комплектовки — в плане, выпущены и отклонены — выпущены, отменены, остальное — в работе', () => {
    expect(filterOf({ status: 'waiting' })).toBe('plan');
    expect(filterOf({ status: 'reserved' })).toBe('plan');
    for (const st of ['kitting', 'process', 'bulk', 'packing', 'fg'] as const) expect(filterOf({ status: st })).toBe('work');
    expect(filterOf({ status: 'released' })).toBe('done');
    expect(filterOf({ status: 'rejected' })).toBe('done');
    expect(filterOf({ status: 'cancelled' })).toBe('cancelled');
  });

  test('отменённое — в списке 7 суток с мгновением отмены, без ожидаемого выпуска; потом уходит', () => {
    const t = at(40);
    const b = pending(t)[0];
    apply(db, t, { kind: 'cancel', batch: b.id });
    const r = jobsOf(db, t, forecast(db, t)).rows.find(x => x.id === b.id)!;
    expect(r).toMatchObject({ status: 'cancelled', cancelled: t.t, open: false });
    expect(r.expect).toBeUndefined();
    expect(r.late).toBeUndefined();
    apply(db, t, { kind: 'advance', seconds: JOBS_KEEP * DAY });
    expect(jobsOf(db, t, forecast(db, t)).rows.some(x => x.id === b.id)).toBe(true);
    apply(db, t, { kind: 'advance', seconds: HOUR });
    expect(jobsOf(db, t, forecast(db, t)).rows.some(x => x.id === b.id)).toBe(false);
  }, 60_000);

  test('без истины: ключи вида — только описанные', () => {
    const keys = new Set<string>();
    const walk = (x: unknown) => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) keys.add(k), walk(y);
    };
    walk(v);
    const ALLOWED = new Set('rows uncovered tail pub id n code recipe sku goal kind order customer due notBefore status material stage expect late cancelled open at cases short'.split(' '));
    expect([...keys].filter(k => !ALLOWED.has(k))).toEqual([]);
    for (const k of ['truth', 'noise', 'causes', 'budget', 'wear', 'size', 'root']) expect(keys.has(k)).toBe(false);
  });
});

describe('заказы без покрытия', () => {
  const sku = db.scenarios[SC].plan!.items[0].sku;

  test('срок — сейчас: не хватит заказанного без свободной ГП сейчас; ещё ящики — ещё нехватка', () => {
    const s = at(40);
    const v0 = jobsOf(db, s, forecast(db, s));
    const have = freeNow(s, sku, v0.pub!, s.t);
    expect(have).toBeGreaterThan(0);
    const o = order(s, sku, have + 5, s.t);
    const u = jobsOf(db, s, forecast(db, s)).uncovered.find(x => x.order === o.id)!;
    expect(u).toEqual({ order: o.id, customer: o.customer, due: o.due, sku, cases: have + 5, short: 5 });
    o.lines[0].cases += 7;
    expect(jobsOf(db, s, forecast(db, s)).uncovered.find(x => x.order === o.id)?.short).toBe(12);
    // сколько есть — покрыт
    o.lines[0].cases = have;
    expect(jobsOf(db, s, forecast(db, s)).uncovered.some(x => x.order === o.id)).toBe(false);
  });

  test('зарезервированный ящик не свободен; партия с остаточным сроком меньше просимого — не этому покупателю', () => {
    const s = at(40);
    const pub = jobsOf(db, s, forecast(db, s)).pub!;
    const have = freeNow(s, sku, pub, s.t);
    const o = order(s, sku, have, s.t);
    const fg = db.skus[sku].fg;
    const c = Object.values(s.containers).find(x => !x.reserved && s.lots[x.lot]?.material === fg && s.lots[x.lot].status === 'released' && s.lots[x.lot].circulation !== undefined)!;
    c.reserved = c.qty;
    expect(jobsOf(db, s, forecast(db, s)).uncovered.find(x => x.order === o.id)?.short).toBe(1);
    delete c.reserved;
    // покупатель просит остаточный срок чуть больше, чем у самой старой партии: её ящики не ему
    const day = momentOf(s.start, s.t).day;
    const full = Math.floor((db.materials[fg].shelf * 36525) / 1200);
    const lots = Object.values(s.lots).filter(l => l.material === fg && l.status === 'released' && Object.values(s.containers).some(x => x.lot === l.id && !x.reserved));
    const old = lots.reduce((a, l) => (l.expiry < a.expiry ? l : a));
    o.minShelf = Math.floor(((old.expiry - day) * 10000) / full) + 1;
    const gone = Object.values(s.containers).filter(x => {
      const l = s.lots[x.lot];
      return !x.reserved && l.material === fg && l.status === 'released' && (l.circulation !== undefined || Math.max(s.t, (l.since ?? s.t) + pub) <= s.t) && (l.expiry - day) * 10000 < o.minShelf * full;
    }).length;
    expect(gone).toBeGreaterThan(0);
    expect(jobsOf(db, s, forecast(db, s)).uncovered.find(x => x.order === o.id)?.short).toBe(gone);
  });

  test('срок — дальше выпусков: к нему покрывает и ГП заданий, которая выйдет в оборот; срок — сейчас — только свободная', () => {
    const s = at(40);
    // другие заказы позиции не берут свою ГП первыми
    for (const o of Object.values(s.orders)) if (o.status === 'open') o.status = 'shipped';
    const f = forecast(db, s);
    const v = jobsOf(db, s, f);
    const coming = v.rows.filter(r => r.sku === sku && r.expect !== undefined && r.status !== 'released');
    expect(coming.length).toBeGreaterThan(1);
    const late = Math.max(...coming.map(r => r.expect! + v.pub!));
    const made = coming.reduce((a, r) => a + casesOf(db.recipes[r.recipe], db.skus[sku]), 0);
    const total = freeNow(s, sku, v.pub!, late) + made;
    const o = order(s, sku, total, late);
    expect(jobsOf(db, s, f).uncovered.some(x => x.order === o.id)).toBe(false);
    o.lines[0].cases = total + 1;
    expect(jobsOf(db, s, f).uncovered.find(x => x.order === o.id)?.short).toBe(1);
    o.lines[0].cases = total;
    o.due = s.t;
    expect(jobsOf(db, s, f).uncovered.find(x => x.order === o.id)?.short).toBe(total - freeNow(s, sku, v.pub!, s.t));
  });

  test('на планёрке — число заказов и ящиков, которых не хватит; все покрыты — строки нет', () => {
    const s = at(40);
    const day = momentOf(s.start, s.t).day;
    const before = morningView(db, s, { view: 'morning', day }).uncovered;
    const have = freeNow(s, sku, jobsOf(db, s, forecast(db, s)).pub!, s.t);
    order(s, sku, have + 9, s.t);
    const u = jobsOf(db, s, forecast(db, s)).uncovered;
    const m = morningView(db, s, { view: 'morning', day }).uncovered!;
    expect(m).toEqual({ orders: new Set(u.map(x => x.order)).size, cases: u.reduce((a, x) => a + x.short, 0) });
    // заказ «на сейчас» первым берёт и ту ГП, что покрывала другие, — без покрытия и он, и, может быть, они
    expect(u.some(x => x.order === 'O9999' && x.short === 9)).toBe(true);
    expect(m.orders).toBeGreaterThan(before?.orders ?? 0);
    expect(m.cases).toBeGreaterThanOrEqual(9);
    delete s.orders.O9999;
    expect(morningView(db, s, { view: 'morning', day }).uncovered).toEqual(before);
  });
});

describe('отмена в черновике', () => {
  test('прогон без задания: его полос нет, прежние — рядом; «Утвердить» — тот же план', () => {
    const s = at(40);
    const b = pending(s).find(x => forecast(db, s).bars.some(y => y.batch === x.id))!;
    expect(b).toBeDefined();
    const from = s.t - DAY;
    const to = s.t + 14 * DAY;
    const v = ganttView(db, s, { view: 'gantt', from, to, drop: [b.id] });
    expect(v.bars.some(x => x.batch === b.id && x.when === 'plan')).toBe(false);
    expect(v.moved).toContain(b.id);
    expect(v.was.some(x => x.batch === b.id)).toBe(true);
    expect(v.gone).toEqual([]);
    const row = v.jobs.rows.find(r => r.id === b.id)!;
    expect(row.status).toBe(b.status);
    expect(row.expect).toBeUndefined();
    const draft = forecast(db, s, [], [], [b.id]);
    for (const c of cancelsOf([b.id])) apply(db, s, c);
    expect(s.batches[b.id].status).toBe('cancelled');
    expect(forecast(db, s).bars).toEqual(draft.bars);
  });

  test('начатое задание в черновике отмен — «ушло»: прогон его не трогает', () => {
    const s = at(40);
    const b = Object.values(s.batches).find(x => x.status === 'process')!;
    const v = ganttView(db, s, { view: 'gantt', from: s.t - DAY, to: s.t + 7 * DAY, drop: [b.id] });
    expect(v.gone).toEqual([b.id]);
    expect(forecast(db, s, [], [], [b.id]).bars).toEqual(forecast(db, s).bars);
  });
});
