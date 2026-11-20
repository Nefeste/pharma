// Доступность (Б13, шаг 2; docs/specs/2026-10-vertical-slice.md, «Б13. Доступность и настройки»; геймдизайн, §23):
// повышенный контраст и мышь «для левой руки». Настройки игрока — в окне, а не в сохранении, как «Меньше движения»
// (motion.ts). Чистые функции без DOM проверяют тесты в Bun; хранилище окна и вопрос к системе приходят снаружи.
import type { Keep } from './preset';

/** Ключи в хранилище окна. */
export const ACCESS = { contrast: 'pharma.contrast', left: 'pharma.leftHand' } as const;

/** Выбор «да» или «нет» из хранилища; не выбран, чужое значение или хранилище не читается — `def`. */
export function keptFlag(keep: Keep | undefined, key: string, def: boolean): boolean {
  try {
    const v = keep?.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    // хранилище окна недоступно
  }
  return def;
}

/** Запомнить выбор; не вышло — действует до закрытия окна. */
export function keepFlag(store: Keep | undefined, key: string, on: boolean) {
  try {
    store?.setItem(key, on ? '1' : '0');
  } catch {
    // хранилище окна недоступно
  }
}

/** Просит ли система окна больше контраста (`prefers-contrast: more`); спросить нельзя — нет. */
export function systemContrast(ask: ((q: string) => { matches: boolean }) | undefined = typeof matchMedia === 'function' ? q => matchMedia(q) : undefined): boolean {
  try {
    return ask?.('(prefers-contrast: more)').matches ?? false;
  } catch {
    return false;
  }
}

/** Повышенный контраст — на страницу: класс `contrast` у корня переопределяет токены (app/index.html). */
export function applyContrast(on: boolean) {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('contrast', on);
}

/**
 * Кнопка мыши в сцене для левой руки: левая и правая меняются местами — выбор правой, камера и отмена левой; средняя —
 * как была. Панели — как в системе: их кнопки нажимает браузер.
 */
export function sceneButton(button: number, left: boolean): number {
  if (!left) return button;
  return button === 0 ? 2 : button === 2 ? 0 : button;
}
