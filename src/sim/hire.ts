// Найм и увольнение для видов окна (Б4в; docs/specs/2026-10-vertical-slice.md, «Б4в»): штат — по сценарию и сейчас, с
// принятыми до первого дня и уходящими; вакансии с кандидатами; уволенные; сводка планёрки «Люди». Всё — записи завода:
// кандидат известен таким, каким пришёл, — навык, ожидание оклада, срок поиска; заявления видны с дня подачи.
import type { ContentDb, Id } from '../content/types';
import { DAY, daysFromCivil, momentOf } from '../engine/core/calendar';
import { agencyFee, hireDays, laborOf } from '../engine/hire';
import type { PlantState, Quit } from '../engine/types';

/** Штат: роль и график — людей по сценарию, сейчас, принятых до первого дня и уходящих. */
export interface StaffRow {
  role: Id;
  shift: Id;
  plan: number;
  now: number;
  coming: number;
  leaving: number;
}

export interface CandidateRow {
  id: string;
  via: 'ad' | 'agency';
  skill: number;
  /** ожидание оклада, копейки в месяц */
  salary: number;
  /** последний день поиска работы */
  until: number;
  /** кандидат агентства: плата агентству, если принять, копейки */
  fee?: number;
}

export interface VacancyRow {
  id: string;
  role: Id;
  shift: Id;
  via: 'ad' | 'agency';
  from: number;
  by?: 'colleague';
  /** открыта на место человека, подавшего заявление: его табельный номер */
  instead?: number;
  /** агентство: день, когда пришлёт следующего кандидата */
  next?: number;
  /** если принять сегодня: заключение медосмотра и первый день */
  exam: number;
  first?: number;
  candidates: CandidateRow[];
}

/** Принятый до первого дня: медосмотр до дня `exam`, первый день — `day`, испытание — месяцев. */
export interface HireRow {
  id: string;
  role: Id;
  shift: Id;
  skill: number;
  salary: number;
  exam: number;
  day: number;
  trial: number;
}

export interface FormerRow {
  person: number;
  tab: number;
  role: Id;
  shift: Id;
  hired?: number;
  why: Quit['why'];
  last: number;
}

/**
 * Найм (Б4в): штат, вакансии, принятые, уволенные; уровень оплаты по ролям рынка, копейки; испытание по умолчанию и
 * предел закона, месяцев; выплата по соглашению — доли 1/10 000 оклада; цены — объявление за неделю, медосмотр, доля
 * агентства.
 */
export interface HiringView {
  staff: StaffRow[];
  vacancies: VacancyRow[];
  hires: HireRow[];
  former: FormerRow[];
  levels: { role: Id; salary: number }[];
  probation: number;
  law: number;
  agree: number;
  costs: { ad: number; medical: number; agency: number; days: [number, number] };
}

const num = (id: string) => Number(id.slice(1));

export function hiringView(db: ContentDb, s: PlantState): HiringView | undefined {
  const lab = laborOf(db, s);
  if (!lab) return undefined;
  const sc = db.scenarios[s.scenario];
  const rows = new Map<string, StaffRow>();
  const row = (role: Id, shift: Id) => {
    const k = `${role}@${shift}`;
    let r = rows.get(k);
    if (!r) rows.set(k, (r = { role, shift, plan: 0, now: 0, coming: 0, leaving: 0 }));
    return r;
  };
  for (const x of sc.staff) row(x.role, x.shift).plan += x.n;
  for (const p of Object.values(s.people)) {
    const r = row(p.role, p.shift);
    r.now++;
    if (p.quit) r.leaving++;
  }
  for (const h of Object.values(s.hires)) row(h.role, h.shift).coming++;
  const day0 = daysFromCivil(s.start);
  const vacancies = Object.values(s.vacancies).map(v => {
    const { exam, first } = hireDays(db, s, v.shift);
    const instead = v.instead ? (s.people[v.instead] ?? s.former[v.instead]) : undefined;
    return {
      id: v.id,
      role: v.role,
      shift: v.shift,
      via: v.via,
      from: v.from,
      ...(v.by ? { by: v.by } : {}),
      ...(instead ? { instead: instead.tab } : {}),
      ...(v.via === 'agency' && v.next !== undefined ? { next: day0 + Math.floor(v.next / DAY) } : {}),
      exam,
      ...(first ? { first: first.day } : {}),
      candidates: Object.values(s.candidates)
        .filter(c => c.vacancy === v.id)
        .map(c => ({ id: c.id, via: c.via, skill: c.skill, salary: c.salary, until: c.until, ...(c.via === 'agency' ? { fee: agencyFee(lab, c.salary) } : {}) })),
    };
  });
  const hires = Object.values(s.hires).map(h => ({ id: h.id, role: h.role, shift: h.shift, skill: h.skill, salary: h.salary, exam: h.exam, day: h.day, trial: h.trial }));
  const former = Object.values(s.former).map(p => ({ person: num(p.id), tab: p.tab, role: p.role, shift: p.shift, ...(p.hired !== undefined ? { hired: p.hired } : {}), why: p.quit!.why, last: p.quit!.last }));
  const levels = Object.keys(lab.roles).map(role => ({ role, salary: db.roles[role].salary }));
  const law = db.profiles[sc.profile].labor.probation;
  return { staff: [...rows.values()], vacancies, hires, former, levels, probation: lab.probation, law, agree: lab.agree, costs: { ad: lab.ad, medical: lab.medical.price, agency: lab.agency.share, days: [...lab.agency.days] as [number, number] } };
}

/**
 * Планёрка, «Люди» (Б4в): кто выходит и кто уходит в ближайшие 7 суток, заявления за сутки, испытания, которые кончаются
 * за 7 суток, новые кандидаты по вакансиям за сутки.
 */
export interface PeopleMeeting {
  coming: { id: string; role: Id; shift: Id; day: number }[];
  leaving: { person: number; tab: number; role: Id; why: Quit['why']; last: number }[];
  resigned: { person: number; tab: number; role: Id; shift: Id; last: number; vacancy?: string }[];
  trials: { person: number; tab: number; role: Id; last: number }[];
  candidates: { vacancy: string; role: Id; n: number }[];
}

export function peopleMeeting(s: PlantState): PeopleMeeting {
  const today = momentOf(s.start, s.t).day;
  const week = today + 7;
  const people = Object.values(s.people);
  const coming = Object.values(s.hires)
    .filter(h => h.day <= week)
    .map(h => ({ id: h.id, role: h.role, shift: h.shift, day: h.day }));
  const leaving = people.filter(p => p.quit && p.quit.last <= week).map(p => ({ person: num(p.id), tab: p.tab, role: p.role, why: p.quit!.why, last: p.quit!.last }));
  const resigned = people
    .filter(p => p.quit?.why === 'own' && p.quit.day >= today - 1)
    .map(p => ({ person: num(p.id), tab: p.tab, role: p.role, shift: p.shift, last: p.quit!.last, ...(p.quit!.vacancy ? { vacancy: p.quit!.vacancy } : {}) }));
  const trials = people.filter(p => p.trial !== undefined && p.trial <= week).map(p => ({ person: num(p.id), tab: p.tab, role: p.role, last: p.trial! }));
  const by = new Map<string, number>();
  for (const c of Object.values(s.candidates)) if (c.from >= today - 1) by.set(c.vacancy, (by.get(c.vacancy) ?? 0) + 1);
  const candidates = [...by].map(([vacancy, n]) => ({ vacancy, role: s.vacancies[vacancy].role, n }));
  return { coming, leaving, resigned, trials, candidates };
}
