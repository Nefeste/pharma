// Сценарий в браузере, часть «Сценарий 3» (Д1, шаг 3; docs/specs/2026-11-fill.md, «Д1», «Проверки Д1»): чистое окно —
// экран «Кампания»: «Три серии подряд» третьим, чему учит, старт, срок и цели — «на отлично» «повтора нет». «Начать» —
// места сценария: качество и технология или директор. «Взять» качество — понедельник 16 апреля 2029 г., 07:00 после
// прогрева; письмо начальника ООК на старте — прочли, кончилось. «До утра» — пока не придёт письмо о первом OOS:
// «Показать» — его вещь; окно лаборатории — письмо кончилось.
// Снимки — tools/app/out/c3-*.png, лист — tools/app/out/c3.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, steps } from './e2e-build.mjs';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function c3Part({ browser, port, out, ok, fail, errors, requests, q }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  const { ctx, page } = await openGame({ browser, port, errors, requests, q, scn: null });
  const s = steps(page, { out, fail, shots, feel, prefix: 'c3' });
  await page.evaluate(() => {
    const h = () => window.__game.store.get();
    Object.assign(window.__seen, {
      seatsOf: id => h().scenario === id && !!document.querySelector('#seats'),
      card: () => !!h().selected,
    });
  });
  const text = sel => page.evaluate(q => document.querySelector(q)?.innerText.replace(/\s*\n\s*/g, ' · ') ?? '', sel);
  /** «До утра», пока условие не выполнится: планёрку и карточку — закрыть, мир встал на извещении — дальше. */
  const until = async (cond, limit) => {
    for (let i = 0; i < limit; i++) {
      if (await page.evaluate(cond)) return true;
      await page.evaluate(() => {
        const g = window.__game;
        const h = g.store.get();
        if (h.morning.open) g.actions.closeMorning(false);
        if (h.selected) g.actions.select(undefined);
        g.actions.untilMorning();
      });
      await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
    }
    return page.evaluate(cond);
  };
  try {
    // экран «Кампания»: «Три серии подряд» — третьим
    await page.waitForSelector('[data-test=campaign]', { timeout: 20_000 });
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-test=campaign-tile]')].map(t => t.dataset.scenario));
    const t3 = await text('[data-test=campaign-tile][data-scenario="scn.c3"]');
    await s.shot('Экран «Кампания»');
    if (order[2] !== 'scn.c3' || !/Сценарий 3/.test(t3) || !/Три серии подряд/.test(t3) || !/входной контроль/.test(t3) || !/16 апреля 2029/.test(t3) || !/200 суток/.test(t3) || !/повтора нет 90/.test(t3)) fail(`кампания: ${order.join(', ')} — «${t3}»`);
    else ok(`кампания: «${t3}»`);

    // «Начать» — места сценария: директор и качество
    await s.measure('«Начать» сценарий 3', () => page.click('[data-test=campaign-tile][data-scenario="scn.c3"] [data-test=campaign-start]'), 'seatsOf', 'scn.c3', 'input');
    const can = await page.evaluate(() => [...document.querySelectorAll('[data-test=seat-tile]')].filter(b => !b.disabled).map(b => b.dataset.seat));
    if (can.join() !== 'director,quality') fail(`места сценария 3: ${can.join(', ')}`);
    else ok('места сценария 3: директор и качество');
    await s.seats(['quality']);
    const when = await s.clock();
    if (!/16 апреля 2029/.test(when) || !/07:0\d/.test(when)) fail(`старт: «${when}»`);
    else ok(`старт: «${when}»`);

    // письмо начальника ООК на старте — прочли, кончилось
    await page.waitForSelector('[data-test=letter][data-letter="let.c3.start"]', { timeout: 20_000 }).catch(() => undefined);
    const l1 = await text('[data-test=letter]');
    const row = await text('[data-test=letter-row][data-letter="let.c3.start"]');
    await s.shot('Письмо начальника ООК');
    const read = await page
      .waitForFunction(() => window.__game.store.get().letters.view?.rows.find(r => r.id === 'let.c3.start')?.end?.how === 'done', null, { timeout: 20_000 })
      .then(
        () => true,
        () => false,
      );
    if (!/Растворение под присмотром/.test(l1) || !/Начальник ООК/.test(row) || !read) fail(`письмо на старте: «${l1}», «${row}», кончилось — ${read}`);
    else ok(`письмо начальника ООК прочли — кончилось: «${l1.slice(0, 120)}…»`);
    await page.click('[data-test=letters] .close');

    // «До утра» — пока не придёт письмо о первом OOS; «Показать» — его вещь; окно лаборатории — письмо кончилось
    const oos = await until(() => !!window.__game.store.get().letters.view?.rows.some(r => r.id === 'let.c3.oos'), 90);
    if (!oos) fail(`письма о первом OOS нет: ${await s.clock()}`);
    else {
      await page.evaluate(() => window.__game.actions.setSpeed(0));
      await page.evaluate(() => {
        const g = window.__game;
        if (!g.store.get().letters.open) g.actions.toggleLetters();
        g.actions.readLetter('let.c3.oos');
      });
      await page.waitForSelector('[data-test=letter][data-letter="let.c3.oos"]', { timeout: 20_000 });
      const t = await text('[data-test=letter]');
      const clock = await s.clock();
      await s.shot('Письмо о первом OOS');
      // «Показать» — действием окна: кнопку может закрыть окно, открытое автопаузой (доска расследования)
      await page.evaluate(() => {
        const g = window.__game;
        const go = g.store.get().letters.view?.rows.find(r => r.id === 'let.c3.oos')?.go;
        if (go) g.actions.showLetter(go);
      });
      const shown = await page.evaluate(() => window.__game.selected?.kind ?? '');
      await s.shot('Вещь письма');
      if (shown !== 'dev') fail(`«Показать» — вещь письма: «${shown}»`);
      await page.evaluate(() => window.__game.actions.select(undefined));
      await page.evaluate(() => window.__game.actions.toggleLab());
      const done = await page
        .waitForFunction(() => window.__game.store.get().letters.view?.rows.find(r => r.id === 'let.c3.oos')?.end?.how === 'done', null, { timeout: 20_000 })
        .then(
          () => true,
          () => false,
        );
      await s.shot('Лаборатория');
      if (!/Опять растворение/.test(t) || !/Растворение вне спецификации/.test(t) || !done) fail(`первое OOS: ${clock} — «${t}», кончилось — ${done}`);
      else ok(`${clock} — письмо о первом OOS, «Показать» открыло его вещь, окно лаборатории — письмо кончилось`);
    }
  } catch (e) {
    fail(`сценарий 3: ${e instanceof Error ? e.message : String(e)}`);
  }
  await ctx.close();
  ok(`Сценарий 3, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'c3.png'), fullPage: true });
  await lister.close();
  ok(`Сценарий 3: ${shots.length} снимков → ${join(out, 'c3.png')}`);
}
