// Справочник завода (этап Б, Б1а; docs/specs/2026-10-vertical-slice.md): как должно быть — НСИ из базы, как есть — из
// состояния завода. Только то, что знает настоящий завод по своим документам: параметров модели, которых он не знает, —
// истинных свойств партий и их разброса, доли брака у поставщика, спроса покупателя, таблиц отказов и разброса МОК, разброса
// режимов и длительностей, причин, моделей расследования, происшествия — в виде нет. Мгновения начала работ — числами:
// сколько прошло, окно считает по своим часам, и вид не меняется каждую секунду. Документы и редакции (Б3а) — по дате
// завода: что действует сегодня, что в проекте и что в архиве.
import type { ContentDb, Dept, Id, MaterialKind, OkeiUnit, ParamUnit } from '../content/types';
import { batchNo } from '../engine/batchno';
import { momentOf } from '../engine/core/calendar';
import { DOC_KINDS, type DocKind, type DocStatus, inForce, statusOf } from '../engine/docs';
import { geo, SIXTY } from '../engine/line';
import { partType, wearAt } from '../engine/maint';
import { nominal } from '../engine/mes';
import { planOf } from '../engine/plant';
import { shiftEnd } from '../engine/staff';
import type { MachineState, PlantState } from '../engine/types';
import { type EqState, eqStateOf } from './pack';

export interface RefQuery {
  view: 'ref';
}

/** Позиция: таблеток в блистере, блистеров в пачке, пачек в ящике, ящиков на паллете; срок — месяцы; цены — копейки. */
export interface RefSku {
  id: Id;
  perBlister: number;
  blisters: number;
  perCase: number;
  cases: number;
  shelf: number;
  price: number;
  regPrice?: number;
}

export interface RefProduct {
  id: Id;
  code: string;
  form: string;
  skus: RefSku[];
}

/** Узел: ресурс — единиц наработки, износ — доли 1/10 000 (как в карточке; запас до отказа — истина, его нет). */
export interface RefPart {
  type: string;
  life: number;
  wear: number;
  failed: boolean;
}

/** Стадия карты: по карте — на размер серии, с; по факту — сделанные стадии серий; сейчас — серия на стадии. */
export interface RefStage {
  id: string;
  room: string;
  equipment: Id[];
  staff: { role: Id; n: number };
  nominal: number;
  params: { id: string; unit: ParamUnit; target: number; range: [number, number] }[];
  ipc: { test: Id; min?: number; max?: number }[];
  mix: boolean;
  done: number;
  last?: number;
  mean?: number;
  /** с какого мгновения идёт работа и сколько по карте на массу этой серии, с */
  now?: { batch: string; from: number; nominal: number };
}

export interface RefRecipe {
  id: Id;
  product: Id;
  /** мг и таблетки на серию */
  mass: number;
  units: number;
  bom: { material: Id; qty: number; potency: boolean; qs: boolean }[];
  stages: RefStage[];
}

export interface RefEquipment {
  id: string;
  type: Id;
  /** вид помещения */
  room: string;
  /** уборка, с */
  cleaning: { minor: number; major: number };
  parts: RefPart[];
  state: EqState;
  batch?: string;
}

/** Машина линии: номинал и скорость сейчас — блистеров или пачек в минуту; накопитель за ней — штук машины. */
export interface RefMachine {
  id: string;
  type: Id;
  nominal: number;
  buffer?: number;
  state: MachineState;
  rate: number;
  parts: RefPart[];
}

export interface RefLine {
  id: string;
  machines: RefMachine[];
  batch?: string;
  sku?: Id;
}

/** Методика: работа аналитика и прибора, с; сколько испытаний в очереди, в работе и сделано. */
export interface RefMethod {
  id: Id;
  inst?: Id;
  prep: number;
  run: number;
  unattended: boolean;
  queued: number;
  running: number;
  done: number;
}

export interface RefInstrument {
  id: string;
  type: Id;
  room: string;
  /** методика испытания на приборе сейчас */
  method?: Id;
}

/** Роль: зарплата — копейки в месяц; людей по сменам; сейчас на заводе и заняты задачей. */
export interface RefRole {
  id: Id;
  dept: Dept;
  salary: number;
  shifts: { shift: Id; n: number }[];
  present: number;
  busy: number;
}

export interface RefShift {
  id: Id;
  /** дни недели 0–6, с понедельника; часы с и до */
  days: number[];
  from: number;
  to: number;
}

/**
 * Поставщик: срок поставки — дни; предоплата — доли 1/10 000; цена — копейки за кг или штуку, партия — мг или штуки; у
 * запасных частей — цена за штуку и свой срок поставки.
 */
export interface RefSupplier {
  id: Id;
  lead: [number, number];
  prepay: number;
  payDays: number;
  approved: boolean;
  items: { material: Id; price: number; moq: number }[];
  spares: { spare: Id; price: number; lead: [number, number] }[];
}

/** Покупатель: дни заказа 0–6 и час; срок — через сколько дней; наименьший остаточный срок — доли 1/10 000. */
export interface RefCustomer {
  id: Id;
  payDays: number;
  days: number[];
  hour: number;
  lead: [number, number];
  minShelf: number;
}

/**
 * Материал или запчасть (Б3а): единица учёта — с кодом ОКЕИ из регуляторного профиля; спецификация — редакция, действующая
 * сегодня (у запчасти её нет). Код и имя окно берёт из базы.
 */
export interface RefMaterial {
  id: Id;
  kind: MaterialKind | 'spare';
  unit: OkeiUnit;
  okei: number;
  spec?: Id;
}

/** Регламентирующий документ (Б3а): запись редакции и её статус на сегодня по дате завода. Шапку окно берёт из базы. */
export interface RefDoc {
  kind: DocKind;
  id: Id;
  status: DocStatus;
}

export interface RefView {
  view: 'ref';
  products: RefProduct[];
  materials: RefMaterial[];
  docs: RefDoc[];
  recipes: RefRecipe[];
  equipment: RefEquipment[];
  lines: RefLine[];
  methods: RefMethod[];
  instruments: RefInstrument[];
  roles: RefRole[];
  shifts: RefShift[];
  suppliers: RefSupplier[];
  customers: RefCustomer[];
}

function partsOf(db: ContentDb, s: PlantState, machine: string): RefPart[] {
  return Object.values(s.parts)
    .filter(p => p.machine === machine)
    .map(p => {
      const pt = partType(db, p);
      return { type: p.type, life: pt.life, wear: wearAt(pt, p.done), failed: p.state === 'failed' };
    });
}

/** Стадии карты: по карте, по факту — записи стадий сделанных серий, сейчас — серия, у которой стадия идёт. */
function stagesOf(db: ContentDb, s: PlantState, id: Id): RefStage[] {
  const r = db.recipes[id];
  const batches = Object.values(s.batches).filter(b => b.recipe === id);
  return r.stages.map((st, i) => {
    const recs = batches.flatMap(b => b.records.filter(x => x.stage === st.id)).sort((a, b) => a.end - b.end);
    const times = recs.map(x => x.end - x.start);
    const busy = batches.find(b => b.status === 'process' && b.stage === i && Object.values(s.tasks).some(t => t.kind === 'stage' && t.batch === b.id && t.state === 'busy'));
    const task = busy ? Object.values(s.tasks).find(t => t.kind === 'stage' && t.batch === busy.id && t.state === 'busy') : undefined;
    return {
      id: st.id,
      room: st.room,
      equipment: [...st.equipment],
      staff: { ...st.staff },
      nominal: nominal(db, id, st, r.batch.mass),
      params: st.params.map(p => ({ id: p.id, unit: p.unit, target: p.target, range: [...p.range] as [number, number] })),
      ipc: st.ipc.map(c => ({ test: c.test, ...(c.min !== undefined ? { min: c.min } : {}), ...(c.max !== undefined ? { max: c.max } : {}) })),
      mix: !!st.mix,
      done: times.length,
      ...(times.length ? { last: times[times.length - 1], mean: Math.round(times.reduce((n, x) => n + x, 0) / times.length) } : {}),
      ...(busy && task ? { now: { batch: batchNo(busy.code), from: busy.run?.start ?? task.times![1], nominal: nominal(db, id, st, busy.mass) } } : {}),
    };
  });
}

/** Единица учёта материала с кодом ОКЕИ: готовая продукция — пачками, остальное — килограммами или штуками. */
function unitOf(kind: MaterialKind | 'spare', unit: 'mass' | 'pcs'): OkeiUnit {
  return kind === 'fg' ? 'pack' : unit === 'mass' ? 'kg' : 'pcs';
}

export function refView(db: ContentDb, s: PlantState): RefView {
  const plan = planOf(db, s.plant);
  const today = momentOf(s.start, s.t).day;
  const okei = db.profiles[db.scenarios[s.scenario].profile].okei;
  const roomType = (id: string) => plan.plant.rooms.find(r => r.id === id)?.type ?? id;
  const products = Object.values(db.products).map(pr => ({
    id: pr.id,
    code: pr.code,
    form: pr.form,
    skus: Object.values(db.skus)
      .filter(k => k.product === pr.id)
      .map(k => ({
        id: k.id,
        perBlister: k.perBlister,
        blisters: k.blisters,
        perCase: k.case.per,
        cases: k.pallet.cases,
        shelf: db.materials[k.fg].shelf,
        price: k.price,
        ...(k.regPrice !== undefined ? { regPrice: k.regPrice } : {}),
      })),
  }));
  const materials: RefMaterial[] = [
    ...Object.values(db.materials).map(m => {
      const unit = unitOf(m.kind, m.unit);
      return { id: m.id, kind: m.kind, unit, okei: okei[unit], spec: inForce(db, 'specs', m.spec, today) };
    }),
    ...Object.values(db.spares).map(sp => ({ id: sp.id, kind: 'spare' as const, unit: 'pcs' as const, okei: okei.pcs })),
  ];
  const docs = DOC_KINDS.flatMap(kind => Object.keys(db[kind]).map(id => ({ kind, id, status: statusOf(db, kind, id, today) })));
  // карты — действующие сегодня редакции; все редакции — во вкладке документов
  const recipes = Object.values(db.recipes)
    .filter(r => statusOf(db, 'recipes', r.id, today) === 'active')
    .map(r => ({
    id: r.id,
    product: r.product,
    mass: r.batch.mass,
    units: r.batch.units,
    bom: r.bom.map(l => ({ material: l.material, qty: l.qty, potency: !!l.potency, qs: !!l.qs })),
    stages: stagesOf(db, s, r.id),
  }));
  const equipment = plan.plant.equipment.map(e => {
    const t = db.equipment[e.type];
    const b = s.equipment[e.id]?.batch;
    return {
      id: e.id,
      type: e.type,
      room: roomType(e.room),
      cleaning: { ...t.cleaning },
      parts: partsOf(db, s, e.id),
      state: eqStateOf(s, e.id),
      ...(b && s.batches[b] ? { batch: batchNo(s.batches[b].code) } : {}),
    };
  });
  const lines = plan.plant.lines.map(l => {
    const line = s.lines[l.id];
    const b = line?.batch ? s.batches[line.batch] : undefined;
    const job = b?.pack;
    const g = line && job ? geo(db, s, line, job.sku) : undefined;
    return {
      id: l.id,
      machines: l.machines.map((m, k) => {
        const mc = line?.machines[k];
        return {
          id: m.id,
          type: m.type,
          nominal: db.machines[m.type].nominal,
          ...(m.buffer !== undefined ? { buffer: m.buffer } : {}),
          state: mc?.state ?? 'idle',
          rate: mc && g ? Math.round((mc.rate * 60) / (g.unit[k] * SIXTY)) : 0,
          parts: partsOf(db, s, m.id),
        };
      }),
      ...(b ? { batch: batchNo(b.code) } : {}),
      ...(job ? { sku: job.sku } : {}),
    };
  });
  const tests = Object.values(s.tests);
  const methods = Object.values(db.tests).map(m => ({
    id: m.id,
    ...(m.inst ? { inst: m.inst } : {}),
    prep: m.prep,
    run: m.run,
    unattended: m.unattended,
    queued: tests.filter(q => q.method === m.id && q.state === 'queued').length,
    running: tests.filter(q => q.method === m.id && q.state !== 'queued' && q.state !== 'done').length,
    done: tests.filter(q => q.method === m.id && q.state === 'done').length,
  }));
  const instruments = plan.plant.instruments.map(i => {
    const q = s.instruments[i.id]?.test ? s.tests[s.instruments[i.id].test!] : undefined;
    return { id: i.id, type: i.type, room: roomType(i.room), ...(q ? { method: q.method } : {}) };
  });
  const people = Object.values(s.people);
  const roles = Object.values(db.roles).map(ro => {
    const mine = people.filter(p => p.role === ro.id);
    const by = new Map<Id, number>();
    for (const p of mine) by.set(p.shift, (by.get(p.shift) ?? 0) + 1);
    return {
      id: ro.id,
      dept: ro.dept,
      salary: ro.salary,
      shifts: [...by].map(([shift, n]) => ({ shift, n })),
      present: mine.filter(p => p.task !== undefined || shiftEnd(db, s, p) !== undefined).length,
      busy: mine.filter(p => p.task !== undefined).length,
    };
  });
  const shifts = Object.values(db.shifts).map(sh => ({ id: sh.id, days: [...sh.days], from: sh.from, to: sh.to }));
  const suppliers = Object.values(db.suppliers).map(su => ({
    id: su.id,
    lead: [...su.lead] as [number, number],
    prepay: su.prepay,
    payDays: su.payDays,
    approved: su.approved,
    items: Object.entries(su.items).map(([material, it]) => ({ material, price: it.price, moq: it.moq })),
    spares: Object.values(db.spares)
      .filter(sp => sp.supplier === su.id)
      .map(sp => ({ spare: sp.id, price: sp.price, lead: [...sp.lead] as [number, number] })),
  }));
  const customers = Object.values(db.customers).map(c => ({ id: c.id, payDays: c.payDays, days: [...c.order.days], hour: c.order.hour, lead: [...c.order.lead] as [number, number], minShelf: c.minShelf }));
  return { view: 'ref', products, materials, docs, recipes, equipment, lines, methods, instruments, roles, shifts, suppliers, customers };
}
