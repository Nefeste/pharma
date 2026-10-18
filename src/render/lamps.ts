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
    g.rect((r.x + 0.9) * px, (r.z + 0.9) * px, (r.w - 1.8) * px, (r.d - 1.8) * px);
    g.clip();
    const tall = TALL.has(r.type);
    const rad = (tall ? 4.4 : 2.6) * px;
    const grd = g.createRadialGradient(p.x * px, p.z * px, 0, p.x * px, p.z * px, rad);
    // чистые зоны — ровный холодно-белый свет, склад — нейтральный, вспомогательные — тёплый (docs/13-art.md, §5)
    const tint = r.grade === 'D' ? '236,246,255' : tall ? '246,246,240' : '255,240,214';
    grd.addColorStop(0, `rgba(${tint},0.55)`);
    grd.addColorStop(0.55, `rgba(${tint},0.25)`);
    grd.addColorStop(1, `rgba(${tint},0)`);
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
  const glow = new THREE.BoxGeometry(0.58, 0.036, 0.58);
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
    const top = roomHeight(l, Math.floor(pts[i].x), Math.floor(pts[i].z));
    m.compose(p.set(pts[i].x, top - (TALL.has(l.rooms[pts[i].room].type) ? 0.6 : 0.08), pts[i].z), straight, on ? size[i] : zero);
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
