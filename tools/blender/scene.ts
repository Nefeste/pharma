// Сцена для Blender (#109; устав, docs/11-new-games.md: Blender в фоновом режиме, скрипт в blender/): что строят
// скрипты blender/ — из той же базы, что окно игры. Машина — части `model`, след и узлы износа её записи content/ (их
// же читает machines.ts) и отделка machines.ts. Свет помещений не запекается (решение владельца, #112). Сам скрипт Blender
// о заводе ничего не знает. Паспорт модели (assets/models/sources.json) хранит SHA-256 своей доли сцены: тест скажет,
// что запись изменилась, а модель — нет (tools/test/blender.test.ts).
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import type { ContentDb, ModelPart } from '../../src/content/types';
import { stableJson } from '../../src/engine/core/hash';
import { FINISH, GLASS } from '../../src/render/machines';

/** Версия Blender, на которой собраны модели (blender/README.md): другая — сборка не идёт. */
export const BLENDER = '5.2.3';
/** Что строится в Blender: машины, на которые смотрят вблизи (#112). */
export const BUILD = { machines: ['eq.press'] } as const;

type Rgb = [number, number, number];
export interface SceneFinish {
  color: Rgb;
  rough: number;
  metal: number;
  opacity?: number;
}
export interface SceneMachine {
  /** ширина, глубина, высота следа, м */
  size: Rgb;
  model: ModelPart[];
  /** узлы износа записи (`parts`): деталь с таким именем — узел внутри своей части */
  wear: string[];
}
export interface BlenderScene {
  blender: string;
  finish: Record<string, SceneFinish>;
  machines: Record<string, SceneMachine>;
}

const lin = (hex: number): Rgb => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

export function sceneOf(db: ContentDb): BlenderScene {
  const finish: Record<string, SceneFinish> = {};
  for (const [k, f] of Object.entries({ ...FINISH, glass: GLASS })) finish[k] = { color: lin(f.color), rough: f.rough, metal: f.metal, ...(f.opacity !== undefined ? { opacity: f.opacity } : {}) };
  const machines: Record<string, SceneMachine> = {};
  for (const t of BUILD.machines) {
    const e = db.equipment[t];
    machines[t] = { size: e.size.map(v => v / 100) as Rgb, model: e.model, wear: e.parts.map(p => p.id) };
  }
  return { blender: BLENDER, finish, machines };
}

/**
 * Файлы, которые строит Blender: путь в assets/models, скрипт и все скрипты, от которых он зависит, доля сцены, от
 * которой зависит файл; что из него берёт окно (index.json).
 */
export interface Output {
  path: string;
  script: string;
  scripts: string[];
  input: (s: BlenderScene) => unknown;
}
export const OUTPUTS: Output[] = BUILD.machines.map(t => ({
  path: `machines/${t.replace(/^eq\./, '')}.glb`,
  script: 'blender/press.py',
  scripts: ['blender/lib.py', 'blender/press.py'],
  input: (s: BlenderScene) => ({ blender: s.blender, finish: s.finish, machine: s.machines[t] }),
}));

/** Что окно грузит из Blender (assets/models/index.json, src/render/blender.ts `ArtIndex`). */
export const ART_INDEX = {
  machines: Object.fromEntries(BUILD.machines.map(t => [t, `machines/${t.replace(/^eq\./, '')}.glb`])),
};

export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
/** SHA-256 доли сцены файла — поле `input` паспорта. */
export const inputHash = (s: BlenderScene, o: Output) => sha256(stableJson(o.input(s)));
/** SHA-256 скриптов файла подряд — поле `sha256` паспорта (у людей там — SHA-256 исходника). */
export const scriptsHash = (o: Output, read: (path: string) => Uint8Array) => sha256(Buffer.concat(o.scripts.map(p => Buffer.from(read(p)))));

/** Части записи и узлы модели: у каждой части с именем — узел; узлов сверх частей и их деталей с именами узлов нет. */
export function nodeErrors(model: readonly ModelPart[], wear: readonly string[], nodes: readonly { name: string; parent?: string }[]): string[] {
  const out: string[] = [];
  const parts = new Set(model.map(p => p.id).filter((id): id is string => !!id));
  for (const p of model) if (!p.id && p.shape !== 'belt') out.push(`часть ${p.shape} без имени — узла для неё нет`);
  const top = new Set(nodes.filter(n => !n.parent).map(n => n.name));
  for (const id of parts) if (!top.has(id)) out.push(`нет узла «${id}»`);
  for (const n of nodes) {
    if (!n.parent && !parts.has(n.name)) out.push(`узел «${n.name}» — не часть записи`);
    // деталь с именем — узел внутри части: имя — узел износа записи (`parts`), как пуансоны в роторе
    if (n.parent && !wear.includes(n.name)) out.push(`узел «${n.name}» в «${n.parent}» — не узел износа записи`);
  }
  return out;
}
