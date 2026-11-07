// Политики руководителей (Б5г; docs/specs/2026-10-vertical-slice.md, «Б5г», «Проверки Б5г»): по умолчанию — числа и
// правила сценария; команда `policy` — с поста отдела или директором, в пределах и на шаге, с записью журнала, историей и
// устаревшими предложениями; правило читает политику с ближайшего часа; «Перенести визит»; сохранение; вид окна; прогон.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { recOf } from '../../src/engine/assets';
import { DAY, HOUR, isWorkday, MIN, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { partType } from '../../src/engine/maint';
import { BATCH_HOUR } from '../../src/engine/mes';
import { runPlan, runSeed } from '../../src/engine/plan/run';
import { AHEAD, aheadMilli, ORDER_KEY } from '../../src/engine/planner';
import { eachOf, OFF, POL, policyDefault, policyErrors, policyOf } from '../../src/engine/policies';
import { fromSave, toSave } from '../../src/engine/save';
import { SUPPLY_HOUR } from '../../src/engine/supply';
import type { Command, Notice, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { HIST, kpiView } from '../../src/sim/kpi';
import { policiesView } from '../../src/sim/policies';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const fresh = (): PlantState => newPlant(db, { scenario: SC });
const refusals = (n: Notice[]) => n.flatMap(x => (x.kind === 'refused' ? [[x.why, x.detail]] : []));
const until = (s: PlantState, t: number) => apply(db, s, { kind: 'advance', seconds: t - s.t });
const policy = (s: PlantState, p: string, value: Extract<Command, { kind: 'policy' }>['value'], of?: string, by?: string) => apply(db, s, { kind: 'policy', policy: p, ...(of ? { of } : {}), value, ...(by ? { by } : {}) });
/** Ближайшее мгновение `sec` рабочего дня после нынешнего. */
function nextWork(s: PlantState, sec: number): number {
  const cal = calOf(db, s);
  let t = Math.floor(s.t / DAY) * DAY + sec;
  if (t <= s.t) t += DAY;
  while (!isWorkday(cal, momentOf(s.start, t).day)) t += DAY;
  return t;
}
const PUNCHES = 'press-1/punches';
const SEAL = 'blister-1/sealplate';

describe('по умолчанию', () => {
  test('политики завода — числа и правила сценария; у каждой политики движка — запись базы, ошибок нет', () => {
    const s = fresh();
    expect(Object.keys(db.policies).sort()).toEqual(Object.values(POL).sort());
    expect(policyErrors(db)).toEqual([]);
    for (const p of Object.values(db.policies)) for (const of of p.each ? eachOf(db, s, p) : [undefined]) expect(policyOf(db, s, p.id, of)).toEqual(policyDefault(db, sc, p.id, of)!);
    expect(policyOf(db, s, POL.cover)).toBe(sc.plan!.cover);
    expect(policyOf(db, s, POL.window)).toBe(sc.plan!.window);
    expect(policyOf(db, s, POL.urgent)).toBe(sc.plan!.urgent ?? OFF);
    expect(policyOf(db, s, POL.safety)).toBe(sc.supply!.safety);
    expect(policyOf(db, s, POL.every)).toBe(sc.supply!.every);
    expect(policyOf(db, s, POL.replace, PUNCHES)).toBe(sc.maint[PUNCHES]);
    expect(policyOf(db, s, POL.replace, SEAL)).toBe(OFF);
    expect(policyOf(db, s, POL.spare, 'spare.punches')).toEqual([db.spares['spare.punches'].stock.min, db.spares['spare.punches'].stock.max]);
    expect(policyOf(db, s, POL.ahead)).toBe(sc.assets.ahead);
    expect(policyOf(db, s, POL.clean)).toBe('minor');
    expect(policyOf(db, s, POL.full)).toEqual(sc.waste!.full);
    expect(policyOf(db, s, POL.keep)).toBe(sc.waste!.keep);
    expect(policyOf(db, s, POL.setpoints)).toBe('target');
    // износ — в долях 1/10 000, как порог сценария
    expect(db.policies[POL.replace]).toMatchObject({ min: 5000, max: 10_000, step: 1000, off: true, each: 'part' });
    expect(s.policies).toEqual({ v: {}, log: [] });
  });

  test('ошибки базы: число сценария вне политики или не на шаге, руководитель не по номеру, записи нет, лишняя запись', () => {
    const bad: ContentDb = structuredClone(db);
    bad.scenarios[SC].plan!.cover = 30;
    bad.policies[POL.window] = { ...bad.policies[POL.window], head: 'supply' };
    delete bad.policies[POL.keep];
    bad.policies['pol.plan.extra'] = { ...bad.policies[POL.cover], id: 'pol.plan.extra' };
    const out = policyErrors(bad);
    expect(out.some(x => x.includes(POL.window) && x.includes('supply'))).toBe(true);
    expect(out.some(x => x.includes(POL.keep))).toBe(true);
    expect(out.some(x => x.includes('pol.plan.extra'))).toBe(true);
    // запись цела — проверяют числа сценария
    const off: ContentDb = structuredClone(db);
    off.scenarios[SC].plan!.cover = 30;
    expect(policyErrors(off)).toEqual([`сценарий ${SC}: ${POL.cover} = 30 — вне пределов политики`]);
  });
});

describe('команда `policy`', () => {
  test('пост отдела: новое значение, история с местом, запись журнала «вы» с прежним, извещение; чужой пост — отказ', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    expect(policy(s, POL.cover, 28, undefined, 'player')).toEqual([{ kind: 'policy', policy: POL.cover, head: 'plan' }]);
    expect(policyOf(db, s, POL.cover)).toBe(28);
    expect(s.policies.log).toEqual([{ policy: POL.cover, t: s.t, seat: 'production', from: 21, to: 28 }]);
    expect(s.journal.at(-1)).toMatchObject({ t: s.t, by: 'player', seat: 'production', d: { kind: 'policy', policy: POL.cover, from: 21, to: 28 } });
    // снабжение — пост «Снабжение и склад»; технология — «Качество и технология»
    expect(refusals(policy(s, POL.safety, 14, undefined, 'player'))).toEqual([['notYours', 'supply']]);
    expect(refusals(policy(s, POL.setpoints, 'keep', undefined, 'player'))).toEqual([['notYours', 'quality']]);
    // директор — всё
    apply(db, s, { kind: 'seat', seats: ['director'] });
    expect(refusals(policy(s, POL.safety, 14, undefined, 'player'))).toEqual([]);
    expect(s.journal.at(-1)).toMatchObject({ by: 'player', seat: 'director', d: { kind: 'policy', policy: POL.safety, from: 7, to: 14 } });
    expect(check(db, s)).toEqual([]);
  });

  test('пределы, шаг, «без» и варианты; у политики «у каждого» — своя вещь; то же, что сейчас, — отказ', () => {
    const s = fresh();
    const no = (p: string, v: Extract<Command, { kind: 'policy' }>['value'], of?: string) => refusals(policy(s, p, v, of))[0]?.[0];
    expect(no(POL.cover, 30)).toBe('policyRange');
    expect(no(POL.cover, 49)).toBe('policyRange');
    expect(no(POL.cover, 0)).toBe('policyRange');
    expect(no(POL.cover, OFF)).toBe('policyRange');
    expect(no(POL.cover, 21)).toBe('policySame');
    expect(no('pol.plan.none', 21)).toBe('noPolicy');
    expect(no(POL.urgent, OFF)).toBeUndefined();
    expect(policyOf(db, s, POL.urgent)).toBe(OFF);
    expect(no(POL.replace, 9000)).toBe('noPolicy');
    expect(no(POL.replace, 9000, 'press-9/punches')).toBe('noPolicy');
    expect(no(POL.replace, 9500, PUNCHES)).toBe('policyRange');
    expect(no(POL.replace, 9000, PUNCHES)).toBeUndefined();
    expect(no(POL.replace, OFF, SEAL)).toBe('policySame');
    expect(no(POL.spare, [2, 1], 'spare.punches')).toBe('policyRange');
    expect(no(POL.spare, [0, 5], 'spare.punches')).toBe('policyRange');
    expect(no(POL.spare, [0, 1], 'spare.punches')).toBeUndefined();
    expect(no(POL.clean, 'x')).toBe('policyRange');
    expect(no(POL.clean, 'major')).toBeUndefined();
    expect(no(POL.full, [1, 4])).toBe('policyRange');
    expect(no(POL.full, [1, 3])).toBeUndefined();
    expect(no(POL.keep, 11)).toBe('policyRange');
    expect(s.policies.v).toEqual({ [POL.urgent]: OFF, [`${POL.replace}:${PUNCHES}`]: 9000, [`${POL.spare}:spare.punches`]: [0, 1], [POL.clean]: 'major', [POL.full]: [1, 3] });
  });

  test('открытые предложения руководителя устаревают: он посчитает заново в свой час', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    // первый рабочий день, когда начальник отдела планирования предложил задание на серию
    for (let i = 0; i < 10 && s.heads.open[ORDER_KEY] === undefined; i++) until(s, nextWork(s, BATCH_HOUR) + MIN);
    const n = s.heads.open[ORDER_KEY];
    expect(n).toBeDefined();
    policy(s, POL.window, 35, undefined, 'player');
    expect(s.heads.open[ORDER_KEY]).toBeUndefined();
    expect(s.journal.find(r => r.n === n)?.ask?.end).toEqual({ how: 'stale', t: s.t });
  });
});

describe('правило читает политику с ближайшего часа', () => {
  test('задание на серию — с запасом и окном политики; заказ поставщику — со страховым запасом и сроком политики', () => {
    const s = fresh();
    policy(s, POL.cover, 35);
    policy(s, POL.safety, 14);
    policy(s, POL.every, 42);
    const t0 = s.t;
    until(s, t0 + 21 * DAY);
    const orders = s.journal.filter(r => r.t > t0 && r.by === 'plan' && r.d.kind === 'order');
    const pos = s.journal.filter(r => r.t > t0 && r.by === 'supply' && r.d.kind === 'po');
    expect(orders.length).toBeGreaterThan(0);
    expect(pos.length).toBeGreaterThan(0);
    // до первого совещания S&OP (Б6г) — запас позиций политики; после — цель утверждённого плана, и причина это называет
    const before = orders.filter(r => r.d.kind === 'order' && !r.d.why?.sop);
    expect(before.length).toBeGreaterThan(0);
    for (const r of before) if (r.d.kind === 'order') expect(r.d.why).toMatchObject({ cover: 35, ahead: aheadMilli(AHEAD + 35) });
    for (const r of orders) if (r.d.kind === 'order' && r.d.why?.sop) expect(r.t).toBeGreaterThan(s.planning.sop!.plans[0].at);
    for (const r of pos) if (r.d.kind === 'po') for (const w of r.d.why ?? []) expect(w).toMatchObject({ safety: 14, every: 42 });
    expect(check(db, s)).toEqual([]);
  });

  test('замена узла: по наработке при пороге политики или после отказа; ЗИП — по уровню политики', () => {
    const replaced = (p: Extract<Command, { kind: 'policy' }>['value'] | undefined) => {
      const s = fresh();
      if (p !== undefined) policy(s, POL.replace, p, PUNCHES);
      const pt = s.parts[PUNCHES];
      // пуансоны — на 95 % ресурса: при пороге 90 % — замена, при 100 % и после отказа — нет
      pt.done = Math.floor((partType(db, pt).life * 95) / 100);
      until(s, s.t + 2 * HOUR);
      return s.journal.filter(r => r.d.kind === 'replace' && r.d.part === PUNCHES).map(r => r.d);
    };
    expect(replaced(undefined)).toEqual([]);
    expect(replaced(OFF)).toEqual([]);
    expect(replaced(9000)).toEqual([expect.objectContaining({ why: expect.objectContaining({ at: 9000 }) })]);
    // замена берёт запчасть: свободно 1 при уровне сценария «1 до 2» — заказ одной; при «0 до 1» — не заказывают
    const spare = (lvl?: [number, number]) => {
      const x = fresh();
      if (lvl) policy(x, POL.spare, lvl, 'spare.punches');
      policy(x, POL.replace, 9000, PUNCHES);
      x.parts[PUNCHES].done = partType(db, x.parts[PUNCHES]).life;
      until(x, x.t + 3 * DAY);
      return x.journal.filter(r => r.d.kind === 'spare' && r.d.spare === 'spare.punches').map(r => r.d);
    };
    expect(spare()).toEqual([expect.objectContaining({ qty: 1, why: { level: 1, min: 1, max: 2 } })]);
    expect(spare([0, 1])).toEqual([]);
  });

  test('визит подрядчика — за срок предупреждения политики', () => {
    // ближайшая запись актива на старте кончается через 41 сутки: за 15 суток при сроке 14 визита нет, при 30 — есть
    const booked = (ahead?: number) => {
      const s = fresh();
      if (ahead !== undefined) policy(s, POL.ahead, ahead);
      until(s, s.t + 15 * DAY);
      return s.journal.filter(r => r.d.kind === 'visit').map(r => (r.d.kind === 'visit' ? r.d : undefined)!);
    };
    expect(booked()).toEqual([]);
    const far = booked(30);
    expect(far.length).toBeGreaterThan(0);
    for (const d of far) expect(d.why?.ahead).toBe(30);
  });

  test('уборка после серии: «генеральная сразу, если следом другой продукт» — генеральных больше, малых меньше', () => {
    const cleans = (rule?: string) => {
      const s = fresh();
      if (rule) policy(s, POL.clean, rule);
      until(s, s.t + 45 * DAY);
      expect(check(db, s)).toEqual([]);
      return { major: s.losses.reduce((n, d) => n + d.cleans.major, 0), minor: s.losses.reduce((n, d) => n + d.cleans.minor, 0) };
    };
    const base = cleans();
    const major = cleans('major');
    expect(major.major).toBeGreaterThan(base.major);
    expect(major.minor).toBeLessThan(base.minor);
  }, 120_000);
});

describe('«Перенести визит»', () => {
  test('рабочий день с завтра по последний день записи в силе; запись журнала «вы»; идущий визит — отказ', () => {
    const s = fresh();
    policy(s, POL.ahead, 30);
    // первый визит, назначенный за 30 суток до конца записи
    for (let i = 0; i < 20 && !Object.values(s.assets).some(a => a.visit); i++) until(s, nextWork(s, SUPPLY_HOUR) + MIN);
    const today = momentOf(s.start, s.t).day;
    const cal = calOf(db, s);
    // визит с записью в силе и рабочим днём до её конца после завтрашнего
    const a = Object.values(s.assets).find(x => {
      const r = x.visit ? recOf(x, x.visit.work) : undefined;
      return x.visit && x.visit.from === undefined && r && r.until > today + 3;
    })!;
    expect(a).toBeDefined();
    const rec = recOf(a, a.visit!.work)!;
    const at0 = a.visit!.at;
    let day = rec.until;
    while (!isWorkday(cal, day)) day--;
    const off = Array.from({ length: 10 }, (_, i) => today + 1 + i).find(z => !isWorkday(cal, z))!;
    const move = (asset: string, d: number, by = 'player') => apply(db, s, { kind: 'visit', asset, day: d, by });
    expect(refusals(move('A999', day))).toEqual([['noVisit', 'A999']]);
    expect(refusals(move(a.id, today))).toEqual([['visitDay', a.id]]);
    expect(refusals(move(a.id, off))).toEqual([['visitDay', a.id]]);
    expect(refusals(move(a.id, rec.until + 1))).toEqual([['visitDay', a.id]]);
    const out = move(a.id, day);
    const at = (day - momentOf(s.start, 0).day) * DAY + sc.assets.hours[0];
    expect(out).toEqual([{ kind: 'visitMoved', asset: a.id, family: a.family, type: a.type, inv: a.inv, work: a.visit!.work, at }]);
    expect(s.assets[a.id].visit?.at).toBe(at);
    expect(s.journal.at(-1)).toMatchObject({ by: 'player', d: { kind: 'visit', asset: a.id, work: a.visit!.work, at, from: at0 } });
    expect(refusals(move(a.id, day))).toEqual([['visitSame', a.id]]);
    // с поста не техслужбы — отказ с местом
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    expect(refusals(move(a.id, day - 1))).toEqual([['notYours', 'production']]);
    // визит, который уже идёт, не переносят
    apply(db, s, { kind: 'seat', seats: ['director'] });
    until(s, at + 4 * HOUR);
    if (s.assets[a.id].visit?.from !== undefined) expect(refusals(move(a.id, day + 1))).toEqual([['noVisit', a.id]]);
    expect(check(db, s)).toEqual([]);
  });
});

describe('сохранение', () => {
  test('политики и история — в сохранении; образец схемы 34 — политик нет, все с записи сценария', async () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    policy(s, POL.cover, 28, undefined, 'player');
    const back = fromSave(db, toSave(s));
    expect(back.policies).toEqual(s.policies);
    const old = fromSave(db, await Bun.file(new URL('./fixtures/save-v34.json', import.meta.url)).text());
    expect(old.policies).toEqual({ v: {}, log: [] });
    expect(policyOf(db, old, POL.cover)).toBe(sc.plan!.cover);
    expect(check(db, old)).toEqual([]);
    until(old, old.t + DAY);
    expect(check(db, old)).toEqual([]);
  });

  test('образец схемы 35 читается и живёт дальше', async () => {
    const s = fromSave(db, await Bun.file(new URL('./fixtures/save-v35.json', import.meta.url)).text());
    expect(s.policies.log.length).toBeGreaterThan(0);
    until(s, s.t + DAY);
    expect(check(db, s)).toEqual([]);
  });
});

describe('вид «Политики»', () => {
  test('вкладки — сначала руководители взятого поста; строки с вещью, кто задал, решения за 30 суток; сверхурочные', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    until(s, s.t + 10 * DAY);
    policy(s, POL.setpoints, 'keep', undefined, 'player');
    const v = policiesView(db, s);
    expect(v.tabs.map(t => t.head)).toEqual(['tech', 'qc', 'qa', 'plan', 'supply', 'maint', 'mes', 'wms']);
    const tab = (h: string) => v.tabs.find(t => t.head === h)!;
    expect(tab('plan').rows.map(r => r.policy)).toEqual([POL.cover, POL.demand, POL.frozen, POL.method, POL.reserve, POL.urgent, POL.window]);
    expect(tab('maint').rows.filter(r => r.policy === POL.replace).map(r => r.of)).toEqual(Object.keys(s.parts).sort());
    expect(tab('maint').rows.find(r => r.of === PUNCHES)).toMatchObject({ machine: s.parts[PUNCHES].of, part: s.parts[PUNCHES].type, value: sc.maint[PUNCHES] });
    expect(tab('tech').rows).toEqual([{ policy: POL.setpoints, value: 'keep', set: { t: s.t, seat: 'quality' }, used: 0 }]);
    expect(tab('wms').rows.find(r => r.policy === POL.full)).toMatchObject({ value: sc.waste!.full });
    expect(tab('wms').rows.find(r => r.policy === POL.full)?.set).toBeUndefined();
    expect(tab('wms').overtime).toEqual([{ dept: 'wms', mode: 'need' }]);
    expect(tab('mes').overtime.map(o => o.dept)).toEqual(['mes', 'line']);
    expect(tab('mes').rows.find(r => r.policy === POL.clean)?.used).toBeUndefined();
    // решения за 30 суток: задания на серию и заказы поставщикам читали свои политики
    expect(tab('plan').rows.find(r => r.policy === POL.cover)?.used).toBe(s.journal.filter(r => r.by === 'plan' && r.d.kind === 'order' && r.d.why?.rule !== 'turn').length);
    expect(tab('supply').rows.find(r => r.policy === POL.safety)?.used).toBe(s.journal.filter(r => r.by === 'supply' && r.d.kind === 'po').length);
    // без истины: ни запаса узлов до отказа, ни истинных свойств
    const json = JSON.stringify(v);
    for (const k of ['budget', 'truth', 'true']) expect(json.includes(`"${k}"`)).toBe(false);
  }, 60_000);
});

describe('показатели (K)', () => {
  test('смена политики — у её руководителя: в закрытом месяце — у его столбика и дня, в нынешнем — у месяца окна', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    until(s, s.t + 10 * DAY);
    policy(s, POL.cover, 28, undefined, 'player');
    const t1 = s.t;
    while (s.kpi.months.length < 1) until(s, s.t + DAY);
    until(s, s.t + 3 * DAY);
    policy(s, POL.window, db.policies[POL.window].min!, undefined, 'player');
    const t2 = s.t;
    apply(db, s, { kind: 'seat', seats: ['director'] });
    policy(s, POL.safety, 14, undefined, 'player');
    const v = kpiView(db, s, { view: 'kpi', tab: 'production' });
    const plan = v.rows.find(r => r.head === 'plan')!;
    const m0 = s.kpi.months[0];
    // закрытый месяц — последний из 12 столбиков; день смены — тысячные доли месяца
    expect(plan.marks?.map(m => [m.bar, m.policy, m.t, m.from, m.to])).toEqual([
      [HIST - 1, POL.cover, t1, 21, 28],
      [HIST, POL.window, t2, sc.plan!.window, db.policies[POL.window].min!],
    ]);
    expect(plan.marks![0].at).toBe(Math.floor(((t1 - m0.from) * 1000) / (m0.to - m0.from)));
    expect(plan.marks![0].at).toBeGreaterThan(0);
    // снабжение — у своего руководителя, на вкладке своего поста
    expect(v.rows.find(r => r.head === 'mes')?.marks).toBeUndefined();
    const sup = kpiView(db, s, { view: 'kpi', tab: 'supply' }).rows.find(r => r.head === 'supply')!;
    expect(sup.marks?.map(m => [m.bar, m.policy])).toEqual([[HIST, POL.safety]]);
    // закрытый месяц в окне: его смены — на его столбике, смен после него нет
    const closed = kpiView(db, s, { view: 'kpi', tab: 'production', month: m0.from }).rows.find(r => r.head === 'plan')!;
    expect(closed.marks?.map(m => [m.bar, m.policy])).toEqual([[HIST - 1, POL.cover]]);
    // узел — с видом машины и узла
    policy(s, POL.replace, OFF, PUNCHES, 'player');
    const maint = kpiView(db, s, { view: 'kpi', tab: 'production' }).rows.find(r => r.head === 'maint')!;
    expect(maint.marks?.at(-1)).toMatchObject({ bar: HIST, policy: POL.replace, of: PUNCHES, machine: s.parts[PUNCHES].of, part: s.parts[PUNCHES].type, to: OFF });
  }, 120_000);
});

describe('прогон плана', () => {
  test('черновик — команды варианта в первую минуту копии; ход — после каждого зерна; «как сейчас» — тот же итог', () => {
    const s = fresh();
    until(s, s.t + 5 * DAY);
    const c = runSeed(db, s, [{ kind: 'policy', policy: POL.cover, value: 35 }], { days: 1, seeds: 1 }, 0);
    expect(policyOf(db, c, POL.cover)).toBe(35);
    expect(policyOf(db, s, POL.cover)).toBe(21);
    const seeds: number[] = [];
    const a = runPlan(db, s, [], { days: 2, seeds: 2 }, k => seeds.push(k));
    expect(seeds).toEqual([0, 1]);
    expect(runPlan(db, s, [], { days: 2, seeds: 2 })).toEqual(a);
    for (const o of a) expect(o).toMatchObject({ fg: expect.any(Number), stock: expect.any(Number), ot: expect.any(Number), released: expect.any(Number) });
  }, 60_000);
});
