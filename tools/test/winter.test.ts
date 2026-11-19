// Сценарий 2 «Первая зима» (Б9, шаг 3; docs/specs/2026-10-vertical-slice.md, «Б9»): ибупрофен введён до старта, цели с
// 1 ноября и дни срыва заказов, письма дистрибьютора и поставщика, «виртуальный директор» обоих сценариев.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { liveOf } from '../../src/engine/docs';
import { apply, newPlant } from '../../src/engine/engine';
import { goalSpan, goalValue, missDays } from '../../src/engine/goals';
import { check } from '../../src/engine/invariants';
import { letterDue } from '../../src/engine/letters';
import { gapsOf, isProject } from '../../src/engine/project';
import { fromSave, toSave } from '../../src/engine/save';
import type { Notice, Order, PlantState } from '../../src/engine/types';
import { direct } from '../bench/director';
import { buildDb } from '../content/load';

const c2 = db.scenarios['scn.c2'];
const start = newPlant(db, { scenario: 'scn.c2' });
const fresh = () => fromSave(db, toSave(start));
const rec = (s: PlantState, id: string) => s.heads.letters?.find(r => r.id === `let.c2.${id}`);

describe('сценарий 2: завод и ибупрофен', () => {
  test('поля основы и свои: план с крылом покрытия, два дистрибьютора, места — директор и производство', () => {
    expect(c2.campaign).toBe(2);
    expect(c2.plant).toBe('plant.c2');
    expect(c2.customers).toEqual(['cus.chain', 'cus.oblast']);
    expect(c2.seats).toEqual(['director', 'production']);
    expect(c2.launched).toEqual(['prd.ibuprofen200']);
    expect(c2.plan?.method).toBe('last-year');
    expect(db.plants['plant.c2'].equipment.some(e => e.type === 'eq.coater')).toBe(true);
    expect(db.scenarios['scn.proto'].launched).toEqual([]);
  });

  test('ибупрофен — не проект: документы в силе с начала прогрева, заводу ничего не не хватает', () => {
    const s = fresh();
    expect(s.portfolio?.docs).toBeDefined();
    expect(Object.values(s.portfolio!.docs!).every(d => d === Math.min(...Object.values(s.portfolio!.docs!)))).toBe(true);
    expect(isProject(db, s, 'prd.ibuprofen200')).toBe(false);
    expect(isProject(db, s, 'prd.metformin500')).toBe(true);
    expect(gapsOf(db, s, 'prd.ibuprofen200')).toEqual([]);
    expect(check(liveOf(db, s.portfolio!.docs), s)).toEqual([]);
  });

  test('прогрев детерминирован; ибупрофен идёт покрытием и выпускается', () => {
    expect(toSave(newPlant(db, { scenario: 'scn.c2' }))).toBe(toSave(start));
    const s = fresh();
    expect(s.t).toBe(7 * HOUR + 7 * DAY);
    apply(db, s, { kind: 'advance', seconds: 10 * DAY });
    const ibu = Object.values(s.batches).filter(b => b.recipe === 'rcp.ibuprofen200.dc.v1');
    expect(ibu.some(b => b.status === 'released')).toBe(true);
    expect(ibu.some(b => b.records.some(r => r.stage === 'coat'))).toBe(true);
  });
});

describe('цели с даты и дни срыва', () => {
  test('цели OTIF и дней срыва — с 1 ноября 2028 г.; срок — до 1 апреля 2029 г.', () => {
    const { from, to } = goalSpan(db, start);
    const nov = c2.goals.find(g => g.kind === 'otif')!.from!;
    // прогрев — с 31 июля: 1 день июля, август, сентябрь и октябрь
    expect(nov).toBe((1 + 31 + 30 + 31) * DAY);
    expect(nov).toBeGreaterThan(from);
    expect(to).toBe(from + 237 * DAY);
    // до ноября закрытых заказов в счёт цели нет
    expect(goalValue(db, start, c2.goals.find(g => g.kind === 'otif')!)).toBeUndefined();
    expect(goalValue(db, start, c2.goals.find(g => g.kind === 'missDays')!)).toBe(0);
  });

  test('дни срыва: опоздал — до дня отгрузки, недопоставка — с днём отгрузки, открыт после срока — по сей день; сутки — один раз', () => {
    const s = fresh();
    const o = (id: string, dueDay: number, status: Order['status'], shipDay?: number): Order => {
      if (shipDay !== undefined) s.shipments[`S-${id}`] = { ...Object.values(s.shipments)[0], id: `S-${id}`, t: shipDay * DAY + 15 * HOUR };
      return { id, customer: 'cus.chain', lines: [], placed: 0, due: dueDay * DAY + 15 * HOUR, minShelf: 0, status, cases: [], units: [], ...(shipDay !== undefined ? { shipment: `S-${id}` } : {}) };
    };
    s.orders = { a: o('a', 100, 'shipped', 100), b: o('b', 100, 'late', 103), c: o('c', 102, 'short', 104), d: o('d', 110, 'open') };
    // b: 100–102, c: 102–104, d: 110–112 при «сейчас» — сутки 112
    expect(missDays(s, 0, 112 * DAY + 16 * HOUR)).toBe(5 + 3);
    expect(missDays(s, 101 * DAY, 112 * DAY + 16 * HOUR)).toBe(3 + 3);
  });
});

describe('письма дистрибьютора и поставщика', () => {
  test('на старте — письмо о сезоне; кончается, когда прочли; наставника нет — пропускать нечего', () => {
    const s = fresh();
    expect(s.heads.letters?.map(r => r.id)).toEqual(['let.c2.season']);
    expect(apply(db, s, { kind: 'letter', op: 'skip', id: 'let.c2.season' })[0]).toMatchObject({ kind: 'refused', why: 'noSkip' });
    apply(db, s, { kind: 'letter', op: 'read', id: 'let.c2.season' });
    expect(rec(s, 'season')!.end?.how).toBe('done');
  });

  test('первый заказ под угрозой — письмо о нём; кончается, когда заказ закрыт', () => {
    const s = fresh();
    const seen: Notice[] = [];
    for (let i = 0; i < 120 && !rec(s, 'risk'); i++) seen.push(...apply(db, s, { kind: 'advance', seconds: DAY }));
    const r = rec(s, 'risk')!;
    expect(r).toBeDefined();
    expect(s.orders[r.thing!]).toBeDefined();
    expect(seen.some(n => n.kind === 'orderRisk' && n.order === r.thing)).toBe(true);
    for (let i = 0; i < 30 && s.orders[r.thing!].status === 'open'; i++) apply(db, s, { kind: 'advance', seconds: DAY });
    apply(db, s, { kind: 'advance', seconds: HOUR });
    expect(rec(s, 'risk')!.end?.how).toBe('done');
  });

  test('«зима без срывов» не приходит, если письмо о срыве было', () => {
    const a = fresh();
    letterDue(db, a, 'let.c2.winter', []);
    expect(rec(a, 'winter')).toBeDefined();
    const b = fresh();
    b.heads.letters!.push({ id: 'let.c2.miss', at: b.t });
    letterDue(db, b, 'let.c2.winter', []);
    expect(rec(b, 'winter')).toBeUndefined();
  });
});

describe('сборщик базы: сценарий 2', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  function broken(edits: Record<string, [string, string][]>): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'pharma-content-'));
    dirs.push(dir);
    cpSync(join(import.meta.dir, '../../content'), dir, { recursive: true });
    for (const [file, e] of Object.entries(edits)) {
      const p = join(dir, file);
      let text = readFileSync(p, 'utf8');
      for (const [a, b] of e) {
        expect(text.includes(a)).toBe(true);
        text = text.replace(a, b);
      }
      writeFileSync(p, text);
    }
    return buildDb(dir).errors;
  }
  const has = (errs: string[], part: string) => expect([part, errs.some(e => e.includes(part))]).toEqual([part, true]);

  test('введённый до старта — только продукт-проект; без него карта ибупрофена не в силе; цель с даты — в сроке', () => {
    has(broken({ 'scenarios/c2.yaml': [['launched: [prd.ibuprofen200]', 'launched: [prd.paracetamol500]']] }), 'не продукт-проект');
    has(broken({ 'scenarios/c2.yaml': [['launched: [prd.ibuprofen200]', 'launched: []']] }), 'у карты rcp.ibuprofen200.dc.v1');
    has(broken({ 'scenarios/c2.yaml': [['{ kind: otif, v: 90, from: 2028-11-01 }', '{ kind: otif, v: 90, from: 2029-06-01 }']] }), 'вне срока сценария');
  });
  test('письма: «если не было» — письмо того же сценария; заказ события — только у письма о заказе', () => {
    has(broken({ 'letters/c2/winter.yaml': [['unless: let.c2.miss', 'unless: let.c1.truck']] }), 'unless — нет письма');
    has(broken({ 'letters/c2/late.yaml': [['done: { kind: unloaded }', 'done: { kind: delivered }']] }), 'заказ события — только');
  });
});

describe('«виртуальный директор»: письма пропущены, все отделы «сам», три зерна до конца срока', () => {
  test('сценарий 1 — цели выполнены почти всегда', () => {
    const runs = [1, 2, 3].map(seed => direct('scn.c1', seed));
    expect(runs.filter(r => r.main).length).toBeGreaterThanOrEqual(2);
  });
  test('сценарий 2 — без игрока «на отлично» не выходит', () => {
    const runs = [1, 2, 3].map(seed => direct('scn.c2', seed));
    expect(runs.filter(r => r.top).length).toBeLessThanOrEqual(1);
  }, 120_000);
});
