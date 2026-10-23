// Найм и увольнение (Б4в; docs/specs/2026-10-vertical-slice.md, «Проверки Б4в»): кандидаты по объявлению и от агентства;
// приём — медосмотр, первый день, табельный номер, обучение сразу, до допуска — только обучение, испытание; увольнение —
// по соглашению, не выдержал испытание, по собственному желанию, «отпустить раньше»; расчёт по ст. 140 на примере; уход
// после последней смены; коллега нанимает замену, а пост у игрока — нет; чужой пост — отказ; мойка оборудования, потом
// уборка помещения; образец схемы 23 — с уборщиками; сборщик базы — рынок труда, секунды уборки, пост уборщика.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { avgDaily, extras, settle } from '../../src/engine/cash';
import { addMonths, addWorkdays, DAY, daysFromCivil, HOUR, momentOf, weekday } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { sheetDays } from '../../src/engine/hours';
import { compDays } from '../../src/engine/leave';
import { check } from '../../src/engine/invariants';
import { admitted, matrixOf, needOf } from '../../src/engine/quals';
import { fromSave } from '../../src/engine/save';
import { periodOf, saResult, spanOn } from '../../src/engine/shifts';
import type { Notice, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { buildDb } from '../content/load';

const SC = 'scn.proto';
const P = 10000;
const lab = db.scenarios[SC].labor!;
const start = daysFromCivil(db.scenarios[SC].start.date);
/** Игровые секунды от начала партии до часа `hour` дня `day`. */
const at = (day: number, hour: number) => (day - start) * DAY + hour * HOUR;
const today = (s: PlantState) => momentOf(s.start, s.t).day;
const ymd = (y: number, m: number, d: number) => daysFromCivil({ y, m, d });

/**
 * Копия базы: никто не уходит сам, кроме ролей `quit` (доли 1/10 000 за год); у роли `role` на объявление всегда три
 * отклика, навык — `skill`, если задан.
 */
function market(o: { role?: string; skill?: number; quit?: Record<string, number> } = {}): ContentDb {
  const d = structuredClone(db) as ContentDb;
  const l = d.scenarios[SC].labor!;
  for (const r of Object.keys(l.roles)) l.roles[r].quit = o.quit?.[r] ?? 0;
  if (o.role) {
    l.roles[o.role].ad = [0, 0, 0, P];
    if (o.skill) l.roles[o.role].skill = [1, 2, 3, 4, 5].map(k => (k === o.skill ? P : 0)) as [number, number, number, number, number];
  }
  return d;
}

function live(d: ContentDb, s: PlantState, until: number, each?: (n: Notice[]) => void) {
  while (s.t < until) {
    const n = apply(d, s, { kind: 'advance', seconds: Math.min(HOUR, until - s.t) });
    each?.(n);
    const bad = check(d, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
}

/** Ближайший понедельник, в 09:00 которого ещё не было. */
function monday(s: PlantState): number {
  let z = today(s);
  while (weekday(z) !== 0 || at(z, 9) <= s.t) z++;
  return z;
}

const hiring = (s: PlantState, ref: string) => s.cash.ledger.filter(e => e.item === 'hiring' && e.ref === ref);

describe('рынок труда', () => {
  test('объявление: в понедельник в 09:00 — отклики по записи рынка и плата за неделю; кандидат ищет работу свой срок', () => {
    const d = market({ role: 'role.operator' });
    const s = newPlant(d, { scenario: SC });
    const n = apply(d, s, { kind: 'vacancy', role: 'role.operator', shift: 'shift.a', via: 'ad' });
    expect(n).toEqual([{ kind: 'vacancy', id: 'J1', role: 'role.operator', shift: 'shift.a', via: 'ad' }]);
    const mon = monday(s);
    const got: Notice[] = [];
    live(d, s, at(mon, 10), x => got.push(...x));
    expect(got.filter(x => x.kind === 'candidates')).toEqual([{ kind: 'candidates', vacancy: 'J1', role: 'role.operator', n: 3 }]);
    const ks = Object.values(s.candidates);
    expect(ks.map(c => c.id)).toEqual(['K1', 'K2', 'K3']);
    for (const c of ks) {
      expect(c).toMatchObject({ vacancy: 'J1', via: 'ad', role: 'role.operator', from: mon, until: mon + lab.wait });
      expect(c.skill).toBeGreaterThanOrEqual(1);
      expect(c.skill).toBeLessThanOrEqual(5);
      expect(c.salary % 50000).toBe(0);
    }
    expect(hiring(s, 'ad-J1')).toEqual([{ t: at(mon, 9), sum: -lab.ad, item: 'hiring', ref: 'ad-J1' }]);
    // через срок поиска первые трое нашли другую работу; каждую неделю — новые отклики и плата
    live(d, s, at(mon + lab.wait + 1, 1));
    expect(Object.keys(s.candidates).some(k => ['K1', 'K2', 'K3'].includes(k))).toBe(false);
    expect(Object.values(s.candidates).every(c => c.from > mon)).toBe(true);
    expect(hiring(s, 'ad-J1').map(e => e.t)).toEqual([at(mon, 9), at(mon + 7, 9), at(mon + 14, 9)]);
  }, 120_000);

  test('ожидание оклада — уровень роли, выше с навыком, до 500 ₽', () => {
    const d = market({ role: 'role.packer' });
    const s = newPlant(d, { scenario: SC });
    apply(d, s, { kind: 'vacancy', role: 'role.packer', shift: 'shift.a', via: 'ad' });
    live(d, s, at(today(s) + 6 * 7, 10));
    const level = d.roles['role.packer'].salary;
    const all = Object.values(s.candidates);
    expect(all.length).toBeGreaterThanOrEqual(6);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    for (const c of all) {
      const base = level + Math.floor((level * lab.step * (c.skill - 3)) / P);
      expect(Math.abs(c.salary - base)).toBeLessThanOrEqual(Math.ceil((6 * base * lab.spread) / P) + 25000);
    }
    const hi = all.filter(c => c.skill >= 4).map(c => c.salary);
    const lo = all.filter(c => c.skill <= 2).map(c => c.salary);
    if (hi.length && lo.length) expect(mean(hi)).toBeGreaterThan(mean(lo));
  }, 120_000);

  test('агентство: опытный кандидат через 2–4 недели в 09:00; плата — доля годового оклада, когда его принимают', () => {
    const d = market();
    const s = newPlant(d, { scenario: SC });
    // уполномоченного лица по объявлению не найти — только агентство
    expect(d.scenarios[SC].labor!.roles['role.qp'].ad).toEqual([P, 0, 0, 0]);
    const z0 = today(s);
    apply(d, s, { kind: 'vacancy', role: 'role.qp', shift: 'shift.day', via: 'agency' });
    const next = s.vacancies.J1.next!;
    expect(next % DAY).toBe(9 * HOUR);
    const wait = Math.floor(next / DAY) - (z0 - start);
    expect(wait).toBeGreaterThanOrEqual(lab.agency.days[0]);
    expect(wait).toBeLessThanOrEqual(lab.agency.days[1]);
    live(d, s, next + HOUR);
    const [c] = Object.values(s.candidates);
    expect(c).toMatchObject({ via: 'agency', role: 'role.qp', vacancy: 'J1' });
    expect(c.skill).toBeGreaterThanOrEqual(lab.agency.skill[0]);
    expect(c.skill).toBeLessThanOrEqual(lab.agency.skill[1]);
    expect(s.cash.ledger.filter(e => e.item === 'hiring')).toEqual([]);
    apply(d, s, { kind: 'hire', candidate: c.id, trial: 3 });
    expect(hiring(s, `agency-${c.id}`).map(e => e.sum)).toEqual([-Math.floor((c.salary * 12 * lab.agency.share) / P)]);
    expect(hiring(s, `med-${c.id}`).map(e => e.sum)).toEqual([-lab.medical.price]);
  }, 120_000);
});

describe('приём', () => {
  test('медосмотр в рабочие дни, первый день — смена графика после него, табельный номер следующий, обучение сразу', () => {
    const d = market({ role: 'role.operator' });
    const s = newPlant(d, { scenario: SC });
    apply(d, s, { kind: 'vacancy', role: 'role.operator', shift: 'shift.a', via: 'ad' });
    live(d, s, at(monday(s), 10));
    const k = Object.values(s.candidates)[0];
    const z0 = today(s);
    const n = apply(d, s, { kind: 'hire', candidate: k.id, trial: 1 });
    const h = s.hires[k.id];
    expect(h.exam).toBe(addWorkdays(calOf(d, s), z0, lab.medical.days));
    let first = h.exam + 1;
    while (!spanOn(d, s, { shift: 'shift.a' }, first)) first++;
    expect(h.day).toBe(first);
    expect(h.at).toBe(at(first, 7));
    expect(n).toEqual([{ kind: 'accepted', candidate: k.id, role: 'role.operator', day: first }]);
    // вакансия закрыта приёмом, её кандидаты ушли
    expect(s.vacancies).toEqual({});
    expect(s.candidates).toEqual({});
    const got: Notice[] = [];
    live(d, s, h.at + HOUR, x => got.push(...x));
    const people = db.scenarios[SC].staff.reduce((a, r) => a + r.n, 0);
    expect(got.filter(x => x.kind === 'hired')).toEqual([{ kind: 'hired', person: `E${people + 1}`, role: 'role.operator', tab: 1001 + people }]);
    const p = s.people[`E${people + 1}`];
    expect(p).toMatchObject({ role: 'role.operator', shift: 'shift.a', skill: k.skill, salary: k.salary, hired: first, trial: addMonths(first, 1) - 1 });
    const studies = Object.values(s.tasks).filter(t => t.kind === 'train' && t.trainee === p.id);
    expect(studies.length).toBe(matrixOf(d, 'role.operator').length);
    // до допуска — только обучение: любую другую работу новичок берёт, лишь когда допущен к ней
    let other = 0;
    live(d, s, h.at + 10 * DAY, () => {
      const t = p.task ? s.tasks[p.task] : undefined;
      if (!t || t.kind === 'train') return;
      other++;
      expect(admitted(d, p, needOf(d, s, t), today(s))).toBe(true);
    });
    expect(other).toBeGreaterThan(0);
    // испытание кончается накануне того же числа: на следующий день его нет
    live(d, s, at(p.trial! + 1, 1));
    expect(p.trial).toBeUndefined();
  }, 120_000);

  test('испытание — не длиннее предела профиля; кандидата нет — отказ', () => {
    const d = market({ role: 'role.operator' });
    const s = newPlant(d, { scenario: SC });
    apply(d, s, { kind: 'vacancy', role: 'role.operator', shift: 'shift.a', via: 'ad' });
    live(d, s, at(monday(s), 10));
    const k = Object.values(s.candidates)[0];
    const law = d.profiles[d.scenarios[SC].profile].labor.probation;
    expect(apply(d, s, { kind: 'hire', candidate: k.id, trial: law + 1 })).toEqual([{ kind: 'refused', cmd: 'hire', why: 'trialLong' }]);
    expect(apply(d, s, { kind: 'hire', candidate: 'K99', trial: 1 })).toEqual([{ kind: 'refused', cmd: 'hire', why: 'noCandidate' }]);
    expect(apply(d, s, { kind: 'close', vacancy: 'J1' })).toEqual([]);
    expect(s.candidates).toEqual({});
    expect(apply(d, s, { kind: 'close', vacancy: 'J1' })).toEqual([{ kind: 'refused', cmd: 'close', why: 'noVacancy' }]);
  }, 120_000);
});

describe('увольнение', () => {
  test('по соглашению: последний день — сегодня, выплата — окладов по записи рынка; уходит после смены и больше не приходит', () => {
    const d = market();
    const s = newPlant(d, { scenario: SC });
    // понедельник, 20 сентября 2027 года, 10:00: упаковщик в смене (07:00–15:00)
    const z = ymd(2027, 9, 20);
    live(d, s, at(z, 10));
    const p = s.people.E16;
    expect(p.role).toBe('role.packer');
    const salary = d.roles['role.packer'].salary;
    const dueA = () => s.cash.dues.find(x => x.item === 'wages' && x.ref === '2027-9a')!.sum;
    const before = dueA();
    const gross0 = s.cash.gross.E16;
    expect(apply(d, s, { kind: 'dismiss', person: 'E16', why: 'agree' })).toEqual([{ kind: 'dismissed', person: 'E16', role: 'role.packer', tab: p.tab, why: 'agree', last: z }]);
    expect(p.quit).toEqual({ why: 'agree', day: z, last: z, pay: Math.floor((salary * lab.agree) / P) });
    expect(lab.agree).toBe(2 * P);
    const got: Notice[] = [];
    live(d, s, at(z, 16), x => got.push(...x));
    expect(got.filter(x => x.kind === 'left')).toEqual([{ kind: 'left', person: 'E16', role: 'role.packer', tab: p.tab, why: 'agree' }]);
    expect(s.people.E16).toBeUndefined();
    expect(s.former.E16.quit!.why).toBe('agree');
    // расчёт по ст. 140 на примере: оклад 1–20 сентября — 14 смен по 8 ч из нормы 176 ч; первая половина, начисленная
    // 16-го, — из общей выплаты 30-го в расчёт; выплата по соглашению — два оклада, без взносов до трёх окладов;
    // компенсация за отпуск (Б4г) — 20 дней с начала завода — месяц (не меньше половины), 28 / 12 = 2,33 дня по среднему
    // дневному: до начала завода — оклад на 29,3
    const half = Math.floor(salary / 2);
    const worked = Math.floor((salary * 14 * 8) / 176);
    const a = extras(d, s, s.former.E16, 2027, 9, 1, 15);
    const b = extras(d, s, s.former.E16, 2027, 9, 16, 20);
    const parts = s.cash.wages['leave-E16'];
    expect(compDays(d, s, s.former.E16, z)).toBe(233);
    expect(avgDaily(d, s, s.former.E16, 2027, 9)).toBe(Math.floor((salary * 1000) / 29300));
    const comp = Math.floor((233 * Math.floor((salary * 1000) / 29300)) / 100);
    expect(parts).toEqual({ salary: worked, night: a.night + b.night, over: a.over + b.over, off: a.off + b.off, leave: 2 * salary, comp });
    const firstHalf = half + a.night + a.over + a.off;
    expect(dueA()).toBe(before + firstHalf);
    const sum = parts.salary + parts.night + parts.over + parts.off + parts.leave! + comp;
    expect(s.cash.ledger.filter(e => e.item === 'settle')).toEqual([{ t: expect.any(Number), sum: -sum, item: 'settle', ref: 'leave-E16' }]);
    expect(s.cash.gross.E16).toBe(gross0 + (worked - half) + b.night + b.over + b.off + comp);
    // больше не приходит: ни задач, ни смен
    live(d, s, at(z + 10, 12), () => {
      expect(Object.values(s.tasks).some(t => t.people.includes('E16'))).toBe(false);
    });
    expect(spanOn(d, s, s.former.E16, z + 1)).toBeUndefined();
  }, 120_000);

  test('сменный по циклу: в расчёт — итог учётного периода по последний день', () => {
    // аппаратчик второй смены с 1 октября 2027 года — в бригаде 1; четыре дня в декабре после дневной смены — по 4 ч;
    // по соглашению — последний день в декабре, после его дневной смены
    const s = newPlant(db, { scenario: SC });
    const p = Object.values(s.people).find(x => x.role === 'role.operator' && x.shift === 'shift.b')!;
    p.roster = [{ shift: 'shift.b', from: start }, { shift: 'shift.c1', from: ymd(2027, 10, 1) }];
    p.shift = 'shift.c1';
    const [first] = periodOf(db, s, ymd(2027, 10, 1));
    const days: number[] = [];
    for (let d = ymd(2027, 12, 1); d <= ymd(2027, 12, 31); d++) if (spanOn(db, s, p, d)?.[0] === at(d, 8)) days.push(d);
    // 23 декабря: к нему по графику — меньше нормы, но с часами после смен — больше
    const last = days[5];
    expect(last).toBe(ymd(2027, 12, 23));
    p.sa = { from: at(first, 0), segs: days.slice(0, 4).map(d => [at(d, 20), at(d, 24)] as [number, number]) };
    s.t = at(last, 21);
    p.quit = { why: 'agree', day: last, last, pay: Math.floor((db.roles[p.role].salary * lab.agree) / P) };
    const res = saResult(db, s, p, first, last, s.t)!;
    expect(res.pay).toBeGreaterThan(0);
    settle(db, s, p);
    expect(s.cash.wages[`leave-${p.id}`]).toMatchObject({ period: res.pay, leave: p.quit.pay });
  });

  test('доля оклада по последний день меньше начисленной половины — за последние дни ноль, удержания нет', () => {
    // упаковщик, 16 ноября 2027 года: первую половину ноября начислили целой 16-го, а за 1–16 ноября у пятидневки
    // 79 ч из нормы 159 ч — меньше половины оклада
    const s = newPlant(db, { scenario: SC });
    const p = s.people.E16;
    const salary = db.roles[p.role].salary;
    const z = ymd(2027, 11, 16);
    s.t = at(z, 16);
    p.paid = z - 1;
    p.half = { y: 2027, m: 11, base: Math.floor(salary / 2) };
    p.quit = { why: 'agree', day: z, last: z, pay: 2 * salary };
    expect(sheetDays(db, s, p, ymd(2027, 11, 1), z).reduce((n, d) => n + d.work, 0)).toBe(79 * HOUR);
    expect(Math.floor((salary * 79) / 159)).toBeLessThan(Math.floor(salary / 2));
    settle(db, s, p);
    expect(s.cash.wages[`leave-${p.id}`]).toMatchObject({ salary: 0, leave: 2 * salary });
  });

  test('не выдержал испытание: последний день через три дня и только в срок испытания; у человека без испытания — отказ', () => {
    const d = market({ role: 'role.packer' });
    const s = newPlant(d, { scenario: SC });
    expect(apply(d, s, { kind: 'dismiss', person: 'E16', why: 'trial' })).toEqual([{ kind: 'refused', cmd: 'dismiss', why: 'notTrial' }]);
    apply(d, s, { kind: 'vacancy', role: 'role.packer', shift: 'shift.a', via: 'ad' });
    live(d, s, at(monday(s), 10));
    const k = Object.values(s.candidates)[0];
    apply(d, s, { kind: 'hire', candidate: k.id, trial: 1 });
    const h = s.hires[k.id];
    live(d, s, h.at + HOUR);
    const p = Object.values(s.people).find(x => x.hired === h.day)!;
    const z = today(s);
    const law = d.profiles[d.scenarios[SC].profile].labor.trial;
    expect(apply(d, s, { kind: 'dismiss', person: p.id, why: 'trial' })).toEqual([{ kind: 'dismissed', person: p.id, role: 'role.packer', tab: p.tab, why: 'trial', last: z + law }]);
    expect(apply(d, s, { kind: 'dismiss', person: p.id, why: 'agree' })).toEqual([{ kind: 'refused', cmd: 'dismiss', why: 'leaving' }]);
    live(d, s, at(z + law + 1, 12));
    expect(s.former[p.id]?.quit?.why).toBe('trial');
  }, 120_000);

  test('не выдержал испытание: до конца испытания меньше трёх дней — отказ', () => {
    const d = market({ role: 'role.packer' });
    const s = newPlant(d, { scenario: SC });
    apply(d, s, { kind: 'vacancy', role: 'role.packer', shift: 'shift.a', via: 'ad' });
    live(d, s, at(monday(s), 10));
    const k = Object.values(s.candidates)[0];
    apply(d, s, { kind: 'hire', candidate: k.id, trial: 1 });
    const h = s.hires[k.id];
    live(d, s, h.at + HOUR);
    const p = Object.values(s.people).find(x => x.hired === h.day)!;
    live(d, s, at(p.trial! - 1, 10));
    expect(apply(d, s, { kind: 'dismiss', person: p.id, why: 'trial' })).toEqual([{ kind: 'refused', cmd: 'dismiss', why: 'tooLate' }]);
  }, 120_000);

  test('по собственному желанию: через две недели, с нерабочего дня — на ближайший рабочий; «отпустить раньше»', () => {
    const d = market();
    const s = newPlant(d, { scenario: SC });
    // заявления — в полночь субботы 4 сентября 2027 года: две недели — суббота 18-го, рабочий день упаковщика — 20-е
    const sat = ymd(2027, 9, 4);
    expect(weekday(sat)).toBe(5);
    live(d, s, at(sat, 0) - HOUR);
    d.scenarios[SC].labor!.roles['role.packer'].quit = 365 * P;
    const got: Notice[] = [];
    live(d, s, at(sat, 1), x => got.push(...x));
    d.scenarios[SC].labor!.roles['role.packer'].quit = 0;
    const mon = ymd(2027, 9, 20);
    expect(got.filter(x => x.kind === 'resign')).toEqual([
      { kind: 'resign', person: 'E16', role: 'role.packer', tab: s.people.E16.tab, dept: 'line', last: mon },
      { kind: 'resign', person: 'E17', role: 'role.packer', tab: s.people.E17.tab, dept: 'line', last: mon },
      { kind: 'resign', person: 'E24', role: 'role.packer', tab: s.people.E24.tab, dept: 'line', last: mon },
    ]);
    expect(s.people.E16.quit).toEqual({ why: 'own', day: sat, last: mon });
    // отпустить раньше — по соглашению, основание то же; без заявления — отказ
    live(d, s, at(sat + 2, 10));
    expect(apply(d, s, { kind: 'dismiss', person: 'E16', why: 'early' })).toEqual([{ kind: 'dismissed', person: 'E16', role: 'role.packer', tab: s.people.E16.tab, why: 'own', last: sat + 2 }]);
    expect(apply(d, s, { kind: 'dismiss', person: 'E15', why: 'early' })).toEqual([{ kind: 'refused', cmd: 'dismiss', why: 'noNotice' }]);
    live(d, s, at(sat + 3, 1));
    expect(s.former.E16.quit).toMatchObject({ why: 'own', last: sat + 2 });
    expect(s.people.E17.quit!.last).toBe(mon);
  }, 120_000);
});

describe('коллеги и посты', () => {
  /** Заявления всех трёх упаковщиков в полночь 2 сентября 2027 года; отклики — трое с навыком 3. */
  function resign(seats?: ('production' | 'quality')[]) {
    const d = market({ role: 'role.packer', skill: 3 });
    const s = newPlant(d, { scenario: SC });
    if (seats) apply(d, s, { kind: 'seat', seats });
    d.scenarios[SC].labor!.roles['role.packer'].quit = 365 * P;
    live(d, s, at(start + 1, 1));
    d.scenarios[SC].labor!.roles['role.packer'].quit = 0;
    return { d, s };
  }

  test('пост не у игрока: коллега открывает вакансию на каждое заявление и принимает первого подходящего', () => {
    const { d, s } = resign();
    const got: Notice[] = [];
    live(d, s, at(start + 1, 10), x => got.push(...x));
    expect(got.filter(x => x.kind === 'vacancy')).toEqual([
      { kind: 'vacancy', id: 'J1', role: 'role.packer', shift: 'shift.a', via: 'ad', by: 'colleague' },
      { kind: 'vacancy', id: 'J2', role: 'role.packer', shift: 'shift.a', via: 'ad', by: 'colleague' },
      { kind: 'vacancy', id: 'J3', role: 'role.packer', shift: 'shift.a', via: 'ad', by: 'colleague' },
    ]);
    expect(s.vacancies.J1).toMatchObject({ by: 'colleague', instead: 'E16' });
    expect(s.people.E16.quit!.vacancy).toBe('J1');
    live(d, s, at(monday(s), 10), x => got.push(...x));
    const acc = got.filter(x => x.kind === 'accepted');
    expect(acc.length).toBe(3);
    expect(s.vacancies).toEqual({});
    const level = d.roles['role.packer'].salary;
    for (const h of Object.values(s.hires)) {
      expect(h.skill).toBeGreaterThanOrEqual(lab.colleague.skill);
      expect(h.salary).toBeLessThanOrEqual(level + Math.floor((level * lab.colleague.over) / P));
      expect(h.trial).toBe(lab.probation);
    }
  }, 120_000);

  test('пост у игрока: коллега молчит; команды чужого поста — отказ', () => {
    const { d, s } = resign(['production']);
    live(d, s, at(start + 8, 10));
    expect(s.vacancies).toEqual({});
    expect(s.people.E16.quit!.vacancy).toBeUndefined();
    const q = newPlant(d, { scenario: SC });
    apply(d, q, { kind: 'seat', seats: ['quality'] });
    expect(apply(d, q, { kind: 'vacancy', role: 'role.operator', shift: 'shift.a', via: 'ad' })).toEqual([{ kind: 'refused', cmd: 'vacancy', why: 'notYours', detail: 'production' }]);
    expect(apply(d, q, { kind: 'dismiss', person: 'E16', why: 'agree' })).toEqual([{ kind: 'refused', cmd: 'dismiss', why: 'notYours', detail: 'production' }]);
    expect(apply(d, q, { kind: 'vacancy', role: 'role.analyst', shift: 'shift.day', via: 'ad' })[0]).toMatchObject({ kind: 'vacancy', role: 'role.analyst' });
  }, 120_000);
});

describe('уборка в два шага', () => {
  test('мойка оборудования — аппаратчики, потом уборка помещения — уборщик; чисто, когда кончены обе', () => {
    const s = newPlant(db, { scenario: SC });
    let washed: string | undefined;
    let room: string | undefined;
    while (!room && s.t < 10 * DAY) {
      apply(db, s, { kind: 'advance', seconds: 10 * 60 });
      for (const t of Object.values(s.tasks)) {
        if (t.kind === 'clean' && t.state === 'busy') {
          expect(t.roles).toEqual(['role.operator']);
          washed ??= t.room;
        }
        if (t.kind === 'roomClean' && t.room === washed) {
          expect(t.roles).toEqual(['role.cleaner']);
          expect(s.rooms[t.room!].washed).toBe(true);
          expect(s.rooms[t.room!].status).toBe('dirty');
          room = t.room;
        }
      }
    }
    expect(room).toBeDefined();
    while (Object.values(s.tasks).some(t => t.kind === 'roomClean' && t.room === room)) apply(db, s, { kind: 'advance', seconds: 10 * 60 });
    expect(s.rooms[room!].washed).toBeUndefined();
    expect(['clean', 'busy']).toContain(s.rooms[room!].status);
  }, 120_000);

  test('уборщика в смене нет — уборка помещения ждёт «людей нет в смене»', () => {
    const d = structuredClone(db) as ContentDb;
    d.scenarios[SC].staff = d.scenarios[SC].staff.filter(r => r.role !== 'role.cleaner');
    const s = newPlant(d, { scenario: SC });
    let waits = 0;
    while (s.t < 5 * DAY) {
      apply(d, s, { kind: 'advance', seconds: HOUR });
      for (const t of Object.values(s.tasks)) if (t.kind === 'roomClean' && t.state === 'open' && t.why !== undefined) {
        expect(t.why).toBe('shift');
        waits++;
      }
    }
    expect(waits).toBeGreaterThan(0);
  }, 120_000);
});

describe('сохранения', () => {
  test('образец схемы 23: уборщики сценария добавлены с записями обучения, начисленная зарплата отмечена', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v23.json', import.meta.url)).text();
    const s = fromSave(db, json);
    const cleaners = Object.values(s.people).filter(p => p.role === 'role.cleaner');
    expect(cleaners.map(p => p.shift).sort()).toEqual(['shift.a', 'shift.b']);
    for (const p of cleaners) {
      expect(Object.keys(p.train).length).toBe(matrixOf(db, 'role.cleaner').length);
      expect(p.paid).toBeUndefined();
    }
    const { d } = momentOf(s.start, s.t).date;
    // начислений нет у уборщиков (схема 24) и у запаса людей на отпуска (схема 25): они новые
    expect(Object.values(s.people).filter(p => p.paid === undefined).map(p => p.role).sort()).toEqual(['role.cleaner', 'role.cleaner', 'role.operator', 'role.packer', 'role.qp']);
    for (const p of Object.values(s.people).filter(x => x.paid !== undefined)) expect(p.half !== undefined).toBe(d >= 16);
    expect(s.vacancies).toEqual({});
    live(db, s, s.t + 2 * DAY);
  }, 120_000);

  test('образец схемы 24 посреди найма: уходящий уходит после смены с расчётом, принятый выходит в свой первый день', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v24.json', import.meta.url)).text();
    const s = fromSave(db, json);
    const leaving = Object.values(s.people).find(p => p.quit)!;
    const [h] = Object.values(s.hires);
    expect(leaving.quit!.why).toBe('agree');
    expect(Object.keys(s.candidates).length).toBeGreaterThan(0);
    const got: Notice[] = [];
    live(db, s, h.at + HOUR, x => got.push(...x));
    expect(s.former[leaving.id]).toBeDefined();
    expect(s.cash.wages[`leave-${leaving.id}`].leave).toBe(leaving.quit!.pay);
    expect(got.filter(x => x.kind === 'hired').map(x => (x as { role: string }).role)).toEqual([h.role]);
    expect(Object.values(s.people).some(p => p.hired === h.day && p.salary === h.salary)).toBe(true);
  }, 120_000);
});

describe('сборщик базы — на испорченной копии content/', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  function broken(edits: Record<string, [string, string][]>): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'pharma-content-'));
    dirs.push(dir);
    cpSync(join(import.meta.dir, '../../content'), dir, { recursive: true });
    for (const [file, e] of Object.entries(edits)) {
      const p = join(dir, file);
      let text = readFileSync(p, 'utf8');
      for (const [a, b] of e) {
        expect(text.includes(a)).toBe(true);
        text = text.replace(a, b);
      }
      writeFileSync(p, text);
    }
    return buildDb(dir).errors;
  }
  const has = (errors: string[], part: string) => expect(errors.some(e => e.includes(part))).toBe(true);
  const SCN = 'scenarios/proto.yaml';

  test('рынок труда: роль штата без строки, доли навыков не в целое, испытание длиннее предела профиля', () => {
    has(broken({ [SCN]: [['    role.cleaner: { ad: [25, 40, 25, 10], skill: [20, 35, 30, 10, 5], quit: 10 }\n', '']] }), 'нет строки роли role.cleaner');
    has(broken({ [SCN]: [['skill: [0, 0, 30, 50, 20], quit: 3', 'skill: [0, 0, 30, 50, 10], quit: 3']] }), 'role.qp — доли навыков не складываются');
    has(broken({ [SCN]: [['  probation: 3\n', '  probation: 4\n']] }), 'испытание 4 мес. длиннее предела профиля, 3 мес.');
  });

  test('класс чистоты помещения с оборудованием без секунд уборки; уборщик без поста', () => {
    has(broken({ 'plants/proto.yaml': [['cleaning:\n  D: { minor: 12, major: 48 }\n', 'cleaning: {}\n']] }), 'а у класса D нет времени уборки');
    has(broken({ 'plants/proto.yaml': [['  role.cleaner: [56.5, 10.5]\n', '']] }), 'у роли role.cleaner нет поста');
  });
});
