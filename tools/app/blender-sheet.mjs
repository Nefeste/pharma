// Лист «код сейчас — Blender» (#109, docs/reports/2026-11-blender-pilot.md): компрессионная — пресс и пол — на высотах
// машины, цеха и участка, днём и ночью, на среднем пресете, и машина днём на низком и высоком; слева модели кодом,
// справа — из Blender, в одном и том же мгновении завода (мир на паузе, пресс работает). Под каждым снимком — вызовы
// отрисовки и треугольники кадра. Снимки — `stage.shot`, как у бенча сцены; программный WebGL — о процессоре контейнера,
// не о видеокарте игрока.
//   npm run build && node tools/app/blender-sheet.mjs [--out tools/app/out] [--size 960x540]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findChromium } from './e2e-lib.mjs';
import { serve } from './serve.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const out = arg('out', new URL('./out/', import.meta.url).pathname);
const [W, H] = arg('size', '960x540').split('x').map(Number);
mkdirSync(out, { recursive: true });
const port = 8096;
const server = await serve(port);
const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?q=medium&lang=ru`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120_000 });

// директором: экран «Кем вы будете» не заслоняет снимки; ×4, пока пресс не заработает, — и пауза
await page.evaluate(() => {
  window.__game.actions.pickSeat('director');
  window.__game.actions.takeSeats();
});
const press = await page.evaluate(() => window.__game.layout.plan.plant.equipment.findIndex(e => e.type === 'eq.press'));
for (let i = 0; i < 400; i++) {
  const st = await page.evaluate(k => {
    const g = window.__game;
    if (g.store.get().morning.open) g.actions.closeMorning(false);
    if (g.speed === 0) g.actions.setSpeed(4);
    return { lamp: g.stage.machines.lamps[k], t: g.t };
  }, press);
  if (st.lamp === 'run') break;
  if (st.t > 12 * 86400) throw new Error('пресс не заработал за 12 суток');
  await page.waitForTimeout(500);
}
await page.evaluate(() => window.__game.actions.setSpeed(0));
const when = await page.evaluate(() => ({ day: window.__game.day, hour: ((window.__game.t % 86400) / 3600).toFixed(1) }));
console.log(`пресс работает: сутки ${when.day + 1}, ${when.hour} ч`);

const ROOM = { x: 52, z: 5, half: 6.5 };
const MACHINE = { x: 51.2, z: 4.2, half: 1.9 };
const views = [
  ['машина', MACHINE, 1, 'medium', 12],
  ['машина', MACHINE, 1, 'medium', 22],
  ['цех', ROOM, 1, 'medium', 12],
  ['цех', ROOM, 1, 'medium', 22],
  ['участок', null, 3, 'medium', 12],
  ['машина', MACHINE, 1, 'low', 12],
  ['машина', MACHINE, 1, 'high', 12],
];
const shots = [];
const stats = [];
for (const [name, cam, level, q, hour] of views) {
  for (const art of ['code', 'blender']) {
    const r = await page.evaluate(
      async ([cam, level, q, hour, art, W, H]) => {
        const g = window.__game;
        if (g.store.get().art !== art) g.actions.setArt(art);
        await new Promise(res => setTimeout(res, 100));
        if (g.stage.quality !== q) g.actions.setQuality(q);
        const c = g.stage.cam;
        if (cam) {
          c.target.set(cam.x, 0, cam.z);
          c.half = cam.half;
        } else c.overview();
        // показ — до уровня высоты (detail.ts): переход идёт по кадрам
        for (let i = 0; i < 600 && g.detail[level - 1] !== 1; i++) await new Promise(res => requestAnimationFrame(res));
        const url = g.stage.shot(W, H, hour);
        return { url, calls: g.stage.calls, tris: g.stage.tris, glb: g.stage.machines.fromBlender, art: g.store.get().art };
      },
      [cam, level, q, hour, art, W, H],
    );
    const label = `${name} · ${hour === 12 ? 'день' : 'ночь'} · ${q} · ${art === 'code' ? 'код' : 'Blender'} — ${r.calls} вызовов, ${r.tris} треугольников`;
    const file = join(out, `blender-${name}-${hour}-${q}-${art}.png`);
    writeFileSync(file, Buffer.from(r.url.split(',')[1], 'base64'));
    shots.push({ url: r.url, label });
    stats.push({ view: name, hour, quality: q, art, calls: r.calls, tris: r.tris, glb: r.glb });
    console.log(label);
  }
}
const cells = shots.map(s => `<figure><img src="${s.url}"><figcaption>${s.label}</figcaption></figure>`).join('');
const lister = await browser.newPage({ viewport: { width: 2 * 640 + 18, height: 800 } });
await lister.setContent(
  `<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(2,640px);gap:6px}figure{margin:0}img{width:640px;display:block}figcaption{padding:2px 0 4px}</style><main>${cells}</main>`,
);
await lister.screenshot({ path: join(out, 'blender-sheet.png'), fullPage: true });
writeFileSync(join(out, 'blender-sheet.json'), `${JSON.stringify({ when, size: [W, H], stats, errors }, null, 1)}\n`);
console.log(`лист → ${join(out, 'blender-sheet.png')}; ошибок в консоли: ${errors.length}`);
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
