// Образец сохранения текущей схемы для tools/test/engine.test.ts. Запускается один раз при смене схемы: старые образцы
// не перезаписываются — к ним добавляется новый (save-vN.json), а тест читает все.
//   bun tools/test/make-save-fixture.ts
// С схемы 4 образец берётся посреди работы: идёт стадия серии и ВЭЖХ считает сама — в снимке заняты помещение,
// оборудование и прибор, в очереди события конца стадии и работы прибора, резерв и комплекты серий. С схемы 5 — ещё и
// линия посреди упаковки: позиции машин и накопители, микроостановка, собираемая паллета ГП, смена у линии; а стадия
// серии или ВЭЖХ — хотя бы что-то одно.
import { writeFileSync } from 'node:fs';
import { db } from '../../src/content';
import { DAY, MIN } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { toSave } from '../../src/engine/save';
import { SCHEMA } from '../../src/engine/types';

const s = newPlant(db, { scenario: 'scn.proto', seed: 1 });
const end = s.t + 120 * DAY;
const packing = () => Object.values(s.lines).some(l => l.batch && s.batches[l.batch].pack?.state === 'running' && l.cases > 0 && l.pallet && l.machines.some(m => m.down !== undefined));
const running = () => Object.values(s.tests).some(q => q.state === 'run');
const stage = () => Object.values(s.tasks).some(t => t.kind === 'stage' && t.state === 'busy');
const busy = () => (SCHEMA < 5 ? running() && stage() : packing() && (running() || stage()));
while (s.t < end && !busy()) apply(db, s, { kind: 'advance', seconds: 10 * MIN });
writeFileSync(new URL(`./fixtures/save-v${SCHEMA}.json`, import.meta.url), `${toSave(s)}\n`);
console.log(`fixtures/save-v${SCHEMA}.json: сутки ${s.day}, испытаний ${Object.keys(s.tests).length}`);
