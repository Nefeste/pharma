// Задания на серию для окна (Б6а; docs/specs/2026-10-vertical-slice.md, «Б6а»): строка на задание — номер, позиция, под
// что, срок, «не раньше», состояние, ожидаемый выпуск и опоздание к сроку; заказы покупателей, которым к сроку не хватит
// ГП. Ожидаемый выпуск — конец последней стадии по прогону расписания (у прошедших стадии — по досье) и от балка до
// выпуска — медиана выпущенных за 90 суток по их записям; в оборот — ещё медиана от выпуска до оборота. Всё — записи
// завода и прогон расписания, истины нет.
import type { ContentDb, Id } from '../content/types';
import { batchNo } from '../engine/batchno';
import { DAY } from '../engine/core/calendar';
import type { Forecast } from '../engine/plan/schedule';
import { casesOf } from '../engine/planner';
import { containersByLot } from '../engine/stock';
import type { Batch, BatchStatus, PlantState } from '../engine/types';

/** Сколько суток после выпуска или отмены задание ещё в списке; за сколько суток выпущенные дают медиану. */
export const JOBS_KEEP = 7;
export const TAIL_DAYS = 90;

export interface JobRow {
  id: string;
  n: number;
  /** номер серии, если досье выдано */
  code?: string;
  recipe: Id;
  sku?: Id;
  /** под что: запас позиции или заказ покупателя — его покупатель */
  goal?: { kind: 'stock' } | { kind: 'order'; order: string; customer?: Id };
  due?: number;
  notBefore: number;
  status: BatchStatus;
  /** ждёт материала — какого; на стадии — какой */
  material?: Id;
  stage?: Id;
  /** ожидаемый выпуск; у выпущенной — когда выпущена */
  expect?: number;
  /** в оборот к сроку опоздает на столько секунд */
  late?: number;
  /** когда отменено */
  cancelled?: number;
  /** до комплектовки: отменить можно */
  open: boolean;
}

/** Заказ покупателя, у строки которого к сроку не хватит ящиков. */
export interface UncoveredRow {
  order: string;
  customer: Id;
  due: number;
  sku: Id;
  /** заказано и ещё не отгружено */
  cases: number;
  /** не хватит */
  short: number;
}

export interface Jobs {
  rows: JobRow[];
  uncovered: UncoveredRow[];
  /** медианы по записям: от балка до выпуска и от выпуска до оборота; нет выпущенных — нет */
  tail?: number;
  pub?: number;
}

const num = (id: string) => Number(id.slice(1));

/** Медиана целых (нижняя из двух средних); пусто — нет. */
function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor((a.length - 1) / 2)];
}

/** Конец последней стадии по досье; стадий не было — нет. */
const bulkEnd = (b: Batch) => (b.records.length > 0 ? Math.max(...b.records.map(r => r.end)) : undefined);

/** Конец последней стадии серии по прогону расписания: полоса последней стадии карты; её нет — нет. */
function plannedEnd(db: ContentDb, f: Forecast, b: Batch): number | undefined {
  const last = db.recipes[b.recipe].stages.at(-1)?.id;
  let end: number | undefined;
  for (const x of f.bars) if (x.batch === b.id && x.kind === 'stage' && x.stage === last) end = Math.max(end ?? 0, x.to);
  return end;
}

/** Задания окна и заказы без покрытия — по прогону расписания `f` (с черновиком, если он есть). */
export function jobsOf(db: ContentDb, s: PlantState, f: Forecast): Jobs {
  const all = Object.values(s.batches);
  const recent = all.filter(b => b.status === 'released' && b.released !== undefined && b.released >= s.t - TAIL_DAYS * DAY);
  const tail = median(recent.flatMap(b => (bulkEnd(b) !== undefined ? [b.released! - bulkEnd(b)!] : [])));
  const pub = median(recent.flatMap(b => (b.pack?.fg && s.lots[b.pack.fg]?.circulation !== undefined ? [s.lots[b.pack.fg].circulation! - b.released!] : [])));
  const expectOf = (b: Batch): number | undefined => {
    if (b.status === 'released') return b.released;
    if (b.status === 'rejected' || b.status === 'cancelled' || tail === undefined) return undefined;
    const end = bulkEnd(b) !== undefined && b.stage >= db.recipes[b.recipe].stages.length ? bulkEnd(b) : plannedEnd(db, f, b);
    return end === undefined ? undefined : Math.max(s.t, end + tail);
  };
  const rows: JobRow[] = [];
  for (const b of all) {
    const old = (b.status === 'released' || b.status === 'rejected') && (b.released ?? b.phaseAt) < s.t - JOBS_KEEP * DAY;
    if (old || (b.status === 'cancelled' && (b.cancelled ?? 0) < s.t - JOBS_KEEP * DAY)) continue;
    const expect = expectOf(b);
    const circ = expect !== undefined && b.status !== 'released' ? expect + (pub ?? 0) : undefined;
    const o = b.for?.kind === 'order' ? s.orders[b.for.order] : undefined;
    const code = b.code.n > 0 ? batchNo(b.code) : '';
    rows.push({
      id: b.id,
      n: num(b.id),
      ...(code ? { code } : {}),
      recipe: b.recipe,
      ...(b.sku ? { sku: b.sku } : {}),
      ...(b.for ? { goal: b.for.kind === 'order' ? { kind: 'order' as const, order: b.for.order, ...(o ? { customer: o.customer } : {}) } : { kind: 'stock' as const } } : {}),
      ...(b.due !== undefined ? { due: b.due } : {}),
      notBefore: b.notBefore,
      status: b.status,
      ...(b.status === 'waiting' && b.short?.[0] ? { material: b.short[0].material } : {}),
      ...(b.status === 'process' ? { stage: db.recipes[b.recipe].stages[b.stage]?.id } : {}),
      ...(expect !== undefined ? { expect } : {}),
      ...(b.due !== undefined && circ !== undefined && circ > b.due ? { late: circ - b.due } : {}),
      ...(b.cancelled !== undefined ? { cancelled: b.cancelled } : {}),
      open: b.status === 'waiting' || b.status === 'reserved',
    });
  }
  // по сроку, без срока — после; дальше — по «не раньше» и номеру
  rows.sort((a, c) => (a.due ?? Number.MAX_SAFE_INTEGER) - (c.due ?? Number.MAX_SAFE_INTEGER) || a.notBefore - c.notBefore || a.n - c.n);
  return { rows, uncovered: uncoveredOf(db, s, all, expectOf, pub ?? 0), ...(tail !== undefined ? { tail } : {}), ...(pub !== undefined ? { pub } : {}) };
}

/**
 * Заказы без покрытия: по каждой позиции открытые заказы по сроку берут свободную ГП сейчас — ящики выпущенных партий, —
 * потом ГП заданий, которая по прогону расписания выйдет в оборот к их сроку, раньше вышедшая — раньше. Не хватило —
 * строка с тем, сколько не хватит.
 */
function uncoveredOf(db: ContentDb, s: PlantState, all: Batch[], expectOf: (b: Batch) => number | undefined, pub: number): UncoveredRow[] {
  const byLot = containersByLot(s);
  const out: UncoveredRow[] = [];
  const open = Object.values(s.orders)
    .filter(o => o.status === 'open')
    .sort((a, c) => a.due - c.due || num(a.id) - num(c.id));
  for (const [sku, k] of Object.entries(db.skus)) {
    let stock = 0;
    for (const l of Object.values(s.lots)) if (l.material === k.fg && l.status === 'released') stock += byLot.get(l.id)?.length ?? 0;
    const supply = all
      .filter(b => b.sku === sku && b.status !== 'released' && b.status !== 'rejected' && b.status !== 'cancelled')
      .flatMap(b => {
        const e = expectOf(b);
        return e === undefined ? [] : [{ at: e + pub, cases: casesOf(db.recipes[b.recipe], k) }];
      })
      .sort((a, c) => a.at - c.at);
    let next = 0;
    for (const o of open) {
      for (const l of o.lines) {
        if (l.sku !== sku) continue;
        const need = l.cases - l.shipped;
        if (need <= 0) continue;
        while (stock < need && next < supply.length && supply[next].at <= o.due) stock += supply[next++].cases;
        const got = Math.min(stock, need);
        stock -= got;
        if (got < need) out.push({ order: o.id, customer: o.customer, due: o.due, sku, cases: need, short: need - got });
      }
    }
  }
  return out.sort((a, c) => a.due - c.due || a.order.localeCompare(c.order));
}
