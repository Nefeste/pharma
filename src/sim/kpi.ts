// Окно «Показатели» (Б5ж; docs/specs/2026-10-vertical-slice.md, «Б5ж»; геймдизайн, §8.6): вкладки — директор и четыре
// поста, взятые места первыми; строка — руководитель и его показатели: число нынешнего месяца, прошлый месяц, 12
// закрытых месяцев, лучше или хуже по направлению, противовес. «Почему?» — записи, из которых число: серии, заказы,
// отклонения, пробы, партии, отказы, люди — со ссылкой на их карточку. Нынешний месяц считает та же функция движка, что
// пишет итог месяца в полночь на 1-е (src/engine/kpi.ts). Только записи завода: полей истины здесь нет.
import type { ContentDb, Id, SeatId } from '../content/types';
import { SEATS } from '../content/types';
import { batchNo } from '../engine/batchno';
import { DAY, momentOf } from '../engine/core/calendar';
import { HEAD_SEAT } from '../engine/journal';
import {
  assessTimes,
  cleanBatch,
  cpkOf,
  CPK_MIN,
  currentPeriod,
  decidedAt,
  dockTimes,
  failuresOf,
  incomingTimes,
  KPI,
  type KpiCtx,
  type KpiDef,
  kpiCtx,
  type KpiHead,
  type KpiUnit,
  KPIS,
  kpiValues,
  monthPeriod,
  monthStart,
  oeeOf,
  otifLines,
  p90,
  releaseTimes,
  repeats,
  sampleTimes,
  vacancyDays,
} from '../engine/kpi';
import { P_ONE } from '../engine/core/rng';
import { planOf } from '../engine/plant';
import type { Deviation, PlantState } from '../engine/types';
import type { Thing } from './views';

export interface KpiQuery {
  view: 'kpi';
  tab: SeatId;
  /** показатель, у которого открыт «Почему?» */
  why?: string;
  /** закрытый месяц — мгновение его начала; нет — нынешний месяц */
  month?: number;
}

/** Месяц: год, месяц; учёт начался не 1-го числа — «неполный». */
export interface KpiMonthRef {
  y: number;
  m: number;
  part?: true;
}

/**
 * Показатель в строке: определение (единица, направление, окно, источники, противовес); число нынешнего месяца, прошлого
 * закрытого и 12 закрытых по порядку, старые первыми (`null` — посчитать было не из чего); лучше (1) или хуже (−1)
 * прошлого месяца по направлению, так же — 0 (у суммы месяца — в сутки); подробности — множители OEE, 90-й процентиль
 * и сколько записей, пик; есть ли «Почему?».
 */
export interface KpiCell {
  id: string;
  unit: KpiUnit;
  dir: 1 | -1;
  win: 'm' | 'y';
  src: readonly string[];
  pair?: string;
  acc?: true;
  now?: number;
  prev?: number;
  hist: (number | null)[];
  trend?: 1 | -1 | 0;
  more?: Record<string, number>;
  why: boolean;
}

export interface KpiHeadRow {
  head: KpiHead;
  cells: KpiCell[];
}

/** Запись «Почему?»: серия, заказ, отклонение, партия, отказ, человек или показатель МОК — со ссылкой, где она есть. */
export type KpiWhyRow =
  | { k: 'batch'; batch: number; code: string; sec?: number; devs?: number; rejected?: true }
  | { k: 'order'; order: number; customer: Id; due: number; status: 'shipped' | 'short' | 'late'; missing: number }
  | { k: 'dev'; n: number; kind: Deviation['kind']; opened: number; sec?: number; prev?: number }
  | { k: 'lot'; code: [number, number, number]; material: Id; sec?: number; unit?: number; rejected?: true }
  | { k: 'fail'; thing?: Thing; type?: Id; part: string; t: number; sec?: number; spare?: true }
  | { k: 'person'; role: Id; tab: number; person?: number; day?: number; days?: number }
  | { k: 'cpk'; recipe: Id; test: Id; cpk: number; n: number };

export interface KpiView {
  view: 'kpi';
  tab: SeatId;
  /** вкладки: взятые места первыми, потом остальные по порядку */
  tabs: SeatId[];
  /**
   * месяц окна и с какого мгновения его учёт: нынешний или закрытый (`closed`); закрытые месяцы истории, до него
   * включительно, — старые первыми, не больше 12; соседние месяцы — начало закрытого до него и после него, `null` — после
   * него нынешний
   */
  month: KpiMonthRef & { from: number; closed?: true };
  older?: number;
  newer?: number | null;
  months: (KpiMonthRef & { from: number })[];
  rows: KpiHeadRow[];
  /** «Почему?» показателя: первые `WHY_MAX` записей, всего — если их больше */
  why?: { id: string; rows: KpiWhyRow[]; all?: number };
}

/** Месяцев в истории строки. */
export const HIST = 12;

/** Записей «Почему?» — не больше. */
export const WHY_MAX = 30;

/** Показатели, у которых есть «Почему?». */
export const WHY: ReadonlySet<string> = new Set(['otif', 'otifOrders', 'rft', 'lar', 'testTime', 'incoming', 'assess', 'release', 'devs', 'repeat', 'mtbf', 'mttr', 'spares', 'dockToStock', 'matWait', 'cpk', 'turnover', 'vacancy', 'onDay', 'supRej']);

/** Руководители вкладки: у поста — его отделы (журнал решений, Б5а), у директора — он сам и отдел кадров. */
export function headsOf(tab: SeatId): KpiHead[] {
  const heads = (Object.keys(HEAD_SEAT) as (keyof typeof HEAD_SEAT)[]).filter(h => HEAD_SEAT[h] === tab);
  return tab === 'director' ? ['dir', ...heads] : heads;
}

/** Показатели руководителя по порядку: свои и те, что он видит в строке, как директор — OTIF и «верно с первого раза». */
export const cellsOf = (head: KpiHead) => KPIS.filter(k => k.head === head || k.also?.includes(head));

const num = (id: string) => Number(id.slice(1));
const num2 = (id: string) => Number(id.replace(/^[A-Z]+/, ''));

/** Машина журнала оборудования: вещь на полу — машина линии или оборудование — и её вид по плану. */
function machineOf(db: ContentDb, s: PlantState, machine: string): { thing?: Thing; type?: Id } {
  const plan = planOf(db, s.plant);
  for (const [li, l] of plan.plant.lines.entries()) {
    const k = l.machines.findIndex(m => m.id === machine);
    if (k >= 0) return { thing: { kind: 'machine', line: li, k }, type: l.machines[k].type };
  }
  const i = plan.plant.equipment.findIndex(e => e.id === machine);
  return i >= 0 ? { thing: { kind: 'equipment', i }, type: plan.plant.equipment[i].type } : {};
}

/** Первая паллета партии на полу — для ссылки на её карточку. */
function unitOf(s: PlantState, lot: string): number | undefined {
  let best: number | undefined;
  for (const c of Object.values(s.containers)) if (c.lot === lot && s.units[c.unit] && (best === undefined || num(c.unit) < best)) best = num(c.unit);
  return best;
}

/** Самые долгие 10 % — не короче 90-го процентиля, хотя бы одна запись; по убыванию. */
function slowest<T extends { sec: number }>(a: T[]): T[] {
  const p = p90(a.map(x => x.sec));
  return p === undefined ? [] : a.filter(x => x.sec >= p).sort((x, y) => y.sec - x.sec);
}

const lotRow = (s: PlantState, lot: string, sec?: number): KpiWhyRow => {
  const l = s.lots[lot];
  const u = unitOf(s, lot);
  return { k: 'lot', code: [l.code.y, l.code.m, l.code.n], material: l.material, ...(sec !== undefined ? { sec } : {}), ...(u !== undefined ? { unit: u } : {}), ...(l.status === 'rejected' ? { rejected: true as const } : {}) };
};

const devRow = (s: PlantState, id: string, sec?: number, prev?: string): KpiWhyRow => {
  const d = s.deviations[id];
  return { k: 'dev', n: num2(d.id), kind: d.kind, opened: d.opened, ...(sec !== undefined ? { sec } : {}), ...(prev ? { prev: num2(prev) } : {}) };
};

const batchRow = (s: PlantState, id: string, sec?: number): KpiWhyRow => {
  const b = s.batches[id];
  const devs = Object.values(s.deviations).filter(d => d.batch === b.id || (d.lot !== undefined && (d.lot === b.bulk || d.lot === b.pack?.fg))).length;
  return { k: 'batch', batch: num(b.id), code: batchNo(b.code), ...(sec !== undefined ? { sec } : {}), ...(devs > 0 ? { devs } : {}), ...(b.status === 'rejected' ? { rejected: true as const } : {}) };
};

function personRow(s: PlantState, id: string, extra: { day?: number; days?: number }): KpiWhyRow {
  const p = s.people[id] ?? s.former[id];
  return { k: 'person', role: p.role, tab: p.tab, ...(s.people[id] ? { person: num(id) } : {}), ...extra };
}

/** Записи «Почему?» показателя `id` за период — те, из которых число и которые его портят. */
export function whyRows(db: ContentDb, s: PlantState, c: KpiCtx, id: string): KpiWhyRow[] {
  const p = c.p;
  const inP = (t: number | undefined) => t !== undefined && t >= p.from && t < p.to;
  switch (id) {
    case 'otif':
    case 'otifOrders': {
      const bad = new Set(otifLines(c).filter(x => !x.ok).map(x => x.order));
      return [...bad]
        .map(o => s.orders[o])
        .sort((a, b) => a.due - b.due)
        .map(o => ({ k: 'order' as const, order: num(o.id), customer: o.customer, due: o.due, status: o.status as 'shipped' | 'short' | 'late', missing: o.lines.reduce((n, l) => n + Math.max(0, l.cases - l.shipped), 0) }));
    }
    case 'rft':
      return Object.values(s.batches)
        .filter(b => b.status === 'released' && inP(b.released) && !cleanBatch(s, b))
        .map(b => batchRow(s, b.id));
    case 'lar':
      return Object.values(s.batches)
        .filter(b => b.status === 'rejected' && inP(decidedAt(s, b)))
        .map(b => batchRow(s, b.id));
    case 'onDay': {
      const day = (t: number) => momentOf(s.start, t).day;
      return Object.values(s.batches)
        .filter(b => inP(b.records[0]?.start) && day(b.records[0].start) > day(b.notBefore))
        .map(b => batchRow(s, b.id, b.records[0].start - b.notBefore));
    }
    case 'release':
      return slowest(releaseTimes(c)).map(x => batchRow(s, x.batch, x.sec));
    case 'matWait':
      return Object.values(s.batches)
        .filter(b => (b.spent.materials ?? 0) > 0 && (inP(b.records[0]?.start) || (b.phase === 'materials' && b.records.length === 0)))
        .map(b => batchRow(s, b.id, b.spent.materials));
    case 'testTime':
      return slowest(sampleTimes(c)).map(x => lotRow(s, s.samples[x.sample].lot, x.sec));
    case 'incoming':
      return slowest(incomingTimes(c)).map(x => lotRow(s, x.lot, x.sec));
    case 'dockToStock':
      return slowest(dockTimes(c)).map(x => lotRow(s, x.lot, x.sec));
    case 'supRej':
      return Object.values(s.lots)
        .filter(l => l.status === 'rejected' && l.batch === undefined && l.supplier !== 'start' && l.since !== undefined && l.since >= p.yFrom && l.since < p.to)
        .map(l => lotRow(s, l.id));
    case 'assess':
      return slowest(assessTimes(c)).map(x => devRow(s, x.dev, x.sec));
    case 'devs':
      return Object.values(s.deviations)
        .filter(d => d.opened >= p.yFrom && d.opened < p.to)
        .sort((a, b) => b.opened - a.opened)
        .map(d => devRow(s, d.id));
    case 'repeat':
      return repeats(c)
        .filter(x => x.prev)
        .reverse()
        .map(x => devRow(s, x.dev, undefined, x.prev));
    case 'mtbf':
    case 'mttr':
      return failuresOf(s, p.yFrom, p.to)
        .reverse()
        .map(({ f, r }) => ({ k: 'fail' as const, ...machineOf(db, s, f.machine), part: f.part, t: f.t, ...(r ? { sec: r.t - f.t } : {}), ...(r?.spare ? { spare: true as const } : {}) }));
    case 'spares':
      return s.maintLog
        .filter(e => e.what === 'repair' && e.spare && e.t >= p.yFrom && e.t < p.to)
        .reverse()
        .map(e => ({ k: 'fail' as const, ...machineOf(db, s, e.machine), part: e.part, t: e.t, spare: true as const }));
    case 'cpk':
      return cpkOf(c)
        .filter(x => x.cpk < CPK_MIN)
        .sort((a, b) => a.cpk - b.cpk)
        .map(x => ({ k: 'cpk' as const, recipe: x.recipe, test: x.test, cpk: x.cpk, n: x.n }));
    case 'turnover':
      return Object.values(s.former)
        .filter(x => x.quit !== undefined && x.quit.last >= c.y0 && x.quit.last < c.d1)
        .sort((a, b) => b.quit!.last - a.quit!.last)
        .map(x => personRow(s, x.id, { day: x.quit!.last }));
    case 'vacancy':
      return vacancyDays(c)
        .sort((a, b) => b.days - a.days)
        .map(x => personRow(s, x.person, { day: (s.people[x.person] ?? s.former[x.person]).hired, days: x.days }));
  }
  return [];
}

/** Подробности показателя за период: множители OEE, у длительностей — 90-й процентиль и сколько, у занятости — пик. */
function moreOf(db: ContentDb, s: PlantState, c: KpiCtx, id: string): Record<string, number> | undefined {
  const times = (a: { sec: number }[]) => (a.length > 0 ? { p90: p90(a.map(x => x.sec))!, n: a.length } : undefined);
  switch (id) {
    case 'oee': {
      const o = oeeOf(db, s, c.days).find(x => x !== undefined);
      return o ? { a: o.a, p: o.p, q: o.q } : undefined;
    }
    case 'testTime':
      return times(sampleTimes(c));
    case 'incoming':
      return times(incomingTimes(c));
    case 'assess':
      return times(assessTimes(c));
    case 'release':
      return times(releaseTimes(c));
    case 'dockToStock':
      return times(dockTimes(c));
    case 'occupancy':
      return c.p.snap.n > 0 && c.p.snap.places > 0 ? { peak: Math.round((c.p.snap.peak * c.p.snap.n * 10000) / c.p.snap.places) } : undefined;
    case 'mtbf':
    case 'mttr':
      return { n: failuresOf(s, c.p.yFrom, c.p.to).length };
    case 'otif': {
      const l = otifLines(c);
      return { n: l.length, bad: l.filter(x => !x.ok).length };
    }
    case 'cpk':
      return { n: cpkOf(c).length };
  }
  return undefined;
}

/**
 * Сдвиг, который окно ещё показывает, в единицах показателя: половина последнего знака числа — рубль, десятая процента,
 * часа, суток, случая на 1000 и кВт·ч. Меньше — «так же»: на экране числа равны.
 */
export const SAME: Readonly<Record<KpiUnit, number>> = { kop: 50, share: 5, sec: 180, day: 5, per: 5, wh: 50 };

/** Лучше (1), хуже (−1) или так же (0) — по знаку изменения, направлению показателя и сдвигу, который видно. */
const trendOf = (delta: number, k: Pick<KpiDef, 'dir' | 'unit'>) => (Math.abs(delta) < SAME[k.unit] ? 0 : (Math.sign(delta * k.dir) as 1 | -1 | 0));

// ---------------------------------------------------------------- итоги месяца

/** Строка «Итогов месяца»: показатель, его число закрытого месяца и месяца до него; противовес — так же, если посчитан. */
export interface CloseRow {
  id: string;
  unit: KpiUnit;
  dir: 1 | -1;
  v: number;
  was: number;
  trend: 1 | -1 | 0;
  pair?: { id: string; unit: KpiUnit; v?: number; was?: number };
}

/**
 * «Итоги месяца» (Б5ж) — раздел первой планёрки месяца: закрытый месяц; у каждого руководителя — показатели, сдвинувшиеся
 * сильнее всего против месяца до него, с противовесом; месяц первый — сравнивать не с чем.
 */
export interface MonthClose {
  y: number;
  m: number;
  /** начало закрытого месяца — окно «Показатели» открывается на нём */
  from: number;
  part?: true;
  first?: true;
  heads: { head: KpiHead; rows: CloseRow[] }[];
}

/** Сдвиг заметный — не меньше такой доли большего из двух чисел, 1/10 000. */
export const CLOSE_MIN = 500;

/** Показателей у руководителя в «Итогах месяца» — не больше. */
export const CLOSE_MAX = 2;

/** Сдвиг показателя — доля большего по модулю из двух чисел, 1/10 000: у сумм и долей одна мера. */
function moved(v: number, was: number): number {
  const m = Math.max(Math.abs(v), Math.abs(was));
  return m === 0 ? 0 : Math.round((Math.abs(v - was) * P_ONE) / m);
}

/**
 * «Итоги месяца» планёрки в мгновение `at`: первая планёрка после закрытия месяца — в первые сутки после полуночи на 1-е;
 * иначе — нет. Свои показатели руководителя: показатель, который он видит в строке как директор, — у своего руководителя;
 * руководители взятых мест — первыми.
 */
export function monthClose(s: PlantState, at: number): MonthClose | undefined {
  const months = s.kpi.months;
  const last = months.at(-1);
  if (!last || at < last.to || at >= last.to + DAY || monthStart(s, at) !== last.to) return undefined;
  const head = { y: last.y, m: last.m, from: last.from, ...(last.part ? { part: true as const } : {}) };
  const before = months.at(-2);
  if (!before) return { ...head, first: true, heads: [] };
  // руководители взятых мест — первыми, как вкладки окна
  const held = (s.seats ?? []).filter(x => x.to === undefined).map(x => x.seat);
  const seats = [...SEATS.filter(x => held.includes(x)), ...SEATS.filter(x => !held.includes(x))];
  const heads = seats.flatMap(headsOf).flatMap(h => {
    const rows = KPIS.filter(k => k.head === h)
      .flatMap(k => {
        const v = last.v[k.id];
        const was = before.v[k.id];
        if (v === undefined || was === undefined) return [];
        const score = moved(v, was);
        return score >= CLOSE_MIN ? [{ k, v, was, score }] : [];
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, CLOSE_MAX)
      .map(({ k, v, was }): CloseRow => {
        const pk = k.pair ? KPI[k.pair] : undefined;
        const pv = pk ? last.v[pk.id] : undefined;
        const pw = pk ? before.v[pk.id] : undefined;
        return {
          id: k.id,
          unit: k.unit,
          dir: k.dir,
          v,
          was,
          trend: trendOf(v - was, k),
          ...(pk ? { pair: { id: pk.id, unit: pk.unit, ...(pv !== undefined ? { v: pv } : {}), ...(pw !== undefined ? { was: pw } : {}) } } : {}),
        };
      });
    return rows.length > 0 ? [{ head: h, rows }] : [];
  });
  return { ...head, heads };
}

/**
 * Окно «Показатели»: вкладка, её руководители и показатели нынешнего месяца или выбранного закрытого; «Почему?» — у одного
 * показателя по запросу, записи того же периода.
 */
export function kpiView(db: ContentDb, s: PlantState, q: KpiQuery): KpiView {
  const held = (s.seats ?? []).filter(x => x.to === undefined).map(x => x.seat);
  const tabs = [...SEATS.filter(x => held.includes(x)), ...SEATS.filter(x => !held.includes(x))];
  const all = s.kpi.months;
  // выбран закрытый месяц — его итог, как его записал движок, и записи его периода; нет — нынешний месяц по сейчас
  const at = q.month !== undefined ? all.findIndex(m => m.from === q.month) : -1;
  const sel = at >= 0 ? all[at] : undefined;
  const p = sel ? monthPeriod(s, sel) : currentPeriod(db, s);
  const c = kpiCtx(db, s, p);
  const now = sel ? sel.v : kpiValues(db, s, p);
  const upto = sel ? at + 1 : all.length;
  const months = all.slice(Math.max(0, upto - HIST), upto);
  const last = sel ? all[at - 1] : months.at(-1);
  const d = momentOf(s.start, p.from).date;
  const part = sel ? !!sel.part : d.d !== 1;
  const rows: KpiHeadRow[] = headsOf(q.tab).map(head => ({
    head,
    cells: cellsOf(head).map(k => {
      const v = now[k.id];
      const prev = last?.v[k.id];
      const hist: (number | null)[] = [...Array(HIST - months.length).fill(null), ...months.map(m => m.v[k.id] ?? null)];
      const more = moreOf(db, s, c, k.id);
      return {
        id: k.id,
        unit: k.unit,
        dir: k.dir,
        win: k.win,
        src: k.src,
        ...(k.pair ? { pair: k.pair } : {}),
        ...(k.acc ? { acc: true as const } : {}),
        ...(v !== undefined ? { now: v } : {}),
        ...(prev !== undefined ? { prev } : {}),
        hist,
        // сумма месяца — к длине прошлого: неполный месяц сравнивается с полным в сутки
        ...(v !== undefined && prev !== undefined && last ? { trend: trendOf((k.acc ? (v * (last.to - last.from)) / Math.max(1, p.to - p.from) : v) - prev, k) } : {}),
        ...(more ? { more } : {}),
        why: WHY.has(k.id),
      };
    }),
  }));
  const list = q.why && KPI[q.why] && WHY.has(q.why) ? whyRows(db, s, c, q.why) : undefined;
  const why = q.why && list ? { id: q.why, rows: list.slice(0, WHY_MAX), ...(list.length > WHY_MAX ? { all: list.length } : {}) } : undefined;
  const older = (sel ? all[at - 1] : all.at(-1))?.from;
  return {
    view: 'kpi',
    tab: q.tab,
    tabs,
    month: { y: d.y, m: d.m, from: p.from, ...(part ? { part: true as const } : {}), ...(sel ? { closed: true as const } : {}) },
    ...(older !== undefined ? { older } : {}),
    ...(sel ? { newer: all[at + 1]?.from ?? null } : {}),
    months: months.map(m => ({ y: m.y, m: m.m, from: m.from, ...(m.part ? { part: true as const } : {}) })),
    rows,
    ...(why ? { why } : {}),
  };
}
