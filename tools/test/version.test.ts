// Номер версии живёт в package.json и package-lock.json (устав, docs/04-process.md, «Версии»): они совпадают.
import { expect, test } from 'bun:test';

test('версия в package.json и package-lock.json одна', async () => {
  const pkg = await Bun.file(new URL('../../package.json', import.meta.url)).json();
  const lock = await Bun.file(new URL('../../package-lock.json', import.meta.url)).json();
  expect(lock.version).toBe(pkg.version);
  expect(lock.packages[''].version).toBe(pkg.version);
});

// У каждой версии — её раздел в «Версиях» корневого README (docs/05-process.md, «Версии»): раздел текущей версии есть,
// разделы идут сверху вниз от новой к старой
test('в README — раздел текущей версии, разделы по порядку', async () => {
  const pkg = await Bun.file(new URL('../../package.json', import.meta.url)).json();
  const readme = await Bun.file(new URL('../../README.md', import.meta.url)).text();
  const heads = [...readme.matchAll(/^### (\d+)\.(\d+)\.(\d+) — /gm)].map(m => [Number(m[1]), Number(m[2]), Number(m[3])]);
  expect(heads.map(h => h.join('.'))).toContain(pkg.version);
  const key = (h: number[]) => h[0] * 1e6 + h[1] * 1e3 + h[2];
  for (let i = 1; i < heads.length; i++) expect(key(heads[i])).toBeLessThan(key(heads[i - 1]));
});
