// Вид стройки (Б7б; docs/specs/2026-10-vertical-slice.md, «Б7б», «Окно»): что окну нужно знать о стройке, кроме плана —
// план и его проверки окно считает само теми же функциями движка (призрак и подписи помещений). Здесь — состояние стройки
// завода: шагов отмены, перестраиваемое, сносимое, потрачено, счётчики имён новых вещей, что сейчас занято (его снос
// отложится) и касса с краем кредитной линии — проверка денег у призрака. Истины здесь нет: занятость — по учёту завода.
import type { ContentDb } from '../content/types';
import { busyWith } from '../engine/build';
import { mounting, unitBusy } from '../engine/equip';
import { unitsOf } from '../engine/site/units';
import type { Names } from '../engine/site/edit';
import type { BuildState, PlantState } from '../engine/types';

export interface BuildQuery {
  view: 'build';
}

export interface BuildView {
  view: 'build';
  /** шагов отмены */
  undo: number;
  /** перестраиваемое помещение */
  editing?: string;
  /** что сносится, когда освободится */
  leaving: { what: BuildState['leaving'][number]['what']; id: string }[];
  /** потрачено на стройку с НДС, со сносом и отменой */
  spent: number;
  /** счётчики имён: призрак называет новую вещь так же, как назовёт движок */
  next: Names;
  /** помещения, зоны и ряды стеллажа, которые сейчас заняты: их снос — когда освободятся */
  busy: string[];
  /** помещения на монтаже единицы (Б7в): помещение → единица */
  mount: Record<string, string>;
  /** касса и её нижний край — минус предел кредитной линии: дороже их разницы стройка не принимается */
  cash: number;
  floor: number;
}

export function buildView(db: ContentDb, s: PlantState): BuildView {
  const st = s.build;
  const plan = s.plan;
  const busy = [
    ...plan.rooms.filter(r => busyWith(db, s, 'room', r.id)).map(r => r.id),
    ...plan.zones.filter(z => busyWith(db, s, 'zone', z.id)).map(z => z.id),
    ...plan.racks.filter(r => busyWith(db, s, 'rack', r.id)).map(r => r.id),
    // единицы (Б7в): занятые серией, испытанием или упаковкой — их снос и перенос отложатся
    ...unitsOf(plan).filter(u => unitBusy(db, s, u.id)).map(u => u.id),
  ];
  return {
    view: 'build',
    undo: st?.undo.length ?? 0,
    ...(st?.editing !== undefined ? { editing: st.editing } : {}),
    leaving: (st?.leaving ?? []).map(l => ({ what: l.what, id: l.id })),
    spent: st?.spent ?? 0,
    next: st?.next ?? {},
    busy,
    mount: Object.fromEntries(mounting(db, s)),
    cash: s.cash.balance,
    floor: -db.scenarios[s.scenario].credit.limit,
  };
}
