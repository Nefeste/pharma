// Состояние завода и обмен с движком (docs/02-architecture.md, §1, §3, §7; docs/specs/2026-10-engine.md). Состояние —
// обычный сериализуемый объект: сохранение — его снимок со схемой и миграциями (ADR студии 0004). Сущности — словари с
// ключами-строками (`L12`, `U77`): обход идёт в порядке вставки, поэтому детерминирован.
import type { Id, ZoneKind } from '../content/types';
import type { Agenda } from './core/agenda';
import type { Ymd } from './core/calendar';
import type { RngState } from './core/rng';

/** Версия схемы сохранения. Изменился формат — шаг миграции (src/engine/save.ts) и образец в тестах. */
export const SCHEMA = 2;

// ---------------------------------------------------------------- склад

/** Статус партии (геймдизайн, §4.2); переходы — только по таблице src/engine/stock.ts. */
export type LotStatus = 'quarantine' | 'sampled' | 'testing' | 'released' | 'rejected' | 'blocked';

export interface Lot {
  id: string;
  material: Id;
  supplier: Id;
  /** номер партии изготовителя */
  vendorLot: string;
  /** внутренний номер: год и месяц приёмки, порядковый — окно пишет его как «П-2709-0001» */
  code: { y: number; m: number; n: number };
  /** принято, мг или шт. */
  qty: number;
  /** срок годности или повторных испытаний — номер дня от 1970-01-01 */
  expiry: number;
  status: LotStatus;
  /** когда принята, игровые секунды */
  received: number;
  po?: string;
  /** израсходовано в производство, отобрано в пробы, списано — для баланса масс */
  used: number;
  sampled: number;
  written: number;
}

export interface Container {
  id: string;
  lot: string;
  type: Id;
  /** остаток, мг или шт. */
  qty: number;
  /** на какой паллете */
  unit: string;
  opened: boolean;
}

/** Где стоит паллета. Пока её везут, она числится там, откуда взяли; место назначения зарезервировано задачей. */
export type Where = { kind: 'slot'; id: string } | { kind: 'truck'; id: string };

/** Ярлык статуса на паллете (src/render/loads.ts, Tag). */
export type Tag = 'quarantine' | 'sampled' | 'released' | 'rejected' | 'blocked';

export interface Unit {
  id: string;
  type: Id;
  where: Where;
  /** тара на паллете */
  items: string[];
  tag: Tag;
}

/** Занятость места: паллета и задача, которая держит место за собой. */
export interface SlotUse {
  unit?: string;
  held?: string;
}

// ---------------------------------------------------------------- закупки

export interface PoLine {
  material: Id;
  /** мг или шт., уже до целой тары */
  qty: number;
}

export interface Po {
  id: string;
  supplier: Id;
  lines: PoLine[];
  ordered: number;
  /** когда фура встанет к рампе */
  eta: number;
  status: 'ordered' | 'arrived';
  /** кто заказал: игрок или руководитель */
  by: string;
}

export interface Truck {
  id: string;
  dock: string;
  po: string;
  /** паллеты на фуре — ещё не снятые */
  units: string[];
  arrived: number;
  /** встала ли к рампе; иначе ждёт, пока рампа освободится */
  docked: boolean;
}

// ---------------------------------------------------------------- люди, техника, задачи

export interface Person {
  id: string;
  role: Id;
  shift: Id;
  /** навык 1–5 */
  skill: number;
  /** где сейчас, см */
  x: number;
  z: number;
  task?: string;
}

export interface Vehicle {
  id: string;
  type: Id;
  x: number;
  z: number;
  task?: string;
}

export type TaskKind = 'unload' | 'receive' | 'putaway';

/** Место задачи: место паллеты, рампа с фурой или точка. */
export type Place = { kind: 'slot'; id: string } | { kind: 'truck'; id: string } | { kind: 'point'; x: number; z: number };

export interface Task {
  id: string;
  kind: TaskKind;
  /** кто может: любая из ролей */
  roles: Id[];
  /** какая техника годится: любая из; нет — пешком */
  veh?: Id[];
  /** паллета, которую везут или принимают */
  unit?: string;
  /** откуда (для перевозки) или где работа */
  from: Place;
  /** куда везти: вид зоны — место выбирается при назначении */
  toKind?: ZoneKind | 'storage';
  /** выбранное место назначения */
  to?: string;
  /** работа на месте, с */
  work: number;
  /** больше — раньше */
  prio: number;
  /** сколько людей нужно */
  count: number;
  created: number;
  state: 'open' | 'busy';
  people: string[];
  vehicle?: string;
  /** времена для отрисовки: начало, у груза, отъезд с грузом, у места, конец */
  times?: [number, number, number, number, number];
  /** версия: событие конца задачи с другой версией ничего не делает */
  v: number;
}

// ---------------------------------------------------------------- состояние

/** События в очереди движка. */
export type PlantEvent =
  /** планёрка в 08:00: итог суток (геймдизайн, §2, §18) */
  | { kind: 'morning' }
  /** каждый час: начало и конец смен, задачи «не раньше» */
  | { kind: 'hour' }
  /** фура заказа встаёт к рампе */
  | { kind: 'truck'; po: string }
  /** конец задачи */
  | { kind: 'task'; id: string; v: number };

export interface PlantState {
  schema: number;
  /** отпечаток базы, с которой начата партия */
  content: string;
  scenario: Id;
  plant: Id;
  seed: number;
  /** ветви зерна по именам (src/engine/random.ts): своя ветвь у подсистемы и у вещи */
  rng: Record<string, RngState>;
  /** дата начала; `t` считается от её полуночи */
  start: Ymd;
  /** игровые секунды от полуночи даты начала */
  t: number;
  agenda: Agenda<PlantEvent>;
  /** время прошлой команды, ещё не прожитое (как в «Больнице»): следующая команда сначала доживает его */
  until?: number;
  /** сутки партии: сколько планёрок прошло */
  day: number;
  /** касса, копейки */
  cash: number;
  /** счётчики номеров по видам: `L` — партии, `U` — паллеты… */
  next: Record<string, number>;
  lots: Record<string, Lot>;
  containers: Record<string, Container>;
  units: Record<string, Unit>;
  slots: Record<string, SlotUse>;
  pos: Record<string, Po>;
  trucks: Record<string, Truck>;
  people: Record<string, Person>;
  vehicles: Record<string, Vehicle>;
  tasks: Record<string, Task>;
  /** открытые задачи по порядку раздачи: приоритет, время создания, номер */
  open: string[];
}

/** Команда — единственный способ изменить состояние (docs/02-architecture.md, §7). */
export type Command =
  /** течение времени */
  | { kind: 'advance'; seconds: number }
  /** заказ поставщику: количество — мг или шт., округляется вверх до целой тары */
  | { kind: 'po'; supplier: Id; lines: PoLine[]; by?: string };

/** Почему команда не выполнена — для окна. */
export type Refusal = 'noSupplier' | 'notSold' | 'belowMoq' | 'empty';

/** Извещение для окна: что случилось за время команды. */
export type Notice =
  /** планёрка: начались сутки `day` */
  | { kind: 'morning'; day: number }
  /** заказ поставщику принят */
  | { kind: 'ordered'; po: string; eta: number }
  /** фура встала к рампе */
  | { kind: 'truck'; po: string; truck: string }
  /** команда не выполнена */
  | { kind: 'refused'; cmd: Command['kind']; why: Refusal; detail?: string };
