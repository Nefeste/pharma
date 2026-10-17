// из bolnitsa: tools/test/worker.test.ts @ e0a3491 — изменено: завод вместо смены.
// Движок в отдельном потоке (docs/02-architecture.md, §10): завод в `worker_threads` — кадрами ×4 (120 игровых секунд при
// 60 к/с) с бюджетом 4 мс — даёт то же состояние, что в основном потоке часами.
import { describe, expect, test } from 'bun:test';
import { Worker } from 'node:worker_threads';
import { db } from '../../src/content';
import { DAY } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, newPlant } from '../../src/engine/engine';
import { fromSave } from '../../src/engine/save';
import { H } from '../../src/sim/pack';
import type { FromSim, ToSim } from '../../src/sim/protocol';

function call(w: Worker, msg: ToSim): Promise<FromSim> {
  return new Promise(resolve => {
    w.once('message', resolve);
    w.postMessage(msg);
  });
}

describe('поток расчёта', () => {
  test('завод в worker_threads, кадрами с бюджетом, — то же состояние, что в основном потоке', async () => {
    const s = newPlant(db, { scenario: 'scn.proto', seed: 21 });
    const end = s.t + 3 * DAY;
    while (s.t < end) apply(db, s, { kind: 'advance', seconds: Math.min(3600, end - s.t) });

    const w = new Worker(new URL('./sim-worker.ts', import.meta.url));
    try {
      const first = await call(w, { kind: 'start', scenario: 'scn.proto', seed: 21 });
      expect(first.kind).toBe('slice');
      let mornings = 0;
      let lag = 0;
      for (let i = 0; i < (3 * DAY) / 120; i++) {
        const r = await call(w, { kind: 'tick', seconds: 120, budgetMs: 4 });
        if (r.kind !== 'slice') throw new Error(r.kind === 'error' ? r.message : r.kind);
        mornings += r.notices.filter(n => n.kind === 'morning').length;
        lag = r.lag;
      }
      for (let k = 0; lag > 0 && k < 10_000; k++) {
        const r = await call(w, { kind: 'tick', seconds: 0, budgetMs: 4 });
        if (r.kind === 'slice') lag = r.lag;
      }
      expect(lag).toBe(0);
      expect(mornings).toBe(3);
      const saved = await call(w, { kind: 'save' });
      if (saved.kind !== 'saved') throw new Error(saved.kind);
      const back = fromSave(db, saved.json);
      expect(back.t).toBe(s.t);
      expect(fingerprint(back)).toBe(fingerprint(s));
    } finally {
      await w.terminate();
    }
  });

  test('срез: заголовок с часами и сутками', async () => {
    const w = new Worker(new URL('./sim-worker.ts', import.meta.url));
    try {
      const r = await call(w, { kind: 'start', scenario: 'scn.proto' });
      if (r.kind !== 'slice') throw new Error(r.kind);
      expect(r.buf.length).toBe(H.size);
      expect(r.buf[H.t]).toBe(db.scenarios['scn.proto'].start.hour * 3600);
      expect(r.buf[H.day]).toBe(0);
      const e = await call(w, { kind: 'command', cmd: { kind: 'advance', seconds: DAY } });
      if (e.kind !== 'slice') throw new Error(e.kind);
      expect(e.buf[H.day]).toBe(1);
    } finally {
      await w.terminate();
    }
  });
});
