// Цена правки плана словами (Б6е; docs/specs/2026-10-vertical-slice.md, «Б6е»): генеральные и малые уборки с часами
// работы, переналадки линии, задания, которые кончат позже, — до трёх по убыванию, остальные числом. Нулевые части не
// пишем; всё ноль — «не прибавит». Числа — из движка (src/engine/plan/price.ts).
import type { EditPrice } from '../engine/types';
import { hText, T } from '../i18n';

/** Сколько заданий «позже» назвать по номеру; остальные — числом. */
export const LATER_SHOWN = 3;

/** Части цены правки: уборки, переналадки, задания позже; `label` — номер задания словами. */
export function priceParts(p: EditPrice, label: (batch: string) => string): string[] {
  const out: string[] = [];
  if (p.major !== 0) out.push(T.price.major(p.major, hText(Math.abs(p.majorSec))));
  if (p.minor !== 0) out.push(T.price.minor(p.minor, hText(Math.abs(p.minorSec))));
  if (p.formats !== 0) out.push(T.price.formats(p.formats));
  for (const x of p.later.slice(0, LATER_SHOWN)) out.push(T.price.later(label(x.batch), hText(x.sec)));
  if (p.later.length > LATER_SHOWN) out.push(T.price.more(p.later.length - LATER_SHOWN));
  return out.length > 0 ? out : [T.price.none];
}

/** Цена правки одной строкой: «Правка в замороженном горизонте: +8 генеральных уборок, 38,6 ч; …». */
export const priceLine = (p: EditPrice, label: (batch: string) => string): string => T.price.line(priceParts(p, label).join('; '));
