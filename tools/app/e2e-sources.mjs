// Сценарий в браузере, часть «Источники» (Б6ж; docs/specs/2026-10-vertical-slice.md, «Б6ж», «Проверки Б6ж»): чистое
// окно, как при первом запуске, место «Директор» — «Одобрить пару» и заказ поставщику оно даёт оба. «До утра» —
// планёрка 1 сентября. Справочник (F1), «Контрагенты»: у парацетамола и лоратадина — пары-кандидаты, «кандидат: в досье
// изготовителя нет» и «Одобрить пару»; «Одобрить пару» у парацетамола — шаг «документы — у специалиста ООК», в
// журнале — запись игрока. «До утра» — до планёрки с одобрением на шаге пробной партии: в блоке «Материалы» —
// «Одобрение пар», в справочнике — заказ и обещанный день. Расписание (G), вкладка «Материалы»: заказ пробной партии в
// пути помечен, в потребность не идёт, отменить его нельзя; у планового заказа — «Предложения» с баллом, «Заказать» —
// окно «Заказ поставщику» с этим поставщиком и строкой планового заказа. С `--long 1` — ещё «До утра» до подачи
// изменения досье, около 50 суток завода: на планёрке и в справочнике — «подано …». Отклик — в кадрах (геймдизайн,
// §21). Снимки — tools/app/out/sources-*.png, лист — tools/app/out/sources.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Пороги отклика — в кадрах, как у части «Первая неделя» (tools/app/e2e-week.mjs): числа — геймдизайн, §21. */
const FRAMES = { input: 6, command: 15 };
const PAR2 = 'sup.api-par2|mkr.api-par2';
const LOR2 = 'sup.api-lor2|mkr.api-lor2';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string, long?: boolean }} x */
export async function sourcesPart({ browser, port, out, ok, fail, errors, requests, q, long = false }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  await director({ browser, port, out, ok, fail, errors, requests, q, shots, feel, long });
  ok(`Источники, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  // лист снимков: по три в ряд, подпись — шаг и часы завода
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'sources.png'), fullPage: true });
  await lister.close();
  ok(`Источники: ${shots.length} снимков → ${join(out, 'sources.png')}`);
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
    const m = () => h().gantt.mrp;
    const state = pair => document.querySelector(`[data-test=ref-pair-state][data-pair="${pair}"]`)?.textContent ?? '';
    window.__seen = {
      // «Одобрить пару»: у кандидата — шаг оценки документов, кнопки больше нет
      approving: pair => / · документы — у специалиста ООК$/.test(state(pair)) && !document.querySelector(`[data-test=pair-approve][data-pair="${pair}"]`),
      // вкладка «Материалы» открыта, её вид пришёл и сетка нарисована
      mrp: () => h().gantt.tab === 'mrp' && !!m() && document.querySelectorAll('[data-test=mrp-row]').length > 0,
      // «Предложения» раскрыты: строки поставщиков с баллом
      offers: () => document.querySelectorAll('[data-test=mrp-offers] [data-test=mrp-offer]').length > 0,
      // окно «Заказ поставщику» с поставщиком и строками, ответ завода пришёл
      po: ([supplier, n]) => h().po.open && h().po.supplier === supplier && h().po.lines.length === n && !!h().po.view && document.querySelectorAll('[data-test=po-line]').length === n,
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

/** Общие шаги окна: кадры, часы, отклик, снимок, «До утра», журнал, справочник, места. */
function steps(page, { out, fail, shots, feel }) {
  const frames = n => page.evaluate(k => new Promise(r => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);
  const clock = () => page.evaluate(() => `${document.querySelector('[data-test=date]')?.textContent ?? ''} ${document.querySelector('[data-test=clock]')?.textContent ?? ''}`);
  /** Закрыть всё, что открыто поверх завода: планёрку, окно S&OP, справочник, расписание, журнал, заказ, карточку. */
  const closeAll = async () => {
    for (let k = 0; k < 8; k++) {
      const open = await page.evaluate(() => {
        const h = window.__game.store.get();
        return h.morning.open || h.sop.open || h.gantt.open || h.journal.open || h.po.open || !!h.selected || !!document.querySelector('#ref');
      });
      if (!open) return;
      await page.keyboard.press('Escape');
      await frames(1);
    }
  };
  return {
    frames,
    clock,
    closeAll,
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
      const file = join(out, `sources-${String(shots.length + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file });
      shots.push({ file, label: `${shots.length + 1}. ${what} · ${await clock()}` });
    },
    /** «До утра» (5): до 08:00 или до автопаузы по дороге; планёрку не закрывать — она и нужна. Открыта ли планёрка. */
    untilMorning: async () => {
      // всё поверх завода закрыть; окно S&OP — тоже: совещание открывает его само (Б6г), и поверх планёрки оно
      // перехватит щелчки
      await closeAll();
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
    /** Справочник (F1), вкладка «Контрагенты»: строки пар нарисованы. */
    partners: async () => {
      await closeAll();
      await page.keyboard.press('F1');
      await page.waitForFunction(() => !!window.__game.store.get().ref.view, null, { timeout: 20_000 });
      await page.click('[data-test=ref-tab][data-tab=partners]');
      await page.waitForSelector('[data-test=ref-pair-state]', { timeout: 20_000 });
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

/** Состояние пары в «Контрагентах» и есть ли у неё «Одобрить пару». */
const pairRow = (page, pair) =>
  page.evaluate(p => {
    const el = document.querySelector(`[data-test=ref-pair-state][data-pair="${p}"]`);
    return { state: el?.textContent ?? '', muted: el?.classList.contains('muted') ?? false, button: !!document.querySelector(`[data-test=pair-approve][data-pair="${p}"]`) };
  }, pair);

/** Строка одобрения пары в блоке «Материалы» планёрки: шаг и текст. */
const meetingApp = (page, pair) =>
  page.evaluate(p => {
    const el = document.querySelector(`[data-test=morning-materials-app][data-pair="${p}"]`);
    return el ? { step: el.getAttribute('data-step') ?? '', text: el.textContent ?? '' } : undefined;
  }, pair);

/**
 * «Директор»: пары-кандидаты и «Одобрить пару» — шаг документов и запись журнала; пробная партия — планёрка и
 * справочник с обещанным днём; «Предложения» планового заказа — «Заказать»; подача изменения досье — «подано …».
 */
async function director(x) {
  const { ok, fail, long } = x;
  const { ctx, page } = await openGame(x);
  const s = steps(page, x);
  try {
    await s.seats(['director']);
    await s.untilMorning();

    // «Контрагенты»: два кандидата — серым, «кандидат: в досье изготовителя нет», «Одобрить пару»
    await s.partners();
    const cands = { par: await pairRow(page, PAR2), lor: await pairRow(page, LOR2) };
    await page.evaluate(p => document.querySelector(`[data-test=ref-pair-state][data-pair="${p}"]`)?.scrollIntoView({ block: 'center' }), PAR2);
    await s.shot('Контрагенты: пары-кандидаты');
    if (!Object.values(cands).every(c => c.state === 'кандидат: в досье изготовителя нет' && c.muted && c.button)) fail(`кандидаты: ${JSON.stringify(cands)}`);
    else ok(`контрагенты — ${await s.clock()}: у парацетамола и лоратадина «${cands.par.state}», «Одобрить пару»`);

    // «Одобрить пару» у парацетамола: оценка документов у специалиста ООК, кнопки нет; у лоратадина — по-прежнему
    await s.measure('«Одобрить пару»', () => page.click(`[data-test=pair-approve][data-pair="${PAR2}"]`), 'approving', PAR2);
    const docs = { par: await pairRow(page, PAR2), lor: await pairRow(page, LOR2) };
    await s.shot('Контрагенты: одобрение начато — документы');
    if (docs.par.state !== 'кандидат: в досье изготовителя нет · документы — у специалиста ООК' || docs.par.button || !docs.lor.button) fail(`одобрение: ${JSON.stringify(docs)}`);
    else ok(`«Одобрить пару» — «${docs.par.state}»; у лоратадина кнопка осталась`);

    // журнал: запись игрока — одобрение пары
    await s.closeAll();
    await s.openJournal();
    const row = '[data-test=journal-row][data-kind=pairApprove][data-by=player]';
    await page.waitForSelector(row, { timeout: 20_000 }).catch(() => {});
    const rec = await page.evaluate(r => document.querySelector(r)?.textContent ?? '', row);
    await s.shot('Журнал: «Одобрить пару»');
    if (!/Одобрить пару .+: Парацетамол — документы, пробная партия, аудит, изменение досье/.test(rec)) fail(`журнал: «${rec}»`);
    else ok(`журнал: «${rec.slice(0, 160)}»`);

    // «До утра» — до планёрки, где одобрение — на шаге пробной партии: блок «Материалы», «Одобрение пар»
    let trial;
    for (let i = 0; i < 8 && trial?.step !== 'trial'; i++) if (await s.untilMorning()) trial = await meetingApp(page, PAR2);
    if (trial?.step !== 'trial') {
      fail(`планёрка: одобрения на шаге пробной партии нет за 8 «До утра» (${JSON.stringify(trial)})`);
      return;
    }
    const head = await page.evaluate(() => [...document.querySelectorAll('[data-test=morning-materials] > div')].map(e => e.textContent ?? ''));
    await page.evaluate(p => document.querySelector(`[data-test=morning-materials-app][data-pair="${p}"]`)?.scrollIntoView({ block: 'center' }), PAR2);
    await s.shot('Планёрка: одобрение пары — пробная партия');
    // поставщик — сам изготовитель: имя пары одно
    if (!head.includes('Одобрение пар') || !/^[^—]+, Парацетамол: пробная партия заказана$/.test(trial.text)) fail(`планёрка: ${JSON.stringify({ head, trial })}`);
    else ok(`планёрка — ${await s.clock()}: «Одобрение пар» — «${trial.text}»`);

    // справочник: пробная партия — номер заказа и обещанный день
    await s.partners();
    const ordered = await pairRow(page, PAR2);
    await page.evaluate(p => document.querySelector(`[data-test=ref-pair-state][data-pair="${p}"]`)?.scrollIntoView({ block: 'center' }), PAR2);
    await s.shot('Контрагенты: пробная партия и обещанный день');
    if (!/^кандидат: в досье изготовителя нет · пробная партия заказана · пробная партия P\d+, обещана \d\d\.\d\d \d\d:\d\d$/.test(ordered.state)) fail(`пробная партия: «${ordered.state}»`);
    else ok(`контрагенты: «${ordered.state}»`);

    // расписание (G), вкладка «Материалы»: «Предложения» у планового заказа АФС — строки с баллом
    await s.closeAll();
    await page.keyboard.press('KeyG');
    await page.waitForSelector('[data-test=gantt-tab-mrp]', { timeout: 20_000 });
    await s.measure('Вкладка «Материалы»', () => page.click('[data-test=gantt-tab-mrp]'), 'mrp');
    // заказ пробной партии в пути: помечен, в потребность не идёт, «Отменить» — нельзя
    const trialPo = /пробная партия (P\d+), обещана/.exec(ordered.state)?.[1] ?? '';
    const tp = await page.evaluate(po => {
      const row = document.querySelector(`[data-test=mrp-po][data-po="${po}"]`);
      const view = window.__game.store.get().gantt.mrp;
      return {
        mark: row?.querySelector('[data-test=mrp-po-trial]')?.textContent ?? '',
        cancel: row?.querySelector('[data-test=mrp-cancel]')?.hasAttribute('disabled') ?? false,
        why: row?.querySelector('[data-test=mrp-cancel]')?.getAttribute('title') ?? '',
        transit: view.rows.some(r => r.transit.some(t => t.po === po)),
      };
    }, trialPo);
    await page.evaluate(po => document.querySelector(`[data-test=mrp-po][data-po="${po}"]`)?.scrollIntoView({ block: 'center' }), trialPo);
    await s.shot('Материалы: заказ пробной партии в пути');
    if (!trialPo || tp.mark.trim() !== '· пробная партия одобрения пары' || !tp.cancel || tp.why !== 'пробная партия одобрения пары — без неё одобрение не кончится' || tp.transit) fail(`заказ пробной партии ${trialPo}: ${JSON.stringify(tp)}`);
    else ok(`«Материалы»: ${trialPo} — «${tp.mark.trim()}», в потребность не идёт, «Отменить» — «${tp.why}»`);
    const at = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-test=mrp-planned-row]')];
      const r = rows.find(e => e.getAttribute('data-material') === 'mat.api.paracetamol') ?? rows[0];
      return r ? { material: r.getAttribute('data-material'), i: r.querySelector('[data-test=mrp-offers-open]')?.getAttribute('data-i') } : undefined;
    });
    if (!at?.i) {
      fail('«Материалы»: плановых заказов с «Предложениями» нет');
      return;
    }
    await page.evaluate(i => document.querySelector(`[data-test=mrp-offers-open][data-i="${i}"]`)?.scrollIntoView({ block: 'center' }), at.i);
    await s.measure('«Предложения»', () => page.click(`[data-test=mrp-offers-open][data-i="${at.i}"]`), 'offers');
    const offers = await page.evaluate(() =>
      [...document.querySelectorAll('[data-test=mrp-offers] [data-test=mrp-offer]')].map(r => ({ supplier: r.getAttribute('data-supplier'), score: Number(r.getAttribute('data-score')), cells: [...r.querySelectorAll('td')].map(td => td.textContent ?? '') })),
    );
    await page.evaluate(() => document.querySelector('[data-test=mrp-offers]')?.scrollIntoView({ block: 'center' }));
    await s.shot('Материалы: «Предложения» планового заказа');
    const fine = o => /₽$/.test(o.cells[1]) && /^\d\d\.\d\d$/.test(o.cells[2]) && /^\d+(,\d+)?\s?%/.test(o.cells[3]) && /^предоплата \d+(,\d+)?\s?%, остаток — через \d+ /.test(o.cells[4]) && o.score >= 0 && o.score <= 10_000;
    if (offers.length === 0 || !offers.every(fine)) fail(`предложения: ${JSON.stringify(offers)}`);
    else ok(`«Предложения» — ${at.material}: ${offers.map(o => `${o.cells[0]} — ${o.cells.slice(1, 6).join(' · ')}`).join(' | ')}`);

    // «Заказать» из предложений: окно «Заказ поставщику» с этим поставщиком и одной строкой планового заказа
    const first = offers[0];
    await s.measure('«Заказать» из предложений', () => page.click(`[data-test=mrp-offers] [data-test=mrp-offer][data-supplier="${first.supplier}"] [data-test=mrp-offer-order]`), 'po', [first.supplier, 1]);
    const form = await page.evaluate(() => ({ supplier: window.__game.store.get().po.supplier, lines: [...document.querySelectorAll('[data-test=po-line]')].map(e => e.getAttribute('data-material')), send: !document.querySelector('[data-test=po-send]')?.hasAttribute('disabled') }));
    await s.shot('«Заказ поставщику» из предложений');
    if (form.supplier !== first.supplier || form.lines.length !== 1 || form.lines[0] !== at.material || !form.send) fail(`окно заказа: ${JSON.stringify(form)}`);
    else ok(`окно заказа — ${form.supplier}: строка ${form.lines[0]}, «Отправить» доступна`);
    await s.closeAll();
    if (!long) return;

    // с `--long 1` — «До утра» до подачи изменения досье: на планёрке и в справочнике — день подачи (около 50 суток завода,
    // 11 минут сценария)
    let dossier;
    for (let i = 0; i < 160 && dossier?.step !== 'dossier'; i++) if (await s.untilMorning()) dossier = await meetingApp(page, PAR2);
    if (dossier?.step !== 'dossier') {
      fail(`планёрка: изменения досье нет за 160 «До утра» (${JSON.stringify(dossier)})`);
      return;
    }
    await page.evaluate(p => document.querySelector(`[data-test=morning-materials-app][data-pair="${p}"]`)?.scrollIntoView({ block: 'center' }), PAR2);
    await s.shot('Планёрка: изменение досье подано');
    if (!/^[^—]+, Парацетамол: изменение досье типа II подано — экспертиза · подано \d\d\.\d\d\.\d{4}$/.test(dossier.text)) fail(`планёрка: «${dossier.text}»`);
    else ok(`планёрка — ${await s.clock()}: «${dossier.text}»`);
    await s.partners();
    const filed = await pairRow(page, PAR2);
    await page.evaluate(p => document.querySelector(`[data-test=ref-pair-state][data-pair="${p}"]`)?.scrollIntoView({ block: 'center' }), PAR2);
    await s.shot('Контрагенты: изменение досье подано');
    if (!/^кандидат: в досье изготовителя нет · изменение досье типа II подано — экспертиза · подано \d\d\.\d\d\.\d{4}$/.test(filed.state)) fail(`изменение досье: «${filed.state}»`);
    else ok(`контрагенты: «${filed.state}»`);
    await s.closeAll();
  } finally {
    await ctx.close();
  }
}
