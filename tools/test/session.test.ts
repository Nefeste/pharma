// Итог игры на планёрке (обёртка, docs/specs/2026-10-vertical-slice.md, «Первая неделя»): что завод сделал с мгновения,
// с которого окно ведёт игру, до планёрки — серии, пачки, заказы, отклонения, расследования и касса по записям; меньше
// суток игры — блока нет; без `since` — нет; истины не читает.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR, momentOf } from '../../src/engine/core/calendar';
import { apply, MORNING, newPlant } from '../../src/engine/engine';
import type { Notice, PlantState } from '../../src/engine/types';
import { morningView, sessionSum } from '../../src/sim/report';

const SC = 'scn.proto';

/** Первая неделя сценария без игрока: коллеги ведут всё; извещения — по часам. */
const s: PlantState = newPlant(db, { scenario: SC });
const t0 = s.t;
const notices: Notice[] = [];
while (s.t < t0 + 7 * DAY + 2 * HOUR) notices.push(...apply(db, s, { kind: 'advance', seconds: HOUR }));
const day0 = momentOf(s.start, 0).day;
const day = momentOf(s.start, s.t).day;
const at = (day - day0) * DAY + MORNING;
const count = (kind: Notice['kind']) => notices.filter(n => n.kind === kind).length;

describe('итог игры', () => {
  const v = morningView(db, s, { view: 'morning', day, since: t0 });
  const x = v.session!;

  test('на планёрке восьмого утра — с начала игры до 08:00', () => {
    expect(x.from).toBe(t0);
    expect(x.to).toBe(at);
    expect(x).toEqual(sessionSum(s, t0, at));
  });

  test('серии — те же, что извещения недели: балк, упаковано, выпущено; отклонено — по партиям', () => {
    expect(x.bulk).toBe(count('batchBulk'));
    expect(x.packed).toBe(count('batchPacked'));
    expect(x.released).toBe(count('batchReleased'));
    expect(x.bulk).toBeGreaterThan(0);
    expect(x.released).toBeGreaterThan(0);
    const rejected = Object.values(s.batches).filter(b => b.status === 'rejected' && [b.bulk, b.pack?.fg].some(id => id && s.lots[id]?.status === 'rejected' && s.lots[id].since! < at));
    expect(x.rejected).toBe(rejected.length);
    // пачки — у заданий, которые кончились, без брака камеры
    const done = Object.values(s.batches).filter(b => b.pack?.state === 'done' && b.pack.end! < at);
    expect(x.packs).toBe(done.reduce((n, b) => n + b.pack!.cartons! - (b.pack!.cartonRejects ?? 0), 0));
    expect(x.packs).toBeGreaterThan(0);
  });

  test('заказы, отклонения, расследования и касса — по записям', () => {
    const closed = Object.values(s.orders).filter(o => o.status !== 'open');
    expect(x.closed).toBe(closed.length);
    expect(x.onTime).toBe(closed.filter(o => o.status === 'shipped').length);
    expect(x.closed).toBe(count('shipped'));
    expect(x.deviations).toBe(Object.keys(s.deviations).length);
    expect(x.open).toBe(Object.values(s.deviations).filter(d => d.status === 'open').length);
    expect(x.concluded).toBe(count('concluded'));
    expect(x.balance).toBe(s.cash.balance);
    expect(x.change).toBe(s.cash.ledger.filter(e => e.t < at).reduce((n, e) => n + e.sum, 0));
  });

  test('меньше суток игры и без начала игры — блока нет', () => {
    expect(morningView(db, s, { view: 'morning', day }).session).toBeUndefined();
    expect(morningView(db, s, { view: 'morning', day, since: at - DAY + 1 }).session).toBeUndefined();
    expect(morningView(db, s, { view: 'morning', day, since: at - DAY }).session?.from).toBe(at - DAY);
  });

  test('позже начала — только то, что было после него', () => {
    const late = sessionSum(s, t0 + 5 * DAY, at);
    expect(late.bulk).toBeLessThan(x.bulk);
    expect(late.deviations).toBe(Object.values(s.deviations).filter(d => d.opened >= t0 + 5 * DAY && d.opened < at).length);
  });

  test('без истины: два завода с разными истинными полями — один итог', () => {
    const b: PlantState = structuredClone(s);
    for (const lot of Object.values(b.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
    for (const bt of Object.values(b.batches)) {
      for (const k of Object.keys(bt.truth) as (keyof typeof bt.truth)[]) bt.truth[k] = (bt.truth[k] ?? 0) + 777;
      bt.causes = [];
      if (bt.pack) bt.pack.lost = (bt.pack.lost ?? 0) + 99;
    }
    for (const p of Object.values(b.parts)) p.budget += 12345;
    expect(sessionSum(b, t0, at)).toEqual(x);
  });
});
