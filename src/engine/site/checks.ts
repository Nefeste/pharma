// Проверки планировки (Б7а, Б7б; docs/specs/2026-10-vertical-slice.md, «Б7а», «Б7б»; геймдизайн, §3.4; docs/10-domain.md,
// §4) — чистые функции движка над планом здания: корпус — на участке и одним куском, помещения — в корпусе, типа из
// каталога, класса и размера, которые типу можно; двери — на стенах между двумя помещениями или помещением и улицей;
// рампа — в наружной стене и на воротах рампы; в класс D — только через шлюз, а техника дальше шлюза не въезжает; бытовые
// не открываются в производство и склад; зоны, стеллажи, оборудование и машины — на полу своего помещения; от входа люди
// доходят до каждой рабочей точки, места паллеты и поста ожидания (пост — на проходимом полу), от стоянки техника — до
// каждого места и рампы; этаж — первый. Роль помещения — из каталога типов (content/rooms/), а не из имени типа.
// Сборщик базы зовёт их для плана сценария (tools/content/plan.ts — слова ошибок), стройка (Б7б) — для призрака и
// команды. Ошибка — код и вещь, без слов: слова — у того, кто показывает. Ступень ошибки (`levelOf`): «нельзя» — план
// такой не строят; «красная» — построено, но помещение не работает; «жёлтая» — замечание (геймдизайн, §3.4).
import type { ContentDb, Plant, RoomRole } from '../../content/types';
import { accessOf, buildNav, CELL, CELL_CM, cellOf, fieldTo, footprints, type Nav, RACK } from '../nav';
import { planOf } from '../plant';

/** Что не дойти или не доехать: рабочая точка помещения, место паллеты, пост роли, рампа. */
export type SiteThing = { kind: 'room' | 'slot' | 'post' | 'dock'; id: string };

/**
 * Ошибка планировки: `door` — номер двери в плане с нуля, `x`, `z` — клетка; `from`, `to` — помещения по сторонам двери
 * (`undefined` — улица); `hull` — номер прямоугольника корпуса.
 */
export type SiteError =
  | { code: 'lot'; hull: number }
  | { code: 'hullJoin' }
  | { code: 'roomType'; room: string; type: string }
  | { code: 'outsideHull'; room: string }
  | { code: 'small'; room: string; min: [number, number] }
  | { code: 'grade'; room: string }
  | { code: 'vehicles'; room: string }
  | { code: 'twice'; type: string }
  | { code: 'doorWall'; door: number; x: number; z: number }
  | { code: 'doorSides'; door: number; x: number; z: number }
  | { code: 'doorMixed'; door: number }
  | { code: 'dockInner'; door: number }
  | { code: 'airlock'; door: number; from?: string; to?: string }
  | { code: 'amenity'; room: string }
  | { code: 'vehicleD'; room: string }
  | { code: 'zoneFloor'; zone: string; x: number; z: number }
  | { code: 'rackFloor'; rack: string; x: number; z: number }
  | { code: 'outOfRoom'; thing: string; room: string }
  | { code: 'rejectedShared'; zone: string }
  | { code: 'washDoors'; room: string }
  | { code: 'oneAirlock'; room: string }
  | { code: 'entrance' }
  | { code: 'park' }
  | { code: 'walk'; what: SiteThing }
  | { code: 'drive'; what: SiteThing }
  | { code: 'post'; role: string }
  | { code: 'dockGate'; dock: string }
  | { code: 'floor'; thing: string; floor: number };

/** Ступень проверки (геймдизайн, §3.4): нельзя, красная — помещение не работает, жёлтая — замечание. */
export type SiteLevel = 'no' | 'red' | 'yellow';

/**
 * Ступень ошибки: вход в класс D не через шлюз, техника в классе D дальше шлюза и помещение, до которого не дойти от
 * входа, — красные; бытовое, открытое в производство или склад, отклонённое не в отдельном помещении, один проём у мойки
 * и сырьё с готовой продукцией через один шлюз — жёлтые; остальное — нельзя.
 */
export function levelOf(e: SiteError): SiteLevel {
  switch (e.code) {
    case 'airlock':
    case 'vehicleD':
      return 'red';
    case 'walk':
      return e.what.kind === 'room' ? 'red' : 'no';
    case 'amenity':
    case 'rejectedShared':
    case 'washDoors':
    case 'oneAirlock':
      return 'yellow';
    default:
      return 'no';
  }
}

/**
 * Помещение, которое не работает из-за красной ошибки (Б7б): вход в класс D не через шлюз — помещение класса D по ту
 * сторону двери; техника дальше шлюза — само помещение; не дойти — помещение без пути от входа.
 */
export function redRoom(e: SiteError): string | undefined {
  if (e.code === 'airlock') return e.to;
  if (e.code === 'vehicleD') return e.room;
  if (e.code === 'walk' && e.what.kind === 'room') return e.what.id;
  return undefined;
}

/** В 1.0 этаж один (решение по #82): у помещения, рампы и точек плана — первый. */
export const FLOOR = 1;

/** Роль помещения по каталогу типов; типа нет в каталоге — нет и роли. */
export const roleOf = (db: ContentDb, type: string): RoomRole | undefined => db.rooms[type]?.role;
const isAirlock = (role: RoomRole | undefined) => role === 'airlockPeople' || role === 'airlockMaterial';

/** Ошибки планировки плана здания — по порядку правил; нет ошибок — пустой список. */
export function siteErrors(db: ContentDb, plant: Plant): SiteError[] {
  const out: SiteError[] = [];
  for (const r of plant.rooms) if (r.floor !== FLOOR) out.push({ code: 'floor', thing: r.id, floor: r.floor });
  for (const d of plant.docks) if (d.floor !== FLOOR) out.push({ code: 'floor', thing: d.id, floor: d.floor });
  if (plant.points.floor !== FLOOR) out.push({ code: 'floor', thing: 'points', floor: plant.points.floor });
  // корпус (Б7б): с его стенами — на участке; внутренность — один кусок
  const [lw, lh] = plant.lot.size;
  plant.hull.forEach(([x, z, w, d], i) => {
    if (x < CELL_CM || z < CELL_CM || x + w + CELL_CM > lw || z + d + CELL_CM > lh) out.push({ code: 'lot', hull: i });
  });
  const plan = planOf(db, plant);
  const { nav } = plan;
  if (!oneHull(nav)) out.push({ code: 'hullJoin' });
  // помещения: тип из каталога; пол — во внутренности корпуса, стены — в корпусе или на его стенах; класс, проезд и
  // наименьший размер — какие типу можно; тип, который не строят, — один на план: стадия ищет помещение по типу
  const seen = new Set<string>();
  for (const r of plant.rooms) {
    const t = db.rooms[r.type];
    if (!t) {
      out.push({ code: 'roomType', room: r.id, type: r.type });
      continue;
    }
    if (!inHull(nav, r.rect)) out.push({ code: 'outsideHull', room: r.id });
    const [w, d] = [r.rect[2] / CELL_CM, r.rect[3] / CELL_CM];
    if (Math.min(w, d) < t.min[0] || Math.max(w, d) < t.min[1]) out.push({ code: 'small', room: r.id, min: t.min });
    if (!t.grades.includes(r.grade)) out.push({ code: 'grade', room: r.id });
    if (r.vehicles && !t.vehicles) out.push({ code: 'vehicles', room: r.id });
    if (!t.build && seen.has(r.type)) out.push({ code: 'twice', type: r.type });
    seen.add(r.type);
  }
  const bare: Nav = buildNav(db, { ...plant, doors: [] });
  const idOf = (i: number) => (i < 0 ? undefined : plant.rooms[i].id);
  // помещение по ту сторону стены: клетка за ней — пол, коридор или улица (стены, двери и «не застроено» — не в счёт)
  const side = (x: number, z: number): number | undefined => {
    if (x < 0 || z < 0 || x >= nav.w || z >= nav.h) return -1;
    const i = z * nav.w + x;
    const c = bare.cells[i];
    if (c === CELL.outside) return -1;
    if (c === CELL.floor || c === CELL.corridor) return bare.room[i];
    return undefined;
  };
  // проёмы помещений: сколько дверей ведёт в помещение (у мойки — свой вход грязного и выход чистого, Б7б)
  const doorsOf = new Map<number, number>();
  plant.doors.forEach((d, k) => {
    const sides = new Set<string>();
    for (let j = 0; j < d.len; j++) {
      const [x, z] = d.along === 'x' ? [d.cell[0] + j, d.cell[1]] : [d.cell[0], d.cell[1] + j];
      if (x < 0 || z < 0 || x >= nav.w || z >= nav.h || bare.cells[z * nav.w + x] !== CELL.wall) {
        out.push({ code: 'doorWall', door: k, x, z });
        return;
      }
      const a = d.along === 'x' ? side(x, z - 1) : side(x - 1, z);
      const b = d.along === 'x' ? side(x, z + 1) : side(x + 1, z);
      if (a === undefined || b === undefined || a === b) {
        out.push({ code: 'doorSides', door: k, x, z });
        return;
      }
      sides.add(`${a}/${b}`);
    }
    if (sides.size !== 1) {
      out.push({ code: 'doorMixed', door: k });
      return;
    }
    const [a, b] = [...sides][0].split('/').map(Number);
    const ra = a >= 0 ? plant.rooms[a] : undefined;
    const rb = b >= 0 ? plant.rooms[b] : undefined;
    if (d.kind === 'dock' && a >= 0 && b >= 0) out.push({ code: 'dockInner', door: k });
    if (d.kind === 'hatch') return;
    for (const i of [a, b]) if (i >= 0) doorsOf.set(i, (doorsOf.get(i) ?? 0) + 1);
    const roleA = ra ? roleOf(db, ra.type) : undefined;
    const roleB = rb ? roleOf(db, rb.type) : undefined;
    // в класс D — через шлюз: одна из сторон двери между разными классами — шлюз для людей или для материалов
    const gradeA = ra?.grade ?? 'cnc';
    const gradeB = rb?.grade ?? 'cnc';
    if (gradeA !== gradeB && !isAirlock(roleA) && !isAirlock(roleB)) {
      const [from, to] = gradeA === 'D' ? [b, a] : [a, b];
      out.push({ code: 'airlock', door: k, ...(idOf(from) ? { from: idOf(from) } : {}), ...(idOf(to) ? { to: idOf(to) } : {}) });
    }
    for (const [r, o, ro] of [
      [ra, rb, roleB],
      [rb, ra, roleA],
    ] as const) {
      if (r && roleOf(db, r.type) === 'amenity' && (o?.grade === 'D' || ro === 'storage')) out.push({ code: 'amenity', room: r.id });
    }
  });
  // техника доезжает до шлюза, дальше — нет: деревянная паллета дальше шлюза не проходит (геймдизайн, §3.4)
  for (const r of plant.rooms) if (r.grade === 'D' && r.vehicles && !isAirlock(roleOf(db, r.type))) out.push({ code: 'vehicleD', room: r.id });
  // у мойки свой вход грязного и выход чистого оборудования — два проёма (геймдизайн, §3.4; жёлтая)
  plant.rooms.forEach((r, i) => {
    if (db.rooms[r.type]?.twoWay && (doorsOf.get(i) ?? 0) < 2) out.push({ code: 'washDoors', room: r.id });
  });
  // зоны и стеллажи — на полу; оборудование и машины — в своём помещении
  for (const zn of plant.zones) {
    const [x0, z0, w, d] = zn.rect.map(v => v / CELL_CM);
    for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) if (x < 0 || z < 0 || x >= nav.w || z >= nav.h || nav.cells[z * nav.w + x] !== CELL.floor) out.push({ code: 'zoneFloor', zone: zn.id, x, z });
  }
  rackErrors(db, plant, nav, out);
  const inRoom = (id: string, room: string, at: [number, number]) => {
    const i = cellOf(nav, { x: at[0], z: at[1] });
    if (nav.cells[i] !== CELL.floor || plant.rooms[nav.room[i]]?.id !== room) out.push({ code: 'outOfRoom', thing: id, room });
  };
  for (const e of plant.equipment) inRoom(e.id, e.room, e.at);
  for (const ln of plant.lines) for (const m of ln.machines) inRoom(m.id, ln.room, m.at);
  // отклонённое хранится в отдельной запираемой зоне (геймдизайн, §3.4; жёлтая): в помещении зоны отклонённого нет
  // других зон и стеллажей
  const roomOfRect = (x: number, z: number) => {
    const i = cellOf(nav, { x, z });
    return nav.cells[i] === CELL.floor ? nav.room[i] : -1;
  };
  for (const zn of plant.zones) {
    if (zn.kind !== 'rejected') continue;
    const own = roomOfRect(zn.rect[0], zn.rect[1]);
    const shared = own < 0 || plant.zones.some(o => o !== zn && roomOfRect(o.rect[0], o.rect[1]) === own) || plant.racks.some(k => roomOfRect(k.x, k.z) === own);
    if (shared) out.push({ code: 'rejectedShared', zone: zn.id });
  }
  // сырьё и готовая продукция не идут через один шлюз (геймдизайн, §3.4; жёлтая): путь сырья — от зоны комплектации к
  // помещению первой стадии карт, путь готовой продукции — от зоны паллетирования линии к карантину готовой продукции
  // или рампе отгрузки; шлюз на обоих путях — замечание
  for (const room of sharedAirlocks(db, plant, nav)) out.push({ code: 'oneAirlock', room });
  // дойти и доехать
  const walk = fieldTo(nav, 'walk', accessOf(nav, plan.entrance, 'walk'));
  const drive = fieldTo(nav, 'drive', accessOf(nav, plan.park, 'drive'));
  const reach = (what: SiteThing, p: { x: number; z: number }, f: Int32Array, mover: 'walk' | 'drive') => {
    const c = accessOf(nav, p, mover);
    if (c < 0 || f[c] < 0) out.push({ code: mover, what });
  };
  if (accessOf(nav, plan.entrance, 'walk') < 0) out.push({ code: 'entrance' });
  if (accessOf(nav, plan.park, 'drive') < 0) out.push({ code: 'park' });
  for (const [id, r] of Object.entries(plan.room)) reach({ kind: 'room', id }, r, walk, 'walk');
  for (const sl of plan.slots) {
    reach({ kind: 'slot', id: sl.id }, sl, walk, 'walk');
    reach({ kind: 'slot', id: sl.id }, sl, drive, 'drive');
  }
  // пост ожидания — на полу, где можно стоять, не в стене и не внутри машины или стеллажа; от входа до него дойти
  for (const [role, p] of Object.entries(plan.posts)) {
    if (!nav.walk[cellOf(nav, p)]) out.push({ code: 'post', role });
    reach({ kind: 'post', id: role }, p, walk, 'walk');
  }
  for (const [id, d] of Object.entries(plan.dock)) {
    const c = cellOf(nav, d);
    if (nav.cells[c] !== CELL.door || plant.doors[nav.door[c]].kind !== 'dock') out.push({ code: 'dockGate', dock: id });
    reach({ kind: 'dock', id }, d, drive, 'drive');
  }
  return out;
}

/**
 * Шлюзы, через которые идут и сырьё, и готовая продукция: помещения-шлюзы на пути материала — по полу, коридорам и
 * дверям, включая двери только для материалов, в обход стеллажей и оборудования — от зоны комплектации к рабочей точке
 * помещения первой стадии каждой карты и от зоны паллетирования каждой линии к первому месту карантина готовой продукции
 * или, если такой зоны нет, к рампе отгрузки. Путь — кратчайший по клеткам, из равных — по порядку соседей: восток,
 * запад, юг, север. Не дойти — пути нет: это ошибки `walk`.
 */
function sharedAirlocks(db: ContentDb, plant: Plant, nav: Nav): string[] {
  const plan = planOf(db, plant);
  const open = (i: number) => {
    const c = nav.cells[i];
    if (nav.blocked[i]) return false;
    if (c === CELL.floor || c === CELL.corridor) return true;
    return c === CELL.door && plant.doors[nav.door[i]].kind !== 'hatch';
  };
  const via = (a: { x: number; z: number } | undefined, b: { x: number; z: number } | undefined): Set<number> => {
    const rooms = new Set<number>();
    if (!a || !b) return rooms;
    const from = cellOf(nav, a);
    const to = cellOf(nav, b);
    const prev = new Int32Array(nav.w * nav.h).fill(-2);
    prev[from] = -1;
    const queue = [from];
    for (let head = 0; head < queue.length && prev[to] === -2; head++) {
      const c = queue[head];
      const x = c % nav.w;
      for (const m of [x + 1 < nav.w ? c + 1 : -1, x > 0 ? c - 1 : -1, c + nav.w < prev.length ? c + nav.w : -1, c - nav.w]) {
        if (m < 0 || prev[m] !== -2 || !open(m)) continue;
        prev[m] = c;
        queue.push(m);
      }
    }
    if (prev[to] === -2) return rooms;
    for (let c = to; c >= 0; c = prev[c]) {
      const r = nav.cells[c] === CELL.floor || nav.cells[c] === CELL.corridor ? nav.room[c] : -1;
      if (r >= 0 && isAirlock(roleOf(db, plant.rooms[r].type))) rooms.add(r);
    }
    return rooms;
  };
  const stage = plan.byKind.staging?.[0];
  const raw = new Set<number>();
  for (const type of new Set(Object.values(db.recipes).map(rc => rc.stages[0]?.room))) {
    const id = type ? plan.roomOf[type] : undefined;
    for (const r of via(stage, id ? plan.room[id] : undefined)) raw.add(r);
  }
  const shared = new Set<number>();
  const fgTo = plan.byKind.fgQuarantine?.[0] ?? Object.values(plan.dock).find(d => d.kind === 'out');
  for (const ln of plant.lines) {
    const from = plan.byKind.palletizing?.find(sl => sl.group === ln.out);
    for (const r of via(from, fgTo)) if (raw.has(r)) shared.add(r);
  }
  return [...shared].sort((a, b) => a - b).map(i => plant.rooms[i].id);
}

/** Внутренность корпуса — один кусок: от любой её клетки до любой — по соседним клеткам внутренности. */
function oneHull(nav: Nav): boolean {
  let start = -1;
  let total = 0;
  for (let i = 0; i < nav.hull.length; i++) {
    if (nav.hull[i] !== 1) continue;
    total++;
    if (start < 0) start = i;
  }
  if (start < 0) return false;
  const seen = new Uint8Array(nav.hull.length);
  seen[start] = 1;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const x = c % nav.w;
    for (const m of [x + 1 < nav.w ? c + 1 : -1, x > 0 ? c - 1 : -1, c + nav.w < nav.hull.length ? c + nav.w : -1, c - nav.w]) {
      if (m < 0 || seen[m] || nav.hull[m] !== 1) continue;
      seen[m] = 1;
      queue.push(m);
    }
  }
  return queue.length === total;
}

/** Помещение в корпусе: пол — во внутренности корпуса, стены — во внутренности или на стене корпуса. */
function inHull(nav: Nav, rect: readonly [number, number, number, number]): boolean {
  const x0 = rect[0] / CELL_CM;
  const z0 = rect[1] / CELL_CM;
  const x1 = (rect[0] + rect[2]) / CELL_CM - 1;
  const z1 = (rect[1] + rect[3]) / CELL_CM - 1;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || z < 0 || x >= nav.w || z >= nav.h) return false;
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      const h = nav.hull[z * nav.w + x];
      if (edge ? h === 0 : h !== 1) return false;
    }
  }
  return true;
}

/**
 * Ряд стеллажа (Б7б): след — на полу одного помещения, не в стене, не на двери и не на следе оборудования, машины или
 * другого ряда; проход перед ним — на полу того же помещения.
 */
function rackErrors(db: ContentDb, plant: Plant, nav: Nav, out: SiteError[]): void {
  const prints = footprints(db, plant);
  plant.racks.forEach((r, k) => {
    const [x0, z0, x1, z1] = prints[k];
    let room = -2;
    for (let z = Math.floor(z0 / CELL_CM); z <= Math.floor((z1 - 1) / CELL_CM); z++) {
      for (let x = Math.floor(x0 / CELL_CM); x <= Math.floor((x1 - 1) / CELL_CM); x++) {
        const cx = x * CELL_CM + CELL_CM / 2;
        const cz = z * CELL_CM + CELL_CM / 2;
        // клетка следа — та, чья середина внутри следа (как в nav.ts)
        if (cx < x0 || cx >= x1 || cz < z0 || cz >= z1) continue;
        const i = z >= 0 && x >= 0 && x < nav.w && z < nav.h ? z * nav.w + x : -1;
        const other = prints.some((p, j) => j !== k && cx >= p[0] && cx < p[2] && cz >= p[1] && cz < p[3]);
        if (i < 0 || nav.cells[i] !== CELL.floor || other || (room !== -2 && nav.room[i] !== room)) {
          out.push({ code: 'rackFloor', rack: r.id, x, z });
          return;
        }
        room = nav.room[i];
      }
    }
    // проход — клетки перед рядом с его стороны: пол того же помещения
    const first = Math.ceil((r.z - CELL_CM / 2) / CELL_CM);
    const last = Math.ceil((r.z + RACK.depth - CELL_CM / 2) / CELL_CM) - 1;
    const row = r.face === 'n' ? first - 1 : last + 1;
    for (let x = Math.floor(x0 / CELL_CM); x <= Math.floor((x1 - 1) / CELL_CM); x++) {
      const i = row >= 0 && x >= 0 && x < nav.w && row < nav.h ? row * nav.w + x : -1;
      if (i < 0 || nav.cells[i] !== CELL.floor || nav.room[i] !== room) {
        out.push({ code: 'rackFloor', rack: r.id, x, z: row });
        return;
      }
    }
  });
}
