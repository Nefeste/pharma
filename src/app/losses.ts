// Слой «Потери» (Б1л; docs/specs/2026-10-vertical-slice.md, «Б1л»; docs/13-art.md, §11): где стоят столбики мест учёта
// потерь — помещений, зон и стеллажей склада, линий, рамп, — что выбрано в слое (вид потерь), части столбика и их
// высоты, число над ним, палитра частей, короба для щелчка и наведения. Числа — гипотезы геймдизайна, §3.6. Чистые
// функции без Three.js и DOM — их проверяют тесты в Bun; рисует src/render/losses.ts.
import type { ContentDb } from '../content/types';
import { T } from '../i18n';
import { YARD } from '../engine/lean';
import { roomAt } from '../engine/places';
import { CELL } from '../engine/nav';
import { RACK } from '../engine/plant';
import type { LossKind, WaitCause } from '../engine/types';
import { type Layout, outward } from '../render/layout';
import { LAMP_COLOR } from '../render/flow';
import { type FloorLoss, type FloorView, LOSS_KINDS } from '../sim/floor';
import type { Thing } from '../sim/views';
import { FLOOR, midSpot } from './floor';
import type { Box } from './pick';

/**
 * Вид потерь слоя (геймдизайн, §3.6): «все» — части по видам без «нет смены», или один вид; порядок — как у
 * переключателя слоя.
 */
export type LossPick = 'all' | LossKind;
export const LOSS_PICKS: readonly LossPick[] = ['all', 'wait', 'shift', 'move', 'walk', 'setup', 'again', 'defect'];

/** Виды частей у «всех» — снизу вверх; «нет смены» — свой вид, в «все» не входит. */
export const ALL_KINDS: readonly LossKind[] = LOSS_KINDS.filter(k => k !== 'shift');

/**
 * Семьи причин ожидания — по тому, что менять: люди (заняты, в отпуске, нет часов, нет допуска), приборы и техника
 * (заняты, калибровка или квалификация), места (нет свободного места, рампа занята). Причин девять — столько цветов,
 * различимых во всех четырёх видах зрения, нет; сама причина — в подсказке и в карточке.
 */
export type WaitFamily = 'people' | 'gear' | 'place';
export const WAIT_FAMILIES: readonly WaitFamily[] = ['people', 'gear', 'place'];
export const FAMILY_OF: Record<Exclude<WaitCause, 'shift'>, WaitFamily> = {
  people: 'people',
  leave: 'people',
  hours: 'people',
  qual: 'people',
  instrument: 'gear',
  asset: 'gear',
  vehicle: 'gear',
  place: 'place',
  dock: 'place',
};

/** Часть столбика потерь: вид или, у ожидания, семья причин. */
export type LossPart = LossKind | WaitFamily;

/**
 * Цвет вида (геймдизайн, §23): ожидание — синий, как «ждёт» у ламп и «Загрузки»; уборки и переналадки — фиолетовый, как
 * наладка; повторные уборки — светлее его; перевозки — оранжевый, переходы — бирюзовый, брак — тёмно-красный; «нет
 * смены» — серый, как выключенная машина. Каждая пара различима во всех четырёх видах зрения
 * (tools/test/palette.test.ts); цвет никогда не один — число есть у каждого столбика, вид — в подсказке.
 */
export const LOSS_COLOR: Record<LossKind, number> = {
  wait: LAMP_COLOR.wait,
  move: 0xf08c28,
  walk: 0x7fd8d0,
  setup: LAMP_COLOR.setup,
  again: 0xe0b0ff,
  defect: 0xb81c1c,
  shift: LAMP_COLOR.off,
};

/**
 * Цвет семьи причин ожидания — ступени синего ожидания: люди — он сам, приборы и техника — светлее, места — светлее
 * всех.
 */
export const FAMILY_COLOR: Record<WaitFamily, number> = { people: LAMP_COLOR.wait, gear: 0x6f94d6, place: 0xc4d8f4 };

export const lossColor = (p: LossPart): number => (p in FAMILY_COLOR ? FAMILY_COLOR[p as WaitFamily] : LOSS_COLOR[p as LossKind]);

/** Место столбика потерь: место учёта, вещь его карточки, середина основания, м. */
export interface LossSpot {
  spot: string;
  thing: Thing;
  x: number;
  z: number;
}

/** Зазор столбика до следа машины, стеллажа и проёма рампы, м; запас вокруг столбика до пола чужого помещения, стены,
 * оборудования и места паллеты, м. */
const GAP = 0.2;
const CLEAR = 0.1;
/** Шаг поиска места, м; дальше `REACH` от желаемой точки не ищем; паллета на месте — квадрат по большей стороне, м. */
const STEP = 0.25;
const REACH = 4;
const PALLET = 1.2;
/** Столбики мест — не ближе друг к другу, м, между серединами: числа над ними не налезают. */
const APART = 1.6;

const spotCache = new WeakMap<Layout, LossSpot[]>();

/**
 * Места столбиков потерь на плане (считаются раз на план): линия — у первой машины, с северной стороны её следа;
 * стеллаж — в проходе у середины ряда, в `GAP` от него; рампа — у ворот, внутри, за краем проёма; зона склада — у её
 * середины; помещение — у его середины, там же, где табличка «Узких мест» и значок андона (Б1к). Каждый столбик — на
 * полу своего помещения, не на оборудовании и не на месте паллеты, не ближе `APART` к прежним: от желаемой точки — к
 * ближайшей такой. Двор — без столбика: места на полу у него нет.
 */
export function lossSpotsOf(db: ContentDb, l: Layout): LossSpot[] {
  const hit = spotCache.get(l);
  if (hit) return hit;
  const side = FLOOR.room;
  const r = side / 2 + CLEAR;
  const nav = l.nav;
  const slots = l.plan.slots.filter(s => s.level === 0 && l.plan.plant.zones.some(z => z.id === s.group)).map(s => [s.x / 100, s.z / 100]);
  const placed: LossSpot[] = [];
  const floorOf = (x: number, z: number, room: number) => {
    for (let cz = Math.floor(z - r); cz <= Math.floor(z + r - 1e-9); cz++) {
      for (let cx = Math.floor(x - r); cx <= Math.floor(x + r - 1e-9); cx++) {
        if (cx < 0 || cz < 0 || cx >= nav.w || cz >= nav.h) return false;
        const k = cz * nav.w + cx;
        if ((nav.cells[k] !== CELL.floor && nav.cells[k] !== CELL.corridor) || nav.room[k] !== room || nav.blocked[k]) return false;
      }
    }
    return true;
  };
  const ok = (x: number, z: number, room: number) =>
    floorOf(x, z, room) && slots.every(([sx, sz]) => Math.abs(sx - x) >= PALLET / 2 + r || Math.abs(sz - z) >= PALLET / 2 + r) && placed.every(p => Math.hypot(p.x - x, p.z - z) >= APART);
  /** Ближайшая к (`tx`, `tz`) годная точка с шагом `STEP` в пределах `REACH`; такой нет — сама точка. */
  const put = (spot: string, thing: Thing, tx: number, tz: number, room: number) => {
    let best: { x: number; z: number } | undefined;
    let near = Number.POSITIVE_INFINITY;
    const n = Math.round(REACH / STEP);
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const x = tx + i * STEP;
        const z = tz + j * STEP;
        const d = Math.hypot(i, j);
        if (d < near - 1e-9 && ok(x, z, room)) {
          near = d;
          best = { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
        }
      }
    }
    placed.push({ spot, thing, ...(best ?? { x: tx, z: tz }) });
  };
  const roomOf = (x: number, z: number) => {
    const id = roomAt(l.plan.plant, Math.round(x * 100), Math.round(z * 100));
    const i = id ? l.rooms.findIndex(rm => rm.id === id) : -1;
    return i >= 0 ? i : undefined;
  };
  const inRoom = (spot: string, x: number, z: number) => {
    const i = roomOf(x, z);
    if (i !== undefined) put(spot, { kind: 'room', i }, x, z, i);
  };
  l.plan.plant.lines.forEach((ln, line) => {
    const m = ln.machines[0];
    const i = l.rooms.findIndex(rm => rm.id === ln.room);
    if (!m || i < 0) return;
    const size = db.machines[m.type].size;
    const d = m.turn % 2 === 0 ? size[1] : size[0];
    put(`line:${ln.id}`, { kind: 'machine', line, k: 0 }, m.at[0] / 100, (m.at[1] - d / 2) / 100 - GAP - side / 2, i);
  });
  for (const rk of l.plan.plant.racks) {
    const x = (rk.x + (rk.bays * RACK.bay) / 2) / 100;
    inRoom(`zone:${rk.id}`, x, rk.face === 'n' ? rk.z / 100 - GAP - side / 2 : (rk.z + RACK.depth) / 100 + GAP + side / 2);
  }
  for (const dk of l.plan.plant.docks) {
    // рампа — на наружной стене; проём — вдоль неё: столбик внутри, за дальним краем проёма
    const cx = Math.floor(dk.x / 100);
    const cz = Math.floor(dk.z / 100);
    const door = l.plan.plant.doors.find(dr => dr.kind === 'dock' && (dr.along === 'z' ? dr.cell[0] === cx && cz >= dr.cell[1] && cz < dr.cell[1] + dr.len : dr.cell[1] === cz && cx >= dr.cell[0] && cx < dr.cell[0] + dr.len));
    const along = door?.along ?? (cx === 0 || cx === l.w - 1 ? 'z' : 'x');
    const [ox, oz] = outward(l, cx, cz);
    const end = door ? (along === 'z' ? door.cell[1] : door.cell[0]) + door.len : (along === 'z' ? cz : cx) + 1;
    const inside = 0.5 + GAP + side / 2;
    const x = along === 'z' ? cx + 0.5 - ox * (0.5 + inside) : end + GAP + side / 2;
    const z = along === 'z' ? end + GAP + side / 2 : cz + 0.5 - oz * (0.5 + inside);
    inRoom(`dock:${dk.id}`, x, z);
  }
  for (const zn of l.plan.plant.zones) {
    const [x, z, w, d] = zn.rect;
    inRoom(`zone:${zn.id}`, (x + w / 2) / 100, (z + d / 2) / 100);
  }
  l.rooms.forEach((rm, i) => {
    const at = midSpot(l, i) ?? { x: rm.x + rm.w / 2, z: rm.z + rm.d / 2 };
    put(rm.id, { kind: 'room', i }, at.x, at.z, i);
  });
  spotCache.set(l, placed);
  return placed;
}

/** Часть столбика потерь на полу: от `y0` высотой `h`, м; секунды за окно. */
export interface LossBarPart {
  part: LossPart;
  y0: number;
  h: number;
  sec: number;
}

/**
 * Столбик слоя «Потери»: место, номер места по порядку мест (клетка числа), части снизу вверх и секунды вида за окно.
 */
export interface LossBar extends LossSpot {
  n: number;
  side: number;
  parts: LossBarPart[];
  sec: number;
}

/** Части места по виду слоя — секундами, по порядку снизу вверх; нулевые пропущены. */
export function partsOfLoss(x: FloorLoss, pick: LossPick): { part: LossPart; sec: number }[] {
  if (pick === 'all') return ALL_KINDS.map(k => ({ part: k as LossPart, sec: x.sec[k] ?? 0 })).filter(p => p.sec > 0);
  if (pick === 'wait') {
    const by: Record<WaitFamily, number> = { people: 0, gear: 0, place: 0 };
    for (const [c, sec] of Object.entries(x.wait)) if (c !== 'shift') by[FAMILY_OF[c as Exclude<WaitCause, 'shift'>]] += sec ?? 0;
    return WAIT_FAMILIES.map(f => ({ part: f as LossPart, sec: by[f] })).filter(p => p.sec > 0);
  }
  const sec = x.sec[pick] ?? 0;
  return sec > 0 ? [{ part: pick, sec }] : [];
}

/** Секунды места по виду слоя: у «всех» — без «нет смены». */
export const secOfLoss = (x: FloorLoss, pick: LossPick): number => (pick === 'all' ? x.total : (x.sec[pick] ?? 0));

/**
 * Столбики слоя: у каждого места с потерями вида за окно; высота — секунды места против самого большого места окна,
 * оно — во всю высоту `FLOOR.full`; части — по виду слоя. Места, которого нет на полу (двор), нет и среди столбиков.
 */
export function lossBars(spots: readonly LossSpot[], v: FloorView, pick: LossPick): LossBar[] {
  const at = new Map(spots.map((s, n) => [s.spot, n]));
  const list = v.losses.map(x => ({ x, n: at.get(x.spot), sec: secOfLoss(x, pick) })).filter(r => r.n !== undefined && r.sec > 0);
  const max = list.reduce((m, r) => Math.max(m, r.sec), 0);
  return list.map(({ x, n, sec }) => {
    let y = 0;
    const parts = partsOfLoss(x, pick).map(p => {
      const h = (FLOOR.full * p.sec) / max;
      const out = { part: p.part, y0: y, h, sec: p.sec };
      y += h;
      return out;
    });
    return { ...spots[n!], n: n!, side: FLOOR.room, parts, sec };
  });
}

/** Короб столбика потерь для щелчка и наведения: вещь его карточки и место — блок «Потери» карточки покажет его. */
export type LossBox = Box & { spot: string };

/** Над столбиком в коробе — место для часов над ним, м: по ним щёлкают так же, как по столбику. */
const LABEL_BOX = 0.5;

/** Короба столбиков: основание, верх столбика и часы над ним — по столбику легко попасть и с малой частью. */
export function lossBoxes(bars: readonly LossBar[]): LossBox[] {
  return bars.map(b => {
    const top = b.parts.reduce((y, p) => Math.max(y, p.y0 + p.h), 0);
    return { thing: b.thing, spot: b.spot, min: [b.x - b.side / 2, 0, b.z - b.side / 2], max: [b.x + b.side / 2, top + LABEL_BOX, b.z + b.side / 2] };
  });
}

/** Место учёта словами: помещение — по типу, зона — её словом на полу, стеллаж, линия, рампа, двор. */
export function spotName(l: Layout, spot: string): string {
  const i = spot.indexOf(':');
  if (i < 0) {
    if (spot === YARD) return T.losses.yard;
    const r = l.rooms.find(x => x.id === spot);
    return r ? (T.roomTypes[r.type] ?? r.type) : spot;
  }
  const k = spot.slice(0, i);
  const id = spot.slice(i + 1);
  if (k === 'zone') {
    const zn = l.plan.plant.zones.find(z => z.id === id);
    return zn ? T.losses.zone(T.zones[zn.kind]) : T.losses.rack(id);
  }
  if (k === 'line') return T.morning.line(l.plan.plant.lines.findIndex(x => x.id === id) + 1);
  if (k === 'dock') {
    const d = l.plan.plant.docks.find(x => x.id === id);
    return d ? T.losses.dock[d.kind] : id;
  }
  return spot;
}

/**
 * Места карточки вещи (Б1л): у помещения — оно само и места, чей столбик стоит в нём, — зоны, стеллажи, рампы, а
 * линия — у своего помещения; у машины линии — её линия. Порядок — как у мест на плане.
 */
export function spotsOfThing(l: Layout, spots: readonly LossSpot[], t: Thing): string[] {
  if (t.kind === 'machine') {
    const ln = l.plan.plant.lines[t.line];
    return ln ? [`line:${ln.id}`] : [];
  }
  if (t.kind !== 'room') return [];
  const room = l.rooms[t.i]?.id;
  if (!room) return [];
  const lines = l.plan.plant.lines.filter(ln => ln.room === room).map(ln => `line:${ln.id}`);
  return [...spots.filter(s => s.thing.kind === 'room' && s.thing.i === t.i).map(s => s.spot), ...lines];
}
