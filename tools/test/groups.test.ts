// Часть Б7б, шаг 1: поля состояния — группами (docs/specs/2026-10-vertical-slice.md, «Б7б»). У объекта с 65 и больше
// полями JavaScriptCore и V8 читают их в 4–5 раз медленнее (docs/02-architecture.md, §1), поэтому у состояния не больше
// 63 полей верхнего уровня — и в типе, с необязательными. Заместители, «Некому решить» и отработанные правила
// руководителей — в `heads`, задания суток, прогноз продаж, S&OP и события коммерции — в `planning`; сохранение прежней
// схемы переносит их туда до шагов миграции, копия прогона плана берёт их у завода, как раньше.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { db } from '../../src/content';
import { DAY } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { runHeads, runSeed } from '../../src/engine/plan/run';
import { fromSave } from '../../src/engine/save';
import { type PlantState, SCHEMA } from '../../src/engine/types';

const MOVED: [string, 'heads' | 'planning'][] = [
  ['deputies', 'heads'],
  ['noOne', 'heads'],
  ['ruled', 'heads'],
  ['daily', 'planning'],
  ['forecast', 'planning'],
  ['sop', 'planning'],
  ['commerce', 'planning'],
];
const fixture = (v: number) => readFileSync(new URL(`./fixtures/save-v${v}.json`, import.meta.url), 'utf8');
const versions = readdirSync(new URL('./fixtures/', import.meta.url))
  .map(f => /^save-v(\d+)\.json$/.exec(f)?.[1])
  .filter((v): v is string => v !== undefined)
  .map(Number)
  .sort((a, b) => a - b);
type Box = Record<string, unknown>;
const box = (s: PlantState, k: 'heads' | 'planning') => s[k] as unknown as Box;

describe('поля состояния — группами', () => {
  test('в типе состояния — не больше 63 полей верхнего уровня, с необязательными', () => {
    const src = readFileSync(new URL('../../src/engine/types.ts', import.meta.url), 'utf8');
    const at = src.indexOf('export interface PlantState {');
    const body = src.slice(at, src.indexOf('\n}\n', at));
    const fields = [...body.matchAll(/^ {2}([A-Za-z_]\w*)\??:/gm)].map(m => m[1]);
    expect(fields.length).toBeGreaterThan(50);
    expect(fields.length).toBeLessThanOrEqual(63);
    for (const [k] of MOVED) expect(fields).not.toContain(k);
    expect(fields).toContain('planning');
  });

  test('сохранение схемы 47: поля — на местах групп, остальное — как было', () => {
    const raw = JSON.parse(fixture(47)) as Box;
    const s = fromSave(db, fixture(47));
    expect(s.schema).toBe(SCHEMA);
    expect(SCHEMA).toBe(48);
    for (const [k, to] of MOVED) {
      expect(k in s).toBe(false);
      if (raw[k] === undefined) expect(k in box(s, to)).toBe(false);
      else expect(box(s, to)[k]).toEqual(raw[k]);
    }
    // в образце — все четыре поля планирования и отработанные правила
    expect(Object.keys(s.planning).sort()).toEqual(['commerce', 'daily', 'forecast', 'sop']);
    expect(s.heads.ruled).toEqual(raw.ruled as Record<string, number>);
    const { deputies: _d, noOne: _n, ruled: _r, ...heads } = s.heads;
    expect(heads).toEqual(raw.heads as typeof heads);
    const out = s as unknown as Box;
    const moved = new Set(MOVED.map(([k]) => k));
    for (const k of Object.keys(raw)) if (!moved.has(k) && k !== 'schema' && k !== 'heads' && k !== 'plan') expect(out[k]).toEqual(raw[k]);
    // план — тот же, только здание стало участком и корпусом: внутренность без стен здания, участок «Завод»
    const { building, ...rest } = raw.plan as Box & { building: [number, number, number, number] };
    const { hull, lot, ...plan } = s.plan;
    expect(plan).toEqual(rest as typeof plan);
    expect(hull).toEqual([[building[0] + 100, building[1] + 100, building[2] - 200, building[3] - 200]]);
    expect(lot).toEqual({ kind: 'plant', size: [12000, 8000] });
    expect(Object.keys(s).length).toBe(Object.keys(raw).length - 5 + 1);
  });

  test('образцы всех схем: полей групп верхнего уровня нет, полей — не больше 63; шаги до 48 пишут на новые места', () => {
    expect(versions.at(-1)).toBe(SCHEMA);
    for (const v of versions) {
      const s = fromSave(db, fixture(v));
      for (const [k] of MOVED) expect(k in s).toBe(false);
      expect(s.planning).toBeDefined();
      expect(Object.keys(s).length).toBeLessThanOrEqual(63);
      // задания суток — со схемы 40: шаг 39 → 40 ставит их пустыми; прогноз у сценария прототипа — с шага 40 → 41
      if (v === 39) expect(s.planning.daily).toEqual([]);
      expect(s.planning.forecast).toBeDefined();
    }
  });

  test('копия прогона плана: заместители, «Некому решить» и правила — как у завода, заданий суток нет', () => {
    const s = newPlant(db, { scenario: 'scn.proto' });
    apply(db, s, { kind: 'advance', seconds: 3 * DAY });
    s.heads.deputies = { qc: Object.values(s.people).find(p => p.role === 'role.qa')!.id };
    s.heads.noOne = { maint: true };
    expect(Object.keys(s.heads.ruled ?? {}).length).toBeGreaterThan(0);
    const h = runHeads(s);
    expect(h.deputies).toEqual(s.heads.deputies);
    expect(h.deputies).not.toBe(s.heads.deputies);
    expect(h.noOne).toEqual(s.heads.noOne);
    expect(h.ruled).toEqual(s.heads.ruled);
    expect(s.planning.daily?.length).toBeGreaterThan(0);
    const c = runSeed(db, s, [], { days: 1, seeds: 1 }, 0);
    expect('daily' in c.planning).toBe(false);
    expect(c.planning.forecast).toBeDefined();
    expect(Object.keys(c).length).toBeLessThanOrEqual(63);
    // завод тот же
    expect(s.planning.daily?.length).toBeGreaterThan(0);
  });
});
