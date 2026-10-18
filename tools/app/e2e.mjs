// Сценарий в браузере (часть 0 прототипа, docs/specs/2026-10-prototype.md): Chromium без окна (Playwright, браузер из
// PLAYWRIGHT_BROWSERS_PATH) открывает dist/. Страница грузится, сцена видна, часы завода идут; ×4 двигает их на часы;
// пробел — пауза; «До утра» (клавиша 5) доходит до планёрки в 08:00 и ставит паузу. Завод из плана (2а,
// docs/specs/2026-10-view.md): переключатель стен; снимки с трёх высот камеры — участок, цех, машина — днём и ночью;
// вызовы отрисовки — в бюджете. Люди и техника (2б): в 08:00 люди смены и техника на полу. Оборудование и линия (2в):
// лампа у каждой машины и единицы оборудования плана; «1:1» — часы идут секунда в секунду; на седьмые сутки линия
// упаковывает первую серию — лампы машин горят, на лентах и в накопителях штуки; снимки дня — в этот час. Ошибок в
// консоли и запросов наружу нет. Снимки — tools/app/out/e2e*.png.
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
/** «До утра»: промотка до планёрки следующих суток. */
const untilMorning = async () => {
  const day = await page.evaluate(() => window.__game.day);
  await page.keyboard.press('Digit5');
  await page.waitForFunction(d => window.__game.day > d && !window.__game.ff, day, { timeout: 60_000 });
};

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
  await untilMorning();
  const morning = await page.evaluate(() => ({ t: window.__game.t, speed: window.__game.speed }));
  if (morning.t % 86400 !== 8 * 3600) fail(`«До утра» остановилось в ${(morning.t % 86400) / 3600} ч`);
  else if (morning.speed !== 0) fail(`после «До утра» скорость ${morning.speed}, а не пауза`);
  else ok('«До утра»: планёрка в 08:00, пауза');
  // панели обновляются 10 раз в секунду: извещение может прийти на кадр позже паузы
  const shown = await page
    .waitForFunction(() => /Планёрка/.test(document.querySelector('.top .notice')?.textContent ?? ''), null, { timeout: 2000 })
    .then(() => true, () => false);
  const notice = await page.textContent('.top .notice');
  if (!shown) fail(`извещение: ${notice}`);
  else ok(`извещение: ${notice}`);

  // люди смены и техника — на полу (2б)
  await page.waitForTimeout(300);
  const floor = await page.evaluate(() => ({ people: window.__game.stage.peopleShown, vehicles: window.__game.stage.vehiclesShown }));
  if (floor.people < 1 || floor.vehicles < 1) fail(`на полу: людей ${floor.people}, техники ${floor.vehicles}`);
  else ok(`на полу: людей ${floor.people}, техники ${floor.vehicles}`);

  // лампы (2в): у каждой единицы оборудования и машины линии плана — лампа состояния
  const lamps = await page.evaluate(() => {
    const g = window.__game;
    const plant = g.db.plants[g.db.scenarios['scn.proto'].plant];
    return { shown: g.stage.machines.lamps, want: plant.equipment.length + plant.lines.reduce((n, l) => n + l.machines.length, 0) };
  });
  const kinds = new Set(['run', 'wait', 'stop', 'fail', 'setup', 'clean', 'off']);
  if (lamps.shown.length !== lamps.want || !lamps.shown.every(l => kinds.has(l))) fail(`лампы: ${lamps.shown.join(', ')} — ждали ${lamps.want}`);
  else ok(`лампы: ${lamps.shown.length} — ${[...new Set(lamps.shown)].join(', ')}`);

  // «живое время» (2в): «1:1» — секунда в секунду. Программная отрисовка даёт несколько кадров в секунду, а шаг кадра
  // ограничен 0,1 с — поэтому часы могут отстать, но не уйти вперёд
  await page.click('[data-test=live]');
  const l0 = await gameT();
  await page.waitForTimeout(2000);
  const l1 = await gameT();
  const live = await page.evaluate(() => window.__game.speed);
  if (live !== 5 || l1 - l0 < 0 || l1 - l0 > 3) fail(`«1:1»: скорость ${live}, за 2 с прошло ${l1 - l0} игровых секунд`);
  else ok(`«1:1»: за 2 с прошло ${l1 - l0} игровых секунд`);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);

  // снимок: общий план завода
  await page.screenshot({ path: join(out, 'e2e.png') });
  ok(`снимок: ${join(out, 'e2e.png')}`);

  // переключатель стен: «вниз» — стены опущены, «срез» — по умолчанию
  const walls = await page.$$('[data-test=walls] button');
  if (walls.length !== 3) fail(`кнопок стен: ${walls.length}`);
  else {
    await walls[2].click();
    const down = await page.evaluate(() => window.__game.stage.wallMode);
    await walls[1].click();
    const cut = await page.evaluate(() => window.__game.stage.wallMode);
    if (down !== 'down' || cut !== 'cut') fail(`стены: ${down}, ${cut}`);
    else ok('стены: «вниз» и «срез»');
  }

  // первая упаковка (2в): «До утра» до седьмых суток, затем ×4 — пока через линию не пошли штуки
  for (let i = 0; i < 4; i++) await untilMorning();
  await page.keyboard.press('Digit4');
  await page.waitForFunction(() => window.__game.view.lines[0]?.machines[1]?.items > 0, null, { timeout: 120_000 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  const packing = await page.evaluate(() => {
    const g = window.__game;
    const plant = g.db.plants[g.db.scenarios['scn.proto'].plant];
    return { lamps: g.stage.machines.lamps.slice(plant.equipment.length), items: g.stage.machines.itemsShown, hour: (g.t % 86400) / 3600 };
  });
  if (packing.lamps.every(l => l === 'off') || packing.items < 1) fail(`линия: лампы ${packing.lamps.join(', ')}, штук на лентах ${packing.items}`);
  else ok(`линия в ${packing.hour.toFixed(1)} ч: лампы ${packing.lamps.join(', ')}, штук на лентах и в накопителях ${packing.items}`);

  // три высоты камеры днём и ночью (13-art.md, §17): участок, цех упаковки, блистерная машина
  const heights = [
    ['site', null],
    ['hall', { x: 39, z: 17, half: 9 }],
    ['machine', { x: 44, z: 16.5, half: 3.5 }],
  ];
  const shoot = async when => {
    for (const [name, v] of heights) {
      await page.evaluate(v => {
        const c = window.__game.stage.cam;
        if (v) {
          c.target.set(v.x, 0, v.z);
          c.half = v.half;
        } else c.overview();
      }, v);
      await page.waitForTimeout(400);
      const calls = await page.evaluate(() => window.__game.stage.calls);
      if (calls > 150) fail(`${name}, ${when}: вызовов отрисовки ${calls} — больше бюджета 150`);
      const file = join(out, `e2e-${name}-${when}.png`);
      await page.screenshot({ path: file });
      ok(`снимок ${name}, ${when}: ${calls} вызовов отрисовки`);
    }
  };
  await shoot('day');
  // ночь: ×4 до 22:00 и пауза
  await page.keyboard.press('Digit4');
  await page.waitForFunction(() => (window.__game.t % 86400) >= 22 * 3600, null, { timeout: 90_000 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await shoot('night');

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
