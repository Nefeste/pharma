// Слой «Загрузка и OEE» (Б1и; docs/specs/2026-10-vertical-slice.md, «Б1и»; docs/13-art.md, §11): столбики загрузки в
// помещениях и у машин линии, число над каждым и доска «План — факт» в конце линии. Части столбиков — экземпляры одного
// короба, рамка полной высоты — одна сетка линий, числа — экземпляры квадрата из одной текстуры, повёрнутые к камере в
// шейдере (как значки работ, badges.ts), доски — по одной на линию, лицом к камере: сверху вертикальную доску не
// прочесть. Тени не отбрасывают; неосвещённые — цвет части тот же днём и ночью, какой проверен в четырёх видах зрения.
// Текстуры перерисовываются, только когда вид изменился. Где стоят столбики и что на них — src/app/floor.ts.
import * as THREE from 'three';
import { type Bar, barsOf, boardRows, colorOf, FLOOR, type Label, type Spots, spotsOf } from '../app/floor';
import type { ContentDb } from '../content/types';
import { HOUR } from '../engine/core/calendar';
import { clock, named, num, pctText, T } from '../i18n';
import type { FloorBoard, FloorView } from '../sim/floor';
import type { Layout } from './layout';

/**
 * Клетка числа в текстуре, точек; кегль числа — `BIG` точек, высота его цифр — доля `DIGIT` кегля: она и есть
 * `FLOOR.digits` м на полу. Строка, которая не влезает в клетку, — мельче.
 */
const CELL_W = 400;
const CELL_H = 140;
const BIG = 64;
const SMALL = 34;
const DIGIT = 0.72;
/** Над столбиком, м. */
const LABEL_GAP = 0.12;
/** Доска: точек на метр. */
const BOARD_PX = 320;
/** Частей на столбике — не больше шести (машина линии). */
const PARTS = 6;
/** Доска перерисовывается не чаще, мс: годные пачки часа меняются с каждым срезом; смена и час — сразу. */
const BOARD_MS = 500;
/** Рамка полной высоты — светлая, полупрозрачная: видно, сколько окна не занято. */
const FRAME = 0xe8edf0;

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

const canvasTex = (c: HTMLCanvasElement) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
};

/** Число над столбиком словами: крупно — доля или OEE, мелко — что это. */
export function labelLines(l: Label): [string, string] {
  if (l.k === 'key') return [`OEE ${pctText(l.oee)}`, T.floor.apq(pctText(l.a), pctText(l.p), pctText(l.q))];
  const big = l.share === undefined ? T.floor.none : pctText(l.share);
  return [big, l.k === 'room' ? T.floor.work : T.floor.run];
}

interface BoardMesh {
  line: number;
  mesh: THREE.Mesh;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  key: string;
  /** что нарисовать, когда подойдёт срок, и с чем нарисовано — смена, начало, час */
  next?: FloorBoard;
  shape: string;
  at: number;
}

export class FloorLayer {
  readonly group = new THREE.Group();
  readonly spots: Spots;
  private parts: THREE.InstancedMesh;
  private labels: THREE.InstancedMesh;
  private cell: THREE.InstancedBufferAttribute;
  private atlas: CanvasRenderingContext2D;
  private atlasTex: THREE.CanvasTexture;
  private uniforms: { uMap: { value: THREE.Texture | null }; uSize: { value: THREE.Vector2 }; uCount: { value: number } };
  private boards: BoardMesh[] = [];
  private keys: string[] = [];
  private shown: Bar[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(
    private db: ContentDb,
    l: Layout,
    rooms: readonly string[],
    private lineName: (n: number) => string,
  ) {
    this.spots = spotsOf(db, l, rooms);
    const n = this.spots.bars.length;
    this.parts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), Math.max(1, n * PARTS));
    // цвет экземпляров — с первого кадра: программа шейдера сразу с ним
    this.parts.setColorAt(0, this.c.setHex(0xffffff));
    this.parts.count = 0;
    this.parts.frustumCulled = false;
    this.parts.name = 'floor bars';
    this.group.add(this.parts);
    // рамка полной высоты: двенадцать рёбер короба у каждого столбика
    const pos: number[] = [];
    for (const b of this.spots.bars) {
      const h = b.side / 2 + 0.01;
      const xs = [b.x - h, b.x + h];
      const zs = [b.z - h, b.z + h];
      const ys = [0, FLOOR.full];
      for (const y of ys) for (const x of xs) pos.push(x, y, zs[0], x, y, zs[1]);
      for (const y of ys) for (const z of zs) pos.push(xs[0], y, z, xs[1], y, z);
      for (const x of xs) for (const z of zs) pos.push(x, 0, z, x, FLOOR.full, z);
    }
    const frame = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)), new THREE.LineBasicMaterial({ color: FRAME, transparent: true, opacity: 0.55, toneMapped: false }));
    frame.name = 'floor frames';
    this.group.add(frame);
    // числа: клетка на столбик, по порядку мест
    const c = document.createElement('canvas');
    c.width = CELL_W;
    c.height = CELL_H * Math.max(1, n);
    this.atlas = c.getContext('2d')!;
    this.atlasTex = canvasTex(c);
    this.uniforms = { uMap: { value: this.atlasTex }, uSize: { value: new THREE.Vector2(1, 1) }, uCount: { value: Math.max(1, n) } };
    const geo = new THREE.PlaneGeometry(1, 1);
    this.cell = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n)), 1);
    geo.setAttribute('aCell', this.cell);
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false });
    this.labels = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    this.labels.count = 0;
    this.labels.frustumCulled = false;
    this.labels.renderOrder = 12;
    this.labels.name = 'floor labels';
    this.group.add(this.labels);
    this.keys = Array(n).fill('');
    for (const sp of this.spots.boards) {
      const bc = document.createElement('canvas');
      bc.width = FLOOR.board.w * BOARD_PX;
      bc.height = FLOOR.board.h * BOARD_PX;
      const tex = canvasTex(bc);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.board.w, FLOOR.board.h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      mesh.position.set(sp.x, FLOOR.board.y + FLOOR.board.h / 2, sp.z);
      mesh.name = `floor board ${sp.line}`;
      mesh.visible = false;
      this.group.add(mesh);
      this.boards.push({ line: sp.line, mesh, ctx: bc.getContext('2d')!, tex, key: '', shape: '', at: Number.NEGATIVE_INFINITY });
    }
    this.group.visible = false;
  }

  /** Столбики, числа и доски вида; `undefined` — вида ещё нет: пусто. */
  set(v: FloorView | undefined) {
    const bars = v ? barsOf(this.spots, v) : [];
    this.shown = bars;
    let k = 0;
    for (const b of bars) {
      for (const part of b.parts) {
        if (k >= this.parts.instanceMatrix.count) break;
        this.m.compose(this.p.set(b.x, part.y0, b.z), this.q, this.s.set(b.side, Math.max(0.005, part.h), b.side));
        this.parts.setMatrixAt(k, this.m);
        this.parts.setColorAt(k, this.c.setHex(colorOf(part.part)));
        k++;
      }
    }
    this.parts.count = k;
    this.parts.instanceMatrix.needsUpdate = true;
    if (this.parts.instanceColor) this.parts.instanceColor.needsUpdate = true;
    // числа: перерисовать клетку, только если её строки сменились
    let drawn = false;
    bars.forEach((b, i) => {
      const lines = labelLines(b.label);
      const key = lines.join('|');
      if (this.keys[b.n] !== key) {
        this.keys[b.n] = key;
        this.drawLabel(b.n, lines);
        drawn = true;
      }
      this.m.makeTranslation(b.x, FLOOR.full + LABEL_GAP, b.z);
      this.labels.setMatrixAt(i, this.m);
      this.cell.setX(i, b.n);
    });
    this.labels.count = bars.length;
    this.labels.instanceMatrix.needsUpdate = true;
    this.cell.needsUpdate = true;
    if (drawn) this.atlasTex.needsUpdate = true;
    for (const bm of this.boards) {
      const b = v?.lines.find(x => x.n === bm.line)?.board;
      bm.mesh.visible = !!b;
      if (!b) continue;
      const key = JSON.stringify(b);
      if (key === bm.key) continue;
      bm.key = key;
      bm.next = b;
    }
    this.drawBoards();
  }

  /** Доски, которым есть что рисовать: смена или час сменились — сразу, иначе — не чаще `BOARD_MS`. */
  private drawBoards() {
    const now = performance.now();
    for (const bm of this.boards) {
      const b = bm.next;
      if (!b) continue;
      const shape = `${b.shift}|${b.from}|${b.now ?? -1}|${b.to ?? -1}`;
      if (shape === bm.shape && now - bm.at < BOARD_MS) continue;
      bm.shape = shape;
      bm.at = now;
      bm.next = undefined;
      this.drawBoard(bm, b);
    }
  }

  /** Столбики, которые сейчас на полу, — для наведения и сценария в браузере. */
  get bars(): readonly Bar[] {
    return this.shown;
  }

  /** Сколько досок «План — факт» видно — для сценария в браузере. */
  get boardsShown(): number {
    return this.group.visible ? this.boards.filter(b => b.mesh.visible).length : 0;
  }

  setShown(on: boolean) {
    this.group.visible = on;
  }

  /**
   * Каждый кадр: доски — лицом к камере; числа — цифрами высотой `FLOOR.digits`, с высоты участка (`site` — вес этого
   * уровня показа, detail.ts) — вдвое крупнее.
   */
  update(cam: THREE.Camera, site: number) {
    if (!this.group.visible) return;
    this.drawBoards();
    for (const bm of this.boards) bm.mesh.quaternion.copy(cam.quaternion);
    const h = ((FLOOR.digits * CELL_H) / (BIG * DIGIT)) * (1 + Math.min(1, Math.max(0, site)));
    this.uniforms.uSize.value.set((h * CELL_W) / CELL_H, h);
    this.labels.position.y = h / 2;
  }

  private drawLabel(i: number, [big, small]: [string, string]) {
    const g = this.atlas;
    const y = i * CELL_H;
    g.clearRect(0, y, CELL_W, CELL_H);
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
      g.strokeText(text, CELL_W / 2, y + CELL_H * at);
      g.fillStyle = color;
      g.fillText(text, CELL_W / 2, y + CELL_H * at);
    };
    line(big, BIG, 700, 0.34, '#ffffff', 10);
    line(small, SMALL, 600, 0.8, '#e4ecef', 7);
  }

  /** Доска «План — факт»: смена, по часам — план и годные; час ниже плана — выделен и отмечен; итог и ритмичность. */
  private drawBoard(bm: BoardMesh, b: FloorBoard) {
    const g = bm.ctx;
    const w = g.canvas.width;
    const h = g.canvas.height;
    g.fillStyle = '#f4f5f3';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#23292c';
    g.fillRect(0, 0, w, 78);
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = '700 30px system-ui, sans-serif';
    g.fillText(T.floor.board.title(this.lineName(bm.line)), 18, 26);
    g.font = '22px system-ui, sans-serif';
    g.fillStyle = '#c9d3d7';
    g.fillText(T.floor.board.shift(named(this.db.shifts[b.shift]?.name, b.shift), clock(b.from), clock(b.ends)), 18, 60);
    const rows = boardRows(b);
    const top = 86;
    const foot = 56;
    const rh = Math.min(34, (h - top - foot - 30) / Math.max(1, rows.length));
    const cols = [24, w * 0.52, w - 24];
    g.fillStyle = '#5a666c';
    g.font = '600 20px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(T.floor.board.hour, cols[0], top + 12);
    g.textAlign = 'right';
    g.fillText(T.floor.board.plan, cols[1], top + 12);
    g.fillText(T.floor.board.fact, cols[2], top + 12);
    const fs = Math.max(14, Math.min(24, Math.floor(rh * 0.72)));
    rows.forEach((r, i) => {
      const y = top + 30 + i * rh;
      if (r.now) {
        g.fillStyle = '#dce9f5';
        g.fillRect(8, y, w - 16, rh);
      } else if (r.low) {
        g.fillStyle = '#f8e1dc';
        g.fillRect(8, y, w - 16, rh);
      }
      const cy = y + rh / 2;
      g.font = `${fs}px system-ui, sans-serif`;
      g.fillStyle = '#23292c';
      g.textAlign = 'left';
      g.fillText(T.floor.board.span(clock(r.from).slice(0, 2), clock(r.from + HOUR).slice(0, 2)), cols[0], cy);
      g.textAlign = 'right';
      g.fillText(num(r.plan), cols[1], cy);
      if (r.fact !== undefined) {
        g.font = `${r.low ? 700 : 400} ${fs}px system-ui, sans-serif`;
        g.fillStyle = r.low ? '#a3261b' : '#23292c';
        g.fillText(r.now ? `${num(r.fact)}…` : r.low ? `▼ ${num(r.fact)}` : num(r.fact), cols[2], cy);
      }
    });
    g.fillStyle = '#23292c';
    g.fillRect(0, h - foot, w, 2);
    g.textAlign = 'left';
    g.font = '700 24px system-ui, sans-serif';
    g.fillText(b.plan > 0 ? T.floor.board.total(num(b.fact), num(b.plan)) : T.floor.board.noPlan(num(b.fact)), 18, h - foot / 2);
    if (b.rhythm !== undefined) {
      g.textAlign = 'right';
      g.font = '24px system-ui, sans-serif';
      g.fillText(T.floor.board.rhythm(pctText(b.rhythm)), w - 18, h - foot / 2);
    }
    bm.tex.needsUpdate = true;
  }
}
