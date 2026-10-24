// Люди и допуски для видов окна (Б3б; docs/specs/2026-10-vertical-slice.md, «Б3б»): допуск человека сегодня, строки
// обучения в карточке — его роли и смежных профессий (Б4г), матрица обучения справочника и сводка планёрки. Записи
// обучения — знание завода, а не истина: окно видит их как есть. Правила допуска — движка (src/engine/quals.ts).
import type { ContentDb, Id } from '../content/types';
import { momentOf } from '../engine/core/calendar';
import { headOf, inForce, revisions } from '../engine/docs';
import { knows, learnable, learnCodes, matrixOf, rowsOf } from '../engine/quals';
import type { Person, PlantState } from '../engine/types';

/** Документ: код, раздел базы и редакция, действующая в день, — id записи и номер. */
export interface DocNow {
  code: string;
  kind: 'sops' | 'tests';
  id: Id;
  rev: number;
}

export function docNow(db: ContentDb, code: string, day: number): DocNow {
  const d = learnable(db, code)!;
  const id = inForce(db, d.kind, d.id, day);
  return { code, kind: d.kind, id, rev: headOf(db, d.kind, id)!.rev };
}

/** Документ по id редакции: процедура или методика. */
export function docOfRev(db: ContentDb, id: Id): DocNow {
  const kind = db.sops[id] ? 'sops' : 'tests';
  const h = headOf(db, kind, id)!;
  return { code: h.code, kind, id, rev: h.rev };
}

/**
 * Допуск сегодня: допущен; допущен, но потеряет допуск в срок предупреждения сценария — `last` — последний день допуска и
 * по какому документу; не допущен — по какому документу.
 */
export type Admission = { k: 'ok' } | { k: 'soon'; last: number; doc: DocNow } | { k: 'no'; doc: DocNow };

/**
 * С какого дня человек перестанет знать документ: кончится срок записи или будет введена редакция новее изученной;
 * знает «навсегда» в пределах базы — бесконечность.
 */
function loseDay(db: ContentDb, p: Person, code: string): number {
  const rec = p.train[code];
  const d = learnable(db, code)!;
  const mine = headOf(db, d.kind, rec.rev)!.from;
  let lose = rec.until + 1;
  for (const r of revisions(db, d.kind, d.id)) {
    const from = headOf(db, d.kind, r)!.from;
    if (from > mine) lose = Math.min(lose, from);
  }
  return lose;
}

export function admissionOf(db: ContentDb, s: PlantState, p: Person): Admission {
  const day = momentOf(s.start, s.t).day;
  const ahead = db.scenarios[s.scenario].training.ahead;
  let soon: { lose: number; code: string } | undefined;
  for (const code of matrixOf(db, p.role)) {
    if (!knows(db, p, code, day)) return { k: 'no', doc: docNow(db, code, day) };
    const lose = loseDay(db, p, code);
    if (lose - day <= ahead && (!soon || lose < soon.lose)) soon = { lose, code };
  }
  return soon ? { k: 'soon', last: soon.lose - 1, doc: docNow(db, soon.code, soon.lose) } : { k: 'ok' };
}

/** Строка обучения в карточке человека: документ сегодня; запись — изученная редакция, день и последний день; знает ли. */
export interface TrainRow {
  doc: DocNow;
  rec?: { rev: number; day: number; until: number };
  ok: boolean;
}

export function trainRows(db: ContentDb, s: PlantState, p: Person): TrainRow[] {
  const day = momentOf(s.start, s.t).day;
  return rowsOf(db, p).map(code => {
    const r = p.train[code];
    const d = learnable(db, code)!;
    const h = r ? headOf(db, d.kind, r.rev) : undefined;
    return { doc: docNow(db, code, day), ...(r && h ? { rec: { rev: h.rev, day: r.day, until: r.until } } : {}), ok: knows(db, p, code, day) };
  });
}

/**
 * Матрица обучения справочника: документы — процедуры и методики по коду, с редакцией, действующей сегодня; роли, у
 * которых есть люди; в клетке — сколько людей роли допущено по документу из скольких и сколько людей других ролей
 * допущено по нему как по смежной профессии этой роли (Б4г), а если роли он не нужен, — `null`.
 */
export interface Matrix {
  docs: DocNow[];
  roles: Id[];
  cells: ({ ok: number; all: number; also: number } | null)[][];
}

export function matrix(db: ContentDb, s: PlantState): Matrix {
  const day = momentOf(s.start, s.t).day;
  const people = Object.values(s.people);
  const roles = Object.keys(db.roles).filter(r => people.some(p => p.role === r) && matrixOf(db, r).length > 0);
  const docs = learnCodes(db).map(code => docNow(db, code, day));
  const cells = docs.map(d =>
    roles.map(r => {
      if (!matrixOf(db, r).includes(d.code)) return null;
      const mine = people.filter(p => p.role === r);
      const also = people.filter(p => p.also?.includes(r) && knows(db, p, d.code, day)).length;
      return { ok: mine.filter(p => knows(db, p, d.code, day)).length, all: mine.length, also };
    }),
  );
  return { docs, roles, cells };
}

/** Сводка планёрки: кто потеряет допуск в срок предупреждения, кто уже не допущен — номер человека, табельный, роль, документ. */
export interface TrainSum {
  soon: { person: number; tab: number; role: Id; last: number; doc: DocNow }[];
  no: { person: number; tab: number; role: Id; doc: DocNow }[];
}

export function trainSum(db: ContentDb, s: PlantState): TrainSum {
  const out: TrainSum = { soon: [], no: [] };
  for (const p of Object.values(s.people)) {
    const a = admissionOf(db, s, p);
    const who = { person: Number(p.id.slice(1)), tab: p.tab, role: p.role };
    if (a.k === 'soon') out.soon.push({ ...who, last: a.last, doc: a.doc });
    if (a.k === 'no') out.no.push({ ...who, doc: a.doc });
  }
  return out;
}
