// План завода в движке (docs/specs/2026-10-engine.md, «План завода прототипа»): места паллет из зон и стеллажей, рампы,
// помещения, точки, расстояния. Чистые функции над записью плана; результат запоминается на запись (одна и та же база —
// один и тот же план). Окно берёт места отсюда же, поэтому паллета на экране стоит там, где её держит движок.
import type { ContentDb, Plant, ZoneKind } from '../content/types';

/** Геометрия секции стеллажа, см: три места по 90 см, глубина 110, ярус 150 (как src/render/loads.ts, BAY). */
export const RACK = { bay: 270, depth: 110, level: 150, slots: 3 } as const;

export interface Slot {
  /** `quar-03` — место зоны; `A-03-2-1` — ряд, секция, ярус (с 1), место */
  id: string;
  /** зона или стеллаж: склад хранения — `storage` */
  kind: ZoneKind | 'storage';
  /** имя зоны или ряда */
  group: string;
  /** центр места, см */
  x: number;
  z: number;
  /** ярус: 0 — пол */
  level: number;
}

export interface Point {
  x: number;
  z: number;
}

export interface PlantPlan {
  plant: Plant;
  slots: Slot[];
  slot: Record<string, Slot>;
  /** места по виду, в порядке плана */
  byKind: Record<string, Slot[]>;
  dock: Record<string, Point & { kind: 'in' | 'out' }>;
  /** центры помещений */
  room: Record<string, Point & { type: string }>;
  park: Point;
  entrance: Point;
}

const cache = new WeakMap<Plant, PlantPlan>();

export function planOf(db: ContentDb, plantId: string): PlantPlan {
  const plant = db.plants[plantId];
  if (!plant) throw new Error(`no plant ${plantId}`);
  const hit = cache.get(plant);
  if (hit) return hit;
  const slots: Slot[] = [];
  for (const zn of plant.zones) {
    const [x, z, w, d] = zn.rect;
    const [cols, rows] = zn.grid;
    let n = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        n++;
        slots.push({
          id: `${zn.id}-${String(n).padStart(2, '0')}`,
          kind: zn.kind,
          group: zn.id,
          x: x + Math.floor(((2 * i + 1) * w) / (2 * cols)),
          z: z + Math.floor(((2 * j + 1) * d) / (2 * rows)),
          level: 0,
        });
      }
    }
  }
  for (const r of plant.racks) {
    for (let b = 0; b < r.bays; b++) {
      for (let lv = 0; lv < r.levels; lv++) {
        for (let k = 0; k < RACK.slots; k++) {
          slots.push({
            id: `${r.id}-${String(b + 1).padStart(2, '0')}-${lv + 1}-${k + 1}`,
            kind: 'storage',
            group: r.id,
            x: r.x + b * RACK.bay + ((2 * k + 1) * RACK.bay) / (2 * RACK.slots),
            z: r.z + RACK.depth / 2,
            level: lv,
          });
        }
      }
    }
  }
  const slot: Record<string, Slot> = {};
  const byKind: Record<string, Slot[]> = {};
  for (const sl of slots) {
    slot[sl.id] = sl;
    (byKind[sl.kind] ??= []).push(sl);
  }
  const dock: PlantPlan['dock'] = {};
  for (const d of plant.docks) dock[d.id] = { x: d.x, z: d.z, kind: d.kind };
  const room: PlantPlan['room'] = {};
  for (const r of plant.rooms) room[r.id] = { x: r.rect[0] + Math.floor(r.rect[2] / 2), z: r.rect[1] + Math.floor(r.rect[3] / 2), type: r.type };
  const plan: PlantPlan = {
    plant,
    slots,
    slot,
    byKind,
    dock,
    room,
    park: { x: plant.points.park[0], z: plant.points.park[1] },
    entrance: { x: plant.points.entrance[0], z: plant.points.entrance[1] },
  };
  cache.set(plant, plan);
  return plan;
}

/** Расстояние по складу, см: |dx| + |dz| — дорога по проездам без пробок (ADR 0003). */
export function dist(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

/** Секунды пути: расстояние в см / скорость в см/с, вверх до секунды. */
export function travel(a: Point, b: Point, speed: number): number {
  return Math.ceil(dist(a, b) / speed);
}
