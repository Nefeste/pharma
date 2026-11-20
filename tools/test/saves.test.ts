// Сохранения в окне (docs/specs/2026-10-vertical-slice.md, «Сохранения»; src/app/saves.ts — из bolnitsa): утренние —
// три, сдвигом; свои — следующий номер; список — новые сверху; снимок — gzip строки, окно его не разбирает; поток
// открывает его и играет дальше так же, как без сохранения.
import { describe, expect, test } from 'bun:test';
import { gzip, listSlots, memoryDisk, nextManual, readSlot, removeSlot, type SaveMeta, writeAuto, writeSlot } from '../../src/app/saves';
import { db } from '../../src/content';
import { HOUR } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, newPlant } from '../../src/engine/engine';
import { toSave } from '../../src/engine/save';
import { createSim } from '../../src/sim/host';

const meta = (kind: SaveMeta['kind'], t: number, at: string): SaveMeta => ({ kind, savedAt: at, version: '0.0.94', scenario: 'scn.c1', start: { y: 2027, m: 9, d: 13 }, t });
const bytes = (s: string) => new TextEncoder().encode(s);

describe('сохранения: ячейки', () => {
  test('утренних — три, новое — первое; свои — следующий номер; список — новые сверху; удалить — оба файла', async () => {
    const d = memoryDisk();
    for (let i = 1; i <= 4; i++) await writeAuto(d, bytes(`a${i}`), meta('auto', i, `2026-11-20T0${i}:00`));
    expect([...d.files.keys()].filter(n => n.endsWith('.save')).sort()).toEqual(['auto-1.save', 'auto-2.save', 'auto-3.save']);
    expect(new TextDecoder().decode(d.files.get('auto-1.save'))).toBe('a4');
    expect(new TextDecoder().decode(d.files.get('auto-3.save'))).toBe('a2');
    expect(await nextManual(d)).toBe('manual-1');
    await writeSlot(d, 'manual-1', bytes('m'), meta('manual', 9, '2026-11-20T09:00'));
    expect(await nextManual(d)).toBe('manual-2');
    d.files.set('broken.save', bytes('x'));
    const rows = await listSlots(d);
    expect(rows.map(r => r.slot)).toEqual(['manual-1', 'auto-1', 'auto-2', 'auto-3', 'broken']);
    expect(rows.at(-1)?.meta).toBeNull();
    await removeSlot(d, 'manual-1');
    expect([...d.files.keys()].some(n => n.startsWith('manual-1'))).toBe(false);
  });

  test('снимок — gzip строки; открытый потоком — тот же завод и дальше идёт так же', async () => {
    const s = newPlant(db, { scenario: 'scn.c1' });
    apply(db, s, { kind: 'advance', seconds: 30 * HOUR });
    const json = toSave(s);
    const d = memoryDisk();
    const z = await gzip(json);
    expect(z.length).toBeLessThan(json.length / 3);
    await writeSlot(d, 'manual-1', z, meta('manual', s.t, '2026-11-20T10:00'));
    const back = await readSlot(d, 'manual-1');
    expect(back).toBe(json);
    const sim = createSim(db);
    sim.handle({ kind: 'start', scenario: 'scn.proto' });
    const r = sim.handle({ kind: 'load', json: back });
    expect(r.kind === 'slice' && r.fresh).toBe(true);
    apply(db, s, { kind: 'advance', seconds: 6 * HOUR });
    sim.handle({ kind: 'tick', seconds: 6 * HOUR, budgetMs: 60_000 });
    const saved = sim.handle({ kind: 'save' });
    if (saved.kind !== 'saved') throw new Error(saved.kind);
    expect(fingerprint(saved.json)).toBe(fingerprint(toSave(s)));
  });

  test('не сохранение — ошибка потока, завод прежний', async () => {
    const sim = createSim(db);
    sim.handle({ kind: 'start', scenario: 'scn.proto' });
    expect(sim.handle({ kind: 'load', json: '{"x":1}' }).kind).toBe('error');
    expect(sim.handle({ kind: 'tick', seconds: 60, budgetMs: 1000 }).kind).toBe('slice');
  });
});
