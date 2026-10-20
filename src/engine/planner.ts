// Коллега планирования (этап Б, Б2в; геймдизайн, §9.3, §29.3): после заданий сценария задания на серию ставит он — по
// правилу, а не нейросетью. Каждый рабочий день в начале смены аппаратчиков он смотрит на тот же день недели через две
// недели (§9.3: первые 2 недели заморожены) и, если на него задания ещё нет, ставит одно: позиции, которой хватит меньше
// всего, — когда ГП с сериями в работе меньше спроса на эти две недели и ещё `cover` суток. Спрос — по заказам покупателей
// за `window` последних суток: это завод знает, а настоящий спрос покупателя — нет. Пока заказы идут меньше недели —
// позиции по очереди. Своего состояния у коллеги нет: всё — из заводских заданий, партий и заказов. Счёт — в целых.
import type { ContentDb, Id, Recipe, Sku } from '../content/types';
import { DAY, isWorkday, momentOf } from './core/calendar';
import { BATCH_HOUR, placeOrder } from './mes';
import { containersByLot } from './stock';
import type { Notice, PlantState } from './types';

/** Через сколько суток задание: замороженные две недели (геймдизайн, §9.3). */
export const AHEAD = 14;

/** Пока заказы покупателей идут меньше стольких суток, спроса ещё не видно — позиции по очереди. */
export const SEEN = 7;

const idNum = (id: string) => Number(id.slice(1));

/** Ящиков ГП с серии по карте: таблетки серии по номиналу, пачки позиции, ящики — целые. */
export function casesOf(r: Recipe, sku: Sku): number {
  return Math.floor(Math.floor(r.batch.units / (sku.perBlister * sku.blisters)) / sku.case.per);
}

/**
 * Что завод знает о позиции: ящиков ГП в учёте и в сериях, ещё не упакованных, за вычетом неотгруженного открытых заказов;
 * сколько ящиков заказали покупатели за `span` игровых секунд; `span` 0 — спроса ещё не видно.
 */
export interface SkuPosition {
  sku: Id;
  cases: number;
  ordered: number;
  span: number;
}

/**
 * Положение позиции: ящики ГП всех партий, кроме отклонённых и удержанных, и ящики, которые дадут серии в работе по
 * номиналу (у упаковки — без уже упакованных), минус неотгруженное открытых заказов; спрос — ящики позиции в заказах за
 * `window` последних суток, а если заказы идут меньше `SEEN` суток — не видно.
 */
export function positionOf(db: ContentDb, s: PlantState, sku: Id, window: number, byLot = containersByLot(s)): SkuPosition {
  const k = db.skus[sku];
  let cases = 0;
  // удержанная (заблокированная) ГП — не запас: её могут и отклонить
  for (const l of Object.values(s.lots)) if (l.material === k.fg && l.status !== 'rejected' && l.status !== 'blocked') cases += byLot.get(l.id)?.length ?? 0;
  for (const b of Object.values(s.batches)) {
    if (b.sku !== sku || b.status === 'released' || b.status === 'rejected' || b.status === 'fg') continue;
    const expect = casesOf(db.recipes[b.recipe], k);
    cases += b.status === 'packing' && b.pack?.fg ? Math.max(0, expect - (byLot.get(b.pack.fg)?.length ?? 0)) : expect;
  }
  for (const o of Object.values(s.orders)) if (o.status === 'open') for (const l of o.lines) if (l.sku === sku) cases -= l.cases - l.shipped;
  const span = Math.min(window * DAY, s.t);
  if (span < SEEN * DAY) return { sku, cases, ordered: 0, span: 0 };
  let ordered = 0;
  for (const o of Object.values(s.orders)) if (o.placed > s.t - span) for (const l of o.lines) if (l.sku === sku) ordered += l.cases;
  return { sku, cases, ordered, span };
}

/** Каждый час: в рабочий день в начале смены аппаратчиков — задание на тот же день через две недели, если оно нужно. */
export function planHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  const plan = db.scenarios[s.scenario].plan;
  const now = momentOf(s.start, s.t);
  if (!plan || !isWorkday(now.day) || now.sec !== BATCH_HOUR) return;
  const at = s.t + AHEAD * DAY;
  const day = momentOf(s.start, at).day;
  if (Object.values(s.batches).some(b => momentOf(s.start, b.notBefore).day === day)) return;
  const it = pick(db, s, plan.items, plan.cover, plan.window);
  if (it) placeOrder(db, s, { kind: 'order', recipe: it.recipe, notBefore: at, by: 'head:plan', sku: it.sku }, notices);
}

/**
 * Какую серию ставить: из позиций, у которых запас меньше спроса на две недели и ещё `cover` суток, — с наименьшим запасом
 * в сутках спроса (запас × заказано у другой против запаса другой × заказано у этой — в целых); спроса не видно — позицию,
 * чьё последнее задание старше; поровну — первую в плане. Нужной нет — никакую.
 */
function pick(db: ContentDb, s: PlantState, items: { recipe: Id; sku: Id }[], cover: number, window: number) {
  const byLot = containersByLot(s);
  const pos = items.map(it => ({ it, p: positionOf(db, s, it.sku, window, byLot) }));
  if (pos.some(x => x.p.span === 0)) {
    const last = (sku: Id) => Math.max(-1, ...Object.values(s.batches).filter(b => b.sku === sku).map(b => idNum(b.id)));
    return pos.reduce((a, b) => (last(b.it.sku) < last(a.it.sku) ? b : a)).it;
  }
  // запас < заказано / span × (AHEAD + cover) суток
  const need = pos.filter(x => x.p.cases * x.p.span < x.p.ordered * (AHEAD + cover) * DAY);
  if (need.length === 0) return undefined;
  // у кого запаса меньше суток спроса: cases_a / ordered_a < cases_b / ordered_b; без заказов позиция — последней
  const less = (a: SkuPosition, b: SkuPosition) => (a.ordered === 0 ? false : b.ordered === 0 ? true : a.cases * b.ordered < b.cases * a.ordered);
  return need.reduce((a, b) => (less(b.p, a.p) ? b : a)).it;
}
