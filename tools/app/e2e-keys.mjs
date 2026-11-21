// Сценарий в браузере, часть «Клавиатура» (Б13, шаг 4; docs/specs/2026-10-vertical-slice.md, «Б13. Доступность и
// настройки»): сценарий 1 без мыши — только Tab, Enter, пробел, Esc и клавиши карты. «Кампания» → «Начать»; «Кем вы
// будете» — директор; письма — «Пропустить обучение»; пробел — ход и пауза; Ctrl+F — «Найти» склад, Enter — его карточка,
// Esc — снять; 5 — «До утра», планёрка, Esc; B — стройка, стрелки ведут клетку, Esc — выйти; Esc — «Настройки».
// Снимок — tools/app/out/keys.png.
import { join } from 'node:path';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function keysPart(x) {
  const { browser, port, out, ok, fail, q } = x;
  const started = Date.now();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const h = () => page.evaluate(() => window.__game.store.get());
  /** Tab, пока фокус не встанет на `sel` — так Tab доходит до кнопки; не дошёл — ошибка. */
  const tabTo = async (sel, max = 300) => {
    for (let i = 0; i < max; i++) {
      if (await page.evaluate(q => !!document.activeElement?.matches(q), sel)) return i;
      await page.keyboard.press('Tab');
    }
    throw new Error(`Tab не дошёл до ${sel}`);
  };
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?q=${q}&lang=ru`);
    await page.waitForSelector('[data-test=campaign]', { timeout: 60_000 });
    // «Кампания» → «Начать» сценарий 1
    const n1 = await tabTo('[data-test=campaign-tile][data-scenario="scn.c1"] [data-test=campaign-start]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#seats', { timeout: 30_000 });
    // «Кем вы будете»: директор, «Взять»
    const n2 = await tabTo('[data-test=seat-tile][data-seat=director]');
    await page.keyboard.press('Enter');
    const n3 = await tabTo('[data-test=seats-take]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !window.__game.store.get().seats.open, null, { timeout: 30_000 });
    ok(`«Кампания», директор, «Взять» — Tab ×${n1}, ×${n2}, ×${n3} и Enter`);
    // письма: «Пропустить обучение»
    await page.waitForSelector('[data-test=letter-skip-all]', { timeout: 30_000 });
    await tabTo('[data-test=letter-skip-all]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('[data-test=letter-skip-all]'), null, { timeout: 20_000 });
    if ((await h()).letters.open) await page.keyboard.press('Escape');
    ok('письма — «Пропустить обучение» с клавиатуры');
    // пробел — ход и пауза (фокус — на странице, не на кнопке)
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    const sp0 = await page.evaluate(() => window.__game.speed);
    await page.keyboard.press('Space');
    const sp1 = await page.evaluate(() => window.__game.speed);
    await page.keyboard.press('Space');
    const sp2 = await page.evaluate(() => window.__game.speed);
    if (sp1 === sp0 || sp2 !== sp0) fail(`пробел: ${sp0} → ${sp1} → ${sp2}`);
    else ok(`пробел — ход и пауза: ${sp0} → ${sp1} → ${sp2}`);
    // Ctrl+F — «Найти» склад, Enter — его карточка
    await page.keyboard.press('Control+KeyF');
    await page.waitForSelector('[data-test=find-input]', { timeout: 10_000 });
    await page.keyboard.type('склад');
    await page.waitForSelector('[data-test=find-row][data-kind=room]', { timeout: 20_000 });
    const found = await page.evaluate(() => document.querySelector('[data-test=find-row][data-kind=room]')?.textContent ?? '');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__game.selected?.kind === 'room', null, { timeout: 10_000 });
    const card = await page.evaluate(() => ({ find: window.__game.store.get().find.open, sel: window.__game.selected }));
    if (card.find || card.sel?.kind !== 'room') fail(`«Найти»: ${JSON.stringify(card)}`);
    else ok(`Ctrl+F «склад» — «${found}», Enter — карточка помещения`);
    await page.keyboard.press('Escape');
    if (await page.evaluate(() => !!window.__game.selected)) fail('Esc не снял выбор');
    // 5 — «До утра»: планёрка; Esc — закрыть
    await page.keyboard.press('Digit5');
    await page.waitForFunction(() => !window.__game.ff && window.__game.store.get().morning.open, null, { timeout: 180_000 });
    await page.keyboard.press('Escape');
    if ((await h()).morning.open) fail('Esc не закрыл планёрку');
    else ok('5 — «До утра», планёрка; Esc — закрыта');
    // B — стройка: стрелки ведут клетку курсора, Esc — выйти
    for (let i = 0; i < 4 && (await h()).sop.open; i++) await page.keyboard.press('Escape');
    await page.keyboard.press('KeyB');
    await page.waitForFunction(() => window.__game.store.get().build?.on, null, { timeout: 10_000 }).catch(() => undefined);
    await page.keyboard.press('ArrowRight');
    const c0 = await page.evaluate(() => window.__game.builder.hover);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    const c1 = await page.evaluate(() => window.__game.builder.hover);
    await page.screenshot({ path: join(out, 'keys.png') });
    for (let i = 0; i < 4 && (await page.evaluate(() => window.__game.builder.on)); i++) await page.keyboard.press('Escape');
    const off = await page.evaluate(() => !window.__game.builder.on);
    if (!c0 || !c1 || c1[0] !== c0[0] + 1 || c1[1] !== c0[1] + 1 || !off) fail(`стройка с клавиатуры: ${JSON.stringify({ c0, c1, off })}`);
    else ok(`B — стройка, стрелки: клетка ${c0.join(',')} → ${c1.join(',')}; Esc — выход`);
    // Esc, когда закрывать нечего, — «Настройки»
    for (let i = 0; i < 6 && !(await h()).settings.open; i++) await page.keyboard.press('Escape');
    if (!(await h()).settings.open) fail('Esc не открыл «Настройки»');
    else ok('Esc, когда закрывать нечего, — «Настройки»');
  } catch (e) {
    fail(`клавиатура: ${e instanceof Error ? e.message : String(e)}`);
  }
  await ctx.close();
  ok(`Клавиатура: часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
}
