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
  /** ключи источников из docs/10-domain.md, §9 */
  source: string[];
  review: Review;
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
  | 'dissolution';

/**
 * Единицы свойства в записях и в движке. Проценты — в долях 1/10 000 (99,8 % — 9 980); ньютоны — в сотых; минуты — в
 * секундах; микрометры — целыми; качественное — 10 000 «соответствует» или 0 «нет». `whole` — доля от целого: истинное
 * значение не выходит за 0–100 %.
 */
export const ATTRS: Record<Attr, { unit: 'qual' | 'pct' | 'N' | 'min' | 'um'; whole?: true }> = {
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
};

/** Во сколько раз значение в движке больше записанного: % → доли 1/10 000, Н → сотые, мин → с, мкм → мкм. */
export const ATTR_SCALE = { qual: 1, pct: 100, N: 100, min: 60, um: 1 } as const;

/** Качественные свойства: в спецификации у них нет пределов. */
export const QUALITATIVE: readonly Attr[] = ['identity', 'appearance'];

/** Материал (геймдизайн, §4.1). Единица учёта — масса (мг) или штуки. */
export interface Material {
  id: Id;
  kind: MaterialKind;
  name: Text;
  /** `mass` — количество в миллиграммах; `pcs` — в штуках */
  unit: 'mass' | 'pcs';
  /** в чём приходит */
  container: Id;
  /** условия хранения: склад или холодная камера */
  storage: 'room' | 'cold';
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
  /** допуски роли: `forklift` — водить ричтрак */
  permits: string[];
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
  /** какой допуск нужен водителю */
  permit?: string;
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

/** План завода прототипа (docs/specs/2026-10-engine.md, «План завода прототипа»). Координаты — сантиметры участка. */
export interface Plant {
  id: Id;
  docks: { id: string; kind: 'in' | 'out'; x: number; z: number }[];
  /** зона на полу: прямоугольник [x, z, ширина, глубина] и места сеткой [столбцов, рядов] */
  zones: { id: string; kind: ZoneKind; rect: [number, number, number, number]; grid: [number, number] }[];
  /** ряды стеллажей: начало ряда, секций, ярусов */
  racks: { id: string; x: number; z: number; bays: number; levels: number }[];
  rooms: { id: string; type: string; rect: [number, number, number, number]; grade: 'D' | 'cnc' }[];
  /** приборы лаборатории: вид и помещение */
  instruments: { id: string; type: Id; room: string }[];
  /** оборудование производства: вид и помещение */
  equipment: { id: string; type: Id; room: string }[];
  /**
   * упаковочные линии: помещение, зона паллетирования на выходе, машины по порядку; после машины — накопитель на
   * `buffer` её штук (у последней — нет)
   */
  lines: { id: string; room: string; out: string; machines: { id: string; type: Id; buffer?: number }[] }[];
  /** точки: стоянка техники, вход персонала */
  points: { park: [number, number]; entrance: [number, number] };
  /** вентиляция — Вт на м² помещения по классу, круглые сутки; постоянная база — Вт */
  energy: { hvac: { D: number; cnc: number }; base: number };
}

/** Вид прибора лаборатории (геймдизайн, §6.2); экземпляры — в плане завода. */
export interface InstrumentType {
  id: Id;
  name: Text;
}

/** Методика испытания (геймдизайн, §6.2). */
export interface TestMethod {
  id: Id;
  name: Text;
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

export interface Spec {
  id: Id;
  tests: SpecLine[];
  source?: string[];
  review?: Review;
}

/** Продукт: лекарство по МНН и форма. */
export interface Product {
  id: Id;
  name: Text;
  inn: string;
  form: 'tablet';
  /** в перечне ЖНВЛП: цена позиции — не выше зарегистрированной */
  jnvlp: boolean;
  source?: string[];
  review?: Review;
}

/** Вид оборудования производства: уборка малая и большая, с (геймдизайн, §5.5). */
export interface EquipmentType {
  id: Id;
  name: Text;
  cleaning: { minor: number; major: number };
  /** мощность, пока идёт стадия, Вт */
  kw: number;
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
  /** потери стадии: среднее и разброс, доли 1/10 000 от массы на входе */
  loss: [number, number];
}

/** Технологическая карта (docs/04-data-model.md, §4–5). Массы — мг, доли — 1/10 000. */
export interface Recipe {
  id: Id;
  name: Text;
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

/** Откуда вклад причины: отход режима от цели; содержание АФС против измеренного; свойство отвешенных партий; показатель. */
export type CauseDriver = { param: string } | { potency: true } | { lots: 'api' | 'excipient'; attr: Attr } | { attr: Attr };

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
 * Машина упаковочной линии (геймдизайн, §5.6): номинал — блистеров или пачек в минуту; микроостановки — в среднем раз в
 * `every` секунд работы на номинале, длятся в среднем `duration` секунд; брак камеры — доли 1/10 000 выхода; переналадка
 * на другой формат, с.
 */
export interface Machine {
  id: Id;
  name: Text;
  item: 'blister' | 'carton';
  nominal: number;
  crew: { role: Id; n: number };
  micro?: { every: number; duration: number };
  reject: number;
  changeover: number;
  /** мощность на ходу, Вт */
  kw: number;
  source?: string[];
  review?: Review;
}

/** Товарная позиция (docs/04-data-model.md, §4). Материалы на блистер — мг, на пачку — штуки. */
export interface Sku {
  id: Id;
  name: Text;
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
  waste: { blisters: number; cartons: number };
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
  machines: Record<Id, Machine>;
  skus: Record<Id, Sku>;
  customers: Record<Id, Customer>;
}
