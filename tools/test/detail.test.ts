// Часть 2г: крупность показа и стрелки (docs/specs/2026-10-view.md, 2г; числа — геймдизайн, §19.3). Уровень — по скорости и
// высоте камеры, с запасом у порогов; переход доходит до нового уровня за 0,4 с и не перескакивает. Перевозки, которые
// видит окно, — настоящие смены зон паллет в учёте движка: ни лишних, ни потерянных; частота затухает; загрузка мест — как
// в учёте; стрелка линии — по её скорости.
import { describe, expect, test } from 'bun:test';
import { FLOW, fillsOf, Flows, lineArrows, moveArrows, movesOf, moveWidth } from '../../src/app/flows';
import { SceneState } from '../../src/app/scene';
import { db } from '../../src/content';
import { MIN } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { planOf } from '../../src/engine/plant';
import type { PlantState } from '../../src/engine/types';
import { AT, camDetail, DETAIL, type Detail, ease, shownOf, speedDetail, type Weights } from '../../src/render/detail';
import { layoutOf } from '../../src/render/layout';
import { Packer, unpack } from '../../src/sim/pack';

const plan = planOf(db, 'plant.proto');
const layout = layoutOf(plan);

describe('уровень показа', () => {
  test('по скорости: пауза, ×1, ×2 и «живое время» — по одному; ×3 — поток; ×4 и «До утра» — стрелки', () => {
    expect([0, 1, 2, 3, 4, 5].map(k => speedDetail(k, false))).toEqual([1, 1, 1, 2, 3, 1]);
    expect(speedDetail(0, true)).toBe(3);
  });

  test('по высоте камеры: машина и цех — по одному, от 12 м — поток, от 20 м — стрелки; вниз — на 1 м ниже порога', () => {
    expect([3.5, 9, 11.9, 12, 19.9, 20, 28].map(h => camDetail(h, 1))).toEqual([1, 1, 1, 2, 2, 3, 3]);
    expect(camDetail(DETAIL.site - 0.5, 3)).toBe(3);
    expect(camDetail(DETAIL.site - 1.1, 3)).toBe(2);
    expect(camDetail(DETAIL.near - 0.5, 2)).toBe(2);
    expect(camDetail(DETAIL.near - 1.1, 2)).toBe(1);
    expect(camDetail(5, 3)).toBe(1);
    expect(camDetail(DETAIL.site, 1)).toBe(3);
  });

  test('переход: за 0,4 с — до нового уровня; веса — от 0 до 1, сумма — 1, вес нового уровня не убывает', () => {
    for (const [from, to] of [
      [1, 3],
      [3, 1],
      [2, 1],
      [1, 2],
    ] as [Detail, Detail][]) {
      let w: Weights = AT[from];
      let prev = 0;
      for (let i = 0; i < 4; i++) {
        w = ease(w, to, DETAIL.fade / 4);
        expect(w.every(x => x >= 0 && x <= 1)).toBe(true);
        expect(w[0] + w[1] + w[2]).toBeCloseTo(1, 9);
        expect(w[to - 1]).toBeGreaterThanOrEqual(prev);
        prev = w[to - 1];
      }
      expect(w).toEqual(AT[to]);
    }
    expect(ease(AT[1], 3, 0)).toEqual(AT[1]);
    expect(ease(AT[2], 1, 5)).toEqual(AT[1]);
    // смена цели посреди перехода: всё равно приходит, не перескакивая
    let w = ease(AT[1], 3, 0.2);
    w = ease(w, 2, 0.2);
    w = ease(w, 2, 0.4);
    expect(w).toEqual(AT[2]);
  });

  test('что видно: по одному — люди, техника и штуки; поток — полосы; стрелки — слой, люди и техника скрыты', () => {
    expect(shownOf(AT[1])).toEqual({ movers: 1, items: 1, bands: 0, buffers: 0, layer: 0 });
    expect(shownOf(AT[2])).toEqual({ movers: 1, items: 0, bands: 1, buffers: 1, layer: 0 });
    expect(shownOf(AT[3])).toEqual({ movers: 0, items: 0, bands: 0, buffers: 1, layer: 1 });
  });
});

/** Зона паллеты в учёте движка — так же, как её считает окно. */
function engineArea(s: PlantState, id: string): string | undefined {
  const u = s.units[id];
  if (!u) return undefined;
  const w = u.where;
  if (w.kind === 'slot') {
    const sl = plan.slot[w.id];
    return sl.kind === 'storage' ? 'racks' : `zone:${sl.group}`;
  }
  if (w.kind === 'room') return `room:${plan.plant.rooms.findIndex(r => r.id === w.id)}`;
  if (w.kind === 'truck') {
    const t = s.trucks[w.id];
    return t ? `dock:${plan.plant.docks.findIndex(d => d.id === t.dock)}` : undefined;
  }
  return undefined;
}

describe('перевозки и загрузка', () => {
  const s = newPlant(db, { scenario: 'scn.proto' });
  const view = new SceneState();
  const packer = new Packer(db);
  const flows = new Flows();
  /** срезы пяти суток — до утра первой упаковки: приёмка, карантин, пробы, стеллажи, комплектация, серия */
  const frames: { moves: string[]; expected: string[]; t: number }[] = [];
  for (let i = 0; i < 5 * 24 * 6; i++) {
    const before = Object.fromEntries(Object.keys(s.units).map(id => [id, engineArea(s, id)]));
    apply(db, s, { kind: 'advance', seconds: 10 * MIN });
    const sl = unpack(packer.pack(s, 0));
    const moves = movesOf(plan, view.units, view.trucks, sl);
    const expected: string[] = [];
    for (const [id, a] of Object.entries(before)) {
      const b = engineArea(s, id);
      if (a && b && a !== b) expected.push(`${a}>${b}`);
    }
    frames.push({ moves: moves.map(m => `${m.from}>${m.to}`).sort(), expected: expected.sort(), t: sl.t });
    flows.step(sl.t, moves);
    view.apply(sl);
  }

  test('перевозка окна — смена зоны паллеты в учёте: ни лишних, ни потерянных; внутри зоны и новые паллеты — не перевозки', () => {
    let total = 0;
    for (const f of frames) {
      expect(f.moves).toEqual(f.expected);
      total += f.moves.length;
      for (const m of f.moves) expect(m.split('>')[0]).not.toBe(m.split('>')[1]);
    }
    expect(total).toBeGreaterThan(5);
  });

  test('частота — перевозок за игровой час: каждая прибавляет 1/τ, за τ без перевозок — в e раз меньше; толщина — в пределах', () => {
    const f = new Flows();
    f.step(0, [{ from: 'zone:recv', to: 'zone:quar' }]);
    expect(f.rates.get('zone:recv>zone:quar')).toBeCloseTo(3600 / FLOW.tau, 9);
    f.step(FLOW.tau, []);
    expect(f.rates.get('zone:recv>zone:quar')).toBeCloseTo((3600 / FLOW.tau) * Math.exp(-1), 9);
    f.step(FLOW.tau * 20, []);
    expect(f.rates.has('zone:recv>zone:quar')).toBe(false);
    expect(moveWidth(0)).toBe(FLOW.base);
    expect(moveWidth(1)).toBeCloseTo(FLOW.base + FLOW.per, 9);
    expect(moveWidth(100)).toBe(FLOW.max);
    // стрелки — только между разными зонами и не тоньше основы
    for (const a of moveArrows(layout, flows)) {
      expect(a.width >= FLOW.base && a.width <= FLOW.max).toBe(true);
      expect(Math.hypot(a.bx - a.ax, a.bz - a.az)).toBeGreaterThan(0);
    }
  });

  test('загрузка мест — по паллетам среза, как в учёте: занятые места каждой зоны и ряда стеллажей', () => {
    const used = new Map<string, number>();
    for (const u of Object.values(s.units)) if (u.where.kind === 'slot') used.set(plan.slot[u.where.id].group, (used.get(plan.slot[u.where.id].group) ?? 0) + 1);
    const fills = fillsOf(plan, view.units.values());
    expect(fills.map(f => f.id).sort()).toEqual([...plan.plant.zones.map(z => z.id), ...plan.plant.racks.map(r => r.id)].sort());
    for (const f of fills) {
      expect(f.used).toBe(used.get(f.id) ?? 0);
      expect(f.used <= f.places).toBe(true);
    }
    expect(fills.filter(f => f.kind === 'rack').reduce((n, f) => n + f.places, 0)).toBe(plan.slots.filter(sl => sl.kind === 'storage').length);
  });

  test('стрелка линии: пока линия стоит — нет; на упаковке — от входа первой машины к выходу последней, толщиной по скорости', () => {
    expect(lineArrows(db, layout, view.lines)).toEqual([]);
    const st = structuredClone(s);
    const v2 = new SceneState();
    const p2 = new Packer(db);
    let arrow;
    for (let i = 0; i < 24 * 6 && !arrow; i++) {
      apply(db, st, { kind: 'advance', seconds: 10 * MIN });
      v2.apply(unpack(p2.pack(st, 0)));
      arrow = lineArrows(db, layout, v2.lines)[0];
    }
    expect(arrow).toBeDefined();
    const row = v2.lines[0];
    expect(arrow!.width).toBeCloseTo(FLOW.lineBase + FLOW.linePer * row.machines.at(-1)!.rate, 9);
    const ln = plan.plant.lines[0];
    const first = ln.machines[0];
    const last = ln.machines.at(-1)!;
    expect(arrow!.ax).toBeCloseTo(first.at[0] / 100 + db.machines[first.type].size[0] / 200, 9);
    expect(arrow!.bx).toBeCloseTo(last.at[0] / 100 - db.machines[last.type].size[0] / 200, 9);
  });
});
