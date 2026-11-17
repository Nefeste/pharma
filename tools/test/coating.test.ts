// Часть Б7д, шаг 1: покрытие плёночной оболочкой (docs/specs/2026-10-vertical-slice.md, «Б7д», «Проверки Б7д»).
// Метформин в базе — продукт-проект: его карта, спецификации, методики покрытия и процедура коатера без дня «в силе»;
// серию по такой карте не заказать. Стадию покрытия тест проходит на копии базы, где редакции-проекты в силе с первого
// дня (так их введёт проект «Новый продукт», шаг 2), на заводе с помещением покрытия к востоку от корпуса и коатером;
// путь единиц сокращён — записи квалификации и калибровки как у единиц старта.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { type ContentDb, DRAFT_DAY } from '../../src/content/types';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { statusOf } from '../../src/engine/docs';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { cleanWork, washWork } from '../../src/engine/mes';
import { planOf } from '../../src/engine/plant';
import { fromSave, toSave } from '../../src/engine/save';
import { editPlan } from '../../src/engine/site/edit';
import { footError } from '../../src/engine/site/units';
import { createLot, findSlot } from '../../src/engine/stock';
import type { Batch, Notice, PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const RCP = 'rcp.metformin500.wet.v1';
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

/** Завод с помещением покрытия к востоку от корпуса (клетки — как у второго таблетирования Б7г), коатером и весами. */
function withCoating(base: ContentDb): { s: PlantState; room: string; coater: string } {
  const s = newPlant(base, { scenario: SC });
  const site = (op: object) => expect(apply(base, s, { kind: 'site', op } as never).some(n => n.kind === 'site' && n.ok)).toBe(true);
  site({ op: 'hull', rect: [59, 1, 12, 12] });
  site({ op: 'room', type: 'corridor.clean', grade: 'D', rect: [59, 9, 12, 4] });
  site({ op: 'room', type: 'coating', grade: 'D', rect: [59, 1, 8, 9] });
  site({ op: 'door', cell: [59, 10], len: 2, along: 'z', kind: 'double' });
  site({ op: 'door', cell: [62, 9], len: 2, along: 'x', kind: 'double' });
  site({ op: 'done' });
  const room = s.plan.rooms.find(r => r.type === 'coating')!.id;
  const bought: string[] = [];
  for (const type of ['eq.coater', 'inst.balance']) {
    const at = base.equipment[type] ? { at: spot(base, s, type, room), turn: 0 } : {};
    const n = apply(base, s, { kind: 'equip', op: { op: 'buy', type, vendor: 'ven.ru', room, ...at } }).find(x => x.kind === 'equip') as Extract<Notice, { kind: 'equip' }> & { ok: true; thing: string };
    expect(n.ok).toBe(true);
    bought.push(n.thing);
  }
  // путь единицы — Б7в: записи — как у сушилки и весов старта
  for (const [id, like] of [
    [bought[0], 'eq.fbd'],
    [bought[1], 'inst.balance'],
  ]) {
    const a = s.assets[id];
    a.recs = structuredClone(Object.values(s.assets).find(x => x.type === like && x.id !== id && !x.path)!.recs);
    delete a.path;
  }
  // АФС метформина и система покрытия — на склад, разрешёнными
  const plan = planOf(base, s.plan);
  const near = plan.slot[plan.byKind.staging[0].id];
  for (const [material, supplier, qty] of [
    ['mat.api.metformin', 'sup.api-met', 250_000_000],
    ['mat.exc.coat', 'sup.exc', 20_000_000],
  ] as const) {
    createLot(base, s, { material, supplier, qty, status: 'released', where: () => ({ kind: 'slot', id: findSlot(s, plan, 'storage', near, 99)!.id }) });
  }
  return { s, room, coater: bought[0] };
}

/** Жить по часу до условия, не дольше `days` суток. */
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

describe('продукт-проект', () => {
  test('метформин — карта, спецификации, методики покрытия и процедура коатера без дня «в силе»; серию не заказать', () => {
    const s = newPlant(db, { scenario: SC });
    const day = 1_000;
    expect(statusOf(db, 'recipes', RCP, day)).toBe('draft');
    expect(statusOf(db, 'specs', 'spec.bulk.metformin500', day)).toBe('draft');
    expect(statusOf(db, 'tests', 'test.ipc.gain', day)).toBe('draft');
    expect(statusOf(db, 'sops', 'sop.coater', day)).toBe('draft');
    const ns = apply(db, s, { kind: 'order', recipe: RCP });
    expect(ns.filter(n => n.kind === 'refused').map(n => (n as Extract<Notice, { kind: 'refused' }>).why)).toEqual(['draftRecipe']);
    expect(Object.values(s.batches).some(b => b.recipe === RCP)).toBe(false);
  });
});

describe('стадия покрытия', () => {
  test('после таблетирования — в помещении покрытия на коатере: режимы, МОК привеса и дефектов, балк', () => {
    const base = liveDb();
    const { s, room, coater } = withCoating(base);
    const b = order(base, s);
    until(base, s, () => b.records.some(r => r.stage === 'coat') || b.status === 'bulk', 25);
    until(base, s, () => b.status !== 'process', 3);
    const rec = b.records.find(r => r.stage === 'coat')!;
    expect(rec.room).toBe(room);
    expect(Object.keys(rec.params).sort()).toEqual(['bedTemp', 'pan', 'spray']);
    expect(rec.ipc.some(x => x.test === 'test.ipc.gain')).toBe(true);
    expect(rec.ipc.some(x => x.test === 'test.ipc.defects')).toBe(true);
    // привес — около 3 % массы ядра, дефектов — меньше предела МОК 1 % (проценты — в долях 1/10 000)
    expect(Math.abs(b.truth.gain! - 300)).toBeLessThan(60);
    expect(b.truth.defects!).toBeLessThan(100);
    expect(s.equipment[coater].batch).toBeUndefined();
    expect(check(base, s)).toEqual([]);
  });

  test('подача выше цели — дефектов больше, причина в записях серии', () => {
    const base = liveDb();
    const { s } = withCoating(base);
    // уставку задаёт технолог — пост «Качество»; серию ставит «Производство»
    expect(apply(base, s, { kind: 'seat', seats: ['quality', 'production'] }).some(n => n.kind === 'refused')).toBe(false);
    const ns = apply(base, s, { kind: 'setpoint', recipe: RCP, stage: 'coat', param: 'spray', value: 420 });
    expect(ns.some(n => n.kind === 'refused')).toBe(false);
    const b = order(base, s);
    until(base, s, () => b.records.some(r => r.stage === 'coat'), 25);
    until(base, s, () => b.truth.defects !== undefined, 3);
    expect(b.causes.some(c => c.cause === 'cause.coat.spray' && c.attr === 'defects' && c.delta > 0)).toBe(true);
  });

  test('мойка помещения покрытия — с мойкой коатера: малая и генеральная', () => {
    const base = liveDb();
    const { s, room } = withCoating(base);
    const c = base.equipment['eq.coater'].cleaning;
    expect(washWork(base, s, room, false)).toBe(c.minor);
    expect(washWork(base, s, room, true)).toBe(c.major);
    expect(cleanWork(base, s, room, true)).toBeGreaterThan(c.major);
  });

  test('сохранение посреди покрытия — тот же завод', () => {
    const base = liveDb();
    const { s } = withCoating(base);
    const b = order(base, s);
    until(base, s, () => Object.values(s.tasks).some(t => t.kind === 'stage' && t.batch === b.id && base.recipes[b.recipe].stages[b.stage].id === 'coat'), 25);
    const back = fromSave(base, toSave(s));
    expect(JSON.stringify(back)).toBe(JSON.stringify(s));
    apply(base, back, { kind: 'advance', seconds: DAY });
    apply(base, s, { kind: 'advance', seconds: DAY });
    expect(toSave(back)).toBe(toSave(s));
  });
});
