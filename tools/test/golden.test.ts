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
    orders: Object.keys(s.orders).length,
    onTime: Object.values(s.orders).filter(o => o.status === 'shipped').length,
    short: Object.values(s.orders).filter(o => o.status === 'short').length,
    shipped: Object.values(s.shipments).reduce((n, h) => n + h.cases.length, 0),
    cash: s.cash.balance,
  }).toEqual(GOLDEN.totals);
  expect(fingerprint(s)).toBe(GOLDEN.print);
});

/**
 * Часть 1д (0.0.6): два дистрибьютора сделали 63 заказа; 26 отгружены в срок полностью, 35 закрыты недопоставкой (первые
 * три недели ГП ещё нет; с 18.10 по 15.11 серии №20 ждали выпуска), 2 ждут своего дня. 481 отгруженный ящик; партии ГП
 * уходят в оборот через 1–3 рабочих дня после выпуска. Касса: из 30 млн ₽ осталось 21,68 млн — зарплата дважды в месяц,
 * взносы, энергия (вентиляция — круглые сутки), предоплата поставщикам и остаток после прихода, коды маркировки №20;
 * поступления от покупателей — через 45–60 дней. В 1г (0.0.5, отпечаток `b88d003e`) ГП оставалась на складе.
 */
const GOLDEN = {
  totals: {
    lots: 34, released: 34, rejected: 0, units: 36, tests: 35, batches: 8, tablets: 1563659, packs: 106484, cases: 650, deviations: 0, trucks: 0, tasks: 0,
    orders: 63, onTime: 26, short: 35, shipped: 481, cash: 2168008625,
  },
  print: '963f0e58',
};
