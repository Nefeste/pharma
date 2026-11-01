// Слой «Проблемы» — андон (Б1к; docs/specs/2026-10-vertical-slice.md, «Б1к»; docs/13-art.md, §11): над каждой вещью,
// которая не работает сейчас, — круг цвета веса с пиктограммой вида и слово под ним. Значки — экземпляры одного квадрата
// из атласа по клетке на вид, слова — из второго атласа: два вызова отрисовки на весь слой, повёрнуты к камере в шейдере,
// как значки работ (badges.ts). Поверх стен и машин: сигнал, который заслонил стеллаж, — не сигнал. Слова атласа
// перерисовываются, только когда сменился язык. Где значки стоят — src/app/floor.ts (`andonMarks`).
import * as THREE from 'three';
import { type AndonMark, FLOOR } from '../app/floor';
import { T } from '../i18n';
import { ANDON, type AndonKind, WEIGHT } from '../sim/andon';
import { ANDON_COLOR, ANDON_PATH, andonInk } from './andonicons';

/** Клетка значка, точек: круг радиусом `R` из 7 — сторона значка `FLOOR.andon.size` на полу, остальное — поле. */
const ICON_PX = 128;
const R = 6.6;
/** Сторона клетки значка на полу, м. */
const ICON_QUAD = (FLOOR.andon.size * 7) / R;
/**
 * Клетка слова, точек; кегль — `PX`, высота букв — доля `DIGIT` кегля: она и есть `FLOOR.andon.word` м на полу. Слово,
 * которое не влезает в клетку, — мельче.
 */
const WORD_H = 64;
const WORD_W = 640;
const PX = 42;
const DIGIT = 0.72;
/** Высота клетки слова на полу, м. */
const WORD_QUAD = (FLOOR.andon.word * WORD_H) / (PX * DIGIT);
/** Зазор между значком и словом, доли стороны значка. */
const GAP = 0.06;
/** Значков сразу — не больше. */
const MAX = 64;

const VERTEX = /* glsl */ `
attribute float aCell;
uniform vec2 uSize;
uniform float uCount;
uniform float uDrop;
varying vec2 vUv;
void main() {
  vUv = vec2((uv.x + aCell) / uCount, uv.y);
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  mv.y -= uDrop;
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

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Слово вида — то же, что в подсказке и в меню слоёв. */
export const andonWord = (k: AndonKind) => T.andon.word[k];

function canvasTex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

/** Лента значков: по клетке на вид — круг цвета веса и пиктограмма чернилами, контрастными с ним. */
function iconStrip(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = ICON_PX * ANDON.length;
  c.height = ICON_PX;
  const g = c.getContext('2d')!;
  const k = ICON_PX / 14;
  for (const [i, kind] of ANDON.entries()) {
    const w = WEIGHT[kind];
    g.save();
    g.translate(i * ICON_PX, 0);
    g.scale(k, k);
    g.beginPath();
    g.arc(7, 7, R, 0, Math.PI * 2);
    g.fillStyle = hex(ANDON_COLOR[w]);
    g.fill();
    g.lineWidth = 0.5;
    g.strokeStyle = 'rgba(16, 24, 27, 0.85)';
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeStyle = hex(andonInk(w));
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke(new Path2D(ANDON_PATH[kind]));
    g.restore();
  }
  return canvasTex(c);
}

interface Strip {
  mesh: THREE.InstancedMesh;
  cell: THREE.InstancedBufferAttribute;
  uniforms: { uMap: { value: THREE.Texture | null }; uSize: { value: THREE.Vector2 }; uCount: { value: number }; uDrop: { value: number } };
}

function strip(tex: THREE.Texture, name: string, order: number): Strip {
  const geo = new THREE.PlaneGeometry(1, 1);
  const cell = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
  geo.setAttribute('aCell', cell);
  const uniforms = { uMap: { value: tex as THREE.Texture | null }, uSize: { value: new THREE.Vector2(1, 1) }, uCount: { value: ANDON.length }, uDrop: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, depthTest: false });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.name = name;
  return { mesh, cell, uniforms };
}

export class AndonLayer {
  readonly group = new THREE.Group();
  private icons: Strip;
  private words: Strip;
  private wordCtx: CanvasRenderingContext2D;
  private wordTex: THREE.CanvasTexture;
  private wordKey = '';
  private shown: AndonMark[] = [];
  private m = new THREE.Matrix4();

  constructor() {
    this.icons = strip(iconStrip(), 'andon icons', 15);
    const c = document.createElement('canvas');
    c.width = WORD_W * ANDON.length;
    c.height = WORD_H;
    this.wordCtx = c.getContext('2d')!;
    this.wordTex = canvasTex(c);
    this.words = strip(this.wordTex, 'andon words', 14);
    this.group.add(this.icons.mesh, this.words.mesh);
    this.group.visible = false;
    this.drawWords();
  }

  /** Значки кадра: вещи на полу двигаются — фура, паллета, техника, — поэтому каждый кадр, пока слой включён. */
  set(list: readonly AndonMark[]) {
    if (!this.group.visible) return;
    this.drawWords();
    const n = Math.min(list.length, MAX);
    this.shown = list.slice(0, n);
    for (let i = 0; i < n; i++) {
      const mk = list[i];
      this.m.makeTranslation(mk.x, mk.y, mk.z);
      const cell = ANDON.indexOf(mk.kind);
      for (const s of [this.icons, this.words]) {
        s.mesh.setMatrixAt(i, this.m);
        s.cell.setX(i, cell);
      }
    }
    for (const s of [this.icons, this.words]) {
      s.mesh.count = n;
      s.mesh.instanceMatrix.needsUpdate = true;
      s.cell.needsUpdate = true;
    }
  }

  /** Значки, которые сейчас на полу, — для наведения и сценария в браузере. */
  get marks(): readonly AndonMark[] {
    return this.group.visible ? this.shown : [];
  }

  setShown(on: boolean) {
    this.group.visible = on;
    if (!on) this.shown = [];
  }

  /**
   * Каждый кадр: значок — `FLOOR.andon.size`, слово — буквами `FLOOR.andon.word` под ним; с высоты участка — вдвое
   * крупнее.
   */
  update(site: number) {
    if (!this.group.visible) return;
    const k = 1 + Math.min(1, Math.max(0, site));
    const a = FLOOR.andon;
    this.icons.uniforms.uSize.value.set(ICON_QUAD * k, ICON_QUAD * k);
    this.words.uniforms.uSize.value.set(((WORD_QUAD * WORD_W) / WORD_H) * k, WORD_QUAD * k);
    this.words.uniforms.uDrop.value = (a.size / 2 + a.size * GAP + WORD_QUAD / 2) * k;
  }

  /** Слова атласа — на языке интерфейса: язык сменился — заново. */
  private drawWords() {
    const words = ANDON.map(k => andonWord(k));
    const key = words.join('|');
    if (key === this.wordKey) return;
    this.wordKey = key;
    const g = this.wordCtx;
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [i, text] of words.entries()) {
      const x = i * WORD_W + WORD_W / 2;
      let px = PX;
      g.font = `700 ${px}px system-ui, sans-serif`;
      let w = g.measureText(text).width;
      if (w > WORD_W - 36) {
        px = Math.floor((px * (WORD_W - 36)) / w);
        g.font = `700 ${px}px system-ui, sans-serif`;
        w = g.measureText(text).width;
      }
      const bw = w + 28;
      g.fillStyle = 'rgba(28, 34, 37, 0.92)';
      g.beginPath();
      g.roundRect(x - bw / 2, 6, bw, WORD_H - 12, 14);
      g.fill();
      g.fillStyle = '#ffffff';
      g.fillText(text, x, WORD_H / 2 + 1);
    }
    this.wordTex.needsUpdate = true;
  }
}
