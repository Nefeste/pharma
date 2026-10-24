// Часть 1г: линия и выпуск (docs/specs/2026-10-engine.md, 1г). Брак счётом; серия от разрешённого балка до выпуска;
// узкое место у №10 и №20; переналадка и очистка линии; места для паллет кончились — линия стоит; коды в ящиках;
// уполномоченное лицо держит серию с отклонением; команды и отказы; сохранение посреди упаковки; срезами — то же;
// срок годности ГП по Рекомендации ЕЭК № 2. Таблетки, коды, OEE и сверку проверяют инварианты на каждом шаге.
import { describe, expect, test } from 'bun:test';
import { legacy as db } from './legacy';
import type { ContentDb } from '../../src/content/types';
import { DAY, daysFromCivil, HOUR, MIN } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { fgExpiry, geo, good, need, SIXTY } from '../../src/engine/line';
import { planOf } from '../../src/engine/plant';
import { fromSave, toSave } from '../../src/engine/save';
import { containersByLot, createLot } from '../../src/engine/stock';
import type { Batch, Notice, PlantState, Task } from '../../src/engine/types';

const SC = 'scn.proto';
const RCP = 'rcp.paracetamol500.wet.v1';
const N10 = 'sku.paracetamol500.n10';
const N20 = 'sku.paracetamol500.n20';
const plan = planOf(db, db.scenarios[SC].plant);

/** Завод без заданий сценария: серии в тесте заказываются вручную. */
const bare: ContentDb = { ...db, scenarios: { ...db.scenarios, [SC]: { ...db.scenarios[SC], batches: [] } } };

/** Прожить `days` суток часами с инвариантами; `look` — перед каждым событием; `until` — остановиться раньше. */
function live(s: PlantState, days: number, look?: () => void, until?: () => boolean): Notice[] {
  const out: Notice[] = [];
  const end = s.t + days * DAY;
  const more = look ? () => (look(), true) : undefined;
  while (s.t < end && !until?.()) {
    out.push(...apply(bare, s, { kind: 'advance', seconds: Math.min(HOUR, end - s.t) }, more));
    look?.();
    const bad = check(bare, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
  return out;
}

function order(s: PlantState, sku?: string, notBefore = s.t): Batch {
  const n = Object.keys(s.batches).length;
  apply(bare, s, { kind: 'order', recipe: RCP, notBefore, ...(sku ? { sku } : {}) });
  return Object.values(s.batches)[n];
}

describe('брак счётом', () => {
  test('из первых n годных n − ⌊n × доля⌋; need — наименьшее n с годными не меньше g', () => {
    for (const p of [0, 30, 50, 3333, 9999]) {
      for (let g = 0; g <= 3000; g++) {
        const n = need(g, p);
        expect(good(n, p)).toBeGreaterThanOrEqual(g);
        if (n > 0) expect(good(n - 1, p)).toBeLessThan(g);
      }
    }
  });
});

describe('серия от разрешённого балка до выпуска', () => {
  const s = newPlant(bare, { scenario: SC });
  const b = order(s, N20);
  // выпущена, и паллеты ГП довезли до стеллажей
  const out = live(s, 10, undefined, () => b.status === 'released' && !Object.values(s.tasks).some(t => t.lot === b.pack?.fg));
  const job = b.pack!;
  const sku = db.skus[N20];
  const lot = s.lots[job.fg!];

  test('балк разрешён → упаковано → ООК → уполномоченное лицо выпустило', () => {
    expect(b.status).toBe('released');
    const kinds = out.filter(n => n.kind.startsWith('batch')).map(n => n.kind);
    expect(kinds).toEqual(['batchBulk', 'batchPacked', 'batchReleased']);
    expect(lot.status).toBe('released');
    expect(lot.vendorLot).toBe(s.lots[b.bulk!].vendorLot);
    expect(lot.batch).toBe(b.id);
  });

  test('все таблетки балка — на линию; пачки в ящиках по 120, ящики на паллетах по 40, архив — 6 пачек', () => {
    const bulk = s.lots[b.bulk!];
    expect(job.tablets).toBe(bulk.qty - bulk.sampled);
    expect(bulk.used).toBe(job.tablets);
    const goodCartons = job.cartons! - job.cartonRejects!;
    const cases = containersByLot(s).get(lot.id)!;
    expect(lot.qty).toBe(goodCartons);
    expect(lot.sampled).toBe(db.materials[sku.fg].sample);
    expect(cases.reduce((n, c) => n + c.qty, 0)).toBe(goodCartons - lot.sampled);
    expect(job.cases).toBe(Math.ceil(goodCartons / sku.case.per));
    for (const c of cases.slice(0, -1)) expect(c.qty).toBe(sku.case.per);
    const pallets = [...new Set(cases.map(c => c.unit))].map(id => s.units[id]);
    for (const u of pallets) expect(u.items.length).toBeLessThanOrEqual(sku.pallet.cases);
    expect(pallets.length).toBe(Math.ceil(job.cases! / sku.pallet.cases));
  });

  test('выпущенная ГП — на стеллажах; комплект упаковки вернулся, резерва нет; сверка сходится', () => {
    for (const u of new Set(containersByLot(s).get(lot.id)!.map(c => s.units[c.unit]))) {
      expect(u.where.kind).toBe('slot');
      expect(plan.slot[(u.where as { id: string }).id].kind).toBe('storage');
      expect(u.tag).toBe('released');
    }
    expect(job.kitUnit).toBeUndefined();
    expect(Object.values(s.containers).some(c => (c.reserved ?? 0) > 0)).toBe(false);
    // сходится с точностью до испорченного при заминках, но не записанного (1е)
    for (const r of job.recon!) {
      expect(r.issued).toBe(r.used + r.spoiled + r.returned + (job.lost ?? 0));
      expect(r.returned).toBeGreaterThanOrEqual(0);
    }
    expect(Object.values(s.deviations)).toEqual([]);
  });

  test('коды: в ящике — отрезки без брака; брак камеры — по счёту; первый ящик начинается с кода 1', () => {
    const g = geo(bare, s, s.lines['line-1'], N20);
    expect(job.rejected.length).toBe(job.cartonRejects!);
    expect(job.rejected.length).toBe(job.cartons! - good(job.cartons!, g.rej[1]));
    const cases = containersByLot(s).get(lot.id)!;
    expect(cases[0].codes![0][0]).toBe(1);
    for (const c of cases) for (const [first] of c.codes!) expect(job.rejected).not.toContain(first);
    expect(job.retained.length).toBe(db.materials[sku.fg].sample);
  });

  test('срок годности ГП — от выпуска (он не позже 30 дней от производства)', () => {
    const prod = Math.floor(b.records[1].start / DAY) + daysFromCivil(s.start);
    const release = Math.floor(b.released! / DAY) + daysFromCivil(s.start);
    expect(release - prod).toBeLessThanOrEqual(30);
    expect(lot.expiry).toBe(fgExpiry(prod, release, db.materials[sku.fg].shelf));
  });
});

describe('узкое место', () => {
  /** Упаковать одну серию позиции и вернуть OEE машин. */
  function pack(sku: string) {
    const s = newPlant(bare, { scenario: SC });
    const b = order(s, sku);
    live(s, 10, undefined, () => b.pack?.state === 'done');
    return Object.fromEntries(b.pack!.oee!.map(o => [o.machine, o.times]));
  }

  test('№20: держит блистерная (60 пачек в минуту) — она на номинале, картонажная медленнее', () => {
    const o = pack(N20);
    expect(o['blister-1'].run).toBeGreaterThan(o['cartoner-1'].run);
    expect(o['cartoner-1'].slow).toBeGreaterThan(o['cartoner-1'].run);
    // укладка быстрее машин перед ней: на номинале — только пока догоняет пачки, накопленные до прихода её смены к столу
    expect(o['casepack-1'].run * 100).toBeLessThan(o['casepack-1'].slow);
  });

  test('№10: держит картонажная — она на номинале, блистерная упирается в полный накопитель', () => {
    const o = pack(N10);
    expect(o['cartoner-1'].run).toBeGreaterThan(o['blister-1'].run);
    expect(o['blister-1'].slow).toBeGreaterThan(0);
    // короткие остановки блистерной гасит накопитель перед картонажной: та стоит меньше
    expect(o['blister-1'].micro).toBeGreaterThan(0);
    expect(o['cartoner-1'].wait).toBeLessThan(o['blister-1'].micro);
  });
});

describe('переналадка и очистка линии', () => {
  test('первая серия — наладка на формат и очистка (Б1е); та же позиция — только очистка; другая — переналадка и очистка', () => {
    const s = newPlant(bare, { scenario: SC });
    const seen: string[] = [];
    const known = new Set<string>();
    const look = () => {
      for (const t of Object.values(s.tasks) as Task[]) {
        if (known.has(t.id) || !['changeover', 'clearance', 'clearCheck'].includes(t.kind)) continue;
        known.add(t.id);
        seen.push(`${t.batch}:${t.kind}`);
      }
    };
    const b1 = order(s, N20);
    const b2 = order(s, N20, s.t + 2 * DAY);
    const b3 = order(s, N10, s.t + 4 * DAY);
    live(s, 20, look, () => [b1, b2, b3].every(b => b.status === 'released'));
    expect([b1, b2, b3].map(b => b.status)).toEqual(['released', 'released', 'released']);
    expect(seen).toEqual([`${b1.id}:changeover`, `${b1.id}:clearance`, `${b1.id}:clearCheck`, `${b2.id}:clearance`, `${b2.id}:clearCheck`, `${b3.id}:changeover`, `${b3.id}:clearance`, `${b3.id}:clearCheck`]);
    expect(s.lines['line-1'].format).toBe(db.skus[N10].format);
    expect(s.lines['line-1'].clear).toBe(false);
  });
});

describe('места для паллет кончились — линия стоит', () => {
  test('карантин ГП занят: паллета стоит на месте паллетирования, укладка ждёт, накопители полны; место освободилось — дальше', () => {
    const s = newPlant(bare, { scenario: SC });
    const b = order(s, N20);
    live(s, 10, undefined, () => b.pack?.state === 'ready' || b.pack?.state === 'running');
    // все места карантина ГП и одно из двух мест паллетирования заняты чужими паллетами
    const fgq = plan.byKind.fgQuarantine;
    const busy = [...fgq, plan.byKind.palletizing[0]];
    const { lot } = createLot(bare, s, { material: 'mat.pk.case', supplier: 'sup.pack', qty: busy.length * 2000, status: 'released', where: i => ({ kind: 'slot', id: busy[i].id }) });
    const line = s.lines['line-1'];
    const g = geo(bare, s, line, N20);
    let blocked = false;
    live(s, 5, undefined, () => {
      const m = line.machines;
      blocked = b.pack?.state === 'running' && m.every(mc => mc.rate === 0) && m[2].state === 'wait' && m[1].pos - m[2].pos === g.cap[1] && m[0].pos - m[1].pos === g.cap[0];
      return blocked;
    });
    expect(blocked).toBe(true);
    expect(line.cases).toBe(g.perPallet);
    expect(plan.byKind.palletizing.every(sl => s.slots[sl.id]?.unit)).toBe(true);
    // убрать чужие паллеты — линия доупаковывает серию
    for (const c of containersByLot(s).get(lot.id)!) delete s.containers[c.id];
    for (const sl of busy) {
      delete s.units[s.slots[sl.id].unit!];
      delete s.slots[sl.id].unit;
    }
    delete s.lots[lot.id];
    live(s, 10, undefined, () => b.status === 'released');
    expect(b.status).toBe('released');
  });
});

describe('уполномоченное лицо', () => {
  test('открытое отклонение серии — держать: ГП заблокирована и ждёт на стеллаже (Б2в); «выпустить» при неоценённом отклонении — отказ, оценка «без влияния» — серия выпущена (Б1г)', () => {
    const s = newPlant(bare, { scenario: SC });
    // посты производства и качества — у игрока: задание на серию — его, а коллега качества отклонения не оценивает
    apply(bare, s, { kind: 'seat', seats: ['production', 'quality'] });
    const b = order(s, N20);
    live(s, 10, undefined, () => b.status === 'fg');
    s.deviations.D900 = { id: 'D900', opened: s.t, kind: 'ipc', batch: b.id, stage: 'compress', test: 'test.ipc.mass', status: 'open' };
    const out = live(s, 5, undefined, () => b.held === true);
    expect(out.some(n => n.kind === 'batchHeld' && n.batch === b.id && !n.mine)).toBe(true);
    expect(s.lots[b.pack!.fg!].status).toBe('blocked');
    // зона карантина ГП свободна для следующих серий: удержанные паллеты уехали на стеллажи хранения
    live(s, 1, undefined, () => !Object.values(s.tasks).some(t => t.lot === b.pack!.fg));
    for (const c of containersByLot(s).get(b.pack!.fg!)!) expect(plan.slot[(s.units[c.unit].where as { id: string }).id].kind).toBe('storage');
    // до подтверждения серии отклонения должны быть оценены (прил. 16, п. 6.1): выпустить нельзя никому
    expect(apply(bare, s, { kind: 'release', batch: b.id, decision: 'release' })).toEqual([{ kind: 'refused', cmd: 'release', why: 'devOpen', detail: 'D900' }]);
    // испытания балка готовы и в пределах — «без влияния»; специалист ООК работает час, затем серию снова решает УЛ
    expect(apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'none' })).toEqual([]);
    const done = live(s, 3, undefined, () => b.status === 'released');
    expect(done.some(n => n.kind === 'assessed' && n.id === 'D900' && n.verdict === 'none')).toBe(true);
    expect(b.status).toBe('released');
    expect(s.deviations.D900).toMatchObject({ status: 'assessed', assess: { verdict: 'none', by: 'player' } });
  });

  test('решение «отклонить»: ГП — в зону отклонённого', () => {
    const s = newPlant(bare, { scenario: SC });
    const b = order(s, N20);
    live(s, 10, undefined, () => b.status === 'fg');
    apply(bare, s, { kind: 'release', batch: b.id, decision: 'reject' });
    const out = live(s, 5, undefined, () => b.status === 'rejected' && !Object.values(s.tasks).some(t => t.lot === b.pack!.fg));
    expect(out.some(n => n.kind === 'batchRejected')).toBe(true);
    for (const c of containersByLot(s).get(b.pack!.fg!)!) expect(plan.slot[(s.units[c.unit].where as { id: string }).id].kind).toBe('rejected');
  });

  test('решение «держать» без отклонений — извещение «по вашему решению»; «выпустить» из удержания — серия выпущена (Б1г)', () => {
    const s = newPlant(bare, { scenario: SC });
    const b = order(s, N20);
    live(s, 10, undefined, () => b.status === 'fg');
    expect(apply(bare, s, { kind: 'release', batch: b.id, decision: 'hold' })).toEqual([]);
    const out = live(s, 5, undefined, () => b.held === true);
    expect(out.some(n => n.kind === 'batchHeld' && n.batch === b.id && n.mine === true)).toBe(true);
    expect(s.lots[b.pack!.fg!].status).toBe('blocked');
    expect(apply(bare, s, { kind: 'release', batch: b.id, decision: 'release' })).toEqual([]);
    live(s, 2, undefined, () => b.status === 'released');
    expect(b.status).toBe('released');
  });
});

describe('команды', () => {
  test('отказы: нет серии, нет позиции, уже упаковывается; решение — только по упакованной серии', () => {
    const s = newPlant(bare, { scenario: SC });
    const b = order(s, N20);
    expect(apply(bare, s, { kind: 'pack', batch: 'B999', sku: N20 })).toEqual([{ kind: 'refused', cmd: 'pack', why: 'noBatch', detail: 'B999' }]);
    expect(apply(bare, s, { kind: 'pack', batch: b.id, sku: 'sku.none' })).toEqual([{ kind: 'refused', cmd: 'pack', why: 'noSku', detail: 'sku.none' }]);
    expect(apply(bare, s, { kind: 'release', batch: b.id, decision: 'release' })).toEqual([{ kind: 'refused', cmd: 'release', why: 'notReady', detail: b.id }]);
    live(s, 10, undefined, () => b.status === 'packing');
    expect(apply(bare, s, { kind: 'pack', batch: b.id, sku: N10 })).toEqual([{ kind: 'refused', cmd: 'pack', why: 'notBulk', detail: b.id }]);
  });

  test('серия без позиции ждёт балком; команда «упаковать» — и линия её упаковывает', () => {
    const s = newPlant(bare, { scenario: SC });
    const b = order(s);
    live(s, 8, undefined, () => s.lots[b.bulk ?? '']?.status === 'released');
    live(s, 1);
    expect(b.status).toBe('bulk');
    expect(apply(bare, s, { kind: 'pack', batch: b.id, sku: N10 })).toEqual([]);
    expect(b.status).toBe('packing');
    live(s, 6, undefined, () => b.status === 'released');
    expect(b.status).toBe('released');
    expect(s.lots[b.pack!.fg!].material).toBe(db.skus[N10].fg);
  });
});

describe('время и сохранение', () => {
  /** Серия на линии: остановиться, когда пошла упаковка. */
  function running(): PlantState {
    const s = newPlant(bare, { scenario: SC });
    const b = order(s, N10);
    while (!(b.pack?.state === 'running' && s.lines['line-1'].cases > 3)) apply(bare, s, { kind: 'advance', seconds: 10 * MIN });
    return s;
  }

  test('снимок посреди упаковки продолжается так же, как оригинал', () => {
    const s = running();
    expect(s.lines['line-1'].machines[0].pos).toBeGreaterThan(0);
    const copy = fromSave(bare, toSave(s));
    apply(bare, s, { kind: 'advance', seconds: 2 * DAY });
    apply(bare, copy, { kind: 'advance', seconds: 2 * DAY });
    expect(fingerprint(copy)).toBe(fingerprint(s));
  });

  test('упаковка срезами по 1 с, 60 с и 3 600 с — то же состояние, что одним куском', () => {
    const base = toSave(running());
    const prints = [1, 60, 3600, 2 * DAY].map(step => {
      const s = fromSave(bare, base);
      const end = s.t + 2 * DAY;
      // по 1 с — только первые 2 часа: дальше шаг крупнее
      while (s.t < end) apply(bare, s, { kind: 'advance', seconds: Math.min(step === 1 && s.t - (end - 2 * DAY) < 2 * HOUR ? 1 : step === 1 ? 60 : step, end - s.t) });
      return fingerprint(s);
    });
    expect(new Set(prints).size).toBe(1);
  });
});

describe('срок годности ГП (Рекомендация Коллегии ЕЭК № 2, приложение)', () => {
  const day = (y: number, m: number, d: number) => daysFromCivil({ y, m, d });
  test.each([
    ['произведено 28.01, выпуск 30.01 → 01/2017', day(2015, 1, 28), day(2015, 1, 30), day(2017, 1, 31)],
    ['произведено 03.01, выпуск 05.01 → 12/2016', day(2015, 1, 3), day(2015, 1, 5), day(2016, 12, 31)],
    ['выпуск через 29 дней: 01.02 → 01/2017', day(2015, 1, 3), day(2015, 2, 1), day(2017, 1, 31)],
    ['выпуск позже 30 дней: от производства → 12/2016', day(2015, 1, 3), day(2015, 7, 21), day(2016, 12, 31)],
  ])('%s', (_name, prod, release, expiry) => {
    expect(fgExpiry(prod, release, 24)).toBe(expiry);
  });
});

test('позиции и накопители — в шестидесятых долях таблетки', () => {
  const g = geo(bare, newPlant(bare, { scenario: SC }), newPlant(bare, { scenario: SC }).lines['line-1'], N20);
  expect(g.nominal).toEqual([120 * 10, 70 * 20, 100 * 20]);
  expect(g.cap).toEqual([600 * 10 * SIXTY, 400 * 20 * SIXTY]);
});
