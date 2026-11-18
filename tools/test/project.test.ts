// Часть Б7д, шаг 2: проект «Новый продукт» (docs/specs/2026-10-vertical-slice.md, «Б7д», «Проверки Б7д»). Метформин —
// продукт-проект: директор начинает проект, материалы — в силе со старта, новые пары — на оценку; этапы — готовность,
// перенос методик, документы и обучение, оценка очистки, пробная серия «не для продажи», протокол, три серии валидации
// подряд, отчёт, изменение досье; затем позиция — в плане и в спросе покупателей с разгоном. Помещение покрытия, коатер
// и весы — стройкой и «Оборудованием» (путь единиц сокращён: записи — как у сушилки и весов старта).
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, momentOf } from '../../src/engine/core/calendar';
import { liveOf, statusOf } from '../../src/engine/docs';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { gapsOf, rampOf } from '../../src/engine/project';
import { fromSave, toSave } from '../../src/engine/save';
import { editPlan } from '../../src/engine/site/edit';
import { footError } from '../../src/engine/site/units';
import type { Notice, PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const B = db.scenarios[SC].build!;
const MET = 'prd.metformin500';
const SKU = 'sku.metformin500.n60';
const why = (ns: Notice[]) => ns.flatMap(n => (n.kind === 'refused' ? [n.why] : []));
const day = (s: PlantState) => Math.floor(s.t / DAY);

/** Завод с местом директора; с `coating` — помещение покрытия к востоку от корпуса, коатер и весы МОК. */
function plant(coating = true): PlantState {
  const s = newPlant(db, { scenario: SC });
  apply(db, s, { kind: 'seat', seats: ['director'] });
  if (!coating) return s;
  const site = (op: object) => expect(apply(db, s, { kind: 'site', op } as never).some(n => n.kind === 'site' && n.ok)).toBe(true);
  site({ op: 'hull', rect: [59, 1, 12, 12] });
  site({ op: 'room', type: 'corridor.clean', grade: 'D', rect: [59, 9, 12, 4] });
  site({ op: 'room', type: 'coating', grade: 'D', rect: [59, 1, 8, 9] });
  site({ op: 'door', cell: [59, 10], len: 2, along: 'z', kind: 'double' });
  site({ op: 'door', cell: [62, 9], len: 2, along: 'x', kind: 'double' });
  site({ op: 'done' });
  const room = s.plan.rooms.find(r => r.type === 'coating')!.id;
  const spot = (type: string): [number, number] => {
    const r = s.plan.rooms.find(x => x.id === room)!;
    for (let z = r.rect[1] + 100; z < r.rect[1] + r.rect[3] - 100; z += 100)
      for (let x = r.rect[0] + 100; x < r.rect[0] + r.rect[2] - 100; x += 100) {
        const at: [number, number] = [x + 50, z + 50];
        if (!footError(db, s.plan, type, room, at, 0) && editPlan(db, B, s.plan, { op: 'unit', type, room, at, turn: 0, vendor: 'ven.ru' }, {}).ok) return at;
      }
    throw new Error(`no spot for ${type}`);
  };
  for (const [type, like] of [
    ['eq.coater', 'eq.fbd'],
    ['inst.balance', 'inst.balance'],
  ]) {
    const at = db.equipment[type] ? { at: spot(type), turn: 0 } : {};
    const n = apply(db, s, { kind: 'equip', op: { op: 'buy', type, vendor: 'ven.ru', room, ...at } }).find(x => x.kind === 'equip') as Extract<Notice, { kind: 'equip' }> & { thing: string };
    const a = s.assets[n.thing];
    a.recs = structuredClone(Object.values(s.assets).find(x => x.type === like && x.id !== n.thing && !x.path)!.recs);
    delete a.path;
  }
  return s;
}

/** Жить по суткам до условия, не дольше `days`; этапы, через которые прошёл проект P1. */
function until(s: PlantState, cond: () => boolean, days: number): string[] {
  const stages: string[] = [];
  for (let i = 0; i < days && !cond(); i++) {
    for (const n of apply(db, s, { kind: 'advance', seconds: DAY })) if (n.kind === 'project') stages.push(n.stage);
  }
  expect(cond()).toBe(true);
  return stages;
}

describe('команда project', () => {
  test('начать — директор и только продукт-проект, один проект на продукт; остановить — работы уходят', () => {
    const s = plant(false);
    expect(why(apply(db, s, { kind: 'project', op: 'start', product: 'prd.paracetamol500' }))).toEqual(['noProduct']);
    expect(why(apply(db, s, { kind: 'project', op: 'start', product: MET }))).toEqual([]);
    expect(why(apply(db, s, { kind: 'project', op: 'start', product: MET }))).toEqual(['projectBusy']);
    const q = newPlant(db, { scenario: SC });
    apply(db, q, { kind: 'seat', seats: ['quality'] });
    expect(why(apply(db, q, { kind: 'project', op: 'start', product: MET }))).toEqual(['notYours']);
    expect(why(apply(db, s, { kind: 'project', op: 'stop', id: 'P1' }))).toEqual([]);
    expect(s.portfolio!.projects.P1.stage).toBe('stopped');
    expect(Object.values(s.tasks).some(t => t.project === 'P1')).toBe(false);
    // остановленный — можно начать заново
    expect(why(apply(db, s, { kind: 'project', op: 'start', product: MET }))).toEqual([]);
  });

  test('на старте материалы — в силе, новая пара — на оценке; готовность — чего нет: помещение покрытия, коатер, пара', () => {
    const s = plant(false);
    const before = gapsOf(db, s, MET);
    apply(db, s, { kind: 'project', op: 'start', product: MET });
    const d = liveOf(db, s.portfolio!.docs);
    const today = momentOf(s.start, s.t).day;
    expect(statusOf(d, 'specs', 'spec.mat.api.metformin', today)).toBe('active');
    expect(statusOf(d, 'agreements', 'qag.api-met', today)).toBe('active');
    expect(statusOf(d, 'recipes', 'rcp.metformin500.wet.v1', today)).toBe('draft');
    expect(s.pairs['sup.api-met|mkr.api-met']?.eval).toBeDefined();
    const gaps = gapsOf(db, s, MET);
    expect(gaps).toContainEqual({ kind: 'room', type: 'coating' });
    expect(gaps).toContainEqual({ kind: 'pair', material: 'mat.api.metformin' });
    expect(before.length).toBeGreaterThan(0);
    // без помещения покрытия проект ждёт готовности
    until(s, () => day(s) >= 20, 25);
    expect(s.portfolio!.projects.P1.stage).toBe('ready');
  });
});

describe('проект до производства', () => {
  // один завод на все проверки: проект идёт около семи месяцев игры
  const s = plant(true);
  apply(db, s, { kind: 'project', op: 'start', product: MET });
  const stages = until(s, () => s.portfolio!.projects.P1.stage === 'done', 320);
  const p = s.portfolio!.projects.P1;

  test('этапы — по порядку: методики, документы, очистка, пробная, протокол, валидация, отчёт, досье, в производстве', () => {
    expect(stages).toEqual(['methods', 'docs', 'clean', 'trial', 'protocol', 'validation', 'report', 'dossier', 'done']);
    expect(p.passed).toBe(db.scenarios[SC].project!.batches);
    expect(check(db, s)).toEqual([]);
  });

  test('пробная и серии валидации — не для продажи: балк — в отклонённое, позиции нет', () => {
    for (const id of [p.trial!, ...p.batches]) {
      const b = s.batches[id];
      expect(b.for?.kind).toBe('project');
      expect(b.sku).toBeUndefined();
      expect(s.lots[b.bulk!].status).toBe('rejected');
    }
    expect(p.batches.length).toBe(3);
  });

  test('после досье — позиция в силе, в плане и в спросе; разгон — с четверти', () => {
    const d = liveOf(db, s.portfolio!.docs);
    expect(d.scenarios[SC].plan!.items.some(it => it.sku === SKU)).toBe(true);
    expect(d.customers['cus.national'].demand[SKU]).toBe(900);
    expect(rampOf(d, s, SKU)).toBe(db.scenarios[SC].project!.ramp.from);
    // без проекта — база та же, тем же объектом
    expect(liveOf(db, undefined)).toBe(db);
  });

  test('продукт живёт: заказы покупателей, задания планировщика на запас, упаковка', () => {
    until(s, () => Object.values(s.batches).some(b => b.product === MET && b.for?.kind === 'stock' && b.status === 'released'), 90);
    expect(Object.values(s.orders).some(o => o.lines.some(l => l.sku === SKU))).toBe(true);
    expect(rampOf(liveOf(db, s.portfolio!.docs), s, SKU)).toBeGreaterThan(db.scenarios[SC].project!.ramp.from);
  });

  test('сохранение с портфелем — тот же завод', () => {
    const back = fromSave(db, toSave(s));
    expect(JSON.stringify(back)).toBe(JSON.stringify(s));
    apply(db, back, { kind: 'advance', seconds: DAY });
    apply(db, s, { kind: 'advance', seconds: DAY });
    expect(toSave(back)).toBe(toSave(s));
  });
});

describe('протокол: продать серии валидации', () => {
  test('серии валидации ждут отчёта и досье, потом — в позицию продукта', () => {
    const s = plant(true);
    apply(db, s, { kind: 'project', op: 'start', product: MET });
    expect(why(apply(db, s, { kind: 'project', op: 'protocol', id: 'P1', sell: true }))).toEqual([]);
    until(s, () => s.portfolio!.projects.P1.stage === 'dossier', 200);
    const p = s.portfolio!.projects.P1;
    for (const id of p.batches) {
      expect(s.lots[s.batches[id].bulk!].status).toBe('released');
      expect(s.batches[id].sku).toBeUndefined();
    }
    until(s, () => s.portfolio!.projects.P1.stage === 'done', 200);
    for (const id of p.batches) expect(s.batches[id].sku).toBe(SKU);
  }, 120_000);
});
