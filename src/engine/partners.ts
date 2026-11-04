// Контрагенты и договоры (Б3г; docs/specs/2026-10-vertical-slice.md, «Б3г»): изготовитель — своей записью, поставщик —
// сам изготовитель или дистрибьютор. Одобренные пары «поставщик — изготовитель» — в спецификации материала (GMP ЕАЭС,
// ч. I, п. 4.14); у пары — одобрение со сроком: у АФС и вспомогательных веществ — аудит изготовителя (у АФС от
// дистрибьютора — ещё и проверка дистрибьютора по документам), у упаковки — оценка по документам (п. 5.29). Пара
// одобрена, только пока у её поставщика действует соглашение по качеству (п. 5.28). Аудит ведёт сторонний аудитор по
// договору (п. 5.29; гл. 7): его назначает коллега качества за срок предупреждения, отчёт рассматривает специалист ООК,
// запись — с днём рассмотрения. Срок вышел — пара приостановлена: по ней не заказывают. Рамочный договор с поставщиком
// (ГК РФ, ст. 429.1) — на год: цена и обещанный объём по паре; сверх обещанного — по прайсу; недобор обещанной доли —
// счёт за разницу. У покупателя — договор поставки (ст. 506). Одобрения и договоры — знание завода, а не истина.
// С Б6ж у АФС — пара-кандидат: второй изготовитель, которого нет в досье. «Одобрить пару» — оценка документов, пробная
// партия, аудит и изменение досье типа II (reg-eaeu, прил. 19, Б.I.а.1): с положительным решением пара в спецификации
// (п. 4.2.1). Рамочный договор — только по парам спецификации из базы: второй источник — по прайсу. Кому заказывать при
// двух поставщиках — политика начальника отдела снабжения; предложения — цена, срок, доля поставок вовремя и предоплата.
import type { ContentDb, Id, MaterialKind, Scenario, SpecPair } from '../content/types';
import { dueRule, type Who } from './bosses';
import { part, post, vatRate } from './cash';
import { schedule } from './core/agenda';
import { addMonths, addWorkdays, DAY, daysFromCivil, HOUR, isWorkday, momentOf, workdayOnOrAfter } from './core/calendar';
import { fnv1a } from './core/hash';
import { type DocKind, inForce, revisions } from './docs';
import { note, noteCmd } from './journal';
import { planOf } from './plant';
import { numOf, POL, policyOf } from './policies';
import { QA } from './qa';
import { roll } from './random';
import { setLotStatus, stockChanged } from './stock';
import { placePo, planUse } from './supply';
import { addTask } from './tasks';
import type { Command, Contract, ContractLine, Lot, Notice, Pair, PairStep, PlantState, PoLine, PoPick, Task } from './types';
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

/** Пары-кандидаты спецификации материала, действующей в день `day` (Б6ж). */
export function candidatePairs(db: ContentDb, material: Id, day: number): SpecPair[] {
  const m = db.materials[material];
  return m ? (db.specs[inForce(db, 'specs', m.spec, day)]?.candidates ?? []) : [];
}

/**
 * Пары спецификации в день `day` с Б6ж: пары из базы и кандидаты, которых одобрили изменением досье, — с дня решения;
 * по порядку спецификации: основной — первый.
 */
export function livePairs(db: ContentDb, s: Pick<PlantState, 'pairs'>, material: Id, day: number): { supplier: Id; maker: Id }[] {
  const base = specPairs(db, material, day);
  const more = candidatePairs(db, material, day).filter(x => {
    const p = s.pairs[pairKey(x.supplier, x.maker)];
    return p?.spec !== undefined && p.spec <= day;
  });
  return more.length > 0 ? [...base, ...more] : base;
}

/** Действует ли одобрение пары в день `day`: последняя запись не позже и срок не вышел. */
export function pairValid(p: Pair | undefined, day: number): boolean {
  const r = p?.recs[p.recs.length - 1];
  return !!r && r.day <= day && day <= r.until;
}

/**
 * Одобрена ли пара для материала в день `day`: она в действующей спецификации — с Б6ж и кандидатом после решения по
 * досье, — одобрение в сроке, соглашение действует.
 */
export function approved(db: ContentDb, s: PlantState, supplier: Id, maker: Id, material: Id, day: number): boolean {
  return livePairs(db, s, material, day).some(x => x.supplier === supplier && x.maker === maker) && pairValid(s.pairs[pairKey(supplier, maker)], day) && !!agreementFor(db, supplier, maker, material, day);
}

/**
 * Одобренные пары материала на день `day` — по порядку спецификации (с Б6ж; основной — первый, кандидаты после решения по
 * досье — за парами базы); у пар одной спецификации базы — по поставщику, затем по изготовителю, как до Б6ж.
 */
export function pairsFor(db: ContentDb, s: PlantState, material: Id, day: number): { supplier: Id; maker: Id }[] {
  const base = specPairs(db, material, day)
    .filter(x => approved(db, s, x.supplier, x.maker, material, day))
    .sort((a, b) => (a.supplier < b.supplier ? -1 : a.supplier > b.supplier ? 1 : a.maker < b.maker ? -1 : 1));
  const more = livePairs(db, s, material, day)
    .slice(specPairs(db, material, day).length)
    .filter(x => approved(db, s, x.supplier, x.maker, material, day));
  return more.length > 0 ? [...base, ...more] : base;
}

/** Пара из спецификации базы (Б6ж): по ней — рамочный договор; кандидат после решения по досье — по прайсу. */
const framePair = (db: ContentDb, supplier: Id, maker: Id, material: Id, day: number) => specPairs(db, material, day).some(x => x.supplier === supplier && x.maker === maker);

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
      // пара-кандидат (Б6ж): запись пары — без записей одобрения, пока её не одобрят
      for (const x of db.specs[rev].candidates ?? []) {
        const key = pairKey(x.supplier, x.maker);
        if (!first.has(key)) first.set(key, Number.POSITIVE_INFINITY);
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
    .filter(([m, it]) => approved(db, s, supplier, it.maker, m, from) && framePair(db, supplier, it.maker, m, from))
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
  const q = linePrice(db, s, supplier, l);
  if (q.line) {
    q.line.bought += l.qty;
    l.contract = q.contract;
  }
  if (q.by < l.qty) l.list = l.qty - q.by;
  return q.cost;
}

/**
 * Цена строки без записи (Б5б; окно «Заказ поставщику» и предложение снабжения): по договору — до остатка обещанного за
 * вычетом `taken`, уже взятого строками того же заказа, сверх и вне договора — по прайсу. Стоимость без НДС, сколько по
 * договору, договор и его строка.
 */
export function linePrice(db: ContentDb, s: PlantState, supplier: Id, l: PoLine, taken = 0): { cost: number; by: number; contract?: string; line?: ContractLine } {
  const price = db.suppliers[supplier].items[l.material].price;
  const c = contractOf(s, supplier, momentOf(s.start, s.t).day);
  const cl = c?.lines.find(x => x.material === l.material && x.maker === l.maker);
  const by = cl ? Math.min(l.qty, Math.max(0, cl.volume - cl.bought - taken)) : 0;
  const cost = costOf(db, l.material, cl?.price ?? price, by) + costOf(db, l.material, listPrice(db, s, price), l.qty - by);
  return { cost, by, ...(cl ? { contract: c!.id, line: cl } : {}) };
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
    // изменение досье пары-кандидата (Б6ж): запрос, ответ, решение
    dossierDay(db, s, now.day, notices);
  }
  // руководитель — человек (Б5в): с 09:00 рабочего дня, в первый час, когда есть кому решить
  const who = dueRule(db, s, 'pairEval', 'qa', BOOK_HOUR, notices);
  if (who) book(db, s, now.day, who);
}

/** Полночь: у пары с этого дня нет действующего одобрения — извещение (автопауза в окне): по ней не заказывают. */
function suspended(s: PlantState, day: number, notices: Notice[]) {
  for (const p of Object.values(s.pairs)) if (pairValid(p, day - 1) && !pairValid(p, day)) notices.push({ kind: 'pairSuspended', pair: p.id, supplier: p.supplier, maker: p.maker });
}

/**
 * Коллега качества (Б3г): у пары из действующей спецификации, у которой есть одобрение и оно кончится в срок
 * предупреждения (или уже кончилось), а оценка не назначена, — оценка. Срок предупреждения — политика начальника ООК
 * (Б5е); с чего начинает завод — запись сценария.
 */
function book(db: ContentDb, s: PlantState, today: number, who: Who) {
  const ahead = numOf(db, s, POL.pairAhead)!;
  const live = new Set<string>();
  for (const m of Object.values(db.materials)) if (STARTING.has(m.kind)) for (const x of livePairs(db, s, m.id, today)) live.add(pairKey(x.supplier, x.maker));
  for (const p of Object.values(s.pairs)) {
    const last = p.recs[p.recs.length - 1];
    if (p.eval || !last || !live.has(p.id) || last.until - today > ahead) continue;
    // журнал решений (Б5а): начальник ООК — до какого дня одобрение и срок предупреждения по его политике (Б5е)
    note(s, 'qa', { kind: 'pairEval', pair: p.id, how: howOf(db, p.supplier, p.maker), why: { until: last.until, ahead } }, undefined, undefined, who);
    bookEval(db, s, p, today);
  }
}

/**
 * Назначить оценку пары (Б3г; с Б5е — и по CAPA): аудит — аудитор у изготовителя с 09:00 ближайшего рабочего дня на
 * `days` рабочих дней, отчёт — в 17:00 последнего; по документам — сразу задача специалисту ООК. Как оценивают — по роду
 * материалов пары.
 */
export function bookEval(db: ContentDb, s: PlantState, p: Pair, today: number) {
  const sc = db.scenarios[s.scenario];
  const how = howOf(db, p.supplier, p.maker);
  const base = (day: number) => (day - daysFromCivil(s.start)) * DAY;
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
export function partnersDone(db: ContentDb, s: PlantState, t: Task, notices: Notice[] = []): boolean {
  if (t.kind !== 'vendorReview') return false;
  const p = t.pair ? s.pairs[t.pair] : undefined;
  // одобрение пары-кандидата (Б6ж): документы рассмотрены — пробная партия
  if (p?.app?.step === 'docs' && p.app.task === t.id) {
    delete p.app.task;
    orderTrial(db, s, p, notices);
    return true;
  }
  const e = p?.eval;
  if (!p || !e) return true;
  const day = momentOf(s.start, s.t).day;
  p.recs.push({ day, until: addMonths(day, everyOf(db, db.scenarios[s.scenario], p.supplier, p.maker)) - 1, how: e.how, by: t.people[0] });
  delete p.eval;
  // одобрение пары-кандидата (Б6ж): отчёт аудитора рассмотрен — изменение досье подано
  if (p.app?.step === 'audit') fileDossier(db, s, p, day, notices);
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
    if (contractOf(s, id, day) || !Object.entries(db.suppliers[id].items).some(([m, it]) => approved(db, s, id, it.maker, m, day) && framePair(db, id, it.maker, m, day))) continue;
    use ??= useFor(db, s, day);
    const prev = Object.values(s.contracts).filter(x => x.party === id && x.kind === 'frame' && x.closed).pop();
    const c = frameContract(db, s, id, day, use);
    // журнал решений (Б5а): начальник отдела снабжения — новый рамочный договор вместо кончившегося
    if (c) note(s, 'supply', { kind: 'contract', contract: c.id, party: id, to: c.to, why: prev ? { prev: prev.id, end: prev.to } : {} });
  }
}

// ---------------------------------------------------------------- второй источник (Б6ж)

/**
 * Доля заказов пары вовремя к обещанному за 12 месяцев по день `day` (Б6ж; `scor-ds-web` RL.2.6): пришедшие заказы
 * поставщика со строкой этого изготовителя, у которых день прихода не позже обещанного, к пришедшим. Записи завода.
 */
export function onTimeOf(s: PlantState, supplier: Id, maker: Id, day: number): { n: number; ok: number } {
  let n = 0;
  let ok = 0;
  for (const po of Object.values(s.pos)) {
    if (po.supplier !== supplier || po.came === undefined || !po.lines.some(l => l.maker === maker)) continue;
    const d = momentOf(s.start, po.came).day;
    if (d <= day - 365 || d > day) continue;
    n++;
    if (d <= momentOf(s.start, po.eta).day) ok++;
  }
  return { n, ok };
}

/** Доля вовремя, доли 1/10 000: по записям пары; у пары без пришедших заказов — по всем заказам завода, нет и их — 10 000. */
export function onTimeShare(s: PlantState, supplier: Id, maker: Id, day: number): { share: number; n: number; all: number } {
  const own = onTimeOf(s, supplier, maker, day);
  if (own.n > 0) return { share: Math.floor((own.ok * 10_000) / own.n), n: own.n, all: 0 };
  let n = 0;
  let ok = 0;
  for (const po of Object.values(s.pos)) {
    if (po.came === undefined) continue;
    const d = momentOf(s.start, po.came).day;
    if (d <= day - 365 || d > day) continue;
    n++;
    if (d <= momentOf(s.start, po.eta).day) ok++;
  }
  return { share: n > 0 ? Math.floor((ok * 10_000) / n) : 10_000, n: 0, all: n };
}

/**
 * Предложение поставщика (Б6ж; `scor-ds-web` BP.132, BP.134; `sap-mm`): стоимость количества без НДС — по договору до
 * остатка обещанного, сверх и вне договора — по прайсу; не позже какого дня придёт заказ сегодня — верх срока поставки до
 * рабочего дня; доля поставок вовремя по записям завода; предоплата и отсрочка; балл по весам — в сотых долях, от 0 до
 * 10 000: цена и срок — к лучшему из предложений, надёжность — доля вовремя, условия — доля без предоплаты.
 */
export interface Offer {
  supplier: Id;
  maker: Id;
  cost: number;
  by: number;
  lead: [number, number];
  onTime: number;
  /** пришедших заказов пары за 12 месяцев; нет их — `all`: пришедших заказов завода, по которым доля */
  n: number;
  all: number;
  prepay: number;
  payDays: number;
  score: number;
}

/** Веса оценки предложений: запись сценария; нет — поровну. */
const weightsOf = (db: ContentDb, s: PlantState) => db.scenarios[s.scenario].supply?.rfq ?? { price: 25, lead: 25, rel: 25, terms: 25 };

/**
 * Предложения одобренных поставщиков материала на количество `qty` сейчас (Б6ж): сразу, по записям поставщиков и завода
 * — торга и ожидания ответов нет; по порядку спецификации.
 */
export function offersFor(db: ContentDb, s: PlantState, material: Id, qty: number, day = momentOf(s.start, s.t).day): Offer[] {
  const cal = calOf(db, s);
  const raw = pairsFor(db, s, material, day).map(pr => {
    const sup = db.suppliers[pr.supplier];
    const moq = sup.items[material]?.moq ?? 0;
    const cost = linePrice(db, s, pr.supplier, { material, qty: Math.max(qty, moq), maker: pr.maker }).cost;
    const t = onTimeShare(s, pr.supplier, pr.maker, day);
    return { supplier: pr.supplier, maker: pr.maker, cost, by: workdayOnOrAfter(cal, day + sup.lead[1]), lead: sup.lead, onTime: t.share, n: t.n, all: t.all, prepay: sup.prepay, payDays: sup.payDays, score: 0 };
  });
  if (raw.length === 0) return raw;
  const w = weightsOf(db, s);
  const minCost = Math.min(...raw.map(o => o.cost));
  const minLead = Math.min(...raw.map(o => o.lead[1]));
  for (const o of raw) {
    const price = o.cost > 0 ? Math.round((w.price * 100 * minCost) / o.cost) : w.price * 100;
    const lead = Math.round((w.lead * 100 * minLead) / o.lead[1]);
    const rel = Math.round((w.rel * o.onTime) / 100);
    const terms = Math.round((w.terms * (10_000 - o.prepay)) / 100);
    o.score = price + lead + rel + terms;
  }
  return raw;
}

/** Кому заказывать при двух поставщиках — политика начальника отдела снабжения (Б6ж); без политики — основному. */
export const whoOf = (db: ContentDb, s: PlantState) => {
  const v = policyOf(db, s, POL.who);
  return v === 'fast' || v === 'rfq' ? v : 'main';
};

/**
 * Пара под заказ материала (Б6ж): одна одобренная — она; две и больше — по политике «кому заказывать»: основному —
 * первой в спецификации; быстрее, когда основной опоздает, — `lateBy` суток у основного больше нуля: тому, у кого
 * меньше, при равенстве — раньше в спецификации; по оценке предложений — с наибольшим баллом. Почему не основной — `pick`.
 * Одобренных нет — `undefined`.
 */
export function choosePair(db: ContentDb, s: PlantState, material: Id, day: number, lateBy: (supplier: Id) => number, qty = 0): { pair: { supplier: Id; maker: Id }; pick?: PoPick } | undefined {
  const cands = pairsFor(db, s, material, day);
  const main = cands[0];
  if (!main) return undefined;
  if (cands.length === 1) return { pair: main };
  const who = whoOf(db, s);
  if (who === 'fast') {
    const late = lateBy(main.supplier);
    if (late <= 0) return { pair: main };
    let best = main;
    let bestLate = late;
    for (const c of cands.slice(1)) {
      const l = lateBy(c.supplier);
      if (l < bestLate) {
        best = c;
        bestLate = l;
      }
    }
    return best === main ? { pair: main } : { pair: best, pick: { by: 'fast', main: main.supplier, late } };
  }
  if (who === 'rfq') {
    const offers = offersFor(db, s, material, qty, day);
    let best = offers[0];
    for (const o of offers) if (o.score > best.score) best = o;
    const pair = cands.find(c => c.supplier === best.supplier && c.maker === best.maker) ?? main;
    return { pair, pick: { by: 'rfq', offers: offers.map(o => ({ supplier: o.supplier, score: o.score })) } };
  }
  return { pair: main };
}

/** Материал, у которого пара — кандидат спецификации в силе в день `day` (Б6ж); нет — `undefined`. */
export function candidateOf(db: ContentDb, supplier: Id, maker: Id, day: number): Id | undefined {
  for (const m of Object.values(db.materials)) {
    if (!STARTING.has(m.kind)) continue;
    if (candidatePairs(db, m.id, day).some(x => x.supplier === supplier && x.maker === maker)) return m.id;
  }
  return undefined;
}

/**
 * Команда «Одобрить пару» (Б6ж): пара-кандидат спецификации в силе; одобрение не идёт и пара ещё не в спецификации;
 * соглашение по качеству в силе; у сценария — сроки изменения досье. Шаг первый — оценка документов специалистом ООК.
 */
export function pairApproveCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'pairApprove' }>, notices: Notice[]) {
  const p = s.pairs[cmd.pair];
  const today = momentOf(s.start, s.t).day;
  const material = p ? candidateOf(db, p.supplier, p.maker, today) : undefined;
  const sc = db.scenarios[s.scenario];
  const refuse = (why: 'notCandidate' | 'pairBusy' | 'noAgreement') => notices.push({ kind: 'refused', cmd: 'pairApprove', why, detail: cmd.pair });
  if (!p || !material || !sc.partners.variation) return refuse('notCandidate');
  if (p.spec !== undefined || (p.app && p.app.step !== 'failed')) return refuse('pairBusy');
  if (!agreementFor(db, p.supplier, p.maker, material, today)) return refuse('noAgreement');
  p.app = { t: s.t, material, step: 'docs' };
  p.app.task = review(db, s, p.id, sc.partners.docs.review);
  notices.push({ kind: 'pairStep', pair: p.id, step: 'docs', material });
  noteCmd(s, cmd, { kind: 'pairApprove', pair: p.id, material });
}

/** Шаг одобрения — запись начальника ООК и извещение. */
function stepped(s: PlantState, p: Pair, step: PairStep | 'ask' | 'answer', notices: Notice[], extra: { po?: string; lot?: string; day?: number } = {}) {
  note(s, 'qa', { kind: 'pairStep', pair: p.id, step, ...extra });
  notices.push({ kind: 'pairStep', pair: p.id, step, material: p.app!.material });
}

/**
 * Пробная партия (Б6ж): наименьшая партия поставщика по паре-кандидату — заказ поставщику, с предоплатой и сроком, как
 * у всякого; её партия пройдёт полный входной контроль. Заказ не прошёл — одобрение кончилось.
 */
function orderTrial(db: ContentDb, s: PlantState, p: Pair, notices: Notice[]) {
  const app = p.app!;
  const moq = db.suppliers[p.supplier].items[app.material]?.moq ?? 0;
  app.step = 'trial';
  const po = placePo(db, s, { kind: 'po', supplier: p.supplier, lines: [{ material: app.material, qty: moq, maker: p.maker }], by: 'head:qa' }, notices, undefined, p.id);
  if (!po) {
    app.step = 'failed';
    stepped(s, p, 'failed', notices);
    return;
  }
  app.po = po.id;
  notices.push({ kind: 'pairStep', pair: p.id, step: 'trial', material: app.material });
}

/**
 * Решение ОКК по партии (Б6ж): у пробной партии одобрения — разрешена: заблокирована до решения по досье — в производство
 * её не берут (`reg-eaeu`, п. 4.2.1), — и аудит изготовителя; отклонена — одобрение кончилось.
 */
export function trialDecided(db: ContentDb, s: PlantState, lot: Lot, ok: boolean, notices: Notice[]) {
  const po = lot.po ? s.pos[lot.po] : undefined;
  const p = po?.trial ? s.pairs[po.trial] : undefined;
  if (!p?.app || p.app.step !== 'trial' || p.app.po !== po!.id) return;
  p.app.lot = lot.id;
  if (!ok) {
    p.app.step = 'failed';
    stepped(s, p, 'failed', notices, { lot: lot.id });
    return;
  }
  setLotStatus(s, lot, 'blocked');
  stockChanged(s);
  p.app.step = 'audit';
  bookEval(db, s, p, momentOf(s.start, s.t).day);
  stepped(s, p, 'audit', notices, { lot: lot.id });
}

/**
 * Изменение досье типа II подано (Б6ж; `reg-eaeu`, прил. 19, разд. III): с дня рассмотрения отчёта аудитора — проверка
 * полноты и экспертиза, запрос эксперта по доле сценария к концу экспертизы, ответ — через столько рабочих дней от и до,
 * решение — в его срок. Дни наперёд знает только движок; завод узнаёт каждый, когда он настанет.
 */
function fileDossier(db: ContentDb, s: PlantState, p: Pair, day: number, notices: Notice[]) {
  const app = p.app!;
  app.step = 'dossier';
  app.filed = day;
  app.truth = dossierDays(db, s, p.id, day);
  stepped(s, p, 'dossier', notices, { day });
}

/** Дни запроса, ответа и решения изменения досье, поданного в день `filed`, — по ветви `dossier/<пара>`. */
export function dossierDays(db: ContentDb, s: PlantState, key: string, filed: number, from?: { asked?: number; answered?: number; today: number }): NonNullable<Pair['app']>['truth'] {
  const v = db.scenarios[s.scenario].partners.variation!;
  const cal = calOf(db, s);
  return roll(s, `dossier/${key}`, r => {
    const end = addWorkdays(cal, filed, v.check + v.expert);
    if (from?.answered !== undefined) return { ask: from.asked, answer: from.answered, decide: addWorkdays(cal, from.answered, v.decide) };
    const asked = from?.asked !== undefined || (r.int(10_000) < v.ask && end > (from?.today ?? 0));
    if (!asked) return { decide: Math.max(addWorkdays(cal, end, v.decide), from ? from.today + 1 : 0) };
    const ask = from?.asked ?? end;
    const answer = Math.max(addWorkdays(cal, ask, r.range(v.answer[0], v.answer[1])), from ? from.today + 1 : 0);
    return { ask, answer, decide: addWorkdays(cal, answer, v.decide) };
  });
}

/**
 * Полночь (Б6ж): изменение досье — настал день запроса эксперта, ответа или решения; решение положительное — пара в
 * спецификации с этого дня, пробная партия разрешена.
 */
function dossierDay(db: ContentDb, s: PlantState, day: number, notices: Notice[]) {
  for (const p of Object.values(s.pairs)) {
    const app = p.app;
    if (app?.step !== 'dossier' || !app.truth) continue;
    if (app.truth.ask === day && app.asked === undefined) {
      app.asked = day;
      stepped(s, p, 'ask', notices, { day });
    }
    if (app.truth.answer === day && app.answered === undefined) {
      app.answered = day;
      stepped(s, p, 'answer', notices, { day });
    }
    if (app.truth.decide !== day) continue;
    app.decided = day;
    app.step = 'done';
    delete app.truth;
    p.spec = day;
    const lot = app.lot ? s.lots[app.lot] : undefined;
    if (lot?.status === 'blocked') {
      setLotStatus(s, lot, 'released');
      stockChanged(s);
    }
    stepped(s, p, 'done', notices, { day });
  }
}
