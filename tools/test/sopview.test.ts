// Б6г: вид окна S&OP и блок планёрки (src/sim/sop.ts). Открытое совещание — лучший план начальника, его цель — та же, что
// у совещания, «до лучшего плана» — 0; черновик — пересчёт, «до лучшего плана» — разность; утверждённый — с записью
// совещания; четыре блока на 6 месяцев: спрос, мощности с линией резерва и узким местом, запас по позициям с цветом и
// словом, касса на три месяца; люди под план; без истины — у двух заводов, различающихся только истинными полями, вид
// один; блок планёрки — в день совещания и после утверждения; дорогой вид не пересобирают на том же миге.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, daysFromCivil, HOUR, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { monthNo } from '../../src/engine/forecast';
import { SOP_COVERS, SOP_RES, SOP_ROLES } from '../../src/engine/plan/sop';
import type { PlantState } from '../../src/engine/types';
import { morningView } from '../../src/sim/report';
import { SOP_OVER, sopMeeting, sopView } from '../../src/sim/sop';
import { ViewDesk, type ViewQuery } from '../../src/sim/views';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const start = daysFromCivil(sc.start.date);
const at = (y: number, m: number, d: number, hour = 0) => (daysFromCivil({ y, m, d }) - start) * DAY + hour * HOUR;
const SEP = monthNo(2027, 9);
const PARA = 'prd.paracetamol500';
const LOR = 'prd.loratadine10';

/** Совещание 3 сентября 2027 года в 10:00 открыто: игрок на посту «Производство». */
const s: PlantState = newPlant(db, { scenario: SC });
apply(db, s, { kind: 'advance', seconds: at(2027, 9, 3, 9) - s.t });
apply(db, s, { kind: 'seat', seats: ['production'] });
apply(db, s, { kind: 'advance', seconds: HOUR });

describe('окно S&OP', () => {
  test('открытое совещание: лучший план начальника, цель — та же, что у совещания, «до лучшего плана» — 0', () => {
    const v = sopView(db, s, { view: 'sop' });
    expect(v.none).toBeUndefined();
    expect(v.from).toBe(SEP);
    expect(v.products).toEqual([PARA, LOR]);
    expect(v.covers).toEqual(SOP_COVERS);
    expect(v.shown).toBe('best');
    expect(v.open).toEqual({ at: at(2027, 9, 3, 10), best: s.sop!.open!.best, value: s.sop!.open!.value });
    expect(v.cover).toEqual(s.sop!.open!.best);
    expect(v.value).toBe(s.sop!.open!.value);
    expect(v.gap).toBe(0);
    // следующее совещание — в октябре
    expect(v.next).toBe(at(2027, 10, 5, 10));
  });

  test('четыре блока на 6 месяцев: спрос, мощности, запас, касса на 3 месяца; люди под план', () => {
    const v = sopView(db, s, { view: 'sop' });
    expect(v.demand.map(d => d.product)).toEqual([PARA, LOR]);
    for (const d of v.demand) for (const xs of [d.plan, d.sales, d.year, d.need, d.batches]) expect(xs.length).toBe(6);
    expect(v.res.map(r => r.res)).toEqual([...SOP_RES]);
    for (const r of v.res) {
      expect(r.load.length).toBe(6);
      for (let i = 0; i < 6; i++) expect(r.line[i]).toBeLessThanOrEqual(r.cap[i]);
    }
    expect(v.reserve).toEqual([3, 10]);
    expect(v.bottleneck.length).toBe(6);
    for (const [i, b] of v.bottleneck.entries()) {
      const r = v.res.find(x => x.res === b)!;
      for (const x of v.res) if (x.cap[i] > 0) expect(x.load[i] * r.cap[i]).toBeLessThanOrEqual(r.load[i] * x.cap[i]);
    }
    expect(v.stock.map(r => r.sku)).toEqual(sc.plan!.items.map(i => i.sku));
    for (const r of v.stock)
      r.days.forEach((d, i) => {
        if (r.short[i] > 0) expect(r.flag[i]).toBe('short');
        else if (d > SOP_OVER * 10) expect(['over', 'shelf']).toContain(r.flag[i]!);
      });
    expect(v.cash.months.length).toBe(3);
    expect(v.cash.months[0].start).toBe(s.cash.balance);
    expect(v.people.map(r => r.role)).toEqual([...SOP_ROLES]);
    for (const r of v.people) expect(r.have.every(x => x > 0)).toBe(true);
  });

  test('черновик — пересчёт: цели игрока, «до лучшего плана» — разность целей; чужой или неполный черновик — не в счёт', () => {
    const draft = { [PARA]: [42, 42, 42, 42, 42, 42], [LOR]: [7, 7, 7, 7, 7, 7] };
    const v = sopView(db, s, { view: 'sop', draft });
    expect(v.shown).toBe('draft');
    expect(v.cover).toEqual(draft);
    expect(v.gap).toBe(Math.max(0, s.sop!.open!.value - v.value));
    expect(v.value).not.toBe(s.sop!.open!.value);
    expect(v.over).toBeUndefined();
    // запас 28 суток ровно — цель выше лучшего: лучший не берёт резерв мощности, а этот план — берёт
    const flat28 = { [PARA]: Array(6).fill(28), [LOR]: Array(6).fill(28) };
    const w = sopView(db, s, { view: 'sop', draft: flat28 });
    expect(w.value).toBeGreaterThan(s.sop!.open!.value);
    expect(w.over).toBe(w.value - s.sop!.open!.value);
    expect(w.gap).toBe(0);
    const hplc = w.res.find(r => r.res === 'hplc')!;
    expect(hplc.load.some((x, i) => x > hplc.line[i])).toBe(true);
    expect(sopView(db, s, { view: 'sop', draft: { [PARA]: draft[PARA] } }).shown).toBe('best');
    expect(sopView(db, s, { view: 'sop', draft: { ...draft, [PARA]: [42, 42, 42, 42, 42, 40] } }).shown).toBe('best');
  });

  test('утверждённый план: совещания нет, показан утверждённый, «до лучшего плана» — с совещания', () => {
    const c = structuredClone(s);
    apply(db, c, { kind: 'sop', cover: { [PARA]: [28, 28, 28, 28, 28, 28], [LOR]: [21, 21, 21, 21, 21, 21] }, by: 'player' });
    const v = sopView(db, c, { view: 'sop' });
    expect(v.open).toBeUndefined();
    expect(v.shown).toBe('approved');
    expect(v.approved).toMatchObject({ by: 'player', from: SEP });
    expect(v.cover[PARA]).toEqual([28, 28, 28, 28, 28, 28]);
    expect(v.gap).toBe(Math.max(0, v.approved!.best - v.approved!.value));
  });

  test('до первого совещания — план по политике; у сценария без прогноза — совещания нет', () => {
    const p = newPlant(db, { scenario: SC });
    const v = sopView(db, p, { view: 'sop' });
    expect(v.shown).toBe('policy');
    expect(v.cover[PARA]).toEqual(Array(6).fill(v.policy));
    expect(v.next).toBe(at(2027, 9, 3, 10));
    delete p.forecast;
    expect(sopView(db, p, { view: 'sop' }).none).toBe(true);
  });

  test('без истины: у двух заводов, различающихся только истинными полями, вид один', () => {
    const c = structuredClone(s);
    const bump = (t: object | undefined) => {
      const r = t as Record<string, number> | undefined;
      if (r) for (const k of Object.keys(r)) if (typeof r[k] === 'number') r[k] += 1;
    };
    for (const lot of Object.values(c.lots)) bump(lot.truth);
    for (const b of Object.values(c.batches)) bump(b.truth);
    expect(sopView(db, c, { view: 'sop' })).toEqual(sopView(db, s, { view: 'sop' }));
  });
});

describe('планёрка', () => {
  test('в день совещания — его час; утверждён план за сутки — до какого месяца, запас первого месяца, «до лучшего плана»', () => {
    const p = newPlant(db, { scenario: SC });
    apply(db, p, { kind: 'advance', seconds: at(2027, 9, 3, 8) - p.t });
    const day = momentOf(p.start, p.t).day;
    expect(sopMeeting(db, p, at(2027, 9, 3, 8))).toEqual({ today: at(2027, 9, 3, 10) });
    expect(morningView(db, p, { view: 'morning', day }).sop).toEqual({ today: at(2027, 9, 3, 10) });
    // без мест — план утверждает коллега; на планёрке 4 сентября — итог
    apply(db, p, { kind: 'advance', seconds: at(2027, 9, 4, 8) - p.t });
    const x = sopMeeting(db, p, at(2027, 9, 4, 8))!;
    const plan = p.sop!.plans[0];
    expect(x.today).toBeUndefined();
    expect(x.plan).toEqual({ at: plan.at, from: SEP, to: SEP + 5, by: 'head:plan', cover: [PARA, LOR].map(product => ({ product, days: plan.cover[product][0] })), gap: 0 });
    // через сутки — блока нет
    expect(sopMeeting(db, p, at(2027, 9, 5, 8))).toBeUndefined();
  });
});

describe('сборка вида', () => {
  test('дорогой вид S&OP: на том же миге завода не пересобирают; команда или новый черновик — сразу', () => {
    const c = structuredClone(s);
    const desk = new ViewDesk(db);
    const q: ViewQuery = { id: 'sop', view: 'sop' };
    desk.set([q]);
    expect(desk.out(c, 0)!.map(x => x.id)).toEqual(['sop']);
    desk.set([q]);
    // тот же миг: вид тот же — не собирали
    expect(desk.out(c, 200)).toBeUndefined();
    // новый черновик — сразу
    desk.set([{ ...q, draft: { [PARA]: [42, 42, 42, 42, 42, 42], [LOR]: [7, 7, 7, 7, 7, 7] } }]);
    expect(desk.out(c, 300)!.map(x => x.id)).toEqual(['sop']);
  });
});
