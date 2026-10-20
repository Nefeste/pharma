// Календарь движка без `Date` (ADR студии 0004): гражданская дата из номера дня и обратно — алгоритмы
// days_from_civil и civil_from_days Говарда Хиннанта (H. Hinnant, «chrono-Compatible Low-Level Date Algorithms»). Только
// целые числа и деление с округлением вниз, поэтому одинаково в Bun и V8.

export const MIN = 60;
export const HOUR = 3600;
export const DAY = 86400;

export interface Ymd {
  y: number;
  /** 1–12 */
  m: number;
  /** 1–31 */
  d: number;
}

/** Номер дня от 1970-01-01. */
export function daysFromCivil({ y, m, d }: Ymd): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = m > 2 ? m - 3 : m + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Дата по номеру дня от 1970-01-01. */
export function civilFromDays(z: number): Ymd {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

/** День недели: 0 — понедельник … 6 — воскресенье. 1970-01-01 был четвергом. */
export function weekday(z: number): number {
  return (((z + 3) % 7) + 7) % 7;
}

/** Что показывают часы завода через `t` игровых секунд после полуночи даты начала. */
export interface Moment {
  /** номер дня от 1970-01-01 */
  day: number;
  date: Ymd;
  weekday: number;
  /** секунды от полуночи */
  sec: number;
}

export function momentOf(start: Ymd, t: number): Moment {
  const day = daysFromCivil(start) + Math.floor(t / DAY);
  return { day, date: civilFromDays(day), weekday: weekday(day), sec: ((t % DAY) + DAY) % DAY };
}

// Рабочие дни: понедельник — пятница; праздников в календаре пока нет (docs/specs/2026-10-engine.md, 1д).

export function isWorkday(z: number): boolean {
  return weekday(z) < 5;
}

/** Первый рабочий день не раньше `z`. */
export function workdayOnOrAfter(z: number): number {
  while (!isWorkday(z)) z++;
  return z;
}

/** Последний рабочий день не позже `z`. */
export function workdayOnOrBefore(z: number): number {
  while (!isWorkday(z)) z--;
  return z;
}

/** Через `n` рабочих дней после `z` (n ≥ 1). */
export function addWorkdays(z: number, n: number): number {
  let d = z;
  for (let i = 0; i < n; i++) d = workdayOnOrAfter(d + 1);
  return d;
}

/**
 * Через `n` месяцев после дня `z`: то же число месяца, а если его в том месяце нет — последний день месяца (срок записи
 * обучения, Б3б).
 */
export function addMonths(z: number, n: number): number {
  const { y, m, d } = civilFromDays(z);
  const k = y * 12 + (m - 1) + n;
  const yy = Math.floor(k / 12);
  const mm = k - yy * 12 + 1;
  return Math.min(daysFromCivil({ y: yy, m: mm, d }), lastOfMonth(yy, mm));
}

/** Номер последнего дня месяца. */
export function lastOfMonth(y: number, m: number): number {
  return daysFromCivil(m === 12 ? { y: y + 1, m: 1, d: 1 } : { y, m: m + 1, d: 1 }) - 1;
}

/** Рабочих дней в месяце. */
export function workdaysIn(y: number, m: number): number {
  let n = 0;
  for (let z = daysFromCivil({ y, m, d: 1 }), end = lastOfMonth(y, m); z <= end; z++) if (isWorkday(z)) n++;
  return n;
}
