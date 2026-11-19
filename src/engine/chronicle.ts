// Хроника завода (Б10; docs/specs/2026-10-vertical-slice.md, «Б10»; геймдизайн, §26.1): лента фактов с причинами — по
// извещениям, которые оставило событие, и по записям завода о вещи. Серия выпущена — через сколько от «не раньше», чего
// ждала дольше всего (время по состояниям, Б1к), на сколько позже срока, кто решил (журнал, Б5а); заказ ушёл позже или
// не весь — какой позиции не хватило; отклонение, вывод расследования, проверка CAPA; поставка опоздала и пришла; отказ
// узла и ремонт; люди; единица введена; этап проекта; итог сценария. Истины нет: причина — вывод расследования, числа —
// записи. Хроника хранится всю игру; правила её не читают; прогон плана — без неё. Слова — в окне.
import type { ContentDb } from '../content/types';
import { goalsNow } from './goals';
import type { BatchPhase, ChronEntry, Head, Notice, PlantState } from './types';

/** Самое долгое ожидание серии — в записи, если оно не короче (геймдизайн, гипотеза Б10). */
export const LONG_WAIT = 12 * 3600;

/** Состояния серии, которые — ожидание: не своя дата, не работа и не упаковка. */
const WAITS: readonly BatchPhase[] = ['materials', 'kitting', 'people', 'room', 'cleaning', 'equipment', 'repair', 'lab', 'line', 'decision', 'asset'];

/** Кто решил о серии: последнее решение журнала о ней. */
function decidedBy(s: PlantState, batch: string): Head | 'player' | undefined {
  for (let i = s.journal.length - 1; i >= 0; i--) {
    const r = s.journal[i];
    if (r.d.kind === 'batch' && r.d.batch === batch) return r.by;
  }
  return undefined;
}

function released(s: PlantState, id: string): ChronEntry | undefined {
  const b = s.batches[id];
  if (!b) return undefined;
  // время по состояниям — с открытым отрезком текущего
  const spent: Partial<Record<BatchPhase, number>> = { ...b.spent };
  if (b.phase && s.t > b.phaseAt) spent[b.phase] = (spent[b.phase] ?? 0) + s.t - b.phaseAt;
  let ph: BatchPhase | undefined;
  for (const w of WAITS) if ((spent[w] ?? 0) >= LONG_WAIT && (!ph || spent[w]! > spent[ph]!)) ph = w;
  const by = decidedBy(s, id);
  return {
    t: s.t,
    k: 'released',
    b: id,
    sec: Math.max(0, s.t - b.notBefore),
    ...(ph ? { ph, phSec: spent[ph]! } : {}),
    ...(b.due !== undefined && s.t > b.due ? { late: s.t - b.due } : {}),
    ...(by ? { by } : {}),
  };
}

/** Позиция заказа, которой не хватило больше всего. */
function shortSku(s: PlantState, order: string) {
  const o = s.orders[order];
  if (!o) return undefined;
  let best: (typeof o.lines)[number] | undefined;
  for (const l of o.lines) if (!best || l.cases - l.shipped > best.cases - best.shipped) best = l;
  return best?.sku;
}

/** Запись хроники по извещению; нет записи — `undefined`. */
function entryOf(db: ContentDb, s: PlantState, n: Notice): ChronEntry | undefined {
  const t = s.t;
  switch (n.kind) {
    case 'batchReleased':
      // серию выпускают по партиям её ГП — запись одна, по первой
      if (s.story.chronicle.some(e => e.k === 'released' && e.b === n.batch)) return undefined;
      return released(s, n.batch);
    case 'batchRejected': {
      if (s.story.chronicle.some(e => e.k === 'rejected' && e.b === n.batch)) return undefined;
      const by = decidedBy(s, n.batch);
      return { t, k: 'rejected', b: n.batch, ...(by ? { by } : {}) };
    }
    case 'lateOrder': {
      // заказ закрывают и после второй фуры — запись одна, первая
      if (s.story.chronicle.some(e => e.k === 'missed' && e.o === n.order)) return undefined;
      const sku = shortSku(s, n.order);
      return { t, k: 'missed', o: n.order, ...(sku ? { sku } : {}), cases: n.missing };
    }
    case 'deviation':
      // отклонение открывают раз; извещение о нём бывает и позже — запись одна, первая
      if (s.deviations[n.id]?.opened !== t || s.story.chronicle.some(e => e.k === 'dev' && e.d === n.id)) return undefined;
      return { t, k: 'dev', d: n.id, cls: n.cls };
    case 'concluded':
      return { t, k: 'concluded', inv: n.id, cause: n.cause, fate: n.fate };
    case 'capaCheck':
      return { t, k: 'capa', c: n.id, d: n.dev, ok: n.ok };
    case 'poLate':
      return { t, k: 'poLate', po: n.po };
    case 'truck': {
      // поставка, которая опоздала, пришла: на сколько позже обещанного
      const po = s.pos[n.po];
      if (!po || !s.story.chronicle.some(e => e.k === 'poLate' && e.po === n.po)) return undefined;
      return { t, k: 'poCame', po: n.po, late: Math.max(0, t - po.eta) };
    }
    case 'failure':
      return { t, k: 'failure', m: n.machine, part: n.part };
    case 'repaired': {
      if (n.planned) return undefined;
      const list = s.story.chronicle;
      let at: number | undefined;
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (e.k === 'failure' && e.m === n.machine && e.part === n.part) {
          at = e.t;
          break;
        }
      }
      return { t, k: 'repaired', m: n.machine, part: n.part, sec: at === undefined ? 0 : t - at };
    }
    case 'hired':
      return { t, k: 'hired', p: n.person };
    case 'left':
      return { t, k: 'left', p: n.person, why: n.why };
    case 'unitReady':
      return { t, k: 'unit', a: n.asset };
    case 'project':
      return { t, k: 'project', pr: n.project, product: n.product, stage: n.stage };
    case 'scenarioEnd':
      return { t, k: 'goals', met: goalsNow(db, s).goals.map(g => g.met) };
    default:
      return undefined;
  }
}

/** После события (и команды): извещения с `from` — в хронику. */
export function chronicleStep(db: ContentDb, s: PlantState, notices: readonly Notice[], from: number) {
  for (let i = from; i < notices.length; i++) {
    const e = entryOf(db, s, notices[i]);
    if (e) s.story.chronicle.push(e);
  }
}
