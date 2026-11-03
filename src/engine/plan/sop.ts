// Совещание S&OP (Б6г; docs/specs/2026-10-vertical-slice.md, «Б6г»; геймдизайн, §9.2): чистые функции без записи —
// маржа пачки, нагрузка серии на ключевые ресурсы и часы ролей по нормам, мощность ресурсов и часы графиков по месяцам,
// прогон плана вперёд, лучший план, касса на три месяца и срок годности запаса. План — цель запаса по продукту и месяцу в
// сутках спроса: столько «запаса позиций» держит правило задания. Прогон — то же правило начальника отдела планирования
// день за днём на прогнозе планирования (Б6в): спрос — за календарный день месяца, серии — по рабочим дням через две
// рабочие недели, выпуск — через срок серий завода. Счёт — в целых: тысячные ящика, копейки, секунды.
import type { ContentDb, Id } from '../../content/types';
import { coverBy, skillOf, whoDecides } from '../bosses';
import { BANK_HOUR, baseLoad, part, salaryOf, vatRate } from '../cash';
import { civilFromDays, DAY, daysFromCivil, isWorkday, lastOfMonth, momentOf, workdayOnOrAfter, workdayOnOrBefore, workdaysIn } from '../core/calendar';
import { inForce } from '../docs';
import { daysIn, firstDay, lagError, monthAt, monthOfDay, planCases, shares, ymOf } from '../forecast';
import { BATCH_HOUR, cleanWork, nominal, packNeeds, roomWork, washRoles, washWork } from '../mes';
import { contractOf, costOf, listPrice } from '../partners';
import { AHEAD, AHEAD_WORK, aheadMilli, casesOf, choose, idNum, positionOf, prevBefore } from '../planner';
import { planOf } from '../plant';
import { numOf, POL, policyOf } from '../policies';
import { QP_WORK } from '../qa';
import { scheduleOn, spanOn } from '../shifts';
import { containersByLot } from '../stock';
import { planUse, supplyPosition } from '../supply';
import type { PackJob, PlantState } from '../types';
import { calOf } from '../workdays';

/** Горизонт совещания (§9.2): спрос, мощности и запас — на 6 месяцев с нынешнего, касса — на 3. */
export const SOP_MONTHS = 6;
export const SOP_CASH = 3;

/** Цели плана — варианты политики «запас позиций» (Б5г), сутки: от 7 до 42 шагом 7. */
export const SOP_COVERS = [7, 14, 21, 28, 35, 42] as const;

/**
 * Ключевые ресурсы грубой проверки мощности (RCCP): задания, ВЭЖХ, аналитики, уполномоченное лицо, линия, грануляция,
 * таблетирование.
 */
export type SopRes = 'slot' | 'hplc' | 'analyst' | 'qp' | 'line' | 'granulation' | 'compression';
export const SOP_RES: readonly SopRes[] = ['slot', 'hplc', 'analyst', 'qp', 'line', 'granulation', 'compression'];

/** Роли блока «Люди под план»: аппаратчики, операторы линии, упаковщики, аналитики, уполномоченное лицо, уборщики. */
export const SOP_ROLES = ['role.operator', 'role.line-operator', 'role.packer', 'role.analyst', 'role.qp', 'role.cleaner'] as const;
export type SopRole = (typeof SOP_ROLES)[number];

/** Срок серии, если выпущенных нет: от первой стадии до выпуска, с. */
const LEAD_DEFAULT = 10 * DAY;

/** Ошибка прогноза, пока записей с запаздыванием нет, — 1/10 000 (10 %). */
const ERR_DEFAULT = 1000;

/** Варианты спроса прогона: прогноз минус ошибка, прогноз, прогноз плюс ошибка — множитель ошибки. */
export const SOP_CASES = [-1, 0, 1] as const;

const P = 10000;

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

/** Поставщик материала — первый в базе, у которого он есть: его договор, прайс, сроки и оплата. */
function supplierOf(db: ContentDb, material: Id) {
  for (const sup of Object.values(db.suppliers)) if (sup.items[material]) return sup;
  return undefined;
}

/** Цена материала за кг или за штуку: по договору с поставщиком, если строка есть, иначе по прайсу. */
function priceOf(db: ContentDb, s: PlantState, material: Id): number {
  const sup = supplierOf(db, material);
  if (!sup) return 0;
  const cl = contractOf(s, sup.id, momentOf(s.start, s.t).day)?.lines.find(x => x.material === material);
  return cl?.price ?? listPrice(db, s, sup.items[material].price);
}

/** Пачек с серии позиции. */
export const packsOf = (db: ContentDb, recipe: Id, sku: Id) => {
  const k = db.skus[sku];
  return Math.floor(db.recipes[recipe].batch.units / (k.perBlister * k.blisters));
};

/** Карта позиции в плане выпуска сценария — редакция, действующая сегодня. */
function recipeOf(db: ContentDb, s: PlantState, sku: Id) {
  const id = db.scenarios[s.scenario].plan!.items.find(i => i.sku === sku)!.recipe;
  return db.recipes[inForce(db, 'recipes', id, momentOf(s.start, s.t).day)];
}

/** Энергия серии позиции по нормам, Вт·ч: оборудование стадий по номиналу карты и линия по скорости позиции (в базе — Вт). */
export function batchWh(db: ContentDb, s: PlantState, sku: Id): number {
  const r = recipeOf(db, s, sku);
  let wh = 0;
  for (const st of r.stages) {
    const sec = nominal(db, r.id, st, r.batch.mass);
    for (const e of st.equipment) wh += Math.floor((db.equipment[e].kw * sec) / 3600);
  }
  const lineSec = lineRun(db, r.id, sku);
  for (const m of Object.values(db.machines)) wh += Math.floor((m.kw * lineSec) / 3600);
  return wh;
}

export function packMargin(db: ContentDb, s: PlantState, sku: Id): PackMargin {
  const k = db.skus[sku];
  const r = recipeOf(db, s, sku);
  const packs = packsOf(db, r.id, sku);
  let bomBatch = 0;
  for (const l of r.bom) bomBatch += costOf(db, l.material, priceOf(db, s, l.material), l.qty);
  let pack = 0;
  for (const l of k.blister) pack += costOf(db, l.material, priceOf(db, s, l.material), l.qty * k.blisters);
  for (const l of k.carton) pack += costOf(db, l.material, priceOf(db, s, l.material), l.qty);
  pack += Math.floor(costOf(db, k.case.material, priceOf(db, s, k.case.material), 1) / k.case.per);
  // энергия серии — по цене кВт·ч сценария
  const energyBatch = Math.floor((batchWh(db, s, sku) * db.scenarios[s.scenario].energy.price) / 1000);
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

/** Помещение плана вида `type` — первое: в прототипе каждого вида по одному. */
const roomOf = (db: ContentDb, s: PlantState, type: string) => planOf(db, s.plant).plant.rooms.find(r => r.type === type)?.id;

/** Нагрузка серии продукта на ключевые ресурсы по нормам, с (задания — штуки). */
export type SopLoad = Record<SopRes, number>;

/** Часы ролей на серию по нормам или часы их графиков за месяц, с. */
export type SopHours = Record<SopRole, number>;

const blankLoad = (): SopLoad => ({ slot: 0, hplc: 0, analyst: 0, qp: 0, line: 0, granulation: 0, compression: 0 });
const blankHours = (): SopHours => ({ 'role.operator': 0, 'role.line-operator': 0, 'role.packer': 0, 'role.analyst': 0, 'role.qp': 0, 'role.cleaner': 0 });

/** Первая позиция продукта в плане выпуска: по ней — линия и упаковка серии продукта. */
const firstSku = (db: ContentDb, s: PlantState, product: Id) => db.scenarios[s.scenario].plan!.items.find(i => db.skus[i.sku].product === product)!.sku;

/**
 * Испытания на серию продукта (Б6г): балк и ГП по спецификациям в силе — целиком; входной контроль материалов карты и
 * упаковки — долей партии, которую серия расходует. Партия — заказ правила снабжения: расход на `every` суток, не меньше
 * минимальной партии. ВЭЖХ — работа прибора, аналитики — подготовка и работа при приборе.
 */
function labLoad(db: ContentDb, s: PlantState, product: Id, use: Map<Id, number>): { hplc: number; analyst: number } {
  const day = momentOf(s.start, s.t).day;
  const sku = firstSku(db, s, product);
  const r = recipeOf(db, s, sku);
  const out = { hplc: 0, analyst: 0 };
  const tests = (material: Id, num: number, den: number) => {
    const spec = db.specs[inForce(db, 'specs', db.materials[material].spec, day)];
    for (const line of spec.tests) {
      const m = db.tests[line.test];
      if (m.inst === 'inst.hplc') out.hplc += Math.floor((m.run * num) / den);
      out.analyst += Math.floor(((m.prep + (m.unattended ? 0 : m.run)) * num) / den);
    }
  };
  tests(r.bulk, 1, 1);
  tests(db.skus[sku].fg, 1, 1);
  const every = numOf(db, s, POL.every) ?? 28;
  const lines = [...r.bom.map(l => ({ material: l.material, qty: l.qty })), ...packNeeds(db, { sku, tablets: r.batch.units } as PackJob)];
  for (const l of lines) {
    const sup = supplierOf(db, l.material);
    if (!sup) continue;
    const lot = Math.max(sup.items[l.material].moq, Math.ceil(((use.get(l.material) ?? 0) * every) / 1000));
    if (lot > 0) tests(l.material, l.qty, lot);
  }
  return out;
}

export function batchLoad(db: ContentDb, s: PlantState, product: Id, use = planUse(db, s, 1000)): SopLoad {
  const sku = firstSku(db, s, product);
  const r = recipeOf(db, s, sku);
  const out: SopLoad = { ...blankLoad(), slot: 1, qp: QP_WORK, ...labLoad(db, s, product, use) };
  for (const st of r.stages) if (st.room === 'granulation' || st.room === 'compression') out[st.room] += nominal(db, r.id, st, r.batch.mass);
  // уборка после серии — малая, в каждом из двух помещений
  for (const type of ['granulation', 'compression'] as const) {
    const id = roomOf(db, s, type);
    if (id) out[type] += cleanWork(db, s, id, false);
  }
  // линия: блистеры позиции по скорости инструкции и переналадка картонажной машины
  const changeover = Math.max(0, ...Object.values(db.machines).map(m => m.changeover ?? 0));
  out.line += lineRun(db, r.id, sku) + changeover;
  return out;
}

/**
 * Часы ролей на серию продукта по нормам (Б6г): аппаратчики — стадии карты по числу людей и мойка оборудования помещений
 * стадий; операторы линии и упаковщики — работа линии по скорости позиции по числу людей у машин, операторы — и
 * переналадка, и мойка машин линии; аналитики — испытания; уполномоченное лицо — решение по серии; уборщики — уборка
 * помещений стадий и линии.
 */
export function batchHours(db: ContentDb, s: PlantState, product: Id, use = planUse(db, s, 1000)): SopHours {
  const sku = firstSku(db, s, product);
  const r = recipeOf(db, s, sku);
  const out = blankHours();
  const rooms = new Set<Id>();
  for (const st of r.stages) {
    if (st.staff.role in out) out[st.staff.role as SopRole] += nominal(db, r.id, st, r.batch.mass) * st.staff.n;
    const id = roomOf(db, s, st.room);
    if (id) rooms.add(id);
  }
  const plan = planOf(db, s.plant).plant;
  const run = lineRun(db, r.id, sku);
  for (const ln of plan.lines) {
    rooms.add(ln.room);
    for (const m of ln.machines) {
      const def = db.machines[m.type];
      const role = def.crew.role;
      if (role in out) out[role as SopRole] += (run + (def.changeover ?? 0)) * def.crew.n;
    }
  }
  for (const id of rooms) {
    const wash = washWork(db, s, id, false);
    const by = washRoles(db, s.plant, id).find(x => x in out);
    if (by) out[by as SopRole] += wash;
    out['role.cleaner'] += roomWork(db, s, id, false);
  }
  out['role.analyst'] += labLoad(db, s, product, use).analyst;
  out['role.qp'] += QP_WORK;
  return out;
}

/** Мощность ключевых ресурсов и часы графиков ролей в месяц `n` (номер месяца прогноза). */
export interface SopCap {
  cap: SopLoad;
  have: SopHours;
}

/**
 * Мощность месяца `n` (Б6г): задания — рабочие дни; ВЭЖХ, линия и помещения — длина смен их людей в сутки, с первой по
 * последнюю: прибор запускает аналитик, помещения работают в смены аппаратчиков, линия — операторов; аналитики и
 * уполномоченное лицо — их часы. Часы графиков ролей — смены людей по их графику, с переводами и отпусками, без
 * перерыва.
 */
export function capacityOf(db: ContentDb, s: PlantState, n: number): SopCap {
  const { y, m } = ymOf(n);
  const cal = calOf(db, s);
  const cap: SopLoad = { ...blankLoad(), slot: workdaysIn(cal, y, m) };
  const have = blankHours();
  const people = Object.values(s.people);
  const span = (role: Id, z: number) => {
    let a = Infinity;
    let b = -Infinity;
    for (const p of people) {
      if (p.role !== role) continue;
      const x = spanOn(db, s, p, z);
      if (!x) continue;
      a = Math.min(a, x[0]);
      b = Math.max(b, x[1]);
    }
    return b > a ? b - a : 0;
  };
  for (let z = firstDay(n); z < firstDay(n + 1); z++) {
    for (const p of people) {
      if (!(p.role in have)) continue;
      const x = spanOn(db, s, p, z);
      if (x) have[p.role as SopRole] += Math.max(0, x[1] - x[0] - (db.shifts[scheduleOn(p, z)].break ?? 0));
    }
    cap.hplc += span('role.analyst', z);
    cap.line += span('role.line-operator', z);
    const ops = span('role.operator', z);
    cap.granulation += ops;
    cap.compression += ops;
  }
  cap.analyst = have['role.analyst'];
  cap.qp = have['role.qp'];
  return { cap, have };
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

/**
 * Месяц прогона: серии по продуктам (по «не раньше», и уже поставленные), спрос и недопоставки, запас на конец, нагрузка и
 * мощность ресурсов, часы ролей по плану и по графикам.
 */
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
  hours: SopHours;
  have: SopHours;
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

/** След прогона для кассы и срока годности: продано и спрос позиции за день с завтра, тысячные ящика; новые серии. */
export interface SopTrace {
  sold: Map<Id, number[]>;
  demand: Map<Id, number[]>;
  made: { day: number; sku: Id }[];
}

/** Серия прогона: задание с «не раньше» и продукт — для кампаний правила. */
interface Run {
  id: string;
  notBefore: number;
  product: Id;
}

/**
 * Заготовка прогона (Б6г): то, что от целей плана не зависит, — один раз на совещание или вид: положение позиций и ГП,
 * серии в работе к их выпуску, уже поставленные задания по месяцам, сроки серий, нагрузка серии и часы ролей, мощность
 * ресурсов по месяцам, маржа пачки, спрос прогноза по дням с суммами для окна правила.
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
  /** задания, которые уже стоят, по месяцу «не раньше» и продукту */
  fixed: Map<number, Map<Id, number>>;
  load: Map<Id, SopLoad>;
  hours: Map<Id, SopHours>;
  cap: Map<number, SopCap>;
  margin: Map<Id, PackMargin>;
  cases: Map<Id, number>;
  carry: number;
  /** ошибка прогноза планирования за 12 месяцев, WAPE, 1/10 000 */
  err: number;
  /** день, до которого считают продажи: месяц после горизонта — запас на его конец не пропадает даром */
  sell: number;
  /** месяц прогноза дня прогона; день правила — через десять рабочих дней, номер дня прогона, или −1 */
  mon: number[];
  rule: number[];
  /** задания, которые уже стоят, — по «не раньше», при равных — по номеру: для продукта последнего задания */
  ordered: Run[];
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
  // месяц каждого дня и день правила через десять рабочих дней — один раз на заготовку
  const mon: number[] = [];
  for (let k = 0; k <= span; k++) mon.push(monthOfDay(z0 + k));
  const rule: number[] = [];
  for (let k = 0; k < span; k++) {
    let q = k;
    let left = work[k] ? AHEAD_WORK : -1;
    while (left > 0 && q + 1 < span) {
      q++;
      if (work[q]) left--;
    }
    rule.push(left === 0 ? q : -1);
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
  const fixed = new Map<number, Map<Id, number>>();
  let next = 0;
  for (const b of Object.values(s.batches)) {
    next = Math.max(next, idNum(b.id) + 1);
    if (b.sku) lastId.set(b.sku, Math.max(lastId.get(b.sku) ?? -1, idNum(b.id)));
    if (b.status === 'cancelled') continue;
    runs.push({ id: b.id, notBefore: b.notBefore, product: b.product });
    const bm = monthAt(s, b.notBefore);
    if (bm >= from && bm < from + SOP_MONTHS) {
      const f = fixed.get(bm) ?? new Map<Id, number>();
      f.set(b.product, (f.get(b.product) ?? 0) + 1);
      fixed.set(bm, f);
    }
    if (!b.sku || b.status === 'released' || b.status === 'rejected' || b.status === 'fg') continue;
    const k = db.skus[b.sku];
    const cases = b.status === 'packing' && b.pack?.fg ? Math.max(0, casesOf(db.recipes[b.recipe], k) - (byLot.get(b.pack.fg)?.length ?? 0)) : casesOf(db.recipes[b.recipe], k);
    const z = Math.max(z0, momentOf(s.start, (b.records[0]?.start ?? b.notBefore) + lead.get(b.product)!).day);
    const xs = arrive.get(z) ?? [];
    xs.push({ sku: b.sku, cases: cases * 1000 });
    arrive.set(z, xs);
  }
  const cap = new Map<number, SopCap>();
  for (let n = from; n < from + SOP_MONTHS; n++) cap.set(n, capacityOf(db, s, n));
  const use = planUse(db, s, 1000, byLot);
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
    fixed,
    load: new Map(products.map(p => [p, batchLoad(db, s, p, use)])),
    hours: new Map(products.map(p => [p, batchHours(db, s, p, use)])),
    cap,
    margin: new Map(items.map(it => [it.sku, packMargin(db, s, it.sku)])),
    cases: new Map(items.map(it => [it.sku, casesOf(db.recipes[it.recipe], db.skus[it.sku]) * 1000])),
    carry: carryRate(db, s),
    err: shares(lagError(s, 'plan', from - 12, from))?.wape ?? ERR_DEFAULT,
    sell,
    mon,
    rule,
    ordered: [...runs].sort((a, b) => a.notBefore - b.notBefore || idNum(a.id) - idNum(b.id)),
  };
}

/** Прибавить к месяцу серии продукта: счёт, нагрузку ресурсов и часы ролей. */
function addBatches(ctx: SopCtx, row: SopMonth, product: Id, n: number) {
  row.batches[product] += n;
  const l = ctx.load.get(product)!;
  for (const res of SOP_RES) row.load[res] += l[res] * n;
  const h = ctx.hours.get(product)!;
  for (const role of SOP_ROLES) row.hours[role] += h[role] * n;
}

/**
 * Прогон плана вперёд (Б6г): с завтра до конца месяца `from + 5`. Положение позиции для правила — как у правила (ГП и
 * серии в работе против открытых заказов); запас для продаж — ГП и серии в работе к их выпуску. Каждый рабочий день —
 * правило `choose` на день через две рабочие недели, запас позиций продукта — цель плана на месяц дня правила, с пределом
 * навыка руководителя; спрос — прогноз планирования за календарный день. Серии выходят через срок серий завода от первой
 * стадии или «не раньше». Нагрузка месяца — и задания, которые уже стоят. `trace` — продажи по дням и новые серии.
 */
export function sopRun(ctx: SopCtx, plan: Record<Id, number[]>, k = 0, trace?: SopTrace): SopResult {
  const { db, s, from, items, end, z0 } = ctx;
  const I = items.length;
  // вариант спроса: прогноз и его ошибка с множителем `k`
  const scale = P + k * ctx.err;
  // позиции — по номеру в плане выпуска: массивы вместо словарей
  const skus = items.map(it => it.sku);
  const rate = skus.map(x => ctx.rate.get(x)!);
  const rsum = skus.map(x => ctx.rateSum.get(x)!);
  const per = skus.map(x => db.skus[x].case.per);
  const mg = skus.map(x => ctx.margin.get(x)!.margin);
  const ck = skus.map((x, i) => per[i] * (ctx.margin.get(x)!.bom + ctx.margin.get(x)!.pack) * ctx.carry);
  const prod = items.map(it => db.recipes[it.recipe].product);
  const batchCases = skus.map(x => ctx.cases.get(x)!);
  const pos = skus.map(x => ctx.pos.get(x)!);
  const fg = skus.map(x => ctx.fg.get(x)!);
  const index = new Map(skus.map((x, i) => [x, i]));
  const arrive = new Map<number, { i: number; cases: number }[]>();
  for (const [z, xs] of ctx.arrive) arrive.set(z, xs.map(a => ({ i: index.get(a.sku)!, cases: a.cases })));
  const taken = new Set(ctx.taken);
  const lastId = new Map(ctx.lastId);
  let next = ctx.next;
  // кампании: продукт последнего задания до мига правила — среди тех, что уже стоят, по их «не раньше», и новых
  const ex = ctx.ordered;
  let j = 0;
  let lastNew: Run | undefined;
  const prevAt = (at: number): Id | undefined => {
    while (j < ex.length && ex[j].notBefore < at) j++;
    const a = j > 0 ? ex[j - 1] : undefined;
    return lastNew && (!a || lastNew.notBefore >= a.notBefore) ? lastNew.product : a?.product;
  };
  // запас позиций продукта на месяц правила: тысячные рабочего дня — один раз на прогон
  const aheadOf = new Map(ctx.products.map(p => [p, Array.from({ length: SOP_MONTHS }, (_, i) => aheadMilli(AHEAD + coverBy(ctx.skill, plan[p]?.[i] ?? ctx.policy)))]));
  const M = SOP_MONTHS;
  const months: SopMonth[] = [];
  const dem: number[][] = [];
  const sh: number[][] = [];
  const st: number[][] = [];
  for (let n = from; n < from + M; n++) {
    const c = ctx.cap.get(n)!;
    const row: SopMonth = { m: n, batches: {}, demand: {}, short: {}, stock: {}, days: {}, load: blankLoad(), cap: c.cap, hours: blankHours(), have: c.have };
    for (const p of ctx.products) row.batches[p] = 0;
    for (const [p, x] of ctx.fixed.get(n) ?? []) if (p in row.batches) addBatches(ctx, row, p, x);
    months.push(row);
    dem.push(new Array<number>(I).fill(0));
    sh.push(new Array<number>(I).fill(0));
    st.push(new Array<number>(I).fill(0));
  }
  const sold0 = trace ? skus.map(() => [] as number[]) : undefined;
  const dem0 = trace ? skus.map(() => [] as number[]) : undefined;
  let margin = 0;
  let carry = 0;
  let lost = 0;
  let short = 0;
  const days = ctx.sell - z0;
  for (let k = 0; k < days; k++) {
    const z = z0 + k;
    const mi = ctx.mon[k] - from;
    const inRow = mi >= 0 && mi < M;
    for (const a of arrive.get(z) ?? []) fg[a.i] += a.cases;
    for (let i = 0; i < I; i++) {
      const d = Math.floor((rate[i][k] * scale) / P);
      const sold = Math.min(Math.max(0, fg[i]), d);
      // чего не хватило, покупатель не ждёт: заказ закрывают недопоставкой, и в запас он не возвращается
      fg[i] -= sold;
      pos[i] -= sold;
      margin += Math.floor((sold * per[i] * mg[i]) / 1000);
      // месяц после горизонта — только продажи запаса на его конец: его недопоставки от плана не зависят
      if (d > sold && z < end) {
        lost += Math.floor(((d - sold) * per[i] * mg[i]) / 1000);
        short += d - sold;
      }
      // цена денег в запасе: ГП на конец суток по материалам и упаковке, ставка — в сотых долях процента в год
      if (fg[i] > 0) carry += Math.floor((fg[i] * ck[i]) / (1000 * 365 * P));
      if (inRow) {
        dem[mi][i] += d;
        sh[mi][i] += d - sold;
      }
      if (sold0) {
        sold0[i].push(sold);
        dem0![i].push(d);
      }
    }
    if (inRow && ctx.mon[k + 1] !== ctx.mon[k]) for (let i = 0; i < I; i++) st[mi][i] = Math.floor(Math.max(0, fg[i]) / 1000);
    // день правила — через десять рабочих дней
    const q = ctx.rule[k];
    if (q < 0) continue;
    const day = z0 + q;
    if (taken.has(day) || day >= end) continue;
    const at = (day - ctx.zero) * DAY + BATCH_HOUR;
    const w = Math.min(ctx.window, ctx.work.length - k);
    const work = Math.max(1, ctx.workSum[k + w] - ctx.workSum[k]);
    const cand = items.map((it, i) => ({ it, p: { cases: Math.floor(pos[i] / 1000), ordered: Math.floor((rsum[i][k + w] - rsum[i][k]) / 1000), work, span: ctx.window * DAY } }));
    const qi = Math.max(0, Math.min(M - 1, ctx.mon[q] - from));
    const c = choose(db, cand, x => aheadOf.get(db.recipes[x.recipe].product)![qi], ctx.urgent, ctx.urgent === undefined ? undefined : prevAt(at), x => lastId.get(x) ?? -1);
    if (!c) continue;
    const i = index.get(c.it.sku)!;
    const product = prod[i];
    pos[i] += batchCases[i];
    const zr = momentOf(s.start, at + ctx.lead.get(product)!).day;
    const xs = arrive.get(zr) ?? [];
    xs.push({ i, cases: batchCases[i] });
    arrive.set(zr, xs);
    taken.add(day);
    const id = `B${next++}`;
    lastId.set(c.it.sku, idNum(id));
    lastNew = { id, notBefore: at, product };
    trace?.made.push({ day, sku: c.it.sku });
    const bm = ctx.mon[q] - from;
    if (bm >= 0 && bm < M) addBatches(ctx, months[bm], product, 1);
  }
  if (trace)
    skus.forEach((x, i) => {
      trace.sold.set(x, sold0![i]);
      trace.demand.set(x, dem0![i]);
    });
  months.forEach((row, mi) =>
    skus.forEach((x, i) => {
      const nx = Math.floor((planCases(s, x, row.m + 1) * 1000) / daysIn(row.m + 1));
      row.stock[x] = st[mi][i];
      // запас в десятых суток спроса следующего месяца
      row.days[x] = nx > 0 ? Math.floor((st[mi][i] * 10000) / nx) : 0;
      row.demand[x] = Math.floor(dem[mi][i] / 1000);
      row.short[x] = Math.floor(sh[mi][i] / 1000);
    }),
  );
  return { months, margin, carry, value: margin - carry, short: Math.floor(short / 1000), lost, mean: margin - carry, high: 0 };
}

/**
 * План на трёх вариантах спроса (Б6г): прогноз минус его ошибка, прогноз, прогноз плюс ошибка. Месяцы и числа — у
 * прогноза; цель — средняя трёх: так запас позиций чего-то стоит и против ошибки прогноза, а не только против сезона.
 */
export function sopEval(ctx: SopCtx, plan: Record<Id, number[]>, trace?: SopTrace): SopResult {
  const runs = SOP_CASES.map(k => sopRun(ctx, plan, k, k === 0 ? trace : undefined));
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

/** Проходов по клеткам в поиске лучшего плана — не больше: цель растёт всё меньше, а прогон стоит времени совещания. */
const BEST_PASSES = 4;

/**
 * Лучший план (Б6г; §9.2): та же функция планирования ищет цели по продуктам и месяцам из вариантов политики «запас
 * позиций» — сначала ровные по продукту, два прохода по всем вариантам, потом по одной клетке на соседний вариант,
 * проходами, пока цель плана — маржа за вычетом цены денег в запасе, средняя по трём вариантам спроса, — растёт. Копить
 * впрок сверх линии резерва нельзя: план, у которого в каком-то месяце нагрузка ресурса выше и линии резерва, и
 * нагрузки плана по политике, отвергнут; выпуск под спрос — и выше линии. Один план не прогоняют дважды. Без записи.
 */
export function sopBest(db: ContentDb, s: PlantState, from: number, ctx = sopCtx(db, s, from)): { cover: Record<Id, number[]>; result: SopResult; base: SopResult } {
  const flat = Object.fromEntries(ctx.products.map(p => [p, Array.from({ length: SOP_MONTHS }, () => ctx.policy)])) as Record<Id, number[]>;
  const base = sopEval(ctx, flat);
  const r = reserveOf(db, s);
  // задания — предел самого правила, не ресурс: резерв на них не держат
  const fits = (x: SopResult) => x.months.every((row, i) => SOP_RES.every(res => res === 'slot' || row.load[res] <= Math.max(reserveLine(row.cap[res], r), base.months[i].load[res])));
  let cover = flat;
  let best = base;
  const seen = new Set<string>([JSON.stringify(flat)]);
  const tryPlan = (trial: Record<Id, number[]>) => {
    const key = JSON.stringify(trial);
    if (seen.has(key)) return false;
    seen.add(key);
    const x = sopEval(ctx, trial);
    if (x.mean <= best.mean || !fits(x)) return false;
    best = x;
    cover = trial;
    return true;
  };
  // запас держат месяцами: сначала ровная цель продукта на все месяцы, потом по одной клетке — на соседний вариант
  for (let pass = 0; pass < 2; pass++) for (const p of ctx.products) for (const c of SOP_COVERS) tryPlan({ ...cover, [p]: cover[p].map(() => c) });
  const step = SOP_COVERS as readonly number[];
  for (let pass = 0, grew = true; pass < BEST_PASSES && grew; pass++) {
    grew = false;
    for (const p of ctx.products)
      for (let i = 0; i < SOP_MONTHS; i++) {
        const at = step.indexOf(cover[p][i]);
        for (const c of [step[at - 1], step[at + 1]]) if (c !== undefined && tryPlan({ ...cover, [p]: cover[p].map((x, j) => (j === i ? c : x)) })) grew = true;
      }
  }
  return { cover, result: best, base };
}

/** Месяц прогноза нынешнего мига. */
export const sopMonth = (s: PlantState) => monthAt(s, s.t);

// ---------------------------------------------------------------- касса на три месяца

/** Строки кассы S&OP: счета со сроком, продажи, материалы под план, зарплата со взносами, энергия, НДС. */
export const SOP_CASH_ROWS = ['dues', 'sales', 'materials', 'wages', 'energy', 'vat'] as const;
export type SopCashRow = (typeof SOP_CASH_ROWS)[number];

export interface SopCashMonth {
  m: number;
  start: number;
  flows: Record<SopCashRow, number>;
  end: number;
}

export interface SopCash {
  months: SopCashMonth[];
  /** наименьший остаток трёх месяцев, его день и мгновение — час банка; предел кредитной линии — копейки */
  low: { day: number; at: number; balance: number };
  limit: number;
}

/**
 * Касса на три месяца (Б6г; §9.2): остаток сейчас и счета со сроком; продажи прогона и открытых заказов — с НДС через
 * отсрочку покупателя, доли покупателей — по их спросу в базе; материалы — остаток заказов в пути через отсрочку после
 * прихода фуры и под план: состав и упаковка новых серий сверх того, что есть и заказано, по цене пары в силе с НДС:
 * предоплата — при заказе, за срок поставки до прихода, остаток — через отсрочку после прихода, а приход — за входной
 * контроль и страховой запас до серии; зарплата — половинами по
 * окладу людей в учёте, взносы — по ставке профиля; энергия — постоянная база и серии месяца по нормам, окончательный
 * расчёт и авансы следующего месяца; НДС квартала — тремя долями в следующем квартале. Дни — в час банка рабочего дня.
 */
export function sopCash(ctx: SopCtx, base: SopResult, trace: SopTrace): SopCash {
  const { db, s, from } = ctx;
  const sc = db.scenarios[s.scenario];
  const pr = db.profiles[sc.profile];
  const cal = calOf(db, s);
  const today = ctx.z0 - 1;
  const stop = firstDay(from + SOP_CASH);
  const days = stop - today;
  const flow = SOP_CASH_ROWS.map(() => new Array<number>(Math.max(0, days)).fill(0));
  const row = (r: SopCashRow) => flow[SOP_CASH_ROWS.indexOf(r)];
  const add = (r: SopCashRow, z: number, sum: number) => {
    const k = Math.max(today, z) - today;
    if (k < days && sum !== 0) row(r)[k] += sum;
  };
  const bank = (z: number) => workdayOnOrAfter(cal, z);
  // счета со сроком
  for (const d of s.cash.dues) if (d.due >= s.t) add('dues', momentOf(s.start, d.due).day, d.sum);
  // НДС квартала: начислено с его начала и по прогону — до закрытия
  const vat = new Map<number, { out: number; in: number }>();
  const vq = (z: number) => {
    const n = monthOfDay(z);
    const q = n - (n % 3);
    const x = vat.get(q) ?? { out: 0, in: 0 };
    vat.set(q, x);
    return x;
  };
  // продажи: доли покупателей по их спросу в базе, срок — их отсрочка
  const custOf = (sku: Id) => {
    const cs = Object.values(db.customers).filter(c => (c.demand[sku] ?? 0) > 0);
    const total = cs.reduce((n, c) => n + c.demand[sku], 0);
    return cs.map(c => ({ days: c.payDays, share: total > 0 ? Math.floor((c.demand[sku] * P) / total) : 0 }));
  };
  const sale = (sku: Id, z: number, net: number) => {
    const tax = part(net, pr.vat.medicines);
    vq(z).out += tax;
    for (const c of custOf(sku)) add('sales', bank(z + c.days), part(net + tax, c.share));
  };
  for (const o of Object.values(s.orders)) {
    if (o.status !== 'open') continue;
    const z = Math.max(today, momentOf(s.start, o.due).day);
    for (const l of o.lines) if (l.cases > l.shipped) sale(l.sku, z, (l.cases - l.shipped) * db.skus[l.sku].case.per * db.skus[l.sku].price);
  }
  for (const [sku, xs] of trace.sold) {
    const k = db.skus[sku];
    xs.forEach((sold, i) => {
      const z = ctx.z0 + i;
      if (z < stop) sale(sku, z, Math.floor((sold * k.case.per * k.price) / 1000));
    });
  }
  // заказы поставщикам в пути: остаток после предоплаты — через отсрочку после прихода фуры, НДС — к вычету в её квартал
  for (const po of Object.values(s.pos)) {
    if (po.status !== 'ordered' || po.sum === undefined) continue;
    const came = momentOf(s.start, po.eta).day;
    add('materials', bank(came + db.suppliers[po.supplier].payDays), -(po.sum - (po.prepaid ?? 0)));
    vq(Math.max(today, came)).in += po.vat ?? 0;
  }
  // материалы под план: что есть и заказано — по порядку новых серий
  const qc = sc.supply?.qc ?? 0;
  const safety = numOf(db, s, POL.safety) ?? 0;
  const left = new Map<Id, number>();
  const byLot = containersByLot(s);
  for (const b of trace.made) {
    if (b.day >= stop + 120) break;
    const r = recipeOf(db, s, b.sku);
    const lines = [...r.bom.map(l => ({ material: l.material, qty: l.qty })), ...packNeeds(db, { sku: b.sku, tablets: r.batch.units } as PackJob)];
    for (const l of lines) {
      if (!left.has(l.material)) left.set(l.material, supplyPosition(db, s, l.material, byLot));
      const have = left.get(l.material)!;
      const buy = Math.max(0, l.qty - Math.max(0, have));
      left.set(l.material, have - l.qty);
      const sup = supplierOf(db, l.material);
      if (buy === 0 || !sup) continue;
      const net = costOf(db, l.material, priceOf(db, s, l.material), buy);
      const tax = part(net, vatRate(db, s, l.material));
      const came = b.day - qc - safety;
      const pre = part(net + tax, sup.prepay);
      add('materials', bank(came - sup.lead[1]), -pre);
      add('materials', bank(came + sup.payDays), -(net + tax - pre));
      vq(Math.max(today, came)).in += tax;
    }
  }
  // зарплата: первая половина месяца — в его последний рабочий день, вторая — 15-го следующего, взносы — в срок профиля
  const ct = pr.payroll.contrib;
  for (let n = from; n < from + SOP_CASH; n++) {
    const { y, m } = ymOf(n);
    const a = firstDay(n);
    const b = firstDay(n + 1) - 1;
    let gross = 0;
    for (const p of Object.values(s.people)) if ((p.hired === undefined || p.hired <= b) && (p.quit === undefined || p.quit.last >= a)) gross += salaryOf(db, p);
    const half = Math.floor(gross / 2);
    // первую половину нынешнего месяца касса считает 16-го: тогда она уже в счетах
    if (!s.cash.dues.some(d => d.item === 'wages' && d.ref === `${y}-${m}a`)) add('wages', workdayOnOrBefore(cal, lastOfMonth(y, m)), -half);
    const nx = ymOf(n + 1);
    add('wages', workdayOnOrBefore(cal, daysFromCivil({ y: nx.y, m: nx.m, d: 15 })), -(gross - half));
    add('wages', bank(daysFromCivil({ y: nx.y, m: nx.m, d: ct.due })), -(part(gross, ct.rate) + part(gross, ct.injury)));
  }
  // энергия: месяц по нормам; его окончательный расчёт — в следующем, авансы — доли его стоимости
  const sumAdv = pr.energy.advances.reduce((n, x) => n + x[1], 0);
  let prev = s.cash.energy.last;
  for (let n = from; n < from + SOP_CASH; n++) {
    const hours = (firstDay(n + 1) - firstDay(n)) * 24;
    let wh = baseLoad(db, s) * hours;
    const row0 = base.months[n - from];
    for (const p of ctx.products) wh += row0.batches[p] * batchWh(db, s, firstSku(db, s, p));
    const net = Math.floor((wh * sc.energy.price) / 1000);
    const tax = part(net, pr.vat.general);
    vq(firstDay(n)).in += tax;
    const cost = net + tax;
    const nx = ymOf(n + 1);
    add('energy', bank(daysFromCivil({ y: nx.y, m: nx.m, d: pr.energy.final })), -(cost - part(prev, sumAdv)));
    for (const [d, share] of pr.energy.advances) add('energy', bank(daysFromCivil({ y: nx.y, m: nx.m, d })), -part(cost, share));
    prev = cost;
  }
  // НДС нынешнего квартала — начисленное и по прогону — тремя долями до срока профиля в каждом из трёх следующих месяцев;
  // прошлого — уже в счетах, следующий кончается за горизонтом
  const q0 = from - (from % 3);
  const x = vat.get(q0) ?? { out: 0, in: 0 };
  const due = s.cash.vat.out - s.cash.vat.in - s.cash.vat.carry + x.out - x.in;
  if (due > 0) {
    const third = Math.floor(due / 3);
    for (let k = 0; k < 3; k++) {
      const { y, m } = ymOf(q0 + 3 + k);
      add('vat', bank(daysFromCivil({ y, m, d: pr.vatDue })), -(k < 2 ? third : due - 2 * third));
    }
  }
  // по месяцам и наименьший остаток
  const months: SopCashMonth[] = [];
  let bal = s.cash.balance;
  let low = { day: today, at: s.t, balance: bal };
  for (let n = from; n < from + SOP_CASH; n++) {
    const flows = Object.fromEntries(SOP_CASH_ROWS.map(r => [r, 0])) as Record<SopCashRow, number>;
    const startBal = bal;
    for (let z = Math.max(today, firstDay(n)); z < firstDay(n + 1); z++) {
      const k = z - today;
      for (const r of SOP_CASH_ROWS) {
        flows[r] += row(r)[k];
        bal += row(r)[k];
      }
      if (bal < low.balance) low = { day: z, at: (z - ctx.zero) * DAY + BANK_HOUR, balance: bal };
    }
    months.push({ m: n, start: startBal, flows, end: bal });
  }
  return { months, low, limit: sc.credit.limit };
}

/** День, когда ГП с долей срока годности `share` (1/10 000) от полного срока уже не продать покупателю. */
const sellBy = (expiry: number, full: number, share: number) => expiry - Math.ceil((full * share) / P);

/**
 * ГП под угрозой срока годности (Б6г; §9.2): партия позиции, которую по FEFO и спросу прогона не продадут, пока у неё
 * остаётся срока не меньше, чем требует покупатель, — самый строгий из базы. Позиция → месяцы горизонта, в которых срок
 * такой партии выходит.
 */
export function shelfRisk(ctx: SopCtx, trace: SopTrace): Map<Id, Set<number>> {
  const { db, s, from } = ctx;
  const out = new Map<Id, Set<number>>();
  const share = Math.max(0, ...Object.values(db.customers).map(c => c.minShelf));
  const byLot = containersByLot(s);
  const today = ctx.z0 - 1;
  for (const it of ctx.items) {
    const k = db.skus[it.sku];
    const full = Math.floor((db.materials[k.fg].shelf * 36525) / 1200);
    const lots = Object.values(s.lots)
      .filter(l => l.material === k.fg && l.status !== 'rejected' && l.status !== 'blocked' && (byLot.get(l.id)?.length ?? 0) > 0)
      .sort((a, b) => a.expiry - b.expiry || idNum(a.id) - idNum(b.id));
    if (lots.length === 0) continue;
    // открытые заказы берут старые партии первыми
    let used = 0;
    for (const o of Object.values(s.orders)) if (o.status === 'open') for (const l of o.lines) if (l.sku === it.sku) used += (l.cases - l.shipped) * 1000;
    const dem = trace.demand.get(it.sku)!;
    let i = 0;
    let stock = 0;
    for (const lot of lots) {
      stock += (byLot.get(lot.id)?.length ?? 0) * 1000;
      const by = sellBy(lot.expiry, full, share);
      // спрос до дня `by` включительно
      while (i < dem.length && ctx.z0 + i <= by) used += dem[i++];
      if (used >= stock) continue;
      const n = monthOfDay(Math.max(today, by));
      if (n >= from && n < from + SOP_MONTHS) {
        const xs = out.get(it.sku) ?? new Set<number>();
        xs.add(n);
        out.set(it.sku, xs);
      }
    }
  }
  return out;
}

/** Номер дня — в дату для подписи окна: месяц и число (без `Date`). */
export const dayMonth = (z: number) => {
  const d = civilFromDays(z);
  return { m: d.m, d: d.d };
};
