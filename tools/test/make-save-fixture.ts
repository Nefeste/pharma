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
// посреди суток: у прошлых суток — записи линии, у нынешних запись копится. С схемы 12 — поднятая партия посреди
// лаборатории: у её открытых задач приоритет выше. С схемы 13 — журнал мест: директор в первые сутки, потом производство
// и качество — одна запись закрыта, две открыты. С схемы 14 — посреди расследования: у второй серии происшествие,
// расследование открыто, игрок на посту качества сделал один шаг, другой идёт. С схемы 15 — номер серии при открытом
// расследовании: у одной серии номер короткий (досье выдано, смешивания ещё не было), у других — полный. С схемы 16 — в
// сутках потерь уже есть генеральная уборка и переналадка линии. С схемы 17 — у испытаний, и готовых, и идущих, —
// редакция спецификации. С схемы 18 — посреди обучения: человек изучает документ или его знания проверяют, а у кого-то
// запись уже обновлена в этой партии. С схемы 19 — посреди визита подрядчика: у одного актива подрядчик работает или его
// работа ждёт приёмки, а у другого запись уже принята в этой партии; обучения посреди дела здесь нет — с визитом оно не
// сходится, его держит образец схемы 18.
import { writeFileSync } from 'node:fs';
import { db } from '../../src/content';
import { DAY, MIN, momentOf } from '../../src/engine/core/calendar';
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
const rushed = () => Object.values(s.lots).some(l => l.rush) && Object.values(s.tasks).some(t => t.state === 'open' && t.lot !== undefined && s.lots[t.lot]?.rush);
const lineDays = () => s.losses.filter(d => Object.keys(d.lines).length > 0).length >= 2 && Object.values(s.lines).some(l => l.batch && s.batches[l.batch].pack?.state === 'running');
const seated = () => !!s.seats?.some(x => x.to !== undefined) && s.seats.filter(x => x.to === undefined).length === 2;
const investigating = () => Object.values(s.investigations ?? {}).some(i => i.status === 'open' && i.obs.length > 0 && i.runs.some(r => r.to === undefined));
const numbered = () => Object.values(s.batches).some(b => b.code.n > 0 && b.code.m === 0) && Object.values(s.batches).some(b => b.code.m > 0);
const opened = () => Object.values(s.investigations).some(i => i.status === 'open' && i.obs.length > 0);
const switched = () => s.losses.some(d => d.cleans.major > 0) && s.losses.some(d => d.changes.n > 0);
const specced = () => Object.values(s.tests).some(q => q.spec && q.state === 'done') && Object.values(s.tests).some(q => q.spec && q.state !== 'done');
// записи на старте — не позже дня начала партии; обновлённая в партии — позже
const day0 = momentOf(s.start, s.t).day;
const training = () => Object.values(s.tasks).some(t => (t.kind === 'train' || t.kind === 'trainCheck') && t.state === 'busy') && Object.values(s.people).some(p => Object.values(p.train).some(r => r.day > day0));
// записи активов на старте — без того, кто принял; принятая в партии — с ним
const visiting = () => Object.values(s.assets).some(a => a.visit?.from !== undefined) && Object.values(s.assets).some(a => a.recs.some(r => r.by));
const busy = () =>
  SCHEMA < 5 ? running() && stage() : SCHEMA < 6 ? packing() && (running() || stage()) : SCHEMA < 7 ? loading() : SCHEMA < 8 ? repairing() : SCHEMA < 9 ? planned() : SCHEMA < 10 ? checking() : SCHEMA < 11 ? midLab() : SCHEMA < 12 ? lineDays() : SCHEMA < 13 ? rushed() : SCHEMA < 14 ? rushed() && seated() : SCHEMA < 15 ? seated() && investigating() : seated() && numbered() && opened() && (SCHEMA < 16 || switched()) && (SCHEMA < 17 || specced()) && (SCHEMA < 18 || (SCHEMA < 19 ? training() : visiting()));
// с схемы 13 — директор с начала партии, через сутки — производство и качество
const t0 = s.t;
if (SCHEMA >= 13) apply(db, s, { kind: 'seat', seats: ['director'] });
while (s.t < end && !busy()) {
  if (SCHEMA >= 13 && s.t >= t0 + DAY && s.seats?.some(x => x.seat === 'director' && x.to === undefined)) apply(db, s, { kind: 'seat', seats: ['production', 'quality'] });
  // с схемы 12 — поднять первую партию, которая ждёт лабораторию с пробами
  if (SCHEMA >= 12 && !Object.values(s.lots).some(l => l.rush)) {
    const lot = Object.values(s.lots).find(l => l.status === 'quarantine' && l.supplier !== 'start' && l.sample);
    if (lot) apply(db, s, { kind: 'rush', lot: lot.id, by: 'player' });
  }
  // с схемы 14 — игрок на посту качества: у открытого расследования без шагов — записи лаборатории и досье серии
  if (SCHEMA >= 14)
    for (const i of Object.values(s.investigations))
      if (i.status === 'open' && i.runs.length === 0) for (const step of ['records', 'dossier']) apply(db, s, { kind: 'investigate', inv: i.id, step, by: 'player' });
  apply(db, s, { kind: 'advance', seconds: SCHEMA < 6 ? 10 * MIN : MIN });
}
writeFileSync(new URL(`./fixtures/save-v${SCHEMA}.json`, import.meta.url), `${toSave(s)}\n`);
console.log(`fixtures/save-v${SCHEMA}.json: сутки ${s.day}, испытаний ${Object.keys(s.tests).length}`);
