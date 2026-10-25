// Места игрока (docs/specs/2026-10-panels.md, 3е; геймдизайн, §29.2–29.4): директор и четыре поста. Игрок берёт одно
// место или несколько из тех, что даёт сценарий; у каждого поста свои команды, чужая команда игрока — отказ с причиной.
// Работа отделов идёт по правилам движка, как раньше: место даёт команды и мерило. Журнал мест — кто и когда что держал:
// по нему считают итог поста за время на месте.
import { type ContentDb, type Dept, SEATS, type SeatId } from '../content/types';
import { colleagueTargets } from './modes';
import type { Command, Notice, PlantState } from './types';

/** Чья команда — пост, к которому она относится; ход времени и выбор места — ничьи; политика отдела — пост отдела. */
export const OWNER: Partial<Record<Command['kind'], SeatId>> = {
  order: 'production',
  shift: 'production',
  pack: 'production',
  maintain: 'production',
  rush: 'quality',
  release: 'quality',
  investigate: 'quality',
  conclude: 'quality',
  assess: 'quality',
  setpoint: 'quality',
  po: 'supply',
};

/** Пост отдела (Б4а): производство, линию и техслужбу ведёт «Производство», ОКК и ООК — «Качество», склад — «Снабжение и склад». */
export const DEPT_SEAT: Record<Dept, SeatId> = { mes: 'production', line: 'production', maint: 'production', qc: 'quality', qa: 'quality', wms: 'supply' };

/**
 * Пост команды: у политики отдела — пост этого отдела, у перевода на другой график (Б4б), команд найма и увольнения (Б4в),
 * частей отпуска и смежной профессии (Б4г) — пост отдела роли (`dept`), у остальных — по виду команды.
 */
export function ownerOf(cmd: Command, dept?: Dept): SeatId | undefined {
  if (cmd.kind === 'overtime') return DEPT_SEAT[cmd.dept];
  if (cmd.kind === 'roster' || cmd.kind === 'vacancy' || cmd.kind === 'close' || cmd.kind === 'hire' || cmd.kind === 'dismiss' || cmd.kind === 'leave' || cmd.kind === 'also') return dept && DEPT_SEAT[dept];
  return OWNER[cmd.kind];
}

/** Роль, о которой команда найма (Б4в), перевода (Б4б) или отпуска (Б4г): её отдел — чей пост. */
function roleOf(s: PlantState, cmd: Command): string | undefined {
  switch (cmd.kind) {
    case 'roster':
    case 'dismiss':
    case 'leave':
    case 'also':
      return s.people[cmd.person]?.role;
    case 'vacancy':
      return cmd.role;
    case 'close':
      return s.vacancies[cmd.vacancy]?.role;
    case 'hire':
      return s.candidates[cmd.candidate]?.role;
    default:
      return undefined;
  }
}

/**
 * Держит ли игрок пост отдела `dept` (или директора) — тогда коллега этого поста ждёт его решений (Б4в); места не
 * выбраны — ведут коллеги.
 */
export function playerHolds(s: PlantState, dept: Dept): boolean {
  const h = held(s);
  return !!h && (h.includes('director') || h.includes(DEPT_SEAT[dept]));
}

/** Места, которые игрок держит сейчас; ещё не выбирал — `undefined`. */
export function held(s: PlantState): SeatId[] | undefined {
  return s.seats?.filter(x => x.to === undefined).map(x => x.seat);
}

/**
 * Чьё место нужно, чтобы игрок отдал команду, если сейчас оно не его; можно — `undefined`. Ничья команда — можно всегда;
 * места не выбраны — можно всё, как до 3е; директор в прототипе отвечает за всё. Команды сценария и коллег не проверяются.
 */
export function foreign(s: PlantState, cmd: Command, db?: ContentDb): SeatId | undefined {
  const role = roleOf(s, cmd);
  const own = ownerOf(cmd, role ? db?.roles[role]?.dept : undefined);
  if (!own || ('by' in cmd && cmd.by !== undefined && cmd.by !== 'player')) return undefined;
  const h = held(s);
  return !h || h.includes('director') || h.includes(own) ? undefined : own;
}

/**
 * Команда «место»: набор мест игрока целиком. Записи мест, которых в наборе нет, закрываются этой минутой; новые
 * открываются в порядке мест; то же место — та же запись. Отказы: пустой набор, место, которого сценарий не даёт.
 */
export function seatCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'seat' }>, notices: Notice[]) {
  const want = new Set(cmd.seats);
  if (want.size === 0) return notices.push({ kind: 'refused', cmd: 'seat', why: 'empty' });
  const offered = db.scenarios[s.scenario].seats;
  const bad = [...want].find(x => !SEATS.includes(x) || !offered.includes(x));
  if (bad) return notices.push({ kind: 'refused', cmd: 'seat', why: 'noSeat', detail: bad });
  const had = playerHolds(s, 'qa');
  const log = (s.seats ??= []);
  for (const x of log) if (x.to === undefined && !want.has(x.seat)) x.to = s.t;
  for (const id of SEATS) if (want.has(id) && !log.some(x => x.seat === id && x.to === undefined)) log.push({ seat: id, from: s.t });
  // игрок ушёл с поста «Качество и технология» — коллега технологии держит цель (Б1ж)
  if (had && !playerHolds(s, 'qa')) colleagueTargets(s, notices);
}
