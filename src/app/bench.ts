// из bolnitsa: src/app/bench.ts @ e0a3491 — изменено: завод вместо больницы. Промотка — до часа первой упаковки (шестые
// сутки, 12:00); сцена спецификации прототипа — все места стеллажей заняты и ещё 700 паллет блоками во дворе (только для
// отрисовки, в учёте их нет: docs/specs/2026-10-view.md, 2г); проход камеры — вдоль склада и линии; четыре снимка — общий
// план, склад, линия, машина. Людей и техники — сколько у движка в этот час.
//
// Авто-бенч в игре: дальше часы идут на ×1. Пресеты × два плана камеры: общий план и проход крупным планом. Числа — как у
// «Больницы»: кадр, процессор, видеокарта, поток расчёта, вызовы отрисовки, треугольники, люди полной и упрощённой
// моделью. В конце — четыре снимка 1920×1080 на «высоком». Со слоем «Загрузка и OEE» (Б1и) — тот же замер с ним.
import * as THREE from 'three';
import { T } from '../i18n';
import { AT, camDetail, speedDetail } from '../render/detail';
import { levelY } from '../render/layout';
import type { PalletView } from '../render/loads';
import type { Quality } from '../render/view';
import { PRESETS, QUALITIES } from '../render/view';
import { YARD_Y } from '../render/world';
import type { Game } from './game';
import { since, summarize } from './stats';

export interface BenchOpts {
  secs?: number;
  warm?: number;
  qualities?: Quality[];
  shots?: boolean;
  /** слой слева: «Загрузка и OEE» (Б1и), «Узкие места» и «Проблемы» (Б1к) — замер с включённым слоем, рядом с прежним */
  layer?: (typeof BENCH_LAYERS)[number];
}

/** Слои данных, с которыми бенч меряет сцену. */
export const BENCH_LAYERS = ['load', 'bottle', 'andon'] as const;

/**
 * Сцена спецификации прототипа (критерии приёмки, «3D»): сутки и час завода (сутки — как в верхней полосе, с первых);
 * сколько паллет поставить сверх учёта во дворе — «700 в запасе сцены». Места стеллажей заполняются все — «300 на
 * стеллажах» (в плане их 288).
 */
export const SCENE = { day: 6, hour: 12, extra: 700 } as const;

/** Полная паллета ящиков: 8 на слой, 5 слоёв (loads.ts) — высота с основанием, м. */
const CASES = { fill: 40, height: 0.144 + 5 * 0.25 + 0.02 };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let running = false;

/**
 * Промотать завод до момента `until` (игровые секунды) так быстро, как успевает поток: кусками по два игровых часа на кадр —
 * у завода до первой упаковки шесть суток, а не утро одной смены, как у «Больницы».
 */
export async function fastForward(g: Game, until: number) {
  g.manual = true;
  await new Promise<void>(resolve => {
    g.onFrame = () => {
      if (g.t >= until) {
        g.onFrame = null;
        resolve();
        return;
      }
      // последний кусок — ровно до цели: срез придёт в тот самый час
      const left = until - (g.t + g.lag + g.client.ahead);
      g.client.frame(!g.client.busy && g.lag < 600 ? Math.max(0, Math.min(7200, left)) : 0, 60);
    };
  });
  g.manual = false;
}

/**
 * Паллеты сверх учёта — только нагрузка отрисовки: на свободных местах стеллажей и блоками в два яруса во дворе рамп,
 * между рампами (двор ниже пола здания).
 */
export function stressPallets(g: Game, extra: number): PalletView[] {
  const plan = g.layout.plan;
  const taken = new Set([...g.view.units.values()].filter(u => u.where === 'slot').map(u => u.ref));
  const out: PalletView[] = [];
  plan.slots.forEach((sl, i) => {
    if (sl.kind !== 'storage' || taken.has(i)) return;
    out.push({ x: sl.x / 100, z: sl.z / 100, y: levelY(sl.level), turn: 1, load: 'cases', fill: CASES.fill, tag: 'released' });
  });
  for (let k = 0; k < extra; k++) {
    const spot = Math.floor(k / 2);
    out.push({ x: -21.5 + (spot % 15) * 1.4, z: 8.5 + Math.floor(spot / 15) * 0.95, y: YARD_Y + (k % 2) * CASES.height, turn: 0, load: 'cases', fill: CASES.fill, tag: 'released' });
  }
  return out;
}

/** Точки прохода камеры: стеллажи, комплектация у шлюза, машины линии, таблетирование. */
function route(g: Game): THREE.Vector3[] {
  const plant = g.layout.plan.plant;
  const pts = [new THREE.Vector3(12, 0, 16.5), new THREE.Vector3(24, 0, 11)];
  for (const mc of plant.lines[0]?.machines ?? []) pts.push(new THREE.Vector3(mc.at[0] / 100, 0, mc.at[1] / 100));
  const press = plant.equipment.find(e => e.type === 'eq.press');
  if (press) pts.push(new THREE.Vector3(press.at[0] / 100, 0, press.at[1] / 100));
  return pts;
}

function along(pts: THREE.Vector3[], k: number, out: THREE.Vector3) {
  const f = Math.min(0.9999, Math.max(0, k)) * (pts.length - 1);
  const i = Math.floor(f);
  return out.copy(pts[i]).lerp(pts[Math.min(pts.length - 1, i + 1)], f - i);
}

/** Крупность показа сразу, без перехода: для снимков и смены плана камеры. */
function settle(g: Game) {
  const level = Math.max(camDetail(g.stage.cam.half, 1), speedDetail(g.speed, g.ff)) as 1 | 2 | 3;
  g.detail = AT[level];
  g.stage.setDetail(g.detail);
}

export async function runBench(g: Game, opts: BenchOpts) {
  if (running) return;
  running = true;
  const secs = opts.secs ?? 15;
  const warm = opts.warm ?? 3;
  const qualities = opts.qualities ?? QUALITIES;
  const store = g.store;
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const prefix = `bench-${window.shell ? 'electron' : 'browser'}-${stamp}`;
  const cams = ['overview', 'close'] as const;
  const runs: unknown[] = [];
  const startQuality = g.stage.quality;
  try {
    store.set({ status: T.debug.benchRunning });
    g.actions.setWalls('cut');
    // промотка — на низком пресете: кадр дешевле, промотка быстрее (замеры дальше — на каждом пресете)
    const target = (SCENE.day - 1) * 86400 + SCENE.hour * 3600;
    if (g.t < target) {
      g.actions.setQuality('low');
      await fastForward(g, target);
    }
    g.stage.reserve(g.layout.plan.slots.length + SCENE.extra + 256);
    g.extra = stressPallets(g, SCENE.extra);
    g.refreshPallets();
    // слой данных (Б1и, Б1к): включён до замеров — столбики, таблички или значки на полу из видов «Пол» и «Андон»
    if (opts.layer) {
      g.actions.setLayer(opts.layer);
      const got = () => (opts.layer === 'andon' ? !!store.get().andon.view : !!store.get().floor.view);
      for (let i = 0; i < 100 && !got(); i++) await sleep(100);
    }
    g.actions.setSpeed(1);
    const path = route(g);
    for (const q of qualities) {
      g.actions.setQuality(q);
      for (const cam of cams) {
        const name = cam === 'overview' ? T.debug.overviewCam : T.debug.closeCam;
        const place = (k: number) => {
          if (cam === 'overview') g.stage.cam.overview();
          else {
            along(path, k, g.stage.cam.target);
            g.stage.cam.half = 6;
          }
        };
        g.stage.cam.setYawNow(Math.PI / 4);
        place(0);
        settle(g);
        store.set({ status: T.debug.benchCell(T.debug.qualities[q], name, T.debug.warm) });
        await sleep(warm * 1000);
        const interval: number[] = [];
        const draw: number[] = [];
        const calls: number[] = [];
        const tris: number[] = [];
        const near: number[] = [];
        const far: number[] = [];
        // отметки — по счёту замеров, а не по длине их памяти: память обрезается
        const gpu0 = g.stage.gpu.taken;
        const rt0 = g.client.roundTripsTaken;
        let last = 0;
        const t0 = performance.now();
        g.onFrame = ts => {
          if (last) interval.push(ts - last);
          last = ts;
          place((performance.now() - t0) / (secs * 1000));
          const f = g.frames;
          if (f.draw.length) draw.push(f.draw[f.draw.length - 1]);
          calls.push(g.stage.calls);
          tris.push(g.stage.tris);
          const pc = g.stage.peopleCounts;
          near.push(pc.near);
          far.push(pc.far);
        };
        store.set({ status: T.debug.benchCell(T.debug.qualities[q], name, T.debug.measure) });
        await sleep(secs * 1000);
        g.onFrame = null;
        const gpu = since(g.stage.gpu.samples, g.stage.gpu.taken, gpu0);
        const iv = summarize(interval);
        const avg = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length));
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        const r = g.stage.renderer;
        const run = {
          renderer: 'three',
          quality: q,
          camera: cam,
          people: g.view.people.filter(p => p.present).length,
          vehicles: g.view.vehicles.length,
          pallets: g.view.units.size + g.extra.length,
          gameTime: g.t,
          frames: interval.length,
          fps: Math.round((interval.length / secs) * 10) / 10,
          frameMs: iv,
          over33ms: interval.filter(v => v > 33.4).length,
          over100ms: interval.filter(v => v > 100).length,
          drawCpuMs: summarize(draw),
          gpuMs: gpu.length ? summarize(gpu) : null,
          workerMs: summarize(since(g.client.roundTrips, g.client.roundTripsTaken, rt0)),
          drawCalls: avg(calls),
          triangles: avg(tris),
          peopleNear: Math.max(0, ...near),
          peopleFar: Math.max(0, ...far),
          gpuMemory: { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? null },
          renderPx: { w: r.domElement.width, h: r.domElement.height },
          preset: PRESETS[q],
          jsHeapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
          processMB: window.shell ? (await window.shell.metrics()).workingSetMB : null,
          gpu: g.stage.gpuName,
        };
        console.log(`[bench] ${JSON.stringify(run)}`);
        runs.push(run);
      }
    }
    let shots: unknown[] = [];
    if (opts.shots !== false) {
      store.set({ status: T.debug.shots });
      g.actions.setQuality('high');
      shots = await takeShots(g, prefix);
    }
    const info = window.shell ? await window.shell.info() : null;
    const plant = g.layout.plan.plant;
    const result = {
      probe: 'game',
      game: 'pharma',
      version: store.get().version,
      when: new Date().toISOString(),
      userAgent: navigator.userAgent,
      chromium: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? null,
      cores: navigator.hardwareConcurrency,
      viewport: { w: g.host.clientWidth, h: g.host.clientHeight, dpr: window.devicePixelRatio || 1 },
      settings: {
        secs, warm, qualities, cameras: cams, scenario: g.scenario.id, scene: SCENE, walls: 'cut', layer: opts.layer ?? 'plain',
        camera: 'perspective 20°, pitch 52°; overview and a close pass along the racks and the line (half-height 6 m)',
      },
      scene: {
        cells: `${g.layout.w}x${g.layout.h}`,
        rooms: plant.rooms.length,
        slots: g.layout.plan.slots.length,
        rackSlots: g.layout.plan.slots.filter(s => s.kind === 'storage').length,
        palletsInStock: g.view.units.size,
        palletsExtra: g.extra.length,
        equipment: plant.equipment.length,
        lineMachines: plant.lines.reduce((n, l) => n + l.machines.length, 0),
        lamps: g.stage.lamps.points.length,
        three: THREE.REVISION,
      },
      gpuTimer: g.stage.gpu.available,
      startup: { firstFrameMs: g.firstFrameMs },
      electron: info,
      shots,
      runs,
    };
    const json = JSON.stringify(result, null, 2);
    console.log(`BENCH_RESULT ${JSON.stringify({ ...result, electron: null })}`);
    window.__benchResult = result;
    if (window.shell) {
      const path = await window.shell.save(json);
      store.set({ status: T.debug.done(path) });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `${prefix}.json`;
      a.click();
      store.set({ status: T.debug.download });
    }
    setTimeout(() => store.set({ status: '' }), 15000);
    g.actions.setQuality(startQuality);
  } catch (e) {
    window.__benchError = String((e as Error)?.stack ?? e);
    store.set({ error: String(e) });
  } finally {
    g.onFrame = null;
    g.manual = false;
    running = false;
  }
}

interface ShotSpec {
  name: string;
  title: string;
  target: THREE.Vector3;
  half: number;
  yaw: number;
}

/** Четыре точки: общий план, склад со стеллажами, упаковочная линия, блистерная машина. */
function shotSpecs(g: Game): ShotSpec[] {
  const y = Math.PI / 4;
  const l = g.layout;
  const blister = l.plan.plant.lines[0]?.machines[0];
  const at = blister ? new THREE.Vector3(blister.at[0] / 100, 0, blister.at[1] / 100) : new THREE.Vector3(44, 0, 16.5);
  return [
    { name: '1-overview', title: T.shots.overview, target: new THREE.Vector3(l.w / 2, 0, l.h / 2), half: Math.max(l.h * 0.7, l.w * 0.4), yaw: y },
    { name: '2-racks', title: T.shots.racks, target: new THREE.Vector3(12, 0, 17), half: 8, yaw: y },
    { name: '3-line', title: T.shots.line, target: new THREE.Vector3(38, 0, 17), half: 8, yaw: y + Math.PI / 2 },
    { name: '4-machine', title: T.shots.machine, target: at, half: 3.5, yaw: y },
  ];
}

/** Снимки 1920×1080; `prefix` — начало имени файла. */
export async function takeShots(g: Game, prefix: string): Promise<{ name: string; title: string; path: string | null }[]> {
  const out: { name: string; title: string; path: string | null }[] = [];
  const cam = g.stage.cam;
  const save = { target: cam.target.clone(), half: cam.half, yaw: cam.yaw, speed: g.speed };
  window.__shots = [];
  g.actions.setSpeed(0);
  for (const s of shotSpecs(g)) {
    cam.target.copy(s.target);
    cam.half = s.half;
    cam.setYawNow(s.yaw);
    settle(g);
    const url = g.stage.shot(1920, 1080, (((g.t % 86400) + 86400) % 86400) / 3600);
    const name = `${prefix}-${s.name}.png`;
    window.__shots.push({ name, dataUrl: url });
    const path = window.shell ? await window.shell.saveShot(name, url) : null;
    out.push({ name, title: s.title, path });
    await sleep(50);
  }
  cam.target.copy(save.target);
  cam.half = save.half;
  cam.setYawNow(save.yaw);
  g.actions.setSpeed(save.speed);
  return out;
}
