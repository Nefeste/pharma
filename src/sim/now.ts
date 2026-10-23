// «Сейчас» (этап Б, Б1б; docs/specs/2026-10-vertical-slice.md): что идёт на заводе одним списком — стадии серий, уборки,
// упаковка, испытания, ремонты, работа подрядчика (Б3в), фуры у рамп, склад, качество и шаги расследования. Сколько работа идёт, окно считает по
// своим часам от мгновения начала; рядом — норма, которую знает завод: длительность стадии по карте, время уборки,
// методики, норма задачи, у ремонта после отказа — «от и до» из записи узла. Сколько работа продлится на самом деле —
// вытянутый движком разброс стадии и ремонта — в виде нет.
import type { ContentDb, Id } from '../content/types';
import { contractor } from '../engine/assets';
import { batchNo } from '../engine/batchno';
import { momentOf } from '../engine/core/calendar';
import { geo, SIXTY } from '../engine/line';
import { partType } from '../engine/maint';
import { cleanWork, nominal } from '../engine/mes';
import { classOf } from '../engine/places';
import { planOf } from '../engine/plant';
import { scheduleOn } from '../engine/shifts';
import type { AssetFamily, PlantState, Task, TaskKind } from '../engine/types';
import { assetInfo } from './places';
import type { Thing } from './views';

export interface NowQuery {
  view: 'now';
}

/** Раздел списка: производство, упаковка, лаборатория, склад и рампы, техслужба, качество, расследование. */
export type NowDept = 'mes' | 'line' | 'qc' | 'wms' | 'maint' | 'qa' | 'inv';
export const NOW_DEPTS: readonly NowDept[] = ['mes', 'line', 'qc', 'wms', 'maint', 'qa', 'inv'];

export interface NowRow {
  /** по нему «Смотреть» узнаёт, что работа кончилась: задача, испытание, задание линии, фура */
  key: string;
  dept: NowDept;
  /**
   * вид работы: вид задачи движка; `pack` — упаковка серии, `test` — испытание, `truck` — фура у рампы, `visit` —
   * подрядчик, `audit` — аудитор у изготовителя (Б3г)
   */
  kind: TaskKind | 'pack' | 'test' | 'truck' | 'visit' | 'audit';
  batch?: string;
  stage?: string;
  /** партия: год, месяц, номер — как в карточке */
  lot?: [number, number, number];
  method?: Id;
  /** испытание: подготовка, прибор работает, проверка результата */
  phase?: 'prep' | 'run' | 'review';
  /** вид прибора, оборудования или машины; узел по записи вида */
  inst?: Id;
  machine?: Id;
  part?: string;
  /** вид помещения */
  room?: string;
  line?: number;
  sku?: Id;
  supplier?: Id;
  customer?: Id;
  /** уборка генеральная */
  major?: boolean;
  /** замена узла по плану, а не ремонт после отказа */
  planned?: boolean;
  /** работа подрядчика и её приёмка (Б3в): актив — вещь плана, его род, инвентарный номер, квалификация или калибровка */
  asset?: string;
  family?: AssetFamily;
  inv?: number;
  work?: 'qual' | 'cal';
  /** оценка пары «поставщик — изготовитель» (Б3г): изготовитель, как оценивают; аудит — до какого мгновения */
  maker?: Id;
  how?: 'audit' | 'docs';
  until?: number;
  /** люди: номера, как в срезе, и роли */
  people: { n: number; role: Id }[];
  /** работа идёт после конца смены (Б4а): сверхурочно с какого мгновения — у того, у кого смена кончилась раньше */
  over?: number;
  /** чья смена ведёт работу (Б4б): сменный по циклу график первого из людей, если он в таком */
  crew?: Id;
  /** с какого мгновения идёт, с; норма — с; у ремонта после отказа — от и до */
  from: number;
  norm?: number;
  range?: [number, number];
  /** упаковка: годных пачек за задание и по теории серии; пачек в минуту у картонажной сейчас и по номиналу */
  done?: number;
  target?: number;
  rate?: number;
  rated?: number;
  /** где работа — камера и карточка */
  thing?: Thing;
}

export interface NowView {
  view: 'now';
  rows: NowRow[];
}

const DEPT: Partial<Record<TaskKind, NowDept>> = {
  stage: 'mes',
  clean: 'mes',
  pick: 'wms',
  transfer: 'wms',
  return: 'wms',
  changeover: 'line',
  clearance: 'line',
  clearCheck: 'line',
  feed: 'line',
  sample: 'qc',
  handover: 'qc',
  decide: 'qc',
  repair: 'maint',
  invFix: 'maint',
  fgCheck: 'qa',
  qpDecide: 'qa',
  invStep: 'inv',
  // обучение (Б3б) ведёт ООК
  train: 'qa',
  trainCheck: 'qa',
  // приёмка работы подрядчика (Б3в): калибровку принимает начальник ОКК, квалификацию — специалист ООК
  accept: 'qa',
  // оценка поставщика (Б3г): отчёт аудитора и документы рассматривает специалист ООК
  vendorReview: 'qa',
  devAssess: 'qa',
};

/** Задачи, которые идут в своих строках: смена у линии — в строке упаковки, подготовка и проверка — в строке испытания, фура — в строке фуры. */
const FOLDED = new Set<TaskKind>(['crew', 'prep', 'review', 'truckCheck', 'unload', 'load']);

const num = (id: string) => Number(id.slice(1));

/** С какого мгновения люди работают после конца смены, в которую взяли задачу (Б4а); никто — `undefined`. */
function overSince(s: PlantState, people: readonly string[]): number | undefined {
  let at: number | undefined;
  for (const id of people) {
    const u = s.people[id]?.until;
    if (u !== undefined && s.t > u && (at === undefined || u < at)) at = u;
  }
  return at;
}
const codeOf = (c: { y: number; m: number; n: number }): [number, number, number] => [c.y, c.m, c.n];

export function nowView(db: ContentDb, s: PlantState): NowView {
  const plan = planOf(db, s.plant);
  const roomIx = (id: string) => plan.plant.rooms.findIndex(r => r.id === id);
  const roomType = (id: string) => plan.plant.rooms.find(r => r.id === id)?.type;
  const lab = plan.plant.rooms.findIndex(r => r.type === 'lab');
  const peopleOf = (ids: readonly string[]) => ids.filter(id => s.people[id]).map(id => ({ n: num(id), role: s.people[id].role }));
  const startOf = (t: Task) => t.times?.[1] ?? t.created;
  const busy = Object.values(s.tasks).filter(t => t.state === 'busy');
  const rows: NowRow[] = [];

  for (const t of busy) {
    if (FOLDED.has(t.kind)) continue;
    const row: NowRow = { key: t.id, dept: DEPT[t.kind] ?? 'wms', kind: t.kind, people: peopleOf(t.people), from: startOf(t) };
    const b = t.batch ? s.batches[t.batch] : undefined;
    if (b) row.batch = batchNo(b.code);
    const lot = t.lot ? s.lots[t.lot] : undefined;
    if (lot) row.lot = codeOf(lot.code);
    if (t.kind === 'stage' && b) {
      const st = db.recipes[b.recipe].stages[b.stage];
      row.stage = st.id;
      // после отказа стадия идёт дальше с того же начала; по карте — на массу серии
      row.from = b.run?.start ?? row.from;
      row.norm = nominal(db, b.recipe, st, b.mass);
      if (b.room) {
        row.room = roomType(b.room);
        row.thing = { kind: 'room', i: roomIx(b.room) };
      }
    } else if (t.kind === 'clean' && t.room) {
      const r = s.rooms[t.room];
      row.room = roomType(t.room);
      row.major = !!r?.major;
      row.norm = cleanWork(db, s, t.room, !!r?.major);
      row.thing = { kind: 'room', i: roomIx(t.room) };
    } else if ((t.kind === 'repair' || t.kind === 'invFix') && t.part) {
      const pt = s.parts[t.part];
      if (pt) {
        const type = partType(db, pt);
        row.part = pt.type;
        row.machine = pt.of;
        row.planned = !!t.planned;
        if (t.kind === 'repair') {
          if (t.planned) row.norm = type.replace;
          else row.range = [...type.repair];
        } else row.norm = t.work;
        const li = pt.line ? plan.plant.lines.findIndex(l => l.id === pt.line) : -1;
        row.thing =
          li >= 0
            ? { kind: 'machine', line: li, k: plan.plant.lines[li].machines.findIndex(m => m.id === pt.machine) }
            : { kind: 'equipment', i: plan.plant.equipment.findIndex(e => e.id === pt.machine) };
      }
    } else if (t.kind === 'accept' && t.asset && s.assets[t.asset]) {
      const a = s.assets[t.asset];
      row.asset = a.id;
      row.family = a.family;
      row.inv = a.inv;
      row.machine = a.type;
      if (a.visit) {
        row.work = a.visit.work;
        if (a.visit.work === 'cal') row.dept = 'qc';
      }
      row.norm = t.work;
      const info = assetInfo(db, s, a.id);
      if (info?.thing) row.thing = info.thing;
    } else if (t.kind === 'vendorReview' && t.pair && s.pairs[t.pair]) {
      const p = s.pairs[t.pair];
      row.supplier = p.supplier;
      row.maker = p.maker;
      if (p.eval) row.how = p.eval.how;
      row.norm = t.work;
    } else {
      // норма задачи — время работы на месте; дорога до места — нет
      if (t.work > 0) row.norm = t.work;
      if (t.unit && s.units[t.unit]) row.thing = { kind: 'unit', n: num(t.unit) };
      else if (t.people[0]) row.thing = { kind: 'person', n: num(t.people[0]) };
      if (t.line) row.line = plan.plant.lines.findIndex(l => l.id === t.line) + 1;
    }
    if (!row.thing && t.people[0]) row.thing = { kind: 'person', n: num(t.people[0]) };
    rows.push(row);
  }

  // упаковка: задание серии на линии — годные пачки за задание, скорость картонажной; люди — смена у линии
  for (const [li, l] of plan.plant.lines.entries()) {
    const line = s.lines[l.id];
    const b = line?.batch ? s.batches[line.batch] : undefined;
    const job = b?.pack;
    if (!line || !b || !job || job.state !== 'running') continue;
    const sku = db.skus[job.sku];
    const g = geo(db, s, line, job.sku);
    const k = l.machines.findIndex(m => db.machines[m.type].item === 'carton');
    const mc = line.machines[k];
    const crew = busy.filter(t => (t.kind === 'crew' || t.kind === 'feed') && t.line === l.id).flatMap(t => t.people);
    rows.push({
      key: `pack:${b.id}`,
      dept: 'line',
      kind: 'pack',
      batch: batchNo(b.code),
      sku: job.sku,
      line: li + 1,
      people: peopleOf([...new Set(crew)]),
      from: job.start ?? job.taken ?? s.t,
      done: line.made,
      target: Math.floor(job.tablets / (sku.perBlister * sku.blisters)),
      rate: mc ? Math.round((mc.rate * 60) / (g.unit[k] * SIXTY)) : 0,
      rated: db.machines[l.machines[k].type].nominal,
      thing: { kind: 'machine', line: li, k: Math.max(0, k) },
    });
  }

  // испытания: подготовка — с задачей аналитика, прибор работает сам — с события его конца, проверка — с задачей проверяющего
  for (const q of Object.values(s.tests)) {
    if (q.state !== 'prep' && q.state !== 'run' && q.state !== 'review') continue;
    const m = db.tests[q.method];
    const task = busy.find(t => (t.kind === 'prep' || t.kind === 'review') && t.test === q.id);
    // подготовка ещё не началась (аналитик идёт) или проверку ещё никто не взял — не идёт
    if (q.state !== 'run' && !task) continue;
    let from = task ? startOf(task) : s.t;
    let norm = task?.work;
    if (q.state === 'run') {
      const due = s.agenda.heap.find(d => d.e.kind === 'run' && d.e.test === q.id && d.e.v === q.v);
      from = due ? due.t - m.run : s.t;
      norm = m.run;
    }
    const sample = s.samples[q.sample];
    const lot = sample ? s.lots[sample.lot] : undefined;
    rows.push({
      key: `test:${q.id}`,
      dept: 'qc',
      kind: 'test',
      method: q.method,
      phase: q.state,
      ...(q.inst && s.instruments[q.inst] ? { inst: s.instruments[q.inst].type } : {}),
      ...(lot ? { lot: codeOf(lot.code) } : {}),
      people: peopleOf(task?.people ?? []),
      from,
      ...(norm !== undefined ? { norm } : {}),
      ...(lab >= 0 ? { thing: { kind: 'room', i: lab } as Thing } : {}),
    });
  }

  // подрядчик у актива (Б3в): с начала его работы, норма — часы работы класса; людей завода в ней нет
  for (const a of Object.values(s.assets)) {
    const v = a.visit;
    if (!v || v.from === undefined || !contractor(a, s.t)) continue;
    const info = assetInfo(db, s, a.id);
    rows.push({
      key: `visit:${a.id}:${v.from}`,
      dept: 'maint',
      kind: 'visit',
      asset: a.id,
      family: a.family,
      inv: a.inv,
      work: v.work,
      machine: a.type,
      people: [],
      from: v.from,
      norm: classOf(db, a)[v.work]?.work ?? 0,
      ...(info?.thing ? { thing: info.thing } : {}),
    });
  }

  // аудитор у изготовителя (Б3г): с начала аудита до отчёта; людей завода в нём нет
  for (const p of Object.values(s.pairs)) {
    const e = p.eval;
    if (e?.how !== 'audit' || e.from === undefined || e.to === undefined || s.t < e.from || s.t >= e.to) continue;
    rows.push({ key: `audit:${p.id}:${e.from}`, dept: 'qa', kind: 'audit', supplier: p.supplier, maker: p.maker, how: 'audit', people: [], from: e.from, until: e.to });
  }

  // фуры у рамп: с прихода; люди — проверка, разгрузка и погрузка этой фуры
  for (const tr of Object.values(s.trucks)) {
    if (!tr.docked) continue;
    const po = tr.po ? s.pos[tr.po] : undefined;
    const ids = busy.filter(t => (t.kind === 'truckCheck' || t.kind === 'unload') && t.from.kind === 'truck' && t.from.id === tr.id).concat(busy.filter(t => t.kind === 'load' && t.truck === tr.id));
    rows.push({
      key: `truck:${tr.id}`,
      dept: 'wms',
      kind: 'truck',
      ...(tr.customer ? { customer: tr.customer } : {}),
      ...(po ? { supplier: po.supplier } : {}),
      people: peopleOf([...new Set(ids.flatMap(t => t.people))]),
      from: tr.arrived,
      thing: { kind: 'truck', n: num(tr.id), customer: !!tr.customer },
    });
  }

  // работа после конца смены (Б4а): сверхурочно — с конца смены того, у кого она кончилась раньше
  for (const r of rows) {
    const over = overSince(s, r.people.map(x => `E${x.n}`));
    if (over !== undefined) r.over = over;
    // бригада (Б4б): сменный по циклу график первого из людей — сегодня
    const first = r.people[0] && s.people[`E${r.people[0].n}`];
    const sh = first && scheduleOn(first, momentOf(s.start, s.t).day);
    if (sh && db.shifts[sh].cycle) r.crew = sh;
  }
  rows.sort((a, b) => NOW_DEPTS.indexOf(a.dept) - NOW_DEPTS.indexOf(b.dept) || a.from - b.from || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { view: 'now', rows };
}
