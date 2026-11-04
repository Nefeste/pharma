// Руководители — люди для видов окна (Б5в; docs/specs/2026-10-vertical-slice.md, «Б5в»; геймдизайн, §8.5): кто
// руководитель отдела, в отпуске ли он, кто его заместитель, кто решает сегодня — сам, «и. о.» или некому, — и что навык
// того, кто решает, ограничивает в правиле отдела. Всё — записи завода: штат, график отпусков, назначения; навык — запись
// отдела кадров о человеке, как в карточке, а не истина модели.
import { type ContentDb, HEAD_IDS, type HeadId, type Id, type SeatId } from '../content/types';
import { coverBy, deputyOf, FULL, HEAD_ROLE, headOf, hireMinBy, replacesBy, thresholdBy } from '../engine/bosses';
import { momentOf } from '../engine/core/calendar';
import { laborOf } from '../engine/hire';
import { DEPT_HEAD, HEAD_SEAT } from '../engine/journal';
import { awayOn } from '../engine/leave';
import { numOf, POL } from '../engine/policies';
import { employedOn } from '../engine/shifts';
import type { Person, PlantState } from '../engine/types';

/**
 * Что навык ограничивает в правиле отдела (§8.5): у навыка 4 и 5 — правило целиком, значения равны «целиком». Горизонт
 * планирования — суток запаса; порог вывода расследования — доли 1/10 000; замена узлов — по наработке или только после
 * отказа; найм — навык принимаемого кандидата не ниже. У снабжения и склада в Б5в навык ничего не ограничивает.
 */
export interface BossLimit {
  cover?: { days: number; full: number };
  threshold?: { at: number; full: number };
  replace?: { byWear: boolean };
  hire?: { min: number; full: number };
}

/**
 * Человек в строке руководителей: номер для карточки, табельный номер, роль, навык; в отпуске — до какого дня; у
 * руководителя и заместителя — что его навык ограничивает, когда решает он.
 */
export interface BossPerson {
  n: number;
  tab: number;
  role: Id;
  skill: number;
  away?: number;
  limit?: BossLimit;
}

/**
 * Руководитель отдела (Б5в): пост отдела; человек — нет, если должность свободна; заместитель — назначенный игроком
 * (`set`), снятый (`none`) или по сценарию; кто решает сегодня — руководитель, «и. о.» или некому; из кого можно назначить
 * заместителя; навык, с которого правило целиком.
 */
export interface BossRow {
  head: HeadId;
  seat: SeatId;
  person?: BossPerson;
  deputy?: BossPerson;
  set?: true;
  none?: true;
  now: 'head' | 'io' | 'noOne';
  can: BossPerson[];
  full: number;
}

const num = (id: string) => Number(id.slice(1));

/** Отделы, где решают люди: найм ведёт руководитель отдела роли (journal.ts, `DEPT_HEAD`). */
const HIRES: ReadonlySet<string> = new Set(Object.values(DEPT_HEAD));

/** Порог вывода расследования модели происшествия сценария, 1/10 000; происшествия нет — нет. */
function thresholdOf(db: ContentDb, s: PlantState): number | undefined {
  const inv = db.scenarios[s.scenario].incident?.inv;
  return inv ? db.investigations[inv]?.threshold : undefined;
}

/** Что навык `skill` ограничивает в правиле руководителя `head` (§8.5): числа — по политике и записи сценария. */
export function limitOf(db: ContentDb, s: PlantState, head: HeadId, skill: number): BossLimit {
  const out: BossLimit = {};
  if (head === 'plan') {
    const full = numOf(db, s, POL.cover);
    if (full !== undefined) out.cover = { days: coverBy(skill, full), full };
  }
  if (head === 'qa') {
    const full = thresholdOf(db, s);
    if (full !== undefined) out.threshold = { at: thresholdBy(skill, full), full };
  }
  if (head === 'maint') out.replace = { byWear: replacesBy(skill) };
  const lab = laborOf(db, s);
  if (lab && HIRES.has(head)) out.hire = { min: hireMinBy(skill, lab.colleague.skill), full: lab.colleague.skill };
  return out;
}

const personOf = (p: Person, z: number): BossPerson => {
  const a = awayOn(p, z);
  return { n: num(p.id), tab: p.tab, role: p.role, skill: p.skill, ...(a ? { away: a.to } : {}) };
};

/**
 * Руководители отделов (Б5в) по порядку `HEAD_IDS`; у сценария без записи `heads` руководители — должности: строк нет.
 * «Кто решает сегодня» — по дню, а не по смене: руководитель на заводе — он, его нет — заместитель на заводе, никого —
 * некому; в смене ли они сейчас, видно в «Сейчас» и в карточке.
 */
export function bossRows(db: ContentDb, s: PlantState): BossRow[] {
  const heads = db.scenarios[s.scenario].heads;
  if (!heads) return [];
  const z = momentOf(s.start, s.t).day;
  return HEAD_IDS.flatMap(h => {
    const row = heads[h];
    if (!row) return [];
    const p = headOf(s, h, z);
    const d = deputyOf(db, s, h, z);
    const set = s.deputies?.[h];
    const here = (x: Person | undefined) => !!x && !awayOn(x, z);
    const now: BossRow['now'] = here(p) ? 'head' : here(d) ? 'io' : 'noOne';
    const can = Object.values(s.people)
      .filter(x => row.can.includes(x.role) && x.role !== HEAD_ROLE[h] && employedOn(x, z))
      .sort((a, b) => a.tab - b.tab)
      .map(x => personOf(x, z));
    return [
      {
        head: h,
        seat: HEAD_SEAT[h],
        ...(p ? { person: { ...personOf(p, z), limit: limitOf(db, s, h, p.skill) } } : {}),
        ...(d ? { deputy: { ...personOf(d, z), limit: limitOf(db, s, h, d.skill) } } : {}),
        ...(set === '' ? { none: true as const } : set !== undefined ? { set: true as const } : {}),
        now,
        can,
        full: FULL,
      },
    ];
  });
}

/**
 * Руководитель в карточке человека (Б5в): чей он руководитель — строка отдела; чей заместитель — отделы и решает ли он
 * сейчас за руководителя, «и. о.». Не руководитель и не заместитель — ничего.
 */
export function bossOfPerson(db: ContentDb, s: PlantState, p: Person): { boss?: BossRow; deputyFor?: { head: HeadId; acting: boolean; limit: BossLimit }[] } {
  const rows = bossRows(db, s);
  const n = num(p.id);
  const boss = rows.find(r => r.person?.n === n);
  const deputyFor = rows.filter(r => r.deputy?.n === n).map(r => ({ head: r.head, acting: r.now === 'io', limit: limitOf(db, s, r.head, p.skill) }));
  return { ...(boss ? { boss } : {}), ...(deputyFor.length > 0 ? { deputyFor } : {}) };
}

/**
 * Планёрка, «Руководители» (Б5в): отделы, где сегодня решает не руководитель, — в отпуске или должность свободна, — с тем,
 * кто замещает, и его навыком, или «некому решить». Все на месте — пусто.
 */
export function bossMeeting(db: ContentDb, s: PlantState): BossRow[] {
  return bossRows(db, s).filter(r => r.now !== 'head');
}
