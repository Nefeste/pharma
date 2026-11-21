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
import { inForce, liveOf, revisions } from '../../src/engine/docs';
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
