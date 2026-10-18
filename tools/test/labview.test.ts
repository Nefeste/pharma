// Часть 3г: виды лаборатории (docs/specs/2026-10-panels.md, 3г). Границы карты X–Rm — на примере NIST (6.3.2.2: десять
// значений расхода); признаки особых причин — вне границ, 7 подряд по одну сторону, 7 подряд растут или падают, размах
// выше границы; точки карты — все МОК средней массы по времени; очередь — партии в лаборатории, поднятые первыми; виды не
// читают истины.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import type { PlantState } from '../../src/engine/types';
import { chartView, labView, limitsOf, RUN, signalsOf } from '../../src/sim/lab';

const SC = 'scn.proto';
const MASS = 'test.ipc.mass';

describe('границы и признаки', () => {
  test('пример NIST: x̄ = 50,81, MR̄ = 1,8778, границы 55,8041 и 45,8159; у карты размахов — 3,267·MR̄', () => {
    const l = limitsOf([49.6, 47.6, 49.9, 51.3, 47.8, 51.2, 52.6, 52.4, 53.6, 52.1])!;
    expect(l.mean).toBeCloseTo(50.81, 9);
    expect(l.mr).toBeCloseTo(1.8778, 4);
    expect(l.ucl).toBeCloseTo(55.8041, 4);
    expect(l.lcl).toBeCloseTo(45.8159, 4);
    expect(l.mrUcl).toBeCloseTo(3.267 * l.mr, 9);
    expect(limitsOf([1])).toBeUndefined();
  });

  test('вне границ; 7 подряд по одну сторону; 7 подряд растут; размах выше границы', () => {
    const l = { mean: 100, mr: 1, ucl: 103, lcl: 97, mrUcl: 3.267 };
    // седьмая точка выше центра подряд — признак, шестая — ещё нет
    const above = [101, 101.5, 101, 101.5, 101, 101.5, 101, 99];
    const a = signalsOf(above, l);
    expect(a[RUN - 2]).not.toContain('run');
    expect(a[RUN - 1]).toContain('run');
    expect(a[RUN]).not.toContain('run');
    // семь подряд растут: шесть подъёмов
    const up = [97.5, 98, 98.5, 99, 99.5, 100.5, 101, 100];
    const u = signalsOf(up, l);
    expect(u[RUN - 2]).not.toContain('trend');
    expect(u[RUN - 1]).toContain('trend');
    expect(u[RUN]).not.toContain('trend');
    // вне границ и скачок размаха
    const s = signalsOf([100, 104, 100.5, 96], l);
    expect(s[1]).toEqual(['out', 'mr']);
    expect(s[3]).toEqual(['out', 'mr']);
    expect(s[2]).toEqual(['mr']);
  });
});

/** Шесть недель жизни: таблетирование серий с МОК, партии поставщиков в лаборатории. */
const s: PlantState = newPlant(db, { scenario: SC });
apply(db, s, { kind: 'advance', seconds: 42 * DAY });

describe('контрольная карта', () => {
  test('точки — все МОК средней массы стадий по времени; границы — по ним; допуск — из карты', () => {
    const want = Object.values(s.batches)
      .flatMap(b => b.records.flatMap(r => r.ipc.filter(c => c.test === MASS).map(c => ({ t: c.t, v: c.result }))))
      .sort((a, b) => a.t - b.t);
    const v = chartView(db, s, { view: 'chart', test: MASS });
    expect(want.length).toBeGreaterThan(10);
    expect(v.points.map(p => ({ t: p.t, v: p.v }))).toEqual(want);
    expect(v.limits).toEqual(limitsOf(want.map(p => p.v)));
    expect(v.preliminary).toBe(want.length < 25);
    const st = db.recipes[Object.values(s.batches)[0].recipe].stages.flatMap(x => x.ipc).find(c => c.test === MASS)!;
    expect(v.spec).toEqual({ min: st.min, max: st.max });
    // границы карты — не допуск: у устойчивого процесса они уже допуска
    expect(v.limits!.ucl).toBeLessThan(st.max!);
    expect(v.limits!.lcl).toBeGreaterThan(st.min!);
  });
});

describe('очередь', () => {
  test('строки — партии в лаборатории, кроме готовой продукции; испытания — как в учёте; поднятая — первой', () => {
    // мгновение, когда в лаборатории не меньше двух партий
    const st: PlantState = newPlant(db, { scenario: SC });
    let v = labView(db, st);
    for (let h = 0; h < 40 * 24 && v.rows.length < 2; h++) {
      apply(db, st, { kind: 'advance', seconds: HOUR });
      v = labView(db, st);
    }
    expect(v.rows.length).toBeGreaterThanOrEqual(2);
    const inLab = Object.values(st.lots).filter(l => (l.status === 'quarantine' || l.status === 'sampled' || l.status === 'testing') && db.materials[l.material].kind !== 'fg');
    expect(new Set(v.rows.map(r => r.lot))).toEqual(new Set(inLab.map(l => l.id)));
    for (const r of v.rows) {
      const lot = st.lots[r.lot];
      const tests = lot.sample ? st.samples[lot.sample].tests.map(id => st.tests[id]) : [];
      expect(r.tests.map(q => [q.method, q.state])).toEqual(tests.map(q => [q.method, q.state]));
      for (const q of r.tests) if (q.result !== undefined) expect(q.state).toBe('done');
    }
    const lastLot = v.rows[v.rows.length - 1].lot;
    apply(db, st, { kind: 'rush', lot: lastLot, by: 'player' });
    const after = labView(db, st);
    expect(after.rows[0].lot).toBe(lastLot);
    expect(after.rows[0].rush).toBe(true);
    expect(after.instruments.length).toBe(Object.keys(st.instruments).length);
  });
});

describe('без истины', () => {
  test('два завода с разными истинными полями — одни и те же очередь и карта', () => {
    const a: PlantState = structuredClone(s);
    const b: PlantState = structuredClone(s);
    for (const lot of Object.values(b.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
    for (const bt of Object.values(b.batches)) {
      for (const k of Object.keys(bt.truth) as (keyof typeof bt.truth)[]) bt.truth[k] = (bt.truth[k] ?? 0) + 777;
      bt.causes = [];
    }
    for (const p of Object.values(b.parts)) p.budget += 12345;
    // результат испытания до проверки — истина лаборатории до второго лица: окно его не видит
    for (const q of Object.values(b.tests)) if (q.state !== 'done' && q.result !== undefined) q.result += 55;
    expect(JSON.stringify(labView(db, b))).toBe(JSON.stringify(labView(db, a)));
    expect(JSON.stringify(chartView(db, b, { view: 'chart', test: MASS }))).toBe(JSON.stringify(chartView(db, a, { view: 'chart', test: MASS })));
  });
});
