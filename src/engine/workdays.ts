// Рабочие дни завода (Б4а; docs/specs/2026-10-vertical-slice.md, «Б4а»): производственный календарь — из регуляторного
// профиля сценария (ADR 0004: «праздники и сверхурочные»), один на профиль. По нему живут смены пятидневки, коллеги в
// свой час рабочего дня, фуры, заказы покупателей и дни платежей.
import type { ContentDb, Shift } from '../content/types';
import { isShort, isWorkday, weekday, type WorkCalendar, workCalendar, type Ymd } from './core/calendar';

/** Что нужно, чтобы знать календарь и часы завода: дата начала и сценарий. */
export interface Clock {
  start: Ymd;
  scenario: string;
}

const made = new WeakMap<object, WorkCalendar>();
/** последний ответ: раздатчик спрашивает календарь о каждом свободном человеке */
let last: { db: ContentDb; scenario: string; cal: WorkCalendar } | undefined;

/** Производственный календарь сценария — по его профилю. */
export function calOf(db: ContentDb, s: Clock): WorkCalendar {
  if (last?.db === db && last.scenario === s.scenario) return last.cal;
  const spec = db.profiles[db.scenarios[s.scenario].profile].calendar;
  let cal = made.get(spec);
  if (!cal) made.set(spec, (cal = workCalendar(spec)));
  last = { db, scenario: s.scenario, cal };
  return cal;
}

/** Пятидневка — смена по будням: она живёт по производственному календарю. */
const FIVE = [0, 1, 2, 3, 4];
const five = new WeakMap<Shift, boolean>();

/** Работает ли смена в день `z`: пятидневка — по календарю (праздники, переносы), другая — по своим дням недели. */
export function worksOn(cal: WorkCalendar, sh: Shift, z: number): boolean {
  let f = five.get(sh);
  if (f === undefined) five.set(sh, (f = sh.days.length === FIVE.length && FIVE.every(d => sh.days.includes(d))));
  return f ? isWorkday(cal, z) : sh.days.includes(weekday(z));
}

/** Конец смены в день `z`, с от полуночи: накануне праздника — короче на час профиля (ст. 95 ТК РФ). */
export function shiftTo(db: ContentDb, s: Clock, cal: WorkCalendar, sh: Shift, z: number): number {
  const short = isShort(cal, z) ? db.profiles[db.scenarios[s.scenario].profile].calendar.short : 0;
  return sh.to * 3600 - short;
}
