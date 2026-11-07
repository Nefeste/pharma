// «Меньше движения» (правило 6 ADR 0023 устава; docs/13-art.md, «Графика (ADR 0023 устава)»; src/app/motion.ts): выбор
// игрока в хранилище окна; не выбирал — как просит система; хранилище и вопрос к системе могут не работать. Включена —
// камера поворачивает без доворота, крупность показа меняется сразу; выключена — как прежде.
import { describe, expect, test } from 'bun:test';
import { keepLess, keptLess, MOTION, systemLess } from '../../src/app/motion';
import type { Keep } from '../../src/app/preset';
import { AT, ease, stepDetail } from '../../src/render/detail';
import { IsoCamera } from '../../src/render/view';

const box = (): Keep & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const broken: Keep = {
  getItem: () => {
    throw new Error('нет доступа');
  },
  setItem: () => {
    throw new Error('нет доступа');
  },
};

describe('выбор в хранилище окна', () => {
  test('не выбирал — как система; выбрал — его выбор и против системы', () => {
    const k = box();
    expect(keptLess(k, false)).toBe(false);
    expect(keptLess(k, true)).toBe(true);
    keepLess(k, true);
    expect(k.data.get(MOTION.key)).toBe('1');
    expect(keptLess(k, false)).toBe(true);
    keepLess(k, false);
    expect(keptLess(k, true)).toBe(false);
  });

  test('чужое значение, сломанное хранилище или его нет — как система', () => {
    const k = box();
    k.data.set(MOTION.key, 'да');
    expect(keptLess(k, true)).toBe(true);
    expect(keptLess(broken, true)).toBe(true);
    expect(keptLess(undefined, false)).toBe(false);
    expect(() => keepLess(broken, true)).not.toThrow();
  });

  test('система: просит — да; спросить нельзя или вопрос бросает — нет', () => {
    expect(systemLess(() => ({ matches: true }))).toBe(true);
    expect(systemLess(() => ({ matches: false }))).toBe(false);
    expect(systemLess(undefined)).toBe(false);
    expect(
      systemLess(() => {
        throw new Error('нет');
      }),
    ).toBe(false);
  });
});

describe('что меняется на экране', () => {
  test('крупность показа: обычно — переход, при «меньше движения» — сразу новый уровень', () => {
    expect(stepDetail(AT[1], 3, 0.1, false)).toEqual(ease(AT[1], 3, 0.1));
    expect(stepDetail(AT[1], 3, 0.1, false)).not.toEqual(AT[3]);
    expect(stepDetail(AT[1], 3, 0.1, true)).toEqual(AT[3]);
  });

  test('поворот камеры: обычно — доворот за несколько кадров, при «меньше движения» — сразу', () => {
    const slow = new IsoCamera(40, 30);
    const from = slow.yaw;
    slow.rotate(1);
    slow.update(1 / 60);
    expect(slow.yaw).toBeGreaterThan(from);
    expect(slow.yaw).toBeLessThan(from + Math.PI / 2 - 0.01);
    const fast = new IsoCamera(40, 30);
    fast.less = true;
    fast.rotate(1);
    fast.update(1 / 60);
    expect(fast.yaw).toBeCloseTo(from + Math.PI / 2, 9);
  });
});
