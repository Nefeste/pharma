// Столбики на полу (Б1и, Б1л; docs/13-art.md, §11): части — экземпляры одного короба, рамка полной высоты — одна сетка
// линий (у тех слоёв, где полная высота что-то значит), числа над столбиками — экземпляры квадрата из одной текстуры,
// повёрнутые к камере в шейдере (как значки работ, badges.ts). Тени не отбрасывают; неосвещённые — цвет части тот же
// днём и ночью, какой проверен в четырёх видах зрения. Клетка числа перерисовывается, только когда его строки
// сменились. Общие для слоёв «Загрузка и OEE» (floor.ts) и «Потери» (losses.ts): три вызова отрисовки, без рамки — два.
import * as THREE from 'three';

/**
 * Клетка числа в текстуре, точек; кегль числа — `BIG` точек, высота его цифр — доля `DIGIT` кегля: она и есть `digits`
 * м на полу. Строка, которая не влезает в клетку, — мельче.
 */
const CELL_W = 400;
const CELL_H = 140;
const BIG = 64;
const SMALL = 34;
const DIGIT = 0.72;
/** Рамка полной высоты — светлая, полупрозрачная: видно, сколько окна не занято. */
const FRAME = 0xe8edf0;
/**
 * Клеток в ряду текстуры: мест бывает под сорок (Б1л), а столбец из сорока клеток — 5 600 точек в высоту, больше, чем
 * берут иные видеокарты; сеткой по четыре — 1 600 × 1 400.
 */
const GRID = 4;

const VERTEX = /* glsl */ `
attribute float aCell;
uniform vec2 uSize;
uniform vec2 uGrid;
varying vec2 vUv;
void main() {
  float col = mod(aCell, uGrid.x);
  float row = floor(aCell / uGrid.x + 0.001);
  vUv = vec2((uv.x + col) / uGrid.x, (uv.y + (uGrid.y - 1.0 - row)) / uGrid.y);
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

export const canvasTex = (c: HTMLCanvasElement) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
};

/** Где столбик: середина основания и сторона, м. */
export interface ColumnSpot {
  x: number;
  z: number;
  side: number;
}

/** Столбик к показу: номер места (клетка числа), части снизу вверх цветом, низ числа над полом, м, и его две строки. */
export interface Column extends ColumnSpot {
  n: number;
  parts: { color: number; y0: number; h: number }[];
  label: number;
  lines: [string, string];
}

export class Columns {
  readonly group = new THREE.Group();
  private parts: THREE.InstancedMesh;
  private labels: THREE.InstancedMesh;
  private cell: THREE.InstancedBufferAttribute;
  private atlas: CanvasRenderingContext2D;
  private atlasTex: THREE.CanvasTexture;
  private uniforms: { uMap: { value: THREE.Texture | null }; uSize: { value: THREE.Vector2 }; uGrid: { value: THREE.Vector2 } };
  private cols: number;
  private keys: string[];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  /**
   * `n` мест, у столбика — не больше `parts` частей; `frames` — места рамок полной высоты `full` (нет — без рамки);
   * `name` — начало имён сеток; `digits` — высота цифр числа на полу, м.
   */
  constructor(
    n: number,
    parts: number,
    name: string,
    private digits: number,
    frames?: { spots: readonly ColumnSpot[]; full: number },
  ) {
    this.parts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), Math.max(1, n * parts));
    // цвет экземпляров — с первого кадра: программа шейдера сразу с ним
    this.parts.setColorAt(0, this.c.setHex(0xffffff));
    this.parts.count = 0;
    this.parts.frustumCulled = false;
    this.parts.name = `${name} bars`;
    this.group.add(this.parts);
    if (frames) {
      // рамка полной высоты: двенадцать рёбер короба у каждого столбика
      const pos: number[] = [];
      for (const b of frames.spots) {
        const h = b.side / 2 + 0.01;
        const xs = [b.x - h, b.x + h];
        const zs = [b.z - h, b.z + h];
        const ys = [0, frames.full];
        for (const y of ys) for (const x of xs) pos.push(x, y, zs[0], x, y, zs[1]);
        for (const y of ys) for (const z of zs) pos.push(xs[0], y, z, xs[1], y, z);
        for (const x of xs) for (const z of zs) pos.push(x, 0, z, x, frames.full, z);
      }
      const frame = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)), new THREE.LineBasicMaterial({ color: FRAME, transparent: true, opacity: 0.55, toneMapped: false }));
      frame.name = `${name} frames`;
      this.group.add(frame);
    }
    // числа: клетка на место, по порядку мест — рядами по `GRID`
    this.cols = Math.min(GRID, Math.max(1, n));
    const rows = Math.ceil(Math.max(1, n) / this.cols);
    const c = document.createElement('canvas');
    c.width = CELL_W * this.cols;
    c.height = CELL_H * rows;
    this.atlas = c.getContext('2d')!;
    this.atlasTex = canvasTex(c);
    this.uniforms = { uMap: { value: this.atlasTex }, uSize: { value: new THREE.Vector2(1, 1) }, uGrid: { value: new THREE.Vector2(this.cols, rows) } };
    const geo = new THREE.PlaneGeometry(1, 1);
    this.cell = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n)), 1);
    geo.setAttribute('aCell', this.cell);
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false });
    this.labels = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    this.labels.count = 0;
    this.labels.frustumCulled = false;
    this.labels.renderOrder = 12;
    this.labels.name = `${name} labels`;
    this.group.add(this.labels);
    this.keys = Array(n).fill('');
  }

  /** Столбики и числа над ними — заново. */
  set(cols: readonly Column[]) {
    let k = 0;
    for (const b of cols) {
      for (const part of b.parts) {
        if (k >= this.parts.instanceMatrix.count) break;
        this.m.compose(this.p.set(b.x, part.y0, b.z), this.q, this.s.set(b.side, Math.max(0.005, part.h), b.side));
        this.parts.setMatrixAt(k, this.m);
        this.parts.setColorAt(k, this.c.setHex(part.color));
        k++;
      }
    }
    this.parts.count = k;
    this.parts.instanceMatrix.needsUpdate = true;
    if (this.parts.instanceColor) this.parts.instanceColor.needsUpdate = true;
    // числа: перерисовать клетку, только если её строки сменились
    let drawn = false;
    cols.forEach((b, i) => {
      const key = b.lines.join('|');
      if (this.keys[b.n] !== key) {
        this.keys[b.n] = key;
        this.drawLabel(b.n, b.lines);
        drawn = true;
      }
      this.m.makeTranslation(b.x, b.label, b.z);
      this.labels.setMatrixAt(i, this.m);
      this.cell.setX(i, b.n);
    });
    this.labels.count = cols.length;
    this.labels.instanceMatrix.needsUpdate = true;
    this.cell.needsUpdate = true;
    if (drawn) this.atlasTex.needsUpdate = true;
  }

  /**
   * Каждый кадр: числа — цифрами высотой `digits`, с высоты участка (`site` — вес этого уровня показа, detail.ts) —
   * вдвое крупнее.
   */
  update(site: number) {
    const h = ((this.digits * CELL_H) / (BIG * DIGIT)) * (1 + Math.min(1, Math.max(0, site)));
    this.uniforms.uSize.value.set((h * CELL_W) / CELL_H, h);
    this.labels.position.y = h / 2;
  }

  private drawLabel(i: number, [big, small]: [string, string]) {
    const g = this.atlas;
    const x = (i % this.cols) * CELL_W;
    const y = Math.floor(i / this.cols) * CELL_H;
    g.clearRect(x, y, CELL_W, CELL_H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(20, 26, 30, 0.9)';
    const line = (text: string, px: number, weight: number, at: number, color: string, stroke: number) => {
      g.font = `${weight} ${px}px system-ui, sans-serif`;
      const w = g.measureText(text).width;
      const fit = w > CELL_W - 2 * stroke ? Math.floor((px * (CELL_W - 2 * stroke)) / w) : px;
      g.font = `${weight} ${fit}px system-ui, sans-serif`;
      g.lineWidth = stroke;
      g.strokeText(text, x + CELL_W / 2, y + CELL_H * at);
      g.fillStyle = color;
      g.fillText(text, x + CELL_W / 2, y + CELL_H * at);
    };
    line(big, BIG, 700, 0.34, '#ffffff', 10);
    line(small, SMALL, 600, 0.8, '#e4ecef', 7);
  }
}
