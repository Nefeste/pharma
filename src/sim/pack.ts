// Упакованный срез для отрисовки (docs/02-architecture.md, §10; docs/specs/2026-10-view.md, «Срез 2а»): `Int32Array` уходит
// из потока расчёта без копии (transferList). Формат 2: заголовок, помещения, фуры, изменённые и ушедшие паллеты. Строк в
// срезе нет: номера мест и помещений — по порядку плана, который окно строит само из той же базы (`planOf`). Истины здесь
// нет (§9): упаковка читает только номер, место, ярлык, вид и число тары паллеты, статус и серию помещения, рампу фуры —
// то, что завод видит глазами.
import type { ContentDb } from '../content/types';
import { planOf } from '../engine/plant';
import type { PlantState, Tag, Unit } from '../engine/types';

export const FORMAT = 2;

/** Поля заголовка: формат, часы, сутки, отставание; сколько записей в каждом разделе. */
export const H = { format: 0, t: 1, day: 2, lag: 3, rooms: 4, trucks: 5, units: 6, gone: 7, size: 8 } as const;
/** Помещение: номер в плане, статус, серия (`270901`; −1 — нет), карта и стадия серии (номера в базе; −1 — нет). */
export const R = { room: 0, status: 1, batch: 2, recipe: 3, stage: 4, size: 5 } as const;
/** Фура: номер (`K12` → 12), рампа (номер в плане), встала ли, покупатель ли. */
export const K = { truck: 0, dock: 1, docked: 2, customer: 3, size: 4 } as const;
/** Паллета: номер (`U77` → 77), где, номер места, фуры или помещения, вид груза, сколько тары, ярлык, флаги. */
export const U = { unit: 0, where: 1, ref: 2, load: 3, fill: 4, tag: 5, flags: 6, size: 7 } as const;

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

const num = (id: string) => Number(id.slice(1));

/** Номера в плане и в базе: место, помещение, рампа, карта. */
interface Index {
  slot: Map<string, number>;
  room: Map<string, number>;
  dock: Map<string, number>;
  recipe: Map<string, number>;
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
    const buf = new Int32Array(H.size + rooms.length * R.size + trucks.length * K.size + changed.length * U.size + gone.length);
    buf[H.format] = FORMAT;
    buf[H.t] = s.t;
    buf[H.day] = s.day;
    buf[H.lag] = Math.min(lag, 0x7fffffff);
    buf[H.rooms] = rooms.length;
    buf[H.trucks] = trucks.length;
    buf[H.units] = changed.length;
    buf[H.gone] = gone.length;
    let o = H.size;
    for (const rows of [rooms, trucks, changed]) {
      for (const row of rows) {
        buf.set(row, o);
        o += row.length;
      }
    }
    buf.set(gone, o);
    return buf;
  }
}

/** Разобрать срез — в окне и в тестах. */
export function unpack(buf: Int32Array): { t: number; day: number; lag: number; rooms: RoomRow[]; trucks: TruckRow[]; units: UnitRow[]; gone: number[] } {
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
  return { t: buf[H.t], day: buf[H.day], lag: buf[H.lag], rooms, trucks, units, gone };
}
