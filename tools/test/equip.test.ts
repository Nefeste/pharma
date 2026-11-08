// Часть Б7в: оборудование (docs/specs/2026-10-vertical-slice.md, «Б7в», «Проверки Б7в»; геймдизайн, §5.2, §7.2). Запись
// базы: у класса — цена и дни монтажа и квалификации, у поставщика — множители и сроки, у типа помещения — классы, у вещи
// плана — поставщик. Команда `equip`: покупка — новый объект плана, единица с местом ISA-95 и инвентарным номером без
// записей, касса — минус предоплата; путь — поставка, монтаж закрывает помещение, IQ, OQ, PQ, приёмка, записи; без
// записи — не работает и не держит годную; замена, перенос, снос и отмена заказа; отмена стройки — до полуночи дня заказа;
// отказы узлов по поставщику; помещение без вещей — «не работает: нет …»; снос помещения с вещами; сохранение.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { stageUnfit, unfit } from '../../src/engine/assets';
import { part } from '../../src/engine/cash';
import { schedule } from '../../src/engine/core/agenda';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, newPlant } from '../../src/engine/engine';
import { type EquipOp, stepsOf } from '../../src/engine/equip';
import { check } from '../../src/engine/invariants';
import { runSeed } from '../../src/engine/plan/run';
import { planOf } from '../../src/engine/plant';
import { fromSave, toSave } from '../../src/engine/save';
import { levelOf, siteErrors } from '../../src/engine/site/checks';
import { downOf } from '../../src/engine/site/down';
import { type BuildOp, editPlan, half } from '../../src/engine/site/edit';
import { footError, unitOf, unitPrice, unitsOf } from '../../src/engine/site/units';
import { seedTraining } from '../../src/engine/train';
import { momentOf } from '../../src/engine/core/calendar';
import { type Notice, type PlantState, planRev } from '../../src/engine/types';

const SC = 'scn.proto';
const B = db.scenarios[SC].build!;
const VAT = db.profiles[db.scenarios[SC].profile].vat.general;
const gross = (net: number) => net + part(net, VAT);

type EqN = Extract<Notice, { kind: 'equip' }>;
const equip = (s: PlantState, op: EquipOp) => apply(db, s, { kind: 'equip', op });
const eq = (ns: Notice[]) => ns.filter((n): n is EqN => n.kind === 'equip');
const site = (s: PlantState, op: BuildOp | { op: 'undo' } | { op: 'done' }) => apply(db, s, { kind: 'site', op });
const advance = (s: PlantState, seconds: number) => apply(db, s, { kind: 'advance', seconds });

/** Первое место в помещении, куда встаёт след класса: середина клетки, поворот 0. */
function spot(s: PlantState, type: string, room: string): [number, number] {
  const r = s.plan.rooms.find(x => x.id === room)!;
  for (let z = r.rect[1] + 100; z < r.rect[1] + r.rect[3] - 100; z += 100) {
    for (let x = r.rect[0] + 100; x < r.rect[0] + r.rect[2] - 100; x += 100) {
      const at: [number, number] = [x + 50, z + 50];
      if (!footError(db, s.plan, type, room, at, 0) && editPlan(db, B, s.plan, { op: 'unit', type, room, at, turn: 0, vendor: 'ven.asia' }, {}).ok) return at;
    }
  }
  throw new Error(`no spot for ${type} in ${room}`);
}

/** Поставка — сейчас: настоящий день уже в пути, тест его подвигает (событие с новой версией). */
function deliverNow(s: PlantState, id: string) {
  const p = s.assets[id].path!;
  p.v++;
  p.arrive = s.t + 1;
  schedule(s.agenda, s.t + 1, { kind: 'unitArrive', asset: id, v: p.v });
}

/** Идти по часу, пока условие не сбудется; не дольше `days` суток. */
function until(s: PlantState, cond: () => boolean, days = 60): Notice[] {
  const out: Notice[] = [];
  const end = s.t + days * DAY;
  while (!cond() && s.t < end) out.push(...advance(s, HOUR));
  expect(cond()).toBe(true);
  return out;
}

describe('запись базы', () => {
  test('у каждого класса — цена и дни; у поставщика — множители и сроки; у вещи плана — поставщик и класс её помещения', () => {
    for (const c of [...Object.values(db.equipment), ...Object.values(db.machines), ...Object.values(db.instruments)]) {
      expect(c.price).toBeGreaterThan(0);
      expect(c.install.days).toBeGreaterThanOrEqual(0);
      expect(!!c.qual).toBe(c.install.iq !== undefined && c.install.oq !== undefined && c.install.pq !== undefined);
    }
    expect(Object.keys(db.vendors).sort()).toEqual(['ven.asia', 'ven.eu', 'ven.ru']);
    for (const v of Object.values(db.vendors)) {
      expect(v.lead[0]).toBeLessThanOrEqual(v.lead[1]);
      expect(v.late.share).toBeGreaterThanOrEqual(0);
      expect(v.late.share).toBeLessThanOrEqual(10_000);
    }
    const plant = db.plants['plant.proto'];
    for (const u of unitsOf(plant)) {
      expect(u.vendor).toBe('ven.ru');
      const t = db.rooms[plant.rooms.find(r => r.id === u.room)!.type];
      expect(t.things).toContain(u.type);
    }
    expect(db.roles['role.validation'].dept).toBe('qa');
    expect(db.scenarios[SC].labor!.roles['role.validation']).toBeDefined();
    expect(siteErrors(db, plant)).toEqual([]);
  });
  test('сумма оборудования прототипа по ценам классов — 273,2 млн ₽', () => {
    const sum = unitsOf(db.plants['plant.proto']).reduce((n, u) => n + unitPrice(db, u.type, 'ven.eu'), 0);
    expect(sum).toBe(273_220_000_00);
  });
});

describe('покупка', () => {
  test('новый объект плана, единица с местом и номером без записей, касса — минус предоплата с НДС; «нельзя» — то же', () => {
    const s = newPlant(db, { scenario: SC });
    const cash = s.cash.balance;
    const at = spot(s, 'eq.press', 'compression');
    // нельзя: класс не этого помещения, машина линии, след на стене, денег не хватит
    const no: [EquipOp, string][] = [
      [{ op: 'buy', type: 'eq.press', vendor: 'ven.asia', room: 'lab' }, 'notHere'],
      [{ op: 'buy', type: 'mach.blister', vendor: 'ven.asia', room: 'packaging' }, 'lineUnit'],
      [{ op: 'buy', type: 'eq.press', vendor: 'ven.asia', room: 'compression', at: [s.plan.rooms.find(r => r.id === 'compression')!.rect[0] + 50, at[1]], turn: 0 }, 'footprint'],
      [{ op: 'buy', type: 'eq.press', vendor: 'ven.eu', room: 'compression', at, turn: 0 }, 'money'],
    ];
    s.cash.balance = -15_000_000_00;
    for (const [op, code] of no) {
      const was = s.plan;
      const n = eq(equip(s, op));
      expect(n).toHaveLength(1);
      expect(n[0].ok ? '' : n[0].error.code).toBe(code);
      expect(s.plan).toBe(was);
    }
    s.cash.balance = cash;
    const was = s.plan;
    const n = eq(equip(s, { op: 'buy', type: 'eq.press', vendor: 'ven.asia', room: 'compression', at, turn: 0 }));
    const price = unitPrice(db, 'eq.press', 'ven.asia');
    expect(price).toBe(30_000_000_00);
    const pre = part(price, db.vendors['ven.asia'].prepay);
    expect(n).toEqual([{ kind: 'equip', op: 'buy', ok: true, cost: gross(pre), thing: 'press-2' }]);
    expect(planRev(s.plan)).toBe(planRev(was) + 1);
    const id = (n[0] as EqN & { ok: true }).thing;
    const u = unitOf(s.plan, id)!;
    expect(u).toMatchObject({ type: 'eq.press', room: 'compression', at, vendor: 'ven.asia', place: 'TB-01.13' });
    const a = s.assets[id];
    expect(a.recs).toEqual([]);
    expect(a.vendor).toBe('ven.asia');
    expect(a.path?.step).toBe('ordered');
    expect(Math.max(...Object.values(s.assets).filter(x => x.id !== id).map(x => x.inv)) + 1).toBe(a.inv);
    expect(s.cash.balance).toBe(cash - gross(pre));
    expect(s.cash.ledger.at(-1)?.item).toBe('equip');
    expect(unfit(db, s, id)).toBe('path');
    // журнал — «вы» с местом директора
    expect(s.journal.at(-1)?.d).toMatchObject({ kind: 'equip', op: 'buy', unit: id, vendor: 'ven.asia' });
    expect(check(db, s)).toEqual([]);
  });

  test('новая единица без записи не держит годную: стадия идёт на прежнем прессе', () => {
    const s = newPlant(db, { scenario: SC });
    equip(s, { op: 'buy', type: 'eq.press', vendor: 'ven.asia', room: 'compression', at: spot(s, 'eq.press', 'compression'), turn: 0 });
    const st = db.recipes[Object.keys(db.recipes)[0]].stages.find(x => x.room === 'compression')!;
    expect(stageUnfit(db, s, st, 'compression')).toBeUndefined();
    const a = newPlant(db, { scenario: SC });
    // через 20 суток таблетирование шло столько же раз, сколько без покупки
    const n = (x: PlantState) => Object.values(x.batches).filter(b => b.records.some(r => r.room === 'compression')).length;
    for (const x of [s, a]) advance(x, 20 * DAY);
    expect(n(s)).toBe(n(a));
    expect(n(s)).toBeGreaterThan(0);
  });
});

describe('путь единицы', () => {
  test('поставка — остаток в счета; монтаж закрывает помещение; IQ, OQ, PQ подрядчиком; приёмка — записи, счёт инженеров', () => {
    const s = newPlant(db, { scenario: SC });
    const n = eq(equip(s, { op: 'buy', type: 'eq.deduster', vendor: 'ven.ru', room: 'compression', at: spot(s, 'eq.deduster', 'compression'), turn: 0 }));
    const id = (n[0] as EqN & { ok: true }).thing;
    const due = s.assets[id].path!.due!;
    expect(due).toBeGreaterThan(Math.floor(s.t / DAY));
    deliverNow(s, id);
    const arrived = advance(s, 60);
    expect(arrived.some(x => x.kind === 'unitArrived' && x.asset === id)).toBe(true);
    expect(s.assets[id].path?.step).toBe('install');
    // монтаж — с ближайших часов подрядчика: помещение не работает
    until(s, () => !!s.assets[id].path?.until);
    expect(downOf(db, s).rooms.get('compression')).toEqual({ code: 'mount', unit: id });
    const steps = stepsOf(db, 'eq.deduster', false);
    expect(steps.map(x => x.step)).toEqual(['install', 'iq', 'oq', 'pq']);
    until(s, () => s.assets[id].path?.step === 'iq');
    expect(downOf(db, s).rooms.has('compression')).toBe(false);
    const cash = s.cash.balance;
    const ready = until(s, () => !s.assets[id].path, 40);
    expect(ready.some(x => x.kind === 'unitReady' && x.asset === id)).toBe(true);
    const a = s.assets[id];
    expect(a.recs.map(r => r.work)).toEqual(['qual']);
    expect(unfit(db, s, id)).toBeUndefined();
    // счёт: дни инженера поставщика (монтаж и квалификация) и дни инженера по валидации подрядчика
    const days = steps.reduce((x, st) => x + st.days, 0);
    const iqpq = days - steps[0].days;
    const bill = days * db.vendors['ven.ru'].engineer + iqpq * B.validator;
    expect(s.cash.ledger.some(e => e.item === 'equip' && e.ref === id && e.sum === -gross(bill))).toBe(true);
    expect(cash - s.cash.balance).toBeGreaterThanOrEqual(gross(bill));
    expect(check(db, s)).toEqual([]);
  });

  test('свой инженер по валидации: дни IQ, OQ и PQ — его задачи, счёта подрядчика нет; повторную квалификацию ведёт он', () => {
    const s = newPlant(db, { scenario: SC });
    // инженер в дневной смене, как специалист ООК, с допусками на начало партии (руками теста — вместо найма)
    const qa = Object.values(s.people).find(p => p.role === 'role.qa')!;
    const p = { ...structuredClone(qa), id: 'E99', role: 'role.validation', tab: 9999, train: {} };
    delete (p as { also?: string[] }).also;
    s.people[p.id] = p;
    seedTraining(db, db.scenarios[SC], p, momentOf(s.start, s.t).day);
    const id = (eq(equip(s, { op: 'buy', type: 'eq.deduster', vendor: 'ven.ru', room: 'compression', at: spot(s, 'eq.deduster', 'compression'), turn: 0 }))[0] as EqN & { ok: true }).thing;
    deliverNow(s, id);
    until(s, () => s.assets[id].path?.step === 'iq', 20);
    until(s, () => Object.values(s.tasks).some(t => t.kind === 'qualify' && t.asset === id && t.people.includes('E99')), 5);
    until(s, () => !s.assets[id].path, 40);
    const steps = stepsOf(db, 'eq.deduster', false);
    const days = steps.reduce((x, st) => x + st.days, 0);
    // счёт — только дни инженера поставщика: инженера по валидации подрядчика нет
    expect(s.cash.ledger.some(e => e.item === 'equip' && e.ref === id && e.sum === -gross(days * db.vendors['ven.ru'].engineer))).toBe(true);
    // повторная квалификация пресса — его задачей: запись кончается, визит — без счёта подрядчика
    const a = s.assets['press-1'];
    const rec = a.recs.find(r => r.work === 'qual')!;
    rec.until = momentOf(s.start, s.t).day + 3;
    const before = s.cash.ledger.filter(e => e.item === 'calqual').length;
    until(s, () => Object.values(s.tasks).some(t => t.kind === 'qualify' && t.asset === 'press-1'), 5);
    until(s, () => (a.recs.filter(r => r.work === 'qual').at(-1)?.until ?? 0) > rec.until, 10);
    expect(s.cash.ledger.filter(e => e.item === 'calqual' && e.ref === 'press-1').length).toBe(0);
    expect(s.cash.ledger.filter(e => e.item === 'calqual').length).toBeGreaterThanOrEqual(before);
    expect(check(db, s)).toEqual([]);
  });

  test('класс без квалификации: после монтажа пути нет, калибровку ставит коллега техслужбы', () => {
    const s = newPlant(db, { scenario: SC });
    const n = eq(equip(s, { op: 'buy', type: 'inst.ir', vendor: 'ven.ru', room: 'lab' }));
    const id = (n[0] as EqN & { ok: true }).thing;
    expect(unitOf(s.plan, id)?.family).toBe('lab');
    deliverNow(s, id);
    until(s, () => !s.assets[id].path, 10);
    expect(unfit(db, s, id)).toBe('cal');
    until(s, () => !!s.assets[id].visit, 5);
  });
});

describe('замена, перенос, снос, отмена', () => {
  test('замена: прежняя работает до поставки, снимается, когда освободится, половина её цены — назад; узлы — по поставщику', () => {
    const s = newPlant(db, { scenario: SC });
    const n = eq(equip(s, { op: 'replace', unit: 'press-1', vendor: 'ven.asia' }));
    expect(n[0].ok).toBe(true);
    const id = (n[0] as EqN & { ok: true }).thing;
    expect(unitOf(s.plan, id)).toBeUndefined();
    expect(unitOf(s.plan, 'press-1')).toBeDefined();
    // дважды не заменяют
    expect(eq(equip(s, { op: 'replace', unit: 'press-1', vendor: 'ven.eu' }))[0]).toMatchObject({ ok: false, error: { code: 'unitState' } });
    deliverNow(s, id);
    const ns = until(s, () => !!unitOf(s.plan, id), 10);
    expect(unitOf(s.plan, 'press-1')).toBeUndefined();
    const u = unitOf(s.plan, id)!;
    const old = db.plants['plant.proto'].equipment.find(e => e.id === 'press-1')!;
    expect(u.at).toEqual(old.at);
    expect(u.place).toBe(old.place);
    expect(s.assets['press-1']).toBeUndefined();
    expect(s.parts[`${id}/punches`]).toBeDefined();
    expect(s.parts['press-1/punches']).toBeUndefined();
    const refund = half(unitPrice(db, 'eq.press', 'ven.ru'));
    expect(ns.some(x => x.kind === 'siteGone' && x.id === 'press-1' && x.refund === gross(refund))).toBe(true);
    expect(s.assets[id].path?.step).toBe('install');
    expect(check(db, s)).toEqual([]);
  });

  test('отказы узлов купленной единицы — по доле таблицы её поставщика', () => {
    const a = newPlant(db, { scenario: SC });
    const b = newPlant(db, { scenario: SC });
    for (const [s, v] of [
      [a, 'ven.eu'],
      [b, 'ven.asia'],
    ] as const) {
      const id = (eq(equip(s, { op: 'replace', unit: 'press-1', vendor: v }))[0] as EqN & { ok: true }).thing;
      deliverNow(s, id);
      until(s, () => !!s.parts[`${id}/punches`], 10);
    }
    const ea = Object.values(a.parts).find(p => p.of === 'eq.press')!;
    const eb = Object.values(b.parts).find(p => p.of === 'eq.press')!;
    // ветвь узла — по имени: у одинаковых имён запас один, азиатский — вдвое меньше
    expect(ea.id).toBe(eb.id);
    expect(eb.budget).toBe(Math.floor((ea.budget * 100) / db.vendors['ven.asia'].hazard));
  });

  test('снос прибора: план без него, половина цены — назад, помещение не работает — нет прибора', () => {
    const s = newPlant(db, { scenario: SC });
    const cash = s.cash.balance;
    const n = equip(s, { op: 'remove', unit: 'hard-1' });
    expect(eq(n)[0]).toMatchObject({ ok: true, later: true });
    until(s, () => !unitOf(s.plan, 'hard-1'), 5);
    expect(s.cash.ledger.some(e => e.ref === 'hard-1' && e.sum === gross(half(unitPrice(db, 'inst.hardness', 'ven.ru'))))).toBe(true);
    expect(siteErrors(db, s.plan).filter(e => levelOf(e) === 'red')).toEqual([{ code: 'need', room: 'compression', type: 'inst.hardness' }]);
    expect(downOf(db, s).rooms.get('compression')?.code).toBe('red');
    expect(s.cash.balance).toBeGreaterThan(cash - 1);
  });

  test('отмена заказа — единица уходит из плана, предоплата остаётся; отмена стройки — до полуночи, потом «заказ подтверждён»', () => {
    const s = newPlant(db, { scenario: SC });
    const at = spot(s, 'eq.press', 'compression');
    const cash = s.cash.balance;
    const id = (eq(equip(s, { op: 'buy', type: 'eq.press', vendor: 'ven.asia', room: 'compression', at, turn: 0 }))[0] as EqN & { ok: true }).thing;
    const paid = cash - s.cash.balance;
    const rev = planRev(s.plan);
    // отмена стройки в тот же день — план и деньги назад
    expect(site(s, { op: 'undo' }).some(x => x.kind === 'site' && x.ok)).toBe(true);
    expect(unitOf(s.plan, id)).toBeUndefined();
    expect(s.assets[id]).toBeUndefined();
    expect(s.cash.balance).toBe(cash);
    expect(planRev(s.plan)).toBe(rev + 1);
    // снова — и на следующий день: отмена стройки отказывает, «Отменить заказ» — да, предоплата — у поставщика
    const id2 = (eq(equip(s, { op: 'buy', type: 'eq.press', vendor: 'ven.asia', room: 'compression', at, turn: 0 }))[0] as EqN & { ok: true }).thing;
    advance(s, DAY);
    expect(site(s, { op: 'undo' }).find(x => x.kind === 'site')).toMatchObject({ ok: false, error: { code: 'confirmed', thing: id2 } });
    const before = s.cash.balance;
    expect(eq(equip(s, { op: 'cancel', unit: id2 }))[0]).toMatchObject({ ok: true });
    expect(unitOf(s.plan, id2)).toBeUndefined();
    expect(s.assets[id2]).toBeUndefined();
    expect(s.cash.balance).toBe(before);
    expect(paid).toBe(gross(part(unitPrice(db, 'eq.press', 'ven.asia'), db.vendors['ven.asia'].prepay)));
    expect(check(db, s)).toEqual([]);
  });

  test('перенос: когда освободится — на новом месте, монтаж слесарями, IQ и OQ, приёмка', () => {
    const s = newPlant(db, { scenario: SC });
    const at = spot(s, 'eq.deduster', 'compression');
    expect(eq(equip(s, { op: 'move', unit: 'deduster-1', room: 'compression', at, turn: 0 }))[0]).toMatchObject({ ok: true, later: true });
    until(s, () => unitOf(s.plan, 'deduster-1')?.at?.[0] === at[0] && unitOf(s.plan, 'deduster-1')?.at?.[1] === at[1], 5);
    expect(s.assets['deduster-1'].path).toMatchObject({ step: 'install', move: { room: 'compression' } });
    expect(stepsOf(db, 'eq.deduster', true).map(x => x.step)).toEqual(['install', 'iq', 'oq']);
    until(s, () => Object.values(s.tasks).some(t => t.kind === 'mount' && t.asset === 'deduster-1'), 5);
    until(s, () => !s.assets['deduster-1'].path, 30);
    expect(unfit(db, s, 'deduster-1')).toBeUndefined();
    expect(check(db, s)).toEqual([]);
  });
});

describe('помещения с вещами', () => {
  test('второй зал склада: без датчика не работает; датчик — работает; снос зала — с датчиком, половина цены — назад', () => {
    const s = newPlant(db, { scenario: SC });
    // пристройка к югу от склада и зал склада в ней с дверью из старого зала
    const hull = site(s, { op: 'hull', rect: [0, 39, 20, 14] });
    expect(hull.some(x => x.kind === 'site' && x.ok)).toBe(true);
    const room = site(s, { op: 'room', type: 'warehouse', grade: 'cnc', rect: [1, 39, 14, 12], vehicles: true });
    expect(room.find(x => x.kind === 'site')).toMatchObject({ ok: true, thing: 'warehouse-1' });
    site(s, { op: 'door', cell: [5, 39], len: 2, along: 'x', kind: 'gate' });
    site(s, { op: 'done' });
    const P = planOf(db, s.plan);
    expect(siteErrors(db, s.plan)).toContainEqual({ code: 'need', room: 'warehouse-1', type: 'inst.thermohygrometer' });
    expect(downOf(db, s).rooms.get('warehouse-1')?.code).toBe('red');
    expect(P.plant.areas.find(a => a.code === 'WH')!.centers.at(-1)).toMatchObject({ kind: 'storage', rooms: ['warehouse-1'], regime: 'reg.ccrt' });
    const id = (eq(equip(s, { op: 'buy', type: 'inst.thermohygrometer', vendor: 'ven.ru', room: 'warehouse-1' }))[0] as EqN & { ok: true }).thing;
    expect(unitOf(s.plan, id)?.family).toBe('sensor');
    expect(siteErrors(db, s.plan).filter(e => e.code === 'need')).toEqual([]);
    const cash = s.cash.balance;
    const n = site(s, { op: 'demolish', what: 'room', id: 'warehouse-1' });
    expect(n.find(x => x.kind === 'site')).toMatchObject({ ok: true });
    expect(unitOf(s.plan, id)).toBeUndefined();
    expect(s.assets[id]).toBeUndefined();
    expect(s.cash.balance - cash).toBeGreaterThan(gross(half(unitPrice(db, 'inst.thermohygrometer', 'ven.ru'))));
    expect(check(db, s)).toEqual([]);
  });
});

describe('сохранение и прогон плана', () => {
  test('сохранение и загрузка на пути — та же жизнь; прогон плана путь не меняет у завода', () => {
    const s = newPlant(db, { scenario: SC });
    const id = (eq(equip(s, { op: 'buy', type: 'eq.deduster', vendor: 'ven.ru', room: 'compression', at: spot(s, 'eq.deduster', 'compression'), turn: 0 }))[0] as EqN & { ok: true }).thing;
    deliverNow(s, id);
    advance(s, 2 * DAY);
    const t = fromSave(db, toSave(s));
    advance(s, 10 * DAY);
    advance(t, 10 * DAY);
    expect(fingerprint(t)).toBe(fingerprint(s));
    const p = toSave(s);
    runSeed(db, s, [], { days: 7, seeds: 1, twin: true }, 0);
    expect(toSave(s)).toBe(p);
  });
});
