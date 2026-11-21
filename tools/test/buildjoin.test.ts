// Снос стены (по игре владельца 20.11.2026; docs/specs/2026-10-vertical-slice.md, «Б7б»): два соседних помещения одного
// типа, класса и проезда — в одно; прямоугольник — их сумма, стена и двери в ней уходят, учёт и места — по новому плану;
// без цены. Нельзя: разный тип, не прямоугольник, во втором — вещи, второе занято.
import { describe, expect, test } from 'bun:test';
import { targetAt } from '../../src/app/build';
import { db } from '../../src/content';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { planOf } from '../../src/engine/plant';
import { siteErrors } from '../../src/engine/site/checks';
import { type BuildOp, joinRect } from '../../src/engine/site/edit';
import type { Notice, PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const site = (s: PlantState, op: BuildOp | { op: 'done' } | { op: 'undo' }) =>
  apply(db, s, { kind: 'site', op }).filter((n): n is Extract<Notice, { kind: 'site' }> => n.kind === 'site');

const HULL: BuildOp = { op: 'hull', rect: [59, 18, 12, 12] };
const A: BuildOp = { op: 'room', type: 'corridor', grade: 'cnc', rect: [59, 20, 12, 5] };
const B2: BuildOp = { op: 'room', type: 'corridor', grade: 'cnc', rect: [59, 24, 12, 5] };
const IN: BuildOp = { op: 'door', cell: [59, 22], len: 1, along: 'z', kind: 'door' };
const MID: BuildOp = { op: 'door', cell: [64, 24], len: 1, along: 'x', kind: 'door' };

describe('снос стены', () => {
  test('сумма прямоугольников: бок о бок по общей стене — да; сдвинуты или разной высоты — нет', () => {
    expect(joinRect([0, 0, 500, 400], [400, 0, 300, 400])).toEqual([0, 0, 700, 400]);
    expect(joinRect([400, 0, 300, 400], [0, 0, 500, 400])).toEqual([0, 0, 700, 400]);
    expect(joinRect([0, 0, 400, 500], [0, 400, 400, 300])).toEqual([0, 0, 400, 700]);
    expect(joinRect([0, 0, 500, 400], [400, 100, 300, 400])).toBeUndefined();
    expect(joinRect([0, 0, 500, 400], [400, 0, 300, 500])).toBeUndefined();
    expect(joinRect([0, 0, 500, 400], [600, 0, 300, 400])).toBeUndefined();
  });

  test('два коридора — один: стена и дверь в ней уходят, второго в учёте нет, денег не берут, план без ошибок', () => {
    const s = newPlant(db, { scenario: SC });
    for (const op of [HULL, A, IN, B2, MID]) expect(site(s, op)[0].ok).toBe(true);
    const cash = s.cash.balance;
    const r = site(s, { op: 'join', a: 'corridor-1', b: 'corridor-2' });
    expect(r).toEqual([{ kind: 'site', op: 'join', ok: true, cost: 0, thing: 'corridor-1' }]);
    const p = planOf(db, s.plan).plant;
    expect(p.rooms.find(x => x.id === 'corridor-1')!.rect).toEqual([5900, 2000, 1200, 900]);
    expect(p.rooms.some(x => x.id === 'corridor-2')).toBe(false);
    expect(p.doors.some(d => d.cell[0] === 64 && d.cell[1] === 24)).toBe(false);
    expect(s.rooms['corridor-2']).toBeUndefined();
    expect(s.cash.balance).toBe(cash);
    expect(siteErrors(db, s.plan).filter(e => e.code !== 'walk' || e.what?.kind !== 'room')).toEqual([]);
    site(s, { op: 'done' });
    expect(check(db, s)).toEqual([]);
    // отмена — снова два
    site(s, { op: 'undo' });
    expect(planOf(db, s.plan).plant.rooms.some(x => x.id === 'corridor-2')).toBe(true);
  });

  test('чистый коридор и его продолжение в пристройке — одно помещение (игра владельца)', () => {
    const s = newPlant(db, { scenario: SC });
    expect(site(s, { op: 'hull', rect: [59, 6, 12, 10] })[0].ok).toBe(true);
    expect(site(s, { op: 'room', type: 'corridor.clean', grade: 'D', rect: [59, 9, 12, 4] })[0].ok).toBe(true);
    const id = planOf(db, s.plan).plant.rooms.at(-1)!.id;
    const op = targetAt(db, planOf(db, s.plan).plant, [59, 10]);
    expect(op).toEqual({ op: 'join', a: 'clean', b: id });
    expect(site(s, op!)[0]).toMatchObject({ ok: true, thing: 'clean' });
    expect(planOf(db, s.plan).plant.rooms.find(x => x.id === 'clean')!.rect).toEqual([3000, 900, 4100, 400]);
  });

  test('нельзя: другой тип или класс, не прямоугольник, во втором — вещи, нет такого', () => {
    const s = newPlant(db, { scenario: SC });
    site(s, HULL);
    site(s, A);
    site(s, { op: 'room', type: 'corridor', grade: 'cnc', rect: [59, 24, 8, 5] });
    const why = (op: BuildOp) => {
      const n = site(s, op)[0];
      return n.ok ? 'ok' : n.error.code;
    };
    expect(why({ op: 'join', a: 'corridor-1', b: 'corridor-2' })).toBe('joinShape');
    expect(why({ op: 'join', a: 'hall', b: 'lab' })).toBe('joinType');
    expect(why({ op: 'join', a: 'lab', b: 'office' })).toBe('joinType');
    expect(why({ op: 'join', a: 'corridor-1', b: 'nope' })).toBe('noThing');
    expect(why({ op: 'join', a: 'corridor-1', b: 'corridor-1' })).toBe('noThing');
  });
});
