// Расследование результата вне спецификации (docs/specs/2026-10-investigation.md; геймдизайн, §6.6; архитектура, §9).
// Происшествие сценария — корень по жребию зерна и его следы в состоянии завода; результат испытания вне спецификации
// открывает отклонение и расследование, партия ждёт; шаги — задачи людей своей роли или испытания лаборатории; улики —
// из состояния завода; вывод — копия «Анамнеза» (infer.ts); решение — причина и судьба серии; коллега качества ведёт
// расследование сам, пока игрок не держит пост качества. Скрытое — корень и что вызвало улики — окно видит только в
// разборе.
import type { Attr, ContentDb, FindingRead, Id, IncidentRoot, InvFinding, InvModel, InvStep, RecipeStage } from '../content/types';
import { MIN } from './core/calendar';
import { P_ONE } from './core/rng';
import { expectedGain, posterior, quantize } from './infer';
import { labPlace, LAB_PRIO, QC, settleLot } from './lab';
import { defect } from './lean';
import { planOf } from './plant';
import { within } from './quality';
import { roll } from './random';
import { held } from './seats';
import { nextId, setLotStatus, stockChanged, unitsOfLot } from './stock';
import { addTask } from './tasks';
import { type Batch, type Command, INSTRUMENT_FAULTS, type InstrumentFault, type Investigation, type LabTest, type Lot, type Notice, type Place, type PlantState, type StageRecord, type Task } from './types';

/** Номер неисправности прибора в числах улики — для слов окна: 0–3 — сбой, 4 — просроченная калибровка. */
export const FAULT_NO: Record<InstrumentFault, number> = { height: 0, centering: 1, deaeration: 2, vibration: 3, overdue: 4 };

/** Задачи расследования — выше обычной работы ООК (гипотеза): серия ждёт их. */
export const INV_PRIO = 27;
/** Замена сита калибратора по решению расследования — работа механика (гипотеза). */
export const FIX_WORK = 30 * MIN;
/** Шаг дешевле этого коллега не считает: польза на час — на час с четвертью (гипотеза). */
const MIN_HOURS = 0.25;
/** Фон «чуть за пределом» у режима — на четверть отхода от цели до предела (гипотеза). */
const LEAK_PART = 4;

const modelOf = (db: ContentDb, inv: Investigation) => db.investigations[inv.model];

/** Версия «ошибка лаборатории» — та, у которой нет причины в каталоге: серия ни при чём. */
export const isLab = (m: InvModel, id: string) => m.candidates.some(c => c.id === id && c.cause === undefined);

/** Игрок держит пост качества (или директор, 3е) — расследование ждёт его; мест нет — ведёт коллега. */
export function playerLeads(s: PlantState): boolean {
  const h = held(s);
  return !!h && (h.includes('quality') || h.includes('director'));
}

// ---------------------------------------------------------------- происшествие

/** Режим, который неисправность корня делает длиннее или выше: режим причины версии корня. */
function paramOf(db: ContentDb, m: InvModel, root: string): string | undefined {
  const c = m.candidates.find(x => x.id === root)?.cause;
  const d = c ? db.causes[c]?.driver : undefined;
  return d && 'param' in d ? d.param : undefined;
}

/** Версия — сито калибратора: у её причины источник — сито. */
export function isScreenCause(db: ContentDb, m: InvModel, root: string): boolean {
  const c = m.candidates.find(x => x.id === root)?.cause;
  const d = c ? db.causes[c]?.driver : undefined;
  return !!d && 'screen' in d;
}

/**
 * Улики, которые происшествие бросает монетой (noisy-OR, как утечка признака у «Анамнеза»): отметки у записи испытания и
 * у прибора, режим за пределом, замена сита в журнале. Остальное — следствия состояния завода: повтор, МОК, паспорт,
 * сито на месте, гранулометрия — их не бросают.
 */
const thrown = (r: FindingRead) => 'mark' in r || 'param' in r || 'journal' in r;

/**
 * Происшествие сценария (docs/specs/2026-10-investigation.md, «Происшествие»): корень и величина — по жребию зерна;
 * брошенные улики — от корня или фон. След корня — режим стадии, сито, ошибка испытания — ставят хуки стадий и
 * лаборатории, когда до них дойдёт серия.
 */
export function newIncident(db: ContentDb, s: PlantState) {
  const sc = db.scenarios[s.scenario];
  const def = sc.incident;
  // задания на серию сценария — первые задания партии, B1…Bn; у сценария без них происшествия нет
  if (!def || sc.batches.length < def.batch) return;
  const m = db.investigations[def.inv];
  const root = roll(s, 'incident/root', r => r.weightedKey(def.roots)) as IncidentRoot;
  const [lo, hi] = def.sizes[root];
  const size = roll(s, 'incident/size', r => r.range(lo, hi));
  const fired: Record<string, IncidentRoot | 'leak'> = {};
  for (const f of m.findings) {
    if (!thrown(f.read)) continue;
    const r = f.read;
    // режим и журнал сита корень меняет всегда — его неисправность и есть этот след; отметки — с вероятностью версии
    const byRoot = 'param' in r ? paramOf(db, m, root) === r.param : 'journal' in r ? isScreenCause(db, m, root) : roll(s, `incident/${f.id}`, x => x.chance(f.by[root] ?? 0));
    if (byRoot) fired[f.id] = root;
    else if (roll(s, `incident/leak/${f.id}`, x => x.chance(f.leak))) fired[f.id] = 'leak';
  }
  s.incident = { batch: `B${def.batch}`, inv: def.inv, root, size, fired };
}

/** Брошенная улика происшествия у этой серии: от корня, фон или нет. */
function firedOf(db: ContentDb, s: PlantState, b: Batch, pick: (r: FindingRead) => boolean): IncidentRoot | 'leak' | undefined {
  const inc = s.incident;
  if (!inc || inc.batch !== b.id) return undefined;
  const f = db.investigations[inc.inv].findings.find(x => pick(x.read) && inc.fired[x.id]);
  return f ? inc.fired[f.id] : undefined;
}

/**
 * Режимы стадии серии происшествия — сразу после того, как их записали: неисправность корня — цель плюс величина; фон —
 * чуть за пределом карты. Отклонение режима откроет проверка пределов, как у любой серии.
 */
export function incidentParams(db: ContentDb, s: PlantState, b: Batch, st: RecipeStage, rec: StageRecord) {
  for (const p of st.params) {
    const by = firedOf(db, s, b, r => 'param' in r && r.param === p.id);
    if (by === undefined) continue;
    rec.params[p.id] = by === 'leak' ? p.range[1] + Math.ceil((p.range[1] - p.target) / LEAK_PART) : p.target + s.incident!.size;
  }
}

/**
 * Калибровка серии (стадия с ситом по карте) начинается: у серии происшествия перед ней в журнале калибратора — замена
 * сита: у корня «сито» — крупнее карты, у фона — то же. Сито крупнее стоит, пока его не поменяют по решению
 * расследования. Отход сита на калибровке серии — скрытое поле серии: в её записи — сито по карте.
 */
export function incidentScreen(db: ContentDb, s: PlantState, b: Batch, st: RecipeStage, machine: string, at: number) {
  if (st.screen === undefined) return;
  const by = firedOf(db, s, b, r => 'journal' in r);
  if (by !== undefined && !s.maintLog.some(e => e.machine === machine && e.part === 'screen' && e.t === at)) {
    if (by !== 'leak') s.incident!.screen = s.incident!.size;
    // журнал — по времени: замена — в начале калибровки серии
    let i = s.maintLog.length;
    while (i > 0 && s.maintLog[i - 1].t > at) i--;
    s.maintLog.splice(i, 0, { t: at, machine, part: 'screen', what: 'replace', wear: 0 });
  }
  if (s.incident?.screen) b.screen = s.incident.screen;
}

/**
 * Испытание партии балка серии происшествия измерено: у корня «ошибка лаборатории» первое испытание методики модели —
 * ниже истинного на величину; отметки у записи и у прибора — от корня или фон. Повтор и шаги расследования не трогает.
 */
export function incidentMeasured(db: ContentDb, s: PlantState, q: LabTest) {
  const inc = s.incident;
  if (!inc || q.inv || q.result === undefined) return;
  const lot = s.lots[s.samples[q.sample].lot];
  const m = db.investigations[inc.inv];
  if (lot.batch !== inc.batch || lot.id !== s.batches[inc.batch]?.bulk || q.method !== m.test) return;
  // только первое испытание этой методики у этой пробы
  if (s.samples[q.sample].tests.some(id => id !== q.id && s.tests[id].method === q.method && s.tests[id].result !== undefined)) return;
  if (inc.root === 'lab') q.result -= inc.size;
  for (const f of m.findings) {
    const r = f.read;
    const by = inc.fired[f.id];
    if (!('mark' in r) || !by) continue;
    // от корня — ошибка, исказившая результат; фон — описка или просроченная калибровка, на результат не повлиявшие
    if (r.mark === 'calc') q.mark = by === 'leak' ? 'typo' : 'calc';
    else if (q.inst) s.instruments[q.inst].check = by === 'leak' ? 'overdue' : roll(s, 'incident/instrument', x => x.pick(INSTRUMENT_FAULTS));
  }
}

// ---------------------------------------------------------------- открыть

/** Модель расследования для результатов вне спецификации у своей продукции: все они — её методикой. */
export function modelFor(db: ContentDb, s: PlantState, lot: Lot, out: string[]): InvModel | undefined {
  if (!lot.batch || out.length === 0) return undefined;
  const methods = new Set(out.map(id => s.tests[id].method));
  if (methods.size !== 1) return undefined;
  const [method] = methods;
  return Object.values(db.investigations).find(m => m.test === method);
}

/**
 * Корень без происшествия: результат в норме по истине — ошибка лаборатории; иначе — версия с причиной, чей вклад в
 * показатель модели сильнее всех тянет вниз. Улик-монет нет.
 */
function truthOf(db: ContentDb, s: PlantState, m: InvModel, b: Batch, lot: Lot): Investigation['truth'] {
  const attr = db.tests[m.test].attr;
  const first = Object.values(s.tests).find(q => s.samples[q.sample]?.lot === lot.id && q.method === m.test && !q.inv);
  if (first && within({ test: m.test, min: first.min, max: first.max }, lot.truth[attr] ?? 0)) return { root: m.candidates.find(c => !c.cause)!.id, fired: {} };
  let root = m.candidates.find(c => !c.cause)!.id;
  let worst = 0;
  for (const c of m.candidates) {
    if (!c.cause) continue;
    const d = b.causes.filter(h => h.cause === c.cause && h.attr === attr).reduce((n, h) => n + h.delta, 0);
    if (d < worst) {
      worst = d;
      root = c.id;
    }
  }
  return { root, fired: {} };
}

/**
 * Результат вне спецификации (часть 4): отклонение и расследование; партия остаётся «на испытаниях» — её решит
 * расследование. Скрытое — корень происшествия или корень по вкладам причин.
 */
export function openInvestigation(db: ContentDb, s: PlantState, m: InvModel, lot: Lot, out: string[], notices: Notice[]) {
  const b = s.batches[lot.batch!];
  const id = nextId(s, 'I');
  const d = { id: nextId(s, 'D'), opened: s.t, kind: 'oos' as const, lot: lot.id, batch: b.id, tests: out, status: 'open' as const, inv: id };
  s.deviations[d.id] = d;
  defect(s, 'deviations');
  const inc = s.incident;
  const truth = inc && inc.batch === b.id && inc.inv === m.id ? { root: inc.root, fired: { ...inc.fired } } : truthOf(db, s, m, b, lot);
  s.investigations[id] = { id, model: m.id, deviation: d.id, batch: b.id, lot: lot.id, test: out[0], opened: s.t, runs: [], obs: [], status: 'open', truth };
  notices.push({ kind: 'investigation', id, batch: b.id, lot: lot.id, method: m.test, code: [b.code.y, b.code.m, b.code.n] });
}

// ---------------------------------------------------------------- шаги

/** Где работа шага: у оборудования — его помещение; лабораторный — лаборатория; иначе — пост роли. */
function placeOf(db: ContentDb, s: PlantState, st: InvStep): Place {
  const plan = planOf(db, s.plant);
  if (st.at) {
    const e = Object.values(s.equipment).find(x => x.type === st.at);
    if (e) return { kind: 'point', x: plan.room[e.room].x, z: plan.room[e.room].z };
  }
  const post = st.role ? plan.posts[st.role] : undefined;
  return post ? { kind: 'point', x: post.x, z: post.z } : labPlace(plan);
}

/** Начать шаг: задача человека роли или испытание лаборатории (повтор — той же пробы другим аналитиком). */
function startStep(db: ContentDb, s: PlantState, inv: Investigation, st: InvStep, by: string) {
  const run: Investigation['runs'][number] = { step: st.id, from: s.t, by };
  if (st.test) {
    const first = s.tests[inv.test];
    const m = db.tests[st.test];
    const q: LabTest = {
      id: nextId(s, 'Q'),
      sample: first.sample,
      method: m.id,
      state: 'queued',
      v: 0,
      inv: inv.id,
      ...(st.retest && first.min !== undefined ? { min: first.min } : {}),
      ...(st.retest && first.max !== undefined ? { max: first.max } : {}),
    };
    s.tests[q.id] = q;
    const plan = planOf(db, s.plant);
    addTask(s, {
      kind: 'prep',
      roles: [...QC.analysts],
      ...(m.inst ? { inst: [m.inst] } : {}),
      from: labPlace(plan),
      work: m.prep + (m.unattended ? 0 : m.run),
      prio: LAB_PRIO.prep + INV_PRIO,
      test: q.id,
      // повтор по процедуре OOS — другой аналитик (fda-oos)
      ...(st.retest && first.by ? { not: [first.by] } : {}),
    });
    run.test = q.id;
  } else {
    const t = addTask(s, { kind: 'invStep', roles: [st.role!], from: placeOf(db, s, st), work: st.work!, prio: INV_PRIO, inv: inv.id, step: st.id, batch: inv.batch });
    run.task = t.id;
  }
  inv.runs.push(run);
}

/** Команда «шаг расследования» (часть 4): отказы — нет расследования, решено, нет шага, шаг уже был. */
export function investigateCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'investigate' }>, notices: Notice[]) {
  const inv = s.investigations[cmd.inv];
  if (!inv) return notices.push({ kind: 'refused', cmd: 'investigate', why: 'noInv', detail: cmd.inv });
  if (inv.status !== 'open') return notices.push({ kind: 'refused', cmd: 'investigate', why: 'closed', detail: cmd.inv });
  const st = modelOf(db, inv).steps.find(x => x.id === cmd.step);
  if (!st) return notices.push({ kind: 'refused', cmd: 'investigate', why: 'noStep', detail: cmd.step });
  if (inv.runs.some(r => r.step === st.id)) return notices.push({ kind: 'refused', cmd: 'investigate', why: 'already', detail: cmd.step });
  startStep(db, s, inv, st, cmd.by ?? 'player');
}

/** Стадии серии с режимом или с ситом по карте. */
const stageWith = (db: ContentDb, b: Batch, f: (st: RecipeStage) => boolean) => db.recipes[b.recipe].stages.find(f);

/** Калибратор серии: оборудование помещения стадии с ситом по карте того вида, что у стадии. */
function millOf(db: ContentDb, s: PlantState, b: Batch): string | undefined {
  const st = stageWith(db, b, x => x.screen !== undefined);
  const rec = st ? b.records.find(r => r.stage === st.id) : undefined;
  return rec?.equipment.find(e => st!.equipment.includes(s.equipment[e]?.type ?? ''));
}

/** Партии АФС, отвешенные в серию. */
const apiLots = (db: ContentDb, b: Batch) => [...new Set(b.dispensed.filter(x => db.materials[x.material].kind === 'api').map(x => x.lot))];

/**
 * Прочесть улику из состояния завода: есть ли она и числа для слов — в единицах движка. Неприменима (нечем проверить) —
 * `undefined`.
 */
function readFinding(db: ContentDb, s: PlantState, inv: Investigation, f: InvFinding, test?: LabTest): { present: boolean; data?: number[] } | undefined {
  const b = s.batches[inv.batch];
  const first = s.tests[inv.test];
  const r = f.read;
  if ('mark' in r) {
    if (r.mark === 'calc') return { present: first.mark !== undefined, ...(first.mark ? { data: [first.mark === 'calc' ? 1 : 0] } : {}) };
    if (!first.inst) return undefined;
    const fault = s.instruments[first.inst]?.check;
    return { present: fault !== undefined, ...(fault ? { data: [FAULT_NO[fault]] } : {}) };
  }
  if ('retest' in r) {
    if (test?.result === undefined) return undefined;
    return { present: within({ test: test.method, min: test.min, max: test.max }, test.result), data: [test.result] };
  }
  if ('measure' in r) return test?.result === undefined ? undefined : { present: test.result > r.above, data: [test.result] };
  if ('param' in r) {
    const st = stageWith(db, b, x => x.params.some(p => p.id === r.param));
    const p = st?.params.find(x => x.id === r.param);
    const v = st ? b.records.find(x => x.stage === st.id)?.params[r.param] : undefined;
    return p && v !== undefined ? { present: v > p.range[1], data: [v, p.target, p.range[1]] } : undefined;
  }
  if ('ipc' in r) {
    const xs = b.records.flatMap(x => x.ipc.filter(c => c.test === r.ipc).map(c => c.result));
    if (xs.length === 0) return undefined;
    const mean = Math.round(xs.reduce((a, v) => a + v, 0) / xs.length);
    return { present: (r.below !== undefined && mean < r.below) || (r.above !== undefined && mean > r.above), data: [mean] };
  }
  if ('journal' in r) {
    const mill = millOf(db, s, b);
    const st = stageWith(db, b, x => x.screen !== undefined);
    const rec = st ? b.records.find(x => x.stage === st.id) : undefined;
    if (!mill || !rec) return undefined;
    // замена с прошлой калибровки на этом калибраторе до калибровки серии
    const prev = Object.values(s.batches)
      .flatMap(x => (x.id === b.id ? [] : x.records.filter(y => y.stage === st!.id && y.equipment.includes(mill) && y.end <= rec.start)))
      .reduce((t, y) => Math.max(t, y.end), Number.NEGATIVE_INFINITY);
    const e = s.maintLog.filter(x => x.machine === mill && x.part === 'screen' && x.t > prev && x.t <= rec.start).pop();
    return { present: !!e, ...(e ? { data: [e.t] } : {}) };
  }
  if ('coa' in r) {
    const vs = apiLots(db, b).map(id => s.lots[id].coa[r.coa]).filter((v): v is number => v !== undefined);
    return vs.length === 0 ? undefined : { present: Math.max(...vs) > r.above, data: [Math.max(...vs)] };
  }
  if ('peers' in r) {
    const mine = new Set(apiLots(db, b));
    const m = modelOf(db, inv);
    const results: number[] = [];
    let out = false;
    for (const x of Object.values(s.batches)) {
      if (x.id === b.id || !x.bulk || !x.dispensed.some(k => mine.has(k.lot))) continue;
      const q = Object.values(s.tests).find(t => s.samples[t.sample]?.lot === x.bulk && t.method === m.test && !t.inv && t.state === 'done' && !t.invalid);
      if (!q || q.result === undefined) continue;
      results.push(q.result);
      if (!q.pass) out = true;
    }
    return results.length === 0 ? undefined : { present: out, data: results };
  }
  // сито на калибраторе сейчас: крупнее карты — пока его не поменяли
  return { present: !!s.incident?.screen };
}

/** Шаг кончился: улики шага — из состояния, с точностью шага (монета — своя ветвь шага). */
function observe(db: ContentDb, s: PlantState, inv: Investigation, st: InvStep, test: LabTest | undefined, notices: Notice[]) {
  const m = modelOf(db, inv);
  for (const c of st.checks) {
    const f = m.findings.find(x => x.id === c.f)!;
    const r = readFinding(db, s, inv, f, test);
    if (!r) continue;
    const p = r.present ? c.sens : P_ONE - c.spec;
    const shown = p >= P_ONE ? true : p <= 0 ? false : roll(s, `inv/${inv.id}/${st.id}/${f.id}`, x => x.chance(p));
    // числа отметки — только у найденной: пропущенную шагом ошибку завод не знает; числа записей знает всегда
    const data = r.data && (shown || !('mark' in f.read)) ? r.data : undefined;
    inv.obs.push({ f: f.id, step: st.id, shown, t: s.t, ...(data ? { data } : {}) });
    // была ли улика на самом деле — для разбора
    (inv.truth.present ??= {})[f.id] = r.present;
  }
  const run = inv.runs.find(x => x.step === st.id)!;
  run.to = s.t;
  notices.push({ kind: 'invStep', id: inv.id, step: st.id });
}

/** Испытание шага проверено вторым лицом — улики шага. */
export function invTestDone(db: ContentDb, s: PlantState, q: LabTest, notices: Notice[]) {
  const inv = q.inv ? s.investigations[q.inv] : undefined;
  const run = inv?.runs.find(r => r.test === q.id);
  if (!inv || !run || run.to !== undefined) return;
  observe(db, s, inv, modelOf(db, inv).steps.find(x => x.id === run.step)!, q, notices);
}

/** Задача расследования кончилась: шаг — улики; замена сита — сито по карте. Не задача расследования — `false`. */
export function invDone(db: ContentDb, s: PlantState, t: Task, notices: Notice[]): boolean {
  if (t.kind === 'invStep') {
    const inv = s.investigations[t.inv!];
    const run = inv?.runs.find(r => r.task === t.id);
    if (inv && run && run.to === undefined) observe(db, s, inv, modelOf(db, inv).steps.find(x => x.id === run.step)!, undefined, notices);
    return true;
  }
  if (t.kind === 'invFix') {
    if (s.incident) delete s.incident.screen;
    s.maintLog.push({ t: s.t, machine: t.part!, part: 'screen', what: 'replace', wear: 0, people: [...t.people] });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- решение

/**
 * Ошибка лаборатории доказана: шаг нашёл лабораторную причину — ошибку в записи или сбой прибора, — и повтор той же пробы
 * в пределах. Один повтор в пределах первого результата не отменяет (`fda-oos`).
 */
export function labProven(db: ContentDb, inv: Investigation): boolean {
  const m = modelOf(db, inv);
  const readOf = (f: string) => m.findings.find(x => x.id === f)?.read;
  // лабораторная причина — событие испытания, которое могло дать этот результат: ошибка пересчёта или сбой прибора;
  // описка и просроченная калибровка его не объясняют
  const cause = inv.obs.some(o => {
    const r = readOf(o.f);
    if (!o.shown || !r || !('mark' in r) || !o.data) return false;
    return r.mark === 'calc' ? o.data[0] === 1 : o.data[0] !== FAULT_NO.overdue;
  });
  return cause && inv.obs.some(o => o.shown && !!readOf(o.f) && 'retest' in readOf(o.f)!);
}

/** Решить: причина, судьба серии; у причины «сито» — механик ставит сито по карте. */
function close(db: ContentDb, s: PlantState, inv: Investigation, cause: string, fate: 'reject' | 'release', by: string, notices: Notice[]) {
  const m = modelOf(db, inv);
  inv.status = 'closed';
  inv.conclusion = { cause, fate, by, t: s.t };
  s.deviations[inv.deviation].status = 'closed';
  // прибор проверили и наладили: его отметка о сбое закрыта вместе с расследованием
  const inst = s.tests[inv.test].inst;
  if (inst) delete s.instruments[inst].check;
  const lot = s.lots[inv.lot];
  // извещение одно — «расследование решено» с судьбой серии
  if (fate === 'release') {
    s.tests[inv.test].invalid = true;
    setLotStatus(s, lot, 'released');
    stockChanged(s);
  } else {
    setLotStatus(s, lot, 'rejected');
    defect(s, 'batches');
    // серия отклонена — с ней решены и другие её открытые отклонения (режим, МОК)
    for (const d of Object.values(s.deviations)) if (d.status === 'open' && (d.batch === inv.batch || d.lot === lot.id)) d.status = 'closed';
  }
  for (const u of unitsOfLot(s, lot.id)) settleLot(db, s, lot, u);
  if (isScreenCause(db, m, cause) && s.incident?.screen) {
    const mill = millOf(db, s, s.batches[inv.batch]);
    const e = mill ? s.equipment[mill] : undefined;
    const plan = planOf(db, s.plant);
    if (e) addTask(s, { kind: 'invFix', roles: ['role.mechanic'], from: { kind: 'point', x: plan.room[e.room].x, z: plan.room[e.room].z }, work: FIX_WORK, prio: INV_PRIO, inv: inv.id, part: e.id });
  }
  notices.push({ kind: 'concluded', id: inv.id, cause, fate });
}

/**
 * Команда «решение» (часть 4): причина — версия модели, судьба — отклонить или выпустить. Выпустить — только с причиной
 * «ошибка лаборатории» и повтором той же пробы в пределах: результат вне спецификации нельзя списать на лабораторию без
 * установленной лабораторной причины (`fda-oos`).
 */
export function concludeCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'conclude' }>, notices: Notice[]) {
  const inv = s.investigations[cmd.inv];
  if (!inv) return notices.push({ kind: 'refused', cmd: 'conclude', why: 'noInv', detail: cmd.inv });
  if (inv.status !== 'open') return notices.push({ kind: 'refused', cmd: 'conclude', why: 'closed', detail: cmd.inv });
  const m = modelOf(db, inv);
  if (!m.candidates.some(c => c.id === cmd.cause)) return notices.push({ kind: 'refused', cmd: 'conclude', why: 'noCause', detail: cmd.cause });
  if (cmd.fate === 'release' && !(isLab(m, cmd.cause) && labProven(db, inv))) return notices.push({ kind: 'refused', cmd: 'conclude', why: 'notProven', detail: cmd.inv });
  close(db, s, inv, cmd.cause, cmd.fate, cmd.by ?? 'player', notices);
}

// ---------------------------------------------------------------- коллега качества

/** Сколько часов стоит шаг: работа роли или испытание; не меньше четверти часа. */
function hoursOf(db: ContentDb, st: InvStep): number {
  const sec = st.test ? db.tests[st.test].prep + db.tests[st.test].run : (st.work ?? 0);
  return Math.max(MIN_HOURS, sec / 3600);
}

/**
 * Коллега качества — «разумный специалист», как «разумный врач» «Анамнеза»: пока игрок не держит пост качества, у
 * открытого расследования без идущего шага — сначала лаборатория (фаза I, `fda-oos`): записи и прибор, а если лучшая
 * версия — ошибка лаборатории, то и повтор той же пробы, по порядку модели; затем шаг с наибольшей пользой на час (не
 * меньше `minGain`), пока лучшая версия не наберёт `threshold`. Затем решение по лучшей версии: выпустить — только если
 * ошибка лаборатории доказана. Зовётся после каждого события.
 */
export function invStep(db: ContentDb, s: PlantState, notices: Notice[]): boolean {
  if (playerLeads(s)) return false;
  let acted = false;
  for (const inv of Object.values(s.investigations)) {
    if (inv.status !== 'open' || inv.runs.some(r => r.to === undefined)) continue;
    const m = modelOf(db, inv);
    const beliefs = posterior(m, inv.obs);
    const top = beliefs[0];
    const done = new Set(inv.runs.map(r => r.step));
    const observed = new Set(inv.obs.map(o => o.f));
    acted = true;
    // шаги лаборатории, которых ещё не было: записи и прибор — всегда, повтор — если лучшая — ошибка лаборатории
    const marks = (x: InvStep) => x.checks.some(c => 'mark' in (m.findings.find(f => f.id === c.f)?.read ?? {}));
    const lab = m.steps.find(x => !done.has(x.id) && (marks(x) || (!!x.retest && isLab(m, top.id))));
    if (lab) {
      startStep(db, s, inv, lab, 'head:quality');
      continue;
    }
    if (top.p * P_ONE < m.threshold) {
      let best: InvStep | undefined;
      let score = -1;
      for (const st of m.steps) {
        if (done.has(st.id)) continue;
        const g = expectedGain(m, st.id, beliefs, observed);
        if (g < m.minGain) continue;
        const x = quantize(g / hoursOf(db, st));
        if (x > score) {
          best = st;
          score = x;
        }
      }
      if (best) {
        startStep(db, s, inv, best, 'head:quality');
        continue;
      }
    }
    close(db, s, inv, top.id, isLab(m, top.id) && labProven(db, inv) ? 'release' : 'reject', 'head:quality', notices);
  }
  return acted;
}

/** Свойство модели: какой показатель ищет расследование (для разбора и вида). */
export const attrOf = (db: ContentDb, m: InvModel): Attr => db.tests[m.test].attr;

// ---------------------------------------------------------------- разбор

/** Шаг почти ничего не сдвинул бы: польза на его начало — меньше стольких бит (гипотеза спецификации). */
export const IDLE_GAIN = 0.05;

/** Улика в разборе: что шаг показал и что было на самом деле — след корня, фон или ничего (тогда «есть» — ошибка шага). */
export interface DebriefObs {
  f: string;
  step: string;
  shown: boolean;
  was: 'root' | 'leak' | 'none';
}

/** Шаг в разборе: польза на его начало, биты; почти ничего не сдвинул бы — `idle`. */
export interface DebriefStep {
  step: string;
  gain: number;
  idle: boolean;
}

/**
 * Разбор закрытого расследования (геймдизайн, §6.6, «Последствия»): что было на самом деле — корень, истинный показатель
 * партии и вклады причин в него; какие улики на что указывали; какой шаг был лишним; верны ли причина и судьба серии.
 * Судьба верна по правилам: годную партию с ошибкой лаборатории выпускают, только если у ошибки была лабораторная причина
 * (`provable`), иначе — отклоняют, как и негодную.
 */
export interface Debrief {
  root: string;
  cause: boolean;
  fate: boolean;
  /** партия на самом деле — в пределах спецификации */
  good: boolean;
  /** у ошибки лаборатории был след, который мог найти шаг: ошибка расчёта или сбой прибора */
  provable: boolean;
  /** показатель модели у партии: истинное и первый результат, единицы движка */
  truth: number;
  result: number;
  /** вклады причин каталога в показатель партии — сильнейший вниз первым */
  causes: { cause: Id; delta: number }[];
  obs: DebriefObs[];
  steps: DebriefStep[];
}

/** Разбор (архитектура, §9): истина выходит из потока расчёта один раз — после решения. Открыто — `undefined`. */
export function debrief(db: ContentDb, s: PlantState, id: string): Debrief | undefined {
  const inv = s.investigations[id];
  if (!inv?.conclusion) return undefined;
  const m = modelOf(db, inv);
  const attr = attrOf(db, m);
  const { root, fired, present = {} } = inv.truth;
  const first = s.tests[inv.test];
  const truth = s.lots[inv.lot].truth[attr] ?? 0;
  const good = within({ test: first.method, min: first.min, max: first.max }, truth);
  const lab = isLab(m, root);
  const provable = lab && m.findings.some(f => 'mark' in f.read && fired[f.id] === root);
  const by = new Map<Id, number>();
  for (const h of s.batches[inv.batch].causes) if (h.attr === attr) by.set(h.cause, (by.get(h.cause) ?? 0) + h.delta);
  const causes = [...by].map(([cause, delta]) => ({ cause, delta })).sort((a, b) => a.delta - b.delta || (a.cause < b.cause ? -1 : 1));
  const obs = inv.obs.map(o => {
    const f = m.findings.find(x => x.id === o.f)!;
    // откуда улика: брошенная — от того, что её бросило; следствие состояния — от корня, если корень её даёт
    const from = fired[f.id] ?? ((f.by[root] ?? 0) > 0 ? root : 'leak');
    const was: DebriefObs['was'] = !(present[f.id] ?? o.shown) ? 'none' : from === root ? 'root' : 'leak';
    return { f: o.f, step: o.step, shown: o.shown, was };
  });
  const steps = inv.runs.map(r => {
    const known = inv.obs.filter(o => o.t <= r.from);
    const gain = expectedGain(m, r.step, posterior(m, known), new Set(known.map(o => o.f)));
    return { step: r.step, gain, idle: gain < IDLE_GAIN };
  });
  const c = inv.conclusion;
  return { root, cause: c.cause === root, fate: c.fate === (provable ? 'release' : 'reject'), good, provable, truth, result: first.result ?? 0, causes, obs, steps };
}
