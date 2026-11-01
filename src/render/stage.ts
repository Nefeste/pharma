// Сцена завода (docs/02-architecture.md, §10; docs/specs/2026-10-view.md, 2а–2б): отрисовщик, свет, камера и постобработка —
// копии «Больницы» (view.ts, post.ts, gpu.ts); стены со срезом, двери, светильники и полы — её копии под план завода
// (world.ts, doors.ts, lamps.ts, textures.ts); люди — её толпа на видеокарте (bake.ts, people.ts); двор, разметка склада,
// стеллажи, грузы, фуры, техника, таблички и короба оборудования — свои. Всё стоит по плану движка (`planOf`), паллеты,
// фуры, люди и техника — из среза.
import * as THREE from 'three';
import type { Movers } from '../app/movers';
import type { Ray } from '../app/pick';
import type { ContentDb } from '../content/types';
import { roomsOf } from '../engine/lean';
import { T } from '../i18n';
import type { FloorView } from '../sim/floor';
import type { TruckPose } from '../app/yard';
import type { EquipmentRow, LineRow, RoomRow } from '../sim/pack';
import type { Arrow, Fill } from '../app/flows';
import { type Badge, Badges } from './badges';
import type { People } from './bake';
import { dressOf, lookOf, skinOf } from './cast';
import { AT, shownOf, type Weights } from './detail';
import { buildDoors, type Doors } from './doors';
import { AndonLayer } from './andon';
import { FloorLayer } from './floor';
import { PlateLayer } from './plates';
import { GpuTimer } from './gpu';
import { buildLamps, type Lamps } from './lamps';
import type { Layout } from './layout';
import { buildRacks, Loads, type PalletView } from './loads';
import { Machines } from './machines';
import { Overlay } from './overlay';
import { type Body, IDLE, PeopleView, WALK } from './people';
import { Post } from './post';
import { type Outline, Selection } from './select';
import { Signs } from './signs';
import type { IconKind } from './taskicons';
import type { FloorKind, FloorTex } from './textures';
import { Trucks } from './trucks';
import { Fleet } from './vehicles';
import { createRenderer, Daylight, gpuString, IsoCamera, PRESETS, type Quality } from './view';
import { buildFloors, buildGround, buildMarkings, buildWalls, type WallMode, type Walls } from './world';

/** Сколько людей рисуется самое большее (на вид). */
const MAX_PEOPLE = 64;
/** Ближе этого (половина высоты кадра, м) люди — полной моделью, дальше — упрощённой. */
const FULL_NEAR = 14;

/** Человек на экране с тем, по чему его красить. */
interface Shown extends Body {
  role: string;
  person: number;
}

/** Модели из Blender (#109, src/app/art.ts): машина — сцена .glb по виду записи (узлы — части). Нет — кодом, как прежде. */
export interface Art {
  machines: Map<string, THREE.Object3D>;
}

export interface StageInit {
  host: HTMLElement;
  layout: Layout;
  db: ContentDb;
  quality: Quality;
  /** сколько паллет помещается в сцену */
  capacity: number;
  art?: Art;
}

export class Stage {
  readonly scene = new THREE.Scene();
  readonly cam: IsoCamera;
  readonly light: Daylight;
  renderer: THREE.WebGLRenderer;
  loads: Loads;
  readonly walls: Walls;
  readonly doors: Doors;
  readonly lamps: Lamps;
  readonly trucks = new Trucks();
  readonly fleet: Fleet;
  machines: Machines;
  /** слой участка: стрелки и загрузка мест (2г) */
  readonly overlay: Overlay;
  /** слой «Загрузка и OEE» (Б1и): столбики, числа, доски «План — факт» */
  readonly floor: FloorLayer;
  /** слой «Узкие места» (Б1к): таблички над тремя местами и над машиной, которая держит линию */
  readonly plates = new PlateLayer();
  /** слой «Проблемы» (Б1к): значки андона над вещами, которые не работают */
  readonly andon = new AndonLayer();
  /** что видно при нынешней крупности показа (detail.ts) */
  private shownD = shownOf(AT[1]);
  private lineRows: readonly LineRow[] = [];
  private eqRows: readonly EquipmentRow[] = [];
  private gameRate = 0;
  /** паллеты, которые везут: на вилах и только что поставленные */
  readonly carried = new Loads(16);
  readonly signs: Signs;
  /** значки работ над головами (Б1б) */
  readonly badges = new Badges(MAX_PEOPLE);
  private badgeList: Badge[] = [];
  private people?: PeopleView;
  private looks: string[] = [];
  private shown: Shown[] = [];
  /** где сейчас люди и техника — двери открываются перед ними */
  private near: { x: number; z: number }[] = [];
  private paint = new Map<string, { clothes: THREE.Color; skin: THREE.Color }>();
  private floors: THREE.Mesh[];
  private floorTex = new Map<FloorKind, FloorTex>();
  private post: Post | null = null;
  quality: Quality;
  wallMode: WallMode = 'cut';
  gpu: GpuTimer;
  gpuName: string;
  /** вызовов отрисовки и треугольников в последнем кадре */
  calls = 0;
  tris = 0;
  /** рампы, у которых стоит фура: их ворота подняты */
  private docked = new Set<number>();
  /** рамка выбранной вещи (3б) */
  readonly selection = new Selection();
  private hourShown = -1;
  private host: HTMLElement;

  constructor(readonly init: StageInit) {
    const { layout, host } = init;
    this.host = host;
    this.quality = init.quality;
    this.cam = new IsoCamera(layout.w, layout.h);
    this.cam.overview();
    this.light = new Daylight(this.scene, layout.w, layout.h);
    this.renderer = createRenderer(host, init.quality);
    this.gpu = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.gpuName = gpuString(this.renderer);
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    for (const m of buildGround(layout, aniso)) this.scene.add(m);
    this.lamps = buildLamps(layout);
    this.floors = buildFloors(layout, aniso, this.lamps.lightMap, this.floorTex);
    for (const m of this.floors) this.scene.add(m);
    this.scene.add(buildMarkings(layout, aniso));
    this.walls = buildWalls(layout);
    this.scene.add(this.walls.mesh);
    this.doors = buildDoors(layout);
    this.scene.add(this.doors.mesh);
    this.scene.add(this.lamps.mesh);
    this.scene.add(buildRacks(layout.plan.plant.racks.map(r => ({ x: r.x / 100, z: r.z / 100, bays: r.bays, levels: r.levels }))));
    this.machines = new Machines(layout, init.db, init.art?.machines);
    this.scene.add(this.machines.group);
    this.overlay = new Overlay(layout);
    this.overlay.setShown(0);
    this.scene.add(this.overlay.group);
    this.floor = new FloorLayer(init.db, layout, roomsOf(layout.plan).rooms, n => T.morning.line(n + 1));
    this.scene.add(this.floor.group);
    this.scene.add(this.plates.mesh);
    this.scene.add(this.andon.group);
    this.loads = new Loads(init.capacity);
    this.scene.add(this.loads.group);
    this.scene.add(this.trucks.group);
    this.fleet = new Fleet(Object.keys(init.db.vehicles));
    this.scene.add(this.fleet.group);
    this.scene.add(this.carried.group);
    this.signs = new Signs(layout, init.db);
    this.scene.add(this.signs.group);
    this.scene.add(this.selection.line);
    this.scene.add(this.badges.mesh);
    this.applyQuality(init.quality);
    this.walls.setMode(this.wallMode);
  }

  /** Модели из Blender или кодом (панель отладки, «Модели»): машины — заново. */
  setArt(art: Art | undefined) {
    this.scene.remove(this.machines.group);
    this.machines.dispose();
    this.machines = new Machines(this.init.layout, this.init.db, art?.machines);
    this.scene.add(this.machines.group);
  }

  setPallets(list: readonly PalletView[]) {
    this.loads.set(list);
  }

  /** Рамка выбранной вещи: где она в этом кадре — решает окно (3б). */
  setSelection(o: Outline | undefined) {
    this.selection.set(o);
  }

  /** Луч камеры через точку экрана — как `pickCell` «Больницы» (её src/render/stage.ts). */
  ray(clientX: number, clientY: number): Ray {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.cam.camera);
    const { origin: o, direction: d } = rc.ray;
    return { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] };
  }

  /** Точка мира на экране, точки окна; за камерой или вне кадра — `undefined` (как `screenOf` «Больницы»). */
  screen(x: number, y: number, z: number): { x: number; y: number } | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(x, y, z).project(this.cam.camera);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return undefined;
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** Фуры в кадре: у рампы — кузовом к воротам (ворота подняты, пока фура стоит у рампы по учёту), во дворе — где едут. */
  setTrucks(poses: readonly TruckPose[]) {
    this.trucks.set(poses);
    this.docked = new Set(poses.filter(r => r.docked).map(r => r.dock));
  }

  setRooms(rows: readonly RoomRow[]) {
    this.signs.set(rows);
  }

  /** Линии и оборудование из среза и игровых секунд в секунду — для ламп, роторов и лент (2в). */
  setMachines(lines: readonly LineRow[], equipment: readonly EquipmentRow[], gameRate: number) {
    this.lineRows = lines;
    this.eqRows = equipment;
    this.gameRate = gameRate;
  }

  /**
   * Крупность показа кадра — веса уровней (detail.ts): люди и техника уходят в пол, штуки — в полосу, слой проступает. Со
   * слоем данных (Б1и) стрелки не проступают, а люди и техника остаются.
   */
  setDetail(w: Weights) {
    this.siteW = w[2];
    this.shownD = this.dataOn ? { ...shownOf(w), movers: 1, layer: 0 } : shownOf(w);
    this.overlay.setShown(this.layerOn ? 1 : this.shownD.layer);
  }

  /** Слой участка виден всегда — слой «Потоки — люди» (Б1г) включён; снят — по уровню показа. */
  private layerOn = false;
  forceLayer(on: boolean) {
    this.layerOn = on;
    this.overlay.setShown(on ? 1 : this.shownD.layer);
  }

  /**
   * Слой данных (Б1и, Б1к): «Загрузка и OEE», «Узкие места» или «Проблемы» — какой виден, или ни один; вес уровня участка
   * — числа, таблички и значки с высоты участка крупнее.
   */
  private dataOn = false;
  private siteW = 0;
  setDataLayer(layer: 'load' | 'bottle' | 'andon' | undefined) {
    this.dataOn = layer !== undefined;
    this.floor.setShown(layer === 'load');
    this.plates.setShown(layer === 'bottle');
    this.andon.setShown(layer === 'andon');
    // светильники под потолком сверху закрывают числа, доску, таблички и значки: в слое данных их нет, свет на полу — есть
    this.lamps.mesh.visible = !this.dataOn;
  }

  /** Вес уровня участка сейчас: числа, таблички и значки с высоты участка крупнее — и их короба для щелчка. */
  get site(): number {
    return this.siteW;
  }

  /** Вид «Пол» из потока расчёта: столбики, числа и доски — заново. */
  setFloor(v: FloorView | undefined) {
    this.floor.set(v);
  }

  /** Стрелки перевозок и линии, загрузка мест склада — слой участка (2г). */
  setOverlay(arrows: readonly Arrow[], fills: readonly Fill[]) {
    this.overlay.setArrows(arrows);
    this.overlay.setFills(fills);
  }

  /** Сколько людей и техники нарисовано в последнем кадре — для сценария в браузере и бенча. */
  get peopleShown() {
    return (this.people?.nearCount ?? 0) + (this.people?.farCount ?? 0);
  }
  vehiclesShown = 0;

  /** Запечённые виды людей (`names` — их имена по порядку): с ними на полу появляются люди. */
  setPeople(p: People, names: string[]) {
    this.people = new PeopleView(p, MAX_PEOPLE);
    this.looks = names;
    this.scene.add(this.people.group);
  }

  /**
   * Люди и техника кадра (`src/app/movers.ts`) и паллеты на вилах. Водитель ричтрака стоит в нём, рохлю толкают сзади;
   * `clock` — секунды жизни окна для шага анимации: шаг идёт с обычной скоростью и на ×4. `icons` — значок работы человека
   * (Б1б): он висит над тем местом, где человек нарисован, и над водителем — тоже.
   */
  setMovers(mv: Movers, carried: readonly PalletView[], clock: number, icons?: ReadonlyMap<number, IconKind>) {
    const roles = Object.keys(this.init.db.roles);
    const types = Object.keys(this.init.db.vehicles);
    const k = this.shownD.movers;
    this.fleet.set(mv.vehicles, k);
    this.vehiclesShown = k > 0.01 ? mv.vehicles.length : 0;
    // груз на вилах уходит вместе с техникой
    this.carried.set(k > 0.5 ? carried : []);
    const shown: Shown[] = [];
    const near: { x: number; z: number }[] = [];
    const badges: Badge[] = [];
    for (const f of mv.people) {
      let { x, z, heading } = f;
      let y = 0;
      let clip = f.doing === 'walk' ? WALK : IDLE;
      if (f.doing === 'ride') {
        const v = mv.vehicles.find(m => m.vehicle === f.vehicle);
        if (v) {
          ({ x, z } = this.fleet.driverAt(v.type, v));
          heading = v.heading;
          const walks = types[v.type] === 'veh.jack';
          clip = walks && v.moving ? WALK : IDLE;
          y = walks ? 0 : 0.12;
        }
      }
      const role = roles[f.role];
      shown.push({ x, y, z, heading, look: lookOf(this.looks, role, f.person), clip, clipTime: clock + (f.person % 7) * 0.31, loop: true, lie: 0, role, person: f.person });
      near.push({ x, z });
      const icon = icons?.get(f.person);
      if (icon) badges.push({ x, y, z, icon });
    }
    this.badgeList = badges;
    for (const v of mv.vehicles) near.push({ x: v.x, z: v.z });
    this.shown = shown;
    this.near = near;
  }

  setWalls(m: WallMode) {
    this.wallMode = m;
    this.walls.setMode(m);
  }

  applyQuality(q: Quality) {
    this.quality = q;
    const p = PRESETS[q];
    this.renderer.setPixelRatio(Math.max(0.5, (window.devicePixelRatio || 1) * p.scale));
    this.light.setShadowSize(p.shadowSize);
    this.light.setEnv(this.renderer, p.env);
    this.post?.dispose();
    this.post = p.ao > 0 || p.msaa > 0 ? new Post(this.renderer, this.scene, this.cam.camera, p.ao || 8, p.msaa) : null;
    if (this.post && p.ao === 0) this.post.intensity = 0;
    this.resize();
  }

  /** Мест для паллет сцены — не меньше `n`: бенч ставит паллеты сверх учёта (docs/specs/2026-10-view.md, 2г). */
  reserve(n: number) {
    if (n <= this.loads.capacity) return;
    this.scene.remove(this.loads.group);
    this.loads = new Loads(n);
    this.scene.add(this.loads.group);
  }

  /** Сколько людей нарисовано полной и упрощённой моделью в последнем кадре — для бенча. */
  get peopleCounts() {
    return { near: this.people?.nearCount ?? 0, far: this.people?.farCount ?? 0 };
  }

  /** Снимок кадра `w` × `h` в час `hour` — PNG строкой данных (как у «Больницы»: бенч и снимки). */
  shot(w: number, h: number, hour: number): string {
    const pr = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.post?.setSize();
    this.frame(0, hour);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setPixelRatio(pr);
    this.resize();
    return url;
  }

  resize(w = this.host.clientWidth, h = this.host.clientHeight) {
    this.renderer.setSize(w, h, true);
    this.cam.aspect = w / Math.max(1, h);
    this.post?.setSize();
  }

  /** Кадр: камера, срез стен, двери и ворота рамп, светильники, таблички, свет по часам завода — и отрисовка. */
  frame(dt: number, hour: number) {
    const cam = this.cam;
    cam.update(dt);
    const u = this.walls.uniforms;
    u.uFocus.value.set(cam.target.x, cam.target.z);
    u.uRadius.value = Math.max(6, cam.half * 0.55);
    cam.toCam(u.uToCam.value);
    if (Math.abs(hour - this.hourShown) > 0.02) {
      this.hourShown = hour;
      this.light.setHour(hour);
      this.lamps.setHour(hour, this.floors.map(m => m.material as THREE.MeshStandardMaterial));
    }
    this.lamps.update(u, cam.half);
    // двери — перед людьми и техникой, ворота рамп — по фурам
    const near = this.near;
    this.doors.update(dt, (x, z, r) => near.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < r * r), this.docked, u);
    if (this.people) {
      this.people.scale = this.shownD.movers;
      this.people.update(this.shown, b => this.paintOf(b), cam.target, 1000, cam.half < FULL_NEAR);
    }
    // значки работ — пока видны люди: цех и машина; на плане участка их нет вместе с людьми
    this.badges.set(this.people ? this.badgeList : [], this.shownD.movers, cam.half, this.renderer.domElement.clientHeight);
    this.machines.update(dt, this.gameRate, this.lineRows, this.eqRows, this.shownD);
    this.signs.update(u, cam.half);
    this.floor.update(cam.camera, this.siteW);
    this.plates.update(this.siteW);
    this.andon.update(this.siteW);
    this.draw();
  }

  /** Одежда — по роли, тон кожи — по номеру человека (cast.ts). */
  private paintOf(b: Shown) {
    const key = `${b.role}/${b.person}`;
    let p = this.paint.get(key);
    if (!p) {
      p = { clothes: new THREE.Color(dressOf(b.role).color), skin: new THREE.Color(skinOf(b.person)) };
      this.paint.set(key, p);
    }
    return p;
  }

  private draw() {
    const r = this.renderer;
    const camera = this.cam.camera;
    // счёт вызовов и треугольников — за весь кадр (тени, сцена, затенение, сведение), а не за последний проход
    r.info.autoReset = false;
    r.info.reset();
    this.gpu.begin();
    if (this.post) {
      this.post.setCamera(camera);
      this.post.render(camera);
    } else {
      r.setRenderTarget(null);
      r.render(this.scene, camera);
    }
    this.gpu.end();
    this.calls = r.info.render.calls;
    this.tris = r.info.render.triangles;
  }
}
