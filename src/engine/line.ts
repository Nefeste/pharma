// Упаковочная линия (docs/specs/2026-10-engine.md, 1г; геймдизайн, §5.6–5.8; ADR 0003): поток между событиями —
// блистерная → картонажная с маркировкой → укладка в гофроящики; накопители, микроостановки, брак камер, коды пачек в
// ящиках, паллеты ГП, переналадка и очистка линии, смена у линии, конец серии со сверкой, время машин для OEE. Узлы
// машин (1е): наработка — штуками машины, отказ — граница отрезка, авария до конца ремонта, микроостановки чаще с
// износом; заминки картонажной портят пачки. Задание на упаковку и комплект материалов — mes.ts; ремонт — maint.ts;
// проверка ГП и выпуск — qa.ts.
//
// Счёт — в шестидесятых долях таблетки: позиция машины — сколько таблеток прошло через неё за задание, скорость —
// таблеток в минуту, то есть долей в секунду. Накопитель после машины — разность позиций соседей. Блистеры, пачки и
// ящики — формулы от позиций; брак — счётом: из первых n штук годных n − ⌊n × доля⌋.
import type { ContentDb, Id, Sku } from '../content/types';
import { lineUnfit } from './assets';
import { batchNo } from './batchno';
import { addEnergy } from './cash';
import { schedule } from './core/agenda';
import { civilFromDays, daysFromCivil, MIN, momentOf } from './core/calendar';
import { P_ONE } from './core/rng';
import { changedOver, defect, lineDay, NO_TIMES } from './lean';
import { coversOn } from './leave';
import { blocked, consume, failPart, partsOf, partType, pending, untilFail, wearAt } from './maint';
import { deviate, leaveRoom, returnTask, roomFor } from './mes';
import { fastFactor, machineSpeed, speedOf } from './modes';
import { type PlantPlan, planOf, type Point } from './plant';
import { expo, roll } from './random';
import { shiftEnd } from './staff';
import { containersByLot, emptyLot, nextId, slotFree, stockChanged } from './stock';
import { addTask, dropTask } from './tasks';
import type { Batch, Container, Line, LineMachine, MachineTimes, Notice, PackJob, Part, PlantState, Task, Unit } from './types';
import { PRIO, WMS } from './wms';

/** Шестидесятые доли таблетки: скорость в таблетках в минуту × секунды — целое. */
export const SIXTY = 60;

/** Ящики и паллеты появляются не реже раза в 10 минут работы линии (спецификация 1г). */
export const TICK = 10 * MIN;

/** Очистка линии — два упаковщика по процедуре, потом проверка мастера (GMP ЕАЭС, ч. I, п. 5.50); балк к линии — оператор. */
export const CLEAR_WORK = 30 * MIN;
export const CHECK_WORK = 10 * MIN;
export const FEED_WORK = 10 * MIN;

/** Расхождение сверки печатных материалов больше этой доли — отклонение (гипотеза: числа правила не задают). */
export const RECON_LIMIT = 50;

export const LINE = { setters: ['role.setter'], cleaners: ['role.packer'], checkers: ['role.master'], feeders: ['role.line-operator'] } as const;

/** Смена у линии — раньше всего, что ещё делают те же люди; балк и очистка — раньше переналадки. */
export const LINE_PRIO = { crew: 40, feed: 33, clearance: 32, clearCheck: 32, changeover: 30 } as const;


/** Годных из первых `n` при доле брака `p` (1/10 000): бракуется каждая (1/p)-я штука. */
export function good(n: number, p: number): number {
  return n - Math.floor((n * p) / P_ONE);
}

/** Наименьшее n, у которого годных не меньше `g`. */
export function need(g: number, p: number): number {
  if (g <= 0) return 0;
  let n = Math.ceil((g * P_ONE) / (P_ONE - p));
  while (n > 0 && good(n - 1, p) >= g) n--;
  return n;
}

/** Линия задания: позиция, машины по виду, накопители и брак в долях позиции. */
export interface Geo {
  sku: Sku;
  /** таблеток в штуке машины: блистер или пачка */
  unit: number[];
  /** паспорт, долей в секунду: от него OEE считает потерю скорости (Б1ж) */
  nominal: number[];
  /** ход по уставке, долей в секунду: у блистерной — скорость задания, у прочих — паспорт (Б1ж) */
  speed: number[];
  /**
   * микроостановки: ход по цели инструкции, долей в секунду, — от него средний проход между ними; во сколько чаще
   * на штуку по скорости задания, доли 1/10 000 на 10 000 (Б1ж)
   */
  base: number[];
  stops: number[];
  /** ёмкость накопителя после машины, долей */
  cap: number[];
  /** брак блистерной и картонажной, доли 1/10 000 */
  rej: [number, number];
  perCase: number;
  perPallet: number;
  /** зона паллетирования и точка линии */
  out: string;
  at: Point;
}

export function geo(db: ContentDb, s: PlantState, line: Line, job: Pick<PackJob, 'sku' | 'speed'>): Geo {
  const plan = planOf(db, s.plant);
  const def = plan.plant.lines.find(l => l.id === line.id)!;
  const sku = db.skus[job.sku];
  const types = def.machines.map(m => db.machines[m.type]);
  const unit = types.map(m => (m.item === 'blister' ? sku.perBlister : sku.perBlister * sku.blisters));
  const speed = def.machines.map(m => machineSpeed(db, s, m.type, job));
  // уставка скорости (Б1ж): быстрее цели инструкции — микроостановок на штуку и брака камеры больше
  const fast = (i: number, k: 'micro' | 'reject') => (types[i].fast ? fastFactor(types[i].fast![k], speed[i], sku.speed.target) : P_ONE);
  return {
    sku,
    unit,
    nominal: types.map((m, i) => m.nominal * unit[i]),
    speed: speed.map((v, i) => v * unit[i]),
    base: types.map((m, i) => (m.fast ? sku.speed.target : m.nominal) * unit[i]),
    stops: types.map((_, i) => fast(i, 'micro')),
    cap: def.machines.slice(0, -1).map((m, i) => m.buffer! * unit[i] * SIXTY),
    rej: [Math.floor((types[0].reject * fast(0, 'reject')) / P_ONE), Math.floor((types[1].reject * fast(1, 'reject')) / P_ONE)],
    perCase: sku.case.per,
    perPallet: sku.pallet.cases,
    out: def.out,
    at: plan.room[def.room],
  };
}

/** Штук машины `i` (блистеров или пачек), прошедших её позицию, — её наработка за задание. */
const itemsAt = (g: Geo, i: number, pos: number) => Math.floor(pos / (g.unit[i] * SIXTY));

/** Блистеров, прошедших позицию; пачек из них; годных пачек; позиция, на которой годных пачек становится `n`. */
const blistersAt = (g: Geo, pos: number) => Math.floor(pos / (g.unit[0] * SIXTY));
const cartonsAt = (g: Geo, pos: number) => Math.floor(good(blistersAt(g, pos), g.rej[0]) / g.sku.blisters);
const goodCartonsAt = (g: Geo, pos: number) => good(cartonsAt(g, pos), g.rej[1]);
const posForGood = (g: Geo, n: number) => need(need(n, g.rej[1]) * g.sku.blisters, g.rej[0]) * g.unit[0] * SIXTY;

/** Линии по плану: свободны, не налажены, не очищены — очистка перед каждым заданием, первым тоже (Б1е; п. 5.50). */
export function newLines(db: ContentDb, plantId: string, t: number): Record<string, Line> {
  const out: Record<string, Line> = {};
  for (const l of planOf(db, plantId).plant.lines) {
    out[l.id] = {
      id: l.id,
      clear: false,
      machines: l.machines.map(m => ({ id: m.id, type: m.type, pos: 0, rate: 0, state: 'idle', next: 0, times: { ...NO_TIMES } })),
      cases: 0,
      t,
      v: 0,
      idle: 0,
      packs: 0,
      made: 0,
    };
  }
  return out;
}

const tasksOf = (s: PlantState, line: Line, kind: Task['kind']) => Object.values(s.tasks).filter(t => t.kind === kind && t.line === line.id);

/** Помещение линии по плану. */
const roomOfLine = (db: ContentDb, s: PlantState, line: Line) => planOf(db, s.plant).plant.lines.find(l => l.id === line.id)!.room;

/**
 * Помещение линии — чистое для продукта задания (Б1е; геймдизайн, §5.5): иначе уборка — по правилу помещений
 * производства, а линию после неё очищают снова.
 */
function roomReady(db: ContentDb, s: PlantState, line: Line, b: Batch): boolean {
  if (roomFor(db, s, s.rooms[roomOfLine(db, s, line)], b.product, b.id)) return true;
  line.clear = false;
  return false;
}

/** Роли смены у линии: у каждой — сколько людей и какие машины. */
function crews(db: ContentDb, line: Line): { role: Id; n: number; machines: number[] }[] {
  const out: { role: Id; n: number; machines: number[] }[] = [];
  line.machines.forEach((mc, i) => {
    const c = db.machines[mc.type].crew;
    const row = out.find(r => r.role === c.role);
    if (row) {
      row.n += c.n;
      row.machines.push(i);
    } else out.push({ role: c.role, n: c.n, machines: [i] });
  });
  return out;
}

/** Где стоит смена роли: у первой её машины (docs/specs/2026-10-view.md, 2а) — середина следа машины по плану. */
function crewPoint(db: ContentDb, s: PlantState, line: Line, role: Id): Point {
  const def = planOf(db, s.plant).plant.lines.find(l => l.id === line.id)!;
  const i = crews(db, line).find(r => r.role === role)!.machines[0];
  return { x: def.machines[i].at[0], z: def.machines[i].at[1] };
}

/** Есть ли у линии смена этой роли: задача занята и люди дошли. */
function crewHere(s: PlantState, line: Line, role: Id): boolean {
  return tasksOf(s, line, 'crew').some(t => t.roles[0] === role && t.state === 'busy' && t.times![1] <= s.t);
}

/**
 * Идёт ли сейчас смена у кого-нибудь из этой роли или у того, кто её сегодня замещает (Б4г), — иначе время линии не
 * плановое.
 */
function shiftOn(db: ContentDb, s: PlantState, role: Id): boolean {
  if (Object.values(s.people).some(p => p.role === role && shiftEnd(db, s, p) !== undefined)) return true;
  for (const [who, roles] of coversOn(s, momentOf(s.start, s.t).day)) if (roles.includes(role) && shiftEnd(db, s, s.people[who]) !== undefined) return true;
  return false;
}

/** Места зоны паллетирования линии: свободные — по порядку плана. */
function palletSlots(plan: PlantPlan, s: PlantState, g: Geo): string[] {
  return (plan.byKind.palletizing ?? []).filter(sl => sl.group === g.out && slotFree(s, sl.id)).map(sl => sl.id);
}

/** Сколько ящиков ещё можно уложить: в собираемую паллету и на свободные места. */
function placeable(plan: PlantPlan, s: PlantState, line: Line, g: Geo): number {
  const cur = line.pallet ? g.perPallet - s.units[line.pallet].items.length : 0;
  return cur + palletSlots(plan, s, g).length * g.perPallet;
}

// ---------------------------------------------------------------- поток

/** Время машины за отрезок — в её время за задание или в сутки линии: при номинале и подрезке в последней секунде — секунда «медленнее». */
function account(t: MachineTimes, mc: LineMachine, dt: number, out: number) {
  t.out += out;
  if (mc.state === 'run') {
    if (out === mc.rate * dt) t.run += dt;
    else {
      t.run += dt - 1;
      t.slow += 1;
      t.slowOut += out - mc.rate * (dt - 1);
    }
  } else if (mc.state === 'slow') {
    t.slow += dt;
    t.slowOut += out;
  } else if (mc.state !== 'idle') t[mc.state] += dt;
}

/**
 * Прожить поток линии до `to` со скоростями отрезка. Граница отрезка — вверх до секунды, поэтому в последней секунде
 * позиции подрезаются ограничениями: балк, места для ящиков, накопитель не ниже нуля и не выше ёмкости.
 */
function advance(db: ContentDb, s: PlantState, line: Line, to: number) {
  const dt = to - line.t;
  if (dt <= 0) return;
  const b = line.batch ? s.batches[line.batch] : undefined;
  const job = b?.pack;
  const m = line.machines;
  if (!job) {
    line.idle += dt;
    line.t = to;
    return;
  }
  const g = geo(db, s, line, job);
  // сутки линии (3в): отрезок — в сутки, в которые он начался; полночь он не переходит — в 00:00 линии досчитаны часом
  const day = lineDay(s, line.id, m.length, line.t);
  const load = (mc: LineMachine, i: number) => {
    if (mc.state === 'off' || mc.state === 'idle') return;
    day.ideal[i] += g.nominal[i] * dt;
    if (mc.state !== 'fail' && mc.state !== 'setup') day.run[i] += g.nominal[i] * dt;
  };
  if (job.state !== 'running') {
    m.forEach((mc, i) => {
      account(mc.times, mc, dt, 0);
      account(day.times[i], mc, dt, 0);
      load(mc, i);
    });
    line.t = to;
    return;
  }
  // энергия: машины на номинале и медленнее
  addEnergy(s, m.reduce((w, mc) => w + (mc.state === 'run' || mc.state === 'slow' ? db.machines[mc.type].kw : 0), 0), dt);
  const last = m[m.length - 1];
  const from = last.pos;
  const next = project(db, s, line, job, g, dt);
  m.forEach((mc, i) => {
    account(mc.times, mc, dt, next[i] - mc.pos);
    account(day.times[i], mc, dt, next[i] - mc.pos);
    load(mc, i);
    mc.pos = next[i];
  });
  day.good += (goodCartonsAt(g, last.pos) - goodCartonsAt(g, from)) * g.sku.blisters * g.sku.perBlister * SIXTY;
  const t0 = line.t;
  line.t = to;
  materialize(db, s, line, g, b!, (pos: number) => (last.rate > 0 ? Math.min(to, t0 + Math.ceil((pos - from) / last.rate)) : to));
}

/**
 * Позиции машин через `dt` секунд со скоростями отрезка, подрезанные ограничениями: балк, места для ящиков, накопитель
 * не ниже нуля и не выше ёмкости. Состояние не меняется.
 */
function project(db: ContentDb, s: PlantState, line: Line, job: PackJob, g: Geo, dt: number): number[] {
  const plan = planOf(db, s.plant);
  const m = line.machines;
  const n = m.length;
  const next = m.map(mc => mc.pos + mc.rate * dt);
  next[0] = Math.min(next[0], job.tablets * SIXTY);
  for (let i = 1; i < n; i++) next[i] = Math.min(next[i], next[i - 1]);
  next[n - 1] = Math.min(next[n - 1], posForGood(g, (line.cases + placeable(plan, s, line, g)) * g.perCase));
  for (let i = n - 2; i >= 0; i--) next[i] = Math.min(next[i], next[i + 1] + g.cap[i]);
  return next;
}

/**
 * Позиции машин линии в момент `t` — тот же поток, что `advance`, без записи в состояние (срез окну, 2в). Линия считана
 * до `line.t`; до следующей границы отрезка скорости не меняются, поэтому позиции между событиями — прямая.
 */
export function flowAt(db: ContentDb, s: PlantState, line: Line, t: number): number[] {
  const job = line.batch ? s.batches[line.batch]?.pack : undefined;
  if (t <= line.t || !job || job.state !== 'running') return line.machines.map(mc => mc.pos);
  return project(db, s, line, job, geo(db, s, line, job), t - line.t);
}

/** Коды выбракованных пачек и уложенные ящики — до текущих позиций. Время ящика — когда укладка дошла до его последней пачки. */
function materialize(db: ContentDb, s: PlantState, line: Line, g: Geo, b: Batch, when: (pos: number) => number) {
  const job = b.pack!;
  const m = line.machines;
  // камера картонажной: пачка, после которой годных не прибавилось, — брак; её код — в список брака
  const made = cartonsAt(g, m[1].pos);
  for (let j = job.checked; j < made; j++) if (good(j + 1, g.rej[1]) === good(j, g.rej[1])) job.rejected.push(j + 1);
  job.checked = Math.max(job.checked, made);
  // годных пачек за задание до этой позиции — выпуск смены считает от него (1ж)
  line.made = goodCartonsAt(g, m[m.length - 1].pos);
  const full = Math.floor(line.made / g.perCase);
  while (line.cases < full) {
    const n = line.cases;
    makeCase(db, s, line, g, b, n * g.perCase, g.perCase, when(posForGood(g, (n + 1) * g.perCase)));
  }
}

/** Отрезки кодов годных пачек с номерами [first, first + count): пачка j (с нуля) — код j + 1, брак пропускается. */
function codesOf(g: Geo, first: number, count: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = first; k < first + count; k++) {
    const code = need(k + 1, g.rej[1]);
    const r = out[out.length - 1];
    if (r && r[0] + r[1] === code) r[1]++;
    else out.push([code, 1]);
  }
  return out;
}

/** Ящик ГП на паллету в зоне паллетирования; полная паллета едет в карантин ГП. */
function makeCase(db: ContentDb, s: PlantState, line: Line, g: Geo, b: Batch, first: number, count: number, made: number) {
  const job = b.pack!;
  const lot = s.lots[job.fg!];
  let u = line.pallet ? s.units[line.pallet] : undefined;
  if (!u) {
    const slot = palletSlots(planOf(db, s.plant), s, g)[0];
    if (!slot) throw new Error(`line ${line.id}: no palletizing slot`);
    u = { id: nextId(s, 'U'), type: 'unit.pallet.euro', where: { kind: 'slot', id: slot }, items: [], tag: 'quarantine' };
    s.units[u.id] = u;
    s.slots[slot] = { unit: u.id };
    line.pallet = u.id;
  }
  const c: Container = { id: nextId(s, 'C'), lot: lot.id, type: db.materials[lot.material].container, qty: count, unit: u.id, opened: false, codes: codesOf(g, first, count), made };
  s.containers[c.id] = c;
  u.items.push(c.id);
  lot.qty += count;
  line.cases++;
  if (u.items.length >= g.perPallet) palletDone(s, line, u);
}

function palletDone(s: PlantState, line: Line, u: Unit) {
  delete line.pallet;
  const from = u.where as { kind: 'slot'; id: string };
  addTask(s, { kind: 'putaway', roles: [...WMS.movers], veh: [...WMS.floor], unit: u.id, from, toKind: 'fgQuarantine', work: 0, prio: PRIO.putaway, lot: s.containers[u.items[0]].lot, line: line.id });
}

// ---------------------------------------------------------------- скорости и события

/**
 * Скорости нового отрезка (спецификация 1г): каждая работающая машина берёт номинал; проход вперёд — у машины с пустым
 * накопителем перед ней скорость не больше подачи; проход назад — у машины с полным накопителем после неё скорость не
 * больше отбора. Двух проходов достаточно: накопитель не бывает пуст и полон сразу.
 */
function solve(db: ContentDb, s: PlantState, line: Line) {
  const b = line.batch ? s.batches[line.batch] : undefined;
  const job = b?.pack;
  const m = line.machines;
  if (!job || job.state !== 'running') {
    for (const mc of m) {
      mc.rate = 0;
      mc.state = !job ? 'idle' : shiftOn(db, s, db.machines[mc.type].crew.role) ? 'setup' : 'off';
    }
    return;
  }
  const g = geo(db, s, line, job);
  const plan = planOf(db, s.plant);
  const n = m.length;
  m.forEach((mc, i) => {
    const role = db.machines[mc.type].crew.role;
    if (!crewHere(s, line, role)) {
      mc.state = !shiftOn(db, s, role) ? 'off' : mc.broken ? 'fail' : 'wait';
      mc.rate = 0;
    } else if (mc.broken) {
      mc.state = 'fail';
      mc.rate = 0;
    } else if (mc.down !== undefined) {
      mc.state = 'micro';
      mc.rate = 0;
    } else {
      mc.state = 'run';
      mc.rate = g.speed[i];
    }
  });
  if (m[0].pos >= job.tablets * SIXTY) m[0].rate = 0;
  for (let i = 1; i < n; i++) if (m[i - 1].pos - m[i].pos <= 0) m[i].rate = Math.min(m[i].rate, m[i - 1].rate);
  if (m[n - 1].pos >= posForGood(g, (line.cases + placeable(plan, s, line, g)) * g.perCase)) m[n - 1].rate = 0;
  for (let i = n - 2; i >= 0; i--) if (m[i].pos - m[i + 1].pos >= g.cap[i]) m[i].rate = Math.min(m[i].rate, m[i + 1].rate);
  m.forEach((mc, i) => {
    if (mc.state !== 'run') return;
    mc.state = mc.rate === g.speed[i] ? 'run' : mc.rate > 0 ? 'slow' : 'wait';
  });
}

/** Через сколько секунд следующая граница отрезка: накопитель, балк, места для ящиков, микроостановка, отметка. */
function nextBoundary(db: ContentDb, s: PlantState, line: Line): number | undefined {
  const b = line.batch ? s.batches[line.batch] : undefined;
  const job = b?.pack;
  if (!job || job.state !== 'running') return undefined;
  const g = geo(db, s, line, job);
  const plan = planOf(db, s.plant);
  const m = line.machines;
  const n = m.length;
  const up = (rem: number, rate: number) => Math.max(1, Math.ceil(rem / rate));
  let best: number | undefined;
  const take = (x: number) => {
    if (best === undefined || x < best) best = x;
  };
  for (let i = 0; i < n - 1; i++) {
    const lvl = m[i].pos - m[i + 1].pos;
    const net = m[i].rate - m[i + 1].rate;
    if (net > 0 && lvl < g.cap[i]) take(up(g.cap[i] - lvl, net));
    if (net < 0 && lvl > 0) take(up(lvl, -net));
  }
  if (m[0].rate > 0) take(up(job.tablets * SIXTY - m[0].pos, m[0].rate));
  if (m[n - 1].rate > 0) take(up(posForGood(g, (line.cases + placeable(plan, s, line, g)) * g.perCase) - m[n - 1].pos, m[n - 1].rate));
  for (const mc of m) {
    if (mc.rate > 0 && db.machines[mc.type].micro) take(up(mc.next - mc.pos, mc.rate));
    if (mc.rate > 0 && mc.fail !== undefined) take(up(mc.fail - mc.pos, mc.rate));
    if (mc.down !== undefined) take(Math.max(1, mc.down - s.t));
  }
  if (m.some(mc => mc.rate > 0)) take(TICK);
  return best;
}

/**
 * Следующая микроостановка — через случайный проход со средним «раз в `every` секунд на номинале» (ветвь машины). С
 * износом узла они чаще: при износе 100 % — во столько раз, сколько в записи узла (гипотеза).
 */
function drawNext(db: ContentDb, s: PlantState, mc: LineMachine, g: Geo, i: number) {
  const micro = db.machines[mc.type].micro;
  if (!micro) {
    mc.next = Number.MAX_SAFE_INTEGER;
    return;
  }
  let factor = P_ONE;
  for (const pt of partsOf(s, mc.id)) {
    const ty = partType(db, pt);
    if (ty.micro) factor += Math.floor(((ty.micro - P_ONE) * wearAt(ty, pt.done + itemsAt(g, i, mc.pos) - itemsAt(g, i, pt.mark))) / P_ONE);
  }
  factor = Math.max(1, Math.floor((factor * g.stops[i]) / P_ONE));
  mc.next = mc.pos + roll(s, `line/${mc.id}`, r => expo(r, Math.floor((micro.every * g.base[i] * P_ONE) / factor)));
}

/** Наработка узлов машины — до её позиции: запас до отказа расходуется по таблице; учтено до этой позиции. */
function syncParts(db: ContentDb, s: PlantState, mc: LineMachine, g: Geo, i: number) {
  for (const pt of partsOf(s, mc.id)) {
    const n = itemsAt(g, i, mc.pos) - itemsAt(g, i, pt.mark);
    if (n > 0) {
      const ty = partType(db, pt);
      if (pt.state === 'ok') pt.budget -= consume(ty, pt.done, n);
      pt.done += n;
    }
    pt.mark = mc.pos;
  }
}

/** Позиция машины, на которой кончится запас до отказа её исправного узла: на последней штуке — граница отрезка. */
function armParts(db: ContentDb, s: PlantState, mc: LineMachine, g: Geo, i: number) {
  delete mc.fail;
  for (const pt of partsOf(s, mc.id)) {
    if (pt.state !== 'ok') continue;
    const n = untilFail(partType(db, pt), pt.done, pt.budget);
    if (n === Infinity) continue;
    const at = (itemsAt(g, i, pt.mark) + n) * g.unit[i] * SIXTY;
    if (mc.fail === undefined || at < mc.fail) mc.fail = at;
  }
}

/** Заминка картонажной — микроостановка, которая портит пачки с вложениями; изредка испорченное не записывают. */
function jam(db: ContentDb, s: PlantState, mc: LineMachine, g: Geo, job: PackJob) {
  const j = db.machines[mc.type].jam;
  if (!j || (job.jammed ?? 0) + j.cartons > g.sku.waste.jams) return;
  job.jams = (job.jams ?? 0) + 1;
  job.jammed = (job.jammed ?? 0) + j.cartons;
  if (roll(s, `line/${mc.id}`, r => r.chance(j.uncounted))) job.lost = (job.lost ?? 0) + j.cartons;
}

/**
 * Пересчитать линию сейчас: дожить поток, начать и кончить микроостановки, уложить ящики, кончить серию, если всё
 * упаковано; затем скорости нового отрезка и событие его границы.
 */
export function lineUpdate(db: ContentDb, s: PlantState, line: Line, notices: Notice[]) {
  advance(db, s, line, s.t);
  const b = line.batch ? s.batches[line.batch] : undefined;
  const running = b?.pack?.state === 'running';
  // починили — машина снова в работе; посреди задания — со следующим отказом нового узла
  line.machines.forEach((mc, i) => {
    if (!mc.broken || blocked(s, mc.id)) return;
    delete mc.broken;
    if (running) armParts(db, s, mc, geo(db, s, line, b.pack!), i);
  });
  if (running) {
    const g = geo(db, s, line, b!.pack!);
    line.machines.forEach((mc, i) => {
      const micro = db.machines[mc.type].micro;
      // отказ узла: наработка до этой позиции, авария до конца ремонта
      if (!mc.broken && mc.fail !== undefined && mc.pos >= mc.fail) {
        syncParts(db, s, mc, g, i);
        delete mc.fail;
        delete mc.down;
        mc.broken = true;
        for (const pt of partsOf(s, mc.id)) if (pt.state === 'ok' && pt.budget <= 0) failPart(db, s, pt, notices, b!.id);
      }
      if (mc.broken) return;
      if (mc.down !== undefined && mc.down <= s.t) {
        delete mc.down;
        drawNext(db, s, mc, g, i);
      }
      if (micro && mc.down === undefined && mc.pos >= mc.next) {
        mc.down = s.t + roll(s, `line/${mc.id}`, r => Math.max(10, expo(r, micro.duration)));
        jam(db, s, mc, g, b!.pack!);
      }
    });
    finish(db, s, line, g, b!, notices);
  }
  solve(db, s, line);
  line.v++;
  const dt = nextBoundary(db, s, line);
  if (dt !== undefined) schedule(s.agenda, s.t + dt, { kind: 'line', id: line.id, v: line.v });
}

/**
 * Двойник прогона плана (docs/specs/2026-10-plan-run.md): запас до отказа исправных узлов машин линии — от `redraw`. У
 * идущей линии поток доживается до этой минуты, наработка узлов учитывается до позиции машины, затем отказ и следующая
 * микроостановка — заново, и событие границы отрезка — по новым позициям.
 */
export function lineRedraw(db: ContentDb, s: PlantState, line: Line, redraw: (pt: Part) => number, notices: Notice[]) {
  lineUpdate(db, s, line, notices);
  const b = line.batch ? s.batches[line.batch] : undefined;
  const g = b?.pack?.state === 'running' ? geo(db, s, line, b.pack) : undefined;
  line.machines.forEach((mc, i) => {
    if (g) syncParts(db, s, mc, g, i);
    for (const pt of partsOf(s, mc.id)) if (pt.state === 'ok') pt.budget = redraw(pt);
    if (!g) return;
    if (!mc.broken) armParts(db, s, mc, g, i);
    if (mc.down === undefined) drawNext(db, s, mc, g, i);
  });
  if (g) lineUpdate(db, s, line, notices);
}

/** Событие линии: устаревшая версия — ничего; v = −1 (пришла смена) — пересчитать всегда. */
export function lineEvent(db: ContentDb, s: PlantState, id: string, v: number, notices: Notice[]) {
  const line = s.lines[id];
  if (!line || (v !== -1 && v !== line.v)) return;
  lineUpdate(db, s, line, notices);
}

/** Каждый час: смены начинаются и кончаются — время линии из планового становится внеплановым и обратно. */
export function lineHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  for (const line of Object.values(s.lines)) lineUpdate(db, s, line, notices);
}

// ---------------------------------------------------------------- задание на линии

/**
 * Шаг линий: свободная берёт следующее задание с зарезервированными материалами; помещение не чисто для его
 * продукта — уборка, и переналадка на формат позиции идёт вместе с ней (Б1е); в чистом помещении линию очищают, потом
 * она получает балк; когда комплект и балк у линии — смена встаёт к линии. Чистота помещения истекла, пока задание
 * ждёт, — уборка и очистка снова. Зовётся после каждого события.
 */
export function lineStep(db: ContentDb, s: PlantState, notices: Notice[]) {
  // задания на упаковку линии: сколько годных пачек ждать из всех таблеток при браке камер — для сменного задания (1ж)
  for (const b of Object.values(s.batches)) {
    const job = b.pack;
    if (b.status === 'packing' && job && job.expect === undefined && s.lines[job.line]) job.expect = goodCartonsAt(geo(db, s, s.lines[job.line], job), job.tablets * SIXTY);
  }
  for (const line of Object.values(s.lines)) {
    if (!line.batch) {
      const b = Object.values(s.batches).find(x => x.status === 'packing' && x.pack!.line === line.id && x.pack!.taken === undefined && ['reserved', 'kitting', 'ready'].includes(x.pack!.state));
      if (!b) continue;
      lineUpdate(db, s, line, notices);
      line.batch = b.id;
      b.pack!.taken = s.t;
      // скорость блистерной (Б1ж): задание идёт с уставкой инструкции, какой она была, когда линия его взяла; годных пачек
      // ждать — по ней
      b.pack!.speed = speedOf(db, s, b.pack!.sku);
      b.pack!.expect = goodCartonsAt(geo(db, s, line, b.pack!), b.pack!.tablets * SIXTY);
      for (const mc of line.machines) mc.times = { ...NO_TIMES };
      lineUpdate(db, s, line, notices);
    }
    const b = s.batches[line.batch!];
    const job = b.pack!;
    if (job.state === 'running') continue;
    const sku = db.skus[job.sku];
    const g = geo(db, s, line, job);
    // помещение — в уборку, если оно не чисто для продукта задания (Б1е): переналадка идёт вместе с уборкой, очистка
    // линии и балк — после неё
    const ready = roomReady(db, s, line, b);
    // переналадка на формат позиции, потом очистка линии и проверка мастера, потом балк к линии
    if (line.format !== sku.format) {
      if (tasksOf(s, line, 'changeover').length === 0) {
        const work = line.machines.reduce((n, mc) => n + db.machines[mc.type].changeover, 0);
        addTask(s, { kind: 'changeover', roles: [...LINE.setters], from: { kind: 'point', ...g.at }, work: Math.max(work, MIN), prio: LINE_PRIO.changeover, batch: b.id, line: line.id });
      }
      continue;
    }
    if (!ready) continue;
    if (!line.clear) {
      if (tasksOf(s, line, 'clearance').length === 0 && tasksOf(s, line, 'clearCheck').length === 0) {
        addTask(s, { kind: 'clearance', roles: [...LINE.cleaners], count: 2, from: { kind: 'point', ...g.at }, work: CLEAR_WORK, prio: LINE_PRIO.clearance, batch: b.id, line: line.id });
      }
      continue;
    }
    const plan = planOf(db, s.plant);
    const room = roomOfLine(db, s, line);
    const bulk = [...new Set((containersByLot(s).get(b.bulk!) ?? []).map(c => c.unit))].map(id => s.units[id]);
    for (const u of bulk) {
      if ((u.where.kind === 'room' && u.where.id === room) || Object.values(s.tasks).some(t => t.unit === u.id)) continue;
      const at = plan.room[(u.where as { id: string }).id];
      addTask(s, { kind: 'feed', roles: [...LINE.feeders], unit: u.id, from: { kind: 'point', x: at.x, z: at.z }, work: FEED_WORK, prio: LINE_PRIO.feed, batch: b.id, line: line.id });
    }
    if (job.state !== 'ready' || !bulk.every(u => u.where.kind === 'room' && u.where.id === room)) continue;
    // машина в ремонте или вот-вот уйдёт в замену узла — задание ждёт (maint.ts); машина без действующей квалификации или
    // с подрядчиком — тоже (Б3в)
    if (line.machines.some(mc => blocked(s, mc.id) || pending(db, s, mc.id)) || lineUnfit(db, s, line.id)) continue;
    startRun(db, s, line, b, g);
    lineUpdate(db, s, line, notices);
  }
}

/**
 * Первая таблетка: партия ГП в карантине (номер изготовителя — номер серии, срок — пока от даты производства, при
 * выпуске — пересчёт, qa.ts), машины с нуля, смена у линии по ролям.
 */
function startRun(db: ContentDb, s: PlantState, line: Line, b: Batch, g: Geo) {
  const job = b.pack!;
  job.state = 'running';
  job.start = s.t;
  // задание занимает помещение линии до конца (Б1е)
  const room = s.rooms[roomOfLine(db, s, line)];
  room.status = 'busy';
  room.batch = b.id;
  const lot = emptyLot(s, { material: g.sku.fg, vendorLot: batchNo(b.code), batch: b.id, expiry: 0, truth: { ...b.truth } });
  lot.expiry = fgExpiry(prodDay(db, s, b), prodDay(db, s, b), db.materials[g.sku.fg].shelf);
  job.fg = lot.id;
  line.cases = 0;
  line.machines.forEach((mc, i) => {
    mc.pos = 0;
    delete mc.down;
    armParts(db, s, mc, g, i);
    drawNext(db, s, mc, g, i);
  });
  for (const c of crews(db, line)) addCrew(s, line, b, c.role, c.n, crewPoint(db, s, line, c.role));
}

function addCrew(s: PlantState, line: Line, b: Batch, role: Id, n: number, at: Point) {
  addTask(s, { kind: 'crew', roles: [role], count: n, from: { kind: 'point', ...at }, work: 0, prio: LINE_PRIO.crew, batch: b.id, line: line.id });
}

/** День производства (номер от 1970-01-01) — первая операция смешивания субстанции с другими ингредиентами: стадия карты `mix`. */
export function prodDay(db: ContentDb, s: PlantState, b: Batch): number {
  const mix = db.recipes[b.recipe].stages.find(st => st.mix)?.id;
  const rec = b.records.find(r => r.stage === mix) ?? b.records[0];
  return momentOf(s.start, rec?.start ?? s.t).day;
}

/**
 * Срок годности ГП (Рекомендация Коллегии ЕЭК № 2, пп. 4–11): от выпуска, если он не позже 30 дней от производства,
 * иначе от производства. Срок больше 12 месяцев: произведено позднее 15-го — месяц расчёта, иначе предыдущий; годен до
 * последнего дня месяца. Производство ровно 15-го правило не охватывает — берём предыдущий месяц, это строже.
 */
export function fgExpiry(prod: number, release: number, months: number): number {
  const base = civilFromDays(release - prod <= 30 ? release : prod);
  const p = civilFromDays(prod);
  if (months <= 12) {
    let y = base.y;
    let m = base.m + months;
    y += Math.floor((m - 1) / 12);
    m = ((m - 1) % 12) + 1;
    const last = daysFromCivil(m === 12 ? { y: y + 1, m: 1, d: 1 } : { y, m: m + 1, d: 1 }) - 1;
    return Math.min(daysFromCivil({ y, m, d: 1 }) + base.d - 1, last);
  }
  let y = base.y;
  let m = base.m + months - (p.d > 15 ? 0 : 1);
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12) + 1;
  return daysFromCivil(m === 12 ? { y: y + 1, m: 1, d: 1 } : { y, m: m + 1, d: 1 }) - 1;
}

// ---------------------------------------------------------------- конец серии

/**
 * Всё упаковано, когда балк кончился и накопители пусты. Тогда — последний неполный ящик (если есть место), последняя
 * паллета — в карантин ГП; списание по факту, остаток комплекта — на склад; сверка печатных материалов; итог и OEE.
 */
function finish(db: ContentDb, s: PlantState, line: Line, g: Geo, b: Batch, notices: Notice[]) {
  const job = b.pack!;
  const all = job.tablets * SIXTY;
  if (!line.machines.every(mc => mc.pos === all)) return;
  const plan = planOf(db, s.plant);
  const goodCartons = goodCartonsAt(g, all);
  const left = goodCartons - line.cases * g.perCase;
  if (left > 0) {
    if (placeable(plan, s, line, g) === 0) return;
    makeCase(db, s, line, g, b, line.cases * g.perCase, left, s.t);
  }
  if (line.pallet) palletDone(s, line, s.units[line.pallet]);
  // итог по таблеткам: годные пачки, брак камер, остаток (таблетки без блистера, блистер без пары)
  const sku = g.sku;
  const blisters = blistersAt(g, all);
  const goodBlisters = good(blisters, g.rej[0]);
  const cartons = Math.floor(goodBlisters / sku.blisters);
  job.blisters = blisters;
  job.blisterRejects = blisters - goodBlisters;
  job.cartons = cartons;
  job.cartonRejects = cartons - goodCartons;
  job.cases = line.cases;
  job.scrap = job.blisterRejects * sku.perBlister + job.cartonRejects * sku.blisters * sku.perBlister;
  defect(s, 'blisters', job.blisterRejects);
  defect(s, 'cartons', job.cartonRejects);
  job.remainder = job.tablets - blisters * sku.perBlister + (goodBlisters - cartons * sku.blisters) * sku.perBlister;
  book(db, s, b, line, g, notices);
  job.state = 'done';
  job.end = s.t;
  job.oee = line.machines.map((mc, i) => ({ machine: mc.id, nominal: g.nominal[i], times: { ...mc.times } }));
  b.status = 'fg';
  delete line.batch;
  line.clear = false;
  // помещение линии — грязное после серии, уборка сразу, как в помещениях производства (Б1е)
  leaveRoom(db, s, roomOfLine(db, s, line), b.product);
  line.packs += goodCartons;
  line.made = 0;
  for (const t of tasksOf(s, line, 'crew')) {
    worked(job, t.people);
    dropTask(db, s, t);
  }
  line.machines.forEach((mc, i) => {
    syncParts(db, s, mc, g, i);
    for (const pt of partsOf(s, mc.id)) pt.mark = 0;
    mc.pos = 0;
    mc.rate = 0;
    delete mc.down;
    delete mc.fail;
    mc.times = { ...NO_TIMES };
  });
  notices.push({ kind: 'batchPacked', batch: b.id, lot: job.fg! });
}

/** Списание по факту: балк — весь; материалы — из комплекта по строкам; остаток комплекта — на склад. Сверка. */
function book(db: ContentDb, s: PlantState, b: Batch, line: Line, g: Geo, notices: Notice[]) {
  const job = b.pack!;
  const sku = g.sku;
  // балк: все таблетки ушли на линию; пустые контейнеры и паллета балка — из учёта
  const bulk = s.lots[b.bulk!];
  for (const c of containersByLot(s).get(bulk.id) ?? []) {
    bulk.used += c.qty;
    const u = s.units[c.unit];
    u.items = u.items.filter(id => id !== c.id);
    delete s.containers[c.id];
    if (u.items.length === 0) delete s.units[u.id];
  }
  // заминки испортили пачки с вложениями сверх наладки
  const jammed = job.jammed ?? 0;
  const usage = new Map<Id, number>();
  for (const l of sku.blister) usage.set(l.material, (job.blisters! + sku.waste.blisters) * l.qty);
  for (const l of sku.carton) usage.set(l.material, (job.cartons! + sku.waste.cartons + jammed) * l.qty);
  usage.set(sku.case.material, job.cases!);
  // из комплекта: снять резерв строки, списать по факту в её порядке
  const issued = new Map<Id, number>();
  for (const k of job.kit) {
    const c = s.containers[k.container];
    c.reserved = (c.reserved ?? 0) - k.qty;
    if (c.reserved === 0) delete c.reserved;
    issued.set(k.material, (issued.get(k.material) ?? 0) + k.qty);
    const q = Math.min(k.qty, usage.get(k.material) ?? 0);
    usage.set(k.material, (usage.get(k.material) ?? 0) - q);
    if (q === 0) continue;
    c.qty -= q;
    c.opened = true;
    s.lots[k.lot].used += q;
    job.used.push({ ...k, qty: q });
  }
  for (const [material, rest] of usage) if (rest !== 0) throw new Error(`pack ${b.id}: ${material} short by ${rest}`);
  // сверка печатных материалов (пачки и инструкции): выдано = использовано + испорчено + возвращено. Возвращают то, что
  // осталось на самом деле; испорченное — по записям, а незаписанное при заминках в них не попало: расхождение
  const goodCartons = job.cartons! - job.cartonRejects!;
  const spoilt = job.cartonRejects! + sku.waste.cartons + jammed;
  job.recon = sku.carton.map(l => {
    const out = issued.get(l.material) ?? 0;
    const used = goodCartons * l.qty;
    return { material: l.material, issued: out, used, spoiled: (spoilt - (job.lost ?? 0)) * l.qty, returned: out - used - spoilt * l.qty };
  });
  for (const r of job.recon) {
    const gap = Math.abs(r.issued - r.used - r.spoiled - r.returned);
    if (gap * P_ONE > RECON_LIMIT * r.issued) deviate(s, notices, { kind: 'recon', batch: b.id, material: r.material });
  }
  // в записи по упаковке — что выдали (п. 4.21 h): комплекта больше нет, выдача остаётся
  job.issued = job.kit.map(k => ({ ...k }));
  job.kit = [];
  const kit = job.kitUnit ? s.units[job.kitUnit] : undefined;
  if (kit) {
    for (const cid of kit.items.filter(id => s.containers[id].qty === 0)) delete s.containers[cid];
    kit.items = kit.items.filter(id => s.containers[id]);
    if (kit.items.length > 0) returnTask(db, s, kit, b.id);
    else {
      delete s.units[kit.id];
      delete job.kitUnit;
    }
  }
  stockChanged(s);
}

// ---------------------------------------------------------------- задачи линии

/** Что сделала задача линии, когда кончилась. Не задача линии — `false`. */
export function lineDone(db: ContentDb, s: PlantState, t: Task, notices: Notice[]): boolean {
  const line = t.line ? s.lines[t.line] : undefined;
  switch (t.kind) {
    case 'crew': {
      // смена кончилась: линия стоит до следующей; задание идёт — новая смена у линии
      lineUpdate(db, s, line!, notices);
      const b = line!.batch ? s.batches[line!.batch] : undefined;
      const mine = t.batch ? s.batches[t.batch]?.pack : undefined;
      if (mine) worked(mine, t.people);
      if (b && b.id === t.batch && b.pack?.state === 'running' && !tasksOf(s, line!, 'crew').some(x => x.roles[0] === t.roles[0])) {
        addCrew(s, line!, b, t.roles[0], t.count, crewPoint(db, s, line!, t.roles[0]));
      }
      return true;
    }
    case 'changeover': {
      const job = s.batches[t.batch!].pack!;
      line!.format = db.skus[job.sku].format;
      changedOver(s, t.work);
      worked(job, t.people);
      return true;
    }
    case 'clearance': {
      // очистка линии перед заданием (п. 5.50) — в запись по упаковке: кто очищал и когда
      const job = t.batch ? s.batches[t.batch]?.pack : undefined;
      if (job) job.clear = { by: [...t.people], from: t.times?.[1] ?? t.created, to: s.t };
      addTask(s, { kind: 'clearCheck', roles: [...LINE.checkers], from: t.from, work: CHECK_WORK, prio: LINE_PRIO.clearCheck, batch: t.batch, line: t.line });
      return true;
    }
    case 'clearCheck': {
      line!.clear = true;
      const c = t.batch ? s.batches[t.batch]?.pack?.clear : undefined;
      if (c && t.people[0]) {
        c.check = t.people[0];
        c.at = s.t;
      }
      return true;
    }
    case 'feed': {
      const room = planOf(db, s.plant).plant.lines.find(l => l.id === t.line)!.room;
      s.units[t.unit!].where = { kind: 'room', id: room };
      const job = t.batch ? s.batches[t.batch]?.pack : undefined;
      if (job) worked(job, t.people);
      return true;
    }
    default:
      return false;
  }
}

/**
 * Расход материалов задания по счёту машин на мгновение `t` и на наладку по инструкции (Б1д): у блистерной — по
 * отформованным блистерам, у картонажной — по пачкам, у укладки — по ящикам, которые уложены и укладывают. Испорченное
 * при заминках в счёт не входит: его и настоящий остаток считает сверка после задания. Состояние не меняет — для
 * карточки машины.
 */
export function usedByCount(db: ContentDb, s: PlantState, line: Line, t: number): Map<Id, number> {
  const out = new Map<Id, number>();
  const job = jobOf(s, line);
  if (!job || job.state !== 'running') return out;
  const g = geo(db, s, line, job);
  const sku = g.sku;
  const pos = flowAt(db, s, line, t);
  const blisters = blistersAt(g, pos[0]) + sku.waste.blisters;
  const cartons = cartonsAt(g, pos[1]) + sku.waste.cartons;
  for (const l of sku.blister) out.set(l.material, blisters * l.qty);
  for (const l of sku.carton) out.set(l.material, cartons * l.qty);
  // ящик, который укладывают, уже взят из комплекта
  out.set(sku.case.material, Math.ceil(goodCartonsAt(g, pos[pos.length - 1]) / g.perCase));
  return out;
}

/**
 * Кто работал на задание (Б1д): люди работы — в запись по упаковке, без повторов, по порядку. У задания из сохранения
 * до схемы 26 записи нет и не будет: неполный список хуже, чем «не записано».
 */
function worked(job: PackJob, people: readonly string[]) {
  if (!job.people) return;
  for (const p of people) if (!job.people.includes(p)) job.people.push(p);
}

/** Задание, которое линия упаковывает сейчас. */
export function jobOf(s: PlantState, line: Line): PackJob | undefined {
  return line.batch ? s.batches[line.batch].pack : undefined;
}
