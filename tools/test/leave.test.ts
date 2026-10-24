// Отпуска (Б4г; docs/specs/2026-10-vertical-slice.md, «Проверки Б4г»): черновик графика — в первый рабочий день декабря в
// 09:00 по правилу сценария; утверждение — 17 декабря или в последний рабочий день до него; правка черновика постом
// отдела и директором; после утверждения — перенос не позже чем за две недели; праздник удлиняет часть; извещение за две
// недели; отпускные за три дня по среднему заработку; в дни части смен нет; оклад месяца с отпуском — доля; заместитель
// берёт работу роли ушедшего, доплата — в зарплате; без заместителя работа ждёт «в отпуске»; норма учётного периода
// сменного меньше на часы его смен в отпуске; компенсация при увольнении; смежная профессия; завод не встаёт без
// кладовщика; образцы схем 24 и 25; сборщик базы — правило черновика и смежные профессии.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { avgDaily, coverPay, halfOf } from '../../src/engine/cash';
import { DAY, daysFromCivil, HOUR, isHoliday, lastOfMonth, momentOf, normOf, weekday, workdayOnOrBefore } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { sheetDays } from '../../src/engine/hours';
import { check } from '../../src/engine/invariants';
import { approveDay, compDays, draftDay, earnedDays, noticeDay, partEnd, placeDraft, usedDays } from '../../src/engine/leave';
import { knows, matrixOf, rowsOf } from '../../src/engine/quals';
import { fromSave } from '../../src/engine/save';
import { graphSpan, periodOf, saResult, spanOn } from '../../src/engine/shifts';
import type { Away, Notice, Person, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { buildDb } from '../content/load';

const SC = 'scn.proto';
const P = 10000;
const start = daysFromCivil(db.scenarios[SC].start.date);
const ymd = (y: number, m: number, d: number) => daysFromCivil({ y, m, d });
/** Игровые секунды от начала партии до часа `hour` дня `day`. */
const at = (day: number, hour: number) => (day - start) * DAY + hour * HOUR;
const today = (s: PlantState) => momentOf(s.start, s.t).day;
const law = db.profiles[db.scenarios[SC].profile].leave;

/** Копия базы: никто не уходит сам — люди черновика те же. */
function calm(): ContentDb {
  const d = structuredClone(db) as ContentDb;
  for (const r of Object.values(d.scenarios[SC].labor!.roles)) r.quit = 0;
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

const overlap = (a: Pick<Away, 'from' | 'to'>, b: Pick<Away, 'from' | 'to'>) => a.from <= b.to && a.to >= b.from;
const partsOf = (s: PlantState, y: number) => Object.values(s.people).flatMap(p => (p.away ?? []).filter(a => a.y === y).map(a => ({ p, a })));

describe('график отпусков', () => {
  const d = calm();
  const s = newPlant(d, { scenario: SC });
  const dec1 = ymd(2027, 12, 1);
  live(d, s, at(dec1, 9) - HOUR);
  const before = structuredClone(s.leave);
  const drafted: Notice[] = [];
  live(d, s, at(dec1, 9), x => drafted.push(...x));
  const draft = structuredClone(s);

  test('черновик — в первый рабочий день декабря в 09:00: у каждого две части по 14 дней с понедельника, первая — летом', () => {
    expect(before).toEqual({});
    expect(weekday(dec1)).toBe(2);
    expect(draftDay(d, s, 2028)).toBe(dec1);
    expect(drafted.filter(n => n.kind === 'leaveDraft')).toEqual([{ kind: 'leaveDraft', y: 2028, miss: 0 }]);
    // тело describe идёт до тестов: завод уже дальше — черновик смотрим в снимке 1 декабря
    expect(draft.leave).toEqual({ 2028: { st: 'draft' } });
    const rule = d.scenarios[SC].leave!;
    const day = ([m, dd]: [number, number]) => ymd(2028, m, dd);
    const summer = [day(rule.summer[0]), day(rule.summer[1])];
    const rest = [day(rule.rest[0]), day(rule.rest[1])];
    expect(Object.keys(draft.people)).toHaveLength(25);
    for (const p of Object.values(draft.people)) {
      const parts = (p.away ?? []).filter(a => a.y === 2028);
      expect([p.id, parts.map(a => a.days)]).toEqual([p.id, [14, 14]]);
      expect(p.given).toEqual([[2028, law.days]]);
      for (const a of parts) {
        expect(weekday(a.from)).toBe(0);
        expect(a.to).toBe(partEnd(calOf(d, s), a.from, a.days));
      }
      const hot = parts.filter(a => a.from >= summer[0] && a.to <= summer[1]);
      const cold = parts.filter(a => a.from >= rest[0] && a.to <= rest[1] && !(a.to >= summer[0] && a.from <= summer[1]));
      expect([p.id, hot.length, cold.length]).toEqual([p.id, 1, 1]);
    }
  });

  test('черновик: люди одной роли — по одному, человек и его заместитель — не вместе, заместитель — за одного, из отдела — не больше двух', () => {
    const all = partsOf(draft, 2028);
    for (const x of all) {
      for (const y of all) {
        if (x.p.id === y.p.id || !overlap(x.a, y.a)) continue;
        expect([x.p.id, y.p.id, x.p.role === y.p.role]).toEqual([x.p.id, y.p.id, false]);
        expect([x.p.id, y.p.id, x.a.deputy === y.p.id]).toEqual([x.p.id, y.p.id, false]);
        if (x.a.deputy) expect([x.a.id, y.a.id, x.a.deputy === y.a.deputy]).toEqual([x.a.id, y.a.id, false]);
      }
    }
    for (let z = ymd(2028, 1, 1); z <= ymd(2028, 12, 31); z++) {
      const by = new Map<string, number>();
      for (const x of all) if (x.a.from <= z && z <= x.a.to) by.set(d.roles[x.p.role].dept, (by.get(d.roles[x.p.role].dept) ?? 0) + 1);
      for (const [dept, n] of by) expect([z, dept, n <= d.scenarios[SC].leave!.dept]).toEqual([z, dept, true]);
    }
    // заместитель — первый человек со смежной профессией роли; уполномоченное лицо — без заместителя
    const dep = (id: string) => draft.people[id].away!.map(a => a.deputy);
    expect(dep('E1')).toEqual(['E2', 'E2']);
    expect(dep('E2')).toEqual(['E1', 'E1']);
    expect(dep('E6')).toEqual(['E7', 'E7']);
    expect(dep('E8')).toEqual([undefined, undefined]);
    expect(dep('E25')).toEqual([undefined, undefined]);
  });

  test('принятому — не раньше шести месяцев после приёма; не помещается — «не помещается»', () => {
    const hired = ymd(2027, 11, 15);
    const right = ymd(2028, 5, 15);
    const one = [{ id: 'E99', role: 'role.cleaner', shift: 'shift.a', tab: 1099, right, days: 28 }];
    const got = placeDraft(d, s, 2028, one, one, []);
    expect(got.miss).toEqual([]);
    expect(got.parts.map(x => x.from >= right)).toEqual([true, true]);
    expect(right).toBe(daysFromCivil({ y: 2028, m: 5, d: 15 }));
    expect(hired).toBeLessThan(right);
    // право — после последнего понедельника года, куда влезет часть: не помещается
    const late = placeDraft(d, s, 2028, [{ ...one[0], right: ymd(2028, 12, 25) }], one, []);
    expect(late.miss).toEqual(['E99']);
  });

  test('правка черновика — постом отдела человека и директором; команда чужого поста — отказ', () => {
    const q = structuredClone(draft);
    apply(d, q, { kind: 'seat', seats: ['quality'] });
    const op = q.people.E9.away![0];
    expect(apply(d, q, { kind: 'leave', person: 'E9', op: 'drop', part: op.id, by: 'player' })).toEqual([{ kind: 'refused', cmd: 'leave', why: 'notYours', detail: 'production' }]);
    const head = q.people.E6.away![1];
    expect(apply(d, q, { kind: 'leave', person: 'E6', op: 'drop', part: head.id, by: 'player' })).toEqual([]);
    expect(q.people.E6.away!.map(a => a.id)).not.toContain(head.id);
    // осталась одна часть в 14 дней: добавить 7 — можно, ещё 8 — больше, чем осталось
    const z = ymd(2028, 10, 2);
    expect(apply(d, q, { kind: 'leave', person: 'E6', op: 'add', from: z, days: 7, by: 'player' })).toEqual([]);
    expect(apply(d, q, { kind: 'leave', person: 'E6', op: 'add', from: z + 14, days: 8, by: 'player' })).toEqual([{ kind: 'refused', cmd: 'leave', why: 'leaveDays' }]);
    expect(apply(d, q, { kind: 'leave', person: 'E6', op: 'add', from: z + 2, days: 3, by: 'player' })).toEqual([{ kind: 'refused', cmd: 'leave', why: 'leaveOverlap' }]);
    const added = q.people.E6.away!.find(a => a.from === z)!;
    expect([added.days, added.to, added.deputy]).toEqual([7, z + 6, 'E7']);
    // директор правит всё
    apply(d, q, { kind: 'seat', seats: ['director'] });
    expect(apply(d, q, { kind: 'leave', person: 'E9', op: 'move', part: op.id, from: ymd(2028, 10, 16), by: 'player' })).toEqual([]);
    expect(q.people.E9.away!.find(a => a.id === op.id)!.from).toBe(ymd(2028, 10, 16));
    // правила: в году без графика; до права; убрать единственную длинную часть, когда есть короткая
    expect(apply(d, q, { kind: 'leave', person: 'E9', op: 'add', from: ymd(2029, 2, 5), days: 14, by: 'player' })).toEqual([{ kind: 'refused', cmd: 'leave', why: 'leaveYear' }]);
    const long = q.people.E6.away!.find(a => a.days === 14)!;
    expect(apply(d, q, { kind: 'leave', person: 'E6', op: 'drop', part: long.id, by: 'player' })).toEqual([{ kind: 'refused', cmd: 'leave', why: 'leaveShort' }]);
    // заместитель — только со смежной профессией роли, свободный
    expect(apply(d, q, { kind: 'leave', person: 'E6', op: 'deputy', part: long.id, deputy: 'E9', by: 'player' })).toEqual([{ kind: 'refused', cmd: 'leave', why: 'noDeputy', detail: 'E9' }]);
    expect(apply(d, q, { kind: 'leave', person: 'E6', op: 'deputy', part: long.id, by: 'player' })).toEqual([]);
    expect(q.people.E6.away!.find(a => a.id === long.id)!.deputy).toBeUndefined();
    expect(apply(d, q, { kind: 'leave', person: 'E6', op: 'deputy', part: long.id, deputy: 'E7', by: 'player' })).toEqual([]);
    expect(q.people.E6.away!.find(a => a.id === long.id)!.deputy).toBe('E7');
    expect(check(d, q)).toEqual([]);
  });

  test('праздник внутри части её удлиняет; дни частей с праздником — целые календарные без праздников', () => {
    const cal = calOf(d, s);
    // 21 февраля 2028 — понедельник, 23-го — праздник: 14 дней — по 6 марта
    expect(weekday(ymd(2028, 2, 21))).toBe(0);
    expect(isHoliday(cal, ymd(2028, 2, 23))).toBe(true);
    expect(partEnd(cal, ymd(2028, 2, 21), 14)).toBe(ymd(2028, 3, 6));
    expect(partEnd(cal, ymd(2028, 3, 13), 14)).toBe(ymd(2028, 3, 26));
    // январские праздники: часть с 3 января по 14 календарных дней без праздников — до 22 января
    expect(partEnd(cal, ymd(2028, 1, 3), 14)).toBe(ymd(2028, 1, 22));
  });

  // утверждение, извещения и отпускные — тот же завод дальше
  const approved: Notice[] = [];
  live(d, s, at(ymd(2027, 12, 18), 9), x => approved.push(...x));
  const dec18 = structuredClone(s);

  test('утверждение — 17 декабря в 09:00 или в последний рабочий день до него; новые — по правилу', () => {
    expect(approveDay(d, s, 2028)).toBe(ymd(2027, 12, 17));
    expect(approved.filter(n => n.kind === 'leaveApproved')).toEqual([{ kind: 'leaveApproved', y: 2028 }]);
    expect(s.leave[2028].st).toBe('approved');
    // 17 декабря 2028 — воскресенье: утверждение — в пятницу 15-го; 1 декабря 2029 — суббота: черновик — 3-го
    expect(weekday(ymd(2028, 12, 17))).toBe(6);
    expect(approveDay(d, s, 2029)).toBe(ymd(2028, 12, 15));
    expect(draftDay(d, s, 2030)).toBe(ymd(2029, 12, 3));
  });

  test('после утверждения: перенос — по соглашению, прежнее и новое начало не раньше чем через две недели; убрать — нельзя', () => {
    const q = structuredClone(dec18);
    apply(d, q, { kind: 'seat', seats: ['director'] });
    const z = today(q);
    const first = Object.values(q.people).flatMap(p => p.away!.map(a => ({ p, a }))).sort((x, y) => x.a.from - y.a.from)[0];
    expect(first.a.from - z).toBeGreaterThanOrEqual(law.notice);
    expect(apply(d, q, { kind: 'leave', person: first.p.id, op: 'drop', part: first.a.id, by: 'player' })).toEqual([{ kind: 'refused', cmd: 'leave', why: 'leaveApproved' }]);
    // не летняя часть — на 17 января: можно, до него больше двух недель
    const cold = q.people.E20.away!.find(a => a.y === 2028 && (a.from < ymd(2028, 6, 1) || a.from > ymd(2028, 8, 31)))!;
    const hot = q.people.E20.away!.find(a => a.y === 2028 && a.id !== cold.id)!;
    expect(apply(d, q, { kind: 'leave', person: 'E20', op: 'move', part: cold.id, from: ymd(2028, 1, 17), by: 'player' })).toEqual([]);
    expect(q.people.E20.away!.find(a => a.id === cold.id)).toMatchObject({ from: ymd(2028, 1, 17), to: ymd(2028, 1, 30), days: 14 });
    // 5 января: прежнее начало ближе двух недель — та же часть уже не переносится; летнюю — не ближе двух недель
    live(d, q, at(ymd(2028, 1, 5), 10));
    expect(apply(d, q, { kind: 'leave', person: 'E20', op: 'move', part: cold.id, from: ymd(2028, 10, 2), by: 'player' })).toEqual([{ kind: 'refused', cmd: 'leave', why: 'leaveSoon' }]);
    expect(apply(d, q, { kind: 'leave', person: 'E20', op: 'move', part: hot.id, from: ymd(2028, 1, 10), by: 'player' })).toEqual([{ kind: 'refused', cmd: 'leave', why: 'leaveSoon' }]);
    expect(apply(d, q, { kind: 'leave', person: 'E20', op: 'move', part: hot.id, from: ymd(2028, 11, 6), by: 'player' })).toEqual([]);
    expect(q.people.E20.away!.find(a => a.id === hot.id)).toMatchObject({ from: ymd(2028, 11, 6), to: ymd(2028, 11, 19) });
    expect(check(d, q)).toEqual([]);
  }, 120_000);

  // до конца января: извещения, отпускные, первые части
  const later: Notice[] = [];
  const hourly: { t: number; tasks: { kind: string; people: string[]; roles: string[] }[] }[] = [];
  live(d, s, at(ymd(2028, 2, 1), 1), x => {
    later.push(...x);
    hourly.push({ t: s.t, tasks: Object.values(s.tasks).filter(t => t.state === 'busy').map(t => ({ kind: t.kind, people: [...t.people], roles: [...t.roles] })) });
  });

  test('извещение — за две недели в 09:00 рабочего дня; ушёл и вышел — в полночь', () => {
    const e2 = s.people.E2.away!.find(a => a.y === 2028 && a.from < ymd(2028, 2, 1))!;
    expect(e2.from).toBe(ymd(2028, 1, 10));
    const tell = noticeDay(d, s, e2);
    expect(tell).toBe(workdayOnOrBefore(calOf(d, s), e2.from - law.notice));
    const notice = later.find(n => n.kind === 'leaveNotice' && n.person === 'E2');
    expect(notice).toEqual({ kind: 'leaveNotice', person: 'E2', role: 'role.driver', tab: s.people.E2.tab, from: e2.from, to: e2.to, deputy: { person: 'E1', role: 'role.storekeeper', tab: s.people.E1.tab } });
    expect(e2.told).toBe(true);
    expect(later.filter(n => n.kind === 'leaveStart' && n.person === 'E2')).toEqual([{ kind: 'leaveStart', person: 'E2', role: 'role.driver', tab: s.people.E2.tab, to: e2.to, deputy: { person: 'E1', role: 'role.storekeeper', tab: s.people.E1.tab } }]);
    expect(later.filter(n => n.kind === 'leaveEnd' && n.person === 'E2')).toEqual([{ kind: 'leaveEnd', person: 'E2', role: 'role.driver', tab: s.people.E2.tab }]);
  });

  test('отпускные — в час банка рабочего дня не позже чем за три дня, средний дневной × дни части, со взносами', () => {
    const e2 = s.people.E2.away!.find(a => a.from === ymd(2028, 1, 10))!;
    const pay = workdayOnOrBefore(calOf(d, s), e2.from - law.pay);
    const row = s.cash.ledger.find(x => x.item === 'vacation' && x.ref === `vac-${e2.id}`);
    expect(row).toEqual({ t: at(pay, 10), sum: -e2.paid!, item: 'vacation', ref: `vac-${e2.id}` });
    // начисления — 1-го и 16-го в полночь: с 16 декабря до 1 января средний тот же, что в день выплаты
    expect(e2.paid).toBe(avgDaily(d, dec18, dec18.people.E2, 2028, 1) * 14);
    expect(s.cash.wages[`vac-${e2.id}`]).toEqual({ salary: 0, night: 0, over: 0, off: 0, vac: e2.paid });
    // до начала завода — оклад; с начала — начисленное: средний дневной близок к окладу на 29,3
    const salary = d.roles['role.driver'].salary;
    expect(Math.abs(avgDaily(d, dec18, dec18.people.E2, 2028, 1) - Math.floor((salary * 1000) / 29300))).toBeLessThan(Math.floor(salary / 29.3 / 5));
  });

  test('в дни части смен нет; оклад месяца с отпуском — доля по часам; заместитель берёт работу роли ушедшего, доплата — в зарплате', () => {
    const e2 = s.people.E2;
    for (let z = ymd(2028, 1, 10); z <= ymd(2028, 1, 23); z++) expect(spanOn(d, s, e2, z)).toBeUndefined();
    expect(spanOn(d, s, e2, ymd(2028, 1, 24))).toBeDefined();
    expect(graphSpan(d, s, e2, ymd(2028, 1, 10))).toBeDefined();
    // в части водителя — ни одной его задачи; кладовщик работает за него — задачи только водителя
    const inPart = hourly.filter(h => h.t >= at(ymd(2028, 1, 10), 0) && h.t < at(ymd(2028, 1, 24), 0));
    expect(inPart.some(h => h.tasks.some(t => t.people.includes('E2')))).toBe(false);
    // оклад января: часы по графику вне отпуска против нормы месяца
    const salary = d.roles['role.driver'].salary;
    const cal = calOf(d, s);
    const pr = d.profiles[d.scenarios[SC].profile].calendar;
    const norm = normOf(cal, 2028, 1, pr.day, pr.short);
    const days = sheetDays(d, s, e2, ymd(2028, 1, 1), lastOfMonth(2028, 1));
    const worked = days.reduce((n, x) => n + x.work - x.over[0] - x.over[1] - x.off, 0);
    const a = halfOf(d, s, e2, 2028, 1, 1, 15);
    expect(a.salary).toBe(0);
    expect(halfOf(d, s, e2, 2028, 1, 16, 31).salary).toBe(Math.min(salary, Math.floor((salary * worked) / norm)));
    expect(halfOf(d, s, e2, 2028, 1, 16, 31).salary).toBeLessThan(salary - Math.floor(salary / 2));
    // доплата кладовщику: 30 % оклада водителя за календарные дни замещения на дни месяца
    const cover = d.scenarios[SC].leave!.cover;
    expect(coverPay(d, s, s.people.E1, ymd(2028, 1, 1), ymd(2028, 1, 15))).toBe(Math.floor((salary * cover * 6) / (P * 31)));
    expect(coverPay(d, s, s.people.E1, ymd(2028, 1, 16), ymd(2028, 1, 31))).toBe(Math.floor((salary * cover * 8) / (P * 31)));
    expect(halfOf(d, s, s.people.E1, 2028, 1, 1, 15).cover).toBe(Math.floor((salary * cover * 6) / (P * 31)));
    expect(s.cash.wages['2028-1a'].cover).toBeGreaterThanOrEqual(Math.floor((salary * cover * 6) / (P * 31)));
  });
});

describe('заместитель и «в отпуске»', () => {
  /** Пробоотборщик в отпуске 6–19 сентября 2027 года; заместитель — аналитик со смежной профессией или никого. */
  function sampler(deputy?: string) {
    const d = calm();
    const s = newPlant(d, { scenario: SC });
    s.people.E3.away = [{ id: 'A1', y: 2027, from: ymd(2027, 9, 6), to: ymd(2027, 9, 19), days: 14, ...(deputy ? { deputy } : {}) }];
    s.next.A = 1;
    const seen: { t: number; kind: string; people: string[]; why?: string }[] = [];
    while (s.t < at(ymd(2027, 9, 20), 0)) {
      apply(d, s, { kind: 'advance', seconds: HOUR });
      for (const t of Object.values(s.tasks)) if (t.kind === 'sample') seen.push({ t: s.t, kind: t.kind, people: [...t.people], ...(t.why ? { why: t.why } : {}) });
      expect(check(d, s)).toEqual([]);
    }
    return { d, s, seen };
  }

  test('заместитель в свои смены берёт работу роли ушедшего: отбор проб — аналитик; доплата — с зарплатой своей половины', () => {
    const { d, s, seen } = sampler('E4');
    const part = seen.filter(x => x.t >= at(ymd(2027, 9, 6), 0));
    expect(part.some(x => x.people.includes('E4'))).toBe(true);
    expect(part.some(x => x.people.includes('E3'))).toBe(false);
    const salary = d.roles['role.sampler'].salary;
    const cover = d.scenarios[SC].leave!.cover;
    expect(coverPay(d, s, s.people.E4, ymd(2027, 9, 1), ymd(2027, 9, 15))).toBe(Math.floor((salary * cover * 10) / (P * 30)));
    expect(s.cash.wages['2027-9a'].cover).toBe(Math.floor((salary * cover * 10) / (P * 30)));
  }, 120_000);

  test('без людей роли и без заместителя работа ждёт «в отпуске»; в потерях суток — тоже', () => {
    const { s, seen } = sampler();
    expect(seen.some(x => x.t >= at(ymd(2027, 9, 6), 10) && x.t < at(ymd(2027, 9, 20), 0) && x.why === 'leave')).toBe(true);
    expect(seen.some(x => x.t < at(ymd(2027, 9, 6), 0) && x.why === 'leave')).toBe(false);
    expect(s.losses.some(l => (l.wait.qc?.leave ?? 0) > 0)).toBe(true);
  }, 120_000);
});

describe('учётный период сменного', () => {
  test('норма учётного периода меньше на часы его смен в отпуске: сверхурочных от отпуска не становится больше или меньше', () => {
    const d = calm();
    const row = d.scenarios[SC].staff.find(r => r.role === 'role.operator' && r.shift === 'shift.b')!;
    row.shift = 'shift.c1';
    const s = newPlant(d, { scenario: SC });
    const p = Object.values(s.people).find(x => x.shift === 'shift.c1')!;
    live(d, s, at(ymd(2027, 9, 30), 23));
    const [from, last] = periodOf(d, s, ymd(2027, 9, 30));
    // работа после смен — 40 часов в первые дни сентября, в часы вне отпуска
    const q = structuredClone(p);
    q.sa = { from: (from - start) * DAY, segs: [[at(ymd(2027, 9, 2), 20) + 3600, at(ymd(2027, 9, 2), 20) + 41 * 3600]] };
    const base = saResult(d, s, q, from, last, s.t)!;
    const away = structuredClone(q);
    away.away = [{ id: 'A1', y: 2027, from: ymd(2027, 9, 13), to: ymd(2027, 9, 26), days: 14 }];
    const off = saResult(d, s, away, from, last, s.t)!;
    expect(base.over).toBeGreaterThan(0);
    expect(off.over).toBe(base.over);
    // смен в отпуске по графику — были, их часы сняты и с отработанного, и с нормы
    let shifts = 0;
    for (let z = ymd(2027, 9, 12); z <= ymd(2027, 9, 26); z++) if (graphSpan(d, s, away, z) && !spanOn(d, s, away, z)) shifts++;
    expect(shifts).toBeGreaterThan(4);
  }, 120_000);
});

describe('компенсация при увольнении', () => {
  const clock = { start: db.scenarios[SC].start.date, scenario: SC };
  const hire = ymd(2028, 1, 10);
  const who = (away: Away[] = []): Person => ({ id: 'E99', role: 'role.cleaner', shift: 'shift.a', skill: 3, tab: 1099, train: {}, x: 0, z: 0, ot: [], otYear: { y: 2028, sec: 0 }, hired: hire, away });

  test('заработано: за полный год — 28 дней, за неполный — 28 / 12 за месяц; излишек меньше половины месяца — нет, не меньше — месяц; 11 месяцев — 28', () => {
    // четыре месяца и 11 дней — четыре месяца; четыре и 27 — пять
    expect(earnedDays(db, clock, who(), ymd(2028, 5, 20))).toBe(Math.floor((2800 * 4) / 12));
    expect(earnedDays(db, clock, who(), ymd(2028, 6, 5))).toBe(Math.floor((2800 * 5) / 12));
    // 11 месяцев и 11 дней — 28 дней
    expect(earnedDays(db, clock, who(), ymd(2028, 12, 20))).toBe(2800);
    // десять месяцев и 15 дней — 11 месяцев: 28 дней; и 14 — десять
    expect(earnedDays(db, clock, who(), ymd(2028, 11, 24))).toBe(2800);
    expect(earnedDays(db, clock, who(), ymd(2028, 11, 23))).toBe(Math.floor((2800 * 10) / 12));
    // год и месяц с 20 днями — 28 + 28 / 12 × 2
    expect(earnedDays(db, clock, who(), ymd(2029, 3, 1))).toBe(2800 + Math.floor((2800 * 2) / 12));
    // люди сценария — с начала завода
    expect(earnedDays(db, clock, { hired: undefined }, ymd(2027, 9, 20))).toBe(Math.floor(2800 / 12));
  });

  test('компенсация — заработано минус использовано, не меньше нуля; отгулянное авансом не удерживают', () => {
    const part: Away = { id: 'A1', y: 2028, from: ymd(2028, 7, 3), to: ymd(2028, 7, 16), days: 14 };
    expect(usedDays(who([part]), ymd(2028, 7, 2))).toBe(0);
    expect(usedDays(who([part]), ymd(2028, 7, 3))).toBe(1400);
    expect(compDays(db, clock, who([part]), ymd(2028, 12, 20))).toBe(1400);
    expect(compDays(db, clock, who([part, { ...part, id: 'A2', from: ymd(2028, 8, 7), to: ymd(2028, 8, 20) }]), ymd(2028, 9, 1))).toBe(0);
  });

  test('средний дневной на примере: неполный месяц приёма, прошлый отпуск, неначисленные дни последнего месяца', () => {
    const s = newPlant(db, { scenario: SC });
    const k = (y: number, m: number) => y * 12 + m - 1;
    const p: Person = {
      ...who([{ id: 'A1', y: 2028, from: ymd(2028, 1, 10), to: ymd(2028, 1, 23), days: 14, paid: 1 }]),
      hired: ymd(2027, 10, 11),
      paid: ymd(2028, 7, 15),
      earn: [
        [k(2027, 10), 2_000_000],
        [k(2027, 11), 3_000_000],
        [k(2027, 12), 3_000_000],
        [k(2028, 1), 1_600_000],
        [k(2028, 2), 3_000_000],
        [k(2028, 3), 3_000_000],
        [k(2028, 4), 3_000_000],
        [k(2028, 5), 3_000_000],
        [k(2028, 6), 3_000_000],
        [k(2028, 7), 1_500_000],
      ],
    };
    // август 2027 и сентябрь — до приёма; октябрь — 21 день из 31; январь — 17 дней из 31 без отпуска; июль — начислено
    // по 15-е; остальное — полные месяцы
    const den = Math.floor((29300 * 21) / 31) + 29300 * 2 + Math.floor((29300 * 17) / 31) + 29300 * 5 + Math.floor((29300 * 15) / 31);
    const sum = 2_000_000 + 3_000_000 * 2 + 1_600_000 + 3_000_000 * 5 + 1_500_000;
    expect(avgDaily(db, s, p, 2028, 8)).toBe(Math.floor((sum * 1000) / den));
    // ни одного дня в периоде — оклад на 29,3
    expect(avgDaily(db, s, { ...p, hired: ymd(2028, 9, 1), earn: [] }, 2028, 9)).toBe(Math.floor((db.roles['role.cleaner'].salary * 1000) / 29300));
  });
});

describe('смежная профессия', () => {
  test('обучить — задачи изучить документы строки её роли, которых нет; снять — записи остаются, задачи сняты; отказы', () => {
    const s = newPlant(db, { scenario: SC });
    const p = s.people.E5;
    expect(p.also).toBeUndefined();
    const mine = () => Object.values(s.tasks).filter(t => t.kind === 'train' && t.trainee === 'E5');
    const own = new Set(mine().map(t => t.id));
    expect(apply(db, s, { kind: 'also', person: 'E5', role: 'role.sampler', on: true })).toEqual([]);
    expect(p.also).toEqual(['role.sampler']);
    const day = today(s);
    const want = matrixOf(db, 'role.sampler').filter(c => !knows(db, p, c, day));
    expect(want.length).toBeGreaterThan(0);
    const studies = mine().filter(t => !own.has(t.id));
    expect(studies.map(t => (db.sops[t.doc!] ?? db.tests[t.doc!]).doc.code).sort()).toEqual([...want].sort());
    expect(rowsOf(db, p)).toEqual([...new Set([...matrixOf(db, 'role.analyst'), ...matrixOf(db, 'role.sampler')])]);
    expect(apply(db, s, { kind: 'also', person: 'E5', role: 'role.sampler', on: false })).toEqual([]);
    expect(p.also).toBeUndefined();
    // задачи своей роли — на месте, новые — сняты
    expect(mine().map(t => t.id).sort()).toEqual([...own].sort());
    expect(apply(db, s, { kind: 'also', person: 'E5', role: 'role.analyst', on: true })).toEqual([{ kind: 'refused', cmd: 'also', why: 'ownRole', detail: 'role.analyst' }]);
    expect(apply(db, s, { kind: 'also', person: 'E5', role: 'role.qp', on: true })).toEqual([{ kind: 'refused', cmd: 'also', why: 'sameOnly', detail: 'role.qp' }]);
    expect(apply(db, s, { kind: 'also', person: 'E5', role: 'role.none', on: true })).toEqual([{ kind: 'refused', cmd: 'also', why: 'noRole', detail: 'role.none' }]);
    apply(db, s, { kind: 'seat', seats: ['production'] });
    expect(apply(db, s, { kind: 'also', person: 'E5', role: 'role.sampler', on: true, by: 'player' })).toEqual([{ kind: 'refused', cmd: 'also', why: 'notYours', detail: 'quality' }]);
  });
});

describe('завод не встаёт', () => {
  test('две части без кладовщика и без заместителя: тара комплекта упаковки у линии — на месте, серии идут весь год', () => {
    const d = calm();
    delete d.scenarios[SC].leave;
    const s = newPlant(d, { scenario: SC });
    s.people.E1.away = [
      { id: 'A1', y: 2027, from: ymd(2027, 10, 4), to: ymd(2027, 10, 17), days: 14 },
      { id: 'A2', y: 2028, from: ymd(2028, 3, 20), to: ymd(2028, 4, 2), days: 14 },
    ];
    s.next.A = 2;
    const end = s.t + 366 * DAY;
    while (s.t < end) apply(d, s, { kind: 'advance', seconds: 6 * HOUR });
    expect(check(d, s)).toEqual([]);
    const released = Object.values(s.batches).filter(b => b.status === 'released').length;
    // до исправления — 103 серии: после второй части задания на упаковку ждали друг друга до конца года
    expect(released).toBeGreaterThan(180);
    const stuck = Object.values(s.batches).filter(b => b.status === 'packing' && b.pack && b.pack.state !== 'running' && b.pack.created < s.t - 30 * DAY);
    expect(stuck).toEqual([]);
  }, 240_000);
});

describe('сохранения', () => {
  test('образец схемы 24: запас людей и смежные профессии сценария — с записями обучения; графиков нет; завод живёт дальше', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v24.json', import.meta.url)).text();
    const raw = JSON.parse(json) as { people: Record<string, { role: string }> };
    const s = fromSave(db, json);
    expect(s.leave).toEqual({});
    const count = (x: Record<string, { role: string }>, role: string) => Object.values(x).filter(p => p.role === role).length;
    const want = (role: string) => db.scenarios[SC].staff.filter(r => r.role === role).reduce((n, r) => n + r.n, 0);
    for (const role of ['role.operator', 'role.packer', 'role.qp']) expect([role, count(s.people, role)]).toEqual([role, Math.max(want(role), count(raw.people, role))]);
    const day = today(s);
    for (const p of Object.values(s.people)) for (const code of rowsOf(db, p)) expect([p.id, code, !!p.train[code]]).toEqual([p.id, code, true]);
    expect(s.people.E1.also).toEqual(['role.driver']);
    expect(Object.values(s.people).filter(p => p.also).length).toBe(8);
    expect(Object.values(s.people).every(p => rowsOf(db, p).every(c => p.train[c].day <= day))).toBe(true);
    live(db, s, s.t + 2 * DAY);
  }, 120_000);
});

describe('образец схемы 25', () => {
  test('посреди отпуска: читается, смен у ушедшего нет, отпускные известённой части — в свой день, завод живёт дальше', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v25.json', import.meta.url)).text();
    const s = fromSave(db, json);
    const z = today(s);
    const parts = Object.values(s.people).flatMap(p => (p.away ?? []).map(a => ({ p, a })));
    const going = parts.filter(x => x.a.from <= z && z <= x.a.to && x.a.deputy && x.a.paid !== undefined);
    expect(going.length).toBeGreaterThan(0);
    for (const x of going) expect(spanOn(db, s, x.p, z)).toBeUndefined();
    const next = parts.find(x => x.a.from > z && x.a.told && x.a.paid === undefined)!;
    const pay = workdayOnOrBefore(calOf(db, s), next.a.from - law.pay);
    live(db, s, at(next.a.from, 0));
    const a = s.people[next.p.id].away!.find(x => x.id === next.a.id)!;
    expect(a.paid).toBeGreaterThan(0);
    expect(s.cash.ledger.find(x => x.ref === `vac-${a.id}`)!.t).toBe(at(pay, 10));
  }, 120_000);
});

describe('сборщик базы — на испорченной копии content/', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const x of dirs) rmSync(x, { recursive: true, force: true });
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

  test('правило черновика: части короче 14 дней, не складываются в дни года; сроки — не в году; утверждение позже срока', () => {
    has(broken({ [SCN]: [['  parts: [14, 14]\n', '  parts: [10, 10, 8]\n']] }), 'нет части не короче 14');
    has(broken({ [SCN]: [['  parts: [14, 14]\n', '  parts: [14, 7]\n']] }), 'части дают 21 дн., а за год — 28');
    has(broken({ [SCN]: [['  summer: [[6, 1], [8, 31]]\n', '  summer: [[6, 1], [6, 31]]\n']] }), 'summer: по 31.6 нет в году');
    has(broken({ [SCN]: [['  approve: [12, 17]\n', '  approve: [12, 20]\n']] }), 'график утверждают позже чем за 14 дн. до года');
  });

  test('смежная профессия: своя роль, уполномоченное лицо, нет роли', () => {
    has(broken({ [SCN]: [['n: 1, also: [role.driver] }', 'n: 1, also: [role.storekeeper] }']] }), 'смежная профессия — своя роль');
    has(broken({ [SCN]: [['n: 1, also: [role.driver] }', 'n: 1, also: [role.qp] }']] }), 'её заменяет только человек той же роли');
    has(broken({ [SCN]: [['n: 1, also: [role.driver] }', 'n: 1, also: [role.nobody] }']] }), 'нет такой роли');
  });

  test('черновик стартового штата не помещается — ошибка', () => {
    // 30 уборщиков одной роли уходят по одному: 30 × 28 дней в году не помещаются
    has(broken({ [SCN]: [['  - { role: role.cleaner, shift: shift.a, skill: 3, n: 1 }', '  - { role: role.cleaner, shift: shift.a, skill: 3, n: 30 }']] }), 'не всем частям нашлось место по правилу');
  });
});
