// Сценарий в браузере, часть «Звук» (Б11, шаг 1; docs/specs/2026-10-vertical-slice.md, «Б11», «Проверки Б11»): чистое окно
// с экраном «Кампания» — до первого нажатия звука нет; «Начать» сценарий 1 — файлы загружены, щелчок кнопки звучит;
// письмо наставника на старте — звук письма; «Подписи звуков» — строка извещения со словом звука; «До события» — звук
// стопа на автопаузе; «До утра» — колокольчики планёрки; громкость 0 — тишина и запомнена в окне. Окно с ключом `shot` —
// без звука. Снимки — tools/app/out/sound-*.png, лист — tools/app/out/sound.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, steps } from './e2e-build.mjs';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function soundPart(x) {
  const { browser, port, out, ok, fail, q } = x;
  const shots = [];
  const feel = [];
  const started = Date.now();
  const { ctx, page } = await openGame({ ...x, scn: null });
  const s = steps(page, { ...x, shots, feel, prefix: 'sound' });
  const played = () => page.evaluate(() => ({ ...window.__game.sound.played }));
  const text = sel => page.evaluate(q => document.querySelector(q)?.innerText.replace(/\s*\n\s*/g, ' · ') ?? '', sel);
  try {
    // до первого нажатия — тихо: звук браузер даёт только после него
    await page.waitForSelector('[data-test=campaign]', { timeout: 20_000 });
    const before = await page.evaluate(() => ({ ready: window.__game.sound.ready, sum: Object.values(window.__game.sound.played).reduce((a, b) => a + b, 0) }));
    if (before.ready || before.sum !== 0) fail(`до нажатия: файлы ${before.ready}, звуков ${before.sum}`);
    else ok('до первого нажатия — звука нет, файлы не грузились');

    // «Начать» — первое нажатие: файлы грузятся; места — директор
    await page.click('[data-test=campaign-tile][data-scenario="scn.c1"] [data-test=campaign-start]');
    await page.waitForFunction(() => window.__game.sound.ready, null, { timeout: 20_000 }).then(
      () => ok('после первого нажатия файлы звуков загружены'),
      () => fail('файлы звуков не загрузились'),
    );
    await page.waitForSelector('#seats', { timeout: 20_000 });
    await s.seats(['director']);

    // письмо наставника на старте — звук письма
    await page.waitForFunction(() => window.__game.sound.played.letter > 0, null, { timeout: 30_000 }).then(
      () => ok('письмо наставника — звук письма'),
      () => fail('письмо пришло без звука'),
    );
    await s.shot('Письмо наставника на старте');
    // обучение — дальше без писем: стоп ниже — у события завода
    await page.click('[data-test=letter-skip-all]').catch(() => undefined);
    await page.evaluate(() => window.__game.store.get().letters.open && window.__game.actions.toggleLetters());

    // щелчок кнопки окна
    const c0 = (await played()).click;
    await page.click('[data-test=sound-open]');
    const c1 = (await played()).click;
    if (c1 <= c0) fail(`щелчок кнопки: ${c0} → ${c1}`);
    else ok(`кнопка окна — щелчок (${c1})`);

    // меню звука: громкость 70 %, «Подписи звуков» — включить
    const menu = await text('[data-test=sound]');
    if (!/Громкость/.test(menu) || !/70 %/.test(menu) || !/Подписи звуков/.test(menu)) fail(`меню звука: «${menu}»`);
    else ok(`меню звука: «${menu}»`);
    await page.click('[data-test=captions]');
    await s.shot('Меню звука');
    await page.click('[data-test=sound-open]');

    // «До события» — мир встаёт на автопаузе: звук стопа и подпись у строки извещения
    let stop = 0;
    for (let i = 0; i < 12 && stop === 0; i++) {
      await page.evaluate(() => {
        const g = window.__game;
        if (g.store.get().morning.open) g.actions.closeMorning(false);
        g.actions.untilEvent();
      });
      await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
      stop = (await played()).stop;
    }
    const line = await page.evaluate(() => window.__game.store.get().notices.find(n => n.sound === 'stop'));
    await s.shot('Автопауза со звуком');
    if (stop === 0 || !line) fail(`автопауза без звука стопа: ${JSON.stringify(await played())}`);
    else ok(`автопауза ${await s.clock()} — звук стопа: «${line.text}»`);
    const shown = await page.evaluate(() => window.__game.store.get().notices[0]);
    const said = await text('[data-test=notice], [data-test=notice-go], [data-test=notice-inv]');
    if (shown?.sound && !said.includes('[звук: ')) fail(`подписи звуков: у строки нет слова звука — «${said}»`);
    else if (shown?.sound) ok(`подпись звука: «${said}»`);

    // «До утра» — планёрка: колокольчики
    const m0 = (await played()).meeting;
    for (let i = 0; i < 10; i++) {
      const done = await page.evaluate(m => window.__game.sound.played.meeting > m, m0);
      if (done) break;
      await page.evaluate(() => {
        const g = window.__game;
        if (g.store.get().morning.open) g.actions.closeMorning(false);
        g.actions.untilMorning();
      });
      await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
    }
    const m1 = (await played()).meeting;
    await s.shot('Планёрка со звуком');
    if (m1 <= m0) fail('планёрка открылась без звука');
    else ok(`планёрка ${await s.clock()} — колокольчики планёрки`);

    // громкость 0 — тишина, кнопка «Звук: нет», выбор в хранилище окна
    await page.evaluate(() => window.__game.store.get().morning.open && window.__game.actions.closeMorning(false));
    await page.click('[data-test=sound-open]');
    await page.$eval('[data-test=volume]', el => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, '0');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const k0 = (await played()).click;
    await page.click('[data-test=sound-open]');
    const quiet = await page.evaluate(() => ({ btn: document.querySelector('[data-test=sound-open]')?.textContent, kept: localStorage.getItem('pharma.volume'), caps: localStorage.getItem('pharma.captions') }));
    const k1 = (await played()).click;
    if (k1 !== k0 || quiet.btn !== 'Звук: нет' || quiet.kept !== '0' || quiet.caps !== '1') fail(`громкость 0: щелчков ${k0} → ${k1}, ${JSON.stringify(quiet)}`);
    else ok(`громкость 0 — тихо, «${quiet.btn}», в окне запомнено`);
    ok(`звуки за часть: ${JSON.stringify(await played())}`);
  } catch (e) {
    fail(`звук: ${e instanceof Error ? e.message : String(e)}`);
  }
  await ctx.close();

  // окно со `shot` — без звука: нажатия есть, звука нет
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p2 = await c2.newPage();
  try {
    await p2.goto(`http://127.0.0.1:${port}/index.html?q=${q}&lang=ru&scn=scn.proto&shot=1`);
    await p2.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
    await p2.click('[data-test=seats-take]').catch(() => undefined);
    await p2.click('[data-test=sound-open]');
    await p2.waitForTimeout(1500);
    const r = await p2.evaluate(() => ({ ready: window.__game.sound.ready, sum: Object.values(window.__game.sound.played).reduce((a, b) => a + b, 0) }));
    if (r.ready || r.sum !== 0) fail(`окно со shot: файлы ${r.ready}, звуков ${r.sum}`);
    else ok('окно со shot — без звука');
  } catch (e) {
    fail(`окно со shot: ${e instanceof Error ? e.message : String(e)}`);
  }
  await c2.close();

  ok(`Звук: часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'sound.png'), fullPage: true });
  await lister.close();
  ok(`Звук: ${shots.length} снимков → ${join(out, 'sound.png')}`);
}
