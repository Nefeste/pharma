// Часть 1в: серия (docs/specs/2026-10-engine.md, 1в). Резерв по FEFO с пересчётом АФС; нехватка и ожидание; комплект
// через шлюз и возврат остатков; стадии по карте в своих помещениях; стадия не стартует на грязном или занятом; малая и
// большая уборка; масса по стадиям; причины записаны; МОК; балк в карантине и его испытания; отказ; сохранение посреди
// стадии.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { P_ONE } from '../../src/engine/core/rng';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { DIRTY_HOLD } from '../../src/engine/mes';
import { planOf } from '../../src/engine/plant';
import { fromSave, toSave } from '../../src/engine/save';
import { createLot, findSlot, knownAssay, stockChanged } from '../../src/engine/stock';
import type { Batch, Notice, PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const RCP = 'rcp.paracetamol500.wet.v1';
const plan = planOf(db, db.scenarios[SC].plant);
const recipe = db.recipes[RCP];

/** Завод без заданий сценария: серии в тесте заказываются вручную. */
const bare: ContentDb = { ...db, scenarios: { ...db.scenarios, [SC]: { ...db.scenarios[SC], batches: [] } } };

/** Прожить `days` суток часами с инвариантами; `look` — перед каждым событием. */
function live(base: ContentDb, s: PlantState, days: number, look?: () => void): Notice[] {
  const out: Notice[] = [];
  const end = s.t + days * DAY;
  const more = look ? () => (look(), true) : undefined;
  while (s.t < end) {
    out.push(...apply(base, s, { kind: 'advance', seconds: Math.min(HOUR, end - s.t) }, more));
    look?.();
    const bad = check(base, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
  return out;
}

function order(base: ContentDb, s: PlantState, notBefore = s.t): Batch {
  const n = Object.keys(s.batches).length;
  apply(base, s, { kind: 'order', recipe: RCP, notBefore });
  return Object.values(s.batches)[n];
}

describe('задание и резерв', () => {
  test('отказ: нет такой карты', () => {
    const s = newPlant(bare, { scenario: SC });
    const out = apply(bare, s, { kind: 'order', recipe: 'rcp.none' });
    expect(out).toEqual([{ kind: 'refused', cmd: 'order', why: 'noRecipe', detail: 'rcp.none' }]);
    expect(Object.keys(s.batches)).toEqual([]);
  });

  test('АФС — с пересчётом на известное заводу содержание, «до массы» добирает серию до 120 кг', () => {
    const s = newPlant(bare, { scenario: SC });
    const b = order(bare, s);
    expect(b.status).toBe('reserved');
    const api = b.kit.filter(k => k.material === 'mat.api.paracetamol');
    const active = api.reduce((n, k) => n + Math.floor((k.qty * k.assay!) / P_ONE), 0);
    // действующего — норма карты, с точностью до миллиграмма на тару
    expect(Math.abs(active - recipe.bom[0].qty)).toBeLessThanOrEqual(api.length);
    for (const k of api) expect(k.assay).toBe(knownAssay(bare, s, s.lots[k.lot]));
    const gross = api.reduce((n, k) => n + k.qty, 0);
    const mcc = b.kit.filter(k => k.material === 'mat.exc.mcc').reduce((n, k) => n + k.qty, 0);
    expect(mcc).toBe(recipe.bom.find(l => l.qs)!.qty - (gross - recipe.bom[0].qty));
    expect(b.kit.reduce((n, k) => n + k.qty, 0)).toBe(recipe.batch.mass);
    // резерв — на таре
    for (const k of b.kit) expect(s.containers[k.container].reserved).toBeGreaterThanOrEqual(k.qty);
    expect(check(bare, s)).toEqual([]);
  });

  test('FEFO: сначала партия, у которой раньше срок; в партии — начатая тара', () => {
    const s = newPlant(bare, { scenario: SC });
    // вторая разрешённая партия крахмала со сроком раньше стартовой
    const near = plan.slot[plan.byKind.staging[0].id];
    const { lot } = createLot(bare, s, {
      material: 'mat.exc.starch',
      supplier: 'sup.exc',
      qty: 25_000_000,
      status: 'released',
      where: () => ({ kind: 'slot', id: findSlot(s, plan, 'storage', near, 0)!.id }),
    });
    lot.expiry -= 100;
    const b = order(bare, s);
    expect(b.kit.filter(k => k.material === 'mat.exc.starch').map(k => k.lot)).toEqual([lot.id]);
    // первая серия начала бочку АФС — вторая берёт её первой
    live(bare, s, 2);
    const b2 = order(bare, s);
    const opened = b2.kit.find(k => k.material === 'mat.api.paracetamol')!;
    expect(s.containers[opened.container].opened).toBe(true);
  });

  test('не хватает — серия ждёт с перечнем; новая разрешённая партия — резерв', () => {
    const s = newPlant(bare, { scenario: SC });
    // пять серий забирают почти весь АФС со склада (600 кг), шестой не хватает
    for (let i = 0; i < 6; i++) order(bare, s, s.t + 30 * DAY);
    const last = Object.values(s.batches)[5];
    expect(last.status).toBe('waiting');
    expect(last.short!.map(x => x.material)).toEqual(['mat.api.paracetamol']);
    const near = plan.slot[plan.byKind.staging[0].id];
    createLot(bare, s, {
      material: 'mat.api.paracetamol',
      supplier: 'sup.api',
      qty: 200_000_000,
      status: 'released',
      where: () => ({ kind: 'slot', id: findSlot(s, plan, 'storage', near, 99)!.id }),
    });
    stockChanged(s);
    apply(bare, s, { kind: 'advance', seconds: HOUR });
    expect(last.status).toBe('reserved');
    expect(last.short).toBeUndefined();
  });
});

describe('серия от комплекта до балка', () => {
  test('комплект через шлюз, стадии по карте в своих помещениях, остатки — на склад, балк — в карантине', () => {
    const s = newPlant(bare, { scenario: SC });
    const b = order(bare, s, s.t + HOUR);
    const path: Record<string, string[]> = {};
    let kitSeen = false;
    const out = live(bare, s, 4, () => {
      for (const u of Object.values(s.units)) {
        const kind = u.where.kind === 'slot' ? plan.slot[u.where.id].kind : u.where.kind === 'room' ? `room:${u.where.id}` : 'truck';
        const p = (path[u.id] ??= []);
        if (p.at(-1) !== kind) p.push(kind);
      }
      // комплект собран: вся тара — на пластиковой паллете в отвешивании
      if (b.status === 'process' && b.stage === 0 && b.kitUnit) {
        kitSeen = true;
        const kit = s.units[b.kitUnit];
        expect(kit.type).toBe('unit.pallet.plastic');
        expect(kit.where).toEqual({ kind: 'room', id: 'dispensing' });
        for (const k of b.kit) expect(s.containers[k.container].unit).toBe(kit.id);
      }
    });
    expect(kitSeen).toBe(true);
    expect(b.status).toBe('bulk');
    // паллеты с тарой комплекта ездили к шлюзу и обратно (или ушли пустыми)
    const picked = Object.entries(path).filter(([, p]) => p.includes('staging'));
    expect(picked.length).toBeGreaterThan(0);
    for (const [, p] of picked) if (p[0] === 'storage') expect(p.slice(0, 2)).toEqual(['storage', 'staging']);
    // стадии — по порядку карты, каждая в своём помещении, на своём оборудовании, нужным числом людей
    expect(b.records.map(r => r.stage)).toEqual(recipe.stages.map(st => st.id));
    for (const [i, rec] of b.records.entries()) {
      const st = recipe.stages[i];
      expect(rec.room).toBe(plan.roomOf[st.room]);
      expect(rec.equipment.map(e => s.equipment[e].type)).toEqual(st.equipment);
      expect(rec.people.length).toBe(st.staff.n);
      for (const p of rec.people) expect(s.people[p].role).toBe(st.staff.role);
      if (i > 0) expect(rec.start).toBeGreaterThanOrEqual(b.records[i - 1].end);
    }
    // отвешено ровно то, что было в комплекте; израсходовано у партий — то же
    const used: Record<string, number> = {};
    for (const x of b.dispensed) used[x.lot] = (used[x.lot] ?? 0) + x.qty;
    for (const [lot, q] of Object.entries(used)) expect(s.lots[lot].used).toBe(q);
    expect(b.dispensed.reduce((n, x) => n + x.qty, 0)).toBe(recipe.batch.mass);
    // комплекта больше нет: пустая тара ушла из учёта, остатки — на стеллажах, по партии на паллете
    expect(b.kitUnit).toBeUndefined();
    for (const x of b.dispensed) {
      const c = s.containers[x.container];
      if (!c) continue;
      const u = s.units[c.unit];
      expect(u.type).toBe('unit.pallet.euro');
      expect(new Set(u.items.map(id => s.containers[id].lot)).size).toBe(1);
    }
    // балк: партия полупродукта в карантине на промежуточном складе, номер — номер серии
    const bulk = s.lots[b.bulk!];
    expect(out.find(n => n.kind === 'batchBulk')).toEqual({ kind: 'batchBulk', batch: b.id, lot: bulk.id });
    expect(bulk.material).toBe(recipe.bulk);
    expect(bulk.qty).toBe(b.units!);
    expect(bulk.vendorLot).toBe(`${String(b.code.y).padStart(2, '0')}${String(b.code.m).padStart(2, '0')}${String(b.code.n).padStart(2, '0')}`);
    expect(['quarantine', 'sampled', 'testing', 'released', 'rejected']).toContain(bulk.status);
    for (const c of Object.values(s.containers).filter(c => c.lot === bulk.id)) expect(s.units[c.unit].where).toEqual({ kind: 'room', id: 'bulk' });
    // выход: таблеток столько, сколько массы на среднюю массу таблетки
    const tablet = (recipe.batch.mass * b.truth.mass!) / (recipe.batch.units * P_ONE);
    expect(b.units).toBe(Math.floor(b.mass / tablet));
  });

  test('МОК: при сушке — раз, при таблетировании — каждые 30 минут; результаты — в досье стадии', () => {
    const s = newPlant(bare, { scenario: SC });
    const b = order(bare, s, s.t + HOUR);
    live(bare, s, 4);
    const dry = b.records.find(r => r.stage === 'dry')!;
    expect(dry.ipc.map(x => x.test)).toEqual(['test.lod']);
    const press = b.records.find(r => r.stage === 'compress')!;
    const n = Math.floor((press.end - press.start) / (30 * 60));
    expect(press.ipc.filter(x => x.test === 'test.ipc.mass').length).toBe(n);
    expect(press.ipc.filter(x => x.test === 'test.ipc.hardness').length).toBe(n);
    for (const x of press.ipc) expect(x.t).toBeLessThanOrEqual(press.end);
  });

  test('МОК вне пределов — отклонение с номером стадии', () => {
    // узкие пределы прочности: МОК почти наверняка выйдет за них
    const st = recipe.stages.map(x => (x.id === 'compress' ? { ...x, ipc: x.ipc.map(c => (c.test === 'test.ipc.hardness' ? { ...c, min: 8400, max: 8600 } : c)) } : x));
    const narrow: ContentDb = { ...bare, recipes: { ...bare.recipes, [RCP]: { ...recipe, stages: st } } };
    const s = newPlant(narrow, { scenario: SC });
    const b = order(narrow, s, s.t + HOUR);
    const out = live(narrow, s, 4);
    const devs = Object.values(s.deviations).filter(d => d.kind === 'ipc' && d.batch === b.id);
    expect(devs.map(d => [d.stage, d.test])).toEqual([['compress', 'test.ipc.hardness']]);
    expect(out.some(n => n.kind === 'deviation' && n.id === devs[0].id)).toBe(true);
  });
});

describe('помещения и чистота', () => {
  test('стадия не стартует на грязном или занятом: вторая серия ждёт уборки после первой', () => {
    const s = newPlant(bare, { scenario: SC });
    const b1 = order(bare, s, s.t + HOUR);
    const b2 = order(bare, s, s.t + HOUR);
    // перед каждым событием: идущая стадия — только в помещении, занятом этой серией
    live(bare, s, 6, () => {
      for (const t of Object.values(s.tasks)) {
        if (t.kind !== 'stage' || t.state !== 'busy') continue;
        const room = s.rooms[s.batches[t.batch!].room!];
        expect([room.status, room.batch]).toEqual(['busy', t.batch]);
      }
    });
    expect([b1.status, b2.status]).toEqual(['bulk', 'bulk']);
    // в каждом помещении вторая серия вошла после того, как первая ушла и помещение убрали
    for (const st of recipe.stages) {
      const r1 = b1.records.find(r => r.stage === st.id)!;
      const r2 = b2.records.find(r => r.stage === st.id)!;
      expect(r2.start).toBeGreaterThan(r1.end);
    }
  });

  test('уборка: та же продукция — малая; грязное дольше суток — большая', () => {
    const s = newPlant(bare, { scenario: SC });
    const room = s.rooms[plan.roomOf.granulation];
    const minor = Object.values(s.equipment).filter(e => e.room === room.id).reduce((n, e) => n + bare.equipment[e.type].cleaning.minor, 0);
    const major = Object.values(s.equipment).filter(e => e.room === room.id).reduce((n, e) => n + bare.equipment[e.type].cleaning.major, 0);
    // грязное только что: малая уборка
    Object.assign(room, { status: 'dirty', since: s.t, product: 'prd.paracetamol500' });
    apply(bare, s, { kind: 'advance', seconds: HOUR });
    const t1 = Object.values(s.tasks).find(t => t.kind === 'clean' && t.room === room.id)!;
    expect(t1.work).toBe(minor);
    // ночь и выходные: убирать некому, через сутки уборка становится большой
    const s2 = newPlant(bare, { scenario: SC });
    const room2 = s2.rooms[plan.roomOf.granulation];
    // пятница, 23:00 — смена «b» кончилась
    apply(bare, s2, { kind: 'advance', seconds: 2 * DAY + 16 * HOUR });
    Object.assign(room2, { status: 'dirty', since: s2.t, product: 'prd.paracetamol500' });
    apply(bare, s2, { kind: 'advance', seconds: DIRTY_HOLD + 2 * HOUR });
    const t2 = Object.values(s2.tasks).find(t => t.kind === 'clean' && t.room === room2.id)!;
    expect(room2.major).toBe(true);
    expect(t2.work).toBe(major);
    expect(check(bare, s2)).toEqual([]);
  });
});

describe('сценарий', () => {
  test('восемь заданий за 90 суток: серии идут по одной, ждут АФС из заказа; масса и причины сходятся', () => {
    const s = newPlant(db, { scenario: SC, seed: 4 });
    const out = live(db, s, 90);
    const batches = Object.values(s.batches);
    expect(batches.length).toBe(8);
    expect(out.filter(n => n.kind === 'batchBulk').length).toBe(batches.filter(b => b.status === 'bulk').length);
    // первые пять — из запаса, дальше — когда разрешена партия АФС из заказа
    for (const b of batches.slice(0, 5)) expect(b.status).toBe('bulk');
    const api = Object.values(s.lots).find(l => l.material === 'mat.api.paracetamol' && l.po)!;
    for (const b of batches.filter(x => x.dispensed.some(d => d.lot === api.id))) {
      expect(b.records[0].start).toBeGreaterThan(api.received);
    }
  });
});

describe('сохранение посреди стадии', () => {
  test('снимок, пока идёт сушка, продолжается так же, как оригинал', () => {
    const s = newPlant(bare, { scenario: SC });
    order(bare, s, s.t + HOUR);
    while (!Object.values(s.tasks).some(t => t.kind === 'stage' && t.state === 'busy' && s.batches[t.batch!].stage === 2)) apply(bare, s, { kind: 'advance', seconds: 600 });
    const copy = fromSave(bare, toSave(s));
    apply(bare, s, { kind: 'advance', seconds: 3 * DAY });
    apply(bare, copy, { kind: 'advance', seconds: 3 * DAY });
    expect(fingerprint(copy)).toBe(fingerprint(s));
  });
});
