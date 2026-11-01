// Б5ж: показатели руководителей (src/engine/kpi.ts). Показатель — функция записей завода за период; закрытый месяц —
// то же, что пересчёт этой функцией по записям, и не меняется, когда позже решают серию прошлого месяца; у двух заводов,
// которые различаются только полями истины, показатели одни; средние остатков — сумма срезов в полночь на число срезов;
// кВт·ч месяца касса снимает до того, как обнулит счётчик; образец схемы 32 читается — месяцев нет, текущий с минуты
// загрузки и «неполный»; образец схемы 33 — как есть. Новые записи: у партии — у рампы и на месте, в журнале
// оборудования — когда слесарь взял работу, у принятого — день открытия вакансии. Множители OEE — только определённые:
// без времени работы эффективности нет, без выпуска — качества.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { db } from '../../src/content';
import { part } from '../../src/engine/cash';
import { DAY, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { currentPeriod, decidedAt, emptySnap, KPI, KPIS, kpiSnapshot, kpiValues, monthPeriod, monthStart, oeeOf, oeePartsOf } from '../../src/engine/kpi';
import { planOf } from '../../src/engine/plant';
import { runSeed } from '../../src/engine/plan/run';
import { fromSave } from '../../src/engine/save';
import type { DayLoss, KpiSnap, PlantState } from '../../src/engine/types';
import { sourceKeys } from '../content/load';

const SC = 'scn.proto';
const sample = (n: number) => readFileSync(new URL(`./fixtures/save-v${n}.json`, import.meta.url), 'utf8');

/** Партия: 125 суток посуточно; после каждого закрытия месяца — пересчёт, энергия и срезы своим кодом. */
const s: PlantState = newPlant(db, { scenario: SC });
const t0 = s.t;
const recomputed: { y: number; m: number; same: boolean; bill: boolean }[] = [];
const snaps: Omit<KpiSnap, 'n' | 'peak'>[] = [];
let undecided: string[] = [];
let sept: Record<string, number> = {};
for (let d = 0; d < 125; d++) {
  // последняя полночь перед этой — срез своим кодом в те же мгновения, что у движка (после учёта часа)
  const before = s.kpi.months.length;
  apply(db, s, { kind: 'advance', seconds: DAY });
  if (s.kpi.months.length > before) {
    const mo = s.kpi.months.at(-1)!;
    const sc = db.scenarios[SC];
    const net = Math.floor((mo.wh * sc.energy.price) / 1000);
    const pr = db.profiles[sc.profile];
    recomputed.push({ y: mo.y, m: mo.m, same: JSON.stringify(kpiValues(db, s, monthPeriod(s, mo))) === JSON.stringify(mo.v), bill: s.cash.energy.last === net + part(net, pr.vat.general) });
    if (s.kpi.months.length === 1) {
      undecided = Object.values(s.batches)
        .filter(b => b.records.length > 0 && decidedAt(s, b) === undefined)
        .map(b => b.id);
      sept = mo.v;
    }
  }
}

describe('закрытые месяцы', () => {
  test('за 125 суток — сентябрь, октябрь, ноябрь и декабрь подряд, полные, без разрывов', () => {
    expect(s.kpi.months.map(m => `${m.y}-${m.m}`)).toEqual(['2027-9', '2027-10', '2027-11', '2027-12']);
    expect(s.kpi.months.some(m => m.part)).toBe(false);
    expect(s.kpi.months[0].from).toBe(t0);
    for (let i = 1; i < s.kpi.months.length; i++) expect(s.kpi.months[i].from).toBe(s.kpi.months[i - 1].to);
    expect(s.kpi.from).toBe(s.kpi.months.at(-1)!.to);
    for (const m of s.kpi.months) expect(m.to).toBe(monthStart(s, m.to));
  });

  test('итог месяца — тот же, что пересчёт той же функцией по записям сразу после закрытия', () => {
    expect(recomputed.length).toBe(4);
    for (const r of recomputed) expect(r).toMatchObject({ same: true });
  });

  test('кВт·ч месяца — те, по которым касса выставила счёт: сняты до того, как она обнулила счётчик', () => {
    for (const r of recomputed) expect(r).toMatchObject({ bill: true });
    for (const m of s.kpi.months) expect(m.wh).toBeGreaterThan(0);
  });

  test('серия сентября, решённая позже, в сентябрь не попадает: пересчёт сентября — тот же', () => {
    expect(undecided.length).toBeGreaterThan(0);
    const later = undecided.filter(id => (decidedAt(s, s.batches[id]) ?? 0) > s.kpi.months[0].to);
    expect(later.length).toBeGreaterThan(0);
    expect(kpiValues(db, s, monthPeriod(s, s.kpi.months[0]))).toEqual(sept);
    expect(s.kpi.months[0].v).toEqual(sept);
  });

  test('у каждого показателя — значение хотя бы в одном месяце; определения — с руководителем, единицей и направлением', () => {
    for (const k of KPIS) {
      expect(s.kpi.months.some(m => m.v[k.id] !== undefined)).toBe(true);
      expect([1, -1]).toContain(k.dir);
      if (k.pair) expect(KPI[k.pair]).toBeDefined();
    }
    expect(new Set(KPIS.map(k => k.id)).size).toBe(KPIS.length);
  });

  test('ключи источников показателей — из таблицы источников docs/10-domain.md, §9; без ключа — определение наше', () => {
    const known = sourceKeys();
    expect(known.size).toBeGreaterThan(50);
    for (const k of KPIS) for (const key of k.src) expect(known.has(key) ? key : `${k.id}: ${key}`).toBe(key);
    // у каждого из двенадцати руководителей — показатели
    expect(new Set(KPIS.map(k => k.head)).size).toBe(12);
  });

  test('инварианты в конце — без нарушений', () => {
    expect(check(db, s)).toEqual([]);
  });
});

describe('срез суток', () => {
  test('средние остатков — сумма срезов в полночь на число срезов: суммы месяца — сумма срезов своим кодом', () => {
    const c: PlantState = structuredClone(s);
    const day0 = momentOf(c.start, c.t).date;
    // в полночь каждых следующих трёх суток — срез своим кодом, сразу после хода движка
    const sum = structuredClone(c.kpi.snap);
    for (let i = 0; i < 3; i++) {
      const left = DAY - momentOf(c.start, c.t).sec;
      apply(db, c, { kind: 'advance', seconds: left });
      const x = kpiSnapshot(db, c);
      snaps.push(x);
      sum.n++;
      for (const k of ['stock', 'shelf', 'fg', 'recv', 'pay', 'slots', 'places', 'noAdm', 'people'] as const) sum[k] += x[k];
      sum.peak = Math.max(sum.peak, x.slots);
      sum.ot = Math.max(sum.ot, x.ot);
    }
    expect(day0.m).toBe(momentOf(c.start, c.t).date.m);
    expect(c.kpi.snap).toEqual(sum);
    expect(c.kpi.snap.n).toBe(momentOf(c.start, c.t).date.d);
    const v = kpiValues(db, c, currentPeriod(db, c));
    expect(v.occupancy).toBe(Math.round((sum.slots * 10000) / sum.places));
    expect(snaps.every(x => x.places > 0 && x.people > 0 && x.stock > 0)).toBe(true);
  });

  test('пустой срез — нули', () => {
    expect(Object.values(emptySnap()).every(x => x === 0)).toBe(true);
  });
});

describe('множители OEE', () => {
  test('только определённые: линия налаживалась — доступность 0, а эффективности и качества нет; без выпуска нет качества', () => {
    const p = newPlant(db, { scenario: SC });
    const line = planOf(db, p.plant).plant.lines[0].id;
    const n = p.lines[line].machines.length;
    const day = (ideal: number, run: number, out: number, good: number) =>
      ({ day: 0, lines: { [line]: { times: Array.from({ length: n }, () => ({ out })), ideal: Array(n).fill(ideal), run: Array(n).fill(run), good } } }) as unknown as DayLoss;
    expect(oeePartsOf(db, p, [day(1000, 0, 0, 0)])).toEqual([{ a: 0 }]);
    expect(oeeOf(db, p, [day(1000, 0, 0, 0)])[0]?.oee).toBe(0);
    expect(oeePartsOf(db, p, [day(1000, 500, 0, 0)])).toEqual([{ a: 5000, p: 0 }]);
    expect(oeePartsOf(db, p, [day(1000, 500, 400, 300)])).toEqual([{ a: 5000, p: 8000, q: 7500 }]);
    expect(oeePartsOf(db, p, [])).toEqual([undefined]);
  });
});

describe('без истины', () => {
  test('два завода с разными истинными свойствами партий и серий и запасом узлов — одни показатели', () => {
    const b: PlantState = structuredClone(s);
    for (const lot of Object.values(b.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
    for (const bt of Object.values(b.batches)) {
      for (const k of Object.keys(bt.truth) as (keyof typeof bt.truth)[]) bt.truth[k] = (bt.truth[k] ?? 0) + 777;
      bt.causes = [];
    }
    for (const p of Object.values(b.parts)) p.budget += 12345;
    expect(kpiValues(db, b, currentPeriod(db, b))).toEqual(kpiValues(db, s, currentPeriod(db, s)));
    for (const m of s.kpi.months) expect(kpiValues(db, b, monthPeriod(b, m))).toEqual(m.v);
  });
});

describe('новые записи', () => {
  test('у купленной партии — у рампы и на месте, не раньше прихода; у запаса старта и своей продукции — нет', () => {
    const lots = Object.values(s.lots);
    const placed = lots.filter(l => l.placed !== undefined);
    expect(placed.length).toBeGreaterThan(10);
    for (const l of placed) {
      expect(l.docked).toBeDefined();
      expect(l.docked!).toBeGreaterThanOrEqual(l.received);
      expect(l.placed!).toBeGreaterThan(l.docked!);
    }
    for (const l of lots) if (l.supplier === 'start' || l.batch !== undefined) expect(l.docked).toBeUndefined();
  });

  test('у ремонтов и замен журнала оборудования — когда слесарь взял работу', () => {
    const works = s.maintLog.filter(e => e.what !== 'failure');
    expect(works.length).toBeGreaterThan(0);
    for (const e of works) {
      expect(e.from).toBeDefined();
      expect(e.from!).toBeLessThan(e.t);
    }
    // запчасть ждали — только ремонт после отказа
    for (const e of s.maintLog) if (e.spare) expect(e.what).toBe('repair');
  });

  test('у принятого — день открытия вакансии, не позже первого дня', () => {
    const hired = [...Object.values(s.people), ...Object.values(s.former)].filter(p => p.cand !== undefined);
    expect(hired.length).toBeGreaterThan(0);
    for (const p of hired) {
      expect(p.vac).toBeDefined();
      expect(p.vac!).toBeLessThanOrEqual(p.hired!);
    }
  });
});

describe('сохранения и прогон плана', () => {
  test('образец схемы 32 читается: месяцев нет, учёт — с мгновения загрузки; закрытый первым месяц — «неполный»', () => {
    const v = fromSave(db, sample(32));
    expect(v.kpi.months).toEqual([]);
    expect(v.kpi.from).toBe(v.t);
    expect(v.kpi.snap).toEqual(emptySnap());
    expect(v.t - monthStart(v, v.t)).toBeGreaterThanOrEqual(DAY);
    apply(db, v, { kind: 'advance', seconds: monthStart(v, v.t, 1) - v.t + 3600 });
    expect(v.kpi.months.length).toBe(1);
    expect(v.kpi.months[0].part).toBe(true);
    expect(v.kpi.months[0].from).not.toBe(monthStart(v, v.kpi.months[0].from));
    expect(check(db, v)).toEqual([]);
  });

  test('образец схемы 33 — как есть: закрытые месяцы на месте, срезы идут дальше', () => {
    const v = fromSave(db, sample(33));
    const months = v.kpi.months.length;
    const n = v.kpi.snap.n;
    expect(months).toBeGreaterThanOrEqual(2);
    apply(db, v, { kind: 'advance', seconds: DAY });
    expect(v.kpi.months.length + v.kpi.snap.n).toBeGreaterThan(months + n - 1);
    expect(check(db, v)).toEqual([]);
  });

  test('копия прогона плана — без закрытых месяцев', () => {
    const c = runSeed(db, s, [], { days: 2, seeds: 1 }, 0);
    expect(c.kpi.months).toEqual([]);
    expect(s.kpi.months.length).toBe(4);
  });
});
