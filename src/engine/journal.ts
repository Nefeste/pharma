// Журнал решений (Б5а; docs/specs/2026-10-vertical-slice.md, «Б5а»; геймдизайн, §8.5): у каждого решения, которое завод
// принимает по правилу, — автор, руководитель отдела, чья это работа на настоящем заводе, и причина с числами, которые
// завод знает; у решения игрока тех же видов — «вы» и место, с которого отдана команда. Руководитель в Б5а — должность, а
// не человек: людьми с навыком они станут в Б5в. Журнал движок только пишет: правила его не читают, и решения завода от
// него не зависят. Запись старше срока уходит в полночь.
import type { Dept, SeatId } from '../content/types';
import { DAY } from './core/calendar';
import { held, ownerOf } from './seats';
import type { Command, Decided, Head, PlantState } from './types';

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

/** Записать решение: номер по порядку — свой счётчик журнала, мгновение, автор; у игрока — место. */
export function note(s: PlantState, by: Head | 'player', d: Decided, seat?: SeatId) {
  const n = (s.next.journal = (s.next.journal ?? 0) + 1);
  s.journal.push({ n, t: s.t, by, ...(seat ? { seat } : {}), d });
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

/** Решение по команде: у игрока — запись «вы» с местом; у коллеги — его руководитель; у сценария — ничего. */
export function noteCmd(s: PlantState, cmd: Command & { by?: string }, d: Decided, dept?: Dept) {
  if (cmd.by === undefined || cmd.by === 'player') return note(s, 'player', d, seatOf(s, cmd, dept));
  const head = BY[cmd.by];
  if (head) note(s, head, d);
}

/** Полночь: записи старше срока уходят — они по порядку, старые первыми. */
export function trimJournal(s: PlantState) {
  const from = s.t - KEEP * DAY;
  let i = 0;
  while (i < s.journal.length && s.journal[i].t < from) i++;
  if (i > 0) s.journal.splice(0, i);
}
