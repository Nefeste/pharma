// Сменно-суточные задания для окна (Б6б; docs/specs/2026-10-vertical-slice.md, «Б6б»): строки суток с подписями вещей —
// номер серии, стадия, помещение или линия, заказ и покупатель, заказ поставщику, методика и партия пробы, узел, актив,
// отклонение; итог и чего ждали — по записи суток (src/engine/daily.ts), а «после суток» — по записям завода: когда
// работа всё же началась. Для планёрки — по отделам вчера и сегодня; для полос расписания и карточек — их строки. Истины
// нет: запись суток и записи завода; у узла — только какой он, ни износа, ни запаса.
import type { ContentDb, Dept, Id } from '../content/types';
import { batchNo } from '../engine/batchno';
import { DAY } from '../engine/core/calendar';
import { waitedFor } from '../engine/daily';
import type { DailyKind, DailyRes, DailyRow, DailyTask, DailyWhy, PlantState } from '../engine/types';
import { thingOf } from './places';
import type { Thing } from './views';

/** Строка суток для окна. */
export interface DailyRowView {
  dept: Dept;
  kind: DailyKind;
  at: number;
  done?: number;
  res?: DailyRes;
  why?: DailyWhy;
  /** отдел, которого ждали; свой — нет */
  waited?: Dept | 'supply';
  /** не сделано в сутки, но начато позже — по записям завода */
  after?: number;
  batch?: string;
  /** номер серии, если досье выдано */
  code?: string;
  pack?: true;
  stage?: Id;
  room?: string;
  line?: string;
  order?: string;
  customer?: Id;
  po?: string;
  supplier?: Id;
  test?: string;
  method?: Id;
  /** партия пробы — её номер в учёте */
  lot?: string;
  part?: string;
  /** оборудование или машина узла */
  machine?: string;
  asset?: string;
  dev?: string;
  /** вещь на полу узла или актива — к её карточке */
  thing?: Thing;
}

/** Итог отдела за сутки: строк, начато в сутки, в срок, позже, не сделано; кого ждали дольше всего и сколько. */
export interface DailyDeptSum {
  dept: Dept;
  n: number;
  done: number;
  ok: number;
  late: number;
  no: number;
  main?: { who: Dept | 'supply' | 'own'; why: DailyWhy; sec: number };
}

/** Блок планёрки «Сменно-суточные задания»: вчерашнее — закрыто сегодня в 08:00; сегодняшнее — поставлено. */
export interface DailyMeeting {
  yday?: { from: number; depts: DailyDeptSum[]; rows: DailyRowView[] };
  today?: { from: number; depts: { dept: Dept; n: number }[]; rows: DailyRowView[] };
}

/** Отделы в порядке планёрки. */
const ORDER: readonly Dept[] = ['mes', 'line', 'wms', 'qc', 'qa', 'maint'];

const byDept = (a: { dept: Dept; at: number }, b: { dept: Dept; at: number }) => ORDER.indexOf(a.dept) - ORDER.indexOf(b.dept) || a.at - b.at;

/** Когда работа строки всё же началась — по записям завода; не началась или записи нет — нет. */
function laterOf(s: PlantState, r: DailyRow): number | undefined {
  const b = r.batch ? s.batches[r.batch] : undefined;
  switch (r.kind) {
    case 'kit':
      return r.pack ? b?.pack?.kitted : b?.issued;
    case 'stage':
      return b?.records.find(x => x.stage === r.stage)?.start;
    case 'pack':
      return b?.pack?.start;
    case 'ship': {
      const o = r.order ? s.orders[r.order] : undefined;
      return o?.shipment ? s.shipments[o.shipment]?.t : undefined;
    }
    case 'test':
      return r.test ? s.tests[r.test]?.started : undefined;
    default:
      return undefined;
  }
}

/** Строка для окна: подписи вещей из записей завода. */
export function rowView(db: ContentDb, s: PlantState, task: DailyTask, r: DailyRow): DailyRowView {
  const b = r.batch ? s.batches[r.batch] : undefined;
  const o = r.order ? s.orders[r.order] : undefined;
  const po = r.po ? s.pos[r.po] : undefined;
  const q = r.test ? s.tests[r.test] : undefined;
  const lot = q ? s.samples[q.sample]?.lot : undefined;
  const w = waitedFor(r);
  const later = task.closed && r.res === 'no' ? laterOf(s, r) : undefined;
  const on = r.part ? s.parts[r.part]?.machine : r.asset;
  const thing = on ? thingOf(db, s, on) : undefined;
  return {
    dept: r.dept,
    kind: r.kind,
    at: r.at,
    ...(r.done !== undefined ? { done: r.done } : {}),
    ...(r.res ? { res: r.res } : {}),
    ...(r.why ? { why: r.why } : {}),
    ...(w ? { waited: w } : {}),
    ...(later !== undefined && later >= task.from + DAY ? { after: later } : {}),
    ...(r.batch ? { batch: r.batch } : {}),
    ...(b && b.code.n > 0 ? { code: batchNo(b.code) } : {}),
    ...(r.pack ? { pack: true as const } : {}),
    ...(r.stage ? { stage: r.stage } : {}),
    ...(r.room ? { room: r.room } : {}),
    ...(r.line ? { line: r.line } : {}),
    ...(r.order ? { order: r.order } : {}),
    ...(o ? { customer: o.customer } : {}),
    ...(r.po ? { po: r.po } : {}),
    ...(po ? { supplier: po.supplier } : {}),
    ...(r.test ? { test: r.test } : {}),
    ...(q ? { method: q.method } : {}),
    ...(lot ? { lot } : {}),
    ...(r.part ? { part: r.part } : {}),
    ...(r.part && s.parts[r.part] ? { machine: s.parts[r.part].machine } : {}),
    ...(r.asset ? { asset: r.asset } : {}),
    ...(r.dev ? { dev: r.dev } : {}),
    ...(thing ? { thing } : {}),
  };
}

/**
 * Итог отдела за закрытые сутки: кого ждали дольше всего — сумма опоздания строк «позже» (от плана до начала) и «не
 * сделано» (от плана до конца суток) по отделу, которого ждали, или своему; причина — та, что у самой долгой строки.
 */
export function deptSum(task: DailyTask, dept: Dept): DailyDeptSum {
  const rows = task.rows.filter(r => r.dept === dept);
  const end = task.from + DAY;
  const wait = new Map<Dept | 'supply' | 'own', { sec: number; why: DailyWhy; top: number }>();
  for (const r of rows) {
    if (r.res === 'ok' || !r.why) continue;
    const sec = Math.max(0, (r.res === 'late' && r.done !== undefined ? r.done : end) - r.at);
    const who = waitedFor(r) ?? 'own';
    const x = wait.get(who) ?? { sec: 0, why: r.why, top: 0 };
    x.sec += sec;
    if (sec > x.top) {
      x.top = sec;
      x.why = r.why;
    }
    wait.set(who, x);
  }
  let main: DailyDeptSum['main'];
  for (const [who, x] of wait) if (!main || x.sec > main.sec) main = { who, why: x.why, sec: x.sec };
  return {
    dept,
    n: rows.length,
    done: rows.filter(r => r.res === 'ok' || r.res === 'late').length,
    ok: rows.filter(r => r.res === 'ok').length,
    late: rows.filter(r => r.res === 'late').length,
    no: rows.filter(r => r.res === 'no').length,
    ...(main ? { main } : {}),
  };
}

/** Блок планёрки: задание, закрытое в 08:00 дня планёрки, и поставленное тогда же. */
export function dailyMeeting(db: ContentDb, s: PlantState, at: number): DailyMeeting {
  const list = s.daily ?? [];
  const yday = list.find(d => d.closed && d.from === at - DAY);
  const today = list.find(d => d.from === at);
  const depts = (d: DailyTask) => ORDER.filter(x => d.rows.some(r => r.dept === x));
  return {
    ...(yday ? { yday: { from: yday.from, depts: depts(yday).map(x => deptSum(yday, x)), rows: yday.rows.map(r => rowView(db, s, yday, r)).sort(byDept) } } : {}),
    ...(today ? { today: { from: today.from, depts: depts(today).map(x => ({ dept: x, n: today.rows.filter(r => r.dept === x).length })), rows: today.rows.map(r => rowView(db, s, today, r)).sort(byDept) } } : {}),
  };
}

/** Отметка полосы расписания: строка суток комплектовки, стадии или упаковки серии — в задании на сутки и её итог. */
export interface DailyMark {
  kind: 'kit' | 'stage' | 'pack';
  batch: string;
  stage?: Id;
  pack?: true;
  /** с какого мгновения сутки задания */
  from: number;
  at: number;
  done?: number;
  res?: DailyRes;
  why?: DailyWhy;
  after?: number;
}

/** Отметки полос, у которых план — в окне `[from, to)` расписания. */
export function dailyMarks(db: ContentDb, s: PlantState, from: number, to: number): DailyMark[] {
  const out: DailyMark[] = [];
  for (const d of s.daily ?? []) {
    if (d.from + DAY <= from - DAY || d.from >= to) continue;
    for (const r of d.rows) {
      if ((r.kind !== 'kit' && r.kind !== 'stage' && r.kind !== 'pack') || !r.batch) continue;
      const v = rowView(db, s, d, r);
      out.push({
        kind: r.kind,
        batch: r.batch,
        ...(r.stage ? { stage: r.stage } : {}),
        ...(r.pack ? { pack: true as const } : {}),
        from: d.from,
        at: r.at,
        ...(r.done !== undefined ? { done: r.done } : {}),
        ...(r.res ? { res: r.res } : {}),
        ...(r.why ? { why: r.why } : {}),
        ...(v.after !== undefined ? { after: v.after } : {}),
      });
    }
  }
  return out;
}

/**
 * Строки сегодняшнего задания у вещи карточки: помещения — стадии в нём и испытания на его приборах (прибор на полу — его
 * помещение), линии — её задания на упаковку.
 */
export function dailyOf(db: ContentDb, s: PlantState, thing: { room?: string; line?: string }): DailyRowView[] {
  const d = s.daily?.at(-1);
  if (!d || d.closed) return [];
  const insts = thing.room !== undefined ? new Set(Object.values(s.instruments).filter(i => i.room === thing.room).map(i => i.type)) : new Set<Id>();
  const onInst = (r: DailyRow) => r.kind === 'test' && !!r.test && insts.has(db.tests[s.tests[r.test]?.method]?.inst ?? '');
  return d.rows
    .filter(r => (thing.room !== undefined ? r.room === thing.room || onInst(r) : thing.line !== undefined && r.line === thing.line))
    .map(r => rowView(db, s, d, r))
    .sort(byDept);
}
