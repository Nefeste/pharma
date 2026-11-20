// Сценарий в браузере, часть «Переход кампании» (Б9, шаг 4; docs/specs/2026-10-vertical-slice.md, «Шаг 4. Переход
// кампании»): сценарий 1 директором; завод — до конца срока одной командой «прожить»; в итоге — «Следующий сценарий»;
// межсезонье — экран с полосой до старта сценария 2; на старте — «Кем вы будете», дата — август 2028 г., крыло
// покрытия — на плане, цели — сценария 2. Снимки — tools/app/out/carry-*.png.
import { join } from 'node:path';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function carryPart(x) {
  const { browser, port, out, ok, fail, q } = x;
  const started = Date.now();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const when = () => page.evaluate(() => `${document.querySelector('[data-test=date]')?.textContent ?? ''} ${document.querySelector('[data-test=clock]')?.textContent ?? ''}`);
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?q=${q}&lang=ru&scn=scn.c1`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
    await page.click('[data-test=seat-tile][data-seat=director]');
    await page.click('[data-test=seats-take]');
    await page.evaluate(() => window.__game.actions.skipTutorial?.());
    // до конца срока: окно целей знает его; завод — одной командой «прожить»
    await page.evaluate(() => window.__game.actions.toggleGoals());
    await page.waitForFunction(() => window.__game.store.get().goals.view?.to !== undefined, null, { timeout: 20_000 });
    await page.evaluate(() => {
      const g = window.__game;
      const to = g.store.get().goals.view.to;
      g.client.command({ kind: 'advance', seconds: to - g.t + 3600 });
    });
    await page.waitForSelector('[data-test=goals-next]', { timeout: 180_000 });
    const label = await page.evaluate(() => document.querySelector('[data-test=goals-next]')?.textContent ?? '');
    await page.screenshot({ path: join(out, 'carry-end.png') });
    if (!/Первая зима/.test(label)) fail(`итог сценария 1: кнопка «${label}»`);
    else ok(`итог сценария 1 — «${label}»`);
    // переход: межсезонье с полосой; совещание S&OP и планёрка за срок открылись сами — закрыть, чтобы кнопка была видна
    await page.evaluate(() => {
      const g = window.__game;
      if (g.store.get().sop.open) g.actions.toggleSop();
      if (g.store.get().morning.open) g.actions.closeMorning(false);
      if (g.store.get().letters?.open) g.actions.toggleLetters();
    });
    await page.click('[data-test=goals-next]');
    await page.waitForSelector('[data-test=gap]', { timeout: 30_000 });
    await page.waitForFunction(() => Number(document.querySelector('[data-test=gap]')?.getAttribute('data-share') ?? 0) > 0.2, null, { timeout: 120_000 }).catch(() => undefined);
    const gap = await page.evaluate(() => ({ text: document.querySelector('[data-test=gap]')?.textContent ?? '', share: Number(document.querySelector('[data-test=gap]')?.getAttribute('data-share') ?? 0) }));
    await page.screenshot({ path: join(out, 'carry-gap.png') });
    if (!/Межсезонье/.test(gap.text) || gap.share <= 0) fail(`межсезонье: «${gap.text}», ${gap.share}`);
    else ok(`межсезонье — «${gap.text.slice(0, 70)}…», дошло ${Math.round(gap.share * 100)} %`);
    // старт сценария 2: экран мест, дата — август 2028 г., крыло покрытия на плане
    await page.waitForFunction(() => !window.__game.store.get().gap && window.__game.store.get().seats.open, null, { timeout: 300_000 });
    const s2 = await page.evaluate(() => ({ scenario: window.__game.store.get().scenario, coating: window.__game.world.plan.rooms.some(r => r.type === 'coating') }));
    await page.click('[data-test=seat-tile][data-seat=director]');
    await page.click('[data-test=seats-take]');
    await page.waitForTimeout(800);
    const at = await when();
    await page.screenshot({ path: join(out, 'carry-start.png') });
    if (s2.scenario !== 'scn.c2' || !s2.coating || !/августа 2028/.test(at)) fail(`старт сценария 2: ${JSON.stringify(s2)}, «${at}»`);
    else ok(`старт сценария 2 — «${at}», крыло покрытия на плане`);
    // цели — сценария 2, с 1 ноября 2028 г.
    await page.evaluate(() => window.__game.store.get().goals.open || window.__game.actions.toggleGoals());
    await page.waitForSelector('[data-test=goals]', { timeout: 20_000 });
    const goals = await page.evaluate(() => document.querySelector('[data-test=goals]')?.textContent ?? '');
    if (!/1 ноября 2028/.test(goals)) fail(`цели сценария 2: «${goals.slice(0, 200)}»`);
    else ok('цели сценария 2 — с 1 ноября 2028 г.');
  } catch (e) {
    fail(`переход кампании: ${e instanceof Error ? e.message : String(e)}`);
  }
  await ctx.close();
  ok(`Переход кампании: часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
}
