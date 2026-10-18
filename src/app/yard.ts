// Фуры во дворе (docs/specs/2026-10-panels.md, 3а; развилка #34, вариант 3 — только картинка). Движок о дворе не знает: фура
// у рампы с того мгновения, как встала к ней. Окно ведёт её задним ходом с запада — к рампе или на место ожидания рядом; с
// места ожидания к рампе — тоже задним ходом; ушедшую — вперёд на запад, за край двора. Кузов закрыт, пока фура поставщика
// не прошла проверку, и когда фура уходит. Числа — геймдизайн, §19.2. Без Three.js и DOM: проверяют тесты в Bun.
import type { TruckRow } from '../sim/pack';

/** Двор: скорость задним ходом и вперёд, м/с; откуда фура въезжает и куда уходит — на столько метров западнее места. */
export const YARD = { reverse: 1, forward: 2, far: 30 } as const;

interface P {
  x: number;
  z: number;
}

export interface TruckPose {
  truck: number;
  customer: boolean;
  dock: number;
  /** стоит у рампы по учёту (ворота подняты); уходящая — нет */
  docked: boolean;
  /** задний край кузова, м: у рампы — у ворот; кузов уходит от него в сторону −x */
  x: number;
  z: number;
  /** кузов закрыт: крыша и двери */
  closed: boolean;
  moving: boolean;
}

/** Отрезок пути по двору: откуда, куда, с какого и до какого мгновения (игровые секунды). */
interface Leg {
  from: P;
  to: P;
  t0: number;
  t1: number;
}

/**
 * Место фуры, м: у рампы — задним краем к воротам (`front` — середина ворот); ждущая `k`-я по очереди — во дворе рядом,
 * дальше от стены и со сдвигом на ширину фуры.
 */
export function spotOf(front: P, docked: boolean, k: number): P {
  return docked ? { x: front.x - 0.3, z: front.z } : { x: front.x - 6, z: front.z + 3.4 * (k + 1) };
}

function legOf(from: P, to: P, t0: number, speed: number): Leg {
  return { from, to, t0, t1: t0 + Math.hypot(to.x - from.x, to.z - from.z) / speed };
}

/** Где на отрезке в мгновение `t`: плавно трогается и плавно встаёт. */
export function poseAt(leg: Leg, t: number): P & { moving: boolean } {
  const k = leg.t1 > leg.t0 ? Math.min(1, Math.max(0, (t - leg.t0) / (leg.t1 - leg.t0))) : 1;
  if (k === 1) return { x: leg.to.x, z: leg.to.z, moving: false };
  const e = k * k * (3 - 2 * k);
  return { x: leg.from.x + (leg.to.x - leg.from.x) * e, z: leg.from.z + (leg.to.z - leg.from.z) * e, moving: k > 0 && k < 1 };
}

/** Фуры двора по срезам: какие стоят, едут к месту и уходят. */
export class Yard {
  private seen = new Map<string, { row: TruckRow; leg: Leg }>();
  private gone: { row: TruckRow; leg: Leg }[] = [];
  /** первый срез: фуры уже на местах, не въезжают */
  private fresh = true;

  /** Срез: новая фура въезжает к своему месту, переставленная — едет к новому, пропавшая из учёта — уходит. */
  update(rows: readonly TruckRow[], front: (dock: number) => P, t: number) {
    const waiting = new Map<number, number>();
    const now = new Set<string>();
    for (const r of rows) {
      const key = `${r.customer ? 'R' : 'K'}${r.truck}`;
      now.add(key);
      const k = r.docked ? 0 : (waiting.get(r.dock) ?? 0);
      if (!r.docked) waiting.set(r.dock, k + 1);
      const spot = spotOf(front(r.dock), r.docked, k);
      const old = this.seen.get(key);
      if (!old) {
        const from = this.fresh ? spot : { x: spot.x - YARD.far, z: spot.z };
        this.seen.set(key, { row: r, leg: legOf(from, spot, t, YARD.reverse) });
        continue;
      }
      old.row = r;
      if (old.leg.to.x !== spot.x || old.leg.to.z !== spot.z) old.leg = legOf(poseAt(old.leg, t), spot, t, YARD.reverse);
    }
    for (const [key, sn] of this.seen) {
      if (now.has(key)) continue;
      const at = poseAt(sn.leg, t);
      this.gone.push({ row: sn.row, leg: legOf({ x: at.x, z: at.z }, { x: at.x - YARD.far, z: at.z }, t, YARD.forward) });
      this.seen.delete(key);
    }
    this.fresh = false;
  }

  /** Фуры в мгновение `t`: уходящие — пока не скроются за краем двора. */
  at(t: number): TruckPose[] {
    this.gone = this.gone.filter(g => t < g.leg.t1);
    const out: TruckPose[] = [];
    for (const { row, leg } of this.seen.values()) {
      const p = poseAt(leg, t);
      out.push({ truck: row.truck, customer: row.customer, dock: row.dock, docked: row.docked, x: p.x, z: p.z, closed: !row.open, moving: p.moving });
    }
    for (const { row, leg } of this.gone) {
      const p = poseAt(leg, t);
      out.push({ truck: row.truck, customer: row.customer, dock: row.dock, docked: false, x: p.x, z: p.z, closed: true, moving: p.moving });
    }
    return out;
  }
}
