// Расследование (docs/specs/2026-10-investigation.md, 4б; геймдизайн, §6.6): вид доски — чистая функция из состояния, как
// очередь лаборатории (lab.ts). Без истины до решения (архитектура, §9): что случилось, участники, шаги и улики — то, что
// показали шаги, с числами из записей, — и версии, которые вывод считает только по уликам. Корень, что вызвало улики, была
// ли улика на самом деле, отметки у записи испытания и у прибора, пока их не нашёл шаг, сборщик не читает. Разбор — только
// у решённого расследования (`debrief` движка).
import type { ContentDb, Id } from '../content/types';
import { recOf } from '../engine/assets';
import { batchNo } from '../engine/batchno';
import { posterior } from '../engine/infer';
import { type Debrief, debrief, labProven } from '../engine/investigation';
import type { Investigation, InvObs, PlantState, StepWhy } from '../engine/types';
import { nowOf, type TaskNow } from './lab';

export interface InvQuery {
  view: 'inv';
  /** выбранное расследование; нет — последнее открытое, а если открытых нет — последнее */
  inv?: string;
}

type Code = [number, number, number];
const code = (c: { y: number; m: number; n: number }): Code => [c.y, c.m, c.n];

/** Строка списка расследований: номер, серия, когда открыто, решено ли и чем. */
export interface InvListRow {
  id: string;
  /** номер серии строкой (src/engine/batchno.ts) */
  batch: string;
  opened: number;
  status: Investigation['status'];
  fate?: 'reject' | 'release';
}

/**
 * Шаг на доске: можно сделать, идёт или сделан; кто попросил; с какого и по какое мгновение; задача, пока идёт; запись
 * журнала решений (Б5а) и причина, по которой шаг попросил начальник ООК.
 */
export interface InvStepRow {
  id: string;
  state: 'can' | 'running' | 'done';
  by?: string;
  from?: number;
  to?: number;
  now?: TaskNow;
  jn?: number;
  why?: StepWhy;
}

/** Что случилось: методика, результат и пределы, партия и материал, серия и карта, когда результат проверен. */
export interface InvWhat {
  method: Id;
  result: number;
  min?: number;
  max?: number;
  lot: Code;
  material: Id;
  batch: string;
  recipe: Id;
  t?: number;
}

/** Участники: партии, отвешенные в серию; стадии — помещение, оборудование и роли людей; прибор первого испытания. */
export interface InvWho {
  lots: { code: Code; material: Id }[];
  stages: { stage: string; room: string; equipment: Id[]; roles: Id[] }[];
  inst?: Id;
  /** запись калибровки прибора (Б3в): шаг «Проверить прибор» читает её — последний день, когда она действует */
  instCal?: number;
}

export interface InvBoard {
  id: string;
  model: Id;
  status: Investigation['status'];
  opened: number;
  what: InvWhat;
  who: InvWho;
  steps: InvStepRow[];
  obs: InvObs[];
  /** версии по уликам — доли 1/10 000, сильнейшая первой */
  beliefs: { id: string; p: number }[];
  /** «выпустить» можно: ошибка лаборатории доказана */
  release: boolean;
  conclusion?: Investigation['conclusion'];
  /** вывод в журнале решений (Б5а): запись и, у начальника ООК, причина — вероятность версии и порог */
  concluded?: { n: number; why?: { p: number; threshold: number; proven: boolean } };
  /** только у решённого */
  debrief?: Debrief;
}

export interface InvView {
  view: 'inv';
  list: InvListRow[];
  board?: InvBoard;
}

/** Задача шага, пока он идёт: задача роли или задача лаборатории его испытания (подготовка, проверка). */
function nowOfRun(s: PlantState, r: Investigation['runs'][number]): TaskNow | undefined {
  const t = r.task ? s.tasks[r.task] : r.test ? Object.values(s.tasks).find(x => x.test === r.test) : undefined;
  return t ? nowOf(s, t) : undefined;
}

function boardOf(db: ContentDb, s: PlantState, inv: Investigation): InvBoard {
  const m = db.investigations[inv.model];
  const b = s.batches[inv.batch];
  const lot = s.lots[inv.lot];
  const first = s.tests[inv.test];
  // журнал решений (Б5а): шаги и вывод этого расследования
  const notes = s.journal.filter(x => (x.d.kind === 'step' || x.d.kind === 'conclude') && x.d.inv === inv.id);
  const steps: InvStepRow[] = m.steps.map(st => {
    const r = inv.runs.find(x => x.step === st.id);
    if (!r) return { id: st.id, state: 'can' };
    const now = r.to === undefined ? nowOfRun(s, r) : undefined;
    const j = notes.find(x => x.d.kind === 'step' && x.d.step === st.id);
    const why = j?.d.kind === 'step' ? j.d.why : undefined;
    return { id: st.id, state: r.to === undefined ? 'running' : 'done', by: r.by, from: r.from, ...(r.to !== undefined ? { to: r.to } : {}), ...(now ? { now } : {}), ...(j ? { jn: j.n } : {}), ...(why ? { why } : {}) };
  });
  const cj = notes.find(x => x.d.kind === 'conclude');
  const cwhy = cj?.d.kind === 'conclude' ? cj.d.why : undefined;
  const lots = [...new Set(b.dispensed.map(k => k.lot))].map(id => ({ code: code(s.lots[id].code), material: s.lots[id].material }));
  const stages = b.records.map(rec => ({
    stage: rec.stage,
    room: s.rooms[rec.room]?.type ?? rec.room,
    equipment: rec.equipment.map(id => s.equipment[id]?.type ?? id),
    roles: [...new Set(rec.people.map(id => s.people[id]?.role).filter((x): x is Id => !!x))],
  }));
  const beliefs = posterior(m, inv.obs).map(x => ({ id: x.id, p: Math.round(x.p * 10000) }));
  const d = inv.status === 'closed' ? debrief(db, s, inv.id) : undefined;
  return {
    id: inv.id,
    model: inv.model,
    status: inv.status,
    opened: inv.opened,
    what: {
      method: first.method,
      result: first.result ?? 0,
      ...(first.min !== undefined ? { min: first.min } : {}),
      ...(first.max !== undefined ? { max: first.max } : {}),
      lot: code(lot.code),
      material: lot.material,
      batch: batchNo(b.code),
      recipe: b.recipe,
      ...(first.done !== undefined ? { t: first.done } : {}),
    },
    who: {
      lots,
      stages,
      ...(first.inst && s.instruments[first.inst] ? { inst: s.instruments[first.inst].type } : {}),
      ...(first.inst && s.assets[first.inst] && recOf(s.assets[first.inst], 'cal') ? { instCal: recOf(s.assets[first.inst], 'cal')!.until } : {}),
    },
    steps,
    obs: inv.obs.map(o => ({ ...o })),
    beliefs,
    release: labProven(db, inv),
    ...(inv.conclusion ? { conclusion: { ...inv.conclusion } } : {}),
    ...(cj ? { concluded: { n: cj.n, ...(cwhy ? { why: cwhy } : {}) } } : {}),
    ...(d ? { debrief: d } : {}),
  };
}

/** Доска расследования: список и выбранное расследование; расследований нет — пустой список. */
export function invView(db: ContentDb, s: PlantState, q: InvQuery): InvView {
  const all = Object.values(s.investigations);
  const list: InvListRow[] = all.map(inv => ({
    id: inv.id,
    batch: batchNo(s.batches[inv.batch].code),
    opened: inv.opened,
    status: inv.status,
    ...(inv.conclusion ? { fate: inv.conclusion.fate } : {}),
  }));
  const pick = (q.inv ? s.investigations[q.inv] : undefined) ?? [...all].reverse().find(i => i.status === 'open') ?? all[all.length - 1];
  return { view: 'inv', list, ...(pick ? { board: boardOf(db, s, pick) } : {}) };
}
