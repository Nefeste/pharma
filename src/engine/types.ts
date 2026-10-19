// Состояние завода и обмен с движком (docs/02-architecture.md, §1, §3, §7; docs/specs/2026-10-engine.md). Состояние —
// обычный сериализуемый объект: сохранение — его снимок со схемой и миграциями (ADR студии 0004). Сущности — словари с
// ключами-строками (`L12`, `U77`): обход идёт в порядке вставки, поэтому детерминирован.
import type { Attr, Dept, Id, IncidentRoot, SeatId, ZoneKind } from '../content/types';
import type { Agenda } from './core/agenda';
import type { Ymd } from './core/calendar';
import type { RngState } from './core/rng';

/** Версия схемы сохранения. Изменился формат — шаг миграции (src/engine/save.ts) и образец в тестах. */
export const SCHEMA = 14;

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
  /** поднята игроком (3г): задачи лаборатории партии — выше таких же задач других партий */
  rush?: true;
  /**
   * в нынешнем статусе с этого мгновения (3б, карточка вещи): у разрешённой и отклонённой — мгновение решения. В
   * сохранениях до схемы 10 нет
   */
  since?: number;
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
  /** своя продукция — балк или готовая: серия, из которой она */
  batch?: string;
  /** отгружено покупателям, шт. — для баланса */
  shipped?: number;
  /** готовая продукция: в обороте с этого момента — Росздравнадзор опубликовал сведения о серии */
  circulation?: number;
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
  /** гофроящик ГП: коды пачек отрезками [первый, сколько] и когда ящик уложен */
  codes?: [number, number][];
  made?: number;
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
  /** паллета заказа в экспедиции: ящики разных серий и позиций одного заказа */
  order?: string;
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
  /** когда результат готов — проверен вторым лицом (3б, история партии); в сохранениях до схемы 10 нет */
  done?: number;
  /** версия: событие конца работы прибора с другой версией ничего не делает */
  v: number;
  /** испытание шага расследования (часть 4): в решение по партии не входит */
  inv?: string;
  /** результат признан недействительным: расследование установило ошибку лаборатории */
  invalid?: true;
  /**
   * в записи испытания (часть 4): ошибка пересчёта, исказившая результат, или описка, которая на результат не влияет; её
   * находит проверка записей
   */
  mark?: 'calc' | 'typo';
}

/** Чем прибор растворения не прошёл проверку (часть 4). */
export type InstrumentFault = 'height' | 'centering' | 'deaeration' | 'vibration' | 'overdue';
export const INSTRUMENT_FAULTS: readonly InstrumentFault[] = ['height', 'centering', 'deaeration', 'vibration'];

/** Прибор лаборатории из плана завода; занят испытанием с начала подготовки до конца своей работы. */
export interface Instrument {
  id: string;
  type: Id;
  room: string;
  test?: string;
  /**
   * прибор не прошёл проверку (часть 4) — её находит проверка прибора: высота лопасти, центровка вала, среда не
   * деаэрирована, вибрация (`gf-15`, ОФС.1.4.2.0014; `fda-diss-mc`) или просрочена механическая калибровка, на результат
   * не повлиявшая
   */
  check?: InstrumentFault;
}

/**
 * Отклонение (docs/04-data-model.md, §6): результат вне спецификации (`oos`), МОК вне пределов (`ipc`), режим вне
 * диапазона (`param`), выход ниже тревожного (`yield`), расхождение при сверке печатных материалов (`recon`).
 */
export interface Deviation {
  id: string;
  opened: number;
  kind: 'oos' | 'ipc' | 'param' | 'yield' | 'recon';
  lot?: string;
  batch?: string;
  /** стадия серии */
  stage?: string;
  /** испытания вне пределов; методика МОК; режим; материал сверки */
  tests?: string[];
  test?: Id;
  param?: string;
  material?: Id;
  /**
   * `assessed` — уполномоченное лицо оценило отклонение «без влияния на качество» и выпустило серию; `closed` —
   * расследование решило (часть 4): его отклонение, а если серию отклонили — и другие открытые отклонения серии
   */
  status: 'open' | 'assessed' | 'closed';
  /** расследование результата вне спецификации */
  inv?: string;
}

/**
 * Происшествие прототипа (docs/specs/2026-10-investigation.md, «Происшествие») — скрытые поля: корень, величина
 * неисправности, что вызвало брошенные улики (корень или фон), сито крупнее карты на столько мкм, пока его не поменяли.
 * Окно и двойник прогона плана их не знают; разбор открывает их после решения.
 */
export interface Incident {
  batch: string;
  inv: Id;
  root: IncidentRoot;
  size: number;
  fired: Record<string, IncidentRoot | 'leak'>;
  screen?: number;
}

/** Что шаг показал об улике (может быть ошибкой шага), когда; числа из записей для слов — в единицах движка. */
export interface InvObs {
  f: string;
  step: string;
  shown: boolean;
  t: number;
  data?: number[];
}

/** Шаг расследования: с и по; задача или испытание; кто попросил. */
export interface InvRun {
  step: string;
  from: number;
  to?: number;
  task?: string;
  test?: string;
  by: string;
}

/**
 * Расследование результата вне спецификации (часть 4): модель, отклонение, серия, партия, испытание; шаги и улики;
 * решение — причина и судьба серии. `truth` — скрытое: корень, что вызвало брошенные улики и была ли улика на самом деле,
 * когда шаг на неё смотрел; окно видит его только в разборе.
 */
export interface Investigation {
  id: string;
  model: Id;
  deviation: string;
  batch: string;
  lot: string;
  test: string;
  opened: number;
  runs: InvRun[];
  obs: InvObs[];
  status: 'open' | 'closed';
  conclusion?: { cause: string; fate: 'reject' | 'release'; by: string; t: number };
  truth: { root: string; fired: Record<string, string>; present?: Record<string, boolean> };
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

/** Досье стадии: когда, кто, на чём, режимы, масса, МОК; у стадии с узлами — средний износ и простои после отказов. */
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
  /** средний износ узла за стадию по таблеткам, доли 1/10 000: `<машина>/<узел>` → износ */
  wear?: Record<string, number>;
  /** простои: отказ узла — и когда аппаратчик снова начал работу */
  stops?: { part: string; from: number; to: number }[];
}

/**
 * Стадия с узлами под износом, пока идёт (docs/specs/2026-10-engine.md, 1е): начало, таблеток на стадию и осталось,
 * сумма «таблеток × (износ в начале + износ в конце отрезка)» по узлам — для среднего износа, простои, кто работал.
 * Отрезок — от начала работы аппаратчика до отказа или конца: прессуют с `from` по конец задачи. После отказа — остаток
 * работы, с.
 */
export interface StageRun {
  start: number;
  units: number;
  left: number;
  wear: Record<string, number>;
  stops: { part: string; from: number; to?: number }[];
  people: string[];
  from?: number;
  rest?: number;
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
 * `kitting` — комплект едет к шлюзу; `process` — стадии по карте; `bulk` — балк сделан (его статус — у партии балка);
 * `packing` — задание на упаковку; `fg` — упакована, ГП в карантине до решения уполномоченного лица; `released` —
 * выпущена; `rejected` — отклонена (балк или ГП).
 */
export type BatchStatus = 'waiting' | 'reserved' | 'kitting' | 'process' | 'bulk' | 'packing' | 'fg' | 'released' | 'rejected';

/**
 * Чем занято время серии (геймдизайн, §5.4): ждёт своей даты; нет материалов; комплектация; стадия ждёт людей;
 * помещение занято другой серией; уборка; оборудование занято другой серией; ремонт; идёт стадия; балк на испытаниях;
 * упаковка ждёт линию; линия упаковывает; ГП ждёт проверки и решения; до миграции сохранения — неизвестно.
 */
export type BatchPhase =
  | 'plan'
  | 'materials'
  | 'kitting'
  | 'people'
  | 'room'
  | 'cleaning'
  | 'equipment'
  | 'repair'
  | 'work'
  | 'lab'
  | 'line'
  | 'packing'
  | 'decision'
  | 'before';

/**
 * Состояние машины линии на отрезке (для OEE): на номинале, медленнее, микроостановка, авария (отказ узла — до конца
 * ремонта), ждёт соседа, наладка, вне смены, без задания.
 */
export type MachineState = 'run' | 'slow' | 'micro' | 'fail' | 'wait' | 'setup' | 'off' | 'idle';

/**
 * Время машины за задание по состояниям, с, и проход — шестидесятые доли таблетки (docs/specs/2026-10-engine.md, 1г).
 * `slowOut` — проход в состоянии «медленнее»: проход = номинал × `run` + `slowOut`.
 */
export interface MachineTimes {
  run: number;
  slow: number;
  micro: number;
  fail: number;
  wait: number;
  setup: number;
  off: number;
  out: number;
  slowOut: number;
}

/** Машина линии: позиция — сколько таблеток прошло через неё за задание, шестидесятые доли; скорость — таких долей в секунду. */
export interface LineMachine {
  id: string;
  type: Id;
  pos: number;
  rate: number;
  state: MachineState;
  /** микроостановка — до этого момента; следующая — на этой позиции */
  down?: number;
  next: number;
  /** отказ узла — на этой позиции (знает только движок); авария — отказал и ждёт ремонта */
  fail?: number;
  broken?: boolean;
  times: MachineTimes;
}

/** Упаковочная линия (docs/specs/2026-10-engine.md, 1г): формат, очистка, серия на линии, машины, паллета ГП, время потока. */
export interface Line {
  id: string;
  /** формат, на который налажена; нет — не налажена */
  format?: string;
  /** очищена после прошлой серии и проверена мастером */
  clear: boolean;
  batch?: string;
  machines: LineMachine[];
  /** паллета ГП, которую собирают, и сколько ящиков уложено за задание */
  pallet?: string;
  cases: number;
  /** до какого момента посчитан поток; версия событий линии */
  t: number;
  v: number;
  /** без задания, с */
  idle: number;
  /** годных пачек: за прошлые задания и за нынешнее — для выпуска смен */
  packs: number;
  made: number;
}

/** Сверка материала после упаковки: выдано = использовано + испорчено + возвращено (шт. или мг). */
export interface Recon {
  material: Id;
  issued: number;
  used: number;
  spoiled: number;
  returned: number;
}

/**
 * Задание на упаковку серии: `waiting` — не хватает материалов; `reserved` — зарезервированы; `kitting` — комплект едет
 * к шлюзу; `ready` — комплект у линии; `running` — линия упаковывает; `done` — упаковано.
 */
export interface PackJob {
  sku: Id;
  line: string;
  state: 'waiting' | 'reserved' | 'kitting' | 'ready' | 'running' | 'done';
  created: number;
  short?: { material: Id; qty: number }[];
  tried?: number;
  kit: KitLine[];
  kitUnit?: string;
  /** списано на серию по факту: тара, партия, сколько */
  used: KitLine[];
  /** таблеток к упаковке — весь остаток балка; годных пачек из них при браке камер — для сменного задания */
  tablets: number;
  expect?: number;
  /** партия ГП */
  fg?: string;
  /** когда линия взяла задание, пошла первая таблетка, упаковка кончилась */
  taken?: number;
  start?: number;
  end?: number;
  /** сколько пачек камера картонажной уже проверила: коды выбракованных — в `rejected` */
  checked: number;
  /** коды пачек: брак камеры, архивные образцы */
  rejected: number[];
  retained: number[];
  /** итог: блистеров сделано и в браке, пачек сделано и в браке, ящиков, таблеток в браке и в остатке */
  blisters?: number;
  blisterRejects?: number;
  cartons?: number;
  cartonRejects?: number;
  cases?: number;
  scrap?: number;
  remainder?: number;
  /**
   * заминки картонажной: сколько, сколько пачек испорчено и сколько из них не записано — расхождение сверки; последнее
   * знает только движок
   */
  jams?: number;
  jammed?: number;
  lost?: number;
  recon?: Recon[];
  /** OEE машин за задание: номинал (долей в секунду) и время по состояниям */
  oee?: { machine: string; nominal: number; times: MachineTimes }[];
}

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
  /** сито калибратора крупнее карты на столько мкм на калибровке этой серии (часть 4) — скрытое: в записи — сито по карте */
  screen?: number;
  /** балк: партия полупродукта и сколько таблеток */
  bulk?: string;
  units?: number;
  /** в какую позицию упаковать балк; задание на упаковку */
  sku?: Id;
  pack?: PackJob;
  /** стадия с узлами под износом, пока идёт */
  run?: StageRun;
  /** время серии по состояниям, с (docs/specs/2026-10-engine.md, 1ж); нынешнее состояние и с какого момента */
  spent: Partial<Record<BatchPhase, number>>;
  phase?: BatchPhase;
  phaseAt: number;
  /** проверка ООК кончилась; решение игрока для уполномоченного лица; держит ли УЛ серию; когда выпущена */
  checked?: number;
  decision?: 'release' | 'reject' | 'hold';
  held?: boolean;
  released?: number;
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
  /** сумма с НДС и НДС в ней; предоплата, копейки */
  sum?: number;
  vat?: number;
  prepaid?: number;
}

export interface Truck {
  id: string;
  dock: string;
  /** фура поставщика по заказу или фура покупателя за отгрузкой */
  po?: string;
  customer?: Id;
  /** паллеты на фуре — ещё не снятые */
  units: string[];
  arrived: number;
  /** встала ли к рампе; иначе ждёт, пока рампа освободится */
  docked: boolean;
  /**
   * кузов открыт: фура поставщика прошла проверку у рампы, фура покупателя встала к рампе (docs/specs/2026-10-panels.md,
   * 3а); до того и когда фура уходит — закрыт
   */
  open: boolean;
}

// ---------------------------------------------------------------- люди, техника, задачи

export interface Person {
  id: string;
  role: Id;
  shift: Id;
  /** навык 1–5 */
  skill: number;
  /** где сейчас, см; в пути на пост или к выходу — куда идёт */
  x: number;
  z: number;
  task?: string;
  /**
   * идёт без задачи на пост своей роли или к выходу (docs/specs/2026-10-panels.md, 3а): откуда, см, и с какого мгновения;
   * где он сейчас — точка маршрута (`here`, staff.ts)
   */
  walk?: { x: number; z: number; t: number };
}

export interface Vehicle {
  id: string;
  type: Id;
  x: number;
  z: number;
  task?: string;
}

/**
 * Виды задач. Склад: проверка фуры у рампы, разгрузка, приёмка, размещение (в карантин или на стеллаж), перемещение (в
 * зону отклонённого).
 * Лаборатория: паллета в пробоотборную и обратно, отбор проб, передача проб в лабораторию, испытание, проверка
 * результата, решение по партии. Производство: паллета с комплектом серии к шлюзу, перекладка в шлюзе, возврат
 * остатков, стадия серии, уборка помещения. Линия: смена у линии, переналадка, очистка линии и её проверка, балк к
 * линии. Качество: проверка ГП и досье, решение уполномоченного лица. Отгрузка: паллета в экспедицию, отбор ящиков на
 * паллету заказа, погрузка в фуру покупателя. Техслужба: ремонт после отказа или замена узла по плану.
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
  | 'clean'
  | 'crew'
  | 'changeover'
  | 'clearance'
  | 'clearCheck'
  | 'feed'
  | 'fgCheck'
  | 'qpDecide'
  | 'ship'
  | 'casePick'
  | 'load'
  | 'repair'
  | 'truckCheck'
  /** шаг расследования (часть 4); замена сита калибратора по решению расследования */
  | 'invStep'
  | 'invFix';

/**
 * Почему задача ждёт (1ж): люди её ролей в смене, но заняты; людей её ролей нет в смене; нет свободной техники; нет
 * свободного прибора; нет свободного места назначения. В потерях суток есть ещё ожидание фуры: рампа занята (3а) — это
 * ждёт не задача, а фура во дворе.
 */
export type WaitCause = 'people' | 'shift' | 'vehicle' | 'instrument' | 'place' | 'dock';

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
  line?: string;
  /** заказ покупателя; ящики к отбору; паллета заказа, на которую их кладут; фура, в которую грузят */
  order?: string;
  cases?: string[];
  dest?: string;
  truck?: string;
  /** узел, который чинят или меняют; замена по плану, а не после отказа */
  part?: string;
  planned?: boolean;
  /** расследование и его шаг (часть 4) */
  inv?: string;
  step?: string;
  /** когда люди дошли и начали работу — событие `begin` (стадия с узлами под износом) */
  begin?: boolean;
  /** открытая задача: чего ждёт по последнему проходу раздатчика и с какого момента (1ж) */
  why?: WaitCause;
  since?: number;
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
  | { kind: 'batch'; id: string }
  /** граница потока линии: накопитель, микроостановка, балк, места паллет, отметка раз в 10 минут; v = −1 — пересчитать всегда */
  | { kind: 'line'; id: string; v: number }
  /** Росздравнадзор опубликовал сведения о серии: готовая продукция в обороте */
  | { kind: 'rzn'; lot: string }
  /** люди задачи дошли и начали работу */
  | { kind: 'begin'; task: string; v: number }
  /** отказ узла оборудования стадии на `n`-й таблетке отрезка */
  | { kind: 'fail'; part: string; v: number; n: number }
  /** запчасть пришла на склад ЗИП */
  | { kind: 'spare'; order: string }
  /** человек дошёл без задачи до поста или выхода; `t` — когда вышел (путь, начатый позже, этим событием не кончается) */
  | { kind: 'post'; person: string; t: number }
  /** за `LAST_CALL` до каждого часа: у кого смена кончается, новых задач уже не берёт — свободные идут к выходу (3а) */
  | { kind: 'leave' };

// ---------------------------------------------------------------- рынок и касса

/** Строка заказа покупателя: ящиков заказано, зарезервировано на складе, отгружено. */
export interface OrderLine {
  sku: Id;
  cases: number;
  reserved: number;
  shipped: number;
}

/** Заказ покупателя: `open` — ждёт своего дня; `shipped` — отгружен в срок полностью; `short` — недопоставка; `late` — отгружен позже срока. */
export interface Order {
  id: string;
  customer: Id;
  lines: OrderLine[];
  placed: number;
  /** когда отгрузить — 15:00 желаемого дня */
  due: number;
  /** наименьший остаточный срок годности, доли 1/10 000 полного */
  minShelf: number;
  status: 'open' | 'shipped' | 'short' | 'late';
  /** зарезервированные ящики, ещё не отгруженные; паллеты заказа в экспедиции; фура; версия склада при распределении */
  cases: string[];
  units: string[];
  truck?: string;
  checked?: number;
  shipment?: string;
}

/** Отгруженный ящик: тара партии ГП с отрезками кодов — прослеживаемость до покупателя. */
export interface ShippedCase {
  id: string;
  lot: string;
  qty: number;
  codes: [number, number][];
}

/** Отгрузка: фура покупателя ушла. Сведения в систему мониторинга — в тот же день; подтверждение покупателя — на следующий рабочий. */
export interface Shipment {
  id: string;
  customer: Id;
  orders: string[];
  t: number;
  cases: ShippedCase[];
  reported: number;
  accepted: number;
  /** сумма без НДС и НДС, копейки */
  sum: number;
  vat: number;
}

export type CashItem = 'start' | 'sale' | 'prepay' | 'supplier' | 'wages' | 'contrib' | 'energy' | 'vat' | 'interest' | 'codes';

// ---------------------------------------------------------------- техслужба

/**
 * Узел машины (docs/specs/2026-10-engine.md, 1е): наработка с установки — таблетки у оборудования, штуки машины у
 * линии; запас до отказа — 10⁻¹² отказа, из ветви `maint/<узел>`, его знает только движок.
 */
export interface Part {
  /** `<машина>/<узел>` */
  id: string;
  /** оборудование или машина линии; вид машины; узел в записи вида; у машины линии — линия */
  machine: string;
  of: Id;
  type: string;
  line?: string;
  done: number;
  budget: number;
  state: 'ok' | 'failed';
  installed: number;
  failed?: number;
  /** заменить вне отказа — как только машина свободна: решил игрок или политика техслужбы */
  plan?: 'player' | 'policy';
  /** задача ремонта или замены */
  task?: string;
  /** у машины линии: позиция задания, до которой наработка учтена */
  mark: number;
  /** версия событий отказа */
  v: number;
}

/** Запчасть на складе ЗИП: штук и сколько из них в резерве под ремонт. */
export interface SpareStock {
  qty: number;
  reserved: number;
}

/** Заказ запчасти: сумма с НДС и НДС в ней, предоплата — копейки. */
export interface SpareOrder {
  id: string;
  spare: Id;
  qty: number;
  ordered: number;
  eta: number;
  sum: number;
  vat: number;
  prepaid: number;
  status: 'ordered' | 'arrived';
  by: string;
}

// ---------------------------------------------------------------- потери и ритм

/**
 * Потери за сутки (docs/specs/2026-10-engine.md, 1ж; геймдизайн, §9.6) по участкам — отделам работы: задержки задач по
 * причинам, с; транспортировка — см техники с грузом и порожняком (и груза на руках), с в пути; перемещения людей
 * пешком без груза — см и с; дефекты; лишняя обработка — уборки после просроченной чистоты; сутки линий — для OEE.
 */
export interface DayLoss {
  /** номер дня от 1970-01-01 */
  day: number;
  wait: Partial<Record<Dept, Partial<Record<WaitCause, number>>>>;
  move: Partial<Record<Dept, { loaded: number; empty: number; sec: number }>>;
  walk: Partial<Record<Dept, { cm: number; sec: number }>>;
  defects: { blisters: number; cartons: number; deviations: number; lots: number; batches: number };
  recleans: number;
  /** по линиям: только те, у которых в эти сутки было задание */
  lines: Record<string, LineDay>;
}

/**
 * Сутки линии (docs/specs/2026-10-panels.md, 3в): время машин по состояниям и проход — как у задания; выпуск по номиналу
 * за время загрузки (всё, кроме «вне смены») и за время работы (без аварии и наладки); годные — таблетки в годных пачках,
 * ушедших с линии. Выпуск и годные — шестидесятые доли таблетки, как проход. Время задания сбрасывается с концом серии —
 * OEE суток считают по этой записи.
 */
export interface LineDay {
  /** по машинам линии, по порядку плана */
  times: MachineTimes[];
  ideal: number[];
  run: number[];
  good: number;
}

/** Сменное задание линии (1ж): смена, начало и конец, задание и выпуск — годных пачек; счётчик линии в начале смены. */
export interface ShiftTask {
  line: string;
  shift: Id;
  from: number;
  to?: number;
  plan: number;
  start: number;
  fact?: number;
}

/** Запись журнала оборудования (GMP ЕАЭС, ч. I, п. 4.31): отказ, ремонт после отказа, замена по плану. */
export interface MaintEntry {
  t: number;
  machine: string;
  part: string;
  what: 'failure' | 'repair' | 'replace';
  /** износ, доли 1/10 000 */
  wear: number;
  batch?: string;
  people?: string[];
}

/** Проводка: когда, сколько (копейки; приход — плюс), статья, ссылка. */
export interface Entry {
  t: number;
  sum: number;
  item: CashItem;
  ref?: string;
}

/** Счёт к получению (плюс) или к оплате (минус) со сроком. */
export interface Due {
  id: string;
  item: CashItem;
  sum: number;
  due: number;
  ref?: string;
}

/** Касса (docs/specs/2026-10-engine.md, 1д): копейки, проводки, счета, НДС квартала, энергия месяца, выплаты людям. */
export interface Cash {
  balance: number;
  start: number;
  ledger: Entry[];
  /** по сроку, затем по номеру */
  dues: Due[];
  /** НДС квартала: начислено, к вычету, переходящий вычет прошлых кварталов */
  vat: { out: number; in: number; carry: number };
  /** энергия: Вт·ч с начала месяца и до какого момента посчитана база; стоимость прошлого месяца с НДС; авансы этого месяца */
  energy: { wh: number; at: number; last: number; advanced: number };
  /** выплаты человеку с начала года — для предельной базы взносов; начислено за этот месяц */
  ytd: Record<string, number>;
  gross: Record<string, number>;
  /** проценты по кредитной линии с начала месяца */
  interest: number;
  /** день последнего извещения «касса ниже предела» */
  low?: number;
}

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
  cash: Cash;
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
  /** расследования результатов вне спецификации (часть 4); происшествие сценария — скрытое */
  investigations: Record<string, Investigation>;
  incident?: Incident;
  /** помещения и оборудование по именам из плана */
  rooms: Record<string, Room>;
  equipment: Record<string, Equipment>;
  batches: Record<string, Batch>;
  /** упаковочные линии по именам из плана */
  lines: Record<string, Line>;
  /** покупатели сценария: когда заказывали в последний раз */
  customers: Record<Id, { last: number }>;
  orders: Record<string, Order>;
  shipments: Record<string, Shipment>;
  /** узлы машин; склад ЗИП; заказы запчастей; журнал оборудования */
  parts: Record<string, Part>;
  spares: Record<Id, SpareStock>;
  spareOrders: Record<string, SpareOrder>;
  maintLog: MaintEntry[];
  /** потери по суткам, по порядку; сменные задания линий, по порядку */
  losses: DayLoss[];
  shiftTasks: ShiftTask[];
  /** журнал мест игрока (3е): какое место, с какого мгновения и по какое; места ещё не выбраны — нет */
  seats?: Tenure[];
}

/** Запись журнала мест: место игрока, с какого мгновения и по какое; держит его сейчас — без конца. */
export interface Tenure {
  seat: SeatId;
  from: number;
  to?: number;
}

/** Команда — единственный способ изменить состояние (docs/02-architecture.md, §7). */
export type Command =
  /** течение времени */
  | { kind: 'advance'; seconds: number }
  /** заказ поставщику: количество — мг или шт., округляется вверх до целой тары */
  | { kind: 'po'; supplier: Id; lines: PoLine[]; by?: string }
  /** задание на серию по карте: не раньше — игровые секунды; нет — сейчас */
  | { kind: 'order'; recipe: Id; notBefore?: number; by?: string; sku?: Id }
  /** упаковать балк серии в товарную позицию — когда балк разрешат */
  | { kind: 'pack'; batch: string; sku: Id }
  /**
   * решение игрока вместо уполномоченного лица по упакованной серии. «Выпустить» при открытых отклонениях — законный
   * риск: отклонения оценены «без влияния на качество» (продукт, «Чего нет сознательно»)
   */
  | { kind: 'release'; batch: string; decision: 'release' | 'reject' | 'hold' }
  /** заменить узел машины вне отказа — как только машина свободна */
  | { kind: 'maintain'; machine: string; part: string }
  /** поднять пробу партии (3г): её задачи лаборатории — выше, и те, что появятся позже */
  | { kind: 'rush'; lot: string; by?: string }
  /** новый срок «не раньше» задания на серию, которое ещё не начало комплектовку (3д): игровые секунды */
  | { kind: 'shift'; batch: string; notBefore: number; by?: string }
  /** места игрока (3е): набор целиком */
  | { kind: 'seat'; seats: SeatId[] }
  /** шаг расследования (часть 4) */
  | { kind: 'investigate'; inv: string; step: string; by?: string }
  /** решение расследования: причина — версия модели; судьба серии */
  | { kind: 'conclude'; inv: string; cause: string; fate: 'reject' | 'release'; by?: string };

/** Почему команда не выполнена — для окна. */
export type Refusal =
  | 'noSupplier'
  | 'notSold'
  | 'belowMoq'
  | 'empty'
  | 'noRecipe'
  | 'noBatch'
  | 'notBulk'
  | 'noSku'
  | 'notReady'
  | 'noPart'
  | 'busy'
  | 'noSpare'
  | 'noLot'
  | 'notLab'
  | 'already'
  | 'started'
  | 'notYours'
  | 'noSeat'
  /** расследования нет; оно уже решено; такого шага или версии нет; «выпустить» без лабораторной причины и повтора в пределах */
  | 'noInv'
  | 'closed'
  | 'noStep'
  | 'noCause'
  | 'notProven';

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
  /** открыто отклонение производства: МОК, режим, выход, сверка */
  | { kind: 'deviation'; id: string }
  /** серия упакована: ГП в карантине */
  | { kind: 'batchPacked'; batch: string; lot: string }
  /** решение уполномоченного лица: выпущена, отклонена, держать */
  | { kind: 'batchReleased'; batch: string; lot: string }
  | { kind: 'batchRejected'; batch: string; lot: string }
  | { kind: 'batchHeld'; batch: string }
  /** фура покупателя ушла с отгрузкой */
  | { kind: 'shipped'; shipment: string; customer: Id; cases: number }
  /** заказ закрыт недопоставкой или отгружен позже срока */
  | { kind: 'lateOrder'; order: string; missing: number }
  /** касса ниже предела кредитной линии */
  | { kind: 'cashLow'; balance: number }
  /** отказ узла машины; узел починили или заменили по плану */
  | { kind: 'failure'; machine: string; part: string }
  | { kind: 'repaired'; machine: string; part: string; planned: boolean }
  /** команда не выполнена */
  | { kind: 'refused'; cmd: Command['kind']; why: Refusal; detail?: string }
  /** результат вне спецификации — расследование открыто; шаг расследования сделан; расследование решено */
  | { kind: 'investigation'; id: string; batch: string; lot: string }
  | { kind: 'invStep'; id: string; step: string }
  | { kind: 'concluded'; id: string; cause: string; fate: 'reject' | 'release' };
