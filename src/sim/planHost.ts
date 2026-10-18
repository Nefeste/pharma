// Прогон плана в своём потоке (docs/specs/2026-10-plan-run.md, «Второй поток»): снимок строкой — в состояние, каждый
// вариант — на всех зёрнах (src/engine/plan/run.ts), итог варианта — как только готов. Без привязки к виду потока: Web
// Worker окна (planWorker.ts), `worker_threads` в тестах — у каждого своя тонкая обёртка.
import type { ContentDb } from '../content/types';
import { runPlan, summarize } from '../engine/plan/run';
import { fromSave } from '../engine/save';
import { labels } from './plan';
import type { FromPlan, ToPlan } from './protocol';

export function planRun(db: ContentDb, msg: ToPlan, post: (m: FromPlan) => void) {
  const t0 = performance.now();
  try {
    const s = fromSave(db, msg.json);
    msg.variants.forEach((variant, index) => {
      const t = performance.now();
      const sum = summarize(runPlan(db, s, variant, { days: msg.days, seeds: msg.seeds }), msg.days);
      const batches = labels(s, sum.batches.map(b => b.batch));
      post({ kind: 'variant', id: msg.id, index, at: s.t, sum, batches, ms: Math.round(performance.now() - t) });
    });
    post({ kind: 'done', id: msg.id, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    post({ kind: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) });
  }
}
