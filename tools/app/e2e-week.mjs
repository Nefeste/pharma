// Сценарий в браузере, часть «Первая неделя» (docs/specs/2026-10-vertical-slice.md, «Первая неделя»): путь новичка от
// экрана «Кем вы будете» до итога игры на планёрке 8 сентября — целиком, в чистом окне: хранилище окна пусто, как при
// первом запуске. Место — «Качество и технология». Шаги: место; щелчок по паллете — карточка; первая планёрка в 08:00;
// справочник (F1) и «Сейчас» (N); лаборатория — «Поднять»; «До события» (6) — по автопаузам места: планёрки, два
// отклонения 3 сентября — карточка с пояснением, «Понятно»; расследование 7 сентября — три шага, вывод, разбор; планёрка
// 8 сентября — «За эту игру». Ощущение числами: отклик щелчка и клавиши, через сколько виден результат команды — в
// кадрах и миллисекундах; сколько секунд окна идут сутки на «До события». Снимок каждого шага — tools/app/out/week-*.png,
// лист — tools/app/out/week.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Пороги отклика — в кадрах: программная отрисовка без видеокарты рисует кадр за сотни миллисекунд, а число кадров от
 * ввода до ответа от видеокарты не зависит. Числа — геймдизайн, §21; здесь — сколько кадров они дают при 60 к/с.
 */
const FRAMES = { input: 6, command: 15 };

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function weekPart({ browser, port, out, ok, fail, errors, requests, q }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  // как в основной части: прокрутка в окне игры возвращает Promise (Electron 44)
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
    // счёт кадров и миг ввода: отклик меряется от события в окне до кадра, в котором ответ уже на экране
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
    // что считать ответом: проверки по имени — функциями здесь, а не строкой: страница запрещает `eval` (CSP)
    const h = () => window.__game.store.get();
    const board = () => h().inv.view?.board;
    window.__seen = {
      take: t0 => window.__game.t + window.__game.lag > t0 && !document.querySelector('#seats'),
      card: unit => h().card?.thing?.n === unit && !!document.querySelector('#card-title')?.textContent,
      ref: () => !!h().ref.view && !!document.querySelector('#ref'),
      now: () => !!h().now.view && !!document.querySelector('#now [data-test=now-row]'),
      rush: lot => !!h().lab.view?.rows.some(r => r.lot === lot && r.rush),
      dev: n => h().card?.card?.kind === 'dev' && h().card.card.dev === n,
      understood: () => !document.querySelector('[data-test=card-first]'),
      inv: () => !!board() && !!document.querySelector('#inv'),
      step: id => (board()?.steps.find(x => x.id === id)?.state ?? 'can') !== 'can',
      debrief: () => !!document.querySelector('[data-test=inv-debrief]'),
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

  const frames = n => page.evaluate(k => new Promise(r => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);
  const clock = () => page.evaluate(() => `${document.querySelector('[data-test=date]')?.textContent ?? ''} ${document.querySelector('[data-test=clock]')?.textContent ?? ''}`);
  /** Отклик: от ввода до первого кадра, в котором проверка `check` (`window.__seen`) верна, — мс и кадры. */
  const feel = [];
  const measure = async (label, act, check, arg, kind = 'input') => {
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
  };
  /** Снимок шага: файл, подпись — номер шага, что на нём и часы завода. */
  const shots = [];
  const shot = async (n, what) => {
    await frames(2);
    const file = join(out, `week-${String(n).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    shots.push({ file, label: `${n}. ${what} · ${await clock()}` });
  };
  /** «До события» (6): до следующей автопаузы места; сколько секунд окна это заняло и сколько прошло на заводе. */
  const ff = [];
  const untilEvent = async () => {
    const t0 = await page.evaluate(() => window.__game.t);
    const w0 = Date.now();
    await page.keyboard.press('Digit6');
    await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
    const t1 = await page.evaluate(() => window.__game.t);
    ff.push({ game: t1 - t0, wall: Date.now() - w0 });
    // извещения — новые первыми: то, на котором мир встал, — последнее со знаком паузы
    return page.evaluate(() => ({ morning: window.__game.store.get().morning.open, notice: window.__game.store.get().notices.find(n => n.stop), speed: window.__game.speed }));
  };
  const closeMorning = async () => {
    if (await page.evaluate(() => window.__game.store.get().morning.open)) await page.keyboard.press('Escape');
    await frames(1);
  };
  const started = Date.now();

  try {
    // 1. первый экран: загрузка — первый кадр; «Кем вы будете» открыт, мир стоит
    const w0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/index.html?q=${q}&lang=ru`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
    const load = Date.now() - w0;
    const day0 = await page.evaluate(() => window.__game.day);
    const at0 = await page.evaluate(() => ({ seats: window.__game.store.get().seats.open, speed: window.__game.speed, kept: localStorage.length }));
    if (!at0.seats || at0.speed !== 0 || at0.kept !== 0) fail(`первая неделя: «Кем вы будете» ${at0.seats ? 'открыт' : 'закрыт'}, скорость ${at0.speed}, в хранилище окна ${at0.kept} записей`);
    else ok(`первая неделя: окно с нуля, первый кадр через ${(load / 1000).toFixed(1)} с; «Кем вы будете» открыт, мир стоит`);
    await shot(1, 'Кем вы будете');

    // 2. место «Качество и технология» — «Взять»: часы пошли
    await page.click('[data-test=seat-tile][data-seat=quality]');
    const t0 = await page.evaluate(() => window.__game.t + window.__game.lag);
    await measure('«Взять» — часы пошли', () => page.click('[data-test=seats-take]'), 'take', t0, 'command');
    const held = await page.evaluate(() => window.__game.store.get().top?.seats?.join());
    if (held !== 'quality') fail(`первая неделя: место ${held}`);
    else ok('первая неделя: взяли «Качество и технологию» — экран закрыт, часы идут');

    // 3. щелчок по паллете на полу — её карточка; Esc
    await page.evaluate(() => window.__game.actions.setSpeed(0));
    const pt = await page.evaluate(() => {
      for (const p of window.__game.pallets) {
        const at = window.__game.clickPoint(p.unit);
        if (at) return { ...at, unit: p.unit };
      }
      return undefined;
    });
    if (!pt) fail('первая неделя: на экране нет паллеты, по которой можно щёлкнуть');
    else {
      await measure('щелчок по паллете — карточка', () => page.mouse.click(pt.x, pt.y), 'card', pt.unit);
      await shot(3, 'Щелчок по паллете — карточка');
      await page.keyboard.press('Escape');
    }

    // 4. ×4 до 08:00 — первая планёрка открылась сама, мир на паузе; Esc
    await page.keyboard.press('Digit4');
    await page.waitForFunction(() => window.__game.store.get().morning.open && !!window.__game.store.get().morning.view, null, { timeout: 60_000 });
    const m1 = await page.evaluate(() => ({ speed: window.__game.speed, sec: window.__game.t % 86400, first: !!window.__game.store.get().morning.view.first, session: !!document.querySelector('[data-test=morning-session]') }));
    if (m1.speed !== 0 || m1.sec !== 8 * 3600 || !m1.first || m1.session) fail(`первая планёрка: скорость ${m1.speed}, ${m1.sec / 3600} ч, первая ${m1.first}, «За эту игру» ${m1.session ? 'есть' : 'нет'}`);
    else ok('первая планёрка: 1 сентября в 08:00 открылась сама, мир на паузе; «За эту игру» — ещё нет: меньше суток');
    await shot(4, 'Первая планёрка');
    await closeMorning();

    // 5. справочник (F1): клавиша — панель с видом
    await measure('F1 — справочник', () => page.keyboard.press('F1'), 'ref');
    await shot(5, 'Справочник (F1)');
    await page.keyboard.press('Escape');

    // 6. «До события» — по автопаузам места: планёрки, отклонения 3 сентября; 2 сентября после планёрки ×4 до 10:00 —
    // «Сейчас» (N): идёт отвешивание первой серии (1 сентября в 08:00 на заводе ещё ничего не идёт); лаборатория —
    // «Поднять», как только в очереди партия; карточка отклонения — пояснение при первом событии, «Понятно»
    const devs = [];
    let rushed;
    let nowSeen = false;
    let firstOk = false;
    let seen;
    for (let i = 0; i < 16 && !(await page.evaluate(() => (window.__game.store.get().top?.inv ?? 0) > 0)); i++) {
      const stop = await untilEvent();
      if (stop.morning) {
        await closeMorning();
        if (!nowSeen) {
          await page.evaluate(() => window.__game.actions.setSpeed(4));
          await page.waitForFunction(() => window.__game.t % 86400 >= 10 * 3600 || window.__game.speed === 0, null, { timeout: 60_000 });
          await page.evaluate(() => window.__game.actions.setSpeed(0));
          await measure('N — «Сейчас»', () => page.keyboard.press('KeyN'), 'now');
          const rows = await page.$$eval('#now [data-test=now-row]', r => r.length);
          if (rows < 1) fail('«Сейчас» 2 сентября: строк нет');
          await shot(6, '«Сейчас» (N)');
          await page.keyboard.press('Escape');
          nowSeen = true;
        }
        if (!rushed) {
          await page.click('[data-test=lab-open]');
          await page.waitForFunction(() => !!window.__game.store.get().lab.view, null, { timeout: 20_000 });
          await frames(2);
          const lot = await page.getAttribute('[data-test=lab-row]', 'data-lot').catch(() => null);
          if (lot) {
            await measure('«Поднять» — партия выше в очереди', () => page.click('[data-test=lab-rush]'), 'rush', lot, 'command');
            rushed = lot;
            await shot(7, `Лаборатория — «Поднять» ${lot}`);
          }
          await page.keyboard.press('Escape');
        }
        continue;
      }
      const n = stop.notice;
      if (!n || (n.t === seen?.t && n.text === seen?.text) || stop.speed !== 0) {
        fail(`«До события»: встало без автопаузы — ${JSON.stringify(n)}, скорость ${stop.speed}`);
        break;
      }
      seen = n;
      if (n.go?.thing?.kind !== 'dev') continue;
      devs.push(n.text);
      // щелчок по извещению — карточка отклонения
      await measure('извещение — карточка отклонения', () => page.click('[data-test=notice-go]'), 'dev', n.go.thing.n);
      if (devs.length === 1) {
        await shot(8, 'Отклонение — карточка и пояснение');
        if (await page.$('[data-test=first-ok]')) {
          await measure('«Понятно» — пояснение убрано', () => page.click('[data-test=first-ok]'), 'understood', undefined, 'command');
          firstOk = true;
        }
      }
      await page.keyboard.press('Escape');
    }
    if (devs.length < 2 || !firstOk) fail(`отклонения недели: ${devs.join(', ') || 'нет'}; пояснение ${firstOk ? 'убрано' : 'не показано'}`);
    else ok(`отклонения недели: мир встал на каждом — «${devs.join('»; «')}»; карточка с пояснением, «Понятно» убрало его`);
    if (!rushed) fail('лаборатория: в очереди ни разу не было партии — «Поднять» не проверено');

    // 7. расследование: извещение — доска; три шага, ×2 пока идут; вывод по лучшей версии — «отклонить»; разбор
    const inv = await page.evaluate(() => ({ n: window.__game.store.get().top?.inv ?? 0, notice: document.querySelector('[data-test=notice-inv]')?.textContent ?? '' }));
    if (inv.n < 1 || !/вне спецификации/.test(inv.notice)) fail(`расследование: идёт ${inv.n}, извещение «${inv.notice}»`);
    else {
      await measure('извещение — доска расследования', () => page.click('[data-test=notice-inv]'), 'inv');
      const steps = ['records', 'dossier', 'journal'];
      await measure('шаг расследования — в работе', () => page.click(`[data-test=inv-step][data-step=${steps[0]}] [data-test=inv-do]`), 'step', steps[0], 'command');
      for (const st of steps.slice(1)) await page.click(`[data-test=inv-step][data-step=${st}] [data-test=inv-do]`);
      await shot(9, 'Расследование — шаги');
      await page.keyboard.press('Digit2');
      await page.waitForFunction(list => {
        const b = window.__game.store.get().inv.view?.board;
        return !!b && list.every(id => b.steps.find(x => x.id === id)?.state === 'done');
      }, steps, { timeout: 120_000 });
      await page.keyboard.press('Space');
      await frames(2);
      const top = await page.evaluate(() => window.__game.store.get().inv.view.board.beliefs[0]);
      await page.click(`[data-test=inv-cause][data-id=${top.id}]`);
      await page.click('[data-test=inv-fate][data-id=reject]');
      await measure('вывод — разбор', () => page.click('[data-test=inv-conclude]'), 'debrief', undefined, 'command');
      await shot(10, 'Расследование — разбор');
      const deb = await page.evaluate(() => document.querySelector('[data-test=inv-debrief]')?.getAttribute('data-root') ?? '');
      ok(`расследование: три шага, вывод — ${top.id} (${(top.p / 100).toFixed(1)} %), серия отклонена; на самом деле — ${deb}`);
      await page.keyboard.press('Escape');
    }

    // 8. итог недели: «До события» до планёрки 8 сентября — «За эту игру»
    for (let i = 0; i < 8 && (await page.evaluate(() => window.__game.store.get().morning.day ?? 0)) < day0 + 7; i++) {
      await closeMorning();
      await untilEvent();
    }
    await page.waitForSelector('[data-test=morning-session]', { timeout: 20_000 }).catch(() => {});
    const sum = await page.evaluate(() => ({
      text: [...(document.querySelector('[data-test=morning-session]')?.querySelectorAll('.mhead, li') ?? [])].map(x => x.textContent ?? '').join(' · '),
      v: window.__game.store.get().morning.view?.session,
      date: document.querySelector('[data-test=date]')?.textContent ?? '',
    }));
    await shot(11, 'Итог недели — «За эту игру»');
    const v = sum.v;
    if (!v || v.to - v.from < 7 * 86400 || v.released < 1 || v.rejected < 1 || v.deviations < 3 || v.open !== 0 || v.concluded !== 1 || v.closed < 1 || !/Вы играете \d+\s+мин/.test(sum.text) || !/на заводе прошло 7\s+дней/.test(sum.text))
      fail(`итог недели (${sum.date}): «${sum.text}» — ${JSON.stringify(v)}`);
    else ok(`итог недели (${sum.date}): «${sum.text}»`);

    // ощущение числами — строкой в журнал проверок
    const days = ff.reduce((n, x) => n + x.game, 0) / 86400;
    const wall = ff.reduce((n, x) => n + x.wall, 0) / 1000;
    ok(`ощущение: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}`);
    ok(`«До события»: ${ff.length} раз, ${days.toFixed(1)} сут завода за ${wall.toFixed(0)} с окна — ${(wall / days).toFixed(1)} с на сутки; вся неделя сценарием — ${((Date.now() - started) / 60000).toFixed(1)} мин`);

    // лист снимков пути: по три в ряд, подпись — шаг и часы завода
    const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
    const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
    await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
    await lister.screenshot({ path: join(out, 'week.png'), fullPage: true });
    await lister.close();
    ok(`первая неделя: ${shots.length} снимков → ${join(out, 'week.png')}`);
  } finally {
    await ctx.close();
  }
}
