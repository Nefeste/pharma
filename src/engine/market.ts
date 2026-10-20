// Рынок и отгрузка (docs/specs/2026-10-engine.md, 1д; геймдизайн, §10.2): покупатели заказывают ящики по своему
// расписанию; выпущенная серия попадает в оборот, когда Росздравнадзор опубликует сведения о ней; в день отгрузки отдел
// продаж резервирует ящики по FEFO с условием остаточного срока, склад собирает паллеты заказа в экспедиции, в 15:00 к
// рампе встаёт фура покупателя. Ушла фура — отгрузка: ящики с отрезками кодов — в запись отгрузки, счёт — в кассу.
import type { ContentDb, Customer, Id, Scenario } from '../content/types';
import { schedule } from './core/agenda';
import type { Rng } from './core/rng';
import { addWorkdays, DAY, daysFromCivil, HOUR, isWorkday, momentOf, workdayOnOrAfter } from './core/calendar';
import { BANK_HOUR, dueIn, owe, part } from './cash';
import { dockWait } from './lean';
import { planOf } from './plant';
import { expo, roll } from './random';
import { containersByLot, findSlot, nextId, putUnit, stockChanged } from './stock';
import { addTask } from './tasks';
import type { Notice, Order, PlantState, Shipment, Task, Truck, Unit } from './types';
import { WMS } from './wms';

/** Отбор: кладовщик перекладывает ящик на паллету заказа, с (гипотеза). */
export const PICK_WORK = 30;

/** Распределение — в 08:00 рабочего дня и до 13:00 при изменении склада; фура покупателя — в 15:00. */
export const ALLOC_HOUR = 8 * HOUR;
export const CUTOFF_HOUR = 13 * HOUR;
export const TRUCK_HOUR = 15 * HOUR;

export const MARKET_PRIO = { ship: 35, casePick: 35, load: 45 } as const;

const P = 10000;
const idNum = (id: string) => Number(id.slice(1));
const at = (s: PlantState, z: number, sec: number) => (z - daysFromCivil(s.start)) * DAY + sec;
const today = (s: PlantState) => momentOf(s.start, s.t).day;
const dueDay = (s: PlantState, o: Order) => momentOf(s.start, o.due).day;
const busy = (s: PlantState, uid: string) => Object.values(s.tasks).some(t => t.unit === uid);
const pending = (s: PlantState, o: Order) => Object.values(s.tasks).some(t => t.order === o.id);

export function newCustomers(sc: Scenario, t: number): PlantState['customers'] {
  const out: PlantState['customers'] = {};
  for (const id of sc.customers) out[id] = { last: t };
  return out;
}

/**
 * Пуассоновское число со средним `mean`: счёт событий показательного потока на отрезке длиной 10⁶ тактов. Логарифм —
 * свой, из ядра (`expo`), поэтому одинаково в Bun и V8.
 */
export function poisson(r: Rng, mean: number): number {
  if (mean <= 0) return 0;
  const gap = 1_000_000 / mean;
  let t = 0;
  let n = 0;
  for (;;) {
    t += expo(r, gap);
    if (t > 1_000_000) return n;
    n++;
  }
}

/** Каждый час: заказы покупателей в их час; в 08:00 — распределение заказов дня; в 15:00 — фуры. Только в рабочий день. */
export function marketHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  const now = momentOf(s.start, s.t);
  if (!isWorkday(now.day)) return;
  for (const id of db.scenarios[s.scenario].customers) {
    const c = db.customers[id];
    if (c.order.days.includes(now.weekday) && now.sec === c.order.hour * HOUR) placeOrder(db, s, c);
  }
  if (now.sec === ALLOC_HOUR) allocateDay(db, s);
  if (now.sec === TRUCK_HOUR) trucksArrive(db, s, notices);
}

/** Заказ покупателя: по каждой позиции — целые ящики, пуассоновское число со средним по спросу с прошлого заказа. */
function placeOrder(db: ContentDb, s: PlantState, c: Customer) {
  const st = s.customers[c.id];
  const lines: Order['lines'] = [];
  for (const [sku, perDay] of Object.entries(c.demand)) {
    const per = db.skus[sku].case.per;
    const cases = roll(s, `market/${c.id}/${sku}`, r => poisson(r, (perDay * (s.t - st.last)) / (DAY * per)));
    if (cases > 0) lines.push({ sku, cases, reserved: 0, shipped: 0 });
  }
  st.last = s.t;
  if (lines.length === 0) return;
  const lead = roll(s, `market/${c.id}`, r => r.range(c.order.lead[0], c.order.lead[1]));
  const o: Order = {
    id: nextId(s, 'O'),
    customer: c.id,
    lines,
    placed: s.t,
    due: at(s, workdayOnOrAfter(today(s) + lead), TRUCK_HOUR),
    minShelf: c.minShelf,
    status: 'open',
    cases: [],
    units: [],
  };
  s.orders[o.id] = o;
}

/** Открытые заказы со сроком сегодня: раньше срок — раньше, затем раньше заказан. */
function ordersToday(s: PlantState): Order[] {
  const d = today(s);
  return Object.values(s.orders)
    .filter(o => o.status === 'open' && dueDay(s, o) === d)
    .sort((a, b) => a.due - b.due || a.placed - b.placed || idNum(a.id) - idNum(b.id));
}

function allocateDay(db: ContentDb, s: PlantState) {
  for (const o of ordersToday(s)) allocate(db, s, o);
}

/** После события: до 13:00 рабочего дня — распределить снова, если изменился склад; у рампы — грузить и отпускать фуру. */
export function marketStep(db: ContentDb, s: PlantState, notices: Notice[]) {
  const now = momentOf(s.start, s.t);
  if (isWorkday(now.day) && now.sec >= ALLOC_HOUR && now.sec < CUTOFF_HOUR) {
    const v = s.next.stock ?? 0;
    for (const o of ordersToday(s)) if (o.checked !== v && o.lines.some(l => l.reserved < l.cases)) allocate(db, s, o);
  }
  for (const tr of Object.values(s.trucks)) {
    if (!tr.customer || !tr.docked) continue;
    loadReady(db, s, tr);
    depart(db, s, tr, notices);
  }
}

/**
 * Резерв ящиков заказа по FEFO (`gdp-eaeu`, п. 79): выпущенная ГП в обороте с остаточным сроком не меньше договорного;
 * раньше срок годности — раньше, затем по порядку укладки. Только паллеты на стеллажах хранения, свободные от задач.
 * Паллета, все ящики которой идут в заказ, едет в экспедицию целиком; с остальных ящики снимают отбором прямо со
 * стеллажа и везут на паллету заказа в экспедиции.
 */
function allocate(db: ContentDb, s: PlantState, o: Order) {
  o.checked = s.next.stock ?? 0;
  const plan = planOf(db, s.plant);
  const day = today(s);
  const byLot = containersByLot(s);
  const picks = new Map<string, string[]>();
  for (const line of o.lines) {
    let need = line.cases - line.reserved;
    if (need <= 0) continue;
    const sku = db.skus[line.sku];
    // полный срок годности, дней: месяцы × 365,25 / 12
    const full = Math.floor((db.materials[sku.fg].shelf * 36525) / 1200);
    const lots = Object.values(s.lots)
      .filter(l => l.material === sku.fg && l.status === 'released' && l.circulation !== undefined && (l.expiry - day) * P >= o.minShelf * full)
      .sort((a, b) => a.expiry - b.expiry || idNum(a.id) - idNum(b.id));
    for (const lot of lots) {
      for (const c of byLot.get(lot.id) ?? []) {
        if (need === 0) break;
        if (c.reserved) continue;
        const u = s.units[c.unit];
        if (u.order || u.where.kind !== 'slot' || plan.slot[u.where.id].kind !== 'storage' || busy(s, u.id)) continue;
        c.reserved = c.qty;
        o.cases.push(c.id);
        const list = picks.get(u.id);
        if (list) list.push(c.id);
        else picks.set(u.id, [c.id]);
        line.reserved++;
        need--;
      }
      if (need === 0) break;
    }
  }
  const dock = plan.dock[outDock(db, s)];
  for (const [uid, cases] of picks) {
    const u = s.units[uid];
    const from = { kind: 'slot' as const, id: (u.where as { id: string }).id };
    if (cases.length === u.items.length) addTask(s, { kind: 'ship', roles: [...WMS.movers], veh: [...WMS.floor], unit: uid, from, toKind: 'shipping', near: { x: dock.x, z: dock.z }, work: 0, prio: MARKET_PRIO.ship, order: o.id, cases });
    else pickTask(db, s, o, u, cases);
  }
}

const outDock = (db: ContentDb, s: PlantState) => db.plants[s.plant].docks.find(d => d.kind === 'out')!.id;

/** Сколько ящиков влезает на паллету заказа: по самой мелкой укладке позиций заказа. */
const capacity = (db: ContentDb, o: Order) => Math.min(...o.lines.map(l => db.skus[l.sku].pallet.cases));

/** Что сделала задача отгрузки, когда кончилась. Не задача отгрузки — `false`. */
export function marketDone(db: ContentDb, s: PlantState, t: Task, notices: Notice[]): boolean {
  switch (t.kind) {
    case 'ship': {
      // вся паллета — в заказ: она и есть паллета заказа
      const u = s.units[t.unit!];
      putUnit(s, u, t.to!);
      u.order = t.order!;
      s.orders[t.order!].units.push(u.id);
      return true;
    }
    case 'casePick': {
      const src = s.units[t.unit!];
      const o = s.orders[t.order!];
      let dest = t.dest ? s.units[t.dest] : undefined;
      if (!dest) {
        dest = { id: nextId(s, 'U'), type: 'unit.pallet.euro', where: { kind: 'slot', id: t.to! }, items: [], tag: 'released', order: o.id };
        s.units[dest.id] = dest;
        putUnit(s, dest, t.to!);
        o.units.push(dest.id);
      }
      for (const cid of t.cases!) {
        src.items = src.items.filter(id => id !== cid);
        dest.items.push(cid);
        s.containers[cid].unit = dest.id;
      }
      // паллета на стеллаже опустела — из учёта; начатая снова свободна для других заказов дня
      if (src.items.length === 0) {
        delete s.slots[(src.where as { id: string }).id].unit;
        delete s.units[src.id];
      }
      stockChanged(s);
      return true;
    }
    case 'load': {
      const u = s.units[t.unit!];
      const tr = s.trucks[t.truck!];
      if (u.where.kind === 'slot') delete s.slots[u.where.id].unit;
      u.where = { kind: 'truck', id: tr.id };
      tr.units.push(u.id);
      depart(db, s, tr, notices);
      return true;
    }
    default:
      return false;
  }
}

/**
 * Отбор ящиков со стеллажа на паллету заказа: на ту, где хватает места с учётом идущих отборов, иначе — на новую
 * европаллету, которую сразу ставят на свободное место экспедиции; свободного нет — место займёт сам отбор, когда оно
 * освободится. Паллета на стеллаже остаётся на месте.
 */
function pickTask(db: ContentDb, s: PlantState, o: Order, u: Unit, cases: string[]) {
  const plan = planOf(db, s.plant);
  const cap = capacity(db, o);
  const coming = (uid: string) =>
    s.units[uid].items.length + Object.values(s.tasks).reduce((n, t) => n + (t.kind === 'casePick' && t.dest === uid ? t.cases!.length : 0), 0);
  let dest = o.units.find(uid => s.units[uid].where.kind === 'slot' && coming(uid) + cases.length <= cap);
  const dock = plan.dock[outDock(db, s)];
  if (!dest) {
    const sl = findSlot(s, plan, 'shipping', dock, 0);
    if (sl) {
      const out: Unit = { id: nextId(s, 'U'), type: 'unit.pallet.euro', where: { kind: 'slot', id: sl.id }, items: [], tag: 'released', order: o.id };
      s.units[out.id] = out;
      putUnit(s, out, sl.id);
      o.units.push(out.id);
      dest = out.id;
    }
  }
  addTask(s, {
    kind: 'casePick',
    roles: [...WMS.movers],
    veh: [...WMS.floor],
    unit: u.id,
    from: { kind: 'slot', id: (u.where as { id: string }).id },
    ...(dest ? { dest } : { toKind: 'shipping' as const, near: { x: dock.x, z: dock.z } }),
    work: cases.length * PICK_WORK,
    prio: MARKET_PRIO.casePick,
    order: o.id,
    cases,
  });
}

/** 15:00: к рампе экспедиции — фура каждого покупателя, у которого есть что грузить сегодня; пустые заказы — недопоставка. */
function trucksArrive(db: ContentDb, s: PlantState, notices: Notice[]) {
  const orders = ordersToday(s);
  for (const id of db.scenarios[s.scenario].customers) {
    const mine = orders.filter(o => o.customer === id);
    if (mine.length === 0) continue;
    if (mine.every(o => o.units.length === 0 && !pending(s, o))) {
      for (const o of mine) close(s, o, notices);
      continue;
    }
    const tr: Truck = { id: nextId(s, 'R'), dock: outDock(db, s), customer: id, units: [], arrived: s.t, docked: false, open: false };
    s.trucks[tr.id] = tr;
    for (const o of mine) o.truck = tr.id;
  }
  dockNext(db, s, notices);
}

/**
 * К свободной рампе отгрузки — первая ждущая фура покупателя: кузов открыт для погрузки; сколько она ждала во дворе — в
 * потери (3а).
 */
function dockNext(db: ContentDb, s: PlantState, notices: Notice[]) {
  const dock = outDock(db, s);
  const trucks = Object.values(s.trucks).filter(tr => tr.dock === dock);
  if (trucks.some(tr => tr.docked)) return;
  const next = trucks[0];
  if (!next) return;
  next.docked = true;
  next.open = true;
  dockWait(s, s.t - next.arrived);
  loadReady(db, s, next);
  depart(db, s, next, notices);
}

const truckOrders = (s: PlantState, tr: Truck) => Object.values(s.orders).filter(o => o.truck === tr.id && o.status === 'open');

/** Погрузка готовых паллет заказов фуры: паллета готова, когда на неё больше никто не кладёт и задач у неё нет. */
function loadReady(db: ContentDb, s: PlantState, tr: Truck) {
  if (!tr.docked) return;
  for (const o of truckOrders(s, tr)) {
    for (const uid of o.units) {
      const u = s.units[uid];
      if (u.where.kind !== 'slot' || u.items.length === 0 || Object.values(s.tasks).some(t => t.unit === uid || t.dest === uid)) continue;
      addTask(s, { kind: 'load', roles: [...WMS.movers], veh: [...WMS.floor], unit: uid, from: { kind: 'slot', id: u.where.id }, work: 0, prio: MARKET_PRIO.load, order: o.id, truck: tr.id });
    }
  }
}

/**
 * Фура уходит, когда у её заказов не осталось задач и всё собранное погружено. Отгрузка: ящики с отрезками кодов —
 * в запись, тара и паллеты — из учёта, счёт с НДС — в кассу, сведения в систему мониторинга — сейчас (прямой порядок),
 * подтверждение покупателя — в следующий рабочий день (`mdlp`, п. 44).
 */
function depart(db: ContentDb, s: PlantState, tr: Truck, notices: Notice[]) {
  if (!tr.docked) return;
  const orders = truckOrders(s, tr);
  if (orders.some(o => pending(s, o) || o.units.some(uid => s.units[uid].where.kind !== 'truck' && s.units[uid].items.length > 0))) return;
  // пустая паллета заказа (на неё ничего не легло) — снова в стопку
  for (const o of orders) {
    for (const uid of o.units.filter(id => s.units[id].where.kind === 'slot')) {
      delete s.slots[(s.units[uid].where as { id: string }).id].unit;
      delete s.units[uid];
    }
    o.units = o.units.filter(id => s.units[id]);
  }
  const sh: Shipment = { id: nextId(s, 'H'), customer: tr.customer!, orders: orders.map(o => o.id), t: s.t, cases: [], reported: s.t, accepted: at(s, addWorkdays(today(s), 1), BANK_HOUR), sum: 0, vat: 0 };
  const fgSku = new Map(Object.values(db.skus).map(k => [k.fg, k]));
  for (const o of orders) {
    for (const uid of o.units) {
      const u = s.units[uid];
      for (const cid of u.items) {
        const c = s.containers[cid];
        const lot = s.lots[c.lot];
        const sku = fgSku.get(lot.material)!;
        o.lines.find(l => l.sku === sku.id)!.shipped++;
        sh.cases.push({ id: c.id, lot: lot.id, qty: c.qty, codes: c.codes ?? [] });
        sh.sum += c.qty * sku.price;
        lot.shipped = (lot.shipped ?? 0) + c.qty;
        delete s.containers[cid];
      }
      delete s.units[uid];
    }
    o.cases = [];
    o.units = [];
    o.shipment = sh.id;
    close(s, o, notices);
  }
  const pr = db.profiles[db.scenarios[s.scenario].profile];
  sh.vat = part(sh.sum, pr.vat.medicines);
  s.cash.vat.out += sh.vat;
  owe(s, 'sale', sh.sum + sh.vat, dueIn(s, db.customers[sh.customer].payDays), sh.id);
  s.shipments[sh.id] = sh;
  delete s.trucks[tr.id];
  stockChanged(s);
  notices.push({ kind: 'shipped', shipment: sh.id, customer: sh.customer, cases: sh.cases.length });
  dockNext(db, s, notices);
}

/** Закрыть заказ: всё отгружено в свой день — «отгружен»; всё, но позже — «опоздал»; не всё — недопоставка. */
function close(s: PlantState, o: Order, notices: Notice[]) {
  const missing = o.lines.reduce((n, l) => n + l.cases - l.shipped, 0);
  o.status = missing > 0 ? 'short' : today(s) === dueDay(s, o) ? 'shipped' : 'late';
  delete o.truck;
  if (o.status !== 'shipped') notices.push({ kind: 'lateOrder', order: o.id, missing });
}

/** Выпуск серии: документы — в АИС Росздравнадзора; сведения о серии опубликуют через 1–3 рабочих дня, в 10:00. */
export function toRzn(s: PlantState, lot: string) {
  const days = roll(s, 'rzn', r => r.range(1, 3));
  schedule(s.agenda, at(s, addWorkdays(today(s), days), BANK_HOUR), { kind: 'rzn', lot });
}

/** Сведения о серии опубликованы: пачки в обороте сами (автоввод) — серию можно отгружать. */
export function rznPublished(s: PlantState, lot: string) {
  const l = s.lots[lot];
  if (!l || l.circulation !== undefined) return;
  l.circulation = s.t;
  stockChanged(s);
}

/** Заказ под угрозой: сколько ящиков не хватит и сколько ящиков позиции ещё ждут решения или ввода в оборот. */
export interface OrderRisk {
  order: string;
  customer: Id;
  due: number;
  missing: number;
  pending: number;
}

/**
 * Заказы под угрозой — для планёрки (3в) и тревоги часа (Б2а, alerts.ts): открытые заказы по сроку разбирают свободные
 * ящики выпущенной ГП в обороте с остаточным сроком на день срока — FEFO, как `allocate`, без записи. Кому не хватило —
 * под угрозой.
 */
export function orderRisks(db: ContentDb, s: PlantState): OrderRisk[] {
  const free = new Map<string, number>();
  for (const c of Object.values(s.containers)) if (!c.reserved) free.set(c.lot, (free.get(c.lot) ?? 0) + 1);
  const out: OrderRisk[] = [];
  const orders = Object.values(s.orders)
    .filter(o => o.status === 'open')
    .sort((a, b) => a.due - b.due || idNum(a.id) - idNum(b.id));
  for (const o of orders) {
    const day = dueDay(s, o);
    let missing = 0;
    let pending = 0;
    for (const line of o.lines) {
      let need = line.cases - line.reserved;
      if (need <= 0) continue;
      const sku = db.skus[line.sku];
      const full = Math.floor((db.materials[sku.fg].shelf * 36525) / 1200);
      const lots = Object.values(s.lots).filter(l => l.material === sku.fg);
      const ready = lots
        .filter(l => l.status === 'released' && l.circulation !== undefined && (l.expiry - day) * P >= o.minShelf * full)
        .sort((a, b) => a.expiry - b.expiry || idNum(a.id) - idNum(b.id));
      for (const l of ready) {
        const take = Math.min(need, free.get(l.id) ?? 0);
        free.set(l.id, (free.get(l.id) ?? 0) - take);
        need -= take;
      }
      missing += need;
      if (need > 0)
        for (const l of lots) if (l.status !== 'rejected' && (l.status !== 'released' || l.circulation === undefined)) pending += free.get(l.id) ?? 0;
    }
    if (missing > 0) out.push({ order: o.id, customer: o.customer, due: o.due, missing, pending });
  }
  return out;
}

/** Тара заказа — для инвариантов: какие ящики и на сколько зарезервированы под открытые заказы. */
export function orderReserved(s: PlantState): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of Object.values(s.orders)) if (o.status === 'open') for (const cid of o.cases) out.set(cid, (out.get(cid) ?? 0) + (s.containers[cid]?.qty ?? 0));
  return out;
}

