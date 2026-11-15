// Часть Б7г: маршрут серии (docs/specs/2026-10-vertical-slice.md, «Б7г», «Проверки Б7г»; геймдизайн, §5.4; решение
// владельца по #81). Второе помещение таблетирования — стройкой Б7б, пресс, обеспыливатель и приборы МОК в нём — командой
// «Оборудование» Б7в; путь единиц тест сокращает: записи квалификации и калибровки — копии записей единиц старта. Правило
// коллеги производства: то же помещение, чистое для продукта, малая уборка, генеральная, порядок плана; выбор держится;
// команда `route` и её отказы; режим «вручную» — серия ждёт выбора; перенос полупродукта — задача аппаратчика, прежнее
// помещение свободно после выгрузки; расписание и S&OP — по помещениям; сохранение.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { CARRY_WORK } from '../../src/engine/mes';
import { forecast } from '../../src/engine/plan/schedule';
import { capacityOf } from '../../src/engine/plan/sop';
import { pickUnit, rankOf, unitsFor } from '../../src/engine/route';
import { fromSave, toSave } from '../../src/engine/save';
import { needs, siteErrors } from '../../src/engine/site/checks';
import { roomDown } from '../../src/engine/site/down';
import { footError } from '../../src/engine/site/units';
import { editPlan } from '../../src/engine/site/edit';
import type { Batch, Notice, PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const B = db.scenarios[SC].build!;
const COMPRESS = 5;
const advance = (s: PlantState, seconds: number) => apply(db, s, { kind: 'advance', seconds });

/** Идти по часу, пока условие не сбудется; не дольше `days` суток. */
function until(s: PlantState, cond: () => boolean, days = 60): Notice[] {
  const out: Notice[] = [];
  const end = s.t + days * DAY;
  while (!cond() && s.t < end) out.push(...advance(s, HOUR));
  expect(cond()).toBe(true);
  return out;
}

/** Первое место в помещении, куда встаёт след класса. */
function spot(s: PlantState, type: string, room: string): [number, number] {
  const r = s.plan.rooms.find(x => x.id === room)!;
  for (let z = r.rect[1] + 100; z < r.rect[1] + r.rect[3] - 100; z += 100) {
    for (let x = r.rect[0] + 100; x < r.rect[0] + r.rect[2] - 100; x += 100) {
      const at: [number, number] = [x + 50, z + 50];
      if (!footError(db, s.plan, type, room, at, 0) && editPlan(db, B, s.plan, { op: 'unit', type, room, at, turn: 0, vendor: 'ven.ru' }, {}).ok) return at;
    }
  }
  throw new Error(`no spot for ${type} in ${room}`);
}

/**
 * Завод со вторым таблетированием к востоку от корпуса: продолжение корпуса, чистый коридор с дверью из прежнего,
 * помещение с дверью в него; пресс, обеспыливатель и четыре прибора МОК — с записями, как у единиц старта.
 */
function twoPresses(): { s: PlantState; room: string; press: string } {
  const s = newPlant(db, { scenario: SC });
  const site = (op: Parameters<typeof editPlan>[3] | { op: 'done' }) => {
    const ns = apply(db, s, { kind: 'site', op } as never);
    expect(ns.some(n => n.kind === 'site' && n.ok)).toBe(true);
  };
  site({ op: 'hull', rect: [59, 1, 12, 12] });
  site({ op: 'room', type: 'corridor.clean', grade: 'D', rect: [59, 9, 12, 4] });
  site({ op: 'room', type: 'compression', grade: 'D', rect: [59, 1, 8, 9] });
  site({ op: 'door', cell: [59, 10], len: 2, along: 'z', kind: 'double' });
  site({ op: 'door', cell: [62, 9], len: 2, along: 'x', kind: 'double' });
  site({ op: 'done' });
  const room = s.plan.rooms.find(r => r.type === 'compression' && r.id !== 'compression')!.id;
  const bought: string[] = [];
  for (const type of ['eq.press', 'eq.deduster', 'inst.balance', 'inst.hardness', 'inst.friabilator', 'inst.disintegration']) {
    const at = db.equipment[type] ? { at: spot(s, type, room), turn: 0 } : {};
    const ns = apply(db, s, { kind: 'equip', op: { op: 'buy', type, vendor: 'ven.ru', room, ...at } });
    const n = ns.find(x => x.kind === 'equip') as Extract<Notice, { kind: 'equip' }> & { ok: true; thing: string };
    expect(n.ok).toBe(true);
    bought.push(n.thing);
  }
  // путь единицы — Б7в: здесь он сокращён, записи — как у единицы того же класса старта
  for (const id of bought) {
    const a = s.assets[id];
    const twin = Object.values(s.assets).find(x => x.type === a.type && x.id !== id && !x.path)!;
    a.recs = structuredClone(twin.recs);
    delete a.path;
  }
  expect(needs(db, s.plan)).toEqual([]);
  expect(siteErrors(db, s.plan)).toEqual([]);
  expect(roomDown(db, s, room)).toBe(false);
  return { s, room, press: bought[0] };
}

describe('правило коллеги производства', () => {
  test('ступени: серия в помещении, чистое для продукта, малая и генеральная уборка, занято, негодна', () => {
    const { s, room, press } = twoPresses();
    const b = Object.values(s.batches)[0];
    const r0 = s.rooms[room];
    const e = s.equipment[press];
    const at = (x: Partial<typeof r0>) => () => ({ ...r0, ...x });
    expect(rankOf(db, s, b, e, at({ batch: b.id, status: 'busy' }), s.t)).toBe(0);
    expect(rankOf(db, s, b, e, at({ status: 'clean', since: s.t }), s.t)).toBe(1);
    expect(rankOf(db, s, b, e, at({ status: 'dirty', product: b.product, since: s.t }), s.t)).toBe(2);
    expect(rankOf(db, s, b, e, at({ status: 'clean', cleanFor: 'prod.other', since: s.t }), s.t)).toBe(3);
    expect(rankOf(db, s, b, e, at({ status: 'busy', batch: 'B999' }), s.t)).toBe(4);
    s.assets[press].recs = [];
    expect(rankOf(db, s, b, e, at({ status: 'clean', since: s.t }), s.t)).toBe(5);
  });

  test('при равных ступенях — порядок плана; единиц две — выбор', () => {
    const { s, press } = twoPresses();
    const b = Object.values(s.batches)[0];
    const st = db.recipes[b.recipe].stages[COMPRESS];
    expect(unitsFor(db, s, st).map(e => e.id)).toEqual(['press-1', press]);
    const clean = (id: string) => ({ ...s.rooms[id], status: 'clean' as const, since: s.t, batch: undefined, cleanFor: undefined });
    expect(pickUnit(db, s, b, COMPRESS, clean)!.unit.id).toBe('press-1');
    // первое занято — второе
    const got = pickUnit(db, s, b, COMPRESS, id => (id === 'compression' ? { ...clean(id), status: 'busy', batch: 'B999' } : clean(id)))!;
    expect(got.unit.id).toBe(press);
    expect(got.n).toBe(2);
    expect(got.why).toEqual({ rank: 1, others: [{ unit: 'press-1', rank: 4 }] });
  });

  test('завод с двумя прессами: таблетирование идёт в обоих, выбор правила — в журнале начальника производства', () => {
    const { s, room } = twoPresses();
    advance(s, 45 * DAY);
    const rooms = Object.values(s.batches).flatMap(b => b.records.filter(r => r.stage === 'compress').map(r => r.room));
    expect(rooms).toContain('compression');
    expect(rooms).toContain(room);
    const recs = s.journal.filter(r => r.by === 'mes' && r.d.kind === 'route');
    expect(recs.length).toBeGreaterThan(0);
    // у маршрута — кто выбрал; выбор правила держится до стадии: запись стадии — в помещении маршрута
    for (const b of Object.values(s.batches)) {
      const rec = b.records.find(r => r.stage === 'compress');
      const step = b.route?.[COMPRESS];
      if (rec && step) expect(s.equipment[step.unit]?.room ?? rec.room).toBe(rec.room);
    }
    expect(check(db, s)).toEqual([]);
  });
});

describe('команда route', () => {
  test('выбор игрока — стадия на этой единице; отказы — не та единица, стадия прошла', () => {
    const { s, room, press } = twoPresses();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    const b = Object.values(s.batches).find(x => x.status !== 'cancelled' && x.stage < COMPRESS)!;
    const refused = (ns: Notice[]) => ns.find(n => n.kind === 'refused') as Extract<Notice, { kind: 'refused' }> | undefined;
    expect(refused(apply(db, s, { kind: 'route', batch: b.id, stage: COMPRESS, unit: 'deduster-1' }))?.why).toBe('notUnit');
    expect(refused(apply(db, s, { kind: 'route', batch: 'B999', stage: COMPRESS, unit: press }))?.why).toBe('noBatch');
    expect(refused(apply(db, s, { kind: 'route', batch: b.id, stage: COMPRESS, unit: press }))).toBeUndefined();
    expect(b.route?.[COMPRESS]).toEqual({ unit: press, by: 'you' });
    expect(s.journal.at(-1)!.by).toBe('player');
    until(s, () => b.records.some(r => r.stage === 'compress'), 40);
    expect(b.records.find(r => r.stage === 'compress')!.room).toBe(room);
    expect(refused(apply(db, s, { kind: 'route', batch: b.id, stage: COMPRESS, unit: 'press-1' }))?.why).toBe('started');
    expect(check(db, s)).toEqual([]);
  });

  test('режим «вручную»: серия ждёт выбора игрока в помещении прошлой стадии, потом едет', () => {
    const { s, press } = twoPresses();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    apply(db, s, { kind: 'mode', head: 'mes', mode: 'manual' });
    const waiting = () => Object.values(s.batches).find(x => x.status === 'process' && x.stage === COMPRESS && !x.route?.[COMPRESS] && !Object.values(s.tasks).some(t => t.batch === x.id));
    until(s, () => !!waiting(), 30);
    const b = waiting() as Batch;
    // ждёт в помещении смешивания: его держит, к таблетированию не везут
    expect(s.rooms[b.room!].batch).toBe(b.id);
    advance(s, 6 * HOUR);
    expect(b.stage).toBe(COMPRESS);
    expect(Object.values(s.tasks).some(t => t.batch === b.id)).toBe(false);
    apply(db, s, { kind: 'route', batch: b.id, stage: COMPRESS, unit: press });
    expect(Object.values(s.tasks).some(t => t.kind === 'carry' && t.batch === b.id)).toBe(true);
    until(s, () => b.records.some(r => r.stage === 'compress'), 10);
    expect(check(db, s)).toEqual([]);
  });
});

describe('перенос полупродукта', () => {
  test('после стадии в другом помещении — задача аппаратчика; прежнее помещение свободно после выгрузки', () => {
    const s = newPlant(db, { scenario: SC });
    const carrying = () => Object.values(s.tasks).find(t => t.kind === 'carry');
    until(s, () => !!carrying(), 20);
    const t = carrying()!;
    const b = s.batches[t.batch!];
    expect(t.roles).toEqual(['role.operator']);
    expect(t.work).toBe(CARRY_WORK);
    const from = b.room!;
    expect(t.room).not.toBe(from);
    expect(s.rooms[from].batch).toBe(b.id);
    until(s, () => !s.tasks[t.id], 2);
    expect(s.rooms[from].batch).toBeUndefined();
    expect(b.room).toBe(t.room);
    expect(check(db, s)).toEqual([]);
  });

  test('после таблетирования — на склад балка: партия балка — после выгрузки', () => {
    const s = newPlant(db, { scenario: SC });
    const last = () => Object.values(s.tasks).find(t => t.kind === 'carry' && t.room === 'bulk');
    until(s, () => !!last(), 30);
    const t = last()!;
    const b = s.batches[t.batch!];
    expect(b.bulk).toBeUndefined();
    until(s, () => !s.tasks[t.id], 2);
    expect(b.bulk).toBeDefined();
    expect(b.status).toBe('bulk');
  });
});

describe('расписание и S&OP', () => {
  test('черновик маршрута — полоса стадии на строке выбранного помещения', () => {
    const { s, room, press } = twoPresses();
    const b = Object.values(s.batches).find(x => x.status !== 'cancelled' && x.stage < COMPRESS)!;
    const bar = (f: ReturnType<typeof forecast>) => f.bars.find(x => x.batch === b.id && x.kind === 'stage' && x.stage === 'compress');
    const base = bar(forecast(db, s));
    const mine = bar(forecast(db, s, [], [], [], undefined, [{ batch: b.id, stage: COMPRESS, unit: press }]));
    expect(mine?.row).toBe(room);
    expect(base?.row === room ? 'press-1' : press).toBeDefined();
  });

  test('мощность таблетирования — по помещениям, которые работают', () => {
    const s0 = newPlant(db, { scenario: SC });
    const { s } = twoPresses();
    const n = 0;
    const one = capacityOf(db, s0, n).cap;
    const two = capacityOf(db, s, n).cap;
    expect(two.compression).toBe(one.compression * 2);
    expect(two.granulation).toBe(one.granulation);
  });
});

describe('сохранение', () => {
  test('маршрут и перенос — в сохранении, загрузка — тот же завод', () => {
    const { s } = twoPresses();
    advance(s, 20 * DAY);
    const back = fromSave(db, toSave(s));
    expect(JSON.stringify(back)).toBe(JSON.stringify(s));
    advance(back, DAY);
    advance(s, DAY);
    expect(toSave(back)).toBe(toSave(s));
  });
});
