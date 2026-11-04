// Сценарий в браузере, часть «Прогноз» (Б6в; docs/specs/2026-10-vertical-slice.md, «Б6в», «Проверки Б6в»): чистое окно,
// как при первом запуске, пост «Производство», отделы производства «сам» полосой режимов журнала. «До утра» — до первой
// планёрки после закрытия месяца, на который завод уже прогнозировал: 1 ноября — блок «Прогноз»: в октябре заказано,
// прогнозы планирования и отдела продаж со знаком против факта, на ноябрь — у обоих. Рычаг «Прогноз» — четвёртая
// вкладка окна расписания: позиции по 18 месяцам; сменить способ — сетка по нему; поправить клетку — пометка и ящики;
// снять правку — снова по способу; «прогноз против факта» позиции — столбики факта и пунктир вперёд, «Таблицей» — те же
// числа строками. Отклик кнопок — в кадрах (геймдизайн, §21). Снимки — tools/app/out/forecast-*.png, лист —
// tools/app/out/forecast.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Пороги отклика — в кадрах, как у части «Первая неделя» (tools/app/e2e-week.mjs): числа — геймдизайн, §21. */
const FRAMES = { input: 6, command: 15 };
const N20 = 'sku.paracetamol500.n20';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function forecastPart({ browser, port, out, ok, fail, errors, requests, q }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  await production({ browser, port, out, ok, fail, errors, requests, q, shots, feel });
  ok(`прогноз, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  // лист снимков: по три в ряд, подпись — шаг и часы завода
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'forecast.png'), fullPage: true });
  await lister.close();
  ok(`прогноз: ${shots.length} снимков → ${join(out, 'forecast.png')}`);
}

/** Чистое окно игры: прокрутка с Promise, счёт кадров и миг ввода, проверки ответа по имени (страница запрещает `eval`). */
async function openGame({ browser, port, errors, requests, q }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const promised = (o, names) => {
      for (const k of names) {
        const f = o[k];
        o[k] = function (...a) {
          const r = f.apply(this, a);
          return r instanceof Promise ? r : Promise.resolve();
        };
      }
    };
    promised(Element.prototype, ['scrollIntoView', 'scroll', 'scrollTo', 'scrollBy']);
    promised(window, ['scroll', 'scrollTo', 'scrollBy']);
    window.__fn = 0;
    const tick = () => {
      window.__fn++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const mark = () => {
      window.__in = { t: performance.now(), f: window.__fn };
    };
    addEventListener('pointerdown', mark, true);
    addEventListener('keydown', mark, true);
    const h = () => window.__game.store.get();
    const fc = () => h().gantt.view?.forecast;
    const cell = (sku, m) => document.querySelector(`[data-test=fc-row][data-sku="${sku}"] [data-test=fc-cell][data-month="${m}"]`);
    window.__seen = {
      // вкладка «Прогноз» открыта и её вид пришёл
      fc: () => h().gantt.open && h().gantt.tab === 'forecast' && !!fc() && !!document.querySelector('[data-test=fc-grid]'),
      // способ политики — в виде и на кнопке
      method: m => fc()?.policy === m && !!document.querySelector(`[data-test=fc-method-opt][data-method="${m}"].on`),
      // клетка выбрана: под сеткой — поле ящиков
      picked: () => !!document.querySelector('[data-test=fc-pick] [data-test=fc-input]'),
      // правка в силе: пометка у клетки и ящики в ней
      edited: ([sku, m, n]) => cell(sku, m)?.getAttribute('data-edit') === '1' && cell(sku, m)?.querySelector('b')?.textContent?.replace(/\s/g, '') === String(n),
      // правку сняли: пометки нет, в клетке — по способу
      unedited: ([sku, m]) => {
        const r = fc()?.rows.find(x => x.sku === sku);
        const c = r?.cells[m - fc().at];
        return !!c && !c.edit && c.plan === c.was && cell(sku, m)?.getAttribute('data-edit') === null;
      },
      // «прогноз против факта» — по ключу
      key: k => fc()?.key === k && !!document.querySelector(`[data-test=fc-key][data-key="${k}"].on`),
      table: () => !!document.querySelector('[data-test=fc-table]'),
    };
  });
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    const u = r.url();
    if (!u.startsWith(`http://127.0.0.1:${port}/`) && !u.startsWith('data:') && !u.startsWith('blob:')) requests.push(u);
  });
  await page.goto(`http://127.0.0.1:${port}/index.html?q=${q}&lang=ru`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  return { ctx, page };
}

/** Общие шаги окна: кадры, часы, отклик, снимок, «До утра», места. */
function steps(page, { out, fail, shots, feel }) {
  const frames = n => page.evaluate(k => new Promise(r => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);
  const clock = () => page.evaluate(() => `${document.querySelector('[data-test=date]')?.textContent ?? ''} ${document.querySelector('[data-test=clock]')?.textContent ?? ''}`);
  return {
    frames,
    clock,
    /** Отклик: от ввода до первого кадра, в котором проверка `check` (`window.__seen`) верна, — мс и кадры. */
    measure: async (label, act, check, arg, kind = 'command') => {
      await page.evaluate(() => {
        window.__in = undefined;
      });
      await act();
      const r = await page
        .waitForFunction(([c, a]) => (window.__seen[c](a) && window.__in ? { ms: Math.round(performance.now() - window.__in.t), f: window.__fn - window.__in.f } : false), [check, arg], { timeout: 30_000, polling: 'raf' })
        .then(x => x.jsonValue(), () => undefined);
      feel.push({ label, kind, ...(r ?? { ms: -1, f: -1 }) });
      if (!r) fail(`отклик «${label}»: ответа нет за 30 с`);
      else if (r.f > FRAMES[kind]) fail(`отклик «${label}»: ${r.f} кадров (${r.ms} мс) — больше ${FRAMES[kind]}`);
      return r;
    },
    shot: async what => {
      await frames(2);
      const file = join(out, `forecast-${String(shots.length + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file });
      shots.push({ file, label: `${shots.length + 1}. ${what} · ${await clock()}` });
    },
    /** «До утра» (5): до 08:00 или до автопаузы по дороге; планёрку не закрывать — она и нужна. Открыта ли планёрка. */
    untilMorning: async () => {
      // планёрку закрыть; окно S&OP — тоже: совещание открывает его само (Б6г), и поверх планёрки оно перехватит щелчки
      for (let k = 0; k < 4 && (await page.evaluate(() => { const h = window.__game.store.get(); return h.morning.open || h.sop.open; })); k++) await page.keyboard.press('Escape');
      await page.keyboard.press('Digit5');
      await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
      await frames(1);
      const open = await page.evaluate(() => window.__game.store.get().morning.open);
      if (open) await page.waitForFunction(() => !!window.__game.store.get().morning.view, null, { timeout: 20_000 });
      await frames(1);
      return open;
    },
    openJournal: async () => {
      if (await page.evaluate(() => window.__game.store.get().journal.open)) return;
      await page.evaluate(() => {
        window.__jv = window.__game.store.get().journal.view;
      });
      await page.keyboard.press('KeyJ');
      await page.waitForFunction(() => !!window.__game.store.get().journal.view && window.__game.store.get().journal.view !== window.__jv, null, { timeout: 20_000 });
      await frames(1);
    },
    /** Места — экраном «Кем вы будете»: кнопка «Место», плитки, «Взять». */
    seats: async want => {
      if (!(await page.evaluate(() => !!document.querySelector('#seats')))) await page.click('[data-test=seats-open]');
      await page.waitForSelector('#seats', { timeout: 20_000 });
      const pick = await page.evaluate(() => window.__game.store.get().seats.pick);
      for (const id of ['director', 'production', 'quality', 'supply', 'commerce']) if (pick.includes(id) !== want.includes(id)) await page.click(`[data-test=seat-tile][data-seat=${id}]`);
      await page.click('[data-test=seats-take]');
      await page.waitForFunction(w => [...(window.__game.store.get().top?.seats ?? [])].sort().join() === w, [...want].sort().join(), { timeout: 20_000 });
      await page.evaluate(() => window.__game.actions.setSpeed(0));
    },
  };
}

/**
 * «Производство»: планёрка 1 ноября с блоком «Прогноз» и рычагом; вкладка «Прогноз» — способ, правка клетки и её снятие,
 * «прогноз против факта» позиции и таблицей.
 */
async function production(x) {
  const { ok, fail } = x;
  const { ctx, page } = await openGame(x);
  const s = steps(page, x);
  try {
    await s.seats(['production']);
    // отделы производства «сам»: начальник планирования ставит задания, как без мест, — завод не стоит без ответов
    await s.openJournal();
    for (const head of ['plan', 'mes', 'maint']) {
      await page.waitForSelector(`[data-test=journal-modes] [data-head=${head}]`, { timeout: 20_000 });
      if ((await page.getAttribute(`[data-test=journal-modes] [data-head=${head}]`, 'data-mode')) !== 'auto') await page.click(`[data-test=journal-modes] [data-head=${head}] button[data-mode=auto]`);
      await page.waitForSelector(`[data-test=journal-modes] [data-head=${head}][data-mode=auto]`, { timeout: 20_000 });
    }
    await page.keyboard.press('Escape');

    // «До утра» — до первой планёрки после закрытия месяца с прогнозом на него: 1 ноября
    let block = '';
    for (let i = 0; i < 160 && !block; i++) {
      if (!(await s.untilMorning())) continue;
      block = await page.evaluate(() => document.querySelector('[data-test=morning-forecast] > div')?.textContent ?? '');
    }
    if (!block) {
      fail('планёрка: блока «Прогноз» не было за 160 «До утра»');
      return;
    }
    await page.evaluate(() => document.querySelector('[data-test=morning-forecast]')?.scrollIntoView({ block: 'center' }));
    await s.shot('Планёрка: прогноз закрытого месяца');
    const text = block.trim();
    if (!/^в октябре 2027 заказано [\d\s ]+ ящик\S* — планирование [\d\s ]+ \([+−]?\d+\s%\), отдел продаж [\d\s ]+ \([+−]?\d+\s%\); на ноябрь 2027 — [\d\s ]+ и [\d\s ]+/.test(text)) fail(`блок «Прогноз»: «${text}»`);
    else ok(`планёрка — ${await s.clock()}: «${text}»`);

    // рычаг — вкладка «Прогноз» окна расписания
    await s.measure('«Прогноз» — рычаг планёрки', () => page.click('[data-test=morning-forecast] [data-test=lever-forecast] button'), 'fc');
    const grid = await page.evaluate(() => ({
      rows: document.querySelectorAll('[data-test=fc-row]').length,
      months: document.querySelectorAll('[data-test=fc-grid] thead th[data-month]').length,
      err: document.querySelector('[data-test=fc-err]')?.textContent ?? '',
      now: document.querySelector('[data-test=fc-method-now]')?.textContent ?? '',
      bars: document.querySelectorAll('[data-test=fc-bar]').length,
    }));
    await s.shot('Прогноз: сетка позиций по месяцам');
    if (grid.rows !== 4 || grid.months !== 18 || !/планирование — \d/.test(grid.err) || !/^сейчас — «/.test(grid.now) || grid.bars === 0) fail(`вкладка «Прогноз»: ${JSON.stringify(grid)}`);
    else ok(`вкладка «Прогноз»: позиций ${grid.rows}, месяцев ${grid.months}, ${grid.now}; «${grid.err}»`);

    // сменить способ — сетка по нему: в клетках без правки — прогноз способа
    await s.measure('Способ «с трендом»', () => page.click('[data-test=fc-method-opt][data-method=holt]'), 'method', 'holt');
    const holt = await page.evaluate(() => {
      const v = window.__game.store.get().gantt.view.forecast;
      return { method: v.method, same: v.rows.every(r => r.cells.every(c => c.edit || c.plan === c.was)) };
    });
    await s.shot('Прогноз: способ «с трендом»');
    if (holt.method !== 'holt' || !holt.same) fail(`способ «с трендом»: ${JSON.stringify(holt)}`);
    else ok('способ «с трендом»: сетка по нему');
    await s.measure('Способ «лучший»', () => page.click('[data-test=fc-method-opt][data-method=best]'), 'method', 'best');

    // поправить клетку: позиция № 20 на следующий месяц — на 100 ящиков больше
    const at = await page.evaluate(() => window.__game.store.get().gantt.view.forecast.at);
    const m = at + 1;
    const plan = await page.evaluate(([sku, k]) => window.__game.store.get().gantt.view.forecast.rows.find(r => r.sku === sku).cells[k].plan, [N20, 1]);
    const want = plan + 100;
    const cell = `[data-test=fc-row][data-sku="${N20}"] [data-test=fc-cell][data-month="${m}"]`;
    await page.evaluate(c => document.querySelector(c)?.scrollIntoView({ block: 'center', inline: 'center' }), cell);
    await s.measure('Клетка — поле ящиков', () => page.click(cell), 'picked', undefined, 'input');
    await page.fill('[data-test=fc-input]', String(want));
    await s.measure('«Поставить» — правка клетки', () => page.click('[data-test=fc-set]'), 'edited', [N20, m, want]);
    const tip = await page.getAttribute(cell, 'title');
    await s.shot('Прогноз: правка руками');
    if (!/Правка руками; по способу «.+» — [\d\s ]+ ящик/.test(tip ?? '')) fail(`подсказка правки: «${tip}»`);
    else ok(`правка: ${plan} → ${want} ящиков; «${(tip ?? '').split('\n').pop()}»`);

    // снять правку — снова по способу
    await s.measure('«Снять правку»', () => page.click('[data-test=fc-unset]'), 'unedited', [N20, m]);
    await s.shot('Прогноз: правка снята');
    ok('правка снята: в клетке — прогноз способа');

    // «прогноз против факта» позиции: столбики факта, пунктир вперёд; «Таблицей» — те же числа строками
    await page.evaluate(() => document.querySelector('[data-test=fc-keys]')?.scrollIntoView({ block: 'center' }));
    await s.measure('«Прогноз против факта» — позиция', () => page.click(`[data-test=fc-key][data-key="${N20}"]`), 'key', N20, 'input');
    const chart = await page.evaluate(() => ({
      bars: document.querySelectorAll('[data-test=fc-bar]').length,
      ahead: document.querySelectorAll('[data-test=fc-ahead-plan]').length + document.querySelectorAll('[data-test=fc-ahead-sales]').length,
      past: document.querySelectorAll('[data-test=fc-line-plan]').length,
      errs: document.querySelectorAll('[data-test=fc-err-row]').length,
    }));
    await page.evaluate(() => document.querySelector('[data-test=fc-chart]')?.scrollIntoView({ block: 'center' }));
    await s.shot('Прогноз против факта: позиция № 20');
    if (chart.bars < 20 || chart.ahead < 2 || chart.errs !== 7) fail(`«прогноз против факта»: ${JSON.stringify(chart)}`);
    else ok(`«прогноз против факта»: столбиков ${chart.bars}, линий вперёд ${chart.ahead}, прошлого ${chart.past}; строк ошибки ${chart.errs}`);
    await s.measure('«Таблицей»', () => page.click('[data-test=fc-table-toggle]'), 'table', undefined, 'input');
    const rows = await page.evaluate(() => document.querySelectorAll('[data-test=fc-table] tbody tr').length);
    await s.shot('Прогноз против факта: таблицей');
    if (rows !== 42) fail(`таблица: строк ${rows}, а не 42`);
    else ok('таблица: 24 месяца назад и 18 вперёд');
    await page.keyboard.press('Escape');
  } finally {
    await ctx.close();
  }
}
