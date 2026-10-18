// из bolnitsa: src/ui/store.ts @ e0a3491 — изменено: поля завода вместо больницы.
// Хранилище панелей: игра пишет сюда не чаще 10 раз в секунду, панели читают через `useSyncExternalStore`. Снимок
// неизменяемый: каждое `set` — новый объект.
import { useSyncExternalStore } from 'react';
import type { Ymd } from '../engine/core/calendar';
import type { Lang } from '../i18n';
import type { Quality } from '../render/view';
import type { WallMode } from '../render/world';
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
}

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
