// из bolnitsa: tools/test/render-kit.ts @ e0a3491 — изменено: только люди (мебели и больницы у завода нет).
// Для тестов 3D-вида (docs/specs/2026-10-view.md, 2б): модели из assets/models без браузера — тот же GLTFLoader и тот же
// разбор, что в игре.
import type * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bakeLook, lodOf, packPeople, type People } from '../../src/render/bake';

export const MODELS = join(import.meta.dir, '../../assets/models');
export const index = JSON.parse(readFileSync(join(MODELS, 'index.json'), 'utf8')) as { people: string[] };

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export async function gltfOf(name: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> {
  const buf = readFileSync(join(MODELS, `${name}.glb`));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new Promise((res, rej) => loader.parse(ab, '', g => res(g as never), rej));
}

let people: People | undefined;
/** Все виды людей, запечённые как в игре. */
export async function bakedPeople(): Promise<People> {
  if (people) return people;
  await MeshoptSimplifier.ready;
  const raws = [];
  for (const n of index.people) raws.push(bakeLook(await gltfOf(`people/${n}`), n));
  people = packPeople(raws, raws.map(r => lodOf(r, 0.25, MeshoptSimplifier)));
  return people;
}
