// Сцена для Blender (#109; устав, docs/11-new-games.md: Blender в фоновом режиме, скрипт в blender/): что строят и
// запекают скрипты blender/ — из той же базы и того же кода раскладки, что окно игры. Машина — части `model`, след и узлы
// износа её записи content/ (их же читает machines.ts) и отделка machines.ts; помещение — пол между осями стен
// (`bakeRect`), стены — треугольники `buildWalls` в его клетках, двери закрыты, светильники — `lampPoints` с их высотой и
// цветом, оборудование — по плану, а средняя яркость пятен света холста (`poolAt`) — та, к которой приводится запечка.
// Сам скрипт Blender о заводе ничего не знает. Паспорт модели (assets/models/sources.json) хранит SHA-256 своей доли сцены:
// тест скажет, что запись или раскладка изменились, а модель — нет (tools/test/blender.test.ts).
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import type { ContentDb, ModelPart } from '../../src/content/types';
import { stableJson } from '../../src/engine/core/hash';
import { planOf } from '../../src/engine/plant';
import { BAKE_PX, bakeRect } from '../../src/render/blender';
import { LAMP_GLOW, lampHeight, lampPoints, lampTint, poolAt } from '../../src/render/lamps';
import { layoutOf, WALL_LOW_ROOM } from '../../src/render/layout';
import { FINISH, GLASS } from '../../src/render/machines';
import { EPOXY } from '../../src/render/textures';
import { buildWalls, DOCK_H, DOOR_H, GATE_H, HATCH, PANEL } from '../../src/render/world';

/** Версия Blender, на которой собраны модели (blender/README.md): другая — сборка не идёт. */
export const BLENDER = '5.2.3';
/** Что пилот строит в Blender: одна машина и одно помещение производства (#109). */
export const BUILD = { machines: ['eq.press'], rooms: ['compression'] } as const;

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
export interface SceneRoom {
  /** пол в запечке, м: x, z, ширина, глубина; точек на метр */
  rect: [number, number, number, number];
  px: number;
  height: number;
  /** пол и стена — линейный цвет (плинтус узок — на запечку не влияет) */
  floor: Rgb;
  panel: Rgb;
  /** светильники: середина панели, м; сторона панели; цвет света — линейный */
  lamps: { x: number; z: number; y: number }[];
  glow: number;
  tint: Rgb;
  /** стены и закрытые двери помещения — треугольники в осях окна (x, y вверх, z), м */
  walls: number[];
  equipment: { type: string; x: number; z: number; turn: number }[];
  /** средняя линейная яркость пятен света холста на полу запечки — к ней приводится запечённый свет */
  pool: number;
}
export interface BlenderScene {
  blender: string;
  finish: Record<string, SceneFinish>;
  machines: Record<string, SceneMachine>;
  rooms: Record<string, SceneRoom>;
}

const lin = (hex: number): Rgb => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const linOf = (srgb: readonly number[]): Rgb => {
  const c = new THREE.Color().setRGB(srgb[0], srgb[1], srgb[2], THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
};
/** Яркость линейного цвета (Rec. 709). */
export const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Закрытая дверь — щит во весь проём по оси стены (в игре створки — doors.ts; на запечку их положение не влияет). */
function doorLeaves(l: ReturnType<typeof layoutOf>, room: number): number[] {
  const out: number[] = [];
  for (const d of l.doors) {
    if (!d.rooms.includes(room)) continue;
    const [lo, hi] = d.kind === 'hatch' ? [HATCH.low, HATCH.high] : [0, d.kind === 'dock' ? DOCK_H : d.kind === 'gate' ? GATE_H : DOOR_H];
    const [x0, z0] = d.cells[0];
    const n = d.cells.length;
    const t = 0.02;
    const [ax0, ax1, az0, az1] = d.along === 'x' ? [x0, x0 + n, z0 + 0.5 - t, z0 + 0.5 + t] : [x0 + 0.5 - t, x0 + 0.5 + t, z0, z0 + n];
    const g = new THREE.BoxGeometry(ax1 - ax0, hi - lo, az1 - az0).toNonIndexed();
    g.translate((ax0 + ax1) / 2, (lo + hi) / 2, (az0 + az1) / 2);
    out.push(...(g.attributes.position.array as Float32Array));
  }
  return out;
}

export function sceneOf(db: ContentDb): BlenderScene {
  const finish: Record<string, SceneFinish> = {};
  for (const [k, f] of Object.entries({ ...FINISH, glass: GLASS })) finish[k] = { color: lin(f.color), rough: f.rough, metal: f.metal, ...(f.opacity !== undefined ? { opacity: f.opacity } : {}) };
  const machine = (type: string): SceneMachine => {
    const e = db.equipment[type];
    return { size: e.size.map(v => v / 100) as Rgb, model: e.model, wear: e.parts.map(p => p.id) };
  };
  const machines: Record<string, SceneMachine> = {};
  for (const t of BUILD.machines) machines[t] = machine(t);
  // план игры (src/app/game.ts, `PLANT`)
  const plan = planOf(db, 'plant.proto');
  const l = layoutOf(plan);
  const walls = buildWalls(l).mesh.geometry.attributes.position.array as Float32Array;
  const lamps = lampPoints(l);
  const rooms: Record<string, SceneRoom> = {};
  for (const id of BUILD.rooms) {
    const n = l.rooms.findIndex(r => r.id === id);
    const r = l.rooms[n];
    if (!r) throw new Error(`нет помещения ${id}`);
    const rect = bakeRect(r);
    // стены в клетках помещения: треугольники, чья середина — в его прямоугольнике со стенами
    const tris: number[] = [];
    for (let i = 0; i < walls.length; i += 9) {
      const cx = (walls[i] + walls[i + 3] + walls[i + 6]) / 3;
      const cz = (walls[i + 2] + walls[i + 5] + walls[i + 8]) / 3;
      if (cx < r.x - 1e-3 || cx > r.x + r.w + 1e-3 || cz < r.z - 1e-3 || cz > r.z + r.d + 1e-3) continue;
      for (let k = 0; k < 9; k++) tris.push(Math.round(walls[i + k] * 1e4) / 1e4);
    }
    for (const v of doorLeaves(l, n)) tris.push(Math.round(v * 1e4) / 1e4);
    const own = lamps.filter(p => p.room === n);
    // средняя яркость холста по точкам запечки — по серединам её точек
    let sum = 0;
    const W = rect[2] * BAKE_PX;
    const H = rect[3] * BAKE_PX;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) sum += luma(linOf(poolAt(l, lamps, rect[0] + (i + 0.5) / BAKE_PX, rect[1] + (j + 0.5) / BAKE_PX)));
    const equipment = plan.plant.equipment.filter(e => e.room === id).map(e => ({ type: e.type, x: e.at[0] / 100, z: e.at[1] / 100, turn: e.turn }));
    for (const e of equipment) if (!machines[e.type]) machines[e.type] = machine(e.type);
    rooms[id] = {
      rect,
      px: BAKE_PX,
      height: WALL_LOW_ROOM,
      floor: lin(Number.parseInt(EPOXY.slice(1), 16)),
      panel: linOf(PANEL),
      lamps: own.map(p => ({ x: p.x, z: p.z, y: lampHeight(l, p) })),
      glow: LAMP_GLOW,
      tint: linOf(lampTint(r).map(c => c / 255)),
      walls: tris,
      equipment,
      pool: Math.round((sum / (W * H)) * 1e6) / 1e6,
    };
  }
  return { blender: BLENDER, finish, machines, rooms };
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
export const OUTPUTS: Output[] = [
  ...BUILD.machines.map(t => ({
    path: `machines/${t.replace(/^eq\./, '')}.glb`,
    script: 'blender/press.py',
    scripts: ['blender/lib.py', 'blender/press.py'],
    input: (s: BlenderScene) => ({ blender: s.blender, finish: s.finish, machine: s.machines[t] }),
  })),
  ...BUILD.rooms.flatMap(id =>
    (['light', 'ao'] as const).map(k => ({
      path: `rooms/${id}-${k}.png`,
      script: 'blender/room.py',
      scripts: ['blender/lib.py', 'blender/press.py', 'blender/room.py'],
      input: (s: BlenderScene) => ({ blender: s.blender, finish: s.finish, machines: s.machines, room: s.rooms[id] }),
    })),
  ),
];

/** Что окно грузит из Blender (assets/models/index.json, src/render/blender.ts `ArtIndex`). */
export const ART_INDEX = {
  machines: Object.fromEntries(BUILD.machines.map(t => [t, `machines/${t.replace(/^eq\./, '')}.glb`])),
  rooms: Object.fromEntries(BUILD.rooms.map(id => [id, { light: `rooms/${id}-light.png`, ao: `rooms/${id}-ao.png` }])),
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
