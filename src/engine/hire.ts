// Найм и увольнение (Б4в; docs/specs/2026-10-vertical-slice.md, «Б4в»; геймдизайн, §8.4). Рынок труда города — запись
// сценария: кандидаты по объявлению в понедельник в 09:00 и от кадрового агентства, каждый со своим навыком и ожиданием
// оклада, ищут работу свой срок. Приём — медосмотр за счёт завода в рабочие дни (ст. 220 ТК РФ; GMP ЕАЭС, ч. I, п. 2.16),
// первый день — первая смена графика вакансии после заключения: договор и приказ (ст. 67, 68), табельный номер, сразу
// обучение по матрице роли; испытание — до трёх месяцев (ст. 70). Увольнение — по соглашению сторон (ст. 78), не
// выдержал испытание (ст. 71), по собственному желанию через две недели (ст. 80): заявления даёт текучесть. Последний
// день — расчёт (cash.ts, ст. 84.1, 140) и уход после последней смены. Пока пост отдела не у игрока, коллега этого поста
// открывает вакансию на каждое заявление и принимает первого подходящего кандидата.
import type { ContentDb, Dept, Id, Labor } from '../content/types';
import { addMonths, addWorkdays, DAY, daysFromCivil, HOUR, isWorkday, momentOf } from './core/calendar';
import { hiringPay, salaryOf, settle } from './cash';
import { DEPT_HEAD, note, noteCmd } from './journal';
import { deputyGone, dropAfter } from './leave';
import { planOf } from './plant';
import { normal, roll, spread } from './random';
import { playerHolds } from './seats';
import { graphSpan, spanOn } from './shifts';
import { dropTask } from './tasks';
import { trainNow } from './train';
import type { Command, Decided, Hire, Notice, Person, PlantState, Quit } from './types';
import { calOf } from './workdays';

/** Причина приёма коллегой (Б5а). */
type HireWhy = NonNullable<Extract<Decided, { kind: 'hire' }>['why']>;

/** Час рынка труда: кандидаты по объявлению — в понедельник, коллеги — в рабочий день (гипотеза, как коллеги снабжения). */
export const LABOR_HOUR = 9 * HOUR;

const P = 10000;

/** Рынок труда сценария; нет — найма нет. */
export const laborOf = (db: ContentDb, s: PlantState): Labor | undefined => db.scenarios[s.scenario].labor;

/** Сроки закона профиля (Б4в): испытание, предупреждение об уходе — по собственному желанию и на испытании. */
const lawOf = (db: ContentDb, s: PlantState) => db.profiles[db.scenarios[s.scenario].profile].labor;

const today = (s: PlantState) => momentOf(s.start, s.t).day;

/** Отдел роли — чей пост ведёт её найм и увольнение. */
export const deptOf = (db: ContentDb, role: Id): Dept => db.roles[role].dept;

/** Цена рынка за навык (копейки в месяц): уровень роли с прибавкой `step` за каждую ступень выше 3, ниже — с убавкой. */
export const marketPay = (db: ContentDb, lab: Labor, role: Id, skill: number): number => {
  const level = db.roles[role].salary;
  return level + Math.floor((level * lab.step * (skill - 3)) / P);
};

/** Ожидание оклада кандидата (копейки): цена рынка за его навык с разбросом `spread`; до 500 ₽. */
function expectation(db: ContentDb, lab: Labor, role: Id, skill: number, z: number): number {
  const base = marketPay(db, lab, role, skill);
  const v = base + spread(Math.floor((base * lab.spread) / P), z);
  const step = 50000;
  return Math.max(step, Math.round(v / step) * step);
}

/** Навык по долям 1–5 (доли 1/10 000). */
function drawSkill(weights: readonly number[], u: number): number {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (u < acc) return i + 1;
  }
  return weights.length;
}

/** Новый кандидат вакансии: навык, ожидание, срок поиска. */
function candidate(db: ContentDb, s: PlantState, lab: Labor, vacId: string, via: 'ad' | 'agency', skill: number, z: number) {
  const v = s.vacancies[vacId];
  const id = `K${(s.next.K = (s.next.K ?? 0) + 1)}`;
  const day = today(s);
  s.candidates[id] = { id, vacancy: vacId, via, role: v.role, skill, salary: expectation(db, lab, v.role, skill, z), from: day, until: day + lab.wait };
}

/** Понедельник, 09:00: по каждой вакансии с объявлением — отклики недели по записи рынка и плата за неделю объявления. */
function adWeek(db: ContentDb, s: PlantState, lab: Labor, notices: Notice[]) {
  for (const v of Object.values(s.vacancies)) {
    if (v.via !== 'ad') continue;
    hiringPay(s, -lab.ad, `ad-${v.id}`);
    const row = lab.roles[v.role];
    if (!row) continue;
    const got = roll(s, `staff/ad/${v.id}`, r => {
      const n = drawSkill(row.ad, r.int(P)) - 1;
      return Array.from({ length: n }, () => ({ skill: drawSkill(row.skill, r.int(P)), z: normal(r) }));
    });
    for (const c of got) candidate(db, s, lab, v.id, 'ad', c.skill, c.z);
    if (got.length > 0) notices.push({ kind: 'candidates', vacancy: v.id, role: v.role, n: got.length });
  }
}

/** Плата агентству при приёме его кандидата: доля годового оклада, копейки. */
export const agencyFee = (lab: Labor, salary: number): number => Math.floor((salary * 12 * lab.agency.share) / P);

/** Когда агентство пришлёт следующего кандидата по вакансии: через `days` суток от и до, в 09:00. */
function agencyNext(s: PlantState, lab: Labor, vacId: string): number {
  const [a, b] = lab.agency.days;
  const d = roll(s, `staff/agency/${vacId}`, r => a + r.int(b - a + 1));
  return (today(s) + d - daysFromCivil(s.start)) * DAY + LABOR_HOUR;
}

/** Агентство: кандидат с навыком от и до записи рынка — в своё мгновение; следующего — через новый срок. */
function agencyStep(db: ContentDb, s: PlantState, lab: Labor, notices: Notice[]) {
  for (const v of Object.values(s.vacancies)) {
    if (v.via !== 'agency' || v.next === undefined || v.next > s.t) continue;
    const [lo, hi] = lab.agency.skill;
    const got = roll(s, `staff/agency/${v.id}`, r => ({ skill: lo + r.int(hi - lo + 1), z: normal(r) }));
    candidate(db, s, lab, v.id, 'agency', got.skill, got.z);
    notices.push({ kind: 'candidates', vacancy: v.id, role: v.role, n: 1 });
    v.next = agencyNext(s, lab, v.id);
  }
}

/**
 * Открыть вакансию: объявление — кандидаты с ближайшего понедельника; агентство — первый через свой срок. В журнал
 * решений (Б5а) — игрок с командой или руководитель отдела роли с причиной.
 */
function open(db: ContentDb, s: PlantState, lab: Labor, role: Id, shift: Id, via: 'ad' | 'agency', notices: Notice[], by?: { instead: string }, cmd?: Command): string {
  const id = `J${(s.next.J = (s.next.J ?? 0) + 1)}`;
  s.vacancies[id] = { id, role, shift, via, from: today(s), ...(by ? { by: 'colleague' as const, instead: by.instead } : {}) };
  if (via === 'agency') s.vacancies[id].next = agencyNext(s, lab, id);
  notices.push({ kind: 'vacancy', id, role, shift, via, ...(by ? { by: 'colleague' as const } : {}) });
  const d = { kind: 'vacancy' as const, vacancy: id, role, via };
  const p = by ? s.people[by.instead] : undefined;
  if (cmd) noteCmd(s, cmd, d, deptOf(db, role));
  else if (p) note(s, DEPT_HEAD[deptOf(db, role)], { ...d, why: { instead: p.id, tab: p.tab, day: p.quit?.day ?? today(s), rule: via === 'agency' ? 'city' : 'ad' } });
  return id;
}

/** Закрыть вакансию: её кандидаты уходят с рынка. */
function closeVacancy(s: PlantState, id: string) {
  delete s.vacancies[id];
  for (const c of Object.values(s.candidates)) if (c.vacancy === id) delete s.candidates[c.id];
}

/**
 * Первый день принятого: ближайший день после заключения медосмотра, когда у графика вакансии есть смена, — день и
 * мгновение её начала. Ищет до года вперёд; нет смены — `undefined`.
 */
function firstShift(db: ContentDb, s: PlantState, shift: Id, after: number): { day: number; at: number } | undefined {
  for (let z = after + 1; z <= after + 366; z++) {
    const span = spanOn(db, s, { shift, roster: db.shifts[shift].cycle ? [{ shift, from: z }] : undefined }, z);
    if (span) return { day: z, at: span[0] };
  }
  return undefined;
}

/**
 * Если принять сегодня (и для окна): день заключения медосмотра — рабочие дни с завтрашнего — и первый день — первая
 * смена графика после него, с мгновением её начала; смены за год нет — без первого дня.
 */
export function hireDays(db: ContentDb, s: PlantState, shift: Id): { exam: number; first?: { day: number; at: number } } {
  const lab = laborOf(db, s);
  const exam = addWorkdays(calOf(db, s), today(s), lab?.medical.days ?? 0);
  const first = firstShift(db, s, shift, exam);
  return { exam, ...(first ? { first } : {}) };
}

/**
 * Условия увольнения сегодня (и для окна): по соглашению — последний день сегодня и выплата; не выдержал испытание —
 * последний день через срок предупреждения, успеть можно только в срок испытания; у ушедшего или уходящего — ничего.
 */
export function dismissTerms(db: ContentDb, s: PlantState, p: Person): { agree?: { last: number; pay: number }; trial?: { last: number; ok: boolean } } {
  if (p.quit || !s.people[p.id]) return {};
  const z = today(s);
  const lab = laborOf(db, s);
  const law = lawOf(db, s);
  const last = z + law.trial;
  return {
    agree: { last: z, pay: Math.floor((salaryOf(db, p) * (lab?.agree ?? 0)) / P) },
    ...(p.trial !== undefined ? { trial: { last, ok: last <= p.trial } } : {}),
  };
}

/**
 * Принять кандидата: медосмотр — рабочие дни с завтрашнего, за счёт завода; первый день — первая смена после него. В
 * журнал решений (Б5а) — игрок с командой или руководитель отдела роли с причиной `why`.
 */
function hireCandidate(db: ContentDb, s: PlantState, lab: Labor, id: string, trial: number, notices: Notice[], cmd?: Command, why?: HireWhy): boolean {
  const c = s.candidates[id];
  const v = s.vacancies[c.vacancy];
  const { exam, first } = hireDays(db, s, v.shift);
  if (!first) return false;
  const d = { kind: 'hire' as const, cand: c.id, vacancy: v.id, role: c.role };
  if (cmd) noteCmd(s, cmd, d, deptOf(db, c.role));
  else note(s, DEPT_HEAD[deptOf(db, c.role)], { ...d, ...(why ? { why } : {}) });
  const h: Hire = { id: c.id, vacancy: v.id, via: c.via, role: c.role, skill: c.skill, salary: c.salary, shift: v.shift, trial, exam, day: first.day, at: first.at };
  s.hires[h.id] = h;
  hiringPay(s, -lab.medical.price, `med-${h.id}`);
  if (c.via === 'agency') hiringPay(s, -agencyFee(lab, c.salary), `agency-${h.id}`);
  closeVacancy(s, v.id);
  notices.push({ kind: 'accepted', candidate: h.id, role: h.role, day: h.day });
  return true;
}

/**
 * Первый день: человек у входа с табельным номером по порядку приёма; договор и приказ — мгновение (гипотеза); у
 * сменного по циклу — график с этого дня (суммированный учёт с дня приёма, Б4б); сразу — задачи изучить документы
 * строки матрицы роли (Б3б).
 */
function start(db: ContentDb, s: PlantState, h: Hire, notices: Notice[]) {
  const sc = db.scenarios[s.scenario];
  const n = (s.next.E = (s.next.E ?? 0) + 1);
  const e = planOf(db, s.plant).entrance;
  const p: Person = {
    id: `E${n}`,
    role: h.role,
    shift: h.shift,
    skill: h.skill,
    tab: sc.training.tab + n - 1,
    train: {},
    x: e.x,
    z: e.z,
    ot: [],
    otYear: { y: momentOf(s.start, s.t).date.y, sec: 0 },
    salary: h.salary,
    hired: h.day,
    cand: h.id,
    ...(db.shifts[h.shift].cycle ? { roster: [{ shift: h.shift, from: h.day }] } : {}),
    ...(h.trial > 0 ? { trial: addMonths(h.day, h.trial) - 1 } : {}),
  };
  s.people[p.id] = p;
  delete s.hires[h.id];
  trainNow(db, s, p);
  notices.push({ kind: 'hired', person: p.id, role: p.role, tab: p.tab });
}

/**
 * Последний день по собственному желанию (ст. 80, ч. 1; ст. 14, ч. 3–4): срок — со следующего дня после заявления, через
 * `days` суток; выпал на день без смены человека — ближайший день с его сменой (гипотеза: «нерабочий» — по его графику,
 * отпуск срока не меняет — Б4г).
 */
function noticeEnd(db: ContentDb, s: PlantState, p: Person, day: number, days: number): number {
  let z = day + days;
  for (let i = 0; i < 31 && !graphSpan(db, s, p, z); i++) z++;
  return z;
}

/** Полночь: текучесть — заявления по собственному желанию; кончились испытания; кандидаты, нашедшие другую работу. */
function laborDay(db: ContentDb, s: PlantState, lab: Labor, z: number, notices: Notice[]) {
  for (const c of Object.values(s.candidates)) if (c.until < z) delete s.candidates[c.id];
  const law = lawOf(db, s);
  for (const p of Object.values(s.people)) {
    // срок испытания истёк, а человек работает, — выдержал (ст. 71, ч. 3)
    if (p.trial !== undefined && p.trial < z) delete p.trial;
    if (p.quit) continue;
    const row = lab.roles[p.role];
    if (!row || row.quit === 0) continue;
    const rate = p.trial !== undefined ? Math.floor((row.quit * lab.trial) / P) : row.quit;
    const hit = roll(s, `staff/quit/${p.id}`, r => r.int(365 * P) < rate);
    if (!hit) continue;
    const last = p.trial !== undefined ? Math.min(noticeEnd(db, s, p, z, law.trial), Math.max(z, p.trial)) : noticeEnd(db, s, p, z, law.notice);
    p.quit = { why: 'own', day: z, last };
    dropAfter(p, last);
    notices.push({ kind: 'resign', person: p.id, role: p.role, tab: p.tab, dept: deptOf(db, p.role), last });
  }
}

/**
 * Ушёл ли человек: последний день настал, его смена в этот день кончилась (ночная — утром следующего) или её нет, и задачи
 * у него нет. Записи остаются — в `former`: табель, обучение, история. Был заместителем в частях отпуска, которые ещё
 * идут, — с завтрашнего дня следующий по правилу (Б4г).
 */
function leaveStep(db: ContentDb, s: PlantState, notices: Notice[]) {
  const z = today(s);
  for (const p of Object.values(s.people)) {
    const q = p.quit;
    if (!q || q.last > z || p.task) continue;
    const span = spanOn(db, s, p, q.last);
    if (span && span[1] > s.t) continue;
    settle(db, s, p);
    for (const t of Object.values(s.tasks)) if (t.trainee === p.id && t.state !== 'busy') dropTask(db, s, t);
    delete p.walk;
    delete s.people[p.id];
    s.former[p.id] = p;
    deputyGone(db, s, p.id, z + 1);
    notices.push({ kind: 'left', person: p.id, role: p.role, tab: p.tab, why: q.why });
  }
}

/**
 * Коллега поста (09:00 рабочего дня): пока пост отдела не у игрока, на каждое заявление по собственному желанию —
 * вакансия той же роли и графика по объявлению, а роли, которой по объявлению в городе не найти, — сразу через
 * агентство; по объявлению `ad` суток никого подходящего — тоже через агентство; принимает первого кандидата с навыком
 * не ниже `skill` и ожиданием не выше цены рынка за его навык на `over`, испытание — по умолчанию.
 */
function colleagueStep(db: ContentDb, s: PlantState, lab: Labor, notices: Notice[]) {
  const z = today(s);
  for (const p of Object.values(s.people)) {
    const q = p.quit;
    const row = lab.roles[p.role];
    if (q?.why !== 'own' || q.vacancy !== undefined || !row || playerHolds(s, deptOf(db, p.role))) continue;
    q.vacancy = open(db, s, lab, p.role, p.shift, row.ad[0] >= P ? 'agency' : 'ad', notices, { instead: p.id });
  }
  for (const v of Object.values(s.vacancies)) {
    if (v.by !== 'colleague' || playerHolds(s, deptOf(db, v.role))) continue;
    const price = (skill: number) => {
      const m = marketPay(db, lab, v.role, skill);
      return m + Math.floor((m * lab.colleague.over) / P);
    };
    const fit = Object.values(s.candidates).find(c => c.vacancy === v.id && c.skill >= lab.colleague.skill && c.salary <= price(c.skill));
    if (fit) {
      hireCandidate(db, s, lab, fit.id, lab.probation, notices, undefined, { skill: fit.skill, min: lab.colleague.skill, salary: fit.salary, price: marketPay(db, lab, v.role, fit.skill), over: lab.colleague.over });
      continue;
    }
    if (v.via === 'ad' && z - v.from >= lab.colleague.ad) {
      v.via = 'agency';
      v.next = agencyNext(s, lab, v.id);
      // журнал решений (Б5а): по объявлению подходящий не нашёлся — агентство
      const p = v.instead ? (s.people[v.instead] ?? s.former[v.instead]) : undefined;
      if (p) note(s, DEPT_HEAD[deptOf(db, v.role)], { kind: 'vacancy', vacancy: v.id, role: v.role, via: 'agency', why: { instead: p.id, tab: p.tab, day: p.quit?.day ?? v.from, rule: 'late', days: z - v.from } });
    }
  }
}

/**
 * Каждый час (Б4в): в полночь — кандидаты, испытания, заявления; в 09:00 понедельника — отклики на объявления; в 09:00
 * рабочего дня — коллеги; агентства — в свои мгновения; принятые — в первую смену; ушедшие — после последней.
 */
export function hireHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  const lab = laborOf(db, s);
  const now = momentOf(s.start, s.t);
  if (lab) {
    if (now.sec === 0) laborDay(db, s, lab, now.day, notices);
    if (now.sec === LABOR_HOUR && now.weekday === 0) adWeek(db, s, lab, notices);
    agencyStep(db, s, lab, notices);
    if (now.sec === LABOR_HOUR && isWorkday(calOf(db, s), now.day)) colleagueStep(db, s, lab, notices);
  }
  for (const h of Object.values(s.hires)) if (h.at <= s.t) start(db, s, h, notices);
  leaveStep(db, s, notices);
}

/** Команды найма (Б4в): вакансия, закрыть, принять, уволить. Отказы — с причиной. */
export function hireCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'vacancy' | 'close' | 'hire' | 'dismiss' }>, notices: Notice[]) {
  const lab = laborOf(db, s);
  const law = lawOf(db, s);
  const z = today(s);
  const refuse = (why: Extract<Notice, { kind: 'refused' }>['why'], detail?: string) => notices.push({ kind: 'refused', cmd: cmd.kind, why, ...(detail ? { detail } : {}) });
  switch (cmd.kind) {
    case 'vacancy': {
      if (!lab || !lab.roles[cmd.role]) return refuse('noLabor');
      if (!db.shifts[cmd.shift]) return refuse('noShift');
      open(db, s, lab, cmd.role, cmd.shift, cmd.via, notices, undefined, cmd);
      return;
    }
    case 'close': {
      if (!s.vacancies[cmd.vacancy]) return refuse('noVacancy');
      closeVacancy(s, cmd.vacancy);
      return;
    }
    case 'hire': {
      if (!lab) return refuse('noLabor');
      if (!s.candidates[cmd.candidate]) return refuse('noCandidate');
      if (!Number.isInteger(cmd.trial) || cmd.trial < 0 || cmd.trial > law.probation) return refuse('trialLong');
      if (!hireCandidate(db, s, lab, cmd.candidate, cmd.trial, notices, cmd)) refuse('noShift');
      return;
    }
    case 'dismiss': {
      const p = s.people[cmd.person];
      if (!p) return refuse('noPerson');
      if (cmd.why === 'early') {
        if (p.quit?.why !== 'own') return refuse('noNotice');
        p.quit.last = Math.min(p.quit.last, z);
        dropAfter(p, p.quit.last);
        notices.push({ kind: 'dismissed', person: p.id, role: p.role, tab: p.tab, why: 'own', last: p.quit.last });
        return;
      }
      if (p.quit) return refuse('leaving');
      const terms = dismissTerms(db, s, p);
      let q: Quit;
      if (cmd.why === 'trial') {
        if (!terms.trial) return refuse('notTrial');
        if (!terms.trial.ok) return refuse('tooLate');
        q = { why: 'trial', day: z, last: terms.trial.last };
      } else {
        q = { why: 'agree', day: z, last: z, pay: terms.agree!.pay };
      }
      p.quit = q;
      dropAfter(p, q.last);
      notices.push({ kind: 'dismissed', person: p.id, role: p.role, tab: p.tab, why: q.why, last: q.last });
      return;
    }
  }
}
