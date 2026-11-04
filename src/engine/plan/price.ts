// Цена правки плана (Б6е; docs/specs/2026-10-vertical-slice.md, «Б6е»; геймдизайн, §9.2, §9.3): прогон расписания
// (schedule.ts) на горизонт цены — 21 сутки сценария — с правкой и без неё, чистая функция: состояние не меняется. Правка
// — новые задания, новые «не раньше» и снятые задания, как их отдадут команды `order`, `shift` и `cancel`. Цена —
// разница: генеральные и малые уборки помещений (по полосам уборки помещения) и их работа — мойка и уборка, смены
// формата у линии по порядку серий — по концу последней стадии, начиная с формата линии сейчас, и задания, которые кончат
// стадии позже, и на сколько. Прогон линий не знает, поэтому переналадка — по формату, а не по полосе. Край замороженного
// горизонта — рабочий день политики планирования (planner.ts): задание раньше этого дня — в горизонте.
import type { ContentDb, Id } from '../../content/types';
import { addWorkdays, DAY, momentOf } from '../core/calendar';
import { frozenOf } from '../planner';
import type { Batch, EditPrice, PlantState } from '../types';
import { calOf } from '../workdays';
import { type Change, type Forecast, type Fresh, forecast, freshBatches } from './schedule';

/** Горизонт цены по умолчанию — у сценария без записи `plan.price`, суток. */
export const PRICE_DAYS = 21;

/** Правка черновика или команды: новые задания, новые «не раньше», снятые задания. */
export interface Edit {
  changes?: readonly Change[];
  fresh?: readonly Fresh[];
  drop?: readonly string[];
}

/** Горизонт цены правки, суток: запись сценария. */
export const priceDays = (db: ContentDb, s: PlantState): number => db.scenarios[s.scenario].plan?.price ?? PRICE_DAYS;

/** Край замороженного горизонта (Б6е): номер дня — рабочий день через горизонт политики от сегодняшнего. */
export const frozenEdge = (db: ContentDb, s: PlantState): number => addWorkdays(calOf(db, s), momentOf(s.start, s.t).day, frozenOf(db, s));

/** В горизонте ли «не раньше» `at`: его день раньше края. */
export const inFrozen = (db: ContentDb, s: PlantState, at: number): boolean => momentOf(s.start, at).day < frozenEdge(db, s);

/**
 * Правка в горизонте: новое задание, чей «не раньше» (нет — сейчас) раньше края; сдвиг, у которого раньше края прежний или
 * новый «не раньше»; снятое задание, чей «не раньше» раньше края.
 */
export function editInFrozen(db: ContentDb, s: PlantState, e: Edit): boolean {
  const edge = frozenEdge(db, s);
  const early = (at: number) => momentOf(s.start, at).day < edge;
  if ((e.fresh ?? []).some(f => early(f.notBefore ?? s.t))) return true;
  if ((e.changes ?? []).some(c => early(c.notBefore) || (s.batches[c.batch] !== undefined && early(s.batches[c.batch].notBefore)))) return true;
  return (e.drop ?? []).some(id => s.batches[id] !== undefined && early(s.batches[id].notBefore));
}

/** Порядок номеров без локали: в движке — только целые и простое сравнение строк. */
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Tally {
  major: number;
  majorSec: number;
  minor: number;
  minorSec: number;
  ends: Map<string, number>;
  formats: number;
}

/** Уборки, их работа, концы стадий заданий и смены формата у линии в прогоне `f` до мгновения `until`. */
function tally(db: ContentDb, s: PlantState, f: Forecast, until: number, fresh: readonly Batch[]): Tally {
  const t: Tally = { major: 0, majorSec: 0, minor: 0, minorSec: 0, ends: new Map(), formats: 0 };
  for (const b of f.bars) {
    if (b.when === 'past' || b.from >= until) continue;
    if (b.kind === 'clean' || b.kind === 'roomClean') {
      const sec = Math.max(0, Math.min(b.to, until) - Math.max(b.from, s.t));
      if (b.major) t.majorSec += sec;
      else t.minorSec += sec;
      // уборка помещения — одна полоса уборщика на каждую уборку (Б4в): по ней и считаем уборки
      if (b.kind === 'roomClean') {
        if (b.major) t.major++;
        else t.minor++;
      }
    }
    if (b.kind === 'stage' && b.batch) t.ends.set(b.batch, Math.max(t.ends.get(b.batch) ?? 0, b.to));
  }
  const skuOf = new Map<string, Id | undefined>(fresh.map(b => [b.id, b.sku]));
  const seq = [...t.ends.entries()]
    .filter(([, end]) => end < until)
    .sort((a, b) => a[1] - b[1] || byId(a[0], b[0]))
    .map(([id]) => s.batches[id]?.sku ?? skuOf.get(id))
    .filter((x): x is Id => x !== undefined);
  // формат линии сейчас — начало порядка: первая серия другого формата — тоже переналадка
  let cur: string | undefined = Object.values(s.lines)[0]?.format;
  for (const sku of seq) {
    const fmt = db.skus[sku]?.format;
    if (fmt === undefined) continue;
    if (cur !== undefined && fmt !== cur) t.formats++;
    cur = fmt;
  }
  return t;
}

/**
 * Цена правки `e` по двум прогонам, уже сделанным: `base` — без правки, `edited` — с ней; горизонт цены — от сейчас.
 * Окно расписания зовёт её со своими прогонами, команда — через `editPrice`.
 */
export function priceOf(db: ContentDb, s: PlantState, base: Forecast, edited: Forecast, e: Edit): EditPrice {
  const until = s.t + priceDays(db, s) * DAY;
  const fresh = freshBatches(db, s, e.fresh ?? []);
  const a = tally(db, s, base, until, []);
  const b = tally(db, s, edited, until, fresh);
  // сдвинутые и снятые правкой задания — сама правка, а не её цена
  const dropped = new Set([...(e.drop ?? []), ...(e.changes ?? []).map(c => c.batch)]);
  const later: EditPrice['later'] = [];
  for (const [id, end] of a.ends) {
    const was = b.ends.get(id);
    if (was === undefined || dropped.has(id)) continue;
    // позже больше чем на час — сдвиг, а не шум округления смен
    if (was - end > 3600) later.push({ batch: id, sec: was - end });
  }
  later.sort((x, y) => y.sec - x.sec || byId(x.batch, y.batch));
  return { major: b.major - a.major, majorSec: b.majorSec - a.majorSec, minor: b.minor - a.minor, minorSec: b.minorSec - a.minorSec, formats: b.formats - a.formats, later };
}

/** Цена правки `e`: два прогона расписания на горизонт цены — без правки и с ней. */
export function editPrice(db: ContentDb, s: PlantState, e: Edit): EditPrice {
  const until = s.t + priceDays(db, s) * DAY;
  return priceOf(db, s, forecast(db, s, [], [], [], until), forecast(db, s, e.changes ?? [], e.fresh ?? [], e.drop ?? [], until), e);
}
