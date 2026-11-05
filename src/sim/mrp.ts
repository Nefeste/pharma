// Потребность в материалах для окна (Б6д; docs/specs/2026-10-vertical-slice.md, «Б6д»; геймдизайн, §9.3): вкладка
// «Материалы» расписания — материалы по видам на 12 месяцев, плановые заказы и заказы поставщикам в пути с сообщениями и
// рычагами «Ускорить» и «Отменить», — и блок планёрки. Числа — расчёт потребности (src/engine/plan/mrp.ts) и записи
// завода: партии, заказы поставщикам, договоры; истины тут нет. Вид дорогой — не чаще раза в секунду (`VIEW_SLOW`).
import type { ContentDb, Id } from '../content/types';
import { type MrpMsg, type MrpOrder, type MrpRow, mrpPlan } from '../engine/plan/mrp';
import { cancelQuote, fastQuote, howOf } from '../engine/supply';
import type { PlantState, Refusal } from '../engine/types';

export interface MrpQuery {
  view: 'mrp';
}

/**
 * Заказ поставщику в пути: строки и приход; ускорен ли; что даст «Ускорить» — новый приход и доплата с НДС — и
 * «Отменить» — неустойка и возврат предоплаты, — или почему нельзя.
 */
export interface MrpPoRow {
  po: string;
  supplier: Id;
  lines: { material: Id; qty: number }[];
  eta: number;
  fast?: true;
  speed: { eta: number; fee: number } | { why: Refusal };
  cancel: { fee: number; back: number } | { why: Refusal };
}

/** Вкладка «Материалы»: месяцы с первого, сегодня, срок завоза, как заказывает снабжение; строки, плановые заказы, сообщения и заказы в пути. */
export interface MrpView {
  view: 'mrp';
  from: number;
  today: number;
  arrive: number;
  how: 'need' | 'point';
  rows: MrpRow[];
  planned: MrpOrder[];
  msgs: MrpMsg[];
  pos: MrpPoRow[];
}

const num = (id: string) => Number(id.replace(/\D/g, ''));

export function mrpView(db: ContentDb, s: PlantState): MrpView {
  const r = mrpPlan(db, s);
  const pos = Object.values(s.pos)
    .filter(p => p.status === 'ordered')
    .sort((a, b) => a.eta - b.eta || num(a.id) - num(b.id))
    .map((p): MrpPoRow => {
      const f = fastQuote(db, s, p.id);
      const c = cancelQuote(s, p.id);
      return {
        po: p.id,
        supplier: p.supplier,
        lines: p.lines.map(l => ({ material: l.material, qty: l.qty })),
        eta: p.eta,
        ...(p.fast ? { fast: true as const } : {}),
        speed: 'why' in f ? { why: f.why } : { eta: f.eta, fee: f.net + f.vat },
        cancel: 'why' in c ? { why: c.why } : { fee: c.fee, back: c.back },
      };
    });
  return { view: 'mrp', from: r.from, today: r.today, arrive: r.arrive, how: howOf(db, s), rows: r.rows, planned: r.planned, msgs: r.msgs, pos };
}

/** Блок планёрки «Материалы»: плановые заказы с датой сегодня и раньше — сколько, к какому дню, на сколько суток опоздают; заказы в пути, которые опоздают. */
export interface MrpMeeting {
  due: { material: Id; supplier: Id; qty: number; need: number; late: number }[];
  late: { po: string; material: Id; days: number }[];
}

/** Блок планёрки «Материалы» (Б6д): только у сценария с прогнозом; заказывать нечего и ничего не опоздает — нет. */
export function mrpMeeting(db: ContentDb, s: PlantState): MrpMeeting | undefined {
  const sc = db.scenarios[s.scenario];
  if (!s.forecast || !sc.plan || !sc.supply) return undefined;
  const r = mrpPlan(db, s);
  const due = r.planned.filter(o => o.orderBy <= r.today).map(o => ({ material: o.material, supplier: o.supplier, qty: o.qty, need: o.need, late: o.late }));
  const late = r.msgs.flatMap(m => (m.kind === 'late' ? [{ po: m.po, material: m.material, days: m.days }] : []));
  return due.length + late.length > 0 ? { due, late } : undefined;
}
