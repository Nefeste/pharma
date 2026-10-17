// Часть 1д: рынок и отгрузка (docs/specs/2026-10-engine.md, 1д). Пуассоновский спрос; заказы покупателей по их
// расписанию; выпуск в оборот после публикации сведений о серии; FEFO с остаточным сроком; целая паллета и отбор
// ящиков; фура, отгрузка, счёт и НДС; недопоставка; сохранение посреди отбора. Кассу, резерв и паллеты заказа проверяют
// инварианты на каждом шаге.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { DAY, daysFromCivil, HOUR, momentOf, workdayOnOrAfter } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { Rng } from '../../src/engine/core/rng';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { poisson, TRUCK_HOUR } from '../../src/engine/market';
import { planOf } from '../../src/engine/plant';
import { fromSave, toSave } from '../../src/engine/save';
import { containersByLot, createLot, findSlot } from '../../src/engine/stock';
import type { Lot, Notice, Order, PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const N20 = 'sku.paracetamol500.n20';
const FG20 = 'mat.fg.paracetamol500-n20';
const NAT = 'cus.national';
const plan = planOf(db, db.scenarios[SC].plant);

/** Завод без серий и заказов поставщикам; покупатели сами не заказывают: заказы и запас ГП — в тесте. */
const quiet: ContentDb = {
  ...db,
  scenarios: { ...db.scenarios, [SC]: { ...db.scenarios[SC], batches: [], orders: [] } },
  customers: Object.fromEntries(Object.entries(db.customers).map(([id, c]) => [id, { ...c, demand: {} }])),
};

const dayOf = (s: PlantState, t = s.t) => momentOf(s.start, t).day;
const at = (s: PlantState, z: number, sec: number) => (z - daysFromCivil(s.start)) * DAY + sec;

/** Прожить `days` суток часами с инвариантами; `until` — остановиться раньше. */
function live(base: ContentDb, s: PlantState, days: number, until?: () => boolean): Notice[] {
  const out: Notice[] = [];
  const end = s.t + days * DAY;
  while (s.t < end && !until?.()) {
    out.push(...apply(base, s, { kind: 'advance', seconds: Math.min(HOUR, end - s.t) }));
    const bad = check(base, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
  return out;
}

/** Выпущенная ГП в обороте на стеллажах хранения: `cases` ящиков; срок годности — через `days` дней. */
function fg(s: PlantState, cases: number, days?: number): Lot {
  const per = db.containers[db.materials[FG20].container].capacity;
  const { lot } = createLot(quiet, s, {
    material: FG20,
    supplier: 'start',
    qty: cases * per,
    status: 'released',
    where: () => ({ kind: 'slot', id: findSlot(s, plan, 'storage', plan.byKind.shipping[0], 99)!.id }),
  });
  if (days !== undefined) lot.expiry = dayOf(s) + days;
  lot.circulation = s.t;
  return lot;
}

/** Заказ покупателя со сроком через `inDays` дней (рабочий день), 15:00. */
function inject(s: PlantState, cases: number, inDays: number): Order {
  const o: Order = {
    id: `O${(s.next.O = (s.next.O ?? 0) + 1)}`,
    customer: NAT,
    lines: [{ sku: N20, cases, reserved: 0, shipped: 0 }],
    placed: s.t,
    due: at(s, workdayOnOrAfter(dayOf(s) + inDays), TRUCK_HOUR),
    minShelf: db.customers[NAT].minShelf,
    status: 'open',
    cases: [],
    units: [],
  };
  s.orders[o.id] = o;
  return o;
}

test('пуассоновское число: среднее и дисперсия близки к заданному', () => {
  const r = Rng.seeded(7).fork('test');
  for (const mean of [0.5, 5, 30]) {
    const xs = Array.from({ length: 4000 }, () => poisson(r, mean));
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
    expect(Math.abs(m - mean)).toBeLessThan(0.06 * mean + 0.05);
    expect(Math.abs(v - mean)).toBeLessThan(0.12 * mean + 0.05);
  }
});

describe('заказы покупателей и выпуск в оборот (сценарий, 60 суток)', () => {
  const s = newPlant(db, { scenario: SC });
  const out = live(db, s, 60);

  test('заказ — в день и час покупателя, целыми ящиками; срок — рабочий день через 3–5 дней, в 15:00', () => {
    const orders = Object.values(s.orders);
    expect(orders.length).toBeGreaterThan(20);
    for (const o of orders) {
      const c = db.customers[o.customer];
      const placed = momentOf(s.start, o.placed);
      const due = momentOf(s.start, o.due);
      expect(c.order.days).toContain(placed.weekday);
      expect(placed.sec).toBe(c.order.hour * HOUR);
      expect(due.sec).toBe(TRUCK_HOUR);
      expect(due.weekday).toBeLessThan(5);
      expect(due.day).toBe(workdayOnOrAfter(due.day));
      const lead = due.day - placed.day;
      expect(lead).toBeGreaterThanOrEqual(c.order.lead[0]);
      expect(lead).toBeLessThanOrEqual(c.order.lead[1] + 2);
      for (const l of o.lines) expect(Number.isInteger(l.cases) && l.cases > 0).toBe(true);
    }
  });

  test('серия в обороте через 1–3 рабочих дня после выпуска, в 10:00; раньше её ящики не отгружают', () => {
    const released = Object.values(s.batches).filter(b => b.status === 'released');
    expect(released.length).toBeGreaterThan(0);
    for (const b of released) {
      const lot = s.lots[b.pack!.fg!];
      const c = momentOf(s.start, lot.circulation!);
      expect(c.sec).toBe(10 * HOUR);
      let wd = 0;
      for (let z = dayOf(s, b.released!) + 1; z <= c.day; z++) if (momentOf(s.start, at(s, z, 0)).weekday < 5) wd++;
      expect(wd).toBeGreaterThanOrEqual(1);
      expect(wd).toBeLessThanOrEqual(3);
    }
    for (const sh of Object.values(s.shipments)) for (const x of sh.cases) expect(sh.t).toBeGreaterThan(s.lots[x.lot].circulation!);
  });

  test('каждая отгрузка — извещение; заказ закрыт отгрузкой или недопоставкой', () => {
    expect(out.filter(n => n.kind === 'shipped').length).toBe(Object.keys(s.shipments).length);
    for (const o of Object.values(s.orders)) if (o.due < s.t - DAY) expect(o.status).not.toBe('open');
  });
});

describe('распределение и отбор', () => {
  test('FEFO: раньше срок — раньше; партия с малым остаточным сроком не идёт', () => {
    const s = newPlant(quiet, { scenario: SC });
    const late = fg(s, 20, 1000);
    const early = fg(s, 20, 900);
    const short = fg(s, 20, 300);
    const o = inject(s, 12, 2);
    live(quiet, s, 3, () => o.status !== 'open');
    expect(o.status).toBe('shipped');
    const sh = s.shipments[o.shipment!];
    expect(sh.cases.every(x => x.lot === early.id)).toBe(true);
    expect(late.shipped ?? 0).toBe(0);
    expect(short.shipped ?? 0).toBe(0);
  });

  test('целая паллета едет в экспедицию целиком; с начатой — отбор ящиков на паллету заказа', () => {
    const s = newPlant(quiet, { scenario: SC });
    fg(s, 40, 1000);
    fg(s, 40, 1001);
    const whole = inject(s, 40, 2);
    const part = inject(s, 7, 2);
    const kinds = new Set<string>();
    live(quiet, s, 3, () => {
      for (const t of Object.values(s.tasks)) if (t.order) kinds.add(`${t.order}:${t.kind}`);
      return whole.status !== 'open' && part.status !== 'open';
    });
    expect(kinds.has(`${whole.id}:ship`)).toBe(true);
    expect(kinds.has(`${whole.id}:casePick`)).toBe(false);
    expect(kinds.has(`${part.id}:casePick`)).toBe(true);
    expect(whole.status).toBe('shipped');
    expect(part.status).toBe('shipped');
    // одна фура на покупателя: оба заказа — одна отгрузка
    expect(whole.shipment).toBe(part.shipment);
  });
});

describe('отгрузка', () => {
  const s = newPlant(quiet, { scenario: SC });
  const lot = fg(s, 30, 1000);
  const before = Object.keys(s.containers).length;
  const o = inject(s, 25, 2);
  const out = live(quiet, s, 3, () => o.status !== 'open');
  const sh = s.shipments[o.shipment!];

  test('ящики с отрезками кодов — в записи отгрузки; со склада ушли', () => {
    expect(o.status).toBe('shipped');
    expect(sh.cases.length).toBe(25);
    expect(Object.keys(s.containers).length).toBe(before - 25);
    expect(lot.shipped).toBe(sh.cases.reduce((n, x) => n + x.qty, 0));
    expect(containersByLot(s).get(lot.id)!.length).toBe(5);
    expect(out.some(n => n.kind === 'shipped' && n.shipment === sh.id && n.cases === 25)).toBe(true);
    // фура ушла в день срока, после 15:00
    expect(dayOf(s, sh.t)).toBe(dayOf(s, o.due));
    expect(sh.t).toBeGreaterThanOrEqual(o.due);
  });

  test('счёт: цена × пачки, НДС 10 %; оплата — через отсрочку покупателя в 10:00 рабочего дня', () => {
    const price = db.skus[N20].price;
    expect(sh.sum).toBe(sh.cases.reduce((n, x) => n + x.qty, 0) * price);
    expect(sh.vat).toBe(Math.floor(sh.sum * 0.1));
    const due = s.cash.dues.find(d => d.ref === sh.id)!;
    expect(due.item).toBe('sale');
    expect(due.sum).toBe(sh.sum + sh.vat);
    const m = momentOf(s.start, due.due);
    expect(m.sec).toBe(10 * HOUR);
    expect(m.day).toBe(workdayOnOrAfter(dayOf(s, sh.t) + db.customers[NAT].payDays));
    expect(s.cash.vat.out).toBe(sh.vat);
  });

  test('подтверждение покупателя — на следующий рабочий день', () => {
    const next = momentOf(s.start, sh.accepted);
    expect(next.day).toBe(workdayOnOrAfter(dayOf(s, sh.t) + 1));
  });
});

test('товара нет — в 15:00 заказ закрыт недопоставкой, извещение', () => {
  const s = newPlant(quiet, { scenario: SC });
  const o = inject(s, 5, 2);
  const out = live(quiet, s, 3, () => o.status !== 'open');
  expect(o.status).toBe('short');
  expect(out.some(n => n.kind === 'lateOrder' && n.order === o.id && n.missing === 5)).toBe(true);
  expect(Object.keys(s.trucks).length).toBe(0);
});

test('снимок посреди отбора продолжается так же, как оригинал', () => {
  const s = newPlant(quiet, { scenario: SC });
  fg(s, 40, 1000);
  fg(s, 40, 1001);
  inject(s, 52, 2);
  live(quiet, s, 3, () => Object.values(s.tasks).some(t => t.kind === 'casePick' && t.state === 'busy'));
  expect(Object.values(s.tasks).some(t => t.kind === 'casePick')).toBe(true);
  const copy = fromSave(quiet, toSave(s));
  live(quiet, s, 2);
  live(quiet, copy, 2);
  expect(fingerprint(copy)).toBe(fingerprint(s));
});
