// Отклонённое для окна (Б1з; docs/specs/2026-10-vertical-slice.md, «Б1з», «Окно»): на планёрке — сколько мест зоны
// занято из скольких, сколько паллет ждут места и где, когда вывоз, вчерашние вывозы; в карточке помещения отклонённого —
// места и партии на них, ждущие места, заказанный вывоз, журнал отходов; в досье серии — вывоз, которым ушла её партия.
// Данные — без слов и без истины: места, номера партий и серий, количества в таре, мгновения, суммы — записи завода.
import type { ContentDb, Id } from '../content/types';
import { batchNo } from '../engine/batchno';
import { planOf } from '../engine/plant';
import type { PlantState, WasteEntry, WasteOrder } from '../engine/types';
import { zonePlaces, zoneUnits } from '../engine/waste';

type Code = [number, number, number];
const code = (c: { y: number; m: number; n: number }): Code => [c.y, c.m, c.n];
const num = (id: string) => Number(id.slice(1));

/** Кто заказал вывоз: игрок или коллега склада. */
export type WasteBy = 'player' | 'colleague';
const byOf = (by: string): WasteBy => (by === 'player' ? 'player' : 'colleague');

/** Заказанный вывоз: когда приедет подрядчик, кто заказал; фура приехала — у рампы или во дворе. */
export interface WasteOrderView {
  at: number;
  by: WasteBy;
  truck?: 'yard' | 'dock';
}

/** Паллеты, которые ждут места в зоне: где они сейчас — вид места плана или помещение, — и сколько. */
export interface WaitRow {
  where: string;
  n: number;
}

/** Отклонённое на планёрке: занято мест из скольких, ждут места, вывоз, вывозы с прошлой планёрки — паллеты и сумма с НДС. */
export interface RejectSum {
  used: number;
  places: number;
  waiting: WaitRow[];
  order?: WasteOrderView;
  out: { t: number; pallets: number; sum: number }[];
}

/** Партия журнала отходов: внутренний номер, материал, номер серии; паллет, тары и сколько в ней — мг или шт. */
export interface WasteLotRow {
  lot?: Code;
  material?: Id;
  batch?: string;
  bn?: number;
  pallets: number;
  containers: number;
  qty: number;
}

/**
 * Вывоз в журнале отходов: когда фура уехала, кто заказал, кто подписал передачу (роль и табельный номер), партии,
 * паллет, сумма без НДС и НДС, до какого дня придёт акт об обезвреживании.
 */
export interface WasteRow {
  t: number;
  by: WasteBy;
  signed?: { role: Id; tab: number };
  lots: WasteLotRow[];
  pallets: number;
  sum: number;
  vat: number;
  act: number;
}

/** Место зоны в карточке помещения: номер места плана; партия на нём — номер, материал, серия, с какого мгновения отклонена. */
export interface ZonePlace {
  slot: number;
  unit?: number;
  lot?: Code;
  material?: Id;
  batch?: string;
  since?: number;
}

/** Помещение отклонённого в карточке: места зоны, ждущие места, заказанный вывоз, журнал отходов от новых к старым. */
export interface WasteRoom {
  places: ZonePlace[];
  waiting: WaitRow[];
  order?: WasteOrderView;
  log: WasteRow[];
}

/** Вывоз, заказанный сейчас, — словами окна; нет — `undefined`. */
function orderOf(s: PlantState, o: WasteOrder | undefined): WasteOrderView | undefined {
  if (!o) return undefined;
  const tr = o.truck ? s.trucks[o.truck] : undefined;
  return { at: o.at, by: byOf(o.by), ...(tr ? { truck: tr.docked ? ('dock' as const) : ('yard' as const) } : {}) };
}

/** Паллеты, которые ждут места в зоне отклонённого или выноса из промежуточного склада: где они сейчас — по видам мест. */
export function waitingRows(db: ContentDb, s: PlantState): WaitRow[] {
  const plan = planOf(db, s.plant);
  const by = new Map<string, number>();
  for (const t of Object.values(s.tasks)) {
    if (t.state !== 'open' || !t.unit || !(t.toKind === 'rejected' || t.kind === 'bulkOut')) continue;
    const u = s.units[t.unit];
    if (!u) continue;
    const where = u.where.kind === 'slot' ? (plan.slot[u.where.id]?.kind ?? 'slot') : u.where.kind === 'room' ? (plan.plant.rooms.find(r => r.id === u.where.id)?.type ?? 'room') : 'truck';
    by.set(where, (by.get(where) ?? 0) + 1);
  }
  return [...by].map(([where, n]) => ({ where, n })).sort((a, b) => b.n - a.n || (a.where < b.where ? -1 : 1));
}

/** Отклонённое на планёрке: вывозы — те, что уехали в окне `from`…`at`. У сценария без подрядчика — `undefined`. */
export function rejectSum(db: ContentDb, s: PlantState, from: number, at: number): RejectSum | undefined {
  if (!db.scenarios[s.scenario].waste) return undefined;
  const o = orderOf(s, s.waste.order);
  return {
    used: zoneUnits(db, s).length,
    places: zonePlaces(db, s),
    waiting: waitingRows(db, s),
    ...(o ? { order: o } : {}),
    out: s.waste.log.filter(e => e.t >= from && e.t < at).map(e => ({ t: e.t, pallets: e.pallets, sum: e.sum + e.vat })),
  };
}

/** Запись журнала отходов словами окна: партии — номера, материалы и серии; подписавший — роль и табельный номер. */
export function wasteRow(s: PlantState, e: WasteEntry): WasteRow {
  const p = s.people[e.signed] ?? s.former[e.signed];
  return {
    t: e.t,
    by: byOf(e.by),
    ...(p ? { signed: { role: p.role, tab: p.tab } } : {}),
    lots: e.lots.map(x => {
      const lot = s.lots[x.lot];
      const b = lot?.batch ? s.batches[lot.batch] : undefined;
      return {
        ...(lot ? { lot: code(lot.code), material: lot.material } : {}),
        ...(b ? { batch: batchNo(b.code), bn: num(b.id) } : {}),
        pallets: x.pallets,
        containers: x.containers,
        qty: x.qty,
      };
    }),
    pallets: e.pallets,
    sum: e.sum,
    vat: e.vat,
    act: e.act,
  };
}

/** Помещение отклонённого в карточке (Б1з): места зоны по порядку плана, ждущие места, вывоз, журнал — от новых к старым. */
export function wasteRoom(db: ContentDb, s: PlantState): WasteRoom {
  const plan = planOf(db, s.plant);
  const places = (plan.byKind.rejected ?? []).map(sl => {
    const slot = plan.slots.findIndex(x => x.id === sl.id);
    const uid = s.slots[sl.id]?.unit;
    const u = uid ? s.units[uid] : undefined;
    const c = u ? s.containers[u.items[0]] : undefined;
    const lot = c ? s.lots[c.lot] : undefined;
    const b = lot?.batch ? s.batches[lot.batch] : undefined;
    return {
      slot,
      ...(u ? { unit: num(u.id) } : {}),
      ...(lot ? { lot: code(lot.code), material: lot.material, since: lot.since ?? lot.received } : {}),
      ...(b ? { batch: batchNo(b.code) } : {}),
    };
  });
  const o = orderOf(s, s.waste.order);
  return { places, waiting: waitingRows(db, s), ...(o ? { order: o } : {}), log: s.waste.log.map(e => wasteRow(s, e)).reverse() };
}

/** Вывозы, которыми ушли партии `lots` (Б1з): мгновения, когда уехала фура, по порядку. */
export function wastedAt(s: PlantState, lots: readonly string[]): number[] {
  const want = new Set(lots);
  return s.waste.log.filter(e => e.lots.some(x => want.has(x.lot))).map(e => e.t);
}
