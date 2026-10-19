// Поток прогона плана для теста (tools/test/twin.test.ts): обёртка `planRun` для `worker_threads` Node/Bun. В окне — та же
// обёртка над `self.onmessage` Web Worker'а (src/sim/planWorker.ts). База — собранный бандл (`src/content`), как в игре.
import { parentPort } from 'node:worker_threads';
import { db } from '../../src/content';
import { planRun } from '../../src/sim/planHost';
import type { ToPlan } from '../../src/sim/protocol';

parentPort!.on('message', (msg: ToPlan) => planRun(db, msg, m => parentPort!.postMessage(m)));
