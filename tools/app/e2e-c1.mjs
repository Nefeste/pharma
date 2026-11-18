// Сценарий в браузере, часть «Сценарий 1» (Б9, шаг 1; docs/specs/2026-10-vertical-slice.md, «Б9», «Проверки Б9»):
// чистое окно без сценария в адресе — экран «Кампания»: «Цех на окраине» первым, чему учит, старт, срок и цели. «Начать»
// — экран «Кем вы будете» сценария: только директор. «Взять» — понедельник 13 сентября, 07:00 после прогрева; полоса
// «Цели», окно целей. Фура поставщика — у рампы в первый час. Снимки — tools/app/out/c1-*.png, лист —
// tools/app/out/c1.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, steps } from './e2e-build.mjs';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function c1Part({ browser, port, out, ok, fail, errors, requests, q }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  const { ctx, page } = await openGame({ browser, port, errors, requests, q, scn: null });
  const s = steps(page, { out, fail, shots, feel, prefix: 'c1' });
  await page.evaluate(() => {
    const h = () => window.__game.store.get();
    Object.assign(window.__seen, {
      seatsOf: id => h().scenario === id && !!document.querySelector('#seats'),
      goals: () => !!document.querySelector('[data-test=goals]') && !!h().goals.view,
    });
  });
  const text = sel => page.evaluate(q => document.querySelector(q)?.innerText.replace(/\s*\n\s*/g, ' · ') ?? '', sel);
  try {
    // экран «Кампания»: сценарий 1 — первым
    await page.waitForSelector('[data-test=campaign]', { timeout: 20_000 });
    const first = await page.evaluate(() => document.querySelector('[data-test=campaign-tile]')?.dataset.scenario);
    const t1 = await text('[data-test=campaign-tile][data-scenario="scn.c1"]');
    await s.shot('Экран «Кампания»');
    if (first !== 'scn.c1' || !/Сценарий 1/.test(t1) || !/Цех на окраине/.test(t1) || !/путь материала/.test(t1) || !/13 сентября 2027/.test(t1) || !/28 суток/.test(t1) || !/выпустить 12 серий/.test(t1) || !/На отлично/.test(t1)) fail(`кампания: первым ${first} — «${t1}»`);
    else ok(`кампания: «${t1}»`);
    if (await page.evaluate(() => !!document.querySelector('#seats'))) fail('экран мест открыт вместе с кампанией');

    // «Начать» — места сценария: только директор
    await s.measure('«Начать» сценарий 1', () => page.click('[data-test=campaign-tile][data-scenario="scn.c1"] [data-test=campaign-start]'), 'seatsOf', 'scn.c1', 'input');
    const can = await page.evaluate(() => [...document.querySelectorAll('[data-test=seat-tile]')].filter(b => !b.disabled).map(b => b.dataset.seat));
    if (can.join() !== 'director') fail(`места сценария 1: ${can.join(', ')}`);
    else ok('места сценария 1: только директор');
    await s.seats(['director']);

    // старт игрока — после прогрева: понедельник 13 сентября, 07:00
    const when = await s.clock();
    if (!/13 сентября 2027/.test(when) || !/07:0\d/.test(when)) fail(`старт: «${when}»`);
    else ok(`старт: «${when}»`);

    // полоса и окно целей
    await page.waitForSelector('[data-test=goals-open]', { timeout: 20_000 });
    const bar = await text('[data-test=goals-open]');
    await s.measure('«Цели»', () => page.click('[data-test=goals-open]'), 'goals', undefined, 'input');
    const g = await text('[data-test=goals]');
    const rows = await page.evaluate(() => document.querySelectorAll('[data-test=goal-row]').length);
    await s.shot('Цели сценария');
    if (!/Цели \d из 3/.test(bar) || rows !== 5 || !/выпустить 12 серий — сейчас 0/.test(g) || !/Конец срока/.test(g)) fail(`цели: «${bar}» — ${rows} строк — «${g}»`);
    else ok(`цели: «${bar}» · «${g}»`);
    await page.click('[data-test=goals] .close');

    // первый час — фура поставщика у рампы (фура сценария, 07:20)
    await page.evaluate(() => window.__game.actions.setSpeed(4));
    await page.waitForFunction(() => window.__game.view.trucks.some(t => !t.customer && !t.waste && t.docked), null, { timeout: 120_000 }).then(
      () => ok('фура поставщика — у рампы в первый час'),
      () => fail('фуры поставщика у рампы нет'),
    );
    await page.evaluate(() => window.__game.actions.setSpeed(0));
    const at = await s.clock();
    if (!/0[78]:\d\d/.test(at)) fail(`фура у рампы в ${at}`);
    else ok(`фура у рампы — ${at}`);
    await s.shot('Фура у рампы');
  } catch (e) {
    fail(`сценарий 1: ${e instanceof Error ? e.message : String(e)}`);
  }
  await ctx.close();
  ok(`Сценарий 1, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'c1.png'), fullPage: true });
  await lister.close();
  ok(`Сценарий 1: ${shots.length} снимков → ${join(out, 'c1.png')}`);
}
