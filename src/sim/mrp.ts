// Потребность в материалах для окна (Б6д; docs/specs/2026-10-vertical-slice.md, «Б6д»; геймдизайн, §9.3): вкладка
// «Материалы» расписания — материалы по видам на 12 месяцев, плановые заказы и заказы поставщикам в пути с сообщениями и
// рычагами «Ускорить» и «Отменить», — и блок планёрки. Числа — расчёт потребности (src/engine/plan/mrp.ts) и записи
// завода: партии, заказы поставщикам, договоры; истины тут нет. Вид дорогой — не чаще раза в секунду (`VIEW_SLOW`). С Б6ж
// приход заказа в пути — обещанный, у планового заказа — предложения одобренных поставщиков с баллами и почему этот
// поставщик; на планёрке — заказы, что не пришли к обещанному, и одобрения пар в работе.
import type { ContentDb, Id } from '../content/types';
import { type Offer, offersFor } from '../engine/partners';
import { type MrpMsg, type MrpOrder, type MrpRow, mrpPlan } from '../engine/plan/mrp';
import { cancelQuote, fastQuote, howOf } from '../engine/supply';
import type { PairStep, PlantState, Refusal } from '../engine/types';

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
  /** пробная партия одобрения пары (Б6ж): в потребность не идёт — до решения по досье её не берут в производство */
  trial?: true;
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
  /** предложения у планового заказа (Б6ж) — по номеру в `planned`: одобренные поставщики с баллами */
  offers: Offer[][];
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
        ...(p.trial ? { trial: true as const } : {}),
        speed: 'why' in f ? { why: f.why } : { eta: f.eta, fee: f.net + f.vat },
        cancel: 'why' in c ? { why: c.why } : { fee: c.fee, back: c.back },
      };
    });
  // предложения (Б6ж): у каждого планового заказа — на его количество; у материала с одним поставщиком — одно
  const offers = r.planned.map(o => offersFor(db, s, o.material, o.qty, r.today));
  return { view: 'mrp', from: r.from, today: r.today, arrive: r.arrive, how: howOf(db, s), rows: r.rows, planned: r.planned, msgs: r.msgs, pos, offers };
}

/** Блок планёрки «Материалы»: плановые заказы с датой сегодня и раньше — сколько, к какому дню, на сколько суток опоздают; заказы в пути, которые опоздают. */
export interface MrpMeeting {
  due: { material: Id; supplier: Id; qty: number; need: number; late: number }[];
  late: { po: string; material: Id; days: number }[];
  /** заказы, что не пришли к обещанному (Б6ж): на сколько суток позже обещанного */
  behind: { po: string; supplier: Id; material: Id; days: number }[];
  /** одобрения пар в работе (Б6ж): шаг и наступившие дни изменения досье */
  apps: { pair: string; supplier: Id; maker: Id; material: Id; step: PairStep; filed?: number; asked?: number; answered?: number }[];
}

/** Блок планёрки «Материалы» (Б6д): только у сценария с прогнозом; заказывать нечего и ничего не опоздает — нет. */
export function mrpMeeting(db: ContentDb, s: PlantState): MrpMeeting | undefined {
  const sc = db.scenarios[s.scenario];
  if (!s.planning.forecast || !sc.plan || !sc.supply) return undefined;
  const r = mrpPlan(db, s);
  const due = r.planned.filter(o => o.orderBy <= r.today).map(o => ({ material: o.material, supplier: o.supplier, qty: o.qty, need: o.need, late: o.late }));
  const late = r.msgs.flatMap(m => (m.kind === 'late' ? [{ po: m.po, material: m.material, days: m.days }] : []));
  const behind = r.msgs.flatMap(m => (m.kind === 'behind' ? [{ po: m.po, supplier: s.pos[m.po].supplier, material: m.material, days: m.days }] : []));
  const apps: MrpMeeting['apps'] = [];
  for (const p of Object.values(s.pairs)) {
    const a = p.app;
    if (!a || a.step === 'done' || a.step === 'failed') continue;
    apps.push({ pair: p.id, supplier: p.supplier, maker: p.maker, material: a.material, step: a.step, ...(a.filed !== undefined ? { filed: a.filed } : {}), ...(a.asked !== undefined ? { asked: a.asked } : {}), ...(a.answered !== undefined ? { answered: a.answered } : {}) });
  }
  return due.length + late.length + behind.length + apps.length > 0 ? { due, late, behind, apps } : undefined;
}
