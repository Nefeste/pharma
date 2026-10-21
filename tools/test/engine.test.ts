// Движок завода части 0 (docs/02-architecture.md, §3–4): часы, планёрка в 08:00, ход времени срезами — то же, что одним
// куском; сохранение — снимок со схемой и миграциями (образцы всех схем); ветви зерна не зависят друг от друга.
import { describe, expect, test } from 'bun:test';
import { legacy as db } from './legacy';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, MORNING, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { roll } from '../../src/engine/random';
import { fromSave, toSave } from '../../src/engine/save';
import { type Notice, SCHEMA } from '../../src/engine/types';

const SC = 'scn.proto';

function run(step: number, until: number, seed = 1) {
  const s = newPlant(db, { scenario: SC, seed });
  const notices: Notice[] = [];
  while (s.t < until) notices.push(...apply(db, s, { kind: 'advance', seconds: Math.min(step, until - s.t) }));
  return { s, notices };
}

describe('часы и планёрка', () => {
  test('партия начинается в час сценария, первая планёрка — ближайшие 08:00', () => {
    const s = newPlant(db, { scenario: SC });
    expect(s.t).toBe(db.scenarios[SC].start.hour * HOUR);
    expect(s.schema).toBe(SCHEMA);
    expect(s.content).toBe(db.hash);
    const out = apply(db, s, { kind: 'advance', seconds: MORNING - s.t });
    expect(out.filter(n => n.kind === 'morning')).toEqual([{ kind: 'morning', day: 1 }]);
    expect(s.day).toBe(1);
  });

  test('десять суток — десять планёрок, по одной в 08:00', () => {
    const { s, notices } = run(3600, 10 * DAY + MORNING);
    expect(notices.flatMap(n => (n.kind === 'morning' ? [n.day] : []))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(s.day).toBe(11);
  });

  test('срезами по 1 с, 15 с, 1 ч и одним куском — одно состояние', () => {
    const until = 3 * DAY + 5 * HOUR + 17;
    const prints = [1, 15, 3600, until].map(step => fingerprint(run(step, until, 7).s));
    expect(new Set(prints).size).toBe(1);
  });

  test('бюджет кадра: недожитое доживается следующей командой, итог тот же', () => {
    const a = newPlant(db, { scenario: SC, seed: 3 });
    const b = newPlant(db, { scenario: SC, seed: 3 });
    // a — кусок в 5 суток с бюджетом «одно событие», потом догоняет пустым ходом
    apply(db, a, { kind: 'advance', seconds: 5 * DAY }, () => false);
    expect(a.until).toBeDefined();
    apply(db, a, { kind: 'advance', seconds: 0 });
    apply(db, b, { kind: 'advance', seconds: 5 * DAY });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });
});

describe('сохранение', () => {
  test('снимок через JSON продолжается так же, как оригинал', () => {
    const { s } = run(3600, 2 * DAY);
    const copy = fromSave(db, toSave(s));
    apply(db, s, { kind: 'advance', seconds: 3 * DAY });
    apply(db, copy, { kind: 'advance', seconds: 3 * DAY });
    expect(fingerprint(copy)).toBe(fingerprint(s));
  });

  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])('образец схемы %d читается и живёт дальше (tools/test/fixtures/)', async v => {
    const json = await Bun.file(new URL(`./fixtures/save-v${v}.json`, import.meta.url)).text();
    const s = fromSave(db, json);
    expect(s.schema).toBe(SCHEMA);
    expect(Object.keys(s.people).length).toBeGreaterThan(0);
    const before = s.day;
    apply(db, s, { kind: 'advance', seconds: DAY });
    expect(s.day).toBe(before + 1);
  });

  test('образец схемы 2: у партий — свойства, приборы — по плану; 90 суток лаборатория работает, инварианты — каждый час', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v2.json', import.meta.url)).text();
    const s = fromSave(db, json);
    for (const lot of Object.values(s.lots)) expect([lot.truth, lot.coa].every(p => Object.keys(p).length > 0)).toBe(true);
    expect(Object.keys(s.instruments)).toEqual(db.plants[s.plant].instruments.map(i => i.id));
    expect(check(db, s)).toEqual([]);
    const end = s.t + 90 * DAY;
    while (s.t < end) {
      apply(db, s, { kind: 'advance', seconds: HOUR });
      expect(check(db, s)).toEqual([]);
    }
    for (const lot of Object.values(s.lots)) expect(['released', 'rejected']).toContain(lot.status);
  });

  test('образец схемы 15: в прежних сутках потерь уборки и переналадки — нули; новые сутки их копят (Б2г)', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v15.json', import.meta.url)).text();
    const raw = JSON.parse(json) as { losses: { day: number }[] };
    const s = fromSave(db, json);
    for (const d of s.losses) expect([d.day, d.cleans, d.changes]).toEqual([d.day, { major: 0, majorSec: 0, minor: 0, minorSec: 0 }, { n: 0, sec: 0 }]);
    // прежняя партия дожила свои серии; первые серии коллеги планирования — через две недели после загрузки
    const n = raw.losses.length;
    apply(db, s, { kind: 'advance', seconds: 30 * DAY });
    expect(s.losses.slice(n - 1).some(d => d.cleans.minor + d.cleans.major > 0)).toBe(true);
    expect(check(db, s)).toEqual([]);
  });

  test('образец схемы 16: у испытаний — редакция спецификации, действовавшей при отборе пробы; у шага расследования — только у повторного (Б3а)', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v16.json', import.meta.url)).text();
    const raw = JSON.parse(json) as { tests: Record<string, { spec?: string }> };
    expect(Object.values(raw.tests).some(q => q.spec)).toBe(false);
    const s = fromSave(db, json);
    const tests = Object.values(s.tests);
    expect(tests.length).toBeGreaterThan(0);
    for (const q of tests) {
      const lot = s.lots[s.samples[q.sample].lot];
      if (q.inv && q.min === undefined && q.max === undefined) expect(q.spec).toBeUndefined();
      else expect(q.spec).toBe(db.materials[lot.material].spec);
    }
    // новые испытания помнят свою редакцию сами
    apply(db, s, { kind: 'advance', seconds: 10 * DAY });
    const fresh = Object.values(s.tests).filter(q => !raw.tests[q.id] && !q.inv);
    expect(fresh.length).toBeGreaterThan(0);
    for (const q of fresh) expect(q.spec).toBe(db.materials[s.lots[s.samples[q.sample].lot].material].spec);
    expect(check(db, s)).toEqual([]);
  });

  test('сохранение новее игры не открывается молча', () => {
    expect(() => fromSave(db, JSON.stringify({ schema: SCHEMA + 1 }))).toThrow();
    expect(() => fromSave(db, JSON.stringify({}))).toThrow();
  });
});

describe('ветви зерна', () => {
  test('ветвь по имени: бросок в одной не сдвигает другую', () => {
    const a = newPlant(db, { scenario: SC, seed: 11 });
    const b = newPlant(db, { scenario: SC, seed: 11 });
    roll(a, 'maint/press-a', r => r.u32());
    roll(a, 'maint/press-a', r => r.u32());
    expect(roll(a, 'market/customer-1', r => r.u32())).toBe(roll(b, 'market/customer-1', r => r.u32()));
    expect(roll(a, 'maint/press-a', r => r.u32())).not.toBe(roll(b, 'maint/press-a', r => r.u32()));
  });
});
