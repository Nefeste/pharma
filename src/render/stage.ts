// Сцена завода (docs/02-architecture.md, §10; docs/specs/2026-10-view.md, 2а–2б): отрисовщик, свет, камера и постобработка —
// копии «Больницы» (view.ts, post.ts, gpu.ts); стены со срезом, двери, светильники и полы — её копии под план завода
// (world.ts, doors.ts, lamps.ts, textures.ts); люди — её толпа на видеокарте (bake.ts, people.ts); двор, разметка склада,
// стеллажи, грузы, фуры, техника, таблички и короба оборудования — свои. Всё стоит по плану движка (`planOf`), паллеты,
// фуры, люди и техника — из среза.
import * as THREE from 'three';
import type { Movers } from '../app/movers';
import type { ContentDb } from '../content/types';
import type { RoomRow, TruckRow } from '../sim/pack';
import type { People } from './bake';
import { buildBoxes } from './boxes';
import { dressOf, lookOf, skinOf } from './cast';
import { buildDoors, type Doors } from './doors';
import { GpuTimer } from './gpu';
import { buildLamps, type Lamps } from './lamps';
import type { Layout } from './layout';
import { buildRacks, Loads, type PalletView } from './loads';
import { type Body, IDLE, PeopleView, WALK } from './people';
import { Post } from './post';
import { Signs } from './signs';
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

export interface StageInit {
  host: HTMLElement;
  layout: Layout;
  db: ContentDb;
  quality: Quality;
  /** сколько паллет помещается в сцену */
  capacity: number;
}

export class Stage {
  readonly scene = new THREE.Scene();
  readonly cam: IsoCamera;
  readonly light: Daylight;
  renderer: THREE.WebGLRenderer;
  readonly loads: Loads;
  readonly walls: Walls;
  readonly doors: Doors;
  readonly lamps: Lamps;
  readonly trucks = new Trucks();
  readonly fleet: Fleet;
  /** паллеты, которые везут: на вилах и только что поставленные */
  readonly carried = new Loads(16);
  readonly signs: Signs;
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
    this.scene.add(buildBoxes(layout, init.db));
    this.loads = new Loads(init.capacity);
    this.scene.add(this.loads.group);
    this.scene.add(this.trucks.group);
    this.fleet = new Fleet(Object.keys(init.db.vehicles));
    this.scene.add(this.fleet.group);
    this.scene.add(this.carried.group);
    this.signs = new Signs(layout, init.db);
    this.scene.add(this.signs.group);
    this.applyQuality(init.quality);
    this.walls.setMode(this.wallMode);
  }

  setPallets(list: readonly PalletView[]) {
    this.loads.set(list);
  }

  /** Фуры из среза: у рампы — кузовом к воротам (ворота подняты), ждущие — во дворе. */
  setTrucks(rows: readonly TruckRow[], front: (dock: number) => { x: number; z: number }) {
    this.trucks.set(rows, front);
    this.docked = new Set(rows.filter(r => r.docked).map(r => r.dock));
  }

  setRooms(rows: readonly RoomRow[]) {
    this.signs.set(rows);
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
   * `clock` — секунды жизни окна для шага анимации: шаг идёт с обычной скоростью и на ×4.
   */
  setMovers(mv: Movers, carried: readonly PalletView[], clock: number) {
    const roles = Object.keys(this.init.db.roles);
    const types = Object.keys(this.init.db.vehicles);
    this.fleet.set(mv.vehicles);
    this.vehiclesShown = mv.vehicles.length;
    this.carried.set(carried);
    const shown: Shown[] = [];
    const near: { x: number; z: number }[] = [];
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
    }
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
    this.people?.update(this.shown, b => this.paintOf(b), cam.target, 1000, cam.half < FULL_NEAR);
    this.signs.update(u, cam.half);
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
