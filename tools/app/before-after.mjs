// Лист «до — после» (Б11, шаг 2; docs/specs/2026-10-vertical-slice.md, «Б11»): одни и те же снимки панелей основной части
// сценария в браузере — слева до правки панелей, справа после; строка — снимок. Снимки «до» — папка, куда их сложили
// перед правкой (`--before`), «после» — tools/app/out. Пишет tools/app/out/before-after.png.
//
//   node tools/app/before-after.mjs --before <папка>
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const before = arg('before');
const after = arg('after', join(here, 'out'));
if (!before) throw new Error('--before <папка> — снимки до правки');
/** Панели основной части: планёрка, склад и касса, карточки, большие окна. */
const SHOTS = ['e2e.png', 'e2e-crew.png', 'e2e-person.png', 'e2e-dev.png', 'e2e-gantt.png', 'e2e-journal.png', 'e2e-kpi.png', 'e2e-policies.png', 'e2e-ref.png', 'e2e-dossier.png', 'e2e-inv.png', 'e2e-po.png'];
const rows = SHOTS.filter(f => existsSync(join(before, f)) && existsSync(join(after, f)));
const img = p => `<img src="data:image/png;base64,${readFileSync(p).toString('base64')}">`;
const html = rows.map(f => `<figure>${img(join(before, f))}<figcaption>до · ${f}</figcaption></figure><figure>${img(join(after, f))}<figcaption>после · ${f}</figcaption></figure>`).join('');
const exe = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
await page.setContent(`<style>body{margin:6px;background:#1d2226;font:12px sans-serif;color:#d8dde0}main{display:grid;grid-template-columns:repeat(2,640px);gap:6px}figure{margin:0}img{width:640px;display:block}figcaption{padding:2px 0 4px}</style><main>${html}</main>`);
await page.screenshot({ path: join(after, 'before-after.png'), fullPage: true });
await browser.close();
console.log(`до — после: ${rows.length} пар → ${join(after, 'before-after.png')}`);
