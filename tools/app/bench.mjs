// из bolnitsa: tools/app/bench.mjs @ e0a3491 — изменено: сцена завода (docs/specs/2026-10-view.md, 2г); в сводке — паллеты,
// люди и техника, время рисования на процессоре.
// Авто-бенч в Chromium без окна (Playwright): пресеты качества × общий план и крупный план, потом 4 снимка 1920×1080.
// Итог — JSON того же вида, что у бенча в Electron (`electron . --bench`), и PNG.
//   node tools/app/bench.mjs [--secs 15] [--warm 3] [--capped] [--qualities low,high] [--shots 0]
//                            [--out tools/app/out/имя] [--size 1280x720] [--layer load] [--art code]
// --layer load — со слоем «Загрузка и OEE» (Б1и): тот же замер с ним. --art code — машины кодом, без моделей из
// Blender (#109): тот же замер для сравнения.
// --capped — с вертикальной синхронизацией; без него — без неё (видно запас). Программный WebGL (SwiftShader): числа
// говорят о процессоре контейнера, не о видеокарте игрока.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { findChromium } from './e2e-lib.mjs';
import { serve } from './serve.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const flag = k => process.argv.includes(`--${k}`);

const secs = Number(arg('secs', 15));
const warm = Number(arg('warm', 3));
const qualities = arg('qualities', 'low,medium,high');
const shots = arg('shots', '1') !== '0';
const layer = arg('layer', '') === 'load' ? '&layer=load' : '';
const art = arg('art', '') === 'code' ? '&art=code' : '';
const capped = flag('capped');
const [vw, vh] = arg('size', '1280x720').split('x').map(Number);
const port = 8094;
const server = await serve(port);
const args = ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
if (!capped) args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
const browser = await chromium.launch({ executablePath: findChromium(), headless: !flag('headed'), args });
const version = browser.version();
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const errors = [];
page.on('console', m => {
  const t = m.text();
  if (t.startsWith('[bench]') || m.type() === 'error' || m.type() === 'warning') console.log(`  ${m.type()}: ${t.slice(0, 400)}`);
  if (m.type() === 'error') errors.push(t);
});
page.on('pageerror', e => {
  console.log(`  pageerror ${e.message}`);
  errors.push(e.message);
});
const url = `http://127.0.0.1:${port}/index.html?bench=1&secs=${secs}&warm=${warm}&qualities=${qualities}&shots=${shots ? 1 : 0}&lang=ru${layer}${art}`;
console.log(`→ ${url}`);
const tStart = Date.now();
await page.goto(url);
// загрузка, промотка до часа упаковки (шесть суток — в программном WebGL минуты), по два прохода на пресет; снимки в
// программном WebGL на высоком пресете — по минуте и больше
const total = (secs + warm + 10) * 2 * qualities.split(',').length * 1000 + 2700000;
// раз в 20 с — строка состояния страницы (видно, на чём бенч, если он завис)
const ticker = setInterval(() => {
  page
    .evaluate(() => document.getElementById('status')?.textContent ?? '')
    .then(t => t && console.log(`  … ${t}`))
    .catch(() => {});
}, 20000);
await page.waitForFunction(() => window.__benchResult || window.__benchError, null, { timeout: total, polling: 1000 });
clearInterval(ticker);
const err = await page.evaluate(() => window.__benchError);
if (err) throw new Error(err);
const shotList = await page.evaluate(() => window.__shots ?? []);
const res = await page.evaluate(() => window.__benchResult);
await browser.close();
server.close();
const out = new URL('./out/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const base = arg('out', `${out}bench-headless-${capped ? 'vsync' : 'uncapped'}`);
for (const s of shotList) {
  const name = `${base}-${s.name.replace(/^(bench|shot)-[^-]*(-\d{4}-\d\d-\d\dT[\d-]+)?-/, '')}`;
  writeFileSync(name, Buffer.from(s.dataUrl.split(',')[1], 'base64'));
  console.log(`снимок → ${name}`);
}
res.headless = { browser: version, args, capped, wallMs: Date.now() - tStart, consoleErrors: errors };
writeFileSync(`${base}.json`, `${JSON.stringify(res, null, 2)}\n`);
console.log(`\nChromium ${version}${capped ? ', vsync' : ', без vsync'}`);
console.log('качество  план      паллет людей техн.  к/с    кадр ср/p95, мс    CPU ср/p95, мс   GPU ср, мс  вызовов  треуг.');
for (const r of res.runs) {
  const gpu = r.gpuMs ? String(r.gpuMs.mean) : '—';
  console.log(
    `${r.quality.padEnd(8)}  ${r.camera.padEnd(8)} ${String(r.pallets).padStart(6)} ${String(r.people).padStart(5)} ${String(r.vehicles).padStart(5)} ${String(r.fps).padStart(6)}   ${`${r.frameMs.mean} / ${r.frameMs.p95}`.padEnd(18)} ${`${r.drawCpuMs.mean} / ${r.drawCpuMs.p95}`.padEnd(16)} ${gpu.padStart(10)}  ${String(r.drawCalls).padStart(6)}  ${r.triangles}`,
  );
}
console.log(`→ ${base}.json`);
console.log(`ошибок в консоли: ${errors.length}`);
