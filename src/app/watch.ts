// «Смотреть» из карточки (этап Б, Б1б; docs/specs/2026-10-vertical-slice.md): какая строка «Сейчас» — работа этой вещи.
// Человек — работа, в которой он занят; паллета, помещение, фура — работа на них; оборудование — стадия в его помещении;
// машина линии — работа на её линии. Чистая функция без DOM — её проверяют тесты в Bun.
import type { NowRow } from '../sim/now';
import type { CardData, Thing } from '../sim/views';
import { same } from './pick';

export function watchFor(thing: Thing | undefined, card: CardData | undefined, rows: readonly NowRow[] | undefined): NowRow | undefined {
  if (!thing || !rows) return undefined;
  if (thing.kind === 'person') return rows.find(r => r.people.some(p => p.n === thing.n));
  const exact = rows.find(r => same(r.thing, thing));
  if (exact) return exact;
  if (thing.kind === 'equipment' && card?.kind === 'equipment') return rows.find(r => r.kind === 'stage' && r.thing?.kind === 'room' && r.thing.i === card.room);
  if (thing.kind === 'machine') return rows.find(r => r.thing?.kind === 'machine' && r.thing.line === thing.line);
  return undefined;
}
