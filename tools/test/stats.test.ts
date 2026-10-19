// Выборка бенча с отметки (src/app/stats.ts, `since`): память замеров обрезана — у таймера видеокарты держит последние
// 2000, у клиента потока расчёта при 2001 срезает первую тысячу. Отметка начала прогона — счёт замеров, и каждый из шести
// прогонов бенча получает ровно свои замеры при обоих правилах обрезки; с отметкой длиной массива — нет (замер владельца
// 19.10.2026: время видеокарты пропало с третьего прогона, время потока — со второго).
import { describe, expect, test } from 'bun:test';
import { since } from '../../src/app/stats';

/** Память замеров с правилом обрезки и счётом всех пришедших. */
function tally(trim: (list: number[]) => void) {
  const list: number[] = [];
  let total = 0;
  return {
    list,
    get total() {
      return total;
    },
    push(v: number) {
      list.push(v);
      total++;
      trim(list);
    },
  };
}

const keepLast = (list: number[]) => {
  if (list.length > 2000) list.splice(0, list.length - 2000);
};
const cutThousand = (list: number[]) => {
  if (list.length > 2000) list.splice(0, 1000);
};

describe('выборка с отметки', () => {
  for (const [name, trim] of [
    ['таймер видеокарты — последние 2000', keepLast],
    ['клиент потока — срез тысячи', cutThousand],
  ] as const) {
    test(`${name}: шесть прогонов по 900 замеров после 180 на прогрев — у каждого свои 900`, () => {
      const t = tally(trim);
      let n = 0;
      let broken = 0;
      for (let run = 0; run < 6; run++) {
        for (let i = 0; i < 180; i++) t.push(n++);
        const mark = t.total;
        const byLength = t.list.length;
        const first = n;
        for (let i = 0; i < 900; i++) t.push(n++);
        const got = since(t.list, t.total, mark);
        expect(got.length).toBe(900);
        expect(got[0]).toBe(first);
        expect(got[899]).toBe(n - 1);
        // прежняя отметка — длина массива: после обрезки она теряет замеры прогона
        if (t.list.slice(byLength).length !== 900) broken++;
      }
      expect(broken).toBeGreaterThan(0);
    });
  }

  test('пришло больше, чем держит память, — последние; ничего не пришло — пусто', () => {
    const t = tally(keepLast);
    const mark = t.total;
    for (let i = 0; i < 2500; i++) t.push(i);
    expect(since(t.list, t.total, mark)).toEqual(t.list);
    expect(since(t.list, t.total, t.total)).toEqual([]);
  });
});
