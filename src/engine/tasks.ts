// Задачи и раздатчик (docs/specs/2026-10-engine.md, 1а, «Люди, смены, задачи, техника»; 1б). Задача — работа для людей
// роли, иногда с техникой или прибором: перевезти паллету, принять, отобрать пробы, провести испытание. Раздатчик берёт
// открытые задачи по порядку (приоритет, время создания, номер) и даёт каждой ближайших свободных людей в смене,
// ближайшую свободную технику и свободный прибор. Длина задачи считается сразу: дорога, подъём, работа. Конец — событие
// с версией задачи. Задача не досталась никому — раздатчик называет причину, а путь назначенной — потери (lean.ts).
// Человек, который идёт без задачи на пост (staff.ts), свободен: расстояние меряется от точки маршрута, где он сейчас.
// Задачу берёт только допущенный (Б3б, quals.ts): у кого есть записи обучения по всему, что нужно для работы и для
// техники; есть люди роли в смене, но ни один не допущен, — задача ждёт «нет допуска» и называет документ. Прибор
// лаборатории берётся только пригодный, а место хранения — в зоне, которая принимает режим материала и чей датчик в сроке
// (Б3в, assets.ts): иначе задача ждёт актив и называет его. Задачу берёт только тот, у кого она с дорогой по норме и с
// запасом на разброс помещается в остаток смены и в сверхурочные, которые ему ещё можно (Б4а, hours.ts): свободные
// допущенные люди в смене есть, но ни у кого не помещается, — задача ждёт «нет часов». Работу роли того, кто в отпуске,
// берёт и его заместитель — в свои смены, по своим допускам (Б4г, leave.ts); людей роли в смене нет, а кто-то из них в
// отпуске и был бы в смене, — задача ждёт «в отпуске».
import type { ContentDb, Id, ZoneKind } from '../content/types';
import { slotFit, unfit } from './assets';
import { mixStart } from './batchno';
import { schedule } from './core/agenda';
import { momentOf } from './core/calendar';
import { endTask, fits, startTask } from './hours';
import { awayOn, coversOn } from './leave';
import { moved, waitEnd, waitNote } from './lean';
import { placesOf } from './places';
import { dist, type PlantPlan, planOf, type Point, travel } from './plant';
import { admitted, lacking, needOf, vehicleNeed } from './quals';
import { canTake, goHome, here, LAST_CALL, shiftEnd, shiftEndAt, stopWalk, WALK } from './staff';
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
  asset?: string;
  pair?: string;
  dev?: string;
  norm?: [number, number];
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
  /** зоны хранения, которые не принимают новых паллет (Б3в): зона → её датчик */
  closed: ReadonlyMap<string, string>;
  /** кого замещают сегодня (Б4г): заместитель → роли ушедших в отпуск */
  cover: ReadonlyMap<string, readonly Id[]>;
}

/** Берёт ли человек работу этих ролей: своей роли или роли того, кого сегодня замещает (Б4г). */
function takes(x: Pass, p: Person, roles: readonly Id[]): boolean {
  if (roles.includes(p.role)) return true;
  const c = x.cover.get(p.id);
  return !!c && c.some(r => roles.includes(r));
}

/**
 * Ближайший свободный человек ролей задачи, который может взять задачу сейчас, допущен ко всему из `need` и `more` и
 * подходит по `ok` (у него задача помещается в часы, Б4а); при равенстве — меньший номер. Никого, а `ok` кого-то
 * отклонил, — `miss.hours`: так задача ждёт «нет часов», а не людей, без второго поиска.
 */
function nearestPerson(db: ContentDb, s: PlantState, x: Pass, t: Task, at: Point, need: readonly string[], skip: Set<string>, more: readonly string[] = [], ok?: (p: Person) => boolean, miss?: { hours: boolean }): Person | undefined {
  let best: Person | undefined;
  let bestD = 0;
  for (const p of x.people) {
    if (skip.has(p.id) || !takes(x, p, t.roles) || t.not?.includes(p.id) || !canTake(db, s, p) || !admitted(db, p, need, x.day) || !admitted(db, p, more, x.day)) continue;
    const d = dist(x.plan, x.where(p), at);
    if (!best || d < bestD || (d === bestD && idNum(p.id) < idNum(best.id))) {
      if (ok && !ok(p)) {
        if (miss) miss.hours = true;
        continue;
      }
      best = p;
      bestD = d;
    }
  }
  return best;
}

/**
 * Помещается ли задача у этих людей с этой техникой и местом (Б4а): от сейчас до её конца — дорога и работа по норме и
 * по наибольшей длительности — в остаток смены каждого и в сверхурочные, которые ему ещё можно (hours.ts).
 */
function fitsAll(db: ContentDb, s: PlantState, x: Pass, t: Task, people: readonly Person[], v: Vehicle | undefined, to: string | undefined): boolean {
  const pos = people.map(x.where);
  const lead = timesOf(db, s, x.plan, t, pos, v, to, 0)[4] - s.t;
  const work = t.kind === 'crew' ? crewWork(db, s, people, s.t + lead) : t.work;
  const [nom, max] = t.norm ?? [work, work];
  return people.every(p => fits(db, s, p, t.kind, shiftEnd(db, s, p)!, lead + nom, lead + max));
}

/** Смена у линии — до конца смены того, у кого она кончается раньше; люди у линии с мгновения `at`. */
function crewWork(db: ContentDb, s: PlantState, people: readonly Person[], at: number): number {
  return Math.max(1, Math.min(...people.map(p => shiftEnd(db, s, p)!)) - at);
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
  const day = momentOf(s.start, s.t).day;
  const x: Pass = { plan, day, people: Object.values(s.people), where, closed: closedStores(db, s, plan, day), cover: coversOn(s, day) };
  for (const id of [...s.open]) {
    const t = s.tasks[id];
    const why = assign(db, s, x, t);
    if (why === undefined) s.open.splice(s.open.indexOf(id), 1);
    else {
      if (why !== 'qual') delete t.lack;
      if (why !== 'asset') delete t.unfit;
      waitNote(s, t, why);
    }
  }
}

/** Человек в смене, и до её конца не меньше `LAST_CALL`. */
const onShift = (db: ContentDb, s: PlantState, p: Person) => (shiftEnd(db, s, p) ?? s.t) - s.t >= LAST_CALL;

/**
 * Люди ролей задачи в смене есть, допущенных среди них не меньше, чем задаче нужно (или чем людей в смене), но они заняты,
 * — «люди»; в смене есть, но допущенных не хватает — «нет допуска» и документ, которого нет у первого недопущенного; в
 * смене их нет (или смена вот-вот кончится) — «смена», а если кто-то из них в отпуске и сейчас был бы в смене — «в
 * отпуске» (Б4г).
 */
function crewWait(db: ContentDb, s: PlantState, x: Pass, t: Task, need: readonly string[]): WaitCause {
  let on = 0;
  let ok = 0;
  let lack: string | undefined;
  for (const p of x.people) {
    if (!takes(x, p, t.roles) || !onShift(db, s, p)) continue;
    on++;
    const miss = lacking(db, p, need, x.day);
    if (miss !== undefined) lack ??= miss;
    else if (++ok >= t.count) return 'people';
  }
  if (on === 0) return x.people.some(p => t.roles.includes(p.role) && p.away && awayOn(p, x.day) && shiftEndAt(db, s, { ...p, away: undefined }, s.t) !== undefined) ? 'leave' : 'shift';
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
      if (!takes(x, p, t.roles) || !onShift(db, s, p) || !admitted(db, p, need, x.day)) continue;
      const miss = lacking(db, p, drive, x.day);
      if (miss === undefined) return 'people';
      lack ??= miss;
    }
  }
  t.lack = lack;
  return 'qual';
}

/** Зоны хранения с датчиком, который не пригоден (Б3в): поверка вышла или у него подрядчик — зона → датчик. */
function closedStores(db: ContentDb, s: PlantState, plan: PlantPlan, day: number): Map<string, string> {
  const out = new Map<string, string>();
  for (const [store, sensor] of Object.entries(placesOf(plan.plant).sensorOf)) if (unfit(db, s, sensor, day)) out.set(store, sensor);
  return out;
}

/** Назначить задачу; не вышло — причина: прибор, техника, место назначения, люди, допуск, актив. */
function assign(db: ContentDb, s: PlantState, x: Pass, t: Task): WaitCause | undefined {
  const plan = x.plan;
  // обучение — только того, кто учится: ни техники, ни прибора, ни допуска; ждёт, пока он свободен и в смене
  if (t.kind === 'train') {
    const p = s.people[t.trainee!];
    if (!p || !canTake(db, s, p)) return p && onShift(db, s, p) ? 'people' : 'shift';
    if (!fitsAll(db, s, x, t, [p], undefined, undefined)) return 'hours';
    start(db, s, plan, t, [p], undefined, undefined, undefined);
    return undefined;
  }
  const need = needOf(db, s, t);
  const from = pointOf(plan, s, t.from);
  const fromLevel = levelOf(plan, t.from);
  // прибор — первый свободный и пригодный нужного вида в порядке плана; пригодного нет, а занятого пригодного тоже нет —
  // задача ждёт актив и называет первый непригодный (Б3в)
  let inst: Instrument | undefined;
  if (t.inst) {
    let held = false;
    let bad: string | undefined;
    for (const i of Object.values(s.instruments)) {
      if (!t.inst.includes(i.type)) continue;
      if (unfit(db, s, i.id, x.day)) bad ??= i.id;
      else if (i.test) held = true;
      else {
        inst = i;
        break;
      }
    }
    if (!inst) {
      if (held || !bad) return 'instrument';
      t.unfit = bad;
      return 'asset';
    }
  }
  // место хранения (Б3в): зона принимает режим материала и открыта; не нашлось только из-за закрытой зоны — ждёт её датчик
  const fit = t.toKind ? slotFit(db, s, x.plan, t, x.closed) : undefined;
  if (t.veh) {
    // техника, ближайшая к грузу, с водителем; место назначения — по силам этой технике
    const free = Object.values(s.vehicles)
      .filter(v => !v.task && t.veh!.includes(v.type) && db.vehicles[v.type].levels >= fromLevel)
      .sort((a, b) => dist(plan, a, from, 'drive') - dist(plan, b, from, 'drive') || idNum(a.id) - idNum(b.id));
    if (free.length === 0) return 'vehicle';
    let place = false;
    let short = false;
    let closedBy: string | undefined;
    for (const v of free) {
      const vt = db.vehicles[v.type];
      const drive = vehicleNeed(db, v.type);
      const near = nearestPerson(db, s, x, t, v, need, new Set(), drive);
      if (!near) continue;
      let to: string | undefined;
      if (t.toKind) {
        const sl = findSlot(s, plan, t.toKind, t.near ?? from, vt.levels, 'drive', fit?.ok);
        if (!sl) {
          if (!place && fit) closedBy = findSlot(s, plan, t.toKind, t.near ?? from, vt.levels, 'drive', fit.open)?.store;
          place = true;
          continue;
        }
        to = sl.id;
      }
      // ближайшему водителю задача не помещается в часы — ближайший, у кого помещается (Б4а)
      const driver = fitsAll(db, s, x, t, [near], v, to) ? near : nearestPerson(db, s, x, t, v, need, new Set([near.id]), drive, p => fitsAll(db, s, x, t, [p], v, to));
      if (!driver) {
        short = true;
        continue;
      }
      start(db, s, plan, t, [driver], v, to, inst);
      return undefined;
    }
    if (place && closedBy) {
      t.unfit = x.closed.get(closedBy);
      return 'asset';
    }
    return place ? 'place' : short ? 'hours' : driverWait(db, s, x, t, need, free);
  }
  // пешком, но с местом назначения на полу (возврат остатков в шлюз): место — ближе к началу задачи; его нет — задача
  // ждёт место, но сначала — людей
  const sl = t.toKind ? findSlot(s, plan, t.toKind, t.near ?? from, 0, 'walk', fit?.ok) : undefined;
  const people: Person[] = [];
  const skip = new Set<string>();
  const noPlace = !!t.toKind && !sl;
  for (let i = 0; i < t.count; i++) {
    // у каждого следующего — задача всей группы с ним помещается в часы у всех (Б4а)
    const ok = noPlace ? undefined : (p: Person) => fitsAll(db, s, x, t, [...people, p], undefined, sl?.id);
    const miss = { hours: false };
    const p = nearestPerson(db, s, x, t, from, need, skip, [], ok, miss);
    if (!p) return miss.hours ? 'hours' : crewWait(db, s, x, t, need);
    people.push(p);
    skip.add(p.id);
  }
  if (noPlace) {
    const by = fit ? findSlot(s, plan, t.toKind!, t.near ?? from, 0, 'walk', fit.open)?.store : undefined;
    if (!by) return 'place';
    t.unfit = x.closed.get(by);
    return 'asset';
  }
  start(db, s, plan, t, people, undefined, sl?.id, inst);
  return undefined;
}

/**
 * Времена задачи у людей в точках `pos` (по порядку людей) с этой техникой и местом и работой `work` на месте: начало,
 * у груза, взял, у места, конец. Ничего не меняет — по ним раздатчик решает, помещается ли задача в часы (Б4а).
 */
function timesOf(db: ContentDb, s: PlantState, plan: PlantPlan, t: Task, pos: readonly Point[], v: Vehicle | undefined, to: string | undefined, work: number): [number, number, number, number, number] {
  const from = pointOf(plan, s, t.from);
  const t0 = s.t;
  if (v) {
    const vt = db.vehicles[v.type];
    const atLoad = t0 + travel(plan, pos[0], v, WALK) + travel(plan, v, from, vt.speedEmpty, 'drive');
    const off = atLoad + vt.liftBase + levelOf(plan, t.from) * vt.liftPerLevel;
    const atDrop = off + travel(plan, from, to ? plan.slot[to] : (destOf(plan, s, t) ?? from), vt.speedLoaded, 'drive');
    return [t0, atLoad, off, atDrop, atDrop + (to ? vt.liftBase + plan.slot[to].level * vt.liftPerLevel : 0) + work];
  }
  // пешком: дойти, взять, донести до места назначения (если оно есть) и там работать
  const walk = Math.max(...pos.map(p => travel(plan, p, from, WALK)));
  const dest = to ? plan.slot[to] : destOf(plan, s, t);
  const carry = dest ? travel(plan, from, dest, WALK) : 0;
  return [t0, t0 + walk, t0 + walk, t0 + walk + carry, t0 + walk + carry + work];
}

function start(db: ContentDb, s: PlantState, plan: PlantPlan, t: Task, people: Person[], v: Vehicle | undefined, to: string | undefined, inst: Instrument | undefined) {
  const from = pointOf(plan, s, t.from);
  waitEnd(s, t);
  delete t.lack;
  delete t.unfit;
  // кто шёл на пост — остановился там, где его застала задача: путь к ней — оттуда
  for (const p of people) stopWalk(db, s, p);
  // смена у линии — до конца смены того, у кого она кончается раньше; линия узнаёт о приходе людей событием
  if (t.kind === 'crew') {
    const at = timesOf(db, s, plan, t, people, v, to, 0)[1];
    t.work = crewWork(db, s, people, at);
    schedule(s.agenda, at, { kind: 'line', id: t.line!, v: -1 });
  }
  const times = timesOf(db, s, plan, t, people, v, to, t.work);
  if (v) {
    const vt = db.vehicles[v.type];
    const dest = to ? plan.slot[to] : (destOf(plan, s, t) ?? from);
    v.task = t.id;
    t.vehicle = v.id;
    // водитель идёт к технике — перемещение; техника едет порожняком и с грузом — транспортировка
    moved(s, t.kind, dist(plan, people[0], v), travel(plan, people[0], v, WALK), dist(plan, v, from, 'drive'), dist(plan, from, dest, 'drive'), travel(plan, v, from, vt.speedEmpty, 'drive') + travel(plan, from, dest, vt.speedLoaded, 'drive'));
  } else {
    const dest = to ? plan.slot[to] : destOf(plan, s, t);
    // каждый идёт к месту — перемещение; груз на руках — транспортировка
    // к посту, где учатся (Б3б), и к активу, чью работу принимают (Б3в), идут люди своего участка
    const area = t.kind === 'train' || t.kind === 'accept' ? db.roles[people[0].role].dept : undefined;
    moved(s, t.kind, people.reduce((n, p) => n + dist(plan, p, from), 0), people.reduce((n, p) => n + travel(plan, p, from, WALK), 0), 0, dest ? dist(plan, from, dest) : 0, times[3] - times[2], area);
  }
  // до конца смены — работа по графику, после — сверхурочная (Б4а)
  for (const p of people) startTask(p, shiftEnd(db, s, p)!);
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
    // работа после конца смены — в табель сверхурочно (Б4а); кончил после смены — уходит через вход
    endTask(db, s, p);
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
