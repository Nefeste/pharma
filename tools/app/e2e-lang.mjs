// Сценарий в браузере, часть «Языки» (Б12, шаг 2; docs/specs/2026-10-vertical-slice.md, «Б12», «Проверки Б12»): чистое окно
// прототипа на русском и английском, при 1920 × 1080, 2560 × 1440 и 3840 × 2160 (наименьший экран — Full HD, решение
// владельца 20.11.2026) — планёрка и каждое окно и вкладка по очереди; в
// каждом — переполнения окна (src/app/overflow.ts): текст шире коробки и обрезан не многоточием. Ноль — условие прохода.
// С Б13 — при трёх масштабах интерфейса каждого экрана (`SCALES`).
// Снимки — tools/app/out/lang-<язык>-<ширина>.png, лист — tools/app/out/lang.png (английский).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SIZES = [
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
];
/**
 * Масштабы интерфейса каждого экрана (Б13, шаг 1): наименьший, первого запуска и наибольший, что помещает панели
 * (src/app/scale.ts, `MIN_VIEW`); первый — тот, с которым окно открылось.
 */
const SCALES = { 1920: [1, 0.75, 1.5], 2560: [1.25, 0.75, 2], 3840: [1.5, 0.75, 2] };
const LANGS = ['ru', 'en'];
/** Окна по очереди: открыть, подождать вид, измерить, закрыть. */
const WINDOWS = [
  ['склад', g => g.actions.toggleStock()],
  ['касса', g => g.actions.toggleCash()],
  ['лаборатория', g => g.actions.toggleLab()],
  ['сейчас', g => g.actions.toggleNow()],
  ['журнал', g => g.actions.toggleJournal()],
  ['показатели', g => g.actions.toggleKpi()],
  ['политики', g => g.actions.togglePolicies()],
  ['S&OP', g => g.actions.toggleSop()],
  ['портфель', g => g.actions.togglePortfolio()],
  ['хроника', g => g.actions.toggleChronicle()],
  ['автопаузы', g => g.actions.togglePauses()],
  ['настройки', g => g.actions.toggleSettings()],
];
const GANTT_TABS = [undefined, 'jobs', 'launch', 'forecast', 'mrp'];
const REF_TABS = ['products', 'materials', 'recipes', 'equipment', 'places', 'lab', 'people', 'partners', 'docs'];

/** @param {{ browser: import('playwright-core').Browser, port: number, out: string, ok: (m: string) => void, fail: (m: string) => void, errors: string[], requests: string[], q: string }} x */
export async function langPart(x) {
  const { browser, port, out, ok, fail, q } = x;
  const started = Date.now();
  const shots = [];
  for (const lang of LANGS)
    for (const [w, h] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      const label = `${lang} ${w}×${h}`;
      const found = new Map();
      const take = async where => {
        await page.waitForTimeout(700);
        for (const o of await page.evaluate(() => window.__overflow?.() ?? ['нет __overflow'])) if (!found.has(o)) found.set(o, where);
      };
      try {
        await page.goto(`http://127.0.0.1:${port}/index.html?q=${q}&lang=${lang}&scn=scn.proto`);
        await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
        await page.click('[data-test=seat-tile][data-seat=director]');
        await page.click('[data-test=seats-take]');
        // планёрка вторых суток: в ней уже есть вчера
        await page.evaluate(() => window.__game.actions.untilMorning());
        await page.waitForFunction(() => !window.__game.ff && window.__game.store.get().morning.open, null, { timeout: 180_000 });
        await page.evaluate(() => window.__game.store.get().morning.day !== undefined && window.__game.actions.closeMorning(false));
        await page.evaluate(() => window.__game.actions.untilMorning());
        await page.waitForFunction(() => !window.__game.ff && window.__game.store.get().morning.open && !!window.__game.store.get().morning.view, null, { timeout: 180_000 });
        await take('полоса и планёрка');
        await page.screenshot({ path: join(out, `lang-${lang}-${w}.png`) });
        shots.push({ file: join(out, `lang-${lang}-${w}.png`), label });
        await page.evaluate(() => window.__game.actions.closeMorning(false));
        const first = await page.evaluate(() => window.__game.store.get().settings.scale);
        if (first !== SCALES[w][0]) found.set(`масштаб первого запуска ${first}, а не ${SCALES[w][0]}`, 'настройки');
        for (const k of SCALES[w]) {
          const at = `${Math.round(k * 100)} %`;
          await page.evaluate(v => window.__game.actions.setScale(v), k);
          if (k !== SCALES[w][0]) {
            await page.evaluate(() => window.__game.actions.openMorning());
            await page.waitForFunction(() => !!window.__game.store.get().morning.view, null, { timeout: 30_000 });
            await take(`${at} · полоса и планёрка`);
            await page.evaluate(() => window.__game.actions.closeMorning(false));
          }
          for (const [name, open] of WINDOWS) {
            await page.evaluate(`(${open.toString()})(window.__game)`);
            await take(`${at} · ${name}`);
            await page.evaluate(`(${open.toString()})(window.__game)`);
          }
          await page.evaluate(() => window.__game.actions.toggleGantt());
          for (const t of GANTT_TABS) {
            await page.evaluate(tab => window.__game.actions.ganttTab(tab), t);
            await take(`${at} · расписание${t ? ` · ${t}` : ''}`);
          }
          await page.evaluate(() => window.__game.actions.toggleGantt());
          await page.evaluate(() => window.__game.actions.toggleRef());
          for (const t of REF_TABS) {
            await page.evaluate(tab => window.__game.actions.setRefTab(tab), t);
            await take(`${at} · справочник · ${t}`);
          }
          await page.evaluate(() => window.__game.actions.toggleRef());
          // наибольший масштаб — снимок с планёркой
          if (k === Math.max(...SCALES[w])) {
            await page.evaluate(() => window.__game.actions.openMorning());
            await page.waitForFunction(() => !!window.__game.store.get().morning.view, null, { timeout: 30_000 });
            await page.waitForTimeout(500);
            await page.screenshot({ path: join(out, `lang-${lang}-${w}-${Math.round(k * 100)}.png`) });
            shots.push({ file: join(out, `lang-${lang}-${w}-${Math.round(k * 100)}.png`), label: `${label}, ${at}` });
            await page.evaluate(() => window.__game.actions.closeMorning(false));
          }
        }
      } catch (e) {
        fail(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (found.size === 0) ok(`${label}: переполнений нет`);
      else fail(`${label}: переполнений ${found.size} — ${[...found].slice(0, 30).map(([o, where]) => `${where}: ${o}`).join(' | ')}`);
      await ctx.close();
    }
  // сценарий 1 при 1920: в полосе — «Письма» и «Цели», их окна
  for (const lang of LANGS) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    const label = `${lang} 1920×1080, сценарий 1`;
    const found = new Map();
    const take = async where => {
      await page.waitForTimeout(700);
      for (const o of await page.evaluate(() => window.__overflow?.() ?? ['нет __overflow'])) if (!found.has(o)) found.set(o, where);
    };
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html?q=${q}&lang=${lang}&scn=scn.c1`);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
      await page.click('[data-test=seat-tile][data-seat=director]');
      await page.click('[data-test=seats-take]');
      await page.waitForFunction(() => window.__game.store.get().letters.open, null, { timeout: 30_000 }).catch(() => undefined);
      await take('письма');
      await page.evaluate(() => window.__game.store.get().letters.open && window.__game.actions.toggleLetters());
      await page.evaluate(() => window.__game.actions.toggleGoals());
      await take('цели');
      await page.evaluate(() => window.__game.actions.toggleGoals());
      await take('полоса');
    } catch (e) {
      fail(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (found.size === 0) ok(`${label}: переполнений нет`);
    else fail(`${label}: переполнений ${found.size} — ${[...found].slice(0, 30).map(([o, where]) => `${where}: ${o}`).join(' | ')}`);
    await ctx.close();
  }
  ok(`Языки: часть — ${((Date.now() - started) / 60000).toFixed(1)} мин`);
  const cells = shots.map(c => `<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('');
  const lister = await browser.newPage({ viewport: { width: 1940, height: 800 } });
  await lister.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(3,640px);gap:6px}figure{margin:0}img{width:640px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`);
  await lister.screenshot({ path: join(out, 'lang.png'), fullPage: true });
  await lister.close();
  ok(`Языки: ${shots.length} снимков → ${join(out, 'lang.png')}`);
}
