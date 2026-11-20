// Сценарий в браузере, часть «Марка» (Б11, шаг 2; docs/specs/2026-10-vertical-slice.md, «Б11», «Проверки Б11»): чистое
// окно — первый экран с именем игры, прогресс растёт по настоящим шагам загрузки до «Кампании», ни разу не назад; текст —
// шрифтом IBM Plex Sans из своих файлов; F12 — PNG кадра в загрузки, строка в полосе извещений. Снимки —
// tools/app/out/brand-*.png.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function brandPart(x) {
  const { browser, port, out, ok, fail, q } = x;
  const started = Date.now();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
  const page = await ctx.newPage();
  // шаги первого экрана — с самого начала страницы: каждое новое значение `data-done`
  await page.addInitScript(() => {
    window.__steps = [];
    new MutationObserver(() => {
      const el = document.querySelector('[data-test=first-step]');
      const d = el ? Number(el.getAttribute('data-done')) : undefined;
      if (d !== undefined && window.__steps[window.__steps.length - 1] !== d) window.__steps.push(d);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-done'] });
  });
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?q=${q}&lang=ru`);
    await page.waitForSelector('[data-test=first]', { timeout: 20_000 }).catch(() => undefined);
    const name = await page.evaluate(() => document.querySelector('.boot-name')?.textContent ?? '');
    await page.screenshot({ path: join(out, 'brand-first.png') });
    if (name !== 'Фармзавод') fail(`первый экран: имя «${name}»`);
    else ok('первый экран: имя игры и полоса загрузки');
    await page.waitForSelector('[data-test=campaign]', { timeout: 60_000 });
    const steps = await page.evaluate(() => window.__steps);
    const up = steps.every((v, i) => i === 0 || v > steps[i - 1]);
    if (!up || steps.length < 3 || steps[steps.length - 1] < 5) fail(`шаги загрузки: ${steps.join(' → ')}`);
    else ok(`шаги загрузки растут до «Кампании»: ${steps.join(' → ')} из 6`);

    // шрифт: файл загружен, текст окна — им
    const font = await page.evaluate(() => ({ ok: document.fonts.check('13px "IBM Plex Sans"'), family: getComputedStyle(document.body).fontFamily }));
    if (!font.ok || !/IBM Plex Sans/.test(font.family)) fail(`шрифт: ${JSON.stringify(font)}`);
    else ok(`шрифт — IBM Plex Sans из assets/fonts (${font.family.split(',')[0]})`);
    await page.screenshot({ path: join(out, 'brand-campaign.png') });

    // F12 — снимок кадра: PNG в загрузки, строка в полосе извещений
    await page.click('[data-test=campaign-tile][data-scenario="scn.proto"] [data-test=campaign-start]').catch(() => undefined);
    await page.waitForSelector('#seats', { timeout: 20_000 }).catch(() => undefined);
    await page.click('[data-test=seat-tile][data-seat=director]').catch(() => undefined);
    await page.click('[data-test=seats-take]').catch(() => undefined);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), page.keyboard.press('F12')]);
    const file = join(out, `brand-${dl.suggestedFilename()}`);
    await dl.saveAs(file);
    const head = readFileSync(file).subarray(0, 8).toString('hex');
    const size = statSync(file).size;
    const line = await page.evaluate(() => window.__game.store.get().notices[0]?.text ?? '');
    if (!/^pharma-\d{4}-\d\d-\d\d-\d{4}\.png$/.test(dl.suggestedFilename()) || head !== '89504e470d0a1a0a' || size < 20_000 || !line.startsWith('Снимок кадра сохранён')) fail(`F12: ${dl.suggestedFilename()}, ${head}, ${size} Б, «${line}»`);
    else ok(`F12 — ${dl.suggestedFilename()}, PNG ${Math.round(size / 1024)} КБ; «${line}»`);

    // язык окна (Б12, шаг 1): EN в меню звука — полоса по-английски и в одну строку, выбор помнится; RU — обратно
    await page.click('[data-test=sound-open]');
    await page.click('[data-test=lang][data-lang=en]');
    await page.waitForFunction(() => document.documentElement.lang === 'en' && document.querySelector('[data-test=lang][data-lang=en]')?.classList.contains('on'), null, { timeout: 10_000 });
    const enBar = await page.evaluate(() => ({
      morning: document.querySelector('[data-test=until-morning]')?.textContent ?? '',
      rows: new Set([...document.querySelectorAll('.top button')].slice(0, 12).map(b => Math.round(b.getBoundingClientRect().top))).size,
      kept: localStorage.getItem('pharma.lang'),
    }));
    await page.mouse.move(640, 500);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, 'brand-en.png') });
    if (enBar.morning !== 'Until morning' || enBar.kept !== 'en' || enBar.rows > 1) fail(`язык EN: ${JSON.stringify(enBar)}`);
    else ok(`язык EN: «${enBar.morning}», полоса в одну строку, выбор в окне`);
    await page.click('[data-test=lang][data-lang=ru]');
    const back = await page.evaluate(() => ({ lang: document.documentElement.lang, morning: document.querySelector('[data-test=until-morning]')?.textContent ?? '' }));
    if (back.lang !== 'ru' || back.morning !== 'До утра') fail(`язык RU: ${JSON.stringify(back)}`);
    else ok('язык RU — обратно на ходу');
  } catch (e) {
    fail(`марка: ${e instanceof Error ? e.message : String(e)}`);
  }
  await ctx.close();
  ok(`Марка: часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
}
