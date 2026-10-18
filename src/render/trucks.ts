// Фуры у рамп (docs/specs/2026-10-view.md, 2а; docs/13-art.md, §7): модель кодом — тягач, полуприцеп без крыши (сверху
// видно паллеты в кузове), колёса; кузов открыт с торца — к воротам рампы. Закрытый кузов (docs/specs/2026-10-panels.md,
// 3а: фура поставщика до проверки, уходящая фура) — с крышей и дверями. Где фура во дворе — src/app/yard.ts. Пол кузова — на
// уровне пола склада, колёса — на асфальте двора ниже здания (world.ts, YARD_Y = −1,2 м). Части всех фур — по одной
// InstancedMesh на вид части.
import * as THREE from 'three';
import type { TruckPose } from '../app/yard';
import { TRAILER } from './layout';

/** Сколько фур рисуется самое большее. */
const MAX = 8;

interface Part {
  mesh: THREE.InstancedMesh;
  /** куски на одну фуру: середина и размер в осях фуры (x — от рампы наружу, y — вверх, z — поперёк), м */
  boxes: [number, number, number, number, number, number][];
  /** только у закрытого кузова: крыша и двери */
  closed?: boolean;
}

export class Trucks {
  readonly group = new THREE.Group();
  private parts: Part[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor() {
    const L = TRAILER.length;
    const W = TRAILER.width;
    const H = TRAILER.height;
    const t = 0.05;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const add = (color: number, boxes: Part['boxes'], rough = 0.6, metal = 0.1, closed = false) => {
      const mesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }), MAX * boxes.length);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.parts.push({ mesh, boxes, ...(closed ? { closed } : {}) });
    };
    // кузов: пол, борта и передняя стенка — светлые панели (крыши нет: сверху видно груз)
    add(0xd8dcdc, [
      [L / 2, -0.06, 0, L, 0.12, W],
      [L / 2, H / 2, W / 2 - t / 2, L, H, t],
      [L / 2, H / 2, -W / 2 + t / 2, L, H, t],
      [L - t / 2, H / 2, 0, t, H, W],
    ]);
    // рама, колёса и тягач — тёмные; кабина — приглушённая синяя, без марки
    add(0x2f3437, [
      [L / 2, -0.5, 0, L - 1, 0.5, W * 0.6],
      [L - 3.2, -0.75, W / 2 - 0.25, 1.3, 0.9, 0.35],
      [L - 3.2, -0.75, -W / 2 + 0.25, 1.3, 0.9, 0.35],
      [L + 1.2, -0.75, W / 2 - 0.25, 0.9, 0.9, 0.35],
      [L + 1.2, -0.75, -W / 2 + 0.25, 0.9, 0.9, 0.35],
      [L + 3.4, -0.75, W / 2 - 0.25, 0.9, 0.9, 0.35],
      [L + 3.4, -0.75, -W / 2 + 0.25, 0.9, 0.9, 0.35],
    ]);
    add(0x4a6378, [[L + 2.6, 0.5, 0, 2.3, 2.6, W]]);
    // закрытый кузов: крыша и две створки дверей — чуть темнее бортов, с полосой стыка
    add(0xd8dcdc, [[L / 2, H + t / 2, 0, L, t, W]], 0.6, 0.1, true);
    add(0xc2c8c9, [
      [t / 2, H / 2, W / 4 + 0.01, t, H, W / 2 - 0.02],
      [t / 2, H / 2, -W / 4 - 0.01, t, H, W / 2 - 0.02],
    ], 0.55, 0.15, true);
  }

  /**
   * Фуры в кадре (src/app/yard.ts): задний край кузова — в точке позы, кузов уходит в сторону −x (рампы прототипа — в
   * западной стене); у закрытого — крыша и двери.
   */
  set(poses: readonly TruckPose[]) {
    const list = poses.slice(0, MAX);
    for (const part of this.parts) {
      let n = 0;
      for (const at of list) {
        if (part.closed && !at.closed) continue;
        for (const [bx, by, bz, sx, sy, sz] of part.boxes) {
          this.p.set(at.x - bx, by, at.z + bz);
          this.m.compose(this.p, this.q, this.s.set(sx, sy, sz));
          part.mesh.setMatrixAt(n++, this.m);
        }
      }
      part.mesh.count = n;
      part.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
