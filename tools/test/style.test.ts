// из bolnitsa: tools/test/style.test.ts @ 15a7ad6, изменено: токены завода — шкала шрифта с плотными сетками, шкала
// отступов, тени; иерархия — заголовки панелей и разделы планёрки.
// Марка и панели (Б11, шаг 2; docs/specs/2026-10-vertical-slice.md): все цвета, размеры шрифта, отступы, скругления и тени
// окна — токены `:root` страницы, правило CSS своих не задаёт; шрифт — IBM Plex Sans из своих файлов с лицензией; текст на
// стекле над светлым полом цеха читается — контраст по WCAG не ниже 4,5:1, когда под стеклом белое и когда чёрное.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../..');
const html = readFileSync(join(ROOT, 'app/index.html'), 'utf8');
const css = html.slice(html.indexOf('<style>') + '<style>'.length, html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const rootAt = css.indexOf(':root {');
const rootEnd = css.indexOf('}', rootAt) + 1;
const root = css.slice(rootAt, rootEnd);
const rules = css.slice(0, rootAt) + css.slice(rootEnd);
const tokens = new Map([...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
/** Переменные, которые ставит окно или правило само: высота верхней полосы, цвет полосы расписания. */
const OWN = new Set(['--top-h', '--c']);

type Rgba = [number, number, number, number];
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

function colour(v: string): Rgba {
  const hex = v.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const f = v.match(/^rgba?\(([^)]*)\)$/);
  if (!f) throw new Error(`не цвет: ${v}`);
  const [r, g, b, a = 1] = f[1].split(',').map(Number);
  return [r, g, b, a];
}
const tok = (name: string): Rgba => {
  const v = tokens.get(name);
  if (!v) throw new Error(`нет токена ${name}`);
  return colour(v);
};
/** Цвет поверх цвета (непрозрачного): что увидит глаз. */
const over = (fg: Rgba, bg: Rgba): Rgba => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1) as Rgba;
function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** Контраст по WCAG 2: от 1 до 21. */
function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const WHITE: Rgba = [255, 255, 255, 1];
const BLACK: Rgba = [0, 0, 0, 1];

describe('токены', () => {
  test('цвета и тени — только в :root: правило CSS своих не задаёт', () => {
    expect(rules.match(COLOUR) ?? []).toEqual([]);
    const colours = [...tokens.values()].filter(v => /^(#|rgb)/.test(v));
    expect(colours.length).toBeGreaterThan(30);
    for (const v of colours) expect(colour(v)[3]).toBeGreaterThan(0);
  });

  test('шрифт — IBM Plex Sans из своих файлов с лицензией; восемь размеров шкалы, мимо неё — ни одного', () => {
    for (const f of ['IBMPlexSans[wdth,wght].ttf', 'IBMPlexSans-Italic[wdth,wght].ttf', 'OFL.txt']) expect(existsSync(join(ROOT, 'assets/fonts', f))).toBe(true);
    expect(readFileSync(join(ROOT, 'assets/fonts/OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(readFileSync(join(ROOT, 'assets/LICENSES.md'), 'utf8')).toContain('IBM Plex Sans');
    expect(rules).toContain('font: var(--fs-body)/1.35 "IBM Plex Sans"');
    const scale = [...tokens.keys()].filter(k => k.startsWith('--fs-'));
    expect(scale.map(k => tokens.get(k))).toEqual(['10px', '11px', '12px', '13px', '16px', '18px', '22px', '28px']);
    const sizes = [...rules.matchAll(/font-size:\s*([^;}]+)/g)].map(m => m[1].trim());
    expect(sizes.length).toBeGreaterThan(60);
    for (const s of sizes) expect(s).toMatch(/^var\(--fs-[a-z]+\)$/);
  });

  test('отступы — ступени шкалы; ноль и точка — сами по себе; скругления — токены', () => {
    const sp = [...tokens.keys()].filter(k => k.startsWith('--sp-'));
    expect(sp.map(k => tokens.get(k))).toEqual(['2px', '4px', '6px', '8px', '10px', '12px', '16px', '24px']);
    const bad: string[] = [];
    for (const m of rules.matchAll(/(?<![\w-])(padding|margin|gap|row-gap|column-gap)(-[a-z-]+)?\s*:\s*([^;}]+)/g))
      for (const px of m[3].replace(/var\(--sp-\d\)/g, '').matchAll(/(\d+(?:\.\d+)?)px/g)) if (px[1] !== '0' && px[1] !== '1') bad.push(`${m[1]}${m[2] ?? ''}: ${m[3]}`);
    expect(bad).toEqual([]);
    for (const m of rules.matchAll(/border-radius\s*:\s*([^;}]+)/g)) expect(m[1].trim()).toMatch(/^(var\(--r-[a-z]+\)( var\(--r-[a-z]+\))*|0|50%)$/);
    for (const m of rules.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) expect(m[1].trim()).toMatch(/^(var\(--shadow[a-z-]*\)|none|inset [^;]*var\(--[a-z-]+\))$/);
  });

  test('каждая переменная определена, каждый токен где-то нужен', () => {
    const used = new Set([...rules.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]));
    for (const o of OWN) used.delete(o);
    for (const u of used) expect(tokens.has(u) ? u : `не определён: ${u}`).toBe(u);
    for (const t of tokens.keys()) expect(used.has(t) ? t : `не нужен: ${t}`).toBe(t);
  });
});

describe('общие классы', () => {
  const rule = (sel: string) => {
    const at = rules.indexOf(`${sel} {`);
    expect(at >= 0 ? sel : `нет правила ${sel}`).toBe(sel);
    return rules.slice(at, rules.indexOf('}', at));
  };
  test('заголовок окна — один на все окна; разделы и подзаголовки — одной манерой; поля и кнопки — общие', () => {
    expect(rule('.phead')).toContain('font-size: var(--fs-title)');
    const msec = rule('.msec');
    for (const x of ['font-size: var(--fs-small)', 'color: var(--accent)', 'text-transform: uppercase']) expect(msec).toContain(x);
    const sub = rule('.lhead, .mhead, .csec');
    for (const x of ['font-size: var(--fs-caption)', 'color: var(--muted)', 'text-transform: uppercase']) expect(sub).toContain(x);
    // у панелей своих подзаголовков с цветом и размером нет
    for (const m of rules.matchAll(/([^{}]*\.(?:lhead|mhead|csec)\b[^{}]*)\{([^}]*)\}/g)) if (m[1].trim() !== '.lhead, .mhead, .csec') expect([m[1].trim(), /color|font-size/.test(m[2])]).toEqual([m[1].trim(), false]);
    expect(rule('input[type=number], input[type=text], input[type=search], input[type=date], select, textarea')).toContain('background: var(--raised)');
    expect(rule('button:focus-visible')).toContain('outline: 2px solid var(--accent)');
  });
});

describe('читаемость над светлым полом', () => {
  const OVER_MAP = ['--glass', '--glass-tag', '--window', '--window-2'];
  const TEXT = ['--text', '--muted', '--strong', '--ok-text', '--bad-text', '--bad-text-2', '--info-text', '--warn'];

  test('любой текст на любом стекле и окне — не ниже 4,5:1 и над белым, и над чёрным', () => {
    const worst: string[] = [];
    for (const s of OVER_MAP)
      for (const [under, name] of [[WHITE, 'белое'], [BLACK, 'чёрное']] as const) {
        const bg = over(tok(s), under);
        for (const t of TEXT) if (contrast(tok(t), bg) < 4.5) worst.push(`${t} на ${s} (под ним ${name}): ${contrast(tok(t), bg).toFixed(2)}`);
      }
    expect(worst).toEqual([]);
  });

  test('кнопки на панели: текст и серый — не ниже 4,5:1', () => {
    const bg = over(tok('--raised'), over(tok('--glass'), WHITE));
    for (const t of ['--text', '--muted']) expect(contrast(tok(t), bg)).toBeGreaterThanOrEqual(4.5);
  });

  test('подложки строк в окне: текст на них — не ниже 4,5:1', () => {
    const win = over(tok('--window'), WHITE);
    for (const w of ['--sunken', '--wash', '--wash-2', '--accent-wash-1', '--accent-wash-2', '--accent-wash-3', '--bad-wash', '--bad-wash-2', '--info-wash', '--night-wash'])
      for (const t of ['--text', '--muted']) expect(contrast(tok(t), over(tok(w), win))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tok('--bad-text'), over(tok('--bad-wash-2'), win))).toBeGreaterThanOrEqual(4.5);
  });

  test('на кнопке акцента — тёмный текст', () => {
    expect(contrast(tok('--on-accent'), tok('--accent'))).toBeGreaterThanOrEqual(4.5);
  });
});
