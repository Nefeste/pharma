// Служебные записки (Б5д; docs/specs/2026-10-vertical-slice.md, «Б5д»; геймдизайн, §29.4): игрок, держа один пост, просит
// чужой отдел — та же команда, что у поста отдела, уходит руководителю отдела команды. Отвечает он в свой час: через час,
// если это его рабочее время — смена руководителя, а в его отсутствие — заместителя (Б5в), у руководителя-должности — с
// 08:00 до 17:00 рабочего дня; иначе — через час после начала его ближайшего рабочего времени (гипотеза §29.4). Ответ —
// резолюция (`gost-7-0-8`): выполнить — отдать команду как своё решение, запись журнала руководителя «по записке №»; не
// проходит — отказ с причиной движка, той же, что получил бы игрок на посту. Своей оценки записки у руководителя нет: по
// бюджету, окупаемости и риску её взвесит директор-коллега (Б6). О решениях ООК и уполномоченного лица записку не пишут —
// руководители производства и ОКК независимы (`gmp-eaeu`, ч. I, пп. 2.5–2.8), — о политиках и режимах тоже: спор о
// числах разводит директор. Мест не выбрано — всё своё, записок нет.
import { type ContentDb, type Id, SEATS, type SeatId } from '../content/types';
import { decider, isPerson, type Who, whoDecides } from './bosses';
import { schedule } from './core/agenda';
import { DAY, HOUR, isWorkday, momentOf } from './core/calendar';
import { asWho, DEPT_HEAD, note, recordOf, viaMemo } from './journal';
import { foreign, held, roleOf } from './seats';
import type { Command, Decision, Head, MemoRes, Notice, PlantState, Refusal } from './types';
import { calOf } from './workdays';

/** Через сколько руководитель отвечает на записку в своё рабочее время (геймдизайн, §29.4, гипотеза). */
export const MEMO_AFTER = HOUR;

/** Рабочее время руководителя-должности (§29.4): с 08:00 до 17:00 рабочего дня. */
export const DESK: readonly [number, number] = [8 * HOUR, 17 * HOUR];

/** Насколько вперёд окно ищет час ответа на записку: дальше — «не ответят» (должность свободна, заместителя нет). */
export const MEMO_HORIZON = 15 * DAY;

/** Решения ООК и уполномоченного лица по процедуре: о них записку не пишут (GMP ЕАЭС, ч. I, пп. 2.5–2.8). */
export const QA_OWN: ReadonlySet<Command['kind']> = new Set(['release', 'assess', 'investigate', 'conclude']);

/**
 * Кому записка о команде (Б5д): задание на серию, сдвиг и позиция упаковки — начальнику отдела планирования; замена узла
 * и перенос визита — главному механику; ускорить испытания — начальнику ОКК; уставка — главному технологу; заказ
 * поставщику — начальнику отдела снабжения; вывоз — заведующему складом; перевод на график, найм и отпуска — руководителю
 * отдела роли. О политиках — и о сверхурочных, политике отдела в окне «Политики» (Б5г), — о режимах и прочем записку не
 * пишут — `undefined`. Роль команды о людях — из состояния завода.
 */
export function memoHead(db: ContentDb, s: PlantState, cmd: Command): Head | undefined {
  return cmdHead(db, cmd, roleOf(s, cmd));
}

/** Кому записка о команде (Б5д), когда роль команды о людях уже известна, — то же правило для окна. */
export function cmdHead(db: ContentDb, cmd: Command, role?: Id): Head | undefined {
  switch (cmd.kind) {
    case 'order':
    case 'shift':
    case 'pack':
      return 'plan';
    case 'maintain':
    case 'visit':
      return 'maint';
    case 'rush':
      return 'qc';
    case 'setpoint':
      return 'tech';
    case 'po':
      return 'supply';
    case 'waste':
      return 'wms';
    case 'roster':
    case 'vacancy':
    case 'agency':
    case 'close':
    case 'hire':
    case 'dismiss':
    case 'leave':
    case 'also': {
      const dept = role ? db.roles[role]?.dept : undefined;
      return dept ? DEPT_HEAD[dept] : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Можно ли написать записку о команде (Б5д): команда чужого поста, о ней пишут — кому; своя, решение ООК по процедуре
 * или о политиках — причина отказа. Одна проверка для движка и окна.
 */
export function memoTo(db: ContentDb, s: PlantState, cmd: Command): { head: Head } | { why: Refusal } {
  if (!foreign(s, cmd, db)) return { why: 'memoOwn' };
  if (QA_OWN.has(cmd.kind)) return { why: 'memoQa' };
  const head = memoHead(db, s, cmd);
  return head ? { head } : { why: 'memoNo' };
}

/**
 * Кто ответит за руководителя в мгновение `t` (Б5д): руководитель — человек — в свою смену, в его отсутствие —
 * заместитель в свою (Б5в, `whoDecides`); должность — в рабочее время §29.4. Некому — `undefined`.
 */
export function onDuty(db: ContentDb, s: PlantState, head: Head, t: number): Who | undefined {
  if (isPerson(db, s, head)) return whoDecides(db, s, head, t);
  const m = momentOf(s.start, t);
  return isWorkday(calOf(db, s), m.day) && m.sec >= DESK[0] && m.sec < DESK[1] ? {} : undefined;
}

/**
 * Когда руководитель ответит на записку, отправленную в мгновение `t` (Б5д): через час, если это его рабочее время;
 * иначе — через час после первого целого часа, когда он снова в рабочем времени, как его назначит часовое событие. За
 * `MEMO_HORIZON` не нашлось — `undefined`. Одно правило с ответом движка — для слов окна «ответит в …».
 */
export function memoAt(db: ContentDb, s: PlantState, head: Head, t = s.t): number | undefined {
  const at = t + MEMO_AFTER;
  if (onDuty(db, s, head, at)) return at;
  for (let h = Math.floor(at / HOUR) * HOUR + HOUR; h < at + MEMO_HORIZON; h += HOUR) if (onDuty(db, s, head, h) && onDuty(db, s, head, h + MEMO_AFTER)) return h + MEMO_AFTER;
  return undefined;
}

/** Место игрока, с которого записка: первый взятый пост по порядку мест; директор записок не пишет — всё его. */
function memoSeat(s: PlantState): SeatId | undefined {
  const h = held(s);
  return h ? SEATS.find(x => x !== 'director' && h.includes(x)) : undefined;
}

/** Команда без автора: руководитель отдаст её от своего имени. */
function plain(c: Command): Command {
  if (!('by' in c)) return c;
  const { by: _by, ...rest } = c;
  return rest as Command;
}

/** Назначить ответ на мгновение `at`: событие `memo` с новым номером — прежнее устаревает. */
function arm(s: PlantState, r: Decision, at: number) {
  const m = r.memo!;
  m.v++;
  m.due = at;
  schedule(s.agenda, at, { kind: 'memo', n: r.n, v: m.v });
}

/** Записка больше не ждёт ответа: из открытых. */
function close(s: PlantState, n: number) {
  const list = s.heads.memos;
  if (!list) return;
  const i = list.indexOf(n);
  if (i >= 0) list.splice(i, 1);
  if (list.length === 0) delete s.heads.memos;
}

/**
 * Команда `memo` (Б5д): записка о командах чужого отдела — одной или нескольких, одному руководителю; запись журнала
 * «вы» с местом, ответ — через час в его рабочее время. Отказы: команд нет; своя команда; решение ООК по процедуре; о
 * политиках и прочем; команды разным руководителям.
 */
export function memoCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'memo' }>, notices: Notice[]) {
  const refuse = (why: Refusal, detail?: string) => notices.push({ kind: 'refused', cmd: 'memo', why, ...(detail ? { detail } : {}) });
  if (!Array.isArray(cmd.cmds) || cmd.cmds.length === 0) return refuse('empty');
  let to: Head | undefined;
  const cmds: Command[] = [];
  for (const c0 of cmd.cmds) {
    const c = plain(c0);
    const m = memoTo(db, s, c);
    if ('why' in m) return refuse(m.why, c.kind);
    if (to !== undefined && to !== m.head) return refuse('memoMix', c.kind);
    to = m.head;
    cmds.push(c);
  }
  const r = note(s, 'player', { kind: 'memo', to: to!, cmds }, memoSeat(s));
  r.memo = { v: 0 };
  arm(s, r, s.t + MEMO_AFTER);
  (s.heads.memos ??= []).push(r.n);
  const at = memoAt(db, s, to!);
  notices.push({ kind: 'memo', n: r.n, head: to!, ...(at !== undefined ? { at } : {}) });
}

/** Запись служебной записки по номеру; другой записи — нет. */
function memoOf(s: PlantState, n: number): Decision | undefined {
  const r = recordOf(s, n);
  return r?.memo && r.d.kind === 'memo' ? r : undefined;
}

/** Команда `withdraw` (Б5д): отозвать записку до ответа. Отказы: записки нет; на неё уже ответили или её отозвали. */
export function withdrawCommand(s: PlantState, cmd: Extract<Command, { kind: 'withdraw' }>, notices: Notice[]) {
  const r = memoOf(s, cmd.n);
  if (!r) return notices.push({ kind: 'refused', cmd: 'withdraw', why: 'noMemo', detail: String(cmd.n) });
  if (r.memo!.end) return notices.push({ kind: 'refused', cmd: 'withdraw', why: 'memoDone', detail: String(cmd.n) });
  r.memo!.end = { t: s.t, off: true };
  delete r.memo!.due;
  close(s, r.n);
}

/** Кто ответит сейчас: человек — правилом Б5в, с извещением «Некому решить»; должность — в рабочее время. */
const answerer = (db: ContentDb, s: PlantState, head: Head, notices: Notice[]): Who | undefined =>
  isPerson(db, s, head) ? decider(db, s, head, notices) : onDuty(db, s, head, s.t);

/**
 * Час ответа на записку (событие `memo`, Б5д): руководитель не в рабочем времени — записка ждёт его, часовое событие
 * назначит ответ. Иначе — каждая команда записки от имени руководителя, проверенная движком заново (`run` — та же
 * команда, что у поста отдела); прошла — запись руководителя «по записке», не прошла — причина отказа в ответе. Извещение
 * «Ответ на записку» — посту, с которого она.
 */
export function memoDue(db: ContentDb, s: PlantState, n: number, v: number, notices: Notice[], run: (c: Command) => Notice[]) {
  const r = memoOf(s, n);
  const m = r?.memo;
  if (!r || !m || m.end || m.v !== v || r.d.kind !== 'memo') return;
  const head = r.d.to;
  const w = answerer(db, s, head, notices);
  if (!w) {
    delete m.due;
    return;
  }
  const res: MemoRes[] = [];
  let ok = 0;
  for (const c of r.d.cmds) {
    const { out, rec } = viaMemo(r.n, () => asWho(head, w, () => run({ ...c, by: `head:${head}` } as Command)));
    const no = out.find((x): x is Extract<Notice, { kind: 'refused' }> => x.kind === 'refused' && x.cmd === c.kind);
    if (no) res.push({ why: no.why, ...(no.detail ? { detail: no.detail } : {}) });
    else {
      ok++;
      res.push(rec !== undefined ? { n: rec } : {});
    }
    for (const x of out) if (x !== no) notices.push(x);
  }
  m.end = { t: s.t, res, ...(w.p ? { p: w.p } : {}), ...(w.io ? { io: true as const } : {}) };
  delete m.due;
  close(s, r.n);
  notices.push({ kind: 'memoDone', n: r.n, head, ...(r.seat ? { seat: r.seat } : {}), ok, of: res.length });
}

/** Каждый час (Б5д): записке, что ждёт рабочего времени руководителя, — ответ через час, если он теперь на месте. */
export function memoHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  const open = s.heads.memos;
  if (!open) return;
  for (const n of [...open]) {
    const r = memoOf(s, n);
    if (!r || r.memo!.end) {
      close(s, n);
      continue;
    }
    if (r.memo!.due !== undefined || r.d.kind !== 'memo') continue;
    if (answerer(db, s, r.d.to, notices)) arm(s, r, s.t + MEMO_AFTER);
  }
}
