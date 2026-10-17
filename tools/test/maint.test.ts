// Часть 1е: износ и ремонт (docs/specs/2026-10-engine.md, 1е). Отказ — по таблице интенсивности от износа, а не по
// часам; отказ пуансонов посреди стадии и её продолжение после ремонта; ремонт ждёт запчасть; пополнение ЗИП по уровню;
// замена по наработке и командой; авария блистерной машины в OEE; микроостановки чаще с износом; причина износа и
// разброс МОК; заминки картонажной и расхождение сверки; сохранение посреди ремонта. Резерв ЗИП, узлы и сверку проверяют
// инварианты на каждом шаге.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { ContentDb, PartType } from '../../src/content/types';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { P_ONE, Rng } from '../../src/engine/core/rng';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { consume, ONE_FAILURE, partType, untilFail } from '../../src/engine/maint';
import { expo } from '../../src/engine/random';
import { fromSave, toSave } from '../../src/engine/save';
import type { Batch, Notice, PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const RCP = 'rcp.paracetamol500.wet.v1';
const N20 = 'sku.paracetamol500.n20';
const PUNCHES = 'press-1/punches';
const PLATE = 'blister-1/sealplate';
const NEVER = Number.MAX_SAFE_INTEGER;

/** Завод без заданий сценария; узлы новые, техслужба — по отказу: серии, износ и политика — в тесте. */
const variant = (sc: Partial<ContentDb['scenarios'][string]> = {}, rest: Partial<ContentDb> = {}): ContentDb => ({
  ...db,
  ...rest,
  scenarios: { ...db.scenarios, [SC]: { ...db.scenarios[SC], batches: [], wear: {}, maint: {}, ...sc } },
});
const bare = variant();

/** Прожить до `days` суток часами с инвариантами; `until` — остановиться раньше. */
function live(base: ContentDb, s: PlantState, days: number, until?: () => boolean): Notice[] {
  const out: Notice[] = [];
  const end = s.t + days * DAY;
  while (s.t < end && !until?.()) {
    out.push(...apply(base, s, { kind: 'advance', seconds: Math.min(HOUR, end - s.t) }));
    const bad = check(base, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
  return out;
}

function order(base: ContentDb, s: PlantState, sku?: string, notBefore = s.t): Batch {
  const n = Object.keys(s.batches).length;
  apply(base, s, { kind: 'order', recipe: RCP, notBefore, ...(sku ? { sku } : {}) });
  return Object.values(s.batches)[n];
}

/** Узел откажет на `n`-й единице наработки от нынешней: запас — ровно столько, сколько она съест. */
function failAfter(base: ContentDb, s: PlantState, id: string, n: number) {
  const pt = s.parts[id];
  pt.budget = consume(partType(base, pt), pt.done, n);
}

const compress = (b: Batch) => b.records.find(r => r.stage === 'compress')!;
const tabletsOf = (b: Batch) => Math.floor((compress(b).in * db.recipes[RCP].batch.units) / db.recipes[RCP].batch.mass);

describe('запас до отказа и таблица интенсивности', () => {
  const t: PartType = { ...db.equipment['eq.press'].parts[0], life: 1_000_000, hazard: [[0, 1_000], [5000, 50_000], [10000, 400_000]] };

  test('на последней единице до отказа запас кончается, на предпоследней — ещё нет', () => {
    const r = Rng.seeded(5).fork('test');
    for (let k = 0; k < 2000; k++) {
      const done = r.int(1_500_000);
      const budget = expo(r, ONE_FAILURE);
      const n = untilFail(t, done, budget);
      expect(Number.isFinite(n) && n >= 1).toBe(true);
      expect(consume(t, done, n)).toBeGreaterThanOrEqual(budget);
      expect(consume(t, done, n - 1)).toBeLessThan(budget);
    }
  });

  test('при постоянной интенсивности средняя наработка до отказа — миллион на число отказов на миллион', () => {
    const flat: PartType = { ...t, hazard: [[0, 2_000_000]] };
    const r = Rng.seeded(9).fork('test');
    const xs = Array.from({ length: 4000 }, () => untilFail(flat, 0, expo(r, ONE_FAILURE)));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean - 500_000)).toBeLessThan(0.05 * 500_000);
  });

  test('нулевая интенсивность — отказа нет при любой наработке; дальше по износу — раньше', () => {
    expect(untilFail({ ...t, hazard: [[0, 0]] }, 0, 1)).toBe(Infinity);
    // тот же запас: изношенный узел откажет раньше нового
    expect(untilFail(t, 1_200_000, ONE_FAILURE)).toBeLessThan(untilFail(t, 0, ONE_FAILURE));
  });
});

describe('отказ пуансонов посреди таблетирования', () => {
  const s = newPlant(bare, { scenario: SC });
  failAfter(bare, s, PUNCHES, 90_000);
  const b = order(bare, s);
  const out = live(bare, s, 10, () => b.status === 'bulk');
  const rec = compress(b);
  const pt = s.parts[PUNCHES];
  const [failure, repair] = s.maintLog;

  test('отказ — на 90 000-й таблетке; ремонт после отказа — слесарь с запчастью из мастерской', () => {
    expect(b.status).toBe('bulk');
    expect(s.maintLog.map(e => e.what)).toEqual(['failure', 'repair']);
    expect(failure.batch).toBe(b.id);
    expect(repair.people!.map(p => s.people[p].role)).toEqual(['role.mechanic']);
    expect(out.filter(n => n.kind === 'failure' || n.kind === 'repaired').map(n => n.kind)).toEqual(['failure', 'repaired']);
    // после ремонта комплект новый: его наработка — остаток стадии
    expect(pt.state).toBe('ok');
    expect(pt.done).toBe(tabletsOf(b) - 90_000);
  });

  test('стадия встала и продолжилась: простой в досье — от отказа до возврата аппаратчика, не короче ремонта', () => {
    expect(rec.stops).toHaveLength(1);
    const [stop] = rec.stops!;
    expect(stop.from).toBe(failure.t);
    expect(stop.to).toBeGreaterThanOrEqual(repair.t);
    expect(stop.to - stop.from).toBeGreaterThanOrEqual(partType(bare, pt).repair[0]);
    // МОК — по времени работы: в простой замеров нет
    for (const x of rec.ipc) expect(x.t <= stop.from || x.t >= stop.to).toBe(true);
    expect(rec.wear![PUNCHES]).toBeGreaterThanOrEqual(0);
  });

  test('запчасть израсходована и заказана снова: неснижаемый уровень 0, начальный 1; предоплата — сразу', () => {
    expect(s.spares['spare.punches']).toEqual({ qty: 0, reserved: 0 });
    const orders = Object.values(s.spareOrders);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ spare: 'spare.punches', qty: 1, status: 'ordered' });
    expect(s.cash.ledger.some(e => e.item === 'prepay' && e.ref === orders[0].id && e.sum === -orders[0].prepaid)).toBe(true);
  });
});

test('запчасти нет — ремонт ждёт поставки: простой = ожидание запчасти + работа', () => {
  const s = newPlant(bare, { scenario: SC });
  s.spares['spare.punches'].qty = 0;
  failAfter(bare, s, PUNCHES, 90_000);
  const b = order(bare, s);
  live(bare, s, 120, () => b.status === 'bulk');
  expect(b.status).toBe('bulk');
  const o = Object.values(s.spareOrders)[0];
  const [failure, repair] = s.maintLog;
  // заказ — в момент отказа; срок — по записи запчасти; ремонт — после поставки
  expect(o.ordered).toBe(failure.t);
  const lead = db.spares['spare.punches'].lead;
  expect(o.eta - o.ordered).toBeGreaterThanOrEqual((lead[0] - 1) * DAY);
  expect(o.eta - o.ordered).toBeLessThanOrEqual((lead[1] + 4) * DAY);
  expect(repair.t).toBeGreaterThanOrEqual(o.eta + partType(bare, s.parts[PUNCHES]).repair[0]);
  expect(compress(b).stops![0].to).toBeGreaterThan(repair.t);
  // пришла — НДС к вычету, остаток — к оплате; снова на нуле — снова заказ
  expect(s.cash.dues.some(d => d.ref === o.id && d.sum === -(o.sum - o.prepaid)) || s.cash.ledger.some(e => e.ref === o.id && e.item === 'supplier')).toBe(true);
  expect(Object.values(s.spareOrders)).toHaveLength(2);
});

test('по наработке: износ дошёл до порога — замена, как только пресс свободен; следующая серия ждёт её', () => {
  const base = variant({ wear: { [PUNCHES]: 9_990 }, maint: { [PUNCHES]: 10_000 } });
  const s = newPlant(base, { scenario: SC });
  s.parts[PUNCHES].budget = NEVER;
  const b1 = order(base, s);
  const b2 = order(base, s, undefined, s.t + HOUR);
  const out = live(base, s, 20, () => b2.status === 'bulk');
  expect(s.maintLog.map(e => e.what)).toEqual(['replace']);
  const done = s.maintLog[0];
  expect(done.wear).toBeGreaterThanOrEqual(10_000);
  expect(done.t).toBeGreaterThan(compress(b1).end);
  expect(compress(b2).start).toBeGreaterThan(done.t);
  // новый комплект: у второй серии износ — доли процента
  expect(compress(b2).wear![PUNCHES]).toBeLessThan(100);
  expect(out.some(n => n.kind === 'repaired' && n.planned)).toBe(true);
});

test('команда maintain: нет узла, нет запчасти, принята, уже в работе', () => {
  const s = newPlant(bare, { scenario: SC });
  const why = (machine: string, part: string) => {
    const n = apply(bare, s, { kind: 'maintain', machine, part }).find(x => x.kind === 'refused');
    return n?.kind === 'refused' ? n.why : undefined;
  };
  expect(why('press-1', 'drive')).toBe('noPart');
  s.spares['spare.sealplate'].qty = 0;
  expect(why('blister-1', 'sealplate')).toBe('noSpare');
  s.spares['spare.sealplate'].qty = 1;
  s.parts[PUNCHES].done = 1_000_000;
  expect(why('press-1', 'punches')).toBeUndefined();
  expect(why('press-1', 'punches')).toBe('busy');
  const out = live(bare, s, 1, () => s.maintLog.length > 0);
  expect(s.maintLog[0]).toMatchObject({ machine: 'press-1', part: 'punches', what: 'replace' });
  expect(s.parts[PUNCHES].done).toBe(0);
  expect(out.some(n => n.kind === 'repaired' && n.machine === 'press-1' && n.planned)).toBe(true);
});

describe('авария блистерной машины', () => {
  const s = newPlant(bare, { scenario: SC });
  failAfter(bare, s, PLATE, 8_000);
  const b = order(bare, s, N20);
  live(bare, s, 15, () => b.pack?.state === 'done');
  const oee = Object.fromEntries(b.pack!.oee!.map(o => [o.machine, o.times]));

  test('отказ на 8 000-м блистере; линия встаёт, после ремонта доупаковывает серию', () => {
    expect(b.pack!.state).toBe('done');
    expect(s.maintLog.map(e => `${e.machine}:${e.what}`)).toEqual(['blister-1:failure', 'blister-1:repair']);
    expect(s.parts[PLATE].done).toBe(b.pack!.blisters! - 8_000);
  });

  test('время аварии — своей строкой в OEE блистерной: не короче ремонта; у других машин аварий нет', () => {
    expect(oee['blister-1'].fail).toBeGreaterThanOrEqual(partType(bare, s.parts[PLATE]).repair[0]);
    expect(oee['cartoner-1'].fail).toBe(0);
    expect(oee['casepack-1'].fail).toBe(0);
  });
});

test('микроостановки блистерной чаще с износом плиты запайки', () => {
  const micro = (wear: number) => {
    const base = variant({ wear: { [PLATE]: wear } });
    const s = newPlant(base, { scenario: SC });
    s.parts[PLATE].budget = NEVER;
    const b = order(base, s, N20);
    live(base, s, 15, () => b.pack?.state === 'done');
    return b.pack!.oee!.find(o => o.machine === 'blister-1')!.times.micro;
  };
  // при износе 200 % — втрое чаще (запись узла: вдвое при 100 %)
  expect(micro(20_000)).toBeGreaterThan(2 * micro(0));
});

describe('износ пуансонов в качестве серии', () => {
  const base = variant({ wear: { [PUNCHES]: 50_000 } });
  const s = newPlant(base, { scenario: SC });
  s.parts[PUNCHES].budget = NEVER;
  const b = order(base, s);
  live(base, s, 10, () => b.status === 'bulk');
  const rec = compress(b);

  test('средний износ за стадию — в досье; вклад причины — коэффициент × износ', () => {
    const w = rec.wear![PUNCHES];
    expect(w).toBeGreaterThan(50_000);
    for (const e of db.causes['cause.press.tooling'].effects) {
      const hit = b.causes.find(c => c.cause === 'cause.press.tooling' && c.attr === e.attr)!;
      expect(hit.delta).toBe(Math.round(e.coef * w));
      expect(hit.stage).toBe('compress');
    }
  });

  test('разброс МОК прочности по ходу стадии — много больше погрешности методики', () => {
    const readings = rec.ipc.filter(x => x.test === 'test.ipc.hardness').map(x => Math.abs(x.result - b.truth.hardness!));
    expect(readings.length).toBeGreaterThan(2);
    const mean = readings.reduce((a, x) => a + x, 0) / readings.length;
    expect(mean).toBeGreaterThan(3 * db.tests['test.ipc.hardness'].sd);
  });
});

test('заминки картонажной: испорченное — в сверке; незаписанное — расхождение и отклонение выше предела', () => {
  const cartoner = db.machines['mach.cartoner'];
  const sku = db.skus[N20];
  const base = variant({}, {
    machines: { ...db.machines, 'mach.cartoner': { ...cartoner, jam: { cartons: 20, uncounted: P_ONE } } },
    skus: { ...db.skus, [N20]: { ...sku, waste: { ...sku.waste, jams: 400 } } },
  });
  const s = newPlant(base, { scenario: SC });
  s.parts[PLATE].budget = NEVER;
  const b = order(base, s, N20);
  live(base, s, 15, () => b.held === true || b.status === 'released');
  const job = b.pack!;
  expect(job.jams).toBeGreaterThan(0);
  expect(job.jammed).toBe(20 * job.jams!);
  expect(job.lost).toBe(job.jammed);
  for (const r of job.recon!) {
    // испорченное по записям — без незаписанного; возвращено — что осталось на самом деле
    expect(r.spoiled).toBe(job.cartonRejects! + sku.waste.cartons + job.jammed! - job.lost!);
    expect(r.issued - r.used - r.spoiled - r.returned).toBe(job.lost!);
  }
  const recon = Object.values(s.deviations).filter(d => d.kind === 'recon' && d.batch === b.id);
  expect(recon.map(d => d.material).sort()).toEqual(sku.carton.map(l => l.material).sort());
  expect(b.held).toBe(true);
});

test('сохранение схемы 6: узлы — с износом сценария, ЗИП — начальный уровень, мастерская; дальше живёт с инвариантами', async () => {
  const s = fromSave(db, await Bun.file(new URL('./fixtures/save-v6.json', import.meta.url)).text());
  expect(Object.keys(s.parts).sort()).toEqual([PLATE, PUNCHES]);
  const punches = db.equipment['eq.press'].parts[0];
  expect(s.parts[PUNCHES].done).toBe(Math.floor((punches.life * db.scenarios[SC].wear[PUNCHES]) / P_ONE));
  expect(s.spares).toEqual({ 'spare.punches': { qty: 1, reserved: 0 }, 'spare.sealplate': { qty: 1, reserved: 0 } });
  expect(s.rooms.workshop.status).toBe('clean');
  for (const l of Object.values(s.lines)) for (const m of l.machines) expect(m.times.fail).toBe(0);
  expect(check(db, s)).toEqual([]);
  live(db, s, 20);
});

test('снимок посреди ремонта продолжается так же, как оригинал', () => {
  const s = newPlant(bare, { scenario: SC });
  failAfter(bare, s, PUNCHES, 90_000);
  order(bare, s);
  live(bare, s, 10, () => Object.values(s.tasks).some(t => t.kind === 'repair' && t.state === 'busy'));
  expect(s.parts[PUNCHES].state).toBe('failed');
  const copy = fromSave(bare, toSave(s));
  live(bare, s, 2);
  live(bare, copy, 2);
  expect(fingerprint(copy)).toBe(fingerprint(s));
});
