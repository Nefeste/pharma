// Образец сохранения текущей схемы для tools/test/engine.test.ts. Запускается один раз при смене схемы: старые образцы
// не перезаписываются — к ним добавляется новый (save-vN.json), а тест читает все.
//   bun tools/test/make-save-fixture.ts
// С схемы 4 образец берётся посреди работы: идёт стадия серии и ВЭЖХ считает сама — в снимке заняты помещение,
// оборудование и прибор, в очереди события конца стадии и работы прибора, резерв и комплекты серий. С схемы 5 — ещё и
// линия посреди упаковки: позиции машин и накопители, микроостановка, собираемая паллета ГП, смена у линии; а стадия
// серии или ВЭЖХ — хотя бы что-то одно. С схемы 6 — отгрузка посреди погрузки: фура покупателя у рампы, паллета заказа
// едет в неё, у кассы — счета к оплате и к получению. С схемы 7 — замена узла посреди работы слесаря: запчасть в
// резерве, следующая заказана, в очереди — событие её прихода. С схемы 8 — посреди смены с заданием: сменное задание
// открыто, задачи ждут с причиной, у серий идёт время по состояниям. С схемы 9 — фура поставщика у рампы на проверке,
// кузов закрыт, а люди идут на свои посты: в очереди — события их прихода. С схемы 10 — лаборатория посреди работы: у
// одних испытаний результат готов (с мгновением), другие идут; у партий — с какого мгновения они в своём статусе. С
// схемы 11 — упаковка посреди суток: у прошлых суток — записи линии, у нынешних запись копится. С схемы 12 — поднятая
// партия посреди лаборатории: у её открытых задач приоритет выше. С схемы 13 — журнал мест: директор в первые сутки,
// потом производство и качество — одна запись закрыта, две открыты. С схемы 14 — посреди расследования: у второй серии
// происшествие, расследование открыто, игрок на посту качества сделал один шаг, другой идёт. С схемы 15 — номер серии
// при открытом расследовании: у одной серии номер короткий (досье выдано, смешивания ещё не было), у других — полный. С
// схемы 16 — в сутках потерь уже есть генеральная уборка и переналадка линии. С схемы 17 — у испытаний, и готовых, и
// идущих, — редакция спецификации. С схемы 18 — посреди обучения: человек изучает документ или его знания проверяют, а
// у кого-то запись уже обновлена в этой партии. С схемы 19 — посреди визита подрядчика: у одного актива подрядчик
// работает или его работа ждёт приёмки, а у другого запись уже принята в этой партии; обучения посреди дела здесь нет —
// с визитом оно не сходится, его держит образец схемы 18. С схемы 20 — посреди оценки поставщика: у пары идёт оценка —
// аудит у изготовителя или рассмотрение специалистом ООК, — а по рамочным договорам уже куплено; визита и расследования
// здесь нет — их держат образцы схем 19 и 14. С схемы 21 — посреди сверхурочных: кто-то кончает после смены задачу,
// взятую в смену, а у других в табеле уже есть отрезки после смены; оценки поставщика здесь нет — её держит образец
// схемы 20. С схемы 22 — посреди оценки отклонения: игрок на посту качества оценивает, что уже можно, — у одного
// отклонения работа специалиста ООК идёт, другое уже оценено; сверхурочных здесь нет — их держит образец схемы 21. С
// схемы 23 — посреди учётного периода: люди второй смены с 1 октября — в «12 ч, бригада 1», у кого-то из них в периоде
// уже есть часы после смены, а перевод механика первой смены в «12 ч, бригада 2» ждёт своего 1-го числа; оценки
// отклонений здесь нет — её держит образец схемы 22. С схемы 24 — посреди найма: принятый аппаратчик ждёт первого дня,
// по вакансии упаковщика есть кандидаты, упаковщик первой смены уже уволен по соглашению, аппаратчик второй — в свой
// последний день; бригад здесь нет — их держит образец схемы 23. С схемы 25 — посреди отпуска: график 2028 года утверждён,
// у одного человека идёт часть с заместителем и отпускные заплачены, другого уже известили о его части; найм — как в
// образце схемы 24, до января он кончился. С схемы 26 — посреди записи упаковки: линия упаковывает, у задания — люди
// своих работ и проверенная очистка линии, у сделанного задания — выдача; у другой серии стадия между отвешиванием
// и опудриванием — магния стеарат ждёт своей стадии; отпусков здесь нет — их держит образец схемы 25. С схемы 27 —
// посреди уборки помещения упаковки: оператор линии моет блистерную машину, а задание следующей серии уже на линии
// и ждёт, когда помещение будет чисто; записи упаковки посреди дела здесь нет — её держит образец схемы 26. С схемы 28 —
// посреди таблетирования с уставкой: игрок на посту качества поднял скорость ротора и блистерной, таблетирование идёт
// со своей уставкой, у сделанной стадии в записи — уставка не по цели, линия упаковывает со скоростью задания; уборки
// помещения упаковки здесь нет — её держит образец схемы 27. С схемы 29 — посреди журнала решений: записи игрока с поста
// качества — уставки и шаги расследования — и руководителей: задания на серии, заказы поставщикам, решения по партиям;
// уставки посреди стадии здесь тоже есть, но их держит образец схемы 28. С схемы 30 — посреди учёта помещений: у
// помещений учёта отрезки в разных состояниях — серия держит помещение без работы, другое убирают или налаживают, линия
// упаковывает, — а у сменного задания, которое идёт, уже есть выпуск по часам; журнал здесь тоже есть, но его держит
// образец схемы 29. С схемы 31 — посреди вывоза отклонённого: игрок на посту качества отклоняет серии ГП, коллега склада
// заказывает вывоз, фура подрядчика у рампы — кладовщик с водителем грузят или начальник ОКК подписывает передачу, — а
// прежний вывоз уже в журнале отходов; учёта помещений посреди дела здесь нет — его держит образец схемы 30. С схемы 32 —
// посреди учёта у мест: серии ждут у четырёх мест и больше — у лаборатории, линии и других, — а в сутках сохранения учёт
// уже копится; вывоза посреди дела здесь нет — его держит образец схемы 31. С схемы 34 — посреди предложений: у постов
// производства и качества руководители советуют, техслужба — «вручную» по выбору игрока; одно задание на серию принято,
// другое отклонено, третье устарело, а предложение руководителя открыто и ждёт ответа; закрытых месяцев показателей здесь
// нет — их держит образец схемы 33. С схемы 35 — посреди политик: игрок на посту производства задал запас позиций 28
// суток и замену пуансонов при 90 % ресурса, начальник планирования уже ставит задания по новому запасу, а визит
// подрядчика перенесён на последний рабочий день записи в силе и ждёт его; предложения здесь тоже есть, но их держит
// образец схемы 34. С схемы 36 — посреди замещения: начальника отдела планирования уволили по соглашению — задания на
// серию ставит и. о., начальник производства; заместитель начальника ОКК назначен игроком — начальник ООК; у главного
// механика заместителя сняли, и самого уволили — техслужбе некому решить; политик здесь нет — их держит образец схемы 35.
// С схемы 37 — посреди записки и вопроса: игрок на постах производства и качества — отделы производства «сам» — пишет
// начальнику снабжения заказ поставщику ниже минимальной партии, тот отвечает отказом с причиной; главный механик
// спрашивает «Производство» — вопрос открыт, а вторая записка ещё ждёт ответа; техслужба «вручную» и замещение здесь
// не нужны — их держат образцы схем 34 и 36. С схемы 38 — посреди CAPA: игрок на посту «Качество» оценивает отклонения,
// принимает CAPA начальника ООК и сам назначает внеочередную калибровку прибора МОК, одному отклонению задаёт класс;
// руководители постов игрока советуют: выполнить CAPA — предложения, принятые выполнены и ждут проверки эффективности, а
// калибровку главный механик предложил — предложение открыто; записок и вопросов здесь нет — их держит образец схемы 37.
// С схемы 39 — посреди заданий на серию: у заданий начальника отдела планирования — срок и «под что», игрок на посту
// «Производство» отменил задание на запас позиции до комплектовки — до его «не раньше» начальник позицию не ставит, и
// причина в журнале это называет, — а срочное задание под заказ покупателя стоит со сроком заказа; CAPA здесь тоже
// есть, но их держит образец схемы 38. С схемы 40 — ещё и посреди сменно-суточных заданий: в закрытых есть строки «позже»
// и «не сделано» с тем, чего ждали, а у сегодняшнего одни строки начаты, другие ещё нет. С схемы 42 — ещё и посреди S&OP:
// на совещании сентября пост «Производство» утвердил свой план — запас парацетамола 28 суток, — а совещание октября
// открыто и ждёт «Утвердить». С схемы 43 — ещё и посреди потребности: директор в первые сутки ускорил заказ поставщику,
// что придёт позже всех, и отменил следующий, а правило снабжения заказывало по потребности. С схемы 44 — ещё и посреди
// правок плана: у срочного задания поста «Производство» и у сдвига задания начальника в замороженном горизонте — цена в
// журнале, а события коммерции месяца уже были.
import { writeFileSync } from 'node:fs';
import { db } from '../../src/content';
import { visitLast } from '../../src/engine/assets';
import { DAY, daysFromCivil, HOUR, isWorkday, MIN, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { planOf } from '../../src/engine/plant';
import { assessBlock, linkedTests } from '../../src/engine/qa';
import { toSave } from '../../src/engine/save';
import { frozenEdge } from '../../src/engine/plan/price';
import { pendingOf } from '../../src/engine/shifts';
import { SCHEMA } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';

const s = newPlant(db, { scenario: 'scn.proto', seed: 1 });
// отпуска (Б4г) — с января 2028 года: до 9 января — по часу
const end = s.t + ((SCHEMA as number) === 25 ? 160 : 120) * DAY;
const jan9 = daysFromCivil({ y: 2028, m: 1, d: 9 });
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
// оценка пары идёт (Б3г), и по договорам уже покупали
const evaluating = () => Object.values(s.pairs).some(p => p.eval !== undefined) && Object.values(s.contracts).some(c => c.lines.some(l => l.bought > 0));
// работает после конца смены сейчас, а у другого в табеле уже есть сверхурочный отрезок (Б4а)
const overtime = () => Object.values(s.people).some(p => p.task && p.until !== undefined && s.t > p.until) && Object.values(s.people).filter(p => p.ot.length > 0).length >= 2;
// оценка отклонения идёт, а другое уже оценено (Б1г)
const assessing = () => Object.values(s.deviations).some(d => d.assess?.task !== undefined) && Object.values(s.deviations).some(d => d.assess?.done !== undefined);
// у бригады есть часы после смены в учётном периоде, а перевод другого ещё ждёт (Б4б)
const afterShift = () => Object.values(s.people).some(p => (p.sa?.segs.length ?? 0) > 0);
const rostered = () => afterShift() && Object.values(s.people).some(p => pendingOf(s, p));
// найм идёт (Б4в): принятый ждёт первого дня, есть кандидаты, кто-то уволен, кто-то уходит
const hiring = () => Object.keys(s.hires).length > 0 && Object.keys(s.candidates).length > 0 && Object.keys(s.former).length > 0 && Object.values(s.people).some(p => p.quit);
// посреди отпуска (Б4г): график утверждён, часть идёт с заместителем и отпускными, о другой уже известили
const vacation = () => {
  const z = momentOf(s.start, s.t).day;
  const all = Object.values(s.people).flatMap(p => p.away ?? []);
  return Object.values(s.leave).some(y => y.st === 'approved') && all.some(a => a.from <= z && z <= a.to && a.deputy && a.paid !== undefined) && all.some(a => a.from > z && a.told);
};
// посреди записи упаковки (Б1д): линия упаковывает, у задания — люди и проверенная очистка, у сделанного — выдача; у
// другой серии — стадия между отвешиванием и опудриванием
const recorded = () => {
  const jobs = Object.values(s.batches).flatMap(b => (b.pack ? [b.pack] : []));
  const mid = Object.values(s.batches).some(b => b.status === 'process' && b.stage >= 1 && b.stage <= 3 && b.dispensed.length > 0);
  return mid && jobs.some(j => j.state === 'running' && (j.people?.length ?? 0) > 0 && j.clear?.check !== undefined) && jobs.some(j => j.state === 'done' && j.issued);
};
// посреди уборки помещения упаковки (Б1е): машину линии моют, а задание следующей серии уже на линии и ждёт, когда
// помещение будет чисто
const lineRoom = planOf(db, s.plan).plant.lines[0].room;
const lineCleaning = () =>
  Object.values(s.tasks).some(t => t.kind === 'clean' && t.room === lineRoom && t.state === 'busy') &&
  Object.values(s.lines).some(l => l.batch !== undefined && s.batches[l.batch].pack?.state !== 'running');
// посреди таблетирования с уставкой (Б1ж): идёт стадия со своей уставкой скорости, у сделанной — уставка не по цели,
// линия упаковывает со скоростью задания не по цели
const off = (b: { recipe: string }, v: number | undefined) => v !== undefined && v !== db.recipes[b.recipe].stages.find(x => x.id === 'compress')!.params.find(x => x.id === 'speed')!.target;
const moded = () =>
  Object.values(s.batches).some(b => b.room && off(b, b.sp?.speed)) &&
  Object.values(s.batches).some(b => b.records.some(r => off(b, r.sp?.speed))) &&
  Object.values(s.lines).some(l => l.batch && s.batches[l.batch].pack?.state === 'running' && s.batches[l.batch].pack!.speed !== db.skus[s.batches[l.batch].pack!.sku].speed.target);
// посреди журнала решений (Б5а): записи игрока с поста — уставки и шаги расследования — и руководителей: задания на серии,
// заказы поставщикам, решения по партиям
const journaled = () => s.journal.some(r => r.by === 'player' && r.seat !== undefined) && (['plan', 'supply', 'qc'] as const).every(h => s.journal.some(r => r.by === h));
// посреди учёта помещений (Б1и): серия держит помещение без работы, другое убирают или налаживают, линия упаковывает; у
// сменного задания, которое идёт, — выпуск уже за два часа и больше
const floored = () => {
  const ph = new Set(Object.values(s.rooms).map(r => r.phase));
  return ph.has('held') && ph.has('clean') && ph.has('work') && s.shiftTasks.some(t => t.to === undefined && (t.hours?.length ?? 0) >= 2);
};
// посреди вывоза отклонённого (Б1з): у фуры подрядчика грузят или подписывают передачу, а прежний вывоз — в журнале отходов
const wasting = () => s.waste.log.length > 0 && Object.values(s.tasks).some(t => (t.kind === 'wasteLoad' || t.kind === 'wasteSign') && t.state === 'busy');
// посреди учёта у мест (Б1к): серии у четырёх мест и больше, среди них лаборатория и линия; в сутках сохранения учёт есть
// у двух мест и больше
const waited = () => {
  const at = new Set(Object.values(s.batches).map(b => b.place).filter(Boolean));
  return at.size >= 4 && at.has('lab') && at.has(lineRoom) && Object.keys(s.losses.at(-1)?.waits ?? {}).length >= 2;
};
// посреди учёта показателей (Б5ж): закрыты два месяца и больше, в нынешнем — несколько срезов суток; партию фуры
// разгружают — у рампы она уже, на месте ещё нет
const kpied = () => s.kpi.months.length >= 2 && s.kpi.snap.n >= 3 && Object.values(s.lots).some(l => l.docked !== undefined && l.placed === undefined);
// посреди предложений (Б5б): выбор режима у отдела, ответы всех трёх видов и открытое предложение
const how = (h: string) => s.journal.some(r => r.ask?.end?.how === h);
const asked = () => s.heads.mode.maint === 'manual' && how('ok') && how('no') && how('stale') && Object.keys(s.heads.open).length > 0;
// посреди замещения (Б5в): задание на серию от и. о., заместитель назначен игроком, у техслужбы некому решить
const bossed = () => s.journal.some(r => r.by === 'plan' && r.d.kind === 'order' && r.io) && !!s.heads.deputies?.qc && !!s.heads.noOne?.maint;
// посреди записки и вопроса (Б5д): на одну записку ответили, другая ждёт, вопрос «Просят решить» открыт
const memoed = () => s.journal.some(r => r.memo?.end?.res) && s.journal.some(r => r.memo && !r.memo.end) && !!s.heads.qs;
// посреди политик (Б5г): две политики игрока, задание на серию по новому запасу, перенесённый визит ещё впереди
const moved = () => s.journal.some(r => r.by === 'player' && r.d.kind === 'visit' && s.assets[r.d.asset]?.visit?.at === r.d.at && s.t < r.d.at);
const policied = () => s.policies.log.length >= 2 && s.journal.some(r => r.by === 'plan' && r.d.kind === 'order' && r.d.why?.cover === 28) && moved();
// посреди CAPA (Б5е): выполненная ждёт проверки, другая — ответа на предложение исполнителя; у отклонения — класс игрока
const capaed = () =>
  Object.values(s.capas).some(c => c.done !== undefined && !c.check) &&
  Object.values(s.capas).some(c => c.done === undefined && s.heads.open[`capa/${c.id}`] !== undefined) &&
  Object.values(s.deviations).some(d => d.clsBy);
// посреди заданий на серию (Б6а): отменённое игроком на запас держит позицию, причина в журнале, задание под заказ стоит
const heldRec = () => s.journal.some(r => r.by === 'plan' && r.d.kind === 'order' && r.d.why?.items.some(i => i.held) && r.d.due !== undefined);
const jobbed = () =>
  Object.values(s.batches).some(b => b.status === 'cancelled' && b.for?.kind === 'stock' && b.notBefore > s.t) &&
  Object.values(s.batches).some(b => b.for?.kind === 'order' && (b.status === 'waiting' || b.status === 'reserved')) &&
  heldRec();
// посреди заданий на сутки (Б6б): закрытые — «позже» и «не сделано» с причиной; у сегодняшнего начатые и ещё нет
const dailied = () => {
  const d = s.planning.daily ?? [];
  const rows = d.filter(x => x.closed).flatMap(x => x.rows);
  const cur = d.at(-1);
  return rows.some(r => r.res === 'late' && r.why) && rows.some(r => r.res === 'no' && r.why) && !!cur && !cur.closed && cur.rows.some(r => r.done !== undefined) && cur.rows.some(r => r.done === undefined);
};
// посреди прогноза (Б6в): у показателя отдела продаж — значение закрытого месяца, у планирования — правка игрока в силе, а
// спрос правила задания — по прогнозу
const forecasted = () =>
  s.kpi.months.some(m => m.v.fcErr !== undefined) && Object.keys(s.planning.forecast?.edits ?? {}).length > 0 && s.policies.log.some(x => x.policy === 'pol.plan.demand');
// посреди S&OP (Б6г): план игрока утверждён, а следующее совещание открыто
const sopped = () => !!s.planning.sop?.open && s.planning.sop.plans.some(p => p.by === 'player');
// посреди потребности (Б6д): заказ поставщику ускорен, другой отменён; правило заказывало по потребности
const supplied = () =>
  Object.values(s.pos).some(p => p.fast) && Object.values(s.pos).some(p => p.status === 'cancelled') && s.journal.some(r => r.d.kind === 'po' && (r.d.why ?? []).some(w => w.rule === 'need'));
// посреди правок плана (Б6е): у задания игрока и его сдвига в замороженном горизонте — цена, события коммерции уже были
const priced = (kind: string) => s.journal.some(r => r.by === 'player' && r.d.kind === kind && 'frozen' in r.d && r.d.frozen !== undefined);
const edited = () => priced('order') && priced('shift') && s.journal.some(r => r.by === 'sales');
// посреди второго источника (Б6ж): одобрение пары-кандидата идёт — пробная партия уже заказана; заказ в пути опаздывает,
// а пришедшие — с днём прихода
const PAR2 = 'sup.api-par2|mkr.api-par2';
const sourced = () =>
  ['trial', 'audit', 'dossier'].includes(s.pairs[PAR2]?.app?.step ?? '') && Object.values(s.pos).some(p => p.status === 'ordered' && p.truth !== undefined) && Object.values(s.pos).some(p => p.came !== undefined);
const busy = () =>
  SCHEMA < 5 ? running() && stage() : SCHEMA < 6 ? packing() && (running() || stage()) : SCHEMA < 7 ? loading() : SCHEMA < 8 ? repairing() : SCHEMA < 9 ? planned() : SCHEMA < 10 ? checking() : SCHEMA < 11 ? midLab() : SCHEMA < 12 ? lineDays() : SCHEMA < 13 ? rushed() : SCHEMA < 14 ? rushed() && seated() : SCHEMA < 15 ? seated() && investigating() : SCHEMA < 20 ? seated() && numbered() && opened() && (SCHEMA < 16 || switched()) && (SCHEMA < 17 || specced()) && (SCHEMA < 18 || (SCHEMA < 19 ? training() : visiting())) : SCHEMA < 21 ? seated() && numbered() && switched() && evaluating() : SCHEMA < 22 ? seated() && numbered() && switched() && overtime() : SCHEMA < 23 ? seated() && numbered() && assessing() : SCHEMA < 24 ? seated() && numbered() && rostered() : SCHEMA < 25 ? seated() && hiring() : SCHEMA < 26 ? seated() && vacation() : SCHEMA < 27 ? seated() && recorded() : SCHEMA < 28 ? seated() && lineCleaning() : SCHEMA < 29 ? seated() && moded() : SCHEMA < 30 ? seated() && journaled() : SCHEMA < 31 ? seated() && floored() : SCHEMA < 32 ? seated() && wasting() : SCHEMA < 33 ? seated() && waited() : SCHEMA < 34 ? seated() && kpied() : SCHEMA < 35 ? seated() && asked() : SCHEMA < 36 ? seated() && policied() : SCHEMA < 37 ? seated() && bossed() : SCHEMA < 38 ? seated() && memoed() : SCHEMA < 39 ? seated() && capaed() : SCHEMA < 40 ? seated() && jobbed() : SCHEMA < 41 ? seated() && jobbed() && dailied() : SCHEMA < 42 ? seated() && dailied() && forecasted() : SCHEMA < 43 ? seated() && dailied() && forecasted() && sopped() : SCHEMA < 44 ? seated() && dailied() && forecasted() && sopped() && supplied() : SCHEMA < 45 ? seated() && dailied() && forecasted() && sopped() && supplied() && edited() : seated() && dailied() && forecasted() && sopped() && supplied() && edited() && sourced();
// с схемы 13 — директор с начала партии, через сутки — производство и качество
const t0 = s.t;
const refused = new Set<string>();
if (SCHEMA >= 13) apply(db, s, { kind: 'seat', seats: ['director'] });
// с схемы 23 — директор переводит вторую смену в бригаду 1: с 1 октября; с схемы 24 — вместо этого открывает вакансии
// аппаратчика и упаковщика первой смены по объявлению
if ((SCHEMA as number) === 23) for (const p of Object.values(s.people)) if (p.shift === 'shift.b') apply(db, s, { kind: 'roster', person: p.id, shift: 'shift.c1', by: 'player' });
if (SCHEMA >= 24) for (const role of ['role.operator', 'role.packer']) apply(db, s, { kind: 'vacancy', role, shift: 'shift.a', via: 'ad', by: 'player' });
while (s.t < end && !busy()) {
  if (SCHEMA >= 13 && s.t >= t0 + DAY && s.seats?.some(x => x.seat === 'director' && x.to === undefined)) {
    apply(db, s, { kind: 'seat', seats: ['production', 'quality'] });
    // схемы 34–36 — техслужба «вручную»: выбор игрока у отдела; с схемы 37 — отделы производства «сам», а начальнику
    // снабжения — записка: заказ ниже минимальной партии
    if (SCHEMA >= 34 && SCHEMA < 37) apply(db, s, { kind: 'mode', head: 'maint', mode: 'manual', by: 'player' });
    if ((SCHEMA as number) === 37) {
      for (const head of ['plan', 'mes', 'maint'] as const) apply(db, s, { kind: 'mode', head, mode: 'auto', by: 'player' });
      apply(db, s, { kind: 'memo', cmds: [{ kind: 'po', supplier: 'sup.exc', lines: [{ material: 'mat.exc.mcc', qty: 1000 }] }] });
    }
    // с схемы 38 — планирование и производство «сам», техслужба советует (пост у игрока)
    if (SCHEMA >= 38) for (const head of ['plan', 'mes'] as const) apply(db, s, { kind: 'mode', head, mode: 'auto', by: 'player' });
    // схема 36 — замещение: начальника отдела планирования и главного механика — по соглашению, у главного механика
    // заместителя снять, начальнику ОКК — заместителем начальника ООК
    if ((SCHEMA as number) === 36) {
      for (const role of ['role.plan-head', 'role.chief-mechanic']) {
        const p = Object.values(s.people).find(x => x.role === role)!;
        apply(db, s, { kind: 'dismiss', person: p.id, why: 'agree', by: 'player' });
      }
      apply(db, s, { kind: 'deputy', head: 'maint', person: null, by: 'player' });
      apply(db, s, { kind: 'deputy', head: 'qc', person: Object.values(s.people).find(x => x.role === 'role.qa-head')!.id, by: 'player' });
    }
    // с схемы 35 — политики производства: запас позиций и замена пуансонов
    if ((SCHEMA as number) === 35) {
      apply(db, s, { kind: 'policy', policy: 'pol.plan.cover', value: 28, by: 'player' });
      apply(db, s, { kind: 'policy', policy: 'pol.maint.replace', of: 'press-1/punches', value: 9000, by: 'player' });
    }
    // с схемы 28 — на посту качества: скорость ротора обеих карт на шаг выше цели, блистерной у всех позиций — тоже
    if (SCHEMA >= 28) {
      for (const r of Object.values(db.recipes)) {
        const p = r.stages.find(x => x.id === 'compress')!.params.find(x => x.id === 'speed')!;
        apply(db, s, { kind: 'setpoint', recipe: r.id, stage: 'compress', param: 'speed', value: p.target + p.step, by: 'player' });
      }
      for (const k of Object.values(db.skus)) apply(db, s, { kind: 'setpoint', sku: k.id, value: k.speed.target + k.speed.step, by: 'player' });
    }
  }
  // с схемы 12 — поднять первую партию, которая ждёт лабораторию с пробами
  if (SCHEMA >= 12 && !Object.values(s.lots).some(l => l.rush)) {
    const lot = Object.values(s.lots).find(l => l.status === 'quarantine' && l.supplier !== 'start' && l.sample);
    if (lot) apply(db, s, { kind: 'rush', lot: lot.id, by: 'player' });
  }
  // с схемы 14 — игрок на посту качества: у открытого расследования без шагов — записи лаборатории и досье серии
  if (SCHEMA >= 14)
    for (const i of Object.values(s.investigations))
      if (i.status === 'open' && i.runs.length === 0) for (const step of ['records', 'dossier']) apply(db, s, { kind: 'investigate', inv: i.id, step, by: 'player' });
  // схема 31 — игрок на посту качества отклоняет каждую серию ГП: её паллеты едут в зону отклонённого
  if ((SCHEMA as number) === 31 && s.seats?.some(x => x.seat === 'quality' && x.to === undefined))
    for (const b of Object.values(s.batches))
      if (b.status === 'fg' && !refused.has(b.id)) {
        refused.add(b.id);
        apply(db, s, { kind: 'release', batch: b.id, decision: 'reject' });
      }
  // с схемы 22 — игрок на посту качества оценивает отклонения, которые уже можно: испытания готовы — по ним
  if (SCHEMA >= 22)
    for (const d of Object.values(s.deviations))
      if (!assessBlock(s, d)) {
        const tests = linkedTests(db, s, d);
        if (tests.every(x => x.done)) apply(db, s, { kind: 'assess', deviation: d.id, verdict: tests.some(x => x.out > 0) ? 'reject' : 'none', by: 'player' });
      }
  // с схемы 24 — первые кандидаты аппаратчика: принять первого; упаковщика первой смены и аппаратчика второй — уволить по
  // соглашению
  if (SCHEMA >= 24 && Object.keys(s.hires).length === 0 && Object.keys(s.former).length === 0) {
    const k = Object.values(s.candidates).find(c => c.role === 'role.operator');
    if (k) {
      apply(db, s, { kind: 'hire', candidate: k.id, trial: 3, by: 'player' });
      for (const [role, shift] of [['role.packer', 'shift.a'], ['role.operator', 'shift.b']]) {
        const p = Object.values(s.people).find(x => x.role === role && x.shift === shift && !x.quit);
        if (p) apply(db, s, { kind: 'dismiss', person: p.id, why: 'agree', by: 'player' });
      }
    }
  }
  // с схемы 34 — первое предложение задания на серию принять, второе отклонить; дальше — не отвечать: старое устаревает
  if (SCHEMA >= 34)
    for (const n of Object.values(s.heads.open)) {
      const r = s.journal.find(x => x.n === n);
      if (r?.by !== 'plan') continue;
      if (!how('ok')) apply(db, s, { kind: 'accept', n });
      else if (!how('no')) apply(db, s, { kind: 'decline', n });
    }
  // схема 35 — первый назначенный визит подрядчика, который можно отложить, — на последний рабочий день записи в силе
  if ((SCHEMA as number) === 35 && s.seats?.some(x => x.seat === 'production' && x.to === undefined) && !s.journal.some(r => r.by === 'player' && r.d.kind === 'visit')) {
    const today = momentOf(s.start, s.t).day;
    const cal = calOf(db, s);
    for (const a of Object.values(s.assets)) {
      if (!a.visit || a.visit.from !== undefined) continue;
      let day = visitLast(a, today);
      while (day > today && !isWorkday(cal, day)) day--;
      if (day > today + 1) {
        apply(db, s, { kind: 'visit', asset: a.id, day, by: 'player' });
        break;
      }
    }
  }
  // с схемы 38 — пост «Качество»: CAPA начальника ООК принять, у МОК — внеочередная калибровка прибора, одному
  // оценённому отклонению — класс игрока
  if (SCHEMA >= 38 && s.seats?.some(x => x.seat === 'quality' && x.to === undefined)) {
    // предложения: CAPA начальника ООК — принять; выполнить CAPA — принять, кроме калибровки: она ждёт ответа
    for (const [key, n] of Object.entries(s.heads.open))
      if (key.startsWith('capaFor/') || (key.startsWith('capa/') && s.capas[key.slice(5)]?.action !== 'capa.calib')) apply(db, s, { kind: 'accept', n });
    if (!Object.values(s.capas).some(c => c.action === 'capa.calib'))
      for (const d of Object.values(s.deviations)) if (d.kind === 'ipc' && d.status === 'open') apply(db, s, { kind: 'capa', deviation: d.id, action: 'capa.calib', by: 'player' });
    const done = Object.values(s.deviations).find(d => d.assess?.done !== undefined);
    if (done && !Object.values(s.deviations).some(d => d.clsBy)) apply(db, s, { kind: 'classify', deviation: done.id, cls: done.cls === 'minor' ? 'major' : 'minor', by: 'player' });
  }
  // с схемы 39 — пост «Производство»: отменить последнее задание начальника на запас до комплектовки; когда начальник
  // уже ставит задания со сроком и причина называет отменённое — срочное задание под открытый заказ позиции плана,
  // не раньше чем через трое суток
  if (SCHEMA >= 39 && s.seats?.some(x => x.seat === 'production' && x.to === undefined)) {
    if (!Object.values(s.batches).some(b => b.status === 'cancelled')) {
      const b = Object.values(s.batches)
        .filter(x => x.by === 'head:plan' && (x.status === 'waiting' || x.status === 'reserved') && x.notBefore > s.t + 5 * DAY)
        .sort((a, c) => c.notBefore - a.notBefore)[0];
      if (b) apply(db, s, { kind: 'cancel', batch: b.id, by: 'player' });
    }
    if (!Object.values(s.batches).some(b => b.for?.kind === 'order') && heldRec()) {
      const items = db.scenarios['scn.proto'].plan!.items;
      const o = Object.values(s.orders).find(x => x.status === 'open' && x.lines.some(l => items.some(i => i.sku === l.sku)));
      const it = o && items.find(i => o.lines.some(l => l.sku === i.sku));
      if (o && it) apply(db, s, { kind: 'order', recipe: it.recipe, sku: it.sku, for: o.id, notBefore: s.t + 3 * DAY, by: 'player' });
    }
  }
  // с схемы 45 — пост «Качество»: одобрить пару-кандидата парацетамола; пробную партию отклонили — начать заново
  if (SCHEMA >= 45 && s.seats?.some(x => x.seat === 'quality' && x.to === undefined) && (!s.pairs[PAR2]?.app || s.pairs[PAR2].app!.step === 'failed')) apply(db, s, { kind: 'pairApprove', pair: PAR2, by: 'player' });
  // с схемы 44 — пост «Производство»: задание начальника в замороженном горизонте — на сутки позже, один раз
  if (SCHEMA >= 44 && s.seats?.some(x => x.seat === 'production' && x.to === undefined) && !priced('shift')) {
    const edge = frozenEdge(db, s);
    const b = Object.values(s.batches).find(x => x.by === 'head:plan' && x.status === 'waiting' && x.notBefore > s.t + DAY && momentOf(s.start, x.notBefore).day < edge);
    if (b) apply(db, s, { kind: 'shift', batch: b.id, notBefore: b.notBefore + DAY, by: 'player' });
  }
  // с схемы 41 — пост «Производство»: спрос правила задания — по прогнозу; правка прогноза парацетамола № 20 через месяц —
  // на десятую часть выше, один раз
  if (SCHEMA >= 41 && s.planning.forecast && s.seats?.some(x => x.seat === 'production' && x.to === undefined) && !s.journal.some(r => r.d.kind === 'fcEdit')) {
    apply(db, s, { kind: 'policy', policy: 'pol.plan.demand', value: 'forecast', by: 'player' });
    const sku = 'sku.paracetamol500.n20';
    apply(db, s, { kind: 'forecast', sku, m: s.planning.forecast.at + 2, cases: Math.round((s.planning.forecast.plan[sku][2] * 11) / 10), by: 'player' });
  }
  // с схемы 43 — директор в первые сутки: заказ поставщику, что придёт позже всех, — ускорить, следующий — отменить
  if (SCHEMA >= 43 && s.seats?.some(x => x.seat === 'director' && x.to === undefined)) {
    const open = Object.values(s.pos)
      .filter(p => p.status === 'ordered')
      .sort((a, b) => b.eta - a.eta);
    if (!Object.values(s.pos).some(p => p.fast) && open[0]) apply(db, s, { kind: 'expedite', po: open[0].id, by: 'player' });
    if (!Object.values(s.pos).some(p => p.status === 'cancelled') && open[1]) apply(db, s, { kind: 'cancelPo', po: open[1].id, by: 'player' });
  }
  // с схемы 42 — совещание S&OP сентября: свой план поста «Производство», следующие совещания ждут
  if (SCHEMA >= 42 && s.planning.sop?.open && s.planning.sop.plans.length === 0)
    apply(db, s, { kind: 'sop', cover: { 'prd.paracetamol500': [28, 28, 28, 28, 28, 28], 'prd.loratadine10': [21, 21, 21, 21, 21, 21] }, by: 'player' });
  // схема 37 — вопрос открыт: вторая записка начальнику снабжения, тот же заказ
  if ((SCHEMA as number) === 37 && s.heads.qs && !s.journal.some(r => r.memo && !r.memo.end))
    apply(db, s, { kind: 'memo', cmds: [{ kind: 'po', supplier: 'sup.exc', lines: [{ material: 'mat.exc.mcc', qty: 1000 }] }] });
  // с схемы 23 — у бригады появились часы после смены: пост производства переводит механика первой смены в бригаду 2
  if ((SCHEMA as number) === 23 && afterShift() && !Object.values(s.people).some(p => pendingOf(s, p))) {
    const p = Object.values(s.people).find(x => x.role === 'role.mechanic' && x.shift === 'shift.a');
    if (p) apply(db, s, { kind: 'roster', person: p.id, shift: 'shift.c2', by: 'player' });
  }
  apply(db, s, { kind: 'advance', seconds: SCHEMA < 6 ? 10 * MIN : (SCHEMA as number) === 25 && momentOf(s.start, s.t).day < jan9 ? HOUR : MIN });
}
writeFileSync(new URL(`./fixtures/save-v${SCHEMA}.json`, import.meta.url), `${toSave(s)}\n`);
console.log(`fixtures/save-v${SCHEMA}.json: сутки ${s.day}, испытаний ${Object.keys(s.tests).length}`);
