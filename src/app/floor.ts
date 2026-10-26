// Данные на полу (Б1и; docs/specs/2026-10-vertical-slice.md, «Б1и»; docs/13-art.md, §11): слои слева и клавиша L, где
// стоят столбики помещений и машин линии и доска «План — факт», высоты частей столбика — доли окна, число над ним, строки
// доски. Числа — гипотезы геймдизайна, §3.6. Чистые функции без Three.js и DOM — их проверяют тесты в Bun; рисует
// src/render/floor.ts.
import type { ContentDb } from '../content/types';
import { HOUR } from '../engine/core/calendar';
import { CELL } from '../engine/nav';
import type { Layout } from '../render/layout';
import { LAMP_COLOR } from '../render/flow';
import { type FloorView, MACHINE_PARTS, type MachineLoad, ROOM_PARTS } from '../sim/floor';
import type { Thing } from '../sim/views';
import type { Box } from './pick';

/** Слои слева (геймдизайн, §3.6, §18): обычный вид, загрузка и OEE (Б1и), потоки людей (Б1г) — по кругу клавишей L. */
export const LAYERS = ['plain', 'load', 'people'] as const;
export type Layer = (typeof LAYERS)[number];

export const nextLayer = (l: Layer): Layer => LAYERS[(LAYERS.indexOf(l) + 1) % LAYERS.length];

/**
 * Размеры (геймдизайн, §3.6; гипотезы), м: столбик помещения и машины линии — сторона; полная высота — всё окно; высота
 * числа над столбиком; доска «План — факт» — ширина, высота и нижний край.
 */
export const FLOOR = { room: 0.6, machine: 0.4, full: 2.4, digits: 0.35, board: { w: 2, h: 1.2, y: 1.8 } } as const;

/** Часть столбика: что это — состояние помещения или машины. */
export type Part = 'work' | 'clean' | 'held' | MachineLoad;

/**
 * Цвет части — одна палитра на все столбики (геймдизайн, §23): то же состояние — тот же цвет, что у лампы машины (2в):
 * работа и ход — зелёный, ожидание и «серия ждёт» — синий, микроостановки — жёлтый, авария — красный, наладка и уборка —
 * фиолетовый; медленнее номинала — бледно-зелёный, своего цвета у лампы нет. Каждая пара различима во всех четырёх видах
 * зрения (tools/test/palette.test.ts); цвет никогда не один — число есть у каждого столбика.
 */
export const PART_COLOR: Record<MachineLoad, number> = {
  run: LAMP_COLOR.run,
  slow: 0xc8f0a8,
  micro: LAMP_COLOR.stop,
  fail: LAMP_COLOR.fail,
  wait: LAMP_COLOR.wait,
  setup: LAMP_COLOR.setup,
};

/** Цвет части помещения — по смыслу: работа — ход, уборка и наладка — наладка, серия ждёт — ожидание. */
export const ROOM_AS: Record<'work' | 'clean' | 'held', MachineLoad> = { work: 'run', clean: 'setup', held: 'wait' };

export const colorOf = (p: Part): number => PART_COLOR[p in ROOM_AS ? ROOM_AS[p as keyof typeof ROOM_AS] : (p as MachineLoad)];

/** Где стоит столбик: вещь, середина основания, сторона, м. */
export interface Spot {
  thing: Thing;
  x: number;
  z: number;
  side: number;
}

/** Места слоя на плане: столбики помещений учёта и машин линий, доски — у конца каждой линии. */
export interface Spots {
  bars: Spot[];
  boards: { line: number; x: number; z: number }[];
}

/**
 * Место столбика в помещении: клетка пола, у которой все восемь соседей — пол того же помещения, без стен, дверей,
 * оборудования и машин, — дальше всех от дверей помещения; при равенстве — первая по порядку плана.
 */
function roomSpot(l: Layout, i: number): { x: number; z: number } | undefined {
  const nav = l.nav;
  const r = l.rooms[i];
  const doors = l.doors.filter(d => d.rooms.includes(i)).flatMap(d => d.cells);
  const free = (x: number, z: number) => x >= 0 && z >= 0 && x < nav.w && z < nav.h && nav.cells[z * nav.w + x] === CELL.floor && nav.room[z * nav.w + x] === i && !nav.blocked[z * nav.w + x];
  let best: { x: number; z: number } | undefined;
  let far = -1;
  for (let z = Math.ceil(r.z); z < r.z + r.d; z++) {
    for (let x = Math.ceil(r.x); x < r.x + r.w; x++) {
      let ok = true;
      for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1 && ok; dx++) ok = free(x + dx, z + dz);
      if (!ok) continue;
      const d = doors.reduce((m, [cx, cz]) => Math.min(m, Math.hypot(cx - x, cz - z)), Number.POSITIVE_INFINITY);
      if (d > far) {
        far = d;
        best = { x: x + 0.5, z: z + 0.5 };
      }
    }
  }
  return best;
}

/**
 * Места слоя: столбик помещения — на свободной клетке подальше от дверей; столбик машины — с северной стороны её следа,
 * в 0,2 м от него; доска — за последней машиной линии, по ходу ящиков, посередине между ней и стеной помещения.
 */
export function spotsOf(db: ContentDb, l: Layout, rooms: readonly string[]): Spots {
  const bars: Spot[] = [];
  for (const id of rooms) {
    const i = l.rooms.findIndex(r => r.id === id);
    const at = i >= 0 ? roomSpot(l, i) : undefined;
    if (at) bars.push({ thing: { kind: 'room', i }, ...at, side: FLOOR.room });
  }
  const boards: Spots['boards'] = [];
  l.plan.plant.lines.forEach((ln, line) => {
    ln.machines.forEach((m, k) => {
      const [, d] = m.turn % 2 === 0 ? [db.machines[m.type].size[0], db.machines[m.type].size[1]] : [db.machines[m.type].size[1], db.machines[m.type].size[0]];
      bars.push({ thing: { kind: 'machine', line, k }, x: m.at[0] / 100, z: (m.at[1] - d / 2) / 100 - 0.2 - FLOOR.machine / 2, side: FLOOR.machine });
    });
    // ход ящиков — от первой машины к последней, вдоль x или z; доска — за последней, до стены помещения
    const first = ln.machines[0];
    const last = ln.machines[ln.machines.length - 1];
    const a = Math.abs(last.at[0] - first.at[0]) >= Math.abs(last.at[1] - first.at[1]) ? 0 : 1;
    const dir = Math.sign(last.at[a] - first.at[a]) || -1;
    const size = db.machines[last.type].size;
    const len = (last.turn % 2 === 0) === (a === 0) ? size[0] : size[1];
    const room = l.rooms.find(r => r.id === ln.room);
    const edge = last.at[a] / 100 + (dir * len) / 200;
    const lo = room ? (a === 0 ? room.x : room.z) : edge - 2;
    const hi = room ? (a === 0 ? room.x + room.w : room.z + room.d) : edge + 2;
    const mid = (edge + (dir < 0 ? lo : hi)) / 2;
    boards.push(a === 0 ? { line, x: mid, z: last.at[1] / 100 } : { line, x: last.at[0] / 100, z: mid });
  });
  return { bars, boards };
}

/** Часть столбика на полу: от `y0` высотой `h`, м. */
export interface BarPart {
  part: Part;
  y0: number;
  h: number;
}

/** Столбик слоя: место и его номер по порядку мест, части снизу вверх и то, что написано над ним. */
export interface Bar extends Spot {
  n: number;
  parts: BarPart[];
  label: Label;
}

/**
 * Число над столбиком: у помещения — доля работы; у ключевой машины — OEE с доступностью, производительностью и
 * качеством; у других машин — доля хода. Учёта за окно нет — прочерк.
 */
export type Label =
  | { k: 'room'; share?: number }
  | { k: 'key'; oee: number; a: number; p: number; q: number }
  | { k: 'run'; share?: number };

/** Доля 1/10 000. */
const share = (x: number, of: number) => (of > 0 ? Math.round((x * 10000) / of) : 0);

/** Части столбика по секундам состояний: высота — доля окна от полной высоты; нулевые части пропущены. */
function partsOf(list: readonly { part: Part; sec: number }[], span: number): BarPart[] {
  const out: BarPart[] = [];
  let y = 0;
  for (const { part, sec } of list) {
    if (sec <= 0 || span <= 0) continue;
    const h = (FLOOR.full * sec) / span;
    out.push({ part, y0: y, h });
    y += h;
  }
  return out;
}

/** Столбики вида «Пол» на своих местах. */
export function barsOf(spots: Spots, v: FloorView): Bar[] {
  const out: Bar[] = [];
  for (const [n, sp] of spots.bars.entries()) {
    const t = sp.thing;
    if (t.kind === 'room') {
      const r = v.rooms.find(x => x.i === t.i);
      if (!r) continue;
      out.push({ ...sp, n, parts: partsOf(ROOM_PARTS.map(p => ({ part: p as Part, sec: r.times[p] })), v.span), label: { k: 'room', ...(v.span > 0 ? { share: share(r.times.work, v.span) } : {}) } });
    } else if (t.kind === 'machine') {
      const l = v.lines.find(x => x.n === t.line);
      const m = l?.machines[t.k];
      if (!l || !m) continue;
      const o = l.sum.key === t.k ? l.sum.oee : undefined;
      const label: Label = o ? { k: 'key', oee: o.oee, a: o.a, p: o.p, q: o.q } : { k: 'run', ...(v.span > 0 ? { share: share(m.run + m.slow, v.span) } : {}) };
      out.push({ ...sp, n, parts: partsOf(MACHINE_PARTS.map(p => ({ part: p, sec: m[p] })), v.span), label });
    }
  }
  return out;
}

/** Короба столбиков для выбора щелчком и наведения: основание и полная высота окна. */
export function barBoxes(spots: Spots): Box[] {
  return spots.bars.map(b => ({ thing: b.thing, min: [b.x - b.side / 2, 0, b.z - b.side / 2], max: [b.x + b.side / 2, FLOOR.full, b.z + b.side / 2] }));
}

/** Строка доски «План — факт»: начало часа (с), план и годные; ниже плана — только у прошедшего часа. */
export interface BoardRow {
  from: number;
  plan: number;
  fact?: number;
  now: boolean;
  low: boolean;
}

/** Строки доски по часам смены. */
export function boardRows(b: NonNullable<FloorView['lines'][number]['board']>): BoardRow[] {
  return b.hours.map((h, i) => ({ from: b.from + i * HOUR, plan: h.plan, ...(h.fact !== undefined ? { fact: h.fact } : {}), now: b.now === i, low: h.fact !== undefined && b.now !== i && h.fact < h.plan }));
}
