// Упакованный срез для отрисовки (docs/02-architecture.md, §10; docs/specs/2026-10-view.md, «Срез 2а», «Срез 2б»):
// `Int32Array` уходит из потока расчёта без копии (transferList). Формат 3: заголовок, помещения, фуры, изменённые и ушедшие
// паллеты, задачи в работе, люди, техника. Строк в срезе нет: номера мест и помещений — по порядку плана, который окно
// строит само из той же базы (`planOf`). Истины здесь нет (§9): упаковка читает только номер, место, ярлык, вид и число тары
// паллеты, статус и серию помещения, рампу фуры, вид и времена задачи, где человек и техника, — то, что завод видит глазами.
import type { ContentDb } from '../content/types';
import { planOf } from '../engine/plant';
import { destOf, pointOf } from '../engine/tasks';
import type { PlantState, Tag, Task, TaskKind, Unit } from '../engine/types';
import { shiftEnd } from '../engine/staff';

export const FORMAT = 3;

/** Поля заголовка: формат, часы, сутки, отставание; сколько записей в каждом разделе. */
export const H = { format: 0, t: 1, day: 2, lag: 3, rooms: 4, trucks: 5, units: 6, gone: 7, tasks: 8, people: 9, vehicles: 10, size: 11 } as const;
/** Помещение: номер в плане, статус, серия (`270901`; −1 — нет), карта и стадия серии (номера в базе; −1 — нет). */
export const R = { room: 0, status: 1, batch: 2, recipe: 3, stage: 4, size: 5 } as const;
/** Фура: номер (`K12` → 12), рампа (номер в плане), встала ли, покупатель ли. */
export const K = { truck: 0, dock: 1, docked: 2, customer: 3, size: 4 } as const;
/** Паллета: номер (`U77` → 77), где, номер места, фуры или помещения, вид груза, сколько тары, ярлык, флаги. */
export const U = { unit: 0, where: 1, ref: 2, load: 3, fill: 4, tag: 5, flags: 6, size: 7 } as const;

/**
 * Задача в работе (2б): номер (`T12` → 12), вид, пять времён (начало, у груза, отъезд с грузом, у места, конец — игровые
 * секунды), откуда и куда, см (куда −1 — некуда: работа на месте), место откуда и куда — номер в плане (−1 — не место),
 * техника и паллета — номера (−1 — нет).
 */
export const J = { task: 0, kind: 1, t0: 2, t1: 3, t2: 4, t3: 5, t4: 6, fx: 7, fz: 8, dx: 9, dz: 10, fromSlot: 11, toSlot: 12, vehicle: 13, unit: 14, size: 15 } as const;
/** Человек: номер (`E3` → 3), роль — номер в базе, на заводе ли, где он (в задаче — где её начал), см, номер строки задачи. */
export const P = { person: 0, role: 1, present: 2, x: 3, z: 4, task: 5, size: 6 } as const;
/** Техника: номер (`V2` → 2), вид — номер в базе, где она (в задаче — где её начала), см, номер строки задачи. */
export const V = { vehicle: 0, type: 1, x: 2, z: 3, task: 4, size: 5 } as const;

/** Номер вида задачи в срезе: запись на каждый вид — новый вид без номера не соберётся. */
const KIND_NO: Record<TaskKind, number> = {
  unload: 0, receive: 1, putaway: 2, move: 3, toSampling: 4, sample: 5, fromSampling: 6, handover: 7, prep: 8, review: 9,
  decide: 10, pick: 11, transfer: 12, return: 13, stage: 14, clean: 15, crew: 16, changeover: 17, clearance: 18, clearCheck: 19,
  feed: 20, fgCheck: 21, qpDecide: 22, ship: 23, casePick: 24, load: 25, repair: 26,
};
/** Виды задач по номерам — как в срезе. */
export const TASK_KINDS: readonly TaskKind[] = (Object.keys(KIND_NO) as TaskKind[]).sort((a, b) => KIND_NO[a] - KIND_NO[b]);

export const ROOM_STATUS = ['clean', 'busy', 'dirty'] as const;
export const WHERE = ['slot', 'truck', 'room'] as const;
export const LOADS = ['cases', 'drums', 'bags', 'rolls'] as const;
export const TAGS: readonly Tag[] = ['quarantine', 'sampled', 'released', 'rejected', 'blocked'];
/** Флаги паллеты: пластиковая, паллета заказа в экспедиции. */
export const FLAG = { plastic: 1, order: 2 } as const;

export type Load = (typeof LOADS)[number];

/** Паллета из среза — для окна и тестов. */
export interface UnitRow {
  unit: number;
  where: (typeof WHERE)[number];
  ref: number;
  /** нет тары — пустая паллета */
  load?: Load;
  fill: number;
  tag: Tag;
  plastic: boolean;
  order: boolean;
}

export interface RoomRow {
  room: number;
  status: (typeof ROOM_STATUS)[number];
  batch: number;
  recipe: number;
  stage: number;
}

export interface TruckRow {
  truck: number;
  dock: number;
  docked: boolean;
  customer: boolean;
}

export interface TaskRow {
  task: number;
  kind: TaskKind;
  times: [number, number, number, number, number];
  from: { x: number; z: number };
  /** некуда — работа на месте */
  dest?: { x: number; z: number };
  fromSlot: number;
  toSlot: number;
  vehicle: number;
  unit: number;
}

export interface PersonRow {
  person: number;
  role: number;
  present: boolean;
  x: number;
  z: number;
  /** номер строки задачи в срезе; −1 — без задачи */
  task: number;
}

export interface VehicleRow {
  vehicle: number;
  type: number;
  x: number;
  z: number;
  task: number;
}

const num = (id: string) => Number(id.slice(1));

/** Номера в плане и в базе: место, помещение, рампа, карта, роль, вид техники. */
interface Index {
  slot: Map<string, number>;
  room: Map<string, number>;
  dock: Map<string, number>;
  recipe: Map<string, number>;
  role: Map<string, number>;
  vehicle: Map<string, number>;
}

const indexes = new WeakMap<ContentDb, Map<string, Index>>();

function indexOf(db: ContentDb, plantId: string): Index {
  let byPlant = indexes.get(db);
  if (!byPlant) indexes.set(db, (byPlant = new Map()));
  const hit = byPlant.get(plantId);
  if (hit) return hit;
  const plan = planOf(db, plantId);
  const ix: Index = {
    slot: new Map(plan.slots.map((s, i) => [s.id, i])),
    room: new Map(plan.plant.rooms.map((r, i) => [r.id, i])),
    dock: new Map(plan.plant.docks.map((d, i) => [d.id, i])),
    recipe: new Map(Object.keys(db.recipes).map((id, i) => [id, i])),
    role: new Map(Object.keys(db.roles).map((id, i) => [id, i])),
    vehicle: new Map(Object.keys(db.vehicles).map((id, i) => [id, i])),
  };
  byPlant.set(plantId, ix);
  return ix;
}

/** Строка паллеты: где, какой груз и сколько, ярлык. */
function unitRow(db: ContentDb, s: PlantState, ix: Index, u: Unit): number[] {
  const where = u.where.kind === 'slot' ? 0 : u.where.kind === 'truck' ? 1 : 2;
  const ref = u.where.kind === 'slot' ? ix.slot.get(u.where.id)! : u.where.kind === 'truck' ? num(u.where.id) : ix.room.get(u.where.id)!;
  const first = u.items.length ? s.containers[u.items[0]] : undefined;
  const load = first ? LOADS.indexOf(db.containers[first.type].load as Load) : -1;
  const flags = (u.type === 'unit.pallet.plastic' ? FLAG.plastic : 0) | (u.order ? FLAG.order : 0);
  return [num(u.id), where, ref, load, u.items.length, TAGS.indexOf(u.tag), flags];
}

/** Строка задачи в работе: откуда и куда — те же точки, что считает раздатчик (`tasks.ts`). */
function taskRow(db: ContentDb, s: PlantState, ix: Index, t: Task): number[] {
  const plan = planOf(db, s.plant);
  const from = pointOf(plan, s, t.from);
  const dest = t.to ? plan.slot[t.to] : destOf(plan, s, t);
  // техника без места назначения везёт груз туда же, откуда взяла (как в раздатчике)
  const d = dest ?? (t.vehicle ? from : undefined);
  const fromSlot = t.from.kind === 'slot' ? ix.slot.get(t.from.id)! : -1;
  return [
    num(t.id),
    KIND_NO[t.kind],
    ...t.times!,
    from.x,
    from.z,
    d ? d.x : -1,
    d ? d.z : -1,
    fromSlot,
    t.to ? ix.slot.get(t.to)! : -1,
    t.vehicle ? num(t.vehicle) : -1,
    t.unit ? num(t.unit) : -1,
  ];
}

/**
 * Упаковщик среза в потоке расчёта: помнит, какие паллеты окно уже знает, и шлёт только изменённые и ушедшие. После
 * `reset` (новая партия, загрузка) — все.
 */
export class Packer {
  private sent = new Map<number, string>();

  constructor(private db: ContentDb) {}

  reset() {
    this.sent.clear();
  }

  pack(s: PlantState, lag: number): Int32Array {
    const db = this.db;
    const ix = indexOf(db, s.plant);
    const plan = planOf(db, s.plant);
    const rooms: number[][] = plan.plant.rooms.map((r, i) => {
      const room = s.rooms[r.id];
      const b = room?.batch ? s.batches[room.batch] : undefined;
      const code = b ? b.code.y * 10000 + b.code.m * 100 + b.code.n : -1;
      return [i, room ? ROOM_STATUS.indexOf(room.status) : 0, code, b ? ix.recipe.get(b.recipe)! : -1, b && room?.status === 'busy' ? b.stage : -1];
    });
    const trucks: number[][] = Object.values(s.trucks).map(t => [num(t.id), ix.dock.get(t.dock)!, t.docked ? 1 : 0, t.customer ? 1 : 0]);
    const changed: number[][] = [];
    const seen = new Set<number>();
    for (const u of Object.values(s.units)) {
      const row = unitRow(db, s, ix, u);
      seen.add(row[0]);
      const sig = row.join(',');
      if (this.sent.get(row[0]) === sig) continue;
      this.sent.set(row[0], sig);
      changed.push(row);
    }
    const gone: number[] = [];
    for (const n of this.sent.keys()) if (!seen.has(n)) gone.push(n);
    for (const n of gone) this.sent.delete(n);
    // движущиеся — все и каждый раз: людей и техники десятки; задачи — только те, что в работе у людей или техники
    const busy = Object.values(s.tasks).filter(t => t.state === 'busy' && t.times);
    const row = new Map(busy.map((t, i) => [t.id, i]));
    const tasks = busy.map(t => taskRow(db, s, ix, t));
    const people = Object.values(s.people).map(p => {
      const present = p.task !== undefined || shiftEnd(db, s, p) !== undefined;
      return [num(p.id), ix.role.get(p.role)!, present ? 1 : 0, p.x, p.z, p.task !== undefined ? row.get(p.task) ?? -1 : -1];
    });
    const vehicles = Object.values(s.vehicles).map(v => [num(v.id), ix.vehicle.get(v.type)!, v.x, v.z, v.task !== undefined ? row.get(v.task) ?? -1 : -1]);
    const buf = new Int32Array(
      H.size + rooms.length * R.size + trucks.length * K.size + changed.length * U.size + gone.length + tasks.length * J.size + people.length * P.size + vehicles.length * V.size,
    );
    buf[H.format] = FORMAT;
    buf[H.t] = s.t;
    buf[H.day] = s.day;
    buf[H.lag] = Math.min(lag, 0x7fffffff);
    buf[H.rooms] = rooms.length;
    buf[H.trucks] = trucks.length;
    buf[H.units] = changed.length;
    buf[H.gone] = gone.length;
    buf[H.tasks] = tasks.length;
    buf[H.people] = people.length;
    buf[H.vehicles] = vehicles.length;
    let o = H.size;
    for (const rows of [rooms, trucks, changed]) {
      for (const r of rows) {
        buf.set(r, o);
        o += r.length;
      }
    }
    buf.set(gone, o);
    o += gone.length;
    for (const rows of [tasks, people, vehicles]) {
      for (const r of rows) {
        buf.set(r, o);
        o += r.length;
      }
    }
    return buf;
  }
}

/** Разобранный срез. */
export interface Unpacked {
  t: number;
  day: number;
  lag: number;
  rooms: RoomRow[];
  trucks: TruckRow[];
  units: UnitRow[];
  gone: number[];
  tasks: TaskRow[];
  people: PersonRow[];
  vehicles: VehicleRow[];
}

/** Разобрать срез — в окне и в тестах. */
export function unpack(buf: Int32Array): Unpacked {
  if (buf[H.format] !== FORMAT) throw new Error(`slice: format ${buf[H.format]}, expected ${FORMAT}`);
  let o = H.size;
  const rooms: RoomRow[] = [];
  for (let i = 0; i < buf[H.rooms]; i++, o += R.size) {
    rooms.push({ room: buf[o + R.room], status: ROOM_STATUS[buf[o + R.status]], batch: buf[o + R.batch], recipe: buf[o + R.recipe], stage: buf[o + R.stage] });
  }
  const trucks: TruckRow[] = [];
  for (let i = 0; i < buf[H.trucks]; i++, o += K.size) {
    trucks.push({ truck: buf[o + K.truck], dock: buf[o + K.dock], docked: buf[o + K.docked] === 1, customer: buf[o + K.customer] === 1 });
  }
  const units: UnitRow[] = [];
  for (let i = 0; i < buf[H.units]; i++, o += U.size) {
    const load = buf[o + U.load];
    units.push({
      unit: buf[o + U.unit],
      where: WHERE[buf[o + U.where]],
      ref: buf[o + U.ref],
      ...(load >= 0 ? { load: LOADS[load] } : {}),
      fill: buf[o + U.fill],
      tag: TAGS[buf[o + U.tag]],
      plastic: (buf[o + U.flags] & FLAG.plastic) !== 0,
      order: (buf[o + U.flags] & FLAG.order) !== 0,
    });
  }
  const gone = Array.from(buf.subarray(o, o + buf[H.gone]));
  o += buf[H.gone];
  const tasks: TaskRow[] = [];
  for (let i = 0; i < buf[H.tasks]; i++, o += J.size) {
    const dx = buf[o + J.dx];
    tasks.push({
      task: buf[o + J.task],
      kind: TASK_KINDS[buf[o + J.kind]],
      times: [buf[o + J.t0], buf[o + J.t1], buf[o + J.t2], buf[o + J.t3], buf[o + J.t4]],
      from: { x: buf[o + J.fx], z: buf[o + J.fz] },
      ...(dx >= 0 ? { dest: { x: dx, z: buf[o + J.dz] } } : {}),
      fromSlot: buf[o + J.fromSlot],
      toSlot: buf[o + J.toSlot],
      vehicle: buf[o + J.vehicle],
      unit: buf[o + J.unit],
    });
  }
  const people: PersonRow[] = [];
  for (let i = 0; i < buf[H.people]; i++, o += P.size) {
    people.push({ person: buf[o + P.person], role: buf[o + P.role], present: buf[o + P.present] === 1, x: buf[o + P.x], z: buf[o + P.z], task: buf[o + P.task] });
  }
  const vehicles: VehicleRow[] = [];
  for (let i = 0; i < buf[H.vehicles]; i++, o += V.size) {
    vehicles.push({ vehicle: buf[o + V.vehicle], type: buf[o + V.type], x: buf[o + V.x], z: buf[o + V.z], task: buf[o + V.task] });
  }
  return { t: buf[H.t], day: buf[H.day], lag: buf[H.lag], rooms, trucks, units, gone, tasks, people, vehicles };
}
