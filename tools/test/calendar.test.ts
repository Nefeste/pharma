// Календарь без Date (src/engine/core/calendar.ts): гражданская дата и день недели из номера дня — и обратно.
import { describe, expect, test } from 'bun:test';
import { civilFromDays, DAY, daysFromCivil, momentOf, weekday } from '../../src/engine/core/calendar';

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

  test('момент завода: секунды от полуночи даты начала', () => {
    const start = { y: 2027, m: 12, d: 31 };
    const m = momentOf(start, DAY + 8 * 3600 + 30);
    expect(m.date).toEqual({ y: 2028, m: 1, d: 1 });
    expect(m.sec).toBe(8 * 3600 + 30);
  });
});
