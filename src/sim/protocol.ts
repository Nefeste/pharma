// Обмен между потоком отрисовки и потоком расчёта (docs/02-architecture.md, §10; устройство — как у «Больницы», её
// src/sim/protocol.ts). Завод считается в Web Worker, отрисовка — в основном потоке. Туда — команды и ход часов,
// обратно — упакованный срез (pack.ts) и извещения. Сообщения — structured clone; массив среза передаётся без копии.
// Сохранение ходит строкой: состояние с истинными свойствами партий окно не разбирает (§9) — его пишет и читает поток
// расчёта, со своими миграциями (src/engine/save.ts).
import type { Id } from '../content/types';
import type { Command, Notice } from '../engine/types';

export type ToSim =
  /** новая партия по сценарию */
  | { kind: 'start'; scenario: Id; seed?: number }
  /** открыть сохранение — снимок состояния строкой (src/engine/save.ts) */
  | { kind: 'load'; json: string }
  /** действие игрока или руководителя — как `apply` */
  | { kind: 'command'; cmd: Command }
  /**
   * кадр: часам игры прибавилось `seconds` игровых секунд (пауза — 0); движку — `budgetMs` мс. Не успел — часы завода
   * отстают и догоняют в следующих кадрах
   */
  | { kind: 'tick'; seconds: number; budgetMs: number }
  /** сохранить: вернуть снимок */
  | { kind: 'save' };

export type FromSim =
  /** после каждого `tick` и `command`: срез, извещения, на сколько часы завода отстают от часов игры (игровые секунды) */
  | { kind: 'slice'; buf: Int32Array; notices: Notice[]; lag: number }
  /** ответ на `save`: снимок состояния строкой */
  | { kind: 'saved'; json: string }
  | { kind: 'error'; message: string };
