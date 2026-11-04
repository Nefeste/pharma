// Задания на серию для окна (Б6а; docs/specs/2026-10-vertical-slice.md, «Б6а»): строка на задание — номер, позиция, под
// что, срок, «не раньше», состояние, ожидаемый выпуск и опоздание к сроку; заказы покупателей, которым к сроку не хватит
// ГП. Ожидаемый выпуск — конец последней стадии по прогону расписания (у прошедших стадии — по досье) и от балка до
// выпуска — медиана выпущенных за 90 суток по их записям; в оборот — ещё медиана от выпуска до оборота. Всё — записи
// завода и прогон расписания, истины нет.
import type { ContentDb, Id } from '../content/types';
import { batchNo } from '../engine/batchno';
import { DAY, momentOf } from '../engine/core/calendar';
import type { Forecast } from '../engine/plan/schedule';
import { casesOf } from '../engine/planner';
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
  /** с чего начинаются его полосы в расписании: прогон расписания, а прошли — досье; ни того ни другого — «не раньше» */
  at: number;
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
/** доли — 1/10 000, как у остаточного срока заказа */
const P = 10000;

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
  const first = new Map<string, number>();
  for (const x of f.bars) if (x.batch && x.from < (first.get(x.batch) ?? Number.MAX_SAFE_INTEGER)) first.set(x.batch, x.from);
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
      at: b.records.length > 0 ? Math.min(...b.records.map(r => r.start)) : (first.get(b.id) ?? b.notBefore),
    });
  }
  // по сроку, без срока — после; дальше — по «не раньше» и номеру
  rows.sort((a, c) => (a.due ?? Number.MAX_SAFE_INTEGER) - (c.due ?? Number.MAX_SAFE_INTEGER) || a.notBefore - c.notBefore || a.n - c.n);
  return { rows, uncovered: uncoveredOf(db, s, all, expectOf, pub ?? 0), ...(tail !== undefined ? { tail } : {}), ...(pub !== undefined ? { pub } : {}) };
}

/**
 * Заказы без покрытия: открытые заказы по сроку берут ГП позиции — сначала свободные ящики разрешённых партий в обороте
 * (FEFO), потом разрешённых, которые выйдут в оборот через медиану от выпуска до оборота, потом ГП заданий, которая по
 * прогону расписания выйдет в оборот к их сроку, раньше вышедшая — раньше. Ящики, зарезервированные под заказы, не
 * свободны; партия с остаточным сроком годности к сроку заказа меньше того, что просит покупатель, ему не идёт — как у
 * правила «заказ под угрозой» (`orderRisks`, market.ts). Не хватило — строка с тем, сколько не хватит.
 */
function uncoveredOf(db: ContentDb, s: PlantState, all: Batch[], expectOf: (b: Batch) => number | undefined, pub: number): UncoveredRow[] {
  const free = new Map<string, number>();
  for (const c of Object.values(s.containers)) if (!c.reserved) free.set(c.lot, (free.get(c.lot) ?? 0) + 1);
  const out: UncoveredRow[] = [];
  const open = Object.values(s.orders)
    .filter(o => o.status === 'open')
    .sort((a, c) => a.due - c.due || num(a.id) - num(c.id));
  for (const [sku, k] of Object.entries(db.skus)) {
    if (!open.some(o => o.lines.some(l => l.sku === sku))) continue;
    // срок годности целиком, сутки — как у распределения (market.ts)
    const full = Math.floor((db.materials[k.fg].shelf * 36525) / 1200);
    const supply: { at: number; cases: number; expiry?: number }[] = [];
    for (const l of Object.values(s.lots)) {
      if (l.material !== k.fg || l.status !== 'released' || !free.get(l.id)) continue;
      supply.push({ at: l.circulation !== undefined ? s.t : Math.max(s.t, (l.since ?? s.t) + pub), cases: free.get(l.id)!, expiry: l.expiry });
    }
    for (const b of all) {
      if (b.sku !== sku || b.status === 'released' || b.status === 'rejected' || b.status === 'cancelled') continue;
      const e = expectOf(b);
      if (e !== undefined) supply.push({ at: e + pub, cases: casesOf(db.recipes[b.recipe], k) });
    }
    supply.sort((a, c) => a.at - c.at || (a.expiry ?? Number.MAX_SAFE_INTEGER) - (c.expiry ?? Number.MAX_SAFE_INTEGER));
    for (const o of open) {
      const day = momentOf(s.start, o.due).day;
      for (const l of o.lines) {
        if (l.sku !== sku) continue;
        let need = l.cases - l.reserved;
        if (need <= 0) continue;
        for (const x of supply) {
          if (need === 0) break;
          if (x.cases === 0 || x.at > o.due || (x.expiry !== undefined && (x.expiry - day) * P < o.minShelf * full)) continue;
          const take = Math.min(need, x.cases);
          x.cases -= take;
          need -= take;
        }
        if (need > 0) out.push({ order: o.id, customer: o.customer, due: o.due, sku, cases: l.cases - l.shipped, short: need });
      }
    }
  }
  return out.sort((a, c) => a.due - c.due || num(a.order) - num(c.order) || a.sku.localeCompare(c.sku));
}
