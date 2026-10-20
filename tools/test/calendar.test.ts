// Календарь без Date (src/engine/core/calendar.ts): гражданская дата и день недели из номера дня — и обратно.
import { describe, expect, test } from 'bun:test';
import { addMonths, civilFromDays, DAY, daysFromCivil, momentOf, weekday } from '../../src/engine/core/calendar';

describe('календарь', () => {
  test('известные даты', () => {
    expect(daysFromCivil({ y: 1970, m: 1, d: 1 })).toBe(0);
    expect(daysFromCivil({ y: 2000, m: 3, d: 1 })).toBe(11017);
    // 17.10.2026 — суббота, 01.09.2027 — среда
    expect(weekday(daysFromCivil({ y: 2026, m: 10, d: 17 }))).toBe(5);
    expect(weekday(daysFromCivil({ y: 2027, m: 9, d: 1 }))).toBe(2);
  });

  test('туда и обратно на 400 лет, включая високосные', () => {
    const from = daysFromCivil({ y: 1900, m: 1, d: 1 });
    const to = daysFromCivil({ y: 2300, m: 1, d: 1 });
    for (let z = from; z < to; z += 17) expect(daysFromCivil(civilFromDays(z))).toBe(z);
    expect(civilFromDays(daysFromCivil({ y: 2028, m: 2, d: 29 }))).toEqual({ y: 2028, m: 2, d: 29 });
    expect(civilFromDays(daysFromCivil({ y: 2027, m: 2, d: 28 }) + 1)).toEqual({ y: 2027, m: 3, d: 1 });
  });

  test('через месяцы — то же число; его нет в месяце — последний день месяца (срок записи обучения, Б3б)', () => {
    const at = (y: number, m: number, d: number) => daysFromCivil({ y, m, d });
    expect(civilFromDays(addMonths(at(2027, 9, 6), 12))).toEqual({ y: 2028, m: 9, d: 6 });
    expect(civilFromDays(addMonths(at(2027, 11, 15), 3))).toEqual({ y: 2028, m: 2, d: 15 });
    expect(civilFromDays(addMonths(at(2028, 1, 31), 1))).toEqual({ y: 2028, m: 2, d: 29 });
    expect(civilFromDays(addMonths(at(2027, 1, 31), 1))).toEqual({ y: 2027, m: 2, d: 28 });
    expect(civilFromDays(addMonths(at(2028, 2, 29), 12))).toEqual({ y: 2029, m: 2, d: 28 });
    expect(addMonths(at(2027, 9, 1), 0)).toBe(at(2027, 9, 1));
  });

  test('момент завода: секунды от полуночи даты начала', () => {
    const start = { y: 2027, m: 12, d: 31 };
    const m = momentOf(start, DAY + 8 * 3600 + 30);
    expect(m.date).toEqual({ y: 2028, m: 1, d: 1 });
    expect(m.sec).toBe(8 * 3600 + 30);
  });
});
