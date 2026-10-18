// Что видно на полу (docs/specs/2026-10-view.md, 2а): состояние окна, собранное из срезов, и паллеты сцены из него. Срез
// несёт только изменённые паллеты — здесь они копятся; помещения и фуры приходят целиком. Чистые функции без Three.js и
// DOM: правду вещи (сколько тары в учёте — столько на паллете) проверяют тесты в Bun.
import type { ContentDb } from '../content/types';
import { planOf } from '../engine/plant';
import { layoutOf, type Layout, levelY, roomSpots, truckSpot } from '../render/layout';
import type { PalletView } from '../render/loads';
import type { RoomRow, TruckRow, UnitRow, unpack } from '../sim/pack';

export class SceneState {
  readonly units = new Map<number, UnitRow>();
  rooms: RoomRow[] = [];
  trucks: TruckRow[] = [];
  /** версия паллет: растёт, когда паллеты изменились, — сцена пересобирает экземпляры только тогда */
  version = 0;

  /** Применить срез: паллеты — изменённые и ушедшие; помещения и фуры — целиком. После `start` и `load` — `reset`. */
  apply(sl: ReturnType<typeof unpack>) {
    for (const u of sl.units) this.units.set(u.unit, u);
    for (const n of sl.gone) this.units.delete(n);
    if (sl.units.length || sl.gone.length) this.version++;
    this.rooms = sl.rooms;
    this.trucks = sl.trucks;
  }

  reset() {
    this.units.clear();
    this.rooms = [];
    this.trucks = [];
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
 * от двери по номеру паллеты, в фуре у рампы — рядами от дверей кузова. Паллета, которую везут, числится там, откуда
 * взяли: её движение рисует часть 2б.
 */
export function palletsOf(db: ContentDb, plantId: string, st: SceneState): PalletView[] {
  const l = layoutOf(planOf(db, plantId));
  const out: PalletView[] = [];
  const inRoom = new Map<number, UnitRow[]>();
  const onTruck = new Map<number, UnitRow[]>();
  for (const u of [...st.units.values()].sort((a, b) => a.unit - b.unit)) {
    if (u.where === 'slot') {
      const sl = l.plan.slots[u.ref];
      out.push({ x: sl.x / 100, z: sl.z / 100, y: levelY(sl.level), turn: sl.kind === 'storage' ? 1 : 0, load: u.load ?? 'cases', fill: u.fill, tag: u.tag, ...(u.plastic ? { plastic: true } : {}) });
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
      out.push({ x: p.x, z: p.z, y: 0, turn: 0, load: u.load ?? 'cases', fill: u.fill, tag: u.tag, ...(u.plastic ? { plastic: true } : {}) });
    });
  }
  for (const t of st.trucks) {
    if (!t.docked) continue;
    const front = dockFront(l, t.dock);
    (onTruck.get(t.truck) ?? []).forEach((u, k) => {
      const p = truckSpot(front, k);
      out.push({ x: p.x, z: p.z, y: 0, turn: 0, load: u.load ?? 'cases', fill: u.fill, tag: u.tag, ...(u.plastic ? { plastic: true } : {}) });
    });
  }
  return out;
}
