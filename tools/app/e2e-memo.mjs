// Сценарий в браузере, часть «Записки и вопросы» (Б5д; docs/specs/2026-10-vertical-slice.md, «Б5д», «Проверки Б5д»): два
// чистых окна, как при первом запуске. В первом — директор с постом «Производство», отделы производства «сам» полосой
// режимов журнала: «До события» до вопроса начальника ООК о расследовании OOS — «Веду сам», и шагов ООК на доске больше
// нет; дальше — до вопроса главного механика о замене пуансонов перед работой пресса — «Заменить сейчас», в карточке
// пресса — замена. Во втором — пост «Качество и технология»: карточка пресса, «Записка: заменить» — «ответит в …»; «До
// события» — мир встаёт на ответе в час главного механика, в журнале — его запись «по записке», в карточке — ответ. Отклик
// кнопок записки и ответа — в кадрах (геймдизайн, §21). Снимки — tools/app/out/memo-*.png, лист — tools/app/out/memo.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Пороги отклика — в кадрах, как у части «Первая неделя» (tools/app/e2e-week.mjs): числа — геймдизайн, §21. */
const FRAMES = { input: 6, command: 15 };

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function memoPart({ browser, port, out, ok, fail, errors, requests, q }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  await director({ browser, port, out, ok, fail, errors, requests, q, shots, feel });
  await quality({ browser, port, out, ok, fail, errors, requests, q, shots, feel });
  ok(`записки и вопросы, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  // лист снимков: по три в ряд, подпись — шаг и часы завода
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'memo.png'), fullPage: true });
  await lister.close();
  ok(`записки и вопросы: ${shots.length} снимков → ${join(out, 'memo.png')}`);
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
    // пресс — по номеру в плане завода сценария
    window.pressAt = () => window.__game.layout.plan.plant.equipment.findIndex(e => e.id === 'press-1');
    window.__seen = {
      // ответ на вопрос (Б5д): у строки журнала — «вы выбрали …»
      answered: n => !!document.querySelector(`#journal [data-test=journal-row][data-n="${n}"] [data-test=q-end][data-how=player]`),
      // записка ушла: в полосе — извещение «Записка …»
      memo: () => /^Записка /.test(h().notices[0]?.text ?? '') && !!document.querySelector('[data-test=notice]'),
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

/** Общие шаги окна: кадры, часы, отклик, снимок, «До события», журнал, места. */
function steps(page, { out, fail, shots, feel }, tag) {
  const frames = n => page.evaluate(k => new Promise(r => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);
  const clock = () => page.evaluate(() => `${document.querySelector('[data-test=date]')?.textContent ?? ''} ${document.querySelector('[data-test=clock]')?.textContent ?? ''}`);
  return {
    frames,
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
      const file = join(out, `memo-${tag}-${String(shots.length + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file });
      shots.push({ file, label: `${shots.length + 1}. ${what} · ${await clock()}` });
    },
    /** «До события» (6): до следующей автопаузы места; планёрку — закрыть. Возвращает извещение, на котором мир встал. */
    untilEvent: async () => {
      if (await page.evaluate(() => window.__game.store.get().morning.open)) await page.keyboard.press('Escape');
      await page.keyboard.press('Digit6');
      await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
      await frames(1);
      return page.evaluate(() => window.__game.store.get().notices.find(n => n.stop));
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
 * Директор с «Производством»: вопрос об OOS — «Веду сам», шагов ООК нет; вопрос о замене пуансонов — «Заменить сейчас».
 */
async function director(x) {
  const { ok, fail } = x;
  const { ctx, page } = await openGame(x);
  const s = steps(page, x, 'dir');
  try {
    await s.seats(['production', 'director']);
    // отделы производства «сам»: завод живёт, как без мест, — вопросы приходят в свой час, а не предложения каждое утро
    await s.openJournal();
    for (const head of ['plan', 'mes', 'maint']) {
      await page.waitForSelector(`[data-test=journal-modes] [data-head=${head}]`, { timeout: 20_000 });
      if ((await page.getAttribute(`[data-test=journal-modes] [data-head=${head}]`, 'data-mode')) !== 'auto') await page.click(`[data-test=journal-modes] [data-head=${head}] button[data-mode=auto]`);
      await page.waitForSelector(`[data-test=journal-modes] [data-head=${head}][data-mode=auto]`, { timeout: 20_000 });
    }
    await page.keyboard.press('Escape');

    // «До события» до вопроса начальника ООК: директору, извещение с автопаузой ведёт в журнал на вопрос
    let ask;
    for (let i = 0; i < 80 && !ask; i++) {
      const n = await s.untilEvent();
      if (n && /^Просят решить: начальник ООК/.test(n.text)) ask = n;
    }
    if (!ask) {
      fail('вопрос об OOS: до 10 сентября его не было');
      return;
    }
    const speed = await page.evaluate(() => window.__game.speed);
    await page.click('[data-test=notice]');
    await page.waitForSelector(`#journal [data-test=journal-row][data-n="${ask.go?.journal}"] [data-test=q-open][data-fork=oos]`, { timeout: 20_000 });
    const row = `#journal [data-test=journal-row][data-n="${ask.go.journal}"]`;
    const open = await page.evaluate(r => document.querySelector(r)?.innerText.replace(/\s*\n\s*/g, ' · ') ?? '', row);
    await s.shot('Просят решить: кто ведёт OOS');
    // доска: шаги до ответа — их делает ООК
    const boardSteps = async () => {
      await page.keyboard.press('KeyI');
      await page.waitForFunction(() => !!window.__game.store.get().inv.view?.board && !!document.querySelector('#inv'), null, { timeout: 20_000 });
      await s.frames(1);
      const v = await page.evaluate(() => window.__game.store.get().inv.view.board.steps.filter(x => x.state !== 'can').map(x => `${x.id}:${x.state}`));
      await page.keyboard.press('Escape');
      return v;
    };
    await s.openJournal();
    await s.measure('«Веду сам» — ответ на вопрос', () => page.click(`${row} [data-test=q-open] [data-opt=self] [data-test=q-answer]`), 'answered', ask.go.journal);
    const after = await page.evaluate(r => document.querySelector(`${r} [data-test=q-end]`)?.textContent ?? '', row);
    await page.keyboard.press('Escape');
    const before = await boardSteps();
    // сутки: шагов ООК больше нет — новые шаги начал бы только игрок
    await page.evaluate(() => window.__game.actions.setSpeed(4));
    const t0 = await page.evaluate(() => window.__game.t);
    await page.waitForFunction(t => window.__game.t >= t + 86400 || window.__game.speed === 0, t0, { timeout: 120_000 });
    await page.evaluate(() => window.__game.actions.setSpeed(0));
    if (await page.evaluate(() => window.__game.store.get().morning.open)) await page.keyboard.press('Escape');
    const later = await boardSteps();
    await s.shot('«Веду сам»: доска без шагов ООК');
    if (speed !== 0 || !/Ведите/.test(open) || !/Веду сам/.test(open) || !/вы выбрали «Веду сам»/.test(after) || later.join() !== before.join())
      fail(`вопрос об OOS: мир ${speed === 0 ? 'стоит' : 'идёт'}, строка «${open.slice(0, 200)}», ответ «${after}», шаги до ${before.join(', ')} и через сутки ${later.join(', ')}`);
    else ok(`вопрос об OOS: «${open.slice(0, 160)}»; «${after}» — через сутки шаги те же: ${before.join(', ') || 'нет'}`);

    // до вопроса главного механика о замене пуансонов — «Заменить сейчас»: в карточке пресса замена
    let rep;
    for (let i = 0; i < 80 && !rep; i++) {
      const n = await s.untilEvent();
      if (n && /^Просят решить: главный механик/.test(n.text) && /Пуансоны/i.test(n.text)) rep = n;
    }
    if (!rep) {
      fail('вопрос о замене пуансонов: до середины сентября его не было');
      return;
    }
    await page.click('[data-test=notice]');
    const rrow = `#journal [data-test=journal-row][data-n="${rep.go?.journal}"]`;
    await page.waitForSelector(`${rrow} [data-test=q-open][data-fork=replace]`, { timeout: 20_000 });
    const ropen = await page.evaluate(r => document.querySelector(r)?.innerText.replace(/\s*\n\s*/g, ' · ') ?? '', rrow);
    await s.shot('Просят решить: замена пуансонов');
    await s.measure('«Заменить сейчас» — ответ на вопрос', () => page.click(`${rrow} [data-test=q-open] [data-opt=now] [data-test=q-answer]`), 'answered', rep.go.journal);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__game.actions.select({ kind: 'equipment', i: pressAt() }));
    await page.waitForSelector('[data-test=card-parts] [data-part=punches]', { timeout: 20_000 });
    const part = await page.evaluate(() => document.querySelector('[data-test=card-parts] [data-part=punches]')?.textContent ?? '');
    await s.shot('Пресс: замена пуансонов');
    await page.keyboard.press('Escape');
    if (!/После работы/.test(ropen) || !/Заменить сейчас/.test(ropen) || !/риск отказа/.test(ropen) || !/замена/.test(part))
      fail(`вопрос о замене: строка «${ropen.slice(0, 220)}», пуансоны «${part}»`);
    else ok(`вопрос о замене: «${ropen.slice(0, 160)}»; «Заменить сейчас» — пуансоны «${part.trim()}»`);
  } finally {
    await ctx.close();
  }
}

/** «Качество и технология»: «Записка: заменить» у пресса — ответ главного механика в его час, запись «по записке». */
async function quality(x) {
  const { ok, fail } = x;
  const { ctx, page } = await openGame(x);
  const s = steps(page, x, 'qa');
  try {
    await s.seats(['quality']);
    await page.evaluate(() => window.__game.actions.select({ kind: 'equipment', i: pressAt() }));
    const btn = '[data-test=card-parts] [data-part=punches] [data-test=card-replace]';
    await page.waitForSelector(btn, { timeout: 20_000 });
    const label = await page.evaluate(b => ({ text: document.querySelector(b)?.textContent ?? '', memo: document.querySelector(b)?.getAttribute('data-memo'), title: document.querySelector(b)?.getAttribute('title') ?? '' }), btn);
    await s.measure('«Записка: заменить» — записка ушла', () => page.click(btn), 'memo');
    const note = await page.evaluate(() => window.__game.store.get().notices[0]?.text ?? '');
    await s.frames(2);
    const pending = await page.evaluate(() => document.querySelector('[data-test=card] [data-test=who-memo][data-how=open]')?.textContent ?? '');
    await s.shot('Пресс: «Записка: заменить»');
    await page.keyboard.press('Escape');
    if (label.text !== 'Записка: заменить' || label.memo !== 'maint' || !/главному механику: ответит/.test(label.title) || !/^Записка главному механику: ответит /.test(note) || !/ответит /.test(pending))
      fail(`записка: кнопка «${label.text}» (${label.memo}), подсказка «${label.title}», извещение «${note}», в карточке «${pending}»`);
    else ok(`записка: кнопка «${label.text}» — «${label.title}»; извещение «${note}»; в карточке «${pending.trim()}»`);
    // «До события» — ответ в час главного механика: мир встаёт, щелчок — журнал на записке
    let done;
    for (let i = 0; i < 6 && !done; i++) {
      const n = await s.untilEvent();
      if (n && /ответил на записку/.test(n.text)) done = n;
    }
    if (!done) {
      fail('ответ на записку: мир на нём не встал');
      return;
    }
    const at = await page.evaluate(() => `${document.querySelector('[data-test=date]')?.textContent ?? ''} ${document.querySelector('[data-test=clock]')?.textContent ?? ''}`);
    await page.click('[data-test=notice]');
    const row = `#journal [data-test=journal-row][data-n="${done.go?.journal}"]`;
    await page.waitForSelector(`${row} [data-test=memo-end][data-how=answered]`, { timeout: 20_000 });
    const answer = await page.evaluate(r => document.querySelector(`${r} [data-test=memo-end]`)?.textContent ?? '', row);
    const via = await page.evaluate(n => {
      const r = window.__game.store.get().journal.view?.rows.find(x => x.via?.n === n);
      return r ? { by: r.by, kind: r.d.kind, text: document.querySelector(`#journal [data-test=journal-row][data-n="${r.n}"]`)?.innerText.replace(/\s*\n\s*/g, ' · ') ?? '' } : undefined;
    }, done.go.journal);
    await s.shot('Журнал: ответ на записку');
    await page.keyboard.press('Escape');
    if (!/выполнено/.test(answer) || via?.by !== 'maint' || via.kind !== 'replace' || !/по записке поста «Качество и технология» №/.test(via.text) || !/ 09:00$/.test(at))
      fail(`ответ на записку (${at}): «${answer}», запись руководителя ${JSON.stringify(via)}`);
    else ok(`ответ на записку — ${at}: «${answer.slice(0, 120)}»; запись главного механика — «${via.text.slice(0, 160)}»`);
  } finally {
    await ctx.close();
  }
}
