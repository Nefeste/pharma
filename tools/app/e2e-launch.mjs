// Сценарий в браузере, часть «План запуска» (Б6б; docs/specs/2026-10-vertical-slice.md, «Б6б», «Проверки Б6б»): чистое
// окно, как при первом запуске, пост «Производство», отделы производства «сам» полосой режимов журнала. «До утра» — до
// планёрки, где у вчерашнего задания на сутки есть «ждали …»: строка отдела раскрывается до строк задания. Рычаг «План
// запуска» — третья вкладка окна расписания: позиции по дням, пунктир правила начальника отдела планирования; щелчок по
// пунктиру — «Поставить сейчас»: строка черновика на эту позицию и день; «Утвердить» — сплошное задание на этот день, а
// пунктира там больше нет. У полосы расписания — «в задании на сутки»; в карточке помещения — его строки сегодня. Отклик
// кнопок — в кадрах (геймдизайн, §21). Снимки — tools/app/out/launch-*.png, лист — tools/app/out/launch.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Пороги отклика — в кадрах, как у части «Первая неделя» (tools/app/e2e-week.mjs): числа — геймдизайн, §21. */
const FRAMES = { input: 6, command: 15 };

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function launchPart({ browser, port, out, ok, fail, errors, requests, q }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  await production({ browser, port, out, ok, fail, errors, requests, q, shots, feel });
  ok(`план запуска, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  // лист снимков: по три в ряд, подпись — шаг и часы завода
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'launch.png'), fullPage: true });
  await lister.close();
  ok(`план запуска: ${shots.length} снимков → ${join(out, 'launch.png')}`);
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
    window.__seen = {
      // строки отдела раскрыты
      rows: dept => !!document.querySelector(`[data-test=daily-yday][data-dept=${dept}] [data-test=daily-rows] [data-test=daily-row]`),
      // вкладка «План запуска» открыта и её вид пришёл
      launch: () => h().gantt.open && h().gantt.tab === 'launch' && !!h().gantt.view?.launch && !!document.querySelector('[data-test=launch-grid]'),
      // клетка выбрана: под сеткой — «Поставить сейчас»
      picked: () => !!document.querySelector('[data-test=launch-pick] [data-test=launch-now]'),
      // строка черновика: срочное задание на этот день
      urgent: at => h().gantt.urgent.some(u => u.at === at) && / на \d\d\.\d\d/.test(document.querySelector('[data-test=draft-list]')?.textContent ?? ''),
      // утвердили: задание на этот день — сплошное, не из черновика
      placed: at => !!h().gantt.view?.launch?.jobs.some(j => j.notBefore === at && !j.fresh) && h().gantt.urgent.length === 0,
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

/** Общие шаги окна: кадры, часы, отклик, снимок, «До утра», журнал, места. */
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
      const file = join(out, `launch-${String(shots.length + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file });
      shots.push({ file, label: `${shots.length + 1}. ${what} · ${await clock()}` });
    },
    /** «До утра» (5): до 08:00 или до автопаузы по дороге; планёрку не закрывать — она и нужна. Открыта ли планёрка. */
    untilMorning: async () => {
      if (await page.evaluate(() => window.__game.store.get().morning.open)) await page.keyboard.press('Escape');
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
 * «Производство»: планёрка с исполнением вчерашнего задания на сутки — «ждали …» и строки отдела; рычаг «План запуска»;
 * «Поставить сейчас» у пунктира и «Утвердить»; «в задании на сутки» у полосы; строки сегодня в карточке помещения.
 */
async function production(x) {
  const { ok, fail } = x;
  const { ctx, page } = await openGame(x);
  const s = steps(page, x);
  try {
    await s.seats(['production']);
    // отделы производства «сам»: начальник планирования ставит задания, как без мест
    await s.openJournal();
    for (const head of ['plan', 'mes', 'maint']) {
      await page.waitForSelector(`[data-test=journal-modes] [data-head=${head}]`, { timeout: 20_000 });
      if ((await page.getAttribute(`[data-test=journal-modes] [data-head=${head}]`, 'data-mode')) !== 'auto') await page.click(`[data-test=journal-modes] [data-head=${head}] button[data-mode=auto]`);
      await page.waitForSelector(`[data-test=journal-modes] [data-head=${head}][data-mode=auto]`, { timeout: 20_000 });
    }
    await page.keyboard.press('Escape');

    // «До утра» — до планёрки, где у производства во вчерашнем задании «ждали …»
    let row = '';
    let block = '';
    for (let i = 0; i < 30 && !/ждали /.test(row); i++) {
      if (!(await s.untilMorning())) continue;
      [row, block] = await page.evaluate(() => [document.querySelector('[data-test=daily-yday][data-dept=mes]')?.textContent ?? '', document.querySelector('[data-test=morning-daily]')?.textContent ?? '']);
    }
    if (!/ждали /.test(row)) {
      fail(`планёрка: у производства во вчерашнем задании «ждали …» не было за 30 «До утра» — блок «${block.slice(0, 200)}»`);
      return;
    }
    await page.evaluate(() => document.querySelector('[data-test=morning-daily]')?.scrollIntoView({ block: 'center' }));
    await s.shot('Планёрка: задания на сутки');
    const sum = row.replace(/Строки.*$/, '').trim();
    if (!/^Производство: сделано \d+ из \d+, в срок \d+/.test(sum)) fail(`строка планёрки: «${sum}»`);
    else ok(`планёрка — ${await s.clock()}: «${sum}»`);
    const today = await page.evaluate(() => [...document.querySelectorAll('[data-test=daily-today]')].map(e => e.textContent.replace(/Строки$/, '').trim()));
    if (today.length === 0) fail('планёрка: сегодняшнего задания нет');
    else ok(`сегодня: ${today.slice(0, 3).join(' | ')}`);

    // строка отдела раскрывается до строк задания
    await s.measure('«Строки» — строки задания отдела', () => page.click('[data-test=daily-yday][data-dept=mes] [data-test=daily-open]'), 'rows', 'mes', 'input');
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-test=daily-yday][data-dept=mes] [data-test=daily-row]')].map(e => ({ res: e.getAttribute('data-res'), text: e.textContent })));
    await page.evaluate(() => document.querySelector('[data-test=daily-yday][data-dept=mes]')?.scrollIntoView({ block: 'center' }));
    await s.shot('Планёрка: строки задания производства');
    const bad = rows.filter(r => r.res !== 'ok' && /ждали /.test(r.text));
    if (rows.length === 0 || bad.length === 0 || !rows.every(r => /по плану \d\d\.\d\d \d\d:\d\d/.test(r.text))) fail(`строки задания: ${JSON.stringify(rows.slice(0, 4))}`);
    else ok(`строки производства: ${rows.length}, с «ждали» — ${bad.length}: «${bad[0].text.slice(0, 160)}»`);

    // рычаг «План запуска» — третья вкладка окна расписания
    await s.measure('«План запуска» — рычаг планёрки', () => page.click('[data-test=daily-yday][data-dept=mes] [data-test=lever-launch] button'), 'launch');
    const grid = await page.evaluate(() => ({
      rows: document.querySelectorAll('[data-test=launch-row]').length,
      days: document.querySelectorAll('[data-test=launch-grid] thead th[data-day]').length,
      jobs: document.querySelectorAll('[data-test=launch-job]').length,
      rule: document.querySelectorAll('[data-test=launch-rule]').length,
      off: document.querySelectorAll('[data-test=launch-grid] thead th.off').length,
      legend: document.querySelector('[data-test=launch-legend]')?.textContent ?? '',
    }));
    await s.shot('План запуска: задания и пунктир правила');
    if (grid.rows === 0 || grid.days !== 31 || grid.rule === 0 || grid.off === 0) fail(`план запуска: ${JSON.stringify(grid)}`);
    else ok(`план запуска: позиций ${grid.rows}, дней ${grid.days}, нерабочих ${grid.off}, заданий ${grid.jobs}, по правилу ${grid.rule}`);

    // пунктир — «Поставить сейчас»: строка черновика на его позицию и день
    const rule = await page.evaluate(() => {
      const v = window.__game.store.get().gantt.view.launch;
      const today = v.from;
      return v.rule.find(r => r.on > today) ?? v.rule[0];
    });
    const cell = `[data-test=launch-row][data-sku="${rule.sku}"] [data-test=launch-rule][data-day="${rule.day}"]`;
    await page.evaluate(c => document.querySelector(c)?.scrollIntoView({ block: 'center', inline: 'center' }), cell);
    await s.measure('Клетка пунктира — что в ней', () => page.click(cell), 'picked', undefined, 'input');
    const what = await page.evaluate(() => document.querySelector('[data-test=launch-pick-rule]')?.textContent ?? '');
    await s.shot('План запуска: клетка правила');
    if (!/начальник отдела планирования поставит \d\d\.\d\d\.\d{4} — на \d\d\.\d\d\.\d{4}/.test(what)) fail(`клетка правила: «${what}»`);
    else ok(`клетка правила: «${what.replace(/Поставить сейчас$/, '').trim()}»`);
    await s.measure('«Поставить сейчас» — строка черновика', () => page.click('[data-test=launch-pick] [data-test=launch-now]'), 'urgent', rule.at, 'input');
    const draft = await page.evaluate(() => document.querySelector('[data-test=draft-list]')?.textContent ?? '');
    await s.shot('Черновик: срочное задание на день правила');
    await s.measure('«Утвердить» — задание на этот день', () => page.click('[data-test=draft-approve]'), 'placed', rule.at);
    const after = await page.evaluate(r => {
      const v = window.__game.store.get().gantt.view.launch;
      return { job: v.jobs.find(j => j.notBefore === r.at && j.sku === r.sku), rule: v.rule.some(x => x.day === r.day) };
    }, rule);
    await page.evaluate(c => document.querySelector(c)?.scrollIntoView({ block: 'center', inline: 'center' }), `[data-test=launch-row][data-sku="${rule.sku}"]`);
    await s.shot('План запуска: задание на этот день');
    if (!after.job || after.rule || !/срочное задание — .+ на \d\d\.\d\d\.\d{4}/.test(draft)) fail(`«Поставить сейчас»: задание ${JSON.stringify(after.job)}, пунктир на дне ${after.rule}, черновик «${draft}»`);
    else ok(`«Поставить сейчас» → «Утвердить»: задание ${after.job.batch} на ${rule.day}, пунктира там нет; черновик был «${draft.trim()}»`);

    // у полосы расписания — «в задании на сутки»
    await page.click('[data-test=gantt-tab-plan]');
    await page.waitForFunction(() => !window.__game.store.get().gantt.tab && !!document.querySelector('[data-test=gbar]'), null, { timeout: 20_000 });
    await s.frames(2);
    const tip = await page.evaluate(() => [...document.querySelectorAll('[data-test=gbar]')].map(e => e.getAttribute('title') ?? '').find(t => /в задании на сутки с 08:00/.test(t)) ?? '');
    await s.shot('Расписание: полосы');
    if (!tip) fail('у полос расписания «в задании на сутки» нет');
    else ok(`полоса: «${tip.split('\n').find(l => /в задании на сутки/.test(l))}»`);
    await page.keyboard.press('Escape');

    // карточка помещения — его строки сегодня: помещение первой стадии сегодняшнего задания
    const room = await page.evaluate(() => window.__game.store.get().morning.view?.daily.today?.rows.find(r => r.kind === 'stage')?.room);
    if (!room) ok('карточка помещения: стадий в сегодняшнем задании нет — пропуск');
    else {
      const i = await page.evaluate(id => window.__game.layout.plan.plant.rooms.findIndex(r => r.id === id), room);
      await page.evaluate(k => window.__game.actions.select({ kind: 'room', i: k }), i);
      await page.waitForSelector('[data-test=card-daily] [data-test=daily-row]', { timeout: 20_000 }).catch(() => {});
      const lines = await page.evaluate(() => [...document.querySelectorAll('[data-test=card-daily] [data-test=daily-row]')].map(e => e.textContent ?? ''));
      await s.shot('Карточка помещения: задание на сутки');
      await page.keyboard.press('Escape');
      if (lines.length === 0 || !lines.every(l => /по плану \d\d\.\d\d \d\d:\d\d/.test(l))) fail(`карточка помещения ${room}: ${JSON.stringify(lines)}`);
      else ok(`карточка помещения ${room}: ${lines.length} строк сегодня — «${lines[0].slice(0, 140)}»`);
    }
  } finally {
    await ctx.close();
  }
}
