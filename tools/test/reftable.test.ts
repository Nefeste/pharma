// Б1в: порядок и поиск в таблицах справочника (src/ui/Ref.tsx, `pickRows`). Поиск — без учёта регистра по тексту любого
// столбца; порядок — по числу, если оно есть у столбца, иначе по алфавиту языка; в обе стороны; равные строки остаются в
// прежнем порядке; без порядка — как в виде.
import { describe, expect, test } from 'bun:test';
import { type Col, pickRows } from '../../src/ui/Ref';

interface Row {
  name: string;
  min: number;
}

const rows: Row[] = [
  { name: 'Сушка', min: 190 },
  { name: 'Отвешивание', min: 95 },
  { name: 'Опудривание', min: 25 },
  { name: 'Ёмкость', min: 25 },
  { name: 'Таблетирование', min: 163 },
];
const cols: Col<Row>[] = [
  { name: 'Стадия', text: r => r.name },
  { name: 'По карте', text: r => `${r.min} мин`, num: r => r.min },
];
const names = (list: Row[]) => list.map(r => r.name);

describe('порядок и поиск справочника', () => {
  test('без порядка и поиска — как в виде', () => {
    expect(names(pickRows(rows, cols, '', null))).toEqual(names(rows));
  });

  test('по числу — в обе стороны, равные — как были', () => {
    expect(names(pickRows(rows, cols, '', { col: 1, dir: 1 }))).toEqual(['Опудривание', 'Ёмкость', 'Отвешивание', 'Таблетирование', 'Сушка']);
    expect(names(pickRows(rows, cols, '', { col: 1, dir: -1 }))).toEqual(['Сушка', 'Таблетирование', 'Отвешивание', 'Опудривание', 'Ёмкость']);
  });

  test('по алфавиту языка: «Ё» — рядом с «Е», а не после «Я»', () => {
    expect(names(pickRows(rows, cols, '', { col: 0, dir: 1 }))).toEqual(['Ёмкость', 'Опудривание', 'Отвешивание', 'Сушка', 'Таблетирование']);
  });

  test('поиск — без учёта регистра, по любому столбцу; не нашлось — пусто', () => {
    expect(names(pickRows(rows, cols, 'ВАНИЕ', null))).toEqual(['Отвешивание', 'Опудривание', 'Таблетирование']);
    expect(names(pickRows(rows, cols, '25 мин', null))).toEqual(['Опудривание', 'Ёмкость']);
    expect(names(pickRows(rows, cols, '  сушка ', null))).toEqual(['Сушка']);
    expect(pickRows(rows, cols, 'гранул', null)).toEqual([]);
  });

  test('поиск и порядок вместе', () => {
    expect(names(pickRows(rows, cols, 'ние', { col: 1, dir: -1 }))).toEqual(['Таблетирование', 'Отвешивание', 'Опудривание']);
  });
});
