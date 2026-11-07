// Часть Б7б, шаг 4: стройка в окне (docs/specs/2026-10-vertical-slice.md, «Проверки Б7б», «Окно»). Призрак и команда — одна
// функция: что призрак пустил, команда принимает, и наоборот, на всех инструментах, и цена у них одна; подписи помещений в
// стройке; срез нового плана разбирается по новому плану; наружные стены пристройки — по улице рядом, а не по краю сетки.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { type BuildPick, ghostOf, labelRows, opAt, PICK, targetAt } from '../../src/app/build';
import { apply, newPlant } from '../../src/engine/engine';
import { planOf } from '../../src/engine/plant';
import type { BuildOp } from '../../src/engine/site/edit';
import type { Notice, PlantState } from '../../src/engine/types';
import { layoutOf, outward, wallHeight, WALL_LOW_ROOM } from '../../src/render/layout';
import { buildView } from '../../src/sim/build';
import { Packer, unpack } from '../../src/sim/pack';

const SC = 'scn.proto';
const B = db.scenarios[SC].build!;
const VAT = db.profiles[db.scenarios[SC].profile].vat.general;

const site = (s: PlantState, op: BuildOp | { op: 'done' } | { op: 'undo' }) => apply(db, s, { kind: 'site', op }).filter((n): n is Extract<Notice, { kind: 'site' }> => n.kind === 'site');

/** Правки всех инструментов по порядку — годные и нет: пристройка, коридор, дверь, зона, ряд, проезд, снос. */
const OPS: BuildOp[] = [
  { op: 'hull', rect: [10, 10, 5, 5] },
  { op: 'hull', rect: [59, 18, 12, 12] },
  { op: 'room', type: 'lab', grade: 'cnc', rect: [59, 24, 12, 5] },
  { op: 'room', type: 'corridor', grade: 'cnc', rect: [27, 21, 5, 5] },
  { op: 'room', type: 'corridor', grade: 'cnc', rect: [59, 20, 12, 5] },
  { op: 'door', cell: [30, 39], len: 1, along: 'x', kind: 'door' },
  { op: 'door', cell: [59, 22], len: 1, along: 'z', kind: 'door' },
  { op: 'zone', kind: 'palletizing', rect: [21, 13, 2, 2] },
  { op: 'zone', kind: 'fgQuarantine', rect: [21, 13, 2, 2] },
  { op: 'rack', x: 13, z: 34, bays: 1, levels: 7, face: 'n' },
  { op: 'rack', x: 13, z: 34, bays: 1, levels: 2, face: 'n' },
  { op: 'vehicles', room: 'office', on: true },
  { op: 'vehicles', room: 'dispensing', on: true },
  { op: 'demolish', what: 'room', id: 'lab' },
  { op: 'demolish', what: 'door', id: '58,9' },
  { op: 'demolish', what: 'rack', id: 'A' },
];

describe('призрак и команда — одна функция', () => {
  test('на всех инструментах: что призрак пустил, команда принимает, и наоборот; цена — та же', () => {
    const s = newPlant(db, { scenario: SC });
    const seen = { ok: 0, no: 0, later: 0 };
    for (const op of OPS) {
      const g = ghostOf(db, B, VAT, s.plan, buildView(db, s), op);
      const n = site(s, op);
      expect([op, n.length]).toEqual([op, 1]);
      expect([op, n[0].ok]).toEqual([op, g.ok]);
      if (n[0].ok) {
        expect([op, n[0].cost]).toEqual([op, g.cost]);
        if (n[0].later) seen.later++;
        else seen.ok++;
      } else seen.no++;
    }
    expect(seen).toEqual({ ok: 7, no: 8, later: 1 });
  });

  test('денег не хватит — нельзя у призрака и у команды', () => {
    const s = newPlant(db, { scenario: SC });
    s.cash.balance = -db.scenarios[SC].credit.limit + 1000;
    const g = ghostOf(db, B, VAT, s.plan, buildView(db, s), OPS[1]);
    expect(g).toMatchObject({ ok: false });
    expect(g.text).toMatch(/^Корпус 12 × 12 м: нельзя — не хватит /);
    expect(site(s, OPS[1])[0]).toMatchObject({ ok: false, error: { code: 'money' } });
  });

  test('правка под курсором: инструмент и клетка дают ту же правку, что команда', () => {
    const s = newPlant(db, { scenario: SC });
    const pick = (p: Partial<BuildPick>): BuildPick => ({ ...PICK, ...p });
    expect(opAt(db, s.plan, pick({ tool: 'hull' }), [70, 29], [59, 18])).toEqual({ op: 'hull', rect: [59, 18, 12, 12] });
    // дверь в стене поперёк x: ось вдоль z; R — поперёк
    expect(opAt(db, s.plan, pick({ tool: 'door' }), [27, 22])).toEqual({ op: 'door', cell: [27, 22], len: 1, along: 'z', kind: 'door' });
    expect(opAt(db, s.plan, pick({ tool: 'door', turn: true }), [27, 22])).toMatchObject({ along: 'x' });
    expect(opAt(db, s.plan, pick({ tool: 'door', door: 'gate', gate: 3 }), [40, 21])).toEqual({ op: 'door', cell: [40, 21], len: 3, along: 'x', kind: 'gate' });
    expect(opAt(db, s.plan, pick({ tool: 'vehicles' }), [30, 3])).toEqual({ op: 'vehicles', room: 'dispensing', on: true });
    // снос: дверь, ряд, зона, помещение — по порядку
    expect(targetAt(db, s.plan, [58, 9])).toEqual({ op: 'demolish', what: 'door', id: '58,9' });
    expect(targetAt(db, s.plan, [5, 13])).toEqual({ op: 'demolish', what: 'rack', id: 'A' });
    expect(targetAt(db, s.plan, [2, 3])).toEqual({ op: 'demolish', what: 'zone', id: 'recv' });
    expect(targetAt(db, s.plan, [33, 30])).toEqual({ op: 'demolish', what: 'room', id: 'lab' });
    // помещение без типа — правки нет; протяжки нет — тоже
    expect(opAt(db, s.plan, pick({ tool: 'room' }), [60, 20], [59, 18])).toBeUndefined();
    expect(opAt(db, s.plan, pick({ tool: 'zone' }), [21, 13])).toBeUndefined();
  });
});

describe('подписи помещений', () => {
  test('работает; не дойти; закрыто на перестройку; красная и жёлтая; сносится', () => {
    const s = newPlant(db, { scenario: SC });
    const row = (id: string) => labelRows(db, s.plan, buildView(db, s)).find(r => r.id === id)!;
    expect(row('hall')).toMatchObject({ name: 'Общий коридор', state: 'работает', ok: true });
    site(s, OPS[1]);
    site(s, OPS[4]);
    expect(row('corridor-1')).toMatchObject({ name: 'Общий коридор 1', state: 'не работает: от входа не дойти: Общий коридор 1', ok: false });
    site(s, OPS[6]);
    expect(row('corridor-1')).toMatchObject({ state: 'закрыто на перестройку', ok: false });
    site(s, { op: 'done' });
    expect(row('corridor-1')).toMatchObject({ state: 'работает', ok: true });
    site(s, { op: 'door', cell: [40, 21], len: 1, along: 'x', kind: 'door' });
    expect(row('packaging')).toMatchObject({ state: 'не работает: вход в класс D — не через шлюз', ok: false });
    site(s, { op: 'undo' });
    site(s, { op: 'demolish', what: 'door', id: '58,9' });
    expect(row('washing')).toMatchObject({ state: 'замечание: у мойки один проём на вход грязного и выход чистого', ok: true });
    // занятое помещение — сносится, когда освободится
    const u = Object.values(s.units).find(x => x.where.kind === 'slot' && x.where.id.startsWith('A-'))!;
    delete s.slots[(u.where as { id: string }).id].unit;
    u.where = { kind: 'room', id: 'corridor-1' };
    site(s, { op: 'demolish', what: 'room', id: 'corridor-1' });
    expect(row('corridor-1')).toMatchObject({ state: 'сносится, когда освободится', ok: false });
  });
});

describe('новый план в окне', () => {
  test('срез нового плана разбирается по новому плану: места паллет — по номерам нового плана', () => {
    const s = newPlant(db, { scenario: SC });
    const packer = new Packer(db);
    unpack(packer.pack(s, 0));
    // зона карантина ГП — раньше рядов стеллажей в списке мест: номера мест рядов сдвигаются на одно
    site(s, { op: 'zone', kind: 'fgQuarantine', rect: [21, 13, 2, 2] });
    const sl = unpack(packer.pack(s, 0));
    expect(sl.rev).toBe(1);
    const slots = planOf(db, s.plan).slots;
    const onRacks = Object.values(s.units).filter(u => u.where.kind === 'slot' && /^[A-D]-/.test(u.where.id));
    expect(onRacks.length).toBeGreaterThan(0);
    // паллеты стеллажей — снова в срезе: номер места у них новый
    for (const u of onRacks) {
      const row = sl.units.find(r => r.unit === Number(u.id.slice(1)));
      expect(row && slots[row.ref].id).toBe((u.where as { id: string }).id);
    }
  });

  test('пристройка: стены — наружные там, где рядом улица, а не по краю сетки', () => {
    const s = newPlant(db, { scenario: SC });
    site(s, OPS[1]);
    const l = layoutOf(planOf(db, s.plan));
    expect([l.w, l.h]).toEqual([71, 40]);
    // северная стена пристройки — наружу на север; прежняя восточная стена севернее пристройки — наружу на восток
    expect(outward(l, 65, 18)).toEqual([0, -1]);
    expect(outward(l, 59, 5)).toEqual([1, 0]);
    // стена между прежним корпусом и пристройкой — внутренняя
    expect(outward(l, 59, 22)).toEqual([0, 0]);
    expect(wallHeight(l, 59, 22)).toBe(WALL_LOW_ROOM);
  });
});
