// Грузы на паллетах и стеллажи (docs/02-architecture.md, §10; геймдизайн, §19.2): экземпляры по виду — основание
// паллеты, гофроящик, бочка, мешок, рулон; ярлык статуса — цветная плашка на торце паллеты. Сколько тары в учёте, столько
// и на паллете: раскладка — по схеме укладки, заполнение — по счётчику. Процессор тратится только когда список паллет
// изменился, а не каждый кадр.
import * as THREE from 'three';

export type Load = 'cases' | 'drums' | 'bags' | 'rolls';
export type Tag = 'quarantine' | 'sampled' | 'released' | 'rejected' | 'blocked';

export interface PalletView {
  /** центр паллеты на полу, м */
  x: number;
  z: number;
  /** высота основания: пол — 0, ярус стеллажа — его высота */
  y: number;
  /** длинная сторона паллеты (120 см) — вдоль x (0) или вдоль z (1) */
  turn: 0 | 1;
  load: Load;
  /** сколько тары на паллете: ящиков, бочек, мешков, рулонов */
  fill: number;
  tag: Tag;
  plastic?: boolean;
  /** номер паллеты в срезе — для выбора щелчком (3б); у паллет бенча нет */
  unit?: number;
}

/** Схемы укладки на паллету 120 × 80 (выбор геймдизайна; размеры тары — content/units, content/containers). */
const PATTERN: Record<Load, { per: number; layers: number; size: [number, number, number]; cols: number; rows: number }> = {
  // гофроящик 40 × 30 × 25: 4 вдоль длинной стороны (по 30) × 2 вдоль короткой (по 40) = 8 на слой, 5 слоёв
  cases: { per: 8, layers: 5, size: [0.3, 0.25, 0.4], cols: 4, rows: 2 },
  // фибровая бочка: 2 × 2, один ярус
  drums: { per: 4, layers: 1, size: [0.5, 0.7, 0.5], cols: 2, rows: 2 },
  // мешок 25 кг (60 × 40 см): 2 × 2 на слой — упрощение «ёлочки», 8 слоёв
  bags: { per: 4, layers: 8, size: [0.58, 0.14, 0.38], cols: 2, rows: 2 },
  // рулон фольги стоя: 4 × 2, до 3 слоёв
  rolls: { per: 8, layers: 3, size: [0.28, 0.3, 0.28], cols: 4, rows: 2 },
};

export const TAG_COLOR: Record<Tag, number> = {
  quarantine: 0xe7b416,
  sampled: 0xd9a514,
  released: 0x4caf6e,
  rejected: 0xd8392b,
  blocked: 0x8a949a,
};

const PALLET: [number, number, number] = [1.2, 0.144, 0.8];

/**
 * Высота паллеты с грузом, м: основание и столько слоёв тары, сколько её на паллете по схеме укладки, — как её рисует
 * `Loads` (для выбора щелчком, src/app/pick.ts).
 */
export function palletHeight(load: Load, fill: number): number {
  const pat = PATTERN[load];
  const layers = Math.min(pat.layers, Math.ceil(Math.max(0, fill) / pat.per));
  return PALLET[1] + layers * pat.size[1];
}

export class Loads {
  readonly group = new THREE.Group();
  private bases: THREE.InstancedMesh;
  private plastic: THREE.InstancedMesh;
  private items: Record<Load, THREE.InstancedMesh>;
  private tags: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private color = new THREE.Color();

  constructor(readonly capacity: number) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const wood = new THREE.MeshStandardMaterial({ color: 0xb48a5a, roughness: 0.9 });
    const plast = new THREE.MeshStandardMaterial({ color: 0x3f6f8f, roughness: 0.6 });
    this.bases = this.mesh(box, wood, capacity);
    this.plastic = this.mesh(box, plast, capacity);
    const card = new THREE.MeshStandardMaterial({ color: 0xc9a46c, roughness: 0.85 });
    const drum = new THREE.MeshStandardMaterial({ color: 0x2f5e8c, roughness: 0.5 });
    const bag = new THREE.MeshStandardMaterial({ color: 0xecebe4, roughness: 0.95 });
    const roll = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.25, metalness: 0.8 });
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
    // мешок — сплюснутый эллипсоид: размеры экземпляра и есть его размеры
    const sack = new THREE.SphereGeometry(0.5, 14, 8);
    this.items = {
      cases: this.mesh(box, card, capacity * PATTERN.cases.per * PATTERN.cases.layers),
      drums: this.mesh(cyl, drum, capacity * PATTERN.drums.per),
      bags: this.mesh(sack, bag, capacity * PATTERN.bags.per * PATTERN.bags.layers),
      rolls: this.mesh(cyl, roll, capacity * PATTERN.rolls.per * PATTERN.rolls.layers),
    };
    // ярлык формата A5 — на обоих торцах: паллету видно с любой стороны прохода
    this.tags = this.mesh(new THREE.PlaneGeometry(0.21, 0.15), new THREE.MeshBasicMaterial({ color: 0xffffff }), capacity * 2);
    this.tags.castShadow = false;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, n: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    m.count = 0;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    this.group.add(m);
    return m;
  }

  /** Поставить паллеты: основание, тару по схеме, ярлык. */
  set(list: readonly PalletView[]) {
    const n = Math.min(list.length, this.capacity);
    let woods = 0;
    let plastics = 0;
    const counts: Record<Load, number> = { cases: 0, drums: 0, bags: 0, rolls: 0 };
    for (let i = 0; i < n; i++) {
      const p = list[i];
      const yaw = p.turn === 1 ? Math.PI / 2 : 0;
      this.q.setFromEuler(this.e.set(0, yaw, 0));
      // основание
      this.m.compose(new THREE.Vector3(p.x, p.y + PALLET[1] / 2, p.z), this.q, new THREE.Vector3(...PALLET));
      if (p.plastic) this.plastic.setMatrixAt(plastics++, this.m);
      else this.bases.setMatrixAt(woods++, this.m);
      // тара по схеме: сначала нижний слой, ряд за рядом
      const pat = PATTERN[p.load];
      const [sx, sy, sz] = pat.size;
      const total = Math.min(p.fill, pat.per * pat.layers);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      for (let k = 0; k < total; k++) {
        const layer = Math.floor(k / pat.per);
        const inLayer = k % pat.per;
        const col = inLayer % pat.cols;
        const row = Math.floor(inLayer / pat.cols) % pat.rows;
        // место на паллете в её осях: x — вдоль 120 см, z — вдоль 80 см
        const lx = (col + 0.5) * (PALLET[0] / pat.cols) - PALLET[0] / 2;
        const lz = (row + 0.5) * (PALLET[2] / pat.rows) - PALLET[2] / 2;
        const wx = p.x + lx * cos + lz * sin;
        const wz = p.z - lx * sin + lz * cos;
        const wy = p.y + PALLET[1] + layer * sy + sy / 2;
        this.m.compose(new THREE.Vector3(wx, wy, wz), this.q, new THREE.Vector3(sx * 0.97, sy * 0.98, sz * 0.97));
        this.items[p.load].setMatrixAt(counts[p.load]++, this.m);
      }
      // ярлык статуса — на обоих торцах короткой стороны, у основания груза
      for (const side of [1, -1]) {
        const tx = p.x + side * (PALLET[0] / 2 + 0.002) * cos;
        const tz = p.z - side * (PALLET[0] / 2 + 0.002) * sin;
        this.q.setFromEuler(this.e.set(0, yaw + (side * Math.PI) / 2, 0));
        this.m.compose(new THREE.Vector3(tx, p.y + PALLET[1] + 0.12, tz), this.q, new THREE.Vector3(1, 1, 1));
        const k = 2 * i + (side === 1 ? 0 : 1);
        this.tags.setMatrixAt(k, this.m);
        this.tags.setColorAt(k, this.color.set(TAG_COLOR[p.tag]));
      }
    }
    this.bases.count = woods;
    this.plastic.count = plastics;
    for (const k of Object.keys(this.items) as Load[]) this.items[k].count = counts[k];
    this.tags.count = 2 * n;
    for (const m of [this.bases, this.plastic, this.tags, ...Object.values(this.items)]) m.instanceMatrix.needsUpdate = true;
    if (this.tags.instanceColor) this.tags.instanceColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- стеллажи

export interface RackRow {
  /** начало ряда (левый передний угол), м */
  x: number;
  z: number;
  /** секций вдоль x */
  bays: number;
  /** ярусов, считая пол */
  levels: number;
}

/** Секция фронтального стеллажа: 2,7 м — три паллеты короткой стороной к проходу; глубина — 1,1 м; ярус — 1,5 м. */
export const BAY = { w: 2.7, d: 1.1, h: 1.5, slots: 3 } as const;

/** Места паллет в рядах: центр, высота основания, поворот (длинная сторона — вглубь стеллажа). */
export function slotsOf(rows: readonly RackRow[]): { x: number; z: number; y: number }[] {
  const out: { x: number; z: number; y: number }[] = [];
  for (const r of rows) {
    for (let b = 0; b < r.bays; b++) {
      for (let lv = 0; lv < r.levels; lv++) {
        for (let s = 0; s < BAY.slots; s++) {
          out.push({ x: r.x + b * BAY.w + (s + 0.5) * (BAY.w / BAY.slots), z: r.z + BAY.d / 2, y: lv * BAY.h + (lv > 0 ? 0.12 : 0) });
        }
      }
    }
  }
  return out;
}

/** Стойки (синие) и балки (оранжевые) — две InstancedMesh на все ряды. */
export function buildRacks(rows: readonly RackRow[]): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const posts: THREE.Matrix4[] = [];
  const beams: THREE.Matrix4[] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const q = new THREE.Quaternion();
  for (const r of rows) {
    const height = (r.levels - 1) * BAY.h + 0.4;
    for (let b = 0; b <= r.bays; b++) {
      for (const dz of [0.05, BAY.d - 0.05]) {
        posts.push(new THREE.Matrix4().compose(v(r.x + b * BAY.w, height / 2, r.z + dz), q, v(0.09, height, 0.07)));
      }
    }
    for (let b = 0; b < r.bays; b++) {
      for (let lv = 1; lv < r.levels; lv++) {
        for (const dz of [0.05, BAY.d - 0.05]) {
          beams.push(new THREE.Matrix4().compose(v(r.x + (b + 0.5) * BAY.w, lv * BAY.h + 0.06, r.z + dz), q, v(BAY.w - 0.09, 0.12, 0.05)));
        }
      }
    }
  }
  const add = (list: THREE.Matrix4[], color: number) => {
    const m = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.3 }), Math.max(1, list.length));
    list.forEach((x, i) => m.setMatrixAt(i, x));
    m.count = list.length;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  add(posts, 0x2d5d9a);
  add(beams, 0xe0782a);
  return g;
}
