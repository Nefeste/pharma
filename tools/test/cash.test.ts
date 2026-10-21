// Часть 1д: касса (docs/specs/2026-10-engine.md, 1д). Заказ поставщику — предоплата и остаток после прихода; зарплата
// дважды в месяц с ночными часами и сверхурочными по табелю (Б4а); взносы; энергия — база и авансы; НДС квартала тремя
// долями; проценты по кредитной линии и извещение ниже предела. «Касса = начальная + проводки» проверяют инварианты на
// каждом шаге.
import { describe, expect, test } from 'bun:test';
import { legacy as db } from './legacy';
import type { ContentDb } from '../../src/content/types';
import { classOf } from '../../src/engine/places';
import { baseLoad, part } from '../../src/engine/cash';
import { DAY, daysFromCivil, HOUR, isShort, isWorkday, lastOfMonth, momentOf, normOf, workdayOnOrAfter, workdayOnOrBefore } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import type { Notice, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const pr = db.profiles[sc.profile];
const cal = calOf(db, { start: sc.start.date, scenario: SC });

/** Завод без серий, заказов поставщикам и покупателей: в кассе — только люди и энергия. */
const quiet: ContentDb = {
  ...db,
  scenarios: { ...db.scenarios, [SC]: { ...sc, batches: [], orders: [] } },
  customers: Object.fromEntries(Object.entries(db.customers).map(([id, c]) => [id, { ...c, demand: {} }])),
};

const dayOf = (s: PlantState, t = s.t) => momentOf(s.start, t).day;
const at = (s: PlantState, z: number, sec: number) => (z - daysFromCivil(s.start)) * DAY + sec;
const ymd = (y: number, m: number, d: number) => daysFromCivil({ y, m, d });

function live(base: ContentDb, s: PlantState, until: number): Notice[] {
  const out: Notice[] = [];
  while (s.t < until) {
    out.push(...apply(base, s, { kind: 'advance', seconds: Math.min(HOUR, until - s.t) }));
    const bad = check(base, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
  return out;
}

test('заказ поставщику: предоплата — сразу, остаток с НДС — через payDays после прихода; НДС — к вычету при приходе', () => {
  const s = newPlant(quiet, { scenario: SC });
  const sup = db.suppliers['sup.pack'];
  const qty = 20000;
  apply(quiet, s, { kind: 'po', supplier: sup.id, lines: [{ material: 'mat.pk.carton-n20', qty }] });
  const po = Object.values(s.pos)[0];
  const net = sup.items['mat.pk.carton-n20'].price * po.lines[0].qty;
  const vat = part(net, pr.vat.general);
  expect(po.sum).toBe(net + vat);
  expect(s.cash.ledger.at(-1)).toMatchObject({ item: 'prepay', sum: -part(net + vat, sup.prepay), ref: po.id });
  live(quiet, s, po.eta + HOUR);
  const due = s.cash.dues.find(d => d.ref === po.id)!;
  expect(due).toMatchObject({ item: 'supplier', sum: -(net + vat - po.prepaid!) });
  expect(dayOf(s, due.due)).toBe(workdayOnOrAfter(cal, dayOf(s, po.eta) + sup.payDays));
  expect(s.cash.vat.in).toBe(vat);
});

describe('месяц завода (сентябрь 2027)', () => {
  const s = newPlant(quiet, { scenario: SC });
  const y = sc.start.date.y;
  const m = sc.start.date.m;
  // до 16-го — зарплата за первую половину заведена; до 1-го — месяц закрыт
  live(quiet, s, at(s, ymd(y, m, 16), HOUR));
  const first = s.cash.dues.find(d => d.item === 'wages')!;
  const gross = { ...s.cash.gross };
  const wages = structuredClone(s.cash.wages);
  live(quiet, s, at(s, ymd(y, m + 1, 1), HOUR));

  test('зарплата за 1–15-е — последним рабочим днём месяца: половина оклада и доплаты по табелю — 20 % часовой ставки за ночной час, сверхурочные полуторные и двойные', () => {
    expect(dayOf(s, first.due)).toBe(workdayOnOrBefore(cal, lastOfMonth(y, m)));
    expect(momentOf(s.start, first.due).sec).toBe(10 * HOUR);
    // норма сентября 2027 года — 176 ч (Порядок 588н); часовая ставка — оклад на неё
    const norm = normOf(cal, y, m, pr.calendar.day, pr.calendar.short);
    expect(norm).toBe(176 * HOUR);
    const z0 = ymd(y, m, 1);
    const z1 = ymd(y, m, 15);
    const night = (sec: number) => sec >= 22 * HOUR || sec < 6 * HOUR;
    let sum = 0;
    let over = 0;
    for (const p of Object.values(s.people)) {
      const salary = db.roles[p.role].salary;
      const sh = db.shifts[p.shift];
      // по секундам: смена по графику — ночные; отрезки после смены — первые 2 ч полуторные, дальше двойные, в
      // выходной — двойные
      let n = 0;
      const o = [0, 0];
      let off = 0;
      for (let z = z0; z <= z1; z++) {
        if (!isWorkday(cal, z)) continue;
        const to = sh.to * HOUR - (isShort(cal, z) ? pr.calendar.short : 0);
        for (let t = sh.from * HOUR; t < to; t++) if (night(t)) n++;
      }
      for (const [a, b] of p.ot) {
        let done = 0;
        for (let t = a; t < b; t++) {
          const mt = momentOf(s.start, t);
          const mine = mt.day >= z0 && mt.day <= z1;
          if (isWorkday(cal, mt.day)) {
            if (mine) o[done < 2 * HOUR ? 0 : 1]++;
            done++;
          } else if (mine) off++;
          if (mine && night(mt.sec)) n++;
        }
      }
      over += o[0] + o[1] + off;
      const pay = (sec: number, rate: number) => (sec > 0 ? Math.floor((Math.floor((salary * sec) / norm) * rate) / 10000) : 0);
      const g = Math.floor(salary / 2) + pay(n, pr.payroll.night.extra) + pay(o[0], 15000) + pay(o[1], 20000) + pay(off, 20000);
      expect(gross[p.id]).toBe(g);
      sum += g;
    }
    expect(first.sum).toBe(-sum);
    const parts = wages[`${y}-${m}a`];
    expect(parts.salary + parts.night + parts.over + parts.off).toBe(sum);
    // у второй смены (15:00–23:00) ночной час — один в день: доплата есть только у неё
    const nightShift = Object.values(s.people).filter(p => p.shift === 'shift.b');
    expect(nightShift.length).toBeGreaterThan(0);
    for (const p of nightShift) expect(gross[p.id]).toBeGreaterThan(Math.floor(db.roles[p.role].salary / 2));
    expect(parts.night).toBeGreaterThan(0);
    expect(over === 0).toBe(parts.over + parts.off === 0);
  });

  test('первая половина выплачена в свой день; вторая — 15-го следующего месяца', () => {
    expect(s.cash.ledger.some(e => e.item === 'wages' && e.t === first.due && e.sum === first.sum)).toBe(true);
    const second = s.cash.dues.find(d => d.item === 'wages')!;
    expect(dayOf(s, second.due)).toBe(workdayOnOrBefore(cal, ymd(y, m + 1, 15)));
  });

  test('взносы за месяц — 30 % и 0,2 % выплат, до 28-го следующего месяца', () => {
    const contrib = s.cash.dues.find(d => d.item === 'contrib')!;
    let sum = 0;
    for (const [id, g] of Object.entries(s.cash.ytd)) sum += part(g, pr.payroll.contrib.rate) + part(g, pr.payroll.contrib.injury);
    expect(contrib.sum).toBe(-sum);
    expect(dayOf(s, contrib.due)).toBe(workdayOnOrAfter(cal, ymd(y, m + 1, pr.payroll.contrib.due)));
  });

  test('энергия: вентиляция и база круглые сутки; окончательный расчёт — 18-го, авансы 30 и 40 % — 10-го и 25-го', () => {
    const energy = s.cash.dues.filter(d => d.item === 'energy');
    // с 07:00 1-го до полуночи 1-го следующего месяца — только база: серий нет
    const sec = at(s, ymd(y, m + 1, 1), 0) - sc.start.hour * HOUR;
    const net = Math.floor((Math.floor((baseLoad(quiet, s) * sec) / HOUR) * sc.energy.price) / 1000);
    const cost = net + part(net, pr.vat.general);
    expect(s.cash.energy.last).toBe(cost);
    const final = energy.find(d => dayOf(s, d.due) === workdayOnOrAfter(cal, ymd(y, m + 1, pr.energy.final)))!;
    expect(final.sum).toBe(-cost);
    for (const [d, share] of pr.energy.advances) {
      const adv = energy.find(e => dayOf(s, e.due) === workdayOnOrAfter(cal, ymd(y, m + 1, d)))!;
      expect(adv.sum).toBe(-part(cost, share));
    }
  });
});

test('НДС квартала — тремя долями до 28-го числа каждого из трёх следующих месяцев; минус — к вычету дальше', () => {
  const s = newPlant(quiet, { scenario: SC });
  const y = sc.start.date.y;
  s.cash.vat = { out: 100_000_001, in: 10_000_000, carry: 0 };
  live(quiet, s, at(s, ymd(y, 10, 1), HOUR));
  const vat = s.cash.dues.filter(d => d.item === 'vat');
  // начисленный за квартал НДС минус вычет, в том числе по энергии сентября (её считают в ту же полночь) и по счетам
  // подрядчика за калибровку и квалификацию (Б3в): НДС в счёте — по цене работы класса
  const sec = at(s, ymd(y, 10, 1), 0) - sc.start.hour * HOUR;
  const net = Math.floor((Math.floor((baseLoad(quiet, s) * sec) / HOUR) * sc.energy.price) / 1000);
  const visits = s.cash.ledger.filter(e => e.item === 'calqual' && e.t < at(s, ymd(y, 10, 1), 0));
  const visitVat = visits.reduce((n, e) => {
    const cls = classOf(quiet, s.assets[e.ref!]);
    const w = [cls.qual, cls.cal].find(x => x && x.price + part(x.price, pr.vat.general) === -e.sum)!;
    return n + part(w.price, pr.vat.general);
  }, 0);
  const due = 100_000_001 - 10_000_000 - part(net, pr.vat.general) - visitVat;
  expect(vat.length).toBe(3);
  expect(vat.reduce((n, d) => n + d.sum, 0)).toBe(-due);
  expect(vat.map(d => -d.sum)).toEqual([Math.floor(due / 3), Math.floor(due / 3), due - 2 * Math.floor(due / 3)]);
  for (const [i, d] of vat.entries()) expect(dayOf(s, d.due)).toBe(workdayOnOrAfter(cal, ymd(y, 10 + i, pr.vatDue)));
  // следующий квартал — вычет больше начисленного: переходит дальше, платить нечего
  s.cash.vat = { out: 0, in: 500_000, carry: 0 };
  live(quiet, s, at(s, ymd(y + 1, 1, 1), HOUR));
  expect(s.cash.dues.filter(d => d.item === 'vat' && momentOf(s.start, d.due).date.y === y + 1).length).toBe(0);
  expect(s.cash.vat.carry).toBeGreaterThan(500_000);
});

test('кредитная линия: проценты на минус каждые сутки; ниже предела — извещение раз в сутки', () => {
  const s = newPlant(quiet, { scenario: SC });
  const limit = sc.credit.limit;
  s.cash.balance = -limit - 100_000_00;
  s.cash.start = s.cash.balance;
  const out = live(quiet, s, at(s, dayOf(s) + 3, 0) + HOUR);
  const rate = pr.key + sc.credit.spread;
  // три полуночи с минусом: проценты — каждые сутки
  expect(s.cash.interest).toBeGreaterThanOrEqual(3 * Math.floor(((limit + 100_000_00) * rate) / (365 * 10000)) - 3);
  const low = out.filter(n => n.kind === 'cashLow');
  expect(low.length).toBeGreaterThanOrEqual(3);
  expect(low.length).toBeLessThanOrEqual(4);
});
