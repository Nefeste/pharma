// Что видно на полу (docs/specs/2026-10-view.md, 2а): состояние окна, собранное из срезов, и паллеты сцены из него. Срез
// несёт только изменённые паллеты — здесь они копятся; помещения и фуры приходят целиком. Чистые функции без Three.js и
// DOM: правду вещи (сколько тары в учёте — столько на паллете) проверяют тесты в Bun.
import type { ContentDb } from '../content/types';
import { planOf } from '../engine/plant';
import { layoutOf, type Layout, levelY, roomSpots, truckSpot } from '../render/layout';
import type { PalletView } from '../render/loads';
import type { EquipmentRow, LineRow, PersonRow, RoomRow, TaskRow, TruckRow, UnitRow, Unpacked, VehicleRow } from '../sim/pack';
import type { Carried } from './movers';

export class SceneState {
  readonly units = new Map<number, UnitRow>();
  rooms: RoomRow[] = [];
  trucks: TruckRow[] = [];
  /** движущиеся последнего среза (2б): задачи в работе, люди, техника — целиком */
  tasks: TaskRow[] = [];
  people: PersonRow[] = [];
  vehicles: VehicleRow[] = [];
  /** линии и оборудование последнего среза (2в) — целиком */
  lines: LineRow[] = [];
  equipment: EquipmentRow[] = [];
  /** версия паллет: растёт, когда паллеты изменились, — сцена пересобирает экземпляры только тогда */
  version = 0;

  /** Применить срез: паллеты — изменённые и ушедшие; помещения, фуры и движущиеся — целиком. После `start` и `load` — `reset`. */
  apply(sl: Unpacked) {
    for (const u of sl.units) this.units.set(u.unit, u);
    for (const n of sl.gone) this.units.delete(n);
    if (sl.units.length || sl.gone.length) this.version++;
    this.rooms = sl.rooms;
    this.trucks = sl.trucks;
    this.tasks = sl.tasks;
    this.people = sl.people;
    this.vehicles = sl.vehicles;
    this.lines = sl.lines;
    this.equipment = sl.equipment;
  }

  reset() {
    this.units.clear();
    this.rooms = [];
    this.trucks = [];
    this.tasks = [];
    this.people = [];
    this.vehicles = [];
    this.lines = [];
    this.equipment = [];
    this.version++;
  }
}

/** Середина ворот рампы, м: фура встаёт к ним кузовом. */
export function dockFront(l: Layout, dock: number): { x: number; z: number } {
  const d = l.plan.plant.docks[dock];
  const door = l.doors.find(dr => dr.kind === 'dock' && dr.cells.some(([x, z]) => x === Math.floor(d.x / 100) && z === Math.floor(d.z / 100)))!;
  const zs = door.cells.map(c => c[1]);
  return { x: door.cells[0][0], z: (Math.min(...zs) + Math.max(...zs) + 1) / 2 };
}

/**
 * Паллеты сцены: на месте — по плану (на стеллаже — длинной стороной вглубь, на ярусе), в помещении — на свободных клетках
 * от двери по номеру паллеты, в фуре у рампы — рядами от дверей кузова. Паллета, которую везут (`moving`), числится там,
 * откуда взяли, но рисуется на вилах (`carriedOf`).
 */
export function palletsOf(db: ContentDb, plantId: string, st: SceneState, moving: ReadonlySet<number> = new Set()): PalletView[] {
  const l = layoutOf(planOf(db, plantId));
  const out: PalletView[] = [];
  const inRoom = new Map<number, UnitRow[]>();
  const onTruck = new Map<number, UnitRow[]>();
  for (const u of [...st.units.values()].sort((a, b) => a.unit - b.unit)) {
    if (moving.has(u.unit)) continue;
    if (u.where === 'slot') {
      const sl = l.plan.slots[u.ref];
      out.push({ x: sl.x / 100, z: sl.z / 100, y: levelY(sl.level), turn: sl.kind === 'storage' ? 1 : 0, load: u.load ?? 'cases', fill: u.fill, tag: u.tag, ...(u.plastic ? { plastic: true } : {}), unit: u.unit });
    } else if (u.where === 'room') {
      const list = inRoom.get(u.ref) ?? [];
      list.push(u);
      inRoom.set(u.ref, list);
    } else {
      const list = onTruck.get(u.ref) ?? [];
      list.push(u);
      onTruck.set(u.ref, list);
    }
  }
  for (const [room, list] of inRoom) {
    const spots = roomSpots(l, room);
    list.forEach((u, k) => {
      const p = spots[k % Math.max(1, spots.length)] ?? { x: l.rooms[room].x + 1.5, z: l.rooms[room].z + 1.5 };
      out.push({ x: p.x, z: p.z, y: 0, turn: 0, load: u.load ?? 'cases', fill: u.fill, tag: u.tag, ...(u.plastic ? { plastic: true } : {}), unit: u.unit });
    });
  }
  // паллеты в кузове видны, когда фура у рампы и кузов открыт (3а): до проверки и во дворе — закрыт
  for (const t of st.trucks) {
    if (!t.docked || !t.open) continue;
    const front = dockFront(l, t.dock);
    (onTruck.get(t.truck) ?? []).forEach((u, k) => {
      const p = truckSpot(front, k);
      out.push({ x: p.x, z: p.z, y: 0, turn: 0, load: u.load ?? 'cases', fill: u.fill, tag: u.tag, ...(u.plastic ? { plastic: true } : {}), unit: u.unit });
    });
  }
  return out;
}

/**
 * Паллеты, которые везут: на вилах — на их высоте, длинной стороной вдоль вил; поставленные, пока движок не закрыл
 * задачу, — уже на месте назначения. Груз и ярлык — из учёта, как у всех паллет.
 */
export function carriedOf(st: SceneState, carried: readonly Carried[], y: (c: Carried) => number): PalletView[] {
  const out: PalletView[] = [];
  for (const c of carried) {
    const u = st.units.get(c.unit);
    if (!u) continue;
    const alongX = Math.abs(Math.sin(c.heading)) > 0.7;
    out.push({ x: c.x, z: c.z, y: y(c), turn: alongX ? 0 : 1, load: u.load ?? 'cases', fill: u.fill, tag: u.tag, ...(u.plastic ? { plastic: true } : {}), unit: u.unit });
  }
  return out;
}
