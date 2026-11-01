// Журнал решений для окна (Б5а; docs/specs/2026-10-vertical-slice.md, «Б5а»): строки журнала — от новых к старым, с
// отбором по посту и автору, страницами; «Кто решил» у вещей завода — серии, партии, отклонения, актива, машины,
// человека; решения за сутки на планёрке — строка на руководителя. С Б5б — предложения руководителей: открытые сверху,
// «Ждут вашего решения», с ответом и тем, может ли игрок ответить; режимы отделов взятых постов. Данные — без слов:
// номера, виды, числа, мгновения; слова — в окне (src/i18n/). Истины здесь нет (docs/02-architecture.md, §9): причины в
// журнале — числа, которые завод знает, а ссылки на вещи — их номера и коды, как в карточках.
import type { ContentDb, Dept, Id, SeatId } from '../content/types';
import { batchNo } from '../engine/batchno';
import { MODED, modeOf as deptMode } from '../engine/heads';
import { DEPT_HEAD, HEAD_SEAT } from '../engine/journal';
import { planOf } from '../engine/plant';
import { foreign, held } from '../engine/seats';
import { unitsOfLot } from '../engine/stock';
import { quotePo } from '../engine/supply';
import type { Ask, AssetFamily, Batch, Decided, Decision, DeptMode, Head, Lot, Person, PlantState } from '../engine/types';
import { thingOf } from './places';
import type { Thing } from './views';

type Code = [number, number, number];
const num = (id: string) => Number(id.slice(1));
const code = (c: { y: number; m: number; n: number }): Code => [c.y, c.m, c.n];

/** Журнал на странице `page`: отбор по посту и автору; `focus` — открыть на этой записи (её страница). */
export interface JournalQuery {
  view: 'journal';
  seat?: SeatId;
  who?: 'heads' | 'player';
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
  /** ждут вашего решения (Б5б): открытые предложения, новые сверху — на любой странице и при любом отборе */
  asks: JournalRow[];
  /** режимы отделов взятых постов (Б5б); у директора — всех отделов с выбором; мест не выбрано — нет */
  modes: ModeInfo[];
}

/** Строк на странице журнала. */
export const JOURNAL_PAGE = 50;

/** Пост решения игрока — пост руководителя, чья это работа (найм — отдела роли). */
function headOf(db: ContentDb, d: Decided): Head {
  switch (d.kind) {
    case 'order':
      return 'plan';
    case 'po':
    case 'contract':
      return 'supply';
    case 'step':
    case 'conclude':
    case 'assess':
    case 'pairEval':
      return 'qa';
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
      return 'sales';
    case 'waste':
      return 'wms';
    case 'mode':
      return d.head;
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
  const plan = planOf(db, s.plant);
  if (d.kind === 'po' && !d.po && ask?.cmd.kind === 'po') {
    const q = quotePo(db, s, ask.cmd.supplier, ask.cmd.lines);
    return { po: { lines: ('why' in q ? ask.cmd.lines : q.lines).map(l => ({ material: l.material, qty: l.qty })) } };
  }
  switch (d.kind) {
    case 'order':
      return d.batch ? batchRef(s, d.batch) : {};
    case 'batch':
      return batchRef(s, d.batch);
    case 'po': {
      const po = d.po ? s.pos[d.po] : undefined;
      return po ? { po: { lines: po.lines.map(l => ({ material: l.material, qty: l.qty })), eta: po.eta } } : {};
    }
    case 'step':
    case 'conclude': {
      const inv = s.investigations[d.inv];
      return inv ? { inv: inv.id, model: inv.model, dev: num(inv.deviation), ...batchRef(s, inv.batch) } : { inv: d.inv };
    }
    case 'assess': {
      const dev = s.deviations[d.dev];
      return { dev: num(d.dev), ...(dev?.batch ? batchRef(s, dev.batch) : {}), thing: { kind: 'dev', n: num(d.dev) } };
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

/** Строка журнала для окна. */
export function rowOf(db: ContentDb, s: PlantState, r: Decision): JournalRow {
  const ask = askInfo(s, r);
  return { n: r.n, t: r.t, by: r.by, ...(r.seat ? { seat: r.seat } : {}), post: postOf(db, r), d: r.d, ref: refOf(db, s, r.d, r.ask), ...(ask ? { ask } : {}) };
}

/** Открытые предложения (Б5б), новые сверху. */
export const openAsks = (db: ContentDb, s: PlantState): JournalRow[] =>
  Object.values(s.heads.open)
    .sort((a, b) => b - a)
    .flatMap(n => {
      const r = s.journal.find(x => x.n === n);
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
  const all = s.journal.filter(r => (!q.who || (q.who === 'player') === (r.by === 'player')) && (!q.seat || postOf(db, r) === q.seat)).reverse();
  const pages = Math.max(1, Math.ceil(all.length / JOURNAL_PAGE));
  const at = q.focus !== undefined ? all.findIndex(r => r.n === q.focus) : -1;
  const page = at >= 0 ? Math.floor(at / JOURNAL_PAGE) : Math.min(Math.max(0, q.page), pages - 1);
  const rows = all.slice(page * JOURNAL_PAGE, (page + 1) * JOURNAL_PAGE).map(r => rowOf(db, s, r));
  // с какого мгновения журнал помнит решения: открытое предложение старше срока остаётся — его не считают
  const kept = s.journal.find(r => !r.ask || r.ask.end);
  return { view: 'journal', rows, total: all.length, page, pages, ...(at >= 0 ? { focus: q.focus } : {}), ...(kept ? { since: kept.t } : {}), asks: openAsks(db, s), modes: modesOf(s) };
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
    default:
      return undefined;
  }
};

/**
 * Строки «Кто решил» вещи: решения и предложения руководителей (Б5б) — устаревшие и ненужные предложения не решали
 * ничего, их здесь нет.
 */
const whoRows = (s: PlantState, f: (d: Decided) => boolean): WhoRow[] =>
  s.journal
    .filter(r => f(r.d) && (!r.ask?.end || r.ask.end.how === 'ok' || r.ask.end.how === 'no'))
    .map(r => {
      const ask = askInfo(s, r);
      return { n: r.n, t: r.t, by: r.by, ...(r.seat ? { seat: r.seat } : {}), kind: r.d.kind, ...(verdictOf(r.d) ? { v: verdictOf(r.d) } : {}), ...(ask ? { ask } : {}) };
    });

/** Серия: задание, решение по балку, вывод расследования, решения уполномоченного лица. */
export function whoBatch(s: PlantState, b: Batch): WhoRow[] {
  const invs = new Set(Object.values(s.investigations).filter(i => i.batch === b.id).map(i => i.id));
  return whoRows(s, d => ((d.kind === 'order' || d.kind === 'batch') && d.batch === b.id) || (d.kind === 'lot' && d.lot === b.bulk) || (d.kind === 'conclude' && invs.has(d.inv)));
}

/** Партия: заказ поставщику, с которым она пришла, и решение начальника ОКК. */
export function whoLot(s: PlantState, lot: Lot): WhoRow[] {
  return whoRows(s, d => (d.kind === 'po' && d.po === lot.po) || (d.kind === 'lot' && d.lot === lot.id));
}

/** Отклонение: оценка влияния; у результата вне спецификации — решение по партии и вывод расследования. */
export function whoDev(s: PlantState, id: string): WhoRow[] {
  const dev = s.deviations[id];
  return whoRows(s, d => (d.kind === 'assess' && d.dev === id) || (d.kind === 'lot' && d.dev === id) || (!!dev?.inv && d.kind === 'conclude' && d.inv === dev.inv));
}

/** Актив: визиты подрядчика. */
export const whoAsset = (s: PlantState, id: string): WhoRow[] => whoRows(s, d => d.kind === 'visit' && d.asset === id);

/** Машина или оборудование: ремонты и замены её узлов, заказы ЗИП их запчастей. */
export function whoMachine(db: ContentDb, s: PlantState, machine: string): WhoRow[] {
  const parts = Object.values(s.parts).filter(p => p.machine === machine);
  const ids = new Set(parts.map(p => p.id));
  const spares = new Set(parts.map(p => (p.line ? db.machines[p.of] : db.equipment[p.of])?.parts.find(x => x.id === p.type)?.spare).filter((x): x is Id => !!x));
  return whoRows(s, d => ((d.kind === 'repair' || d.kind === 'replace') && ids.has(d.part)) || (d.kind === 'spare' && spares.has(d.spare)));
}

/** Человек: кто открыл вакансию, на которую его приняли, и кто принял; ушедший — вакансия на его место. */
export function whoPerson(s: PlantState, p: Person): WhoRow[] {
  const hire = s.journal.find(r => r.d.kind === 'hire' && r.d.cand === p.cand);
  const vac = hire?.d.kind === 'hire' ? hire.d.vacancy : undefined;
  return whoRows(s, d => (!!p.cand && d.kind === 'hire' && d.cand === p.cand) || (!!vac && d.kind === 'vacancy' && d.vacancy === vac) || (d.kind === 'vacancy' && d.why?.instead === p.id));
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
    if (r.by === 'player' || r.ask || r.t < from || r.t >= to) continue;
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
