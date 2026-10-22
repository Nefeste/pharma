// из bolnitsa: src/ui/store.ts @ e0a3491 — изменено: поля завода вместо больницы.
// Хранилище панелей: игра пишет сюда не чаще 10 раз в секунду, панели читают через `useSyncExternalStore`. Снимок
// неизменяемый: каждое `set` — новый объект.
import { useSyncExternalStore } from 'react';
import type { Go, Pause } from '../app/pauses';
import type { Dept, Id, OvertimeMode, SeatId } from '../content/types';
import type { Ymd } from '../engine/core/calendar';
import type { RunSum } from '../engine/plan/run';
import type { Change } from '../engine/plan/schedule';
import type { Lang } from '../i18n';
import type { Quality } from '../render/view';
import type { WallMode } from '../render/world';
import type { InvView } from '../sim/inv';
import type { ChartView, LabView } from '../sim/lab';
import type { BatchLabel, GanttView, GhostView } from '../sim/plan';
import type { NowRow, NowView } from '../sim/now';
import type { RefView } from '../sim/ref';
import type { CashView, MorningView, TopView } from '../sim/report';
import type { CardView, StockQuery, StockView, Thing } from '../sim/views';
import type { Urgent } from './draft';

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
  /** промотка: «До утра» или «До события» (Б2а) */
  ff: boolean;
  ffTo: 'morning' | 'event';
  /** на сколько игровых минут расчёт отстаёт */
  lag: number;
  /**
   * извещения; `stop` — на нём мир встал (автопауза, Б2а); `go` — куда ведёт щелчок: вещь, окно или доска расследования
   */
  notices: { t: number; text: string; stop?: true; go?: Go }[];
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
  /** планёрка (3в): открыта ли, на какие сутки, вид */
  morning: { open: boolean; day?: number; view?: MorningView };
  /** автопаузы (Б2а): открыто ли меню; какие отключены — запоминается в окне (src/app/pauses.ts) */
  pauses: { open: boolean; off: Pause[] };
  /** панель кассы (3в): открыта ли, страница календаря, вид */
  cash: { open: boolean; page: number; view?: CashView };
  /** касса верхней полосы */
  top?: TopView;
  /** панель лаборатории (3г): открыта ли, вкладка; очередь и контрольная карта средней массы */
  lab: { open: boolean; tab: 'queue' | 'chart'; view?: LabView; chart?: ChartView };
  /** «Сейчас» (Б1б): открыта ли панель; вид — и при закрытой, пока открыта карточка или игрок смотрит работу */
  now: { open: boolean; view?: NowView };
  /** «Смотреть»: какую работу — строка «Сейчас» в мгновение, когда начали смотреть */
  watch?: NowRow;
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
    /** срочные задания черновика (Б1г): командами `order` станут при «Утвердить» */
    urgent: readonly Urgent[];
  };
  /** прогон плана (часть 5) */
  plan: PlanRun;
  /** доска расследования (часть 4б): открыта ли, какое расследование выбрано (нет — последнее открытое), вид */
  inv: { open: boolean; id?: string; view?: InvView };
  /** экран «Кем вы будете» (3е): открыт ли, что отмечено */
  seats: { open: boolean; pick: SeatId[] };
  /** справочник завода (этап Б, Б1а): открыт ли, вкладка, вид */
  ref: { open: boolean; tab: RefTab; view?: RefView };
  /** слой «Потоки — люди» (Б1г): стрелки переходов людей между помещениями вместо перевозок паллет */
  flows: boolean;
  /** пояснения при первом событии (Б1г): виды, которые игрок уже понял, — запоминаются в окне (src/app/firsts.ts) */
  firsts: readonly string[];
}

/** Вкладки справочника завода: продукты, карты, оборудование, лаборатория, люди, контрагенты. */
export const REF_TABS = ['products', 'materials', 'recipes', 'equipment', 'places', 'lab', 'people', 'partners', 'docs'] as const;
export type RefTab = (typeof REF_TABS)[number];

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
  ffTo: 'morning',
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
  pauses: { open: false, off: [] },
  cash: { open: false, page: 0 },
  lab: { open: false, tab: 'queue' },
  now: { open: false },
  gantt: { open: false, days: 3, draft: [], urgent: [] },
  plan: NO_RUN,
  inv: { open: false },
  seats: { open: false, pick: [] },
  ref: { open: false, tab: 'recipes' },
  flows: false,
  firsts: [],
};

export interface Actions {
  setSpeed(s: Speed): void;
  /** промотка до 08:00 (5); до первого события автопаузы (6, Б2а) */
  untilMorning(): void;
  untilEvent(): void;
  /** меню автопауз: открыть или закрыть; включить или отключить автопаузу — запоминается в окне */
  togglePauses(): void;
  setPause(p: Pause, on: boolean): void;
  /** щелчок по извещению: к вещи, в окно или на доску расследования */
  go(g: Go): void;
  setQuality(q: Quality): void;
  /** пресет, выбранный игроком: применить и запомнить (src/app/preset.ts) */
  pickQuality(q: Quality): void;
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
  /** камера — к вещи (паллета, машина, оборудование, фура во дворе), вещь — выбрана */
  show(t: Thing): void;
  /** планёрка: открыть последнюю; закрыть — и включить скорость, что была до паузы планёрки */
  openMorning(): void;
  closeMorning(resume: boolean): void;
  /** панель кассы: открыть или закрыть; страница календаря */
  toggleCash(): void;
  setCashPage(page: number): void;
  /** панель лаборатории: открыть или закрыть; вкладка; поднять пробу партии — команда `rush` */
  toggleLab(): void;
  /** «Сейчас»: открыть или закрыть (N) */
  toggleNow(): void;
  /** «Смотреть» работу по ключу строки «Сейчас»: камера к месту, ×1, пока работа не кончится; затем — прежняя скорость */
  watch(key: string): void;
  unwatch(): void;
  setLabTab(tab: 'queue' | 'chart'): void;
  rush(lot: string): void;
  /** политика отдела «Сверхурочные» (Б4а) — команда `overtime` */
  overtime(dept: Dept, mode: OvertimeMode): void;
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
  /**
   * доска расследования: открыть или закрыть; открыть на расследовании; шаг — команда `investigate`; решение — команда
   * `conclude`
   */
  toggleInv(): void;
  openInv(id: string): void;
  /** справочник завода: открыть или закрыть (F1), вкладка */
  toggleRef(): void;
  setRefTab(tab: RefTab): void;
  investigate(inv: string, step: string): void;
  conclude(inv: string, cause: string, fate: 'reject' | 'release'): void;
  /**
   * решение по серии на выпуске (Б1г) — команда `release`; оценка влияния отклонения — команда `assess`; срочное
   * задание позиции — в черновик расписания, расписание открывается; слой «Потоки — люди» — включить или снять;
   * пояснение при первом событии — «Понятно»
   */
  release(batch: string, decision: 'release' | 'reject' | 'hold'): void;
  assess(dev: string, verdict: 'none' | 'reject'): void;
  urgent(recipe: Id, sku: Id): void;
  toggleFlows(): void;
  understood(kind: string): void;
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
