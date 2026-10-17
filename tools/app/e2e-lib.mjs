// из bolnitsa: tools/app/e2e-lib.mjs @ e0a3491
// Общее для сценария в браузере и бенча без окна: где взять Chromium.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Chromium: CHROMIUM_PATH или первый найденный в PLAYWRIGHT_BROWSERS_PATH (по умолчанию /opt/pw-browsers). */
export function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  for (const d of readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const p = join(base, d, 'chrome-linux', 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('Chromium не найден: задайте CHROMIUM_PATH или PLAYWRIGHT_BROWSERS_PATH');
}

