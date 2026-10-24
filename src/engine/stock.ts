// Склад: партии, тара, паллеты, места, статусы (docs/specs/2026-10-engine.md, 1а; геймдизайн, §4.2). Чистые функции
// над состоянием; номера выдаёт счётчик в состоянии.
import type { ContentDb, Id } from '../content/types';
import { momentOf } from './core/calendar';
import { P_ONE } from './core/rng';
import { dist, type Mover, type PlantPlan, type Point, type Slot, straight } from './plant';
import { lotProps, type Props } from './quality';
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

/**
 * Переходы статуса готовой продукции: её не испытывают в лаборатории (показатели серии испытаны на балке), а проверяет
 * ООК; решение уполномоченного лица — прямо из карантина (docs/specs/2026-10-engine.md, 1г). «Держать» — заблокирована до
 * нового решения (Б2в): карантин — статус, а не место (`gmp-eaeu`, ч. I, словарь), и удержанная ГП ждёт на стеллаже.
 */
export const FG_FLOW: Record<LotStatus, LotStatus[]> = {
  quarantine: ['released', 'rejected', 'blocked'],
  sampled: [],
  testing: [],
  released: ['blocked'],
  blocked: ['released', 'rejected'],
  rejected: [],
};

/** Ярлык на паллете по статусу партии. */
export const TAG: Record<LotStatus, Tag> = {
  quarantine: 'quarantine',
  sampled: 'sampled',
  testing: 'sampled',
  released: 'released',
  rejected: 'rejected',
  blocked: 'blocked',
};

export function setLotStatus(s: PlantState, lot: Lot, to: LotStatus, flow: Record<LotStatus, LotStatus[]> = LOT_FLOW) {
  if (!flow[lot.status].includes(to)) throw new Error(`lot ${lot.id}: ${lot.status} → ${to}`);
  lot.status = to;
  lot.since = s.t;
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
  /** мг или шт.; округляется до целой тары, если не `exact` */
  qty: number;
  status: LotStatus;
  po?: string;
  /** куда ставить паллеты */
  where: (i: number) => Where;
  /** своя продукция: количество ровно такое, последняя тара — неполная; свойства — от серии, паспорта нет */
  exact?: boolean;
  truth?: Props;
  /** вид паллеты; нет — деревянная */
  unitType?: Id;
  /** номер партии изготовителя; у своей продукции — номер серии */
  vendorLot?: string;
  /** изготовитель (Б3г): номер его партии — с его кода */
  maker?: Id;
}

/**
 * Новая партия: тара полная (у своей продукции последняя — с остатком), разложена на паллеты по норме тары; паллеты —
 * без смешения партий. Возвращает партию и её паллеты.
 */
export function createLot(db: ContentDb, s: PlantState, o: NewLot): { lot: Lot; units: Unit[] } {
  const m = db.materials[o.material];
  const ct = db.containers[m.container];
  const n = containersFor(db, o.material, o.qty);
  const total = o.exact ? o.qty : n * ct.capacity;
  const at = momentOf(s.start, s.t);
  const code = { y: at.date.y % 100, m: at.date.m, n: (s.next.lotCode = (s.next.lotCode ?? 0) + 1) };
  const { truth, coa } = o.truth ? { truth: o.truth, coa: {} } : lotProps(db, s, o.material, o.supplier);
  const lot: Lot = {
    id: nextId(s, 'L'),
    material: o.material,
    supplier: o.supplier,
    ...(o.maker ? { maker: o.maker } : {}),
    vendorLot: o.vendorLot ?? `${(o.maker ?? o.supplier).split('.').pop()!.toUpperCase()}-${String(code.y).padStart(2, '0')}${String(code.n).padStart(4, '0')}`,
    code,
    qty: total,
    // срок — от дня приёмки: месяцы по 30 дней (упрощение прототипа)
    expiry: at.day + m.shelf * 30,
    status: o.status,
    since: s.t,
    received: s.t,
    ...(o.po ? { po: o.po } : {}),
    used: 0,
    sampled: 0,
    written: 0,
    truth,
    coa,
  };
  s.lots[lot.id] = lot;
  const units: Unit[] = [];
  for (let i = 0; i * ct.perPallet < n; i++) {
    const where = o.where(i);
    const u: Unit = { id: nextId(s, 'U'), type: o.unitType ?? 'unit.pallet.euro', where, items: [], tag: TAG[o.status] };
    s.units[u.id] = u;
    if (where.kind === 'slot') s.slots[where.id] = { unit: u.id };
    for (let k = i * ct.perPallet; k < Math.min(n, (i + 1) * ct.perPallet); k++) {
      const qty = Math.min(ct.capacity, total - k * ct.capacity);
      const c: Container = { id: nextId(s, 'C'), lot: lot.id, type: ct.id, qty, unit: u.id, opened: false };
      s.containers[c.id] = c;
      u.items.push(c.id);
    }
    units.push(u);
  }
  return { lot, units };
}

/** Партия своей продукции без тары — тару (гофроящики) добавляет линия, и количество растёт вместе с ней. */
export function emptyLot(s: PlantState, o: { material: Id; vendorLot: string; batch: string; expiry: number; truth: Props }): Lot {
  const at = momentOf(s.start, s.t);
  const code = { y: at.date.y % 100, m: at.date.m, n: (s.next.lotCode = (s.next.lotCode ?? 0) + 1) };
  const lot: Lot = {
    id: nextId(s, 'L'),
    material: o.material,
    supplier: 'plant',
    vendorLot: o.vendorLot,
    code,
    qty: 0,
    expiry: o.expiry,
    status: 'quarantine',
    since: s.t,
    received: s.t,
    used: 0,
    sampled: 0,
    written: 0,
    truth: o.truth,
    coa: {},
    batch: o.batch,
  };
  s.lots[lot.id] = lot;
  return lot;
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

/** Тара по партиям — за один проход; порядок внутри партии — порядок учёта. */
export function containersByLot(s: PlantState): Map<string, Container[]> {
  const out = new Map<string, Container[]>();
  for (const c of Object.values(s.containers)) {
    const list = out.get(c.lot);
    if (list) list.push(c);
    else out.set(c.lot, [c]);
  }
  return out;
}

/**
 * Склад для резерва изменился: разрешена партия или вернулся остаток. Ждущая серия пробует резерв снова, только если
 * номер изменился с её прошлой попытки (src/engine/mes.ts).
 */
export function stockChanged(s: PlantState) {
  s.next.stock = (s.next.stock ?? 0) + 1;
}

/** Сколько в таре свободно под резерв: остаток минус зарезервированное. */
export function free(c: Container): number {
  return c.qty - (c.reserved ?? 0);
}

/**
 * Содержание партии, известное заводу, доли 1/10 000: результат лаборатории после проверки вторым лицом; у партии без
 * испытаний (запас на старте) — паспорт; нет и его — 100 %. Истину завод не знает: по этому числу считают навеску.
 */
export function knownAssay(db: ContentDb, s: PlantState, lot: Lot): number {
  const sm = lot.sample ? s.samples[lot.sample] : undefined;
  for (const id of sm?.tests ?? []) {
    const q = s.tests[id];
    if (q.state === 'done' && db.tests[q.method].attr === 'assay' && q.result !== undefined) return q.result;
  }
  return lot.coa.assay ?? P_ONE;
}

/**
 * Ближайшее свободное место вида `kind` к точке `near`, не выше яруса `maxLevel`, — из тех, что годятся по `ok` (Б3в: зона
 * хранения и её режим). Порядок — ярус (ниже — раньше), расстояние, адрес: одинаковое состояние — одинаковый выбор.
 */
export function findSlot(
  s: PlantState,
  plan: PlantPlan,
  kind: string,
  near: Point,
  maxLevel: number,
  mover: Mover = 'drive',
  ok?: (sl: Slot) => boolean,
): Slot | undefined {
  let best: Slot | undefined;
  let bestD = 0;
  for (const sl of plan.byKind[kind] ?? []) {
    if (sl.level > maxLevel) continue;
    // выше лучшего или на его ярусе, но дальше его уже по прямой, — не лучше: ни проверять, ни мерить путь
    if (best && (sl.level > best.level || (sl.level === best.level && straight(sl, near) > bestD))) continue;
    if (!slotFree(s, sl.id) || (ok && !ok(sl))) continue;
    const d = dist(plan, sl, near, mover);
    if (!best || sl.level < best.level || d < bestD || (d === bestD && sl.id < best.id)) {
      best = sl;
      bestD = d;
    }
  }
  return best;
}
