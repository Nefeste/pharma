// из bolnitsa: src/i18n/index.ts @ e0a3491 — изменено: дата завода вместо денег и падежей больницы.
// Язык интерфейса: русский и английский с первого дня. Строки читаются при отрисовке — `T.раздел.ключ`, не в константы
// модуля: язык можно сменить на ходу. Названия из базы — `name.ru`, английское — если есть.
import type { Moment } from '../engine/core/calendar';
import { en } from './en';
import { ru, type Strings } from './ru';

export type Lang = 'ru' | 'en';
export let T: Strings = ru;
export let lang: Lang = 'ru';

export function setLang(l: Lang) {
  lang = l;
  T = l === 'en' ? en : ru;
}

/** Язык по умолчанию — системы: русский для `ru*`, иначе английский. */
export function systemLang(): Lang {
  return typeof navigator !== 'undefined' && !/^ru\b/i.test(navigator.language || 'ru') ? 'en' : 'ru';
}

/** Название из базы: на языке интерфейса, иначе по-русски. */
export function named(n: { ru: string; en?: string } | undefined, fallback = ''): string {
  if (!n) return fallback;
  return (lang === 'en' && n.en) || n.ru;
}

/** Часы завода: «08:05». */
export function clock(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

/** Дата завода: «ср, 1 сентября 2027». */
export function dateText(m: Moment): string {
  return `${T.date.weekdays[m.weekday]}, ${T.date.full(m.date.d, T.date.months[m.date.m - 1], m.date.y)}`;
}
