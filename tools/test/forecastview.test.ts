// Б6в: виды прогноза (src/sim/forecast.ts) — вкладка «Прогноз» расписания и блок планёрки. На образце схемы 41 (1 ноября
// 2027 года, правка игрока на ноябрь, спрос — по прогнозу): сетка — прогнозы планирования и отдела продаж по позициям и
// 18 месяцам, правка — с тем, что было по способу; «прогноз против факта» — продукт по умолчанию, позиция по ключу;
// ошибка — у планирования, отдела продаж и каждого способа; блок планёрки — только в первые сутки после закрытия месяца и
// только с прогнозом на закрытый месяц; без истины — у двух заводов, различающихся только истинными полями, вид один;
// шкала графика — круглые деления; ряд без числа — разрыв линии.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../../src/content';
import { DAY, HOUR, momentOf } from '../../src/engine/core/calendar';
import { newPlant } from '../../src/engine/engine';
import * as F from '../../src/engine/forecast';
import { fromSave } from '../../src/engine/save';
import type { PlantState } from '../../src/engine/types';
import { fcMeeting, forecastView } from '../../src/sim/forecast';
import { ganttView } from '../../src/sim/plan';
import { morningView } from '../../src/sim/report';
import { fcGeom, niceTicks, overFact, runs } from '../../src/ui/fcchart';

const SC = 'scn.proto';
const s: PlantState = fromSave(db, readFileSync(join(import.meta.dir, 'fixtures/save-v41.json'), 'utf8'));
const f = s.forecast!;
const NOV = F.monthNo(2027, 11);
const N20 = 'sku.paracetamol500.n20';
const PAR = 'prd.paracetamol500';
const LOR = 'prd.loratadine10';
const skus = F.fcSkus(db, s);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('вкладка «Прогноз»', () => {
  test('сетка: позиции плана, 18 месяцев с нынешнего; клетка — планирование и отдел продаж; правка — с тем, что по способу', () => {
    expect(f.at).toBe(NOV);
    const v = forecastView(db, s)!;
    expect(v.at).toBe(NOV);
    expect(v.rows.map(r => r.sku)).toEqual(skus);
    for (const r of v.rows) {
      expect(r.product).toBe(db.skus[r.sku].product);
      expect(r.cells.map(c => c.plan)).toEqual(f.plan[r.sku]);
      expect(r.cells.map(c => c.sales)).toEqual(f.sales[r.sku]);
      expect(r.cells.map(c => c.was)).toEqual(f.by[f.method][r.sku]);
    }
    const n20 = v.rows.find(r => r.sku === N20)!;
    expect(n20.cells[0]).toMatchObject({ edit: true, plan: f.edits[N20][NOV] });
    expect(n20.cells.filter(c => c.edit).length).toBe(1);
    expect(v.method).toBe(f.method);
    expect(v.policy).toBe('best');
    expect(v.demand).toBe('forecast');
  });

  test('«прогноз против факта»: продукт по умолчанию — 24 месяца назад и 18 вперёд; с запаздыванием — где запись есть', () => {
    const v = forecastView(db, s)!;
    expect(v.key).toBe(PAR);
    const of = skus.filter(x => db.skus[x].product === PAR);
    expect(v.past.map(p => p.m)).toEqual(Array.from({ length: 24 }, (_, i) => NOV - 24 + i));
    for (const p of v.past) expect(p.fact).toBe(sum(of.map(x => f.demand[x][p.m - f.from])));
    // записи с запаздыванием на прошлые месяцы — только на октябрь (на него прогнозировали 1 сентября, на старте)
    const withFc = v.past.filter(p => p.plan !== undefined);
    expect(withFc.map(p => p.m)).toEqual([NOV - 1]);
    const lag = f.lag.find(x => x.m === NOV - 1)!;
    expect(withFc[0]).toMatchObject({ plan: sum(of.map(x => lag.plan[x])), sales: sum(of.map(x => lag.sales[x])) });
    expect(v.ahead.map(p => p.m)).toEqual(Array.from({ length: 18 }, (_, i) => NOV + i));
    v.ahead.forEach((p, i) => expect(p).toEqual({ m: NOV + i, plan: sum(of.map(x => f.plan[x][i])), sales: sum(of.map(x => f.sales[x][i])) }));
  });

  test('ключ — позиция или продукт; чужой ключ — продукт по умолчанию; ошибка ключа — по его позициям', () => {
    const one = forecastView(db, s, N20)!;
    expect(one.key).toBe(N20);
    expect(one.ahead[0].plan).toBe(f.plan[N20][0]);
    expect(one.keyErr.plan).toEqual(F.shares(F.lagError(s, 'plan', NOV - 12, NOV, [N20])));
    expect(one.keyErr.by.ses).toEqual(F.shares(F.backtest(db, f, skus, 'ses', NOV, F.BEST_N, [N20])));
    const lor = forecastView(db, s, LOR)!;
    expect(lor.key).toBe(LOR);
    expect(lor.ahead[0].sales).toBe(sum(skus.filter(x => db.skus[x].product === LOR).map(x => f.sales[x][0])));
    expect(forecastView(db, s, 'sku.nope')!.key).toBe(PAR);
    // всех позиций: по всем записям с запаздыванием и проверке каждого способа
    const all = forecastView(db, s)!;
    expect(all.err.sales).toEqual(F.shares(F.lagError(s, 'sales', NOV - 12, NOV)));
    for (const m of F.METHODS) expect(all.err.by[m]).toEqual(F.shares(F.backtest(db, f, skus, m, NOV)));
  });

  test('в виде расписания — только с открытой вкладкой; у сценария без прогноза — нет', () => {
    const q = { view: 'gantt' as const, from: s.t, to: s.t + 7 * DAY };
    expect(ganttView(db, s, q).forecast).toBeUndefined();
    expect(ganttView(db, s, { ...q, forecast: { key: N20 } }).forecast?.key).toBe(N20);
    const l = newPlant(db, { scenario: SC });
    delete l.forecast;
    expect(forecastView(db, l)).toBeUndefined();
  });

  test('без истины: у двух заводов, различающихся только истинными полями, вид один', () => {
    const c = structuredClone(s);
    const bump = (t: object | undefined) => {
      const r = t as Record<string, number> | undefined;
      if (r) for (const k of Object.keys(r)) r[k] += 1;
    };
    for (const lot of Object.values(c.lots)) bump(lot.truth);
    for (const b of Object.values(c.batches)) bump(b.truth);
    expect(forecastView(db, c)).toEqual(forecastView(db, s));
    expect(fcMeeting(db, c, s.t + HOUR)).toEqual(fcMeeting(db, s, s.t + HOUR));
  });
});

describe('планёрка', () => {
  test('в первые сутки после закрытия месяца: заказано в нём и прогнозы на него; прогноз нынешнего — у обоих', () => {
    const x = fcMeeting(db, s, s.t + HOUR)!;
    const lag = f.lag.find(r => r.m === NOV - 1)!;
    expect(x).toEqual({
      m: NOV - 1,
      fact: sum(skus.map(k => f.demand[k][NOV - 1 - f.from])),
      plan: sum(skus.map(k => lag.plan[k])),
      sales: sum(skus.map(k => lag.sales[k])),
      next: { m: NOV, plan: sum(skus.map(k => f.plan[k][0])), sales: sum(skus.map(k => f.sales[k][0])) },
    });
    // вторые сутки месяца — блока нет
    expect(fcMeeting(db, s, s.t + DAY + HOUR)).toBeUndefined();
    // планёрка 1 ноября — с блоком
    expect(morningView(db, s, { view: 'morning', day: momentOf(s.start, s.t).day }).forecast).toEqual(x);
  });

  test('прогноза на закрытый месяц завод не делал — в месяц старта и в первую планёрку игры — блока нет', () => {
    const g = newPlant(db, { scenario: SC });
    expect(fcMeeting(db, g, g.t + HOUR)).toBeUndefined();
    expect(morningView(db, g, { view: 'morning', day: momentOf(g.start, g.t).day }).forecast).toBeUndefined();
  });
});

describe('график', () => {
  test('шкала — круглые деления от нуля до верха не ниже наибольшего числа', () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(1000)).toEqual([0, 500, 1000]);
    expect(niceTicks(1234)).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(95)).toEqual([0, 50, 100]);
    for (const max of [7, 95, 1000, 1234, 4500, 9999]) {
      const t = niceTicks(max);
      expect(t[0]).toBe(0);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(max);
      expect(t.length).toBeLessThanOrEqual(6);
      const step = t[1] - t[0];
      const p = 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5, 10]).toContain(Math.round(step / p));
    }
  });

  test('ряд без числа — разрыв линии; прошлое и вперёд — по месяцам подряд', () => {
    const past = [{ m: 1, fact: 10 }, { m: 2, fact: 12, plan: 11 }, { m: 3, fact: 9, plan: 10 }, { m: 4, fact: 8 }];
    const ahead = [{ m: 5, plan: 9, sales: 11 }, { m: 6, plan: 9, sales: 12 }];
    const g = fcGeom(past, ahead);
    expect(g.n).toBe(6);
    expect(g.split).toBe(4);
    expect(runs(g, 'plan', 0, g.split).length).toBe(1);
    expect(runs(g, 'plan', 0, g.n).length).toBe(2);
    expect(runs(g, 'sales', 0, g.split)).toEqual([]);
    expect(g.y(0)).toBeGreaterThan(g.y(12));
    expect(g.x(1)).toBeGreaterThan(g.x(0));
  });

  test('прогноз к факту — со знаком: выше факта — плюс', () => {
    expect(overFact(4640, 4120)).toBe(1262);
    expect(overFact(4010, 4120)).toBe(-267);
    expect(overFact(5, 0)).toBe(0);
  });
});
