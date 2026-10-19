// Часть 5: прогон плана (docs/specs/2026-10-plan-run.md). Двойник не знает истины: заводы, у которых различаются только
// истинные поля, дают один и тот же прогон; измеренное он оставляет рядом с результатом, запас узлов разыгрывает заново.
// Прогон не меняет состояние; одно зерно без двойника и без команд — тот же отпечаток, что обычный ход времени; тот же
// вызов — тот же итог; разные зёрна — разные исходы; одинаковые варианты — одинаковый итог; сдвиг задания двигает его
// серию, а заказы покупателей остаются теми же. Поток прогона даёт тот же итог, что функция в основном потоке.
import { describe, expect, test } from 'bun:test';
import { Worker } from 'node:worker_threads';
import { db } from '../../src/content';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { range, runPlan, runSeed, type SeedOut, summarize } from '../../src/engine/plan/run';
import { blind } from '../../src/engine/plan/twin';
import { toSave } from '../../src/engine/save';
import type { PlantState } from '../../src/engine/types';
import type { FromPlan, ToPlan } from '../../src/sim/protocol';

const SC = 'scn.proto';
const at = (day: number, hour: number) => day * DAY + hour * HOUR;
const plantAt = (t: number): PlantState => {
  const s = newPlant(db, { scenario: SC });
  apply(db, s, { kind: 'advance', seconds: t - s.t });
  return s;
};

/** Всё, чего завод не знает, — другим: истинные свойства, причины, запас узлов, заминки, результат до проверки, позиции линии. */
function mangle(s: PlantState): PlantState {
  const b: PlantState = structuredClone(s);
  for (const lot of Object.values(b.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
  for (const bt of Object.values(b.batches)) {
    for (const k of Object.keys(bt.truth) as (keyof typeof bt.truth)[]) bt.truth[k] = (bt.truth[k] ?? 0) + 777;
    for (const k of Object.keys(bt.noise) as (keyof typeof bt.noise)[]) bt.noise[k] = (bt.noise[k] ?? 0) + 33;
    bt.causes = [{ cause: 'x', attr: 'dissolution', delta: -500, stage: 'blend' }];
    if (bt.pack) bt.pack.lost = (bt.pack.lost ?? 0) + 5;
  }
  for (const p of Object.values(b.parts)) if (p.state === 'ok') p.budget += 123_456_789_000;
  for (const l of Object.values(b.lines)) for (const mc of l.machines) mc.next += 6000;
  for (const q of Object.values(b.tests)) if (q.state === 'review' && q.result !== undefined) q.result += 55;
  return b;
}

/** Мгновения: идёт таблетирование первой серии (пресс с узлами под износом); линия упаковывает первую серию. */
const PRESS = at(1, 17);
const LINE = at(5, 14);

describe('двойник', () => {
  const press = plantAt(PRESS);
  const line = plantAt(LINE);

  test('мгновения проверки — те, что нужны: пресс прессует, линия упаковывает', () => {
    expect(Object.values(press.tasks).some(t => t.kind === 'stage' && t.state === 'busy' && press.batches[t.batch!].run?.from !== undefined)).toBe(true);
    expect(Object.values(line.batches).some(b => b.pack?.state === 'running')).toBe(true);
  });

  test('без истины: заводы, у которых различаются только истинные поля, дают один и тот же прогон', () => {
    for (const s of [press, line]) {
      const a = runPlan(db, s, [], { days: 14, seeds: 3 });
      const b = runPlan(db, mangle(s), [], { days: 14, seeds: 3 });
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  test('измеренное лабораторией — рядом с результатом; не измеренное — в пределах разброса; причин нет', () => {
    const c: PlantState = structuredClone(line);
    blind(db, c, 0);
    let checked = 0;
    for (const lot of Object.values(c.lots)) {
      for (const id of (lot.sample ? c.samples[lot.sample]?.tests : undefined) ?? []) {
        const q = c.tests[id];
        if (q.state !== 'done' || q.result === undefined) continue;
        const m = db.tests[q.method];
        expect(Math.abs((lot.truth[m.attr] ?? 0) - q.result)).toBeLessThanOrEqual(6 * m.sd + 1);
        checked++;
      }
      const mat = db.materials[lot.material];
      for (const [a, p] of Object.entries(mat.props)) {
        const v = lot.truth[a as keyof typeof lot.truth];
        if (v === undefined || !p || lot.batch) continue;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(Math.max(10000, p[0] + 6 * p[1] + 10000));
      }
    }
    expect(checked).toBeGreaterThan(0);
    for (const b of Object.values(c.batches)) expect(b.causes).toEqual([]);
  });

  test('запас узлов — заново; отказы идущей стадии — по новому запасу; инварианты целы', () => {
    const c: PlantState = structuredClone(press);
    blind(db, c, 1);
    const ok = Object.values(press.parts).filter(p => p.state === 'ok');
    expect(ok.some(p => c.parts[p.id].budget !== p.budget)).toBe(true);
    // у узлов идущей стадии версия выросла: события отказа по старому запасу устарели
    const armed = Object.values(press.parts).filter(p => !p.line && press.equipment[p.machine].batch);
    expect(armed.length).toBeGreaterThan(0);
    for (const p of armed) if (p.state === 'ok') expect(c.parts[p.id].v).toBe(p.v + 1);
    const end = runSeed(db, press, [], { days: 14, seeds: 1 }, 1);
    expect(check(db, end)).toEqual([]);
  });

  test('прогон не меняет состояние', () => {
    for (const s of [press, line]) {
      const before = toSave(s);
      runPlan(db, s, [{ kind: 'shift', batch: 'B3', notBefore: s.t + 2 * DAY, by: 'player' }], { days: 14, seeds: 2 });
      expect(toSave(s)).toBe(before);
    }
  });
});

describe('прогон', () => {
  const s = plantAt(at(2, 9));

  test('одно зерно без двойника и без команд — тот же отпечаток, что обычный ход времени', () => {
    const run = runSeed(db, s, [], { days: 14, seeds: 1, twin: false }, 0);
    const life: PlantState = structuredClone(s);
    apply(db, life, { kind: 'advance', seconds: 14 * DAY });
    expect(fingerprint(run)).toBe(fingerprint(life));
  });

  test('тот же вызов — тот же итог; разные зёрна — разные исходы', () => {
    const a = runPlan(db, s, [], { days: 14, seeds: 4 });
    expect(JSON.stringify(runPlan(db, s, [], { days: 14, seeds: 4 }))).toBe(JSON.stringify(a));
    const keys = new Set(a.map(o => JSON.stringify({ ...o, seed: 0 })));
    expect(keys.size).toBeGreaterThan(1);
  });

  test('одинаковые варианты — одинаковый итог на каждом зерне; сдвиг задания — его серия позже, заказы покупателей те же', () => {
    const a = runPlan(db, s, [], { days: 14, seeds: 3 });
    expect(JSON.stringify(runPlan(db, s, [], { days: 14, seeds: 3 }))).toBe(JSON.stringify(a));
    // вторую серию — на двое суток позже срока
    const later = s.batches.B2.notBefore + 2 * DAY;
    const shift = [{ kind: 'shift' as const, batch: 'B2', notBefore: later, by: 'player' }];
    const b = runPlan(db, s, shift, { days: 14, seeds: 3 });
    for (let k = 0; k < 3; k++) {
      const x = a[k].batches.find(r => r.batch === 'B2')!;
      const y = b[k].batches.find(r => r.batch === 'B2')!;
      expect(y.bulk!).toBeGreaterThan(x.bulk! + DAY);
      // заказы покупателей — те же: их ветви не зависят от производства
      const orders = (o: SeedOut) => o.orders.map(r => [r.order, r.customer, r.due]);
      expect(orders(b[k])).toEqual(orders(a[k]));
    }
    // заказы на копиях — те же и по составу
    const ca = runSeed(db, s, [], { days: 14, seeds: 1 }, 2);
    const cb = runSeed(db, s, shift, { days: 14, seeds: 1 }, 2);
    expect(Object.values(cb.orders).map(o => [o.id, o.customer, o.due, o.lines.map(l => [l.sku, l.cases])])).toEqual(Object.values(ca.orders).map(o => [o.id, o.customer, o.due, o.lines.map(l => [l.sku, l.cases])]));
  });

  test('итог: срыв заказа — как в учёте копии; медиана и разброс по зёрнам; узкое место — наибольшая доля', () => {
    const outs = runPlan(db, s, [], { days: 14, seeds: 5 });
    const sum = summarize(outs, 14);
    expect(sum.seeds).toBe(5);
    const c = runSeed(db, s, [], { days: 14, seeds: 1 }, 0);
    for (const o of outs[0].orders) expect(o.ok).toBe(c.orders[o.order].status === 'shipped');
    for (const o of sum.orders) expect(o.fails).toBe(outs.filter(x => !x.orders.find(r => r.order === o.order)!.ok).length);
    // заказы снимка — на каждом зерне; новые — свои у каждого зерна, сводятся числом
    for (const o of outs) expect(o.orders.filter(r => r.known).map(r => r.order)).toEqual(outs[0].orders.filter(r => r.known).map(r => r.order));
    expect(sum.later.placed).toEqual(range(outs.map(o => o.orders.filter(r => !r.known).length))!);
    expect(sum.cash).toEqual(range(outs.map(o => o.cash))!);
    expect(range([5, 1, 3, 2, 4])).toEqual([1, 3, 5]);
    expect(range([4, 1, 3, 2])).toEqual([1, 2, 4]);
    for (const b of sum.batches) {
      const bulk = outs.flatMap(o => o.batches.filter(r => r.batch === b.batch && r.bulk !== undefined).map(r => r.bulk!));
      expect(b.bulkIn).toBe(bulk.length);
      if (bulk.length > 0) expect(b.bulk).toEqual(range(bulk)!);
    }
    for (const r of sum.busy) {
      expect(r.share[0]).toBeGreaterThanOrEqual(0);
      expect(r.share[2]).toBeLessThanOrEqual(10000);
    }
  });
});

describe('поток прогона', () => {
  test('снимок строкой через границу потоков; итог каждого варианта — как у функции в основном потоке', async () => {
    const s = plantAt(at(2, 9));
    const variants = [[], [{ kind: 'shift' as const, batch: 'B2', notBefore: s.batches.B2.notBefore + DAY, by: 'player' }]];
    const w = new Worker(new URL('./plan-worker.ts', import.meta.url));
    try {
      const got: FromPlan[] = await new Promise(resolve => {
        const list: FromPlan[] = [];
        w.on('message', (m: FromPlan) => {
          list.push(m);
          if (m.kind === 'done' || m.kind === 'error') resolve(list);
        });
        const msg: ToPlan = { kind: 'run', id: 7, json: toSave(s), variants, days: 14, seeds: 3 };
        w.postMessage(msg);
      });
      expect(got.map(m => m.kind)).toEqual(['variant', 'variant', 'done']);
      variants.forEach((v, i) => {
        const m = got[i] as Extract<FromPlan, { kind: 'variant' }>;
        expect(m.id).toBe(7);
        expect(m.index).toBe(i);
        expect(JSON.stringify(m.sum)).toBe(JSON.stringify(summarize(runPlan(db, s, v, { days: 14, seeds: 3 }), 14)));
      });
    } finally {
      await w.terminate();
    }
  });
});
