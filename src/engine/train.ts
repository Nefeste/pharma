// Обучение (Б3б; docs/specs/2026-10-vertical-slice.md, «Б3б»; GMP ЕАЭС, ч. I, пп. 2.11, 4.29): записи на старте; задача
// обучения — когда до введения новой редакции или до конца срока записи остаётся срок предупреждения сценария; проверка
// знаний и запись «годен» с этим днём; извещение, когда человек теряет допуск. Учат тому, что нужно его роли по матрице
// обучения (quals.ts). Новой редакции учат до её дня, работают по ней с её дня — отраслевая практика
// (docs/10-domain.md, §2).
import type { ContentDb, Id, Scenario } from '../content/types';
import { addMonths, momentOf } from './core/calendar';
import { fnv1a } from './core/hash';
import { headOf, inForce } from './docs';
import { type PlantPlan, planOf, type Point } from './plant';
import { dueRev, knows, learnable, learnRec, matrixOf } from './quals';
import { addTask } from './tasks';
import type { Notice, Person, PlantState, Task, TrainRecord } from './types';

/** Кто проверяет знания: специалист ООК или начальник ОКК — не тот, кто учился (гипотеза). */
export const CHECKERS = ['role.qa', 'role.qc-head'] as const;

/** Обучение — после работ завода: изучить документ — ниже всего, проверка знаний — чуть выше. */
export const TRAIN_PRIO = { train: 1, trainCheck: 2 } as const;

/** Код документа по id его редакции: процедура или методика. */
export function codeOfRev(db: ContentDb, rev: Id): string {
  return (db.sops[rev] ?? db.tests[rev]).doc.code;
}

/** Запись на редакцию `rev` документа `code` с днём `day`: действует по день перед тем же числом через срок документа. */
function record(db: ContentDb, code: string, rev: Id, day: number): TrainRecord {
  return { rev, day, until: addMonths(day, learnRec(db, learnable(db, code)!, rev).every) - 1 };
}

/**
 * Записи человека на день `day` — на старте партии и в миграции старого сохранения: допущен ко всему, чему учат его роль.
 * День обучения — до `spread` суток назад, у каждой записи свой — по хешу человека и кода, а не по зерну: жизнь до начала
 * партии одна; не раньше дня введения редакции.
 */
export function seedTraining(db: ContentDb, sc: Scenario, p: Person, day: number) {
  for (const code of matrixOf(db, p.role)) {
    const d = learnable(db, code)!;
    const rev = inForce(db, d.kind, d.id, day);
    const back = fnv1a(`${p.id}/${code}`) % (sc.training.spread + 1);
    p.train[code] = record(db, code, rev, Math.max(day - back, headOf(db, d.kind, rev)!.from));
  }
}

const point = (at: Point): Task['from'] => ({ kind: 'point', x: at.x, z: at.z });
const postOf = (plan: PlantPlan, role: Id) => plan.posts[role] ?? plan.entrance;

/**
 * Раз в сутки, в полночь (и на старте партии): кто с этого дня не допущен к тому, чему его учат, — извещение; кому пора
 * учиться — задача изучить документ на своём посту, если такой ещё нет.
 */
export function trainDay(db: ContentDb, s: PlantState, notices: Notice[]) {
  const day = momentOf(s.start, s.t).day;
  const open = openStudies(db, s);
  for (const p of Object.values(s.people)) {
    for (const code of matrixOf(db, p.role)) {
      // принятый сегодня (Б4в) допуска и не имел — терять нечего
      if (knows(db, p, code, day - 1) && !knows(db, p, code, day)) notices.push({ kind: 'qualLost', person: p.id, role: p.role, tab: p.tab, doc: code });
    }
    study(db, s, p, day, open);
  }
}

/** Задачи изучить документ, которые уже есть: `<человек>/<код>`. */
const openStudies = (db: ContentDb, s: PlantState) => new Set(Object.values(s.tasks).flatMap(t => (t.trainee && t.doc ? [`${t.trainee}/${codeOfRev(db, t.doc)}`] : [])));

/** Кому пора учиться в день `day` — задача изучить документ на своём посту, если такой ещё нет. */
function study(db: ContentDb, s: PlantState, p: Person, day: number, open: ReadonlySet<string>) {
  const sc = db.scenarios[s.scenario];
  const plan = planOf(db, s.plant);
  for (const code of matrixOf(db, p.role)) {
    if (open.has(`${p.id}/${code}`)) continue;
    const rev = dueRev(db, p, code, day, sc.training.ahead);
    if (!rev) continue;
    const work = learnRec(db, learnable(db, code)!, rev).study;
    addTask(s, { kind: 'train', roles: [p.role], from: point(postOf(plan, p.role)), work, prio: TRAIN_PRIO.train, trainee: p.id, doc: rev });
  }
}

/** Новый человек (Б4в): задачи изучить всё, чему учат его роль, — в первый день, не дожидаясь полуночи. */
export function trainNow(db: ContentDb, s: PlantState, p: Person) {
  study(db, s, p, momentOf(s.start, s.t).day, openStudies(db, s));
}

/** Конец задачи обучения: изучил — проверка знаний у поста ООК; проверили — запись «годен» с этим днём. */
export function trainDone(db: ContentDb, s: PlantState, t: Task): boolean {
  if (t.kind === 'train') {
    const sc = db.scenarios[s.scenario];
    const at = postOf(planOf(db, s.plant), CHECKERS[0]);
    addTask(s, { kind: 'trainCheck', roles: [...CHECKERS], not: [t.trainee!], from: point(at), work: sc.training.check, prio: TRAIN_PRIO.trainCheck, trainee: t.trainee, doc: t.doc });
    return true;
  }
  if (t.kind === 'trainCheck') {
    const p = s.people[t.trainee!];
    const code = codeOfRev(db, t.doc!);
    if (p) p.train[code] = record(db, code, t.doc!, momentOf(s.start, s.t).day);
    return true;
  }
  return false;
}
