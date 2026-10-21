// Типы собранной базы игры (docs/04-data-model.md, §3). Исходные записи — YAML в content/, сборка и валидатор —
// tools/content/ (`npm run content` → src/content/generated/bundle.json). Числа здесь — уже в единицах движка
// (docs/04-data-model.md, §2): масса — миллиграммы, деньги — копейки, расстояния — сантиметры, доли — 1/10 000.
import type { Ymd } from '../engine/core/calendar';

export type Id = string;

/** `checked` ставит только человек (устав, ADR 0012); агент пишет `draft`. */
export type Review = 'draft' | 'checked';

export interface Text {
  ru: string;
  en?: string;
}

/** Регуляторный профиль (ADR 0004): правила страны — данными. В 1.0 профиль один — ЕАЭС/РФ. */
export interface Profile {
  id: Id;
  name: Text;
  /** валюта счёта завода, код ISO 4217 */
  currency: string;
  /** ставки НДС, доли 1/10 000: на лекарства и общая */
  vat: { medicines: number; general: number };
  /** НДС за квартал — равными долями до этого числа каждого из трёх следующих месяцев */
  vatDue: number;
  /**
   * маркировка пачек кодами и агрегирование в короба и паллеты; плата за код, копейки без НДС; коды бесплатны, если
   * зарегистрированная цена позиции не выше `free`, копейки
   */
  marking: { packs: boolean; aggregation: 'optional' | 'required'; fee: number; free: number };
  /**
   * труд: ночные часы [с, до) и доплата за них, доли 1/10 000 часовой ставки; взносы, доли 1/10 000 — до предельной базы
   * (копейки с начала года), сверх неё и «на травматизм» — и до какого числа следующего месяца
   */
  payroll: {
    night: { from: number; to: number; extra: number };
    contrib: { rate: number; base: number; above: number; injury: number; due: number };
  };
  /** электроэнергия: авансы — число месяца и доля стоимости прошлого месяца, 1/10 000; окончательный расчёт — число */
  energy: { advances: [number, number][]; final: number };
  /** ключевая ставка, доли 1/10 000 */
  key: number;
  /** коды единиц по ОКЕИ (Б3а) — для справочника и обмена с другими системами; движок считает в своих целых */
  okei: Record<OkeiUnit, number>;
  /** ключи источников из docs/10-domain.md, §9 */
  source: string[];
  review: Review;
}

/** Единицы с кодом ОКЕИ: миллиграмм, грамм, килограмм, штука, упаковка (пачка готовой продукции). */
export type OkeiUnit = 'mg' | 'g' | 'kg' | 'pcs' | 'pack';

/**
 * Шапка регламентирующего документа (Б3а; GMP ЕАЭС, ч. I, пп. 4.3, 4.5): код — вид и номер (`SP-0001`), редакция, день
 * введения в действие — номер дня от 1970-01-01 — и роль того, кто утвердил. Редакции одного документа — записи с одним
 * кодом; какая действует — по дате завода (src/engine/docs.ts).
 */
export interface DocHead {
  code: string;
  rev: number;
  from: number;
  approved: Id;
}

/** Строка штата сценария: столько-то людей роли на графике. */
export interface StaffRow {
  role: Id;
  shift: Id;
  /** навык 1–5 */
  skill: number;
  n: number;
}

/** Заказ поставщику в начале сценария: делается в первую секунду партии. */
export interface StartOrder {
  supplier: Id;
  /** количество — в единицах движка: мг или штуки */
  lines: { material: Id; qty: number }[];
}

/** Запас на старте: разрешённые партии на стеллажах. */
export interface StartStock {
  material: Id;
  /** мг или штуки; округляется до целой тары */
  qty: number;
}

/** Сценарий: с чего начинается партия. */
/** Места игрока (геймдизайн, §29.2): директор и четыре поста. */
export const SEATS = ['director', 'production', 'quality', 'supply', 'commerce'] as const;
export type SeatId = (typeof SEATS)[number];

/**
 * Виды задач движка (src/engine/types.ts, `TaskKind`): записи базы называют их в требованиях процедур (Б3б, `for.tasks`).
 * Склад: проверка фуры у рампы, разгрузка, приёмка, размещение (в карантин или на стеллаж), перемещение (в зону
 * отклонённого). Лаборатория: паллета в пробоотборную и обратно, отбор проб, передача проб в лабораторию, испытание,
 * проверка результата, решение по партии. Производство: паллета с комплектом серии к шлюзу, перекладка в шлюзе, возврат
 * остатков, стадия серии, уборка помещения. Линия: смена у линии, переналадка, очистка линии и её проверка, балк к линии.
 * Качество: проверка ГП и досье, решение уполномоченного лица. Отгрузка: паллета в экспедицию, отбор ящиков на паллету
 * заказа, погрузка в фуру покупателя. Техслужба: ремонт после отказа или замена узла по плану. Расследование (часть 4):
 * шаг и замена сита калибратора по решению. Обучение (Б3б): изучить документ и проверка знаний. Места и оборудование
 * (Б3в): приёмка работы подрядчика — калибровки, поверки или квалификации.
 */
export const TASK_KINDS = [
  'unload',
  'receive',
  'putaway',
  'move',
  'toSampling',
  'sample',
  'fromSampling',
  'handover',
  'prep',
  'review',
  'decide',
  'pick',
  'transfer',
  'return',
  'stage',
  'clean',
  'crew',
  'changeover',
  'clearance',
  'clearCheck',
  'feed',
  'fgCheck',
  'qpDecide',
  'ship',
  'casePick',
  'load',
  'repair',
  'truckCheck',
  'invStep',
  'invFix',
  'train',
  'trainCheck',
  'accept',
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/**
 * Обучение по документу (Б3б): роли, которые по нему учатся, — строка матрицы обучения (геймдизайн, §6.4); сколько
 * изучать, с; через сколько месяцев учиться снова — непрерывное обучение (GMP ЕАЭС, ч. I, п. 2.11).
 */
export interface Learn {
  roles: Id[];
  study: number;
  every: number;
}

/**
 * Каким работам нужна процедура (Б3б): видам задач, стадиям на этих классах оборудования, работам у линии с этими
 * машинами, работе на этой технике; `any` — любой работе, кроме самого обучения.
 */
export interface SopFor {
  any?: true;
  tasks?: TaskKind[];
  equipment?: Id[];
  machines?: Id[];
  vehicles?: Id[];
}

/** Процедура (СОП, Б3б): регламентирующий документ с шапкой Б3а; чему и кого она учит и каким работам нужна. */
export interface Sop extends Learn {
  id: Id;
  name: Text;
  doc: DocHead;
  for: SopFor;
  source?: string[];
  review?: Review;
}

export interface Scenario {
  id: Id;
  name: Text;
  profile: Id;
  plant: Id;
  /** дата и час начала по часам завода */
  start: { date: Ymd; hour: number };
  /** зерно по умолчанию; песочница даёт своё */
  seed: number;
  /** участок в клетках 1 × 1 м */
  site: { w: number; h: number };
  /** касса на старте, копейки */
  cash: number;
  /** кредитная линия: предел минуса кассы, копейки; надбавка к ключевой ставке, доли 1/10 000 */
  credit: { limit: number; spread: number };
  /** цена электроэнергии, копейки за кВт·ч без НДС */
  energy: { price: number };
  /** покупатели сценария */
  customers: Id[];
  staff: StaffRow[];
  vehicles: { type: Id; n: number }[];
  orders: StartOrder[];
  stock: StartStock[];
  /** задания на серию: карта, день «не раньше» от начала партии и товарная позиция, в которую упаковать балк */
  batches: { recipe: Id; day: number; sku?: Id }[];
  /** план выпуска (Б2в): что ставит коллега планирования после заданий сценария — src/engine/planner.ts */
  plan?: ScenarioPlan;
  /** снабжение (Б2в): правило коллеги снабжения — src/engine/supply.ts, `supplyDay` */
  supply?: ScenarioSupply;
  /** износ узлов на старте: `<машина>/<узел>` → доли 1/10 000 */
  wear: Record<string, number>;
  /** техслужба: `<машина>/<узел>` → износ (доли 1/10 000), на котором узел меняют по наработке; нет — по отказу */
  maint: Record<string, number>;
  /** мастер линии: норма сменного задания — доля номинала узкого места, 1/10 000 */
  norm: number;
  /** какие места игрок может взять (3е); остальные ведёт сценарий */
  seats: SeatId[];
  /**
   * обучение (Б3б): за сколько суток до введения новой редакции или конца срока записи — задача обучения; проверка
   * знаний, с; на старте дни обучения — до `spread` суток назад; табельные номера — по порядку приёма с `tab`
   */
  training: { ahead: number; check: number; spread: number; tab: number };
  /**
   * места и оборудование (Б3в): за сколько суток до конца записи коллега техслужбы назначает визит подрядчика; рабочие
   * часы подрядчика — секунды от полуночи, с и до; приёмка его работы, с; инвентарные номера — по порядку мест с `inv`
   */
  assets: { ahead: number; hours: [number, number]; accept: number; inv: number };
  /** происшествие прототипа (часть 4): у задания на серию — неисправность по жребию зерна */
  incident?: IncidentDef;
}

/**
 * План выпуска сценария (Б2в): какие серии можно ставить — карта и позиция; запас позиции, сутки спроса, — меньше спроса на
 * две замороженные недели и ещё столько — задание; спрос — средний по заказам покупателей за столько последних суток.
 */
export interface ScenarioPlan {
  items: { recipe: Id; sku: Id }[];
  cover: number;
  window: number;
  /**
   * кампании (Б2г): продукт последнего задания идёт дальше, пока его позициям нужна серия, а у позиций другого продукта
   * запаса больше, чем на две замороженные недели и ещё столько суток; нет — каждый раз позиция, которой хватит меньше всего
   */
  urgent?: number;
}

/** Снабжение сценария (Б2в): страховой запас и заказ — в сутках расхода, входной контроль — сутки. */
export interface ScenarioSupply {
  safety: number;
  every: number;
  qc: number;
}

/** Корень происшествия: ошибка лаборатории, пересмазывание, сила прессования, сито калибратора. */
export type IncidentRoot = 'lab' | 'lube' | 'force' | 'screen';

/**
 * Происшествие сценария (docs/specs/2026-10-investigation.md, «Происшествие»): задание на серию по номеру (с 1), модель
 * расследования, веса корней и величина неисправности каждого корня в единицах движка — от и до: ошибка лаборатории —
 * доли 1/10 000 ниже истинного, опудривание — с сверх цели, сила — сотые кН сверх цели, сито — мкм крупнее карты.
 */
export interface IncidentDef {
  batch: number;
  inv: Id;
  roots: Partial<Record<IncidentRoot, number>>;
  sizes: Record<IncidentRoot, [number, number]>;
}

/** Грузовая единица: паллета или транспортный короб (docs/04-data-model.md, §3). */
export interface UnitType {
  id: Id;
  name: Text;
  kind: 'pallet' | 'case';
  /** длина × ширина × высота, см */
  size: [number, number, number];
  /** наибольшая масса груза, кг */
  maxLoad: number;
  /** деревянная паллета дальше шлюза для материалов не проходит (геймдизайн, §3.4) */
  wood?: boolean;
  /** у стандартной паллеты — источник размеров; свой короб — выбор геймдизайна, без источника */
  source?: string[];
  review?: Review;
}

/** Вид материала; `bulk` — свой полупродукт: таблетки после производства, до упаковки; `fg` — готовая продукция. */
export type MaterialKind = 'api' | 'excipient' | 'packaging' | 'bulk' | 'fg';

/**
 * Свойство качества (геймдизайн, §6.1): подлинность, содержание, влажность, внешний вид, размер частиц АФС, средняя
 * масса таблетки (доля от цели), прочность, истираемость, распадаемость, растворение.
 */
export type Attr =
  | 'identity'
  | 'assay'
  | 'moisture'
  | 'appearance'
  | 'particle'
  | 'mass'
  | 'hardness'
  | 'friability'
  | 'disintegration'
  | 'dissolution'
  | 'granule'
  | 'uniformity';

/**
 * Единицы свойства в записях и в движке. Проценты — в долях 1/10 000 (99,8 % — 9 980); ньютоны — в сотых; минуты — в
 * секундах; микрометры — целыми; качественное — 10 000 «соответствует» или 0 «нет». `whole` — доля от целого: истинное
 * значение не выходит за 0–100 %.
 */
export const ATTRS: Record<Attr, { unit: 'qual' | 'pct' | 'N' | 'min' | 'um' | 'av'; whole?: true }> = {
  identity: { unit: 'qual' },
  appearance: { unit: 'qual' },
  assay: { unit: 'pct', whole: true },
  moisture: { unit: 'pct', whole: true },
  friability: { unit: 'pct', whole: true },
  dissolution: { unit: 'pct', whole: true },
  mass: { unit: 'pct' },
  hardness: { unit: 'N' },
  disintegration: { unit: 'min' },
  particle: { unit: 'um' },
  /** средний размер гранул гранулята (часть 4): его меряет ситовой анализ архивного гранулята */
  granule: { unit: 'um' },
  /** однородность дозирования (Б2б): приемлемое значение AV по 10 таблеткам — число без единицы, годно до 15,0 */
  uniformity: { unit: 'av' },
};

/** Во сколько раз значение в движке больше записанного: % → доли 1/10 000, Н → сотые, мин → с, мкм → мкм, AV → сотые. */
export const ATTR_SCALE = { qual: 1, pct: 100, N: 100, min: 60, um: 1, av: 100 } as const;

/** Качественные свойства: в спецификации у них нет пределов. */
export const QUALITATIVE: readonly Attr[] = ['identity', 'appearance'];

/** Материал (геймдизайн, §4.1). Единица учёта — масса (мг) или штуки. */
export interface Material {
  id: Id;
  kind: MaterialKind;
  /** внутренний код (Б3а): шесть цифр, первая — вид; у готовой продукции — код позиции в документах и на ярлыках */
  code: string;
  name: Text;
  /** `mass` — количество в миллиграммах; `pcs` — в штуках */
  unit: 'mass' | 'pcs';
  /** в чём приходит */
  container: Id;
  /** режим хранения, который материал требует (Б3в): запись `content/regimes/` */
  storage: Id;
  /** срок годности или повторных испытаний, месяцев */
  shelf: number;
  /** навеска пересчитывается на фактическое содержание (АФС) */
  potency?: boolean;
  /** спецификация входного контроля */
  spec: Id;
  /** истинные свойства партии: среднее и разброс (СКО) между партиями, в единицах движка — только количественные */
  props: Partial<Record<Attr, [number, number]>>;
  /** брак у поставщика: свойство и сдвиг в единицах движка; у качественного свойства — «не соответствует» */
  bad?: { attr: Attr; shift?: number };
  /** проба с одной тары: мг или шт.; у готовой продукции — архивные образцы серии, пачек */
  sample: number;
  source?: string[];
  review?: Review;
}

/**
 * Режим хранения (Б3в; ГФ XV, ОФС.1.1.0010): слова этикетки, диапазон температуры — десятые °C, наибольшая средняя
 * относительная влажность — доли 1/10 000. Его требует материал и держит зона хранения плана.
 */
export interface Regime {
  id: Id;
  name: Text;
  temp: [number, number];
  rh: number;
  source: string[];
  review: Review;
}

/** Вид груза для отрисовки (src/render/loads.ts). */
export type LoadKind = 'cases' | 'drums' | 'bags' | 'rolls';

/** Тара материала: бочка, мешок, рулон, коробка, пачка гофроящиков, контейнер таблеток, гофроящик с пачками. */
export interface ContainerType {
  id: Id;
  name: Text;
  kind: 'drum' | 'bag' | 'roll' | 'box' | 'bundle' | 'bin' | 'case';
  /** сколько материала в таре: мг или штуки — по единице материала */
  capacity: number;
  /** сколько тары на паллете */
  perPallet: number;
  load: LoadKind;
}

/** Строка прайса поставщика: цена за килограмм или за штуку, минимальная партия. */
export interface SupplierItem {
  /** копейки за кг (материалы по массе) или за штуку */
  price: number;
  /** мг или штуки */
  moq: number;
}

export interface Supplier {
  id: Id;
  name: Text;
  /** срок поставки «от — до», дни */
  lead: [number, number];
  /** предоплата, доли 1/10 000; остаток — через `payDays` после прихода */
  prepay: number;
  payDays: number;
  /** одобрен ли поставщик (входной контроль по плану отбора — геймдизайн, §6.3) */
  approved: boolean;
  /** доля партий с браком, доли 1/10 000 */
  defects: number;
  items: Record<Id, SupplierItem>;
}

export type Dept = 'wms' | 'qc' | 'qa' | 'mes' | 'line' | 'maint';

export interface Role {
  id: Id;
  name: Text;
  dept: Dept;
  /** копейки в месяц */
  salary: number;
}

/** Техника склада (геймдизайн, §4.4). */
export interface VehicleType {
  id: Id;
  name: Text;
  /** см/с */
  speedEmpty: number;
  speedLoaded: number;
  /** до какого яруса достаёт: 0 — только пол */
  levels: number;
  /** поднять или опустить паллету на полу, с; на ярус — ещё `liftPerLevel` за каждый ярус */
  liftBase: number;
  liftPerLevel: number;
}

/** График: дни недели (0 — понедельник) и часы смены. */
export interface Shift {
  id: Id;
  name: Text;
  days: number[];
  from: number;
  to: number;
}

export type ZoneKind = 'receiving' | 'quarantine' | 'cold' | 'rejected' | 'fgQuarantine' | 'shipping' | 'staging' | 'sampling' | 'palletizing';

/** Дверь: одна створка, две, откатные ворота для техники, ворота рампы, проём для ленты в стене (не проход). */
export type DoorKind = 'door' | 'double' | 'gate' | 'dock' | 'hatch';

/**
 * Рабочее место (Б3в; ролевая иерархия оборудования ISA-95): технологическая ячейка, производственная линия, зона хранения
 * — с помещениями хранения и режимом, который она держит, — или лаборатория. Код — код участка, дефис и две цифры.
 */
export interface WorkCenter {
  code: string;
  kind: 'cell' | 'line' | 'storage' | 'lab';
  name: Text;
  rooms?: string[];
  regime?: Id;
}

/** Участок площадки (Б3в): код — две латинские буквы; помещения, которым он служит; его рабочие места. */
export interface Area {
  code: string;
  name: Text;
  rooms: string[];
  centers: WorkCenter[];
}

/** Прибор вне лаборатории (Б3в): прибор МОК у оборудования стадии или датчик условий хранения — вид, помещение, место. */
export interface PlantMeter {
  id: string;
  type: Id;
  room: string;
  place: string;
}

/**
 * План завода прототипа (docs/specs/2026-10-engine.md, «План завода прототипа»; docs/specs/2026-10-view.md, 2а). Координаты
 * — сантиметры участка; клетка — 100 см. Здание и помещения — прямоугольники со стенами по краю: соседние помещения делят
 * общую стену.
 */
export interface Plant {
  id: Id;
  /** площадка и её участки (Б3в): иерархия мест ISA-95 */
  site: { code: string; name: Text };
  areas: Area[];
  building: [number, number, number, number];
  /** рампа — точка на клетке ворот рампы в стене здания */
  docks: { id: string; kind: 'in' | 'out'; x: number; z: number }[];
  /** зона на полу: прямоугольник [x, z, ширина, глубина] и места сеткой [столбцов, рядов] */
  zones: { id: string; kind: ZoneKind; rect: [number, number, number, number]; grid: [number, number] }[];
  /** ряды стеллажей: начало ряда, секций, ярусов; проход — с севера (`n`, меньше z) или с юга (`s`) */
  racks: { id: string; x: number; z: number; bays: number; levels: number; face: 'n' | 's' }[];
  /** помещение: прямоугольник со стенами, класс, можно ли туда технике, рабочая точка (нет — середина) */
  rooms: { id: string; type: string; rect: [number, number, number, number]; grade: 'D' | 'cnc'; vehicles: boolean; at?: [number, number] }[];
  /**
   * двери — клетки на стене: первая клетка (номера клеток), сколько клеток, вдоль какой оси идёт стена, вид; дверь только
   * для материалов (внутренняя дверь шлюза для материалов) — люди через неё не ходят
   */
  doors: { cell: [number, number]; len: number; along: 'x' | 'z'; kind: DoorKind; materials?: boolean }[];
  /** приборы лаборатории: вид, помещение, код места (Б3в) */
  instruments: { id: string; type: Id; room: string; place: string }[];
  /** приборы МОК у оборудования стадий и датчики условий хранения (Б3в) */
  ipc: PlantMeter[];
  sensors: PlantMeter[];
  /** оборудование производства: вид, помещение, середина следа, поворот на четверти и код места */
  equipment: { id: string; type: Id; room: string; at: [number, number]; turn: number; place: string }[];
  /**
   * упаковочные линии: помещение, зона паллетирования на выходе, машины по порядку; после машины — накопитель на
   * `buffer` её штук (у последней — нет)
   */
  lines: { id: string; room: string; out: string; machines: { id: string; type: Id; buffer?: number; at: [number, number]; turn: number; place: string }[] }[];
  /** точки: стоянка техники, вход персонала */
  points: { park: [number, number]; entrance: [number, number] };
  /** посты ожидания по ролям: где человек ждёт задачи — после прихода на смену и после каждой задачи */
  posts: Record<Id, [number, number]>;
  /** вентиляция — Вт на м² помещения по классу, круглые сутки; постоянная база — Вт */
  energy: { hvac: { D: number; cnc: number }; base: number };
}

/**
 * Работа подрядчика по классу (Б3в; геймдизайн, §7.2): повторная квалификация или калибровка — через сколько месяцев
 * снова, сколько идёт, с, и цена — копейки без НДС; как она называется в окне; `verify` — у датчиков условий хранения она
 * называется поверкой.
 */
export interface AssetWork {
  every: number;
  work: number;
  price: number;
  name: Text;
  verify?: true;
}

/**
 * Вид прибора (геймдизайн, §6.2): лаборатории, МОК или датчик условий хранения; экземпляры — в плане завода. Прибор —
 * средство измерений: калибровка у него всегда (Б3в), квалификация — если нужна; критический — для перечня досье площадки.
 */
export interface InstrumentType {
  id: Id;
  name: Text;
  cal: AssetWork;
  qual?: AssetWork;
  critical?: true;
  source?: string[];
  review?: Review;
}

/** Методика испытания (геймдизайн, §6.2); по ней учатся, как по процедуре (Б3б). */
export interface TestMethod extends Learn {
  id: Id;
  name: Text;
  doc: DocHead;
  attr: Attr;
  /** вид прибора; нет — испытание без прибора */
  inst?: Id;
  /** работа аналитика (подготовка) и работа прибора, с */
  prep: number;
  run: number;
  /** прибор работает без человека — и ночью; иначе аналитик стоит у прибора всё время */
  unattended: boolean;
  /** погрешность — СКО в единицах движка */
  sd: number;
  source?: string[];
  review?: Review;
}

/** Строка спецификации: методика и пределы в единицах движка; у качественного свойства пределов нет. */
export interface SpecLine {
  test: Id;
  min?: number;
  max?: number;
}

/** Спецификация: что она описывает, шапка документа, испытания с пределами. */
export interface Spec {
  id: Id;
  name: Text;
  doc: DocHead;
  tests: SpecLine[];
  source?: string[];
  review?: Review;
}

/** Продукт: лекарство по МНН, форма и дозировка. */
export interface Product {
  id: Id;
  name: Text;
  inn: string;
  /** код в номере серии: две заглавные латинские буквы или цифры, у каждого продукта свой */
  code: string;
  form: 'tablet';
  /** дозировка (Б3а): действующего вещества в единице формы, мг */
  strength: number;
  /** в перечне ЖНВЛП: цена позиции — не выше зарегистрированной */
  jnvlp: boolean;
  source?: string[];
  review?: Review;
}

/**
 * Узел машины (геймдизайн, §7.1; docs/specs/2026-10-engine.md, 1е). Наработка — единицы работы машины: таблетки у
 * оборудования, блистеры или пачки у машины линии; износ — наработка / `life`.
 */
export interface PartType {
  id: string;
  name: Text;
  /** средний ресурс, единиц наработки */
  life: number;
  /**
   * ступени интенсивности отказов: от износа (доли 1/10 000) — столько 10⁻¹² отказа на единицу наработки (то есть
   * отказов на миллион единиц × 10⁶); износ — по возрастанию с нуля, интенсивность не убывает
   */
  hazard: [number, number][];
  spare: Id;
  /** замена по плану, с; ремонт после отказа — от и до, с */
  replace: number;
  repair: [number, number];
  /** разброс МОК по ходу стадии при износе 100 %, единиц движка свойства */
  scatter?: Partial<Record<Attr, number>>;
  /** частота микроостановок машины при износе 100 %, доли 1/10 000 частоты нового узла */
  micro?: number;
}

/**
 * Часть модели кодом (docs/13-art.md, §8; docs/specs/2026-10-view.md, 2в), м — только для окна: середина относительно
 * середины следа на полу, размеры по x, z и высоте; форма, цвет отделки, ось цилиндра, нижний диаметр бункера, штуки на
 * ленте; крутится со скоростью машины; открывается на переналадке и уборке.
 */
export interface ModelPart {
  shape: 'box' | 'cyl' | 'cone' | 'glass' | 'belt';
  x: number;
  z: number;
  y: number;
  w: number;
  d: number;
  h: number;
  color?: 'white' | 'steel' | 'grey' | 'dark' | 'blue' | 'film' | 'foil' | 'card';
  axis?: 'x' | 'y' | 'z';
  bottom?: number;
  item?: 'blister' | 'carton' | 'case';
  spin?: 'x' | 'y' | 'z';
  cover?: boolean;
}

/** Вид оборудования производства: уборка малая и генеральная, с (геймдизайн, §5.5); мощность; узлы с износом. */
export interface EquipmentType {
  id: Id;
  name: Text;
  /** ширина, глубина, высота, см — след на полу (гипотеза) */
  size: [number, number, number];
  model: ModelPart[];
  cleaning: { minor: number; major: number };
  /** мощность, пока идёт стадия, Вт */
  kw: number;
  parts: PartType[];
  /** повторная квалификация и калибровка подрядчиком (Б3в); критическое — для перечня досье площадки */
  qual?: AssetWork;
  cal?: AssetWork;
  critical?: true;
  source?: string[];
  review?: Review;
}

/** Единица режима в движке: об/мин — целыми, минуты — секундами, °C — десятыми, кН — сотыми, кг — граммами. */
export type ParamUnit = 'rpm' | 'min' | 'C' | 'kN' | 'kg';
export const PARAM_SCALE: Record<ParamUnit, number> = { rpm: 1, min: 60, C: 10, kN: 100, kg: 1000 };

export interface StageParam {
  id: string;
  unit: ParamUnit;
  /** цель, допустимый диапазон, разброс от серии к серии — в единицах движка */
  target: number;
  range: [number, number];
  sd: number;
}

/** Межоперационный контроль стадии: методика, как часто (с; нет — раз в конце), пределы в единицах движка. */
export interface StageIpc {
  test: Id;
  every?: number;
  min?: number;
  max?: number;
}

export interface RecipeStage {
  id: string;
  /** тип помещения */
  room: string;
  equipment: Id[];
  staff: { role: Id; n: number };
  /** с: подготовка, на загрузку, на компонент; скорость — мг или штук в час; разброс длительности, доли 1/10 000 */
  time: { setup: number; perLoad?: number; loads?: number; perComponent?: number; mgPerHour?: number; unitsPerHour?: number; spread: number };
  params: StageParam[];
  ipc: StageIpc[];
  /** ячейка сита калибратора по карте, мкм (часть 4): сито крупнее — гранулят крупнее */
  screen?: number;
  /** первое смешивание субстанции с другими ингредиентами — дата производства; в начале стадии серия получает полный номер */
  mix?: true;
  /** потери стадии: среднее и разброс, доли 1/10 000 от массы на входе */
  loss: [number, number];
}

/** Технологическая карта (docs/04-data-model.md, §4–5). Массы — мг, доли — 1/10 000. */
export interface Recipe {
  id: Id;
  name: Text;
  doc: DocHead;
  product: Id;
  batch: { mass: number; units: number };
  /** состав на серию, мг: `potency` — с пересчётом на содержание партии; `qs` — добирает массу серии */
  bom: { material: Id; qty: number; potency?: boolean; qs?: boolean }[];
  stages: RecipeStage[];
  bulk: Id;
  /** показатели балка: номинал и разброс серии в единицах движка */
  quality: Partial<Record<Attr, [number, number]>>;
  yield: { expected: number; alarm: number };
  source?: string[];
  review?: Review;
}

/**
 * Откуда вклад причины: отход режима от цели; содержание АФС против измеренного; свойство отвешенных партий; показатель;
 * средний износ узла оборудования за стадию (доли 1/10 000).
 */
export type CauseDriver = { param: string } | { potency: true } | { lots: 'api' | 'excipient'; attr: Attr } | { attr: Attr } | { wear: string } | { screen: true };

/** Причина: вклад в показатели серии — единиц движка показателя на единицу движка отхода. */
export interface Cause {
  id: Id;
  name: Text;
  driver: CauseDriver;
  effects: { attr: Attr; coef: number }[];
  source?: string[];
  review?: Review;
}

/**
 * Как улику читают из состояния завода (docs/specs/2026-10-investigation.md, «Шаги»): отметка у записи испытания или у
 * прибора; повторное испытание в пределах; режим стадии выше пределов карты; среднее МОК ниже или выше значения;
 * замена сита в журнале калибратора; свойство по паспорту отвешенной партии выше значения; другие серии той же партии
 * тоже вне спецификации; сито на калибраторе не по карте; результат испытания шага выше значения. Значения — в единицах
 * движка.
 */
export type FindingRead =
  | { mark: 'calc' | 'instrument' }
  | { retest: true }
  | { param: string }
  | { ipc: Id; below?: number; above?: number }
  | { journal: 'screen' }
  | { coa: Attr; above: number }
  | { peers: true }
  | { screen: true }
  | { measure: Attr; above: number };

/** Версия расследования: причина каталога или ошибка лаборатории (без причины); априорный вес — доли 1/10 000. */
export interface InvCandidate {
  id: string;
  name: Text;
  cause?: Id;
  prior: number;
}

/** Улика: доля фона и вероятность от каждой версии — noisy-OR, доли 1/10 000; как её читают из состояния. */
export interface InvFinding {
  id: string;
  name: Text;
  leak: number;
  by: Record<string, number>;
  read: FindingRead;
}

/**
 * Шаг расследования: кто и сколько работы, или испытание лаборатории (повторное — той же пробы другим аналитиком); у
 * осмотра — оборудование, у которого его делают; что шаг проверяет — улика, чувствительность и специфичность, доли
 * 1/10 000.
 */
export interface InvStep {
  id: string;
  name: Text;
  role?: Id;
  work?: number;
  at?: Id;
  test?: Id;
  retest?: true;
  checks: { f: string; sens: number; spec: number }[];
}

/**
 * Модель расследования (docs/specs/2026-10-investigation.md, «Вывод — копия «Анамнеза»»): испытание, результат которого
 * вне спецификации её открывает; версии, улики, шаги; уверенность, при которой коллега решает, и польза шага (биты), ниже
 * которой шаг ему не нужен.
 */
export interface InvModel {
  id: Id;
  name: Text;
  test: Id;
  candidates: InvCandidate[];
  findings: InvFinding[];
  steps: InvStep[];
  threshold: number;
  minGain: number;
  source?: string[];
  review?: Review;
}

/**
 * Машина упаковочной линии (геймдизайн, §5.6): номинал — блистеров или пачек в минуту; микроостановки — в среднем раз в
 * `every` секунд работы на номинале, длятся в среднем `duration` секунд; брак камеры — доли 1/10 000 выхода; переналадка
 * на другой формат, с.
 */
export interface Machine {
  id: Id;
  name: Text;
  /** ширина, глубина, высота, см — след на полу (гипотеза) */
  size: [number, number, number];
  model: ModelPart[];
  item: 'blister' | 'carton';
  nominal: number;
  crew: { role: Id; n: number };
  micro?: { every: number; duration: number };
  reject: number;
  changeover: number;
  /** мощность на ходу, Вт */
  kw: number;
  parts: PartType[];
  /** заминка — микроостановка, которая портит `cartons` пачек с вложениями; доля 1/10 000 испорченного не записывается */
  jam?: { cartons: number; uncounted: number };
  /** повторная квалификация подрядчиком (Б3в); критическая — для перечня досье площадки */
  qual?: AssetWork;
  cal?: AssetWork;
  critical?: true;
  source?: string[];
  review?: Review;
}

/** Товарная позиция (docs/04-data-model.md, §4). Материалы на блистер — мг, на пачку — штуки. */
export interface Sku {
  id: Id;
  name: Text;
  /** шапка инструкции по упаковке (Б3а): блистер, пачка, ящик, паллета и отходы на наладку — её содержание */
  doc: DocHead;
  product: Id;
  /** готовая продукция — материал вида `fg` */
  fg: Id;
  format: string;
  perBlister: number;
  blisters: number;
  blister: { material: Id; qty: number }[];
  carton: { material: Id; qty: number }[];
  case: { material: Id; per: number };
  pallet: { cases: number };
  /** на наладку: блистеров и пачек; пачек в запас на заминки картонажной */
  waste: { blisters: number; cartons: number; jams: number };
  /** цена завода за пачку и зарегистрированная предельная цена, копейки без НДС */
  price: number;
  regPrice?: number;
}

/** Покупатель (docs/specs/2026-10-engine.md, 1д). Дни недели — 0 — понедельник. */
export interface Customer {
  id: Id;
  name: Text;
  payDays: number;
  order: { days: number[]; hour: number; lead: [number, number] };
  /** наименьший остаточный срок годности, доли 1/10 000 полного */
  minShelf: number;
  /** позиция → пачек в сутки */
  demand: Record<Id, number>;
  source?: string[];
  review?: Review;
}

/** Запасная часть (docs/specs/2026-10-engine.md, 1е): цена — копейки без НДС; срок поставки — дни; уровни ЗИП — штуки. */
export interface Spare {
  id: Id;
  /** внутренний код (Б3а): шесть цифр, первая — 6 */
  code: string;
  name: Text;
  supplier: Id;
  price: number;
  lead: [number, number];
  /** неснижаемый уровень и начальный: «на складе − в резерве + в заказе» дошло до `min` — заказ до `max` */
  stock: { min: number; max: number };
  source?: string[];
  review?: Review;
}

export interface ContentDb {
  /** отпечаток базы: сохранение помнит, с какой базой оно сделано */
  hash: string;
  profiles: Record<Id, Profile>;
  scenarios: Record<Id, Scenario>;
  units: Record<Id, UnitType>;
  materials: Record<Id, Material>;
  containers: Record<Id, ContainerType>;
  suppliers: Record<Id, Supplier>;
  roles: Record<Id, Role>;
  vehicles: Record<Id, VehicleType>;
  shifts: Record<Id, Shift>;
  plants: Record<Id, Plant>;
  instruments: Record<Id, InstrumentType>;
  tests: Record<Id, TestMethod>;
  specs: Record<Id, Spec>;
  products: Record<Id, Product>;
  equipment: Record<Id, EquipmentType>;
  recipes: Record<Id, Recipe>;
  causes: Record<Id, Cause>;
  investigations: Record<Id, InvModel>;
  machines: Record<Id, Machine>;
  skus: Record<Id, Sku>;
  customers: Record<Id, Customer>;
  spares: Record<Id, Spare>;
  sops: Record<Id, Sop>;
  regimes: Record<Id, Regime>;
}
