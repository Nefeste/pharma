// Язык окна (Б12, шаг 1; docs/specs/2026-10-vertical-slice.md, «Б12»): выбор игрока — кнопка «RU / EN» в верхней полосе —
// живёт в окне, как стартовый пресет (preset.ts); не выбран — как у системы окна. Чистые функции без DOM — их проверяют
// тесты в Bun; хранилище окна приходит снаружи.
import type { Lang } from '../i18n';
import type { Keep } from './preset';

/** Ключ в хранилище окна. */
export const LANG_KEY = 'pharma.lang';

/** Язык: из адреса — он; иначе выбор игрока; иначе — системы окна. */
export function langOf(url: string | null, keep: Keep | undefined, system: Lang): Lang {
  if (url === 'ru' || url === 'en') return url;
  try {
    const v = keep?.getItem(LANG_KEY);
    if (v === 'ru' || v === 'en') return v;
  } catch {
    // хранилище окна недоступно
  }
  return system;
}

/** Запомнить выбор; не вышло — язык живёт до закрытия окна. */
export function keepLang(keep: Keep | undefined, l: Lang) {
  try {
    keep?.setItem(LANG_KEY, l);
  } catch {
    // хранилище окна недоступно
  }
}
