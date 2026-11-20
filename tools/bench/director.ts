// «Виртуальный директор» сценария (Б9, шаг 3; геймдизайн, §29.5, начало; docs/specs/2026-10-vertical-slice.md, «Б9»):
// сценарий с пропущенными письмами и всеми отделами «сам» до конца срока на каждом зерне — выполнены ли цели и цели «на
// отлично». Тест CI — три зерна (tools/test/winter.test.ts), длинный прогон — отсюда, отчёт — в журнал проверок.
// С `--carry` (Б9, шаг 4) — кампания подряд: сценарий 1 до конца срока, «Следующий сценарий», межсезонье и сценарий 2
// до конца своего срока на том же заводе.
//   bun tools/bench/director.ts [--seeds 20] [--scenario scn.c2] [--carry]
import { db } from '../../src/content';
import type { Id } from '../../src/content/types';
import { DAY } from '../../src/engine/core/calendar';
import { playerStart } from '../../src/engine/carry';
import { apply, newPlant } from '../../src/engine/engine';
import { goalSpan, goalsNow } from '../../src/engine/goals';

export interface DirectorRun {
  seed: number;
  /** цели без «на отлично» выполнены все */
  main: boolean;
  /** и «на отлично» тоже */
  top: boolean;
  values: (number | undefined)[];
}

/** Один прогон: новый завод сценария на зерне, письма пропущены, сутки за сутками до конца срока. */
export function direct(scenario: Id, seed: number, carry = false): DirectorRun {
  const s = newPlant(db, { scenario, seed });
  if (carry) {
    toEnd(s);
    const n = apply(db, s, { kind: 'next' });
    if (n.length && n[0]?.kind === 'refused') throw new Error(`${scenario}: переход отказан — ${JSON.stringify(n[0])}`);
    // межсезонье: письма следующего сценария приходят на его старте — пропускать их после
    const at = playerStart(db, s);
    while (s.t < at) apply(db, s, { kind: 'advance', seconds: Math.min(DAY, at - s.t) });
  }
  return toEnd(s, seed);
}

/** Письма пропущены, сутки за сутками до конца срока текущего сценария завода; итог — его цели. */
function toEnd(s: ReturnType<typeof newPlant>, seed = 0): DirectorRun {
  if (s.heads.letters) apply(db, s, { kind: 'letter', op: 'skipAll' });
  const scenario = s.scenario;
  const { to } = goalSpan(db, s);
  if (to === undefined) throw new Error(`${scenario}: у сценария нет срока`);
  while (s.t < to) apply(db, s, { kind: 'advance', seconds: Math.min(DAY, to - s.t) });
  const g = goalsNow(db, s);
  return { seed, main: g.goals.filter(x => !x.goal.top).every(x => x.met), top: g.goals.every(x => x.met), values: g.goals.map(x => x.v) };
}

if (import.meta.main) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const seeds = Number(arg('seeds') ?? 20);
  const carry = process.argv.includes('--carry');
  const list = arg('scenario') ? [arg('scenario')!] : Object.values(db.scenarios).filter(x => x.campaign !== undefined).map(x => x.id);
  for (const id of list) {
    const t0 = performance.now();
    const runs = Array.from({ length: seeds }, (_, i) => direct(id, i + 1, carry));
    const share = (f: (r: DirectorRun) => boolean) => Math.round((100 * runs.filter(f).length) / runs.length);
    console.log(JSON.stringify({ scenario: id, carry, seeds, main: share(r => r.main), top: share(r => r.top), ms: Math.round(performance.now() - t0), runs: runs.map(r => [r.seed, r.main ? 1 : 0, r.top ? 1 : 0, ...r.values]) }));
  }
}
