// Часть Б7д, шаг 3: ибупрофен (docs/specs/2026-10-vertical-slice.md, «Б7д», «Шаги», 3). Второй продукт-проект: карта
// прямого прессования с покрытием, спецификации и позиция — без дня «в силе». Причины продукта: налипание на пуансоны —
// опудривание короче цели и ротор быстрее цели, растворение ниже — слой горячее цели; у других продуктов их нет. Серии
// тест проходит на копии базы, где редакции-проекты в силе с первого дня, как в тесте покрытия; проект целиком — на
// настоящей базе: помещение покрытия, коатер и весы — как в тесте проекта на метформине.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { type ContentDb, DRAFT_DAY } from '../../src/content/types';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { liveOf, statusOf } from '../../src/engine/docs';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { planOf } from '../../src/engine/plant';
import { gapsOf, rampOf } from '../../src/engine/project';
import { editPlan } from '../../src/engine/site/edit';
import { footError } from '../../src/engine/site/units';
import { createLot, findSlot } from '../../src/engine/stock';
import type { Batch, Notice, PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const RCP = 'rcp.ibuprofen200.dc.v1';
const IBU = 'prd.ibuprofen200';
const B = db.scenarios[SC].build!;
const why = (ns: Notice[]) => ns.flatMap(n => (n.kind === 'refused' ? [n.why] : []));

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
function withCoating(base: ContentDb, stock = true): { s: PlantState; room: string; coater: string } {
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
  // АФС ибупрофена и метформина, кроскармеллоза и система покрытия — на склад, разрешёнными
  if (!stock) return { s, room, coater: bought[0] };
  const plan = planOf(base, s.plan);
  const near = plan.slot[plan.byKind.staging[0].id];
  for (const [material, supplier, qty] of [
    ['mat.api.ibuprofen', 'sup.api-ibu', 250_000_000],
    ['mat.api.metformin', 'sup.api-met', 250_000_000],
    ['mat.exc.croscarmellose', 'sup.exc', 20_000_000],
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

const order = (base: ContentDb, s: PlantState, recipe = RCP): Batch => {
  const before = new Set(Object.keys(s.batches));
  expect(why(apply(base, s, { kind: 'order', recipe }))).toEqual([]);
  return Object.values(s.batches).find(b => !before.has(b.id))!;
};

/** Серия по карте с уставками технолога (значения — в единицах движка: минуты — секунды, °C — десятые); живёт, пока у неё не будет показателя `attr`. */
function batchWith(recipe: string, sets: { stage: string; param: string; value: number }[], attr: 'defects' | 'dissolution' | 'hardness'): Batch {
  const base = liveDb();
  const { s } = withCoating(base);
  expect(why(apply(base, s, { kind: 'seat', seats: ['quality', 'production'] }))).toEqual([]);
  for (const x of sets) expect(why(apply(base, s, { kind: 'setpoint', recipe, ...x }))).toEqual([]);
  const b = order(base, s, recipe);
  until(base, s, () => b.truth[attr] !== undefined, 30);
  return b;
}

describe('ибупрофен — продукт-проект', () => {
  test('карта, спецификации и позиция — без дня «в силе»; серию не заказать; сезон — «простуда и грипп»', () => {
    const s = newPlant(db, { scenario: SC });
    expect(statusOf(db, 'recipes', RCP, 1_000)).toBe('draft');
    expect(statusOf(db, 'specs', 'spec.bulk.ibuprofen200', 1_000)).toBe('draft');
    expect(statusOf(db, 'specs', 'spec.mat.api.ibuprofen', 1_000)).toBe('draft');
    expect(why(apply(db, s, { kind: 'order', recipe: RCP }))).toEqual(['draftRecipe']);
    expect(db.products[IBU].season).toBe('sea.cold');
    // спроса до ввода нет у покупателей прототипа; у дистрибьюторов «Первой зимы» он есть: там ибупрофен введён до старта
    for (const c of db.scenarios['scn.proto'].customers) expect(db.customers[c].demand['sku.ibuprofen200.n20']).toBeUndefined();
    expect(liveOf(db, undefined)).toBe(db);
  });

  test('проект: чего нет — помещение покрытия и пара изготовителя ибупрофена; кроскармеллоза — у одобренной пары', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'seat', seats: ['director'] });
    expect(why(apply(db, s, { kind: 'project', op: 'start', product: IBU }))).toEqual([]);
    const gaps = gapsOf(db, s, IBU);
    expect(gaps).toContainEqual({ kind: 'room', type: 'coating' });
    expect(gaps).toContainEqual({ kind: 'pair', material: 'mat.api.ibuprofen' });
    expect(gaps).not.toContainEqual({ kind: 'pair', material: 'mat.exc.croscarmellose' });
    // два проекта двух продуктов — можно
    expect(why(apply(db, s, { kind: 'project', op: 'start', product: 'prd.metformin500' }))).toEqual([]);
  });
});

describe('серия ибупрофена', () => {
  test('прямое прессование: отвешивание, смешивание, таблетирование, покрытие — балк; у режимов по цели налипания почти нет', () => {
    const base = liveDb();
    const { s, room } = withCoating(base);
    const b = order(base, s);
    until(base, s, () => b.records.some(r => r.stage === 'coat') && b.status !== 'process', 30);
    expect(b.records.map(r => r.stage)).toEqual(['dispense', 'blend', 'compress', 'coat']);
    expect(b.records.find(r => r.stage === 'coat')!.room).toBe(room);
    expect(b.truth.defects!).toBeLessThan(100);
    expect(b.code.n).toBeGreaterThan(0);
    expect(check(base, s)).toEqual([]);
  });

  test('опудривание короче цели — налипание: дефектов больше, причина в записях серии', () => {
    const b = batchWith(RCP, [{ stage: 'blend', param: 'lubeTime', value: 180 }], 'defects');
    expect(b.causes.some(c => c.cause === 'cause.press.stick' && c.attr === 'defects' && c.delta > 0)).toBe(true);
  });

  test('ротор быстрее цели — налипание от трения; опудривание дольше цели налипания не даёт', () => {
    const b = batchWith(
      RCP,
      [
        { stage: 'compress', param: 'speed', value: 60 },
        { stage: 'blend', param: 'lubeTime', value: 360 },
      ],
      'defects',
    );
    expect(b.causes.some(c => c.cause === 'cause.press.friction' && c.delta > 0)).toBe(true);
    expect(b.causes.some(c => c.cause === 'cause.press.stick')).toBe(false);
  });

  test('слой горячее цели — растворение ниже', () => {
    const b = batchWith(RCP, [{ stage: 'coat', param: 'bedTemp', value: 450 }], 'dissolution');
    expect(b.causes.some(c => c.cause === 'cause.coat.heat' && c.attr === 'dissolution' && c.delta < 0)).toBe(true);
  });

  test('у метформина те же режимы — без причин ибупрофена', () => {
    const b = batchWith(
      'rcp.metformin500.wet.v1',
      [
        { stage: 'compress', param: 'speed', value: 60 },
        { stage: 'blend', param: 'lubeTime', value: 180 },
        { stage: 'coat', param: 'bedTemp', value: 450 },
      ],
      'dissolution',
    );
    expect(b.causes.some(c => c.cause === 'cause.press.stick' || c.cause === 'cause.press.friction' || c.cause === 'cause.coat.heat')).toBe(false);
    expect(b.causes.some(c => c.cause === 'cause.press.speed')).toBe(true);
  });
});

describe('проект ибупрофена — до производства', () => {
  test('этапы те же, что у метформина; после досье — позиция в плане и в спросе с разгоном, заказы и задание на запас', () => {
    // помещение покрытия, коатер и весы — на настоящей базе: проект вводит редакции сам; материалы — заказом
    const { s } = withCoating(db, false);
    apply(db, s, { kind: 'seat', seats: ['director'] });
    expect(why(apply(db, s, { kind: 'project', op: 'start', product: IBU }))).toEqual([]);
    const stages: string[] = [];
    for (let i = 0; i < 330 && s.portfolio!.projects.P1.stage !== 'done'; i++)
      for (const n of apply(db, s, { kind: 'advance', seconds: DAY })) if (n.kind === 'project') stages.push(n.stage);
    expect(stages).toEqual(['methods', 'docs', 'clean', 'trial', 'protocol', 'validation', 'report', 'dossier', 'done']);
    const d = liveOf(db, s.portfolio!.docs);
    const SKU = 'sku.ibuprofen200.n20';
    expect(d.scenarios[SC].plan!.items.some(it => it.sku === SKU)).toBe(true);
    expect(d.customers['cus.national'].demand[SKU]).toBe(4500);
    expect(rampOf(d, s, SKU)).toBe(db.scenarios[SC].project!.ramp.from);
    until(db, s, () => Object.values(s.batches).some(b => b.product === IBU && b.for?.kind === 'stock' && b.status === 'released'), 120);
    expect(Object.values(s.orders).some(o => o.lines.some(l => l.sku === SKU))).toBe(true);
    expect(check(db, s)).toEqual([]);
  }, 600_000);
});
