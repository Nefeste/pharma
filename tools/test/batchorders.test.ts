// Задания на серию (Б6а; docs/specs/2026-10-vertical-slice.md, «Б6а», «Проверки Б6а»): срок и «под что» — у заданий
// начальника отдела планирования (запас позиции: когда он кончится по спросу), под заказ покупателя (срок заказа) и
// игрока; `cancel` до комплектовки — резерв вернулся, задание отменено, запись журнала; начатое, отменённое и чужой пост —
// отказ; отменённое на запас начальник не ставит до его «не раньше»; образец прежней схемы читается — задания без срока.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db as game } from '../../src/content';
import { DAY, HOUR, isWorkday, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { TRUCK_HOUR } from '../../src/engine/market';
import { heldOf, positionOf, stockDue } from '../../src/engine/planner';
import { numOf, POL } from '../../src/engine/policies';
import { fromSave } from '../../src/engine/save';
import type { Batch, Notice, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';

const SC = 'scn.proto';
const refusal = (n: Notice[]) => n.find((x): x is Extract<Notice, { kind: 'refused' }> => x.kind === 'refused')?.why;
const plan = () => game.scenarios[SC].plan!;

/** Завод игры, проживший `days` суток без мест. */
function lived(days: number): PlantState {
  const s = newPlant(game, { scenario: SC });
  apply(game, s, { kind: 'advance', seconds: days * DAY });
  return s;
}

/** Задание, которое ещё ждёт своего дня, — последнее по «не раньше». */
const pending = (s: PlantState, by?: string): Batch =>
  Object.values(s.batches)
    .filter(b => (b.status === 'waiting' || b.status === 'reserved') && b.notBefore > s.t && (by === undefined || b.by === by))
    .sort((a, c) => c.notBefore - a.notBefore)[0];

describe('срок и «под что»', () => {
  test('начальник отдела планирования — на запас позиции; срок — отгрузка рабочего дня, когда запас кончится по спросу', () => {
    const s = lived(20);
    const mine = Object.values(s.batches).filter(b => b.by === 'head:plan');
    expect(mine.length).toBeGreaterThan(5);
    for (const b of mine) expect(b.for).toEqual({ kind: 'stock' });
    // спроса первую неделю не видно — у первых заданий срока нет, дальше — есть
    const dated = mine.filter(b => b.due !== undefined);
    expect(dated.length).toBeGreaterThan(0);
    expect(mine.some(b => b.due === undefined)).toBe(true);
    const cal = calOf(game, s);
    for (const b of dated) {
      const m = momentOf(s.start, b.due!);
      expect(m.sec).toBe(TRUCK_HOUR);
      expect(isWorkday(cal, m.day)).toBe(true);
      // запись журнала — с тем же сроком и «под что», причина правила при ней
      const r = s.journal.find(x => x.d.kind === 'order' && x.d.batch === b.id)!;
      expect(r.d).toMatchObject({ due: b.due, for: { kind: 'stock' } });
    }
  });

  test('срок — тот же расчёт, что у правила: запас в рабочих днях спроса от сегодня', () => {
    const s = lived(12);
    const sku = plan().items[0].sku;
    const w = numOf(game, s, POL.window)!;
    const p = positionOf(game, s, sku, w);
    const due = stockDue(game, s, sku, w)!;
    expect(due).toBeDefined();
    const today = momentOf(s.start, s.t).day;
    const day = momentOf(s.start, due).day;
    // рабочих дней от сегодня до срока — столько, сколько покрывает запас (не меньше нуля)
    const cal = calOf(game, s);
    let n = 0;
    for (let z = today + 1; z <= day; z++) if (isWorkday(cal, z)) n++;
    expect(n).toBe(p.cases <= 0 ? 0 : Math.floor((p.cases * p.work) / p.ordered));
  });

  test('под заказ покупателя — его срок; заказа нет, он закрыт или позиции в нём нет — отказ', () => {
    const s = lived(10);
    const o = Object.values(s.orders).find(x => x.status === 'open')!;
    expect(o).toBeDefined();
    const sku = o.lines[0].sku;
    const it = plan().items.find(x => x.sku === sku)!;
    const before = new Set(Object.keys(s.batches));
    expect(refusal(apply(game, s, { kind: 'order', recipe: it.recipe, sku, for: o.id }))).toBeUndefined();
    const b = Object.values(s.batches).find(x => !before.has(x.id))!;
    expect(b.for).toEqual({ kind: 'order', order: o.id });
    expect(b.due).toBe(o.due);
    const r = s.journal.find(x => x.d.kind === 'order' && x.d.batch === b.id)!;
    expect(r.by).toBe('player');
    expect(r.d).toMatchObject({ due: o.due, for: { kind: 'order', order: o.id } });
    expect(refusal(apply(game, s, { kind: 'order', recipe: it.recipe, sku, for: 'nope' }))).toBe('noOrder');
    const other = plan().items.find(x => !o.lines.some(l => l.sku === x.sku));
    if (other) expect(refusal(apply(game, s, { kind: 'order', recipe: other.recipe, sku: other.sku, for: o.id }))).toBe('noOrder');
    const shipped = Object.values(s.orders).find(x => x.status !== 'open');
    if (shipped) expect(refusal(apply(game, s, { kind: 'order', recipe: it.recipe, sku: shipped.lines[0].sku, for: shipped.id }))).toBe('noOrder');
  });

  test('игрок без заказа — на запас позиции со сроком по тому же расчёту', () => {
    const s = lived(12);
    const it = plan().items[1];
    const due = stockDue(game, s, it.sku, numOf(game, s, POL.window)!);
    const before = new Set(Object.keys(s.batches));
    apply(game, s, { kind: 'order', recipe: it.recipe, sku: it.sku, notBefore: s.t + 3 * DAY });
    const b = Object.values(s.batches).find(x => !before.has(x.id))!;
    expect(b.for).toEqual({ kind: 'stock' });
    expect(b.due).toBe(due!);
  });
});

describe('отмена', () => {
  test('до комплектовки: резерв вернулся, задание отменено, запись «вы»; отменённое и начатое — отказ', () => {
    const s = lived(10);
    const b = pending(s);
    expect(b).toBeDefined();
    const held = new Map<string, number>();
    for (const k of b.kit) held.set(k.container, (held.get(k.container) ?? s.containers[k.container].reserved ?? 0) - k.qty);
    const n = apply(game, s, { kind: 'cancel', batch: b.id });
    expect(refusal(n)).toBeUndefined();
    expect(b.status).toBe('cancelled');
    expect(b.cancelled).toBe(s.t);
    expect(b.kit).toEqual([]);
    for (const [c, left] of held) expect(s.containers[c]?.reserved ?? 0).toBe(left);
    const r = s.journal.findLast(x => x.d.kind === 'cancel')!;
    expect(r.by).toBe('player');
    expect(r.d).toMatchObject({ kind: 'cancel', batch: b.id, notBefore: b.notBefore, ...(b.sku ? { sku: b.sku } : {}) });
    expect(refusal(apply(game, s, { kind: 'cancel', batch: b.id }))).toBe('cancelled');
    expect(refusal(apply(game, s, { kind: 'cancel', batch: 'B999' }))).toBe('noBatch');
    const started = Object.values(s.batches).find(x => ['kitting', 'process', 'bulk', 'packing', 'fg', 'released'].includes(x.status))!;
    expect(refusal(apply(game, s, { kind: 'cancel', batch: started.id }))).toBe('started');
    expect(check(game, s)).toEqual([]);
    // отменённое не считают запасом: в положении позиции его нет, и его день не держит новое задание
    const w = numOf(game, s, POL.window)!;
    if (b.sku) {
      const was = positionOf(game, s, b.sku, w).cases;
      b.status = 'reserved';
      expect(positionOf(game, s, b.sku, w).cases).toBeGreaterThan(was);
      b.status = 'cancelled';
    }
    // завод живёт дальше: отменённое не комплектуют, инварианты целы
    for (let i = 0; i < 14 * 24; i++) {
      apply(game, s, { kind: 'advance', seconds: HOUR });
      expect(b.status).toBe('cancelled');
    }
    expect(check(game, s)).toEqual([]);
  }, 60_000);

  test('отменяет пост «Производство» или директор; у поста «Качество» — отказ', () => {
    const s = lived(8);
    apply(game, s, { kind: 'seat', seats: ['quality'] });
    const b = pending(s);
    expect(refusal(apply(game, s, { kind: 'cancel', batch: b.id }))).toBe('notYours');
    expect(b.status === 'waiting' || b.status === 'reserved').toBe(true);
    apply(game, s, { kind: 'seat', seats: ['director'] });
    expect(refusal(apply(game, s, { kind: 'cancel', batch: b.id }))).toBeUndefined();
    expect(b.status).toBe('cancelled');
  });

  test('отменённое на запас начальник не ставит до его «не раньше» — причина в журнале; потом — снова', () => {
    const s = lived(15);
    const b = pending(s, 'head:plan');
    expect(b?.sku).toBeDefined();
    apply(game, s, { kind: 'cancel', batch: b.id });
    expect(heldOf(s, b.sku!)).toEqual({ t: s.t, until: b.notBefore });
    const before = new Set(Object.keys(s.batches));
    const from = s.t;
    while (s.t < b.notBefore) apply(game, s, { kind: 'advance', seconds: HOUR });
    // в самое мгновение «не раньше» отменённого позицию уже можно ставить — до него нельзя
    const fresh = Object.values(s.batches).filter(x => !before.has(x.id) && x.by === 'head:plan' && x.ordered < b.notBefore);
    expect(fresh.some(x => x.sku === b.sku)).toBe(false);
    // у заданий, поставленных за это время, причина называет отменённое
    const recs = s.journal.filter(x => x.t > from && x.t < b.notBefore && x.d.kind === 'order' && x.d.why);
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) if (r.d.kind === 'order') expect(r.d.why!.items.find(i => i.sku === b.sku)?.held).toEqual({ t: b.cancelled!, until: b.notBefore });
    // «не раньше» наступило — позицию снова можно ставить
    expect(heldOf(s, b.sku!)).toBeUndefined();
  }, 60_000);
});

describe('сохранение', () => {
  test('образец схемы 38: задания без срока и «под что», инварианты целы', () => {
    const s = fromSave(game, readFileSync(join(import.meta.dir, 'fixtures/save-v38.json'), 'utf8'));
    expect(Object.values(s.batches).every(b => b.due === undefined && b.for === undefined && b.status !== 'cancelled')).toBe(true);
    expect(check(game, s)).toEqual([]);
    apply(game, s, { kind: 'advance', seconds: 3 * DAY });
    expect(check(game, s)).toEqual([]);
  });
});
