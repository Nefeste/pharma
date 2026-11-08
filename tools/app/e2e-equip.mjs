// Сценарий в браузере, часть «Оборудование» (Б7в; docs/specs/2026-10-vertical-slice.md, «Б7в», «Проверки Б7в»): чистое
// окно, место директора, B — стройка, инструмент «Оборудование». ВЭЖХ в лабораторию у отечественного поставщика — строка
// призрака с ценой, предоплатой и сроком, заказ — новый план; Ctrl+Z в тот же день — заказа нет. «Нельзя» — пресс в
// лабораторию. Карточка пресса — «Заменить» у азиатского поставщика. Обеспыливатель в таблетирование и его карточка — путь
// «заказано, поставка обещана …», «Отменить заказ» — единицы нет. Снова ВЭЖХ — имя следующее, hplc-3, — на планёрке строка «Оборудование». С
// `--long 1` — «До утра» до поставки и монтажа: таблетирование «не работает: монтаж», затем запись квалификации нового
// пресса. Снимки — tools/app/out/equip-*.png, лист — tools/app/out/equip.png.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, steps } from './e2e-build.mjs';

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string, long?: boolean }} x */
export async function equipPart({ browser, port, out, ok, fail, errors, requests, q, long = false }) {
  const shots = [];
  const feel = [];
  const started = Date.now();
  await director({ browser, port, out, ok, fail, errors, requests, q, shots, feel, long });
  ok(`Оборудование, отклик: ${feel.map(x => `${x.label} — ${x.f} кадр., ${x.ms} мс`).join('; ')}; часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1290, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,420px);gap:6px}figure{margin:0}img{width:420px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'equip.png'), fullPage: true });
  await lister.close();
  ok(`Оборудование: ${shots.length} снимков → ${join(out, 'equip.png')}`);
}

const MONEY = '[\\d\\s]+\\s₽';

async function director(x) {
  const { ok, fail, errors, long } = x;
  const { ctx, page } = await openGame(x);
  const s = steps(page, { ...x, prefix: 'equip' });
  const ghost = () => page.evaluate(() => document.querySelector('[data-test=build-ghost]')?.textContent ?? '');
  const result = () => page.evaluate(() => document.querySelector('[data-test=build-result]')?.textContent ?? '');
  const units = () => page.evaluate(() => {
    const p = window.__game.world.plan;
    return [...p.equipment, ...p.instruments, ...p.ipc, ...p.sensors].map(u => u.id);
  });
  /** Середина помещения — клетка. */
  const mid = id => page.evaluate(r => {
    const x = window.__game.world.plan.rooms.find(q => q.id === r).rect;
    return [Math.floor((x[0] + x[2] / 2) / 100), Math.floor((x[1] + x[3] / 2) / 100)];
  }, id);
  const closeAll = async () => {
    for (let k = 0; k < 8; k++) {
      const open = await page.evaluate(() => {
        const h = window.__game.store.get();
        return h.morning.open || h.sop.open || h.gantt.open || h.journal.open || !!h.selected || !!document.querySelector('#ref');
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
  const card = async (type, id) => {
    await closeAll();
    const i = await page.evaluate(([t, u]) => window.__game.world.plan[t].findIndex(e => e.id === u), [type, id]);
    await page.evaluate(k => window.__game.actions.select({ kind: 'equipment', i: k }), i);
    await page.waitForSelector('[data-test=card-equip], [data-test=card-path]', { timeout: 20_000 });
    return page.evaluate(() => document.querySelector('[data-test=card]')?.innerText.replace(/\s*\n\s*/g, ' · ') ?? '');
  };
  try {
    await s.seats(['director']);
    await page.keyboard.press('KeyB');
    await page.waitForFunction(() => window.__seen.panel(), null, { timeout: 20_000 });

    // ВЭЖХ в лабораторию у отечественного поставщика: строка призрака, заказ — новый план
    await page.click('[data-test=tool-unit]');
    await page.selectOption('[data-test=unit-class]', 'inst.hplc');
    await page.click('[data-test=vendor-ru]');
    const offer = await page.evaluate(() => document.querySelector('[data-test=vendor-ru]')?.textContent ?? '');
    const [lx, lz] = await mid('lab');
    const g1 = await s.hover(lx, lz);
    let rev = await s.rev();
    await s.measure('Заказ ВЭЖХ — новый план', () => page.mouse.down().then(() => page.mouse.up()), 'rev', rev + 1);
    await page.waitForFunction(re => new RegExp(re).test(document.querySelector('[data-test=build-result]')?.textContent ?? ''), '^Заказано — предоплата', { timeout: 20_000 }).catch(() => {});
    const r1 = await result();
    const u1 = await units();
    await s.shot('Заказ ВЭЖХ: строка призрака и ответ');
    if (!new RegExp(`^Хроматограф \\(ВЭЖХ\\), Отечественный поставщик — ${MONEY}, предоплата ${MONEY}, поставка 2–4 мес\\.$`).test(g1) || !/^Заказано — предоплата /.test(r1) || !u1.includes('hplc-2') || !/поставка 2–4 мес\./.test(offer)) fail(`заказ ВЭЖХ: призрак «${g1}», ответ «${r1}», поставщик «${offer}», единицы ${u1.join(', ')}`);
    else ok(`заказ: «${g1}» · «${r1}»`);

    // Ctrl+Z в тот же день — заказа нет, деньги назад
    rev = await s.rev();
    await s.measure('Ctrl+Z — отмена заказа в тот же день', () => page.keyboard.press('Control+KeyZ'), 'rev', rev + 1);
    const u2 = await units();
    if (u2.includes('hplc-2')) fail(`отмена в тот же день: ВЭЖХ на месте — ${u2.join(', ')}`);
    else ok('отмена стройки в тот же день: заказа ВЭЖХ нет');

    // «нельзя»: пресс в лабораторию
    await page.selectOption('[data-test=unit-class]', 'eq.press');
    const g2 = await s.hover(lx, lz);
    if (!/^Роторный таблеточный пресс: нельзя — Роторный таблеточный пресс в «.+» не ставят$/.test(g2)) fail(`пресс в лабораторию: «${g2}»`);
    else ok(`нельзя: «${g2}»`);

    // обеспыливатель в таблетирование — первая клетка, где его пускают
    await page.selectOption('[data-test=unit-class]', 'eq.deduster');
    const comp = await page.evaluate(() => window.__game.world.plan.rooms.find(q => q.id === 'compression').rect.map(v => v / 100));
    let placed = '';
    for (let z = comp[1] + 1; z < comp[1] + comp[3] - 1 && !placed; z++) {
      for (let cx = comp[0] + 1; cx < comp[0] + comp[2] - 1; cx++) {
        const g = await s.hover(cx, z);
        if (/^Обеспыливатель с металлодетектором, Отечественный поставщик — /.test(g)) {
          placed = g;
          break;
        }
      }
    }
    rev = await s.rev();
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(r => window.__game.world.rev === r, rev + 1, { timeout: 20_000 }).catch(() => {});
    await s.frames(3);
    await s.shot('Обеспыливатель в таблетировании: заказан');
    const ded = (await units()).find(id => /^deduster-\d+$/.test(id) && id !== 'deduster-1');
    if (!placed || !ded) fail(`обеспыливатель: призрак «${placed}», единица ${ded}`);
    else ok(`обеспыливатель: «${placed}» → ${ded}`);
    await page.keyboard.press('KeyB');

    // его карточка: путь «заказано, поставка обещана …»; «Отменить заказ» — единицы нет
    if (ded) {
      const c1 = await card('equipment', ded);
      await s.shot('Карточка заказанного обеспыливателя');
      if (!/Оборудование · .*поставщик — Отечественный поставщик · заказано · поставка обещана \d\d\.\d\d\.\d{4}/i.test(c1)) fail(`карточка заказанного: «${c1}»`);
      else ok(`карточка: «${c1.match(/Оборудование · .*?поставка обещана \d\d\.\d\d\.\d{4}/i)?.[0]}»`);
      await page.click('[data-test=card-equip-cancel]');
      await page.waitForFunction(id => !window.__game.world.plan.equipment.some(e => e.id === id), ded, { timeout: 20_000 }).catch(() => {});
      const gone = !(await units()).includes(ded);
      if (!gone) fail(`«Отменить заказ»: ${ded} на месте`);
      else ok(`«Отменить заказ»: ${ded} ушёл из плана, предоплата — у поставщика`);
    }

    // карточка пресса: «Заменить» у азиатского поставщика
    const c2 = await card('equipment', 'press-1');
    await page.selectOption('[data-test=card-equip-vendor]', 'ven.asia');
    const label = await page.evaluate(() => document.querySelector('[data-test=card-equip-replace]')?.textContent ?? '');
    await page.click('[data-test=card-equip-replace]');
    await page.waitForFunction(() => /Заказано — предоплата/.test(window.__game.notices?.[0]?.text ?? ''), null, { timeout: 20_000 }).catch(() => {});
    const n2 = await page.evaluate(() => window.__game.notices?.[0]?.text ?? '');
    await s.shot('Карточка пресса: заменить у азиатского поставщика');
    if (!/поставщик — Отечественный поставщик/.test(c2) || !new RegExp(`^Заменить: Азиатский поставщик — ${MONEY}$`).test(label) || !/^Заказано — предоплата /.test(n2)) fail(`замена пресса: карточка «${c2}», кнопка «${label}», извещение «${n2}»`);
    else ok(`замена пресса: «${label}» · «${n2}»`);
    await closeAll();

    // снова ВЭЖХ, теперь — до планёрки: строка «Оборудование»
    await page.keyboard.press('KeyB');
    await page.waitForFunction(() => window.__seen.panel(), null, { timeout: 20_000 });
    await page.selectOption('[data-test=unit-class]', 'inst.hplc');
    await s.hover(lx, lz);
    await page.mouse.down();
    await page.mouse.up();
    // имя — следующее по счётчику: отмена его не возвращает, имена не повторяются
    await page.waitForFunction(() => window.__game.world.plan.instruments.some(e => /^hplc-\d+$/.test(e.id) && e.id !== 'hplc-1' && e.id !== 'hplc-2'), null, { timeout: 20_000 }).catch(() => {});
    await page.keyboard.press('KeyB');
    let row = '';
    for (let i = 0; i < 3 && !row; i++) if (await untilMorning()) row = await page.evaluate(() => document.querySelector('[data-test=morning-units]')?.textContent ?? '');
    await s.shot('Планёрка: строка «Оборудование»');
    if (!/^Оборудование: (Хроматограф \(ВЭЖХ\) hplc-3|Роторный таблеточный пресс press-2) — поставка обещана \d\d\.\d\d\.\d{4}; (Хроматограф \(ВЭЖХ\) hplc-3|Роторный таблеточный пресс press-2) — поставка обещана \d\d\.\d\d\.\d{4}$/.test(row)) fail(`планёрка: «${row}»`);
    else ok(`планёрка: «${row}»`);
    await closeAll();

    if (long) {
      // «До утра» до поставки пресса и монтажа: таблетирование не работает — монтаж; затем — запись квалификации
      let mounting = '';
      for (let i = 0; i < 160 && !mounting; i++) {
        if (!(await untilMorning())) continue;
        mounting = await page.evaluate(() => (window.__game.store.get().morning.view?.units ?? []).find(u => u.id === 'press-2' && u.step === 'install')?.id ?? '');
      }
      await closeAll();
      await page.keyboard.press('KeyB');
      await page.waitForFunction(() => window.__seen.panel(), null, { timeout: 20_000 });
      await s.frames(3);
      const lab = await page.evaluate(() => document.querySelector('[data-test=labels] [data-room="compression"] span')?.textContent ?? '');
      await s.shot('Таблетирование на монтаже');
      if (!mounting || !/^не работает: монтаж: Роторный таблеточный пресс press-2$/.test(lab)) fail(`монтаж: «${lab}» (${mounting}) — ${await s.clock()}`);
      else ok(`монтаж — ${await s.clock()}: «${lab}»`);
      await page.keyboard.press('KeyB');
      let ready = false;
      for (let i = 0; i < 120 && !ready; i++) {
        if (!(await untilMorning())) continue;
        ready = await page.evaluate(() => window.__game.world.plan.equipment.some(e => e.id === 'press-2') && !!window.__game.store.get().morning.view && !window.__game.store.get().morning.view.units.some(u => u.id === 'press-2'));
      }
      const c3 = ready ? await card('equipment', 'press-2') : '';
      await s.shot('Новый пресс: квалификация принята');
      if (!ready || !/поставщик — Азиатский поставщик/i.test(c3) || /заказано|монтаж|IQ —|OQ —|PQ —/.test(c3)) fail(`новый пресс: «${c3}» — ${await s.clock()}`);
      else ok(`новый пресс работает — ${await s.clock()}`);
      await closeAll();
    }
    if (errors.length) fail(`ошибки страницы: ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await ctx.close();
  }
}
