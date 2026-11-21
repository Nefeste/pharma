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
    await page.click('[data-test=settings-open]');
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

    // повышенный контраст (Б13, шаг 2): окна непрозрачные, текст белый, выбор помнится; снимок — с открытыми настройками
    await page.click('[data-test=contrast]');
    const hi = await page.evaluate(() => {
      const panel = document.querySelector('#settings');
      const bg = panel ? getComputedStyle(panel).backgroundColor : '';
      return { cls: document.documentElement.classList.contains('contrast'), bg, text: getComputedStyle(document.body).color, kept: localStorage.getItem('pharma.contrast') };
    });
    await page.screenshot({ path: join(out, 'brand-contrast.png') });
    const opaque = /^rgb\(/.test(hi.bg) || /, 1\)$/.test(hi.bg);
    if (!hi.cls || !opaque || hi.text !== 'rgb(255, 255, 255)' || hi.kept !== '1') fail(`контраст: ${JSON.stringify(hi)}`);
    else ok(`повышенный контраст — окно ${hi.bg}, текст ${hi.text}, выбор в окне`);
    await page.click('[data-test=contrast]');
    const lo = await page.evaluate(() => ({ cls: document.documentElement.classList.contains('contrast'), kept: localStorage.getItem('pharma.contrast') }));
    if (lo.cls || lo.kept !== '0') fail(`контраст выкл.: ${JSON.stringify(lo)}`);
    else ok('повышенный контраст — выключен, как было');

    // клавиши (Б13, шаг 3): «Расписание» — на Y; Y открывает его, G — нет; G на «Сейчас» уже занята — отказ словами;
    // по умолчанию — обратно
    await page.click('[data-test=key][data-action=gantt]');
    await page.keyboard.press('KeyY');
    const bound = await page.evaluate(() => ({ key: document.querySelector('[data-test=key][data-action=gantt]')?.textContent, kept: localStorage.getItem('pharma.keys') }));
    await page.click('[data-test=settings-open]');
    await page.keyboard.press('KeyG');
    const byG = await page.evaluate(() => window.__game.store.get().gantt.open);
    await page.keyboard.press('KeyY');
    const byY = await page.evaluate(() => window.__game.store.get().gantt.open);
    await page.evaluate(() => window.__game.store.get().gantt.open && window.__game.actions.toggleGantt());
    await page.click('[data-test=settings-open]');
    await page.click('[data-test=key][data-action=now]');
    await page.keyboard.press('KeyY');
    const note = await page.evaluate(() => document.querySelector('[data-test=key-note]')?.textContent ?? '');
    if (bound.key !== 'Y' || !/"gantt":"KeyY"/.test(bound.kept ?? '') || byG || !byY || !/Расписание/.test(note)) fail(`клавиши: ${JSON.stringify({ bound, byG, byY, note })}`);
    else ok(`клавиши: «Расписание» на Y — открывает, G — нет; занятая — «${note}»`);
    await page.click('[data-test=keys-reset]');
    const back2 = await page.evaluate(() => document.querySelector('[data-test=key][data-action=gantt]')?.textContent);
    if (back2 !== 'G') fail(`клавиши по умолчанию: «${back2}»`);
    else ok('клавиши по умолчанию — G снова у расписания');

    // окна — на место (второй путь у двойного щелчка): сдвинутые настройки встают туда, где открываются
    const shead = await page.$('#settings .phead');
    const hb = await shead.boundingBox();
    await page.mouse.move(hb.x + 40, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x - 160, hb.y + 120, { steps: 6 });
    await page.mouse.up();
    const moved = await page.evaluate(() => document.querySelector('#settings')?.style.translate ?? '');
    await page.click('[data-test=windows-home]');
    const home = await page.evaluate(() => document.querySelector('#settings')?.style.translate ?? '');
    if (!moved || home) fail(`окна на место: сдвиг «${moved}» → «${home}»`);
    else ok(`«Окна — на место»: сдвиг «${moved}» снят`);
  } catch (e) {
    fail(`марка: ${e instanceof Error ? e.message : String(e)}`);
  }
  await ctx.close();
  ok(`Марка: часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
}
