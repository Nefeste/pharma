// Марка и первый экран (Б11, шаг 2; docs/specs/2026-10-vertical-slice.md): шаги загрузки — по порядку `Game.create`, каждый
// шаг ставится один раз; имя снимка кадра — по часам завода, только латиница, цифры и дефис.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shotName } from '../../src/app/savetext';
import { LOAD_STEPS } from '../../src/ui/store';

describe('первый экран', () => {
  test('шесть шагов загрузки; Game.create ставит каждый по порядку, последний — после первого кадра', () => {
    expect([...LOAD_STEPS]).toEqual(['font', 'base', 'world', 'models', 'people', 'scene']);
    const src = readFileSync(join(import.meta.dir, '../../src/app/game.ts'), 'utf8');
    const body = src.slice(src.indexOf('static async create('), src.indexOf('g.bindInput();'));
    expect([...body.matchAll(/\bstep\((\d)\)/g)].map(m => Number(m[1]))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(body.indexOf('step(6)')).toBeGreaterThan(body.indexOf('await g.firstSlice'));
  });
});

describe('снимок для себя', () => {
  test('имя — дата и время завода', () => {
    expect(shotName(2027, 9, 1, 8 * 3600)).toBe('pharma-2027-09-01-0800.png');
    expect(shotName(2027, 12, 31, 23 * 3600 + 59 * 60 + 59)).toBe('pharma-2027-12-31-2359.png');
    expect(shotName(2028, 1, 5, 65)).toMatch(/^pharma-[0-9-]+\.png$/);
  });
});
