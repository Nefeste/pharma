// Б1б: «Сейчас» (src/sim/now.ts) и «Смотреть» из карточки (src/app/watch.ts). Каждая идущая работа — в одной строке:
// задача — своей, подготовка и проверка — в строке испытания, смена у линии — в строке упаковки, проверка и разгрузка — в
// строке фуры. Норма — та, что знает завод: стадия — по карте на массу серии (`nominal()` движка и прогона расписания),
// прибор — по методике, замена по плану — время замены, ремонт после отказа — «от и до» из записи узла. Вытянутая движком
// длительность стадии и ремонта, конец задачи, истинные свойства и запас узлов вид не меняют. Ключей сверх описанных нет.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { watchFor } from '../../src/app/watch';
import { apply } from '../../src/engine/engine';
import { partType } from '../../src/engine/maint';
import { nominal, stageMass } from '../../src/engine/mes';
import { fromSave } from '../../src/engine/save';
import type { PlantState } from '../../src/engine/types';
import { NOW_DEPTS, type NowRow, type NowView, nowView } from '../../src/sim/now';

/** Образец дня 15: третья серия комплектуется, две — в лаборатории и на упаковке дальше (tools/test/make-save-fixture.ts). */
const s0 = fromSave(db, await Bun.file(new URL('./fixtures/save-v15.json', import.meta.url)).text());

const FOLDED = new Set(['crew', 'prep', 'review', 'truckCheck', 'unload', 'load']);

/** Поля строки по src/sim/now.ts: новое — сначала сюда, с вопросом, знает ли его завод. */
const ALLOWED = new Set(
  // с Б1д — номер серии к её досье и материал ходки комплекта
  'view rows key dept kind batch stage lot method phase inst machine part room line sku supplier customer major planned people n role from norm range done target rate rated thing i k over bn material'.split(' '),
);

function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keysOf(x, out);
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysOf(x, out);
    }
  return out;
}

/** Завод, в котором другим всё, чего завод не знает: сколько продлятся стадия и ремонт, когда кончится задача, истина. */
function mangle(s: PlantState): PlantState {
  const o: PlantState = structuredClone(s);
  for (const t of Object.values(o.tasks)) {
    if (t.kind === 'stage' || (t.kind === 'repair' && !t.planned)) t.work += 777;
    if (t.times) t.times[4] += 777;
  }
  for (const p of Object.values(o.parts)) p.budget += 12_345;
  for (const lot of Object.values(o.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
  for (const b of Object.values(o.batches)) {
    for (const k of Object.keys(b.truth) as (keyof typeof b.truth)[]) b.truth[k] = (b.truth[k] ?? 0) + 777;
    b.causes = [{ cause: 'cause.mill.screen', attr: 'dissolution', delta: -999, stage: 'mill' }];
  }
  return o;
}

/** Строки вида и задачи завода — друг другу: каждая работа одной строкой, нормы — как у завода. */
function check(s: PlantState, v: NowView) {
  const keys = v.rows.map(r => r.key);
  expect(new Set(keys).size).toBe(keys.length);
  expect([...keysOf(v)].filter(k => !ALLOWED.has(k))).toEqual([]);
  const order = v.rows.map(r => NOW_DEPTS.indexOf(r.dept));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  const row = (key: string) => v.rows.find(r => r.key === key);
  const has = (r: NowRow | undefined, people: string[]) => !!r && people.every(id => r.people.some(p => p.n === Number(id.slice(1))));
  for (const t of Object.values(s.tasks)) {
    if (t.state !== 'busy') continue;
    if (!FOLDED.has(t.kind)) expect(row(t.id)).toBeDefined();
    else if (t.kind === 'prep' || t.kind === 'review') expect(has(row(`test:${t.test}`), t.people)).toBe(true);
    else if (t.kind === 'crew') expect(has(row(`pack:${t.batch}`), t.people)).toBe(true);
    else {
      const truck = t.truck ?? (t.from.kind === 'truck' ? t.from.id : undefined);
      expect(has(row(`truck:${truck}`), t.people)).toBe(true);
    }
  }
  for (const r of v.rows) {
    const t = s.tasks[r.key];
    if (r.kind === 'stage') {
      const b = s.batches[t.batch!];
      // по карте — на массу на входе стадии (Б1д): без того, что загрузят на стадиях дальше
      expect(r.norm).toBe(nominal(db, b.recipe, db.recipes[b.recipe].stages[b.stage], stageMass(db, b, b.stage)));
    }
    if (r.kind === 'repair') {
      const type = partType(db, s.parts[t.part!]);
      if (r.planned) expect([r.norm, r.range]).toEqual([type.replace, undefined]);
      else expect([r.norm, r.range]).toEqual([undefined, type.repair]);
    }
    if (r.kind === 'test' && r.phase === 'run') expect(r.norm).toBe(db.tests[r.method!].run);
    if (r.kind === 'pack') expect(r.done! <= r.target!).toBe(true);
  }
}

describe('«Сейчас»', () => {
  test('шесть суток с образца дня 15: каждая работа — одной строкой, нормы — как у завода, истина вид не меняет', () => {
    const s = structuredClone(s0);
    // замена пуансонов пресса по плану — строка ремонта с временем замены
    apply(db, s, { kind: 'maintain', machine: 'press-1', part: 'punches' });
    const kinds = new Set<string>();
    for (let i = 0; i < 6 * 24 * 6; i++) {
      apply(db, s, { kind: 'advance', seconds: 600 });
      const v = nowView(db, s);
      check(s, v);
      for (const r of v.rows) kinds.add(r.kind === 'test' ? `test/${r.phase}` : r.kind);
      if (i % 24 === 0) expect(nowView(db, mangle(s))).toEqual(v);
    }
    for (const k of ['stage', 'clean', 'test/prep', 'test/run', 'test/review', 'pack', 'truck', 'repair']) expect(kinds).toContain(k);
  }, 120_000);
});

describe('«Смотреть» из карточки', () => {
  const rows: NowRow[] = [
    { key: 'T1', dept: 'mes', kind: 'stage', people: [{ n: 12, role: 'role.operator' }], from: 0, norm: 5700, thing: { kind: 'room', i: 7 } },
    { key: 'pack:B3', dept: 'line', kind: 'pack', people: [{ n: 20, role: 'role.line-operator' }], from: 0, thing: { kind: 'machine', line: 0, k: 1 } },
    { key: 'truck:R4', dept: 'wms', kind: 'truck', people: [], from: 0, thing: { kind: 'truck', n: 4, customer: true } },
  ];

  test('человек — работа, где он занят; машина — работа её линии; оборудование — стадия в его помещении', () => {
    expect(watchFor({ kind: 'person', n: 20 }, undefined, rows)?.key).toBe('pack:B3');
    expect(watchFor({ kind: 'person', n: 99 }, undefined, rows)).toBeUndefined();
    expect(watchFor({ kind: 'machine', line: 0, k: 2 }, undefined, rows)?.key).toBe('pack:B3');
    expect(watchFor({ kind: 'room', i: 7 }, undefined, rows)?.key).toBe('T1');
    expect(watchFor({ kind: 'truck', n: 4, customer: true }, undefined, rows)?.key).toBe('truck:R4');
    const card = { kind: 'equipment' as const, eq: 0, type: 'eq.scale', room: 7, state: 'run' as const, parts: [], why: [], history: [] };
    expect(watchFor({ kind: 'equipment', i: 0 }, card, rows)?.key).toBe('T1');
    expect(watchFor({ kind: 'unit', n: 5 }, undefined, rows)).toBeUndefined();
    expect(watchFor(undefined, undefined, rows)).toBeUndefined();
  });
});
