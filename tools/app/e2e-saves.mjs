// Сценарий в браузере, часть «Сохранения» (docs/specs/2026-10-vertical-slice.md, «Сохранения»; по игре владельца
// 20.11.2026): сценарий 1 директором; «До утра» — утреннее сохранение само; «Игра» → «Сохранить» — своё; страница
// заново (хранилище страницы то же) — «Игра» → «Загрузить»: то же время завода, часы на паузе, экран мест закрыт.
// Снимок — tools/app/out/saves.png.
import { join } from 'node:path';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function savesPart(x) {
  const { browser, port, out, ok, fail, q } = x;
  const started = Date.now();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const url = `http://127.0.0.1:${port}/index.html?q=${q}&lang=ru&scn=scn.c1`;
  const when = () => page.evaluate(() => `${document.querySelector('[data-test=date]')?.textContent ?? ''} ${document.querySelector('[data-test=clock]')?.textContent ?? ''}`);
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
    await page.click('[data-test=seat-tile][data-seat=director]');
    await page.click('[data-test=seats-take]');
    await page.evaluate(() => window.__game.actions.skipTutorial?.());
    // до утра: в 08:00 — утреннее сохранение
    await page.evaluate(() => window.__game.actions.untilMorning());
    await page.waitForFunction(() => !window.__game.ff && window.__game.store.get().morning.open, null, { timeout: 180_000 });
    await page.evaluate(() => window.__game.actions.closeMorning(false));
    await page.click('[data-test=menu-open]');
    await page.waitForFunction(() => window.__game.store.get().menu.rows.some(r => r.slot === 'auto-1'), null, { timeout: 20_000 }).then(
      () => ok('утро — сохранение само: «auto-1» в меню «Игра»'),
      () => fail('утреннего сохранения нет в меню «Игра»'),
    );
    // своё — «Сохранить»
    await page.click('[data-test=save-new]');
    await page.waitForFunction(() => window.__game.store.get().menu.rows.some(r => r.slot === 'manual-1'), null, { timeout: 20_000 });
    const saved = await when();
    const row = await page.evaluate(() => document.querySelector('[data-test=save-row][data-slot="manual-1"]')?.textContent ?? '');
    await page.screenshot({ path: join(out, 'saves.png') });
    if (!/Цех на окраине/.test(row)) fail(`своё сохранение: строка «${row}»`);
    else ok(`своё сохранение — «${row.slice(0, 90)}», время завода «${saved}»`);
    // ещё немного игры — потом страница заново и загрузка: время — как при сохранении
    await page.evaluate(() => window.__game.actions.setSpeed(4));
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__game.actions.setSpeed(0));
    await page.goto(url);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
    // экран мест закрывает полосу — меню открывает действие окна, «Загрузить» нажимаем мышью
    await page.evaluate(() => window.__game.actions.toggleMenu());
    await page.waitForSelector('[data-test=save-row][data-slot="manual-1"] [data-test=save-load]', { timeout: 20_000 });
    await page.click('[data-test=save-row][data-slot="manual-1"] [data-test=save-load]');
    await page.waitForFunction(() => !window.__game.store.get().seats.open && !window.__game.store.get().menu.busy, null, { timeout: 30_000 });
    await page.waitForTimeout(500);
    const loaded = await when();
    const speed = await page.evaluate(() => window.__game.speed);
    if (loaded !== saved || speed !== 0) fail(`загрузка: «${loaded}» вместо «${saved}», скорость ${speed}`);
    else ok(`загрузка после новой страницы — «${loaded}», часы на паузе, экран мест закрыт`);
  } catch (e) {
    fail(`сохранения: ${e instanceof Error ? e.message : String(e)}`);
  }
  await ctx.close();
  ok(`Сохранения: часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
}
