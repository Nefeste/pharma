// Журнал решений (Б5а; docs/specs/2026-10-vertical-slice.md, «Б5а»; геймдизайн, §8.5): у каждого решения, которое завод
// принимает по правилу, — автор, руководитель отдела, чья это работа на настоящем заводе, и причина с числами, которые
// завод знает; у решения игрока тех же видов — «вы» и место, с которого отдана команда. Руководитель в Б5а — должность, а
// не человек: людьми с навыком они станут в Б5в. Решения «сам» от журнала не зависят; предложения руководителей (Б5б,
// heads.ts) — тоже записи журнала, и своё открытое предложение руководитель находит по указателю. Запись старше срока
// уходит в полночь, открытое предложение — остаётся, пока на него не ответят.
import type { Dept, SeatId } from '../content/types';
import { DAY } from './core/calendar';
import { held, ownerOf } from './seats';
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

/** Руководитель по полю `by` команды коллеги; команда сценария — никто. */
const BY: Record<string, Head> = { 'head:plan': 'plan', 'head:supply': 'supply', 'head:quality': 'qa', 'head:maint': 'maint', 'head:wms': 'wms' };

/** Записать решение: номер по порядку — свой счётчик журнала, мгновение, автор; у игрока — место; у предложения — команда. */
export function note(s: PlantState, by: Head | 'player', d: Decided, seat?: SeatId, ask?: Ask): Decision {
  const n = (s.next.journal = (s.next.journal ?? 0) + 1);
  const r: Decision = { n, t: s.t, by, ...(seat ? { seat } : {}), d, ...(ask ? { ask } : {}) };
  s.journal.push(r);
  return r;
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
  const head = BY[cmd.by];
  if (head) note(s, head, d);
}

/** Полночь: записи старше срока уходят — они по порядку, старые первыми; открытое предложение остаётся (Б5б). */
export function trimJournal(s: PlantState) {
  const from = s.t - KEEP * DAY;
  let i = 0;
  while (i < s.journal.length && s.journal[i].t < from) i++;
  if (i === 0) return;
  const keep = s.journal.slice(0, i).filter(r => r.ask && !r.ask.end);
  s.journal.splice(0, i, ...keep);
}
