// Часть 1б: лаборатория (docs/specs/2026-10-engine.md, 1б). План отбора; нормальная величина движка; ложное отклонение
// годной партии на 10 000 прогонах — у расчётной вероятности, в пределах трёх сигм; путь партии через пробоотборную и
// лабораторию; ВЭЖХ работает ночью сама; проверка вторым лицом; брак ловится, отклонённое — в зону отклонённого; ни одна
// партия не уходит дальше карантина до решения; сохранение посреди испытания.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { ContentDb, SpecLine } from '../../src/content/types';
import { DAY, HOUR, MIN, momentOf } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { P_ONE, Rng } from '../../src/engine/core/rng';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { DECIDE_WORK, REVIEW_WORK, sampleCount } from '../../src/engine/lab';
import { planOf } from '../../src/engine/plant';
import { measure, nominal, type Props, within } from '../../src/engine/quality';
import { normal, spread } from '../../src/engine/random';
import { fromSave, toSave } from '../../src/engine/save';
import type { Lot, Notice, PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const plan = planOf(db, db.scenarios[SC].plant);
const API = 'mat.api.paracetamol';
/** Тот же завод без заданий на серию: путь партии через лабораторию — без балка в очереди и без расхода в серии. */
const labOnly: ContentDb = { ...db, scenarios: { ...db.scenarios, [SC]: { ...db.scenarios[SC], batches: [] } } };

/** Точное распределение суммы 12 равномерных целых [0, 10 000) — того, из чего `normal` делает нормальную величину. */
function sumPmf(): Float64Array {
  let pmf = new Float64Array([1]);
  for (let k = 0; k < 12; k++) {
    const next = new Float64Array(pmf.length + 9999);
    let acc = 0;
    for (let m = 0; m < next.length; m++) {
      if (m < pmf.length) acc += pmf[m];
      if (m >= 10000) acc -= pmf[m - 10000];
      next[m] = acc / 10000;
    }
    pmf = next;
  }
  return pmf;
}
const PMF = sumPmf();

/** Вероятность события над нормальной величиной движка `z` (доли 1/10 000): точная, по распределению суммы. */
function pNormal(event: (z: number) => boolean): number {
  let p = 0;
  for (let m = 0; m < PMF.length; m++) if (event(m - 59994)) p += PMF[m];
  return p;
}

/** Расчётная вероятность отклонить партию с истинными свойствами `truth`: хоть одно испытание вне пределов. */
function pReject(lines: SpecLine[], truth: Props): number {
  let pass = 1;
  for (const line of lines) {
    const m = db.tests[line.test];
    const t = truth[m.attr] ?? 0;
    pass *= m.sd === 0 ? Number(within(line, t)) : 1 - pNormal(z => !within(line, t + spread(m.sd, z)));
  }
  return 1 - pass;
}

/** Испытания партии по спецификации — как в лаборатории движка (lab.ts): результат из ветви прибора, решение по пределам. */
function judge(s: PlantState, lines: SpecLine[], truth: Props): boolean {
  return lines.every(line => {
    const m = db.tests[line.test];
    const inst = plan.plant.instruments.find(i => i.type === m.inst)?.id ?? m.id;
    return within(line, measure(s, `qc/${inst}`, truth[m.attr] ?? 0, m.sd));
  });
}

/** Прожить `days` суток кусками по `step` (час): инварианты — после каждого куска, `look` — перед каждым событием. */
function live(s: PlantState, days: number, look?: () => void, step = HOUR, base: ContentDb = db): Notice[] {
  const out: Notice[] = [];
  const end = s.t + days * DAY;
  const more = look ? () => (look(), true) : undefined;
  while (s.t < end) {
    out.push(...apply(base, s, { kind: 'advance', seconds: Math.min(step, end - s.t) }, more));
    look?.();
    const bad = check(base, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
  return out;
}

const fresh = (s: PlantState, material: string) => Object.values(s.lots).find(l => l.material === material && l.po);

describe('план отбора', () => {
  const lot = (material: string, supplier: string) => ({ material, supplier }) as Lot;

  test('АФС — каждая тара; одобренный поставщик — 1 + ⌈√N⌉, не больше N; неодобренный — каждая', () => {
    const exc = lot('mat.exc.starch', 'sup.exc');
    expect([1, 2, 3, 4, 5, 9, 10, 16, 17, 20, 40].map(n => sampleCount(db, exc, n))).toEqual([1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 8]);
    expect(sampleCount(db, lot(API, 'sup.api'), 20)).toBe(20);
    const strict: ContentDb = { ...db, suppliers: { ...db.suppliers, 'sup.exc': { ...db.suppliers['sup.exc'], approved: false } } };
    expect(sampleCount(strict, exc, 20)).toBe(20);
  });
});

describe('нормальная величина', () => {
  test('сумма 12 равномерных целых: среднее 0, СКО 1, хвост за 2 СКО — как у точного распределения', () => {
    const r = Rng.seeded(7);
    const N = 200_000;
    let sum = 0;
    let sq = 0;
    let tail = 0;
    let whole = true;
    for (let i = 0; i < N; i++) {
      const z = normal(r);
      whole &&= Number.isInteger(z) && Math.abs(z) <= 59994;
      sum += z / 10000;
      sq += (z / 10000) ** 2;
      if (Math.abs(z) > 20000) tail++;
    }
    expect(whole).toBe(true);
    expect(Math.abs(sum / N)).toBeLessThan(0.01);
    expect(Math.abs(Math.sqrt(sq / N) - 1)).toBeLessThan(0.01);
    const p = pNormal(z => Math.abs(z) > 20000);
    expect(p).toBeGreaterThan(0.04);
    expect(p).toBeLessThan(0.05);
    expect(Math.abs(tail - N * p)).toBeLessThan(4 * Math.sqrt(N * p * (1 - p)));
  });
});

describe('ложное отклонение', () => {
  const lines = db.specs[db.materials[API].spec].tests;
  test.each([
    ['номинальная партия', nominal(db, API)],
    ['партия у нижнего предела', { identity: P_ONE, assay: 9900, moisture: 30 }],
  ])('%s: доля отклонений на 10 000 прогонах — у расчётной, в пределах трёх сигм', (_name, truth) => {
    // заведомо годная: все истинные свойства в пределах спецификации
    for (const line of lines) expect(within(line, truth[db.tests[line.test].attr] ?? 0)).toBe(true);
    const s = newPlant(db, { scenario: SC, seed: 5 });
    const N = 10_000;
    let rejected = 0;
    for (let i = 0; i < N; i++) if (!judge(s, lines, truth)) rejected++;
    const p = pReject(lines, truth);
    expect(p).toBeGreaterThan(0);
    expect(Math.abs(rejected - N * p)).toBeLessThan(3 * Math.sqrt(N * p * (1 - p)));
  });
});

describe('путь партии', () => {
  test('АФС: все бочки в пробах, ВЭЖХ — ночью сама, результат проверяет второе лицо, решение — начальник ОКК', () => {
    const s = newPlant(labOnly, { scenario: SC });
    // смены испытаний: когда какое состояние началось
    const seen: Record<string, { state: string; t: number }[]> = {};
    const busy: Record<string, string[]> = {};
    live(s, 90, () => {
      for (const q of Object.values(s.tests)) {
        const h = (seen[q.id] ??= []);
        if (h.at(-1)?.state !== q.state) h.push({ state: q.state, t: s.t });
      }
      for (const i of Object.values(s.instruments)) if (i.test && !(busy[i.id] ??= []).includes(i.test)) busy[i.id].push(i.test);
    }, HOUR, labOnly);
    const lot = fresh(s, API)!;
    expect(lot.status).toBe('released');
    // проба — с каждой бочки по 20 г: бочки вскрыты, масса списана
    const drums = Object.values(s.containers).filter(c => c.lot === lot.id);
    expect(drums.length).toBe(20);
    expect(lot.sampled).toBe(20 * 20_000);
    for (const c of drums) expect([c.opened, c.qty]).toEqual([true, 50_000_000 - 20_000]);
    const sm = s.samples[lot.sample!];
    expect(sm.plan.length).toBe(20);
    expect(sm.tests.map(id => s.tests[id].method)).toEqual(['test.ir', 'test.hplc-assay', 'test.lod']);
    for (const id of sm.tests) {
      const q = s.tests[id];
      // проверил не тот, кто испытывал; проверяет аналитик или начальник ОКК
      expect(q.checker).not.toBe(q.by);
      expect(['role.analyst', 'role.qc-head']).toContain(s.people[q.checker!].role);
      expect(s.people[q.by!].role).toBe('role.analyst');
      expect(q.pass).toBe(true);
    }
    // ВЭЖХ: подготовка — 2,5 часа аналитика, потом 8 часов прибор один; результат — уже вне смены аналитиков
    const hplc = s.tests[sm.tests[1]];
    const h = Object.fromEntries(seen[hplc.id].map(x => [x.state, x.t]));
    expect(h.run - h.prep).toBeGreaterThanOrEqual(db.tests['test.hplc-assay'].prep);
    expect(h.run - h.prep).toBeLessThan(db.tests['test.hplc-assay'].prep + 10 * MIN);
    expect(h.review - h.run).toBe(db.tests['test.hplc-assay'].run);
    const ready = momentOf(s.start, h.review);
    expect(ready.weekday >= 5 || ready.sec < 8 * HOUR || ready.sec >= 17 * HOUR).toBe(true);
    // проверка ждёт утра: она в рабочее время, не раньше 15 минут после начала смены
    const checked = momentOf(s.start, h.done);
    expect(checked.weekday).toBeLessThan(5);
    expect(checked.sec).toBeGreaterThanOrEqual(8 * HOUR + REVIEW_WORK);
    expect(busy['hplc-1']).toContain(hplc.id);
    // прибор свободен, задач нет; паллеты — на стеллажах
    for (const i of Object.values(s.instruments)) expect(i.test).toBeUndefined();
    expect(Object.keys(s.tasks)).toEqual([]);
    for (const u of Object.values(s.units)) expect(u.where.kind === 'slot' && plan.slot[u.where.id].kind).toBe('storage');
    // решение — не раньше 10 минут после последнего результата
    const last = Math.max(...sm.tests.map(id => seen[id].find(x => x.state === 'done')!.t));
    expect(lot.status).toBe('released');
    expect(last + DECIDE_WORK).toBeLessThanOrEqual(s.t);
  });

  test('брак ловится: партия отклонена, открыто отклонение, паллеты — в зоне отклонённого с красным ярлыком', () => {
    const s = newPlant(labOnly, { scenario: SC, seed: 2 });
    // ждём партию АФС в карантине и портим её истинное содержание: так брак выглядит изнутри движка
    while (!fresh(s, API)) apply(labOnly, s, { kind: 'advance', seconds: HOUR });
    const lot = fresh(s, API)!;
    lot.truth.assay = 9600;
    const out = live(s, 10, undefined, HOUR, labOnly);
    expect(lot.status).toBe('rejected');
    const n = out.find(x => x.kind === 'lotRejected');
    if (n?.kind !== 'lotRejected') throw new Error('no rejection');
    expect(n.lot).toBe(lot.id);
    const d = s.deviations[n.deviation];
    expect(d).toMatchObject({ kind: 'oos', lot: lot.id, status: 'open' });
    expect(d.tests!.map(id => s.tests[id].method)).toEqual(['test.hplc-assay']);
    // паспорт — без брака: изготовитель его не заметил
    expect(lot.coa.assay).not.toBe(9600);
    for (const u of Object.values(s.units).filter(u => s.containers[u.items[0]].lot === lot.id)) {
      expect(u.where.kind === 'slot' && plan.slot[u.where.id].kind).toBe('rejected');
      expect(u.tag).toBe('rejected');
    }
  });
});

describe('ни одна партия не уходит дальше карантина до решения', () => {
  // где паллета партии до решения — смотрим перед каждым событием; полные инварианты — раз в 6 часов: так 30 прогонов
  // укладываются в секунду
  test('30 зёрен × 90 суток: до решения паллеты — в приёмке, карантине и пробоотборной; решение — по результатам; брак отклонён', () => {
    let decided = 0;
    let bad = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = newPlant(db, { scenario: SC, seed });
      const out = live(s, 90, () => {
        for (const u of Object.values(s.units)) {
          // пластиковые паллеты в помещениях — комплект серии и балк: там до решения стоит только балк
          const lot = u.items.length > 0 ? s.lots[s.containers[u.items[0]].lot] : undefined;
          if (!lot || lot.status === 'released' || lot.status === 'rejected') continue;
          if (u.where.kind === 'room') {
            expect(db.materials[lot.material].kind).toBe('bulk');
            continue;
          }
          const kind = u.where.kind === 'slot' ? plan.slot[u.where.id].kind : 'truck';
          if (!['truck', 'receiving', 'quarantine', 'sampling'].includes(kind)) throw new Error(`seed ${seed}: ${lot.id} (${lot.status}) в «${kind}»`);
        }
      }, 6 * HOUR);
      for (const n of out) {
        if (n.kind !== 'lotReleased' && n.kind !== 'lotRejected') continue;
        const lot = s.lots[n.lot];
        if (lot.po) decided++;
        const tests = s.samples[lot.sample!].tests.map(id => s.tests[id]);
        const failed = tests.filter(q => !q.pass).map(q => q.id);
        if (n.kind === 'lotReleased') expect(failed).toEqual([]);
        else expect(s.deviations[n.deviation].tests).toEqual(failed);
        // брак: паспорт не сходится с истиной — сдвиг далеко за пределами, его ловят всегда; у балка паспорта нет
        if (lot.po && JSON.stringify(lot.truth) !== JSON.stringify(lot.coa)) {
          bad++;
          expect(n.kind).toBe('lotRejected');
        }
      }
      for (const lot of Object.values(s.lots)) expect(['released', 'rejected']).toContain(lot.status);
    }
    expect(decided).toBe(30 * db.scenarios[SC].orders.reduce((k, o) => k + o.lines.length, 0));
    expect(bad).toBeGreaterThan(0);
    // 30 прогонов с производством — около двух секунд; запас на медленную машину CI
  }, 20_000);
});

describe('сохранение посреди испытания', () => {
  test('снимок, пока ВЭЖХ работает сама, продолжается так же, как оригинал', () => {
    const s = newPlant(db, { scenario: SC });
    while (!Object.values(s.tests).some(q => q.state === 'run')) apply(db, s, { kind: 'advance', seconds: 600 });
    const copy = fromSave(db, toSave(s));
    apply(db, s, { kind: 'advance', seconds: 3 * DAY });
    apply(db, copy, { kind: 'advance', seconds: 3 * DAY });
    expect(fingerprint(copy)).toBe(fingerprint(s));
    expect(Object.values(s.tests).every(q => q.state === 'done')).toBe(true);
  });
});
