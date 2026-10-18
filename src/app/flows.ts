// Стрелки и загрузка мест склада (docs/specs/2026-10-view.md, 2г; числа — геймдизайн, §19.3): что показывает окно с высоты
// участка и на ×4. Перевозку окно видит по паллетам среза: паллета, сменившая зону, — перевозка из прежней зоны в новую;
// так видно и ту, что началась и кончилась между двумя срезами. Частота перевозок между зонами — за игровой час,
// сглажена по игровому времени. Чистые функции без Three.js и DOM: их проверяют тесты в Bun.
import type { ContentDb } from '../content/types';
import { RACK } from '../engine/nav';
import type { PlantPlan } from '../engine/plant';
import type { Layout } from '../render/layout';
import type { LineRow, TruckRow, Unpacked, UnitRow } from '../sim/pack';
import { dockFront } from './scene';

/**
 * Стрелки (геймдизайн, §19.3): постоянная сглаживания, игровых секунд; с какой частоты стрелка видна, перевозок в час;
 * толщина — основа и прибавка на перевозку в час, предел, м; у линии — основа и прибавка на пачку в минуту.
 */
export const FLOW = { tau: 4 * 3600, min: 0.1, base: 0.3, per: 0.25, max: 2, lineBase: 0.3, linePer: 0.01 } as const;

/** Где паллета для стрелок: зона склада по имени, все стеллажи — одно хранение, помещение по номеру, фура — у своей рампы. */
export function areaOf(plan: PlantPlan, u: UnitRow, trucks: readonly TruckRow[]): string | undefined {
  if (u.where === 'slot') {
    const sl = plan.slots[u.ref];
    return sl.kind === 'storage' ? 'racks' : `zone:${sl.group}`;
  }
  if (u.where === 'room') return `room:${u.ref}`;
  const t = trucks.find(k => k.truck === u.ref);
  return t ? `dock:${t.dock}` : undefined;
}

export interface Move {
  from: string;
  to: string;
}

/**
 * Перевозки между двумя срезами: паллеты, у которых зона в новом срезе не та, что в окне. Новые паллеты (с фуры, с линии)
 * и перестановки внутри зоны — не перевозки. `prev` — паллеты окна до среза, `prevTrucks` — фуры до среза.
 */
export function movesOf(plan: PlantPlan, prev: ReadonlyMap<number, UnitRow>, prevTrucks: readonly TruckRow[], sl: Unpacked): Move[] {
  const out: Move[] = [];
  for (const u of sl.units) {
    const old = prev.get(u.unit);
    if (!old) continue;
    const from = areaOf(plan, old, prevTrucks);
    const to = areaOf(plan, u, sl.trucks);
    if (from && to && from !== to) out.push({ from, to });
  }
  return out;
}

/** Толщина стрелки перевозок по частоте, м. */
export const moveWidth = (rate: number) => Math.min(FLOW.max, FLOW.base + FLOW.per * rate);

/** Частоты перевозок между зонами, перевозок за игровой час: каждая перевозка прибавляет 1/τ, всё затухает с τ. */
export class Flows {
  readonly rates = new Map<string, number>();
  private t: number | undefined;

  /** Срез в момент `t` (игровые секунды) принёс перевозки `moves`. */
  step(t: number, moves: readonly Move[]) {
    if (this.t !== undefined && t > this.t) {
      const k = Math.exp(-(t - this.t) / FLOW.tau);
      for (const [key, r] of this.rates) {
        const v = r * k;
        if (v < FLOW.min / 100) this.rates.delete(key);
        else this.rates.set(key, v);
      }
    }
    this.t = t;
    for (const m of moves) {
      const key = `${m.from}>${m.to}`;
      this.rates.set(key, (this.rates.get(key) ?? 0) + 3600 / FLOW.tau);
    }
  }

  reset() {
    this.rates.clear();
    this.t = undefined;
  }
}

export interface Arrow {
  /** откуда и куда, м */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** толщина, м */
  width: number;
}

/** Середина зоны для стрелок, м. */
export function centerOf(l: Layout, area: string): { x: number; z: number } | undefined {
  const plant = l.plan.plant;
  const [kind, ref] = area.split(':');
  if (kind === 'zone') {
    const zn = plant.zones.find(z => z.id === ref);
    return zn && { x: (zn.rect[0] + zn.rect[2] / 2) / 100, z: (zn.rect[1] + zn.rect[3] / 2) / 100 };
  }
  if (kind === 'racks') {
    const xs = plant.racks.flatMap(r => [r.x, r.x + r.bays * RACK.bay]);
    const zs = plant.racks.flatMap(r => [r.z, r.z + RACK.depth]);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 200, z: (Math.min(...zs) + Math.max(...zs)) / 200 };
  }
  if (kind === 'room') {
    const r = l.rooms[Number(ref)];
    return r && { x: r.x + r.w / 2, z: r.z + r.d / 2 };
  }
  if (kind === 'dock') return dockFront(l, Number(ref));
  return undefined;
}

/** Стрелки перевозок: между зонами, чья частота не ниже `FLOW.min`, толщиной по частоте. */
export function moveArrows(l: Layout, flows: Flows): Arrow[] {
  const out: Arrow[] = [];
  for (const [key, rate] of flows.rates) {
    if (rate < FLOW.min) continue;
    const [from, to] = key.split('>');
    const a = centerOf(l, from);
    const b = centerOf(l, to);
    if (!a || !b) continue;
    out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, width: moveWidth(rate) });
  }
  return out;
}

/** Стрелка линии: от входа первой машины к выходу последней, толщиной по пачкам в минуту последней; стоит — нет стрелки. */
export function lineArrows(db: ContentDb, l: Layout, lines: readonly LineRow[]): Arrow[] {
  const out: Arrow[] = [];
  for (const row of lines) {
    const ln = l.plan.plant.lines[row.line];
    const rate = row.machines.at(-1)?.rate ?? 0;
    if (!ln || row.batch < 0 || rate <= 0) continue;
    const end = (k: number, side: 1 | -1) => {
      const mc = ln.machines[k];
      const half = (db.machines[mc.type].size[0] / 200) * side;
      const turn = (mc.turn * Math.PI) / 2;
      return { x: mc.at[0] / 100 + half * Math.cos(turn), z: mc.at[1] / 100 - half * Math.sin(turn) };
    };
    const a = end(0, 1);
    const b = end(ln.machines.length - 1, -1);
    out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, width: FLOW.lineBase + FLOW.linePer * rate });
  }
  return out;
}

/** Загрузка мест: зона или ряд стеллажей — где на полу, сколько мест, сколько занято. */
export interface Fill {
  id: string;
  kind: 'zone' | 'rack';
  /** x, z, ширина, глубина, м */
  rect: [number, number, number, number];
  places: number;
  used: number;
}

/** Доли занятых мест зон и рядов стеллажей — по паллетам на местах, как в учёте. */
export function fillsOf(plan: PlantPlan, units: Iterable<UnitRow>): Fill[] {
  const used = new Map<string, number>();
  for (const u of units) {
    if (u.where !== 'slot') continue;
    const g = plan.slots[u.ref].group;
    used.set(g, (used.get(g) ?? 0) + 1);
  }
  const zones: Fill[] = plan.plant.zones.map(z => ({ id: z.id, kind: 'zone', rect: [z.rect[0] / 100, z.rect[1] / 100, z.rect[2] / 100, z.rect[3] / 100], places: z.grid[0] * z.grid[1], used: used.get(z.id) ?? 0 }));
  const racks: Fill[] = plan.plant.racks.map(r => ({
    id: r.id,
    kind: 'rack',
    rect: [r.x / 100, r.z / 100, (r.bays * RACK.bay) / 100, RACK.depth / 100],
    places: r.bays * r.levels * RACK.slots,
    used: used.get(r.id) ?? 0,
  }));
  return [...zones, ...racks];
}
