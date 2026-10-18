// Производство (docs/specs/2026-10-engine.md, 1в, 1г; геймдизайн, §5.3–5.5): задание на серию, резерв по FEFO, комплект к
// шлюзу, стадии по технологической карте — помещение, оборудование, люди; чистота и уборка; режимы; истинные показатели
// и причины; МОК; балк в карантине; задание на упаковку и комплект упаковочных материалов к линии (саму линию ведёт
// line.ts). Стадия с узлами под износом (1е) останавливается на отказе узла и продолжается после ремонта (maint.ts).
// Задачи раздаёт раздатчик (tasks.ts); здесь — когда их заводить и что они делают, когда кончаются.
import { ATTRS, type Attr, type CauseDriver, type ContentDb, type Id, type RecipeStage } from '../content/types';
import { addEnergy } from './cash';
import { schedule } from './core/agenda';
import { HOUR, MIN, momentOf } from './core/calendar';
import { P_ONE } from './core/rng';
import { defect, recleaned } from './lean';
import { blocked, consume, failPart, partsOf, partType, untilFail, wearAt } from './maint';
import { type PlantPlan, planOf } from './plant';
import { measure, within } from './quality';
import { normal, roll, spread } from './random';
import { containersByLot, createLot, free, knownAssay, nextId, putUnit, stockChanged } from './stock';
import { addTask, release } from './tasks';
import type { Batch, Command, Container, Deviation, Equipment, KitLine, Lot, Notice, PackJob, Part, Place, PlantEvent, PlantState, Room, StageRecord, Task, Unit } from './types';
import { PRIO, WMS } from './wms';

/** Роли производства. */
export const MES = { operators: ['role.operator'] } as const;

/** Перекладка в шлюзе: с деревянной паллеты на пластиковую и обратно (спецификация 1в). */
export const TRANSFER_WORK = 10 * MIN;

/** Сроки чистоты (геймдизайн, §5.5): чистое ждёт не дольше 72 часов, грязное убирают в течение 24 — иначе большая уборка. */
export const CLEAN_HOLD = 72 * HOUR;
export const DIRTY_HOLD = 24 * HOUR;

/** Приоритеты: комплект к шлюзу — раньше размещения, серия ждёт его; стадия — раньше уборки. */
export const MES_PRIO = { pick: 45, transfer: 45, return: 35, stage: 30, clean: 28 } as const;

/** С какого часа «дня не раньше» задания на серию можно начинать: смена аппаратчиков (сценарий, график `shift.a`). */
export const BATCH_HOUR = 7 * HOUR;

const idNum = (id: string) => Number(id.slice(1));
const busyUnit = (s: PlantState, uid: string) => Object.values(s.tasks).some(t => t.unit === uid);
const roomPlace = (plan: PlantPlan, roomId: string): Place => ({ kind: 'point', x: plan.room[roomId].x, z: plan.room[roomId].z });

/** Задание на серию: серия ждёт резерва и своей даты. Нет карты — отказ. */
export function placeOrder(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'order' }>, notices: Notice[]) {
  const r = db.recipes[cmd.recipe];
  if (!r) {
    notices.push({ kind: 'refused', cmd: 'order', why: 'noRecipe', detail: cmd.recipe });
    return;
  }
  const b: Batch = {
    id: nextId(s, 'B'),
    code: { y: 0, m: 0, n: 0 },
    recipe: r.id,
    product: r.product,
    notBefore: Math.max(s.t, cmd.notBefore ?? s.t),
    ordered: s.t,
    by: cmd.by ?? 'player',
    status: 'waiting',
    ...(cmd.sku ? { sku: cmd.sku } : {}),
    kit: [],
    stage: 0,
    mass: 0,
    dispensed: [],
    records: [],
    truth: {},
    noise: {},
    causes: [],
    spent: {},
    phaseAt: s.t,
  };
  s.batches[b.id] = b;
  schedule(s.agenda, b.notBefore, { kind: 'batch', id: b.id });
  reserve(db, s, b);
}

/**
 * Резерв по FEFO: на каждую строку состава — тара разрешённых партий на складе; раньше срок — раньше, в партии — сначала
 * начатая тара. АФС — с пересчётом на содержание, известное заводу; строка «до массы» добирает массу серии. Не хватает
 * хоть одной строки — резерва нет совсем, а в задании — чего не хватает.
 */
/** Партии материала по FEFO: разрешённые, срок не вышел, раньше срок — раньше; в партии — тара на складе, начатая первой. */
function fefo(s: PlantState, material: Id, today: number, byLot: Map<string, Container[]>): { lot: Lot; cs: Container[] }[] {
  return Object.values(s.lots)
    .filter(l => l.material === material && l.status === 'released' && l.expiry > today)
    .sort((a, c) => a.expiry - c.expiry || a.received - c.received || idNum(a.id) - idNum(c.id))
    .map(lot => ({
      lot,
      cs: (byLot.get(lot.id) ?? []).filter(c => s.units[c.unit].where.kind === 'slot').sort((a, c) => Number(c.opened) - Number(a.opened) || idNum(a.id) - idNum(c.id)),
    }));
}

function reserve(db: ContentDb, s: PlantState, b: Batch): boolean {
  const r = db.recipes[b.recipe];
  const today = momentOf(s.start, s.t).day;
  const taken = new Map<string, number>();
  const kit: KitLine[] = [];
  const short: { material: Id; qty: number }[] = [];
  const lines = [...r.bom.filter(l => l.potency), ...r.bom.filter(l => !l.potency && !l.qs), ...r.bom.filter(l => l.qs)];
  const byLot = containersByLot(s);
  // сколько навеска с пересчётом тяжелее нормы — на столько меньше строки «до массы»
  let extra = 0;
  for (const line of lines) {
    let left = line.qs ? Math.max(0, line.qty - extra) : line.qty;
    let gross = 0;
    for (const { lot, cs } of fefo(s, line.material, today, byLot)) {
      if (left <= 0) break;
      const assay = line.potency ? knownAssay(db, s, lot) : P_ONE;
      for (const c of cs) {
        if (left <= 0) break;
        const avail = free(c) - (taken.get(c.id) ?? 0);
        if (avail <= 0) continue;
        // у АФС `left` — действующее вещество, мг: тары нужно больше, если содержание меньше 100 %
        const want = line.potency ? Math.ceil((left * P_ONE) / assay) : left;
        const q = Math.min(avail, want);
        left = q === want ? 0 : left - (line.potency ? Math.floor((q * assay) / P_ONE) : q);
        gross += q;
        taken.set(c.id, (taken.get(c.id) ?? 0) + q);
        kit.push({ container: c.id, lot: lot.id, material: line.material, qty: q, ...(line.potency ? { assay } : {}) });
      }
    }
    if (left > 0) short.push({ material: line.material, qty: left });
    if (line.potency) extra += gross - line.qty;
  }
  if (short.length > 0) {
    b.status = 'waiting';
    b.short = short;
    b.tried = s.next.stock ?? 0;
    return false;
  }
  for (const k of kit) {
    const c = s.containers[k.container];
    c.reserved = (c.reserved ?? 0) + k.qty;
  }
  b.kit = kit;
  delete b.short;
  delete b.tried;
  b.status = 'reserved';
  return true;
}

/**
 * Шаг производства: ждущим — резерв, если склад изменился с их прошлой попытки; зарезервированным в свой день —
 * комплектация (одна за раз — серии или упаковки); едущим к шлюзу — новые задачи; в работе — следующая стадия; балку —
 * задание на упаковку, когда его разрешат. Зовётся после каждого события.
 */
export function mesStep(db: ContentDb, s: PlantState) {
  let kitting = Object.values(s.batches).some(b => b.status === 'kitting' || b.pack?.state === 'kitting');
  for (const b of Object.values(s.batches)) {
    switch (b.status) {
      case 'waiting':
        if (b.tried !== (s.next.stock ?? 0)) reserve(db, s, b);
        break;
      case 'reserved':
        if (!kitting && s.t >= b.notBefore) {
          startKitting(db, s, b);
          kitting = true;
        }
        break;
      case 'kitting':
        kitStep(db, s, b);
        break;
      case 'process':
        tryStart(db, s, b);
        break;
      case 'bulk': {
        // отклонённый балк не упаковывают; разрешённый — в позицию серии, если она задана
        const lot = s.lots[b.bulk!];
        if (lot.status === 'rejected') b.status = 'rejected';
        else if (lot.status === 'released' && b.sku) startPacking(db, s, b);
        break;
      }
      case 'packing': {
        const job = b.pack!;
        if (job.state === 'waiting' && job.tried !== (s.next.stock ?? 0)) reservePack(db, s, b);
        else if (job.state === 'reserved' && !kitting) {
          startPackKitting(db, s, b);
          kitting = true;
        } else if (job.state === 'kitting') kitStep(db, s, b);
        break;
      }
    }
  }
}

/**
 * Команда «сдвинуть» (3д): у задания, которое ещё не начало комплектовку, — новый срок «не раньше», не раньше нынешней
 * минуты. В очереди — событие задания на новом сроке; прежнее событие без вреда — оно будит шаг производства для всех.
 */
export function shiftCommand(s: PlantState, cmd: Extract<Command, { kind: 'shift' }>, notices: Notice[]) {
  const b = s.batches[cmd.batch];
  if (!b) return notices.push({ kind: 'refused', cmd: 'shift', why: 'noBatch', detail: cmd.batch });
  if (b.status !== 'waiting' && b.status !== 'reserved') return notices.push({ kind: 'refused', cmd: 'shift', why: 'started', detail: cmd.batch });
  b.notBefore = Math.max(s.t, Math.floor(cmd.notBefore));
  schedule(s.agenda, b.notBefore, { kind: 'batch', id: b.id });
}

/** Команда «упаковать»: позиция того же продукта; задание заведётся, когда балк разрешат. */
export function packOrder(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'pack' }>, notices: Notice[]) {
  const b = s.batches[cmd.batch];
  const sku = db.skus[cmd.sku];
  if (!b) return notices.push({ kind: 'refused', cmd: 'pack', why: 'noBatch', detail: cmd.batch });
  if (!sku || sku.product !== b.product) return notices.push({ kind: 'refused', cmd: 'pack', why: 'noSku', detail: cmd.sku });
  if (b.pack || ['packing', 'fg', 'released', 'rejected'].includes(b.status)) return notices.push({ kind: 'refused', cmd: 'pack', why: 'notBulk', detail: cmd.batch });
  b.sku = sku.id;
  mesStep(db, s);
}

/**
 * Задание на упаковку разрешённого балка: на первую линию плана, все таблетки балка; материалы — резервом по FEFO с
 * запасом на брак (docs/specs/2026-10-engine.md, 1г).
 */
function startPacking(db: ContentDb, s: PlantState, b: Batch) {
  const line = planOf(db, s.plant).plant.lines[0];
  if (!line) return;
  const tablets = (containersByLot(s).get(b.bulk!) ?? []).reduce((n, c) => n + c.qty, 0);
  const job: PackJob = { sku: b.sku!, line: line.id, state: 'waiting', created: s.t, kit: [], used: [], tablets, checked: 0, rejected: [], retained: [] };
  b.pack = job;
  b.status = 'packing';
  reservePack(db, s, b);
}

/**
 * Сколько материала может понадобиться на упаковку: на блистер — блистеров не больше таблеток / в блистере, плюс брак на
 * наладку; на пачку — пачек не больше блистеров / в пачке (плюс наладка и запас на заминки — у самой пачки и
 * инструкции); ящиков — вверх до целого. Это верхняя граница: брак камер только уменьшает расход, а заминки портят не
 * больше запаса (line.ts), поэтому материала на линии всегда хватает.
 */
export function packNeeds(db: ContentDb, job: PackJob): { material: Id; qty: number }[] {
  const sku = db.skus[job.sku];
  const blisters = Math.floor(job.tablets / sku.perBlister);
  const cartons = Math.floor(blisters / sku.blisters);
  return [
    ...sku.blister.map(l => ({ material: l.material, qty: (blisters + sku.waste.blisters) * l.qty })),
    ...sku.carton.map(l => ({ material: l.material, qty: (cartons + sku.waste.cartons + sku.waste.jams) * l.qty })),
    { material: sku.case.material, qty: Math.ceil(cartons / sku.case.per) },
  ];
}

/** Резерв упаковочных материалов по FEFO, всё или ничего — как у серии. */
function reservePack(db: ContentDb, s: PlantState, b: Batch) {
  const job = b.pack!;
  const today = momentOf(s.start, s.t).day;
  const byLot = containersByLot(s);
  const kit: KitLine[] = [];
  const short: { material: Id; qty: number }[] = [];
  for (const need of packNeeds(db, job)) {
    let left = need.qty;
    for (const { lot, cs } of fefo(s, need.material, today, byLot)) {
      for (const c of cs) {
        if (left <= 0) break;
        const q = Math.min(free(c), left);
        if (q <= 0) continue;
        kit.push({ container: c.id, lot: lot.id, material: need.material, qty: q });
        left -= q;
      }
      if (left <= 0) break;
    }
    if (left > 0) short.push({ material: need.material, qty: left });
  }
  if (short.length > 0) {
    job.state = 'waiting';
    job.short = short;
    job.tried = s.next.stock ?? 0;
    return;
  }
  for (const k of kit) {
    const c = s.containers[k.container];
    c.reserved = (c.reserved ?? 0) + k.qty;
  }
  job.kit = kit;
  delete job.short;
  delete job.tried;
  job.state = 'reserved';
}

/** Комплект упаковочных материалов — к шлюзу и на пластиковую паллету в помещении линии. */
function startPackKitting(db: ContentDb, s: PlantState, b: Batch) {
  const job = b.pack!;
  const room = planOf(db, s.plant).plant.lines.find(l => l.id === job.line)!.room;
  const u: Unit = { id: nextId(s, 'U'), type: 'unit.pallet.plastic', where: { kind: 'room', id: room }, items: [], tag: 'released' };
  s.units[u.id] = u;
  job.kitUnit = u.id;
  job.state = 'kitting';
  kitStep(db, s, b);
}

/** Чей комплект едет: серии — на производство, задания на упаковку — к линии. */
function holderOf(b: Batch): { kit: KitLine[]; kitUnit?: string } {
  return b.status === 'packing' ? b.pack! : b;
}

/** Каждый час: грязное дольше суток — к большой уборке; грязное без уборки — убрать. */
export function mesHour(db: ContentDb, s: PlantState) {
  for (const t of s.open.map(id => s.tasks[id])) {
    if (t.kind !== 'clean') continue;
    const room = s.rooms[t.room!];
    if (!room.major && s.t - room.since > DIRTY_HOLD) {
      room.major = true;
      t.work = cleanTime(db, s, room);
    }
  }
  for (const room of Object.values(s.rooms)) ensureCleaning(db, s, room);
  mesStep(db, s);
}

/** Начать комплектацию: номер серии — с выдачей досье; пластиковая паллета ждёт комплект в помещении первой стадии. */
function startKitting(db: ContentDb, s: PlantState, b: Batch) {
  const plan = planOf(db, s.plant);
  const at = momentOf(s.start, s.t);
  b.code = { y: at.date.y % 100, m: at.date.m, n: (s.next.batchCode = (s.next.batchCode ?? 0) + 1) };
  const room = plan.roomOf[db.recipes[b.recipe].stages[0].room];
  const u: Unit = { id: nextId(s, 'U'), type: 'unit.pallet.plastic', where: { kind: 'room', id: room }, items: [], tag: 'released' };
  s.units[u.id] = u;
  b.kitUnit = u.id;
  b.status = 'kitting';
  kitStep(db, s, b);
}

/**
 * Паллеты с тарой комплекта — к шлюзу, если их никто не везёт; весь комплект на пластиковой паллете — стадии (или линии
 * — для комплекта упаковки).
 */
function kitStep(db: ContentDb, s: PlantState, b: Batch) {
  const plan = planOf(db, s.plant);
  const h = holderOf(b);
  let pending = false;
  const seen = new Set<string>();
  for (const k of h.kit) {
    const c = s.containers[k.container];
    if (c.unit === h.kitUnit) continue;
    pending = true;
    const u = s.units[c.unit];
    if (seen.has(u.id) || u.where.kind !== 'slot' || busyUnit(s, u.id)) continue;
    seen.add(u.id);
    const from: Place = { kind: 'slot', id: u.where.id };
    // паллета уже у шлюза, а перекладки нет (после загрузки сохранения) — переложить
    if (plan.slot[u.where.id].kind === 'staging') addTask(s, { kind: 'transfer', roles: [...WMS.keepers], unit: u.id, from, work: TRANSFER_WORK, prio: MES_PRIO.transfer, batch: b.id });
    else addTask(s, { kind: 'pick', roles: [...WMS.movers], veh: [...WMS.floor], unit: u.id, from, toKind: 'staging', work: 0, prio: MES_PRIO.pick, batch: b.id });
  }
  if (pending) return;
  if (b.status === 'packing') b.pack!.state = 'ready';
  else {
    b.status = 'process';
    tryStart(db, s, b);
  }
}

/** Чисто ли помещение для продукта: убрано, чистота не просрочена, после малой уборки — тот же продукт. Одна проверка для движка и прогона расписания (3д). */
export function readyFor(room: Room, product: Id, now: number): boolean {
  return room.status === 'clean' && !room.batch && (room.cleanFor === undefined || room.cleanFor === product) && now - room.since <= CLEAN_HOLD;
}

/**
 * Следующая стадия серии: помещение её типа — чистое для продукта (или серия уже в нём), оборудование стадии в нём —
 * свободно. Иначе стадия ждёт; грязное или просроченное помещение уходит в уборку.
 */
function tryStart(db: ContentDb, s: PlantState, b: Batch) {
  const r = db.recipes[b.recipe];
  if (b.status !== 'process' || b.stage >= r.stages.length) return;
  if (Object.values(s.tasks).some(t => t.kind === 'stage' && t.batch === b.id)) return;
  const plan = planOf(db, s.plant);
  const st = r.stages[b.stage];
  const roomId = plan.roomOf[st.room];
  const room = s.rooms[roomId];
  if (room.batch !== b.id) {
    if (room.batch || room.status === 'dirty') return ensureCleaning(db, s, room);
    if (!readyFor(room, b.product, s.t)) {
      // чистота просрочена — убрать снова, малой уборкой; чисто только для другого продукта — большой. Повторная уборка
      // после просрочки — лишняя обработка (1ж)
      if (s.t - room.since > CLEAN_HOLD) recleaned(s);
      room.status = 'dirty';
      if (room.cleanFor !== undefined && room.cleanFor !== b.product) room.major = true;
      room.since = s.t;
      return ensureCleaning(db, s, room);
    }
  }
  const eqs = st.equipment.map(type => Object.values(s.equipment).find(e => e.room === roomId && e.type === type && (!e.batch || e.batch === b.id)));
  // неисправное оборудование выведено из работы до устранения (GMP ЕАЭС, ч. I, п. 3.44): стадия ждёт ремонта
  if (eqs.some(e => !e || blocked(s, e.id))) return;
  room.status = 'busy';
  room.batch = b.id;
  b.room = roomId;
  for (const e of eqs) e!.batch = b.id;
  // после отказа — остаток работы без подготовки; у оборудования с узлами — событие начала работы (stageBegin)
  const work = b.run?.rest ?? duration(db, s, b, st, roomId);
  const worn = eqs.some(e => partsOf(s, e!.id).length > 0);
  addTask(s, { kind: 'stage', roles: [st.staff.role], count: st.staff.n, from: roomPlace(plan, roomId), work, prio: MES_PRIO.stage, batch: b.id, ...(worn ? { begin: true } : {}) });
}

/** Узлы оборудования, на котором идёт стадия серии. */
function stageParts(db: ContentDb, s: PlantState, b: Batch): Part[] {
  const st = db.recipes[b.recipe].stages[b.stage];
  return stageEquipment(s, b, st).flatMap(e => partsOf(s, e.id));
}

function stageEquipment(s: PlantState, b: Batch, st: RecipeStage): Equipment[] {
  return Object.values(s.equipment).filter(e => e.batch === b.id && e.room === b.room && st.equipment.includes(e.type));
}

/** Таблеток на стадию по массе полупродукта — как в длительности стадии. */
const unitsOf = (db: ContentDb, b: Batch) => Math.floor((b.mass * db.recipes[b.recipe].batch.units) / db.recipes[b.recipe].batch.mass);

/**
 * Аппаратчик начал стадию с узлами под износом (событие `begin`). Отрезок прессования — от конца подготовки (её нет
 * после отказа) до конца задачи, таблетки — поровну по времени. Для каждого исправного узла — на какой таблетке кончится
 * его запас до отказа; если раньше конца отрезка — событие отказа (docs/specs/2026-10-engine.md, 1е).
 */
export function stageBegin(db: ContentDb, s: PlantState, id: string, v: number) {
  const t = s.tasks[id];
  if (!t || t.v !== v || t.state !== 'busy' || t.kind !== 'stage') return;
  const b = s.batches[t.batch!];
  const st = db.recipes[b.recipe].stages[b.stage];
  const first = !b.run;
  if (!b.run) b.run = { start: s.t, units: unitsOf(db, b), left: unitsOf(db, b), wear: {}, stops: [], people: [] };
  const run = b.run;
  for (const p of t.people) if (!run.people.includes(p)) run.people.push(p);
  const stop = run.stops[run.stops.length - 1];
  if (stop && stop.to === undefined) stop.to = s.t;
  delete run.rest;
  const end = t.times![4];
  run.from = Math.min(end, s.t + (first ? st.time.setup : 0));
  const span = end - run.from;
  if (span <= 0 || run.left === 0) return;
  for (const pt of stageParts(db, s, b)) {
    const n = untilFail(partType(db, pt), pt.done, pt.budget);
    if (n >= run.left) continue;
    const at = run.from + Math.ceil((n * span) / run.left);
    if (at < end) schedule(s.agenda, at, { kind: 'fail', part: pt.id, v: pt.v, n });
  }
}

/**
 * Наработка узлов стадии — ещё `n` таблеток: запас до отказа расходуется, износ копится для среднего за стадию. Отрезок
 * кончился — события отказа, поставленные на него, устаревают.
 */
function syncStage(db: ContentDb, s: PlantState, b: Batch, n: number) {
  const run = b.run!;
  for (const pt of stageParts(db, s, b)) {
    const ty = partType(db, pt);
    const d0 = pt.done;
    pt.done += n;
    pt.budget -= consume(ty, d0, n);
    pt.v++;
    run.wear[pt.id] = (run.wear[pt.id] ?? 0) + n * (wearAt(ty, d0) + wearAt(ty, pt.done));
  }
  run.left -= n;
}

/**
 * Отказ узла посреди стадии (событие `fail`): наработка до этой таблетки, узел — в ремонт; стадия встаёт — люди уходят,
 * серия держит помещение и оборудование, остаток работы ждёт ремонта.
 */
export function pressFail(db: ContentDb, s: PlantState, ev: Extract<PlantEvent, { kind: 'fail' }>, notices: Notice[]) {
  const pt = s.parts[ev.part];
  if (!pt || pt.v !== ev.v || pt.state !== 'ok') return;
  const b = s.equipment[pt.machine].batch ? s.batches[s.equipment[pt.machine].batch!] : undefined;
  const t = b && Object.values(s.tasks).find(x => x.kind === 'stage' && x.batch === b.id && x.state === 'busy');
  if (!b?.run || !t) return;
  const st = db.recipes[b.recipe].stages[b.stage];
  syncStage(db, s, b, ev.n);
  failPart(db, s, pt, notices, b.id);
  addEnergy(s, stageEquipment(s, b, st).reduce((w, e) => w + db.equipment[e.type].kw, 0), s.t - t.times![1]);
  b.run.rest = t.times![4] - s.t;
  b.run.stops.push({ part: pt.id, from: s.t });
  release(db, s, t);
}

/** Номинальная длительность стадии по карте: подготовка + загрузки + компоненты + масса / скорость; без разброса — для прогона расписания (3д). */
export function nominal(db: ContentDb, recipe: Id, st: RecipeStage, mass: number): number {
  const r = db.recipes[recipe];
  const t = st.time;
  const units = Math.floor((mass * r.batch.units) / r.batch.mass);
  let sec = t.setup + (t.perLoad ?? 0) * (t.loads ?? 1) + (t.perComponent ?? 0) * r.bom.length;
  if (t.mgPerHour) sec += Math.ceil((mass * HOUR) / t.mgPerHour);
  if (t.unitsPerHour) sec += Math.ceil((units * HOUR) / t.unitsPerHour);
  return sec;
}

/** Длительность стадии по карте: номинальная, с разбросом. */
function duration(db: ContentDb, s: PlantState, b: Batch, st: RecipeStage, roomId: string): number {
  const t = st.time;
  const sec = nominal(db, b.recipe, st, b.mass);
  if (t.spread === 0) return sec;
  return Math.max(MIN, sec + roll(s, `mes/${roomId}`, rng => spread(Math.floor((sec * t.spread) / P_ONE), normal(rng))));
}

/** Уборка грязного помещения, если её ещё нет: малая — та же продукция, большая — если помечено или грязно дольше суток. */
function ensureCleaning(db: ContentDb, s: PlantState, room: Room) {
  if (room.status !== 'dirty' || Object.values(s.tasks).some(t => t.kind === 'clean' && t.room === room.id)) return;
  if (s.t - room.since > DIRTY_HOLD) room.major = true;
  const plan = planOf(db, s.plant);
  addTask(s, { kind: 'clean', roles: [...MES.operators], from: roomPlace(plan, room.id), work: cleanTime(db, s, room), prio: MES_PRIO.clean, room: room.id });
}

/** Уборка помещения — уборка всего оборудования в нём (геймдизайн, §5.5): сумма времён по виду уборки. */
function cleanTime(db: ContentDb, s: PlantState, room: Room): number {
  return cleanWork(db, s, room.id, !!room.major);
}

/** Время уборки помещения малой или большой уборкой — для движка и прогона расписания (3д). */
export function cleanWork(db: ContentDb, s: PlantState, roomId: string, major: boolean): number {
  let sec = 0;
  for (const e of Object.values(s.equipment)) if (e.room === roomId) sec += db.equipment[e.type].cleaning[major ? 'major' : 'minor'];
  return Math.max(sec, 10 * MIN);
}

export function deviate(s: PlantState, notices: Notice[], d: Omit<Deviation, 'id' | 'opened' | 'status'>) {
  const dev: Deviation = { id: nextId(s, 'D'), opened: s.t, status: 'open', ...d };
  s.deviations[dev.id] = dev;
  defect(s, 'deviations');
  notices.push({ kind: 'deviation', id: dev.id });
}

/** Что сделала задача производства, когда кончилась. Не задача производства — `false`. */
export function mesDone(db: ContentDb, s: PlantState, t: Task, notices: Notice[]): boolean {
  const plan = planOf(db, s.plant);
  switch (t.kind) {
    case 'pick': {
      const u = s.units[t.unit!];
      putUnit(s, u, t.to!);
      addTask(s, { kind: 'transfer', roles: [...WMS.keepers], unit: u.id, from: { kind: 'slot', id: t.to! }, work: TRANSFER_WORK, prio: MES_PRIO.transfer, batch: t.batch });
      return true;
    }
    case 'transfer': {
      // тара комплекта — на пластиковую паллету; деревянная — обратно на стеллаж или, пустая, из учёта
      const b = s.batches[t.batch!];
      const h = holderOf(b);
      const u = s.units[t.unit!];
      const kit = s.units[h.kitUnit!];
      const mine = new Set(h.kit.map(k => k.container));
      for (const cid of u.items.filter(c => mine.has(c))) {
        s.containers[cid].unit = kit.id;
        kit.items.push(cid);
      }
      u.items = u.items.filter(c => !mine.has(c));
      afterUnload(db, s, u);
      kitStep(db, s, b);
      return true;
    }
    case 'return': {
      // остаток одной партии — на деревянную паллету в шлюзе и на стеллаж; следующая партия — следующей задачей
      const kit = s.units[t.unit!];
      const lot = s.containers[kit.items[0]].lot;
      const items = kit.items.filter(c => s.containers[c].lot === lot);
      const w: Unit = { id: nextId(s, 'U'), type: 'unit.pallet.euro', where: { kind: 'slot', id: t.to! }, items, tag: 'released' };
      s.units[w.id] = w;
      putUnit(s, w, t.to!);
      for (const cid of items) s.containers[cid].unit = w.id;
      kit.items = kit.items.filter(c => s.containers[c].lot !== lot);
      afterUnload(db, s, w);
      stockChanged(s);
      if (kit.items.length > 0) returnTask(db, s, kit, t.batch!);
      else {
        // чей это комплект — серии или упаковки — видно по паллете
        const b = s.batches[t.batch!];
        delete s.units[kit.id];
        if (b.kitUnit === kit.id) delete b.kitUnit;
        else if (b.pack?.kitUnit === kit.id) delete b.pack.kitUnit;
      }
      return true;
    }
    case 'clean': {
      const room = s.rooms[t.room!];
      room.status = 'clean';
      room.since = s.t;
      if (room.major) delete room.cleanFor;
      else if (room.product) room.cleanFor = room.product;
      delete room.major;
      return true;
    }
    case 'stage':
      stageDone(db, s, plan, t, notices);
      return true;
    default:
      return false;
  }
}

/** Деревянная паллета после перекладки: пустая — из учёта, иначе — на стеллаж ближе к шлюзу. */
function afterUnload(db: ContentDb, s: PlantState, u: Unit) {
  if (u.where.kind !== 'slot') return;
  const plan = planOf(db, s.plant);
  if (u.items.length === 0) {
    delete s.slots[u.where.id].unit;
    delete s.units[u.id];
    return;
  }
  const gate = plan.byKind.staging[0];
  addTask(s, { kind: 'putaway', roles: [...WMS.movers], veh: [...WMS.floor], unit: u.id, from: { kind: 'slot', id: u.where.id }, toKind: 'storage', near: { x: gate.x, z: gate.z }, work: 0, prio: PRIO.putaway });
}

export function returnTask(db: ContentDb, s: PlantState, kit: Unit, batch: string) {
  const plan = planOf(db, s.plant);
  const room = (kit.where as { id: string }).id;
  addTask(s, { kind: 'return', roles: [...WMS.keepers], unit: kit.id, from: roomPlace(plan, room), toKind: 'staging', work: TRANSFER_WORK, prio: MES_PRIO.return, batch });
}

/** Стадия кончилась: досье — режимы, масса, показатели, МОК; помещение и оборудование; следующая стадия или балк. */
function stageDone(db: ContentDb, s: PlantState, plan: PlantPlan, t: Task, notices: Notice[]) {
  const b = s.batches[t.batch!];
  const r = db.recipes[b.recipe];
  const st = r.stages[b.stage];
  const roomId = b.room!;
  const eqs = stageEquipment(s, b, st);
  addEnergy(s, eqs.reduce((w, e) => w + db.equipment[e.type].kw, 0), s.t - t.times![1]);
  const rec: StageRecord = { stage: st.id, room: roomId, start: b.run?.start ?? t.times![1], end: s.t, people: [...(b.run?.people ?? t.people)], equipment: eqs.map(e => e.id), params: {}, in: b.mass, out: b.mass, loss: 0, ipc: [] };
  // узлы: наработка остатка стадии; средний износ за стадию и простои — в досье. Запас кончился на последней таблетке —
  // стадия кончилась, узел отказывает после неё
  const worn: Part[] = [];
  if (b.run) {
    const run = b.run;
    syncStage(db, s, b, run.left);
    rec.wear = {};
    for (const [k, sum] of Object.entries(run.wear)) rec.wear[k] = run.units > 0 ? Math.round(sum / (2 * run.units)) : 0;
    if (run.stops.length > 0) rec.stops = run.stops.map(x => ({ part: x.part, from: x.from, to: x.to ?? s.t }));
    for (const pt of stageParts(db, s, b)) if (pt.state === 'ok' && pt.budget <= 0) worn.push(pt);
    delete b.run;
  }
  // режимы: цель + разброс от серии к серии; у опытного аппаратчика разброс меньше (навык 3 — как в карте)
  const skill = s.people[t.people[0]].skill;
  if (st.params.length > 0) {
    roll(s, `mes/${roomId}`, rng => {
      for (const p of st.params) rec.params[p.id] = p.target + spread(Math.floor((p.sd * (6 - skill)) / 3), normal(rng));
    });
    for (const p of st.params) {
      const v = rec.params[p.id];
      if (v < p.range[0] || v > p.range[1]) deviate(s, notices, { kind: 'param', batch: b.id, stage: st.id, param: p.id });
    }
  }
  if (b.stage === 0) {
    dispense(s, b, rec);
    afterDispense(db, s, b);
  } else if (st.loss[0] > 0) {
    const share = Math.max(0, st.loss[0] + roll(s, `mes/${roomId}`, rng => spread(st.loss[1], normal(rng))));
    rec.loss = Math.min(rec.in, Math.floor((rec.in * share) / P_ONE));
    rec.out = rec.in - rec.loss;
  }
  b.mass = rec.out;
  b.records.push(rec);
  // истинные показатели: те, что контролирует МОК этой стадии, а на последней — все остальные
  const last = b.stage === r.stages.length - 1;
  const attrs = (Object.keys(r.quality) as Attr[]).filter(a => last || st.ipc.some(c => db.tests[c.test].attr === a));
  truthOf(db, s, b, attrs, st.id);
  ipc(db, s, b, st, rec, notices);
  for (const pt of worn) failPart(db, s, pt, notices, b.id);
  // оборудование свободно; помещение — грязное, если серия из него уходит
  for (const e of eqs) delete e.batch;
  const next = r.stages[b.stage + 1];
  if (!next || plan.roomOf[next.room] !== roomId) leave(db, s, roomId, b.product);
  b.stage++;
  if (last) finish(db, s, plan, b, rec, notices);
  else tryStart(db, s, b);
}

/** Отвешивание: навески списываются с тары комплекта; пустая тара — из учёта, остаток — обратно на склад. */
function dispense(s: PlantState, b: Batch, rec: StageRecord) {
  const kit = s.units[b.kitUnit!];
  let total = 0;
  for (const k of b.kit) {
    const c = s.containers[k.container];
    c.qty -= k.qty;
    c.reserved = (c.reserved ?? 0) - k.qty;
    if (c.reserved === 0) delete c.reserved;
    c.opened = true;
    s.lots[k.lot].used += k.qty;
    b.dispensed.push({ ...k });
    total += k.qty;
  }
  for (const cid of kit.items.filter(c => s.containers[c].qty === 0)) delete s.containers[cid];
  kit.items = kit.items.filter(c => s.containers[c]);
  b.kit = [];
  rec.in = 0;
  rec.out = total;
}

/** Серия уходит из помещения: грязное, с продуктом серии; уборка — сразу (политика мастера по умолчанию). */
function leave(db: ContentDb, s: PlantState, roomId: string, product: Id) {
  const room = s.rooms[roomId];
  room.status = 'dirty';
  delete room.batch;
  room.since = s.t;
  room.product = product;
  ensureCleaning(db, s, room);
}

/**
 * Истинные показатели серии: номинал карты + разброс серии + вклады причин из каталога (content/causes/). Каждый вклад
 * записан с весом и стадией — их потом ищет расследование. Знает их только движок.
 */
function truthOf(db: ContentDb, s: PlantState, b: Batch, attrs: Attr[], stage: string) {
  const r = db.recipes[b.recipe];
  for (const a of attrs) {
    if (b.truth[a] !== undefined) continue;
    const [nominal, sd] = r.quality[a]!;
    const noise = roll(s, 'mes/quality', rng => spread(sd, normal(rng)));
    b.noise[a] = noise;
    let v = nominal + noise;
    for (const c of Object.values(db.causes)) {
      for (const e of c.effects) {
        if (e.attr !== a) continue;
        const d = driver(db, s, b, c.driver);
        const delta = d ? Math.round(e.coef * d) : 0;
        if (delta === 0) continue;
        v += delta;
        b.causes.push({ cause: c.id, attr: a, delta, stage: causeStage(db, b, c.driver, stage) });
      }
    }
    b.truth[a] = clampAttr(a, v);
  }
}

/** Значение в пределах смысла: доля от целого — 0–100 %, остальное — не меньше нуля. */
export function clampAttr(a: Attr, v: number): number {
  return Math.max(0, ATTRS[a].whole ? Math.min(P_ONE, v) : v);
}

/** Отход источника причины от цели, в единицах движка; источника ещё нет — 0. */
function driver(db: ContentDb, s: PlantState, b: Batch, d: CauseDriver): number {
  const r = db.recipes[b.recipe];
  if ('param' in d) {
    for (const rec of b.records) {
      if (rec.params[d.param] === undefined) continue;
      const p = r.stages.find(x => x.id === rec.stage)!.params.find(x => x.id === d.param)!;
      return rec.params[d.param] - p.target;
    }
    return 0;
  }
  if ('potency' in d) {
    // действующего вещества отвешено столько, сколько дало истинное содержание, против того, что ждал завод
    let real = 0;
    let planned = 0;
    for (const x of b.dispensed) {
      if (x.assay === undefined) continue;
      real += x.qty * (s.lots[x.lot].truth.assay ?? P_ONE);
      planned += x.qty * x.assay;
    }
    return planned > 0 ? Math.round(((real - planned) * P_ONE) / planned) : 0;
  }
  if ('wear' in d) {
    // средний износ узла за стадию: у оборудования, на котором он стоит
    for (const rec of b.records) for (const [k, w] of Object.entries(rec.wear ?? {})) if (k.endsWith(`/${d.wear}`)) return w;
    return 0;
  }
  if ('lots' in d) {
    // среднее по массе отклонение свойства отвешенных партий этого вида от среднего материала
    let sum = 0;
    let mass = 0;
    for (const x of b.dispensed) {
      const m = db.materials[x.material];
      const mean = m.props[d.attr]?.[0];
      const v = s.lots[x.lot].truth[d.attr];
      if (m.kind !== d.lots || mean === undefined || v === undefined) continue;
      sum += x.qty * (v - mean);
      mass += x.qty;
    }
    return mass > 0 ? Math.round(sum / mass) : 0;
  }
  const v = b.truth[d.attr];
  return v === undefined ? 0 : v - r.quality[d.attr]![0];
}

function causeStage(db: ContentDb, b: Batch, d: CauseDriver, stage: string): string {
  const r = db.recipes[b.recipe];
  if ('param' in d) return r.stages.find(st => st.params.some(p => p.id === d.param))?.id ?? stage;
  if ('potency' in d || 'lots' in d) return r.stages[0].id;
  if ('wear' in d) return b.records.find(rec => Object.keys(rec.wear ?? {}).some(k => k.endsWith(`/${d.wear}`)))?.stage ?? stage;
  return stage;
}

/**
 * МОК стадии: через равные промежутки работы (простои после отказов не в счёт) или раз в конце — измерение истины с
 * погрешностью; с изношенными узлами — ещё и разброс по ходу стадии (запись узла, при износе 100 %). Вне пределов —
 * отклонение.
 */
function ipc(db: ContentDb, s: PlantState, b: Batch, st: RecipeStage, rec: StageRecord, notices: Notice[]) {
  const stopped = (rec.stops ?? []).reduce((n, x) => n + x.to - x.from, 0);
  // момент `k`-го замера: от начала стадии плюс простои до него
  const at = (work: number) => {
    let t = rec.start + work;
    for (const stop of rec.stops ?? []) if (stop.from <= t) t += stop.to - stop.from;
    return Math.min(rec.end, t);
  };
  for (const c of st.ipc) {
    const m = db.tests[c.test];
    const n = c.every ? Math.max(1, Math.floor((rec.end - rec.start - stopped) / c.every)) : 1;
    let extra = 0;
    for (const [k, w] of Object.entries(rec.wear ?? {})) extra += Math.floor(((partType(db, s.parts[k]).scatter?.[m.attr] ?? 0) * w) / P_ONE);
    let out = false;
    for (let k = 1; k <= n; k++) {
      let result = measure(s, `ipc/${rec.room}`, b.truth[m.attr] ?? 0, m.sd);
      if (extra > 0) result += roll(s, `ipc/${rec.room}`, r => spread(extra, normal(r)));
      const pass = within({ test: c.test, min: c.min, max: c.max }, result);
      rec.ipc.push({ test: c.test, t: c.every ? at(k * c.every) : rec.end, result, pass });
      if (!pass) out = true;
    }
    if (out) deviate(s, notices, { kind: 'ipc', batch: b.id, stage: st.id, test: c.test });
  }
}

/** Последняя стадия: таблеток — масса / средняя масса; выход; балк — партия полупродукта в карантине на промежуточном складе. */
function finish(db: ContentDb, s: PlantState, plan: PlantPlan, b: Batch, rec: StageRecord, notices: Notice[]) {
  const r = db.recipes[b.recipe];
  const tablet = (r.batch.mass * (b.truth.mass ?? P_ONE)) / (r.batch.units * P_ONE);
  const units = Math.floor(b.mass / tablet);
  b.units = units;
  if ((units * P_ONE) / r.batch.units < r.yield.alarm) deviate(s, notices, { kind: 'yield', batch: b.id, stage: rec.stage });
  const bulkRoom = plan.roomOf.bulk;
  const code = `${String(b.code.y).padStart(2, '0')}${String(b.code.m).padStart(2, '0')}${String(b.code.n).padStart(2, '0')}`;
  const { lot } = createLot(db, s, {
    material: r.bulk,
    supplier: 'plant',
    qty: units,
    status: 'quarantine',
    where: () => ({ kind: 'room', id: bulkRoom }),
    exact: true,
    truth: { ...b.truth },
    unitType: 'unit.pallet.plastic',
    vendorLot: code,
  });
  lot.batch = b.id;
  b.bulk = lot.id;
  b.status = 'bulk';
  delete b.room;
  notices.push({ kind: 'batchBulk', batch: b.id, lot: lot.id });
}

/** После отвешивания: остаток начатой тары — обратно на склад, по партии за раз. */
function afterDispense(db: ContentDb, s: PlantState, b: Batch) {
  const kit = b.kitUnit ? s.units[b.kitUnit] : undefined;
  if (!kit) return;
  if (kit.items.length > 0) returnTask(db, s, kit, b.id);
  else {
    delete s.units[kit.id];
    delete b.kitUnit;
  }
}
