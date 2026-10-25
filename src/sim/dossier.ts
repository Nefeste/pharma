// Досье серии (Б1д; docs/specs/2026-10-vertical-slice.md, «Б1д»): запись по производству и запись по упаковке серии, как
// их ведёт завод (GMP ЕАЭС, ч. I, пп. 4.20, 4.21). Что отвешено и из каких партий, кто взвешивал и кто проверял, что
// загружено на каждой стадии, масса и выход, режимы, МОК, простои; упаковка — люди линии, очистка, материалы по машинам и
// сверка; отклонения и решения. Здесь же — что в оборудовании сейчас (карточка оборудования и помещения) и материалы
// машины линии (её карточка). Истины здесь нет (docs/02-architecture.md, §9): ни истинных показателей, ни причин, ни
// запаса узлов до отказа, ни заминок, которых не записали, — только то, что взвесили, сосчитали и записали люди завода.
import type { ContentDb, Id, ParamUnit } from '../content/types';
import { batchNo } from '../engine/batchno';
import { RECON_LIMIT, usedByCount } from '../engine/line';
import { stageMass } from '../engine/mes';
import { planOf } from '../engine/plant';
import { unitsOfLot } from '../engine/stock';
import type { Batch, BatchStatus, Deviation, KitLine, LotStatus, PackJob, PlantState, Recon } from '../engine/types';
import { whoBatch, type WhoRow } from './journal';

export interface DossierQuery {
  view: 'dossier';
  /** номер серии: `B<n>` */
  batch: number;
}

/** Человек записи: номер его карточки, роль и табельный номер — и того, кто с завода уже ушёл. */
export interface Who {
  n: number;
  role: Id;
  tab: number;
}

/** Партия в строке: внутренний номер, сколько, у АФС — содержание, по которому пересчитали навеску; первая паллета партии, пока она на заводе. */
export interface LotQty {
  code: [number, number, number];
  qty: number;
  assay?: number;
  unit?: number;
}

/** Строка «Отвешено» — строка состава карты: стадия загрузки, по карте, партии и сколько из каждой. */
export interface DispRow {
  material: Id;
  stage: string;
  norm: number;
  potency: boolean;
  qs: boolean;
  qty: number;
  lots: LotQty[];
}

/** Режим стадии: цель и диапазон по карте, факт — из досье; вне диапазона — номер отклонения. */
export interface StageParam {
  id: string;
  unit: ParamUnit;
  target: number;
  range: [number, number];
  /** уставка (Б1ж): сделанной стадии — по записи, идущей — с которой началась; записи до Б1ж её не знают — цель */
  sp?: number;
  value?: number;
  dev?: number;
}

/**
 * Стадия в досье: сделана, идёт или впереди. Помещение — тип и номер по плану; оборудование — вид, номер по плану и
 * инвентарный номер; что на ней загружено (у стадии впереди — что загрузят) — по партиям; масса на входе — по досье и
 * карте, на выходе и потери — по досье; режимы, МОК — замеров и вне пределов, простои после отказов узлов, отклонения.
 */
export interface StageRow {
  stage: string;
  state: 'done' | 'now' | 'plan';
  room: string;
  roomIx: number;
  equipment: { type: Id; i: number; inv?: number }[];
  people: Who[];
  from?: number;
  to?: number;
  load: { material: Id; qty: number; lots: LotQty[] }[];
  in: number;
  out?: number;
  loss?: number;
  params: StageParam[];
  ipc: { test: Id; n: number; out: number }[];
  stops: { part: string; from: number; to: number }[];
  devs: number[];
}

/**
 * Материал задания на упаковку: машина, на которую он идёт (номер по плану линии), партии, выдано; после задания —
 * израсходовано и возвращено по факту, у печатных — ещё испорчено (сверка); пока линия работает — израсходовано по счёту
 * машины и на наладку. Выдачи нет — не записано: задание сделано до схемы 26, партии — по списанию.
 */
export interface PackMaterial {
  material: Id;
  machine: Id;
  k: number;
  issued?: number;
  lots: LotQty[];
  used?: number;
  spoiled?: number;
  returned?: number;
}

/** Упаковка в досье: линия, позиция, когда, кто работал и кто очищал линию; итог по таблеткам и штукам; материалы и сверка. */
export interface PackDossier {
  line: number;
  sku: Id;
  state: PackJob['state'];
  taken?: number;
  start?: number;
  end?: number;
  /** нет — не записано: задание из сохранения до схемы 26 */
  people?: Who[];
  clear?: { by: Who[]; from: number; to: number; check?: Who; at?: number };
  /**
   * очистка не понадобилась: линию очищают между сериями (геймдизайн, §5.8), а до этого задания она с начала игры
   * не упаковывала
   */
  clearNone?: true;
  tablets: number;
  result?: { good: number; scrap: number; remainder: number; blisters: number; blisterRejects: number; cartons: number; cartonRejects: number; cases: number; pallets: number };
  materials: PackMaterial[];
  recon?: Recon[];
  /** предел расхождения сверки, доля выданного 1/10 000: больше — отклонение (геймдизайн, §5.8) */
  reconLimit?: number;
  fg?: [number, number, number];
}

export interface DossierView {
  view: 'dossier';
  batch: number;
  /** серии больше нет в учёте завода */
  gone?: true;
  code?: string;
  recipe?: Id;
  product?: Id;
  sku?: Id;
  status?: BatchStatus;
  /** размер серии по карте: масса и таблеток */
  mass?: number;
  units?: number;
  /** когда выдано досье; день производства — начало первого смешивания */
  issued?: number;
  produced?: number;
  /** отвешено или, до отвешивания, резерв по FEFO */
  weighed?: boolean;
  disp?: DispRow[];
  /** отвешивание: весы, кто взвешивал и кто проверял, с какого и до какого мгновения */
  weigh?: { scale?: { type: Id; i: number; inv?: number }; by?: Who; check?: Who; from: number; to: number };
  stages?: StageRow[];
  /** таблеток в балке и выход серии, доли 1/10 000 */
  bulkUnits?: number;
  yield?: number;
  pack?: PackDossier;
  devs?: { n: number; kind: Deviation['kind']; status: Deviation['status']; stage?: string }[];
  bulk?: { code: [number, number, number]; status: LotStatus; since?: number; unit?: number };
  checked?: number;
  decision?: 'release' | 'reject' | 'hold';
  held?: boolean;
  released?: number;
  /** кто решил (Б5а): задание, решение по балку, вывод расследования, решения уполномоченного лица */
  who?: WhoRow[];
}

const num = (id: string) => Number(id.slice(1));
const codeOf = (c: { y: number; m: number; n: number }): [number, number, number] => [c.y, c.m, c.n];

function whoOf(s: PlantState, id: string): Who | undefined {
  const p = s.people[id] ?? s.former[id];
  return p ? { n: num(id), role: p.role, tab: p.tab } : undefined;
}
const whos = (s: PlantState, ids: readonly string[]): Who[] => ids.flatMap(id => whoOf(s, id) ?? []);

/** Строки комплекта по партиям — в порядке первой тары; у АФС — содержание; первая паллета партии, пока она на заводе. */
function lotsOf(s: PlantState, lines: readonly KitLine[]): LotQty[] {
  const out = new Map<string, LotQty>();
  for (const k of lines) {
    const lot = s.lots[k.lot];
    if (!lot) continue;
    let e = out.get(k.lot);
    if (!e) {
      const u = unitsOfLot(s, k.lot).sort((a, b) => num(a.id) - num(b.id))[0];
      out.set(k.lot, (e = { code: codeOf(lot.code), qty: 0, ...(k.assay !== undefined ? { assay: k.assay } : {}), ...(u ? { unit: num(u.id) } : {}) }));
    }
    e.qty += k.qty;
  }
  return [...out.values()];
}

/** Оборудование стадии: по досье — то, на чём работали; впереди — то, что стоит в её помещении. */
function equipmentOf(db: ContentDb, s: PlantState, ids: readonly string[]) {
  const plan = planOf(db, s.plant);
  return ids.map(id => {
    const i = plan.plant.equipment.findIndex(e => e.id === id);
    return { type: s.equipment[id]?.type ?? id, i, ...(s.assets[id] ? { inv: s.assets[id].inv } : {}) };
  });
}

/** Что отвешено, а до отвешивания — резерв: строки по партиям у каждой строки состава. */
function lines(b: Batch): readonly KitLine[] {
  return b.dispensed.length > 0 ? b.dispensed : b.kit;
}

/** Что загружают на стадии карты: строки состава этой стадии — по партиям отвешенного или резерва. */
function loadAt(db: ContentDb, s: PlantState, b: Batch, stage: string) {
  const src = lines(b);
  return db.recipes[b.recipe].bom
    .filter(l => l.stage === stage)
    .map(l => {
      const mine = src.filter(x => x.material === l.material);
      return { material: l.material, qty: mine.length > 0 ? mine.reduce((n, x) => n + x.qty, 0) : l.qty, lots: lotsOf(s, mine) };
    });
}

export function dossierView(db: ContentDb, s: PlantState, q: DossierQuery): DossierView {
  const b = s.batches[`B${q.batch}`];
  if (!b) return { view: 'dossier', batch: q.batch, gone: true };
  const r = db.recipes[b.recipe];
  const plan = planOf(db, s.plant);
  const src = lines(b);
  const devs = Object.values(s.deviations).filter(d => d.batch === b.id);
  const disp: DispRow[] = r.bom.map(l => {
    const mine = src.filter(x => x.material === l.material);
    return { material: l.material, stage: l.stage, norm: l.qty, potency: !!l.potency, qs: !!l.qs, qty: mine.reduce((n, x) => n + x.qty, 0), lots: lotsOf(s, mine) };
  });
  const running = Object.values(s.tasks).find(t => t.kind === 'stage' && t.batch === b.id);
  const stages: StageRow[] = r.stages.map((st, k) => {
    const rec = b.records.find(x => x.stage === st.id);
    const now = !rec && k === b.stage && b.status === 'process' && b.room !== undefined && !!running;
    const roomId = rec?.room ?? (now ? b.room! : plan.roomOf[st.room]);
    const eq = rec ? rec.equipment : Object.values(s.equipment).filter(e => e.room === roomId && st.equipment.includes(e.type)).map(e => e.id);
    const out: StageRow = {
      stage: st.id,
      state: rec ? 'done' : now ? 'now' : 'plan',
      room: st.room,
      roomIx: plan.plant.rooms.findIndex(x => x.id === roomId),
      equipment: equipmentOf(db, s, eq),
      people: rec ? whos(s, rec.people) : now ? whos(s, b.run?.people ?? running!.people) : [],
      load: k === 0 ? [] : loadAt(db, s, b, st.id),
      in: rec ? rec.in : stageMass(db, b, k),
      params: st.params.map(p => {
        const dev = devs.find(d => d.kind === 'param' && d.stage === st.id && d.param === p.id);
        const sp = rec ? (rec.sp?.[p.id] ?? p.target) : now ? b.sp?.[p.id] : undefined;
        return { id: p.id, unit: p.unit, target: p.target, range: [p.range[0], p.range[1]] as [number, number], ...(sp !== undefined ? { sp } : {}), ...(rec && rec.params[p.id] !== undefined ? { value: rec.params[p.id] } : {}), ...(dev ? { dev: num(dev.id) } : {}) };
      }),
      ipc: st.ipc.map(c => {
        const pts = rec ? rec.ipc.filter(x => x.test === c.test) : [];
        return { test: c.test, n: pts.length, out: pts.filter(x => !x.pass).length };
      }),
      stops: (rec?.stops ?? []).map(x => ({ part: s.parts[x.part]?.type ?? x.part, from: x.from, to: x.to })),
      devs: devs.filter(d => d.stage === st.id).map(d => num(d.id)),
    };
    if (rec) {
      out.from = rec.start;
      out.to = rec.end;
      out.out = rec.out;
      out.loss = rec.loss;
    } else if (now) out.from = b.run?.start ?? running!.times?.[1] ?? running!.created;
    return out;
  });
  const first = b.records[0];
  const view: DossierView = {
    view: 'dossier',
    batch: q.batch,
    code: batchNo(b.code),
    recipe: b.recipe,
    product: b.product,
    ...(b.sku ? { sku: b.sku } : {}),
    status: b.status,
    mass: r.batch.mass,
    units: r.batch.units,
    ...(b.issued !== undefined ? { issued: b.issued } : {}),
    weighed: b.dispensed.length > 0,
    disp,
    stages,
    devs: devs.map(d => ({ n: num(d.id), kind: d.kind, status: d.status, ...(d.stage ? { stage: d.stage } : {}) })),
    ...(b.checked !== undefined ? { checked: b.checked } : {}),
    ...(b.decision ? { decision: b.decision } : {}),
    held: !!b.held,
    ...(b.released !== undefined ? { released: b.released } : {}),
  };
  if (first && first.stage === r.stages[0].id) {
    const [scale] = equipmentOf(db, s, first.equipment);
    const [by, check] = [whoOf(s, first.people[0] ?? ''), whoOf(s, first.people[1] ?? '')];
    view.weigh = { ...(scale ? { scale } : {}), ...(by ? { by } : {}), ...(check ? { check } : {}), from: first.start, to: first.end };
  }
  const mix = r.stages.find(st => st.mix)?.id;
  const mixed = b.records.find(x => x.stage === mix);
  if (mixed) view.produced = mixed.start;
  if (b.units !== undefined) {
    view.bulkUnits = b.units;
    view.yield = Math.round((b.units * 10000) / r.batch.units);
  }
  const bulk = b.bulk ? s.lots[b.bulk] : undefined;
  if (bulk) {
    const u = unitsOfLot(s, bulk.id).sort((a, c) => num(a.id) - num(c.id))[0];
    view.bulk = { code: codeOf(bulk.code), status: bulk.status, ...(bulk.since !== undefined ? { since: bulk.since } : {}), ...(u ? { unit: num(u.id) } : {}) };
  }
  if (b.pack) view.pack = packOf(db, s, b, b.pack);
  const who = whoBatch(s, b);
  if (who.length > 0) view.who = who;
  return view;
}

/** Упаковка серии в досье (п. 4.21): люди, очистка, итог по таблеткам и штукам, материалы по машинам и сверка. */
function packOf(db: ContentDb, s: PlantState, b: Batch, job: PackJob): PackDossier {
  const plan = planOf(db, s.plant);
  const li = plan.plant.lines.findIndex(l => l.id === job.line);
  const def = plan.plant.lines[li];
  const sku = db.skus[job.sku];
  const done = job.state === 'done';
  // выдача — с Б1д; у задания, сделанного раньше, комплекта уже нет: партии — по списанию, выдано — по сверке
  const issued = job.issued ?? (done ? undefined : job.kit);
  const counted = !done && s.lines[job.line]?.batch === b.id ? usedByCount(db, s, s.lines[job.line], s.t) : new Map<Id, number>();
  const last = def.machines.length - 1;
  const groups: { k: number; mats: Id[] }[] = [
    { k: 0, mats: sku.blister.map(l => l.material) },
    { k: 1, mats: sku.carton.map(l => l.material) },
    { k: last, mats: [sku.case.material] },
  ];
  const materials: PackMaterial[] = groups.flatMap(g =>
    g.mats.map(m => {
      const mine = (issued ?? job.used).filter(x => x.material === m);
      const out: PackMaterial = { material: m, machine: def.machines[g.k].type, k: g.k, lots: lotsOf(s, mine), ...(issued ? { issued: mine.reduce((n, x) => n + x.qty, 0) } : {}) };
      if (done) {
        const rc = job.recon?.find(x => x.material === m);
        const used = job.used.filter(x => x.material === m).reduce((n, x) => n + x.qty, 0);
        if (rc) {
          out.issued ??= rc.issued;
          out.used = rc.used;
          out.spoiled = rc.spoiled;
          out.returned = rc.returned;
        } else {
          out.used = used;
          if (out.issued !== undefined) out.returned = out.issued - used;
        }
      } else if (counted.has(m)) out.used = counted.get(m)!;
      return out;
    }),
  );
  const fg = job.fg ? s.lots[job.fg] : undefined;
  const out: PackDossier = {
    line: li + 1,
    sku: job.sku,
    state: job.state,
    ...(job.taken !== undefined ? { taken: job.taken } : {}),
    ...(job.start !== undefined ? { start: job.start } : {}),
    ...(job.end !== undefined ? { end: job.end } : {}),
    ...(job.people ? { people: whos(s, job.people) } : {}),
    tablets: job.tablets,
    materials,
    ...(job.recon ? { recon: job.recon.map(x => ({ ...x })), reconLimit: RECON_LIMIT } : {}),
    ...(fg ? { fg: codeOf(fg.code) } : {}),
  };
  if (job.clear) {
    const check = job.clear.check ? whoOf(s, job.clear.check) : undefined;
    out.clear = { by: whos(s, job.clear.by), from: job.clear.from, to: job.clear.to, ...(check ? { check } : {}), ...(job.clear.at !== undefined ? { at: job.clear.at } : {}) };
  } else if (job.people && (job.state === 'running' || job.state === 'done')) out.clearNone = true;
  if (done && job.cartons !== undefined) {
    const scrap = job.scrap ?? 0;
    const remainder = job.remainder ?? 0;
    out.result = {
      good: job.tablets - scrap - remainder,
      scrap,
      remainder,
      blisters: job.blisters ?? 0,
      blisterRejects: job.blisterRejects ?? 0,
      cartons: job.cartons,
      cartonRejects: job.cartonRejects ?? 0,
      cases: job.cases ?? 0,
      pallets: Math.ceil((job.cases ?? 0) / sku.pallet.cases),
    };
  }
  return out;
}

/**
 * Что в оборудовании сейчас (п. 5.12: оборудование маркируют продуктом, серией и стадией): серия, стадия, выход прошлой
 * стадии по досье и что загружено на этой — по партиям; масса на входе. На отвешивании — что взвешивают: комплект.
 */
export interface Inside {
  batch: number;
  code: string;
  product: Id;
  stage: string;
  prev?: { stage: string; mass: number };
  load: { material: Id; qty: number; lots: LotQty[] }[];
  mass: number;
}

/** Что в помещении сейчас — у серии, которая его занимает; помещение свободно — ничего. */
export function insideOf(db: ContentDb, s: PlantState, roomId: string): Inside | undefined {
  const room = s.rooms[roomId];
  const b = room?.status === 'busy' && room.batch ? s.batches[room.batch] : undefined;
  if (!b || b.status !== 'process') return undefined;
  const r = db.recipes[b.recipe];
  const st = r.stages[b.stage];
  if (!st) return undefined;
  const prev = b.stage >= 2 ? b.records.find(x => x.stage === r.stages[b.stage - 1].id) : undefined;
  const load =
    b.stage === 0
      ? r.bom.map(l => {
          const mine = b.kit.filter(x => x.material === l.material);
          return { material: l.material, qty: mine.reduce((n, x) => n + x.qty, 0), lots: lotsOf(s, mine) };
        })
      : loadAt(db, s, b, st.id);
  return {
    batch: num(b.id),
    code: batchNo(b.code),
    product: b.product,
    stage: st.id,
    ...(prev ? { prev: { stage: prev.stage, mass: prev.out } } : {}),
    load,
    mass: b.stage === 0 ? load.reduce((n, x) => n + x.qty, 0) : stageMass(db, b, b.stage),
  };
}

/** Материалы машины линии в задании (Б1д): партия, выдано, израсходовано по счёту машины и на наладку, осталось у линии. */
export interface LineMaterial {
  material: Id;
  lots: [number, number, number][];
  issued: number;
  used: number;
  left: number;
}

export function lineMaterials(db: ContentDb, s: PlantState, lineId: string, k: number): { batch: number; materials: LineMaterial[] } | undefined {
  const line = s.lines[lineId];
  const b = line?.batch ? s.batches[line.batch] : undefined;
  const job = b?.pack;
  if (!b || !job) return undefined;
  const sku = db.skus[job.sku];
  const last = line.machines.length - 1;
  const mats = k === 0 ? sku.blister.map(l => l.material) : k === last ? [sku.case.material] : k === 1 ? sku.carton.map(l => l.material) : [];
  const used = usedByCount(db, s, line, s.t);
  return {
    batch: num(b.id),
    materials: mats.map(m => {
      const mine = (job.issued ?? job.kit).filter(x => x.material === m);
      const issued = mine.reduce((n, x) => n + x.qty, 0);
      const u = Math.min(issued, used.get(m) ?? 0);
      return { material: m, lots: lotsOf(s, mine).map(x => x.code), issued, used: u, left: issued - u };
    }),
  };
}
