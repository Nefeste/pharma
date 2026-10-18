// Часть 1ж: потери и ритм (docs/specs/2026-10-engine.md, 1ж). Коэффициент ритмичности по недовыполнению; задержки задач
// с причиной — смена, люди — и полночь между сутками; перемещения пешком — путь назначенной задачи; время серии по
// состояниям — от задания до выпуска, упаковка — время работы линии; сменное задание и выпуск смены; дефекты суток;
// сохранение посреди ожидания. Разложение времени серии без остатка и ожидание только открытых задач проверяют
// инварианты на каждом шаге.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { DAY, HOUR, momentOf } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { P_ONE } from '../../src/engine/core/rng';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { rhythm } from '../../src/engine/lean';
import { MES } from '../../src/engine/mes';
import { dist, planOf } from '../../src/engine/plant';
import { fromSave, toSave } from '../../src/engine/save';
import { addTask, dispatch } from '../../src/engine/tasks';
import type { Batch, DayLoss, Notice, PlantState, ShiftTask } from '../../src/engine/types';

const SC = 'scn.proto';
const RCP = 'rcp.paracetamol500.wet.v1';
const N20 = 'sku.paracetamol500.n20';
const plan = planOf(db, db.scenarios[SC].plant);

/** Завод без заданий сценария; узлы без отказов. */
const variant = (sc: Partial<ContentDb['scenarios'][string]> = {}): ContentDb => ({
  ...db,
  scenarios: { ...db.scenarios, [SC]: { ...db.scenarios[SC], batches: [], wear: {}, maint: {}, ...sc } },
});
const bare = variant();

function plant(base: ContentDb): PlantState {
  const s = newPlant(base, { scenario: SC });
  for (const p of Object.values(s.parts)) p.budget = Number.MAX_SAFE_INTEGER;
  return s;
}

function live(base: ContentDb, s: PlantState, days: number, until?: () => boolean): Notice[] {
  const out: Notice[] = [];
  const end = s.t + days * DAY;
  while (s.t < end && !until?.()) {
    out.push(...apply(base, s, { kind: 'advance', seconds: Math.min(HOUR, end - s.t) }));
    const bad = check(base, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
  return out;
}

function order(base: ContentDb, s: PlantState, sku?: string): Batch {
  const n = Object.keys(s.batches).length;
  apply(base, s, { kind: 'order', recipe: RCP, ...(sku ? { sku } : {}) });
  return Object.values(s.batches)[n];
}

/** Сутки потерь по дню от начала партии. */
const lossOf = (s: PlantState, n: number): DayLoss => s.losses.find(d => d.day === momentOf(s.start, 0).day + n)!;
/** Момент `h` часов суток `n` от начала партии. */
const at = (n: number, h: number) => n * DAY + h * HOUR;

/**
 * Уборка мастерской: работа аппаратчиков (смены 07–15 и 15–23), десять минут — удобная задача без груза. Её заводят как
 * событие движка: сразу после — раздача.
 */
function clean(s: PlantState) {
  const t = addTask(s, { kind: 'clean', roles: [...MES.operators], from: { kind: 'point', x: plan.room.workshop.x, z: plan.room.workshop.z }, work: 10 * 60, prio: 28, room: 'workshop' });
  dispatch(bare, s);
  return t;
}

test('коэффициент ритмичности: выпуск смены, но не больше задания, против суммы заданий (по недовыполнению)', () => {
  const shift = (planned: number, fact?: number): ShiftTask => ({ line: 'line-1', shift: 'shift.a', from: 0, plan: planned, start: 0, ...(fact !== undefined ? { fact, to: 1 } : {}) });
  // пример Савицкой (декады): план 32 000 × 3, выпуск 30 240 / 34 272 / 36 288 — по объёмам 98,2 %
  expect(rhythm([shift(32_000, 30_240), shift(32_000, 34_272), shift(32_000, 36_288)])).toBe(Math.floor(((30_240 + 32_000 + 32_000) * P_ONE) / 96_000));
  // смены без задания и незакрытые — не в счёт; считать нечего — нет числа
  expect(rhythm([shift(0, 500), shift(1000), shift(1000, 900)])).toBe(9000);
  expect(rhythm([shift(0, 500)])).toBeUndefined();
});

describe('задержки задач', () => {
  test('людей роли нет в смене — «смена»; полночь делит ожидание между сутками', () => {
    const s = plant(bare);
    apply(bare, s, { kind: 'advance', seconds: at(0, 23) + 30 * 60 - s.t });
    const t = clean(s);
    expect(t.why).toBe('shift');
    // аппаратчики выходят в 07:00 следующего дня
    live(bare, s, 1, () => !s.tasks[t.id] || s.tasks[t.id].state === 'busy');
    expect(lossOf(s, 0).wait.mes?.shift).toBe(30 * 60);
    expect(lossOf(s, 1).wait.mes?.shift).toBe(7 * HOUR);
  });

  test('люди роли в смене, но все заняты, — «люди»: ждёт, пока кто-то освободится', () => {
    const s = plant(bare);
    live(bare, s, 1, () => s.t >= at(0, 10));
    const n = Object.values(s.people).filter(p => p.role === 'role.operator' && p.shift === 'shift.a').length;
    const ts = Array.from({ length: n + 1 }, () => clean(s));
    expect(ts.at(-1)!.why).toBe('people');
    live(bare, s, 1, () => !ts.some(t => s.tasks[t.id]));
    const waited = lossOf(s, 0).wait.mes?.people ?? 0;
    // ждала, пока кончится уборка одного из них (10 минут работы и путь)
    expect(waited).toBeGreaterThanOrEqual(10 * 60);
    expect(waited).toBeLessThan(20 * 60);
  });

  test('путь назначенной задачи — перемещения: от входа до мастерской', () => {
    const s = plant(bare);
    const before = { ...(s.losses.at(-1)!.walk.mes ?? { cm: 0, sec: 0 }) };
    const op = Object.values(s.people).find(p => p.role === 'role.operator' && p.shift === 'shift.a')!;
    const from = { x: op.x, z: op.z };
    clean(s);
    const walk = s.losses.at(-1)!.walk.mes!;
    expect(walk.cm - before.cm).toBe(dist(plan, from, plan.room.workshop));
  });
});

describe('серия от задания до выпуска', () => {
  const s = plant(bare);
  const b = order(bare, s, N20);
  live(bare, s, 15, () => b.status === 'released');
  const sum = Object.values(b.spent).reduce((n, x) => n + x, 0);

  test('время с задания до выпуска разложено по состояниям без остатка; после выпуска — не идёт', () => {
    expect(b.status).toBe('released');
    expect(sum).toBe(b.released! - b.ordered);
    expect(b.phase).toBeUndefined();
    for (const ph of ['kitting', 'work', 'lab', 'line', 'packing', 'decision'] as const) expect(b.spent[ph]).toBeGreaterThan(0);
  });

  test('упаковка — время работы линии; стадии — не меньше времени в досье; обработка — малая часть цикла', () => {
    expect(b.spent.packing).toBe(b.pack!.end! - b.pack!.start!);
    expect(b.spent.work!).toBeGreaterThanOrEqual(b.records.reduce((n, r) => n + r.end - r.start, 0));
    expect((b.spent.work! + b.spent.packing!) * 2).toBeLessThan(sum);
  });

  test('дефекты суток: брак камер упаковки — в сутки конца упаковки', () => {
    const day = s.losses.find(d => d.day === momentOf(s.start, b.pack!.end!).day)!;
    expect(day.defects.blisters).toBe(b.pack!.blisterRejects!);
    expect(day.defects.cartons).toBe(b.pack!.cartonRejects!);
  });
});

test('сменное задание: меньшее из «осталось в заданиях линии» и «узкое место × смена × норма»; выпуск смены — годные пачки', () => {
  // блистерная медленная — задание на упаковку длится несколько смен; норма 100 %
  const base: ContentDb = { ...variant({ norm: P_ONE }), machines: { ...db.machines, 'mach.blister': { ...db.machines['mach.blister'], nominal: 10 } } };
  const s = plant(base);
  const b = order(base, s, N20);
  live(base, s, 30, () => b.pack?.state === 'done');
  expect(b.pack!.state).toBe('done');
  const sh = db.shifts['shift.a'];
  // узкое место — блистерная: 10 блистеров в минуту — 5 пачек №20; за смену — 8 ч
  const cap = (sh.to - sh.from) * 60 * (10 / db.skus[N20].blisters);
  const planned = s.shiftTasks.filter(t => t.plan > 0);
  expect(planned.length).toBeGreaterThan(2);
  for (const t of planned) expect(t.plan).toBeLessThanOrEqual(cap);
  expect(planned.some(t => t.plan === cap)).toBe(true);
  // на номинале — не больше задания; микроостановки и начало задания — меньше: ритм ниже 100 %
  for (const t of planned) if (t.fact !== undefined) expect(t.fact).toBeLessThanOrEqual(cap);
  const k = rhythm(s.shiftTasks)!;
  expect(k).toBeGreaterThan(0);
  expect(k).toBeLessThan(P_ONE);
  // выпуск смен в сумме — годные пачки задания
  const line = s.lines['line-1'];
  const open = s.shiftTasks.find(t => t.to === undefined);
  const made = s.shiftTasks.reduce((n, t) => n + (t.fact ?? 0), 0) + (open ? line.packs + line.made - open.start : 0);
  expect(made).toBe(b.pack!.cartons! - b.pack!.cartonRejects!);
});

test('снимок посреди ожидания продолжается так же, как оригинал', () => {
  const s = plant(bare);
  order(bare, s, N20);
  live(bare, s, 2, () => Object.values(s.tasks).some(t => t.why !== undefined));
  expect(Object.values(s.tasks).some(t => t.why !== undefined)).toBe(true);
  const copy = fromSave(bare, toSave(s));
  live(bare, s, 3);
  live(bare, copy, 3);
  expect(fingerprint(copy)).toBe(fingerprint(s));
});

test('сохранение схемы 7: потери — с суток миграции, время серий до неё — «до миграции»; дальше — с инвариантами', async () => {
  const s = fromSave(db, await Bun.file(new URL('./fixtures/save-v7.json', import.meta.url)).text());
  expect(s.losses).toHaveLength(1);
  expect(s.shiftTasks).toEqual([]);
  for (const b of Object.values(s.batches)) expect(b.spent.before).toBe((b.released ?? s.t) - b.ordered);
  expect(check(db, s)).toEqual([]);
  live(db, s, 10);
});
