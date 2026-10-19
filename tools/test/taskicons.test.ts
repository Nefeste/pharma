// Б1б: значки работ (src/render/taskicons.ts) и значок над головой каждого занятого человека (src/app/movers.ts,
// `taskIcons`). У каждого вида задачи — значок (это проверяет и tsc: ICON_OF — по всем видам); значки различимы формой —
// пути разные; линия на кружке читается: контраст не меньше 4,5. Значок — у тех, у кого задача в срезе, у прочих — нет.
import { describe, expect, test } from 'bun:test';
import { taskIcons } from '../../src/app/movers';
import { contrast } from '../../src/render/color';
import { ICON_FILL, ICON_KINDS, ICON_LINE, ICON_OF, ICON_PATH } from '../../src/render/taskicons';
import type { PersonRow, TaskRow } from '../../src/sim/pack';

const hex = (s: string) => Number.parseInt(s.slice(1), 16);

describe('значки работ', () => {
  test('у каждого вида работы — значок из набора; пути разные; в каждом виде набора есть работа', () => {
    for (const icon of Object.values(ICON_OF)) expect(ICON_KINDS).toContain(icon);
    expect(new Set(Object.values(ICON_PATH)).size).toBe(ICON_KINDS.length);
    for (const k of ICON_KINDS) expect(Object.values(ICON_OF)).toContain(k);
  });

  test('линия на кружке читается: контраст не меньше 4,5', () => {
    expect(contrast(hex(ICON_FILL), hex(ICON_LINE))).toBeGreaterThanOrEqual(4.5);
  });

  test('значок — у человека с задачей, по её виду; без задачи — нет', () => {
    const task = (kind: TaskRow['kind']): TaskRow => ({ task: 0, kind, times: [0, 0, 0, 0, 0], from: { x: 0, z: 0 }, fromSlot: -1, toSlot: -1, vehicle: -1, unit: -1 });
    const person = (n: number, t: number): PersonRow => ({ person: n, role: 0, present: true, x: 0, z: 0, task: t });
    const icons = taskIcons([task('stage'), task('repair')], [person(1, 0), person(2, 1), person(3, -1)]);
    expect([...icons]).toEqual([
      [1, 'process'],
      [2, 'repair'],
    ]);
  });
});
