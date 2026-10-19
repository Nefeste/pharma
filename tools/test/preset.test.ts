// Б1б: стартовый пресет (src/app/preset.ts). Кадр на среднем пресете дольше 33 мс — низкий, иначе средний; кадров мало —
// замера нет. Пресет в хранилище окна: запомненный читается, чужое значение и сломанное хранилище — как будто нет.
import { describe, expect, test } from 'bun:test';
import { type Keep, keep, kept, medianFrame, PRESET, pickPreset } from '../../src/app/preset';

const frames = (ms: number, n = 90) => Array.from({ length: n }, () => ms);

describe('замер кадра', () => {
  test('медиана: нечётное и чётное число кадров; меньше десяти — замера нет', () => {
    expect(medianFrame([5, 1, 3, 2, 4, 9, 7, 8, 6, 10, 11])).toBe(6);
    expect(medianFrame([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(5.5);
    expect(medianFrame(frames(16, 9))).toBeUndefined();
  });

  test('встроенная видеокарта на среднем — 12–13 кадров в секунду: низкий; 60 кадров — средний', () => {
    expect(pickPreset(frames(1000 / 13))).toBe('low');
    expect(pickPreset(frames(1000 / 60))).toBe('medium');
    // 30 кадров при 60 Гц — каждый второй кадр, 33,3 мс: дольше 33 — низкий
    expect(pickPreset(frames(1000 / 30))).toBe('low');
    expect(pickPreset(frames(PRESET.slow))).toBe('medium');
    expect(pickPreset([])).toBeUndefined();
  });

  test('редкие долгие кадры (сборка шейдеров, подгрузка) не решают: решает медиана', () => {
    expect(pickPreset([...frames(16.7, 80), ...frames(250, 20)])).toBe('medium');
  });
});

describe('пресет в хранилище окна', () => {
  const box = (): Keep & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };

  test('запомнили — читается; чужое значение — как будто нет', () => {
    const b = box();
    expect(kept(b)).toBeUndefined();
    keep(b, 'low');
    expect(kept(b)).toBe('low');
    b.data.set(PRESET.key, 'ultra');
    expect(kept(b)).toBeUndefined();
  });

  test('хранилище бросает или его нет — игра идёт без него', () => {
    const broken: Keep = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(kept(broken)).toBeUndefined();
    expect(() => keep(broken, 'medium')).not.toThrow();
    expect(kept(undefined)).toBeUndefined();
    expect(() => keep(undefined, 'high')).not.toThrow();
  });
});
