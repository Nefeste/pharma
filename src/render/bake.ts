// из bolnitsa: src/render/bake.ts @ e0a3491
// из spikes/render-3d: src/assets.ts (люди: слияние частей, запекание анимаций, упрощение) — изменено: рост и пол — по
// позе «стоит» после скелета, а не по связанной позе в сжатых координатах; точки опоры сидя и лёжа; цвет одежды и кожи —
// на экземпляр; бег.
//
// Люди на видеокарте (spec docs/specs/2026-10-shell-3d.md, «Масштаб и опора»). При загрузке персонаж сливается в одну
// геометрию, а анимации проигрываются один раз и запекаются: матрицы суставов на каждый кадр (30 к/с) всех видов лежат в
// одной текстуре float. Вершинный шейдер (people.ts) смешивает кадры A и B. Чистый Three.js без DOM: то же запекание
// проверяют тесты в Bun (tools/test/people.test.ts).
//
// Почему опора — по позе после скелета. Модели сжаты (EXT_meshopt_compression, координаты — 16-битные целые): вершины
// лежат в пределах −1…1, а переход к настоящим размерам спрятан в обратных связанных матрицах. Поза из анимации живёт в
// других координатах, чем связанная поза. Проба мерила рост и пол по связанной позе — и люди выходили выше и висели над
// полом. Здесь рост и пол меряются по кадру анимации «стоит» после скелета.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lookSpec, statureOf } from './cast';

export type ClipName = 'Idle' | 'Walk' | 'Run' | 'SitDown' | 'StandUp';
export const CLIP_NAMES: ClipName[] = ['Idle', 'Walk', 'Run', 'SitDown', 'StandUp'];
/** Кадров в секунду при запекании анимаций. */
export const BAKE_FPS = 30;
/** Ширина текстуры костей в текселях (кратна 4: матрица — 4 текселя подряд). */
export const BONE_TEX_W = 1024;
/** Скорость шага и бега в анимациях набора при ×1 проигрывания, м/с (подобрано по снимкам: ступня не скользит). */
export const WALK_SPEED = 1.25;
export const RUN_SPEED = 3.2;

export interface Clip {
  /** первый кадр в общей текстуре */
  start: number;
  frames: number;
  duration: number;
}


export interface Look {
  name: string;
  /** женская модель (cast.ts) */
  female: boolean;
  geometry: THREE.BufferGeometry;
  /** упрощённая геометрия для дальнего плана — те же вершины, меньше треугольников */
  lod: THREE.BufferGeometry;
  clips: Record<ClipName, Clip>;
  joints: number;
  tris: number;
  lodTris: number;
  /** рост в позе «стоит», м (cast.ts, STATURE) */
  height: number;
  /** во сколько раз рост больше головы: у людей обычных пропорций — 7–8, у мультяшных — около 3 */
  headRatio: number;
  /** ширина плеч и таза сидя против стоя: около 1 — сустав не «схлопывается» */
  collapse: { shoulders: number; hips: number };
  /**
   * точка опоры сидя (последний кадр SitDown), м, в осях человека: z — вперёд от корня, y — над полом. Человек садится
   * так, чтобы она пришлась на посадочную точку сиденья (catalog.ts)
   */
  seat: { y: number; z: number };
  /** лёжа на спине (поза «стоит», повёрнутая на 90°): на сколько корень над поверхностью и где середина тела */
  lie: { back: number; mid: number };
}

export interface People {
  looks: Look[];
  boneTexture: THREE.DataTexture;
  /** шаг суставов в текстуре (максимум по видам) */
  jointStride: number;
  totalFrames: number;
  /** запечённые матрицы — для проверок на CPU (skinnedY) */
  data: Float32Array;
}

/** Все атрибуты — в Float32 (после meshopt они целые нормированные), без чередования. */
export function toFloat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (g.index) out.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array), 1));
  else {
    const n = g.attributes.position.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    out.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return out;
}

/** Кусок индексной геометрии (группа материала) — отдельной геометрией. */
export function subset(g: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) out.setAttribute(name, a);
  const src = g.index!.array as Uint32Array;
  out.setIndex(new THREE.BufferAttribute(src.slice(start, start + count), 1));
  return out;
}

export interface RawLook {
  name: string;
  female: boolean;
  geometry: THREE.BufferGeometry;
  /** матрицы суставов по кадрам: [кадр][сустав] — 16 чисел, уже с приведением к росту и полу */
  frames: Float32Array[];
  clips: Record<ClipName, { first: number; frames: number; duration: number }>;
  joints: number;
  height: number;
  headRatio: number;
  collapse: { shoulders: number; hips: number };
  seat: { y: number; z: number };
  lie: { back: number; mid: number };
}

/** Позиции вершин в позе кадра `frame` (матрицы суставов `m`, 16 чисел на сустав) — то же, что делает шейдер. */
export function skinPositions(g: THREE.BufferGeometry, m: Float32Array, out = new Float32Array(g.attributes.position.count * 3)): Float32Array {
  const pos = g.attributes.position.array as Float32Array;
  const si = g.attributes.skinIndex.array as ArrayLike<number>;
  const sw = g.attributes.skinWeight.array as ArrayLike<number>;
  const n = g.attributes.position.count;
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3];
    const y = pos[v * 3 + 1];
    const z = pos[v * 3 + 2];
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw[v * 4 + k];
      if (w === 0) continue;
      const o = si[v * 4 + k] * 16;
      ox += w * (m[o] * x + m[o + 4] * y + m[o + 8] * z + m[o + 12]);
      oy += w * (m[o + 1] * x + m[o + 5] * y + m[o + 9] * z + m[o + 13]);
      oz += w * (m[o + 2] * x + m[o + 6] * y + m[o + 10] * z + m[o + 14]);
    }
    out[v * 3] = ox;
    out[v * 3 + 1] = oy;
    out[v * 3 + 2] = oz;
  }
  return out;
}

/** Матрицы суставов кадра: мировая матрица кости × обратная связанная, слева — приведение `norm`. */
function frameMatrices(skeleton: THREE.Skeleton, norm: THREE.Matrix4): Float32Array {
  const joints = skeleton.bones.length;
  const arr = new Float32Array(joints * 16);
  const tmp = new THREE.Matrix4();
  for (let j = 0; j < joints; j++) {
    tmp.multiplyMatrices(skeleton.bones[j].matrixWorld, skeleton.boneInverses[j]).premultiply(norm);
    tmp.toArray(arr, j * 16);
  }
  return arr;
}

/**
 * Вершины тела по главной кости: `re` — имена костей. Окрашиваемая одежда (халат врача, рубашка) не берётся: пола халата
 * свисает ниже таза, а рубашка — не спина.
 */
function bodyVertices(g: THREE.BufferGeometry, bones: THREE.Bone[], re: RegExp): number[] {
  const want = new Set(bones.map((b, i) => (re.test(b.name) ? i : -1)).filter(i => i >= 0));
  const si = g.attributes.skinIndex.array as ArrayLike<number>;
  const sw = g.attributes.skinWeight.array as ArrayLike<number>;
  const tint = g.attributes.aTint.array as ArrayLike<number>;
  const out: number[] = [];
  for (let v = 0; v < g.attributes.position.count; v++) {
    if (tint[v * 2] > 0) continue;
    let best = 0;
    let joint = -1;
    for (let k = 0; k < 4; k++) {
      if (sw[v * 4 + k] > best) {
        best = sw[v * 4 + k];
        joint = si[v * 4 + k];
      }
    }
    if (want.has(joint)) out.push(v);
  }
  return out;
}

/**
 * Один персонаж: части тела → одна геометрия (позиция, нормаль, цвет, индексы и веса костей, признаки окраски),
 * анимации → матрицы суставов на каждый кадр с частотой BAKE_FPS, приведённые к росту и полу.
 */
export function bakeLook(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, name: string): RawLook {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const skinned: THREE.SkinnedMesh[] = [];
  root.traverse(o => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  if (!skinned.length) throw new Error(`${name}: no SkinnedMesh`);
  const skeleton = skinned[0].skeleton;
  const joints = skeleton.bones.length;
  const spec = lookSpec(name);
  if (!spec) throw new Error(`${name}: not in cast.ts LOOKS`);
  const female = spec.sex === 'f';
  const tintMats = spec.tint;

  // Кожа набора — чёрная; под редкими прядями её не видно, а в живом тоне макушка просвечивает пятнами. Поэтому кожу
  // выше глаз (материал Face) красим в цвет волос (как в пробе).
  let faceTop = -Infinity;
  let hair: THREE.Color | null = null;
  for (const sm of skinned) {
    const mats = Array.isArray(sm.material) ? sm.material : [sm.material];
    const pos = sm.geometry.attributes.position;
    const groups = sm.geometry.groups.length ? sm.geometry.groups : [{ start: 0, count: sm.geometry.index!.count, materialIndex: 0 }];
    for (const gr of groups) {
      const m = mats[gr.materialIndex ?? 0] as THREE.MeshStandardMaterial;
      if (m.name === 'Hair') hair = m.color.clone();
      if (m.name !== 'Face') continue;
      const v = new THREE.Vector3();
      for (let k = gr.start; k < gr.start + gr.count; k++) {
        v.fromBufferAttribute(pos, sm.geometry.index!.getX(k)).applyMatrix4(sm.bindMatrix);
        faceTop = Math.max(faceTop, v.y);
      }
    }
  }

  const geoms: THREE.BufferGeometry[] = [];
  for (const sm of skinned) {
    if (sm.skeleton !== skeleton) throw new Error(`${name}: parts with different skeletons`);
    const base = toFloat(sm.geometry);
    base.applyMatrix4(sm.bindMatrix);
    const mats = Array.isArray(sm.material) ? sm.material : [sm.material];
    const groups = sm.geometry.groups.length ? sm.geometry.groups : [{ start: 0, count: base.index!.count, materialIndex: 0 }];
    for (const gr of groups) {
      const m = mats[gr.materialIndex ?? 0] as THREE.MeshStandardMaterial;
      const g = subset(base, gr.start, gr.count);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const tint = new Float32Array(n * 2);
      const py = g.attributes.position;
      const isSkin = m.name === 'Skin';
      const scalp = isSkin && hair && faceTop > -Infinity;
      const clothes = tintMats.includes(m.name);
      for (let i = 0; i < n; i++) {
        if (scalp && py.getY(i) > faceTop) hair!.toArray(col, i * 3);
        else if (isSkin) {
          col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 1;
          tint[i * 2 + 1] = 1;
        } else m.color.toArray(col, i * 3);
        if (clothes) tint[i * 2] = 1;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      // x — одежда красится цветом экземпляра, y — кожа
      g.setAttribute('aTint', new THREE.BufferAttribute(tint, 2));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'skinIndex', 'skinWeight', 'aTint'].includes(k)) g.deleteAttribute(k);
      geoms.push(g);
    }
  }
  const geometry = mergeGeometries(geoms, false);
  if (!geometry) throw new Error(`${name}: cannot merge parts`);

  const mixer = new THREE.AnimationMixer(root);
  // у Casual_Bald в наборе нет бега — бежит шагом
  const clipOf = (cn: ClipName) => {
    const clip = gltf.animations.find(a => a.name === cn) ?? (cn === 'Run' ? gltf.animations.find(a => a.name === 'Walk') : undefined);
    if (!clip) throw new Error(`${name}: no animation ${cn}`);
    return clip;
  };
  const pose = (cn: ClipName, t: number) => {
    mixer.stopAllAction();
    const action = mixer.clipAction(clipOf(cn));
    // LoopOnce + clampWhenFinished: последний кадр SitDown — сидя, а не снова первый
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset().play();
    mixer.setTime(t);
    root.updateMatrixWorld(true);
  };

  // рост и пол — по первому кадру «стоит» после скелета
  pose('Idle', 0);
  const raw = skinPositions(geometry, frameMatrices(skeleton, new THREE.Matrix4()));
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < raw.length; i += 3) {
    minY = Math.min(minY, raw[i]);
    maxY = Math.max(maxY, raw[i]);
  }
  const height = statureOf(spec);
  const s = height / (maxY - minY);
  const norm = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(0, -minY, 0));

  const frames: Float32Array[] = [];
  const clips = {} as RawLook['clips'];
  for (const cn of CLIP_NAMES) {
    const clip = clipOf(cn);
    const n = Math.max(2, Math.round(clip.duration * BAKE_FPS) + 1);
    clips[cn] = { first: frames.length, frames: n, duration: clip.duration };
    for (let f = 0; f < n; f++) {
      pose(cn, Math.min(clip.duration, f / BAKE_FPS));
      frames.push(frameMatrices(skeleton, norm));
    }
  }

  // сидя: самая нижняя точка таза и бёдер в последнем кадре SitDown и середина этой нижней полосы по глубине
  const sitFrame = frames[clips.SitDown.first + clips.SitDown.frames - 1];
  const sitPos = skinPositions(geometry, sitFrame);
  const sv = bodyVertices(geometry, skeleton.bones, /^(Hips|UpperLeg[LR])$/);
  let low = Infinity;
  for (const v of sv) low = Math.min(low, sitPos[v * 3 + 1]);
  let zs = 0;
  let zn = 0;
  for (const v of sv) {
    if (sitPos[v * 3 + 1] <= low + 0.04) {
      zs += sitPos[v * 3 + 2];
      zn++;
    }
  }
  const seat = { y: low, z: zn ? zs / zn : 0 };

  // лёжа на спине — поза «стоит», повёрнутая вокруг X: на постель ложится спина (затылок большой головы чуть уходит в
  // подушку — так и лежат)
  const idle = skinPositions(geometry, frames[clips.Idle.first]);
  let back = Infinity;
  for (const v of bodyVertices(geometry, skeleton.bones, /^(Torso|Abdomen|Hips)$/)) back = Math.min(back, idle[v * 3 + 2]);
  const lie = { back: -back, mid: height / 2 };

  // голова — вершины кости Head в позе «стоит»; плечи и таз — расстояние между левым и правым суставом стоя и сидя
  let h0 = Infinity;
  let h1 = -Infinity;
  for (const v of bodyVertices(geometry, skeleton.bones, /^Head$/)) {
    h0 = Math.min(h0, idle[v * 3 + 1]);
    h1 = Math.max(h1, idle[v * 3 + 1]);
  }
  const headRatio = height / (h1 - h0);
  const jointAt = (f: Float32Array, n: string) => {
    const j = skeleton.bones.findIndex(b => b.name === n);
    // положение сустава: матрица кадра × связанное положение кости
    const bind = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(skeleton.boneInverses[j]).invert());
    return bind.applyMatrix4(new THREE.Matrix4().fromArray(f, j * 16));
  };
  const width = (f: Float32Array, a: string, b: string) => jointAt(f, a).distanceTo(jointAt(f, b));
  const stand = frames[clips.Idle.first];
  const collapse = {
    shoulders: width(sitFrame, 'UpperArmL', 'UpperArmR') / width(stand, 'UpperArmL', 'UpperArmR'),
    hips: width(sitFrame, 'UpperLegL', 'UpperLegR') / width(stand, 'UpperLegL', 'UpperLegR'),
  };

  return { name, female, geometry, frames, clips, joints, height, headRatio, collapse, seat, lie };
}

export interface Simplifier {
  simplify(i: Uint32Array, p: Float32Array, stride: number, target: number, err: number, flags?: string[]): [Uint32Array, number];
  simplifySloppy(i: Uint32Array, p: Float32Array, stride: number, lock: Uint8Array | null, target: number, err: number): [Uint32Array, number];
  simplifyWithAttributes(
    i: Uint32Array,
    p: Float32Array,
    stride: number,
    attrs: Float32Array,
    attrStride: number,
    weights: number[],
    lock: Uint8Array | null,
    target: number,
    err: number,
    flags?: string[],
  ): [Uint32Array, number];
}

/** Упрощённая копия для дальнего плана: те же вершины, меньше треугольников (meshoptimizer). */
export function simplify(g: THREE.BufferGeometry, ratio: number, simplifier: Simplifier, lock: Uint8Array | null = null): THREE.BufferGeometry {
  const pos = g.attributes.position.array as Float32Array;
  const idx = new Uint32Array(g.index!.array);
  const target = Math.floor((idx.length * ratio) / 3) * 3;
  // цвет — признак, чтобы границы одежды не расплывались; подошвы закреплены — упрощённый человек стоит на полу
  const col = g.attributes.color.array as Float32Array;
  let [out] = simplifier.simplifyWithAttributes(idx, pos, 3, col, 3, [0.5, 0.5, 0.5], lock, target, 0.05, []);
  if (out.length > target * 1.5) [out] = simplifier.simplifySloppy(idx, pos, 3, lock, target, 0.05);
  const lod = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) lod.setAttribute(k, a);
  lod.setIndex(new THREE.BufferAttribute(out, 1));
  return lod;
}

/** Упрощённая модель вида: подошвы (ниже 2 см в позе «стоит») не упрощаются. */
export function lodOf(r: RawLook, ratio: number, simplifier: Simplifier): THREE.BufferGeometry {
  const pos = skinPositions(r.geometry, r.frames[r.clips.Idle.first]);
  const n = r.geometry.attributes.position.count;
  const lock = new Uint8Array(n);
  for (let v = 0; v < n; v++) if (pos[v * 3 + 1] < 0.02) lock[v] = 1;
  return simplify(r.geometry, ratio, simplifier, lock);
}

/** Все виды людей: запечённые матрицы — в одну текстуру. */
export function packPeople(raws: RawLook[], lods: THREE.BufferGeometry[]): People {
  const stride = Math.max(...raws.map(r => r.joints));
  const totalFrames = raws.reduce((a, r) => a + r.frames.length, 0);
  const texels = totalFrames * stride * 4;
  const h = Math.ceil(texels / BONE_TEX_W);
  const data = new Float32Array(BONE_TEX_W * h * 4);
  const looks: Look[] = [];
  let frame0 = 0;
  raws.forEach((r, i) => {
    for (let f = 0; f < r.frames.length; f++) data.set(r.frames[f], (frame0 + f) * stride * 16);
    const clips = {} as Record<ClipName, Clip>;
    for (const cn of CLIP_NAMES) clips[cn] = { start: frame0 + r.clips[cn].first, frames: r.clips[cn].frames, duration: r.clips[cn].duration };
    const lod = lods[i];
    looks.push({
      name: r.name, female: r.female, geometry: r.geometry, lod, clips, joints: r.joints, tris: r.geometry.index!.count / 3, lodTris: lod.index!.count / 3,
      height: r.height, headRatio: r.headRatio, collapse: r.collapse, seat: r.seat, lie: r.lie,
    });
    frame0 += r.frames.length;
  });
  const tex = new THREE.DataTexture(data, BONE_TEX_W, h, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { looks, boneTexture: tex, jointStride: stride, totalFrames, data };
}

/** Матрицы кадра `frame` (номер в общей текстуре) вида `look` — для проверок на CPU. */
export function frameData(p: People, look: Look, frame: number): Float32Array {
  const o = frame * p.jointStride * 16;
  return p.data.subarray(o, o + look.joints * 16);
}

/** Нижняя и верхняя точка вида в кадре: по всем вершинам, которые рисует геометрия `g` (полная или упрощённая). */
export function skinnedY(p: People, look: Look, frame: number, g: THREE.BufferGeometry = look.geometry): { min: number; max: number } {
  const pos = skinPositions(look.geometry, frameData(p, look, frame));
  const idx = g.index!.array as ArrayLike<number>;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < idx.length; i++) {
    const y = pos[idx[i] * 3 + 1];
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return { min, max };
}
