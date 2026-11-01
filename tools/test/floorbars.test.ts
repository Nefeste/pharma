// Б1и: данные на полу в окне (src/app/floor.ts). Места столбиков — на свободном полу своего помещения и у своей машины,
// доска — за последней машиной линии; высоты частей — доли окна от полной высоты, по порядку снизу вверх; число — у
// каждого столбика: у помещения — доля работы, у ключевой машины — OEE с множителями, у других — доля хода; строки доски
// «План — факт»; слои — по кругу клавишей L. Б1к: таблички «Узких мест» — над тремя местами с часами ожидания по
// убыванию, у середины помещения, и над машиной, которая держит линию; значки андона — над вещью, на 2,8 м или над её
// верхом; короба для щелчка — вокруг них.
import { describe, expect, test } from 'bun:test';
import { andonBoxes, andonMarks, barBoxes, barsOf, boardRows, colorOf, DATA_LAYERS, FLOOR, LAYERS, midSpot, nextLayer, PART_COLOR, plateBoxes, platesOf, ROOM_AS, spotsOf } from '../../src/app/floor';
import { db } from '../../src/content';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { roomsOf } from '../../src/engine/lean';
import { CELL } from '../../src/engine/nav';
import { planOf } from '../../src/engine/plant';
import type { PlantState } from '../../src/engine/types';
import { layoutOf } from '../../src/render/layout';
import type { AndonItem } from '../../src/sim/andon';
import { type FloorView, floorView, MACHINE_PARTS, ROOM_PARTS } from '../../src/sim/floor';

const SC = 'scn.proto';
const plan = planOf(db, db.scenarios[SC].plant);
const l = layoutOf(plan);
const spots = spotsOf(db, l, roomsOf(plan).rooms);

/** Завод после 20 суток и ещё 11 часов: линия работает, в помещениях — разные состояния за сутки. */
const s: PlantState = newPlant(db, { scenario: SC });
apply(db, s, { kind: 'advance', seconds: 20 * DAY + 11 * HOUR });

describe('места', () => {
  test('столбик помещения — на клетке пола своего помещения, вокруг — пол без стен, дверей и оборудования', () => {
    const rooms = spots.bars.filter(b => b.thing.kind === 'room');
    expect(rooms.map(b => (b.thing.kind === 'room' ? l.rooms[b.thing.i].id : ''))).toEqual(roomsOf(plan).rooms);
    for (const b of rooms) {
      if (b.thing.kind !== 'room') continue;
      const i = b.thing.i;
      const cx = Math.floor(b.x);
      const cz = Math.floor(b.z);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const k = (cz + dz) * l.nav.w + cx + dx;
          expect([l.nav.cells[k], l.nav.room[k], l.nav.blocked[k]]).toEqual([CELL.floor, i, 0]);
        }
      }
      expect(b.side).toBe(FLOOR.room);
    }
  });

  test('столбик машины — у каждой машины линии, в помещении линии; доска — за последней машиной, до стены', () => {
    const lines = plan.plant.lines;
    const machines = spots.bars.filter(b => b.thing.kind === 'machine');
    expect(machines.length).toBe(lines.reduce((n, x) => n + x.machines.length, 0));
    for (const b of machines) {
      if (b.thing.kind !== 'machine') continue;
      const ln = lines[b.thing.line];
      const room = l.rooms.find(r => r.id === ln.room)!;
      expect(b.x).toBeGreaterThan(room.x);
      expect(b.x).toBeLessThan(room.x + room.w);
      expect(b.z).toBeGreaterThan(room.z);
      expect(b.z).toBeLessThan(room.z + room.d);
      expect(Math.abs(b.x - ln.machines[b.thing.k].at[0] / 100)).toBeLessThan(0.01);
      expect(b.side).toBe(FLOOR.machine);
    }
    expect(spots.boards.length).toBe(lines.length);
    const [ln] = lines;
    const room = l.rooms.find(r => r.id === ln.room)!;
    const last = ln.machines.at(-1)!;
    const b = spots.boards[0];
    // ящики идут на запад: доска — между западным краем последней машины и стеной
    expect(b.x).toBeGreaterThan(room.x);
    expect(b.x).toBeLessThan((last.at[0] - db.machines[last.type].size[0] / 2) / 100);
    expect(b.z).toBe(last.at[1] / 100);
  });

  test('короба столбиков — полная высота окна', () => {
    for (const b of barBoxes(spots)) expect([b.min[1], b.max[1]]).toEqual([0, FLOOR.full]);
  });
});

describe('столбики', () => {
  for (const win of ['today', 'yesterday', 'week'] as const) {
    test(`${win}: высота части — доля окна от полной высоты, по порядку снизу вверх; число — у каждого`, () => {
      const v = floorView(db, s, { view: 'floor', win });
      const bars = barsOf(spots, v);
      expect(bars.length).toBe(spots.bars.length);
      for (const b of bars) {
        let y = 0;
        for (const p of b.parts) {
          expect(p.y0).toBeCloseTo(y, 9);
          y += p.h;
        }
        if (b.thing.kind === 'room') {
          const t = b.thing;
          const r = v.rooms.find(x => x.i === t.i)!;
          expect(b.parts.map(p => p.part as string)).toEqual(ROOM_PARTS.filter(p => r.times[p] > 0));
          for (const p of b.parts) expect(p.h).toBeCloseTo((FLOOR.full * r.times[p.part as 'work']) / v.span, 9);
          expect(b.label).toEqual({ k: 'room', share: Math.round((r.times.work * 10000) / v.span) });
        } else if (b.thing.kind === 'machine') {
          const t = b.thing;
          const ln = v.lines.find(x => x.n === t.line)!;
          const m = ln.machines[t.k];
          expect(b.parts.map(p => p.part)).toEqual(MACHINE_PARTS.filter(p => m[p] > 0));
          for (const p of b.parts) expect(p.h).toBeCloseTo((FLOOR.full * m[p.part as 'run']) / v.span, 9);
          if (ln.sum.key === t.k) expect(b.label).toEqual({ k: 'key', ...ln.sum.oee! });
          else expect(b.label).toEqual({ k: 'run', share: Math.round(((m.run + m.slow) * 10000) / v.span) });
        }
        // весь столбик — не выше полной высоты
        expect(y).toBeLessThanOrEqual(FLOOR.full + 1e-9);
      }
      expect(bars.filter(b => b.label.k === 'key').length).toBe(v.lines.filter(x => x.sum.oee).length);
    });
  }

  test('цвет части: у помещения — по смыслу, как у машины; у каждого состояния машины — свой', () => {
    expect(colorOf('work')).toBe(PART_COLOR.run);
    expect(colorOf('clean')).toBe(PART_COLOR.setup);
    expect(colorOf('held')).toBe(PART_COLOR.wait);
    for (const [k, v] of Object.entries(ROOM_AS)) expect(colorOf(k as 'work')).toBe(PART_COLOR[v]);
    expect(new Set(MACHINE_PARTS.map(colorOf)).size).toBe(MACHINE_PARTS.length);
  });
});

describe('доска и слои', () => {
  test('строки доски: план и годные по часам; ниже плана — только у прошедшего часа; нынешний — отмечен', () => {
    const b = { shift: 'shift.a', from: 7 * HOUR, ends: 11 * HOUR, plan: 1000, hours: [{ plan: 250, fact: 300 }, { plan: 250, fact: 200 }, { plan: 250, fact: 40 }, { plan: 250 }], now: 2, fact: 540 };
    expect(boardRows(b)).toEqual([
      { from: 7 * HOUR, plan: 250, fact: 300, now: false, low: false },
      { from: 8 * HOUR, plan: 250, fact: 200, now: false, low: true },
      { from: 9 * HOUR, plan: 250, fact: 40, now: true, low: false },
      { from: 10 * HOUR, plan: 250, now: false, low: false },
    ]);
  });

  test('слои по кругу: обычный вид → загрузка и OEE → узкие места → проблемы → потоки — люди → обычный вид', () => {
    expect(LAYERS).toEqual(['plain', 'load', 'bottle', 'andon', 'people']);
    expect(LAYERS.map(nextLayer)).toEqual(['load', 'bottle', 'andon', 'people', 'plain']);
  });
});

describe('узкие места и проблемы (Б1к)', () => {
  test('слои данных — «Загрузка», «Узкие места», «Проблемы»; обычный вид и потоки — нет', () => {
    expect(LAYERS.filter(x => DATA_LAYERS.has(x))).toEqual(['load', 'bottle', 'andon']);
  });

  test('точка над помещением — свободная клетка его пола у середины, а нет такой — середина; есть у каждого помещения', () => {
    let free = 0;
    for (const [i, r] of l.rooms.entries()) {
      const at = midSpot(l, i)!;
      expect(at.x).toBeGreaterThanOrEqual(r.x);
      expect(at.x).toBeLessThanOrEqual(r.x + r.w);
      expect(at.z).toBeGreaterThanOrEqual(r.z);
      expect(at.z).toBeLessThanOrEqual(r.z + r.d);
      const k = Math.floor(at.z) * l.nav.w + Math.floor(at.x);
      if ([l.nav.cells[k], l.nav.room[k], l.nav.blocked[k]].join() === [CELL.floor, i, 0].join()) free++;
      else expect(at).toEqual({ x: r.x + r.w / 2, z: r.z + r.d / 2 });
    }
    // у помещений учёта, лаборатории, ООК и склада — свободная клетка
    for (const id of [...roomsOf(plan).rooms, 'lab', 'office', 'warehouse']) {
      const i = l.rooms.findIndex(r => r.id === id);
      const at = midSpot(l, i)!;
      const k = Math.floor(at.z) * l.nav.w + Math.floor(at.x);
      expect([id, l.nav.cells[k], l.nav.room[k], l.nav.blocked[k]]).toEqual([id, CELL.floor, i, 0]);
    }
    expect(free).toBeGreaterThan(l.rooms.length / 2);
  });

  test('таблички: три места с часами — по убыванию, с местом по порядку и словом; над машиной — «держит линию»', () => {
    const v = floorView(db, s, { view: 'floor', win: 'week' });
    const p = platesOf(l, v);
    const tops = p.filter(x => x.k === 'top');
    const want = v.waits.filter(w => w.total > 0).slice(0, 3);
    expect(tops.map(x => (x.k === 'top' ? [x.thing, x.rank, x.sec, x.what] : []))).toEqual(want.map((w, n) => [{ kind: 'room', i: w.i }, n + 1, w.total, w.what]));
    for (const x of tops) if (x.thing.kind === 'room') expect({ x: x.x, z: x.z }).toEqual(midSpot(l, x.thing.i)!);
    const holds = p.filter(x => x.k === 'holds');
    expect(holds.length).toBe(v.lines.filter(x => x.holds).length);
    for (const x of holds) {
      if (x.thing.kind !== 'machine') throw new Error('над машиной');
      const ln = v.lines.find(y => y.n === (x.thing.kind === 'machine' ? x.thing.line : -1))!;
      expect(x.thing.k).toBe(ln.holds!.k);
      const m = plan.plant.lines[x.thing.line].machines[x.thing.k];
      expect([x.x, x.z]).toEqual([m.at[0] / 100, m.at[1] / 100]);
    }
    // ожидания не было — табличек мест нет
    const empty: FloorView = { ...v, waits: [], lines: v.lines.map(({ holds: _, ...ln }) => ln) };
    expect(platesOf(l, empty)).toEqual([]);
  });

  test('короб таблички: ширина её фона, нижний край — 2,4 м; с высоты участка — вдвое больше', () => {
    const p = { thing: { kind: 'room' as const, i: 0 }, x: 10, z: 20, k: 'top' as const, rank: 1, sec: 3600, what: 'lab' as const, w: 6, h: 0.8 };
    expect(plateBoxes([p], 1)).toEqual([{ thing: p.thing, min: [7, FLOOR.plate.y, 17], max: [13, FLOOR.plate.y + 0.8, 23] }]);
    expect(plateBoxes([p], 2)[0].max[1]).toBeCloseTo(FLOOR.plate.y + 1.6, 9);
  });

  test('значок андона: центр — на 2,8 м над полом вещи; над вещью выше — над её верхом; вещи на полу нет — значка нет', () => {
    const item = (thing: AndonItem['thing']): AndonItem => ({ thing, kind: 'fail', weight: 'stop', why: [{ kind: 'fail' }] });
    const items = [item({ kind: 'room', i: 1 }), item({ kind: 'truck', n: 3, customer: false }), item({ kind: 'unit', n: 9 })];
    const top = (t: AndonItem['thing']): [number, number, number] | undefined => (t.kind === 'room' ? [5, 0, 6] : t.kind === 'truck' ? [20, 3.8, 2] : undefined);
    const m = andonMarks(items, top);
    expect(m).toEqual([
      { thing: items[0].thing, kind: 'fail', weight: 'stop', n: 0, x: 5, y: FLOOR.andon.y, z: 6 },
      { thing: items[1].thing, kind: 'fail', weight: 'stop', n: 1, x: 20, y: 3.8 + FLOOR.andon.over + FLOOR.andon.size / 2, z: 2 },
    ]);
    const [b] = andonBoxes(m, 1);
    expect(b.max[1] - FLOOR.andon.y).toBeCloseTo(FLOOR.andon.size / 2, 9);
    expect(FLOOR.andon.y - b.min[1]).toBeCloseTo(FLOOR.andon.size / 2 + 2 * FLOOR.andon.word, 9);
  });
});
