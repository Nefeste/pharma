// Закупки (docs/specs/2026-10-engine.md, 1а, «Заказ поставщику и приёмка»; геймдизайн, §11). Заказ — команда `po`:
// количество — вверх до целой тары, не меньше минимальной партии. Срок прихода — из ветви поставщика; фура приходит в
// рабочий день с 09:00 до 15:00. Коллега снабжения (этап Б, Б2в; геймдизайн, §9.3, §29.3) — `supplyDay`: каждый рабочий
// день заказывает то, чего не хватит на срок поставки, входной контроль и страховой запас при расходе по плану выпуска.
// С Б3г заказывают только по одобренной паре «поставщик — изготовитель» действующей спецификации, по цене рамочного
// договора, а сверх обещанного — по прайсу (partners.ts). С Б6ж поставщик опаздывает: доля заказов и на сколько суток —
// в его записи, по своей ветви; завод знает обещанный приход (`eta`), настоящий (`truth`) — только движок.
import type { ContentDb, Id } from '../content/types';
import { schedule } from './core/agenda';
import { DAY, HOUR, isWorkday, MIN, momentOf, workdayOnOrAfter } from './core/calendar';
import { part, post, vatRate } from './cash';
import { inForce } from './docs';
import { dueRule } from './bosses';
import { modeOf, round } from './heads';
import { asWho, noteCmd } from './journal';
import { packNeeds } from './mes';
import { approved, choosePair, linePrice, pairKey, priceLine } from './partners';
import { aheadMilli, casesOf, positionOf } from './planner';
import { planOf } from './plant';
import { mrpPlan } from './plan/mrp';
import { numOf, POL, policyOf } from './policies';
import { roll } from './random';
import { containersByLot, containersFor, free, nextId } from './stock';
import type { Command, Lot, Notice, PackJob, PlantState, Po, PoLine, PoWhy, Refusal } from './types';
import { calOf } from './workdays';

/** Окно прихода фур: рабочий день, с 09:00, плюс до шести часов. */
const ARRIVE_FROM = 9 * HOUR;
const ARRIVE_SPREAD = 6 * HOUR;

/**
 * Заказ без записи (Б5б; окно «Заказ поставщику», предложение снабжения): строки — количество вверх до целой тары,
 * изготовитель — из записи поставщика; стоимость без НДС, НДС и предоплата. Отказ — с причиной и материалом: нет
 * поставщика, строк нет, поставщик материал не продаёт, меньше наименьшей партии, не по одобренной паре.
 */
export type PoQuote = { lines: PoLine[]; costs: number[]; net: number; vat: number; prepaid: number } | { why: Refusal; detail?: string };

export function quotePo(db: ContentDb, s: PlantState, supplier: Id, want: readonly PoLine[], trial?: string): PoQuote {
  const sup = db.suppliers[supplier];
  if (!sup) return { why: 'noSupplier', detail: supplier };
  if (want.length === 0) return { why: 'empty' };
  const lines: PoLine[] = [];
  const today = momentOf(s.start, s.t).day;
  for (const l of want) {
    const item = sup.items[l.material];
    if (!item) return { why: 'notSold', detail: l.material };
    if (l.qty < item.moq) return { why: 'belowMoq', detail: l.material };
    // только по одобренной паре действующей спецификации (Б3г): изготовитель — из записи поставщика; пробная партия
    // одобрения пары-кандидата (Б6ж) — по этой паре, пока одобрение на шаге пробной партии
    const maker = item.maker;
    const trialOk = trial !== undefined && trial === pairKey(sup.id, maker) && s.pairs[trial]?.app?.step === 'trial';
    if ((l.maker !== undefined && l.maker !== maker) || (!trialOk && !approved(db, s, sup.id, maker, l.material, today))) return { why: 'pair', detail: l.material };
    const cap = db.containers[db.materials[l.material].container].capacity;
    lines.push({ material: l.material, qty: containersFor(db, l.material, l.qty) * cap, maker });
  }
  // сумма с НДС: АФС — по ставке лекарственных средств, остальное — по общей; по договору — до остатка обещанного
  let net = 0;
  let vat = 0;
  const costs: number[] = [];
  const taken = new Map<Id, number>();
  for (const l of lines) {
    const cost = linePrice(db, s, sup.id, l, taken.get(l.material) ?? 0).cost;
    taken.set(l.material, (taken.get(l.material) ?? 0) + l.qty);
    costs.push(cost);
    net += cost;
    vat += part(cost, vatRate(db, s, l.material));
  }
  return { lines, costs, net, vat, prepaid: part(net + vat, sup.prepay) };
}

export function placePo(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'po' }>, notices: Notice[], why?: PoWhy[], trial?: string): Po | undefined {
  const q = quotePo(db, s, cmd.supplier, cmd.lines, trial);
  if ('why' in q) {
    notices.push({ kind: 'refused', cmd: 'po', why: q.why, ...(q.detail ? { detail: q.detail } : {}) });
    return undefined;
  }
  const sup = db.suppliers[cmd.supplier];
  const lines = q.lines;
  const eta = etaOf(db, s, sup.id, sup.lead);
  // опоздание (Б6ж): по своей ветви поставщика; завод знает обещанный приход, фура придёт к настоящему
  const truth = lateOf(db, s, sup.id, eta);
  // сумма с НДС: АФС — по ставке лекарственных средств, остальное — по общей; предоплата — сейчас, остаток — после прихода
  let net = 0;
  let vat = 0;
  for (const l of lines) {
    // по договору — до остатка обещанного, сверх — по прайсу (Б3г)
    const cost = priceLine(db, s, sup.id, l);
    net += cost;
    vat += part(cost, vatRate(db, s, l.material));
  }
  const po: Po = { id: nextId(s, 'P'), supplier: sup.id, lines, ordered: s.t, eta, ...(truth !== undefined ? { truth } : {}), ...(trial ? { trial } : {}), status: 'ordered', by: cmd.by ?? 'player', sum: net + vat, vat, prepaid: part(net + vat, sup.prepay) };
  s.pos[po.id] = po;
  post(s, -po.prepaid!, 'prepay', po.id);
  schedule(s.agenda, arriveAt(po), { kind: 'truck', po: po.id });
  notices.push({ kind: 'ordered', po: po.id, eta });
  // журнал решений (Б5а): игрок или начальник отдела снабжения — с положением материалов; пробная партия (Б6ж) — с парой
  noteCmd(s, cmd, { kind: 'po', po: po.id, supplier: po.supplier, prepaid: po.prepaid ?? 0, ...(why ? { why } : {}), ...(trial ? { trial } : {}) });
  return po;
}

/** Когда фура заказа в самом деле придёт (Б6ж): к настоящему приходу опаздывающего, иначе к обещанному. Только движок. */
export const arriveAt = (po: Po): number => po.truth ?? po.eta;

/**
 * Опоздание заказа (Б6ж; геймдизайн, §11): по ветви `late/<поставщик>` — доля заказов поставщика опаздывает на столько
 * суток от и до; приход — в то же время дня рабочего дня. Не опоздает или у поставщика нет записи — `undefined`.
 */
export function lateOf(db: ContentDb, s: PlantState, supplier: Id, eta: number): number | undefined {
  const late = db.suppliers[supplier]?.late;
  if (!late || late.share <= 0) return undefined;
  return roll(s, `late/${supplier}`, r => {
    if (r.int(10_000) >= late.share) return undefined;
    const days = r.range(late.days[0], late.days[1]);
    return arrival(db, s, eta + days * DAY, momentOf(s.start, eta).sec - ARRIVE_FROM);
  });
}

/**
 * Двойник прогона плана (Б6ж; src/engine/plan/twin.ts): настоящий приход заказа в пути — заново по записи поставщика от
 * зерна прогона. Заказ, что не пришёл к обещанному, опаздывает на столько суток по записи, но придёт не раньше окна
 * прихода завтрашнего рабочего дня. Фура — к новому приходу; прежнее событие ничего не найдёт.
 */
export function redrawLate(db: ContentDb, s: PlantState, po: Po) {
  delete po.truth;
  const late = db.suppliers[po.supplier]?.late;
  let t: number | undefined;
  if (s.t < windowEnd(s, po.eta)) t = lateOf(db, s, po.supplier, po.eta);
  else {
    const days = late ? roll(s, `late/${po.supplier}`, r => r.range(late.days[0], late.days[1])) : 1;
    t = Math.max(arrival(db, s, po.eta + days * DAY, momentOf(s.start, po.eta).sec - ARRIVE_FROM), arrival(db, s, s.t + DAY, 0));
  }
  if (t !== undefined && t !== po.eta) po.truth = t;
  schedule(s.agenda, arriveAt(po), { kind: 'truck', po: po.id });
}

/** Конец окна прихода фур в обещанный день заказа (Б6ж): не пришла к нему — заказ опаздывает. */
export const windowEnd = (s: PlantState, eta: number): number => eta - momentOf(s.start, eta).sec + ARRIVE_FROM + ARRIVE_SPREAD;

/** Срок прихода заказа поставщику из его ветви: через `lead` дней, рабочим днём в окне прихода. */
export function etaOf(db: ContentDb, s: PlantState, supplier: Id, lead: [number, number]): number {
  return roll(s, `supply/${supplier}`, r => {
    const days = r.range(lead[0], lead[1]);
    return arrival(db, s, s.t + days * DAY, r.int(ARRIVE_SPREAD / MIN) * MIN);
  });
}

/** Ближайший рабочий день не раньше `t` по производственному календарю (Б4а) — в 09:00 плюс `extra` секунд. */
export function arrival(db: ContentDb, s: PlantState, t: number, extra: number): number {
  const m = momentOf(s.start, t);
  return t - m.sec + (workdayOnOrAfter(calOf(db, s), m.day) - m.day) * DAY + ARRIVE_FROM + extra;
}

/** Ускорить заказ в пути (Б6д; геймдизайн, §9.3): приход — через столько суток, рабочим днём к началу окна прихода. */
export const FAST_DAYS = 7;
/** Доплата за ускорение — доля суммы заказа без НДС, 1/10 000; НДС к ней — в доле НДС заказа (геймдизайн, §9.3). */
export const FAST_SHARE = 1500;
/** Неустойка за отмену до прихода — доля суммы заказа без НДС, 1/10 000 (геймдизайн, §9.3). */
export const CANCEL_SHARE = 1000;

/**
 * Ускорение без записи (Б6д; окно — «Ускорить»): новый приход — в 09:00 первого рабочего дня через `FAST_DAYS` суток,
 * доплата без НДС и НДС к ней. Отказ: такого заказа нет; он уже пришёл или отменён; уже ускорен; ускоренный придёт не
 * раньше обещанного — с Б6ж только до обещанного дня: заказ, что не пришёл к нему, ускорить можно.
 */
export function fastQuote(db: ContentDb, s: PlantState, poId: string): { eta: number; net: number; vat: number } | { why: Refusal } {
  const po = s.pos[poId];
  if (!po) return { why: 'noPo' };
  if (po.status !== 'ordered') return { why: 'poDone' };
  if (po.fast) return { why: 'fastAgain' };
  const eta = arrival(db, s, s.t + FAST_DAYS * DAY, 0);
  if (eta >= po.eta && s.t < windowEnd(s, po.eta)) return { why: 'notFaster' };
  return { eta, net: part((po.sum ?? 0) - (po.vat ?? 0), FAST_SHARE), vat: part(po.vat ?? 0, FAST_SHARE) };
}

/**
 * Команда «ускорить заказ поставщику» (Б6д): доплата с НДС — сразу, в сумме заказа и в его предоплате, НДС к ней — к
 * вычету с приходом; фура — к новому сроку, прежнее событие прихода уже ничего не найдёт: заказ пришёл. С Б6ж ускоренный
 * заказ не опаздывает: обещан новый приход; опаздывающий, что пришёл бы раньше него, придёт к своему.
 */
export function expediteCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'expedite' }>, notices: Notice[]) {
  const q = fastQuote(db, s, cmd.po);
  if ('why' in q) {
    notices.push({ kind: 'refused', cmd: 'expedite', why: q.why, detail: cmd.po });
    return;
  }
  const po = s.pos[cmd.po];
  const was = po.eta;
  const fee = q.net + q.vat;
  po.fast = { t: s.t, was, net: q.net, vat: q.vat };
  const real = arriveAt(po);
  po.eta = q.eta;
  if (real < q.eta) po.truth = real;
  else delete po.truth;
  po.sum = (po.sum ?? 0) + fee;
  po.vat = (po.vat ?? 0) + q.vat;
  po.prepaid = (po.prepaid ?? 0) + fee;
  post(s, -fee, 'poFast', po.id);
  schedule(s.agenda, q.eta, { kind: 'truck', po: po.id });
  notices.push({ kind: 'poFast', po: po.id, eta: q.eta });
  noteCmd(s, cmd, { kind: 'expedite', po: po.id, supplier: po.supplier, was, eta: q.eta, fee });
}

/**
 * Отмена без записи (Б6д; окно — «Отменить»): неустойка — доля суммы заказа без НДС, без доплаты за ускорение; возврат —
 * предоплата без доплаты за ускорение и без неустойки, меньше нуля — доплата сверх предоплаты. Отказ: такого заказа нет;
 * он уже пришёл или отменён.
 */
export function cancelQuote(s: PlantState, poId: string): { fee: number; back: number } | { why: Refusal } {
  const po = s.pos[poId];
  if (!po) return { why: 'noPo' };
  if (po.status !== 'ordered') return { why: 'poDone' };
  // пробная партия одобрения пары (Б6ж) — шаг одобрения: без неё одобрение не кончится
  if (trialPo(po)) return { why: 'poTrial' };
  const fast = po.fast ? po.fast.net + po.fast.vat : 0;
  const fee = part((po.sum ?? 0) - (po.vat ?? 0) - (po.fast?.net ?? 0), CANCEL_SHARE);
  return { fee, back: (po.prepaid ?? 0) - fast - fee };
}

/**
 * Команда «отменить заказ поставщику» до прихода (Б6д): заказ — «отменён», возврат — в кассу; по договору отменённое не
 * куплено — его количество снова в остатке обещанного. Фура не придёт: событие прихода найдёт отменённый заказ.
 */
export function cancelPoCommand(s: PlantState, cmd: Extract<Command, { kind: 'cancelPo' }>, notices: Notice[]) {
  const q = cancelQuote(s, cmd.po);
  if ('why' in q) {
    notices.push({ kind: 'refused', cmd: 'cancelPo', why: q.why, detail: cmd.po });
    return;
  }
  const po = s.pos[cmd.po];
  po.status = 'cancelled';
  po.cancelled = { t: s.t, fee: q.fee, back: q.back };
  post(s, q.back, 'poCancel', po.id);
  for (const l of po.lines) {
    const cl = l.contract ? s.contracts[l.contract]?.lines.find(x => x.material === l.material && x.maker === l.maker) : undefined;
    if (cl) cl.bought = Math.max(0, cl.bought - (l.qty - (l.list ?? 0)));
  }
  notices.push({ kind: 'poCancelled', po: po.id });
  noteCmd(s, cmd, { kind: 'cancelPo', po: po.id, supplier: po.supplier, fee: q.fee, back: q.back });
}

/** Коллега снабжения сидит с 09:00: в этот час рабочего дня он и считает (гипотеза). */
export const SUPPLY_HOUR = 9 * HOUR;

/**
 * Расход по плану выпуска за `days` суток: серий в рабочий день по позиции — по спросу её заказов на рабочий день (как
 * у коллеги планирования, Б4а; окно спроса — его политика, Б5г), а пока спроса не видно — по серии в рабочий день
 * поровну, — на рабочие дни этих суток; на серию — состав карты и упаковка позиции. Счёт — в тысячных долях серии, в
 * целых.
 */
export function planUse(db: ContentDb, s: PlantState, days: number, byLot = containersByLot(s)): Map<Id, number> {
  const plan = db.scenarios[s.scenario].plan;
  const out = new Map<Id, number>();
  if (!plan) return out;
  const window = numOf(db, s, POL.window)!;
  const pos = plan.items.map(it => positionOf(db, s, it.sku, window, byLot));
  const blind = pos.some(p => p.span === 0);
  const today = momentOf(s.start, s.t).day;
  // серии идут в рабочие дни (Б4а): расход — на рабочие дни пятидневки в этих сутках, тысячных
  const work = aheadMilli(days);
  plan.items.forEach((it, i) => {
    // карта — редакция, действующая сегодня (Б3а)
    const r = db.recipes[inForce(db, 'recipes', it.recipe, today)];
    const p = pos[i];
    // тысячных серии в рабочий день: вслепую — серия на все позиции; по спросу — ящики в рабочий день / ящики с серии
    const milli = blind ? Math.floor(1000 / plan.items.length) : Math.floor((p.ordered * 1000) / (p.work * casesOf(r, db.skus[it.sku])));
    const add = (material: Id, perBatch: number) => out.set(material, (out.get(material) ?? 0) + Math.ceil((milli * work * perBatch) / 1e6));
    for (const l of r.bom) add(l.material, l.qty);
    for (const n of packNeeds(db, { sku: it.sku, tablets: r.batch.units } as PackJob)) add(n.material, n.qty);
  });
  return out;
}

/**
 * Пробная партия одобрения пары (Б6ж) — не запас под план: в производство её не берут до решения по досье (`reg-eaeu`,
 * п. 4.2.1), а отклонят на входном контроле — не возьмут вовсе. Её заказ в пути — не приход, её партия — не запас, пока
 * её не разрешили по решению.
 */
export const trialPo = (po: Po) => po.trial !== undefined;
export const trialLot = (s: PlantState, l: Lot) => l.status !== 'released' && l.po !== undefined && s.pos[l.po]?.trial !== undefined;

/**
 * Что у завода есть и будет по материалу: свободное в таре всех партий, кроме отклонённых (карантин и испытания тоже —
 * их ждут), и заказанное в пути, минус то, чего ждут задания на серию и на упаковку без резерва. Пробной партии
 * одобрения (Б6ж) — ни в пути, ни в партиях.
 */
export function supplyPosition(db: ContentDb, s: PlantState, material: Id, byLot = containersByLot(s)): number {
  let n = 0;
  // заблокированная партия (Б6ж: пробная партия до решения по досье) в производство не идёт
  for (const l of Object.values(s.lots)) if (l.material === material && l.status !== 'rejected' && l.status !== 'blocked' && !trialLot(s, l)) for (const c of byLot.get(l.id) ?? []) n += free(c);
  for (const po of Object.values(s.pos)) if (po.status === 'ordered' && !trialPo(po)) for (const l of po.lines) if (l.material === material) n += l.qty;
  for (const b of Object.values(s.batches)) {
    if (b.status === 'waiting') for (const l of db.recipes[b.recipe].bom) if (l.material === material) n -= l.qty;
    if (b.pack?.state === 'waiting') for (const x of packNeeds(db, b.pack)) if (x.material === material) n -= x.qty;
  }
  return n;
}

/** Заказ поставщику, который считает правило снабжения: строки и причина каждой. */
export interface SupplyOrder {
  supplier: Id;
  lines: PoLine[];
  why: PoWhy[];
}

/**
 * Правило снабжения (Б2в) без записи — его заказы на сейчас: всё, что ниже точки заказа, — расход на наибольший срок
 * поставки, входной контроль и страховой запас. Заказывают до точки заказа и ещё `every` суток расхода, не меньше
 * минимальной партии и не больше половины зоны карантина в паллетах: отбор проб начинают, когда в карантине вся партия
 * (lab.ts), и партия больше зоны его не дождётся. Недостающее — следующими днями. У поставщика — одним заказом. Пара —
 * первая из одобренных в спецификации, действующей сегодня (Б3г); нет её — материал не заказать. Тем же правилом окно
 * «Заказ поставщику» заполняет «Предложить» (Б5б).
 */
export function supplyPlan(db: ContentDb, s: PlantState): SupplyOrder[] {
  const sc = db.scenarios[s.scenario];
  if (!sc.supply || !sc.plan) return [];
  const now = momentOf(s.start, s.t);
  // страховой запас и на сколько суток заказ — политики начальника отдела снабжения (Б5г); входной контроль — сценария
  const safety = numOf(db, s, POL.safety)!;
  const every = numOf(db, s, POL.every)!;
  const { qc } = sc.supply;
  const room = Math.max(1, Math.floor((planOf(db, s.plan).byKind.quarantine?.length ?? 2) / 2));
  // тара по партиям — один проход на весь расчёт
  const byLot = containersByLot(s);
  const per = planUse(db, s, 1000, byLot);
  const lines = new Map<Id, PoLine[]>();
  // причина каждой строки — для журнала решений (Б5а)
  const whys = new Map<Id, PoWhy[]>();
  // паллет под количество материала — по его таре: у строк одного заказа тара разная
  const palletsOf = (m: Id, qty: number) => {
    const k = db.containers[db.materials[m].container];
    return Math.ceil(qty / (k.perPallet * k.capacity));
  };
  for (const material of per.keys()) {
    // расход на `d` суток из расхода на 1000 суток — вверх
    const use = (d: number) => Math.ceil((per.get(material)! * d) / 1000);
    const have = supplyPosition(db, s, material, byLot);
    // кому заказывать при двух поставщиках (Б6ж): заказ поставщика опоздает, если запаса с заказанным не хватит до его
    // прихода с верхом срока и входным контролем, — на столько суток
    const lasts = per.get(material)! > 0 ? Math.floor((Math.max(0, have) * 1000) / per.get(material)!) : Number.POSITIVE_INFINITY;
    const ch = choosePair(db, s, material, now.day, sup => Math.max(0, db.suppliers[sup].lead[1] + qc - lasts));
    if (!ch) continue;
    const pair = ch.pair;
    const sup = db.suppliers[pair.supplier];
    const point = use(sup.lead[1] + qc + safety);
    if (have >= point) continue;
    // паллет в заказе этого поставщика — не больше половины зоны карантина на весь заказ
    const c = db.containers[db.materials[material].container];
    const pallet = c.perPallet * c.capacity;
    const taken = (lines.get(sup.id) ?? []).reduce((n, l) => n + palletsOf(l.material, l.qty), 0);
    const moq = sup.items[material].moq;
    const want = Math.max(moq, point + use(every) - have);
    const qty = Math.min(want, (room - taken) * pallet);
    if (qty < moq) continue;
    lines.set(sup.id, [...(lines.get(sup.id) ?? []), { material, qty, maker: pair.maker }]);
    const why: PoWhy = { material, maker: pair.maker, have, per: per.get(material)!, point, lead: sup.lead[1], qc, safety, every, moq, want, ...(qty < want ? { cut: true as const } : {}), ...(ch.pick ? { pick: ch.pick } : {}) };
    whys.set(sup.id, [...(whys.get(sup.id) ?? []), why]);
  }
  return [...lines].map(([supplier, l]) => ({ supplier, lines: l, why: whys.get(supplier)! }));
}

/** Как заказывает начальник отдела снабжения (Б6д): по потребности или по точке заказа; без политики — по точке. */
export const howOf = (db: ContentDb, s: PlantState) => (policyOf(db, s, POL.how) === 'need' ? 'need' : 'point');

/**
 * Правило снабжения по потребности (Б6д) без записи: плановые заказы потребности в материалах (src/engine/plan/mrp.ts),
 * чья дата заказа пришла; у поставщика — одним заказом, не больше половины зоны карантина в паллетах, как у точки заказа.
 */
export function needPlan(db: ContentDb, s: PlantState): SupplyOrder[] {
  const sc = db.scenarios[s.scenario];
  if (!sc.supply || !sc.plan) return [];
  const r = mrpPlan(db, s);
  const room = Math.max(1, Math.floor((planOf(db, s.plan).byKind.quarantine?.length ?? 2) / 2));
  const lines = new Map<Id, PoLine[]>();
  const whys = new Map<Id, PoWhy[]>();
  const taken = new Map<Id, number>();
  const rows = new Map(r.rows.map(x => [x.material, x]));
  const every = numOf(db, s, POL.every)!;
  const safety = numOf(db, s, POL.safety)!;
  for (const o of r.planned) {
    if (o.orderBy > r.today) continue;
    const c = db.containers[db.materials[o.material].container];
    const pallet = c.perPallet * c.capacity;
    const moq = db.suppliers[o.supplier].items[o.material].moq;
    // у поставщика — не больше половины зоны карантина в паллетах, как у точки заказа
    const qty = Math.min(o.qty, (room - (taken.get(o.supplier) ?? 0)) * pallet);
    if (qty < moq) continue;
    taken.set(o.supplier, (taken.get(o.supplier) ?? 0) + Math.ceil(qty / pallet));
    lines.set(o.supplier, [...(lines.get(o.supplier) ?? []), { material: o.material, qty, maker: o.maker }]);
    const row = rows.get(o.material)!;
    const have = row.free + row.quarantine + row.transit.reduce((n, t) => n + t.qty, 0);
    const gross = row.months.find(m => m.m === o.month)?.gross ?? 0;
    const why: PoWhy = { rule: 'need', material: o.material, maker: o.maker, month: o.month, gross, have, need: o.need, deficit: o.deficit, late: o.late, lead: db.suppliers[o.supplier].lead[1], qc: sc.supply.qc, arrive: r.arrive, safety, safeQty: row.safety, every, moq, want: o.want, ...(qty < o.qty ? { cut: true as const } : {}) };
    whys.set(o.supplier, [...(whys.get(o.supplier) ?? []), why]);
  }
  return [...lines].map(([supplier, l]) => ({ supplier, lines: l, why: whys.get(supplier)! }));
}

/** Заказы правила снабжения сейчас (Б6д): по политике «как заказывать» — по потребности или по точке заказа. */
export const supplyOrders = (db: ContentDb, s: PlantState): SupplyOrder[] => (howOf(db, s) === 'need' ? needPlan(db, s) : supplyPlan(db, s));

/** Вещь предложения снабжения (Б5б): заказ поставщику — одно открытое у поставщика. */
export const poKey = (supplier: Id) => `po/${supplier}`;

/**
 * Каждый час: в рабочий день в 09:00 — правило снабжения (`supplyOrders`: с Б6д — по потребности или по точке заказа,
 * по политике «как заказывать»). Режим отдела (Б5б): «сам» — заказы; «советует»
 * — предложения тех же заказов с той же причиной и предоплатой по договору; у поставщика, которому заказ больше не
 * нужен, предложение «не нужно»; «вручную» — ничего.
 */
export function supplyDay(db: ContentDb, s: PlantState, notices: Notice[]) {
  const sc = db.scenarios[s.scenario];
  if (!sc.supply || !sc.plan) return;
  const mode = modeOf(s, 'supply');
  if (mode === 'manual') return;
  // руководитель — человек (Б5в): с 09:00, в первый час, когда есть кому решить
  const who = dueRule(db, s, 'supply', 'supply', SUPPLY_HOUR, notices);
  if (!who) return;
  const orders = supplyOrders(db, s);
  if (mode === 'auto') {
    asWho('supply', who, () => {
      for (const o of orders) placePo(db, s, { kind: 'po', supplier: o.supplier, lines: o.lines, by: 'head:supply' }, notices, o.why);
    });
    return;
  }
  const r = round(s, ['po/']);
  for (const o of orders) {
    const q = quotePo(db, s, o.supplier, o.lines);
    r.propose('supply', poKey(o.supplier), { kind: 'po', supplier: o.supplier, lines: o.lines }, { kind: 'po', supplier: o.supplier, prepaid: 'why' in q ? 0 : q.prepaid, why: o.why }, notices, who);
  }
  r.done();
}
