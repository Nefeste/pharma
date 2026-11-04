// Служебная записка у кнопки чужого поста (Б5д; docs/specs/2026-10-vertical-slice.md, «Б5д»; геймдизайн, §29.4): у
// команды отдела, чей пост не у игрока, вместо неактивной кнопки — «Записка»: то же действие уходит руководителю отдела, а
// подсказка говорит, кому и когда он ответит. О решениях ООК и уполномоченного лица записку не пишут — кнопка погашена с
// подписью. Кто адресат — то же правило, что у движка (`cmdHead`, src/engine/memos.ts); когда ответит — вид полосы (`memo`
// у src/sim/report.ts, `topView`).
import type { Id, SeatId } from '../content/types';
import { cmdHead } from '../engine/memos';
import type { Command, Head } from '../engine/types';
import { T, whenText } from '../i18n';
import { db } from './db';
import { holds, type Hud } from './store';

/** Кнопка команды поста: своя — действие; чужая с запиской — кому и подсказка; чужая без записки — подпись, чья. */
export interface Act {
  mine: boolean;
  memo?: Head;
  title: string;
}

/**
 * Что за кнопка у команды `cmd` поста `seat` (Б5д): пост у игрока — своя; иначе записка руководителю отдела команды
 * с часом ответа; записку не пишут (решения ООК по процедуре, политики) — погашена с подписью. `role` — роль у команд о
 * людях: её отдел — чей пост.
 */
export function actOf(hud: Hud, seat: SeatId, cmd: Command, role?: Id): Act {
  if (holds(hud, seat)) return { mine: true, title: '' };
  const head = db ? cmdHead(db, cmd, role) : undefined;
  if (!head) return { mine: false, title: cmd.kind === 'release' || cmd.kind === 'assess' || cmd.kind === 'investigate' || cmd.kind === 'conclude' ? T.seats.memoQa : T.seats.notYours(T.seats.names[seat] ?? seat) };
  const at = hud.top?.memo?.[head];
  return { mine: false, memo: head, title: T.seats.memoHint(T.journal.namesTo[head] ?? head, at !== undefined ? whenText(hud.start, at) : undefined) };
}

/** Подпись кнопки: своя — как есть; записка — «Записка: …». */
export const actLabel = (a: Act, label: string) => (a.mine || !a.memo ? label : T.seats.memo(label.toLowerCase()));

/** Можно ли нажать: своя или записка. */
export const actOn = (a: Act) => a.mine || a.memo !== undefined;
