// Архив обновления (docs/05-process.md, «Сборка для ПК»): между выпусками в сборке для Windows меняется один файл —
// resources/app.asar. Остальной корень — архив Electron той же версии байт в байт: exe без суммы asar
// (`disableAsarIntegrity` в package.json; в Electron её проверка выключена и так). Поэтому поверх установки на том же
// Electron хватит архива с одним этим файлом. Зовут после electron-builder: `npm run dist:win` и сборка по тегу.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const dir = join(root, 'release/win-unpacked');
const asar = 'resources/app.asar';
if (!existsSync(join(dir, asar))) throw new Error(`Нет ${join(dir, asar)} — сначала electron-builder --win`);
const out = join(root, `release/Farmzavod-${version}-win-x64-update.zip`);
rmSync(out, { force: true });
// путь в архиве — resources/app.asar: распаковали в папку игры с заменой — файл встал на своё место
execFileSync('zip', ['-9', '-q', '-X', out, asar], { cwd: dir, stdio: 'inherit' });
console.log(`${out}: ${(statSync(out).size / 1e6).toFixed(1)} МБ`);
