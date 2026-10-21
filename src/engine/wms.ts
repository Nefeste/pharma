// Склад: фура, проверка у рампы, разгрузка, приёмка, размещение (docs/specs/2026-10-engine.md, 1а; геймдизайн,
// §4.3–4.5; docs/specs/2026-10-panels.md, 3а). Фура встаёт к свободной рампе, кладовщик проверяет её до разгрузки; каждая
// паллета проходит путь «фура → зона приёмки → проверка кладовщика → зона карантина или холод»; дальше её ведёт
// лаборатория (lab.ts). Задачи раздаёт раздатчик (tasks.ts); здесь — что они делают, когда кончаются.
import type { ContentDb } from '../content/types';
import { dueIn, owe } from './cash';
import { MIN } from './core/calendar';
import { dockWait } from './lean';
import { coldOf } from './places';
import { createLot, putUnit } from './stock';
import { addTask } from './tasks';
import type { Notice, PlantState, Task, Truck } from './types';

/** Роли и техника склада. */
export const WMS = {
  movers: ['role.driver', 'role.storekeeper'],
  keepers: ['role.storekeeper'],
  floor: ['veh.reach', 'veh.jack'],
  racks: ['veh.reach'],
} as const;

/** Приоритеты задач склада: фура у рампы — раньше всего, она держит рампу; сначала проверка, потом разгрузка. */
export const PRIO = { check: 55, unload: 50, receive: 40, putaway: 30 } as const;

/** Приёмка паллеты кладовщиком: документы, осмотр, внутренний номер и ярлык. */
export const RECEIVE_WORK = 6 * MIN;

/**
 * Проверка фуры у рампы до разгрузки (3а; `gmp-eaeu`, ч. I, п. 5.30; `gdp-eaeu`, пп. 73–74): документы против заказа,
 * пломба и кузов; если на фуре материал с холодом — ещё запись температуры в пути. Время — гипотеза, сверить с владельцем.
 */
export const CHECK_WORK = 15 * MIN;
export const CHECK_COLD = 10 * MIN;

/** Фура заказа: партии по строкам, паллеты на фуре; к рампе — если она свободна. */
export function truckArrives(db: ContentDb, s: PlantState, poId: string, notices: Notice[]) {
  const po = s.pos[poId];
  if (!po || po.status !== 'ordered') return;
  po.status = 'arrived';
  if (po.sum !== undefined) {
    s.cash.vat.in += po.vat!;
    owe(s, 'supplier', -(po.sum - po.prepaid!), dueIn(db, s, db.suppliers[po.supplier].payDays), po.id);
  }
  const dock = db.plants[s.plant].docks.find(d => d.kind === 'in')!.id;
  const truck: Truck = { id: `K${po.id.slice(1)}`, dock, po: po.id, units: [], arrived: s.t, docked: false, open: false };
  s.trucks[truck.id] = truck;
  for (const line of po.lines) {
    const { units } = createLot(db, s, {
      material: line.material,
      supplier: po.supplier,
      ...(line.maker ? { maker: line.maker } : {}),
      qty: line.qty,
      status: 'quarantine',
      po: po.id,
      where: () => ({ kind: 'truck', id: truck.id }),
    });
    for (const u of units) truck.units.push(u.id);
  }
  notices.push({ kind: 'truck', po: po.id, truck: truck.id });
  dockNext(db, s, dock);
}

/**
 * Встать к рампе первой ждущей фуре, если рампа свободна: сколько она ждала во дворе — в потери; кладовщику — проверка
 * фуры. Разгрузка — после проверки.
 */
function dockNext(db: ContentDb, s: PlantState, dock: string) {
  const trucks = Object.values(s.trucks).filter(t => t.dock === dock);
  if (trucks.some(t => t.docked)) return;
  const next = trucks[0];
  if (!next) return;
  next.docked = true;
  dockWait(s, s.t - next.arrived);
  const cold = next.units.some(u => coldOf(db, s.plant, s.lots[s.containers[s.units[u].items[0]].lot].material));
  addTask(s, { kind: 'truckCheck', roles: [...WMS.keepers], from: { kind: 'truck', id: next.id }, work: CHECK_WORK + (cold ? CHECK_COLD : 0), prio: PRIO.check });
}

/** Что сделала задача склада, когда кончилась. */
export function wmsDone(db: ContentDb, s: PlantState, t: Task, _notices: Notice[]) {
  const u = t.unit ? s.units[t.unit] : undefined;
  switch (t.kind) {
    case 'truckCheck': {
      // фура проверена — кузов открыт, паллеты снимают по одной
      const truck = s.trucks[(t.from as { id: string }).id];
      truck.open = true;
      for (const id of truck.units) addTask(s, { kind: 'unload', roles: [...WMS.movers], veh: [...WMS.floor], unit: id, from: { kind: 'truck', id: truck.id }, toKind: 'receiving', work: 0, prio: PRIO.unload });
      return;
    }
    case 'unload': {
      const truck = s.trucks[(t.from as { id: string }).id];
      putUnit(s, u!, t.to!);
      truck.units = truck.units.filter(x => x !== u!.id);
      if (truck.units.length === 0) {
        delete s.trucks[truck.id];
        dockNext(db, s, truck.dock);
      }
      addTask(s, { kind: 'receive', roles: [...WMS.keepers], unit: u!.id, from: { kind: 'slot', id: t.to! }, work: RECEIVE_WORK, prio: PRIO.receive });
      return;
    }
    case 'receive': {
      // ярлык «Карантин» уже на паллете (createLot); холод — в холодную камеру
      const lot = s.lots[s.containers[u!.items[0]].lot];
      const cold = coldOf(db, s.plant, lot.material);
      addTask(s, { kind: 'putaway', roles: [...WMS.movers], veh: [...WMS.floor], unit: u!.id, from: t.from, toKind: cold ? 'cold' : 'quarantine', work: 0, prio: PRIO.putaway });
      return;
    }
    case 'putaway':
    case 'move':
      putUnit(s, u!, t.to!);
      return;
  }
}
