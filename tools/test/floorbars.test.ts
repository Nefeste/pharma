// Б1и: данные на полу в окне (src/app/floor.ts). Места столбиков — на свободном полу своего помещения и у своей машины,
// доска — за последней машиной линии; высоты частей — доли окна от полной высоты, по порядку снизу вверх; число — у
// каждого столбика: у помещения — доля работы, у ключевой машины — OEE с множителями, у других — доля хода; строки доски
// «План — факт»; слои — по кругу клавишей L.
import { describe, expect, test } from 'bun:test';
import { barBoxes, barsOf, boardRows, colorOf, FLOOR, LAYERS, nextLayer, PART_COLOR, ROOM_AS, spotsOf } from '../../src/app/floor';
import { db } from '../../src/content';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { roomsOf } from '../../src/engine/lean';
import { CELL } from '../../src/engine/nav';
import { planOf } from '../../src/engine/plant';
import type { PlantState } from '../../src/engine/types';
import { layoutOf } from '../../src/render/layout';
import { floorView, MACHINE_PARTS, ROOM_PARTS } from '../../src/sim/floor';

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

  test('слои по кругу: обычный вид → загрузка и OEE → потоки — люди → обычный вид', () => {
    expect(LAYERS).toEqual(['plain', 'load', 'people']);
    expect([nextLayer('plain'), nextLayer('load'), nextLayer('people')]).toEqual(['load', 'people', 'plain']);
  });
});
