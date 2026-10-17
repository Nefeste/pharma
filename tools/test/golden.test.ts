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
    trucks: Object.keys(s.trucks).length,
    tasks: Object.keys(s.tasks).length,
  }).toEqual(GOLDEN.totals);
  expect(fingerprint(s)).toBe(GOLDEN.print);
});

/**
 * Часть 1б (0.0.3): 11 партий запаса + 5 принятых (крахмал, МКЦ, пачки №20, инструкции, парацетамол). Все пять прошли
 * отбор проб и 9 испытаний и разрешены; все 22 паллеты — на стеллажах; фур и задач в конце нет. В 1а (0.0.2, отпечаток
 * `479c4101`) все пять стояли в карантине: лаборатории не было.
 */
const GOLDEN = {
  totals: { lots: 16, released: 16, rejected: 0, units: 22, tests: 9, trucks: 0, tasks: 0 },
  print: '60acaa6d',
};
