// Сценарий в браузере, часть «Маршрут» (Б7г; docs/specs/2026-10-vertical-slice.md, «Б7г», «Проверки Б7г»): чистое окно,
// место директора. Второе таблетирование к востоку от корпуса и его пресс, обеспыливатель и приборы МОК — командами
// стройки и «Оборудования» (как в частях «Стройка» и «Оборудование» — мышью, здесь — заготовка). Досье серии — блок
// «Маршрут»: выбор единицы таблетирования — новый пресс, запись журнала «вы». Расписание: полоса таблетирования другой
// серии — мышью на строку второго таблетирования, строка черновика, «Утвердить» — маршрут в досье. Перенос полупродукта
// виден задачей аппаратчика в срезе. Снимки — tools/app/out/route-*.png, лист — tools/app/out/route.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, steps } from './e2e-build.mjs';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function routePart({ browser, port, out, ok, fail, errors, requests, q }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  await director({ browser, port, out, ok, fail, errors, requests, q, shots, feel });
  ok(`Маршрут, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'route.png'), fullPage: true });
  await lister.close();
  ok(`Маршрут: ${shots.length} снимков → ${join(out, 'route.png')}`);
}

/** Второе таблетирование: продолжение корпуса, чистый коридор, помещение, две двери (клетки — как в tools/test/route.test.ts). */
const SITE = [
  { op: 'hull', rect: [59, 1, 12, 12] },
  { op: 'room', type: 'corridor.clean', grade: 'D', rect: [59, 9, 12, 4] },
  { op: 'room', type: 'compression', grade: 'D', rect: [59, 1, 8, 9] },
  { op: 'door', cell: [59, 10], len: 2, along: 'z', kind: 'double' },
  { op: 'door', cell: [62, 9], len: 2, along: 'x', kind: 'double' },
  { op: 'done' },
];

/** Единицы второго таблетирования: пресс и обеспыливатель — на места пола, приборы МОК — в помещение. */
const UNITS = [
  { type: 'eq.press', at: [6150, 250] },
  { type: 'eq.deduster', at: [6350, 650] },
  { type: 'inst.balance' },
  { type: 'inst.hardness' },
  { type: 'inst.friabilator' },
  { type: 'inst.disintegration' },
];

async function director(x) {
  const { ok, fail, errors } = x;
  const { ctx, page } = await openGame(x);
  const s = steps(page, { ...x, prefix: 'route' });
  const room = () => page.evaluate(() => window.__game.world.plan.rooms.find(r => r.type === 'compression' && r.id !== 'compression')?.id);
  const send = cmd => page.evaluate(c => window.__game.client.command(c), cmd);
  try {
    await s.seats(['director']);
    for (const op of SITE) await send({ kind: 'site', op });
    await page.waitForFunction(() => window.__game.world.plan.rooms.some(r => r.type === 'compression' && r.id !== 'compression'), null, { timeout: 20_000 });
    const id = await room();
    for (const u of UNITS) await send({ kind: 'equip', op: { op: 'buy', type: u.type, vendor: 'ven.ru', room: id, ...(u.at ? { at: u.at, turn: 0 } : {}) } });
    await page.waitForFunction(r => window.__game.world.plan.equipment.filter(e => e.room === r).length === 2, id, { timeout: 20_000 });
    const press = await page.evaluate(r => window.__game.world.plan.equipment.find(e => e.room === r && e.type === 'eq.press')?.id, id);
    if (!press) throw new Error('пресса во втором таблетировании нет');
    ok(`Маршрут: второе таблетирование ${id} и пресс ${press} — в плане`);
    await s.shot('второе таблетирование');

    // досье серии, которая ещё не таблетировала: «Маршрут» — выбор единицы
    await page.keyboard.press('KeyG');
    await page.waitForSelector('[data-test=gantt] [data-test=gbar][data-kind=stage]', { timeout: 30_000 });
    const target = await page.evaluate(() => {
      const v = window.__game.store.get().gantt.view;
      const ids = Object.keys(v.routable).filter(b => v.routable[b].compress);
      return ids.length > 0 ? { batch: ids[0], n: v.batches[ids[0]].n, other: ids[1] } : undefined;
    });
    if (!target) throw new Error('у серий окна нет выбора единицы таблетирования');
    await page.keyboard.press('Escape');
    await page.evaluate(k => window.__game.actions.openDossier(k), target.n);
    await page.waitForSelector('[data-test=dossier-stage][data-stage=compress] [data-test=dossier-route-pick]', { timeout: 20_000 });
    await page.selectOption('[data-test=dossier-stage][data-stage=compress] [data-test=dossier-route-pick]', press);
    await page.waitForFunction(
      p => document.querySelector('[data-test=dossier-stage][data-stage=compress] [data-test=dossier-route]')?.textContent?.includes(p),
      press,
      { timeout: 20_000 },
    );
    const line = await page.evaluate(() => document.querySelector('[data-test=dossier-stage][data-stage=compress] [data-test=dossier-route]')?.textContent ?? '');
    if (!/выбрали вы/.test(line)) fail(`Маршрут: в досье нет «выбрали вы» — «${line}»`);
    else ok(`Маршрут: досье — «${line.slice(0, 90)}»`);
    await s.shot('досье: маршрут таблетирования');

    // расписание: полоса таблетирования другой серии — на строку второго таблетирования, «Утвердить»
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyG');
    await page.waitForSelector('[data-test=gantt] [data-test=gbar][data-kind=stage]', { timeout: 30_000 });
    const other = await page.evaluate(() => {
      const v = window.__game.store.get().gantt.view;
      return Object.keys(v.routable).find(b => v.routable[b].compress && v.bars.some(x => x.batch === b && x.stage === 'compress' && x.row === 'compression'));
    });
    if (other) {
      const bar = await page.$(`[data-test=gantt-row][data-row=compression] [data-test=gbar][data-batch=${other}][data-kind=stage]`);
      const to = await page.$(`[data-test=gantt-row][data-row=${id}] .gtrack`);
      const a = await bar?.boundingBox();
      const b = await to?.boundingBox();
      if (a && b) {
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(a.x + a.width / 2, b.y + b.height / 2, { steps: 6 });
        await page.mouse.up();
        await page.waitForFunction(() => (window.__game.store.get().gantt.routes ?? []).length > 0, null, { timeout: 10_000 });
        const list = await page.evaluate(() => document.querySelector('[data-test=draft-list]')?.textContent ?? '');
        ok(`Маршрут: черновик расписания — «${list.slice(0, 90)}»`);
        await s.shot('расписание: стадия на второе таблетирование');
        await page.click('[data-test=draft-approve]');
        await page.waitForFunction(() => (window.__game.store.get().gantt.routes ?? []).length === 0, null, { timeout: 10_000 });
        ok('Маршрут: «Утвердить» — черновик маршрута ушёл командой');
      } else fail('Маршрут: нет полосы таблетирования или строки второго помещения на экране');
    } else ok('Маршрут: второй серии с таблетированием в окне нет — перетаскивание пропущено');

    // перенос полупродукта: строка «Сейчас» — аппаратчик везёт контейнер
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyN');
    await page.evaluate(() => window.__game.actions.setSpeed(4));
    const carry = await page.waitForSelector('#now [data-test=now-row][data-kind=carry]', { timeout: 240_000 }).then(
      r => r.evaluate(e => e.innerText.replace(/\s+/g, ' ').trim()),
      () => '',
    );
    await page.evaluate(() => window.__game.actions.setSpeed(0));
    if (carry) ok(`Маршрут: «Сейчас» — «${carry.slice(0, 90)}»`);
    else fail('Маршрут: строки переноса в «Сейчас» нет за 4 минуты на ×4');
    await s.shot('перенос');
    if (errors.length > 0) fail(`Маршрут: ошибки страницы — ${errors.slice(0, 3).join(' | ')}`);
  } catch (e) {
    fail(`Маршрут: ${e instanceof Error ? e.message : e}`);
    await s.shot('ошибка').catch(() => undefined);
  } finally {
    await ctx.close();
  }
}
