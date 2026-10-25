// Отклонения и решение по серии (Б1г; docs/specs/2026-10-vertical-slice.md, «Б1г»): виды для окна без истины. Карточка
// отклонения — что вышло за предел, числами из досье (режим и его цель и диапазон по карте, МОК, выход, сверка), что
// это значит для серии, связанные испытания по знаниям завода, оценка и чего не хватает для решения, срок расследования
// по процедуре завода. Решение по серии на выпуске — условия выпуска (§6.5) и чего не хватает, чтобы выпустить. Режимы
// в карточке помещения и оборудования — во время стадии цель и диапазон по карте, после — факт из досье.
import type { ContentDb, Id, ParamUnit } from '../content/types';
import { batchNo } from '../engine/batchno';
import { DAY, momentOf } from '../engine/core/calendar';
import { inForce } from '../engine/docs';
import { setpointOf } from '../engine/modes';
import { assessBlock, devsOf, type LinkedTest, linkedTests, openDevs } from '../engine/qa';
import { unitsOfLot } from '../engine/stock';
import type { Batch, BatchStatus, Deviation, LotStatus, PlantState, Refusal } from '../engine/types';
import { whoDev, type WhoRow } from './journal';

const num = (id: string) => Number(id.slice(1));

/** Режим стадии: значение и уставка по досье (Б1ж; до неё — цель), цель и диапазон по карте — в единицах движка. */
export interface ParamFact {
  id: string;
  unit: ParamUnit;
  value: number;
  target: number;
  range: [number, number];
  sp: number;
}

/** Оценка отклонения: решение, кто решил — игрок или коллега качества, когда; работа специалиста ООК кончилась. */
export interface AssessView {
  verdict: 'none' | 'reject';
  colleague: boolean;
  t: number;
  done?: number;
}

/**
 * Карточка отклонения (Б1г). Серия — номер, состояние, держат ли её и первая паллета её ГП (к решению по серии); партия
 * — у результата вне спецификации. Что вышло за предел — по виду: режим, МОК, выход, сверка, испытания. Кто и на чём
 * работал — из досье стадии. Связанные испытания — их состояние без истины. `block` — почему оценивать нельзя сейчас;
 * `none` — почему нельзя «без влияния»; `due` — срок расследования по процедуре завода.
 */
export interface DevCard {
  kind: 'dev';
  dev: number;
  what: Deviation['kind'];
  opened: number;
  status: Deviation['status'];
  batch?: { code: string; n: number; status: BatchStatus; held: boolean; unit?: number };
  lot?: { code: [number, number, number]; material: Id; status: LotStatus };
  recipe?: Id;
  stage?: string;
  at?: { from: number; to: number };
  param?: ParamFact;
  ipc?: { test: Id; n: number; out: number; min?: number; max?: number };
  yield?: { units: number; nominal: number; alarm: number };
  recon?: { material: Id; issued: number; used: number; spoiled: number; returned: number };
  tests?: { method: Id; result?: number }[];
  equipment: Id[];
  people: { role: Id; tab: number }[];
  linked: LinkedTest[];
  assess?: AssessView;
  block?: Refusal;
  none?: { why: 'testPending' | 'outOfSpec'; test: Id };
  inv?: string;
  due: number;
  /** кто решил (Б5а): оценка влияния, решение по партии, вывод расследования */
  who?: WhoRow[];
}

/** Первая паллета ГП серии — к ней ведёт решение по серии. */
function fgUnit(s: PlantState, b: Batch): number | undefined {
  const fg = b.pack?.fg;
  const u = fg ? unitsOfLot(s, fg).sort((a, c) => num(a.id) - num(c.id))[0] : undefined;
  return u ? num(u.id) : undefined;
}

export function devCard(db: ContentDb, s: PlantState, n: number): DevCard | undefined {
  const d = s.deviations[`D${n}`];
  if (!d) return undefined;
  const b = d.batch ? s.batches[d.batch] : undefined;
  const lot = d.lot ? s.lots[d.lot] : undefined;
  const r = b ? db.recipes[b.recipe] : undefined;
  const rec = b && d.stage ? b.records.find(x => x.stage === d.stage) : undefined;
  const st = r && d.stage ? r.stages.find(x => x.id === d.stage) : undefined;
  const out: DevCard = {
    kind: 'dev',
    dev: n,
    what: d.kind,
    opened: d.opened,
    status: d.status,
    equipment: (rec?.equipment ?? []).map(id => s.equipment[id]?.type ?? id),
    people: (rec?.people ?? []).flatMap(id => (s.people[id] ? [{ role: s.people[id].role, tab: s.people[id].tab }] : [])),
    linked: linkedTests(db, s, d),
    due: d.opened + db.scenarios[s.scenario].deviations.term * DAY,
  };
  if (b) {
    const unit = fgUnit(s, b);
    out.batch = { code: batchNo(b.code), n: num(b.id), status: b.status, held: !!b.held, ...(unit !== undefined ? { unit } : {}) };
    out.recipe = b.recipe;
  }
  if (lot) out.lot = { code: [lot.code.y, lot.code.m, lot.code.n], material: lot.material, status: lot.status };
  if (d.stage) out.stage = d.stage;
  if (rec) out.at = { from: rec.start, to: rec.end };
  const p = d.param && st ? st.params.find(x => x.id === d.param) : undefined;
  if (p && rec && rec.params[p.id] !== undefined) out.param = { id: p.id, unit: p.unit, value: rec.params[p.id], target: p.target, range: [p.range[0], p.range[1]], sp: rec.sp?.[p.id] ?? p.target };
  if (d.kind === 'ipc' && d.test) {
    const line = st?.ipc.find(x => x.test === d.test);
    const pts = rec ? rec.ipc.filter(x => x.test === d.test) : [];
    out.ipc = { test: d.test, n: pts.length, out: pts.filter(x => !x.pass).length, ...(line?.min !== undefined ? { min: line.min } : {}), ...(line?.max !== undefined ? { max: line.max } : {}) };
  }
  if (d.kind === 'yield' && b && r) out.yield = { units: b.units ?? 0, nominal: r.batch.units, alarm: r.yield.alarm };
  if (d.kind === 'recon' && b?.pack?.recon && d.material) {
    const x = b.pack.recon.find(y => y.material === d.material);
    if (x) out.recon = { material: x.material, issued: x.issued, used: x.used, spoiled: x.spoiled, returned: x.returned };
  }
  if (d.tests) out.tests = d.tests.map(id => ({ method: s.tests[id]?.method ?? id, ...(s.tests[id]?.result !== undefined ? { result: s.tests[id].result } : {}) }));
  if (d.assess) out.assess = { verdict: d.assess.verdict, colleague: d.assess.by !== 'player', t: d.assess.t, ...(d.assess.done !== undefined ? { done: d.assess.done } : {}) };
  const block = assessBlock(s, d);
  if (block) out.block = block;
  else {
    const pending = out.linked.find(x => !x.done);
    const bad = out.linked.find(x => x.out > 0);
    if (pending) out.none = { why: 'testPending', test: pending.test };
    else if (bad) out.none = { why: 'outOfSpec', test: bad.test };
  }
  const inv = d.inv ?? Object.values(s.investigations).find(i => i.batch === d.batch && i.status === 'open')?.id;
  if (inv) out.inv = inv;
  const who = whoDev(s, d.id);
  if (who.length > 0) out.who = who;
  return out;
}

/**
 * Решение по серии на выпуске (Б1г; §6.5): серия и её ГП; проверка ГП и досье специалистом ООК — сделана, идёт или
 * ждёт; решение уполномоченного лица — идёт или ждёт; условия выпуска — лаборатория разрешила балк, сверка печатных
 * материалов сошлась (нет отклонения сверки), отклонения оценены; неоценённые отклонения и с оценкой «отклонить
 * серию» — номерами.
 */
export interface ReleaseView {
  batch: string;
  code: string;
  status: BatchStatus;
  held: boolean;
  review: 'done' | 'busy' | 'open' | 'none';
  qp: 'busy' | 'open' | 'none';
  tests: boolean;
  recon?: number;
  open: number[];
  reject: number[];
}

export function releaseOf(s: PlantState, b: Batch): ReleaseView {
  const task = (kind: string) => Object.values(s.tasks).find(t => t.kind === kind && t.batch === b.id);
  const check = task('fgCheck');
  const qp = task('qpDecide');
  const devs = devsOf(s, b);
  const recon = devs.find(d => d.kind === 'recon');
  return {
    batch: b.id,
    code: batchNo(b.code),
    status: b.status,
    held: !!b.held,
    review: b.checked !== undefined ? 'done' : check ? (check.state === 'busy' ? 'busy' : 'open') : 'none',
    qp: qp ? (qp.state === 'busy' ? 'busy' : 'open') : 'none',
    tests: !!b.bulk && s.lots[b.bulk]?.status === 'released',
    ...(recon ? { recon: num(recon.id) } : {}),
    open: openDevs(s, b).map(d => num(d.id)),
    reject: devs.filter(d => d.assess?.verdict === 'reject').map(d => num(d.id)),
  };
}

/**
 * Режимы стадии в карточке помещения и оборудования (Б1г): идёт стадия — цель и диапазон по карте и уставка, с которой
 * она началась (Б1ж); кончилась — уставка и факт из досье последней стадии в этом помещении, вне диапазона — с номером
 * отклонения. Записи до Б1ж уставок не знают — цель; факта скорости ротора у них нет.
 */
export interface Regimes {
  batch: string;
  recipe: Id;
  stage: string;
  now: boolean;
  end?: number;
  list: { id: string; unit: ParamUnit; target: number; range: [number, number]; sp: number; value?: number; dev?: number }[];
}

/**
 * Уставки стадии карты сейчас (Б1ж): с ними начнётся её следующая стадия; редакция в силе, её шаг и диапазон — для «−»
 * и «+» на посту технолога.
 */
export interface Knobs {
  recipe: Id;
  stage: string;
  list: { id: string; unit: ParamUnit; target: number; set: number; step: number; range: [number, number] }[];
}

/**
 * Уставки в карточке помещения и оборудования (Б1ж): у каждой карты в силе — стадии с режимами, которые идут
 * в помещении этого типа, — и до первой серии в нём, и у каждого продукта.
 */
export function knobsAt(db: ContentDb, s: PlantState, room: string): Knobs[] {
  const type = s.rooms[room]?.type;
  const day = momentOf(s.start, s.t).day;
  const ids = [...new Set(Object.keys(db.recipes).map(id => inForce(db, 'recipes', id, day)))];
  return ids.flatMap(id =>
    db.recipes[id].stages
      .filter(st => st.room === type && st.params.length > 0)
      .map(st => ({ recipe: id, stage: st.id, list: st.params.map(p => ({ id: p.id, unit: p.unit, target: p.target, set: setpointOf(db, s, id, st.id, p), step: p.step, range: [p.range[0], p.range[1]] as [number, number] })) })),
  );
}

export function regimesAt(db: ContentDb, s: PlantState, room: string): Regimes | undefined {
  const r = s.rooms[room];
  const busy = r?.status === 'busy' && r.batch ? s.batches[r.batch] : undefined;
  if (busy) {
    const st = db.recipes[busy.recipe].stages[busy.stage];
    if (st && st.params.length > 0 && !busy.records.some(x => x.stage === st.id)) {
      return {
        batch: batchNo(busy.code),
        recipe: busy.recipe,
        stage: st.id,
        now: true,
        list: st.params.map(p => ({ id: p.id, unit: p.unit, target: p.target, range: [p.range[0], p.range[1]], sp: busy.sp?.[p.id] ?? p.target })),
      };
    }
  }
  // последняя записанная стадия в помещении — с режимами
  let last: { b: Batch; i: number } | undefined;
  for (const b of Object.values(s.batches)) {
    b.records.forEach((x, i) => {
      if (x.room !== room || Object.keys(x.params).length === 0) return;
      if (!last || x.end > last.b.records[last.i].end) last = { b, i };
    });
  }
  if (!last) return undefined;
  const rec = last.b.records[last.i];
  const st = db.recipes[last.b.recipe].stages.find(x => x.id === rec.stage);
  if (!st) return undefined;
  const devs = Object.values(s.deviations).filter(d => d.kind === 'param' && d.batch === last!.b.id && d.stage === rec.stage);
  return {
    batch: batchNo(last.b.code),
    recipe: last.b.recipe,
    stage: rec.stage,
    now: false,
    end: rec.end,
    list: st.params.map(p => {
      const dev = devs.find(d => d.param === p.id);
      return { id: p.id, unit: p.unit, target: p.target, range: [p.range[0], p.range[1]], sp: rec.sp?.[p.id] ?? p.target, ...(rec.params[p.id] !== undefined ? { value: rec.params[p.id] } : {}), ...(dev ? { dev: num(dev.id) } : {}) };
    }),

  };
}
