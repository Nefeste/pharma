// из bolnitsa: src/app/stats.ts @ e0a3491 — изменено: только сводка по выборке (окно замеров ведёт сам бенч); выборка с
// отметки по счёту замеров — `since` (перенести в «Больницу»); с правилом 1 ADR 0023 устава — медиана в сводке.
/** Долгий кадр по правилу 1 ADR 0023 устава, мс: таких — не больше 1 % (цель — геймдизайн, §21). */
export const LONG_FRAME_MS = 25;

/** Сводка по выборке времён, мс. */
export interface Summary {
  mean: number;
  median: number;
  p95: number;
  max: number;
}

/**
 * Замеры, пришедшие после отметки: `list` — последние замеры (старые обрезаются), `total` — сколько их пришло всего,
 * `mark` — `total` в начале прогона. Отметка длиной массива ломается, когда массив обрезан; счёт — нет. Обрезанное
 * раньше начала прогона не нужно, а пришедших за прогон больше, чем держит память, — не будет: остаются последние.
 */
export function since(list: readonly number[], total: number, mark: number): number[] {
  const n = Math.min(total - mark, list.length);
  return n > 0 ? list.slice(list.length - n) : [];
}

export function summarize(xs: number[]): Summary {
  if (!xs.length) return { mean: 0, median: 0, p95: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const k = s.length >> 1;
  const median = s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  const p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  const r = (v: number) => Math.round(v * 100) / 100;
  return { mean: r(mean), median: r(median), p95: r(p95), max: r(s[s.length - 1]) };
}

/** Доля кадров дольше `LONG_FRAME_MS`, % с одним знаком; кадров нет — 0. */
export function longShare(intervals: readonly number[]): number {
  if (!intervals.length) return 0;
  return Math.round((intervals.filter(v => v > LONG_FRAME_MS).length / intervals.length) * 1000) / 10;
}
