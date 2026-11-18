// Сценарий в браузере, часть «Портфель» (Б7д; docs/specs/2026-10-vertical-slice.md, «Б7д», «Проверки Б7д»): чистое
// окно, место директора, F — окно «Портфель». Метформин и ибупрофен — «не производится», «Начать проект» — этап
// «готовность завода» и «чего нет заводу»: помещения покрытия, пары поставщика; «Контрагенты» — справочник на вкладке;
// решение протокола — «продать». «До утра» — на планёрке блок «Проекты», «Открыть портфель». «Стройка» — стройка
// открыта. «Остановить» — проекта нет, «Начать проект» снова. С `--long 1` — помещение покрытия, коатер и весы
// командами стройки и оборудования (их окно проверяют части «Стройка» и «Оборудование»), «До утра», пока проект не
// дойдёт до пробной серии: её строка в окне и в досье — «пробная серия проекта P2, не для продажи». Снимки —
// tools/app/out/portfolio-*.png, лист — tools/app/out/portfolio.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, steps } from './e2e-build.mjs';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string, long?: boolean }} x */
export async function portfolioPart({ browser, port, out, ok, fail, errors, requests, q, long = false }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  await director({ browser, port, out, ok, fail, errors, requests, q, shots, feel, long });
  ok(`Портфель, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'portfolio.png'), fullPage: true });
  await lister.close();
  ok(`Портфель: ${shots.length} снимков → ${join(out, 'portfolio.png')}`);
}

const MET = 'prd.metformin500';

async function director(x) {
  const { ok, fail, errors, long } = x;
  const { ctx, page } = await openGame(x);
  const s = steps(page, { ...x, prefix: 'portfolio' });
  await page.evaluate(() => {
    const row = () => document.querySelector('[data-test=portfolio-row][data-product="prd.metformin500"]');
    Object.assign(window.__seen, {
      // окно «Портфель» с видом
      portfolio: () => !!window.__game.store.get().portfolio.view && !!row(),
      // проект метформина на этапе; `none` — проекта нет, «Начать проект» снова есть
      stage: st => (st === 'none' ? !row()?.querySelector('[data-test=portfolio-project]') && !!row()?.querySelector('[data-test=portfolio-start]') : row()?.querySelector('[data-test=portfolio-project]')?.dataset.stage === st),
      sell: v => row()?.querySelector('[data-test=portfolio-sell]')?.dataset.sell === v,
      ref: tab => !!document.querySelector('#ref') && window.__game.store.get().ref.tab === tab,
    });
  });
  const text = sel => page.evaluate(q => document.querySelector(q)?.innerText.replace(/\s*\n\s*/g, ' · ') ?? '', sel);
  const closeAll = async () => {
    for (let k = 0; k < 8; k++) {
      const open = await page.evaluate(() => {
        const h = window.__game.store.get();
        return h.morning.open || h.sop.open || h.portfolio.open || h.gantt.open || h.dossier.open || !!h.selected || !!document.querySelector('#ref');
      });
      if (!open) return;
      await page.keyboard.press('Escape');
      await s.frames(1);
    }
  };
  const untilMorning = async () => {
    await closeAll();
    await page.keyboard.press('Digit5');
    await page.waitForFunction(() => !window.__game.ff, null, { timeout: 180_000 });
    await s.frames(1);
    const open = await page.evaluate(() => window.__game.store.get().morning.open);
    if (open) await page.waitForFunction(() => !!window.__game.store.get().morning.view, null, { timeout: 20_000 });
    return open;
  };
  const openPortfolio = async label => {
    await closeAll();
    await s.measure(label, () => page.keyboard.press('KeyF'), 'portfolio', undefined, 'input');
  };
  try {
    await s.seats(['director']);

    // F — окно: метформин «не производится», чего нет заводу ещё не считают — проекта нет
    await openPortfolio('F — окно «Портфель»');
    const r0 = await text('[data-test=portfolio-row][data-product="prd.metformin500"]');
    await s.shot('Портфель: метформин — не производится');
    if (!/Метформин/.test(r0) || !/не производится/.test(r0) || !/Начать проект/.test(r0)) fail(`портфель до проекта: «${r0}»`);
    else ok(`портфель: «${r0}»`);
    // ибупрофен (Б7д, шаг 3) — второй продукт-проект, тоже «не производится»
    const ri = await text('[data-test=portfolio-row][data-product="prd.ibuprofen200"]');
    if (!/Ибупрофен/.test(ri) || !/не производится/.test(ri) || !/Начать проект/.test(ri)) fail(`портфель, ибупрофен: «${ri}»`);
    else ok(`портфель, ибупрофен: «${ri}»`);

    // «Начать проект» — готовность завода и чего нет: помещения покрытия, пары поставщика
    await s.measure('«Начать проект»', () => page.click('[data-test=portfolio-start]'), 'stage', 'ready');
    await page.waitForSelector('[data-test=portfolio-gap]', { timeout: 20_000 });
    const gaps = await page.evaluate(() => [...document.querySelectorAll('[data-test=portfolio-gap]')].map(g => g.dataset.kind));
    const r1 = await text('[data-test=portfolio-row][data-product="prd.metformin500"]');
    await s.shot('Проект начат: готовность завода, чего нет');
    if (!gaps.includes('room') || !gaps.includes('pair') || !/готовность завода — с /.test(r1) || !/помещения «Покрытие/.test(r1)) fail(`проект начат: чего нет ${gaps.join(', ')} — «${r1}»`);
    else ok(`проект начат: чего нет — ${gaps.join(', ')}`);

    // решение протокола заранее — «продать»
    await s.measure('Протокол: «продать»', () => page.click('[data-test=portfolio-sell-yes]'), 'sell', 'true');
    ok('решение протокола: продать серии валидации');

    // «Контрагенты» — справочник на вкладке, где «Одобрить пару»
    await s.measure('«Контрагенты» из «чего нет»', () => page.click('[data-test=portfolio-go][data-kind=pair]'), 'ref', 'partners', 'input');
    await s.shot('Справочник: контрагенты');
    ok('переход к паре: справочник, вкладка «Контрагенты»');

    // «До утра» — на планёрке «Проекты»
    if (!(await untilMorning())) fail('планёрка не открылась');
    const m = await text('[data-test=morning-projects]');
    await s.shot('Планёрка: проекты');
    if (!/Метформин/.test(m) || !/готовность завода/.test(m) || !/ждёт, пока у завода будет всё/.test(m)) fail(`планёрка, проекты: «${m}»`);
    else ok(`планёрка: «${m}»`);
    await s.measure('Планёрка — «Открыть портфель»', () => page.click('[data-test=morning-projects-open]'), 'portfolio', undefined, 'input');

    // «Стройка» из «чего нет» — стройка открыта
    await s.measure('«Стройка» из «чего нет»', () => page.click('[data-test=portfolio-go][data-kind=room]'), 'panel', undefined, 'input');
    await s.shot('Стройка из портфеля');
    ok('переход к помещению: стройка');
    await page.keyboard.press('KeyB');
    await s.frames(2);

    // «Остановить» — проекта нет, начать можно снова
    await openPortfolio('F — окно снова');
    await s.measure('«Остановить»', () => page.click('[data-test=portfolio-stop]'), 'stage', 'none');
    const r2 = await text('[data-test=portfolio-row][data-product="prd.metformin500"]');
    if (!/остановлено проектов: 1/.test(r2)) fail(`проект остановлен: «${r2}»`);
    else ok(`проект остановлен: «${r2}»`);

    if (long) await trial({ page, s, ok, fail, untilMorning, openPortfolio, text });
    if (errors.length > 0) fail(`ошибки в консоли: ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await ctx.close();
  }
}

/**
 * С `--long 1`: помещение покрытия к востоку от корпуса, коатер и весы — командами; проект заново и «До утра», пока не
 * пойдёт пробная серия; её строка в окне и назначение в досье.
 */
async function trial({ page, s, ok, fail, untilMorning, openPortfolio, text }) {
  const send = cmd => page.evaluate(c => window.__game.send(c), cmd);
  for (const op of [
    { op: 'hull', rect: [59, 1, 12, 12] },
    { op: 'room', type: 'corridor.clean', grade: 'D', rect: [59, 9, 12, 4] },
    { op: 'room', type: 'coating', grade: 'D', rect: [59, 1, 8, 9] },
    { op: 'door', cell: [59, 10], len: 2, along: 'z', kind: 'double' },
    { op: 'door', cell: [62, 9], len: 2, along: 'x', kind: 'double' },
    { op: 'done' },
  ]) {
    const rev = await s.rev();
    await send({ kind: 'site', op });
    if (op.op !== 'done') await page.waitForFunction(r => window.__game.world.rev > r, rev, { timeout: 20_000 });
  }
  await s.frames(2);
  const room = await page.evaluate(() => window.__game.world.plan.rooms.find(r => r.type === 'coating')?.id);
  await send({ kind: 'equip', op: { op: 'buy', type: 'eq.coater', vendor: 'ven.ru', room, at: [6150, 350], turn: 0 } });
  await send({ kind: 'equip', op: { op: 'buy', type: 'inst.balance', vendor: 'ven.ru', room } });
  await openPortfolio('F — проект заново');
  await s.measure('«Начать проект» заново', () => page.click('[data-test=portfolio-start]'), 'stage', 'ready');
  const stage = () => page.evaluate(() => window.__game.store.get().portfolio.view?.rows.find(r => r.product === 'prd.metformin500')?.project?.stage);
  let st;
  for (let d = 0; d < 400; d++) {
    await untilMorning();
    await openPortfolio(`F — день ${d + 1}`);
    st = await stage();
    if (st !== 'ready' && st !== 'methods' && st !== 'docs' && st !== 'clean') break;
    if (d % 30 === 29) ok(`день ${d + 1}: проект — ${st}`);
  }
  const row = await text('[data-test=portfolio-row][data-product="prd.metformin500"]');
  await s.shot('Пробная серия проекта');
  if (st !== 'trial' || !/пробная/.test(row)) fail(`пробная серия: этап ${st} — «${row}»`);
  else ok(`пробная серия: «${row}»`);
  // досье пробной серии — назначение
  const b = await page.$('[data-test=portfolio-batch][data-role=trial] button');
  if (b) {
    await b.click();
    await page.waitForFunction(() => !!window.__game.store.get().dossier.view, null, { timeout: 20_000 });
    const d = await text('#dossier');
    await s.shot('Досье пробной серии');
    if (!/пробная серия проекта P2, не для продажи/.test(d)) fail(`досье пробной: «${d.slice(0, 300)}»`);
    else ok('досье пробной серии: не для продажи');
  } else fail('строки пробной серии нет');
}
