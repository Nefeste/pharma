// Потери и ритм (docs/specs/2026-10-engine.md, 1ж; геймдизайн, §9.6): счётчики потерь за сутки по видам и участкам,
// время серии по состояниям («чего ждёт серия»), сменное задание линии и коэффициент ритмичности. Причину ожидания
// задачи называет раздатчик (tasks.ts), путь и время — он же; здесь — куда их записать. Модуль не зовёт других модулей
// движка, кроме вопросов о пригодности активов (Б3в): его зовут они.
import type { ContentDb, Dept, Id } from '../content/types';
import { lineUnfit, stageUnfit } from './assets';
import { HOUR, momentOf } from './core/calendar';
import { P_ONE } from './core/rng';
import { planOf } from './plant';
import type { Batch, BatchPhase, DayLoss, Line, LineDay, MachineTimes, PlantState, ShiftTask, Task, TaskKind, WaitCause } from './types';
import { scheduleOn, spanOn } from './shifts';

/** Участок задачи — отдел, чья это работа; отгрузку делает склад. */
export const AREA: Record<TaskKind, Dept> = {
  unload: 'wms',
  receive: 'wms',
  putaway: 'wms',
  move: 'wms',
  pick: 'wms',
  transfer: 'wms',
  return: 'wms',
  ship: 'wms',
  casePick: 'wms',
  load: 'wms',
  toSampling: 'qc',
  sample: 'qc',
  fromSampling: 'qc',
  handover: 'qc',
  prep: 'qc',
  review: 'qc',
  decide: 'qc',
  stage: 'mes',
  clean: 'mes',
  crew: 'line',
  changeover: 'line',
  clearance: 'line',
  clearCheck: 'line',
  feed: 'line',
  fgCheck: 'qa',
  qpDecide: 'qa',
  repair: 'maint',
  truckCheck: 'wms',
  invStep: 'qa',
  invFix: 'maint',
  // обучение (Б3б) ведёт ООК; путь к посту, где учатся, — на участок того, кто учится (`moved`)
  train: 'qa',
  trainCheck: 'qa',
  // приёмка работы подрядчика (Б3в) — ООК или ОКК; путь к активу — на участок того, кто принимает (`moved`)
  accept: 'qa',
  vendorReview: 'qa',
  devAssess: 'qa',
};

/** Ожидание обучения в задержки не идёт: его ставят заранее, за срок предупреждения, и оно ждёт свободного часа. */
const PLANNED: ReadonlySet<TaskKind> = new Set(['train', 'trainCheck']);

export function newLoss(day: number): DayLoss {
  return {
    day,
    wait: {},
    move: {},
    walk: {},
    defects: { blisters: 0, cartons: 0, deviations: 0, lots: 0, batches: 0 },
    recleans: 0,
    cleans: { major: 0, majorSec: 0, minor: 0, minorSec: 0 },
    changes: { n: 0, sec: 0 },
    lines: {},
  };
}

/** Время машины по состояниям — пустое: у задания и у суток линии. */
export const NO_TIMES: MachineTimes = { run: 0, slow: 0, micro: 0, fail: 0, wait: 0, setup: 0, off: 0, out: 0, slowOut: 0 };

/** Сутки линии (3в) в сутках мгновения `t`: время машин, выпуск по номиналу, годные. Первая запись за сутки — с нуля. */
export function lineDay(s: PlantState, line: string, machines: number, t: number): LineDay {
  const d = dayOf(s, momentOf(s.start, t).day);
  d.lines[line] ??= { times: Array.from({ length: machines }, () => ({ ...NO_TIMES })), ideal: Array(machines).fill(0), run: Array(machines).fill(0), good: 0 };
  return d.lines[line];
}

/** Сутки потерь с номером `day`: нынешние — последние; новые сутки — в конец. */
function dayOf(s: PlantState, day: number): DayLoss {
  const last = s.losses[s.losses.length - 1];
  if (last && last.day === day) return last;
  if (!last || last.day < day) {
    const d = newLoss(day);
    s.losses.push(d);
    return d;
  }
  for (let i = s.losses.length - 1; i >= 0; i--) if (s.losses[i].day === day) return s.losses[i];
  return last;
}

const today = (s: PlantState) => dayOf(s, momentOf(s.start, s.t).day);

/** Задача не досталась никому: причина та же — ждёт дальше; другая — прошлый отрезок записан на прошлую причину. */
export function waitNote(s: PlantState, t: Task, why: WaitCause) {
  if (t.why === why) return;
  waitEnd(s, t);
  t.why = why;
  t.since = s.t;
}

/** Ожидание задачи кончилось — назначена или снята: отрезок — на её участок и причину, в нынешние сутки. */
export function waitEnd(s: PlantState, t: Task) {
  if (!t.why) return;
  addWait(today(s), t.kind, t.why, s.t - t.since!);
  delete t.why;
  delete t.since;
}

function addWait(d: DayLoss, kind: TaskKind, why: WaitCause, sec: number) {
  if (sec <= 0 || PLANNED.has(kind)) return;
  const w = (d.wait[AREA[kind]] ??= {});
  w[why] = (w[why] ?? 0) + sec;
}

/**
 * Путь задачи, когда её назначили: пешком без груза — перемещения; техника с грузом и порожняком и груз на руках —
 * транспортировка. См и с — на участок `a`, по умолчанию — участок вида задачи.
 */
export function moved(s: PlantState, kind: TaskKind, walk: number, walkSec: number, empty: number, loaded: number, driveSec: number, a: Dept = AREA[kind]) {
  const d = today(s);
  if (walk > 0 || walkSec > 0) {
    const w = (d.walk[a] ??= { cm: 0, sec: 0 });
    w.cm += walk;
    w.sec += walkSec;
  }
  if (empty > 0 || loaded > 0 || driveSec > 0) {
    const m = (d.move[a] ??= { loaded: 0, empty: 0, sec: 0 });
    m.empty += empty;
    m.loaded += loaded;
    m.sec += driveSec;
  }
}

/** Пеший переход без задачи — на пост или к выходу (3а): на отдел роли человека, см и с. */
export function walked(s: PlantState, dept: Dept, cm: number, sec: number) {
  if (cm <= 0 && sec <= 0) return;
  const w = (today(s).walk[dept] ??= { cm: 0, sec: 0 });
  w.cm += cm;
  w.sec += sec;
}

/** Фура ждала рампы во дворе (3а): от прихода до того, как встала к рампе, — ожидание склада с причиной «рампа занята». */
export function dockWait(s: PlantState, sec: number) {
  if (sec <= 0) return;
  const w = (today(s).wait.wms ??= {});
  w.dock = (w.dock ?? 0) + sec;
}

/** Дефекты за сутки: брак камер, отклонения, отклонённые партии и серии. */
export function defect(s: PlantState, kind: keyof DayLoss['defects'], n = 1) {
  if (n > 0) today(s).defects[kind] += n;
}

/** Лишняя обработка: уборка после просроченной чистоты. */
export function recleaned(s: PlantState) {
  today(s).recleans++;
}

/** Уборка помещения кончилась (Б2г): генеральная или малая и её работа, с, — в нынешние сутки. */
export function cleaned(s: PlantState, major: boolean, sec: number) {
  const c = today(s).cleans;
  if (major) {
    c.major++;
    c.majorSec += sec;
  } else {
    c.minor++;
    c.minorSec += sec;
  }
}

/** Переналадка линии на формат другой позиции кончилась (Б2г): её работа, с, — в нынешние сутки. */
export function changedOver(s: PlantState, sec: number) {
  const c = today(s).changes;
  c.n++;
  c.sec += sec;
}

/** Генеральные уборки и переналадки: сколько и их работа, с. */
export interface Switches {
  major: number;
  majorSec: number;
  changes: number;
  changeSec: number;
}

/** Генеральные уборки и переналадки суток — суммой: для прогона плана и итога поста производства (Б2г). */
export function switchesOf(days: DayLoss[]): Switches {
  const x: Switches = { major: 0, majorSec: 0, changes: 0, changeSec: 0 };
  for (const d of days) {
    x.major += d.cleans.major;
    x.majorSec += d.cleans.majorSec;
    x.changes += d.changes.n;
    x.changeSec += d.changes.sec;
  }
  return x;
}

/**
 * Каждый час: в полночь ожидание открытых задач закрывается в ушедшие сутки и начинается в новых; у линий — конец и
 * начало смен упаковщиков: выпуск смены и новое сменное задание. Звать после линий (их выпуск посчитан до часа).
 */
export function leanHour(db: ContentDb, s: PlantState) {
  const now = momentOf(s.start, s.t);
  if (now.sec === 0) {
    const gone = dayOf(s, now.day - 1);
    for (const id of s.open) {
      const t = s.tasks[id];
      if (!t.why) continue;
      addWait(gone, t.kind, t.why, s.t - t.since!);
      t.since = s.t;
    }
    dayOf(s, now.day);
  }
  // смены людей у машин линии — их смены по графикам (Б4б): у пятидневки — по производственному календарю, в праздник её
  // нет, накануне праздника она короче (Б4а); у сменного по циклу — по рисунку, ночная через полночь
  for (const line of Object.values(s.lines)) {
    for (const [id, x] of shiftsOf(db, s, line, now.day)) {
      if (x.end) closeShift(s, line, id);
      if (x.len !== undefined) openShift(db, s, line, id, x.len);
    }
  }
}

/**
 * Графики людей, которые стоят у машин линии, по порядку штата: у какого смена кончается в это мгновение (`end`) и у
 * какого начинается — с её длиной для задания (`len`): у пятидневки — по графику, у сменного по циклу — по рисунку.
 */
function shiftsOf(db: ContentDb, s: PlantState, line: Line, day: number): Map<Id, { end: boolean; len?: number }> {
  const roles = new Set(line.machines.map(mc => db.machines[mc.type].crew.role));
  const out = new Map<Id, { end: boolean; len?: number }>();
  for (const p of Object.values(s.people)) {
    if (!roles.has(p.role)) continue;
    for (const z of [day - 1, day]) {
      const span = spanOn(db, s, p, z);
      if (!span || (span[0] !== s.t && span[1] !== s.t)) continue;
      const id = scheduleOn(p, z);
      const sh = db.shifts[id];
      const x = out.get(id) ?? { end: false };
      if (span[1] === s.t) x.end = true;
      if (span[0] === s.t) x.len = sh.cycle ? span[1] - span[0] : (sh.to - sh.from) * HOUR;
      out.set(id, x);
    }
  }
  return out;
}

/** Задания на упаковку линии с материалами в резерве — по порядку: что мастер может дать смене. */
const queueOf = (s: PlantState, line: Line) =>
  Object.values(s.batches).filter(b => b.status === 'packing' && b.pack!.line === line.id && b.pack!.expect !== undefined && b.pack!.state !== 'waiting');

/**
 * Сменное задание: меньшее из «осталось годных пачек в заданиях на упаковку линии с материалами в резерве» и «скорость
 * узкого места × время смены × норма мастера»; скорость — у первого задания. Заданий нет — задание смены 0.
 */
function openShift(db: ContentDb, s: PlantState, line: Line, shift: Id, len: number) {
  const jobs = queueOf(s, line).map(b => b.pack!);
  let plan = 0;
  if (jobs.length > 0) {
    const sku = db.skus[jobs[0].sku];
    // пачек в минуту на номинале у каждой машины — ×10 000; узкое место — меньшая
    const rate = Math.min(...line.machines.map(mc => Math.floor((db.machines[mc.type].nominal * P_ONE) / (db.machines[mc.type].item === 'blister' ? sku.blisters : 1))));
    const cap = Math.floor(((len / 60) * rate * db.scenarios[s.scenario].norm) / (P_ONE * P_ONE));
    const left = jobs.reduce((n, j) => n + j.expect! - (j.state === 'running' ? line.made : 0), 0);
    plan = Math.max(0, Math.min(left, cap));
  }
  s.shiftTasks.push({ line: line.id, shift, from: s.t, plan, start: line.packs + line.made });
}

function closeShift(s: PlantState, line: Line, shift: Id) {
  for (let i = s.shiftTasks.length - 1; i >= 0; i--) {
    const t = s.shiftTasks[i];
    if (t.line !== line.id || t.shift !== shift || t.to !== undefined) continue;
    t.to = s.t;
    t.fact = line.packs + line.made - t.start;
    return;
  }
}

/**
 * Коэффициент ритмичности смен (`bse-rhythm`, `savitskaya`), доли 1/10 000: выпуск каждой смены, но не больше её
 * задания, против суммы заданий. Смены без задания и незакрытые — не в счёт; считать нечего — `undefined`.
 */
export function rhythm(tasks: ShiftTask[]): number | undefined {
  let plan = 0;
  let got = 0;
  for (const t of tasks) {
    if (t.plan <= 0 || t.fact === undefined) continue;
    plan += t.plan;
    got += Math.min(t.fact, t.plan);
  }
  return plan > 0 ? Math.floor((got * P_ONE) / plan) : undefined;
}

/** OEE и его множители, доли 1/10 000. */
export interface Oee {
  a: number;
  p: number;
  q: number;
  oee: number;
}

/**
 * OEE машины (`10-domain.md`, §6: доступность × производительность × качество) по выпуску по номиналу за загрузку и за
 * работу, её проходу и годным линии — в одних единицах. Доступность — работа против загрузки, производительность — проход
 * против выпуска за работу, качество — годные против прохода. Множители — по выпуску, а не по секундам, поэтому их
 * произведение — OEE и тогда, когда за сутки позиция с другим номиналом сменила прежнюю. Загрузки не было — `undefined`.
 */
export function oee(m: { ideal: number; run: number; out: number }, good: number): Oee | undefined {
  if (m.ideal <= 0) return undefined;
  const share = (x: number, of: number) => (of > 0 ? Math.floor((x * P_ONE) / of) : 0);
  return { a: share(m.run, m.ideal), p: share(m.out, m.run), q: share(good, m.out), oee: share(good, m.ideal) };
}

/** Сменные задания, начатые в сутки `day`. */
export const shiftsOfDay = (s: PlantState, day: number) => s.shiftTasks.filter(t => momentOf(s.start, t.from).day === day);

/**
 * Состояние серии сейчас (геймдизайн, §5.4): что она делает или чего ждёт. Выпущена или отклонена — `undefined`, время
 * больше не идёт.
 */
export function phaseOf(db: ContentDb, s: PlantState, b: Batch): BatchPhase | undefined {
  switch (b.status) {
    case 'waiting':
      return s.t < b.notBefore ? 'plan' : 'materials';
    case 'reserved':
      return s.t < b.notBefore ? 'plan' : 'kitting';
    case 'kitting':
      return 'kitting';
    case 'process': {
      const task = Object.values(s.tasks).find(t => t.kind === 'stage' && t.batch === b.id);
      if (task) return task.state === 'busy' ? 'work' : 'people';
      if (b.run?.rest !== undefined) return 'repair';
      const st = db.recipes[b.recipe].stages[b.stage];
      const roomId = planOf(db, s.plant).roomOf[st.room];
      const room = s.rooms[roomId];
      if (room.batch && room.batch !== b.id) return 'room';
      const eqs = Object.values(s.equipment).filter(e => e.room === roomId && st.equipment.includes(e.type));
      if (eqs.some(e => e.batch && e.batch !== b.id)) return 'equipment';
      if (eqs.some(e => Object.values(s.parts).some(p => p.machine === e.id && (p.state === 'failed' || p.task !== undefined)))) return 'repair';
      if (stageUnfit(db, s, st, roomId)) return 'asset';
      return 'cleaning';
    }
    case 'bulk':
      return 'lab';
    case 'packing': {
      const job = b.pack!;
      if (job.state === 'running') return 'packing';
      if (job.state === 'waiting') return 'materials';
      // комплект у линии, а машина линии не пригодна (Б3в) — упаковка ждёт её
      return job.state === 'ready' && lineUnfit(db, s, job.line) ? 'asset' : 'line';
    }
    case 'fg':
      return 'decision';
    default:
      return undefined;
  }
}

/** После раздачи задач: у каждой серии, чьё состояние сменилось, прошлый отрезок — в его состояние. */
export function leanStep(db: ContentDb, s: PlantState) {
  for (const b of Object.values(s.batches)) {
    const ph = phaseOf(db, s, b);
    if (ph === b.phase) continue;
    if (b.phase && s.t > b.phaseAt) b.spent[b.phase] = (b.spent[b.phase] ?? 0) + s.t - b.phaseAt;
    if (ph) b.phase = ph;
    else delete b.phase;
    b.phaseAt = s.t;
  }
}
