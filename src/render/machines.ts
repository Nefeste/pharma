// Оборудование и машины линии моделями кодом из записей (docs/specs/2026-10-view.md, 2в; docs/13-art.md, §8–9): части
// модели (`model` у вида оборудования и машины) — корпуса, окна, роторы, бункеры, панели, ленты. Неподвижные части всех
// машин слиты по цвету — несколько вызовов отрисовки на завод; ротор крутится и кожух открывается своей сеткой. Над каждой
// машиной — лампа состояния: цвет и значок. На лентах — блистеры, пачки и ящики; в накопителе между машинами — та же доля,
// что в движке. Скорость ленты на экране — не быстрее `BELT_MAX`: на ×1 и быстрее лента течёт, а не мелькает.
//
// Модель из Blender (#109, src/app/art.ts): у вида записи есть узел .glb — часть с именем берёт его узел с тем же именем
// из файла (`userData.name`: фаски, детали, запечённое затенение); неподвижные узлы всех машин слиты по своим материалам —
// материалы у машин общие, — ротор, кожух и рулоны — в своих шарнирах, как части кода. Лампа, значок, ленты — те же; под
// лампой у модели из Blender — стойка (`lampAt`).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ContentDb, ModelPart, Sku } from '../content/types';
import type { EquipmentRow, LineRow } from '../sim/pack';
import { nodeName } from './blender';
import { inkOf } from './color';
import { beltOffsets, beltSpeed, bufferCount, type Lamp, LAMP_COLOR, lampOfEquipment, lampOfMachine, PITCH } from './flow';
import type { Layout } from './layout';

/** Отделка (`13-art.md`, §5): матовая нержавейка, белые панели, тёмные панели управления; плёнка, фольга, гофрокартон. */
export const FINISH: Record<NonNullable<ModelPart['color']>, { color: number; rough: number; metal: number; opacity?: number }> = {
  white: { color: 0xe6e9ea, rough: 0.6, metal: 0.05 },
  steel: { color: 0xb3b9bd, rough: 0.35, metal: 0.7 },
  grey: { color: 0x8c949a, rough: 0.55, metal: 0.3 },
  dark: { color: 0x2f353a, rough: 0.5, metal: 0.2 },
  blue: { color: 0x3f6f9f, rough: 0.5, metal: 0.2 },
  film: { color: 0xdbe6ec, rough: 0.2, metal: 0, opacity: 0.75 },
  foil: { color: 0xc4c9ce, rough: 0.25, metal: 0.85 },
  card: { color: 0xc49a62, rough: 0.9, metal: 0 },
};

/** Резина ленты и стекло кожухов. */
const BELT = { color: 0x2a2f33, rough: 0.8, metal: 0 };
export const GLASS = { color: 0xbcd6e2, rough: 0.1, metal: 0, opacity: 0.28 };

/** Штуки на ленте: размер, м, и отделка. */
const ITEM: Record<'blister' | 'carton' | 'case', { size: [number, number, number]; finish: { color: number; rough: number; metal: number } }> = {
  blister: { size: [0.1, 0.012, 0.055], finish: { color: 0xd3d7db, rough: 0.3, metal: 0.7 } },
  carton: { size: [0.12, 0.03, 0.075], finish: { color: 0xf1f1ec, rough: 0.7, metal: 0 } },
  case: { size: [0.4, 0.25, 0.3], finish: { color: 0xc49a62, rough: 0.9, metal: 0 } },
};

/** Сколько штук одного вида рисуется на всех лентах и в накопителях; сколько полос — на всех лентах. */
const MAX_ITEMS = 400;
const MAX_BANDS = 64;

/** Что показывать на лентах (крупность показа, detail.ts): штуки, полосы на лентах машин, полосы в накопителях — 0…1. */
export interface BeltShown {
  items: number;
  bands: number;
  buffers: number;
}
/** Лампа: высота над машиной, размер; значок — над лампой. */
const LAMP_H = 0.22;
const ICON = 0.3;
/**
 * Где низ лампы состояния машины со следом W × D × H м (оси машины): на заднем правом углу, на высоте следа. Модель из
 * Blender ставит под неё стойку сигнальной колонны (tools/blender/scene.ts, blender/lib.py `pole`).
 */
export const lampAt = (W: number, D: number, H: number): [number, number, number] => [W / 2 - 0.15, H, -D / 2 + 0.15];

/** Лента на экране: начало (вход), направление потока, длина; что везёт; чья. */
interface Belt {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
  item: 'blister' | 'carton' | 'case';
  /** машина линии: номер линии и машины; накопитель — после какой машины */
  line: number;
  machine: number;
  buffer: boolean;
  phase: number;
}

/** Подвижная часть: ротор крутится, кожух открывается. */
interface Moving {
  pivot: THREE.Object3D;
  spin?: THREE.Vector3;
  /** скорость ротора на ходу, рад/с */
  omega: number;
  cover: boolean;
  open: number;
}

interface Unit {
  /** оборудование участка — номер в плане; машина линии — линия и машина */
  eq?: number;
  line?: number;
  machine?: number;
  moving: Moving[];
  lamp: THREE.Mesh;
  icon: THREE.Sprite;
  shown?: Lamp;
}

const finishOf = (f: { color: number; rough: number; metal: number; opacity?: number }) =>
  new THREE.MeshStandardMaterial({
    color: f.color,
    roughness: f.rough,
    metalness: f.metal,
    ...(f.opacity !== undefined ? { transparent: true, opacity: f.opacity, depthWrite: false } : {}),
  });

/** Геометрия части в её осях (середина — в нуле). */
function partGeometry(p: ModelPart): THREE.BufferGeometry {
  if (p.shape === 'cyl') {
    const axis = p.axis ?? 'y';
    const len = axis === 'y' ? p.h : axis === 'x' ? p.w : p.d;
    const dia = axis === 'y' ? p.w : axis === 'x' ? p.h : p.w;
    const g = new THREE.CylinderGeometry(dia / 2, dia / 2, len, 24);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    return g;
  }
  if (p.shape === 'cone') return new THREE.CylinderGeometry(p.w / 2, (p.bottom ?? p.w) / 2, p.h, 24);
  return new THREE.BoxGeometry(p.w, p.h, p.d);
}

/**
 * Значок лампы — маленький холст: треугольник, пауза, квадрат, восклицание, ключ, капля, галочка (калибровка или
 * квалификация, Б3в), круг; на светлой лампе — тёмный.
 */
function iconTexture(lamp: Lamp): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = `#${LAMP_COLOR[lamp].toString(16).padStart(6, '0')}`;
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  const ink = `#${inkOf(LAMP_COLOR[lamp]).toString(16).padStart(6, '0')}`;
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.beginPath();
  if (lamp === 'run') {
    g.moveTo(24, 18);
    g.lineTo(46, 32);
    g.lineTo(24, 46);
    g.closePath();
    g.fill();
  } else if (lamp === 'wait') {
    g.fillRect(21, 18, 8, 28);
    g.fillRect(35, 18, 8, 28);
  } else if (lamp === 'stop') {
    g.fillRect(20, 20, 24, 24);
  } else if (lamp === 'fail') {
    g.fillRect(28, 14, 8, 24);
    g.fillRect(28, 42, 8, 8);
  } else if (lamp === 'setup') {
    g.moveTo(20, 44);
    g.lineTo(38, 26);
    g.stroke();
    g.beginPath();
    g.arc(42, 22, 7, 0, Math.PI * 2);
    g.stroke();
  } else if (lamp === 'clean') {
    g.moveTo(32, 14);
    g.quadraticCurveTo(46, 32, 44, 38);
    g.arc(32, 38, 12, 0, Math.PI);
    g.quadraticCurveTo(18, 32, 32, 14);
    g.fill();
  } else if (lamp === 'check') {
    g.moveTo(18, 33);
    g.lineTo(28, 43);
    g.lineTo(46, 22);
    g.stroke();
  } else {
    g.arc(32, 32, 10, 0, Math.PI * 2);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Machines {
  readonly group = new THREE.Group();
  private units: Unit[] = [];
  private belts: Belt[] = [];
  private items: Record<'blister' | 'carton' | 'case', THREE.InstancedMesh>;
  /** полосы «потока»: на ленте машины — во всю ленту, в накопителе — на долю ёмкости */
  private bands: THREE.InstancedMesh;
  private c = new THREE.Color();
  private icons = new Map<Lamp, THREE.SpriteMaterial>();
  private lampMats = new Map<Lamp, THREE.MeshStandardMaterial>();
  /** ёмкость накопителей линий плана, штук: [линия][машина] */
  private caps: number[][];
  /** что считает машина линии — блистеры или пачки: [линия][машина] */
  private counts: ('blister' | 'carton' | 'case')[][];
  /** позиции — по номеру в базе, как в срезе */
  private skus: Sku[];
  /** сколько штук на лентах и в накопителях в последнем кадре — для сценария в браузере */
  itemsShown = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  /** сколько машин нарисовано моделью из Blender — для сценария в браузере и листа сравнения */
  readonly fromBlender: number;
  /** сетки и материалы, которые сделал этот вид (узлы .glb — общие, их освобождает не он) */
  private own: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private fin(f: Parameters<typeof finishOf>[0]) {
    const m = finishOf(f);
    this.mats.push(m);
    return m;
  }

  constructor(l: Layout, db: ContentDb, models: ReadonlyMap<string, THREE.Object3D> = new Map()) {
    const plant = l.plan.plant;
    const statics = new Map<string, THREE.BufferGeometry[]>();
    const add = (key: string, g: THREE.BufferGeometry) => {
      const list = statics.get(key) ?? [];
      list.push(g.index ? g.toNonIndexed() : g);
      statics.set(key, list);
    };
    // неподвижные узлы .glb — по их материалу
    const glbStatics = new Map<THREE.Material, THREE.BufferGeometry[]>();
    let blender = 0;
    const place = (model: ModelPart[], size: [number, number, number], at: [number, number], turn: number, unit: Omit<Unit, 'moving' | 'lamp' | 'icon'>, lineNo?: number, machineNo?: number, glb?: THREE.Object3D) => {
      const [W, D, H] = size.map(v => v / 100);
      const root = new THREE.Object3D();
      root.position.set(at[0] / 100, 0, at[1] / 100);
      root.rotation.y = (turn * Math.PI) / 2;
      root.updateMatrixWorld(true);
      const moving: Moving[] = [];
      if (glb) blender++;
      for (const p of model) {
        const node = glb && p.id ? glb.children.find(c => nodeName(c) === p.id) : undefined;
        if (p.shape === 'belt') {
          // лента: полотно и борта неподвижны, штуки едут от входа (+x модели) к выходу (−x)
          const g = new THREE.BoxGeometry(p.w, p.h, p.d);
          g.applyMatrix4(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)).applyMatrix4(root.matrixWorld);
          add('belt', g);
          const origin = new THREE.Vector3(p.x + p.w / 2, p.y + p.h / 2, p.z).applyMatrix4(root.matrixWorld);
          const dir = new THREE.Vector3(-1, 0, 0).applyQuaternion(root.quaternion);
          this.belts.push({ origin, dir, length: p.w, item: p.item!, line: lineNo ?? -1, machine: machineNo ?? -1, buffer: false, phase: 0 });
          continue;
        }
        if (node && !p.spin && !p.cover) {
          // неподвижный узел .glb: его сетки — на место в мире, к своим материалам
          node.traverse(o => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const g = m.geometry.clone().applyMatrix4(m.matrixWorld).applyMatrix4(root.matrixWorld);
            const mat = m.material as THREE.Material;
            glbStatics.set(mat, [...(glbStatics.get(mat) ?? []), g]);
          });
          continue;
        }
        if (p.spin || p.cover) {
          // подвижная часть — своя сетка в шарнире: ротор — вокруг своей середины, кожух — вокруг заднего верхнего ребра
          const pivot = new THREE.Object3D();
          let mesh: THREE.Object3D;
          if (node) {
            // узел .glb с деталями внутри (пуансоны ротора) — копия, сетки и материалы общие
            mesh = node.clone(true);
            mesh.position.set(0, 0, 0);
            mesh.traverse(o => {
              const m = o as THREE.Mesh;
              if (!m.isMesh) return;
              m.castShadow = !(m.material as THREE.Material).transparent;
              m.receiveShadow = true;
            });
          } else {
            const g = partGeometry(p);
            this.own.push(g);
            const code = new THREE.Mesh(g, p.shape === 'glass' ? this.fin(GLASS) : this.fin(FINISH[p.color ?? 'steel']));
            code.castShadow = p.shape !== 'glass';
            code.receiveShadow = true;
            mesh = code;
          }
          if (p.cover) {
            pivot.position.set(p.x, p.y + p.h / 2, p.z - p.d / 2);
            mesh.position.set(0, -p.h / 2, p.d / 2);
          } else pivot.position.set(p.x, p.y, p.z);
          pivot.add(mesh);
          root.add(pivot);
          const r = Math.max(0.1, Math.min(p.w, p.h, p.d) / 2);
          moving.push({ pivot, ...(p.spin ? { spin: new THREE.Vector3(p.spin === 'x' ? 1 : 0, p.spin === 'y' ? 1 : 0, p.spin === 'z' ? 1 : 0) } : {}), omega: Math.min(3, 0.8 / r), cover: !!p.cover, open: 0 });
          continue;
        }
        const g = partGeometry(p);
        g.applyMatrix4(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)).applyMatrix4(root.matrixWorld);
        add(p.shape === 'glass' ? 'glass' : (p.color ?? 'steel'), g);
      }
      // лампа — на углу крыши машины, значок — над ней
      const [lx, ly, lz] = lampAt(W, D, H);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, LAMP_H, 16), this.lampMat('off'));
      this.own.push(lamp.geometry);
      lamp.position.set(lx, ly + LAMP_H / 2, lz);
      root.add(lamp);
      const icon = new THREE.Sprite(this.iconMat('off'));
      icon.scale.set(ICON, ICON, 1);
      icon.position.set(lx, ly + LAMP_H + ICON / 2 + 0.05, lz);
      root.add(icon);
      this.group.add(root);
      this.units.push({ ...unit, moving, lamp, icon });
    };
    plant.equipment.forEach((e, i) => {
      const t = db.equipment[e.type];
      place(t.model, t.size, e.at, e.turn, { eq: i }, undefined, undefined, models.get(e.type));
    });
    this.caps = plant.lines.map(() => []);
    this.counts = plant.lines.map(ln => ln.machines.map(mc => db.machines[mc.type].item));
    this.skus = Object.values(db.skus);
    plant.lines.forEach((ln, li) => {
      ln.machines.forEach((mc, k) => {
        const t = db.machines[mc.type];
        place(t.model, t.size, mc.at, mc.turn, { line: li, machine: k }, li, k, models.get(mc.type));
      });
      // накопители — ленты между выходом машины и входом следующей, по ходу потока
      ln.machines.forEach((mc, k) => {
        const next = ln.machines[k + 1];
        if (!next) return;
        const a = db.machines[mc.type];
        const b = db.machines[next.type];
        const out = new THREE.Vector3(-a.size[0] / 200, 0, 0).applyAxisAngle(this.up, (mc.turn * Math.PI) / 2).add(new THREE.Vector3(mc.at[0] / 100, 0, mc.at[1] / 100));
        const inn = new THREE.Vector3(b.size[0] / 200, 0, 0).applyAxisAngle(this.up, (next.turn * Math.PI) / 2).add(new THREE.Vector3(next.at[0] / 100, 0, next.at[1] / 100));
        const length = out.distanceTo(inn);
        if (length < 0.2) return;
        const dir = inn.clone().sub(out).normalize();
        const y = 0.94;
        const g = new THREE.BoxGeometry(length, 0.04, 0.3);
        g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(-dir.z, dir.x)));
        g.applyMatrix4(new THREE.Matrix4().makeTranslation((out.x + inn.x) / 2, y - 0.02, (out.z + inn.z) / 2));
        add('belt', g);
        this.belts.push({ origin: new THREE.Vector3(out.x, y, out.z), dir, length, item: a.item, line: li, machine: k, buffer: true, phase: 0 });
        this.caps[li][k] = mc.buffer ?? 0;
      });
    });
    for (const [key, list] of statics) {
      const f = key === 'glass' ? GLASS : key === 'belt' ? BELT : FINISH[key as keyof typeof FINISH];
      const g = mergeGeometries(list);
      this.own.push(g);
      const mesh = new THREE.Mesh(g, this.fin(f));
      mesh.castShadow = key !== 'glass';
      mesh.receiveShadow = true;
      mesh.name = `machines ${key}`;
      this.group.add(mesh);
    }
    for (const [mat, list] of glbStatics) {
      const g = mergeGeometries(list);
      this.own.push(g, ...list);
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = !mat.transparent;
      mesh.receiveShadow = true;
      mesh.name = `machines blender ${mat.name}`;
      this.group.add(mesh);
    }
    this.fromBlender = blender;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const item = (k: 'blister' | 'carton' | 'case') => {
      const mesh = new THREE.InstancedMesh(box, this.fin(ITEM[k].finish), MAX_ITEMS);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.name = `belt ${k}`;
      this.group.add(mesh);
      return mesh;
    };
    this.items = { blister: item('blister'), carton: item('carton'), case: item('case') };
    this.bands = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3 }), MAX_BANDS);
    this.mats.push(this.bands.material as THREE.Material);
    this.bands.count = 0;
    this.bands.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bands.setColorAt(0, this.c.set(0xffffff));
    this.bands.frustumCulled = false;
    this.bands.name = 'belt bands';
    this.group.add(this.bands);
  }

  /** Освободить свои сетки: вид пересобирают (переключатель «Модели» — код или Blender). */
  dispose() {
    for (const g of this.own) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const m of this.lampMats.values()) m.dispose();
    for (const m of this.icons.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.items.blister.geometry.dispose();
  }

  /** Что показывают лампы — оборудование участков по порядку плана, затем машины линий: для сценария в браузере. */
  get lamps(): (Lamp | undefined)[] {
    return this.units.map(u => u.shown);
  }

  private lampMat(l: Lamp) {
    let m = this.lampMats.get(l);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: LAMP_COLOR[l], emissive: LAMP_COLOR[l], emissiveIntensity: l === 'off' ? 0.1 : 0.9, roughness: 0.4 });
      this.lampMats.set(l, m);
    }
    return m;
  }

  private iconMat(l: Lamp) {
    let m = this.icons.get(l);
    if (!m) {
      m = new THREE.SpriteMaterial({ map: iconTexture(l), depthTest: true, transparent: true });
      this.icons.set(l, m);
    }
    return m;
  }

  /**
   * Кадр: лампы по состоянию из среза, роторы на ходу, кожухи открыты на переналадке и уборке, штуки на лентах и в
   * накопителях. `gameRate` — игровых секунд в секунду: от неё скорость лент (не быстрее `BELT_MAX`). `shown` — крупность
   * показа: штуки по одной или полосой.
   */
  update(dt: number, gameRate: number, lines: readonly LineRow[], equipment: readonly EquipmentRow[], shown: BeltShown = { items: 1, bands: 0, buffers: 0 }) {
    for (const u of this.units) {
      let lamp: Lamp = 'off';
      let running = false;
      let open = false;
      if (u.eq !== undefined) {
        const st = equipment.find(e => e.eq === u.eq)?.state ?? 'idle';
        lamp = lampOfEquipment(st);
        running = st === 'run';
        open = st === 'clean';
      } else {
        const ln = lines.find(x => x.line === u.line);
        const mc = ln?.machines[u.machine!];
        if (ln && mc) {
          lamp = lampOfMachine(mc, ln);
          running = mc.state === 'run' || mc.state === 'slow';
          open = ln.changeover || ln.clearance;
        }
      }
      if (lamp !== u.shown) {
        u.shown = lamp;
        u.lamp.material = this.lampMat(lamp);
        u.icon.material = this.iconMat(lamp);
      }
      for (const mv of u.moving) {
        if (mv.spin && running && gameRate > 0) mv.pivot.rotateOnAxis(mv.spin, mv.omega * dt);
        if (mv.cover) {
          const target = open ? 1 : 0;
          mv.open += (target - mv.open) * Math.min(1, dt * 3);
          mv.pivot.rotation.x = -mv.open * 1.1;
        }
      }
    }
    const n = { blister: 0, carton: 0, case: 0 };
    let nb = 0;
    // полоса длиной `len` на ленте `b`: в накопителе — от входа следующей машины, на ленте машины — во всю ленту
    const band = (b: Belt, len: number, k: number) => {
      if (nb >= MAX_BANDS || len <= 0) return;
      const size = ITEM[b.item].size;
      this.p.copy(b.origin).addScaledVector(b.dir, b.length - len / 2);
      this.p.y += (size[1] * k) / 2;
      this.m.compose(this.p, this.q, this.s.set(len, size[1] * k, size[2] * k));
      this.bands.setMatrixAt(nb, this.m);
      this.bands.setColorAt(nb++, this.c.set(ITEM[b.item].finish.color));
    };
    for (const b of this.belts) {
      const ln = lines.find(x => x.line === b.line);
      const mc = ln?.machines[b.machine];
      const pitch = PITCH[b.item];
      const mesh = this.items[b.item];
      const size = ITEM[b.item].size;
      this.q.setFromAxisAngle(this.up, Math.atan2(-b.dir.z, b.dir.x));
      if (!ln || !mc || ln.batch < 0) continue;
      let offsets: number[];
      if (b.buffer) {
        // накопитель: штуки копятся у входа следующей машины — та же доля, что в движке
        const cap = this.caps[b.line][b.machine] ?? 0;
        const slots = Math.floor(b.length / pitch);
        const k = bufferCount(mc.fill, cap, slots);
        offsets = Array.from({ length: k }, (_, i) => b.length - pitch / 2 - i * pitch);
        if (shown.buffers > 0.01 && cap > 0 && mc.fill > 0) band(b, Math.min(1, mc.fill / cap) * b.length, shown.buffers);
      } else {
        if (mc.items <= 0) continue;
        // лента входа картонажной везёт блистеры: их идёт столько, сколько в пачке, на каждую пачку
        const sku = this.skus[ln.sku];
        const per = b.item === this.counts[b.line][b.machine] ? 1 : b.item === 'blister' && sku ? sku.blisters : 1;
        const v = mc.state === 'run' || mc.state === 'slow' ? beltSpeed(mc.rate * per, gameRate, pitch) : 0;
        b.phase = (b.phase + v * dt) % pitch;
        offsets = beltOffsets(b.length, pitch, b.phase);
        if (shown.bands > 0.01) band(b, b.length, shown.bands);
      }
      // штуки по одной: при смене крупности показа сжимаются к своей середине
      const k = shown.items;
      if (k <= 0.01) continue;
      this.s.set(size[0] * k, size[1] * k, size[2] * k);
      for (const d of offsets) {
        if (n[b.item] >= MAX_ITEMS) break;
        this.p.copy(b.origin).addScaledVector(b.dir, d);
        this.p.y += (size[1] * k) / 2;
        this.m.compose(this.p, this.q, this.s);
        mesh.setMatrixAt(n[b.item]++, this.m);
      }
    }
    for (const k of ['blister', 'carton', 'case'] as const) {
      this.items[k].count = n[k];
      this.items[k].instanceMatrix.needsUpdate = true;
    }
    this.bands.count = nb;
    this.bands.instanceMatrix.needsUpdate = true;
    if (this.bands.instanceColor) this.bands.instanceColor.needsUpdate = true;
    this.itemsShown = n.blister + n.carton + n.case;
  }
}
