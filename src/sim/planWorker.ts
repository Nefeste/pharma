// Поток прогона плана в окне игры (docs/specs/2026-10-plan-run.md): Web Worker над `planRun` (planHost.ts). База — тот же
// собранный `content.json`, что у страницы; пока она грузится, сообщения ждут. Поток расчёта завода при этом не стоит.
import type { ContentDb } from '../content/types';
import { planRun } from './planHost';
import type { FromPlan, ToPlan } from './protocol';

interface Scope {
  onmessage: ((e: MessageEvent<ToPlan>) => void) | null;
  postMessage(msg: FromPlan): void;
}
const scope = self as unknown as Scope;

let db: ContentDb | undefined;
const waiting: ToPlan[] = [];
const post = (m: FromPlan) => scope.postMessage(m);

scope.onmessage = e => {
  if (db) planRun(db, e.data, post);
  else waiting.push(e.data);
};

fetch('./content.json')
  .then(r => r.json() as Promise<ContentDb>)
  .then(d => {
    db = d;
    for (const m of waiting.splice(0)) planRun(d, m, post);
  })
  .catch(e => post({ kind: 'error', id: -1, message: `content.json: ${e instanceof Error ? e.message : String(e)}` }));
