// Графики в окне (Б4б; docs/specs/2026-10-vertical-slice.md, «Проверки Б4б»): справочник — графики с рисунком, учётом и
// числом людей сейчас и с нового месяца, у человека — ждущий перевод; календарь бригад — сутки по рисунку, люди в смене
// и дополнительный выходной, по ролям — днём и ночью; планёрка — переводы и дополнительные выходные недели; карточка —
// перевод и итог учётного периода; «Сейчас» — бригада у работы. Всё — по записям завода.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, daysFromCivil, HOUR, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { cycleDay, dayNorm, offDays, scheduleOn, spanOn } from '../../src/engine/shifts';
import type { PlantState } from '../../src/engine/types';
import { hoursMeeting, saOf, shiftMonths } from '../../src/sim/hours';
import { nowView } from '../../src/sim/now';
import { refView } from '../../src/sim/ref';
import { cardView } from '../../src/sim/views';

const SC = 'scn.proto';
const z = (y: number, m: number, d: number) => daysFromCivil({ y, m, d });
const sc = db.scenarios[SC];
const start = z(sc.start.date.y, sc.start.date.m, sc.start.date.d);
const c1 = db.shifts['shift.c1'].cycle!;
const c2 = db.shifts['shift.c2'].cycle!;
/** первые двое аппаратчиков первой смены */
const ops = (s: PlantState) => Object.values(s.people).filter(p => p.role === 'role.operator' && p.shift === 'shift.a');
const num = (id: string) => Number(id.slice(1));

describe('справочник и карточка: перевод ждёт своего дня', () => {
  const s = newPlant(db, { scenario: SC });
  const [a, b] = ops(s);
  for (const p of [a, b]) apply(db, s, { kind: 'roster', person: p.id, shift: 'shift.c2' });
  const v = refView(db, s);

  test('графики: у сменного по циклу — рисунок, часы дня и ночи, квартал; людей сейчас и с 1 октября', () => {
    const row = v.shifts.find(x => x.id === 'shift.c2')!;
    expect(row.cycle).toEqual({ pattern: c2.pattern, day: [8, 20], night: [20, 8], account: 3 });
    expect([row.now, row.next]).toEqual([0, 2]);
    const five = v.shifts.find(x => x.id === 'shift.a')!;
    expect(five.cycle).toBeUndefined();
    expect(five.next).toBe(five.now - 2);
    expect(v.shifts.reduce((n, x) => n + x.now, 0)).toBe(Object.keys(s.people).length);
    expect(v.shifts.reduce((n, x) => n + x.next, 0)).toBe(Object.keys(s.people).length);
  });

  test('у человека — ждущий перевод, в его карточке — тоже; итога периода нет, пока он на пятидневке', () => {
    expect(v.people.find(x => x.person === num(a.id))!.next).toEqual({ shift: 'shift.c2', from: z(2027, 10, 1) });
    const c = cardView(db, s, { kind: 'person', n: num(a.id) }).card;
    if (c?.kind !== 'person') throw new Error('нет карточки человека');
    expect(c.next).toEqual({ shift: 'shift.c2', from: z(2027, 10, 1) });
    expect(c.sa).toBeUndefined();
  });
});

describe('календарь бригад', () => {
  // аппаратчик — в бригаде 1 с начала завода: в сентябре у неё дополнительный выходной
  const s = newPlant(db, { scenario: SC });
  const [a] = ops(s);
  a.shift = 'shift.c1';
  const [sep] = shiftMonths(db, s);
  const off = offDays(db, s, 'shift.c1', start, 'shift.c1');

  test('сентябрь: сутки по рисунку; в смене — он, кроме дополнительных выходных', () => {
    expect([sep.y, sep.m]).toEqual([2027, 9]);
    const row = sep.rows.find(r => r.shift === 'shift.c2')!;
    expect(row.days.every(d => d.of === 0)).toBe(true);
    const mine = sep.rows.find(r => r.shift === 'shift.c1')!;
    expect(mine.days.length).toBe(30);
    let extra = 0;
    mine.days.forEach((d, i) => {
      const day = start + i;
      expect(d.k).toBe(cycleDay(c1, day));
      expect(d.of).toBe(1);
      expect(d.n).toBe(d.k !== 'off' && !off.has(day) ? 1 : 0);
      if (d.k !== 'off' && d.n < d.of) extra++;
    });
    expect(extra).toBe([...off].filter(d => d < z(2027, 10, 1)).length);
    expect(extra).toBeGreaterThan(0);
  });

  test('по ролям: ночью — только он, в ночи бригады без дополнительного выходного', () => {
    const ops = sep.roles.find(r => r.role === 'role.operator')!;
    ops.night.forEach((n, i) => expect(n).toBe(cycleDay(c1, start + i) === 'night' && !off.has(start + i) ? 1 : 0));
    // днём — сколько аппаратчиков в дневной смене: пятидневка и он
    ops.day.forEach((n, i) => {
      const day = start + i;
      const want = Object.values(s.people).filter(p => p.role === 'role.operator' && spanOn(db, s, p, day) && !(db.shifts[scheduleOn(p, day)].cycle && cycleDay(c1, day) === 'night')).length;
      expect(n).toBe(want);
    });
  });
});

describe('планёрка: переводы и дополнительные выходные', () => {
  test('перевод, который вступит в силу, — с днём; дополнительный выходной бригады — в неделе вперёд', () => {
    const s = newPlant(db, { scenario: SC });
    const [a, b] = ops(s);
    apply(db, s, { kind: 'roster', person: a.id, shift: 'shift.c2' });
    b.shift = 'shift.c1';
    expect(hoursMeeting(db, s).moves).toEqual([{ person: num(a.id), tab: a.tab, role: a.role, shift: 'shift.c2', from: z(2027, 10, 1) }]);
    // утро накануне первого дополнительного выходного бригады: вид — только чтение, часы можно передвинуть
    const off = offDays(db, s, 'shift.c1', start, 'shift.c1');
    expect(off.size).toBeGreaterThan(0);
    const d0 = Math.min(...off);
    const w = structuredClone(s);
    w.t = (d0 - 1 - start) * DAY + 8 * HOUR;
    expect(hoursMeeting(db, w).extra).toContainEqual({ shift: 'shift.c1', day: d0, n: 1 });
    w.t = (d0 + 1 - start) * DAY + 8 * HOUR;
    expect(hoursMeeting(db, w).extra.some(x => x.day === d0)).toBe(false);
  });
});

describe('карточка: итог учётного периода', () => {
  test('с начала завода: норма и часы по графику — с 1 сентября; после смен — в отработанном; снятые смены', () => {
    const s = newPlant(db, { scenario: SC });
    const [a] = ops(s);
    a.shift = 'shift.c1';
    s.t = 10 * DAY + 8 * HOUR;
    const v = saOf(db, s, a)!;
    expect([v.first, v.last]).toEqual([start, z(2027, 9, 30)]);
    let norm = 0;
    for (let d = start; d <= v.last; d++) norm += dayNorm(db, s, d);
    expect(v.norm).toBe(norm);
    expect(v.plan).toBeLessThanOrEqual(norm);
    expect(norm - v.plan).toBeLessThan(12 * HOUR);
    expect(v.off).toBe(offDays(db, s, 'shift.c1', start, 'shift.c1').size);
    expect(v.after).toBe(0);
    a.sa = { from: 0, segs: [[2 * DAY + 20 * HOUR, 2 * DAY + 22 * HOUR]] };
    const w = saOf(db, s, a)!;
    expect(w.after).toBe(2 * HOUR);
    expect(w.worked).toBe(v.worked + 2 * HOUR);
    const c = cardView(db, s, { kind: 'person', n: num(a.id) }).card;
    if (c?.kind !== 'person') throw new Error('нет карточки человека');
    expect(c.sa).toEqual(w);
  });
});

test('«Сейчас»: у работы, которую ведёт человек бригады, — его бригада; у пятидневки — нет', () => {
  const s = newPlant(db, { scenario: SC });
  for (const p of ops(s)) p.shift = 'shift.c1';
  let seen = 0;
  let five = 0;
  while (s.t < 6 * DAY && (seen === 0 || five === 0)) {
    apply(db, s, { kind: 'advance', seconds: HOUR });
    for (const r of nowView(db, s).rows) {
      const first = r.people[0] && s.people[`E${r.people[0].n}`];
      if (!first) continue;
      const sh = scheduleOn(first, momentOf(s.start, s.t).day);
      if (db.shifts[sh].cycle) {
        expect(r.crew).toBe(sh);
        seen++;
      } else {
        expect(r.crew).toBeUndefined();
        five++;
      }
    }
  }
  expect(seen).toBeGreaterThan(0);
  expect(five).toBeGreaterThan(0);
});
