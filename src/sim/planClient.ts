// Поток прогона плана со стороны окна (docs/specs/2026-10-plan-run.md, «Второй поток»): свой Web Worker (planWorker.ts)
// заводится к первому прогону; снимок — строкой от потока расчёта, окно его не разбирает. «Прервать» останавливает поток,
// следующий прогон заведёт новый. Ответы прежнего прогона узнаются по номеру и не доходят до окна.
import type { Command } from '../engine/types';
import type { FromPlan } from './protocol';

export class PlanClient {
  private worker?: Worker;
  /** номер текущего прогона: ответы с другим номером — от прерванного */
  private id = 0;
  onVariant: (m: Extract<FromPlan, { kind: 'variant' }>) => void = () => {};
  onDone: (m: Extract<FromPlan, { kind: 'done' }>) => void = () => {};
  onError: (message: string) => void = () => {};

  constructor(private readonly url: string) {}

  private spawn(): Worker {
    const w = new Worker(this.url);
    w.onmessage = (e: MessageEvent<FromPlan>) => this.receive(e.data);
    w.onerror = e => this.onError(e.message);
    return w;
  }

  private receive(msg: FromPlan) {
    // ошибка загрузки базы — без номера прогона
    if (msg.kind === 'error' && msg.id < 0) return this.onError(msg.message);
    if (msg.id !== this.id) return;
    if (msg.kind === 'variant') this.onVariant(msg);
    else if (msg.kind === 'done') this.onDone(msg);
    else this.onError(msg.message);
  }

  /** Прогнать варианты на снимке `json`: `days` суток, `seeds` зёрен; прежний прогон, если он идёт, больше не слышен. */
  run(json: string, variants: Command[][], days: number, seeds: number) {
    this.worker ??= this.spawn();
    this.id++;
    this.worker.postMessage({ kind: 'run', id: this.id, json, variants, days, seeds });
  }

  /** Прервать: поток останавливается сразу, посреди счёта. */
  stop() {
    this.worker?.terminate();
    this.worker = undefined;
    this.id++;
  }
}
