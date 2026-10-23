// Места игрока (docs/specs/2026-10-panels.md, 3е; геймдизайн, §29.2–29.4): директор и четыре поста. Игрок берёт одно
// место или несколько из тех, что даёт сценарий; у каждого поста свои команды, чужая команда игрока — отказ с причиной.
// Работа отделов идёт по правилам движка, как раньше: место даёт команды и мерило. Журнал мест — кто и когда что держал:
// по нему считают итог поста за время на месте.
import { type ContentDb, type Dept, SEATS, type SeatId } from '../content/types';
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
  po: 'supply',
};

/** Пост отдела (Б4а): производство, линию и техслужбу ведёт «Производство», ОКК и ООК — «Качество», склад — «Снабжение и склад». */
export const DEPT_SEAT: Record<Dept, SeatId> = { mes: 'production', line: 'production', maint: 'production', qc: 'quality', qa: 'quality', wms: 'supply' };

/**
 * Пост команды: у политики отдела — пост этого отдела, у перевода на другой график (Б4б) — пост отдела человека (`dept`),
 * у остальных — по виду команды.
 */
export function ownerOf(cmd: Command, dept?: Dept): SeatId | undefined {
  if (cmd.kind === 'overtime') return DEPT_SEAT[cmd.dept];
  if (cmd.kind === 'roster') return dept && DEPT_SEAT[dept];
  return OWNER[cmd.kind];
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
  const who = cmd.kind === 'roster' ? s.people[cmd.person] : undefined;
  const own = ownerOf(cmd, who && db?.roles[who.role]?.dept);
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
  const log = (s.seats ??= []);
  for (const x of log) if (x.to === undefined && !want.has(x.seat)) x.to = s.t;
  for (const id of SEATS) if (want.has(id) && !log.some(x => x.seat === id && x.to === undefined)) log.push({ seat: id, from: s.t });
}
