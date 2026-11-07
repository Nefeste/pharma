// Совещание S&OP (Б6г; docs/specs/2026-10-vertical-slice.md, «Б6г»; геймдизайн, §9.2, §29.4): раз в месяц, в третий
// рабочий день в 10:00, начальник отдела планирования приносит план — лучший по марже (plan/sop.ts). Игрок на месте
// директора или «Производства» утверждает его или свой — команда `sop`, мир встаёт на извещении; без них план
// утверждает директор-коллега. План — цель запаса по продукту и месяцу: её берёт правило задания вместо политики
// «запас позиций». Плана на месяц нет — политика, как до Б6г.
import type { ContentDb, Id } from '../content/types';
import { addWorkdays, daysFromCivil, HOUR, isWorkday, momentOf } from './core/calendar';
import { firstDay, monthAt, monthOfDay } from './forecast';
import { note } from './journal';
import { SOP_COVERS, SOP_MONTHS, sopBest, sopCtx, sopEval } from './plan/sop';
import { held } from './seats';
import type { Command, Notice, PlantState } from './types';
import { calOf } from './workdays';

/** Совещание — в третий рабочий день месяца, в 10:00 (§9.2): 1-го — прогноз, следующий рабочий день — план предложения. */
export const SOP_WORKDAY = 3;
export const SOP_HOUR = 10 * HOUR;

/** Утверждённых планов в состоянии — не больше. */
const KEEP = 12;

/** День совещания в месяце `n` (номер месяца прогноза). */
export function sopDay(db: ContentDb, s: PlantState, n: number): number {
  const cal = calOf(db, s);
  let z = firstDay(n);
  if (!isWorkday(cal, z)) z = addWorkdays(cal, z, 1);
  return addWorkdays(cal, z, SOP_WORKDAY - 1);
}

/** Цель запаса продукта на день `z` по последнему утверждённому плану, что его покрывает; нет — `undefined`. */
export function sopCover(s: PlantState, product: Id, z: number): number | undefined {
  const plans = s.planning.sop?.plans;
  if (!plans) return undefined;
  const n = monthOfDay(z);
  for (let i = plans.length - 1; i >= 0; i--) {
    const p = plans[i];
    if (n >= p.from && n < p.from + SOP_MONTHS) return p.cover[product]?.[n - p.from];
  }
  return undefined;
}

/** Держит ли игрок место, которое ведёт совещание: директор или «Производство». */
const playerMeets = (s: PlantState) => !!held(s)?.some(x => x === 'director' || x === 'production');

function approve(s: PlantState, from: number, cover: Record<Id, number[]>, by: string, value: number, best: number) {
  const sop = (s.planning.sop ??= { plans: [] });
  sop.plans.push({ at: s.t, from, cover, by, value, best });
  if (sop.plans.length > KEEP) sop.plans.splice(0, sop.plans.length - KEEP);
  delete sop.open;
}

/**
 * Каждый час: в 10:00 дня совещания — лучший план. Игрок на месте директора или «Производства» — совещание открыто и ждёт
 * его «Утвердить»; нет — план утверждает директор-коллега, запись журнала начальника отдела планирования.
 */
export function sopHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  if (!s.planning.forecast || !db.scenarios[s.scenario].plan) return;
  const now = momentOf(s.start, s.t);
  if (now.sec !== SOP_HOUR) return;
  const n = monthAt(s, s.t);
  if (s.planning.sop?.held === n || now.day !== sopDay(db, s, n)) return;
  const ctx = sopCtx(db, s, n);
  const best = sopBest(db, s, n, ctx);
  const sop = (s.planning.sop ??= { plans: [] });
  sop.held = n;
  if (playerMeets(s)) {
    sop.open = { at: s.t, from: n, best: best.cover, value: best.result.mean };
    notices.push({ kind: 'sop', m: n, open: true });
    return;
  }
  approve(s, n, best.cover, 'head:plan', best.result.mean, best.result.mean);
  note(s, 'plan', { kind: 'sop', from: n, cover: best.cover, value: best.result.mean, best: best.result.mean, lost: best.result.lost });
  notices.push({ kind: 'sop', m: n, open: false });
}

/**
 * «Утвердить» (Б6г): план открытого совещания — цели по всем продуктам плана выпуска, по 6 месяцев, из вариантов
 * политики «запас позиций». Совещания нет — отказ.
 */
export function sopCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'sop' }>, notices: Notice[]) {
  const open = s.planning.sop?.open;
  if (!open) return notices.push({ kind: 'refused', cmd: 'sop', why: 'noMeeting' });
  const products = [...new Set(db.scenarios[s.scenario].plan!.items.map(i => db.skus[i.sku].product))];
  const ok = products.every(p => cmd.cover[p]?.length === SOP_MONTHS && cmd.cover[p].every(c => (SOP_COVERS as readonly number[]).includes(c)));
  if (!ok || Object.keys(cmd.cover).some(p => !products.includes(p))) return notices.push({ kind: 'refused', cmd: 'sop', why: 'badPlan' });
  const cover = Object.fromEntries(products.map(p => [p, [...cmd.cover[p]]]));
  const r = sopEval(sopCtx(db, s, open.from), cover);
  approve(s, open.from, cover, cmd.by ?? 'player', r.mean, open.value);
  note(s, 'player', { kind: 'sop', from: open.from, cover, value: r.mean, best: open.value, lost: r.lost }, held(s)?.includes('director') ? 'director' : 'production');
}

/** Мгновение совещания месяца `n` — для окна и планёрки. */
export const sopAt = (db: ContentDb, s: PlantState, n: number) => (sopDay(db, s, n) - daysFromCivil(s.start)) * 86400 + SOP_HOUR;
