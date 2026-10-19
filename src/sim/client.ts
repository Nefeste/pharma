// из bolnitsa: src/sim/client.ts @ e0a3491 — изменено: завод вместо смены; без режима врача и мира больницы; `ahead` —
// на сколько часы окна ушли вперёд среза («живое время», docs/specs/2026-10-view.md, 2в); виды панелей (3б). Исправлено
// (перенести в «Больницу»): `tick` в пути освобождает только ответ на `tick` — ответ на команду его не освобождает.
// Исправлено (перенести в «Больницу»): счёт `roundTripsTaken` — память времён обрезана, и отметка начала прогона бенча
// длиной массива давала пустую выборку со второго прогона. Автопауза (Б2а): `tick` несёт виды извещений, на которых встать
// (`stop`); срез, вставший на таком, помечен `stopped`, и окно сбрасывает долг (`drop`).
// Сторона потока отрисовки: Web Worker с движком, ход часов кадрами, последний срез. В пути — не больше одного `tick`:
// пока ответ не пришёл, игровые секунды копятся, и поток не захлёбывается кадрами, если не успевает.
import type { Command, Notice } from '../engine/types';
import type { FromSim, ToSim } from './protocol';
import type { ViewOut, ViewQuery } from './views';

export interface Slice {
  buf: Int32Array;
  notices: Notice[];
  lag: number;
  /** виды панелей, которые изменились (3б) */
  views?: ViewOut[];
  /** поток встал на извещении автопаузы (Б2а): часы завода — на его событии */
  stopped?: true;
}

export class SimClient {
  private worker: Worker;
  private ticking = false;
  /** игровые секунды, которые часы игры прошли, а в поток ещё не отправлены (с дробью) */
  private owed = 0;
  /** секунды `tick` в пути */
  private sent = 0;
  private saves: ((json: string) => void)[] = [];
  /** время на поток: от отправки `tick` до ответа, мс — для бенча; последние 1000–2000 */
  readonly roundTrips: number[] = [];
  /** сколько времён пришло всего: отметка начала прогона бенча (`since` в src/app/stats.ts) */
  roundTripsTaken = 0;
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
    if (msg.kind === 'saved') {
      this.saves.shift()?.(msg.json);
      return;
    }
    // ответ на команду или виды не освобождает `tick` в пути: иначе их стало бы два
    if (this.ticking && msg.tick) {
      this.ticking = false;
      this.roundTrips.push(performance.now() - this.sentAt);
      this.roundTripsTaken++;
      if (this.roundTrips.length > 2000) this.roundTrips.splice(0, 1000);
    }
    this.onSlice({ buf: msg.buf, notices: msg.notices, lag: msg.lag, ...(msg.views ? { views: msg.views } : {}), ...(msg.stopped ? { stopped: true as const } : {}) });
  }

  start(msg: Extract<ToSim, { kind: 'start' }>) {
    this.owed = 0;
    this.post(msg);
  }

  command(cmd: Command) {
    this.post({ kind: 'command', cmd });
  }

  /** Открытые виды панелей — весь набор: поток пришлёт их со срезом, а дальше — когда изменятся. */
  views(list: ViewQuery[]) {
    this.post({ kind: 'views', views: list });
  }

  /** `tick` в пути: промотка добавляет секунды, только когда поток ответил, — иначе долг копится быстрее, чем поток считает. */
  get busy(): boolean {
    return this.ticking;
  }

  /**
   * Кадр: часам прибавилось `gameSeconds` (с дробью); поток получает целые секунды и бюджет — и виды извещений, на которых
   * встать (Б2а).
   */
  frame(gameSeconds: number, budgetMs: number, stop?: readonly Notice['kind'][]) {
    this.owed += gameSeconds;
    if (this.ticking) return;
    const seconds = Math.floor(this.owed);
    this.owed -= seconds;
    this.sent = seconds;
    this.ticking = true;
    this.sentAt = performance.now();
    this.post({ kind: 'tick', seconds, budgetMs, ...(stop && stop.length > 0 ? { stop: [...stop] } : {}) });
  }

  /** Поток встал на автопаузе (Б2а): секунды, которые часы окна набрали сверх, не отправлять. */
  drop() {
    this.owed = 0;
  }

  /** На сколько игровых секунд часы окна ушли вперёд последнего среза: `tick` в пути и долг с дробью. */
  get ahead(): number {
    return (this.ticking ? this.sent : 0) + this.owed;
  }

  /** Снимок состояния строкой: окно его не разбирает, а отдаёт главному процессу на запись. */
  save(): Promise<string> {
    return new Promise(resolve => {
      this.saves.push(resolve);
      this.post({ kind: 'save' });
    });
  }

  terminate() {
    this.worker.terminate();
  }
}
