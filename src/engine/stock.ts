// Склад: партии, тара, паллеты, места, статусы (docs/specs/2026-10-engine.md, 1а; геймдизайн, §4.2). Чистые функции
// над состоянием; номера выдаёт счётчик в состоянии.
import type { ContentDb, Id } from '../content/types';
import { momentOf } from './core/calendar';
import { dist, type PlantPlan, type Point, type Slot } from './plant';
import type { Container, Lot, LotStatus, PlantState, Tag, Unit, Where } from './types';

/** Новый номер вида: `L1`, `L2`… */
export function nextId(s: PlantState, prefix: string): string {
  const n = (s.next[prefix] ?? 0) + 1;
  s.next[prefix] = n;
  return `${prefix}${n}`;
}

/** Разрешённые переходы статуса партии. Другие движок не делает — это инвариант. */
export const LOT_FLOW: Record<LotStatus, LotStatus[]> = {
  quarantine: ['sampled'],
  sampled: ['testing'],
  testing: ['released', 'rejected'],
  released: ['blocked'],
  blocked: ['released', 'rejected'],
  rejected: [],
};

const TAG: Record<LotStatus, Tag> = {
  quarantine: 'quarantine',
  sampled: 'sampled',
  testing: 'sampled',
  released: 'released',
  rejected: 'rejected',
  blocked: 'blocked',
};

export function setLotStatus(s: PlantState, lot: Lot, to: LotStatus) {
  if (!LOT_FLOW[lot.status].includes(to)) throw new Error(`lot ${lot.id}: ${lot.status} → ${to}`);
  lot.status = to;
  // ярлыки на паллетах партии — по статусу
  for (const u of unitsOfLot(s, lot.id)) u.tag = TAG[to];
}

/** Паллеты, на которых есть тара партии. */
export function unitsOfLot(s: PlantState, lotId: string): Unit[] {
  const out: Unit[] = [];
  const seen = new Set<string>();
  for (const c of Object.values(s.containers)) {
    if (c.lot !== lotId || seen.has(c.unit)) continue;
    seen.add(c.unit);
    out.push(s.units[c.unit]);
  }
  return out;
}

/** Сколько тары нужно на количество: вверх до целой. */
export function containersFor(db: ContentDb, material: Id, qty: number): number {
  const m = db.materials[material];
  const cap = db.containers[m.container].capacity;
  return Math.ceil(qty / cap);
}

export interface NewLot {
  material: Id;
  supplier: Id;
  /** мг или шт.; округляется до целой тары */
  qty: number;
  status: LotStatus;
  po?: string;
  /** куда ставить паллеты */
  where: (i: number) => Where;
}

/**
 * Новая партия: тара полная, разложена на паллеты по норме тары; паллеты — без смешения партий. Возвращает партию и
 * её паллеты.
 */
export function createLot(db: ContentDb, s: PlantState, o: NewLot): { lot: Lot; units: Unit[] } {
  const m = db.materials[o.material];
  const ct = db.containers[m.container];
  const n = containersFor(db, o.material, o.qty);
  const at = momentOf(s.start, s.t);
  const code = { y: at.date.y % 100, m: at.date.m, n: (s.next.lotCode = (s.next.lotCode ?? 0) + 1) };
  const lot: Lot = {
    id: nextId(s, 'L'),
    material: o.material,
    supplier: o.supplier,
    vendorLot: `${o.supplier.split('.').pop()!.toUpperCase()}-${String(code.y).padStart(2, '0')}${String(code.n).padStart(4, '0')}`,
    code,
    qty: n * ct.capacity,
    // срок — от дня приёмки: месяцы по 30 дней (упрощение прототипа)
    expiry: at.day + m.shelf * 30,
    status: o.status,
    received: s.t,
    ...(o.po ? { po: o.po } : {}),
    used: 0,
    sampled: 0,
    written: 0,
  };
  s.lots[lot.id] = lot;
  const units: Unit[] = [];
  for (let i = 0; i * ct.perPallet < n; i++) {
    const where = o.where(i);
    const u: Unit = { id: nextId(s, 'U'), type: 'unit.pallet.euro', where, items: [], tag: TAG[o.status] };
    s.units[u.id] = u;
    if (where.kind === 'slot') s.slots[where.id] = { unit: u.id };
    for (let k = i * ct.perPallet; k < Math.min(n, (i + 1) * ct.perPallet); k++) {
      const c: Container = { id: nextId(s, 'C'), lot: lot.id, type: ct.id, qty: ct.capacity, unit: u.id, opened: false };
      s.containers[c.id] = c;
      u.items.push(c.id);
    }
    units.push(u);
  }
  return { lot, units };
}

/** Поставить паллету на место (место должно быть свободно или зарезервировано этой задачей). */
export function putUnit(s: PlantState, u: Unit, slotId: string) {
  if (u.where.kind === 'slot') {
    const from = s.slots[u.where.id];
    if (from?.unit === u.id) delete from.unit;
  }
  const to = (s.slots[slotId] ??= {});
  if (to.unit && to.unit !== u.id) throw new Error(`slot ${slotId} busy with ${to.unit}`);
  to.unit = u.id;
  delete to.held;
  u.where = { kind: 'slot', id: slotId };
}

/** Свободно ли место: нет паллеты и никто не держит. */
export function slotFree(s: PlantState, slotId: string): boolean {
  const u = s.slots[slotId];
  return !u || (!u.unit && !u.held);
}

/** Сутки до конца срока: для FEFO и остаточного срока. */
export function daysLeft(s: PlantState, lot: Lot): number {
  return lot.expiry - momentOf(s.start, s.t).day;
}


/**
 * Ближайшее свободное место вида `kind` к точке `near`, не выше яруса `maxLevel`. Порядок — ярус (ниже — раньше),
 * расстояние, адрес: одинаковое состояние — одинаковый выбор.
 */
export function findSlot(
  s: PlantState,
  plan: PlantPlan,
  kind: string,
  near: Point,
  maxLevel: number,
): Slot | undefined {
  let best: Slot | undefined;
  let bestKey: [number, number, string] | undefined;
  for (const sl of plan.byKind[kind] ?? []) {
    if (sl.level > maxLevel || !slotFree(s, sl.id)) continue;
    const key: [number, number, string] = [sl.level, dist(sl, near), sl.id];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = sl;
      bestKey = key;
    }
  }
  return best;
}
