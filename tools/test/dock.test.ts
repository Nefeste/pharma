// Часть 3а: фура у рампы (docs/specs/2026-10-panels.md, 3а; развилка #34, варианты 2 и 3). Фура поставщика встала к рампе
// — кладовщик проверяет её у рампы, разгрузки до конца проверки нет, кузов закрыт; с холодом проверка дольше. Рампу держит
// одна фура, следующая ждёт во дворе, её ожидание — потери склада с причиной «рампа занята». Фура покупателя открыта, как
// встала. Срез несёт, открыт ли кузов; сохранение схемы 8 открывает фуры, которые уже у рампы. Двор — только картинка: фура
// въезжает задним ходом с запада, с места ожидания к рампе — тоже задом, уходит вперёд за край двора.
import { describe, expect, test } from 'bun:test';
import { spotOf, Yard, YARD } from '../../src/app/yard';
import { db } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { DAY, HOUR, MIN } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { fromSave, toSave } from '../../src/engine/save';
import { dispatch } from '../../src/engine/tasks';
import type { PlantState, Task } from '../../src/engine/types';
import { CHECK_COLD, CHECK_WORK, truckArrives } from '../../src/engine/wms';
import { Packer, unpack } from '../../src/sim/pack';

const SC = 'scn.proto';

const tasksOf = (s: PlantState, kind: Task['kind']) => Object.values(s.tasks).filter(t => t.kind === kind);
const dockWaits = (s: PlantState) => s.losses.reduce((n, d) => n + (d.wait.wms?.dock ?? 0), 0);

/** Завод в рабочий день в 10:00, все заказы сценария ещё в пути. */
function weekday(): PlantState {
  const s = newPlant(db, { scenario: SC });
  // 2027-09-02 — четверг: кладовщики и водители в смене
  apply(db, s, { kind: 'advance', seconds: DAY + 10 * HOUR - s.t });
  return s;
}

describe('проверка фуры поставщика', () => {
  test('встала к рампе — проверка кладовщика у рампы, 15 минут; разгрузки нет, кузов закрыт; после — кузов открыт, паллеты снимают', () => {
    const s = weekday();
    const po = Object.values(s.pos).find(p => p.status === 'ordered')!;
    truckArrives(db, s, po.id, []);
    dispatch(db, s);
    const truck = Object.values(s.trucks).find(t => t.po === po.id)!;
    expect([truck.docked, truck.open]).toEqual([true, false]);
    const [chk] = tasksOf(s, 'truckCheck');
    expect(chk.roles).toEqual(['role.storekeeper']);
    expect(chk.from).toEqual({ kind: 'truck', id: truck.id });
    expect(chk.work).toBe(CHECK_WORK);
    expect(tasksOf(s, 'unload')).toEqual([]);
    apply(db, s, { kind: 'advance', seconds: chk.times![4] - s.t - 1 });
    expect(tasksOf(s, 'unload')).toEqual([]);
    expect(truck.open).toBe(false);
    apply(db, s, { kind: 'advance', seconds: 1 });
    expect(truck.open).toBe(true);
    expect(tasksOf(s, 'unload').map(t => t.unit).sort()).toEqual([...truck.units].sort());
    // кладовщик работал у рампы
    expect(chk.people.every(id => s.people[id].role === 'role.storekeeper')).toBe(true);
    apply(db, s, { kind: 'advance', seconds: 2 * 60 * MIN });
    expect(s.trucks[truck.id]).toBeUndefined();
    expect(check(db, s)).toEqual([]);
  });

  test('на фуре материал с холодом — проверка дольше: ещё запись температуры в пути', () => {
    const s = weekday();
    const po = Object.values(s.pos).find(p => p.status === 'ordered')!;
    const material = po.lines[0].material;
    const cold: ContentDb = { ...db, materials: { ...db.materials, [material]: { ...db.materials[material], storage: 'cold' } } };
    truckArrives(cold, s, po.id, []);
    expect(tasksOf(s, 'truckCheck')[0].work).toBe(CHECK_WORK + CHECK_COLD);
  });
});

describe('рампа занята', () => {
  test('две фуры сразу: вторая ждёт во дворе закрытой, пока первую не разгрузят; её ожидание — потери склада «рампа занята»', () => {
    const s = weekday();
    const [a, b] = Object.values(s.pos).filter(p => p.status === 'ordered');
    const before = dockWaits(s);
    truckArrives(db, s, a.id, []);
    truckArrives(db, s, b.id, []);
    dispatch(db, s);
    const first = Object.values(s.trucks).find(t => t.po === a.id)!;
    const second = Object.values(s.trucks).find(t => t.po === b.id)!;
    expect([first.docked, second.docked, second.open]).toEqual([true, false, false]);
    expect(tasksOf(s, 'truckCheck').length).toBe(1);
    const came = second.arrived;
    while (s.trucks[first.id]) apply(db, s, { kind: 'advance', seconds: MIN });
    expect(second.docked).toBe(true);
    expect(dockWaits(s) - before).toBeGreaterThanOrEqual(CHECK_WORK);
    // ждала столько, сколько рампу держала первая: до минуты, в которую та ушла
    expect(dockWaits(s) - before).toBeLessThanOrEqual(s.t - came);
    expect(tasksOf(s, 'truckCheck').some(t => t.from.kind === 'truck' && t.from.id === second.id)).toBe(true);
  });

  test('фура покупателя открыта, как встала; срез несёт, открыт ли кузов, — как в движке', () => {
    const s = newPlant(db, { scenario: SC });
    const packer = new Packer(db);
    let customer = 0;
    let supplier = 0;
    // первые фуры покупателей — на 13-е сутки в 15:00, поставщика — на 14-е: до них — крупным шагом
    apply(db, s, { kind: 'advance', seconds: 12 * DAY + 14 * HOUR - s.t });
    for (let i = 0; i < 3 * 24 * 60 && (customer === 0 || supplier === 0); i++) {
      apply(db, s, { kind: 'advance', seconds: MIN });
      const sl = unpack(packer.pack(s, 0));
      for (const r of sl.trucks) {
        const t = Object.values(s.trucks).find(x => Number(x.id.slice(1)) === r.truck && !!x.customer === r.customer)!;
        expect([r.docked, r.open]).toEqual([t.docked, t.open]);
        if (t.customer && t.docked) {
          expect(t.open).toBe(true);
          customer++;
        }
        if (!t.customer && t.docked && !t.open) supplier++;
      }
    }
    expect(customer).toBeGreaterThan(0);
    expect(supplier).toBeGreaterThan(0);
  });

  test('сохранение схемы 8: фура у рампы — открыта, во дворе — закрыта', () => {
    const s = weekday();
    const [a, b] = Object.values(s.pos).filter(p => p.status === 'ordered');
    truckArrives(db, s, a.id, []);
    truckArrives(db, s, b.id, []);
    const raw = JSON.parse(toSave(s));
    raw.schema = 8;
    for (const t of Object.values(raw.trucks) as { open?: boolean }[]) delete t.open;
    const back = fromSave(db, JSON.stringify(raw));
    const trucks = Object.values(back.trucks);
    expect(trucks.map(t => [t.docked, t.open])).toEqual([
      [true, true],
      [false, false],
    ]);
  });
});

describe('двор (только картинка)', () => {
  const front = (dock: number) => ({ x: 0, z: dock === 0 ? 5 : 34 });
  const row = (truck: number, docked: boolean, open: boolean, customer = false) => ({ truck, dock: customer ? 1 : 0, docked, customer, open });

  test('первый срез: фуры уже на местах; новая — въезжает задним ходом с запада и встаёт у ворот за `far / reverse` секунд', () => {
    const y = new Yard();
    y.update([row(1, true, true)], front, 1000);
    expect(y.at(1000)).toMatchObject([{ truck: 1, x: spotOf(front(0), true, 0).x, moving: false }]);
    y.update([row(1, true, true), row(2, false, false)], front, 2000);
    const spot = spotOf(front(0), false, 0);
    const [, a] = y.at(2000);
    expect([a.x, a.z, a.closed]).toEqual([spot.x - YARD.far, spot.z, true]);
    let prev = a.x;
    for (let t = 2001; t < 2000 + YARD.far / YARD.reverse; t += 3) {
      const p = y.at(t)[1];
      expect(p.x).toBeGreaterThan(prev);
      expect(p.moving).toBe(true);
      prev = p.x;
    }
    expect(y.at(2000 + YARD.far / YARD.reverse)[1]).toMatchObject({ x: spot.x, z: spot.z, moving: false });
  });

  test('с места ожидания — к рампе задним ходом; ушедшая из учёта — вперёд на запад, закрытой, и пропадает за краем двора', () => {
    const y = new Yard();
    y.update([row(1, true, true), row(2, false, false)], front, 0);
    const wait = spotOf(front(0), false, 0);
    const dock = spotOf(front(0), true, 0);
    y.update([row(2, true, false)], front, 100);
    const leg = Math.hypot(dock.x - wait.x, dock.z - wait.z) / YARD.reverse;
    expect(y.at(100).find(p => p.truck === 2)).toMatchObject({ x: wait.x, z: wait.z, docked: true, closed: true });
    expect(y.at(100 + leg).find(p => p.truck === 2)).toMatchObject({ x: dock.x, z: dock.z, moving: false });
    const gone = y.at(100).find(p => p.truck === 1)!;
    expect([gone.x, gone.docked, gone.closed]).toEqual([dock.x, false, true]);
    const out = 100 + YARD.far / YARD.forward;
    expect(y.at(out - 1).find(p => p.truck === 1)!.x).toBeLessThan(dock.x - YARD.far + 1);
    expect(y.at(out).find(p => p.truck === 1)).toBeUndefined();
  });

  test('кузов закрыт, пока фура поставщика не проверена; фура покупателя открыта, как встала', () => {
    const y = new Yard();
    y.update([row(1, true, false), row(2, true, true, true)], front, 0);
    expect(y.at(0).map(p => [p.truck, p.closed])).toEqual([
      [1, true],
      [2, false],
    ]);
    y.update([row(1, true, true), row(2, true, true, true)], front, 900);
    expect(y.at(900).map(p => p.closed)).toEqual([false, false]);
  });
});
