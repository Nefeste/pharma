// Английский язык (Б12, шаг 1; docs/specs/2026-10-vertical-slice.md, «Б12»): у каждого слова словаря продукта
// (docs/01-product.md, «Словарь») — английское слово окна; слово, что есть в русских строках окна, есть и в английских —
// тем же термином; запрещённых синонимов в английских строках нет. Строки окна — src/i18n/ru.ts и en.ts.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../..');
const product = readFileSync(join(ROOT, 'docs/01-product.md'), 'utf8');
const ru = readFileSync(join(ROOT, 'src/i18n/ru.ts'), 'utf8').toLowerCase();
/** Английские строки без комментариев: в комментариях — русские названия блоков. */
const en = readFileSync(join(ROOT, 'src/i18n/en.ts'), 'utf8')
  .split('\n')
  .filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l))
  .join('\n');
const enLow = en.toLowerCase();

/** Строки словаря: слово, код, английское слово окна. */
const rows = product
  .slice(product.indexOf('## Словарь'))
  .split('\n')
  .filter(l => l.startsWith('| ') && !l.startsWith('| Слово'))
  .map(l => l.split('|').map(c => c.trim()))
  .map(c => ({ word: c[1], code: c[2], en: c[3] }));

/** Пары «русское — английское» по разделителю « · »; у одного английского на несколько русских — то же для всех. */
function pairs(r: { word: string; en: string }): [string, string][] {
  const clean = (s: string) => s.replace(/\(.*?\)|[«»]/g, '').trim();
  const w = r.word.split(' · ').map(clean);
  const e = r.en.split(' · ').map(clean);
  return w.map((x, i) => [x.toLowerCase(), (e[i] ?? e[0]).toLowerCase()]);
}

/** Есть ли русское слово в строках окна: по основе — без двух последних букв у длинных слов. */
const inRu = (w: string) => ru.includes(w.length <= 4 ? w : w.slice(0, Math.max(4, w.length - 2)));

/** Запрещённые синонимы в английских строках — у словаря другое слово. */
const FORBIDDEN: [RegExp, string][] = [
  [/\bclass [A-D]\b/i, 'класс чистоты — grade (EU GMP, прил. 1)'],
  [/\bitem stock\b|(?:sku|stockHead): 'Item'/, 'товарная позиция — SKU'],
  [/\bleading version\b|'Versions'/, 'версия расследования — hypothesis'],
  [/\bqualified person\b/, 'уполномоченное лицо — Qualified Person, с прописных'],
  [/\b[Bb]reakdown\b/, 'отказ — failure'],
  [/\bminor stops\b/, 'микроостановка — micro-stop'],
  [/«|»/, 'кавычки по-английски — “ ”'],
  [/\b(January|February|March|April|May|June|July|August|September|October|November|December) \$\{d\}, /, 'дата — «1 September 2027»'],
];

describe('словарь по-английски', () => {
  test('у каждого слова словаря — английское слово окна', () => {
    expect(rows.length).toBeGreaterThan(80);
    for (const r of rows) expect([r.word, r.en.length > 0]).toEqual([r.word, true]);
  });

  test('слово словаря из русских строк окна есть и в английских — тем же термином', () => {
    const miss: string[] = [];
    let seen = 0;
    for (const r of rows)
      for (const [w, e] of pairs(r))
        if (inRu(w)) {
          seen++;
          if (!enLow.includes(e)) miss.push(`${w} → ${e}`);
        }
    expect(seen).toBeGreaterThan(60);
    expect(miss).toEqual([]);
  });

  test('запрещённых синонимов в английских строках нет', () => {
    for (const [re, why] of FORBIDDEN) expect([why, en.match(re)?.[0]]).toEqual([why, undefined]);
  });

  test('у терминов из правил GMP ЕС — ключ источника в docs/10-domain.md', () => {
    const domain = readFileSync(join(ROOT, 'docs/10-domain.md'), 'utf8');
    for (const k of ['eu-gmp', 'eu-gmp-a16', 'ich-q10', 'isa-95', 'isa-88', 'ohno-1988', 'apics-sop-handout']) expect(domain).toContain(`| \`${k}\` |`);
  });
});

describe('язык окна', () => {
  test('из адреса — он; иначе выбор игрока в окне; иначе — системы; хранилище не читается — системы', async () => {
    const { langOf, keepLang, LANG_KEY } = await import('../../src/app/lang');
    const m = new Map<string, string>();
    const keep = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect([langOf(null, keep, 'ru'), langOf(null, keep, 'en')]).toEqual(['ru', 'en']);
    keepLang(keep, 'en');
    expect(m.get(LANG_KEY)).toBe('en');
    expect([langOf(null, keep, 'ru'), langOf('ru', keep, 'en'), langOf('de', keep, 'ru')]).toEqual(['en', 'ru', 'en']);
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(langOf(null, broken, 'ru')).toBe('ru');
    keepLang(broken, 'en');
  });
});

describe('переполнения окна', () => {
  test('шире коробки и обрезано — переполнение; многоточие, прокрутка и точка округления — нет; выход за край предка — да', async () => {
    const { overflows } = await import('../../src/app/overflow');
    const box = (o: Partial<import('../../src/app/overflow').Box>) => ({ what: 'x', scrollW: 100, clientW: 100, scrollH: 20, clientH: 20, ox: 'visible', oy: 'visible', ellipsis: false, nowrap: false, cut: 0, ...o });
    expect(overflows([box({ scrollW: 120, ox: 'hidden' })])).toEqual(['x: width 120 > 100']);
    expect(overflows([box({ scrollW: 120, nowrap: true })])).toEqual(['x: width 120 > 100']);
    expect(overflows([box({ scrollW: 120, ox: 'hidden', ellipsis: true })])).toEqual([]);
    expect(overflows([box({ scrollW: 120, ox: 'auto' })])).toEqual([]);
    expect(overflows([box({ scrollW: 101, ox: 'hidden' })])).toEqual([]);
    expect(overflows([box({ scrollW: 120 })])).toEqual([]);
    expect(overflows([box({ scrollH: 40, oy: 'hidden' })])).toEqual(['x: height 40 > 20']);
    expect(overflows([box({ cut: 51 })])).toEqual(['x: cut 51']);
    // панель с прокруткой вбок — переполнение: её делают шире (по игре владельца 20.11.2026)
    expect(overflows([box({ scrollW: 900, clientW: 760, ox: 'auto', panel: true })])).toEqual(['x: scroll 900 > 760']);
    expect(overflows([box({ scrollW: 760, clientW: 760, ox: 'auto', panel: true })])).toEqual([]);
  });
});

describe('окна', () => {
  test('сдвиг окна — в пределах экрана: верх не выше полосы, за заголовок можно взяться; вид окна — ключ сдвига', async () => {
    const { clampShift, GRIP, keyOf } = await import('../../src/app/windows');
    const view = { left: 0, top: 0, right: 1920, bottom: 1080 };
    const base = { left: 1152, top: 60, right: 1912, bottom: 700 };
    expect(clampShift(base, { x: -300, y: 100 }, view, 52)).toEqual({ x: -300, y: 100 });
    expect(clampShift(base, { x: 0, y: -200 }, view, 52)).toEqual({ x: 0, y: -8 });
    expect(clampShift(base, { x: 5000, y: 0 }, view, 52)).toEqual({ x: 1920 - GRIP - 1152, y: 0 });
    expect(clampShift(base, { x: -5000, y: 0 }, view, 52)).toEqual({ x: GRIP - 760 - 1152, y: 0 });
    expect(clampShift(base, { x: 0, y: 5000 }, view, 52)).toEqual({ x: 0, y: 1080 - GRIP - 60 });
    expect([keyOf('stock panel cashp'), keyOf('letters panel'), keyOf('card panel beside over'), keyOf('morning panel')]).toEqual(['stock cashp', 'letters', 'card', 'morning']);
  });
});
