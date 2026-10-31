// Модели из Blender (#109; blender/README.md, tools/blender/): файлы assets/models — те, что в паспорте (sources.json),
// паспорт — от нынешних записи и скриптов (иначе: «перестройте — npm run models»), окно грузит то, что построено
// (index.json), а свет помещений не запекается (решение владельца, #112). Все машины — в одном .glb: узел машины — вид
// записи, внутри — узлы частей записи (устав, docs/11-new-games.md: имя узла = идентификатор части), у каждого — середина
// части, вся модель — в следе записи, лампа окна — на стойке, материалы — общие, цвета — отделка machines.ts.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../../src/content';
import { lampAt } from '../../src/render/machines';
import { ART_INDEX, BLENDER, BUILD, inputHash, MACHINES_GLB, nodeErrors, OUTPUTS, sceneOf, scriptsHash, sha256 } from '../blender/scene';
import { MODELS } from './render-kit';

const ROOT = join(import.meta.dir, '../..');
const sources = JSON.parse(readFileSync(join(MODELS, 'sources.json'), 'utf8')) as Record<string, { source: string; sha256: string; input?: string; blender?: string; out: string }>;
const index = JSON.parse(readFileSync(join(MODELS, 'index.json'), 'utf8')) as Record<string, unknown>;
const licenses = readFileSync(join(ROOT, 'assets/LICENSES.md'), 'utf8');
const scene = sceneOf(db);

interface GlbNode {
  name: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface Glb {
  scenes: { nodes: number[] }[];
  images?: unknown[];
  nodes: GlbNode[];
  meshes: { primitives: { attributes: Record<string, number>; material: number }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
  materials: { name: string; alphaMode?: string; occlusionTexture?: unknown; doubleSided?: boolean; pbrMetallicRoughness: { baseColorFactor: number[]; roughnessFactor: number; metallicFactor: number } }[];
}
/** Подвижные части записей — ротор, кожух, рулоны: у них свой шарнир и нет затенения. */
const MOVING: Record<string, string[]> = { 'eq.press': ['rotor', 'cover'], 'mach.blister': ['cover', 'film', 'foil'], 'mach.cartoner': ['cover'] };
/** Узел износа записи — внутри какой части. */
const WEAR: Record<string, string> = { punches: 'rotor', sealplate: 'sealing' };
const glbOf = (path: string): Glb => {
  const b = readFileSync(join(MODELS, path));
  expect(b.subarray(0, 4).toString()).toBe('glTF');
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as Glb;
};

describe('паспорт', () => {
  test('каждый файл Blender — в паспорте: тот же SHA-256, скрипт, версия Blender; строка в assets/LICENSES.md', () => {
    for (const o of OUTPUTS) {
      const row = sources[o.path];
      expect([o.path, !!row]).toEqual([o.path, true]);
      expect([o.path, sha256(readFileSync(join(MODELS, o.path)))]).toEqual([o.path, row.out]);
      expect(row.source).toBe(o.script);
      expect(row.blender?.startsWith(`Blender ${BLENDER}`)).toBe(true);
      expect([o.path, licenses.includes(o.path) && licenses.includes(row.out)]).toEqual([o.path, true]);
    }
  });

  test('паспорт — от нынешних записи и скриптов: иначе модели надо перестроить (npm run models)', () => {
    const read = (p: string) => readFileSync(join(ROOT, p));
    for (const o of OUTPUTS) {
      expect([o.path, 'сцена', sources[o.path].input]).toEqual([o.path, 'сцена', inputHash(scene, o)]);
      expect([o.path, 'скрипты', sources[o.path].sha256]).toEqual([o.path, 'скрипты', scriptsHash(o, read)]);
    }
  });

  test('окно грузит то, что построено: люди и машины в index.json; запечек помещений нет (#112)', () => {
    expect(Object.keys(index).sort()).toEqual(['machines', 'people']);
    expect(index.machines).toEqual(ART_INDEX.machines);
  });

  test('в паспорте из Blender — только то, что строится сейчас: прочее убрано вместе с файлом', () => {
    const built = Object.entries(sources).filter(([, r]) => r.blender).map(([path]) => path);
    expect(built.sort()).toEqual(OUTPUTS.map(o => o.path).sort());
  });
});

describe('машины из Blender — один файл', () => {
  const glb = glbOf(MACHINES_GLB);
  const roots = glb.scenes[0].nodes.map(i => glb.nodes[i]);

  test('в файле — по узлу на машину: имя — вид записи, в нуле, без поворота и масштаба', () => {
    expect(roots.map(n => n.name).sort()).toEqual([...BUILD.machines].sort());
    for (const n of roots) expect([n.name, n.translation, n.rotation, n.scale]).toEqual([n.name, undefined, undefined, undefined]);
  });

  test('материалы — общие на все машины: по одному на отделку, одна карта затенения на все', () => {
    const names = glb.materials.map(m => m.name);
    expect(new Set(names).size).toBe(names.length);
    expect(glb.images?.length).toBe(1);
  });

  for (const type of BUILD.machines) {
    const rec = db.equipment[type] ?? db.machines[type];
    const root = roots.find(n => n.name === type)!;
    const parts = (root?.children ?? []).map(c => glb.nodes[c]);
    const [W, D, H] = rec.size.map(v => v / 100);
    const moving = rec.model.filter(p => p.spin || p.cover).map(p => p.id!);

    test(`${type}: узлы — части записи, деталь с именем — узел износа внутри своей части`, () => {
      const nodes: { name: string; parent?: string }[] = parts.flatMap(n => [{ name: n.name }, ...(n.children ?? []).map(c => ({ name: glb.nodes[c].name, parent: n.name }))]);
      expect(nodeErrors(rec.model, rec.parts.map(p => p.id), nodes)).toEqual([]);
      for (const w of rec.parts.map(p => p.id)) expect([w, nodes.find(n => n.name === w)?.parent]).toEqual([w, WEAR[w]]);
    });

    test(`${type}: узел — в середине своей части, без поворота и масштаба; подвижны ${moving.join(', ')} — как части кода`, () => {
      for (const n of parts) {
        const p = rec.model.find(q => q.id === n.name)!;
        const [x, y, z] = n.translation ?? [0, 0, 0];
        expect([n.name, Math.abs(x - p.x) < 1e-6 && Math.abs(y - p.y) < 1e-6 && Math.abs(z - p.z) < 1e-6]).toEqual([n.name, true]);
        expect([n.name, n.rotation, n.scale]).toEqual([n.name, undefined, undefined]);
      }
      expect(moving).toEqual(MOVING[type]);
    });

    test(`${type}: вся модель — в следе записи ${W} × ${D} × ${H} м`, () => {
      const walk = (n: GlbNode, at: number[]) => {
        const t = n.translation ?? [0, 0, 0];
        const o = at.map((v, k) => v + t[k]);
        if (n.mesh !== undefined)
          for (const pr of glb.meshes[n.mesh].primitives) {
            const a = glb.accessors[pr.attributes.POSITION];
            const lo = a.min!.map((v, k) => v + o[k]);
            const hi = a.max!.map((v, k) => v + o[k]);
            const inside = lo[0] >= -W / 2 - 1e-4 && hi[0] <= W / 2 + 1e-4 && lo[1] >= -1e-4 && hi[1] <= H + 1e-4 && lo[2] >= -D / 2 - 1e-4 && hi[2] <= D / 2 + 1e-4;
            expect([n.name, inside]).toEqual([n.name, true]);
          }
        for (const c of n.children ?? []) walk(glb.nodes[c], o);
      };
      walk(root, [0, 0, 0]);
    });

    test(`${type}: под лампой окна — стойка: у угла лампы модель доходит до её низа`, () => {
      const [lx, ly, lz] = lampAt(W, D, H);
      let top = -1;
      const walk = (n: GlbNode, at: number[]) => {
        const t = n.translation ?? [0, 0, 0];
        const o = at.map((v, k) => v + t[k]);
        if (n.mesh !== undefined)
          for (const pr of glb.meshes[n.mesh].primitives) {
            const a = glb.accessors[pr.attributes.POSITION];
            const lo = a.min!.map((v, k) => v + o[k]);
            const hi = a.max!.map((v, k) => v + o[k]);
            if (lo[0] <= lx && hi[0] >= lx && lo[2] <= lz && hi[2] >= lz) top = Math.max(top, hi[1]);
          }
        for (const c of n.children ?? []) walk(glb.nodes[c], o);
      };
      walk(root, [0, 0, 0]);
      expect(Math.abs(top - ly) < 1e-4).toBe(true);
    });

    test(`${type}: цвета — отделка machines.ts; затенение — у неподвижных частей, у подвижных его нет; стекло прозрачно; изнанки нет`, () => {
      for (const n of parts) {
        const mats = [n, ...(n.children ?? []).map(c => glb.nodes[c])].flatMap(x => (x.mesh === undefined ? [] : glb.meshes[x.mesh].primitives.map(pr => glb.materials[pr.material].name)));
        for (const name of mats) expect([n.name, name, name.endsWith('-moving') || name === 'glass']).toEqual([n.name, name, moving.includes(n.name)]);
      }
    });
  }

  test('материалы: цвета — отделка machines.ts; у неподвижных — затенение, у подвижных его нет; стекло прозрачно; изнанки нет', () => {
    for (const m of glb.materials) {
      const f = scene.finish[m.name.replace(/-moving$/, '')];
      expect([m.name, !!f]).toEqual([m.name, true]);
      const c = m.pbrMetallicRoughness;
      expect([m.name, c.baseColorFactor.slice(0, 3).every((v, k) => Math.abs(v - f.color[k]) < 1e-6)]).toEqual([m.name, true]);
      expect([m.name, Math.abs(c.roughnessFactor - f.rough) < 1e-6, Math.abs(c.metallicFactor - f.metal) < 1e-6]).toEqual([m.name, true, true]);
      expect([m.name, !!m.doubleSided]).toEqual([m.name, false]);
      if (m.name === 'glass') expect([m.alphaMode, Math.abs(c.baseColorFactor[3] - f.opacity!) < 1e-6]).toEqual(['BLEND', true]);
      else expect([m.name, !!m.occlusionTexture]).toEqual([m.name, !m.name.endsWith('-moving')]);
    }
  });
});
