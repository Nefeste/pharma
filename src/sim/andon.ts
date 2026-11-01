// Андон (Б1к; docs/specs/2026-10-vertical-slice.md, «Б1к»; docs/13-art.md, §11): что на заводе не работает сейчас —
// значок со словом причины над вещью. Правила — те же, что у карточек, «Сейчас» и часовых тревог (src/engine/alerts.ts):
// узел отказал и ждёт ремонта или в ремонте; у актива нет записи о квалификации или калибровке в силе или у него
// подрядчик; помещение ждёт уборки, её ждёт серия, аппаратчики стадии в смене, а уборщиков нет; задача ждёт «нет
// допуска», «нет часов» или «в отпуске»; фура поставщика ждёт разгрузки дольше 2 часов; серия не получила материала к
// своему «не раньше»; заказ покупателя под угрозой. Вес — как у извещения: «стоп» — на что в прототипе есть автопауза,
// остальное — «внимание». У вещи несколько проблем — значок один, самого тяжёлого веса. Только то, что знает завод: что
// узел отказал, видно по остановке, а ресурса узла здесь нет (docs/02-architecture.md, §9).
import type { ContentDb, Id } from '../content/types';
import { TRUCK_WAIT } from '../engine/alerts';
import { type Unfit, unfit } from '../engine/assets';
import { batchNo } from '../engine/batchno';
import { orderRisks } from '../engine/market';
import { roomAt } from '../engine/places';
import { planOf, type PlantPlan } from '../engine/plant';
import { shiftEnd } from '../engine/staff';
import type { PlantState, Task, TaskKind, WaitCause } from '../engine/types';
import { assetInfo, thingOf } from './places';
import type { AssetInfo } from './places';
import type { Thing } from './views';

export interface AndonQuery {
  view: 'andon';
}

/** Вид проблемы — по порядку тяжести: сначала «стоп», потом «внимание». */
export const ANDON = ['fail', 'qual', 'cal', 'truck', 'material', 'order', 'admission', 'hours', 'leave', 'clean', 'visit'] as const;
export type AndonKind = (typeof ANDON)[number];
export type AndonWeight = 'stop' | 'attention';

/** Вес вида — как у извещения (13-art.md, §11): «стоп» у того, на что в прототипе есть автопауза. */
export const WEIGHT: Record<AndonKind, AndonWeight> = {
  fail: 'stop',
  qual: 'stop',
  cal: 'stop',
  truck: 'stop',
  material: 'stop',
  order: 'stop',
  admission: 'attention',
  hours: 'attention',
  leave: 'attention',
  clean: 'attention',
  visit: 'attention',
};

/** Что именно не работает: вид, с какого мгновения и подробность — то, что знает завод. */
export interface AndonWhy {
  kind: AndonKind;
  since?: number;
  /** узел, который отказал (вид узла в записи машины) */
  part?: string;
  /** актив без записи или с подрядчиком */
  asset?: AssetInfo;
  /** задача, которая ждёт, и документ, которого не хватает */
  task?: TaskKind;
  lack?: string;
  /** серия — номер; материалы, которых не хватило */
  batch?: string;
  short?: Id[];
  /** фура поставщика — номер заказа поставщику */
  po?: string;
  supplier?: Id;
  /** заказ покупателя — номер, покупатель, срок, сколько ящиков не хватает */
  order?: string;
  customer?: Id;
  due?: number;
  missing?: number;
}

/** Значок андона: вещь, вид и вес первой проблемы, все проблемы вещи — по тяжести. */
export interface AndonItem {
  thing: Thing;
  kind: AndonKind;
  weight: AndonWeight;
  why: AndonWhy[];
}

export interface AndonView {
  view: 'andon';
  items: AndonItem[];
}

const num = (id: string) => Number(id.slice(1));
/** Ожидание задачи — вид андона; остальные ожидания — не андон: люди заняты, смена не та, место или прибор заняты. */
const TASK_WAIT: Partial<Record<WaitCause, AndonKind>> = { qual: 'admission', hours: 'hours', leave: 'leave' };
/** Обучение ставят заранее и ждёт оно свободного часа — это не простой (lean.ts, `PLANNED`). */
const PLANNED: ReadonlySet<TaskKind> = new Set(['train', 'trainCheck']);
/** Задачи лаборатории и ООК — у их помещений. */
const LAB: ReadonlySet<TaskKind> = new Set(['toSampling', 'sample', 'fromSampling', 'handover', 'prep', 'review', 'decide']);
const QA: ReadonlySet<TaskKind> = new Set(['fgCheck', 'qpDecide', 'devAssess', 'vendorReview', 'invStep']);

/** Вещь — помещение по id. */
function roomThing(plan: PlantPlan, id: string | undefined): Thing | undefined {
  const i = id ? plan.plant.rooms.findIndex(r => r.id === id) : -1;
  return i >= 0 ? { kind: 'room', i } : undefined;
}

/** Вещь узла: машина линии или оборудование. */
function partThing(plan: PlantPlan, machine: string, line?: string): Thing | undefined {
  const li = line ? plan.plant.lines.findIndex(l => l.id === line) : -1;
  if (li >= 0) return { kind: 'machine', line: li, k: Math.max(0, plan.plant.lines[li].machines.findIndex(m => m.id === machine)) };
  const i = plan.plant.equipment.findIndex(e => e.id === machine);
  return i >= 0 ? { kind: 'equipment', i } : undefined;
}

/** Помещение ООК — где пост уполномоченного лица (как место решения по серии в учёте, lean.ts). */
function qaRoom(plan: PlantPlan): string | undefined {
  const qp = plan.plant.posts['role.qp'];
  return (qp && roomAt(plan.plant, qp[0], qp[1])) ?? plan.roomOf.office;
}

/**
 * Вещь задачи: узел — его машина; актив — его вещь; паллета; фура; стадия — помещение серии; уборка — её помещение;
 * работа линии — помещение линии; лаборатория и ООК — их помещения; иначе — помещение места задачи.
 */
function taskThing(db: ContentDb, s: PlantState, plan: PlantPlan, t: Task): Thing | undefined {
  if (t.part && s.parts[t.part]) return partThing(plan, s.parts[t.part].machine, s.parts[t.part].line);
  if (t.asset && s.assets[t.asset]) return thingOf(db, s, t.asset, plan);
  if (t.unit && s.units[t.unit]) return { kind: 'unit', n: num(t.unit) };
  if (t.truck && s.trucks[t.truck]) {
    const tr = s.trucks[t.truck];
    return { kind: 'truck', n: num(tr.id), customer: !!tr.customer, ...(tr.waste ? { waste: true as const } : {}) };
  }
  if (t.kind === 'stage' && t.batch) {
    const b = s.batches[t.batch];
    const room = b?.room ?? (b ? plan.roomOf[db.recipes[b.recipe].stages[b.stage].room] : undefined);
    return roomThing(plan, room);
  }
  if (t.room) return roomThing(plan, t.room);
  if (t.line) return roomThing(plan, plan.plant.lines.find(l => l.id === t.line)?.room);
  if (LAB.has(t.kind)) return roomThing(plan, plan.roomOf.lab);
  if (QA.has(t.kind)) return roomThing(plan, qaRoom(plan));
  const p = t.from;
  if (p.kind === 'truck' && s.trucks[p.id]) {
    const tr = s.trucks[p.id];
    return { kind: 'truck', n: num(tr.id), customer: !!tr.customer, ...(tr.waste ? { waste: true as const } : {}) };
  }
  const at = p.kind === 'slot' ? plan.slot[p.id] : p.kind === 'point' ? p : undefined;
  return at ? roomThing(plan, roomAt(plan.plant, at.x, at.z)) : undefined;
}

const key = (t: Thing) => JSON.stringify(t);

/** Вид «Андон»: что не работает сейчас — по вещам, в порядке плана: помещения, оборудование, машины, фуры, паллеты. */
export function andonView(db: ContentDb, s: PlantState): AndonView {
  const plan = planOf(db, s.plant);
  const byThing = new Map<string, { thing: Thing; why: AndonWhy[] }>();
  const add = (thing: Thing | undefined, why: AndonWhy) => {
    if (!thing) return;
    const k = key(thing);
    const x = byThing.get(k) ?? { thing, why: [] };
    x.why.push(why);
    byThing.set(k, x);
  };
  // узел отказал: ждёт ремонта или в ремонте — до конца ремонта
  for (const p of Object.values(s.parts)) {
    if (p.state !== 'failed') continue;
    add(partThing(plan, p.machine, p.line), { kind: 'fail', part: p.type, ...(p.failed !== undefined ? { since: p.failed } : {}) });
  }
  // актив без записи в силе или с подрядчиком (Б3в) — над его вещью, прибор и датчик — над их помещением
  for (const id of Object.keys(s.assets)) {
    const why: Unfit | undefined = unfit(db, s, id);
    if (!why) continue;
    const asset = assetInfo(db, s, id);
    add(thingOf(db, s, id, plan), { kind: why, ...(asset ? { asset } : {}) });
  }
  // задачи, которые ждут не людей, а допуска, часов или конца отпуска
  for (const t of Object.values(s.tasks)) {
    if (t.state !== 'open' || !t.why || PLANNED.has(t.kind)) continue;
    const kind = TASK_WAIT[t.why];
    if (!kind) continue;
    add(taskThing(db, s, plan, t), { kind, task: t.kind, ...(t.since !== undefined ? { since: t.since } : {}), ...(t.lack ? { lack: t.lack } : {}), ...(t.batch && s.batches[t.batch] ? { batch: batchNo(s.batches[t.batch].code) } : {}) });
  }
  // уборка без уборщиков: её ждёт серия, а аппаратчики стадии в смене — помещение держит работу, которая могла бы идти
  for (const b of Object.values(s.batches)) {
    if (b.status !== 'process' || b.phase !== 'cleaning') continue;
    const st = db.recipes[b.recipe].stages[b.stage];
    const room = plan.roomOf[st.room];
    const t = Object.values(s.tasks).find(x => (x.kind === 'clean' || x.kind === 'roomClean') && x.room === room && x.state === 'open' && x.why === 'shift');
    if (!t) continue;
    if (!Object.values(s.people).some(p => p.role === st.staff.role && shiftEnd(db, s, p) !== undefined)) continue;
    add(roomThing(plan, room), { kind: 'clean', task: t.kind, batch: batchNo(b.code), ...(t.since !== undefined ? { since: t.since } : {}) });
  }
  // фура поставщика ждёт разгрузки дольше 2 часов (тревога часа Б2а)
  for (const tr of Object.values(s.trucks)) {
    if (!tr.po || tr.units.length === 0 || s.t - tr.arrived < TRUCK_WAIT) continue;
    add({ kind: 'truck', n: num(tr.id), customer: false }, { kind: 'truck', since: tr.arrived, po: tr.po, supplier: s.pos[tr.po]?.supplier });
  }
  // материал не пришёл: серия к своему «не раньше» — над помещением первой стадии; упаковка — над помещением линии
  for (const b of Object.values(s.batches)) {
    if (b.status === 'waiting' && s.t >= b.notBefore) {
      add(roomThing(plan, plan.roomOf[db.recipes[b.recipe].stages[0].room]), { kind: 'material', since: b.notBefore, batch: batchNo(b.code), short: (b.short ?? []).map(x => x.material) });
    } else if (b.pack?.state === 'waiting') {
      add(roomThing(plan, plan.plant.lines.find(l => l.id === b.pack!.line)?.room), { kind: 'material', since: b.pack.created, batch: batchNo(b.code), short: (b.pack.short ?? []).map(x => x.material) });
    }
  }
  // заказ покупателя под угрозой — по правилу планёрки и тревоги часа (`orderRisks`) — над складом ГП
  const store = roomThing(plan, plan.roomOf.warehouse);
  for (const r of orderRisks(db, s)) add(store, { kind: 'order', since: s.orders[r.order].placed, order: r.order, customer: r.customer, due: r.due, missing: r.missing });
  const rank = (k: AndonKind) => ANDON.indexOf(k);
  const order = (t: Thing) => ['room', 'equipment', 'machine', 'truck', 'unit'].indexOf(t.kind) * 1e6 + ('i' in t ? t.i : 'line' in t ? t.line * 100 + t.k : 'n' in t ? t.n : 0);
  const items: AndonItem[] = [...byThing.values()]
    .map(({ thing, why }) => {
      why.sort((a, b) => rank(a.kind) - rank(b.kind) || (a.since ?? 0) - (b.since ?? 0));
      return { thing, kind: why[0].kind, weight: WEIGHT[why[0].kind], why };
    })
    .sort((a, b) => order(a.thing) - order(b.thing));
  return { view: 'andon', items };
}
