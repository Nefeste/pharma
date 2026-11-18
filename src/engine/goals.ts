/**
 * Цели сценария (Б9; геймдизайн, §15.1; docs/specs/2026-10-vertical-slice.md, «Б9»): чистые функции записей завода за
 * срок сценария, как показатели руководителей (Б5ж), — истины не читают. Срок — от старта игрока, после прогрева.
 */
import type { ContentDb, Goal } from '../content/types';
import { HOUR } from './core/calendar';
import { decidedAt, kpiPick, sincePeriod } from './kpi';
import type { PlantState } from './types';

/** Мгновение старта игрока и конца сценария; конца нет — сценарий без срока. */
export function goalSpan(db: ContentDb, s: Pick<PlantState, 'scenario'>): { from: number; to?: number } {
  const sc = db.scenarios[s.scenario];
  const from = sc.start.hour * HOUR + sc.warm;
  return sc.days !== undefined ? { from, to: from + sc.days } : { from };
}

/** Что цель видит сейчас: число в единицах движка; `undefined` — ещё нечего считать (нет закрытых заказов). */
export function goalValue(db: ContentDb, s: PlantState, g: Goal): number | undefined {
  const { from, to } = goalSpan(db, s);
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
  }
}

/** Выполнена ли цель: «не меньше» у серий, доли и кассы, «не больше» у отклонений с прошедшим сроком. */
export function goalMet(g: Goal, v: number | undefined): boolean {
  if (v === undefined) return g.kind === 'lateDevs' ? true : false;
  return g.kind === 'lateDevs' ? v <= g.v : v >= g.v;
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
