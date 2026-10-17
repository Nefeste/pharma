// База игры (tools/content/load.ts): собирается без ошибок; идентификаторы совпадают с путями; у записей с фактами —
// источник из docs/10-domain.md и review; агент `checked` не ставит (устав, ADR 0012).
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

  test('записи с фактами — черновики, пока их не проверил человек', () => {
    const facts = [...Object.values(db.profiles), ...Object.values(db.units).filter(u => u.source)];
    for (const r of facts) expect(r.review).toBe('draft');
  });
});
