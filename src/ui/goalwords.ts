// Цели сценария словами (Б9; геймдизайн, §15.1): что требует цель и что видно сейчас — без оценок игрока (§26.1).
import type { Goal } from '../content/types';
import { momentOf, type Ymd } from '../engine/core/calendar';
import { money, pctText, T } from '../i18n';

/** Что требует цель; цель с даты — «с» этой даты (`start` — начало партии). */
export function goalText(g: Goal, start: Ymd): string {
  const w = T.campaign.goal;
  const what =
    g.kind === 'released' ? w.released(g.v) : g.kind === 'otif' ? w.otif(pctText(g.v)) : g.kind === 'cash' ? w.cash(money(g.v)) : g.kind === 'missDays' ? w.missDays(g.v) : g.kind === 'noRepeat' ? w.noRepeat(g.v) : w.lateDevs(g.v);
  if (g.from === undefined) return what;
  const m = momentOf(start, g.from).date;
  return w.since(T.date.full(m.d, T.date.months[m.m - 1], m.y), what);
}

/** Число цели словами: серии и отклонения — штуки, доля — проценты, касса — рубли; нечего считать — «ещё нет». */
export function goalValueText(g: Goal, v: number | undefined): string {
  if (v === undefined) return T.campaign.none;
  return g.kind === 'otif' ? pctText(v) : g.kind === 'cash' ? money(v) : String(v);
}
