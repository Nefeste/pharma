// Игра в окне (docs/02-architecture.md, §10): база, поток расчёта, 3D-вид, часы и скорости, ввод, панели. Устройство —
// как у «Больницы» (её src/app/game.ts): окно не считает завод, оно шлёт ход часов и команды и рисует срез. Всё, что знает
// игра, — здесь; панели только читают хранилище и просят.
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ContentDb, Scenario } from '../content/types';
import { momentOf } from '../engine/core/calendar';
import { MORNING } from '../engine/engine';
import { planOf } from '../engine/plant';
import type { Notice } from '../engine/types';
import { T } from '../i18n';
import { bakeLook, lodOf, packPeople } from '../render/bake';
import { AT, camDetail, type Detail, ease, speedDetail, type Weights } from '../render/detail';
import { type Layout, layoutOf, levelY } from '../render/layout';
import type { PalletView } from '../render/loads';
import { Stage } from '../render/stage';
import { forkY } from '../render/vehicles';
import type { Quality } from '../render/view';
import type { WallMode } from '../render/world';
import { type Slice, SimClient } from '../sim/client';
import { unpack } from '../sim/pack';
import { type Actions, LIVE, type Speed, type Store } from '../ui/store';
import { fillsOf, Flows, lineArrows, moveArrows, movesOf } from './flows';
import { moversAt } from './movers';
import { carriedOf, dockFront, palletsOf, SceneState } from './scene';
import { Yard } from './yard';

/** Сценарий части 0 (content/scenarios/proto.yaml). */
export const SCENARIO = 'scn.proto';

/** Игровых секунд в секунду на каждой скорости (геймдизайн, §2). */
export const RATE: Record<Speed, number> = { 0: 0, 1: 60, 2: 300, 3: 1200, 4: 7200, 5: 1 };

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
    /** итог и ошибка авто-бенча, снимки — для бенча в Chromium без окна (tools/app/bench.mjs) */
    __benchResult?: unknown;
    __benchError?: string;
    __shots?: { name: string; dataUrl: string }[];
  }
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

/**
 * Люди — модели CC0 из assets/models/people (assets/LICENSES.md): загрузить, запечь анимации и упростить для дальнего
 * плана, как в «Больнице» (её src/app/game.ts).
 */
async function loadPeople() {
  const base = './assets/models';
  const index = (await (await fetch(`${base}/index.json`)).json()) as { people: string[] };
  await MeshoptSimplifier.ready;
  const raws = await Promise.all(index.people.map(async n => bakeLook((await loader.loadAsync(`${base}/people/${n}.glb`)) as never, n)));
  return { people: packPeople(raws, raws.map(r => lodOf(r, 0.25, MeshoptSimplifier))), names: index.people };
}

export class Game {
  stage!: Stage;
  client!: SimClient;
  scenario!: Scenario;
  layout!: Layout;
  /** что видно на полу: паллеты, фуры, помещения — из срезов */
  readonly view = new SceneState();
  private shownVersion = -1;
  /** паллеты, которые сейчас везут: их нет на местах, они на вилах */
  private moving = '';
  /** частоты перевозок между зонами — для стрелок участка (2г) */
  readonly flows = new Flows();
  /** фуры двора: въезд, ожидание, отъезд — картинка по срезам (3а) */
  readonly yard = new Yard();
  /** крупность показа: уровень по высоте камеры (с запасом у порогов) и веса уровней на экране (detail.ts) */
  private camLevel: Detail = 1;
  detail: Weights = AT[1];
  /** уровень, к которому идёт показ, — для сценария в браузере */
  detailTarget: Detail = 1;
  /** авто-бенч (bench.ts): часы ведёт он сам; крючок кадра; паллеты сцены сверх учёта — только для нагрузки отрисовки */
  manual = false;
  onFrame: ((ts: number) => void) | null = null;
  extra: PalletView[] = [];
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
    g.layout = layoutOf(planOf(db, sc.plant));
    // паллет в сцене — сколько мест в плане и ещё на фуры и в помещения
    g.stage = new Stage({ host, layout: g.layout, db, quality, capacity: g.layout.plan.slots.length + 256 });
    const crowd = await loadPeople();
    g.stage.setPeople(crowd.people, crowd.names);
    g.client = new SimClient('./sim.js');
    g.client.onSlice = s => g.receive(s);
    g.client.onError = m => store.set({ error: m });
    g.client.start({ kind: 'start', scenario: SCENARIO });
    await g.firstSlice;
    new ResizeObserver(() => g.stage.resize()).observe(host);
    g.bindInput();
    store.set({ ready: true, start: sc.start.date, quality, walls: g.stage.wallMode });
    requestAnimationFrame(g.loop);
    return g;
  }

  private receive(s: Slice) {
    const sl = unpack(s.buf);
    // перевозки — по прежним местам паллет окна, до того как срез их перепишет
    this.flows.step(sl.t, movesOf(this.layout.plan, this.view.units, this.view.trucks, sl));
    this.t = sl.t;
    this.day = sl.day;
    this.lag = s.lag;
    this.view.apply(sl);
    this.stage.setOverlay([...moveArrows(this.layout, this.flows), ...lineArrows(this.db, this.layout, sl.lines)], fillsOf(this.layout.plan, this.view.units.values()));
    this.showPallets();
    this.yard.update(this.view.trucks, d => dockFront(this.layout, d), sl.t);
    this.stage.setRooms(this.view.rooms);
    for (const n of s.notices) this.notice(n);
    // «До утра» кончается планёркой — и паузой: игрок видит итог суток (геймдизайн, §2)
    if (this.ff && s.notices.some(n => n.kind === 'morning')) {
      this.ff = false;
      this.speed = 0;
    }
    this.gotSlice();
  }

  /** Паллеты на местах — когда изменился учёт или то, какие паллеты сейчас везут. */
  private showPallets(moving: number[] = []) {
    const key = moving.join(',');
    if (this.view.version === this.shownVersion && key === this.moving) return;
    this.shownVersion = this.view.version;
    this.moving = key;
    const list = palletsOf(this.db, this.scenario.plant, this.view, new Set(moving));
    this.stage.setPallets(this.extra.length ? [...list, ...this.extra] : list);
  }

  /**
   * Люди и техника — где они в момент часов завода; паллеты на вилах. В «живом времени» срез приходит раз в игровую
   * секунду — люди шли бы рывками по метру; поэтому часы для них — часы среза и то, на сколько часы окна ушли вперёд, не
   * больше секунды.
   */
  private showMovers(ts: number) {
    const v = this.view;
    const t = this.speed === LIVE ? this.t + Math.min(1, this.client.ahead) : this.t;
    const mv = moversAt(this.db, this.layout.plan, v.tasks, v.people, v.vehicles, t);
    this.stage.setTrucks(this.yard.at(t));
    this.showPallets(mv.carried.map(c => c.unit).sort((a, b) => a - b));
    this.stage.setMovers(mv, carriedOf(v, mv.carried, c => (c.placed ? levelY(c.level) : forkY(c.level))), ts / 1000);
  }

  private notice(n: Notice) {
    const text =
      n.kind === 'morning' ? T.notices.morning(n.day)
      : n.kind === 'ordered' ? T.notices.ordered
      : n.kind === 'truck' ? T.notices.truck
      : n.kind === 'lotReleased' ? T.notices.lotReleased
      : n.kind === 'lotRejected' ? T.notices.lotRejected
      : n.kind === 'batchBulk' ? T.notices.batchBulk
      : n.kind === 'batchPacked' ? T.notices.batchPacked
      : n.kind === 'batchReleased' ? T.notices.batchReleased
      : n.kind === 'batchRejected' ? T.notices.batchRejected
      : n.kind === 'batchHeld' ? T.notices.batchHeld
      : n.kind === 'deviation' ? T.notices.deviation
      : n.kind === 'shipped' ? T.notices.shipped
      : n.kind === 'lateOrder' ? T.notices.lateOrder
      : n.kind === 'cashLow' ? T.notices.cashLow
      : n.kind === 'failure' ? T.notices.failure
      : n.kind === 'repaired' ? T.notices.repaired
      : T.notices.refused;
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
    if (!this.manual) this.client.frame(game, this.ff ? 14 : 8);
    this.onFrame?.(ts);
    this.edgePan(dt);
    // крупность показа — по скорости и высоте камеры; веса доходят до нового уровня за 0,4 с
    this.camLevel = camDetail(this.stage.cam.half, this.camLevel);
    this.detailTarget = Math.max(this.camLevel, speedDetail(this.speed, this.ff)) as Detail;
    this.detail = ease(this.detail, this.detailTarget, dt);
    this.stage.setDetail(this.detail);
    const a = performance.now();
    this.showMovers(ts);
    this.stage.setMachines(this.view.lines, this.view.equipment, this.ff ? FF_CHUNK * 60 : RATE[this.speed]);
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
    setWalls: (m: WallMode) => {
      this.stage.setWalls(m);
      this.store.set({ walls: m });
    },
    toggleDebug: () => this.store.set({ debug: !this.store.get().debug }),
    bench: uncapped => {
      if (uncapped && window.shell) window.shell.relaunch(['--bench', '--uncapped']);
      else void import('./bench').then(m => m.runBench(this, {}));
    },
  };

  /** Паллеты сцены заново — после того как бенч сменил `extra`. */
  refreshPallets() {
    this.shownVersion = -1;
    this.showPallets();
  }

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
      } else if (k === 'Digit0') this.actions.setSpeed(LIVE);
      else if (k === 'Digit1') this.actions.setSpeed(1);
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
