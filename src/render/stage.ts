// Сцена завода (docs/02-architecture.md, §10): отрисовщик, свет, камера и постобработка — копии «Больницы» (view.ts,
// post.ts, gpu.ts); пол участка, стеллажи и грузы — свои. В части 0 склад — показательный (demo.ts): так проверяется
// путь «экземпляры по виду груза» до того, как срез движка начнёт двигать настоящие паллеты (часть 2).
import * as THREE from 'three';
import { GpuTimer } from './gpu';
import { buildRacks, Loads, type PalletView, type RackRow } from './loads';
import { Post } from './post';
import { createRenderer, Daylight, gpuString, IsoCamera, PRESETS, type Quality } from './view';

export interface StageInit {
  host: HTMLElement;
  /** участок в клетках 1 × 1 м */
  w: number;
  h: number;
  quality: Quality;
  racks: RackRow[];
  /** разметка проездов на полу: прямоугольники [x, z, ширина, глубина], м */
  lanes: [number, number, number, number][];
  /** сколько паллет помещается в сцену */
  capacity: number;
}

export class Stage {
  readonly scene = new THREE.Scene();
  readonly cam: IsoCamera;
  readonly light: Daylight;
  renderer: THREE.WebGLRenderer;
  readonly loads: Loads;
  private post: Post | null = null;
  quality: Quality;
  gpu: GpuTimer;
  gpuName: string;
  /** вызовов отрисовки и треугольников в последнем кадре */
  calls = 0;
  tris = 0;
  private hourShown = -1;
  private host: HTMLElement;

  constructor(init: StageInit) {
    this.host = init.host;
    this.quality = init.quality;
    this.cam = new IsoCamera(init.w, init.h);
    this.cam.overview();
    this.light = new Daylight(this.scene, init.w, init.h);
    this.renderer = createRenderer(init.host, init.quality);
    this.gpu = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.gpuName = gpuString(this.renderer);
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(buildFloor(init.w, init.h, init.lanes, aniso));
    this.scene.add(buildRacks(init.racks));
    this.loads = new Loads(init.capacity);
    this.scene.add(this.loads.group);
    this.applyQuality(init.quality);
  }

  setPallets(list: readonly PalletView[]) {
    this.loads.set(list);
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

  /** Кадр: камера, свет по часам завода — и отрисовка. */
  frame(dt: number, hour: number) {
    this.cam.update(dt);
    if (Math.abs(hour - this.hourShown) > 0.02) {
      this.hourShown = hour;
      this.light.setHour(hour);
    }
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

/** Наливной пол склада: серый, с жёлтой разметкой проездов и сеткой клеток через метр (видна вблизи). */
function buildFloor(w: number, h: number, lanes: [number, number, number, number][], anisotropy: number): THREE.Mesh {
  const px = 16;
  const c = document.createElement('canvas');
  c.width = w * px;
  c.height = h * px;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8d9396';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 1;
  for (let x = 0; x <= w; x++) {
    g.beginPath();
    g.moveTo(x * px + 0.5, 0);
    g.lineTo(x * px + 0.5, c.height);
    g.stroke();
  }
  for (let z = 0; z <= h; z++) {
    g.beginPath();
    g.moveTo(0, z * px + 0.5);
    g.lineTo(c.width, z * px + 0.5);
    g.stroke();
  }
  // разметка проездов — жёлтые полосы по краям, как на складе
  g.strokeStyle = '#e7b416';
  g.lineWidth = Math.max(2, px * 0.1);
  for (const [x, z, lw, ld] of lanes) g.strokeRect(x * px, z * px, lw * px, ld * px);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
  mesh.position.set(w / 2, 0, h / 2);
  mesh.receiveShadow = true;
  return mesh;
}
