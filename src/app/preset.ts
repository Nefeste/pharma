// Стартовый пресет (этап Б, Б1б; docs/specs/2026-10-vertical-slice.md): при первом запуске игра меряет кадр на среднем
// пресете и, если он дольше `PRESET.slow`, переходит на низкий — на встроенной видеокарте средний давал 12–13 кадров в
// секунду (docs/specs/2026-10-view.md). Итог замера и выбор игрока запоминаются в окне; дальше пресет сам не меняется.
// Чистые функции без DOM — их проверяют тесты в Bun; хранилище окна приходит снаружи и может не работать.
import type { Quality } from '../render/view';

/** Ключ в хранилище окна; сколько ждать после первого кадра и сколько мерить, мс; какой кадр медленный, мс. */
export const PRESET = { key: 'pharma.quality', warm: 2000, measure: 3000, slow: 33 } as const;

/** Хранилище окна: в закрытом окне, без места или при запрете — бросает; тогда пресет просто не запомнится. */
export type Keep = Pick<Storage, 'getItem' | 'setItem'>;

const QS: readonly string[] = ['low', 'medium', 'high'];

/** Хранилище окна; нет его или доступ запрещён — `undefined`. */
export function windowKeep(): Keep | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Запомненный пресет; нет или не прочитать — `undefined`. */
export function kept(keep: Keep | undefined): Quality | undefined {
  try {
    const v = keep?.getItem(PRESET.key);
    return v && QS.includes(v) ? (v as Quality) : undefined;
  } catch {
    return undefined;
  }
}

/** Запомнить пресет; не вышло — игра идёт дальше на нём же. */
export function keep(store: Keep | undefined, q: Quality) {
  try {
    store?.setItem(PRESET.key, q);
  } catch {
    // хранилище окна недоступно: при следующем запуске замер повторится
  }
}

/** Медиана интервалов между кадрами, мс; кадров нет — `undefined`. */
export function medianFrame(intervals: readonly number[]): number | undefined {
  if (intervals.length === 0) return undefined;
  const a = [...intervals].sort((x, y) => x - y);
  const k = a.length >> 1;
  return a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2;
}

/**
 * Итог замера на среднем пресете: медленный кадр — низкий, иначе средний; кадров нет — `undefined`. Меньше 10 кадров за
 * замер — это кадр дольше 300 мс: тоже низкий (иначе совсем слабая видеокарта осталась бы на среднем навсегда).
 */
export function pickPreset(intervals: readonly number[]): Quality | undefined {
  const m = medianFrame(intervals);
  if (m === undefined) return undefined;
  return intervals.length < 10 || m > PRESET.slow ? 'low' : 'medium';
}
