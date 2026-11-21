// Клавиши (Б13, шаг 3; docs/specs/2026-10-vertical-slice.md, «Б13. Доступность и настройки»): карта действий,
// переназначение и отказы, хранение; и вся игра с клавиатуры в панелях — всё, по чему щёлкают, берёт фокус и Enter.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS, actionOf, bind, DEFAULT_KEYS, FIXED, keepKeys, keptKeys, keyName, keysOf, KEYS_KEY, SECTIONS } from '../../src/app/keys';
import { en } from '../../src/i18n/en';
import { ru } from '../../src/i18n/ru';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('карта клавиш', () => {
  test('у каждого действия своя клавиша, ни одной из неназначаемых; раздел и слова на двух языках', () => {
    const codes = ACTIONS.map(x => x[1]);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(FIXED.has(c)).toBe(false);
    for (const [a, , sec] of ACTIONS) {
      expect(SECTIONS).toContain(sec);
      expect(ru.settings.actions[a]).toBeTruthy();
      expect((en.settings.actions as Record<string, string>)[a]).toBeTruthy();
    }
  });

  test('переназначить: свободная — да; занятая — отказ с её действием; Esc, F12, Tab, стрелки — отказ', () => {
    const r = bind(DEFAULT_KEYS, 'gantt', 'KeyY');
    expect(r.map?.gantt).toBe('KeyY');
    expect(actionOf(r.map!, 'KeyG')).toBeUndefined();
    expect(bind(DEFAULT_KEYS, 'gantt', 'KeyN').taken).toBe('now');
    for (const k of ['Escape', 'F12', 'Tab', 'ArrowUp']) expect(bind(DEFAULT_KEYS, 'gantt', k).fixed).toBe(true);
    expect(bind(DEFAULT_KEYS, 'gantt', 'KeyG').map?.gantt).toBe('KeyG');
  });

  test('хранилище: только поменянное; испорченное, чужие действия и занятые клавиши — по умолчанию', () => {
    const st = memory();
    keepKeys(st, { ...DEFAULT_KEYS, gantt: 'KeyY' });
    expect(JSON.parse(st.m.get(KEYS_KEY)!)).toEqual({ gantt: 'KeyY' });
    expect(keptKeys(st).gantt).toBe('KeyY');
    expect(keysOf('{нет')).toEqual(DEFAULT_KEYS);
    expect(keysOf(JSON.stringify({ nope: 'KeyY', gantt: 'Escape', now: 'KeyG' }))).toEqual(DEFAULT_KEYS);
    expect(keysOf(JSON.stringify({ gantt: 'KeyY', now: 'KeyG' }))).toEqual({ ...DEFAULT_KEYS, gantt: 'KeyY', now: 'KeyG' });
  });

  test('клавиша словами: буква, цифра, имя из словаря, иначе код', () => {
    expect(keyName('KeyG', ru.settings.keyNames)).toBe('G');
    expect(keyName('Digit5', ru.settings.keyNames)).toBe('5');
    expect(keyName('Space', ru.settings.keyNames)).toBe('Пробел');
    expect(keyName('F2', ru.settings.keyNames)).toBe('F2');
  });
});

describe('вся игра с клавиатуры: панели', () => {
  /** Конец тега JSX: первая `>` вне фигурных скобок. */
  const tagEnd = (s: string, i: number) => {
    let d = 0;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '{') d++;
      else if (c === '}') d--;
      else if (c === '>' && d === 0) return i;
    }
    return s.length;
  };

  test('всё, по чему щёлкают и что не кнопка, — с фокусом и Enter: `press` или tabIndex с onKeyDown', () => {
    const dir = join(import.meta.dir, '../../src/ui');
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter(x => x.endsWith('.tsx'))) {
      const s = readFileSync(join(dir, f), 'utf8');
      for (const m of s.matchAll(/<(li|tr|td|th|div|span|p|section|g|rect|circle|path|text|b|i|em|strong|ul|table)\b/g)) {
        const tag = s.slice(m.index!, tagEnd(s, m.index! + 1));
        if (!/\bonClick=/.test(tag)) continue;
        if (/\{\.\.\.press\(/.test(tag)) continue;
        if (/tabIndex=/.test(tag) && /onKeyDown=/.test(tag)) continue;
        bad.push(`${f}:${s.slice(0, m.index!).split('\n').length} <${m[1]}>`);
      }
    }
    expect(bad).toEqual([]);
  });
});
