// Найм в окне (Б4в; docs/specs/2026-10-vertical-slice.md, «Проверки Б4в»): справочник — штат по сценарию и сейчас,
// вакансия с кандидатами и днями приёма, принятые до первого дня, уволенные; карточка — оклад, испытание, основания
// увольнения; планёрка — кто выходит, кто уходит, новые кандидаты; касса — объявление, медосмотр и расчёт. Всё — по
// записям завода.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { addMonths, DAY, daysFromCivil, HOUR, momentOf, weekday } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { hireDays } from '../../src/engine/hire';
import type { PlantState } from '../../src/engine/types';
import { hiringView, peopleMeeting } from '../../src/sim/hire';
import { cashView } from '../../src/sim/report';
import { cardView } from '../../src/sim/views';

const SC = 'scn.proto';
const P = 10000;
const start = daysFromCivil(db.scenarios[SC].start.date);
const at = (day: number, hour: number) => (day - start) * DAY + hour * HOUR;
const today = (s: PlantState) => momentOf(s.start, s.t).day;
const num = (id: string) => Number(id.slice(1));

/** Копия базы: никто не уходит сам; у аппаратчика на объявление всегда три отклика. */
function market(): ContentDb {
  const d = structuredClone(db) as ContentDb;
  const l = d.scenarios[SC].labor!;
  for (const r of Object.keys(l.roles)) l.roles[r].quit = 0;
  l.roles['role.operator'].ad = [0, 0, 0, P];
  return d;
}

function live(d: ContentDb, s: PlantState, until: number) {
  while (s.t < until) apply(d, s, { kind: 'advance', seconds: Math.min(HOUR, until - s.t) });
}

function person(d: ContentDb, s: PlantState, id: string) {
  const c = cardView(d, s, { kind: 'person', n: num(id) }).card;
  if (c?.kind !== 'person') throw new Error(`нет карточки ${id}`);
  return c;
}

describe('вакансия аппаратчика: кандидаты, приём, увольнение по соглашению', () => {
  const d = market();
  const s = newPlant(d, { scenario: SC });
  const lab = d.scenarios[SC].labor!;
  const sc = d.scenarios[SC];
  apply(d, s, { kind: 'vacancy', role: 'role.operator', shift: 'shift.a', via: 'ad' });
  let mon = today(s);
  while (weekday(mon) !== 0) mon++;
  live(d, s, at(mon, 10));
  const v1 = hiringView(d, s)!;
  const m1 = peopleMeeting(s);
  const [k] = Object.values(s.candidates);
  apply(d, s, { kind: 'hire', candidate: k.id, trial: 3 });
  const v2 = hiringView(d, s)!;
  const m2 = peopleMeeting(s);
  const [a, b] = Object.values(s.people).filter(p => p.role === 'role.operator' && p.shift === 'shift.a');
  const before = person(d, s, a.id);
  apply(d, s, { kind: 'dismiss', person: a.id, why: 'agree' });
  const v3 = hiringView(d, s)!;
  const m3 = peopleMeeting(s);
  const leaving = person(d, s, a.id);
  const cash1 = cashView(d, s, { view: 'cash', page: 0 });

  test('штат: по сценарию и сейчас — у каждой роли и графика; сумма — люди сценария и люди завода', () => {
    const row = v1.staff.find(x => x.role === 'role.operator' && x.shift === 'shift.a')!;
    // аппаратчиков первой смены — трое: двое на отвешивании и запас на отпуска (Б4г)
    expect(row).toEqual({ role: 'role.operator', shift: 'shift.a', plan: 3, now: 3, coming: 0, leaving: 0 });
    expect(v1.staff.reduce((n, x) => n + x.plan, 0)).toBe(sc.staff.reduce((n, x) => n + x.n, 0));
    expect(v1.staff.reduce((n, x) => n + x.now, 0)).toBe(Object.keys(s.people).length);
    expect(v1.levels.find(x => x.role === 'role.operator')!.salary).toBe(d.roles['role.operator'].salary);
    expect([v1.probation, v1.law, v1.agree]).toEqual([lab.probation, d.profiles[sc.profile].labor.probation, lab.agree]);
  });

  test('вакансия: три кандидата объявления без платы агентству; медосмотр и первый день — если принять сегодня', () => {
    expect(v1.vacancies).toHaveLength(1);
    const [vac] = v1.vacancies;
    const { exam, first } = hireDays(d, s, 'shift.a');
    expect(vac).toMatchObject({ id: 'J1', role: 'role.operator', shift: 'shift.a', via: 'ad', exam, first: first!.day });
    expect(vac.candidates).toHaveLength(3);
    for (const c of vac.candidates) {
      expect(c.via).toBe('ad');
      expect(c.fee).toBeUndefined();
      expect(c.until).toBe(mon + lab.wait);
    }
    expect(m1.candidates).toEqual([{ vacancy: 'J1', role: 'role.operator', n: 3 }]);
  });

  test('принят: строка до первого дня, вакансия закрыта; на планёрке — выходит в свой день', () => {
    expect(v2.vacancies).toEqual([]);
    const [h] = v2.hires;
    expect(h).toMatchObject({ id: k.id, role: 'role.operator', shift: 'shift.a', skill: k.skill, salary: k.salary, trial: 3 });
    expect(h.day).toBeGreaterThan(h.exam);
    expect(v2.staff.find(x => x.role === 'role.operator' && x.shift === 'shift.a')!.coming).toBe(1);
    expect(m2.coming).toEqual([{ id: k.id, role: 'role.operator', shift: 'shift.a', day: h.day }]);
  });

  test('карточка: оклад; без испытания — только «по соглашению» с выплатой; после — основание и последний день', () => {
    expect(before.salary).toBe(d.roles['role.operator'].salary);
    expect(before.trial).toBeUndefined();
    expect(before.terms).toEqual({ agree: { last: mon, pay: Math.floor((before.salary * lab.agree) / P) } });
    expect(leaving.quit).toEqual({ why: 'agree', day: mon, last: mon, pay: before.terms!.agree!.pay });
    expect(leaving.terms).toBeUndefined();
    expect(v3.staff.find(x => x.role === 'role.operator' && x.shift === 'shift.a')!.leaving).toBe(1);
    expect(m3.leaving).toEqual([{ person: num(a.id), tab: a.tab, role: 'role.operator', why: 'agree', last: mon }]);
  });

  test('касса: объявление и медосмотр — строки найма', () => {
    const rows = cash1.entries.filter(r => r.item === 'hiring');
    expect(rows.map(r => [r.sum, r.why])).toEqual([
      [-lab.ad, { k: 'hiring', what: 'ad' }],
      [-lab.medical.price, { k: 'hiring', what: 'med' }],
    ]);
  });

  test('после последней смены: среди уволенных, карточка осталась; расчёт в кассе — роль и табельный номер', () => {
    live(d, s, at(mon + 1, 7));
    const v = hiringView(d, s)!;
    expect(v.former).toEqual([{ person: num(a.id), tab: a.tab, role: 'role.operator', shift: 'shift.a', why: 'agree', last: mon }]);
    expect(v.staff.find(x => x.role === 'role.operator' && x.shift === 'shift.a')).toMatchObject({ now: 2, coming: 1, leaving: 0 });
    const c = person(d, s, a.id);
    expect(c.gone).toBe(true);
    expect(c.terms).toBeUndefined();
    const settle = cashView(d, s, { view: 'cash', page: 0 }).entries.filter(r => r.item === 'settle');
    expect(settle).toHaveLength(1);
    expect(settle[0].why).toEqual({ k: 'leave', role: 'role.operator', tab: a.tab });
    expect(settle[0].parts!.leave).toBe(leaving.quit!.pay);
    // второй аппаратчик смены — на месте, с прежними основаниями
    expect(person(d, s, b.id).terms!.agree!.last).toBe(mon + 1);
  }, 120_000);

  test('принятый вышел: испытание до того же числа через три месяца, «не выдержал» — через три дня и в срок', () => {
    const h = s.hires[k.id];
    live(d, s, h.at + HOUR);
    const p = Object.values(s.people).find(x => x.hired === h.day)!;
    const c = person(d, s, p.id);
    expect(c).toMatchObject({ salary: h.salary, hired: h.day, trial: addMonths(h.day, 3) - 1 });
    expect(c.terms!.trial).toEqual({ last: today(s) + d.profiles[sc.profile].labor.trial, ok: true });
    expect(hiringView(d, s)!.hires).toEqual([]);
  }, 120_000);
});
