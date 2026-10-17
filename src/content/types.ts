// Типы собранной базы игры (docs/04-data-model.md, §3). Исходные записи — YAML в content/, сборка и валидатор —
// tools/content/ (`npm run content` → src/content/generated/bundle.json). Числа здесь — уже в единицах движка
// (docs/04-data-model.md, §2): сантиметры, килограммы, доли 1/10 000.
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

/** Сценарий: с чего начинается партия. */
export interface Scenario {
  id: Id;
  name: Text;
  profile: Id;
  /** дата и час начала по часам завода */
  start: { date: Ymd; hour: number };
  /** зерно по умолчанию; песочница даёт своё */
  seed: number;
  /** участок в клетках 1 × 1 м */
  site: { w: number; h: number };
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

export interface ContentDb {
  /** отпечаток базы: сохранение помнит, с какой базой оно сделано */
  hash: string;
  profiles: Record<Id, Profile>;
  scenarios: Record<Id, Scenario>;
  units: Record<Id, UnitType>;
}
