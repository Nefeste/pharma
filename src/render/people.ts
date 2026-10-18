// из bolnitsa: src/render/people.ts @ e0a3491 — изменено: экземпляры — из движущихся завода (src/app/movers.ts), а не из
// толпы больницы; человек — минимальная запись `Body` вместо `Walker` толпы; общий масштаб — люди уходят в пол при смене
// крупности показа (docs/specs/2026-10-view.md, 2г).
// из spikes/render-3d: src/people.ts — изменено: экземпляры — из толпы crowd.ts (стоит, идёт, сидит, лежит), цвет одежды и
// кожи — на экземпляр (одна геометрия на вид, разные должности и пациенты), матрица лёжа.
//
// Люди на видеокарте: каждый вид — две InstancedMesh (полная и упрощённая), все экземпляры вида — один вызов отрисовки.
// Скелетная анимация считается в вершинном шейдере: матрицы суставов всех кадров всех видов лежат в одной текстуре
// (bake.ts); на экземпляр приходят номер кадра A, кадр B и доля между ними, цвет одежды и кожи. На CPU за кадр — матрица и
// три числа на человека.
import * as THREE from 'three';
import { BAKE_FPS, BONE_TEX_W, CLIP_NAMES, type People } from './bake';

/** Номера анимаций — как CLIP_NAMES в bake.ts. */
export const IDLE = 0;
export const WALK = 1;
export const RUN = 2;

/** Человек на экране: где (ступни), куда смотрит, вид, анимация и время в ней, лёжа ли. */
export interface Body {
  x: number;
  y: number;
  z: number;
  heading: number;
  look: number;
  clip: number;
  clipTime: number;
  loop: boolean;
  /** 0 — стоит, 1 — лежит */
  lie: number;
}

const PARS = /* glsl */ `
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec3 aAnim;
attribute vec2 aTint;
attribute vec3 aSkin;
uniform highp sampler2D uBones;
mat4 boneAt(int f, float j) {
  int b = (f * JOINT_STRIDE + int(j)) * 4;
  ivec2 p = ivec2(b % BONE_W, b / BONE_W);
  return mat4(texelFetch(uBones, p, 0), texelFetch(uBones, p + ivec2(1, 0), 0),
              texelFetch(uBones, p + ivec2(2, 0), 0), texelFetch(uBones, p + ivec2(3, 0), 0));
}
mat4 skinAt(int f) {
  return boneAt(f, skinIndex.x) * skinWeight.x + boneAt(f, skinIndex.y) * skinWeight.y
       + boneAt(f, skinIndex.z) * skinWeight.z + boneAt(f, skinIndex.w) * skinWeight.w;
}
`;
const BASE = /* glsl */ `
mat4 skinM = skinAt(int(aAnim.x));
if (aAnim.z > 0.001) skinM = skinM * (1.0 - aAnim.z) + skinAt(int(aAnim.y)) * aAnim.z;
`;
// одежда — цвет экземпляра (должность, зерно пациента), кожа — свой цвет экземпляра; остальное — цвет модели
const COLOR = /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec4( color, 1.0 );
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.rgb = mix( vColor.rgb, instanceColor.rgb, aTint.x );
#endif
  vColor.rgb = mix( vColor.rgb, aSkin, aTint.y );
`;

function inject(shader: THREE.WebGLProgramParametersWithUniforms, bones: THREE.Texture, stride: number, depth: boolean) {
  shader.uniforms.uBones = { value: bones };
  let v = `#define JOINT_STRIDE ${stride}\n#define BONE_W ${BONE_TEX_W}\n${shader.vertexShader}`
    .replace('#include <skinning_pars_vertex>', PARS)
    .replace('#include <skinbase_vertex>', BASE)
    .replace('#include <skinnormal_vertex>', 'objectNormal = normalize(mat3(skinM) * objectNormal);')
    .replace('#include <skinning_vertex>', 'transformed = (skinM * vec4(transformed, 1.0)).xyz;');
  if (!depth) v = v.replace('#include <color_vertex>', COLOR);
  shader.vertexShader = v;
}

/** Цвет экземпляра: одежда и кожа. */
export interface Paint {
  clothes: THREE.Color;
  skin: THREE.Color;
}

export class PeopleView {
  readonly group = new THREE.Group();
  private full: THREE.InstancedMesh[] = [];
  private far: THREE.InstancedMesh[] = [];
  private attrs: { full: Record<'anim' | 'skin', THREE.InstancedBufferAttribute>; far: Record<'anim' | 'skin', THREE.InstancedBufferAttribute> }[] = [];
  readonly material: THREE.MeshStandardMaterial;
  /** сколько людей нарисовано полной и упрощённой моделью в последнем кадре */
  nearCount = 0;
  farCount = 0;

  constructor(
    private people: People,
    private max: number,
  ) {
    // у набора материалы двусторонние (волосы — тонкие пластины)
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = s => inject(s, people.boneTexture, people.jointStride, false);
    mat.customProgramCacheKey = () => 'baked-skin';
    const depth = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
    depth.onBeforeCompile = s => inject(s, people.boneTexture, people.jointStride, true);
    depth.customProgramCacheKey = () => 'baked-skin-depth';
    this.material = mat;
    for (const look of people.looks) {
      const make = (g: THREE.BufferGeometry) => {
        const geo = g.clone();
        const anim = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
        const skin = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
        anim.setUsage(THREE.DynamicDrawUsage);
        skin.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('aAnim', anim);
        geo.setAttribute('aSkin', skin);
        const m = new THREE.InstancedMesh(geo, mat, max);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.setColorAt(0, new THREE.Color(1, 1, 1));
        m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
        m.customDepthMaterial = depth;
        m.frustumCulled = false;
        m.castShadow = true;
        m.receiveShadow = true;
        m.count = 0;
        this.group.add(m);
        return { m, anim, skin };
      };
      const f = make(look.geometry);
      const d = make(look.lod);
      this.full.push(f.m);
      this.far.push(d.m);
      this.attrs.push({ full: { anim: f.anim, skin: f.skin }, far: { anim: d.anim, skin: d.skin } });
    }
  }

  setShadows(on: boolean) {
    for (const m of [...this.full, ...this.far]) m.castShadow = on;
  }

  private m4 = new THREE.Matrix4();
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  /** общий масштаб людей: 1 — в полный рост, 0 — ушли в пол (крупность показа) */
  scale = 1;

  /** Матрица человека: стоит — у ступней, повёрнут по ходу; лежит — на спине, головой к изголовью (bake.ts, `lie`). */
  matrixOf(w: Body, out: THREE.Matrix4): THREE.Matrix4 {
    const look = this.people.looks[w.look];
    this.q.setFromAxisAngle(this.up, w.heading);
    out.compose(this.p.set(w.x, w.y, w.z), this.q, this.one.setScalar(this.scale));
    if (w.lie > 0) {
      const k = w.lie;
      out.multiply(this.tmp.makeTranslation(0, look.lie.back * k, look.lie.mid * k));
      out.multiply(this.tmp.makeRotationX((-Math.PI / 2) * k));
    }
    return out;
  }

  /**
   * Переписать экземпляры. Люди дальше `cull` (м, по земле от точки взгляда) не рисуются совсем; `full` — рисовать полной
   * моделью (камера близко), иначе — упрощённой.
   */
  update<B extends Body>(bodies: Iterable<B>, paint: (w: B) => Paint, focus: THREE.Vector3, cull: number, full: boolean) {
    const L = this.people.looks.length;
    const nFull = new Array(L).fill(0);
    const nFar = new Array(L).fill(0);
    const cull2 = cull * cull;
    for (const w of this.scale > 0.01 ? bodies : []) {
      const li = w.look;
      const look = this.people.looks[li];
      const dx = w.x - focus.x;
      const dz = w.z - focus.z;
      if (dx * dx + dz * dz > cull2) continue;
      const mesh = full ? this.full[li] : this.far[li];
      const at = full ? this.attrs[li].full : this.attrs[li].far;
      const k = full ? nFull[li]++ : nFar[li]++;
      if (k >= this.max) continue;
      this.matrixOf(w, this.m4).toArray(mesh.instanceMatrix.array, k * 16);
      const c = paint(w);
      c.clothes.toArray(mesh.instanceColor!.array, k * 3);
      c.skin.toArray(at.skin.array as Float32Array, k * 3);
      const clip = look.clips[CLIP_NAMES[w.clip]];
      const t = Math.max(0, w.clipTime) * BAKE_FPS;
      let fa: number;
      let fb: number;
      let wt: number;
      if (w.loop) {
        const tt = t % (clip.frames - 1);
        fa = Math.floor(tt);
        fb = (fa + 1) % (clip.frames - 1);
        wt = tt - fa;
      } else {
        const tt = Math.min(t, clip.frames - 1);
        fa = Math.floor(tt);
        fb = Math.min(fa + 1, clip.frames - 1);
        wt = tt - fa;
      }
      const arr = at.anim.array as Float32Array;
      arr[k * 3] = clip.start + fa;
      arr[k * 3 + 1] = clip.start + fb;
      arr[k * 3 + 2] = wt;
    }
    let near = 0;
    let far = 0;
    for (let li = 0; li < L; li++) {
      for (const [mesh, at, n0] of [
        [this.full[li], this.attrs[li].full, nFull[li]],
        [this.far[li], this.attrs[li].far, nFar[li]],
      ] as [THREE.InstancedMesh, Record<'anim' | 'skin', THREE.InstancedBufferAttribute>, number][]) {
        const n = Math.min(n0, this.max);
        mesh.count = n;
        mesh.visible = n > 0;
        if (!n) continue;
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, n * 16);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.clearUpdateRanges();
        mesh.instanceColor!.addUpdateRange(0, n * 3);
        mesh.instanceColor!.needsUpdate = true;
        for (const a of [at.anim, at.skin]) {
          a.clearUpdateRanges();
          a.addUpdateRange(0, n * 3);
          a.needsUpdate = true;
        }
      }
      near += Math.min(nFull[li], this.max);
      far += Math.min(nFar[li], this.max);
    }
    this.nearCount = near;
    this.farCount = far;
  }
}
