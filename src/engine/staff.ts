// Люди и смены (docs/specs/2026-10-engine.md, 1а, «Люди, смены, задачи, техника»; геймдизайн, §8.3). В части 1 график
// — дни недели и часы смены; праздников, отпусков, болезней и усталости ещё нет.
import type { ContentDb } from '../content/types';
import { HOUR, MIN, momentOf } from './core/calendar';
import { planOf } from './plant';
import type { Person, PlantState } from './types';

/** Новую задачу не берут, если до конца смены меньше этого. */
export const LAST_CALL = 15 * MIN;

/** Конец смены человека, если он сейчас в смене, — игровые секунды; иначе `undefined`. */
export function shiftEnd(db: ContentDb, s: PlantState, p: Person): number | undefined {
  const sh = db.shifts[p.shift];
  const m = momentOf(s.start, s.t);
  if (!sh.days.includes(m.weekday)) return undefined;
  const from = sh.from * HOUR;
  const to = sh.to * HOUR;
  if (m.sec < from || m.sec >= to) return undefined;
  return s.t - m.sec + to;
}

/** Может ли человек сейчас взять новую задачу: в смене, свободен, до конца смены не меньше `LAST_CALL`. */
export function canTake(db: ContentDb, s: PlantState, p: Person): boolean {
  if (p.task) return false;
  const end = shiftEnd(db, s, p);
  return end !== undefined && end - s.t >= LAST_CALL;
}

/**
 * Конец смены (docs/specs/2026-10-view.md, 2а): кто вне смены и без задачи — ушёл через вход; новая смена начинает путь
 * от входа. Зовётся каждый час и в конце задачи.
 */
export function goHome(db: ContentDb, s: PlantState, p: Person) {
  if (p.task || shiftEnd(db, s, p) !== undefined) return;
  const e = planOf(db, s.plant).entrance;
  p.x = e.x;
  p.z = e.z;
}

export function hasPermit(db: ContentDb, p: Person, permit: string | undefined): boolean {
  return !permit || db.roles[p.role].permits.includes(permit);
}
