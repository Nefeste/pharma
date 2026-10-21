// Рабочее время для видов окна (Б4а; docs/specs/2026-10-vertical-slice.md, «Б4а»): табель человека за месяц с итогами,
// календарь месяцев, политика отделов, рабочее время на планёрке. Табель — записи завода, а не истина: окно видит его
// как есть. Правила — движка (src/engine/hours.ts, cash.ts).
import type { ContentDb, Dept, Id, OvertimeMode } from '../content/types';
import { extras } from '../engine/cash';
import { civilFromDays, daysFromCivil, isHoliday, isShort, isWorkday, lastOfMonth, momentOf, normOf } from '../engine/core/calendar';
import { nightIn, type SheetDay, sheetDays, shiftSpan, yearOver } from '../engine/hours';
import type { Person, PlantState } from '../engine/types';
import { calOf } from '../engine/workdays';

/** Отметки дня табеля по форме Т-13: Я — день, Н — ночь, С — сверхурочно, РВ — в выходной или праздник, В — выходной. */
export type SheetMark = 'day' | 'night' | 'over' | 'off' | 'rest';

/** День табеля: номер дня от 1970-01-01, отметки и часы, с; сегодня — до этой минуты. */
export interface SheetRow {
  day: number;
  marks: SheetMark[];
  work: number;
  night: number;
  over: number;
  off: number;
}

/** Табель месяца (Б4а): дни с 1-го по сегодня; отработано и норма месяца; сверхурочно за месяц и за год, предел года, с. */
export interface SheetView {
  y: number;
  m: number;
  rows: SheetRow[];
  worked: number;
  norm: number;
  over: number;
  year: number;
  limit: number;
  /** работает после конца смены сейчас — с какого мгновения */
  since?: number;
}

/** Отрезки сверхурочных человека с тем, что идёт сейчас: задача, взятая в смену, длится после её конца. */
function withOpen(s: PlantState, p: Person): Person {
  return p.until !== undefined && s.t > p.until ? { ...p, ot: [...p.ot, [p.until, s.t]] } : p;
}

/**
 * Табель человека за дни `z0`–`z1` до мгновения `now`: смена сегодня — до этой минуты, перерыв дневной смены — долей
 * прошедшей смены (где он в смене, завод не знает).
 */
function rowsTo(db: ContentDb, s: PlantState, p: Person, z0: number, z1: number, now: number): SheetRow[] {
  const days = sheetDays(db, s, withOpen(s, p), z0, z1);
  const sh = db.shifts[p.shift];
  return days.map((d, i) => {
    const z = z0 + i;
    let x: SheetDay = d;
    const span = shiftSpan(db, s, sh, z);
    if (span && now < span[1]) {
      // смена идёт: её часы — до этой минуты; отрезки после прошлой смены, перешедшие за полночь, — как есть
      const len = span[1] - span[0];
      const done = Math.min(len, Math.max(0, now - span[0]));
      const full = len - sh.break;
      const extra = d.work - full;
      x = { ...d, work: extra + done - Math.floor((done * sh.break) / len), night: d.night - nightIn(db, s, span[0], span[1]) + nightIn(db, s, span[0], span[0] + done) };
    }
    const marks: SheetMark[] = [];
    if (x.work - x.night - x.over[0] - x.over[1] - x.off > 0) marks.push('day');
    if (x.night > 0) marks.push('night');
    if (x.over[0] + x.over[1] > 0) marks.push('over');
    if (x.off > 0) marks.push('off');
    if (x.work === 0) marks.push('rest');
    return { day: z, marks, work: x.work, night: x.night, over: x.over[0] + x.over[1], off: x.off };
  });
}

/** Табель месяца сегодня. */
export function sheetOf(db: ContentDb, s: PlantState, p: Person): SheetView {
  const now = momentOf(s.start, s.t);
  const { y, m } = now.date;
  const pr = db.profiles[db.scenarios[s.scenario].profile];
  const first = daysFromCivil({ y, m, d: 1 });
  const rows = rowsTo(db, s, p, Math.max(first, daysFromCivil(s.start)), now.day, s.t);
  const open = p.until !== undefined && s.t > p.until ? s.t - p.until : 0;
  return {
    y,
    m,
    rows,
    worked: rows.reduce((n, r) => n + r.work, 0),
    norm: normOf(calOf(db, s), y, m, pr.calendar.day, pr.calendar.short),
    over: rows.reduce((n, r) => n + r.over + r.off, 0),
    year: yearOver(p, y) + open,
    limit: pr.payroll.overtime.year,
    ...(open > 0 ? { since: p.until! } : {}),
  };
}

/** День календаря месяца: рабочий, короткий (накануне праздника), выходной, нерабочий праздник. */
export type CalDay = 'work' | 'short' | 'off' | 'holiday';

/** Месяц производственного календаря: дни с 1-го; норма часов при 40-часовой неделе, с. */
export interface CalMonth {
  y: number;
  m: number;
  days: CalDay[];
  norm: number;
}

/** Календарь `n` месяцев с нынешнего — по профилю сценария (Б4а). */
export function calendarOf(db: ContentDb, s: PlantState, n = 12): CalMonth[] {
  const cal = calOf(db, s);
  const pr = db.profiles[db.scenarios[s.scenario].profile];
  const { y, m } = momentOf(s.start, s.t).date;
  const out: CalMonth[] = [];
  for (let k = 0; k < n; k++) {
    const yy = y + Math.floor((m - 1 + k) / 12);
    const mm = ((m - 1 + k) % 12) + 1;
    const days: CalDay[] = [];
    for (let z = daysFromCivil({ y: yy, m: mm, d: 1 }), end = lastOfMonth(yy, mm); z <= end; z++) days.push(isHoliday(cal, z) ? 'holiday' : !isWorkday(cal, z) ? 'off' : isShort(cal, z) ? 'short' : 'work');
    out.push({ y: yy, m: mm, days, norm: normOf(cal, yy, mm, pr.calendar.day, pr.calendar.short) });
  }
  return out;
}

/** Итоги человека в справочнике (Б4а): отработано и норма месяца, сверхурочно за месяц и за год, с. */
export interface HoursRow {
  worked: number;
  norm: number;
  over: number;
  year: number;
}

export function hoursRow(db: ContentDb, s: PlantState, p: Person): HoursRow {
  const v = sheetOf(db, s, p);
  return { worked: v.worked, norm: v.norm, over: v.over, year: v.year };
}

/** Политики отделов (Б4а): сверхурочные. */
export function policyOf(s: PlantState): Record<Dept, OvertimeMode> {
  return { ...s.policy };
}

/**
 * «Рабочее время» на планёрке (Б4а): сверхурочные вчера — людей, часов и денег (сверхурочные и работа в выходной по
 * ставкам кассы); ближе всех к пределу года — до трёх человек; праздники и короткие дни ближайшей недели.
 */
export interface HoursMeeting {
  people: number;
  sec: number;
  pay: number;
  near: { person: number; tab: number; role: Id; sec: number }[];
  limit: number;
  week: { day: number; kind: 'short' | 'holiday' }[];
}

export function hoursMeeting(db: ContentDb, s: PlantState): HoursMeeting {
  const today = momentOf(s.start, s.t).day;
  const y0 = today - 1;
  const { y, m, d } = civilFromDays(y0);
  let people = 0;
  let sec = 0;
  let pay = 0;
  for (const p of Object.values(s.people)) {
    const row = sheetDays(db, s, p, y0, y0)[0];
    const over = row.over[0] + row.over[1] + row.off;
    if (over === 0) continue;
    people++;
    sec += over;
    const x = extras(db, s, p, y, m, d, d);
    pay += x.over + x.off;
  }
  const yr = momentOf(s.start, s.t).date.y;
  const near = Object.values(s.people)
    .map(p => ({ person: Number(p.id.slice(1)), tab: p.tab, role: p.role, sec: yearOver(p, yr) }))
    .filter(x => x.sec > 0)
    .sort((a, b) => b.sec - a.sec || a.person - b.person)
    .slice(0, 3);
  const cal = calOf(db, s);
  const week: HoursMeeting['week'] = [];
  for (let z = today; z < today + 7; z++) {
    if (isHoliday(cal, z)) week.push({ day: z, kind: 'holiday' });
    else if (isShort(cal, z)) week.push({ day: z, kind: 'short' });
  }
  return { people, sec, pay, near, limit: db.profiles[db.scenarios[s.scenario].profile].payroll.overtime.year, week };
}
