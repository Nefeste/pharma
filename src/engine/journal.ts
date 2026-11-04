// Журнал решений (Б5а; docs/specs/2026-10-vertical-slice.md, «Б5а»; геймдизайн, §8.5): у каждого решения, которое завод
// принимает по правилу, — автор, руководитель отдела, чья это работа на настоящем заводе, и причина с числами, которые
// завод знает; у решения игрока тех же видов — «вы» и место, с которого отдана команда. Руководитель в Б5а — должность, а
// не человек: людьми с навыком они станут в Б5в. Решения «сам» от журнала не зависят; предложения руководителей (Б5б,
// heads.ts) — тоже записи журнала, и своё открытое предложение руководитель находит по указателю. Запись старше срока
// уходит в полночь, открытое предложение — остаётся, пока на него не ответят.
import type { Dept, SeatId } from '../content/types';
import { DAY } from './core/calendar';
import { held, ownerOf } from './seats';
import type { Who } from './bosses';
import type { Ask, Command, Decided, Decision, Head, PlantState } from './types';

/** Сколько суток журнал хранит решения (геймдизайн, §8.5, гипотеза); дольше их помнит хроника (§26.1). */
export const KEEP = 90;

/** Пост руководителя (docs/specs/2026-10-vertical-slice.md, «Б5а»): отдел кадров — у директора. */
export const HEAD_SEAT: Record<Head, SeatId> = {
  plan: 'production',
  mes: 'production',
  maint: 'production',
  qa: 'quality',
  qc: 'quality',
  qp: 'quality',
  tech: 'quality',
  supply: 'supply',
  wms: 'supply',
  sales: 'commerce',
  hr: 'director',
};

/** Кто решает найм отдела: производство и упаковку — начальник производства, остальные — руководитель своего отдела. */
export const DEPT_HEAD: Record<Dept, Head> = { mes: 'mes', line: 'mes', maint: 'maint', qa: 'qa', qc: 'qc', wms: 'wms' };

/**
 * Руководитель по полю `by` команды коллеги: `head:<руководитель>`, у коллеги качества — `head:quality`; команда сценария
 * — никто. По записке (Б5д) руководитель отдаёт команду с `head:<руководитель>`.
 */
function byHead(by: string): Head | undefined {
  if (by === 'head:quality') return 'qa';
  const h = by.startsWith('head:') ? by.slice(5) : '';
  return h in HEAD_SEAT ? (h as Head) : undefined;
}

/**
 * Записать решение: номер по порядку — свой счётчик журнала, мгновение, автор; у игрока — место; у предложения — команда;
 * у руководителя — кто решил за него (Б5в): человек штата, «и. о.» — заместитель; нет — должность.
 */
export function note(s: PlantState, by: Head | 'player', d: Decided, seat?: SeatId, ask?: Ask, who?: Who): Decision {
  const n = (s.next.journal = (s.next.journal ?? 0) + 1);
  const w = who ?? (by !== 'player' && acting?.head === by ? acting.who : undefined);
  const r: Decision = { n, t: s.t, by, ...(seat ? { seat } : {}), d, ...(ask ? { ask } : {}), ...(w?.p ? { p: w.p } : {}), ...(w?.io ? { io: true as const } : {}) };
  s.journal.push(r);
  return r;
}

/** Кто решает за руководителя на время команды коллеги (Б5в): запись журнала по команде — с этим человеком. */
let acting: { head: Head; who: Who } | undefined;

/** Отдать команду коллеги `run` от имени того, кто решает за руководителя `head` (Б5в). */
export function asWho<T>(head: Head, who: Who | undefined, run: () => T): T {
  const prev = acting;
  acting = who ? { head, who } : undefined;
  try {
    return run();
  } finally {
    acting = prev;
  }
}

/** Запись журнала по номеру: записи — по порядку номеров. */
export function recordOf(s: PlantState, n: number): Decision | undefined {
  let lo = 0;
  let hi = s.journal.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = s.journal[mid].n;
    if (m === n) return s.journal[mid];
    if (m < n) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/**
 * Место, с которого игрок отдал команду: пост команды, если он у игрока, иначе директор; мест не выбрано — нет. Чужую
 * команду игрока движок отклоняет раньше (seats.ts), поэтому другого не бывает. `dept` — отдел роли у команд найма.
 */
export function seatOf(s: PlantState, cmd: Command, dept?: Dept): SeatId | undefined {
  const h = held(s);
  if (!h) return undefined;
  const own = ownerOf(cmd, dept);
  return own && h.includes(own) ? own : 'director';
}

/** Записка, по которой руководитель отдаёт команду сейчас (Б5д): первая запись по этой команде — с её номером. */
let memoing: { n: number; rec?: number } | undefined;

/**
 * Ответить на записку `n` (Б5д): `run` отдаёт её команду от имени руководителя, и первая запись по ней — решение
 * руководителя «по записке № n»; её номер — в ответе. Команда записей не пишет или не прошла — номера нет.
 */
export function viaMemo<T>(n: number, run: () => T): { out: T; rec?: number } {
  const prev = memoing;
  const m: { n: number; rec?: number } = { n };
  memoing = m;
  try {
    const out = run();
    return { out, ...(m.rec !== undefined ? { rec: m.rec } : {}) };
  } finally {
    memoing = prev;
  }
}

/** Предложение, которое игрок принимает сейчас (Б5б): решение игрока по его команде ложится в эту запись. */
let accepting: { r: Decision; done: boolean; seat?: SeatId } | undefined;

/**
 * Принять предложение `r` (Б5б): `run` отдаёт его команду от имени игрока, и первое решение игрока по ней — номера вещей
 * — ложится в запись предложения, а не новой записью: номера журнала те же, что у решения «сам». Команда не прошла —
 * `done` нет. Только на время `run`: вне его решения игрока пишутся, как всегда.
 */
export function accepted(r: Decision, run: () => void): { done: boolean; seat?: SeatId } {
  const prev = accepting;
  const a: { r: Decision; done: boolean; seat?: SeatId } = { r, done: false };
  accepting = a;
  try {
    run();
  } finally {
    accepting = prev;
  }
  return { done: a.done, ...(a.seat ? { seat: a.seat } : {}) };
}

/**
 * Решение по команде: у игрока — запись «вы» с местом, а у принятого предложения (Б5б) — номера вещей в его записи; у
 * коллеги — его руководитель; у сценария — ничего.
 */
export function noteCmd(s: PlantState, cmd: Command & { by?: string }, d: Decided, dept?: Dept) {
  if (cmd.by === undefined || cmd.by === 'player') {
    const seat = seatOf(s, cmd, dept);
    if (accepting && !accepting.done) {
      accepting.r.d = { ...accepting.r.d, ...d } as Decided;
      accepting.done = true;
      if (seat) accepting.seat = seat;
      return;
    }
    note(s, 'player', d, seat);
    return;
  }
  const head = byHead(cmd.by);
  if (!head) return;
  const r = note(s, head, d);
  // по записке (Б5д): первая запись по команде — с номером записки
  if (memoing && memoing.rec === undefined) {
    r.via = memoing.n;
    memoing.rec = r.n;
  }
}

/** Ждёт ли запись ответа: предложение (Б5б), записка или вопрос «Просят решить» (Б5д). */
export const waits = (r: Decision) => (!!r.ask && !r.ask.end) || (!!r.memo && !r.memo.end) || (!!r.q && !r.q.end);

/**
 * Полночь: записи старше срока уходят — они по порядку, старые первыми; открытое предложение (Б5б), записка без ответа
 * и открытый вопрос (Б5д) остаются.
 */
export function trimJournal(s: PlantState) {
  const from = s.t - KEEP * DAY;
  let i = 0;
  while (i < s.journal.length && s.journal[i].t < from) i++;
  if (i === 0) return;
  const keep = s.journal.slice(0, i).filter(waits);
  s.journal.splice(0, i, ...keep);
}
