// «Найти» (Б13, шаг 4; docs/specs/2026-10-vertical-slice.md, «Б13. Доступность и настройки»): вещь завода по названию или
// коду — только записи завода, без регистра, на обоих языках; первые 20.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { FIND_MAX, findView } from '../../src/sim/find';

describe('«Найти»', () => {
  const s = newPlant(db, { scenario: 'scn.proto' });
  apply(db, s, { kind: 'advance', seconds: 3 * DAY });

  test('пусто — ничего; помещение — по названию окна и коду', () => {
    expect(findView(db, s, '  ').rows).toEqual([]);
    const r = findView(db, s, 'СКЛАД', { warehouse: 'Склад' });
    expect(r.rows.some(x => x.kind === 'room' && x.code === 'warehouse')).toBe(true);
  });

  test('человек — по табельному номеру и роли на обоих языках', () => {
    const p = Object.values(s.people)[0];
    expect(findView(db, s, String(p.tab)).rows.some(x => x.kind === 'person' && x.tab === p.tab)).toBe(true);
    const role = db.roles[p.role].name;
    const en = findView(db, s, role.en ?? role.ru).rows;
    expect(en.some(x => x.kind === 'person' && x.role === p.role)).toBe(true);
  });

  test('паллета — по коду и номеру партии с буквой окна; серия — по номеру', () => {
    const u = Object.values(s.units).find(x => x.items.length > 0)!;
    expect(findView(db, s, u.id).rows.some(x => x.kind === 'unit' && x.code === u.id)).toBe(true);
    const lot = s.lots[s.containers[u.items[0]].lot];
    const code = `П-${String(lot.code.y).padStart(2, '0')}${String(lot.code.m).padStart(2, '0')}-${String(lot.code.n).padStart(4, '0')}`;
    expect(findView(db, s, code).rows.some(x => x.kind === 'unit')).toBe(true);
    const b = Object.values(s.batches)[0];
    if (b) expect(findView(db, s, 'PA').rows.some(x => x.kind === 'batch')).toBe(true);
  });

  test('много найденного — первые 20 и «ещё»', () => {
    const r = findView(db, s, 'u');
    expect(r.rows.length).toBeLessThanOrEqual(FIND_MAX);
    expect(r.more).toBe(true);
  });
});
