// Сценарий в браузере, часть «CAPA» (Б5е; docs/specs/2026-10-vertical-slice.md, «Б5е», «Проверки Б5е»): чистое окно,
// как при первом запуске, пост «Качество и технология». «До события» до второго МОК прочности при таблетировании; его
// карточка — класс, признак «Износ пуансонов и матриц» в записях завода; оценка «без влияния» с этой причиной; «Назначить
// CAPA» — «Заменять узел раньше»; главный механик выполняет её в свой час — в «Политиках» порог замены пуансонов стал
// ниже; «До утра» — через три месяца в карточке запись проверки эффективности. Отклик кнопок — в кадрах (геймдизайн,
// §21). Снимки — tools/app/out/capa-*.png, лист — tools/app/out/capa.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Пороги отклика — в кадрах, как у части «Первая неделя» (tools/app/e2e-week.mjs): числа — геймдизайн, §21. */
const FRAMES = { input: 6, command: 15 };
const HARD = 'Прочность на раздавливание (МОК)';
const PUNCHES = 'press-1/punches';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function capaPart({ browser, port, out, ok, fail, errors, requests, q }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  await quality({ browser, port, out, ok, fail, errors, requests, q, shots, feel });
  ok(`CAPA, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  // лист снимков: по три в ряд, подпись — шаг и часы завода
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'capa.png'), fullPage: true });
  await lister.close();
  ok(`CAPA: ${shots.length} снимков → ${join(out, 'capa.png')}`);
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
    window.__seen = {
      // оценка начата: в карточке — «специалист ООК делает оценку»
      assessing: () => !!document.querySelector('[data-test=card] [data-test=dev-assess]'),
      // CAPA назначена: в карточке — её строка
      capa: a => !!document.querySelector(`[data-test=card] [data-test=dev-capa][data-action="${a}"]`),
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

/** Общие шаги окна: кадры, часы, отклик, снимок, «До события» и «До утра», карточка отклонения, места. */
function steps(page, { out, fail, shots, feel }) {
  const frames = n => page.evaluate(k => new Promise(r => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);
  const clock = () => page.evaluate(() => `${document.querySelector('[data-test=date]')?.textContent ?? ''} ${document.querySelector('[data-test=clock]')?.textContent ?? ''}`);
  const closeMorning = async () => {
    if (await page.evaluate(() => window.__game.store.get().morning.open)) await page.keyboard.press('Escape');
  };
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
      const file = join(out, `capa-${String(shots.length + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file });
      shots.push({ file, label: `${shots.length + 1}. ${what} · ${await clock()}` });
    },
    /** «До события» (6): до следующей автопаузы места; планёрку — закрыть. */
    untilEvent: async () => {
      await closeMorning();
      await page.keyboard.press('Digit6');
      await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
      await frames(1);
    },
    /** «До утра» (5): до 08:00 или до автопаузы по дороге; планёрку — закрыть. */
    untilMorning: async () => {
      await closeMorning();
      await page.keyboard.press('Digit5');
      await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
      await frames(1);
      await closeMorning();
    },
    /** Карточка отклонения `n`: открыть и дождаться её вида. */
    dev: async n => {
      await page.evaluate(k => window.__game.actions.select({ kind: 'dev', n: k }), n);
      await page.waitForFunction(k => window.__game.store.get().card?.card?.kind === 'dev' && window.__game.store.get().card.card.dev === k, n, { timeout: 20_000 });
      await frames(2);
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
 * «Качество и технология»: второй МОК прочности — карточка, причина по признаку, оценка, CAPA «Заменять узел раньше»;
 * главный механик выполнил — порог пуансонов в «Политиках»; через три месяца — проверка эффективности в карточке.
 */
async function quality(x) {
  const { ok, fail } = x;
  const { ctx, page } = await openGame(x);
  const s = steps(page, x);
  try {
    await s.seats(['quality']);
    // отклонения из извещений полосы: номера — по ссылке извещения на карточку; МОК прочности — по карточке
    const seen = new Set();
    const hard = [];
    for (let i = 0; i < 60 && hard.length < 2; i++) {
      await s.untilEvent();
      const ns = await page.evaluate(() => window.__game.store.get().notices.flatMap(n => (n.go?.thing?.kind === 'dev' ? [n.go.thing.n] : [])));
      for (const n of [...new Set(ns)].sort((a, b) => a - b)) {
        if (seen.has(n)) continue;
        seen.add(n);
        await s.dev(n);
        if ((await page.evaluate(() => document.querySelector('[data-test=dev-what]')?.textContent ?? '')).includes(HARD)) hard.push(n);
        await page.keyboard.press('Escape');
      }
    }
    if (hard.length < 2) {
      fail(`CAPA: второго МОК прочности нет, отклонения ${[...seen].join(', ')}`);
      return;
    }
    const n = hard[1];
    // ждать, пока оценку можно сделать: лаборатория решила балк
    const can = () => page.evaluate(() => document.querySelector('[data-test=dev-none]')?.disabled === false);
    await s.dev(n);
    for (let i = 0; i < 60 && !(await can()); i++) {
      await page.keyboard.press('Escape');
      await s.untilEvent();
      await s.dev(n);
    }
    if (!(await can())) {
      fail(`CAPA: оценить ${n} нельзя и через 60 событий`);
      return;
    }
    const card = await page.evaluate(() => ({
      cls: document.querySelector('[data-test=dev-cls]')?.getAttribute('data-cls') ?? '',
      clsText: document.querySelector('[data-test=dev-cls]')?.closest('dd')?.textContent ?? '',
      signs: [...document.querySelectorAll('[data-test=dev-signs] li')].map(e => e.textContent ?? ''),
      pick: !!document.querySelector('[data-test="dev-cause-cause.press.tooling"]'),
      cause: document.querySelector('[data-test=dev-cause]')?.textContent ?? '',
    }));
    await s.shot('Второй МОК прочности: класс и признаки');
    if (card.cls !== 'major' || !card.signs.some(t => /Износ пуансонов/.test(t)) || !card.pick || !/запишут при оценке/.test(card.cause))
      fail(`карточка: класс ${card.cls} «${card.clsText}», признаки ${card.signs.join('; ')}, выбор ${card.pick}, причина «${card.cause}»`);
    else ok(`карточка ОТК-${String(n).padStart(4, '0')}: «${card.clsText.trim()}», признаки — ${card.signs.join('; ')}`);
    await page.click('[data-test="dev-cause-cause.press.tooling"]');
    await s.measure('«Без влияния на качество» — оценка с причиной', () => page.click('[data-test=dev-none]'), 'assessing');
    // оценка сделана — у отклонения причина, и «Заменять узел раньше» подходит
    const option = '[data-test=dev-capa-option][data-action="capa.earlier"]';
    for (let i = 0; i < 20 && !(await page.$(option)); i++) {
      await page.evaluate(() => window.__game.actions.setSpeed(3));
      await page.waitForFunction(o => !!document.querySelector(o) || window.__game.speed === 0, option, { timeout: 120_000 }).catch(() => {});
      await page.evaluate(() => window.__game.actions.setSpeed(0));
      await s.dev(n);
    }
    const priced = await page.evaluate(o => document.querySelector(o)?.textContent ?? '', option);
    const assessed = await page.evaluate(() => ({ cause: document.querySelector('[data-test=dev-cause]')?.textContent ?? '', cls: document.querySelector('[data-test=dev-cls]')?.getAttribute('data-cls') ?? '' }));
    if (!priced || !/Износ пуансонов/.test(assessed.cause) || !/порог .+ → 80\s?%/.test(priced))
      fail(`оценка: причина «${assessed.cause}», класс ${assessed.cls}, действие «${priced}»`);
    else ok(`оценка: причина «${assessed.cause}», класс ${assessed.cls}; действие — «${priced.trim()}»`);
    await s.measure('«Назначить CAPA» — «Заменять узел раньше»', () => page.click(`${option} [data-test=dev-capa-assign]`), 'capa', 'capa.earlier');
    const row = '[data-test=card] [data-test=dev-capa][data-action="capa.earlier"]';
    const assigned = await page.evaluate(r => document.querySelector(r)?.textContent ?? '', row);
    await s.shot('CAPA «Заменять узел раньше» назначена');
    if (!/исполняет главный механик; назначил вы/.test(assigned) || !/Пуансоны/.test(assigned)) fail(`CAPA: строка «${assigned}»`);
    else ok(`CAPA: «${assigned.slice(0, 180)}»`);
    // главный механик выполняет её в свой час: «До события» и «До утра», пока строка не станет «выполнена»
    const done = () => page.evaluate(r => document.querySelector(r)?.getAttribute('data-done') === '1', row);
    for (let i = 0; i < 30 && !(await done()); i++) {
      await page.keyboard.press('Escape');
      await s.untilMorning();
      await s.dev(n);
    }
    const run = await page.evaluate(r => document.querySelector(r)?.textContent ?? '', row);
    if (!(await done()) || !/выполнена .+ главный механик/.test(run)) {
      fail(`CAPA не выполнена: «${run}»`);
      return;
    }
    ok(`CAPA выполнена: «${run.slice(0, 200)}»`);
    await page.keyboard.press('Escape');
    // «Политики» (P), главный механик: порог замены пуансонов — по CAPA
    await page.keyboard.press('KeyP');
    await page.waitForSelector('#policies', { timeout: 20_000 });
    await page.click('[data-test=policy-tab][data-head=maint]');
    const pol = `[data-test=policy-row][data-policy="pol.maint.replace"][data-of="${PUNCHES}"]`;
    await page.waitForSelector(pol, { timeout: 20_000 });
    const policy = await page.evaluate(p => ({ v: document.querySelector(p)?.getAttribute('data-value') ?? '', text: document.querySelector(p)?.textContent ?? '' }), pol);
    await s.shot('Политики главного механика: порог пуансонов по CAPA');
    await page.keyboard.press('Escape');
    // кто задал — исполнитель по номеру CAPA, а не игрок
    const by = /главный механик по CAPA \d+, с \d\d\.\d\d \d\d:\d\d/.exec(policy.text.replace(/\s+/g, ' '))?.[0];
    if (policy.v !== '8000' || !by) fail(`политика пуансонов: ${policy.v} «${policy.text}»`);
    else ok(`политика пуансонов — 80 %, задал ${by}`);
    // через три месяца — проверка эффективности: извещение и запись в карточке
    const checked = () => page.evaluate(() => window.__game.store.get().notices.some(m => /^CAPA по ОТК-\d+ (эффективна|не эффективна)/.test(m.text)));
    for (let i = 0; i < 400 && !(await checked()); i++) await s.untilMorning();
    if (!(await checked())) {
      fail('проверка эффективности: за 400 «До утра» её не было');
      return;
    }
    await s.dev(n);
    const check = await page.evaluate(r => ({ text: document.querySelector(`${r} [data-test=dev-capa-check]`)?.textContent ?? '', ok: document.querySelector(`${r} [data-test=dev-capa-check]`)?.getAttribute('data-ok') }), row);
    // на снимке — сама запись проверки, а не верх карточки
    await page.evaluate(r => document.querySelector(`${r} [data-test=dev-capa-check]`)?.scrollIntoView({ block: 'center' }), row);
    await s.shot('Проверка эффективности CAPA');
    await page.keyboard.press('Escape');
    if (!/эффективна/.test(check.text)) fail(`проверка эффективности: «${check.text}»`);
    else ok(`проверка эффективности — ${await s.clock()}: «${check.text.replace(/^\s*·\s*/, '')}»`);
  } finally {
    await ctx.close();
  }
}
