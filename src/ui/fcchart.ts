// «Прогноз против факта» вкладки «Прогноз» (Б6в): чистые правила графика — цвета рядов, шкала ящиков с круглыми делениями,
// места столбиков и точек линий, доля ошибки со знаком. Цвета различимы во всех четырёх видах зрения
// (tools/test/palette.test.ts), а ряд называет ещё и знак: столбик — факт, кружок — планирование, квадрат — отдел продаж.
import type { FcPoint } from '../sim/forecast';

/**
 * Цвета рядов: факт — тёплый серый столбик, планирование — акцент окна, отдел продаж — янтарный; каждый — контрастом не
 * ниже 3:1 к фону графика (`FC_BG`).
 */
export const FC_COLOR = { fact: 0x857e74, plan: 0x2fb5c9, sales: 0xe8a33d } as const;

/** Фон графика: панель окна под затемнением `svg.chart` (app/index.html). */
export const FC_BG = 0x161f23;

/** Цвет числом — строкой CSS. */
export const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Размеры графика в единицах viewBox. */
export const FC_W = 720;
export const FC_H = 220;
export const FC_PAD = { l: 52, r: 12, t: 22, b: 22 };

/** Круглые деления шкалы от нуля: шаг 1, 2 или 5 × 10ⁿ, не больше пяти делений до верха. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(k => k * p).find(x => x >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

export interface FcGeom {
  /** месяцев на оси: прошлые, потом вперёд */
  n: number;
  /** где кончается прошлое: индекс первого месяца вперёд */
  split: number;
  ticks: number[];
  x: (i: number) => number;
  y: (v: number) => number;
  /** ширина слота месяца */
  slot: number;
  points: FcPoint[];
}

/** Шкала графика: месяцы прошлого и вперёд подряд, одна ось ящиков от нуля до верхнего деления. */
export function fcGeom(past: readonly FcPoint[], ahead: readonly FcPoint[]): FcGeom {
  const points = [...past, ...ahead];
  const n = Math.max(1, points.length);
  const top = Math.max(1, ...points.flatMap(p => [p.fact ?? 0, p.plan ?? 0, p.sales ?? 0]));
  const ticks = niceTicks(top);
  const hi = ticks[ticks.length - 1] || 1;
  const slot = (FC_W - FC_PAD.l - FC_PAD.r) / n;
  return {
    n,
    split: past.length,
    ticks,
    slot,
    x: i => FC_PAD.l + slot * (i + 0.5),
    y: v => FC_PAD.t + ((hi - v) * (FC_H - FC_PAD.t - FC_PAD.b)) / hi,
    points,
  };
}

/** Ломаная ряда по месяцам с числом; разрыв — где числа нет: отрезки подряд. */
export function runs(g: FcGeom, key: 'plan' | 'sales', from: number, to: number): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (let i = from; i < to; i++) {
    const v = g.points[i]?.[key];
    if (v === undefined) {
      if (cur.length > 1) out.push(cur.join(' '));
      cur = [];
      continue;
    }
    cur.push(`${g.x(i).toFixed(1)},${g.y(v).toFixed(1)}`);
  }
  if (cur.length > 1) out.push(cur.join(' '));
  return out;
}

/** Прогноз к факту, 1/10 000 со знаком: плюс — прогноз выше факта (как на планёрке: «отдел продаж … (+13 %)»). */
export const overFact = (fc: number, fact: number) => (fact > 0 ? Math.round(((fc - fact) * 10000) / fact) : 0);
