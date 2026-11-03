// Совещание S&OP (Б6г; docs/specs/2026-10-vertical-slice.md, «Б6г»; геймдизайн, §9.2): чистые функции без записи —
// маржа пачки, нагрузка серии на ключевые ресурсы по нормам, мощность ресурсов по месяцам, прогон плана вперёд и лучший
// план. План — цель запаса по продукту и месяцу в сутках спроса: столько «запаса позиций» держит правило задания. Прогон
// — то же правило начальника отдела планирования день за днём на прогнозе планирования (Б6в): спрос — за календарный
// день месяца, серии — по рабочим дням через две рабочие недели, выпуск — через срок серий завода. Счёт — в целых:
// тысячные ящика, копейки, секунды.
import type { ContentDb, Id } from '../../content/types';
import { addWorkdays, DAY, daysFromCivil, isWorkday, momentOf, workdaysIn } from '../core/calendar';
import { coverBy, skillOf, whoDecides } from '../bosses';
import { inForce } from '../docs';
import { daysIn, firstDay, lagError, monthAt, monthOfDay, planCases, shares, ymOf } from '../forecast';
import { BATCH_HOUR, cleanWork, nominal } from '../mes';
import { contractOf, costOf, listPrice } from '../partners';
import { AHEAD, AHEAD_WORK, aheadMilli, casesOf, choose, idNum, positionOf, prevBefore } from '../planner';
import { numOf, POL, policyOf } from '../policies';
import { containersByLot } from '../stock';
import type { PlantState } from '../types';
import { calOf } from '../workdays';

/** Горизонт совещания (§9.2): спрос, мощности и запас — на 6 месяцев с нынешнего, касса — на 3. */
export const SOP_MONTHS = 6;
export const SOP_CASH = 3;

/** Цели плана — варианты политики «запас позиций» (Б5г), сутки: от 7 до 42 шагом 7. */
export const SOP_COVERS = [7, 14, 21, 28, 35, 42] as const;

/** Ключевые ресурсы грубой проверки мощности (RCCP): задания, ВЭЖХ, аналитики, линия, грануляция, таблетирование. */
export type SopRes = 'slot' | 'hplc' | 'analyst' | 'line' | 'granulation' | 'compression';
export const SOP_RES: readonly SopRes[] = ['slot', 'hplc', 'analyst', 'line', 'granulation', 'compression'];

/** Срок серии, если выпущенных нет: от первой стадии до выпуска, с. */
const LEAD_DEFAULT = 10 * DAY;

/** Ошибка прогноза, пока записей с запаздыванием нет, — 1/10 000 (10 %). */
const ERR_DEFAULT = 1000;

/** Варианты спроса прогона: прогноз минус ошибка, прогноз, прогноз плюс ошибка — множитель ошибки. */
export const SOP_CASES = [-1, 0, 1] as const;

/** Ставка цены денег в запасе: ключевая профиля и надбавка кредитной линии сценария, сотые доли процента в год. */
export function carryRate(db: ContentDb, s: PlantState): number {
  const sc = db.scenarios[s.scenario];
  return db.profiles[sc.profile].key + sc.credit.spread;
}

/** Маржинальный доход пачки позиции, копейки: цена минус материалы карты и упаковка по цене пары в силе и энергия серии. */
export interface PackMargin {
  price: number;
  /** материалы карты на пачку */
  bom: number;
  /** упаковка на пачку */
  pack: number;
  /** энергия серии на пачку */
  energy: number;
  margin: number;
}

/** Цена материала за кг или за штуку: по договору с поставщиком первой одобренной пары, если строка есть, иначе по прайсу. */
function priceOf(db: ContentDb, s: PlantState, material: Id): number {
  const day = momentOf(s.start, s.t).day;
  for (const sup of Object.values(db.suppliers)) {
    const it = sup.items[material];
    if (!it) continue;
    const cl = contractOf(s, sup.id, day)?.lines.find(x => x.material === material);
    return cl?.price ?? listPrice(db, s, it.price);
  }
  return 0;
}

/** Пачек с серии позиции. */
export const packsOf = (db: ContentDb, recipe: Id, sku: Id) => {
  const k = db.skus[sku];
  return Math.floor(db.recipes[recipe].batch.units / (k.perBlister * k.blisters));
};

/** Карта позиции в плане выпуска сценария. */
const recipeOf = (db: ContentDb, s: PlantState, sku: Id) => db.scenarios[s.scenario].plan!.items.find(i => i.sku === sku)!.recipe;

export function packMargin(db: ContentDb, s: PlantState, sku: Id): PackMargin {
  const k = db.skus[sku];
  const day = momentOf(s.start, s.t).day;
  const r = db.recipes[inForce(db, 'recipes', recipeOf(db, s, sku), day)];
  const packs = packsOf(db, r.id, sku);
  let bomBatch = 0;
  for (const l of r.bom) bomBatch += costOf(db, l.material, priceOf(db, s, l.material), l.qty);
  let pack = 0;
  for (const l of k.blister) pack += costOf(db, l.material, priceOf(db, s, l.material), l.qty * k.blisters);
  for (const l of k.carton) pack += costOf(db, l.material, priceOf(db, s, l.material), l.qty);
  pack += Math.floor(costOf(db, k.case.material, priceOf(db, s, k.case.material), 1) / k.case.per);
  // энергия серии: оборудование стадий по номиналу карты и линия по скорости позиции (мощность в базе — Вт), по цене
  // кВт·ч сценария
  let wh = 0;
  for (const st of r.stages) {
    const sec = nominal(db, r.id, st, r.batch.mass);
    for (const e of st.equipment) wh += Math.floor((db.equipment[e].kw * sec) / 3600);
  }
  const lineSec = lineRun(db, r.id, sku);
  for (const m of Object.values(db.machines)) wh += Math.floor((m.kw * lineSec) / 3600);
  const energyBatch = Math.floor((wh * db.scenarios[s.scenario].energy.price) / 1000);
  const bom = Math.floor(bomBatch / packs);
  const energy = Math.floor(energyBatch / packs);
  return { price: k.price, bom, pack, energy, margin: k.price - bom - pack - energy };
}

/** Работа блистерной машины на серию позиции по скорости инструкции, с. */
function lineRun(db: ContentDb, recipe: Id, sku: Id): number {
  const k = db.skus[sku];
  const blisters = Math.floor(db.recipes[recipe].batch.units / k.perBlister);
  return Math.ceil((blisters * 60) / k.speed.target);
}

/** Нагрузка серии продукта на ключевые ресурсы по нормам, с (задания — штуки). */
export type SopLoad = Record<SopRes, number>;

export function batchLoad(db: ContentDb, s: PlantState, product: Id): SopLoad {
  const day = momentOf(s.start, s.t).day;
  const items = db.scenarios[s.scenario].plan!.items.filter(i => db.skus[i.sku].product === product);
  const r = db.recipes[inForce(db, 'recipes', items[0].recipe, day)];
  const out: SopLoad = { slot: 1, hplc: 0, analyst: 0, line: 0, granulation: 0, compression: 0 };
  for (const st of r.stages) {
    const sec = nominal(db, r.id, st, r.batch.mass);
    if (st.room === 'granulation' || st.room === 'compression') out[st.room] += sec;
  }
  // уборка после серии — малая, в каждом из двух помещений
  out.granulation += cleanWork(db, s, 'granulation', false);
  out.compression += cleanWork(db, s, 'compression', false);
  // испытания балка и ГП по спецификациям в силе: ВЭЖХ — работа прибора, аналитики — подготовка и работа при приборе
  const fg = db.skus[items[0].sku].fg;
  for (const material of [r.bulk, fg]) {
    const spec = db.specs[inForce(db, 'specs', db.materials[material].spec, day)];
    for (const line of spec.tests) {
      const m = db.tests[line.test];
      if (m.inst === 'inst.hplc') out.hplc += m.run;
      out.analyst += m.prep + (m.unattended ? 0 : m.run);
    }
  }
  // линия: блистеры позиции по скорости инструкции и переналадка картонажной машины
  const changeover = Math.max(0, ...Object.values(db.machines).map(m => m.changeover ?? 0));
  out.line += lineRun(db, r.id, items[0].sku) + changeover;
  return out;
}

/** Часы смены, с: от начала до конца без перерыва. */
const shiftSec = (db: ContentDb, id: Id) => {
  const sh = db.shifts[id];
  return (sh.to - sh.from) * 3600 - sh.break;
};

/** Мощность ключевых ресурсов в месяц `n` (номер месяца прогноза), с (задания — штуки): по рабочим дням и сменам людей. */
export function capacityOf(db: ContentDb, s: PlantState, n: number): SopLoad {
  const { y, m } = ymOf(n);
  const work = workdaysIn(calOf(db, s), y, m);
  const people = Object.values(s.people).filter(p => !p.quit || p.quit.last >= firstDay(n));
  const ofRole = (role: Id) => people.filter(p => p.role === role);
  const sumSec = (role: Id) => ofRole(role).reduce((t, p) => t + shiftSec(db, p.shift), 0);
  // прибор запускают в смену аналитиков: его часы — длина их смены; помещения — смены аппаратчиков с первой по последнюю
  const span = (role: Id) => {
    const sh = ofRole(role).map(p => db.shifts[p.shift]);
    return sh.length === 0 ? 0 : (Math.max(...sh.map(x => x.to)) - Math.min(...sh.map(x => x.from))) * 3600;
  };
  return {
    slot: work,
    hplc: work * span('role.analyst'),
    analyst: work * sumSec('role.analyst'),
    line: work * span('role.line-operator'),
    granulation: work * span('role.operator'),
    compression: work * span('role.operator'),
  };
}

/** Срок серии продукта от первой стадии до выпуска: медиана выпущенных за 180 суток, с. */
export function leadOf(s: PlantState, product: Id): number {
  const xs = Object.values(s.batches)
    .filter(b => b.product === product && b.released !== undefined && b.records.length > 0 && b.released > s.t - 180 * DAY)
    .map(b => b.released! - b.records[0].start)
    .sort((a, b) => a - b);
  return xs.length === 0 ? LEAD_DEFAULT : xs[Math.floor(xs.length / 2)];
}

/** План S&OP: цель запаса по продукту и месяцу, сутки; месяц — номер прогноза, с которого план. */
export interface SopCover {
  from: number;
  cover: Record<Id, number[]>;
}

/** Месяц прогона: серии по продуктам (по «не раньше»), спрос и недопоставки, запас на конец, нагрузка и мощность. */
export interface SopMonth {
  m: number;
  batches: Record<Id, number>;
  /** спрос и не продано, ящики */
  demand: Record<Id, number>;
  short: Record<Id, number>;
  /** запас ГП позиции на конец месяца, ящики, и в десятых суток спроса следующего месяца */
  stock: Record<Id, number>;
  days: Record<Id, number>;
  load: SopLoad;
  cap: SopLoad;
}

export interface SopResult {
  months: SopMonth[];
  /** маржинальный доход продаж, цена денег в запасе и их разность — цель плана, копейки */
  margin: number;
  carry: number;
  value: number;
  /** не продано по прогнозу, ящики, и маржа их, копейки */
  short: number;
  lost: number;
  /** у трёх вариантов спроса (Б6г): средняя цель плана и не продано при спросе выше прогноза на его ошибку, ящики */
  mean: number;
  high: number;
}

/** Серия прогона: задание с «не раньше» и продукт — для кампаний правила. */
interface Run {
  id: string;
  notBefore: number;
  product: Id;
}

/**
 * Заготовка прогона (Б6г): то, что от целей плана не зависит, — один раз на совещание или вид: положение позиций и ГП,
 * серии в работе к их выпуску, сроки серий, нагрузка серии и мощность ресурсов по месяцам, маржа пачки, спрос
 * прогноза по дням с суммами для окна правила.
 */
export interface SopCtx {
  db: ContentDb;
  s: PlantState;
  from: number;
  items: { recipe: Id; sku: Id }[];
  products: Id[];
  /** первый день прогона и день за последним */
  z0: number;
  end: number;
  zero: number;
  window: number;
  urgent?: number;
  skill: number;
  policy: number;
  work: boolean[];
  /** рабочих дней до дня — сумма с z0 */
  workSum: number[];
  /** спрос позиции за день, тысячные ящика, и сумма с z0 */
  rate: Map<Id, number[]>;
  rateSum: Map<Id, number[]>;
  pos: Map<Id, number>;
  fg: Map<Id, number>;
  arrive: Map<number, { sku: Id; cases: number }[]>;
  lead: Map<Id, number>;
  runs: Run[];
  taken: Set<number>;
  lastId: Map<Id, number>;
  next: number;
  load: Map<Id, SopLoad>;
  cap: Map<number, SopLoad>;
  margin: Map<Id, PackMargin>;
  cases: Map<Id, number>;
  carry: number;
  /** ошибка прогноза планирования за 12 месяцев, WAPE, 1/10 000 */
  err: number;
  /** день, до которого считают продажи: месяц после горизонта — запас на его конец не пропадает даром */
  sell: number;
}

export function sopCtx(db: ContentDb, s: PlantState, from: number): SopCtx {
  const sc = db.scenarios[s.scenario];
  const items = sc.plan!.items;
  const cal = calOf(db, s);
  const window = numOf(db, s, POL.window)!;
  const now = momentOf(s.start, s.t);
  const z0 = now.day + 1;
  const end = firstDay(from + SOP_MONTHS);
  const sell = firstDay(from + SOP_MONTHS + 1);
  const products = [...new Set(items.map(i => db.skus[i.sku].product))];
  // дни прогона, месяц продаж после него и ещё окно правила — для спроса вперёд
  const span = sell - z0 + window + 1;
  const work: boolean[] = [];
  const workSum: number[] = [0];
  for (let k = 0; k < span; k++) {
    work.push(isWorkday(cal, z0 + k));
    workSum.push(workSum[k] + (work[k] ? 1 : 0));
  }
  const rate = new Map<Id, number[]>();
  const rateSum = new Map<Id, number[]>();
  for (const it of items) {
    const r: number[] = [];
    const sum: number[] = [0];
    for (let k = 0; k < span; k++) {
      const n = monthOfDay(z0 + k);
      r.push(Math.floor((planCases(s, it.sku, n) * 1000) / daysIn(n)));
      sum.push(sum[k] + r[k]);
    }
    rate.set(it.sku, r);
    rateSum.set(it.sku, sum);
  }
  const byLot = containersByLot(s);
  const pos = new Map<Id, number>();
  const fg = new Map<Id, number>();
  for (const it of items) {
    pos.set(it.sku, positionOf(db, s, it.sku, window, byLot).cases * 1000);
    const k = db.skus[it.sku];
    let n = 0;
    for (const l of Object.values(s.lots)) if (l.material === k.fg && l.status !== 'rejected' && l.status !== 'blocked') n += byLot.get(l.id)?.length ?? 0;
    for (const o of Object.values(s.orders)) if (o.status === 'open') for (const l of o.lines) if (l.sku === it.sku) n -= l.cases - l.shipped;
    fg.set(it.sku, n * 1000);
  }
  const lead = new Map(products.map(p => [p, leadOf(s, p)]));
  const arrive = new Map<number, { sku: Id; cases: number }[]>();
  const runs: Run[] = [];
  const lastId = new Map<Id, number>();
  let next = 0;
  for (const b of Object.values(s.batches)) {
    next = Math.max(next, idNum(b.id) + 1);
    if (b.sku) lastId.set(b.sku, Math.max(lastId.get(b.sku) ?? -1, idNum(b.id)));
    if (b.status === 'cancelled') continue;
    runs.push({ id: b.id, notBefore: b.notBefore, product: b.product });
    if (!b.sku || b.status === 'released' || b.status === 'rejected' || b.status === 'fg') continue;
    const k = db.skus[b.sku];
    const cases = b.status === 'packing' && b.pack?.fg ? Math.max(0, casesOf(db.recipes[b.recipe], k) - (byLot.get(b.pack.fg)?.length ?? 0)) : casesOf(db.recipes[b.recipe], k);
    const z = Math.max(z0, momentOf(s.start, (b.records[0]?.start ?? b.notBefore) + lead.get(b.product)!).day);
    const xs = arrive.get(z) ?? [];
    xs.push({ sku: b.sku, cases: cases * 1000 });
    arrive.set(z, xs);
  }
  const cap = new Map<number, SopLoad>();
  for (let n = from; n < from + SOP_MONTHS; n++) cap.set(n, capacityOf(db, s, n));
  return {
    db,
    s,
    from,
    items,
    products,
    z0,
    end,
    zero: daysFromCivil(s.start),
    window,
    urgent: numOf(db, s, POL.urgent),
    skill: skillOf(s, whoDecides(db, s, 'plan')),
    policy: numOf(db, s, POL.cover)!,
    work,
    workSum,
    rate,
    rateSum,
    pos,
    fg,
    arrive,
    lead,
    runs,
    taken: new Set(runs.map(b => momentOf(s.start, b.notBefore).day)),
    lastId,
    next,
    load: new Map(products.map(p => [p, batchLoad(db, s, p)])),
    cap,
    margin: new Map(items.map(it => [it.sku, packMargin(db, s, it.sku)])),
    cases: new Map(items.map(it => [it.sku, casesOf(db.recipes[it.recipe], db.skus[it.sku]) * 1000])),
    carry: carryRate(db, s),
    err: shares(lagError(s, 'plan', from - 12, from))?.wape ?? ERR_DEFAULT,
    sell,
  };
}

/** Месяц прогона: серии по продуктам (по «не раньше»), спрос и недопоставки, запас на конец, нагрузка и мощность. */
const blank = (): SopLoad => ({ slot: 0, hplc: 0, analyst: 0, line: 0, granulation: 0, compression: 0 });

/**
 * Прогон плана вперёд (Б6г): с завтра до конца месяца `from + 5`. Положение позиции для правила — как у правила (ГП и
 * серии в работе против открытых заказов); запас для продаж — ГП и серии в работе к их выпуску. Каждый рабочий день —
 * правило `choose` на день через две рабочие недели, запас позиций продукта — цель плана на месяц дня правила, с пределом
 * навыка руководителя; спрос — прогноз планирования за календарный день. Серии выходят через срок серий завода от первой
 * стадии или «не раньше».
 */
export function sopRun(ctx: SopCtx, plan: Record<Id, number[]>, k = 0): SopResult {
  const { db, s, from, items, end, z0 } = ctx;
  // вариант спроса: прогноз и его ошибка с множителем `k`
  const scale = 10000 + k * ctx.err;
  const pos = new Map(ctx.pos);
  const fg = new Map(ctx.fg);
  const arrive = new Map<number, { sku: Id; cases: number }[]>();
  for (const [z, xs] of ctx.arrive) arrive.set(z, [...xs]);
  const runs = [...ctx.runs];
  const taken = new Set(ctx.taken);
  const lastId = new Map(ctx.lastId);
  let next = ctx.next;
  const months: SopMonth[] = [];
  for (let n = from; n < from + SOP_MONTHS; n++) {
    const row: SopMonth = { m: n, batches: {}, demand: {}, short: {}, stock: {}, days: {}, load: blank(), cap: ctx.cap.get(n)! };
    for (const p of ctx.products) row.batches[p] = 0;
    for (const it of items) {
      row.demand[it.sku] = 0;
      row.short[it.sku] = 0;
      row.stock[it.sku] = 0;
    }
    months.push(row);
  }
  const rowOf = (n: number) => (n >= from && n < from + SOP_MONTHS ? months[n - from] : undefined);
  const coverAt = (product: Id, n: number) => coverBy(ctx.skill, plan[product]?.[Math.max(0, Math.min(SOP_MONTHS - 1, n - from))] ?? ctx.policy);
  let margin = 0;
  let carry = 0;
  let lost = 0;
  let short = 0;
  for (let z = z0; z < ctx.sell; z++) {
    const k = z - z0;
    const n = monthOfDay(z);
    const row = rowOf(n);
    for (const a of arrive.get(z) ?? []) fg.set(a.sku, fg.get(a.sku)! + a.cases);
    for (const it of items) {
      const d = Math.floor((ctx.rate.get(it.sku)![k] * scale) / 10000);
      const have = Math.max(0, fg.get(it.sku)!);
      const sold = Math.min(have, d);
      fg.set(it.sku, fg.get(it.sku)! - d);
      pos.set(it.sku, pos.get(it.sku)! - d);
      const per = db.skus[it.sku].case.per;
      const pm = ctx.margin.get(it.sku)!;
      margin += Math.floor((sold * per * pm.margin) / 1000);
      // месяц после горизонта — только продажи запаса на его конец: его недопоставки от плана не зависят
      if (d > sold && z < end) {
        lost += Math.floor(((d - sold) * per * pm.margin) / 1000);
        short += d - sold;
      }
      // цена денег в запасе: ГП на конец суток по материалам и упаковке, ставка — в сотых долях процента в год
      carry += Math.floor((Math.max(0, fg.get(it.sku)!) * per * (pm.bom + pm.pack) * ctx.carry) / (1000 * 365 * 10000));
      if (row) {
        row.demand[it.sku] += d;
        row.short[it.sku] += d - sold;
      }
    }
    if (row && monthOfDay(z + 1) !== n) for (const it of items) row.stock[it.sku] = Math.floor(Math.max(0, fg.get(it.sku)!) / 1000);
    if (!ctx.work[k]) continue;
    // день правила — через десять рабочих дней
    let q = k;
    let left = AHEAD_WORK;
    while (left > 0 && q + 1 < ctx.work.length) {
      q++;
      if (ctx.work[q]) left--;
    }
    const day = z0 + q;
    if (left > 0 || taken.has(day) || day >= end) continue;
    const at = (day - ctx.zero) * DAY + BATCH_HOUR;
    const w = Math.min(ctx.window, ctx.work.length - k);
    const cand = items.map(it => {
      const sum = ctx.rateSum.get(it.sku)!;
      return {
        it,
        p: {
          cases: Math.floor(pos.get(it.sku)! / 1000),
          ordered: Math.floor((sum[k + w] - sum[k]) / 1000),
          work: Math.max(1, ctx.workSum[k + w] - ctx.workSum[k]),
          span: ctx.window * DAY,
        },
      };
    });
    const c = choose(db, cand, x => aheadMilli(AHEAD + coverAt(db.recipes[x.recipe].product, monthOfDay(day))), ctx.urgent, ctx.urgent === undefined ? undefined : prevBefore(runs, at), sku => lastId.get(sku) ?? -1);
    if (!c) continue;
    const product = db.recipes[c.it.recipe].product;
    const cases = ctx.cases.get(c.it.sku)!;
    pos.set(c.it.sku, pos.get(c.it.sku)! + cases);
    const zr = momentOf(s.start, at + ctx.lead.get(product)!).day;
    const xs = arrive.get(zr) ?? [];
    xs.push({ sku: c.it.sku, cases });
    arrive.set(zr, xs);
    taken.add(day);
    const id = `B${next++}`;
    lastId.set(c.it.sku, idNum(id));
    runs.push({ id, notBefore: at, product });
    const br = rowOf(monthOfDay(day));
    if (br) {
      br.batches[product]++;
      const l = ctx.load.get(product)!;
      for (const res of SOP_RES) br.load[res] += l[res];
    }
  }
  for (const row of months)
    for (const it of items) {
      const nx = Math.floor((planCases(s, it.sku, row.m + 1) * 1000) / daysIn(row.m + 1));
      // запас в десятых суток спроса следующего месяца
      row.days[it.sku] = nx > 0 ? Math.floor((row.stock[it.sku] * 10000) / nx) : 0;
      row.demand[it.sku] = Math.floor(row.demand[it.sku] / 1000);
      row.short[it.sku] = Math.floor(row.short[it.sku] / 1000);
    }
  return { months, margin, carry, value: margin - carry, short: Math.floor(short / 1000), lost, mean: margin - carry, high: 0 };
}

/**
 * План на трёх вариантах спроса (Б6г): прогноз минус его ошибка, прогноз, прогноз плюс ошибка. Месяцы и числа — у
 * прогноза; цель — средняя трёх: так запас позиций чего-то стоит и против ошибки прогноза, а не только против сезона.
 */
export function sopEval(ctx: SopCtx, plan: Record<Id, number[]>): SopResult {
  const runs = SOP_CASES.map(k => sopRun(ctx, plan, k));
  const base = runs[1];
  return { ...base, mean: Math.floor(runs.reduce((n, r) => n + r.value, 0) / runs.length), high: runs[2].short };
}

/** Прогон плана с одной заготовкой. */
export const sopProject = (db: ContentDb, s: PlantState, plan: SopCover) => sopEval(sopCtx(db, s, plan.from), plan.cover);

/** Резерв мощности (политика начальника отдела планирования, Б6г): доля — числитель и знаменатель. */
export function reserveOf(db: ContentDb, s: PlantState): [number, number] {
  const v = policyOf(db, s, POL.reserve);
  return Array.isArray(v) ? [v[0], v[1]] : [0, 1];
}

/** Линия резерва ресурса: мощность × (1 − резерв). */
export const reserveLine = (cap: number, r: [number, number]) => Math.floor((cap * (r[1] - r[0])) / r[1]);

/**
 * Лучший план (Б6г; §9.2): та же функция планирования ищет цели по продуктам и месяцам из вариантов политики «запас
 * позиций» — сначала ровные по продукту, два прохода, потом по одной клетке, пока цель плана — маржа за вычетом цены
 * денег в запасе, средняя по трём вариантам спроса, — растёт. Копить впрок
 * сверх линии резерва нельзя: план, у которого в каком-то месяце нагрузка ресурса выше и линии резерва, и нагрузки
 * плана по политике, отвергнут; выпуск под спрос — и выше линии. Без записи.
 */
export function sopBest(db: ContentDb, s: PlantState, from: number, ctx = sopCtx(db, s, from)): { cover: Record<Id, number[]>; result: SopResult; base: SopResult } {
  const flat = Object.fromEntries(ctx.products.map(p => [p, Array.from({ length: SOP_MONTHS }, () => ctx.policy)])) as Record<Id, number[]>;
  const base = sopEval(ctx, flat);
  const r = reserveOf(db, s);
  // задания — предел самого правила, не ресурс: резерв на них не держат
  const fits = (x: SopResult) => x.months.every((row, i) => SOP_RES.every(res => res === 'slot' || row.load[res] <= Math.max(reserveLine(row.cap[res], r), base.months[i].load[res])));
  let cover = flat;
  let best = base;
  const tryPlan = (trial: Record<Id, number[]>) => {
    const x = sopEval(ctx, trial);
    if (x.mean > best.mean && fits(x)) {
      best = x;
      cover = trial;
    }
  };
  // запас держат месяцами: сначала ровная цель продукта на все месяцы, потом по одной клетке
  for (let pass = 0; pass < 2; pass++)
    for (const p of ctx.products)
      for (const c of SOP_COVERS) if (cover[p].some(x => x !== c)) tryPlan({ ...cover, [p]: cover[p].map(() => c) });
  for (const p of ctx.products)
    for (let i = 0; i < SOP_MONTHS; i++)
      for (const c of SOP_COVERS) if (c !== cover[p][i]) tryPlan({ ...cover, [p]: cover[p].map((x, j) => (j === i ? c : x)) });
  return { cover, result: best, base };
}

/** Месяц прогноза нынешнего мига. */
export const sopMonth = (s: PlantState) => monthAt(s, s.t);
