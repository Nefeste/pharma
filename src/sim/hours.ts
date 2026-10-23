// Рабочее время для видов окна (Б4а; docs/specs/2026-10-vertical-slice.md, «Б4а»): табель человека за месяц с итогами,
// календарь месяцев, политика отделов, рабочее время на планёрке. Табель — записи завода, а не истина: окно видит его
// как есть. Правила — движка (src/engine/hours.ts, cash.ts).
import type { ContentDb, Dept, Id, OvertimeMode } from '../content/types';
import { extras } from '../engine/cash';
import { civilFromDays, DAY, daysFromCivil, isHoliday, isShort, isWorkday, lastOfMonth, momentOf, normOf } from '../engine/core/calendar';
import { type SheetDay, sheetDays, yearOver } from '../engine/hours';
import { awayOn } from '../engine/leave';
import { cycleDay, dayNorm, pendingOf, periodOf, scheduleOn, spanOn } from '../engine/shifts';
import type { Person, PlantState } from '../engine/types';
import { calOf, worksOn } from '../engine/workdays';

/**
 * Отметки дня табеля по форме Т-13: Я — день, Н — ночь, С — сверхурочно, РВ — в выходной или праздник, В — выходной, ОТ —
 * ежегодный отпуск (Б4г; праздник в отпуске — В).
 */
export type SheetMark = 'day' | 'night' | 'over' | 'off' | 'rest' | 'leave';

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
  // смена идёт: её часы — до этой минуты (sheetDays до `now`); отрезки после прошлой смены — как есть
  const days = sheetDays(db, s, withOpen(s, p), z0, z1, now);
  const cal = calOf(db, s);
  return days.map((d, i) => {
    const z = z0 + i;
    const x: SheetDay = d;
    const marks: SheetMark[] = [];
    if (x.work - x.night - x.over[0] - x.over[1] - x.off > 0) marks.push('day');
    if (x.night > 0) marks.push('night');
    if (x.over[0] + x.over[1] > 0) marks.push('over');
    if (x.off > 0) marks.push('off');
    if (x.work === 0) marks.push(awayOn(p, z) && !isHoliday(cal, z) ? 'leave' : 'rest');
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
 * ставкам кассы); ближе всех к пределу года — до трёх человек; праздники и короткие дни ближайшей недели. С Б4б —
 * переводы на другой график, которые вступят в силу, и дополнительные выходные бригад на неделе.
 */
export interface HoursMeeting {
  people: number;
  sec: number;
  pay: number;
  near: { person: number; tab: number; role: Id; sec: number }[];
  limit: number;
  week: { day: number; kind: 'short' | 'holiday' }[];
  moves: { person: number; tab: number; role: Id; shift: Id; from: number }[];
  extra: { shift: Id; day: number; n: number }[];
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
  const moves = Object.values(s.people)
    .flatMap(p => {
      const x = pendingOf(s, p);
      return x ? [{ person: Number(p.id.slice(1)), tab: p.tab, role: p.role, shift: x.shift, from: x.from }] : [];
    })
    .sort((a, b) => a.from - b.from || a.person - b.person);
  // дополнительные выходные (Б4б): сменный по циклу в этот день по рисунку работает, а люди графика — нет
  const extra: HoursMeeting['extra'] = [];
  for (let z = today; z < today + 7; z++) {
    const off = new Map<Id, number>();
    for (const p of Object.values(s.people)) {
      const id = scheduleOn(p, z);
      const c = db.shifts[id].cycle;
      if (c && cycleDay(c, z) !== 'off' && !spanOn(db, s, p, z)) off.set(id, (off.get(id) ?? 0) + 1);
    }
    for (const [shift, n] of [...off].sort((a, b) => (a[0] < b[0] ? -1 : 1))) extra.push({ shift, day: z, n });
  }
  return { people, sec, pay, near, limit: db.profiles[db.scenarios[s.scenario].profile].payroll.overtime.year, week, moves, extra };
}

/**
 * Учётный период человека в сменном по циклу графике (Б4б), с: первый и последний дни; норма его дней в графике; часы
 * по графику за весь период без праздничных; отработано к этой минуте — по графику и после смен; после смен; сколько
 * смен рисунка снято — дополнительные выходные и вторая смена подряд на стыке. Сегодня он не в таком графике и в
 * периоде их не было — `undefined`.
 */
export interface SaView {
  first: number;
  last: number;
  norm: number;
  plan: number;
  worked: number;
  after: number;
  off: number;
}

export function saOf(db: ContentDb, s: PlantState, p: Person): SaView | undefined {
  const today = momentOf(s.start, s.t).day;
  const [from, last] = periodOf(db, s, today);
  // до начала завода дней периода нет
  const first = Math.max(from, daysFromCivil(s.start));
  const cyc = (z: number) => !!db.shifts[scheduleOn(p, z)].cycle;
  let any = false;
  let norm = 0;
  let off = 0;
  for (let z = first; z <= last; z++) {
    if (!cyc(z)) continue;
    any = true;
    norm += dayNorm(db, s, z);
    if (cycleDay(db.shifts[scheduleOn(p, z)].cycle!, z) !== 'off' && !spanOn(db, s, p, z)) off++;
  }
  if (!any) return undefined;
  const base = daysFromCivil(s.start);
  const cal = calOf(db, s);
  const t0 = (first - base) * DAY;
  const t1 = (last + 1 - base) * DAY;
  /** секунды отрезка в днях периода в сменном по циклу графике, без праздничных */
  const inSa = (a: number, b: number) => {
    let sec = 0;
    for (let x = Math.max(a, t0); x < Math.min(b, t1); ) {
      const d = Math.floor(x / DAY);
      const y = Math.min(b, t1, (d + 1) * DAY);
      if (cyc(base + d) && !isHoliday(cal, base + d)) sec += y - x;
      x = y;
    }
    return sec;
  };
  let plan = 0;
  let worked = 0;
  for (let z = first - 1; z <= last; z++) {
    const span = spanOn(db, s, p, z);
    if (!span) continue;
    plan += inSa(span[0], span[1]);
    worked += inSa(span[0], Math.min(span[1], s.t));
  }
  const segs = [...(p.sa?.segs ?? []), ...(p.until !== undefined && s.t > p.until ? [[p.until, s.t] as [number, number]] : [])];
  const after = segs.reduce((n, [a, b]) => n + inSa(a, b), 0);
  return { first, last, norm, plan, worked: worked + after, after, off };
}

/** Сутки графика в календаре месяца (Б4б): по рисунку или пятидневке — дневная, ночная, нет смены; сколько людей
 * графика в смене и сколько их в графике в этот день. */
export interface ShiftCell {
  k: 'day' | 'night' | 'off';
  n: number;
  of: number;
}

/** Календарь графиков месяца (Б4б): по графику — сутки; по роли — сколько людей в дневной и в ночной смене. */
export interface ShiftMonth {
  y: number;
  m: number;
  rows: { shift: Id; days: ShiftCell[] }[];
  roles: { role: Id; day: number[]; night: number[] }[];
}

/** Календарь графиков этого и следующего месяца — по переводам и дополнительным выходным, как их знает завод. */
export function shiftMonths(db: ContentDb, s: PlantState): ShiftMonth[] {
  const cal = calOf(db, s);
  const { y, m } = momentOf(s.start, s.t).date;
  const people = Object.values(s.people);
  const roles = [...new Set(people.map(p => p.role))];
  const out: ShiftMonth[] = [];
  for (let k = 0; k < 2; k++) {
    const yy = y + Math.floor((m - 1 + k) / 12);
    const mm = ((m - 1 + k) % 12) + 1;
    const z0 = daysFromCivil({ y: yy, m: mm, d: 1 });
    const z1 = lastOfMonth(yy, mm);
    const rows = Object.values(db.shifts).map(sh => {
      const days: ShiftCell[] = [];
      for (let z = z0; z <= z1; z++) {
        const kind = sh.cycle ? cycleDay(sh.cycle, z) : worksOn(cal, sh, z) ? 'day' : 'off';
        let n = 0;
        let of = 0;
        for (const p of people) {
          if (scheduleOn(p, z) !== sh.id) continue;
          of++;
          if (spanOn(db, s, p, z)) n++;
        }
        days.push({ k: kind, n, of });
      }
      return { shift: sh.id, days };
    });
    const byRole = roles.map(role => {
      const day: number[] = [];
      const night: number[] = [];
      for (let z = z0; z <= z1; z++) {
        let d = 0;
        let n = 0;
        for (const p of people) {
          if (p.role !== role) continue;
          const span = spanOn(db, s, p, z);
          if (!span) continue;
          // ночная — та, что переходит за полночь
          if (Math.floor(span[0] / DAY) !== Math.floor((span[1] - 1) / DAY)) n++;
          else d++;
        }
        day.push(d);
        night.push(n);
      }
      return { role, day, night };
    });
    out.push({ y: yy, m: mm, rows, roles: byRole });
  }
  return out;
}
