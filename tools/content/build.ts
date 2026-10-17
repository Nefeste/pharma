// npm run content — собрать базу игры из content/ в src/content/generated/bundle.json (docs/02-architecture.md, §12).
// Ошибки валидатора останавливают сборку: база с битой ссылкой в игру не попадает. Бандл в репозиторий не идёт.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDb } from './load';

const OUT = join(import.meta.dir, '../../src/content/generated');

const { db, errors, files } = buildDb();
if (errors.length) {
  for (const e of errors) console.error(`ошибка: ${e}`);
  console.error(`\nБаза не собрана: ${errors.length} ошибок в ${files} файлах.`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'bundle.json'), JSON.stringify(db));
const n = (r: object) => Object.keys(r).length;
console.log(
  `База ${db.hash}: профилей ${n(db.profiles)}, сценариев ${n(db.scenarios)}, планов ${n(db.plants)}, материалов ${n(db.materials)}, тары ${n(db.containers)}, ` +
    `поставщиков ${n(db.suppliers)}, ролей ${n(db.roles)}, техники ${n(db.vehicles)}, графиков ${n(db.shifts)}, грузовых единиц ${n(db.units)}; файлов ${files}.`,
);
