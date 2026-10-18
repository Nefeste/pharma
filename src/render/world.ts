// из bolnitsa: src/render/world.ts @ e0a3491 — изменено: сетка плана завода (nav.ts) вместо плана больницы; полы по типу
// и классу помещения; зоны склада — «покрашенный» пол одной текстурой поверх; высота стен — по помещению (склад выше);
// окна — только вне чистых зон, у склада — высокие; проёмы ворот, рамп и ленты; двор с запада ниже пола здания — к уровню
// кузова фуры. Без карты света светильников у участка и без дорожек больницы.
//
// Мир: x — столбец клетки, z — строка, y — вверх; клетка — 1 м. Стены режет вершинный шейдер: переключение режима и
// движение камеры ничего не перестраивают; тени считаются по срезанным стенам тем же шейдером (docs/13-art.md, §4).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ZoneKind } from '../content/types';
import { CELL } from '../engine/nav';
import { isOutside, type Layout, outward, STORE, TALL, wallHeight } from './layout';
import { type FloorKind, type FloorTex, makeFloor } from './textures';

/** Срезанная стена, м. */
export const WALL_LOW = 0.32;
export const WALL_T = 0.16;
/** Высота проёма двери, ворот и рампы, м; проём ленты — от и до, м. */
export const DOOR_H = 2.1;
export const GATE_H = 3.0;
export const DOCK_H = 3.4;
export const HATCH = { low: 0.7, high: 1.25 } as const;
/** Двор у рамп — ниже пола здания: пол кузова фуры на уровне пола склада (docs/10-domain.md, §5, `ot-814n`). */
export const YARD_Y = -1.2;

/** Пол по помещению: склад — наливной серый, чистые зоны — светлый полимерный, лаборатория — плитка, офис — линолеум. */
function floorOf(type: string, grade: 'D' | 'cnc'): FloorKind {
  if (STORE.has(type) && grade !== 'D') return 'concrete';
  if (type === 'workshop') return 'concrete';
  if (grade === 'D') return 'epoxy';
  if (type === 'lab') return 'lab';
  if (type === 'corridor') return 'corridor';
  return 'linoleum';
}

/** Материал пола каждой клетки: пол и коридор — по помещению, дверь — по одной из сторон; стены и улица — null. */
function floorKinds(l: Layout): (FloorKind | null)[] {
  const { w, h, nav } = l;
  const k: (FloorKind | null)[] = new Array(w * h).fill(null);
  for (let i = 0; i < w * h; i++) {
    const c = nav.cells[i];
    if ((c === CELL.floor || c === CELL.corridor) && nav.room[i] >= 0) k[i] = floorOf(l.rooms[nav.room[i]].type, l.rooms[nav.room[i]].grade);
  }
  for (const d of l.doors) {
    const side = d.rooms.find(r => r >= 0);
    if (side === undefined) continue;
    for (const [x, z] of d.cells) k[z * w + x] = floorOf(l.rooms[side].type, l.rooms[side].grade);
  }
  return k;
}

/** Пол — квадраты по 0,5 м; половинки стеновых клеток берут пол соседа (как в «Больнице»). */
export function buildFloors(l: Layout, anisotropy: number, lightMap: THREE.Texture | null, textures = new Map<FloorKind, FloorTex>()): THREE.Mesh[] {
  const { w, h, nav } = l;
  const kind = floorKinds(l);
  const isWall = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || nav.cells[y * w + x] === CELL.wall;
  const quads = new Map<FloorKind, number[]>();
  const add = (k: FloorKind, x: number, z: number, s: number) => {
    let a = quads.get(k);
    if (!a) quads.set(k, (a = []));
    a.push(x, z, s);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const own = kind[y * w + x];
      if (own) {
        add(own, x, y, 1);
        continue;
      }
      if (!isWall(x, y)) continue;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const nx = sx ? x + 1 : x - 1;
          const ny = sy ? y + 1 : y - 1;
          const k = (!isWall(nx, y) && kind[y * w + nx]) || (!isWall(x, ny) && kind[ny * w + x]) || (!isWall(nx, ny) && kind[ny * w + nx]) || null;
          // наружная половинка наружной стены — не пол, а улица
          if (!k) continue;
          add(k, x + sx * 0.5, y + sy * 0.5, 0.5);
        }
      }
    }
  }
  const meshes: THREE.Mesh[] = [];
  for (const [k, q] of quads) {
    let tex = textures.get(k);
    if (!tex) textures.set(k, (tex = makeFloor(k, anisotropy)));
    const n = q.length / 3;
    const pos = new Float32Array(n * 18);
    const uv = new Float32Array(n * 12);
    const uv1 = new Float32Array(n * 12);
    const nor = new Float32Array(n * 18);
    for (let i = 0; i < n; i++) {
      const x = q[i * 3];
      const z = q[i * 3 + 1];
      const s = q[i * 3 + 2];
      const v = [x, z, x, z + s, x + s, z + s, x, z, x + s, z + s, x + s, z];
      for (let j = 0; j < 6; j++) {
        pos[i * 18 + j * 3] = v[j * 2];
        pos[i * 18 + j * 3 + 2] = v[j * 2 + 1];
        nor[i * 18 + j * 3 + 1] = 1;
        uv[i * 12 + j * 2] = v[j * 2] / tex.meters;
        uv[i * 12 + j * 2 + 1] = v[j * 2 + 1] / tex.meters;
        uv1[i * 12 + j * 2] = v[j * 2] / w;
        uv1[i * 12 + j * 2 + 1] = 1 - v[j * 2 + 1] / h;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    const mat = new THREE.MeshStandardMaterial({ map: tex.texture, roughness: k === 'epoxy' ? 0.35 : 0.6, metalness: 0 });
    if (lightMap) {
      mat.lightMap = lightMap;
      mat.lightMapIntensity = 0;
    }
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.name = `floor ${k}`;
    meshes.push(m);
  }
  return meshes;
}

/**
 * Оттенки зон склада (docs/13-art.md, §5): «покрашенный» пол — нейтральные цвета, которые не спорят с ярлыками статусов
 * (жёлтый, зелёный, красный, серый).
 */
export const ZONE_TINT: Record<ZoneKind, string> = {
  receiving: '#8fa3b8',
  quarantine: '#c8b98e',
  cold: '#9cc1d6',
  rejected: '#b39a9a',
  fgQuarantine: '#ab9fbf',
  shipping: '#93ad9a',
  staging: '#8fb3ae',
  sampling: '#b9b3a6',
  palletizing: '#a0a8b8',
};

/**
 * Разметка пола склада одной текстурой поверх пола: зоны — заливка и рамка, места на полу — обводка, у фронта стеллажей —
 * жёлтая линия безопасности (13-art, §5: жёлтая разметка). Один вызов отрисовки.
 */
export function buildMarkings(l: Layout, anisotropy: number): THREE.Mesh {
  const { w, h, plan } = l;
  const px = 32;
  const c = document.createElement('canvas');
  c.width = w * px;
  c.height = h * px;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  for (const zn of plan.plant.zones) {
    const [x, z, zw, zd] = zn.rect.map(v => (v / 100) * px);
    g.fillStyle = ZONE_TINT[zn.kind];
    g.globalAlpha = 0.42;
    g.fillRect(x, z, zw, zd);
    g.globalAlpha = 0.9;
    g.strokeStyle = ZONE_TINT[zn.kind];
    g.lineWidth = px * 0.1;
    g.strokeRect(x + g.lineWidth / 2, z + g.lineWidth / 2, zw - g.lineWidth, zd - g.lineWidth);
  }
  // места на полу: прямоугольник паллеты 1,2 × 0,8 м с запасом, белой линией
  g.globalAlpha = 0.85;
  g.strokeStyle = '#f2f2ee';
  g.lineWidth = px * 0.05;
  for (const sl of plan.slots) {
    if (sl.kind === 'storage') continue;
    const cx = (sl.x / 100) * px;
    const cz = (sl.z / 100) * px;
    g.strokeRect(cx - 0.7 * px, cz - 0.5 * px, 1.4 * px, 1.0 * px);
  }
  // жёлтая линия вдоль фронта стеллажей — со стороны прохода
  g.strokeStyle = '#e1b21c';
  g.lineWidth = px * 0.08;
  for (const r of plan.plant.racks) {
    const x0 = (r.x / 100) * px;
    const x1 = ((r.x + r.bays * 270) / 100) * px;
    const zf = r.face === 'n' ? (r.z / 100 - 0.25) * px : ((r.z + 110) / 100 + 0.25) * px;
    g.beginPath();
    g.moveTo(x0, zf);
    g.lineTo(x1, zf);
    g.stroke();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  const geo = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(w / 2, 0.003, h / 2);
  m.receiveShadow = true;
  m.name = 'markings';
  return m;
}

/**
 * Участок вокруг здания: с запада — двор рамп ниже пола здания (асфальт, подпорная стенка рампы), с других сторон —
 * газон и плитка у стен; дальше — тёмная земля (замечание владельца «Больнице»: не плоская зелень до горизонта).
 */
export function buildGround(l: Layout, anisotropy: number): THREE.Mesh[] {
  const { w, h } = l;
  const out: THREE.Mesh[] = [];
  const asphalt = makeFloor('asphalt', anisotropy);
  const yard = new THREE.PlaneGeometry(26, h + 16).rotateX(-Math.PI / 2);
  const uv = yard.attributes.uv as THREE.BufferAttribute;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, (uv.getX(k) * 26) / asphalt.meters, (uv.getY(k) * (h + 16)) / asphalt.meters);
  yard.translate(-13, YARD_Y, h / 2);
  const ym = new THREE.Mesh(yard, new THREE.MeshStandardMaterial({ map: asphalt.texture, roughness: 0.95 }));
  ym.receiveShadow = true;
  ym.name = 'yard';
  out.push(ym);
  // подпорная стенка рампы: бетон от двора до пола здания вдоль западной стены
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.4, -YARD_Y, h + 16), new THREE.MeshStandardMaterial({ color: 0x8e9294, roughness: 0.9 }));
  face.position.set(-0.2, YARD_Y / 2, h / 2);
  face.receiveShadow = true;
  face.castShadow = true;
  face.name = 'dock wall';
  out.push(face);
  const paving = makeFloor('paving', anisotropy);
  const grass = makeFloor('grass', anisotropy);
  const strip = (x: number, z: number, sw: number, sd: number, tex: FloorTex, y: number, name: string) => {
    const g = new THREE.PlaneGeometry(sw, sd).rotateX(-Math.PI / 2);
    const u = g.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < u.count; k++) u.setXY(k, (u.getX(k) * sw) / tex.meters, (u.getY(k) * sd) / tex.meters);
    g.translate(x + sw / 2, y, z + sd / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex.texture, roughness: 0.95 }));
    m.receiveShadow = true;
    m.name = name;
    out.push(m);
  };
  // отмостка — плитка в 2 м у стен, дальше — газон
  strip(0, -2, w + 2, 2, paving, -0.006, 'paving n');
  strip(0, h, w + 2, 2, paving, -0.006, 'paving s');
  strip(w, 0, 2, h, paving, -0.006, 'paving e');
  strip(0, -8, w + 8, 6, grass, -0.012, 'grass n');
  strip(0, h + 2, w + 8, 6, grass, -0.012, 'grass s');
  strip(w + 2, -2, 6, h + 4, grass, -0.012, 'grass e');
  const far = new THREE.PlaneGeometry(w + 400, h + 400).rotateX(-Math.PI / 2);
  far.translate(w / 2, YARD_Y - 0.03, h / 2);
  const fm = new THREE.Mesh(far, new THREE.MeshStandardMaterial({ color: 0x23282b, roughness: 1 }));
  fm.receiveShadow = true;
  fm.name = 'ground';
  out.push(fm);
  return out;
}

// ---------------------------------------------------------------- стены

export type WallMode = 'full' | 'cut' | 'down';

export interface Walls {
  mesh: THREE.Mesh;
  uniforms: {
    uMode: { value: number };
    uFocus: { value: THREE.Vector2 };
    uRadius: { value: number };
    uToCam: { value: THREE.Vector2 };
  };
  setMode(m: WallMode): void;
}

/** Срез на CPU — тот же, что в шейдере: для створок дверей, светильников и табличек. */
export function cutAt(u: Walls['uniforms'], cx: number, cz: number, ox = 0, oz = 0): number {
  if (u.uMode.value > 1.5) return 1;
  if (u.uMode.value < 0.5) return 0;
  const d = Math.hypot(cx - u.uFocus.value.x, cz - u.uFocus.value.y);
  const r = u.uRadius.value;
  const t = Math.min(1, Math.max(0, (d - r * 0.85) / (r * 0.15)));
  const near = 1 - t * t * (3 - 2 * t);
  const front = ox * u.uToCam.value.x + oz * u.uToCam.value.y >= 0.3 ? 1 : 0;
  return Math.max(near, front);
}

// В шейдере: наружная стена, обращённая к камере, срезана всегда (front); куски выше среза (перемычки, стекло, верх
// наличников) уходят под пол, а не сплющиваются в полосу (lowY).
const WALL_VERT_PARS = /* glsl */ `
attribute vec2 aCenter;
attribute vec2 aOut;
attribute float aKind;
attribute float aBase;
varying float vKind;
uniform float uMode;
uniform vec2 uFocus;
uniform float uRadius;
uniform vec2 uToCam;
varying float vH;
varying vec3 vObjN;
varying float vOut;
float wallCut() {
  if (uMode > 1.5) return 1.0;
  if (uMode < 0.5) return 0.0;
  float d = distance(aCenter, uFocus);
  float near = 1.0 - smoothstep(uRadius * 0.85, uRadius, d);
  float front = step(0.3, dot(aOut, uToCam));
  return max(near, front);
}
`;
const WALL_VERT_BEGIN = /* glsl */ `
#include <begin_vertex>
vH = position.y;
vKind = aKind;
vObjN = normal;
vOut = dot(normal.xz, aOut);
float cutK = wallCut();
float lowY = aBase > ${WALL_LOW.toFixed(2)} ? -0.05 : min(position.y, ${WALL_LOW.toFixed(2)});
transformed.y = mix(position.y, lowY, cutK);
`;

// Цвета: снаружи — кирпичная коробка старого цеха с тёмным цоколем, внутри — белые панели с серым плинтусом
// (docs/13-art.md, §3, §5); стекло окна, наличник двери; верх стены — тёмный, чтобы срез читался сверху.
function wallMaterial(uniforms: Walls['uniforms']): { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = s => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n${WALL_VERT_PARS}`).replace('#include <begin_vertex>', WALL_VERT_BEGIN);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH;\nvarying vec3 vObjN;\nvarying float vOut;\nvarying float vKind;')
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        /* glsl */ `
        vec3 wc;
        if (vKind > 1.5) wc = vec3(0.62, 0.66, 0.67);
        else if (vKind > 0.5) wc = vec3(0.62, 0.80, 0.88);
        else if (vObjN.y > 0.5) wc = vec3(0.23, 0.27, 0.29);
        else if (vObjN.y < -0.5) wc = vec3(0.85);
        else if (vOut > 0.5) wc = vH < 0.45 ? vec3(0.36, 0.33, 0.31) : vec3(0.56, 0.36, 0.29);
        else if (vH < 0.12) wc = vec3(0.55, 0.58, 0.58);
        else wc = vec3(0.92, 0.93, 0.92);
        vec4 diffuseColor = vec4( pow(wc, vec3(2.2)), opacity );`,
      );
  };
  mat.customProgramCacheKey = () => 'walls';
  const depth = new THREE.MeshDepthMaterial();
  depth.onBeforeCompile = s => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${WALL_VERT_PARS}`)
      .replace('#include <begin_vertex>', WALL_VERT_BEGIN.replace('vObjN = normal;', '').replace('vOut = dot(normal.xz, aOut);', '').replace('vKind = aKind;', ''));
  };
  depth.customProgramCacheKey = () => 'walls-depth';
  return { mat, depth };
}

export function buildWalls(l: Layout): Walls {
  const { w, h, nav } = l;
  const cell = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? nav.cells[y * w + x] : CELL.outside);
  const isWall = (x: number, y: number) => cell(x, y) === CELL.wall;
  const isDoor = (x: number, y: number) => cell(x, y) === CELL.door;
  const doorAt = (x: number, y: number) => (isDoor(x, y) ? l.plan.plant.doors[nav.door[y * w + x]] : undefined);
  const geos: THREE.BufferGeometry[] = [];
  /**
   * Окно — на прямом участке наружной стены через клетку: внутри — пол помещения вне чистой зоны (в классе D окон наружу
   * нет); у склада — высокое, под потолком (docs/13-art.md, §5).
   */
  const windowAt = (x: number, y: number): [number, number] | null => {
    const [ox, oz] = outward(l, x, y);
    if ((ox !== 0 && oz !== 0) || (ox === 0 && oz === 0)) return null;
    const ix = x - Math.sign(ox);
    const iy = y - Math.sign(oz);
    const inner = cell(ix, iy);
    if (inner !== CELL.floor && inner !== CELL.corridor) return null;
    const room = l.rooms[nav.room[iy * w + ix]];
    if (!room || room.grade === 'D') return null;
    if (ox === 0) {
      if (!isWall(x - 1, y) || !isWall(x + 1, y) || x % 3 === 0) return null;
    } else if (!isWall(x, y - 1) || !isWall(x, y + 1) || y % 3 === 0) return null;
    return TALL.has(room.type) ? [4.6, 6.4] : [0.9, 2.15];
  };
  // kind: 0 — стена, 1 — стекло окна, 2 — наличник двери
  const piece = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, cx: number, cz: number, ox: number, oz: number, kind = 0) => {
    if (y1 <= y0) return;
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 2);
    const o = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      c[i * 2] = cx;
      c[i * 2 + 1] = cz;
      o[i * 2] = ox;
      o[i * 2 + 1] = oz;
    }
    g.setAttribute('aCenter', new THREE.BufferAttribute(c, 2));
    g.setAttribute('aOut', new THREE.BufferAttribute(o, 2));
    g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1));
    g.setAttribute('aBase', new THREE.BufferAttribute(new Float32Array(n).fill(y0), 1));
    geos.push(g.toNonIndexed());
  };
  const t2 = WALL_T / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const mx = x + 0.5;
      const mz = y + 0.5;
      const top = wallHeight(l, x, y);
      const [ox, oz] = isWall(x, y) || isDoor(x, y) ? (isOutside(l, x - 1, y) || isOutside(l, x + 1, y) || isOutside(l, x, y - 1) || isOutside(l, x, y + 1) ? outward(l, x, y) : [0, 0]) : [0, 0];
      const win = isWall(x, y) ? windowAt(x, y) : null;
      if (win) {
        // окно в наружной стене: низ, верх и стекло между ними — на всю клетку вдоль стены
        const alongX = ox === 0;
        const [lo, hi] = win;
        const [ax0, ax1, az0, az1] = alongX ? [x, x + 1, mz - t2, mz + t2] : [mx - t2, mx + t2, y, y + 1];
        piece(ax0, ax1, az0, az1, 0, lo, mx, mz, ox, oz);
        piece(ax0, ax1, az0, az1, hi, top, mx, mz, ox, oz);
        const g = 0.025;
        const [gx0, gx1, gz0, gz1] = alongX ? [x, x + 1, mz - g, mz + g] : [mx - g, mx + g, y, y + 1];
        piece(gx0, gx1, gz0, gz1, lo, hi, mx, mz, ox, oz, 1);
        if (alongX) piece(mx - 0.03, mx + 0.03, mz - t2 * 0.6, mz + t2 * 0.6, lo, hi, mx, mz, ox, oz, 2);
        else piece(mx - t2 * 0.6, mx + t2 * 0.6, mz - 0.03, mz + 0.03, lo, hi, mx, mz, ox, oz, 2);
      } else if (isWall(x, y)) {
        piece(mx - t2, mx + t2, mz - t2, mz + t2, 0, top, mx, mz, ox, oz);
        const e = isWall(x + 1, y) || isDoor(x + 1, y);
        const wv = isWall(x - 1, y) || isDoor(x - 1, y);
        const s = isWall(x, y + 1) || isDoor(x, y + 1);
        const nn = isWall(x, y - 1) || isDoor(x, y - 1);
        if (e) piece(mx + t2, x + 1, mz - t2, mz + t2, 0, top, mx, mz, ox, oz);
        if (wv) piece(x, mx - t2, mz - t2, mz + t2, 0, top, mx, mz, ox, oz);
        if (s) piece(mx - t2, mx + t2, mz + t2, y + 1, 0, top, mx, mz, ox, oz);
        if (nn) piece(mx - t2, mx + t2, y, mz - t2, 0, top, mx, mz, ox, oz);
      } else if (isDoor(x, y)) {
        const d = doorAt(x, y)!;
        const horiz = d.along === 'x';
        // проём: дверь — 2,1 м, ворота — 3 м, рампа — 3,4 м; лента — окно в стене на высоте конвейера
        const open = d.kind === 'dock' ? DOCK_H : d.kind === 'gate' ? GATE_H : DOOR_H;
        const f = 0.07;
        const ft = t2 + 0.025;
        const first = horiz ? !isDoor(x - 1, y) || nav.door[y * w + x - 1] !== nav.door[y * w + x] : !isDoor(x, y - 1) || nav.door[(y - 1) * w + x] !== nav.door[y * w + x];
        const last = horiz ? !isDoor(x + 1, y) || nav.door[y * w + x + 1] !== nav.door[y * w + x] : !isDoor(x, y + 1) || nav.door[(y + 1) * w + x] !== nav.door[y * w + x];
        if (d.kind === 'hatch') {
          if (horiz) {
            piece(x, x + 1, mz - t2, mz + t2, 0, HATCH.low, mx, mz, ox, oz);
            piece(x, x + 1, mz - t2, mz + t2, HATCH.high, top, mx, mz, ox, oz);
          } else {
            piece(mx - t2, mx + t2, y, y + 1, 0, HATCH.low, mx, mz, ox, oz);
            piece(mx - t2, mx + t2, y, y + 1, HATCH.high, top, mx, mz, ox, oz);
          }
          continue;
        }
        if (horiz) {
          piece(x, x + 1, mz - t2, mz + t2, open, top, mx, mz, ox, oz);
          if (first) piece(x, x + f, mz - ft, mz + ft, 0, open, mx, mz, ox, oz, 2);
          if (last) piece(x + 1 - f, x + 1, mz - ft, mz + ft, 0, open, mx, mz, ox, oz, 2);
          piece(x, x + 1, mz - ft, mz + ft, open - f, open, mx, mz, ox, oz, 2);
        } else {
          piece(mx - t2, mx + t2, y, y + 1, open, top, mx, mz, ox, oz);
          if (first) piece(mx - ft, mx + ft, y, y + f, 0, open, mx, mz, ox, oz, 2);
          if (last) piece(mx - ft, mx + ft, y + 1 - f, y + 1, 0, open, mx, mz, ox, oz, 2);
          piece(mx - ft, mx + ft, y, y + 1, open - f, open, mx, mz, ox, oz, 2);
        }
      }
    }
  }
  const geo = mergeGeometries(geos, false)!;
  const uniforms: Walls['uniforms'] = {
    uMode: { value: 1 },
    uFocus: { value: new THREE.Vector2(w / 2, h / 2) },
    uRadius: { value: 14 },
    uToCam: { value: new THREE.Vector2(0, 1) },
  };
  const { mat, depth } = wallMaterial(uniforms);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.customDepthMaterial = depth;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'walls';
  return {
    mesh,
    uniforms,
    setMode(m) {
      uniforms.uMode.value = m === 'full' ? 0 : m === 'cut' ? 1 : 2;
    },
  };
}
