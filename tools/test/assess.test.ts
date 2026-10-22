// Часть Б1г: что делать с отклонением (docs/specs/2026-10-vertical-slice.md, «Б1г»). Связанные испытания — по знаниям
// завода (записи причин): опудривание — прочность, распадаемость и растворение. «Без влияния» — только когда они готовы
// и в пределах; выпуск при неоценённом отклонении и после оценки «отклонить серию» — отказ; коллега качества, пока пост
// качества не у игрока, оценивает по тому же правилу; результат вне спецификации решает расследование. Срочное
// задание — команда поста производства. Склад ГП на старте: заказы первой недели отгружаются. Год: ни одно отклонение и
// ни одна серия не ждут решения дольше срока из записи сценария.
import { describe, expect, test } from 'bun:test';
import { legacy as db } from './legacy';
import { db as game } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { casesOf, positionOf } from '../../src/engine/planner';
import { planOf } from '../../src/engine/plant';
import { linkedTests } from '../../src/engine/qa';
import { containersByLot } from '../../src/engine/stock';
import type { Batch, Deviation, Notice, PlantState, Refusal } from '../../src/engine/types';

const SC = 'scn.proto';
const RCP = 'rcp.paracetamol500.wet.v1';
const N20 = 'sku.paracetamol500.n20';

/** Завод без заданий сценария: серии в тесте заказываются вручную. */
const bare: ContentDb = { ...db, scenarios: { ...db.scenarios, [SC]: { ...db.scenarios[SC], batches: [] } } };

/** Прожить до `days` суток часами с инвариантами; `until` — остановиться раньше. */
function live(s: PlantState, days: number, until?: () => boolean, base: ContentDb = bare): Notice[] {
  const out: Notice[] = [];
  const end = s.t + days * DAY;
  while (s.t < end && !until?.()) {
    out.push(...apply(base, s, { kind: 'advance', seconds: Math.min(HOUR, end - s.t) }));
    const bad = check(base, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
  return out;
}

function order(s: PlantState): Batch {
  const n = Object.keys(s.batches).length;
  apply(bare, s, { kind: 'order', recipe: RCP, sku: N20 });
  return Object.values(s.batches)[n];
}

/** Опудривание вне диапазона у серии — отклонение режима, как его открывает стадия. */
function lube(s: PlantState, b: Batch, id = 'D900'): Deviation {
  const d: Deviation = { id, opened: s.t, kind: 'param', batch: b.id, stage: 'blend', param: 'lubeTime', status: 'open' };
  s.deviations[id] = d;
  return d;
}

const refused = (why: Refusal, detail: string): Notice[] => [{ kind: 'refused', cmd: 'assess', why, detail }];

describe('связанные испытания', () => {
  test('опудривание — МОК прочности и распадаемости при таблетировании и испытания балка по ним; сверка — никаких', () => {
    const s = newPlant(bare, { scenario: SC });
    const b = order(s);
    live(s, 12, () => b.bulk !== undefined && s.lots[b.bulk].status === 'released');
    const d = lube(s, b);
    const tests = linkedTests(bare, s, d);
    expect(tests.filter(x => x.kind === 'ipc').map(x => x.test)).toEqual(['test.ipc.hardness', 'test.ipc.disintegration']);
    expect(tests.filter(x => x.kind === 'lab').map(x => x.test)).toContain('test.dissolution');
    for (const x of tests) expect(['hardness', 'disintegration', 'dissolution']).toContain(x.attr);
    // лаборатория балк решила: все готовы; у МОК — точки досье, у испытаний балка — результат
    for (const x of tests) expect(x.done).toBe(true);
    for (const x of tests.filter(y => y.kind === 'ipc')) expect(x.n).toBeGreaterThan(0);
    for (const x of tests.filter(y => y.kind === 'lab')) expect(x.result).toBeDefined();
    // сверку объясняют по досье — испытаний у неё нет; МОК вне пределов — все испытания балка
    expect(linkedTests(bare, s, { ...d, kind: 'recon', material: 'mat.pk.alu' })).toEqual([]);
    const ipc = linkedTests(bare, s, { ...d, kind: 'ipc', test: 'test.ipc.mass' });
    expect(ipc.every(x => x.kind === 'lab')).toBe(true);
    expect(ipc.length).toBe(s.samples[s.lots[b.bulk!].sample!].tests.length);
  });
});

describe('оценка', () => {
  test('«без влияния» — только когда лаборатория решила балк и связанные испытания в пределах; иначе — отказ с причиной', () => {
    const s = newPlant(bare, { scenario: SC });
    apply(bare, s, { kind: 'seat', seats: ['production', 'quality'] });
    const b = order(s);
    // стадия опудривания кончилась, балка ещё нет
    live(s, 10, () => b.records.some(r => r.stage === 'blend'));
    lube(s, b);
    expect(apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'none' })).toEqual(refused('bulkPending', 'D900'));
    expect(apply(bare, s, { kind: 'assess', deviation: 'D999', verdict: 'none' })).toEqual(refused('noDev', 'D999'));
    // балк на испытаниях — ещё нельзя
    live(s, 10, () => b.bulk !== undefined && s.lots[b.bulk].status === 'testing');
    expect(apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'none' })).toEqual(refused('bulkPending', 'D900'));
    live(s, 10, () => s.lots[b.bulk!].status === 'released');
    // точка МОК прочности вне пределов — «без влияния» нельзя, называется испытание
    const pt = b.records.find(r => r.stage === 'compress')!.ipc.find(x => x.test === 'test.ipc.hardness')!;
    pt.pass = false;
    expect(apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'none' })).toEqual(refused('outOfSpec', 'test.ipc.hardness'));
    pt.pass = true;
    expect(apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'none' })).toEqual([]);
    expect(s.deviations.D900.assess).toMatchObject({ verdict: 'none', by: 'player', t: s.t });
    // оценка идёт — второй раз нельзя
    expect(apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'reject' })).toEqual(refused('devDone', 'D900'));
    const out = live(s, 1, () => s.deviations.D900.status !== 'open');
    expect(out).toContainEqual({ kind: 'assessed', id: 'D900', verdict: 'none', code: expect.any(String) });
    expect(s.deviations.D900.status).toBe('assessed');
    // серию выпускают: отклонение оценено
    live(s, 10, () => b.status === 'released');
    expect(b.status).toBe('released');
  });

  test('«отклонить серию»: оценку делает специалист ООК, серию отклоняет уполномоченное лицо; «выпустить» — отказ', () => {
    const s = newPlant(bare, { scenario: SC });
    apply(bare, s, { kind: 'seat', seats: ['production', 'quality'] });
    const b = order(s);
    live(s, 12, () => b.bulk !== undefined && s.lots[b.bulk].status === 'released');
    lube(s, b);
    expect(apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'reject' })).toEqual([]);
    live(s, 1, () => s.deviations.D900.status !== 'open');
    expect(s.deviations.D900).toMatchObject({ status: 'closed', assess: { verdict: 'reject', by: 'player' } });
    live(s, 10, () => b.status === 'fg');
    expect(apply(bare, s, { kind: 'release', batch: b.id, decision: 'release' })).toEqual([{ kind: 'refused', cmd: 'release', why: 'devReject', detail: 'D900' }]);
    const out = live(s, 5, () => b.status === 'rejected');
    expect(out.some(n => n.kind === 'batchRejected' && n.batch === b.id)).toBe(true);
    expect(s.lots[b.pack!.fg!].status).toBe('rejected');
  });

  test('результат вне спецификации решает расследование: оценки нет', () => {
    const s = newPlant(bare, { scenario: SC });
    apply(bare, s, { kind: 'seat', seats: ['production', 'quality'] });
    const b = order(s);
    live(s, 12, () => b.bulk !== undefined && s.lots[b.bulk].status === 'released');
    s.deviations.D901 = { id: 'D901', opened: s.t, kind: 'oos', lot: b.bulk, batch: b.id, tests: [], status: 'open' };
    expect(apply(bare, s, { kind: 'assess', deviation: 'D901', verdict: 'none' })).toEqual(refused('devInv', 'D901'));
  });

  test('коллега качества, пока пост качества не у игрока: связанные испытания в пределах — «без влияния», вне — «отклонить серию»', () => {
    const s = newPlant(bare, { scenario: SC });
    const a = order(s);
    live(s, 12, () => a.bulk !== undefined && s.lots[a.bulk].status === 'released');
    lube(s, a, 'D900');
    live(s, 1, () => s.deviations.D900.status !== 'open');
    expect(s.deviations.D900).toMatchObject({ status: 'assessed', assess: { verdict: 'none', by: 'head:quality' } });
    // вторая серия: точка МОК прочности вне пределов — коллега отклоняет серию
    const b = order(s);
    live(s, 12, () => b.bulk !== undefined && s.lots[b.bulk].status === 'released');
    b.records.find(r => r.stage === 'compress')!.ipc.find(x => x.test === 'test.ipc.hardness')!.pass = false;
    lube(s, b, 'D901');
    live(s, 1, () => s.deviations.D901.status !== 'open');
    expect(s.deviations.D901).toMatchObject({ status: 'closed', assess: { verdict: 'reject', by: 'head:quality' } });
    live(s, 10, () => b.status === 'rejected');
    expect(b.status).toBe('rejected');
  });
});

describe('срочное задание', () => {
  test('команда поста производства: с поста качества — отказ; с поста производства — задание сейчас, его учитывает коллега планирования', () => {
    const s = newPlant(game, { scenario: SC });
    apply(game, s, { kind: 'seat', seats: ['quality'] });
    expect(apply(game, s, { kind: 'order', recipe: RCP, sku: N20 })).toEqual([{ kind: 'refused', cmd: 'order', why: 'notYours', detail: 'production' }]);
    apply(game, s, { kind: 'seat', seats: ['production'] });
    const before = positionOf(game, s, N20, 28).cases;
    const n = Object.keys(s.batches).length;
    apply(game, s, { kind: 'order', recipe: RCP, sku: N20 });
    const b = Object.values(s.batches)[n];
    expect(b).toMatchObject({ notBefore: s.t, by: 'player', sku: N20 });
    expect(positionOf(game, s, N20, 28).cases).toBe(before + casesOf(game.recipes[RCP], game.skus[N20]));
  });
});

describe('склад ГП на старте', () => {
  test('на две недели спроса, в обороте, на стеллажах; номера серий — с 001 года, счёт завода продолжается; заказы первой недели отгружаются', () => {
    const s = newPlant(game, { scenario: SC });
    const sc = game.scenarios[SC];
    const plan = planOf(game, sc.plant);
    const byLot = containersByLot(s);
    for (const k of Object.keys(game.customers[sc.customers[0]].demand)) {
      const sku = game.skus[k];
      const lots = Object.values(s.lots).filter(l => l.material === sku.fg);
      const need = Math.ceil((sc.customers.reduce((n, c) => n + (game.customers[c].demand[k] ?? 0), 0) * sc.fg!.days) / sku.case.per);
      expect(lots.reduce((n, l) => n + (byLot.get(l.id)?.length ?? 0), 0)).toBe(need);
      for (const l of lots) {
        expect(l).toMatchObject({ status: 'released', supplier: 'start', circulation: s.t });
        expect(l.vendorLot).toMatch(/^(PA|LO)\d{3}(07|08)27$/);
        for (const c of byLot.get(l.id)!) {
          const u = s.units[c.unit];
          expect(u.where.kind === 'slot' && plan.slot[u.where.id].kind).toBe('storage');
          expect(c.qty).toBe(sku.case.per);
          expect(c.codes).toHaveLength(1);
        }
      }
    }
    expect(s.batchNos).toEqual({ PA: { year: 2027, n: 6 }, LO: { year: 2027, n: 3 } });
    // заказы со сроком в первую неделю — в срок и полностью
    const week = s.t + 7 * DAY;
    live(s, 8, undefined, game);
    const first = Object.values(s.orders).filter(o => o.due <= week);
    expect(first.length).toBeGreaterThan(0);
    for (const o of first) expect(o.status).toBe('shipped');
  });
});

describe('год', () => {
  test('ни одно отклонение и ни одна серия не ждут решения дольше срока из записи сценария', () => {
    const s = newPlant(game, { scenario: SC });
    const term = game.scenarios[SC].deviations.term * DAY;
    const end = s.t + 365 * DAY;
    const held: Record<string, number> = {};
    let longest = 0;
    let decided = 0;
    while (s.t < end) {
      apply(game, s, { kind: 'advance', seconds: HOUR });
      for (const d of Object.values(s.deviations)) if (d.status === 'open') longest = Math.max(longest, s.t - d.opened);
      for (const b of Object.values(s.batches)) {
        if (b.held) held[b.id] ??= s.t;
        else if (held[b.id] !== undefined) {
          longest = Math.max(longest, s.t - held[b.id]);
          delete held[b.id];
        }
      }
    }
    for (const t of Object.values(held)) longest = Math.max(longest, s.t - t);
    for (const d of Object.values(s.deviations)) if (d.status !== 'open') decided++;
    expect(decided).toBeGreaterThan(0);
    expect(longest).toBeLessThanOrEqual(term);
    expect(check(game, s)).toEqual([]);
  }, 120_000);
});
