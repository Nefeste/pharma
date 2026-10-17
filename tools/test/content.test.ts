// База игры (tools/content/load.ts): собирается без ошибок; идентификаторы совпадают с путями; у записей с фактами —
// источник из docs/10-domain.md и отметка проверки. `checked` ставит только человек (устав, ADR 0012) — владелец, он же
// консультант (решение 17.10.2026, #10); агент пишет `draft`. Кто поставил отметку, по содержимому не проверить, поэтому
// тест требует только, чтобы отметка была.
import { describe, expect, test } from 'bun:test';
import { buildDb, sourceKeys } from '../content/load';

const { db, errors } = buildDb();

describe('база игры', () => {
  test('собирается без ошибок', () => {
    expect(errors).toEqual([]);
  });

  test('сценарий прототипа есть и ссылается на профиль ЕАЭС', () => {
    expect(db.scenarios['scn.proto']?.profile).toBe('prf.eaeu');
    expect(db.profiles['prf.eaeu']?.vat.medicines).toBe(1000);
  });

  test('ключи источников читаются из docs/10-domain.md', () => {
    const keys = sourceKeys();
    expect(keys.has('gmp-eaeu')).toBe(true);
    expect(keys.has('pallet-epal')).toBe(true);
  });

  test('у записей с фактами — отметка проверки: черновик или проверено человеком', () => {
    const all: { source?: string[]; review?: string }[] = [
      ...Object.values(db.profiles),
      ...Object.values(db.units),
      ...Object.values(db.materials),
      ...Object.values(db.products),
      ...Object.values(db.machines),
      ...Object.values(db.customers),
    ];
    const facts = all.filter(r => r.source);
    expect(facts.length).toBeGreaterThan(5);
    for (const r of facts) expect(['draft', 'checked']).toContain(r.review!);
  });
});
