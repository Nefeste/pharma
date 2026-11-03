// Сменно-суточное задание (Б6б; docs/specs/2026-10-vertical-slice.md, «Б6б»; ГОСТ Р МЭК 62264-3, п. 6.7.4 — плановое
// (сменное) задание: заказ-наряды, готовые к исполнению, у каждого — время начала по детальному плану). В 08:00 у каждого
// отдела — строки на сутки до следующих 08:00: по прогону расписания с горизонтом в сутки — комплектовки и стадии, по
// норме мастера линии — задания на упаковку, и по очередям этого мига — отгрузки и фуры дня, испытания, сколько успеют
// аналитики смены, ремонты, визиты подрядчика, решения по сериям и оценки отклонений. Каждый час у строки — когда начата;
// у неначатой через час после плана — чего ждали. В следующие 08:00 — итог по записям завода. Это запись завода, без
// истины: правила её не читают, жизнь завода от неё не меняется (п. 6.10.3: отслеживание сравнивает факт с планом).
import type { ContentDb, Dept } from '../content/types';
import { unfit } from './assets';
import { DAY, HOUR, MIN, momentOf } from './core/calendar';
import { P_ONE } from './core/rng';
import { dueOf } from './devclass';
import { fitsIn, overLeft } from './hours';
import { QC } from './lab';
import { packRate, phaseOf } from './lean';
import { CHECK_WORK, CLEAR_WORK } from './line';
import { type Bar, forecast } from './plan/schedule';
import { assessBlock } from './qa';
import { spanOn } from './shifts';
import type { DailyRow, DailyTask, DailyWhy, Instrument, Person, PlantState, Task } from './types';

/** Строка «в срок» — начата не позже стольких секунд от плана; через столько же смотрят, чего ждала неначатая (геймдизайн, §9.4). */
export const ON_TIME = HOUR;

/** Сколько суток хранятся задания (геймдизайн, §9.4). */
export const DAILY_KEEP = 31;

/**
 * Час задания (src/engine/engine.ts, событие часа): в `at` — 08:00 — закрыть вчерашнее и поставить сегодняшнее; в
 * остальные часы — отметить у строк сегодняшнего, что начато и чего ждали. Заданий нет (`s.daily` не задан) — ничего:
 * так у копии прогона плана.
 */
export function dailyHour(db: ContentDb, s: PlantState, at: number) {
  if (!s.daily) return;
  const cur = s.daily[s.daily.length - 1];
  if (cur && !cur.closed) watch(db, s, cur);
  if (momentOf(s.start, s.t).sec !== at) return;
  if (cur && !cur.closed) close(db, s, cur);
  s.daily.push(open(db, s));
  while (s.daily.length > DAILY_KEEP) s.daily.shift();
}

/** Задача очереди в задании: ждёт людей или её взяли в этот миг — диспетчер раздаёт работу раньше часа задания. */
const queued = (t: Task, t0: number) => t.state === 'open' || (t.state === 'busy' && t.times !== undefined && t.times[0] >= t0);

/** Поставить задание на сутки с этого мига. */
function open(db: ContentDb, s: PlantState): DailyTask {
  const t0 = s.t;
  const t1 = s.t + DAY;
  const rows: DailyRow[] = [];
  // производство и комплектовка — по прогону расписания: то, что по плану начнётся в эти сутки
  const bars = forecast(db, s, [], [], [], t1).bars;
  for (const b of bars) {
    if (b.when !== 'plan' || !b.batch || b.from < t0 || b.from >= t1) continue;
    if (b.kind === 'kit') rows.push({ dept: 'wms', kind: 'kit', batch: b.batch, ...(b.pack ? { pack: true as const } : {}), at: b.from });
    else if (b.kind === 'stage' && b.stage) rows.push({ dept: 'mes', kind: 'stage', batch: b.batch, stage: b.stage, room: b.row, at: b.from });
  }
  rows.push(...lineRows(db, s, bars, t0, t1));
  // склад: отгрузки заказов со сроком в эти сутки и фуры поставщиков, которые должны встать к рампе
  for (const o of Object.values(s.orders)) if (o.status === 'open' && o.due >= t0 && o.due < t1) rows.push({ dept: 'wms', kind: 'ship', order: o.id, at: o.due });
  for (const p of Object.values(s.pos)) if (p.status === 'ordered' && p.eta >= t0 && p.eta < t1) rows.push({ dept: 'wms', kind: 'truck', po: p.id, at: p.eta });
  rows.push(...labRows(db, s, t0, t1));
  // техслужба: ремонты и замены узлов, которые идут или ждут людей; визиты подрядчика, назначенные на эти сутки
  for (const t of Object.values(s.tasks)) if (t.kind === 'repair' && t.part) rows.push({ dept: 'maint', kind: 'repair', part: t.part, ...(t.room ? { room: t.room } : {}), at: t0 });
  for (const a of Object.values(s.assets)) if (a.visit && a.visit.from === undefined && a.visit.at < t1) rows.push({ dept: 'maint', kind: 'visit', asset: a.id, at: Math.max(t0, a.visit.at) });
  // ООК и уполномоченное лицо: решения по сериям, у которых испытания ГП кончены, и оценки отклонений со сроком по
  // классу в эти сутки
  for (const t of Object.values(s.tasks)) if (t.kind === 'qpDecide' && t.batch && queued(t, t0)) rows.push({ dept: 'qa', kind: 'release', batch: t.batch, at: t0 });
  for (const d of Object.values(s.deviations)) {
    if (d.status !== 'open') continue;
    const due = dueOf(db, s, d);
    if (due >= t0 && due < t1) rows.push({ dept: 'qa', kind: 'assess', dev: d.id, ...(d.batch ? { batch: d.batch } : {}), at: due });
  }
  return { from: t0, rows };
}

/** Окна смен людей ролей с мгновения `t0` на трое суток вперёд: у каждой роли кто-то в смене — пересечение по ролям. */
function windowsOf(db: ContentDb, s: PlantState, roles: readonly string[], t0: number): [number, number][] {
  const day = momentOf(s.start, t0).day;
  let acc: [number, number][] | undefined;
  for (const role of new Set(roles)) {
    const spans: [number, number][] = [];
    for (const p of Object.values(s.people)) {
      if (p.role !== role) continue;
      for (const z of [day - 1, day, day + 1, day + 2]) {
        const sp = spanOn(db, s, p, z);
        if (sp && sp[1] > t0) spans.push([Math.max(sp[0], t0), sp[1]]);
      }
    }
    spans.sort((a, b) => a[0] - b[0]);
    const union: [number, number][] = [];
    for (const sp of spans) {
      const last = union[union.length - 1];
      if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
      else union.push([sp[0], sp[1]]);
    }
    if (!acc) acc = union;
    else {
      const both: [number, number][] = [];
      for (const a of acc) for (const u of union) if (Math.max(a[0], u[0]) < Math.min(a[1], u[1])) both.push([Math.max(a[0], u[0]), Math.min(a[1], u[1])]);
      acc = both.sort((a, b) => a[0] - b[0]);
    }
  }
  return acc ?? [];
}

/** Первое мгновение в окнах не раньше `at`; окон дальше нет — `Infinity`. */
function workFrom(win: readonly [number, number][], at: number): number {
  for (const w of win) if (w[1] > at) return Math.max(w[0], at);
  return Infinity;
}

/** Когда кончится работа `sec` секунд в окнах, начатая не раньше `at`; окон не хватило — `Infinity`. */
function workTo(win: readonly [number, number][], at: number, sec: number): number {
  let left = sec;
  for (const w of win) {
    if (w[1] <= at) continue;
    const from = Math.max(w[0], at);
    if (from + left <= w[1]) return from + left;
    left -= w[1] - from;
  }
  return left <= 0 ? at : Infinity;
}

/**
 * Упаковка: задания линии по её порядку — то, что линия возьмёт, — с первой таблеткой по норме мастера (Б1и), в смены
 * людей у её машин: взятое — после переналадки на формат и очистки линии с проверкой мастера, следующее — после конца
 * предыдущего по скорости узкого места × норма мастера, и не раньше конца полосы его комплекта упаковки в прогоне
 * расписания. В задании — то, что по норме начнётся в эти сутки.
 */
function lineRows(db: ContentDb, s: PlantState, bars: readonly Bar[], t0: number, t1: number): DailyRow[] {
  const out: DailyRow[] = [];
  const norm = db.scenarios[s.scenario].norm;
  for (const line of Object.values(s.lines)) {
    const cur = line.batch ? s.batches[line.batch] : undefined;
    const queue = Object.values(s.batches).filter(x => x.status === 'packing' && x.pack!.line === line.id && x.pack!.taken === undefined && (x.pack!.state === 'reserved' || x.pack!.state === 'kitting' || x.pack!.state === 'ready'));
    const jobs = cur?.pack && cur.pack.state !== 'done' ? [cur, ...queue] : queue;
    if (jobs.length === 0) continue;
    const win = windowsOf(db, s, line.machines.map(mc => db.machines[mc.type].crew.role), t0);
    let at = t0;
    let format = line.format;
    let clear = line.clear;
    for (const b of jobs) {
      const job = b.pack!;
      const sku = db.skus[job.sku];
      // пачек в минуту по норме мастера, ×10 000; годных пачек — сколько линия ждёт, у невзятого — без брака камер
      const rate = Math.max(1, Math.floor((packRate(db, s, line, job) * norm) / P_ONE));
      const packs = job.expect ?? Math.floor(job.tablets / (sku.perBlister * sku.blisters));
      const run = (n: number) => Math.ceil((Math.max(0, n) * MIN * P_ONE) / rate);
      if (job.state === 'running') {
        at = workTo(win, at, run(packs - line.made));
        format = sku.format;
        clear = false;
        continue;
      }
      const change = format !== sku.format ? Math.max(MIN, line.machines.reduce((n, mc) => n + db.machines[mc.type].changeover, 0)) : 0;
      let first = workTo(win, at, change + (clear ? 0 : CLEAR_WORK + CHECK_WORK));
      if (job.state !== 'ready') {
        // комплект упаковки ещё не у линии: его полоса в прогоне; нет её в сутках — дальше линия по плану не дойдёт
        const kit = bars.find(x => x.kind === 'kit' && x.pack && x.batch === b.id);
        if (!kit) break;
        first = workFrom(win, Math.max(first, kit.to));
      }
      if (first >= t1) break;
      out.push({ dept: 'line', kind: 'pack', batch: b.id, line: line.id, at: first });
      at = workTo(win, first, run(packs));
      format = sku.format;
      clear = false;
    }
  }
  return out;
}

/** Когда прибор освободится: держит испытание — конец подготовки и работы прибора без людей; иначе — с этого мига. */
function instFree(db: ContentDb, s: PlantState, inst: Instrument, t0: number): number {
  const q = inst.test ? s.tests[inst.test] : undefined;
  if (!q) return t0;
  const m = db.tests[q.method];
  if (q.state === 'run') {
    const e = s.agenda.heap.find(x => x.e.kind === 'run' && x.e.test === q.id && x.e.v === q.v);
    return e ? e.t : t0 + m.run;
  }
  const t = Object.values(s.tasks).find(x => x.kind === 'prep' && x.test === q.id);
  return (t?.times ? t.times[4] : t0 + (t?.work ?? 0)) + (m.unattended ? m.run : 0);
}

/**
 * ОКК: испытания очереди лаборатории — по её порядку: приоритет работы, поднятые игроком выше (3г), — по конечной
 * производительности (ГОСТ Р МЭК 62264-3, п. 6.6.4): у каждой пробы — самое раннее начало, когда свободны аналитик в
 * смене и прибор методики, а подготовка по её норме помещается в остаток смены по правилу сверхурочных (Б4а); прибор
 * держит пробу ещё и на работу без людей. Не помещается в сутки — не в задании.
 */
function labRows(db: ContentDb, s: PlantState, t0: number, t1: number): DailyRow[] {
  const out: DailyRow[] = [];
  const day = momentOf(s.start, t0).day;
  const mode = s.policy.qc;
  const desks: { p: Person; at: number; end: number; left: number }[] = [];
  for (const p of Object.values(s.people)) {
    if (!(QC.analysts as readonly string[]).includes(p.role)) continue;
    const busy = p.task ? s.tasks[p.task] : undefined;
    for (const z of [day - 1, day, day + 1]) {
      const span = spanOn(db, s, p, z);
      if (!span || span[1] <= t0 || span[0] >= t1) continue;
      desks.push({ p, at: Math.max(span[0], t0, busy?.times ? busy.times[4] : t0), end: span[1], left: overLeft(db, s, p, span[0]) });
    }
  }
  const insts = Object.values(s.instruments)
    .filter(i => !unfit(db, s, i.id, day))
    .map(i => ({ i, free: instFree(db, s, i, t0) }));
  // взятые в этот миг — первыми: диспетчер раздал их раньше часа задания
  for (const id of Object.keys(s.tasks)) {
    const t = s.tasks[id];
    if (t.kind === 'prep' && t.test && t.state === 'busy' && t.times && t.times[0] >= t0) out.push({ dept: 'qc', kind: 'test', test: t.test, at: t.times[0] });
  }
  for (const id of s.open) {
    const t = s.tasks[id];
    if (t.kind !== 'prep' || !t.test || s.tests[t.test]?.state !== 'queued') continue;
    const m = db.tests[s.tests[t.test].method];
    const cands = t.inst ? insts.filter(x => t.inst!.includes(x.i.type)) : [undefined];
    let best: { d: (typeof desks)[number]; x: (typeof insts)[number] | undefined; at: number } | undefined;
    for (const d of desks)
      for (const x of cands) {
        const at = Math.max(d.at, x ? x.free : t0);
        if (at >= t1 || at >= d.end || (best && at >= best.at)) continue;
        if (fitsIn('prep', mode, d.end - at, t.work, t.work, d.left)) best = { d, x, at };
      }
    if (!best) continue;
    const end = best.at + t.work;
    best.d.left -= Math.max(0, end - Math.max(best.d.end, best.at));
    best.d.at = end;
    if (best.x) best.x.free = end + (m.unattended ? m.run : 0);
    out.push({ dept: 'qc', kind: 'test', test: t.test, at: best.at });
  }
  return out;
}

/** Задача строки очереди: подготовка пробы испытания, ремонт узла, решение уполномоченного лица по серии. */
function taskOf(s: PlantState, r: DailyRow): Task | undefined {
  if (r.kind === 'test') return Object.values(s.tasks).find(x => x.kind === 'prep' && x.test === r.test);
  if (r.kind === 'repair') {
    const id = r.part ? s.parts[r.part]?.task : undefined;
    return id && s.tasks[id]?.kind === 'repair' ? s.tasks[id] : undefined;
  }
  if (r.kind === 'release') return Object.values(s.tasks).find(x => x.kind === 'qpDecide' && x.batch === r.batch);
  return undefined;
}

/** Задача очереди начата — люди дошли до места; ушла — сделана, тогда — когда увидели. */
function taskStart(s: PlantState, t: Task | undefined): number | undefined {
  if (!t) return s.t;
  return t.state === 'busy' && t.times && s.t >= t.times[1] ? t.times[1] : undefined;
}

/**
 * Когда строка начата (у отгрузки — фура ушла, у фуры — встала к рампе, у испытания — аналитик взял пробу в работу, у
 * оценки отклонения — оно оценено или закрыто); ещё нет — `undefined`. Без записи мгновения — час, когда это увидели.
 */
function startOf(db: ContentDb, s: PlantState, r: DailyRow): number | undefined {
  const b = r.batch ? s.batches[r.batch] : undefined;
  switch (r.kind) {
    case 'kit':
      if (!b) return undefined;
      if (!r.pack) return b.issued;
      if (b.pack?.kitted !== undefined) return b.pack.kitted;
      return b.pack && b.pack.state !== 'waiting' && b.pack.state !== 'reserved' ? s.t : undefined;
    case 'stage': {
      if (!b) return undefined;
      const rec = b.records.find(x => x.stage === r.stage);
      if (rec) return rec.start;
      if (db.recipes[b.recipe].stages[b.stage]?.id !== r.stage) return undefined;
      if (b.run) return b.run.start;
      // стадия без узлов под износом: начало — люди дошли до помещения
      const t = Object.values(s.tasks).find(x => x.kind === 'stage' && x.batch === b.id && x.state === 'busy');
      return t?.times && s.t >= t.times[1] ? t.times[1] : undefined;
    }
    case 'pack':
      return b?.pack?.start;
    case 'ship': {
      const o = r.order ? s.orders[r.order] : undefined;
      return o?.shipment ? s.shipments[o.shipment]?.t : undefined;
    }
    case 'truck': {
      const po = r.po ? s.pos[r.po] : undefined;
      if (!po || po.status !== 'arrived') return undefined;
      // встала к рампе — мгновение у партий фуры (Б5ж); фура ещё ждёт рампу — не начато
      const truck = s.trucks[`K${po.id.slice(1)}`];
      if (truck) {
        if (!truck.docked) return undefined;
        const c = s.units[truck.units[0]]?.items[0];
        return (c ? s.lots[s.containers[c].lot].docked : undefined) ?? s.t;
      }
      return Object.values(s.lots).find(l => l.po === po.id && l.docked !== undefined)?.docked ?? s.t;
    }
    case 'test': {
      // аналитик дошёл и начал подготовку пробы; результат ещё ждёт прибора и проверки вторым лицом
      const q = r.test ? s.tests[r.test] : undefined;
      if (!q) return s.t;
      if (q.started !== undefined) return s.t >= q.started ? q.started : undefined;
      return q.state === 'queued' ? undefined : s.t;
    }
    case 'repair':
    case 'release':
      return taskStart(s, taskOf(s, r));
    case 'visit': {
      const v = r.asset ? s.assets[r.asset]?.visit : undefined;
      return v ? v.from : s.t;
    }
    case 'assess': {
      const d = r.dev ? s.deviations[r.dev] : undefined;
      if (!d) return s.t;
      return d.status !== 'open' ? (d.assess?.done ?? s.t) : undefined;
    }
  }
}

/**
 * Чего ждёт неначатая строка сейчас: серия — её состояние; задача — причина ожидания; оценка отклонения — испытаний
 * балка в лаборатории; отгрузка — нехватка ГП.
 */
function waitOf(db: ContentDb, s: PlantState, r: DailyRow): DailyWhy | undefined {
  const b = r.batch ? s.batches[r.batch] : undefined;
  if ((r.kind === 'kit' || r.kind === 'stage' || r.kind === 'pack') && b) return phaseOf(db, s, b);
  if (r.kind === 'ship') return 'short';
  if (r.kind === 'assess') return r.dev && assessBlock(s, s.deviations[r.dev]) === 'bulkPending' ? 'lab' : undefined;
  return taskOf(s, r)?.why;
}

/** Срок строки: начать не позже §9.4 от плана; у решения по серии — к концу суток задания; у оценки отклонения — к его сроку по классу. */
const byOf = (task: DailyTask, r: DailyRow) => (r.kind === 'release' ? task.from + DAY : r.kind === 'assess' ? r.at : r.at + ON_TIME);

/** Каждый час: у строки — когда начата; у неначатой к сроку — чего ждала в этот миг. */
function watch(db: ContentDb, s: PlantState, task: DailyTask) {
  for (const r of task.rows) {
    if (r.done !== undefined) continue;
    const at = startOf(db, s, r);
    if (at !== undefined) {
      r.done = at;
      continue;
    }
    if (r.why === undefined && s.t >= byOf(task, r)) {
      const w = waitOf(db, s, r);
      if (w !== undefined) r.why = w;
    }
  }
}

/** Итог в следующие 08:00: в срок, позже — но в сутки, не сделано; у неначатой без причины — чего ждёт сейчас. */
function close(db: ContentDb, s: PlantState, task: DailyTask) {
  watch(db, s, task);
  const end = task.from + DAY;
  for (const r of task.rows) {
    if (r.done !== undefined && r.done < end) r.res = r.done <= byOf(task, r) ? 'ok' : 'late';
    else {
      r.res = 'no';
      if (r.why === undefined) {
        const w = waitOf(db, s, r);
        if (w !== undefined) r.why = w;
      }
    }
    // у отгрузки — не вся или не в срок: нехватка
    if (r.kind === 'ship' && r.order && s.orders[r.order] && s.orders[r.order].status !== 'shipped' && s.orders[r.order].status !== 'open') {
      r.res = 'no';
      r.why = 'short';
    }
  }
  task.closed = true;
}

/** Отдел, которого ждала строка (Б6б, «кто кого ждал»): по состоянию серии или причине задачи; свой — `undefined`. */
export function waitedFor(r: Pick<DailyRow, 'dept' | 'why'>): Dept | 'supply' | undefined {
  switch (r.why) {
    case 'materials':
      return 'supply';
    case 'kitting':
      return r.dept === 'wms' ? undefined : 'wms';
    case 'repair':
    case 'asset':
      return r.dept === 'maint' ? undefined : 'maint';
    case 'lab':
      return r.dept === 'qc' ? undefined : 'qc';
    case 'decision':
      return r.dept === 'qa' ? undefined : 'qa';
    case 'line':
      return r.dept === 'line' ? undefined : 'line';
    default:
      return undefined;
  }
}
