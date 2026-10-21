// Эффекты React — с телом-блоком (README, 0.0.37): что вернул эффект, React зовёт при снятии как уборку. Стрелка без
// скобок возвращает значение выражения, а в Electron 44 (Chromium 152) прокрутка возвращает Promise — в 0.0.36 закрытие
// доски расследования после решения роняло всё окно. Асинхронный эффект возвращает Promise всегда.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '../..');
const dirs = ['src/app', 'src/ui'];

function files(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? files(join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) && !d.name.endsWith('.d.ts') ? [join(dir, d.name)] : [],
  );
}

/** Эффект, который может вернуть не функцию: стрелка без скобок или асинхронный. */
const BAD = /\buse(Layout|Insertion)?Effect\(\s*(async\b|\(\s*\)\s*=>(?!\s*\{))/g;

/** Строки кода с такими эффектами; строки комментариев не в счёт. */
function bad(src: string): string[] {
  const code = src
    .split('\n')
    .map(l => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l))
    .join('\n');
  return [...code.matchAll(BAD)].map(m => {
    const end = code.indexOf('\n', m.index);
    return code.slice(m.index, end < 0 ? undefined : end).trim();
  });
}

describe('эффекты React', () => {
  test('проверка видит стрелку без скобок и асинхронный эффект, а блок и функцию уборки — нет', () => {
    expect(bad("useEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), []);")).toHaveLength(1);
    expect(bad('useLayoutEffect(\n  () =>\n    el.focus(),\n  [],\n);')).toHaveLength(1);
    expect(bad('useEffect(async () => {\n  await load();\n}, []);')).toHaveLength(1);
    expect(bad('useEffect(() => {\n  ref.current?.focus();\n}, []);')).toEqual([]);
    expect(bad('useEffect(() => {\n  return store.subscribe(f);\n}, []);')).toEqual([]);
    expect(bad('// useEffect(() => x(), []) — в комментарии не в счёт')).toEqual([]);
  });

  test.each(dirs.flatMap(files))('%s: тело эффекта — блок', f => {
    expect(bad(readFileSync(join(root, f), 'utf8'))).toEqual([]);
  });
});
