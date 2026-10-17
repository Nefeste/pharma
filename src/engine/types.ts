// Состояние завода и обмен с движком (docs/02-architecture.md, §1, §3, §7; docs/specs/2026-10-engine.md). Состояние —
// обычный сериализуемый объект: сохранение — его снимок со схемой и миграциями (ADR студии 0004). Сущности — словари с
// ключами-строками (`L12`, `U77`): обход идёт в порядке вставки, поэтому детерминирован.
import type { Attr, Id, ZoneKind } from '../content/types';
import type { Agenda } from './core/agenda';
import type { Ymd } from './core/calendar';
import type { RngState } from './core/rng';

/** Версия схемы сохранения. Изменился формат — шаг миграции (src/engine/save.ts) и образец в тестах. */
export const SCHEMA = 3;

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
  /**
   * истинные свойства, доли 1/10 000 (src/content/types.ts, `Attr`). Их знает только движок: в окно они не уходят
   * (docs/02-architecture.md, §9) — окно видит паспорт и результаты лаборатории
   */
  truth: Partial<Record<Attr, number>>;
  /** свойства по паспорту изготовителя */
  coa: Partial<Record<Attr, number>>;
  /** пробы входного контроля */
  sample?: string;
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

// ---------------------------------------------------------------- лаборатория

/** Пробы партии по плану отбора (docs/specs/2026-10-engine.md, 1б). */
export interface Sample {
  id: string;
  lot: string;
  /** тара из плана отбора */
  plan: string[];
  /** паллеты, с тары которых пробы ещё не отобраны */
  left: string[];
  /** отобрано всего, мг или шт.: списано с тары */
  qty: number;
  /** когда отобрана последняя проба */
  taken?: number;
  /** испытания по спецификации — заводятся, когда пробы приняты в лаборатории */
  tests: string[];
}

/**
 * Испытание пробы по методике. `queued` — ждёт аналитика и прибор; `prep` — аналитик готовит (а у методики без
 * самостоятельной работы прибора — и ведёт её); `run` — прибор работает сам; `review` — результат ждёт проверки вторым
 * лицом; `done` — результат готов.
 */
export interface LabTest {
  id: string;
  sample: string;
  /** методика (`content/tests/`) */
  method: Id;
  state: 'queued' | 'prep' | 'run' | 'review' | 'done';
  /** пределы спецификации на день испытания, доли 1/10 000; нет обоих — качественное свойство */
  min?: number;
  max?: number;
  /** прибор, аналитик и тот, кто проверил */
  inst?: string;
  by?: string;
  checker?: string;
  /** измерено, доли 1/10 000; окно видит его, когда испытание `done` */
  result?: number;
  /** в пределах спецификации — после проверки */
  pass?: boolean;
  /** версия: событие конца работы прибора с другой версией ничего не делает */
  v: number;
}

/** Прибор лаборатории из плана завода; занят испытанием с начала подготовки до конца своей работы. */
export interface Instrument {
  id: string;
  type: Id;
  room: string;
  test?: string;
}

/** Отклонение (docs/04-data-model.md, §6): в 1б — результат вне спецификации при входном контроле. */
export interface Deviation {
  id: string;
  opened: number;
  kind: 'oos';
  lot: string;
  /** испытания вне пределов */
  tests: string[];
  status: 'open';
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

/**
 * Виды задач. Склад: разгрузка, приёмка, размещение (в карантин или на стеллаж), перемещение (в зону отклонённого).
 * Лаборатория: паллета в пробоотборную и обратно, отбор проб, передача проб в лабораторию, испытание, проверка
 * результата, решение по партии.
 */
export type TaskKind =
  | 'unload'
  | 'receive'
  | 'putaway'
  | 'move'
  | 'toSampling'
  | 'sample'
  | 'fromSampling'
  | 'handover'
  | 'prep'
  | 'review'
  | 'decide';

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
  /** место назначения выбирать ближе к этой точке; нет — ближе к началу задачи */
  near?: { x: number; z: number };
  /** нужен свободный прибор одного из видов: он занят испытанием `test` с начала задачи */
  inst?: Id[];
  /** выбранный прибор */
  instrument?: string;
  /** кому задачу не давать: проверяет не тот, кто делал */
  not?: string[];
  /** о какой партии или каком испытании задача */
  lot?: string;
  test?: string;
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
  | { kind: 'task'; id: string; v: number }
  /** прибор кончил работать сам: результат испытания */
  | { kind: 'run'; test: string; v: number };

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
  /** приборы лаборатории по имени из плана */
  instruments: Record<string, Instrument>;
  samples: Record<string, Sample>;
  tests: Record<string, LabTest>;
  deviations: Record<string, Deviation>;
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
  /** партия разрешена: все испытания в пределах */
  | { kind: 'lotReleased'; lot: string }
  /** партия отклонена: испытания вне пределов, открыто отклонение */
  | { kind: 'lotRejected'; lot: string; deviation: string }
  /** команда не выполнена */
  | { kind: 'refused'; cmd: Command['kind']; why: Refusal; detail?: string };
