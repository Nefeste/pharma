// из bolnitsa: tools/test/sim-worker.ts @ e0a3491
// Поток расчёта для теста (tools/test/worker.test.ts): обёртка `createSim` для `worker_threads` Node/Bun. В Electron — та
// же обёртка над `self.onmessage` Web Worker'а (src/sim/worker.ts). База — собранный бандл (`src/content`), как в игре.
import { parentPort } from 'node:worker_threads';
import { db } from '../../src/content';
import { createSim } from '../../src/sim/host';
import type { ToSim } from '../../src/sim/protocol';

const sim = createSim(db);
parentPort!.on('message', (msg: ToSim) => {
  const out = sim.handle(msg);
  // упакованный срез — без копии, как в Web Worker (src/sim/worker.ts)
  parentPort!.postMessage(out, out.kind === 'slice' ? [out.buf.buffer as ArrayBuffer] : []);
});
