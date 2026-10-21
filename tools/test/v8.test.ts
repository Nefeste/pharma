// Детерминизм между движками JS (docs/02-architecture.md, §4): тесты идут в Bun (JavaScriptCore), игра — в Electron
// (V8). Один и тот же завод за 90 суток должен дать один и тот же отпечаток в обоих. Прогон для V8 — сборка esbuild и
// `node`.
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { run } from './v8-run';

// сборка и два прогона по 90 суток — на загруженной машине дольше 5 с по умолчанию
test('V8 (Node) и JavaScriptCore (Bun) — один отпечаток завода за 90 суток', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'pharma-v8-')), 'v8-run.mjs');
  await build({ entryPoints: [join(import.meta.dir, 'v8-run.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent' });
  const r = Bun.spawnSync(['node', out, '90']);
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString().trim()).toBe(run(90));
}, 60_000);
