// из bolnitsa: src/ui/store.ts @ e0a3491 — изменено: поля завода вместо больницы.
// Хранилище панелей: игра пишет сюда не чаще 10 раз в секунду, панели читают через `useSyncExternalStore`. Снимок
// неизменяемый: каждое `set` — новый объект.
import { useSyncExternalStore } from 'react';
import type { Ymd } from '../engine/core/calendar';
import type { Lang } from '../i18n';
import type { Quality } from '../render/view';
import type { WallMode } from '../render/world';
import type { ChartView, LabView } from '../sim/lab';
import type { GanttView, GhostView } from '../sim/plan';
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
   * вид; задание, которое тянут, и куда, — и его призрак
   */
  gantt: { open: boolean; from?: number; days: GanttDays; view?: GanttView; drag?: { batch: string; notBefore: number }; ghost?: GhostView };
}

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
  gantt: { open: false, days: 3 },
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
   * призрак с новым сроком; отпустить — команда `shift`; отменить
   */
  toggleGantt(): void;
  setGanttDays(days: GanttDays): void;
  moveGantt(dir: -1 | 0 | 1): void;
  drag(batch: string, notBefore: number): void;
  drop(): void;
  cancelDrag(): void;
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
