// Б1и: вид «Пол» (src/sim/floor.ts). Часы помещений — из учёта суток, с отрезком, который ещё идёт; машины линии, ключевая
// машина и OEE — те же, что у планёрки за те же сутки; доска «План — факт» — сменное задание по часам; без истины: два
// завода, у которых различаются только истинные поля, дают один вид.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { roomsOf } from '../../src/engine/lean';
import { planOf } from '../../src/engine/plant';
import type { PlantState, RoomPhase } from '../../src/engine/types';
import { floorView, hourPlan, sumLineDays, winDays } from '../../src/sim/floor';
import { lineSum, morningView } from '../../src/sim/report';

const SC = 'scn.proto';
const plan = planOf(db, db.scenarios[SC].plant);
const PHASES: RoomPhase[] = ['work', 'clean', 'held', 'dirty', 'free'];

/** Завод после 40 суток и ещё 10 часов: сегодня — неполные сутки, у линии идёт смена. */
const s: PlantState = newPlant(db, { scenario: SC });
apply(db, s, { kind: 'advance', seconds: 40 * DAY + 10 * HOUR });
const today = momentOf(s.start, s.t).day;

describe('помещения', () => {
  test('вчера — учёт суток как есть: у каждого помещения 86 400 с, окно — сутки', () => {
    const v = floorView(db, s, { view: 'floor', win: 'yesterday' });
    const d = s.losses.find(x => x.day === today - 1)!;
    expect(v.rooms.map(r => plan.plant.rooms[r.i].id)).toEqual(roomsOf(plan).rooms);
    for (const r of v.rooms) {
      expect(r.times).toEqual(d.rooms[plan.plant.rooms[r.i].id]);
      expect(PHASES.reduce((n, k) => n + r.times[k], 0)).toBe(DAY);
    }
    expect(v.span).toBe(DAY);
  });

  test('сегодня — с полуночи до сейчас, с отрезком, который ещё идёт', () => {
    const v = floorView(db, s, { view: 'floor', win: 'today' });
    const since = s.t - (today - momentOf(s.start, 0).day) * DAY;
    for (const r of v.rooms) expect(PHASES.reduce((n, k) => n + r.times[k], 0)).toBe(since);
    expect(v.span).toBe(since);
  });

  test('7 суток — сегодня и шесть до него, суммой', () => {
    expect(winDays(s, 'week')).toEqual([today - 6, today - 5, today - 4, today - 3, today - 2, today - 1, today]);
    const v = floorView(db, s, { view: 'floor', win: 'week' });
    const t = floorView(db, s, { view: 'floor', win: 'today' });
    for (const [n, r] of v.rooms.entries()) {
      const id = plan.plant.rooms[r.i].id;
      for (const k of PHASES) {
        const past = s.losses.filter(d => d.day >= today - 6 && d.day < today).reduce((m, d) => m + d.rooms[id][k], 0);
        expect(r.times[k]).toBe(past + t.rooms[n].times[k]);
      }
    }
    expect(v.span).toBe(6 * DAY + t.span);
  });

  test('«серия ждёт» ведёт к серии, которая держит помещение или держала его последней', () => {
    const v = floorView(db, s, { view: 'floor', win: 'week' });
    const held = v.rooms.filter(r => r.times.held > 0);
    expect(held.length).toBeGreaterThan(0);
    for (const r of held) {
      const room = s.rooms[plan.plant.rooms[r.i].id];
      expect(r.bn).toBeDefined();
      const b = s.batches[`B${r.bn}`];
      if (room.batch) expect(b.id).toBe(room.batch);
      else expect(b.records.some(x => x.room === room.id)).toBe(true);
      expect(r.code).toMatch(/^[A-Z]{2}\d{3}/);
    }
    for (const r of v.rooms.filter(x => x.times.held === 0)) expect(r.bn).toBeUndefined();
  });
});

describe('линия', () => {
  test('вчера — машины, ключевая машина и OEE как у планёрки', () => {
    const v = floorView(db, s, { view: 'floor', win: 'yesterday' });
    const m = morningView(db, s, { view: 'morning', day: today });
    const d = s.losses.find(x => x.day === today - 1)!;
    for (const l of v.lines) {
      expect(l.sum).toEqual(m.lines[l.n]);
      const ld = d.lines[plan.plant.lines[l.n].id];
      if (!ld) continue;
      for (const [k, x] of l.machines.entries()) for (const [p, sec] of Object.entries(x)) expect(sec).toBe(ld.times[k][p as keyof typeof x]);
    }
  });

  test('7 суток — сутки линии сложением; OEE — по сумме, той же функцией', () => {
    const v = floorView(db, s, { view: 'floor', win: 'week' });
    for (const l of v.lines) {
      const id = plan.plant.lines[l.n].id;
      const days = s.losses.filter(d => d.day >= today - 6).map(d => d.lines[id]);
      const sum = sumLineDays(days)!;
      expect(l.sum).toEqual(lineSum(l.n, sum));
      expect(sum.good).toBe(days.reduce((n, x) => n + (x?.good ?? 0), 0));
      expect(l.machines[0].run).toBe(days.reduce((n, x) => n + (x?.times[0].run ?? 0), 0));
    }
  });

  test('доска «План — факт»: план часа — задание поровну на часы смены; годные по часам; нынешний час — пока что', () => {
    const v = floorView(db, s, { view: 'floor', win: 'today' });
    const line = s.lines[plan.plant.lines[0].id];
    const t = [...s.shiftTasks].reverse().find(x => x.line === line.id)!;
    const b = v.lines[0].board!;
    expect(b.plan).toBe(t.plan);
    expect(b.hours.length).toBe((t.ends! - t.from) / HOUR);
    expect(b.hours.reduce((n, h) => n + h.plan, 0)).toBe(t.plan);
    for (const [i, h] of t.hours!.entries()) expect(b.hours[i].fact).toBe(h);
    expect(b.fact).toBe(t.fact ?? line.packs + line.made - t.start);
    if (b.now !== undefined) expect(b.hours.reduce((n, h) => n + (h.fact ?? 0), 0)).toBe(b.fact);
  });

  test('план часа: поровну, остаток — по пачке вразбивку; в сумме — задание', () => {
    expect(hourPlan(10, 4)).toEqual([2, 3, 2, 3]);
    expect(hourPlan(8000, 8)).toEqual(Array(8).fill(1000));
    expect(hourPlan(0, 8)).toEqual(Array(8).fill(0));
    for (const [p, n] of [[12345, 8], [7, 12], [999, 7]]) expect(hourPlan(p, n).reduce((a, x) => a + x, 0)).toBe(p);
  });
});

describe('без истины', () => {
  test('два завода с разными истинными свойствами партий и серий и запасом узлов — один и тот же вид', () => {
    const b: PlantState = structuredClone(s);
    for (const lot of Object.values(b.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
    for (const bt of Object.values(b.batches)) for (const k of Object.keys(bt.truth) as (keyof typeof bt.truth)[]) bt.truth[k] = (bt.truth[k] ?? 0) + 777;
    for (const p of Object.values(b.parts)) p.budget += 12345;
    for (const win of ['today', 'yesterday', 'week'] as const) expect(floorView(db, b, { view: 'floor', win })).toEqual(floorView(db, s, { view: 'floor', win }));
  });
});
