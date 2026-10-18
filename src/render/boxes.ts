// Оборудование и машины линии до моделей (docs/specs/2026-10-view.md, 2а): короба по размеру из записи вида, на своём месте
// и с поворотом по плану. След на полу у них уже настоящий — по нему обходят люди и техника (nav.ts); модели кодом из данных
// придут в 2в (docs/13-art.md, §8). Все короба — одна InstancedMesh: нержавейка оборудования и светлые машины линии.
import * as THREE from 'three';
import type { ContentDb } from '../content/types';
import type { Layout } from './layout';

export function buildBoxes(l: Layout, db: ContentDb): THREE.InstancedMesh {
  const items: { at: [number, number]; turn: number; size: [number, number, number]; machine: boolean }[] = [
    ...l.plan.plant.equipment.map(e => ({ at: e.at, turn: e.turn, size: db.equipment[e.type].size, machine: false })),
    ...l.plan.plant.lines.flatMap(ln => ln.machines.map(m => ({ at: m.at, turn: m.turn, size: db.machines[m.type].size, machine: true }))),
  ];
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.35 }), Math.max(1, items.length));
  mesh.count = items.length;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'equipment boxes';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const steel = new THREE.Color(0xb7c0c4);
  const machine = new THREE.Color(0xd2d8dc);
  items.forEach((it, i) => {
    const [w, d, h] = it.size.map(v => v / 100);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (it.turn * Math.PI) / 2);
    m.compose(new THREE.Vector3(it.at[0] / 100, h / 2, it.at[1] / 100), q, new THREE.Vector3(w, h, d));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, it.machine ? machine : steel);
  });
  return mesh;
}
