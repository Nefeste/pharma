// Сценарий в браузере, часть «Хроника» (Б10, шаг 1; docs/specs/2026-10-vertical-slice.md, «Б10», «Проверки Б10»): чистое
// окно прототипа, место качества — совещание S&OP идёт само; «До утра» неделю — на планёрке строка «Вчера в хронике», щелчок — хроника на вчерашних
// сутках; H закрывает и открывает; «Неделя» — записи о выпущенных сериях с числом суток, итог главы; «Раньше» и «Позже»;
// щелчок по записи о серии — её досье. Снимки — tools/app/out/chron-*.png, лист — tools/app/out/chron.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, steps } from './e2e-build.mjs';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function chronPart(x) {
  const { browser, out, ok, fail } = x;
  const shots = [];
  const feel = [];
  const started = Date.now();
  const { ctx, page } = await openGame(x);
  const s = steps(page, { ...x, shots, feel, prefix: 'chron' });
  await page.evaluate(() => {
    Object.assign(window.__seen, {
      chron: scale => !!document.querySelector('[data-test=chronicle]') && window.__game.store.get().chronicle.view?.scale === scale,
      dossier: () => !!document.querySelector('[data-test=dossier]'),
    });
  });
  const text = sel => page.evaluate(q => document.querySelector(q)?.innerText.replace(/\s*\n\s*/g, ' · ') ?? '', sel);
  const view = () => page.evaluate(() => window.__game.store.get().chronicle.view);
  try {
    // место качества: совещание S&OP (Б6г) ждёт директора и производство — здесь оно идёт само
    await s.seats(['quality']);
    // «До утра» — до планёрки не раньше 8 сентября, у которой вчера в хронике что-то есть; мир встаёт на автопаузах — дальше
    for (let d = 0; d < 30; d++) {
      const done = await page.evaluate(() => {
        const h = window.__game.store.get();
        // 21069 — номер дня 8 сентября 2027 г. от 1970-01-01
        return h.morning.open && (h.morning.view?.chron ?? 0) > 0 && (h.morning.view?.day ?? 0) >= 21069;
      });
      if (done) break;
      await page.evaluate(() => {
        const g = window.__game;
        if (g.store.get().morning.open) g.actions.closeMorning(false);
        g.actions.untilMorning();
      });
      await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
    }
    await page.waitForFunction(() => window.__game.store.get().morning.open && !!window.__game.store.get().morning.view, null, { timeout: 60_000 }).catch(() => undefined);
    const line = await text('[data-test=morning-chron]');
    await s.shot('Планёрка: вчера в хронике');
    if (!/Вчера в хронике: \d+/.test(line)) fail(`строки хроники на планёрке нет: «${line}»`);
    else {
      ok(`планёрка ${await s.clock()}: «${line}»`);
      await s.measure('«Вчера в хронике» — сутки', () => page.click('[data-test=morning-chron]'), 'chron', 'day', 'input');
      const v = await view();
      const span = await text('[data-test=chron-span]');
      await s.shot('Хроника: вчерашние сутки');
      if (v.back !== 1 || v.rows.length === 0 || !/08:00 — .*08:00/.test(span)) fail(`сутки: назад ${v.back}, записей ${v.rows.length}, «${span}»`);
      else ok(`вчерашние сутки — ${v.rows.length} зап., «${span}»`);
    }
    // H — закрыть и открыть (планёрка закрыта: под ней клавиши не идут)
    await page.evaluate(() => window.__game.store.get().morning.open && window.__game.actions.closeMorning(false));
    await page.keyboard.press('KeyH');
    const closed = await page.evaluate(() => !document.querySelector('[data-test=chronicle]'));
    await s.measure('H — хроника', () => page.keyboard.press('KeyH'), 'chron', 'day', 'input');
    if (!closed) fail('H не закрыл хронику');
    else ok('H закрывает и открывает хронику');

    // неделя: записи о выпущенных сериях, итог главы
    await s.measure('«Неделя»', () => page.click('[data-test=chron-scale][data-scale=week]'), 'chron', 'week', 'input');
    const wk = await text('[data-test=chronicle]');
    const rel = await page.evaluate(() => [...document.querySelectorAll('[data-test=chron-row][data-kind=released]')].map(r => r.textContent));
    await s.shot('Хроника: неделя');
    if (rel.length === 0 || !/Серия [A-Z]{2}\d{7} \(.+\) выпущена через/.test(rel[0] ?? '') || !/Выпущено серий: \d+/.test(wk)) fail(`неделя: выпусков ${rel.length} — «${wk.slice(0, 400)}»`);
    else ok(`неделя: ${rel.length} выпуск., «${rel[0]}»`);
    if (/плох|хорош|отличн|провал|молод|позор/i.test(wk)) fail('в хронике оценки игрока');
    else ok('оценок игрока в хронике нет');

    // «Раньше» и «Позже»
    const before = (await view()).from;
    await page.click('[data-test=chron-earlier]');
    await page.waitForFunction(f => window.__game.store.get().chronicle.view?.from < f, before, { timeout: 20_000 }).then(
      () => ok('«Раньше» — прошлая неделя'),
      () => fail('«Раньше» не сменил главу'),
    );
    await page.click('[data-test=chron-later]');
    await page.waitForFunction(f => window.__game.store.get().chronicle.view?.from === f, before, { timeout: 20_000 }).then(
      () => ok('«Позже» — эта неделя'),
      () => fail('«Позже» не вернул главу'),
    );

    // щелчок по записи о серии — досье
    const btn = await page.$('[data-test=chron-row][data-kind=released] [data-test=chron-go]');
    if (!btn) fail('у записи о серии нет ссылки');
    else {
      await s.measure('Запись о серии — досье', () => btn.click(), 'dossier', undefined, 'input');
      await page.waitForFunction(() => !!window.__game.store.get().dossier.view, null, { timeout: 20_000 }).catch(() => undefined);
      const d = await text('[data-test=dossier]');
      await s.shot('Досье серии из хроники');
      if (!/[A-Z]{2}\d{7}/.test(d)) fail(`досье: «${d.slice(0, 200)}»`);
      else ok('запись о серии открыла её досье');
    }
  } catch (e) {
    fail(`хроника: ${e instanceof Error ? e.message : String(e)}`);
  }
  await ctx.close();
  ok(`Хроника, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'chron.png'), fullPage: true });
  await lister.close();
  ok(`Хроника: ${shots.length} снимков → ${join(out, 'chron.png')}`);
}
