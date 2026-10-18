// Часть 3в: сутки линии для OEE суток (docs/specs/2026-10-panels.md, 3в). Время машин по суткам сходится с временем по
// заданиям у каждой машины и каждого состояния; выпуск по номиналу — номинал × время загрузки и работы; годные — годные
// пачки × таблеток в пачке; отрезок не переходит полночь; OEE — доступность × производительность × качество.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { DAY, momentOf } from '../../src/engine/core/calendar';
import { P_ONE } from '../../src/engine/core/rng';
import { apply, newPlant } from '../../src/engine/engine';
import { oee } from '../../src/engine/lean';
import { geo, SIXTY } from '../../src/engine/line';
import type { MachineTimes, PackJob, PlantState } from '../../src/engine/types';

/** Шесть недель жизни: серии упакованы, линия переналаживалась на другую позицию. */
const s: PlantState = newPlant(db, { scenario: 'scn.proto' });
apply(db, s, { kind: 'advance', seconds: 42 * DAY });

const ALL: (keyof MachineTimes)[] = ['run', 'slow', 'micro', 'fail', 'wait', 'setup', 'off', 'out', 'slowOut'];
const LOAD: (keyof MachineTimes)[] = ['run', 'slow', 'micro', 'fail', 'wait', 'setup'];
const WORK: (keyof MachineTimes)[] = ['run', 'slow', 'micro', 'wait'];
const sum = (t: MachineTimes, keys: (keyof MachineTimes)[]) => keys.reduce((n, k) => n + t[k], 0);

const lineId = Object.keys(s.lines)[0];
const line = s.lines[lineId];
const jobs = Object.values(s.batches)
  .map(b => b.pack)
  .filter((j): j is PackJob => !!j && j.line === lineId && j.state === 'done');
const days = s.losses.filter(d => d.lines[lineId]);

describe('сутки линии', () => {
  test('время и проход машин по суткам — как по заданиям, у каждой машины и каждого состояния', () => {
    expect(jobs.length).toBeGreaterThan(1);
    line.machines.forEach((mc, i) => {
      for (const k of ALL) {
        const byDays = days.reduce((n, d) => n + d.lines[lineId].times[i][k], 0);
        // нынешнее задание — в времени машины, пока не кончилось
        const byJobs = jobs.reduce((n, j) => n + j.oee![i].times[k], 0) + mc.times[k];
        expect([mc.id, k, byDays]).toEqual([mc.id, k, byJobs]);
      }
    });
  });

  test('выпуск по номиналу — номинал × время загрузки и время работы, если за сутки позиция одна', () => {
    // позиция суток — по заданиям, которые шли в эти сутки, и нынешнему
    const dayOf = (t: number) => momentOf(s.start, t).day;
    const taken = Object.values(s.batches)
      .map(b => b.pack)
      .filter((j): j is PackJob => !!j && j.line === lineId && j.taken !== undefined);
    let checked = 0;
    for (const d of days) {
      const skus = new Set(taken.filter(j => dayOf(j.taken!) <= d.day && dayOf(j.end ?? s.t) >= d.day).map(j => j.sku));
      if (skus.size !== 1) continue;
      const g = geo(db, s, line, [...skus][0]);
      const ld = d.lines[lineId];
      line.machines.forEach((_, i) => {
        expect(ld.ideal[i]).toBe(g.nominal[i] * sum(ld.times[i], LOAD));
        expect(ld.run[i]).toBe(g.nominal[i] * sum(ld.times[i], WORK));
      });
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });

  test('годные за сутки — годные пачки заданий × таблеток в пачке', () => {
    const byDays = days.reduce((n, d) => n + d.lines[lineId].good, 0);
    const tabs = (sku: string) => db.skus[sku].blisters * db.skus[sku].perBlister * SIXTY;
    const done = jobs.reduce((n, j) => n + (j.cartons! - j.cartonRejects!) * tabs(j.sku), 0);
    const now = line.batch ? line.made * tabs(s.batches[line.batch].pack!.sku) : 0;
    expect(byDays).toBe(done + now);
  });

  test('отрезок не переходит полночь: время машины за сутки — ровно часть заданий, пришедшаяся на эти сутки', () => {
    // в прототипе серия упаковывается за смену; на медленной линии задание переходит полночь
    const slowDb: ContentDb = { ...db, machines: Object.fromEntries(Object.entries(db.machines).map(([k, m]) => [k, { ...m, nominal: Math.max(1, Math.floor(m.nominal / 6)) }])) };
    const slow = newPlant(slowDb, { scenario: 'scn.proto' });
    apply(slowDb, slow, { kind: 'advance', seconds: 21 * DAY });
    expect(across(s)).toBeGreaterThanOrEqual(0);
    expect(across(slow)).toBeGreaterThan(0);
  });
});

/** Сверить время машин по суткам с частью заданий, пришедшейся на эти сутки; сколько суток задание начало раньше полуночи. */
function across(st: PlantState): number {
  const day0 = momentOf(st.start, 0).day;
  const ln = st.lines[lineId];
  // задание копит время от взятия до конца; нынешнее — до того мгновения, до которого посчитана линия
  const spans = Object.values(st.batches)
    .map(b => b.pack)
    .filter((j): j is PackJob => !!j && j.line === lineId && j.taken !== undefined)
    .map(j => [j.taken!, j.end ?? ln.t] as const);
  let n = 0;
  for (const d of st.losses) {
    const ld = d.lines[lineId];
    const from = (d.day - day0) * DAY;
    const to = from + DAY;
    const want = spans.reduce((k, [a, b]) => k + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);
    if (spans.some(([a, b]) => a < from && b > from)) n++;
    for (const t of ld?.times ?? [undefined]) expect([d.day, t ? sum(t, ['run', 'slow', 'micro', 'fail', 'wait', 'setup', 'off']) : 0]).toEqual([d.day, want]);
  }
  return n;
}

describe('OEE', () => {
  test('доступность × производительность × качество — OEE; от нуля до единицы; без загрузки — нет', () => {
    let n = 0;
    for (const d of days) {
      const ld = d.lines[lineId];
      ld.times.forEach((t, i) => {
        const o = oee({ ideal: ld.ideal[i], run: ld.run[i], out: t.out }, ld.good);
        if (!o) return;
        for (const v of [o.a, o.p, o.q, o.oee]) expect(v).toBeGreaterThanOrEqual(0);
        expect(o.a).toBeLessThanOrEqual(P_ONE);
        // произведение множителей с округлением каждого вниз — не дальше трёх десятитысячных
        const product = Math.floor((((o.a * o.p) / P_ONE) * o.q) / P_ONE);
        expect(Math.abs(product - o.oee)).toBeLessThanOrEqual(3);
        n++;
      });
    }
    expect(n).toBeGreaterThan(0);
    expect(oee({ ideal: 0, run: 0, out: 0 }, 0)).toBeUndefined();
    expect(oee({ ideal: 100, run: 50, out: 40 }, 30)).toEqual({ a: 5000, p: 8000, q: 7500, oee: 3000 });
  });
});
