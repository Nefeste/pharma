// Часть Б7б, шаг 3: команда стройки (docs/specs/2026-10-vertical-slice.md, «Б7б», «Проверки Б7б»; геймдизайн, §3.3,
// §3.4). Правка — новый объект плана с номером правки на один больше, учёт помещений и мест по новому плану, касса —
// минус цена с НДС; «нельзя» — план и касса те же; красное помещение не работает: задачи ждут «помещение не работает»,
// стадия и упаковка не начинаются; жёлтое на работу не влияет; закрыто на перестройку — до «Готово» или другого
// помещения; отмена — план и деньги назад, «занято», имена не повторяются; снос занятого — когда освободится, деньги —
// тогда же, от шага часов не зависит.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { part } from '../../src/engine/cash';
import { HOUR } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { runSeed } from '../../src/engine/plan/run';
import { fromSave, toSave } from '../../src/engine/save';
import { planOf } from '../../src/engine/plant';
import { levelOf, siteErrors } from '../../src/engine/site/checks';
import { downOf } from '../../src/engine/site/down';
import { type BuildError, type BuildOp, half, rackPrice } from '../../src/engine/site/edit';
import { taskRooms } from '../../src/engine/tasks';
import { type Notice, type PlantState, planRev, type SiteRefusal } from '../../src/engine/types';

const SC = 'scn.proto';
const B = db.scenarios[SC].build!;
const VAT = db.profiles[db.scenarios[SC].profile].vat.general;
/** Цена с НДС по общей ставке. */
const gross = (net: number) => net + part(net, VAT);

type Op = Extract<Notice, { kind: 'site' }> | Extract<Notice, { kind: 'siteGone' | 'siteKept' }>;
const site = (s: PlantState, op: BuildOp | { op: 'done' } | { op: 'undo' }, d: ContentDb = db): Op[] =>
  apply(d, s, { kind: 'site', op }).filter((n): n is Op => n.kind === 'site' || n.kind === 'siteGone' || n.kind === 'siteKept');
const advance = (s: PlantState, seconds: number) => apply(db, s, { kind: 'advance', seconds });
/** Серия была или есть в отвесочной: стадия там начиналась. */
const inDispensing = (b: PlantState['batches'][string]) => b.room === 'dispensing' || b.records.some(r => r.room === 'dispensing');

/** Пристройка к востоку у «Общего коридора»: внутренность 10 × 10; коридор в ней и дверь в него из «Общего коридора». */
const HULL: BuildOp = { op: 'hull', rect: [59, 18, 12, 12] };
const CORRIDOR: BuildOp = { op: 'room', type: 'corridor', grade: 'cnc', rect: [59, 20, 12, 5] };
const DOOR: BuildOp = { op: 'door', cell: [59, 22], len: 1, along: 'z', kind: 'door' };
/** Зона карантина и ряд стеллажа на свободном полу склада, у южной стены. */
const ZONE: BuildOp = { op: 'zone', kind: 'quarantine', rect: [8, 34, 4, 3] };
const RACK: BuildOp = { op: 'rack', x: 13, z: 34, bays: 1, levels: 2, face: 'n' };

/** Паллету со стеллажа «A» — на место `slot` (руками теста): место занято, снос ждёт. Вернуть — `back()`. */
function occupy(s: PlantState, slot: string): () => void {
  const u = Object.values(s.units).find(x => x.where.kind === 'slot' && x.where.id.startsWith('A-'))!;
  const from = (u.where as { id: string }).id;
  const move = (a: string, b: string) => {
    delete s.slots[a].unit;
    (s.slots[b] ??= {}).unit = u.id;
    u.where = { kind: 'slot', id: b };
  };
  move(from, slot);
  return () => move(slot, from);
}

describe('правка плана', () => {
  test('корпус, помещение и дверь: новый объект плана с номером на один больше, учёт помещения, касса — минус цена с НДС', () => {
    const s = newPlant(db, { scenario: SC });
    const cash = s.cash.balance;
    const vat = s.cash.vat.in;
    const steps: [BuildOp, number, string][] = [
      [HULL, 10 * 10 * B.hull, 'hull'],
      [CORRIDOR, 12 * 5 * B.room.cnc, 'corridor-1'],
      [DOOR, B.door.cnc, '59,22'],
    ];
    let spent = 0;
    let tax = 0;
    for (const [op, net, thing] of steps) {
      const was = s.plan;
      expect(site(s, op)).toEqual([{ kind: 'site', op: op.op, ok: true, cost: gross(net), thing }]);
      expect(s.plan).not.toBe(was);
      expect(planRev(s.plan)).toBe(planRev(was) + 1);
      spent += gross(net);
      tax += part(net, VAT);
      expect(s.cash.balance).toBe(cash - spent);
      expect(s.cash.ledger.at(-1)).toEqual({ t: s.t, sum: -gross(net), item: 'build', ref: thing });
    }
    expect(s.cash.vat.in - vat).toBe(tax);
    expect(s.build!.spent).toBe(spent);
    // учёт нового помещения — «чисто» с мгновения стройки; сетка — до стен пристройки
    expect(s.rooms['corridor-1']).toEqual({ id: 'corridor-1', type: 'corridor', status: 'clean', since: s.t });
    expect(planOf(db, s.plan).nav.w).toBe(71);
    expect(check(db, s)).toEqual([]);
  });

  test('новое помещение: без двери — красное «не дойти», с дверью — закрыто на перестройку, после «Готово» работает', () => {
    const s = newPlant(db, { scenario: SC });
    site(s, HULL);
    site(s, CORRIDOR);
    expect(downOf(db, s).rooms.get('corridor-1')).toEqual({ code: 'red', error: { code: 'walk', what: { kind: 'room', id: 'corridor-1' } } });
    site(s, DOOR);
    expect(downOf(db, s).rooms.get('corridor-1')).toEqual({ code: 'editing' });
    expect(site(s, { op: 'done' })).toEqual([{ kind: 'site', op: 'done', ok: true, cost: 0, thing: 'corridor-1' }]);
    expect(downOf(db, s).rooms.size).toBe(0);
    // «Готово», когда ничего не перестраивается, — ничего
    expect(site(s, { op: 'done' })).toEqual([]);
  });

  test('зона и ряд стеллажа: места — по новому плану, имена — следующие; зона без цены, ряд — за места', () => {
    const s = newPlant(db, { scenario: SC });
    const cash = s.cash.balance;
    expect(site(s, ZONE)).toEqual([{ kind: 'site', op: 'zone', ok: true, cost: 0, thing: 'zone-1' }]);
    expect(site(s, RACK)).toEqual([{ kind: 'site', op: 'rack', ok: true, cost: gross(rackPrice(B, { bays: 1, levels: 2 })), thing: 'E' }]);
    const slots = planOf(db, s.plan).slots;
    expect(slots.filter(x => x.group === 'zone-1').map(x => [x.id, x.kind])).toEqual([['zone-1-01', 'quarantine']]);
    expect(slots.filter(x => x.group === 'E').length).toBe(6);
    expect(s.cash.balance).toBe(cash - gross(rackPrice(B, { bays: 1, levels: 2 })));
    expect(check(db, s)).toEqual([]);
  });

  test('нельзя: план, касса и шаги отмены те же, причина — у извещения', () => {
    const s = newPlant(db, { scenario: SC });
    site(s, HULL);
    const cases: [BuildOp, (BuildError | SiteRefusal)['code']][] = [
      // вторая лаборатория (Б7в): тип один на план — ошибка планировки «второе такое»
      [{ op: 'room', type: 'lab', grade: 'cnc', rect: [59, 24, 12, 5] }, 'site'],
      [{ op: 'room', type: 'corridor', grade: 'cnc', rect: [27, 21, 5, 5] }, 'overlap'],
      [{ op: 'room', type: 'corridor', grade: 'cnc', rect: [80, 10, 5, 5] }, 'site'],
      [{ op: 'room', type: 'airlock.people', grade: 'cnc', rect: [59, 18, 4, 4] }, 'site'],
      [{ op: 'door', cell: [10, 10], len: 1, along: 'x', kind: 'door' }, 'site'],
      [{ op: 'door', cell: [30, 39], len: 1, along: 'x', kind: 'door' }, 'street'],
      [{ op: 'door', cell: [33, 24], len: 3, along: 'x', kind: 'door' }, 'doorLen'],
      [{ op: 'door', cell: [40, 21], len: 1, along: 'x', kind: 'door', materials: true }, 'materials'],
      [{ op: 'demolish', what: 'door', id: '27,22' }, 'cutsOff'],
      [{ op: 'demolish', what: 'door', id: '0,4' }, 'outerDoor'],
      [{ op: 'demolish', what: 'room', id: 'lab' }, 'hasThings'],
      [{ op: 'demolish', what: 'room', id: 'nope' }, 'noThing'],
      [{ op: 'zone', kind: 'quarantine', rect: [30, 22, 2, 1] }, 'notStorage'],
      [{ op: 'zone', kind: 'palletizing', rect: [8, 34, 1, 1] }, 'zoneKind'],
      [{ op: 'zone', kind: 'cold', rect: [8, 34, 1, 1] }, 'notCold'],
      [{ op: 'zone', kind: 'quarantine', rect: [8, 1, 2, 2] }, 'overlap'],
      [{ op: 'rack', x: 13, z: 34, bays: 1, levels: 7, face: 'n' }, 'rackSize'],
      [{ op: 'vehicles', room: 'warehouse', on: true }, 'same'],
      [{ op: 'vehicles', room: 'office', on: true }, 'site'],
      [{ op: 'hull', rect: [10, 10, 5, 5] }, 'hullOver'],
      [{ op: 'hull', rect: [90, 50, 6, 6] }, 'hullTouch'],
      [{ op: 'hull', rect: [59, 0, 3, 3] }, 'hullSmall'],
    ];
    for (const [op, code] of cases) {
      const plan = s.plan;
      const cash = s.cash.balance;
      const undo = s.build!.undo.length;
      const n = site(s, op);
      expect([op, n.length, n[0]?.kind === 'site' && !n[0].ok ? n[0].error.code : n[0]]).toEqual([op, 1, code]);
      expect(s.plan).toBe(plan);
      expect(s.cash.balance).toBe(cash);
      expect(s.build!.undo.length).toBe(undo);
    }
    // ошибка планировки — со своим кодом: класс, которого типу нельзя; дверь не на стене
    const grade = site(s, { op: 'room', type: 'airlock.people', grade: 'cnc', rect: [59, 18, 4, 4] })[0];
    expect(grade).toMatchObject({ ok: false, error: { code: 'site', error: { code: 'grade' } } });
    // букв рядов — 26: счётчик за «Z» — нельзя, план и касса те же
    const next = s.build!.next;
    s.build!.next = { ...next, rack: 26 };
    const plan = s.plan;
    const cash = s.cash.balance;
    expect(site(s, RACK)).toEqual([{ kind: 'site', op: 'rack', ok: false, error: { code: 'rackNames' } }]);
    expect([s.plan === plan, s.cash.balance]).toEqual([true, cash]);
    s.build!.next = next;
    // денег не хватит: касса не уйдёт ниже предела кредитной линии
    const limit = db.scenarios[SC].credit.limit;
    s.cash.balance = -limit + 1000;
    expect(site(s, CORRIDOR)).toEqual([{ kind: 'site', op: 'room', ok: false, error: { code: 'money', need: gross(12 * 5 * B.room.cnc) - 1000 } }]);
  });

  test('стройка — место директора: без него — отказ; сценарий без стройки — отказ', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    const plan = s.plan;
    expect(apply(db, s, { kind: 'site', op: HULL })).toContainEqual({ kind: 'refused', cmd: 'site', why: 'notYours', detail: 'director' });
    expect(s.plan).toBe(plan);
    apply(db, s, { kind: 'seat', seats: ['director'] });
    expect(site(s, HULL)[0]).toMatchObject({ ok: true });
    const bare = structuredClone(db);
    delete bare.scenarios[SC].build;
    const t = newPlant(bare, { scenario: SC });
    expect(site(t, HULL, bare)).toEqual([{ kind: 'site', op: 'hull', ok: false, error: { code: 'noBuild' } }]);
    expect(t.build).toBeUndefined();
  });
});

describe('что не работает', () => {
  test('закрыто на перестройку: зона на складе закрывает склад — задачи ждут; дверь и корпус его не меняют; другое помещение — открывает', () => {
    const s = newPlant(db, { scenario: SC });
    site(s, ZONE);
    expect(s.build!.editing).toBe('warehouse');
    const down = downOf(db, s);
    expect([...down.rooms]).toEqual([['warehouse', { code: 'editing' }]]);
    // места паллет склада не выбирают, холодной камеры — выбирают: она своё помещение
    expect(down.slots.get('quar-01')).toBe('warehouse');
    expect(down.slots.get('A-01-1-1')).toBe('warehouse');
    expect(down.slots.has('cold-01')).toBe(false);
    site(s, HULL);
    site(s, { op: 'door', cell: [33, 24], len: 1, along: 'x', kind: 'door' });
    expect(s.build!.editing).toBe('warehouse');
    advance(s, 30 * HOUR);
    const plan = planOf(db, s.plan);
    const waiting = Object.values(s.tasks).filter(t => t.state === 'open' && taskRooms(db, plan, s, t).includes('warehouse'));
    expect(waiting.length).toBeGreaterThan(0);
    for (const t of waiting) expect([t.kind, t.why, t.unfit]).toEqual([t.kind, 'down', 'warehouse']);
    // новое помещение — перестраивается оно, склад открыт: задачи берут, их ожидание — в потерях суток
    site(s, CORRIDOR);
    expect(s.build!.editing).toBe('corridor-1');
    advance(s, HOUR);
    expect(Object.values(s.tasks).filter(t => t.state === 'open' && t.why === 'down')).toEqual([]);
    expect(s.losses.some(d => Object.values(d.wait).some(w => (w?.down ?? 0) > 0))).toBe(true);
    expect(check(db, s)).toEqual([]);
  });

  test('красная: дверь из общего коридора в упаковку мимо шлюза — упаковка не начинается, задачи линии ждут; отмена — снова работает', () => {
    const s = newPlant(db, { scenario: SC });
    expect(site(s, { op: 'door', cell: [40, 21], len: 1, along: 'x', kind: 'door' })[0]).toMatchObject({ ok: true, cost: gross(B.door.D) });
    expect(downOf(db, s).rooms.get('packaging')).toMatchObject({ code: 'red', error: { code: 'airlock', from: 'hall', to: 'packaging' } });
    // дверь не закрывает ни одно помещение
    expect(s.build!.editing).toBeUndefined();
    let waited = false;
    for (let h = 0; h < 7 * 24; h++) {
      advance(s, HOUR);
      expect(Object.values(s.batches).some(b => b.pack?.state === 'running')).toBe(false);
      for (const t of Object.values(s.tasks)) if (t.state === 'open' && t.line) {
        expect([t.kind, t.why, t.unfit]).toEqual([t.kind, 'down', 'packaging']);
        waited = true;
      }
    }
    expect(waited).toBe(true);
    expect(check(db, s)).toEqual([]);
    expect(site(s, { op: 'undo' })[0]).toMatchObject({ ok: true, cost: -gross(B.door.D) });
    let ran = false;
    for (let h = 0; h < 3 * 24 && !ran; h++) {
      advance(s, HOUR);
      ran = Object.values(s.batches).some(b => b.pack?.state === 'running' || b.pack?.state === 'done');
    }
    expect(ran).toBe(true);
  });

  test('красная: техника в класс D дальше шлюза — стадия в отвесочной не начинается; отмена — начинается', () => {
    const s = newPlant(db, { scenario: SC });
    site(s, { op: 'vehicles', room: 'dispensing', on: true });
    expect(downOf(db, s).rooms.get('dispensing')).toEqual({ code: 'red', error: { code: 'vehicleD', room: 'dispensing' } });
    // «Готово» снимает перестройку, но не красное
    site(s, { op: 'done' });
    for (let h = 0; h < 3 * 24; h++) {
      advance(s, HOUR);
      expect(Object.values(s.batches).some(inDispensing)).toBe(false);
    }
    site(s, { op: 'undo' });
    let started = false;
    for (let h = 0; h < 2 * 24 && !started; h++) {
      advance(s, HOUR);
      started = Object.values(s.batches).some(inDispensing);
    }
    expect(started).toBe(true);
  });

  test('жёлтая: у мойки один проём — замечание, на работу не влияет', () => {
    const s = newPlant(db, { scenario: SC });
    // дверь мойки — в классе D: возврат — половина двери чистого помещения
    expect(site(s, { op: 'demolish', what: 'door', id: '58,9' })).toEqual([{ kind: 'site', op: 'demolish', ok: true, cost: -gross(half(B.door.D)), thing: '58,9' }]);
    const errs = siteErrors(db, s.plan);
    expect(errs.map(e => [e.code, levelOf(e)])).toEqual([['washDoors', 'yellow']]);
    expect(downOf(db, s).rooms.size).toBe(0);
    expect(s.build!.editing).toBeUndefined();
    let started = false;
    for (let h = 0; h < 2 * 24 && !started; h++) {
      advance(s, HOUR);
      started = Object.values(s.batches).some(inDispensing);
    }
    expect(started).toBe(true);
  });
});

describe('отмена', () => {
  test('план и деньги назад шаг за шагом, номер правки растёт; отменять нечего — отказ; имена не повторяются', () => {
    const s = newPlant(db, { scenario: SC });
    const cash = s.cash.balance;
    const vat = s.cash.vat.in;
    const plans = [s.plan];
    for (const op of [HULL, CORRIDOR, DOOR]) {
      site(s, op);
      plans.push(s.plan);
    }
    let rev = planRev(s.plan);
    for (let k = 2; k >= 0; k--) {
      const paid = s.build!.undo.at(-1)!.paid;
      expect(site(s, { op: 'undo' })).toEqual([{ kind: 'site', op: 'undo', ok: true, cost: -paid }]);
      expect({ ...s.plan, rev: 0 }).toEqual({ ...plans[k], rev: 0 });
      expect(planRev(s.plan)).toBe(++rev);
    }
    expect(s.cash.balance).toBe(cash);
    expect(s.cash.vat.in).toBe(vat);
    expect(s.build!.spent).toBe(0);
    expect(s.rooms['corridor-1']).toBeUndefined();
    expect(site(s, { op: 'undo' })).toEqual([{ kind: 'site', op: 'undo', ok: false, error: { code: 'nothing' } }]);
    // счётчики имён отмена не возвращает
    site(s, HULL);
    expect(site(s, CORRIDOR)[0]).toMatchObject({ ok: true, thing: 'corridor-2' });
    expect(check(db, s)).toEqual([]);
  });

  test('шагов — 50: старые забываются', () => {
    const s = newPlant(db, { scenario: SC });
    site(s, { op: 'zone', kind: 'quarantine', rect: [8, 34, 1, 1] });
    for (let i = 2; i <= 26; i++) {
      expect(site(s, { op: 'zone', kind: 'quarantine', rect: [9, 34, 1, 1] })[0]).toMatchObject({ ok: true, thing: `zone-${i}` });
      site(s, { op: 'demolish', what: 'zone', id: `zone-${i}` });
    }
    expect(s.build!.undo.length).toBe(B.undo);
    for (let i = 0; i < B.undo; i++) expect(site(s, { op: 'undo' })[0]).toMatchObject({ ok: true });
    expect(site(s, { op: 'undo' })[0]).toMatchObject({ ok: false, error: { code: 'nothing' } });
    // первый шаг забыт: его зона осталась, остальных нет
    expect(s.plan.zones.filter(z => z.id.startsWith('zone-')).map(z => z.id)).toEqual(['zone-1']);
  });

  test('отмена уберёт то, на что ссылается паллета, — «занято»; освободилось — отменяется', () => {
    const s = newPlant(db, { scenario: SC });
    site(s, ZONE);
    site(s, { op: 'done' });
    const back = occupy(s, 'zone-1-01');
    const plan = s.plan;
    expect(site(s, { op: 'undo' })).toEqual([{ kind: 'site', op: 'undo', ok: false, error: { code: 'inUse', thing: 'zone-1' } }]);
    expect(s.plan).toBe(plan);
    back();
    expect(site(s, { op: 'undo' })[0]).toMatchObject({ ok: true });
    expect(s.plan.zones.some(z => z.id === 'zone-1')).toBe(false);
    expect(s.slots['zone-1-01']).toBeUndefined();
  });
});

describe('снос занятого', () => {
  test('ряд с паллетой сносится, когда освободится: возврат — тогда же и в шаге сноса; от шага часов не зависит', () => {
    const s = newPlant(db, { scenario: SC });
    site(s, RACK);
    site(s, { op: 'done' });
    const back = occupy(s, 'E-01-1-1');
    const plan = s.plan;
    const cash = s.cash.balance;
    expect(site(s, { op: 'demolish', what: 'rack', id: 'E' })).toEqual([{ kind: 'site', op: 'demolish', ok: true, cost: 0, thing: 'E', later: true }]);
    expect(s.plan).toBe(plan);
    expect(s.build!.leaving).toEqual([{ what: 'rack', id: 'E', step: 2 }]);
    expect(s.cash.balance).toBe(cash);
    // новых паллет на сносимый ряд не кладут; сам ряд не правят
    expect(downOf(db, s).slots.get('E-01-2-3')).toBe('E');
    expect(site(s, { op: 'demolish', what: 'rack', id: 'E' })).toEqual([{ kind: 'site', op: 'demolish', ok: false, error: { code: 'leaving', thing: 'E' } }]);
    advance(s, 10 * 60);
    expect(s.plan.racks.some(r => r.id === 'E')).toBe(true);
    back();
    // копия: та же жизнь по минуте и часом сразу
    const t = structuredClone(s);
    advance(s, HOUR);
    for (let i = 0; i < 60; i++) advance(t, 60);
    for (const x of [s, t]) {
      expect(x.plan.racks.some(r => r.id === 'E')).toBe(false);
      expect(x.build!.leaving).toEqual([]);
      expect(x.cash.ledger.filter(e => e.item === 'build').at(-1)).toMatchObject({ sum: gross(half(rackPrice(B, { bays: 1, levels: 2 }))), ref: 'E' });
    }
    expect(fingerprint(t)).toBe(fingerprint(s));
    // возврат записан в шаг сноса: отмена возвращает ряд и забирает возврат
    const refund = gross(half(rackPrice(B, { bays: 1, levels: 2 })));
    expect(s.build!.undo.at(-1)).toMatchObject({ n: 2, paid: -refund });
    const now = s.cash.balance;
    expect(site(s, { op: 'undo' })).toEqual([{ kind: 'site', op: 'undo', ok: true, cost: refund }]);
    expect(s.plan.racks.some(r => r.id === 'E')).toBe(true);
    expect(s.cash.balance).toBe(now - refund);
    expect(check(db, s)).toEqual([]);
  });

  test('помещение с паллетой сносится с дверью в него; дверь в сносимое не ставят; поздняя отмена его не возвращает', () => {
    const s = newPlant(db, { scenario: SC });
    for (const op of [HULL, CORRIDOR, DOOR, { op: 'done' } as const]) site(s, op);
    const u = Object.values(s.units).find(x => x.where.kind === 'slot' && x.where.id.startsWith('A-'))!;
    const from = (u.where as { id: string }).id;
    delete s.slots[from].unit;
    u.where = { kind: 'room', id: 'corridor-1' };
    expect(site(s, { op: 'demolish', what: 'room', id: 'corridor-1' })[0]).toMatchObject({ ok: true, later: true });
    expect(downOf(db, s).rooms.get('corridor-1')).toEqual({ code: 'leaving' });
    expect(site(s, { op: 'door', cell: [59, 23], len: 1, along: 'z', kind: 'door' })).toEqual([{ kind: 'site', op: 'door', ok: false, error: { code: 'leaving', thing: 'corridor-1' } }]);
    // другая правка после пометки — её шаг отмены не вернёт снесённое
    site(s, { op: 'door', cell: [33, 24], len: 1, along: 'x', kind: 'door' });
    s.slots[from].unit = u.id;
    u.where = { kind: 'slot', id: from };
    const cash = s.cash.balance;
    const gone = advance(s, HOUR).filter(n => n.kind === 'siteGone');
    const refund = gross(half(12 * 5 * B.room.cnc + B.door.cnc));
    expect(gone).toEqual([{ kind: 'siteGone', what: 'room', id: 'corridor-1', refund }]);
    expect(s.cash.balance).toBe(cash + refund);
    expect(s.plan.rooms.some(r => r.id === 'corridor-1')).toBe(false);
    expect(s.plan.doors.some(d => d.cell[0] === 59 && d.cell[1] === 22)).toBe(false);
    expect(s.rooms['corridor-1']).toBeUndefined();
    site(s, { op: 'undo' });
    expect(s.plan.rooms.some(r => r.id === 'corridor-1')).toBe(false);
    // отмена самого сноса — помещение назад, возврат — из кассы
    const before = s.cash.balance;
    expect(site(s, { op: 'undo' })[0]).toMatchObject({ ok: true, cost: refund });
    expect(s.plan.rooms.some(r => r.id === 'corridor-1')).toBe(true);
    expect(s.cash.balance).toBe(before - refund);
    expect(check(db, s)).toEqual([]);
  });
});

describe('сохранение', () => {
  test('завод со стройкой — перестраиваемым, сносимым и шагами отмены — сохраняется и загружается с той же жизнью', () => {
    const s = newPlant(db, { scenario: SC });
    for (const op of [HULL, CORRIDOR, DOOR, ZONE]) site(s, op);
    site(s, RACK);
    site(s, { op: 'done' });
    occupy(s, 'E-01-1-1');
    site(s, { op: 'demolish', what: 'rack', id: 'E' });
    advance(s, HOUR);
    const t = fromSave(db, toSave(s));
    expect(t.build).toEqual(s.build);
    expect(t.plan).toEqual(s.plan);
    advance(s, 2 * HOUR);
    advance(t, 2 * HOUR);
    expect(fingerprint(t)).toBe(fingerprint(s));
    // отмена после загрузки — тот же план, что и без неё
    site(s, { op: 'undo' });
    site(t, { op: 'undo' });
    expect(t.plan).toEqual(s.plan);
    expect(t.cash.balance).toBe(s.cash.balance);
  });
});

describe('прогон плана', () => {
  test('стройку не повторяет: шаги отмены в копию не идут, перестраиваемое — как у завода', () => {
    const s = newPlant(db, { scenario: SC });
    site(s, ZONE);
    const c = runSeed(db, s, [], { days: 1, seeds: 1 }, 0);
    expect(c.build!.undo).toEqual([]);
    expect(c.build!.editing).toBe('warehouse');
    expect(s.build!.undo.length).toBe(1);
  });
});
