// Б5а: журнал решений (src/engine/journal.ts; docs/specs/2026-10-vertical-slice.md, «Б5а»). У каждого решения коллеги —
// запись руководителя с причиной, и числа причины — те же, что у правила: у задания на серию — положение позиций и порог,
// у заказа — положение, точка заказа и количество до целой тары, у оценки — связанные испытания, у шага — прирост знания
// и часы, у визита и пары — сроки записей, у решений ОКК и уполномоченного лица — испытания и отклонения. Решение игрока —
// запись «вы» с местом; запись старше срока уходит в полночь; в журнале нет полей истины; прежнее сохранение — журнал
// пуст; копия прогона плана — без журнала.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { recOf } from '../../src/engine/assets';
import { DAY, HOUR, isWorkday, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { KEEP, note } from '../../src/engine/journal';
import { BATCH_HOUR } from '../../src/engine/mes';
import { runSeed } from '../../src/engine/plan/run';
import { AHEAD, aheadMilli, planHour, positionOf } from '../../src/engine/planner';
import { planOf } from '../../src/engine/plant';
import { fromSave } from '../../src/engine/save';
import { containersFor } from '../../src/engine/stock';
import { planUse, SUPPLY_HOUR, supplyDay, supplyPosition } from '../../src/engine/supply';
import type { Decided, Decision, Notice, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const of = <K extends Decided['kind']>(s: PlantState, kind: K) => s.journal.filter((r): r is Decision & { d: Extract<Decided, { kind: K }> } => r.d.kind === kind);

/** Дожить до мгновения `sec` суток `day` от начала партии, не трогая события этого мгновения. */
function before(s: PlantState, day: number, sec: number) {
  const t = Math.floor(s.t / DAY) * DAY + day * DAY + sec;
  apply(db, s, { kind: 'advance', seconds: t - 1 - s.t });
  // мгновение правила: часовые события ещё не прожиты — правило зовём само
  s.t = t;
}

/** Ближайший рабочий день не раньше `day` суток от начала. */
function workday(s: PlantState, day: number): number {
  const cal = calOf(db, s);
  const d0 = momentOf(s.start, s.t).day;
  let d = day;
  while (!isWorkday(cal, d0 + d)) d++;
  return d;
}

/** Завод сценария на 90 суток — как золотой прогон: у него есть почти каждый вид решения руководителя. */
const s90: PlantState = newPlant(db, { scenario: SC });
apply(db, s90, { kind: 'advance', seconds: 90 * DAY });

describe('причина — числа правила', () => {
  test('задание на серию: положение всех позиций плана, порог и правило — как их видит коллега планирования', () => {
    const s = newPlant(db, { scenario: SC });
    const plan = sc.plan!;
    // спрос виден с `SEEN` суток: рабочий день после второй недели
    before(s, workday(s, 15), BATCH_HOUR);
    const pos = plan.items.map(it => positionOf(db, s, it.sku, plan.window));
    const n = s.journal.length;
    const out: Notice[] = [];
    planHour(db, s, out);
    const added = s.journal.slice(n);
    expect(added).toHaveLength(1);
    const r = added[0];
    expect(r.by).toBe('plan');
    expect(r.t).toBe(s.t);
    const d = r.d;
    if (d.kind !== 'order') throw new Error('not an order');
    const w = d.why!;
    expect(w.items).toEqual(pos.map(p => ({ sku: p.sku, cases: p.cases, ordered: p.ordered, work: p.work })));
    expect(w.ahead).toBe(aheadMilli(AHEAD + plan.cover));
    expect(['need', 'campaign', 'urgent']).toContain(w.rule);
    if (plan.urgent !== undefined) expect(w.soon).toBe(aheadMilli(AHEAD + plan.urgent));
    // позиция задания — ниже порога: запас × рабочих дней окна < заказано × порог
    const me = w.items.find(x => x.sku === d.sku)!;
    expect(me.cases * me.work * 1000).toBeLessThan(me.ordered * w.ahead);
    expect(s.batches[d.batch].notBefore).toBe(d.notBefore);
  });

  test('пока спроса не видно — по очереди: правило и срок окна спроса', () => {
    const s = newPlant(db, { scenario: SC });
    before(s, workday(s, 1), BATCH_HOUR);
    planHour(db, s, []);
    const r = of(s, 'order').at(-1)!;
    expect(r.d.why?.rule).toBe('turn');
    expect(r.d.why?.seen).toBe(7);
  });

  test('заказ поставщику: по строке — есть и в пути, расход, точка заказа, сколько хотели; в заказе — до целой тары', () => {
    const s = newPlant(db, { scenario: SC });
    before(s, workday(s, 1), SUPPLY_HOUR);
    const per = planUse(db, s, 1000);
    const have = new Map([...per.keys()].map(m => [m, supplyPosition(db, s, m)]));
    const n = s.journal.length;
    supplyDay(db, s, []);
    const added = s.journal.slice(n);
    expect(added.length).toBeGreaterThan(0);
    const { safety, every, qc } = sc.supply!;
    for (const r of added) {
      expect(r.by).toBe('supply');
      if (r.d.kind !== 'po') throw new Error('not a po');
      const po = s.pos[r.d.po];
      expect(r.d.prepaid).toBe(po.prepaid!);
      expect(r.d.why!.map(w => w.material)).toEqual(po.lines.map(l => l.material));
      for (const w of r.d.why!) {
        const sup = db.suppliers[po.supplier];
        const use = (d: number) => Math.ceil((per.get(w.material)! * d) / 1000);
        expect(w.have).toBe(have.get(w.material)!);
        expect(w.per).toBe(per.get(w.material)!);
        expect([w.lead, w.qc, w.safety, w.every]).toEqual([sup.lead[1], qc, safety, every]);
        expect(w.point).toBe(use(w.lead + qc + safety));
        expect(w.have).toBeLessThan(w.point);
        expect(w.want).toBe(Math.max(w.moq, w.point + use(every) - w.have));
        const line = po.lines.find(l => l.material === w.material)!;
        const cap = db.containers[db.materials[w.material].container].capacity;
        // до целой тары — из того, что хотели, или из урезанного до половины карантина
        if (!w.cut) expect(line.qty).toBe(containersFor(db, w.material, w.want) * cap);
        else expect(line.qty).toBeLessThan(containersFor(db, w.material, w.want) * cap);
      }
    }
  });

  test('решение по партии: испытания пробы — результаты, пределы и в пределах ли; вердикт — по ним', () => {
    const lots = of(s90, 'lot');
    expect(lots.length).toBeGreaterThan(10);
    for (const r of lots) {
      expect(r.by).toBe('qc');
      const sm = s90.samples[s90.lots[r.d.lot].sample!];
      expect(r.d.why.tests).toEqual(
        sm.tests.map(id => {
          const q = s90.tests[id];
          return { test: q.method, ...(q.result !== undefined ? { result: q.result } : {}), ...(q.min !== undefined ? { min: q.min } : {}), ...(q.max !== undefined ? { max: q.max } : {}), pass: !!q.pass };
        }),
      );
      const all = r.d.why.tests.every(x => x.pass);
      expect(r.d.verdict === 'release').toBe(all);
      if (r.d.verdict === 'investigate') expect(s90.investigations[r.d.inv!].lot).toBe(r.d.lot);
    }
  });

  test('решение по серии: проверка ГП, а неоценённых отклонений нет — выпуск', () => {
    const rs = of(s90, 'batch');
    expect(rs.length).toBeGreaterThan(10);
    for (const r of rs) {
      expect(r.by).toBe('qp');
      expect(r.d.decision === 'release').toBe(r.d.why?.rule === 'clear');
      if (r.d.why?.rule === 'clear') expect(s90.batches[r.d.batch].released).toBe(r.t);
    }
  });

  test('шаги и вывод расследования: начальник ООК — правило, прирост и часы шага, версия впереди', () => {
    const steps = of(s90, 'step');
    expect(steps.length).toBeGreaterThan(0);
    for (const r of steps) {
      expect(r.by).toBe('qa');
      const inv = s90.investigations[r.d.inv];
      const m = db.investigations[inv.model];
      const st = m.steps.find(x => x.id === r.d.step)!;
      const w = r.d.why!;
      expect(m.candidates.map(c => c.id)).toContain(w.top);
      expect(w.p).toBeGreaterThanOrEqual(0);
      expect(w.p).toBeLessThanOrEqual(10000);
      if (w.rule === 'gain') {
        // часы шага — работа роли или испытание, не меньше четверти часа
        const sec = st.test ? db.tests[st.test].prep + db.tests[st.test].run : (st.work ?? 0);
        expect(w.min).toBe(Math.round(Math.max(0.25, sec / 3600) * 60));
        expect(w.gain!).toBeGreaterThanOrEqual(Math.round(m.minGain * 1000) - 1);
      }
      // шаг записан в тот же миг, что начат
      expect(inv.runs.find(x => x.step === r.d.step)!.from).toBe(r.t);
    }
    const c = of(s90, 'conclude');
    expect(c).toHaveLength(1);
    const inv = s90.investigations[c[0].d.inv];
    expect(c[0].by).toBe('qa');
    expect(inv.conclusion).toMatchObject({ cause: c[0].d.cause, fate: c[0].d.fate, t: c[0].t });
    expect(c[0].d.why!.threshold).toBe(db.investigations[inv.model].threshold);
  });

  test('визит подрядчика: запись кончится в срок предупреждения; день визита', () => {
    const visits = of(s90, 'visit');
    expect(visits.length).toBeGreaterThan(0);
    for (const r of visits) {
      expect(r.by).toBe('maint');
      const day = momentOf(s90.start, r.t).day;
      expect(r.d.why.ahead).toBe(sc.assets.ahead);
      if (r.d.why.until !== undefined) expect(r.d.why.until - day).toBeLessThanOrEqual(sc.assets.ahead);
      // визит ещё впереди или идёт — или его запись уже принята, не раньше дня решения
      const a = s90.assets[r.d.asset];
      expect(a.visit?.work === r.d.work || a.recs.some(x => x.work === r.d.work && x.day >= day)).toBe(true);
      expect(recOf(a, r.d.work)).toBeDefined();
    }
  });

  test('оценка влияния, ЗИП, замена по наработке, оценка пары, вакансия и приём — у каждого свой руководитель и причина', () => {
    const by = (kind: Decided['kind']) => [...new Set(s90.journal.filter(r => r.d.kind === kind).map(r => r.by))];
    expect(by('assess')).toEqual(['qa']);
    expect(by('spare')).toEqual(['maint']);
    expect(by('replace')).toEqual(['maint']);
    expect(by('pairEval')).toEqual(['qa']);
    expect(by('vacancy')).toEqual(['mes']);
    expect(by('hire')).toEqual(['mes']);
    for (const r of of(s90, 'assess')) {
      const d = s90.deviations[r.d.dev];
      expect(d.assess?.verdict).toBe(r.d.verdict);
      expect(r.d.verdict === 'reject').toBe(r.d.why!.tests.some(x => (x.out ?? 0) > 0));
    }
    for (const r of of(s90, 'spare')) {
      expect(r.d.why.level).toBeLessThanOrEqual(r.d.why.min);
      expect(r.d.qty).toBe(r.d.why.max - r.d.why.level);
      expect(s90.spareOrders[r.d.order].qty).toBe(r.d.qty);
    }
    for (const r of of(s90, 'replace')) expect(r.d.why!.wear).toBeGreaterThanOrEqual(r.d.why!.at);
    for (const r of of(s90, 'hire')) {
      const w = r.d.why!;
      const lab = sc.labor!;
      expect(w.skill).toBeGreaterThanOrEqual(lab.colleague.skill);
      expect(w.salary).toBeLessThanOrEqual(w.price + Math.floor((w.price * w.over) / 10000));
      // принятый — человек с этим кандидатом
      const p = [...Object.values(s90.people), ...Object.values(s90.former)].find(x => x.cand === r.d.cand);
      expect(p?.role).toBe(r.d.role);
    }
    for (const r of of(s90, 'vacancy')) {
      const w = r.d.why!;
      const p = s90.people[w.instead] ?? s90.former[w.instead];
      expect(p.tab).toBe(w.tab);
      expect(p.quit?.day).toBe(w.day);
    }
  });
});

describe('решение игрока', () => {
  test('запись «вы» с местом команды: пост, директор; мест не выбрано — без места; сценарий — не пишет', () => {
    const s = newPlant(db, { scenario: SC });
    // задания и заказы сценария в первую секунду — не решения руководителя и не игрока
    expect(s.journal.filter(r => r.t === 0 || r.d.kind === 'order')).toEqual([]);
    const recipe = sc.plan!.items[0].recipe;
    apply(db, s, { kind: 'order', recipe, notBefore: s.t + 3 * DAY });
    expect(s.journal.at(-1)).toMatchObject({ by: 'player', d: { kind: 'order', recipe } });
    expect(s.journal.at(-1)!.seat).toBeUndefined();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    apply(db, s, { kind: 'order', recipe, notBefore: s.t + 3 * DAY, by: 'player' });
    expect(s.journal.at(-1)).toMatchObject({ by: 'player', seat: 'production' });
    apply(db, s, { kind: 'seat', seats: ['director'] });
    const sup = Object.keys(db.suppliers)[0];
    const [m, it] = Object.entries(db.suppliers[sup].items)[0];
    apply(db, s, { kind: 'po', supplier: sup, lines: [{ material: m, qty: it.moq, maker: it.maker }], by: 'player' });
    const r = s.journal.at(-1)!;
    expect(r).toMatchObject({ by: 'player', seat: 'director', d: { kind: 'po', supplier: sup } });
    if (r.d.kind === 'po') {
      expect(r.d.prepaid).toBe(s.pos[r.d.po].prepaid!);
      expect(r.d.why).toBeUndefined();
    }
  });

  test('отказ — не решение: записи нет', () => {
    const s = newPlant(db, { scenario: SC });
    const n = s.journal.length;
    apply(db, s, { kind: 'order', recipe: 'rcp.none' });
    apply(db, s, { kind: 'po', supplier: 'sup.none', lines: [] });
    apply(db, s, { kind: 'maintain', machine: 'none', part: 'none' });
    expect(s.journal).toHaveLength(n);
  });

  test('чужой пост — отказ без записи; свой — запись с этим постом', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    const n = s.journal.length;
    const out = apply(db, s, { kind: 'order', recipe: sc.plan!.items[0].recipe, by: 'player' });
    expect(out.some(x => x.kind === 'refused' && x.why === 'notYours')).toBe(true);
    expect(s.journal).toHaveLength(n);
  });
});

describe('срок и устройство журнала', () => {
  test('в полночь уходят записи старше срока; номера идут по порядку', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: 2 * DAY });
    const at = s.t;
    s.journal.unshift({ n: 0, t: at - (KEEP + 2) * DAY, by: 'hr', d: { kind: 'targets', why: { n: 1 } } }, { n: 0, t: at - (KEEP - 1) * DAY, by: 'hr', d: { kind: 'targets', why: { n: 2 } } });
    // до полуночи — на месте
    const midnight = Math.floor(s.t / DAY) * DAY + DAY;
    apply(db, s, { kind: 'advance', seconds: midnight - s.t - HOUR });
    expect(s.journal.filter(r => r.d.kind === 'targets')).toHaveLength(2);
    apply(db, s, { kind: 'advance', seconds: HOUR });
    expect(s.journal.filter(r => r.d.kind === 'targets').map(r => (r.d.kind === 'targets' ? r.d.why.n : 0))).toEqual([2]);
    const ns = s.journal.filter(r => r.n > 0).map(r => r.n);
    expect(ns).toEqual([...ns].sort((a, b) => a - b));
    expect(new Set(ns).size).toBe(ns.length);
  });

  test('за 90 суток журнал не короче решений в нём: всё в сроке; на руководителя — его пост', () => {
    expect(s90.journal[0].t).toBeGreaterThanOrEqual(0);
    expect(s90.journal.length).toBeGreaterThan(150);
    const heads = new Set(s90.journal.map(r => r.by));
    for (const h of ['plan', 'supply', 'qc', 'qp', 'qa', 'maint', 'mes']) expect(heads.has(h as Decision['by'])).toBe(true);
  });

  test('истины в журнале нет: ни ключей истинных полей, ни запаса узлов до отказа', () => {
    const keys = new Set<string>();
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) (keys.add(k), walk(v));
    };
    walk(s90.journal);
    for (const k of ['truth', 'budget', 'causes', 'fired', 'root', 'noise', 'present', 'size', 'screen']) expect([k, keys.has(k)]).toEqual([k, false]);
    // запас узлов до отказа — числом нигде: у замены — износ и порог, не запас
    const budgets = new Set(Object.values(s90.parts).map(p => p.budget));
    for (const r of of(s90, 'replace')) expect(budgets.has(r.d.why!.wear)).toBe(false);
  });

  test('прежнее сохранение — журнал пуст, и решения пишутся дальше', async () => {
    const s = fromSave(db, await Bun.file(new URL('./fixtures/save-v28.json', import.meta.url)).text());
    expect(s.journal).toEqual([]);
    apply(db, s, { kind: 'advance', seconds: 3 * DAY });
    expect(s.journal.length).toBeGreaterThan(0);
    expect(s.journal[0].n).toBe(1);
  });

  test('образец схемы 29: записи руководителей и игрока с места читаются как есть и пишутся дальше', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v29.json', import.meta.url)).text();
    const raw = JSON.parse(json) as PlantState;
    const s = fromSave(db, json);
    expect(s.journal).toEqual(raw.journal);
    expect(s.journal.some(r => r.by === 'player' && r.seat === 'quality')).toBe(true);
    // номера идут дальше: счётчик журнала — в сохранении
    const last = s.journal.at(-1)!.n;
    apply(db, s, { kind: 'advance', seconds: 3 * DAY });
    const added = s.journal.filter(r => r.n > last);
    expect(added.length).toBeGreaterThan(0);
    expect(added[0].n).toBe(last + 1);
  });

  test('копия прогона плана — без журнала: в ней только решения прогона', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: 10 * DAY });
    const c = runSeed(db, s, [], { days: 3, seeds: 1 }, 0);
    expect(c.journal.length).toBeGreaterThan(0);
    expect(c.journal.every(r => r.t >= s.t)).toBe(true);
    // сам завод не тронут
    expect(s.journal.every(r => r.t <= s.t)).toBe(true);
  });

  test('запись — номер, мгновение, автор; место — только у игрока', () => {
    const s = newPlant(db, { scenario: SC });
    note(s, 'hr', { kind: 'leaveDraft', y: 2028, why: { people: 3, miss: 0 } });
    note(s, 'player', { kind: 'setpoint', key: 'k', value: 1, target: 1 }, 'quality');
    expect(s.journal.slice(-2)).toEqual([
      { n: s.journal.at(-2)!.n, t: s.t, by: 'hr', d: { kind: 'leaveDraft', y: 2028, why: { people: 3, miss: 0 } } },
      { n: s.journal.at(-2)!.n + 1, t: s.t, by: 'player', seat: 'quality', d: { kind: 'setpoint', key: 'k', value: 1, target: 1 } },
    ]);
    expect(planOf(db, s.plant)).toBeDefined();
  });
});
