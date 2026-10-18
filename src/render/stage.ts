// Сцена завода (docs/02-architecture.md, §10; docs/specs/2026-10-view.md, 2а): отрисовщик, свет, камера и постобработка —
// копии «Больницы» (view.ts, post.ts, gpu.ts); стены со срезом, двери, светильники и полы — её копии под план завода
// (world.ts, doors.ts, lamps.ts, textures.ts); двор, разметка склада, стеллажи, грузы, фуры, таблички и короба
// оборудования — свои. Всё стоит по плану движка (`planOf`), паллеты и фуры — из среза.
import * as THREE from 'three';
import type { ContentDb } from '../content/types';
import type { RoomRow, TruckRow } from '../sim/pack';
import { buildBoxes } from './boxes';
import { buildDoors, type Doors } from './doors';
import { GpuTimer } from './gpu';
import { buildLamps, type Lamps } from './lamps';
import type { Layout } from './layout';
import { buildRacks, Loads, type PalletView } from './loads';
import { Post } from './post';
import { Signs } from './signs';
import type { FloorKind, FloorTex } from './textures';
import { Trucks } from './trucks';
import { createRenderer, Daylight, gpuString, IsoCamera, PRESETS, type Quality } from './view';
import { buildFloors, buildGround, buildMarkings, buildWalls, type WallMode, type Walls } from './world';

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
  readonly signs: Signs;
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
    // в 2а людей и техники на экране ещё нет: распашные двери закрыты, ворота рамп — по фурам
    this.doors.update(dt, () => false, this.docked, u);
    this.signs.update(u, cam.half);
    this.draw();
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
