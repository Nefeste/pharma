// Обмен между потоком отрисовки и потоком расчёта (docs/02-architecture.md, §10; устройство — как у «Больницы», её
// src/sim/protocol.ts). Завод считается в Web Worker, отрисовка — в основном потоке. Туда — команды, ход часов и какие
// виды панелей открыты; обратно — упакованный срез (pack.ts), извещения и изменившиеся виды (views.ts, 3б). Сообщения —
// structured clone; массив среза передаётся без копии.
// Сохранение ходит строкой: состояние с истинными свойствами партий окно не разбирает (§9) — его пишет и читает поток
// расчёта, со своими миграциями (src/engine/save.ts).
import type { Id } from '../content/types';
import type { RunSum } from '../engine/plan/run';
import type { Command, Notice } from '../engine/types';
import type { BatchLabel } from './plan';
import type { ViewOut, ViewQuery } from './views';

export type ToSim =
  /** новая партия по сценарию */
  | { kind: 'start'; scenario: Id; seed?: number }
  /** открыть сохранение — снимок состояния строкой (src/engine/save.ts) */
  | { kind: 'load'; json: string }
  /** действие игрока или руководителя — как `apply` */
  | { kind: 'command'; cmd: Command }
  /**
   * кадр: часам игры прибавилось `seconds` игровых секунд (пауза — 0); движку — `budgetMs` мс. Не успел — часы завода
   * отстают и догоняют в следующих кадрах. `stop` — виды извещений автопауз игрока (Б2а): на таком извещении поток встаёт
   * сразу за его событием, а недожитое время пропадает
   */
  | { kind: 'tick'; seconds: number; budgetMs: number; stop?: Notice['kind'][] }
  /** сохранить: вернуть снимок */
  | { kind: 'save' }
  /** открытые виды панелей — весь набор (docs/specs/2026-10-panels.md, 3б): собрать и прислать со срезом */
  | { kind: 'views'; views: ViewQuery[] };

export type FromSim =
  /**
   * после каждого `tick`, `command` и `views`: срез, извещения, на сколько часы завода отстают от часов игры (игровые
   * секунды); виды панелей, которые изменились; `tick` — это ответ на `tick` (клиент держит в пути не больше одного);
   * `stopped` — `tick` встал на извещении автопаузы: часы завода — на его событии, отставания нет
   */
  | { kind: 'slice'; buf: Int32Array; notices: Notice[]; lag: number; views?: ViewOut[]; tick?: true; stopped?: true }
  /** ответ на `save`: снимок состояния строкой */
  | { kind: 'saved'; json: string }
  | { kind: 'error'; message: string };

/**
 * Поток прогона плана (docs/specs/2026-10-plan-run.md): снимок состояния строкой — как сохранение, окно его не разбирает;
 * варианты — команды игрока; горизонт, сутки, и число зёрен.
 */
export type ToPlan = { kind: 'run'; id: number; json: string; variants: Command[][]; days: number; seeds: number };

export type FromPlan =
  /**
   * итог варианта `index`, когда он готов: мгновение снимка, подписи его серий (номер серии или задания — каким он был к
   * снимку), сколько миллисекунд считался
   */
  | { kind: 'variant'; id: number; index: number; at: number; sum: RunSum; batches: Record<string, BatchLabel>; ms: number }
  /** все варианты готовы */
  | { kind: 'done'; id: number; ms: number }
  | { kind: 'error'; id: number; message: string };
