// Тревоги часа (Б2а; геймдизайн, §2, «Автопауза»): то, что становится событием только с ходом времени, — фура ждёт
// разгрузки дольше 2 часов, новому заказу покупателя не хватит ГП, материал не пришёл к серии из расписания. Каждая — одно
// извещение на вещь, в тот час, на который пришёлся её порог: (t − час, t]. Своего состояния у тревог нет — движок только
// читает завод, поэтому жизнь завода и золотой отпечаток от них не меняются. Автопаузу по извещению ставит окно
// (src/app/pauses.ts), а поток расчёта встаёт ровно на нём (src/sim/host.ts).
import type { ContentDb } from '../content/types';
import { batchNo } from './batchno';
import { HOUR } from './core/calendar';
import { orderRisks } from './market';
import type { Notice, PlantState } from './types';

/** Фура поставщика ждёт разгрузки дольше этого — тревога (геймдизайн, §2). */
export const TRUCK_WAIT = 2 * HOUR;

/** Порог пришёлся на прошедший час. */
const crossed = (s: PlantState, at: number) => at > s.t - HOUR && at <= s.t;

/**
 * Каждый час, после всего, что час сделал: фуры поставщиков, с которых через 2 часа после прихода сняли не всё; задания на
 * серию, которые к своему «не раньше» так и ждут материала, и задания на упаковку, которым его не хватило сразу; заказы
 * покупателей этого часа, которым по правилу планёрки (`orderRisks`) не хватит ящиков.
 */
export function alertsHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  for (const tr of Object.values(s.trucks))
    if (tr.po && tr.units.length > 0 && crossed(s, tr.arrived + TRUCK_WAIT)) notices.push({ kind: 'truckWait', truck: tr.id, po: tr.po, supplier: s.pos[tr.po].supplier });
  for (const b of Object.values(s.batches)) {
    if (b.status === 'waiting' && crossed(s, b.notBefore)) notices.push({ kind: 'materialLate', batch: b.id, code: batchNo(b.code), short: b.short ?? [] });
    else if (b.pack?.state === 'waiting' && crossed(s, b.pack.created)) notices.push({ kind: 'materialLate', batch: b.id, code: batchNo(b.code), pack: true, short: b.pack.short ?? [] });
  }
  if (!Object.values(s.orders).some(o => o.status === 'open' && crossed(s, o.placed))) return;
  for (const r of orderRisks(db, s)) if (crossed(s, s.orders[r.order].placed)) notices.push({ kind: 'orderRisk', ...r });
}
