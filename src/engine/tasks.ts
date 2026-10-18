// Задачи и раздатчик (docs/specs/2026-10-engine.md, 1а, «Люди, смены, задачи, техника»; 1б). Задача — работа для людей
// роли, иногда с техникой или прибором: перевезти паллету, принять, отобрать пробы, провести испытание. Раздатчик берёт
// открытые задачи по порядку (приоритет, время создания, номер) и даёт каждой ближайших свободных людей в смене,
// ближайшую свободную технику и свободный прибор. Длина задачи считается сразу: дорога, подъём, работа. Конец — событие
// с версией задачи. Задача не досталась никому — раздатчик называет причину, а путь назначенной — потери (lean.ts).
import type { ContentDb, Id, ZoneKind } from '../content/types';
import { schedule } from './core/agenda';
import { moved, waitEnd, waitNote } from './lean';
import { dist, type PlantPlan, planOf, type Point, travel } from './plant';
import { canTake, goHome, hasPermit, LAST_CALL, shiftEnd } from './staff';
import { findSlot, nextId } from './stock';
import type { Instrument, Person, Place, PlantState, Task, TaskKind, Vehicle, WaitCause } from './types';

/** Человек пешком, см/с. */
export const WALK = 120;

export interface NewTask {
  kind: TaskKind;
  roles: Id[];
  veh?: Id[];
  unit?: string;
  from: Place;
  toKind?: ZoneKind | 'storage';
  near?: Point;
  work: number;
  prio: number;
  /** сколько людей; по умолчанию один */
  count?: number;
  inst?: Id[];
  not?: string[];
  lot?: string;
  test?: string;
  batch?: string;
  room?: string;
  line?: string;
  order?: string;
  cases?: string[];
  dest?: string;
  truck?: string;
  part?: string;
  planned?: boolean;
  begin?: boolean;
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

/**
 * Куда везут груз задачи без своего места: в фуру у рампы или на паллету заказа в экспедиции; слесарь несёт запчасть
 * к машине — в её помещение; балк к линии несут к первой её машине.
 */
function destOf(plan: PlantPlan, s: PlantState, t: Task): Point | undefined {
  if (t.kind === 'repair' && t.room) return plan.room[t.room];
  if (t.kind === 'feed' && t.line) {
    const m = plan.plant.lines.find(l => l.id === t.line)!.machines[0];
    return { x: m.at[0], z: m.at[1] };
  }
  if (t.truck && s.trucks[t.truck]) return pointOf(plan, s, { kind: 'truck', id: t.truck });
  const u = t.dest ? s.units[t.dest] : undefined;
  return u?.where.kind === 'slot' ? plan.slot[u.where.id] : undefined;
}

function levelOf(plan: PlantPlan, p: Place | string | undefined): number {
  if (!p) return 0;
  if (typeof p === 'string') return plan.slot[p].level;
  return p.kind === 'slot' ? plan.slot[p.id].level : 0;
}

/** Ближайший свободный человек ролей задачи, который может взять задачу сейчас; при равенстве — меньший номер. */
function nearestPerson(db: ContentDb, s: PlantState, plan: PlantPlan, t: Task, at: Point, permit: string | undefined, skip: Set<string>): Person | undefined {
  let best: Person | undefined;
  let bestD = 0;
  for (const p of Object.values(s.people)) {
    if (skip.has(p.id) || !t.roles.includes(p.role) || t.not?.includes(p.id) || !canTake(db, s, p) || !hasPermit(db, p, permit)) continue;
    const d = dist(plan, p, at);
    if (!best || d < bestD || (d === bestD && idNum(p.id) < idNum(best.id))) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Раздать открытые задачи — в их порядке, пока хватает людей, техники и приборов; не досталась — запомнить почему. */
export function dispatch(db: ContentDb, s: PlantState) {
  if (s.open.length === 0) return;
  const plan = planOf(db, s.plant);
  for (const id of [...s.open]) {
    const t = s.tasks[id];
    const why = assign(db, s, plan, t);
    if (why === undefined) s.open.splice(s.open.indexOf(id), 1);
    else waitNote(s, t, why);
  }
}

/** Люди ролей задачи в смене есть, но заняты, — или их нет в смене (или смена вот-вот кончится). */
function crewWait(db: ContentDb, s: PlantState, t: Task): WaitCause {
  return Object.values(s.people).some(p => t.roles.includes(p.role) && (shiftEnd(db, s, p) ?? s.t) - s.t >= LAST_CALL) ? 'people' : 'shift';
}

/** Назначить задачу; не вышло — причина: прибор, техника, место назначения, люди. */
function assign(db: ContentDb, s: PlantState, plan: PlantPlan, t: Task): WaitCause | undefined {
  const from = pointOf(plan, s, t.from);
  const fromLevel = levelOf(plan, t.from);
  // прибор — первый свободный нужного вида в порядке плана
  let inst: Instrument | undefined;
  if (t.inst) {
    inst = Object.values(s.instruments).find(i => !i.test && t.inst!.includes(i.type));
    if (!inst) return 'instrument';
  }
  if (t.veh) {
    // техника, ближайшая к грузу, с водителем; место назначения — по силам этой технике
    const free = Object.values(s.vehicles)
      .filter(v => !v.task && t.veh!.includes(v.type) && db.vehicles[v.type].levels >= fromLevel)
      .sort((a, b) => dist(plan, a, from, 'drive') - dist(plan, b, from, 'drive') || idNum(a.id) - idNum(b.id));
    if (free.length === 0) return 'vehicle';
    let place = false;
    for (const v of free) {
      const vt = db.vehicles[v.type];
      const driver = nearestPerson(db, s, plan, t, v, vt.permit, new Set());
      if (!driver) continue;
      let to: string | undefined;
      if (t.toKind) {
        const sl = findSlot(s, plan, t.toKind, t.near ?? from, vt.levels, 'drive');
        if (!sl) {
          place = true;
          continue;
        }
        to = sl.id;
      }
      start(db, s, plan, t, [driver], v, to, inst);
      return undefined;
    }
    return place ? 'place' : crewWait(db, s, t);
  }
  const people: Person[] = [];
  const skip = new Set<string>();
  for (let i = 0; i < t.count; i++) {
    const p = nearestPerson(db, s, plan, t, from, undefined, skip);
    if (!p) return crewWait(db, s, t);
    people.push(p);
    skip.add(p.id);
  }
  // пешком, но с местом назначения на полу (возврат остатков в шлюз): место — ближе к началу задачи
  let to: string | undefined;
  if (t.toKind) {
    const sl = findSlot(s, plan, t.toKind, t.near ?? from, 0, 'walk');
    if (!sl) return 'place';
    to = sl.id;
  }
  start(db, s, plan, t, people, undefined, to, inst);
  return undefined;
}

function start(db: ContentDb, s: PlantState, plan: PlantPlan, t: Task, people: Person[], v: Vehicle | undefined, to: string | undefined, inst: Instrument | undefined) {
  const from = pointOf(plan, s, t.from);
  const t0 = s.t;
  let times: [number, number, number, number, number];
  waitEnd(s, t);
  if (v) {
    const vt = db.vehicles[v.type];
    const walk = travel(plan, people[0], v, WALK);
    const empty = travel(plan, v, from, vt.speedEmpty, 'drive');
    const atLoad = t0 + walk + empty;
    const off = atLoad + vt.liftBase + levelOf(plan, t.from) * vt.liftPerLevel;
    const dest = to ? plan.slot[to] : (destOf(plan, s, t) ?? from);
    const loaded = travel(plan, from, dest, vt.speedLoaded, 'drive');
    const atDrop = off + loaded;
    const end = atDrop + (to ? vt.liftBase + plan.slot[to].level * vt.liftPerLevel : 0) + t.work;
    times = [t0, atLoad, off, atDrop, end];
    v.task = t.id;
    t.vehicle = v.id;
    // водитель идёт к технике — перемещение; техника едет порожняком и с грузом — транспортировка
    moved(s, t.kind, dist(plan, people[0], v), walk, dist(plan, v, from, 'drive'), dist(plan, from, dest, 'drive'), empty + loaded);
  } else {
    // пешком: дойти, взять, донести до места назначения (если оно есть) и там работать
    const walk = Math.max(...people.map(p => travel(plan, p, from, WALK)));
    const dest = to ? plan.slot[to] : destOf(plan, s, t);
    const carry = dest ? travel(plan, from, dest, WALK) : 0;
    // каждый идёт к месту — перемещение; груз на руках — транспортировка
    moved(s, t.kind, people.reduce((n, p) => n + dist(plan, p, from), 0), people.reduce((n, p) => n + travel(plan, p, from, WALK), 0), 0, dest ? dist(plan, from, dest) : 0, carry);
    // смена у линии — до конца смены того, у кого она кончается раньше; линия узнаёт о приходе людей событием
    if (t.kind === 'crew') {
      t.work = Math.max(1, Math.min(...people.map(p => shiftEnd(db, s, p)!)) - (t0 + walk));
      schedule(s.agenda, t0 + walk, { kind: 'line', id: t.line!, v: -1 });
    }
    times = [t0, t0 + walk, t0 + walk, t0 + walk + carry, t0 + walk + carry + t.work];
  }
  if (to) {
    t.to = to;
    (s.slots[to] ??= {}).held = t.id;
  }
  // прибор занят испытанием задачи; отпускает его лаборатория, когда кончится работа прибора (lab.ts)
  if (inst) {
    if (!t.test) throw new Error(`task ${t.id}: an instrument without a test`);
    inst.test = t.test;
    t.instrument = inst.id;
  }
  // испытание с начала подготовки — у аналитика и на приборе
  if (t.kind === 'prep') {
    const q = s.tests[t.test!];
    q.state = 'prep';
    q.by = people[0].id;
    if (inst) q.inst = inst.id;
  }
  for (const p of people) p.task = t.id;
  t.people = people.map(p => p.id);
  t.state = 'busy';
  t.times = times;
  t.v++;
  // стадия с узлами под износом узнаёт, когда люди начали работу: от этого момента считается отказ (mes.ts); раньше
  // конца задачи, даже если работы нет
  if (t.begin) schedule(s.agenda, times[1], { kind: 'begin', task: t.id, v: t.v });
  schedule(s.agenda, times[4], { kind: 'task', id: t.id, v: t.v });
}

/**
 * Снять задачу: открытую — из очереди (её ожидание — в потери), занятую — освободив людей и технику. Событие её конца
 * устареет само.
 */
export function dropTask(db: ContentDb, s: PlantState, t: Task) {
  if (t.state === 'busy') return release(db, s, t);
  waitEnd(s, t);
  s.open.splice(s.open.indexOf(t.id), 1);
  delete s.tasks[t.id];
}

/** Освободить людей и технику задачи и поставить их туда, где задача кончилась. Задача уходит из состояния; прибор — нет. */
export function release(db: ContentDb, s: PlantState, t: Task) {
  const plan = planOf(db, s.plant);
  const endAt = t.to ? plan.slot[t.to] : (destOf(plan, s, t) ?? pointOf(plan, s, t.from));
  for (const id of t.people) {
    const p = s.people[id];
    delete p.task;
    p.x = endAt.x;
    p.z = endAt.z;
    // кончил после смены — уходит через вход
    goHome(db, s, p);
  }
  if (t.vehicle) {
    const v = s.vehicles[t.vehicle];
    delete v.task;
    v.x = endAt.x;
    v.z = endAt.z;
  }
  delete s.tasks[t.id];
}
