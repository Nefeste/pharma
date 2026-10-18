// Часть 3г: поднять пробу (docs/specs/2026-10-panels.md, 3г). Открытые задачи лаборатории поднятой партии — выше на RUSH,
// очередь раздачи — по приоритету, времени и номеру; задачи, которые появляются позже, — тоже выше; поднятая партия
// проходит лабораторию не позже, чем без команды; отказы — партии нет, она прошла лабораторию, она уже поднята.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { LAB_PRIO, RUSH } from '../../src/engine/lab';
import type { Notice, PlantState, Task } from '../../src/engine/types';

const SC = 'scn.proto';
const LAB = new Set(Object.keys(LAB_PRIO));

/** Партия задачи лаборатории: своя или партия пробы испытания. */
const lotOf = (s: PlantState, t: Task) => t.lot ?? (t.test ? s.samples[s.tests[t.test].sample]?.lot : undefined);
const labOpen = (s: PlantState, lot: string) => s.open.map(id => s.tasks[id]).filter(t => LAB.has(t.kind) && lotOf(s, t) === lot);

/** Первое мгновение, когда у двух партий поставщиков открыты задачи лаборатории, — они делят людей и приборы. */
function twoInLab(): { s: PlantState; lots: string[] } {
  const s = newPlant(db, { scenario: SC });
  for (let h = 0; h < 40 * 24; h++) {
    apply(db, s, { kind: 'advance', seconds: HOUR });
    const lots = Object.values(s.lots)
      .filter(l => l.supplier !== 'start' && l.supplier !== 'plant' && labOpen(s, l.id).length > 0)
      .map(l => l.id);
    if (lots.length >= 2) return { s, lots };
  }
  throw new Error('за 40 суток две партии в лаборатории не встретились');
}

const { s: base, lots } = twoInLab();
/** Последняя из них в очереди раздачи — её и поднимаем. */
const last = lots.reduce((a, b) => (base.open.indexOf(labOpen(base, a)[0].id) > base.open.indexOf(labOpen(base, b)[0].id) ? a : b));

describe('поднять пробу', () => {
  test('открытые задачи лаборатории партии — выше на RUSH; очередь раздачи — по приоритету, времени и номеру', () => {
    const s: PlantState = structuredClone(base);
    const before = new Map(labOpen(s, last).map(t => [t.id, t.prio]));
    expect(apply(db, s, { kind: 'rush', lot: last, by: 'player' }).filter(n => n.kind === 'refused')).toEqual([]);
    expect(s.lots[last].rush).toBe(true);
    for (const [id, prio] of before) if (s.tasks[id]?.state === 'open') expect(s.tasks[id].prio).toBe(prio + RUSH);
    // очередь: приоритет по убыванию, затем время, затем номер
    for (let i = 1; i < s.open.length; i++) {
      const a = s.tasks[s.open[i - 1]];
      const b = s.tasks[s.open[i]];
      const ok = a.prio > b.prio || (a.prio === b.prio && (a.created < b.created || (a.created === b.created && Number(a.id.slice(1)) < Number(b.id.slice(1)))));
      expect(ok).toBe(true);
    }
  });

  test('задачи, которые появляются позже, — тоже выше; поднятая партия решена не позже, чем без команды', () => {
    const rushed: PlantState = structuredClone(base);
    const plain: PlantState = structuredClone(base);
    apply(db, rushed, { kind: 'rush', lot: last, by: 'player' });
    const seen = new Set(Object.keys(rushed.tasks));
    const decided = (s: PlantState) => (s.lots[last].status === 'released' || s.lots[last].status === 'rejected' ? s.lots[last].since : undefined);
    let later = 0;
    for (let h = 0; h < 30 * 24 && (decided(rushed) === undefined || decided(plain) === undefined); h++) {
      apply(db, rushed, { kind: 'advance', seconds: HOUR });
      apply(db, plain, { kind: 'advance', seconds: HOUR });
      for (const t of Object.values(rushed.tasks)) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        if (LAB.has(t.kind) && lotOf(rushed, t) === last) {
          expect(t.prio).toBe(LAB_PRIO[t.kind as keyof typeof LAB_PRIO] + RUSH);
          later++;
        }
      }
    }
    expect(later).toBeGreaterThan(0);
    expect(decided(rushed)).toBeDefined();
    expect(decided(plain)).toBeDefined();
    expect(decided(rushed)!).toBeLessThanOrEqual(decided(plain)!);
  });

  test('отказы: партии нет, она прошла лабораторию, она уже поднята', () => {
    const s: PlantState = structuredClone(base);
    const why = (n: Notice[]) => n.filter(x => x.kind === 'refused').map(x => (x.kind === 'refused' ? x.why : ''));
    expect(why(apply(db, s, { kind: 'rush', lot: 'L999999' }))).toEqual(['noLot']);
    const done = Object.values(s.lots).find(l => l.status === 'released')!;
    expect(why(apply(db, s, { kind: 'rush', lot: done.id }))).toEqual(['notLab']);
    expect(why(apply(db, s, { kind: 'rush', lot: last }))).toEqual([]);
    expect(why(apply(db, s, { kind: 'rush', lot: last }))).toEqual(['already']);
  });

  test('сохранение посреди лаборатории с поднятой партией — отметка и приоритеты те же', async () => {
    const { fromSave, toSave } = await import('../../src/engine/save');
    const s: PlantState = structuredClone(base);
    apply(db, s, { kind: 'rush', lot: last });
    const back = fromSave(db, toSave(s));
    expect(back.lots[last].rush).toBe(true);
    expect(back.open.map(id => back.tasks[id].prio)).toEqual(s.open.map(id => s.tasks[id].prio));
    apply(db, back, { kind: 'advance', seconds: DAY });
    apply(db, s, { kind: 'advance', seconds: DAY });
    expect(toSave(back)).toBe(toSave(s));
  });
});
