// Образец сохранения текущей схемы для tools/test/engine.test.ts. Запускается один раз при смене схемы: старые образцы
// не перезаписываются — к ним добавляется новый (save-vN.json), а тест читает все.
//   bun tools/test/make-save-fixture.ts
// С схемы 4 образец берётся посреди работы: идёт стадия серии и ВЭЖХ считает сама — в снимке заняты помещение,
// оборудование и прибор, в очереди события конца стадии и работы прибора, резерв и комплекты серий.
import { writeFileSync } from 'node:fs';
import { db } from '../../src/content';
import { DAY, MIN } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { toSave } from '../../src/engine/save';
import { SCHEMA } from '../../src/engine/types';

const s = newPlant(db, { scenario: 'scn.proto', seed: 1 });
const end = s.t + 120 * DAY;
const busy = () => Object.values(s.tests).some(q => q.state === 'run') && Object.values(s.tasks).some(t => t.kind === 'stage' && t.state === 'busy');
while (s.t < end && !busy()) apply(db, s, { kind: 'advance', seconds: 10 * MIN });
writeFileSync(new URL(`./fixtures/save-v${SCHEMA}.json`, import.meta.url), `${toSave(s)}\n`);
console.log(`fixtures/save-v${SCHEMA}.json: сутки ${s.day}, испытаний ${Object.keys(s.tests).length}`);
