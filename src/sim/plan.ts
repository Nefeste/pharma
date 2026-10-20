// Расписание (docs/specs/2026-10-panels.md, 3д): Гант и призрак — виды для окна из прогона расписания движка
// (src/engine/plan/schedule.ts) и записей. Прошлое — как было: стадии серий из их записей, задания упаковки от взятия до
// конца, последняя уборка помещения — по его учёту. С части 5 — черновик (docs/specs/2026-10-plan-run.md): план — каким он
// станет, если черновик утвердить, а прежние полосы сдвинутых серий — рядом. Без истины: прогон и записи — сроки, учёт и
// задачи; истинных свойств и причин тут нет.
import type { ContentDb } from '../content/types';
import { batchNo } from '../engine/batchno';
import { HOUR } from '../engine/core/calendar';
import { cleanWork, MES } from '../engine/mes';
import { type Bar, type Change, forecast, type Why } from '../engine/plan/schedule';
import { planOf } from '../engine/plant';
import { shiftEndAt } from '../engine/staff';
import type { BatchStatus, PlantState } from '../engine/types';

export interface GanttQuery {
  view: 'gantt';
  /** окно времени, игровые секунды */
  from: number;
  to: number;
  /** черновик (часть 5): новые сроки «не раньше» заданий — ещё не команды */
  draft?: Change[];
}

export interface GhostQuery {
  view: 'ghost';
  batch: string;
  /** срок «не раньше», куда тянут */
  notBefore: number;
  /** черновик — призрак считает его вместе с тем, что тянут */
  draft?: Change[];
}

/** Строка Ганта: комплектовка у шлюза, помещение производства (тип — для названия), упаковочная линия. */
export interface GanttRow {
  id: string;
  kind: 'kit' | 'room' | 'line';
  type?: string;
}

/** Серия для подписи: номер серии строкой, если уже выдан (с комплектовки: короткий, со смешивания — полный), иначе — номер задания. */
export interface BatchLabel {
  code?: string;
  n: number;
  status: BatchStatus;
  notBefore: number;
}

export interface GanttView {
  view: 'gantt';
  from: number;
  to: number;
  now: number;
  rows: GanttRow[];
  /** полосы, которые задевают окно */
  bars: Bar[];
  batches: Record<string, BatchLabel>;
  why: Record<string, Why[]>;
  /** можно тянуть: задания, ещё не начавшие комплектовку, у которых есть полосы */
  movable: string[];
  /** задания без полос: не хватает материала, а заказа нет */
  stuck: string[];
  /** часы окна, когда аппаратчиков нет в смене */
  off: [number, number][];
  /** серии, чьи полосы по плану с черновиком встанут иначе, чем по утверждённому плану, и их прежние полосы в окне */
  moved: string[];
  was: Bar[];
  /** задания черновика, которые тянуть уже нельзя: начали комплектовку или их нет — окно убирает их из черновика */
  gone: string[];
}

export interface GhostView {
  view: 'ghost';
  batch: string;
  notBefore: number;
  /** полосы задания с новым сроком: комплектовка, стадии, уборки после них */
  bars: Bar[];
  why: Why[];
  /** другие серии, чьи полосы встанут иначе */
  moved: string[];
  batches: Record<string, BatchLabel>;
  /** тянуть нельзя: задания нет или комплектовка началась */
  refused?: 'noBatch' | 'started';
}

/** Строки: комплектовка; помещения плана, где идут стадии карт, — по порядку плана; линии плана. */
export function rowsOf(db: ContentDb, s: PlantState): GanttRow[] {
  const plan = planOf(db, s.plant);
  const used = new Set(Object.values(db.recipes).flatMap(r => r.stages.map(st => st.room)));
  return [
    { id: 'kit', kind: 'kit' },
    ...plan.plant.rooms.filter(r => used.has(r.type)).map((r): GanttRow => ({ id: r.id, kind: 'room', type: r.type })),
    ...plan.plant.lines.map((l): GanttRow => ({ id: l.id, kind: 'line' })),
  ];
}

/**
 * Прошлое: стадии из записей; задание упаковки — наладка от взятия линией до первой таблетки и упаковка до конца (идущее —
 * до сейчас); последняя уборка помещения — по его учёту: чисто или занято с `since`, генеральная — если чисто для любого
 * продукта. Раньше неё уборок учёт не хранит.
 */
export function pastBars(db: ContentDb, s: PlantState): Bar[] {
  const bars: Bar[] = [];
  for (const b of Object.values(s.batches)) {
    for (const r of b.records) bars.push({ row: r.room, kind: 'stage', batch: b.id, stage: r.stage, from: r.start, to: r.end, when: 'past' });
    const job = b.pack;
    if (job?.taken === undefined) continue;
    bars.push({ row: job.line, kind: 'setup', batch: b.id, from: job.taken, to: job.start ?? s.t, when: job.start !== undefined ? 'past' : 'now' });
    if (job.start !== undefined) bars.push({ row: job.line, kind: 'pack', batch: b.id, from: job.start, to: job.end ?? s.t, when: job.end !== undefined ? 'past' : 'now' });
  }
  for (const r of Object.values(s.rooms)) {
    if ((r.status !== 'clean' && r.status !== 'busy') || r.product === undefined) continue;
    const major = r.cleanFor === undefined;
    const work = cleanWork(db, s, r.id, major);
    bars.push({ row: r.id, kind: 'clean', from: r.since - work, to: r.since, when: 'past', ...(major ? { major: true as const } : {}) });
  }
  return bars;
}

/** Часы окна, когда ни у кого из аппаратчиков нет смены, — слитыми отрезками. */
export function offOf(db: ContentDb, s: PlantState, from: number, to: number): [number, number][] {
  const roles: readonly string[] = MES.operators;
  const shifts = [...new Set(Object.values(s.people).filter(p => roles.includes(p.role)).map(p => p.shift))];
  const out: [number, number][] = [];
  for (let t = Math.floor(from / HOUR) * HOUR; t < to; t += HOUR) {
    if (shifts.some(sh => shiftEndAt(db, s.start, sh, t) !== undefined)) continue;
    const last = out[out.length - 1];
    if (last && last[1] === t) last[1] = t + HOUR;
    else out.push([t, t + HOUR]);
  }
  return out;
}

/** Подписи серий, о которых говорят полосы и причины, — и серий в итоге прогона плана (planHost.ts). */
export function labels(s: PlantState, ids: Iterable<string>): Record<string, BatchLabel> {
  const out: Record<string, BatchLabel> = {};
  for (const id of ids) {
    const b = s.batches[id];
    if (!b || out[id]) continue;
    out[id] = { ...(b.code.n > 0 ? { code: batchNo(b.code) } : {}), n: Number(id.slice(1)), status: b.status, notBefore: b.notBefore };
  }
  return out;
}

/** Серии, о которых говорит причина. */
const whyBatch = (w: Why): string | undefined => ('batch' in w ? w.batch : undefined);

const movable = (s: PlantState, id: string) => s.batches[id]?.status === 'waiting' || s.batches[id]?.status === 'reserved';

/** Полосы серии по плану — для сравнения прогонов. */
const planOfBatch = (bars: Bar[], id: string) => JSON.stringify(bars.filter(b => b.batch === id && b.when === 'plan'));

/** Серии, чьи полосы по плану у двух прогонов разные; кроме `skip`. */
function movedOf(a: Bar[], b: Bar[], skip?: string): string[] {
  const ids = new Set([...a, ...b].flatMap(x => (x.batch && x.batch !== skip ? [x.batch] : [])));
  return [...ids].filter(id => planOfBatch(a, id) !== planOfBatch(b, id)).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
}

export function ganttView(db: ContentDb, s: PlantState, q: GanttQuery): GanttView {
  const base = forecast(db, s);
  const draft = q.draft ?? [];
  const f = draft.length > 0 ? forecast(db, s, draft) : base;
  const inWindow = (b: Bar) => b.to > q.from && b.from < q.to && b.to > b.from;
  const bars = [...pastBars(db, s), ...f.bars].filter(inWindow);
  const moved = draft.length > 0 ? movedOf(base.bars, f.bars) : [];
  const was = base.bars.filter(b => b.batch !== undefined && moved.includes(b.batch) && b.when === 'plan' && inWindow(b));
  const ids = new Set<string>([...bars.flatMap(b => (b.batch ? [b.batch] : [])), ...f.stuck]);
  for (const [id, list] of Object.entries(f.why)) {
    ids.add(id);
    for (const w of list) {
      const x = whyBatch(w);
      if (x) ids.add(x);
    }
  }
  return {
    view: 'gantt',
    from: q.from,
    to: q.to,
    now: s.t,
    rows: rowsOf(db, s),
    bars,
    batches: labels(s, ids),
    why: f.why,
    movable: [...new Set(f.bars.filter(b => b.kind === 'kit' && b.batch && movable(s, b.batch)).map(b => b.batch!))],
    stuck: f.stuck,
    off: offOf(db, s, q.from, Math.min(q.to, q.from + 31 * 24 * HOUR)),
    moved,
    was,
    gone: draft.filter(c => !movable(s, c.batch)).map(c => c.batch),
  };
}

/**
 * Призрак: прогон с черновиком и новым сроком у одного задания — его полосы (с уборками после стадий) и причины, почему не
 * раньше; какие другие серии встанут иначе, чем по черновику. Состояние не меняется: команды — только когда игрок
 * утвердит черновик.
 */
export function ghostView(db: ContentDb, s: PlantState, q: GhostQuery): GhostView {
  const empty = { view: 'ghost' as const, batch: q.batch, notBefore: q.notBefore, bars: [], why: [], moved: [], batches: {} };
  if (!s.batches[q.batch]) return { ...empty, refused: 'noBatch' };
  if (!movable(s, q.batch)) return { ...empty, refused: 'started' };
  const rest = (q.draft ?? []).filter(c => c.batch !== q.batch);
  const base = forecast(db, s, rest);
  const f = forecast(db, s, [...rest, { batch: q.batch, notBefore: q.notBefore }]);
  const moved = movedOf(base.bars, f.bars, q.batch);
  const why = f.why[q.batch] ?? [];
  const ids = new Set<string>([q.batch, ...moved, ...why.flatMap(w => (whyBatch(w) ? [whyBatch(w)!] : []))]);
  return { view: 'ghost', batch: q.batch, notBefore: q.notBefore, bars: f.bars.filter(b => b.batch === q.batch), why, moved, batches: labels(s, ids) };
}
