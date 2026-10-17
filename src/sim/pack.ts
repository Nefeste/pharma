// Упакованный срез для отрисовки (docs/02-architecture.md, §10): `Int32Array` уходит из потока расчёта без копии
// (transferList). Сейчас в срезе только заголовок; движущиеся (люди и техника), машины и изменённые грузовые единицы
// придут с частями 1–2.
import type { PlantState } from '../engine/types';

/** Поля заголовка среза. */
export const H = {
  /** игровые секунды от полуночи даты начала */
  t: 0,
  /** сутки партии */
  day: 1,
  /** на сколько игровых секунд движок отстаёт от часов игры */
  lag: 2,
  size: 8,
} as const;

export function packSlice(s: PlantState, lag: number): Int32Array {
  const buf = new Int32Array(H.size);
  buf[H.t] = s.t;
  buf[H.day] = s.day;
  buf[H.lag] = Math.min(lag, 0x7fffffff);
  return buf;
}
