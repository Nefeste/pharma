// Клавиши (Б13, шаг 3; docs/specs/2026-10-vertical-slice.md, «Б13. Доступность и настройки»; геймдизайн, §18 и §23):
// карта действий — действие, клавиша по умолчанию (`KeyboardEvent.code`), раздел. Окно спрашивает действие по клавише,
// а не код. Игрок переназначает клавишу в «Настройках»; занятая — отказ со словом, чья она; Esc, F12, Tab и Ctrl+Z не
// переназначаются. Выбор — в окне, как прочие настройки. Чистые функции проверяют тесты в Bun.
import type { Keep } from './preset';

/** Действия по разделам; порядок — как в «Настройках». */
export const ACTIONS = [
  // время
  ['pause', 'Space', 'time'],
  ['live', 'Digit0', 'time'],
  ['speed1', 'Digit1', 'time'],
  ['speed2', 'Digit2', 'time'],
  ['speed3', 'Digit3', 'time'],
  ['speed4', 'Digit4', 'time'],
  ['morning', 'Digit5', 'time'],
  ['event', 'Digit6', 'time'],
  // камера
  ['up', 'KeyW', 'camera'],
  ['left', 'KeyA', 'camera'],
  ['down', 'KeyS', 'camera'],
  ['right', 'KeyD', 'camera'],
  ['turnLeft', 'KeyQ', 'camera'],
  ['turnRight', 'KeyE', 'camera'],
  // окна
  ['stock', 'F2', 'windows'],
  ['ref', 'F1', 'windows'],
  ['gantt', 'KeyG', 'windows'],
  ['now', 'KeyN', 'windows'],
  ['journal', 'KeyJ', 'windows'],
  ['chronicle', 'KeyH', 'windows'],
  ['kpi', 'KeyK', 'windows'],
  ['policies', 'KeyP', 'windows'],
  ['sop', 'KeyO', 'windows'],
  ['portfolio', 'KeyF', 'windows'],
  ['inv', 'KeyI', 'windows'],
  ['layer', 'KeyL', 'windows'],
  // стройка
  ['build', 'KeyB', 'build'],
  ['rotate', 'KeyR', 'build'],
  ['debug', 'Backquote', 'windows'],
] as const;

export type Action = (typeof ACTIONS)[number][0];
export type Section = (typeof ACTIONS)[number][2];
export const SECTIONS: readonly Section[] = ['time', 'camera', 'windows', 'build'];

/** Клавиши, которые не переназначаются и ни одному действию не даются: Esc, снимок, переход фокуса, стрелки камеры. */
export const FIXED = new Set(['Escape', 'F12', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** Ключ в хранилище окна: только то, что игрок поменял, — `{ действие: код }`. */
export const KEYS_KEY = 'pharma.keys';

export type KeyMap = Record<Action, string>;

export const DEFAULT_KEYS: KeyMap = Object.fromEntries(ACTIONS.map(([a, k]) => [a, k])) as KeyMap;

/** Карта из строки хранилища: только известные действия и свободные клавиши; испорчено — по умолчанию. */
export function keysOf(raw: string | null | undefined): KeyMap {
  const map: KeyMap = { ...DEFAULT_KEYS };
  let x: unknown;
  try {
    x = raw ? JSON.parse(raw) : {};
  } catch {
    return map;
  }
  if (!x || typeof x !== 'object') return map;
  for (const [a, k] of Object.entries(x as Record<string, unknown>)) {
    if (!(a in DEFAULT_KEYS) || typeof k !== 'string' || !k || FIXED.has(k)) continue;
    const r = bind(map, a as Action, k);
    if (r.map) Object.assign(map, r.map);
  }
  return map;
}

/** Карта из хранилища окна. */
export function keptKeys(keep: Keep | undefined): KeyMap {
  try {
    return keysOf(keep?.getItem(KEYS_KEY));
  } catch {
    return { ...DEFAULT_KEYS };
  }
}

/** Записать: только отличное от умолчания. */
export function keepKeys(keep: Keep | undefined, map: KeyMap) {
  const own = Object.fromEntries(Object.entries(map).filter(([a, k]) => DEFAULT_KEYS[a as Action] !== k));
  try {
    keep?.setItem(KEYS_KEY, JSON.stringify(own));
  } catch {
    // хранилище окна недоступно
  }
}

/** Действие клавиши; нет — `undefined`. */
export function actionOf(map: KeyMap, code: string): Action | undefined {
  for (const [a, k] of Object.entries(map)) if (k === code) return a as Action;
  return undefined;
}

/**
 * Дать действию клавишу: новая карта или отказ — клавиша не переназначается (`fixed`) или занята другим действием
 * (`taken` с ним). Та же клавиша у того же действия — та же карта.
 */
export function bind(map: KeyMap, a: Action, code: string): { map?: KeyMap; fixed?: true; taken?: Action } {
  if (FIXED.has(code)) return { fixed: true };
  const other = actionOf(map, code);
  if (other && other !== a) return { taken: other };
  return { map: { ...map, [a]: code } };
}

/** Клавиша словами: «G», «5», «Пробел» — у кода без буквы и цифры имя даёт словарь окна. */
export function keyName(code: string, names: Record<string, string>): string {
  if (names[code]) return names[code];
  const m = /^(?:Key|Digit|Numpad)(.+)$/.exec(code);
  return m ? m[1] : code;
}
