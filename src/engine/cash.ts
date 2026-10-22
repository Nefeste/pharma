// Касса (docs/specs/2026-10-engine.md, 1д; геймдизайн, §12): копейки и проводки. Платежи — в 10:00 рабочего дня; срок,
// выпавший на выходной, — на следующий рабочий день, а зарплата — накануне (ст. 136 ТК РФ). Зарплата — дважды в месяц,
// взносы и энергия — помесячно, НДС — за квартал, проценты по кредитной линии — за сутки. Рабочие дни — по
// производственному календарю профиля, зарплата — по табелю (Б4а). Правила — из профиля (ADR 0004), цены и предел
// кредита — из сценария.
import type { ContentDb, Profile } from '../content/types';
import { civilFromDays, DAY, daysFromCivil, HOUR, isWorkday, lastOfMonth, momentOf, normOf, workdayOnOrAfter, workdayOnOrBefore } from './core/calendar';
import { pruneSheet, type SheetDay, sheetDays } from './hours';
import { planOf } from './plant';
import { scheduleOn } from './shifts';
import { nextId } from './stock';
import type { Cash, CashItem, Notice, Person, PlantState, WageParts } from './types';
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

/** Каждый час: в полночь — сутки и границы месяца и квартала; в час банка рабочего дня — платежи. */
export function cashHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  const now = momentOf(s.start, s.t);
  if (now.sec === 0) midnight(db, s, now.day);
  if (now.sec === BANK_HOUR && isWorkday(calOf(db, s), now.day)) {
    while (s.cash.dues.length > 0 && s.cash.dues[0].due <= s.t) {
      const d = s.cash.dues.shift()!;
      post(s, d.sum, d.item, d.ref);
    }
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
export function extras(db: ContentDb, s: PlantState, p: Person, y: number, m: number, from: number, to: number): Required<Omit<WageParts, 'salary'>> {
  const pr = profileOf(db, s).payroll;
  const cal = calOf(db, s);
  const salary = db.roles[p.role].salary;
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

/**
 * Зарплата за дни `from`–`to` месяца: половина оклада роли (первая половина — вниз до копейки, вторая — остаток, чтобы
 * месяц сходился) и доплаты за эти дни по табелю (`extras`); части — в кассу под ссылкой `ref`, для окна.
 */
function wages(db: ContentDb, s: PlantState, y: number, m: number, from: number, to: number, ref: string): number {
  const parts: WageParts = { salary: 0, night: 0, over: 0, off: 0 };
  for (const p of Object.values(s.people)) {
    const salary = db.roles[p.role].salary;
    const half = Math.floor(salary / 2);
    const base = from === 1 ? half : salary - half;
    const x = extras(db, s, p, y, m, from, to);
    const gross = base + x.night + x.over + x.off + x.period;
    parts.salary += base;
    parts.night += x.night;
    parts.over += x.over;
    parts.off += x.off;
    if (x.period > 0) parts.period = (parts.period ?? 0) + x.period;
    s.cash.gross[p.id] = (s.cash.gross[p.id] ?? 0) + gross;
  }
  s.cash.wages[ref] = parts;
  return parts.salary + parts.night + parts.over + parts.off + (parts.period ?? 0);
}
