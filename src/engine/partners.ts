// Контрагенты и договоры (Б3г; docs/specs/2026-10-vertical-slice.md, «Б3г»): изготовитель — своей записью, поставщик —
// сам изготовитель или дистрибьютор. Одобренные пары «поставщик — изготовитель» — в спецификации материала (GMP ЕАЭС,
// ч. I, п. 4.14); у пары — одобрение со сроком: у АФС и вспомогательных веществ — аудит изготовителя (у АФС от
// дистрибьютора — ещё и проверка дистрибьютора по документам), у упаковки — оценка по документам (п. 5.29). Пара
// одобрена, только пока у её поставщика действует соглашение по качеству (п. 5.28). Аудит ведёт сторонний аудитор по
// договору (п. 5.29; гл. 7): его назначает коллега качества за срок предупреждения, отчёт рассматривает специалист ООК,
// запись — с днём рассмотрения. Срок вышел — пара приостановлена: по ней не заказывают. Рамочный договор с поставщиком
// (ГК РФ, ст. 429.1) — на год: цена и обещанный объём по паре; сверх обещанного — по прайсу; недобор обещанной доли —
// счёт за разницу. У покупателя — договор поставки (ст. 506). Одобрения и договоры — знание завода, а не истина.
import type { ContentDb, Id, MaterialKind, Scenario } from '../content/types';
import { part, post, vatRate } from './cash';
import { schedule } from './core/agenda';
import { addMonths, addWorkdays, DAY, daysFromCivil, HOUR, isWorkday, momentOf } from './core/calendar';
import { fnv1a } from './core/hash';
import { type DocKind, inForce, revisions } from './docs';
import { note } from './journal';
import { planOf } from './plant';
import { QA } from './qa';
import { planUse } from './supply';
import { addTask } from './tasks';
import type { Contract, Notice, Pair, PlantState, PoLine, Task } from './types';
import { calOf } from './workdays';

/** Исходные и упаковочные материалы — их покупают, и у них одобренные пары; своя продукция — балк и готовая — нет. */
export const STARTING: ReadonlySet<MaterialKind | undefined> = new Set<MaterialKind | undefined>(['api', 'excipient', 'packaging']);

/** Как оценивают пару по виду материала (п. 5.29; Б3г): аудит изготовителя или оценка по документам. */
export type How = 'audit' | 'docs';
const HOW: Record<'api' | 'excipient' | 'packaging', How> = { api: 'audit', excipient: 'audit', packaging: 'docs' };

/** Отчёт аудитора и документы рассматривает специалист ООК (Б3г). */
export const REVIEWERS = QA.specialists;

/** Рассмотрение — ниже выпуска и приёмки, выше обучения: у пары в запасе срок предупреждения (гипотеза). */
export const REVIEW_PRIO = 3;

/** Коллега качества смотрит сроки в 09:00 рабочего дня, как коллеги снабжения и техслужбы (гипотеза). */
export const BOOK_HOUR = 9 * HOUR;

/** Аудитор у изготовителя — с 09:00 первого рабочего дня до 17:00 последнего: тогда и приходит отчёт (гипотеза). */
const AUDIT_FROM = 9 * HOUR;
const AUDIT_TO = 17 * HOUR;

/** Ключ пары в состоянии. */
export const pairKey = (supplier: Id, maker: Id) => `${supplier}|${maker}`;

/** Номер договора: латиницей по порядку. */
export const ctrNo = (n: number) => `CTR-${String(n).padStart(4, '0')}`;

/**
 * Соглашение по качеству, действующее в день `day` (Б3г): редакция, введённая не позже этого дня и ещё не сменённая
 * следующей, — с этим поставщиком, на этого изготовителя и этот материал. Нет — `undefined`.
 */
export function agreementFor(db: Pick<ContentDb, DocKind>, supplier: Id, maker: Id, material: Id, day: number): Id | undefined {
  for (const [id, a] of Object.entries(db.agreements)) {
    if (a.supplier !== supplier || !a.makers.includes(maker) || !a.materials.includes(material)) continue;
    if (a.doc.from <= day && inForce(db, 'agreements', id, day) === id) return id;
  }
  return undefined;
}

/** Материалы пары: что поставщик продаёт от этого изготовителя. */
export function pairMaterials(db: ContentDb, supplier: Id, maker: Id): Id[] {
  return Object.entries(db.suppliers[supplier]?.items ?? {})
    .filter(([, it]) => it.maker === maker)
    .map(([m]) => m);
}

/** Как оценивают пару: аудитом, если среди её материалов есть АФС или вспомогательное вещество; иначе — по документам. */
export function howOf(db: ContentDb, supplier: Id, maker: Id): How {
  return pairMaterials(db, supplier, maker).some(m => HOW[db.materials[m].kind as keyof typeof HOW] === 'audit') ? 'audit' : 'docs';
}

/** Через сколько месяцев оценивать пару снова: по самому строгому виду её материалов. */
export function everyOf(db: ContentDb, sc: Scenario, supplier: Id, maker: Id): number {
  const kinds = pairMaterials(db, supplier, maker).map(m => db.materials[m].kind as keyof Scenario['partners']['every']);
  return Math.min(...kinds.map(k => sc.partners.every[k]));
}

/** Пары спецификации материала, действующей в день `day`. */
export function specPairs(db: ContentDb, material: Id, day: number): { supplier: Id; maker: Id }[] {
  const m = db.materials[material];
  return m ? (db.specs[inForce(db, 'specs', m.spec, day)]?.pairs ?? []) : [];
}

/** Действует ли одобрение пары в день `day`: последняя запись не позже и срок не вышел. */
export function pairValid(p: Pair | undefined, day: number): boolean {
  const r = p?.recs[p.recs.length - 1];
  return !!r && r.day <= day && day <= r.until;
}

/** Одобрена ли пара для материала в день `day`: она в действующей спецификации, одобрение в сроке, соглашение действует. */
export function approved(db: ContentDb, s: PlantState, supplier: Id, maker: Id, material: Id, day: number): boolean {
  return specPairs(db, material, day).some(x => x.supplier === supplier && x.maker === maker) && pairValid(s.pairs[pairKey(supplier, maker)], day) && !!agreementFor(db, supplier, maker, material, day);
}

/** Одобренные пары материала на день `day` — по поставщику, затем по изготовителю. */
export function pairsFor(db: ContentDb, s: PlantState, material: Id, day: number): { supplier: Id; maker: Id }[] {
  return specPairs(db, material, day)
    .filter(x => approved(db, s, x.supplier, x.maker, material, day))
    .sort((a, b) => (a.supplier < b.supplier ? -1 : a.supplier > b.supplier ? 1 : a.maker < b.maker ? -1 : 1));
}

/**
 * Пары на начало партии и в миграции (Б3г): каждая пара, что есть в какой-нибудь редакции спецификации. У пары из
 * спецификации, действующей в день `day`, — запись последней оценки в прошлом, у каждой свой день по хешу пары, как у
 * записей активов (Б3в), но не раньше, чем пара впервые вошла в спецификацию; срок — не раньше, чем через срок
 * предупреждения: на старте всё в сроке. Пара только из будущей редакции — без записей: одобрения нового поставщика в
 * Б3г нет.
 */
export function seedPairs(db: ContentDb, sc: Scenario, s: Pick<PlantState, 'pairs'>, day: number) {
  const first = new Map<string, number>();
  const now = new Set<string>();
  for (const m of Object.values(db.materials)) {
    if (!STARTING.has(m.kind)) continue;
    for (const rev of revisions(db, 'specs', m.spec)) {
      for (const x of db.specs[rev].pairs ?? []) {
        const key = pairKey(x.supplier, x.maker);
        first.set(key, Math.min(first.get(key) ?? Number.POSITIVE_INFINITY, db.specs[rev].doc.from));
      }
    }
    for (const x of specPairs(db, m.id, day)) now.add(pairKey(x.supplier, x.maker));
  }
  for (const key of [...first.keys()].sort()) {
    const [supplier, maker] = key.split('|');
    const p: Pair = { id: key, supplier, maker, recs: [] };
    if (now.has(key)) {
      const every = everyOf(db, sc, supplier, maker);
      const span = Math.max(0, addMonths(day, every) - day - sc.partners.ahead - 3);
      const d = Math.max(day - (fnv1a(key) % (span + 1)), Math.min(day, first.get(key)!));
      p.recs.push({ day: d, until: addMonths(d, every) - 1, how: howOf(db, supplier, maker) });
    }
    s.pairs[key] = p;
  }
}

/** Сколько дней в договоре с первого дня `from`: `months` месяцев. */
const termOf = (sc: Scenario, from: number) => addMonths(from, sc.partners.months) - 1;

/**
 * Рамочный договор с поставщиком с дня `from` (Б3г): по каждой паре его материалов, одобренной в этот день, — цена
 * записи поставщика и обещанный объём — расход по плану выпуска на срок договора; номер — следующий по порядку.
 */
function frameContract(db: ContentDb, s: PlantState, supplier: Id, from: number, use: Map<Id, number>): Contract | undefined {
  const sc = db.scenarios[s.scenario];
  const lines = Object.entries(db.suppliers[supplier].items)
    .filter(([m, it]) => approved(db, s, supplier, it.maker, m, from))
    .map(([m, it]) => ({ material: m, maker: it.maker, price: it.price, volume: use.get(m) ?? 0, bought: 0 }));
  if (lines.length === 0) return undefined;
  const id = ctrNo((s.next.ctr = (s.next.ctr ?? sc.partners.ctr - 1) + 1));
  const c: Contract = { id, party: supplier, kind: 'frame', from, to: termOf(sc, from), lines };
  s.contracts[id] = c;
  return c;
}

/** Расход по плану выпуска на срок договора с дня `from`. */
const useFor = (db: ContentDb, s: PlantState, from: number) => planUse(db, s, termOf(db.scenarios[s.scenario], from) - from + 1);

/**
 * Договоры на начало партии и в миграции (Б3г): рамочные — с поставщиками по порядку id, у кого есть одобренные пары;
 * поставки — с покупателями сценария по его порядку. Первый день — `day`, купленное — ноль.
 */
export function seedContracts(db: ContentDb, sc: Scenario, s: PlantState, day: number) {
  const use = useFor(db, s, day);
  for (const id of Object.keys(db.suppliers).sort()) frameContract(db, s, id, day, use);
  for (const cu of sc.customers) {
    const id = ctrNo((s.next.ctr = (s.next.ctr ?? sc.partners.ctr - 1) + 1));
    s.contracts[id] = { id, party: cu, kind: 'supply', from: day, to: termOf(sc, day), lines: [] };
  }
}

/** Действующий договор стороны в день `day`. */
export function contractOf(s: PlantState, party: Id, day: number): Contract | undefined {
  for (const c of Object.values(s.contracts)) if (c.party === party && !c.closed && c.from <= day && day <= c.to) return c;
  return undefined;
}

/** Стоимость количества по цене: у материала по массе цена — за кг, количество — в мг. */
export function costOf(db: ContentDb, material: Id, price: number, qty: number): number {
  return db.materials[material].unit === 'mass' ? Math.floor((price * qty + 500_000) / 1_000_000) : price * qty;
}

/** Цена прайса — дороже цены договора на наценку сценария. */
export const listPrice = (db: ContentDb, s: PlantState, price: number) => Math.round((price * (10_000 + db.scenarios[s.scenario].partners.markup)) / 10_000);

/**
 * Строка заказа по договору (Б3г): до остатка обещанного — по цене договора, сверх и вне договора — по прайсу;
 * купленное по договору растёт на всё количество. Возвращает стоимость без НДС; строка помнит договор и сколько по
 * прайсу.
 */
export function priceLine(db: ContentDb, s: PlantState, supplier: Id, l: PoLine): number {
  const price = db.suppliers[supplier].items[l.material].price;
  const c = contractOf(s, supplier, momentOf(s.start, s.t).day);
  const cl = c?.lines.find(x => x.material === l.material && x.maker === l.maker);
  const by = cl ? Math.min(l.qty, Math.max(0, cl.volume - cl.bought)) : 0;
  if (cl) {
    cl.bought += l.qty;
    l.contract = c!.id;
  }
  if (by < l.qty) l.list = l.qty - by;
  return costOf(db, l.material, cl?.price ?? price, by) + costOf(db, l.material, listPrice(db, s, price), l.qty - by);
}

/**
 * Каждый час (Б3г): в полночь — у кого кончилось одобрение, извещение; кончились договоры — расчёт и новые; в 09:00
 * рабочего дня — коллега качества назначает оценки.
 */
export function partnersHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  const now = momentOf(s.start, s.t);
  if (now.sec === 0) {
    suspended(s, now.day, notices);
    contractsDay(db, s, now.day);
  }
  if (now.sec === BOOK_HOUR && isWorkday(calOf(db, s), now.day)) book(db, s, now.day);
}

/** Полночь: у пары с этого дня нет действующего одобрения — извещение (автопауза в окне): по ней не заказывают. */
function suspended(s: PlantState, day: number, notices: Notice[]) {
  for (const p of Object.values(s.pairs)) if (pairValid(p, day - 1) && !pairValid(p, day)) notices.push({ kind: 'pairSuspended', pair: p.id, supplier: p.supplier, maker: p.maker });
}

/**
 * Коллега качества (Б3г): у пары из действующей спецификации, у которой есть одобрение и оно кончится в срок
 * предупреждения (или уже кончилось), а оценка не назначена, — оценка. Аудит: аудитор у изготовителя с 09:00 ближайшего
 * рабочего дня на `days` рабочих дней, отчёт — в 17:00 последнего; по документам — сразу задача специалисту ООК.
 */
function book(db: ContentDb, s: PlantState, today: number) {
  const sc = db.scenarios[s.scenario];
  const live = new Set<string>();
  for (const m of Object.values(db.materials)) if (STARTING.has(m.kind)) for (const x of specPairs(db, m.id, today)) live.add(pairKey(x.supplier, x.maker));
  const base = (day: number) => (day - daysFromCivil(s.start)) * DAY;
  for (const p of Object.values(s.pairs)) {
    const last = p.recs[p.recs.length - 1];
    if (p.eval || !last || !live.has(p.id) || last.until - today > sc.partners.ahead) continue;
    const how = howOf(db, p.supplier, p.maker);
    // журнал решений (Б5а): начальник ООК — до какого дня одобрение и срок предупреждения
    note(s, 'qa', { kind: 'pairEval', pair: p.id, how, why: { until: last.until, ahead: sc.partners.ahead } });
    if (how === 'audit') {
      const cal = calOf(db, s);
      const from = base(addWorkdays(cal, today, 1)) + AUDIT_FROM;
      const to = base(addWorkdays(cal, today, sc.partners.audit.days)) + AUDIT_TO;
      p.eval = { how, booked: s.t, from, to, v: 1 };
      schedule(s.agenda, to, { kind: 'audit', pair: p.id, v: 1 });
    } else {
      p.eval = { how, booked: s.t, v: 0 };
      p.eval.task = review(db, s, p.id, sc.partners.docs.review);
    }
  }
}

/** Задача специалисту ООК — рассмотреть отчёт или документы пары — у его поста. */
function review(db: ContentDb, s: PlantState, pair: string, work: number): string {
  const plan = planOf(db, s.plant);
  const at = plan.posts[REVIEWERS[0]] ?? plan.entrance;
  return addTask(s, { kind: 'vendorReview', roles: [...REVIEWERS], from: { kind: 'point', x: at.x, z: at.z }, work, prio: REVIEW_PRIO, pair }).id;
}

/**
 * Аудитор кончил и прислал отчёт (событие `audit`): счёт аудитора с НДС — сегодня, НДС — к вычету; отчёт рассматривает
 * специалист ООК — задача; у пары от дистрибьютора — ещё и его документы.
 */
export function auditDone(db: ContentDb, s: PlantState, key: string, v: number) {
  const p = s.pairs[key];
  const e = p?.eval;
  if (!e || e.how !== 'audit' || e.v !== v || e.task !== undefined) return;
  const sc = db.scenarios[s.scenario];
  const price = sc.partners.audit.price;
  const vat = part(price, db.profiles[sc.profile].vat.general);
  post(s, -(price + vat), 'audit', p.id);
  s.cash.vat.in += vat;
  const distributor = db.suppliers[p.supplier]?.maker !== p.maker;
  e.task = review(db, s, p.id, sc.partners.audit.review + (distributor ? sc.partners.docs.review : 0));
}

/** Рассмотрение кончилось: запись — с днём рассмотрения, срок — через интервал пары; оценки больше нет. Не она — `false`. */
export function partnersDone(db: ContentDb, s: PlantState, t: Task): boolean {
  if (t.kind !== 'vendorReview') return false;
  const p = t.pair ? s.pairs[t.pair] : undefined;
  const e = p?.eval;
  if (!p || !e) return true;
  const day = momentOf(s.start, s.t).day;
  p.recs.push({ day, until: addMonths(day, everyOf(db, db.scenarios[s.scenario], p.supplier, p.maker)) - 1, how: e.how, by: t.people[0] });
  delete p.eval;
  return true;
}

/**
 * Сколько обещано и куплено по паре договора — стоимостью по цене договора: строки материалов пары складываются (Б3г).
 */
export function pairDeal(db: ContentDb, c: Contract, maker: Id): { volume: number; bought: number } {
  let volume = 0;
  let bought = 0;
  for (const l of c.lines) {
    if (l.maker !== maker) continue;
    volume += costOf(db, l.material, l.price, l.volume);
    bought += costOf(db, l.material, l.price, l.bought);
  }
  return { volume, bought };
}

/**
 * Полночь (Б3г): у договора, чей последний день прошёл, — расчёт. Рамочный: у пары, по которой купили меньше обещанной
 * доли (стоимостью по цене договора), поставщик выставляет разницу между прайсом и ценой договора за всё купленное по
 * ней — статья «Расчёт по договору», с НДС; договор закрыт, коллега снабжения заключает новый на следующий срок — объём
 * по плану, цена — записи поставщика; так же — с поставщиком, у которого договора нет, а одобренная пара есть. Поставки:
 * коллега коммерции продлевает его на срок с теми же условиями.
 */
function contractsDay(db: ContentDb, s: PlantState, day: number) {
  const sc = db.scenarios[s.scenario];
  let use: Map<Id, number> | undefined;
  for (const c of Object.values(s.contracts)) {
    if (c.closed || c.to >= day) continue;
    if (c.kind === 'supply') {
      const end = c.to;
      c.to = termOf(sc, c.to + 1);
      // журнал решений (Б5а): начальник отдела продаж продлил договор поставки
      note(s, 'sales', { kind: 'extend', contract: c.id, party: c.party, to: c.to, why: { end } });
      continue;
    }
    for (const maker of new Set(c.lines.map(l => l.maker))) {
      const deal = pairDeal(db, c, maker);
      if (deal.bought * 10_000 >= sc.partners.share * deal.volume) continue;
      let net = 0;
      let vat = 0;
      for (const l of c.lines) {
        if (l.maker !== maker) continue;
        const d = costOf(db, l.material, listPrice(db, s, l.price) - l.price, l.bought);
        net += d;
        vat += part(d, vatRate(db, s, l.material));
      }
      if (net <= 0) continue;
      post(s, -(net + vat), 'contract', c.id);
      s.cash.vat.in += vat;
    }
    c.closed = true;
  }
  // без действующего рамочного договора, но с одобренной парой — новый: у кончившегося договора и у пары, которую снова
  // одобрили после приостановки
  for (const id of Object.keys(db.suppliers).sort()) {
    if (contractOf(s, id, day) || !Object.entries(db.suppliers[id].items).some(([m, it]) => approved(db, s, id, it.maker, m, day))) continue;
    use ??= useFor(db, s, day);
    const prev = Object.values(s.contracts).filter(x => x.party === id && x.kind === 'frame' && x.closed).pop();
    const c = frameContract(db, s, id, day, use);
    // журнал решений (Б5а): начальник отдела снабжения — новый рамочный договор вместо кончившегося
    if (c) note(s, 'supply', { kind: 'contract', contract: c.id, party: id, to: c.to, why: prev ? { prev: prev.id, end: prev.to } : {} });
  }
}
