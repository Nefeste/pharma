// Контрагенты и договоры для окна (Б3г; docs/specs/2026-10-vertical-slice.md, «Б3г»): вкладка «Контрагенты»
// справочника — изготовители, пары «поставщик — изготовитель» с одобрением и оценкой, соглашение по качеству,
// действующие договоры с обещанным и купленным; планёрка — «Поставщики». Одобрения, оценки и договоры — знание завода
// по его записям, а не истина: брак партий у поставщика, спрос покупателей и истинные свойства партий сюда не идут.
import type { ContentDb, Id } from '../content/types';
import { lastOfMonth, momentOf } from '../engine/core/calendar';
import { agreementFor, howOf, pairDeal, pairKey, pairMaterials, pairValid, specPairs } from '../engine/partners';
import type { ContractLine, PlantState } from '../engine/types';

/** Изготовитель: что выпускает; название, страна и площадка — из базы окна. */
export interface RefMaker {
  id: Id;
  makes: Id[];
}

/**
 * Пара (Б3г): материалы, которые поставщик продаёт от этого изготовителя; как оценивают; последняя оценка — день и
 * последний день одобрения (номера дней от 1970-01-01); одобрена ли сегодня; соглашение по качеству, действующее
 * сегодня; назначенная оценка — аудит у изготовителя с и по (мгновения, с) или рассмотрение специалистом ООК.
 */
export interface RefPair {
  id: string;
  supplier: Id;
  maker: Id;
  materials: Id[];
  how: 'audit' | 'docs';
  since?: number;
  until?: number;
  ok: boolean;
  agreement?: Id;
  eval?: { how: 'audit' | 'docs'; from?: number; to?: number; review: boolean };
}

/** Договор (Б3г): номер, сторона, вид, первый и последний день; у рамочного — строки по парам: цена, обещано и куплено. */
export interface RefContract {
  id: string;
  party: Id;
  kind: 'frame' | 'supply';
  from: number;
  to: number;
  lines: ContractLine[];
}

export interface PartnersView {
  makers: RefMaker[];
  pairs: RefPair[];
  contracts: RefContract[];
  /** срок предупреждения, сутки: у пары, чьё одобрение кончится раньше, — оценка */
  ahead: number;
}

/** Пара для окна. */
function pairRow(db: ContentDb, s: PlantState, id: string, day: number): RefPair {
  const p = s.pairs[id];
  const last = p.recs[p.recs.length - 1];
  const materials = pairMaterials(db, p.supplier, p.maker);
  const agreement = materials.map(m => agreementFor(db, p.supplier, p.maker, m, day)).find(Boolean);
  const e = p.eval;
  return {
    id,
    supplier: p.supplier,
    maker: p.maker,
    materials,
    how: howOf(db, p.supplier, p.maker),
    ...(last ? { since: last.day, until: last.until } : {}),
    ok: pairValid(p, day),
    ...(agreement ? { agreement } : {}),
    ...(e ? { eval: { how: e.how, ...(e.from !== undefined ? { from: e.from, to: e.to } : {}), review: e.task !== undefined } } : {}),
  };
}

/** Вкладка «Контрагенты»: изготовители, пары, действующие договоры. */
export function partnersView(db: ContentDb, s: PlantState): PartnersView {
  const day = momentOf(s.start, s.t).day;
  const contracts = Object.values(s.contracts)
    .filter(c => !c.closed)
    .map(c => ({ id: c.id, party: c.party, kind: c.kind, from: c.from, to: c.to, lines: c.lines.map(l => ({ ...l })) }));
  return {
    makers: Object.values(db.makers).map(m => ({ id: m.id, makes: [...m.makes] })),
    pairs: Object.keys(s.pairs).map(id => pairRow(db, s, id, day)),
    contracts,
    ahead: db.scenarios[s.scenario].partners.ahead,
  };
}

/** Одобренные пары спецификации материала, действующей сегодня, — для вкладки «Материалы». */
export function materialPairs(db: ContentDb, material: Id, day: number): { supplier: Id; maker: Id }[] {
  return specPairs(db, material, day).map(x => ({ supplier: x.supplier, maker: x.maker }));
}

/**
 * Планёрка — «Поставщики» (Б3г): оценки и аудиты в срок предупреждения и идущие, приостановленные пары, договоры,
 * которые кончаются в этом месяце, и сколько по их парам осталось докупить до обещанной доли — стоимостью по цене
 * договора, копейки.
 */
export interface PartnerSum {
  soon: RefPair[];
  suspended: RefPair[];
  ending: { id: string; party: Id; to: number }[];
  short: { contract: string; supplier: Id; maker: Id; volume: number; bought: number; need: number }[];
  ahead: number;
}

export function partnerSum(db: ContentDb, s: PlantState): PartnerSum {
  const now = momentOf(s.start, s.t);
  const day = now.day;
  const sc = db.scenarios[s.scenario];
  const out: PartnerSum = { soon: [], suspended: [], ending: [], short: [], ahead: sc.partners.ahead };
  for (const id of Object.keys(s.pairs)) {
    const p = s.pairs[id];
    if (p.recs.length === 0 || !live(db, id, day)) continue;
    const row = pairRow(db, s, id, day);
    if (!row.ok) out.suspended.push(row);
    else if (row.eval || (row.until ?? 0) - day < sc.partners.ahead) out.soon.push(row);
  }
  out.soon.sort((a, b) => (a.until ?? 0) - (b.until ?? 0) || (a.id < b.id ? -1 : 1));
  // кончается в этом месяце: последний день — не позже последнего дня месяца
  const monthEnd = lastOfMonth(now.date.y, now.date.m);
  for (const c of Object.values(s.contracts)) {
    if (c.closed) continue;
    if (c.to > monthEnd) continue;
    out.ending.push({ id: c.id, party: c.party, to: c.to });
    if (c.kind !== 'frame') continue;
    for (const maker of new Set(c.lines.map(l => l.maker))) {
      const d = pairDeal(db, c, maker);
      const need = Math.max(0, Math.ceil((sc.partners.share * d.volume) / 10_000) - d.bought);
      out.short.push({ contract: c.id, supplier: c.party, maker, volume: d.volume, bought: d.bought, need });
    }
  }
  return out;
}

/** Пара есть в спецификации какого-нибудь материала, действующей сегодня. */
function live(db: ContentDb, id: string, day: number): boolean {
  return Object.values(db.materials).some(m => specPairs(db, m.id, day).some(x => pairKey(x.supplier, x.maker) === id));
}

/** По какому договору куплена партия и сколько из её строки заказа — по прайсу (карточка партии). */
export function lotDeal(s: PlantState, lotId: string): { contract?: string; list?: number } | undefined {
  const lot = s.lots[lotId];
  const po = lot?.po ? s.pos[lot.po] : undefined;
  const line = po?.lines.find(l => l.material === lot.material);
  if (!line) return undefined;
  return { ...(line.contract ? { contract: line.contract } : {}), ...(line.list ? { list: line.list } : {}) };
}
