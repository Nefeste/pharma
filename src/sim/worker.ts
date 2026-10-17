// из bolnitsa: src/sim/worker.ts @ e0a3491
// Поток расчёта в окне игры: Web Worker над `createSim` (host.ts). База — тот же собранный `content.json`, что у
// страницы; пока она грузится, сообщения ждут. Срез уходит без копии (transferList).
import type { ContentDb } from '../content/types';
import { createSim, type SimHost } from './host';
import type { FromSim, ToSim } from './protocol';

interface Scope {
  onmessage: ((e: MessageEvent<ToSim>) => void) | null;
  postMessage(msg: FromSim, transfer?: Transferable[]): void;
}
const scope = self as unknown as Scope;

let sim: SimHost | undefined;
const waiting: ToSim[] = [];

function reply(msg: ToSim) {
  const out = sim!.handle(msg);
  scope.postMessage(out, out.kind === 'slice' ? [out.buf.buffer as ArrayBuffer] : []);
}

scope.onmessage = e => {
  if (sim) reply(e.data);
  else waiting.push(e.data);
};

fetch('./content.json')
  .then(r => r.json() as Promise<ContentDb>)
  .then(db => {
    sim = createSim(db);
    for (const m of waiting.splice(0)) reply(m);
  })
  .catch(e => scope.postMessage({ kind: 'error', message: `content.json: ${e instanceof Error ? e.message : String(e)}` }));
