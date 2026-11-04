// Часть Б7а: план здания — часть игры (docs/specs/2026-10-vertical-slice.md, «Б7а»). План — в состоянии: копия записи
// базы с первым этажом и номером правки 0; после старта запись базы не читает никто — ни движок, ни прогон плана, ни
// загрузка; копия состояния и сохранение — тот же план, образец прежней схемы — с планом сценария. Проверки
// планировки — функции движка (`src/engine/site/checks.ts`), сборщик базы говорит их словами; этаж не первый — ошибка
// и там, и там. Поток расчёта шлёт план на старте и после загрузки, срез несёт номер правки; сцена из его плана — та
// же, что из базы.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import type { ContentDb, Plant } from '../../src/content/types';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, newPlant } from '../../src/engine/engine';
import { runSeed } from '../../src/engine/plan/run';
import { planOf } from '../../src/engine/plant';
import { fromSave, toSave } from '../../src/engine/save';
import { FLOOR, type SiteError, siteErrors } from '../../src/engine/site/checks';
import { planRev, SCHEMA } from '../../src/engine/types';
import { type Layout, layoutOf } from '../../src/render/layout';
import { createSim } from '../../src/sim/host';
import { H, Packer, unpack } from '../../src/sim/pack';
import { buildDb } from '../content/load';
import { planErrors, siteErrorText } from '../content/plan';

const SC = 'scn.proto';
const PLANT = db.scenarios[SC].plant;

/** База без планов: любое обращение к `plants` — ошибка. После старта завод живёт с ней так же, как с настоящей. */
const deny = (): never => {
  throw new Error('plants: после старта запись плана не читают');
};
const blind: ContentDb = {
  ...db,
  plants: new Proxy({} as ContentDb['plants'], { get: deny, has: deny, ownKeys: deny, getOwnPropertyDescriptor: deny }),
};

describe('план — в состоянии', () => {
  test('на старте — запись базы: первый этаж у помещений, рамп и точек плана, номер правки 0; проверки движка — без ошибок', () => {
    const s = newPlant(db, { scenario: SC });
    expect(s.plan).toEqual(db.plants[PLANT]);
    expect(planRev(s.plan)).toBe(0);
    expect(s.plan.rooms.every(r => r.floor === FLOOR)).toBe(true);
    expect(s.plan.docks.every(d => d.floor === FLOOR)).toBe(true);
    expect(s.plan.points.floor).toBe(FLOOR);
    expect(siteErrors(db, s.plan)).toEqual([]);
    // номера записи плана отдельным полем нет — он у плана; полей верхнего уровня не больше 63 (docs/02-architecture.md, §4)
    expect('plant' in s).toBe(false);
    expect(Object.keys(s).length).toBeLessThanOrEqual(63);
  });

  test('после старта запись базы не читает никто: с базой без планов — та же жизнь, то же сохранение и та же загрузка', () => {
    // старт читает запись — с базой без планов он невозможен
    expect(() => newPlant(blind, { scenario: SC })).toThrow('plants');
    const a = newPlant(db, { scenario: SC });
    const b = newPlant(db, { scenario: SC });
    apply(db, a, { kind: 'advance', seconds: 5 * DAY });
    apply(blind, b, { kind: 'advance', seconds: 5 * DAY });
    expect(fingerprint(b)).toBe(fingerprint(a));
    const back = fromSave(blind, toSave(b));
    expect(back.plan).toEqual(a.plan);
    expect(planRev(back.plan)).toBe(0);
    apply(blind, back, { kind: 'advance', seconds: DAY });
    apply(db, a, { kind: 'advance', seconds: DAY });
    expect(fingerprint(back)).toBe(fingerprint(a));
  });

  test('копия состояния и загрузка — тот же план; прогон плана делит план с заводом и не читает запись базы', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: DAY });
    expect(structuredClone(s).plan).toEqual(s.plan);
    const back = fromSave(db, toSave(s));
    expect(back.plan).toEqual(s.plan);
    expect(planRev(back.plan)).toBe(planRev(s.plan));
    const c = runSeed(db, s, [], { days: 2, seeds: 1 }, 0);
    expect(c.plan).toBe(s.plan);
    expect(fingerprint(runSeed(blind, s, [], { days: 2, seeds: 1 }, 0))).toBe(fingerprint(c));
  });

  test('образец прежней схемы открывается с планом сценария и номером правки 0 — и схемы 45, и схемы 1 без номера плана', () => {
    for (const v of [45, 1]) {
      const s = fromSave(db, readFileSync(join(import.meta.dir, `fixtures/save-v${v}.json`), 'utf8'));
      expect(s.schema).toBe(SCHEMA);
      expect(s.plan).toEqual(db.plants[PLANT]);
      expect(planRev(s.plan)).toBe(0);
      apply(db, s, { kind: 'advance', seconds: HOUR });
    }
  });

  test('образец схемы 46 несёт план сам: открывается и живёт с базой без планов', () => {
    const s = fromSave(blind, readFileSync(join(import.meta.dir, 'fixtures/save-v46.json'), 'utf8'));
    expect(s.plan).toEqual(db.plants[PLANT]);
    expect(planRev(s.plan)).toBe(0);
    apply(blind, s, { kind: 'advance', seconds: HOUR });
  });
});

describe('проверки планировки — функции движка', () => {
  test('этаж не первый — ошибка движка с вещью и этажом; сборщик говорит ошибки движка его словами', () => {
    const p: Plant = structuredClone(db.plants[PLANT]);
    p.rooms[0].floor = 2;
    p.docks[1].floor = 0;
    p.points.floor = 3;
    const errs = siteErrors(db, p);
    expect(errs).toEqual([
      { code: 'floor', thing: p.rooms[0].id, floor: 2 },
      { code: 'floor', thing: p.docks[1].id, floor: 0 },
      { code: 'floor', thing: 'points', floor: 3 },
    ]);
    const words = planErrors({ ...db, plants: { ...db.plants, [PLANT]: p } }, PLANT);
    expect(words).toEqual(errs.map(e => `план ${PLANT}: ${siteErrorText(e)}`));
    expect(words[0]).toBe(`план ${PLANT}: ${p.rooms[0].id}: этаж 2 — в 1.0 этаж один, первый`);
  });

  test('у каждой ошибки — слова сборщика без пустых мест', () => {
    const all: SiteError[] = [
      { code: 'doorWall', door: 0, x: 1, z: 2 },
      { code: 'doorSides', door: 0, x: 1, z: 2 },
      { code: 'doorMixed', door: 0 },
      { code: 'dockInner', door: 0 },
      { code: 'airlock', door: 0, from: 'hall', to: 'clean' },
      { code: 'airlock', door: 0 },
      { code: 'amenity', room: 'rest' },
      { code: 'vehicleD', room: 'compression' },
      { code: 'zoneFloor', zone: 'quar', x: 1, z: 2 },
      { code: 'outOfRoom', thing: 'press', room: 'compression' },
      { code: 'entrance' },
      { code: 'park' },
      { code: 'walk', what: { kind: 'room', id: 'lab' } },
      { code: 'drive', what: { kind: 'slot', id: 'quar-01' } },
      { code: 'walk', what: { kind: 'post', id: 'role.qa' } },
      { code: 'drive', what: { kind: 'dock', id: 'in' } },
      { code: 'post', role: 'role.qa' },
      { code: 'dockGate', dock: 'in' },
      { code: 'floor', thing: 'lab', floor: 2 },
    ];
    for (const e of all) {
      const text = siteErrorText(e);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('undefined');
    }
  });
});

describe('сборщик базы на испорченной копии content/', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  /** Копия `content/` с правками записи плана; сборка — её ошибки и база. */
  function broken(edits: [string, string][]): ReturnType<typeof buildDb> {
    const dir = mkdtempSync(join(tmpdir(), 'pharma-content-'));
    dirs.push(dir);
    cpSync(join(import.meta.dir, '../../content'), dir, { recursive: true });
    const p = join(dir, 'plants/proto.yaml');
    let text = readFileSync(p, 'utf8');
    for (const [a, b] of edits) {
      expect(text.includes(a)).toBe(true);
      text = text.replace(a, b);
    }
    writeFileSync(p, text);
    return buildDb(dir);
  }

  test('ошибки плана сборщика — ошибки движка; этаж в записи не первый — ошибка сборщика', () => {
    expect(broken([]).errors).toEqual([]);
    // дверь пробоотборной — внутри шлюза, не на стене
    const door = broken([['{ at: [23, 4], len: 1, along: x, kind: door }', '{ at: [23, 6], len: 1, along: x, kind: door }']]);
    const mine = door.errors.filter(e => e.startsWith(`план ${PLANT}: `));
    expect(mine).toContain(`план ${PLANT}: дверь 4 (23, 6) — не на стене`);
    expect(mine).toEqual(siteErrors(door.db, door.db.plants[PLANT]).map(e => `план ${PLANT}: ${siteErrorText(e)}`));
    const floor = broken([['{ id: in, kind: in, x: 0, z: 5 }', '{ id: in, kind: in, x: 0, z: 5, floor: 2 }']]);
    expect(floor.errors.some(e => e.includes('в 1.0 этаж один — первый (Б7а)'))).toBe(true);
  });
});

describe('окно — план от потока расчёта', () => {
  test('поток шлёт план на старте и после загрузки, а не с каждым срезом; срез несёт номер правки плана', () => {
    const sim = createSim(db);
    const first = sim.handle({ kind: 'start', scenario: SC });
    if (first.kind !== 'slice') throw new Error(first.kind);
    expect(first.world?.plan).toEqual(db.plants[PLANT]);
    expect(first.world?.rev).toBe(0);
    expect(unpack(first.buf).rev).toBe(0);
    const next = sim.handle({ kind: 'tick', seconds: HOUR, budgetMs: 60_000 });
    if (next.kind !== 'slice') throw new Error(next.kind);
    expect(next.world).toBeUndefined();
    const saved = sim.handle({ kind: 'save' });
    if (saved.kind !== 'saved') throw new Error(saved.kind);
    const loaded = sim.handle({ kind: 'load', json: saved.json });
    if (loaded.kind !== 'slice') throw new Error(loaded.kind);
    expect(loaded.world?.plan).toEqual(db.plants[PLANT]);
    expect(loaded.world?.rev).toBe(0);
  });

  test('сцена из плана потока — та же, что из записи базы: и через границу потоков, и после загрузки', () => {
    const sim = createSim(db);
    const first = sim.handle({ kind: 'start', scenario: SC });
    if (first.kind !== 'slice' || !first.world) throw new Error('slice: no plan');
    // что сцена берёт из плана: раскладку, сетку и точки — без кэшей полей расстояний и клеток доступа, они растут от
    // запросов
    const scene = (l: Layout) => ({
      w: l.w,
      h: l.h,
      rooms: l.rooms,
      doors: l.doors,
      nav: { cells: l.nav.cells, room: l.nav.room, door: l.nav.door, blocked: l.nav.blocked, walk: l.nav.walk, drive: l.nav.drive },
      plan: { plant: l.plan.plant, slots: l.plan.slots, dock: l.plan.dock, room: l.plan.room, lab: l.plan.lab, park: l.plan.park, entrance: l.plan.entrance, posts: l.plan.posts },
    });
    const base = scene(layoutOf(planOf(db, db.plants[PLANT])));
    // сообщение потока копируется структурно — у окна свой объект плана и свой разбор
    expect(scene(layoutOf(planOf(db, structuredClone(first.world.plan))))).toEqual(base);
    const saved = sim.handle({ kind: 'save' });
    if (saved.kind !== 'saved') throw new Error(saved.kind);
    const loaded = sim.handle({ kind: 'load', json: saved.json });
    if (loaded.kind !== 'slice' || !loaded.world) throw new Error('slice: no plan');
    expect(scene(layoutOf(planOf(db, structuredClone(loaded.world.plan))))).toEqual(base);
  });

  test('номер правки в заголовке среза — из состояния', () => {
    const s = newPlant(db, { scenario: SC });
    // правка стройки (Б7б) даст новый объект плана с номером на один больше; здесь — третья правка того же плана
    s.plan = { ...s.plan, rev: 3 };
    const buf = new Packer(db).pack(s, 0);
    expect(buf[H.rev]).toBe(3);
    expect(unpack(buf).rev).toBe(3);
  });
});
