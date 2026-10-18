// из bolnitsa: src/render/doors.ts @ e0a3491 — изменено: двери плана завода (layout.ts) вместо дверей больницы; ворота —
// откатные, рампа — секционные ворота, которые подняты, пока у рампы стоит фура; проём ленты — без створок; распашные двери
// открываются в сторону более высокого давления — в чистый и общий коридор (docs/10-domain.md, §4, `eaeu-hvac-2026`, п. 20),
// у прочих — внутрь помещения.
// Створка открывается, когда рядом кто-то идёт, и закрывается за ним; у камеры она срезается вместе со стенами. Все створки —
// одна InstancedMesh.
import * as THREE from 'three';
import type { Layout } from './layout';
import { cutAt, DOCK_H, GATE_H, WALL_LOW, type Walls } from './world';

const LEAF_H = 2.02;
const LEAF_T = 0.045;
/** Ближе этого к двери кто-то идёт — створка открыта, м. */
export const OPEN_NEAR = 1.25;

type Motion = 'swing' | 'slide' | 'lift';

interface Leaf {
  motion: Motion;
  /** петля (у откатных и подъёмных — начало проёма) */
  hx: number;
  hz: number;
  /** вдоль стены от петли (закрыта) */
  ax: number;
  az: number;
  /** куда открывается распашная */
  ix: number;
  iz: number;
  width: number;
  height: number;
  door: number;
}

export interface DoorState {
  cx: number;
  cz: number;
  /** наружу из здания (у внутренних — 0, 0) */
  ox: number;
  oz: number;
  open: number;
  leaves: number[];
  /** рампа: номер в `plant.docks` */
  dock?: number;
}

export interface Doors {
  mesh: THREE.InstancedMesh;
  doors: DoorState[];
  /** открыть и закрыть: распашные и ворота — по людям и технике рядом (`near`), рампы — по фурам; срезать у камеры */
  update(dt: number, near: (x: number, z: number, r: number) => boolean, docked: ReadonlySet<number>, walls: Walls['uniforms']): void;
}

/** Створки всех дверей: дверь — одна, двойная — две, ворота — откатное полотно, рампа — секционные ворота. */
export function leavesOf(l: Layout): { leaves: Leaf[]; doors: DoorState[] } {
  const leaves: Leaf[] = [];
  const doors: DoorState[] = [];
  l.doors.forEach((d, di) => {
    const alongX = d.along === 'x';
    const xs = d.cells.map(c => c[0]);
    const zs = d.cells.map(c => c[1]);
    // проём — от края первой клетки до края последней, по середине стены
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs) + 1;
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs) + 1;
    const cx = alongX ? (x0 + x1) / 2 : x0 + 0.5;
    const cz = alongX ? z0 + 0.5 : (z0 + z1) / 2;
    // наружу — в сторону улицы: у стены вдоль x — по z, у стены вдоль z — по x
    const outer = d.rooms.indexOf(-1);
    const sign = outer === 0 ? -1 : 1;
    const [ox, oz] = outer < 0 ? [0, 0] : alongX ? [0, sign] : [sign, 0];
    const state: DoorState = { cx, cz, ox, oz, open: 0, leaves: [] };
    if (d.kind === 'dock') state.dock = l.plan.plant.docks.findIndex(k => d.cells.some(([x, z]) => x === Math.floor(k.x / 100) && z === Math.floor(k.z / 100)));
    doors.push(state);
    if (d.kind === 'hatch') return;
    const frame = 0.07;
    const span = (alongX ? x1 - x0 : z1 - z0) - frame * 2;
    const [ax, az] = alongX ? [1, 0] : [0, 1];
    const start = alongX ? x0 + frame : z0 + frame;
    const at = (s: number): [number, number] => (alongX ? [s, cz] : [cx, s]);
    // распашная открывается в коридор, если он с одной из сторон; иначе — в помещение с большей координатой
    const corridor = d.rooms.findIndex(r => r >= 0 && l.rooms[r].type.startsWith('corridor'));
    const toward = corridor >= 0 ? (corridor === 0 ? -1 : 1) : 1;
    const [ix, iz] = alongX ? [0, toward] : [toward, 0];
    const make = (motion: Motion, hinge: number, dir: number, width: number, height: number) => {
      const [hx, hz] = at(hinge);
      state.leaves.push(leaves.length);
      leaves.push({ motion, hx, hz, ax: ax * dir, az: az * dir, ix, iz, width, height, door: di });
    };
    if (d.kind === 'dock') make('lift', start, 1, span, DOCK_H - 0.05);
    else if (d.kind === 'gate') make('slide', start, 1, span, GATE_H - 0.05);
    else if (d.cells.length === 1) make('swing', start, 1, span, LEAF_H);
    else {
      make('swing', start, 1, span / 2 - 0.01, LEAF_H);
      make('swing', start + span, -1, span / 2 - 0.01, LEAF_H);
    }
  });
  return { leaves, doors };
}

export function buildDoors(l: Layout): Doors {
  const { leaves, doors } = leavesOf(l);
  const geo = new THREE.BoxGeometry(1, 1, LEAF_T);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, leaves.length));
  mesh.name = 'door leaves';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = leaves.length;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // распашные — светлые панели; ворота и рампы — серые металлические
  const leafColor = new THREE.Color(0xdfe5e2);
  const gateColor = new THREE.Color(0x8c969b);
  leaves.forEach((lf, i) => mesh.setColorAt(i, lf.motion === 'swing' ? leafColor : gateColor));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const shown = new Float32Array(leaves.length * 2).fill(-1);
  const place = (i: number, open: number, cut: number) => {
    const lf = leaves[i];
    if (Math.abs(shown[i * 2] - open) < 1e-3 && Math.abs(shown[i * 2 + 1] - cut) < 1e-3) return false;
    shown[i * 2] = open;
    shown[i * 2 + 1] = cut;
    const k = 1 + (WALL_LOW / lf.height - 1) * cut;
    if (lf.motion === 'swing') {
      // направление створки от петли: закрыта — вдоль стены, открыта — в сторону открывания
      const angle = (open * Math.PI) / 2 * 0.95;
      const dx = Math.cos(angle) * lf.ax + Math.sin(angle) * lf.ix;
      const dz = Math.cos(angle) * lf.az + Math.sin(angle) * lf.iz;
      q.setFromAxisAngle(up, Math.atan2(-dz, dx));
      p.set(lf.hx + (dx * lf.width) / 2, (lf.height * k) / 2, lf.hz + (dz * lf.width) / 2);
      s.set(lf.width, lf.height * k, 1);
    } else if (lf.motion === 'slide') {
      // откатные ворота уходят вдоль стены за проём
      q.setFromAxisAngle(up, Math.atan2(-lf.az, lf.ax));
      const off = open * lf.width;
      p.set(lf.hx + lf.ax * (lf.width / 2 + off), (lf.height * k) / 2, lf.hz + lf.az * (lf.width / 2 + off));
      s.set(lf.width, lf.height * k, 1);
    } else {
      // секционные ворота рампы поднимаются под перемычку
      q.setFromAxisAngle(up, Math.atan2(-lf.az, lf.ax));
      const hgt = Math.max(0.05, lf.height * (1 - open * 0.92)) * k;
      p.set(lf.hx + (lf.ax * lf.width) / 2, lf.height * k - hgt / 2, lf.hz + (lf.az * lf.width) / 2);
      s.set(lf.width, hgt, 1);
    }
    mesh.setMatrixAt(i, m.compose(p, q, s));
    return true;
  };
  leaves.forEach((_, i) => place(i, 0, 0));
  return {
    mesh,
    doors,
    update(dt, near, docked, walls) {
      let changed = false;
      for (const d of doors) {
        if (!d.leaves.length) continue;
        const target = d.dock !== undefined ? (docked.has(d.dock) ? 1 : 0) : near(d.cx, d.cz, OPEN_NEAR) ? 1 : 0;
        d.open += (target - d.open) * Math.min(1, dt * (d.dock !== undefined ? 2 : 7));
        if (Math.abs(target - d.open) < 0.01) d.open = target;
        const cut = cutAt(walls, d.cx, d.cz, d.ox, d.oz);
        for (const i of d.leaves) changed = place(i, d.open, cut) || changed;
      }
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
