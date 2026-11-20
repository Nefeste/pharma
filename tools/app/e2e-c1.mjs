// Сценарий в браузере, часть «Сценарий 1» (Б9, шаги 1–2; docs/specs/2026-10-vertical-slice.md, «Б9», «Проверки Б9»):
// чистое окно без сценария в адресе — экран «Кампания»: «Цех на окраине» первым, чему учит, старт, срок и цели. «Начать»
// — экран «Кем вы будете» сценария: только директор. «Взять» — понедельник 13 сентября, 07:00 после прогрева; панель
// писем открыта на письме о фуре; полоса «Цели», окно целей. Фура поставщика — у рампы в первый час. Первый день по
// письмам: фура разгружена — мир встал на письме о карантине; в 09:00 — письмо о выпуске серии, «Показать» — досье;
// выпуск — письмо об отгрузке; отгрузка в 15:00 — письмо о планёрке; «Пропустить» — следующее. Снимки —
// tools/app/out/c1-*.png, лист — tools/app/out/c1.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, steps } from './e2e-build.mjs';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function c1Part({ browser, port, out, ok, fail, errors, requests, q }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  const { ctx, page } = await openGame({ browser, port, errors, requests, q, scn: null });
  const s = steps(page, { out, fail, shots, feel, prefix: 'c1' });
  await page.evaluate(() => {
    const h = () => window.__game.store.get();
    Object.assign(window.__seen, {
      seatsOf: id => h().scenario === id && !!document.querySelector('#seats'),
      goals: () => !!document.querySelector('[data-test=goals]') && !!h().goals.view,
      dossier: () => !!document.querySelector('[data-test=dossier]'),
    });
  });
  const text = sel => page.evaluate(q => document.querySelector(q)?.innerText.replace(/\s*\n\s*/g, ' · ') ?? '', sel);
  try {
    // экран «Кампания»: сценарий 1 — первым
    await page.waitForSelector('[data-test=campaign]', { timeout: 20_000 });
    const first = await page.evaluate(() => document.querySelector('[data-test=campaign-tile]')?.dataset.scenario);
    const t1 = await text('[data-test=campaign-tile][data-scenario="scn.c1"]');
    await s.shot('Экран «Кампания»');
    if (first !== 'scn.c1' || !/Сценарий 1/.test(t1) || !/Цех на окраине/.test(t1) || !/путь материала/.test(t1) || !/13 сентября 2027/.test(t1) || !/28 суток/.test(t1) || !/выпустить 12 серий/.test(t1) || !/На отлично/.test(t1)) fail(`кампания: первым ${first} — «${t1}»`);
    else ok(`кампания: «${t1}»`);
    if (await page.evaluate(() => !!document.querySelector('#seats'))) fail('экран мест открыт вместе с кампанией');

    // «Начать» — места сценария: только директор
    await s.measure('«Начать» сценарий 1', () => page.click('[data-test=campaign-tile][data-scenario="scn.c1"] [data-test=campaign-start]'), 'seatsOf', 'scn.c1', 'input');
    const can = await page.evaluate(() => [...document.querySelectorAll('[data-test=seat-tile]')].filter(b => !b.disabled).map(b => b.dataset.seat));
    if (can.join() !== 'director') fail(`места сценария 1: ${can.join(', ')}`);
    else ok('места сценария 1: только директор');
    await s.seats(['director']);

    // старт игрока — после прогрева: понедельник 13 сентября, 07:00
    const when = await s.clock();
    if (!/13 сентября 2027/.test(when) || !/07:0\d/.test(when)) fail(`старт: «${when}»`);
    else ok(`старт: «${when}»`);

    // панель писем — сама, на первом письме наставника
    await page.waitForSelector('[data-test=letter][data-letter="let.c1.truck"]', { timeout: 20_000 }).catch(() => undefined);
    const l1 = await text('[data-test=letter]');
    await s.shot('Письмо о фуре');
    if (!/Фура у ворот/.test(l1) || !/главным технологом/.test(l1) || !/крахмал/i.test(l1) || !(await page.evaluate(() => !!document.querySelector('[data-test=letter-skip-all]')))) fail(`письмо о фуре: «${l1}»`);
    else ok(`письмо о фуре: «${l1.slice(0, 160)}…»`);
    // фура ещё в пути: письмо называет час и не зовёт «Показать», которой пока нет
    const early = await page.evaluate(() => !!document.querySelector('[data-test=letter-show]'));
    if (early || !/будет у ворот к 07:20/.test(l1) || /Нажмите «Показать»/.test(l1)) fail(`письмо о фуре до её прихода: «Показать» — ${early}, «${l1}»`);
    else ok('письмо о фуре до её прихода: час прихода, «запустите время», «Показать» нет');
    // окна (по игре владельца 20.11.2026): цели поверх писем; щелчок по письмам — они наверху; за заголовок — тащатся;
    // закрыли и открыли — на том же месте
    await page.evaluate(() => window.__game.actions.toggleGoals());
    await page.waitForSelector('[data-test=goals]', { timeout: 10_000 });
    const head = await (await page.$('[data-test=letters] > .phead'))?.boundingBox();
    if (!head) fail('окна: у писем нет заголовка');
    else {
      await page.mouse.click(head.x + 30, head.y + head.height / 2);
      const z = await page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-test=letters]')).zIndex) > Number(getComputedStyle(document.querySelector('[data-test=goals]')).zIndex));
      await page.mouse.move(head.x + 30, head.y + head.height / 2);
      await page.mouse.down();
      await page.mouse.move(head.x + 230, head.y + head.height / 2 + 120, { steps: 6 });
      await page.mouse.up();
      const moved = await page.evaluate(() => document.querySelector('[data-test=letters]').getBoundingClientRect().left);
      await page.evaluate(() => window.__game.actions.toggleLetters());
      await page.evaluate(() => window.__game.actions.toggleLetters());
      await page.waitForSelector('[data-test=letters]', { timeout: 10_000 });
      const again = await page.evaluate(() => document.querySelector('[data-test=letters]').getBoundingClientRect().left);
      if (!z || Math.abs(moved - head.x - 200) > 12 || Math.abs(again - moved) > 1) fail(`окна: наверху — ${z}, сдвиг — ${Math.round(moved - head.x)}, после закрытия — ${Math.round(again - moved)}`);
      else ok('окна: письма по щелчку — над целями, за заголовок — на 200 точек, закрыли и открыли — там же');
      await page.dblclick('[data-test=letters] > .phead', { position: { x: 30, y: 8 } });
    }
    await page.evaluate(() => window.__game.actions.toggleGoals());
    await page.click('[data-test=letters] .close');

    // полоса и окно целей
    await page.waitForSelector('[data-test=goals-open]', { timeout: 20_000 });
    const bar = await text('[data-test=goals-open]');
    await s.measure('«Цели»', () => page.click('[data-test=goals-open]'), 'goals', undefined, 'input');
    const g = await text('[data-test=goals]');
    const rows = await page.evaluate(() => document.querySelectorAll('[data-test=goal-row]').length);
    await s.shot('Цели сценария');
    if (!/Цели \d из 3/.test(bar) || rows !== 5 || !/выпустить 12 серий — сейчас 0/.test(g) || !/Конец срока/.test(g)) fail(`цели: «${bar}» — ${rows} строк — «${g}»`);
    else ok(`цели: «${bar}» · «${g}»`);
    await page.click('[data-test=goals] .close');

    // первый час — фура поставщика у рампы (фура сценария, 07:20)
    await page.evaluate(() => window.__game.actions.setSpeed(4));
    await page.waitForFunction(() => window.__game.view.trucks.some(t => !t.customer && !t.waste && t.docked), null, { timeout: 120_000 }).then(
      () => ok('фура поставщика — у рампы в первый час'),
      () => fail('фуры поставщика у рампы нет'),
    );
    await page.evaluate(() => window.__game.actions.setSpeed(0));
    const at = await s.clock();
    if (!/0[78]:\d\d/.test(at)) fail(`фура у рампы в ${at}`);
    else ok(`фура у рампы — ${at}`);
    await s.shot('Фура у рампы');
    // фура приехала: у письма — «Показать», текст зовёт её нажать
    await page.evaluate(() => window.__game.store.get().letters.open || window.__game.actions.toggleLetters());
    await page.evaluate(() => window.__game.actions.readLetter('let.c1.truck'));
    await page.waitForSelector('[data-test=letter][data-letter="let.c1.truck"] [data-test=letter-show]', { timeout: 10_000 }).catch(() => undefined);
    const l2 = await text('[data-test=letter]');
    const show = await page.evaluate(() => !!document.querySelector('[data-test=letter-show]'));
    if (!show || !/Нажмите «Показать»/.test(l2)) fail(`письмо о фуре у рампы: «Показать» — ${show}, «${l2}»`);
    else ok('письмо о фуре у рампы: «Показать» есть, текст зовёт нажать');
    await page.evaluate(() => window.__game.store.get().letters.open && window.__game.actions.toggleLetters());

    // первый день по письмам: каждое письмо наставника останавливает мир; дальше — с той же скоростью
    const letter = async (id, timeout = 180_000) => {
      const got = await page
        .waitForFunction(
          id => {
            const h = window.__game.store.get();
            if (h.letters.view?.rows.some(r => r.id === id)) return true;
            // планёрка в 08:00 — закрыть: открытая, она кончила бы письмо о планёрке, едва оно придёт
            if (h.morning.open) window.__game.actions.closeMorning(false);
            if (h.speed === 0) window.__game.actions.setSpeed(4);
            return false;
          },
          id,
          { timeout, polling: 250 },
        )
        .then(
          () => true,
          () => false,
        );
      await page.evaluate(() => window.__game.actions.setSpeed(0));
      return got;
    };
    const opened = id => page.evaluate(id => window.__game.store.get().letters.open && !!document.querySelector(`[data-test=letter][data-letter="${id}"]`), id);
    if (!(await letter('let.c1.quarantine'))) fail('письма о карантине нет');
    else {
      const r = await page.evaluate(() => window.__game.store.get().letters.view.rows.find(x => x.id === 'let.c1.truck')?.end?.how);
      const t = await text('[data-test=letter]');
      await s.shot('Письмо о карантине');
      if (r !== 'done' || !(await opened('let.c1.quarantine')) || !/Карантин и проба/.test(t) || !/партия/.test(t)) fail(`карантин: письмо о фуре — ${r}, «${t}»`);
      else ok(`фура разгружена — письмо о карантине, мир встал: «${t.slice(0, 120)}…»`);
    }
    if (!(await letter('let.c1.release'))) fail('письма о выпуске серии нет');
    else {
      const t = await text('[data-test=letter]');
      const clock = await s.clock();
      await s.measure('«Показать» — досье серии', () => page.click('[data-test=letter-show]'), 'dossier', undefined, 'input');
      await s.shot('Досье серии из письма');
      if (!/Серия на выпуске/.test(t) || !/09:\d\d/.test(clock)) fail(`выпуск: ${clock} — «${t}»`);
      else ok(`в ${clock} — письмо о выпуске серии, «Показать» открыло досье`);
      await page.evaluate(() => window.__game.actions.closeDossier());
    }
    if (!(await letter('let.c1.ship'))) fail('письма об отгрузке нет');
    else ok(`серия выпущена — письмо об отгрузке, ${await s.clock()}`);
    if (!(await letter('let.c1.morning'))) fail('письма о планёрке нет');
    else {
      const clock = await s.clock();
      const shipped = await page.evaluate(() => window.__game.store.get().letters.view.rows.find(x => x.id === 'let.c1.ship')?.end?.how);
      await s.shot('Отгрузка — письмо о планёрке');
      if (shipped !== 'done' || !/13 сентября/.test(clock) || !/1[5-9]:\d\d|2\d:\d\d/.test(clock)) fail(`отгрузка: ${clock}, письмо — ${shipped}`);
      else ok(`отгрузка в первый день — письмо о планёрке, ${clock}`);
      await page.click('[data-test=letter-skip]');
      const next = await page
        .waitForFunction(() => window.__game.store.get().letters.view?.rows.some(r => r.id === 'let.c1.lot'), null, { timeout: 20_000 })
        .then(
          () => true,
          () => false,
        );
      const how = await page.evaluate(() => window.__game.store.get().letters.view.rows.find(x => x.id === 'let.c1.morning')?.end?.how);
      if (!next || how !== 'skip') fail(`«Пропустить»: письмо о планёрке — ${how}, следующее — ${next}`);
      else ok('«Пропустить» — письмо о планёрке пропущено, пришло письмо о партии');
    }
  } catch (e) {
    fail(`сценарий 1: ${e instanceof Error ? e.message : String(e)}`);
  }
  await ctx.close();
  ok(`Сценарий 1, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'c1.png'), fullPage: true });
  await lister.close();
  ok(`Сценарий 1: ${shots.length} снимков → ${join(out, 'c1.png')}`);
}
