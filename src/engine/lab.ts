// Лаборатория: отбор проб, испытания, решение по партии (docs/specs/2026-10-engine.md, 1б; геймдизайн, §4.3, §6.2–6.3).
// Путь партии: все паллеты встали в карантин → паллеты с тарой из плана отбора — в пробоотборную, отбор, обратно →
// пробоотборщик относит пробы в лабораторию → испытания по спецификации: подготовка аналитика, работа прибора (ВЭЖХ —
// сам, и ночью), проверка вторым лицом → решение начальника ОКК → разрешённое — на стеллаж ближе к шлюзу для
// материалов, отклонённое — в зону отклонённого, с отклонением. Задачи раздаёт раздатчик (tasks.ts): он же даёт
// испытанию аналитика и прибор.
import type { ContentDb } from '../content/types';
import { schedule } from './core/agenda';
import { MIN } from './core/calendar';
import { defect } from './lean';
import { type PlantPlan, planOf } from './plant';
import { measure, within } from './quality';
import { containersByLot, nextId, putUnit, setLotStatus, stockChanged, unitsOfLot } from './stock';
import { addTask } from './tasks';
import type { Deviation, LabTest, Lot, Notice, Place, PlantState, Sample, Task, Unit } from './types';
import { PRIO, WMS } from './wms';

/** Роли лаборатории. */
export const QC = {
  samplers: ['role.sampler'],
  analysts: ['role.analyst'],
  /** проверяет второй аналитик или начальник ОКК */
  reviewers: ['role.analyst', 'role.qc-head'],
  heads: ['role.qc-head'],
} as const;

/**
 * Приоритеты задач лаборатории рядом со складскими (wms.ts, PRIO): паллету из пробоотборной забирают раньше
 * размещения, чтобы места отбора не стояли; в пробоотборную везут после размещения.
 */
export const LAB_PRIO = { fromSampling: 35, sample: 28, handover: 28, toSampling: 25, decide: 24, review: 22, prep: 20 } as const;

/** Работа на месте: отбор с одной тары, передача проб в лабораторию, проверка результата, решение по партии. */
export const SAMPLE_WORK = 8 * MIN;
export const HANDOVER_WORK = 10 * MIN;
export const REVIEW_WORK = 15 * MIN;
export const DECIDE_WORK = 10 * MIN;

/** Где ждёт партия до решения. */
const QUARANTINE = new Set(['quarantine', 'cold']);

/**
 * Сколько тар из `n` отбирать (геймдизайн, §4.3): у АФС и у неодобренного поставщика — каждую; у одобренного —
 * 1 + ⌈√n⌉ (план ВОЗ, docs/10-domain.md, §5), но не больше `n`.
 */
export function sampleCount(db: ContentDb, lot: Lot, n: number): number {
  if (db.materials[lot.material].kind === 'api' || !db.suppliers[lot.supplier]?.approved) return n;
  let r = 0;
  while (r * r < n) r++;
  return Math.min(n, 1 + r);
}

const sampleOf = (s: PlantState, lotId: string): Sample => s.samples[s.lots[lotId].sample!];

const labPlace = (plan: PlantPlan): Place => ({ kind: 'point', x: plan.lab.x, z: plan.lab.z });

/**
 * Партии, все паллеты которых стоят в карантине или холоде, — на отбор проб: план отбора и задачи «в пробоотборную».
 * Зовётся после размещения и каждый час.
 */
export function startSampling(db: ContentDb, s: PlantState) {
  // готовую продукцию не испытывают в лаборатории — её проверяет ООК (qa.ts)
  const todo = Object.values(s.lots).filter(l => l.status === 'quarantine' && !l.sample && db.materials[l.material].kind !== 'fg');
  if (todo.length === 0) return;
  const plan = planOf(db, s.plant);
  const byLot = containersByLot(s);
  for (const lot of todo) {
    const cs = byLot.get(lot.id) ?? [];
    const units = [...new Set(cs.map(c => c.unit))].map(id => s.units[id]);
    // балк отбирают на месте, в помещении промежуточного склада; сырьё — когда все паллеты встали в карантин
    const inPlace = db.materials[lot.material].kind === 'bulk';
    if (inPlace ? !units.every(u => u.where.kind === 'room') : !units.every(u => u.where.kind === 'slot' && QUARANTINE.has(plan.slot[u.where.id].kind))) continue;
    // тара из плана — поровну по всей партии
    const k = sampleCount(db, lot, cs.length);
    const picked = Array.from({ length: k }, (_, i) => cs[Math.floor((i * cs.length) / k)]);
    const sm: Sample = { id: nextId(s, 'S'), lot: lot.id, plan: picked.map(c => c.id), left: [...new Set(picked.map(c => c.unit))], qty: 0, tests: [] };
    s.samples[sm.id] = sm;
    lot.sample = sm.id;
    for (const uid of sm.left) {
      const u = s.units[uid];
      if (u.where.kind === 'room') {
        const at = plan.room[u.where.id];
        const n = u.items.filter(c => sm.plan.includes(c)).length;
        addTask(s, { kind: 'sample', roles: [...QC.samplers], unit: uid, from: { kind: 'point', x: at.x, z: at.z }, work: n * SAMPLE_WORK, prio: LAB_PRIO.sample, lot: lot.id });
      } else {
        const from = u.where as { kind: 'slot'; id: string };
        addTask(s, { kind: 'toSampling', roles: [...WMS.movers], veh: [...WMS.floor], unit: uid, from, toKind: 'sampling', work: 0, prio: LAB_PRIO.toSampling, lot: lot.id });
      }
    }
  }
}

/** Что сделала задача лаборатории, когда кончилась. Не задача лаборатории — `false`. */
export function labDone(db: ContentDb, s: PlantState, t: Task, notices: Notice[]): boolean {
  switch (t.kind) {
    case 'toSampling': {
      const u = s.units[t.unit!];
      putUnit(s, u, t.to!);
      const sm = sampleOf(s, t.lot!);
      const n = u.items.filter(c => sm.plan.includes(c)).length;
      // паллета ждёт в шлюзе пробоотборной, пробы берут под ламинаром в самой пробоотборной (docs/specs/2026-10-view.md, 2а)
      const at = planOf(db, s.plant).room[planOf(db, s.plant).roomOf.sampling];
      addTask(s, { kind: 'sample', roles: [...QC.samplers], unit: u.id, from: { kind: 'point', x: at.x, z: at.z }, work: n * SAMPLE_WORK, prio: LAB_PRIO.sample, lot: t.lot });
      return true;
    }
    case 'sample': {
      const lot = s.lots[t.lot!];
      const m = db.materials[lot.material];
      const sm = sampleOf(s, lot.id);
      const u = s.units[t.unit!];
      // проба — с каждой тары из плана на этой паллете: тара вскрыта, масса списана с неё
      for (const cid of u.items) {
        if (!sm.plan.includes(cid)) continue;
        const c = s.containers[cid];
        const q = Math.min(m.sample, c.qty);
        c.qty -= q;
        c.opened = true;
        lot.sampled += q;
        sm.qty += q;
      }
      sm.left = sm.left.filter(id => id !== u.id);
      // из пробоотборной — обратно в карантин; балк, отобранный на месте, остаётся где стоит
      if (u.where.kind === 'slot') addTask(s, { kind: 'fromSampling', roles: [...WMS.movers], veh: [...WMS.floor], unit: u.id, from: t.from, toKind: m.storage === 'cold' ? 'cold' : 'quarantine', work: 0, prio: LAB_PRIO.fromSampling, lot: lot.id });
      if (sm.left.length === 0) {
        sm.taken = s.t;
        setLotStatus(s, lot, 'sampled');
        addTask(s, { kind: 'handover', roles: [...QC.samplers], from: labPlace(planOf(db, s.plant)), work: HANDOVER_WORK, prio: LAB_PRIO.handover, lot: lot.id });
      }
      return true;
    }
    case 'fromSampling': {
      const u = s.units[t.unit!];
      putUnit(s, u, t.to!);
      // решение могло прийти, пока паллета ждала места: сразу дальше
      settle(db, s, s.lots[t.lot!], u);
      return true;
    }
    case 'handover': {
      // пробы приняты в лаборатории: испытания по спецификации — в очередь, по времени отбора
      const lot = s.lots[t.lot!];
      const sm = sampleOf(s, lot.id);
      setLotStatus(s, lot, 'testing');
      for (const line of db.specs[db.materials[lot.material].spec].tests) {
        const m = db.tests[line.test];
        const q: LabTest = { id: nextId(s, 'Q'), sample: sm.id, method: m.id, state: 'queued', v: 0 };
        if (line.min !== undefined) q.min = line.min;
        if (line.max !== undefined) q.max = line.max;
        s.tests[q.id] = q;
        sm.tests.push(q.id);
        addTask(s, { kind: 'prep', roles: [...QC.analysts], ...(m.inst ? { inst: [m.inst] } : {}), from: t.from, work: m.prep + (m.unattended ? 0 : m.run), prio: LAB_PRIO.prep, test: q.id });
      }
      return true;
    }
    case 'prep': {
      const q = s.tests[t.test!];
      const m = db.tests[q.method];
      if (m.unattended && m.run > 0) {
        // прибор работает сам — и ночью; аналитик свободен
        q.state = 'run';
        q.v++;
        schedule(s.agenda, s.t + m.run, { kind: 'run', test: q.id, v: q.v });
      } else measured(db, s, q);
      return true;
    }
    case 'review': {
      const q = s.tests[t.test!];
      q.checker = t.people[0];
      q.state = 'done';
      q.done = s.t;
      q.pass = within({ test: q.method, min: q.min, max: q.max }, q.result!);
      const sm = s.samples[q.sample];
      if (sm.tests.every(id => s.tests[id].state === 'done')) addTask(s, { kind: 'decide', roles: [...QC.heads], from: t.from, work: DECIDE_WORK, prio: LAB_PRIO.decide, lot: sm.lot });
      return true;
    }
    case 'decide': {
      // политика по умолчанию: все испытания в пределах — разрешить; иначе — отклонить и открыть отклонение
      const lot = s.lots[t.lot!];
      const out = sampleOf(s, lot.id).tests.filter(id => !s.tests[id].pass);
      if (out.length === 0) {
        setLotStatus(s, lot, 'released');
        stockChanged(s);
        notices.push({ kind: 'lotReleased', lot: lot.id });
      } else {
        setLotStatus(s, lot, 'rejected');
        const d: Deviation = { id: nextId(s, 'D'), opened: s.t, kind: 'oos', lot: lot.id, tests: out, status: 'open' };
        s.deviations[d.id] = d;
        defect(s, 'deviations');
        defect(s, lot.batch ? 'batches' : 'lots');
        notices.push({ kind: 'lotRejected', lot: lot.id, deviation: d.id });
      }
      for (const u of unitsOfLot(s, lot.id)) settle(db, s, lot, u);
      return true;
    }
    default:
      return false;
  }
}

/** Событие: прибор кончил работать сам. Устаревшая версия — ничего. */
export function runDone(db: ContentDb, s: PlantState, id: string, v: number) {
  const q = s.tests[id];
  if (!q || q.v !== v || q.state !== 'run') return;
  measured(db, s, q);
}

/** Прибор кончил работу: результат из ветви прибора, прибор свободен, результат — на проверку второму лицу. */
function measured(db: ContentDb, s: PlantState, q: LabTest) {
  const m = db.tests[q.method];
  const lot = s.lots[s.samples[q.sample].lot];
  q.result = measure(s, `qc/${q.inst ?? m.id}`, lot.truth[m.attr] ?? 0, m.sd);
  if (q.inst) delete s.instruments[q.inst].test;
  q.state = 'review';
  addTask(s, { kind: 'review', roles: [...QC.reviewers], not: q.by ? [q.by] : [], from: labPlace(planOf(db, s.plant)), work: REVIEW_WORK, prio: LAB_PRIO.review, test: q.id });
}

/**
 * Паллета решённой партии — на своё место: разрешённое — на стеллаж ближе к шлюзу для материалов (ABC прототипа), в
 * холоде — остаётся в холоде; отклонённое — в зону отклонённого. Паллету, которую уже везут, — когда довезут.
 */
function settle(db: ContentDb, s: PlantState, lot: Lot, u: Unit) {
  if (lot.status !== 'released' && lot.status !== 'rejected') return;
  if (u.where.kind !== 'slot' || Object.values(s.tasks).some(x => x.unit === u.id)) return;
  const plan = planOf(db, s.plant);
  const at = plan.slot[u.where.id];
  const from: Place = { kind: 'slot', id: at.id };
  if (lot.status === 'released') {
    if (at.kind === 'storage' || db.materials[lot.material].storage === 'cold') return;
    const gate = plan.byKind.staging[0];
    addTask(s, { kind: 'putaway', roles: [...WMS.movers], veh: [...WMS.floor], unit: u.id, from, toKind: 'storage', near: { x: gate.x, z: gate.z }, work: 0, prio: PRIO.putaway, lot: lot.id });
  } else if (at.kind !== 'rejected') {
    addTask(s, { kind: 'move', roles: [...WMS.movers], veh: [...WMS.floor], unit: u.id, from, toKind: 'rejected', work: 0, prio: PRIO.putaway, lot: lot.id });
  }
}
