// Цели сценария словами (Б9; геймдизайн, §15.1): что требует цель и что видно сейчас — без оценок игрока (§26.1).
import type { Goal } from '../content/types';
import { money, pctText, T } from '../i18n';

/** Что требует цель. */
export function goalText(g: Goal): string {
  const w = T.campaign.goal;
  return g.kind === 'released' ? w.released(g.v) : g.kind === 'otif' ? w.otif(pctText(g.v)) : g.kind === 'cash' ? w.cash(money(g.v)) : w.lateDevs(g.v);
}

/** Число цели словами: серии и отклонения — штуки, доля — проценты, касса — рубли; нечего считать — «ещё нет». */
export function goalValueText(g: Goal, v: number | undefined): string {
  if (v === undefined) return T.campaign.none;
  return g.kind === 'otif' ? pctText(v) : g.kind === 'cash' ? money(v) : String(v);
}
