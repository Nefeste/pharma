// Д1, шаг 1: база сценария 3 «Три серии подряд» (docs/specs/2026-11-fill.md, «Д1»). Методика размера частиц и вторая
// редакция спецификации АФС ибупрофена — проекты: в силу их вводит движок, пока — нет; у причины «крупная фракция АФС»
// вклад ибупрофена — только у его серий; хронический корень сценария сборщик проверяет: материал у изготовителя,
// свойство материала, роль штата, режим с шагом уставки, «от» не больше «до».
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import { DRAFT_DAY } from '../../src/content/types';
import { capaOptions } from '../../src/engine/capa';
import { driftFixed, driftLot, habitCured, habitParams } from '../../src/engine/chronic';
import { DAY, daysFromCivil, momentOf } from '../../src/engine/core/calendar';
import { inForce, liveOf, revisions } from '../../src/engine/docs';
import { apply, newPlant } from '../../src/engine/engine';
import { noRepeat } from '../../src/engine/goals';
import type { Lot, PlantState, StageRecord } from '../../src/engine/types';
import { buildDb } from '../content/load';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
/** Копия content/ с правками: файл → что на что заменить или новый текст. */
function broken(edits: Record<string, [string, string][] | string>): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'pharma-content-'));
  dirs.push(dir);
  cpSync(join(import.meta.dir, '../../content'), dir, { recursive: true });
  for (const [file, e] of Object.entries(edits)) {
    const p = join(dir, file);
    if (typeof e === 'string') {
      writeFileSync(p, e);
      continue;
    }
    let text = readFileSync(p, 'utf8');
    for (const [a, b] of e) {
      expect(text.includes(a)).toBe(true);
      text = text.replace(a, b);
    }
    writeFileSync(p, text);
  }
  return buildDb(dir).errors;
}
const has = (errors: string[], part: string) => expect(errors.some(e => e.includes(part))).toBe(true);

const CHRONIC = `
chronic:
  roots: { api: 40, lube: 30, both: 30 }
  drift: { material: mat.api.ibuprofen, maker: mkr.api-ibu, day: 20, attr: particle, shift: [40, 60] }
  habit: { role: role.operator, param: lubeTime, steps: [2, 4] }
  both: { shift: [20, 30], steps: [1, 2] }
`;
const c2 = readFileSync(join(import.meta.dir, '../../content/scenarios/c2.yaml'), 'utf8');

describe('база Д1', () => {
  test('методика размера частиц и редакция 2 спецификации АФС ибупрофена — проекты; в силе — редакция 1, пока движок не ввёл', () => {
    expect(db.tests['test.particle'].doc.from).toBe(DRAFT_DAY);
    expect(db.tests['test.particle'].inst).toBe('inst.laser');
    const r2 = db.specs['spec.mat.api.ibuprofen-r2'];
    expect(r2.doc.from).toBe(DRAFT_DAY);
    expect(r2.tests.map(t => t.test)).toContain('test.particle');
    expect(revisions(db, 'specs', 'spec.mat.api.ibuprofen')).toEqual(['spec.mat.api.ibuprofen', 'spec.mat.api.ibuprofen-r2']);
    const day = 21_000;
    expect(inForce(db, 'specs', 'spec.mat.api.ibuprofen', day)).toBe('spec.mat.api.ibuprofen');
    // обе введены: редакция 2 — с её дня
    const live = liveOf(db, { 'spec.mat.api.ibuprofen': day - 10, 'spec.mat.api.ibuprofen-r2': day });
    expect(inForce(live, 'specs', 'spec.mat.api.ibuprofen', day - 1)).toBe('spec.mat.api.ibuprofen');
    expect(inForce(live, 'specs', 'spec.mat.api.ibuprofen', day)).toBe('spec.mat.api.ibuprofen-r2');
  });

  test('крупная фракция АФС: общий вклад у всех, свой больший — только у ибупрофена', () => {
    const e = db.causes['cause.api.particle'].effects;
    expect(e.filter(x => !x.products).length).toBe(1);
    const ibu = e.find(x => x.products)!;
    expect(ibu.products).toEqual(['prd.ibuprofen200']);
    expect(ibu.coef).toBeLessThan(e.find(x => !x.products)!.coef);
  });

  test('хронический корень: годный — без ошибок; в единицах движка', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pharma-content-'));
    dirs.push(dir);
    cpSync(join(import.meta.dir, '../../content'), dir, { recursive: true });
    writeFileSync(join(dir, 'scenarios/c2.yaml'), c2 + CHRONIC);
    const { db: d, errors } = buildDb(dir);
    expect(errors).toEqual([]);
    const ch = d.scenarios['scn.c2'].chronic!;
    expect(ch.roots).toEqual({ api: 4000, lube: 3000, both: 3000 });
    expect(ch.drift.shift).toEqual([40, 60]);
    expect(ch.habit.steps).toEqual([2, 4]);
  });

  test('хронический корень: изготовитель не выпускает, нет свойства, роли нет в штате, режима нет, «от» больше «до»', () => {
    const w = (a: string, b: string) => broken({ 'scenarios/c2.yaml': c2 + CHRONIC.replace(a, b) });
    has(w('maker: mkr.api-ibu', 'maker: mkr.api-par'), 'mkr.api-par не выпускает mat.api.ibuprofen');
    has(w('attr: particle', 'attr: hardness'), 'у mat.api.ibuprofen нет свойства hardness');
    has(w('role: role.operator', 'role: role.nobody'), 'роли role.nobody нет в штате');
    has(w('param: lubeTime', 'param: nope'), 'режима nope с шагом уставки нет ни в одной карте');
    has(w('shift: [40, 60]', 'shift: [60, 40]'), 'drift: «от» больше «до»');
  });

  test('редакции-проекты одного кода: без дня — можно, номер повторяется — нельзя', () => {
    const r2 = readFileSync(join(import.meta.dir, '../../content/specs/mat/api/ibuprofen-r2.yaml'), 'utf8');
    has(broken({ 'specs/mat/api/ibuprofen-r2.yaml': r2.replace('rev: 2,', 'rev: 1,') }), 'документ SP-0028: у редакций');
  });
});

// ---------------------------------------------------------------- Д1, шаг 2: движок

describe('движок Д1', () => {
  /** База с хроническим корнем у сценария 2 и анализатором в лаборатории его плана; корень — по весам. */
  function chronicDb(roots: string, laser = true) {
    const dir = mkdtempSync(join(tmpdir(), 'pharma-content-'));
    dirs.push(dir);
    cpSync(join(import.meta.dir, '../../content'), dir, { recursive: true });
    writeFileSync(join(dir, 'scenarios/c2.yaml'), c2 + CHRONIC.replace('roots: { api: 40, lube: 30, both: 30 }', roots));
    const plan = join(dir, 'plants/c2.yaml');
    const text = readFileSync(plan, 'utf8');
    const row = '  - { id: diss-1, type: inst.dissolution, room: lab, place: QC-01.04, vendor: ven.ru }\n';
    expect(text.includes(row)).toBe(true);
    if (laser) writeFileSync(plan, text.replace(row, row + '  - { id: laser-1, type: inst.laser, room: lab, place: QC-01.05, vendor: ven.ru }\n'));
    const { db: d, errors } = buildDb(dir);
    expect(errors).toEqual([]);
    return d;
  }

  test('корень на старте: вид по весам, день сдвига — 20-е сутки от старта игрока, человек привычки — оператор', () => {
    const d = chronicDb('roots: { api: 100 }');
    const s = newPlant(d, { scenario: 'scn.c2' });
    expect(s.chronic!.root).toBe('api');
    const sc = d.scenarios['scn.c2'];
    expect(s.chronic!.day).toBe(daysFromCivil(sc.start.date) + sc.warm / DAY + 20);
    expect(s.chronic!.shift).toBeGreaterThanOrEqual(40);
    expect(s.chronic!.shift).toBeLessThanOrEqual(60);
    expect(s.people[s.chronic!.person!].role).toBe('role.operator');
    // у прототипа корня нет
    expect(newPlant(db, { scenario: 'scn.proto' }).chronic).toBeUndefined();
  });

  test('сдвиг партий: у изготовителя корня с его дня — частицы крупнее, и в паспорте; раньше и у другого — нет', () => {
    const d = chronicDb('roots: { api: 100 }');
    const s = newPlant(d, { scenario: 'scn.c2' });
    const c = s.chronic!;
    const lot = (maker: string) => ({ material: 'mat.api.ibuprofen', maker, truth: { particle: 60 }, coa: { particle: 60 } }) as unknown as Lot;
    const at = (day: number) => (s.t = (day - momentOf(s.start, 0).day) * DAY);
    at(c.day - 1);
    const early = lot('mkr.api-ibu');
    driftLot(d, s, early);
    expect(early.truth.particle).toBe(60);
    at(c.day);
    const late = lot('mkr.api-ibu');
    driftLot(d, s, late);
    expect(late.truth.particle).toBe(60 + c.shift);
    expect(late.coa.particle).toBe(60 + c.shift);
    const other = lot('mkr.api-par');
    driftLot(d, s, other);
    expect(other.truth.particle).toBe(60);
  });

  test('привычка: у стадии человека корня опудривание дольше на шаги уставки; у другого — нет; после обучения — нет', () => {
    const d = chronicDb('roots: { lube: 100 }');
    const s = newPlant(d, { scenario: 'scn.c2' });
    const c = s.chronic!;
    const st = d.recipes['rcp.ibuprofen200.dc.v1'].stages.find(x => x.params.some(p => p.id === 'lubeTime'))!;
    const p = st.params.find(x => x.id === 'lubeTime')!;
    const rec = (who: string) => {
      const r = { params: { lubeTime: p.target } } as unknown as StageRecord;
      habitParams(d, s, st, r, [who]);
      return r.params.lubeTime;
    };
    expect(rec(c.person!)).toBe(p.target + c.steps * p.step!);
    expect(rec('P0')).toBe(p.target);
    habitCured(s, [c.person!]);
    expect(rec(c.person!)).toBe(p.target);
  });

  test('CAPA «Испытание во входном контроле»: у отклонения по партии АФС — редакция 2 и методика; выполнена — в силе со дня после срока обучения', () => {
    const d = chronicDb('roots: { api: 100 }');
    const s = newPlant(d, { scenario: 'scn.c2' });
    const live = () => liveOf(d, s.portfolio?.docs);
    const lot = Object.values(s.lots).find(l => l.material === 'mat.api.ibuprofen')!;
    s.deviations.D99 = { id: 'D99', opened: s.t, kind: 'oos', lot: lot.id, cause: 'lot', status: 'open', cls: 'major' } as unknown as PlantState['deviations'][string];
    const opts = capaOptions(live(), s, s.deviations.D99);
    expect(opts[0].action).toBe('capa.spec');
    expect(opts[0].spec).toEqual(['spec.mat.api.ibuprofen-r2', 'test.particle']);
    expect(opts[0].learners).toBeGreaterThan(0);
    // без анализатора в лаборатории — нечем выполнить
    const bd = chronicDb('roots: { api: 100 }', false);
    const bare = newPlant(bd, { scenario: 'scn.c2' });
    const blot = Object.values(bare.lots).find(l => l.material === 'mat.api.ibuprofen')!;
    bare.deviations.D99 = { ...s.deviations.D99, lot: blot.id };
    expect(capaOptions(bd, bare, bare.deviations.D99).some(o => o.action === 'capa.spec')).toBe(false);
    apply(live(), s, { kind: 'seat', seats: ['quality'] });
    apply(live(), s, { kind: 'capa', deviation: 'D99', action: 'capa.spec' });
    const capa = Object.values(s.capas).find(x => x.action === 'capa.spec')!;
    expect(capa.spec).toEqual(['spec.mat.api.ibuprofen-r2', 'test.particle']);
    apply(live(), s, { kind: 'capaRun', capa: capa.id });
    expect(s.capas[capa.id].done).toBe(s.t);
    const today = momentOf(s.start, s.t).day;
    const day = today + d.scenarios['scn.c2'].training.ahead + 1;
    expect(inForce(live(), 'specs', 'spec.mat.api.ibuprofen', day - 1)).toBe('spec.mat.api.ibuprofen');
    expect(inForce(live(), 'specs', 'spec.mat.api.ibuprofen', day)).toBe('spec.mat.api.ibuprofen-r2');
    expect(live().tests['test.particle'].doc.from).toBe(day);
  });

  test('цель «повтора нет»: суток от выполнения CAPA, проверенной «эффективна»; повтор после неё — 0; нет такой CAPA — нечего считать', () => {
    const s = newPlant(db, { scenario: 'scn.proto' });
    expect(noRepeat(s, 0, 100 * DAY)).toBeUndefined();
    const dev = { id: 'D1', opened: DAY, kind: 'oos', test: 'test.dissolution', stage: 'press', status: 'closed', cls: 'major' } as unknown as PlantState['deviations'][string];
    s.deviations.D1 = dev;
    s.capas.G1 = { id: 'G1', dev: 'D1', action: 'capa.train', head: 'mes', t: DAY, by: 'qa', due: 30 * DAY, done: 2 * DAY, check: { t: 50 * DAY, ok: true } };
    expect(noRepeat(s, 0, 100 * DAY)).toBe(98);
    s.deviations.D2 = { ...dev, id: 'D2', opened: 60 * DAY };
    expect(noRepeat(s, 0, 100 * DAY)).toBe(0);
  });
});

// ---------------------------------------------------------------- Д1, шаг 3: сценарий

describe('сценарий 3', () => {
  test('старт: корень по зерну, анализатор в лаборатории, начальник ООК с навыком 3, цель «повтора нет»; письмо на старте', () => {
    const s = newPlant(db, { scenario: 'scn.c3' });
    expect(['api', 'lube', 'both']).toContain(s.chronic!.root);
    expect(s.plan.instruments.some(i => i.type === 'inst.laser')).toBe(true);
    expect(Object.values(s.people).find(p => p.role === 'role.qa-head')!.skill).toBe(3);
    expect(db.scenarios['scn.c3'].goals!.find(g => g.top)!.kind).toBe('noRepeat');
    expect(db.scenarios['scn.c3'].campaign).toBe(3);
  });

  test('оценка пары после дня смещения — изготовитель вернул процесс: новые партии — как прежде; до дня и у другого — нет', () => {
    const s = newPlant(db, { scenario: 'scn.c3' });
    s.chronic = { root: 'api', day: s.chronic!.day, shift: 50, steps: 2 };
    const at = (day: number) => (s.t = (day - momentOf(s.start, 0).day) * DAY);
    at(s.chronic.day - 1);
    driftFixed(db, s, 'mkr.api-ibu');
    expect(s.chronic.fixed).toBeUndefined();
    at(s.chronic.day + 5);
    driftFixed(db, s, 'mkr.api-par');
    expect(s.chronic.fixed).toBeUndefined();
    driftFixed(db, s, 'mkr.api-ibu');
    expect(s.chronic.fixed).toBe(s.t);
    const lot = { material: 'mat.api.ibuprofen', maker: 'mkr.api-ibu', truth: { particle: 60 }, coa: { particle: 60 } } as unknown as Lot;
    driftLot(db, s, lot);
    expect(lot.truth.particle).toBe(60);
  });
});
