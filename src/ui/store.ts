// из bolnitsa: src/ui/store.ts @ e0a3491 — изменено: поля завода вместо больницы.
// Хранилище панелей: игра пишет сюда не чаще 10 раз в секунду, панели читают через `useSyncExternalStore`. Снимок
// неизменяемый: каждое `set` — новый объект.
import { useSyncExternalStore } from 'react';
import type { SeatId } from '../content/types';
import type { Ymd } from '../engine/core/calendar';
import type { RunSum } from '../engine/plan/run';
import type { Change } from '../engine/plan/schedule';
import type { Lang } from '../i18n';
import type { Quality } from '../render/view';
import type { WallMode } from '../render/world';
import type { ChartView, LabView } from '../sim/lab';
import type { BatchLabel, GanttView, GhostView } from '../sim/plan';
import type { CashView, MorningView, TopView } from '../sim/report';
import type { CardView, StockQuery, StockView, Thing } from '../sim/views';

/** Скорости геймдизайна (§2): 0 — пауза; 1–4 — минута, 5 минут, 20 минут, 2 часа за секунду; 5 — «живое время» 1:1. */
export type Speed = 0 | 1 | 2 | 3 | 4 | 5;
export const LIVE: Speed = 5;

export interface Hud {
  ready: boolean;
  error?: string;
  lang: Lang;
  version: string;
  /** дата начала и часы завода из последнего среза */
  start: Ymd;
  t: number;
  day: number;
  speed: Speed;
  /** промотка «До утра» */
  ff: boolean;
  /** на сколько игровых минут расчёт отстаёт */
  lag: number;
  notices: { t: number; text: string }[];
  debug: boolean;
  quality: Quality;
  /** стены: целые, срез у камеры, вниз */
  walls: WallMode;
  fps: number;
  cpuMs: number;
  gpuMs: number | null;
  /** строка состояния: авто-бенч и снимки */
  status: string;
  /** панель склада (3б): открыта ли, запрос и последний вид из потока расчёта */
  stock: { open: boolean; query: StockQuery; view?: StockView };
  /** выбранная вещь и её карточка (3б) */
  selected?: Thing;
  card?: CardView;
  /** планёрка (3в): открыта ли, на какие сутки, вид; пауза на планёрке — до перезапуска игры */
  morning: { open: boolean; day?: number; view?: MorningView };
  morningPause: boolean;
  /** панель кассы (3в): открыта ли, страница календаря, вид */
  cash: { open: boolean; page: number; view?: CashView };
  /** касса верхней полосы */
  top?: TopView;
  /** панель лаборатории (3г): открыта ли, вкладка; очередь и контрольная карта средней массы */
  lab: { open: boolean; tab: 'queue' | 'chart'; view?: LabView; chart?: ChartView };
  /**
   * расписание (3д): открыто ли; окно времени — с какого мгновения (нет — от полуночи, вслед за часами) и сколько суток;
   * вид; задание, которое тянут, и куда, — и его призрак; черновик (часть 5) — новые сроки заданий, ещё не команды: он
   * живёт и при закрытом окне
   */
  gantt: {
    open: boolean;
    from?: number;
    days: GanttDays;
    view?: GanttView;
    drag?: { batch: string; notBefore: number };
    ghost?: GhostView;
    draft: readonly Change[];
  };
  /** прогон плана (часть 5) */
  plan: PlanRun;
  /** экран «Кем вы будете» (3е): открыт ли, что отмечено */
  seats: { open: boolean; pick: SeatId[] };
}

/**
 * Держит ли игрок место, чьи команды нужны: места не выбраны — всё можно, как до 3е; директор в прототипе отвечает за
 * всё. Окно гасит чужое, движок отказывает (src/engine/seats.ts, `foreign`).
 */
export function holds(h: Hud, seat: SeatId): boolean {
  const mine = h.top?.seats;
  return !mine || mine.includes('director') || mine.includes(seat);
}

/**
 * Прогон плана в окне (docs/specs/2026-10-plan-run.md): идёт ли; сколько вариантов — «как сейчас» и, если был черновик,
 * «черновик»; черновик, с которым прогнали, строкой — изменился с тех пор, и итог говорит о прежнем; мгновение снимка; итоги
 * вариантов по порядку; подписи серий снимка; сколько миллисекунд считал поток; ошибка.
 */
export interface PlanRun {
  running: boolean;
  variants: number;
  key?: string;
  at?: number;
  sums: (RunSum | undefined)[];
  batches: Record<string, BatchLabel>;
  ms?: number;
  error?: string;
}

export const NO_RUN: PlanRun = { running: false, variants: 0, sums: [], batches: {} };

/** Прогон плана в прототипе: 14 суток × 5 зёрен (спецификация прототипа, часть 5; геймдизайн, §9.5). */
export const PLAN_RUN = { days: 14, seeds: 5 };

/** Окно расписания, суток: сегодня; вчера, сегодня и завтра; вчера, сегодня и неделя вперёд. */
export type GanttDays = 1 | 3 | 9;

/** Запрос склада по умолчанию: все партии по номеру, первая страница. */
export const STOCK: StockQuery = { view: 'stock', status: [], kinds: [], sort: 'code', desc: false, page: 0, lang: 'ru' };

export const initial: Hud = {
  ready: false,
  lang: 'ru',
  version: '',
  start: { y: 2027, m: 9, d: 1 },
  t: 0,
  day: 0,
  speed: 1,
  ff: false,
  lag: 0,
  notices: [],
  debug: false,
  quality: 'medium',
  walls: 'cut',
  fps: 0,
  cpuMs: 0,
  gpuMs: null,
  status: '',
  stock: { open: false, query: STOCK },
  morning: { open: false },
  morningPause: true,
  cash: { open: false, page: 0 },
  lab: { open: false, tab: 'queue' },
  gantt: { open: false, days: 3, draft: [] },
  plan: NO_RUN,
  seats: { open: false, pick: [] },
};

export interface Actions {
  setSpeed(s: Speed): void;
  untilMorning(): void;
  setQuality(q: Quality): void;
  setWalls(m: WallMode): void;
  toggleDebug(): void;
  /** авто-бенч; без vsync — перезапуск оболочки с ключом `--uncapped` */
  bench(uncapped: boolean): void;
  /** панель склада: открыть или закрыть; сменить фильтр, сортировку, страницу */
  toggleStock(): void;
  setStock(patch: Partial<Omit<StockQuery, 'view'>>): void;
  /** выбрать вещь (`undefined` — снять выбор) */
  select(t: Thing | undefined): void;
  /** камера — к паллете, паллета — выбрана */
  showUnit(n: number): void;
  /** камера — к вещи (паллета, машина, оборудование), вещь — выбрана */
  show(t: Thing): void;
  /** планёрка: открыть последнюю; закрыть — и включить скорость, что была до паузы планёрки; пауза на планёрке */
  openMorning(): void;
  closeMorning(resume: boolean): void;
  setMorningPause(on: boolean): void;
  /** панель кассы: открыть или закрыть; страница календаря */
  toggleCash(): void;
  setCashPage(page: number): void;
  /** панель лаборатории: открыть или закрыть; вкладка; поднять пробу партии — команда `rush` */
  toggleLab(): void;
  setLabTab(tab: 'queue' | 'chart'): void;
  rush(lot: string): void;
  /**
   * расписание: открыть или закрыть; окно — сутки, трое, неделя; на сутки назад, вперёд, к сегодня (0); тянуть задание —
   * призрак с новым сроком; отпустить — строка черновика; отменить; утвердить черновик — команды `shift`; сбросить его
   */
  toggleGantt(): void;
  setGanttDays(days: GanttDays): void;
  moveGantt(dir: -1 | 0 | 1): void;
  drag(batch: string, notBefore: number): void;
  drop(): void;
  cancelDrag(): void;
  approveDraft(): void;
  resetDraft(): void;
  /** прогон плана: «как сейчас» и черновик, если он есть, — во втором потоке; прервать */
  runPlan(): void;
  stopPlan(): void;
  /** экран «Кем вы будете»: открыть — мир на паузе; отметить место; взять отмеченные — команда `seat`; закрыть без смены */
  openSeats(): void;
  pickSeat(seat: SeatId): void;
  takeSeats(): void;
  closeSeats(): void;
}

export class Store {
  private state: Hud = initial;
  private listeners = new Set<() => void>();

  get = () => this.state;

  set(patch: Partial<Hud>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export function useHud(store: Store): Hud {
  return useSyncExternalStore(store.subscribe, store.get);
}
