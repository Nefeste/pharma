// Игра в окне (docs/02-architecture.md, §10): база, поток расчёта, 3D-вид, часы и скорости, ввод, панели. Устройство —
// как у «Больницы» (её src/app/game.ts): окно не считает завод, оно шлёт ход часов и команды и рисует срез. Всё, что знает
// игра, — здесь; панели только читают хранилище и просят.
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ContentDb, Scenario } from '../content/types';
import { DAY, momentOf } from '../engine/core/calendar';
import { MORNING } from '../engine/engine';
import { planOf } from '../engine/plant';
import type { Command, Notice } from '../engine/types';
import { named, T } from '../i18n';
import { bakeLook, lodOf, packPeople } from '../render/bake';
import { AT, camDetail, type Detail, ease, speedDetail, type Weights } from '../render/detail';
import { type Layout, layoutOf, levelY } from '../render/layout';
import type { PalletView } from '../render/loads';
import { Stage } from '../render/stage';
import { forkY } from '../render/vehicles';
import type { Quality } from '../render/view';
import type { WallMode } from '../render/world';
import type { Outline } from '../render/select';
import { type Slice, SimClient } from '../sim/client';
import { unpack } from '../sim/pack';
import { PlanClient } from '../sim/planClient';
import type { Thing, ViewQuery } from '../sim/views';
import { useDb } from '../ui/db';
import { commandsOf, prune, upsert } from '../ui/draft';
import { type Actions, holds, type Hud, LIVE, NO_RUN, PLAN_RUN, type Speed, type Store } from '../ui/store';
import { fillsOf, Flows, lineArrows, moveArrows, movesOf } from './flows';
import { type Movers, moversAt } from './movers';
import { keep, windowKeep } from './preset';
import { type Box, machineBoxes, palletBoxes, pick, same, type Spot, truckBoxes, type V3 } from './pick';
import { carriedOf, dockFront, palletsOf, SceneState } from './scene';
import { type TruckPose, Yard } from './yard';

/** Сценарий части 0 (content/scenarios/proto.yaml) и его план. */
export const SCENARIO = 'scn.proto';
export const PLANT = 'plant.proto';

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
  /** поток прогона плана (часть 5): заводится к первому прогону; номер последнего «Прогнать план» */
  readonly planner = new PlanClient('./plan.js');
  private planSeq = 0;
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
  /** выбранная вещь и что было на экране в последнем кадре — для выбора щелчком и рамки (3б) */
  selected: Thing | undefined;
  /** паллеты на местах последнего кадра — для выбора щелчком и сценария в браузере */
  pallets: PalletView[] = [];
  private carriedNow: PalletView[] = [];
  private moversNow: Movers = { people: [], vehicles: [], carried: [] };
  private trucksNow: TruckPose[] = [];
  private machineBoxes: Box[] = [];
  /** набор видов, который поток уже получил: шлём заново, только если изменился */
  private viewsSent = '';
  /** планёрка (3в): мгновение последней, которую окно видело; скорость, которую включит «Продолжить» */
  private morningSeen = Number.NEGATIVE_INFINITY;
  private resume: Speed = 1;
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
  private notices: { t: number; text: string; inv?: string }[] = [];
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
    useDb(db);
    const g = new Game(db, store, host);
    const sc = db.scenarios[SCENARIO];
    if (!sc) throw new Error(`no scenario ${SCENARIO}`);
    g.scenario = sc;
    g.layout = layoutOf(planOf(db, sc.plant));
    g.machineBoxes = machineBoxes(db, g.layout);
    // паллет в сцене — сколько мест в плане и ещё на фуры и в помещения
    g.stage = new Stage({ host, layout: g.layout, db, quality, capacity: g.layout.plan.slots.length + 256 });
    const crowd = await loadPeople();
    g.stage.setPeople(crowd.people, crowd.names);
    g.client = new SimClient('./sim.js');
    g.client.onSlice = s => g.receive(s);
    g.client.onError = m => store.set({ error: m });
    g.client.start({ kind: 'start', scenario: SCENARIO });
    g.planner.onVariant = m => {
      const p = store.get().plan;
      const sums = [...p.sums];
      sums[m.index] = m.sum;
      store.set({ plan: { ...p, at: m.at, sums, batches: { ...p.batches, ...m.batches } } });
    };
    g.planner.onDone = m => store.set({ plan: { ...store.get().plan, running: false, ms: m.ms } });
    g.planner.onError = message => store.set({ plan: { ...store.get().plan, running: false, error: message } });
    await g.firstSlice;
    new ResizeObserver(() => g.stage.resize()).observe(host);
    g.bindInput();
    store.set({ ready: true, start: sc.start.date, quality, walls: g.stage.wallMode });
    // игра начинается с экрана «Кем вы будете» (3е): мир стоит, пока место не выбрано; «Взять» пустит его на ×1
    g.speed = 0;
    g.resume = 1;
    store.set({ seats: { open: true, pick: [] } });
    g.sendViews();
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
    const hud = this.store.get();
    for (const { data: d } of s.views ?? []) {
      if (d.view === 'stock') this.store.set({ stock: { ...this.store.get().stock, view: d } });
      // вид прежнего выбора или прежних суток, отправленный до нового запроса, не показываем
      else if (d.view === 'card') {
        if (same(d.thing, this.selected)) this.store.set({ card: d });
      } else if (d.view === 'morning') {
        if (hud.morning.open && hud.morning.day === d.day) this.store.set({ morning: { ...this.store.get().morning, view: d } });
      } else if (d.view === 'cash') {
        if (hud.cash.open) this.store.set({ cash: { ...this.store.get().cash, view: d } });
      } else if (d.view === 'lab') {
        if (hud.lab.open) this.store.set({ lab: { ...this.store.get().lab, view: d } });
      } else if (d.view === 'chart') {
        if (hud.lab.open) this.store.set({ lab: { ...this.store.get().lab, chart: d } });
      } else if (d.view === 'gantt') {
        // задания, которые тянуть уже нельзя, уходят из черновика сами
        const g = this.store.get().gantt;
        const draft = prune(g.draft, d.gone);
        if (g.open || draft !== g.draft) this.store.set({ gantt: { ...g, ...(g.open ? { view: d } : {}), draft } });
        if (draft !== g.draft) this.sendViews();
      } else if (d.view === 'inv') {
        if (hud.inv.open) this.store.set({ inv: { ...this.store.get().inv, view: d } });
      } else if (d.view === 'ref') {
        if (hud.ref.open) this.store.set({ ref: { ...this.store.get().ref, view: d } });
      } else if (d.view === 'ghost') {
        // призрак того, что тянут сейчас; прежний запрос — не показываем
        const g = this.store.get().gantt;
        if (g.drag?.batch === d.batch && g.drag.notBefore === d.notBefore) this.store.set({ gantt: { ...g, ghost: d } });
      } else this.store.set({ top: d });
    }
    for (const n of s.notices) this.notice(n);
    if (s.notices.some(n => n.kind === 'morning')) this.morning(sl.t);
    // результат вне спецификации — извещение «стоп» для того, кто держит пост качества (13-art.md, §11–12): мир на паузе,
    // промотка кончилась; без поста расследование ведёт коллега — извещение без паузы
    if (s.notices.some(n => n.kind === 'investigation') && holds(this.store.get(), 'quality')) {
      if (this.speed !== 0) this.resume = this.speed;
      this.speed = 0;
      this.ff = false;
      this.ffLeft = 0;
      this.hud();
    }
    this.gotSlice();
  }

  /**
   * Планёрка в 08:00 (3в): открывается сама; «До утра» и пауза на планёрке (по умолчанию) ставят мир на паузу — игрок видит
   * итог суток (геймдизайн, §2). Срез мог уйти дальше 08:00 только без паузы: планёрка — последних 08:00 до среза.
   */
  private morning(t: number) {
    const at = Math.floor((t - MORNING) / DAY) * DAY + MORNING;
    this.morningSeen = at;
    if (this.ff || this.store.get().morningPause) {
      if (this.speed !== 0) this.resume = this.speed;
      this.speed = 0;
    }
    this.ff = false;
    this.store.set({ morning: { open: true, day: momentOf(this.scenario.start.date, at).day } });
    this.sendViews();
    this.hud();
  }

  /** Ближайшие 08:00 не раньше `now`, планёрку которых окно ещё не видело: до них часы идут, пока на планёрке пауза. */
  private nextMorning(now: number): number {
    let m = Math.floor((now - MORNING) / DAY) * DAY + MORNING;
    if (m < now || m <= this.morningSeen) m += DAY;
    return m;
  }

  /** Паллеты на местах — когда изменился учёт или то, какие паллеты сейчас везут. */
  private showPallets(moving: number[] = []) {
    const key = moving.join(',');
    if (this.view.version === this.shownVersion && key === this.moving) return;
    this.shownVersion = this.view.version;
    this.moving = key;
    const list = palletsOf(this.db, this.scenario.plant, this.view, new Set(moving));
    this.pallets = list;
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
    this.trucksNow = this.yard.at(t);
    this.stage.setTrucks(this.trucksNow);
    this.showPallets(mv.carried.map(c => c.unit).sort((a, b) => a - b));
    this.moversNow = mv;
    this.carriedNow = carriedOf(v, mv.carried, c => (c.placed ? levelY(c.level) : forkY(c.level)));
    this.stage.setMovers(mv, this.carriedNow, ts / 1000);
    this.stage.setSelection(this.outline());
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
      : n.kind === 'investigation' ? T.notices.investigation(named(this.db.tests[n.method]?.name, n.method), n.code)
      : n.kind === 'invStep' ? T.notices.invStep
      : n.kind === 'concluded' ? T.notices.concluded(n.fate)
      : n.kind === 'refused' && n.why === 'notYours' ? T.seats.notYours(T.seats.names[n.detail ?? ''] ?? n.detail ?? '')
      : n.kind === 'refused' && T.notices.why[n.why] ? `${T.notices.refused}: ${T.notices.why[n.why]}`
      : T.notices.refused;
    // извещение о расследовании ведёт к его доске
    const inv = n.kind === 'investigation' || n.kind === 'invStep' || n.kind === 'concluded' ? n.id : undefined;
    this.notices.unshift({ t: this.t, text, ...(inv ? { inv } : {}) });
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
    } else if (game > 0 && this.store.get().morningPause) {
      // пауза на планёрке: часы не уходят за 08:00, пока не пришло её извещение
      const now = this.t + this.lag;
      game = Math.min(game, this.nextMorning(now) - now);
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

  /** Полоса сверху — 10 раз в секунду; окно расписания вслед за часами — с новой полуночью. */
  private hud() {
    if (this.store.get().gantt.open) this.sendViews();
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
      // пока открыт экран «Кем вы будете», мир стоит
      if (this.store.get().seats.open) return;
      this.speed = s;
      this.ff = false;
      this.hud();
    },
    untilMorning: () => {
      if (this.store.get().seats.open) return;
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
    pickQuality: (q: Quality) => {
      // выбор игрока — запоминается, стартовый замер его больше не трогает (preset.ts)
      this.actions.setQuality(q);
      keep(windowKeep(), q);
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
    toggleStock: () => {
      const st = this.store.get().stock;
      // справа — одна панель: склад, касса или лаборатория
      this.store.set({ stock: { ...st, open: !st.open, query: { ...st.query, lang: this.store.get().lang } }, ...this.rightClosed('stock') });
      this.sendViews();
    },
    toggleGantt: () => {
      const g = this.store.get().gantt;
      // большое окно поверх карты во всю ширину: панели справа закрываются; закрыли — то, что тянули, отменено
      const open = !g.open;
      this.store.set({ gantt: { open, days: g.days, draft: g.draft, ...(g.from !== undefined ? { from: g.from } : {}) }, ...(open ? { ...this.rightClosed(), inv: { open: false }, ref: { ...this.store.get().ref, open: false } } : {}) });
      this.sendViews();
    },
    setGanttDays: days => {
      this.store.set({ gantt: { ...this.store.get().gantt, days } });
      this.sendViews();
    },
    moveGantt: dir => {
      const g = this.store.get().gantt;
      const { from, days } = g;
      const { from: now } = this.ganttWindow(undefined, days);
      const start = from ?? now;
      // к сегодня — снова вслед за часами
      const next = dir === 0 ? undefined : start + dir * DAY;
      this.store.set({ gantt: { ...g, ...(next === undefined || next === now ? { from: undefined } : { from: next }) } });
      this.sendViews();
    },
    drag: (batch, notBefore) => {
      const g = this.store.get().gantt;
      if (g.drag?.batch === batch && g.drag.notBefore === notBefore) return;
      this.store.set({ gantt: { ...g, drag: { batch, notBefore }, ...(g.ghost?.batch === batch ? {} : { ghost: undefined }) } });
      this.sendViews();
    },
    drop: () => {
      // отпустили — строка черновика, не команда (часть 5); на утверждённый срок — строки нет
      const g = this.store.get().gantt;
      if (!g.drag) return;
      const draft = upsert(g.draft, g.drag, g.view?.batches[g.drag.batch]?.notBefore);
      this.store.set({ gantt: { ...g, drag: undefined, ghost: undefined, draft } });
      this.sendViews();
    },
    cancelDrag: () => {
      const g = this.store.get().gantt;
      if (!g.drag) return;
      this.store.set({ gantt: { ...g, drag: undefined, ghost: undefined } });
      this.sendViews();
    },
    approveDraft: () => {
      // утвердить — команды `shift` по строкам по порядку; черновик пуст. Расписание — команда производства (3е)
      const h = this.store.get();
      if (h.gantt.draft.length === 0 || !holds(h, 'production')) return;
      for (const cmd of commandsOf(h.gantt.draft)) this.client.command(cmd);
      this.store.set({ gantt: { ...h.gantt, draft: [] } });
      this.sendViews();
    },
    resetDraft: () => {
      const g = this.store.get().gantt;
      if (g.draft.length === 0) return;
      this.store.set({ gantt: { ...g, draft: [] } });
      this.sendViews();
    },
    runPlan: () => {
      // «как сейчас» и черновик, если он есть, — на одних и тех же зёрнах; снимок — строкой от потока расчёта
      const h = this.store.get();
      if (h.plan.running) return;
      const draft = h.gantt.draft;
      const variants: Command[][] = [[], ...(draft.length > 0 ? [commandsOf(draft)] : [])];
      this.store.set({ plan: { ...NO_RUN, running: true, variants: variants.length, key: JSON.stringify(draft) } });
      const seq = ++this.planSeq;
      void this.client.save().then(json => {
        // прервали или прогнали заново, пока снимок шёл, — этого прогона нет
        if (seq === this.planSeq && this.store.get().plan.running) this.planner.run(json, variants, PLAN_RUN.days, PLAN_RUN.seeds);
      });
    },
    stopPlan: () => {
      if (!this.store.get().plan.running) return;
      this.planSeq++;
      this.planner.stop();
      this.store.set({ plan: NO_RUN });
    },
    toggleInv: () => {
      // большое окно поверх карты, как расписание: панели справа, расписание и справочник закрываются
      const open = !this.store.get().inv.open;
      this.store.set({ inv: { open }, ...(open ? { ...this.rightClosed(), ref: { ...this.store.get().ref, open: false } } : {}), ...(open && this.store.get().gantt.open ? this.ganttClosed() : {}) });
      this.sendViews();
    },
    openInv: id => {
      this.store.set({ inv: { open: true, id }, ...this.rightClosed(), ref: { ...this.store.get().ref, open: false }, ...(this.store.get().gantt.open ? this.ganttClosed() : {}) });
      this.sendViews();
    },
    toggleRef: () => {
      // справочник — большое окно поверх карты, как доска расследования
      const r = this.store.get().ref;
      const open = !r.open;
      this.store.set({ ref: { ...r, open }, ...(open ? { ...this.rightClosed(), inv: { open: false } } : {}), ...(open && this.store.get().gantt.open ? this.ganttClosed() : {}) });
      this.sendViews();
    },
    setRefTab: tab => this.store.set({ ref: { ...this.store.get().ref, tab } }),
    investigate: (inv, step) => this.client.command({ kind: 'investigate', inv, step, by: 'player' }),
    conclude: (inv, cause, fate) => this.client.command({ kind: 'conclude', inv, cause, fate, by: 'player' }),
    openSeats: () => {
      // сменить место — на паузе; «Взять» пустит мир с прежней скоростью
      if (this.speed !== 0) this.resume = this.speed;
      this.speed = 0;
      this.ff = false;
      this.store.set({ seats: { open: true, pick: [...(this.store.get().top?.seats ?? [])] } });
      this.hud();
    },
    pickSeat: seat => {
      const h = this.store.get();
      if (!this.scenario.seats.includes(seat)) return;
      const pick = h.seats.pick.includes(seat) ? h.seats.pick.filter(x => x !== seat) : [...h.seats.pick, seat];
      this.store.set({ seats: { ...h.seats, pick } });
    },
    takeSeats: () => {
      const h = this.store.get();
      if (h.seats.pick.length === 0) return;
      this.client.command({ kind: 'seat', seats: h.seats.pick });
      this.store.set({ seats: { open: false, pick: [] } });
      this.actions.setSpeed(this.resume);
    },
    closeSeats: () => {
      // в начале партии место нужно выбрать: закрыть экран нечем
      if (!this.store.get().top?.seats) return;
      this.store.set({ seats: { open: false, pick: [] } });
    },
    setStock: patch => {
      const st = this.store.get().stock;
      this.store.set({ stock: { ...st, query: { ...st.query, ...patch } } });
      this.sendViews();
    },
    select: t => {
      if (same(t, this.selected)) return;
      this.selected = t;
      this.store.set({ selected: t, card: undefined });
      this.sendViews();
    },
    openMorning: () => {
      // последняя планёрка, которую окно видело; до первой — нечего открыть
      if (this.morningSeen === Number.NEGATIVE_INFINITY) return;
      this.store.set({ morning: { open: true, day: momentOf(this.scenario.start.date, this.morningSeen).day } });
      this.sendViews();
    },
    closeMorning: resume => {
      this.store.set({ morning: { open: false } });
      if (resume && this.speed === 0) this.actions.setSpeed(this.resume);
      this.sendViews();
    },
    setMorningPause: on => this.store.set({ morningPause: on }),
    toggleCash: () => {
      const c = this.store.get().cash;
      this.store.set({ cash: { ...c, open: !c.open }, ...this.rightClosed('cash') });
      this.sendViews();
    },
    toggleLab: () => {
      const l = this.store.get().lab;
      this.store.set({ lab: { ...l, open: !l.open }, ...this.rightClosed('lab') });
      this.sendViews();
    },
    setLabTab: tab => {
      this.store.set({ lab: { ...this.store.get().lab, tab } });
      this.sendViews();
    },
    rush: lot => this.client.command({ kind: 'rush', lot, by: 'player' }),
    setCashPage: page => {
      this.store.set({ cash: { ...this.store.get().cash, page } });
      this.sendViews();
    },
    showUnit: n => this.actions.show({ kind: 'unit', n }),
    show: t => {
      const r = t.kind === 'room' ? this.layout.rooms[t.i] : undefined;
      const b =
        t.kind === 'unit'
          ? palletBoxes([...this.pallets, ...this.carriedNow]).find(x => same(x.thing, t))
          : t.kind === 'machine' || t.kind === 'equipment'
            ? this.machineBoxes.find(x => same(x.thing, t))
            : r
              ? { min: [r.x, 0, r.z] as V3, max: [r.x + r.w, 0, r.z + r.d] as V3 }
              : undefined;
      if (b) {
        const cam = this.stage.cam;
        const el = this.stage.renderer.domElement;
        cam.target.set((b.min[0] + b.max[0]) / 2, 0, (b.min[2] + b.max[2]) / 2);
        cam.half = Math.min(cam.half, 8);
        // вещь — посреди части экрана, не закрытой панелью справа, и выше карточки (она снизу слева)
        const box = el.getBoundingClientRect();
        const panel = (document.getElementById('stock') ?? document.getElementById('cash') ?? document.getElementById('lab'))?.getBoundingClientRect();
        const free = panel ? Math.max(0, panel.left - box.left) : box.width;
        cam.pan(free / 2 - box.width / 2, -0.2 * box.height, el.clientHeight);
        // матрицы камеры — сейчас, а не в следующем кадре: точка вещи на экране и луч щелчка сразу новые
        cam.update(0);
      }
      this.actions.select(t);
    },
  };

  /**
   * Справа — одна панель: открыть одну — значит закрыть две другие и расписание (оно во всю ширину); без `keep` — закрыть
   * все три.
   */
  private rightClosed(keep?: 'stock' | 'cash' | 'lab'): Partial<Hud> {
    const h = this.store.get();
    return {
      ...(keep !== 'stock' ? { stock: { ...h.stock, open: false } } : {}),
      ...(keep !== 'cash' ? { cash: { ...h.cash, open: false } } : {}),
      ...(keep !== 'lab' ? { lab: { ...h.lab, open: false } } : {}),
      ...(keep && h.gantt.open ? { gantt: { open: false, days: h.gantt.days, draft: h.gantt.draft, ...(h.gantt.from !== undefined ? { from: h.gantt.from } : {}) } } : {}),
    };
  }

  /** Расписание закрыто: черновик и окно времени остаются. */
  private ganttClosed(): Partial<Hud> {
    const g = this.store.get().gantt;
    return { gantt: { open: false, days: g.days, draft: g.draft, ...(g.from !== undefined ? { from: g.from } : {}) } };
  }

  /** Окно расписания: с `from` или, вслед за часами, от полуночи — сегодняшней для суток, вчерашней для трёх суток и недели. */
  private ganttWindow(from: number | undefined, days: number): { from: number; to: number } {
    const start = from ?? Math.floor(this.t / DAY) * DAY - (days > 1 ? DAY : 0);
    return { from: start, to: start + days * DAY };
  }

  /**
   * Открытые виды панелей — потоку, если набор изменился: касса полосы — всегда; склад, карточка, планёрка, касса,
   * лаборатория, расписание и призрак того, что тянут, — оба с черновиком.
   */
  private sendViews() {
    const h = this.store.get();
    const st = h.stock;
    const list: ViewQuery[] = [{ id: 'top', view: 'top' }];
    if (st.open) list.push({ id: 'stock', ...st.query });
    if (this.selected) list.push({ id: 'card', view: 'card', thing: this.selected });
    if (h.morning.open && h.morning.day !== undefined) list.push({ id: 'morning', view: 'morning', day: h.morning.day });
    if (h.cash.open) list.push({ id: 'cash', view: 'cash', page: h.cash.page });
    if (h.lab.open) list.push(h.lab.tab === 'queue' ? { id: 'lab', view: 'lab' } : { id: 'chart', view: 'chart', test: 'test.ipc.mass' });
    const draft = h.gantt.draft.length > 0 ? { draft: [...h.gantt.draft] } : {};
    if (h.gantt.open) list.push({ id: 'gantt', view: 'gantt', ...this.ganttWindow(h.gantt.from, h.gantt.days), ...draft });
    if (h.gantt.open && h.gantt.drag) list.push({ id: 'ghost', view: 'ghost', ...h.gantt.drag, ...draft });
    if (h.inv.open) list.push({ id: 'inv', view: 'inv', ...(h.inv.id ? { inv: h.inv.id } : {}) });
    if (h.ref.open) list.push({ id: 'ref', view: 'ref' });
    const key = JSON.stringify(list);
    if (key === this.viewsSent) return;
    this.viewsSent = key;
    this.client.views(list);
  }

  /**
   * Точка экрана, щелчок в которую выбирает паллету: середина верха груза или одной из боковых граней — та, что не заслонена
   * ни соседями, ни панелями; для сценария в браузере. Паллету не видно — `undefined`.
   */
  clickPoint(n: number): { x: number; y: number } | undefined {
    const t: Thing = { kind: 'unit', n };
    const b = palletBoxes([...this.pallets, ...this.carriedNow]).find(x => same(x.thing, t));
    if (!b) return undefined;
    const [x0, y0, z0] = b.min;
    const [x1, y1, z1] = b.max;
    const [mx, my, mz] = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const faces: V3[] = [[mx, y1 - 0.02, mz], [x0 + 0.02, my, mz], [x1 - 0.02, my, mz], [mx, my, z0 + 0.02], [mx, my, z1 - 0.02]];
    const canvas = this.stage.renderer.domElement;
    for (const [x, y, z] of faces) {
      const sp = this.stage.screen(x, y, z);
      if (sp && document.elementFromPoint(sp.x, sp.y) === canvas && same(this.thingAt(sp.x, sp.y), t)) return sp;
    }
    return undefined;
  }

  /** Что под курсором (pick.ts): люди и техника — по точке на экране, паллеты, машины и фуры — лучом, помещение — по полу. */
  private thingAt(clientX: number, clientY: number): Thing | undefined {
    const spots: Spot[] = [];
    const near = (x: number, y: number, z: number, thing: Thing) => {
      const sp = this.stage.screen(x, y, z);
      if (sp) spots.push({ thing, px: Math.hypot(sp.x - clientX, sp.y - clientY) });
    };
    // люди и техника видны, только пока их не скрыла крупность показа (2г)
    if (this.detail[2] < 0.5) {
      for (const f of this.moversNow.people) near(f.x, 0.9, f.z, { kind: 'person', n: f.person });
      for (const v of this.moversNow.vehicles) near(v.x, 1, v.z, { kind: 'vehicle', n: v.vehicle });
    }
    const boxes = [...palletBoxes([...this.pallets, ...this.carriedNow]), ...this.machineBoxes, ...truckBoxes(this.trucksNow)];
    return pick(spots, this.stage.ray(clientX, clientY), boxes, this.layout);
  }

  /** Рамка выбранного в этом кадре: след паллеты, машины, фуры, помещения; круг у человека и техники. */
  private outline(): Outline | undefined {
    const t = this.selected;
    if (!t) return undefined;
    const rect = (b: Box): Outline => ({ rect: [b.min[0], b.min[2], b.max[0], b.max[2]], y: Math.max(0, b.min[1]) });
    switch (t.kind) {
      case 'unit': {
        const b = palletBoxes([...this.pallets, ...this.carriedNow]).find(x => same(x.thing, t));
        return b ? rect(b) : undefined;
      }
      case 'equipment':
      case 'machine': {
        const b = this.machineBoxes.find(x => same(x.thing, t));
        return b ? rect(b) : undefined;
      }
      case 'truck': {
        const b = truckBoxes(this.trucksNow).find(x => same(x.thing, t));
        return b ? { ...rect(b), y: 0 } : undefined;
      }
      case 'room': {
        const r = this.layout.rooms[t.i];
        return r ? { rect: [r.x, r.z, r.x + r.w, r.z + r.d], y: 0 } : undefined;
      }
      case 'person': {
        const f = this.moversNow.people.find(x => x.person === t.n);
        return f ? { circle: [f.x, f.z, 0.45], y: 0 } : undefined;
      }
      case 'vehicle': {
        const v = this.moversNow.vehicles.find(x => x.vehicle === t.n);
        return v ? { circle: [v.x, v.z, 1.1], y: 0 } : undefined;
      }
    }
  }

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
      } else if (e.button === 0) {
        // ЛКМ — выбрать вещь под курсором; мимо — снять выбор (как в «Больнице»)
        this.actions.select(this.thingAt(e.clientX, e.clientY));
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
      // ПКМ без протяжки — снять выбор
      if (e.button === 2 && this.mouse.drag && this.mouse.drag.moved < 4) this.actions.select(undefined);
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
      // экран «Кем вы будете» — поверх всего: клавиши мира молчат, Esc закрывает его, если место уже выбрано
      if (this.store.get().seats.open) {
        if (k === 'Escape') this.actions.closeSeats();
        return;
      }
      // в окне расписания стрелки двигают задание, а не камеру (Gantt.tsx)
      if ((e.target as HTMLElement | null)?.closest?.('.gantt') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) return;
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
      else if (k === 'KeyG') this.actions.toggleGantt();
      else if (k === 'KeyI') this.actions.toggleInv();
      else if (k === 'F1') {
        e.preventDefault();
        this.actions.toggleRef();
      } else if (k === 'F2') {
        e.preventDefault();
        this.actions.toggleStock();
      } else if (k === 'Escape') {
        // Esc: сначала то, что тянут в расписании, потом выбор, потом верхнее окно — расписание (оно поверх планёрки),
        // планёрка, затем панель справа
        const h = this.store.get();
        if (h.gantt.drag) this.actions.cancelDrag();
        else if (this.selected) this.actions.select(undefined);
        else if (h.gantt.open) this.actions.toggleGantt();
        else if (h.inv.open) this.actions.toggleInv();
        else if (h.ref.open) this.actions.toggleRef();
        else if (h.morning.open) this.actions.closeMorning(false);
        else if (h.cash.open) this.actions.toggleCash();
        else if (h.lab.open) this.actions.toggleLab();
        else if (h.stock.open) this.actions.toggleStock();
      } else this.mouse.keys.add(k);
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
