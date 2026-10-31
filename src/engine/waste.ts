// Вывоз отклонённого (Б1з; docs/specs/2026-10-vertical-slice.md, «Б1з»; геймдизайн, §4.5): вывоз на уничтожение заказывает
// склад — команда `waste` поста «Снабжение и склад»; пока пост не у игрока, — коллега склада в 09:00 рабочего дня, когда
// в зоне отклонённого заняты две трети мест или паллета ждёт вывоза дольше срока. Вывоз один: пока подрядчик не уехал,
// второго не заказывают. Подрядчик по договору приезжает на следующий рабочий день к началу своих часов; его фура встаёт
// к рампе отгрузки, как фура покупателя (market.ts, `dockNext`), а рампа занята — ждёт во дворе. Кладовщик и водитель
// грузят в кузов всё, что лежит в зоне, когда фура встала; передачу подписывает начальник ОКК; фура уезжает: счёт — выезд
// и паллеты, с НДС к вычету; запись — в журнале отходов. Тара и паллеты уходят из учёта склада, количество — в списанное
// партии, а сама партия остаётся: вывоз, которым она ушла, — в журнале. Отклонённый балк выносят из промежуточного склада
// (mes.ts, `bulkOut`) — дальше он едет в зону, как всё отклонённое.
import type { ContentDb } from '../content/types';
import { part, post } from './cash';
import { addMonths, addWorkdays, civilFromDays, DAY, daysFromCivil, HOUR, isWorkday, lastOfMonth, momentOf } from './core/calendar';
import { note, noteCmd } from './journal';
import { planOf } from './plant';
import { playerHolds } from './seats';
import { nextId } from './stock';
import { addTask } from './tasks';
import type { Command, Notice, PlantState, Task, Truck, Unit, WasteEntry, WasteLot } from './types';
import { WMS } from './wms';
import { calOf } from './workdays';

/** Кто подписывает передачу подрядчику (GMP ЕАЭС, ч. I, п. 2.8 i): одобряет и отклоняет — руководитель ОКК. */
export const WASTE = { signers: ['role.qc-head'] } as const;

/** Приоритеты: погрузка — как у фуры покупателя, она держит рампу; подпись — сразу после погрузки (гипотеза). */
export const WASTE_PRIO = { load: 45, sign: 40 } as const;

/** Коллега склада смотрит зону в 09:00 рабочего дня, как коллега снабжения — заказы (гипотеза). */
export const WASTE_HOUR = 9 * HOUR;

/**
 * Правило коллеги склада (геймдизайн, §4.5, гипотезы): заняты две трети мест зоны — `FULL[0] / FULL[1]`; паллета ждёт
 * вывоза дольше `KEEP` месяцев с решения об отклонении — чтобы не выйти за 11 месяцев накопления отходов (`fz-89`, ст. 1).
 */
export const FULL = [2, 3] as const;
export const KEEP = 10;

/** Паллеты в зоне отклонённого: на местах зоны, по порядку мест плана. */
export function zoneUnits(db: ContentDb, s: PlantState): Unit[] {
  const out: Unit[] = [];
  for (const sl of planOf(db, s.plant).byKind.rejected ?? []) {
    const id = s.slots[sl.id]?.unit;
    if (id) out.push(s.units[id]);
  }
  return out;
}

/** Сколько мест в зоне отклонённого. */
export const zonePlaces = (db: ContentDb, s: PlantState) => (planOf(db, s.plant).byKind.rejected ?? []).length;

/** С какого мгновения отклонена партия паллеты — с этого она отходы; в сохранениях до схемы 10 — мгновение приёмки. */
function rejectedAt(s: PlantState, u: Unit): number {
  const c = s.containers[u.items[0]];
  const lot = c ? s.lots[c.lot] : undefined;
  return lot ? (lot.since ?? lot.received) : s.t;
}

/** Мгновение `sec` секунд от полуночи дня `z` (номер дня от 1970-01-01). */
const at = (s: PlantState, z: number, sec: number) => (z - daysFromCivil(s.start)) * DAY + sec;

/**
 * Команда «Заказать вывоз» (Б1з): у сценария нет подрядчика — отказ; вывоз уже заказан — отказ; зона пуста — отказ. Пост
 * команды — «Снабжение и склад» (seats.ts): чужую команду игрока движок отклоняет раньше.
 */
export function wasteCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'waste' }>, notices: Notice[]) {
  if (!db.scenarios[s.scenario].waste) return notices.push({ kind: 'refused', cmd: 'waste', why: 'noWaste' });
  if (s.waste.order) return notices.push({ kind: 'refused', cmd: 'waste', why: 'already', detail: s.waste.order.id });
  if (zoneUnits(db, s).length === 0) return notices.push({ kind: 'refused', cmd: 'waste', why: 'empty' });
  const order = book(db, s, cmd.by ?? 'player');
  // журнал решений (Б5а): игрок — с местом, с которого заказал
  noteCmd(s, cmd, { kind: 'waste', order: order.id, at: order.at });
}

/** Заказ вывоза: подрядчик приедет на следующий рабочий день, к началу своих часов. */
function book(db: ContentDb, s: PlantState, by: string) {
  const w = db.scenarios[s.scenario].waste!;
  const today = momentOf(s.start, s.t).day;
  const order = { id: nextId(s, 'W'), booked: s.t, by, at: at(s, addWorkdays(calOf(db, s), today, 1), w.hours[0]) };
  s.waste.order = order;
  return order;
}

/**
 * Каждый час (Б1з): в 09:00 рабочего дня — коллега склада, пока пост «Снабжение и склад» не у игрока; в день вывоза, к
 * началу часов подрядчика, — его фура: к рампе её поставит шаг отгрузки (market.ts), когда рампа свободна.
 */
export function wasteHour(db: ContentDb, s: PlantState) {
  const w = db.scenarios[s.scenario].waste;
  if (!w) return;
  const now = momentOf(s.start, s.t);
  if (now.sec === WASTE_HOUR && !s.waste.order && !playerHolds(s, 'wms') && isWorkday(calOf(db, s), now.day)) colleague(db, s, now.day);
  const o = s.waste.order;
  if (o && o.truck === undefined && s.t >= o.at) {
    const dock = db.plants[s.plant].docks.find(d => d.kind === 'out')!.id;
    const tr: Truck = { id: nextId(s, 'R'), dock, waste: o.id, units: [], arrived: s.t, docked: false, open: false };
    s.trucks[tr.id] = tr;
    o.truck = tr.id;
  }
}

/**
 * Коллега склада (Б1з; геймдизайн, §4.5, §29.3): заняты две трети мест зоны или паллета ждёт вывоза дольше срока — вывоз
 * на следующий рабочий день. Журнал решений — начальник склада: сколько мест занято из скольких, а по сроку — с какого
 * мгновения отклонена самая давняя паллета.
 */
function colleague(db: ContentDb, s: PlantState, today: number) {
  const units = zoneUnits(db, s);
  if (units.length === 0) return;
  const places = zonePlaces(db, s);
  const full = units.length * FULL[1] >= places * FULL[0];
  const since = Math.min(...units.map(u => rejectedAt(s, u)));
  const old = addMonths(momentOf(s.start, since).day, KEEP) <= today;
  if (!full && !old) return;
  const order = book(db, s, 'head:wms');
  note(s, 'wms', { kind: 'waste', order: order.id, at: order.at, why: { used: units.length, places, ...(old ? { since } : {}), months: KEEP } });
}

/**
 * Фура подрядчика встала к рампе (market.ts, `dockNext`): кузов открыт; всё, что лежит в зоне сейчас, — в погрузку,
 * задачами техники, как погрузка фуры покупателя. Грузить нечего — сразу подпись.
 */
export function wasteDocked(db: ContentDb, s: PlantState, tr: Truck) {
  tr.open = true;
  const busy = new Set(Object.values(s.tasks).flatMap(t => (t.unit ? [t.unit] : [])));
  let n = 0;
  for (const u of zoneUnits(db, s)) {
    if (busy.has(u.id) || u.where.kind !== 'slot') continue;
    addTask(s, { kind: 'wasteLoad', roles: [...WMS.movers], veh: [...WMS.floor], unit: u.id, from: { kind: 'slot', id: u.where.id }, work: 0, prio: WASTE_PRIO.load, truck: tr.id });
    n++;
  }
  if (n === 0) signTask(db, s, tr);
}

/** Подпись передачи начальником ОКК — у фуры. */
function signTask(db: ContentDb, s: PlantState, tr: Truck) {
  const w = db.scenarios[s.scenario].waste!;
  addTask(s, { kind: 'wasteSign', roles: [...WASTE.signers], from: { kind: 'truck', id: tr.id }, work: w.sign, prio: WASTE_PRIO.sign, truck: tr.id });
}

/** Что сделала задача вывоза, когда кончилась. Не задача вывоза — `false`. */
export function wasteDone(db: ContentDb, s: PlantState, t: Task, notices: Notice[]): boolean {
  switch (t.kind) {
    case 'wasteLoad': {
      const u = s.units[t.unit!];
      const tr = s.trucks[t.truck!];
      if (u.where.kind === 'slot') delete s.slots[u.where.id].unit;
      u.where = { kind: 'truck', id: tr.id };
      tr.units.push(u.id);
      // место в зоне освободилось: паллеты, ждавшие места, поедут сюда — их задачи раздаст раздатчик
      if (!Object.values(s.tasks).some(x => x.kind === 'wasteLoad' && x.truck === tr.id)) signTask(db, s, tr);
      return true;
    }
    case 'wasteSign':
      depart(db, s, s.trucks[t.truck!], t.people[0], notices);
      return true;
    default:
      return false;
  }
}

/**
 * Передача подписана — фура уезжает: тара и паллеты — из учёта, количество — в списанное партии; запись журнала отходов с
 * партиями, паллетами и тарой, у ГП — с кодами пачек; счёт — сегодня: выезд и обезвреживание за паллету, НДС — к вычету,
 * как у подрядчика калибровки (assets.ts). Рампа свободна — следующую фуру поставит шаг отгрузки.
 */
function depart(db: ContentDb, s: PlantState, tr: Truck, signed: string, _notices: Notice[]) {
  const w = db.scenarios[s.scenario].waste!;
  const o = s.waste.order!;
  const byLot = new Map<string, WasteLot & { units: Set<string> }>();
  for (const uid of tr.units) {
    const u = s.units[uid];
    for (const cid of u.items) {
      const c = s.containers[cid];
      const lot = s.lots[c.lot];
      let x = byLot.get(lot.id);
      if (!x) byLot.set(lot.id, (x = { lot: lot.id, pallets: 0, containers: 0, qty: 0, units: new Set() }));
      x.units.add(uid);
      x.containers++;
      x.qty += c.qty;
      if (c.codes) (x.codes ??= []).push(...c.codes.map(r => [r[0], r[1]] as [number, number]));
      lot.written += c.qty;
      delete s.containers[cid];
    }
    delete s.units[uid];
  }
  // партии — по порядку их номеров, как в учёте склада
  const lots: WasteLot[] = [...byLot.values()].sort((a, b) => Number(a.lot.slice(1)) - Number(b.lot.slice(1))).map(({ units, ...x }) => ({ ...x, pallets: units.size }));
  const sum = w.trip + w.pallet * tr.units.length;
  const vat = part(sum, db.profiles[db.scenarios[s.scenario].profile].vat.general);
  post(s, -(sum + vat), 'waste', o.id);
  s.cash.vat.in += vat;
  const d = civilFromDays(momentOf(s.start, s.t).day);
  const entry: WasteEntry = { id: o.id, t: s.t, booked: o.booked, by: o.by, lots, pallets: tr.units.length, signed, sum, vat, act: lastOfMonth(d.y, d.m) + 30 };
  s.waste.log.push(entry);
  delete s.waste.order;
  delete s.trucks[tr.id];
}
