// Часть 4: расследование (docs/specs/2026-10-investigation.md). Вывод — копия «Анамнеза»: версии в сумме — 1, улика
// сдвигает свои версии, два наблюдения одной улики — одна улика, польза известного — 0. Происшествие: то же зерно — то
// же; у каждого корня — свой след в состоянии; первая серия не задета; результат вне спецификации держит партию до
// решения. Шаги — задачи своих ролей, улики — из состояния; повтор — той же пробы другим аналитиком. Решение: выпустить —
// только с лабораторной причиной и повтором в пределах; отклонить — серия отклонена; сито названо — сито по карте, не
// названо — следующая серия снова вне спецификации. Коллега без поста качества решает сам, с постом — ждёт. Сохранение
// посреди расследования; двойник не знает корня.
import { describe, expect, test } from 'bun:test';
import { legacy as db } from './legacy';
import type { IncidentRoot } from '../../src/content/types';
import { DAY, HOUR, MIN } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, newPlant } from '../../src/engine/engine';
import { entropy, expectedGain, type Observation, posterior } from '../../src/engine/infer';
import { debrief, IDLE_GAIN } from '../../src/engine/investigation';
import { check } from '../../src/engine/invariants';
import { runPlan } from '../../src/engine/plan/run';
import { blind } from '../../src/engine/plan/twin';
import { fromSave, toSave } from '../../src/engine/save';
import type { Incident, Investigation, Notice, PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const M = db.investigations['inv.dissolution'];
const live = (s: PlantState, days: number): Notice[] => {
  const out: Notice[] = [];
  const end = s.t + Math.round(days * DAY);
  while (s.t < end) {
    out.push(...apply(db, s, { kind: 'advance', seconds: Math.min(6 * HOUR, end - s.t) }));
    const bad = check(db, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
  return out;
};
const refusals = (n: Notice[]) => n.flatMap(x => (x.kind === 'refused' ? [[x.why, x.detail]] : []));

/** Завод с происшествием заданного корня: следы — как у жребия с этим корнем, без фона. */
function plantWith(root: IncidentRoot, fired: Incident['fired'] = {}, seats?: ('quality' | 'production' | 'director')[]): PlantState {
  const s = newPlant(db, { scenario: SC });
  const def = db.scenarios[SC].incident!;
  const own: Incident['fired'] = root === 'lube' ? { lubeLong: 'lube' } : root === 'force' ? { forceHigh: 'force' } : root === 'screen' ? { screenChanged: 'screen' } : { calc: 'lab' };
  s.incident = { batch: `B${def.batch}`, inv: def.inv, root, size: def.sizes[root][1], fired: { ...own, ...fired } };
  if (seats) apply(db, s, { kind: 'seat', seats });
  return s;
}

/**
 * Дожить до открытия расследования у второй серии — не дальше 10 минут после него: полсуток открыли — назад к их началу
 * и по 10 минут (куски жизни на завод не влияют, engine.test).
 */
function untilOpen(s: PlantState): Investigation {
  const open = () => Object.keys(s.investigations).length > 0;
  for (let i = 0; i < 40 && !open(); i++) {
    const before = structuredClone(s);
    live(s, 0.5);
    if (!open()) continue;
    for (const k of Object.keys(s)) delete (s as unknown as Record<string, unknown>)[k];
    Object.assign(s, before);
    while (!open()) live(s, (10 * MIN) / DAY);
  }
  const inv = Object.values(s.investigations)[0];
  expect(inv).toBeDefined();
  return inv;
}

/** Дожить, пока все шаги расследования не кончатся. */
function untilSteps(s: PlantState, inv: Investigation) {
  for (let i = 0; i < 40 && inv.runs.some(r => r.to === undefined); i++) live(s, 0.25);
  expect(inv.runs.every(r => r.to !== undefined)).toBe(true);
}

describe('вывод — копия «Анамнеза»', () => {
  test('без улик — априорные веса; версии в сумме — 1; улика сдвигает свои версии', () => {
    const p0 = posterior(M, []);
    const total = M.candidates.reduce((n, c) => n + c.prior, 0);
    for (const c of M.candidates) expect(p0.find(b => b.id === c.id)!.p).toBeCloseTo(c.prior / total, 12);
    const obs: Observation[] = [{ f: 'lubeLong', step: 'dossier', shown: true }];
    const p1 = posterior(M, obs);
    expect(p1.reduce((n, b) => n + b.p, 0)).toBeCloseTo(1, 12);
    expect(p1[0].id).toBe('lube');
    const p2 = posterior(M, [{ f: 'retest', step: 'retest', shown: true }]);
    expect(p2[0].id).toBe('lab');
    expect(p2.find(b => b.id === 'lab')!.p).toBeGreaterThan(p0.find(b => b.id === 'lab')!.p);
    const p3 = posterior(M, [{ f: 'retest', step: 'retest', shown: false }]);
    expect(p3.find(b => b.id === 'lab')!.p).toBeLessThan(p0.find(b => b.id === 'lab')!.p);
  });

  test('два наблюдения одной улики — одна улика; польза известного — 0; польза не меньше нуля', () => {
    const once = posterior(M, [{ f: 'screenChanged', step: 'journal', shown: true }]);
    const twice = posterior(M, [
      { f: 'screenChanged', step: 'journal', shown: true },
      { f: 'screenChanged', step: 'journal', shown: true },
    ]);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    const p0 = posterior(M, []);
    for (const st of M.steps) expect(expectedGain(M, st.id, p0, new Set())).toBeGreaterThanOrEqual(0);
    expect(expectedGain(M, 'retest', p0, new Set())).toBeGreaterThan(0.1);
    expect(expectedGain(M, 'retest', p0, new Set(['retest']))).toBe(0);
    expect(entropy([{ id: 'a', p: 1 }])).toBe(0);
  });
});

describe('происшествие', () => {
  test('то же зерно — то же происшествие; на зёрнах — все четыре корня, крупной фракции АФС нет', () => {
    const a = newPlant(db, { scenario: SC, seed: 7 });
    const b = newPlant(db, { scenario: SC, seed: 7 });
    expect(JSON.stringify(b.incident)).toBe(JSON.stringify(a.incident));
    const roots = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) roots.add(newPlant(db, { scenario: SC, seed }).incident!.root);
    expect([...roots].sort()).toEqual(['force', 'lab', 'lube', 'screen']);
    // у сценария без заданий на серию происшествия нет
    const bare = { ...db, scenarios: { ...db.scenarios, [SC]: { ...db.scenarios[SC], batches: [] } } };
    expect(newPlant(bare, { scenario: SC }).incident).toBeUndefined();
  });

  test('у каждого корня — свой след; первая серия не задета; растворение второй — вне спецификации, партия ждёт', () => {
    for (const root of ['lab', 'lube', 'force', 'screen'] as IncidentRoot[]) {
      const s = plantWith(root, {}, ['quality']);
      const inv = untilOpen(s);
      const b1 = s.batches.B1;
      const b2 = s.batches.B2;
      expect(inv.batch).toBe('B2');
      expect(b1.status === 'released' || b1.status === 'fg' || b1.status === 'packing' || b1.status === 'bulk').toBe(true);
      expect(Object.values(s.investigations).every(i => i.batch === 'B2')).toBe(true);
      expect(s.lots[inv.lot].status).toBe('testing');
      expect(s.deviations[inv.deviation]).toMatchObject({ kind: 'oos', status: 'open', inv: inv.id });
      const rec = (stage: string) => b2.records.find(r => r.stage === stage)!;
      const r = db.recipes[b2.recipe];
      const param = (stage: string, id: string) => r.stages.find(st => st.id === stage)!.params.find(p => p.id === id)!;
      const first = s.tests[inv.test];
      const truth = s.lots[inv.lot].truth.dissolution!;
      if (root === 'lube') {
        expect(rec('blend').params.lubeTime).toBe(param('blend', 'lubeTime').target + s.incident!.size);
        expect(Object.values(s.deviations).some(d => d.kind === 'param' && d.batch === 'B2' && d.param === 'lubeTime')).toBe(true);
      }
      if (root === 'force') {
        expect(rec('compress').params.force).toBe(param('compress', 'force').target + s.incident!.size);
        const hard = rec('compress').ipc.filter(c => c.test === 'test.ipc.hardness').map(c => c.result);
        expect(hard.reduce((a, v) => a + v, 0) / hard.length).toBeGreaterThan(11000);
      }
      if (root === 'screen') {
        expect(s.maintLog.some(e => e.part === 'screen' && e.t <= rec('mill').start)).toBe(true);
        expect(b2.screen).toBe(s.incident!.size);
        expect(b2.truth.granule!).toBeGreaterThan(600);
        expect(rec('mill').params).toEqual({});
      }
      if (root === 'lab') {
        // ошибка лаборатории: истинное — в норме, результат — ниже на величину и с ошибкой пересчёта в записи
        expect(truth).toBeGreaterThanOrEqual(8000);
        expect(first.mark).toBe('calc');
        expect(first.result!).toBeLessThan(truth - s.incident!.size + 1000);
      } else expect(truth).toBeLessThan(8000);
      expect(first.result!).toBeLessThan(8000);
      // игрок держит пост качества — коллега не трогает расследование, партия ждёт
      live(s, 3);
      expect(inv.runs).toEqual([]);
      expect(s.lots[inv.lot].status).toBe('testing');
    }
  });
});

describe('шаги', () => {
  test('шаг — задача своей роли; повтор — той же пробы другим аналитиком; отказы; улики — из состояния', () => {
    const s = plantWith('lube', {}, ['quality']);
    const inv = untilOpen(s);
    expect(refusals(apply(db, s, { kind: 'investigate', inv: 'I9', step: 'records', by: 'player' }))).toEqual([['noInv', 'I9']]);
    expect(refusals(apply(db, s, { kind: 'investigate', inv: inv.id, step: 'guess', by: 'player' }))).toEqual([['noStep', 'guess']]);
    expect(refusals(apply(db, s, { kind: 'investigate', inv: inv.id, step: 'dossier', by: 'player' }))).toEqual([]);
    expect(refusals(apply(db, s, { kind: 'investigate', inv: inv.id, step: 'dossier', by: 'player' }))).toEqual([['already', 'dossier']]);
    const t = s.tasks[inv.runs[0].task!];
    expect(t).toMatchObject({ kind: 'invStep', roles: ['role.qa'], inv: inv.id, step: 'dossier' });
    apply(db, s, { kind: 'investigate', inv: inv.id, step: 'retest', by: 'player' });
    const q = s.tests[inv.runs[1].test!];
    const first = s.tests[inv.test];
    expect(q).toMatchObject({ sample: first.sample, method: first.method, inv: inv.id, min: first.min });
    expect(s.samples[q.sample].tests).not.toContain(q.id);
    untilSteps(s, inv);
    expect(q.by).not.toBe(first.by);
    const obs = Object.fromEntries(inv.obs.map(o => [o.f, o.shown]));
    expect(obs).toEqual({ lubeLong: true, soft: true, forceHigh: false, hard: false, retest: false });
    // числа для слов: время опудривания из записи, цель и предел карты
    const lube = inv.obs.find(o => o.f === 'lubeLong')!;
    expect(lube.data![0]).toBe(s.batches.B2.records.find(r => r.stage === 'blend')!.params.lubeTime);
  });

  test('без поста качества шаг и решение игрока — чужие', () => {
    const s = plantWith('lube', {}, ['production']);
    const inv = untilOpen(s);
    expect(refusals(apply(db, s, { kind: 'investigate', inv: inv.id, step: 'records', by: 'player' }))).toEqual([['notYours', 'quality']]);
    expect(refusals(apply(db, s, { kind: 'conclude', inv: inv.id, cause: 'lube', fate: 'reject', by: 'player' }))).toEqual([['notYours', 'quality']]);
  });
});

describe('решение', () => {
  test('выпустить — только с лабораторной причиной и повтором в пределах; тогда первый результат недействителен', () => {
    const s = plantWith('lab', { calc: 'lab' }, ['quality']);
    const inv = untilOpen(s);
    expect(refusals(apply(db, s, { kind: 'conclude', inv: inv.id, cause: 'lab', fate: 'release', by: 'player' }))).toEqual([['notProven', inv.id]]);
    expect(refusals(apply(db, s, { kind: 'conclude', inv: inv.id, cause: 'boss', fate: 'reject', by: 'player' }))).toEqual([['noCause', 'boss']]);
    apply(db, s, { kind: 'investigate', inv: inv.id, step: 'retest', by: 'player' });
    untilSteps(s, inv);
    // повтор в пределах, а лабораторная причина не найдена — первый результат не отменить
    expect(inv.obs.find(o => o.f === 'retest')!.shown).toBe(true);
    expect(refusals(apply(db, s, { kind: 'conclude', inv: inv.id, cause: 'lab', fate: 'release', by: 'player' }))).toEqual([['notProven', inv.id]]);
    apply(db, s, { kind: 'investigate', inv: inv.id, step: 'records', by: 'player' });
    untilSteps(s, inv);
    expect(inv.obs.find(o => o.f === 'calc')).toMatchObject({ shown: true, data: [1] });
    const out = apply(db, s, { kind: 'conclude', inv: inv.id, cause: 'lab', fate: 'release', by: 'player' });
    expect(refusals(out)).toEqual([]);
    expect(out).toContainEqual({ kind: 'concluded', id: inv.id, cause: 'lab', fate: 'release' });
    expect(inv).toMatchObject({ status: 'closed', conclusion: { cause: 'lab', fate: 'release', by: 'player' } });
    expect(s.tests[inv.test].invalid).toBe(true);
    expect(s.lots[inv.lot].status).toBe('released');
    expect(s.deviations[inv.deviation].status).toBe('closed');
    expect(refusals(apply(db, s, { kind: 'investigate', inv: inv.id, step: 'dossier', by: 'player' }))).toEqual([['closed', inv.id]]);
    // серия идёт к упаковке
    live(s, 6);
    expect(['packing', 'fg', 'released']).toContain(s.batches.B2.status);
  });

  test('отклонить — партия и серия отклонены, с ними решены и другие отклонения серии', () => {
    const s = plantWith('force', {}, ['quality']);
    const inv = untilOpen(s);
    expect(Object.values(s.deviations).filter(d => d.batch === 'B2' && d.status === 'open').length).toBeGreaterThan(1);
    apply(db, s, { kind: 'conclude', inv: inv.id, cause: 'force', fate: 'reject', by: 'player' });
    expect(s.lots[inv.lot].status).toBe('rejected');
    expect(Object.values(s.deviations).filter(d => d.batch === 'B2').every(d => d.status === 'closed')).toBe(true);
    live(s, 0.5);
    expect(s.batches.B2.status).toBe('rejected');
  });

  test('сито названо — механик ставит сито по карте; не названо — третья серия снова вне спецификации', () => {
    const named = plantWith('screen', {}, ['quality']);
    const a = untilOpen(named);
    apply(db, named, { kind: 'conclude', inv: a.id, cause: 'screen', fate: 'reject', by: 'player' });
    const fix = Object.values(named.tasks).find(t => t.kind === 'invFix')!;
    expect(fix).toMatchObject({ roles: ['role.mechanic'] });
    live(named, 9);
    expect(named.incident!.screen).toBeUndefined();
    expect(Object.keys(named.investigations)).toEqual([a.id]);
    expect(named.batches.B3.truth.dissolution!).toBeGreaterThan(8500);
    const wrong = plantWith('screen', {}, ['quality']);
    const b = untilOpen(wrong);
    apply(db, wrong, { kind: 'conclude', inv: b.id, cause: 'lube', fate: 'reject', by: 'player' });
    live(wrong, 9);
    expect(wrong.incident!.screen).toBeDefined();
    expect(wrong.batches.B3.truth.dissolution!).toBeLessThan(8000);
    expect(Object.values(wrong.investigations).map(i => i.batch)).toEqual(['B2', 'B3']);
  });
});

describe('разбор', () => {
  test('пока открыто — нет; после решения — корень, истинное, вклады причин, улики от корня и фон, лишний шаг', () => {
    const s = plantWith('lube', { calc: 'leak' }, ['quality']);
    const inv = untilOpen(s);
    expect(debrief(db, s, inv.id)).toBeUndefined();
    for (const step of ['records', 'dossier']) apply(db, s, { kind: 'investigate', inv: inv.id, step, by: 'player' });
    untilSteps(s, inv);
    // пересмазывание уже почти наверняка — журнал оборудования почти ничего не сдвинет
    apply(db, s, { kind: 'investigate', inv: inv.id, step: 'journal', by: 'player' });
    untilSteps(s, inv);
    apply(db, s, { kind: 'conclude', inv: inv.id, cause: 'lube', fate: 'reject', by: 'player' });
    const d = debrief(db, s, inv.id)!;
    expect(d).toMatchObject({ root: 'lube', cause: true, fate: true, good: false, provable: false, result: s.tests[inv.test].result });
    expect(d.truth).toBe(s.lots[inv.lot].truth.dissolution!);
    expect(d.truth).toBeLessThan(8000);
    expect(d.causes[0].cause).toBe('cause.blend.lube');
    expect(d.causes.every((c, i) => i === 0 || d.causes[i - 1].delta <= c.delta)).toBe(true);
    expect(Object.fromEntries(d.obs.map(o => [o.f, o.was]))).toEqual({ calc: 'leak', lubeLong: 'root', soft: 'root', forceHigh: 'none', hard: 'none', screenChanged: 'none' });
    expect(d.steps.map(x => [x.step, x.idle])).toEqual([
      ['records', false],
      ['dossier', false],
      ['journal', true],
    ]);
    expect(d.steps[2].gain).toBeLessThan(IDLE_GAIN);
  });

  test('годная партия: без лабораторной причины отклонить — верно по правилам; с причиной — надо было выпустить', () => {
    const typo = plantWith('lab', { calc: 'leak' }, ['quality']);
    const a = untilOpen(typo);
    apply(db, typo, { kind: 'conclude', inv: a.id, cause: 'lab', fate: 'reject', by: 'player' });
    expect(debrief(db, typo, a.id)).toMatchObject({ root: 'lab', cause: true, fate: true, good: true, provable: false });
    const calc = plantWith('lab', {}, ['quality']);
    const b = untilOpen(calc);
    apply(db, calc, { kind: 'conclude', inv: b.id, cause: 'screen', fate: 'reject', by: 'player' });
    expect(debrief(db, calc, b.id)).toMatchObject({ root: 'lab', cause: false, fate: false, good: true, provable: true });
  });
});

describe('коллега качества', () => {
  test('без поста качества — решает сам за двое суток: шаги своих ролей, причина — по уликам', () => {
    for (const root of ['lab', 'lube', 'force', 'screen'] as IncidentRoot[]) {
      const s = plantWith(root, root === 'lab' ? { calc: 'lab' } : {});
      const inv = untilOpen(s);
      live(s, 2.5);
      expect(inv.status).toBe('closed');
      expect(inv.conclusion!.by).toBe('head:quality');
      expect(inv.conclusion!.cause).toBe(root);
      expect(inv.conclusion!.fate).toBe(root === 'lab' ? 'release' : 'reject');
      for (const r of inv.runs) expect(r.by).toBe('head:quality');
      // сначала — лаборатория (фаза I): записи и прибор
      expect(inv.runs.slice(0, 2).map(r => r.step)).toEqual(['records', 'instrument']);
      expect(debrief(db, s, inv.id)).toMatchObject({ root, cause: true, fate: true });
    }
  });

  test('взяли пост качества посреди расследования — коллега ждёт; отдали — ведёт дальше', () => {
    const s = plantWith('lube');
    const inv = untilOpen(s);
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    const n = inv.runs.length;
    untilSteps(s, inv);
    live(s, 2);
    expect(inv.runs.length).toBe(n);
    expect(inv.status).toBe('open');
    apply(db, s, { kind: 'seat', seats: ['production'] });
    live(s, 2);
    expect(inv.status).toBe('closed');
  });
});

describe('сохранение и двойник', () => {
  test('сохранение посреди расследования — тот же завод дальше', () => {
    const s = plantWith('screen');
    const inv = untilOpen(s);
    // час спустя у коллеги идёт шаг, часть улик уже есть
    apply(db, s, { kind: 'advance', seconds: HOUR });
    expect(inv.status).toBe('open');
    expect(inv.obs.length).toBeGreaterThan(0);
    expect(inv.runs.some(r => r.to === undefined)).toBe(true);
    const t: PlantState = fromSave(db, toSave(s));
    live(s, 4);
    live(t, 4);
    expect(fingerprint(t)).toBe(fingerprint(s));
  });

  test('двойник не знает корня: заводы, у которых различаются только скрытые поля происшествия, — один прогон', () => {
    // до происшествия, посреди серии с ним и сразу после открытия расследования — коллега ведёт его в прогоне
    const plants = [3, 11].map(day => {
      const s = newPlant(db, { scenario: SC });
      live(s, day);
      return s;
    });
    const open = newPlant(db, { scenario: SC });
    const inv = untilOpen(open);
    expect(inv.runs.some(r => r.to === undefined)).toBe(true);
    for (const s of [...plants, open]) {
      const other: PlantState = structuredClone(s);
      const inc = other.incident!;
      inc.root = inc.root === 'lab' ? 'lube' : 'lab';
      inc.fired = { screenChanged: 'leak' };
      inc.size += 77;
      for (const i of Object.values(other.investigations)) {
        i.truth = { root: 'api', fired: {} };
        // ненайденные отметки у записи испытания и у прибора
        other.tests[i.test].mark = 'calc';
        other.instruments[other.tests[i.test].inst!].check = 'centering';
      }
      for (const b of Object.values(other.batches)) if (b.screen) b.screen += 500;
      // после двойника копии одинаковы — значит, и прогон
      for (const k of [0, 1, 2]) {
        const x: PlantState = structuredClone(s);
        const y: PlantState = structuredClone(other);
        blind(db, x, k);
        blind(db, y, k);
        expect(fingerprint(y)).toBe(fingerprint(x));
      }
      const a = runPlan(db, s, [], { days: 14, seeds: 3 });
      const b = runPlan(db, other, [], { days: 14, seeds: 3 });
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });
});
