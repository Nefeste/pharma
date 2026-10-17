// из bolnitsa: tools/test/i18n.test.ts @ e0a3491 — изменено: без исключения для ошибок движка «Анамнеза».
// Строки для игрока — только в src/i18n/ (устав, docs/05-rules.md): в коде оболочки, отрисовки и панелей кириллицы в
// строках нет. Комментарии не в счёт. Английские строки — того же вида, что русские (тип Strings, en.ts), — проверяет tsc.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '../..');
const dirs = ['src/app', 'src/ui', 'src/render', 'src/sim'];

function files(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? files(join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) && !d.name.endsWith('.d.ts') ? [join(dir, d.name)] : [],
  );
}

/** Код без комментариев: строки и шаблоны остаются. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let q: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (q) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      i = src.indexOf('*/', i + 2) + 2;
      if (i < 2) break;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') q = c;
    out += c;
    i++;
  }
  return out;
}

describe('строки для игрока', () => {
  test.each(dirs.flatMap(files))('%s: без кириллицы вне src/i18n', f => {
    const code = stripComments(readFileSync(join(root, f), 'utf8'));
    const lines = code.split('\n').filter(l => /[а-яё]/i.test(l) && !/console\.(log|error|warn)/.test(l));
    expect(lines).toEqual([]);
  });
});
