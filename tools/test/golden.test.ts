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
    batches: Object.values(s.batches).filter(b => b.status === 'released').length,
    tablets: Object.values(s.batches).reduce((n, b) => n + (b.units ?? 0), 0),
    packs: Object.values(s.batches).reduce((n, b) => n + (b.pack?.cartons ?? 0) - (b.pack?.cartonRejects ?? 0), 0),
    cases: Object.values(s.batches).reduce((n, b) => n + (b.pack?.cases ?? 0), 0),
    deviations: Object.keys(s.deviations).length,
    trucks: Object.keys(s.trucks).length,
    tasks: Object.keys(s.tasks).length,
  }).toEqual(GOLDEN.totals);
  expect(fingerprint(s)).toBe(GOLDEN.print);
});

/**
 * Часть 1г (0.0.5): восемь серий упакованы и выпущены — пять №20 и три №10, 106 484 годные пачки в 650 ящиках; брак
 * камеры картонажной — 0,3 % пачек, остаток — до 17 таблеток на серию. Партий — 34: к 24 прежним добавились заказанные
 * пачки №10 и гофроящики и восемь партий ГП; все разрешены или выпущены. Отклонений нет; фур и задач в конце нет. В 1в
 * (0.0.4, отпечаток `d48326a5`) балк ждал упаковки.
 */
const GOLDEN = {
  totals: { lots: 34, released: 34, rejected: 0, units: 52, tests: 35, batches: 8, tablets: 1563659, packs: 106484, cases: 650, deviations: 0, trucks: 0, tasks: 0 },
  print: 'b88d003e',
};
