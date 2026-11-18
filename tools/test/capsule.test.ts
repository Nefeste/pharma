// Часть Б8, шаг 1: капсулирование (docs/specs/2026-10-vertical-slice.md, «Б8», «Проверки Б8»). Флуконазол в базе —
// продукт-проект: карта, спецификации, методики МОК капсул и процедура машины без дня «в силе»; серию по такой карте не
// заказать. Стадию капсулирования тест проходит на копии базы, где редакции-проекты в силе с первого дня (так их введёт
// проект «Новый продукт», шаг 2), на заводе с помещением капсулирования к востоку от корпуса, машиной и весами; путь
// единиц сокращён — записи квалификации и калибровки как у единиц старта.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { type ContentDb, DRAFT_DAY } from '../../src/content/types';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { statusOf } from '../../src/engine/docs';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { washWork } from '../../src/engine/mes';
import { planOf } from '../../src/engine/plant';
import { fromSave, toSave } from '../../src/engine/save';
import { editPlan } from '../../src/engine/site/edit';
import { footError } from '../../src/engine/site/units';
import { createLot, findSlot } from '../../src/engine/stock';
import type { Batch, Notice, PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const RCP = 'rcp.fluconazole150.wet.v1';
const B = db.scenarios[SC].build!;

/** Копия базы: редакции-проекты — в силе с первого дня, заданий сценария нет. */
function liveDb(): ContentDb {
  const open = <T extends { doc: { from: number } }>(xs: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(xs).map(([k, x]) => [k, x.doc.from === DRAFT_DAY ? { ...x, doc: { ...x.doc, from: 0 } } : x]));
  return {
    ...db,
    recipes: open(db.recipes),
    specs: open(db.specs),
    tests: open(db.tests),
    sops: open(db.sops),
    agreements: open(db.agreements),
    scenarios: { ...db.scenarios, [SC]: { ...db.scenarios[SC], batches: [] } },
  };
}

/** Первое место в помещении, куда встаёт след класса. */
function spot(base: ContentDb, s: PlantState, type: string, room: string): [number, number] {
  const r = s.plan.rooms.find(x => x.id === room)!;
  for (let z = r.rect[1] + 100; z < r.rect[1] + r.rect[3] - 100; z += 100) {
    for (let x = r.rect[0] + 100; x < r.rect[0] + r.rect[2] - 100; x += 100) {
      const at: [number, number] = [x + 50, z + 50];
      if (!footError(base, s.plan, type, room, at, 0) && editPlan(base, B, s.plan, { op: 'unit', type, room, at, turn: 0, vendor: 'ven.ru' }, {}).ok) return at;
    }
  }
  throw new Error(`no spot for ${type} in ${room}`);
}

/** Завод с помещением капсулирования к востоку от корпуса, машиной и весами; АФС и пустые капсулы — на складе. */
function withCapsules(base: ContentDb): { s: PlantState; room: string; filler: string } {
  const s = newPlant(base, { scenario: SC });
  const site = (op: object) => expect(apply(base, s, { kind: 'site', op } as never).some(n => n.kind === 'site' && n.ok)).toBe(true);
  site({ op: 'hull', rect: [59, 1, 12, 12] });
  site({ op: 'room', type: 'corridor.clean', grade: 'D', rect: [59, 9, 12, 4] });
  site({ op: 'room', type: 'capsulation', grade: 'D', rect: [59, 1, 8, 9] });
  site({ op: 'door', cell: [59, 10], len: 2, along: 'z', kind: 'double' });
  site({ op: 'door', cell: [62, 9], len: 2, along: 'x', kind: 'double' });
  site({ op: 'done' });
  const room = s.plan.rooms.find(r => r.type === 'capsulation')!.id;
  const bought: string[] = [];
  for (const type of ['eq.encapsulator', 'inst.balance']) {
    const at = base.equipment[type] ? { at: spot(base, s, type, room), turn: 0 } : {};
    const n = apply(base, s, { kind: 'equip', op: { op: 'buy', type, vendor: 'ven.ru', room, ...at } }).find(x => x.kind === 'equip') as Extract<Notice, { kind: 'equip' }> & { ok: true; thing: string };
    expect(n.ok).toBe(true);
    bought.push(n.thing);
  }
  for (const [id, like] of [
    [bought[0], 'eq.press'],
    [bought[1], 'inst.balance'],
  ]) {
    const a = s.assets[id];
    a.recs = structuredClone(Object.values(s.assets).find(x => x.type === like && x.id !== id && !x.path)!.recs);
    delete a.path;
  }
  const plan = planOf(base, s.plan);
  const near = plan.slot[plan.byKind.staging[0].id];
  for (const [material, supplier, qty] of [
    ['mat.api.fluconazole', 'sup.api-flu', 200_000_000],
    ['mat.exc.capsule', 'sup.exc', 60_000_000],
  ] as const) {
    createLot(base, s, { material, supplier, qty, status: 'released', where: () => ({ kind: 'slot', id: findSlot(s, plan, 'storage', near, 99)!.id }) });
  }
  return { s, room, filler: bought[0] };
}

function until(base: ContentDb, s: PlantState, cond: () => boolean, days = 20) {
  const end = s.t + days * DAY;
  while (!cond() && s.t < end) apply(base, s, { kind: 'advance', seconds: HOUR });
  expect(cond()).toBe(true);
}

const order = (base: ContentDb, s: PlantState): Batch => {
  const before = new Set(Object.keys(s.batches));
  apply(base, s, { kind: 'order', recipe: RCP });
  return Object.values(s.batches).find(b => !before.has(b.id))!;
};

/** Серия с уставками капсулирования: до конца стадии и итога серии. */
function batchWith(sets: { param: string; value: number }[]): { b: Batch; s: PlantState; base: ContentDb } {
  const base = liveDb();
  const { s } = withCapsules(base);
  if (sets.length) expect(apply(base, s, { kind: 'seat', seats: ['quality', 'production'] }).some(n => n.kind === 'refused')).toBe(false);
  for (const x of sets) expect(apply(base, s, { kind: 'setpoint', recipe: RCP, stage: 'encap', ...x }).some(n => n.kind === 'refused')).toBe(false);
  const b = order(base, s);
  until(base, s, () => b.records.some(r => r.stage === 'encap'), 25);
  until(base, s, () => b.status !== 'process', 3);
  return { b, s, base };
}

describe('продукт-проект', () => {
  test('флуконазол — карта, спецификации, методики МОК капсул и процедура машины без дня «в силе»; серию не заказать', () => {
    const s = newPlant(db, { scenario: SC });
    const day = 1_000;
    expect(db.products['prd.fluconazole150'].form).toBe('capsule');
    expect(statusOf(db, 'recipes', RCP, day)).toBe('draft');
    expect(statusOf(db, 'specs', 'spec.bulk.fluconazole150', day)).toBe('draft');
    expect(statusOf(db, 'tests', 'test.ipc.capmass', day)).toBe('draft');
    expect(statusOf(db, 'sops', 'sop.encapsulator', day)).toBe('draft');
    const ns = apply(db, s, { kind: 'order', recipe: RCP });
    expect(ns.filter(n => n.kind === 'refused').map(n => (n as Extract<Notice, { kind: 'refused' }>).why)).toEqual(['draftRecipe']);
  });

  test('карта: капсулирование — после опудривания, в помещении капсулирования на машине; капсулы — на капсулировании', () => {
    const r = db.recipes[RCP];
    expect(r.stages.map(st => st.id)).toEqual(['dispense', 'granulate', 'dry', 'mill', 'blend', 'encap']);
    const enc = r.stages.at(-1)!;
    expect(enc.room).toBe('capsulation');
    expect(enc.equipment).toEqual(['eq.encapsulator']);
    expect(r.bom.find(l => l.material === 'mat.exc.capsule')!.stage).toBe('encap');
  });
});

describe('стадия капсулирования', () => {
  test('серия по цели: МОК массы и дефектов, балк капсул; машина свободна, завод цел', () => {
    const { b, s, base } = batchWith([]);
    const rec = b.records.find(r => r.stage === 'encap')!;
    expect(Object.keys(rec.params).sort()).toEqual(['disc', 'speed', 'tamp']);
    expect(rec.ipc.some(x => x.test === 'test.ipc.capmass')).toBe(true);
    expect(rec.ipc.some(x => x.test === 'test.ipc.capdefects')).toBe(true);
    // масса — около номинала, дефектов — меньше предела МОК 1 % (доли 1/10 000)
    expect(Math.abs(b.truth.mass! - 10_000)).toBeLessThan(200);
    expect(b.truth.defects!).toBeLessThan(100);
    expect(s.lots[b.bulk!].material).toBe('mat.bulk.fluconazole150');
    expect(check(base, s)).toEqual([]);
  });

  test('диск толще цели — капсулы тяжелее и содержание за массой, причины в записях серии', () => {
    const { b } = batchWith([{ param: 'disc', value: 1560 }]);
    const c = b.causes.find(x => x.cause === 'cause.encap.disc' && x.attr === 'mass')!;
    expect(c.delta).toBeGreaterThan(300);
    expect(b.truth.mass!).toBeGreaterThan(10_200);
    // содержание следует за массой (cause.press.mass); выше 100 % движок его не ставит
    expect(b.causes.find(x => x.cause === 'cause.press.mass' && x.attr === 'assay')!.delta).toBeGreaterThan(200);
  });

  test('скорость выше цели — дефектов больше; сила трамбовки на массу не влияет', () => {
    const fast = batchWith([{ param: 'speed', value: 120 }]).b;
    expect(fast.causes.some(x => x.cause === 'cause.encap.speed' && x.attr === 'defects' && x.delta > 0)).toBe(true);
    const tamp = batchWith([{ param: 'tamp', value: 20 }]).b;
    expect(tamp.records.find(r => r.stage === 'encap')!.params.tamp).toBeGreaterThan(17);
    expect(tamp.causes.filter(x => x.attr === 'mass').every(x => x.cause === 'cause.encap.disc' || x.cause === 'cause.encap.density')).toBe(true);
    expect(Object.values(db.causes).some(c => 'param' in c.driver && c.driver.param === 'tamp')).toBe(false);
  });

  test('у таблеток скорость ротора выше цели не даёт дефектов капсул', () => {
    expect(db.causes['cause.encap.speed'].products).toEqual(['prd.fluconazole150']);
  });

  test('мойка помещения капсулирования — с мойкой машины', () => {
    const base = liveDb();
    const { s, room } = withCapsules(base);
    const c = base.equipment['eq.encapsulator'].cleaning;
    expect(washWork(base, s, room, false)).toBe(c.minor);
    expect(washWork(base, s, room, true)).toBe(c.major);
  });

  test('сохранение посреди капсулирования — тот же завод', () => {
    const base = liveDb();
    const { s } = withCapsules(base);
    const b = order(base, s);
    until(base, s, () => Object.values(s.tasks).some(t => t.kind === 'stage' && t.batch === b.id && base.recipes[b.recipe].stages[b.stage].id === 'encap'), 25);
    const back = fromSave(base, toSave(s));
    expect(JSON.stringify(back)).toBe(JSON.stringify(s));
    apply(base, back, { kind: 'advance', seconds: DAY });
    apply(base, s, { kind: 'advance', seconds: DAY });
    expect(toSave(back)).toBe(toSave(s));
  });
});
