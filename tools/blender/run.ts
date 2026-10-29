// Сборка моделей и запечки в Blender (#109; blender/README.md): сцена — из базы и кода раскладки (scene.ts), скрипты
// blender/ — в фоновом режиме, готовые файлы — в assets/models с паспортом (sources.json: скрипт, SHA-256 скриптов, доля
// сцены, версия Blender, SHA-256 файла) и списком для окна (index.json). Долгая работа — локально, не в CI (устав,
// docs/04-process.md); тест сверяет файлы с паспортом и паспорт — с базой (tools/test/blender.test.ts).
//   npm run models                — собрать и записать в assets/models
//   npm run models -- --check     — собрать дважды во временные папки и сравнить SHA-256 между собой и с паспортом,
//                                   ничего не записывая
//   npm run models -- --blend     — ещё и .blend сцен — в tools/blender/out (посмотреть в Blender; в репозиторий не идут)
// Blender — из переменной BLENDER, иначе `blender` из PATH; версия должна быть `BLENDER` из scene.ts.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { db } from '../../src/content';
import { ART_INDEX, BLENDER, BUILD, inputHash, OUTPUTS, scriptsHash, sceneOf, sha256 } from './scene';

const root = join(import.meta.dir, '../..');
const out = join(root, 'tools/blender/out');
const models = join(root, 'assets/models');
const bin = process.env.BLENDER ?? 'blender';
const check = process.argv.includes('--check');
const blend = process.argv.includes('--blend');

const version = spawnSync(bin, ['--version'], { encoding: 'utf8' });
if (version.status !== 0) throw new Error(`Blender не запустился (${bin}): ${version.stderr || version.error}`);
const line = version.stdout.split('\n')[0].trim();
if (!line.startsWith(`Blender ${BLENDER}`)) throw new Error(`${line}, а модели собираются на Blender ${BLENDER} (blender/README.md)`);
const hash = version.stdout.match(/build hash: ([0-9a-f]+)/)?.[1];
const blenderLabel = `${line}${hash ? ` (${hash})` : ''}`;

mkdirSync(out, { recursive: true });
const scene = sceneOf(db);
const scenePath = join(out, 'scene.json');
writeFileSync(scenePath, JSON.stringify(scene));

/** Один прогон всех скриптов в папку `dir`; файлы — по путям assets/models. */
function build(dir: string) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'machines'), { recursive: true });
  mkdirSync(join(dir, 'rooms'), { recursive: true });
  const run = (script: string, args: string[]) => {
    const t = Date.now();
    const r = spawnSync(bin, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', join(root, script), '--', '--scene', scenePath, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status !== 0) throw new Error(`${script}: код ${r.status}\n${r.stdout.slice(-3000)}\n${r.stderr.slice(-3000)}`);
    console.log(`${script} ${args.join(' ')} — ${((Date.now() - t) / 1000).toFixed(0)} с`);
  };
  for (const t of BUILD.machines) {
    const glb = join(dir, ART_INDEX.machines[t]);
    run('blender/press.py', ['--machine', t, '--work', dir, '--out', glb, ...(blend ? ['--blend', join(out, `${t}.blend`)] : [])]);
  }
  for (const id of BUILD.rooms) run('blender/room.py', ['--room', id, '--out', join(dir, 'rooms'), ...(blend ? ['--blend', join(out, `${id}.blend`)] : [])]);
  return Object.fromEntries(OUTPUTS.map(o => [o.path, sha256(readFileSync(join(dir, o.path)))]));
}

if (check) {
  const passport = JSON.parse(readFileSync(join(models, 'sources.json'), 'utf8')) as Record<string, { out?: string }>;
  const a = build(join(out, 'check-a'));
  const b = build(join(out, 'check-b'));
  let same = true;
  for (const o of OUTPUTS) {
    const ok = a[o.path] === b[o.path];
    // и тот же файл, что лежит в assets/models: паспорт — его SHA-256
    const kept = passport[o.path]?.out === a[o.path];
    same &&= ok && kept;
    console.log(`${ok ? 'байт в байт' : 'РАЗНЫЕ'}, ${kept ? 'как в паспорте' : 'НЕ как в паспорте'}  ${o.path}  ${a[o.path]}${ok ? '' : ` / ${b[o.path]}`}`);
  }
  process.exit(same ? 0 : 1);
}

const dir = join(out, 'build');
const got = build(dir);
const sources = JSON.parse(readFileSync(join(models, 'sources.json'), 'utf8')) as Record<string, unknown>;
const read = (p: string) => readFileSync(join(root, p));
for (const o of OUTPUTS) {
  mkdirSync(dirname(join(models, o.path)), { recursive: true });
  copyFileSync(join(dir, o.path), join(models, o.path));
  sources[o.path] = { source: o.script, sha256: scriptsHash(o, read), input: inputHash(scene, o), blender: blenderLabel, out: got[o.path] };
  console.log(`${o.path}  ${got[o.path]}`);
}
writeFileSync(join(models, 'sources.json'), JSON.stringify(sources, null, 1));
const index = JSON.parse(readFileSync(join(models, 'index.json'), 'utf8')) as Record<string, unknown>;
writeFileSync(join(models, 'index.json'), JSON.stringify({ ...index, ...ART_INDEX }, null, 1));
console.log('assets/models: sources.json и index.json обновлены');
