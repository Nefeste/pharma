// из bolnitsa: tools/test/sound.test.ts @ 15a7ad6, изменено: звуки завода, поводы стройки и оборудования, вес извещения,
// один звук на срез, громкость и подписи в хранилище окна.
// Звук, Б11 шаг 1 (docs/specs/2026-10-vertical-slice.md): файлы в assets/audio — те, что собирает tools/sound/gen.ts, у
// каждого строка в реестре; моно 44,1 кГц, тихие и короткие, без перегруза; пересборка даёт те же отсчёты. Звуки окна — те
// же, что файлы, и у каждого повод из таблицы спецификации (ADR 0023 устава, правило 6); громкость — ступенями; один и тот
// же звук — не чаще 80 мс; у стройки — свой звук по виду команды; у извещения — по весу (13-art.md, §11).
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CUES, due, GAP_MS, keepSound, keptCaptions, keptVolume, noticeCue, siteCue, sliceCue, volumeOf, VOLUMES } from '../../src/app/sound';
import type { Notice } from '../../src/engine/types';
import { licenses, RATE, SOUNDS } from '../sound/gen';

const DIR = join(import.meta.dir, '../../assets/audio');

function read(file: string): { rate: number; channels: number; bits: number; x: Int16Array } {
  const b = readFileSync(join(DIR, file));
  expect([b.toString('ascii', 0, 4), b.toString('ascii', 8, 12)]).toEqual(['RIFF', 'WAVE']);
  const n = b.readUInt32LE(40) / 2;
  const x = new Int16Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(44 + i * 2);
  return { rate: b.readUInt32LE(24), channels: b.readUInt16LE(22), bits: b.readUInt16LE(34), x };
}

describe('файлы звуков', () => {
  test('в папке ровно то, что собирает генератор, — по звуку окна на файл; реестр — тот, что пишет генератор', () => {
    const files = readdirSync(DIR).filter(f => f.endsWith('.wav')).sort();
    expect(files).toEqual(SOUNDS.map(s => s.file).sort());
    expect(files).toEqual(CUES.map(c => `${c}.wav`).sort());
    const reg = readFileSync(join(DIR, 'LICENSES.md'), 'utf8');
    expect(reg).toBe(licenses());
    for (const f of files) expect(reg).toContain(`\`${f}\``);
    expect(readFileSync(join(import.meta.dir, '../../assets/LICENSES.md'), 'utf8')).toContain('audio/LICENSES.md');
  });

  for (const s of SOUNDS) {
    test(`${s.file}: моно ${RATE} Гц, 16 бит, тихий, не длиннее 1,5 с, без перегруза; пересборка — те же отсчёты`, () => {
      const { rate, channels, bits, x } = read(s.file);
      expect([rate, channels, bits]).toEqual([RATE, 1, 16]);
      let peak = 0;
      for (const v of x) peak = Math.max(peak, Math.abs(v) / 32768);
      expect(peak).toBeGreaterThan(0.25);
      expect(peak).toBeLessThanOrEqual(0.6);
      expect(x.length / RATE).toBeLessThanOrEqual(1.5);
      // без щелчка в начале и в конце
      expect(Math.abs(x[0])).toBeLessThan(64);
      expect(Math.abs(x[x.length - 1])).toBeLessThan(64);
      // пересборка: отсчёты те же — с запасом в одну ступень на последний бит синуса другой сборки движка JavaScript
      const again = s.make();
      expect(again.length).toBe(x.length);
      let worst = 0;
      for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(Math.round(Math.max(-1, Math.min(1, again[i])) * 32767) - x[i]));
      expect(worst).toBeLessThanOrEqual(1);
    });
  }
});

describe('звуки окна', () => {
  test('у каждого звука — повод из таблицы спецификации; «внимание» — `notice`', () => {
    const spec = readFileSync(join(import.meta.dir, '../../docs/specs/2026-10-vertical-slice.md'), 'utf8');
    const b11 = spec.slice(spec.indexOf('## Б11.'), spec.indexOf('### Шаги', spec.indexOf('## Б11.')));
    const rows = [...b11.matchAll(/^ {2}\| `([a-z]+)` \| (.+?) \|$/gm)].map(m => m[1]);
    expect([...rows, 'notice'].sort()).toEqual([...CUES].sort());
    expect(b11).toContain('звук `notice`');
  });

  test('стройка и оборудование: встало — стук, снесено — два стука, не прошло — отказ; «Готово» и отмена — без звука', () => {
    for (const op of ['room', 'hull', 'door', 'zone', 'rack', 'vehicles', 'unit', 'unitMove', 'unitSwap']) expect([op, siteCue('site', op, true)]).toEqual([op, 'build']);
    for (const op of ['demolish', 'unitDrop']) expect([op, siteCue('site', op, true)]).toEqual([op, 'demolish']);
    for (const op of ['buy', 'replace', 'move']) expect([op, siteCue('equip', op, true)]).toEqual([op, 'build']);
    expect([siteCue('equip', 'remove', true), siteCue('equip', 'cancel', true), siteCue('site', 'done', true), siteCue('site', 'undo', true)]).toEqual(['demolish', undefined, undefined, undefined]);
    for (const op of ['room', 'buy', 'done']) expect(siteCue('site', op, false)).toBe('refuse');
  });

  test('вес извещения: стоп — `stop`; извещение автопаузы без стопа — `notice`; запись — тихо; найм и отказ — в ответ', () => {
    const fail = { kind: 'failure', machine: 'm', part: 'p' } as unknown as Notice;
    const hired = { kind: 'hired', person: 'P1', role: 'r', tab: 1 } as Notice;
    const refused = { kind: 'refused', cmd: 'visit', why: 'noVisit' } as unknown as Notice;
    expect(noticeCue(fail, true, false)).toBe('stop');
    expect(noticeCue(fail, false, false)).toBe('notice');
    expect(noticeCue({ kind: 'ordered' } as unknown as Notice, false, true)).toBeUndefined();
    expect(noticeCue({ kind: 'morning', day: 1 } as unknown as Notice, true, false)).toBe('meeting');
    expect(noticeCue({ kind: 'letter', id: 'let.x', from: 'mentor' } as unknown as Notice, true, false)).toBe('letter');
    expect(noticeCue({ kind: 'scenarioEnd' } as unknown as Notice, false, false)).toBe('goal');
    expect([noticeCue(hired, false, true), noticeCue(hired, false, false)]).toEqual(['hire', undefined]);
    expect([noticeCue(refused, false, true), noticeCue(refused, false, false)]).toEqual(['refuse', undefined]);
    expect(noticeCue({ kind: 'site', op: 'room', ok: true, cost: 1 } as Notice, false, true)).toBe('build');
  });

  test('в срезе — один звук, самый тяжёлый: итог, планёрка, стоп, письмо, затем ответы на команды и «внимание»', () => {
    expect(sliceCue(['notice', 'stop', undefined, 'letter'])).toBe('stop');
    expect(sliceCue(['letter', 'meeting'])).toBe('meeting');
    expect(sliceCue(['goal', 'meeting'])).toBe('goal');
    expect(sliceCue(['notice', 'build'])).toBe('build');
    expect(sliceCue([undefined])).toBeUndefined();
  });

  test('один и тот же звук — не чаще 80 мс; громкость — ступенями по 0,1; громкость и подписи — в хранилище окна', () => {
    expect(GAP_MS).toBe(80);
    expect([due(undefined, 0), due(1000, 1079), due(1000, 1080)]).toEqual([true, false, true]);
    expect(VOLUMES).toHaveLength(11);
    expect([volumeOf(0.34), volumeOf(0.36), volumeOf(-1), volumeOf(9), volumeOf(Number.NaN), volumeOf('0.5')]).toEqual([0.3, 0.4, 0, 1, 0.7, 0.7]);
    const m = new Map<string, string>();
    const keep = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect([keptVolume(keep), keptCaptions(keep)]).toEqual([0.7, false]);
    keepSound(keep, 0.3, true);
    expect([keptVolume(keep), keptCaptions(keep)]).toEqual([0.3, true]);
    keepSound(keep, 0, false);
    expect([keptVolume(keep), keptCaptions(keep)]).toEqual([0, false]);
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect([keptVolume(broken), keptCaptions(broken)]).toEqual([0.7, false]);
    keepSound(broken, 0.5, true);
  });
});
