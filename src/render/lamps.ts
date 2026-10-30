// из bolnitsa: src/render/lamps.ts @ e0a3491 — изменено: помещения плана завода (layout.ts); у склада — подвесные
// светильники под высоким потолком через 6 м, у остальных — панели через 3 м; коридоры завода — помещения, их ряд — по
// середине; светильник ставится только на клетку своего помещения (пробоотборная, холод и отклонённое — внутри зала склада).
// Видимые панели под потолком и свет от них — пятна на полу (карта света пола, второй набор координат), без источников с
// тенями: тени даёт только солнце. Панели у камеры срезаются вместе со стенами (`cutAt`), в режиме «вниз» их нет.
import * as THREE from 'three';
import { type Layout, roomHeight, TALL } from './layout';
import { cutAt, type Walls } from './world';

export interface Lamps {
  /** корпус и рассеиватель — две InstancedMesh в одной группе */
  mesh: THREE.Group;
  /** карта света пола: по участку, 8 точек на метр */
  lightMap: THREE.CanvasTexture;
  points: { x: number; z: number }[];
  material: THREE.MeshStandardMaterial;
  /** панели у камеры прячутся, как срезанные стены; издалека (общий план) — тоже: там они только рябят */
  update(walls: Walls['uniforms'], half: number): void;
  /** сила света по часу: днём слабее (светло и так), вечером и ночью сильнее */
  setHour(hour: number, materials: THREE.MeshStandardMaterial[]): void;
}

/** Светящаяся панель светильника, м: квадрат в тёмной рамке (`buildLamps`). */
export const LAMP_GLOW = 0.58;

/** Цвет света (docs/13-art.md, §5): чистые зоны — ровный холодно-белый, склад — нейтральный, вспомогательные — тёплый. */
export function lampTint(r: { type: string; grade: 'D' | 'cnc' }): [number, number, number] {
  return r.grade === 'D' ? [236, 246, 255] : TALL.has(r.type) ? [246, 246, 240] : [255, 240, 214];
}

/** Высота светильника, м: панель — под потолком помещения, подвесной у склада — ниже. */
export function lampHeight(l: Layout, pt: { x: number; z: number; room: number }): number {
  return roomHeight(l, Math.floor(pt.x), Math.floor(pt.z)) - (TALL.has(l.rooms[pt.room].type) ? 0.6 : 0.08);
}

/**
 * Пятно света светильника на карте света пола: радиус, м; доля цвета светильника у середины, на 0,55 радиуса и у края;
 * пятно — не ближе `inset` м к осям стен своего помещения.
 */
export const POOL = { radius: { tall: 4.4, room: 2.6 }, stops: [[0, 0.55], [0.55, 0.25], [1, 0]], inset: 0.9 } as const;

/**
 * Карта света пола в точке — то, что рисует холст `buildLamps`: пятна светильников, чьё помещение накрывает точку, сложены
 * и обрезаны сверху; sRGB 0…1. Для запечки света помещения в Blender (tools/blender/scene.ts): её пол светит в среднем так
 * же, как пятна соседей.
 */
export function poolAt(l: Layout, pts: readonly { x: number; z: number; room: number }[], x: number, z: number): [number, number, number] {
  const sum = [0, 0, 0];
  for (const p of pts) {
    const r = l.rooms[p.room];
    if (x < r.x + POOL.inset || x > r.x + r.w - POOL.inset || z < r.z + POOL.inset || z > r.z + r.d - POOL.inset) continue;
    const t = Math.hypot(x - p.x, z - p.z) / (TALL.has(r.type) ? POOL.radius.tall : POOL.radius.room);
    if (t >= 1) continue;
    const k = POOL.stops.findIndex(([at]) => at > t);
    const [t0, a0] = POOL.stops[k - 1];
    const [t1, a1] = POOL.stops[k];
    const a = a0 + ((a1 - a0) * (t - t0)) / (t1 - t0);
    const tint = lampTint(r);
    for (let c = 0; c < 3; c++) sum[c] += (tint[c] / 255) * a;
  }
  return sum.map(v => Math.min(1, v)) as [number, number, number];
}

/** Где висят светильники: сеткой внутри помещения — у склада через 6 м, у прочих через 3 м. */
export function lampPoints(l: Layout): { x: number; z: number; room: number }[] {
  const out: { x: number; z: number; room: number }[] = [];
  l.rooms.forEach((r, n) => {
    const iw = r.w - 2;
    const ih = r.d - 2;
    const step = TALL.has(r.type) ? 6 : 3;
    const nx = Math.max(1, Math.round(iw / step));
    const nz = Math.max(1, Math.round(ih / step));
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const x = r.x + 1 + (iw * (i + 0.5)) / nx;
        const z = r.z + 1 + (ih * (k + 0.5)) / nz;
        if (l.nav.room[Math.floor(z) * l.w + Math.floor(x)] !== n) continue;
        out.push({ x, z, room: n });
      }
    }
  });
  return out;
}

export function buildLamps(l: Layout): Lamps {
  const pts = lampPoints(l);
  const { w, h } = l;
  // пятна света: в помещении — не дальше его стен
  const px = 8;
  const c = document.createElement('canvas');
  c.width = w * px;
  c.height = h * px;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'lighter';
  for (const p of pts) {
    g.save();
    const r = l.rooms[p.room];
    g.beginPath();
    g.rect((r.x + POOL.inset) * px, (r.z + POOL.inset) * px, (r.w - 2 * POOL.inset) * px, (r.d - 2 * POOL.inset) * px);
    g.clip();
    const rad = (TALL.has(r.type) ? POOL.radius.tall : POOL.radius.room) * px;
    const grd = g.createRadialGradient(p.x * px, p.z * px, 0, p.x * px, p.z * px, rad);
    const tint = lampTint(r).join(',');
    for (const [at, a] of POOL.stops) grd.addColorStop(at, `rgba(${tint},${a})`);
    g.fillStyle = grd;
    g.fillRect(p.x * px - rad, p.z * px - rad, rad * 2, rad * 2);
    g.restore();
  }
  const lightMap = new THREE.CanvasTexture(c);
  lightMap.channel = 1;
  lightMap.colorSpace = THREE.SRGBColorSpace;

  // светильник — квадратная светящаяся панель 0,58 м в тёмной рамке: сверху (потолка в разрезе нет) видна светящаяся
  // сторона; у склада — круглый подвесной под потолком, крупнее
  const body = new THREE.BoxGeometry(0.68, 0.03, 0.68);
  const glow = new THREE.BoxGeometry(LAMP_GLOW, 0.036, LAMP_GLOW);
  const material = new THREE.MeshStandardMaterial({ color: 0xfff6e8, emissive: 0xffeed2, emissiveIntensity: 1, roughness: 0.3 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x9aa4a8, roughness: 0.5, metalness: 0.3 });
  const shell = new THREE.InstancedMesh(body, frameMat, Math.max(1, pts.length));
  const light = new THREE.InstancedMesh(glow, material, Math.max(1, pts.length));
  shell.count = light.count = pts.length;
  shell.name = 'lamp frames';
  light.name = 'lamp panels';
  const mesh = new THREE.Group();
  mesh.add(shell, light);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const zero = new THREE.Vector3(0, 0, 0);
  const straight = new THREE.Quaternion();
  const size = pts.map(pt => (TALL.has(l.rooms[pt.room].type) ? new THREE.Vector3(1.4, 1, 1.4) : new THREE.Vector3(1, 1, 1)));
  // срезаются по помещению целиком: по его середине — иначе в полусрезанной комнате часть панелей висела бы в воздухе
  const anchor = pts.map(pt => {
    const r = l.rooms[pt.room];
    return { x: r.x + r.w / 2, z: r.z + r.d / 2 };
  });
  const set = (i: number, on: boolean) => {
    m.compose(p.set(pts[i].x, lampHeight(l, pts[i]), pts[i].z), straight, on ? size[i] : zero);
    shell.setMatrixAt(i, m);
    light.setMatrixAt(i, m);
  };
  pts.forEach((_, i) => set(i, true));
  shell.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  light.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const shown = new Uint8Array(pts.length).fill(1);
  return {
    mesh,
    lightMap,
    points: pts,
    material,
    update(u, half) {
      let changed = false;
      const far = half > 15;
      pts.forEach((_, i) => {
        const on = !far && cutAt(u, anchor[i].x, anchor[i].z) < 0.02 ? 1 : 0;
        if (on === shown[i]) return;
        shown[i] = on;
        set(i, on === 1);
        changed = true;
      });
      if (changed) {
        shell.instanceMatrix.needsUpdate = true;
        light.instanceMatrix.needsUpdate = true;
      }
    },
    setHour(hour, materials) {
      // вечером (после 18) и ночью свет сильнее; днём пятна чуть заметны
      const evening = hour >= 18 ? Math.min(1, (hour - 18) / 2) : hour < 7 ? 1 : 0;
      const k = 0.35 + 0.9 * evening;
      for (const mat of materials) mat.lightMapIntensity = k;
      material.emissiveIntensity = 0.7 + 0.6 * evening;
    },
  };
}
