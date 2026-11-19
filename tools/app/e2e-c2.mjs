// Сценарий в браузере, часть «Сценарий 2» (Б9, шаг 3; docs/specs/2026-10-vertical-slice.md, «Б9», «Проверки Б9»):
// чистое окно — экран «Кампания»: «Первая зима» вторым, чему учит, старт, срок и цели с 1 ноября. «Начать» — места
// сценария: директор и производство. «Взять» — понедельник 7 августа 2028 г., 07:00 после прогрева; панель писем — на
// письме дистрибьютора о сезоне, без «Пропустить»; прочли — письмо кончилось. «До утра» — пока не придёт письмо о заказе
// под угрозой: «Показать» — карточка заказа. С `--long 1` — «До утра» до конца срока, 1 апреля 2029 г.: окно целей с
// итогом.
// Снимки — tools/app/out/c2-*.png, лист — tools/app/out/c2.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, steps } from './e2e-build.mjs';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string, long?: boolean }} x */
export async function c2Part({ browser, port, out, ok, fail, errors, requests, q, long }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  const { ctx, page } = await openGame({ browser, port, errors, requests, q, scn: null });
  const s = steps(page, { out, fail, shots, feel, prefix: 'c2' });
  await page.evaluate(() => {
    const h = () => window.__game.store.get();
    Object.assign(window.__seen, {
      seatsOf: id => h().scenario === id && !!document.querySelector('#seats'),
      goals: () => !!document.querySelector('[data-test=goals]') && !!h().goals.view,
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
    // экран «Кампания»: «Первая зима» — вторым
    await page.waitForSelector('[data-test=campaign]', { timeout: 20_000 });
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-test=campaign-tile]')].map(t => t.dataset.scenario));
    const t2 = await text('[data-test=campaign-tile][data-scenario="scn.c2"]');
    await s.shot('Экран «Кампания»');
    if (order[1] !== 'scn.c2' || !/Сценарий 2/.test(t2) || !/Первая зима/.test(t2) || !/прогноз/.test(t2) || !/7 августа 2028/.test(t2) || !/237 суток/.test(t2) || !/с 1 ноября 2028/.test(t2) || !/ни одного дня срыва заказов/.test(t2)) fail(`кампания: ${order.join(', ')} — «${t2}»`);
    else ok(`кампания: «${t2}»`);

    // «Начать» — места сценария: директор и производство
    await s.measure('«Начать» сценарий 2', () => page.click('[data-test=campaign-tile][data-scenario="scn.c2"] [data-test=campaign-start]'), 'seatsOf', 'scn.c2', 'input');
    const can = await page.evaluate(() => [...document.querySelectorAll('[data-test=seat-tile]')].filter(b => !b.disabled).map(b => b.dataset.seat));
    if (can.join() !== 'director,production') fail(`места сценария 2: ${can.join(', ')}`);
    else ok('места сценария 2: директор и производство');
    await s.seats(['director']);
    const when = await s.clock();
    if (!/7 августа 2028/.test(when) || !/07:0\d/.test(when)) fail(`старт: «${when}»`);
    else ok(`старт: «${when}»`);

    // письмо дистрибьютора о сезоне — без «Пропустить» и «Пропустить обучение»; прочли — кончилось
    await page.waitForSelector('[data-test=letter][data-letter="let.c2.season"]', { timeout: 20_000 }).catch(() => undefined);
    const l1 = await text('[data-test=letter]');
    const row = await text('[data-test=letter-row][data-letter="let.c2.season"]');
    const skip = await page.evaluate(() => !!document.querySelector('[data-test=letter-skip], [data-test=letter-skip-all]'));
    await s.shot('Письмо о сезоне');
    const read = await page
      .waitForFunction(() => window.__game.store.get().letters.view?.rows.find(r => r.id === 'let.c2.season')?.end?.how === 'done', null, { timeout: 20_000 })
      .then(
        () => true,
        () => false,
      );
    if (!/Сезон впереди/.test(l1) || !/Дистрибьютор/.test(row) || !/1 ноября/.test(l1) || skip || !read) fail(`письмо о сезоне: «${l1}», пропуск — ${skip}, кончилось — ${read}`);
    else ok(`письмо о сезоне прочли — кончилось: «${l1.slice(0, 140)}…»`);
    await page.click('[data-test=letters] .close');

    // цели — с 1 ноября
    await s.measure('«Цели»', () => page.click('[data-test=goals-open]'), 'goals', undefined, 'input');
    const g = await text('[data-test=goals]');
    await s.shot('Цели сценария 2');
    if (!/с 1 ноября 2028: заказы вовремя — не меньше 90/.test(g) || !/закрытых заказов ещё нет/.test(g)) fail(`цели: «${g}»`);
    else ok(`цели: «${g}»`);
    await page.click('[data-test=goals] .close');

    // «До утра» — пока не придёт письмо о заказе под угрозой; «Показать» — карточка заказа
    const risk = await until(() => !!window.__game.store.get().letters.view?.rows.some(r => r.id === 'let.c2.risk'), 120);
    if (!risk) fail('письма о заказе под угрозой нет');
    else {
      await page.evaluate(() => window.__game.actions.setSpeed(0));
      await page.evaluate(() => {
        const g = window.__game;
        if (!g.store.get().letters.open) g.actions.toggleLetters();
        g.actions.readLetter('let.c2.risk');
      });
      await page.waitForSelector('[data-test=letter][data-letter="let.c2.risk"]', { timeout: 20_000 });
      const t = await text('[data-test=letter]');
      const clock = await s.clock();
      await s.shot('Письмо о заказе под угрозой');
      await s.measure('«Показать» — заказ', () => page.click('[data-test=letter-show]'), 'card', undefined, 'input');
      const sel = await page.evaluate(() => window.__game.store.get().selected?.kind);
      await s.shot('Карточка заказа из письма');
      if (!/Уйдёт ли заказ/.test(t) || !/не хватает/.test(t) || sel !== 'order') fail(`заказ под угрозой: ${clock} — «${t}», карточка — ${sel}`);
      else ok(`${clock} — письмо о заказе под угрозой, «Показать» открыло карточку заказа`);
      await page.evaluate(() => window.__game.actions.select(undefined));
    }

    // с `--long 1`: «До утра» до конца срока — окно целей с итогом (около 50 минут)
    const end = !long ? undefined : await until(() => !!window.__game.store.get().goals.view?.ended, 300);
    if (end === undefined) ok('итог — с `--long 1`');
    else if (!end) fail(`итога нет: ${await s.clock()}`);
    else {
      await page.evaluate(() => window.__game.actions.setSpeed(0));
      await page.waitForSelector('[data-test=goals]', { timeout: 20_000 }).catch(() => undefined);
      const r = await text('[data-test=goals]');
      const clock = await s.clock();
      await s.shot('Итог сценария 2');
      const rows = await page.evaluate(() => document.querySelectorAll('[data-test=goal-row]').length);
      if (!/Итог сценария/.test(r) || rows !== 3 || !/итог/.test(r) || !/1 апреля 2029/.test(clock)) fail(`итог: ${clock} — ${rows} строк — «${r}»`);
      else ok(`итог — ${clock}: «${r}»`);
    }
  } catch (e) {
    fail(`сценарий 2: ${e instanceof Error ? e.message : String(e)}`);
  }
  await ctx.close();
  ok(`Сценарий 2, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'c2.png'), fullPage: true });
  await lister.close();
  ok(`Сценарий 2: ${shots.length} снимков → ${join(out, 'c2.png')}`);
}
