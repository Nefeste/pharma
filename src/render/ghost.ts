// из bolnitsa: src/render/ghost.ts @ e804637 — изменено: без моделей предметов и обстановки готовых помещений (их на
// заводе в Б7б нет); прямоугольник — и у помещения, и у корпуса; дверь — клетки вдоль стены по оси; клетки зоны, ряда
// стеллажа и того, что снесут, — подсветкой на полу; материалы — по цвету и прозрачности, одни на всё время, освобождается
// только сетка: освобождённый последний материал отдаёт программу отрисовщика, и у следующего призрака она собиралась бы
// заново на каждое движение мыши.
// Призраки стройки (Б7б; docs/specs/2026-10-vertical-slice.md, «Окно»): прямоугольник со стенами, дверь, подсветка клеток —
// полупрозрачно, зелёным (можно), жёлтым (с замечанием или не будет работать) или красным (нельзя, снос). Отдельные
// небольшие сетки поверх сцены: пересобираются, только когда меняется, что показывать.
import * as THREE from 'three';
import { DOOR_H, WALL_T } from './world';

/** Можно — зелёный; не будет работать или замечание — жёлтый; нельзя и снос — красный. */
export const GHOST_OK = 0x3fbf7f;
export const GHOST_WARN = 0xe0b23f;
export const GHOST_BAD = 0xe0533f;

const mats = new Map<string, THREE.MeshBasicMaterial>();
const ghostMat = (color: number, opacity: number) => {
  const key = `${color}/${opacity}`;
  let m = mats.get(key);
  if (!m) mats.set(key, (m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide })));
  return m;
};

/** Высота призрака стены: стены в стройке опущены, призрак — чуть выше них. */
const WALL = 0.6;
/** Клеток подсветки самое большее: корпус 40 × 40 — с запасом. */
const MARKS = 2048;

/** Сетки призрака — освободить; материалы — общие (`ghostMat`), остаются. */
function dispose(g: THREE.Object3D) {
  g.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
  });
}

export type GhostRect = { x: number; z: number; w: number; d: number };

export class Ghosts {
  readonly group = new THREE.Group();
  private rectG = new THREE.Group();
  private rectKey = '';
  private doorG = new THREE.Group();
  private doorKey = '';
  private marks: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private color = new THREE.Color();

  constructor() {
    this.group.name = 'build ghosts';
    this.group.add(this.rectG, this.doorG);
    const quad = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
    this.marks = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }), MARKS);
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    this.marks.setColorAt(0, this.color.set(GHOST_OK));
    this.group.add(this.marks);
    this.group.renderOrder = 10;
  }

  /** Прямоугольник со стенами (`null` — нет): помещение или корпус, клетки. */
  rect(r: GhostRect | null, color: number) {
    const key = r ? `${r.x},${r.z},${r.w},${r.d},${color}` : '';
    if (key === this.rectKey) return;
    this.rectKey = key;
    dispose(this.rectG);
    this.rectG.clear();
    if (!r) return;
    if (r.w > 2 && r.d > 2) {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(r.w - 2, r.d - 2).rotateX(-Math.PI / 2), ghostMat(color, 0.28));
      floor.position.set(r.x + r.w / 2, 0.03, r.z + r.d / 2);
      this.rectG.add(floor);
    }
    const t = WALL_T * 1.6;
    const wall = (x: number, z: number, w: number, d: number) => {
      if (w <= 0 || d <= 0) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL, d), ghostMat(color, 0.55));
      m.position.set(x, WALL / 2, z);
      this.rectG.add(m);
    };
    for (const z of [r.z, r.z + r.d - 1]) wall(r.x + r.w / 2, z + 0.5, r.w - 1 + t, t);
    for (const x of [r.x, r.x + r.w - 1]) wall(x + 0.5, r.z + r.d / 2, t, r.d - 1);
  }

  /** Дверь в клетках стены вдоль оси `along` (`null` — нет). */
  door(cells: readonly [number, number][] | null, along: 'x' | 'z', color: number) {
    const key = cells ? `${cells.map(c => c.join(',')).join(';')}|${along}|${color}` : '';
    if (key === this.doorKey) return;
    this.doorKey = key;
    dispose(this.doorG);
    this.doorG.clear();
    if (!cells) return;
    for (const [x, z] of cells) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? 0.96 : 0.34, DOOR_H, along === 'x' ? 0.34 : 0.96), ghostMat(color, 0.5));
      m.position.set(x + 0.5, DOOR_H / 2, z + 0.5);
      this.doorG.add(m);
    }
  }

  /** Подсветка клеток на полу: зона, ряд стеллажа, что снесут, курсор. */
  cells(cells: readonly [number, number][], color: number) {
    const n = Math.min(cells.length, MARKS);
    for (let i = 0; i < n; i++) {
      this.m4.makeTranslation(cells[i][0] + 0.5, 0.04, cells[i][1] + 0.5);
      this.marks.setMatrixAt(i, this.m4);
      this.marks.setColorAt(i, this.color.set(color));
    }
    this.marks.count = n;
    this.marks.instanceMatrix.needsUpdate = true;
    if (this.marks.instanceColor) this.marks.instanceColor.needsUpdate = true;
  }

  clear() {
    this.rect(null, GHOST_OK);
    this.door(null, 'x', GHOST_OK);
    this.cells([], GHOST_OK);
  }
}
