// Отклонения и CAPA (Б5е; docs/specs/2026-10-vertical-slice.md, «Б5е»; геймдизайн, §6.4; GMP ЕАЭС, ч. I, п. 1.4 (xiv);
// ICH Q10, п. 3.2.2): класс отклонения по определениям PI 040-1, перенесённым на отклонения (отраслевая практика);
// вероятная причина — причина базы, чей признак есть в записях завода; срок по классу — процедура завода; CAPA из каталога
// `content/capa/` с исполнителем — руководителем отдела действия; проверка эффективности через срок процедуры. Повтор —
// одно правило для класса, CAPA и показателя «повторяющиеся» (Б5ж): то же отклонение за 12 месяцев — та же подпись, а
// когда причина записана у обоих — та же причина. Истины здесь нет: причины серии (`b.causes`) правило не читает — только
// досье стадий, журнал оборудования и вывод расследования.
import type { CapaAction, ContentDb, Id } from '../content/types';
import { visitAt } from './assets';
import { batchNo } from './batchno';
import { decider } from './bosses';
import { DAY, momentOf } from './core/calendar';
import { before, causeClass, causeKey, dueOf, sameBefore, sameDev } from './devclass';
import { modeOf, propose, round } from './heads';
import { asWho, note, noteCmd } from './journal';
import { partType, planReplace } from './maint';
import { answerer, MEMO_AFTER } from './memos';
import { bookEval, howOf, pairKey } from './partners';
import { classOf, placesOf } from './places';
import { planOf } from './plant';
import { numOf, OFF, POL, policyOf, setPolicy } from './policies';
import { inForce } from './docs';
import { equipmentDocs, learnable, learnRec, rowsOf } from './quals';
import { nextId } from './stock';
import { retrain } from './train';
import type { Capa, Command, Decided, Deviation, Head, Notice, PlantState, PolicyValue, Refusal } from './types';

// ---------------------------------------------------------------- действие и его вещь

/** Стадия карты серии по id. */
const stageOf = (db: ContentDb, recipe: Id, id: string | undefined) => db.recipes[recipe].stages.find(st => st.id === id);

/** Вещь действия и его исполнитель. */
export interface Target {
  head: Head;
  part?: string;
  docs?: string[];
  people?: string[];
  asset?: string;
  pair?: string;
}

/** Подходит ли действие к отклонению: по роду записанной причины или по виду отклонения. */
export function fitsDev(db: ContentDb, a: CapaAction, d: Deviation): boolean {
  if (a.kinds?.includes(d.kind)) return true;
  return d.cause !== undefined && !!a.causes?.includes(causeClass(db, d.cause));
}

/** Узел причины «износ» у серии отклонения: из записей её стадий — тот, чей износ выше. */
function wornPart(db: ContentDb, s: PlantState, d: Deviation): string | undefined {
  const c = d.cause ? db.causes[d.cause] : undefined;
  const b = d.batch ? s.batches[d.batch] : undefined;
  if (!c || !b || !('wear' in c.driver)) return undefined;
  const type = c.driver.wear;
  let best: { k: string; w: number } | undefined;
  for (const rec of b.records) for (const [k, w] of Object.entries(rec.wear ?? {})) if (s.parts[k]?.type === type && (!best || w > best.w)) best = { k, w };
  return best?.k;
}

/** Порог замены на шаг ниже (Б5г): после отказа — верх пределов; у низа пределов ниже некуда — `undefined`. */
export function lowerOf(db: ContentDb, s: PlantState, part: string): { from: PolicyValue; to: number } | undefined {
  const p = db.policies[POL.replace];
  const from = policyOf(db, s, POL.replace, part);
  if (!p || from === undefined) return undefined;
  // порог признака процедуры: с этого износа завод связывает узел с отклонениями — заменять раньше, чем он туда дойдёт
  const sign = Math.floor((db.scenarios[s.scenario].deviations.wear - p.min!) / p.step!) * p.step! + p.min!;
  if (from === OFF || (typeof from === 'number' && from > sign)) return sign >= p.min! ? { from, to: sign } : undefined;
  if (typeof from !== 'number' || from - p.step! < p.min!) return undefined;
  return { from, to: from - p.step! };
}

/**
 * Чему и кого учить заново (Б5е): у отклонения стадии — процедуры её оборудования, у МОК — и методика испытания, тех,
 * кто работал на стадии по досье; у сверки — процедуры машин линии, тех, кто работал на задание; у результата вне
 * спецификации — по причине: режим или сито — процедуры оборудования стадии причины и её люди, иначе — методика
 * испытания, аналитик и тот, кто проверил. Учат тех, кто ещё на заводе. Руководитель — отдела тех, кого учат:
 * производство или ОКК.
 */
function docsOf(db: ContentDb, s: PlantState, d: Deviation): { docs: string[]; people: string[]; head: Head } | undefined {
  const b = d.batch ? s.batches[d.batch] : undefined;
  const here = (ids: readonly (string | undefined)[]) => [...new Set(ids.filter((x): x is string => !!x && !!s.people[x]))];
  const recOf = (stage: string | undefined) => (b && stage ? b.records.find(x => x.stage === stage) : undefined);
  const out = (docs: string[], people: string[], head: Head) => (docs.length && people.length ? { docs: [...docs].sort(), people, head } : undefined);
  if (d.kind === 'recon') {
    const line = b?.pack?.line ? planOf(db, s.plant).plant.lines.find(l => l.id === b.pack!.line) : undefined;
    return out(line ? equipmentDocs(db, [], line.machines.map(m => m.type)) : [], here(b?.pack?.people ?? []), 'mes');
  }
  if (d.kind === 'oos') {
    const c = d.cause ? db.causes[d.cause] : undefined;
    const dr = c?.driver;
    const st = b && dr && ('param' in dr || 'screen' in dr) ? db.recipes[b.recipe].stages.find(x => ('param' in dr ? x.params.some(p => p.id === dr.param) : x.screen !== undefined)) : undefined;
    if (st) {
      const got = out(equipmentDocs(db, st.equipment), here(recOf(st.id)?.people ?? []), 'mes');
      if (got) return got;
    }
    const inv = d.inv ? s.investigations[d.inv] : undefined;
    const q = s.tests[inv?.test ?? d.tests?.[0] ?? ''];
    return d.test ? out([db.tests[d.test].doc.code], here([q?.by, q?.checker]), 'qc') : undefined;
  }
  const st = b ? stageOf(db, b.recipe, d.stage) : undefined;
  if (!st) return undefined;
  const docs = equipmentDocs(db, st.equipment);
  if (d.kind === 'ipc' && d.test && !docs.includes(db.tests[d.test].doc.code)) docs.push(db.tests[d.test].doc.code);
  return out(docs, here(recOf(d.stage)?.people ?? []), 'mes');
}

/** Прибор, давший результат: у МОК — прибор вида испытания в помещении стадии; у ошибки лаборатории — прибор испытания. */
function meterOf(db: ContentDb, s: PlantState, d: Deviation): string | undefined {
  if (d.kind === 'ipc' && d.test && d.batch) {
    const rec = s.batches[d.batch].records.find(x => x.stage === d.stage);
    const inst = db.tests[d.test].inst;
    const meters = rec ? placesOf(planOf(db, s.plant).plant).ipcIn[rec.room] : undefined;
    return meters?.find(m => m.type === inst)?.id;
  }
  const inv = d.inv ? s.investigations[d.inv] : undefined;
  return inv ? s.tests[inv.test]?.inst : undefined;
}

/** Пара партии поставщика: у партии вне спецификации — её пара; у причины партии АФС — пара отвешенной партии АФС. */
function pairOf(db: ContentDb, s: PlantState, d: Deviation): string | undefined {
  const b = d.batch ? s.batches[d.batch] : undefined;
  const lotId = d.cause === 'lot' ? d.lot : b?.dispensed.find(k => db.materials[k.material]?.kind === 'api')?.lot;
  const lot = lotId ? s.lots[lotId] : undefined;
  if (!lot?.maker) return undefined;
  const key = pairKey(lot.supplier, lot.maker);
  return s.pairs[key] ? key : undefined;
}

/**
 * Вещь и исполнитель действия у отклонения (Б5е): заменить узел и заменять раньше — узел причины «износ» у главного
 * механика, «раньше» — если порог ещё есть куда опустить; обучить — документы и руководитель отдела тех, кого учат;
 * калибровка — прибор с калибровкой у главного механика; оценка пары — пара у начальника ООК. Нечем выполнить — нет.
 */
export function targetOf(db: ContentDb, s: PlantState, d: Deviation, a: CapaAction): Target | undefined {
  if (!fitsDev(db, a, d)) return undefined;
  switch (a.does) {
    case 'earlier':
    case 'replace': {
      const part = wornPart(db, s, d);
      if (!part || (a.does === 'earlier' && !lowerOf(db, s, part))) return undefined;
      return { head: a.head!, part };
    }
    case 'train': {
      const t = docsOf(db, s, d);
      return t ? { head: t.head, docs: t.docs, people: t.people } : undefined;
    }
    case 'calib': {
      const asset = meterOf(db, s, d);
      return asset && s.assets[asset] && classOf(db, s.assets[asset]).cal ? { head: a.head!, asset } : undefined;
    }
    case 'pair': {
      const pair = pairOf(db, s, d);
      return pair ? { head: a.head!, pair } : undefined;
    }
  }
}

/**
 * Цена действия из записей, которые оно трогает (Б5е): заменить узел — запчасть и время замены; заменять раньше — порог
 * был и станет, денег само действие не стоит; обучить — люди, часы изучения и проверки знаний по каждому документу;
 * калибровка — цена и часы работы подрядчика по классу прибора; оценка пары — аудит и рассмотрение отчёта или проверка
 * документов. Копейки и секунды.
 */
export interface CapaPrice {
  cost: number;
  work: number;
  /** обучить: сколько людей будут учить */
  learners?: number;
  from?: PolicyValue;
  to?: number;
}

export function priceOf(db: ContentDb, s: PlantState, a: CapaAction, t: Target): CapaPrice {
  const sc = db.scenarios[s.scenario];
  switch (a.does) {
    case 'replace': {
      const ty = partType(db, s.parts[t.part!]);
      return { cost: db.spares[ty.spare]?.price ?? 0, work: ty.replace };
    }
    case 'earlier': {
      const m = lowerOf(db, s, t.part!);
      return { cost: 0, work: 0, ...(m ? { from: m.from, to: m.to } : {}) };
    }
    case 'train': {
      const day = momentOf(s.start, s.t).day;
      const who = new Set<string>();
      let work = 0;
      for (const code of t.docs ?? []) {
        const d = learnable(db, code);
        if (!d) continue;
        const study = learnRec(db, d, inForce(db, d.kind, d.id, day)).study + sc.training.check;
        for (const id of t.people ?? []) {
          const p = s.people[id];
          if (!p || !rowsOf(db, p).includes(code)) continue;
          who.add(p.id);
          work += study;
        }
      }
      return { cost: 0, work, learners: who.size };
    }
    case 'calib': {
      const w = classOf(db, s.assets[t.asset!]).cal!;
      return { cost: w.price, work: w.work };
    }
    case 'pair': {
      const p = s.pairs[t.pair!];
      const audit = howOf(db, p.supplier, p.maker) === 'audit';
      return audit ? { cost: sc.partners.audit.price, work: sc.partners.audit.review } : { cost: 0, work: sc.partners.docs.review };
    }
  }
}

/** Действие каталога у отклонения для окна: вещь, исполнитель, цена; то же действие цепочки ещё не проверено — `open`. */
export interface CapaOption extends Target, CapaPrice {
  action: Id;
  open?: true;
}

/** Действия каталога, что подходят к отклонению и которыми есть что выполнить, — по порядку правила, потом по номеру. */
export function capaOptions(db: ContentDb, s: PlantState, d: Deviation): CapaOption[] {
  const out: CapaOption[] = [];
  const list = Object.values(db.capa).sort((x, y) => (x.rule ?? 99) - (y.rule ?? 99) || (x.id < y.id ? -1 : 1));
  for (const a of list) {
    const t = targetOf(db, s, d, a);
    if (!t) continue;
    out.push({ action: a.id, ...t, ...priceOf(db, s, a, t), ...(openIn(s, d, a.id) ? { open: true as const } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------- назначить

/** Вещь предложения начальника ООК: CAPA по отклонению; руководителя-исполнителя: выполнить CAPA. */
export const capaForKey = (dev: string) => `capaFor/${dev}`;
export const capaKey = (capa: string) => `capa/${capa}`;

/**
 * Цепочка CAPA отклонения (Б5е): CAPA, чьё исходное отклонение — то же по правилу повтора; по ней видно, что уже пробовали
 * и что ещё не проверено. Причина у отклонения установлена, а у исходного — нет или другая: CAPA не той цепочки —
 * действие по установленной причине не ждёт проверки CAPA, назначенной без неё.
 */
export function chainOf(s: PlantState, d: Deviation): Capa[] {
  const k = causeKey(d);
  return Object.values(s.capas).filter(c => {
    const src = s.deviations[c.dev];
    if (!src) return false;
    if (src === d) return true;
    return k ? causeKey(src) === k : sameDev(src, d);
  });
}

/** Открытая CAPA цепочки — ещё не проверенная; у игрока — того же действия. */
const openIn = (s: PlantState, d: Deviation, action?: Id) => chainOf(s, d).some(c => !c.check && (action === undefined || c.action === action));

/** Назначить: запись CAPA со сроком по классу отклонения; извещение исполнителю. */
function assign(db: ContentDb, s: PlantState, d: Deviation, a: CapaAction, t: Target, by: 'player' | 'qa', notices: Notice[]): Capa {
  const c: Capa = { id: nextId(s, 'G'), dev: d.id, action: a.id, ...(t.part ? { part: t.part } : {}), ...(t.docs ? { docs: t.docs } : {}), ...(t.people ? { people: t.people } : {}), ...(t.asset ? { asset: t.asset } : {}), ...(t.pair ? { pair: t.pair } : {}), head: t.head, t: s.t, by, due: s.t + db.scenarios[s.scenario].deviations.term[d.cls] * DAY };
  s.capas[c.id] = c;
  delete d.capaDue;
  notices.push({ kind: 'capa', id: c.id, dev: d.id, action: a.id, head: c.head });
  return c;
}

/**
 * Команда `capa` (Б5е, пост «Качество»): действие каталога по отклонению. Отказы: отклонения или действия нет; действие не
 * подходит или его нечем выполнить; то же действие цепочки ещё не проверено.
 */
export function capaCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'capa' }>, notices: Notice[]) {
  const refuse = (why: Refusal, detail?: string) => notices.push({ kind: 'refused', cmd: 'capa', why, ...(detail ? { detail } : {}) });
  const d = s.deviations[cmd.deviation];
  if (!d) return refuse('noDev', cmd.deviation);
  const a = db.capa[cmd.action];
  if (!a) return refuse('noAction', cmd.action);
  const t = targetOf(db, s, d, a);
  if (!t) return refuse('capaFit', cmd.action);
  if (openIn(s, d, a.id)) return refuse('capaOpen', cmd.action);
  const c = assign(db, s, d, a, t, cmd.by === undefined || cmd.by === 'player' ? 'player' : 'qa', notices);
  noteCmd(s, cmd, { kind: 'capa', capa: c.id, dev: d.id, action: a.id });
}

/**
 * Команда `classify` (Б5е, пост «Качество»): класс отклонения; заданный класс правило больше не пересматривает. Отказы:
 * отклонения нет; класса нет; тот же класс.
 */
export function classifyCommand(s: PlantState, cmd: Extract<Command, { kind: 'classify' }>, notices: Notice[]) {
  const d = s.deviations[cmd.deviation];
  if (!d) return notices.push({ kind: 'refused', cmd: 'classify', why: 'noDev', detail: cmd.deviation });
  if (cmd.cls !== 'critical' && cmd.cls !== 'major' && cmd.cls !== 'minor') return notices.push({ kind: 'refused', cmd: 'classify', why: 'noCls', detail: String(cmd.cls) });
  if (d.cls === cmd.cls && d.clsBy) return notices.push({ kind: 'refused', cmd: 'classify', why: 'same', detail: cmd.deviation });
  const from = d.cls;
  d.cls = cmd.cls;
  d.clsBy = true;
  // срок по новому классу: прошёл — извещение снова в свой час
  delete d.late;
  noteCmd(s, cmd, { kind: 'classify', dev: d.id, from, to: cmd.cls });
}

// ---------------------------------------------------------------- выполнить

/**
 * Команда `capaRun` (Б5е, пост отдела исполнителя): выполнить действие. Заменять раньше — порог политики узла на шаг
 * ниже, в историю политик — по этой CAPA; заменить — как «Заменить» у узла; обучить — задачи изучить документы заново;
 * калибровка — визит подрядчика на ближайший рабочий день; оценка пары — как по сроку. Отказы: CAPA нет или она
 * выполнена; действие сейчас нечем выполнить — причина движка, CAPA ждёт.
 */
export function capaRunCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'capaRun' }>, notices: Notice[]) {
  const refuse = (why: Refusal) => notices.push({ kind: 'refused', cmd: 'capaRun', why, detail: cmd.capa });
  const c = s.capas[cmd.capa];
  if (!c) return refuse('noCapa');
  if (c.done !== undefined) return refuse('capaDone');
  const a = db.capa[c.action];
  const today = momentOf(s.start, s.t).day;
  let moved: { from: PolicyValue; to: number } | undefined;
  switch (a.does) {
    case 'earlier': {
      moved = lowerOf(db, s, c.part!);
      if (!moved) return refuse('policyRange');
      setPolicy(s, db.policies[POL.replace], c.part, moved.from, moved.to, notices, { capa: c.id });
      break;
    }
    case 'replace': {
      const pt = s.parts[c.part!];
      const why = pt ? planReplace(db, s, pt, 'player') : 'noPart';
      if (why) return refuse(why);
      break;
    }
    case 'train':
      if (retrain(db, s, c.docs ?? [], c.people) === 0) return refuse('busy');
      break;
    case 'calib': {
      const x = s.assets[c.asset!];
      if (!x || x.visit) return refuse('busy');
      x.visit = { work: 'cal', at: visitAt(db, s, today), booked: s.t, v: 0 };
      break;
    }
    case 'pair': {
      const p = s.pairs[c.pair!];
      if (!p || p.eval) return refuse('busy');
      bookEval(db, s, p, today);
      break;
    }
  }
  c.done = s.t;
  c.doneBy = cmd.by === undefined || cmd.by === 'player' ? 'player' : c.head;
  delete c.why;
  noteCmd(s, cmd, { kind: 'capaRun', capa: c.id, action: c.action, head: c.head, ...(moved ? { from: moved.from, to: moved.to } : {}) });
  notices.push({ kind: 'capaDone', id: c.id, dev: c.dev, action: c.action, head: c.head });
}

// ---------------------------------------------------------------- час

/**
 * Правило начальника ООК (Б5е): после вывода расследования — CAPA по его причине; после оценки — когда таких отклонений за
 * 12 месяцев не меньше порога политики; после неэффективной CAPA — следующее действие цепочки. Действие — первое по
 * порядку правила из подходящих, кроме тех, что цепочка уже пробовала без успеха; у цепочки CAPA ещё не проверена — ждать
 * её проверки. Нечего назначить — ничего.
 */
type CapaWhy = NonNullable<Extract<Decided, { kind: 'capa' }>['why']>;

function rulePick(db: ContentDb, s: PlantState, d: Deviation): { a: CapaAction; t: Target; why: CapaWhy } | undefined {
  const chain = chainOf(s, d);
  if (chain.some(c => !c.check)) return undefined;
  let why: CapaWhy;
  if (d.capaDue === 'next') {
    const prev = chain.filter(c => c.check && !c.check.ok).pop();
    why = { rule: 'next', ...(prev ? { prev: prev.id } : {}) };
  } else if (d.inv) why = { rule: 'inv' };
  else {
    const n = sameBefore(s, d).length;
    const of = numOf(db, s, POL.capa)!;
    if (n < of) return undefined;
    why = { rule: 'repeat', n, of };
  }
  const failed = new Set(chain.filter(c => c.check && !c.check.ok).map(c => c.action));
  const list = Object.values(db.capa)
    .filter(a => a.rule !== undefined && !failed.has(a.id))
    .sort((x, y) => x.rule! - y.rule! || (x.id < y.id ? -1 : 1));
  for (const a of list) {
    const t = targetOf(db, s, d, a);
    if (t) return { a, t, why };
  }
  return undefined;
}

/** Начальник ООК в свой час: отклонения, у которых пора посмотреть CAPA. Режим ООК (Б5б): «советует» — предложение. */
function qaRule(db: ContentDb, s: PlantState, notices: Notice[]) {
  const due = Object.values(s.deviations).filter(d => d.capaDue);
  const mode = modeOf(s, 'qa');
  if (due.length === 0) return;
  if (mode === 'manual') {
    for (const d of due) delete d.capaDue;
    return;
  }
  const who = decider(db, s, 'qa', notices);
  if (!who) return;
  const r = mode === 'advise' ? round(s, ['capaFor/']) : undefined;
  for (const d of due) {
    // повтор ещё не оценён — следующее действие подождёт его причины
    if (d.cause === undefined && d.status === 'open') {
      r?.keep(capaForKey(d.id));
      continue;
    }
    const pick = rulePick(db, s, d);
    if (!pick) {
      delete d.capaDue;
      continue;
    }
    const dec = { kind: 'capa' as const, dev: d.id, action: pick.a.id, why: pick.why };
    if (r) {
      const key = capaForKey(d.id);
      // отклонили сегодня — CAPA по нему не будет
      if (s.heads.no[key] !== undefined) {
        delete d.capaDue;
        continue;
      }
      r.propose('qa', key, { kind: 'capa', deviation: d.id, action: pick.a.id }, dec, notices, who);
      continue;
    }
    const c = assign(db, s, d, pick.a, pick.t, 'qa', notices);
    note(s, 'qa', { ...dec, capa: c.id }, undefined, undefined, who);
  }
  r?.done();
}

/**
 * Исполнитель CAPA в свой час (Б5е): режим его отдела (Б5б) — «советует» — предложение «Выполнить», «вручную» — молчит,
 * «сам» — выполняет в свой час, как служебную записку (Б5д): не раньше часа после назначения, тем же движком; отказ —
 * причина в CAPA, она ждёт следующего часа.
 */
function runHour(db: ContentDb, s: PlantState, c: Capa, notices: Notice[], run: (cmd: Command) => Notice[]) {
  const mode = modeOf(s, c.head);
  if (mode === 'manual') return;
  if (mode === 'advise') {
    const who = decider(db, s, c.head, notices);
    if (who) propose(s, c.head, capaKey(c.id), { kind: 'capaRun', capa: c.id }, { kind: 'capaRun', capa: c.id, action: c.action, head: c.head }, notices, undefined, who);
    return;
  }
  if (s.t < c.t + MEMO_AFTER) return;
  const who = answerer(db, s, c.head, notices);
  if (!who) return;
  const out = asWho(c.head, who, () => run({ kind: 'capaRun', capa: c.id, by: `head:${c.head}` }));
  const no = out.find((x): x is Extract<Notice, { kind: 'refused' }> => x.kind === 'refused' && x.cmd === 'capaRun');
  if (no) c.why = no.why;
  for (const x of out) if (x !== no) notices.push(x);
}

/**
 * Проверка эффективности (Б5е): через срок процедуры после выполнения начальник ООК смотрит, было ли такое же отклонение
 * после; запись журнала — «эффективна» или «не эффективна: повтор», и тогда — следующее действие цепочки. Решение по
 * сроку — в любом режиме (Б5б), когда есть кому решить (Б5в).
 */
function checkHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  const span = db.scenarios[s.scenario].deviations.check * DAY;
  const due = Object.values(s.capas).filter(c => c.done !== undefined && !c.check && s.t >= c.done + span);
  if (due.length === 0) return;
  const who = decider(db, s, 'qa', notices);
  if (!who) return;
  for (const c of due) {
    const src = s.deviations[c.dev];
    const rep = Object.values(s.deviations)
      .filter(x => x !== src && x.opened > c.done! && sameDev(src, x))
      .sort((a, b) => (before(a, b) ? -1 : 1))[0];
    c.check = { t: s.t, ok: !rep, ...(rep ? { dev: rep.id } : {}) };
    note(s, 'qa', { kind: 'capaCheck', capa: c.id, ok: !rep, days: span / DAY, ...(rep ? { dev: rep.id } : {}) }, undefined, undefined, who);
    notices.push({ kind: 'capaCheck', id: c.id, dev: c.dev, ok: !rep, ...(rep ? { rep: rep.id } : {}) });
    // следующее действие — по повтору: его причина могла установиться, когда у исходного её не было
    if (rep && !rep.capaDue) rep.capaDue = 'next';
  }
}

/**
 * Каждый час (Б5е): у открытого отклонения прошёл срок — извещение; начальник ООК назначает CAPA по правилу; исполнители
 * выполняют CAPA; проверки эффективности по сроку. `run` — команда движка, как у служебной записки.
 */
export function capaHour(db: ContentDb, s: PlantState, notices: Notice[], run: (cmd: Command) => Notice[]) {
  for (const d of Object.values(s.deviations)) {
    if (d.status !== 'open' || d.late || s.t < dueOf(db, s, d)) continue;
    d.late = true;
    notices.push({ kind: 'devLate', id: d.id, cls: d.cls, code: d.batch ? batchNo(s.batches[d.batch].code) : '' });
  }
  qaRule(db, s, notices);
  for (const c of Object.values(s.capas)) if (c.done === undefined) runHour(db, s, c, notices, run);
  checkHour(db, s, notices);
}
