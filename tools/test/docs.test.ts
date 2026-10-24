// Коды и документы (Б3а; docs/specs/2026-10-vertical-slice.md, «Проверки Б3а»): у материалов — внутренний код по виду,
// у документов — шапка; сборщик базы ловит пропущенный, повторённый и не по формату код, документ без утвердившего,
// редакции одного кода с одним днём и то, что на начало сценария не действует. Статус редакции — по дате завода; задание
// на серию берёт карту, действующую на его «не раньше», и держит её; испытание помнит редакцию спецификации, действовавшей
// при отборе пробы.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import type { ContentDb, Recipe, Spec } from '../../src/content/types';
import { DAY, daysFromCivil, momentOf } from '../../src/engine/core/calendar';
import { inForce, revisions, statusOf } from '../../src/engine/docs';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import type { Batch, PlantState } from '../../src/engine/types';
import { buildDb } from '../content/load';

const SC = 'scn.proto';
const start = daysFromCivil(db.scenarios[SC].start.date);
const V1 = 'rcp.paracetamol500.wet.v1';
const V2 = 'rcp.paracetamol500.wet.v2';
const BULK = 'spec.bulk.paracetamol500';

describe('коды и шапки в базе', () => {
  test('у каждого материала и запчасти — свой код из шести цифр, первая — вид', () => {
    const kinds = { api: '1', excipient: '2', packaging: '3', bulk: '4', fg: '5' } as const;
    const all = [...Object.values(db.materials).map(m => [m.code, kinds[m.kind]]), ...Object.values(db.spares).map(sp => [sp.code, '6'])];
    for (const [code, first] of all) expect(code).toMatch(new RegExp(`^${first}\\d{5}$`));
    expect(new Set(all.map(([c]) => c)).size).toBe(all.length);
    expect(db.materials['mat.api.paracetamol'].code).toBe('100001');
  });

  test('у спецификаций, методик, карт и позиций — шапка: код по виду, редакция, день введения, утвердил по должности', () => {
    const cases = [
      [db.specs, 'SP', 'role.qc-head'],
      [db.tests, 'TM', 'role.qc-head'],
      [db.recipes, 'MF', 'role.production-head'],
      [db.skus, 'PI', 'role.production-head'],
    ] as const;
    for (const [records, kind, who] of cases)
      for (const r of Object.values(records)) {
        expect(r.doc.code).toMatch(new RegExp(`^${kind}-\\d{4}$`));
        expect(r.doc.rev).toBe(1);
        expect(r.doc.from).toBeLessThanOrEqual(start);
        expect(r.doc.approved).toBe(who);
      }
    // в базе прототипа у каждого документа одна редакция, введённая до начала сценария
    expect(db.recipes[V1].doc).toEqual({ code: 'MF-0001', rev: 1, from: daysFromCivil({ y: 2026, m: 3, d: 2 }), approved: 'role.production-head' });
    expect(db.roles['role.production-head'].dept).toBe('mes');
    expect(db.products['prd.paracetamol500'].strength).toBe(500);
    expect(db.profiles['prf.eaeu'].okei).toEqual({ mg: 161, g: 163, kg: 166, pcs: 796, pack: 778 });
  });
});

describe('сборщик базы — на испорченной копии content/', () => {
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
  const rcp = readFileSync(join(import.meta.dir, '../../content/recipes/paracetamol500.wet.v1.yaml'), 'utf8').replace('id: rcp.paracetamol500.wet.v1', 'id: rcp.paracetamol500.wet.v2');

  test('целая база — без ошибок', () => {
    expect(broken({})).toEqual([]);
  });

  test('код материала: пропущен, повторён, не по формату, первая цифра не вида', () => {
    has(broken({ 'materials/exc/mcc.yaml': [['code: 200003\n', '']] }), 'materials/exc/mcc.yaml: code:');
    has(broken({ 'materials/exc/mcc.yaml': [['code: 200003', 'code: 200001']] }), 'mat.exc.starch: код 200001 уже у mat.exc.mcc');
    has(broken({ 'materials/exc/mcc.yaml': [['code: 200003', 'code: 20003']] }), 'внутренний код — шесть цифр');
    has(broken({ 'materials/exc/mcc.yaml': [['code: 200003', 'code: 300099']] }), 'mat.exc.mcc: код 300099 — первая цифра у вида excipient — 2');
    has(broken({ 'spares/punches.yaml': [['code: 600001', 'code: 100001']] }), 'код 100001 уже у');
  });

  test('шапка документа: код не по формату, без утвердившего, утвердил не роль базы, даты нет в календаре', () => {
    has(broken({ 'specs/mat/exc/mcc.yaml': [['code: SP-0004', 'code: SP-04']] }), 'код документа — SP-NNNN');
    has(broken({ 'tests/lod.yaml': [['code: TM-0003', 'code: SP-0003']] }), 'код документа — TM-NNNN');
    has(broken({ 'specs/mat/exc/mcc.yaml': [[', approved: role.qc-head', '']] }), 'specs/mat/exc/mcc.yaml: doc.approved:');
    has(broken({ 'specs/mat/exc/mcc.yaml': [['rev: 1, ', '']] }), 'specs/mat/exc/mcc.yaml: doc.rev:');
    has(broken({ 'skus/paracetamol500/n10.yaml': [['approved: role.production-head', 'approved: role.nobody']] }), 'утвердил role.nobody — нет такой роли');
    has(broken({ 'specs/mat/exc/mcc.yaml': [['from: 2026-02-02', 'from: 2026-02-30']] }), 'даты 2026-02-30 нет в календаре');
  });

  test('редакции одного кода: один день введения, номер не растёт с днём, разные продукты; инструкция по упаковке — одна на позицию', () => {
    has(broken({ 'recipes/paracetamol500.wet.v2.yaml': rcp.replace('rev: 1,', 'rev: 2,') }), 'документ MF-0001: у редакций rcp.paracetamol500.wet.v1, rcp.paracetamol500.wet.v2 один день введения');
    has(broken({ 'recipes/paracetamol500.wet.v2.yaml': rcp.replace('from: 2026-03-02', 'from: 2026-05-04') }), 'документ MF-0001: у редакций');
    has(broken({ 'recipes/paracetamol500.wet.v2.yaml': rcp.replace('rev: 1, from: 2026-03-02', 'rev: 2, from: 2025-12-01') }), 'документ MF-0001: редакция 1 (rcp.paracetamol500.wet.v1) введена позже редакции 2');
    const lor = readFileSync(join(import.meta.dir, '../../content/recipes/loratadine10.wet.v1.yaml'), 'utf8');
    has(broken({ 'recipes/loratadine10.wet.v2.yaml': lor.replace('id: rcp.loratadine10.wet.v1', 'id: rcp.loratadine10.wet.v2').replace('MF-0002, rev: 1, from: 2027-04-01', 'MF-0001, rev: 2, from: 2027-05-03') }), 'карта MF-0001: редакции');
    has(broken({ 'skus/paracetamol500/n10.yaml': [['code: PI-0002', 'code: PI-0001']] }), 'инструкция по упаковке PI-0001: одна у позиций');
    // следующая редакция с днём позже — не ошибка: в любой день действует одна
    expect(broken({ 'recipes/paracetamol500.wet.v2.yaml': rcp.replace('rev: 1, from: 2026-03-02', 'rev: 2, from: 2027-09-20') })).toEqual([]);
  });

  test('на начало сценария не действует: спецификация материала, карта задания, инструкция по упаковке позиции', () => {
    has(broken({ 'specs/mat/exc/mcc.yaml': [['from: 2026-02-02', 'from: 2027-10-01']] }), 'у материала mat.exc.mcc на 2027-09-01 нет действующей спецификации');
    has(broken({ 'recipes/paracetamol500.wet.v1.yaml': [['from: 2026-03-02', 'from: 2027-09-02']] }), 'у карты rcp.paracetamol500.wet.v1 на 2027-09-01 нет действующей редакции');
    has(broken({ 'skus/loratadine10/n30.yaml': [['from: 2027-04-01', 'from: 2027-12-01']] }), 'инструкция по упаковке позиции sku.loratadine10.n30 на 2027-09-01 ещё не действует');
  });
});

/** База с ред. 2 карты парацетамола: вводится через `after` суток после начала сценария; подготовка отвешивания дольше. */
function withRecipe2(after: number): ContentDb {
  const r1 = db.recipes[V1];
  const r2: Recipe = { ...structuredClone(r1), id: V2, doc: { ...r1.doc, rev: 2, from: start + after } };
  r2.stages[0].time.setup += 600;
  return { ...db, recipes: { ...db.recipes, [V2]: r2 } };
}

/** База с ред. 2 спецификации балка парацетамола с `after` суток: потеря в массе при высушивании — до 2,5 %, а не 2 %. */
function withSpec2(after: number): ContentDb {
  const s1 = db.specs[BULK];
  const s2: Spec = { ...structuredClone(s1), id: `${BULK}.r2`, doc: { ...s1.doc, rev: 2, from: start + after } };
  s2.tests.find(l => l.test === 'test.lod')!.max = 250;
  return { ...db, specs: { ...db.specs, [s2.id]: s2 } };
}

describe('редакции по дате завода', () => {
  test('статус: проект до дня введения; действует, пока не введена следующая; потом — в архиве; ссылка — на код', () => {
    const d = withRecipe2(10);
    expect(revisions(d, 'recipes', V2)).toEqual([V1, V2]);
    expect([statusOf(d, 'recipes', V1, start + 9), statusOf(d, 'recipes', V2, start + 9)]).toEqual(['active', 'draft']);
    expect([statusOf(d, 'recipes', V1, start + 10), statusOf(d, 'recipes', V2, start + 10)]).toEqual(['archive', 'active']);
    expect([inForce(d, 'recipes', V2, start + 9), inForce(d, 'recipes', V1, start + 10)]).toEqual([V1, V2]);
    // до первой редакции — первая, но она ещё проект
    expect([inForce(d, 'recipes', V2, d.recipes[V1].doc.from - 1), statusOf(d, 'recipes', V1, d.recipes[V1].doc.from - 1)]).toEqual([V1, 'draft']);
    expect(statusOf(db, 'recipes', V1, start)).toBe('active');
  });

  test('задание на серию берёт карту, действующую на его «не раньше», — по любой редакции; начатая серия остаётся на своей', () => {
    const plant = (d: ContentDb) => {
      const s = newPlant(d, { scenario: SC, seed: 3 });
      const order = (recipe: string, day: number) => {
        const before = new Set(Object.keys(s.batches));
        apply(d, s, { kind: 'order', recipe, notBefore: day * DAY + 7 * 3600 });
        return Object.values(s.batches).find(b => !before.has(b.id))!.recipe;
      };
      return { s, took: [order(V1, 5), order(V2, 5), order(V1, 12)] };
    };
    // серия парацетамола начата до дня `after` и доделывается в него или позже
    const spans = (s: PlantState, b: Batch, after: number) =>
      b.product === 'prd.paracetamol500' && b.records.some(r => momentOf(s.start, r.start).day < start + after) && b.records.some(r => momentOf(s.start, r.end).day >= start + after);
    // день ред. 2 — когда такая серия есть: по тому же заводу, где ред. 2 ещё не действует, — до её дня он живёт так же
    const d0 = withRecipe2(365);
    const base = plant(d0).s;
    apply(d0, base, { kind: 'advance', seconds: 12 * DAY });
    const after = [6, 7, 8, 9, 10, 11, 12].find(a => Object.values(base.batches).some(b => spans(base, b, a)))!;
    const d = withRecipe2(after);
    const { s, took: first } = plant(d);
    expect(first).toEqual([V1, V1, V2]);
    // карта, взятая заданием, — до конца: у карты парацетамола — редакция на день «не раньше», и она не меняется
    const took = new Map<string, string>();
    const end = s.t + 30 * DAY;
    while (s.t < end) {
      apply(d, s, { kind: 'advance', seconds: 6 * 3600 });
      for (const b of Object.values(s.batches)) {
        if (!took.has(b.id)) took.set(b.id, b.recipe);
        expect(b.recipe).toBe(took.get(b.id)!);
        if (b.product === 'prd.paracetamol500') expect(b.recipe).toBe(inForce(d, 'recipes', V1, momentOf(s.start, b.notBefore).day));
      }
    }
    // серия, начатая до ред. 2, доделана по ред. 1; задания коллеги планирования на сроки после — по ред. 2
    const old = Object.values(s.batches).filter(b => spans(s, b, after));
    expect(old.length > 0 && old.every(b => b.recipe === V1)).toBe(true);
    expect(Object.values(s.batches).some(b => b.by === 'head:plan' && b.recipe === V2 && b.records.length > 0)).toBe(true);
    expect(check(d, s)).toEqual([]);
  }, 60_000);

  test('испытание помнит редакцию спецификации, действовавшей при отборе пробы, и её пределы', () => {
    const run = (d: ContentDb, days: number): PlantState => {
      const s = newPlant(d, { scenario: SC, seed: 5 });
      apply(d, s, { kind: 'advance', seconds: days * DAY });
      return s;
    };
    // день, когда отобрали пробы первой серии, — по той же партии без второй редакции
    const bulk = (s: PlantState) => Object.values(s.samples).filter(sm => s.lots[sm.lot].material === 'mat.bulk.paracetamol500' && sm.taken !== undefined);
    const base = run(db, 20);
    const first = Math.min(...bulk(base).map(sm => momentOf(base.start, sm.taken!).day));
    const d = withSpec2(first - start + 1);
    const s = run(d, 20);
    const seen = new Set<string>();
    for (const sm of bulk(s)) {
      const want = inForce(d, 'specs', BULK, momentOf(s.start, sm.taken!).day);
      for (const id of sm.tests) {
        const q = s.tests[id];
        expect(q.spec).toBe(want);
        const line = d.specs[want].tests.find(l => l.test === q.method)!;
        expect([q.min, q.max]).toEqual([line.min, line.max]);
        seen.add(want);
      }
    }
    expect([...seen].sort()).toEqual([BULK, `${BULK}.r2`]);
  }, 60_000);
});
