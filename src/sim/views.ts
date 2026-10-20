// Виды для панелей (docs/specs/2026-10-panels.md, 3б; docs/02-architecture.md, §10): склад и карточка вещи — чистые функции
// из состояния. Данные — плоский JSON без строк для игрока: номера, виды, числа, мгновения; слова — в окне (src/i18n/).
// Истины здесь нет (§9): сборщики не читают истинных свойств партий и серий, причин и запаса узлов до отказа — только то,
// что завод мог узнать: ярлык, место и тару паллеты, паспорт, результат испытания после проверки вторым лицом, решение по
// партии, задачу и чего она ждёт, журнал оборудования. Что окно уже получило, помнит `ViewDesk` — как «стол врача»
// «Больницы» (её src/sim/doctor.ts, `DoctorDesk`): вид уходит, только когда изменился.
import type { ContentDb, Id, MaterialKind } from '../content/types';
import { batchNo } from '../engine/batchno';
import { momentOf } from '../engine/core/calendar';
import { partType, wearAt } from '../engine/maint';
import { planOf } from '../engine/plant';
import { shiftEnd } from '../engine/staff';
import { TAG } from '../engine/stock';
import type { Lot, LotStatus, MachineState, PlantState, Tag, Task, TaskKind, Unit, WaitCause } from '../engine/types';
import { type InvQuery, type InvView, invView } from './inv';
import { type ChartQuery, type ChartView, chartView, type LabQuery, type LabView, labView } from './lab';
import { type EqState, eqStateOf } from './pack';
import { type Admission, admissionOf, type DocNow, docNow, docOfRev, type TrainRow, trainRows } from './people';
import { type GanttQuery, type GanttView, type GhostQuery, type GhostView, ganttView, ghostView } from './plan';
import { type NowQuery, type NowView, nowView } from './now';
import { type RefQuery, type RefView, refView } from './ref';
import { type CashQuery, type CashView, cashView, type MorningQuery, type MorningView, morningView, type TopQuery, type TopView, topView } from './report';

/** Вещь на полу — теми же номерами, что в срезе: паллета, помещение и оборудование — по порядку плана, машина — линия и место. */
export type Thing =
  | { kind: 'unit'; n: number }
  | { kind: 'room'; i: number }
  | { kind: 'equipment'; i: number }
  | { kind: 'machine'; line: number; k: number }
  | { kind: 'person'; n: number }
  | { kind: 'vehicle'; n: number }
  | { kind: 'truck'; n: number; customer: boolean };

export type StockSort = 'code' | 'material' | 'supplier' | 'status' | 'left' | 'expiry';

export interface StockQuery {
  view: 'stock';
  /** пусто — все */
  status: LotStatus[];
  kinds: MaterialKind[];
  sort: StockSort;
  desc: boolean;
  page: number;
  /** язык названий для сортировки по материалу и поставщику */
  lang: 'ru' | 'en';
}

export interface CardQuery {
  view: 'card';
  thing: Thing;
}

export type ViewQuery = { id: string } & (StockQuery | CardQuery | MorningQuery | CashQuery | TopQuery | LabQuery | ChartQuery | GanttQuery | GhostQuery | InvQuery | RefQuery | NowQuery);

/** Место паллеты: место плана (номер по порядку), помещение (номер по порядку), фура. */
export type PlaceRef = { k: 'slot'; i: number } | { k: 'room'; i: number } | { k: 'truck'; n: number; customer: boolean };

export interface StockRow {
  lot: string;
  code: [number, number, number];
  material: Id;
  supplier: Id;
  status: LotStatus;
  /** ярлык статуса на паллете: его цвет — у значка */
  tag: Tag;
  /** осталось в таре, мг или шт. */
  left: number;
  /** номер дня от 1970-01-01 */
  expiry: number;
  places: PlaceRef[];
  /** мест сверх показанных */
  more: number;
  /** первая паллета партии — номер: к ней ведёт камера */
  unit: number;
}

export interface StockView {
  view: 'stock';
  rows: StockRow[];
  total: number;
  page: number;
  pages: number;
}

/** Строк на странице панели склада. */
export const PAGE = 50;
/** Мест у партии в строке склада. */
export const PLACES = 3;

/**
 * Почему так: задача и чего она ждёт — «нет допуска» с документом, которого не хватает (Б3б); план отбора проб; испытания;
 * решение; серия ждёт решения; запас на старте.
 */
export type Why =
  | { k: 'task'; task: TaskKind; busy: boolean; wait?: WaitCause; since?: number; lack?: DocNow }
  | { k: 'plan' }
  | { k: 'tests'; done: number; all: number }
  | { k: 'decided'; status: 'released' | 'rejected'; t?: number }
  | { k: 'batch'; code: string }
  | { k: 'start' };

/**
 * Запись истории вещи. У испытания и решения мгновения нет — время не записано (сохранение до схемы 10); у резерва и
 * выдачи на серию его нет, пока серия не начала первую стадию.
 */
export type Hist =
  | { k: 'arrived'; t: number; po?: string }
  | { k: 'start'; t: number }
  | { k: 'made'; t: number; batch: string }
  | { k: 'reserved'; orders: number; qty: number; t?: undefined }
  | { k: 'sampled'; t: number; containers: number }
  | { k: 'test'; t?: number; method: Id; result: number; pass: boolean }
  | { k: 'decided'; t?: number; status: LotStatus }
  | { k: 'kit'; t?: number; batch: string; qty: number }
  | { k: 'shipped'; t: number; customer: Id; qty: number }
  | { k: 'maint'; t: number; part: string; what: 'failure' | 'repair' | 'replace'; wear: number };

export interface LotInfo {
  id: string;
  code: [number, number, number];
  material: Id;
  supplier: Id;
  vendorLot: string;
  status: LotStatus;
  tag: Tag;
  since?: number;
  /** принято и осталось, мг или шт. */
  qty: number;
  left: number;
  expiry: number;
  /** своя продукция (Б3а): редакция карты серии; у готовой продукции — и позиция, чья инструкция по упаковке */
  recipe?: Id;
  sku?: Id;
}

export type CardData =
  | { kind: 'unit'; unit: number; tag: Tag; containers: number; holds?: Holds; where: PlaceRef; lot?: LotInfo; why: Why[]; history: Hist[] }
  | { kind: 'room'; room: number; type: string; grade: 'D' | 'cnc'; status: 'clean' | 'busy' | 'dirty'; since: number; batch?: string; recipe?: Id; stage?: string; why: Why[] }
  | { kind: 'equipment'; eq: number; type: Id; room: number; state: EqState; batch?: string; recipe?: Id; parts: PartInfo[]; why: Why[]; history: Hist[] }
  | { kind: 'machine'; line: number; k: number; type: Id; state: MachineState; batch?: string; sku?: Id; parts: PartInfo[]; why: Why[]; history: Hist[] }
  /** человек (Б3б): табельный номер, навык, допуск сегодня, обучение по матрице его роли, что изучает сейчас */
  | { kind: 'person'; person: number; tab: number; role: Id; shift: Id; skill: number; doing: Doing; adm: Admission; train: TrainRow[]; learning?: DocNow }
  | { kind: 'vehicle'; vehicle: number; type: Id; task?: TaskKind }
  | { kind: 'truck'; truck: number; customer?: Id; supplier?: Id; po?: string; docked: boolean; open: boolean; units: number; arrived: number }
  /** вещи больше нет на заводе: паллету отгрузили, фура уехала */
  | { kind: 'gone' };

/**
 * Что лежит на паллете (Б1а): вид тары и сколько в ней по учёту — мг или шт., тары с одинаковым количеством вместе, от
 * большего; у готовой продукции — сколько пачек в полном ящике по позиции.
 */
export interface Holds {
  container: Id;
  by: { qty: number; n: number }[];
  full?: number;
}

/** Узел машины: вид в записи, наработка с установки (запас до отказа знает только движок), исправен ли. */
export interface PartInfo {
  type: string;
  /** износ — наработка к ресурсу, доли 1/10 000, как в журнале оборудования; запас до отказа — истина, его здесь нет */
  wear: number;
  failed: boolean;
  repair: boolean;
}

/** Что делает человек: задача, идёт на пост или к выходу, стоит на посту, вне смены. */
export type Doing = { k: 'task'; task: TaskKind } | { k: 'walk'; exit: boolean } | { k: 'post' } | { k: 'off' };

export interface CardView {
  view: 'card';
  thing: Thing;
  card: CardData;
}

export type ViewData = StockView | CardView | MorningView | CashView | TopView | LabView | ChartView | GanttView | GhostView | InvView | RefView | NowView;

const num = (id: string) => Number(id.slice(1));
const codeOf = (c: { y: number; m: number; n: number }): [number, number, number] => [c.y, c.m, c.n];

/** Где паллета — номерами плана и среза. */
function placeOf(db: ContentDb, s: PlantState, u: Unit): PlaceRef {
  const plan = planOf(db, s.plant);
  if (u.where.kind === 'slot') {
    const id = u.where.id;
    return { k: 'slot', i: plan.slots.findIndex(sl => sl.id === id) };
  }
  if (u.where.kind === 'room') {
    const id = u.where.id;
    return { k: 'room', i: plan.plant.rooms.findIndex(r => r.id === id) };
  }
  const t = s.trucks[u.where.id];
  return { k: 'truck', n: num(u.where.id), customer: !!t?.customer };
}

/** Паллеты партий и остаток в таре — один проход по таре. */
function lotsOnFloor(s: PlantState): Map<string, { left: number; units: Unit[] }> {
  const out = new Map<string, { left: number; units: Unit[] }>();
  for (const c of Object.values(s.containers)) {
    let e = out.get(c.lot);
    if (!e) out.set(c.lot, (e = { left: 0, units: [] }));
    e.left += c.qty;
    const u = s.units[c.unit];
    if (u && !e.units.includes(u)) e.units.push(u);
  }
  for (const e of out.values()) e.units.sort((a, b) => num(a.id) - num(b.id));
  return out;
}

const STATUS_ORDER: LotStatus[] = ['quarantine', 'sampled', 'testing', 'released', 'blocked', 'rejected'];

/** Склад: партии, у которых есть тара на заводе, — фильтр, сортировка, страница. */
export function stockView(db: ContentDb, s: PlantState, q: StockQuery): StockView {
  const name = (n: { ru: string; en?: string } | undefined) => (n ? (q.lang === 'en' && n.en) || n.ru : '');
  const floor = lotsOnFloor(s);
  const rows: StockRow[] = [];
  for (const [id, e] of floor) {
    const lot = s.lots[id];
    if (!lot || e.units.length === 0) continue;
    if (q.status.length > 0 && !q.status.includes(lot.status)) continue;
    if (q.kinds.length > 0 && !q.kinds.includes(db.materials[lot.material].kind)) continue;
    const places = e.units.map(u => placeOf(db, s, u));
    rows.push({
      lot: id,
      code: codeOf(lot.code),
      material: lot.material,
      supplier: lot.supplier,
      status: lot.status,
      tag: TAG[lot.status],
      left: e.left,
      expiry: lot.expiry,
      places: places.slice(0, PLACES),
      more: Math.max(0, places.length - PLACES),
      unit: num(e.units[0].id),
    });
  }
  const key = (r: StockRow): string | number => {
    switch (q.sort) {
      case 'code':
        return r.code[0] * 1e8 + r.code[1] * 1e6 + r.code[2];
      case 'material':
        return name(db.materials[r.material]?.name);
      case 'supplier':
        return name(db.suppliers[r.supplier]?.name);
      case 'status':
        return STATUS_ORDER.indexOf(r.status);
      case 'left':
        return r.left;
      case 'expiry':
        return r.expiry;
    }
  };
  // при равенстве — по номеру партии: порядок строк не зависит от порядка в состоянии
  rows.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const c = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb), q.lang);
    return (q.desc ? -c : c) || num(a.lot) - num(b.lot);
  });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const page = Math.min(Math.max(0, q.page), pages - 1);
  return { view: 'stock', rows: rows.slice(page * PAGE, (page + 1) * PAGE), total: rows.length, page, pages };
}

/** Задача вещи: идёт или ждёт и чего — как её видит завод (1ж). */
function taskWhy(db: ContentDb, s: PlantState, t: Task): Why {
  const lack = t.why === 'qual' && t.lack ? docNow(db, t.lack, momentOf(s.start, s.t).day) : undefined;
  return { k: 'task', task: t.kind, busy: t.state === 'busy', ...(t.why ? { wait: t.why, since: t.since } : {}), ...(lack ? { lack } : {}) };
}

function lotInfo(s: PlantState, lot: Lot, left: number): LotInfo {
  const b = lot.batch ? s.batches[lot.batch] : undefined;
  return {
    id: lot.id,
    code: codeOf(lot.code),
    material: lot.material,
    supplier: lot.supplier,
    vendorLot: lot.vendorLot,
    status: lot.status,
    tag: TAG[lot.status],
    ...(lot.since !== undefined ? { since: lot.since } : {}),
    qty: lot.qty,
    left,
    expiry: lot.expiry,
    ...(b ? { recipe: b.recipe } : {}),
    ...(b?.pack && lot.id === b.pack.fg ? { sku: b.pack.sku } : {}),
  };
}

/** Почему партия в своём статусе — по учёту лаборатории и серии. */
function lotWhy(s: PlantState, lot: Lot): Why[] {
  const out: Why[] = [];
  if (lot.batch && (lot.status === 'quarantine' || lot.status === 'testing' || lot.status === 'sampled')) {
    const b = s.batches[lot.batch];
    if (b) out.push({ k: 'batch', code: batchNo(b.code) });
  }
  const sm = lot.sample ? s.samples[lot.sample] : undefined;
  if (lot.status === 'quarantine' && !sm && !lot.batch) out.push({ k: 'plan' });
  if (sm && sm.tests.length > 0 && (lot.status === 'sampled' || lot.status === 'testing')) {
    out.push({ k: 'tests', done: sm.tests.filter(id => s.tests[id]?.state === 'done').length, all: sm.tests.length });
  }
  if (lot.supplier === 'start') out.push({ k: 'start' });
  else if (lot.status === 'released' || lot.status === 'rejected') out.push({ k: 'decided', status: lot.status, ...(lot.since !== undefined ? { t: lot.since } : {}) });
  return out;
}

/** История партии: приход или выпуск, пробы, испытания, решение, выдачи на серии, отгрузки — по времени. */
function lotHistory(s: PlantState, lot: Lot): Hist[] {
  const out: Hist[] = [];
  if (lot.batch && s.batches[lot.batch]) out.push({ k: 'made', t: lot.received, batch: batchNo(s.batches[lot.batch].code) });
  else if (lot.supplier === 'start') out.push({ k: 'start', t: lot.received });
  else out.push({ k: 'arrived', t: lot.received, ...(lot.po ? { po: lot.po } : {}) });
  const sm = lot.sample ? s.samples[lot.sample] : undefined;
  if (sm?.taken !== undefined) out.push({ k: 'sampled', t: sm.taken, containers: sm.plan.length });
  for (const id of sm?.tests ?? []) {
    const q = s.tests[id];
    if (q?.state !== 'done' || q.result === undefined) continue;
    out.push({ k: 'test', ...(q.done !== undefined ? { t: q.done } : {}), method: q.method, result: q.result, pass: !!q.pass });
  }
  if (lot.supplier !== 'start' && (lot.status === 'released' || lot.status === 'rejected')) out.push({ k: 'decided', ...(lot.since !== undefined ? { t: lot.since } : {}), status: lot.status });
  // резерв заданий на серию — одной строкой: до комплектации номера серии ещё нет; выдача — с первой стадии
  const reserved = { orders: 0, qty: 0 };
  for (const b of Object.values(s.batches)) {
    const qty = b.kit.filter(k => k.lot === lot.id).reduce((n, k) => n + k.qty, 0);
    if (qty === 0) continue;
    if (b.status === 'waiting' || b.status === 'reserved') {
      reserved.orders++;
      reserved.qty += qty;
    } else out.push({ k: 'kit', ...(b.records[0] ? { t: b.records[0].start } : {}), batch: batchNo(b.code), qty });
  }
  if (reserved.orders > 0) out.push({ k: 'reserved', ...reserved });
  for (const sh of Object.values(s.shipments)) {
    const qty = sh.cases.filter(c => c.lot === lot.id).reduce((n, c) => n + c.qty, 0);
    if (qty > 0) out.push({ k: 'shipped', t: sh.t, customer: sh.customer, qty });
  }
  // по времени; без отметки — на своём месте в порядке событий
  return out.map((h, i) => ({ h, i })).sort((a, b) => (a.h.t ?? Number.MAX_SAFE_INTEGER) - (b.h.t ?? Number.MAX_SAFE_INTEGER) || a.i - b.i).map(x => x.h);
}

function holdsOf(db: ContentDb, s: PlantState, u: Unit): Holds {
  const list = u.items.map(id => s.containers[id]);
  const by = new Map<number, number>();
  for (const c of list) by.set(c.qty, (by.get(c.qty) ?? 0) + 1);
  const lot = s.lots[list[0].lot];
  const sku = Object.values(db.skus).find(k => k.fg === lot.material);
  return {
    container: list[0].type,
    by: [...by].map(([qty, n]) => ({ qty, n })).sort((a, b) => b.qty - a.qty),
    ...(sku ? { full: sku.case.per } : {}),
  };
}

function partsOfMachine(db: ContentDb, s: PlantState, machine: string): PartInfo[] {
  return Object.values(s.parts)
    .filter(p => p.machine === machine)
    .map(p => ({ type: p.type, wear: wearAt(partType(db, p), p.done), failed: p.state === 'failed', repair: p.task !== undefined }));
}

function maintHistory(s: PlantState, machine: string): Hist[] {
  return s.maintLog.filter(e => e.machine === machine).map(e => ({ k: 'maint', t: e.t, part: e.part, what: e.what, wear: e.wear }));
}

/** Карточка вещи. */
export function cardView(db: ContentDb, s: PlantState, thing: Thing): CardView {
  return { view: 'card', thing, card: cardData(db, s, thing) };
}

function cardData(db: ContentDb, s: PlantState, thing: Thing): CardData {
  const plan = planOf(db, s.plant);
  switch (thing.kind) {
    case 'unit': {
      const u = s.units[`U${thing.n}`];
      if (!u) return { kind: 'gone' };
      const first = u.items.length ? s.containers[u.items[0]] : undefined;
      const lot = first ? s.lots[first.lot] : undefined;
      const tasks = Object.values(s.tasks).filter(t => t.unit === u.id);
      const left = lot ? Object.values(s.containers).reduce((n, c) => n + (c.lot === lot.id ? c.qty : 0), 0) : 0;
      return {
        kind: 'unit',
        unit: thing.n,
        tag: u.tag,
        containers: u.items.length,
        ...(first ? { holds: holdsOf(db, s, u) } : {}),
        where: placeOf(db, s, u),
        ...(lot ? { lot: lotInfo(s, lot, left) } : {}),
        why: [...tasks.map(t => taskWhy(db, s, t)), ...(lot ? lotWhy(s, lot) : [])],
        history: lot ? lotHistory(s, lot) : [],
      };
    }
    case 'room': {
      const def = plan.plant.rooms[thing.i];
      const r = def ? s.rooms[def.id] : undefined;
      if (!def || !r) return { kind: 'gone' };
      const b = r.batch ? s.batches[r.batch] : undefined;
      const clean = Object.values(s.tasks).filter(t => t.kind === 'clean' && t.room === def.id);
      return {
        kind: 'room',
        room: thing.i,
        type: def.type,
        grade: def.grade,
        status: r.status,
        since: r.since,
        ...(b ? { batch: batchNo(b.code), recipe: b.recipe } : {}),
        ...(b && r.status === 'busy' ? { stage: db.recipes[b.recipe].stages[b.stage]?.id } : {}),
        why: clean.map(t => taskWhy(db, s, t)),
      };
    }
    case 'equipment': {
      const def = plan.plant.equipment[thing.i];
      const e = def ? s.equipment[def.id] : undefined;
      if (!def || !e) return { kind: 'gone' };
      const b = e.batch ? s.batches[e.batch] : undefined;
      const repairs = Object.values(s.tasks).filter(t => t.kind === 'repair' && Object.values(s.parts).some(p => p.machine === def.id && p.task === t.id));
      return {
        kind: 'equipment',
        eq: thing.i,
        type: def.type,
        room: plan.plant.rooms.findIndex(r => r.id === def.room),
        state: eqStateOf(s, def.id),
        ...(b ? { batch: batchNo(b.code), recipe: b.recipe } : {}),
        parts: partsOfMachine(db, s, def.id),
        why: repairs.map(t => taskWhy(db, s, t)),
        history: maintHistory(s, def.id),
      };
    }
    case 'machine': {
      const ln = plan.plant.lines[thing.line];
      const line = ln ? s.lines[ln.id] : undefined;
      const def = ln?.machines[thing.k];
      const mc = line?.machines[thing.k];
      if (!ln || !line || !def || !mc) return { kind: 'gone' };
      const b = line.batch ? s.batches[line.batch] : undefined;
      const repairs = Object.values(s.tasks).filter(t => t.kind === 'repair' && Object.values(s.parts).some(p => p.machine === def.id && p.task === t.id));
      return {
        kind: 'machine',
        line: thing.line,
        k: thing.k,
        type: def.type,
        state: mc.state,
        ...(b ? { batch: batchNo(b.code) } : {}),
        ...(b?.pack ? { sku: b.pack.sku } : {}),
        parts: partsOfMachine(db, s, def.id),
        why: repairs.map(t => taskWhy(db, s, t)),
        history: maintHistory(s, def.id),
      };
    }
    case 'person': {
      const p = s.people[`E${thing.n}`];
      if (!p) return { kind: 'gone' };
      const t = p.task ? s.tasks[p.task] : undefined;
      const doing: Doing = t
        ? { k: 'task', task: t.kind }
        : shiftEnd(db, s, p) === undefined
          ? { k: 'off' }
          : p.walk
            ? { k: 'walk', exit: p.x === plan.entrance.x && p.z === plan.entrance.z }
            : { k: 'post' };
      const learning = t?.kind === 'train' && t.doc ? docOfRev(db, t.doc) : undefined;
      return { kind: 'person', person: thing.n, tab: p.tab, role: p.role, shift: p.shift, skill: p.skill, doing, adm: admissionOf(db, s, p), train: trainRows(db, s, p), ...(learning ? { learning } : {}) };
    }
    case 'vehicle': {
      const v = s.vehicles[`V${thing.n}`];
      if (!v) return { kind: 'gone' };
      const t = v.task ? s.tasks[v.task] : undefined;
      return { kind: 'vehicle', vehicle: thing.n, type: v.type, ...(t ? { task: t.kind } : {}) };
    }
    case 'truck': {
      const t = Object.values(s.trucks).find(x => num(x.id) === thing.n && !!x.customer === thing.customer);
      if (!t) return { kind: 'gone' };
      const po = t.po ? s.pos[t.po] : undefined;
      return {
        kind: 'truck',
        truck: thing.n,
        ...(t.customer ? { customer: t.customer } : {}),
        ...(po ? { supplier: po.supplier, po: po.id } : {}),
        docked: t.docked,
        open: t.open,
        units: t.units.length,
        arrived: t.arrived,
      };
    }
  }
}

export function viewOf(db: ContentDb, s: PlantState, q: ViewQuery): ViewData {
  switch (q.view) {
    case 'stock':
      return stockView(db, s, q);
    case 'card':
      return cardView(db, s, q.thing);
    case 'morning':
      return morningView(db, s, q);
    case 'cash':
      return cashView(db, s, q);
    case 'top':
      return topView(db, s);
    case 'lab':
      return labView(db, s);
    case 'chart':
      return chartView(db, s, q);
    case 'gantt':
      return ganttView(db, s, q);
    case 'ghost':
      return ghostView(db, s, q);
    case 'inv':
      return invView(db, s, q);
    case 'ref':
      return refView(db, s);
    case 'now':
      return nowView(db, s);
  }
}

/** Вид, который уходит окну: номер запроса окна, версия и данные. */
export interface ViewOut {
  id: string;
  v: number;
  data: ViewData;
}

/** Сколько миллисекунд между сборками видов без нового запроса и команды: 10 раз в секунду, как обновляются панели. */
export const VIEW_EVERY = 100;

/**
 * Что окно уже получило: открытые виды и их последние данные. Новый запрос или команда — собрать сразу; иначе — не чаще
 * `VIEW_EVERY`. Уходит только вид, чьи данные изменились, с версией на единицу больше.
 */
export class ViewDesk {
  private queries: ViewQuery[] = [];
  private sent = new Map<string, { json: string; v: number }>();
  private builtAt = Number.NEGATIVE_INFINITY;
  private dirty = true;

  constructor(private db: ContentDb) {}

  /** Окно прислало набор открытых видов: собрать при ближайшем срезе. */
  set(list: ViewQuery[]) {
    this.queries = list;
    for (const id of [...this.sent.keys()]) if (!list.some(q => q.id === id)) this.sent.delete(id);
    this.dirty = true;
  }

  /** Новая партия или сохранение: окну всё заново. */
  reset() {
    this.sent.clear();
    this.dirty = true;
  }

  /** Собрать при ближайшем срезе, не дожидаясь `VIEW_EVERY`: после команды. */
  touch() {
    this.dirty = true;
  }

  /** Виды для среза в мгновение `now` (мс, часы потока): изменившиеся; нечего — `undefined`. */
  out(s: PlantState, now: number): ViewOut[] | undefined {
    if (this.queries.length === 0) return undefined;
    if (!this.dirty && now - this.builtAt < VIEW_EVERY) return undefined;
    this.dirty = false;
    this.builtAt = now;
    const out: ViewOut[] = [];
    for (const q of this.queries) {
      const data = viewOf(this.db, s, q);
      const json = JSON.stringify(data);
      const last = this.sent.get(q.id);
      if (last?.json === json) continue;
      const v = (last?.v ?? 0) + 1;
      this.sent.set(q.id, { json, v });
      out.push({ id: q.id, v, data });
    }
    return out.length > 0 ? out : undefined;
  }
}
