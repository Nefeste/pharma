// Места завода (Б3в; docs/specs/2026-10-vertical-slice.md, «Б3в»; ролевая иерархия оборудования ISA-95, `gost-62264-1`):
// площадка → участки → рабочие места — технологическая ячейка, производственная линия, зона хранения, лаборатория →
// рабочие блоки. Вещь плана — оборудование, машина линии или прибор — стоит на своём месте; помещение — часть здания, у
// него — участок, которому оно служит; зона хранения — её помещения и режим, который она держит. Чистые функции над
// записью плана: результат запоминается на запись, так же как план в plant.ts. Сборщик базы проверяет план ими же.
import type { AssetWork, ContentDb, Id, Plant, Regime, Text, WorkCenter } from '../content/types';
import type { AssetFamily } from './types';

/** Вещь плана на месте: оборудование производства, машина линии, прибор лаборатории, прибор МОК, датчик условий хранения. */
export type Family = Exclude<AssetFamily, 'vehicle'>;

/** Какой вид рабочего места держит вещь каждого рода. */
export const CENTER_OF: Record<Family, WorkCenter['kind']> = { equipment: 'cell', machine: 'line', lab: 'lab', ipc: 'cell', sensor: 'storage' };

export interface Thing {
  id: string;
  family: Family;
  type: Id;
  /** помещение, где стоит; у машины линии — помещение линии */
  room: string;
  place: string;
  line?: string;
}

export interface Places {
  /** вещи плана — по порядку участков плана, внутри участка — по коду места */
  things: Thing[];
  thing: Record<string, Thing>;
  /** рабочее место по коду — с кодом своего участка */
  center: Record<string, WorkCenter & { area: string }>;
  /** участок помещения; общего помещения площадки здесь нет */
  areaOf: Record<string, string>;
  /** зона хранения помещения хранения и датчик зоны */
  storeOf: Record<string, string>;
  sensorOf: Record<string, string>;
  /** приборы МОК помещения — по порядку кода места */
  ipcIn: Record<string, Thing[]>;
}

const cache = new WeakMap<Plant, Places>();

/** Рабочее место по коду места: `TB-01.03` → `TB-01`; участок по коду рабочего места: `TB-01` → `TB`. */
export const centerCode = (place: string) => place.slice(0, 5);
export const areaCode = (center: string) => center.slice(0, 2);

export function placesOf(plant: Plant): Places {
  const hit = cache.get(plant);
  if (hit) return hit;
  const things: Thing[] = [
    ...plant.equipment.map(e => ({ id: e.id, family: 'equipment' as const, type: e.type, room: e.room, place: e.place })),
    ...plant.lines.flatMap(l => l.machines.map(m => ({ id: m.id, family: 'machine' as const, type: m.type, room: l.room, place: m.place, line: l.id }))),
    ...plant.instruments.map(i => ({ id: i.id, family: 'lab' as const, type: i.type, room: i.room, place: i.place })),
    ...plant.ipc.map(i => ({ id: i.id, family: 'ipc' as const, type: i.type, room: i.room, place: i.place })),
    ...plant.sensors.map(i => ({ id: i.id, family: 'sensor' as const, type: i.type, room: i.room, place: i.place })),
  ];
  // по порядку участков плана, внутри участка — по коду места
  const rank = new Map(plant.areas.map((a, i) => [a.code, i]));
  const order = (t: Thing) => rank.get(areaCode(centerCode(t.place))) ?? plant.areas.length;
  things.sort((a, b) => order(a) - order(b) || (a.place < b.place ? -1 : a.place > b.place ? 1 : 0));
  const center: Places['center'] = {};
  const areaOf: Record<string, string> = {};
  const storeOf: Record<string, string> = {};
  for (const a of plant.areas) {
    for (const r of a.rooms) areaOf[r] ??= a.code;
    for (const c of a.centers) {
      center[c.code] = { ...c, area: a.code };
      if (c.kind === 'storage') for (const r of c.rooms ?? []) storeOf[r] ??= c.code;
    }
  }
  const sensorOf: Record<string, string> = {};
  const ipcIn: Record<string, Thing[]> = {};
  for (const t of things) {
    if (t.family === 'sensor') sensorOf[centerCode(t.place)] ??= t.id;
    if (t.family === 'ipc') (ipcIn[t.room] ??= []).push(t);
  }
  const p: Places = { things, thing: Object.fromEntries(things.map(t => [t.id, t])), center, areaOf, storeOf, sensorOf, ipcIn };
  cache.set(plant, p);
  return p;
}

/** Помещение, где точка (см): у вложенных помещений — то, что в плане позже, как пол и стены в nav.ts; вне помещений — нет. */
export function roomAt(plant: Plant, x: number, z: number): string | undefined {
  for (let i = plant.rooms.length - 1; i >= 0; i--) {
    const [rx, rz, w, d] = plant.rooms[i].rect;
    if (x >= rx && x < rx + w && z >= rz && z < rz + d) return plant.rooms[i].id;
  }
  return undefined;
}

/** Режим зоны лежит внутри режима, который требует материал: диапазон температуры — внутри, влажность — не выше. */
export function inside(zone: Regime, need: Regime): boolean {
  return zone.temp[0] >= need.temp[0] && zone.temp[1] <= need.temp[1] && zone.rh <= need.rh;
}

/** Принимает ли зона хранения материал по режиму (Б3в). */
export function accepts(db: ContentDb, store: WorkCenter, material: Id): boolean {
  const zone = store.regime ? db.regimes[store.regime] : undefined;
  const need = db.regimes[db.materials[material]?.storage];
  return !!zone && !!need && inside(zone, need);
}

/** Зона хранения, где стоят стеллажи: помещение первого ряда. */
export function rackStore(plant: Plant): string | undefined {
  const r = plant.racks[0];
  const room = r ? roomAt(plant, r.x, r.z) : undefined;
  return room ? placesOf(plant).storeOf[room] : undefined;
}

/**
 * Куда материал кладут на хранение (Б3в): на стеллажи, если их зона принимает его режим, иначе — в холодную камеру
 * (зона вида `cold`). Материалы прототипа хранятся при контролируемой комнатной температуре — им стеллажи.
 */
export function coldOf(db: ContentDb, plantId: string, material: Id): boolean {
  const plant = db.plants[plantId];
  const rack = rackStore(plant);
  const c = rack ? placesOf(plant).center[rack] : undefined;
  return !c || !accepts(db, c, material);
}

/** Класс вещи плана и его работы подрядчика: квалификация и калибровка (у датчика — поверка). */
export interface ThingClass {
  name: Text;
  qual?: AssetWork;
  cal?: AssetWork;
  critical?: true;
}

export function classOf(db: ContentDb, t: { family: AssetFamily; type: Id }): ThingClass {
  if (t.family === 'equipment') return db.equipment[t.type];
  if (t.family === 'machine') return db.machines[t.type];
  if (t.family === 'vehicle') return db.vehicles[t.type];
  return db.instruments[t.type];
}
