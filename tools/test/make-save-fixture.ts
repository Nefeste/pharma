// Образец сохранения текущей схемы для tools/test/engine.test.ts. Запускается один раз при смене схемы: старые образцы
// не перезаписываются — к ним добавляется новый (save-vN.json), а тест читает все.
//   bun tools/test/make-save-fixture.ts
// С схемы 4 образец берётся посреди работы: идёт стадия серии и ВЭЖХ считает сама — в снимке заняты помещение,
// оборудование и прибор, в очереди события конца стадии и работы прибора, резерв и комплекты серий. С схемы 5 — ещё и
// линия посреди упаковки: позиции машин и накопители, микроостановка, собираемая паллета ГП, смена у линии; а стадия
// серии или ВЭЖХ — хотя бы что-то одно. С схемы 6 — отгрузка посреди погрузки: фура покупателя у рампы, паллета заказа
// едет в неё, у кассы — счета к оплате и к получению. С схемы 7 — замена узла посреди работы слесаря: запчасть в резерве,
// следующая заказана, в очереди — событие её прихода. С схемы 8 — посреди смены с заданием: сменное задание открыто,
// задачи ждут с причиной, у серий идёт время по состояниям. С схемы 9 — фура поставщика у рампы на проверке, кузов закрыт,
// а люди идут на свои посты: в очереди — события их прихода. С схемы 10 — лаборатория посреди работы: у одних испытаний
// результат готов (с мгновением), другие идут; у партий — с какого мгновения они в своём статусе. С схемы 11 — упаковка
// посреди суток: у прошлых суток — записи линии, у нынешних запись копится.
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
const loading = () => Object.values(s.tasks).some(t => t.kind === 'load' && t.state === 'busy') && s.cash.dues.some(d => d.sum > 0) && s.cash.dues.some(d => d.sum < 0);
const repairing = () => Object.values(s.tasks).some(t => t.kind === 'repair' && t.state === 'busy') && Object.values(s.spareOrders).some(o => o.status === 'ordered');
const planned = () => s.shiftTasks.some(t => t.to === undefined && t.plan > 0) && Object.values(s.tasks).some(t => t.why !== undefined);
const checking = () => Object.values(s.tasks).some(t => t.kind === 'truckCheck' && t.state === 'busy') && Object.values(s.people).some(p => p.walk);
const midLab = () => Object.values(s.tests).some(q => q.done !== undefined) && Object.values(s.tests).some(q => q.state !== 'done') && Object.values(s.lots).some(l => l.supplier !== 'start' && l.status === 'released');
const lineDays = () => s.losses.filter(d => Object.keys(d.lines).length > 0).length >= 2 && Object.values(s.lines).some(l => l.batch && s.batches[l.batch].pack?.state === 'running');
const busy = () =>
  SCHEMA < 5 ? running() && stage() : SCHEMA < 6 ? packing() && (running() || stage()) : SCHEMA < 7 ? loading() : SCHEMA < 8 ? repairing() : SCHEMA < 9 ? planned() : SCHEMA < 10 ? checking() : SCHEMA < 11 ? midLab() : lineDays();
while (s.t < end && !busy()) apply(db, s, { kind: 'advance', seconds: SCHEMA < 6 ? 10 * MIN : MIN });
writeFileSync(new URL(`./fixtures/save-v${SCHEMA}.json`, import.meta.url), `${toSave(s)}\n`);
console.log(`fixtures/save-v${SCHEMA}.json: сутки ${s.day}, испытаний ${Object.keys(s.tests).length}`);
