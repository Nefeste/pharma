// Маршрут серии (Б7г; docs/specs/2026-10-vertical-slice.md, «Б7г»; геймдизайн, §5.4; решение владельца по #81): у стадии —
// единица главного класса (первого в списке оборудования карты), помещение стадии — то, где она стоит. Выбирает игрок
// командой `route`; без него — правило коллеги производства: помещение, где серия уже стоит, чистое для продукта, малая
// уборка, генеральная, порядок плана; негодная единица — последней. Выбор правила записан в маршрут и держится, пока
// единица есть и её помещение работает. Одна функция для движка, расписания и видов: состояние помещений — у того, кто
// спрашивает (`RoomAt`). Карту маршрут не меняет: тип помещения и класс — из карты.
import type { ContentDb, Id, RecipeStage } from '../content/types';
import { unfit } from './assets';
import { whoDecides } from './bosses';
import { modeOf, moot, propose } from './heads';
import { note, noteCmd } from './journal';
import { blocked } from './maint';
import { readyFor } from './mes';
import { planOf } from './plant';
import { roomDown } from './site/down';
import { transferTo } from './site/units';
import type { Batch, Command, Equipment, Notice, PlantState, Room, RouteWhy } from './types';

/** Состояние помещения по имени — движка или прогона расписания. */
export type RoomAt = (id: string) => Room | undefined;

/** Главный класс стадии — первый в списке оборудования карты: по нему выбирают единицу. */
export const mainClass = (st: RecipeStage): Id | undefined => st.equipment[0];

/** Ключ предложения руководителя о стадии серии (Б5б). */
export const routeKey = (b: string, k: number) => `route:${b}:${k}`;

/** Единицы главного класса стадии в помещениях её типа — по порядку плана. */
export function unitsFor(db: ContentDb, s: PlantState, st: RecipeStage): Equipment[] {
  const type = mainClass(st);
  if (!type) return [];
  const plant = planOf(db, s.plan).plant;
  const rooms = new Set(plant.rooms.filter(r => r.type === st.room).map(r => r.id));
  const order = new Map(plant.equipment.map((e, i) => [e.id, i]));
  return Object.values(s.equipment)
    .filter(e => e.type === type && rooms.has(e.room))
    .sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
}

/**
 * Ступень единицы для серии в мгновение `t`: 0 — серия уже в её помещении, 1 — помещение чистое для продукта, 2 — нужна
 * малая уборка, 3 — генеральная (чисто или грязно после другого продукта), 4 — помещение держит другая серия, 5 — единица
 * в ремонте или без записи в силе.
 */
export function rankOf(db: ContentDb, s: PlantState, b: Batch, e: Equipment, roomAt: RoomAt, t: number): number {
  if (blocked(s, e.id) || unfit(db, s, e.id)) return 5;
  const room = roomAt(e.room);
  if (!room) return 5;
  if (room.batch === b.id) return 0;
  if (room.batch) return 4;
  const other = (room.cleanFor !== undefined && room.cleanFor !== b.product) || (room.status === 'dirty' && room.product !== undefined && room.product !== b.product) || room.major;
  if (readyFor(room, b.product, t)) return 1;
  return other ? 3 : 2;
}

/** Выбор правила: лучшая по ступени и порядку плана единица в помещении, которое работает; почему — ступени всех. */
export function pickUnit(db: ContentDb, s: PlantState, b: Batch, k: number, roomAt: RoomAt = id => s.rooms[id], t = s.t): { unit: Equipment; why: RouteWhy; n: number } | undefined {
  const st = db.recipes[b.recipe].stages[k];
  if (!st) return undefined;
  const all = unitsFor(db, s, st).filter(e => !roomDown(db, s, e.room));
  if (all.length === 0) return undefined;
  const ranked = all.map(e => ({ e, rank: rankOf(db, s, b, e, roomAt, t) }));
  let best = ranked[0];
  for (const x of ranked) if (x.rank < best.rank) best = x;
  return { unit: best.e, why: { rank: best.rank, others: ranked.filter(x => x !== best).map(x => ({ unit: x.e.id, rank: x.rank })) }, n: all.length };
}

/** Шаг маршрута ещё годен: единица есть, она главного класса стадии и её помещение работает. */
function stepOk(db: ContentDb, s: PlantState, b: Batch, k: number): Equipment | undefined {
  const step = b.route?.[k];
  const e = step ? s.equipment[step.unit] : undefined;
  const st = db.recipes[b.recipe].stages[k];
  return e && st && e.type === mainClass(st) && planOf(db, s.plan).room[e.room]?.type === st.room && !roomDown(db, s, e.room) ? e : undefined;
}

/**
 * Помещение стадии `k` серии, ничего не записывая: по маршруту, иначе — что выбрало бы правило сейчас, иначе — первое
 * помещение типа (единиц класса нет: стадия будет ждать, как раньше).
 */
export function stageRoom(db: ContentDb, s: PlantState, b: Batch, k: number, roomAt?: RoomAt, t?: number): string | undefined {
  const st = db.recipes[b.recipe].stages[k];
  if (!st) return undefined;
  const e = stepOk(db, s, b, k) ?? pickUnit(db, s, b, k, roomAt, t)?.unit;
  return e?.room ?? planOf(db, s.plan).roomOf[st.room];
}

/**
 * Единица стадии `k`, когда стадия становится следующей (движок): маршрут годен — она; иначе правило. Единица одна —
 * выбирать нечего: маршрут без записи журнала. Больше одной: режим начальника производства (Б5б) «сам» — выбор и запись
 * журнала; «советует» — предложение с командой `route`, серия ждёт ответа; «вручную» — ждёт выбора игрока. Нет единиц
 * класса — первое помещение типа, как до Б7г. Ждёт — `undefined`.
 */
export function chooseRoom(db: ContentDb, s: PlantState, b: Batch, k: number, notices: Notice[] = []): string | undefined {
  const st = db.recipes[b.recipe].stages[k];
  const ok = stepOk(db, s, b, k);
  if (ok) return ok.room;
  if (b.route?.[k]) delete b.route[k];
  const got = pickUnit(db, s, b, k);
  if (!got) return planOf(db, s.plan).roomOf[st.room];
  const set = () => {
    b.route = { ...(b.route ?? {}), [k]: { unit: got.unit.id, by: 'rule' } };
    return got.unit.room;
  };
  if (got.n === 1) return set();
  const mode = modeOf(s, 'mes');
  const key = routeKey(b.id, k);
  const d = { kind: 'route' as const, batch: b.id, stage: st.id, unit: got.unit.id, why: got.why };
  if (mode === 'advise') {
    propose(s, 'mes', key, { kind: 'route', batch: b.id, stage: k, unit: got.unit.id }, d, notices, undefined, whoDecides(db, s, 'mes'));
    return undefined;
  }
  if (mode === 'manual') return undefined;
  // правило маршрута — работа смены, как начало стадии: решает в любой час; запись — того, кто решает сейчас, или
  // должности
  note(s, 'mes', d, undefined, undefined, whoDecides(db, s, 'mes'));
  return set();
}

/**
 * Команда `route` (Б7г) места производства или директора: у стадии, которая ещё не началась и к которой полупродукт ещё
 * не везут, — единица главного класса стадии в помещении её типа, которое работает; без единицы — снять выбор игрока.
 * Отказы: нет задания, оно отменено или стадии нет; стадия идёт или кончилась; единица не та; её помещение не работает.
 */
export function routeCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'route' }>, notices: Notice[], after: (b: Batch) => void) {
  const b = s.batches[cmd.batch];
  if (!b || b.status === 'cancelled') return notices.push({ kind: 'refused', cmd: 'route', why: 'noBatch', detail: cmd.batch });
  const st = db.recipes[b.recipe].stages[cmd.stage];
  if (!st) return notices.push({ kind: 'refused', cmd: 'route', why: 'noBatch', detail: cmd.batch });
  const late = ['bulk', 'packing', 'fg', 'released', 'rejected'].includes(b.status);
  const going = Object.values(s.tasks).some(t => t.batch === b.id && (t.kind === 'stage' || t.kind === 'carry')) || b.run !== undefined;
  const kitted = cmd.stage === 0 && b.status === 'kitting';
  if (late || kitted || cmd.stage < b.stage || (cmd.stage === b.stage && going)) return notices.push({ kind: 'refused', cmd: 'route', why: 'started', detail: cmd.batch });
  if (cmd.unit === undefined) {
    if (b.route?.[cmd.stage]?.by === 'you') delete b.route[cmd.stage];
  } else {
    const e = s.equipment[cmd.unit];
    if (!e || e.type !== mainClass(st) || planOf(db, s.plan).room[e.room]?.type !== st.room) return notices.push({ kind: 'refused', cmd: 'route', why: 'notUnit', detail: cmd.unit });
    if (roomDown(db, s, e.room)) return notices.push({ kind: 'refused', cmd: 'route', why: 'unitDown', detail: cmd.unit });
    b.route = { ...(b.route ?? {}), [cmd.stage]: { unit: e.id, by: 'you' } };
  }
  moot(s, routeKey(b.id, cmd.stage));
  noteCmd(s, cmd, { kind: 'route', batch: b.id, stage: st.id, ...(cmd.unit ? { unit: cmd.unit } : {}) });
  after(b);
}

/**
 * Годная вакуумная перегрузка из помещения `from` в `to` (Б7г, шаг 2): класс с перегрузкой стоит в `from` у стены с
 * `to`, у неё запись квалификации в силе и нет подрядчика (`unfit`), и она не занята другой серией. Нет — `undefined`:
 * полупродукт везут на тележке.
 */
export function transferVia(db: ContentDb, s: PlantState, from: string, to: string): Equipment | undefined {
  const plant = planOf(db, s.plan).plant;
  for (const e of plant.equipment) {
    if (e.room !== from || !db.equipment[e.type]?.transfer) continue;
    if (transferTo(db, plant, e.type, e.room, e.at, e.turn) !== to) continue;
    if (unfit(db, s, e.id) || s.equipment[e.id]?.batch) continue;
    return s.equipment[e.id];
  }
  return undefined;
}

/** Время перегрузки массы `mass`, мг, единицей класса `type`, с: масса на производительность, вверх до секунды. */
export function transferTime(db: ContentDb, type: Id, mass: number): number {
  const tr = db.equipment[type].transfer!;
  return Math.ceil((mass * 3600) / tr.rate);
}
