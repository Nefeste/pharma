// Именованные ветви зерна в состоянии (docs/02-architecture.md, §4). Ветвь заводится не только на подсистему, но и на
// вещь: `maint/press-a/punches`, `market/customer-3/sku-12`. Новый бросок в одной ветви не сдвигает другие, поэтому
// изменение плана не перемешивает чужую случайность. На этом держится честное сравнение вариантов в прогоне плана (§11).
//
// Ветвь рождается из зерна партии и имени (`Rng.fork` ядра) и дальше живёт своим состоянием в `s.rng`.
import { log2 } from './core/math';
import { Rng } from './core/rng';
import type { PlantState } from './types';

/** Бросок из ветви `name`: функция получает генератор ветви, состояние ветви сохраняется после. */
export function roll<T>(s: PlantState, name: string, f: (r: Rng) => T): T {
  const saved = s.rng[name];
  const r = saved ? Rng.fromState(saved) : Rng.seeded(s.seed).fork(name);
  const out = f(r);
  s.rng[name] = r.state();
  return out;
}

/**
 * Нормальная величина в долях 1/10 000 (СКО ≈ 10 000): сумма 12 равномерных целых [0, 10 000) минус их среднее 59 994 —
 * только целые, без `Math` (docs/specs/2026-10-engine.md, 1б). Хвосты обрезаны на ±6 СКО.
 */
export function normal(r: Rng): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += r.int(10000);
  return sum - 59994;
}

const LN2 = 0.6931471805599453;

/**
 * Показательная величина со средним `mean` — время или счёт до случайного события (микроостановки линии): −mean × ln u,
 * u ∈ (0, 1). Логарифм — свой, из ядра (только + − × ÷), поэтому одинаково в Bun и V8. Целое, не меньше 1.
 */
export function expo(r: Rng, mean: number): number {
  const u = (r.u32() + 0.5) / 4294967296;
  return Math.max(1, Math.round(-mean * log2(u) * LN2));
}

/** `sd` × нормальная величина `z` (доли 1/10 000) — до целого, половина вверх. */
export function spread(sd: number, z: number): number {
  return Math.floor((sd * z + 5000) / 10000);
}
