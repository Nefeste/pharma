// Состояние завода и обмен с движком (docs/02-architecture.md, §1, §3, §7; docs/specs/2026-10-engine.md). Состояние —
// обычный сериализуемый объект: сохранение — его снимок со схемой и миграциями (ADR студии 0004). Сущности — словари с
// ключами-строками (`L12`, `U77`): обход идёт в порядке вставки, поэтому детерминирован.
import type { Attr, Id, ZoneKind } from '../content/types';
import type { Agenda } from './core/agenda';
import type { Ymd } from './core/calendar';
import type { RngState } from './core/rng';

/** Версия схемы сохранения. Изменился формат — шаг миграции (src/engine/save.ts) и образец в тестах. */
export const SCHEMA = 4;

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
  /** зарезервировано под серии, мг или шт.: свободно — остаток минус резерв */
  reserved?: number;
}

/**
 * Где стоит паллета. Пока её везут, она числится там, откуда взяли; место назначения зарезервировано задачей. В
 * помещении производства — пластиковая паллета с комплектом серии или балк: мест там нет.
 */
export type Where = { kind: 'slot'; id: string } | { kind: 'truck'; id: string } | { kind: 'room'; id: string };

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

/**
 * Отклонение (docs/04-data-model.md, §6): результат вне спецификации (`oos`), МОК вне пределов (`ipc`), режим вне
 * диапазона (`param`), выход ниже тревожного (`yield`).
 */
export interface Deviation {
  id: string;
  opened: number;
  kind: 'oos' | 'ipc' | 'param' | 'yield';
  lot?: string;
  batch?: string;
  /** стадия серии */
  stage?: string;
  /** испытания вне пределов; методика МОК; режим */
  tests?: string[];
  test?: Id;
  param?: string;
  status: 'open';
}

// ---------------------------------------------------------------- производство

/**
 * Помещение: чисто, занято серией или грязно (геймдизайн, §5.5). Чистота — у помещения целиком: уборка убирает и
 * оборудование в нём.
 */
export interface Room {
  id: string;
  type: string;
  status: 'clean' | 'busy' | 'dirty';
  batch?: string;
  /** с какого момента чисто или грязно */
  since: number;
  /** продукт последней серии */
  product?: Id;
  /** после малой уборки — чисто только для этого продукта; после большой — для любого */
  cleanFor?: Id;
  /** нужна большая уборка: другой продукт, грязно дольше суток или чистота просрочена */
  major?: boolean;
}

/** Оборудование из плана: занято серией, пока идёт её стадия. */
export interface Equipment {
  id: string;
  type: Id;
  room: string;
  batch?: string;
}

/** Строка комплекта серии: тара и сколько из неё отвесить, мг; у АФС — содержание, по которому считали навеску. */
export interface KitLine {
  container: string;
  lot: string;
  material: Id;
  qty: number;
  assay?: number;
}

/** Досье стадии: когда, кто, на чём, режимы, масса, МОК. */
export interface StageRecord {
  stage: string;
  room: string;
  start: number;
  end: number;
  people: string[];
  equipment: string[];
  /** фактические режимы в единицах движка */
  params: Record<string, number>;
  /** масса полупродукта на входе и на выходе и потери, мг */
  in: number;
  out: number;
  loss: number;
  ipc: { test: Id; t: number; result: number; pass: boolean }[];
}

/** Вклад причины в показатель серии: на сколько единиц движка сдвинут показатель и на какой стадии. */
export interface CauseHit {
  cause: Id;
  attr: Attr;
  delta: number;
  stage: string;
}

/**
 * Серия: `waiting` — не хватает материалов; `reserved` — материалы зарезервированы, ждёт даты и комплектации;
 * `kitting` — комплект едет к шлюзу; `process` — стадии по карте; `bulk` — балк сделан (его статус — у партии балка).
 */
export type BatchStatus = 'waiting' | 'reserved' | 'kitting' | 'process' | 'bulk';

export interface Batch {
  id: string;
  /** номер серии: год, месяц, порядковый — окно пишет «270901» */
  code: { y: number; m: number; n: number };
  recipe: Id;
  product: Id;
  /** не раньше, игровые секунды */
  notBefore: number;
  ordered: number;
  by: string;
  status: BatchStatus;
  /** чего не хватает, мг или шт., и при каком состоянии склада это посчитано (`next.stock`) */
  short?: { material: Id; qty: number }[];
  tried?: number;
  kit: KitLine[];
  /** пластиковая паллета комплекта */
  kitUnit?: string;
  /** номер следующей стадии карты */
  stage: number;
  /** где серия сейчас */
  room?: string;
  /** масса полупродукта, мг */
  mass: number;
  /** отвешено по строкам: партия, тара, сколько, у АФС — содержание, по которому считали */
  dispensed: KitLine[];
  records: StageRecord[];
  /** истинные показатели и причины — знает только движок (docs/02-architecture.md, §9) */
  truth: Partial<Record<Attr, number>>;
  /** разброс серии без причин */
  noise: Partial<Record<Attr, number>>;
  causes: CauseHit[];
  /** балк: партия полупродукта и сколько таблеток */
  bulk?: string;
  units?: number;
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
 * результата, решение по партии. Производство: паллета с комплектом серии к шлюзу, перекладка в шлюзе, возврат
 * остатков, стадия серии, уборка помещения.
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
  | 'decide'
  | 'pick'
  | 'transfer'
  | 'return'
  | 'stage'
  | 'clean';

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
  /** о какой партии, каком испытании, какой серии или каком помещении задача */
  lot?: string;
  test?: string;
  batch?: string;
  room?: string;
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
  | { kind: 'run'; test: string; v: number }
  /** подошла дата «не раньше» задания на серию */
  | { kind: 'batch'; id: string };

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
  /** помещения и оборудование по именам из плана */
  rooms: Record<string, Room>;
  equipment: Record<string, Equipment>;
  batches: Record<string, Batch>;
}

/** Команда — единственный способ изменить состояние (docs/02-architecture.md, §7). */
export type Command =
  /** течение времени */
  | { kind: 'advance'; seconds: number }
  /** заказ поставщику: количество — мг или шт., округляется вверх до целой тары */
  | { kind: 'po'; supplier: Id; lines: PoLine[]; by?: string }
  /** задание на серию по карте: не раньше — игровые секунды; нет — сейчас */
  | { kind: 'order'; recipe: Id; notBefore?: number; by?: string };

/** Почему команда не выполнена — для окна. */
export type Refusal = 'noSupplier' | 'notSold' | 'belowMoq' | 'empty' | 'noRecipe';

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
  /** серия сделана: балк в карантине */
  | { kind: 'batchBulk'; batch: string; lot: string }
  /** открыто отклонение производства: МОК, режим, выход */
  | { kind: 'deviation'; id: string }
  /** команда не выполнена */
  | { kind: 'refused'; cmd: Command['kind']; why: Refusal; detail?: string };
