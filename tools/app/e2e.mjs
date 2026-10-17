// Сценарий в браузере (часть 0 прототипа, docs/specs/2026-10-prototype.md): Chromium без окна (Playwright, браузер из
// PLAYWRIGHT_BROWSERS_PATH) открывает dist/. Страница грузится, сцена видна, часы завода идут; ×4 двигает их на часы;
// пробел — пауза; «До утра» (клавиша 5) доходит до планёрки в 08:00 и ставит паузу. Ошибок в консоли и запросов наружу
// нет. Снимок — tools/app/out/e2e.png.
//   node tools/app/e2e.mjs [--q low|medium|high] [--headed]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { findChromium } from './e2e-lib.mjs';
import { serve } from './serve.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};

const out = new URL('./out/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const port = 8094;
const server = await serve(port);
const browser = await chromium.launch({
  executablePath: findChromium(),
  headless: !process.argv.includes('--headed'),
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const requests = [];
page.on('console', m => {
  if (m.type() === 'error') errors.push(m.text());
  if (m.type() === 'error' || m.type() === 'warning') console.log(`  ${m.type()}: ${m.text().slice(0, 300)}`);
});
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => {
  const u = r.url();
  if (!u.startsWith(`http://127.0.0.1:${port}/`) && !u.startsWith('data:') && !u.startsWith('blob:')) requests.push(u);
});
const fail = msg => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};
const ok = msg => console.log(`✓ ${msg}`);
/** Часы завода в игровых секундах — из игры, а не из текста полосы: текст обновляется 10 раз в секунду. */
const gameT = () => page.evaluate(() => window.__game.t + window.__game.lag);

try {
  await page.goto(`http://127.0.0.1:${port}/index.html?q=${arg('q', 'low')}&lang=ru`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  ok('страница загружена, первый кадр нарисован');

  const clock = await page.textContent('[data-test=clock]');
  const date = await page.textContent('[data-test=date]');
  if (!/^0[78]:\d\d$/.test(clock ?? '')) fail(`часы в начале: ${clock}`);
  else ok(`часы: ${clock}, ${date}`);

  // ×4 — два часа в секунду. Программная отрисовка без видеокарты даёт несколько кадров в секунду, а шаг кадра ограничен
  // 0,1 с — поэтому проверка мягкая: больше, чем ×2 смог бы и при 60 к/с (5 минут в секунду)
  await page.keyboard.press('Digit4');
  const t0 = await gameT();
  await page.waitForTimeout(1500);
  const t1 = await gameT();
  const speed = await page.evaluate(() => window.__game.speed);
  if (speed !== 4 || t1 - t0 < 1200) fail(`×4: скорость ${speed}, за 1,5 с прошло ${t1 - t0} игровых секунд`);
  else ok(`×4: за 1,5 с прошло ${Math.round((t1 - t0) / 60)} игровых минут`);

  // пробел — пауза
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  const p0 = await gameT();
  await page.waitForTimeout(700);
  const p1 = await gameT();
  if (p1 !== p0) fail(`пауза: часы шли (${p1 - p0} с)`);
  else ok('пауза: часы стоят');

  // «До утра» — до планёрки в 08:00 и пауза
  const dayBefore = await page.evaluate(() => window.__game.day);
  await page.keyboard.press('Digit5');
  await page.waitForFunction(d => window.__game.day > d && !window.__game.ff, dayBefore, { timeout: 30_000 });
  const morning = await page.evaluate(() => ({ t: window.__game.t, speed: window.__game.speed }));
  if (morning.t % 86400 !== 8 * 3600) fail(`«До утра» остановилось в ${(morning.t % 86400) / 3600} ч`);
  else if (morning.speed !== 0) fail(`после «До утра» скорость ${morning.speed}, а не пауза`);
  else ok('«До утра»: планёрка в 08:00, пауза');
  const notice = await page.textContent('.top .notice');
  if (!/Планёрка/.test(notice ?? '')) fail(`извещение: ${notice}`);
  else ok(`извещение: ${notice}`);

  // снимок: общий план склада
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, 'e2e.png') });
  ok(`снимок: ${join(out, 'e2e.png')}`);

  if (errors.length) fail(`ошибки в консоли: ${errors.join(' | ')}`);
  else ok('ошибок в консоли нет');
  if (requests.length) fail(`запросы наружу: ${requests.join(', ')}`);
  else ok('запросов наружу нет');
} catch (e) {
  fail(e instanceof Error ? e.stack ?? e.message : String(e));
} finally {
  await browser.close();
  server.close();
}
