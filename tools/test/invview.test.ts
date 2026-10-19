// Часть 4б: вид доски расследования (docs/specs/2026-10-investigation.md, 4б). Без истины до решения: заводы, у которых
// различаются только скрытые поля происшествия и расследования, дают один и тот же вид, полей истины в нём нет. Шаги —
// можно, идёт, сделан; версии — по уликам, сильнейшая первой; «выпустить» — только доказанная ошибка лаборатории; разбор —
// только у решённого. Очередь лаборатории: партия под расследованием и испытание его шага.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { IncidentRoot } from '../../src/content/types';
import { DAY, MIN } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import type { Incident, Investigation, PlantState } from '../../src/engine/types';
import { invView } from '../../src/sim/inv';
import { labView } from '../../src/sim/lab';

const SC = 'scn.proto';

/** Завод с происшествием заданного корня и постом качества у игрока — коллега не вмешивается. */
function plantWith(root: IncidentRoot, fired: Incident['fired'] = {}): PlantState {
  const s = newPlant(db, { scenario: SC });
  const def = db.scenarios[SC].incident!;
  const own: Incident['fired'] = root === 'lube' ? { lubeLong: 'lube' } : root === 'force' ? { forceHigh: 'force' } : root === 'screen' ? { screenChanged: 'screen' } : { calc: 'lab' };
  s.incident = { batch: `B${def.batch}`, inv: def.inv, root, size: def.sizes[root][1], fired: { ...own, ...fired } };
  apply(db, s, { kind: 'seat', seats: ['quality'] });
  return s;
}

const open = (s: PlantState) => Object.keys(s.investigations).length > 0;

/** Дожить до открытия расследования. */
function untilOpen(s: PlantState): Investigation {
  for (let i = 0; i < 80 && !open(s); i++) apply(db, s, { kind: 'advance', seconds: DAY / 4 });
  return Object.values(s.investigations)[0];
}

/** Дожить, пока шаг не кончится. */
function untilDone(s: PlantState, inv: Investigation, step: string) {
  for (let i = 0; i < 500 && inv.runs.find(r => r.step === step)?.to === undefined; i++) apply(db, s, { kind: 'advance', seconds: 10 * MIN });
  expect(inv.runs.find(r => r.step === step)?.to).toBeDefined();
}

/** Всё, чего завод не знает, — другим: происшествие, корень и следы расследования, отметки, истинные свойства, причины. */
function mangle(s: PlantState): PlantState {
  const o: PlantState = structuredClone(s);
  o.incident = { ...o.incident!, root: 'screen', size: o.incident!.size + 77, fired: { screenChanged: 'leak', calc: 'lab' }, screen: 1000 };
  for (const inv of Object.values(o.investigations)) {
    inv.truth = { root: 'api', fired: { instrument: 'lab' }, present: { calc: true } };
    o.tests[inv.test].mark = 'typo';
    o.instruments[o.tests[inv.test].inst!].check = 'vibration';
  }
  for (const lot of Object.values(o.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
  for (const b of Object.values(o.batches)) {
    for (const k of Object.keys(b.truth) as (keyof typeof b.truth)[]) b.truth[k] = (b.truth[k] ?? 0) + 777;
    b.causes = [{ cause: 'cause.mill.screen', attr: 'dissolution', delta: -999, stage: 'mill' }];
    b.screen = 1234;
  }
  return o;
}

describe('доска до решения', () => {
  const s = plantWith('lube');
  const inv = untilOpen(s);
  for (const step of ['records', 'dossier', 'retest']) apply(db, s, { kind: 'investigate', inv: inv.id, step, by: 'player' });
  untilDone(s, inv, 'records');

  test('что случилось, участники; шаги — сделан, идёт, можно; версии по уликам', () => {
    const v = invView(db, s, { view: 'inv' });
    expect(v.list).toEqual([{ id: inv.id, batch: [s.batches.B2.code.y, s.batches.B2.code.m, s.batches.B2.code.n], opened: inv.opened, status: 'open' }]);
    const b = v.board!;
    expect(b.what).toMatchObject({ method: 'test.dissolution', result: s.tests[inv.test].result, min: s.tests[inv.test].min, recipe: s.batches.B2.recipe });
    expect(b.who.lots.some(l => l.material === 'mat.api.paracetamol')).toBe(true);
    expect(b.who.stages.map(x => x.stage)).toEqual(s.batches.B2.records.map(r => r.stage));
    expect(b.who.inst).toBe(s.instruments[s.tests[inv.test].inst!].type);
    const state = Object.fromEntries(b.steps.map(x => [x.id, x.state]));
    expect(state.records).toBe('done');
    expect(state.retest).toBe('running');
    expect(state.journal).toBe('can');
    expect(b.steps.find(x => x.id === 'retest')!.now).toBeDefined();
    expect(b.obs.map(o => o.f)).toContain('calc');
    expect(b.beliefs.map(x => x.p)).toEqual([...b.beliefs.map(x => x.p)].sort((x, y) => y - x));
    expect(Math.abs(b.beliefs.reduce((n, x) => n + x.p, 0) - 10000)).toBeLessThanOrEqual(5);
    expect(b.release).toBe(false);
    expect(b.debrief).toBeUndefined();
    expect(b.conclusion).toBeUndefined();
  });

  test('без истины: полей истины нет; заводы, у которых различаются только скрытые поля, дают один вид', () => {
    const v = invView(db, s, { view: 'inv' });
    const json = JSON.stringify(v);
    const keys = new Set<string>();
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object')
        for (const [k, y] of Object.entries(x)) {
          keys.add(k);
          walk(y);
        }
    };
    walk(v);
    for (const k of ['truth', 'fired', 'present', 'root', 'mark', 'check', 'causes', 'screen', 'noise', 'debrief']) expect(keys.has(k)).toBe(false);
    const o = mangle(s);
    expect(JSON.stringify(invView(db, o, { view: 'inv' }))).toBe(json);
    expect(JSON.stringify(labView(db, o))).toBe(JSON.stringify(labView(db, s)));
  });

  test('очередь лаборатории: партия — на расследовании, повтор — испытание шага', () => {
    const row = labView(db, s).rows.find(r => r.lot === inv.lot)!;
    expect(row.stage).toBe('inv');
    expect(row.tests.filter(q => q.inv)).toHaveLength(1);
    expect(row.all).toBe(s.samples[s.lots[inv.lot].sample!].tests.length);
  });

  test('решили — разбор: корень, вклады, улики; в списке — судьба серии', () => {
    const c: PlantState = structuredClone(s);
    apply(db, c, { kind: 'conclude', inv: inv.id, cause: 'lube', fate: 'reject', by: 'player' });
    const v = invView(db, c, { view: 'inv', inv: inv.id });
    expect(v.list[0]).toMatchObject({ status: 'closed', fate: 'reject' });
    expect(v.board!.conclusion).toMatchObject({ cause: 'lube', fate: 'reject', by: 'player' });
    expect(v.board!.debrief).toMatchObject({ root: 'lube', cause: true, fate: true, good: false });
    expect(v.board!.debrief!.causes[0].cause).toBe('cause.blend.lube');
    expect(labView(db, c).rows.some(r => r.lot === inv.lot)).toBe(false);
  });
});

describe('выпустить', () => {
  test('ошибка лаборатории доказана — ошибка расчёта и повтор в пределах; до того — нет', () => {
    const s = plantWith('lab');
    const inv = untilOpen(s);
    for (const step of ['records', 'retest']) apply(db, s, { kind: 'investigate', inv: inv.id, step, by: 'player' });
    untilDone(s, inv, 'records');
    expect(invView(db, s, { view: 'inv' }).board!.release).toBe(false);
    untilDone(s, inv, 'retest');
    const b = invView(db, s, { view: 'inv' }).board!;
    expect(b.release).toBe(true);
    expect(b.beliefs[0].id).toBe('lab');
  });
});
