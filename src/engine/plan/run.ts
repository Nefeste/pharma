// Прогон плана (docs/specs/2026-10-plan-run.md; docs/02-architecture.md, §11): тот же движок считает завод вперёд на
// горизонт на нескольких зёрнах — копия состояния, двойник без истины (twin.ts), команды варианта, ход времени, итог.
// Состояние не меняется. Два варианта на одном зерне видят одни и те же поломки и заказы: разница — только от плана.
import type { ContentDb, Id } from '../../content/types';
import { DAY, momentOf } from '../core/calendar';
import { P_ONE } from '../core/rng';
import { apply } from '../engine';
import { MODED, modeOf } from '../heads';
import { oee, type Switches, switchesOf } from '../lean';
import { planOf } from '../plant';
import type { Command, HeadsState, LineDay, PlantState } from '../types';
import { blind } from './twin';

export interface RunOpts {
  /** горизонт, сутки, и число зёрен */
  days: number;
  seeds: number;
  /** двойник без истины (в игре — всегда); без него зерно 0 — сам завод, как обычный ход времени (проверка движка) */
  twin?: boolean;
}

/** Итог одного зерна. */
export interface SeedOut {
  seed: number;
  /**
   * заказы покупателей со сроком в горизонте: отгружен в срок и полностью или нет; ящиков не хватило; был ли он к
   * снимку — заказы, которые покупатели сделают во время прогона, на каждом зерне свои
   */
  orders: { order: string; customer: Id; due: number; ok: boolean; missing: number; known: boolean }[];
  /** серии, ещё не решённые к снимку: когда балк, когда упакована, когда выпущена или отклонена — если в горизонте */
  batches: { batch: string; bulk?: number; packed?: number; released?: number; rejected?: true }[];
  cash: number;
  /** OEE линий за горизонт — ключевой машины, доли 1/10 000 */
  lines: { line: string; oee?: number }[];
  /** доля горизонта под стадиями — по помещениям, под упаковкой — по линиям, доли 1/10 000 */
  busy: { row: string; share: number }[];
  /** генеральные уборки помещений и переналадки линий, кончившиеся в горизонте (Б2г): сколько и их работа, с */
  switches: Switches;
}

/** Сутки линии за горизонт — суммой; OEE ключевой машины (с наименьшим выпуском по номиналу). */
function horizonOee(days: LineDay[]): number | undefined {
  if (days.length === 0) return undefined;
  const ideal = days[0].ideal.map((_, i) => days.reduce((n, d) => n + (d.ideal[i] ?? 0), 0));
  let key = 0;
  ideal.forEach((v, i) => {
    if (v < ideal[key]) key = i;
  });
  const o = oee(
    { ideal: ideal[key], run: days.reduce((n, d) => n + (d.run[key] ?? 0), 0), out: days.reduce((n, d) => n + (d.times[key]?.out ?? 0), 0) },
    days.reduce((n, d) => n + d.good, 0),
  );
  return o?.oee;
}

/** Доля отрезка [from, to) под отрезками `spans`, доли 1/10 000. */
function share(spans: [number, number][], from: number, to: number): number {
  let sum = 0;
  for (const [a, b] of spans) sum += Math.max(0, Math.min(b, to) - Math.max(a, from));
  return Math.floor((sum * P_ONE) / (to - from));
}

/**
 * Итог зерна на копии `c` после хода времени с `from` по `to`; `open` — серии, ещё не решённые к снимку; `known` — заказы
 * снимка; `before` — уборки и переналадки суток снимка до него: их в горизонт не считать.
 */
function measure(db: ContentDb, c: PlantState, from: number, to: number, seed: number, open: string[], known: Set<string>, before: Switches): SeedOut {
  const plan = planOf(db, c.plant);
  const orders = Object.values(c.orders)
    .filter(o => o.due >= from && o.due < to)
    .map(o => ({ order: o.id, customer: o.customer, due: o.due, ok: o.status === 'shipped', missing: o.lines.reduce((n, l) => n + l.cases - l.shipped, 0), known: known.has(o.id) }));
  const batches = open.map(id => {
    const b = c.batches[id];
    const last = b.records.length === db.recipes[b.recipe].stages.length ? b.records[b.records.length - 1].end : undefined;
    return {
      batch: id,
      ...(last !== undefined && last >= from ? { bulk: last } : {}),
      ...(b.pack?.end !== undefined && b.pack.end >= from ? { packed: b.pack.end } : {}),
      ...(b.released !== undefined && b.released >= from ? { released: b.released } : {}),
      ...(b.status === 'rejected' ? { rejected: true as const } : {}),
    };
  });
  const d0 = momentOf(c.start, from).day;
  const d1 = momentOf(c.start, to).day;
  const days = c.losses.filter(d => d.day >= d0 && d.day <= d1);
  const stageSpans = new Map<string, [number, number][]>();
  const packSpans = new Map<string, [number, number][]>();
  for (const b of Object.values(c.batches)) {
    for (const r of b.records) stageSpans.set(r.room, [...(stageSpans.get(r.room) ?? []), [r.start, r.end]]);
    if (b.pack?.start !== undefined) packSpans.set(b.pack.line, [...(packSpans.get(b.pack.line) ?? []), [b.pack.start, b.pack.end ?? to]]);
  }
  const rooms = new Set(Object.values(db.recipes).flatMap(r => r.stages.map(st => plan.roomOf[st.room])));
  const all = switchesOf(days);
  return {
    seed,
    orders,
    batches,
    cash: c.cash.balance,
    lines: plan.plant.lines.map(l => {
      const o = horizonOee(days.flatMap(d => (d.lines[l.id] ? [d.lines[l.id]] : [])));
      return { line: l.id, ...(o !== undefined ? { oee: o } : {}) };
    }),
    busy: [
      ...plan.plant.rooms.filter(r => rooms.has(r.id)).map(r => ({ row: r.id, share: share(stageSpans.get(r.id) ?? [], from, to) })),
      ...plan.plant.lines.map(l => ({ row: l.id, share: share(packSpans.get(l.id) ?? [], from, to) })),
    ],
    switches: { major: all.major - before.major, majorSec: all.majorSec - before.majorSec, changes: all.changes - before.changes, changeSec: all.changeSec - before.changeSec },
  };
}

/**
 * Режимы отделов копии (Б5б): «советует» — как «сам», прогон отвечает, что будет, если игрок принимает предложения;
 * «вручную» — как есть: без команд варианта отдел молчит. Предложений в копии нет.
 */
export function runHeads(s: PlantState): HeadsState {
  const mode: HeadsState['mode'] = { ...s.heads.mode };
  for (const h of MODED) if (modeOf(s, h) === 'advise') mode[h] = 'auto';
  return { mode, open: {}, no: {} };
}

/** Зерно `k` варианта: копия состояния, двойник (если не выключен), команды варианта по порядку, ход времени на горизонт. */
export function runSeed(db: ContentDb, s: PlantState, variant: Command[], o: RunOpts, k: number): PlantState {
  // копия — без журнала решений (Б5а) и закрытых месяцев показателей (Б5ж): будущему они не нужны, правила их не читают;
  // режимы отделов — «советует» как «сам» (Б5б)
  const c: PlantState = structuredClone({ ...s, journal: [], heads: runHeads(s), kpi: { ...s.kpi, months: [] } });
  if (o.twin !== false) blind(db, c, k);
  for (const cmd of variant) apply(db, c, cmd);
  apply(db, c, { kind: 'advance', seconds: o.days * DAY });
  return c;
}

/** Прогон варианта: итог каждого зерна. Состояние `s` не меняется. */
export function runPlan(db: ContentDb, s: PlantState, variant: Command[], o: RunOpts): SeedOut[] {
  const open = Object.values(s.batches)
    .filter(b => b.status !== 'released' && b.status !== 'rejected')
    .map(b => b.id);
  const known = new Set(Object.keys(s.orders));
  const day = momentOf(s.start, s.t).day;
  const before = switchesOf(s.losses.filter(d => d.day === day));
  const out: SeedOut[] = [];
  for (let k = 0; k < o.seeds; k++) {
    const c = runSeed(db, s, variant, o, k);
    const to = c.t;
    out.push(measure(db, c, to - o.days * DAY, to, k, open, known, before));
  }
  return out;
}

/** Наименьшее, медиана, наибольшее. */
export type Range = [number, number, number];

/** Наименьшее, медиана (нижняя из двух средних) и наибольшее; пусто — нет. */
export function range(xs: number[]): Range | undefined {
  if (xs.length === 0) return undefined;
  const v = [...xs].sort((a, b) => a - b);
  return [v[0], v[Math.floor((v.length - 1) / 2)], v[v.length - 1]];
}

/** Итог варианта по зёрнам. */
export interface RunSum {
  seeds: number;
  days: number;
  /** заказы снимка со сроком в горизонте: в скольких зёрнах сорвётся; по сроку */
  orders: { order: string; customer: Id; due: number; fails: number; missing: number }[];
  /** заказы, которые покупатели сделают во время прогона, со сроком в горизонте: сколько и сколько сорвётся — по зёрнам */
  later: { placed: Range; failed: Range };
  /** серии: балк, упаковка, выпуск — по зёрнам, где это случилось в горизонте, и в скольких зёрнах; отклонена — в скольких */
  batches: { batch: string; bulk?: Range; bulkIn: number; packed?: Range; released?: Range; releasedIn: number; rejected: number }[];
  cash: Range;
  lines: { line: string; oee?: Range }[];
  /** узкое место — строка с наибольшей медианой доли горизонта под работой */
  busy: { row: string; share: Range }[];
  /** генеральные уборки и переналадки в горизонте (Б2г): сколько и их работа, с, — по зёрнам */
  switches: Record<keyof Switches, Range>;
}

export function summarize(outs: SeedOut[], days: number): RunSum {
  const first = outs[0];
  // заказ снимка есть на каждом зерне: его срок в горизонте от зерна не зависит
  const orders = (first?.orders ?? [])
    .filter(x => x.known)
    .map(({ order, customer, due }) => {
      const rows = outs.map(o => o.orders.find(x => x.order === order)!);
      return { order, customer, due, fails: rows.filter(x => !x.ok).length, missing: Math.max(...rows.map(x => x.missing)) };
    })
    .sort((a, b) => a.due - b.due || Number(a.order.slice(1)) - Number(b.order.slice(1)));
  const later = {
    placed: range(outs.map(o => o.orders.filter(x => !x.known).length)) ?? [0, 0, 0],
    failed: range(outs.map(o => o.orders.filter(x => !x.known && !x.ok).length)) ?? [0, 0, 0],
  };
  const batches = (first?.batches ?? []).map(({ batch }) => {
    const rows = outs.map(o => o.batches.find(x => x.batch === batch)!);
    const bulk = rows.flatMap(x => (x.bulk !== undefined ? [x.bulk] : []));
    const packed = rows.flatMap(x => (x.packed !== undefined ? [x.packed] : []));
    const released = rows.flatMap(x => (x.released !== undefined ? [x.released] : []));
    const r = { bulk: range(bulk), packed: range(packed), released: range(released) };
    return {
      batch,
      ...(r.bulk ? { bulk: r.bulk } : {}),
      bulkIn: bulk.length,
      ...(r.packed ? { packed: r.packed } : {}),
      ...(r.released ? { released: r.released } : {}),
      releasedIn: released.length,
      rejected: rows.filter(x => x.rejected).length,
    };
  });
  return {
    seeds: outs.length,
    days,
    orders,
    later,
    batches,
    cash: range(outs.map(o => o.cash)) ?? [0, 0, 0],
    lines: (first?.lines ?? []).map(({ line }) => {
      const r = range(outs.flatMap(o => o.lines.filter(x => x.line === line && x.oee !== undefined).map(x => x.oee!)));
      return { line, ...(r ? { oee: r } : {}) };
    }),
    busy: (first?.busy ?? []).map(({ row }) => ({ row, share: range(outs.map(o => o.busy.find(x => x.row === row)!.share))! })),
    switches: {
      major: range(outs.map(o => o.switches.major)) ?? [0, 0, 0],
      majorSec: range(outs.map(o => o.switches.majorSec)) ?? [0, 0, 0],
      changes: range(outs.map(o => o.switches.changes)) ?? [0, 0, 0],
      changeSec: range(outs.map(o => o.switches.changeSec)) ?? [0, 0, 0],
    },
  };
}
