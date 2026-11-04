// План запуска для окна (Б6б; docs/specs/2026-10-vertical-slice.md, «Б6б»): третья вкладка расписания — дни на §9.4
// вперёд столбцами, позиции плана выпуска строками. В клетке — задания на серию по их «не раньше» (с черновиком: новые
// срочные, сдвинутые, отменённые), а дальше пунктиром — что поставит начальник отдела планирования по своему правилу без
// записи (`launchPlan`); под позициями — визиты подрядчика к оборудованию стадий и машинам линии и нерабочие дни. Всё —
// записи завода, черновик и правила движка без записи; истины нет.
import type { ContentDb, Id } from '../content/types';
import { visitPlan } from '../engine/assets';
import { DAY, daysFromCivil, isWorkday, momentOf } from '../engine/core/calendar';
import { modeOf } from '../engine/heads';
import { type Change, type Fresh, freshBatches } from '../engine/plan/schedule';
import { type Launch, launchPlan } from '../engine/planner';
import type { BatchStatus, PlantState } from '../engine/types';
import { calOf } from '../engine/workdays';

/** На сколько суток вперёд план запуска (геймдизайн, §9.4). */
export const LAUNCH_DAYS = 31;

/** Задание в клетке: его день — по «не раньше» с черновиком; под что и срок (Б6а). */
export interface LaunchJob {
  batch: string;
  sku?: Id;
  recipe: Id;
  day: number;
  notBefore: number;
  due?: number;
  goal?: { kind: 'stock' } | { kind: 'order'; order: string; customer?: Id };
  status: BatchStatus;
  /** черновик: новое срочное, новое «не раньше», отмена */
  fresh?: true;
  moved?: true;
  drop?: true;
}

/** Визит подрядчика в днях плана: назначенный или по правилу коллеги техслужбы. */
export interface LaunchVisit {
  asset: string;
  work: 'qual' | 'cal';
  day: number;
  at: number;
  booked: boolean;
}

export interface LaunchView {
  /** первый день — сегодня, номер дня от 1970-01-01; дней — §9.4 */
  from: number;
  days: number;
  /** позиции плана выпуска — строки */
  skus: { sku: Id; recipe: Id }[];
  jobs: LaunchJob[];
  /** пунктир: правило начальника отдела планирования — что и в какой свой день он поставит на день `day` */
  rule: Launch[];
  /** отдел планирования «вручную» (Б5б): пунктира нет */
  manual?: true;
  visits: LaunchVisit[];
  /** нерабочие дни плана по производственному календарю */
  off: number[];
}

/** План запуска с черновиком расписания: сдвинутые сроки, новые срочные задания, отмены — как после «Утвердить». */
export function launchView(db: ContentDb, s: PlantState, draft: readonly Change[] = [], fresh: readonly Fresh[] = [], drop: readonly string[] = []): LaunchView {
  const zero = daysFromCivil(s.start);
  const from = momentOf(s.start, s.t).day;
  const until = (from + LAUNCH_DAYS - zero) * DAY;
  const cal = calOf(db, s);
  const items = db.scenarios[s.scenario].plan?.items ?? [];
  const moved = new Map(draft.map(c => [c.batch, c.notBefore]));
  const dropped = new Set(drop);
  const dayOf = (t: number) => momentOf(s.start, t).day;
  const jobs: LaunchJob[] = [];
  for (const b of Object.values(s.batches)) {
    if (b.status === 'cancelled') continue;
    const nb = moved.get(b.id) ?? b.notBefore;
    const day = dayOf(nb);
    if (day < from || day >= from + LAUNCH_DAYS) continue;
    jobs.push({
      batch: b.id,
      ...(b.sku ? { sku: b.sku } : {}),
      recipe: b.recipe,
      day,
      notBefore: nb,
      ...(b.due !== undefined ? { due: b.due } : {}),
      ...(b.for ? { goal: b.for.kind === 'order' ? { kind: 'order' as const, order: b.for.order, ...(s.orders[b.for.order] ? { customer: s.orders[b.for.order].customer } : {}) } : { kind: 'stock' as const } } : {}),
      status: b.status,
      ...(moved.has(b.id) ? { moved: true as const } : {}),
      ...(dropped.has(b.id) ? { drop: true as const } : {}),
    });
  }
  const made = freshBatches(db, s, fresh);
  made.forEach((b, i) => {
    const nb = fresh[i].notBefore ?? s.t;
    jobs.push({
      batch: b.id,
      ...(b.sku ? { sku: b.sku } : {}),
      recipe: b.recipe,
      day: dayOf(nb),
      notBefore: nb,
      ...(b.due !== undefined ? { due: b.due } : {}),
      ...(b.for ? { goal: b.for.kind === 'order' ? { kind: 'order' as const, order: b.for.order, ...(s.orders[b.for.order] ? { customer: s.orders[b.for.order].customer } : {}) } : { kind: 'stock' as const } } : {}),
      status: b.status,
      fresh: true,
    });
  });
  const manual = modeOf(s, 'plan') === 'manual';
  const rule = manual
    ? []
    : launchPlan(db, s, until, {
        fresh: made.map((b, i) => ({ recipe: b.recipe, sku: b.sku ?? '', notBefore: fresh[i].notBefore ?? s.t })).filter(f => f.sku !== ''),
        drop,
        shift: draft,
      });
  // визиты подрядчика к оборудованию стадий и машинам линии: они держат стадию и упаковку (Б3в)
  const visits: LaunchVisit[] = visitPlan(db, s, until)
    .filter(v => s.assets[v.asset].family === 'equipment' || s.assets[v.asset].family === 'machine')
    .map(v => ({ asset: v.asset, work: v.work, day: dayOf(v.at), at: v.at, booked: !!s.assets[v.asset].visit }));
  const off: number[] = [];
  for (let d = from; d < from + LAUNCH_DAYS; d++) if (!isWorkday(cal, d)) off.push(d);
  return {
    from,
    days: LAUNCH_DAYS,
    skus: items.map(it => ({ sku: it.sku, recipe: it.recipe })),
    jobs: jobs.sort((a, c) => a.notBefore - c.notBefore || Number(a.batch.slice(1)) - Number(c.batch.slice(1))),
    rule,
    ...(manual ? { manual: true as const } : {}),
    visits,
    off,
  };
}
