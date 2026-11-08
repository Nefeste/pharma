// Единицы плана (Б7в; docs/specs/2026-10-vertical-slice.md, «Б7в»; геймдизайн, §5.2): оборудование, машины линии,
// приборы лаборатории и МОК, датчики условий хранения — чистые функции над планом здания. Где их ставят — классы типа
// помещения в каталоге (content/rooms/); след на полу — как у предмета стройки «Больницы» (`Nefeste/bolnitsa` @
// 599a9e9, src/engine/hospital/site.ts, `checkItem`): на полу своего помещения, не на чужом следе, стеллаже, зоне и не в
// проёме двери. Код места ISA-95 — следующий на рабочем месте своего вида в участке помещения; у нового помещения
// хранения — своя зона хранения с режимом из каталога типа. Состояние завода здесь не читают.
import type { ContentDb, Id, Plant } from '../../content/types';
import { boxOf, CELL, CELL_CM } from '../nav';
import { CENTER_OF, centerCode, type Family, placesOf } from '../places';
import { planOf } from '../plant';
import type { PlanUnit, SitePlan } from '../types';

/** Единица плана, как её видит стройка: род, класс, помещение, место на полу (у прибора — нет), код места, поставщик. */
export interface UnitRow {
  id: string;
  family: Family;
  type: Id;
  room: string;
  at?: [number, number];
  turn?: number;
  place: string;
  vendor?: Id;
  line?: string;
}

/** Род единицы по классу и помещению: прибор — по роли помещения (лаборатория, хранение, иначе МОК). */
export function familyOf(db: ContentDb, plant: Plant, type: Id, room: string): Family | undefined {
  if (db.equipment[type]) return 'equipment';
  if (db.machines[type]) return 'machine';
  if (!db.instruments[type]) return undefined;
  const role = db.rooms[plant.rooms.find(r => r.id === room)?.type ?? '']?.role;
  return role === 'lab' ? 'lab' : role === 'storage' ? 'sensor' : 'ipc';
}

/** Класс единицы: оборудование, машина линии или прибор. */
export const classRec = (db: ContentDb, type: Id) => db.equipment[type] ?? db.machines[type] ?? db.instruments[type];

/** Размер следа класса, см; у прибора следа нет. */
export const sizeOf = (db: ContentDb, type: Id): [number, number, number] | undefined => (db.equipment[type] ?? db.machines[type])?.size;

/** Цена единицы у поставщика, копейки без НДС: цена класса × доля поставщика. */
export function unitPrice(db: ContentDb, type: Id, vendor: Id | undefined): number {
  const c = classRec(db, type);
  const v = vendor ? db.vendors[vendor] : undefined;
  return c ? Math.floor((c.price * (v?.price ?? 100)) / 100) : 0;
}

/** Все единицы плана — по порядку списков плана. */
export function unitsOf(plant: Plant): UnitRow[] {
  return [
    ...plant.equipment.map(e => ({ id: e.id, family: 'equipment' as const, type: e.type, room: e.room, at: e.at, turn: e.turn, place: e.place, vendor: e.vendor })),
    ...plant.lines.flatMap(l => l.machines.map(m => ({ id: m.id, family: 'machine' as const, type: m.type, room: l.room, at: m.at, turn: m.turn, place: m.place, vendor: m.vendor, line: l.id }))),
    ...plant.instruments.map(i => ({ id: i.id, family: 'lab' as const, type: i.type, room: i.room, place: i.place, vendor: i.vendor })),
    ...plant.ipc.map(i => ({ id: i.id, family: 'ipc' as const, type: i.type, room: i.room, place: i.place, vendor: i.vendor })),
    ...plant.sensors.map(i => ({ id: i.id, family: 'sensor' as const, type: i.type, room: i.room, place: i.place, vendor: i.vendor })),
  ];
}

/** Единица плана по имени. */
export const unitOf = (plant: Plant, id: string): UnitRow | undefined => unitsOf(plant).find(u => u.id === id);

/** Рабочее место, где встанет единица рода в помещении: вида рода в участке помещения, у датчика — зона хранения. */
export function centerFor(plant: Plant, family: Family, room: string): string | undefined {
  const P = placesOf(plant);
  if (family === 'sensor') return P.storeOf[room];
  const area = P.areaOf[room];
  const kind = CENTER_OF[family];
  return plant.areas.find(a => a.code === area)?.centers.find(c => c.kind === kind)?.code;
}

/** Следующий код места на рабочем месте: номер больше всех занятых, две цифры; мест больше 99 — нет. */
export function nextPlace(plant: Plant, center: string): string | undefined {
  let n = 0;
  for (const u of unitsOf(plant)) if (centerCode(u.place) === center) n = Math.max(n, Number(u.place.slice(6)));
  return n >= 99 ? undefined : `${center}.${String(n + 1).padStart(2, '0')}`;
}

/** Имя новой единицы: основа — класс без приставки (`press`), номер — следующий, которого в плане нет. */
export function unitName(plant: Plant, type: Id, names: Record<string, number>): [string, Record<string, number>] {
  const base = type.slice(type.indexOf('.') + 1);
  const taken = new Set(unitsOf(plant).map(u => u.id));
  for (const l of plant.lines) taken.add(l.id);
  let n = names[base] ?? 1;
  while (taken.has(`${base}-${n}`)) n++;
  return [`${base}-${n}`, { ...names, [base]: n + 1 }];
}

/**
 * Почему след не встанет: не на полу своего помещения, на стене, в проёме двери (клетка рядом с дверью внутри
 * помещения), на чужом следе, стеллаже или зоне. `skip` — своя единица при переносе. Встанет — `undefined`.
 */
export function footError(db: ContentDb, plant: Plant, type: Id, room: string, at: readonly [number, number], turn: number, skip?: string): 'footprint' | 'doorway' | undefined {
  const size = sizeOf(db, type);
  if (!size) return undefined;
  const p = planOf(db, skip ? withoutUnit(db, plant as SitePlan, skip) : plant);
  const nav = p.nav;
  const ri = plant.rooms.findIndex(r => r.id === room);
  const [x0, z0, x1, z1] = boxOf(at, turn, size);
  const cx0 = Math.floor(x0 / CELL_CM);
  const cz0 = Math.floor(z0 / CELL_CM);
  const cx1 = Math.ceil(x1 / CELL_CM) - 1;
  const cz1 = Math.ceil(z1 / CELL_CM) - 1;
  for (let z = cz0; z <= cz1; z++) {
    for (let x = cx0; x <= cx1; x++) {
      if (x < 0 || z < 0 || x >= nav.w || z >= nav.h) return 'footprint';
      const i = z * nav.w + x;
      if (nav.cells[i] !== CELL.floor || nav.room[i] !== ri || nav.blocked[i]) return 'footprint';
      const mx = x * CELL_CM + CELL_CM / 2;
      const mz = z * CELL_CM + CELL_CM / 2;
      if (plant.zones.some(o => mx >= o.rect[0] && mx < o.rect[0] + o.rect[2] && mz >= o.rect[1] && mz < o.rect[1] + o.rect[3])) return 'footprint';
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx >= 0 && nz >= 0 && nx < nav.w && nz < nav.h && nav.cells[nz * nav.w + nx] === CELL.door) return 'doorway';
      }
    }
  }
  return undefined;
}

/** План без единицы: оборудование, прибор или датчик; машину линии сносят только с линией — тогда линию целиком. */
export function withoutUnit(db: ContentDb, plan: SitePlan, id: string): SitePlan {
  if (plan.equipment.some(e => e.id === id)) return { ...plan, equipment: plan.equipment.filter(e => e.id !== id) };
  if (plan.instruments.some(e => e.id === id)) return { ...plan, instruments: plan.instruments.filter(e => e.id !== id) };
  if (plan.ipc.some(e => e.id === id)) return { ...plan, ipc: plan.ipc.filter(e => e.id !== id) };
  if (plan.sensors.some(e => e.id === id)) return { ...plan, sensors: plan.sensors.filter(e => e.id !== id) };
  return plan;
}

/** План с новой единицей на месте `place` и с именем `id`. Машина линии новой не бывает — только замена (`swapUnit`). */
export function withUnit(db: ContentDb, plan: SitePlan, u: PlanUnit, id: string, place: string): SitePlan {
  const family = familyOf(db, plan, u.type, u.room);
  const base = { id, type: u.type, room: u.room, place, vendor: u.vendor };
  switch (family) {
    case 'equipment':
      return { ...plan, equipment: [...plan.equipment, { ...base, at: u.at ?? [0, 0], turn: u.turn ?? 0 }] };
    case 'lab':
      return { ...plan, instruments: [...plan.instruments, base] };
    case 'ipc':
      return { ...plan, ipc: [...plan.ipc, base] };
    case 'sensor':
      return { ...plan, sensors: [...plan.sensors, base] };
    default:
      return plan;
  }
}

/** Замена на том же месте: у записи плана — новое имя, класс и поставщик; место, след и поворот — прежние. */
export function swapUnit(plan: SitePlan, old: string, id: string, type: Id, vendor: Id): SitePlan {
  const sw = <T extends { id: string }>(xs: T[]) => xs.map(x => (x.id === old ? { ...x, id, type, vendor } : x));
  return {
    ...plan,
    equipment: sw(plan.equipment),
    instruments: sw(plan.instruments),
    ipc: sw(plan.ipc),
    sensors: sw(plan.sensors),
    lines: plan.lines.map(l => (l.machines.some(m => m.id === old) ? { ...l, machines: sw(l.machines) } : l)),
  };
}

/** Перенос: единица — в другом помещении, на другом месте, с новым кодом места. */
export function movedUnit(plan: SitePlan, id: string, room: string, place: string, at?: [number, number], turn?: number): SitePlan {
  const mv = <T extends { id: string; room: string }>(xs: T[]) => xs.map(x => (x.id === id ? { ...x, room, place } : x));
  return {
    ...plan,
    equipment: plan.equipment.map(e => (e.id === id ? { ...e, room, place, at: at ?? e.at, turn: turn ?? e.turn } : e)),
    instruments: mv(plan.instruments),
    ipc: mv(plan.ipc),
    sensors: mv(plan.sensors),
  };
}

/** Единицы помещения и линии в нём: их сносят с помещением. */
export function unitsIn(plant: Plant, room: string): UnitRow[] {
  return unitsOf(plant).filter(u => u.room === room);
}

/** План без всех единиц помещения и его линий. */
export function withoutRoomUnits(db: ContentDb, plan: SitePlan, room: string): SitePlan {
  let p: SitePlan = { ...plan, lines: plan.lines.filter(l => l.room !== room) };
  for (const u of unitsIn(plan, room)) if (u.family !== 'machine') p = withoutUnit(db, p, u.id);
  return p;
}
