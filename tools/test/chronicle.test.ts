// Хроника завода (Б10, шаг 1; docs/specs/2026-10-vertical-slice.md, «Б10»): записи по событиям с вещами и числами из
// записей завода, главы, без истины, сохранение и образцы, найм — группой, без оценок игрока.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../../src/content';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { LONG_WAIT } from '../../src/engine/chronicle';
import { apply, newPlant } from '../../src/engine/engine';
import { fromSave, toSave } from '../../src/engine/save';
import type { PlantState } from '../../src/engine/types';
import { ru } from '../../src/i18n/ru';
import { chapterOf, chronicleView } from '../../src/sim/chronicle';
import { chronicleText } from '../../src/ui/Chronicle';

const run = (days: number) => {
  const s = newPlant(db, { scenario: 'scn.proto' });
  for (let d = 0; d < days; d++) apply(db, s, { kind: 'advance', seconds: DAY });
  return s;
};
const s60 = run(60);
const of = <K extends string>(s: PlantState, k: K) => s.story.chronicle.filter(e => e.k === k) as Extract<PlantState['story']['chronicle'][number], { k: K }>[];

describe('хроника: записи по событиям', () => {
  test('по порядку времени; виды — выпуск, заказы, поставки', () => {
    const c = s60.story.chronicle;
    expect(c.length).toBeGreaterThan(30);
    for (let i = 1; i < c.length; i++) expect(c[i].t).toBeGreaterThanOrEqual(c[i - 1].t);
    expect(of(s60, 'released').length).toBeGreaterThan(10);
  });

  test('серия выпущена: та самая, через столько от «не раньше», самое долгое ожидание — не короче 12 ч, решило уполномоченное лицо', () => {
    for (const e of of(s60, 'released')) {
      const b = s60.batches[e.b];
      expect(b.status === 'released' || b.status === 'fg').toBe(true);
      expect(e.sec).toBe(e.t - b.notBefore);
      if (e.ph) expect(e.phSec!).toBeGreaterThanOrEqual(LONG_WAIT);
      expect(e.by).toBe('qp');
      if (e.late !== undefined) expect(e.late).toBe(e.t - b.due!);
    }
    expect(of(s60, 'released').some(e => e.ph !== undefined)).toBe(true);
    // серию выпускают по партиям ГП — запись одна на серию
    expect(new Set(of(s60, 'released').map(e => e.b)).size).toBe(of(s60, 'released').length);
  });

  test('заказ не в срок или не весь: одна запись на заказ, заказ закрыт не «в срок»', () => {
    const m = of(s60, 'missed');
    expect(new Set(m.map(e => e.o)).size).toBe(m.length);
    for (const e of m) expect(['late', 'short']).toContain(s60.orders[e.o].status);
  });

  test('отклонение — одна запись на отклонение; вывод — только после вывода расследования', () => {
    const d = of(s60, 'dev');
    expect(new Set(d.map(e => e.d)).size).toBe(d.length);
    for (const e of d) expect(s60.deviations[e.d].opened).toBe(e.t);
    for (const e of of(s60, 'concluded')) expect(s60.investigations[e.inv].status).not.toBe('open');
  });

  test('детерминирована; сохранение посреди игры — те же записи и дальше та же лента', () => {
    const a = run(20);
    expect(a.story.chronicle).toEqual(s60.story.chronicle.filter(e => e.t <= a.t));
    const b = fromSave(db, toSave(a));
    expect(b.story).toEqual(a.story);
    apply(db, a, { kind: 'advance', seconds: 5 * DAY });
    apply(db, b, { kind: 'advance', seconds: 5 * DAY });
    expect(b.story).toEqual(a.story);
  }, 120_000);
});

describe('хроника: главы для окна', () => {
  test('сутки — от планёрки до планёрки, неделя — с понедельника, месяц — с первого числа', () => {
    const t = s60.t;
    const d = chapterOf(s60, 'day', t, 0);
    expect(d.to - d.from).toBe(DAY);
    expect(((d.from % DAY) + DAY) % DAY).toBe(8 * HOUR);
    expect(t >= d.from && t < d.to).toBe(true);
    const w = chapterOf(s60, 'week', t, 1);
    expect(w.to - w.from).toBe(7 * DAY);
    expect(w.to).toBeLessThanOrEqual(d.from + 7 * DAY);
    const m = chapterOf(s60, 'month', t, 1);
    expect(m.to).toBe(chapterOf(s60, 'month', t, 0).from);
  });

  test('записи главы новыми сверху, итог — числа её записей; «раньше» есть, пока есть старые записи', () => {
    const v = chronicleView(db, s60, { view: 'chronicle', scale: 'month', back: 1 });
    for (const r of v.rows) expect(r.e.t >= v.from && r.e.t < v.to).toBe(true);
    for (let i = 1; i < v.rows.length; i++) expect(v.rows[i].e.t).toBeLessThanOrEqual(v.rows[i - 1].e.t);
    expect(v.sum.released).toBe(v.rows.filter(r => r.e.k === 'released').length);
    const rel = v.rows.find(r => r.e.k === 'released')!;
    expect(rel.facts.batch).toMatch(/^[A-Z]{2}\d{7}$/);
    expect(rel.go).toEqual({ dossier: Number((rel.e as { b: string }).b.slice(1)) });
    expect(chronicleView(db, s60, { view: 'chronicle', scale: 'month', back: 0 }).older).toBe(true);
  });

  test('год — с 1 января: итоги месяцев — доля заказов вовремя закрытых месяцев года; причины — по числу', () => {
    const v = chronicleView(db, s60, { view: 'chronicle', scale: 'year', back: 0 });
    expect(chapterOf(s60, 'year', s60.t, 0).from).toBe(v.from);
    expect(v.to - v.from).toBe(365 * DAY);
    const closed = s60.kpi.months.filter(k => !k.part && k.y === 2027);
    expect(v.year!.otif.map(o => o.m)).toEqual(closed.map(k => k.m));
    for (let i = 1; i < v.year!.causes.length; i++) expect(v.year!.causes[i].n).toBeLessThanOrEqual(v.year!.causes[i - 1].n);
    expect(v.rows.length).toBe(s60.story.chronicle.length);
  });

  test('вся хроника — для выгрузки: все записи, шапка — сценарий и зерно, даты — первой и последней записи; текст по месяцам', () => {
    const v = chronicleView(db, s60, { view: 'chronicle', scale: 'all', back: 0 });
    expect(v.rows.length).toBe(s60.story.chronicle.length);
    expect(v.head).toEqual({ scenario: 'scn.proto', seed: s60.seed });
    expect(v.from).toBe(s60.story.chronicle[0].t);
    expect(v.to).toBe(s60.story.chronicle.at(-1)!.t);
    const text = chronicleText(v, s60.start);
    const lines = text.trim().split('\n');
    expect(lines[0]).toContain('Хроника завода');
    expect(lines).toContain('Сентябрь 2027');
    expect(lines).toContain('Октябрь 2027');
    expect(lines.filter(l => /^\d\d\.\d\d \d\d:\d\d  /.test(l)).length).toBe(v.rows.length);
  });

  test('без истины: два завода с разными истинными полями — одна глава', () => {
    const b = fromSave(db, toSave(s60));
    for (const lot of Object.values(b.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
    for (const bt of Object.values(b.batches)) for (const k of Object.keys(bt.truth) as (keyof typeof bt.truth)[]) bt.truth[k] = (bt.truth[k] ?? 0) + 777;
    for (const sc of ['day', 'week', 'month'] as const) expect(chronicleView(db, b, { view: 'chronicle', scale: sc, back: 1 })).toEqual(chronicleView(db, s60, { view: 'chronicle', scale: sc, back: 1 }));
  });
});

describe('хроника: слова и сохранения', () => {
  test('в шаблонах нет оценок игрока', () => {
    const bad = /плох|хорош|отличн|провал|молод|позор|стыд|увы|к сожалению|лучш|худш/i;
    const C = ru.chronicle;
    const texts = [
      C.released('X', 'Y', '3 дня'),
      C.waited('1 ч', 'лабораторию'),
      C.late('2 ч'),
      C.rejected('X', 'Y'),
      C.missed(1, 'Z', 3, 'S'),
      C.missed(1, 'Z', 0, ''),
      C.dev(1, 'существенное', 'X'),
      C.concluded('X', 'C', C.fate.reject),
      C.concluded('X', 'C', C.fate.release),
      C.capa(1, 2, true),
      C.capa(1, 2, false),
      C.poLate(1, 'S', 'm'),
      C.poCame(1, 'S', '1 ч'),
      C.failure('M', 'P'),
      C.repaired('M', 'P', '1 ч'),
      C.hired('R', 1),
      C.left('R', 1, 'по соглашению сторон'),
      C.unit('U'),
      C.project('P', 'S'),
      C.goals(1, 3),
      C.sum(1, 2, 3, 4),
      C.morning(5),
    ];
    for (const x of texts) expect([x, bad.test(x)]).toEqual([x, false]);
  });

  test('схема 53 — хроника посреди игры, найм группой; схема 52 — хроника пуста, найм — в группе', () => {
    const a = fromSave(db, readFileSync(join(import.meta.dir, 'fixtures/save-v53.json'), 'utf8'));
    expect(a.story.chronicle.some(e => e.k === 'released')).toBe(true);
    expect(a.hiring).toBeDefined();
    const n = a.story.chronicle.length;
    apply(db, a, { kind: 'advance', seconds: 5 * DAY });
    expect(a.story.chronicle.length).toBeGreaterThan(n);
    const b = fromSave(db, readFileSync(join(import.meta.dir, 'fixtures/save-v52.json'), 'utf8'));
    expect(b.story).toEqual({ chronicle: [] });
    expect(Object.keys(b.hiring).sort()).toEqual(['candidates', 'former', 'hires', 'vacancies']);
    for (const k of ['vacancies', 'candidates', 'hires', 'former']) expect(k in b).toBe(false);
  });
});
