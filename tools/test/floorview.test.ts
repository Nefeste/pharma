// Б1и: вид «Пол» (src/sim/floor.ts). Часы помещений — из учёта суток, с отрезком, который ещё идёт; машины линии, ключевая
// машина и OEE — те же, что у планёрки за те же сутки; доска «План — факт» — сменное задание по часам; без истины: два
// завода, у которых различаются только истинные поля, дают один вид. Б1к: часы ожидания серий у мест — из учёта суток с
// отрезками, которые ещё идут, по убыванию, слово — наибольшее ожидание; «держит линию» — ключевая машина планёрки, при
// ожидании соседа — сосед.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { roomsOf } from '../../src/engine/lean';
import { planOf } from '../../src/engine/plant';
import type { PlantState, RoomPhase } from '../../src/engine/types';
import { floorView, holdsOf, hourPlan, sumLineDays, WAIT_WHAT, type WaitWhat, winDays } from '../../src/sim/floor';
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

describe('узкие места (Б1к)', () => {
  const index = new Map(plan.plant.rooms.map((r, i) => [r.id, i]));
  const isWait = new Set<string>(WAIT_WHAT);
  /** Ожидание у мест за сутки окна своим кодом: учёт суток и, если окно с сегодня, отрезки, которые идут. */
  function own(days: number[], open: boolean): Map<number, Partial<Record<WaitWhat, number>>> {
    const out = new Map<number, Partial<Record<WaitWhat, number>>>();
    const put = (room: string, ph: string, sec: number) => {
      if (!isWait.has(ph) || sec <= 0) return;
      const x = out.get(index.get(room)!) ?? {};
      x[ph as WaitWhat] = (x[ph as WaitWhat] ?? 0) + sec;
      out.set(index.get(room)!, x);
    };
    for (const d of s.losses.filter(x => days.includes(x.day))) for (const [room, x] of Object.entries(d.waits)) for (const [ph, sec] of Object.entries(x)) put(room, ph, sec ?? 0);
    if (open) for (const b of Object.values(s.batches)) if (b.place && b.phase && b.placeAt !== undefined) put(b.place, b.phase, s.t - b.placeAt);
    return out;
  }

  test('часы у мест — из учёта суток окна; сегодня и 7 суток — с отрезками, которые идут; ход стадий и линии — не ожидание', () => {
    for (const win of ['today', 'yesterday', 'week'] as const) {
      const v = floorView(db, s, { view: 'floor', win });
      const want = own(winDays(s, win), win !== 'yesterday');
      const got = new Map(v.waits.filter(w => w.total > 0).map(w => [w.i, w.sec]));
      expect(got).toEqual(want);
      for (const w of v.waits) {
        expect(w.total).toBe(Object.values(w.sec).reduce((n, x) => n + (x ?? 0), 0));
        expect(Object.keys(w.sec).some(k => k === 'work' || k === 'packing')).toBe(false);
      }
    }
  });

  test('места — по убыванию часов; слово — чего ждали больше всего; за 7 суток лаборатория и линия — в тройке', () => {
    const v = floorView(db, s, { view: 'floor', win: 'week' });
    const withHours = v.waits.filter(w => w.total > 0);
    expect(withHours.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < withHours.length; i++) expect(withHours[i - 1].total).toBeGreaterThanOrEqual(withHours[i].total);
    for (const w of withHours) {
      const most = Math.max(...Object.values(w.sec).map(x => x ?? 0));
      expect(w.sec[w.what]).toBe(most);
    }
    const top = withHours.slice(0, 3).map(w => plan.plant.rooms[w.i].id);
    expect(top).toContain('lab');
    expect(top).toContain('packaging');
    expect(withHours.find(w => plan.plant.rooms[w.i].id === 'lab')!.what).toBe('lab');
  });

  test('серии, которые ждут сейчас, — у своего места, с номером и словом; работа — не ожидание', () => {
    const v = floorView(db, s, { view: 'floor', win: 'week' });
    const now = v.waits.flatMap(w => w.now.map(x => ({ room: plan.plant.rooms[w.i].id, ...x })));
    const want = Object.values(s.batches).filter(b => b.place && b.phase && isWait.has(b.phase));
    expect(now.length).toBe(want.length);
    expect(now.length).toBeGreaterThan(0);
    for (const x of now) {
      const b = s.batches[`B${x.bn}`];
      expect(b.place).toBe(x.room);
      expect(b.phase).toBe(x.what);
      expect(x.code).toMatch(/^[A-Z]{2}\d{3}/);
    }
  });

  test('«держит линию» — ключевая машина и главная потеря планёрки за то же окно; ждала соседа — сосед', () => {
    for (const win of ['today', 'yesterday', 'week'] as const) {
      const v = floorView(db, s, { view: 'floor', win });
      for (const l of v.lines) {
        if (l.sum.key === undefined) {
          expect(l.holds).toBeUndefined();
          continue;
        }
        expect(l.holds).toEqual(holdsOf(l.sum));
      }
    }
    expect(holdsOf({ line: 0 })).toBeUndefined();
    const oee = { a: 5000, p: 6000, q: 9900, oee: 2970 };
    expect(holdsOf({ line: 0, key: 1, oee, loss: { what: 'setup', sec: 3600 } })).toEqual({ k: 1, what: 'setup', sec: 3600 });
    expect(holdsOf({ line: 0, key: 1, oee, loss: { what: 'wait', sec: 3600 }, neighbour: { k: 0, what: 'fail', sec: 1800 } })).toEqual({ k: 0, what: 'fail', sec: 1800, key: 1 });
    // ожидание без остановок соседа — над самой ключевой
    expect(holdsOf({ line: 0, key: 1, oee, loss: { what: 'wait', sec: 3600 } })).toEqual({ k: 1, what: 'wait', sec: 3600 });
    expect(holdsOf({ line: 0, key: 1, oee })).toEqual({ k: 1 });
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
