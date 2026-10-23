// Рабочее время по закону (Б4а; docs/specs/2026-10-vertical-slice.md, «Б4а»; docs/10-domain.md, §2). Табель — часы
// смены по графику и отрезки работы после её конца: их человек отрабатывает, когда кончает задачу, взятую в смену.
// Сверхурочные — не больше предела за смену и за календарный год (ст. 99 ТК РФ): человек берёт задачу, только если по
// норме с запасом на разброс она помещается в остаток смены и в сверхурочные, которые ему ещё можно (`fits`). Политика
// отдела «Сверхурочные» — «по потребности» или «только закончить начатое»; учёба и проверка знаний — только в смену.
// Деньги по табелю — cash.ts.
import { type ContentDb, DEPTS, type Dept, type OvertimeMode, type TaskKind } from '../content/types';
import { civilFromDays, DAY, daysFromCivil, isHoliday, momentOf } from './core/calendar';
import { saAfter, scheduleOn, spanOn } from './shifts';
import type { Command, Notice, Person, PlantState } from './types';
import { calOf, type Clock, worksOn } from './workdays';

/** Задачи, которые ставят только в смену (гипотеза): учёба и проверка знаний (Б3б). */
const IN_SHIFT: ReadonlySet<TaskKind> = new Set<TaskKind>(['train', 'trainCheck']);

const overtimeOf = (db: ContentDb, s: Clock) => db.profiles[db.scenarios[s.scenario].profile].payroll.overtime;

/** Политики отделов на старте — из сценария (Б4а). */
export function newPolicy(db: ContentDb, scenario: string): Record<Dept, OvertimeMode> {
  const mode = db.scenarios[scenario].policies.overtime;
  return Object.fromEntries(DEPTS.map(d => [d, mode])) as Record<Dept, OvertimeMode>;
}

/** Сверхурочно за год `y`, с: прошлые годы не считаются. */
export function yearOver(p: Person, y: number): number {
  return p.otYear.y === y ? p.otYear.sec : 0;
}

/** Сколько сверхурочных человеку ещё можно после смены, начатой в мгновение `t`: предел за смену и остаток года, с. */
export function overLeft(db: ContentDb, s: Clock, p: Person, t: number): number {
  const ot = overtimeOf(db, s);
  return Math.max(0, Math.min(ot.shift, ot.year - yearOver(p, momentOf(s.start, t).date.y)));
}

/**
 * Помещается ли задача (Б4а): до её конца по норме — `nom`, по наибольшей длительности — `max`, с; до конца смены —
 * `room`, сверхурочных ещё можно — `left`. «По потребности» — наибольшая длительность в остаток смены и сверхурочные;
 * «только закончить начатое» — ещё и по норме в остаток смены; учёба и проверка знаний — только в смену. Одно правило
 * для раздатчика и прогона расписания (3д).
 */
export function fitsIn(kind: TaskKind, mode: OvertimeMode, room: number, nom: number, max: number, left: number): boolean {
  if (IN_SHIFT.has(kind)) return max <= room;
  if (mode === 'finish' && nom > room) return false;
  return max <= room + left;
}

/** Помещается ли задача у человека сейчас (`fitsIn`): конец его смены — `end`. */
export function fits(db: ContentDb, s: PlantState, p: Person, kind: TaskKind, end: number, nom: number, max: number): boolean {
  return fitsIn(kind, s.policy[db.roles[p.role].dept], end - s.t, nom, max, overLeft(db, s, p, s.t));
}

/** Взял задачу в смену: до конца смены — работа по графику, после — сверхурочная (`endTask`). */
export function startTask(p: Person, end: number) {
  p.until = end;
}

/**
 * Кончил задачу (Б4а): работа после конца смены, в которую он её взял, — сверхурочный отрезок табеля; за год — секунды,
 * по году дня смены.
 */
export function endTask(db: ContentDb, s: PlantState, p: Person) {
  const until = p.until;
  delete p.until;
  if (until === undefined || s.t <= until) return;
  p.ot.push([until, s.t]);
  const y = momentOf(s.start, until - 1).date.y;
  if (p.otYear.y !== y) p.otYear = { y, sec: 0 };
  p.otYear.sec += s.t - until;
  // сменный по циклу (Б4б): в учётный период — итог в его конце
  saAfter(db, s, p, until, s.t);
}

/**
 * Каждый час (Б4а): у кого в этот час кончился сверхурочный отрезок, после которого сверхурочных года осталось меньше
 * предела за смену, — извещение (автопауза поста его отдела).
 */
export function hoursHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  const ot = overtimeOf(db, s);
  for (const p of Object.values(s.people)) {
    const last = p.ot[p.ot.length - 1];
    if (!last || last[1] <= s.t - 3600 || last[1] > s.t) continue;
    const y = momentOf(s.start, last[0] - 1).date.y;
    const after = ot.year - yearOver(p, y);
    const before = after + (last[1] - last[0]);
    if (before >= ot.shift && after < ot.shift) notices.push({ kind: 'overtimeLow', person: p.id, role: p.role, dept: db.roles[p.role].dept, tab: p.tab, left: Math.max(0, after) });
  }
}

/**
 * 1-го числа в полночь (Б4а): сверхурочные отрезки старше начала прошлого месяца больше не нужны — табель окна и
 * зарплата смотрят этот и прошлый месяц, а за год — счётчик.
 */
export function pruneSheet(s: PlantState, day: number) {
  const { y, m } = civilFromDays(day);
  const from = (daysFromCivil(m === 1 ? { y: y - 1, m: 12, d: 1 } : { y, m: m - 1, d: 1 }) - daysFromCivil(s.start)) * DAY;
  for (const p of Object.values(s.people)) p.ot = p.ot.filter(x => x[1] > from);
}

/** Команда «Сверхурочные» (Б4а): политика отдела. */
export function overtimeCommand(s: PlantState, cmd: Extract<Command, { kind: 'overtime' }>, notices: Notice[]) {
  if (!(DEPTS as readonly string[]).includes(cmd.dept) || (cmd.mode !== 'need' && cmd.mode !== 'finish')) return notices.push({ kind: 'refused', cmd: 'overtime', why: 'noDept', detail: cmd.dept });
  s.policy[cmd.dept] = cmd.mode;
}

/**
 * День табеля (Б4а), с: работа, из неё ночью; сверхурочно в рабочий день графика — по первой и по второй ставке (первые
 * часы отрезка после смены — по первой, ст. 152); работа в выходной или праздник (РВ, ст. 153: в сверхурочные не идёт).
 */
export interface SheetDay {
  work: number;
  night: number;
  over: [number, number];
  off: number;
}

const emptyDay = (): SheetDay => ({ work: 0, night: 0, over: [0, 0], off: 0 });

/** Ночных секунд в отрезке [a, b) мгновений — по ночным часам профиля, с полуночи даты начала. */
export function nightIn(db: ContentDb, s: Clock, a: number, b: number): number {
  const n = db.profiles[db.scenarios[s.scenario].profile].payroll.night;
  let sec = 0;
  // ночь — с `from` до `to` следующих суток (или тех же, если ночь не переходит через полночь)
  const d0 = Math.floor(a / DAY) - 1;
  const d1 = Math.floor(b / DAY);
  for (let d = d0; d <= d1; d++) {
    const from = d * DAY + n.from * 3600;
    const to = n.from > n.to ? (d + 1) * DAY + n.to * 3600 : d * DAY + n.to * 3600;
    sec += Math.max(0, Math.min(b, to) - Math.max(a, from));
  }
  return sec;
}

/**
 * Табель человека за дни `z0`–`z1` (Б4а) до мгновения `upTo`, по дню на каждый: смены по его графику с переводами
 * (shifts.ts, Б4б) — работа без перерыва для отдыха и питания (ст. 108) своим календарным дням, ночная — через полночь;
 * из неё ночью; у сменного по циклу часы в праздник — РВ (ст. 153). Смена, которая идёт в `upTo`, — до этого мгновения,
 * перерыв — долей прошедшей смены (где он в смене, завод не знает). Сверхурочные отрезки — своим календарным дням: у
 * пятидневки в её рабочий день — сверхурочно, в выходной или праздник — РВ; у сменного по циклу — сверхурочно, в
 * праздник — РВ. Первая ставка — первые часы отрезка, хоть он и начался до `z0`.
 */
export function sheetDays(db: ContentDb, s: Clock, p: Person, z0: number, z1: number, upTo = Infinity): SheetDay[] {
  const out = Array.from({ length: z1 - z0 + 1 }, emptyDay);
  const cal = calOf(db, s);
  const first = overtimeOf(db, s).first;
  const base = daysFromCivil(s.start);
  for (let z = z0 - 1; z <= z1; z++) {
    const span = spanOn(db, s, p, z);
    if (!span || span[0] >= upTo) continue;
    const sh = db.shifts[scheduleOn(p, z)];
    const end = Math.min(span[1], upTo);
    const len = span[1] - span[0];
    const brk = sh.break > 0 ? Math.floor(((end - span[0]) * sh.break) / len) : 0;
    for (let a = span[0]; a < end; ) {
      const d = Math.floor(a / DAY);
      const b = Math.min(end, (d + 1) * DAY);
      const day = base + d;
      if (day >= z0 && day <= z1) {
        const x = out[day - z0];
        x.work += b - a - (day === z ? brk : 0);
        x.night += nightIn(db, s, a, b);
        if (sh.cycle && isHoliday(cal, day)) x.off += b - a;
      }
      a = b;
    }
  }
  for (const [a0, b0] of p.ot) {
    let done = 0;
    for (let d = Math.floor(a0 / DAY); d * DAY < b0; d++) {
      const a = Math.max(a0, d * DAY);
      const b = Math.min(b0, (d + 1) * DAY);
      const z = base + d;
      const day = z >= z0 && z <= z1 ? out[z - z0] : undefined;
      const sh = db.shifts[scheduleOn(p, z)];
      if (sh.cycle ? !isHoliday(cal, z) : worksOn(cal, sh, z)) {
        const f = Math.max(0, Math.min(b - a, first - done));
        done += b - a;
        if (day) {
          day.over[0] += f;
          day.over[1] += b - a - f;
        }
      } else if (day) day.off += b - a;
      if (day) {
        day.work += b - a;
        day.night += nightIn(db, s, a, b);
      }
    }
  }
  return out;
}
