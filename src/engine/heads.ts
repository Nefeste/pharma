// Режимы отделов (Б5б; docs/specs/2026-10-vertical-slice.md, «Б5б»; геймдизайн, §8.5): у руководителя с решениями-
// выборами режим — «сам», «советует» или «вручную». «Сам» — решает по правилу и пишет в журнал, как в Б5а. «Советует» —
// в свой час считает то же решение тем же правилом и пишет в журнал предложение с той же причиной и командой; командой
// оно становится, когда игрок его примет. «Вручную» — молчит. По умолчанию отделы взятых постов — «советует», у
// директора — «сам»; выбор игрока у руководителя помнится. У вещи — одно открытое предложение: новое в следующий час
// руководителя заменяет старое — «устарело», правило не сработало — «не нужно»; ту же команду, что отклонили, руководитель
// не предлагает снова до следующих суток. Пост отпущен или режим сменился — открытые предложения устаревают: руководитель
// решит в свой час. Решения ОКК, уполномоченного лица, ремонт после отказа и решения по сроку — правилом в любом режиме.
import type { SeatId } from '../content/types';
import { accepted, HEAD_SEAT, note, noteCmd, recordOf } from './journal';
import { held } from './seats';
import type { Ask, Command, Decided, Decision, DeptMode, Head, HeadsState, Notice, PlantState } from './types';

/**
 * Руководители с решениями-выборами: начальник отдела планирования; начальник производства — найм производства и
 * упаковки; главный механик; начальник ООК; начальник ОКК — найм; снабжение; заведующий складом.
 */
export const MODED: readonly Head[] = ['plan', 'mes', 'maint', 'qa', 'qc', 'supply', 'wms'];

const MODES: readonly DeptMode[] = ['auto', 'advise', 'manual'];

export const newHeads = (): HeadsState => ({ mode: {}, open: {}, no: {} });

/**
 * Режим руководителя сейчас: мест не выбрано — «сам»; пост его отдела у игрока — выбор игрока или «советует»; игрок —
 * директор — выбор игрока или «сам»; иначе — «сам». У руководителя без выборов — всегда «сам».
 */
export function modeOf(s: PlantState, head: Head): DeptMode {
  if (!MODED.includes(head)) return 'auto';
  const h = held(s);
  if (!h) return 'auto';
  if (h.includes(HEAD_SEAT[head])) return s.heads.mode[head] ?? 'advise';
  return h.includes('director') ? (s.heads.mode[head] ?? 'auto') : 'auto';
}

/** Одна и та же команда: те же поля в том же порядке — их строит одно правило. */
const same = (a: Command, b: Command) => JSON.stringify(a) === JSON.stringify(b);

/** Место игрока, который отвечает на предложение руководителя: пост отдела, если он у игрока, иначе директор. */
function askSeat(s: PlantState, head: Head): SeatId | undefined {
  const h = held(s);
  return !h ? undefined : h.includes(HEAD_SEAT[head]) ? HEAD_SEAT[head] : 'director';
}

/** Ответ на предложение: в запись; указатели — открытое уходит, отклонённое помнится до полуночи. */
function end(s: PlantState, r: Decision, how: NonNullable<Ask['end']>['how'], seat?: SeatId) {
  const a = r.ask!;
  a.end = { how, t: s.t, ...(seat ? { seat } : {}) };
  if (s.heads.open[a.key] === r.n) delete s.heads.open[a.key];
  if (how === 'no') s.heads.no[a.key] = r.n;
}

/** Открытое предложение у вещи. */
export function openAsk(s: PlantState, key: string): Decision | undefined {
  const n = s.heads.open[key];
  return n === undefined ? undefined : recordOf(s, n);
}

/** Что видел руководитель у вещи: у открытого предложения или у отклонённого сегодня; то же — считать заново незачем. */
export function seenAt(s: PlantState, key: string): number | undefined {
  const n = s.heads.open[key] ?? s.heads.no[key];
  return n === undefined ? undefined : recordOf(s, n)?.ask?.seen;
}

/**
 * Предложить (Б5б): у вещи открыто то же — оно и остаётся; другое — устарело, а новое — в журнал с причиной, командой
 * и извещением поста отдела; ту же команду отклонили сегодня — ничего. `seen` — что руководитель видел, когда считал.
 */
export function propose(s: PlantState, head: Head, key: string, cmd: Command, d: Decided, notices: Notice[], seen?: number) {
  const r = openAsk(s, key);
  if (r && same(r.ask!.cmd, cmd)) {
    if (seen !== undefined) r.ask!.seen = seen;
    return;
  }
  if (r) end(s, r, 'stale');
  const no = s.heads.no[key] !== undefined ? recordOf(s, s.heads.no[key]) : undefined;
  if (no?.ask && same(no.ask.cmd, cmd)) {
    if (seen !== undefined) no.ask.seen = seen;
    return;
  }
  const x = note(s, head, d, undefined, { key, cmd, ...(seen !== undefined ? { seen } : {}) });
  s.heads.open[key] = x.n;
  notices.push({ kind: 'proposal', n: x.n, head, seat: HEAD_SEAT[head], t: s.t });
}

/** Правило больше не срабатывает: открытое предложение у вещи — «не нужно». */
export function moot(s: PlantState, key: string) {
  const r = openAsk(s, key);
  if (r) end(s, r, 'moot');
}

/**
 * Час руководителя (Б5б): предложения этого часа; открытые предложения у вещей с этими приставками, которых правило в
 * этот час не предложило, — «не нужно».
 */
export function round(s: PlantState, prefixes: readonly string[]) {
  const touched = new Set<string>();
  return {
    propose(head: Head, key: string, cmd: Command, d: Decided, notices: Notice[]) {
      touched.add(key);
      propose(s, head, key, cmd, d, notices);
    },
    done() {
      for (const key of Object.keys(s.heads.open)) if (prefixes.some(p => key.startsWith(p)) && !touched.has(key)) moot(s, key);
    },
  };
}

/** Пост отпущен или режим сменился (Б5б): открытые предложения руководителей, которые больше не советуют, устарели. */
export function staleAsks(s: PlantState) {
  for (const n of Object.values(s.heads.open)) {
    const r = recordOf(s, n);
    if (r && r.by !== 'player' && modeOf(s, r.by) !== 'advise') end(s, r, 'stale');
  }
}

/** Полночь: отклонённое вчера руководитель может предложить снова. */
export function headsDay(s: PlantState) {
  if (Object.keys(s.heads.no).length > 0) s.heads.no = {};
}

/**
 * Команда `mode` (Б5б): выбор игрока у руководителя — помнится и тогда, когда пост отпущен; запись журнала. Отказы:
 * руководителя без выборов или режима нет; этот режим уже выбран. Предложения руководителя, который больше не советует,
 * устаревают.
 */
export function modeCommand(s: PlantState, cmd: Extract<Command, { kind: 'mode' }>, notices: Notice[]) {
  if (!MODED.includes(cmd.head) || !MODES.includes(cmd.mode)) return notices.push({ kind: 'refused', cmd: 'mode', why: 'noDept', detail: cmd.head });
  if (s.heads.mode[cmd.head] === cmd.mode) return notices.push({ kind: 'refused', cmd: 'mode', why: 'same', detail: cmd.head });
  s.heads.mode[cmd.head] = cmd.mode;
  noteCmd(s, cmd, { kind: 'mode', head: cmd.head, mode: cmd.mode });
  staleAsks(s);
}

/**
 * Ответ на предложение (Б5б): «Принять» — команда руководителя от имени игрока, с его места: движок проверяет её заново
 * (`run` — та же команда, что у игрока), и прошла — запись предложения получает номера вещей команды и «принято»; не
 * прошла — отказ с причиной, а предложение «не нужно». «Отклонить» — команды нет. Отказы: такой записи с предложением
 * нет; на предложение уже ответили, оно устарело или не нужно.
 */
export function answerCommand(s: PlantState, cmd: Extract<Command, { kind: 'accept' | 'decline' }>, notices: Notice[], run: (c: Command) => Notice[]) {
  const r = recordOf(s, cmd.n);
  if (!r?.ask || r.by === 'player') return notices.push({ kind: 'refused', cmd: cmd.kind, why: 'noAsk', detail: String(cmd.n) });
  if (r.ask.end) return notices.push({ kind: 'refused', cmd: cmd.kind, why: 'askDone', detail: String(cmd.n) });
  if (cmd.kind === 'decline') return end(s, r, 'no', askSeat(s, r.by));
  // решение игрока по этой команде — в запись предложения: одна запись «предложил — принято вами»
  const got = accepted(r, () => notices.push(...run({ ...r.ask!.cmd, by: 'player' } as Command)));
  if (!got.done) return end(s, r, 'moot');
  end(s, r, 'ok', got.seat ?? askSeat(s, r.by));
}
