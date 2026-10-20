// Закупки (docs/specs/2026-10-engine.md, 1а, «Заказ поставщику и приёмка»; геймдизайн, §11). Заказ — команда `po`:
// количество — вверх до целой тары, не меньше минимальной партии. Срок прихода — из ветви поставщика; фура приходит в
// рабочий день с 09:00 до 15:00. Коллега снабжения (этап Б, Б2в; геймдизайн, §9.3, §29.3) — `supplyDay`: каждый рабочий
// день заказывает то, чего не хватит на срок поставки, входной контроль и страховой запас при расходе по плану выпуска.
import type { ContentDb, Id } from '../content/types';
import { schedule } from './core/agenda';
import { DAY, HOUR, isWorkday, MIN, momentOf } from './core/calendar';
import { part, post, vatRate } from './cash';
import { packNeeds } from './mes';
import { casesOf, positionOf } from './planner';
import { planOf } from './plant';
import { roll } from './random';
import { containersByLot, containersFor, free, nextId } from './stock';
import type { Command, Notice, PackJob, PlantState, Po } from './types';

/** Окно прихода фур: рабочий день, с 09:00, плюс до шести часов. */
const ARRIVE_FROM = 9 * HOUR;
const ARRIVE_SPREAD = 6 * HOUR;

export function placePo(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'po' }>, notices: Notice[]): Po | undefined {
  const sup = db.suppliers[cmd.supplier];
  if (!sup) {
    notices.push({ kind: 'refused', cmd: 'po', why: 'noSupplier', detail: cmd.supplier });
    return undefined;
  }
  if (cmd.lines.length === 0) {
    notices.push({ kind: 'refused', cmd: 'po', why: 'empty' });
    return undefined;
  }
  const lines = [];
  for (const l of cmd.lines) {
    const item = sup.items[l.material];
    if (!item) {
      notices.push({ kind: 'refused', cmd: 'po', why: 'notSold', detail: l.material });
      return undefined;
    }
    if (l.qty < item.moq) {
      notices.push({ kind: 'refused', cmd: 'po', why: 'belowMoq', detail: l.material });
      return undefined;
    }
    const cap = db.containers[db.materials[l.material].container].capacity;
    lines.push({ material: l.material, qty: containersFor(db, l.material, l.qty) * cap });
  }
  const eta = etaOf(s, sup.id, sup.lead);
  // сумма с НДС: АФС — по ставке лекарственных средств, остальное — по общей; предоплата — сейчас, остаток — после прихода
  let net = 0;
  let vat = 0;
  for (const l of lines) {
    const price = sup.items[l.material].price;
    const cost = db.materials[l.material].unit === 'mass' ? Math.floor((price * l.qty + 500_000) / 1_000_000) : price * l.qty;
    net += cost;
    vat += part(cost, vatRate(db, s, l.material));
  }
  const po: Po = { id: nextId(s, 'P'), supplier: sup.id, lines, ordered: s.t, eta, status: 'ordered', by: cmd.by ?? 'player', sum: net + vat, vat, prepaid: part(net + vat, sup.prepay) };
  s.pos[po.id] = po;
  post(s, -po.prepaid!, 'prepay', po.id);
  schedule(s.agenda, eta, { kind: 'truck', po: po.id });
  notices.push({ kind: 'ordered', po: po.id, eta });
  return po;
}

/** Срок прихода заказа поставщику из его ветви: через `lead` дней, рабочим днём в окне прихода. */
export function etaOf(s: PlantState, supplier: Id, lead: [number, number]): number {
  return roll(s, `supply/${supplier}`, r => {
    const days = r.range(lead[0], lead[1]);
    return arrival(s, s.t + days * DAY, r.int(ARRIVE_SPREAD / MIN) * MIN);
  });
}

/** Ближайший рабочий день не раньше `t` — в 09:00 плюс `extra` секунд. */
function arrival(s: PlantState, t: number, extra: number): number {
  let day = t - momentOf(s.start, t).sec;
  for (let i = 0; i < 7; i++) {
    const wd = momentOf(s.start, day).weekday;
    if (wd < 5) return day + ARRIVE_FROM + extra;
    day += DAY;
  }
  return day + ARRIVE_FROM + extra;
}

/** Коллега снабжения сидит с 09:00: в этот час рабочего дня он и считает (гипотеза). */
export const SUPPLY_HOUR = 9 * HOUR;

/**
 * Расход по плану выпуска за `days` суток: серий в сутки по позиции — по спросу её заказов (как у коллеги планирования),
 * а пока спроса не видно — по серии в рабочий день поровну; на серию — состав карты и упаковка позиции. Счёт — в
 * тысячных долях серии, в целых.
 */
export function planUse(db: ContentDb, s: PlantState, days: number, byLot = containersByLot(s)): Map<Id, number> {
  const plan = db.scenarios[s.scenario].plan;
  const out = new Map<Id, number>();
  if (!plan) return out;
  const pos = plan.items.map(it => positionOf(db, s, it.sku, plan.window, byLot));
  const blind = pos.some(p => p.span === 0);
  plan.items.forEach((it, i) => {
    const r = db.recipes[it.recipe];
    const p = pos[i];
    // тысячных серии в сутки: вслепую — 5/7 серии на все позиции; по спросу — ящики в сутки / ящики с серии
    const milli = blind ? Math.floor(5000 / (7 * plan.items.length)) : Math.floor((p.ordered * DAY * 1000) / (p.span * casesOf(r, db.skus[it.sku])));
    const add = (material: Id, perBatch: number) => out.set(material, (out.get(material) ?? 0) + Math.ceil((milli * days * perBatch) / 1000));
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

/**
 * Каждый час: в рабочий день в 09:00 — заказ у одобренного поставщика всего, что ниже точки заказа: расход на наибольший
 * срок поставки, входной контроль и страховой запас. Заказывают до точки заказа и ещё `every` суток расхода, не меньше
 * минимальной партии и не больше половины зоны карантина в паллетах: отбор проб начинают, когда в карантине вся партия
 * (lab.ts), и партия больше зоны его не дождётся. Недостающее — следующими днями. У поставщика — одним заказом.
 */
export function supplyDay(db: ContentDb, s: PlantState, notices: Notice[]) {
  const sc = db.scenarios[s.scenario];
  const now = momentOf(s.start, s.t);
  if (!sc.supply || !sc.plan || !isWorkday(now.day) || now.sec !== SUPPLY_HOUR) return;
  const { safety, every, qc } = sc.supply;
  const room = Math.max(1, Math.floor((planOf(db, s.plant).byKind.quarantine?.length ?? 2) / 2));
  // тара по партиям — один проход на весь расчёт
  const byLot = containersByLot(s);
  const per = planUse(db, s, 1000, byLot);
  const lines = new Map<Id, { material: Id; qty: number }[]>();
  for (const material of per.keys()) {
    const sup = Object.values(db.suppliers)
      .filter(x => x.approved && x.items[material])
      .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    if (!sup) continue;
    // расход на `d` суток из расхода на 1000 суток — вверх
    const use = (d: number) => Math.ceil((per.get(material)! * d) / 1000);
    const point = use(sup.lead[1] + qc + safety);
    const have = supplyPosition(db, s, material, byLot);
    if (have >= point) continue;
    // паллет в заказе этого поставщика — не больше половины зоны карантина на весь заказ
    const c = db.containers[db.materials[material].container];
    const pallet = c.perPallet * c.capacity;
    const taken = (lines.get(sup.id) ?? []).reduce((n, l) => n + Math.ceil(l.qty / pallet), 0);
    const qty = Math.min(Math.max(sup.items[material].moq, point + use(every) - have), (room - taken) * pallet);
    if (qty < sup.items[material].moq) continue;
    lines.set(sup.id, [...(lines.get(sup.id) ?? []), { material, qty }]);
  }
  for (const [supplier, l] of lines) placePo(db, s, { kind: 'po', supplier, lines: l, by: 'head:supply' }, notices);
}
