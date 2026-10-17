// из bolnitsa: src/ui/store.ts @ e0a3491 — изменено: поля завода вместо больницы.
// Хранилище панелей: игра пишет сюда не чаще 10 раз в секунду, панели читают через `useSyncExternalStore`. Снимок
// неизменяемый: каждое `set` — новый объект.
import { useSyncExternalStore } from 'react';
import type { Ymd } from '../engine/core/calendar';
import type { Lang } from '../i18n';
import type { Quality } from '../render/view';

/** Скорости геймдизайна (§2): 0 — пауза; 1–4 — минута, 5 минут, 20 минут, 2 часа за секунду. */
export type Speed = 0 | 1 | 2 | 3 | 4;

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
  fps: number;
  cpuMs: number;
  gpuMs: number | null;
}

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
  fps: 0,
  cpuMs: 0,
  gpuMs: null,
};

export interface Actions {
  setSpeed(s: Speed): void;
  untilMorning(): void;
  setQuality(q: Quality): void;
  toggleDebug(): void;
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
