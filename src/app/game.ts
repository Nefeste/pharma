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
import type { Command, DeptMode, Head, Notice } from '../engine/types';
import { dayText, durText, hText, named, qtyText, T } from '../i18n';
import { bakeLook, lodOf, packPeople } from '../render/bake';
import type { ArtIndex } from '../render/blender';
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
import { assetClass, workName } from '../ui/assets';
import { useDb } from '../ui/db';
import { commandsOf, draftKey, ordersOf, prune, upsert } from '../ui/draft';
import { type Actions, holds, type Hud, LIVE, NO_RUN, PLAN_RUN, type Speed, type Store } from '../ui/store';
import { type ArtMode, loadArt } from './art';
import { keepFirsts, keptFirsts } from './firsts';
import { andonBoxes, andonMarks, barBoxes, DATA_LAYERS, midSpot, nextLayer, plateBoxes, platesOf } from './floor';
import { fillsOf, Flows, lineArrows, moveArrows, movesOf, peopleMoves } from './flows';
import { type Movers, moversAt, taskIcons } from './movers';
import { stopKey } from '../sim/protocol';
import { EVENT_CAP, type Go, goOf, keepOff, keptOff, stopKinds } from './pauses';
import { keep, windowKeep } from './preset';
import { type Box, machineBoxes, nearest, palletBoxes, pick, same, type Spot, truckBoxes, type V3 } from './pick';
import { carriedOf, dockFront, palletsOf, SceneState } from './scene';
import { type TruckPose, Yard } from './yard';

/** Сценарий части 0 (content/scenarios/proto.yaml) и его план. */
export const SCENARIO = 'scn.proto';
export const PLANT = 'plant.proto';

/** Игровых секунд в секунду на каждой скорости (геймдизайн, §2). */
export const RATE: Record<Speed, number> = { 0: 0, 1: 60, 2: 300, 3: 1200, 4: 7200, 5: 1 };

/** Промотка: кусок игровых секунд на кадр и предел отставания, при котором поток получает новый кусок. */
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
    /** стартовый замер кадра (preset.ts): на каком пресете мерили, сколько кадров, медиана, что выбрали — для сценария */
    __preset?: { from: string; frames: number; median: number; to: string };
  }
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const MODELS = './assets/models';
type ModelIndex = ArtIndex & { people: string[] };

/**
 * Люди — модели CC0 из assets/models/people (assets/LICENSES.md): загрузить, запечь анимации и упростить для дальнего
 * плана, как в «Больнице» (её src/app/game.ts).
 */
async function loadPeople(index: ModelIndex) {
  const base = MODELS;
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
  /** слой «Потоки — люди» (Б1г): переходы людей между помещениями и где каждый был в прошлом срезе */
  readonly peopleFlows = new Flows();
  private peopleAt = new Map<number, string>();
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
  /** «Смотреть» (Б1б): какую работу — ключ строки «Сейчас» — и к какой скорости вернуться, когда она кончится */
  private watching?: { key: string; resume: Speed };
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
  /**
   * промотка: «До утра» — до ближайших 08:00, «До события» (Б2а) — до первого извещения автопаузы, не дольше `EVENT_CAP`;
   * `ffLeft` — сколько игровых секунд ещё отправить
   */
  ff = false;
  ffTo: 'morning' | 'event' = 'morning';
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

  /** что лежит в assets/models: люди и модели из Blender */
  private models!: ModelIndex;

  /** База, сцена, поток — и первый кадр после первого среза; `art` — модели из Blender или кодом (#109). */
  static async create(host: HTMLElement, store: Store, quality: Quality, art: ArtMode = 'blender'): Promise<Game> {
    const db = (await (await fetch('./content.json')).json()) as ContentDb;
    useDb(db);
    const g = new Game(db, store, host);
    const sc = db.scenarios[SCENARIO];
    if (!sc) throw new Error(`no scenario ${SCENARIO}`);
    g.scenario = sc;
    g.layout = layoutOf(planOf(db, sc.plant));
    g.machineBoxes = machineBoxes(db, g.layout);
    g.models = (await (await fetch(`${MODELS}/index.json`)).json()) as ModelIndex;
    const models = art === 'blender' ? await loadArt(loader, MODELS, g.models) : undefined;
    store.set({ art });
    // паллет в сцене — сколько мест в плане и ещё на фуры и в помещения
    g.stage = new Stage({ host, layout: g.layout, db, quality, capacity: g.layout.plan.slots.length + 256, art: models });
    const crowd = await loadPeople(g.models);
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
    store.set({ ready: true, start: sc.start.date, quality, walls: g.stage.wallMode, pauses: { open: false, off: keptOff(windowKeep()) }, firsts: keptFirsts(windowKeep()) });
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
    this.peopleFlows.step(sl.t, peopleMoves(this.layout, this.peopleAt, sl.people));
    this.t = sl.t;
    this.day = sl.day;
    this.lag = s.lag;
    // эта игра (обёртка): с первого среза — итог игры на планёрке и её минуты
    if (!this.store.get().session) this.store.set({ session: { from: sl.t, real: performance.now() } });
    this.view.apply(sl);
    // слой «Потоки — люди» (Б1г) — стрелки переходов людей вместо перевозок паллет и линии
    const arrows = this.store.get().layer === 'people' ? moveArrows(this.layout, this.peopleFlows) : [...moveArrows(this.layout, this.flows), ...lineArrows(this.db, this.layout, sl.lines)];
    this.stage.setOverlay(arrows, fillsOf(this.layout.plan, this.view.units.values()));
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
      } else if (d.view === 'journal') {
        if (hud.journal.open) this.store.set({ journal: { ...this.store.get().journal, view: d } });
      } else if (d.view === 'po') {
        if (hud.po.open) this.store.set({ po: { ...this.store.get().po, view: d } });
      } else if (d.view === 'dossier') {
        const x = this.store.get().dossier;
        if (x.open && x.batch === d.batch) this.store.set({ dossier: { ...x, view: d } });
      } else if (d.view === 'ref') {
        if (hud.ref.open) this.store.set({ ref: { ...this.store.get().ref, view: d } });
      } else if (d.view === 'kpi') {
        // окно «Показатели» (Б5ж): вид прежней вкладки или месяца, отправленный до нового запроса, не показываем
        const k = this.store.get().kpi;
        if (k.open && k.tab === d.tab && (d.month.closed ? d.month.from : undefined) === k.month) this.store.set({ kpi: { ...k, view: d } });
      } else if (d.view === 'now') {
        this.store.set({ now: { ...this.store.get().now, view: d } });
        // смотрели работу — её строки больше нет: работа кончилась, прежняя скорость
        if (this.watching && !d.rows.some(r => r.key === this.watching!.key)) this.actions.setSpeed(this.watching.resume);
      } else if (d.view === 'floor') {
        // вид «Пол» (Б1и): столбики и доски на полу, блок «Загрузка» в карточке, подсказка; таблички «Узких мест» (Б1к)
        this.store.set({ floor: { ...this.store.get().floor, view: d } });
        this.stage.setFloor(d);
        this.stage.plates.set(platesOf(this.layout, d));
      } else if (d.view === 'andon') {
        // вид «Андон» (Б1к): значки над вещами ставит кадр — фуры, паллеты и техника двигаются
        this.store.set({ andon: { view: d } });
      } else if (d.view === 'ghost') {
        // призрак того, что тянут сейчас; прежний запрос — не показываем
        const g = this.store.get().gantt;
        if (g.drag?.batch === d.batch && g.drag.notBefore === d.notBefore) this.store.set({ gantt: { ...g, ghost: d } });
      } else this.store.set({ top: d });
    }
    // извещения автопауз игрока — вес «стоп» (13-art.md, §11): на таком поток встал; в полосе — оно, а не то, что пришло с
    // ним позже. Предложение руководителя (Б5б) в ту же минуту — под тем, что случилось: сначала событие, потом совет
    const stops = new Set(this.stops());
    const stop = (n: Notice) => stops.has(stopKey(n));
    for (const n of s.notices) if (!stop(n)) this.notice(n, false);
    for (const n of s.notices) if (stop(n) && n.kind === 'proposal') this.notice(n, true);
    for (const n of s.notices) if (stop(n) && n.kind !== 'proposal') this.notice(n, true);
    if (s.notices.some(n => n.kind === 'morning')) this.morning(sl.t);
    if (s.stopped) this.autopause();
    this.gotSlice();
  }

  /**
   * Планёрка в 08:00 (3в): открывается сама; «До утра» кончается на ней паузой, а автопауза планёрки (по умолчанию) ставит
   * мир на паузу при любой скорости — поток встаёт ровно на 08:00 (геймдизайн, §2). Без автопаузы срез мог уйти дальше
   * 08:00: планёрка — последних 08:00 до среза.
   */
  private morning(t: number) {
    const at = Math.floor((t - MORNING) / DAY) * DAY + MORNING;
    this.morningSeen = at;
    if (this.ff && this.ffTo === 'morning') {
      if (this.speed !== 0) this.resume = this.speed;
      this.speed = 0;
      this.ff = false;
    }
    this.store.set({ morning: { open: true, day: momentOf(this.scenario.start.date, at).day } });
    this.sendViews();
    this.hud();
  }

  /**
   * Автопауза (Б2а): поток встал на извещении автопаузы игрока — мир на паузе, промотка и «Смотреть» кончились, секунды,
   * которые часы окна набрали сверх, не уходят в поток.
   */
  private autopause() {
    if (this.speed !== 0) this.resume = this.speed;
    this.speed = 0;
    this.ff = false;
    this.ffLeft = 0;
    this.client.drop();
    this.stopWatching();
    this.hud();
  }

  /** «До события» прожило `EVENT_CAP` и не встало: события автопаузы не было — пауза и извещение об этом. */
  private noEvent() {
    if (this.speed !== 0) this.resume = this.speed;
    this.speed = 0;
    this.ff = false;
    this.notices.unshift({ t: this.t, text: T.pauses.none(Math.round(EVENT_CAP / DAY)) });
    this.hud();
  }

  /** Ключи извещений, на которых мир встаёт: включённые автопаузы мест игрока (pauses.ts). */
  private stops() {
    const h = this.store.get();
    return stopKinds(h.pauses.off, h.top?.seats);
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
    this.stage.setMovers(mv, this.carriedNow, ts / 1000, taskIcons(v.tasks, v.people));
    this.stage.setSelection(this.outline());
  }

  private notice(n: Notice, stop: boolean) {
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
      : n.kind === 'batchHeld' ? (n.mine ? T.notices.batchHeldMine : T.notices.batchHeld)
      : n.kind === 'deviation' ? T.notices.deviation(T.morning.devKinds[n.what], n.code ? T.gantt.batch(n.code) : '')
      : n.kind === 'shipped' ? T.notices.shipped
      : n.kind === 'lateOrder' ? T.notices.lateOrder
      : n.kind === 'cashLow' ? T.notices.cashLow
      : n.kind === 'failure' ? T.notices.failure(...this.machineNames(n.machine, n.part))
      : n.kind === 'repaired' ? T.notices.repaired
      : n.kind === 'truckWait' ? T.notices.truckWait(named(this.db.suppliers[n.supplier]?.name, n.supplier))
      : n.kind === 'orderRisk'
        ? T.notices.orderRisk(named(this.db.customers[n.customer]?.name, n.customer), dayText(momentOf(this.scenario.start.date, n.due).day), n.missing)
      : n.kind === 'materialLate' ? this.lateText(n)
      : n.kind === 'investigation' ? T.notices.investigation(named(this.db.tests[n.method]?.name, n.method), n.code)
      : n.kind === 'invStep' ? T.notices.invStep
      : n.kind === 'concluded' ? T.notices.concluded(n.fate)
      : n.kind === 'assessed' ? T.notices.assessed(n.verdict, n.code)
      : n.kind === 'qualLost' ? T.notices.qualLost(named(this.db.roles[n.role]?.name, n.role), n.tab, n.doc)
      : n.kind === 'rostered'
        ? n.cancel
          ? T.notices.rosterCancel(T.card.person(named(this.db.roles[n.role]?.name, n.role), n.tab))
          : T.notices.rostered(T.card.person(named(this.db.roles[n.role]?.name, n.role), n.tab), named(this.db.shifts[n.shift]?.name, n.shift), dayText(n.from))
      : n.kind === 'vacancy' ? T.notices.vacancy(T.hire.vacancyWhat(this.roleName(n.role), named(this.db.shifts[n.shift]?.name, n.shift)), T.hire.via[n.via], n.by === 'colleague')
      : n.kind === 'candidates' ? T.notices.candidates(this.roleName(n.role), n.n)
      : n.kind === 'accepted' ? T.notices.accepted(this.roleName(n.role), dayText(n.day))
      : n.kind === 'hired' ? T.notices.hired(T.card.person(this.roleName(n.role), n.tab))
      : n.kind === 'resign' ? T.notices.resign(T.card.person(this.roleName(n.role), n.tab), dayText(n.last))
      : n.kind === 'dismissed' ? T.notices.dismissed(T.card.person(this.roleName(n.role), n.tab), T.hire.why[n.why], dayText(n.last))
      : n.kind === 'left' ? T.notices.left(T.card.person(this.roleName(n.role), n.tab), T.hire.why[n.why])
      : n.kind === 'leaveDraft' ? T.notices.leaveDraft(n.y, n.miss)
      : n.kind === 'leaveApproved' ? T.notices.leaveApproved(n.y)
      : n.kind === 'leaveNotice' ? T.notices.leaveNotice(T.card.person(this.roleName(n.role), n.tab), dayText(n.from), dayText(n.to), n.deputy && T.card.person(this.roleName(n.deputy.role), n.deputy.tab))
      : n.kind === 'leaveStart' ? T.notices.leaveStart(T.card.person(this.roleName(n.role), n.tab), dayText(n.to), n.deputy && T.card.person(this.roleName(n.deputy.role), n.deputy.tab))
      : n.kind === 'leaveEnd' ? T.notices.leaveEnd(T.card.person(this.roleName(n.role), n.tab))
      : n.kind === 'overtimeLow' ? T.notices.overtimeLow(named(this.db.roles[n.role]?.name, n.role), n.tab, durText(n.left), hText(this.db.profiles[this.scenario.profile].payroll.overtime.year))
      : n.kind === 'assetExpired' ? T.notices.assetExpired(workName(n, n.work), assetClass(n), T.assets.inv(n.inv))
      : n.kind === 'pairSuspended' ? T.notices.pairSuspended(named(this.db.suppliers[n.supplier]?.name, n.supplier), named(this.db.makers[n.maker]?.name, n.maker))
      : n.kind === 'setpoints' ? T.notices.setpoints(n.n)
      : n.kind === 'proposal' ? T.notices.proposal(T.journal.names[n.head] ?? n.head)
      : n.kind === 'refused' && n.why === 'notYours' ? T.seats.notYours(T.seats.names[n.detail ?? ''] ?? n.detail ?? '')
      : n.kind === 'refused' && T.notices.why[n.why] ? `${T.notices.refused}: ${T.notices.why[n.why]}`
      : T.notices.refused;
    // щелчок ведёт на место: к машине, к фуре, в окно или на доску расследования
    const go = goOf(this.layout.plan.plant, n);
    this.notices.unshift({ t: this.t, text, ...(stop ? { stop: true as const } : {}), ...(go ? { go } : {}) });
    if (this.notices.length > 30) this.notices.length = 30;
  }

  /** Роль словами. */
  private roleName(id: string): string {
    return named(this.db.roles[id]?.name, id);
  }

  /** Машина и узел — словами: машина линии или оборудование участка по имени в плане. */
  private machineNames(id: string, part: string): [string, string] {
    const plant = this.layout.plan.plant;
    const type = plant.lines.flatMap(l => l.machines).find(m => m.id === id)?.type ?? plant.equipment.find(e => e.id === id)?.type ?? id;
    const rec = this.db.machines[type] ?? this.db.equipment[type];
    return [named(rec?.name, type), named(rec?.parts.find(p => p.id === part)?.name, part)];
  }

  /** Материал не пришёл (Б2а): серия или задание, первый материал, которого не хватает, и сколько. */
  private lateText(n: Extract<Notice, { kind: 'materialLate' }>): string {
    const who = n.code ? T.gantt.batch(n.code) : T.gantt.order(Number(n.batch.slice(1)));
    const first = n.short[0];
    const mat = first ? this.db.materials[first.material] : undefined;
    const what = first ? `${named(mat?.name, first.material)}, ${mat ? qtyText(first.qty, mat.unit) : String(first.qty)}` : '';
    return T.notices.materialLate(who, what, n.pack === true, n.short.length);
  }

  // ---------------------------------------------------------------- кадр

  private loop = (ts: number) => {
    requestAnimationFrame(this.loop);
    const dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0;
    if (this.last) this.push(this.frames.interval, ts - this.last);
    this.last = ts;
    // промотка: столько, сколько поток успевает, — новый кусок, только когда прежний почти досчитан; «До утра» — не дальше
    // 08:00, «До события» — пока поток не встанет на автопаузе
    let game = RATE[this.speed] * dt;
    if (this.ff) {
      game = 0;
      if (!this.client.busy && this.lag < FF_LAG && this.ffLeft > 0) {
        game = Math.min(FF_CHUNK, this.ffLeft);
        this.ffLeft -= game;
      } else if (this.ffTo === 'event' && this.ffLeft <= 0 && !this.client.busy && this.lag === 0) this.noEvent();
    }
    // автопаузы игрока — с каждым кадром: поток встанет ровно на событии (Б2а)
    if (!this.manual) this.client.frame(game, this.ff ? 14 : 8, this.stops());
    this.onFrame?.(ts);
    this.edgePan(dt);
    // крупность показа — по скорости и высоте камеры; веса доходят до нового уровня за 0,4 с
    this.camLevel = camDetail(this.stage.cam.half, this.camLevel);
    this.detailTarget = Math.max(this.camLevel, speedDetail(this.speed, this.ff)) as Detail;
    this.detail = ease(this.detail, this.detailTarget, dt);
    this.stage.setDetail(this.detail);
    const a = performance.now();
    this.showMovers(ts);
    if (this.store.get().layer === 'andon') this.stage.andon.set(andonMarks(this.store.get().andon.view?.items ?? [], this.thingTop));
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
      ffTo: this.ffTo,
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
      // скорость сменили — смотреть перестали (сами или потому, что работа кончилась)
      this.stopWatching();
      this.hud();
    },
    untilMorning: () => {
      if (this.store.get().seats.open) return;
      this.stopWatching();
      // часы игры — это часы завода плюс отставание расчёта
      const now = this.t + this.lag;
      const day = Math.floor(now / 86400) * 86400;
      const target = now < day + MORNING ? day + MORNING : day + 86400 + MORNING;
      this.ffLeft = target - now;
      this.ff = this.ffLeft > 0;
      this.ffTo = 'morning';
      this.hud();
    },
    untilEvent: () => {
      if (this.store.get().seats.open) return;
      this.stopWatching();
      this.ffLeft = EVENT_CAP;
      this.ff = true;
      this.ffTo = 'event';
      this.hud();
    },
    togglePauses: () => {
      const p = this.store.get().pauses;
      this.store.set({ pauses: { ...p, open: !p.open } });
    },
    setPause: (id, on) => {
      const p = this.store.get().pauses;
      const off = on ? p.off.filter(x => x !== id) : p.off.includes(id) ? p.off : [...p.off, id];
      this.store.set({ pauses: { ...p, off } });
      keepOff(windowKeep(), off);
    },
    go: (g: Go) => {
      if ('inv' in g) this.actions.openInv(g.inv);
      else if ('journal' in g) this.actions.openJournal(g.journal);
      else if ('thing' in g) this.actions.show(g.thing);
      else if (g.panel === 'gantt') {
        if (!this.store.get().gantt.open) this.actions.toggleGantt();
      } else if (g.panel === 'lab') {
        if (!this.store.get().lab.open) this.actions.toggleLab();
      } else if (g.panel === 'ref') {
        // справочник на вкладке извещения: «Места» (Б3в), «Контрагенты» (Б3г), «Люди» (Б4в)
        if (!this.store.get().ref.open) this.actions.toggleRef();
        this.actions.setRefTab(g.tab);
      } else this.actions.openMorning();
    },
    setQuality: (q: Quality) => {
      this.stage.applyQuality(q);
      this.store.set({ quality: q });
    },
    setArt: (art: ArtMode) => {
      if (art === 'code') {
        this.stage.setArt(undefined);
        this.store.set({ art });
        return;
      }
      void loadArt(loader, MODELS, this.models).then(a => {
        this.stage.setArt(a);
        this.store.set({ art });
      });
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
      this.store.set({ gantt: { open, days: g.days, draft: g.draft, urgent: g.urgent, ...(g.from !== undefined ? { from: g.from } : {}) }, ...(open ? { ...this.rightClosed(), inv: { open: false }, ref: { ...this.store.get().ref, open: false } } : {}) });
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
      // утвердить — команды `shift` по строкам по порядку и срочные задания — команды `order` (Б1г); черновик пуст.
      // Расписание — команда производства (3е)
      const h = this.store.get();
      if ((h.gantt.draft.length === 0 && h.gantt.urgent.length === 0) || !holds(h, 'production')) return;
      for (const cmd of [...commandsOf(h.gantt.draft), ...ordersOf(h.gantt.urgent)]) this.client.command(cmd);
      this.store.set({ gantt: { ...h.gantt, draft: [], urgent: [] } });
      this.sendViews();
    },
    resetDraft: () => {
      const g = this.store.get().gantt;
      if (g.draft.length === 0 && g.urgent.length === 0) return;
      this.store.set({ gantt: { ...g, draft: [], urgent: [] } });
      this.sendViews();
    },
    runPlan: () => {
      // «как сейчас» и черновик, если он есть, — на одних и тех же зёрнах; снимок — строкой от потока расчёта
      const h = this.store.get();
      if (h.plan.running) return;
      const { draft, urgent } = h.gantt;
      const changes = [...commandsOf(draft), ...ordersOf(urgent)];
      const variants: Command[][] = [[], ...(changes.length > 0 ? [changes] : [])];
      this.store.set({ plan: { ...NO_RUN, running: true, variants: variants.length, key: draftKey(draft, urgent) } });
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
      this.store.set({ inv: { open }, ...(open ? { ...this.rightClosed(), ref: { ...this.store.get().ref, open: false }, kpi: { ...this.store.get().kpi, open: false } } : {}), ...(open && this.store.get().gantt.open ? this.ganttClosed() : {}) });
      this.sendViews();
    },
    openInv: id => {
      this.store.set({ inv: { open: true, id }, ...this.rightClosed(), ref: { ...this.store.get().ref, open: false }, kpi: { ...this.store.get().kpi, open: false }, ...(this.store.get().gantt.open ? this.ganttClosed() : {}) });
      this.sendViews();
    },
    // досье серии (Б1д) — поверх остальных окон: открыли из карточки, «Сейчас» или расписания — они остаются под ним
    openDossier: batch => {
      const x = this.store.get().dossier;
      this.store.set({ dossier: { open: true, batch, ...(x.batch === batch && x.view ? { view: x.view } : {}) } });
      this.sendViews();
    },
    closeDossier: () => {
      this.store.set({ dossier: { open: false } });
      this.sendViews();
    },
    toggleRef: () => {
      // справочник — большое окно поверх карты, как доска расследования
      const r = this.store.get().ref;
      const open = !r.open;
      this.store.set({ ref: { ...r, open }, ...(open ? { ...this.rightClosed(), inv: { open: false }, kpi: { ...this.store.get().kpi, open: false } } : {}), ...(open && this.store.get().gantt.open ? this.ganttClosed() : {}) });
      this.sendViews();
    },
    setRefTab: tab => this.store.set({ ref: { ...this.store.get().ref, tab } }),
    toggleKpi: () => {
      // K открывает нынешний месяц; закрытый — рычаг «Итогов месяца», щелчок по столбику и стрелки у месяца
      const k = this.store.get().kpi;
      if (k.open) {
        this.store.set({ kpi: { ...k, open: false } });
        this.sendViews();
      } else this.actions.openKpi();
    },
    openKpi: month => {
      // окно «Показатели» (Б5ж) — большое, как справочник; открыли впервые — вкладка взятого места
      const k = this.store.get().kpi;
      const held = this.store.get().top?.seats?.[0];
      const tab = !k.view && held ? held : k.tab;
      const keep = k.view?.tab === tab && (k.view.month.closed ? k.view.month.from : undefined) === month;
      this.store.set({ kpi: { open: true, tab, ...(k.why ? { why: k.why } : {}), ...(month !== undefined ? { month } : {}), ...(keep ? { view: k.view } : {}) }, ...this.rightClosed(), inv: { open: false }, ref: { ...this.store.get().ref, open: false }, ...(this.store.get().gantt.open ? this.ganttClosed() : {}) });
      this.sendViews();
    },
    setKpiTab: tab => {
      const { view, ...k } = this.store.get().kpi;
      this.store.set({ kpi: { ...k, tab, ...(view?.tab === tab ? { view } : {}) } });
      this.sendViews();
    },
    kpiWhy: id => {
      const { why, ...rest } = this.store.get().kpi;
      this.store.set({ kpi: why === id ? rest : { ...rest, why: id } });
      this.sendViews();
    },
    setKpiMonth: month => {
      const { view, month: was, ...k } = this.store.get().kpi;
      if (was === month) return;
      this.store.set({ kpi: { ...k, ...(month !== undefined ? { month } : {}), ...(view ? { view } : {}) } });
      this.sendViews();
    },
    investigate: (inv, step) => this.client.command({ kind: 'investigate', inv, step, by: 'player' }),
    release: (batch, decision) => this.client.command({ kind: 'release', batch, decision }),
    assess: (deviation, verdict) => this.client.command({ kind: 'assess', deviation, verdict, by: 'player' }),
    setpoint: x => this.client.command({ kind: 'setpoint', ...x, by: 'player' }),
    urgent: (recipe, sku) => {
      // срочное задание (Б1г) — строка черновика, его полосы — в расписании (0.0.39); «Прогнать план» — что оно изменит
      const g = this.store.get().gantt;
      this.store.set({ gantt: { ...g, urgent: [...g.urgent, { recipe, sku }] } });
      if (!g.open) this.actions.toggleGantt();
      else this.sendViews();
    },
    toggleFlows: () => this.actions.setLayer(this.store.get().layer === 'people' ? 'plain' : 'people'),
    setLayer: l => {
      // слой данных один (Б1и): с ним стрелки перевозок не проступают; «Потоки — люди» — стрелки переходов людей
      this.stage.forceLayer(l === 'people');
      this.stage.setDataLayer(DATA_LAYERS.has(l) ? (l as 'load' | 'bottle' | 'andon') : undefined);
      this.store.set({ layer: l, floor: { ...this.store.get().floor, hover: undefined } });
      this.sendViews();
    },
    nextLayer: () => this.actions.setLayer(nextLayer(this.store.get().layer)),
    setFloorWin: win => {
      this.store.set({ floor: { ...this.store.get().floor, win } });
      this.sendViews();
    },
    understood: kind => {
      const list = this.store.get().firsts;
      if (list.includes(kind)) return;
      const next = [...list, kind];
      keepFirsts(windowKeep(), next);
      this.store.set({ firsts: next });
    },
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
      // режимы отделов места (Б5б): выбранные на экране — командами `mode` уже со взятого места; тот же выбор — не шлём
      const kept = h.top?.modes ?? {};
      for (const [head, mode] of Object.entries(h.seats.modes ?? {}) as [Head, DeptMode][]) if (kept[head] !== mode) this.client.command({ kind: 'mode', head, mode, by: 'player' });
      this.store.set({ seats: { open: false, pick: [] } });
      this.actions.setSpeed(this.resume);
    },
    pickMode: (head, mode) => {
      const st = this.store.get().seats;
      this.store.set({ seats: { ...st, modes: { ...st.modes, [head]: mode } } });
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
    toggleNow: () => {
      const n = this.store.get().now;
      this.store.set({ now: { ...n, open: !n.open }, ...this.rightClosed('now') });
      this.sendViews();
    },
    toggleJournal: () => {
      // закрыли — запись, на которой открывали, больше не раскрыта; отбор остаётся
      const { focus, ...j } = this.store.get().journal;
      const open = !j.open;
      this.store.set({ journal: { ...j, open, ...(open && focus !== undefined ? { focus } : {}) }, ...this.rightClosed('journal'), ...(open ? this.bigClosed() : {}) });
      this.sendViews();
    },
    openJournal: focus => {
      // «Почему?» (Б5а): журнал на этой записи — без отбора, чтобы она была видна; запись раскрыта. Досье серии — поверх
      // всего: его закрывают, к серии ведёт «К вещи»
      const j = this.store.get().journal;
      const keep = focus !== undefined ? { focus } : { ...(j.seat ? { seat: j.seat } : {}), ...(j.who ? { who: j.who } : {}) };
      this.store.set({ journal: { open: true, page: 0, ...keep, ...(j.view ? { view: j.view } : {}) }, ...this.rightClosed('journal'), ...this.bigClosed(), ...(this.store.get().dossier.open ? { dossier: { open: false } } : {}) });
      this.sendViews();
    },
    setJournal: patch => {
      const j = this.store.get().journal;
      const seat = patch.seat === null ? undefined : (patch.seat ?? j.seat);
      const who = patch.who === null ? undefined : (patch.who ?? j.who);
      this.store.set({ journal: { open: j.open, page: patch.page ?? 0, ...(seat ? { seat } : {}), ...(who ? { who } : {}), ...(j.view ? { view: j.view } : {}) } });
      this.sendViews();
    },
    watch: key => {
      const row = this.store.get().now.view?.rows.find(r => r.key === key);
      if (!row || this.store.get().seats.open) return;
      // прежняя скорость — та, что была до первого «Смотреть»: смотрят другую работу — к ней же и вернёмся
      const resume = this.watching?.resume ?? this.speed;
      if (row.thing) this.actions.show(row.thing);
      this.actions.setSpeed(1);
      this.watching = { key, resume };
      this.store.set({ watch: row });
      this.sendViews();
    },
    unwatch: () => {
      if (this.watching) this.actions.setSpeed(this.watching.resume);
    },
    setLabTab: tab => {
      this.store.set({ lab: { ...this.store.get().lab, tab } });
      this.sendViews();
    },
    rush: lot => this.client.command({ kind: 'rush', lot, by: 'player' }),
    overtime: (dept, mode) => this.client.command({ kind: 'overtime', dept, mode, by: 'player' }),
    waste: () => this.client.command({ kind: 'waste', by: 'player' }),
    answer: (n, ok) => this.client.command({ kind: ok ? 'accept' : 'decline', n }),
    setMode: (head, mode) => this.client.command({ kind: 'mode', head, mode, by: 'player' }),
    maintain: (machine, part) => this.client.command({ kind: 'maintain', machine, part }),
    togglePo: () => {
      const po = this.store.get().po;
      this.store.set({ po: { ...po, open: !po.open } });
      this.sendViews();
    },
    setPo: patch => {
      const po = this.store.get().po;
      // другой поставщик — строки прежнего ему не годятся
      const lines = patch.lines ?? (patch.supplier !== undefined && patch.supplier !== po.supplier ? [] : po.lines);
      this.store.set({ po: { ...po, ...(patch.supplier !== undefined ? { supplier: patch.supplier } : {}), lines } });
      this.sendViews();
    },
    suggestPo: () => {
      // «Предложить» (Б5б): строки правила снабжения у этого поставщика — то, что он заказал бы сейчас
      const po = this.store.get().po;
      const v = po.view;
      const supplier = po.supplier ?? v?.supplier;
      const plan = v?.plan.find(x => x.supplier === supplier) ?? (po.supplier ? undefined : v?.plan[0]);
      if (!plan) return;
      this.store.set({ po: { ...po, supplier: plan.supplier, lines: plan.lines.map(l => ({ ...l })) } });
      this.sendViews();
    },
    sendPo: () => {
      const po = this.store.get().po;
      const supplier = po.supplier ?? po.view?.supplier;
      if (!supplier || po.lines.length === 0) return;
      this.client.command({ kind: 'po', supplier, lines: po.lines.map(l => ({ material: l.material, qty: l.qty })), by: 'player' });
      this.store.set({ po: { ...po, lines: [] } });
      this.sendViews();
    },
    roster: (person, shift) => this.client.command({ kind: 'roster', person: `E${person}`, shift, by: 'player' }),
    vacancy: (role, shift, via) => this.client.command({ kind: 'vacancy', role, shift, via, by: 'player' }),
    closeVacancy: id => this.client.command({ kind: 'close', vacancy: id, by: 'player' }),
    hire: (candidate, trial) => this.client.command({ kind: 'hire', candidate, trial, by: 'player' }),
    dismiss: (person, why) => this.client.command({ kind: 'dismiss', person: `E${person}`, why, by: 'player' }),
    leaveAdd: (person, from, days) => this.client.command({ kind: 'leave', person: `E${person}`, op: 'add', from, days, by: 'player' }),
    leaveMove: (person, part, from) => this.client.command({ kind: 'leave', person: `E${person}`, op: 'move', part, from, by: 'player' }),
    leaveDrop: (person, part) => this.client.command({ kind: 'leave', person: `E${person}`, op: 'drop', part, by: 'player' }),
    leaveDeputy: (person, part, deputy) => this.client.command({ kind: 'leave', person: `E${person}`, op: 'deputy', part, ...(deputy !== undefined ? { deputy: `E${deputy}` } : {}), by: 'player' }),
    also: (person, role, on) => this.client.command({ kind: 'also', person: `E${person}`, role, on, by: 'player' }),
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
            : t.kind === 'truck'
              ? truckBoxes(this.trucksNow).find(x => same(x.thing, t))
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
        const panel = (document.getElementById('stock') ?? document.getElementById('cash') ?? document.getElementById('lab') ?? document.getElementById('now'))?.getBoundingClientRect();
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
  /**
   * Большие окна во всю ширину — доска расследования и справочник — закрыты (Б5а): журнал справа открывают из них, а под
   * ними его не видно; к ним ведёт «К вещи».
   */
  private bigClosed(): Partial<Hud> {
    const h = this.store.get();
    return { ...(h.inv.open ? { inv: { open: false } } : {}), ...(h.ref.open ? { ref: { ...h.ref, open: false } } : {}), ...(h.kpi.open ? { kpi: { ...h.kpi, open: false } } : {}) };
  }

  private rightClosed(keep?: 'stock' | 'cash' | 'lab' | 'now' | 'journal'): Partial<Hud> {
    const h = this.store.get();
    return {
      ...(keep !== 'stock' ? { stock: { ...h.stock, open: false } } : {}),
      ...(keep !== 'cash' ? { cash: { ...h.cash, open: false } } : {}),
      ...(keep !== 'lab' ? { lab: { ...h.lab, open: false } } : {}),
      ...(keep !== 'now' ? { now: { ...h.now, open: false } } : {}),
      ...(keep !== 'journal' ? { journal: { ...h.journal, open: false } } : {}),
      ...(keep && h.gantt.open ? { gantt: { open: false, days: h.gantt.days, draft: h.gantt.draft, urgent: h.gantt.urgent, ...(h.gantt.from !== undefined ? { from: h.gantt.from } : {}) } } : {}),
    };
  }

  /** Перестали смотреть работу: строка «Сейчас» больше не нужна, пока не открыта панель или карточка. */
  private stopWatching() {
    if (!this.watching) return;
    this.watching = undefined;
    this.store.set({ watch: undefined });
    this.sendViews();
  }

  /** Расписание закрыто: черновик и окно времени остаются. */
  private ganttClosed(): Partial<Hud> {
    const g = this.store.get().gantt;
    return { gantt: { open: false, days: g.days, draft: g.draft, urgent: g.urgent, ...(g.from !== undefined ? { from: g.from } : {}) } };
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
    if (h.morning.open && h.morning.day !== undefined) list.push({ id: 'morning', view: 'morning', day: h.morning.day, ...(h.session ? { since: h.session.from } : {}) });
    if (h.cash.open) list.push({ id: 'cash', view: 'cash', page: h.cash.page });
    if (h.lab.open) list.push(h.lab.tab === 'queue' ? { id: 'lab', view: 'lab' } : { id: 'chart', view: 'chart', test: 'test.ipc.mass' });
    // черновик: новые сроки заданий и новые срочные задания (0.0.39) — их полосы расписание показывает до «Утвердить»
    const draft = {
      ...(h.gantt.draft.length > 0 ? { draft: [...h.gantt.draft] } : {}),
      ...(h.gantt.urgent.length > 0 ? { fresh: h.gantt.urgent.map(u => ({ recipe: u.recipe, sku: u.sku })) } : {}),
    };
    if (h.gantt.open) list.push({ id: 'gantt', view: 'gantt', ...this.ganttWindow(h.gantt.from, h.gantt.days), ...draft });
    if (h.gantt.open && h.gantt.drag) list.push({ id: 'ghost', view: 'ghost', ...h.gantt.drag, ...draft });
    if (h.inv.open) list.push({ id: 'inv', view: 'inv', ...(h.inv.id ? { inv: h.inv.id } : {}) });
    if (h.journal.open) list.push({ id: 'journal', view: 'journal', page: h.journal.page, ...(h.journal.seat ? { seat: h.journal.seat } : {}), ...(h.journal.who ? { who: h.journal.who } : {}), ...(h.journal.focus !== undefined ? { focus: h.journal.focus } : {}) });
    if (h.dossier.open && h.dossier.batch !== undefined) list.push({ id: 'dossier', view: 'dossier', batch: h.dossier.batch });
    if (h.ref.open) list.push({ id: 'ref', view: 'ref' });
    if (h.po.open) list.push({ id: 'po', view: 'po', ...(h.po.supplier ? { supplier: h.po.supplier } : {}), lines: h.po.lines.map(l => ({ material: l.material, qty: l.qty })) });
    if (h.kpi.open) list.push({ id: 'kpi', view: 'kpi', tab: h.kpi.tab, ...(h.kpi.why ? { why: h.kpi.why } : {}), ...(h.kpi.month !== undefined ? { month: h.kpi.month } : {}) });
    // «Сейчас» — и при закрытой панели: карточке — для «Смотреть», смотрящему — чтобы знать, когда работа кончилась
    if (h.now.open || this.selected || this.watching) list.push({ id: 'now', view: 'now' });
    // «Пол» (Б1и) — пока включён слой «Загрузка» или «Узкие места» (Б1к) и пока открыта карточка помещения или машины: в
    // ней блоки «Загрузка» и «Узкие места»; «Андон» (Б1к) — пока включён слой «Проблемы»
    if (h.layer === 'load' || h.layer === 'bottle' || this.selected?.kind === 'room' || this.selected?.kind === 'machine') list.push({ id: 'floor', view: 'floor', win: h.floor.win });
    if (h.layer === 'andon') list.push({ id: 'andon', view: 'andon' });
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
    // метки слоя данных — столбики, таблички, значки андона — первыми: щёлкают по ним, а не по человеку под ними
    const mark = nearest(this.stage.ray(clientX, clientY), this.markBoxes());
    if (mark) return mark.thing;
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

  /**
   * Короба меток слоя данных: столбики «Загрузки» (Б1и), таблички «Узких мест» и значки андона (Б1к) — с высоты участка
   * таблички и значки крупнее, короба тоже; слой не данных — пусто.
   */
  private markBoxes(): Box[] {
    const l = this.store.get().layer;
    const k = 1 + Math.min(1, Math.max(0, this.stage.site));
    if (l === 'load') return barBoxes(this.stage.floor.spots);
    if (l === 'bottle') return plateBoxes(this.stage.plates.plates, k);
    if (l === 'andon') return andonBoxes(this.stage.andon.marks, k);
    return [];
  }

  /** Метка слоя под курсором — для подсказки: часы частей столбика, ожидание у места, проблемы вещи; мимо — `undefined`. */
  private barAt(clientX: number, clientY: number): Thing | undefined {
    const boxes = this.markBoxes();
    return boxes.length > 0 ? nearest(this.stage.ray(clientX, clientY), boxes)?.thing : undefined;
  }

  /**
   * Где вещь значка андона (Б1к) и высота её верха, м: помещение — точка у его середины, пол; оборудование и машина — середина
   * следа и высота вида; фура, паллета, техника — где они в этом кадре. Вещи на полу нет — `undefined`.
   */
  private thingTop = (t: Thing): [number, number, number] | undefined => {
    const mid = (b: Box | undefined): [number, number, number] | undefined => (b ? [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2] : undefined);
    switch (t.kind) {
      case 'room': {
        const at = midSpot(this.layout, t.i);
        return at ? [at.x, 0, at.z] : undefined;
      }
      case 'equipment':
      case 'machine':
        return mid(this.machineBoxes.find(x => same(x.thing, t)));
      case 'truck':
        return mid(truckBoxes(this.trucksNow).find(x => same(x.thing, t)));
      case 'unit':
        return mid(palletBoxes([...this.pallets, ...this.carriedNow]).find(x => same(x.thing, t)));
      case 'vehicle': {
        const v = this.moversNow.vehicles.find(x => x.vehicle === t.n);
        return v ? [v.x, 2.2, v.z] : undefined;
      }
      default:
        return undefined;
    }
  };

  /** Наведение на столбик: подсказка — у курсора, где он был, когда навели; ушли со столбика — подсказки нет. */
  private hover(clientX: number, clientY: number) {
    const f = this.store.get().floor;
    const t = this.barAt(clientX, clientY);
    if (same(t, f.hover?.thing) || (!t && !f.hover)) return;
    this.store.set({ floor: { ...f, hover: t ? { thing: t, x: clientX, y: clientY } : undefined } });
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
      case 'dev':
      case 'order':
        // отклонения и заказа покупателя на полу нет
        return undefined;
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
      this.hover(e.clientX, e.clientY);
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
      if (this.store.get().floor.hover) this.store.set({ floor: { ...this.store.get().floor, hover: undefined } });
    });
    el.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('blur', () => {
      this.mouse.inside = false;
      this.mouse.keys.clear();
    });
    window.addEventListener('keydown', e => {
      const k = e.code;
      // экран «Кем вы будете» — поверх всего: клавиши мира молчат, Esc закрывает его, если место уже выбрано
      if (this.store.get().seats.open) {
        if (k === 'Escape') this.actions.closeSeats();
        return;
      }
      // в поле ввода — поиск справочника — клавиши пишут текст, а не командуют миром; Esc закрывает окно, как всегда
      if (k !== 'Escape' && (e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
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
      else if (k === 'Digit6') this.actions.untilEvent();
      else if (k === 'KeyQ') this.stage.cam.rotate(-1);
      else if (k === 'KeyE') this.stage.cam.rotate(1);
      else if (k === 'Backquote') this.actions.toggleDebug();
      else if (k === 'KeyG') this.actions.toggleGantt();
      else if (k === 'KeyI') this.actions.toggleInv();
      else if (k === 'KeyN') this.actions.toggleNow();
      else if (k === 'KeyJ') this.actions.toggleJournal();
      else if (k === 'KeyK') this.actions.toggleKpi();
      else if (k === 'KeyL') this.actions.nextLayer();
      else if (k === 'F1') {
        e.preventDefault();
        this.actions.toggleRef();
      } else if (k === 'F2') {
        e.preventDefault();
        this.actions.toggleStock();
      } else if (k === 'Escape') {
        // Esc: сначала то, что тянут в расписании, потом досье серии (оно поверх всего) и окно «Заказ поставщику» (поверх
        // склада, Б5б), меню автопауз, выбор, верхнее окно — расписание (оно поверх планёрки), планёрка, затем панель справа
        const h = this.store.get();
        if (h.gantt.drag) this.actions.cancelDrag();
        else if (h.dossier.open) this.actions.closeDossier();
        else if (h.po.open) this.actions.togglePo();
        else if (h.pauses.open) this.actions.togglePauses();
        else if (this.selected) this.actions.select(undefined);
        else if (h.gantt.open) this.actions.toggleGantt();
        else if (h.inv.open) this.actions.toggleInv();
        else if (h.ref.open) this.actions.toggleRef();
        else if (h.kpi.open) this.actions.toggleKpi();
        else if (h.morning.open) this.actions.closeMorning(false);
        else if (h.cash.open) this.actions.toggleCash();
        else if (h.lab.open) this.actions.toggleLab();
        else if (h.now.open) this.actions.toggleNow();
        else if (h.journal.open) this.actions.toggleJournal();
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
