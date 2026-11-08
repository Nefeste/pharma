// Оборудование (Б7в; docs/specs/2026-10-vertical-slice.md, «Б7в»; геймдизайн, §5.2, §7.2, §13): команда `equip` места
// директора — купить, заменить, перенести, снести, отменить заказ — и путь единицы до записи квалификации: заказано →
// доставлено к месту → (замена — снять прежнюю, когда освободится) → монтаж — помещение закрыто → IQ → OQ → PQ — инженер
// поставщика и инженер по валидации, свой или подрядчика → отчёт принимает специалист ООК → запись, единица работает.
// Перенос — монтаж своими слесарями, IQ и OQ без инженера поставщика (прил. 15, п. 11.4; GDP ЕАЭС, п. 50). У класса без
// квалификации — только монтаж: калибровку или поверку ставит коллега техслужбы, как визит Б3в. Деньги — предоплата при
// заказе, остаток — в день поставки с отсрочкой поставщика, дни инженеров — счётом после PQ; снос и снятие при замене —
// половина цены поставщика единицы. Настоящий день поставки — у движка (`arrive`), завод знает обещанный (`due`).
import type { ContentDb, Id } from '../content/types';
import { ACCEPT, ACCEPT_PRIO, visitDone } from './assets';
import { owe, dueIn, part, post } from './cash';
import { schedule } from './core/agenda';
import { addMonths, DAY, daysFromCivil, isWorkday, momentOf, workdayOnOrAfter } from './core/calendar';
import { noteCmd } from './journal';
import { placesOf } from './places';
import { planOf } from './plant';
import { roll } from './random';
import { forgetDown } from './site/down';
import { NO_TIMES } from './lean';
import { editPlan } from './site/edit';
import { classRec, familyOf, movedUnit, swapUnit, unitOf, unitPrice, unitsOf, withoutUnit } from './site/units';
import { addTask } from './tasks';
import type { Asset, BuildState, Command, Notice, PlanUnit, PlantState, SitePlan, Task, UnitPath } from './types';
import { calOf } from './workdays';

/** Инженер по валидации (геймдизайн, §8.1): ведёт IQ, OQ и PQ вместе с инженером поставщика. */
export const VALIDATOR = 'role.validation';

/** Слесари ставят единицу при переносе (Б7в). */
export const FITTER = 'role.mechanic';

/** День шага своего человека — часть смены (гипотеза): остальное делает инженер поставщика. */
export const DAY_WORK = 6 * 3600;

/** День шага — выше обычной работы, ниже приёмки работы подрядчика (гипотеза). */
export const PATH_PRIO = 25;

/** Что делает команда «Оборудование». */
export type EquipOp =
  | { op: 'buy'; type: Id; vendor: Id; room: string; at?: [number, number]; turn?: number }
  | { op: 'replace'; unit: string; vendor: Id; type?: Id }
  | { op: 'move'; unit: string; room: string; at?: [number, number]; turn?: number }
  | { op: 'remove'; unit: string }
  | { op: 'cancel'; unit: string };

/** Сегодня — номер дня с 1970-01-01. */
const today = (s: PlantState) => daysFromCivil(s.start) + Math.floor(s.t / DAY);

/** НДС стройки и оборудования — общая ставка профиля. */
const rateOf = (db: ContentDb, s: PlantState) => db.profiles[db.scenarios[s.scenario].profile].vat.general;

const newBuild = (): BuildState => ({ undo: [], step: 1, leaving: [], next: {}, spent: 0 });

/** Шаги пути единицы класса: монтаж и, у класса с квалификацией, IQ, OQ, PQ; при переносе — без PQ. */
export function stepsOf(db: ContentDb, type: Id, move: boolean): { step: UnitPath['step']; days: number }[] {
  const ins = classRec(db, type).install;
  const out: { step: UnitPath['step']; days: number }[] = [{ step: 'install', days: ins.days }];
  if (ins.iq) out.push({ step: 'iq', days: ins.iq }, { step: 'oq', days: ins.oq! });
  if (ins.pq && !move) out.push({ step: 'pq', days: ins.pq });
  return out;
}

/**
 * Обещанный день поставки и настоящее мгновение (Б7в): срок — месяцы поставщика от и до, по его ветви; опаздывает — доля
 * заказов на столько суток, по своей ветви, как поставщик материалов (Б6ж). Привозят в рабочий день к 09:00.
 */
export function deliveryOf(db: ContentDb, s: PlantState, vendor: Id): { due: number; arrive: number } {
  const v = db.vendors[vendor];
  const cal = calOf(db, s);
  const d0 = today(s);
  const due = workdayOnOrAfter(cal, roll(s, `equip/${vendor}`, r => addMonths(d0, r.range(v.lead[0], v.lead[1]))));
  const late = roll(s, `equip-late/${vendor}`, r => (r.int(10_000) < v.late.share ? r.range(v.late.days[0], v.late.days[1]) : 0));
  const day = workdayOnOrAfter(cal, due + late);
  return { due, arrive: (day - daysFromCivil(s.start)) * DAY + db.scenarios[s.scenario].assets.hours[0] };
}

/** Шаг отмены стройки (Б7б): план до шага, что шаг заплатил, единица и день заказа. */
function remember(db: ContentDb, s: PlantState, st: BuildState, plan: SitePlan, paid: number, vat: number, unit?: string) {
  const b = db.scenarios[s.scenario].build!;
  st.undo.push({ n: st.step++, plan, paid, vat, ...(st.editing !== undefined ? { editing: st.editing } : {}), ...(unit ? { unit: { id: unit, day: today(s) } } : {}) });
  if (st.undo.length > b.undo) st.undo.splice(0, st.undo.length - b.undo);
}

/** Деньги: из кассы статьёй «Оборудование» (возврат — в кассу), НДС — к вычету, потрачено на стройку. */
function pay(s: PlantState, st: BuildState, paid: number, vat: number, ref: string) {
  post(s, -paid, 'equip', ref);
  s.cash.vat.in += vat;
  st.spent += paid;
}

/** Состояние завода — по плану: новое оборудование, линии и узлы; снесённых нет (src/engine/build.ts зовёт после правки). */
export function syncUnits(db: ContentDb, s: PlantState, newParts: (db: ContentDb, s: PlantState) => void) {
  const plant = planOf(db, s.plan).plant;
  const units = unitsOf(plant);
  const ids = new Set(units.map(u => u.id));
  for (const e of plant.equipment) s.equipment[e.id] ??= { id: e.id, type: e.type, room: e.room };
  for (const e of plant.equipment) s.equipment[e.id].room = e.room;
  for (const id of Object.keys(s.equipment)) if (!ids.has(id)) delete s.equipment[id];
  for (const i of plant.instruments) s.instruments[i.id] ??= { id: i.id, type: i.type, room: i.room };
  for (const i of plant.instruments) s.instruments[i.id].room = i.room;
  for (const id of Object.keys(s.instruments)) if (!ids.has(id)) delete s.instruments[id];
  // линии: снесённой нет; заменённая машина — новая, свободная
  for (const id of Object.keys(s.lines)) if (!plant.lines.some(l => l.id === id)) delete s.lines[id];
  for (const l of plant.lines) {
    const ln = s.lines[l.id];
    if (!ln) continue;
    ln.machines = l.machines.map(m => ln.machines.find(x => x.id === m.id) ?? { id: m.id, type: m.type, pos: 0, rate: 0, state: 'idle', next: 0, times: { ...NO_TIMES } });
  }
  for (const id of Object.keys(s.parts)) if (!ids.has(s.parts[id].machine)) delete s.parts[id];
  newParts(db, s);
  // активы снесённого — нет; у заменяющей до снятия прежней — есть, её в плане ещё нет
  for (const a of Object.values(s.assets)) if (a.family !== 'vehicle' && !ids.has(a.id) && !a.path?.unit) delete s.assets[a.id];
  // место актива — по плану
  for (const u of units) if (s.assets[u.id]) s.assets[u.id].place = u.place;
}

/** Новый актив единицы — следующий инвентарный номер, без записей, с путём. */
function newAsset(db: ContentDb, s: PlantState, id: string, family: Asset['family'], type: Id, place: string, path: UnitPath): Asset {
  let inv = db.scenarios[s.scenario].assets.inv;
  for (const a of Object.values(s.assets)) inv = Math.max(inv, a.inv + 1);
  const a: Asset = { id, inv, family, type, place, recs: [], vendor: path.vendor, path };
  s.assets[id] = a;
  return a;
}

/** Не занята ли единица работой (серией, испытанием, упаковкой) — тогда её снимают, переносят или сносят сейчас. */
export function unitBusy(db: ContentDb, s: PlantState, id: string): boolean {
  const plant = planOf(db, s.plan).plant;
  const u = unitOf(plant, id);
  if (!u) return false;
  if (u.family === 'equipment') return !!s.equipment[id]?.batch;
  if (u.family === 'machine') return !!(u.line && s.lines[u.line]?.batch);
  if (u.family === 'lab') return !!s.instruments[id]?.test;
  if (u.family === 'ipc') return !!s.rooms[u.room]?.batch;
  return false;
}

const no = (op: string, error: Extract<Notice, { kind: 'equip'; ok: false }>['error']): Notice => ({ kind: 'equip', op, ok: false, error });

/** Команда «Оборудование» (Б7в): правка плана, деньги, шаг отмены, путь — или отказ, и тогда ничего не меняется. */
export function equipCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'equip' }>, notices: Notice[], commit: (plan: SitePlan) => void) {
  const op = cmd.op;
  const b = db.scenarios[s.scenario].build;
  if (!b) return void notices.push(no(op.op, { code: 'noBuild' }));
  const rate = rateOf(db, s);
  const floor = -db.scenarios[s.scenario].credit.limit;
  const st = () => (s.build ??= newBuild());
  const leaving = (id: string) => s.build?.leaving.some(l => l.what === 'unit' && l.id === id);
  switch (op.op) {
    case 'buy': {
      const r = editPlan(db, b, s.plan, { op: 'unit', type: op.type, room: op.room, at: op.at, turn: op.turn, vendor: op.vendor }, s.build?.next ?? {});
      if (!r.ok) return void notices.push(no(op.op, r.error));
      if (s.build?.leaving.some(l => l.what === 'room' && l.id === op.room)) return void notices.push(no(op.op, { code: 'leaving', thing: op.room }));
      const v = db.vendors[op.vendor];
      const pre = part(r.cost, v.prepay);
      const vat = part(pre, rate);
      if (s.cash.balance - (pre + vat) < floor) return void notices.push(no(op.op, { code: 'money', need: pre + vat - (s.cash.balance - floor) }));
      const x = st();
      remember(db, s, x, s.plan, pre + vat, vat, r.thing);
      x.next = r.names;
      // актив — до нового плана: узлы новой единицы берут отказы по её поставщику
      const u = unitOf(r.plan, r.thing)!;
      const { due, arrive } = deliveryOf(db, s, op.vendor);
      const a = newAsset(db, s, u.id, u.family, u.type, u.place, { vendor: op.vendor, step: 'ordered', ordered: s.t, due, arrive, day: 0, eng: 0, val: 0, price: r.cost, v: 1 });
      commit(r.plan);
      schedule(s.agenda, arrive, { kind: 'unitArrive', asset: a.id, v: 1 });
      pay(s, x, pre + vat, vat, a.id);
      noteCmd(s, cmd, { kind: 'equip', op: 'buy', unit: a.id, type: u.type, vendor: op.vendor, due });
      return void notices.push({ kind: 'equip', op: op.op, ok: true, cost: pre + vat, thing: a.id });
    }
    case 'replace': {
      const old = unitOf(s.plan, op.unit);
      if (!old) return void notices.push(no(op.op, { code: 'noThing' }));
      if (s.assets[op.unit]?.path || leaving(op.unit) || Object.values(s.assets).some(a => a.path?.replaces === op.unit)) return void notices.push(no(op.op, { code: 'unitState', thing: op.unit }));
      const type = op.type ?? old.type;
      if (!db.vendors[op.vendor] || familyOf(db, s.plan, type, old.room) !== old.family || !(db.rooms[s.plan.rooms.find(x => x.id === old.room)!.type]?.things ?? []).includes(type)) return void notices.push(no(op.op, { code: 'notHere', type, room: old.room }));
      const price = unitPrice(db, type, op.vendor);
      const pre = part(price, db.vendors[op.vendor].prepay);
      const vat = part(pre, rate);
      if (s.cash.balance - (pre + vat) < floor) return void notices.push(no(op.op, { code: 'money', need: pre + vat - (s.cash.balance - floor) }));
      const x = st();
      // имя — следующее, как у покупки; в план единица встанет при снятии прежней
      const base = type.slice(type.indexOf('.') + 1);
      let n = x.next[base] ?? 1;
      const taken = (id: string) => !!unitOf(s.plan, id) || !!s.assets[id] || s.plan.lines.some(l => l.id === id);
      while (taken(`${base}-${n}`)) n++;
      const id = `${base}-${n}`;
      x.next = { ...x.next, [base]: n + 1 };
      remember(db, s, x, s.plan, pre + vat, vat, id);
      const { due, arrive } = deliveryOf(db, s, op.vendor);
      const unit: PlanUnit = { type, room: old.room, vendor: op.vendor, ...(old.at ? { at: old.at, turn: old.turn ?? 0 } : {}) };
      const a = newAsset(db, s, id, old.family, type, old.place, { vendor: op.vendor, step: 'ordered', ordered: s.t, due, arrive, day: 0, replaces: old.id, unit, eng: 0, val: 0, price, v: 1 });
      schedule(s.agenda, arrive, { kind: 'unitArrive', asset: a.id, v: 1 });
      pay(s, x, pre + vat, vat, a.id);
      noteCmd(s, cmd, { kind: 'equip', op: 'replace', unit: a.id, type, vendor: op.vendor, due, of: old.id });
      return void notices.push({ kind: 'equip', op: op.op, ok: true, cost: pre + vat, thing: a.id });
    }
    case 'move':
    case 'remove': {
      const u = unitOf(s.plan, op.unit);
      if (!u) return void notices.push(no(op.op, { code: 'noThing' }));
      if (s.assets[op.unit]?.path || leaving(op.unit) || Object.values(s.assets).some(a => a.path?.replaces === op.unit)) return void notices.push(no(op.op, { code: 'unitState', thing: op.unit }));
      const edit = op.op === 'move' ? { op: 'unitMove' as const, id: u.id, room: op.room, at: op.at, turn: op.turn } : { op: 'unitDrop' as const, id: u.id };
      const r = editPlan(db, b, s.plan, edit, s.build?.next ?? {});
      if (!r.ok) return void notices.push(no(op.op, r.error));
      const x = st();
      remember(db, s, x, s.plan, 0, 0, u.id);
      // и снос, и перенос — когда освободится: проверка — событием стройки (Б7б)
      x.leaving.push({ what: 'unit', id: u.id, step: x.step - 1, ...(op.op === 'move' ? { act: 'move' as const, to: { room: op.room, ...(op.at ? { at: op.at } : {}), ...(op.turn !== undefined ? { turn: op.turn } : {}) } } : {}) });
      forgetDown(x);
      noteCmd(s, cmd, { kind: 'equip', op: op.op, unit: u.id, type: u.type, ...(u.vendor ? { vendor: u.vendor } : {}) });
      notices.push({ kind: 'equip', op: op.op, ok: true, cost: 0, thing: u.id, later: true });
      return void unitFree(db, s, notices, commit);
    }
    case 'cancel': {
      const a = s.assets[op.unit];
      if (!a?.path || a.path.step !== 'ordered' || !a.path.vendor) return void notices.push(no(op.op, { code: 'unitState', thing: op.unit }));
      a.path.v++;
      if (!a.path.unit) {
        const r = editPlan(db, b, s.plan, { op: 'unitDrop', id: a.id }, s.build?.next ?? {});
        if (r.ok) commit(r.plan);
        for (const u of s.build?.undo ?? []) u.plan = withoutUnit(db, u.plan, a.id);
      }
      delete s.assets[a.id];
      noteCmd(s, cmd, { kind: 'equip', op: 'cancel', unit: a.id, type: a.type, vendor: a.path.vendor });
      return void notices.push({ kind: 'equip', op: op.op, ok: true, cost: 0, thing: a.id });
    }
  }
}

/**
 * Отмена шага с единицей (Б7б, Б7в): покупку и замену — до полуночи дня заказа, пока поставщик не подтвердил заказ;
 * снос и перенос — пока не случились. Иначе — причина отказа; можно — `undefined`.
 */
export function undoUnit(s: PlantState, step: BuildState['undo'][number]): string | undefined {
  const u = step.unit;
  if (!u) return undefined;
  const a = s.assets[u.id];
  if (a?.path?.step === 'ordered' && u.day === today(s)) return undefined;
  if (s.build?.leaving.some(l => l.what === 'unit' && l.id === u.id && l.step === step.n)) return undefined;
  return u.id;
}

/** Отменить шаг с единицей: заказ — без единицы и без актива; снос и перенос — без пометки. */
export function undoUnitApply(s: PlantState, step: BuildState['undo'][number]) {
  const u = step.unit;
  if (!u) return;
  const a = s.assets[u.id];
  if (a?.path?.step === 'ordered') {
    a.path.v++;
    delete s.assets[u.id];
  }
}

/**
 * Освободилось ли сносимое, снимаемое и переносимое (событие стройки `siteFree`, Б7б): снос — план без единицы, половина
 * цены назад; снятие при замене — план с новой единицей на месте прежней, половина цены прежней назад, путь — монтаж;
 * перенос — единица на новом месте, путь — монтаж своими слесарями, IQ и OQ. Занятое ждёт.
 */
export function unitFree(db: ContentDb, s: PlantState, notices: Notice[], commit: (plan: SitePlan) => void) {
  const st = s.build;
  const b = db.scenarios[s.scenario].build;
  if (!st || !b) return;
  const rate = rateOf(db, s);
  const rest: BuildState['leaving'] = [];
  for (const l of st.leaving) {
    if (l.what !== 'unit') {
      rest.push(l);
      continue;
    }
    if (unitBusy(db, s, l.id)) {
      rest.push(l);
      continue;
    }
    const swap = l.act === 'swap' ? Object.values(s.assets).find(a => a.path?.replaces === l.id && a.path.step === 'swap') : undefined;
    const mv = l.act === 'move' ? l.to : undefined;
    const op = swap
      ? { op: 'unitSwap' as const, id: l.id, newId: swap.id, type: swap.type, vendor: swap.path!.vendor! }
      : mv
        ? { op: 'unitMove' as const, id: l.id, ...mv }
        : { op: 'unitDrop' as const, id: l.id };
    const r = editPlan(db, b, s.plan, op, st.next);
    if (!r.ok) {
      notices.push({ kind: 'siteKept', what: 'unit', id: l.id, error: r.error });
      if (swap) rest.push(l);
      continue;
    }
    const vat = -part(r.refund, rate);
    const paid = -r.refund + vat;
    // планы в шагах отмены — с тем же: отмена поздней правки не вернёт снесённое и снятое и не поставит перенесённое назад
    const moved = mv ? unitOf(r.plan, l.id) : undefined;
    for (const u of st.undo) {
      if (!unitOf(u.plan, l.id)) continue;
      u.plan = swap ? swapUnit(u.plan, l.id, swap.id, swap.type, swap.path!.vendor!) : moved ? movedUnit(u.plan, l.id, moved.room, moved.place, moved.at, moved.turn) : withoutUnit(db, u.plan, l.id);
    }
    const mine = st.undo.find(u => u.n === l.step);
    if (mine) {
      mine.paid += paid;
      mine.vat += vat;
      delete mine.unit;
    }
    const old = s.assets[l.id];
    commit(r.plan);
    if (paid !== 0) pay(s, st, paid, vat, l.id);
    if (swap) {
      swap.path!.step = 'install';
      swap.path!.day = 0;
      delete swap.path!.unit;
      delete swap.path!.replaces;
      notices.push({ kind: 'siteGone', what: 'unit', id: l.id, refund: -paid });
    } else if (mv) {
      const a = s.assets[l.id];
      if (a) a.path = { step: 'install', ordered: s.t, day: 0, eng: 0, val: 0, price: 0, v: (old?.path?.v ?? 0) + 1, move: mv };
    } else notices.push({ kind: 'siteGone', what: 'unit', id: l.id, refund: -paid });
  }
  st.leaving = rest;
  forgetDown(st);
}

/** Поставка (событие `unitArrive`): остаток — в счета к оплате с отсрочкой; замена — ждёт снятия прежней, иначе — монтаж. */
export function unitArrive(db: ContentDb, s: PlantState, id: string, v: number, notices: Notice[]) {
  const a = s.assets[id];
  const p = a?.path;
  if (!a || !p || p.v !== v || p.step !== 'ordered' || !p.vendor) return;
  const vend = db.vendors[p.vendor];
  const rate = rateOf(db, s);
  const rest = p.price - part(p.price, vend.prepay);
  owe(s, 'supplier', -(rest + part(rest, rate)), dueIn(db, s, vend.payDays), a.id);
  s.cash.vat.in += part(rest, rate);
  notices.push({ kind: 'unitArrived', asset: a.id, type: a.type, family: a.family, ...(p.due !== undefined && today(s) > p.due ? { late: today(s) - p.due } : {}) });
  if (p.replaces) {
    p.step = 'swap';
    const st = (s.build ??= newBuild());
    st.leaving.push({ what: 'unit', id: p.replaces, step: 0, act: 'swap' });
    forgetDown(st);
  } else {
    p.step = 'install';
    p.day = 0;
    if (s.build) forgetDown(s.build);
  }
}

/** Есть ли на заводе свой инженер по валидации (работает, не уволен). */
const ownValidator = (s: PlantState) => Object.values(s.people).some(p => p.role === VALIDATOR);

/**
 * Каждый час (Б7в): в начале часов подрядчика рабочего дня — день шага у каждой единицы на монтаже, IQ, OQ и PQ, у
 * которой день не идёт: свои люди — задача (инженер по валидации, при переносе — слесари), иначе люди поставщика и
 * подрядчика — до конца их часов. Шаг сделан — следующий; после PQ — отчёт принимает специалист ООК; у класса без
 * квалификации после монтажа — пути нет: калибровку ставит коллега техслужбы.
 */
export function pathHour(db: ContentDb, s: PlantState) {
  const now = momentOf(s.start, s.t);
  const [from, to] = db.scenarios[s.scenario].assets.hours;
  if (now.sec !== from || !isWorkday(calOf(db, s), now.day)) return;
  for (const a of Object.values(s.assets)) {
    const p = a.path;
    if (!p || (p.step !== 'install' && p.step !== 'iq' && p.step !== 'oq' && p.step !== 'pq') || p.until !== undefined || p.task !== undefined) continue;
    advance(db, s, a);
    if (!a.path || a.path.step === 'accept') continue;
    const own = a.path.move ? a.path.step === 'install' : a.path.step !== 'install' && ownValidator(s);
    if (own) {
      const plan = planOf(db, s.plan);
      const room = placesOf(plan.plant).thing[a.id]?.room;
      const at = room ? plan.room[room] : plan.entrance;
      const t = addTask(s, { kind: a.path.move && a.path.step === 'install' ? 'mount' : 'qualify', roles: [a.path.move && a.path.step === 'install' ? FITTER : VALIDATOR], from: { kind: 'point', x: at.x, z: at.z }, work: DAY_WORK, prio: PATH_PRIO, asset: a.id });
      a.path.task = t.id;
    } else {
      a.path.until = s.t + (to - from);
      schedule(s.agenda, a.path.until, { kind: 'unitDay', asset: a.id, v: a.path.v });
    }
  }
}

/** Сделанные шаги — следующий; все — приёмка (с квалификацией) или конец пути (без неё). */
function advance(db: ContentDb, s: PlantState, a: Asset) {
  const p = a.path!;
  const steps = stepsOf(db, a.type, !!p.move);
  let i = steps.findIndex(x => x.step === p.step);
  while (i >= 0 && i < steps.length && p.day >= steps[i].days) {
    i++;
    p.day = 0;
    if (i < steps.length) p.step = steps[i].step;
  }
  if (s.build) forgetDown(s.build);
  if (i < steps.length) return;
  if (!classRec(db, a.type).qual) return void finish(db, s, a, []);
  p.step = 'accept';
  const plan = planOf(db, s.plan);
  const room = placesOf(plan.plant).thing[a.id]?.room;
  const at = room ? plan.room[room] : plan.entrance;
  const t = addTask(s, { kind: 'accept', roles: [ACCEPT.qual], from: { kind: 'point', x: at.x, z: at.z }, work: db.scenarios[s.scenario].assets.accept, prio: ACCEPT_PRIO, asset: a.id });
  p.task = t.id;
}

/** День шага кончился (событие `unitDay` или задача своего человека): день — в счёт, у людей подрядчика — к счёту. */
export function unitDay(db: ContentDb, s: PlantState, id: string, v: number) {
  const a = s.assets[id];
  const p = a?.path;
  if (!a || !p || p.v !== v || p.until === undefined) return;
  delete p.until;
  if (!p.move) p.eng++;
  if (p.step !== 'install') p.val++;
  p.day++;
  advance(db, s, a);
}

/** Задача пути кончилась: день шага своего человека — в счёт; приёмка отчёта — записи. Не задача пути — `false`. */
export function pathDone(db: ContentDb, s: PlantState, t: Task, notices: Notice[]): boolean {
  if (t.kind !== 'qualify' && t.kind !== 'mount' && t.kind !== 'accept') return false;
  const a = t.asset ? s.assets[t.asset] : undefined;
  // повторная квалификация своим инженером (Б7в): его работа кончилась — дальше как у подрядчика, приёмка
  if (t.kind === 'qualify' && a?.visit?.own === t.id) {
    visitDone(db, s, a.id, a.visit.v);
    return true;
  }
  const p = a?.path;
  if (!a || !p || p.task !== t.id) return t.kind !== 'accept';
  delete p.task;
  if (t.kind === 'accept') {
    const day = today(s);
    const cls = classRec(db, a.type);
    const recs: Asset['recs'] = [];
    if (cls.qual) recs.push({ work: 'qual', day, until: addMonths(day, cls.qual.every) - 1, by: t.people[0] });
    // калибровка — часть IQ (прил. 15, п. 3.9)
    if (cls.cal) recs.push({ work: 'cal', day, until: addMonths(day, cls.cal.every) - 1, by: t.people[0] });
    finish(db, s, a, recs, notices);
    return true;
  }
  // свой инженер по валидации — с инженером поставщика; слесари при переносе — одни
  if (!p.move) p.eng++;
  p.day++;
  advance(db, s, a);
  return true;
}

/** Конец пути: записи, счёт за дни инженеров, извещение — единица работает (или ждёт калибровки, Б3в). */
function finish(db: ContentDb, s: PlantState, a: Asset, recs: Asset['recs'], notices?: Notice[]) {
  const p = a.path!;
  a.recs = [...a.recs.filter(r => !recs.some(x => x.work === r.work)), ...recs];
  const rate = rateOf(db, s);
  const eng = p.vendor ? p.eng * db.vendors[p.vendor].engineer : 0;
  const val = p.val * (db.scenarios[s.scenario].build?.validator ?? 0);
  if (eng + val > 0) {
    post(s, -(eng + val + part(eng + val, rate)), 'equip', a.id);
    s.cash.vat.in += part(eng + val, rate);
    if (s.build) s.build.spent += eng + val + part(eng + val, rate);
  }
  delete a.path;
  if (s.build) forgetDown(s.build);
  notices?.push({ kind: 'unitReady', asset: a.id, type: a.type, family: a.family });
}

/** Монтаж идёт в помещении: оно не работает (Б7в), причина — единица. */
export function mounting(db: ContentDb, s: PlantState): Map<string, string> {
  const out = new Map<string, string>();
  const plant = planOf(db, s.plan).plant;
  for (const a of Object.values(s.assets)) {
    if (a.path?.step !== 'install') continue;
    const room = unitOf(plant, a.id)?.room;
    if (room && !out.has(room)) out.set(room, a.id);
  }
  return out;
}

/** Обещанный день поставки прошёл, а единицы нет — опаздывает (полночь): извещение один раз. */
export function pathMidnight(s: PlantState, notices: Notice[]) {
  const d = today(s);
  for (const a of Object.values(s.assets)) if (a.path?.step === 'ordered' && a.path.due !== undefined && a.path.due === d - 1) notices.push({ kind: 'unitLate', asset: a.id, type: a.type, family: a.family });
}

/**
 * Двойник прогона плана (src/engine/plan/twin.ts): настоящий день поставки заказанной единицы — заново от зерна прогона:
 * не позже обещанного — по доле опозданий поставщика; обещанный прошёл — опоздает на столько суток, но не раньше завтра.
 */
export function redrawArrive(db: ContentDb, s: PlantState) {
  const cal = calOf(db, s);
  const from = db.scenarios[s.scenario].assets.hours[0];
  for (const a of Object.values(s.assets)) {
    const p = a.path;
    if (p?.step !== 'ordered' || !p.vendor || p.due === undefined) continue;
    const v = db.vendors[p.vendor];
    const d = today(s);
    const late = roll(s, `equip-late/${p.vendor}`, r => (r.int(10_000) < v.late.share || p.due! < d ? r.range(v.late.days[0], v.late.days[1]) : 0));
    const day = workdayOnOrAfter(cal, Math.max(p.due + late, p.due < d ? d + 1 : p.due));
    p.arrive = (day - daysFromCivil(s.start)) * DAY + from;
    p.v++;
    schedule(s.agenda, p.arrive, { kind: 'unitArrive', asset: a.id, v: p.v });
  }
}
