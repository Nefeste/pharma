// Закупки (docs/specs/2026-10-engine.md, 1а, «Заказ поставщику и приёмка»; геймдизайн, §11). Заказ — команда `po`:
// количество — вверх до целой тары, не меньше минимальной партии. Срок прихода — из ветви поставщика; фура приходит в
// рабочий день с 09:00 до 15:00. Коллега снабжения (этап Б, Б2в; геймдизайн, §9.3, §29.3) — `supplyDay`: каждый рабочий
// день заказывает то, чего не хватит на срок поставки, входной контроль и страховой запас при расходе по плану выпуска.
// С Б3г заказывают только по одобренной паре «поставщик — изготовитель» действующей спецификации, по цене рамочного
// договора, а сверх обещанного — по прайсу (partners.ts).
import type { ContentDb, Id } from '../content/types';
import { schedule } from './core/agenda';
import { DAY, HOUR, isWorkday, MIN, momentOf, workdayOnOrAfter } from './core/calendar';
import { part, post, vatRate } from './cash';
import { inForce } from './docs';
import { modeOf, round } from './heads';
import { noteCmd } from './journal';
import { packNeeds } from './mes';
import { approved, linePrice, pairsFor, priceLine } from './partners';
import { aheadMilli, casesOf, positionOf } from './planner';
import { planOf } from './plant';
import { roll } from './random';
import { containersByLot, containersFor, free, nextId } from './stock';
import type { Command, Notice, PackJob, PlantState, Po, PoLine, PoWhy, Refusal } from './types';
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

export function quotePo(db: ContentDb, s: PlantState, supplier: Id, want: readonly PoLine[]): PoQuote {
  const sup = db.suppliers[supplier];
  if (!sup) return { why: 'noSupplier', detail: supplier };
  if (want.length === 0) return { why: 'empty' };
  const lines: PoLine[] = [];
  const today = momentOf(s.start, s.t).day;
  for (const l of want) {
    const item = sup.items[l.material];
    if (!item) return { why: 'notSold', detail: l.material };
    if (l.qty < item.moq) return { why: 'belowMoq', detail: l.material };
    // только по одобренной паре действующей спецификации (Б3г): изготовитель — из записи поставщика
    const maker = item.maker;
    if ((l.maker !== undefined && l.maker !== maker) || !approved(db, s, sup.id, maker, l.material, today)) return { why: 'pair', detail: l.material };
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

export function placePo(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'po' }>, notices: Notice[], why?: PoWhy[]): Po | undefined {
  const q = quotePo(db, s, cmd.supplier, cmd.lines);
  if ('why' in q) {
    notices.push({ kind: 'refused', cmd: 'po', why: q.why, ...(q.detail ? { detail: q.detail } : {}) });
    return undefined;
  }
  const sup = db.suppliers[cmd.supplier];
  const lines = q.lines;
  const eta = etaOf(db, s, sup.id, sup.lead);
  // сумма с НДС: АФС — по ставке лекарственных средств, остальное — по общей; предоплата — сейчас, остаток — после прихода
  let net = 0;
  let vat = 0;
  for (const l of lines) {
    // по договору — до остатка обещанного, сверх — по прайсу (Б3г)
    const cost = priceLine(db, s, sup.id, l);
    net += cost;
    vat += part(cost, vatRate(db, s, l.material));
  }
  const po: Po = { id: nextId(s, 'P'), supplier: sup.id, lines, ordered: s.t, eta, status: 'ordered', by: cmd.by ?? 'player', sum: net + vat, vat, prepaid: part(net + vat, sup.prepay) };
  s.pos[po.id] = po;
  post(s, -po.prepaid!, 'prepay', po.id);
  schedule(s.agenda, eta, { kind: 'truck', po: po.id });
  notices.push({ kind: 'ordered', po: po.id, eta });
  // журнал решений (Б5а): игрок или начальник отдела снабжения — с положением материалов
  noteCmd(s, cmd, { kind: 'po', po: po.id, supplier: po.supplier, prepaid: po.prepaid ?? 0, ...(why ? { why } : {}) });
  return po;
}

/** Срок прихода заказа поставщику из его ветви: через `lead` дней, рабочим днём в окне прихода. */
export function etaOf(db: ContentDb, s: PlantState, supplier: Id, lead: [number, number]): number {
  return roll(s, `supply/${supplier}`, r => {
    const days = r.range(lead[0], lead[1]);
    return arrival(db, s, s.t + days * DAY, r.int(ARRIVE_SPREAD / MIN) * MIN);
  });
}

/** Ближайший рабочий день не раньше `t` по производственному календарю (Б4а) — в 09:00 плюс `extra` секунд. */
function arrival(db: ContentDb, s: PlantState, t: number, extra: number): number {
  const m = momentOf(s.start, t);
  return t - m.sec + (workdayOnOrAfter(calOf(db, s), m.day) - m.day) * DAY + ARRIVE_FROM + extra;
}

/** Коллега снабжения сидит с 09:00: в этот час рабочего дня он и считает (гипотеза). */
export const SUPPLY_HOUR = 9 * HOUR;

/**
 * Расход по плану выпуска за `days` суток: серий в рабочий день по позиции — по спросу её заказов на рабочий день (как
 * у коллеги планирования, Б4а), а пока спроса не видно — по серии в рабочий день поровну, — на рабочие дни этих суток;
 * на серию — состав карты и упаковка позиции. Счёт — в тысячных долях серии, в целых.
 */
export function planUse(db: ContentDb, s: PlantState, days: number, byLot = containersByLot(s)): Map<Id, number> {
  const plan = db.scenarios[s.scenario].plan;
  const out = new Map<Id, number>();
  if (!plan) return out;
  const pos = plan.items.map(it => positionOf(db, s, it.sku, plan.window, byLot));
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
 * Что у завода есть и будет по материалу: свободное в таре всех партий, кроме отклонённых (карантин и испытания тоже —
 * их ждут), и заказанное в пути, минус то, чего ждут задания на серию и на упаковку без резерва.
 */
export function supplyPosition(db: ContentDb, s: PlantState, material: Id, byLot = containersByLot(s)): number {
  let n = 0;
  for (const l of Object.values(s.lots)) if (l.material === material && l.status !== 'rejected') for (const c of byLot.get(l.id) ?? []) n += free(c);
  for (const po of Object.values(s.pos)) if (po.status === 'ordered') for (const l of po.lines) if (l.material === material) n += l.qty;
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
  const { safety, every, qc } = sc.supply;
  const room = Math.max(1, Math.floor((planOf(db, s.plant).byKind.quarantine?.length ?? 2) / 2));
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
    const pair = pairsFor(db, s, material, now.day)[0];
    if (!pair) continue;
    const sup = db.suppliers[pair.supplier];
    // расход на `d` суток из расхода на 1000 суток — вверх
    const use = (d: number) => Math.ceil((per.get(material)! * d) / 1000);
    const point = use(sup.lead[1] + qc + safety);
    const have = supplyPosition(db, s, material, byLot);
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
    const why: PoWhy = { material, maker: pair.maker, have, per: per.get(material)!, point, lead: sup.lead[1], qc, safety, every, moq, want, ...(qty < want ? { cut: true as const } : {}) };
    whys.set(sup.id, [...(whys.get(sup.id) ?? []), why]);
  }
  return [...lines].map(([supplier, l]) => ({ supplier, lines: l, why: whys.get(supplier)! }));
}

/** Вещь предложения снабжения (Б5б): заказ поставщику — одно открытое у поставщика. */
export const poKey = (supplier: Id) => `po/${supplier}`;

/**
 * Каждый час: в рабочий день в 09:00 — правило снабжения (`supplyPlan`). Режим отдела (Б5б): «сам» — заказы; «советует»
 * — предложения тех же заказов с той же причиной и предоплатой по договору; у поставщика, которому заказ больше не
 * нужен, предложение «не нужно»; «вручную» — ничего.
 */
export function supplyDay(db: ContentDb, s: PlantState, notices: Notice[]) {
  const sc = db.scenarios[s.scenario];
  const now = momentOf(s.start, s.t);
  if (!sc.supply || !sc.plan || !isWorkday(calOf(db, s), now.day) || now.sec !== SUPPLY_HOUR) return;
  const mode = modeOf(s, 'supply');
  if (mode === 'manual') return;
  const orders = supplyPlan(db, s);
  if (mode === 'auto') {
    for (const o of orders) placePo(db, s, { kind: 'po', supplier: o.supplier, lines: o.lines, by: 'head:supply' }, notices, o.why);
    return;
  }
  const r = round(s, ['po/']);
  for (const o of orders) {
    const q = quotePo(db, s, o.supplier, o.lines);
    r.propose('supply', poKey(o.supplier), { kind: 'po', supplier: o.supplier, lines: o.lines }, { kind: 'po', supplier: o.supplier, prepaid: 'why' in q ? 0 : q.prepaid, why: o.why }, notices);
  }
  r.done();
}
