// из bolnitsa: tools/app/build.mjs @ e0a3491 — изменено: база завода рядом; поток прогона плана (часть 5).
// Сборка страницы игры в dist/: esbuild — страница (src/app/main.tsx → app.js), поток расчёта (src/sim/worker.ts →
// sim.js) и поток прогона плана (src/sim/planWorker.ts → plan.js), index.html, собранная база (content.json), модели
// людей и их лицензии (assets/). Сеть не нужна ни при запуске, ни при работе: всё лежит локально.
import { build } from 'esbuild';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const out = join(root, 'dist');
const bundle = join(root, 'src/content/generated/bundle.json');
if (!existsSync(bundle)) throw new Error('Нет src/content/generated/bundle.json — сначала npm run content');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const dev = process.argv.includes('--dev');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const common = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome130',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  logLevel: 'info',
  define: { __VERSION__: JSON.stringify(version), 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
};
await build({ ...common, entryPoints: [join(root, 'src/app/main.tsx')], outfile: join(out, 'app.js'), jsx: 'automatic' });
await build({ ...common, entryPoints: [join(root, 'src/sim/worker.ts')], outfile: join(out, 'sim.js') });
// поток прогона плана (часть 5): тот же движок, свой поток — игра не замирает, пока он считает
await build({ ...common, entryPoints: [join(root, 'src/sim/planWorker.ts')], outfile: join(out, 'plan.js') });
copyFileSync(join(root, 'app/index.html'), join(out, 'index.html'));
copyFileSync(bundle, join(out, 'content.json'));
cpSync(join(root, 'assets/models'), join(out, 'assets/models'), { recursive: true });
copyFileSync(join(root, 'assets/LICENSES.md'), join(out, 'LICENSES.md'));
console.log(`dist/ — версия ${version}`);
