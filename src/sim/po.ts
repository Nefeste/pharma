// Окно «Заказ поставщику» (Б5б; docs/specs/2026-10-vertical-slice.md, «Б5б»): снабжение вручную. Поставщики — те, у кого
// сегодня есть одобренная пара «поставщик — изготовитель» хоть на один материал; у поставщика — материалы его одобренных
// пар: наименьшая партия, тара, цена по договору до остатка обещанного и по прайсу. Черновик заказа окна — строки
// материала и количества: вид отвечает, как завод его примет — строки до целой тары, стоимость, НДС и предоплата, или
// отказ с материалом строки (тот же, что у команды `po`). «Предложить» — заказы правила снабжения на сейчас. Данные —
// без слов, только то, что завод знает: договоры, прайс, одобрения и своё положение материалов.
import type { ContentDb, Id } from '../content/types';
import { momentOf } from '../engine/core/calendar';
import { approved, contractOf, listPrice } from '../engine/partners';
import { quotePo, supplyPlan } from '../engine/supply';
import type { PlantState, PoLine, Refusal } from '../engine/types';

/** Запрос окна: поставщик и строки черновика — материал и количество, мг или шт. */
export interface PoQuery {
  view: 'po';
  supplier?: Id;
  lines: { material: Id; qty: number }[];
}

/** Материал поставщика: одобрена ли пара сегодня, наименьшая партия, тара, цена прайса и договора с остатком обещанного. */
export interface PoItem {
  material: Id;
  maker: Id;
  ok: boolean;
  moq: number;
  cap: number;
  list: number;
  contract?: { id: string; price: number; left: number };
}

/** Поставщик окна: срок поставки, предоплата — доли 1/10 000 — и материалы. */
export interface PoSupplier {
  id: Id;
  lead: [number, number];
  prepay: number;
  items: PoItem[];
}

/** Как завод примет черновик: строки до целой тары со стоимостью, итоги; или отказ с материалом строки. */
export type PoAnswer = { lines: { material: Id; qty: number; cost: number }[]; net: number; vat: number; prepaid: number } | { why: Refusal; detail?: string };

export interface PoView {
  view: 'po';
  suppliers: PoSupplier[];
  supplier?: Id;
  answer?: PoAnswer;
  /** правило снабжения сейчас (Б2в): его заказы — для «Предложить» */
  plan: { supplier: Id; lines: { material: Id; qty: number }[] }[];
}

/** Поставщики с одобренной сегодня парой и их материалы. */
function suppliersOf(db: ContentDb, s: PlantState): PoSupplier[] {
  const day = momentOf(s.start, s.t).day;
  const c = (id: Id) => contractOf(s, id, day);
  return Object.values(db.suppliers)
    .map(sup => {
      const ct = c(sup.id);
      const items = Object.entries(sup.items).map(([material, it]): PoItem => {
        const cl = ct?.lines.find(x => x.material === material && x.maker === it.maker);
        return {
          material,
          maker: it.maker,
          ok: approved(db, s, sup.id, it.maker, material, day),
          moq: it.moq,
          cap: db.containers[db.materials[material].container].capacity,
          list: listPrice(db, s, it.price),
          ...(cl ? { contract: { id: ct!.id, price: cl.price, left: Math.max(0, cl.volume - cl.bought) } } : {}),
        };
      });
      return { id: sup.id, lead: sup.lead, prepay: sup.prepay, items };
    })
    .filter(x => x.items.some(i => i.ok));
}

/** Окно «Заказ поставщику»: поставщики, ответ завода на черновик, заказы правила снабжения. */
export function poView(db: ContentDb, s: PlantState, q: PoQuery): PoView {
  const suppliers = suppliersOf(db, s);
  const supplier = q.supplier && suppliers.some(x => x.id === q.supplier) ? q.supplier : suppliers[0]?.id;
  let answer: PoAnswer | undefined;
  if (supplier && q.lines.length > 0) {
    const r = quotePo(db, s, supplier, q.lines as PoLine[]);
    answer = 'why' in r ? { why: r.why, ...(r.detail ? { detail: r.detail } : {}) } : { lines: r.lines.map((l, i) => ({ material: l.material, qty: l.qty, cost: r.costs[i] })), net: r.net, vat: r.vat, prepaid: r.prepaid };
  }
  const plan = supplyPlan(db, s).map(o => ({ supplier: o.supplier, lines: o.lines.map(l => ({ material: l.material, qty: l.qty })) }));
  return { view: 'po', suppliers, ...(supplier ? { supplier } : {}), ...(answer ? { answer } : {}), plan };
}
