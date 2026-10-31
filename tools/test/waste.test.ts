// Б1з: отклонённое (src/engine/waste.ts; вынос балка — src/engine/mes.ts; docs/specs/2026-10-vertical-slice.md, «Б1з»).
// Отклонённый балк выносят из промежуточного склада и везут в зону отклонённого. Вывоз заказывает пост «Снабжение и
// склад» — команда `waste` — или, пока пост не у игрока, коллега склада в 09:00 рабочего дня: заняты две трети мест зоны
// или паллета ждёт вывоза дольше срока; второго, пока первый не кончился, нет. Фура подрядчика встаёт к рампе отгрузки в
// его часы следующего рабочего дня, а рампа занята — ждёт до конца его часов, потом приедет снова; грузят всё, что лежало
// в зоне, когда фура встала; подпись начальника ОКК — после погрузки; счёт — выезд и паллеты с НДС; запись журнала
// отходов; тара и паллеты ушли из учёта, партия — нет. Длинная игра не встаёт: год, где отклоняют каждую вторую серию
// ГП, и год с уставками на краю диапазона.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { part } from '../../src/engine/cash';
import { addMonths, addWorkdays, civilFromDays, DAY, daysFromCivil, HOUR, lastOfMonth, MIN, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { settleLot } from '../../src/engine/lab';
import { planOf } from '../../src/engine/plant';
import { rowsOf } from '../../src/engine/quals';
import { fromSave } from '../../src/engine/save';
import { createLot } from '../../src/engine/stock';
import type { PlantState } from '../../src/engine/types';
import { FULL, KEEP, WASTE, WASTE_HOUR, zoneUnits } from '../../src/engine/waste';
import { WMS } from '../../src/engine/wms';
import { calOf } from '../../src/engine/workdays';
import { wasteLevers } from '../../src/app/levers';
import { dossierView } from '../../src/sim/dossier';
import { postOf } from '../../src/sim/journal';
import { nowView } from '../../src/sim/now';
import { morningView } from '../../src/sim/report';
import { cardView } from '../../src/sim/views';
import { scenario } from '../content/schema';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const w = sc.waste!;
const plan = planOf(db, sc.plant);
const rej = plan.byKind.rejected.map(x => x.id);
const start = daysFromCivil(sc.start.date);
const cal = calOf(db, { start: sc.start.date, scenario: SC });
const outDock = db.plants[sc.plant].docks.find(d => d.kind === 'out')!.id;
/** Мгновение `sec` секунд от полуночи дня `day` (номер дня от 1970-01-01). */
const at = (day: number, sec: number) => (day - start) * DAY + sec;
const dayOf = (s: PlantState, t = s.t) => momentOf(s.start, t).day;
const until = (s: PlantState, t: number) => apply(db, s, { kind: 'advance', seconds: t - s.t });

/** Ходить по `step`, пока `done()` не станет правдой или не наступит `limit`; нарушения инвариантов — на каждом шаге. */
function live(s: PlantState, done: () => boolean, limit: number, step = MIN): string[] {
  const bad: string[] = [];
  while (!done() && s.t < limit) {
    apply(db, s, { kind: 'advance', seconds: step });
    bad.push(...check(db, s));
  }
  return [...new Set(bad)];
}

/** Отклонённые партии в зоне — по паллете с одной тарой, с места зоны `from`; отклонены в мгновение `since`. */
function reject(s: PlantState, n: number, from = 0, since = s.t): string[] {
  const m = db.materials['mat.exc.mcc'];
  const cap = db.containers[m.container].capacity;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const { lot } = createLot(db, s, { material: m.id, supplier: 'start', qty: cap, status: 'rejected', where: () => ({ kind: 'slot', id: rej[from + i] }) });
    lot.since = since;
    out.push(lot.id);
  }
  return out;
}

const lotsInZone = (s: PlantState) => zoneUnits(db, s).map(u => s.containers[u.items[0]].lot);

describe('команда «Заказать вывоз»', () => {
  test('зона пуста — отказ; есть паллета — подрядчик на следующий рабочий день к началу своих часов; второй — отказ', () => {
    const s = newPlant(db, { scenario: SC });
    expect(apply(db, s, { kind: 'waste' })).toEqual([{ kind: 'refused', cmd: 'waste', why: 'empty' }]);
    reject(s, 1);
    expect(apply(db, s, { kind: 'waste' })).toEqual([]);
    const o = s.waste.order!;
    expect(o).toEqual({ id: o.id, booked: s.t, by: 'player', at: at(addWorkdays(cal, dayOf(s), 1), w.hours[0]) });
    // журнал решений (Б5а): игрок, мест не выбрано — без места
    expect(s.journal.at(-1)).toEqual({ n: s.journal.at(-1)!.n, t: s.t, by: 'player', d: { kind: 'waste', order: o.id, at: o.at } });
    expect(apply(db, s, { kind: 'waste' })).toEqual([{ kind: 'refused', cmd: 'waste', why: 'already', detail: o.id }]);
  });

  test('пост «Снабжение и склад» — чужой: отказ с местом; директором — можно; у сценария без подрядчика — отказ', () => {
    const s = newPlant(db, { scenario: SC });
    reject(s, 1);
    apply(db, s, { kind: 'seat', seats: ['production', 'quality'] });
    expect(apply(db, s, { kind: 'waste', by: 'player' })).toEqual([{ kind: 'refused', cmd: 'waste', why: 'notYours', detail: 'supply' }]);
    apply(db, s, { kind: 'seat', seats: ['director'] });
    expect(apply(db, s, { kind: 'waste', by: 'player' })).toEqual([]);
    expect(s.journal.at(-1)).toMatchObject({ by: 'player', seat: 'director', d: { kind: 'waste' } });
    const bare: ContentDb = structuredClone(db);
    delete bare.scenarios[SC].waste;
    const b = newPlant(bare, { scenario: SC });
    reject(b, 1);
    expect(apply(bare, b, { kind: 'waste' })).toEqual([{ kind: 'refused', cmd: 'waste', why: 'noWaste' }]);
  });
});

describe('коллега склада', () => {
  const need = Math.ceil((rej.length * FULL[0]) / FULL[1]);

  test('в 09:00 рабочего дня: меньше двух третей мест — нет; две трети — вывоз на следующий рабочий день; второго нет', () => {
    const s = newPlant(db, { scenario: SC });
    reject(s, need - 1);
    until(s, at(start, WASTE_HOUR) + MIN);
    expect(s.waste.order).toBeUndefined();
    reject(s, 1, need - 1);
    until(s, at(start + 1, WASTE_HOUR) - MIN);
    expect(s.waste.order).toBeUndefined();
    until(s, at(start + 1, WASTE_HOUR) + MIN);
    const o = s.waste.order!;
    expect(o).toEqual({ id: o.id, booked: at(start + 1, WASTE_HOUR), by: 'head:wms', at: at(addWorkdays(cal, start + 1, 1), w.hours[0]) });
    // журнал решений (Б5а): начальник склада — сколько мест занято из скольких
    expect(s.journal.filter(r => r.d.kind === 'waste')).toEqual([{ n: expect.any(Number), t: o.booked, by: 'wms', d: { kind: 'waste', order: o.id, at: o.at, why: { used: need, places: rej.length, months: KEEP } } }]);
    // зона полна, а подрядчик ещё едет: в 09:00 следующего дня второго вывоза нет — он тот же, что встал к рампе
    reject(s, rej.length - need, need);
    until(s, o.at + MIN);
    expect(s.waste.order?.id).toBe(o.id);
    expect(s.journal.filter(r => r.d.kind === 'waste')).toHaveLength(1);
  });

  test('паллета ждёт вывоза дольше срока — вывоз и при одной паллете; моложе срока — нет', () => {
    const young = newPlant(db, { scenario: SC });
    reject(young, 1, 0, at(addMonths(start, -KEEP) + 1, 0));
    until(young, at(start, WASTE_HOUR) + MIN);
    expect(young.waste.order).toBeUndefined();
    const s = newPlant(db, { scenario: SC });
    const since = at(addMonths(start, -KEEP), 0);
    reject(s, 1, 0, since);
    until(s, at(start, WASTE_HOUR) + MIN);
    expect(s.waste.order?.by).toBe('head:wms');
    expect(s.journal.filter(r => r.d.kind === 'waste').at(-1)?.d).toMatchObject({ why: { used: 1, places: rej.length, since, months: KEEP } });
  });

  test('игрок на посту склада (директор) — коллега не заказывает; ушёл с поста — заказывает', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'seat', seats: ['director'] });
    reject(s, rej.length);
    until(s, at(start, WASTE_HOUR) + MIN);
    expect(s.waste.order).toBeUndefined();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    until(s, at(start + 1, WASTE_HOUR) + MIN);
    expect(s.waste.order?.by).toBe('head:wms');
  });
});

describe('фура подрядчика', () => {
  test('в день вывоза — к рампе отгрузки; грузят всё, что лежало в зоне; подпись начальника ОКК; счёт; журнал отходов', () => {
    const s = newPlant(db, { scenario: SC });
    const lots = reject(s, 3);
    apply(db, s, { kind: 'waste' });
    const o = s.waste.order!;
    const bad = live(s, () => o.truck !== undefined, o.at + HOUR);
    const tr = s.trucks[o.truck!];
    expect(tr).toMatchObject({ dock: outDock, waste: o.id, arrived: o.at, docked: true, open: true });
    expect(Object.values(s.tasks).filter(t => t.kind === 'wasteLoad' && t.truck === tr.id)).toHaveLength(3);
    // паллета, которая легла в зону, когда фура уже встала, — до следующего вывоза
    const late = reject(s, 1, 3)[0];
    const lateUnit = zoneUnits(db, s).find(u => s.containers[u.items[0]].lot === late)!.id;
    // подпись — только когда погружено всё
    let early = 0;
    let sign = 0;
    while (s.trucks[tr.id] && s.t < o.at + DAY) {
      apply(db, s, { kind: 'advance', seconds: MIN });
      bad.push(...check(db, s));
      const loads = Object.values(s.tasks).filter(t => t.kind === 'wasteLoad' && t.truck === tr.id).length;
      if (Object.values(s.tasks).some(t => t.kind === 'wasteSign' && t.truck === tr.id)) {
        sign++;
        if (loads > 0) early++;
      }
    }
    expect([early, sign > 0, [...new Set(bad)]]).toEqual([0, true, []]);
    const e = s.waste.log.at(-1)!;
    const sum = w.trip + 3 * w.pallet;
    const vat = part(sum, db.profiles[sc.profile].vat.general);
    const d = civilFromDays(dayOf(s, e.t));
    expect(e).toEqual({ id: o.id, t: e.t, booked: o.booked, by: 'player', lots: lots.map(lot => ({ lot, pallets: 1, containers: 1, qty: s.lots[lot].qty })), pallets: 3, signed: e.signed, sum, vat, act: lastOfMonth(d.y, d.m) + 30 });
    // подписал начальник ОКК — или тот, кто его замещает
    expect([...WASTE.signers, 'role.qa']).toContain(s.people[e.signed].role);
    expect(dayOf(s, e.t)).toBe(dayOf(s, o.at));
    expect(s.cash.ledger.filter(l => l.item === 'waste')).toEqual([{ t: e.t, sum: -(sum + vat), item: 'waste', ref: o.id }]);
    // тара и паллеты — из учёта, партии остались, количество — в списанном
    for (const lot of lots) {
      expect(s.lots[lot].status).toBe('rejected');
      expect(s.lots[lot].written).toBe(s.lots[lot].qty);
      expect(Object.values(s.containers).some(c => c.lot === lot)).toBe(false);
    }
    expect(zoneUnits(db, s).map(u => u.id)).toEqual([lateUnit]);
    expect(s.waste.order).toBeUndefined();
  });

  test('рампа отгрузки занята — фура подрядчика ждёт во дворе; освободилась — встаёт и грузится', () => {
    const s = newPlant(db, { scenario: SC });
    reject(s, 2);
    apply(db, s, { kind: 'waste' });
    const o = s.waste.order!;
    until(s, o.at - MIN);
    // у рампы стоит другая фура
    s.trucks.K999 = { id: 'K999', dock: outDock, units: [], arrived: s.t, docked: true, open: false };
    until(s, o.at + HOUR);
    const tr = s.trucks[o.truck!];
    expect([tr.docked, tr.open]).toEqual([false, false]);
    expect(Object.values(s.tasks).some(t => t.kind === 'wasteLoad')).toBe(false);
    delete s.trucks.K999;
    const bad = live(s, () => !s.trucks[tr.id], o.at + DAY);
    expect(bad).toEqual([]);
    expect(s.waste.log.at(-1)?.pallets).toBe(2);
  });

  test('рампа занята до конца часов подрядчика — фура уезжает пустой и приезжает на следующий рабочий день', () => {
    const s = newPlant(db, { scenario: SC });
    reject(s, 2);
    apply(db, s, { kind: 'waste' });
    const o = s.waste.order!;
    const day = dayOf(s, o.at);
    until(s, o.at - MIN);
    s.trucks.K999 = { id: 'K999', dock: outDock, units: [], arrived: s.t, docked: true, open: false };
    until(s, at(day, w.hours[1]) - MIN);
    const first = o.truck!;
    expect(s.trucks[first]?.docked).toBe(false);
    until(s, at(day, w.hours[1]) + MIN);
    expect([s.trucks[first], o.truck]).toEqual([undefined, undefined]);
    const next = addWorkdays(cal, day, 1);
    expect(o.at).toBe(at(next, w.hours[0]));
    expect(check(db, s)).toEqual([]);
    delete s.trucks.K999;
    const bad = live(s, () => s.waste.order === undefined, o.at + DAY);
    expect(bad).toEqual([]);
    expect([dayOf(s, s.waste.log.at(-1)!.t), s.waste.log.at(-1)!.pallets]).toEqual([next, 2]);
  });

  test('паллеты, ждавшие места в полной зоне, едут в освободившиеся места', () => {
    const s = newPlant(db, { scenario: SC });
    reject(s, rej.length);
    // ещё одна отклонённая паллета — в карантине: места в зоне нет, задача ждёт место
    const m = db.materials['mat.exc.starch'];
    const quar = plan.byKind.quarantine[0].id;
    const { lot, units } = createLot(db, s, { material: m.id, supplier: 'start', qty: db.containers[m.container].capacity, status: 'rejected', where: () => ({ kind: 'slot', id: quar }) });
    // как решение по партии кладёт её паллету в зону (lab.ts)
    settleLot(db, s, lot, units[0]);
    apply(db, s, { kind: 'advance', seconds: HOUR });
    const move = Object.values(s.tasks).find(t => t.unit === units[0].id)!;
    expect([move.state, move.why]).toEqual(['open', 'place']);
    apply(db, s, { kind: 'waste' });
    const bad = live(s, () => lotsInZone(s).includes(lot.id), s.t + 3 * DAY);
    expect(bad).toEqual([]);
    expect(lotsInZone(s)).toEqual([lot.id]);
  });
});

describe('отклонённый балк', () => {
  test('балк серии происшествия отклонили — кладовщик выносит его в шлюз для материалов, оттуда — в зону отклонённого', () => {
    const s = newPlant(db, { scenario: SC });
    const b = Object.values(s.batches)[sc.incident!.batch - 1];
    // расследование открыто — дальше по минуте: вынос начинается в тот же час
    live(s, () => Object.values(s.investigations).some(i => i.batch === b.id), 30 * DAY, HOUR);
    live(s, () => s.lots[b.bulk!].status === 'rejected', s.t + 30 * DAY, MIN);
    const lot = s.lots[b.bulk!];
    expect(lot.status).toBe('rejected');
    const bulk = Object.values(s.units).find(u => u.items.some(c => s.containers[c].lot === lot.id))!;
    expect(bulk.where).toEqual({ kind: 'room', id: plan.roomOf.bulk });
    const bad = live(s, () => Object.values(s.tasks).some(t => t.kind === 'bulkOut' && t.lot === lot.id), s.t + HOUR);
    const out = Object.values(s.tasks).find(t => t.kind === 'bulkOut' && t.lot === lot.id)!;
    expect(out).toMatchObject({ roles: ['role.storekeeper'], unit: bulk.id, toKind: 'staging' });
    expect(b.status).toBe('rejected');
    bad.push(...live(s, () => lotsInZone(s).includes(lot.id), s.t + 3 * DAY));
    expect(bad).toEqual([]);
    const u = zoneUnits(db, s).find(x => s.containers[x.items[0]].lot === lot.id)!;
    // на деревянной паллете, с ярлыком «Отклонено», вся тара балка; пластиковой паллеты больше нет
    expect([u.type, u.tag]).toEqual(['unit.pallet.euro', 'rejected']);
    expect(u.items.length).toBe(Object.values(s.containers).filter(c => c.lot === lot.id).length);
    expect(s.units[bulk.id]).toBeUndefined();
  }, 30_000);
});

/**
 * Год сценария (Б1з, «Проверки»): карантин ГП и места паллетирования ни разу не заняты разом; паллета ждёт места в зоне
 * отклонённого не дольше трёх рабочих дней; инварианты — каждые сутки. `each` — команды игрока каждый час.
 */
function year(s: PlantState, each?: () => void) {
  const fgq = plan.byKind.fgQuarantine.map(x => x.id);
  const pal = plan.byKind.palletizing.map(x => x.id);
  const used = (ids: string[]) => ids.filter(id => s.slots[id]?.unit).length;
  const waits = new Map<string, number>();
  const end = s.t + 365 * DAY;
  let stuck = 0;
  let late = 0;
  const bad: string[] = [];
  while (s.t < end) {
    apply(db, s, { kind: 'advance', seconds: HOUR });
    each?.();
    if (used(fgq) === fgq.length && used(pal) === pal.length) stuck++;
    for (const t of Object.values(s.tasks)) if (t.toKind === 'rejected' && t.state === 'open' && !waits.has(t.id)) waits.set(t.id, t.created);
    for (const [id, from] of waits) {
      const t = s.tasks[id];
      if (t && t.state === 'open') {
        // три рабочих дня после дня, когда паллета стала ждать места
        if (s.t >= at(addWorkdays(cal, dayOf(s, from), 3) + 1, 0)) late++;
        continue;
      }
      waits.delete(id);
    }
    if (s.t % DAY === 0) bad.push(...check(db, s));
  }
  return { stuck, late, bad: [...new Set(bad)] };
}

describe('длинная игра не встаёт', () => {
  test('год, где игрок отклоняет каждую вторую серию ГП: зона вывозится, линия не встаёт', () => {
    // мест игрок не выбрал: решения по серии — его, а отклонения оценивает коллега качества, как в замере спецификации
    const s = newPlant(db, { scenario: SC });
    const seen = new Set<string>();
    let n = 0;
    const r = year(s, () => {
      for (const b of Object.values(s.batches)) {
        if (b.status !== 'fg' || seen.has(b.id)) continue;
        seen.add(b.id);
        if (++n % 2 === 0) apply(db, s, { kind: 'release', batch: b.id, decision: 'reject' });
      }
    });
    expect(r).toEqual({ stuck: 0, late: 0, bad: [] });
    // вывозов — много, у каждого счёт; отклонённые серии ГП — в журнале отходов
    expect(s.waste.log.length).toBeGreaterThan(20);
    const gone = new Set(s.waste.log.flatMap(e => e.lots.map(x => x.lot)));
    const rejected = Object.values(s.batches).filter(b => b.status === 'rejected' && b.pack?.fg);
    expect(rejected.length).toBeGreaterThan(80);
    expect(rejected.filter(b => gone.has(b.pack!.fg!)).length).toBeGreaterThan(rejected.length - 6);
  }, 300_000);

  test('год с уставками Б1ж на краю диапазона: последнее задание года линия кончает в его последнюю неделю', () => {
    // уставки — игрока, без места: отклонения оценивает коллега качества, как в замере Б1ж
    const s = newPlant(db, { scenario: SC });
    for (const rcp of Object.values(db.recipes)) {
      const p = rcp.stages.find(x => x.id === 'compress')?.params.find(x => x.id === 'speed');
      if (p) apply(db, s, { kind: 'setpoint', recipe: rcp.id, stage: 'compress', param: 'speed', value: p.range[1], by: 'player' });
    }
    for (const k of Object.values(db.skus)) apply(db, s, { kind: 'setpoint', sku: k.id, value: k.speed.range[1], by: 'player' });
    const end = s.t + 365 * DAY;
    const r = year(s);
    expect(r).toEqual({ stuck: 0, late: 0, bad: [] });
    const last = Math.max(...Object.values(s.batches).flatMap(b => (b.pack?.end !== undefined ? [b.pack.end] : [])));
    expect(end - last).toBeLessThan(7 * DAY);
    expect(s.waste.log.length).toBeGreaterThan(0);
  }, 300_000);
});

describe('виды — без истины, из учёта', () => {
  test('планёрка, карточка помещения отклонённого и фуры, «Сейчас», рычаг, журнал решений — пост «Снабжение и склад»', () => {
    const s = newPlant(db, { scenario: SC });
    const lots = reject(s, 3);
    const room = plan.plant.rooms.findIndex(r => r.type === 'rejected');
    const meeting = () => morningView(db, s, { view: 'morning', day: dayOf(s) + (momentOf(s.start, s.t).sec >= 8 * HOUR ? 1 : 0) }).rejects!;
    expect(meeting()).toEqual({ used: 3, places: rej.length, waiting: [], out: [] });
    expect(wasteLevers(meeting())).toEqual([{ k: 'waste', seat: 'supply' }]);
    apply(db, s, { kind: 'waste' });
    const o = s.waste.order!;
    expect(meeting().order).toEqual({ at: o.at, by: 'player' });
    expect(wasteLevers(meeting())).toEqual([]);
    expect(postOf(db, s.journal.at(-1)!)).toBe('supply');
    const card = cardView(db, s, { kind: 'room', i: room }).card;
    if (card.kind !== 'room' || !card.waste) throw new Error('нет блока зоны');
    // зону отклонённого, склад и лабораторию движок не убирает — строк чистоты нет; у помещений стадии и линии — есть
    const cleanAt = (type: string) => {
      const c = cardView(db, s, { kind: 'room', i: plan.plant.rooms.findIndex(r => r.type === type) }).card;
      return c.kind === 'room' ? (c.clean?.k ?? 'none') : c.kind;
    };
    expect(['rejected', 'warehouse', 'lab', 'dispensing', 'packaging'].map(cleanAt)).toEqual(['none', 'none', 'none', 'clean', 'clean']);
    expect(card.waste.places).toHaveLength(rej.length);
    expect(card.waste.places.filter(x => x.lot).map(x => x.lot)).toEqual(lots.map(id => [s.lots[id].code.y, s.lots[id].code.m, s.lots[id].code.n]));
    expect([card.waste.order, card.waste.log]).toEqual([{ at: o.at, by: 'player' }, []]);
    live(s, () => Object.values(s.tasks).some(t => t.kind === 'wasteLoad' && t.state === 'busy'), o.at + HOUR);
    const tr = s.trucks[o.truck!];
    const n = Number(tr.id.slice(1));
    // фура подрядчика — карточка и строка «Сейчас» склада с людьми погрузки
    expect(cardView(db, s, { kind: 'truck', n, customer: false, waste: true }).card).toMatchObject({ kind: 'truck', truck: n, waste: { booked: o.booked, by: 'player' }, docked: true, open: true });
    expect(cardView(db, s, { kind: 'truck', n, customer: false }).card).toEqual({ kind: 'gone' });
    const row = nowView(db, s).rows.find(r => r.kind === 'truck' && r.waste)!;
    expect(row).toMatchObject({ dept: 'wms', from: tr.arrived, thing: { kind: 'truck', n, customer: false, waste: true } });
    expect(row.people.length).toBeGreaterThan(0);
    expect(meeting().order?.truck).toBe('dock');
    live(s, () => !s.waste.order, o.at + DAY);
    const e = s.waste.log.at(-1)!;
    // вчерашний вывоз — на следующей планёрке; журнал отходов — в карточке помещения
    const next = morningView(db, s, { view: 'morning', day: dayOf(s, e.t) + 1 }).rejects!;
    expect(next.out).toEqual([{ t: e.t, pallets: 3, sum: e.sum + e.vat }]);
    const after = cardView(db, s, { kind: 'room', i: room }).card;
    if (after.kind !== 'room' || !after.waste) throw new Error('нет блока зоны');
    expect(after.waste.log).toHaveLength(1);
    expect(after.waste.log[0]).toMatchObject({ t: e.t, by: 'player', pallets: 3, sum: e.sum, vat: e.vat, act: e.act, signed: { role: s.people[e.signed].role, tab: s.people[e.signed].tab } });
    expect(after.waste.places.every(x => !x.lot)).toBe(true);
    // правда вещи: ни в планёрке, ни в карточке нет истинных свойств партий
    expect(JSON.stringify([next, after])).not.toContain('truth');
  });

  test('досье серии: отклонённая ГП вывезена на уничтожение — с мгновением вывоза', () => {
    const s = newPlant(db, { scenario: SC });
    const b = Object.values(s.batches)[0];
    live(s, () => b.status === 'fg', 30 * DAY, HOUR);
    apply(db, s, { kind: 'release', batch: b.id, decision: 'reject' });
    live(s, () => s.lots[b.pack!.fg!].status === 'rejected' && lotsInZone(s).includes(b.pack!.fg!), s.t + 5 * DAY, 10 * MIN);
    apply(db, s, { kind: 'waste' });
    live(s, () => s.waste.log.length > 0, s.t + 5 * DAY, 10 * MIN);
    const d = dossierView(db, s, { view: 'dossier', batch: Number(b.id.slice(1)) });
    expect(d.wasted).toEqual([s.waste.log[0].t]);
    // коды пачек вывезенной ГП — в журнале отходов: инварианты кодов сходятся
    expect(s.waste.log[0].lots.find(x => x.lot === b.pack!.fg)?.codes?.length).toBeGreaterThan(0);
    expect(check(db, s)).toEqual([]);
  }, 60_000);
});

describe('сохранения', () => {
  test('образец схемы 30: журнал отходов пуст; запись новой процедуры — у тех, кто её учит; отклонённый балк выносят', async () => {
    const raw = JSON.parse(await Bun.file(new URL('./fixtures/save-v30.json', import.meta.url)).text()) as PlantState;
    // балк серии B2 отклонили до загрузки: партия и серия отклонены, паллета — в промежуточном складе
    const lotId = raw.batches.B2.bulk!;
    raw.lots[lotId].status = 'rejected';
    raw.batches.B2.status = 'rejected';
    for (const u of Object.values(raw.units)) if (u.items.some(c => raw.containers[c].lot === lotId)) u.tag = 'rejected';
    const s = fromSave(db, JSON.stringify(raw));
    expect(s.waste).toEqual({ log: [] });
    const code = db.sops['sop.rejects'].doc.code;
    const day = dayOf(s);
    for (const p of Object.values(s.people)) {
      if (rowsOf(db, p).includes(code)) expect(p.train[code]?.day).toBeLessThanOrEqual(day);
      else expect(p.train[code]).toBeUndefined();
    }
    expect(['role.storekeeper', 'role.driver', 'role.qc-head'].every(r => Object.values(s.people).some(p => p.role === r && p.train[code]))).toBe(true);
    expect(Object.values(s.tasks).filter(t => t.kind === 'bulkOut' && t.lot === lotId)).toHaveLength(1);
    live(s, () => !Object.values(s.units).some(u => u.where.kind === 'room' && u.items.some(c => s.containers[c].lot === lotId)), s.t + DAY);
    expect(Object.values(s.units).some(u => u.where.kind === 'room' && u.items.some(c => s.containers[c].lot === lotId))).toBe(false);
  });

  test('образец схемы 31 читается как есть: вывоз посреди погрузки идёт дальше, фура уезжает', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v31.json', import.meta.url)).text();
    const s = fromSave(db, json);
    const o = s.waste.order!;
    const before = s.waste.log.map(e => e.id);
    expect(before.length).toBeGreaterThan(0);
    expect(s.trucks[o.truck!].docked).toBe(true);
    expect(live(s, () => !s.waste.order, s.t + DAY)).toEqual([]);
    expect(s.waste.log.map(e => e.id)).toEqual([...before, o.id]);
  });
});

describe('сборщик базы', () => {
  test('запись `waste`: часы подрядчика — внутри суток, подпись и цены больше нуля; процедуре учатся все роли её работ', () => {
    const rec = scenario.shape.waste;
    const ok = { hours: [9, 17], sign: 20, trip: 15000, pallet: 12000 };
    expect(rec.safeParse(ok).success).toBe(true);
    expect(rec.safeParse(undefined).success).toBe(true);
    const bad = [{ hours: [17, 9] }, { hours: [9, 25] }, { hours: [-1, 9] }, { hours: [9, 9] }, { sign: 0 }, { trip: 0 }, { pallet: -1 }];
    for (const x of bad) expect(rec.safeParse({ ...ok, ...x }).success).toBe(false);
    // в сценарии — секунды и копейки
    expect(w).toEqual({ hours: [9 * HOUR, 17 * HOUR], sign: 20 * MIN, trip: 1_500_000, pallet: 1_200_000 });
    // процедура обращения с отклонённым — работам выноса, погрузки и подписи, и учат её все роли, которым они достаются
    const sop = db.sops['sop.rejects'];
    expect(sop.for.tasks).toEqual(['bulkOut', 'wasteLoad', 'wasteSign']);
    for (const r of [...WMS.keepers, ...WMS.movers, ...WASTE.signers]) expect(sop.roles).toContain(r);
    expect(db.sops['sop.cleanzone'].for.tasks).toContain('bulkOut');
  });
});
