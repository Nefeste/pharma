// Игра в окне (docs/02-architecture.md, §10): база, поток расчёта, 3D-вид, часы и скорости, ввод, панели. Устройство —
// как у «Больницы» (её src/app/game.ts): окно не считает завод, оно шлёт ход часов и команды и рисует срез. Всё, что знает
// игра, — здесь; панели только читают хранилище и просят.
import type { ContentDb, Scenario } from '../content/types';
import { momentOf } from '../engine/core/calendar';
import { MORNING } from '../engine/engine';
import type { Notice } from '../engine/types';
import { T } from '../i18n';
import { demoWarehouse } from '../render/demo';
import { Stage } from '../render/stage';
import type { Quality } from '../render/view';
import { type Slice, SimClient } from '../sim/client';
import { H } from '../sim/pack';
import type { Actions, Speed, Store } from '../ui/store';

/** Сценарий части 0 (content/scenarios/proto.yaml). */
export const SCENARIO = 'scn.proto';

/** Игровых секунд в секунду на каждой скорости (геймдизайн, §2). */
export const RATE: Record<Speed, number> = { 0: 0, 1: 60, 2: 300, 3: 1200, 4: 7200 };

/** «До утра»: кусок игровых секунд на кадр и предел отставания, при котором поток получает новый кусок. */
const FF_CHUNK = 1800;
const FF_LAG = 900;

/** Мост к оболочке Electron (electron/preload.cjs); в браузере его нет. */
export interface ShellBridge {
  save(json: string): Promise<string>;
  saveShot(name: string, dataUrl: string): Promise<string>;
  metrics(): Promise<{ workingSetMB: number; privateMB: number; byType: Record<string, number> }>;
  info(): Promise<Record<string, unknown>>;
  firstFrame(ms: number): void;
  relaunch(args: string[]): void;
  args(): Promise<string[]>;
}

declare global {
  interface Window {
    shell?: ShellBridge;
    __game?: Game;
    __ready?: boolean;
  }
}

export class Game {
  stage!: Stage;
  client!: SimClient;
  scenario!: Scenario;
  speed: Speed = 1;
  /** промотка «До утра» — до ближайших 08:00; `ffLeft` — сколько игровых секунд ещё отправить */
  ff = false;
  private ffLeft = 0;
  /** часы завода из последнего среза */
  t = 0;
  day = 0;
  lag = 0;
  firstFrameMs = 0;
  /** последние кадры: интервал и время отрисовки — для полосы отладки */
  readonly frames: { interval: number[]; draw: number[] } = { interval: [], draw: [] };
  private last = 0;
  private hudAt = 0;
  private notices: { t: number; text: string }[] = [];
  private mouse = { x: 0, y: 0, inside: false, drag: null as null | { x: number; y: number; moved: number; button: number }, keys: new Set<string>() };
  private gotSlice!: () => void;
  private firstSlice = new Promise<void>(r => (this.gotSlice = r));

  constructor(
    readonly db: ContentDb,
    readonly store: Store,
    readonly host: HTMLElement,
  ) {}

  /** База, сцена, поток — и первый кадр после первого среза. */
  static async create(host: HTMLElement, store: Store, quality: Quality): Promise<Game> {
    const db = (await (await fetch('./content.json')).json()) as ContentDb;
    const g = new Game(db, store, host);
    const sc = db.scenarios[SCENARIO];
    if (!sc) throw new Error(`no scenario ${SCENARIO}`);
    g.scenario = sc;
    const demo = demoWarehouse(sc.site.w, sc.site.h);
    g.stage = new Stage({ host, w: sc.site.w, h: sc.site.h, quality, racks: demo.racks, lanes: demo.lanes, capacity: 512 });
    g.stage.setPallets(demo.pallets);
    g.client = new SimClient('./sim.js');
    g.client.onSlice = s => g.receive(s);
    g.client.onError = m => store.set({ error: m });
    g.client.start({ kind: 'start', scenario: SCENARIO });
    await g.firstSlice;
    new ResizeObserver(() => g.stage.resize()).observe(host);
    g.bindInput();
    store.set({ ready: true, start: sc.start.date, quality });
    requestAnimationFrame(g.loop);
    return g;
  }

  private receive(s: Slice) {
    this.t = s.buf[H.t];
    this.day = s.buf[H.day];
    this.lag = s.lag;
    for (const n of s.notices) this.notice(n);
    // «До утра» кончается планёркой — и паузой: игрок видит итог суток (геймдизайн, §2)
    if (this.ff && s.notices.some(n => n.kind === 'morning')) {
      this.ff = false;
      this.speed = 0;
    }
    this.gotSlice();
  }

  private notice(n: Notice) {
    const text = T.notices.morning(n.day);
    this.notices.unshift({ t: this.t, text });
    if (this.notices.length > 30) this.notices.length = 30;
  }

  // ---------------------------------------------------------------- кадр

  private loop = (ts: number) => {
    requestAnimationFrame(this.loop);
    const dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0;
    if (this.last) this.push(this.frames.interval, ts - this.last);
    this.last = ts;
    // «До утра»: столько, сколько поток успевает, — новый кусок, только когда прежний почти досчитан, и не дальше 08:00
    let game = RATE[this.speed] * dt;
    if (this.ff) {
      game = 0;
      if (!this.client.busy && this.lag < FF_LAG && this.ffLeft > 0) {
        game = Math.min(FF_CHUNK, this.ffLeft);
        this.ffLeft -= game;
      }
    }
    this.client.frame(game, this.ff ? 14 : 8);
    this.edgePan(dt);
    const a = performance.now();
    this.stage.frame(dt, (((this.t % 86400) + 86400) % 86400) / 3600);
    this.push(this.frames.draw, performance.now() - a);
    if (!this.firstFrameMs) {
      this.firstFrameMs = Math.round(performance.now());
      window.shell?.firstFrame(this.firstFrameMs);
      window.__ready = true;
    }
    if (ts - this.hudAt > 100) {
      this.hudAt = ts;
      this.hud();
    }
  };

  private push(a: number[], v: number) {
    a.push(v);
    if (a.length > 600) a.splice(0, a.length - 300);
  }

  /** Полоса сверху — 10 раз в секунду. */
  private hud() {
    const iv = this.frames.interval.slice(-30);
    const mean = iv.reduce((x, y) => x + y, 0) / Math.max(1, iv.length);
    const draw = this.frames.draw.slice(-30);
    const gs = this.stage.gpu.samples.slice(-30);
    this.store.set({
      t: this.t,
      day: this.day,
      speed: this.speed,
      ff: this.ff,
      lag: Math.floor(this.lag / 60),
      notices: [...this.notices],
      fps: Math.round(1000 / (mean || 1)),
      cpuMs: draw.reduce((x, y) => x + y, 0) / Math.max(1, draw.length),
      gpuMs: gs.length ? gs.reduce((x, y) => x + y, 0) / gs.length : null,
    });
  }

  /** Что показывают часы завода сейчас — для панелей и сценария в браузере. */
  moment() {
    return momentOf(this.scenario.start.date, this.t);
  }

  // ---------------------------------------------------------------- действия панелей

  readonly actions: Actions = {
    setSpeed: s => {
      this.speed = s;
      this.ff = false;
      this.hud();
    },
    untilMorning: () => {
      // часы игры — это часы завода плюс отставание расчёта
      const now = this.t + this.lag;
      const day = Math.floor(now / 86400) * 86400;
      const target = now < day + MORNING ? day + MORNING : day + 86400 + MORNING;
      this.ffLeft = target - now;
      this.ff = this.ffLeft > 0;
      this.hud();
    },
    setQuality: (q: Quality) => {
      this.stage.applyQuality(q);
      this.store.set({ quality: q });
    },
    toggleDebug: () => this.store.set({ debug: !this.store.get().debug }),
  };

  // ---------------------------------------------------------------- ввод (как в «Больнице»)

  private bindInput() {
    const el = this.stage.renderer.domElement;
    el.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        this.stage.cam.zoom(Math.exp(e.deltaY * 0.0012));
      },
      { passive: false },
    );
    el.addEventListener('pointerdown', e => {
      if (e.button === 2 || e.button === 1) {
        this.mouse.drag = { x: e.clientX, y: e.clientY, moved: 0, button: e.button };
        el.setPointerCapture(e.pointerId);
      }
    });
    el.addEventListener('pointermove', e => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.inside = true;
      if (!this.mouse.drag) return;
      const dx = e.clientX - this.mouse.drag.x;
      const dy = e.clientY - this.mouse.drag.y;
      this.stage.cam.pan(dx, dy, el.clientHeight);
      this.mouse.drag = { x: e.clientX, y: e.clientY, moved: this.mouse.drag.moved + Math.abs(dx) + Math.abs(dy), button: this.mouse.drag.button };
    });
    el.addEventListener('pointerup', e => {
      if (this.mouse.drag?.button === e.button) this.mouse.drag = null;
    });
    el.addEventListener('pointerleave', () => {
      this.mouse.inside = false;
    });
    el.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('blur', () => {
      this.mouse.inside = false;
      this.mouse.keys.clear();
    });
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const k = e.code;
      if (k === 'Space') {
        e.preventDefault();
        this.actions.setSpeed(this.speed === 0 && !this.ff ? 1 : 0);
      } else if (k === 'Digit1') this.actions.setSpeed(1);
      else if (k === 'Digit2') this.actions.setSpeed(2);
      else if (k === 'Digit3') this.actions.setSpeed(3);
      else if (k === 'Digit4') this.actions.setSpeed(4);
      else if (k === 'Digit5') this.actions.untilMorning();
      else if (k === 'KeyQ') this.stage.cam.rotate(-1);
      else if (k === 'KeyE') this.stage.cam.rotate(1);
      else if (k === 'Backquote') this.actions.toggleDebug();
      else this.mouse.keys.add(k);
    });
    window.addEventListener('keyup', e => this.mouse.keys.delete(e.code));
  }

  /** Сдвиг краями окна (курсор ближе 10 точек к краю) и клавишами WASD и стрелками. */
  private edgePan(dt: number) {
    if (this.mouse.drag) return;
    const el = this.stage.renderer.domElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const v = 700 * dt;
    let dx = 0;
    let dy = 0;
    const keys = this.mouse.keys;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) dx += v;
    if (keys.has('KeyD') || keys.has('ArrowRight')) dx -= v;
    if (keys.has('KeyW') || keys.has('ArrowUp')) dy += v;
    if (keys.has('KeyS') || keys.has('ArrowDown')) dy -= v;
    if (this.mouse.inside && !dx && !dy) {
      const m = 10;
      if (this.mouse.x < m) dx = v;
      else if (this.mouse.x > w - m) dx = -v;
      if (this.mouse.y < m) dy = v;
      else if (this.mouse.y > h - m) dy = -v;
    }
    if (dx || dy) this.stage.cam.pan(dx, dy, h);
  }
}
