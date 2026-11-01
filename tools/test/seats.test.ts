// Часть 3е: места игрока (docs/specs/2026-10-panels.md, 3е). Команда `seat` ведёт журнал мест: смена закрывает прежние
// записи и открывает новые, то же место — та же запись; отказы — пустой набор и место не из сценария. Чужая команда
// игрока — отказ `notYours` с местом, чья она; директор может всё; команды сценария не проверяются; пока места не
// выбраны — можно всё. Журнал переживает сохранение; места сценария — из пяти. Итог поста — за время на месте теми же
// функциями, что окно «Показатели» (Б5ж): сменные задания, ритм, OEE и повторные уборки производства; отклонения,
// «верно с первого раза» и время до решения качества; денежный поток и заказы директора.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { SEATS, type SeatId } from '../../src/content/types';
import { DAY, HOUR, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { cleanBatch, closedAt, kpiValues, median, rejectedAt, sincePeriod } from '../../src/engine/kpi';
import { oee, rhythm } from '../../src/engine/lean';
import { fromSave, toSave } from '../../src/engine/save';
import { foreign, held, OWNER } from '../../src/engine/seats';
import type { Command, Notice, PlantState } from '../../src/engine/types';
import { kpiView } from '../../src/sim/kpi';
import { morningView, seatSums, topView } from '../../src/sim/report';
import { scenario } from '../content/schema';

const SC = 'scn.proto';
const fresh = (): PlantState => newPlant(db, { scenario: SC });
const refusals = (n: Notice[]) => n.flatMap(x => (x.kind === 'refused' ? [[x.why, x.detail]] : []));

/** По команде каждого вида, у которого есть хозяин: сами команды могут и не пройти — проверяется только, чья она. */
const COMMANDS: Command[] = [
  { kind: 'order', recipe: 'rcp.paracetamol500.wet.v1', by: 'player' },
  { kind: 'shift', batch: 'B2', notBefore: 0, by: 'player' },
  { kind: 'pack', batch: 'B1', sku: 'sku.paracetamol500.n20' },
  { kind: 'maintain', machine: 'press-1', part: 'punches' },
  { kind: 'rush', lot: 'L1', by: 'player' },
  { kind: 'release', batch: 'B1', decision: 'hold' },
  { kind: 'po', supplier: 'sup.exc', lines: [{ material: 'mat.exc.starch', qty: 25_000_000 }], by: 'player' },
  { kind: 'investigate', inv: 'I1', step: 'records', by: 'player' },
  { kind: 'conclude', inv: 'I1', cause: 'lab', fate: 'reject', by: 'player' },
];

describe('журнал мест', () => {
  test('взять место — запись с этой минуты; сменить — прежние закрыты, новые открыты; то же место — та же запись', () => {
    const s = fresh();
    expect(held(s)).toBeUndefined();
    expect(apply(db, s, { kind: 'seat', seats: ['production'] })).toEqual([]);
    expect(s.seats).toEqual([{ seat: 'production', from: s.t }]);
    const t0 = s.t;
    apply(db, s, { kind: 'advance', seconds: 5 * HOUR });
    apply(db, s, { kind: 'seat', seats: ['quality', 'production'] });
    expect(s.seats).toEqual([
      { seat: 'production', from: t0 },
      { seat: 'quality', from: t0 + 5 * HOUR },
    ]);
    apply(db, s, { kind: 'advance', seconds: DAY });
    apply(db, s, { kind: 'seat', seats: ['director'] });
    const t2 = t0 + 5 * HOUR + DAY;
    expect(s.seats).toEqual([
      { seat: 'production', from: t0, to: t2 },
      { seat: 'quality', from: t0 + 5 * HOUR, to: t2 },
      { seat: 'director', from: t2 },
    ]);
    expect(held(s)).toEqual(['director']);
  });

  test('отказы: пустой набор; место, которого сценарий не даёт; без отказа журнал не меняется', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    const before = structuredClone(s.seats);
    expect(refusals(apply(db, s, { kind: 'seat', seats: [] }))).toEqual([['empty', undefined]]);
    expect(refusals(apply(db, s, { kind: 'seat', seats: ['production', 'supply'] }))).toEqual([['noSeat', 'supply']]);
    expect(refusals(apply(db, s, { kind: 'seat', seats: ['boss' as SeatId] }))).toEqual([['noSeat', 'boss']]);
    expect(s.seats).toEqual(before);
  });
});

describe('своё и чужое', () => {
  test('чужая команда игрока — отказ с местом, чья она; своя — не этот отказ; директор может всё', () => {
    for (const mine of [['production'], ['quality'], ['director'], ['production', 'quality']] as SeatId[][]) {
      for (const cmd of COMMANDS) {
        const s = fresh();
        apply(db, s, { kind: 'seat', seats: mine });
        const owner = OWNER[cmd.kind]!;
        const out = refusals(apply(db, s, cmd));
        const ok = mine.includes('director') || mine.includes(owner);
        if (ok) expect(out.some(([why]) => why === 'notYours')).toBe(false);
        else expect(out).toEqual([['notYours', owner]]);
      }
    }
  });

  test('чужой отказ не меняет завод; ход времени — у всех; команды сценария не проверяются', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    const before = toSave(s);
    apply(db, s, { kind: 'order', recipe: 'rcp.paracetamol500.wet.v1', by: 'player' });
    expect(toSave(s)).toBe(before);
    expect(foreign(s, { kind: 'advance', seconds: HOUR })).toBeUndefined();
    expect(foreign(s, { kind: 'seat', seats: ['production'] })).toBeUndefined();
    const n = Object.keys(s.batches).length;
    expect(refusals(apply(db, s, { kind: 'order', recipe: 'rcp.paracetamol500.wet.v1', by: 'scenario' }))).toEqual([]);
    expect(Object.keys(s.batches).length).toBe(n + 1);
  });

  test('пока места не выбраны — можно всё, как до 3е', () => {
    const s = fresh();
    for (const cmd of COMMANDS) expect(foreign(s, cmd)).toBeUndefined();
  });

  test('у каждой команды с хозяином — место из пяти', () => {
    for (const own of Object.values(OWNER)) expect(SEATS).toContain(own!);
  });
});

describe('сохранение и база', () => {
  test('журнал мест переживает сохранение; после загрузки чужое — тоже чужое', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['director'] });
    apply(db, s, { kind: 'advance', seconds: 3 * HOUR });
    apply(db, s, { kind: 'seat', seats: ['production'] });
    const back = fromSave(db, toSave(s));
    expect(back.seats).toEqual(s.seats);
    expect(refusals(apply(db, back, { kind: 'rush', lot: 'L1', by: 'player' }))).toEqual([['notYours', 'quality']]);
  });

  test('места сценария прототипа — директор, производство, качество; в записи — только места из пяти, хотя бы одно', () => {
    expect(db.scenarios[SC].seats).toEqual(['director', 'production', 'quality']);
    const base = { ...db.scenarios[SC] };
    const raw = (seats: unknown) => ({
      id: base.id,
      name: base.name,
      profile: base.profile,
      plant: base.plant,
      start: { date: '2027-09-01', hour: 7 },
      seed: 1,
      site: { w: 60, h: 40 },
      cash: 1,
      credit: { limit: 0, spread: 0 },
      energy: { price: 1 },
      staff: [{ role: 'role.operator', shift: 'shift.a', skill: 3, n: 1 }],
      vehicles: [],
      training: { ahead: 14, check: 15, spread: 0, tab: 1 },
      assets: { ahead: 14, hours: [9, 17], accept: 15, inv: 1 },
      partners: { ahead: 30, every: { api: 24, excipient: 36, packaging: 12 }, audit: { days: 3, review: 4, price: 350000 }, docs: { review: 3 }, markup: 10, share: 50, months: 12, ctr: 1 },
      policies: { overtime: 'need' },
      deviations: { term: 30 },
      account: 3,
      ...(seats === undefined ? {} : { seats }),
    });
    expect(scenario.safeParse(raw(['director'])).success).toBe(true);
    expect(scenario.safeParse(raw([])).success).toBe(false);
    expect(scenario.safeParse(raw(['boss'])).success).toBe(false);
    const all = scenario.safeParse(raw(undefined));
    expect(all.success && all.data.seats).toEqual([...SEATS]);
  });
});

describe('итог поста', () => {
  // директор, производство и качество — с начала партии; через 10 суток качество сдали и взяли снова
  const s = fresh();
  const t0 = s.t;
  apply(db, s, { kind: 'seat', seats: ['director', 'production', 'quality'] });
  apply(db, s, { kind: 'advance', seconds: 10 * DAY });
  apply(db, s, { kind: 'seat', seats: ['director', 'production'] });
  apply(db, s, { kind: 'advance', seconds: HOUR });
  const tq = s.t;
  apply(db, s, { kind: 'seat', seats: ['director', 'production', 'quality'] });
  apply(db, s, { kind: 'advance', seconds: 40 * DAY });
  const sums = seatSums(db, s);
  const of = <K extends SeatId>(k: K) => sums.find(x => x.seat === k) as Extract<ReturnType<typeof seatSums>[number], { seat: K }>;

  test('по месту, которое держат сейчас, — с какого мгновения; полоса знает места', () => {
    expect(sums.map(x => [x.seat, x.from])).toEqual([
      ['director', t0],
      ['production', t0],
      ['quality', tq],
    ]);
    expect(topView(db, s).seats).toEqual(['director', 'production', 'quality']);
    expect(topView(db, s).offered).toEqual(db.scenarios[SC].seats);
    const day = momentOf(s.start, s.t).day;
    expect(morningView(db, s, { view: 'morning', day }).seats).toEqual(sums);
  });

  test('производство: сменные задания и ритм — по сменам, закрытым на месте; OEE — по суткам линии; уборки и переналадки', () => {
    const p = of('production');
    const tasks = s.shiftTasks.filter(t => t.plan > 0 && t.fact !== undefined && t.to !== undefined && t.to >= t0 && t.to < s.t);
    expect(p.shifts).toBe(tasks.length);
    expect(p.plan).toBe(tasks.reduce((n, t) => n + t.plan, 0));
    expect(p.fact).toBe(tasks.reduce((n, t) => n + t.fact!, 0));
    expect(p.rhythm).toBe(rhythm(tasks));
    expect(p.shift).toBe(Math.round((p.fact * 10000) / p.plan));
    const line = Object.keys(s.lines)[0];
    const days = s.losses.flatMap(d => (d.lines[line] ? [d.lines[line]] : []));
    const ideal = days[0].ideal.map((_, i) => days.reduce((n, d) => n + d.ideal[i], 0));
    const key = ideal.indexOf(Math.min(...ideal));
    const want = oee({ ideal: ideal[key], run: days.reduce((n, d) => n + d.run[key], 0), out: days.reduce((n, d) => n + d.times[key].out, 0) }, days.reduce((n, d) => n + d.good, 0));
    expect(p.lines).toEqual([{ line: 0, oee: want! }]);
    expect(p.recleans).toBe(s.losses.reduce((n, d) => n + d.recleans, 0));
    expect(p.recleans).toBeGreaterThan(0);
    // генеральные уборки и переналадки (Б2г) — суммой суток на посту
    expect(p.switches).toEqual({
      major: s.losses.reduce((n, d) => n + d.cleans.major, 0),
      majorSec: s.losses.reduce((n, d) => n + d.cleans.majorSec, 0),
      changes: s.losses.reduce((n, d) => n + d.changes.n, 0),
      changeSec: s.losses.reduce((n, d) => n + d.changes.sec, 0),
    });
    expect(p.switches.major).toBeGreaterThan(0);
  });

  test('качество: отклонения и выпущенные серии — только с мгновения, когда место взяли снова; время до решения — медиана', () => {
    const q = of('quality');
    const devs = Object.values(s.deviations).filter(d => d.opened >= tq);
    expect(q.deviations).toBe(devs.length);
    expect(q.open).toBe(devs.filter(d => d.status === 'open').length);
    const released = Object.values(s.batches).filter(b => b.status === 'released' && b.released! >= tq && b.released! < s.t);
    expect(released.length).toBeGreaterThan(0);
    expect(q.released).toBe(released.length);
    expect(q.first).toBe(released.filter(b => cleanBatch(s, b)).length);
    expect(q.rft).toBe(Math.round((q.first * 10000) / q.released));
    expect(q.release).toBe(median(released.map(b => b.released! - b.pack!.end!)));
    // серии, выпущенные до того, как место взяли снова, — не в счёт
    const before = Object.values(s.batches).filter(b => b.status === 'released' && b.released! < tq).length;
    expect(before).toBeGreaterThan(0);
    expect(q.released + before).toBe(Object.values(s.batches).filter(b => b.status === 'released' && b.released! < s.t).length);
  });

  test('директор: касса и денежный поток, заказы в срок и полностью из закрытых, отклонённые серии', () => {
    const d = of('director');
    expect(d.balance).toBe(s.cash.balance);
    expect(d.flow).toBe(s.cash.ledger.reduce((n, e) => n + (e.item !== 'start' && e.t >= t0 && e.t < s.t ? e.sum : 0), 0));
    const closed = Object.values(s.orders).filter(o => { const at = closedAt(s, o); return at !== undefined && at < s.t; });
    expect(closed.length).toBeGreaterThan(0);
    expect(d.closed).toBe(closed.length);
    expect(d.onTime).toBe(closed.filter(o => o.status === 'shipped').length);
    expect(d.otif).toBe(Math.round((d.onTime * 10000) / d.closed));
    expect(d.rejected).toBe(Object.values(s.batches).filter(b => (rejectedAt(s, b) ?? s.t) < s.t).length);
  });

  test('те же определения, что у окна «Показатели»: за время на месте — числа показателей за тот же период', () => {
    const p = of('production');
    const q = of('quality');
    const d = of('director');
    const vp = kpiValues(db, s, sincePeriod(s, t0));
    const vq = kpiValues(db, s, sincePeriod(s, tq));
    expect([p.shift, p.rhythm, d.flow, d.otif]).toEqual([vp.shift, vp.rhythm, vp.flow, vp.otifOrders]);
    expect(p.lines[0].oee?.oee).toBe(vp.oee);
    expect([q.rft, q.release]).toEqual([vq.rft, vq.release]);
  });

  test('за одни и те же сутки числа итога и окна совпадают: место с начала партии, первый месяц', () => {
    const e = fresh();
    apply(db, e, { kind: 'seat', seats: ['director', 'production', 'quality'] });
    apply(db, e, { kind: 'advance', seconds: 25 * DAY });
    expect(e.kpi.months).toEqual([]);
    const sum = seatSums(db, e);
    const cell = (tab: SeatId, id: string) => kpiView(db, e, { view: 'kpi', tab }).rows.flatMap(r => r.cells).find(c => c.id === id)?.now;
    const ps = sum.find(x => x.seat === 'production') as Extract<(typeof sum)[number], { seat: 'production' }>;
    const qs = sum.find(x => x.seat === 'quality') as Extract<(typeof sum)[number], { seat: 'quality' }>;
    const ds = sum.find(x => x.seat === 'director') as Extract<(typeof sum)[number], { seat: 'director' }>;
    expect([ps.shift, ps.rhythm, ps.lines[0].oee?.oee]).toEqual([cell('production', 'shift'), cell('production', 'rhythm'), cell('production', 'oee')]);
    expect([qs.rft, qs.release]).toEqual([cell('quality', 'rft'), cell('quality', 'release')]);
    expect([ds.flow, ds.otif]).toEqual([cell('director', 'flow'), cell('director', 'otifOrders')]);
    expect(ps.shift).toBeDefined();
    expect(qs.rft).toBeDefined();
  });

  test('без истины: два завода с разными истинными полями — один и тот же итог', () => {
    const b: PlantState = structuredClone(s);
    for (const lot of Object.values(b.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
    for (const bt of Object.values(b.batches)) {
      for (const k of Object.keys(bt.truth) as (keyof typeof bt.truth)[]) bt.truth[k] = (bt.truth[k] ?? 0) + 777;
      bt.causes = [];
    }
    for (const p of Object.values(b.parts)) p.budget += 12345;
    expect(JSON.stringify(seatSums(db, b))).toBe(JSON.stringify(sums));
  });
});
