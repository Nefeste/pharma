// из bolnitsa: src/app/sound.ts @ 15a7ad6, изменено: звуки завода — `stop` и `notice` вместо `urgent`, поводы стройки и
// оборудования завода, вес извещения (`noticeCue`) и один звук на срез (`sliceCue`), «Подписи звуков», выключение звука
// после создания игры (`silence`).
// Звуки окна и событий (docs/specs/2026-10-vertical-slice.md, Б11, шаг 1): файлы собирает tools/sound/gen.ts из формул,
// лежат в assets/audio. Звук — только в ответ на действие игрока или на событие, которого он ждёт (ADR 0023 устава,
// правило 6; docs/13-art.md, §11 — три веса извещений: запись без звука, внимание — мягкий звук, стоп — ясный): какие и
// когда — `CUES`, `siteCue`, `noticeCue`. Браузер даёт звук после первого нажатия игрока (`unlock`); до него — тихо.
// Правила — чистые функции, их проверяют тесты (tools/test/sound.test.ts).
import type { Notice } from '../engine/types';
import { stopKey } from '../sim/protocol';
import { pauseOf } from './pauses';
import type { Keep } from './preset';

/** Звуки шага 1 — по файлам `assets/audio/<звук>.wav`. */
export const CUES = ['click', 'build', 'demolish', 'hire', 'refuse', 'stop', 'notice', 'letter', 'meeting', 'goal'] as const;
export type Cue = (typeof CUES)[number];

/**
 * Слои громкости (Б13, шаг 2; геймдизайн, §19.5): те, у которых звуки уже есть, — интерфейс (отклик на нажатие и стройку)
 * и извещения (события завода, письма, планёрка, итог). Фон, машины, склад, лаборатория, люди и музыка придут со своими
 * звуками. Громкость слоя — доля общей, теми же ступенями.
 */
export const LAYERS = ['ui', 'notices'] as const;
export type Layer = (typeof LAYERS)[number];
export const LAYER_OF: Record<Cue, Layer> = {
  click: 'ui',
  build: 'ui',
  demolish: 'ui',
  refuse: 'ui',
  hire: 'notices',
  stop: 'notices',
  notice: 'notices',
  letter: 'notices',
  meeting: 'notices',
  goal: 'notices',
};
export const layerKey = (l: Layer) => `pharma.volume.${l}`;

/** Громкость слоя из хранилища окна; нет или не прочитать — полная. */
export function keptLayer(keep: Keep | undefined, l: Layer): number {
  try {
    const v = keep?.getItem(layerKey(l));
    return v === null || v === undefined ? 1 : volumeOf(Number(v));
  } catch {
    return 1;
  }
}

/** Запомнить громкость слоя. */
export function keepLayer(keep: Keep | undefined, l: Layer, v: number) {
  try {
    keep?.setItem(layerKey(l), String(v));
  } catch {
    // хранилище окна недоступно
  }
}

/** Один и тот же звук — не чаще, мс: строка кнопок и пачка извещений не трещат. */
export const GAP_MS = 80;

/** Громкость — от 0 до 1 шагом 0,1; 0 — без звука. */
export const VOLUMES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;
export const DEFAULT_VOLUME = 0.7;

/** Ключи в хранилище окна: громкость и «Подписи звуков». */
export const SOUND_KEY = { volume: 'pharma.volume', captions: 'pharma.captions' } as const;

/** Громкость из чего угодно: ближайшая ступень, не число — по умолчанию. */
export function volumeOf(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_VOLUME;
  return VOLUMES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
}

/**
 * Команды стройки (Б7б) и оборудования (Б7в) со звуком: встало, заказано, переставлено — стук; снесено, снято — два стука
 * вниз; «Готово», «Отменить», отмена заказа — без звука.
 */
const SITE: Partial<Record<string, Cue>> = {
  room: 'build', hull: 'build', door: 'build', zone: 'build', rack: 'build', vehicles: 'build', unit: 'build', unitMove: 'build', unitSwap: 'build',
  demolish: 'demolish', unitDrop: 'demolish',
};
const EQUIP: Partial<Record<string, Cue>> = { buy: 'build', replace: 'build', move: 'build', remove: 'demolish' };

/** Звук у ответа на команду стройки или оборудования: не прошла — отказ; прошла — по виду команды. */
export function siteCue(kind: 'site' | 'equip', op: string, ok: boolean): Cue | undefined {
  return ok ? (kind === 'site' ? SITE[op] : EQUIP[op]) : 'refuse';
}

/**
 * Звук извещения по весу (13-art.md, §11): мир встал на нём — `stop`; письмо, планёрка и итог сценария — свои; извещение
 * какой-нибудь автопаузы, на котором мир не встал (выключена или не ваше место), — «внимание», `notice`; нанят — `hire`;
 * отказ — `refuse`; остальное — запись, без звука. Найм и отказ звучат только в ответ на команду игрока (`mine`).
 */
export function noticeCue(n: Notice, stop: boolean, mine: boolean): Cue | undefined {
  if (n.kind === 'letter') return 'letter';
  if (n.kind === 'morning') return 'meeting';
  if (n.kind === 'scenarioEnd') return 'goal';
  if (n.kind === 'hired') return mine ? 'hire' : undefined;
  if (n.kind === 'refused') return mine ? 'refuse' : undefined;
  if (n.kind === 'site' || n.kind === 'equip') return mine ? siteCue(n.kind, n.op, n.ok) : undefined;
  if (stop) return 'stop';
  return pauseOf(stopKey(n)) ? 'notice' : undefined;
}

/** Порядок звуков одного среза — по тяжести: в одном срезе звучит один, самый тяжёлый. */
const HEAVY: readonly Cue[] = ['goal', 'meeting', 'stop', 'letter', 'refuse', 'hire', 'demolish', 'build', 'notice', 'click'];

/** Звук среза: самый тяжёлый из звуков его извещений; нет — тихо. */
export function sliceCue(cues: readonly (Cue | undefined)[]): Cue | undefined {
  return HEAVY.find(c => cues.includes(c));
}

/** Можно ли сыграть звук в `now`, если прошлый раз он звучал в `last`. */
export function due(last: number | undefined, now: number): boolean {
  return last === undefined || now - last >= GAP_MS;
}

/** Громкость из хранилища окна; нет или не прочитать — по умолчанию. */
export function keptVolume(keep: Keep | undefined): number {
  try {
    const v = keep?.getItem(SOUND_KEY.volume);
    return v === null || v === undefined ? DEFAULT_VOLUME : volumeOf(Number(v));
  } catch {
    return DEFAULT_VOLUME;
  }
}

/** «Подписи звуков» из хранилища окна; нет — выключены. */
export function keptCaptions(keep: Keep | undefined): boolean {
  try {
    return keep?.getItem(SOUND_KEY.captions) === '1';
  } catch {
    return false;
  }
}

/** Запомнить громкость и подписи; не вышло — живут до закрытия окна. */
export function keepSound(keep: Keep | undefined, volume: number, captions: boolean) {
  try {
    keep?.setItem(SOUND_KEY.volume, String(volume));
    keep?.setItem(SOUND_KEY.captions, captions ? '1' : '0');
  } catch {
    // хранилище окна недоступно
  }
}

/** Звук окна: громкость, файлы, сколько раз звучал каждый (для сценария в браузере). */
export class Sound {
  readonly played = Object.fromEntries(CUES.map(c => [c, 0])) as Record<Cue, number>;
  /** все файлы загружены */
  ready = false;
  private ctx?: AudioContext;
  private out?: GainNode;
  /** слои (Б13): у каждого свой узел громкости перед общим */
  private gains = new Map<Layer, GainNode>();
  readonly layers: Record<Layer, number> = { ui: 1, notices: 1 };
  private buffers = new Map<Cue, AudioBuffer>();
  private last = new Map<Cue, number>();

  /** `on` — звук в этой игре вообще есть: в «Авто-бенче» и в сценарии браузера с ключом `shot` его нет (`silence`). */
  constructor(
    public volume: number,
    private on = true,
    private readonly base = 'assets/audio/',
  ) {}

  /** Звука в этой игре нет: «Авто-бенч», снимки. */
  silence() {
    this.on = false;
    void this.ctx?.close().catch(() => {});
    this.ctx = undefined;
    this.out = undefined;
  }

  /** Первое нажатие игрока: браузер даёт звук только после него — тогда и файлы. */
  unlock() {
    if (!this.on || this.ctx || typeof AudioContext === 'undefined') return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(ctx.destination);
    for (const l of LAYERS) {
      const g = ctx.createGain();
      g.gain.value = this.layers[l];
      g.connect(this.out);
      this.gains.set(l, g);
    }
    void ctx.resume().catch(() => {});
    void Promise.all(
      CUES.map(async c => {
        const r = await fetch(`${this.base}${c}.wav`);
        this.buffers.set(c, await ctx.decodeAudioData(await r.arrayBuffer()));
      }),
    ).then(
      () => (this.ready = true),
      () => {},
    );
  }

  setVolume(v: number) {
    this.volume = volumeOf(v);
    if (this.out) this.out.gain.value = this.volume;
  }

  setLayer(l: Layer, v: number) {
    this.layers[l] = volumeOf(v);
    const g = this.gains.get(l);
    if (g) g.gain.value = this.layers[l];
  }

  /** Сыграть звук: есть звук, громкость и слой не ноль, окно видно, файл загружен и звук не звучал только что. */
  play(cue: Cue, now = performance.now()): boolean {
    if (!this.on || this.volume <= 0 || this.layers[LAYER_OF[cue]] <= 0 || !this.ctx || !this.out || (typeof document !== 'undefined' && document.hidden)) return false;
    const buf = this.buffers.get(cue);
    if (!buf || !due(this.last.get(cue), now)) return false;
    this.last.set(cue, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gains.get(LAYER_OF[cue]) ?? this.out);
    src.start();
    this.played[cue]++;
    return true;
  }
}
