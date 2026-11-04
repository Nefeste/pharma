// Сценарий в браузере, часть «Задания» (Б6а; docs/specs/2026-10-vertical-slice.md, «Б6а», «Проверки Б6а»): чистое окно,
// как при первом запуске, пост «Производство», отделы производства «сам» полосой режимов журнала. «До утра» — до
// планёрки со строкой «Заказы без покрытия»; рычаг «Задания» — вкладка окна расписания; у заказа без покрытия «Срочное
// задание под заказ» — «Утвердить»: у нового задания срок заказа, в списке — «заказ: …». У задания до комплектовки
// «Отменить» — «Утвердить»: в досье резерва нет, задание «отменено», в журнале — «вы»; у начатого кнопки нет. «Полосы» —
// его полосы в расписании подсвечены. Отклик кнопок — в кадрах (геймдизайн, §21). Снимки — tools/app/out/jobs-*.png,
// лист — tools/app/out/jobs.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Пороги отклика — в кадрах, как у части «Первая неделя» (tools/app/e2e-week.mjs): числа — геймдизайн, §21. */
const FRAMES = { input: 6, command: 15 };

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function jobsPart({ browser, port, out, ok, fail, errors, requests, q }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  await production({ browser, port, out, ok, fail, errors, requests, q, shots, feel });
  ok(`задания, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  // лист снимков: по три в ряд, подпись — шаг и часы завода
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'jobs.png'), fullPage: true });
  await lister.close();
  ok(`задания: ${shots.length} снимков → ${join(out, 'jobs.png')}`);
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
      // вкладка «Задания» открыта и вид пришёл
      jobs: () => h().gantt.open && h().gantt.tab === 'jobs' && !!h().gantt.view && !!document.querySelector('[data-test=jobs]'),
      // строка черновика: срочное задание под этот заказ
      urgent: o => h().gantt.urgent.some(u => u.for === o) && /под заказ/.test(document.querySelector('[data-test=draft-list]')?.textContent ?? ''),
      // утвердили: в списке — задание под этот заказ
      forOrder: o => !!h().gantt.view?.jobs.rows.some(r => r.goal?.kind === 'order' && r.goal.order === o) && !!document.querySelector('[data-test=jobs-row][data-goal=order]'),
      // «Отменить» — в черновике: у строки «Вернуть»
      dropped: b => h().gantt.drop.includes(b) && document.querySelector(`[data-test=jobs-row][data-batch="${b}"] [data-test=jobs-cancel]`)?.textContent === 'Вернуть',
      // утвердили отмену: задание отменено
      cancelled: b => h().gantt.view?.jobs.rows.find(r => r.id === b)?.status === 'cancelled',
      // «Полосы»: вкладка полос, его полосы подсвечены
      bars: b => !h().gantt.tab && h().gantt.focus === b && !!document.querySelector(`[data-test=gbar][data-batch="${b}"].focus`),
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

/** Общие шаги окна: кадры, часы, отклик, снимок, «До утра», досье, журнал, места. */
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
      const file = join(out, `jobs-${String(shots.length + 1).padStart(2, '0')}.png`);
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
    /** Досье серии `B<n>`: открыть щелчком по номеру строки и дождаться вида. */
    dossier: async id => {
      await page.click(`[data-test=jobs-row][data-batch="${id}"] td:first-child button`);
      await page.waitForFunction(n => window.__game.store.get().dossier.open && window.__game.store.get().dossier.view?.batch === n, Number(id.slice(1)), { timeout: 20_000 });
      await frames(2);
      return page.evaluate(() => ({
        lots: document.querySelectorAll('#dossier [data-test=dossier-disp] [data-test=dossier-lot]').length,
        disp: document.querySelector('#dossier [data-test=dossier-disp]')?.textContent ?? '',
        head: document.querySelector('#dossier [data-test=dossier-head]')?.textContent ?? '',
        cancel: !!document.querySelector('#dossier [data-test=dossier-cancel]'),
      }));
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
 * «Производство»: планёрка с заказами без покрытия — рычаг во вкладку «Задания»; «Срочное задание под заказ» со сроком
 * заказа; «Отменить» задание до комплектовки — резерв вернулся, в журнале «вы»; у начатого кнопки нет; «Полосы».
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

    // «До утра» — до планёрки, на которой есть заказы без покрытия
    let row = '';
    for (let i = 0; i < 90 && !row; i++) if (await s.untilMorning()) row = await page.evaluate(() => document.querySelector('[data-test=morning-uncovered]')?.textContent ?? '');
    if (!row) {
      fail('заказы без покрытия: за 90 «До утра» планёрки с ними не было');
      return;
    }
    await page.evaluate(() => document.querySelector('[data-test=morning-uncovered]')?.scrollIntoView({ block: 'center' }));
    await s.shot('Планёрка: заказы без покрытия');
    if (!/покупател.+ к сроку не покрыт.*: не хватит \d+ ящ/.test(row)) fail(`строка планёрки: «${row}»`);
    else ok(`планёрка — ${await s.clock()}: «${row.replace(/Задания.*$/, '').trim()}»`);

    // рычаг «Задания» — вкладка окна расписания
    await s.measure('«Задания» — рычаг планёрки', () => page.click('[data-test=morning-uncovered] [data-test=lever-jobs] button'), 'jobs');
    const u = await page.evaluate(() => window.__game.store.get().gantt.view?.jobs.uncovered[0]);
    if (!u) {
      fail('вкладка «Задания»: заказов без покрытия нет');
      return;
    }
    const sel = `[data-test=uncovered-row][data-order="${u.order}"][data-sku="${u.sku}"]`;
    const short = await page.evaluate(q => document.querySelector(q)?.textContent ?? '', sel);
    await page.evaluate(q => document.querySelector(q)?.scrollIntoView({ block: 'center' }), sel);
    await s.shot('Задания: заказы без покрытия');
    if (!/не хватит \d+ ящ.+ из \d+ ящ.+ к /.test(short)) fail(`заказ без покрытия: «${short}»`);
    else ok(`заказ без покрытия: «${short.replace(/Срочное задание под заказ$/, '').trim()}»`);

    // «Срочное задание под заказ» — строка черновика; «Утвердить» — задание со сроком заказа
    await s.measure('«Срочное задание под заказ» — строка черновика', () => page.click(`${sel} [data-test=uncovered-urgent]`), 'urgent', u.order, 'input');
    const draft = await page.evaluate(() => document.querySelector('[data-test=draft-list]')?.textContent ?? '');
    await s.measure('«Утвердить» — задание под заказ', () => page.click('[data-test=draft-approve]'), 'forOrder', u.order);
    const mine = await page.evaluate(o => window.__game.store.get().gantt.view.jobs.rows.find(r => r.goal?.kind === 'order' && r.goal.order === o), u.order);
    const f = mine.status === 'waiting' || mine.status === 'reserved' ? 'plan' : 'work';
    await page.click(`[data-test=jobs-filter-${f}]`);
    const line = `[data-test=jobs-row][data-batch="${mine.id}"]`;
    await page.waitForSelector(line, { timeout: 20_000 });
    const cells = await page.evaluate(l => ({ goal: document.querySelector(`${l} [data-test=jobs-goal]`)?.textContent ?? '', due: document.querySelector(`${l} [data-test=jobs-due]`)?.textContent ?? '' }), line);
    await page.evaluate(l => document.querySelector(l)?.scrollIntoView({ block: 'center' }), line);
    await s.shot('Задания: срочное под заказ — срок заказа');
    if (mine.due !== u.due || !/^заказ: /.test(cells.goal) || !cells.due || !/под заказ: /.test(draft)) fail(`задание под заказ: срок ${mine.due} против ${u.due}, «${cells.goal}», «${cells.due}», черновик «${draft}»`);
    else ok(`задание под заказ ${mine.id}: «${cells.goal}», срок «${cells.due}» — срок заказа; черновик «${draft.trim()}»`);

    // у начатых — «Отменить» нет; у заданий до комплектовки — есть
    await page.click('[data-test=jobs-filter-work]');
    await page.waitForSelector('[data-test=jobs-row]', { timeout: 20_000 });
    const work = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-test=jobs-row]').length, cancel: document.querySelectorAll('[data-test=jobs-row] [data-test=jobs-cancel]').length }));
    await s.shot('Задания в работе: «Отменить» нет');
    if (work.rows === 0 || work.cancel !== 0) fail(`задания в работе: строк ${work.rows}, кнопок «Отменить» ${work.cancel}`);
    else ok(`задания в работе: ${work.rows} строк, «Отменить» нет ни у одной`);

    // «Отменить» задание начальника на запас, у которого резерв есть: досье — резерв, «Утвердить» — резерва нет
    await page.click('[data-test=jobs-filter-plan]');
    await page.waitForSelector('[data-test=jobs-row]', { timeout: 20_000 });
    const id = await page.evaluate(() => [...document.querySelectorAll('[data-test=jobs-row][data-status=reserved][data-goal=stock]')].map(e => e.getAttribute('data-batch')).at(-1));
    if (!id) {
      fail('отмена: задания на запас с резервом в плане нет');
      return;
    }
    const before = await s.dossier(id);
    await s.shot(`Досье задания ${id.slice(1)}: резерв`);
    await page.keyboard.press('Escape');
    await s.measure('«Отменить» — в черновик', () => page.click(`[data-test=jobs-row][data-batch="${id}"] [data-test=jobs-cancel]`), 'dropped', id, 'input');
    const dlist = await page.evaluate(() => document.querySelector('[data-test=draft-list]')?.textContent ?? '');
    await s.shot('Черновик: отменить задание');
    await s.measure('«Утвердить» — отмена', () => page.click('[data-test=draft-approve]'), 'cancelled', id);
    await page.click('[data-test=jobs-filter-cancelled]');
    await page.waitForSelector(`[data-test=jobs-row][data-batch="${id}"][data-status=cancelled]`, { timeout: 20_000 });
    const state = await page.evaluate(b => document.querySelector(`[data-test=jobs-row][data-batch="${b}"]`)?.textContent ?? '', id);
    const after = await s.dossier(id);
    await s.shot(`Досье задания ${id.slice(1)}: отменено, резерва нет`);
    await page.keyboard.press('Escape');
    if (before.lots === 0 || !before.cancel || after.lots !== 0 || after.cancel || !/задание отменено/.test(after.head) || !/отменено /.test(state) || !/отменить задание /.test(dlist))
      fail(`отмена ${id}: резерв до ${before.lots} партий, после ${after.lots}; кнопка до ${before.cancel}, после ${after.cancel}; досье «${after.head.slice(0, 160)}»; строка «${state}»; черновик «${dlist}»`);
    else ok(`отмена ${id}: в досье было ${before.lots} партий резерва — после «${after.disp.slice(0, 80).trim()}»; строка «${state.slice(0, 120)}»`);

    // журнал: «вы» отменили
    await page.keyboard.press('Escape');
    await s.openJournal();
    const rec = await page.evaluate(() => document.querySelector('#journal [data-test=journal-row][data-kind=cancel][data-by=player]')?.innerText.replace(/\s*\n\s*/g, ' · ') ?? '');
    await s.shot('Журнал: отмена — вы');
    await page.keyboard.press('Escape');
    if (!/вы/i.test(rec) || !/Отмена задания на серию/.test(rec)) fail(`журнал: «${rec}»`);
    else ok(`журнал: «${rec.slice(0, 200)}»`);

    // «Полосы» задания под заказ: вкладка полос, его полосы подсвечены
    await page.keyboard.press('KeyG');
    await page.waitForFunction(() => window.__game.store.get().gantt.open && !!document.querySelector('[data-test=jobs]'), null, { timeout: 20_000 });
    const g = await page.evaluate(b => window.__game.store.get().gantt.view.jobs.rows.find(r => r.id === b), mine.id);
    await page.click(`[data-test=jobs-filter-${g.status === 'waiting' || g.status === 'reserved' ? 'plan' : 'work'}]`);
    await page.waitForSelector(`[data-test=jobs-row][data-batch="${mine.id}"] [data-test=jobs-bars]`, { timeout: 20_000 });
    await s.measure('«Полосы» — полосы задания', () => page.click(`[data-test=jobs-row][data-batch="${mine.id}"] [data-test=jobs-bars]`), 'bars', mine.id);
    const lit = await page.evaluate(b => document.querySelectorAll(`[data-test=gbar][data-batch="${b}"].focus`).length, mine.id);
    await s.shot(`Расписание: полосы задания ${mine.id.slice(1)}`);
    await page.keyboard.press('Escape');
    if (lit === 0) fail(`«Полосы»: у ${mine.id} подсвеченных полос нет`);
    else ok(`«Полосы»: у задания ${mine.id} подсвечено ${lit}`);
  } finally {
    await ctx.close();
  }
}
