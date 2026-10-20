// Обеспечение качества (docs/specs/2026-10-engine.md, 1г; геймдизайн, §6.4–6.5): проверка упакованной серии — ГП и
// досье — специалистом ООК с архивными образцами, затем решение уполномоченного лица: выпустить, держать, отклонить.
// Выпущенное — на стеллажи, отклонённое — в зону отклонённого. Команда `release` — решение игрока вместо УЛ.
import type { ContentDb } from '../content/types';
import { part, post } from './cash';
import { MIN, momentOf } from './core/calendar';
import { defect } from './lean';
import { fgExpiry, prodDay } from './line';
import { toRzn } from './market';
import { planOf } from './plant';
import { addTask } from './tasks';
import { containersByLot, FG_FLOW, setLotStatus, stockChanged, unitsOfLot } from './stock';
import type { Batch, Command, Container, Lot, Notice, PlantState, Task, Unit } from './types';
import { PRIO, WMS } from './wms';

export const QA = { specialists: ['role.qa'], qps: ['role.qp'] } as const;

/** Проверка ГП и досье серии — 2 часа специалиста ООК; решение уполномоченного лица — 45 минут (гипотезы, §6.4–6.5). */
export const FG_CHECK_WORK = 120 * MIN;
export const QP_WORK = 45 * MIN;

export const QA_PRIO = { fgCheck: 26, qpDecide: 26 } as const;

const busy = (s: PlantState, uid: string) => Object.values(s.tasks).some(t => t.unit === uid);

/** Упакованные серии, все паллеты которых стоят в карантине ГП, — на проверку ООК. Зовётся после каждого события. */
export function qaStep(db: ContentDb, s: PlantState) {
  const plan = planOf(db, s.plant);
  for (const b of Object.values(s.batches)) {
    if (b.status !== 'fg' || b.checked !== undefined) continue;
    if (Object.values(s.tasks).some(t => t.batch === b.id && (t.kind === 'fgCheck' || t.kind === 'qpDecide'))) continue;
    const lot = s.lots[b.pack!.fg!];
    const units = unitsOfLot(s, lot.id);
    if (!units.every(u => u.where.kind === 'slot' && plan.slot[u.where.id].kind === 'fgQuarantine' && !busy(s, u.id))) continue;
    const at = plan.byKind.fgQuarantine[0];
    addTask(s, { kind: 'fgCheck', roles: [...QA.specialists], from: { kind: 'point', x: at.x, z: at.z }, work: FG_CHECK_WORK, prio: QA_PRIO.fgCheck, batch: b.id, lot: lot.id });
  }
}

/** Что сделала задача качества, когда кончилась. Не задача качества — `false`. */
export function qaDone(db: ContentDb, s: PlantState, t: Task, notices: Notice[]): boolean {
  switch (t.kind) {
    case 'fgCheck': {
      const b = s.batches[t.batch!];
      retain(db, s, b);
      b.checked = s.t;
      decideTask(db, s, b);
      return true;
    }
    case 'qpDecide':
      decide(db, s, s.batches[t.batch!], notices);
      return true;
    default:
      return false;
  }
}

function decideTask(db: ContentDb, s: PlantState, b: Batch) {
  const plan = planOf(db, s.plant);
  addTask(s, { kind: 'qpDecide', roles: [...QA.qps], from: { kind: 'point', x: plan.lab.x, z: plan.lab.z }, work: QP_WORK, prio: QA_PRIO.qpDecide, batch: b.id, lot: b.pack!.fg });
}

/**
 * Архивные образцы серии (GMP ЕАЭС, прил. 19) — пачки из последних ящиков: код уходит в «архив», пачка — из ящика,
 * партия ГП их отбирает.
 */
function retain(db: ContentDb, s: PlantState, b: Batch) {
  const job = b.pack!;
  const lot = s.lots[job.fg!];
  let left = db.materials[lot.material].sample;
  const cases = (containersByLot(s).get(lot.id) ?? []).slice().reverse();
  for (const c of cases) {
    if (left <= 0) break;
    const q = Math.min(left, c.qty);
    job.retained.push(...takeCodes(c, q));
    c.qty -= q;
    lot.sampled += q;
    left -= q;
    if (c.qty === 0) {
      // ящик опустел — из учёта; опустела и паллета (последний неполный ящик) — с места тоже
      const u = s.units[c.unit];
      u.items = u.items.filter(id => id !== c.id);
      delete s.containers[c.id];
      if (u.items.length === 0) {
        if (u.where.kind === 'slot') delete s.slots[u.where.id].unit;
        delete s.units[u.id];
      }
    }
  }
}

/** Снять `q` последних кодов ящика. */
function takeCodes(c: Container, q: number): number[] {
  const out: number[] = [];
  const codes = c.codes!;
  while (q > 0) {
    const r = codes[codes.length - 1];
    out.push(r[0] + r[1] - 1);
    r[1]--;
    if (r[1] === 0) codes.pop();
    q--;
  }
  return out;
}

/**
 * Решение уполномоченного лица (прил. 16, п. 6.1; §6.5): решение игрока, если оно есть; иначе политика — открытые
 * отклонения серии, её балка или ГП — «держать», иначе — «выпустить». Выпуск при открытых отклонениях — только решением
 * игрока: отклонения оценены «без влияния на качество».
 */
function decide(db: ContentDb, s: PlantState, b: Batch, notices: Notice[]) {
  const lot = s.lots[b.pack!.fg!];
  const open = Object.values(s.deviations).filter(d => d.status === 'open' && (d.batch === b.id || d.lot === b.bulk || d.lot === lot.id));
  const decision = b.decision ?? (open.length > 0 ? 'hold' : 'release');
  delete b.decision;
  if (decision === 'hold') {
    b.held = true;
    // удержанная ГП ждёт нового решения на стеллаже, заблокированной (Б2в): иначе три удержанные серии займут всю зону
    // карантина ГП, и линии некуда будет ставить новые паллеты
    if (lot.status === 'quarantine') setLotStatus(s, lot, 'blocked', FG_FLOW);
    for (const u of unitsOfLot(s, lot.id)) settle(db, s, lot, u);
    notices.push({ kind: 'batchHeld', batch: b.id });
    return;
  }
  delete b.held;
  if (decision === 'release') {
    for (const d of open) d.status = 'assessed';
    setLotStatus(s, lot, 'released', FG_FLOW);
    // срок годности — от выпуска, если он не позже 30 дней от производства (Рекомендация Коллегии ЕЭК № 2)
    lot.expiry = fgExpiry(prodDay(db, s, b), momentOf(s.start, s.t).day, db.materials[lot.material].shelf);
    b.status = 'released';
    b.released = s.t;
    toRzn(s, lot.id);
    codesFee(db, s, b);
    stockChanged(s);
    notices.push({ kind: 'batchReleased', batch: b.id, lot: lot.id });
  } else {
    setLotStatus(s, lot, 'rejected', FG_FLOW);
    b.status = 'rejected';
    defect(s, 'batches');
    notices.push({ kind: 'batchRejected', batch: b.id, lot: lot.id });
  }
  for (const u of unitsOfLot(s, lot.id)) settle(db, s, lot, u);
}

/**
 * Плата за коды маркировки серии (`pp-577`): за каждый напечатанный код, кроме позиций ЖНВЛП с зарегистрированной ценой не
 * выше порога профиля; платим в день выпуска — не позже ввода в оборот (`mdlp`, п. 9.1). НДС — по общей ставке.
 */
function codesFee(db: ContentDb, s: PlantState, b: Batch) {
  const sku = db.skus[b.pack!.sku];
  const pr = db.profiles[db.scenarios[s.scenario].profile];
  if (db.products[sku.product].jnvlp && sku.regPrice !== undefined && sku.regPrice <= pr.marking.free) return;
  const net = (b.pack!.cartons ?? 0) * pr.marking.fee;
  const tax = part(net, pr.vat.general);
  s.cash.vat.in += tax;
  post(s, -(net + tax), 'codes', b.id);
}

/**
 * Паллета решённой ГП: выпущенная — на стеллаж ближе к экспедиции, удержанная (заблокированная) — тоже на стеллаж, ждать
 * нового решения; отклонённая — в зону отклонённого.
 */
export function settle(db: ContentDb, s: PlantState, lot: Lot, u: Unit) {
  if (u.where.kind !== 'slot' || busy(s, u.id)) return;
  const plan = planOf(db, s.plant);
  const at = plan.slot[u.where.id];
  const from = { kind: 'slot' as const, id: at.id };
  if ((lot.status === 'released' || lot.status === 'blocked') && at.kind !== 'storage') {
    const ship = plan.byKind.shipping?.[0] ?? at;
    addTask(s, { kind: 'putaway', roles: [...WMS.movers], veh: [...WMS.floor], unit: u.id, from, toKind: 'storage', near: { x: ship.x, z: ship.z }, work: 0, prio: PRIO.putaway, lot: lot.id });
  } else if (lot.status === 'rejected' && at.kind !== 'rejected') {
    addTask(s, { kind: 'move', roles: [...WMS.movers], veh: [...WMS.floor], unit: u.id, from, toKind: 'rejected', work: 0, prio: PRIO.putaway, lot: lot.id });
  }
}

/** Команда `release`: решение игрока по упакованной серии вместо уполномоченного лица. */
export function releaseCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'release' }>, notices: Notice[]) {
  const b = s.batches[cmd.batch];
  if (!b) return notices.push({ kind: 'refused', cmd: 'release', why: 'noBatch', detail: cmd.batch });
  if (b.status !== 'fg') return notices.push({ kind: 'refused', cmd: 'release', why: 'notReady', detail: cmd.batch });
  b.decision = cmd.decision;
  // проверка ООК уже была (серию держат) — сразу к уполномоченному лицу; иначе решение дождётся проверки
  if (b.checked !== undefined && !Object.values(s.tasks).some(t => t.kind === 'qpDecide' && t.batch === b.id)) decideTask(db, s, b);
}
