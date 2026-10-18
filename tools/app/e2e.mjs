// Сценарий в браузере (часть 0 прототипа, docs/specs/2026-10-prototype.md): Chromium без окна (Playwright, браузер из
// PLAYWRIGHT_BROWSERS_PATH) открывает dist/. Страница грузится, сцена видна, часы завода идут; ×4 двигает их на часы;
// пробел — пауза; «До утра» (клавиша 5) доходит до планёрки в 08:00 и ставит паузу. Завод из плана (2а,
// docs/specs/2026-10-view.md): переключатель стен; снимки с трёх высот камеры — участок, цех, машина — днём и ночью;
// вызовы отрисовки — в бюджете. Люди и техника (2б): в 08:00 люди смены и техника на полу. Оборудование и линия (2в):
// лампа у каждой машины и единицы оборудования плана; «1:1» — часы идут секунда в секунду; на шестые сутки линия
// упаковывает первую серию — лампы машин горят, на лентах и в накопителях штуки; снимки дня — в этот час. Крупность
// показа и проверки (2г): с высоты участка — стрелки, люди и техника скрыты, с высоты цеха — снова по одному; контактный
// лист — три высоты днём и ночью на трёх пресетах, один файл tools/app/out/contact.png. Посты (3а): на шестые сутки
// свободные ждут на постах своих ролей — у входа не больше двух. Склад и карточка (3б): строка склада — паллета на экране
// мимо панели и карточка партии; щелчок мышью по паллете — её карточка; Esc закрывает. Планёрка и касса (3в): ×4 встают
// ровно в 08:00 — планёрка открылась сама, мир на паузе, Esc закрывает; «До утра» тоже открывает планёрку; касса — остаток
// как в полосе. Лаборатория (3г): на шестые сутки — очередь, «Поднять» доходит до движка, на карте средней массы точки и
// границы. Расписание (3д): G открывает окно, на нём полосы; задание тянут мышью — виден призрак с причинами. Прогон плана
// (часть 5): отпустили — задание в черновике, срок прежний; «Прогнать план» — итог «как сейчас» и черновика на пяти зёрнах,
// часы завода в это время идут; «Утвердить» — срок задания сменился; Esc закрывает. «Кем вы будете» (3е): экран открыт с начала, мир стоит; взяли «Производство» —
// часы пошли; на планёрке — «Ваше место»; «Поднять» без поста качества погашено, кнопкой «Место» добавили его — мир на
// паузе, после «Взять» поднять можно. Расследование (часть 4б): «До утра», пока растворение второй серии не выйдет за
// спецификацию, — извещение ставит мир на паузу и открывает доску; три шага, решение, разбор; Esc закрывает. Ошибок в
// консоли и запросов наружу нет. Снимки — tools/app/out/e2e*.png.
//   node tools/app/e2e.mjs [--q low|medium|high] [--headed] [--port 8094]
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findChromium } from './e2e-lib.mjs';
import { serve } from './serve.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};

const out = new URL('./out/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const port = Number(arg('port', 8094));
const server = await serve(port);
const browser = await chromium.launch({
  executablePath: findChromium(),
  headless: !process.argv.includes('--headed'),
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const requests = [];
page.on('console', m => {
  if (m.type() === 'error') errors.push(m.text());
  if (m.type() === 'error' || m.type() === 'warning') console.log(`  ${m.type()}: ${m.text().slice(0, 300)}`);
});
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => {
  const u = r.url();
  if (!u.startsWith(`http://127.0.0.1:${port}/`) && !u.startsWith('data:') && !u.startsWith('blob:')) requests.push(u);
});
const fail = msg => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};
const ok = msg => console.log(`✓ ${msg}`);
/** Часы завода в игровых секундах — из игры, а не из текста полосы: текст обновляется 10 раз в секунду. */
const gameT = () => page.evaluate(() => window.__game.t + window.__game.lag);
/** «До утра»: промотка до планёрки следующих суток. */
/** Дождаться `n` кадров: программная отрисовка даёт несколько кадров в секунду, а камера и сцена меняются в кадре. */
const frames = n => page.evaluate(k => new Promise(r => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);

/** «До утра» — до планёрки в 08:00; планёрку (3в) закрыть, чтобы она не заслоняла завод, — если не просят оставить. */
const untilMorning = async (keep = false) => {
  const day = await page.evaluate(() => window.__game.day);
  await page.keyboard.press('Digit5');
  await page.waitForFunction(d => window.__game.day > d && !window.__game.ff && window.__game.store.get().morning.open, day, { timeout: 60_000 });
  if (!keep) await page.keyboard.press('Escape');
};

try {
  await page.goto(`http://127.0.0.1:${port}/index.html?q=${arg('q', 'low')}&lang=ru`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  ok('страница загружена, первый кадр нарисован');

  const clock = await page.textContent('[data-test=clock]');
  const date = await page.textContent('[data-test=date]');
  if (!/^0[78]:\d\d$/.test(clock ?? '')) fail(`часы в начале: ${clock}`);
  else ok(`часы: ${clock}, ${date}`);

  // «Кем вы будете» (3е): экран открыт с начала, мир стоит, пять плиток, две ведёт сценарий; взяли «Производство» — экран
  // закрылся, часы пошли на ×1, на кнопке «Место» — производство
  {
    const at = await page.evaluate(() => ({
      open: window.__game.store.get().seats.open,
      speed: window.__game.speed,
      tiles: document.querySelectorAll('[data-test=seat-tile]').length,
      off: document.querySelectorAll('[data-test=seat-tile]:disabled').length,
    }));
    const t0 = await gameT();
    await page.keyboard.press('Digit4');
    await page.waitForTimeout(600);
    const t1 = await gameT();
    if (!at.open || at.speed !== 0 || t1 !== t0 || at.tiles !== 5 || at.off !== 2) fail(`«Кем вы будете»: экран ${at.open ? 'открыт' : 'закрыт'}, скорость ${at.speed}, часы прошли ${t1 - t0} с, плиток ${at.tiles}, погашено ${at.off}`);
    else ok(`«Кем вы будете»: экран открыт с начала, мир стоит и на ×4; плиток ${at.tiles}, ведёт сценарий ${at.off}`);
    await page.click('[data-test=seat-tile][data-seat=production]');
    await page.click('[data-test=seats-take]');
    await page.waitForFunction(() => window.__game.store.get().top?.seats?.join() === 'production', null, { timeout: 20_000 });
    const after = await page.evaluate(() => ({ open: !!document.querySelector('#seats'), speed: window.__game.speed, label: document.querySelector('[data-test=seats-open]')?.textContent ?? '' }));
    if (after.open || after.speed !== 1 || !/Производство/.test(after.label)) fail(`взяли «Производство»: экран ${after.open ? 'открыт' : 'закрыт'}, скорость ${after.speed}, кнопка «${after.label}»`);
    else ok(`взяли «Производство»: экран закрыт, ×1, на кнопке — «${after.label}»`);
  }

  // ×4 — два часа в секунду. Программная отрисовка без видеокарты даёт несколько кадров в секунду, а шаг кадра ограничен
  // 0,1 с — поэтому проверка мягкая: больше, чем ×2 смог бы и при 60 к/с (5 минут в секунду). В 08:00 часы встают на
  // планёрку (3в) — и тогда за 1,5 с прошло меньше, но ровно до 08:00
  await page.keyboard.press('Digit4');
  const t0 = await gameT();
  await page.waitForTimeout(1500);
  const t1 = await gameT();
  const speed = await page.evaluate(() => window.__game.speed);
  const atMorning = t1 % 86400 === 8 * 3600 && speed === 0;
  if ((speed !== 4 && !atMorning) || (t1 - t0 < 1200 && !atMorning)) fail(`×4: скорость ${speed}, за 1,5 с прошло ${t1 - t0} игровых секунд`);
  else ok(`×4: за 1,5 с прошло ${Math.round((t1 - t0) / 60)} игровых минут${atMorning ? ' — до планёрки' : ''}`);

  // планёрка (3в): ×4 доходят до 08:00 — часы встают ровно в 08:00, мир на паузе, страница открылась сама; Esc закрывает
  {
    await page.waitForFunction(() => window.__game.store.get().morning.open, null, { timeout: 30_000 });
    await page.waitForSelector('[data-test=morning-now]', { timeout: 20_000 });
    const m = await page.evaluate(() => ({
      sec: window.__game.t % 86400,
      speed: window.__game.speed,
      title: document.querySelector('#morning-title')?.textContent ?? '',
      yesterday: !!document.querySelector('[data-test=morning-yesterday]'),
      now: !!document.querySelector('[data-test=morning-now]'),
    }));
    if (m.sec !== 8 * 3600 || m.speed !== 0 || !/Планёрка/.test(m.title) || !m.yesterday || !m.now)
      fail(`планёрка: часы ${m.sec / 3600} ч, скорость ${m.speed}, «${m.title}», вчера ${m.yesterday}, сейчас ${m.now}`);
    else ok(`планёрка открылась сама в 08:00, мир на паузе: «${m.title}»`);
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => !document.querySelector('#morning'));
    if (!closed) fail('планёрка: Esc не закрыл');
    else ok('планёрка: Esc закрыл');
  }

  // пробел — пуск и пауза
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  const p0 = await gameT();
  await page.waitForTimeout(700);
  const p1 = await gameT();
  if (p1 !== p0) fail(`пауза: часы шли (${p1 - p0} с)`);
  else ok('пауза: часы стоят');

  // «До утра» — до планёрки в 08:00 и пауза
  await untilMorning(true);
  const morning = await page.evaluate(() => ({ t: window.__game.t, speed: window.__game.speed, open: window.__game.store.get().morning.open }));
  if (morning.t % 86400 !== 8 * 3600) fail(`«До утра» остановилось в ${(morning.t % 86400) / 3600} ч`);
  else if (morning.speed !== 0) fail(`после «До утра» скорость ${morning.speed}, а не пауза`);
  else if (!morning.open) fail('после «До утра» планёрка не открылась');
  else ok('«До утра»: планёрка в 08:00, пауза');
  // «Ваше место» (3е): итог производства за время на месте — с начала партии
  {
    const seat = await page
      .waitForSelector('[data-test=morning-seat][data-seat=production]', { timeout: 20_000 })
      .then(e => e.innerText(), () => '');
    if (!seat) fail('планёрка: раздела «Ваше место» с производством нет');
    else ok(`планёрка: «Ваше место» — ${seat.replace(/\s*\n\s*/g, ' · ').slice(0, 120)}`);
  }
  await page.keyboard.press('Escape');
  // панели обновляются 10 раз в секунду: извещение может прийти на кадр позже паузы
  const shown = await page
    .waitForFunction(() => /Планёрка/.test(document.querySelector('.top .notice')?.textContent ?? ''), null, { timeout: 2000 })
    .then(() => true, () => false);
  const notice = await page.textContent('.top .notice');
  if (!shown) fail(`извещение: ${notice}`);
  else ok(`извещение: ${notice}`);

  // склад и карточка (3б): строка склада ведёт камеру к паллете (мимо панели) и открывает карточку партии; щелчок по паллете —
  // карточка её партии; Esc снимает выбор и закрывает склад
  {
    await page.click('[data-test=stock]');
    await page.waitForSelector('[data-test=stock-row]', { timeout: 20_000 });
    const rows = await page.$$eval('[data-test=stock-row]', r => r.length);
    const unit = Number(await page.getAttribute('[data-test=stock-row]', 'data-unit'));
    await page.click('[data-test=stock-row]');
    await page.waitForSelector('[data-test=card]', { timeout: 20_000 });
    const card = await page.evaluate(() => ({ title: document.querySelector('#card-title')?.textContent ?? '', selected: window.__game.selected, history: document.querySelectorAll('[data-test=card-history] li').length }));
    // камера привела паллету на экран, и её не закрывает панель склада справа; кадр с новой камерой — нарисован
    await frames(2);
    const seen = await page.evaluate(u => {
      const g = window.__game;
      const p = g.pallets.find(x => x.unit === u);
      const sp = p && g.stage.screen(p.x, p.y + 0.5, p.z);
      return !!sp && document.elementFromPoint(sp.x, sp.y) === g.stage.renderer.domElement;
    }, unit);
    if (rows < 1 || card.selected?.n !== unit || !/П-\d{4}-\d{4}/.test(card.title) || card.history < 1 || !seen)
      fail(`склад: строк ${rows}, выбрано ${JSON.stringify(card.selected)}, карточка «${card.title}», записей истории ${card.history}, паллета ${seen ? 'видна' : 'не видна'}`);
    else ok(`склад: строк ${rows}; строка — паллета ${unit} на экране мимо панели, карточка «${card.title}», записей истории ${card.history}`);
    await page.keyboard.press('Escape');
    await frames(2);
    // щелчок мышью по паллете на экране — та же паллета: точка её груза, не заслонённая соседями и панелями
    const at = await page.evaluate(u => window.__game.clickPoint(u), unit);
    if (!at) fail(`щелчок по паллете ${unit}: на экране не нашлось точки, которую не заслоняют соседи и панели`);
    else {
      await page.mouse.click(at.x, at.y);
      await page.waitForSelector('[data-test=card]', { timeout: 20_000 });
      const clicked = await page.evaluate(() => window.__game.selected);
      if (clicked?.kind !== 'unit' || clicked.n !== unit) fail(`щелчок по паллете: выбрано ${JSON.stringify(clicked)}`);
      else ok(`щелчок по паллете ${unit} — её карточка`);
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => ({ card: !!document.querySelector('[data-test=card]'), stock: !!document.querySelector('#stock') }));
    if (closed.card || closed.stock) fail(`Esc: карточка ${closed.card ? 'открыта' : 'закрыта'}, склад ${closed.stock ? 'открыт' : 'закрыт'}`);
    else ok('Esc: выбор снят, склад закрыт');
  }

  // касса (3в): кнопка открывает панель; остаток — как в верхней полосе; Esc закрывает
  {
    await page.click('[data-test=cash-open]');
    await page.waitForSelector('[data-test=cash-balance]', { timeout: 20_000 });
    const c = await page.evaluate(() => ({
      panel: document.querySelector('[data-test=cash-balance]')?.textContent ?? '',
      top: document.querySelector('[data-test=top-cash]')?.textContent ?? '',
      rows: document.querySelectorAll('#cash table.grid tbody tr').length,
    }));
    if (!c.panel || !c.top.includes(c.panel)) fail(`касса: в панели «${c.panel}», в полосе «${c.top}»`);
    else ok(`касса: остаток ${c.panel} — как в полосе; строк календаря и проводок ${c.rows}`);
    await page.keyboard.press('Escape');
    if (await page.evaluate(() => !!document.querySelector('#cash'))) fail('касса: Esc не закрыл');
    else ok('касса: Esc закрыл');
  }

  // расписание (3д, часть 5): G открывает окно; на неделе — строки и полосы; задание на серию, не начавшее комплектовку,
  // тянут мышью на сутки раньше — виден призрак и причины у курсора; отпустили — задание в черновике: команды нет, срок
  // прежний, полосы черновика — белым пунктиром, прежние — бледнее. «Прогнать план» на ×1 — итог двух вариантов на пяти
  // зёрнах, а часы завода шли: игра не замерла. «Утвердить» — срок задания сменился (команда `shift` дошла до движка и
  // вернулась в вид), черновик пуст; Esc закрывает. Вторая серия и на сутки раньше — после последних суток сценария
  {
    await page.keyboard.press('KeyG');
    await page.waitForFunction(() => !!window.__game.store.get().gantt.view, null, { timeout: 20_000 });
    await page.click('[data-test=gantt-days-9]');
    await page.waitForFunction(() => {
      const v = window.__game.store.get().gantt.view;
      return !!v && v.to - v.from === 9 * 86400;
    }, null, { timeout: 20_000 });
    await frames(2);
    const rows = await page.$$eval('[data-test=gantt-row]', r => r.length);
    const bars = await page.$$eval('[data-test=gbar]', r => r.length);
    const bar = await page.$('[data-test=gbar][data-movable="1"][data-kind=kit]');
    if (rows < 6 || bars < 5 || !bar) fail(`расписание: строк ${rows}, полос ${bars}, задания, которое можно тянуть, ${bar ? 'есть' : 'нет'}`);
    else {
      const batch = await bar.getAttribute('data-batch');
      const before = await page.evaluate(b => window.__game.store.get().gantt.view.batches[b].notBefore, batch);
      const box = await bar.boundingBox();
      const width = await page.$eval('[data-test=gantt-row] .gtrack', e => e.getBoundingClientRect().width);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - Math.round(width / 9), y, { steps: 8 });
      const ghost = await page
        .waitForFunction(() => document.querySelectorAll('[data-test=ghost]').length > 0 && !!document.querySelector('[data-test=gtip] li'), null, { timeout: 20_000 })
        .then(() => true, () => false);
      const tip = ((await page.innerText('[data-test=gtip]').catch(() => '')) ?? '').replace(/\s*\n\s*/g, ' · ');
      await page.screenshot({ path: join(out, 'e2e-gantt.png') });
      await page.mouse.up();
      // отпустили — черновик: полосы задания белым пунктиром, прежние — бледнее; срок задания прежний
      const drafted = await page
        .waitForFunction(b => {
          const g = window.__game.store.get().gantt;
          return g.draft.length === 1 && g.draft[0].batch === b && document.querySelectorAll(`[data-test=gbar][data-draft="1"][data-batch="${b}"]`).length > 0;
        }, batch, { timeout: 20_000 })
        .then(() => true, () => false);
      const kept = await page.evaluate(b => window.__game.store.get().gantt.view?.batches[b]?.notBefore, batch);
      await frames(2);
      await page.screenshot({ path: join(out, 'e2e-draft.png') });
      const marks = await page.evaluate(() => ({ draft: document.querySelectorAll('[data-test=gbar][data-draft="1"]').length, was: document.querySelectorAll('[data-test=was]').length, list: document.querySelector('[data-test=draft-list]')?.textContent ?? '' }));
      if (!ghost || !drafted || kept !== before || marks.was < 1)
        fail(`расписание: призрак ${ghost ? 'виден' : 'не виден'}; черновик ${drafted ? 'есть' : 'нет'}, срок задания ${batch}: ${before} → ${kept}, прежних полос ${marks.was}`);
      else
        ok(`расписание: строк ${rows}, полос ${bars}; задание ${batch} протянули на сутки раньше — призрак, у курсора «${tip.slice(0, 90)}…»; отпустили — «${marks.list}», срок прежний; полос черновика ${marks.draft}, прежних ${marks.was}`);

      // «Прервать» сразу после «Прогнать план» — прогона и итога нет
      const stopped = await page.evaluate(async () => {
        const g = window.__game;
        g.actions.runPlan();
        g.actions.stopPlan();
        await new Promise(r => setTimeout(r, 1500));
        const p = g.store.get().plan;
        return !p.running && p.sums.length === 0 && !document.querySelector('[data-test=plan]');
      });
      if (!stopped) fail('прогон плана: «Прервать» не остановил прогон');
      else ok('прогон плана: «Прервать» — прогона и итога нет');

      // прогон плана: на ×1 часы завода идут, пока второй поток считает «как сейчас» и черновик на пяти зёрнах
      await page.keyboard.press('Digit1');
      const r0 = await gameT();
      await page.click('[data-test=plan-run]');
      const started = await page.waitForFunction(() => window.__game.store.get().plan.running, null, { timeout: 5_000 }).then(() => true, () => false);
      const done = await page
        .waitForFunction(() => {
          const p = window.__game.store.get().plan;
          return !p.running && (p.sums.filter(Boolean).length === 2 || !!p.error);
        }, null, { timeout: 90_000 })
        .then(() => true, () => false);
      const r1 = await gameT();
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.__game.speed === 0, null, { timeout: 5_000 });
      await frames(2);
      const plan = await page.evaluate(() => {
        const p = window.__game.store.get().plan;
        return {
          seeds: p.sums.map(x => x?.seeds).join(),
          cols: document.querySelectorAll('[data-test=plan-sum] thead th').length,
          orders: document.querySelectorAll('[data-test=plan-order]').length,
          batches: document.querySelectorAll('[data-test=plan-batch]').length,
          cash: document.querySelector('[data-test=plan-cash]')?.textContent ?? '',
          ms: p.ms,
          error: p.error,
        };
      });
      await page.evaluate(() => document.querySelector('[data-test=plan]')?.scrollIntoView());
      await frames(2);
      await page.screenshot({ path: join(out, 'e2e-plan.png') });
      if (!started || !done || plan.error || plan.cols !== 3 || plan.seeds !== '5,5' || plan.batches < 1 || r1 <= r0)
        fail(`прогон плана: начат ${started}, готов ${done}, ошибка ${plan.error ?? 'нет'}, столбцов ${plan.cols}, зёрен ${plan.seeds}, серий ${plan.batches}, часы ${r0} → ${r1}`);
      else
        ok(`прогон плана: «как сейчас» и черновик на 5 зёрнах за ${plan.ms} мс; заказов ${plan.orders}, серий ${plan.batches}, «${plan.cash.slice(0, 80)}»; часы завода прошли ${r1 - r0} с — игра не замерла`);

      // «Утвердить» — команды `shift`: срок задания сменился, черновик пуст
      await page.click('[data-test=draft-approve]');
      const moved = await page
        .waitForFunction(([b, t]) => {
          const g = window.__game.store.get().gantt;
          return g.draft.length === 0 && !!g.view?.batches[b] && g.view.batches[b].notBefore !== t;
        }, [batch, before], { timeout: 20_000 })
        .then(() => true, () => false);
      const after = await page.evaluate(b => window.__game.store.get().gantt.view?.batches[b]?.notBefore, batch);
      if (!moved) fail(`«Утвердить»: срок задания ${batch}: ${before} → ${after}`);
      else ok(`«Утвердить»: срок задания ${batch} раньше на ${Math.round((before - after) / 3600)} ч, черновик пуст`);
    }
    await page.keyboard.press('Escape');
    if (await page.evaluate(() => !!document.querySelector('#gantt'))) fail('расписание: Esc не закрыл');
    else ok('расписание: Esc закрыл');
  }

  // камера: участок — общий план, цех упаковки, блистерная машина (геймдизайн, §19.1)
  const camAt = v =>
    page.evaluate(v => {
      const c = window.__game.stage.cam;
      if (v) {
        c.target.set(v.x, 0, v.z);
        c.half = v.half;
      } else c.overview();
    }, v);
  const HALL = { x: 39, z: 17, half: 9 };
  const MACHINE = { x: 44, z: 16.5, half: 3.5 };
  /**
   * Дождаться, пока показ дойдёт до уровня: переход — 0,4 с, а шаг кадра — не больше 0,1 с, то есть не меньше четырёх
   * кадров; программная отрисовка на высоком пресете тратит на кадр секунды.
   */
  const settle = level => page.waitForFunction(k => window.__game.detail[k - 1] === 1, level, { timeout: 90_000 });

  // люди смены и техника — на полу (2б): с высоты цеха; с высоты участка их скрывает крупность показа (2г)
  await camAt(HALL);
  await settle(1);
  const floor = await page.evaluate(() => ({ people: window.__game.stage.peopleShown, vehicles: window.__game.stage.vehiclesShown }));
  if (floor.people < 1 || floor.vehicles < 1) fail(`на полу: людей ${floor.people}, техники ${floor.vehicles}`);
  else ok(`на полу: людей ${floor.people}, техники ${floor.vehicles}`);

  // лампы (2в): у каждой единицы оборудования и машины линии плана — лампа состояния
  const lamps = await page.evaluate(() => {
    const g = window.__game;
    const plant = g.db.plants[g.db.scenarios['scn.proto'].plant];
    return { shown: g.stage.machines.lamps, want: plant.equipment.length + plant.lines.reduce((n, l) => n + l.machines.length, 0) };
  });
  const kinds = new Set(['run', 'wait', 'stop', 'fail', 'setup', 'clean', 'off']);
  if (lamps.shown.length !== lamps.want || !lamps.shown.every(l => kinds.has(l))) fail(`лампы: ${lamps.shown.join(', ')} — ждали ${lamps.want}`);
  else ok(`лампы: ${lamps.shown.length} — ${[...new Set(lamps.shown)].join(', ')}`);

  // «живое время» (2в): «1:1» — секунда в секунду. Программная отрисовка даёт несколько кадров в секунду, а шаг кадра
  // ограничен 0,1 с — поэтому часы окна (с дробью, ещё не ушедшей в поток) могут отстать, но не уйти вперёд
  const liveT = () => page.evaluate(() => window.__game.t + window.__game.lag + window.__game.client.ahead);
  await page.click('[data-test=live]');
  const l0 = await liveT();
  await page.waitForTimeout(3000);
  const l1 = await liveT();
  const live = await page.evaluate(() => window.__game.speed);
  if (live !== 5 || l1 - l0 <= 0.1 || l1 - l0 > 3.5) fail(`«1:1»: скорость ${live}, за 3 с прошло ${(l1 - l0).toFixed(2)} игровых секунд`);
  else ok(`«1:1»: за 3 с прошло ${(l1 - l0).toFixed(2)} игровых секунд`);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);

  // снимок: общий план завода
  await camAt(null);
  await settle(3);
  await page.screenshot({ path: join(out, 'e2e.png') });
  ok(`снимок: ${join(out, 'e2e.png')}`);

  // переключатель стен: «вниз» — стены опущены, «срез» — по умолчанию
  const walls = await page.$$('[data-test=walls] button');
  if (walls.length !== 3) fail(`кнопок стен: ${walls.length}`);
  else {
    await walls[2].click();
    const down = await page.evaluate(() => window.__game.stage.wallMode);
    await walls[1].click();
    const cut = await page.evaluate(() => window.__game.stage.wallMode);
    if (down !== 'down' || cut !== 'cut') fail(`стены: ${down}, ${cut}`);
    else ok('стены: «вниз» и «срез»');
  }

  // первая упаковка (2в): «До утра» до шестых суток (сколько раз — зависит от того, ушли ли ×4 за 08:00), затем ×4 —
  // пока через линию не пошли штуки. Панель лаборатории (3г) открыта: в первое утро, когда в очереди есть партия, —
  // «Поднять»; команда доходит до движка и обратно в вид. Утром 6 сентября балк первой серии ещё ждёт решения
  await page.click('[data-test=lab-open]');
  let rushed = '';
  while ((await page.evaluate(() => window.__game.day)) < 6) {
    await untilMorning();
    if (rushed) continue;
    await page.waitForFunction(() => !!window.__game.store.get().lab.view, null, { timeout: 20_000 });
    await frames(2);
    if ((await page.$$eval('[data-test=lab-row]', r => r.length)) === 0) continue;
    const lot = await page.getAttribute('[data-test=lab-row]', 'data-lot');
    // своё и чужое (3е): с одним производством «Поднять» погашено; кнопкой «Место» добавили качество — мир на паузе,
    // после «Взять» поднять можно
    {
      const off = await page.$eval('[data-test=lab-rush]', b => ({ disabled: b.disabled, title: b.title }));
      if (!off.disabled || !/Качество и технология/.test(off.title)) fail(`«Поднять» без поста качества: ${off.disabled ? 'погашено' : 'нажимается'}, подсказка «${off.title}»`);
      else ok(`«Поднять» без поста качества погашено: «${off.title}»`);
      await page.click('[data-test=seats-open]');
      await page.waitForSelector('#seats', { timeout: 20_000 });
      const paused = await page.evaluate(() => window.__game.speed === 0);
      await page.click('[data-test=seat-tile][data-seat=quality]');
      await page.click('[data-test=seats-take]');
      await page.waitForFunction(() => window.__game.store.get().top?.seats?.join() === 'production,quality', null, { timeout: 20_000 });
      await frames(2);
      const on = await page.$eval('[data-test=lab-rush]', b => !b.disabled);
      if (!paused || !on) fail(`«Место»: мир ${paused ? 'на паузе' : 'шёл'}, «Поднять» после «Взять» ${on ? 'нажимается' : 'погашено'}`);
      else ok('«Место»: мир на паузе; взяли ещё «Качество и технологию» — «Поднять» нажимается');
    }
    await page.click('[data-test=lab-rush]');
    const up = await page
      .waitForFunction(l => window.__game.store.get().lab.view?.rows.some(r => r.lot === l && r.rush), lot, { timeout: 20_000 })
      .then(() => true, () => false);
    rushed = up ? lot : 'нет';
  }
  if (!rushed || rushed === 'нет') fail(`лаборатория: «Поднять» ${rushed ? 'не дошло до движка' : 'не проверено — в очереди ни разу не было партии'}`);
  else ok(`лаборатория: партия ${rushed} поднята — команда дошла до движка и вернулась в вид`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Digit4');
  await page.waitForFunction(() => window.__game.view.lines[0]?.machines[1]?.items > 0, null, { timeout: 120_000 });
  await page.keyboard.press('Space');
  // штуки на лентах видны по одной — с высоты цеха
  await camAt(HALL);
  await settle(1);
  await page.waitForTimeout(300);
  const packing = await page.evaluate(() => {
    const g = window.__game;
    const plant = g.db.plants[g.db.scenarios['scn.proto'].plant];
    return { lamps: g.stage.machines.lamps.slice(plant.equipment.length), items: g.stage.machines.itemsShown, hour: (g.t % 86400) / 3600 };
  });
  if (packing.lamps.every(l => l === 'off') || packing.items < 1) fail(`линия: лампы ${packing.lamps.join(', ')}, штук на лентах ${packing.items}`);
  else ok(`линия в ${packing.hour.toFixed(1)} ч: лампы ${packing.lamps.join(', ')}, штук на лентах и в накопителях ${packing.items}`);

  // посты (3а): свободные ждут на постах своих ролей, а не у входа
  const posts = await page.evaluate(() => {
    const g = window.__game;
    const plant = g.db.plants[g.db.scenarios['scn.proto'].plant];
    const [ex, ez] = plant.points.entrance;
    const free = g.view.people.filter(p => p.present && p.task < 0);
    return { free: free.length, atEntrance: free.filter(p => !p.walk && Math.hypot(p.x - ex, p.z - ez) < 300).length, walking: free.filter(p => p.walk).length };
  });
  if (posts.atEntrance > 2) fail(`посты: у входа ждут ${posts.atEntrance} из ${posts.free} свободных`);
  else ok(`посты: свободных ${posts.free}, идут на пост ${posts.walking}, у входа ждут ${posts.atEntrance}`);

  // лаборатория (3г): на карте средней массы к шестым суткам — точки МОК таблетирования и границы; Esc закрывает
  {
    await page.click('[data-test=lab-open]');
    await page.waitForFunction(() => !!window.__game.store.get().lab.view, null, { timeout: 20_000 });
    const rows = await page.$$eval('[data-test=lab-row]', r => r.length);
    await page.click('[data-test=lab-tab-chart]');
    await page.waitForFunction(() => !!window.__game.store.get().lab.chart, null, { timeout: 20_000 });
    await frames(2);
    const chart = await page.evaluate(() => {
      const v = window.__game.store.get().lab.chart;
      return { points: v?.points.length ?? 0, limits: !!v?.limits, marks: document.querySelectorAll('[data-test=lab-chart] .pt').length };
    });
    if (chart.points < 2 || !chart.limits || chart.marks < chart.points) fail(`лаборатория: точек ${chart.points}, границы ${chart.limits}, на рисунке ${chart.marks}`);
    else ok(`лаборатория: в очереди ${rows}; на карте точек ${chart.points}, границы есть`);
    await page.keyboard.press('Escape');
    if (await page.evaluate(() => !!document.querySelector('#lab'))) fail('лаборатория: Esc не закрыл');
  }

  // крупность показа (2г): с высоты участка — стрелки перевозок и линии, люди и техника скрыты; с высоты цеха — по одному
  await camAt(null);
  await settle(3);
  const site = await page.evaluate(() => ({ people: window.__game.stage.peopleShown, vehicles: window.__game.stage.vehiclesShown, arrows: window.__game.stage.overlay.arrowsShown }));
  if (site.people || site.vehicles || site.arrows < 1) fail(`участок: людей ${site.people}, техники ${site.vehicles}, стрелок ${site.arrows}`);
  else ok(`участок: стрелок ${site.arrows}, люди и техника скрыты`);
  await camAt(HALL);
  await settle(1);
  const hall = await page.evaluate(() => ({ people: window.__game.stage.peopleShown, layer: window.__game.stage.overlay.group.visible }));
  if (hall.people < 1 || hall.layer) fail(`цех: людей ${hall.people}, слой участка ${hall.layer ? 'виден' : 'скрыт'}`);
  else ok(`цех: по одному — людей ${hall.people}, слой участка скрыт`);

  // контактный лист (13-art.md, §17): три высоты камеры днём (час упаковки) и ночью на трёх пресетах
  const heights = [
    ['site', null, 3],
    ['hall', HALL, 1],
    ['machine', MACHINE, 1],
  ];
  const sheet = [];
  const shoot = async when => {
    for (const q of ['low', 'medium', 'high']) {
      await page.evaluate(q => window.__game.actions.setQuality(q), q);
      for (const [name, v, level] of heights) {
        await camAt(v);
        await settle(level);
        await page.waitForTimeout(300);
        const calls = await page.evaluate(() => window.__game.stage.calls);
        if (calls > 150) fail(`${name}, ${when}, ${q}: вызовов отрисовки ${calls} — больше бюджета 150`);
        const file = join(out, `e2e-${name}-${when}-${q}.png`);
        await page.screenshot({ path: file });
        sheet.push({ file, label: `${name} · ${when} · ${q} · ${calls} вызовов` });
        ok(`снимок ${name}, ${when}, ${q}: ${calls} вызовов отрисовки`);
      }
    }
    await page.evaluate(() => window.__game.actions.setQuality('low'));
  };
  await shoot('day');
  // ночь: ×4 до 22:00 и пауза
  await page.keyboard.press('Digit4');
  await page.waitForFunction(() => (window.__game.t % 86400) >= 22 * 3600, null, { timeout: 90_000 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await shoot('night');
  // один лист: строки — пресет и время суток, столбцы — высота
  const cells = sheet.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(
    `<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`,
  );
  await lister.screenshot({ path: join(out, 'contact.png'), fullPage: true });
  await lister.close();
  ok(`контактный лист: ${sheet.length} снимков → ${join(out, 'contact.png')}`);

  // расследование (часть 4б): «До утра», пока растворение второй серии не выйдет за спецификацию. У игрока пост качества —
  // извещение ставит мир на паузу и ведёт к доске; три шага; решение по лучшей версии; разбор; Esc закрывает
  {
    const open = () => page.evaluate(() => (window.__game.store.get().top?.inv ?? 0) > 0);
    for (let i = 0; i < 12 && !(await open()); i++) {
      const day = await page.evaluate(() => window.__game.day);
      await page.keyboard.press('Digit5');
      await page.waitForFunction(d => (window.__game.day > d && !window.__game.ff && window.__game.store.get().morning.open) || (window.__game.store.get().top?.inv ?? 0) > 0, day, { timeout: 90_000 });
      if (await page.evaluate(() => window.__game.store.get().morning.open)) await page.keyboard.press('Escape');
    }
    const stop = await page.evaluate(() => ({ inv: window.__game.store.get().top?.inv ?? 0, speed: window.__game.speed, ff: window.__game.ff, notice: document.querySelector('[data-test=notice-inv]')?.textContent ?? '' }));
    if (stop.inv < 1 || stop.speed !== 0 || stop.ff || !/вне спецификации/.test(stop.notice)) fail(`расследование: идёт ${stop.inv}, скорость ${stop.speed}, промотка ${stop.ff}, извещение «${stop.notice}»`);
    else ok(`расследование: «${stop.notice}» — мир на паузе`);
    await page.click('[data-test=notice-inv]');
    await page.waitForFunction(() => !!window.__game.store.get().inv.view?.board, null, { timeout: 20_000 });
    await frames(2);
    const steps = ['records', 'dossier', 'journal'];
    for (const st of steps) await page.click(`[data-test=inv-step][data-step=${st}] [data-test=inv-do]`);
    await page.keyboard.press('Digit2');
    await page.waitForFunction(list => {
      const b = window.__game.store.get().inv.view?.board;
      return !!b && list.every(id => b.steps.find(x => x.id === id)?.state === 'done');
    }, steps, { timeout: 120_000 });
    await page.keyboard.press('Space');
    await frames(2);
    const seen = await page.evaluate(() => ({
      obs: document.querySelectorAll('[data-test=inv-obs]').length,
      shown: document.querySelectorAll('[data-test=inv-obs][data-shown="1"]').length,
      top: window.__game.store.get().inv.view.board.beliefs[0],
      bars: document.querySelectorAll('[data-test=inv-version]').length,
    }));
    if (seen.obs < steps.length || seen.bars < 2) fail(`расследование: улик ${seen.obs}, версий ${seen.bars}`);
    else ok(`расследование: три шага сделаны — улик ${seen.obs}, «есть» у ${seen.shown}; лучшая версия — ${seen.top.id}, ${(seen.top.p / 100).toFixed(1)} %`);
    await page.click(`[data-test=inv-cause][data-id=${seen.top.id}]`);
    await page.click('[data-test=inv-fate][data-id=reject]');
    await page.click('[data-test=inv-conclude]');
    await page.waitForSelector('[data-test=inv-debrief]', { timeout: 20_000 });
    await frames(2);
    await page.screenshot({ path: join(out, 'e2e-inv.png') });
    const deb = await page.evaluate(() => {
      const d = document.querySelector('[data-test=inv-debrief]');
      return { root: d?.getAttribute('data-root') ?? '', cause: d?.getAttribute('data-cause'), fate: d?.getAttribute('data-fate'), text: d?.textContent ?? '' };
    });
    if (!deb.root || !/на самом деле/.test(deb.text)) fail(`разбор: корень «${deb.root}», текст «${deb.text.slice(0, 120)}»`);
    else ok(`разбор: на самом деле — ${deb.root}; причина ${deb.cause === '1' ? 'верна' : 'неверна'}, судьба серии ${deb.fate === '1' ? 'верна' : 'неверна'}; снимок ${join(out, 'e2e-inv.png')}`);
    await page.keyboard.press('Escape');
    if (await page.evaluate(() => !!document.querySelector('#inv'))) fail('расследование: Esc не закрыл');
  }

  if (errors.length) fail(`ошибки в консоли: ${errors.join(' | ')}`);
  else ok('ошибок в консоли нет');
  if (requests.length) fail(`запросы наружу: ${requests.join(', ')}`);
  else ok('запросов наружу нет');
} catch (e) {
  fail(e instanceof Error ? e.stack ?? e.message : String(e));
} finally {
  await browser.close();
  server.close();
}
