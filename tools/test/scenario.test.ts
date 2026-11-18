// Сценарии кампании (Б9, шаг 1; docs/specs/2026-10-vertical-slice.md, «Б9»): сценарий от сценария, прогрев, фура
// сценария, цели и конец срока.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { goalSpan, goalsNow, goalValue } from '../../src/engine/goals';
import { check } from '../../src/engine/invariants';
import { fromSave, toSave } from '../../src/engine/save';
import type { Notice } from '../../src/engine/types';

const c1 = db.scenarios['scn.c1'];
const proto = db.scenarios['scn.proto'];

describe('сценарий от сценария', () => {
  test('поля основы — у сценария 1, свои — целиком', () => {
    expect(c1.staff).toEqual(proto.staff);
    expect(c1.plant).toBe(proto.plant);
    expect(c1.customers).toEqual(['cus.district']);
    expect(c1.incident).toBeUndefined();
    expect(c1.campaign).toBe(1);
    expect(c1.seats).toEqual(['director']);
    expect(proto.warm).toBe(0);
    expect(proto.goals).toEqual([]);
  });
});

describe('прогрев и фура сценария', () => {
  const s = newPlant(db, { scenario: 'scn.c1' });
  test('старт игрока — 07:00 после недели прогрева, записи целы', () => {
    expect(c1.warm).toBe(7 * DAY);
    expect(s.t).toBe(7 * HOUR + 7 * DAY);
    expect(check(db, s)).toEqual([]);
    expect(Object.values(s.batches).filter(b => b.status === 'released').length).toBeGreaterThan(0);
  });
  test('прогрев детерминирован', () => {
    expect(toSave(newPlant(db, { scenario: 'scn.c1' }))).toBe(toSave(s));
  });
  test('серия на упаковке в 07:00 выпускается в первый день; фура — у рампы в первый час', () => {
    const x = fromSave(db, toSave(s));
    const before = new Set(Object.values(x.batches).filter(b => b.status === 'released').map(b => b.id));
    const truck = Object.values(x.pos).find(p => p.by === 'scenario')!;
    expect(truck.eta).toBe(x.t + 20 * 60);
    apply(db, x, { kind: 'advance', seconds: HOUR });
    expect(x.pos[truck.id].status).not.toBe('ordered');
    apply(db, x, { kind: 'advance', seconds: 16 * HOUR });
    expect(Object.values(x.batches).some(b => b.status === 'released' && !before.has(b.id))).toBe(true);
  });
  test('цели — числа записей; конец срока — извещение, касса — к концу срока', () => {
    const x = fromSave(db, toSave(s));
    const { from, to } = goalSpan(db, x);
    expect(from).toBe(x.t);
    expect(to).toBe(x.t + 28 * DAY);
    const notices: Notice[] = apply(db, x, { kind: 'advance', seconds: 28 * DAY });
    expect(notices.filter(n => n.kind === 'scenarioEnd').length).toBe(1);
    expect(x.t).toBe(to!);
    const cash = c1.goals.find(g => g.kind === 'cash')!;
    expect(goalValue(db, x, cash)).toBe(x.cash.balance);
    const now = goalsNow(db, x);
    expect(now.ended).toBe(true);
    expect(now.goals.length).toBe(c1.goals.length);
    // после конца срока итог тот же: окно счёта — до конца, касса — по проводкам до него
    apply(db, x, { kind: 'advance', seconds: 3 * DAY });
    expect(goalsNow(db, x).goals.map(g => g.v)).toEqual(now.goals.map(g => g.v));
    expect(check(db, x)).toEqual([]);
  }, 120_000);
  test('у прототипа ни прогрева, ни срока, ни целей', () => {
    const p = newPlant(db, { scenario: 'scn.proto' });
    expect(p.t).toBe(proto.start.hour * HOUR);
    expect(goalsNow(db, p)).toEqual({ goals: [], ended: false });
  });
});
