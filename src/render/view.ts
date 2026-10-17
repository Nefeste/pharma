// из bolnitsa: src/render/view.ts @ e0a3491
// Отрисовщик, свет и камера. Пресеты качества меняют тени, сглаживание, затенение и разрешение кадра; сглаживание
// задаётся при создании контекста WebGL, поэтому смена пресета пересоздаёт WebGLRenderer — геометрия и текстуры
// загружаются в видеокарту заново сами.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: Quality[] = ['low', 'medium', 'high'];

export interface Preset {
  /** доля разрешения экрана (с учётом devicePixelRatio) */
  scale: number;
  /** MSAA: выборок на точку; 0 — без сглаживания */
  msaa: number;
  shadowSize: number;
  peopleShadows: boolean;
  /** окружение для отражений PBR (RoomEnvironment) */
  env: boolean;
  /** мягкое затенение (GTAO): выборок; 0 — нет */
  ao: number;
  /** полные модели людей — только если камера ближе этого (половина высоты кадра, м); 0 — всегда упрощённые */
  fullHalf: number;
}

export const PRESETS: Record<Quality, Preset> = {
  low: { scale: 0.75, msaa: 0, shadowSize: 1024, peopleShadows: false, env: false, ao: 0, fullHalf: 0 },
  medium: { scale: 1, msaa: 4, shadowSize: 2048, peopleShadows: true, env: true, ao: 8, fullHalf: 9 },
  high: { scale: 1, msaa: 4, shadowSize: 4096, peopleShadows: true, env: true, ao: 16, fullHalf: 16 },
};

export function createRenderer(host: HTMLElement, q: Quality, preserve = false): THREE.WebGLRenderer {
  const p = PRESETS[q];
  // сглаживание — в своём буфере кадра (post.ts), у холста его нет: затенение работает с глубиной этого буфера
  const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: preserve });
  r.setPixelRatio(Math.max(0.5, (window.devicePixelRatio || 1) * p.scale));
  r.setSize(host.clientWidth, host.clientHeight);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 0.82;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.domElement.style.display = 'block';
  host.appendChild(r.domElement);
  return r;
}

export function gpuString(r: THREE.WebGLRenderer): string {
  const gl = r.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return `WebGL2: ${name}`;
}

// ---------------------------------------------------------------- свет и время суток

export class Daylight {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xdfe9f2, 0x8a7f70, 1.2);
  private envTex: THREE.Texture | null = null;
  private envOwner: THREE.WebGLRenderer | null = null;
  hour = 12;

  constructor(
    private scene: THREE.Scene,
    private w: number,
    private h: number,
  ) {
    const s = this.sun;
    s.castShadow = true;
    const cam = s.shadow.camera;
    // одна карта теней на весь участок (каскады не нужны: камера не уходит к горизонту)
    const r = Math.max(w, h) * 0.75 + 4;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = 220;
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.03;
    s.target.position.set(w / 2, 0, h / 2);
    scene.add(s, s.target, this.hemi);
  }

  /**
   * Окружение для отражений. Его текстура — результат отрисовки в конкретном контексте WebGL: после пересоздания
   * отрисовщика (смена пресета) её надо сделать заново, иначе отражения берутся из пустой текстуры и сцена темнеет.
   */
  setEnv(r: THREE.WebGLRenderer, on: boolean) {
    if (this.envOwner !== r && this.envTex) {
      this.envTex.dispose();
      this.envTex = null;
    }
    this.envOwner = r;
    if (on && !this.envTex) {
      const pm = new THREE.PMREMGenerator(r);
      this.envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
    if (!on && this.envTex) {
      this.envTex.dispose();
      this.envTex = null;
    }
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.3;
  }

  setShadowSize(n: number) {
    const s = this.sun.shadow;
    if (s.mapSize.x !== n) {
      s.mapSize.set(n, n);
      s.map?.dispose();
      s.map = null;
    }
  }

  /** Час 0–24: солнце с востока (+x) на запад, цвет и сила — по высоте; ночью — синий фон и внутренний свет. */
  setHour(hour: number) {
    this.hour = hour;
    const t = (hour - 6) / 14; // 0 — 6:00, 1 — 20:00
    const az = Math.PI * (0.15 + 0.7 * Math.min(1, Math.max(0, t)));
    const el = Math.max(0.05, Math.sin(Math.PI * Math.min(1, Math.max(0, t)))) * 1.05;
    const dist = 110;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), -Math.sin(az) * Math.cos(el) * 0.6 - 0.35).normalize();
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir, dist);
    const low = 1 - Math.min(1, el / 0.6);
    // сумерки — с 18:30 до 20:00 (зима; дневная смена кончается в 20:00): к вечеру видно свет светильников
    const night = hour >= 18.5 ? Math.min(1, (hour - 18.5) / 1.5) : hour < 6.5 ? 1 - Math.max(0, hour - 6) / 0.5 : 0;
    const warm = new THREE.Color(0xfff4e6).lerp(new THREE.Color(0xff8a3c), low);
    this.sun.color.copy(warm);
    this.sun.intensity = (1.6 + 2.2 * (1 - low)) * (1 - night * 0.9);
    // вечером и ночью внутри горит свет: фон теплеет и слабеет немного (свет на полу — от светильников, lamps.ts), иначе
    // помещения проваливаются в темноту
    this.hemi.color.set(0xdfe9f2).lerp(new THREE.Color(0xffd6a8), low * 0.45).lerp(new THREE.Color(0xb8b0a0), night * 0.6);
    this.hemi.intensity = 0.75 - low * 0.12 - night * 0.12;
    this.hemi.groundColor.set(0x8a7f70).lerp(new THREE.Color(0x5c4a3a), night);
    // фон — тёмный: за участком ничего нет (замечание владельца: не плоская зелень до горизонта)
    this.scene.background = new THREE.Color(0x2a3236).lerp(new THREE.Color(0x3a3430), low * 0.5).lerp(new THREE.Color(0x141a24), night);
  }
}

// ---------------------------------------------------------------- камера

export type Projection = 'ortho' | 'persp';

/** Камера сверху под углом: точка взгляда на земле, поворот на 45° + k·90°, наклон 52°. */
export class IsoCamera {
  readonly target: THREE.Vector3;
  /** половина высоты видимой области, м */
  half = 22;
  yaw = Math.PI / 4;
  private yawTo = Math.PI / 4;
  pitch = THREE.MathUtils.degToRad(52);
  // выбор пробы: перспектива с узким углом (spikes/render-3d/README.md, «Орто или перспектива»)
  projection: Projection = 'persp';
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  readonly persp = new THREE.PerspectiveCamera(20, 1, 1, 700);
  aspect = 16 / 9;

  constructor(
    private w: number,
    private h: number,
  ) {
    this.target = new THREE.Vector3(w / 2, 0, h / 2);
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.projection === 'ortho' ? this.ortho : this.persp;
  }

  rotate(steps: number) {
    this.yawTo += (steps * Math.PI) / 2;
  }

  setYawNow(y: number) {
    this.yaw = this.yawTo = y;
  }

  /** Вектор по земле от точки взгляда к камере. */
  toCam(out = new THREE.Vector2()): THREE.Vector2 {
    return out.set(Math.sin(this.yaw), Math.cos(this.yaw));
  }

  /** Сдвиг точки взгляда на dx, dy точек экрана (высота экрана — hPx). */
  pan(dxPx: number, dyPx: number, hPx: number) {
    const k = (2 * this.half) / hPx;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.target.addScaledVector(right, -dxPx * k);
    this.target.addScaledVector(fwd, (dyPx * k) / Math.sin(this.pitch));
    this.target.x = THREE.MathUtils.clamp(this.target.x, -5, this.w + 5);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -5, this.h + 5);
  }

  zoom(k: number) {
    this.half = THREE.MathUtils.clamp(this.half * k, 3, Math.max(this.w, this.h) * 0.75);
  }

  overview() {
    this.target.set(this.w / 2, 0, this.h / 2);
    this.half = Math.max(this.h * 0.7, this.w * 0.4);
  }

  update(dt: number) {
    const d = this.yawTo - this.yaw;
    this.yaw += Math.abs(d) < 1e-3 ? d : d * Math.min(1, dt * 10);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const a = this.aspect;
    const o = this.ortho;
    o.left = -this.half * a;
    o.right = this.half * a;
    o.top = this.half;
    o.bottom = -this.half;
    o.position.copy(this.target).addScaledVector(dir, 200);
    o.lookAt(this.target);
    o.updateProjectionMatrix();
    // перспектива с узким углом: расстояние, при котором видна та же высота
    const p = this.persp;
    p.aspect = a;
    const dist = this.half / Math.tan(THREE.MathUtils.degToRad(p.fov / 2));
    p.near = Math.max(1, dist - 90);
    p.far = dist + 160;
    p.position.copy(this.target).addScaledVector(dir, dist);
    p.lookAt(this.target);
    p.updateProjectionMatrix();
    p.updateMatrixWorld();
    o.updateMatrixWorld();
  }
}
