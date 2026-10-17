// Задачи и раздатчик (docs/specs/2026-10-engine.md, 1а, «Люди, смены, задачи, техника»). Задача — работа для людей
// роли, иногда с техникой: перевезти паллету, принять, отобрать пробы. Раздатчик берёт открытые задачи по порядку
// (приоритет, время создания, номер) и даёт каждой ближайших свободных людей в смене и ближайшую свободную технику. Длина
// задачи считается сразу: дорога, подъём, работа. Конец — событие с версией задачи.
import type { ContentDb, Id, ZoneKind } from '../content/types';
import { schedule } from './core/agenda';
import { dist, type PlantPlan, planOf, type Point, travel } from './plant';
import { canTake, hasPermit } from './staff';
import { findSlot, nextId } from './stock';
import type { Person, Place, PlantState, Task, TaskKind, Vehicle } from './types';

/** Человек пешком, см/с. */
export const WALK = 120;

export interface NewTask {
  kind: TaskKind;
  roles: Id[];
  veh?: Id[];
  unit?: string;
  from: Place;
  toKind?: ZoneKind | 'storage';
  work: number;
  prio: number;
  /** сколько людей; по умолчанию один */
  count?: number;
}

export function addTask(s: PlantState, n: NewTask): Task {
  const t: Task = { id: nextId(s, 'T'), ...n, count: n.count ?? 1, created: s.t, state: 'open', people: [], v: 0 };
  s.tasks[t.id] = t;
  // место в очереди раздачи: приоритет по убыванию, затем время и номер
  let i = s.open.length;
  while (i > 0 && before(t, s.tasks[s.open[i - 1]])) i--;
  s.open.splice(i, 0, t.id);
  return t;
}

function before(a: Task, b: Task): boolean {
  if (a.prio !== b.prio) return a.prio > b.prio;
  if (a.created !== b.created) return a.created < b.created;
  return idNum(a.id) < idNum(b.id);
}

const idNum = (id: string) => Number(id.slice(1));

/** Точка места задачи. */
export function pointOf(plan: PlantPlan, s: PlantState, p: Place): Point {
  if (p.kind === 'slot') return plan.slot[p.id];
  if (p.kind === 'truck') return plan.dock[s.trucks[p.id].dock];
  return p;
}

function levelOf(plan: PlantPlan, p: Place | string | undefined): number {
  if (!p) return 0;
  if (typeof p === 'string') return plan.slot[p].level;
  return p.kind === 'slot' ? plan.slot[p.id].level : 0;
}

/** Ближайший свободный человек ролей задачи, который может взять задачу сейчас; при равенстве — меньший номер. */
function nearestPerson(db: ContentDb, s: PlantState, t: Task, at: Point, permit: string | undefined, skip: Set<string>): Person | undefined {
  let best: Person | undefined;
  let bestD = 0;
  for (const p of Object.values(s.people)) {
    if (skip.has(p.id) || !t.roles.includes(p.role) || !canTake(db, s, p) || !hasPermit(db, p, permit)) continue;
    const d = dist(p, at);
    if (!best || d < bestD || (d === bestD && idNum(p.id) < idNum(best.id))) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Раздать открытые задачи — в их порядке, пока хватает людей и техники. */
export function dispatch(db: ContentDb, s: PlantState) {
  if (s.open.length === 0) return;
  const plan = planOf(db, s.plant);
  for (const id of [...s.open]) {
    const t = s.tasks[id];
    if (assign(db, s, plan, t)) s.open.splice(s.open.indexOf(id), 1);
  }
}

function assign(db: ContentDb, s: PlantState, plan: PlantPlan, t: Task): boolean {
  const from = pointOf(plan, s, t.from);
  const fromLevel = levelOf(plan, t.from);
  if (t.veh) {
    // техника, ближайшая к грузу, с водителем; место назначения — по силам этой технике
    const free = Object.values(s.vehicles)
      .filter(v => !v.task && t.veh!.includes(v.type) && db.vehicles[v.type].levels >= fromLevel)
      .sort((a, b) => dist(a, from) - dist(b, from) || idNum(a.id) - idNum(b.id));
    for (const v of free) {
      const vt = db.vehicles[v.type];
      const driver = nearestPerson(db, s, t, v, vt.permit, new Set());
      if (!driver) continue;
      let to: string | undefined;
      if (t.toKind) {
        const sl = findSlot(s, plan, t.toKind, from, vt.levels);
        if (!sl) continue;
        to = sl.id;
      }
      start(db, s, plan, t, [driver], v, to);
      return true;
    }
    return false;
  }
  const people: Person[] = [];
  const skip = new Set<string>();
  for (let i = 0; i < t.count; i++) {
    const p = nearestPerson(db, s, t, from, undefined, skip);
    if (!p) return false;
    people.push(p);
    skip.add(p.id);
  }
  start(db, s, plan, t, people, undefined, undefined);
  return true;
}

function start(db: ContentDb, s: PlantState, plan: PlantPlan, t: Task, people: Person[], v: Vehicle | undefined, to: string | undefined) {
  const from = pointOf(plan, s, t.from);
  const t0 = s.t;
  let times: [number, number, number, number, number];
  if (v) {
    const vt = db.vehicles[v.type];
    const walk = travel(people[0], v, WALK);
    const atLoad = t0 + walk + travel(v, from, vt.speedEmpty);
    const off = atLoad + vt.liftBase + levelOf(plan, t.from) * vt.liftPerLevel;
    const dest = to ? plan.slot[to] : from;
    const atDrop = off + travel(from, dest, vt.speedLoaded);
    const end = atDrop + (to ? vt.liftBase + plan.slot[to].level * vt.liftPerLevel : 0) + t.work;
    times = [t0, atLoad, off, atDrop, end];
    v.task = t.id;
    t.vehicle = v.id;
  } else {
    const walk = Math.max(...people.map(p => travel(p, from, WALK)));
    times = [t0, t0 + walk, t0 + walk, t0 + walk, t0 + walk + t.work];
  }
  if (to) {
    t.to = to;
    (s.slots[to] ??= {}).held = t.id;
  }
  for (const p of people) p.task = t.id;
  t.people = people.map(p => p.id);
  t.state = 'busy';
  t.times = times;
  t.v++;
  schedule(s.agenda, times[4], { kind: 'task', id: t.id, v: t.v });
}

/** Освободить людей и технику задачи и поставить их туда, где задача кончилась. Задача уходит из состояния. */
export function release(db: ContentDb, s: PlantState, t: Task) {
  const plan = planOf(db, s.plant);
  const endAt = t.to ? plan.slot[t.to] : pointOf(plan, s, t.from);
  for (const id of t.people) {
    const p = s.people[id];
    delete p.task;
    p.x = endAt.x;
    p.z = endAt.z;
  }
  if (t.vehicle) {
    const v = s.vehicles[t.vehicle];
    delete v.task;
    v.x = endAt.x;
    v.z = endAt.z;
  }
  delete s.tasks[t.id];
}
