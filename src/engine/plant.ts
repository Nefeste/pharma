// План завода в движке (docs/specs/2026-10-engine.md, «План завода прототипа»; docs/specs/2026-10-view.md, 2а): места паллет
// из зон и стеллажей, рампы, помещения, точки, сетка и маршруты (nav.ts). Чистые функции над записью плана; результат
// запоминается на запись (одна и та же база — один и тот же план). Окно берёт места и пути отсюда же, поэтому паллета на
// экране стоит там, где её держит движок, и едет тем путём, который он посчитал.
import type { ContentDb, Plant, ZoneKind } from '../content/types';
import { buildNav, CELL_CM, type Mover, type Nav, pathLength, RACK } from './nav';
import { placesOf, roomAt } from './places';


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
  /** зона хранения места (Б3в): рабочее место ISA-95 его помещения; у транзитных зон вне помещений хранения — нет */
  store?: string;
}

export { type Mover, RACK } from './nav';

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
  /** зоны хранения, где есть места вида (Б3в) */
  storesOf: Record<string, string[]>;
  dock: Record<string, Point & { kind: 'in' | 'out' }>;
  /** рабочие точки помещений: своя точка записи или середина */
  room: Record<string, Point & { type: string }>;
  /** помещение по типу: в плане тип помещения не повторяется (проверяет сборка базы) */
  roomOf: Record<string, string>;
  /** центр лаборатории: там работают аналитики и начальник ОКК */
  lab: Point;
  park: Point;
  entrance: Point;
  /** посты ожидания по ролям (docs/specs/2026-10-panels.md, 3а) */
  posts: Record<string, Point>;
  /** сетка клеток и поля расстояний */
  nav: Nav;
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
  // зона хранения места — по помещению, где оно стоит (Б3в)
  const stores = placesOf(plant).storeOf;
  for (const sl of slots) {
    const room = roomAt(plant, sl.x, sl.z);
    const st = room ? stores[room] : undefined;
    if (st) sl.store = st;
  }
  const slot: Record<string, Slot> = {};
  const byKind: Record<string, Slot[]> = {};
  const storesOf: Record<string, string[]> = {};
  for (const sl of slots) {
    slot[sl.id] = sl;
    (byKind[sl.kind] ??= []).push(sl);
    const of = (storesOf[sl.kind] ??= []);
    if (sl.store && !of.includes(sl.store)) of.push(sl.store);
  }
  const dock: PlantPlan['dock'] = {};
  for (const d of plant.docks) dock[d.id] = { x: d.x, z: d.z, kind: d.kind };
  const room: PlantPlan['room'] = {};
  for (const r of plant.rooms) room[r.id] = r.at ? { x: r.at[0], z: r.at[1], type: r.type } : { x: r.rect[0] + Math.floor(r.rect[2] / 2), z: r.rect[1] + Math.floor(r.rect[3] / 2), type: r.type };
  const roomOf: Record<string, string> = {};
  for (const r of plant.rooms) roomOf[r.type] = r.id;
  const lab = Object.values(room).find(r => r.type === 'lab');
  if (!lab) throw new Error(`plant ${plantId}: no lab`);
  const nav = buildNav(db, plant);
  // клетка доступа места: на полу — своя, на стеллаже — клетка прохода перед ним (с его стороны); у ярусов — одна
  for (const sl of slots) {
    const at = (x: number, z: number) => z * nav.w + x;
    if (sl.kind !== 'storage') nav.known.set(`${sl.x},${sl.z}`, at(Math.floor(sl.x / CELL_CM), Math.floor(sl.z / CELL_CM)));
    else {
      const r = plant.racks.find(k => k.id === sl.group)!;
      // занятые ряды клеток — те, чья середина внутри стеллажа (начало включительно, конец — нет, как в nav.ts)
      const first = Math.ceil((r.z - CELL_CM / 2) / CELL_CM);
      const last = Math.ceil((r.z + RACK.depth - CELL_CM / 2) / CELL_CM) - 1;
      const row = r.face === 'n' ? first - 1 : last + 1;
      nav.known.set(`${sl.x},${sl.z}`, at(Math.floor(sl.x / CELL_CM), row));
    }
  }
  const plan: PlantPlan = {
    plant,
    slots,
    slot,
    byKind,
    storesOf,
    dock,
    room,
    roomOf,
    lab: { x: lab.x, z: lab.z },
    park: { x: plant.points.park[0], z: plant.points.park[1] },
    entrance: { x: plant.points.entrance[0], z: plant.points.entrance[1] },
    posts: Object.fromEntries(Object.entries(plant.posts).map(([role, [x, z]]) => [role, { x, z }])),
    nav,
  };
  cache.set(plant, plan);
  return plan;
}

/** Расстояние, см: длина маршрута по плану — пешком или на технике (nav.ts); пробок нет (ADR 0003). */
export function dist(plan: PlantPlan, a: Point, b: Point, mover: Mover = 'walk'): number {
  return pathLength(plan.nav, a, b, mover);
}

/** Секунды пути: расстояние в см / скорость в см/с, вверх до секунды. */
export function travel(plan: PlantPlan, a: Point, b: Point, speed: number, mover: Mover = 'walk'): number {
  return Math.ceil(dist(plan, a, b, mover) / speed);
}
