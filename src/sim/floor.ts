// Данные на полу (Б1и; docs/specs/2026-10-vertical-slice.md, «Б1и»): помещения производства и упаковки и машины линий
// за окно — сегодня, вчера или 7 суток, по календарным суткам завода, — ключевая машина и OEE той же функцией, что у
// планёрки, и доска «План — факт» у каждой линии. С Б1к — часы ожидания серий у мест за то же окно и «держит линию».
// Только учёт завода — время помещений, машин и серий по состояниям, счётчики годных пачек, сменные задания, записи
// стадий, — без истины (docs/02-architecture.md, §9).
import type { ContentDb, Dept, Id } from '../content/types';
import { batchNo } from '../engine/batchno';
import { DAY, HOUR, momentOf } from '../engine/core/calendar';
import { AREA, NO_ROOM, NO_TIMES, PLANNED, rhythm, roomsOf, taskSpot, taskThing } from '../engine/lean';
import { planOf } from '../engine/plant';
import type { BatchPhase, DayLoss, LineDay, LossKind, MachineTimes, PlantState, RoomPhase, RoomTimes, WaitCause } from '../engine/types';
import { batchRef, type JournalRef, lotRef, personRef } from './journal';
import { thingOf } from './places';
import { type LineLoss, type LineSum, lineSum } from './report';

/** Окно слоя: сегодня — с полуночи до сейчас, вчера — прошлые календарные сутки, 7 суток — сегодня и шесть до него. */
export type FloorWin = 'today' | 'yesterday' | 'week';

export interface FloorQuery {
  view: 'floor';
  win: FloorWin;
}

/** Состояния помещения по порядку столбика — снизу вверх; грязно и свободно — не в столбике, а в подсказке и карточке. */
export const ROOM_PARTS: readonly RoomPhase[] = ['work', 'clean', 'held'];
export const ROOM_PHASES: readonly RoomPhase[] = ['work', 'clean', 'held', 'dirty', 'free'];

/** Время загрузки машины линии по состояниям — по порядку столбика снизу вверх (геймдизайн, §3.6). */
export type MachineLoad = 'run' | 'slow' | 'micro' | 'fail' | 'wait' | 'setup';
export const MACHINE_PARTS: readonly MachineLoad[] = ['run', 'slow', 'micro', 'fail', 'wait', 'setup'];

/**
 * Столбик помещения: номер по порядку плана, как в срезе, и секунды по состояниям за окно; серия, которая держит его
 * сейчас или держала последней за окно, — к ней ведёт «серия ждёт»: номер (`B<n>`) и номер серии.
 */
export interface FloorRoom {
  i: number;
  times: RoomTimes;
  bn?: number;
  code?: string;
}

/** Доска «План — факт» линии: сменное задание нынешней смены, а между сменами — прошлой (1ж). */
export interface FloorBoard {
  shift: Id;
  from: number;
  ends: number;
  /** смена кончилась */
  to?: number;
  plan: number;
  /** по часам смены: план часа — задание поровну на часы смены — и годные пачки; у нынешнего часа — пока что */
  hours: { plan: number; fact?: number }[];
  /** нынешний час — номер в `hours` */
  now?: number;
  fact: number;
  /** ритмичность по прошедшим часам, доли 1/10 000 */
  rhythm?: number;
}

/**
 * «Держит линию» (Б1к): над какой машиной табличка — номер по порядку линии — и её главная потеря за окно, с. Ключевая
 * машина планёрки ждала соседа — табличка над соседом, чьих остановок она ждала: `key` — ключевая машина.
 */
export interface FloorHolds {
  k: number;
  what?: LineLoss;
  sec?: number;
  key?: number;
}

export interface FloorLine {
  /** линия — номер по порядку плана */
  n: number;
  /** время загрузки каждой машины по порядку линии, с */
  machines: Pick<MachineTimes, MachineLoad>[];
  /** ключевая машина и её OEE с множителями — как у планёрки, за окно */
  sum: LineSum;
  /** «держит линию» (Б1к): ключевой машины за окно нет — нет */
  holds?: FloorHolds;
  board?: FloorBoard;
}

/** Чего ждут серии у места (Б1к) — состояние серии без хода стадий и линии и без своей даты «не раньше». */
export type WaitWhat = Exclude<BatchPhase, 'plan' | 'before' | 'work' | 'packing'>;
/** Ожидания по порядку: при равных часах слово — первое из них. */
export const WAIT_WHAT: readonly WaitWhat[] = ['line', 'lab', 'cleaning', 'people', 'decision', 'repair', 'room', 'equipment', 'asset', 'materials', 'kitting'];
const IS_WAIT: ReadonlySet<string> = new Set(WAIT_WHAT);

/** Серия, которая ждёт у места сейчас: номер (`B<n>`) — к досье, номер серии и чего ждёт. */
export interface FloorWaiting {
  bn: number;
  code: string;
  what: WaitWhat;
}

/**
 * Место (Б1к) — помещение, номер по порядку плана: секунды ожидания серий у него за окно по словам, с отрезками, которые
 * ещё идут; всего; чего ждали больше всего; серии, которые ждут у него сейчас.
 */
export interface FloorWait {
  i: number;
  sec: Partial<Record<WaitWhat, number>>;
  total: number;
  what: WaitWhat;
  now: FloorWaiting[];
}

/**
 * Виды потерь у места (Б1л) по порядку частей столбика — снизу вверх; «нет смены» — последний: в «все» он не входит.
 */
export const LOSS_KINDS: readonly LossKind[] = ['wait', 'move', 'walk', 'setup', 'again', 'defect', 'shift'];

/** Вещь потерь (Б1л): что окну нужно для слов и перехода, как у журнала решений, и её секунды за окно. */
export interface FloorThing {
  ref: JournalRef;
  sec: number;
}

/**
 * Потери места за окно (Б1л): место — как в учёте: помещение, `zone:<зона или стеллаж>`, `line:<линия>`, `dock:<рампа>`,
 * `yard`; секунды по видам, у ожидания (без «нет смены») — по причинам и отделам; вещи по видам — по убыванию секунд,
 * до пяти; всего — без «нет смены».
 */
export interface FloorLoss {
  spot: string;
  sec: Partial<Record<LossKind, number>>;
  wait: Partial<Record<WaitCause, number>>;
  depts: Partial<Record<Dept, number>>;
  things: Partial<Record<LossKind, FloorThing[]>>;
  total: number;
}

export interface FloorView {
  view: 'floor';
  win: FloorWin;
  /** длина окна, с, — больше всего учтённого времени у помещений: полная высота столбика */
  span: number;
  rooms: FloorRoom[];
  lines: FloorLine[];
  /**
   * места с ожиданием за окно или сейчас (Б1к) — по убыванию часов; первые три с часами — таблички «Узких мест», места
   * без часов за окно, где серии ждут сейчас, — в конце
   */
  waits: FloorWait[];
  /** потери мест за окно (Б1л) — по убыванию всего, при равных — по имени места; места без потерь — нет */
  losses: FloorLoss[];
}

/** Сутки окна — номера: от раннего к позднему. */
export function winDays(s: PlantState, win: FloorWin): number[] {
  const today = momentOf(s.start, s.t).day;
  if (win === 'today') return [today];
  if (win === 'yesterday') return [today - 1];
  return Array.from({ length: 7 }, (_, i) => today - 6 + i);
}

/** Сутки потерь с номерами окна: какие есть. */
function lossesOf(s: PlantState, days: number[]): DayLoss[] {
  const want = new Set(days);
  const out: DayLoss[] = [];
  for (let i = s.losses.length - 1; i >= 0 && s.losses[i].day >= days[0]; i--) if (want.has(s.losses[i].day)) out.unshift(s.losses[i]);
  return out;
}

/** Сутки линии за окно — сложением: время машин, выпуск по номиналу, годные. Заданий не было — `undefined`. */
export function sumLineDays(list: (LineDay | undefined)[]): LineDay | undefined {
  let out: LineDay | undefined;
  for (const ld of list) {
    if (!ld) continue;
    if (!out) {
      out = { times: ld.times.map(t => ({ ...t })), ideal: [...ld.ideal], run: [...ld.run], good: ld.good };
      continue;
    }
    const o = out;
    ld.times.forEach((t, i) => {
      for (const k of Object.keys(t) as (keyof MachineTimes)[]) o.times[i][k] += t[k];
      o.ideal[i] += ld.ideal[i];
      o.run[i] += ld.run[i];
    });
    o.good += ld.good;
  }
  return out;
}

/** План часа смены: задание поровну на её часы; остаток от деления — по пачке, вразбивку по часам. */
export function hourPlan(plan: number, hours: number): number[] {
  return Array.from({ length: hours }, (_, i) => Math.floor((plan * (i + 1)) / hours) - Math.floor((plan * i) / hours));
}

/** Доска линии: последнее сменное задание с часами; у заданий до схемы 30 часов нет — доски нет. */
function boardOf(s: PlantState, lineId: string): FloorBoard | undefined {
  let t;
  for (let i = s.shiftTasks.length - 1; i >= 0; i--) {
    if (s.shiftTasks[i].line !== lineId) continue;
    t = s.shiftTasks[i];
    break;
  }
  if (!t || !t.hours || t.ends === undefined) return undefined;
  const plans = hourPlan(t.plan, Math.max(1, Math.round((t.ends - t.from) / HOUR)));
  const line = s.lines[lineId];
  const done = t.hours.reduce((n, x) => n + x, 0);
  const open = t.to === undefined && t.hours.length < plans.length;
  const hours = plans.map((plan, i) => (i < t.hours!.length ? { plan, fact: t.hours![i] } : open && i === t.hours!.length ? { plan, fact: line.packs + line.made - t.start - done } : { plan }));
  const r = rhythm(t.hours.map((fact, i) => ({ plan: plans[i] ?? 0, fact })));
  return {
    shift: t.shift,
    from: t.from,
    ends: t.ends,
    ...(t.to !== undefined ? { to: t.to } : {}),
    plan: t.plan,
    hours,
    ...(open ? { now: t.hours.length } : {}),
    fact: t.fact ?? line.packs + line.made - t.start,
    ...(r !== undefined ? { rhythm: r } : {}),
  };
}

/**
 * Серия помещения для «серия ждёт»: та, что держит его сейчас; иначе — последняя, чья запись стадии в этом помещении
 * кончилась в окне.
 */
function holderOf(s: PlantState, roomId: string, from: number): string | undefined {
  const room = s.rooms[roomId];
  if (room.batch) return room.batch;
  let best: string | undefined;
  let at = from;
  for (const b of Object.values(s.batches)) {
    for (const r of b.records) {
      if (r.room === roomId && r.end >= at) {
        best = b.id;
        at = r.end;
      }
    }
  }
  return best;
}

/** Вид «Пол» за окно: помещения учёта, машины линий, ключевая машина и OEE, доски «План — факт». */
export function floorView(db: ContentDb, s: PlantState, q: FloorQuery): FloorView {
  const plan = planOf(db, s.plan);
  const days = winDays(s, q.win);
  const list = lossesOf(s, days);
  const today = momentOf(s.start, s.t).day;
  const from = (days[0] - momentOf(s.start, 0).day) * DAY;
  const index = new Map(plan.plant.rooms.map((r, i) => [r.id, i]));
  const rooms: FloorRoom[] = roomsOf(plan).rooms.map(id => {
    const times = { ...NO_ROOM };
    for (const d of list) {
      const x = d.rooms[id];
      if (x) for (const k of ROOM_PHASES) times[k] += x[k];
    }
    // отрезок, который ещё не закрыт, — в нынешнем часе: в окне, если в окне сегодня
    const room = s.rooms[id];
    if (days.at(-1) === today && room.phase && room.phaseAt !== undefined) times[room.phase] += s.t - room.phaseAt;
    const holder = times.held > 0 ? holderOf(s, id, from) : undefined;
    const b = holder ? s.batches[holder] : undefined;
    return { i: index.get(id)!, times, ...(b ? { bn: Number(b.id.slice(1)), code: batchNo(b.code) } : {}) };
  });
  const span = rooms.reduce((n, r) => Math.max(n, ROOM_PHASES.reduce((m, k) => m + r.times[k], 0)), 0);
  const lines: FloorLine[] = plan.plant.lines.map((l, n) => {
    const ld = sumLineDays(list.map(d => d.lines[l.id]));
    const machines = l.machines.map((_, k) => {
      const t = ld?.times[k] ?? NO_TIMES;
      return { run: t.run, slow: t.slow, micro: t.micro, fail: t.fail, wait: t.wait, setup: t.setup };
    });
    const board = boardOf(s, l.id);
    const sum = lineSum(n, ld);
    const holds = holdsOf(sum);
    return { n, machines, sum, ...(holds ? { holds } : {}), ...(board ? { board } : {}) };
  });
  return { view: 'floor', win: q.win, span, rooms, lines, waits: waitsOf(s, list, days.at(-1) === today, index), losses: lossesAt(db, s, list, days.at(-1) === today) };
}

/** Сколько вещей у вида места в виде (Б1л). */
export const LOSS_THINGS = 5;

/**
 * Потери мест за окно (Б1л): сутки учёта и, если в окне сегодня, ожидание задач, которое ещё идёт, — у места задачи с её
 * вещью. Вещи — по убыванию секунд, при равных — по имени, до пяти у вида.
 */
function lossesAt(db: ContentDb, s: PlantState, list: DayLoss[], today: boolean): FloorLoss[] {
  type Acc = { sec: Partial<Record<LossKind, number>>; wait: Partial<Record<WaitCause, number>>; depts: Partial<Record<Dept, number>>; things: Partial<Record<LossKind, Map<string, number>>> };
  const by = new Map<string, Acc>();
  const at = (spot: string) => {
    let a = by.get(spot);
    if (!a) by.set(spot, (a = { sec: {}, wait: {}, depts: {}, things: {} }));
    return a;
  };
  const addThing = (a: Acc, k: LossKind, ref: string | undefined, sec: number) => {
    if (!ref || sec <= 0) return;
    const m = (a.things[k] ??= new Map());
    m.set(ref, (m.get(ref) ?? 0) + sec);
  };
  const addWait = (a: Acc, dept: Dept, why: WaitCause, sec: number) => {
    if (sec <= 0) return;
    const k: LossKind = why === 'shift' ? 'shift' : 'wait';
    a.sec[k] = (a.sec[k] ?? 0) + sec;
    if (k === 'wait') {
      a.wait[why] = (a.wait[why] ?? 0) + sec;
      a.depts[dept] = (a.depts[dept] ?? 0) + sec;
    }
  };
  for (const d of list) {
    for (const [spot, x] of Object.entries(d.spots ?? {})) {
      const a = at(spot);
      for (const [dept, w] of Object.entries(x.wait ?? {})) for (const [why, sec] of Object.entries(w ?? {})) addWait(a, dept as Dept, why as WaitCause, sec ?? 0);
      for (const k of ['move', 'walk', 'setup', 'again', 'defect'] as const) if (x[k]) a.sec[k] = (a.sec[k] ?? 0) + x[k]!;
      for (const [k, m] of Object.entries(x.things ?? {})) for (const [ref, sec] of Object.entries(m ?? {})) addThing(a, k as LossKind, ref, sec);
    }
  }
  if (today) {
    for (const id of s.open) {
      const t = s.tasks[id];
      if (!t.why || t.since === undefined || PLANNED.has(t.kind)) continue;
      const a = at(taskSpot(db, s, t));
      addWait(a, AREA[t.kind], t.why, s.t - t.since);
      addThing(a, t.why === 'shift' ? 'shift' : 'wait', taskThing(s, t), s.t - t.since);
    }
  }
  const plan = planOf(db, s.plan);
  const out: FloorLoss[] = [];
  for (const [spot, a] of by) {
    const total = LOSS_KINDS.reduce((n, k) => n + (k === 'shift' ? 0 : (a.sec[k] ?? 0)), 0);
    if (total <= 0 && !a.sec.shift) continue;
    const things: Partial<Record<LossKind, FloorThing[]>> = {};
    for (const [k, m] of Object.entries(a.things) as [LossKind, Map<string, number>][]) {
      const top = [...m]
        .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
        .slice(0, LOSS_THINGS)
        .map(([ref, sec]) => ({ ref: thingRef(db, s, plan, ref), sec }));
      if (top.length > 0) things[k] = top;
    }
    out.push({ spot, sec: a.sec, wait: a.wait, depts: a.depts, things, total });
  }
  return out.sort((x, y) => y.total - x.total || (x.spot < y.spot ? -1 : x.spot > y.spot ? 1 : 0));
}

const num = (id: string) => Number(id.slice(1));

/**
 * Вещь учёта потерь (Б1л) — то, что окну нужно для слов и перехода, как у журнала решений: серия, партия, паллета,
 * заказы, вывоз, покупатель, человек, помещение, машина. Вещи уже нет на заводе — только то, что осталось в записях.
 */
export function thingRef(db: ContentDb, s: PlantState, plan: ReturnType<typeof planOf>, ref: string): JournalRef {
  const i = ref.indexOf(':');
  const k = ref.slice(0, i);
  const id = ref.slice(i + 1);
  switch (k) {
    case 'b':
      return batchRef(s, id);
    case 'l':
      return lotRef(s, id);
    case 'u':
      return s.units[id] ? { unit: num(id) } : {};
    case 'o':
      return s.orders[id] ? { order: num(id), thing: { kind: 'order', n: num(id) } } : { order: num(id) };
    case 'po': {
      const po = s.pos[id];
      return po ? { po: { lines: po.lines.map(l => ({ material: l.material, qty: l.qty })), eta: po.eta } } : {};
    }
    case 'w':
      return { waste: num(id) };
    case 'c':
      return { customer: id };
    case 'p':
      return personRef(s, s.people[id] ?? s.former[id]);
    case 'r': {
      const r = plan.plant.rooms.findIndex(x => x.id === id);
      return r >= 0 ? { room: id, thing: { kind: 'room', i: r } } : { room: id };
    }
    case 'm': {
      const thing = thingOf(db, s, id, plan);
      const type = plan.plant.equipment.find(e => e.id === id)?.type ?? plan.plant.lines.flatMap(l => l.machines).find(m => m.id === id)?.type;
      return { ...(type ? { machine: type } : {}), ...(thing ? { thing } : {}) };
    }
    default:
      return {};
  }
}

/** «Держит линию» (Б1к) — из итога линии планёрки: ключевая машина и её главная потеря; ждала соседа — сосед. */
export function holdsOf(sum: LineSum): FloorHolds | undefined {
  if (sum.key === undefined) return undefined;
  if (sum.loss?.what === 'wait' && sum.neighbour) return { k: sum.neighbour.k, what: sum.neighbour.what, sec: sum.neighbour.sec, key: sum.key };
  return { k: sum.key, ...(sum.loss ? { what: sum.loss.what, sec: sum.loss.sec } : {}) };
}

/**
 * Ожидание серий у мест за окно (Б1к): сутки учёта и, если в окне сегодня, отрезки, которые ещё идут; ход стадий и линии
 * — не ожидание. Места — по убыванию часов, при равных — по порядку плана.
 */
function waitsOf(s: PlantState, list: DayLoss[], today: boolean, index: Map<string, number>): FloorWait[] {
  const by = new Map<string, FloorWait>();
  const at = (room: string) => {
    let w = by.get(room);
    if (!w) {
      w = { i: index.get(room) ?? -1, sec: {}, total: 0, what: 'line', now: [] };
      by.set(room, w);
    }
    return w;
  };
  const put = (room: string, ph: BatchPhase, sec: number) => {
    if (!IS_WAIT.has(ph) || sec <= 0) return;
    const w = at(room);
    const k = ph as WaitWhat;
    w.sec[k] = (w.sec[k] ?? 0) + sec;
    w.total += sec;
  };
  for (const d of list) for (const [room, x] of Object.entries(d.waits ?? {})) for (const [ph, sec] of Object.entries(x)) put(room, ph as BatchPhase, sec ?? 0);
  for (const b of Object.values(s.batches)) {
    if (!b.place || !b.phase || !IS_WAIT.has(b.phase)) continue;
    if (today && b.placeAt !== undefined) put(b.place, b.phase, s.t - b.placeAt);
    at(b.place).now.push({ bn: Number(b.id.slice(1)), code: batchNo(b.code), what: b.phase as WaitWhat });
  }
  const out = [...by.values()].filter(w => w.i >= 0);
  for (const w of out) {
    w.what = w.total > 0 ? WAIT_WHAT.reduce((a, k) => ((w.sec[k] ?? 0) > (w.sec[a] ?? 0) ? k : a)) : w.now[0].what;
    w.now.sort((a, b) => a.bn - b.bn);
  }
  return out.sort((a, b) => b.total - a.total || a.i - b.i);
}
