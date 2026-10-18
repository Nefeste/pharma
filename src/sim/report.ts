// Планёрка и касса (docs/specs/2026-10-panels.md, 3в): виды для панелей — чистые функции из состояния, как склад и карточка
// (views.ts). Планёрка говорит о вчерашних календарных сутках — потери, смены и OEE движок ведёт по ним, — о событиях за
// 24 часа до неё и о том, что ждёт сейчас. Данные — без слов и без истины: время машин, счётчики линии, ожидания задач,
// записи отклонений, журнал оборудования, решения, заказы и проводки — то, что завод мог узнать.
import type { ContentDb, Dept, Id } from '../content/types';
import { DAY, momentOf } from '../engine/core/calendar';
import { MORNING } from '../engine/engine';
import { P_ONE } from '../engine/core/rng';
import { AREA, type Oee, oee, rhythm, shiftsOfDay } from '../engine/lean';
import { planOf } from '../engine/plant';
import type { CashItem, DayLoss, Deviation, LineDay, MachineTimes, PlantState, TaskKind, WaitCause } from '../engine/types';
import type { Thing } from './views';

/** Планёрка в 08:00 суток `day` (номер дня от 1970-01-01). */
export interface MorningQuery {
  view: 'morning';
  day: number;
}

export interface CashQuery {
  view: 'cash';
  page: number;
}

/** Касса верхней полосы. */
export interface TopQuery {
  view: 'top';
}

type Code = [number, number, number];
const code = (c: { y: number; m: number; n: number }): Code => [c.y, c.m, c.n];
const num = (id: string) => Number(id.slice(1));

// ---------------------------------------------------------------- вчера

/** Составляющая потерь ключевой машины: авария, наладка, микроостановки, ожидание соседей, медленнее номинала, брак. */
export type LineLoss = 'fail' | 'setup' | 'micro' | 'wait' | 'speed' | 'quality';

/** Сутки линии на планёрке: номер линии по плану; ключевая машина, OEE, главная потеря; при ожидании — сосед. */
export interface LineSum {
  line: number;
  key?: number;
  oee?: Oee;
  loss?: { what: LineLoss; sec: number };
  neighbour?: { k: number; what: 'fail' | 'micro'; sec: number };
}

/** Главная потеря суток: ожидание задач отдела по причине, потеря линии, перевозки техники, пешие переходы. */
export type MainLoss =
  | { k: 'wait'; dept: Dept; cause: WaitCause; sec: number }
  | ({ k: 'line'; sec: number } & Required<Pick<LineSum, 'line' | 'key' | 'loss'>> & Pick<LineSum, 'neighbour'>)
  | { k: 'move'; sec: number; cm: number; empty: number }
  | { k: 'walk'; sec: number; cm: number };

export interface ShiftRow {
  line: string;
  shift: Id;
  plan: number;
  fact?: number;
}

// ---------------------------------------------------------------- с прошлой планёрки и сейчас

export interface DevRow {
  t: number;
  kind: Deviation['kind'];
  lot?: Code;
  batch?: Code;
  material?: Id;
}

export interface DecisionRow {
  t: number;
  lot: Code;
  material: Id;
  status: 'released' | 'rejected';
  batch?: Code;
}

export interface MaintRow {
  t: number;
  thing?: Thing;
  type: Id;
  part: string;
  what: 'failure' | 'repair' | 'replace';
  wear: number;
}

export interface LabNow {
  queued: number;
  prep: number;
  run: number;
  review: number;
  /** заняты: вид прибора */
  busy: Id[];
  /** самая старая открытая задача лаборатории и чего она ждёт */
  oldest?: { task: TaskKind; since: number; wait?: WaitCause };
}

/** Нехватка материала заданиям одного вида: сколько заданий, всего не хватает; до комплектации у серии ещё нет номера. */
export interface ShortRow {
  /** задания на упаковку — не на серию */
  pack: boolean;
  material: Id;
  orders: number;
  qty: number;
  /** ближайший заказ поставщику с этим материалом */
  po?: { id: string; eta: number };
}

export interface BrokenRow {
  thing?: Thing;
  type: Id;
  part: string;
  since: number;
  /** ремонт идёт; ждёт людей; ждёт запчасть */
  repair: 'busy' | 'open' | 'spare';
}

export interface RiskRow {
  order: string;
  customer: Id;
  due: number;
  /** ящиков не хватит */
  missing: number;
  /** ящиков ГП этой позиции, которые ещё ждут решения или ввода в оборот */
  pending: number;
}

export interface MorningView {
  view: 'morning';
  day: number;
  /** вчера завода ещё не было: первая планёрка игры */
  first?: true;
  shifts: ShiftRow[];
  rhythm?: number;
  lines: LineSum[];
  main?: MainLoss;
  deviations: DevRow[];
  decisions: DecisionRow[];
  maint: MaintRow[];
  shipments: { t: number; customer: Id; cases: number }[];
  closed: { t: number; customer: Id; status: 'short' | 'late'; missing: number }[];
  lab: LabNow;
  short: ShortRow[];
  broken: BrokenRow[];
  risk: RiskRow[];
  cash: { balance: number; day: number; next?: { due: number; item: CashItem; sum: number } };
}

const LOAD: (keyof MachineTimes)[] = ['run', 'slow', 'micro', 'fail', 'wait', 'setup'];
const ORDER: LineLoss[] = ['fail', 'setup', 'micro', 'wait', 'speed', 'quality'];

/** Машина по имени в плане — вещь для карточки: машина линии или оборудование участка. */
function thingOf(db: ContentDb, s: PlantState, id: string): { thing?: Thing; type: Id } {
  const plan = planOf(db, s.plant);
  for (const [line, l] of plan.plant.lines.entries()) {
    const k = l.machines.findIndex(m => m.id === id);
    if (k >= 0) return { thing: { kind: 'machine', line, k }, type: l.machines[k].type };
  }
  const i = plan.plant.equipment.findIndex(e => e.id === id);
  return i >= 0 ? { thing: { kind: 'equipment', i }, type: plan.plant.equipment[i].type } : { type: id };
}

/**
 * Сутки линии: ключевая машина — с наименьшим выпуском по номиналу за загрузку (`10-domain.md`, §6: КПД линии относят к
 * ключевой машине); её OEE и главная составляющая потерь в секундах. Медленнее номинала и брак — в секундах при среднем
 * номинале суток. Если главная — ожидание соседей, рядом — сосед, который стоял дольше всех.
 */
export function lineSum(n: number, ld: LineDay | undefined): LineSum {
  if (!ld) return { line: n };
  let key = 0;
  ld.ideal.forEach((v, i) => {
    if (v < ld.ideal[key]) key = i;
  });
  const t = ld.times[key];
  const o = oee({ ideal: ld.ideal[key], run: ld.run[key], out: t.out }, ld.good);
  if (!o) return { line: n };
  const load = LOAD.reduce((x, k) => x + t[k], 0);
  const nu = ld.ideal[key] / load;
  const sec: Record<LineLoss, number> = {
    fail: t.fail,
    setup: t.setup,
    micro: t.micro,
    wait: t.wait,
    speed: Math.max(0, Math.round(t.slow - t.slowOut / nu)),
    quality: Math.max(0, Math.round((t.out - ld.good) / nu)),
  };
  const what = ORDER.reduce((a, b) => (sec[b] > sec[a] ? b : a));
  const out: LineSum = { line: n, key, oee: o, ...(sec[what] > 0 ? { loss: { what, sec: sec[what] } } : {}) };
  if (what === 'wait' && sec.wait > 0) {
    let best: LineSum['neighbour'];
    ld.times.forEach((m, k) => {
      if (k === key) return;
      for (const w of ['fail', 'micro'] as const) if (m[w] > 0 && (!best || m[w] > best.sec)) best = { k, what: w, sec: m[w] };
    });
    if (best) out.neighbour = best;
  }
  return out;
}

/** Главная потеря суток: больше всего секунд — ожидание задач отдела по причине, потеря линии, перевозки, переходы. */
export function mainLoss(d: DayLoss | undefined, lines: LineSum[]): MainLoss | undefined {
  if (!d) return undefined;
  const all: MainLoss[] = [];
  for (const [dept, causes] of Object.entries(d.wait))
    for (const [cause, sec] of Object.entries(causes ?? {})) all.push({ k: 'wait', dept: dept as Dept, cause: cause as WaitCause, sec: sec ?? 0 });
  for (const l of lines) if (l.loss && l.key !== undefined) all.push({ k: 'line', sec: l.loss.sec, line: l.line, key: l.key, loss: l.loss, ...(l.neighbour ? { neighbour: l.neighbour } : {}) });
  const mv = Object.values(d.move);
  all.push({ k: 'move', sec: mv.reduce((n, x) => n + (x?.sec ?? 0), 0), cm: mv.reduce((n, x) => n + (x ? x.loaded + x.empty : 0), 0), empty: mv.reduce((n, x) => n + (x?.empty ?? 0), 0) });
  const wk = Object.values(d.walk);
  all.push({ k: 'walk', sec: wk.reduce((n, x) => n + (x?.sec ?? 0), 0), cm: wk.reduce((n, x) => n + (x?.cm ?? 0), 0) });
  const best = all.reduce<MainLoss | undefined>((a, b) => (b.sec > (a?.sec ?? 0) ? b : a), undefined);
  return best;
}

/** Заказы под угрозой: открытые по сроку разбирают свободные ящики разрешённой ГП в обороте — FEFO, как в движке, без записи. */
function risks(db: ContentDb, s: PlantState): RiskRow[] {
  const day0 = momentOf(s.start, 0).day;
  const free = new Map<string, number>();
  for (const c of Object.values(s.containers)) if (!c.reserved) free.set(c.lot, (free.get(c.lot) ?? 0) + 1);
  const out: RiskRow[] = [];
  const orders = Object.values(s.orders)
    .filter(o => o.status === 'open')
    .sort((a, b) => a.due - b.due || num(a.id) - num(b.id));
  for (const o of orders) {
    const dueDay = day0 + Math.floor(o.due / DAY);
    let missing = 0;
    let pending = 0;
    for (const line of o.lines) {
      let need = line.cases - line.reserved;
      if (need <= 0) continue;
      const sku = db.skus[line.sku];
      const full = Math.floor((db.materials[sku.fg].shelf * 36525) / 1200);
      const lots = Object.values(s.lots).filter(l => l.material === sku.fg);
      const ready = lots
        .filter(l => l.status === 'released' && l.circulation !== undefined && (l.expiry - dueDay) * P_ONE >= o.minShelf * full)
        .sort((a, b) => a.expiry - b.expiry || num(a.id) - num(b.id));
      for (const l of ready) {
        const take = Math.min(need, free.get(l.id) ?? 0);
        free.set(l.id, (free.get(l.id) ?? 0) - take);
        need -= take;
      }
      missing += need;
      if (need > 0)
        for (const l of lots) if (l.status !== 'rejected' && (l.status !== 'released' || l.circulation === undefined)) pending += free.get(l.id) ?? 0;
    }
    if (missing > 0) out.push({ order: o.id, customer: o.customer, due: o.due, missing, pending });
  }
  return out;
}

/** Изменение кассы за 24 часа до `t`: проводки идут по времени — с конца, пока не старше суток. */
function dayChange(s: PlantState, t: number): number {
  const l = s.cash.ledger;
  let n = 0;
  for (let i = l.length - 1; i >= 0 && l[i].t > t - DAY; i--) if (l[i].t <= t) n += l[i].sum;
  return n;
}

/** Планёрка суток `day`: вчера — календарные сутки; события — за 24 часа до 08:00; сейчас — эта минута. */
export function morningView(db: ContentDb, s: PlantState, q: MorningQuery): MorningView {
  const plan = planOf(db, s.plant);
  const day0 = momentOf(s.start, 0).day;
  const at = (q.day - day0) * DAY + MORNING;
  const from = at - DAY;
  const inW = (t: number) => t >= from && t < at;
  const yest = s.losses.find(d => d.day === q.day - 1);
  // вчера
  const tasks = shiftsOfDay(s, q.day - 1);
  const lines = plan.plant.lines.map((l, n) => lineSum(n, yest?.lines[l.id]));
  const r = rhythm(tasks);
  // с прошлой планёрки
  const deviations: DevRow[] = Object.values(s.deviations)
    .filter(d => inW(d.opened))
    .map(d => ({
      t: d.opened,
      kind: d.kind,
      ...(d.lot && s.lots[d.lot] ? { lot: code(s.lots[d.lot].code), material: s.lots[d.lot].material } : {}),
      ...(d.batch && s.batches[d.batch] ? { batch: code(s.batches[d.batch].code) } : {}),
    }));
  const decisions: DecisionRow[] = Object.values(s.lots)
    .filter(l => l.supplier !== 'start' && (l.status === 'released' || l.status === 'rejected') && l.since !== undefined && inW(l.since))
    .map(l => ({
      t: l.since!,
      lot: code(l.code),
      material: l.material,
      status: l.status as 'released' | 'rejected',
      ...(l.batch && s.batches[l.batch] ? { batch: code(s.batches[l.batch].code) } : {}),
    }))
    .sort((a, b) => a.t - b.t);
  const maint: MaintRow[] = s.maintLog.filter(e => inW(e.t)).map(e => ({ t: e.t, ...thingOf(db, s, e.machine), part: e.part, what: e.what, wear: e.wear }));
  const shipments = Object.values(s.shipments)
    .filter(h => inW(h.t))
    .map(h => ({ t: h.t, customer: h.customer, cases: h.cases.length }));
  const closed = Object.values(s.orders)
    .filter(o => o.status === 'short' || o.status === 'late')
    .map(o => ({ o, t: o.shipment && s.shipments[o.shipment] ? s.shipments[o.shipment].t : o.due }))
    .filter(x => inW(x.t))
    .map(({ o, t }) => ({ t, customer: o.customer, status: o.status as 'short' | 'late', missing: o.lines.reduce((n, l) => n + l.cases - l.shipped, 0) }));
  // сейчас
  const tests = Object.values(s.tests);
  const count = (st: string) => tests.filter(x => x.state === st).length;
  const labTasks = Object.values(s.tasks)
    .filter(t => t.state === 'open' && AREA[t.kind] === 'qc')
    .sort((a, b) => a.created - b.created || num(a.id) - num(b.id));
  const lab: LabNow = {
    queued: count('queued'),
    prep: count('prep'),
    run: count('run'),
    review: count('review'),
    busy: Object.values(s.instruments)
      .filter(i => i.test)
      .map(i => i.type),
    ...(labTasks[0] ? { oldest: { task: labTasks[0].kind, since: labTasks[0].created, ...(labTasks[0].why ? { wait: labTasks[0].why } : {}) } } : {}),
  };
  const poOf = (material: Id) =>
    Object.values(s.pos)
      .filter(p => p.status === 'ordered' && p.lines.some(l => l.material === material))
      .sort((a, b) => a.eta - b.eta)[0];
  const byKey = new Map<string, ShortRow>();
  for (const b of Object.values(s.batches)) {
    const rows = [...(b.status === 'waiting' ? (b.short ?? []).map(x => ({ ...x, pack: false })) : []), ...(b.pack?.state === 'waiting' ? (b.pack.short ?? []).map(x => ({ ...x, pack: true })) : [])];
    for (const x of rows) {
      const key = `${x.pack}/${x.material}`;
      const row = byKey.get(key);
      if (row) {
        row.orders++;
        row.qty += x.qty;
        continue;
      }
      const po = poOf(x.material);
      byKey.set(key, { pack: x.pack, material: x.material, orders: 1, qty: x.qty, ...(po ? { po: { id: po.id, eta: po.eta } } : {}) });
    }
  }
  const short = [...byKey.values()];
  const broken: BrokenRow[] = Object.values(s.parts)
    .filter(p => p.state === 'failed')
    .map(p => {
      const task = p.task ? s.tasks[p.task] : undefined;
      return { ...thingOf(db, s, p.machine), part: p.type, since: p.failed ?? s.t, repair: task ? (task.state === 'busy' ? 'busy' : 'open') : 'spare' };
    });
  const next = s.cash.dues.filter(d => d.sum < 0).sort((a, b) => a.due - b.due)[0];
  return {
    view: 'morning',
    day: q.day,
    ...(q.day - 1 < day0 ? { first: true as const } : {}),
    shifts: tasks.map(t => ({ line: t.line, shift: t.shift, plan: t.plan, ...(t.fact !== undefined ? { fact: t.fact } : {}) })),
    ...(r !== undefined ? { rhythm: r } : {}),
    lines,
    ...(yest ? { main: mainLoss(yest, lines) } : {}),
    deviations,
    decisions,
    maint,
    shipments,
    closed,
    lab,
    short,
    broken,
    risk: risks(db, s),
    cash: { balance: s.cash.balance, day: dayChange(s, s.t), ...(next ? { next: { due: next.due, item: next.item, sum: next.sum } } : {}) },
  };
}

// ---------------------------------------------------------------- касса

/** «Почему» проводки и счёта — по ссылке: заказ поставщику, запчасть, отгрузка, половина месяца, месяц, квартал, серия. */
export type CashWhy =
  | { k: 'po'; po: string; supplier: Id }
  | { k: 'spare'; order: string; spare: Id }
  | { k: 'shipment'; customer: Id }
  | { k: 'month'; y: number; m: number; half?: 1 | 2 }
  | { k: 'quarter'; y: number; q: number }
  | { k: 'batch'; code: Code };

export interface CashRow {
  t: number;
  item: CashItem;
  sum: number;
  why?: CashWhy;
}

export interface CashView {
  view: 'cash';
  balance: number;
  /** предел кредитной линии, копейки */
  limit: number;
  /** за 24 часа */
  day: number;
  /** касса за пределом кредитной линии с этого мгновения; не за пределом — нет */
  below?: number;
  /** счета по сроку: остаток после каждого */
  dues: (CashRow & { after: number })[];
  total: number;
  page: number;
  pages: number;
  /** самая низкая точка календаря, если она ниже нынешнего остатка */
  low?: { t: number; balance: number };
  /** проводки за 24 часа */
  entries: CashRow[];
}

/** Строк календаря на странице. */
export const CASH_PAGE = 50;

function whyOf(s: PlantState, item: CashItem, ref: string | undefined): CashWhy | undefined {
  if (!ref) return undefined;
  if (s.pos[ref]) return { k: 'po', po: ref, supplier: s.pos[ref].supplier };
  if (s.spareOrders[ref]) return { k: 'spare', order: ref, spare: s.spareOrders[ref].spare };
  if (s.shipments[ref]) return { k: 'shipment', customer: s.shipments[ref].customer };
  if (item === 'codes' && s.batches[ref]) return { k: 'batch', code: code(s.batches[ref].code) };
  const q = /^(\d+)-q(\d)$/.exec(ref);
  if (q) return { k: 'quarter', y: Number(q[1]), q: Number(q[2]) };
  const m = /^(\d+)-(\d+)([ab]?)$/.exec(ref);
  if (m) return { k: 'month', y: Number(m[1]), m: Number(m[2]), ...(m[3] ? { half: m[3] === 'a' ? 1 : 2 } : {}) };
  return undefined;
}

const row = (s: PlantState, t: number, item: CashItem, sum: number, ref?: string): CashRow => {
  const why = whyOf(s, item, ref);
  return { t, item, sum, ...(why ? { why } : {}) };
};

export function cashView(db: ContentDb, s: PlantState, q: CashQuery): CashView {
  const limit = db.scenarios[s.scenario].credit.limit;
  const c = s.cash;
  // когда касса в последний раз ушла за предел — по проводкам с начала партии
  let bal = c.start;
  let below: number | undefined;
  for (const e of c.ledger) {
    const was = bal;
    bal += e.sum;
    if (was >= -limit && bal < -limit) below = e.t;
    if (bal >= -limit) below = undefined;
  }
  const sorted = [...c.dues].sort((a, b) => a.due - b.due || num(a.id) - num(b.id));
  let after = c.balance;
  let low: CashView['low'];
  const all = sorted.map(d => {
    after += d.sum;
    if (after < (low?.balance ?? c.balance)) low = { t: d.due, balance: after };
    return { ...row(s, d.due, d.item, d.sum, d.ref), after };
  });
  const pages = Math.max(1, Math.ceil(all.length / CASH_PAGE));
  const page = Math.min(Math.max(0, q.page), pages - 1);
  return {
    view: 'cash',
    balance: c.balance,
    limit,
    day: dayChange(s, s.t),
    ...(c.balance < -limit && below !== undefined ? { below } : {}),
    dues: all.slice(page * CASH_PAGE, (page + 1) * CASH_PAGE),
    total: all.length,
    page,
    pages,
    ...(low ? { low } : {}),
    entries: c.ledger.filter(e => e.t > s.t - DAY && e.t <= s.t).map(e => row(s, e.t, e.item, e.sum, e.ref)),
  };
}

export interface TopView {
  view: 'top';
  balance: number;
  day: number;
}

export const topView = (s: PlantState): TopView => ({ view: 'top', balance: s.cash.balance, day: dayChange(s, s.t) });
