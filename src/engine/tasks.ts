// Задачи и раздатчик (docs/specs/2026-10-engine.md, 1а, «Люди, смены, задачи, техника»; 1б). Задача — работа для людей
// роли, иногда с техникой или прибором: перевезти паллету, принять, отобрать пробы, провести испытание. Раздатчик берёт
// открытые задачи по порядку (приоритет, время создания, номер) и даёт каждой ближайших свободных людей в смене,
// ближайшую свободную технику и свободный прибор. Длина задачи считается сразу: дорога, подъём, работа. Конец — событие
// с версией задачи. Задача не досталась никому — раздатчик называет причину, а путь назначенной — потери (lean.ts).
// Человек, который идёт без задачи на пост (staff.ts), свободен: расстояние меряется от точки маршрута, где он сейчас.
// Задачу берёт только допущенный (Б3б, quals.ts): у кого есть записи обучения по всему, что нужно для работы и для
// техники; есть люди роли в смене, но ни один не допущен, — задача ждёт «нет допуска» и называет документ.
import type { ContentDb, Id, ZoneKind } from '../content/types';
import { mixStart } from './batchno';
import { schedule } from './core/agenda';
import { momentOf } from './core/calendar';
import { moved, waitEnd, waitNote } from './lean';
import { dist, type PlantPlan, planOf, type Point, travel } from './plant';
import { admitted, lacking, needOf, vehicleNeed } from './quals';
import { canTake, goHome, here, LAST_CALL, shiftEnd, stopWalk, WALK } from './staff';
import { findSlot, nextId } from './stock';
import type { Instrument, Person, Place, PlantState, Task, TaskKind, Vehicle, WaitCause } from './types';

export { WALK };

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
  inv?: string;
  step?: string;
  trainee?: string;
  doc?: Id;
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

/** Очередь раздачи заново — после того как у задач сменился приоритет (3г, поднятая проба). */
export function resort(s: PlantState) {
  s.open.sort((x, y) => (before(s.tasks[x], s.tasks[y]) ? -1 : before(s.tasks[y], s.tasks[x]) ? 1 : 0));
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
export function destOf(plan: PlantPlan, s: PlantState, t: Task): Point | undefined {
  if (t.kind === 'repair' && t.room) return plan.room[t.room];
  if (t.kind === 'feed' && t.line) {
    const m = plan.plant.lines.find(l => l.id === t.line)!.machines[0];
    return { x: m.at[0], z: m.at[1] };
  }
  if (t.truck && s.trucks[t.truck]) return pointOf(plan, s, { kind: 'truck', id: t.truck });
  const u = t.dest ? s.units[t.dest] : undefined;
  return u?.where.kind === 'slot' ? plan.slot[u.where.id] : undefined;
}

export function levelOf(plan: PlantPlan, p: Place | string | undefined): number {
  if (!p) return 0;
  if (typeof p === 'string') return plan.slot[p].level;
  return p.kind === 'slot' ? plan.slot[p.id].level : 0;
}

/**
 * Один проход раздатчика: план, день завода, люди и где они сейчас — у идущих на пост точка маршрута считается один раз.
 * Люди за проход не приходят и не уходят: их список один.
 */
interface Pass {
  plan: PlantPlan;
  day: number;
  people: readonly Person[];
  where: (p: Person) => Point;
}

/**
 * Ближайший свободный человек ролей задачи, который может взять задачу сейчас и допущен ко всему из `need` и `more`; при
 * равенстве — меньший номер.
 */
function nearestPerson(db: ContentDb, s: PlantState, x: Pass, t: Task, at: Point, need: readonly string[], skip: Set<string>, more: readonly string[] = []): Person | undefined {
  let best: Person | undefined;
  let bestD = 0;
  for (const p of x.people) {
    if (skip.has(p.id) || !t.roles.includes(p.role) || t.not?.includes(p.id) || !canTake(db, s, p) || !admitted(db, p, need, x.day) || !admitted(db, p, more, x.day)) continue;
    const d = dist(x.plan, x.where(p), at);
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
  const at = new Map<string, Point>();
  const where = (p: Person) => {
    let q = at.get(p.id);
    if (!q) at.set(p.id, (q = here(plan, p, s.t)));
    return q;
  };
  const x: Pass = { plan, day: momentOf(s.start, s.t).day, people: Object.values(s.people), where };
  for (const id of [...s.open]) {
    const t = s.tasks[id];
    const why = assign(db, s, x, t);
    if (why === undefined) s.open.splice(s.open.indexOf(id), 1);
    else {
      if (why !== 'qual') delete t.lack;
      waitNote(s, t, why);
    }
  }
}

/** Человек в смене, и до её конца не меньше `LAST_CALL`. */
const onShift = (db: ContentDb, s: PlantState, p: Person) => (shiftEnd(db, s, p) ?? s.t) - s.t >= LAST_CALL;

/**
 * Люди ролей задачи в смене есть, допущенных среди них не меньше, чем задаче нужно (или чем людей в смене), но они заняты,
 * — «люди»; в смене есть, но допущенных не хватает — «нет допуска» и документ, которого нет у первого недопущенного; в
 * смене их нет (или смена вот-вот кончится) — «смена».
 */
function crewWait(db: ContentDb, s: PlantState, x: Pass, t: Task, need: readonly string[]): WaitCause {
  let on = 0;
  let ok = 0;
  let lack: string | undefined;
  for (const p of x.people) {
    if (!t.roles.includes(p.role) || !onShift(db, s, p)) continue;
    on++;
    const miss = lacking(db, p, need, x.day);
    if (miss !== undefined) lack ??= miss;
    else if (++ok >= t.count) return 'people';
  }
  if (on === 0) return 'shift';
  // допущенных меньше, чем нужно задаче: «люди» — только если допущены все, кто в смене
  if (ok === on) return 'people';
  t.lack = lack;
  return 'qual';
}

/**
 * Свободной технике не нашлось водителя: если люди работы есть и допущены к ней, но ни один из них в смене не допущен ни
 * к одной свободной технике, — «нет допуска» к технике.
 */
function driverWait(db: ContentDb, s: PlantState, x: Pass, t: Task, need: readonly string[], free: readonly Vehicle[]): WaitCause {
  const why = crewWait(db, s, x, t, need);
  if (why !== 'people') return why;
  let lack: string | undefined;
  for (const v of free) {
    const drive = vehicleNeed(db, v.type);
    for (const p of x.people) {
      if (!t.roles.includes(p.role) || !onShift(db, s, p) || !admitted(db, p, need, x.day)) continue;
      const miss = lacking(db, p, drive, x.day);
      if (miss === undefined) return 'people';
      lack ??= miss;
    }
  }
  t.lack = lack;
  return 'qual';
}

/** Назначить задачу; не вышло — причина: прибор, техника, место назначения, люди, допуск. */
function assign(db: ContentDb, s: PlantState, x: Pass, t: Task): WaitCause | undefined {
  const plan = x.plan;
  // обучение — только того, кто учится: ни техники, ни прибора, ни допуска; ждёт, пока он свободен и в смене
  if (t.kind === 'train') {
    const p = s.people[t.trainee!];
    if (!p || !canTake(db, s, p)) return p && onShift(db, s, p) ? 'people' : 'shift';
    start(db, s, plan, t, [p], undefined, undefined, undefined);
    return undefined;
  }
  const need = needOf(db, s, t);
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
      const driver = nearestPerson(db, s, x, t, v, need, new Set(), vehicleNeed(db, v.type));
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
    return place ? 'place' : driverWait(db, s, x, t, need, free);
  }
  const people: Person[] = [];
  const skip = new Set<string>();
  for (let i = 0; i < t.count; i++) {
    const p = nearestPerson(db, s, x, t, from, need, skip);
    if (!p) return crewWait(db, s, x, t, need);
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
  delete t.lack;
  // кто шёл на пост — остановился там, где его застала задача: путь к ней — оттуда
  for (const p of people) stopWalk(db, s, p);
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
    // к посту, где учатся (Б3б), идут люди своего участка
    const area = t.kind === 'train' ? db.roles[people[0].role].dept : undefined;
    moved(s, t.kind, people.reduce((n, p) => n + dist(plan, p, from), 0), people.reduce((n, p) => n + travel(plan, p, from, WALK), 0), 0, dest ? dist(plan, from, dest) : 0, carry, area);
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
  // первое смешивание: к короткому номеру серии — месяц и год начала работы (batchno.ts)
  if (t.kind === 'stage') mixStart(db, s, t);
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
