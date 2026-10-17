// Состояние завода и обмен с движком (docs/02-architecture.md, §1, §3, §7). Состояние — обычный сериализуемый объект:
// сохранение — его снимок со схемой и миграциями (ADR студии 0004). Модули части 1 (склад, серия, линия, лаборатория…)
// добавят сюда свои части, события, команды и извещения.
import type { Id } from '../content/types';
import type { Agenda } from './core/agenda';
import type { Ymd } from './core/calendar';
import type { RngState } from './core/rng';

/** Версия схемы сохранения. Изменился формат — шаг миграции (src/engine/save.ts) и образец в тестах. */
export const SCHEMA = 1;

/** События в очереди движка. */
export type PlantEvent =
  /** планёрка в 08:00: итог суток (геймдизайн, §2, §18) */
  { kind: 'morning' };

export interface PlantState {
  schema: number;
  /** отпечаток базы, с которой начата партия */
  content: string;
  scenario: Id;
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
}

/** Команда — единственный способ изменить состояние (docs/02-architecture.md, §7). */
export type Command =
  /** течение времени */
  { kind: 'advance'; seconds: number };

/** Извещение для окна: что случилось за время команды. */
export type Notice =
  /** планёрка: начались сутки `day` */
  { kind: 'morning'; day: number };
