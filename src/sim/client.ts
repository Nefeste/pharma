// из bolnitsa: src/sim/client.ts @ e0a3491 — изменено: завод вместо смены; без режима врача и мира больницы.
// Сторона потока отрисовки: Web Worker с движком, ход часов кадрами, последний срез. В пути — не больше одного `tick`:
// пока ответ не пришёл, игровые секунды копятся, и поток не захлёбывается кадрами, если не успевает.
import type { Command, Notice, PlantState } from '../engine/types';
import type { FromSim, ToSim } from './protocol';

export interface Slice {
  buf: Int32Array;
  notices: Notice[];
  lag: number;
}

export class SimClient {
  private worker: Worker;
  private ticking = false;
  /** игровые секунды, которые часы игры прошли, а в поток ещё не отправлены (с дробью) */
  private owed = 0;
  private saves: ((s: PlantState) => void)[] = [];
  /** время на поток: от отправки `tick` до ответа, мс — для бенча */
  readonly roundTrips: number[] = [];
  private sentAt = 0;
  onSlice: (s: Slice) => void = () => {};
  onError: (message: string) => void = () => {};

  constructor(url: string) {
    this.worker = new Worker(url);
    this.worker.onmessage = (e: MessageEvent<FromSim>) => this.receive(e.data);
    this.worker.onerror = e => this.onError(e.message);
  }

  private post(msg: ToSim) {
    this.worker.postMessage(msg);
  }

  private receive(msg: FromSim) {
    if (msg.kind === 'error') return this.onError(msg.message);
    if (msg.kind === 'state') {
      this.saves.shift()?.(msg.state);
      return;
    }
    if (this.ticking) {
      this.ticking = false;
      this.roundTrips.push(performance.now() - this.sentAt);
      if (this.roundTrips.length > 2000) this.roundTrips.splice(0, 1000);
    }
    this.onSlice({ buf: msg.buf, notices: msg.notices, lag: msg.lag });
  }

  start(msg: Extract<ToSim, { kind: 'start' }>) {
    this.owed = 0;
    this.post(msg);
  }

  command(cmd: Command) {
    this.post({ kind: 'command', cmd });
  }

  /** `tick` в пути: промотка добавляет секунды, только когда поток ответил, — иначе долг копится быстрее, чем поток считает. */
  get busy(): boolean {
    return this.ticking;
  }

  /** Кадр: часам прибавилось `gameSeconds` (с дробью); поток получает целые секунды и бюджет. */
  frame(gameSeconds: number, budgetMs: number) {
    this.owed += gameSeconds;
    if (this.ticking) return;
    const seconds = Math.floor(this.owed);
    this.owed -= seconds;
    this.ticking = true;
    this.sentAt = performance.now();
    this.post({ kind: 'tick', seconds, budgetMs });
  }

  save(): Promise<PlantState> {
    return new Promise(resolve => {
      this.saves.push(resolve);
      this.post({ kind: 'save' });
    });
  }

  terminate() {
    this.worker.terminate();
  }
}
