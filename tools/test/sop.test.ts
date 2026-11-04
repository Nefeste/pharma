// Б6г: совещание S&OP (src/engine/sop.ts, src/engine/plan/sop.ts; docs/specs/2026-10-vertical-slice.md, «Б6г»;
// геймдизайн, §9.2). Совещание — в третий рабочий день месяца в 10:00; без игрока лучший план утверждает коллега, с местом
// директора или «Производства» совещание ждёт команды `sop`. Прогон плана вперёд — правило начальника день за днём:
// серии по рабочим дням, запас и недопоставки сходятся до ящика; маржа пачки и цена денег в запасе — на примере; лучший
// план не хуже плана по политике и копит впрок только в резерве; утверждённый план — запас позиций правила; касса на три
// месяца; миграция схемы 41 → 42.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import { HEAD_ROLE } from '../../src/engine/bosses';
import { DAY, daysFromCivil, HOUR, isWorkday, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { firstDay, monthNo } from '../../src/engine/forecast';
import { check } from '../../src/engine/invariants';
import * as P from '../../src/engine/plan/sop';
import { fromSave } from '../../src/engine/save';
import { sopAt, sopCover, sopDay } from '../../src/engine/sop';
import type { Decided, Notice, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { buildDb } from '../content/load';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const start = daysFromCivil(sc.start.date);
/** Мгновение завода — секунды от полуночи дня старта. */
const at = (y: number, m: number, d: number, hour = 0) => (daysFromCivil({ y, m, d }) - start) * DAY + hour * HOUR;
const SEP = monthNo(2027, 9);
const OCT = SEP + 1;
const PARA = 'prd.paracetamol500';
const LOR = 'prd.loratadine10';
const N20 = 'sku.paracetamol500.n20';
const sops = (n: readonly Notice[]) => n.filter(x => x.kind === 'sop') as Extract<Notice, { kind: 'sop' }>[];
const refusals = (n: readonly Notice[]) => n.filter(x => x.kind === 'refused').map(x => (x as Extract<Notice, { kind: 'refused' }>).why);

const s0 = newPlant(db, { scenario: SC });

/** Завод за час до первого совещания — 3 сентября 2027 года в 09:00. */
const before = structuredClone(s0);
apply(db, before, { kind: 'advance', seconds: at(2027, 9, 3, 9) - before.t });

/** Ровная цель продукта на все месяцы. */
const flat = (days: number): Record<string, number[]> => ({ [PARA]: Array(P.SOP_MONTHS).fill(days), [LOR]: Array(P.SOP_MONTHS).fill(days) });

describe('день совещания', () => {
  test('третий рабочий день месяца в 10:00 — по производственному календарю профиля', () => {
    const cal = calOf(db, s0);
    for (let n = SEP; n < SEP + 18; n++) {
      const z = sopDay(db, s0, n);
      let k = 0;
      for (let d = firstDay(n); d < z; d++) if (isWorkday(cal, d)) k++;
      expect(k).toBe(2);
      expect(isWorkday(cal, z)).toBe(true);
      expect(sopAt(db, s0, n)).toBe((z - start) * DAY + 10 * HOUR);
    }
    expect(sopDay(db, s0, SEP)).toBe(daysFromCivil({ y: 2027, m: 9, d: 3 }));
  });

  test('в 10:00 дня совещания — одно совещание за месяц; в другие часы и дни — нет', () => {
    const s = structuredClone(before);
    const n1 = apply(db, s, { kind: 'advance', seconds: HOUR - 1 });
    expect(sops(n1)).toEqual([]);
    const n2 = apply(db, s, { kind: 'advance', seconds: 1 });
    expect(sops(n2)).toEqual([{ kind: 'sop', m: SEP, open: false }]);
    const n3 = apply(db, s, { kind: 'advance', seconds: at(2027, 10, 1) - s.t });
    expect(sops(n3)).toEqual([]);
    expect(s.planning.sop!.held).toBe(SEP);
  });
});

describe('маржа пачки и нагрузка серии', () => {
  test('маржинальный доход пачки — цена минус материалы и упаковка по цене пары и энергия серии', () => {
    for (const it of sc.plan!.items) {
      const m = P.packMargin(db, s0, it.sku);
      expect(m.price).toBe(db.skus[it.sku].price);
      expect(m.margin).toBe(m.price - m.bom - m.pack - m.energy);
      expect(m.bom).toBeGreaterThan(0);
      expect(m.pack).toBeGreaterThan(0);
      expect(m.energy).toBeGreaterThanOrEqual(0);
      expect(m.margin).toBeGreaterThan(0);
    }
  });

  test('нагрузка серии: одно задание, стадии грануляции и таблетирования по номиналу с малой уборкой, ВЭЖХ и аналитики, решение уполномоченного лица', () => {
    for (const p of [PARA, LOR]) {
      const l = P.batchLoad(db, s0, p);
      expect(l.slot).toBe(1);
      expect(l.qp).toBe(45 * 60);
      for (const res of ['hplc', 'analyst', 'line', 'granulation', 'compression'] as const) expect(l[res]).toBeGreaterThan(0);
      const h = P.batchHours(db, s0, p);
      expect(h['role.analyst']).toBe(l.analyst);
      expect(h['role.qp']).toBe(l.qp);
      for (const role of P.SOP_ROLES) expect(h[role]).toBeGreaterThan(0);
    }
  });

  test('мощность месяца — рабочие дни и смены людей по графику; часы ролей — без перерыва', () => {
    const c = P.capacityOf(db, s0, SEP);
    expect(c.cap.slot).toBe(22);
    // ВЭЖХ — длина дневной смены аналитиков (08:00–17:00) в каждый рабочий день
    expect(c.cap.hplc).toBe(22 * 9 * HOUR);
    // помещения — смены аппаратчиков с 07:00 до 23:00
    expect(c.cap.granulation).toBe(22 * 16 * HOUR);
    expect(c.cap.compression).toBe(c.cap.granulation);
    // два аналитика по 8 ч без перерыва
    expect(c.cap.analyst).toBe(22 * 2 * 8 * HOUR);
    expect(c.have['role.analyst']).toBe(c.cap.analyst);
    expect(c.cap.qp).toBe(c.have['role.qp']);
  });
});

describe('прогон плана вперёд', () => {
  const ctx = P.sopCtx(db, before, SEP);
  const trace: P.SopTrace = { sold: new Map(), demand: new Map(), made: [] };
  const r = P.sopRun(ctx, flat(21), 0, trace);

  test('новые серии — по рабочим дням через две рабочие недели, не больше одной в день; уже поставленные — в своём месяце', () => {
    const cal = calOf(db, before);
    const days = trace.made.map(b => b.day);
    expect(new Set(days).size).toBe(days.length);
    for (const z of days) expect(isWorkday(cal, z)).toBe(true);
    const taken = new Set(Object.values(before.batches).filter(b => b.status !== 'cancelled').map(b => momentOf(before.start, b.notBefore).day));
    for (const z of days) expect(taken.has(z)).toBe(false);
    for (const row of r.months) {
      const placed = Object.values(before.batches).filter(b => b.status !== 'cancelled' && momentOf(before.start, b.notBefore).day >= firstDay(row.m) && momentOf(before.start, b.notBefore).day < firstDay(row.m + 1)).length;
      const made = trace.made.filter(b => b.day >= firstDay(row.m) && b.day < firstDay(row.m + 1)).length;
      expect(row.batches[PARA] + row.batches[LOR]).toBe(placed + made);
      expect(row.load.slot).toBe(placed + made);
      expect(row.batches[PARA] + row.batches[LOR]).toBeLessThanOrEqual(row.cap.slot);
    }
  });

  test('запас и недопоставки сходятся до ящика: запас на конец — прежний, плюс выпуск, минус продано', () => {
    for (const it of sc.plan!.items) {
      let fg = ctx.fg.get(it.sku)!;
      // прогноз — медиана срока серий: в работе — от их первой стадии или «не раньше», новые — от «не раньше»
      const lead = ctx.lead.get(db.skus[it.sku].product)![1];
      const arrive = new Map<number, number>();
      for (const w of ctx.wip) {
        if (w.sku !== it.sku) continue;
        const z = Math.max(ctx.z0, momentOf(before.start, w.from + lead).day);
        arrive.set(z, (arrive.get(z) ?? 0) + w.cases);
      }
      for (const b of trace.made) {
        if (b.sku !== it.sku) continue;
        const z = momentOf(before.start, (b.day - ctx.zero) * DAY + 7 * HOUR + lead).day;
        arrive.set(z, (arrive.get(z) ?? 0) + ctx.cases.get(it.sku)!);
      }
      const sold = trace.sold.get(it.sku)!;
      const dem = trace.demand.get(it.sku)!;
      let i = 0;
      for (const row of r.months) {
        let d = 0;
        let s = 0;
        for (; ctx.z0 + i < firstDay(row.m + 1); i++) {
          fg += arrive.get(ctx.z0 + i) ?? 0;
          fg -= sold[i];
          d += dem[i];
          s += sold[i];
          expect(sold[i]).toBe(Math.min(Math.max(0, fg + sold[i]), dem[i]));
        }
        expect(row.stock[it.sku]).toBe(Math.floor(Math.max(0, fg) / 1000));
        expect(row.demand[it.sku]).toBe(Math.floor(d / 1000));
        expect(Math.abs(row.short[it.sku] - Math.floor((d - s) / 1000))).toBeLessThanOrEqual(1);
      }
    }
  });

  test('цель плана — маржа продаж минус цена денег в запасе; три варианта спроса — средняя', () => {
    expect(r.value).toBe(r.margin - r.carry);
    const e = P.sopEval(ctx, flat(21));
    const runs = P.SOP_CASES.map(k => P.sopRun(ctx, flat(21), k));
    expect(e.mean).toBe(Math.floor(runs.reduce((n, x) => n + x.value, 0) / 3));
    expect(e.high).toBe(runs[2].short);
    expect(runs[2].short).toBeGreaterThanOrEqual(runs[0].short);
  });

  test('цена денег в запасе: ГП без спроса и новых серий — запас × материалы и упаковка × ставка за сутки', () => {
    const quiet: P.SopCtx = { ...ctx, rate: new Map([...ctx.rate].map(([k, xs]) => [k, xs.map(() => 0)])), work: ctx.work.map(() => false), rule: ctx.rule.map(() => -1), wip: [] };
    const x = P.sopRun(quiet, flat(21));
    expect(x.margin).toBe(0);
    let want = 0;
    for (let z = quiet.z0; z < quiet.sell; z++)
      for (const it of sc.plan!.items) {
        const pm = quiet.margin.get(it.sku)!;
        want += Math.floor((Math.max(0, quiet.fg.get(it.sku)!) * db.skus[it.sku].case.per * (pm.bom + pm.pack) * quiet.carry) / (1000 * 365 * 10000));
      }
    expect(x.carry).toBe(want);
    expect(quiet.carry).toBe(db.profiles[sc.profile].key + sc.credit.spread);
  });

  test('больше запаса позиций — не меньше серий за горизонт', () => {
    const lo = P.sopRun(ctx, flat(7));
    const hi = P.sopRun(ctx, flat(42));
    const sum = (x: P.SopResult) => x.months.reduce((n, m) => n + m.batches[PARA] + m.batches[LOR], 0);
    expect(sum(hi)).toBeGreaterThanOrEqual(sum(lo));
  });
});

describe('лучший план', () => {
  const best = P.sopBest(db, before, SEP);
  test('не хуже плана по политике; цели — из вариантов политики «запас позиций»', () => {
    expect(best.result.mean).toBeGreaterThanOrEqual(best.base.mean);
    for (const xs of Object.values(best.cover)) {
      expect(xs.length).toBe(P.SOP_MONTHS);
      for (const c of xs) expect(P.SOP_COVERS as readonly number[]).toContain(c);
    }
  });

  test('копит впрок только в резерве: нагрузка ресурсов, кроме заданий, — не выше линии резерва или нагрузки плана по политике', () => {
    const r = P.reserveOf(db, before);
    expect(r).toEqual([3, 10]);
    best.result.months.forEach((row, i) => {
      for (const res of P.SOP_RES) if (res !== 'slot') expect(row.load[res]).toBeLessThanOrEqual(Math.max(P.reserveLine(row.cap[res], r), best.base.months[i].load[res]));
    });
  });
});

describe('совещание и правило задания', () => {
  test('без мест игрока лучший план утверждает коллега: запись журнала начальника отдела планирования', () => {
    const s = structuredClone(before);
    apply(db, s, { kind: 'advance', seconds: HOUR });
    const p = s.planning.sop!.plans[0];
    expect(s.planning.sop!.plans.length).toBe(1);
    expect(p).toMatchObject({ at: at(2027, 9, 3, 10), from: SEP, by: 'head:plan' });
    expect(p.value).toBe(p.best);
    expect(Object.keys(p.cover).sort()).toEqual([LOR, PARA]);
    // план, утверждённый в тот же миг, — лучший: его цель плана — та же, что у прогона заводом этого мига
    expect(P.sopEval(P.sopCtx(db, s, SEP), p.cover).mean).toBe(p.value);
    const rec = s.journal.filter(x => x.d.kind === 'sop');
    expect(rec.length).toBe(1);
    expect(rec[0].by).toBe('plan');
    expect(s.planning.sop!.open).toBeUndefined();
  });

  test('игрок на месте «Производство»: совещание открыто и ждёт, мир встаёт; «Утвердить» — план игрока; без совещания — отказ', () => {
    const s = structuredClone(before);
    apply(db, s, { kind: 'seat', seats: ['production'] });
    const n = apply(db, s, { kind: 'advance', seconds: HOUR });
    expect(sops(n)).toEqual([{ kind: 'sop', m: SEP, open: true }]);
    expect(s.planning.sop!.plans.length).toBe(0);
    expect(s.planning.sop!.open).toMatchObject({ at: at(2027, 9, 3, 10), from: SEP });
    // цели не из вариантов, без продукта или с чужим — отказ
    expect(refusals(apply(db, s, { kind: 'sop', cover: { ...flat(21), [PARA]: [21, 21, 21, 21, 21, 20] }, by: 'player' }))).toEqual(['badPlan']);
    expect(refusals(apply(db, s, { kind: 'sop', cover: { [PARA]: flat(21)[PARA] }, by: 'player' }))).toEqual(['badPlan']);
    expect(refusals(apply(db, s, { kind: 'sop', cover: { ...flat(21), 'prd.none': flat(21)[PARA] }, by: 'player' }))).toEqual(['badPlan']);
    const cover = { [PARA]: [28, 28, 35, 35, 28, 21], [LOR]: [21, 21, 21, 28, 28, 21] };
    expect(refusals(apply(db, s, { kind: 'sop', cover, by: 'player' }))).toEqual([]);
    expect(s.planning.sop!.plans.length).toBe(1);
    expect(s.planning.sop!.plans[0]).toMatchObject({ from: SEP, cover, by: 'player' });
    expect(s.planning.sop!.open).toBeUndefined();
    expect(refusals(apply(db, s, { kind: 'sop', cover, by: 'player' }))).toEqual(['noMeeting']);
    const rec = s.journal.filter(x => x.d.kind === 'sop');
    expect(rec.at(-1)!.by).toBe('player');
    expect(rec.at(-1)!.seat).toBe('production');
    expect(check(db, s)).toEqual([]);
  });

  test('утверждённый план — запас позиций правила: цель продукта на месяц дня задания, в причине — план S&OP', () => {
    const s = structuredClone(before);
    apply(db, s, { kind: 'seat', seats: ['production'] });
    apply(db, s, { kind: 'advance', seconds: HOUR });
    const cover = { [PARA]: [42, 42, 42, 42, 42, 42], [LOR]: [7, 7, 7, 7, 7, 7] };
    apply(db, s, { kind: 'sop', cover, by: 'player' });
    expect(sopCover(s, PARA, daysFromCivil({ y: 2027, m: 9, d: 20 }))).toBe(42);
    expect(sopCover(s, LOR, daysFromCivil({ y: 2028, m: 2, d: 29 }))).toBe(7);
    expect(sopCover(s, LOR, daysFromCivil({ y: 2028, m: 3, d: 1 }))).toBeUndefined();
    // отдел планирования — «сам»: начальник ставит задания по правилу с целями плана
    expect(refusals(apply(db, s, { kind: 'mode', head: 'plan', mode: 'auto', by: 'player' }))).toEqual([]);
    const n0 = Object.keys(s.batches).length;
    apply(db, s, { kind: 'advance', seconds: at(2027, 9, 10, 9) - s.t });
    const fresh = Object.values(s.batches).filter((_, i) => i >= n0);
    expect(fresh.length).toBeGreaterThan(0);
    const why = s.journal.filter(x => x.d.kind === 'order' && x.by === 'plan' && x.t > at(2027, 9, 3, 11)).map(x => (x.d as Extract<Decided, { kind: 'order' }>).why);
    expect(why.length).toBeGreaterThan(0);
    for (const w of why) {
      expect(w?.sop).toBe(true);
      expect([42, 7]).toContain(w!.cover!);
      expect(w?.policy).toBeUndefined();
    }
  });

  test('навык начальника ниже 4 сокращает и цель плана: в причине — «вместо» цели плана, а не политики', () => {
    const s = structuredClone(before);
    // навык 2 — половина горизонта (§8.5); у начальника и у заместителя, кто бы ни решал
    const plan = [HEAD_ROLE.plan, sc.heads?.plan?.deputy];
    for (const p of Object.values(s.people)) if (plan.includes(p.role)) p.skill = 2;
    apply(db, s, { kind: 'seat', seats: ['production'] });
    apply(db, s, { kind: 'advance', seconds: HOUR });
    apply(db, s, { kind: 'sop', cover: { [PARA]: Array(6).fill(42), [LOR]: Array(6).fill(28) }, by: 'player' });
    expect(refusals(apply(db, s, { kind: 'mode', head: 'plan', mode: 'auto', by: 'player' }))).toEqual([]);
    apply(db, s, { kind: 'advance', seconds: at(2027, 9, 10, 9) - s.t });
    const why = s.journal.filter(x => x.d.kind === 'order' && x.by === 'plan' && x.t > at(2027, 9, 3, 11)).map(x => (x.d as Extract<Decided, { kind: 'order' }>).why!);
    expect(why.length).toBeGreaterThan(0);
    for (const w of why) {
      expect(w.sop).toBe(true);
      expect([[21, 42], [14, 28]]).toContainEqual([w.cover!, w.policy!]);
    }
  });

  test('план, утверждённый в сентябре, держит месяцы до февраля; новое совещание — новый план', () => {
    const s = structuredClone(before);
    apply(db, s, { kind: 'advance', seconds: at(2027, 10, 5, 11) - s.t });
    expect(s.planning.sop!.plans.map(p => p.from)).toEqual([SEP, OCT]);
    expect(s.planning.sop!.held).toBe(OCT);
    expect(check(db, s)).toEqual([]);
  });
});

describe('касса на три месяца', () => {
  test('остаток — сейчас; строки складываются в конец месяца; наименьший остаток — не выше концов', () => {
    const ctx = P.sopCtx(db, before, SEP);
    const trace: P.SopTrace = { sold: new Map(), demand: new Map(), made: [] };
    const r = P.sopEval(ctx, flat(21), trace);
    const c = P.sopCash(ctx, r, trace);
    expect(c.months.map(m => m.m)).toEqual([SEP, SEP + 1, SEP + 2]);
    expect(c.months[0].start).toBe(before.cash.balance);
    for (const m of c.months) expect(m.end).toBe(m.start + P.SOP_CASH_ROWS.reduce((n, k) => n + m.flows[k], 0));
    for (let i = 1; i < 3; i++) expect(c.months[i].start).toBe(c.months[i - 1].end);
    expect(c.low.balance).toBeLessThanOrEqual(Math.min(before.cash.balance, ...c.months.map(m => m.end)));
    expect(c.limit).toBe(sc.credit.limit);
    // продажи и счета — приход, материалы, зарплата и энергия — расход
    expect(c.months.reduce((n, m) => n + m.flows.sales, 0)).toBeGreaterThan(0);
    expect(c.months.every(m => m.flows.wages < 0)).toBe(true);
    expect(c.months.slice(1).every(m => m.flows.energy < 0)).toBe(true);
    // счета со сроком — из календаря кассы, с этого мига до конца горизонта
    const dues = before.cash.dues.filter(d => d.due >= before.t && momentOf(before.start, d.due).day < firstDay(SEP + 3)).reduce((n, d) => n + d.sum, 0);
    expect(c.months.reduce((n, m) => n + m.flows.dues, 0)).toBe(dues);
  });
});

describe('ГП и срок годности', () => {
  test('без старой ГП — угрозы нет', () => {
    const ctx = P.sopCtx(db, before, SEP);
    const trace: P.SopTrace = { sold: new Map(), demand: new Map(), made: [] };
    P.sopEval(ctx, flat(21), trace);
    const risk = P.shelfRisk(ctx, trace);
    for (const xs of risk.values()) for (const n of xs) expect(n).toBeGreaterThanOrEqual(SEP);
  });
});

describe('сохранение', () => {
  test('образец схемы 41: плана S&OP нет — правило берёт политику; совещание — в свой день и ждёт места игрока', () => {
    const s: PlantState = fromSave(db, readFileSync(join(import.meta.dir, 'fixtures', 'save-v41.json'), 'utf8'));
    expect(s.planning.sop).toBeUndefined();
    expect(sopCover(s, PARA, momentOf(s.start, s.t).day)).toBeUndefined();
    // образец — 1 ноября 2027 года, места «Производство» и «Качество»: совещание 3 ноября открыто и ждёт «Утвердить»
    const n = apply(db, s, { kind: 'advance', seconds: at(2027, 11, 3, 11) - s.t });
    expect(sops(n)).toEqual([{ kind: 'sop', m: SEP + 2, open: true }]);
    expect(s.planning.sop!.plans).toEqual([]);
    expect(s.planning.sop!.open!.from).toBe(SEP + 2);
    expect(check(db, s)).toEqual([]);
  });
});

describe('сборщик базы', () => {
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
  const SHARES = 'shares: [[1, 10], [1, 5], [3, 10], [2, 5], [1, 2]]';

  test('резерв мощности — доля от 0 до половины; у сценария — вариант политики', () => {
    expect(broken({})).toEqual([]);
    const over = broken({ 'policies/plan/reserve.yaml': [[SHARES, 'shares: [[1, 10], [1, 5], [3, 10], [2, 5], [3, 5]]']] });
    expect(over.some(e => e.includes('pol.plan.reserve: доля 3/5 — больше половины мощности'))).toBe(true);
    const off = broken({ 'scenarios/proto.yaml': [['reserve: [3, 10]', 'reserve: [1, 4]']] });
    expect(off.some(e => e.includes('pol.plan.reserve = [1,4] — вне пределов политики'))).toBe(true);
  });
});

describe('срок серий в вариантах', () => {
  test('10-й процентиль, медиана и 90-й выпущенных за 180 суток; выпущенных нет — срок по умолчанию; у плюса выпуск позже', () => {
    expect(P.leadOf(s0, PARA)).toEqual([10 * DAY, 10 * DAY, 10 * DAY]);
    const s = structuredClone(before);
    apply(db, s, { kind: 'advance', seconds: at(2027, 11, 1) - s.t });
    const xs = Object.values(s.batches)
      .filter(b => b.product === PARA && b.released !== undefined && b.records.length > 0)
      .map(b => b.released! - b.records[0].start)
      .sort((a, b) => a - b);
    expect(xs.length).toBeGreaterThan(10);
    const [lo, mid, hi] = P.leadOf(s, PARA);
    expect([lo, mid, hi]).toEqual([xs[Math.floor((xs.length - 1) / 10)], xs[Math.floor(xs.length / 2)], xs[Math.floor(((xs.length - 1) * 9) / 10)]]);
    expect(lo).toBeLessThanOrEqual(mid);
    expect(mid).toBeLessThanOrEqual(hi);
    // плюс-вариант: спрос выше и выпуск медленнее — не продано не меньше, чем у прогноза
    const ctx = P.sopCtx(db, s, monthNo(2027, 11));
    const runs = P.SOP_CASES.map(k => P.sopRun(ctx, flat(21), k));
    expect(runs[2].short).toBeGreaterThanOrEqual(runs[1].short);
    expect(runs[1].short).toBeGreaterThanOrEqual(runs[0].short);
  });
});
