// Сменно-суточное задание (Б6б; docs/specs/2026-10-vertical-slice.md, «Б6б»; ГОСТ Р МЭК 62264-3, п. 6.7.4 — плановое
// (сменное) задание: заказ-наряды, готовые к исполнению, у каждого — время начала по детальному плану). В 08:00 у каждого
// отдела — строки на сутки до следующих 08:00: по прогону расписания с горизонтом в сутки — комплектовки, стадии и
// упаковка, — и по очередям этого мига — отгрузки и фуры дня, испытания, сколько успеют аналитики смены, ремонты, визиты
// подрядчика, решения ООК. Каждый час у строки, начатой не позже часа от плана, — когда начата; неначатой через час —
// чего ждали. В следующие 08:00 — итог по записям завода. Это запись завода, без истины: правила её не читают, жизнь
// завода от неё не меняется (п. 6.10.3: отслеживание сравнивает факт с планом).
import type { ContentDb, Dept } from '../content/types';
import { DAY, HOUR, momentOf } from './core/calendar';
import { QC } from './lab';
import { phaseOf } from './lean';
import { forecast } from './plan/schedule';
import { spanOn } from './shifts';
import type { DailyRow, DailyTask, DailyWhy, PlantState } from './types';

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

/** Поставить задание на сутки с этого мига. */
function open(db: ContentDb, s: PlantState): DailyTask {
  const t0 = s.t;
  const t1 = s.t + DAY;
  const rows: DailyRow[] = [];
  // производство, упаковка и комплектовка — по прогону расписания: то, что по плану начнётся в эти сутки
  for (const b of forecast(db, s, [], [], [], t1).bars) {
    if (b.when !== 'plan' || !b.batch || b.from < t0 || b.from >= t1) continue;
    if (b.kind === 'kit') rows.push({ dept: 'wms', kind: 'kit', batch: b.batch, ...(b.pack ? { pack: true as const } : {}), at: b.from });
    else if (b.kind === 'stage' && b.stage) rows.push({ dept: 'mes', kind: 'stage', batch: b.batch, stage: b.stage, room: b.row, at: b.from });
    else if (b.kind === 'pack') rows.push({ dept: 'line', kind: 'pack', batch: b.batch, room: b.row, at: b.from });
  }
  // склад: отгрузки заказов со сроком в эти сутки и фуры поставщиков, которые должны встать к рампе
  for (const o of Object.values(s.orders)) if (o.status === 'open' && o.due >= t0 && o.due < t1) rows.push({ dept: 'wms', kind: 'ship', order: o.id, at: o.due });
  for (const p of Object.values(s.pos)) if (p.status === 'ordered' && p.eta >= t0 && p.eta < t1) rows.push({ dept: 'wms', kind: 'truck', po: p.id, at: p.eta });
  rows.push(...labRows(db, s, t0, t1));
  // техслужба: ремонты и замены узлов, которые ждут людей; визиты подрядчика, назначенные на эти сутки
  for (const t of Object.values(s.tasks)) if (t.kind === 'repair' && t.state === 'open' && t.part) rows.push({ dept: 'maint', kind: 'repair', part: t.part, ...(t.room ? { room: t.room } : {}), at: t0 });
  for (const a of Object.values(s.assets)) if (a.visit && a.visit.from === undefined && a.visit.at < t1) rows.push({ dept: 'maint', kind: 'visit', asset: a.id, at: Math.max(t0, a.visit.at) });
  // ООК и уполномоченное лицо: решения по сериям, проверки ГП и оценки отклонений, которые ждут
  for (const t of Object.values(s.tasks)) {
    if (t.state !== 'open') continue;
    const kind = t.kind === 'qpDecide' ? 'release' : t.kind === 'fgCheck' ? 'check' : t.kind === 'devAssess' ? 'assess' : undefined;
    if (kind) rows.push({ dept: 'qa', kind, ...(t.batch ? { batch: t.batch } : {}), ...(t.dev ? { dev: t.dev } : {}), at: t0 });
  }
  return { from: t0, rows };
}

/**
 * ОКК: испытания очереди лаборатории — по её порядку: приоритет работы, поднятые игроком выше (3г), — пока хватает
 * часов аналитиков в смене по нормам методик (ГОСТ Р МЭК 62264-3, п. 6.6.4: конечная производительность). Срок строки —
 * конец суток.
 */
function labRows(db: ContentDb, s: PlantState, t0: number, t1: number): DailyRow[] {
  let left = 0;
  const day = momentOf(s.start, t0).day;
  for (const p of Object.values(s.people)) {
    if (!(QC.analysts as readonly string[]).includes(p.role)) continue;
    for (const z of [day, day + 1]) {
      const span = spanOn(db, s, p, z);
      if (span) left += Math.max(0, Math.min(span[1], t1) - Math.max(span[0], t0));
    }
  }
  const out: DailyRow[] = [];
  const queue = Object.values(s.tasks)
    .filter(t => t.kind === 'prep' && t.state === 'open' && t.test && s.tests[t.test]?.state === 'queued')
    .sort((a, c) => c.prio - a.prio || Number(a.id.slice(1)) - Number(c.id.slice(1)));
  for (const t of queue) {
    if (t.work > left) break;
    left -= t.work;
    out.push({ dept: 'qc', kind: 'test', test: t.test!, at: t0 });
  }
  return out;
}

/**
 * Когда строка начата (у отгрузки — фура ушла, у фуры — встала к рампе, у испытания — аналитик взял пробу в работу); ещё
 * нет — `undefined`. Без записи мгновения — час, когда это увидели.
 */
function startOf(db: ContentDb, s: PlantState, r: DailyRow): number | undefined {
  const b = r.batch ? s.batches[r.batch] : undefined;
  switch (r.kind) {
    case 'kit':
      if (!b) return undefined;
      if (!r.pack) return b.issued;
      return b.pack && b.pack.state !== 'waiting' && b.pack.state !== 'reserved' ? (b.pack.taken ?? s.t) : undefined;
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
    case 'truck':
      return r.po && s.pos[r.po]?.status === 'arrived' ? s.t : undefined;
    case 'test': {
      // аналитик взял пробу в работу — задача подготовки занята; результат ещё ждёт прибора и проверки вторым лицом
      const q = r.test ? s.tests[r.test] : undefined;
      if (!q || q.state !== 'queued') return s.t;
      const t = Object.values(s.tasks).find(x => x.kind === 'prep' && x.test === r.test && x.state === 'busy');
      return t?.times && s.t >= t.times[1] ? t.times[1] : undefined;
    }
    case 'repair': {
      const pt = r.part ? s.parts[r.part] : undefined;
      const t = pt?.task ? s.tasks[pt.task] : undefined;
      // задача ремонта ушла — узел исправен или заменён; идёт — люди дошли
      if (!t || t.kind !== 'repair') return s.t;
      return t.state === 'busy' && t.times && s.t >= t.times[1] ? t.times[1] : undefined;
    }
    case 'visit': {
      const v = r.asset ? s.assets[r.asset]?.visit : undefined;
      return v ? v.from : s.t;
    }
    case 'release':
    case 'check':
    case 'assess': {
      const kind = r.kind === 'release' ? 'qpDecide' : r.kind === 'check' ? 'fgCheck' : 'devAssess';
      const t = Object.values(s.tasks).find(x => x.kind === kind && (r.batch ? x.batch === r.batch : x.dev === r.dev));
      if (!t) return s.t;
      return t.state === 'busy' && t.times && s.t >= t.times[1] ? t.times[1] : undefined;
    }
  }
}

/** Чего ждёт неначатая строка сейчас: серия — её состояние; задача — причина ожидания; отгрузка — нехватка ГП. */
function waitOf(db: ContentDb, s: PlantState, r: DailyRow): DailyWhy | undefined {
  const b = r.batch ? s.batches[r.batch] : undefined;
  if ((r.kind === 'kit' || r.kind === 'stage' || r.kind === 'pack') && b) return phaseOf(db, s, b);
  const t =
    r.kind === 'test'
      ? Object.values(s.tasks).find(x => x.kind === 'prep' && x.test === r.test)
      : r.kind === 'repair'
        ? (r.part && s.parts[r.part]?.task ? s.tasks[s.parts[r.part].task!] : undefined)
        : r.kind === 'release' || r.kind === 'check' || r.kind === 'assess'
          ? Object.values(s.tasks).find(x => x.kind === (r.kind === 'release' ? 'qpDecide' : r.kind === 'check' ? 'fgCheck' : 'devAssess') && (r.batch ? x.batch === r.batch : x.dev === r.dev))
          : undefined;
  if (t?.why) return t.why;
  if (r.kind === 'ship') return 'short';
  return undefined;
}

/** Срок строки: начать не позже часа от плана; испытание — к концу суток. */
const byOf = (task: DailyTask, r: DailyRow) => (r.kind === 'test' ? task.from + DAY : r.at + ON_TIME);

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
