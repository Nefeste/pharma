// Часть 2г: палитры и цветовая слепота (docs/specs/2026-10-view.md, 2г; требования — геймдизайн, §23). Статусы партий,
// статусы чистоты помещений, лампы машин и части столбиков загрузки (Б1и) различимы при обычном зрении и в имитации
// протанопии, дейтеранопии и тританопии (Machado и др., 2009); оттенки зон — при обычном зрении, а в любом виде зону
// называет слово на полу. Значок на лампе контрастен с ней не меньше 3:1 (WCAG 2.1, п. 1.4.11). Модель —
// src/render/color.ts; здесь же её простые свойства: белый, чёрный и серый, сходство красного и зелёного при дейтеранопии.
import { describe, expect, test } from 'bun:test';
import { PART_COLOR } from '../../src/app/floor';
import { contrast, deltaE, inkOf, labOf, simulate, toLinear, VISIONS } from '../../src/render/color';
import { LAMP_COLOR } from '../../src/render/flow';
import { en } from '../../src/i18n/en';
import { ru } from '../../src/i18n/ru';
import { TAG_COLOR } from '../../src/render/loads';
import { ROOM_COLOR } from '../../src/render/signs';
import { ZONE_TINT } from '../../src/render/world';

/** Различимость (геймдизайн, §23): ΔE*ab каждой пары у статусов и ламп — во всех видах, у зон — при обычном зрении. */
const STATE_DE = 20;
const ZONE_DE = 10;

/** Наименьшая разница пары палитры в виде зрения `v`; `same` — пары одной семьи, которые отличает значок. */
function worst(pal: Record<string, number>, v: (typeof VISIONS)[number], same: [string, string][] = []) {
  const keys = Object.keys(pal);
  let min = Infinity;
  let pair = '';
  for (let i = 0; i < keys.length; i++) {
    for (let k = i + 1; k < keys.length; k++) {
      if (same.some(([a, b]) => (a === keys[i] && b === keys[k]) || (a === keys[k] && b === keys[i]))) continue;
      const d = deltaE(pal[keys[i]], pal[keys[k]], v);
      if (d < min) [min, pair] = [d, `${keys[i]}/${keys[k]}`];
    }
  }
  return { min, pair };
}

describe('модель', () => {
  test('sRGB → CIELAB: белый — L 100 и нейтрален, чёрный — 0; переход sRGB в линейный — как в МЭК 61966-2-1', () => {
    const white = labOf(simulate(0xffffff, 'normal'));
    expect(white[0]).toBeCloseTo(100, 1);
    expect(Math.abs(white[1]) + Math.abs(white[2])).toBeLessThan(0.5);
    expect(labOf(simulate(0x000000, 'normal'))[0]).toBeCloseTo(0, 6);
    expect(toLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 9);
    expect(toLinear(1)).toBeCloseTo(1, 9);
  });

  test('имитация: серый остаётся серым; красный и зелёный при дейтеранопии сходятся, при обычном зрении — нет', () => {
    for (const v of VISIONS) {
      const g = simulate(0x808080, v);
      expect(Math.max(...g) - Math.min(...g)).toBeLessThan(0.02);
    }
    expect(deltaE(0xd03030, 0x30a030, 'normal')).toBeGreaterThan(deltaE(0xd03030, 0x30a030, 'deutan') * 2);
  });

  test('контраст (WCAG): белый к чёрному — 21:1, к себе — 1:1; краска значка — более контрастная из двух', () => {
    expect(contrast(0xffffff, 0x000000)).toBeCloseTo(21, 6);
    expect(contrast(0x777777, 0x777777)).toBe(1);
    expect(inkOf(0xffffff)).not.toBe(0xffffff);
    expect(inkOf(0x000000)).toBe(0xffffff);
  });
});

describe('палитры', () => {
  test(`статусы партий: каждая пара — не ближе ${STATE_DE} ΔE во всех видах; «пробы отобраны» — оттенок карантина`, () => {
    for (const v of VISIONS) {
      const w = worst(TAG_COLOR, v, [['quarantine', 'sampled']]);
      expect([v, w.pair, w.min >= STATE_DE]).toEqual([v, w.pair, true]);
    }
  });

  test(`статусы чистоты помещений: каждая пара — не ближе ${STATE_DE} ΔE во всех видах`, () => {
    for (const v of VISIONS) {
      const w = worst(ROOM_COLOR, v);
      expect([v, w.pair, w.min >= STATE_DE]).toEqual([v, w.pair, true]);
    }
  });

  test(`части столбиков слоя «Загрузка и OEE» (Б1и): каждая пара — не ближе ${STATE_DE} ΔE во всех видах`, () => {
    for (const v of VISIONS) {
      const w = worst(PART_COLOR, v);
      expect([v, w.pair, w.min >= STATE_DE]).toEqual([v, w.pair, true]);
    }
  });

  test(`лампы машин: каждая пара — не ближе ${STATE_DE} ΔE во всех видах; значок на лампе — контраст не ниже 3:1`, () => {
    for (const v of VISIONS) {
      const w = worst(LAMP_COLOR, v);
      expect([v, w.pair, w.min >= STATE_DE]).toEqual([v, w.pair, true]);
    }
    for (const c of Object.values(LAMP_COLOR)) expect(contrast(c, inkOf(c))).toBeGreaterThanOrEqual(3);
  });

  test(`оттенки зон: не ближе ${ZONE_DE} ΔE при обычном зрении; у каждой зоны — название на обоих языках`, () => {
    const tints = Object.fromEntries(Object.entries(ZONE_TINT).map(([k, v]) => [k, Number.parseInt(v.slice(1), 16)]));
    const w = worst(tints, 'normal');
    expect([w.pair, w.min >= ZONE_DE]).toEqual([w.pair, true]);
    for (const kind of Object.keys(ZONE_TINT) as (keyof typeof ZONE_TINT)[]) {
      expect(ru.zones[kind]?.length).toBeGreaterThan(0);
      expect(en.zones[kind]?.length).toBeGreaterThan(0);
    }
  });
});
