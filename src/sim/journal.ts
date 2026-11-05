// Журнал решений для окна (Б5а; docs/specs/2026-10-vertical-slice.md, «Б5а»): строки журнала — от новых к старым, с
// отбором по посту и автору, страницами; «Кто решил» у вещей завода — серии, партии, отклонения, актива, машины,
// человека; решения за сутки на планёрке — строка на руководителя. С Б5б — предложения руководителей: открытые сверху,
// «Ждут вашего решения», с ответом и тем, может ли игрок ответить; режимы отделов взятых постов. Данные — без слов:
// номера, виды, числа, мгновения; слова — в окне (src/i18n/). Истины здесь нет (docs/02-architecture.md, §9): причины в
// журнале — числа, которые завод знает, а ссылки на вещи — их номера и коды, как в карточках.
import type { ContentDb, Dept, Id, SeatId } from '../content/types';
import { batchNo } from '../engine/batchno';
import { FORK_HEAD } from '../engine/forks';
import { MODED, modeOf as deptMode } from '../engine/heads';
import { DEPT_HEAD, HEAD_SEAT, recordOf, waits } from '../engine/journal';
import { planOf } from '../engine/plant';
import { policyHead } from '../engine/policies';
import { foreign, held } from '../engine/seats';
import { unitsOfLot } from '../engine/stock';
import { quotePo } from '../engine/supply';
import { memoAt } from '../engine/memos';
import type { Ask, AssetFamily, Batch, BatchFor, Command, Decided, Decision, DeptMode, EditPrice, ForkAsk, Head, Lot, MemoRes, Person, PlantState } from '../engine/types';
import { movable, thingOf } from './places';
import type { Thing } from './views';

type Code = [number, number, number];
const num = (id: string) => Number(id.slice(1));
const code = (c: { y: number; m: number; n: number }): Code => [c.y, c.m, c.n];

/**
 * Журнал на странице `page`: отбор по посту и автору, с Б5д — и «Записки»; `focus` — открыть на этой записи (её
 * страница).
 */
export interface JournalQuery {
  view: 'journal';
  seat?: SeatId;
  who?: 'heads' | 'player' | 'memos';
  page: number;
  focus?: number;
}

/**
 * Что окну нужно для слов и переходов: серия — номер задания `B<n>` (к досье) и номер серии, когда выдан; партия —
 * внутренний номер, материал и первая паллета; заказ поставщику — строки и срок; отклонение и расследование — номера и
 * модель; актив — семья, вид, инвентарный номер; узел — вид машины и узла; человек — роль и табельный номер; уставка —
 * карта, стадия и режим или позиция; карточка вещи на полу.
 */
export interface JournalRef {
  bn?: number;
  code?: string;
  sku?: Id;
  lot?: Code;
  material?: Id;
  unit?: number;
  po?: { lines: { material: Id; qty: number }[]; eta?: number };
  dev?: number;
  inv?: string;
  model?: Id;
  asset?: { family: AssetFamily; type: Id; inv: number };
  machine?: Id;
  part?: Id;
  person?: { role: Id; tab: number; n?: number };
  mode?: { recipe?: Id; stage?: string; param?: string; sku?: Id };
  thing?: Thing;
  /** записка (Б5д): ссылки каждой её команды — по порядку команд */
  cmds?: JournalRef[];
  /** развилка визита (Б5д): номера серий, которые ждут актив */
  batches?: string[];
  /** вакансия и кандидат команд найма (Б5д): роль */
  role?: Id;
  /** CAPA (Б5е): номер */
  capa?: number;
  /** задание под заказ покупателя (Б6а): покупатель */
  customer?: Id;
  /** правка в замороженном горизонте (Б6е): номера серий заданий, которые кончат позже, — у тех, кому номер выдан */
  codes?: Record<string, string>;
}

/**
 * Предложение руководителя в строке (Б5б): ответ — нет, ждёт; может ли игрок ответить — предложение открыто, а пост отдела
 * у игрока или игрок — директор.
 */
export interface AskInfo {
  end?: Ask['end'];
  can?: true;
}

/** Строка журнала: запись движка, пост решения, что окну нужно для слов и переходов; у предложения — его ответ. */
export interface JournalRow {
  n: number;
  t: number;
  by: Head | 'player';
  seat?: SeatId;
  post: SeatId;
  d: Decided;
  ref: JournalRef;
  ask?: AskInfo;
  /** кто решил за руководителя (Б5в): человек штата — роль и табельный номер; «и. о.» — заместитель; на заводе — `n` */
  as?: JournalAs;
  /** служебная записка игрока (Б5д): когда ответят и ответ */
  memo?: MemoInfo;
  /** решение руководителя по записке (Б5д): её номер и пост, с которого она */
  via?: { n: number; seat?: SeatId };
  /** вопрос «Просят решить» (Б5д): кого спросили, срок, ответ и может ли игрок ответить */
  q?: QInfo;
}

/**
 * Служебная записка в строке (Б5д): без ответа — когда руководитель ответит (назначено или по его рабочему времени),
 * может ли игрок её отозвать; с ответом — когда, кто ответил за руководителя и по каждой команде — номер записи
 * руководителя или отказ движка; отозвана — `off`.
 */
export interface MemoInfo {
  at?: number;
  can?: true;
  end?: { t: number; off?: true; res?: MemoRes[]; as?: JournalAs };
}

/**
 * Вопрос в строке (Б5д): кого спросили, до какого мгновения ждёт ответа, ответ; открыт и пост у игрока — `can`; у
 * открытого вопроса о визите — рабочие дни, на которые его можно перенести.
 */
export interface QInfo {
  to?: SeatId;
  due?: number;
  end?: ForkAsk['end'];
  can?: true;
  move?: number[];
}

/** Человек, решивший за руководителя (Б5в): записи завода, без истины. */
export interface JournalAs {
  role: Id;
  tab: number;
  io?: true;
  n?: number;
}

/** Кто решил за руководителя в записи — человек на заводе или ушедший; нет — должность. */
export function asOf(s: PlantState, r: Decision): JournalAs | undefined {
  const p = r.p ? (s.people[r.p] ?? s.former[r.p]) : undefined;
  return p ? { role: p.role, tab: p.tab, ...(r.io ? { io: true as const } : {}), ...(s.people[p.id] ? { n: num(p.id) } : {}) } : undefined;
}

/** Режим отдела взятого поста (Б5б): руководитель, его пост и режим сейчас. */
export interface ModeInfo {
  head: Head;
  seat: SeatId;
  mode: DeptMode;
}

export interface JournalView {
  view: 'journal';
  rows: JournalRow[];
  total: number;
  page: number;
  pages: number;
  focus?: number;
  /** с какого мгновения журнал помнит решения — срок геймдизайна (§8.5) */
  since?: number;
  /** ждут вашего решения (Б5б): открытые предложения и, с Б5д, вопросы, новые сверху — на любой странице и при любом отборе */
  asks: JournalRow[];
  /** записки без ответа (Б5д), новые сверху */
  memos: JournalRow[];
  /** режимы отделов взятых постов (Б5б); у директора — всех отделов с выбором; мест не выбрано — нет */
  modes: ModeInfo[];
}

/** Строк на странице журнала. */
export const JOURNAL_PAGE = 50;

/** Пост решения игрока — пост руководителя, чья это работа (найм — отдела роли). */
function headOf(db: ContentDb, d: Decided): Head {
  switch (d.kind) {
    case 'order':
    case 'cancel':
    // правка в замороженном горизонте (Б6е)
    case 'shift':
      return 'plan';
    // события коммерции (Б6е)
    case 'bigOrder':
    case 'demandCut':
      return 'sales';
    case 'po':
    // ускорить и отменить заказ поставщику (Б6д)
    case 'expedite':
    case 'cancelPo':
    case 'contract':
      return 'supply';
    case 'step':
    case 'conclude':
    case 'assess':
    case 'pairEval':
    // одобрение пары-кандидата (Б6ж)
    case 'pairApprove':
    case 'pairStep':
    case 'classify':
    case 'capa':
    case 'capaCheck':
      return 'qa';
    case 'capaRun':
      return d.head;
    case 'lot':
      return 'qc';
    case 'batch':
      return 'qp';
    case 'setpoint':
    case 'targets':
      return 'tech';
    case 'repair':
    case 'replace':
    case 'spare':
    case 'visit':
      return 'maint';
    case 'vacancy':
    case 'hire':
      return DEPT_HEAD[(db.roles[d.role]?.dept ?? 'mes') as Dept];
    case 'leaveDraft':
      return 'hr';
    case 'extend':
    case 'forecast':
      return 'sales';
    case 'fcEdit':
    case 'sop':
      return 'plan';
    case 'waste':
      return 'wms';
    case 'mode':
      return d.head;
    case 'policy':
      return policyHead(d.policy) ?? 'plan';
    case 'deputy':
      return d.head;
    case 'memo':
      return d.to;
    case 'fork':
      return FORK_HEAD[d.fork];
  }
}

/** Пост записи: у руководителя — его пост, у игрока — пост руководителя этой работы. */
export const postOf = (db: ContentDb, r: Decision): SeatId => HEAD_SEAT[r.by === 'player' ? headOf(db, r.d) : r.by];

const unitOf = (s: PlantState, lot: string): number | undefined => {
  const u = unitsOfLot(s, lot).sort((a, b) => num(a.id) - num(b.id))[0];
  return u ? num(u.id) : undefined;
};

function batchRef(s: PlantState, id: string): JournalRef {
  const b: Batch | undefined = s.batches[id];
  const c = b ? batchNo(b.code) : '';
  return { bn: num(id), ...(c ? { code: c } : {}), ...(b?.sku ? { sku: b.sku } : {}) };
}

/** Правка в горизонте (Б6е): номера серий заданий, которые кончат позже, — у тех, кому номер выдан. */
export function laterCodes(s: PlantState, p: EditPrice | undefined): Record<string, string> | undefined {
  const codes: Record<string, string> = {};
  for (const x of p?.later ?? []) {
    const b = s.batches[x.batch];
    if (b && b.code.n > 0) codes[x.batch] = batchNo(b.code);
  }
  return Object.keys(codes).length > 0 ? codes : undefined;
}

/** Покупатель заказа, под который задание (Б6а). */
function customerOf(s: PlantState, f: BatchFor | undefined): JournalRef {
  const o = f?.kind === 'order' ? s.orders[f.order] : undefined;
  return o ? { customer: o.customer } : {};
}

function lotRef(s: PlantState, id: string): JournalRef {
  const l: Lot | undefined = s.lots[id];
  if (!l) return {};
  const u = unitOf(s, id);
  return { lot: code(l.code), material: l.material, ...(u !== undefined ? { unit: u } : {}), ...(l.batch ? batchRef(s, l.batch) : {}) };
}

function personRef(s: PlantState, p: Person | undefined): JournalRef {
  if (!p) return {};
  const here = !!s.people[p.id];
  return { person: { role: p.role, tab: p.tab, ...(here ? { n: num(p.id) } : {}) }, ...(here ? { thing: { kind: 'person' as const, n: num(p.id) } } : {}) };
}

/** Кого приняли кандидатом `cand`: человек на заводе или ушедший. */
const hiredAs = (s: PlantState, cand: string): Person | undefined => Object.values(s.people).find(p => p.cand === cand) ?? Object.values(s.former).find(p => p.cand === cand);

/** Уставка по ключу: `<код карты>/<стадия>/<режим>` или `<код инструкции по упаковке>/speed` — в редакциях базы. */
function modeOf(db: ContentDb, key: string): JournalRef['mode'] {
  const parts = key.split('/');
  if (parts.length === 2) {
    const sku = Object.values(db.skus).find(k => k.doc.code === parts[0]);
    return sku ? { sku: sku.id } : {};
  }
  const r = Object.values(db.recipes).find(x => x.doc.code === parts[0]);
  return { ...(r ? { recipe: r.id } : {}), stage: parts[1], param: parts[2] };
}

/**
 * Ссылки записи — по нынешнему состоянию завода: номер серии появляется, когда его выдали; паллета — пока она на заводе.
 * У предложения заказа поставщику (Б5б) строк заказа ещё нет — строки команды до целой тары, срока нет.
 */
export function refOf(db: ContentDb, s: PlantState, d: Decided, ask?: Ask): JournalRef {
  const plan = planOf(db, s.plan);
  if (d.kind === 'po' && !d.po && ask?.cmd.kind === 'po') {
    const q = quotePo(db, s, ask.cmd.supplier, ask.cmd.lines);
    return { po: { lines: ('why' in q ? ask.cmd.lines : q.lines).map(l => ({ material: l.material, qty: l.qty })) } };
  }
  switch (d.kind) {
    case 'order':
    case 'cancel':
    case 'shift': {
      // правка в замороженном горизонте (Б6е): номера серий заданий, которые кончат позже
      const codes = laterCodes(s, d.frozen);
      const base = d.kind === 'shift' ? batchRef(s, d.batch) : { ...(d.batch ? batchRef(s, d.batch) : {}), ...customerOf(s, d.for) };
      return { ...base, ...(codes ? { codes } : {}) };
    }
    // события коммерции (Б6е)
    case 'bigOrder':
    case 'demandCut':
      return { customer: d.customer };
    case 'batch':
      return batchRef(s, d.batch);
    case 'po':
    case 'expedite':
    case 'cancelPo':
    // шаг одобрения пары (Б6ж): пробная партия — её заказ
    case 'pairStep': {
      const po = d.po ? s.pos[d.po] : undefined;
      return po ? { po: { lines: po.lines.map(l => ({ material: l.material, qty: l.qty })), eta: po.eta } } : {};
    }
    case 'step':
    case 'conclude': {
      const inv = s.investigations[d.inv];
      return inv ? { inv: inv.id, model: inv.model, dev: num(inv.deviation), ...batchRef(s, inv.batch) } : { inv: d.inv };
    }
    case 'assess':
    case 'classify':
    case 'capa': {
      const dev = s.deviations[d.dev];
      return { dev: num(d.dev), ...(dev?.batch ? batchRef(s, dev.batch) : {}), thing: { kind: 'dev', n: num(d.dev) }, ...(d.kind === 'capa' && d.capa ? { capa: num(d.capa) } : {}) };
    }
    case 'capaRun':
    case 'capaCheck': {
      // CAPA (Б5е): её отклонение; у «заменять раньше» — узел политики
      const c = s.capas[d.capa];
      const dev = c ? s.deviations[c.dev] : undefined;
      const pt = c?.part ? s.parts[c.part] : undefined;
      const thing = pt ? thingOf(db, s, pt.machine, plan) : undefined;
      return {
        capa: num(d.capa),
        ...(dev ? { dev: num(dev.id), ...(dev.batch ? batchRef(s, dev.batch) : {}) } : {}),
        ...(pt ? { machine: pt.of, part: pt.type } : {}),
        ...(thing ? { thing } : dev ? { thing: { kind: 'dev' as const, n: num(dev.id) } } : {}),
      };
    }
    case 'lot':
      return { ...lotRef(s, d.lot), ...(d.dev ? { dev: num(d.dev) } : {}), ...(d.inv ? { inv: d.inv } : {}) };
    case 'visit': {
      const a = s.assets[d.asset];
      const thing = thingOf(db, s, d.asset, plan);
      return { ...(a ? { asset: { family: a.family, type: a.type, inv: a.inv } } : {}), ...(thing ? { thing } : {}) };
    }
    case 'repair':
    case 'replace': {
      const pt = s.parts[d.part];
      const thing = pt ? thingOf(db, s, pt.machine, plan) : undefined;
      return pt ? { machine: pt.of, part: pt.type, ...(thing ? { thing } : {}) } : {};
    }
    case 'vacancy':
      return d.why ? personRef(s, s.people[d.why.instead] ?? s.former[d.why.instead]) : {};
    case 'hire':
      return personRef(s, hiredAs(s, d.cand));
    case 'setpoint':
      return { mode: modeOf(db, d.key) };
    case 'deputy':
      // заместитель руководителя (Б5в): кого назначили — к его карточке
      return d.person ? personRef(s, s.people[d.person] ?? s.former[d.person]) : {};
    case 'policy': {
      // политика узла (Б5г): вид машины и узла, к машине на полу
      const pt = d.of ? s.parts[d.of] : undefined;
      const thing = pt ? thingOf(db, s, pt.machine, plan) : undefined;
      return pt ? { machine: pt.of, part: pt.type, ...(thing ? { thing } : {}) } : {};
    }
    case 'memo':
      // записка (Б5д): ссылки её команд — по порядку
      return { cmds: d.cmds.map(c => cmdRef(db, s, c)) };
    case 'fork':
      // развилка (Б5д): визит — актив и серии, которые его ждут; замена — узел и серия; OOS — расследование
      if (d.fork === 'visit') return { ...refOf(db, s, { kind: 'visit', asset: d.asset, work: d.work, at: d.start }), batches: d.batches.flatMap(id => (s.batches[id] ? [batchNo(s.batches[id].code) || id] : [])) };
      if (d.fork === 'replace') return { ...refOf(db, s, { kind: 'replace', part: d.part }), ...batchRef(s, d.batch) };
      return refOf(db, s, { kind: 'step', inv: d.inv, step: '' });
    default:
      return {};
  }
}

/**
 * Ссылки команды записки (Б5д): серия, партия, актив, узел, человек, вакансия или кандидат — по их номерам, как у записей
 * журнала; у остального — нет.
 */
export function cmdRef(db: ContentDb, s: PlantState, c: Command): JournalRef {
  switch (c.kind) {
    case 'shift':
    case 'pack':
    case 'cancel':
      return batchRef(s, c.batch);
    case 'rush':
      return lotRef(s, c.lot);
    case 'visit':
      return refOf(db, s, { kind: 'visit', asset: c.asset, work: 'qual', at: 0 });
    case 'maintain':
      return refOf(db, s, { kind: 'replace', part: `${c.machine}/${c.part}` });
    case 'setpoint':
      return 'sku' in c ? { mode: { sku: c.sku } } : { mode: { recipe: c.recipe, stage: c.stage, param: c.param } };
    case 'roster':
    case 'dismiss':
    case 'leave':
    case 'also':
      return personRef(s, s.people[c.person] ?? s.former[c.person]);
    case 'agency':
    case 'close': {
      const v = s.vacancies[c.vacancy];
      return v ? { role: v.role } : {};
    }
    case 'hire': {
      const k = s.candidates[c.candidate];
      return k ? { role: k.role } : {};
    }
    default:
      return {};
  }
}

/** Ответ на предложение в строке (Б5б): открыто и игрок может ответить — `can`. */
export function askInfo(s: PlantState, r: Decision): AskInfo | undefined {
  if (!r.ask) return undefined;
  if (r.ask.end) return { end: r.ask.end };
  return foreign(s, { kind: 'accept', n: r.n }) ? {} : { can: true };
}

/**
 * Записка в строке (Б5д): без ответа — когда ответят — назначенное мгновение или по рабочему времени руководителя, —
 * и отозвать её может игрок; с ответом — кто ответил за руководителя.
 */
export function memoInfo(db: ContentDb | undefined, s: PlantState, r: Decision): MemoInfo | undefined {
  const m = r.memo;
  if (!m || r.d.kind !== 'memo') return undefined;
  if (!m.end) {
    const at = m.due ?? (db ? memoAt(db, s, r.d.to) : undefined);
    return { ...(at !== undefined ? { at } : {}), can: true };
  }
  const as = m.end.p ? asOf(s, { ...r, p: m.end.p, ...(m.end.io ? { io: true as const } : {}) }) : undefined;
  return { end: { t: m.end.t, ...(m.end.off ? { off: true as const } : {}), ...(m.end.res ? { res: m.end.res } : {}), ...(as ? { as } : {}) } };
}

/**
 * Вопрос в строке (Б5д): открыт и игрок держит пост, которого спросили, или он директор — может ответить; у вопроса о
 * визите — дни переноса (нужна база; «Кто решил» карточки обходится без них).
 */
export function qInfo(db: ContentDb | undefined, s: PlantState, r: Decision): QInfo | undefined {
  const q = r.q;
  if (!q) return undefined;
  const can = !q.end && !foreign(s, { kind: 'answer', n: r.n, opt: 'wait' });
  const a = !q.end && r.d.kind === 'fork' && r.d.fork === 'visit' ? s.assets[r.d.asset] : undefined;
  const move = a && db ? movable(db, s, a) : {};
  return { ...(q.to ? { to: q.to } : {}), ...(q.due !== undefined ? { due: q.due } : {}), ...(q.end ? { end: q.end } : {}), ...(can ? { can: true as const } : {}), ...move };
}

/** Строка журнала для окна. */
export function rowOf(db: ContentDb, s: PlantState, r: Decision): JournalRow {
  const ask = askInfo(s, r);
  const as = asOf(s, r);
  const memo = memoInfo(db, s, r);
  const q = qInfo(db, s, r);
  const via = r.via !== undefined ? { n: r.via, ...(recordOf(s, r.via)?.seat ? { seat: recordOf(s, r.via)!.seat } : {}) } : undefined;
  return {
    n: r.n,
    t: r.t,
    by: r.by,
    ...(r.seat ? { seat: r.seat } : {}),
    post: postOf(db, r),
    d: r.d,
    ref: refOf(db, s, r.d, r.ask),
    ...(ask ? { ask } : {}),
    ...(as ? { as } : {}),
    ...(memo ? { memo } : {}),
    ...(via ? { via } : {}),
    ...(q ? { q } : {}),
  };
}

/** Открытые предложения (Б5б) и вопросы «Просят решить» (Б5д), новые сверху. */
export const openAsks = (db: ContentDb, s: PlantState): JournalRow[] =>
  [...Object.values(s.heads.open), ...Object.values(s.heads.qs ?? {})]
    .sort((a, b) => b - a)
    .flatMap(n => {
      const r = recordOf(s, n);
      return r ? [rowOf(db, s, r)] : [];
    });

/** Записки без ответа (Б5д), новые сверху. */
export const openMemos = (db: ContentDb, s: PlantState): JournalRow[] =>
  [...(s.heads.memos ?? [])]
    .sort((a, b) => b - a)
    .flatMap(n => {
      const r = recordOf(s, n);
      return r ? [rowOf(db, s, r)] : [];
    });

/** Режимы отделов взятых постов (Б5б): по порядку руководителей; у директора — все отделы с выбором. */
export function modesOf(s: PlantState): ModeInfo[] {
  const h = held(s);
  if (!h) return [];
  return MODED.filter(x => h.includes('director') || h.includes(HEAD_SEAT[x])).map(x => ({ head: x, seat: HEAD_SEAT[x], mode: deptMode(s, x) }));
}

/** Журнал: новые сверху; отбор по посту и автору; страница — по `focus`, если запись есть. */
export function journalView(db: ContentDb, s: PlantState, q: JournalQuery): JournalView {
  const who = (r: Decision) => !q.who || (q.who === 'memos' ? r.d.kind === 'memo' : (q.who === 'player') === (r.by === 'player'));
  const all = s.journal.filter(r => who(r) && (!q.seat || postOf(db, r) === q.seat)).reverse();
  const pages = Math.max(1, Math.ceil(all.length / JOURNAL_PAGE));
  const at = q.focus !== undefined ? all.findIndex(r => r.n === q.focus) : -1;
  const page = at >= 0 ? Math.floor(at / JOURNAL_PAGE) : Math.min(Math.max(0, q.page), pages - 1);
  const rows = all.slice(page * JOURNAL_PAGE, (page + 1) * JOURNAL_PAGE).map(r => rowOf(db, s, r));
  // с какого мгновения журнал помнит решения: открытое предложение, записка без ответа и открытый вопрос старше срока
  // остаются — их не считают
  const kept = s.journal.find(r => !waits(r));
  return { view: 'journal', rows, total: all.length, page, pages, ...(at >= 0 ? { focus: q.focus } : {}), ...(kept ? { since: kept.t } : {}), asks: openAsks(db, s), memos: openMemos(db, s), modes: modesOf(s) };
}

// ---------------------------------------------------------------- «Кто решил» в карточках

/**
 * Решение о вещи в карточке: номер записи (к журналу), когда, кто — руководитель или игрок с местом — и что решено:
 * вид записи и, где есть, вердикт.
 */
export interface WhoRow {
  n: number;
  t: number;
  by: Head | 'player';
  seat?: SeatId;
  kind: Decided['kind'];
  v?: string;
  /** предложение руководителя (Б5б): ответ, может ли игрок ответить */
  ask?: AskInfo;
  /** кто решил за руководителя (Б5в) */
  as?: JournalAs;
  /** по записке (Б5д): номер записки и пост, с которого она */
  via?: { n: number; seat?: SeatId };
  /** развилка «Просят решить» (Б5д): ответ — игрок, сам или «не нужно» */
  q?: QInfo;
  /** служебная записка игрока об этой вещи (Б5д): кому, когда ответят и ответ */
  memo?: MemoInfo & { to: Head };
}

const verdictOf = (d: Decided): string | undefined => {
  switch (d.kind) {
    case 'lot':
    case 'assess':
      return d.verdict;
    case 'batch':
      return d.decision;
    case 'conclude':
      return d.fate;
    case 'visit':
      return d.work;
    case 'vacancy':
      return d.via;
    // Б5е: класс, действие каталога, итог проверки
    case 'classify':
      return d.to;
    case 'capa':
    case 'capaRun':
      return d.action;
    case 'capaCheck':
      return d.ok ? 'ok' : 'no';
    default:
      return undefined;
  }
};

/**
 * Строки «Кто решил» вещи: решения и предложения руководителей (Б5б) — устаревшие и ненужные предложения не решали
 * ничего, их здесь нет.
 */
const whoRows = (s: PlantState, f: (d: Decided) => boolean, db?: ContentDb): WhoRow[] =>
  s.journal
    .filter(r => f(r.d) && (!r.ask?.end || r.ask.end.how === 'ok' || r.ask.end.how === 'no'))
    .map(r => {
      const ask = askInfo(s, r);
      const as = asOf(s, r);
      const q = qInfo(undefined, s, r);
      const via = r.via !== undefined ? { n: r.via, ...(recordOf(s, r.via)?.seat ? { seat: recordOf(s, r.via)!.seat } : {}) } : undefined;
      const m = memoInfo(db, s, r);
      const memo = m && r.d.kind === 'memo' ? { ...m, to: r.d.to } : undefined;
      return { n: r.n, t: r.t, by: r.by, ...(r.seat ? { seat: r.seat } : {}), kind: r.d.kind, ...(verdictOf(r.d) ? { v: verdictOf(r.d) } : {}), ...(ask ? { ask } : {}), ...(as ? { as } : {}), ...(via ? { via } : {}), ...(q ? { q } : {}), ...(memo ? { memo } : {}) };
    });

/** Записка игрока (Б5д), в которой есть команда о вещи: её строка — в «Кто решил» вещи. */
const memoAbout = (d: Decided, f: (c: Command) => boolean) => d.kind === 'memo' && d.cmds.some(f);

/**
 * Серия: задание, решение по балку, вывод расследования, решения уполномоченного лица; с Б5д — кто ведёт OOS и записки о
 * сдвиге серии. `db` — для часа ответа на записку, которую ещё не назначили.
 */
export function whoBatch(s: PlantState, b: Batch, db?: ContentDb): WhoRow[] {
  const invs = new Set(Object.values(s.investigations).filter(i => i.batch === b.id).map(i => i.id));
  return whoRows(s, d => ((d.kind === 'order' || d.kind === 'batch') && d.batch === b.id) || (d.kind === 'lot' && d.lot === b.bulk) || (d.kind === 'conclude' && invs.has(d.inv)) || (d.kind === 'fork' && d.fork === 'oos' && invs.has(d.inv)) || memoAbout(d, c => c.kind === 'shift' && c.batch === b.id), db);
}

/** Партия: заказ поставщику, с которым она пришла, и решение начальника ОКК; с Б5д — записки «ускорить испытания». */
export function whoLot(s: PlantState, lot: Lot, db?: ContentDb): WhoRow[] {
  return whoRows(s, d => (d.kind === 'po' && d.po === lot.po) || (d.kind === 'lot' && d.lot === lot.id) || memoAbout(d, c => c.kind === 'rush' && c.lot === lot.id), db);
}

/** Отклонение: оценка влияния; у результата вне спецификации — решение по партии и вывод расследования. */
export function whoDev(s: PlantState, id: string): WhoRow[] {
  const dev = s.deviations[id];
  const ofDev = (capa: string) => s.capas[capa]?.dev === id;
  return whoRows(
    s,
    d =>
      ((d.kind === 'assess' || d.kind === 'classify' || d.kind === 'capa') && d.dev === id) ||
      (d.kind === 'lot' && d.dev === id) ||
      (!!dev?.inv && d.kind === 'conclude' && d.inv === dev.inv) ||
      ((d.kind === 'capaRun' || d.kind === 'capaCheck') && ofDev(d.capa)),
  );
}

/** Актив: визиты подрядчика; с Б5д — развилки «визит держит серию» и записки о переносе визита. */
export const whoAsset = (s: PlantState, id: string, db?: ContentDb): WhoRow[] =>
  whoRows(s, d => ((d.kind === 'visit' || (d.kind === 'fork' && d.fork === 'visit')) && d.asset === id) || memoAbout(d, c => c.kind === 'visit' && c.asset === id), db);

/** Машина или оборудование: ремонты и замены её узлов, заказы ЗИП их запчастей. */
export function whoMachine(db: ContentDb, s: PlantState, machine: string): WhoRow[] {
  const parts = Object.values(s.parts).filter(p => p.machine === machine);
  const ids = new Set(parts.map(p => p.id));
  const spares = new Set(parts.map(p => (p.line ? db.machines[p.of] : db.equipment[p.of])?.parts.find(x => x.id === p.type)?.spare).filter((x): x is Id => !!x));
  return whoRows(s, d => ((d.kind === 'repair' || d.kind === 'replace' || (d.kind === 'fork' && d.fork === 'replace')) && ids.has(d.part)) || (d.kind === 'spare' && spares.has(d.spare)) || memoAbout(d, c => c.kind === 'maintain' && c.machine === machine), db);
}

/**
 * Решения человека за руководителя (Б5в): последние `n` записей журнала, где решал он — руководителем или «и. о.», —
 * новые сверху; предложения — не его решения.
 */
export function whoDecided(s: PlantState, p: Person, n = 5): WhoRow[] {
  const out: WhoRow[] = [];
  for (let i = s.journal.length - 1; i >= 0 && out.length < n; i--) {
    const r = s.journal[i];
    if (r.p !== p.id || r.ask) continue;
    const as = asOf(s, r);
    out.push({ n: r.n, t: r.t, by: r.by, kind: r.d.kind, ...(verdictOf(r.d) ? { v: verdictOf(r.d) } : {}), ...(as ? { as } : {}) });
  }
  return out;
}

/** Человек: кто открыл вакансию, на которую его приняли, и кто принял; ушедший — вакансия на его место. */
export function whoPerson(s: PlantState, p: Person): WhoRow[] {
  const hire = s.journal.find(r => r.d.kind === 'hire' && r.d.cand === p.cand);
  const vac = hire?.d.kind === 'hire' ? hire.d.vacancy : undefined;
  return whoRows(s, d => (!!p.cand && d.kind === 'hire' && d.cand === p.cand) || (!!vac && d.kind === 'vacancy' && d.vacancy === vac) || (d.kind === 'vacancy' && d.why?.instead === p.id));
}

// ---------------------------------------------------------------- записки и вопросы за сутки

/**
 * «Записки и вопросы» за сутки до планёрки (Б5д): ответы руководителей на записки и вопросы, решённые без игрока, — сам
 * или «не нужно», — новые сверху.
 */
export function memoDays(db: ContentDb, s: PlantState, from: number, to: number): JournalRow[] {
  const at = (t: number) => t >= from && t < to;
  return s.journal
    .filter(r => (r.memo?.end && !r.memo.end.off && at(r.memo.end.t)) || (r.q?.end && r.q.end.how !== 'player' && at(r.q.end.t)))
    .reverse()
    .map(r => rowOf(db, s, r));
}

// ---------------------------------------------------------------- решения за сутки

/**
 * Решения руководителя за сутки до планёрки: сколько всего, по видам и вердиктам; у заказов поставщикам — предоплата;
 * последняя запись — к журналу.
 */
export interface HeadDay {
  head: Head;
  n: number;
  kinds: { kind: Decided['kind']; v?: string; n: number }[];
  prepaid?: number;
  last: number;
}

/**
 * Решения руководителей с мгновения `from` до `to`: строка на руководителя, в порядке их поста и первой записи.
 * Предложения (Б5б) — не решения руководителя: принятое решил игрок.
 */
export function headDays(s: PlantState, from: number, to: number): HeadDay[] {
  const out = new Map<Head, HeadDay>();
  for (const r of s.journal) {
    if (r.by === 'player' || r.ask || r.q || r.t < from || r.t >= to) continue;
    let h = out.get(r.by);
    if (!h) out.set(r.by, (h = { head: r.by, n: 0, kinds: [], last: r.n }));
    h.n++;
    h.last = r.n;
    const v = verdictOf(r.d);
    const k = h.kinds.find(x => x.kind === r.d.kind && x.v === v);
    if (k) k.n++;
    else h.kinds.push({ kind: r.d.kind, ...(v ? { v } : {}), n: 1 });
    if (r.d.kind === 'po') h.prepaid = (h.prepaid ?? 0) + r.d.prepaid;
  }
  const order = Object.keys(HEAD_SEAT) as Head[];
  return [...out.values()].sort((a, b) => order.indexOf(a.head) - order.indexOf(b.head));
}
