// Отпуска (Б4г; docs/specs/2026-10-vertical-slice.md, «Б4г»; docs/10-domain.md, §2): ежегодный отпуск в календарных днях
// частями (ст. 115, 120, 125 ТК РФ); график отпусков на календарный год — черновик кадров в декабре по правилу сценария,
// правка постом отдела, утверждение не позже чем за две недели до года (ст. 123); извещение за две недели до начала. В
// дни части у человека нет смен (shifts.ts): работу его роли берут другие люди роли и заместитель — человек со смежной
// профессией роли ушедшего, в свои смены (ст. 60.2; tasks.ts). Деньги — доплата заместителю, отпускные по среднему
// заработку и компенсация при увольнении — cash.ts. График — знание завода: его видят окно и двойник прогона.
import { type ContentDb, DEPTS, type Id, type LeaveRule } from '../content/types';
import { addMonths, civilFromDays, daysFromCivil, HOUR, isHoliday, isWorkday, momentOf, weekday, workdayOnOrAfter, workdayOnOrBefore, type WorkCalendar } from './core/calendar';
import type { Away, Command, Deputy, Notice, Person, PlantState } from './types';
import { calOf, type Clock } from './workdays';

/** Час кадров (гипотеза, как у коллег): черновик, утверждение и извещения — в 09:00 рабочего дня. */
export const LEAVE_HOUR = 9 * HOUR;

/** Правило графика отпусков сценария; нет — отпусков нет. */
export const ruleOf = (db: ContentDb, s: Clock): LeaveRule | undefined => db.scenarios[s.scenario].leave;

/** Числа закона профиля об отпусках (Б4г). */
export const lawOf = (db: ContentDb, s: Clock) => db.profiles[db.scenarios[s.scenario].profile].leave;

const today = (s: PlantState) => momentOf(s.start, s.t).day;

/** Часть отпуска человека, в которой день `z`; нет — `undefined`. Части — по порядку начала. */
export function awayOn(p: Pick<Person, 'away'>, z: number): Away | undefined {
  const list = p.away;
  if (!list) return undefined;
  for (const a of list) {
    if (a.from > z) return undefined;
    if (z <= a.to) return a;
  }
  return undefined;
}

/** Заместитель части в день `z`: прежние — каждый по свой последний день, дальше — нынешний. */
export function deputyOn(a: Away, z: number): string | undefined {
  for (const [who, last] of a.prev ?? []) if (z <= last) return who || undefined;
  return a.deputy;
}

/** Последний день части: `days` календарных дней с `from`, праздник внутри её удлиняет (ст. 120, ч. 1). */
export function partEnd(cal: WorkCalendar, from: number, days: number): number {
  let z = from - 1;
  for (let n = 0; n < days; ) if (!isHoliday(cal, ++z)) n++;
  return z;
}

/**
 * Кого человек замещает в день `z` (раздатчик): заместитель части, которая идёт, сам не в отпуске, — роли ушедших.
 * Заместитель → роли.
 */
export function coversOn(s: PlantState, z: number): Map<string, Id[]> {
  const out = new Map<string, Id[]>();
  for (const p of Object.values(s.people)) {
    const a = awayOn(p, z);
    const d = a && deputyOn(a, z);
    const dp = d ? s.people[d] : undefined;
    if (!dp || awayOn(dp, z)) continue;
    const list = out.get(dp.id);
    if (!list) out.set(dp.id, [p.role]);
    else if (!list.includes(p.role)) list.push(p.role);
  }
  return out;
}

/** Дни замещения (прогон расписания): заместитель → роль ушедшего и дни с и по; части, которые кончились, — нет. */
export function coverWindows(s: PlantState, from: number): Map<string, { role: Id; from: number; to: number }[]> {
  const out = new Map<string, { role: Id; from: number; to: number }[]>();
  const add = (who: string, role: Id, a: number, b: number) => {
    if (!who || b < from || a > b) return;
    const list = out.get(who) ?? [];
    list.push({ role, from: a, to: b });
    out.set(who, list);
  };
  for (const p of Object.values(s.people)) {
    for (const a of p.away ?? []) {
      if (a.to < from) continue;
      let at = a.from;
      for (const [who, last] of a.prev ?? []) {
        add(who, p.role, at, last);
        at = last + 1;
      }
      if (a.deputy) add(a.deputy, p.role, at, a.to);
    }
  }
  return out;
}

// ---------------------------------------------------------------- дни отпуска

/**
 * Право на отпуск за первый год (ст. 122, ч. 2): с дня через `first` месяцев после приёма; люди сценария — с начала
 * завода, их право давно есть.
 */
export function rightOf(db: ContentDb, s: Clock, p: Pick<Person, 'hired'>): number {
  return p.hired === undefined ? 0 : addMonths(p.hired, lawOf(db, s).first);
}

/** Сколько дней дали черновики графиков по год `y` включительно и сколько из них стоит в частях тех же лет. */
function allotted(p: Person, y: number): { given: number; parts: number } {
  let given = 0;
  for (const [yy, d] of p.given ?? []) if (yy <= y) given += d;
  let parts = 0;
  for (const a of p.away ?? []) if (a.y <= y) parts += a.days;
  return { given, parts };
}

/** Остаток дней года графика `y`: данные черновиками по этот год минус части этих лет. */
export function remaining(p: Person, y: number): number {
  const x = allotted(p, y);
  return x.given - x.parts;
}

/** Был ли человек в черновике графика года `y`. */
const givenIn = (p: Person, y: number) => (p.given ?? []).some(([yy]) => yy === y);

/**
 * Заработано дней отпуска по день `z` включительно, сотые дня (Правила 1930 года, пп. 28, 35; сверить): рабочий год — с
 * дня приёма, у людей сценария — с начала завода; за полный год — `days`; за неполный — `days` / 12 за месяц, излишек
 * меньше половины месяца (15 дней, гипотеза) не считают, не меньше — до месяца; `full` месяцев и больше — `days`.
 */
export function earnedDays(db: ContentDb, s: Clock, p: Pick<Person, 'hired'>, z: number): number {
  const law = lawOf(db, s);
  const from = p.hired ?? daysFromCivil(s.start);
  if (z < from) return 0;
  let years = 0;
  while (addMonths(from, 12 * (years + 1)) <= z + 1) years++;
  const at = addMonths(from, 12 * years);
  let months = 0;
  while (months < 12 && addMonths(at, months + 1) <= z + 1) months++;
  if (z + 1 - addMonths(at, months) >= 15) months++;
  const part = months >= law.full ? law.days * 100 : Math.floor((law.days * 100 * months) / 12);
  return years * law.days * 100 + part;
}

/** Использовано дней отпуска к дню `z`, сотые дня: дни частей, которые начались. */
export function usedDays(p: Pick<Person, 'away'>, z: number): number {
  let n = 0;
  for (const a of p.away ?? []) if (a.from <= z) n += a.days * 100;
  return n;
}

/** Дни компенсации при увольнении в последний день `last` (ст. 127), сотые дня: заработано минус использовано, не меньше нуля. */
export function compDays(db: ContentDb, s: Clock, p: Person, last: number): number {
  return Math.max(0, earnedDays(db, s, p, last) - usedDays(p, last));
}

// ---------------------------------------------------------------- черновик

/** Человек черновика: роль, график, табельный номер, смежные профессии; с какого дня ему можно и сколько дней поставить. */
export interface DraftPerson {
  id: string;
  role: Id;
  shift: Id;
  tab: number;
  also?: readonly Id[];
  right: number;
  days: number;
}

/** Часть, которая уже стоит или поставлена черновиком: чья, какой роли, дни с и по, заместитель. */
export interface Placed {
  person: string;
  role: Id;
  from: number;
  to: number;
  deputy?: string;
}

export interface Draft {
  parts: (Placed & { days: number })[];
  /** кому не всем частям нашлось место в году */
  miss: string[];
}

/** Сроки частей года `y`, номера дней: первой — лето, остальных — остальные месяцы срока, без лета. */
function windowsOf(rule: LeaveRule, y: number): [number, number][][] {
  const z = ([m, d]: [number, number]) => daysFromCivil({ y, m, d });
  const [s0, s1] = [z(rule.summer[0]), z(rule.summer[1])];
  const [r0, r1] = [z(rule.rest[0]), z(rule.rest[1])];
  const rest: [number, number][] = [];
  if (r0 <= Math.min(r1, s0 - 1)) rest.push([r0, Math.min(r1, s0 - 1)]);
  if (Math.max(r0, s1 + 1) <= r1) rest.push([Math.max(r0, s1 + 1), r1]);
  return [[[s0, s1]], rest];
}

/** Длины частей по правилу на `days` дней: остаток прошлых лет — к последней части, нехватка — с конца. */
function lengthsOf(rule: LeaveRule, days: number): number[] {
  const out = [...rule.parts];
  out[out.length - 1] += days - out.reduce((n, d) => n + d, 0);
  while (out.length > 0 && out[out.length - 1] <= 0) {
    const x = out.pop()!;
    if (out.length > 0) out[out.length - 1] += x;
  }
  return out;
}

/**
 * Черновик графика года `y` (Б4г; правило сценария — гипотеза): людям `who` — части по правилу с понедельника, первая —
 * в летнем сроке, остальные — в остальные месяцы срока. Порядок — по отделам, ролям и табельным номерам, сначала первые
 * части всех, потом вторые. Часть встаёт на неделю своего срока, где она никому не мешает и на её дни приходится
 * меньше всего дней чужих частей, из равных — на первую; не помещается в срок — на ближайшую такую неделю года; нет
 * и её — человек в «не помещается». Мешает: часть человека той же роли (в любых сменах), часть того, у кого он
 * заместитель, больше `dept` человек отдела сразу. Неделя, где роли, которую есть кому замещать, нашёлся свободный
 * заместитель, — раньше недели без него. Заместитель — первый по табельному номеру из людей `all` со смежной
 * профессией роли, из той же смены, если есть, сам в эти дни не в отпуске и не заместитель другого. `busy` — части,
 * которые уже стоят. Чистая функция: её зовут кадры и сборщик базы (стартовый штат помещается весь).
 */
export function placeDraft(db: ContentDb, s: Clock, y: number, who: readonly DraftPerson[], all: readonly DraftPerson[], busy: readonly Placed[]): Draft {
  const rule = ruleOf(db, s)!;
  const cal = calOf(db, s);
  const dept = (r: Id) => db.roles[r].dept;
  const order = [...who].sort((a, b) => DEPTS.indexOf(dept(a.role)) - DEPTS.indexOf(dept(b.role)) || (a.role < b.role ? -1 : a.role > b.role ? 1 : 0) || a.tab - b.tab);
  const placed: Placed[] = [...busy];
  const out: Draft = { parts: [], miss: [] };
  const [summer, rest] = windowsOf(rule, y);
  const y0 = daysFromCivil({ y, m: 1, d: 1 });
  const y1 = daysFromCivil({ y, m: 12, d: 31 });
  const lens = new Map(order.map(p => [p.id, lengthsOf(rule, p.days)]));
  const rounds = Math.max(0, ...[...lens.values()].map(l => l.length));
  const overlap = (q: Placed, f: number, t: number) => q.from <= t && q.to >= f;
  const clash = (p: DraftPerson, f: number, t: number): boolean => {
    for (const q of placed) if (overlap(q, f, t) && (q.person === p.id || q.role === p.role || q.deputy === p.id)) return true;
    const d = dept(p.role);
    for (let z = f; z <= t; z++) {
      let n = 1;
      for (const q of placed) if (q.from <= z && z <= q.to && dept(q.role) === d) n++;
      if (n > rule.dept) return true;
    }
    return false;
  };
  const load = (f: number, t: number) => placed.reduce((n, q) => n + Math.max(0, Math.min(t, q.to) - Math.max(f, q.from) + 1), 0);
  const deputyFor = (p: DraftPerson, f: number, t: number): string | undefined | null => {
    if (db.roles[p.role].same) return undefined;
    const cands = all.filter(q => q.id !== p.id && q.also?.includes(p.role)).sort((a, b) => Number(a.shift !== p.shift) - Number(b.shift !== p.shift) || a.tab - b.tab);
    if (cands.length === 0) return undefined;
    for (const q of cands) if (!placed.some(x => overlap(x, f, t) && (x.person === q.id || x.deputy === q.id))) return q.id;
    return null;
  };
  /** Понедельники `from`–`to`, с которых часть длиной `len` целиком лежит в этих днях и начинается не раньше права. */
  const mondays = (p: DraftPerson, len: number, from: number, to: number): [number, number][] => {
    const out: [number, number][] = [];
    let m = Math.max(from, p.right);
    m += (7 - weekday(m)) % 7;
    for (; m <= to; m += 7) {
      const end = partEnd(cal, m, len);
      if (end <= to) out.push([m, end]);
    }
    return out;
  };
  const place = (p: DraftPerson, len: number, win: [number, number][]): Placed | undefined => {
    const inWin = win.flatMap(([a, b]) => mondays(p, len, a, b));
    const dist = (m: number) => Math.min(...win.map(([a, b]) => (m < a ? a - m : m > b ? m - b : 0)));
    const year = mondays(p, len, y0, y1).sort((a, b) => dist(a[0]) - dist(b[0]) || a[0] - b[0]);
    for (const strict of [true, false]) {
      let best: { at: [number, number]; d?: string; n: number } | undefined;
      for (const at of inWin) {
        if (clash(p, at[0], at[1])) continue;
        const d = deputyFor(p, at[0], at[1]);
        if (d === null && strict) continue;
        const n = load(at[0], at[1]);
        if (!best || n < best.n) best = { at, n, ...(d ? { d } : {}) };
      }
      if (!best) {
        for (const at of year) {
          if (clash(p, at[0], at[1])) continue;
          const d = deputyFor(p, at[0], at[1]);
          if (d === null && strict) continue;
          best = { at, n: 0, ...(d ? { d } : {}) };
          break;
        }
      }
      if (best) return { person: p.id, role: p.role, from: best.at[0], to: best.at[1], ...(best.d ? { deputy: best.d } : {}) };
    }
    return undefined;
  };
  for (let k = 0; k < rounds; k++) {
    for (const p of order) {
      const len = lens.get(p.id)![k];
      if (len === undefined) continue;
      const got = place(p, len, k === 0 ? summer : rest);
      if (got) {
        placed.push(got);
        out.parts.push({ ...got, days: len });
      } else if (!out.miss.includes(p.id)) out.miss.push(p.id);
    }
  }
  return out;
}

/** Части людей завода, которые задевают год `y`: мешают черновику. */
function busyIn(s: PlantState, y: number): Placed[] {
  const y0 = daysFromCivil({ y, m: 1, d: 1 });
  const y1 = daysFromCivil({ y, m: 12, d: 31 });
  const out: Placed[] = [];
  for (const p of Object.values(s.people)) for (const a of p.away ?? []) if (a.from <= y1 && a.to >= y0) out.push({ person: p.id, role: p.role, from: a.from, to: a.to, ...(a.deputy ? { deputy: a.deputy } : {}) });
  return out;
}

/** Человек черновика года `y`: дни — по закону и остаток прошлых лет. */
function draftPerson(db: ContentDb, s: PlantState, p: Person, y: number): DraftPerson {
  return { id: p.id, role: p.role, shift: p.shift, tab: p.tab, ...(p.also ? { also: p.also } : {}), right: rightOf(db, s, p), days: lawOf(db, s).days + remaining(p, y - 1) };
}

/** Новая часть отпуска: по порядку начала. */
function addPart(s: PlantState, p: Person, y: number, from: number, days: number, to: number, deputy?: string): Away {
  // свой счёт `A`: у партий — `L`
  const a: Away = { id: `A${(s.next.A = (s.next.A ?? 0) + 1)}`, y, from, to, days, ...(deputy ? { deputy } : {}) };
  const list = (p.away ??= []);
  let i = list.length;
  while (i > 0 && list[i - 1].from > from) i--;
  list.splice(i, 0, a);
  return a;
}

/** Поставить части черновика людям; дни по закону — в данные черновиком года. */
function putDraft(db: ContentDb, s: PlantState, y: number, people: readonly Person[], d: Draft) {
  for (const x of d.parts) addPart(s, s.people[x.person], y, x.from, x.days, x.to, x.deputy);
  for (const p of people) (p.given ??= []).push([y, lawOf(db, s).days]);
}

/** Черновик графика года `y` (кадры, 09:00): все люди завода, кроме уходящих. */
function draftYear(db: ContentDb, s: PlantState, y: number, notices: Notice[]) {
  const people = Object.values(s.people).filter(p => !p.quit && !givenIn(p, y));
  const dps = people.map(p => draftPerson(db, s, p, y));
  const all = Object.values(s.people).filter(p => !p.quit).map(p => draftPerson(db, s, p, y));
  const d = placeDraft(db, s, y, dps, all, busyIn(s, y));
  putDraft(db, s, y, people, d);
  s.leave[y] = { st: 'draft', ...(d.miss.length > 0 ? { miss: d.miss } : {}) };
  notices.push({ kind: 'leaveDraft', y, miss: d.miss.length });
}

/**
 * Утверждение графика года `y` (ст. 123): обязателен и заводу, и людям. Принятые после черновика — в график по тому же
 * правилу; принятых после утверждения в графике года нет — их дни переходят в черновик следующего.
 */
function approveYear(db: ContentDb, s: PlantState, y: number, notices: Notice[]) {
  const fresh = Object.values(s.people).filter(p => !p.quit && !givenIn(p, y));
  const yr = s.leave[y];
  if (fresh.length > 0) {
    const all = Object.values(s.people).filter(p => !p.quit).map(p => draftPerson(db, s, p, y));
    const d = placeDraft(db, s, y, fresh.map(p => draftPerson(db, s, p, y)), all, busyIn(s, y));
    putDraft(db, s, y, fresh, d);
    const miss = [...(yr.miss ?? []), ...d.miss];
    if (miss.length > 0) yr.miss = miss;
  }
  yr.st = 'approved';
  notices.push({ kind: 'leaveApproved', y });
}

/** День черновика года `y`: первый рабочий не раньше дня правила, в прошлом году. */
export function draftDay(db: ContentDb, s: Clock, y: number): number {
  const [m, d] = ruleOf(db, s)!.draft;
  return workdayOnOrAfter(calOf(db, s), daysFromCivil({ y: y - 1, m, d }));
}

/** День утверждения графика года `y`: последний рабочий не позже дня правила, в прошлом году. */
export function approveDay(db: ContentDb, s: Clock, y: number): number {
  const [m, d] = ruleOf(db, s)!.approve;
  return workdayOnOrBefore(calOf(db, s), daysFromCivil({ y: y - 1, m, d }));
}

/** День извещения о части: последний рабочий не позже чем за срок закона до начала (ст. 123, ч. 3). */
export function noticeDay(db: ContentDb, s: Clock, a: Pick<Away, 'from'>): number {
  return workdayOnOrBefore(calOf(db, s), a.from - lawOf(db, s).notice);
}

/** Заместитель для извещения: человек, роль, табельный номер. */
function deputyOf(s: PlantState, id: string | undefined): { deputy?: Deputy } {
  const d = id ? s.people[id] : undefined;
  return d ? { deputy: { person: d.id, role: d.role, tab: d.tab } } : {};
}

/** Извещение под роспись: в игре — извещение и строка планёрки. */
function tell(s: PlantState, p: Person, a: Away, notices: Notice[]) {
  a.told = true;
  notices.push({ kind: 'leaveNotice', person: p.id, role: p.role, tab: p.tab, from: a.from, to: a.to, ...deputyOf(s, a.deputy) });
}

/**
 * Каждый час (Б4г): в полночь — кто вышел из отпуска и кто ушёл в него; в 09:00 рабочего дня — черновик следующего года,
 * когда его день настал (сохранение старой схемы — в ближайшие 09:00), утверждение в свой день — или сразу, если тот
 * прошёл, — и извещения за срок закона до начала. Отпускные — в час банка (cash.ts).
 */
export function leaveHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  if (!ruleOf(db, s)) return;
  const now = momentOf(s.start, s.t);
  const z = now.day;
  if (now.sec === 0) {
    for (const p of Object.values(s.people)) for (const a of p.away ?? []) if (a.to === z - 1) notices.push({ kind: 'leaveEnd', person: p.id, role: p.role, tab: p.tab });
    for (const p of Object.values(s.people)) {
      for (const a of p.away ?? []) {
        if (a.from !== z) continue;
        notices.push({ kind: 'leaveStart', person: p.id, role: p.role, tab: p.tab, to: a.to, ...deputyOf(s, deputyOn(a, z)) });
      }
    }
  }
  if (now.sec !== LEAVE_HOUR || !isWorkday(calOf(db, s), z)) return;
  const y = now.date.y + 1;
  if (!s.leave[y] && z >= draftDay(db, s, y)) draftYear(db, s, y, notices);
  if (s.leave[y]?.st === 'draft' && z >= approveDay(db, s, y)) approveYear(db, s, y, notices);
  for (const p of Object.values(s.people)) {
    for (const a of p.away ?? []) if (!a.told && a.from > z && s.leave[a.y]?.st === 'approved' && noticeDay(db, s, a) <= z) tell(s, p, a, notices);
  }
}

// ---------------------------------------------------------------- заместители

/** Свободен ли человек в дни `f`–`t`: сам не в отпуске и не заместитель другой части (кроме `except`). */
export function deputyFree(s: PlantState, who: string, f: number, t: number, except?: string): boolean {
  const d = s.people[who];
  if (!d || d.away?.some(a => a.from <= t && a.to >= f)) return false;
  for (const p of Object.values(s.people)) for (const a of p.away ?? []) if (a.id !== except && a.deputy === who && a.from <= t && a.to >= f) return false;
  return true;
}

/**
 * Заместитель части по правилу (кадры): первый по табельному номеру человек со смежной профессией роли ушедшего, из той
 * же смены, если есть, не уходящий, свободный в дни `f`–`a.to`; роль заменяет только человек той же роли — никого.
 */
export function pickDeputy(db: ContentDb, s: PlantState, p: Person, a: Away, f: number): string | undefined {
  if (db.roles[p.role].same) return undefined;
  const cands = Object.values(s.people)
    .filter(q => q.id !== p.id && !q.quit && q.also?.includes(p.role))
    .sort((x, y) => Number(x.shift !== p.shift) - Number(y.shift !== p.shift) || x.tab - y.tab);
  return cands.find(q => deputyFree(s, q.id, f, a.to, a.id))?.id;
}

/** Сменить заместителя части с дня `from`: до него — прежний (история, для доплаты), с него — новый. */
function setDeputy(a: Away, who: string | undefined, from: number) {
  if (from <= a.from) {
    delete a.prev;
    if (who) a.deputy = who;
    else delete a.deputy;
    return;
  }
  const start = a.prev?.length ? a.prev[a.prev.length - 1][1] + 1 : a.from;
  if (from - 1 >= start && (a.deputy ?? '') !== who) (a.prev ??= []).push([a.deputy ?? '', from - 1]);
  if (who) a.deputy = who;
  else delete a.deputy;
}

/**
 * Заместитель уходит с завода или больше не замещает роль (снял смежную профессию): у частей, где он заместитель (роли
 * `role`, нет — любой) и которые ещё идут, — следующий по правилу с дня `from`, нет такого — часть без заместителя.
 */
export function deputyGone(db: ContentDb, s: PlantState, who: string, from: number, role?: Id) {
  for (const p of Object.values(s.people)) {
    if (p.id === who || (role && p.role !== role)) continue;
    for (const a of p.away ?? []) {
      if (a.deputy !== who || a.to < from) continue;
      const f = Math.max(a.from, from);
      setDeputy(a, undefined, f);
      setDeputy(a, pickDeputy(db, s, p, a, f), f);
    }
  }
}

/**
 * Последний день уходящего (Б4в): части после него снимаются; часть, в которой он, кончается им — её дни оплачены
 * отпускными, использованы (cash.ts, компенсация).
 */
export function dropAfter(p: Person, last: number) {
  if (!p.away) return;
  p.away = p.away.filter(a => a.from <= last);
  for (const a of p.away) {
    if (a.to <= last) continue;
    // заместитель последнего дня — нынешний, прежние, что кончили раньше, — история
    const d = deputyOn(a, last);
    a.to = last;
    a.prev = a.prev?.filter(([, l]) => l < last);
    if (!a.prev?.length) delete a.prev;
    if (d) a.deputy = d;
    else delete a.deputy;
  }
  if (p.away.length === 0) delete p.away;
}

// ---------------------------------------------------------------- команда

/**
 * Команда «часть отпуска» (Б4г): добавить, перенести, убрать, сменить заместителя. До утверждения графика года — правка
 * черновика: части целыми днями, одна — не короче части закона, вместе — дни года и остаток; убрать можно. После
 * утверждения — по соглашению (ст. 123, 124; человек согласен всегда — гипотеза до настроения, §8.2): добавить или
 * перенести, прежнее и новое начало — не раньше чем через срок извещения; убрать нельзя. Часть, которая началась, не
 * переносят и не убирают; заместитель — со смежной профессией роли, сам в эти дни не в отпуске и не заместитель другой
 * части; у начатой части новый — с сегодня.
 */
export function leaveCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'leave' }>, notices: Notice[]) {
  const refuse = (why: Extract<Notice, { kind: 'refused' }>['why'], detail?: string) => notices.push({ kind: 'refused', cmd: 'leave', why, ...(detail ? { detail } : {}) });
  if (!ruleOf(db, s)) return refuse('noLeave');
  const p = s.people[cmd.person];
  if (!p) return refuse('noPerson', cmd.person);
  const law = lawOf(db, s);
  const cal = calOf(db, s);
  const z = today(s);
  const own = (from: number, to: number, except?: string) => (p.away ?? []).some(a => a.id !== except && a.from <= to && a.to >= from);
  const longOne = (y: number, except?: string) => (p.away ?? []).some(a => a.y === y && a.id !== except && a.days >= law.part);
  if (cmd.op === 'add') {
    if (!Number.isInteger(cmd.from) || !Number.isInteger(cmd.days) || cmd.days < 1) return refuse('leaveDays');
    const y = civilFromDays(cmd.from).y;
    const yr = s.leave[y];
    if (!yr) return refuse('leaveYear');
    if (cmd.days > remaining(p, y)) return refuse('leaveDays');
    if (cmd.days < law.part && !longOne(y)) return refuse('leaveShort');
    if (cmd.from < rightOf(db, s, p)) return refuse('leaveRight');
    if (cmd.from <= z || (yr.st === 'approved' && cmd.from < z + law.notice)) return refuse('leaveSoon');
    const to = partEnd(cal, cmd.from, cmd.days);
    if (own(cmd.from, to)) return refuse('leaveOverlap');
    const a = addPart(s, p, y, cmd.from, cmd.days, to);
    setDeputy(a, pickDeputy(db, s, p, a, a.from), a.from);
    if (yr.st === 'approved' && noticeDay(db, s, a) <= z) tell(s, p, a, notices);
    return;
  }
  const a = p.away?.find(x => x.id === cmd.part);
  if (!a) return refuse('noAway', cmd.part);
  const yr = s.leave[a.y];
  switch (cmd.op) {
    case 'move': {
      if (a.from <= z) return refuse('leaveStarted');
      if (!Number.isInteger(cmd.from) || civilFromDays(cmd.from).y !== a.y) return refuse('leaveYear');
      if (cmd.from < rightOf(db, s, p)) return refuse('leaveRight');
      if (cmd.from <= z || (yr?.st === 'approved' && (a.from < z + law.notice || cmd.from < z + law.notice))) return refuse('leaveSoon');
      const to = partEnd(cal, cmd.from, a.days);
      if (own(cmd.from, to, a.id)) return refuse('leaveOverlap');
      a.from = cmd.from;
      a.to = to;
      delete a.told;
      p.away!.sort((x, y) => x.from - y.from);
      // заместитель остаётся, если свободен в новые дни, иначе — по правилу
      const keep = a.deputy && deputyFree(s, a.deputy, a.from, a.to, a.id) ? a.deputy : undefined;
      setDeputy(a, keep ?? pickDeputy(db, s, p, a, a.from), a.from);
      if (yr?.st === 'approved' && noticeDay(db, s, a) <= z) tell(s, p, a, notices);
      return;
    }
    case 'drop': {
      if (a.from <= z) return refuse('leaveStarted');
      if (yr?.st === 'approved') return refuse('leaveApproved');
      const rest = (p.away ?? []).filter(x => x.y === a.y && x.id !== a.id);
      if (rest.length > 0 && !longOne(a.y, a.id)) return refuse('leaveShort');
      p.away!.splice(p.away!.indexOf(a), 1);
      if (p.away!.length === 0) delete p.away;
      return;
    }
    case 'deputy': {
      if (a.to < z) return refuse('leaveStarted');
      const f = Math.max(a.from, z);
      if (cmd.deputy !== undefined) {
        const d = s.people[cmd.deputy];
        if (!d || d.id === p.id || db.roles[p.role].same || !d.also?.includes(p.role) || !deputyFree(s, d.id, f, a.to, a.id)) return refuse('noDeputy', cmd.deputy);
      }
      setDeputy(a, cmd.deputy, f);
      return;
    }
  }
}
