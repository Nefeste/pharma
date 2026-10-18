// Раскладка завода для 3D-вида (docs/specs/2026-10-view.md, 2а, «Что рисует окно»): план движка (`planOf`) → помещения и
// двери в клетках, высоты стен, где стоят паллеты в помещениях и в фуре. Чистые функции без Three.js и DOM — их проверяют
// тесты в Bun (tools/test/view.test.ts). Мир: x — столбец клетки, z — строка, y — вверх; клетка — 1 м; план движка — в см.
import type { DoorKind } from '../content/types';
import { CELL, type Nav } from '../engine/nav';
import { type PlantPlan, RACK } from '../engine/plant';

export type Cell = [number, number];

export interface RoomBox {
  id: string;
  type: string;
  grade: 'D' | 'cnc';
  /** прямоугольник со стенами, клетки */
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface DoorView {
  kind: DoorKind;
  materials: boolean;
  /** клетки проёма подряд вдоль стены */
  cells: Cell[];
  along: 'x' | 'z';
  /** помещения по обе стороны (номер в плане; −1 — улица): сначала с меньшей координаты */
  rooms: [number, number];
}

export interface Layout {
  w: number;
  h: number;
  plan: PlantPlan;
  nav: Nav;
  rooms: RoomBox[];
  doors: DoorView[];
}

/** Высокий зал склада: стеллажи в четыре яруса. */
export const TALL = new Set(['warehouse']);
/** Помещения склада: наливной пол, как в зале. */
export const STORE = new Set(['warehouse', 'cold', 'rejected']);
/**
 * Высота стен, м: наружные стены зала склада — под стеллажи в четыре яруса; остальные — как у помещений производства и
 * вспомогательных: внутренние стены зала и камеры в нём не заслоняют склад сверху.
 */
export const WALL_TALL = 7.2;
export const WALL_LOW_ROOM = 3.2;

const cache = new WeakMap<PlantPlan, Layout>();

export function layoutOf(plan: PlantPlan): Layout {
  const hit = cache.get(plan);
  if (hit) return hit;
  const nav = plan.nav;
  const rooms: RoomBox[] = plan.plant.rooms.map(r => ({ id: r.id, type: r.type, grade: r.grade, x: r.rect[0] / 100, z: r.rect[1] / 100, w: r.rect[2] / 100, d: r.rect[3] / 100 }));
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= nav.w || z >= nav.h ? -1 : nav.room[z * nav.w + x]);
  const doors: DoorView[] = plan.plant.doors.map(d => {
    const cells: Cell[] = Array.from({ length: d.len }, (_, k) => (d.along === 'x' ? [d.cell[0] + k, d.cell[1]] : [d.cell[0], d.cell[1] + k]));
    const [x, z] = cells[0];
    // помещения по обе стороны стены: поперёк неё
    const a = d.along === 'x' ? at(x, z - 1) : at(x - 1, z);
    const b = d.along === 'x' ? at(x, z + 1) : at(x + 1, z);
    return { kind: d.kind, materials: !!d.materials, cells, along: d.along, rooms: [a, b] };
  });
  const out: Layout = { w: nav.w, h: nav.h, plan, nav, rooms, doors };
  cache.set(plan, out);
  return out;
}

/** Клетка стены или двери: улица ли с этой стороны. */
export function isOutside(l: Layout, x: number, z: number): boolean {
  return x < 0 || z < 0 || x >= l.w || z >= l.h || l.nav.cells[z * l.w + x] === CELL.outside;
}

/** Наружу от клетки стены — к краю здания (нет — 0, 0). У нас здание — весь участок: наружу — за его край. */
export function outward(l: Layout, x: number, z: number): [number, number] {
  let ox = 0;
  let oz = 0;
  if (x === 0) ox -= 1;
  if (x === l.w - 1) ox += 1;
  if (z === 0) oz -= 1;
  if (z === l.h - 1) oz += 1;
  const len = Math.hypot(ox, oz) || 1;
  return [ox / len, oz / len];
}

/** Высота стены в клетке: наружная стена зала склада — высокая, остальные — как у помещений. */
export function wallHeight(l: Layout, x: number, z: number): number {
  if (x !== 0 && z !== 0 && x !== l.w - 1 && z !== l.h - 1) return WALL_LOW_ROOM;
  let tall = false;
  for (const [dx, dz] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const nx = x + dx;
    const nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= l.w || nz >= l.h) continue;
    const i = nz * l.w + nx;
    const c = l.nav.cells[i];
    if (c !== CELL.floor && c !== CELL.corridor) continue;
    const r = l.nav.room[i];
    if (r >= 0 && TALL.has(l.rooms[r].type)) tall = true;
  }
  return tall ? WALL_TALL : WALL_LOW_ROOM;
}

/** Высота стен над клеткой пола: по её помещению. */
export function roomHeight(l: Layout, x: number, z: number): number {
  const r = l.nav.room[z * l.w + x];
  return r >= 0 && TALL.has(l.rooms[r].type) ? WALL_TALL : WALL_LOW_ROOM;
}

/**
 * Места паллет в помещении (комплект серии, балк, упаковка у линии): свободные клетки пола — от двери помещения по
 * расстоянию, при равном — по номеру клетки. Середины клеток, м.
 */
export function roomSpots(l: Layout, room: number): { x: number; z: number }[] {
  const r = l.rooms[room];
  const door = l.doors.find(d => d.rooms.includes(room) && d.kind !== 'hatch');
  const [dx, dz] = door ? door.cells[0] : [r.x + 1, r.z + 1];
  const out: { x: number; z: number; k: number; i: number }[] = [];
  for (let z = r.z + 1; z < r.z + r.d - 1; z++) {
    for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
      const i = z * l.w + x;
      if (l.nav.room[i] !== room || !l.nav.walk[i]) continue;
      // не на пороге: у двери проходят люди
      const k = Math.abs(x - dx) + Math.abs(z - dz);
      if (k < 2) continue;
      out.push({ x: x + 0.5, z: z + 0.5, k, i });
    }
  }
  out.sort((a, b) => a.k - b.k || a.i - b.i);
  return out.map(({ x, z }) => ({ x, z }));
}

/** Высота основания паллеты на ярусе стеллажа, м: ярус 0 — пол, выше — балка (как src/render/loads.ts, BAY). */
export const levelY = (level: number) => (level * RACK.level) / 100 + (level > 0 ? 0.12 : 0);

/** Фура у рампы: кузов уходит от стены наружу; длина кузова и паллет в ряд (гипотеза: европейский полуприцеп). */
export const TRAILER = { length: 13.6, width: 2.48, height: 2.7, across: 3, row: 1.2 } as const;

/**
 * Где стоит паллета в фуре: ряды по три поперёк кузова, от дверей к кабине; паллета — длинной стороной вдоль кузова. Фура —
 * у западной стены (рампы прототипа там), кузов — в сторону −x.
 */
export function truckSpot(dock: { x: number; z: number }, k: number): { x: number; z: number } {
  const row = Math.floor(k / TRAILER.across);
  const col = k % TRAILER.across;
  return { x: dock.x - 0.9 - row * TRAILER.row - TRAILER.row / 2, z: dock.z + (col - (TRAILER.across - 1) / 2) * 0.82 };
}
