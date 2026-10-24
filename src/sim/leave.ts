// График отпусков для видов окна (Б4г; docs/specs/2026-10-vertical-slice.md, «Б4г»): части людей этого и следующего
// года — черновик или утверждён, заместители, что мешает; дни отпуска человека — заработано, использовано, осталось;
// кто в отпуске и кто кого замещает; планёрка «Люди». Всё — записи завода: график, извещения, отпускные.
import type { ContentDb, Dept, Id } from '../content/types';
import { momentOf } from '../engine/core/calendar';
import { approveDay, awayOn, deputyFree, deputyOn, draftDay, earnedDays, lawOf, remaining, rightOf, ruleOf, usedDays } from '../engine/leave';
import type { Away, Person, PlantState } from '../engine/types';

/**
 * Что мешает части: в те же дни в отпуске человек той же роли; заместитель сам в отпуске; без заместителя, а работу роли
 * взять некому — других людей роли нет; из отдела в отпуске больше, чем по правилу.
 */
export type LeaveProblem = 'role' | 'deputyAway' | 'noDeputy' | 'dept';

/** Человек для слов: номер, как в срезе, роль и табельный номер. */
export interface Who {
  n: number;
  role: Id;
  tab: number;
}

/**
 * Часть отпуска: год графика, дни с и по, дней; заместитель; кто ещё свободен в заместители в её дни; извещён ли,
 * отпускные, началась, кончилась; что ей мешает.
 */
export interface PartRow {
  id: string;
  y: number;
  from: number;
  to: number;
  days: number;
  deputy?: Who;
  can: Who[];
  told: boolean;
  paid?: number;
  started: boolean;
  ended: boolean;
  problems: LeaveProblem[];
}

/**
 * Человек в графике: дни отпуска, сотые дня, — заработано, использовано и осталось к сегодня; остаток дней по годам
 * графиков; части; не поместился в черновик; с какого дня право за первый год.
 */
export interface LeavePerson {
  person: number;
  tab: number;
  role: Id;
  shift: Id;
  dept: Dept;
  also?: Id[];
  earned: number;
  used: number;
  left: [number, number][];
  parts: PartRow[];
  miss: boolean;
  right?: number;
}

/** Год графика: черновик или утверждён (нет — ещё не составлен), дни черновика и утверждения, кто не поместился. */
export interface LeaveYearRow {
  y: number;
  st?: 'draft' | 'approved';
  draft: number;
  approve: number;
  miss: number[];
}

/**
 * График отпусков (справочник, «Люди»): годы — этот и следующий, люди по отделам, ролям и табельным номерам; числа закона
 * — дней за год, наименьшая часть, срок извещения и отпускных; правило черновика — части, из отдела сразу, доплата.
 */
export interface LeaveView {
  today: number;
  years: LeaveYearRow[];
  people: LeavePerson[];
  law: { days: number; part: number; notice: number; pay: number };
  rule: { parts: number[]; dept: number; cover: number };
}

const num = (id: string) => Number(id.slice(1));
const who = (p: Person): Who => ({ n: num(p.id), role: p.role, tab: p.tab });

/** Что мешает части `a` человека `p` среди людей завода. */
export function problemsOf(db: ContentDb, s: PlantState, p: Person, a: Away): LeaveProblem[] {
  const rule = ruleOf(db, s);
  if (!rule) return [];
  const out: LeaveProblem[] = [];
  const people = Object.values(s.people);
  const over = (x: Away) => x.from <= a.to && x.to >= a.from;
  if (people.some(q => q.id !== p.id && q.role === p.role && q.away?.some(over))) out.push('role');
  if (a.deputy && s.people[a.deputy]?.away?.some(over)) out.push('deputyAway');
  if (!a.deputy && !people.some(q => q.id !== p.id && q.role === p.role)) out.push('noDeputy');
  const dept = db.roles[p.role].dept;
  for (let z = a.from; z <= a.to; z++) {
    if (people.filter(q => db.roles[q.role].dept === dept && awayOn(q, z)).length > rule.dept) {
      out.push('dept');
      break;
    }
  }
  return out;
}

function partRow(db: ContentDb, s: PlantState, p: Person, a: Away, today: number): PartRow {
  const d = deputyOn(a, Math.max(a.from, Math.min(today, a.to)));
  const dp = d ? (s.people[d] ?? s.former[d]) : undefined;
  const can = a.to < today || db.roles[p.role].same ? [] : deputiesOf(s, p).filter(q => q.id !== a.deputy && deputyFree(s, q.id, Math.max(a.from, today), a.to, a.id));
  return {
    id: a.id,
    y: a.y,
    from: a.from,
    to: a.to,
    days: a.days,
    ...(dp ? { deputy: who(dp) } : {}),
    can: can.map(who),
    told: !!a.told,
    ...(a.paid !== undefined ? { paid: a.paid } : {}),
    started: a.from <= today,
    ended: a.to < today,
    problems: problemsOf(db, s, p, a),
  };
}

/** Кто годится в заместители роли человека: со смежной профессией этой роли, не уходящий, по табельным номерам. */
function deputiesOf(s: PlantState, p: Person): Person[] {
  return Object.values(s.people)
    .filter(q => q.id !== p.id && !q.quit && q.also?.includes(p.role))
    .sort((x, y) => x.tab - y.tab);
}

/** Человек в графике: дни, части этого и следующего года и тех, что ещё идут. */
export function leavePerson(db: ContentDb, s: PlantState, p: Person): LeavePerson {
  const today = momentOf(s.start, s.t).day;
  const y = momentOf(s.start, s.t).date.y;
  const years = [y, y + 1].filter(yy => s.leave[yy]);
  const right = rightOf(db, s, p);
  return {
    person: num(p.id),
    tab: p.tab,
    role: p.role,
    shift: p.shift,
    dept: db.roles[p.role].dept,
    ...(p.also ? { also: [...p.also] } : {}),
    earned: earnedDays(db, s, p, today),
    used: usedDays(p, today),
    left: years.map(yy => [yy, remaining(p, yy)] as [number, number]),
    parts: (p.away ?? []).filter(a => a.y >= y || a.to >= today).map(a => partRow(db, s, p, a, today)),
    miss: years.some(yy => s.leave[yy]?.miss?.includes(p.id)),
    ...(right > today ? { right } : {}),
  };
}

export function leaveView(db: ContentDb, s: PlantState): LeaveView | undefined {
  if (!ruleOf(db, s)) return undefined;
  const today = momentOf(s.start, s.t).day;
  const y = momentOf(s.start, s.t).date.y;
  const law = lawOf(db, s);
  const rule = ruleOf(db, s)!;
  const order = ['wms', 'qc', 'qa', 'mes', 'line', 'maint'];
  const people = Object.values(s.people)
    .map(p => leavePerson(db, s, p))
    .sort((a, b) => order.indexOf(a.dept) - order.indexOf(b.dept) || (a.role < b.role ? -1 : a.role > b.role ? 1 : 0) || a.tab - b.tab);
  const years = [y, y + 1].map(yy => {
    const r = s.leave[yy];
    return { y: yy, ...(r ? { st: r.st } : {}), draft: draftDay(db, s, yy), approve: approveDay(db, s, yy), miss: (r?.miss ?? []).filter(id => s.people[id]).map(num) };
  });
  return { today, years, people, law: { days: law.days, part: law.part, notice: law.notice, pay: law.pay }, rule: { parts: [...rule.parts], dept: rule.dept, cover: rule.cover } };
}

/**
 * В карточке человека (Б4г): сегодня, годы графиков — черновик или утверждён; его график, в отпуске ли и кто замещает,
 * кого замещает он, какие ещё смежные профессии можно.
 */
export interface PersonLeave {
  today: number;
  years: { y: number; st?: 'draft' | 'approved' }[];
  plan: LeavePerson;
  away?: { to: number; deputy?: Who };
  covers: (Who & { to: number })[];
  alsoCan: Id[];
}

export function personLeave(db: ContentDb, s: PlantState, p: Person): PersonLeave | undefined {
  if (!ruleOf(db, s)) return undefined;
  const today = momentOf(s.start, s.t).day;
  const a = awayOn(p, today);
  const d = a && deputyOn(a, today);
  const dp = d ? s.people[d] : undefined;
  const covers: PersonLeave['covers'] = [];
  for (const q of Object.values(s.people)) {
    const x = awayOn(q, today);
    if (x && deputyOn(x, today) === p.id) covers.push({ ...who(q), to: x.to });
  }
  const alsoCan = Object.keys(db.roles).filter(r => r !== p.role && !db.roles[r].same && !p.also?.includes(r) && db.scenarios[s.scenario].staff.some(x => x.role === r));
  const y = momentOf(s.start, s.t).date.y;
  const years = [y, y + 1].map(yy => ({ y: yy, ...(s.leave[yy] ? { st: s.leave[yy].st } : {}) }));
  return { today, years, plan: leavePerson(db, s, p), ...(a ? { away: { to: a.to, ...(dp ? { deputy: who(dp) } : {}) } } : {}), covers, alsoCan };
}

/**
 * Планёрка, «Люди» (Б4г): кто в отпуске и по какой день, с заместителем; кто уходит в ближайшие 14 суток и кто его
 * заместит; кто выходит в ближайшие 7 суток; черновик графика — пока не утверждён: сколько частей с помехами и сколько
 * людей не поместилось.
 */
export interface LeaveMeeting {
  away: (Who & { to: number; deputy?: Who })[];
  going: (Who & { from: number; to: number; deputy?: Who })[];
  back: (Who & { day: number })[];
  draft?: { y: number; approve: number; problems: number; miss: number };
}

export function leaveMeeting(db: ContentDb, s: PlantState): LeaveMeeting | undefined {
  if (!ruleOf(db, s)) return undefined;
  const today = momentOf(s.start, s.t).day;
  const out: LeaveMeeting = { away: [], going: [], back: [] };
  for (const p of Object.values(s.people)) {
    const me = who(p);
    for (const a of p.away ?? []) {
      const d = deputyOn(a, Math.max(a.from, today));
      const dp = d ? s.people[d] : undefined;
      const dep = dp ? { deputy: who(dp) } : {};
      if (a.from <= today && today <= a.to) out.away.push({ ...me, to: a.to, ...dep });
      else if (a.from > today && a.from <= today + 14) out.going.push({ ...me, from: a.from, to: a.to, ...dep });
      if (a.to >= today - 1 && a.to < today + 7) out.back.push({ ...me, day: a.to + 1 });
    }
  }
  out.going.sort((a, b) => a.from - b.from || a.tab - b.tab);
  out.back.sort((a, b) => a.day - b.day || a.tab - b.tab);
  const y = momentOf(s.start, s.t).date.y + 1;
  const r = s.leave[y];
  if (r?.st === 'draft') {
    let problems = 0;
    for (const p of Object.values(s.people)) for (const a of p.away ?? []) if (a.y === y && problemsOf(db, s, p, a).length > 0) problems++;
    out.draft = { y, approve: approveDay(db, s, y), problems, miss: (r.miss ?? []).filter(id => s.people[id]).length };
  }
  return out;
}

