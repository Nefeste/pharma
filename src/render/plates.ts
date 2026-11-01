// Слой «Узкие места» (Б1к; docs/specs/2026-10-vertical-slice.md, «Б1к»; docs/13-art.md, §11): таблички над тремя местами,
// где серии дольше всего ждали за окно, — место по порядку, часы и слово, — и «держит линию» над машиной, которая задаёт
// ход линии. Все таблички — экземпляры одного квадрата из одной текстуры, повёрнутые к камере в шейдере, как числа
// «Загрузки» (floor.ts): один вызов отрисовки. Клетка перерисовывается, только когда её строка сменилась. Поверх
// стен и машин — табличка, которую заслонил стеллаж, ничего не говорит. Где они стоят и что на них — src/app/floor.ts.
import * as THREE from 'three';
import { FLOOR, type Plate, type PlateShown } from '../app/floor';
import { durText, hText, T } from '../i18n';

/**
 * Клетка таблички в текстуре, точек; кегль строки — `PX` точек, высота её букв — доля `DIGIT` кегля: она и есть
 * `FLOOR.plate.h` м на полу, как цифры «Загрузки» (floor.ts). Строка, которая не влезает в клетку, — мельче.
 */
const CELL_H = 96;
const CELL_W = 1536;
const PX = 60;
const DIGIT = 0.72;
/** Высота клетки на полу, м, без увеличения с высоты участка. */
const QUAD_H = (FLOOR.plate.h * CELL_H) / (PX * DIGIT);
/** Табличек сразу — не больше: три места и по одной на линию. */
const MAX = 12;
/** Фон таблички: тёмный, как у доски «План — факт»; у «держит линию» — рамка цвета ожидания соседей (лампа машины). */
const BG = 'rgba(28, 34, 37, 0.92)';
const EDGE_TOP = '#e8edf0';
const EDGE_HOLDS = '#7f9be0';

const VERTEX = /* glsl */ `
attribute float aCell;
uniform vec2 uSize;
uniform float uCount;
varying vec2 vUv;
void main() {
  vUv = vec2(uv.x, (uv.y + (uCount - 1.0 - aCell)) / uCount);
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.04) discard;
  gl_FragColor = c;
  #include <colorspace_fragment>
}`;

/** Часы на табличке: с часа — целыми часами, меньше — минутами: на полу важен порядок, а не десятые. */
const hours = (sec: number) => (sec >= 3600 ? hText(Math.round(sec / 3600) * 3600) : durText(sec));

/** Строка таблички словами: «1 · 254 ч · ждали лабораторию»; «держит линию · наладка 20 ч». */
export function plateText(p: Plate): string {
  if (p.k === 'top') return T.bottle.plate(p.rank, hours(p.sec), T.bottle.what[p.what]);
  return p.what && p.sec !== undefined ? T.bottle.holds(T.bottle.loss[p.what], hours(p.sec)) : T.bottle.holdsBare;
}

export class PlateLayer {
  readonly mesh: THREE.InstancedMesh;
  private cell: THREE.InstancedBufferAttribute;
  private atlas: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private uniforms: { uMap: { value: THREE.Texture | null }; uSize: { value: THREE.Vector2 }; uCount: { value: number } };
  private keys: string[] = Array(MAX).fill('');
  /** ширина фона таблички в клетке, точек: короб для щелчка — по ней */
  private widths: number[] = Array(MAX).fill(0);
  private shown: Plate[] = [];
  private m = new THREE.Matrix4();

  constructor() {
    const c = document.createElement('canvas');
    c.width = CELL_W;
    c.height = CELL_H * MAX;
    this.atlas = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.generateMipmaps = false;
    this.tex.minFilter = THREE.LinearFilter;
    this.uniforms = { uMap: { value: this.tex }, uSize: { value: new THREE.Vector2((QUAD_H * CELL_W) / CELL_H, QUAD_H) }, uCount: { value: MAX } };
    const geo = new THREE.PlaneGeometry(1, 1);
    this.cell = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    geo.setAttribute('aCell', this.cell);
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, depthTest: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    this.mesh.name = 'bottleneck plates';
    this.mesh.visible = false;
  }

  /** Таблички вида; клетка — по порядку в списке, перерисовывается, только если её строка сменилась. */
  set(list: readonly Plate[]) {
    const n = Math.min(list.length, MAX);
    this.shown = list.slice(0, n);
    let drawn = false;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      const text = plateText(p);
      const key = `${p.k}|${text}`;
      if (this.keys[i] !== key) {
        this.keys[i] = key;
        this.draw(i, text, p.k === 'holds');
        drawn = true;
      }
      this.m.makeTranslation(p.x, FLOOR.plate.y, p.z);
      this.mesh.setMatrixAt(i, this.m);
      this.cell.setX(i, i);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.cell.needsUpdate = true;
    if (drawn) this.tex.needsUpdate = true;
  }

  /** Таблички, которые сейчас на полу, с шириной фона и высотой клетки, м, — для наведения и сценария в браузере. */
  get plates(): readonly PlateShown[] {
    return this.mesh.visible ? this.shown.map((p, i) => ({ ...p, w: (this.widths[i] * QUAD_H) / CELL_H, h: QUAD_H })) : [];
  }

  setShown(on: boolean) {
    this.mesh.visible = on;
  }

  /**
   * Каждый кадр: буквы — высотой `FLOOR.plate.h`, с высоты участка (`site` — вес этого уровня, detail.ts) — вдвое крупнее;
   * нижний край — на `FLOOR.plate.y`.
   */
  update(site: number) {
    if (!this.mesh.visible) return;
    const h = QUAD_H * (1 + Math.min(1, Math.max(0, site)));
    this.uniforms.uSize.value.set((h * CELL_W) / CELL_H, h);
    this.mesh.position.y = h / 2;
  }

  private draw(i: number, text: string, holds: boolean) {
    const g = this.atlas;
    const y = i * CELL_H;
    g.clearRect(0, y, CELL_W, CELL_H);
    const pad = 22;
    let px = PX;
    g.font = `700 ${px}px system-ui, sans-serif`;
    let w = g.measureText(text).width;
    if (w > CELL_W - 2 * pad - 8) {
      px = Math.floor((px * (CELL_W - 2 * pad - 8)) / w);
      g.font = `700 ${px}px system-ui, sans-serif`;
      w = g.measureText(text).width;
    }
    const bw = Math.min(CELL_W - 4, w + 2 * pad);
    this.widths[i] = bw;
    const x0 = (CELL_W - bw) / 2;
    g.fillStyle = BG;
    g.strokeStyle = holds ? EDGE_HOLDS : EDGE_TOP;
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(x0 + 3, y + 6, bw - 6, CELL_H - 12, 18);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, CELL_W / 2, y + CELL_H / 2 + 2);
  }
}
