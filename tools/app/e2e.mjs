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
// паузе, после «Взять» поднять можно. Автопаузы (Б2а): меню — тринадцать автопауз, две — не места игрока; планёрку
// отключили — окно это помнит, и «До события» (клавиша 6) встаёт не в 08:00, а на первом событии автопаузы, с извещением со
// знаком паузы, и часы стоят. Расследование (часть 4б): «До события», пока растворение второй серии не выйдет за
// спецификацию, — извещение ставит мир на паузу и ведёт к доске; три шага, решение, разбор; ✕ мышью закрывает —
// полоса на месте (0.0.37), I открывает снова, Esc закрывает; прокрутка — с Promise, как в окне игры. Люди и допуски
// (Б3б): в справочнике — табельные номера и допуск, матрица обучения без недопущенных; карточка человека — табельный
// номер, допуск и строка обучения на каждый документ его роли. Места и оборудование (Б3в): в справочнике «Места» — у
// каждого актива инвентарный номер, у зон хранения — режим; в день первого визита подрядчика к оборудованию или машине
// лампа показывает «калибровка или квалификация», после приёмки в карточке — новая запись и кто её принял. Что делать
// (Б1г): у главной потери планёрки — рычаги и строка «Будет в …», «Потоки — люди» включает слой; карточка отклонения
// опудривания — время по досье, цель и диапазон по карте, связанные испытания, решает расследование; пояснение при
// первом событии; удержанную серию держат и выпускают из карточки её ГП; срочное задание — строкой черновика и его
// полосами в расписании до «Утвердить» (0.0.39). Графики сменности (Б4б): в карточке аппаратчика — перевод в «12 ч,
// бригада 2» с 01.10.2027, на планёрке — он же; утром 9 октября — дополнительный выходной бригады на планёрке, табель
// октября по её рисунку и календарь бригад в справочнике. Найм (Б4в): в расписании уборка — мойка оборудования и уборка
// помещения; вакансия аппаратчика по объявлению, кандидаты на планёрке, приём — медосмотр, первый день, следующий
// табельный номер, оклад и испытание в карточке; упаковщика — по соглашению: среди уволенных, расчёт в кассе. Отпуска
// (Б4г): 1 декабря в 09:00 — черновик графика с автопаузой, график по неделям в справочнике, смежная профессия и новый
// заместитель части; после утверждения — перенос части на январь; в январе — отпускные в кассе, «В отпуске» на планёрке
// и в карточке, «Замещает» у заместителя. Что в серии (Б1д): 2 сентября после отвешивания — в «Сейчас» возврат остатка
// с материалом, партией и своим значком, в карточке грануляции — что в грануляторе, в досье из неё — отвешенное
// по партиям, кто взвешивал и кто проверял, что загружено на грануляции и что — на опудривании; на шестые сутки —
// материалы блистерной машины; после упаковки — досье первой серии щелчком по полосе расписания: люди линии и сверка;
// досье выпущенной серии из карточки её ГП — и очистка линии, кто проверил. Чистота линии (Б1е): утром 6 сентября
// помещение упаковки чисто с начала игры, в карточке — «просрочено»; линия взяла задание — «грязно» и малая уборка;
// в срезе — «грязно», «чисто», «занято»; после задания — «грязно», потом «чисто» для продукта задания и до какого часа;
// на строке линии в расписании — мойка и уборка помещения; досье первой серии — после расследования: задание
// кончилось 7 сентября. Режимы (Б1ж): на одном посту производства в карточке помещения таблетирования — уставки обеих
// карт, у блистерной — скорость каждой позиции, кнопки погашены; на посту «Качество и технология» скорость ротора
// парацетамола на шаг выше цели — в справочнике уставка и норма с ней, следующее таблетирование в «Сейчас» короче, чем
// по цели карты; уставку вернули к цели, в досье серии — уставка и факт. Найм, оценка пары, визит подрядчика и отпуска
// идут по своим дням. Журнал решений (Б5а): J — записи начальников отделов планирования и снабжения, у задания на серию —
// запас, спрос и порог; «К вещи» — досье серии с «Кто решил», «Почему?» — журнал на этом решении; на планёрке — «Решения
// за сутки» с рычагом «Журнал»; на экране «Кем вы будете» коллеги — по правилам движка. Данные на полу (Б1и): слои
// слева, «Потоки — люди» с рычага планёрки отмечен в них; на шестые сутки L — столбики в помещениях производства и у машин
// линии, у каждого число, без стрелок участка; наведение — часы частей, щелчок по грануляции — блок «Загрузка» с теми же
// часами; окно «вчера» — полные сутки; доска «План — факт» по часам смены; слой — не больше четырёх вызовов отрисовки;
// снимок — в контактном листе; 9 октября за вчера у ключевой машины — OEE с множителями, как на планёрке. Отклонённое
// (Б1з): после решения по серии на посту качества следующую серию ГП отклонили — её паллеты в зоне; на планёрке — места,
// «Заказать вывоз» погашено без поста «Снабжение и склад»; директором — «Заказать вывоз»; фура подрядчика у рампы —
// погрузка и подпись начальника ОКК в «Сейчас»; запись журнала отходов и свободные места в карточке помещения, в кассе —
// «Вывоз отходов». Ошибок в консоли и запросов наружу нет. Снимки — tools/app/out/e2e*.png. Первая неделя
// (docs/specs/2026-10-vertical-slice.md): путь новичка от «Кем вы будете» до «За эту игру» на планёрке 8 сентября в
// чистом окне — tools/app/e2e-week.mjs.
//   node tools/app/e2e.mjs [--q low|medium|high] [--headed] [--port 8094] [--only main|week]
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findChromium } from './e2e-lib.mjs';
import { weekPart } from './e2e-week.mjs';
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
// окно игры — Electron 44 (Chromium 152): прокрутка там возвращает Promise, а Chromium сценария старше. Сценарий делает
// так же, иначе не увидит того, что увидит игрок: в 0.0.36 Promise из эффекта разбора ронял всё окно при закрытии доски
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
});
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
/** Упаковка в досье серии (Б1д): кто работал у линии, очистка линии, материалы по машинам, сверка печатных. */
const packOfDossier = () => {
  const pack = document.querySelector('[data-test=dossier-pack]');
  const clear = document.querySelector('[data-test=dossier-clear]');
  return {
    title: document.querySelector('#dossier-title')?.textContent ?? '',
    gantt: !!document.querySelector('#gantt'),
    crew: [...(pack?.querySelectorAll('[data-test=dossier-crew] [data-test=dossier-who]') ?? [])].map(x => x.textContent ?? ''),
    clear: clear?.textContent ?? '',
    checker: !!clear && /проверил/.test(clear.textContent ?? '') && clear.querySelectorAll('[data-test=dossier-who]').length >= 2,
    none: document.querySelector('[data-test=dossier-clear-none]')?.textContent ?? '',
    mats: [...document.querySelectorAll('[data-test=dossier-mat]')].map(x => x.getAttribute('data-material')),
    recon: [...document.querySelectorAll('[data-test=dossier-recon] > div:not(.msec)')].map(x => x.textContent ?? ''),
    decisions: document.querySelector('[data-test=dossier-decisions]')?.innerText.replace(/\s*\n\s*/g, ' · ') ?? '',
  };
};
/** Дождаться `n` кадров: программная отрисовка даёт несколько кадров в секунду, а камера и сцена меняются в кадре. */
const frames = n => page.evaluate(k => new Promise(r => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);
/** Помещение упаковки (Б1е): его номер в плане. */
const packRoom = () => page.evaluate(() => window.__game.layout.plan.plant.rooms.findIndex(r => r.id === window.__game.layout.plan.plant.lines[0].room));
/**
 * Чистота линии (Б1е): ×4 с пробой в каждом кадре, пока табличка помещения упаковки в срезе не станет `want`, и сразу
 * пауза; не дольше 72 часов завода. Планёрку закрыть, на автопаузах места игрока — дальше.
 */
const untilPackRoom = async want => {
  if (await page.evaluate(w => window.__packRoom.at(-1) === w, want)) return true;
  const from = await gameT();
  let hit = false;
  for (let i = 0; i < 80 && !hit && (await gameT()) < from + 72 * 3600; i++) {
    await page.evaluate(() => window.__game.store.get().morning.open && window.__game.actions.closeMorning(false));
    await page.evaluate(() => window.__game.actions.setSpeed(4));
    hit = await page
      .waitForFunction(w => (window.__packRoom.at(-1) === w || window.__game.speed === 0 ? { hit: window.__packRoom.at(-1) === w } : false), want, { timeout: 30_000 })
      .then(h => h.jsonValue().then(v => v.hit), () => false);
    await page.evaluate(() => window.__game.actions.setSpeed(0));
  }
  return hit;
};
/** Карты двух продуктов (Б1ж). */
const PARA = 'rcp.paracetamol500.wet.v1';
const LORA = 'rcp.loratadine10.wet.v1';
/**
 * Уставки в карточке помещения таблетирования (Б1ж): карты с режимами здесь, строка скорости ротора парацетамола, сколько
 * кнопок «−» и «+» и сколько из них нажимается, подсказка о посте. Карточка остаётся открытой.
 */
const knobsCard = async () => {
  const ci = await page.evaluate(() => window.__game.layout.plan.plant.rooms.findIndex(r => r.type === 'compression'));
  await page.evaluate(i => window.__game.actions.select({ kind: 'room', i }), ci);
  await page.waitForSelector('[data-test=card-knobs]', { timeout: 20_000 });
  await frames(2);
  return page.evaluate(p => {
    const buttons = [...document.querySelectorAll('[data-test=card-knobs] button')];
    return {
      recipes: [...document.querySelectorAll('[data-test=card-knobs]')].map(x => x.getAttribute('data-recipe')),
      speed: document.querySelector(`[data-test=card-knobs][data-recipe="${p}"] [data-test=knob-speed]`)?.textContent?.replace(/\s*[−+]\s*[−+]?\s*$/, '').trim() ?? '',
      buttons: buttons.length,
      on: buttons.filter(b => !b.disabled).length,
      warn: [...document.querySelectorAll('[data-test=card] .warn')].map(x => x.textContent ?? '').join(' '),
    };
  }, PARA);
};
/** Карточка помещения упаковки, когда в ней чистота `k`: текст строками через « · »; Esc закрывает. */
const packRoomCard = async k => {
  await page.evaluate(i => window.__game.actions.select({ kind: 'room', i }), await packRoom());
  await page.waitForFunction(k => window.__game.store.get().card?.card?.clean?.k === k, k, { timeout: 20_000 }).catch(() => {});
  await frames(2);
  const text = await page.evaluate(() => document.querySelector('[data-test=card]')?.innerText.replace(/\s*\n\s*/g, ' · ') ?? '');
  await page.keyboard.press('Escape');
  return text;
};

/**
 * «До утра» — до планёрки в 08:00; планёрку (3в) закрыть, чтобы она не заслоняла завод, — если не просят оставить. Встала
 * перемотка раньше, на автопаузе места игрока (Б2а), — «До утра» ещё раз.
 */
const untilMorning = async (keep = false) => {
  const day = await page.evaluate(() => window.__game.day);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Digit5');
    await page.waitForFunction(() => !window.__game.ff, null, { timeout: 60_000 });
    if (await page.evaluate(d => window.__game.day > d && window.__game.store.get().morning.open, day)) break;
  }
  await page.waitForFunction(d => window.__game.day > d && window.__game.store.get().morning.open, day, { timeout: 5_000 });
  if (!keep) await page.keyboard.press('Escape');
};

// части: основная — всё, что выше в шапке; «Первая неделя» — путь новичка в чистом окне (tools/app/e2e-week.mjs).
// `--only main` или `--only week` — одна из них
const only = arg('only', '');
try {
  // основная часть кончилась — её страницу закрыть: она рисует кадры и отняла бы у первой недели процессор
  if (only !== 'week') {
    await mainPart();
    await page.close();
  }
  if (only !== 'main') await weekPart({ browser, port, out, ok, fail, errors, requests, q: arg('q', 'low') });
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

async function mainPart() {
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

  // режимы (Б1ж): в карточке помещения таблетирования — уставки на следующую стадию у обеих карт, скорость ротора по цели;
  // на одном посту производства «−» и «+» погашены — уставки задаёт пост «Качество и технология». Мир на паузе
  {
    await page.evaluate(() => window.__game.actions.setSpeed(0));
    const k = await knobsCard();
    if ([...k.recipes].sort().join() !== [LORA, PARA].join() || k.speed !== 'Скорость ротора: 50\u00a0об/мин · по цели' || k.on !== 0 || !/Качество и технология/.test(k.warn))
      fail(`уставки без поста технолога: карты ${k.recipes.join(', ')}, скорость «${k.speed}», нажимается ${k.on} из ${k.buttons}, «${k.warn}»`);
    else ok(`уставки без поста технолога: у ${k.recipes.length} карт, «${k.speed}», все ${k.buttons} кнопок погашены — «${k.warn}»`);
    await page.keyboard.press('Escape');
    // блистерная машина: паспорт и скорость по уставке инструкции у каждой позиции — по цели; кнопки погашены
    await page.evaluate(() => window.__game.actions.select({ kind: 'machine', line: 0, k: 0 }));
    await page.waitForSelector('[data-test=card-speed]', { timeout: 20_000 });
    await frames(2);
    const b = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('[data-test=speed-sku]')].map(x => (x.textContent ?? '').replace(/\s*[−+]\s*[−+]?\s*$/, '').trim()),
      on: [...document.querySelectorAll('[data-test=card-speed] button')].filter(x => !x.disabled).length,
    }));
    if (b.rows.length < 2 || !b.rows.every(r => /: 120 блистеров\/мин · по цели, диапазон 100–135 блистеров\/мин$/.test(r)) || b.on !== 0)
      fail(`скорость блистерной без поста технолога: ${JSON.stringify(b)}`);
    else ok(`скорость блистерной без поста технолога: позиций ${b.rows.length}, «${b.rows[0]}», кнопки погашены`);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__game.actions.setSpeed(1));
  }

  // перевод (Б4б): в карточке аппаратчика первой смены «Перевести на график…» → «12 ч, бригада 2» — команда дошла до
  // движка: в карточке «с 01.10.2027 — 12 ч, бригада 2» и «Отменить перевод». Мир на паузе, потом снова ×1
  {
    await page.evaluate(() => window.__game.actions.setSpeed(0));
    const who = { kind: 'person', n: 9 };
    await page.evaluate(x => window.__game.actions.select(x), who);
    await page.waitForSelector('[data-test=card-roster]', { timeout: 20_000 });
    await page.selectOption('[data-test=card-roster]', 'shift.c2');
    await page.waitForSelector('[data-test=card-next]', { timeout: 20_000 });
    const c = await page.evaluate(() => ({
      shift: document.querySelector('[data-test=card-shift]')?.textContent ?? '',
      next: document.querySelector('[data-test=card-next]')?.textContent ?? '',
      cancel: !!document.querySelector('[data-test=card-roster-cancel]'),
      options: document.querySelectorAll('[data-test=card-roster] option').length,
    }));
    await page.screenshot({ path: join(out, 'e2e-roster.png') });
    if (c.shift !== 'Первая смена 5/2' || c.next !== 'с 01.10.2027 — 12 ч, бригада 2' || !c.cancel) fail(`перевод: график «${c.shift}», «${c.next}», отмена ${c.cancel}`);
    else ok(`перевод: «${c.shift}» · «${c.next}», «Отменить перевод» есть; в списке ${c.options - 1} графиков`);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__game.actions.setSpeed(1));
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
      // рабочее время (Б4а): сверхурочные вчера, кто ближе к пределу года, праздники недели; с Б4б — переводы
      hours: document.querySelector('[data-test=morning-hours]')?.innerText ?? '',
      move: document.querySelector('[data-test=morning-move]')?.textContent ?? '',
    }));
    if (m.sec !== 8 * 3600 || m.speed !== 0 || !/Планёрка/.test(m.title) || !m.yesterday || !m.now || !/^рабочее время\n(сверхурочные вчера|сверхурочных вчера не было)/iu.test(m.hours) || m.move !== 'Аппаратчик · таб. №\u00a01009 — в график «12 ч, бригада 2» с 01.10.2027')
      fail(`планёрка: часы ${m.sec / 3600} ч, скорость ${m.speed}, «${m.title}», вчера ${m.yesterday}, сейчас ${m.now}, рабочее время «${m.hours}», перевод «${m.move}»`);
    else ok(`планёрка открылась сама в 08:00, мир на паузе: «${m.title}»; ${m.hours.replace(/\s*\n\s*/g, ' · ')}`);
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
  // вчерашние уборки и переналадки (Б2г): строки с числом и часами — или «не было»
  {
    const cleans = await page
      .waitForSelector('[data-test=morning-cleans]', { timeout: 20_000 })
      .then(e => e.innerText(), () => '');
    // заголовок блока — прописными (CSS), innerText отдаёт его так же
    if (!/уборки и переналадки/i.test(cleans) || !/(уборки[^:]*|формат): \d+ — \d|не было/.test(cleans)) fail(`планёрка: уборки вчера — «${cleans.replace(/\s*\n\s*/g, ' · ')}»`);
    else ok(`планёрка: ${cleans.replace(/\s*\n\s*/g, ' · ').slice(0, 120)}`);
  }
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
  // что делать (Б1г): вчера люди много ходили — у главной потери рычаг «Потоки — люди» и строка «Будет в Б7». Рычаг
  // закрывает планёрку и включает слой участка со стрелками переходов людей; в полосе — «Потоки — люди»; «Скрыть слой»
  {
    await page.evaluate(() => window.__game.actions.openMorning());
    await page.waitForFunction(() => !!window.__game.store.get().morning.view, null, { timeout: 20_000 });
    await frames(2);
    const lv = await page.evaluate(() => {
      const main = document.querySelector('[data-test=morning-main]');
      return {
        main: window.__game.store.get().morning.view.main?.k ?? '',
        flows: !!main?.querySelector('[data-test=lever-flows] button'),
        later: [...(main?.querySelectorAll('[data-test=lever-later]') ?? [])].map(x => x.textContent ?? ''),
      };
    });
    if (lv.main !== 'walk' || !lv.flows || !lv.later.some(x => /Б7/.test(x))) fail(`планёрка: у главной потери «${lv.main}» — слой ${lv.flows}, «${lv.later.join('; ')}»`);
    else {
      await page.click('[data-test=morning-main] [data-test=lever-flows] button');
      await frames(3);
      const on = await page.evaluate(() => ({ morning: window.__game.store.get().morning.open, layer: window.__game.store.get().layer, menu: !!document.querySelector('[data-test=layer-people].on'), arrows: window.__game.stage.overlay.group.visible }));
      if (on.morning || on.layer !== 'people' || !on.menu || !on.arrows) fail(`слой «Потоки — люди»: ${JSON.stringify(on)}`);
      else ok(`планёрка: у потери «люди много ходили» — «Потоки — люди» и «${lv.later[0]}»; слой включён и отмечен слева, планёрка закрыта`);
      await page.click('[data-test=layer-plain]');
      await frames(2);
      const off = await page.evaluate(() => ({ layer: window.__game.store.get().layer, menu: !!document.querySelector('[data-test=layer-plain].on') }));
      if (off.layer !== 'plain' || !off.menu) fail(`слой «Потоки — люди»: после «Обычный вид» — ${JSON.stringify(off)}`);
    }
  }

  // склад и карточка (3б): строка склада ведёт камеру к паллете (мимо панели) и открывает карточку партии; щелчок по паллете —
  // карточка её партии; Esc снимает выбор и закрывает склад
  {
    await page.click('[data-test=stock]');
    await page.waitForSelector('[data-test=stock-row]', { timeout: 20_000 });
    const rows = await page.$$eval('[data-test=stock-row]', r => r.length);
    const unit = Number(await page.getAttribute('[data-test=stock-row]', 'data-unit'));
    await page.click('[data-test=stock-row]');
    await page.waitForSelector('[data-test=card]', { timeout: 20_000 });
    const card = await page.evaluate(() => ({
      title: document.querySelector('#card-title')?.textContent ?? '',
      selected: window.__game.selected,
      history: document.querySelectorAll('[data-test=card-history] li').length,
      // что лежит (Б1а): тара по виду и сколько в ней
      holds: [...document.querySelectorAll('[data-test=card] dt')].find(d => d.textContent === 'Что лежит')?.nextElementSibling?.textContent ?? '',
      // изготовитель и номер его партии (Б3г)
      maker: document.querySelector('[data-test=card-maker]')?.textContent ?? '',
    }));
    // камера привела паллету на экран, и её не закрывает панель склада справа; кадр с новой камерой — нарисован
    await frames(2);
    const seen = await page.evaluate(u => {
      const g = window.__game;
      const p = g.pallets.find(x => x.unit === u);
      const sp = p && g.stage.screen(p.x, p.y + 0.5, p.z);
      return !!sp && document.elementFromPoint(sp.x, sp.y) === g.stage.renderer.domElement;
    }, unit);
    if (rows < 1 || card.selected?.n !== unit || !/П-\d{4}-\d{4}/.test(card.title) || card.history < 1 || !seen || !/^\d+ \S+ (по|:)/.test(card.holds) || !/^Изготовитель .+, .+ · Номер изготовителя [A-Z-]+-\d{6}$/.test(card.maker))
      fail(`склад: строк ${rows}, выбрано ${JSON.stringify(card.selected)}, карточка «${card.title}», записей истории ${card.history}, паллета ${seen ? 'видна' : 'не видна'}, лежит «${card.holds}», изготовитель «${card.maker}»`);
    else ok(`склад: строк ${rows}; строка — паллета ${unit} на экране мимо панели, карточка «${card.title}» — «${card.holds}», «${card.maker}», записей истории ${card.history}`);
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
    // уборка в два шага (Б4в): после мойки оборудования — уборка помещения уборщиком
    const room = await page.$$eval('[data-test=gbar][data-kind=roomClean]', r => r.length);
    if (rows < 6 || bars < 5 || !bar || room === 0) fail(`расписание: строк ${rows}, полос ${bars}, уборки помещения ${room}, задания, которое можно тянуть, ${bar ? 'есть' : 'нет'}`);
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
        ok(`расписание: строк ${rows}, полос ${bars}, из них уборки помещения — ${room}; задание ${batch} протянули на сутки раньше — призрак, у курсора «${tip.slice(0, 90)}…»; отпустили — «${marks.list}», срок прежний; полос черновика ${marks.draft}, прежних ${marks.was}`);

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
          // генеральные уборки и переналадки в горизонте (Б2г): у обоих столбцов — число и часы
          major: [...document.querySelectorAll('[data-test=plan-major] td')].slice(1).map(td => td.textContent ?? ''),
          changes: [...document.querySelectorAll('[data-test=plan-changes] td')].slice(1).map(td => td.textContent ?? ''),
          ms: p.ms,
          error: p.error,
        };
      });
      await page.evaluate(() => document.querySelector('[data-test=plan]')?.scrollIntoView());
      await frames(2);
      await page.screenshot({ path: join(out, 'e2e-plan.png') });
      // низ итога — «Завод»: касса, OEE, генеральные уборки и переналадки (Б2г)
      await page.evaluate(() => document.querySelector('[data-test=plan-changes]')?.scrollIntoView({ block: 'end' }));
      await frames(2);
      await page.screenshot({ path: join(out, 'e2e-plan-plant.png') });
      const hours = xs => xs.length === 2 && xs.every(x => /^\d+( \(\d+–\d+\))? — \d/.test(x));
      if (!started || !done || plan.error || plan.cols !== 3 || plan.seeds !== '5,5' || plan.batches < 1 || r1 <= r0 || !hours(plan.major) || !hours(plan.changes))
        fail(`прогон плана: начат ${started}, готов ${done}, ошибка ${plan.error ?? 'нет'}, столбцов ${plan.cols}, зёрен ${plan.seeds}, серий ${plan.batches}, часы ${r0} → ${r1}, генеральные уборки «${plan.major.join(' | ')}», переналадки «${plan.changes.join(' | ')}»`);
      else
        ok(`прогон плана: «как сейчас» и черновик на 5 зёрнах за ${plan.ms} мс; заказов ${plan.orders}, серий ${plan.batches}, «${plan.cash.slice(0, 80)}»; генеральные уборки «${plan.major.join(' | ')}», переналадки «${plan.changes.join(' | ')}»; часы завода прошли ${r1 - r0} с — игра не замерла`);

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
  const kinds = new Set(['run', 'wait', 'stop', 'fail', 'setup', 'clean', 'check', 'off']);
  if (lamps.shown.length !== lamps.want || !lamps.shown.every(l => kinds.has(l))) fail(`лампы: ${lamps.shown.join(', ')} — ждали ${lamps.want}`);
  else ok(`лампы: ${lamps.shown.length} — ${[...new Set(lamps.shown)].join(', ')}`);

  // модели из Blender (#109, #112): пресс, блистерная и картонажная — из одного .glb; «Модели» в панели отладки
  // пересобирает машины кодом и обратно
  const art = await page.evaluate(async () => {
    const g = window.__game;
    const now = () => ({ glb: g.stage.machines.fromBlender, mode: g.store.get().art });
    const before = now();
    g.actions.setArt('code');
    const code = now();
    g.actions.setArt('blender');
    await new Promise(r => setTimeout(r, 100));
    return { before, code, after: now() };
  });
  const artWant = { before: { glb: 3, mode: 'blender' }, code: { glb: 0, mode: 'code' }, after: { glb: 3, mode: 'blender' } };
  if (JSON.stringify(art) !== JSON.stringify(artWant)) fail(`модели из Blender: ${JSON.stringify(art)}`);
  else ok('модели из Blender: пресс, блистерная и картонажная из .glb; «Модели» — простые и обратно');

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

  // что в серии (Б1д): 2 сентября, когда первую серию отвесили и кладовщик выносит остатки, — в «Сейчас» возврат остатка
  // с материалом, партией и своим значком «обратно на склад»; в карточке помещения грануляции — что в грануляторе
  // по партиям; «Досье» из неё — пять строк «Отвешено» с партиями, кто взвешивал и кто проверял; на грануляции загружены
  // четыре компонента, магния стеарат — на опудривании впереди. Мир — на ×4 с пробой в каждом кадре и сразу пауза
  const GRAN = ['mat.api.paracetamol', 'mat.exc.starch', 'mat.exc.povidone', 'mat.exc.mcc'];
  let first;
  {
    await page.keyboard.press('KeyN');
    await page.waitForFunction(() => !!window.__game.store.get().now.view, null, { timeout: 20_000 });
    // проба — без замыканий: функция уходит в страницу целиком. Срабатывает, когда в «Сейчас» и возврат остатка
    // с материалом, и грануляция, или когда мир встал сам — на автопаузе места игрока
    const probe = () => {
      const g = window.__game;
      const rows = g.store.get().now.view?.rows ?? [];
      const hit = rows.some(r => r.kind === 'return' && !!r.material) && rows.some(r => r.kind === 'stage' && r.stage === 'granulate');
      return hit || g.speed === 0 ? { hit } : false;
    };
    const from = await gameT();
    let hit = false;
    for (let i = 0; i < 60 && !hit && (await gameT()) < from + 12 * 3600; i++) {
      await page.evaluate(() => window.__game.store.get().morning.open && window.__game.actions.closeMorning(false));
      await page.evaluate(() => window.__game.actions.setSpeed(4));
      hit = await page.waitForFunction(probe, null, { timeout: 30_000 }).then(h => h.jsonValue().then(v => v.hit), () => false);
      await page.evaluate(() => window.__game.actions.setSpeed(0));
    }
    await frames(2);
    const back = await page.evaluate(() =>
      [...document.querySelectorAll('[data-test=now-row][data-kind=return]')].map(r => ({
        text: r.querySelector('.ntitle')?.textContent?.trim() ?? '',
        icon: r.querySelector('.ntitle svg')?.getAttribute('data-icon') ?? '',
      })),
    );
    const hour = await page.evaluate(() => (window.__game.t % 86400) / 3600);
    if (!hit || back.length === 0 || !back.every(r => /^Возврат остатков · .+, П-\d{4}-\d{4} · серия [A-Z]{2}\d{3,}$/.test(r.text) && r.icon === 'back'))
      fail(`«Сейчас» в ${hour.toFixed(1)} ч: возврат с грануляцией ${hit ? 'есть' : 'не дождались'}, строки возврата ${JSON.stringify(back)}`);
    else ok(`«Сейчас» в ${hour.toFixed(1)} ч: «${back[0].text}», значок «${back[0].icon}»`);
    const gi = await page.evaluate(() => window.__game.layout.plan.plant.rooms.findIndex(r => r.type === 'granulation'));
    await page.evaluate(i => window.__game.actions.select({ kind: 'room', i }), gi);
    await page.waitForFunction(() => !!window.__game.store.get().card?.card?.inside, null, { timeout: 20_000 }).catch(() => {});
    await frames(2);
    const room = await page.evaluate(() => ({
      stage: document.querySelector('[data-test=card-inside]')?.getAttribute('data-stage') ?? '',
      items: [...document.querySelectorAll('[data-test=card-inside-item]')].map(x => ({ m: x.getAttribute('data-material'), text: x.textContent ?? '' })),
      bn: window.__game.store.get().card?.card?.bn,
    }));
    if (room.stage !== 'granulate' || room.items.map(x => x.m).join() !== GRAN.join() || !room.items.every(x => /П-\d{4}-\d{4}/.test(x.text)) || room.bn === undefined)
      fail(`карточка грануляции: стадия «${room.stage}», в нём ${JSON.stringify(room.items)}, серия ${room.bn}`);
    else ok(`карточка грануляции, «Что в нём»: ${room.items.map(x => x.text).join('; ')}`);
    if (room.bn !== undefined) {
      first = room.bn;
      await page.click('[data-test=card-dossier]');
      await page.waitForFunction(n => window.__game.store.get().dossier.view?.batch === n, room.bn, { timeout: 20_000 });
      await frames(2);
      const d = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-test=dossier-disp-row]')];
        const stage = id => document.querySelector(`[data-test=dossier-stage][data-stage=${id}]`);
        const load = id => [...(stage(id)?.querySelectorAll('[data-test=dossier-load-item]') ?? [])].map(x => x.getAttribute('data-material'));
        const weigh = document.querySelector('[data-test=dossier-weigh]');
        return {
          title: document.querySelector('#dossier-title')?.textContent ?? '',
          rows: rows.length,
          lots: rows.filter(r => r.querySelector('[data-test=dossier-lot]')).length,
          weigh: weigh?.textContent ?? '',
          who: [...(weigh?.querySelectorAll('[data-test=dossier-who]') ?? [])].map(x => x.textContent ?? ''),
          gran: { state: stage('granulate')?.getAttribute('data-state'), load: load('granulate') },
          blend: { state: stage('blend')?.getAttribute('data-state'), load: load('blend') },
        };
      });
      if (d.rows !== 5 || d.lots !== 5 || !/взвешивал .+ · проверял .+/.test(d.weigh) || d.who.length !== 2 || d.who[0] === d.who[1])
        fail(`${d.title}: строк «Отвешено» ${d.rows}, с партиями ${d.lots}, «${d.weigh}»`);
      else if (d.gran.state !== 'now' || d.gran.load.join() !== GRAN.join() || d.blend.state !== 'plan' || d.blend.load.join() !== 'mat.exc.mgst')
        fail(`${d.title}: грануляция ${JSON.stringify(d.gran)}, опудривание ${JSON.stringify(d.blend)}`);
      else ok(`${d.title}: «Отвешено» — ${d.rows} строк с партиями; «${d.weigh}»; на грануляции загружены ${d.gran.load.length} компонента, на опудривании впереди — магния стеарат`);
    }
    // Esc: досье, выбор, «Сейчас»
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
    if (await page.evaluate(() => !!document.querySelector('#dossier') || !!document.querySelector('[data-test=card]') || !!document.querySelector('#now'))) fail('досье: Esc не закрыл досье, карточку и «Сейчас»');
  }

  // чистота линии (Б1е): табличка помещения упаковки в срезе — с этой минуты по кадрам, каждая смена статуса
  await page.evaluate(() => {
    const g = window.__game;
    const i = g.layout.plan.plant.rooms.findIndex(r => r.id === g.layout.plan.plant.lines[0].room);
    const seen = (window.__packRoom = []);
    const look = () => {
      const st = g.view?.rooms.find(r => r.room === i)?.status;
      if (st && seen.at(-1) !== st) seen.push(st);
      requestAnimationFrame(look);
    };
    look();
  });

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
  // чистота линии (Б1е): утром 6 сентября помещение упаковки чисто с начала игры — в карточке «просрочено»; линия взяла
  // задание — его убирают снова: «грязно» и малая уборка, если начать до такого-то часа
  {
    const old = await packRoomCard('clean');
    if (!/Чисто для · любого продукта/.test(old) || !/просрочено/.test(old)) fail(`помещение упаковки утром: «${old}»`);
    else ok(`помещение упаковки утром: «${old}»`);
    const dirty = (await untilPackRoom('dirty')) ? await packRoomCard('dirty') : '';
    if (!/Грязно/.test(dirty) || !/Уборка · малая, если начать до/.test(dirty)) fail(`помещение упаковки перед заданием: «${dirty || 'не дождались'}»`);
    else ok(`помещение упаковки перед заданием: «${dirty}»`);
  }
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
  // чистота линии (Б1е): помещение упаковки чисто с начала игры дольше 72 часов — перед первым заданием его убрали
  // снова: табличка «грязно», потом «чисто» и «занято» серией
  {
    const seen = await page.evaluate(() => window.__packRoom.join(' → '));
    if (!/dirty → clean → busy$/.test(seen)) fail(`помещение упаковки перед первым заданием: ${seen}`);
    else ok(`помещение упаковки перед первым заданием: ${seen}`);
  }

  // «Сейчас» (Б1б): N — работы по разделам; у упаковки — пачки и скорость. «Смотреть» — камера к линии, её карточка с той же
  // кнопкой, ×1 и «Смотрите: …» в полосе; «Перестать» — прежняя скорость, пауза; Esc закрывает карточку и панель
  {
    await page.keyboard.press('KeyN');
    await page.waitForFunction(() => (window.__game.store.get().now.view?.rows.length ?? 0) > 0, null, { timeout: 20_000 });
    await frames(2);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[data-test=now-row]')].map(r => ({ key: r.getAttribute('data-key'), kind: r.getAttribute('data-kind'), text: r.innerText.replace(/\s+/g, ' ').trim() })),
    );
    const pack = rows.find(r => r.kind === 'pack');
    if (!pack || !/пачек/.test(pack.text)) fail(`«Сейчас»: строк ${rows.length}, упаковки ${pack ? `«${pack.text}»` : 'нет'}`);
    else ok(`«Сейчас»: строк ${rows.length} (${rows.map(r => r.kind).join(', ')}); упаковка — «${pack.text}»`);
    await page.screenshot({ path: join(out, 'e2e-now.png') });
    if (pack) {
      await page.click(`[data-test=now-row][data-key="${pack.key}"] [data-test=now-watch]`);
      await page.waitForFunction(() => window.__game.speed === 1 && !!window.__game.store.get().watch, null, { timeout: 10_000 });
      await frames(2);
      const w = await page.evaluate(() => ({
        text: document.querySelector('[data-test=watching]')?.textContent ?? '',
        sel: window.__game.selected,
        card: !!document.querySelector('[data-test=card-watch]'),
      }));
      if (!/Смотрите/.test(w.text) || w.sel?.kind !== 'machine' || !w.card) fail(`«Смотреть»: полоса «${w.text}», выбрано ${JSON.stringify(w.sel)}, «Смотреть» в карточке ${w.card ? 'есть' : 'нет'}`);
      else ok(`«Смотреть»: ×1, камера и карточка у линии, в полосе «${w.text}»`);
      await page.click('[data-test=unwatch]');
      await page.waitForFunction(() => window.__game.speed === 0 && !window.__game.store.get().watch, null, { timeout: 10_000 });
      ok('«Перестать»: прежняя скорость — пауза');
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    if (await page.evaluate(() => !!document.querySelector('#now') || !!document.querySelector('[data-test=card]'))) fail('«Сейчас»: Esc не закрыл карточку и панель');
  }

  // что на линии (Б1д): пока линия упаковывает первую серию, в карточке блистерной машины — плёнка и фольга: партия,
  // выдано, израсходовано по счёту машины и на наладку, осталось у линии
  {
    await page.evaluate(() => window.__game.actions.select({ kind: 'machine', line: 0, k: 0 }));
    await page.waitForFunction(() => (window.__game.store.get().card?.card?.materials?.length ?? 0) > 0, null, { timeout: 20_000 }).catch(() => {});
    await frames(2);
    const m = await page.evaluate(() => ({
      list: (window.__game.store.get().card?.card?.materials ?? []).map(x => ({ m: x.material, issued: x.issued, used: x.used, left: x.left })),
      text: [...document.querySelectorAll('[data-test=card-line-mat]')].map(x => x.innerText.replace(/\s*\n\s*/g, ' · ')),
    }));
    if (m.list.map(x => x.m).join() !== 'mat.pk.pvc,mat.pk.alu' || !m.list.every(x => x.used > 0 && x.left > 0 && x.used + x.left === x.issued) || m.text.length !== 2)
      fail(`карточка блистерной машины: материалы ${JSON.stringify(m.list)}`);
    else ok(`карточка блистерной машины: ${m.text.join('; ')}`);
    await page.keyboard.press('Escape');
  }

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
  const site = await page.evaluate(() => ({ people: window.__game.stage.peopleShown, vehicles: window.__game.stage.vehiclesShown, arrows: window.__game.stage.overlay.arrowsShown, badges: window.__game.stage.badges.mesh.count }));
  if (site.people || site.vehicles || site.arrows < 1 || site.badges) fail(`участок: людей ${site.people}, техники ${site.vehicles}, стрелок ${site.arrows}, значков работ ${site.badges}`);
  else ok(`участок: стрелок ${site.arrows}, люди, техника и значки работ скрыты`);
  await camAt(HALL);
  await settle(1);
  const hall = await page.evaluate(() => ({
    people: window.__game.stage.peopleShown,
    layer: window.__game.stage.overlay.group.visible,
    badges: window.__game.stage.badges.mesh.count,
    busy: window.__game.view.people.filter(p => p.present && p.task >= 0).length,
  }));
  if (hall.people < 1 || hall.layer || hall.badges < 1 || hall.badges > hall.busy) fail(`цех: людей ${hall.people}, слой участка ${hall.layer ? 'виден' : 'скрыт'}, значков работ ${hall.badges} при занятых ${hall.busy}`);
  else ok(`цех: по одному — людей ${hall.people}, значков работ ${hall.badges} (занятых ${hall.busy}), слой участка скрыт`);

  // данные на полу (Б1и): L — «Загрузка и OEE»: столбики в помещениях производства и у машин линии, у каждого число;
  // стрелки участка не проступают, светильников под потолком нет, люди остаются; слой — не больше четырёх вызовов
  // отрисовки; наведение — часы частей; щелчок по столбику грануляции — блок «Загрузка» с теми же часами; окно «вчера» —
  // полные сутки; доска «План — факт» у линии — план и годные пачки текущей смены; «Обычный вид» — столбиков нет,
  // светильники снова видны. Снимок — в контактный лист
  let floorShot;
  let bottleShot;
  {
    await page.evaluate(() => window.__game.actions.select(undefined));
    await camAt({ x: 39, z: 9, half: 10 });
    await settle(1);
    await frames(3);
    const off = await page.evaluate(() => window.__game.stage.calls);
    await page.keyboard.press('KeyL');
    await page.waitForFunction(() => window.__game.store.get().layer === 'load' && !!window.__game.store.get().floor.view, null, { timeout: 20_000 });
    await frames(4);
    const v = await page.evaluate(() => {
      const g = window.__game;
      const plant = g.layout.plan.plant;
      const bars = g.stage.floor.bars;
      return {
        calls: g.stage.calls,
        rooms: bars.filter(b => b.thing.kind === 'room').map(b => plant.rooms[b.thing.i].type),
        machines: bars.filter(b => b.thing.kind === 'machine').length,
        want: plant.lines.reduce((n, l) => n + l.machines.length, 0),
        labels: bars.every(b => b.label && (b.label.k === 'key' || b.label.share !== undefined)),
        key: bars.filter(b => b.label.k === 'key').length,
        arrows: g.stage.overlay.group.visible,
        lamps: g.stage.lamps.mesh.visible,
        people: g.stage.peopleShown,
        boards: g.stage.floor.boardsShown,
        legend: document.querySelectorAll('[data-test=floor-legend] li').length,
      };
    });
    const ROOMS = ['dispensing', 'granulation', 'blending', 'compression', 'packaging'];
    if (v.rooms.join() !== ROOMS.join() || v.machines !== v.want || !v.labels || v.key !== 1 || v.arrows || v.lamps || v.people < 1 || v.boards !== 1 || v.legend !== 6 || v.calls - off > 4)
      fail(`слой «Загрузка и OEE»: ${JSON.stringify(v)}, вызовов без слоя ${off}`);
    else ok(`слой «Загрузка и OEE»: столбики в ${v.rooms.join(', ')} и у ${v.machines} машин, у каждого число, OEE — у одной; доска у линии; стрелок и светильников нет, людей ${v.people}; вызовов отрисовки ${v.calls - off >= 0 ? '+' : ''}${v.calls - off}`);
    await page.screenshot({ path: join(out, 'e2e-floor.png') });
    floorShot = { file: join(out, 'e2e-floor.png'), label: `Б1и · «Загрузка и OEE» · цех · ${v.calls} вызовов` };
    // наведение и щелчок — по столбику грануляции
    const at = await page.evaluate(() => {
      const g = window.__game;
      const b = g.stage.floor.spots.bars.find(x => x.thing.kind === 'room' && g.layout.rooms[x.thing.i].type === 'granulation');
      return { sp: g.stage.screen(b.x, 1.2, b.z), i: b.thing.i };
    });
    if (!at.sp) fail('столбик грануляции не на экране');
    else {
      await page.mouse.move(at.sp.x, at.sp.y);
      await page.waitForSelector('[data-test=floor-tip]', { timeout: 10_000 }).catch(() => {});
      const tip = await page.evaluate(i => {
        const r = window.__game.store.get().floor.view.rooms.find(x => x.i === i);
        return { rows: document.querySelectorAll('[data-test=floor-tip-row]').length, want: Object.values(r.times).filter(x => x > 0).length, text: document.querySelector('[data-test=floor-tip]')?.textContent ?? '' };
      }, at.i);
      if (tip.rows < 1 || tip.rows !== tip.want || !/Грануляция/.test(tip.text)) fail(`подсказка у столбика грануляции: ${JSON.stringify(tip)}`);
      else ok(`подсказка у столбика грануляции: ${tip.text}`);
      await page.mouse.click(at.sp.x, at.sp.y);
      await page.waitForSelector('[data-test=card-load-row]', { timeout: 20_000 }).catch(() => {});
      const card = await page.evaluate(i => {
        const g = window.__game;
        const r = g.store.get().floor.view.rooms.find(x => x.i === i);
        const rows = [...document.querySelectorAll('[data-test=card-load-row]')].map(x => [x.getAttribute('data-part'), Number(x.getAttribute('data-sec'))]);
        return { sel: g.selected, rows, times: r.times };
      }, at.i);
      const same = card.rows.length === 5 && card.rows.every(([p, sec]) => card.times[p] === sec);
      if (card.sel?.kind !== 'room' || card.sel.i !== at.i || !same) fail(`карточка грануляции, «Загрузка»: ${JSON.stringify(card)}`);
      else ok(`карточка грануляции: блок «Загрузка» — те же часы, ${card.rows.map(([p, sec]) => `${p} ${Math.round(sec / 60)} мин`).join(', ')}`);
      await page.mouse.move(5, 400);
    }
    // окно — вчера: полные календарные сутки; OEE с планёркой сверяется 9 октября, когда вчера линия упаковывала
    await page.click('[data-test=floor-win-yesterday]');
    await page.waitForFunction(() => window.__game.store.get().floor.view?.win === 'yesterday', null, { timeout: 20_000 });
    const span = await page.evaluate(() => window.__game.store.get().floor.view.span);
    if (span !== 86400) fail(`окно «вчера»: ${span} с`);
    else ok('окно «вчера»: полные сутки, 86 400 с');
    await page.click('[data-test=floor-win-today]');
    // доска «План — факт»: сменное задание по часам; план часов — задание поровну, годные — по прошедшим часам
    const board = await page.evaluate(() => window.__game.store.get().floor.view.lines[0].board);
    const hours = board ? (board.ends - board.from) / 3600 : 0;
    if (!board || board.hours.length !== hours || board.hours.reduce((n, h) => n + h.plan, 0) !== board.plan || board.hours.reduce((n, h) => n + (h.fact ?? 0), 0) !== board.fact)
      fail(`доска «План — факт»: ${JSON.stringify(board)}`);
    else ok(`доска «План — факт»: смена ${new Date(board.from * 1000).toISOString().slice(11, 16)}–${new Date(board.ends * 1000).toISOString().slice(11, 16)}, задание ${board.plan}, годных ${board.fact}, по часам ${board.hours.map(h => h.fact ?? '·').join(' ')}`);
    await page.keyboard.press('Escape');
    // узкие места (Б1к): L — «Узкие места», окно — 7 суток: над тремя местами, где серии дольше всего ждали, — табличка
    // с местом по порядку, часами и словом, над машиной, которая держит линию, — «держит линию»; столбиков, досок и
    // светильников нет; слой — не больше четырёх вызовов отрисовки; наведение на первую табличку — подсказка с часами по
    // словам; щелчок — карточка помещения с блоком «Узкие места», те же часы. Снимок — в контактный лист
    await page.keyboard.press('KeyL');
    await page.waitForFunction(() => window.__game.store.get().layer === 'bottle', null, { timeout: 10_000 });
    await page.click('[data-test=floor-win-week]');
    await page.waitForFunction(() => window.__game.store.get().floor.view?.win === 'week', null, { timeout: 20_000 });
    await frames(4);
    const bv = await page.evaluate(() => {
      const g = window.__game;
      const v = g.store.get().floor.view;
      const plates = g.stage.plates.plates;
      return {
        calls: g.stage.calls,
        tops: plates.filter(p => p.k === 'top').map(p => ({ i: p.thing.i, rank: p.rank, sec: p.sec, what: p.what })),
        want: v.waits.filter(w => w.total > 0).slice(0, 3).map((w, n) => ({ i: w.i, rank: n + 1, sec: w.total, what: w.what })),
        holds: plates.filter(p => p.k === 'holds').map(p => p.thing),
        lines: v.lines.filter(l => l.holds).map(l => ({ kind: 'machine', line: l.n, k: l.holds.k })),
        types: Object.fromEntries(g.layout.rooms.map((r, i) => [i, r.type])),
        bars: g.stage.floor.group.visible,
        lamps: g.stage.lamps.mesh.visible,
        legend: !!document.querySelector('[data-test=bottle-legend]'),
      };
    });
    if (bv.tops.length !== Math.min(3, bv.want.length) || JSON.stringify(bv.tops) !== JSON.stringify(bv.want) || JSON.stringify(bv.holds) !== JSON.stringify(bv.lines) || bv.bars || bv.lamps || !bv.legend || bv.calls - off > 4)
      fail(`слой «Узкие места»: ${JSON.stringify(bv)}, вызовов без слоя ${off}`);
    else ok(`слой «Узкие места» за 7 суток: ${bv.tops.map(t => `${t.rank} — ${bv.types[t.i]}, ${Math.round(t.sec / 3600)} ч, ${t.what}`).join('; ')}; «держит линию» — над ${bv.holds.length} машиной; столбиков и светильников нет; вызовов отрисовки ${bv.calls - off >= 0 ? '+' : ''}${bv.calls - off}`);
    await page.screenshot({ path: join(out, 'e2e-bottle.png') });
    bottleShot = { file: join(out, 'e2e-bottle.png'), label: `Б1к · «Узкие места» · 7 суток · ${bv.calls} вызовов` };
    const top = await page.evaluate(() => {
      const g = window.__game;
      const p = g.stage.plates.plates.find(x => x.k === 'top' && x.rank === 1);
      return p ? { sp: g.stage.screen(p.x, 2.4 + p.h / 2, p.z), i: p.thing.i } : undefined;
    });
    if (!top?.sp) fail('табличка первого места не на экране');
    else {
      await page.mouse.move(top.sp.x, top.sp.y);
      await page.waitForSelector('[data-test=bottle-tip]', { timeout: 10_000 }).catch(() => {});
      const tip = await page.evaluate(i => {
        const w = window.__game.store.get().floor.view.waits.find(x => x.i === i);
        return {
          rows: [...document.querySelectorAll('[data-test=bottle-tip] [data-test=bottle-row]')].map(x => [x.getAttribute('data-what'), Number(x.getAttribute('data-sec'))]),
          sec: w.sec,
          rank: document.querySelector('[data-test=bottle-tip] [data-test=bottle-rank]')?.textContent ?? '',
          text: document.querySelector('[data-test=bottle-tip]')?.textContent ?? '',
        };
      }, top.i);
      const same = tip.rows.length > 0 && tip.rows.length === Object.keys(tip.sec).length && tip.rows.every(([k, sec]) => tip.sec[k] === sec);
      if (!same || !/^1-е место/.test(tip.rank) || !/ждали/.test(tip.text)) fail(`подсказка у таблички первого места: ${JSON.stringify(tip)}`);
      else ok(`подсказка у таблички первого места: ${tip.text}`);
      await page.mouse.click(top.sp.x, top.sp.y);
      await page.waitForSelector('[data-test=card-bottle] [data-test=bottle-row]', { timeout: 20_000 }).catch(() => {});
      const card = await page.evaluate(i => {
        const g = window.__game;
        const w = g.store.get().floor.view.waits.find(x => x.i === i);
        return {
          sel: g.selected,
          rows: [...document.querySelectorAll('[data-test=card-bottle] [data-test=bottle-row]')].map(x => [x.getAttribute('data-what'), Number(x.getAttribute('data-sec'))]),
          now: document.querySelectorAll('[data-test=card-bottle] [data-test=bottle-now]').length,
          want: w.now.length,
          sec: w.sec,
        };
      }, top.i);
      const same2 = card.rows.length > 0 && card.rows.every(([k, sec]) => card.sec[k] === sec);
      if (card.sel?.kind !== 'room' || card.sel.i !== top.i || !same2 || card.now !== card.want) fail(`карточка первого места, «Узкие места»: ${JSON.stringify(card)}`);
      else ok(`карточка первого места: блок «Узкие места» — те же часы, ждут сейчас — ${card.now}`);
      await page.keyboard.press('Escape');
      await page.mouse.move(5, 400);
    }
    // L — «Проблемы»: таблички ушли, значки — над теми вещами вида, что стоят на полу; что не горит — значков нет
    await page.keyboard.press('KeyL');
    await page.waitForFunction(() => window.__game.store.get().layer === 'andon' && !!window.__game.store.get().andon.view, null, { timeout: 20_000 });
    await frames(4);
    const av = await page.evaluate(() => {
      const g = window.__game;
      return {
        items: g.store.get().andon.view.items.length,
        marks: g.stage.andon.marks.length,
        plates: g.stage.plates.mesh.visible,
        legend: document.querySelectorAll('[data-test=andon-legend] li').length,
        calls: g.stage.calls,
      };
    });
    if (av.marks > av.items || av.plates || av.legend !== 3 || av.calls - off > 4) fail(`слой «Проблемы»: ${JSON.stringify(av)}, вызовов без слоя ${off}`);
    else ok(`слой «Проблемы»: не работает ${av.items} вещей — значков ${av.marks}; табличек нет; вызовов отрисовки ${av.calls - off >= 0 ? '+' : ''}${av.calls - off}`);
    // L — «Потоки — люди», L — «Обычный вид»: столбиков нет
    await page.keyboard.press('KeyL');
    await page.keyboard.press('KeyL');
    await frames(2);
    const plain = await page.evaluate(() => ({ layer: window.__game.store.get().layer, shown: window.__game.stage.floor.group.visible, lamps: window.__game.stage.lamps.mesh.visible }));
    if (plain.layer !== 'plain' || plain.shown || !plain.lamps) fail(`«Обычный вид»: ${JSON.stringify(plain)}`);
    else ok('«Обычный вид»: столбиков и досок нет, светильники снова видны');
  }

  // контактный лист (13-art.md, §17): три высоты камеры днём (час упаковки) и ночью на трёх пресетах
  const heights = [
    ['site', null, 3],
    ['hall', HALL, 1],
    ['machine', MACHINE, 1],
  ];
  const sheet = [];
  /** Один лист: строки — пресет и время суток, столбцы — высота; за ними — снимки слоёв. */
  const writeSheet = async list => {
    const cells = list.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
    const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
    await lister.setContent(
      `<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`,
    );
    await lister.screenshot({ path: join(out, 'contact.png'), fullPage: true });
    await lister.close();
    ok(`контактный лист: ${list.length} снимков → ${join(out, 'contact.png')}`);
  };
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
  // и слои «Загрузка и OEE» (Б1и) и «Узкие места» (Б1к) — днём, в час упаковки; «Проблемы» (Б1к) — в конце основной
  // части, когда что-то не работает: лист пишется ещё раз
  if (floorShot) sheet.push(floorShot);
  if (bottleShot) sheet.push(bottleShot);
  await writeSheet(sheet);

  // автопаузы (Б2а): у производства и качества тринадцать автопауз в меню (с Б3б — «потерял допуск», с Б3в — «срок
  // вышел», с Б3г — «пара приостановлена», с Б4а — «сверхурочные года на исходе», с Б4в — «заявление об увольнении»,
  // с Б4г — «черновик графика отпусков»),
  // «фура» и «заказ» — не их; планёрку отключили — окно помнит; «До события» — мир
  // встал не в 08:00, а на первом событии автопаузы мест игрока: извещение со знаком паузы, часы стоят, отставания нет.
  // Планёрку включили обратно
  {
    await page.click('[data-test=pauses-open]');
    await page.waitForSelector('[data-test=pauses]', { timeout: 10_000 });
    const menu = await page.evaluate(() => ({
      all: document.querySelectorAll('[data-test=pause]').length,
      on: document.querySelectorAll('[data-test=pause]:checked').length,
      notYours: [...document.querySelectorAll('[data-test=pauses] li.muted [data-test=pause]')].map(x => x.getAttribute('data-id')),
    }));
    await page.click('[data-test=pause][data-id=morning]');
    const kept = await page.evaluate(() => localStorage.getItem('pharma.pauses'));
    await page.screenshot({ path: join(out, 'e2e-pauses.png') });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    if (menu.all !== 13 || menu.on !== 13 || menu.notYours.join() !== 'truckWait,orderRisk' || kept !== '["morning"]' || (await page.evaluate(() => !!document.querySelector('#pauses'))))
      fail(`автопаузы: в меню ${menu.all}, включено ${menu.on}, не ваши ${menu.notYours.join(', ')}, в окне «${kept}»`);
    else ok(`автопаузы: в меню ${menu.all}, не ваши — ${menu.notYours.join(', ')}; планёрку отключили — в окне ${kept}; Esc закрыл меню`);
    const t0 = await gameT();
    await page.keyboard.press('Digit6');
    const ran = await page.evaluate(() => window.__game.ff && window.__game.ffTo === 'event');
    await page.waitForFunction(() => !window.__game.ff, null, { timeout: 120_000 });
    await frames(3);
    const st = await page.evaluate(() => ({
      speed: window.__game.speed,
      lag: window.__game.lag,
      t: window.__game.t,
      morning: window.__game.store.get().morning.open,
      top: window.__game.store.get().notices[0],
      cls: document.querySelector('.top .notice')?.className ?? '',
      text: document.querySelector('.top .notice')?.textContent ?? '',
    }));
    await page.waitForTimeout(500);
    const t1 = await gameT();
    if (!ran || st.speed !== 0 || st.lag !== 0 || !st.top?.stop || !/stop/.test(st.cls) || !st.text.startsWith('❚❚') || /Планёрка/.test(st.text) || t1 !== st.t || st.t <= t0)
      fail(`«До события»: промотка ${ran}, скорость ${st.speed}, отставание ${st.lag}, извещение «${st.text}» (${st.cls}), часы ${t0} → ${st.t} → ${t1}`);
    else ok(`«До события»: мир встал через ${((st.t - t0) / 3600).toFixed(1)} ч на «${st.text}» — часы стоят`);
    // без автопаузы планёрка открывается сама, но мир не ждёт: закрыть
    if (st.morning) await page.keyboard.press('Escape');
    await page.click('[data-test=pauses-open]');
    await page.click('[data-test=pause][data-id=morning]');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    if ((await page.evaluate(() => localStorage.getItem('pharma.pauses'))) !== '[]') fail('автопаузы: планёрку не включили обратно');
  }

  // расследование (часть 4б): «До события», пока растворение второй серии не выйдет за спецификацию. У игрока пост качества —
  // извещение ставит мир на паузу и ведёт к доске; на планёрке и других автопаузах — дальше; три шага; решение по лучшей
  // версии; разбор; Esc закрывает
  {
    const open = () => page.evaluate(() => (window.__game.store.get().top?.inv ?? 0) > 0);
    for (let i = 0; i < 24 && !(await open()); i++) {
      await page.keyboard.press('Digit6');
      await page.waitForFunction(() => !window.__game.ff, null, { timeout: 120_000 });
      if (await page.evaluate(() => window.__game.store.get().morning.open)) await page.keyboard.press('Escape');
    }
    const stop = await page.evaluate(() => ({ inv: window.__game.store.get().top?.inv ?? 0, speed: window.__game.speed, ff: window.__game.ff, notice: document.querySelector('[data-test=notice-inv]')?.textContent ?? '' }));
    if (stop.inv < 1 || stop.speed !== 0 || stop.ff || !/вне спецификации/.test(stop.notice)) fail(`расследование: идёт ${stop.inv}, скорость ${stop.speed}, промотка ${stop.ff}, извещение «${stop.notice}»`);
    else ok(`расследование: «${stop.notice}» — мир на паузе`);
    // что делать (Б1г): последняя планёрка — у потери «людей нет в смене» кнопки решений, с Б4в и «Найм и графики»; ждут
    // решения отклонения серии с происшествием. Карточка отклонения опудривания: время по досье, цель и диапазон по
    // карте, связанные испытания; после результата растворения его решает расследование — «без влияния» и «отклонить»
    // погашены, есть кнопка доски. В первый раз — пояснение; «Понятно» его убирает, окно помнит
    {
      await page.evaluate(() => window.__game.actions.openMorning());
      await page.waitForFunction(() => !!window.__game.store.get().morning.view, null, { timeout: 20_000 });
      await frames(2);
      const m = await page.evaluate(() => {
        const main = document.querySelector('[data-test=morning-main]');
        const v = window.__game.store.get().morning.view;
        return {
          main: v.main ? `${v.main.k}/${v.main.cause ?? ''}` : '',
          buttons: [...(main?.querySelectorAll('[data-test=levers] .lever button') ?? [])].map(b => b.textContent ?? ''),
          later: [...(main?.querySelectorAll('[data-test=lever-later]') ?? [])].map(x => x.textContent ?? ''),
          pending: document.querySelectorAll('[data-test=morning-pending]').length,
          param: v.pending.find(p => p.kind === 'param')?.dev,
        };
      });
      if (m.main !== 'wait/shift' || m.buttons.length < 3 || !m.buttons.includes('Найм и графики') || m.later.some(x => /Б4/.test(x)) || m.param === undefined)
        fail(`планёрка: потеря «${m.main}», кнопки «${m.buttons.join(', ')}», «${m.later.join('; ')}», ждут решения ${m.pending}`);
      else ok(`планёрка: у потери «людей нет в смене» — ${m.buttons.join(', ')}; ждут решения — ${m.pending}`);
      await page.keyboard.press('Escape');
      await page.evaluate(n => window.__game.actions.select({ kind: 'dev', n }), m.param);
      await page.waitForFunction(n => window.__game.store.get().card?.card?.kind === 'dev' && window.__game.store.get().card.card.dev === n, m.param, { timeout: 20_000 });
      await frames(2);
      const card = () =>
        page.evaluate(() => ({
          title: document.querySelector('#card-title')?.textContent ?? '',
          what: document.querySelector('[data-test=dev-what]')?.textContent ?? '',
          linked: [...document.querySelectorAll('[data-test=dev-linked] li')].map(x => x.textContent ?? ''),
          means: document.querySelector('[data-test=dev-means]')?.textContent ?? '',
          none: document.querySelector('[data-test=dev-none]')?.disabled,
          reject: document.querySelector('[data-test=dev-reject]')?.disabled,
          board: !!document.querySelector('[data-test=dev-inv]'),
          first: !!document.querySelector('[data-test=card-first]'),
        }));
      const c = await card();
      await page.screenshot({ path: join(out, 'e2e-dev.png') });
      if (!/Режим вне диапазона/.test(c.title) || !/Время опудривания: .+ — цель .+, диапазон .+/.test(c.what) || c.linked.length < 2 || !c.linked.some(x => /Растворение/.test(x))) fail(`карточка отклонения: «${c.title}», «${c.what}», испытания ${c.linked.join(' | ')}`);
      else if (!/расследование/.test(c.means) || c.none !== true || c.reject !== true || !c.board) fail(`карточка отклонения: «${c.means}», без влияния ${c.none}, отклонить ${c.reject}, доска ${c.board}`);
      else ok(`карточка отклонения «${c.title}»: «${c.what}»; испытания: ${c.linked.join('; ')}; решает расследование — кнопки погашены, есть доска; снимок ${join(out, 'e2e-dev.png')}`);
      if (!c.first) fail('карточка отклонения: пояснения при первом событии нет');
      else {
        await page.click('[data-test=first-ok]');
        await frames(2);
        const kept = await page.evaluate(() => ({ shown: !!document.querySelector('[data-test=card-first]'), store: localStorage.getItem('pharma.firsts') ?? '' }));
        if (kept.shown || !/dev:param/.test(kept.store)) fail(`пояснение: после «Понятно» — на виду ${kept.shown}, в окне «${kept.store}»`);
        else ok(`пояснение при первом событии: «Понятно» убрало его, окно помнит — ${kept.store}`);
      }
      await page.keyboard.press('Escape');
    }
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
    // ✕ мышью, как игрок (в 0.0.36 тут пропадало всё окно): шапка доски с ✕ видна, и когда доска прокручена к разбору
    const x = await page.evaluate(() => {
      const b = document.querySelector('#inv .close')?.getBoundingClientRect();
      if (!b) return undefined;
      const at = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, hit: !!at?.closest('#inv .close'), scrolled: Math.round(document.querySelector('#inv').scrollTop) };
    });
    const alive = () => page.evaluate(() => ({ inv: !!document.querySelector('#inv'), top: !!document.querySelector('.top [data-test=clock]'), guard: document.querySelector('[data-test=guard]')?.textContent ?? '' }));
    if (!x?.hit) fail(`расследование: ✕ доски не на виду — ${JSON.stringify(x)}`);
    else {
      await page.mouse.click(x.x, x.y);
      await frames(2);
      const after = await alive();
      if (after.inv || !after.top || after.guard) fail(`расследование: после ✕ доска ${after.inv ? 'открыта' : 'закрыта'}, полоса ${after.top ? 'на месте' : 'пропала'}${after.guard ? `, ограда: «${after.guard}»` : ''}`);
      else ok(`расследование: ✕ мышью закрыл доску после разбора (доска прокручена на ${x.scrolled} точек) — полоса на месте`);
    }
    // снова: I открывает доску с разбором, Esc закрывает
    await page.keyboard.press('KeyI');
    await page.waitForSelector('[data-test=inv-debrief]', { timeout: 20_000 });
    await frames(2);
    await page.keyboard.press('Escape');
    await frames(2);
    const again = await alive();
    if (again.inv || !again.top || again.guard) fail(`расследование: Esc — доска ${again.inv ? 'открыта' : 'закрыта'}, полоса ${again.top ? 'на месте' : 'пропала'}${again.guard ? `, ограда: «${again.guard}»` : ''}`);
  }

  // чистота линии (Б1е): после первого задания помещение упаковки было «грязно», потом «чисто» — по табличке в срезе;
  // в карточке — «чисто» для продукта задания и до какого часа годно. Занято следующим заданием — ×4 до «чисто»
  {
    const clean = (await untilPackRoom('clean')) ? await packRoomCard('clean') : '';
    const seen = await page.evaluate(() => window.__packRoom.join(' → '));
    if (!/busy → dirty → clean/.test(seen) || !/Чисто для · (Парацетамол|Лоратадин)/.test(clean) || !/Годно до · /.test(clean)) fail(`помещение упаковки после задания: ${seen}; «${clean || 'не дождались'}»`);
    else ok(`помещение упаковки после задания: ${seen}; «${clean}»`);
  }

  // досье после упаковки (Б1д): щелчок по полосе первой серии в расписании — досье поверх него; в «Упаковке» — кто
  // работал у линии, материалы по машинам и сверка печатных; очистка линии — перед первым заданием тоже, двумя
  // упаковщиками с проверкой мастера (Б1е); на строке линии — полосы мойки и уборки её помещения (Б1е); Esc закрывает
  // досье, потом расписание
  {
    await page.keyboard.press('KeyG');
    await page.waitForFunction(() => !!window.__game.store.get().gantt.view, null, { timeout: 20_000 });
    await frames(2);
    const lineBars = await page.evaluate(() => {
      const id = window.__game.layout.plan.plant.lines[0].id;
      return [...document.querySelectorAll(`[data-test=gantt-row][data-row="${id}"] [data-test=gbar]`)].map(e => `${e.getAttribute('data-kind')}:${e.getAttribute('data-when')}`);
    });
    if (!lineBars.includes('clean:past') || !lineBars.includes('roomClean:past')) fail(`расписание, строка линии: ${lineBars.join(', ')}`);
    else ok(`расписание, строка линии: ${lineBars.join(', ')}`);
    const at = await page.evaluate(id => {
      const bars = [...document.querySelectorAll(`[data-test=gbar][data-batch="${id}"]`)].map(e => e.getBoundingClientRect()).filter(b => b.width > 4);
      const b = bars.sort((x, y) => y.width - x.width)[0];
      return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, n: bars.length } : undefined;
    }, `B${first}`);
    if (!at) fail(`расписание: полос первой серии B${first} в окне нет`);
    else {
      await page.mouse.click(at.x, at.y);
      const shown = await page
        .waitForFunction(n => window.__game.store.get().dossier.view?.batch === n && window.__game.store.get().dossier.view.pack?.state === 'done', first, { timeout: 20_000 })
        .then(() => true, () => false);
      await frames(2);
      const d = await page.evaluate(packOfDossier);
      if (!shown || !d.gantt || d.crew.length < 1 || !d.clear || !d.checker || d.none || d.mats.length !== 5 || d.recon.length !== 2)
        fail(`досье после упаковки: открыто ${shown}, расписание ${d.gantt ? 'под ним' : 'закрыто'}, у линии «${d.crew.join(', ')}», очистка «${d.clear || d.none}», проверка мастера ${d.checker ? 'есть' : 'нет'}, материалов ${d.mats.length}, сверка «${d.recon.join(' | ')}»`);
      else ok(`${d.title} — щелчком по полосе в расписании: у линии ${d.crew.join(', ')}; очистка — «${d.clear}»; материалов ${d.mats.length}; сверка — ${d.recon.join('; ')}`);
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    if (await page.evaluate(() => !!document.querySelector('#dossier') || !!document.querySelector('#gantt'))) fail('досье: Esc не закрыл досье и расписание');
  }

  // решение по серии (Б1г): паллета ГП в карантине ГП; решение в её карточке — когда серия упакована (раньше команда
  // выпуска — отказ), и до решения уполномоченного лица: мир на ×4 до карточки с решением — и сразу пауза. В карточке —
  // условия выпуска и три кнопки. «Держать» — уполномоченное лицо держит серию после проверки ООК; в первый раз —
  // пояснение. «Выпустить» из той же карточки — серия выпущена, решения в карточке больше нет. Мир встаёт на планёрке —
  // её закрыть
  {
    // чего ждёт шаг — по имени: функция уходит в страницу целиком, без замыканий, а строку страница игры не исполнит
    // (CSP без unsafe-eval). Проба срабатывает, когда условие выполнено или мир встал сам
    const probe = k => {
      const g = window.__game;
      const c = g.store.get().card?.card;
      const r =
        k === 'fg'
          ? [...g.view.units.values()].find(u => u.where === 'slot' && g.layout.plan.slots[u.ref].kind === 'fgQuarantine')?.unit
          : k === 'release'
            ? !!c?.release
            : k === 'held'
              ? c?.release?.held === true
              : c?.kind === 'unit' && !c.release && c.lot?.status === 'released';
      return r || g.speed === 0 ? { r } : false;
    };
    const got = async k => (await page.evaluate(probe, k))?.r;
    // ×4, пока не выполнено условие `k` (проба в каждом кадре) или пока не прошло `days` суток завода; мир встаёт сам на
    // автопаузах места игрока — дальше. `went` — сколько раз пускали мир и сколько часов он прожил
    const went = { runs: 0, hours: 0 };
    const go4 = async (k, days) => {
      const from = await gameT();
      went.runs = 0;
      while (!(await got(k)) && (await gameT()) < from + days * 86400 && went.runs < 500) {
        await page.evaluate(() => window.__game.store.get().morning.open && window.__game.actions.closeMorning(false));
        await page.evaluate(() => window.__game.actions.setSpeed(4));
        await page.waitForFunction(probe, k, { timeout: 30_000 }).catch(() => {});
        await page.evaluate(() => window.__game.actions.setSpeed(0));
        went.runs++;
      }
      went.hours = Math.round(((await gameT()) - from) / 3600);
      return got(k);
    };
    const unit = await go4('fg', 6);
    if (unit === undefined) fail(`решение по серии: ГП в карантине ГП не появилась — мир пускали ${went.runs} раз, прошло ${went.hours} ч`);
    else {
      await page.evaluate(n => window.__game.actions.select({ kind: 'unit', n }), unit);
      await page.waitForFunction(n => window.__game.store.get().card?.card?.kind === 'unit' && window.__game.store.get().card.card.unit === n, unit, { timeout: 20_000 });
      const has = await go4('release', 3);
      await frames(2);
      if (!has) fail(`решение по серии: в карточке паллеты ${unit} решения нет — мир пускали ${went.runs} раз, прошло ${went.hours} ч`);
      else {
        await page.click('[data-test=release-hold]');
        const held = await go4('held', 2);
        await frames(2);
        await page.screenshot({ path: join(out, 'e2e-release.png') });
        const h = await page.evaluate(() => ({
          checks: [...document.querySelectorAll('[data-test=card-release] .checks li')].map(x => x.textContent ?? ''),
          first: document.querySelector('[data-test=card-first]')?.textContent ?? '',
          release: document.querySelector('[data-test=release-release]')?.disabled,
        }));
        if (!held || h.checks.length !== 4 || h.release !== false || !/держит серию/.test(h.first)) fail(`решение по серии: держат ${held} (${went.hours} ч), условия ${h.checks.join(' | ')}, «Выпустить» погашено ${h.release}, пояснение «${h.first}»`);
        else ok(`решение по серии: «Держать» — серию держат; условия: ${h.checks.join('; ')}; снимок ${join(out, 'e2e-release.png')}`);
        if (h.first) await page.click('[data-test=first-ok]');
        await page.click('[data-test=release-release]');
        const done = await go4('released', 2);
        if (!done) fail(`решение по серии: «Выпустить» — серия не выпущена за ${went.hours} ч`);
        else ok('решение по серии: «Выпустить» из карточки ГП — серия выпущена');
        // досье этой серии (Б1д) — кнопкой «Досье» из карточки ГП: у линии — люди, перед заданием — очистка линии,
        // кто очищал и кто проверил; сверка печатных; в решениях — выпуск уполномоченным лицом
        await page.click('[data-test=card-dossier]');
        const open = await page.waitForFunction(() => window.__game.store.get().dossier.view?.pack?.state === 'done', null, { timeout: 20_000 }).then(() => true, () => false);
        await frames(2);
        const d = await page.evaluate(packOfDossier);
        await page.screenshot({ path: join(out, 'e2e-dossier.png') });
        if (!open || d.crew.length < 1 || !d.checker || d.mats.length !== 5 || d.recon.length !== 2 || !/выпущена уполномоченным лицом/.test(d.decisions))
          fail(`досье выпущенной серии: открыто ${open}, у линии «${d.crew.join(', ')}», очистка «${d.clear}», материалов ${d.mats.length}, сверка «${d.recon.join(' | ')}», решения «${d.decisions}»`);
        else ok(`${d.title} из карточки ГП: у линии ${d.crew.length}; «${d.clear}»; сверка — ${d.recon.join('; ')}; «${d.decisions}»; снимок ${join(out, 'e2e-dossier.png')}`);
        await page.keyboard.press('Escape');
      }
      await page.keyboard.press('Escape');
    }
  }

  // отклонённое (Б1з): на посту качества серию ГП отклонили на решении по серии — её паллеты едут в зону отклонённого;
  // на планёрке — «Отклонённое»: сколько мест занято, «Заказать вывоз» погашено — пост «Снабжение и склад» ведёт коллега;
  // директором — «Заказать вывоз» у строки планёрки: подрядчик приедет на следующий рабочий день к началу своих часов; в
  // этот день — фура подрядчика у рампы отгрузки, погрузка и подпись начальника ОКК в «Сейчас»; фура уехала — в карточке
  // помещения отклонённого запись журнала отходов и свободные места, в кассе — «Вывоз отходов». Пока паллеты едут в зону,
  // место директора — тоже у игрока: иначе коллега склада в 09:00 закажет вывоз раньше игрока, если серию отклонят утром;
  // на планёрку игрок приходит без него
  {
    const ALL = ['director', 'production', 'quality', 'supply', 'commerce'];
    // места игрока — набор целиком, экраном «Кем вы будете», как игрок: кнопка «Место», плитки, «Взять»
    const seatsTo = async want => {
      await page.click('[data-test=seats-open]');
      await page.waitForSelector('#seats', { timeout: 20_000 });
      const pick = await page.evaluate(() => window.__game.store.get().seats.pick);
      for (const id of ALL) if (pick.includes(id) !== want.includes(id)) await page.click(`[data-test=seat-tile][data-seat=${id}]`);
      await page.click('[data-test=seats-take]');
      // места в полосе — в порядке журнала мест: взятое последним — в конце
      await page.waitForFunction(w => [...(window.__game.store.get().top?.seats ?? [])].sort().join() === w, [...want].sort().join(), { timeout: 20_000 });
      await page.evaluate(() => window.__game.actions.setSpeed(0));
    };
    // чего ждёт шаг — по имени, как у решения по серии: функция уходит в страницу целиком. `mine` — паллеты ГП, ещё не
    // решённые, когда серию отклонили: её паллеты — те из них, что стали отклонёнными; `at` — мгновение завода
    const probe = ({ k, mine, at }) => {
      const g = window.__game;
      const c = g.store.get().card?.card;
      const slots = g.layout.plan.slots;
      const all = [...g.view.units.values()];
      const truck = g.view.trucks.find(t => t.waste);
      const ours = all.filter(u => u.tag === 'rejected' && mine.includes(u.unit));
      const r =
        k === 'fg'
          ? all.find(u => u.where === 'slot' && slots[u.ref].kind === 'fgQuarantine' && u.tag === 'quarantine')?.unit
          : k === 'release'
            ? !!c?.release
            : k === 'zone'
              ? ours.length > 0 && ours.every(u => u.where === 'slot' && slots[u.ref].kind === 'rejected')
              : k === 'dock'
                ? truck?.docked === true
                : k === 'load'
                  ? g.view.tasks.some(t => t.kind === 'wasteLoad')
                  : k === 'sign'
                    ? g.view.tasks.some(t => t.kind === 'wasteSign')
                    : k === 'gone'
                      ? !truck
                      : k === 'time'
                        ? g.t + g.lag >= at
                        : k === 'clear'
                          ? c?.kind === 'room' && !!c.waste && !c.waste.order
                          : false;
      return r || g.speed === 0 ? { r } : false;
    };
    const got = async (k, mine, at) => (await page.evaluate(probe, { k, mine, at }))?.r;
    // со скоростью `speed`, пока не выполнено условие `k` (проба в каждом кадре) или не прошло `days` суток завода; мир
    // встаёт сам на автопаузах места игрока и на планёрке — дальше. Кадр окна двигает часы не больше чем на 0,1 с ×
    // скорость: на ×4 — до 12 мин завода, на ×3 — до 2 мин; погрузку и подпись — минуты завода — ждут на ×3
    const go = async (k, days, { mine = [], at = 0, speed = 4 } = {}) => {
      const from = await gameT();
      for (let runs = 0; !(await got(k, mine, at)) && (await gameT()) < from + days * 86400 && runs < 500; runs++) {
        await page.evaluate(() => window.__game.store.get().morning.open && window.__game.actions.closeMorning(false));
        await page.evaluate(v => window.__game.actions.setSpeed(v), speed);
        await page.waitForFunction(probe, { k, mine, at }, { timeout: 30_000 }).catch(() => {});
        await page.evaluate(() => window.__game.actions.setSpeed(0));
      }
      return got(k, mine, at);
    };
    // паллеты ГП, ещё не решённые: в карантине ГП и на местах паллетирования
    const undecided = () =>
      page.evaluate(() => {
        const g = window.__game;
        return [...g.view.units.values()].filter(u => u.where === 'slot' && ['fgQuarantine', 'palletizing'].includes(g.layout.plan.slots[u.ref].kind) && u.tag !== 'rejected').map(u => u.unit);
      });
    const ofMine = mine => page.evaluate(m => [...window.__game.view.units.values()].filter(u => u.tag === 'rejected' && m.includes(u.unit)).map(u => u.unit), mine);
    // помещение отклонённого в карточке: места зоны, заказанный вывоз, журнал отходов; Esc закрывает
    const room = async () => {
      const i = await page.evaluate(() => window.__game.layout.plan.plant.rooms.findIndex(r => r.type === 'rejected'));
      await page.evaluate(i => window.__game.actions.select({ kind: 'room', i }), i);
      await page.waitForFunction(() => !!window.__game.store.get().card?.card?.waste, null, { timeout: 20_000 });
      await frames(2);
      const r = await page.evaluate(() => ({
        places: [...document.querySelectorAll('[data-test=card-waste-place]')].map(x => x.getAttribute('data-busy')),
        order: document.querySelector('[data-test=card-waste-order]')?.textContent ?? '',
        log: [...document.querySelectorAll('[data-test=card-waste-entry]')].map(x => x.innerText.replace(/\s*\n\s*/g, ' · ')),
      }));
      return r;
    };
    // строка фуры подрядчика в «Сейчас»: текст и кто у неё работает — роли и сколько; N открывает, Esc закрывает
    const nowTruck = async () => {
      const was = await page.evaluate(() => window.__game.store.get().now.open);
      if (!was) await page.keyboard.press('KeyN');
      await page.waitForFunction(() => !!window.__game.store.get().now.view, null, { timeout: 20_000 });
      await frames(2);
      const row = await page.evaluate(() => {
        const r = [...document.querySelectorAll('[data-test=now-row][data-kind=truck]')].find(x => /вывоз отклонённого/.test(x.textContent ?? ''));
        return r ? { text: r.innerText.replace(/\s+/g, ' ').trim(), crew: r.querySelector('.nmain .muted')?.textContent ?? '' } : undefined;
      });
      if (!was) await page.keyboard.press('Escape');
      return row;
    };
    // вывоз, заказанный коллегой раньше, ещё не кончился — дождаться его конца с открытой карточкой помещения
    await seatsTo(['director', 'production', 'quality']);
    let r0 = await room();
    if (!/не заказан/.test(r0.order)) {
      await go('clear', 4);
      r0 = await room();
    }
    await page.keyboard.press('Escape');
    const unit = await go('fg', 10);
    let has = false;
    if (unit !== undefined) {
      await page.evaluate(n => window.__game.actions.select({ kind: 'unit', n }), unit);
      await page.waitForFunction(n => window.__game.store.get().card?.card?.kind === 'unit' && window.__game.store.get().card.card.unit === n, unit, { timeout: 20_000 });
      has = await go('release', 3);
      await frames(2);
    }
    if (!has) fail(`отклонённое: ГП с решением по серии не дождались — паллета ${unit ?? 'не появилась'}`);
    else {
      const mine = await undecided();
      await page.click('[data-test=release-reject]');
      await page.keyboard.press('Escape');
      const moved = await go('zone', 3, { mine });
      const fresh = await ofMine(mine);
      // на планёрку — без места директора: «Заказать вывоз» погашено, его пост ведёт коллега
      await seatsTo(['production', 'quality']);
      await page.evaluate(() => window.__game.actions.openMorning());
      await page.waitForFunction(() => !!window.__game.store.get().morning.view, null, { timeout: 20_000 });
      await frames(2);
      const m = await page.evaluate(() => ({
        zone: document.querySelector('[data-test=morning-rejects-zone]')?.textContent ?? '',
        order: document.querySelector('[data-test=morning-rejects-order]')?.textContent ?? '',
        off: document.querySelector('[data-test=morning-rejects] [data-test=lever-waste] button')?.disabled,
        hint: document.querySelector('[data-test=morning-rejects] [data-test=lever-waste] .warn')?.textContent ?? '',
        used: window.__game.store.get().morning.view.rejects?.used,
      }));
      await page.evaluate(() => document.querySelector('[data-test=morning-rejects]')?.scrollIntoView({ block: 'center' }));
      await frames(2);
      await page.screenshot({ path: join(out, 'e2e-rejects.png') });
      await page.keyboard.press('Escape');
      if (!moved || fresh.length === 0 || m.off !== true || !/Снабжение и склад/.test(m.hint) || !/занято/.test(m.zone) || !/не заказан/.test(m.order))
        fail(`отклонённое: паллеты серии в зоне ${moved} (${fresh.length}); на планёрке «${m.zone}», «${m.order}», «Заказать вывоз» погашено ${m.off}, «${m.hint}»`);
      else ok(`отклонённое: ${fresh.length} ${fresh.length === 1 ? 'паллета' : 'паллеты'} ГП — в зоне; на планёрке «${m.zone}», «${m.order}»; «Заказать вывоз» погашено — «${m.hint.replace(/^\s*·\s*/, '')}»; снимок ${join(out, 'e2e-rejects.png')}`);
      // директором — «Заказать вывоз» у строки планёрки
      await seatsTo(['director', 'production', 'quality']);
      await page.evaluate(() => window.__game.actions.openMorning());
      await page.waitForFunction(() => !!window.__game.store.get().morning.view, null, { timeout: 20_000 });
      await frames(2);
      await page.click('[data-test=morning-rejects] [data-test=lever-waste] button');
      await page.waitForFunction(() => !window.__game.store.get().morning.open, null, { timeout: 20_000 }).catch(() => {});
      const r1 = await room();
      const at = await page.evaluate(() => window.__game.store.get().card?.card?.waste?.order?.at ?? 0);
      await page.keyboard.press('Escape');
      if (!/заказали вы: подрядчик приедет/.test(r1.order)) fail(`«Заказать вывоз»: в карточке помещения отклонённого «${r1.order}»`);
      else ok(`«Заказать вывоз» директором: «${r1.order}»`);
      // день вывоза: на ×4 — до получаса перед часами подрядчика, дальше на ×3: фура у рампы, погрузка, подпись
      // начальника ОКК; фура уехала
      await go('time', 4, { at: at - 1800 });
      const docked = await go('dock', 2, { speed: 3 });
      const loading = docked && (await go('load', 1, { speed: 3 })) ? await nowTruck() : undefined;
      const signing = loading && (await go('sign', 1, { speed: 3 })) ? await nowTruck() : undefined;
      const left = signing ? await go('gone', 1, { speed: 3 }) : false;
      if (!loading || !signing || !left || !/Кладовщик|Водитель/.test(loading.crew) || !/Начальник ОКК/.test(signing.crew))
        fail(`фура подрядчика: у рампы ${docked}; погрузка «${loading?.text ?? ''}» (${loading?.crew ?? ''}); подпись «${signing?.text ?? ''}» (${signing?.crew ?? ''}); уехала ${left}`);
      else ok(`фура подрядчика: «${loading.text}» — грузят ${loading.crew}; подпись — ${signing.crew}; фура уехала`);
      // журнал отходов и свободные места; в кассе — «Вывоз отходов»
      const r2 = await room();
      await page.screenshot({ path: join(out, 'e2e-waste.png') });
      await page.keyboard.press('Escape');
      const cashWas = await page.evaluate(() => window.__game.store.get().cash.open);
      if (!cashWas) await page.click('[data-test=cash-open]');
      await page.waitForFunction(() => !!window.__game.store.get().cash.view, null, { timeout: 20_000 });
      await frames(2);
      const cash = await page.evaluate(() => ({
        entry: window.__game.store.get().cash.view.entries.find(e => e.item === 'waste'),
        text: /Вывоз отходов/.test(document.querySelector('#cash')?.textContent ?? ''),
      }));
      if (!cashWas) await page.keyboard.press('Escape');
      const free = r2.places.filter(x => x === 'no').length;
      const entry = r2.log[0] ?? '';
      // паллеты серии уехали: их больше нет в учёте склада
      const stay = await page.evaluate(m => m.filter(n => window.__game.view.units.has(n)), fresh);
      if (r2.log.length !== r0.log.length + 1 || !/передачу подписал /.test(entry) || !/акт об обезвреживании — до/.test(entry) || stay.length > 0 || free === 0 || !cash.entry || cash.entry.sum >= 0 || !cash.text)
        fail(`журнал отходов: записей ${r0.log.length} → ${r2.log.length}, «${entry}»; паллет серии осталось ${stay.length}; свободно ${free} из ${r2.places.length}; в кассе ${JSON.stringify(cash.entry)}, «Вывоз отходов» ${cash.text}`);
      else ok(`журнал отходов: «${entry}»; паллет серии на складе нет; свободно ${free} из ${r2.places.length} мест; в кассе «Вывоз отходов» ${Math.round(-cash.entry.sum / 100)} ₽; снимок ${join(out, 'e2e-waste.png')}`);
    }
    await seatsTo(['production', 'quality']);
  }

  // срочное задание (Б1г, 0.0.39): «Срочное задание» — первым в строке черновика, позиции — списком под ним; выбрали —
  // список закрылся, в черновике «срочное задание — …», а в расписании — полосы нового задания с отметкой черновика, до
  // «Утвердить». «Утвердить» — задание на тех же полосах, черновик пуст. Мир на паузе: мгновение то же
  {
    await page.keyboard.press('KeyG');
    await page.waitForFunction(() => !!window.__game.store.get().gantt.view, null, { timeout: 20_000 });
    await frames(2);
    const top = await page.evaluate(() => {
      const v = window.__game.store.get().gantt.view;
      return { n: Math.max(0, ...Object.keys(v.batches).map(id => Number(id.slice(1)))), first: !!document.querySelector('[data-test=gantt-draft]')?.firstElementChild?.querySelector('[data-test=urgent-open]') };
    });
    await page.click('[data-test=urgent-open]');
    const opened = await page.isVisible('[data-test=urgent-list]');
    await page.click('[data-test=urgent-sku]');
    await page.waitForFunction(n => window.__game.store.get().gantt.view?.moved.some(id => Number(id.slice(1)) > n), top.n, { timeout: 20_000 }).catch(() => {});
    await frames(2);
    const pre = await page.evaluate(n => {
      const v = window.__game.store.get().gantt.view;
      const id = v.moved.filter(x => Number(x.slice(1)) > n).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)))[0] ?? '';
      return {
        id,
        bars: v.bars.filter(b => b.batch === id).map(b => `${b.row} ${b.kind} ${b.from} ${b.to}`),
        dom: id ? document.querySelectorAll(`[data-test=gbar][data-batch="${id}"][data-draft="1"]`).length : 0,
        list: document.querySelector('[data-test=draft-list]')?.textContent ?? '',
        closed: !document.querySelector('[data-test=urgent-list]'),
      };
    }, top.n);
    await page.screenshot({ path: join(out, 'e2e-urgent.png') });
    await page.click('[data-test=draft-approve]');
    await page.waitForFunction(id => !!window.__game.store.get().gantt.view?.batches[id] && !window.__game.store.get().gantt.view.moved.includes(id), pre.id, { timeout: 20_000 }).catch(() => {});
    const post = await page.evaluate(id => {
      const v = window.__game.store.get().gantt.view;
      return { bars: v.bars.filter(b => b.batch === id).map(b => `${b.row} ${b.kind} ${b.from} ${b.to}`), urgent: window.__game.store.get().gantt.urgent.length };
    }, pre.id);
    if (!top.first || !opened || !pre.closed || !/срочное задание — /.test(pre.list) || !pre.id || pre.bars.length === 0 || pre.dom !== pre.bars.length)
      fail(`срочное задание: кнопка первой ${top.first}, список ${opened} → закрыт ${pre.closed}, черновик «${pre.list}», полосы ${pre.id} — ${pre.bars.length} (в черновике ${pre.dom})`);
    else if (post.urgent !== 0 || post.bars.join('|') !== pre.bars.join('|')) fail(`срочное задание: после «Утвердить» полосы ${post.bars.length} — ${post.bars.join('|') === pre.bars.join('|') ? 'те же' : 'другие'}, в черновике ${post.urgent}`);
    else ok(`срочное задание: «${pre.list}» — до «Утвердить» в расписании ${pre.bars.length} полос задания ${pre.id.slice(1)} с отметкой черновика; «Утвердить» — те же полосы, черновик пуст; снимок ${join(out, 'e2e-urgent.png')}`);
    await page.keyboard.press('Escape');
  }

  // справочник завода (Б1а, Б1в): F1 — «Что и как делает завод, на чём, кем и с кем»; у каждой карты шесть стадий — по
  // карте и по факту сделанных серий; столбец «По карте» упорядочивается в обе стороны; у позиции — 120 пачек в ящике;
  // поиск сужает таблицы вкладки, а цифры в поле поиска — текст, не скорость; Esc закрывает
  {
    await page.keyboard.press('F1');
    await page.waitForFunction(() => !!window.__game.store.get().ref.view, null, { timeout: 20_000 });
    await frames(2);
    // карт две (Б2б): у каждой шесть стадий по карте; по факту — у той, чьи серии уже сделаны
    const recs = await page.evaluate(() =>
      [...document.querySelectorAll('[data-test=ref-stages]')].map(t => {
        const rows = [...t.querySelectorAll('tbody tr')];
        const cell = (r, i) => (r.children[i]?.innerText ?? '').replace(/\s+/g, ' ').trim();
        return { rows: rows.length, plan: rows.filter(r => /\d/.test(cell(r, 6))).length, fact: rows.filter(r => /последняя/.test(cell(r, 7))).length, first: rows[0] ? `${cell(rows[0], 1)}: ${cell(rows[0], 6)}; ${cell(rows[0], 7)}` : '' };
      }),
    );
    const done = recs.find(r => r.fact === 6);
    if (recs.length !== 2 || recs.some(r => r.rows !== 6 || r.plan !== 6) || !done) fail(`справочник: карты — ${recs.map(r => `стадий ${r.rows}, по карте ${r.plan}, по факту ${r.fact}`).join('; ')}`);
    else ok(`справочник: две карты по шесть стадий, по факту — «${done.first}»`);
    await page.screenshot({ path: join(out, 'e2e-ref.png') });
    // порядок: «По карте» — короткие стадии вверху, ещё раз — длинные; первая строка — та, что по числу крайняя
    const firstStage = () => page.evaluate(() => document.querySelector('[data-test=ref-stages] tbody tr td:nth-child(2)')?.innerText.split('\n')[0] ?? '');
    const planSort = '[data-test=ref-stages] thead th:nth-child(7) [data-test=ref-sort]';
    const plans = await page.evaluate(() => {
      const v = window.__game.store.get().ref.view.recipes[0].stages;
      const by = [...v].sort((a, b) => a.nominal - b.nominal);
      return { shortest: by[0].id, longest: by[by.length - 1].id };
    });
    await page.click(planSort);
    await frames(1);
    const up = await firstStage();
    await page.click(planSort);
    await frames(1);
    const down = await firstStage();
    // названия стадий — как в окне: русские строки игры
    const ru = { dispense: 'Отвешивание', granulate: 'Грануляция', dry: 'Сушка', mill: 'Калибровка', blend: 'Опудривание', compress: 'Таблетирование' };
    const want = [ru[plans.shortest], ru[plans.longest]];
    if (up !== want[0] || down !== want[1]) fail(`справочник: по карте вверх — «${up}» (ждём «${want[0]}»), вниз — «${down}» (ждём «${want[1]}»)`);
    else ok(`справочник: по карте — короткая «${up}» вверху, ещё раз — длинная «${down}»`);
    await page.click('[data-test=ref-tab][data-tab=products]');
    await frames(2);
    const skus = await page.evaluate(() => [...document.querySelectorAll('[data-test=ref-skus] tbody tr')].map(r => r.children[4]?.textContent ?? ''));
    if (!skus.includes('120 пачек')) fail(`справочник: пачек в ящике — ${skus.join(', ')}`);
    else ok(`справочник: пачек в ящике — ${skus.join(', ')}; снимок ${join(out, 'e2e-ref.png')}`);
    // поиск: «№20» — одна позиция; цифры в поле — текст, скорость та же
    const speed0 = await page.evaluate(() => window.__game.speed);
    await page.fill('[data-test=ref-search]', '');
    await page.click('[data-test=ref-search]');
    await page.keyboard.type('№20');
    await frames(1);
    // позиции — таблицей на продукт: у лоратадина «№20» нет, там строка «Ничего не нашлось»
    const found = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('[data-test=ref-skus] tbody tr')].map(r => r.innerText.split('\t')[0]).filter(t => t.trim() !== 'Ничего не нашлось'),
      speed: window.__game.speed,
    }));
    if (found.rows.length !== 1 || !/№20/.test(found.rows[0]) || found.speed !== speed0) fail(`справочник: поиск «№20» — строк ${found.rows.length} (${found.rows.join(' | ')}), скорость ${speed0} → ${found.speed}`);
    else ok(`справочник: поиск «№20» — одна позиция «${found.rows[0]}», скорость не тронута`);
    await page.fill('[data-test=ref-search]', 'пресс');
    await page.click('[data-test=ref-tab][data-tab=equipment]');
    await frames(1);
    const press = await page.evaluate(() => [...document.querySelectorAll('[data-test=ref-equipment] tbody tr')].map(r => r.innerText.split('\t')[0]));
    if (press.length !== 1 || !/пресс/i.test(press[0])) fail(`справочник: поиск «пресс» в оборудовании — ${press.join(' | ')}`);
    else ok(`справочник: поиск «пресс» — «${press[0]}»`);
    await page.fill('[data-test=ref-search]', '');
    // документы (Б3а): все регламентирующие документы базы, у карты прототипа — «действует»; поиск по коду находит документ;
    // материалы — с кодом и единицей с кодом ОКЕИ
    await page.click('[data-test=ref-tab][data-tab=docs]');
    await frames(1);
    const docRows = () => page.evaluate(() => [...document.querySelectorAll('[data-test=ref-docs] tbody tr')].map(r => [...r.children].map(c => c.innerText.trim())));
    const docs = await docRows();
    const all = await page.evaluate(() => ['specs', 'tests', 'recipes', 'skus', 'sops', 'agreements'].reduce((n, k) => n + Object.keys(window.__game.db[k]).length, 0));
    const mf = docs.find(r => r[0] === 'MF-0001');
    if (docs.length !== all || mf?.[6] !== 'действует') fail(`документы: строк ${docs.length} из ${all}, MF-0001 — ${mf ? mf.join(' | ') : 'нет'}`);
    else ok(`документы: ${docs.length} строк; ${mf.join(' · ')}`);
    await page.click('[data-test=ref-search]');
    await page.keyboard.type('MF-0002');
    await frames(1);
    const byCode = await docRows();
    if (byCode.length !== 1 || byCode[0][0] !== 'MF-0002') fail(`документы: поиск «MF-0002» — ${byCode.map(r => r.join(' ')).join(' | ')}`);
    else ok(`документы: поиск по коду «MF-0002» — «${byCode[0][1]}»`);
    await page.screenshot({ path: join(out, 'e2e-docs.png') });
    await page.fill('[data-test=ref-search]', '');
    await page.click('[data-test=ref-tab][data-tab=materials]');
    await frames(1);
    const mats = await page.evaluate(() => [...document.querySelectorAll('[data-test=ref-materials] tbody tr')].map(r => [...r.children].map(c => c.innerText.trim())));
    const api = mats.find(r => r[0] === '100001');
    if (mats.length < 20 || api?.[3] !== 'кг · 166') fail(`материалы: строк ${mats.length}, 100001 — ${api ? api.join(' | ') : 'нет'}`);
    else ok(`материалы: ${mats.length} строк; ${api.join(' · ')}`);
    // люди (Б3б): у каждого — табельный номер и допуск, «не допущен» — ни у кого; в матрице — каждый документ, по которому
    // учат, и недопущенных нет
    await page.click('[data-test=ref-tab][data-tab=people]');
    await frames(1);
    const staff = await page.evaluate(() => {
      const v = window.__game.store.get().ref.view;
      return {
        rows: [...document.querySelectorAll('[data-test=ref-people] tbody tr')].map(r => [...r.children].map(c => c.innerText.trim())),
        people: v.people.length,
        bad: document.querySelectorAll('[data-test=ref-people] .bad, [data-test=ref-matrix] .bad').length,
        docs: document.querySelectorAll('[data-test=ref-matrix] tbody tr').length,
        want: v.matrix.docs.length,
      };
    });
    const first = staff.rows[0] ?? [];
    await page.screenshot({ path: join(out, 'e2e-people.png') });
    if (staff.rows.length !== staff.people || first[0] !== '1001' || staff.bad > 0 || staff.docs !== staff.want)
      fail(`люди: строк ${staff.rows.length} из ${staff.people}, первая — ${first.join(' | ')}, не допущено ${staff.bad}, документов в матрице ${staff.docs} из ${staff.want}`);
    else ok(`люди: ${staff.rows.length} человек, первый — ${first.join(' · ')}; документов в матрице — ${staff.docs}, недопущенных нет`);
    // рабочее время (Б4а): у каждого — месяц против нормы и сверхурочные года; политика своего отдела меняется и
    // возвращается, чужого — кнопка погашена; календарь ноября 2027 года — 3-го короткий день, 4-го праздник, 5-го
    // перенесённый выходной, норма 159 ч
    {
      const pc = await page.evaluate(() => {
        const head = [...document.querySelectorAll('[data-test=ref-people] thead th')].map(th => th.innerText.trim());
        const month = head.findIndex(h => /^Месяц/.test(h));
        const year = head.findIndex(h => /за год$/.test(h));
        const rows = [...document.querySelectorAll('[data-test=ref-people] tbody tr')].map(r => [...r.children].map(c => c.innerText.trim()));
        return { month, year, bad: rows.filter(r => !/ из /.test(r[month] ?? '') || !/ из 120\u00a0ч$/.test(r[year] ?? '')).length, first: rows[0] ? [rows[0][month], rows[0][year]] : [] };
      });
      await page.click('[data-test=policy-set][data-dept=mes]');
      await page.waitForFunction(() => window.__game.store.get().ref.view?.policy.mes === 'finish', null, { timeout: 20_000 });
      const finish = await page.evaluate(() => [...document.querySelectorAll('[data-test=ref-policy] [data-test=policy-mode]')].map(x => x.textContent)[3]);
      const wmsOff = await page.evaluate(() => document.querySelector('[data-test=policy-set][data-dept=wms]')?.disabled ?? false);
      await page.click('[data-test=policy-set][data-dept=mes]');
      await page.waitForFunction(() => window.__game.store.get().ref.view?.policy.mes === 'need', null, { timeout: 20_000 });
      for (let i = 0; i < 12; i++) {
        const month = await page.evaluate(() => document.querySelector('[data-test=ref-calendar]')?.getAttribute('data-month'));
        if (month === '2027-11') break;
        await page.click('[data-test=cal-next]');
      }
      const nov = await page.evaluate(() => {
        const el = document.querySelector('[data-test=ref-calendar]');
        const days = [...(el?.querySelectorAll('[data-day]') ?? [])].map(x => x.getAttribute('data-day'));
        return { month: el?.getAttribute('data-month'), head: el?.querySelector('.phead')?.textContent ?? '', days: [days[2], days[3], days[4], days[7]] };
      });
      await page.locator('[data-test=ref-calendar]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(out, 'e2e-calendar.png') });
      if (pc.month < 0 || pc.year < 0 || pc.bad > 0 || finish !== 'только закончить начатое' || !wmsOff || nov.month !== '2027-11' || nov.days.join() !== 'short,holiday,off,work' || !/норма 159\u00a0ч/.test(nov.head))
        fail(`рабочее время в справочнике: столбцы ${pc.month}/${pc.year}, без итогов ${pc.bad}; политика «${finish}», склад погашен ${wmsOff}; календарь ${nov.month}: ${nov.days.join()} — «${nov.head}»`);
      else ok(`рабочее время в справочнике: ${pc.first.join(' · ')}; политика производства — «${finish}» и обратно, склада — не ваше место; ${nov.head.replace(/(Раньше|Дальше)/g, '').trim()}: 3 — короткий, 4 — праздник, 5 — выходной`);
    }
    // места (Б3в): площадка, участки и рабочие места; у каждого актива — свой инвентарный номер, у зон хранения — режим
    await page.click('[data-test=ref-tab][data-tab=places]');
    await frames(1);
    const places = await page.evaluate(() => {
      const v = window.__game.store.get().ref.view.places;
      return {
        site: document.querySelector('[data-test=places-site]')?.textContent ?? '',
        areas: document.querySelectorAll('[data-test=places-area]').length,
        inv: [...document.querySelectorAll('[data-test=places-inv]')].map(x => x.textContent ?? ''),
        assets: v.areas.reduce((n, a) => n + a.vehicles.length + a.centers.reduce((m, c) => m + c.assets.length, 0), 0),
        regimes: [...document.querySelectorAll('[data-test=places-regime]')].map(x => x.textContent ?? ''),
        stores: v.areas.reduce((n, a) => n + a.centers.filter(c => c.kind === 'storage').length, 0),
        want: v.areas.length,
      };
    });
    await page.screenshot({ path: join(out, 'e2e-places.png') });
    const invs = places.inv.length === places.assets && new Set(places.inv).size === places.inv.length && places.inv.every(x => /^инв\. №\u00a0\d{8}$/.test(x));
    if (!invs || places.areas !== places.want || places.regimes.length !== places.stores || !places.regimes.every(r => /\u00a0°C/.test(r)))
      fail(`места: участков ${places.areas} из ${places.want}, инвентарных номеров ${places.inv.length} из ${places.assets} (${places.inv.slice(0, 2).join(', ')}), режимов ${places.regimes.length} из ${places.stores}: ${places.regimes.join(' | ')}`);
    else ok(`места: «${places.site}»; ${places.inv.length} активов, у каждого свой номер (${places.inv[0]}…); у ${places.stores} зон хранения режим — «${places.regimes[0]}»`);
    // контрагенты (Б3г): изготовители; у каждого исходного и упаковочного материала — одобренная пара и договор; пары в
    // сроке, у каждой — соглашение по качеству
    await page.click('[data-test=ref-tab][data-tab=partners]');
    await frames(1);
    const partners = await page.evaluate(() => {
      const v = window.__game.store.get().ref.view;
      const mats = v.materials.filter(m => ['api', 'excipient', 'packaging'].includes(m.kind));
      return {
        makers: document.querySelectorAll('[data-test=ref-makers] tbody tr').length,
        pairs: [...document.querySelectorAll('[data-test=ref-pair-state]')].map(x => x.textContent ?? ''),
        contracts: [...document.querySelectorAll('[data-test=ref-contracts] tbody tr')].map(x => x.querySelector('td')?.textContent ?? ''),
        uncovered: mats.filter(m => !m.pairs?.length || !v.partners.contracts.some(c => c.lines.some(l => l.material === m.id))).map(m => m.id),
        agreements: v.partners.pairs.filter(x => !x.agreement).length,
        want: { makers: Object.keys(window.__game.db.makers).length, pairs: v.partners.pairs.length },
      };
    });
    await page.screenshot({ path: join(out, 'e2e-partners.png') });
    if (partners.makers !== partners.want.makers || partners.pairs.length !== partners.want.pairs || !partners.pairs.every(x => /^с \d\d\.\d\d\.\d{4} до /.test(x)) || partners.uncovered.length > 0 || partners.agreements > 0 || partners.contracts[0] !== 'CTR-0001')
      fail(`контрагенты: изготовителей ${partners.makers} из ${partners.want.makers}, пар ${partners.pairs.length} из ${partners.want.pairs} (${partners.pairs.join(' | ')}), без пары или договора — ${partners.uncovered.join(', ')}, без соглашения — ${partners.agreements}, договоры ${partners.contracts.join(', ')}`);
    else ok(`контрагенты: ${partners.makers} изготовителя, ${partners.pairs.length} пары в сроке («${partners.pairs[0]}»), у каждого материала — пара и договор; договоры ${partners.contracts.join(', ')}`);
    for (const tab of ['equipment', 'lab', 'people', 'partners']) {
      await page.click(`[data-test=ref-tab][data-tab=${tab}]`);
      await frames(1);
      const n = await page.evaluate(() => document.querySelectorAll('[data-test=ref-body] table.rtable tbody tr').length);
      if (n < 1) fail(`справочник: во вкладке ${tab} нет строк`);
    }
    await page.keyboard.press('Escape');
    if (await page.evaluate(() => !!document.querySelector('#ref'))) fail('справочник: Esc не закрыл');
    else ok('справочник: во всех вкладках есть строки, Esc закрыл');
  }

  // карточка серии (Б3а): у оборудования и помещения с серией — редакция её карты; нет таких сейчас — у паллеты своей
  // продукции, балка или ГП: её берём со склада, где показаны только они
  {
    let seen = '';
    let tried = 0;
    const look = async list => {
      for (const t of list) {
        tried++;
        await page.evaluate(x => window.__game.actions.select(x), t);
        await page.waitForFunction(x => JSON.stringify(window.__game.store.get().card?.thing) === JSON.stringify(x), t, { timeout: 20_000 });
        await frames(1);
        seen = await page.evaluate(() => document.querySelector('[data-test=card-recipe]')?.textContent?.trim() ?? '');
        if (seen) return;
      }
    };
    await look(
      await page.evaluate(() => {
        const plant = window.__game.db.plants[window.__game.db.scenarios['scn.proto'].plant];
        return [...plant.equipment.map((_, i) => ({ kind: 'equipment', i })), ...plant.rooms.map((_, i) => ({ kind: 'room', i }))];
      }),
    );
    if (!seen) {
      await page.click('[data-test=stock]');
      await page.evaluate(() => window.__game.actions.setStock({ kinds: ['bulk', 'fg'], page: 0 }));
      await page.waitForFunction(
        () => {
          const v = window.__game.store.get().stock.view;
          return !!v && v.rows.length > 0 && v.rows.every(r => ['bulk', 'fg'].includes(window.__game.db.materials[r.material].kind));
        },
        null,
        { timeout: 20_000 },
      );
      await look(await page.evaluate(() => window.__game.store.get().stock.view.rows.slice(0, 10).map(r => ({ kind: 'unit', n: r.unit }))));
      await page.evaluate(() => window.__game.actions.setStock({ kinds: [], page: 0 }));
    }
    if (!/MF-000\d, ред\.\u00a0\d/.test(seen)) fail(`карточка серии: редакции карты нет (${tried} вещей)`);
    else ok(`карточка серии: «${seen}»`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    if (await page.evaluate(() => !!document.querySelector('#stock') || !!document.querySelector('[data-test=card]'))) fail('карточка серии: Esc не закрыл карточку и склад');
  }

  // карточка человека (Б3б): табельный номер в заголовке, допуск и обучение — строка на каждый документ матрицы его роли;
  // новой редакции уборки аппаратчик научился в первую неделю — запись на ред. 2 появилась в партии
  {
    const who = { kind: 'person', n: 9 };
    await page.evaluate(x => window.__game.actions.select(x), who);
    await page.waitForFunction(x => JSON.stringify(window.__game.store.get().card?.thing) === JSON.stringify(x), who, { timeout: 20_000 });
    await frames(1);
    const c = await page.evaluate(() => ({
      title: document.querySelector('#card-title')?.textContent ?? '',
      adm: document.querySelector('[data-test=card-adm]')?.textContent ?? '',
      rows: [...document.querySelectorAll('[data-test=card-train] li')].map(li => li.textContent ?? ''),
      bad: document.querySelectorAll('[data-test=card-train] li.bad').length,
      // табель месяца (Б4а): по дню на каждый день с 1-го по сегодня, итоги — отработано против нормы и сверхурочные года
      days: [...document.querySelectorAll('[data-test=sheet-day]')].map(d => d.textContent ?? ''),
      sheetRows: window.__game.store.get().card?.card?.sheet?.rows.length ?? -1,
      sums: document.querySelector('[data-test=card-sheet]')?.nextElementSibling?.textContent ?? '',
      want: (() => {
        const db = window.__game.db;
        return [...Object.values(db.sops), ...Object.values(db.tests)].filter((x, i, all) => x.roles.includes('role.operator') && all.findIndex(y => y.doc.code === x.doc.code) === i).length;
      })(),
    }));
    const fresh = c.rows.find(r => /^SOP-0015, ред\.\u00a02: /.test(r));
    if (!/таб\. №\u00a01009/.test(c.title) || !c.adm || c.rows.length !== c.want || c.bad > 0 || !c.rows.every(r => /^(SOP|TM)-\d{4}, ред\.\u00a0\d+: /.test(r)) || !fresh)
      fail(`карточка человека: «${c.title}», допуск «${c.adm}», строк обучения ${c.rows.length} из ${c.want}, без записи ${c.bad}: ${c.rows.slice(0, 2).join(' | ')}`);
    else ok(`карточка человека: «${c.title}» — ${c.adm}; строк обучения — ${c.rows.length}, новая запись — «${fresh}»`);
    if (c.days.length < 1 || c.days.length !== c.sheetRows || !c.days.every(d => /^\d+(Я|Н|С|РВ|В)/.test(d)) || !/^Отработано: .+ из .+ по норме месяца/.test(c.sums) || !/С: .+ из 120\u00a0ч за год/.test(c.sums))
      fail(`табель в карточке: дней ${c.days.length} из ${c.sheetRows}: ${c.days.slice(0, 3).join(' | ')}; итоги «${c.sums}»`);
    else ok(`табель в карточке: ${c.days.length} дней — ${c.days.slice(0, 3).join(' · ')}…; ${c.sums}`);
    await page.screenshot({ path: join(out, 'e2e-person.png') });
    await page.keyboard.press('Escape');
  }

  // режимы (Б1ж): на посту «Качество и технология» скорость ротора таблетирования парацетамола — на шаг выше цели.
  // В карточке помещения — уставка и цель; следующая такая стадия в «Сейчас» короче: норма по уставке и по цели карты.
  // Её увидели — уставку «−» вернули к цели; стадия кончилась — в досье серии уставка и факт. Мир — на ×4 с пробой
  // в каждом кадре и сразу пауза
  {
    await page.evaluate(() => window.__game.actions.setSpeed(0));
    const k0 = await knobsCard();
    await page.click(`[data-test=card-knobs][data-recipe="${PARA}"] [data-test=knob-speed-more]`);
    const set = v => page.waitForFunction((p, v) => window.__game.store.get().card?.card?.knobs?.find(k => k.recipe === p)?.list.find(x => x.id === 'speed')?.set === v, [PARA, v], { timeout: 20_000 }).then(() => true, () => false);
    const up = await set(52);
    await frames(2);
    const k1 = await knobsCard();
    await page.screenshot({ path: join(out, 'e2e-modes.png') });
    if (k0.on === 0 || !up || k1.speed !== 'Скорость ротора: 52\u00a0об/мин · цель 50\u00a0об/мин')
      fail(`уставка на посту технолога: нажимается ${k0.on} из ${k0.buttons}, уставка ${up ? 'дошла' : 'не дошла'} до движка, «${k1.speed}»`);
    else ok(`уставка на посту технолога: нажимается ${k0.on} из ${k0.buttons} кнопок; «${k1.speed}»; снимок ${join(out, 'e2e-modes.png')}`);
    await page.keyboard.press('Escape');
    // справочник: у таблетирования парацетамола — уставка рядом с целью, по карте — норма и норма с уставками. Вкладку
    // справочник помнит — «Карты» выбрать
    await page.keyboard.press('F1');
    await page.waitForFunction(() => !!window.__game.store.get().ref.view, null, { timeout: 20_000 });
    await page.click('[data-test=ref-tab][data-tab=recipes]');
    await frames(2);
    const r = await page.evaluate(p => {
      const rows = [...document.querySelectorAll(`[data-test=ref-recipe][data-recipe="${p}"] [data-test=ref-stages] tbody tr`)];
      const cells = rows.map(x => [...x.children].map(c => (c.innerText ?? '').replace(/\s+/g, ' ').trim()));
      const row = cells.find(c => c[1]?.startsWith('Таблетирование')) ?? [];
      return { plan: row[6] ?? '', speed: row.find(c => c.includes('Скорость ротора')) ?? '' };
    }, PARA);
    if (!/^\d.* с уставками — \d/.test(r.plan) || !/Скорость ротора: 50 об\/мин \(40–60 об\/мин\) · уставка 52 об\/мин/.test(r.speed))
      fail(`справочник с уставкой: по карте «${r.plan}», режимы «${r.speed}»`);
    else ok(`справочник с уставкой, таблетирование: по карте «${r.plan}»; «${r.speed}»`);
    await page.keyboard.press('Escape');
    // «Сейчас» — по состоянию панели, не клавишей: N её переключает, а Esc закрывает сначала другие окна. Вид в хранилище
    // остаётся и у закрытой панели — свежий он, только пока она открыта
    const now = on => page.evaluate(v => window.__game.store.get().now.open !== v && window.__game.actions.toggleNow(), on);
    await now(true);
    await page.waitForFunction(() => !!window.__game.store.get().now.view, null, { timeout: 20_000 });
    /**
     * ×4, пока в «Сейчас» не появится таблетирование со скоростью ротора `a` (`fast`) или не кончится работа `a` (`gone`), —
     * и сразу пауза; планёрку закрыть, на автопаузах — дальше. Функцию из строки страница не соберёт: eval запрещён
     */
    const until = async (mode, arg) => {
      const from = await gameT();
      let hit = false;
      for (let i = 0; i < 80 && !hit && (await gameT()) < from + 96 * 3600; i++) {
        await page.evaluate(() => window.__game.store.get().morning.open && window.__game.actions.closeMorning(false));
        await page.evaluate(() => window.__game.actions.setSpeed(4));
        hit = await page
          .waitForFunction(
            ([m, a]) => {
              const n = window.__game.store.get().now;
              const v = n.open ? n.view : undefined;
              const hit = !!v && (m === 'fast' ? v.rows.some(r => r.kind === 'stage' && r.stage === 'compress' && r.speed === a) : !v.rows.some(r => r.key === a));
              return hit ? { hit } : window.__game.speed === 0 ? { hit } : false;
            },
            [mode, arg],
            { timeout: 30_000 },
          )
          .then(h => h.jsonValue().then(v => v.hit), () => false);
        await page.evaluate(() => window.__game.actions.setSpeed(0));
      }
      return hit;
    };
    const seen = await until('fast', 52);
    await frames(2);
    const row = await page.evaluate(() => {
      const r = window.__game.store.get().now.view?.rows.find(x => x.kind === 'stage' && x.stage === 'compress' && x.speed === 52);
      return r && { key: r.key, bn: r.bn, norm: r.norm, normAt: r.normAt, text: document.querySelector(`[data-test=now-row][data-key="${r.key}"]`)?.innerText.replace(/\s+/g, ' ').trim() ?? '' };
    });
    if (!seen || !row || !(row.norm < row.normAt) || !/норма по уставке ротора 52 об\/мин · по цели карты — /.test(row.text))
      fail(`«Сейчас» с уставкой: ${seen ? `строка ${JSON.stringify(row)}` : 'таблетирования с 52 об/мин не дождались'}`);
    else ok(`«Сейчас» с уставкой: «${row.text}» — норма ${Math.round(row.norm / 60)} мин против ${Math.round(row.normAt / 60)} по цели`);
    await now(false);
    const k2 = await knobsCard();
    await page.click(`[data-test=card-knobs][data-recipe="${PARA}"] [data-test=knob-speed-less]`);
    const back = await set(50);
    await frames(2);
    const k3 = await knobsCard();
    if (!back || k3.speed !== 'Скорость ротора: 50\u00a0об/мин · по цели') fail(`уставка к цели: «${k2.speed}» → «${k3.speed}»`);
    else ok(`уставка к цели: «${k2.speed}» → «${k3.speed}»`);
    await page.keyboard.press('Escape');
    if (row) {
      await now(true);
      const done = await until('gone', row.key);
      await now(false);
      await page.evaluate(n => window.__game.actions.openDossier(n), row.bn);
      const open = await page
        .waitForFunction(n => window.__game.store.get().dossier.view?.batch === n && window.__game.store.get().dossier.view.stages.find(x => x.stage === 'compress')?.state === 'done', row.bn, { timeout: 20_000 })
        .then(() => true, () => false);
      await frames(2);
      const p = await page.evaluate(() => document.querySelector('[data-test=dossier-stage][data-stage=compress] [data-test=dossier-param][data-param=speed]')?.textContent?.trim() ?? '');
      if (!done || !open || !/^Скорость ротора: \d+\u00a0об\/мин \(цель 50\u00a0об\/мин, диапазон 40–60\u00a0об\/мин\) · уставка 52\u00a0об\/мин$/.test(p))
        fail(`досье серии с уставкой: стадия ${done ? 'кончилась' : 'не кончилась'}, досье ${open ? 'открыто' : 'не открылось'}, «${p}»`);
      else ok(`досье серии с уставкой, таблетирование: «${p}»`);
      await page.keyboard.press('Escape');
    }
  }

  // бригада (Б4б): с 1 октября аппаратчик — в «12 ч, бригада 2». Утро 9 октября: на планёрке — дополнительный выходной
  // бригады в этот день; в табеле октября — смены по рисунку бригады: 1–3 — ночи через полночь, 4, 7 и 8 — выходные, 5 и
  // 6 — дни, 9-го — выходной; итог учётного периода — с 1 октября. В справочнике, во вкладке «Люди», — календарь октября:
  // у бригады 2 — дни, ночи, выходные и дополнительный выходной 9-го
  {
    const today = () => page.evaluate(() => Math.floor(window.__game.t / 86400));
    for (let i = 0; i < 40 && (await today()) < 38; i++) {
      await untilMorning(true);
      if ((await today()) < 38) await page.keyboard.press('Escape');
    }
    await page.waitForFunction(() => {
      const m = window.__game.store.get().morning;
      return m.open && m.view?.day === m.day;
    }, null, { timeout: 20_000 });
    const day = await today();
    const extra = await page.evaluate(() => [...document.querySelectorAll('[data-test=morning-extra]')].map(x => x.textContent ?? ''));
    // данные на полу (Б1и): слой «Загрузка и OEE» за вчера — у ключевой машины OEE с множителями, как на этой планёрке
    {
      await page.evaluate(() => {
        window.__game.actions.setLayer('load');
        window.__game.actions.setFloorWin('yesterday');
      });
      await page.waitForFunction(() => window.__game.store.get().floor.view?.win === 'yesterday', null, { timeout: 20_000 });
      await frames(2);
      const oee = await page.evaluate(() => {
        const g = window.__game;
        const bar = g.stage.floor.bars.find(b => b.label.k === 'key');
        const m = g.store.get().morning.view.lines[0];
        return { key: bar?.label, k: bar?.thing.k, meeting: m.oee ?? null, mk: m.key ?? null };
      });
      await page.evaluate(() => {
        window.__game.actions.setFloorWin('today');
        window.__game.actions.setLayer('plain');
      });
      if (!oee.key || !oee.meeting || oee.key.oee !== oee.meeting.oee || oee.key.a !== oee.meeting.a || oee.key.p !== oee.meeting.p || oee.key.q !== oee.meeting.q || oee.k !== oee.mk)
        fail(`OEE ключевой машины вчера: ${JSON.stringify(oee)}`);
      else ok(`слой за вчера: у ключевой машины OEE ${(oee.key.oee / 100).toFixed(1)} % — доступность ${(oee.key.a / 100).toFixed(1)}, производительность ${(oee.key.p / 100).toFixed(1)}, качество ${(oee.key.q / 100).toFixed(1)} %, как на планёрке`);
    }
    await page.keyboard.press('Escape');
    const who = { kind: 'person', n: 9 };
    await page.evaluate(x => window.__game.actions.select(x), who);
    await page.waitForFunction(x => JSON.stringify(window.__game.store.get().card?.thing) === JSON.stringify(x), who, { timeout: 20_000 });
    await page.waitForSelector('[data-test=card-sa]', { timeout: 20_000 });
    const c = await page.evaluate(() => ({
      shift: document.querySelector('[data-test=card-shift]')?.textContent ?? '',
      days: [...document.querySelectorAll('[data-test=sheet-day]')].map(d => d.textContent ?? ''),
      sa: document.querySelector('[data-test=card-sa]')?.textContent ?? '',
    }));
    await page.screenshot({ path: join(out, 'e2e-crew.png') });
    const d = c.days;
    const rest = [3, 6, 7, 8].every(i => new RegExp(`^${i + 1}В$`).test(d[i] ?? ''));
    const nights = [0, 1, 2].every(i => / ?Н/.test((d[i] ?? '').replace(/^\d+/, '')));
    const days = [4, 5].every(i => new RegExp(`^${i + 1}Я`).test(d[i] ?? ''));
    if (day !== 38 || extra[0] !== '09.10.2027 — 12 ч, бригада 2: дополнительный выходной у 1 человека' || c.shift !== '12 ч, бригада 2' || !rest || !nights || !days || !/^Учётный период 01\.10\.2027–31\.12\.2027/.test(c.sa))
      fail(`бригада: утро ${day} суток, на планёрке «${extra.join(' | ')}»; график «${c.shift}»; табель ${d.slice(0, 9).join(' · ')}; «${c.sa}»`);
    else ok(`бригада: на планёрке «${extra[0]}»; табель октября — ${d.slice(0, 9).join(' · ')}; «${c.sa}»`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('F1');
    await page.waitForSelector('#ref', { timeout: 20_000 });
    await page.click('[data-test=ref-tab][data-tab=people]');
    await page.waitForSelector('[data-test=ref-shiftcal]', { timeout: 20_000 });
    await frames(1);
    const cal = await page.evaluate(() => {
      const el = document.querySelector('[data-test=ref-shiftcal]');
      const cells = [...(el?.querySelectorAll('[data-test=shiftcal-cell][data-shift="shift.c2"]') ?? [])].map(x => ({ k: x.getAttribute('data-k'), n: Number(x.getAttribute('data-n')), of: Number(x.getAttribute('data-of')), extra: x.classList.contains('extra'), text: x.textContent ?? '' }));
      const shown = new Set([...(el?.querySelectorAll('[data-test=shiftcal-cell]') ?? [])].map(x => x.getAttribute('data-shift') ?? ''));
      return { month: el?.getAttribute('data-month'), crews: [...shown].filter(x => /^shift\.c\d$/.test(x)), cells };
    });
    await page.locator('[data-test=ref-shiftcal]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, 'e2e-shiftcal.png') });
    const k = cal.cells.map(x => x.k).slice(0, 8).join();
    const ninth = cal.cells[8];
    if (cal.month !== '2027-10' || cal.crews.join() !== 'shift.c2' || cal.cells.length !== 31 || k !== 'night,night,off,off,day,day,off,off' || !ninth?.extra || ninth.k !== 'night' || ninth.n !== 0 || ninth.of !== 1)
      fail(`календарь бригад: ${cal.month}, бригады с людьми ${cal.crews.join()}, клеток ${cal.cells.length}: ${k}; 9-го ${JSON.stringify(ninth)}`);
    else ok(`календарь бригад: октябрь 2027 года — у бригады 2 ${k.replace(/,/g, ' ')}…, 9-го «${ninth.text}» — дополнительный выходной`);
    await page.keyboard.press('Escape');
  }

  // журнал решений (Б5а): J — журнал с записями начальников отделов планирования и снабжения; раскрыть задание на серию —
  // запас, спрос и порог; «К вещи» — досье серии, в нём «Кто решил»; «Почему?» у задания — журнал на нём; на планёрке —
  // «Решения за сутки»; экран «Кем вы будете» — коллеги по правилам движка
  {
    await page.keyboard.press('KeyJ');
    await page.waitForSelector('[data-test=journal-row]', { timeout: 20_000 });
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-test=journal-row]')].map(x => `${x.getAttribute('data-by')}/${x.getAttribute('data-kind')}`));
    const order = page.locator('[data-test=journal-row][data-by=plan][data-kind=order]').first();
    const n = Number(await order.getAttribute('data-n'));
    await order.locator('[data-test=journal-more]').click();
    await page.waitForSelector(`[data-test=journal-row][data-n="${n}"] [data-test=journal-why]`, { timeout: 10_000 });
    const why = (await order.locator('[data-test=journal-why]').textContent()) ?? '';
    await page.screenshot({ path: join(out, 'e2e-journal.png') });
    await order.locator('[data-test=journal-go]').click();
    await page.waitForSelector('#dossier [data-test=who-row]', { timeout: 20_000 });
    const who = await page.evaluate(() => [...document.querySelectorAll('#dossier [data-test=who-row]')].map(x => (x.textContent ?? '').replace(/\s+/g, ' ').trim()));
    await page.locator('#dossier [data-test=who-row][data-kind=order] [data-test=who-why]').click();
    await page.waitForFunction(k => document.querySelector(`[data-test=journal-row][data-n="${k}"].on [data-test=journal-why]`) !== null && !document.querySelector('#dossier'), n, { timeout: 20_000 });
    const plan = rows.includes('plan/order');
    const supply = rows.includes('supply/po');
    if (!plan || !supply || !/Запаса — .+ при спросе .+; порог — /.test(why) || !who.some(x => x.startsWith('Задание поставил: Начальник отдела планирования')))
      fail(`журнал решений: строки ${[...new Set(rows)].join(', ')}; причина «${why}»; в досье «${who.join(' | ')}»`);
    else ok(`журнал решений: ${rows.length} строк, среди них начальники отделов планирования и снабжения; «${why.slice(0, 120)}…»; в досье — «${who[0]}», «Почему?» открыл журнал на задании`);
    await page.keyboard.press('Escape');
    await page.click('[data-test=morning-open]');
    await page.waitForSelector('[data-test=morning-heads]', { timeout: 20_000 });
    await page.waitForFunction(() => window.__game.store.get().morning.view?.heads !== undefined, null, { timeout: 20_000 });
    const heads = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('[data-test=morning-head]')].map(x => x.textContent ?? ''),
      lever: !!document.querySelector('[data-test=morning-heads] [data-test=lever-journal]'),
      view: window.__game.store.get().morning.view?.heads.length ?? -1,
    }));
    const names = ['Начальник отдела планирования', 'Начальник производства', 'Главный механик', 'Начальник ООК', 'Начальник ОКК', 'Уполномоченное лицо', 'Главный технолог', 'Начальник отдела снабжения', 'Заведующий складом', 'Начальник отдела продаж', 'Отдел кадров'];
    if (heads.rows.length !== heads.view || heads.rows.length === 0 || !heads.lever || !heads.rows.every(r => names.some(x => r.startsWith(`${x}: `))))
      fail(`планёрка, решения за сутки: «${heads.rows.join(' | ')}», в виде ${heads.view}, рычаг «Журнал» ${heads.lever ? 'есть' : 'нет'}`);
    else ok(`планёрка, решения за сутки: ${heads.rows.join('; ')}`);
    await page.keyboard.press('Escape');
    await page.click('[data-test=seats-open]');
    await page.waitForSelector('#seats', { timeout: 20_000 });
    const tiles = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-test=seat-tile]')].map(x => [x.getAttribute('data-seat'), x.textContent ?? ''])));
    await page.click('#seats .close');
    await page.waitForFunction(() => !document.querySelector('#seats'), null, { timeout: 20_000 });
    if (!/Начальник отдела планирования — задания на серии по запасу и спросу заказов/.test(tiles.production ?? '') || !/заказы поставщикам по точке заказа/.test(tiles.supply ?? '') || /по сценарию;/.test(`${tiles.production}${tiles.supply}`.replace(/Заказы покупателей — по сценарию;/, '')))
      fail(`«Кем вы будете»: производство «${tiles.production}»; снабжение «${tiles.supply}»`);
    else ok('«Кем вы будете»: задания на серии — по запасу и спросу заказов, заказы поставщикам — по точке заказа');
  }

  // найм и увольнение (Б4в): F1 → «Люди» — вакансия аппаратчика первой смены по объявлению; на планёрке после
  // понедельника — новые кандидаты; принять первого — медосмотр и первый день; в первый день — следующий табельный номер,
  // в карточке оклад и испытание, он учится; упаковщика — по соглашению: после смены он среди уволенных, в кассе — расчёт
  // при увольнении с выплатой по соглашению
  {
    const epochDay = () => page.evaluate(() => {
      const d = window.__game.db.scenarios['scn.proto'].start.date;
      return Date.UTC(d.y, d.m - 1, d.d) / 86_400_000 + Math.floor(window.__game.t / 86_400);
    });
    const openPeople = async () => {
      await page.keyboard.press('F1');
      await page.waitForSelector('#ref', { timeout: 20_000 });
      await page.click('[data-test=ref-tab][data-tab=people]');
      await page.waitForFunction(() => !!window.__game.store.get().ref.view?.hiring, null, { timeout: 20_000 });
      await frames(1);
    };
    await openPeople();
    await page.click('[data-test=vacancy-open]');
    await page.selectOption('[data-test=vacancy-role]', 'role.operator');
    await page.selectOption('[data-test=vacancy-shift]', 'shift.a');
    await page.selectOption('[data-test=vacancy-via]', 'ad');
    await page.click('[data-test=vacancy-do]');
    await page.waitForFunction(() => window.__game.store.get().ref.view?.hiring?.vacancies.some(v => v.role === 'role.operator' && !v.by), null, { timeout: 20_000 });
    await frames(1);
    const vac = await page.evaluate(() => ({
      id: window.__game.store.get().ref.view.hiring.vacancies.find(v => v.role === 'role.operator' && !v.by).id,
      text: [...document.querySelectorAll('[data-test=ref-vacancy] b')].map(b => b.textContent ?? '').find(x => /Аппаратчик/.test(x)) ?? '',
    }));
    await page.keyboard.press('Escape');
    // отклики — по понедельникам в 09:00: на планёрке следующего утра
    let seen = '';
    for (let i = 0; i < 24 && !seen; i++) {
      await untilMorning(true);
      await page.waitForFunction(() => {
        const m = window.__game.store.get().morning;
        return m.view?.day === m.day;
      }, null, { timeout: 20_000 });
      seen = await page.evaluate(() => [...document.querySelectorAll('[data-test=morning-candidates]')].map(x => x.textContent ?? '').find(x => /Аппаратчик/.test(x)) ?? '');
      await page.keyboard.press('Escape');
    }
    await openPeople();
    const cand = await page.evaluate(id => document.querySelector(`[data-test=ref-vacancy][data-id=${id}] [data-test=cand-hire]`)?.getAttribute('data-id') ?? '', vac.id);
    let ask = '';
    let hire = null;
    if (cand) {
      await page.click(`[data-test=cand-hire][data-id=${cand}]`);
      await page.waitForSelector('[data-test=hire-ask]', { timeout: 20_000 });
      ask = (await page.textContent('[data-test=hire-ask]')) ?? '';
      await page.click('[data-test=hire-do]');
      await page.waitForFunction(id => window.__game.store.get().ref.view?.hiring?.hires.some(h => h.id === id), cand, { timeout: 20_000 });
      hire = await page.evaluate(id => window.__game.store.get().ref.view.hiring.hires.find(h => h.id === id), cand);
    }
    await page.keyboard.press('Escape');
    if (!vac.text || !seen || !hire || !/Медосмотр за счёт завода/.test(ask) || !(hire.exam < hire.day) || hire.trial !== 3)
      fail(`найм: вакансия «${vac.text}», на планёрке «${seen}», кандидат ${cand || 'не найден'}, «${ask}», принят ${JSON.stringify(hire)}`);
    else {
      ok(`найм: вакансия «${vac.text}»; на планёрке «${seen}»; «${ask.replace(/\s+/g, ' ').trim()}» — принят, испытание 3 мес.`);
      // первый день — утро за утром, пока он не наступит; табельный номер — следующий, в карточке — оклад и испытание
      for (let i = 0; i < 12 && (await epochDay()) <= hire.day; i++) await untilMorning();
      await openPeople();
      const p = await page.evaluate(day => {
        const v = window.__game.store.get().ref.view;
        return { last: v.people.find(x => x.role === 'role.operator' && x.hired === day), tabs: v.people.map(x => x.tab) };
      }, hire.day);
      await page.keyboard.press('Escape');
      await page.evaluate(n => window.__game.actions.show({ kind: 'person', n }), p.last?.person ?? 0);
      await page.waitForSelector('[data-test=card-salary]', { timeout: 20_000 });
      await frames(2);
      const c = await page.evaluate(() => ({
        title: document.querySelector('#card-title')?.textContent ?? '',
        salary: document.querySelector('[data-test=card-salary]')?.textContent ?? '',
        trial: document.querySelector('[data-test=card-trial]')?.textContent ?? '',
        train: document.querySelectorAll('[data-test=card-train] li').length,
      }));
      await page.screenshot({ path: join(out, 'e2e-hire.png') });
      await page.keyboard.press('Escape');
      if (!p.last || p.last.salary !== hire.salary || p.last.tab !== Math.max(...p.tabs) || !/в месяц/.test(c.salary) || !c.trial || c.train === 0)
        fail(`первый день: последний — ${JSON.stringify(p.last)}; карточка «${c.title}», «${c.salary}», испытание до «${c.trial}», строк обучения ${c.train}`);
      else ok(`первый день: «${c.title}» — оклад «${c.salary}», испытание до ${c.trial}; строк обучения — ${c.train}; снимок ${join(out, 'e2e-hire.png')}`);
    }
    // по соглашению: упаковщик, который не уходит сам, последний день — сегодня; после смены — среди уволенных, расчёт
    // в кассе
    await openPeople();
    const who = await page.evaluate(() => window.__game.store.get().ref.view.people.find(x => x.role === 'role.packer' && !x.quit));
    await page.keyboard.press('Escape');
    await page.evaluate(n => window.__game.actions.show({ kind: 'person', n }), who.person);
    await page.waitForSelector('[data-test=dismiss-agree]', { timeout: 20_000 });
    await page.click('[data-test=dismiss-agree]');
    await page.waitForSelector('[data-test=dismiss-ask]', { timeout: 20_000 });
    const terms = (await page.textContent('[data-test=dismiss-ask]')) ?? '';
    await page.click('[data-test=dismiss-do]');
    await page.waitForFunction(() => !!document.querySelector('[data-test=card-quit]'), null, { timeout: 20_000 });
    await page.keyboard.press('Escape');
    const left = () => page.evaluate(tab => window.__game.notices.some(n => n.text === `Уволен по соглашению сторон: Упаковщик · таб. №\u00a0${tab}`), who.tab);
    for (let i = 0; i < 8 && !(await left()); i++) {
      await page.evaluate(() => window.__game.store.get().morning.open && window.__game.actions.closeMorning(false));
      await page.keyboard.press('Digit4');
      await page.waitForFunction(() => window.__game.speed === 0 || window.__game.notices.some(n => /^Уволен по соглашению сторон/.test(n.text)), null, { timeout: 120_000 });
    }
    await page.evaluate(() => window.__game.actions.setSpeed(0));
    await openPeople();
    const former = await page.evaluate(() => [...document.querySelectorAll('[data-test=ref-former] tbody tr')].map(r => [...r.children].map(c => c.innerText.trim()).join(' · ')));
    await page.keyboard.press('Escape');
    await page.click('[data-test=cash-open]');
    // вид кассы приходит из потока расчёта, а прежний, с первого открытия, остаётся в окне до нового — ждём строку расчёта
    await page.waitForFunction(() => !!window.__game.store.get().cash.view?.entries.some(e => e.item === 'settle'), null, { timeout: 20_000 }).catch(() => {});
    const settle = await page.evaluate(() => window.__game.store.get().cash.view?.entries.find(e => e.item === 'settle'));
    await page.keyboard.press('Escape');
    const row = former.find(x => x.startsWith(`${who.tab} · Упаковщик`) && /по соглашению сторон/.test(x));
    if (!/^Последний день — сегодня/.test(terms) || !(await left()) || !row || !settle || settle.sum >= 0)
      fail(`по соглашению: «${terms}», уволен ${await left()}, уволенные ${former.join(' | ')}, расчёт ${JSON.stringify(settle)}`);
    else ok(`по соглашению: «${terms}»; среди уволенных — «${row}»; в кассе расчёт при увольнении ${Math.round(-settle.sum / 100)} ₽`);
  }

  // первая оценка пары (Б3г): одобрение упаковки кончается 29.11 — за срок предупреждения коллега качества назначает
  // оценку по документам; на планёрке пара в «Поставщиках», пока её рассматривают; рассмотрели — в справочнике, во
  // вкладке «Контрагенты», у пары новое одобрение — с дня рассмотрения
  {
    let seen = false;
    let done = false;
    for (let i = 0; i < 60 && !done; i++) {
      await untilMorning(true);
      await page.waitForFunction(() => {
        const m = window.__game.store.get().morning;
        return m.view?.day === m.day;
      }, null, { timeout: 20_000 });
      const soon = await page.evaluate(() => window.__game.store.get().morning.view.partners.soon.some(x => x.id === 'sup.pack|mkr.pack'));
      seen ||= soon;
      done = seen && !soon;
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('F1');
    await page.waitForSelector('#ref', { timeout: 20_000 });
    await page.click('[data-test=ref-tab][data-tab=partners]');
    await page.waitForFunction(() => window.__game.store.get().ref.view?.partners, null, { timeout: 20_000 });
    await frames(1);
    const pack = await page.evaluate(() => {
      const v = window.__game.store.get().ref.view.partners;
      const i = v.pairs.findIndex(x => x.id === 'sup.pack|mkr.pack');
      return { row: v.pairs[i], text: document.querySelectorAll('[data-test=ref-pair-state]')[i]?.textContent ?? '', start: window.__game.db.scenarios['scn.proto'].start.date };
    });
    await page.screenshot({ path: join(out, 'e2e-pair.png') });
    const start = Date.UTC(pack.start.y, pack.start.m - 1, pack.start.d) / 86_400_000;
    if (!seen || !done || !pack.row?.ok || !(pack.row.since > start) || !/^с \d\d\.\d\d\.\d{4} до /.test(pack.text))
      fail(`первая оценка пары: на планёрке ${seen ? 'была' : 'не было'}, ${done ? 'рассмотрели' : 'не рассмотрели'}; в справочнике «${pack.text}»`);
    else ok(`первая оценка пары: упаковку оценили по документам — в справочнике «${pack.text}»`);
    await page.keyboard.press('Escape');
  }

  // визит подрядчика к оборудованию или машине линии (Б3в): каждое утро — планёрка; в тот день, когда в «Калибровке
  // и квалификации» такой визит, к его часу лампа вещи показывает «калибровка или квалификация»; работу приняли —
  // в карточке вещи новая запись и кто её принял. Шаг — после найма и оценки пары: какой визит будет первым после
  // бригад, зависит от того, когда вещь свободна, а оценка пары и найм ждут своих дней
  {
    let visit = null;
    for (let i = 0; i < 60 && !visit; i++) {
      await untilMorning(true);
      await page.waitForFunction(() => {
        const m = window.__game.store.get().morning;
        return m.view?.day === m.day;
      }, null, { timeout: 20_000 });
      visit = await page.evaluate(() => window.__game.store.get().morning.view.assets.today.find(a => a.thing && (a.thing.kind === 'equipment' || a.thing.kind === 'machine')) ?? null);
      await page.keyboard.press('Escape');
    }
    if (!visit) fail('первый визит: за 60 утр к оборудованию и машинам визитов не было');
    else {
      const ix = await page.evaluate(t => {
        const plant = window.__game.db.plants[window.__game.db.scenarios['scn.proto'].plant];
        return t.kind === 'equipment' ? t.i : plant.equipment.length + plant.lines.slice(0, t.line).reduce((n, l) => n + l.machines.length, 0) + t.k;
      }, visit.thing);
      // мир может встать на другой автопаузе — дальше
      for (let i = 0; i < 6 && (await page.evaluate(k => window.__game.stage.machines.lamps[k] !== 'check', ix)); i++) {
        await page.keyboard.press('Digit4');
        await page.waitForFunction(k => window.__game.stage.machines.lamps[k] === 'check' || window.__game.speed === 0, ix, { timeout: 120_000 });
      }
      await page.evaluate(() => window.__game.actions.setSpeed(0));
      const at = await page.evaluate(k => ({ t: window.__game.t, day: window.__game.day, lamp: window.__game.stage.machines.lamps[k] }), ix);
      await page.evaluate(x => window.__game.actions.show(x), visit.thing);
      await page.waitForFunction(x => JSON.stringify(window.__game.store.get().card?.thing) === JSON.stringify(x), visit.thing, { timeout: 20_000 });
      await frames(2);
      const during = await page.evaluate(() => document.querySelector('[data-test=card-visit]')?.textContent ?? '');
      await page.screenshot({ path: join(out, 'e2e-visit.png') });
      if (at.lamp !== 'check' || !during) fail(`первый визит: лампа ${at.lamp}, в карточке — «${during}»`);
      else ok(`первый визит: ${((at.t % 86400) / 3600).toFixed(1)} ч суток ${at.day} — лампа «калибровка или квалификация»; в карточке — «${during}»`);
      // приёмка: в истории карточки — запись с тем, кто принял. Мир может встать на планёрке следующего утра — её закрыть,
      // не трогая карточку (Esc сначала снимает выбор)
      const recs = () => page.evaluate(() => [...document.querySelectorAll('[data-test=card-history] li')].map(li => li.textContent ?? '').filter(x => /приёмка —/.test(x)));
      let fresh = [];
      for (let i = 0; i < 6 && fresh.length === 0; i++) {
        await page.evaluate(() => window.__game.store.get().morning.open && window.__game.actions.closeMorning(false));
        await page.keyboard.press('Digit4');
        await page.waitForFunction(() => window.__game.speed === 0 || [...document.querySelectorAll('[data-test=card-history] li')].some(li => /приёмка —/.test(li.textContent ?? '')), null, { timeout: 120_000 });
        fresh = await recs();
      }
      await page.evaluate(() => window.__game.actions.setSpeed(0));
      if (fresh.length !== 1 || !/таб\. №\u00a0\d+/.test(fresh[0])) fail(`первый визит: новых записей в карточке ${fresh.length} — ${fresh.join(' | ')}`);
      else ok(`первый визит: в карточке — «${fresh[0].replace(/\s+/g, ' ').trim()}»`);
      await page.keyboard.press('Escape');
    }
  }

  // отпуска (Б4г): автопаузы — одна, «Черновик графика отпусков», до конца блока; «До события» — 1 декабря 2027 года,
  // 09:00: черновик на 2028 год, мир стоит. F1 → «Люди» — график по неделям; аналитика обучили смежной профессии
  // начальника ОКК — и сменили им заместителя у части начальника ОКК. После утверждения 17 декабря часть наладчика
  // перенесли на январь; утро за утром — в кассе отпускные; 10 января водитель погрузчика в отпуске: на планёрке
  // «В отпуске», в карточке «в отпуске по», у кладовщика — «Замещает»
  {
    const epoch = () => page.evaluate(() => {
      const d = window.__game.db.scenarios['scn.proto'].start.date;
      return Date.UTC(d.y, d.m - 1, d.d) / 86_400_000 + Math.floor(window.__game.t / 86_400);
    });
    const ymd = (y, m, d) => Date.UTC(y, m - 1, d) / 86_400_000;
    const openLeave = async () => {
      await page.keyboard.press('F1');
      await page.waitForSelector('#ref', { timeout: 20_000 });
      await page.click('[data-test=ref-tab][data-tab=people]');
      await page.waitForFunction(() => !!window.__game.store.get().ref.view?.leave, null, { timeout: 20_000 });
      await frames(1);
    };
    const leaveView = () => page.evaluate(() => window.__game.store.get().ref.view?.leave);
    const offBefore = await page.evaluate(() => [...window.__game.store.get().pauses.off]);
    const others = ['failure', 'oos', 'deviation', 'truckWait', 'orderRisk', 'materialLate', 'qualLost', 'overtimeLow', 'resign', 'assetExpired', 'pairSuspended', 'morning'];
    await page.evaluate(ids => ids.forEach(p => window.__game.actions.setPause(p, false)), others);
    const draftNote = () => page.evaluate(() => window.__game.notices.find(n => /^Кадры составили черновик графика отпусков на 2028/.test(n.text)) ?? null);
    // прошлый шаг мог уйти за 1 декабря, тогда черновик уже пришёл: он — в полосе извещений со знаком паузы
    const early = !!(await draftNote());
    for (let i = 0; i < 6 && !(await draftNote()); i++) {
      await page.keyboard.press('Digit6');
      await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
      if (await page.evaluate(() => window.__game.store.get().morning.open)) await page.keyboard.press('Escape');
    }
    const st = await page.evaluate(() => ({ speed: window.__game.speed, top: window.__game.notices[0], clock: document.querySelector('[data-test=clock]')?.textContent ?? '', date: document.querySelector('[data-test=date]')?.textContent ?? '' }));
    const note = await draftNote();
    const start = await page.evaluate(() => window.__game.db.scenarios['scn.proto'].start.date);
    const noteDay = note ? Date.UTC(start.y, start.m - 1, start.d) / 86_400_000 + Math.floor(note.t / 86_400) : 0;
    const noteHour = note ? (note.t % 86_400) / 3600 : 0;
    const stopped = early || (st.speed === 0 && st.top?.text === note?.text);
    if (!note?.stop || noteDay !== ymd(2027, 12, 1) || noteHour < 9 || noteHour >= 9.2 || !stopped)
      fail(`черновик графика отпусков: «${note?.text}» (${noteDay}, ${noteHour.toFixed(2)} ч, пауза ${note?.stop}), скорость ${st.speed}, ${st.date} ${st.clock}`);
    else ok(`черновик графика отпусков: 01.12.2027 ${noteHour.toFixed(2)} ч — «${note.text}», ${early ? 'пришёл в прошлом шаге, со знаком паузы' : 'мир стоит'}`);
    await openLeave();
    const plan = await page.evaluate(() => {
      const v = window.__game.store.get().ref.view.leave;
      return {
        head: document.querySelector('[data-test=ref-leave] > b')?.parentElement?.querySelector('span')?.textContent ?? '',
        rows: document.querySelectorAll('[data-test=leave-row]').length,
        people: v.people.length,
        parts: v.people.reduce((n, p) => n + p.parts.filter(x => x.y === 2028).length, 0),
        weeks: document.querySelectorAll('[data-test=leave-row] .wk.draft, [data-test=leave-row] .wk.bad').length,
        st: v.years.find(y => y.y === 2028)?.st,
      };
    });
    await page.screenshot({ path: join(out, 'e2e-leave.png') });
    await page.keyboard.press('Escape');
    if (plan.st !== 'draft' || plan.rows !== plan.people || plan.parts < 2 * (plan.people - 2) || plan.weeks === 0 || !/утвердят 17\.12\.2027/.test(plan.head))
      fail(`график отпусков: «${plan.head}», ${plan.st}, строк ${plan.rows} из ${plan.people}, частей ${plan.parts}, недель ${plan.weeks}`);
    else ok(`график отпусков 2028: «${plan.head}» — ${plan.rows} человек, ${plan.parts} частей; снимок ${join(out, 'e2e-leave.png')}`);
    // смежная профессия: аналитик без неё — «Обучить смежной профессии…» начальника ОКК; у части начальника ОКК — он
    let v = await leaveView();
    const analyst = v.people.find(p => p.role === 'role.analyst' && !p.also);
    const head = v.people.find(p => p.role === 'role.qc-head');
    await page.evaluate(n => window.__game.actions.show({ kind: 'person', n }), analyst.person);
    await page.waitForSelector('[data-test=also-add]', { timeout: 20_000 });
    await page.selectOption('[data-test=also-add]', 'role.qc-head');
    await page.waitForFunction(() => (window.__game.store.get().card?.card?.also ?? []).includes('role.qc-head'), null, { timeout: 20_000 });
    const also = (await page.textContent('[data-test=card-also]')) ?? '';
    await page.keyboard.press('Escape');
    await openLeave();
    await page.click(`[data-test=leave-row][data-tab="${head.tab}"]`);
    await page.waitForSelector('[data-test=leave-person] [data-test=leave-deputy]', { timeout: 20_000 });
    const part = head.parts.find(x => x.y === 2028);
    await page.selectOption(`[data-test=leave-person] [data-test=leave-part][data-part=${part.id}] [data-test=leave-deputy]`, String(analyst.person));
    await page.waitForFunction(([n, id, a]) => window.__game.store.get().ref.view?.leave?.people.find(p => p.person === n)?.parts.find(x => x.id === id)?.deputy?.n === a, [head.person, part.id, analyst.person], { timeout: 20_000 }).catch(() => {});
    v = await leaveView();
    const got = v.people.find(p => p.person === head.person).parts.find(x => x.id === part.id);
    await page.keyboard.press('Escape');
    if (!/Начальник ОКК/.test(also) || got.deputy?.n !== analyst.person || part.deputy?.n === analyst.person)
      fail(`заместитель: смежные профессии «${also}»; у части начальника ОКК был ${JSON.stringify(part.deputy)}, стал ${JSON.stringify(got.deputy)}`);
    else ok(`заместитель: аналитик таб. № ${analyst.tab} — «${also.trim()}»; у части начальника ОКК ${part.from} заместитель — он вместо таб. № ${part.deputy?.tab}`);
    // утверждение 17 декабря; часть наладчика — на январь, по соглашению
    for (let i = 0; i < 20 && (await epoch()) < ymd(2027, 12, 18); i++) await untilMorning();
    v = await leaveView();
    const setter = v.people.find(p => p.role === 'role.setter');
    const later = setter.parts.find(x => x.y === 2028 && x.from >= ymd(2028, 2, 1) && x.from < ymd(2028, 6, 1));
    await openLeave();
    await page.click(`[data-test=leave-row][data-tab="${setter.tab}"]`);
    await page.click(`[data-test=leave-person] [data-test=leave-part][data-part=${later.id}] [data-test=leave-move]`);
    await page.fill(`[data-test=leave-person] [data-test=leave-part][data-part=${later.id}] [data-test=leave-move-day]`, '2028-01-17');
    await page.click(`[data-test=leave-person] [data-test=leave-part][data-part=${later.id}] [data-test=leave-move-do]`);
    await page.waitForFunction(([n, id, z]) => window.__game.store.get().ref.view?.leave?.people.find(p => p.person === n)?.parts.find(x => x.id === id)?.from === z, [setter.person, later.id, ymd(2028, 1, 17)], { timeout: 20_000 }).catch(() => {});
    v = await leaveView();
    const moved = v.people.find(p => p.person === setter.person).parts.find(x => x.id === later.id);
    await page.keyboard.press('Escape');
    if (v.years.find(y => y.y === 2028)?.st !== 'approved' || moved.from !== ymd(2028, 1, 17))
      fail(`после утверждения: график ${v.years.find(y => y.y === 2028)?.st}, часть наладчика ${later.from} → ${moved.from}`);
    else ok(`после утверждения: часть наладчика перенесли с ${later.from} на 17.01.2028 (${moved.to - moved.from + 1} дн.)`);
    // утро за утром до 10 января: в кассе — отпускные; водитель погрузчика в отпуске
    let pay;
    for (let i = 0; i < 30 && (await epoch()) < ymd(2028, 1, 10); i++) {
      await untilMorning();
      if (!pay) {
        await page.click('[data-test=cash-open]');
        await page.waitForFunction(() => !!window.__game.store.get().cash.view, null, { timeout: 20_000 });
        await frames(2);
        pay = await page.evaluate(() => window.__game.store.get().cash.view.entries.find(e => e.item === 'vacation'));
        await page.keyboard.press('Escape');
      }
    }
    await page.evaluate(() => window.__game.actions.openMorning());
    await page.waitForFunction(() => !!window.__game.store.get().morning.view, null, { timeout: 20_000 });
    await frames(2);
    const away = await page.evaluate(() => [...document.querySelectorAll('[data-test=morning-away]')].map(x => x.textContent ?? ''));
    await page.keyboard.press('Escape');
    v = await leaveView();
    const driver = v.people.find(p => p.role === 'role.driver');
    await page.evaluate(n => window.__game.actions.show({ kind: 'person', n }), driver.person);
    await page.waitForSelector('[data-test=leave-away]', { timeout: 20_000 }).catch(() => {});
    const card = (await page.textContent('[data-test=leave-away]').catch(() => '')) ?? '';
    await page.keyboard.press('Escape');
    // заместитель: в карточке кладовщика — кого он замещает и по какой день. «За» в «Сейчас» у работы склада не видно:
    // она общая у кладовщика и водителя, — это проверяет tools/test/leaveview.test.ts
    const keeper = v.people.find(p => p.role === 'role.storekeeper');
    await page.evaluate(n => window.__game.actions.show({ kind: 'person', n }), keeper.person);
    await page.waitForSelector('[data-test=leave-covers]', { timeout: 20_000 }).catch(() => {});
    const covers = (await page.textContent('[data-test=leave-covers]').catch(() => '')) ?? '';
    await page.screenshot({ path: join(out, 'e2e-leave-card.png') });
    await page.keyboard.press('Escape');
    if (!pay || pay.sum >= 0 || !away.some(x => /Водитель погрузчика/.test(x) && /замещает Кладовщик/.test(x)) || !/в отпуске по 23\.01\.2028, замещает Кладовщик/.test(card) || !/Водитель погрузчика.*по 23\.01\.2028/.test(covers))
      fail(`отпуск: отпускные ${JSON.stringify(pay)}; на планёрке «${away.join(' | ')}»; в карточке «${card}»; у кладовщика «${covers}»`);
    else ok(`отпуск: в кассе отпускные ${Math.round(-pay.sum / 100)} ₽; на планёрке «${away.find(x => /Водитель/.test(x))}»; в карточке «${card}»; у кладовщика «${covers}»; снимок ${join(out, 'e2e-leave-card.png')}`);
    // автопаузы — как были: до сих пор «До утра» шло без остановок до 08:00
    await page.evaluate(ids => ids.forEach(p => window.__game.actions.setPause(p, true)), others.filter(p => !offBefore.includes(p)));
  }

  // проблемы (Б1к): слой «Проблемы» с высоты участка; ничего не горит — ×4, пока не загорится, не дольше трёх суток
  // завода. Над каждой вещью вида, которая на полу, — значок вида первой проблемы; наведение на первый — подсказка со
  // всеми проблемами вещи и мгновением; щелчок — карточка вещи с блоком «Проблемы» теми же словами. Снимок — в контактный
  // лист, лист — заново
  {
    await page.click('[data-test=layer-andon]');
    await page.waitForFunction(() => window.__game.store.get().layer === 'andon' && !!window.__game.store.get().andon.view, null, { timeout: 20_000 });
    const from = await gameT();
    for (let i = 0; i < 60 && (await gameT()) < from + 72 * 3600; i++) {
      if (await page.evaluate(() => window.__game.store.get().andon.view.items.length > 0)) break;
      await page.evaluate(() => window.__game.store.get().morning.open && window.__game.actions.closeMorning(false));
      await page.evaluate(() => window.__game.actions.setSpeed(4));
      await page.waitForFunction(() => window.__game.store.get().andon.view.items.length > 0 || window.__game.speed === 0, null, { timeout: 30_000 }).catch(() => {});
      await page.evaluate(() => window.__game.actions.setSpeed(0));
    }
    await page.evaluate(() => window.__game.store.get().morning.open && window.__game.actions.closeMorning(false));
    await camAt(null);
    await settle(3);
    await frames(4);
    const a = await page.evaluate(() => {
      const g = window.__game;
      const items = g.store.get().andon.view.items;
      const marks = g.stage.andon.marks;
      return {
        items: items.map(x => ({ thing: x.thing, kind: x.kind, weight: x.weight, why: x.why.map(w => w.kind) })),
        marks: marks.map(m => ({ thing: m.thing, kind: m.kind, weight: m.weight, n: m.n })),
        first: marks[0] ? { sp: g.stage.screen(marks[0].x, marks[0].y, marks[0].z), n: marks[0].n } : undefined,
        calls: g.stage.calls,
      };
    });
    const right = a.marks.every(m => JSON.stringify(a.items[m.n].thing) === JSON.stringify(m.thing) && a.items[m.n].kind === m.kind && a.items[m.n].weight === m.weight);
    if (a.marks.length < 1 || !right) fail(`слой «Проблемы»: ${JSON.stringify(a)}`);
    else ok(`слой «Проблемы»: значков ${a.marks.length} — ${a.marks.map(m => `${m.thing.kind} ${m.kind} (${m.weight})`).join(', ')}`);
    await page.screenshot({ path: join(out, 'e2e-andon.png') });
    sheet.push({ file: join(out, 'e2e-andon.png'), label: `Б1к · «Проблемы» · участок · ${a.calls} вызовов` });
    if (a.first?.sp) {
      await page.mouse.move(a.first.sp.x, a.first.sp.y);
      await page.waitForSelector('[data-test=andon-tip]', { timeout: 10_000 }).catch(() => {});
      const tip = await page.evaluate(() => ({ rows: [...document.querySelectorAll('[data-test=andon-tip] [data-test=andon-row]')].map(x => x.getAttribute('data-kind')), text: document.querySelector('[data-test=andon-tip]')?.textContent ?? '' }));
      const want = a.items[a.first.n].why;
      if (tip.rows.join() !== want.join() || !/с \d\d\.\d\d \d\d:\d\d/.test(tip.text)) fail(`подсказка у значка: ${JSON.stringify(tip)}, а проблемы ${want.join(', ')}`);
      else ok(`подсказка у значка: ${tip.text}`);
      await page.mouse.click(a.first.sp.x, a.first.sp.y);
      await page.waitForSelector('[data-test=card-andon] [data-test=andon-row]', { timeout: 20_000 }).catch(() => {});
      const card = await page.evaluate(() => ({ sel: window.__game.selected, rows: [...document.querySelectorAll('[data-test=card-andon] [data-test=andon-row]')].map(x => x.getAttribute('data-kind')) }));
      if (JSON.stringify(card.sel) !== JSON.stringify(a.items[a.first.n].thing) || card.rows.join() !== want.join()) fail(`карточка вещи со значком: ${JSON.stringify(card)}`);
      else ok(`карточка вещи со значком: блок «Проблемы» — ${card.rows.join(', ')}`);
      await page.keyboard.press('Escape');
      await page.mouse.move(5, 400);
    } else fail('первый значок андона не на экране');
    await page.click('[data-test=layer-plain]');
    await writeSheet(sheet);
  }

  // стартовый пресет (Б1б): первый запуск без пресета в адресе — средний, через пять секунд замер; кадр программной
  // отрисовки дольше 33 мс — низкий, и он запомнился: при новом открытии — сразу низкий
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const fresh = await ctx.newPage();
    fresh.on('pageerror', e => errors.push(e.message));
    await fresh.goto(`http://127.0.0.1:${port}/index.html?lang=ru`);
    // кадр программной отрисовки на среднем — секунда и больше: замер может кончиться раньше, чем сценарий успеет
    // спросить пресет, поэтому что мерили — из записи замера (main.tsx, `__preset`)
    await fresh.waitForFunction(() => localStorage.getItem('pharma.quality') !== null, null, { timeout: 90_000 });
    const picked = await fresh.evaluate(() => ({ quality: window.__game.store.get().quality, kept: localStorage.getItem('pharma.quality'), m: window.__preset }));
    await fresh.reload();
    await fresh.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
    const again = await fresh.evaluate(() => ({ quality: window.__game.store.get().quality, m: window.__preset }));
    const m = picked.m;
    if (m?.from !== 'medium' || m.to !== 'low' || picked.quality !== 'low' || picked.kept !== 'low' || again.quality !== 'low' || again.m)
      fail(`стартовый пресет: замер ${JSON.stringify(m)}, после замера ${picked.quality} (запомнен ${picked.kept}), при новом открытии ${again.quality}${again.m ? ', и снова замер' : ''}`);
    else ok(`стартовый пресет: замер на среднем — ${m.frames} кадров, медиана ${m.median} мс — низкий, запомнен; при новом открытии — сразу низкий, без замера`);
    await ctx.close();
  }

}
