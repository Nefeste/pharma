// Масштаб интерфейса (Б13, шаг 1; docs/specs/2026-10-vertical-slice.md, «Б13. Доступность и настройки»): ступени,
// первый запуск по высоте окна, выбор игрока из хранилища и что помещается на экран.
import { describe, expect, test } from 'bun:test';
import { firstScale, fitScale, fitScales, keepScale, keptScale, SCALE, SCALES } from '../../src/app/scale';

const memory = (v?: string) => {
  const m = new Map<string, string>(v === undefined ? [] : [[SCALE.key, v]]);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, x: string) => void m.set(k, x), m };
};

describe('масштаб интерфейса', () => {
  test('ступени — 75–200 % шагом 25', () => {
    expect([...SCALES]).toEqual([0.75, 1, 1.25, 1.5, 1.75, 2]);
  });

  test('первый запуск — по высоте окна: Full HD — 100 %, 1440 — 125 %, 4K — 150 %', () => {
    expect(firstScale(1080)).toBe(1);
    expect(firstScale(1440)).toBe(1.25);
    expect(firstScale(2160)).toBe(1.5);
    expect(keptScale(memory(), 1920, 1080)).toBe(1);
    expect(keptScale(memory(), 3840, 2160)).toBe(1.5);
  });

  test('помещается — панели не меньше 1280 × 720 точек: Full HD — до 150 %, 1440 и 4K — до 200 %', () => {
    expect(fitScales(1920, 1080)).toEqual([0.75, 1, 1.25, 1.5]);
    expect(fitScales(2560, 1440)).toEqual([0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(fitScales(3840, 2160)).toEqual([...SCALES]);
    expect(fitScales(1280, 720)).toEqual([0.75, 1]);
    // экран меньше наименьшего — хоть 75 %
    expect(fitScales(800, 600)).toEqual([0.75]);
    expect(fitScale(2, 1920, 1080)).toBe(1.5);
    expect(fitScale(1.25, 1920, 1080)).toBe(1.25);
  });

  test('выбор игрока — из хранилища; не ступень или испорчено — по высоте; не помещается — меньше', () => {
    expect(keptScale(memory('1.75'), 3840, 2160)).toBe(1.75);
    expect(keptScale(memory('2'), 1920, 1080)).toBe(1.5);
    expect(keptScale(memory('1.1'), 1920, 1080)).toBe(1);
    expect(keptScale(memory('abc'), 2560, 1440)).toBe(1.25);
    const broken = { getItem: () => { throw new Error('нет'); }, setItem: () => undefined };
    expect(keptScale(broken, 1920, 1080)).toBe(1);
    const st = memory();
    keepScale(st, 1.25);
    expect(st.m.get(SCALE.key)).toBe('1.25');
    expect(keptScale(st, 2560, 1440)).toBe(1.25);
  });
});
