// Часть 1а: склад и приёмка (docs/specs/2026-10-engine.md, 1а). План завода, запас на старте, заказ поставщику, фура,
// разгрузка, приёмка, размещение; смены и допуски; инварианты на каждом часе; ход срезами — то же, что куском. Что
// бывает с партией после карантина, — tools/test/lab.test.ts.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR, momentOf } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { planOf } from '../../src/engine/plant';
import { dispatch } from '../../src/engine/tasks';
import type { Notice } from '../../src/engine/types';
import { truckArrives } from '../../src/engine/wms';

const SC = 'scn.proto';
const plan = planOf(db, db.scenarios[SC].plant);

describe('план завода', () => {
  test('места зон и стеллажей: число, уникальные адреса, ярусы', () => {
    const zones = db.plants['plant.proto'].zones.reduce((n, z) => n + z.grid[0] * z.grid[1], 0);
    expect(plan.slots.length).toBe(zones + 4 * 6 * 3 * 4);
    expect(new Set(plan.slots.map(s => s.id)).size).toBe(plan.slots.length);
    expect(plan.byKind.storage.filter(s => s.level === 3).length).toBe(4 * 6 * 3);
    expect(plan.slot['A-01-1-1']).toMatchObject({ kind: 'storage', group: 'A', level: 0 });
  });
});

describe('старт', () => {
  test('штат, техника, запас на стеллажах — разрешённые партии; инварианты в порядке', () => {
    const s = newPlant(db, { scenario: SC });
    expect(Object.keys(s.people).length).toBe(db.scenarios[SC].staff.reduce((n, r) => n + r.n, 0));
    expect(Object.keys(s.vehicles).length).toBe(3);
    const lots = Object.values(s.lots);
    expect(lots.length).toBe(db.scenarios[SC].stock.length);
    for (const lot of lots) expect(lot.status).toBe('released');
    // парацетамол 600 кг — 12 бочек по 50 кг на 3 паллетах
    const api = lots.find(l => l.material === 'mat.api.paracetamol')!;
    expect(api.qty).toBe(600_000_000);
    const units = Object.values(s.units).filter(u => s.containers[u.items[0]].lot === api.id);
    expect(units.map(u => u.items.length)).toEqual([4, 4, 4]);
    for (const u of Object.values(s.units)) expect(u.where.kind === 'slot' && plan.slot[u.where.id].kind).toBe('storage');
    expect(check(db, s)).toEqual([]);
  });
});

describe('заказ поставщику', () => {
  test('ниже минимальной партии, чужой материал, нет поставщика — отказ', () => {
    const s = newPlant(db, { scenario: SC });
    const n = Object.keys(s.pos).length;
    const r1 = apply(db, s, { kind: 'po', supplier: 'sup.exc', lines: [{ material: 'mat.exc.starch', qty: 1_000_000 }] });
    const r2 = apply(db, s, { kind: 'po', supplier: 'sup.exc', lines: [{ material: 'mat.api.paracetamol', qty: 600_000_000 }] });
    const r3 = apply(db, s, { kind: 'po', supplier: 'sup.none', lines: [{ material: 'mat.exc.starch', qty: 1 }] });
    expect([r1, r2, r3].map(r => r.find(x => x.kind === 'refused'))).toEqual([
      { kind: 'refused', cmd: 'po', why: 'belowMoq', detail: 'mat.exc.starch' },
      { kind: 'refused', cmd: 'po', why: 'notSold', detail: 'mat.api.paracetamol' },
      { kind: 'refused', cmd: 'po', why: 'noSupplier', detail: 'sup.none' },
    ]);
    expect(Object.keys(s.pos).length).toBe(n);
  });

  test('количество — вверх до целой тары; фура — в рабочий день с 09:00 до 15:00', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = newPlant(db, { scenario: SC, seed });
      const out = apply(db, s, { kind: 'po', supplier: 'sup.exc', lines: [{ material: 'mat.exc.starch', qty: 501_000_000 }] });
      const o = out.find(x => x.kind === 'ordered');
      if (o?.kind !== 'ordered') throw new Error('no order');
      expect(s.pos[o.po].lines[0].qty).toBe(525_000_000);
      const m = momentOf(s.start, o.eta);
      expect(m.weekday).toBeLessThan(5);
      expect(m.sec).toBeGreaterThanOrEqual(9 * HOUR);
      expect(m.sec).toBeLessThan(15 * HOUR);
      const days = (o.eta - s.t) / DAY;
      expect(days).toBeGreaterThanOrEqual(10);
      expect(days).toBeLessThan(20 + 3 + 1);
    }
  });
});

describe('фура → приёмка → карантин', () => {
  test('заказы сценария за 80 суток: все фуры разгружены, каждая паллета прошла приёмку и карантин; инварианты — каждый час', () => {
    const s = newPlant(db, { scenario: SC, seed: 3 });
    // где побывала каждая паллета: виды мест по порядку — смотрим перед каждым событием (`more` у `apply`)
    const path: Record<string, string[]> = {};
    const look = () => {
      for (const u of Object.values(s.units)) {
        const kind = u.where.kind === 'slot' ? plan.slot[u.where.id].kind : 'truck';
        const p = (path[u.id] ??= []);
        if (p[p.length - 1] !== kind) p.push(kind);
      }
      return true;
    };
    const end = s.t + 80 * DAY;
    const notices: Notice[] = [];
    while (s.t < end) {
      notices.push(...apply(db, s, { kind: 'advance', seconds: HOUR }, look));
      look();
      expect(check(db, s)).toEqual([]);
    }
    const trucks = notices.filter(n => n.kind === 'truck');
    expect(trucks.length).toBe(db.scenarios[SC].orders.length);
    expect(Object.keys(s.trucks)).toEqual([]);
    const fresh = Object.values(s.lots).filter(l => l.po);
    // крахмал, МКЦ, пачки №10 и №20, инструкции, гофроящики, парацетамол
    expect(fresh.map(l => l.material).sort()).toEqual(['mat.api.paracetamol', 'mat.exc.mcc', 'mat.exc.starch', 'mat.pk.carton-n10', 'mat.pk.carton-n20', 'mat.pk.case', 'mat.pk.leaflet']);
    let checked = 0;
    for (const lot of fresh) {
      expect(lot.status).toBe('released');
      const sampled = s.samples[lot.sample!].plan;
      for (const u of Object.values(s.units).filter(u => u.where.kind === 'slot' && s.containers[u.items[0]]?.lot === lot.id)) {
        // остаток после отвешивания возвращается из шлюза новой паллетой — у неё свой путь
        if (path[u.id][0] !== 'truck') continue;
        checked++;
        // фура → приёмка → карантин → (пробоотборная и обратно — у паллет с тарой из плана отбора) → стеллаж; дальше
        // паллету может взять комплектация серии или упаковки. Начатая на отборе тара уходит в комплект первой, поэтому
        // у паллеты, побывавшей в пробоотборной, её может уже не быть
        const visit = path[u.id][3] === 'sampling' ? ['sampling', 'quarantine'] : [];
        if (u.items.some(c => sampled.includes(c))) expect(visit.length).toBe(2);
        const head = ['truck', 'receiving', 'quarantine', ...visit, 'storage'];
        expect(path[u.id].slice(0, head.length)).toEqual(head);
        expect(u.tag).toBe('released');
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(Object.keys(s.tasks)).toEqual([]);
    expect(s.open).toEqual([]);
  });

  test('в выходной фуру не разгружают: задачи ждут понедельника, 08:00', () => {
    const s = newPlant(db, { scenario: SC, seed: 5 });
    // 2027-09-04 — суббота: до неё — 3 суток от среды
    apply(db, s, { kind: 'advance', seconds: 3 * DAY + 10 * HOUR - s.t });
    expect(momentOf(s.start, s.t).weekday).toBe(5);
    const po = Object.values(s.pos).find(p => p.supplier === 'sup.exc')!;
    truckArrives(db, s, po.id, []);
    dispatch(db, s);
    expect(Object.values(s.tasks).filter(t => t.kind === 'unload' && t.state === 'busy')).toEqual([]);
    // понедельник 06.09, 08:00 — день кладовщиков и водителей
    apply(db, s, { kind: 'advance', seconds: 5 * DAY + 8 * HOUR + 1 - s.t });
    expect(Object.values(s.tasks).some(t => t.kind === 'unload' && t.state === 'busy')).toBe(true);
    expect(check(db, s)).toEqual([]);
  });

  test('ричтрак водит только водитель с допуском; рохлю — и кладовщик', () => {
    const s = newPlant(db, { scenario: SC, seed: 7 });
    let seen = 0;
    const end = s.t + 30 * DAY;
    while (s.t < end) {
      apply(db, s, { kind: 'advance', seconds: 600 });
      for (const t of Object.values(s.tasks)) {
        if (t.state !== 'busy' || !t.vehicle) continue;
        seen++;
        const role = s.people[t.people[0]].role;
        if (s.vehicles[t.vehicle].type === 'veh.reach') expect(role).toBe('role.driver');
        else expect(['role.driver', 'role.storekeeper']).toContain(role);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('детерминизм', () => {
  test('60 суток шагом 60 с, 3600 с и одним куском — один отпечаток', () => {
    const run = (step: number) => {
      const s = newPlant(db, { scenario: SC, seed: 11 });
      const end = s.t + 60 * DAY;
      while (s.t < end) apply(db, s, { kind: 'advance', seconds: Math.min(step, end - s.t) });
      return fingerprint(s);
    };
    expect(new Set([60, 3600, 60 * DAY].map(run)).size).toBe(1);
  });
});
