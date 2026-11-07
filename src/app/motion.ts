// «Меньше движения» (правило 6 ADR 0023 устава; docs/13-art.md, §14 и «Графика (ADR 0023 устава)»; геймдизайн, §23):
// настройка игрока. Включена — то, что движется только для красоты, не движется: поворот камеры — сразу, без доворота;
// смена крупности показа — сразу, без перехода; переходы страницы — мгновенны. То, что показывает завод, — ленты, роторы,
// люди, фуры, двери — идёт как шло: это правда завода, а не украшение. Движок, поток расчёта и срез не знают о ней.
// Выбор живёт в окне, как стартовый пресет (preset.ts); не выбран — как просит система (`prefers-reduced-motion`).
// Чистые функции без DOM — их проверяют тесты в Bun; хранилище окна и вопрос к системе приходят снаружи.
import type { Keep } from './preset';

/** Ключ в хранилище окна. */
export const MOTION = { key: 'pharma.lessMotion' } as const;

/** Выбор игрока; не выбран, чужое значение или хранилище не читается — как просит система. */
export function keptLess(keep: Keep | undefined, system: boolean): boolean {
  try {
    const v = keep?.getItem(MOTION.key);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    // хранилище окна недоступно: как просит система
  }
  return system;
}

/** Запомнить выбор игрока; не вышло — настройка действует до закрытия окна. */
export function keepLess(store: Keep | undefined, on: boolean) {
  try {
    store?.setItem(MOTION.key, on ? '1' : '0');
  } catch {
    // хранилище окна недоступно
  }
}

/** Просит ли система окна меньше движения; спросить нельзя — нет. */
export function systemLess(ask: ((q: string) => { matches: boolean }) | undefined = typeof matchMedia === 'function' ? q => matchMedia(q) : undefined): boolean {
  try {
    return ask?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}
