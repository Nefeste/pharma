// Сетка плана и маршруты (docs/specs/2026-10-view.md, 2а, «Маршруты»). Клетка — 1 × 1 м, как у «Больницы»: помещение —
// прямоугольник со стенами по краю, двери — клетки на стенах. Человек ходит по полу, коридорам и дверям в обход стеллажей и
// оборудования; техника — только по помещениям, куда ей можно, через ворота и рампы. Длина пути — от точки до середины её
// клетки, по сетке 100 см за шаг и от середины последней клетки до точки; окно рисует те же клетки, поэтому паллета на
// экране едет ровно тем путём, который посчитал движок. Поля расстояний — чистая функция плана: запоминаются на план, на
// результат кэш не влияет.
import type { ContentDb, Plant } from '../content/types';

/** Вид клетки (как сетка «Больницы»): улица, пол помещения, коридор, стена, дверь. */
export const CELL = { outside: 0, floor: 1, corridor: 2, wall: 3, door: 4 } as const;
export type CellKind = (typeof CELL)[keyof typeof CELL];

/** Кто идёт: человек пешком или техника. */
export type Mover = 'walk' | 'drive';

export interface Point {
  x: number;
  z: number;
}

/** Клетка, см. */
export const CELL_CM = 100;

/** Геометрия секции стеллажа, см: три места по 90 см, глубина 110, ярус 150 (как src/render/loads.ts, BAY). */
export const RACK = { bay: 270, depth: 110, level: 150, slots: 3 } as const;

export interface Nav {
  w: number;
  h: number;
  cells: Uint8Array;
  /** номер помещения клетки в `plant.rooms` (пол и стены — последнего, кто их поставил); −1 — нет */
  room: Int16Array;
  /** номер двери клетки в `plant.doors`; −1 — нет */
  door: Int16Array;
  /** середину клетки занимает стеллаж, оборудование или машина */
  blocked: Uint8Array;
  /** можно пройти человеку; проехать технике */
  walk: Uint8Array;
  drive: Uint8Array;
  /** клетки доступа точек, которые план знает заранее: места паллет (стеллаж — проход с его стороны) — `pointKey` → клетка */
  known: Map<number | string, number>;
  /** найденные клетки доступа прочих точек */
  access: Record<Mover, Map<number | string, number>>;
  /** поля расстояний до клетки, шаги; −1 — не дойти */
  fields: Record<Mover, Map<number, Int32Array>>;
}

const key = (p: Point) => `${p.x},${p.z}`;

/** Предел целых сантиметров числового ключа точки: план много меньше. */
const KEY_CM = 2 ** 24;

/**
 * Ключ точки для кэшей клеток доступа: целые сантиметры (так стоят места, люди и техника) — числом, без строки на каждый
 * путь; другая точка — строкой «x,z». Разные точки — разные ключи, одна точка — всегда один ключ.
 */
export function pointKey(p: Point): number | string {
  return Number.isInteger(p.x) && Number.isInteger(p.z) && p.x >= 0 && p.z >= 0 && p.x < KEY_CM && p.z < KEY_CM ? p.x * KEY_CM + p.z : key(p);
}

/** Прямоугольник клеток [x0, z0, x1, z1] включительно из прямоугольника записи в см. */
function cellsOf(r: readonly [number, number, number, number]): [number, number, number, number] {
  return [r[0] / CELL_CM, r[1] / CELL_CM, (r[0] + r[2]) / CELL_CM - 1, (r[1] + r[3]) / CELL_CM - 1];
}

/** Следы стеллажей, оборудования и машин на полу, см: [x0, z0, x1, z1]. */
export function footprints(db: ContentDb, plant: Plant): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const r of plant.racks) out.push([r.x, r.z, r.x + r.bays * RACK.bay, r.z + RACK.depth]);
  const box = (at: [number, number], turn: number, size: [number, number, number]): [number, number, number, number] => {
    // поворот на четверть: ширина и глубина меняются местами; точка — середина следа
    const [w, d] = turn % 2 === 0 ? [size[0], size[1]] : [size[1], size[0]];
    return [at[0] - Math.floor(w / 2), at[1] - Math.floor(d / 2), at[0] + Math.ceil(w / 2), at[1] + Math.ceil(d / 2)];
  };
  for (const e of plant.equipment) out.push(box(e.at, e.turn, db.equipment[e.type].size));
  for (const ln of plant.lines) for (const m of ln.machines) out.push(box(m.at, m.turn, db.machines[m.type].size));
  return out;
}


export function buildNav(db: ContentDb, plant: Plant): Nav {
  const [bx, bz, bw, bd] = plant.building;
  const w = (bx + bw) / CELL_CM;
  const h = (bz + bd) / CELL_CM;
  const n = w * h;
  const cells = new Uint8Array(n);
  const room = new Int16Array(n).fill(-1);
  const door = new Int16Array(n).fill(-1);
  const blocked = new Uint8Array(n);
  const walk = new Uint8Array(n);
  const drive = new Uint8Array(n);
  const at = (x: number, z: number) => z * w + x;
  // здание, затем помещения по порядку записи: стены — край прямоугольника, внутри — пол или коридор
  const ring = (r: readonly [number, number, number, number], inner: CellKind, idx: number) => {
    const [x0, z0, x1, z1] = cellsOf(r);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1 || z === z0 || z === z1;
        cells[at(x, z)] = edge ? CELL.wall : inner;
        room[at(x, z)] = idx;
      }
    }
  };
  ring(plant.building, CELL.floor, -1);
  plant.rooms.forEach((r, i) => ring(r.rect, r.type.startsWith('corridor') ? CELL.corridor : CELL.floor, i));
  plant.doors.forEach((d, i) => {
    for (let k = 0; k < d.len; k++) {
      const [x, z] = d.along === 'x' ? [d.cell[0] + k, d.cell[1]] : [d.cell[0], d.cell[1] + k];
      cells[at(x, z)] = CELL.door;
      door[at(x, z)] = i;
    }
  });
  // занятые клетки: середина клетки — внутри следа (начало включительно, конец — нет)
  for (const [x0, z0, x1, z1] of footprints(db, plant)) {
    for (let z = Math.floor(z0 / CELL_CM); z <= Math.floor(z1 / CELL_CM) && z < h; z++) {
      for (let x = Math.floor(x0 / CELL_CM); x <= Math.floor(x1 / CELL_CM) && x < w; x++) {
        const cx = x * CELL_CM + CELL_CM / 2;
        const cz = z * CELL_CM + CELL_CM / 2;
        if (cx >= x0 && cx < x1 && cz >= z0 && cz < z1) blocked[at(x, z)] = 1;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const open = c === CELL.floor || c === CELL.corridor || (c === CELL.door && plant.doors[door[i]].kind !== 'hatch' && !plant.doors[door[i]].materials);
    walk[i] = open && !blocked[i] ? 1 : 0;
    if (!walk[i]) continue;
    if (c === CELL.door) {
      const k = plant.doors[door[i]].kind;
      drive[i] = k === 'gate' || k === 'dock' ? 1 : 0;
    } else {
      drive[i] = room[i] >= 0 && plant.rooms[room[i]].vehicles ? 1 : 0;
    }
  }
  return { w, h, cells, room, door, blocked, walk, drive, known: new Map(), access: { walk: new Map(), drive: new Map() }, fields: { walk: new Map(), drive: new Map() } };
}

/** Номер клетки точки, см. */
export function cellOf(nav: Nav, p: Point): number {
  const x = Math.min(nav.w - 1, Math.max(0, Math.floor(p.x / CELL_CM)));
  const z = Math.min(nav.h - 1, Math.max(0, Math.floor(p.z / CELL_CM)));
  return z * nav.w + x;
}

/** Середина клетки, см. */
export function centerOf(nav: Nav, c: number): Point {
  return { x: (c % nav.w) * CELL_CM + CELL_CM / 2, z: Math.floor(c / nav.w) * CELL_CM + CELL_CM / 2 };
}

/** Соседи клетки по порядку: восток, запад, юг, север; за краем сетки — −1. */
function neighbours(nav: Nav, c: number, out: number[]) {
  const x = c % nav.w;
  out[0] = x + 1 < nav.w ? c + 1 : -1;
  out[1] = x > 0 ? c - 1 : -1;
  out[2] = c + nav.w < nav.w * nav.h ? c + nav.w : -1;
  out[3] = c - nav.w >= 0 ? c - nav.w : -1;
}

/**
 * Клетка доступа точки: известная плану (место паллеты), своя — если по ней можно пройти, иначе ближайшая проходимая в
 * ширину, не сквозь стены; при равенстве — по порядку соседей. Нет такой — −1.
 */
export function accessOf(nav: Nav, p: Point, mover: Mover): number {
  const k = pointKey(p);
  const known = nav.known.get(k);
  const ok = mover === 'walk' ? nav.walk : nav.drive;
  if (known !== undefined && ok[known]) return known;
  // своя клетка проходима — она и есть клетка доступа; так точки в пути на пост (staff.ts) не копятся в кэше
  const own = cellOf(nav, p);
  if (ok[own]) return own;
  const hit = nav.access[mover].get(k);
  if (hit !== undefined) return hit;
  const c = searchAccess(nav, p, ok);
  nav.access[mover].set(k, c);
  return c;
}

function searchAccess(nav: Nav, p: Point, ok: Uint8Array): number {
  const start = cellOf(nav, p);
  if (ok[start]) return start;
  const seen = new Uint8Array(nav.w * nav.h);
  const queue = [start];
  seen[start] = 1;
  const nb = [0, 0, 0, 0];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    if (ok[c]) return c;
    neighbours(nav, c, nb);
    for (const m of nb) {
      if (m < 0 || seen[m] || nav.cells[m] === CELL.wall || nav.cells[m] === CELL.outside) continue;
      seen[m] = 1;
      queue.push(m);
    }
  }
  return -1;
}

/** Поле расстояний до клетки `to` для того, кто идёт: шагов от каждой клетки; −1 — не дойти. */
export function fieldTo(nav: Nav, mover: Mover, to: number): Int32Array {
  const cache = nav.fields[mover];
  const hit = cache.get(to);
  if (hit) return hit;
  const ok = mover === 'walk' ? nav.walk : nav.drive;
  const f = new Int32Array(nav.w * nav.h).fill(-1);
  f[to] = 0;
  const queue = [to];
  const nb = [0, 0, 0, 0];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    neighbours(nav, c, nb);
    for (const m of nb) {
      if (m < 0 || f[m] !== -1 || !ok[m]) continue;
      f[m] = f[c] + 1;
      queue.push(m);
    }
  }
  cache.set(to, f);
  return f;
}

const manhattan = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);

/** Длина пути от `a` до `b`, см; не дойти — ошибка (сборка базы проверяет, что до мест и рабочих точек дойти можно). */
export function pathLength(nav: Nav, a: Point, b: Point, mover: Mover): number {
  const ca = accessOf(nav, a, mover);
  const cb = accessOf(nav, b, mover);
  if (ca < 0 || cb < 0) throw new Error(`nav: no ${mover} access at ${ca < 0 ? key(a) : key(b)}`);
  if (ca === cb) return manhattan(a, b);
  const steps = fieldTo(nav, mover, cb)[ca];
  if (steps < 0) throw new Error(`nav: no ${mover} path ${key(a)} → ${key(b)}`);
  return manhattan(a, centerOf(nav, ca)) + steps * CELL_CM + manhattan(centerOf(nav, cb), b);
}

/**
 * Путь от `a` до `b` для окна, см: ломаная из отрезков вдоль осей. От точки до середины её клетки — сначала по z, потом
 * по x (паллета выходит из стеллажа поперёк прохода); по клеткам — к соседу ближе к цели, из равных — прямо, затем по
 * порядку соседей; от середины последней клетки — сначала по x, потом по z. Длина ломаной равна `pathLength`.
 */
export function route(nav: Nav, a: Point, b: Point, mover: Mover): Point[] {
  const ca = accessOf(nav, a, mover);
  const cb = accessOf(nav, b, mover);
  if (ca < 0 || cb < 0) throw new Error(`nav: no ${mover} access at ${ca < 0 ? key(a) : key(b)}`);
  const pts: Point[] = [{ x: a.x, z: a.z }];
  const push = (p: Point) => {
    const last = pts[pts.length - 1];
    if (last.x === p.x && last.z === p.z) return;
    // три точки на одной прямой в одну сторону — средняя лишняя (назад по той же прямой — не лишняя: длина другая)
    if (pts.length >= 2) {
      const prev = pts[pts.length - 2];
      const alongZ = prev.x === last.x && last.x === p.x && Math.sign(last.z - prev.z) === Math.sign(p.z - last.z);
      const alongX = prev.z === last.z && last.z === p.z && Math.sign(last.x - prev.x) === Math.sign(p.x - last.x);
      if (alongZ || alongX) pts.pop();
    }
    pts.push({ x: p.x, z: p.z });
  };
  if (ca === cb) {
    push({ x: a.x, z: b.z });
    push(b);
    return pts;
  }
  const f = fieldTo(nav, mover, cb);
  if (f[ca] < 0) throw new Error(`nav: no ${mover} path ${key(a)} → ${key(b)}`);
  const s = centerOf(nav, ca);
  push({ x: a.x, z: s.z });
  push(s);
  const nb = [0, 0, 0, 0];
  let c = ca;
  let dir = -1;
  while (c !== cb) {
    neighbours(nav, c, nb);
    let next = -1;
    let nd = -1;
    if (dir >= 0 && nb[dir] >= 0 && f[nb[dir]] === f[c] - 1) {
      next = nb[dir];
      nd = dir;
    } else {
      for (let k = 0; k < 4; k++) {
        if (nb[k] >= 0 && f[nb[k]] === f[c] - 1) {
          next = nb[k];
          nd = k;
          break;
        }
      }
    }
    c = next;
    dir = nd;
    push(centerOf(nav, c));
  }
  const e = centerOf(nav, cb);
  push({ x: b.x, z: e.z });
  push(b);
  return pts;
}

/** Длина ломаной вдоль осей, см. */
export function polylineLength(pts: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += manhattan(pts[i - 1], pts[i]);
  return n;
}

/**
 * Точка ломаной вдоль осей (`route`) на расстоянии `d` см от начала; дальше конца — конец. Отрезки идут вдоль осей,
 * поэтому у целых вершин и целого `d` точка — в целых сантиметрах: движок хранит её в состоянии.
 */
export function pointAlong(pts: readonly Point[], d: number): Point {
  let left = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = manhattan(a, b);
    if (left <= len) return a.x === b.x ? { x: a.x, z: a.z + Math.sign(b.z - a.z) * left } : { x: a.x + Math.sign(b.x - a.x) * left, z: a.z };
    left -= len;
  }
  const last = pts[pts.length - 1];
  return { x: last.x, z: last.z };
}
