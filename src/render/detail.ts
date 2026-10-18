// Крупность показа (docs/specs/2026-10-view.md, 2г; docs/13-art.md, §10; числа — геймдизайн, §19.3): чем быстрее время и
// дальше камера, тем крупнее мазок. Уровень — наибольший из двух: по скорости и по высоте камеры; переход между уровнями
// — за 0,4 с, без щелчка. Чистые функции без Three.js и DOM — их проверяют тесты в Bun.

/** 1 — по одному: люди, техника, блистеры, ящики; 2 — поток: ленты полосой; 3 — стрелки: люди и техника скрыты. */
export type Detail = 1 | 2 | 3;

/**
 * Пороги (геймдизайн, §19.3): половина высоты кадра, м, с которой начинается средний масштаб и весь участок; на сколько
 * ниже порога камера опускает уровень обратно; за сколько секунд показ доходит до нового уровня.
 */
export const DETAIL = { near: 12, site: 20, hold: 1, fade: 0.4 } as const;

/** Уровень по скорости: пауза, ×1, ×2 и «живое время» (5) — по одному; ×3 — поток; ×4 и «До утра» — стрелки. */
export function speedDetail(speed: number, ff: boolean): Detail {
  if (ff || speed === 4) return 3;
  return speed === 3 ? 2 : 1;
}

/** Уровень по высоте камеры; вниз — только на `DETAIL.hold` ниже порога, чтобы на границе показ не дёргался. */
export function camDetail(half: number, prev: Detail): Detail {
  const up: Detail = half >= DETAIL.site ? 3 : half >= DETAIL.near ? 2 : 1;
  if (up >= prev) return up;
  const down: Detail = half >= DETAIL.site - DETAIL.hold ? 3 : half >= DETAIL.near - DETAIL.hold ? 2 : 1;
  return Math.max(up, Math.min(prev, down)) as Detail;
}

/** Веса уровней 1–3 на экране: сумма — 1; на установившемся уровне — один вес. */
export type Weights = readonly [number, number, number];

export const AT: Record<Detail, Weights> = { 1: [1, 0, 0], 2: [0, 1, 0], 3: [0, 0, 1] };

/** Шаг перехода за `dt` секунд к уровню `target`: вес нового уровня растёт, прочие убывают — до конца за `DETAIL.fade`. */
export function ease(w: Weights, target: Detail, dt: number): Weights {
  const k = Math.min(1, Math.max(0, dt) / DETAIL.fade);
  const out = w.map((v, i) => (i === target - 1 ? Math.min(1, v + k) : Math.max(0, v - k)));
  const sum = out[0] + out[1] + out[2];
  return [out[0] / sum, out[1] / sum, out[2] / sum];
}

/**
 * Что из этого следует на экране: люди и техника (1 — в полный рост, 0 — скрыты), штуки на лентах, полосы на лентах машин и
 * накопителях, слой стрелок и загрузки.
 */
export function shownOf(w: Weights) {
  return { movers: 1 - w[2], items: w[0], bands: w[1], buffers: w[1] + w[2], layer: w[2] };
}
