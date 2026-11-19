// из bolnitsa: tools/sound/gen.ts @ 15a7ad6, изменено: звуки завода вместо больницы — `stop` вместо `urgent`, новый
// `notice`; без раздела «Музыка» (музыки в Б11 нет).
// npm run sound — звуки «Фармзавода» из формул (docs/specs/2026-10-vertical-slice.md, Б11, шаг 1): колокольчики — частотной
// модуляцией, стук — затухающим тоном с шумом, шорох — шумом в скользящей полосе; всё — в небольшой комнате (реверберация
// Шрёдера — Мурера). Пишет assets/audio/*.wav и assets/audio/LICENSES.md с параметрами: звук наш, и его можно пересобрать.
//
// Детерминирован: шум — из генератора игры с постоянным зерном, у каждого звука своя ветвь. Звуки тихие и короткие, без
// резких верхов (срез 9 кГц): завод спокойный, а не сирена (ADR 0023 устава, правило 6; docs/13-art.md, §11).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Rng } from '../../src/engine/core/rng';

export const RATE = 44100;
const OUT = join(import.meta.dir, '../../assets/audio');
const TAU = 2 * Math.PI;

// ─── основа: буферы, шум, фильтры ───────────────────────────────────────

const len = (sec: number) => new Float32Array(Math.round(sec * RATE));
const at = (sec: number) => Math.round(sec * RATE);

/** Шум −1…1 из генератора игры: у каждого звука своя ветвь. */
function noise(n: number, name: string): Float32Array {
  const r = Rng.seeded(20261107).fork(name);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (r.u32() / 4294967296) * 2 - 1;
  return out;
}

/** Двухполюсный фильтр по «поваренной книге» RBJ. */
export function biquad(input: Float32Array, kind: 'lp' | 'hp' | 'bp', hz: number, q: number): Float32Array {
  const w = (TAU * hz) / RATE;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const [b0, b1, b2] = kind === 'lp' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : kind === 'hp' ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2] : [alpha, 0, -alpha];
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

function mixInto(out: Float32Array, src: Float32Array, start: number, gain = 1): void {
  for (let i = 0; i < src.length && start + i < out.length; i++) if (start + i >= 0) out[start + i] += gain * src[i];
}

function peakOf(x: Float32Array): number {
  let m = 0;
  for (const v of x) {
    if (!Number.isFinite(v)) throw new Error('sound: NaN or Infinity');
    m = Math.max(m, Math.abs(v));
  }
  return m;
}

function normalize(x: Float32Array, peak: number): Float32Array {
  const m = peakOf(x);
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

/** Мягкое начало и конец — без щелчка. */
function fades(x: Float32Array, inSec: number, outSec: number): Float32Array {
  const a = at(inSec);
  const b = Math.min(x.length, at(outSec));
  for (let i = 0; i < a; i++) x[i] *= i / a;
  for (let i = 0; i < b; i++) x[x.length - 1 - i] *= i / b;
  return x;
}

/** Убрать постоянную составляющую: фильтр верхних частот 30 Гц. */
const dcBlock = (x: Float32Array) => biquad(x, 'hp', 30, 0.7);

// ─── комната: реверберация Шрёдера — Мурера ─────────────────────────────

/** Параметры комнаты: небольшое помещение с твёрдыми стенами, короткий хвост. */
export const ROOM = { combsMs: [29.7, 33.1, 37.1, 41.1, 43.7, 47.9], allpassMs: [5, 3.4, 1.7], decaySec: 0.6, damp: 0.5 };

function room(x: Float32Array, wet: number, p = ROOM): Float32Array {
  const out = new Float32Array(x.length);
  for (const ms of p.combsMs) {
    const d = Math.round((ms / 1000) * RATE);
    const g = 10 ** ((-3 * ms) / 1000 / p.decaySec);
    const buf = new Float32Array(d);
    let lp = 0;
    for (let i = 0, k = 0; i < x.length; i++, k = (k + 1) % d) {
      const y = buf[k];
      lp = y * (1 - p.damp) + lp * p.damp;
      buf[k] = x[i] + g * lp;
      out[i] += y / p.combsMs.length;
    }
  }
  let y = out;
  for (const ms of p.allpassMs) {
    const d = Math.round((ms / 1000) * RATE);
    const buf = new Float32Array(d);
    const z = new Float32Array(y.length);
    for (let i = 0, k = 0; i < y.length; i++, k = (k + 1) % d) {
      const b = buf[k];
      const v = y[i] + 0.5 * b;
      buf[k] = v;
      z[i] = b - 0.5 * v;
    }
    y = z;
  }
  const mix = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) mix[i] = x[i] + wet * y[i];
  return mix;
}

// ─── инструменты ────────────────────────────────────────────────────────

/** Ноты: «C5», «F#4», «Bb4» → герцы (равномерная темперация, ля = 440). */
export function hz(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`note ${name}`);
  const semis = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1] as 'C'] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (semis / 12);
}

/**
 * Колокольчик: несущая и модулятор в неровном отношении, глубина модуляции гаснет быстрее звука. Боковые частоты — не выше
 * `topHz`: выше они звенят «компьютерно».
 */
export const BELL = { ratio: 1.41, index: 4, indexSec: 0.3, detune: 1.0035, strike: 2.76, topHz: 8000 };

export function bell(freq: number, velocity: number, sec: number): Float32Array {
  const out = len(sec);
  const index = Math.max(0.4, Math.min(BELL.index, (BELL.topHz - freq) / (freq * BELL.ratio) - 1));
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const env = Math.exp(-t / (sec / 5)) * Math.min(1, t / 0.002);
    const I = index * Math.exp(-t / BELL.indexSec);
    const a = Math.sin(TAU * freq * t + I * Math.sin(TAU * freq * BELL.ratio * t));
    const b = Math.sin(TAU * freq * BELL.detune * t + I * 0.8 * Math.sin(TAU * freq * BELL.detune * BELL.ratio * t));
    const strike = 0.2 * Math.exp(-t / 0.06) * Math.sin(TAU * freq * BELL.strike * t);
    out[i] = velocity * env * (0.55 * a + 0.45 * b + strike);
  }
  return fades(out, 0.001, 0.05);
}

/** Стук: тон, что падает от `from` к `to` герц и гаснет за `tau` с, — дерево, пластик, мягкая мебель. */
function knock(from: number, to: number, tau: number, sec: number): Float32Array {
  const out = len(sec);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const f = to + (from - to) * Math.exp(-t / (tau * 0.6));
    phase += (TAU * f) / RATE;
    out[i] = Math.sin(phase) * Math.exp(-t / tau) * Math.min(1, t / 0.0008);
  }
  return out;
}

/** Шум с огибающей через фильтр: удар (`lp`), шорох бумаги (`bp`). */
function burst(sec: number, seed: string, kind: 'lp' | 'bp', hzAt: number, q: number, tau: number): Float32Array {
  const n = biquad(noise(at(sec), seed), kind, hzAt, q);
  for (let i = 0; i < n.length; i++) n[i] *= Math.exp(-i / RATE / tau) * Math.min(1, i / RATE / 0.0005);
  return n;
}

/** Шорох: шум в полосе, что скользит от `from` к `to` герц, с огибающей sin². */
function rustle(sec: number, seed: string, from: number, to: number, q: number): Float32Array {
  const n = noise(at(sec), seed);
  const out = new Float32Array(n.length);
  const step = at(0.005);
  for (let s = 0; s < n.length; s += step) {
    const t = s / RATE;
    const chunk = biquad(n.subarray(Math.max(0, s - 256), Math.min(n.length, s + step)), 'bp', from + (to - from) * (t / sec), q);
    for (let i = 0; i < step && s + i < n.length; i++) out[s + i] = chunk[chunk.length - Math.min(step, n.length - s) + i] * Math.sin(Math.PI * ((s + i) / n.length)) ** 2;
  }
  return out;
}

/** Ноты колокольчиком одна за другой через `gap` с. */
function chime(notes: string[], gap: number, velocity: number, ring: number): Float32Array {
  const out = len(gap * (notes.length - 1) + ring);
  notes.forEach((n, i) => mixInto(out, bell(hz(n), velocity * (1 - 0.06 * i), ring), at(i * gap)));
  return out;
}

/** Срез верхов: звуки мягкие. */
const TOP_CUT = 9000;
const finish = (x: Float32Array, peak: number, wet: number) => fades(normalize(biquad(room(dcBlock(x), wet), 'lp', TOP_CUT, 0.7), peak), 0.0005, 0.04);

// ─── звуки ──────────────────────────────────────────────────────────────

export type Sound = { file: string; what: string; params: string; make: () => Float32Array };

export const SOUNDS: Sound[] = [
  {
    file: 'click.wav',
    what: 'кнопка окна: короткий мягкий щелчок',
    params: 'тон 1600 Гц, гаснет за 6 мс; шум в полосе 3 кГц, 3 мс',
    make: () => {
      const out = len(0.06);
      mixInto(out, knock(1700, 1600, 0.006, 0.06), 0, 1);
      mixInto(out, burst(0.02, 'click', 'bp', 3000, 1.5, 0.003), 0, 0.5);
      return finish(out, 0.3, 0.04);
    },
  },
  {
    file: 'build.wav',
    what: 'стройка: встало помещение, дверь, зона; заказано или переставлено оборудование — глухой стук',
    params: 'тон 210 → 150 Гц, гаснет за 45 мс; шум ниже 900 Гц, 20 мс; щелчок 2,2 кГц',
    make: () => {
      const out = len(0.35);
      mixInto(out, knock(210, 150, 0.045, 0.35), 0, 1);
      mixInto(out, burst(0.12, 'build', 'lp', 900, 0.8, 0.02), 0, 0.6);
      mixInto(out, knock(2300, 2200, 0.004, 0.03), 0, 0.15);
      return finish(out, 0.5, 0.1);
    },
  },
  {
    file: 'demolish.wav',
    what: 'снос: два глухих стука вниз',
    params: 'тоны 170 → 120 и 130 → 95 Гц через 90 мс; шум ниже 600 Гц, 40 мс',
    make: () => {
      const out = len(0.45);
      mixInto(out, knock(170, 120, 0.05, 0.3), 0, 1);
      mixInto(out, knock(130, 95, 0.06, 0.34), at(0.09), 0.9);
      mixInto(out, burst(0.2, 'demolish', 'lp', 600, 0.8, 0.04), 0, 0.7);
      return finish(out, 0.5, 0.1);
    },
  },
  {
    file: 'hire.wav',
    what: 'найм: два колокольчика вверх',
    params: `колокольчики E5 и A5 через 0,11 с; ЧМ ${BELL.ratio}, глубина до ${BELL.index}`,
    make: () => finish(chime(['E5', 'A5'], 0.11, 1, 0.8), 0.42, 0.15),
  },
  {
    file: 'refuse.wav',
    what: 'отказ: два тихих тона вниз, без резкости',
    params: 'тоны D4 и A3 через 0,12 с, гаснут за 70 мс; срез 2 кГц',
    make: () => {
      const out = len(0.4);
      mixInto(out, knock(hz('D4'), hz('D4'), 0.07, 0.25), 0, 1);
      mixInto(out, knock(hz('A3'), hz('A3'), 0.08, 0.28), at(0.12), 1);
      return finish(biquad(out, 'lp', 2000, 0.7), 0.38, 0.08);
    },
  },
  {
    file: 'stop.wav',
    what: 'стоп: мир встал на извещении — спокойный вызов из трёх колокольчиков вниз',
    params: `колокольчики G5, E5, C5 через 0,16 с; ЧМ ${BELL.ratio}`,
    make: () => finish(chime(['G5', 'E5', 'C5'], 0.16, 1, 1), 0.55, 0.18),
  },
  {
    file: 'notice.wav',
    what: 'внимание: строка сверху — один тихий колокольчик, короче и тише стопа',
    params: `колокольчик E5, гаснет за 0,5 с; ЧМ ${BELL.ratio}`,
    make: () => finish(bell(hz('E5'), 0.7, 0.5), 0.3, 0.12),
  },
  {
    file: 'letter.wav',
    what: 'письмо: шорох бумаги и колокольчик',
    params: 'шум в полосе 2,5 → 3,5 кГц за 0,12 с; колокольчик A5 через 0,08 с',
    make: () => {
      const out = len(0.8);
      mixInto(out, rustle(0.12, 'letter', 2500, 3500, 1.4), 0, 0.5);
      mixInto(out, bell(hz('A5'), 0.8, 0.7), at(0.08), 1);
      return finish(out, 0.4, 0.15);
    },
  },
  {
    file: 'meeting.wav',
    what: 'планёрка: утро — три колокольчика вверх, неспешно',
    params: `колокольчики C5, E5, G5 через 0,22 с; ЧМ ${BELL.ratio}`,
    make: () => finish(chime(['C5', 'E5', 'G5'], 0.22, 0.9, 1.0), 0.5, 0.2),
  },
  {
    file: 'goal.wav',
    what: 'цель выполнена: четыре колокольчика вверх',
    params: `колокольчики C5, E5, G5, C6 через 0,09 с; ЧМ ${BELL.ratio}`,
    make: () => finish(chime(['C5', 'E5', 'G5', 'C6'], 0.09, 0.95, 1.1), 0.55, 0.2),
  },
];

// ─── запись ─────────────────────────────────────────────────────────────

export function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export function licenses(): string {
  const rows = SOUNDS.map(s => `| \`${s.file}\` | ${s.what} | ${s.params} |`).join('\n');
  return `# Звуки «Фармзавода»: откуда каждый файл

Все файлы — **синтез**, собраны \`npm run sound\` (\`tools/sound/gen.ts\`) из формул; чужих записей нет
(docs/specs/2026-10-vertical-slice.md, Б11, шаг 1; устав, \`docs/06-content.md\`, «Звук, музыка, шрифты»). Пересобрать — та же
команда: шум берётся из генератора игры с постоянным зерном, файлы выходят те же. Руками не править.

Общее: моно, ${RATE} Гц, 16 бит; срез верхов ${TOP_CUT} Гц. Колокольчики — частотная модуляция (отношение ${BELL.ratio},
глубина до ${BELL.index}, гаснет за ${BELL.indexSec} с). Стук — тон, падающий по частоте и гаснущий, с шумом. Комната —
реверберация Шрёдера — Мурера (гребёнки ${ROOM.combsMs.join(', ')} мс, хвост ${ROOM.decaySec} с). Генератор — копия
\`tools/sound/gen.ts\` «Больницы» (ADR 0002 устава), звуки завода — свои.

| Файл | Что | Параметры |
|---|---|---|
${rows}
`;
}

if (import.meta.main) {
  for (const s of SOUNDS) {
    const x = s.make();
    writeFileSync(join(OUT, s.file), wav(x));
    console.log(`${s.file}: ${(x.length / RATE).toFixed(2)} с, ${Math.round((x.length * 2 + 44) / 1024)} КБ`);
  }
  writeFileSync(join(OUT, 'LICENSES.md'), licenses());
  console.log('звуки записаны в assets/audio');
}
