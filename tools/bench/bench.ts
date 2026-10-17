// Бенч движка (docs/02-architecture.md, §15; docs/specs/2026-10-engine.md, «Критерии приёмки»): сколько стоят игровые
// сутки и год сценария без окна. Итог — строка JSON; сравнивать с прошлым замером при каждой правке src/engine/.
//   bun tools/bench/bench.ts [--days 365] [--seed 1] [--step 3600]
import { db } from '../../src/content';
import { DAY } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';

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
