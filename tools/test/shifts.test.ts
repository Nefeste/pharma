// Графики сменности (Б4б; docs/specs/2026-10-vertical-slice.md, «Проверки Б4б»): рисунок бригад и сборщик базы; смена
// человека — ночь через полночь, праздники и выходные по рисунку, табель; дополнительные выходные — не больше нормы к концу
// каждого месяца, равномерно и одни на бригаду; перевод — с 1-го числа не раньше чем через месяц, отмена, чужой пост,
// стык графиков; итог учётного периода и его оплата на примере; бригады на заводе — с 1 октября до итога квартала; прогон
// расписания с бригадами — там же, где движок.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacy } from './legacy';
import { db } from '../../src/content';
import type { ContentDb, Id } from '../../src/content/types';
import { extras } from '../../src/engine/cash';
import { civilFromDays, DAY, daysFromCivil, HOUR, isHoliday, isWorkday, lastOfMonth, MIN, normOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { sheetDays } from '../../src/engine/hours';
import { check } from '../../src/engine/invariants';
import { forecast } from '../../src/engine/plan/schedule';
import { cycleDay, cycleErrors, dayNorm, offDays, pendingOf, periodOf, rosterDay, rosterFrom, saResult, scheduleOn, shiftAt, spanOn } from '../../src/engine/shifts';
import { shiftEndAt, takesAt } from '../../src/engine/staff';
import type { Notice, Person, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { buildDb } from '../content/load';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const pr = db.profiles[sc.profile];
const clock = { start: sc.start.date, scenario: SC };
const cal = calOf(db, clock);
const z = (y: number, m: number, d: number) => daysFromCivil({ y, m, d });
const start = z(sc.start.date.y, sc.start.date.m, sc.start.date.d);
/** Игровые секунды от начала партии до часа `hour` дня `day`. */
const at = (day: number, hour: number) => (day - start) * DAY + hour * HOUR;
const CREWS = ['shift.c1', 'shift.c2', 'shift.c3', 'shift.c4'];
const cycle = (id: Id) => db.shifts[id].cycle!;
const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

function live(base: ContentDb, s: PlantState, until: number, step = HOUR, each?: (n: Notice[]) => void) {
  while (s.t < until) {
    const n = apply(base, s, { kind: 'advance', seconds: Math.min(step, until - s.t) });
    each?.(n);
    const bad = check(base, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
}

/** Человек роли в графике — копия первого такого в партии, без записей переводов. */
function one(s: PlantState, role: Id, shift: Id): Person {
  const p = Object.values(s.people).find(x => x.role === role)!;
  p.shift = shift;
  delete p.roster;
  return p;
}

/** Часы смен по рисунку без праздничных за дни `first`–`last`, по календарным дням (как табель), с. */
function planned(s: PlantState, p: Person, first: number, last: number): number {
  let n = 0;
  for (let d = first - 1; d <= last; d++) {
    const span = spanOn(db, s, p, d);
    if (!span) continue;
    for (let x = span[0]; x < span[1]; ) {
      const day = start + Math.floor(x / DAY);
      const y = Math.min(span[1], (day - start + 1) * DAY);
      if (day >= first && day <= last && !isHoliday(cal, day)) n += y - x;
      x = y;
    }
  }
  return n;
}

const normIn = (first: number, last: number) => sum(Array.from({ length: last - first + 1 }, (_, i) => dayNorm(db, clock, first + i)));

describe('рисунок бригад', () => {
  test('в любые сутки года одна бригада работает днём, другая — ночью, две отдыхают; ночь — с 20:00 до 08:00', () => {
    for (let d = start; d < start + 366; d++) {
      const kinds = CREWS.map(id => cycleDay(cycle(id), d)).sort();
      expect(kinds).toEqual(['day', 'night', 'off', 'off']);
    }
    for (const id of CREWS) {
      expect(cycle(id).day).toEqual([8, 20]);
      expect(cycle(id).night).toEqual([20, 8]);
      expect(cycleErrors(cycle(id))).toEqual([]);
    }
  });

  test('ошибки рисунка: две смены подряд; меньше 42 ч отдыха в любых семи сутках; без выходных', () => {
    const c = cycle('shift.c1');
    // ночь кончается в 08:00, день следующих суток начинается в 08:00
    expect(cycleErrors({ ...c, pattern: ['night', 'day', 'off', 'off', 'off', 'off'] }).join()).toContain('две смены подряд');
    // «день, день, ночь, ночь, четыре выходных»: в семи сутках с 20:00 четвёртых — 41 ч
    expect(cycleErrors({ ...c, pattern: ['day', 'day', 'night', 'night', 'off', 'off', 'off', 'off'] }).join()).toContain('41 ч, меньше 42');
    expect(cycleErrors({ ...c, pattern: ['day', 'day'] }).join()).toContain('нет выходных');
  });
});

describe('смена человека', () => {
  const s = newPlant(db, { scenario: SC });
  const p = one(s, 'role.operator', 'shift.c1');

  test('ночная — через полночь: в 03:00 идёт вчерашняя смена, она кончается в 08:00', () => {
    // 5 сентября 2027 года — ночь бригады 1, 6-го — тоже
    expect([cycleDay(cycle('shift.c1'), z(2027, 9, 5)), cycleDay(cycle('shift.c1'), z(2027, 9, 6))]).toEqual(['night', 'night']);
    expect(spanOn(db, s, p, z(2027, 9, 5))).toEqual([at(z(2027, 9, 5), 20), at(z(2027, 9, 6), 8)]);
    const t = at(z(2027, 9, 6), 3);
    expect(shiftAt(db, s, p, t)).toEqual({ from: at(z(2027, 9, 5), 20), to: at(z(2027, 9, 6), 8), shift: 'shift.c1' });
    expect(shiftEndAt(db, s, p, t)).toBe(at(z(2027, 9, 6), 8));
    expect(takesAt(db, s, p, t)).toBe(true);
    // 3 и 4 сентября по рисунку — выходные
    expect(shiftAt(db, s, p, at(z(2027, 9, 3), 12))).toBeUndefined();
  });

  test('табель: часы своим календарным дням, ночные — с 22:00 до 06:00; в праздник смена идёт — РВ', () => {
    const [d5, d6] = sheetDays(db, s, p, z(2027, 9, 5), z(2027, 9, 6));
    expect([d5.work, d5.night, d5.off]).toEqual([4 * HOUR, 2 * HOUR, 0]);
    // 6-го: конец ночи 5-го и начало своей
    expect([d6.work, d6.night, d6.off]).toEqual([12 * HOUR, 8 * HOUR, 0]);
    // 4 ноября 2027 года — праздник, у бригады 1 — день по рисунку: в табеле — работа в праздник
    const hol = z(2027, 11, 4);
    expect(isHoliday(cal, hol)).toBe(true);
    expect(cycleDay(cycle('shift.c1'), hol)).toBe('day');
    const [h] = sheetDays(db, s, p, hol, hol);
    expect([h.work, h.off]).toEqual([12 * HOUR, 12 * HOUR]);
  });

  test('праздники и выходные — по рисунку: смены с праздничными часами не снимаются', () => {
    let hol = 0;
    for (const id of CREWS) {
      const q = one(newPlant(db, { scenario: SC }), 'role.operator', id);
      for (let d = z(2027, 12, 31); d <= z(2028, 1, 8); d++) {
        if (cycleDay(cycle(id), d) === 'off') continue;
        const span = spanOn(db, s, q, d);
        const holHours = isHoliday(cal, d) || (cycleDay(cycle(id), d) === 'night' && isHoliday(cal, d + 1));
        if (holHours) {
          expect(span).toBeDefined();
          hol++;
        }
      }
    }
    // 1–8 января: в каждые сутки — смены двух бригад, и ночь 31 декабря тоже уходит в праздник
    expect(hol).toBe(17);
  });
});

describe('дополнительные выходные', () => {
  test('к концу каждого месяца часов без праздничных — не больше нормы с начала квартала; за квартал — 2–5 смен, за год — 12–16', () => {
    const years: number[] = [];
    for (const id of CREWS)
      for (const y of [2027, 2028]) {
        let n = 0;
        for (let q = 0; q < 4; q++) {
          const base = z(y, q * 3 + 1, 1);
          const off = offDays(db, clock, id, base, id);
          expect(off.size).toBeGreaterThanOrEqual(2);
          expect(off.size).toBeLessThanOrEqual(5);
          n += off.size;
          // часы по рисунку минус снятые — по календарным дням: ночь накануне квартала дала часы его первому дню
          const c = cycle(id);
          let plan = 0;
          for (let m = q * 3 + 1; m <= q * 3 + 3; m++) {
            for (let d = z(y, m, 1) - 1; d <= lastOfMonth(y, m); d++) {
              const k = cycleDay(c, d);
              if (k === 'off' || off.has(d) || d < base - 1) continue;
              const [a, b] = k === 'day' ? c.day : [c.night[0], c.night[1] + 24];
              for (let h = a; h < b; h++) {
                const day = d + Math.floor(h / 24);
                if (day >= z(y, m, 1) && day <= lastOfMonth(y, m) && !isHoliday(cal, day)) plan += HOUR;
              }
            }
            expect(plan).toBeLessThanOrEqual(normIn(base, lastOfMonth(y, m)));
          }
        }
        years.push(n);
      }
    expect(Math.min(...years)).toBe(12);
    expect(Math.max(...years)).toBe(16);
  });

  test('равномерно по месяцу и одни на бригаду: двое, пришедшие в один день, отдыхают вместе', () => {
    for (const id of CREWS)
      for (const y of [2027, 2028])
        for (let q = 0; q < 4; q++) {
          const off = [...offDays(db, clock, id, z(y, q * 3 + 1, 1), id)].sort((a, b) => a - b);
          for (let i = 1; i < off.length; i++) if (civilFromDays(off[i]).m === civilFromDays(off[i - 1]).m) expect(off[i] - off[i - 1]).toBeGreaterThanOrEqual(7);
          // снятая смена — без праздничных часов и не на стыке месяцев
          for (const d of off) {
            expect(isHoliday(cal, d)).toBe(false);
            expect(cycleDay(cycle(id), d) === 'night' && civilFromDays(d + 1).m !== civilFromDays(d).m).toBe(false);
          }
        }
    const s = newPlant(db, { scenario: SC });
    const ops = Object.values(s.people).filter(p => p.role === 'role.operator');
    for (const p of ops) apply(db, s, { kind: 'roster', person: p.id, shift: 'shift.c2' });
    for (let d = z(2027, 10, 1); d <= z(2027, 12, 31); d++) {
      const spans = ops.map(p => spanOn(db, s, p, d));
      for (const x of spans) expect(x).toEqual(spans[0]);
    }
  });
});

describe('перевод', () => {
  test('с 1-го числа месяца, до которого не меньше месяца', () => {
    expect(rosterFrom(z(2027, 9, 1))).toBe(z(2027, 10, 1));
    expect(rosterFrom(z(2027, 9, 2))).toBe(z(2027, 11, 1));
    expect(rosterFrom(z(2027, 12, 1))).toBe(z(2028, 1, 1));
    expect(rosterFrom(z(2027, 12, 15))).toBe(z(2028, 2, 1));
  });

  test('команда: ждёт до 1-го числа, вступает в силу в полночь; новый заменяет ждущий; тот же график — отмена', () => {
    const s = newPlant(db, { scenario: SC });
    const p = Object.values(s.people).find(x => x.role === 'role.operator' && x.shift === 'shift.b')!;
    const n1 = apply(db, s, { kind: 'roster', person: p.id, shift: 'shift.c1' });
    expect(n1).toContainEqual({ kind: 'rostered', person: p.id, role: p.role, tab: p.tab, shift: 'shift.c1', from: z(2027, 10, 1) });
    expect(pendingOf(s, p)).toEqual({ shift: 'shift.c1', from: z(2027, 10, 1) });
    expect(p.shift).toBe('shift.b');
    // другой график — вместо ждущего
    apply(db, s, { kind: 'roster', person: p.id, shift: 'shift.c3' });
    expect(p.roster).toEqual([{ shift: 'shift.b', from: start }, { shift: 'shift.c3', from: z(2027, 10, 1) }]);
    // тот же, в котором он и так будет, — отмена; снова тот же — отказ
    const n2 = apply(db, s, { kind: 'roster', person: p.id, shift: 'shift.b' });
    expect(n2).toContainEqual({ kind: 'rostered', person: p.id, role: p.role, tab: p.tab, shift: 'shift.b', from: z(2027, 10, 1), cancel: true });
    expect(p.roster).toBeUndefined();
    expect(apply(db, s, { kind: 'roster', person: p.id, shift: 'shift.b' })).toContainEqual({ kind: 'refused', cmd: 'roster', why: 'same', detail: 'shift.b' });
    expect(apply(db, s, { kind: 'roster', person: 'E999', shift: 'shift.c1' })).toContainEqual({ kind: 'refused', cmd: 'roster', why: 'noPerson', detail: 'E999' });
    expect(apply(db, s, { kind: 'roster', person: p.id, shift: 'shift.x' })).toContainEqual({ kind: 'refused', cmd: 'roster', why: 'noShift', detail: 'shift.x' });
    // в силу — в полночь 1 октября
    apply(db, s, { kind: 'roster', person: p.id, shift: 'shift.c1' });
    live(db, s, at(z(2027, 9, 30), 23), 6 * HOUR);
    expect(p.shift).toBe('shift.b');
    live(db, s, at(z(2027, 10, 1), 1));
    expect(p.shift).toBe('shift.c1');
    expect(pendingOf(s, p)).toBeUndefined();
    expect(scheduleOn(p, z(2027, 9, 30))).toBe('shift.b');
  });

  test('чужой пост — отказ; пост отдела человека и директор — переводят', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    const op = Object.values(s.people).find(x => x.role === 'role.operator')!;
    const qc = Object.values(s.people).find(x => x.role === 'role.analyst')!;
    expect(apply(db, s, { kind: 'roster', person: op.id, shift: 'shift.c1', by: 'player' })).toContainEqual({ kind: 'refused', cmd: 'roster', why: 'notYours', detail: 'production' });
    expect(op.roster).toBeUndefined();
    apply(db, s, { kind: 'roster', person: qc.id, shift: 'shift.c1', by: 'player' });
    expect(pendingOf(s, qc)?.shift).toBe('shift.c1');
    apply(db, s, { kind: 'seat', seats: ['director'] });
    apply(db, s, { kind: 'roster', person: op.id, shift: 'shift.c1', by: 'player' });
    expect(pendingOf(s, op)?.shift).toBe('shift.c1');
  });

  test('первая смена нового графика, которая начинается не позже конца прежней, пропущена: не две смены подряд', () => {
    const s = newPlant(db, { scenario: SC });
    // ночь бригады 1 30 сентября кончается в 08:00 1 октября, день бригады 4 начинается в 08:00 — его нет
    const p = one(s, 'role.operator', 'shift.c1');
    p.roster = [{ shift: 'shift.c1', from: start }, { shift: 'shift.c4', from: z(2027, 10, 1) }];
    expect(spanOn(db, s, p, z(2027, 9, 30))).toEqual([at(z(2027, 9, 30), 20), at(z(2027, 10, 1), 8)]);
    expect(cycleDay(cycle('shift.c4'), z(2027, 10, 1))).toBe('day');
    expect(spanOn(db, s, p, z(2027, 10, 1))).toBeUndefined();
    expect(spanOn(db, s, p, z(2027, 10, 2))).toEqual([at(z(2027, 10, 2), 8), at(z(2027, 10, 2), 20)]);
    // и с пятидневки: смена 15:00–23:00 30 сентября, ночь бригады 2 1 октября — с 20:00, она есть
    const q = Object.values(s.people).find(x => x.role === 'role.master' && x.shift === 'shift.b')!;
    q.roster = [{ shift: 'shift.b', from: start }, { shift: 'shift.c2', from: z(2027, 10, 1) }];
    expect(cycleDay(cycle('shift.c2'), z(2027, 10, 1))).toBe('night');
    expect(spanOn(db, s, q, z(2027, 10, 1))).toEqual([at(z(2027, 10, 1), 20), at(z(2027, 10, 2), 8)]);
  });
});

describe('итог учётного периода на примере', () => {
  // аппаратчик второй смены с 1 октября 2027 года — в бригаде 1; четыре дня в декабре после дневной смены — по 4 ч
  const s = newPlant(db, { scenario: SC });
  const p = Object.values(s.people).find(x => x.role === 'role.operator' && x.shift === 'shift.b')!;
  p.roster = [{ shift: 'shift.b', from: start }, { shift: 'shift.c1', from: z(2027, 10, 1) }];
  const [first, last] = periodOf(db, clock, z(2027, 10, 1));
  const days = Array.from({ length: last - first + 1 }, (_, i) => first + i).filter(d => d >= z(2027, 12, 1) && cycleDay(cycle('shift.c1'), d) === 'day' && spanOn(db, s, p, d) && !isHoliday(cal, d));
  const segs = days.slice(0, 4).map(d => [at(d, 20), at(d, 24)] as [number, number]);
  p.sa = { from: at(first, 0), segs };
  const now = at(last + 1, 0);
  const res = saResult(db, s, p, first, last, now)!;
  const norm = normIn(first, last);
  const plan = planned(s, p, first, last);

  test('квартал октябрь–декабрь: норма — по Порядку 588н с 1 октября; по графику — не больше нормы', () => {
    expect([first, last]).toEqual([z(2027, 10, 1), z(2027, 12, 31)]);
    expect(norm).toBe((168 + 159 + 176) * HOUR);
    expect(plan).toBeLessThanOrEqual(norm);
    expect(norm - plan).toBeLessThan(16 * HOUR);
  });

  test('сверхурочные — отработано минус норма; остальное — в остаток года', () => {
    expect(res.over).toBe(plan + 16 * HOUR - norm);
    expect(res.back).toBe(16 * HOUR - res.over);
  });

  test('оплата по ст. 152: последние часы после смен, у каждого дня первые 2 ч — в полуторном размере, дальше — в двойном', () => {
    const salary = db.roles[p.role].salary;
    const mn = normOf(cal, 2027, 12, pr.calendar.day, pr.calendar.short);
    const share = (sec: number, rate: number) => Math.floor((Math.floor((salary * sec) / mn) * rate) / 10000);
    let left = res.over;
    let pay = 0;
    for (let i = segs.length - 1; i >= 0 && left > 0; i--) {
      const sec = Math.min(left, segs[i][1] - segs[i][0]);
      pay += share(Math.min(sec, 2 * HOUR), 15000) + share(Math.max(0, sec - 2 * HOUR), 20000);
      left -= sec;
    }
    expect(res.pay).toBe(pay);
    expect(pay).toBeGreaterThan(0);
  });

  test('в полночь 1 января: итог — в зарплату второй половины декабря, лишнее — в остаток года, часы — с нового периода', () => {
    const w = structuredClone(s);
    const q = w.people[p.id];
    q.shift = 'shift.c1';
    q.otYear = { y: 2027, sec: 30 * HOUR };
    w.t = now;
    rosterDay(db, w, last + 1);
    expect(q.saDone).toEqual({ y: 2027, m: 12, over: res.over, pay: res.pay });
    expect(q.otYear.sec).toBe(30 * HOUR - res.back);
    expect(q.sa).toBeUndefined();
    expect(extras(db, w, q, 2027, 12, 16, 31).period).toBe(res.pay);
    expect(extras(db, w, q, 2027, 12, 1, 15).period).toBe(0);
    // после смен в периоде сверхурочными до итога не платят: только итог
    q.ot = segs;
    expect(extras(db, w, q, 2027, 12, 16, 31).over).toBe(0);
  });
});

describe('бригады на заводе: с 1 октября до итога квартала', () => {
  // аппаратчики первой смены и люди линии — в бригаде 1, аппаратчик второй — в бригаде 3: она работает днём, когда
  // бригада 1 — ночью
  const s = newPlant(db, { scenario: SC });
  const crew: Record<string, Id> = {};
  for (const p of Object.values(s.people)) {
    if ((p.role === 'role.operator' && p.shift === 'shift.a') || p.role === 'role.line-operator' || p.role === 'role.packer') crew[p.id] = 'shift.c1';
    if (p.role === 'role.operator' && p.shift === 'shift.b') crew[p.id] = 'shift.c3';
  }
  for (const [id, shift] of Object.entries(crew)) apply(db, s, { kind: 'roster', person: id, shift });
  let sampled = 0;
  // отрезки после смены — все, что были: табель прошлых месяцев убирают после зарплаты
  const seen = new Map<string, number>();
  const nightWork = new Set<string>();
  // пробы — раз в 10 минут, инварианты — раз в час
  while (s.t < at(z(2028, 1, 2), 0)) {
    apply(db, s, { kind: 'advance', seconds: 10 * MIN });
    for (const p of Object.values(s.people)) {
      if (p.task && p.until !== undefined && s.t > p.until) sampled++;
      for (const [a, b] of p.ot) seen.set(`${p.id}:${a}`, b - a);
      const h = Math.floor((s.t % DAY) / HOUR);
      if (crew[p.id] && p.task && (h >= 22 || h < 6)) nightWork.add(p.role);
    }
    if (s.t % HOUR === 0) expect(check(db, s)).toEqual([]);
  }

  test('бригады работают и ночью; ни одной работы две смены подряд', () => {
    expect([...nightWork].sort()).toEqual(['role.line-operator', 'role.operator', 'role.packer']);
    for (const id of Object.keys(crew)) {
      const p = s.people[id];
      let prev: [number, number] | undefined;
      for (let d = start; d <= z(2028, 1, 1); d++) {
        const x = spanOn(db, s, p, d);
        if (!x) continue;
        if (prev) expect(x[0]).toBeGreaterThan(prev[1]);
        prev = x;
      }
    }
  });

  test('сверхурочные — не больше 4 ч за смену и предела года; табель сходится с задачами', () => {
    let recorded = 0;
    for (const sec of seen.values()) {
      expect(sec).toBeLessThanOrEqual(pr.payroll.overtime.shift);
      recorded += sec;
    }
    for (const p of Object.values(s.people)) expect(p.otYear.sec).toBeLessThanOrEqual(pr.payroll.overtime.year);
    expect(recorded).toBeGreaterThan(0);
    expect(Math.abs(sampled * 10 * MIN - recorded)).toBeLessThanOrEqual(seen.size * 10 * MIN);
  });

  test('итог квартала у каждого в бригаде; сверхурочные периода — в зарплате второй половины декабря', () => {
    let pay = 0;
    for (const id of Object.keys(crew)) {
      const p = s.people[id];
      expect(p.saDone?.y).toBe(2027);
      expect(p.saDone?.m).toBe(12);
      pay += p.saDone!.pay;
    }
    expect(s.cash.wages['2027-12b'].period ?? 0).toBe(pay);
  });
});

describe('прогон расписания с бригадами', () => {
  // прежний сценарий: аппаратчики — в четырёх бригадах по двое с начала завода
  const bdb: ContentDb = structuredClone(legacy);
  const bsc = bdb.scenarios[SC];
  bsc.staff = bsc.staff.filter(r => r.role !== 'role.operator').concat(CREWS.map(shift => ({ role: 'role.operator', shift, skill: 3, n: 2 })));
  const recipe = Object.values(bdb.recipes)[0];
  const s0 = newPlant(bdb, { scenario: SC });
  // каждый час: стадия серии, которой пора (прежняя кончилась), — где её ставит прогон
  const s = structuredClone(s0);
  const told: { batch: string; stage: string; from: number }[] = [];
  while (s.t < 30 * DAY) {
    apply(bdb, s, { kind: 'advance', seconds: HOUR });
    const bars = forecast(bdb, s).bars.filter(b => b.kind === 'stage' && b.when === 'plan');
    for (const b of Object.values(s.batches)) {
      const done = b.records.length;
      if (done === 0 || done >= recipe.stages.length || b.records[done - 1].end > s.t) continue;
      const bar = bars.find(x => x.batch === b.id && x.stage === recipe.stages[done].id);
      if (bar) told.push({ batch: b.id, stage: bar.stage!, from: bar.from });
    }
  }

  test('стадия, которой пора: прогон ставит её там же, где её начал движок, — и ночью, и после дополнительного выходного бригады', () => {
    let n = 0;
    let night = 0;
    for (const x of told) {
      const life = s.batches[x.batch].records.find(r => r.stage === x.stage);
      if (!life) continue;
      expect(Math.abs(x.from - life.start)).toBeLessThanOrEqual(HOUR);
      const h = Math.floor((life.start % DAY) / HOUR);
      if (h >= 20 || h < 8) night++;
      n++;
    }
    expect(n).toBeGreaterThan(20);
    expect(night).toBeGreaterThan(0);
    // B2: прессованию пора к концу дневной смены 9 сентября, а ночь бригады 3 — её дополнительный выходной: и прогон, и
    // движок ставят его на 08:00 10-го, бригаде 1
    expect(offDays(bdb, clock, 'shift.c3', start, 'shift.c3').has(z(2027, 9, 9))).toBe(true);
    const b2 = s.batches.B2.records.find(r => r.stage === 'compress')!;
    expect(b2.start).toBeGreaterThanOrEqual(at(z(2027, 9, 10), 8));
    expect(b2.start).toBeLessThan(at(z(2027, 9, 10), 9));
    expect(told.some(x => x.batch === 'B2' && x.stage === 'compress')).toBe(true);
  });

  test('стадии по плану начинаются в смене людей их роли: людей бригады хватает', () => {
    let n = 0;
    for (const b of forecast(bdb, s0).bars.filter(x => x.kind === 'stage' && x.when === 'plan')) {
      const stage = recipe.stages.find(x => x.id === b.stage)!;
      const ready = Object.values(s0.people).filter(p => p.role === stage.staff.role && takesAt(bdb, s0, p, b.from)).length;
      expect(ready).toBeGreaterThanOrEqual(stage.staff.n);
      n++;
    }
    expect(n).toBeGreaterThan(10);
  });
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
  const PAT = 'pattern: [day, day, off, off, night, night, off, off]';

  test('рисунок: две смены подряд; меньше 42 ч отдыха в неделю', () => {
    has(broken({ 'shifts/c2.yaml': [[PAT, 'pattern: [night, day, off, off, off, off]']] }), 'две смены подряд');
    has(broken({ 'shifts/c2.yaml': [[PAT, 'pattern: [day, day, night, night, off, off, off, off]']] }), 'меньше 42');
  });

  test('учётный период — делитель года, не длиннее года', () => {
    has(broken({ 'scenarios/proto.yaml': [['account: 3', 'account: 5']] }), 'учётный период 5 мес. — не делитель года');
    expect(broken({ 'scenarios/proto.yaml': [['account: 3', 'account: 13']] }).length).toBeGreaterThan(0);
  });
});

test('пятидневка без переводов: короткий путь раздатчика — то же правило, что смена человека', () => {
  const s = newPlant(db, { scenario: SC });
  // с 1 сентября по 10 ноября 2027 года: 3 ноября — короткий день, 4 и 5 — праздник и перенесённый выходной
  let n = 0;
  for (let t = 0; t < (z(2027, 11, 10) - start) * DAY; t += 15 * MIN)
    for (const p of Object.values(s.people)) {
      expect(shiftEndAt(db, s, p, t)).toBe(shiftAt(db, s, p, t)?.to);
      if (shiftEndAt(db, s, p, t) !== undefined) n++;
    }
  expect(n).toBeGreaterThan(0);
});

// бригада без людей не мешает: 5/2 — как было (золотой прогон держит отпечаток)
test('люди на пятидневке: смена человека — как у графика', () => {
  const s = newPlant(db, { scenario: SC });
  for (const p of Object.values(s.people))
    for (let d = start; d < start + 14; d++) {
      const x = spanOn(db, s, p, d);
      const sh = db.shifts[p.shift];
      if (x) expect(x[0]).toBe(at(d, sh.from));
    }
  expect(Object.values(s.people).every(p => !p.roster && !p.sa)).toBe(true);
});
