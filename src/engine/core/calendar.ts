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

// Производственный календарь (Б4а; docs/10-domain.md, §2): рабочие дни пятидневки — понедельник — пятница, кроме
// нерабочих праздников (ст. 112 ТК РФ) и выходных, перенесённых на будни; выходной, совпавший с праздником, переносится
// на следующий рабочий день, кроме январских — их переносит постановление Правительства. Перенос постановлением — «с» и
// «на»: день «на» становится выходным, день «с» — рабочим, если он не праздник, и длится как день «на». Рабочий день
// накануне праздника короче (ст. 95; Порядок 588н). Год считается один раз и помнится в календаре.

/** Данные календаря — из регуляторного профиля: праздники (месяц, число), январские (с, по), переносы (с, на) — дни. */
export interface CalendarSpec {
  holidays: readonly (readonly [number, number])[];
  january: readonly [number, number];
  transfers: readonly (readonly [number, number])[];
}

/** Дни года: праздники; выходные пятидневки сверх субботы и воскресенья; рабочие субботы и воскресенья; короткие дни. */
interface YearDays {
  holiday: Set<number>;
  off: Set<number>;
  on: Set<number>;
  short: Set<number>;
}

export interface WorkCalendar {
  spec: CalendarSpec;
  years: Map<number, YearDays>;
  /** день → отметки: 1 — рабочий, 2 — короткий, 4 — праздник; раздатчик спрашивает о дне много раз за час */
  days: Map<number, number>;
}

export const workCalendar = (spec: CalendarSpec): WorkCalendar => ({ spec, years: new Map(), days: new Map() });

function yearOf(cal: WorkCalendar, y: number): YearDays {
  const known = cal.years.get(y);
  if (known) return known;
  const r: YearDays = { holiday: new Set(), off: new Set(), on: new Set(), short: new Set() };
  for (const [m, d] of cal.spec.holidays) r.holiday.add(daysFromCivil({ y, m, d }));
  const inYear = (z: number) => civilFromDays(z).y === y;
  // постановление: «на» — выходной; «с» — рабочий, если не праздник
  const moves = cal.spec.transfers.filter(([, to]) => inYear(to));
  for (const [from, to] of moves) {
    r.off.add(to);
    if (!r.holiday.has(from)) r.on.add(from);
  }
  const works = (z: number) => !r.holiday.has(z) && !r.off.has(z) && (weekday(z) < 5 || r.on.has(z));
  // ч. 2 ст. 112: выходной, совпавший с праздником, кроме январских, — на следующий после праздника рабочий день
  const [j0, j1] = cal.spec.january;
  for (const z of [...r.holiday].sort((a, b) => a - b)) {
    const { m, d } = civilFromDays(z);
    if (weekday(z) < 5 || (m === 1 && d >= j0 && d <= j1)) continue;
    let w = z + 1;
    while (!works(w)) w++;
    r.off.add(w);
  }
  cal.years.set(y, r);
  // накануне праздника — короче; рабочий день «с» длится как день «на». Праздник — по дате: 31 декабря смотрит на
  // 1 января следующего года, не считая весь год
  const holidayAt = (z: number) => {
    const { m, d } = civilFromDays(z);
    return cal.spec.holidays.some(h => h[0] === m && h[1] === d);
  };
  for (let z = daysFromCivil({ y, m: 1, d: 1 }), end = daysFromCivil({ y, m: 12, d: 31 }); z <= end; z++) if (works(z) && holidayAt(z + 1)) r.short.add(z);
  for (const [from, to] of moves) if (r.on.has(from) && holidayAt(to + 1)) r.short.add(from);
  return r;
}

/** Отметки дня (`WorkCalendar.days`). */
function flags(cal: WorkCalendar, z: number): number {
  let f = cal.days.get(z);
  if (f === undefined) {
    const r = yearOf(cal, civilFromDays(z).y);
    f = (!r.holiday.has(z) && !r.off.has(z) && (weekday(z) < 5 || r.on.has(z)) ? 1 : 0) | (r.short.has(z) ? 2 : 0) | (r.holiday.has(z) ? 4 : 0);
    cal.days.set(z, f);
  }
  return f;
}

/** Рабочий ли день пятидневки по календарю. */
export function isWorkday(cal: WorkCalendar, z: number): boolean {
  return (flags(cal, z) & 1) !== 0;
}

/** Нерабочий праздник ли (ст. 112). */
export function isHoliday(cal: WorkCalendar, z: number): boolean {
  return (flags(cal, z) & 4) !== 0;
}

/** Короткий ли день: рабочий день накануне праздника (ст. 95). */
export function isShort(cal: WorkCalendar, z: number): boolean {
  return (flags(cal, z) & 2) !== 0;
}

/** Первый рабочий день не раньше `z`. */
export function workdayOnOrAfter(cal: WorkCalendar, z: number): number {
  while (!isWorkday(cal, z)) z++;
  return z;
}

/** Последний рабочий день не позже `z`. */
export function workdayOnOrBefore(cal: WorkCalendar, z: number): number {
  while (!isWorkday(cal, z)) z--;
  return z;
}

/** Через `n` рабочих дней после `z` (n ≥ 1). */
export function addWorkdays(cal: WorkCalendar, z: number, n: number): number {
  let d = z;
  for (let i = 0; i < n; i++) d = workdayOnOrAfter(cal, d + 1);
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

/** Рабочих дней пятидневки в месяце. */
export function workdaysIn(cal: WorkCalendar, y: number, m: number): number {
  let n = 0;
  for (let z = daysFromCivil({ y, m, d: 1 }), end = lastOfMonth(y, m); z <= end; z++) if (isWorkday(cal, z)) n++;
  return n;
}

/**
 * Норма рабочего времени месяца, с (Порядок 588н): рабочие дни пятидневки по `day` секунд, без `short` секунд за каждый
 * короткий день.
 */
export function normOf(cal: WorkCalendar, y: number, m: number, day: number, short: number): number {
  let sec = 0;
  for (let z = daysFromCivil({ y, m, d: 1 }), end = lastOfMonth(y, m); z <= end; z++) if (isWorkday(cal, z)) sec += day - (isShort(cal, z) ? short : 0);
  return sec;
}
