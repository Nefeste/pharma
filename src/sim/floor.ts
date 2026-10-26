// Данные на полу (Б1и; docs/specs/2026-10-vertical-slice.md, «Б1и»): помещения производства и упаковки и машины линий
// за окно — сегодня, вчера или 7 суток, по календарным суткам завода, — ключевая машина и OEE той же функцией, что у
// планёрки, и доска «План — факт» у каждой линии. Только учёт завода — время помещений и машин по состояниям, счётчики
// годных пачек, сменные задания, записи стадий, — без истины (docs/02-architecture.md, §9).
import type { ContentDb, Id } from '../content/types';
import { batchNo } from '../engine/batchno';
import { DAY, HOUR, momentOf } from '../engine/core/calendar';
import { NO_ROOM, NO_TIMES, rhythm, roomsOf } from '../engine/lean';
import { planOf } from '../engine/plant';
import type { DayLoss, LineDay, MachineTimes, PlantState, RoomPhase, RoomTimes } from '../engine/types';
import { type LineSum, lineSum } from './report';

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

export interface FloorLine {
  /** линия — номер по порядку плана */
  n: number;
  /** время загрузки каждой машины по порядку линии, с */
  machines: Pick<MachineTimes, MachineLoad>[];
  /** ключевая машина и её OEE с множителями — как у планёрки, за окно */
  sum: LineSum;
  board?: FloorBoard;
}

export interface FloorView {
  view: 'floor';
  win: FloorWin;
  /** длина окна, с, — больше всего учтённого времени у помещений: полная высота столбика */
  span: number;
  rooms: FloorRoom[];
  lines: FloorLine[];
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
  const plan = planOf(db, s.plant);
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
    return { n, machines, sum: lineSum(n, ld), ...(board ? { board } : {}) };
  });
  return { view: 'floor', win: q.win, span, rooms, lines };
}
