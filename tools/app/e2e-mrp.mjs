// Сценарий в браузере, часть «Материалы» (Б6д; docs/specs/2026-10-vertical-slice.md, «Б6д», «Проверки Б6д»): чистое окно,
// как при первом запуске, место «Директор» — поста «Снабжение и склад» в сценарии нет. «До утра» — 2 сентября 08:00: в
// пути заказы правила первого дня, на планёрке — блок «Материалы». Расписание (G), вкладка «Материалы»: 12 месяцев,
// материалы по видам, необеспеченная — красным, плановые заказы по поставщикам и заказы в пути с сообщениями.
// «Заказать» — окно «Заказ поставщику» со строками плановых заказов поставщика; «Отправить» — заказ в пути. «Ускорить» —
// новый день прихода и запись журнала с доплатой. Отклик — в кадрах (геймдизайн, §21). Снимки — tools/app/out/mrp-*.png,
// лист — tools/app/out/mrp.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Пороги отклика — в кадрах, как у части «Первая неделя» (tools/app/e2e-week.mjs): числа — геймдизайн, §21. */
const FRAMES = { input: 6, command: 15 };

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function mrpPart({ browser, port, out, ok, fail, errors, requests, q }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  await director({ browser, port, out, ok, fail, errors, requests, q, shots, feel });
  ok(`Материалы, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'mrp.png'), fullPage: true });
  await lister.close();
  ok(`Материалы: ${shots.length} снимков → ${join(out, 'mrp.png')}`);
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
    const m = () => h().gantt.mrp;
    window.__seen = {
      // вкладка «Материалы» открыта, её вид пришёл и сетка нарисована
      mrp: () => h().gantt.tab === 'mrp' && !!m() && document.querySelectorAll('[data-test=mrp-row]').length > 0,
      // окно «Заказ поставщику» с поставщиком и строками плановых заказов, ответ завода пришёл
      po: ([supplier, n]) => h().po.open && h().po.supplier === supplier && h().po.lines.length === n && !!h().po.view && document.querySelectorAll('[data-test=po-line]').length === n,
      // заказ отправлен: во вкладке — заказом в пути больше
      sent: n => (m()?.pos.length ?? 0) > n && document.querySelectorAll('[data-test=mrp-po]').length > n,
      // ускорен: у заказа в пути — новый приход и «ускорен»
      fast: ([po, eta]) => m()?.pos.find(p => p.po === po)?.fast === true && m().pos.find(p => p.po === po).eta === eta && !!document.querySelector(`[data-test=mrp-po][data-po="${po}"] small`),
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

/** Общие шаги окна: кадры, часы, отклик, снимок, места, «До утра». */
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
      const file = join(out, `mrp-${String(shots.length + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file });
      shots.push({ file, label: `${shots.length + 1}. ${what} · ${await clock()}` });
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
    /** «До утра» (5): до 08:00 или до автопаузы по дороге. */
    untilMorning: async () => {
      for (let k = 0; k < 4 && (await page.evaluate(() => { const h = window.__game.store.get(); return h.morning.open || h.journal.open || h.sop.open || !!h.selected; })); k++) await page.keyboard.press('Escape');
      await page.keyboard.press('Digit5');
      await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
      await frames(2);
    },
  };
}

/**
 * «Директор»: 2 сентября 08:00 — блок планёрки; вкладка «Материалы»; «Заказать» — окно заказа со строками плановых
 * заказов, «Отправить» — заказ в пути; «Ускорить» — новый приход, «ускорен» и запись журнала с доплатой.
 */
async function director(x) {
  const { ok, fail } = x;
  const { ctx, page } = await openGame(x);
  const s = steps(page, x);
  try {
    await s.seats(['director']);
    await s.untilMorning();
    // планёрка 2 сентября: заказы правила первого дня в пути; блок «Материалы» — если что-то опоздает или пора заказать
    await page.waitForFunction(() => !!window.__game.store.get().morning.view, null, { timeout: 30_000 });
    const meet = await page.evaluate(() => document.querySelector('[data-test=morning-materials]')?.textContent ?? '');
    if (meet) {
      await page.evaluate(() => document.querySelector('[data-test=morning-materials]')?.scrollIntoView({ block: 'center' }));
      await s.shot('Планёрка: блок «Материалы»');
      ok(`планёрка — ${await s.clock()}: «${meet.slice(0, 200)}»`);
    } else ok(`планёрка — ${await s.clock()}: заказывать сегодня нечего, опаздывающих заказов нет`);
    for (let k = 0; k < 4 && (await page.evaluate(() => { const h = window.__game.store.get(); return h.morning.open || !!h.selected; })); k++) await page.keyboard.press('Escape');

    // расписание (G), вкладка «Материалы»
    await page.keyboard.press('KeyG');
    await page.waitForSelector('[data-test=gantt-tab-mrp]', { timeout: 20_000 });
    await s.measure('Вкладка «Материалы»', () => page.click('[data-test=gantt-tab-mrp]'), 'mrp');
    const grid = await page.evaluate(() => {
      const v = window.__game.store.get().gantt.mrp;
      return {
        how: document.querySelector('[data-test=mrp-how]')?.textContent ?? '',
        months: document.querySelectorAll('[data-test=mrp-grid] thead th[data-month]').length,
        rows: document.querySelectorAll('[data-test=mrp-row]').length,
        kinds: document.querySelectorAll('[data-test=mrp-grid] tr.mrp-kind').length,
        net: document.querySelectorAll('[data-test=mrp-cell][data-net]').length,
        suppliers: document.querySelectorAll('[data-test=mrp-supplier]').length,
        planned: document.querySelectorAll('[data-test=mrp-planned-row]').length,
        pos: document.querySelectorAll('[data-test=mrp-po]').length,
        msgs: [...document.querySelectorAll('[data-test=mrp-po-msgs]')].map(e => e.textContent).filter(t => t !== '—'),
        viewPos: v?.pos.length ?? 0,
        tip: document.querySelector('[data-test=mrp-cell][data-net]')?.getAttribute('title') ?? '',
      };
    });
    await s.shot('Расписание: вкладка «Материалы»');
    if (!/^Снабжение заказывает по потребности; срок завоза — к 25-му числу предыдущего месяца$/.test(grid.how) || grid.months !== 12 || grid.rows < 16 || grid.kinds !== 3 || grid.net === 0 || grid.suppliers === 0 || grid.pos === 0 || grid.pos !== grid.viewPos || !/^Потребность месяца — /.test(grid.tip))
      fail(`вкладка «Материалы»: ${JSON.stringify(grid)}`);
    else ok(`вкладка «Материалы»: «${grid.how}»; месяцев ${grid.months}, материалов ${grid.rows} в ${grid.kinds} видах, клеток с необеспеченной ${grid.net}, плановых заказов ${grid.planned} у ${grid.suppliers} поставщиков, в пути ${grid.pos}; сообщения: ${grid.msgs.join(' | ').slice(0, 200)}`);
    await page.evaluate(() => document.querySelector('[data-test=mrp-planned]')?.scrollIntoView({ block: 'center' }));
    await s.shot('Материалы: плановые заказы и заказы в пути');

    // «Заказать» — у первого поставщика, у кого есть что заказать в ближайшую неделю: окно «Заказ поставщику» со строками
    // по материалу; «Отправить» — заказ в пути
    const sup = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-test=mrp-supplier]')].find(e => Number(e.getAttribute('data-soon')) > 0);
      return el ? { id: el.getAttribute('data-supplier'), n: Number(el.getAttribute('data-soon')) } : undefined;
    });
    if (!sup) {
      fail('заказывать в ближайшую неделю нечего ни у одного поставщика');
      return;
    }
    await s.measure('«Заказать» — окно заказа', () => page.click(`[data-test=mrp-supplier][data-supplier="${sup.id}"] [data-test=mrp-order]`), 'po', [sup.id, sup.n]);
    await page.waitForSelector('[data-test=po-send]:not([disabled])', { timeout: 20_000 }).catch(() => {});
    const form = await page.evaluate(() => ({ lines: [...document.querySelectorAll('[data-test=po-line]')].map(e => e.getAttribute('data-material')), sum: document.querySelector('[data-test=po-sum]')?.textContent ?? '', send: !document.querySelector('[data-test=po-send]')?.hasAttribute('disabled') }));
    await s.shot('«Заказ поставщику»: строки плановых заказов');
    if (!form.send || form.lines.length !== sup.n) fail(`окно заказа: ${JSON.stringify(form)}`);
    else ok(`окно заказа — ${sup.id}: строк ${form.lines.length} (${form.lines.join(', ')}); «${form.sum.slice(0, 120)}»`);
    const before = await page.evaluate(() => window.__game.store.get().gantt.mrp.pos.length);
    await s.measure('«Отправить»', () => page.click('[data-test=po-send]'), 'sent', before);
    if (await page.evaluate(() => window.__game.store.get().po.open)) await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector('[data-test=mrp-transit]')?.scrollIntoView({ block: 'center' }));
    await s.shot('Материалы: новый заказ в пути');
    ok(`отправлен: в пути ${before} → ${await page.evaluate(() => window.__game.store.get().gantt.mrp.pos.length)}`);

    // «Ускорить» — заказ, что придёт позже всех: новый приход через 7 суток, «ускорен»; запись журнала «вы» с доплатой
    const fast = await page.evaluate(() => {
      const v = window.__game.store.get().gantt.mrp;
      const p = [...v.pos].filter(x => !('why' in x.speed)).sort((a, b) => b.eta - a.eta)[0];
      return p ? { po: p.po, was: p.eta, eta: p.speed.eta, fee: p.speed.fee } : undefined;
    });
    if (!fast) {
      fail('ускорить нечего: у всех заказов в пути — отказ');
      return;
    }
    await s.measure('«Ускорить»', () => page.click(`[data-test=mrp-po][data-po="${fast.po}"] [data-test=mrp-expedite]`), 'fast', [fast.po, fast.eta]);
    await s.shot('Материалы: заказ ускорен');
    if (!(fast.eta < fast.was) || !(fast.fee > 0)) fail(`ускорение: ${JSON.stringify(fast)}`);
    else ok(`ускорен ${fast.po}: приход раньше на ${((fast.was - fast.eta) / 86400).toFixed(1)} сут., доплата ${Math.round(fast.fee / 100)} ₽`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyJ');
    await page.waitForSelector('[data-test=journal-row][data-kind=expedite][data-by=player]', { timeout: 20_000 }).catch(() => {});
    const row = '[data-test=journal-row][data-kind=expedite][data-by=player]';
    const rec = await page.evaluate(r => document.querySelector(r)?.textContent ?? '', row);
    if (rec) {
      await page.click(`${row} [data-test=journal-more]`).catch(() => {});
      await page.waitForSelector(`${row} [data-test=journal-why]`, { timeout: 20_000 }).catch(() => {});
    }
    const why = await page.evaluate(r => document.querySelector(`${r} [data-test=journal-why]`)?.textContent ?? '', row);
    await s.shot('Журнал: ускорение заказа');
    if (!/Ускорение заказа поставщику P\d+: .+ — приход .+ вместо /.test(rec) || !/Доплата [\d\s ]+\s₽ с НДС — уплачена сразу/.test(why)) fail(`журнал: «${rec}» · «${why}»`);
    else ok(`журнал: «${rec.slice(0, 160)}» · «${why}»`);
    await page.keyboard.press('Escape');
  } finally {
    await ctx.close();
  }
}
