// Правка плана стройкой (Б7б; docs/specs/2026-10-vertical-slice.md, «Б7б»; геймдизайн, §3.3, §3.4). Устройство — как у
// стройки «Больницы» (`Nefeste/bolnitsa` @ e804637, src/engine/hospital/site.ts): правка — новый объект плана, проверки
// одни для призрака окна и команды движка, цена — по площади, снос возвращает половину. План свой: помещения с типом
// каталога и классом, двери между двумя помещениями, шлюзы, зоны склада, ряды стеллажей, проезд техники, корпус
// прямоугольниками. Чистые функции над планом: новый план с номером правки на один больше, цена и что правка закрывает
// на перестройку — или ошибка «нельзя» с причиной. Состояние завода здесь не читают: занятое, касса и отмена — у
// команды (src/engine/build.ts).
import type { BuildPrices, ContentDb, DoorKind, Plant, ZoneKind } from '../../content/types';
import { buildNav, CELL, CELL_CM, type Nav, RACK } from '../nav';
import { planOf } from '../plant';
import { type SitePlan, planRev } from '../types';
import { FLOOR, levelOf, roleOf, type SiteError, type SiteThing, siteErrors } from './checks';

/** Прямоугольник клеток: x, z, ширина, глубина — со стенами у помещения и корпуса, пол — у зоны. */
export type Cells = [number, number, number, number];

/** Двери, которые ставит стройка: рампы и вход — как в плане сценария, новых в Б7б нет (геймдизайн, §3.1). */
export type BuildDoor = Exclude<DoorKind, 'dock'>;

/** Зоны склада, которые красит стройка: пробоотбор и паллетирование — у пробоотборной и линии, с Б7в. */
export const BUILD_ZONES: readonly ZoneKind[] = ['receiving', 'quarantine', 'cold', 'rejected', 'fgQuarantine', 'shipping', 'staging'];

/** Сколько клеток у двери по виду: одинарная и передаточное окно — одна, двойная — две, ворота — от двух до четырёх. */
export const DOOR_LEN: Record<BuildDoor, [number, number]> = { door: [1, 1], double: [2, 2], hatch: [1, 1], gate: [2, 4] };

/** Что правит команда стройки (геймдизайн, §3.3). */
export type BuildOp =
  | { op: 'room'; type: string; grade: 'D' | 'cnc'; rect: Cells; vehicles?: boolean }
  | { op: 'hull'; rect: Cells }
  | { op: 'door'; cell: [number, number]; len: number; along: 'x' | 'z'; kind: BuildDoor; materials?: true }
  | { op: 'zone'; kind: ZoneKind; rect: Cells }
  | { op: 'rack'; x: number; z: number; bays: number; levels: number; face: 'n' | 's' }
  | { op: 'vehicles'; room: string; on: boolean }
  /** снос: помещение, дверь — «x,z» её первой клетки, зона, ряд стеллажа */
  | { op: 'demolish'; what: 'room' | 'door' | 'zone' | 'rack'; id: string };

/**
 * Почему нельзя: ошибка планировки «нельзя» в плане после правки; «отрежет» — не дойти или не доехать до того, до чего
 * доходили; тип, который в Б7б не строят; наложение на пол, дверь или вещь; корпус не примыкает стеной или лежит поверх
 * корпуса; дверь на улицу; «только для материалов» не у шлюза для материалов; зона или ряд — не в помещении склада;
 * холод — не в холодной камере; вид зоны, который не красят; дверь не той длины; размер ряда; ряды кончились; в сносимом
 * помещении вещь — снос с Б7в; наружную дверь не сносят; вещи нет; проезд уже такой; корпус меньше 4 × 4.
 */
export type BuildError =
  | { code: 'site'; error: SiteError }
  | { code: 'cutsOff'; what: SiteThing }
  | { code: 'notBuilt'; type: string }
  | { code: 'overlap' }
  | { code: 'hullTouch' }
  | { code: 'hullOver' }
  | { code: 'hullSmall' }
  | { code: 'street' }
  | { code: 'materials' }
  | { code: 'notStorage' }
  | { code: 'notCold' }
  | { code: 'zoneKind' }
  | { code: 'doorLen'; len: [number, number] }
  | { code: 'rackSize' }
  | { code: 'rackNames' }
  | { code: 'hasThings'; thing: string }
  | { code: 'outerDoor' }
  | { code: 'noThing' }
  | { code: 'same' };

/** Счётчики имён новых вещей: тип помещения, `zone`, `rack` — номер буквы ряда. Отмена их не возвращает. */
export type Names = Record<string, number>;

/**
 * Правка удалась: новый план, цена без НДС, возврат за снос без НДС, помещение, которое правка закрывает на перестройку
 * (нет — дверь, корпус, снос помещения), имя новой или снесённой вещи и счётчики имён.
 */
export interface Edited {
  ok: true;
  plan: SitePlan;
  cost: number;
  refund: number;
  room?: string;
  thing: string;
  names: Names;
}
export type EditResult = Edited | { ok: false; error: BuildError };

const fail = (error: BuildError): { ok: false; error: BuildError } => ({ ok: false, error });
const cm = (r: Cells): [number, number, number, number] => [r[0] * CELL_CM, r[1] * CELL_CM, r[2] * CELL_CM, r[3] * CELL_CM];
const m2 = (r: readonly [number, number, number, number]) => (r[2] / CELL_CM) * (r[3] / CELL_CM);
const isAirlock = (db: ContentDb, type: string) => {
  const role = roleOf(db, type);
  return role === 'airlockPeople' || role === 'airlockMaterial';
};

// --- цена ------------------------------------------------------------------------------------------------------------

/** Цена помещения: метр по классу (шлюз — класс D), у шлюза — ещё блокировка дверей. */
export function roomPrice(db: ContentDb, b: BuildPrices, r: Pick<Plant['rooms'][number], 'type' | 'grade' | 'rect'>): number {
  return m2(r.rect) * (r.grade === 'D' ? b.room.D : b.room.cnc) + (isAirlock(db, r.type) ? b.interlock : 0);
}

/** Цена двери: одинарная — по классу (в класс D — дверь чистого помещения), двойная — во столько раз дороже, ворота, окно. */
export function doorPrice(b: BuildPrices, kind: DoorKind, intoD: boolean): number {
  const one = intoD ? b.door.D : b.door.cnc;
  if (kind === 'door') return one;
  if (kind === 'double') return one * b.double;
  if (kind === 'gate') return b.gate;
  if (kind === 'hatch') return b.hatch;
  return 0;
}

/** Цена ряда стеллажа: места паллет — секции × ярусы × места секции. */
export const rackPrice = (b: BuildPrices, r: { bays: number; levels: number }) => r.bays * r.levels * RACK.slots * b.rack;

/** Цена корпуса: метр внутренности — прямоугольник без стен (геймдизайн, §3.3). */
export const hullPrice = (b: BuildPrices, rect: Cells) => (rect[2] - 2) * (rect[3] - 2) * b.hull;

/** Снос возвращает половину цены (геймдизайн, §3.3). */
export const half = (sum: number) => Math.floor(sum / 2);

// --- что где ----------------------------------------------------------------------------------------------------------

/** Сетка плана без дверей: по ней видно, что по обе стороны стены; одна на план. */
const bares = new WeakMap<Plant, Nav>();
function bareOf(db: ContentDb, plant: Plant): Nav {
  let n = bares.get(plant);
  if (!n) bares.set(plant, (n = buildNav(db, { ...plant, doors: [] })));
  return n;
}

/** Помещения по сторонам двери: номера в плане, −1 — улица; клетка не на стене — `undefined`. */
export function doorSides(db: ContentDb, plant: Plant, d: Plant['doors'][number]): [number, number] | undefined {
  const bare = bareOf(db, plant);
  const side = (x: number, z: number): number | undefined => {
    if (x < 0 || z < 0 || x >= bare.w || z >= bare.h) return -1;
    const c = bare.cells[z * bare.w + x];
    if (c === CELL.outside) return -1;
    return c === CELL.floor || c === CELL.corridor ? bare.room[z * bare.w + x] : undefined;
  };
  const [x, z] = d.cell;
  const a = d.along === 'x' ? side(x, z - 1) : side(x - 1, z);
  const b = d.along === 'x' ? side(x, z + 1) : side(x + 1, z);
  return a === undefined || b === undefined ? undefined : [a, b];
}

/** Клетки двери. */
const doorCells = (d: { cell: [number, number]; len: number; along: 'x' | 'z' }): [number, number][] =>
  Array.from({ length: d.len }, (_, j) => (d.along === 'x' ? [d.cell[0] + j, d.cell[1]] : [d.cell[0], d.cell[1] + j]));

/** Номер помещения, на полу которого клетка; не пол — −1. */
const floorRoom = (nav: Nav, x: number, z: number) => (x >= 0 && z >= 0 && x < nav.w && z < nav.h && nav.cells[z * nav.w + x] === CELL.floor ? nav.room[z * nav.w + x] : -1);

/** Номер помещения зоны или ряда — по его первой клетке; не на полу — −1. */
export function thingRoom(db: ContentDb, plant: Plant, what: 'zone' | 'rack', id: string): number {
  const nav = planOf(db, plant).nav;
  if (what === 'zone') {
    const z = plant.zones.find(x => x.id === id);
    return z ? floorRoom(nav, Math.floor(z.rect[0] / CELL_CM), Math.floor(z.rect[1] / CELL_CM)) : -1;
  }
  const r = plant.racks.find(x => x.id === id);
  return r ? floorRoom(nav, Math.floor(r.x / CELL_CM), Math.floor((r.z + RACK.depth / 2) / CELL_CM)) : -1;
}

/**
 * Вещи помещения, с которыми его не сносят (с Б7в): оборудование, машины линии, приборы, датчики, посты, рампы, вход и
 * стоянка, зоны и ряды стеллажей; первая по порядку — её имя, нет — `undefined`.
 */
export function thingIn(db: ContentDb, plant: Plant, room: string): string | undefined {
  const i = plant.rooms.findIndex(r => r.id === room);
  const nav = planOf(db, plant).nav;
  const here = (x: number, z: number) => floorRoom(nav, Math.floor(x / CELL_CM), Math.floor(z / CELL_CM)) === i || cellRoom(nav, x, z) === i;
  const first =
    plant.equipment.find(e => e.room === room)?.id ??
    plant.lines.find(l => l.room === room)?.id ??
    [...plant.instruments, ...plant.ipc, ...plant.sensors].find(m => m.room === room)?.id ??
    Object.entries(plant.posts).find(([, p]) => here(p[0], p[1]))?.[0] ??
    plant.docks.find(d => here(d.x, d.z) || (doorRoomOf(db, plant, d) ?? -2) === i)?.id ??
    (here(plant.points.entrance[0], plant.points.entrance[1]) ? 'entrance' : undefined) ??
    (here(plant.points.park[0], plant.points.park[1]) ? 'park' : undefined) ??
    plant.zones.find(z => thingRoom(db, plant, 'zone', z.id) === i)?.id ??
    plant.racks.find(r => thingRoom(db, plant, 'rack', r.id) === i)?.id;
  return first;
}

/** Номер помещения клетки (пол, коридор); иначе −1. */
function cellRoom(nav: Nav, x: number, z: number): number {
  const cx = Math.floor(x / CELL_CM);
  const cz = Math.floor(z / CELL_CM);
  if (cx < 0 || cz < 0 || cx >= nav.w || cz >= nav.h) return -1;
  const c = nav.cells[cz * nav.w + cx];
  return c === CELL.floor || c === CELL.corridor ? nav.room[cz * nav.w + cx] : -1;
}

/** Помещение рампы — номер в плане: по эту сторону ворот рампы; ворот нет — `undefined`. */
export function doorRoomOf(db: ContentDb, plant: Plant, dock: Plant['docks'][number]): number | undefined {
  const d = plant.doors.find(x => doorCells(x).some(([cx, cz]) => cx === Math.floor(dock.x / CELL_CM) && cz === Math.floor(dock.z / CELL_CM)));
  if (!d) return undefined;
  const s = doorSides(db, plant, d);
  return s ? Math.max(s[0], s[1]) : undefined;
}

// --- проверка после правки ------------------------------------------------------------------------------------------

const keyOf = (e: SiteError) => JSON.stringify(e);
const before = new WeakMap<Plant, SiteError[]>();
/** Ошибки планировки плана — одни на объект плана: проверка после правки и то, что не работает (src/engine/build.ts). */
export const errorsOf = (db: ContentDb, plant: Plant): readonly SiteError[] => {
  let e = before.get(plant);
  if (!e) before.set(plant, (e = siteErrors(db, plant)));
  return e;
};

/**
 * План после правки: новая ошибка «нельзя» — отказ (не дойти до места, поста или рампы — «отрежет»); помещение, до
 * которого доходили, а теперь не дойти, — «отрежет»; новое помещение без пути от входа — красная, строится.
 */
function verdict(db: ContentDb, was: Plant, now: Plant): BuildError | undefined {
  const had = errorsOf(db, was);
  const old = new Set(had.map(keyOf));
  const errs = errorsOf(db, now);
  for (const e of errs) {
    if (old.has(keyOf(e)) || levelOf(e) !== 'no') continue;
    if (e.code === 'walk' || e.code === 'drive') return { code: 'cutsOff', what: e.what };
    return { code: 'site', error: e };
  }
  const lost = new Set(had.filter(e => e.code === 'walk' && e.what.kind === 'room').map(e => (e.code === 'walk' ? e.what.id : '')));
  for (const e of errs) {
    if (e.code !== 'walk' || e.what.kind !== 'room' || lost.has(e.what.id)) continue;
    if (was.rooms.some(r => r.id === e.what.id)) return { code: 'cutsOff', what: e.what };
  }
  return undefined;
}

/** Имя с номером, которого в плане нет: `<основа>-<n>`; счётчик — дальше. */
function nameOf(base: string, names: Names, taken: (id: string) => boolean): [string, Names] {
  let n = names[base] ?? 1;
  while (taken(`${base}-${n}`)) n++;
  return [`${base}-${n}`, { ...names, [base]: n + 1 }];
}

// --- правка -----------------------------------------------------------------------------------------------------------

/** Правка плана: новый план и цена — или почему нельзя. */
export function editPlan(db: ContentDb, b: BuildPrices, plan: SitePlan, op: BuildOp, names: Names): EditResult {
  const nav = planOf(db, plan).nav;
  const rev = planRev(plan) + 1;
  const done = (next: Omit<SitePlan, 'rev'>, cost: number, thing: string, extra: { refund?: number; room?: string; names?: Names } = {}): EditResult => {
    const after: SitePlan = { ...next, rev };
    const why = verdict(db, plan, after);
    if (why) return fail(why);
    return { ok: true, plan: after, cost, refund: extra.refund ?? 0, ...(extra.room ? { room: extra.room } : {}), thing, names: extra.names ?? names };
  };
  const cellAt = (x: number, z: number) => (x >= 0 && z >= 0 && x < nav.w && z < nav.h ? nav.cells[z * nav.w + x] : CELL.outside);
  switch (op.op) {
    case 'room': {
      const t = db.rooms[op.type];
      if (!t) return fail({ code: 'site', error: { code: 'roomType', room: '', type: op.type } });
      if (!t.build) return fail({ code: 'notBuilt', type: op.type });
      const [x0, z0, w, d] = op.rect;
      if (w < 3 || d < 3) return fail({ code: 'site', error: { code: 'small', room: '', min: t.min } });
      // пол — на «не застроено»; стены — на «не застроено», на стене корпуса или на стене соседа: стена общая
      for (let z = z0; z < z0 + d; z++) {
        for (let x = x0; x < x0 + w; x++) {
          const c = cellAt(x, z);
          const edge = x === x0 || z === z0 || x === x0 + w - 1 || z === z0 + d - 1;
          if (c === CELL.outside) return fail({ code: 'site', error: { code: 'outsideHull', room: '' } });
          if (edge ? c !== CELL.unbuilt && c !== CELL.wall : c !== CELL.unbuilt) return fail({ code: 'overlap' });
        }
      }
      const [id, next] = nameOf(op.type, names, k => plan.rooms.some(r => r.id === k));
      const room = { id, type: op.type, rect: cm(op.rect), grade: op.grade, vehicles: !!op.vehicles, floor: FLOOR };
      const areas = t.area ? plan.areas.map(a => (a.code === t.area ? { ...a, rooms: [...a.rooms, id] } : a)) : plan.areas;
      return done({ ...plan, rooms: [...plan.rooms, room], areas }, roomPrice(db, b, room), id, { room: id, names: next });
    }
    case 'hull': {
      const [x0, z0, w, d] = op.rect;
      if (w < 4 || d < 4) return fail({ code: 'hullSmall' });
      const h = (x: number, z: number) => (x >= 0 && z >= 0 && x < nav.w && z < nav.h ? nav.hull[z * nav.w + x] : 0);
      for (let z = z0 + 1; z < z0 + d - 1; z++) for (let x = x0 + 1; x < x0 + w - 1; x++) if (h(x, z) === 1) return fail({ code: 'hullOver' });
      // общая стена: клетки края без углов на стене корпуса — внутренность; подряд идущие — прямоугольником в клетку
      const runs: Cells[] = [];
      const side = (cells: [number, number][]) => {
        let run: [number, number][] = [];
        const flush = () => {
          if (run.length) {
            const xs = run.map(c => c[0]);
            const zs = run.map(c => c[1]);
            runs.push([Math.min(...xs), Math.min(...zs), Math.max(...xs) - Math.min(...xs) + 1, Math.max(...zs) - Math.min(...zs) + 1]);
          }
          run = [];
        };
        for (const c of cells) {
          if (h(c[0], c[1]) === 2) run.push(c);
          else flush();
        }
        flush();
      };
      side(Array.from({ length: w - 2 }, (_, i) => [x0 + 1 + i, z0]));
      side(Array.from({ length: w - 2 }, (_, i) => [x0 + 1 + i, z0 + d - 1]));
      side(Array.from({ length: d - 2 }, (_, i) => [x0, z0 + 1 + i]));
      side(Array.from({ length: d - 2 }, (_, i) => [x0 + w - 1, z0 + 1 + i]));
      if (runs.length === 0) return fail({ code: 'hullTouch' });
      const hull = [...plan.hull, cm([x0 + 1, z0 + 1, w - 2, d - 2]), ...runs.map(cm)];
      return done({ ...plan, hull }, hullPrice(b, op.rect), 'hull');
    }
    case 'door': {
      const [lo, hi] = DOOR_LEN[op.kind] ?? [0, -1];
      if (op.len < lo || op.len > hi) return fail({ code: 'doorLen', len: [lo, hi] });
      const door = { cell: op.cell, len: op.len, along: op.along, kind: op.kind, ...(op.materials ? { materials: true as const } : {}) };
      for (const [x, z] of doorCells(door)) {
        const c = cellAt(x, z);
        if (c === CELL.door) return fail({ code: 'overlap' });
        if (c !== CELL.wall) return fail({ code: 'site', error: { code: 'doorWall', door: plan.doors.length, x, z } });
      }
      const after = { ...plan, doors: [...plan.doors, door] };
      // по сторонам стены — те же помещения, что и до двери: сетка без дверей у плана одна
      const sides = doorSides(db, plan, door);
      if (sides && (sides[0] < 0 || sides[1] < 0)) return fail({ code: 'street' });
      if (op.materials && !(sides && sides.some(i => i >= 0 && roleOf(db, plan.rooms[i].type) === 'airlockMaterial'))) return fail({ code: 'materials' });
      const intoD = !!sides && sides.some(i => i >= 0 && plan.rooms[i].grade === 'D');
      return done(after, doorPrice(b, op.kind, intoD), doorId(door));
    }
    case 'zone': {
      if (!BUILD_ZONES.includes(op.kind)) return fail({ code: 'zoneKind' });
      const [x0, z0, w, d] = op.rect;
      const room = floorRoom(nav, x0, z0);
      if (room < 0) return fail({ code: 'notStorage' });
      if (roleOf(db, plan.rooms[room].type) !== 'storage') return fail({ code: 'notStorage' });
      if (op.kind === 'cold' && plan.rooms[room].type !== 'cold') return fail({ code: 'notCold' });
      // на полу одного помещения, не на стеллаже, оборудовании и другой зоне
      for (let z = z0; z < z0 + d; z++) {
        for (let x = x0; x < x0 + w; x++) {
          if (floorRoom(nav, x, z) !== room || nav.blocked[z * nav.w + x]) return fail({ code: 'overlap' });
          const cx = x * CELL_CM + CELL_CM / 2;
          const cz = z * CELL_CM + CELL_CM / 2;
          if (plan.zones.some(o => cx >= o.rect[0] && cx < o.rect[0] + o.rect[2] && cz >= o.rect[1] && cz < o.rect[1] + o.rect[3])) return fail({ code: 'overlap' });
        }
      }
      const [id, next] = nameOf('zone', names, k => plan.zones.some(z => z.id === k));
      const grid: [number, number] = [Math.max(1, Math.floor((w * CELL_CM) / b.step)), Math.max(1, Math.floor((d * CELL_CM) / b.step))];
      const zone = { id, kind: op.kind, rect: cm(op.rect), grid };
      return done({ ...plan, zones: [...plan.zones, zone] }, 0, id, { room: plan.rooms[room].id, names: next });
    }
    case 'rack': {
      if (op.bays < 1 || op.bays > 30 || op.levels < 1 || op.levels > 6) return fail({ code: 'rackSize' });
      const room = floorRoom(nav, op.x, op.z);
      if (room < 0 || roleOf(db, plan.rooms[room].type) !== 'storage') return fail({ code: 'notStorage' });
      // буква — следующая за рядами плана; у счётчика — номер буквы
      const used = plan.racks.map(r => r.id.charCodeAt(0) - 65);
      let n = Math.max(names.rack ?? 0, ...used.map(u => u + 1));
      while (plan.racks.some(r => r.id === String.fromCharCode(65 + n))) n++;
      if (n > 25) return fail({ code: 'rackNames' });
      const id = String.fromCharCode(65 + n);
      const rack = { id, x: op.x * CELL_CM, z: op.z * CELL_CM, bays: op.bays, levels: op.levels, face: op.face };
      return done({ ...plan, racks: [...plan.racks, rack] }, rackPrice(b, rack), id, { room: plan.rooms[room].id, names: { ...names, rack: n + 1 } });
    }
    case 'vehicles': {
      const r = plan.rooms.find(x => x.id === op.room);
      if (!r) return fail({ code: 'noThing' });
      if (r.vehicles === op.on) return fail({ code: 'same' });
      return done({ ...plan, rooms: plan.rooms.map(x => (x === r ? { ...x, vehicles: op.on } : x)) }, 0, r.id, { room: r.id });
    }
    case 'demolish':
      return demolish(db, b, plan, op, done);
  }
}

/** Дверь по имени — «x,z» её первой клетки. */
export const doorId = (d: { cell: [number, number] }) => `${d.cell[0]},${d.cell[1]}`;

/** Двери в помещение номер `i` плана. */
const doorsInto = (db: ContentDb, plan: Plant, i: number) => plan.doors.filter(d => doorSides(db, plan, d)?.includes(i));

/**
 * План без вещи — без проверок: помещение — с дверями в него и в участках ISA-95; дверь; зона; ряд. Вещи нет — тот же
 * план. Снос зовёт его после проверок; отложенный снос — и для планов в шагах отмены после своего шага: иначе отмена
 * поздней правки вернула бы снесённое даром.
 */
export function without(db: ContentDb, plan: SitePlan, what: 'room' | 'door' | 'zone' | 'rack', id: string): SitePlan {
  switch (what) {
    case 'room': {
      const i = plan.rooms.findIndex(r => r.id === id);
      if (i < 0) return plan;
      const gone = new Set(doorsInto(db, plan, i));
      const areas = plan.areas.map(a => (a.rooms.includes(id) ? { ...a, rooms: a.rooms.filter(x => x !== id) } : a));
      return { ...plan, rooms: plan.rooms.filter((_, k) => k !== i), doors: plan.doors.filter(d => !gone.has(d)), areas };
    }
    case 'door':
      return plan.doors.some(d => doorId(d) === id) ? { ...plan, doors: plan.doors.filter(d => doorId(d) !== id) } : plan;
    case 'zone':
      return plan.zones.some(z => z.id === id) ? { ...plan, zones: plan.zones.filter(z => z.id !== id) } : plan;
    case 'rack':
      return plan.racks.some(r => r.id === id) ? { ...plan, racks: plan.racks.filter(r => r.id !== id) } : plan;
  }
}

/** Снос: помещение без вещей — с дверями в него; дверь между помещениями; зона; ряд. Возврат — половина цены. */
function demolish(
  db: ContentDb,
  b: BuildPrices,
  plan: SitePlan,
  op: Extract<BuildOp, { op: 'demolish' }>,
  done: (next: Omit<SitePlan, 'rev'>, cost: number, thing: string, extra?: { refund?: number; room?: string }) => EditResult,
): EditResult {
  const next = () => without(db, plan, op.what, op.id);
  switch (op.what) {
    case 'room': {
      const i = plan.rooms.findIndex(r => r.id === op.id);
      if (i < 0) return fail({ code: 'noThing' });
      const thing = thingIn(db, plan, op.id);
      if (thing) return fail({ code: 'hasThings', thing });
      // двери в него — с ним
      const back = roomPrice(db, b, plan.rooms[i]) + doorsInto(db, plan, i).reduce((n, d) => n + doorPrice(b, d.kind, intoD(db, plan, d)), 0);
      return done(next(), 0, op.id, { refund: half(back) });
    }
    case 'door': {
      const d = plan.doors.find(x => doorId(x) === op.id);
      if (!d) return fail({ code: 'noThing' });
      const sides = doorSides(db, plan, d);
      if (d.kind === 'dock' || !sides || sides[0] < 0 || sides[1] < 0) return fail({ code: 'outerDoor' });
      return done(next(), 0, op.id, { refund: half(doorPrice(b, d.kind, intoD(db, plan, d))) });
    }
    case 'zone': {
      const z = plan.zones.find(x => x.id === op.id);
      if (!z) return fail({ code: 'noThing' });
      if (!BUILD_ZONES.includes(z.kind) || plan.lines.some(l => l.out === z.id)) return fail({ code: 'zoneKind' });
      const room = thingRoom(db, plan, 'zone', z.id);
      return done(next(), 0, z.id, room >= 0 ? { room: plan.rooms[room].id } : {});
    }
    case 'rack': {
      const r = plan.racks.find(x => x.id === op.id);
      if (!r) return fail({ code: 'noThing' });
      const room = thingRoom(db, plan, 'rack', r.id);
      return done(next(), 0, r.id, { refund: half(rackPrice(b, r)), ...(room >= 0 ? { room: plan.rooms[room].id } : {}) });
    }
  }
}

/** Дверь ведёт в класс D: одна из её сторон — помещение класса D. */
function intoD(db: ContentDb, plan: Plant, d: Plant['doors'][number]): boolean {
  const s = doorSides(db, plan, d);
  return !!s && s.some(i => i >= 0 && plan.rooms[i].grade === 'D');
}
