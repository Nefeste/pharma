// Образец сохранения схемы 1 для tools/test/engine.test.ts. Запускается один раз при смене схемы: старые образцы не
// перезаписываются — к ним добавляется новый (save-vN.json), а тест читает все.
//   bun tools/test/make-save-fixture.ts
import { writeFileSync } from 'node:fs';
import { db } from '../../src/content';
import { DAY } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { toSave } from '../../src/engine/save';
import { SCHEMA } from '../../src/engine/types';

const s = newPlant(db, { scenario: 'scn.proto', seed: 1 });
apply(db, s, { kind: 'advance', seconds: 2 * DAY + 3600 });
writeFileSync(new URL(`./fixtures/save-v${SCHEMA}.json`, import.meta.url), `${toSave(s)}\n`);
console.log(`fixtures/save-v${SCHEMA}.json`);
