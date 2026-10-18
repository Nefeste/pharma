// Часть 3б: выбор щелчком (docs/specs/2026-10-panels.md, 3б). Человек и техника — по точке на экране ближе 30 точек; иначе
// — первая вещь по лучу камеры: паллета на своём ярусе, машина или оборудование, фура; иначе — помещение под точкой пола;
// мимо всего — ничего.
import { describe, expect, test } from 'bun:test';
import { type Box, floorHit, machineBoxes, NEAR_PX, palletBoxes, pick, type Ray, rayBox, roomAt, same, truckBoxes } from '../../src/app/pick';
import { db } from '../../src/content';
import { planOf } from '../../src/engine/plant';
import { layoutOf, levelY } from '../../src/render/layout';
import type { PalletView } from '../../src/render/loads';

const plan = planOf(db, 'plant.proto');
const layout = layoutOf(plan);
const down = (x: number, z: number): Ray => ({ o: [x, 30, z], d: [0, -1, 0] });

/** Паллеты одной секции стеллажа на четырёх ярусах — как их кладёт сцена. */
function column(): (PalletView & { unit: number })[] {
  const slots = plan.slots.filter(sl => sl.group === 'A' && sl.id.startsWith('A-02-') && sl.id.endsWith('-2'));
  return slots.map((sl, i) => ({ x: sl.x / 100, z: sl.z / 100, y: levelY(sl.level), turn: 1, load: 'cases', fill: 10, tag: 'released', unit: 100 + i }));
}

describe('луч', () => {
  test('короб: сверху — входит на верхней грани; мимо и позади — нет', () => {
    const b: Box = { thing: { kind: 'unit', n: 1 }, min: [0, 0, 0], max: [1, 1, 1] };
    expect(rayBox(down(0.5, 0.5), b)).toBeCloseTo(29, 9);
    expect(rayBox(down(1.5, 0.5), b)).toBeUndefined();
    expect(rayBox({ o: [0.5, -5, 0.5], d: [0, -1, 0] }, b)).toBeUndefined();
    expect(floorHit({ o: [2, 10, 3], d: [0.6, -0.8, 0] })).toEqual({ x: 9.5, z: 3 });
    expect(floorHit({ o: [0, 1, 0], d: [0, 1, 0] })).toBeUndefined();
  });

  test('сверху вниз сквозь ярусы стеллажа — верхняя паллета; сбоку на уровне яруса — паллета этого яруса', () => {
    const col = column();
    expect(col.length).toBe(4);
    const boxes = palletBoxes(col);
    const top = col.reduce((a, b) => (b.y > a.y ? b : a));
    expect(pick([], down(top.x, top.z), boxes, layout)).toEqual({ kind: 'unit', n: top.unit });
    const second = col.find(p => p.y > 1 && p.y < 2)!;
    // луч из прохода к стеллажу на высоте второго яруса
    const side: Ray = { o: [second.x, second.y + 0.5, second.z - 5], d: [0, 0, 1] };
    expect(pick([], side, boxes, layout)).toEqual({ kind: 'unit', n: second.unit });
  });
});

describe('что под курсором', () => {
  test('человек ближе 30 точек — он, даже если под лучом паллета; дальше — паллета', () => {
    const col = column();
    const boxes = palletBoxes(col);
    const r = down(col[0].x, col[0].z);
    const person = { thing: { kind: 'person', n: 7 } as const, px: NEAR_PX - 1 };
    expect(pick([person], r, boxes, layout)).toEqual({ kind: 'person', n: 7 });
    expect(pick([{ ...person, px: NEAR_PX + 1 }], r, boxes, layout)?.kind).toBe('unit');
    // ближе — тот, кто ближе
    expect(pick([person, { thing: { kind: 'vehicle', n: 2 }, px: 5 }], r, boxes, layout)).toEqual({ kind: 'vehicle', n: 2 });
  });

  test('машины и оборудование — по следу и высоте; фура — по кузову; пол — помещение; мимо — ничего', () => {
    const boxes = machineBoxes(db, layout);
    expect(boxes.length).toBe(plan.plant.equipment.length + plan.plant.lines.reduce((n, l) => n + l.machines.length, 0));
    const press = plan.plant.equipment.findIndex(e => e.id === 'press-1');
    const at = plan.plant.equipment[press].at;
    expect(pick([], down(at[0] / 100, at[1] / 100), boxes, layout)).toEqual({ kind: 'equipment', i: press });
    const m = plan.plant.lines[0].machines[1];
    expect(pick([], down(m.at[0] / 100, m.at[1] / 100), boxes, layout)).toEqual({ kind: 'machine', line: 0, k: 1 });
    const trucks = truckBoxes([{ truck: 3, customer: false, dock: 0, docked: true, x: -0.3, z: 5.5, closed: true, moving: false }]);
    expect(pick([], down(-5, 5.5), trucks, layout)).toEqual({ kind: 'truck', n: 3, customer: false });
    const lab = plan.plant.rooms.findIndex(r => r.type === 'lab');
    expect(pick([], down(plan.lab.x / 100, plan.lab.z / 100), [], layout)).toEqual({ kind: 'room', i: lab });
    expect(roomAt(layout, plan.lab.x / 100, plan.lab.z / 100)).toBe(lab);
    expect(pick([], down(-20, -20), [], layout)).toBeUndefined();
  });

  test('одна и та же вещь', () => {
    expect(same({ kind: 'unit', n: 1 }, { kind: 'unit', n: 1 })).toBe(true);
    expect(same({ kind: 'unit', n: 1 }, { kind: 'unit', n: 2 })).toBe(false);
    expect(same(undefined, { kind: 'unit', n: 1 })).toBe(false);
  });
});
