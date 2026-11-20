// из bolnitsa: src/app/settings.ts @ 15a7ad6 — изменено: от «Больницы» — только устройство (`--ui-k` у корня, панели —
// `zoom` у `#ui`, подписи на карте — размер шрифта × `--ui-k`); ступени — 75–200 % шагом 25, первый запуск — по высоте
// окна (docs/specs/2026-10-vertical-slice.md, «Б13. Доступность и настройки»; геймдизайн, §23).
// Масштаб интерфейса: настройка игрока, хранится в окне, а не в сохранении. Чистые функции без DOM проверяют тесты в Bun;
// хранилище окна приходит снаружи.
import type { Keep } from './preset';

/** Ключ в хранилище окна. */
export const SCALE = { key: 'pharma.uiScale' } as const;

/** Ступени масштаба: 75–200 % шагом 25. */
export const SCALES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/**
 * Наименьшее поле панелей в точках `#ui`: под масштабом `k` экран W × H — это W/k × H/k. Панели свёрстаны не меньше чем на
 * 1280 × 720 (прежнее наименьшее окно, Б12) — ступень, которая оставляет меньше, на этом экране не предлагается.
 */
export const MIN_VIEW = { w: 1280, h: 720 } as const;

/** Ступени, что помещают панели на экран W × H; хоть одна — 75 % — есть всегда. */
export function fitScales(w: number, h: number): number[] {
  const fit = SCALES.filter(k => w / k >= MIN_VIEW.w - 0.5 && h / k >= MIN_VIEW.h - 0.5);
  return fit.length > 0 ? fit : [SCALES[0]];
}

/** Ступень, что помещается: сама или наибольшая из помещающихся меньше неё. */
export function fitScale(k: number, w: number, h: number): number {
  const fit = fitScales(w, h);
  return fit.includes(k) ? k : (fit.filter(x => x < k).at(-1) ?? fit[0]);
}

/** Первый запуск — по высоте окна в точках CSS: Full HD — 100 %, 1440 — 125 %, выше — 150 %. */
export function firstScale(height: number): number {
  return height <= 1300 ? 1 : height <= 1800 ? 1.25 : 1.5;
}

/** Ступень из строки хранилища; не ступень, нет или не читается — по высоте окна; не помещается — меньше. */
export function keptScale(keep: Keep | undefined, width: number, height: number): number {
  let want = firstScale(height);
  try {
    const v = Number(keep?.getItem(SCALE.key) ?? NaN);
    if ((SCALES as readonly number[]).includes(v)) want = v;
  } catch {
    // хранилище окна недоступно
  }
  return fitScale(want, width, height);
}

/** Запомнить выбор игрока; не вышло — масштаб действует до закрытия окна. */
export function keepScale(store: Keep | undefined, k: number) {
  try {
    store?.setItem(SCALE.key, String(k));
  } catch {
    // хранилище окна недоступно
  }
}

/** Масштаб — на страницу: `--ui-k` у корня; панели — `zoom` у `#ui` (app/index.html). */
export function applyScale(k: number) {
  if (typeof document !== 'undefined') document.documentElement.style.setProperty('--ui-k', String(k));
}

/**
 * Масштаб сейчас — для того, что ставит окно по точкам экрана внутри `#ui`: подсказки у мыши, сдвиг окна, высота полосы.
 * Точки экрана делят на него: под `zoom` точка CSS — `k` точек экрана.
 */
export function uiK(): number {
  if (typeof document === 'undefined') return 1;
  const v = Number(document.documentElement.style.getPropertyValue('--ui-k'));
  return v > 0 ? v : 1;
}
