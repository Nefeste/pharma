// Правки плана на планёрке (Б6е; docs/specs/2026-10-vertical-slice.md, «Б6е»): события коммерции за 24 часа до 08:00 —
// крупные заказы и снятый спрос — и правки плана в замороженном горизонте с их ценой. Всё — записи журнала решений: что
// знает завод; истины тут нет.
import type { ContentDb, Id, SeatId } from '../content/types';
import type { EditPrice, PlantState } from '../engine/types';
import { laterCodes } from './journal';

/** Событие коммерции: крупный заказ — со сроком и номером заказа, снятый спрос — без. */
export interface EventRow {
  t: number;
  kind: 'big' | 'cut';
  customer: Id;
  sku: Id;
  cases: number;
  due?: number;
  order?: string;
}

/** Правка в горизонте: новое, сдвинутое или снятое задание — кто правил и цена. */
export interface EditRow {
  t: number;
  kind: 'order' | 'shift' | 'cancel';
  batch?: string;
  sku?: Id;
  by: 'player' | 'head';
  seat?: SeatId;
  price: EditPrice;
  /** номера серий заданий, которые кончат позже, — у тех, кому номер выдан */
  codes?: Record<string, string>;
}

export interface EditsMeeting {
  events: EventRow[];
  edits: EditRow[];
}

/** Блок «Правки плана»: записи журнала в окне [from, at); ни событий, ни правок — нет блока. */
export function editsMeeting(_db: ContentDb, s: PlantState, from: number, at: number): EditsMeeting | undefined {
  const events: EventRow[] = [];
  const edits: EditRow[] = [];
  for (const r of s.journal) {
    if (r.t < from || r.t >= at) continue;
    const d = r.d;
    if (d.kind === 'bigOrder') events.push({ t: r.t, kind: 'big', customer: d.customer, sku: d.sku, cases: d.cases, due: d.due, order: d.order });
    else if (d.kind === 'demandCut') events.push({ t: r.t, kind: 'cut', customer: d.customer, sku: d.sku, cases: d.cases });
    else if ((d.kind === 'order' || d.kind === 'cancel' || d.kind === 'shift') && d.frozen) {
      const codes = laterCodes(s, d.frozen);
      edits.push({ t: r.t, kind: d.kind, ...(d.batch ? { batch: d.batch } : {}), ...(d.sku ? { sku: d.sku } : {}), by: r.by === 'player' ? 'player' : 'head', ...(r.seat ? { seat: r.seat } : {}), price: d.frozen, ...(codes ? { codes } : {}) });
    }
  }
  return events.length + edits.length > 0 ? { events, edits } : undefined;
}
