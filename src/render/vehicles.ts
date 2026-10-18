// Техника склада (docs/specs/2026-10-view.md, 2б; docs/13-art.md, §7): модели кодом с подвижными частями. Рохля — вилы,
// корпус с насосом, ручка, колесо; ричтрак — шасси, опорные лапы, мачта с выдвижной внутренней частью, каретка с вилами,
// ограждение над водителем. Без марок и надписей. Точка техники — середина вил (её везёт маршрут, `src/app/movers.ts`),
// корпус — позади неё по ходу. Части всей техники одного вида — по одной InstancedMesh на цвет.
import * as THREE from 'three';
import type { Machine } from '../app/movers';
import { RACK } from '../engine/plant';

/** Сколько единиц техники одного вида рисуется самое большее. */
const MAX = 8;

/** Высота вил над полом, м, по ярусу (дробный — между ярусами): пол — 0, ярус — его высота с балкой. */
export const forkY = (fork: number) => (fork * RACK.level) / 100 + 0.12 * Math.min(1, Math.max(0, fork));

/** Кусок модели в осях техники: x — вправо, y — вверх, z — вперёд (к вилам); середина и размер, м; что поднимается. */
type Piece = [x: number, y: number, z: number, sx: number, sy: number, sz: number, lift?: 'fork' | 'mast'];

interface Kind {
  /** где стоит водитель: в осях техники, м */
  driver: { z: number };
  parts: { color: number; rough: number; metal: number; pieces: Piece[] }[];
}

/** Модели по виду техники (`content/vehicles/`): у рохли подъёма нет (`levels: 0`), у ричтрака — мачта. */
const KINDS: Record<string, Kind> = {
  'veh.jack': {
    driver: { z: -1.25 },
    parts: [
      // вилы и рама — тёмные; ход вил — в пределах сантиметров
      {
        color: 0x2f3437,
        rough: 0.5,
        metal: 0.4,
        pieces: [
          [0.27, 0.035, 0, 0.16, 0.07, 1.15, 'fork'],
          [-0.27, 0.035, 0, 0.16, 0.07, 1.15, 'fork'],
          [0, 0.08, -0.66, 0.16, 0.16, 0.16],
        ],
      },
      // корпус с насосом и ручка — приглушённый оранжевый
      {
        color: 0xc0602e,
        rough: 0.55,
        metal: 0.2,
        pieces: [
          [0, 0.24, -0.66, 0.56, 0.24, 0.22, 'fork'],
          [0, 0.68, -0.8, 0.05, 0.9, 0.05],
          [0, 1.12, -0.82, 0.38, 0.05, 0.05],
        ],
      },
    ],
  },
  'veh.reach': {
    driver: { z: -1.45 },
    parts: [
      // шасси, лапы и ограждение — жёлтое шасси, тёмное остальное
      {
        color: 0xd2a634,
        rough: 0.5,
        metal: 0.2,
        pieces: [
          [0, 0.5, -1.65, 1.2, 1.0, 1.5],
          [0, 1.05, -2.25, 1.2, 0.1, 0.3],
        ],
      },
      {
        color: 0x2f3437,
        rough: 0.45,
        metal: 0.5,
        pieces: [
          // опорные лапы вперёд, к грузу
          [0.55, 0.1, -0.35, 0.14, 0.2, 1.2],
          [-0.55, 0.1, -0.35, 0.14, 0.2, 1.2],
          // наружная мачта
          [0.36, 1.35, -0.86, 0.1, 2.7, 0.12],
          [-0.36, 1.35, -0.86, 0.1, 2.7, 0.12],
          // внутренняя мачта — выдвигается, когда вилы выше наружной
          [0.28, 1.35, -0.8, 0.08, 2.6, 0.1, 'mast'],
          [-0.28, 1.35, -0.8, 0.08, 2.6, 0.1, 'mast'],
          // ограждение над водителем: стойки и крыша
          [0.55, 1.6, -1.05, 0.06, 1.2, 0.06],
          [-0.55, 1.6, -1.05, 0.06, 1.2, 0.06],
          [0.55, 1.6, -2.35, 0.06, 1.2, 0.06],
          [-0.55, 1.6, -2.35, 0.06, 1.2, 0.06],
          [0, 2.22, -1.7, 1.2, 0.05, 1.4],
          // колёса
          [0.55, 0.12, 0.2, 0.12, 0.24, 0.24],
          [-0.55, 0.12, 0.2, 0.12, 0.24, 0.24],
          [0, 0.15, -2.1, 0.2, 0.3, 0.3],
        ],
      },
      // каретка и вилы — светлая сталь
      {
        color: 0x8b9399,
        rough: 0.35,
        metal: 0.7,
        pieces: [
          [0, 0.55, -0.66, 0.9, 1.0, 0.05, 'fork'],
          [0.25, 0.025, 0, 0.12, 0.05, 1.15, 'fork'],
          [-0.25, 0.025, 0, 0.12, 0.05, 1.15, 'fork'],
        ],
      },
    ],
  },
};

interface Part {
  mesh: THREE.InstancedMesh;
  pieces: Piece[];
}

/** Техника склада на экране. */
export class Fleet {
  readonly group = new THREE.Group();
  private kinds = new Map<number, { kind: Kind; parts: Part[] }>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private o = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  /** `types` — виды техники по номерам среза (порядок `db.vehicles`). */
  constructor(types: readonly string[]) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    types.forEach((id, n) => {
      const kind = KINDS[id];
      if (!kind) return;
      const parts = kind.parts.map(pt => {
        const mesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: pt.color, roughness: pt.rough, metalness: pt.metal }), MAX * pt.pieces.length);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(mesh);
        return { mesh, pieces: pt.pieces };
      });
      this.kinds.set(n, { kind, parts });
    });
  }

  /** Где стоит водитель техники, м: позади вил по ходу. */
  driverAt(type: number, at: { x: number; z: number; heading: number }): { x: number; z: number } {
    const z = this.kinds.get(type)?.kind.driver.z ?? -1;
    return { x: at.x + Math.sin(at.heading) * z, z: at.z + Math.cos(at.heading) * z };
  }

  /**
   * Техника из движущихся: каждая — своим видом, вилы — на своём ярусе. `scale` — общий масштаб: при смене крупности показа
   * техника уходит в пол (0 — не рисуется).
   */
  set(list: readonly Machine[], scale = 1) {
    const count = new Map<Part, number>();
    for (const v of scale > 0.01 ? list : []) {
      const k = this.kinds.get(v.type);
      if (!k) continue;
      const fy = forkY(v.fork);
      // внутренняя мачта выходит, когда каретка выше наружной мачты
      const mastUp = Math.max(0, fy + 1.05 - 2.7);
      this.q.setFromAxisAngle(this.up, v.heading);
      for (const part of k.parts) {
        let n = count.get(part) ?? 0;
        for (const [x, y, z, sx, sy, sz, lift] of part.pieces) {
          if (n >= MAX * part.pieces.length) break;
          const dy = lift === 'fork' ? fy : lift === 'mast' ? mastUp : 0;
          this.o.set(x, y + dy, z).multiplyScalar(scale).applyQuaternion(this.q);
          this.p.set(v.x + this.o.x, this.o.y, v.z + this.o.z);
          this.m.compose(this.p, this.q, this.s.set(sx * scale, sy * scale, sz * scale));
          part.mesh.setMatrixAt(n++, this.m);
        }
        count.set(part, n);
      }
    }
    for (const { parts } of this.kinds.values()) {
      for (const part of parts) {
        part.mesh.count = count.get(part) ?? 0;
        part.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
