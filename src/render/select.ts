// Рамка выбранной вещи (docs/specs/2026-10-panels.md, 3б): контур на полу вокруг следа — прямоугольник у паллеты, машины,
// фуры и помещения, круг у человека и техники. Одна линия цвета выбора интерфейса, без освещения, поверх пола и паллет:
// её видно и днём, и ночью. Где она — решает окно каждый кадр (люди и фуры движутся).
import * as THREE from 'three';

/** Цвет выбора — акцент интерфейса (app/index.html, `--accent`). */
const COLOR = 0x2fb5c9;
/** Точек круга. */
const ROUND = 32;

/** Что обвести: прямоугольник [x0, z0, x1, z1] или круг [x, z, r] — на высоте `y`, м. */
export type Outline = { rect: [number, number, number, number]; y: number } | { circle: [number, number, number]; y: number };

export class Selection {
  readonly line: THREE.LineLoop;
  private pos: Float32Array;

  constructor() {
    this.pos = new Float32Array(ROUND * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.line = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: COLOR, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false }));
    this.line.renderOrder = 30;
    this.line.frustumCulled = false;
    this.line.visible = false;
  }

  /** Обвести или снять рамку. */
  set(o: Outline | undefined) {
    if (!o) {
      this.line.visible = false;
      return;
    }
    const g = this.line.geometry;
    let n: number;
    if ('rect' in o) {
      const [x0, z0, x1, z1] = o.rect;
      const pad = 0.12;
      const pts = [
        [x0 - pad, z0 - pad],
        [x1 + pad, z0 - pad],
        [x1 + pad, z1 + pad],
        [x0 - pad, z1 + pad],
      ];
      pts.forEach(([x, z], i) => this.pos.set([x, o.y + 0.03, z], i * 3));
      n = 4;
    } else {
      const [x, z, r] = o.circle;
      for (let i = 0; i < ROUND; i++) {
        const a = (2 * Math.PI * i) / ROUND;
        this.pos.set([x + r * Math.cos(a), o.y + 0.03, z + r * Math.sin(a)], i * 3);
      }
      n = ROUND;
    }
    g.setDrawRange(0, n);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    g.computeBoundingSphere();
    this.line.visible = true;
  }
}
