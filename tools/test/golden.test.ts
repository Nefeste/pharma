// Золотой прогон (docs/specs/2026-10-engine.md, «Подчасти»): сценарий прототипа с зерном сценария на 90 суток без ручных
// команд. Отпечаток состояния закреплён: любое изменение поведения движка его меняет. Изменили нарочно — запишите новый
// отпечаток и в описании коммита скажите, что поменялось в жизни завода.
import { expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';

test('scn.proto, 90 суток: отпечаток и итоги', () => {
  const s = newPlant(db, { scenario: 'scn.proto' });
  const end = s.t + 90 * DAY;
  while (s.t < end) {
    apply(db, s, { kind: 'advance', seconds: 3600 });
    expect(check(db, s)).toEqual([]);
  }
  const lots = Object.values(s.lots);
  expect({
    lots: lots.length,
    released: lots.filter(l => l.status === 'released').length,
    rejected: lots.filter(l => l.status === 'rejected').length,
    units: Object.keys(s.units).length,
    tests: Object.keys(s.tests).length,
    batches: Object.values(s.batches).filter(b => b.status === 'bulk').length,
    tablets: Object.values(s.batches).reduce((n, b) => n + (b.units ?? 0), 0),
    deviations: Object.keys(s.deviations).length,
    trucks: Object.keys(s.trucks).length,
    tasks: Object.keys(s.tasks).length,
  }).toEqual(GOLDEN.totals);
  expect(fingerprint(s)).toBe(GOLDEN.print);
});

/**
 * Часть 1в (0.0.4): 11 партий запаса, 5 принятых и 8 партий балка — все разрешены. Восемь серий по карте: пять — из
 * запаса АФС, три — из партии АФС по заказу, когда её разрешила лаборатория; испытаний — 9 входных и по 3 на балк.
 * Таблеток — 1 563 659, около 195 тысяч на серию. Отклонений нет; фур и задач в конце нет. В 1б (0.0.3, отпечаток
 * `60acaa6d`) серий не было.
 */
const GOLDEN = {
  totals: { lots: 24, released: 24, rejected: 0, units: 30, tests: 33, batches: 8, tablets: 1563659, deviations: 0, trucks: 0, tasks: 0 },
  print: 'd48326a5',
};
