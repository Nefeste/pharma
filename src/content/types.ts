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
  /** маркировка пачек кодами и агрегирование в короба и паллеты */
  marking: { packs: boolean; aggregation: 'optional' | 'required' };
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
  staff: StaffRow[];
  vehicles: { type: Id; n: number }[];
  orders: StartOrder[];
  stock: StartStock[];
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

export type MaterialKind = 'api' | 'excipient' | 'packaging';

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
  source?: string[];
  review?: Review;
}

/** Вид груза для отрисовки (src/render/loads.ts). */
export type LoadKind = 'cases' | 'drums' | 'bags' | 'rolls';

/** Тара материала: бочка, мешок, рулон, коробка, пачка гофроящиков. */
export interface ContainerType {
  id: Id;
  name: Text;
  kind: 'drum' | 'bag' | 'roll' | 'box' | 'bundle';
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

export type ZoneKind = 'receiving' | 'quarantine' | 'cold' | 'rejected' | 'fgQuarantine' | 'shipping' | 'staging';

/** План завода прототипа (docs/specs/2026-10-engine.md, «План завода прототипа»). Координаты — сантиметры участка. */
export interface Plant {
  id: Id;
  docks: { id: string; kind: 'in' | 'out'; x: number; z: number }[];
  /** зона на полу: прямоугольник [x, z, ширина, глубина] и места сеткой [столбцов, рядов] */
  zones: { id: string; kind: ZoneKind; rect: [number, number, number, number]; grid: [number, number] }[];
  /** ряды стеллажей: начало ряда, секций, ярусов */
  racks: { id: string; x: number; z: number; bays: number; levels: number }[];
  rooms: { id: string; type: string; rect: [number, number, number, number]; grade: 'D' | 'cnc' }[];
  /** точки: стоянка техники, вход персонала */
  points: { park: [number, number]; entrance: [number, number] };
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
}
