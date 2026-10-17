// Закупки (docs/specs/2026-10-engine.md, 1а, «Заказ поставщику и приёмка»; геймдизайн, §11). Заказ — команда `po`:
// количество — вверх до целой тары, не меньше минимальной партии. Срок прихода — из ветви поставщика; фура приходит в
// рабочий день с 09:00 до 15:00.
import type { ContentDb } from '../content/types';
import { schedule } from './core/agenda';
import { DAY, HOUR, MIN, momentOf } from './core/calendar';
import { part, post, vatRate } from './cash';
import { roll } from './random';
import { containersFor, nextId } from './stock';
import type { Command, Notice, PlantState, Po } from './types';

/** Окно прихода фур: рабочий день, с 09:00, плюс до шести часов. */
const ARRIVE_FROM = 9 * HOUR;
const ARRIVE_SPREAD = 6 * HOUR;

export function placePo(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'po' }>, notices: Notice[]): Po | undefined {
  const sup = db.suppliers[cmd.supplier];
  if (!sup) {
    notices.push({ kind: 'refused', cmd: 'po', why: 'noSupplier', detail: cmd.supplier });
    return undefined;
  }
  if (cmd.lines.length === 0) {
    notices.push({ kind: 'refused', cmd: 'po', why: 'empty' });
    return undefined;
  }
  const lines = [];
  for (const l of cmd.lines) {
    const item = sup.items[l.material];
    if (!item) {
      notices.push({ kind: 'refused', cmd: 'po', why: 'notSold', detail: l.material });
      return undefined;
    }
    if (l.qty < item.moq) {
      notices.push({ kind: 'refused', cmd: 'po', why: 'belowMoq', detail: l.material });
      return undefined;
    }
    const cap = db.containers[db.materials[l.material].container].capacity;
    lines.push({ material: l.material, qty: containersFor(db, l.material, l.qty) * cap });
  }
  const eta = roll(s, `supply/${sup.id}`, r => {
    const days = r.range(sup.lead[0], sup.lead[1]);
    return arrival(s, s.t + days * DAY, r.int(ARRIVE_SPREAD / MIN) * MIN);
  });
  // сумма с НДС: АФС — по ставке лекарственных средств, остальное — по общей; предоплата — сейчас, остаток — после прихода
  let net = 0;
  let vat = 0;
  for (const l of lines) {
    const price = sup.items[l.material].price;
    const cost = db.materials[l.material].unit === 'mass' ? Math.floor((price * l.qty + 500_000) / 1_000_000) : price * l.qty;
    net += cost;
    vat += part(cost, vatRate(db, s, l.material));
  }
  const po: Po = { id: nextId(s, 'P'), supplier: sup.id, lines, ordered: s.t, eta, status: 'ordered', by: cmd.by ?? 'player', sum: net + vat, vat, prepaid: part(net + vat, sup.prepay) };
  s.pos[po.id] = po;
  post(s, -po.prepaid!, 'prepay', po.id);
  schedule(s.agenda, eta, { kind: 'truck', po: po.id });
  notices.push({ kind: 'ordered', po: po.id, eta });
  return po;
}

/** Ближайший рабочий день не раньше `t` — в 09:00 плюс `extra` секунд. */
function arrival(s: PlantState, t: number, extra: number): number {
  let day = t - momentOf(s.start, t).sec;
  for (let i = 0; i < 7; i++) {
    const wd = momentOf(s.start, day).weekday;
    if (wd < 5) return day + ARRIVE_FROM + extra;
    day += DAY;
  }
  return day + ARRIVE_FROM + extra;
}
