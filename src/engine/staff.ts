// Люди и смены (docs/specs/2026-10-engine.md, 1а, «Люди, смены, задачи, техника»; геймдизайн, §8.3). В части 1 график
// — дни недели и часы смены; праздников, отпусков, болезней и усталости ещё нет. С 3а у каждой роли — пост ожидания
// (docs/specs/2026-10-panels.md, 3а): без задачи человек идёт туда своим маршрутом, а в пути он свободен.
import type { ContentDb, Id } from '../content/types';
import { schedule } from './core/agenda';
import { HOUR, MIN, momentOf, type Ymd } from './core/calendar';
import { walked } from './lean';
import { pointAlong, route } from './nav';
import { dist, type PlantPlan, planOf, type Point, travel } from './plant';
import type { Person, PlantState } from './types';

/** Человек пешком, см/с. */
export const WALK = 120;

/** Новую задачу не берут, если до конца смены меньше этого. */
export const LAST_CALL = 15 * MIN;

/** Конец смены графика `shift` в мгновение `t`, если оно в смене, — игровые секунды; иначе `undefined`. */
export function shiftEndAt(db: ContentDb, start: Ymd, shift: Id, t: number): number | undefined {
  const sh = db.shifts[shift];
  const m = momentOf(start, t);
  if (!sh.days.includes(m.weekday)) return undefined;
  const from = sh.from * HOUR;
  const to = sh.to * HOUR;
  if (m.sec < from || m.sec >= to) return undefined;
  return t - m.sec + to;
}

/** Конец смены человека, если он сейчас в смене, — игровые секунды; иначе `undefined`. */
export function shiftEnd(db: ContentDb, s: PlantState, p: Person): number | undefined {
  return shiftEndAt(db, s.start, p.shift, s.t);
}

/**
 * Может ли человек графика `shift` взять новую задачу в мгновение `t`: в смене и до её конца не меньше `LAST_CALL`. Одна
 * проверка для раздатчика задач и для прогона расписания (3д).
 */
export function takesAt(db: ContentDb, start: Ymd, shift: Id, t: number): boolean {
  const end = shiftEndAt(db, start, shift, t);
  return end !== undefined && end - t >= LAST_CALL;
}

/** Может ли человек сейчас взять новую задачу: в смене, свободен, до конца смены не меньше `LAST_CALL`. */
export function canTake(db: ContentDb, s: PlantState, p: Person): boolean {
  if (p.task) return false;
  return takesAt(db, s.start, p.shift, s.t);
}

/**
 * Конец смены (docs/specs/2026-10-view.md, 2а): кто вне смены и без задачи — ушёл через вход; новая смена начинает путь
 * от входа. Зовётся каждый час и в конце задачи. Застал в пути — пройденное в потери.
 */
export function goHome(db: ContentDb, s: PlantState, p: Person) {
  if (p.task || shiftEnd(db, s, p) !== undefined) return;
  stopWalk(db, s, p);
  const e = planOf(db, s.plant).entrance;
  p.x = e.x;
  p.z = e.z;
}

/** Пост роли человека: там он ждёт задачи. Поста нет (сборка базы этого не пропустит) — вход. */
export function postOf(plan: PlantPlan, p: Person): Point {
  return plan.posts[p.role] ?? plan.entrance;
}

/**
 * Где человек сейчас: стоит — в своей точке; идёт на пост или к выходу — в точке маршрута, пройденной за долю времени
 * пути (путь длится целые секунды, как у задачи), в целых сантиметрах. Окно рисует тот же маршрут с той же долей
 * (`src/app/movers.ts`).
 */
export function here(plan: PlantPlan, p: Person, t: number): Point {
  const w = p.walk;
  if (!w) return { x: p.x, z: p.z };
  const d = progress(plan, p, t);
  // ломаная маршрута — только для точки посреди пути: длина пути — из поля расстояний (`dist`), она та же
  return d.cm >= d.len ? { x: p.x, z: p.z } : pointAlong(route(plan.nav, w, p, 'walk'), d.cm);
}

/** Пройдено от начала пути к мгновению `t`: см (доля длины по доле времени, вниз до сантиметра) и с; длина пути. */
function progress(plan: PlantPlan, p: Person, t: number): { cm: number; sec: number; len: number } {
  const w = p.walk!;
  const len = dist(plan, w, p);
  const all = Math.ceil(len / WALK);
  const sec = Math.min(Math.max(0, t - w.t), all);
  return { cm: sec >= all ? len : Math.floor((len * sec) / all), sec, len };
}

/**
 * Без задачи — на пост: кто в смене, свободен и не на месте, идёт на пост своей роли, а если до конца смены осталось
 * `LAST_CALL` или меньше — к выходу (событие `leave` будит его в это мгновение). Конец пути — событие `post`. Звать после
 * раздачи задач: кому досталась задача, тот не идёт.
 */
export function toPosts(db: ContentDb, s: PlantState) {
  const plan = planOf(db, s.plant);
  for (const p of Object.values(s.people)) {
    if (p.task || p.walk) continue;
    const end = shiftEnd(db, s, p);
    if (end === undefined) continue;
    const to = end - s.t <= LAST_CALL ? plan.entrance : postOf(plan, p);
    if (p.x === to.x && p.z === to.z) continue;
    p.walk = { x: p.x, z: p.z, t: s.t };
    p.x = to.x;
    p.z = to.z;
    schedule(s.agenda, s.t + walkTime(plan, p), { kind: 'post', person: p.id, t: s.t });
  }
}

/** Секунды пути без задачи — как у задачи: длина маршрута / скорость, вверх до секунды. */
function walkTime(plan: PlantPlan, p: Person): number {
  return travel(plan, p.walk!, p, WALK);
}

/**
 * Путь без задачи кончился или прерван — задачей или концом смены: человек там, где его застали, пройденное — пеший
 * переход отдела его роли.
 */
export function stopWalk(db: ContentDb, s: PlantState, p: Person) {
  const w = p.walk;
  if (!w) return;
  const plan = planOf(db, s.plant);
  const d = progress(plan, p, s.t);
  const at = d.cm >= d.len ? { x: p.x, z: p.z } : pointAlong(route(plan.nav, w, p, 'walk'), d.cm);
  walked(s, db.roles[p.role].dept, d.cm, d.sec);
  p.x = at.x;
  p.z = at.z;
  delete p.walk;
}

/**
 * Событие `post`: дошёл. Путь, начатый в то же мгновение после прерванного, кончается своим событием — это узнаётся по
 * времени прихода.
 */
export function postArrive(db: ContentDb, s: PlantState, person: string, t: number) {
  const p = s.people[person];
  if (!p?.walk || p.walk.t !== t) return;
  if (s.t < t + walkTime(planOf(db, s.plant), p)) return;
  stopWalk(db, s, p);
}
