// Б1к: вид «Андон» (src/sim/andon.ts) — что не работает сейчас. На заводе, где отказал узел, вышел срок калибровки
// прибора или квалификации оборудования, у актива подрядчик, уборку ждёт серия без уборщиков в смене, задача ждёт «нет
// допуска», «нет часов» и «в отпуске», фура ждёт разгрузки 2 часа, серия — материала, заказ под угрозой, — по значку над
// каждой вещью с её словом и весом; причину сняли — значка нет; у вещи с двумя проблемами — один значок тяжёлого веса; у
// двух заводов, которые различаются только истинными полями, вид один.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { TRUCK_WAIT } from '../../src/engine/alerts';
import { unfit } from '../../src/engine/assets';
import { DAY, daysFromCivil, HOUR } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { orderRisks } from '../../src/engine/market';
import { planOf } from '../../src/engine/plant';
import { shiftEnd } from '../../src/engine/staff';
import type { PlantState, Task, Truck } from '../../src/engine/types';
import { ANDON, type AndonItem, type AndonKind, andonView, WEIGHT } from '../../src/sim/andon';
import type { Thing } from '../../src/sim/views';

const SC = 'scn.proto';
const plan = planOf(db, db.scenarios[SC].plant);
const room = (id: string): Thing => ({ kind: 'room', i: plan.plant.rooms.findIndex(r => r.id === id) });

/** Завод после 40 суток и ещё 10 часов. */
const s: PlantState = newPlant(db, { scenario: SC });
apply(db, s, { kind: 'advance', seconds: 40 * DAY + 10 * HOUR });
const base = andonView(db, s);

/** Значок над вещью или ничего. */
const at = (items: AndonItem[], thing: Thing) => items.find(x => JSON.stringify(x.thing) === JSON.stringify(thing));
/** Виды проблем над вещью — по тяжести. */
const kinds = (items: AndonItem[], thing: Thing) => at(items, thing)?.why.map(w => w.kind) ?? [];
/** Задача, которая ждёт, — из нужных андону полей; остальное раздатчику здесь не нужно. */
const waiting = (c: PlantState, id: string, x: Partial<Task>): Task => {
  const t = { id, roles: [], from: { kind: 'point', x: 0, z: 0 }, work: 0, state: 'open', since: c.t - 600, ...x } as unknown as Task;
  c.tasks[id] = t;
  return t;
};
const eqPart = Object.values(s.parts).find(p => !p.line)!;
const linePart = Object.values(s.parts).find(p => p.line)!;
const eqThing: Thing = { kind: 'equipment', i: plan.plant.equipment.findIndex(e => e.id === eqPart.machine) };
const lineThing: Thing = {
  kind: 'machine',
  line: plan.plant.lines.findIndex(l => l.id === linePart.line),
  k: plan.plant.lines.find(l => l.id === linePart.line)!.machines.findIndex(m => m.id === linePart.machine),
};

describe('виды и вес', () => {
  test('«стоп» — у того, на что в прототипе есть автопауза; остальное — «внимание»; порядок — сначала «стоп»', () => {
    const stop: AndonKind[] = ['fail', 'qual', 'cal', 'truck', 'material', 'order'];
    for (const k of ANDON) expect(WEIGHT[k]).toBe(stop.includes(k) ? 'stop' : 'attention');
    const first = ANDON.findIndex(k => WEIGHT[k] === 'attention');
    expect(ANDON.slice(first).every(k => WEIGHT[k] === 'attention')).toBe(true);
  });

  test('на заводе без построенных проблем узлы, активы, фуры и задачи без значков', () => {
    for (const k of ['fail', 'qual', 'cal', 'truck', 'admission', 'hours', 'leave', 'clean'] as AndonKind[]) expect(base.items.some(x => x.why.some(w => w.kind === k))).toBe(false);
  });
});

describe('по значку над каждой вещью', () => {
  test('узел отказал — «авария» над оборудованием и машиной линии, с мгновения отказа; ремонт кончился — значка нет', () => {
    const c: PlantState = structuredClone(s);
    for (const id of [eqPart.id, linePart.id]) Object.assign(c.parts[id], { state: 'failed', failed: c.t - HOUR });
    const v = andonView(db, c);
    for (const thing of [eqThing, lineThing]) {
      const x = at(v.items, thing)!;
      expect(x).toMatchObject({ kind: 'fail', weight: 'stop' });
      expect(x.why[0]).toMatchObject({ kind: 'fail', since: c.t - HOUR });
    }
    expect(at(v.items, eqThing)!.why[0].part).toBe(eqPart.type);
    for (const id of [eqPart.id, linePart.id]) c.parts[id].state = 'ok';
    expect(andonView(db, c)).toEqual(base);
  });

  test('срок калибровки прибора вышел — «нет калибровки» над его помещением; квалификации оборудования — над ним', () => {
    const c: PlantState = structuredClone(s);
    const inst = Object.values(c.assets).find(a => a.family === 'lab' && a.recs.some(r => r.work === 'cal') && !unfit(db, c, a.id))!;
    const eq = Object.values(c.assets).find(a => a.id === eqPart.machine)!;
    expect(eq.recs.some(r => r.work === 'qual')).toBe(true);
    const day = daysFromCivil(c.start) + Math.floor(c.t / DAY);
    for (const [a, work] of [[inst, 'cal'], [eq, 'qual']] as const) for (const r of a.recs) if (r.work === work) r.until = day - 1;
    expect(unfit(db, c, inst.id)).toBe('cal');
    expect(unfit(db, c, eq.id)).toBe('qual');
    const v = andonView(db, c);
    const x = v.items.find(i => i.why.some(w => w.kind === 'cal'))!;
    expect(x.thing.kind).toBe('room');
    expect(x.weight).toBe('stop');
    expect(x.why.find(w => w.kind === 'cal')!.asset!.id).toBe(inst.id);
    expect(at(v.items, eqThing)).toMatchObject({ kind: 'qual', weight: 'stop' });
  });

  test('у актива подрядчик — «подрядчик», внимание; визит кончился — значка нет', () => {
    const c: PlantState = structuredClone(s);
    c.assets[eqPart.machine].visit = { work: 'qual', at: c.t - HOUR, booked: c.t - DAY, v: 1 };
    expect(at(andonView(db, c).items, eqThing)).toMatchObject({ kind: 'visit', weight: 'attention' });
    delete c.assets[eqPart.machine].visit;
    expect(andonView(db, c)).toEqual(base);
  });

  test('задача ждёт «нет допуска», «нет часов», «в отпуске» — над вещью задачи: помещение стадии, машина, лаборатория', () => {
    const c: PlantState = structuredClone(s);
    const b = Object.values(c.batches).find(x => x.status === 'process')!;
    const stageRoom = plan.roomOf[db.recipes[b.recipe].stages[b.stage].room];
    waiting(c, 'K9001', { kind: 'stage', batch: b.id, why: 'qual', lack: 'SOP-0001' });
    waiting(c, 'K9002', { kind: 'repair', part: linePart.id, why: 'hours' });
    waiting(c, 'K9003', { kind: 'review', why: 'leave' });
    const v = andonView(db, c);
    expect(at(v.items, room(stageRoom))!.why).toContainEqual(expect.objectContaining({ kind: 'admission', task: 'stage', lack: 'SOP-0001' }));
    expect(at(v.items, room(stageRoom))!.weight).toBe('attention');
    expect(kinds(v.items, lineThing)).toEqual(['hours']);
    expect(kinds(v.items, room('lab'))).toContain('leave');
    // обучение ждёт свободного часа по плану — это не простой
    const d: PlantState = structuredClone(s);
    waiting(d, 'K9004', { kind: 'train', why: 'hours' });
    expect(andonView(db, d)).toEqual(base);
    // задача ждёт людей или смены — это не андон
    for (const why of ['people', 'shift'] as const) {
      const e: PlantState = structuredClone(s);
      waiting(e, 'K9005', { kind: 'repair', part: linePart.id, why });
      expect(andonView(db, e)).toEqual(base);
    }
  });

  test('уборку ждёт серия, аппаратчики стадии в смене, а уборщиков нет — «нет уборщика» над помещением', () => {
    const c: PlantState = structuredClone(s);
    const b = Object.values(c.batches).find(x => x.status === 'process')!;
    const st = db.recipes[b.recipe].stages[b.stage];
    const id = plan.roomOf[st.room];
    b.phase = 'cleaning';
    const t = waiting(c, 'K9010', { kind: 'clean', room: id, why: 'shift' });
    const onShift = Object.values(c.people).some(p => p.role === st.staff.role && shiftEnd(db, c, p) !== undefined);
    expect(onShift).toBe(true);
    expect(at(andonView(db, c).items, room(id))).toMatchObject({ kind: 'clean', weight: 'attention' });
    // уборщик в смене и не идёт к ней по другой причине — значка нет; не ждёт серия — нет
    t.why = 'people';
    expect(at(andonView(db, c).items, room(id))).toBeUndefined();
    t.why = 'shift';
    b.phase = 'people';
    expect(at(andonView(db, c).items, room(id))).toBeUndefined();
  });

  test('фура поставщика ждёт разгрузки 2 часа — «ждёт разгрузки» над фурой; меньше, без паллет, у покупателя — нет', () => {
    const po = Object.keys(s.pos)[0];
    const truck = (arrived: number, units: string[], buyer = false) =>
      ({ id: 'T99', dock: 'dock-in', ...(buyer ? { customer: 'cus.national' } : { po }), units, arrived, docked: true, open: true }) as unknown as Truck;
    const run = (tr: Truck) => {
      const c: PlantState = structuredClone(s);
      c.trucks[tr.id] = tr;
      return andonView(db, c);
    };
    const v = run(truck(s.t - TRUCK_WAIT, ['U1']));
    expect(at(v.items, { kind: 'truck', n: 99, customer: false })).toMatchObject({ kind: 'truck', weight: 'stop', why: [{ kind: 'truck', since: s.t - TRUCK_WAIT, po, supplier: s.pos[po].supplier }] });
    expect(run(truck(s.t - TRUCK_WAIT + 1, ['U1']))).toEqual(base);
    expect(run(truck(s.t - TRUCK_WAIT - HOUR, []))).toEqual(base);
    expect(run(truck(s.t - TRUCK_WAIT - HOUR, ['U1'], true))).toEqual(base);
  });

  test('материал не пришёл к «не раньше» — «нет материала» над помещением первой стадии; к упаковке — над линией', () => {
    const c: PlantState = structuredClone(s);
    const b = Object.values(c.batches).find(x => x.status === 'waiting' || x.status === 'reserved')!;
    Object.assign(b, { status: 'waiting', notBefore: c.t - HOUR, short: [{ material: 'mat.api.paracetamol', qty: 1 }] });
    const first = plan.roomOf[db.recipes[b.recipe].stages[0].room];
    const v = andonView(db, c);
    expect(at(v.items, room(first))).toMatchObject({ kind: 'material', weight: 'stop' });
    expect(at(v.items, room(first))!.why[0]).toMatchObject({ since: c.t - HOUR, short: ['mat.api.paracetamol'] });
    // «не раньше» ещё не наступило — значка нет
    b.notBefore = c.t + HOUR;
    expect(at(andonView(db, c).items, room(first))).toBeUndefined();
    const p = Object.values(c.batches).find(x => x.pack)!;
    Object.assign(p.pack!, { state: 'waiting', created: c.t - HOUR, short: [{ material: 'mat.pk.leaflet', qty: 10 }] });
    const lineRoom = plan.plant.lines.find(l => l.id === p.pack!.line)!.room;
    expect(at(andonView(db, c).items, room(lineRoom))).toMatchObject({ kind: 'material', weight: 'stop' });
  });

  test('заказ под угрозой — «заказ под угрозой» над складом, по правилу планёрки; ГП хватает — значка нет', () => {
    const c: PlantState = structuredClone(s);
    const open = Object.values(c.orders).filter(o => o.status === 'open');
    expect(open.length).toBeGreaterThan(0);
    for (const o of open) for (const l of o.lines) l.reserved = l.cases;
    expect(orderRisks(db, c)).toEqual([]);
    expect(kinds(andonView(db, c).items, room('warehouse'))).not.toContain('order');
    open[0].lines[0].reserved = 0;
    open[0].lines[0].cases += 1_000_000;
    const risks = orderRisks(db, c);
    const v = andonView(db, c);
    const x = at(v.items, room('warehouse'))!;
    expect(x).toMatchObject({ kind: 'order', weight: 'stop' });
    expect(x.why.map(w => w.order)).toEqual(risks.map(r => r.order));
    expect(x.why[0]).toMatchObject({ order: open[0].id, customer: open[0].customer, due: open[0].due });
  });
});

describe('несколько проблем', () => {
  test('у вещи две проблемы — один значок самого тяжёлого веса со словом первой; обе — в подсказке, по тяжести', () => {
    const c: PlantState = structuredClone(s);
    c.assets[eqPart.machine].visit = { work: 'qual', at: c.t - HOUR, booked: c.t - DAY, v: 1 };
    Object.assign(c.parts[eqPart.id], { state: 'failed', failed: c.t - 600 });
    const v = andonView(db, c);
    const x = at(v.items, eqThing)!;
    expect(x).toMatchObject({ kind: 'fail', weight: 'stop' });
    expect(x.why.map(w => w.kind)).toEqual(['fail', 'visit']);
    expect(v.items.filter(i => JSON.stringify(i.thing) === JSON.stringify(eqThing))).toHaveLength(1);
  });
});

describe('без истины', () => {
  test('два завода с разными истинными свойствами партий и серий и запасом узлов — один и тот же вид', () => {
    const c: PlantState = structuredClone(s);
    Object.assign(c.parts[linePart.id], { state: 'failed', failed: c.t - HOUR });
    c.assets[eqPart.machine].visit = { work: 'qual', at: c.t - HOUR, booked: c.t - DAY, v: 1 };
    const b: PlantState = structuredClone(c);
    for (const lot of Object.values(b.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
    for (const bt of Object.values(b.batches)) for (const k of Object.keys(bt.truth) as (keyof typeof bt.truth)[]) bt.truth[k] = (bt.truth[k] ?? 0) + 777;
    for (const p of Object.values(b.parts)) p.budget += 12345;
    const v = andonView(db, c);
    expect(v.items.length).toBeGreaterThanOrEqual(2);
    expect(andonView(db, b)).toEqual(v);
    // в виде нет ни ресурса узла, ни его наработки, ни истинных свойств
    const json = JSON.stringify(v);
    for (const k of ['budget', '"done"', 'truth']) expect(json.includes(k)).toBe(false);
  });
});
