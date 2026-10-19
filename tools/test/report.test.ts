// Часть 3в: планёрка и касса (docs/specs/2026-10-panels.md, 3в). Вчера — сменные задания, ритм и OEE суток линии, главная
// потеря — наибольшая; с прошлой планёрки — ровно события за 24 часа до 08:00; сейчас — нехватка как у заданий, сломанное,
// лаборатория, заказы под угрозой без записи в состояние; касса — счета по сроку с остатком после каждого, проводки за
// сутки, низшая точка; виды не читают истины.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR, momentOf } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, MORNING, newPlant } from '../../src/engine/engine';
import { oee, rhythm, shiftsOfDay } from '../../src/engine/lean';
import type { PlantState } from '../../src/engine/types';
import { CASH_PAGE, cashView, lineSum, mainLoss, morningView, topView } from '../../src/sim/report';

const SC = 'scn.proto';
const plan = { lines: db.plants[db.scenarios[SC].plant].lines };

/** Шесть недель жизни — и до 08:00: планёрка «сегодня» только что прошла. */
const s: PlantState = newPlant(db, { scenario: SC });
apply(db, s, { kind: 'advance', seconds: 42 * DAY + HOUR });
const day0 = momentOf(s.start, 0).day;
const today = momentOf(s.start, s.t).day;
const at = (day: number) => (day - day0) * DAY + MORNING;
/** Сутки после упаковки: вчера линия работала. */
const packed = Object.values(s.batches)
  .map(b => b.pack?.end)
  .filter((t): t is number => t !== undefined)
  .map(t => momentOf(s.start, t).day + 1)
  .filter(d => d <= today);

describe('планёрка: вчера', () => {
  test('выпуск по сменам и ритм — сменные задания вчера; OEE — ключевой машины по суткам линии', () => {
    expect(packed.length).toBeGreaterThan(2);
    for (const day of packed) {
      const v = morningView(db, s, { view: 'morning', day });
      const tasks = shiftsOfDay(s, day - 1);
      expect(v.shifts).toEqual(tasks.map(t => ({ line: t.line, shift: t.shift, plan: t.plan, ...(t.fact !== undefined ? { fact: t.fact } : {}) })));
      expect(v.rhythm).toBe(rhythm(tasks));
      const yest = s.losses.find(d => d.day === day - 1)!;
      plan.lines.forEach((l, n) => {
        const ld = yest.lines[l.id];
        const sum = v.lines[n];
        expect(sum.key).toBeDefined();
        // ключевая — с наименьшим выпуском по номиналу за загрузку
        expect(Math.min(...ld.ideal)).toBe(ld.ideal[sum.key!]);
        expect(sum.oee).toEqual(oee({ ideal: ld.ideal[sum.key!], run: ld.run[sum.key!], out: ld.times[sum.key!].out }, ld.good)!);
        expect(sum.oee!.oee).toBeGreaterThan(0);
      });
    }
  });

  test('главная потеря — наибольшая: ожидания по отделу и причине, потери линий, перевозки, переходы', () => {
    for (const day of packed) {
      const v = morningView(db, s, { view: 'morning', day });
      const d = s.losses.find(x => x.day === day - 1)!;
      const m = v.main!;
      expect(m.sec).toBeGreaterThan(0);
      for (const causes of Object.values(d.wait)) for (const sec of Object.values(causes ?? {})) expect(sec ?? 0).toBeLessThanOrEqual(m.sec);
      for (const l of v.lines) expect(l.loss?.sec ?? 0).toBeLessThanOrEqual(m.sec);
      expect(Object.values(d.move).reduce((n, x) => n + (x?.sec ?? 0), 0)).toBeLessThanOrEqual(m.sec);
      expect(Object.values(d.walk).reduce((n, x) => n + (x?.sec ?? 0), 0)).toBeLessThanOrEqual(m.sec);
      expect(m).toEqual(mainLoss(d, v.lines)!);
    }
  });

  test('потеря линии — наибольшая составляющая ключевой машины; ждала соседей — рядом сосед', () => {
    const ld = { times: [0, 1, 2].map(() => ({ run: 3000, slow: 0, micro: 0, fail: 0, wait: 0, setup: 0, off: 0, out: 0, slowOut: 0 })), ideal: [0, 0, 0], run: [0, 0, 0], good: 0 };
    // ключевая — вторая: выпуск по номиналу меньше всех; ждала соседей 900 с, у первой — микроостановки 1200 с
    ld.times[1] = { ...ld.times[1], wait: 900, out: 2000 * 60 };
    ld.times[0] = { ...ld.times[0], micro: 1200, out: 3000 * 60 };
    ld.ideal = [4200 * 60, 3900 * 60, 6000 * 60];
    ld.run = [4200 * 60, 3900 * 60, 6000 * 60];
    ld.good = 1950 * 60;
    const sum = lineSum(0, ld);
    expect(sum.key).toBe(1);
    expect(sum.loss).toEqual({ what: 'wait', sec: 900 });
    expect(sum.neighbour).toEqual({ k: 0, what: 'micro', sec: 1200 });
    expect(lineSum(0, undefined)).toEqual({ line: 0 });
  });

  test('первая планёрка игры — без вчера: вчерашних суток у завода нет', () => {
    const first = morningView(db, s, { view: 'morning', day: day0 });
    expect(first.first).toBe(true);
    expect([first.shifts, first.main]).toEqual([[], undefined]);
    expect(morningView(db, s, { view: 'morning', day: day0 + 1 }).first).toBeUndefined();
  });
});

describe('планёрка: с прошлой планёрки и сейчас', () => {
  test('отклонения, решения, отказы и отгрузки — ровно те, что за 24 часа до 08:00', () => {
    let seen = 0;
    for (let day = day0 + 1; day <= today; day++) {
      const v = morningView(db, s, { view: 'morning', day });
      const inW = (t: number) => t >= at(day) - DAY && t < at(day);
      expect(v.deviations.length).toBe(Object.values(s.deviations).filter(d => inW(d.opened)).length);
      expect(v.decisions.length).toBe(Object.values(s.lots).filter(l => l.supplier !== 'start' && (l.status === 'released' || l.status === 'rejected') && l.since !== undefined && inW(l.since)).length);
      expect(v.maint.length).toBe(s.maintLog.filter(e => inW(e.t)).length);
      expect(v.shipments.map(x => x.t)).toEqual(Object.values(s.shipments).filter(h => inW(h.t)).map(h => h.t));
      seen += v.deviations.length + v.decisions.length + v.maint.length + v.shipments.length;
    }
    // за шесть недель было что показать
    expect(seen).toBeGreaterThan(5);
  });

  test('сейчас: нехватка — как у заданий; сломанное — узлы в отказе; лаборатория — испытания по состояниям', () => {
    const v = morningView(db, s, { view: 'morning', day: today });
    const want = Object.values(s.batches).reduce((n, b) => n + (b.status === 'waiting' ? (b.short ?? []).reduce((k, x) => k + x.qty, 0) : 0) + (b.pack?.state === 'waiting' ? (b.pack.short ?? []).reduce((k, x) => k + x.qty, 0) : 0), 0);
    expect(v.short.reduce((n, x) => n + x.qty, 0)).toBe(want);
    expect(v.broken.length).toBe(Object.values(s.parts).filter(p => p.state === 'failed').length);
    const tests = Object.values(s.tests);
    expect([v.lab.queued, v.lab.prep, v.lab.run, v.lab.review]).toEqual(['queued', 'prep', 'run', 'review'].map(st => tests.filter(x => x.state === st).length));
    expect(v.cash.balance).toBe(s.cash.balance);
  });

  test('заказы под угрозой — без записи в состояние; ящиков не хватает не больше, чем заказано', () => {
    const before = fingerprint(s);
    for (let day = day0 + 1; day <= today; day++) {
      const v = morningView(db, s, { view: 'morning', day });
      for (const r of v.risk) {
        const o = s.orders[r.order];
        expect(o.status).toBe('open');
        expect(r.missing).toBeGreaterThan(0);
        expect(r.missing).toBeLessThanOrEqual(o.lines.reduce((n, l) => n + l.cases - l.reserved, 0));
      }
    }
    expect(fingerprint(s)).toBe(before);
  });
});

describe('касса', () => {
  test('счета по сроку: остаток после каждого — нынешний плюс сумма до него; низшая точка; проводки за сутки', () => {
    const v = cashView(db, s, { view: 'cash', page: 0 });
    expect(v.balance).toBe(s.cash.balance);
    expect(v.limit).toBe(db.scenarios[SC].credit.limit);
    expect(v.total).toBe(s.cash.dues.length);
    let after = s.cash.balance;
    let low = s.cash.balance;
    const all = [];
    for (let p = 0; p < v.pages; p++) all.push(...cashView(db, s, { view: 'cash', page: p }).dues);
    expect(all.length).toBe(v.total);
    expect(v.dues.length).toBe(Math.min(CASH_PAGE, v.total));
    for (const [i, d] of all.entries()) {
      if (i > 0) expect(d.t).toBeGreaterThanOrEqual(all[i - 1].t);
      after += d.sum;
      expect(d.after).toBe(after);
      low = Math.min(low, after);
    }
    if (low < s.cash.balance) expect(v.low?.balance).toBe(low);
    else expect(v.low).toBeUndefined();
    const day = s.cash.ledger.filter(e => e.t > s.t - DAY && e.t <= s.t);
    expect(v.entries.map(e => e.sum)).toEqual(day.map(e => e.sum));
    expect(v.day).toBe(day.reduce((n, e) => n + e.sum, 0));
    expect(topView(db, s)).toEqual({ view: 'top', balance: s.cash.balance, day: v.day, offered: db.scenarios[SC].seats, inv: Object.values(s.investigations).filter(i => i.status === 'open').length });
    // «почему» есть у счетов поставщикам, покупателям, зарплаты, взносов, энергии, НДС
    for (const d of all) if (['supplier', 'sale', 'wages', 'contrib', 'energy', 'vat'].includes(d.item)) expect(d.why).toBeDefined();
  });

  test('за пределом кредитной линии — с мгновения, когда касса туда ушла', () => {
    const b: PlantState = structuredClone(s);
    const limit = db.scenarios[SC].credit.limit;
    const t = b.t - 1000;
    b.cash.ledger.push({ t, sum: -(b.cash.balance + limit + 100), item: 'supplier' });
    b.cash.balance = -limit - 100;
    expect(cashView(db, b, { view: 'cash', page: 0 }).below).toBe(t);
    expect(cashView(db, s, { view: 'cash', page: 0 }).below).toBeUndefined();
  });
});

describe('без истины', () => {
  test('два завода с разными истинными полями — одни и те же планёрка, касса и полоса', () => {
    const a: PlantState = structuredClone(s);
    const b: PlantState = structuredClone(s);
    for (const lot of Object.values(b.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
    for (const bt of Object.values(b.batches)) {
      for (const k of Object.keys(bt.truth) as (keyof typeof bt.truth)[]) bt.truth[k] = (bt.truth[k] ?? 0) + 777;
      bt.causes = [];
      if (bt.pack) bt.pack.lost = (bt.pack.lost ?? 0) + 99;
    }
    for (const p of Object.values(b.parts)) p.budget += 12345;
    for (let day = day0 + 1; day <= today; day++) expect(JSON.stringify(morningView(db, b, { view: 'morning', day }))).toBe(JSON.stringify(morningView(db, a, { view: 'morning', day })));
    expect(JSON.stringify(cashView(db, b, { view: 'cash', page: 0 }))).toBe(JSON.stringify(cashView(db, a, { view: 'cash', page: 0 })));
    expect(topView(db, b)).toEqual(topView(db, a));
  });
});
