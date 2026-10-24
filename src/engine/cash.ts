// Касса (docs/specs/2026-10-engine.md, 1д; геймдизайн, §12): копейки и проводки. Платежи — в 10:00 рабочего дня; срок,
// выпавший на выходной, — на следующий рабочий день, а зарплата — накануне (ст. 136 ТК РФ). Зарплата — дважды в месяц,
// взносы и энергия — помесячно, НДС — за квартал, проценты по кредитной линии — за сутки. Рабочие дни — по
// производственному календарю профиля, зарплата — по табелю (Б4а). Правила — из профиля (ADR 0004), цены и предел
// кредита — из сценария. С Б4г — доплата заместителю, отпускные по среднему заработку и компенсация за отпуск.
import type { ContentDb, Profile } from '../content/types';
import { civilFromDays, DAY, daysFromCivil, HOUR, isWorkday, lastOfMonth, momentOf, normOf, workdayOnOrAfter, workdayOnOrBefore } from './core/calendar';
import { pruneSheet, type SheetDay, sheetDays } from './hours';
import { awayOn, compDays, deputyOn, lawOf, ruleOf } from './leave';
import { planOf } from './plant';
import { employedOn, leaveResult, scheduleOn } from './shifts';
import { nextId } from './stock';
import type { Away, Cash, CashItem, Notice, Person, PlantState, WageParts } from './types';
import { calOf } from './workdays';

/** Час банка: платежи и поступления дня. */
export const BANK_HOUR = 10 * HOUR;

const P = 10000;

export function newCash(start: number, t: number): Cash {
  return { balance: start, start, ledger: [], dues: [], vat: { out: 0, in: 0, carry: 0 }, energy: { wh: 0, at: t, last: 0, advanced: 0 }, ytd: {}, gross: {}, interest: 0, wages: {} };
}

const profileOf = (db: ContentDb, s: PlantState): Profile => db.profiles[db.scenarios[s.scenario].profile];

/** Момент `sec` секунд от полуночи дня `z` (номер дня от 1970-01-01). */
const at = (s: PlantState, z: number, sec: number) => (z - daysFromCivil(s.start)) * DAY + sec;

/** Доля `share` (1/10 000) суммы — вниз до копейки. */
export const part = (sum: number, share: number) => Math.floor((sum * share) / P);

/** Деньги прошли сейчас: приход — плюс, расход — минус. */
export function post(s: PlantState, sum: number, item: CashItem, ref?: string) {
  if (sum === 0) return;
  s.cash.balance += sum;
  s.cash.ledger.push({ t: s.t, sum, item, ...(ref ? { ref } : {}) });
}

/** Счёт к получению (плюс) или к оплате (минус) со сроком `due` — моментом; очередь — по сроку, затем по порядку заведения. */
export function owe(s: PlantState, item: CashItem, sum: number, due: number, ref?: string) {
  if (sum === 0) return;
  const dues = s.cash.dues;
  let i = dues.length;
  while (i > 0 && dues[i - 1].due > due) i--;
  dues.splice(i, 0, { id: nextId(s, 'M'), item, sum, due, ...(ref ? { ref } : {}) });
}

/** Срок «через `days` дней от сегодня» — в час банка ближайшего рабочего дня не раньше. */
export function dueIn(db: ContentDb, s: PlantState, days: number): number {
  return at(s, workdayOnOrAfter(calOf(db, s), momentOf(s.start, s.t).day + days), BANK_HOUR);
}

/** НДС закупки: АФС — по ставке лекарственных средств (они включают фармацевтические субстанции), остальное — по общей. */
export function vatRate(db: ContentDb, s: PlantState, material: string): number {
  const vat = profileOf(db, s).vat;
  return db.materials[material].kind === 'api' ? vat.medicines : vat.general;
}

/** Энергия: `w` ватт в течение `sec` секунд — в счётчик месяца. */
export function addEnergy(s: PlantState, w: number, sec: number) {
  if (w > 0 && sec > 0) s.cash.energy.wh += Math.floor((w * sec) / HOUR);
}

/** Помещения склада: их свет и холод — в постоянной базе плана. */
const WAREHOUSE = new Set(['warehouse', 'cold', 'rejected']);

/** Мощность, которая работает круглые сутки: вентиляция по площади помещений и их классу и постоянная база, Вт. */
export function baseLoad(db: ContentDb, s: PlantState): number {
  const plant = planOf(db, s.plant).plant;
  let w = plant.energy.base;
  // вентиляция — помещения производства, лаборатории и вспомогательные, площадь без стен (см² → м²); склад с холодом и
  // отклонённым — в постоянной базе (docs/specs/2026-10-view.md, 2а)
  for (const r of plant.rooms) {
    if (WAREHOUSE.has(r.type)) continue;
    w += Math.floor(((r.rect[2] - 200) * (r.rect[3] - 200) * plant.energy.hvac[r.grade]) / 10000);
  }
  return w;
}

/** Каждый час: в полночь — сутки и границы месяца и квартала; в час банка рабочего дня — платежи и отпускные (Б4г). */
export function cashHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  const now = momentOf(s.start, s.t);
  if (now.sec === 0) midnight(db, s, now.day);
  if (now.sec === BANK_HOUR && isWorkday(calOf(db, s), now.day)) {
    while (s.cash.dues.length > 0 && s.cash.dues[0].due <= s.t) {
      const d = s.cash.dues.shift()!;
      post(s, d.sum, d.item, d.ref);
    }
    vacationPay(db, s, now.day);
  }
  if (now.sec === 0 || now.sec === BANK_HOUR) lowCheck(db, s, now.day, notices);
}

function lowCheck(db: ContentDb, s: PlantState, day: number, notices: Notice[]) {
  const limit = db.scenarios[s.scenario].credit.limit;
  if (s.cash.balance >= -limit || s.cash.low === day) return;
  s.cash.low = day;
  notices.push({ kind: 'cashLow', balance: s.cash.balance });
}

/** Полночь дня `z`: энергия прошлых суток, проценты, зарплата за полмесяца, закрытие месяца и квартала. */
function midnight(db: ContentDb, s: PlantState, z: number) {
  const sc = db.scenarios[s.scenario];
  const pr = profileOf(db, s);
  const cal = calOf(db, s);
  const c = s.cash;
  // с прошлой полуночи (или с начала партии): вентиляция и база
  addEnergy(s, baseLoad(db, s), s.t - c.energy.at);
  c.energy.at = s.t;
  // проценты по кредитной линии — на минус кассы за сутки (ст. 850 ГК РФ)
  if (c.balance < 0) c.interest += Math.floor((-c.balance * (pr.key + sc.credit.spread)) / (365 * P));
  const date = civilFromDays(z);
  // 16-е: зарплата за 1–15-е — последним днём месяца, выпал выходной — накануне
  if (date.d === 16) {
    const ref = `${date.y}-${date.m}a`;
    const pay = wages(db, s, date.y, date.m, 1, 15, ref);
    owe(s, 'wages', -pay, at(s, workdayOnOrBefore(cal, lastOfMonth(date.y, date.m)), BANK_HOUR), ref);
  }
  if (date.d !== 1) return;
  // 1-е: закрыть прошлый месяц
  const pm = date.m === 1 ? 12 : date.m - 1;
  const py = date.m === 1 ? date.y - 1 : date.y;
  const ref = `${py}-${pm}`;
  // зарплата за 16-е — конец месяца — 15-го, выпал выходной — накануне
  const pay = wages(db, s, py, pm, 16, lastOfMonth(py, pm) - daysFromCivil({ y: py, m: pm, d: 1 }) + 1, `${ref}b`);
  owe(s, 'wages', -pay, at(s, workdayOnOrBefore(cal, daysFromCivil({ y: date.y, m: date.m, d: 15 })), BANK_HOUR), `${ref}b`);
  // табель: отрезки сверхурочных старше прошлого месяца больше не нужны (Б4а)
  pruneSheet(s, z);
  // взносы за месяц — до 28-го следующего; срок на выходном — на следующий рабочий день
  const ct = pr.payroll.contrib;
  let contrib = 0;
  for (const [id, gross] of Object.entries(c.gross)) {
    const before = c.ytd[id] ?? 0;
    const inBase = Math.max(0, Math.min(gross, ct.base - before));
    contrib += part(inBase, ct.rate) + part(gross - inBase, ct.above) + part(gross, ct.injury);
    c.ytd[id] = before + gross;
  }
  c.gross = {};
  if (date.m === 1) c.ytd = {};
  owe(s, 'contrib', -contrib, at(s, workdayOnOrAfter(cal, daysFromCivil({ y: date.y, m: date.m, d: ct.due })), BANK_HOUR), ref);
  // энергия за месяц: стоимость с НДС; окончательный расчёт — минус авансы; авансы нового месяца — от этой стоимости
  const net = Math.floor((c.energy.wh * sc.energy.price) / 1000);
  const tax = part(net, pr.vat.general);
  c.vat.in += tax;
  const cost = net + tax;
  owe(s, 'energy', -(cost - c.energy.advanced), at(s, workdayOnOrAfter(cal, daysFromCivil({ y: date.y, m: date.m, d: pr.energy.final })), BANK_HOUR), ref);
  c.energy = { wh: 0, at: s.t, last: cost, advanced: 0 };
  for (const [d, share] of pr.energy.advances) {
    const adv = part(cost, share);
    c.energy.advanced += adv;
    owe(s, 'energy', -adv, at(s, workdayOnOrAfter(cal, daysFromCivil({ y: date.y, m: date.m, d })), BANK_HOUR), `${date.y}-${date.m}`);
  }
  // проценты за месяц — в первый рабочий день нового
  owe(s, 'interest', -c.interest, at(s, workdayOnOrAfter(cal, z), BANK_HOUR), ref);
  c.interest = 0;
  // квартал: НДС к уплате — тремя долями до 28-го числа каждого из трёх следующих месяцев; минус — к вычету дальше
  if (date.m % 3 === 1) {
    const due = c.vat.out - c.vat.in - c.vat.carry;
    c.vat = { out: 0, in: 0, carry: due < 0 ? -due : 0 };
    if (due > 0) {
      const third = Math.floor(due / 3);
      for (let k = 0; k < 3; k++) {
        const m = ((date.m - 1 + k) % 12) + 1;
        const y = date.y + (date.m - 1 + k >= 12 ? 1 : 0);
        owe(s, 'vat', -(k < 2 ? third : due - 2 * third), at(s, workdayOnOrAfter(cal, daysFromCivil({ y, m, d: pr.vatDue })), BANK_HOUR), `${py}-q${Math.ceil(pm / 3)}`);
      }
    }
  }
}

/**
 * Доплаты человеку за дни `from`–`to` месяца `y`-`m` по табелю (Б4а), копейки: ночные — доля часовой ставки за каждый
 * ночной час (ст. 154); сверхурочные — первые часы отрезка после смены по первой ставке, дальше по второй (ст. 152);
 * работа в выходной или праздник — ставка сверх оклада в пределах месячной нормы и по второй ставке сверх неё (ст. 153;
 * норма месяца — за вычетом часов смены по графику и РВ раньше в месяце). Часовая ставка — оклад на норму часов месяца
 * (гипотеза). Для кассы и для окна — одно.
 */
export function extras(db: ContentDb, s: PlantState, p: Person, y: number, m: number, from: number, to: number): Required<Pick<WageParts, 'night' | 'over' | 'off' | 'period'>> {
  const pr = profileOf(db, s).payroll;
  const cal = calOf(db, s);
  const salary = salaryOf(db, p);
  const norm = normOf(cal, y, m, profileOf(db, s).calendar.day, profileOf(db, s).calendar.short);
  const first = daysFromCivil({ y, m, d: 1 });
  const month = sheetDays(db, s, p, first, lastOfMonth(y, m));
  const sum = (days: SheetDay[], f: (d: SheetDay) => number) => days.reduce((n, d) => n + f(d), 0);
  const mine = month.slice(from - 1, to);
  // часы по графику месяца и РВ до этих дней — то, что уже заняло норму
  const planned = sum(month, d => d.work - d.over[0] - d.over[1] - d.off);
  const within = Math.max(0, norm - planned - sum(month.slice(0, from - 1), d => d.off));
  const off = sum(mine, d => d.off);
  const share = (sec: number, rate: number) => (sec > 0 && norm > 0 ? Math.floor((Math.floor((salary * sec) / norm) * rate) / P) : 0);
  // сменный по циклу (Б4б): работа после смен — не сверхурочная до итога учётного периода; итог — с зарплатой второй
  // половины его последнего месяца (shifts.ts, `rosterDay`)
  const week = mine.filter((_, i) => !db.shifts[scheduleOn(p, first + from - 1 + i)].cycle);
  return {
    night: share(sum(mine, d => d.night), pr.night.extra),
    over: share(sum(week, d => d.over[0]), pr.overtime.rates[0]) + share(sum(week, d => d.over[1]), pr.overtime.rates[1]),
    off: share(Math.min(off, within), pr.holiday.within) + share(off - Math.min(off, within), pr.holiday.beyond),
    period: p.saDone && p.saDone.y === y && p.saDone.m === m && from > 1 ? p.saDone.pay : 0,
  };
}

/** Оклад человека, копейки в месяц (Б4в): принятого — его, людей сценария — оклад роли. */
export const salaryOf = (db: ContentDb, p: Pick<Person, 'role' | 'salary'>): number => p.salary ?? db.roles[p.role].salary;

/**
 * Оклад за дни `a`–`b` (номера дней) месяца, в котором человек работал не весь (Б4в) или был в отпуске (Б4г): доля оклада
 * по часам смен по графику, отработанным в его дни, против нормы месяца (гипотеза).
 */
function partOf(db: ContentDb, s: PlantState, p: Person, y: number, m: number, a: number, b: number): number {
  const salary = salaryOf(db, p);
  const first = daysFromCivil({ y, m, d: 1 });
  const pr = profileOf(db, s).calendar;
  const norm = normOf(calOf(db, s), y, m, pr.day, pr.short);
  const from = Math.max(a, p.hired ?? a);
  const to = Math.min(b, p.quit?.last ?? b);
  if (norm <= 0 || from > to) return 0;
  const days = sheetDays(db, s, p, first, lastOfMonth(y, m)).slice(from - first, to - first + 1);
  const worked = days.reduce((n, d) => n + d.work - d.over[0] - d.over[1] - d.off, 0);
  return Math.min(salary, Math.floor((salary * worked) / norm));
}

/**
 * Зарплата человека за дни `from`–`to` месяца и доплаты за эти дни по табелю (`extras`) и за замещение (`coverPay`).
 * Месяц весь — половина оклада: первая — вниз до копейки, вторая — остаток, чтобы месяц сходился. В месяц приёма и
 * увольнения (Б4в) и в месяц с отпуском (Б4г) — доля оклада по отработанному (`partOf`): первая половина — за 1–15-е,
 * вторая — за месяц по `to` минус начисленная 16-го.
 */
export function halfOf(db: ContentDb, s: PlantState, p: Person, y: number, m: number, from: number, to: number): WageParts {
  const salary = salaryOf(db, p);
  const first = daysFromCivil({ y, m, d: 1 });
  const last = lastOfMonth(y, m);
  const whole = (p.hired ?? 0) <= first && (p.quit === undefined || p.quit.last >= last) && !p.away?.some(a => a.from <= last && a.to >= first);
  const half = Math.floor(salary / 2);
  let base: number;
  if (from === 1) base = whole ? half : partOf(db, s, p, y, m, first, first + to - 1);
  else {
    const done = p.half && p.half.y === y && p.half.m === m ? p.half.base : 0;
    base = whole ? salary - half : Math.max(0, partOf(db, s, p, y, m, first, first + to - 1) - done);
  }
  const x = extras(db, s, p, y, m, from, to);
  const cover = coverPay(db, s, p, first + from - 1, first + to - 1);
  return { salary: base, night: x.night, over: x.over, off: x.off, ...(x.period > 0 ? { period: x.period } : {}), ...(cover > 0 ? { cover } : {}) };
}

/**
 * Доплата за замещение (Б4г; ст. 151; доля — гипотеза) за дни `a`–`b` (номера дней) одного месяца: по каждой части, где
 * человек в эти дни заместитель, а сам на заводе и не в отпуске, — доля `cover` оклада ушедшего за календарный день, на
 * число дней месяца.
 */
export function coverPay(db: ContentDb, s: PlantState, p: Person, a: number, b: number): number {
  const rule = ruleOf(db, s);
  if (!rule) return 0;
  const { y, m } = civilFromDays(a);
  const md = lastOfMonth(y, m) - daysFromCivil({ y, m, d: 1 }) + 1;
  let sum = 0;
  for (const q of [...Object.values(s.people), ...Object.values(s.former)]) {
    for (const x of q.away ?? []) {
      if (x.to < a || x.from > b) continue;
      let n = 0;
      for (let z = Math.max(a, x.from); z <= Math.min(b, x.to); z++) if (deputyOn(x, z) === p.id && employedOn(p, z) && !awayOn(p, z)) n++;
      if (n > 0) sum += Math.floor((salaryOf(db, q) * rule.cover * n) / (P * md));
    }
  }
  return sum;
}

const grossOf = (w: WageParts) => w.salary + w.night + w.over + w.off + (w.period ?? 0) + (w.leave ?? 0) + (w.cover ?? 0) + (w.vac ?? 0) + (w.comp ?? 0);

function addParts(to: WageParts, w: WageParts) {
  to.salary += w.salary;
  to.night += w.night;
  to.over += w.over;
  to.off += w.off;
  if (w.period) to.period = (to.period ?? 0) + w.period;
  if (w.leave) to.leave = (to.leave ?? 0) + w.leave;
  if (w.cover) to.cover = (to.cover ?? 0) + w.cover;
  if (w.vac) to.vac = (to.vac ?? 0) + w.vac;
  if (w.comp) to.comp = (to.comp ?? 0) + w.comp;
}

/** Номер месяца для начисленного (Б4г): год × 12 + месяц − 1. */
const monthNo = (y: number, m: number) => y * 12 + m - 1;

/**
 * Начислено человеку за месяц (Б4г; для среднего заработка, ст. 139): оплата труда без отпускных, компенсации и выплаты
 * по соглашению; хранится 13 последних месяцев.
 */
function earned(p: Person, y: number, m: number, sum: number) {
  const k = monthNo(y, m);
  const list = (p.earn ??= []);
  const row = list.find(x => x[0] === k);
  if (row) row[1] += sum;
  else list.push([k, sum]);
  p.earn = list.filter(x => x[0] > k - 13);
}

/**
 * Средний дневной заработок для отпускных и компенсации (Б4г; ст. 139; Положение № 922, пп. 4, 5, 10), копейки:
 * начисленное за 12 календарных месяцев перед месяцем `y`-`m` на 29,3 × полные месяцы и дни неполных — 29,3 / дни месяца ×
 * дни на заводе, не в отпуске и с начисленной зарплатой (неначисленные дни последнего месяца — как неполный, гипотеза);
 * отпускные и дни отпусков исключены. До начала завода и в месяцы без записи (сохранение схемы 24) — оклад (гипотеза);
 * дней в периоде нет — оклад на 29,3 (гипотеза).
 */
export function avgDaily(db: ContentDb, s: PlantState, p: Person, y: number, m: number): number {
  const law = lawOf(db, s);
  const startNo = monthNo(s.start.y, s.start.m);
  const k0 = monthNo(y, m);
  let sum = 0;
  // дни — тысячные дня
  let den = 0;
  for (let k = k0 - law.months; k < k0; k++) {
    const yy = Math.floor(k / 12);
    const mm = k - yy * 12 + 1;
    const first = daysFromCivil({ y: yy, m: mm, d: 1 });
    const last = lastOfMonth(yy, mm);
    if (p.hired !== undefined && p.hired > last) continue;
    if (k < startNo) {
      sum += salaryOf(db, p);
      den += law.avg;
      continue;
    }
    let days = 0;
    for (let z = first; z <= last; z++) if (employedOn(p, z) && (p.paid ?? first - 1) >= z && !awayOn(p, z)) days++;
    if (days === 0) continue;
    const md = last - first + 1;
    // записи нет — месяц до сохранения схемы 25: оклад за дни (гипотеза, как до начала завода)
    const e = p.earn?.find(x => x[0] === k);
    sum += e ? e[1] : Math.floor((salaryOf(db, p) * days) / md);
    den += Math.floor((law.avg * days) / md);
  }
  if (den === 0) return Math.floor((salaryOf(db, p) * 1000) / law.avg);
  return Math.floor((sum * 1000) / den);
}

/**
 * Отпускные (Б4г; ст. 136, ч. 9): в час банка рабочего дня не позже чем за `pay` дней до начала части — средний дневной
 * заработок за 12 месяцев перед месяцем начала × дни части; со взносами месяца. Части, у которой этот день прошёл
 * (добавлена позже), — сейчас, пока она не кончилась.
 */
function vacationPay(db: ContentDb, s: PlantState, z: number) {
  if (!ruleOf(db, s)) return;
  const law = lawOf(db, s);
  const cal = calOf(db, s);
  for (const p of Object.values(s.people)) {
    for (const a of p.away ?? []) {
      if (a.paid !== undefined || a.to < z || workdayOnOrBefore(cal, a.from - law.pay) > z) continue;
      payPart(db, s, p, a);
    }
  }
}

function payPart(db: ContentDb, s: PlantState, p: Person, a: Away) {
  const { y, m } = civilFromDays(a.from);
  const sum = avgDaily(db, s, p, y, m) * a.days;
  a.paid = sum;
  const ref = `vac-${a.id}`;
  s.cash.wages[ref] = { salary: 0, night: 0, over: 0, off: 0, vac: sum };
  s.cash.gross[p.id] = (s.cash.gross[p.id] ?? 0) + sum;
  post(s, -sum, 'vacation', ref);
}

/**
 * Зарплата за дни `from`–`to` месяца всем людям завода (`halfOf`); части — в кассу под ссылкой `ref`, для окна; у
 * каждого — по какой день начислено (Б4в: расчёт при увольнении — дальше).
 */
function wages(db: ContentDb, s: PlantState, y: number, m: number, from: number, to: number, ref: string): number {
  const parts: WageParts = { salary: 0, night: 0, over: 0, off: 0 };
  const upTo = daysFromCivil({ y, m, d: to });
  for (const p of Object.values(s.people)) {
    const w = halfOf(db, s, p, y, m, from, to);
    addParts(parts, w);
    s.cash.gross[p.id] = (s.cash.gross[p.id] ?? 0) + grossOf(w);
    earned(p, y, m, grossOf(w));
    p.paid = upTo;
    if (from === 1) p.half = { y, m, base: w.salary };
  }
  s.cash.wages[ref] = parts;
  return grossOf(parts);
}

/** Расходы найма (Б4в): объявление (`ad-<вакансия>`), медосмотр (`med-<кандидат>`), агентство (`agency-<кандидат>`) — сейчас. */
export function hiringPay(s: PlantState, sum: number, ref: string) {
  post(s, sum, 'hiring', ref);
}

/**
 * Расчёт при увольнении (Б4в; ст. 84.1, 140 ТК РФ): все суммы — в день ухода. Начисленное, но ещё не выплаченное — вторая
 * половина прошлого месяца (выплата 15-го) и первая половина этого (выплата в конце месяца) — из общей выплаты в расчёт,
 * взносы с него уже начислены; зарплата с дня после последнего начисления по последний день — доля оклада по
 * отработанному и доплаты по табелю; у сменного по циклу — итог учётного периода по последний день (shifts.ts, гипотеза:
 * как в конце периода); компенсация за неиспользованный отпуск (Б4г; ст. 127) — дни (leave.ts) × средний дневной за 12
 * месяцев перед месяцем ухода; выплата по соглашению. Взносы — как с зарплаты, а с выплаты по соглашению — только сверх
 * трёх окладов (ст. 422 НК РФ; средний заработок — оклад, гипотеза).
 */
export function settle(db: ContentDb, s: PlantState, p: Person) {
  const q = p.quit!;
  const { y, m, d } = civilFromDays(q.last);
  const first = daysFromCivil({ y, m, d: 1 });
  const parts: WageParts = { salary: 0, night: 0, over: 0, off: 0 };
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const owed: [string, number, number, number, number][] = [
    [`${py}-${pm}b`, py, pm, 16, lastOfMonth(py, pm) - daysFromCivil({ y: py, m: pm, d: 1 }) + 1],
    [`${y}-${m}a`, y, m, 1, 15],
  ];
  let moved = 0;
  for (const [ref, yy, mm, from, to] of owed) {
    const due = s.cash.dues.find(x => x.item === 'wages' && x.ref === ref);
    if (!due || p.paid === undefined || p.paid < daysFromCivil({ y: yy, m: mm, d: to })) continue;
    // как начислили: первая половина — запомненная 16-го; вторая — от неё же
    const w = halfOf(db, s, p, yy, mm, from, to);
    if (from === 1 && p.half && p.half.y === yy && p.half.m === mm) w.salary = p.half.base;
    due.sum = Math.min(0, due.sum + grossOf(w));
    addParts(parts, w);
    moved += grossOf(w);
  }
  const from = Math.max((p.paid ?? first - 1) + 1, first);
  if (from <= q.last) addParts(parts, halfOf(db, s, p, y, m, from - first + 1, d));
  const res = leaveResult(db, s, p, q.last);
  if (res > 0) parts.period = (parts.period ?? 0) + res;
  if (ruleOf(db, s)) {
    const comp = Math.floor((compDays(db, s, p, q.last) * avgDaily(db, s, p, y, m)) / 100);
    if (comp > 0) parts.comp = comp;
  }
  const pay = q.pay ?? 0;
  if (pay > 0) parts.leave = pay;
  const free = Math.min(pay, salaryOf(db, p) * 3);
  s.cash.gross[p.id] = (s.cash.gross[p.id] ?? 0) + grossOf(parts) - moved - free;
  p.paid = q.last;
  s.cash.wages[`leave-${p.id}`] = parts;
  post(s, -grossOf(parts), 'settle', `leave-${p.id}`);
}
