// Коллега планирования (этап Б, Б2в; геймдизайн, §9.3, §29.3): после заданий сценария задания на серию ставит он — по
// правилу, а не нейросетью. Каждый рабочий день в начале смены аппаратчиков он смотрит на рабочий день через две
// рабочие недели (§9.3: первые 2 недели заморожены) — через десять рабочих дней по производственному календарю (Б4а), в
// обычную неделю это тот же день недели, — и, если на него задания ещё нет, ставит одно: позиции, которой хватит меньше
// всего, — когда ГП с сериями в работе меньше спроса на эти две недели и ещё `cover` суток. Спрос — по заказам
// покупателей за `window` последних суток: это завод знает, а настоящий спрос покупателя — нет. Покупатели заказывают в
// рабочий день, поэтому спрос — на рабочий день (Б4а): иначе после январских праздников он кажется меньше. Пока заказы
// идут меньше недели — позиции по очереди. С Б2г — кампании (§9.4): продукт последнего задания идёт дальше, пока его
// позициям нужна серия, а другому продукту не срочно. Своего состояния у коллеги нет: всё — из заводских заданий,
// партий и заказов. Счёт — в целых.
import type { ContentDb, Id, Recipe, Sku } from '../content/types';
import { addWorkdays, DAY, daysFromCivil, isWorkday, momentOf, workdayOnOrAfter } from './core/calendar';
import { coverBy, dueRule, skillOf, whoDecides } from './bosses';
import { modeOf, moot, propose } from './heads';
import { asWho } from './journal';
import { TRUCK_HOUR } from './market';
import { BATCH_HOUR, placeOrder } from './mes';
import { numOf, POL } from './policies';
import { containersByLot } from './stock';
import type { Notice, OrderWhy, PlantState } from './types';
import { calOf } from './workdays';

/** Замороженные две недели (геймдизайн, §9.3): спрос — на столько суток; задание — через столько рабочих дней (Б4а). */
export const AHEAD = 14;
export const AHEAD_WORK = 10;

/** Пока заказы покупателей идут меньше стольких суток, спроса ещё не видно — позиции по очереди. */
export const SEEN = 7;

const idNum = (id: string) => Number(id.slice(1));

/** Ящиков ГП с серии по карте: таблетки серии по номиналу, пачки позиции, ящики — целые. */
export function casesOf(r: Recipe, sku: Sku): number {
  return Math.floor(Math.floor(r.batch.units / (sku.perBlister * sku.blisters)) / sku.case.per);
}

/**
 * Что завод знает о позиции: ящиков ГП в учёте и в сериях, ещё не упакованных, за вычетом неотгруженного открытых
 * заказов; сколько ящиков заказали покупатели за `span` игровых секунд — за `work` рабочих дней (Б4а); `span` 0 —
 * спроса ещё не видно.
 */
export interface SkuPosition {
  sku: Id;
  cases: number;
  ordered: number;
  span: number;
  work: number;
}

/**
 * Рабочих дней в окне спроса `span` секунд: с его первого дня по вчера (Б4а) — покупатели заказывают в рабочий день
 * после часа коллег планирования и снабжения, сегодняшних заказов ещё нет.
 */
function workBack(db: ContentDb, s: PlantState, span: number): number {
  const cal = calOf(db, s);
  let n = 0;
  for (let z = momentOf(s.start, s.t - span).day, today = momentOf(s.start, s.t).day; z < today; z++) if (isWorkday(cal, z)) n++;
  return Math.max(1, n);
}

/**
 * Спрос вперёд на `days` суток — в рабочих днях обычной пятидневки, 5 из 7, в тысячных (Б4а): праздники впереди запаса
 * не уменьшают — после них завод начинает с задания через две рабочие недели, а покупатели заказывают сразу.
 */
export const aheadMilli = (days: number) => Math.floor((days * 5000) / 7);

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
    if (b.sku !== sku || b.status === 'released' || b.status === 'rejected' || b.status === 'fg' || b.status === 'cancelled') continue;
    const expect = casesOf(db.recipes[b.recipe], k);
    cases += b.status === 'packing' && b.pack?.fg ? Math.max(0, expect - (byLot.get(b.pack.fg)?.length ?? 0)) : expect;
  }
  for (const o of Object.values(s.orders)) if (o.status === 'open') for (const l of o.lines) if (l.sku === sku) cases -= l.cases - l.shipped;
  const span = Math.min(window * DAY, s.t);
  if (span < SEEN * DAY) return { sku, cases, ordered: 0, span: 0, work: 0 };
  let ordered = 0;
  for (const o of Object.values(s.orders)) if (o.placed > s.t - span) for (const l of o.lines) if (l.sku === sku) ordered += l.cases;
  return { sku, cases, ordered, span, work: workBack(db, s, span) };
}

/**
 * Срок задания на запас позиции (Б6а): отгрузка того рабочего дня, когда запас позиции — ГП и серии в работе против
 * спроса за рабочий день — кончится; тот же расчёт, которым правило выбирает позицию. Спроса не видно — срока нет.
 */
export function stockDue(db: ContentDb, s: PlantState, sku: Id, window: number, byLot = containersByLot(s)): number | undefined {
  const p = positionOf(db, s, sku, window, byLot);
  if (p.span === 0 || p.ordered === 0) return undefined;
  const cal = calOf(db, s);
  const today = momentOf(s.start, s.t).day;
  // рабочих дней спроса, которые покрывает запас: сегодня и дальше
  const days = p.cases <= 0 ? 0 : Math.floor((p.cases * p.work) / p.ordered);
  const z = days > 0 ? addWorkdays(cal, today, days) : workdayOnOrAfter(cal, today);
  return (z - daysFromCivil(s.start)) * DAY + TRUCK_HOUR;
}

/**
 * Отменённое задание на запас позиции (Б6а): последнее, чьё «не раньше» ещё не наступило, — до него начальник отдела
 * планирования эту позицию заново не ставит; отменённое под заказ покупателя не держит ничего.
 */
export function heldOf(s: PlantState, sku: Id): { t: number; until: number } | undefined {
  let out: { t: number; until: number } | undefined;
  for (const b of Object.values(s.batches)) {
    if (b.status !== 'cancelled' || b.sku !== sku || b.for?.kind === 'order' || s.t >= b.notBefore) continue;
    if (!out || b.notBefore > out.until) out = { t: b.cancelled ?? b.ordered, until: b.notBefore };
  }
  return out;
}

/** Вещь предложения начальника отдела планирования (Б5б): следующее задание на серию — одно открытое. */
export const ORDER_KEY = 'order';

/**
 * Каждый час: в рабочий день в начале смены аппаратчиков — задание на рабочий день через две рабочие недели, если оно
 * нужно. Режим отдела (Б5б): «сам» — задание; «советует» — предложение того же задания с той же причиной, а задание не
 * нужно — открытое предложение «не нужно»; «вручную» — ничего. Запас позиций, окно спроса и кампании — политики
 * начальника отдела планирования (Б5г): с чего начинает завод — запись сценария.
 */
export function planHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  const plan = db.scenarios[s.scenario].plan;
  const now = momentOf(s.start, s.t);
  const cal = calOf(db, s);
  if (!plan) return;
  const mode = modeOf(s, 'plan');
  if (mode === 'manual') return;
  // руководитель — человек (Б5в): с начала смены аппаратчиков, в первый час, когда есть кому решить
  const who = dueRule(db, s, 'plan', 'plan', BATCH_HOUR, notices);
  if (!who) return;
  const day = addWorkdays(cal, now.day, AHEAD_WORK);
  // к началу смены аппаратчиков того дня — и когда за руководителя решили позже его часа (Б5в)
  const at = (day - daysFromCivil(s.start)) * DAY + BATCH_HOUR;
  // горизонт — политика, а навык руководителя ниже 4 его сокращает (геймдизайн, §8.5)
  const policy = numOf(db, s, POL.cover)!;
  const cover = coverBy(skillOf(s, who), policy);
  const got = Object.values(s.batches).some(b => b.status !== 'cancelled' && momentOf(s.start, b.notBefore).day === day) ? undefined : pick(db, s, plan.items, cover, numOf(db, s, POL.window)!, numOf(db, s, POL.urgent), at, cover < policy ? policy : undefined);
  if (mode === 'advise') {
    if (!got) return moot(s, ORDER_KEY);
    const cmd = { kind: 'order' as const, recipe: got.it.recipe, notBefore: at, sku: got.it.sku };
    return propose(s, 'plan', ORDER_KEY, cmd, { kind: 'order', recipe: got.it.recipe, sku: got.it.sku, notBefore: at, why: got.why }, notices, undefined, who);
  }
  if (got) asWho('plan', who, () => placeOrder(db, s, { kind: 'order', recipe: got.it.recipe, notBefore: at, by: 'head:plan', sku: got.it.sku }, notices, got.why));
}

/** Позиция для выбора правила: что о ней знает завод — или, в плане запуска (Б6б), что о ней будет в день правила. */
interface Cand {
  it: { recipe: Id; sku: Id };
  p: Pick<SkuPosition, 'cases' | 'ordered' | 'work' | 'span'>;
  held?: { t: number; until: number };
}

/**
 * Выбор правила начальника отдела планирования — один для задания и плана запуска (Б6б): из позиций, у которых запас
 * меньше спроса на рабочие дни двух недель и ещё `cover` суток (`ahead`), — с наименьшим запасом в днях спроса (запас ×
 * заказано у другой против запаса другой × заказано у этой — в целых); отменённая на запас позиция (Б6а) — не в выборе;
 * спроса не видно — позицию, чьё последнее задание старше (`last`); поровну — первую в плане. Нужной нет — никакую. С
 * `urgent` — кампании (Б2г, геймдизайн, §9.4): продукт последнего задания `prev` идёт дальше, пока его позициям нужна
 * серия, а ни одной позиции другого продукта не хватит меньше чем на две недели и ещё `urgent` суток.
 */
function choose(db: ContentDb, pos: readonly Cand[], ahead: number, urgent: number | undefined, prev: Id | undefined, last: (sku: Id) => number): { it: Cand['it']; rule: OrderWhy['rule']; soon?: number } | undefined {
  const free = pos.filter(x => !x.held);
  if (free.length === 0) return undefined;
  if (pos.some(x => x.p.span === 0)) return { it: free.reduce((a, b) => (last(b.it.sku) < last(a.it.sku) ? b : a)).it, rule: 'turn' };
  const need = free.filter(x => x.p.cases * x.p.work * 1000 < x.p.ordered * ahead);
  if (need.length === 0) return undefined;
  // у кого запаса меньше суток спроса: cases_a / ordered_a < cases_b / ordered_b; без заказов позиция — последней
  const less = (a: Cand['p'], b: Cand['p']) => (a.ordered === 0 ? false : b.ordered === 0 ? true : a.cases * b.ordered < b.cases * a.ordered);
  const neediest = (xs: readonly Cand[]) => xs.reduce((a, b) => (less(b.p, a.p) ? b : a)).it;
  if (urgent === undefined) return { it: neediest(need), rule: 'need' };
  const product = (x: Cand) => db.recipes[x.it.recipe].product;
  const mine = need.filter(x => product(x) === prev);
  const soon = aheadMilli(AHEAD + urgent);
  const hurry = need.some(x => product(x) !== prev && x.p.cases * x.p.work * 1000 < x.p.ordered * soon);
  if (mine.length > 0 && !hurry) return { it: neediest(mine), rule: 'campaign', soon };
  return { it: neediest(need), rule: mine.length > 0 ? 'urgent' : 'need', soon };
}

/** Продукт кампании — у задания, которое пойдёт последним перед мигом `at`: позже «не раньше», при равных — новее. */
function prevBefore(batches: readonly { id: string; notBefore: number; product: Id }[], at: number): Id | undefined {
  let best: { id: string; notBefore: number; product: Id } | undefined;
  for (const b of batches) if (b.notBefore < at && (!best || b.notBefore > best.notBefore || (b.notBefore === best.notBefore && idNum(b.id) > idNum(best.id)))) best = b;
  return best?.product;
}

/**
 * Какую серию ставить — правило `choose` по положению позиций сейчас. С позицией — причина для журнала решений (Б5а):
 * правило, положение всех позиций плана и пороги.
 */
function pick(db: ContentDb, s: PlantState, items: { recipe: Id; sku: Id }[], cover: number, window: number, urgent: number | undefined, at: number, policy?: number): { it: { recipe: Id; sku: Id }; why: OrderWhy } | undefined {
  const byLot = containersByLot(s);
  // отменённое на запас (Б6а): позицию не ставят до «не раньше» отменённого
  const pos = items.map(it => ({ it, p: positionOf(db, s, it.sku, window, byLot), held: heldOf(s, it.sku) }));
  // запас < заказано за рабочий день окна × рабочих дней пятидневки в AHEAD + cover суток (Б4а)
  const ahead = aheadMilli(AHEAD + cover);
  const why = (rule: OrderWhy['rule'], extra: Partial<OrderWhy> = {}): OrderWhy => ({ rule, items: pos.map(x => ({ sku: x.it.sku, cases: x.p.cases, ordered: x.p.ordered, work: x.p.work, ...(x.held ? { held: x.held } : {}) })), ahead, cover, ...(policy !== undefined ? { policy } : {}), ...extra });
  const last = (sku: Id) => Math.max(-1, ...Object.values(s.batches).filter(b => b.sku === sku).map(b => idNum(b.id)));
  const prev = urgent === undefined ? undefined : prevBefore(Object.values(s.batches), at);
  const c = choose(
    db,
    pos.map(x => (x.held ? x : { it: x.it, p: x.p })),
    ahead,
    urgent,
    prev,
    last,
  );
  if (!c) return undefined;
  if (c.rule === 'turn') return { it: c.it, why: why('turn', { seen: SEEN }) };
  return { it: c.it, why: why(c.rule, c.soon !== undefined ? { soon: c.soon, ...(prev ? { prev } : {}) } : {}) };
}

/** Строка плана запуска (Б6б): задание, которое начальник отдела планирования поставит в свой день `on` на день `day`. */
export interface Launch {
  on: number;
  day: number;
  /** «не раньше» задания */
  at: number;
  recipe: Id;
  sku: Id;
}

/**
 * Черновик расписания для плана запуска (Б6б): новые срочные задания, отменённые до комплектовки и новые «не раньше» —
 * как их поставят, отменят и сдвинут команды при «Утвердить» (Б6а).
 */
export interface LaunchDraft {
  fresh?: readonly { recipe: Id; sku: Id; notBefore: number }[];
  drop?: readonly string[];
  shift?: readonly { batch: string; notBefore: number }[];
}

/**
 * План запуска (Б6б; геймдизайн, §9.4): что начальник отдела планирования поставит в свои рабочие дни на дни до `until` —
 * тем же правилом `choose`, без записи, как правило снабжения в «Заказе поставщику» (Б5б). Спрос впереди — тот, что в
 * заказах окна, ровно по рабочим дням: каждый рабочий день с сегодняшнего до дня правила убавляет запас позиции на
 * заказанное за рабочий день окна; поставленное правилом прибавляет ящики серии; отменённое на запас держит позицию до
 * своего «не раньше»; на день, где задание уже есть, правило не ставит. Первый день правила — сегодня, если его час ещё не
 * настал, иначе следующий рабочий. Отдел «вручную» (Б5б) — пусто. Навык — того, кто решает за руководителя сейчас.
 * Черновик `draft` — как будто его уже утвердили.
 */
export function launchPlan(db: ContentDb, s: PlantState, until: number, draft: LaunchDraft = {}): Launch[] {
  const plan = db.scenarios[s.scenario].plan;
  if (!plan || modeOf(s, 'plan') === 'manual') return [];
  const cal = calOf(db, s);
  const window = numOf(db, s, POL.window)!;
  const cover = coverBy(skillOf(s, whoDecides(db, s, 'plan')), numOf(db, s, POL.cover)!);
  const ahead = aheadMilli(AHEAD + cover);
  const urgent = numOf(db, s, POL.urgent);
  const byLot = containersByLot(s);
  // запас в «ящико-днях»: ящики × рабочие дни окна — так спрос рабочего дня убавляет его на заказанное, в целых
  const drop = new Set(draft.drop ?? []);
  const moved = new Map((draft.shift ?? []).map(x => [x.batch, x.notBefore]));
  const pos = plan.items.map(it => {
    const p = positionOf(db, s, it.sku, window, byLot);
    // черновик: отменённое не придёт ящиками, новое срочное — придёт
    let cases = p.cases;
    for (const id of drop) if (s.batches[id]?.sku === it.sku && s.batches[id].status !== 'cancelled') cases -= casesOf(db.recipes[s.batches[id].recipe], db.skus[it.sku]);
    for (const f of draft.fresh ?? []) if (f.sku === it.sku) cases += casesOf(db.recipes[f.recipe], db.skus[it.sku]);
    return { it, work: p.work, p: { cases: cases * p.work, ordered: p.ordered, work: 1, span: p.span } };
  });
  const lastId = new Map<Id, number>();
  let next = 0;
  for (const b of Object.values(s.batches)) {
    next = Math.max(next, idNum(b.id) + 1);
    if (b.sku) lastId.set(b.sku, Math.max(lastId.get(b.sku) ?? -1, idNum(b.id)));
  }
  const runs: { id: string; notBefore: number; product: Id }[] = Object.values(s.batches)
    .filter(b => b.status !== 'cancelled' && !drop.has(b.id))
    .map(b => ({ id: b.id, notBefore: moved.get(b.id) ?? b.notBefore, product: b.product }));
  for (const f of draft.fresh ?? []) {
    const id = `B${next++}`;
    lastId.set(f.sku, idNum(id));
    runs.push({ id, notBefore: f.notBefore, product: db.recipes[f.recipe].product });
  }
  const taken = new Set(runs.map(b => momentOf(s.start, b.notBefore).day));
  const gone = Object.values(s.batches)
    .filter(b => (b.status === 'cancelled' || drop.has(b.id)) && b.for?.kind !== 'order')
    .map(b => ({ sku: b.sku, notBefore: b.notBefore, cancelled: b.status === 'cancelled' ? b.cancelled : s.t }));
  const out: Launch[] = [];
  const now = momentOf(s.start, s.t);
  const zero = daysFromCivil(s.start);
  let on = isWorkday(cal, now.day) && now.sec < BATCH_HOUR ? now.day : addWorkdays(cal, now.day, 1);
  let z = now.day;
  for (;;) {
    const day = addWorkdays(cal, on, AHEAD_WORK);
    const at = (day - zero) * DAY + BATCH_HOUR;
    if (at >= until) break;
    for (; z < on; z++) if (isWorkday(cal, z)) for (const x of pos) x.p.cases -= x.p.ordered;
    if (!taken.has(day)) {
      const when = (on - zero) * DAY + BATCH_HOUR;
      const held = (sku: Id) => gone.find(b => b.sku === sku && when < b.notBefore);
      const c = choose(
        db,
        pos.map(x => {
          const h = held(x.it.sku);
          return h ? { it: x.it, p: x.p, held: { t: h.cancelled ?? when, until: h.notBefore } } : { it: x.it, p: x.p };
        }),
        ahead,
        urgent,
        urgent === undefined ? undefined : prevBefore(runs, at),
        sku => lastId.get(sku) ?? -1,
      );
      if (c) {
        out.push({ on, day, at, recipe: c.it.recipe, sku: c.it.sku });
        taken.add(day);
        const x = pos.find(y => y.it.sku === c.it.sku)!;
        x.p.cases += casesOf(db.recipes[c.it.recipe], db.skus[c.it.sku]) * x.work;
        const id = `B${next++}`;
        lastId.set(c.it.sku, idNum(id));
        runs.push({ id, notBefore: at, product: db.recipes[c.it.recipe].product });
      }
    }
    on = addWorkdays(cal, on, 1);
  }
  return out;
}
