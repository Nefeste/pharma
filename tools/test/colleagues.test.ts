// Б2в: коллеги планирования и снабжения (src/engine/planner.ts, src/engine/supply.ts). Задание — на тот же день через две
// недели: пока спроса не видно — позиции по очереди, дальше — той, которой хватит меньше всего; на занятый день и в
// выходной — ничего. Снабжение — в 09:00 рабочего дня: всё, что ниже точки заказа, у одобренного поставщика одним заказом,
// не больше половины зоны карантина. Год завода прототипа: серии каждую неделю, заказы закрываются в свой день, материал
// не ждёт, люди на смене заняты, инварианты — каждые сутки.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR, isWorkday, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { BATCH_HOUR } from '../../src/engine/mes';
import { AHEAD, casesOf, positionOf } from '../../src/engine/planner';
import { planOf } from '../../src/engine/plant';
import { takesAt } from '../../src/engine/staff';
import { planUse, SUPPLY_HOUR, supplyPosition } from '../../src/engine/supply';
import type { PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const N20 = 'sku.paracetamol500.n20';
const N10 = 'sku.paracetamol500.n10';
const L10 = 'sku.loratadine10.n10';
const RCP = 'rcp.paracetamol500.wet.v1';
const sc = db.scenarios[SC];
const plan = planOf(db, sc.plant);
const dayOf = (s: PlantState, t = s.t) => momentOf(s.start, t).day;

/** Дожить до `sec` часов суток `day` от начала партии. */
function until(s: PlantState, day: number, sec: number) {
  const t = Math.floor(s.t / DAY) * DAY + day * DAY + sec;
  apply(db, s, { kind: 'advance', seconds: t - s.t });
}

describe('коллега планирования', () => {
  test('положение позиции на старте — серии сценария по номиналу; спроса ещё не видно', () => {
    const s = newPlant(db, { scenario: SC });
    const per = casesOf(db.recipes[RCP], db.skus[N20]);
    const n20 = sc.batches.filter(b => b.sku === N20).length;
    expect(positionOf(db, s, N20, 28)).toEqual({ sku: N20, cases: n20 * per, ordered: 0, span: 0 });
  });

  test('пока спроса не видно — позиции по очереди, на тот же день через две недели, в начале смены аппаратчиков', () => {
    const s = newPlant(db, { scenario: SC });
    const before = Object.keys(s.batches).length;
    until(s, 1, BATCH_HOUR);
    const added = Object.values(s.batches).slice(before);
    expect(added).toHaveLength(1);
    const b = added[0];
    expect(b.by).toBe('head:plan');
    expect(b.notBefore).toBe(s.t + AHEAD * DAY);
    // последние задания сценария по позициям: №10 парацетамола — шестое, №10 лоратадина — седьмое, дальше №30 и №20:
    // очередь — от самого давнего
    expect(b.sku).toBe(N10);
    until(s, 1, BATCH_HOUR);
    expect(Object.values(s.batches).at(-1)!.sku).toBe(L10);
  });

  test('в выходной и на день, где задание уже есть, — ничего', () => {
    const s = newPlant(db, { scenario: SC });
    until(s, 2, BATCH_HOUR);
    const n = Object.keys(s.batches).length;
    // суббота и воскресенье — не рабочие
    until(s, 1, BATCH_HOUR);
    until(s, 1, BATCH_HOUR);
    expect(isWorkday(dayOf(s))).toBe(false);
    expect(Object.keys(s.batches)).toHaveLength(n);
    // понедельник: на день через две недели игрок уже сдвинул задание — коллега его не дублирует
    const target = Math.floor(s.t / DAY) * DAY + DAY + AHEAD * DAY + BATCH_HOUR;
    const mine = Object.values(s.batches).find(b => b.status === 'waiting' || b.status === 'reserved')!;
    apply(db, s, { kind: 'shift', batch: mine.id, notBefore: target, by: 'player' });
    until(s, 1, BATCH_HOUR);
    expect(Object.keys(s.batches)).toHaveLength(n);
  });

  test('спрос виден — серия позиции, которой хватит меньше всего; хватает обеим — задания нет', () => {
    // правило без кампаний (Б2в): каждый раз — позиция, которой хватит меньше всего
    const sc0 = structuredClone(db);
    delete sc0.scenarios[SC].plan!.urgent;
    const s = newPlant(sc0, { scenario: SC });
    const pass = (sec: number) => apply(sc0, s, { kind: 'advance', seconds: Math.floor(s.t / DAY) * DAY + 20 * DAY + sec - s.t });
    pass(BATCH_HOUR - HOUR);
    const pos = sc.plan!.items.map(it => positionOf(sc0, s, it.sku, sc.plan!.window));
    expect(pos.every(p => p.span > 0)).toBe(true);
    const need = pos.filter(p => p.cases * p.span < p.ordered * (AHEAD + sc.plan!.cover) * DAY);
    const before = Object.keys(s.batches).length;
    apply(sc0, s, { kind: 'advance', seconds: HOUR });
    const added = Object.values(s.batches).slice(before);
    if (!isWorkday(dayOf(s)) || need.length === 0) expect(added).toHaveLength(0);
    else {
      const days = (p: (typeof pos)[number]) => p.cases / p.ordered;
      const want = need.reduce((a, b) => (days(b) < days(a) ? b : a)).sku;
      expect(added.map(b => b.sku)).toEqual([want]);
    }
  });

  test('кампании: продукт последнего задания идёт дальше, пока его позициям нужна серия, а другому продукту не срочно', () => {
    // Б2г: за 120 суток каждое задание коллеги — по правилу кампаний; правило проверено в обе стороны: кампания шла,
    // хотя меньше всего хватало позиции другого продукта, и кампанию прервала срочная позиция другого продукта
    const s = newPlant(db, { scenario: SC });
    const p = sc.plan!;
    const productOf = (sku: string) => db.recipes[p.items.find(it => it.sku === sku)!.recipe].product;
    const seen = { kept: 0, hurried: 0, checked: 0 };
    const end = s.t + 120 * DAY;
    while (s.t < end) {
      // секунда до задания коллеги
      until(s, s.t % DAY < BATCH_HOUR ? 0 : 1, BATCH_HOUR - 1);
      const at = s.t + 1 + AHEAD * DAY;
      const pos = p.items.map(it => positionOf(db, s, it.sku, p.window));
      const busy = Object.values(s.batches).some(b => dayOf(s, b.notBefore) === dayOf(s, at));
      const before = Object.keys(s.batches).length;
      apply(db, s, { kind: 'advance', seconds: 1 });
      const added = Object.values(s.batches).slice(before);
      if (!isWorkday(dayOf(s)) || busy || pos.some(x => x.span === 0)) continue;
      seen.checked++;
      const need = pos.filter(x => x.cases * x.span < x.ordered * (AHEAD + p.cover) * DAY);
      if (need.length === 0) {
        expect(added).toHaveLength(0);
        continue;
      }
      const days = (x: (typeof pos)[number]) => x.cases / x.ordered;
      const neediest = (xs: typeof pos) => xs.reduce((a, b) => (days(b) < days(a) ? b : a)).sku;
      // продукт кампании — у задания, которое пойдёт последним перед новым
      const prev = Object.values(s.batches)
        .filter(b => b.notBefore < at && !added.includes(b))
        .sort((a, b) => a.notBefore - b.notBefore || Number(a.id.slice(1)) - Number(b.id.slice(1)))
        .at(-1)!;
      const mine = need.filter(x => productOf(x.sku) === prev.product);
      const hurry = need.some(x => productOf(x.sku) !== prev.product && x.cases * x.span < x.ordered * (AHEAD + p.urgent!) * DAY);
      const want = mine.length > 0 && !hurry ? neediest(mine) : neediest(need);
      expect(added.map(b => b.sku)).toEqual([want]);
      if (mine.length > 0 && !hurry && productOf(neediest(need)) !== prev.product) seen.kept++;
      if (mine.length > 0 && hurry && productOf(want) !== prev.product) seen.hurried++;
    }
    expect(seen.checked).toBeGreaterThan(50);
    expect(seen.kept).toBeGreaterThan(0);
    expect(seen.hurried).toBeGreaterThan(0);
  }, 60_000);
});

describe('коллега снабжения', () => {
  test('в 09:00 рабочего дня — всё, что ниже точки заказа, у одобренного поставщика одним заказом, не больше половины карантина', () => {
    const s = newPlant(db, { scenario: SC });
    until(s, 0, SUPPLY_HOUR - HOUR);
    const per = planUse(db, s, 1000);
    const below = new Set<string>();
    for (const [m, use] of per) {
      const sup = Object.values(db.suppliers).find(x => x.approved && x.items[m])!;
      if (supplyPosition(db, s, m) < Math.ceil((use * (sup.lead[1] + sc.supply!.qc + sc.supply!.safety)) / 1000)) below.add(m);
    }
    expect(below.size).toBeGreaterThan(0);
    until(s, 0, SUPPLY_HOUR);
    const pos = Object.values(s.pos);
    expect(pos.every(p => p.by === 'head:supply')).toBe(true);
    // поставщик — один заказ; в заказе — только материалы ниже точки, а не попавший в заказ — тот, чьей наименьшей партии
    // уже нет места в половине карантина
    expect(new Set(pos.map(p => p.supplier)).size).toBe(pos.length);
    const ordered = new Set(pos.flatMap(p => p.lines.map(l => l.material)));
    for (const m of ordered) expect(below.has(m)).toBe(true);
    const room = Math.floor(plan.byKind.quarantine.length / 2);
    const palletsOf = (m: string, qty: number) => {
      const c = db.containers[db.materials[m].container];
      return Math.ceil(qty / (c.capacity * c.perPallet));
    };
    for (const p of pos) {
      const pallets = p.lines.reduce((n, l) => n + palletsOf(l.material, l.qty), 0);
      expect(pallets).toBeLessThanOrEqual(room);
      for (const l of p.lines) expect(l.qty).toBeGreaterThanOrEqual(db.suppliers[p.supplier].items[l.material].moq);
    }
    for (const m of below) {
      if (ordered.has(m)) continue;
      const sup = Object.values(db.suppliers).find(x => x.approved && x.items[m])!;
      const p = pos.find(x => x.supplier === sup.id)!;
      const taken = p.lines.reduce((n, l) => n + palletsOf(l.material, l.qty), 0);
      expect([m, taken + palletsOf(m, sup.items[m].moq) > room]).toEqual([m, true]);
    }
    // заказанное — в пути и в положении: назавтра то же самое не заказывают, если запаса хватает
    until(s, 1, SUPPLY_HOUR);
    for (const p of Object.values(s.pos).slice(pos.length)) for (const l of p.lines) expect(supplyPosition(db, s, l.material)).toBeGreaterThan(0);
  });
});

describe('год завода прототипа', () => {
  test('серии каждую неделю, заказы закрываются в свой день, материал не ждёт, люди заняты, инварианты — каждые сутки', () => {
    const s = newPlant(db, { scenario: SC });
    const end = s.t + 365 * DAY;
    const busy: Record<string, number> = {};
    const shift: Record<string, number> = {};
    const bad: string[] = [];
    while (s.t < end) {
      apply(db, s, { kind: 'advance', seconds: HOUR });
      if (s.t > 30 * DAY)
        for (const p of Object.values(s.people)) {
          if (!takesAt(db, s.start, p.shift, s.t)) continue;
          shift[p.role] = (shift[p.role] ?? 0) + 1;
          if (p.task) busy[p.role] = (busy[p.role] ?? 0) + 1;
        }
      if (s.t % DAY !== 0) continue;
      bad.push(...check(db, s));
      // заказ покупателя не висит открытым дольше суток после срока; задание на серию не ждёт материал дольше трёх суток
      for (const o of Object.values(s.orders)) if (o.status === 'open' && o.due < s.t - DAY) bad.push(`заказ ${o.id} открыт после срока`);
      for (const b of Object.values(s.batches)) if (b.status === 'waiting' && b.notBefore < s.t - 3 * DAY) bad.push(`задание ${b.id} ждёт материал`);
    }
    expect([...new Set(bad)].slice(0, 5)).toEqual([]);
    // с третьей недели — не меньше двух упакованных серий в неделю
    const weeks = new Map<number, number>();
    for (const b of Object.values(s.batches)) if (b.pack?.end !== undefined) weeks.set(Math.floor(b.pack.end / (7 * DAY)), (weeks.get(Math.floor(b.pack.end / (7 * DAY))) ?? 0) + 1);
    expect(Math.min(...Array.from({ length: 49 }, (_, i) => weeks.get(i + 2) ?? 0))).toBeGreaterThanOrEqual(2);
    // после пуска — недопоставок почти нет: за год больше девяти из десяти заказов — в срок полностью
    const orders = Object.values(s.orders).filter(o => o.status !== 'open');
    expect(orders.filter(o => o.status === 'shipped').length / orders.length).toBeGreaterThan(0.9);
    // аппаратчики и кладовщик на смене заняты задачами не меньше трети времени
    for (const r of ['role.operator', 'role.storekeeper']) expect([r, (busy[r] ?? 0) / shift[r] > 0.33]).toEqual([r, true]);
    // год загруженного завода — секунды счёта, а не пять по умолчанию
  }, 120_000);
});
