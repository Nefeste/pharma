// Сценарий в браузере, часть «S&OP» (Б6г; docs/specs/2026-10-vertical-slice.md, «Б6г», «Проверки Б6г»): чистое окно, как
// при первом запуске, пост «Производство», отделы производства «сам» полосой режимов журнала. «До события» — до первого
// совещания: 3 сентября в 10:00 мир встаёт на нём, окно совещания открывается само — план начальника, четыре блока,
// люди под план, «до лучшего плана» — 0 ₽. Цель клетки — другая: окно пересчитывает, план — черновик, «до лучшего плана»
// не меньше нуля. «Утвердить» — запись журнала «вы» и план завода; на следующей неделе задание начальника — с запасом
// позиций из плана S&OP. Отклик — в кадрах (геймдизайн, §21). Снимки — tools/app/out/sop-*.png, лист —
// tools/app/out/sop.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Пороги отклика — в кадрах, как у части «Первая неделя» (tools/app/e2e-week.mjs): числа — геймдизайн, §21. */
const FRAMES = { input: 6, command: 15 };
const PARA = 'prd.paracetamol500';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function sopPart({ browser, port, out, ok, fail, errors, requests, q }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  await production({ browser, port, out, ok, fail, errors, requests, q, shots, feel });
  ok(`S&OP, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'sop.png'), fullPage: true });
  await lister.close();
  ok(`S&OP: ${shots.length} снимков → ${join(out, 'sop.png')}`);
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
    addEventListener('change', mark, true);
    const h = () => window.__game.store.get();
    const v = () => h().sop.view;
    window.__seen = {
      // окно совещания открыто, его вид пришёл и совещание идёт
      open: () => h().sop.open && !!v()?.open && !!document.querySelector('[data-test=sop-state][data-open="1"]'),
      // правка клетки: план — черновик, клетка — с новой целью — окно пересчитало план
      drafted: ([product, i, days]) => v()?.shown === 'draft' && v().cover[product]?.[i] === days && document.querySelector(`[data-test=sop-cell][data-product="${product}"][data-i="${i}"]`)?.getAttribute('data-v') === String(days),
      // утверждён: совещания нет, показан утверждённый план
      approved: () => !v()?.open && v()?.shown === 'approved' && !!document.querySelector('[data-test=sop-state][data-open="0"][data-shown=approved]'),
      journal: () => !!h().journal.view,
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

/** Общие шаги окна: кадры, часы, отклик, снимок, места, журнал. */
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
      const file = join(out, `sop-${String(shots.length + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file });
      shots.push({ file, label: `${shots.length + 1}. ${what} · ${await clock()}` });
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
    /** «До утра» (5): до 08:00 или до автопаузы по дороге; окна закрыть — мир идёт дальше. */
    untilMorning: async () => {
      for (let k = 0; k < 4 && (await page.evaluate(() => { const h = window.__game.store.get(); return h.morning.open || h.journal.open || h.sop.open || !!h.selected; })); k++) await page.keyboard.press('Escape');
      await page.keyboard.press('Digit5');
      await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
      await frames(2);
    },
    /** «До события» (6): до автопаузы; планёрку и окна закрыть — мир идёт дальше. Открыто ли окно совещания. */
    untilEvent: async () => {
      for (let k = 0; k < 4 && (await page.evaluate(() => { const h = window.__game.store.get(); return h.morning.open || h.journal.open || !!h.selected; })); k++) await page.keyboard.press('Escape');
      await page.keyboard.press('Digit6');
      await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
      await frames(2);
      return page.evaluate(() => window.__game.store.get().sop.open);
    },
  };
}

/**
 * «Производство»: совещание 3 сентября открывается само; четыре блока и люди под план; правка цели клетки — пересчёт;
 * «Утвердить» — запись журнала и план завода; задание начальника — с запасом позиций из плана.
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

    // «До события» — до совещания: мир встаёт, окно открывается само
    let open = false;
    for (let i = 0; i < 40 && !open; i++) open = await s.untilEvent();
    if (!open) {
      fail('совещание: окно S&OP не открылось за 40 «До события»');
      return;
    }
    await page.waitForFunction(() => window.__seen.open(), null, { timeout: 30_000 });
    const top = await page.evaluate(() => {
      const h = window.__game.store.get();
      const v = h.sop.view;
      return {
        clock: `${document.querySelector('[data-test=date]')?.textContent ?? ''} ${document.querySelector('[data-test=clock]')?.textContent ?? ''}`,
        notice: h.notices[0]?.text ?? '',
        stop: !!h.notices[0]?.stop,
        speed: h.speed,
        rows: document.querySelectorAll('[data-test=sop-row]').length,
        cells: document.querySelectorAll('[data-test=sop-cell]').length,
        blocks: ['sop-demand', 'sop-capacity', 'sop-stock', 'sop-cash', 'sop-people'].filter(k => !!document.querySelector(`[data-test=${k}]`)).length,
        res: document.querySelectorAll('[data-test=sop-res]').length,
        stock: document.querySelectorAll('[data-test=sop-stock-row]').length,
        cash: document.querySelectorAll('[data-test=sop-cash-row]').length,
        roles: document.querySelectorAll('[data-test=sop-role]').length,
        gap: document.querySelector('[data-test=sop-result]')?.getAttribute('data-gap') ?? '',
        value: v?.value,
        best: v?.open?.value,
        state: document.querySelector('[data-test=sop-state]')?.textContent ?? '',
      };
    });
    await s.shot('Совещание S&OP открылось само');
    if (!/^пт, 3 сентября 2027 10:00/.test(top.clock) || !top.stop || top.speed !== 0 || !/^Совещание S&OP: план с сентября 2027 ждёт вашего «Утвердить»/.test(top.notice)) fail(`совещание: ${JSON.stringify(top)}`);
    else ok(`совещание — ${top.clock}: «${top.notice}»`);
    if (top.rows !== 2 || top.cells !== 12 || top.blocks !== 5 || top.res !== 7 || top.stock !== 4 || top.cash !== 6 || top.roles !== 6 || top.gap !== '0' || top.value !== top.best) fail(`окно S&OP: ${JSON.stringify(top)}`);
    else ok(`окно S&OP: продуктов ${top.rows}, клеток ${top.cells}, блоков ${top.blocks}, ресурсов ${top.res}, позиций ${top.stock}, строк кассы ${top.cash}, ролей ${top.roles}; «${top.state}»`);
    await page.evaluate(() => document.querySelector('[data-test=sop-capacity]')?.scrollIntoView({ block: 'center' }));
    await s.shot('S&OP: мощности и запас');
    await page.evaluate(() => document.querySelector('[data-test=sop-cash]')?.scrollIntoView({ block: 'center' }));
    await s.shot('S&OP: деньги и люди под план');

    // правка цели клетки: парацетамол, первый месяц — другая цель; окно пересчитывает
    await page.evaluate(() => document.querySelector('[data-test=sop-plan]')?.scrollIntoView({ block: 'center' }));
    const was = await page.evaluate(p => ({ c: window.__game.store.get().sop.view.cover[p][0], v: window.__game.store.get().sop.view.value }), PARA);
    const to = was.c === 35 ? 28 : 35;
    await s.measure('Цель клетки — пересчёт', () => page.selectOption(`[data-test=sop-cell][data-product="${PARA}"][data-i="0"]`, String(to)), 'drafted', [PARA, 0, to]);
    const drafted = await page.evaluate(() => ({ gap: document.querySelector('[data-test=sop-result]')?.getAttribute('data-gap') ?? '', text: document.querySelector('[data-test=sop-gap]')?.textContent ?? '', value: window.__game.store.get().sop.view.value }));
    await s.shot('S&OP: своя цель клетки');
    if (drafted.gap === '' || Number(drafted.gap) < 0 || !/^До лучшего плана — [\d\s ]+ ₽$/.test(drafted.text)) fail(`черновик: ${JSON.stringify(drafted)}`);
    else ok(`черновик: запас парацетамола в первом месяце ${was.c} → ${to} суток, цель плана ${was.v} → ${drafted.value} коп.; «${drafted.text}»`);

    // «Утвердить» — план завода; запись журнала «вы»
    await s.measure('«Утвердить»', () => page.click('[data-test=sop-approve]'), 'approved');
    const plan = await page.evaluate(() => window.__game.store.get().sop.view.approved);
    await s.shot('S&OP: план утверждён');
    if (!plan || plan.by !== 'player' || plan.cover['prd.paracetamol500'][0] !== to) fail(`утверждён: ${JSON.stringify(plan)}`);
    else ok(`утверждён: запас — ${Object.entries(plan.cover).map(([p, xs]) => `${p.replace('prd.', '')} ${xs.join(', ')}`).join('; ')}`);
    await page.keyboard.press('Escape');
    await s.openJournal();
    const rec = await page.evaluate(() => document.querySelector('[data-test=journal-row][data-kind=sop][data-by=player]')?.textContent ?? '');
    await s.shot('Журнал: план S&OP');
    if (!/План S&OP с сентября 2027: запас — /.test(rec)) fail(`журнал: «${rec}»`);
    else ok(`журнал: «${rec.slice(0, 160)}»`);
    await page.keyboard.press('Escape');

    // через неделю задание начальника — с запасом позиций из плана S&OP: «До утра» до 10 сентября
    for (let i = 0; i < 20 && (await page.evaluate(() => window.__game.store.get().day)) < 10; i++) await s.untilMorning();
    for (let k = 0; k < 4 && (await page.evaluate(() => { const h = window.__game.store.get(); return h.morning.open || !!h.selected || h.sop.open; })); k++) await page.keyboard.press('Escape');
    await s.openJournal();
    const row = '[data-test=journal-row][data-kind=order][data-by=plan]';
    if (!(await page.evaluate(r => !!document.querySelector(r), row))) {
      fail('журнал: заданий начальника отдела планирования нет');
      return;
    }
    await page.click(`${row} [data-test=journal-more]`);
    await page.waitForSelector(`${row} [data-test=journal-why]`, { timeout: 20_000 });
    const why = await page.evaluate(r => document.querySelector(`${r} [data-test=journal-why]`)?.textContent ?? '', row);
    await s.shot('Журнал: задание по плану S&OP');
    if (!why.includes('Запас позиций продукта — из утверждённого плана S&OP')) fail(`журнал: причина задания — «${why}»`);
    else ok(`задание по плану — ${await s.clock()}: «${why.slice(0, 200)}»`);
    await page.keyboard.press('Escape');
  } finally {
    await ctx.close();
  }
}
