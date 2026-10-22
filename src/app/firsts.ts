// Пояснение при первом событии (Б1г; docs/specs/2026-10-vertical-slice.md, «Б1г»): в первый раз у каждого вида события
// в карточке — абзац «что это и что делать» голосом студии; «Понятно» его убирает, окно помнит выбор, как стартовый
// пресет (preset.ts). Чистые функции — их проверяют тесты в Bun; хранилище окна дают снаружи, и оно может не работать.
import type { CardData } from '../sim/views';
import type { Keep } from './preset';

/** Ключ в хранилище окна. */
export const FIRSTS_KEY = 'pharma.firsts';

/**
 * Вид события в карточке: отклонение — по виду (режим, МОК, выход, сверка, результат вне спецификации); ГП удержанной
 * серии. Пояснения нет — `undefined`.
 */
export function firstOf(c: CardData): string | undefined {
  if (c.kind === 'dev') return `dev:${c.what}`;
  if (c.kind === 'unit' && c.release?.held) return 'held';
  return undefined;
}

/** Понятые виды из хранилища окна; нет, не прочитать или чужое — ничего. */
export function keptFirsts(keep: Keep | undefined): string[] {
  try {
    const v: unknown = JSON.parse(keep?.getItem(FIRSTS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Запомнить понятые; не вышло — пояснение вернётся при следующем запуске. */
export function keepFirsts(keep: Keep | undefined, list: readonly string[]) {
  try {
    keep?.setItem(FIRSTS_KEY, JSON.stringify(list));
  } catch {
    // хранилище окна недоступно
  }
}
