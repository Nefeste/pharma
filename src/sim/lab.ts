// Лаборатория (docs/specs/2026-10-panels.md, 3г): очередь проб и испытаний и контрольная карта средней массы таблеток —
// виды для панели, чистые функции из состояния, как склад и карточка (views.ts). Без истины: результат испытания — только
// проверенный вторым лицом, значения карты — измерения МОК, а не истинные свойства серий.
import type { ContentDb, Id } from '../content/types';
import { batchNo } from '../engine/batchno';
import { LAB_PRIO } from '../engine/lab';
import type { LabTest, PlantState, Task, TaskKind, WaitCause } from '../engine/types';

export interface LabQuery {
  view: 'lab';
}

export interface ChartQuery {
  view: 'chart';
  /** методика МОК: `test.ipc.mass` */
  test: Id;
}

type Code = [number, number, number];
const code = (c: { y: number; m: number; n: number }): Code => [c.y, c.m, c.n];

/** Задача и чего она ждёт: открыта — причина и с какого мгновения; занята — идёт. */
export interface TaskNow {
  task: TaskKind;
  busy: boolean;
  wait?: WaitCause;
  since: number;
}

export interface LabTestRow {
  method: Id;
  state: LabTest['state'];
  /** вид прибора, если он уже выбран */
  inst?: Id;
  now?: TaskNow;
  /** только у проверенного испытания */
  result?: number;
  pass?: boolean;
  /** испытание шага расследования (часть 4): той же пробы, в решение по партии не входит */
  inv?: true;
}

/**
 * Где партия на пути через лабораторию: ждёт плана отбора, отбор проб, передача проб, испытания, решение; результат вне
 * спецификации — расследование (часть 4).
 */
export type LabStage = 'plan' | 'sampling' | 'handover' | 'tests' | 'decide' | 'inv';

export interface LabLotRow {
  /** номер партии в учёте — для команды «поднять» */
  lot: string;
  code: Code;
  material: Id;
  rush: boolean;
  stage: LabStage;
  done: number;
  all: number;
  /** задача партии: отбор, перевозка, передача, решение */
  now?: TaskNow;
  /** редакция спецификации, по которой её испытывают (Б3а): действующая при отборе пробы */
  spec?: Id;
  tests: LabTestRow[];
}

export interface LabView {
  view: 'lab';
  rows: LabLotRow[];
  /** приборы по плану: вид и методика испытания, которым занят */
  instruments: { type: Id; method?: Id }[];
}

const LAB = new Set<string>(Object.keys(LAB_PRIO));

export const nowOf = (s: PlantState, t: Task): TaskNow => ({
  task: t.kind,
  busy: t.state === 'busy',
  ...(t.why ? { wait: t.why } : {}),
  since: t.state === 'open' && t.since !== undefined ? t.since : t.created,
});

/** Очередь лаборатории: партии в карантине, с отобранными пробами и на испытаниях — кроме готовой продукции (её проверяет ООК). */
export function labView(db: ContentDb, s: PlantState): LabView {
  const order = new Map(s.open.map((id, i) => [id, i]));
  // задачи лаборатории по партии и по испытанию; у партии — первая по очереди раздачи, занятая — раньше открытых
  const byLot = new Map<string, Task[]>();
  const byTest = new Map<string, Task[]>();
  for (const t of Object.values(s.tasks)) {
    if (!LAB.has(t.kind)) continue;
    if (t.test) byTest.set(t.test, [...(byTest.get(t.test) ?? []), t]);
    else if (t.lot) byLot.set(t.lot, [...(byLot.get(t.lot) ?? []), t]);
  }
  // расследования (часть 4): открытые — по партии; испытания их шагов — по пробе
  const open = new Set(Object.values(s.investigations).flatMap(i => (i.status === 'open' ? [i.lot] : [])));
  const extra = new Map<string, LabTest[]>();
  for (const q of Object.values(s.tests)) if (q.inv) extra.set(q.sample, [...(extra.get(q.sample) ?? []), q]);
  const rank = (t: Task) => (t.state === 'busy' ? -1 : (order.get(t.id) ?? Number.MAX_SAFE_INTEGER));
  const first = (list: Task[] | undefined) => (list ?? []).slice().sort((a, b) => rank(a) - rank(b))[0];
  const rows: (LabLotRow & { pos: number })[] = [];
  for (const lot of Object.values(s.lots)) {
    if (lot.status !== 'quarantine' && lot.status !== 'sampled' && lot.status !== 'testing') continue;
    if (db.materials[lot.material]?.kind === 'fg') continue;
    const sm = lot.sample ? s.samples[lot.sample] : undefined;
    const tests = (sm?.tests ?? []).map(id => s.tests[id]).filter((q): q is LabTest => !!q);
    const done = tests.filter(q => q.state === 'done').length;
    const stage: LabStage = open.has(lot.id) ? 'inv' : !sm ? 'plan' : sm.left.length > 0 ? 'sampling' : tests.length === 0 ? 'handover' : done < tests.length ? 'tests' : 'decide';
    const own = first(byLot.get(lot.id));
    const more = sm ? (extra.get(sm.id) ?? []) : [];
    const testRows: LabTestRow[] = [...tests, ...more].map(q => {
      const t = first(byTest.get(q.id));
      return {
        method: q.method,
        state: q.state,
        ...(q.inst && s.instruments[q.inst] ? { inst: s.instruments[q.inst].type } : {}),
        ...(t ? { now: nowOf(s, t) } : {}),
        ...(q.state === 'done' && q.result !== undefined ? { result: q.result, pass: !!q.pass } : {}),
        ...(q.inv ? { inv: true as const } : {}),
      };
    });
    // место в очереди — первая открытая задача партии или её испытаний
    const all = [...(byLot.get(lot.id) ?? []), ...[...tests, ...more].flatMap(q => byTest.get(q.id) ?? [])];
    const pos = Math.min(Number.MAX_SAFE_INTEGER, ...all.map(t => order.get(t.id) ?? Number.MAX_SAFE_INTEGER));
    const spec = tests.find(q => q.spec)?.spec;
    rows.push({ lot: lot.id, code: code(lot.code), material: lot.material, rush: !!lot.rush, stage, done, all: tests.length, ...(own ? { now: nowOf(s, own) } : {}), ...(spec ? { spec } : {}), tests: testRows, pos });
  }
  rows.sort((a, b) => Number(b.rush) - Number(a.rush) || a.pos - b.pos || Number(a.lot.slice(1)) - Number(b.lot.slice(1)));
  return {
    view: 'lab',
    rows: rows.map(({ pos: _, ...r }) => r),
    instruments: Object.values(s.instruments).map(i => ({ type: i.type, ...(i.test && s.tests[i.test] ? { method: s.tests[i.test].method } : {}) })),
  };
}

// ---------------------------------------------------------------- контрольная карта

/** Границы карты X–Rm (`10-domain.md`, §7; NIST 6.3.2.1–6.3.2.2): среднее, средний скользящий размах, границы. */
export interface Limits {
  mean: number;
  mr: number;
  ucl: number;
  lcl: number;
  mrUcl: number;
}

/** d₂ при n = 2 и D₄ для карты размахов при n = 2. */
const D2 = 1.128;
const D4 = 3.267;

/** Границы по значениям: нужно хотя бы два — иначе скользящего размаха нет. */
export function limitsOf(values: readonly number[]): Limits | undefined {
  if (values.length < 2) return undefined;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let sum = 0;
  for (let i = 1; i < values.length; i++) sum += Math.abs(values[i] - values[i - 1]);
  const mr = sum / (values.length - 1);
  return { mean, mr, ucl: mean + (3 * mr) / D2, lcl: mean - (3 * mr) / D2, mrUcl: D4 * mr };
}

/** Признак особой причины у точки: вне границ, 7 подряд по одну сторону, 7 подряд растут или падают, размах выше границы. */
export type Signal = 'out' | 'run' | 'trend' | 'mr';

/** Сколько точек подряд — признак (основной текст `gost-7870-2`, `10-domain.md`, §7). */
export const RUN = 7;

/** Признаки по точкам: у каждой точки — список; серия из 7 метит седьмую точку и все следующие, пока она длится. */
export function signalsOf(values: readonly number[], l: Limits): Signal[][] {
  const out: Signal[][] = values.map(() => []);
  let side = 0;
  let sideLen = 0;
  let dir = 0;
  let dirLen = 1;
  values.forEach((v, i) => {
    if (v > l.ucl || v < l.lcl) out[i].push('out');
    const sd = v > l.mean ? 1 : v < l.mean ? -1 : 0;
    sideLen = sd !== 0 && sd === side ? sideLen + 1 : sd !== 0 ? 1 : 0;
    side = sd;
    if (sideLen >= RUN) out[i].push('run');
    if (i > 0) {
      const d = v > values[i - 1] ? 1 : v < values[i - 1] ? -1 : 0;
      dirLen = d !== 0 && d === dir ? dirLen + 1 : d !== 0 ? 2 : 1;
      dir = d;
      if (dirLen >= RUN) out[i].push('trend');
      if (Math.abs(v - values[i - 1]) > l.mrUcl) out[i].push('mr');
    }
  });
  return out;
}

export interface ChartPoint {
  t: number;
  /** значение — в единицах движка свойства: у массы — доли 1/10 000 номинала */
  v: number;
  /** номер серии строкой (src/engine/batchno.ts) */
  batch: string;
  signals: Signal[];
}

export interface ChartView {
  view: 'chart';
  test: Id;
  points: ChartPoint[];
  limits?: Limits;
  /** точек меньше 25 — границы предварительные */
  preliminary: boolean;
  /** допуск спецификации МОК: не граница карты */
  spec?: { min?: number; max?: number };
}

/** Точек, после которых границы карты уже не предварительные. */
export const SETTLED = 25;

/** Контрольная карта методики МОК: все замеры стадий всех серий по времени; точки серии появляются с концом её стадии. */
export function chartView(db: ContentDb, s: PlantState, q: ChartQuery): ChartView {
  const raw: { t: number; v: number; batch: string }[] = [];
  let spec: ChartView['spec'];
  for (const b of Object.values(s.batches)) {
    for (const rec of b.records) for (const c of rec.ipc) if (c.test === q.test) raw.push({ t: c.t, v: c.result, batch: batchNo(b.code) });
    if (!spec) {
      const st = db.recipes[b.recipe]?.stages.flatMap(x => x.ipc).find(c => c.test === q.test);
      if (st) spec = { ...(st.min !== undefined ? { min: st.min } : {}), ...(st.max !== undefined ? { max: st.max } : {}) };
    }
  }
  raw.sort((a, b) => a.t - b.t);
  const values = raw.map(p => p.v);
  const limits = limitsOf(values);
  const sig = limits ? signalsOf(values, limits) : values.map(() => []);
  return {
    view: 'chart',
    test: q.test,
    points: raw.map((p, i) => ({ ...p, signals: sig[i] })),
    ...(limits ? { limits } : {}),
    preliminary: values.length < SETTLED,
    ...(spec ? { spec } : {}),
  };
}
