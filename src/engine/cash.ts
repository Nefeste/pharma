// Касса (docs/specs/2026-10-engine.md, 1д; геймдизайн, §12): копейки и проводки. Платежи — в 10:00 рабочего дня; срок,
// выпавший на выходной, — на следующий рабочий день, а зарплата — накануне (ст. 136 ТК РФ). Зарплата — дважды в месяц,
// взносы и энергия — помесячно, НДС — за квартал, проценты по кредитной линии — за сутки. Праздников в календаре пока
// нет. Правила — из профиля (ADR 0004), цены и предел кредита — из сценария.
import type { ContentDb, Profile } from '../content/types';
import { civilFromDays, DAY, daysFromCivil, HOUR, lastOfMonth, momentOf, weekday, workdayOnOrAfter, workdayOnOrBefore, workdaysIn } from './core/calendar';
import { planOf } from './plant';
import { nextId } from './stock';
import type { Cash, CashItem, Notice, PlantState } from './types';

/** Час банка: платежи и поступления дня. */
export const BANK_HOUR = 10 * HOUR;

const P = 10000;

export function newCash(start: number, t: number): Cash {
  return { balance: start, start, ledger: [], dues: [], vat: { out: 0, in: 0, carry: 0 }, energy: { wh: 0, at: t, last: 0, advanced: 0 }, ytd: {}, gross: {}, interest: 0 };
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
export function dueIn(s: PlantState, days: number): number {
  return at(s, workdayOnOrAfter(momentOf(s.start, s.t).day + days), BANK_HOUR);
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

/** Мощность, которая работает круглые сутки: вентиляция по площади помещений и их классу и постоянная база, Вт. */
export function baseLoad(db: ContentDb, s: PlantState): number {
  const plant = planOf(db, s.plant).plant;
  let w = plant.energy.base;
  // площадь — см² → м²
  for (const r of plant.rooms) w += Math.floor((r.rect[2] * r.rect[3] * plant.energy.hvac[r.grade]) / 10000);
  return w;
}

/** Каждый час: в полночь — сутки и границы месяца и квартала; в час банка рабочего дня — платежи. */
export function cashHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  const now = momentOf(s.start, s.t);
  if (now.sec === 0) midnight(db, s, now.day);
  if (now.sec === BANK_HOUR && now.weekday < 5) {
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
  const c = s.cash;
  // с прошлой полуночи (или с начала партии): вентиляция и база
  addEnergy(s, baseLoad(db, s), s.t - c.energy.at);
  c.energy.at = s.t;
  // проценты по кредитной линии — на минус кассы за сутки (ст. 850 ГК РФ)
  if (c.balance < 0) c.interest += Math.floor((-c.balance * (pr.key + sc.credit.spread)) / (365 * P));
  const date = civilFromDays(z);
  // 16-е: зарплата за 1–15-е — последним днём месяца, выпал выходной — накануне
  if (date.d === 16) {
    const pay = wages(db, s, date.y, date.m, 1, 15);
    owe(s, 'wages', -pay, at(s, workdayOnOrBefore(lastOfMonth(date.y, date.m)), BANK_HOUR), `${date.y}-${date.m}a`);
  }
  if (date.d !== 1) return;
  // 1-е: закрыть прошлый месяц
  const pm = date.m === 1 ? 12 : date.m - 1;
  const py = date.m === 1 ? date.y - 1 : date.y;
  const ref = `${py}-${pm}`;
  // зарплата за 16-е — конец месяца — 15-го, выпал выходной — накануне
  const pay = wages(db, s, py, pm, 16, lastOfMonth(py, pm) - daysFromCivil({ y: py, m: pm, d: 1 }) + 1);
  owe(s, 'wages', -pay, at(s, workdayOnOrBefore(daysFromCivil({ y: date.y, m: date.m, d: 15 })), BANK_HOUR), `${ref}b`);
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
  owe(s, 'contrib', -contrib, at(s, workdayOnOrAfter(daysFromCivil({ y: date.y, m: date.m, d: ct.due })), BANK_HOUR), ref);
  // энергия за месяц: стоимость с НДС; окончательный расчёт — минус авансы; авансы нового месяца — от этой стоимости
  const net = Math.floor((c.energy.wh * sc.energy.price) / 1000);
  const tax = part(net, pr.vat.general);
  c.vat.in += tax;
  const cost = net + tax;
  owe(s, 'energy', -(cost - c.energy.advanced), at(s, workdayOnOrAfter(daysFromCivil({ y: date.y, m: date.m, d: pr.energy.final })), BANK_HOUR), ref);
  c.energy = { wh: 0, at: s.t, last: cost, advanced: 0 };
  for (const [d, share] of pr.energy.advances) {
    const adv = part(cost, share);
    c.energy.advanced += adv;
    owe(s, 'energy', -adv, at(s, workdayOnOrAfter(daysFromCivil({ y: date.y, m: date.m, d })), BANK_HOUR), `${date.y}-${date.m}`);
  }
  // проценты за месяц — в первый рабочий день нового
  owe(s, 'interest', -c.interest, at(s, workdayOnOrAfter(z), BANK_HOUR), ref);
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
        owe(s, 'vat', -(k < 2 ? third : due - 2 * third), at(s, workdayOnOrAfter(daysFromCivil({ y, m, d: pr.vatDue })), BANK_HOUR), `${py}-q${Math.ceil(pm / 3)}`);
      }
    }
  }
}

/**
 * Зарплата за дни `from`–`to` месяца: половина оклада роли (первая половина — вниз до копейки, вторая — остаток, чтобы
 * месяц сходился) и доплата за ночные часы графика — доля часовой ставки; часовая ставка — оклад на рабочие часы месяца.
 */
function wages(db: ContentDb, s: PlantState, y: number, m: number, from: number, to: number): number {
  const night = profileOf(db, s).payroll.night;
  const hours = workdaysIn(y, m) * 8;
  const first = daysFromCivil({ y, m, d: 1 });
  let sum = 0;
  for (const p of Object.values(s.people)) {
    const salary = db.roles[p.role].salary;
    const half = Math.floor(salary / 2);
    const sh = db.shifts[p.shift];
    let nightHours = 0;
    for (let d = from; d <= to; d++) {
      if (!sh.days.includes(weekday(first + d - 1))) continue;
      for (let h = sh.from; h < sh.to; h++) if (night.from > night.to ? h >= night.from || h < night.to : h >= night.from && h < night.to) nightHours++;
    }
    const gross = (from === 1 ? half : salary - half) + Math.floor((salary * nightHours * night.extra) / (hours * P));
    s.cash.gross[p.id] = (s.cash.gross[p.id] ?? 0) + gross;
    sum += gross;
  }
  return sum;
}
