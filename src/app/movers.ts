// Где люди и техника сейчас (docs/specs/2026-10-view.md, 2б): чистая функция задач среза и часов. Задача в движке — пять
// времён (начало, у груза, отъезд с грузом, у места, конец); здесь между ними — путь по тем же маршрутам плана (`route`) и
// с той же длительностью (`travel`), что считает раздатчик (`src/engine/tasks.ts`). Поэтому человек приходит к паллете ровно
// тогда, когда движок начинает работу, а паллета едет ровно столько, сколько длится задача (`13-art.md`, §2). Человек без
// задачи идёт на пост или к выходу тем же маршрутом и столько же, сколько считает движок (docs/specs/2026-10-panels.md,
// 3а). Без Three.js и DOM: проверяют тесты в Bun.
import type { ContentDb } from '../content/types';
import { accessOf, cellOf, centerOf, type Mover, type Point, polylineLength, route } from '../engine/nav';
import { type PlantPlan, travel } from '../engine/plant';
import { WALK } from '../engine/tasks';
import { ICON_OF, type IconKind } from '../render/taskicons';
import type { PersonRow, TaskRow, VehicleRow } from '../sim/pack';

/** Что делает человек: идёт, стоит (ждёт или работает), едет на технике. */
export type Doing = 'walk' | 'stand' | 'ride';

export interface Figure {
  person: number;
  role: number;
  /** м */
  x: number;
  z: number;
  /** куда смотрит: угол от +z к +x, рад (как у камеры и моделей) */
  heading: number;
  doing: Doing;
  /** номер техники, на которой едет или которую ведёт */
  vehicle?: number;
}

export interface Machine {
  vehicle: number;
  type: number;
  /** точка груза — середина вил, м: по маршруту едет груз, корпус — за ним */
  x: number;
  z: number;
  heading: number;
  /** на каком ярусе вилы: 0 — пол; дробное — между ярусами */
  fork: number;
  moving: boolean;
  /** паллета на вилах */
  load?: number;
}

/** Паллета, которую сейчас везут: где она, на каком ярусе и вдоль чего длинная сторона. */
export interface Carried {
  unit: number;
  x: number;
  z: number;
  level: number;
  heading: number;
  /** уже поставлена на место назначения, но движок ещё не закрыл задачу */
  placed: boolean;
}

export interface Movers {
  people: Figure[];
  vehicles: Machine[];
  carried: Carried[];
}

/** Подъём вил на месте: доля времени подъёма, после которой груз уже на вилах (или уже на месте при опускании). */
const GRAB = 0.5;
/** Ярус вил в пути: чуть над полом. */
const TRAVEL_FORK = 0.08;

/** Точка на ломаной на расстоянии `d` от начала, см; и куда смотрит отрезок. */
export function along(pts: readonly Point[], d: number): { x: number; z: number; heading: number } {
  let left = Math.max(0, d);
  let heading = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
    if (len === 0) continue;
    heading = Math.atan2(b.x - a.x, b.z - a.z);
    if (left <= len) {
      const k = left / len;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, heading };
    }
    left -= len;
  }
  const last = pts[pts.length - 1];
  return { x: last.x, z: last.z, heading };
}

/** Последний отрезок ломаной: куда смотрит тот, кто пришёл по ней. */
function endHeading(pts: readonly Point[], fallback: number): number {
  for (let i = pts.length - 1; i >= 1; i--) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a.x !== b.x || a.z !== b.z) return Math.atan2(b.x - a.x, b.z - a.z);
  }
  return fallback;
}

/** Путь за отрезок времени: где на маршруте в момент `t` между `t0` и `t1`. */
function onLeg(plan: PlantPlan, a: Point, b: Point, mover: Mover, t0: number, t1: number, t: number) {
  const pts = route(plan.nav, a, b, mover);
  const len = polylineLength(pts);
  const k = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
  return { ...along(pts, len * k), end: endHeading(pts, 0), moving: k > 0 && k < 1 && len > 0 };
}

const m = (cm: number) => cm / 100;
const manhattan = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);

/**
 * Где человек стоит у точки: в её клетке, если по ней можно пройти; иначе — в середине клетки доступа (у машины, у
 * стеллажа), лицом к точке. Внутрь машины и стеллажа люди не заходят — туда ведёт только хвост маршрута.
 */
export function standPoint(plan: PlantPlan, p: Point): { x: number; z: number; heading?: number } {
  const nav = plan.nav;
  if (nav.walk[cellOf(nav, p)]) return { x: p.x, z: p.z };
  const c = accessOf(nav, p, 'walk');
  if (c < 0) return { x: p.x, z: p.z };
  const at = centerOf(nav, c);
  return { ...at, heading: Math.atan2(p.x - at.x, p.z - at.z) };
}

/**
 * Пеший путь за отрезок времени: где человек на маршруте в момент `t`. Начало и конец маршрута внутри машины или стеллажа
 * отрезаны: человек выходит из клетки доступа и останавливается в ней (`standPoint`).
 */
function walkLeg(plan: PlantPlan, a: Point, b: Point, t0: number, t1: number, t: number) {
  const nav = plan.nav;
  const pts = route(nav, a, b, 'walk');
  const len = polylineLength(pts);
  const k = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
  const lo = nav.walk[cellOf(nav, a)] ? 0 : Math.min(len, manhattan(a, centerOf(nav, accessOf(nav, a, 'walk'))));
  const hi = Math.max(lo, nav.walk[cellOf(nav, b)] ? len : len - manhattan(centerOf(nav, accessOf(nav, b, 'walk')), b));
  const d = Math.min(hi, Math.max(lo, len * k));
  return { ...along(pts, d), moving: d > lo && d < hi };
}

/**
 * Люди и техника в момент `t` (игровые секунды) по срезу. Кто вне завода — не в списке. Несколько человек в одной точке
 * расходятся по кругу (`standAt`) — это только картинка.
 */
export function moversAt(db: ContentDb, plan: PlantPlan, tasks: readonly TaskRow[], people: readonly PersonRow[], vehicles: readonly VehicleRow[], t: number): Movers {
  const vehTypes = Object.keys(db.vehicles);
  const outPeople: Figure[] = [];
  const outVeh: Machine[] = [];
  const carried: Carried[] = [];
  const byTask = new Map<number, PersonRow[]>();
  for (const p of people) {
    if (p.task < 0) continue;
    const list = byTask.get(p.task) ?? [];
    list.push(p);
    byTask.set(p.task, list);
  }
  const vehOfTask = new Map<number, VehicleRow>();
  for (const v of vehicles) if (v.task >= 0) vehOfTask.set(v.task, v);

  // техника без задачи — где стоит: у стеллажа — лицом к нему (вилы у места, корпус в проходе); с задачей — по фазам задачи
  for (const v of vehicles) {
    if (v.task >= 0) continue;
    outVeh.push({ vehicle: v.vehicle, type: v.type, x: m(v.x), z: m(v.z), heading: parkHeading(plan, v), fork: 0, moving: false });
  }

  tasks.forEach((tk, ti) => {
    const crew = (byTask.get(ti) ?? []).slice().sort((a, b) => a.person - b.person);
    const [t0, t1, t2, t3] = tk.times;
    const v = vehOfTask.get(ti);
    if (v) {
      const vt = db.vehicles[vehTypes[v.type]];
      const driver = crew[0];
      const start = { x: v.x, z: v.z };
      const dest = tk.dest ?? tk.from;
      const levelFrom = tk.fromSlot >= 0 ? plan.slots[tk.fromSlot].level : 0;
      const levelTo = tk.toSlot >= 0 ? plan.slots[tk.toSlot].level : 0;
      const lower = tk.toSlot >= 0 ? vt.liftBase + levelTo * vt.liftPerLevel : 0;
      const walk = driver ? travel(plan, { x: driver.x, z: driver.z }, start, WALK) : 0;
      const ride = t0 + walk;
      let pos: { x: number; z: number; heading: number };
      let fork = TRAVEL_FORK;
      let moving = false;
      let load: number | undefined;
      if (t < ride) {
        pos = { ...start, heading: Math.PI / 2 };
        fork = 0;
      } else if (t < t1) {
        const leg = onLeg(plan, start, tk.from, 'drive', ride, t1, t);
        pos = leg;
        moving = leg.moving;
      } else if (t < t2) {
        // подъём у груза: вилы на ярус груза и обратно; груз — на вилах со второй половины
        const leg = onLeg(plan, start, tk.from, 'drive', ride, t1, t1);
        pos = { x: leg.x, z: leg.z, heading: leg.end };
        const k = t2 > t1 ? (t - t1) / (t2 - t1) : 1;
        fork = k < GRAB ? TRAVEL_FORK + (levelFrom - TRAVEL_FORK) * (k / GRAB) : levelFrom + (TRAVEL_FORK - levelFrom) * ((k - GRAB) / (1 - GRAB));
        if (k >= GRAB && tk.unit >= 0) load = tk.unit;
      } else if (t < t3) {
        const leg = onLeg(plan, tk.from, dest, 'drive', t2, t3, t);
        pos = leg;
        moving = leg.moving;
        if (tk.unit >= 0) load = tk.unit;
      } else {
        const leg = onLeg(plan, tk.from, dest, 'drive', t2, t3, t3);
        pos = { x: leg.x, z: leg.z, heading: leg.end };
        const k = lower > 0 ? Math.min(1, (t - t3) / lower) : 1;
        fork = k < GRAB ? TRAVEL_FORK + (levelTo - TRAVEL_FORK) * (k / GRAB) : levelTo + (TRAVEL_FORK - levelTo) * ((k - GRAB) / (1 - GRAB));
        if (k < GRAB && tk.unit >= 0) load = tk.unit;
        else if (tk.unit >= 0) carried.push({ unit: tk.unit, x: m(dest.x), z: m(dest.z), level: levelTo, heading: leg.end, placed: true });
      }
      if (load !== undefined) carried.push({ unit: load, x: m(pos.x), z: m(pos.z), level: Math.max(0, fork), heading: pos.heading, placed: false });
      outVeh.push({ vehicle: v.vehicle, type: v.type, x: m(pos.x), z: m(pos.z), heading: pos.heading, fork: Math.max(0, fork), moving, ...(load !== undefined ? { load } : {}) });
      if (driver) {
        if (t < ride) {
          const leg = walkLeg(plan, { x: driver.x, z: driver.z }, start, t0, ride, t);
          outPeople.push({ person: driver.person, role: driver.role, x: m(leg.x), z: m(leg.z), heading: leg.heading, doing: leg.moving ? 'walk' : 'stand' });
        } else {
          outPeople.push({ person: driver.person, role: driver.role, x: m(pos.x), z: m(pos.z), heading: pos.heading, doing: 'ride', vehicle: v.vehicle });
        }
      }
      // прочие люди задачи с техникой — у груза, как пешие
      crew.slice(1).forEach((p, k) => outPeople.push(standAt(plan, p, tk.from, k + 1, crew.length)));
      return;
    }
    // пешком: каждый идёт к месту своим путём, ждёт остальных, несёт к месту назначения (если оно есть) и там работает
    crew.forEach((p, k) => {
      const startP = { x: p.x, z: p.z };
      const walk = travel(plan, startP, tk.from, WALK);
      if (t < t0 + walk) {
        const leg = walkLeg(plan, startP, tk.from, t0, t0 + walk, t);
        outPeople.push({ person: p.person, role: p.role, x: m(leg.x), z: m(leg.z), heading: leg.heading, doing: leg.moving ? 'walk' : 'stand' });
      } else if (t < t2 || !tk.dest) {
        outPeople.push(standAt(plan, p, tk.from, k, crew.length));
      } else if (t < t3) {
        const leg = walkLeg(plan, tk.from, tk.dest, t2, t3, t);
        outPeople.push({ person: p.person, role: p.role, x: m(leg.x), z: m(leg.z), heading: leg.heading, doing: leg.moving ? 'walk' : 'stand' });
      } else {
        outPeople.push(standAt(plan, p, tk.dest, k, crew.length));
      }
    });
  });

  // люди без задачи — идут на пост или к выходу своим маршрутом, дошедшие стоят там; вне завода — не видны
  const idle: PersonRow[] = [];
  for (const p of people) {
    if (p.task >= 0 || !p.present) continue;
    const w = p.walk;
    if (w) {
      const to = { x: p.x, z: p.z };
      const t1 = w.t + travel(plan, w, to, WALK);
      if (t < t1) {
        const leg = walkLeg(plan, w, to, w.t, t1, t);
        outPeople.push({ person: p.person, role: p.role, x: m(leg.x), z: m(leg.z), heading: leg.heading, doing: leg.moving ? 'walk' : 'stand' });
        continue;
      }
    }
    idle.push(p);
  }
  const groups = new Map<string, PersonRow[]>();
  for (const p of idle) {
    const key = `${p.x},${p.z}`;
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.person - b.person).forEach((p, k) => outPeople.push(standAt(plan, p, { x: p.x, z: p.z }, k, list.length)));
  }
  return { people: outPeople, vehicles: outVeh, carried };
}

/** Куда смотрит техника без задачи: у стеллажа — на стеллаж, из середины клетки доступа; иначе — на восток. */
function parkHeading(plan: PlantPlan, v: Point): number {
  const nav = plan.nav;
  if (nav.drive[cellOf(nav, v)]) return Math.PI / 2;
  const c = accessOf(nav, v, 'drive');
  if (c < 0) return Math.PI / 2;
  const at = centerOf(nav, c);
  return at.x === v.x && at.z === v.z ? Math.PI / 2 : Math.atan2(v.x - at.x, v.z - at.z);
}

/** Шаг сетки, на которой стоят несколько человек у одной точки, м. */
const CROWD_STEP = 0.8;
/** Двое-трое у одной точки стоят плечом к плечу с таким шагом, м: на 0,35 м от точки люди сливались в одного. */
export const SIDE_STEP = 0.9;

/**
 * Человек стоит у точки (`standPoint`). Двое-трое — плечом к плечу с шагом `SIDE_STEP`, лицом туда же, куда смотрит
 * точка (к машине); не помещаются на проходимом полу или их больше — по квадратной спирали с шагом `CROWD_STEP` по
 * проходимым клеткам: у входа после смены собирается два десятка человек.
 */
function standAt(plan: PlantPlan, p: PersonRow, at: Point, k: number, n: number): Figure {
  const sp = standPoint(plan, at);
  const nav = plan.nav;
  const heading = sp.heading ?? Math.PI;
  if (n === 1) return { person: p.person, role: p.role, x: m(sp.x), z: m(sp.z), heading, doing: 'stand' };
  if (n <= 3) {
    // поперёк взгляда: взгляд — (sin h, cos h), плечо — (cos h, −sin h)
    const off = (i: number) => (i - (n - 1) / 2) * SIDE_STEP;
    const spot = (i: number) => ({ x: m(sp.x) + off(i) * Math.cos(heading), z: m(sp.z) - off(i) * Math.sin(heading) });
    const fits = Array.from({ length: n }, (_, i) => spot(i)).every(q => nav.walk[cellOf(nav, { x: q.x * 100, z: q.z * 100 })]);
    if (fits) return { person: p.person, role: p.role, ...spot(k), heading, doing: 'stand' };
  }
  let seen = 0;
  for (const [dx, dz] of spiral()) {
    const x = m(sp.x) + dx * CROWD_STEP;
    const z = m(sp.z) + dz * CROWD_STEP;
    if (!nav.walk[cellOf(nav, { x: x * 100, z: z * 100 })]) continue;
    if (seen++ === k) return { person: p.person, role: p.role, x, z, heading, doing: 'stand' };
  }
  return { person: p.person, role: p.role, x: m(sp.x), z: m(sp.z), heading, doing: 'stand' };
}

/** Квадратная спираль от середины: (0,0), (1,0), (1,1), (0,1), (−1,1)… — до 12 колец. */
function* spiral(): Generator<[number, number]> {
  yield [0, 0];
  for (let r = 1; r <= 12; r++) {
    for (let i = -r + 1; i <= r; i++) yield [r, i];
    for (let i = r - 1; i >= -r; i--) yield [i, r];
    for (let i = r - 1; i >= -r; i--) yield [-r, i];
    for (let i = -r + 1; i <= r; i++) yield [i, -r];
  }
}

/**
 * Значок работы каждого занятого человека (Б1б; src/render/taskicons.ts): по виду его задачи в срезе. Без задачи — нет
 * значка: человек идёт на пост, к выходу или ждёт.
 */
export function taskIcons(tasks: readonly TaskRow[], people: readonly PersonRow[]): Map<number, IconKind> {
  const out = new Map<number, IconKind>();
  for (const p of people) {
    const t = p.task >= 0 ? tasks[p.task] : undefined;
    if (t) out.set(p.person, ICON_OF[t.kind]);
  }
  return out;
}
