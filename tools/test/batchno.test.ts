// Номер серии `PPNNNMMYY` (src/engine/batchno.ts; docs/specs/2026-10-master-data.md, «Номер серии»; решения владельца
// 19.10.2026, #50, #51): строка и целое среза; счёт продукта — с 1 января и после 999 снова с 001, занятые номера
// пропускаются; короткий номер с выдачи досье, полный — с начала смешивания; миграция схемы 14.
import { describe, expect, test } from 'bun:test';
import { legacy as db } from './legacy';
import { batchNo, freeNo, issueNo, NNN_MAX, packNo, unpackNo } from '../../src/engine/batchno';
import { DAY, daysFromCivil, HOUR, MIN, momentOf, type Ymd } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { fromSave } from '../../src/engine/save';
import type { Batch, BatchNo, PlantState } from '../../src/engine/types';

describe('номер строкой и в срезе', () => {
  test('полный, короткий до смешивания, пусто до выдачи досье', () => {
    expect(batchNo({ pp: 'PA', n: 1, m: 9, y: 27 })).toBe('PA0010927');
    expect(batchNo({ pp: 'PA', n: 152, m: 6, y: 28 })).toBe('PA1520628');
    expect(batchNo({ pp: 'PA', n: 7, m: 0, y: 0 })).toBe('PA007');
    expect(batchNo({ pp: '', n: 0, m: 0, y: 0 })).toBe('');
  });

  test('целое среза — туда и обратно, наибольшее входит в Int32; номера нет — −1', () => {
    const all: BatchNo[] = [
      { pp: 'PA', n: 1, m: 9, y: 27 },
      { pp: '00', n: 1, m: 0, y: 0 },
      { pp: 'ZZ', n: NNN_MAX, m: 12, y: 99 },
      { pp: 'A9', n: 500, m: 1, y: 0 },
    ];
    for (const c of all) {
      const v = packNo(c);
      expect(new Int32Array([v])[0]).toBe(v);
      expect(unpackNo(v)).toEqual(c);
    }
    expect(packNo({ pp: '', n: 0, m: 0, y: 0 })).toBe(-1);
    expect(unpackNo(-1)).toBeUndefined();
  });
});

// Завод из одних номеров: серии продукта с кодом и счёт — этого хватает выбору номера
const START: Ymd = { y: 2027, m: 9, d: 1 };
const when = (y: number, m: number, d: number, h = 12) => (daysFromCivil({ y, m, d }) - daysFromCivil(START)) * DAY + h * HOUR;
function plant(codes: BatchNo[], last?: { year: number; n: number }): PlantState {
  const batches: Record<string, Batch> = {};
  codes.forEach((code, i) => (batches[`B${i + 1}`] = { id: `B${i + 1}`, code } as Batch));
  return { start: START, batches, batchNos: last ? { PA: last } : {} } as unknown as PlantState;
}

describe('счёт продукта (#50)', () => {
  test('первое досье — 001, дальше — по порядку; у другого кода — свой счёт', () => {
    expect(freeNo(plant([]), 'PA', when(2028, 1, 10))).toBe(1);
    expect(freeNo(plant([], { year: 2028, n: 151 }), 'PA', when(2028, 6, 3))).toBe(152);
    expect(freeNo(plant([{ pp: 'PA', n: 1, m: 0, y: 0 }], { year: 2028, n: 1 }), 'IB', when(2028, 6, 3))).toBe(1);
  });

  test('с 1 января — снова 001', () => {
    expect(freeNo(plant([], { year: 2027, n: 152 }), 'PA', when(2028, 1, 2))).toBe(1);
  });

  test('999 кончились в ноябре — снова 001: месяц у неё другой, чем у первой (пример владельца)', () => {
    const s = plant([{ pp: 'PA', n: 1, m: 1, y: 28 }, { pp: 'PA', n: 999, m: 11, y: 28 }], { year: 2028, n: 999 });
    const n = freeNo(s, 'PA', when(2028, 11, 20))!;
    expect(n).toBe(1);
    expect(batchNo({ pp: 'PA', n, m: 11, y: 28 })).toBe('PA0011128');
  });

  test('номер серии до смешивания пропускается: декабрьские досье со смешиванием в январе', () => {
    const dec = [1, 2, 3].map(n => ({ pp: 'PA', n, m: 0, y: 0 }));
    expect(freeNo(plant(dec, { year: 2027, n: 3 }), 'PA', when(2028, 1, 4))).toBe(4);
  });

  test('номер серии, смешанной в месяце досье, пропускается; смешанной раньше — свободен', () => {
    const s = plant([{ pp: 'PA', n: 3, m: 1, y: 28 }], { year: 2028, n: 2 });
    expect(freeNo(s, 'PA', when(2028, 1, 20))).toBe(4);
    expect(freeNo(s, 'PA', when(2028, 2, 1))).toBe(3);
  });

  test('смешивание с началом в следующем месяце — номер уже занят в месяце досье', () => {
    // аппаратчиков назначили 31.01 в 23:55, работа — с 00:05 1 февраля: у серии уже февраль
    const s = plant([{ pp: 'PA', n: 5, m: 2, y: 28 }], { year: 2028, n: 4 });
    expect(freeNo(s, 'PA', when(2028, 1, 31, 23))).toBe(6);
  });

  test('заняты все 999 — номера нет, досье не выдают', () => {
    const all = Array.from({ length: NNN_MAX }, (_, i) => ({ pp: 'PA', n: i + 1, m: 0, y: 0 }));
    const s = plant(all, { year: 2028, n: 999 });
    expect(freeNo(s, 'PA', when(2028, 3, 1))).toBeUndefined();
    const b = { id: 'B0', product: 'prd.paracetamol500', code: { pp: '', n: 0, m: 0, y: 0 } } as Batch;
    (s as { t: number }).t = when(2028, 3, 1);
    expect(issueNo(db, s, b)).toBe(false);
    expect(b.code.n).toBe(0);
  });

  test('ни один полный номер не повторяется: 3 года досье в случайном порядке смешивания', () => {
    // досье — каждые 8 ч, смешивание — через 0–40 суток после досье: часть серий ждёт через границы месяцев и лет, а
    // 999 кончаются за год несколько раз
    const s = plant([]);
    let seed = 7;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const pending: { b: Batch; at: number }[] = [];
    const seen = new Set<string>();
    for (let t = 0, i = 0; t < 3 * 365 * DAY; t += 8 * HOUR, i++) {
      for (const p of pending.filter(x => x.at <= t)) {
        const d = momentOf(START, p.at).date;
        p.b.code.m = d.m;
        p.b.code.y = d.y % 100;
        const no = batchNo(p.b.code);
        expect(seen.has(no)).toBe(false);
        seen.add(no);
        pending.splice(pending.indexOf(p), 1);
      }
      const b = { id: `B${i}`, product: 'prd.paracetamol500', code: { pp: '', n: 0, m: 0, y: 0 } } as Batch;
      (s as { t: number }).t = t;
      expect(issueNo(db, s, b)).toBe(true);
      s.batches[b.id] = b;
      pending.push({ b, at: t + Math.floor(rnd() * 40 * DAY) });
    }
    expect(seen.size).toBeGreaterThan(3000);
  });
});

describe('на заводе прототипа (#51)', () => {
  test('с выдачи досье — короткий номер, с начала грануляции — полный, с месяцем начала работы', () => {
    // зерно 1: у одной серии досье выдано в октябре, а грануляция — в ноябре
    const s = newPlant(db, { scenario: 'scn.proto', seed: 1 });
    const end = s.t + 70 * DAY;
    let short = 0;
    while (s.t < end) {
      apply(db, s, { kind: 'advance', seconds: 10 * MIN });
      expect(check(db, s)).toEqual([]);
      for (const b of Object.values(s.batches)) {
        if (b.code.n === 0) {
          expect(['waiting', 'reserved']).toContain(b.status);
          continue;
        }
        expect(b.code.pp).toBe('PA');
        expect(b.issued).toBeDefined();
        const gran = Object.values(s.tasks).find(t => t.kind === 'stage' && t.batch === b.id && t.state === 'busy' && b.stage === 1);
        const rec = b.records.find(r => r.stage === 'granulate');
        if (!gran && !rec) {
          expect(b.code.m).toBe(0);
          short++;
          continue;
        }
        const start = momentOf(s.start, rec?.start ?? gran!.times![1]).date;
        expect([b.code.m, b.code.y]).toEqual([start.m, start.y % 100]);
      }
    }
    expect(short).toBeGreaterThan(0);
    // досье в одном месяце, смешивание — в другом: в номере — месяц смешивания
    const crossed = Object.values(s.batches).filter(b => {
      const rec = b.records.find(r => r.stage === 'granulate');
      return rec && momentOf(s.start, b.issued!).date.m !== momentOf(s.start, rec.start).date.m;
    });
    expect(crossed.map(b => batchNo(b.code))).toEqual(['PA0081127']);
    // у партий балка и ГП — номер серии как номер изготовителя
    for (const b of Object.values(s.batches))
      for (const lot of Object.values(s.lots)) if (lot.id === b.bulk || (lot.batch === b.id && lot.material.startsWith('mat.fg'))) expect(lot.vendorLot).toBe(batchNo(b.code));
  }, 120_000);
});

describe('схема 14 → 15', () => {
  test('у прежних серий — код продукта и прежний номер, месяц и год — грануляции; у партий балка и ГП — тот же номер', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v14.json', import.meta.url)).text();
    const old = JSON.parse(json) as { batches: Record<string, { code: { y: number; m: number; n: number } }>; next: Record<string, number> };
    expect(old.next.batchCode).toBeGreaterThan(0);
    const s = fromSave(db, json);
    expect(s.next.batchCode).toBeUndefined();
    for (const b of Object.values(s.batches)) {
      expect(b.code.n).toBe(old.batches[b.id].code.n);
      if (b.code.n === 0) continue;
      expect(b.code.pp).toBe('PA');
      const rec = b.records.find(r => r.stage === 'granulate');
      if (rec) {
        const d = momentOf(s.start, rec.start).date;
        expect([b.code.m, b.code.y]).toEqual([d.m, d.y % 100]);
      }
      if (b.bulk) expect(s.lots[b.bulk].vendorLot).toBe(batchNo(b.code));
    }
    expect(s.batchNos.PA.n).toBe(Math.max(...Object.values(old.batches).map(b => b.code.n)));
    expect(check(db, s)).toEqual([]);
    // счёт продолжается: следующее досье — со следующим номером
    apply(db, s, { kind: 'advance', seconds: 20 * DAY });
    expect(check(db, s)).toEqual([]);
  });
});
