// Прогон для tools/test/v8.test.ts: тот же завод, что в золотом прогоне, — в Node (V8). Печатает отпечаток состояния.
import { db } from '../../src/content';
import { DAY } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, newPlant } from '../../src/engine/engine';

export function run(days: number): string {
  const s = newPlant(db, { scenario: 'scn.proto' });
  const end = s.t + days * DAY;
  while (s.t < end) apply(db, s, { kind: 'advance', seconds: 3600 });
  return fingerprint(s);
}

if (typeof Bun === 'undefined') console.log(run(Number(process.argv[2] ?? 90)));
