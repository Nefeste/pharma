// Допуски (Б3б; docs/specs/2026-10-vertical-slice.md, «Б3б»; GMP ЕАЭС, ч. I, пп. 2.10–2.13; модель персонала ISA-95,
// `gost-62264-2`): чему учат — процедуры (СОП) и методики, и кого — строка матрицы обучения у документа; что нужно знать
// для работы; допущен ли человек. Допущен — если по каждому документу работы у него запись на редакцию, действующую в
// этот день, или на более новую, и её срок не истёк. Запись — знание завода, а не истина: её видят окно и двойник.
import type { ContentDb, Id, RecipeStage, TaskKind } from '../content/types';
import { headOf, revisions } from './docs';
import { planOf } from './plant';
import type { Person, PlantState, Task } from './types';

/** Документ, которому учат: раздел базы и id одной из редакций. */
export interface Learnable {
  kind: 'sops' | 'tests';
  id: Id;
}

/** Работы у линии: им нужны процедуры её машин. */
const LINE_WORK: ReadonlySet<TaskKind> = new Set(['crew', 'feed', 'changeover', 'clearance', 'clearCheck']);

/** Обучение само допуска не требует: изучить документ и проверить знания — это и есть путь к допуску. */
const FREE: ReadonlySet<TaskKind> = new Set(['train', 'trainCheck']);

interface Index {
  byCode: Map<string, Learnable>;
  any: string[];
  task: Map<TaskKind, string[]>;
  equipment: Map<Id, string[]>;
  machine: Map<Id, string[]>;
  vehicle: Map<Id, string[]>;
  /** по роли — коды документов, которым её учат, по порядку кода */
  matrix: Map<Id, string[]>;
  /** день введения каждой редакции; по коду — дни введения его редакций по возрастанию */
  revFrom: Map<Id, number>;
  froms: Map<string, number[]>;
  /** день введения редакции, действующей в день `day`, по коду — на последний спрошенный день */
  day: number;
  floor: Map<string, number>;
}

/** На каждую базу — один раз: база не меняется, пока идёт игра. */
const cache = new WeakMap<ContentDb, Index>();

function index(db: ContentDb): Index {
  const hit = cache.get(db);
  if (hit) return hit;
  const ix: Index = { byCode: new Map(), any: [], task: new Map(), equipment: new Map(), machine: new Map(), vehicle: new Map(), matrix: new Map(), revFrom: new Map(), froms: new Map(), day: Number.NaN, floor: new Map() };
  const add = <K>(m: Map<K, string[]>, k: K, code: string) => {
    const list = m.get(k) ?? [];
    if (!list.includes(code)) list.push(code);
    m.set(k, list);
  };
  // у редакций одного документа — одни роли и работы (проверяет сборщик базы): берётся первая встреченная
  for (const kind of ['sops', 'tests'] as const) {
    for (const [id, r] of Object.entries(db[kind])) {
      const code = r.doc.code;
      ix.revFrom.set(id, r.doc.from);
      ix.froms.set(code, [...(ix.froms.get(code) ?? []), r.doc.from].sort((a, b) => a - b));
      if (ix.byCode.has(code)) continue;
      ix.byCode.set(code, { kind, id });
      for (const role of r.roles) add(ix.matrix, role, code);
    }
  }
  for (const [code, d] of ix.byCode) {
    if (d.kind !== 'sops') continue;
    const f = db.sops[d.id].for;
    if (f.any) ix.any.push(code);
    for (const k of f.tasks ?? []) add(ix.task, k, code);
    for (const e of f.equipment ?? []) add(ix.equipment, e, code);
    for (const m of f.machines ?? []) add(ix.machine, m, code);
    for (const v of f.vehicles ?? []) add(ix.vehicle, v, code);
  }
  for (const list of ix.matrix.values()) list.sort();
  cache.set(db, ix);
  return ix;
}

/** Документ по коду: процедура или методика; такого кода среди них нет — `undefined`. */
export function learnable(db: ContentDb, code: string): Learnable | undefined {
  return index(db).byCode.get(code);
}

/** Запись базы редакции: процедура или методика — у обеих есть обучение. */
export function learnRec(db: ContentDb, d: Learnable, id: Id = d.id) {
  return d.kind === 'sops' ? db.sops[id] : db.tests[id];
}

/** Коды документов, которым учат роль, — строка матрицы обучения, по порядку кода. */
export function matrixOf(db: ContentDb, role: Id): readonly string[] {
  return index(db).matrix.get(role) ?? [];
}

/** Все коды матрицы обучения: процедуры, потом методики, по порядку кода. */
export function learnCodes(db: ContentDb): string[] {
  return [...index(db).byCode.keys()].sort();
}

/**
 * Что нужно знать для работы вида `kind`: процедуры этого вида и «любой работы»; у стадии — ещё процедуры её оборудования
 * и методики её МОК; у работы у линии — процедуры машин линии; у испытания и проверки его результата — методика.
 */
export function needFor(db: ContentDb, kind: TaskKind, at: { stage?: RecipeStage; machines?: readonly Id[]; method?: Id } = {}): string[] {
  if (FREE.has(kind)) return [];
  const ix = index(db);
  const out = new Set<string>(ix.any);
  for (const c of ix.task.get(kind) ?? []) out.add(c);
  if (at.stage) {
    for (const e of at.stage.equipment) for (const c of ix.equipment.get(e) ?? []) out.add(c);
    for (const q of at.stage.ipc) out.add(db.tests[q.test].doc.code);
  }
  if (LINE_WORK.has(kind)) for (const m of at.machines ?? []) for (const c of ix.machine.get(m) ?? []) out.add(c);
  if (at.method) out.add(db.tests[at.method].doc.code);
  return [...out].sort();
}

/** Требования задачи — один раз на задачу и базу: её стадия, линия и испытание за её жизнь не меняются. */
const needs = new WeakMap<ContentDb, WeakMap<Task, string[]>>();

/** Что нужно знать для задачи: её вид, стадия серии, машины линии, методика испытания. */
export function needOf(db: ContentDb, s: PlantState, t: Task): string[] {
  let byTask = needs.get(db);
  if (!byTask) needs.set(db, (byTask = new WeakMap()));
  let n = byTask.get(t);
  if (!n) byTask.set(t, (n = needOfTask(db, s, t)));
  return n;
}

function needOfTask(db: ContentDb, s: PlantState, t: Task): string[] {
  const b = t.kind === 'stage' && t.batch ? s.batches[t.batch] : undefined;
  const stage = b ? db.recipes[b.recipe].stages[b.stage] : undefined;
  const line = LINE_WORK.has(t.kind) && t.line ? planOf(db, s.plant).plant.lines.find(l => l.id === t.line) : undefined;
  const method = (t.kind === 'prep' || t.kind === 'review') && t.test ? s.tests[t.test]?.method : undefined;
  return needFor(db, t.kind, { ...(stage ? { stage } : {}), ...(line ? { machines: line.machines.map(m => m.type) } : {}), ...(method ? { method } : {}) });
}

/** Что нужно знать, чтобы ездить на технике вида `type`. */
export function vehicleNeed(db: ContentDb, type: Id): readonly string[] {
  return index(db).vehicle.get(type) ?? [];
}

/** День введения редакции документа `code`, действующей в день `day` (`inForce`): раздатчик спрашивает его часто. */
function floorOf(ix: Index, code: string, day: number): number {
  if (ix.day !== day) {
    ix.day = day;
    ix.floor.clear();
  }
  let f = ix.floor.get(code);
  if (f === undefined) {
    const froms = ix.froms.get(code) ?? [];
    f = froms[0] ?? Number.POSITIVE_INFINITY;
    for (const x of froms) if (x <= day) f = x;
    ix.floor.set(code, f);
  }
  return f;
}

/** Знает ли человек документ `code` в день `day`: запись на действующую редакцию или новее, срок не истёк. */
export function knows(db: ContentDb, p: Person, code: string, day: number): boolean {
  return known(index(db), p, code, day);
}

function known(ix: Index, p: Person, code: string, day: number): boolean {
  const rec = p.train[code];
  if (!rec || rec.until < day) return false;
  const mine = ix.revFrom.get(rec.rev);
  return mine !== undefined && mine >= floorOf(ix, code, day);
}

/** Первый документ из `codes`, которого человек в день `day` не знает; знает все — `undefined`. */
export function lacking(db: ContentDb, p: Person, codes: readonly string[], day: number): string | undefined {
  if (codes.length === 0) return undefined;
  const ix = index(db);
  for (const c of codes) if (!known(ix, p, c, day)) return c;
  return undefined;
}

/** Допущен ли человек в день `day` к работе, которой нужны документы `codes`. */
export function admitted(db: ContentDb, p: Person, codes: readonly string[], day: number): boolean {
  return lacking(db, p, codes, day) === undefined;
}

/**
 * Какую редакцию документа `code` учить в день `day`, если пора: последняя, введённая не позже чем через `ahead` суток;
 * пора — если записи нет, она на редакцию старше этой или её срок кончается в эти `ahead` суток. Документ ещё не введён и
 * через `ahead` суток — не пора.
 */
export function dueRev(db: ContentDb, p: Person, code: string, day: number, ahead: number): Id | undefined {
  const d = learnable(db, code);
  if (!d) return undefined;
  let want: Id | undefined;
  for (const r of revisions(db, d.kind, d.id)) if (headOf(db, d.kind, r)!.from <= day + ahead) want = r;
  if (!want) return undefined;
  const rec = p.train[code];
  const mine = rec && headOf(db, d.kind, rec.rev);
  if (!rec || !mine) return want;
  if (mine.from < headOf(db, d.kind, want)!.from) return want;
  return rec.until - ahead <= day ? want : undefined;
}
