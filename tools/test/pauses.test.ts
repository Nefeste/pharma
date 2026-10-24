// Б2а: автопаузы окна (src/app/pauses.ts; геймдизайн, §2, §29.2). Мир встаёт на включённой автопаузе, если это дело места
// игрока: директор и «место не выбрано» — всё, планёрка — у всех. Отключённые запоминаются в хранилище окна; хранилище
// может не работать. Извещение ведёт на место: отказ — к машине, фура — к фуре.
import { describe, expect, test } from 'bun:test';
import { EVENT_CAP, goOf, keepOff, keptOff, machineThing, mine, PAUSE_KEY, PAUSE_NOTICES, PAUSES, pauseOf, stopKinds } from '../../src/app/pauses';
import type { Keep } from '../../src/app/preset';
import { db } from '../../src/content';
import { DAY } from '../../src/engine/core/calendar';

const plant = db.plants[db.scenarios['scn.proto'].plant];

/** Хранилище окна в памяти; `broken` — бросает, как закрытое. */
function memory(broken = false): Keep & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: k => {
      if (broken) throw new Error('denied');
      return data.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (broken) throw new Error('denied');
      data.set(k, v);
    },
  };
}

describe('автопаузы', () => {
  test('у каждого извещения автопаузы — одна автопауза', () => {
    const kinds = PAUSES.flatMap(p => PAUSE_NOTICES[p]);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const p of PAUSES) for (const k of PAUSE_NOTICES[p]) expect(pauseOf(k)).toBe(p);
    expect(pauseOf('shipped')).toBeUndefined();
    expect(pauseOf('lotReleased')).toBeUndefined();
  });

  test('чьё дело: производство — поломка, OOS, материал, планёрка; качество — OOS, отклонение, потеря допуска, планёрка', () => {
    const sorted = (k: readonly string[]) => [...k].sort();
    // срок актива (Б3в): оборудование таблеток, линия и приборы МОК — производства, лаборатория — качества, датчики склада —
    // снабжения и склада
    const eq = ['assetExpired/equipment', 'assetExpired/machine', 'assetExpired/ipc'];
    // сверхурочные года на исходе (Б4а) — пост отдела человека: производство, линия и техслужба — производства, ОКК и
    // ООК — качества, склад — снабжения и склада
    const ot = (...d: string[]) => d.map(x => `overtimeLow/${x}`);
    // заявление об увольнении (Б4в) — тоже пост отдела человека; черновик графика отпусков (Б4г) — каждого поста
    const rs = (...d: string[]) => d.map(x => `resign/${x}`);
    expect(sorted(stopKinds([], ['production']))).toEqual(sorted(['failure', 'investigation', 'lotRejected', 'materialLate', 'morning', 'leaveDraft', ...eq, ...ot('mes', 'line', 'maint'), ...rs('mes', 'line', 'maint')]));
    expect(sorted(stopKinds([], ['quality']))).toEqual(sorted(['deviation', 'investigation', 'lotRejected', 'qualLost', 'morning', 'leaveDraft', 'assetExpired/lab', 'pairSuspended', ...ot('qc', 'qa'), ...rs('qc', 'qa')]));
    expect(stopKinds([], ['commerce'])).toEqual(['orderRisk', 'leaveDraft', 'morning']);
    expect(sorted(stopKinds([], ['supply']))).toEqual(sorted(['materialLate', 'morning', 'leaveDraft', 'truckWait', 'assetExpired/sensor', 'pairSuspended', ...ot('wms'), ...rs('wms')]));
    // директор и «место не выбрано» — всё
    const all = PAUSES.flatMap(p => PAUSE_NOTICES[p]);
    expect(stopKinds([], ['director'])).toEqual(all);
    expect(stopKinds([], undefined)).toEqual(all);
    expect(mine('truckWait', ['production', 'quality'])).toBe(false);
    expect(mine('morning', ['quality'])).toBe(true);
  });

  test('отключённая автопауза не ставит мир на паузу', () => {
    expect(stopKinds(['morning', 'oos'], ['quality'])).toEqual(['deviation', 'qualLost', 'overtimeLow/qc', 'overtimeLow/qa', 'resign/qc', 'resign/qa', 'assetExpired/lab', 'pairSuspended', 'leaveDraft']);
    expect(stopKinds([...PAUSES], ['director'])).toEqual([]);
  });

  test('отключённые помнит хранилище окна; чужое, битое и закрытое — ничего не отключено', () => {
    const k = memory();
    expect(keptOff(k)).toEqual([]);
    keepOff(k, ['morning', 'deviation']);
    // порядок — меню, а не щелчков
    expect(k.data.get(PAUSE_KEY)).toBe('["deviation","morning"]');
    expect(keptOff(k)).toEqual(['deviation', 'morning']);
    k.data.set(PAUSE_KEY, '{"morning":true}');
    expect(keptOff(k)).toEqual([]);
    k.data.set(PAUSE_KEY, '["morning","nope"]');
    expect(keptOff(k)).toEqual(['morning']);
    k.data.set(PAUSE_KEY, 'не json');
    expect(keptOff(k)).toEqual([]);
    expect(keptOff(memory(true))).toEqual([]);
    expect(keptOff(undefined)).toEqual([]);
    expect(() => keepOff(memory(true), ['morning'])).not.toThrow();
  });

  test('«До события» без события встаёт через 30 суток', () => {
    expect(EVENT_CAP).toBe(30 * DAY);
  });
});

describe('извещение ведёт на место', () => {
  test('отказ — к машине линии или оборудованию по имени в плане', () => {
    const line = plant.lines[0];
    const last = line.machines.length - 1;
    expect(goOf(plant, { kind: 'failure', machine: line.machines[last].id, part: 'x' })).toEqual({ thing: { kind: 'machine', line: 0, k: last } });
    const eq = plant.equipment.length - 1;
    expect(machineThing(plant, plant.equipment[eq].id)).toEqual({ kind: 'equipment', i: eq });
    expect(goOf(plant, { kind: 'failure', machine: 'нет такой', part: 'x' })).toBeUndefined();
  });

  test('фура — к фуре; материал — к расписанию; заказ — к планёрке; партия — к лаборатории; расследование — к доске', () => {
    expect(goOf(plant, { kind: 'truckWait', truck: 'T7', po: 'P1', supplier: 'sup.api' })).toEqual({ thing: { kind: 'truck', n: 7, customer: false } });
    expect(goOf(plant, { kind: 'materialLate', batch: 'B9', code: '', short: [] })).toEqual({ panel: 'gantt' });
    expect(goOf(plant, { kind: 'orderRisk', order: 'O1', customer: 'cus.national', due: 0, missing: 1, pending: 0, short: ['sku.paracetamol500.n20'] })).toEqual({ panel: 'morning' });
    expect(goOf(plant, { kind: 'lotRejected', lot: 'L1', deviation: 'D1' })).toEqual({ panel: 'lab' });
    expect(goOf(plant, { kind: 'investigation', id: 'I1', batch: 'B2', lot: 'L1', method: 'test.dissolution', code: 'PA002' })).toEqual({ inv: 'I1' });
    expect(goOf(plant, { kind: 'qualLost', person: 'E9', role: 'role.operator', tab: 1009, doc: 'SOP-0015' })).toEqual({ thing: { kind: 'person', n: 9 } });
    expect(goOf(plant, { kind: 'morning', day: 1 })).toBeUndefined();
  });
});
