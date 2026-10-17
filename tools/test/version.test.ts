// Номер версии живёт в package.json и package-lock.json (устав, docs/04-process.md, «Версии»): они совпадают.
import { expect, test } from 'bun:test';

test('версия в package.json и package-lock.json одна', async () => {
  const pkg = await Bun.file(new URL('../../package.json', import.meta.url)).json();
  const lock = await Bun.file(new URL('../../package-lock.json', import.meta.url)).json();
  expect(lock.version).toBe(pkg.version);
  expect(lock.packages[''].version).toBe(pkg.version);
});
