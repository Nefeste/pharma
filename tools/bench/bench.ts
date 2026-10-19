// Бенч движка (docs/02-architecture.md, §15; docs/specs/2026-10-engine.md, «Критерии приёмки»): сколько стоят игровые
// сутки и год сценария без окна. Итог — строка JSON; сравнивать с прошлым замером при каждой правке src/engine/. С
// `--plan` — ещё прогон плана (docs/specs/2026-10-plan-run.md): со снимка через `days` суток — 14 суток × 5 зёрен × 2
// варианта, как кнопка «Прогнать план» с черновиком.
//   bun tools/bench/bench.ts [--days 365] [--seed 1] [--step 3600] [--plan]
import { db } from '../../src/content';
import { DAY } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { runPlan } from '../../src/engine/plan/run';

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const days = arg('days', 365);
const seed = arg('seed', 1);
const step = arg('step', 3600);

const t0 = performance.now();
const s = newPlant(db, { scenario: 'scn.proto', seed });
const end = s.t + days * DAY;
let events = 0;
while (s.t < end) {
  const before = s.agenda.seq;
  apply(db, s, { kind: 'advance', seconds: Math.min(step, end - s.t) });
  events += s.agenda.seq - before;
}
const ms = performance.now() - t0;
console.log(
  JSON.stringify({
    scenario: 'scn.proto',
    days,
    step,
    ms: Math.round(ms),
    msPerDay: Math.round((ms / days) * 100) / 100,
    eventsScheduled: events,
    lots: Object.keys(s.lots).length,
    units: Object.keys(s.units).length,
  }),
);

if (process.argv.includes('--plan')) {
  // вариант «черновик»: первое задание, ещё не начавшее комплектовку, — на сутки позже
  const next = Object.values(s.batches).find(b => b.status === 'waiting' || b.status === 'reserved');
  const draft = next ? [{ kind: 'shift' as const, batch: next.id, notBefore: next.notBefore + DAY, by: 'player' }] : [];
  const p0 = performance.now();
  for (const v of [[], draft]) runPlan(db, s, v, { days: 14, seeds: 5 });
  console.log(JSON.stringify({ plan: { from: days, horizon: 14, seeds: 5, variants: 2, ms: Math.round(performance.now() - p0) } }));
}
