// Значки работ над головами (этап Б, Б1б; docs/specs/2026-10-vertical-slice.md): что делает человек — на крупных планах,
// цех и машина; на плане участка людей нет, нет и значков (крупность показа, detail.ts). Значки — те же, что в «Сейчас» и
// в карточке (taskicons.ts), из одной текстуры-ленты; все — один вызов отрисовки: экземпляры квадрата, повёрнутые к камере
// в шейдере. Размер — постоянный на экране, сколько бы ни было до камеры.
import * as THREE from 'three';
import { ICON_FILL, ICON_KINDS, ICON_LINE, ICON_PATH, type IconKind } from './taskicons';

/** Значок на экране, точек; в текстуре — крупнее и с полем, чтобы соседи не просачивались. */
const SHOW_PX = 22;
const CELL = 48;
const ICON = 36;
/** Над полом, м: над головой стоящего (рост фигур — до 1,8 м). */
export const BADGE_Y = 2.05;

/** Лента значков: по клетке на вид, кружок и путь — как у SVG-значков панелей. */
function strip(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = CELL * ICON_KINDS.length;
  c.height = CELL;
  const ctx = c.getContext('2d')!;
  const k = ICON / 14;
  for (const [i, kind] of ICON_KINDS.entries()) {
    ctx.save();
    ctx.translate(i * CELL + (CELL - ICON) / 2, (CELL - ICON) / 2);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.arc(7, 7, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = ICON_FILL;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ICON_LINE;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(ICON_PATH[kind]));
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

const VERTEX = /* glsl */ `
attribute float aIcon;
uniform float uSize;
uniform float uCount;
varying vec2 vUv;
void main() {
  vUv = vec2((uv.x + aIcon) / uCount, uv.y);
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.04) discard;
  gl_FragColor = vec4(c.rgb, c.a * uOpacity);
  #include <colorspace_fragment>
}`;

export interface Badge {
  x: number;
  y: number;
  z: number;
  icon: IconKind;
}

export class Badges {
  readonly mesh: THREE.InstancedMesh;
  private readonly icon: THREE.InstancedBufferAttribute;
  private readonly uniforms = {
    uMap: { value: null as THREE.Texture | null },
    uSize: { value: 0.5 },
    uCount: { value: ICON_KINDS.length },
    uOpacity: { value: 1 },
  };
  private readonly m = new THREE.Matrix4();

  constructor(private readonly max: number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.icon = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    geo.setAttribute('aIcon', this.icon);
    this.uniforms.uMap.value = strip();
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    // точки двигаются каждый кадр, рамку экземпляров никто не пересчитывает — отсекать по ней нельзя
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  /** Значки кадра; `k` — насколько видны люди (detail.ts); размер — `SHOW_PX` точек при половине высоты кадра `half`, м. */
  set(list: readonly Badge[], k: number, half: number, hPx: number) {
    const n = k > 0.01 ? Math.min(list.length, this.max) : 0;
    for (let i = 0; i < n; i++) {
      const b = list[i];
      this.m.makeTranslation(b.x, b.y + BADGE_Y, b.z);
      this.mesh.setMatrixAt(i, this.m);
      this.icon.setX(i, ICON_KINDS.indexOf(b.icon));
    }
    this.mesh.count = n;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.icon.needsUpdate = true;
    }
    this.uniforms.uSize.value = (SHOW_PX * 2 * half) / Math.max(1, hPx);
    this.uniforms.uOpacity.value = Math.min(1, k);
  }
}
