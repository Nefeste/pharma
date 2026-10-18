// Выбор щелчком (docs/specs/2026-10-panels.md, 3б): что под курсором. Устройство — как у «Больницы» (её
// src/render/stage.ts, `pickPerson` и `pickCell`): человек — по расстоянию до его точки на экране, пол — лучом в плоскость
// пола. Сверх того здесь — короба вещей сцены: паллета на своём ярусе, машина и оборудование по следу и высоте, кузов фуры;
// луч берёт ближайший. Чистые функции без Three.js и DOM: точки на экране и луч считает окно, проверяют тесты в Bun.
import type { ContentDb } from '../content/types';
import type { Layout } from '../render/layout';
import { TRAILER } from '../render/layout';
import { type PalletView, palletHeight } from '../render/loads';
import type { Thing } from '../sim/views';
import type { TruckPose } from './yard';

/** Ближе стольких точек экрана к человеку или технике — выбран он (как в «Больнице»). */
export const NEAR_PX = 30;

export type V3 = [number, number, number];

export interface Ray {
  o: V3;
  d: V3;
}

/** Короб вещи: углы, м. */
export interface Box {
  thing: Thing;
  min: V3;
  max: V3;
}

/** Вещь с её расстоянием до курсора на экране, точки. */
export interface Spot {
  thing: Thing;
  px: number;
}

/** Где луч входит в короб: расстояние по лучу (метод плит); мимо или позади — `undefined`. */
export function rayBox(r: Ray, b: Box): number | undefined {
  let lo = 0;
  let hi = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const o = r.o[i];
    const d = r.d[i];
    if (Math.abs(d) < 1e-12) {
      if (o < b.min[i] || o > b.max[i]) return undefined;
      continue;
    }
    let t0 = (b.min[i] - o) / d;
    let t1 = (b.max[i] - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    lo = Math.max(lo, t0);
    hi = Math.min(hi, t1);
    if (lo > hi) return undefined;
  }
  return lo;
}

/** Точка пола (y = 0) под лучом; луч вверх или вдоль пола — `undefined`. */
export function floorHit(r: Ray): { x: number; z: number } | undefined {
  if (r.d[1] >= -1e-9) return undefined;
  const t = -r.o[1] / r.d[1];
  return { x: r.o[0] + r.d[0] * t, z: r.o[2] + r.d[2] * t };
}

/** Короба паллет сцены: основание на её ярусе, длинная сторона — по повороту, высота — как нарисован груз. */
export function palletBoxes(list: readonly PalletView[]): Box[] {
  const out: Box[] = [];
  for (const p of list) {
    if (p.unit === undefined) continue;
    const [hx, hz] = p.turn === 0 ? [0.6, 0.4] : [0.4, 0.6];
    out.push({ thing: { kind: 'unit', n: p.unit }, min: [p.x - hx, p.y, p.z - hz], max: [p.x + hx, p.y + palletHeight(p.load, p.fill), p.z + hz] });
  }
  return out;
}

/** Короба оборудования участков и машин линий: след на полу и высота из записи вида (см → м). */
export function machineBoxes(db: ContentDb, l: Layout): Box[] {
  const out: Box[] = [];
  const box = (at: [number, number], turn: number, size: [number, number, number]) => {
    const [w, d] = turn % 2 === 0 ? [size[0], size[1]] : [size[1], size[0]];
    return { min: [(at[0] - w / 2) / 100, 0, (at[1] - d / 2) / 100] as V3, max: [(at[0] + w / 2) / 100, size[2] / 100, (at[1] + d / 2) / 100] as V3 };
  };
  l.plan.plant.equipment.forEach((e, i) => out.push({ thing: { kind: 'equipment', i }, ...box(e.at, e.turn, db.equipment[e.type].size) }));
  l.plan.plant.lines.forEach((ln, line) =>
    ln.machines.forEach((m, k) => out.push({ thing: { kind: 'machine', line, k }, ...box(m.at, m.turn, db.machines[m.type].size) })),
  );
  return out;
}

/** Длина фуры с тягачом, м (trucks.ts: кабина и колёса тягача — за кузовом). */
const TRUCK_LEN = TRAILER.length + 3.9;

/** Короба фур кадра: от заднего края кузова наружу (−x), от асфальта двора до крыши. */
export function truckBoxes(poses: readonly TruckPose[]): Box[] {
  return poses.map(p => ({
    thing: { kind: 'truck', n: p.truck, customer: p.customer },
    min: [p.x - TRUCK_LEN, -1.2, p.z - TRAILER.width / 2] as V3,
    max: [p.x, TRAILER.height, p.z + TRAILER.width / 2] as V3,
  }));
}

/** Помещение под точкой пола: номер по порядку плана; вне помещений — `undefined`. */
export function roomAt(l: Layout, x: number, z: number): number | undefined {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (cx < 0 || cz < 0 || cx >= l.nav.w || cz >= l.nav.h) return undefined;
  const r = l.nav.room[cz * l.nav.w + cx];
  return r >= 0 ? r : undefined;
}

/**
 * Что под курсором: человек или техника ближе `NEAR_PX` точек — ближайший; иначе — первая вещь по лучу; иначе —
 * помещение под точкой пола; иначе — ничего.
 */
export function pick(spots: readonly Spot[], r: Ray, boxes: readonly Box[], l: Layout): Thing | undefined {
  let near: Spot | undefined;
  for (const s of spots) if (s.px <= NEAR_PX && (!near || s.px < near.px)) near = s;
  if (near) return near.thing;
  let best: Box | undefined;
  let bestT = Number.POSITIVE_INFINITY;
  for (const b of boxes) {
    const t = rayBox(r, b);
    if (t !== undefined && t < bestT) {
      bestT = t;
      best = b;
    }
  }
  if (best) return best.thing;
  const f = floorHit(r);
  const room = f ? roomAt(l, f.x, f.z) : undefined;
  return room !== undefined ? { kind: 'room', i: room } : undefined;
}

/** Одна и та же вещь? */
export function same(a: Thing | undefined, b: Thing | undefined): boolean {
  return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
}
