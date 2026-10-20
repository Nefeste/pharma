// Б2б: второй продукт — лоратадин 10 мг — в тех же помещениях и на той же линии, что парацетамол. Смена продукта в
// помещении — генеральная уборка; на линии — переналадка на формат позиции; у балка лоратадина — однородность
// дозирования на ВЭЖХ, приемлемое значение AV против предела 15,0 (docs/specs/2026-10-vertical-slice.md, Б2б). Б2г:
// кончившиеся уборки и переналадки — в сутках потерь, сколько и их работа.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { cleanWork } from '../../src/engine/mes';
import type { Batch, PlantState, Task } from '../../src/engine/types';

const SC = 'scn.proto';
const LOR = 'prd.loratadine10';

/** Первая серия лоратадина сценария — и как прошли до её выпуска уборки помещений и работы на линии. */
function firstLoratadine() {
  const s: PlantState = newPlant(db, { scenario: SC });
  const seen = new Set<string>();
  const cleans: { room: string; work: number; major: boolean; t: number }[] = [];
  const line: { batch: string; kind: string }[] = [];
  // уборки и переналадки, какими их видели последний раз; пропала из задач — кончилась
  const last = new Map<string, { kind: string; work: number; major: boolean; day: number }>();
  const done: { kind: string; work: number; major: boolean; day: number }[] = [];
  const look = () => {
    for (const t of Object.values(s.tasks) as Task[]) {
      if (t.kind === 'clean' || t.kind === 'changeover') last.set(t.id, { kind: t.kind, work: t.work, major: t.kind === 'clean' && !!s.rooms[t.room!].major, day: momentOf(s.start, s.t).day });
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      if (t.kind === 'clean') cleans.push({ room: t.room!, work: t.work, major: !!s.rooms[t.room!].major, t: s.t });
      if (t.kind === 'changeover' || t.kind === 'clearance') line.push({ batch: t.batch!, kind: t.kind });
    }
    for (const [id, x] of last)
      if (!s.tasks[id]) {
        done.push({ ...x, day: momentOf(s.start, s.t).day });
        last.delete(id);
      }
    return true;
  };
  const lor = () => Object.values(s.batches).find(b => b.product === LOR) as Batch;
  const end = s.t + 30 * DAY;
  while (s.t < end && lor().status !== 'released') {
    apply(db, s, { kind: 'advance', seconds: 3600 }, look);
    const bad = check(db, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
  return { s, b: lor(), cleans, line, done };
}

describe('второй продукт', () => {
  const { s, b, cleans, line, done } = firstLoratadine();

  test('первая серия лоратадина выпущена за месяц, с инвариантами каждый час', () => {
    expect(b.status).toBe('released');
  });

  test('в помещение, где была серия парацетамола, лоратадин идёт после генеральной уборки', () => {
    // помещение каждой стадии: последняя уборка до её начала — генеральная, если до того в нём был другой продукт
    for (const rec of b.records) {
      const before = Object.values(s.batches)
        .filter(x => x.id !== b.id && x.product !== b.product)
        .flatMap(x => x.records.filter(r => r.room === rec.room && r.end <= rec.start));
      if (before.length === 0) continue;
      const last = cleans.filter(c => c.room === rec.room && c.t <= rec.start).at(-1)!;
      expect([rec.stage, last.major, last.work]).toEqual([rec.stage, true, cleanWork(db, s, rec.room, true)]);
    }
  });

  test('на линии — переналадка на формат позиции лоратадина и очистка линии', () => {
    // до неё линия упаковывала парацетамол — формат другой: сначала переналадка, потом очистка
    expect(line.filter(x => x.batch === b.id).map(x => x.kind)).toEqual(['changeover', 'clearance']);
  });

  test('кончившиеся уборки и переналадки — в сутках потерь: по суткам столько же и той же работы', () => {
    const days = [...new Set(done.map(x => x.day))];
    expect(done.some(x => x.major)).toBe(true);
    expect(done.some(x => x.kind === 'changeover')).toBe(true);
    for (const day of days) {
      const xs = done.filter(x => x.day === day);
      const sum = (f: (x: (typeof xs)[number]) => boolean) => ({ n: xs.filter(f).length, sec: xs.filter(f).reduce((n, x) => n + x.work, 0) });
      const major = sum(x => x.kind === 'clean' && x.major);
      const minor = sum(x => x.kind === 'clean' && !x.major);
      const changes = sum(x => x.kind === 'changeover');
      const d = s.losses.find(l => l.day === day)!;
      expect([day, d.cleans, d.changes]).toEqual([day, { major: major.n, majorSec: major.sec, minor: minor.n, minorSec: minor.sec }, { n: changes.n, sec: changes.sec }]);
    }
    // суток без кончившихся уборок и переналадок в записи — нули
    for (const d of s.losses.filter(l => !days.includes(l.day))) expect([d.cleans.major + d.cleans.minor, d.changes.n]).toEqual([0, 0]);
  });

  test('у балка лоратадина — однородность дозирования на ВЭЖХ с пределом AV 15,0; у парацетамола её нет', () => {
    const bulk = (x: Batch) => Object.values(s.tests).filter(q => Object.values(s.samples).some(sm => sm.lot === x.bulk && sm.tests.includes(q.id)));
    const cu = bulk(b).filter(q => q.method === 'test.uniformity');
    expect(cu).toHaveLength(1);
    expect(cu[0].max).toBe(1500);
    expect(cu[0].state).toBe('done');
    expect(cu[0].pass).toBe(true);
    const par = Object.values(s.batches).find(x => x.product !== LOR && x.status === 'released')!;
    expect(bulk(par).some(q => q.method === 'test.uniformity')).toBe(false);
  });
});
