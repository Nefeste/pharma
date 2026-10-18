// Слой участка (docs/specs/2026-10-view.md, 2г; docs/13-art.md, §4, §10): стрелки перевозок и линии над стенами и загрузка
// мест склада на полу. Виден на ×4 и с высоты участка; проступает и уходит вместе с уровнем показа (detail.ts). Стрелки —
// неосвещённые, с белой обводкой: читаются и днём, и ночью. Загрузка — одна текстура на весь участок: заливка по доле
// занятых мест и число процентов; перерисовывается, только когда доли меняются.
import * as THREE from 'three';
import type { Arrow, Fill } from '../app/flows';
import type { Layout } from './layout';

/** Цвет стрелок — один, нейтральный, не из палитр статусов и ламп; обводка — белая. */
const ARROW = 0x3c4a9e;
const OUTLINE = 0xffffff;
/** Слой стрелок — над стенами помещений (3,2 м). */
const ARROW_Y = 3.6;
const MAX_ARROWS = 64;
/** Сколько точек текстуры загрузки на метр. */
const PX = 16;
/** Заливка загрузки (геймдизайн, §19.3): непрозрачность от пустой зоны до полной. */
const FILL = { color: '52, 73, 94', min: 0.15, max: 0.7 } as const;

/** Обводка стрелки, м, и длина наконечника: в 1,6 толщины, не меньше 1 м и не больше 0,4 длины стрелки. */
const PAD = 0.12;
const headOf = (len: number, width: number) => Math.min(0.4 * len, Math.max(1, 1.6 * width));

/** Древко: прямоугольник от x = 0 до 1, шириной 1 по z, на полу. */
function shaftGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
}

/** Наконечник: треугольник от основания при x = 0 (ширина 2 — вдвое шире древка) до острия при x = 1. */
function headGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -1, 0, 0, 1, 1, 0, 0], 3));
  g.setIndex([0, 1, 2]);
  g.computeVertexNormals();
  return g;
}

export class Overlay {
  readonly group = new THREE.Group();
  private fill: THREE.Mesh;
  private fillMat: THREE.MeshBasicMaterial;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private fillKey = '';
  /** обводка древка и наконечника, затем древко и наконечник */
  private parts: THREE.InstancedMesh[];
  /** сколько стрелок в слое — для сценария в браузере */
  arrowsShown = 0;
  private mats: THREE.MeshBasicMaterial[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(l: Layout) {
    const c = document.createElement('canvas');
    c.width = l.w * PX;
    c.height = l.h * PX;
    this.ctx = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.fillMat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(l.w, l.h).rotateX(-Math.PI / 2), this.fillMat);
    this.fill.position.set(l.w / 2, 0.02, l.h / 2);
    this.fill.name = 'site fill';
    this.fill.renderOrder = 5;
    this.group.add(this.fill);
    const mat = (color: number) => {
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      this.mats.push(m);
      return m;
    };
    const shaft = shaftGeometry();
    const head = headGeometry();
    // обводка — под стрелкой: те же фигуры, шире на PAD с каждой стороны
    this.parts = [
      new THREE.InstancedMesh(shaft, mat(OUTLINE), MAX_ARROWS),
      new THREE.InstancedMesh(head, mat(OUTLINE), MAX_ARROWS),
      new THREE.InstancedMesh(shaft, mat(ARROW), MAX_ARROWS),
      new THREE.InstancedMesh(head, mat(ARROW), MAX_ARROWS),
    ];
    this.parts.forEach((a, i) => {
      a.count = 0;
      a.frustumCulled = false;
      a.renderOrder = 20 + (i >> 1);
      a.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      a.name = i < 2 ? 'arrow outline' : 'arrow';
      this.group.add(a);
    });
  }

  /**
   * Стрелки кадра. У стрелки — свой бок: она сдвинута вправо по ходу на полширины и ещё 0,3 м, поэтому встречные потоки
   * не ложатся друг на друга.
   */
  setArrows(list: readonly Arrow[]) {
    let n = 0;
    const [oShaft, oHead, shaft, head] = this.parts;
    const put = (mesh: THREE.InstancedMesh, x: number, z: number, len: number, width: number) => {
      this.m.compose(this.p.set(x, ARROW_Y, z), this.q, this.s.set(len, 1, width));
      mesh.setMatrixAt(n, this.m);
    };
    for (const a of list) {
      if (n >= MAX_ARROWS) break;
      const dx = a.bx - a.ax;
      const dz = a.bz - a.az;
      const len = Math.hypot(dx, dz);
      if (len < 1) continue;
      const ux = dx / len;
      const uz = dz / len;
      // вправо по ходу (x — восток, z — юг, y — вверх): (−uz, ux)
      const off = a.width / 2 + 0.3;
      const x0 = a.ax - uz * off;
      const z0 = a.az + ux * off;
      const h = headOf(len, a.width);
      const body = len - h;
      this.q.setFromAxisAngle(this.up, Math.atan2(-dz, dx));
      put(shaft, x0, z0, body, a.width);
      put(head, x0 + ux * body, z0 + uz * body, h, a.width);
      put(oShaft, x0 - ux * PAD, z0 - uz * PAD, body + PAD, a.width + 2 * PAD);
      put(oHead, x0 + ux * (body - PAD), z0 + uz * (body - PAD), h + 3 * PAD, a.width + 2 * PAD);
      n++;
    }
    for (const a of this.parts) {
      a.count = n;
      a.instanceMatrix.needsUpdate = true;
    }
    this.arrowsShown = n;
  }

  /** Загрузка мест: заливка по доле занятых и число процентов; перерисовка — только когда доли сменились. */
  setFills(list: readonly Fill[]) {
    const key = list.map(f => `${f.id}:${f.used}/${f.places}`).join(',');
    if (key === this.fillKey) return;
    this.fillKey = key;
    const g = this.ctx;
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    for (const f of list) {
      const share = f.places ? f.used / f.places : 0;
      const [x, z, w, d] = f.rect.map(v => v * PX);
      g.fillStyle = `rgba(${FILL.color}, ${FILL.min + (FILL.max - FILL.min) * share})`;
      g.fillRect(x, z, w, d);
      // число — в середине зоны; у ряда стеллажей — в поперечном проходе за его восточным концом: груз на ярусах не
      // закрывает его ни с какой стороны камеры
      const rack = f.kind === 'rack';
      const cx = rack ? x + w + 1.1 * PX : x + w / 2;
      const cz = z + d / 2;
      const text = `${Math.round(share * 100)} %`;
      g.font = `bold ${Math.round((rack ? 0.75 : 0.9) * PX)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(20, 26, 30, 0.85)';
      g.strokeText(text, cx, cz);
      g.fillStyle = '#ffffff';
      g.fillText(text, cx, cz);
    }
    this.tex.needsUpdate = true;
  }

  /** Насколько слой проступил: 0 — скрыт (и не рисуется), 1 — виден весь. */
  setShown(k: number) {
    this.group.visible = k > 0.001;
    for (const m of this.mats) m.opacity = 0.9 * k;
    this.fillMat.opacity = k;
  }
}
