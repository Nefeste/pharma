// Б6д: потребность в материалах (src/engine/plan/mrp.ts, src/engine/supply.ts; docs/specs/2026-10-vertical-slice.md,
// «Б6д»; геймдизайн, §9.3). Валовая — состав карты и упаковка серий прогона плана S&OP и заданий, которые уже стоят;
// доступное — через входной контроль; необеспеченная по месяцам на примере; плановый заказ — тара, наименьшая партия и
// дата заказа по рабочим дням; срок завоза 25 и 0; правило «по потребности» заказывает в день даты заказа, «советует» —
// предложение; сообщения; «Ускорить» и «Отменить» — приход, доплата, неустойка и предоплата в кассе; полей истины нет;
// образец схемы 42; сборщик базы.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import { part } from '../../src/engine/cash';
import { civilFromDays, DAY, daysFromCivil, HOUR, isWorkday, momentOf, workdayOnOrAfter } from '../../src/engine/core/calendar';
import { inForce } from '../../src/engine/docs';
import { apply, newPlant } from '../../src/engine/engine';
import { firstDay, monthOfDay } from '../../src/engine/forecast';
import { check } from '../../src/engine/invariants';
import { cmdHead } from '../../src/engine/memos';
import { packNeeds } from '../../src/engine/mes';
import { MRP_MONTHS, MRP_SOON, mrpPlan } from '../../src/engine/plan/mrp';
import { sopCtx, sopRun, type SopTrace } from '../../src/engine/plan/sop';
import { POL } from '../../src/engine/policies';
import { fromSave } from '../../src/engine/save';
import { sopCover } from '../../src/engine/sop';
import { containersByLot } from '../../src/engine/stock';
import { CANCEL_SHARE, FAST_DAYS, FAST_SHARE, howOf, needPlan, SUPPLY_HOUR, supplyDay } from '../../src/engine/supply';
import type { Notice, PackJob, PlantState, Po } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { buildDb } from '../content/load';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const QC = sc.supply!.qc;
const start = daysFromCivil(sc.start.date);
/** Мгновение завода — секунды от полуночи дня старта. */
const at = (y: number, m: number, d: number, hour = 0) => (daysFromCivil({ y, m, d }) - start) * DAY + hour * HOUR;
const API = 'mat.api.paracetamol';
const LOR = 'mat.api.loratadine';
const N10 = 'mat.pk.carton-n10';
const refusals = (n: readonly Notice[]) => n.filter(x => x.kind === 'refused').map(x => (x as Extract<Notice, { kind: 'refused' }>).why);
const today = (s: PlantState) => momentOf(s.start, s.t).day;

/** Дожить до мгновения `t`, не трогая его событий: правило снабжения зовут само. */
function upTo(s: PlantState, t: number) {
  apply(db, s, { kind: 'advance', seconds: t - 1 - s.t });
  s.t = t;
}

const s0 = newPlant(db, { scenario: SC });
/** Первый рабочий день, 09:00 — мгновение правила снабжения: заказов ещё нет. */
const d1 = structuredClone(s0);
upTo(d1, at(2027, 9, 1, 9));
/** Конец сентября: заказы в пути, партии упаковки в карантине, задания ждут. */
const mid = structuredClone(s0);
apply(db, mid, { kind: 'advance', seconds: at(2027, 9, 23, 8) - mid.t });

/** Прогон плана тем же путём, что у потребности: план S&OP по месяцам, за его горизонтом — цель политики. */
function trace(s: PlantState): SopTrace {
  const from = monthOfDay(today(s));
  const ctx = sopCtx(db, s, from, MRP_MONTHS, false);
  const plan: Record<string, number[]> = {};
  for (const p of ctx.products) plan[p] = Array.from({ length: MRP_MONTHS }, (_, i) => sopCover(s, p, firstDay(from + i)) ?? ctx.policy);
  const tr: SopTrace = { sold: new Map(), demand: new Map(), made: [] };
  sopRun(ctx, plan, 0, tr);
  return tr;
}

/** Горизонт нового заказа материала: заказ сегодня с верхом срока поставки — к рабочему дню и через контроль. */
function fenceOf(s: PlantState, supplier: string, d = today(s)): number {
  return workdayOnOrAfter(calOf(db, s), d + db.suppliers[supplier].lead[1]) + QC;
}

describe('потребность', () => {
  test('валовая АФС — состав карты в день серии: серии прогона плана и задания, которые ждут, по месяцу серии', () => {
    const r = mrpPlan(db, mid);
    const tr = trace(mid);
    const recipeOf = new Map(sc.plan!.items.map(it => [it.sku, it.recipe]));
    const want = new Map<number, number>();
    const add = (z: number, recipe: string) => {
      const l = db.recipes[inForce(db, 'recipes', recipe, z)].bom.find(x => x.material === API);
      if (l) want.set(monthOfDay(z), (want.get(monthOfDay(z)) ?? 0) + l.qty);
    };
    for (const x of tr.made) add(x.day, recipeOf.get(x.sku)!);
    for (const b of Object.values(mid.batches)) if (b.status === 'waiting') add(momentOf(mid.start, b.notBefore).day, b.recipe);
    const row = r.rows.find(x => x.material === API)!;
    expect(row.months.map(m => m.m)).toEqual(Array.from({ length: MRP_MONTHS }, (_, i) => r.from + i));
    expect(row.months.map(m => m.gross)).toEqual(row.months.map(m => want.get(m.m) ?? 0));
    expect(row.months.reduce((n, m) => n + m.gross, 0)).toBeGreaterThan(0);
  });

  test('валовая упаковки — упаковка позиции серий прогона и заданий до упаковки', () => {
    const r = mrpPlan(db, mid);
    const tr = trace(mid);
    const CASE = 'mat.pk.case';
    const want = new Map<number, number>();
    const add = (z: number, sku: string, tablets: number) => {
      for (const n of packNeeds(db, { sku, tablets } as PackJob)) if (n.material === CASE) want.set(monthOfDay(z), (want.get(monthOfDay(z)) ?? 0) + n.qty);
    };
    const recipeOf = new Map(sc.plan!.items.map(it => [it.sku, it.recipe]));
    for (const x of tr.made) add(x.day, x.sku, db.recipes[inForce(db, 'recipes', recipeOf.get(x.sku)!, x.day)].batch.units);
    for (const b of Object.values(mid.batches)) {
      const z = momentOf(mid.start, b.notBefore).day;
      if (['waiting', 'reserved', 'kitting', 'process', 'bulk'].includes(b.status) && !b.pack && b.sku) add(z, b.sku, db.recipes[b.recipe].batch.units);
      if (b.pack?.state === 'waiting') add(today(mid), b.pack.sku, b.pack.tablets);
    }
    const row = r.rows.find(x => x.material === CASE)!;
    expect(row.months.map(m => m.gross)).toEqual(row.months.map(m => want.get(m.m) ?? 0));
  });

  test('доступное: свободное разрешённое, в карантине и на испытаниях; в пути — к дню прихода и входному контролю', () => {
    const r = mrpPlan(db, mid);
    const byLot = containersByLot(mid);
    for (const row of r.rows) {
      let ok = 0;
      let wait = 0;
      for (const l of Object.values(mid.lots)) {
        if (l.material !== row.material || l.status === 'rejected' || l.status === 'blocked') continue;
        const n = (byLot.get(l.id) ?? []).reduce((x, c) => x + c.qty - (c.reserved ?? 0), 0);
        if (l.status === 'released') ok += n;
        else wait += n;
      }
      expect([row.free, row.quarantine]).toEqual([ok, wait]);
      const ordered = Object.values(mid.pos).filter(p => p.status === 'ordered' && p.lines.some(l => l.material === row.material));
      expect(row.transit.map(t => t.po).sort()).toEqual(ordered.map(p => p.id).sort());
      for (const t of row.transit) expect(t.day).toBe(Math.max(r.today, momentOf(mid.start, mid.pos[t.po].eta).day + QC));
    }
    // в конце сентября что-то едет и что-то ждёт лабораторию
    expect(r.rows.some(x => x.transit.length > 0)).toBe(true);
    expect(r.rows.some(x => x.quarantine > 0)).toBe(true);
  });

  test('необеспеченная по месяцам: материал без прихода — накопленная потребность со страховым запасом сверх свободного', () => {
    const r = mrpPlan(db, d1);
    const rows = r.rows.filter(x => x.transit.length === 0 && x.quarantine === 0);
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      let cum = 0;
      let before = 0;
      for (const m of row.months) {
        cum += m.gross;
        const short = m.gross > 0 ? Math.max(0, cum + row.safety - row.free) : before;
        expect(m.net).toBe(Math.max(0, short - before));
        before = Math.max(before, short);
      }
    }
    // пример: у АФС парацетамола на старте месяцы до первого дефицита — без необеспеченной, дальше — вся потребность
    const api = r.rows.find(x => x.material === API)!;
    const first = api.months.findIndex(m => m.net > 0);
    expect(first).toBeGreaterThan(0);
    for (const m of api.months.slice(first + 1)) expect(m.net).toBe(m.gross);
  });

  test('страховой запас — сутки политики среднего расхода горизонта, вверх', () => {
    const r = mrpPlan(db, mid);
    const horizon = firstDay(r.from + MRP_MONTHS) - r.today;
    for (const row of r.rows) {
      const total = row.months.reduce((n, m) => n + m.gross, 0);
      expect(row.safety).toBe(Math.ceil((total * sc.supply!.safety) / horizon));
    }
  });
});

describe('плановые заказы', () => {
  test('количество — дефицит и расход «на сколько суток заказ», до целой тары, не меньше наименьшей партии', () => {
    const r = mrpPlan(db, mid);
    expect(r.planned.length).toBeGreaterThan(10);
    for (const o of r.planned) {
      const cap = db.containers[db.materials[o.material].container].capacity;
      const moq = db.suppliers[o.supplier].items[o.material].moq;
      expect(o.qty % cap).toBe(0);
      expect(o.qty).toBeGreaterThanOrEqual(o.want);
      expect(o.qty - o.want).toBeLessThan(cap);
      expect(o.want).toBeGreaterThanOrEqual(Math.max(moq, o.deficit));
      expect(o.deficit).toBeGreaterThan(0);
    }
  });

  test('дата заказа — последний рабочий день, заказ которого с верхом срока поставки успеет; опаздывающий — сегодня', () => {
    const r = mrpPlan(db, mid);
    const cal = calOf(db, mid);
    for (const o of r.planned) {
      const fence = fenceOf(mid, o.supplier);
      expect(o.need).toBeGreaterThanOrEqual(fence);
      if (o.late > 0) {
        expect([o.need, o.orderBy]).toEqual([fence, r.today]);
        continue;
      }
      expect(o.orderBy).toBeGreaterThanOrEqual(r.today);
      expect(fenceOf(mid, o.supplier, o.orderBy)).toBeLessThanOrEqual(o.need);
      if (o.orderBy > r.today) {
        expect(isWorkday(cal, o.orderBy)).toBe(true);
        let next = o.orderBy + 1;
        while (!isWorkday(cal, next)) next++;
        expect(fenceOf(mid, o.supplier, next)).toBeGreaterThan(o.need);
      }
    }
  });

  test('срок завоза 25: материал месяца нужен к 25-му предыдущего и контролю; 0 — к дню серии', () => {
    const r25 = mrpPlan(db, mid);
    expect(r25.arrive).toBe(25);
    const beyond = (r: typeof r25) => r.planned.filter(o => o.need > fenceOf(mid, o.supplier));
    expect(beyond(r25).length).toBeGreaterThan(5);
    for (const o of beyond(r25)) {
      const c = civilFromDays(o.need);
      const prev = c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 };
      expect(o.need).toBeLessThanOrEqual(daysFromCivil({ ...prev, d: 25 }) + QC);
    }
    const s = structuredClone(mid);
    apply(db, s, { kind: 'policy', policy: POL.arrive, value: 0 });
    const r0 = mrpPlan(db, s);
    expect(r0.arrive).toBe(0);
    const days = new Set([...trace(s).made.map(x => x.day), ...Object.values(s.batches).map(b => momentOf(s.start, b.notBefore).day)]);
    for (const o of beyond(r0)) expect(days.has(o.need)).toBe(true);
    // к дню серии материал нужен позже: дни месяца дальше 4-го
    expect(beyond(r0).some(o => civilFromDays(o.need).d > 4)).toBe(true);
  });
});

describe('правило снабжения', () => {
  test('по умолчанию — по потребности: в 09:00 рабочего дня — плановые заказы с датой сегодня, у поставщика одним', () => {
    const s = structuredClone(d1);
    expect(howOf(db, s)).toBe('need');
    const r = mrpPlan(db, s);
    const due = r.planned.filter(o => o.orderBy <= r.today);
    expect(due.length).toBeGreaterThan(0);
    const plan = needPlan(db, s);
    const n = s.journal.length;
    supplyDay(db, s, []);
    const pos = Object.values(s.pos);
    expect(pos.map(p => [p.supplier, p.lines.map(l => [l.material, l.qty])])).toEqual(plan.map(o => [o.supplier, o.lines.map(l => [l.material, l.qty])]));
    // у поставщика — один заказ; строки — плановые заказы с датой сегодня, урезанные зоной карантина
    expect(new Set(pos.map(p => p.supplier)).size).toBe(pos.length);
    for (const p of pos) for (const l of p.lines) expect(due.some(o => o.material === l.material && o.supplier === p.supplier && o.qty >= l.qty)).toBe(true);
    const recs = s.journal.slice(n);
    expect(recs.map(x => x.by)).toEqual(pos.map(() => 'supply'));
    for (const rec of recs) {
      if (rec.d.kind !== 'po') throw new Error('not a po');
      for (const w of rec.d.why!) {
        if (w.rule !== 'need') throw new Error('not by need');
        const o = due.find(x => x.material === w.material)!;
        const row = r.rows.find(x => x.material === w.material)!;
        expect([w.month, w.need, w.deficit, w.late, w.want, w.arrive, w.qc, w.safety, w.safeQty]).toEqual([o.month, o.need, o.deficit, o.late, o.want, 25, QC, sc.supply!.safety, row.safety]);
        expect(w.have).toBe(row.free + row.quarantine + row.transit.reduce((x, t) => x + t.qty, 0));
        expect(w.gross).toBe(row.months.find(m => m.m === o.month)!.gross);
        expect(w.lead).toBe(db.suppliers[rec.d.supplier].lead[1]);
      }
    }
    // на следующий день заказанное целиком уже в пути: правило не заказывает его снова; урезанное зоной карантина и то,
    // что в зону не вошло, — заказывает
    const whole = recs.flatMap(x => (x.d.kind === 'po' ? x.d.why!.filter(w => !w.cut).map(w => w.material) : []));
    expect(whole.length).toBeGreaterThan(0);
    const again = structuredClone(s);
    upTo(again, at(2027, 9, 2, 9));
    const lines = needPlan(db, again).flatMap(o => o.lines.map(l => l.material));
    for (const m of whole) expect(lines.includes(m)).toBe(false);
  });

  test('«советует» — предложения тех же заказов, заказов нет; «по точке заказа» — прежнее правило', () => {
    // без места режим отдела — всегда «сам»: поста снабжения в сценарии нет, режим выбирает директор
    const s = structuredClone(d1);
    apply(db, s, { kind: 'seat', seats: ['director'] });
    apply(db, s, { kind: 'mode', head: 'supply', mode: 'advise' });
    const plan = needPlan(db, s);
    supplyDay(db, s, []);
    expect(Object.keys(s.pos)).toEqual([]);
    expect(Object.keys(s.heads.open).filter(k => k.startsWith('po/')).sort()).toEqual(plan.map(o => `po/${o.supplier}`).sort());
    const p = structuredClone(d1);
    apply(db, p, { kind: 'policy', policy: POL.how, value: 'point' });
    expect(howOf(db, p)).toBe('point');
    supplyDay(db, p, []);
    const recs = p.journal.filter(x => x.d.kind === 'po');
    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) if (rec.d.kind === 'po') for (const w of rec.d.why!) expect(w.rule).toBeUndefined();
  });

  test('сценарий без прогноза — по точке заказа: потребности нет', () => {
    const legacy = Object.values(db.scenarios).find(x => x.supply && !x.forecast);
    if (!legacy) return;
    const s = newPlant(db, { scenario: legacy.id });
    expect(howOf(db, s)).toBe('point');
    expect(mrpPlan(db, s).rows).toEqual([]);
  });
});

describe('сообщения', () => {
  test('«опаздывает»: дефицит лоратадина с 1 ноября, новый заказ — только к горизонту; «заказать до» — неделя', () => {
    const r = mrpPlan(db, d1);
    const o = r.planned.find(x => x.material === LOR)!;
    const fence = fenceOf(d1, o.supplier);
    expect([o.need, o.orderBy]).toEqual([fence, r.today]);
    expect(o.late).toBe(fence - daysFromCivil({ y: 2027, m: 11, d: 1 }));
    const i = r.planned.indexOf(o);
    expect(r.msgs).toContainEqual({ kind: 'overdue', material: LOR, order: i, days: o.late });
    r.planned.forEach((x, k) => {
      const soon = r.msgs.find(m => m.kind === 'soon' && m.order === k);
      if (x.late === 0 && x.orderBy - r.today <= MRP_SOON) expect(soon).toEqual({ kind: 'soon', material: x.material, order: k, days: x.orderBy - r.today });
      else expect(soon).toBeUndefined();
    });
  });

  test('«опоздает»: заказ лоратадина первого дня придёт с контролем позже 1 ноября — на столько суток', () => {
    const s = structuredClone(d1);
    supplyDay(db, s, []);
    const po = Object.values(s.pos).find(p => p.lines.some(l => l.material === LOR))!;
    const r = mrpPlan(db, s);
    const day = momentOf(s.start, po.eta).day + QC;
    expect(r.msgs).toContainEqual({ kind: 'late', material: LOR, po: po.id, days: day - daysFromCivil({ y: 2027, m: 11, d: 1 }) });
    expect(r.planned.some(x => x.material === LOR && x.late > 0)).toBe(false);
  });

  test('«лишний»: пачки, которых хватит за горизонт нового заказа, — заказ в пути без потребности до горизонта', () => {
    const s = structuredClone(d1);
    apply(db, s, { kind: 'po', supplier: 'sup.pack', lines: [{ material: N10, qty: db.suppliers['sup.pack'].items[N10].moq }] });
    const po = Object.values(s.pos).find(p => p.lines.some(l => l.material === N10))!;
    expect(mrpPlan(db, s).msgs).toContainEqual({ kind: 'extra', material: N10, po: po.id });
    // нужный заказ — не лишний: заказы правила первого дня
    const t = structuredClone(d1);
    supplyDay(db, t, []);
    const msgs = mrpPlan(db, t).msgs;
    for (const p of Object.values(t.pos)) expect(msgs.some(m => m.kind === 'extra' && m.po === p.id)).toBe(false);
  });
});

describe('ускорить и отменить заказ поставщику', () => {
  /** Завод с заказами правила первого дня; заказ лоратадина едет 50–80 суток. */
  const placed = structuredClone(d1);
  supplyDay(db, placed, []);
  apply(db, placed, { kind: 'advance', seconds: HOUR });
  const lorPo = (s: PlantState): Po => Object.values(s.pos).find(p => p.lines.some(l => l.material === LOR))!;

  test('«Ускорить»: приход — 09:00 рабочего дня через 7 суток; доплата 15 % суммы без НДС с НДС — сразу, в предоплате', () => {
    const s = structuredClone(placed);
    const po = lorPo(s);
    const was = { ...po };
    const cash = s.cash.balance;
    const n = apply(db, s, { kind: 'expedite', po: po.id });
    const cal = calOf(db, s);
    const eta = (workdayOnOrAfter(cal, today(s) + FAST_DAYS) - start) * DAY + 9 * HOUR;
    expect(n).toContainEqual({ kind: 'poFast', po: po.id, eta });
    const net = part(was.sum! - was.vat!, FAST_SHARE);
    const vat = part(was.vat!, FAST_SHARE);
    expect(po.fast).toEqual({ t: s.t, was: was.eta, net, vat });
    expect([po.eta, po.sum, po.vat, po.prepaid]).toEqual([eta, was.sum! + net + vat, was.vat! + vat, was.prepaid! + net + vat]);
    expect(s.cash.balance).toBe(cash - net - vat);
    expect(s.cash.ledger.at(-1)).toEqual({ t: s.t, sum: -(net + vat), item: 'poFast', ref: po.id });
    const rec = s.journal.at(-1)!;
    expect([rec.by, rec.d]).toEqual(['player', { kind: 'expedite', po: po.id, supplier: po.supplier, was: was.eta, eta, fee: net + vat }]);
    // фура — к новому сроку, одна; остаток к оплате после прихода — как был
    apply(db, s, { kind: 'advance', seconds: eta + HOUR - s.t });
    expect(po.status).toBe('arrived');
    const due = s.cash.dues.find(x => x.ref === po.id)!;
    expect(due.sum).toBe(-(was.sum! - was.prepaid!));
    const lots = Object.values(s.lots).filter(l => l.po === po.id).length;
    apply(db, s, { kind: 'advance', seconds: was.eta + HOUR - s.t });
    expect(Object.values(s.lots).filter(l => l.po === po.id).length).toBe(lots);
    expect(Object.values(s.trucks).filter(x => x.po === po.id).length).toBeLessThanOrEqual(1);
    expect(check(db, s)).toEqual([]);
  });

  test('«Ускорить» нельзя: дважды, пришедший, приходящий раньше срока ускорения, чужой номер', () => {
    const s = structuredClone(placed);
    const po = lorPo(s);
    apply(db, s, { kind: 'expedite', po: po.id });
    expect(refusals(apply(db, s, { kind: 'expedite', po: po.id }))).toEqual(['fastAgain']);
    expect(refusals(apply(db, s, { kind: 'expedite', po: 'P999' }))).toEqual(['noPo']);
    // заказ вспомогательных веществ едет 10–20 суток: ускорить, когда до прихода меньше недели, — не раньше
    const exc = Object.values(s.pos).find(p => p.supplier === 'sup.exc')!;
    apply(db, s, { kind: 'advance', seconds: exc.eta - 3 * DAY - s.t });
    expect(refusals(apply(db, s, { kind: 'expedite', po: exc.id }))).toEqual(['notFaster']);
    apply(db, s, { kind: 'advance', seconds: exc.eta + HOUR - s.t });
    expect(refusals(apply(db, s, { kind: 'expedite', po: exc.id }))).toEqual(['poDone']);
  });

  test('«Отменить» до прихода: неустойка 10 % суммы без НДС, возврат остатка предоплаты; фуры нет; договор свободен', () => {
    const s = structuredClone(placed);
    const po = lorPo(s);
    const cash = s.cash.balance;
    const line = po.lines[0];
    const cl = line.contract ? s.contracts[line.contract].lines.find(x => x.material === line.material && x.maker === line.maker) : undefined;
    const bought = cl?.bought ?? 0;
    const fee = part(po.sum! - po.vat!, CANCEL_SHARE);
    const back = po.prepaid! - fee;
    const n = apply(db, s, { kind: 'cancelPo', po: po.id });
    expect(n).toContainEqual({ kind: 'poCancelled', po: po.id });
    expect([po.status, po.cancelled]).toEqual(['cancelled', { t: s.t, fee, back }]);
    expect(s.cash.balance).toBe(cash + back);
    expect(s.cash.ledger.at(-1)).toEqual({ t: s.t, sum: back, item: 'poCancel', ref: po.id });
    if (cl) expect(cl.bought).toBe(bought - (line.qty - (line.list ?? 0)));
    expect(s.journal.at(-1)!.d).toEqual({ kind: 'cancelPo', po: po.id, supplier: po.supplier, fee, back });
    expect(refusals(apply(db, s, { kind: 'cancelPo', po: po.id }))).toEqual(['poDone']);
    // срок прихода прошёл — фуры и партий нет; потребность заказа не видит
    apply(db, s, { kind: 'advance', seconds: po.eta + DAY - s.t });
    expect(Object.values(s.lots).some(l => l.po === po.id)).toBe(false);
    expect(Object.values(s.trucks).some(x => x.po === po.id)).toBe(false);
    expect(mrpPlan(db, s).rows.find(x => x.material === LOR)!.transit.some(t => t.po === po.id)).toBe(false);
    expect(check(db, s)).toEqual([]);
  });

  test('«Отменить» ускоренный: доплата за ускорение не возвращается, неустойка — от суммы без неё', () => {
    const s = structuredClone(placed);
    const po = lorPo(s);
    const was = { ...po };
    apply(db, s, { kind: 'expedite', po: po.id });
    const fee = part(was.sum! - was.vat!, CANCEL_SHARE);
    apply(db, s, { kind: 'cancelPo', po: po.id });
    expect(po.cancelled).toEqual({ t: s.t, fee, back: was.prepaid! - fee });
  });

  test('команды поста «Снабжение и склад» и директора; с поста «Производство» — отказ, записка — начальнику снабжения', () => {
    const s = structuredClone(placed);
    const po = lorPo(s);
    apply(db, s, { kind: 'seat', seats: ['production'] });
    const n = apply(db, s, { kind: 'expedite', po: po.id });
    expect(n).toContainEqual({ kind: 'refused', cmd: 'expedite', why: 'notYours', detail: 'supply' });
    expect(cmdHead(db, { kind: 'expedite', po: po.id })).toBe('supply');
    expect(cmdHead(db, { kind: 'cancelPo', po: po.id })).toBe('supply');
    apply(db, s, { kind: 'seat', seats: ['director'] });
    expect(refusals(apply(db, s, { kind: 'cancelPo', po: po.id }))).toEqual([]);
  });
});

describe('без истины и сохранение', () => {
  test('в потребности — количества, дни и номера; полей истины нет', () => {
    const json = JSON.stringify(mrpPlan(db, mid));
    for (const k of ['truth', 'causes', 'noise', 'budget', 'root', 'potency']) expect(json.includes(`"${k}"`)).toBe(false);
  });

  test('образец схемы 42: заказы в пути — как были; правило — по записи сценария, по потребности', () => {
    const s: PlantState = fromSave(db, readFileSync(join(import.meta.dir, 'fixtures', 'save-v42.json'), 'utf8'));
    const raw = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'save-v42.json'), 'utf8')) as PlantState;
    expect(Object.values(s.pos).map(p => [p.id, p.status, p.eta])).toEqual(Object.values(raw.pos).map(p => [p.id, p.status, p.eta]));
    expect(howOf(db, s)).toBe('need');
    expect(mrpPlan(db, s).rows.length).toBeGreaterThan(10);
    apply(db, s, { kind: 'advance', seconds: 2 * DAY });
    expect(check(db, s)).toEqual([]);
  });
});

describe('сборщик базы', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
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

  test('срок завоза — от 0 до 28; у «как заказывать» — два варианта правила', () => {
    expect(broken({})).toEqual([]);
    expect(broken({ 'scenarios/proto.yaml': [['arrive: 25', 'arrive: 29']] }).length).toBeGreaterThan(0);
    expect(broken({ 'scenarios/proto.yaml': [['arrive: 25', 'arrive: -1']] }).length).toBeGreaterThan(0);
    expect(broken({ 'policies/supply/arrive.yaml': [['max: 28', 'max: 29']] }).some(e => e.includes('28-го'))).toBe(true);
    expect(broken({ 'policies/supply/how.yaml': [['options: [need, point]', 'options: [point, need]']] }).some(e => e.includes('варианты правила'))).toBe(true);
    expect(broken({ 'scenarios/proto.yaml': [['how: need', 'how: rop']] }).length).toBeGreaterThan(0);
  });
});
