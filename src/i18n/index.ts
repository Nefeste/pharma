// из bolnitsa: src/i18n/index.ts @ e0a3491 — изменено: дата завода вместо денег и падежей больницы.
// Язык интерфейса: русский и английский с первого дня. Строки читаются при отрисовке — `T.раздел.ключ`, не в константы
// модуля: язык можно сменить на ходу. Названия из базы — `name.ru`, английское — если есть.
import { civilFromDays, type Moment, momentOf, type Ymd } from '../engine/core/calendar';
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

/** Число с разрядами по языку: «40 000», «12,5». */
export function num(n: number, digits = 0): string {
  return new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

/** Количество в единице материала: масса — мг в килограммах (`digits` знаков после запятой), штуки — штуками; единица — рядом. */
export function qtyText(value: number, unit: 'mass' | 'pcs', digits = 1): string {
  return unit === 'mass' ? `${num(value / 1e6, digits)}\u00a0${T.units.kg}` : `${num(value)}\u00a0${T.units.pcs}`;
}

/** День от 1970-01-01 — короткой датой: «14.09.2027». */
export function dayText(day: number): string {
  const d = civilFromDays(day);
  return T.date.short(d.d, d.m, d.y);
}

/** Мгновение завода — днём и часами: «14.09 12:56». */
export function whenText(start: Ymd, t: number): string {
  const m = momentOf(start, t);
  return T.date.when(m.date.d, m.date.m, clock(m.sec));
}

/** Деньги — копейки рублями без копеек, с разрядами: «28 450 000 ₽»; со знаком — «+1 200 000 ₽» и «−1 200 000 ₽». */
export function money(kop: number, sign = false): string {
  const rub = Math.round(kop / 100);
  const s = `${num(Math.abs(rub))} ₽`;
  return rub < 0 ? `−${s}` : sign && rub > 0 ? `+${s}` : s;
}

/** Цена — копейки рублями, с копейками, если рублей не целое число: «38 ₽», «0,40 ₽». */
export function priceText(kop: number): string {
  return kop % 100 === 0 ? money(kop) : `${num(kop / 100, 2)} ₽`;
}

/** Длительность: «3 ч 20 мин», «46 мин». */
export function durText(sec: number): string {
  const all = Math.round(sec / 60);
  const h = Math.floor(all / 60);
  const m = all % 60;
  if (h === 0) return `${m} ${T.units.min}`;
  return m > 0 ? `${h} ${T.units.h} ${m} ${T.units.min}` : `${h} ${T.units.h}`;
}

/** Часы — с: целыми, а не целые — с десятой: «176 ч», «7,5 ч». */
export function hText(sec: number): string {
  const h = sec / 3600;
  return `${num(h, Number.isInteger(Math.round(h * 10) / 10) ? 0 : 1)}\u00a0${T.units.h}`;
}

/** Дни (Б4г): «14 дней»; не целые — «2,33 дня». */
export function daysText(n: number): string {
  return `${num(n, Number.isInteger(n) ? 0 : 2)}\u00a0${T.leave.dayWord(n)}`;
}

/** Доля 1/10 000 — процентами: «61 %». */
export function pctText(share: number, digits = 0): string {
  return `${num(share / 100, digits)} %`;
}

/** Сантиметры — километрами: «2,4 км». */
export function kmText(cm: number): string {
  return `${num(cm / 1e5, 1)} ${T.units.km}`;
}
