// Сценарий в браузере, часть «Правки» (Б6е; docs/specs/2026-10-vertical-slice.md, «Б6е», «Проверки Б6е»): чистое окно,
// как при первом запуске, пост «Производство», отделы производства «сам» полосой режимов журнала. «До утра» — до первой
// планёрки с блоком «Правки плана»: событие коммерции суток — крупный заказ покупателя. Рычаг — расписание: на девяти
// сутках всё окно — в замороженном горизонте. Задание, не начавшее комплектовку, тянут мышью на сутки позже — у
// черновика строка цены правки; «Утвердить» — срок сменился, в журнале — сдвиг игрока с ценой первой строкой причины.
// «Политики» (P), начальник отдела планирования: замороженный горизонт — 5 рабочих дней вместо 10; в расписании край
// горизонта сдвинулся ближе и виден в окне, в плане запуска — тоже. Отклик — в кадрах (геймдизайн, §21). Снимки —
// tools/app/out/edits-*.png, лист — tools/app/out/edits.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Пороги отклика — в кадрах, как у части «Первая неделя» (tools/app/e2e-week.mjs): числа — геймдизайн, §21. */
const FRAMES = { input: 6, command: 15 };
const FROZEN = 'pol.plan.frozen';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function editsPart({ browser, port, out, ok, fail, errors, requests, q }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  await production({ browser, port, out, ok, fail, errors, requests, q, shots, feel });
  ok(`Правки, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  // лист снимков: по три в ряд, подпись — шаг и часы завода
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'edits.png'), fullPage: true });
  await lister.close();
  ok(`Правки: ${shots.length} снимков → ${join(out, 'edits.png')}`);
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
    // перетаскивание: отклик — от того, как отпустили
    addEventListener('pointerup', mark, true);
    addEventListener('keydown', mark, true);
    const h = () => window.__game.store.get();
    const g = () => h().gantt;
    window.__seen = {
      // расписание открыто рычагом: вкладка полос, строки нарисованы
      gantt: () => g().open && !g().tab && !!g().view && document.querySelectorAll('[data-test=gantt-row]').length > 0,
      // отпустили задание в горизонте: строка черновика и цена правки
      priced: b => g().draft.some(c => c.batch === b) && !!g().view?.price && /^Правка в замороженном горизонте: /.test(document.querySelector('[data-test=draft-price]')?.textContent ?? ''),
      // утвердили: черновик пуст, у задания новый срок, строки цены нет
      approved: ([b, nb]) => g().draft.length === 0 && g().view?.batches[b]?.notBefore === nb && !document.querySelector('[data-test=draft-price]'),
      // политика применена: у строки новое значение
      policy: ([p, v]) => JSON.parse(document.querySelector(`[data-test=policy-row][data-policy="${p}"]`)?.getAttribute('data-value') ?? 'null') === v,
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
      const file = join(out, `edits-${String(shots.length + 1).padStart(2, '0')}.png`);
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
 * «Производство»: планёрка с событием коммерции и рычагом; задание в горизонте на сутки позже — цена у черновика;
 * «Утвердить» — сдвиг игрока с ценой в журнале; политика горизонта — 5 рабочих дней: край ближе в расписании и плане
 * запуска.
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

    // «До утра» — до планёрки с событием коммерции за сутки до неё
    let event = '';
    for (let i = 0; i < 40 && !event; i++) if (await s.untilMorning()) event = await page.evaluate(() => document.querySelector('[data-test=morning-edits] [data-test=morning-event]')?.textContent ?? '');
    if (!event) {
      fail('планёрка: блока «Правки плана» с событием коммерции не было за 40 «До утра»');
      return;
    }
    const block = await page.evaluate(() => ({ head: document.querySelector('[data-test=morning-edits] > div')?.textContent ?? '', kinds: [...document.querySelectorAll('[data-test=morning-edits] [data-test=morning-event]')].map(e => e.getAttribute('data-kind')) }));
    await page.evaluate(() => document.querySelector('[data-test=morning-edits]')?.scrollIntoView({ block: 'center' }));
    await s.shot('Планёрка: блок «Правки плана»');
    const big = /^Крупный заказ: .+ — .+, \d+ ящик\S* к \d\d\.\d\d/.test(event);
    const cut = /^.+ снял спрос: .+ — на \d+ ящик\S* меньше в ближайших заказах$/.test(event);
    if (block.head !== 'События коммерции' || !(big || cut)) fail(`блок «Правки плана»: ${JSON.stringify({ ...block, event })}`);
    else ok(`планёрка — ${await s.clock()}: «${block.head}» — «${event}» (${block.kinds.join(', ')})`);

    // рычаг — расписание: девять суток, всё окно в замороженном горизонте
    await s.measure('Расписание — рычаг планёрки', () => page.click('[data-test=morning-edits] [data-test=lever-gantt] button'), 'gantt');
    await page.click('[data-test=gantt-days-9]');
    await page.waitForFunction(() => {
      const v = window.__game.store.get().gantt.view;
      return !!v && v.to - v.from === 9 * 86400;
    }, null, { timeout: 20_000 });
    await s.frames(2);
    const was = await page.evaluate(() => {
      const v = window.__game.store.get().gantt.view;
      return { edge: v.frozen.edge, days: v.frozen.days, to: v.to, band: document.querySelectorAll('.gfrozen').length, tick: !!document.querySelector('[data-test=frozen-edge]') };
    });
    if (was.days !== 10 || was.band === 0 || !(was.edge >= was.to) || was.tick) fail(`горизонт в расписании: ${JSON.stringify(was)}`);
    else ok(`расписание: горизонт ${was.days} рабочих дней, край за окном девяти суток — полос горизонта ${was.band}`);

    // задание, не начавшее комплектовку, — на сутки позже: у черновика цена правки
    const bar = await page.$('[data-test=gbar][data-movable="1"][data-kind=kit]');
    if (!bar) {
      fail('расписание: задания, которое можно тянуть, нет');
      return;
    }
    const batch = await bar.getAttribute('data-batch');
    const box = await bar.boundingBox();
    const width = await page.$eval('[data-test=gantt-row] .gtrack', e => e.getBoundingClientRect().width);
    const bx = box.x + box.width / 2;
    const by = box.y + box.height / 2;
    await s.measure(
      'Отпустили задание в горизонте — цена',
      async () => {
        await page.mouse.move(bx, by);
        await page.mouse.down();
        await page.mouse.move(bx + Math.round(width / 9), by, { steps: 8 });
        await page.waitForFunction(() => document.querySelectorAll('[data-test=ghost]').length > 0, null, { timeout: 20_000 }).catch(() => {});
        await page.mouse.up();
      },
      'priced',
      batch,
    );
    const price = await page.evaluate(() => document.querySelector('[data-test=draft-price]')?.textContent ?? '');
    await s.shot('Расписание: цена правки в черновике');
    if (!/^Правка в замороженном горизонте: (уборок, переналадок и сдвигов не прибавит|[+−]\d.+)$/.test(price)) fail(`цена правки: «${price}»`);
    else ok(`задание ${batch} на сутки позже — «${price}»`);

    // «Утвердить» — срок сменился, черновик пуст
    const nb = await page.evaluate(b => window.__game.store.get().gantt.draft.find(c => c.batch === b)?.notBefore, batch);
    await s.measure('«Утвердить» правку', () => page.click('[data-test=draft-approve]'), 'approved', [batch, nb]);
    await s.shot('Расписание: правка утверждена');

    // журнал: сдвиг игрока, цена — первой строкой причины
    await page.keyboard.press('Escape');
    await s.openJournal();
    const row = '[data-test=journal-row][data-kind=shift][data-by=player]';
    await page.waitForSelector(row, { timeout: 20_000 }).catch(() => {});
    const rec = await page.evaluate(r => document.querySelector(r)?.textContent ?? '', row);
    if (rec) {
      await page.click(`${row} [data-test=journal-more]`).catch(() => {});
      await page.waitForSelector(`${row} [data-test=journal-why]`, { timeout: 20_000 }).catch(() => {});
    }
    const why = await page.evaluate(r => document.querySelector(`${r} [data-test=journal-why] li`)?.textContent ?? '', row);
    await s.shot('Журнал: сдвиг задания с ценой');
    if (!/Сдвиг задания на серию: .+, не раньше .+ вместо /.test(rec) || why !== price) fail(`журнал: «${rec}» · «${why}» (у черновика — «${price}»)`);
    else ok(`журнал: «${rec.slice(0, 160)}» · «${why}»`);
    await page.keyboard.press('Escape');

    // «Политики» (P), начальник отдела планирования: замороженный горизонт — на шаг короче
    await page.keyboard.press('KeyP');
    await page.waitForSelector('#policies', { timeout: 20_000 });
    await page.click('[data-test=policy-tab][data-head=plan]');
    const pol = `[data-test=policy-row][data-policy="${FROZEN}"]`;
    await page.waitForSelector(pol, { timeout: 20_000 });
    const v0 = await page.evaluate(p => JSON.parse(document.querySelector(p)?.getAttribute('data-value') ?? 'null'), pol);
    await page.click(`${pol} [data-test=policy-less]`);
    await s.measure('«Применить» горизонт', () => page.click('[data-test=policy-apply]'), 'policy', [FROZEN, 5]);
    const text = await page.evaluate(p => document.querySelector(`${p} [data-test=policy-value]`)?.textContent ?? '', pol);
    await s.shot('Политики: замороженный горизонт — 5 рабочих дней');
    if (v0 !== 10 || text !== '5 рабочих дней') fail(`политика горизонта: ${v0} → «${text}»`);
    else ok(`политика горизонта: ${v0} → «${text}»`);
    await page.keyboard.press('Escape');

    // расписание: край горизонта ближе — в окне девяти суток
    await page.keyboard.press('KeyG');
    await page.waitForFunction(e => {
      const v = window.__game.store.get().gantt.view;
      return !!v && v.frozen.edge < e && !!document.querySelector('[data-test=frozen-edge]');
    }, was.edge, { timeout: 20_000 }).catch(() => {});
    const now = await page.evaluate(() => {
      const v = window.__game.store.get().gantt.view;
      const tick = document.querySelector('[data-test=frozen-edge]');
      return { edge: v.frozen.edge, days: v.frozen.days, tick: tick?.textContent ?? '', at: Number(tick?.getAttribute('data-edge') ?? 0), title: tick?.getAttribute('title') ?? '' };
    });
    await s.shot('Расписание: край горизонта сдвинулся');
    if (now.days !== 5 || !(now.edge < was.edge) || now.at !== now.edge || !/^заморожено до \d\d\.\d\d/.test(now.tick) || !/^Замороженный горизонт — 5 рабочих дней: /.test(now.title))
      fail(`край горизонта: ${JSON.stringify({ was: was.edge, ...now })}`);
    else ok(`край горизонта: на ${((was.edge - now.edge) / 86400).toFixed(0)} сут. ближе — «${now.tick}»`);

    // план запуска: дни до края — в горизонте, край помечен
    await page.click('[data-test=gantt-tab-launch]');
    await page.waitForFunction(() => !!window.__game.store.get().gantt.view?.launch && document.querySelectorAll('[data-test=launch] th[data-day]').length > 0, null, { timeout: 20_000 }).catch(() => {});
    const launch = await page.evaluate(() => ({
      frozen: document.querySelectorAll('[data-test=launch] th[data-frozen="1"]').length,
      edge: document.querySelector('[data-test=launch] th.edge')?.getAttribute('title') ?? '',
    }));
    await s.shot('План запуска: край горизонта');
    if (launch.frozen < 5 || launch.frozen > 9 || !/^заморожено до \d\d\.\d\d/.test(launch.edge)) fail(`план запуска: ${JSON.stringify(launch)}`);
    else ok(`план запуска: дней в горизонте ${launch.frozen}, край — «${launch.edge}»`);
    await page.keyboard.press('Escape');
  } finally {
    await ctx.close();
  }
}
