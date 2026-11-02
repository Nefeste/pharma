// Руководители — люди (Б5в; docs/specs/2026-10-vertical-slice.md, «Б5в»; геймдизайн, §8.5, §29.3): у руководителя отдела
// — человек штата его роли, со сменой, отпуском и навыком; он решает в свою смену, а пока он в отпуске или должность
// свободна — назначенный заместитель, в свою смену и со своим навыком, «и. о.» (GMP ЕАЭС, ч. I, п. 2.3; ст. 60.2 ТК РФ).
// Уполномоченное лицо замещает только другое (п. 2.6). Заместителя нет или и он отсутствует — решения отдела ждут, а у
// поста отдела — извещение «Некому решить». Главный технолог, начальник отдела продаж и отдел кадров — должности без
// людей до своих частей: решают, как прежде, в час правила. Навык 4 и 5 — правило отдела целиком, ниже — с ограничением по
// таблице геймдизайна (§8.5, гипотезы): горизонт планирования, порог вывода расследования, замена узла, навык при найме.
import { HEAD_IDS, type ContentDb, type HeadId, type Id } from '../content/types';
import { isWorkday, momentOf } from './core/calendar';
import { HEAD_SEAT, noteCmd } from './journal';
import { awayOn } from './leave';
import { employedOn } from './shifts';
import { shiftEndAt } from './staff';
import type { Command, Head, Notice, Person, PlantState } from './types';
import { calOf } from './workdays';

/** Роль руководителя отдела (Б5в): человек этой роли в штате — руководитель. */
export const HEAD_ROLE: Record<HeadId, Id> = {
  plan: 'role.plan-head',
  mes: 'role.production-head',
  maint: 'role.chief-mechanic',
  qa: 'role.qa-head',
  qc: 'role.qc-head',
  supply: 'role.supply-head',
  wms: 'role.warehouse-head',
};

/**
 * Руководители, чей оклад придёт в кассу вместе с общими расходами (решение владельца 02.11.2026, вариант 3,
 * Nefeste/pharma#123; геймдизайн, §12.2): шесть должностей, которые с Б5в стали людьми. Оклад виден в карточке и у
 * кандидата; зарплата, отпускные и расчёт при увольнении — не из кассы среза; найм — плата агентству, медосмотр и
 * переезд — сразу. Начальник ОКК и уполномоченные лица были людьми и раньше — их деньги идут, как шли.
 */
export const PAID_LATER: ReadonlySet<Id> = new Set([HEAD_ROLE.plan, HEAD_ROLE.mes, HEAD_ROLE.maint, HEAD_ROLE.qa, HEAD_ROLE.supply, HEAD_ROLE.wms]);
export const paidLater = (p: Pick<Person, 'role'>) => PAID_LATER.has(p.role);

/** Роль уполномоченного лица: его замещает только другое (GMP ЕАЭС, ч. I, п. 2.6). */
export const QP_ROLE = 'role.qp';

/** Кто решает за руководителя: человек штата — с «и. о.», если это заместитель; нет человека — должность. */
export interface Who {
  p?: string;
  io?: true;
}

const isHeadId = (h: Head): h is HeadId => (HEAD_IDS as readonly string[]).includes(h);
const today = (s: PlantState) => momentOf(s.start, s.t).day;
const byTab = (a: Person, b: Person) => a.tab - b.tab;

/** Люди роли, которые работают в день `z` (приняты и не ушли), — по табельному номеру. */
function ofRole(s: PlantState, role: Id, z: number): Person[] {
  return Object.values(s.people)
    .filter(p => p.role === role && employedOn(p, z))
    .sort(byTab);
}

/** Руководитель отдела `h` — первый по табельному номеру работающий человек его роли; должность свободна — нет. */
export function headOf(s: PlantState, h: HeadId, z = today(s)): Person | undefined {
  return ofRole(s, HEAD_ROLE[h], z)[0];
}

/**
 * Заместитель руководителя `h`: назначенный, если он ещё работает; сняли — никого; не назначали — первый по табельному
 * номеру человек роли заместителя из записи сценария (не сам руководитель).
 */
export function deputyOf(db: ContentDb, s: PlantState, h: HeadId, z = today(s)): Person | undefined {
  const set = s.deputies?.[h];
  if (set === '') return undefined;
  if (set !== undefined) {
    const p = s.people[set];
    if (p && employedOn(p, z)) return p;
  }
  const role = db.scenarios[s.scenario].heads?.[h]?.deputy;
  if (!role) return undefined;
  const head = headOf(s, h, z);
  return ofRole(s, role, z).find(p => p.id !== head?.id);
}

/** В смене ли человек в мгновение `t` (по графику, без отпуска и в дни работы на заводе). */
const onShift = (db: ContentDb, s: PlantState, p: Person, t: number) => shiftEndAt(db, s, p, t) !== undefined;

/**
 * Кто решает за руководителя `head` сейчас (Б5в). Должность без людей — она сама. Уполномоченное лицо — первое по
 * табельному номеру в смене. Руководитель на заводе, не в отпуске — он, если в смене, иначе никто: решение ждёт его
 * смены. Его нет — заместитель в своей смене, «и. о.». Никого — `undefined`: решение ждёт.
 */
export function whoDecides(db: ContentDb, s: PlantState, head: Head, t = s.t): Who | undefined {
  const z = momentOf(s.start, t).day;
  if (head === 'qp') {
    const p = ofRole(s, QP_ROLE, z).find(q => onShift(db, s, q, t));
    return p ? { p: p.id } : undefined;
  }
  if (!isHeadId(head)) return {};
  const h = headOf(s, head, z);
  if (h && !awayOn(h, z)) return onShift(db, s, h, t) ? { p: h.id } : undefined;
  const d = deputyOf(db, s, head, z);
  return d && !awayOn(d, z) && onShift(db, s, d, t) ? { p: d.id, io: true } : undefined;
}

/**
 * Некому решить (Б5в): руководителя нет — должность свободна или он в отпуске, — а заместителя нет или и он в отпуске.
 * Вне смены руководитель или заместитель — не «некому»: решение ждёт смены.
 */
export function noOneFor(db: ContentDb, s: PlantState, head: Head, z = today(s)): boolean {
  if (head === 'qp') return ofRole(s, QP_ROLE, z).every(p => !!awayOn(p, z));
  if (!isHeadId(head)) return false;
  const h = headOf(s, head, z);
  if (h && !awayOn(h, z)) return false;
  const d = deputyOf(db, s, head, z);
  return !d || !!awayOn(d, z);
}

/**
 * Кто решит сейчас — для правила руководителя: есть кому — он, и «некому» снято; нет — `undefined`, а если решать некому,
 * извещение «Некому решить» — один раз, пока кто-нибудь не вернётся.
 */
export function decider(db: ContentDb, s: PlantState, head: Head, notices: Notice[]): Who | undefined {
  const w = whoDecides(db, s, head);
  if (w) {
    if (s.noOne?.[head]) delete s.noOne[head];
    return w;
  }
  if (!s.noOne?.[head] && noOneFor(db, s, head)) {
    (s.noOne ??= {})[head] = true;
    notices.push({ kind: 'noOne', head, seat: HEAD_SEAT[head] });
  }
  return undefined;
}

/**
 * Правило руководителя `head` в рабочий день с часа `hour` (Б5в): раз в сутки, в первый час, когда есть кому решить, —
 * в смену руководителя или заместителя; отметка `key` — день, когда правило отработало. Некому — извещение (`decider`).
 */
export function dueRule(db: ContentDb, s: PlantState, key: string, head: Head, hour: number, notices: Notice[]): Who | undefined {
  const now = momentOf(s.start, s.t);
  if (now.sec < hour || !isWorkday(calOf(db, s), now.day) || s.ruled?.[key] === now.day) return undefined;
  const w = decider(db, s, head, notices);
  if (w) (s.ruled ??= {})[key] = now.day;
  return w;
}

/** Навык того, кто решает: у человека — его навык, у должности без людей — правило целиком. */
export function skillOf(s: PlantState, w: Who | undefined): number {
  const p = w?.p ? s.people[w.p] : undefined;
  return p ? p.skill : FULL;
}

/** Навык, с которого правило отдела — целиком (геймдизайн, §8.5). */
export const FULL = 4;

/** Горизонт планирования (§8.5): запас позиций на столько суток — у навыка 3 две трети, 2 — половина, 1 — треть. */
export function coverBy(skill: number, cover: number): number {
  if (skill >= FULL) return cover;
  if (skill === 3) return Math.floor((cover * 2) / 3);
  return Math.floor(cover / (skill === 2 ? 2 : 3));
}

/** Порог вывода расследования (§8.5), 1/10 000: у навыка 3 — на 10 пунктов ниже, 2 — на 20, 1 — на 30. */
export function thresholdBy(skill: number, threshold: number): number {
  return skill >= FULL ? threshold : Math.max(0, threshold - (FULL - skill) * 1000);
}

/** Замена узла по наработке (§8.5): навык 3 и выше — по наработке, ниже — только после отказа. */
export const replacesBy = (skill: number) => skill >= 3;

/** Навык принимаемого кандидата не ниже (§8.5): у навыка 2 — на 1 ниже записи сценария, 1 — на 2. */
export function hireMinBy(skill: number, min: number): number {
  return skill >= 3 ? min : Math.max(1, min - (3 - skill));
}

/**
 * Назначить или снять заместителя (Б5в): человек штата, который работает, одной из ролей записи сценария и не сам
 * руководитель; запись журнала — решение игрока. Пост отдела руководителя или директор — проверено в seats.ts.
 */
export function deputyCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'deputy' }>, notices: Notice[]) {
  const row = db.scenarios[s.scenario].heads?.[cmd.head];
  if (!row) return notices.push({ kind: 'refused', cmd: 'deputy', why: 'noRole', detail: cmd.head });
  const z = today(s);
  const was = deputyOf(db, s, cmd.head, z);
  if (cmd.person === null) {
    if (!was) return notices.push({ kind: 'refused', cmd: 'deputy', why: 'same', detail: cmd.head });
    (s.deputies ??= {})[cmd.head] = '';
  } else {
    const p = s.people[cmd.person];
    if (!p || !employedOn(p, z)) return notices.push({ kind: 'refused', cmd: 'deputy', why: 'noPerson', detail: cmd.person });
    if (p.role === HEAD_ROLE[cmd.head]) return notices.push({ kind: 'refused', cmd: 'deputy', why: 'ownRole', detail: cmd.person });
    if (!row.can.includes(p.role)) return notices.push({ kind: 'refused', cmd: 'deputy', why: 'noRole', detail: p.role });
    if (was?.id === p.id) return notices.push({ kind: 'refused', cmd: 'deputy', why: 'same', detail: cmd.person });
    (s.deputies ??= {})[cmd.head] = p.id;
  }
  noteCmd(s, cmd, { kind: 'deputy', head: cmd.head, ...(cmd.person ? { person: cmd.person } : {}), ...(was ? { was: was.id } : {}) });
  notices.push({ kind: 'deputy', head: cmd.head, ...(cmd.person ? { person: cmd.person } : {}) });
}
