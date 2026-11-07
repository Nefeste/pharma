// Б6в: прогноз продаж (src/engine/forecast.ts; docs/specs/2026-10-vertical-slice.md, «Б6в»; геймдизайн, §9.1, §10.1).
// Сезон спроса группы — × индекс месяца, среднее за год прежнее; история — 24 месяца тем же правилом своей ветвью зерна;
// пять способов на примерах — до ящика; «лучший» — по проверке на скользящем начале; запаздывание в месяц, WAPE и
// смещение; правка руками стоит вместо способа и уходит с месяцем; отдел продаж — сглаживание × 1,15 и запись журнала;
// «спрос — по прогнозу» — правило задания читает прогноз по дням; показатель отдела продаж; миграция схемы 40 → 41.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import { DAY, daysFromCivil, HOUR, isWorkday, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import * as F from '../../src/engine/forecast';
import { check } from '../../src/engine/invariants';
import { KPIS } from '../../src/engine/kpi';
import { positionOf } from '../../src/engine/planner';
import { POL, policyOf } from '../../src/engine/policies';
import { fromSave } from '../../src/engine/save';
import type { FcMethod } from '../../src/content/types';
import type { Command, ForecastState, Notice, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { buildDb } from '../content/load';
import { legacy } from './legacy';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const start = daysFromCivil(sc.start.date);
/** Мгновение завода — секунды от полуночи дня старта. */
const at = (y: number, m: number, d: number, hour = 0) => (daysFromCivil({ y, m, d }) - start) * DAY + hour * HOUR;
const SKUS = [...new Set(sc.plan!.items.map(i => i.sku))];
const N20 = 'sku.paracetamol500.n20';
const LOR = 'sku.loratadine10.n10';
const refusals = (n: Notice[]) => n.filter(x => x.kind === 'refused').map(x => [(x as Extract<Notice, { kind: 'refused' }>).why, (x as Extract<Notice, { kind: 'refused' }>).detail]);
const fc = (s: PlantState) => s.planning.forecast!;
const COLD = db.seasons['sea.cold'].months;

/** Завод игры на старте и он же 1 ноября 2027 года в 01:00 — после двух закрытых месяцев. */
const s0 = newPlant(db, { scenario: SC });
const nov = structuredClone(s0);
apply(db, nov, { kind: 'advance', seconds: at(2027, 11, 1, 1) - nov.t });
const SEP = F.monthNo(2027, 9);
const OCT = SEP + 1;
const NOV = SEP + 2;

describe('сезон спроса', () => {
  test('группа у каждого продукта плана; 12 индексов больше нуля, в сумме 1200', () => {
    for (const sku of SKUS) {
      const sea = db.seasons[db.products[db.skus[sku].product].season];
      expect(sea.months.length).toBe(12);
      expect(sea.months.every(x => x > 0)).toBe(true);
      expect(sea.months.reduce((a, b) => a + b, 0)).toBe(1200);
    }
    expect(F.seasonIndex(db, N20, F.monthNo(2028, 1))).toBe(125);
    expect(F.seasonIndex(db, LOR, F.monthNo(2028, 5))).toBe(135);
  });

  test('секунды спроса — × индекс месяца; за год — прежние до дня; у сценария без прогноза — просто секунды', () => {
    const a = at(2028, 1, 1);
    const b = at(2029, 1, 1);
    const year = F.seasonSec(db, s0, N20, a, b);
    // 31 × 125 + 28 × 125 + … = 36 445 «дней × индекс»: за год на 0,15 % меньше 366 дней високосного 2028 года без сезона
    expect(Math.abs(year / (b - a) - 1)).toBeLessThan(0.01);
    // январь — 125 % его секунд, середина января — июль: по месяцам
    expect(F.seasonSec(db, s0, N20, at(2028, 1, 1), at(2028, 2, 1))).toBe((31 * DAY * 125) / 100);
    expect(F.seasonSec(db, s0, N20, at(2028, 1, 31), at(2028, 2, 2))).toBe((DAY * 125) / 100 + (DAY * 125) / 100);
    expect(F.seasonSec(db, s0, LOR, at(2028, 4, 30, 12), at(2028, 5, 1, 12))).toBe((12 * HOUR * 110) / 100 + (12 * HOUR * 135) / 100);
    const l = newPlant(legacy, { scenario: SC });
    expect(l.planning.forecast).toBeUndefined();
    expect(F.seasonSec(legacy, l, N20, a, b)).toBe(b - a);
  });
});

describe('история спроса', () => {
  test('24 месяца до старта и часть месяца старта: ящики — пуассоновские со средним по записи покупателей и сезону', () => {
    const f = fc(s0);
    expect(f.from).toBe(SEP - 24);
    expect(f.at).toBe(SEP);
    for (const sku of SKUS) expect(f.demand[sku].length).toBe(25);
    // среднее за 24 месяца — по записи покупателей и индексам; пуассоновский разброс суммы — меньше 1 %
    for (const sku of SKUS) {
      const per = db.skus[sku].case.per;
      const perDay = sc.customers.reduce((a, c) => a + (db.customers[c].demand[sku] ?? 0), 0);
      let mean = 0;
      for (let n = f.from; n < SEP; n++) mean += (perDay * F.daysIn(n) * F.seasonIndex(db, sku, n)) / (100 * per);
      const got = f.demand[sku].slice(0, 24).reduce((a, b) => a + b, 0);
      expect(Math.abs(got / mean - 1)).toBeLessThan(0.04);
    }
    // сезон в истории: у парацетамола январи больше июлей, у лоратадина май больше января
    const of = (sku: string, m: number) => f.demand[sku].slice(0, 24).filter((_, k) => (f.from + k) % 12 === m - 1).reduce((a, b) => a + b, 0);
    expect(of(N20, 1)).toBeGreaterThan(1.3 * of(N20, 7));
    expect(of(LOR, 5)).toBeGreaterThan(1.4 * of(LOR, 1));
    // своя ветвь зерна у каждого покупателя и позиции; ветвей рынка история не берёт — заказы те же
    for (const c of sc.customers) for (const sku of SKUS) expect(s0.rng[`history/${c}/${sku}`]).toBeDefined();
    expect(Object.keys(s0.rng).filter(k => k.startsWith('market/'))).toEqual([]);
  });

  test('факт — заказано ящиков по месяцу заказа: спрос, а не отгрузка', () => {
    const f = fc(nov);
    for (const sku of SKUS) {
      for (const m of [SEP, OCT]) {
        const placed = Object.values(nov.orders)
          .filter(o => F.monthAt(nov, o.placed) === m)
          .reduce((a, o) => a + o.lines.filter(l => l.sku === sku).reduce((x, l) => x + l.cases, 0), 0);
        const before = m === SEP ? fc(s0).demand[sku][24] : 0;
        expect(f.demand[sku][m - f.from]).toBe(before + placed);
      }
    }
  });
});

describe('способы — на примерах', () => {
  const r = [10000, 20000, 10000];
  test('«скользящее среднее» — три последних месяца; «сглаживание» — α = 0,3', () => {
    expect(F.rates('ma', [5000, 10000, 20000, 10000], [], 0, 2)).toEqual([13333, 13333]);
    // ℓ = 10 000 → 0,3 × 20 000 + 0,7 × 10 000 = 13 000 → 0,3 × 10 000 + 0,7 × 13 000 = 12 100
    expect(F.rates('ses', r, [], 0, 3)).toEqual([12100, 12100, 12100]);
    expect(F.rates('ses', [], [], 0, 2)).toEqual([0, 0]);
  });

  test('«как прошлый год» — тот же месяц год назад, дальше года — снова последний год; без года — сглаживание', () => {
    const y = Array.from({ length: 24 }, (_, k) => 1000 * (k + 1));
    const out = F.rates('last-year', y, [], 0, 18);
    expect(out.slice(0, 12)).toEqual(y.slice(12, 24));
    expect(out.slice(12)).toEqual(y.slice(12, 18));
    expect(F.rates('last-year', r, [], 0, 2)).toEqual([12100, 12100]);
  });

  test('«с трендом» — Хольт с затуханием: α = 0,3, β = 0,1, φ = 0,9 — растёт и не дальше предела', () => {
    // ℓ, b: (1 000, 1 000) → (1 930, 903) → (2 820, 821) → (3 691, 752); прогноз — ℓ + (φ + … + φʰ) b
    const out = F.rates('holt', [1000, 2000, 3000, 4000], [], 0, 18);
    expect(out.slice(0, 3)).toEqual([3691 + 677, 3691 + 1286, 3691 + 1834]);
    for (let i = 1; i < 18; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
    // предел затухания — ℓ + b φ / (1 − φ) = 3 691 + 9 × 752
    expect(out[17]).toBeLessThan(3691 + 9 * 752);
    expect(F.rates('holt', [5000], [], 0, 2)).toEqual([5000, 5000]);
  });

  test('«с сезоном группы» — индексы месяцев по 2 × 12 и сглаживание позиции без сезона', () => {
    // три года группы по индексам «простуды и гриппа» — индексы до 1/10 000
    const from = F.monthNo(2025, 1);
    const g = Array.from({ length: 36 }, (_, k) => 10 * COLD[k % 12] * 100);
    const idx = F.groupIndex(g, from);
    idx.forEach((x, m) => expect(Math.abs(x - COLD[m] * 100)).toBeLessThanOrEqual(2));
    // позиция — половина группы: прогноз — её ровный уровень × индекс месяца
    const half = g.map(x => x / 2);
    const out = F.rates('group', half, g, from, 12);
    out.forEach((x, i) => expect(Math.abs(x - 5 * COLD[i] * 100)).toBeLessThanOrEqual(5));
    // меньше 13 месяцев группы — индексов нет: каждый 1
    expect(F.groupIndex(g.slice(0, 12), from)).toEqual(Array(12).fill(10000));
  });

  test('в ящиках — ставка за календарный день × дней месяца', () => {
    const f = fc(s0);
    // «как прошлый год» на сентябрь — ящики сентября год назад: в обоих 30 дней
    for (const sku of SKUS) expect(f.by['last-year'][sku][0]).toBe(f.demand[sku][12]);
    // февраль 2028 года — 29 дней, февраль 2027-го — 28: ящики — по ставке за день
    const k = F.monthNo(2028, 2) - SEP;
    const feb = f.demand[N20][F.monthNo(2027, 2) - f.from];
    expect(f.by['last-year'][N20][k]).toBe(Math.round((Math.round((feb * 1000) / 28) * 29) / 1000));
  });
});

describe('«лучший» — проверка на скользящем начале', () => {
  test('прогноз месяца t — по данным до t − 2, на второй месяц вперёд; WAPE за 12 месяцев; поровну — первый', () => {
    const f = fc(s0);
    const M = f.at;
    for (const m of F.METHODS) {
      const b = F.backtest(db, f, SKUS, m, M)!;
      let abs = 0;
      let fact = 0;
      for (const sku of SKUS) {
        for (let t = M - 12; t < M; t++) {
          const L = t - f.from;
          const data = f.demand[sku].slice(0, L - 1).map((c, k) => Math.round((c * 1000) / F.daysIn(f.from + k)));
          const g = Array(L - 1).fill(0);
          for (const x of SKUS) {
            if (db.products[db.skus[x].product].season !== db.products[db.skus[sku].product].season) continue;
            f.demand[x].slice(0, L - 1).forEach((c, k) => (g[k] += Math.round((c * 1000) / F.daysIn(f.from + k))));
          }
          const want = Math.max(0, Math.round((F.rates(m, data, g, f.from, 2)[1] * F.daysIn(t)) / 1000));
          abs += Math.abs(f.demand[sku][L] - want);
          fact += f.demand[sku][L];
        }
      }
      expect(b).toMatchObject({ abs, fact });
    }
    const w = (m: FcMethod) => {
      const b = F.backtest(db, f, SKUS, m, M)!;
      return Math.round((b.abs * 10000) / b.fact);
    };
    const best = F.METHODS.reduce((a, m) => (w(m) < w(a) ? m : a), F.METHODS[0]);
    expect(f.method).toBe(best);
    // сезон в спросе — у «лучшего» сезон: как прошлый год или с сезоном группы
    expect(['last-year', 'group']).toContain(f.method);
    // проверить нечем — сглаживание
    const short: ForecastState = { ...f, demand: Object.fromEntries(SKUS.map(x => [x, f.demand[x].slice(0, 10)])) };
    expect(F.bestMethod(db, short, SKUS, f.from + 10)).toBe('ses');
  });

  test('способ политики — он, а не «лучший»: прогноз планирования — сразу его ящики, с правками; запись с запаздыванием прежняя', () => {
    const c = structuredClone(s0);
    apply(db, c, { kind: 'forecast', sku: N20, m: SEP + 3, cases: 999 });
    apply(db, c, { kind: 'policy', policy: 'pol.plan.method', value: 'holt' });
    expect(fc(c).method).toBe('holt');
    for (const sku of SKUS) expect(fc(c).plan[sku]).toEqual(fc(c).by.holt[sku].map((x, i) => (sku === N20 && i === 3 ? 999 : x)));
    expect(fc(c).lag).toEqual(fc(s0).lag);
    apply(db, c, { kind: 'policy', policy: 'pol.plan.method', value: 'best' });
    expect(fc(c).method).toBe(fc(s0).method);
    F.runForecast(db, c, fc(c).at + 1, { lag: false, journal: false });
    apply(db, c, { kind: 'policy', policy: 'pol.plan.method', value: 'ma' });
    expect(fc(c).method).toBe('ma');
    expect(fc(c).plan[LOR]).toEqual(fc(c).by.ma[LOR]);
  });
});

describe('прогноз месяца', () => {
  test('на старте — первый прогноз: 18 месяцев каждым способом, запись с запаздыванием на следующий месяц, журнала нет', () => {
    const f = fc(s0);
    for (const m of F.METHODS) for (const sku of SKUS) expect(f.by[m][sku].length).toBe(18);
    for (const sku of SKUS) expect(f.plan[sku]).toEqual(f.by[f.method][sku]);
    expect(f.lag).toEqual([{ m: SEP + 1, plan: Object.fromEntries(SKUS.map(x => [x, f.plan[x][1]])), sales: Object.fromEntries(SKUS.map(x => [x, f.sales[x][1]])) }]);
    expect(s0.journal.filter(r => r.d.kind === 'forecast')).toEqual([]);
  });

  test('отдел продаж — сглаживание и +15 %; 1-го числа в 00:00 — запись начальника отдела продаж', () => {
    const f = fc(nov);
    expect(f.at).toBe(NOV);
    for (const sku of SKUS) expect(f.sales[sku]).toEqual(f.by.ses[sku].map(x => Math.round((x * 11500) / 10000)));
    const recs = nov.journal.filter(r => r.d.kind === 'forecast');
    expect(recs.map(r => [r.by, r.t, (r.d as { m: number }).m])).toEqual([
      ['sales', at(2027, 10, 1), OCT],
      ['sales', at(2027, 11, 1), NOV],
    ]);
    expect(recs[1].d).toEqual({ kind: 'forecast', m: NOV, cases: SKUS.reduce((a, x) => a + f.sales[x][0], 0), method: 'ses', optimism: 1500 });
  });

  test('запаздывание в месяц: на октябрь — прогноз 1 сентября, на ноябрь — 1 октября; хранятся 24 месяца', () => {
    const f = fc(nov);
    expect(f.lag.map(x => x.m)).toEqual([OCT, NOV, NOV + 1]);
    expect(f.lag[0]).toEqual(fc(s0).lag[0]);
    const c = structuredClone(nov);
    for (let k = 0; k < 30; k++) F.runForecast(db, c, NOV + 1 + k, { lag: true, journal: false });
    expect(fc(c).lag.length).toBe(F.LAG_KEEP);
    expect(fc(c).lag.at(-1)!.m).toBe(NOV + 31);
  });

  test('WAPE и смещение: модули ошибок и ошибки к факту; минус — прогноз выше факта; месяц не закрыт — не считается', () => {
    const c = structuredClone(nov);
    const f = fc(c);
    f.lag = [{ m: OCT, plan: { [N20]: 100, [LOR]: 50 }, sales: { [N20]: 130, [LOR]: 60 } }, { m: NOV, plan: { [N20]: 1 }, sales: { [N20]: 1 } }];
    f.demand[N20][OCT - f.from] = 110;
    f.demand[LOR][OCT - f.from] = 40;
    expect(F.lagError(c, 'plan', OCT, NOV)).toEqual({ abs: 20, err: 0, fact: 150 });
    expect(F.shares(F.lagError(c, 'plan', OCT, NOV))).toEqual({ wape: 1333, bias: 0 });
    expect(F.lagError(c, 'sales', OCT, NOV)).toEqual({ abs: 40, err: -40, fact: 150 });
    expect(F.shares(F.lagError(c, 'sales', OCT, NOV))).toEqual({ wape: 2667, bias: -2667 });
    expect(F.lagError(c, 'plan', OCT, NOV, [LOR])).toEqual({ abs: 10, err: -10, fact: 40 });
    // ноябрь идёт — его записи нет в точности
    expect(F.lagError(c, 'plan', OCT, NOV + 1)).toEqual({ abs: 20, err: 0, fact: 150 });
    expect(F.lagError(c, 'plan', NOV, NOV + 1)).toBeUndefined();
    expect(F.shares(undefined)).toBeUndefined();
    expect(F.shares({ abs: 0, err: 0, fact: 0 })).toBeUndefined();
  });

  test('показатель начальника отдела продаж — WAPE его прогноза за месяц с запаздыванием; противовес — OTIF', () => {
    expect(KPIS.find(k => k.id === 'fcErr')).toMatchObject({ head: 'sales', unit: 'share', dir: -1, win: 'm', pair: 'otif' });
    const m = nov.kpi.months.at(-1)!;
    expect([m.y, m.m]).toEqual([2027, 10]);
    expect(m.v.fcErr).toBe(F.shares(F.lagError(nov, 'sales', OCT, NOV))!.wape);
    // сентябрь — записи с запаздыванием нет
    expect(nov.kpi.months[0].v.fcErr).toBeUndefined();
  });
});

describe('правка руками', () => {
  const edit = (s: PlantState, x: Partial<Extract<Command, { kind: 'forecast' }>>) => apply(db, s, { kind: 'forecast', sku: N20, m: NOV + 1, ...x } as Command);

  test('ящики стоят вместо способа, пока их не снимут; запись «вы» с тем, что было по способу', () => {
    const c = structuredClone(nov);
    apply(db, c, { kind: 'seat', seats: ['production'] });
    const f = fc(c);
    const was = f.by[f.method][N20][1];
    expect(refusals(edit(c, { cases: 777 }))).toEqual([]);
    expect(f.plan[N20][1]).toBe(777);
    expect(f.edits).toEqual({ [N20]: { [NOV + 1]: 777 } });
    expect(c.journal.at(-1)).toMatchObject({ by: 'player', seat: 'production', d: { kind: 'fcEdit', sku: N20, m: NOV + 1, cases: 777, was } });
    // запись с запаздыванием прежняя: точность — по прогнозу 1-го числа
    expect(f.lag).toEqual(fc(nov).lag);
    expect(refusals(edit(c, {}))).toEqual([]);
    expect(f.plan[N20][1]).toBe(was);
    expect(f.edits).toEqual({});
    expect(c.journal.at(-1)).toMatchObject({ by: 'player', d: { kind: 'fcEdit', sku: N20, m: NOV + 1, was } });
    expect('cases' in c.journal.at(-1)!.d).toBe(false);
  });

  test('пост «Производство» или директор; отказы — прогноза нет, позиции нет, месяц не из прогноза, не ящики', () => {
    const c = structuredClone(nov);
    apply(db, c, { kind: 'seat', seats: ['quality'] });
    expect(refusals(edit(c, { cases: 5 }))).toEqual([['notYours', 'production']]);
    apply(db, c, { kind: 'seat', seats: ['director'] });
    expect(refusals(edit(c, { cases: 5 }))).toEqual([]);
    expect(refusals(edit(c, { sku: 'sku.nope', cases: 5 }))).toEqual([['noSku', 'sku.nope']]);
    expect(refusals(edit(c, { m: NOV - 1, cases: 5 }))).toEqual([['fcMonth', String(NOV - 1)]]);
    expect(refusals(edit(c, { m: NOV + 18, cases: 5 }))).toEqual([['fcMonth', String(NOV + 18)]]);
    expect(refusals(edit(c, { cases: -1 }))).toEqual([['fcCases', '-1']]);
    expect(refusals(edit(c, { cases: 1.5 }))).toEqual([['fcCases', '1.5']]);
    const l = newPlant(legacy, { scenario: SC });
    expect(refusals(apply(legacy, l, { kind: 'forecast', sku: N20, m: SEP, cases: 5 }))).toEqual([['noForecast', undefined]]);
  });

  test('месяц прошёл — правка ушла; правка будущего месяца стоит и в новом прогнозе', () => {
    const c = structuredClone(nov);
    edit(c, { m: NOV, cases: 11 });
    edit(c, { m: NOV + 2, cases: 22 });
    F.runForecast(db, c, NOV + 1, { lag: true, journal: false });
    const f = fc(c);
    expect(f.edits).toEqual({ [N20]: { [NOV + 2]: 22 } });
    expect(f.plan[N20][1]).toBe(22);
    expect(f.lag.at(-1)!.plan[N20]).toBe(22);
  });
});

describe('спрос для планирования', () => {
  test('«по заказам» — как до Б6в; «по прогнозу» — ящики прогноза на окно по дням месяцев и рабочие дни окна', () => {
    const c = structuredClone(nov);
    const byOrders = positionOf(db, c, N20, 28);
    apply(db, c, { kind: 'policy', policy: 'pol.plan.demand', value: 'forecast' });
    const p = positionOf(db, c, N20, 28);
    expect(p.cases).toBe(byOrders.cases);
    const f = fc(c);
    // 1 ноября 01:00 + 28 суток — весь ноябрь: 28/30 прогноза ноября; дальше — с декабрём
    expect(p.ordered).toBe(Math.round((f.plan[N20][0] * (28 * DAY)) / (30 * DAY)));
    const today = momentOf(c.start, c.t).day;
    let work = 0;
    for (let z = today; z < today + 28; z++) if (isWorkday(calOf(db, c), z)) work++;
    expect(p).toMatchObject({ sku: N20, span: 28 * DAY, work });
    const long = positionOf(db, c, N20, 45);
    const dec = (45 * DAY - (at(2027, 12, 1) - c.t)) / (31 * DAY);
    const novPart = (at(2027, 12, 1) - c.t) / (30 * DAY);
    expect(long.ordered).toBe(Math.round(f.plan[N20][0] * novPart + f.plan[N20][1] * dec));
    // правка руками — в спросе правила
    apply(db, c, { kind: 'forecast', sku: N20, m: NOV, cases: 3000 });
    expect(positionOf(db, c, N20, 28).ordered).toBe(Math.round((3000 * 28) / 30));
  });

  test('без сценария с прогнозом политик прогноза нет', () => {
    const l = newPlant(legacy, { scenario: SC });
    expect(refusals(apply(legacy, l, { kind: 'policy', policy: 'pol.plan.demand', value: 'forecast' }))).toEqual([['noPolicy', 'pol.plan.demand']]);
    expect(refusals(apply(legacy, l, { kind: 'policy', policy: 'pol.plan.method', value: 'holt' }))).toEqual([['noPolicy', 'pol.plan.method']]);
  });
});

describe('сохранение', () => {
  test('образец схемы 40: история — тем же правилом, факт — по заказам, прогноз — сразу, без записи журнала', () => {
    const s = fromSave(db, readFileSync(join(import.meta.dir, 'fixtures/save-v40.json'), 'utf8'));
    const f = fc(s);
    const fresh = fc(newPlant(db, { scenario: SC, seed: s.seed }));
    expect(f.from).toBe(fresh.from);
    for (const sku of SKUS) expect(f.demand[sku].slice(0, 24)).toEqual(fresh.demand[sku].slice(0, 24));
    // образец — 14 сентября: месяц старта — часть истории до старта и заказы с него
    const now = F.monthAt(s, s.t);
    expect(now).toBe(SEP);
    expect(f.at).toBe(now);
    expect(Object.keys(s.orders).length).toBeGreaterThan(0);
    for (const sku of SKUS) {
      const placed = Object.values(s.orders).reduce((a, o) => a + o.lines.filter(l => l.sku === sku).reduce((x, l) => x + l.cases, 0), 0);
      expect(f.demand[sku][SEP - f.from]).toBe(fresh.demand[sku][24] + placed);
    }
    expect(f.lag.map(x => x.m)).toEqual([now + 1]);
    expect(s.journal.filter(r => r.d.kind === 'forecast')).toEqual([]);
    expect(check(db, s)).toEqual([]);
    apply(db, s, { kind: 'advance', seconds: 2 * DAY });
    expect(check(db, s)).toEqual([]);
  }, 30_000);

  test('образец схемы 41: правка игрока и спрос «по прогнозу» — в сохранении; месяц прошёл — правки нет', () => {
    const s = fromSave(db, readFileSync(join(import.meta.dir, 'fixtures/save-v41.json'), 'utf8'));
    expect(F.monthAt(s, s.t)).toBe(NOV);
    expect(fc(s).edits[N20]?.[NOV]).toBeDefined();
    expect(policyOf(db, s, POL.demand)).toBe('forecast');
    expect(s.kpi.months.at(-1)!.v.fcErr).toBeDefined();
    expect(check(db, s)).toEqual([]);
    apply(db, s, { kind: 'advance', seconds: at(2027, 12, 1, 1) - s.t });
    expect(fc(s).at).toBe(NOV + 1);
    expect(fc(s).edits[N20]?.[NOV]).toBeUndefined();
    expect(s.journal.some(r => r.by === 'plan' && r.d.kind === 'order' && r.d.why?.fc)).toBe(true);
    expect(check(db, s)).toEqual([]);
  }, 60_000);
});

describe('сборщик базы — на испорченной копии content/', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  /** Копия content/ с правками: файл → что на что заменить. */
  function broken(edits: Record<string, [string, string][]>): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'pharma-content-'));
    dirs.push(dir);
    cpSync(join(import.meta.dir, '../../content'), dir, { recursive: true });
    for (const [file, e] of Object.entries(edits)) {
      const p = join(dir, file);
      let text = readFileSync(p, 'utf8');
      for (const [a, b] of e) {
        expect(text.includes(a)).toBe(true);
        text = text.replace(a, b);
      }
      writeFileSync(p, text);
    }
    return buildDb(dir).errors;
  }
  const has = (errs: string[], part: string) => expect([part, errs.some(e => e.includes(part))]).toEqual([part, true]);
  const MONTHS = 'months: [125, 125, 110, 95, 85, 80, 80, 85, 100, 105, 105, 105]';

  test('группа сезона: 12 индексов больше нуля, в сумме 1200; у продукта — группа, которая есть; варианты политик — из списка', () => {
    expect(broken({})).toEqual([]);
    has(broken({ 'seasons/cold.yaml': [[MONTHS, 'months: [125, 125, 110, 95, 85, 80, 80, 85, 100, 105, 210]']] }), 'seasons/cold.yaml: months');
    has(broken({ 'seasons/cold.yaml': [[MONTHS, 'months: [250, 125, 110, 95, 85, 80, 80, 85, 100, 105, 105, 0]']] }), 'seasons/cold.yaml: months');
    has(broken({ 'seasons/cold.yaml': [[MONTHS, 'months: [125, 125, 110, 95, 85, 80, 80, 85, 100, 105, 105, 106]']] }), 'вместе 1200');
    has(broken({ 'products/paracetamol500.yaml': [['season: sea.cold', 'season: sea.flu']] }), 'нет сезона спроса sea.flu');
    has(broken({ 'products/paracetamol500.yaml': [['season: sea.cold\n', '']] }), 'products/paracetamol500.yaml: season');
    has(broken({ 'policies/plan/method.yaml': [['options: [best, last-year, ma, ses, holt, group]', 'options: [best, last-year, ma, ses, holt]']] }), 'политика pol.plan.method: варианты правила');
    has(broken({ 'scenarios/proto.yaml': [['  method: best', '  method: arima']] }), 'scenarios/proto.yaml: plan.method');
  });
});
