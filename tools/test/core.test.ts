// из bolnitsa: tools/test/core.test.ts @ e0a3491 — изменено: очередь событий — своя (src/engine/core/agenda.ts); log2.
// Ядро движка: генератор случайности, ветви, хеши, очередь событий (ADR студии 0004).
import { describe, expect, test } from 'bun:test';
import { agenda, nextTime, popDue, schedule } from '../../src/engine/core/agenda';
import { fingerprint, fnv1a, stableJson } from '../../src/engine/core/hash';
import { log2 } from '../../src/engine/core/math';
import { Rng } from '../../src/engine/core/rng';

describe('генератор', () => {
  test('одно зерно — одна последовательность', () => {
    const a = Rng.seeded(42), b = Rng.seeded(42);
    const xs = Array.from({ length: 5 }, () => a.u32());
    expect(Array.from({ length: 5 }, () => b.u32())).toEqual(xs);
  });

  test('последовательность закреплена: смена алгоритма ломает сохранения и золотые прогоны', () => {
    const r = Rng.seeded(20260926);
    expect(Array.from({ length: 4 }, () => r.u32())).toEqual(GOLDEN_U32);
  });

  test('ветвь не сдвигает родителя и не зависит от других ветвей', () => {
    const a = Rng.seeded(7), b = Rng.seeded(7);
    a.fork('x').u32();
    a.fork('y').u32();
    expect(a.u32()).toBe(b.u32());
    expect(Rng.seeded(7).fork('stock').u32()).toBe(Rng.seeded(7).fork('stock').u32());
    expect(Rng.seeded(7).fork('stock').u32()).not.toBe(Rng.seeded(7).fork('maint').u32());
  });

  test('int в пределах и примерно равномерен', () => {
    const r = Rng.seeded(1);
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < 50_000; i++) counts[r.int(5)]++;
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(400);
  });

  test('chance(p) сбывается с частотой p/10 000', () => {
    const r = Rng.seeded(2);
    let hits = 0;
    for (let i = 0; i < 100_000; i++) if (r.chance(2500)) hits++;
    expect(Math.abs(hits - 25_000)).toBeLessThan(500);
  });

  test('состояние сохраняется и восстанавливается', () => {
    const a = Rng.seeded(99);
    a.u32();
    const b = Rng.fromState(a.state());
    expect(b.u32()).toBe(a.u32());
  });
});

describe('хеши', () => {
  test('FNV-1a: известное значение', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
  });

  test('отпечаток не зависит от порядка ключей', () => {
    expect(stableJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(fingerprint({ x: 1, y: 2 })).toBe(fingerprint({ y: 2, x: 1 }));
  });
});

describe('свой log2', () => {
  test('степени двойки — точно, остальное — до 1e-14', () => {
    for (let e = -40; e <= 40; e++) expect(log2(2 ** e)).toBe(e);
    for (const x of [3, 10, 0.3, 1234.5678, 1e-9, 7e12]) expect(Math.abs(log2(x) - Math.log2(x))).toBeLessThan(1e-14 * Math.max(1, Math.abs(Math.log2(x))));
  });
});

describe('очередь событий', () => {
  test('по времени, при равном — по порядку постановки', () => {
    const q = agenda<string>();
    schedule(q, 30, 'c');
    schedule(q, 10, 'a');
    schedule(q, 10, 'b');
    schedule(q, 20, 'x');
    const out: string[] = [];
    for (let e = popDue(q, 100); e; e = popDue(q, 100)) out.push(e.e);
    expect(out).toEqual(['a', 'b', 'x', 'c']);
  });

  test('не отдаёт будущее и переживает сохранение через JSON', () => {
    const q = agenda<number>();
    schedule(q, 50, 1);
    schedule(q, 5, 2);
    expect(popDue(q, 4)).toBeUndefined();
    expect(nextTime(q)).toBe(5);
    const saved = JSON.parse(JSON.stringify(q)) as typeof q;
    expect(popDue(saved, 10)?.e).toBe(2);
    schedule(saved, 50, 3);
    expect([popDue(saved, 60)?.e, popDue(saved, 60)?.e]).toEqual([1, 3]);
  });

  test('тысячи событий: порядок как у сортировки по (время, номер)', () => {
    const r = Rng.seeded(5);
    const q = agenda<number>();
    const all: { t: number; i: number }[] = [];
    for (let i = 0; i < 5000; i++) {
      const t = r.int(1000);
      schedule(q, t, i);
      all.push({ t, i });
    }
    all.sort((a, b) => a.t - b.t || a.i - b.i);
    const out: number[] = [];
    for (let e = popDue(q, 1e9); e; e = popDue(q, 1e9)) out.push(e.e);
    expect(out).toEqual(all.map(x => x.i));
  });
});

/** Первые четыре числа sfc32 для зерна 20260926 — записаны при создании генератора («Анамнез»). */
const GOLDEN_U32 = [367110760, 1079980886, 1445132124, 3281330693];
