// Б1к: учёт ожидания серий у мест по суткам (src/engine/lean.ts). Место — помещение: стадии идут и ждут в помещении
// стадии, упаковка — в помещении линии, балк ждёт решения лаборатории — у лаборатории, ГП ждёт проверки и решения — у
// помещения ООК, до стадий — у склада; своя дата «не раньше» — не ожидание. Место проверяет срез каждую минуту своим
// кодом; по всем местам в сумме — время серий по состояниям (1ж) без своей даты; образец схемы 31 читается и живёт
// дальше — учёт с мгновения загрузки, у прошлых суток его нет; образец схемы 32 — как есть, отрезки идут дальше.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, MIN, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { roomsOf } from '../../src/engine/lean';
import { roomAt } from '../../src/engine/places';
import { runSeed } from '../../src/engine/plan/run';
import { planOf } from '../../src/engine/plant';
import { fromSave } from '../../src/engine/save';
import type { Batch, BatchPhase, PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const plan = planOf(db, db.scenarios[SC].plant);
const qp = plan.plant.posts['role.qp'];
const QA = roomAt(plan.plant, qp[0], qp[1])!;

/** Место серии своим кодом: по её статусу и стадии; своя дата «не раньше» — без места. */
function place(b: Batch): string | undefined {
  if (!b.phase || b.phase === 'plan' || b.phase === 'before') return undefined;
  switch (b.status) {
    case 'process':
      return plan.roomOf[db.recipes[b.recipe].stages[b.stage].room];
    case 'bulk':
      return 'lab';
    case 'packing':
      return plan.plant.lines.find(l => l.id === b.pack!.line)!.room;
    case 'fg':
      return QA;
    default:
      return 'warehouse';
  }
}

/** Учёт у мест — суммой по суткам, с отрезками, которые ещё не закрыты: `место/состояние` → секунды. */
function accounted(s: PlantState): Map<string, number> {
  const out = new Map<string, number>();
  const add = (k: string, sec: number) => out.set(k, (out.get(k) ?? 0) + sec);
  for (const d of s.losses) for (const [room, x] of Object.entries(d.waits)) for (const [ph, sec] of Object.entries(x)) add(`${room}/${ph}`, sec ?? 0);
  for (const b of Object.values(s.batches)) if (b.place && b.phase && b.placeAt !== undefined) add(`${b.place}/${b.phase}`, s.t - b.placeAt);
  return out;
}

describe('учёт у мест', () => {
  test('ООК — помещение, где пост уполномоченного лица; места — помещения стадий, линии, лаборатория, ООК и склад', () => {
    expect(QA).toBe('office');
    expect(roomsOf(plan).rooms).toEqual(['dispensing', 'granulation', 'blending', 'compression', 'packaging']);
  });

  test('30 суток со срезом каждую минуту: место — по правилу, часы — с точностью до минуты на смену места или состояния', () => {
    const s = newPlant(db, { scenario: SC });
    const got = new Map<string, number>();
    const changes = new Map<string, number>();
    const prev = new Map<string, string>();
    const start = accounted(s);
    const end = s.t + 30 * DAY;
    while (s.t < end) {
      for (const b of Object.values(s.batches)) {
        const at = place(b);
        expect(b.place).toBe(at);
        const k = at ? `${at}/${b.phase}` : '';
        if (at) got.set(k, (got.get(k) ?? 0) + MIN);
        const was = prev.get(b.id);
        if (was !== undefined && was !== k) for (const x of [was, k]) if (x) changes.set(x, (changes.get(x) ?? 0) + 1);
        prev.set(b.id, k);
      }
      apply(db, s, { kind: 'advance', seconds: MIN });
    }
    const acc = accounted(s);
    const keys = new Set([...got.keys(), ...acc.keys()]);
    let worked = 0;
    for (const k of keys) {
      const sec = (acc.get(k) ?? 0) - (start.get(k) ?? 0);
      expect(Math.abs((got.get(k) ?? 0) - sec)).toBeLessThanOrEqual(MIN * ((changes.get(k) ?? 0) + 1));
      if (k.endsWith('/work')) worked += sec;
    }
    // за месяц серии и работали, и ждали у мест каждого вида
    expect(worked).toBeGreaterThan(0);
    for (const room of ['lab', 'packaging', 'compression', 'warehouse', QA]) expect([...keys].some(k => k.startsWith(`${room}/`))).toBe(true);
  });

  describe('90 суток', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: 90 * DAY });

    test('по всем местам — время серий по состояниям без своей даты «не раньше», до секунды; инварианты целы', () => {
      expect(check(db, s)).toEqual([]);
      const byPhase = new Map<string, number>();
      for (const [k, sec] of accounted(s)) {
        const ph = k.split('/')[1];
        byPhase.set(ph, (byPhase.get(ph) ?? 0) + sec);
      }
      const spent = new Map<string, number>();
      for (const b of Object.values(s.batches)) {
        for (const [ph, sec] of Object.entries(b.spent)) spent.set(ph, (spent.get(ph) ?? 0) + (sec ?? 0));
        if (b.phase) spent.set(b.phase, (spent.get(b.phase) ?? 0) + s.t - b.phaseAt);
      }
      for (const ph of ['plan', 'before'] as BatchPhase[]) {
        expect(byPhase.has(ph)).toBe(false);
        spent.delete(ph);
      }
      expect(Object.fromEntries(byPhase)).toEqual(Object.fromEntries(spent));
      // места учёта — только помещения стадий, линии, лаборатория, ООК и склад
      const places = new Set(s.losses.flatMap(d => Object.keys(d.waits)));
      expect([...places].every(r => [...roomsOf(plan).rooms, 'lab', QA, 'warehouse'].includes(r))).toBe(true);
    });

    test('отрезок закрыт в сутки своего начала: у прошлых суток места — не больше суток на серию', () => {
      const today = momentOf(s.start, s.t).day;
      const batches = Object.keys(s.batches).length;
      for (const d of s.losses.filter(x => x.day < today)) {
        const sum = Object.values(d.waits).reduce((n, x) => n + Object.values(x).reduce((m, v) => m + (v ?? 0), 0), 0);
        expect(sum).toBeLessThanOrEqual(batches * DAY);
      }
      // и у открытых отрезков начало — в нынешнем часе
      for (const b of Object.values(s.batches)) if (b.placeAt !== undefined) expect(s.t - b.placeAt).toBeLessThan(60 * MIN);
    });

    test('двойник прогона плана ведёт учёт, как движок; сам завод не тронут', () => {
      const before = structuredClone(s.losses.at(-1)!.waits);
      const c = runSeed(db, s, [], { days: 3, seeds: 1 }, 0);
      // у двойника свой счёт: он забыл то, чего завод не знает (сверку упаковки в том числе), — инвариантов учёта у мест
      // это не касается
      expect(check(db, c).filter(x => x.includes('без места') || x.includes(', а место'))).toEqual([]);
      const days = c.losses.filter(d => d.day > momentOf(s.start, s.t).day);
      expect(days.some(d => Object.keys(d.waits).length > 0)).toBe(true);
      expect(s.losses.at(-1)!.waits).toEqual(before);
    });
  });
});

describe('сохранения', () => {
  test('образец схемы 31: учёт — с мгновения загрузки, у прошлых суток его нет; место — по правилу', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v31.json', import.meta.url)).text();
    const s = fromSave(db, json);
    const t0 = s.t;
    const day0 = momentOf(s.start, t0).day;
    for (const d of s.losses) expect(d.waits).toEqual({});
    const placed = Object.values(s.batches).filter(b => place(b) !== undefined);
    expect(placed.length).toBeGreaterThan(0);
    for (const b of Object.values(s.batches)) {
      expect(b.place).toBe(place(b));
      if (b.place) expect(b.placeAt).toBe(t0);
    }
    expect(check(db, s)).toEqual([]);
    apply(db, s, { kind: 'advance', seconds: 3 * DAY });
    expect(check(db, s)).toEqual([]);
    for (const d of s.losses) if (d.day < day0) expect(d.waits).toEqual({});
    expect(s.losses.some(d => d.day >= day0 && Object.keys(d.waits).length > 0)).toBe(true);
  });

  test('образец схемы 32 читается как есть: отрезки, которые шли, идут дальше', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v32.json', import.meta.url)).text();
    const s = fromSave(db, json);
    const raw = JSON.parse(json) as PlantState;
    // посреди учёта: серии у разных мест, в сутках сохранения учёт уже копится
    const places = new Set(Object.values(s.batches).map(b => b.place).filter(Boolean));
    expect(places.size).toBeGreaterThanOrEqual(3);
    for (const b of Object.values(s.batches)) expect([b.place, b.placeAt]).toEqual([raw.batches[b.id].place, raw.batches[b.id].placeAt]);
    expect(s.losses.map(d => d.waits)).toEqual(raw.losses.map(d => d.waits));
    const before = accounted(s);
    apply(db, s, { kind: 'advance', seconds: 2 * DAY });
    expect(check(db, s)).toEqual([]);
    const after = accounted(s);
    // учёт только растёт: отрезок, который шёл при сохранении, не потерян
    for (const [k, sec] of before) expect(after.get(k) ?? 0).toBeGreaterThanOrEqual(sec);
  });
});
