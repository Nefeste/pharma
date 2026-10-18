// из bolnitsa: src/app/stats.ts @ e0a3491 — изменено: только сводка по выборке (окно замеров ведёт сам бенч).
/** Сводка по выборке времён, мс. */
export interface Summary {
  mean: number;
  p95: number;
  max: number;
}

export function summarize(xs: number[]): Summary {
  if (!xs.length) return { mean: 0, p95: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  const r = (v: number) => Math.round(v * 100) / 100;
  return { mean: r(mean), p95: r(p95), max: r(s[s.length - 1]) };
}
