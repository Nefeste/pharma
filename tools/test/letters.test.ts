// Письма наставника (Б9, шаг 2; docs/specs/2026-10-vertical-slice.md, «Б9»): приход, условие, «Пропустить»,
// «Пропустить обучение», передача отделов, сохранение.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import { HOUR } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { modeOf } from '../../src/engine/heads';
import { lettersOf } from '../../src/engine/letters';
import { fromSave, toSave } from '../../src/engine/save';
import type { Notice, PlantState } from '../../src/engine/types';
import { buildDb } from '../content/load';

const start = newPlant(db, { scenario: 'scn.c1' });
const fresh = () => {
  const s = fromSave(db, toSave(start));
  apply(db, s, { kind: 'seat', seats: ['director'] });
  return s;
};
const rec = (s: PlantState, id: string) => s.letters?.find(r => r.id === `let.c1.${id}`);

describe('письма сценария 1', () => {
  test('у сценария 1 — 14 писем наставника; у прототипа писем нет', () => {
    expect(lettersOf(db, 'scn.c1').length).toBe(14);
    expect(lettersOf(db, 'scn.c1').every(l => l.from === 'mentor')).toBe(true);
    expect(newPlant(db, { scenario: 'scn.proto' }).letters).toBeUndefined();
  });

  test('на старте — письмо о фуре, оно показывает на заказ сценария', () => {
    const s = fresh();
    expect(s.letters?.map(r => r.id)).toEqual(['let.c1.truck']);
    const po = s.pos[rec(s, 'truck')!.thing!];
    expect(po.by).toBe('scenario');
  });

  test('письмо кончается своим условием и только им: фура разгружена — пришло следующее, склад «советует»', () => {
    const s = fresh();
    expect(modeOf(s, 'wms')).toBe('auto');
    const seen: Notice[] = [];
    for (let i = 0; i < 6 && !rec(s, 'truck')!.end; i++) seen.push(...apply(db, s, { kind: 'advance', seconds: HOUR / 2 }));
    const truck = rec(s, 'truck')!;
    expect(truck.end?.how).toBe('done');
    expect(Object.values(s.trucks).some(t => t.po === truck.thing)).toBe(false);
    expect(rec(s, 'quarantine')).toBeDefined();
    expect(seen.some(n => n.kind === 'letter' && n.id === 'let.c1.quarantine')).toBe(true);
    expect(s.lots[rec(s, 'quarantine')!.thing!].po).toBe(truck.thing);
    // карантин отдаёт склад, когда кончится, — не раньше
    expect(modeOf(s, 'wms')).toBe('auto');
  });

  test('письмо дня — в свой час; выпуск серии — в первый день', () => {
    const s = fresh();
    apply(db, s, { kind: 'advance', seconds: 2 * HOUR + 1 });
    const r = rec(s, 'release')!;
    expect(r.at).toBe(start.t + 2 * HOUR);
    expect(s.batches[r.thing!]).toBeDefined();
    apply(db, s, { kind: 'advance', seconds: 14 * HOUR });
    expect(rec(s, 'release')!.end?.how).toBe('done');
    expect(s.batches[r.thing!].status).toBe('released');
    expect(modeOf(s, 'qa')).toBe('advise');
    expect(rec(s, 'ship')).toBeDefined();
  });

  test('«Пропустить» — без условия; письма после него приходят; seen — только своё', () => {
    const s = fresh();
    const out = apply(db, s, { kind: 'letter', op: 'skip', id: 'let.c1.truck' });
    expect(out).toEqual([{ kind: 'letter', id: 'let.c1.quarantine', from: 'mentor' }]);
    expect(rec(s, 'truck')!.end?.how).toBe('skip');
    expect(apply(db, s, { kind: 'letter', op: 'skip', id: 'let.c1.truck' })).toEqual([{ kind: 'refused', cmd: 'letter', why: 'letterDone', detail: 'let.c1.truck' }]);
    expect(apply(db, s, { kind: 'letter', op: 'skip', id: 'let.c1.ship' })[0]).toMatchObject({ kind: 'refused', why: 'noLetter' });
    apply(db, s, { kind: 'letter', op: 'seen', what: 'morning' });
    expect(rec(s, 'quarantine')!.end).toBeUndefined();
    apply(db, s, { kind: 'letter', op: 'read', id: 'let.c1.quarantine' });
    expect(rec(s, 'quarantine')!.read).toBe(s.t);
  });

  test('«Пропустить обучение» — все письма наставника кончились, отделы переданы, новых нет', () => {
    const s = fresh();
    apply(db, s, { kind: 'letter', op: 'skipAll' });
    expect(s.letters!.length).toBe(14);
    expect(s.letters!.every(r => r.end?.how === 'skip')).toBe(true);
    for (const h of ['wms', 'qa', 'qc', 'supply', 'plan', 'mes', 'maint'] as const) expect(modeOf(s, h)).toBe('advise');
    const out = apply(db, s, { kind: 'advance', seconds: 30 * HOUR });
    expect(out.some(n => n.kind === 'letter')).toBe(false);
  });

  test('режим, выбранный игроком, письмо не меняет', () => {
    const s = fresh();
    apply(db, s, { kind: 'mode', head: 'wms', mode: 'manual' });
    apply(db, s, { kind: 'letter', op: 'skip', id: 'let.c1.truck' });
    apply(db, s, { kind: 'letter', op: 'skip', id: 'let.c1.quarantine' });
    expect(modeOf(s, 'wms')).toBe('manual');
  });

  test('задание на серию от игрока кончает письмо о задании', () => {
    const s = fresh();
    for (const id of ['truck', 'quarantine']) apply(db, s, { kind: 'letter', op: 'skip', id: `let.c1.${id}` });
    // письма 3–6 — пропуском по цепочке
    apply(db, s, { kind: 'advance', seconds: 2 * HOUR + 1 });
    for (const id of ['release', 'ship', 'morning', 'lot']) apply(db, s, { kind: 'letter', op: 'skip', id: `let.c1.${id}` });
    expect(rec(s, 'order')!.end).toBeUndefined();
    const recipe = Object.values(s.batches).find(b => b.by === 'scenario')!.recipe;
    apply(db, s, { kind: 'order', recipe, notBefore: s.t + 2 * 24 * HOUR });
    expect(rec(s, 'order')!.end?.how).toBe('done');
    expect(modeOf(s, 'plan')).toBe('advise');
    expect(s.batches[rec(s, 'stages')!.thing!].by).toBe('player');
  });

  test('сохранение посреди обучения — те же письма после загрузки; детерминированно', () => {
    const a = fresh();
    apply(db, a, { kind: 'advance', seconds: 5 * HOUR });
    const b = fromSave(db, toSave(a));
    expect(b.letters).toEqual(a.letters);
    apply(db, a, { kind: 'advance', seconds: 20 * HOUR });
    apply(db, b, { kind: 'advance', seconds: 20 * HOUR });
    expect(toSave(b)).toBe(toSave(a));
  });
});

describe('сборщик базы: письма', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  function broken(edits: Record<string, [string, string][]>): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'pharma-content-'));
    dirs.push(dir);
    cpSync(join(import.meta.dir, '../../content'), dir, { recursive: true });
    for (const [file, e] of Object.entries(edits)) {
      const p = join(dir, file);
      let text = readFileSync(p, 'utf8');
      for (const [a, b] of e) {
        expect(text.includes(a)).toBe(true);
        text = text.replace(a, b);
      }
      writeFileSync(p, text);
    }
    return buildDb(dir).errors;
  }
  const has = (errs: string[], part: string) => expect([part, errs.some(e => e.includes(part))]).toEqual([part, true]);

  test('условие — известного вида, вещь — та, о которой условие; предшественник — того же сценария, без круга', () => {
    expect(broken({})).toEqual([]);
    has(broken({ 'letters/c1/truck.yaml': [['done: { kind: unloaded }', 'done: { kind: hatched }']] }), 'letters/c1/truck.yaml: done.kind');
    has(broken({ 'letters/c1/truck.yaml': [['shows: scenarioPo', 'shows: poLot']] }), 'условие unloaded — о вещи scenarioPo');
    has(broken({ 'letters/c1/ship.yaml': [['after: let.c1.release', 'after: let.c1.nope']] }), 'нет письма-предшественника let.c1.nope');
    has(broken({ 'letters/c1/truck.yaml': [['when: { start: true }', 'when: { after: let.c1.quarantine }']] }), 'круг писем-предшественников');
    has(broken({ 'letters/c1/ship.yaml': [['n: 4', 'n: 3']] }), 'номер 3 уже у');
    has(broken({ 'letters/c1/morning.yaml': [['done: { kind: seen, what: morning }', 'done: { kind: seen }']] }), 'what — только и всегда у seen');
    has(broken({ 'letters/c1/release.yaml': [["at: '09:00' }", "at: '09:00' }\n"], ['when: { day: 0,', 'when: { day: 40,']] }), 'после срока сценария');
  });
});

describe('образцы сохранения', () => {
  test('схема 52 — посреди обучения: письма те же, завод живёт дальше и письма кончаются по условиям', () => {
    const json = readFileSync(join(import.meta.dir, 'fixtures/save-v52.json'), 'utf8');
    const s = fromSave(db, json);
    expect(s.letters?.map(r => [r.id, r.end?.how])).toEqual([
      ['let.c1.truck', 'done'],
      ['let.c1.quarantine', 'skip'],
      ['let.c1.release', undefined],
    ]);
    expect(modeOf(s, 'wms')).toBe('advise');
    apply(db, s, { kind: 'advance', seconds: 16 * HOUR });
    expect(rec(s, 'release')!.end?.how).toBe('done');
  });
  test('схема 51 — без писем: загружается и живёт без них', () => {
    const s = fromSave(db, readFileSync(join(import.meta.dir, 'fixtures/save-v51.json'), 'utf8'));
    expect(s.letters).toBeUndefined();
    const out = apply(db, s, { kind: 'advance', seconds: 6 * HOUR });
    expect(out.some(n => n.kind === 'letter')).toBe(false);
  });
});
