/**
 * Цели сценария (Б9; геймдизайн, §15.1; docs/specs/2026-10-vertical-slice.md, «Б9»): чистые функции записей завода за
 * срок сценария, как показатели руководителей (Б5ж), — истины не читают. Срок — от старта игрока, после прогрева.
 */
import type { ContentDb, Goal } from '../content/types';
import { DAY, HOUR } from './core/calendar';
import { decidedAt, kpiPick, sincePeriod } from './kpi';
import { scnZero } from './carry';
import { sameDev } from './devclass';
import type { PlantState } from './types';

/** Мгновение старта игрока и конца сценария; конца нет — сценарий без срока. */
export function goalSpan(db: ContentDb, s: Pick<PlantState, 'scenario' | 'start'>): { from: number; to?: number } {
  const sc = db.scenarios[s.scenario];
  // сутки сценария — от его даты (Б9, шаг 4): у завода из прежнего сценария кампании она позже первой даты завода
  const from = scnZero(db, s) + sc.start.hour * HOUR + sc.warm;
  return sc.days !== undefined ? { from, to: from + sc.days } : { from };
}

/** Что цель видит сейчас: число в единицах движка; `undefined` — ещё нечего считать (нет закрытых заказов). */
export function goalValue(db: ContentDb, s: PlantState, g: Goal): number | undefined {
  const span = goalSpan(db, s);
  const to = span.to;
  const from = Math.max(span.from, g.from === undefined ? 0 : scnZero(db, s) + g.from);
  const until = to === undefined ? s.t : Math.min(s.t, to);
  switch (g.kind) {
    case 'released':
      return Object.values(s.batches).filter(b => b.status === 'released' && (decidedAt(s, b) ?? -1) >= from && (decidedAt(s, b) ?? Infinity) <= until).length;
    case 'otif':
      return kpiPick(db, s, { ...sincePeriod(s, from), to: until }, ['otifOrders']).otifOrders;
    case 'cash':
      // касса к концу срока — по проводкам: журнал кассы не укорачивается, после конца сценария число то же
      return s.cash.ledger.reduce((n, e) => (e.t <= until ? n + e.sum : n), s.cash.start);
    case 'lateDevs':
      return Object.values(s.deviations).filter(d => d.opened >= from && d.opened <= until && d.late).length;
    case 'missDays':
      return missDays(s, from, until);
    case 'noRepeat':
      return noRepeat(s, from, until);
  }
}

/**
 * Суток без повтора (Д1): у CAPA, сделанной в срок цели и проверенной «эффективна», — от её выполнения до конца, пока
 * такого же отклонения после выполнения нет; лучшая из них. Нет такой CAPA — нечего считать. Только записи CAPA и
 * отклонений.
 */
export function noRepeat(s: PlantState, from: number, until: number): number | undefined {
  let best: number | undefined;
  for (const c of Object.values(s.capas)) {
    if (c.done === undefined || c.done < from || c.done > until || !c.check?.ok || c.check.t > until) continue;
    const d = s.deviations[c.dev];
    if (!d) continue;
    const again = Object.values(s.deviations).some(x => x.id !== d.id && x.opened > c.done! && x.opened <= until && sameDev(x, d));
    const v = again ? 0 : Math.floor((until - c.done) / DAY);
    best = best === undefined ? v : Math.max(best, v);
  }
  return best;
}

/**
 * Дни срыва заказов (Б9, шаг 3): сутки, в которые заказ покупателя должен был уйти и не ушёл целиком, — от дня срока до
 * дня отгрузки: опоздал — до дня перед отгрузкой, недопоставка — включая день отгрузки, открыт после срока — по сей
 * день. Сутки считаются один раз, сколько бы заказов в них ни сорвалось. Только записи заказов и отгрузок.
 */
export function missDays(s: PlantState, from: number, until: number): number {
  const days = new Set<number>();
  const last = Math.floor(until / DAY);
  for (const o of Object.values(s.orders)) {
    if (o.due < from || o.due > until || o.status === 'shipped') continue;
    const first = Math.floor(o.due / DAY);
    const sh = o.shipment ? s.shipments[o.shipment] : undefined;
    let end: number;
    if (o.status === 'open') {
      if (until <= o.due) continue;
      end = last;
    } else if (!sh) end = first;
    else end = o.status === 'late' ? Math.floor(sh.t / DAY) - 1 : Math.floor(sh.t / DAY);
    for (let d = first; d <= Math.min(end, last); d++) days.add(d);
  }
  return days.size;
}

/** Выполнена ли цель: «не меньше» у серий, доли и кассы, «не больше» у отклонений с прошедшим сроком. */
export function goalMet(g: Goal, v: number | undefined): boolean {
  const most = g.kind === 'lateDevs' || g.kind === 'missDays';
  if (v === undefined) return most;
  return most ? v <= g.v : v >= g.v;
}

/** Все цели сценария сейчас — для окна и итога: значение и выполнена ли; `ended` — срок сценария прошёл. */
export function goalsNow(db: ContentDb, s: PlantState): { goals: { goal: Goal; v?: number; met: boolean }[]; ended: boolean } {
  const sc = db.scenarios[s.scenario];
  const { to } = goalSpan(db, s);
  return {
    goals: sc.goals.map(goal => {
      const v = goalValue(db, s, goal);
      return { goal, ...(v !== undefined ? { v } : {}), met: goalMet(goal, v) };
    }),
    ended: to !== undefined && s.t >= to,
  };
}
