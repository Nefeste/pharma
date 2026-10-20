// Б2а: тревоги часа (src/engine/alerts.ts; геймдизайн, §2, «Автопауза»). Каждая — одно извещение на вещь в тот час, на
// который пришёлся её порог; новому заказу не хватит ГП — по тому же правилу, что у планёрки; своего состояния у тревог
// нет. Остановка ровно на событии (`more` после каждого события, `stop` у `tick` потока расчёта) — и дальше та же жизнь,
// что без остановки.
import { describe, expect, test } from 'bun:test';
import { legacy as db } from './legacy';
import { alertsHour, TRUCK_WAIT } from '../../src/engine/alerts';
import { DAY, HOUR, momentOf } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, catchUp, MORNING, newPlant } from '../../src/engine/engine';
import { orderRisks } from '../../src/engine/market';
import type { Notice, PlantState } from '../../src/engine/types';
import { fromSave } from '../../src/engine/save';
import { createSim } from '../../src/sim/host';
import { H } from '../../src/sim/pack';
import { morningView } from '../../src/sim/report';

const SC = 'scn.proto';
const of = <K extends Notice['kind']>(list: Notice[], kind: K) => list.filter((n): n is Extract<Notice, { kind: K }> => n.kind === kind);

/** Жить по часу, пока не придёт извещение `kind`, — не дольше `days` суток; все извещения по часам. */
function until(s: PlantState, kind: Notice['kind'], days: number): { t: number; notices: Notice[] }[] {
  const out: { t: number; notices: Notice[] }[] = [];
  const end = s.t + days * DAY;
  while (s.t < end) {
    const notices = apply(db, s, { kind: 'advance', seconds: HOUR });
    out.push({ t: s.t, notices });
    if (notices.some(n => n.kind === kind)) break;
  }
  return out;
}

describe('тревоги часа', () => {
  test('заказ под угрозой — в час заказа, по правилу планёрки, один раз', () => {
    const s = newPlant(db, { scenario: SC });
    const hours = until(s, 'orderRisk', 5);
    const [n] = of(hours.at(-1)!.notices, 'orderRisk');
    expect(n).toBeDefined();
    const o = s.orders[n.order];
    expect(o.status).toBe('open');
    expect(o.placed).toBe(s.t);
    // то же, что видит планёрка: ящиков не хватит столько же
    const row = orderRisks(db, s).find(r => r.order === n.order)!;
    expect(n).toEqual({ kind: 'orderRisk', ...row });
    expect(morningView(db, s, { view: 'morning', day: momentOf(s.start, s.t).day }).risk.find(r => r.order === n.order)).toEqual(row);
    // в следующие сутки о том же заказе — ни слова
    const next = until(s, 'never' as Notice['kind'], 1);
    expect(next.flatMap(h => of(h.notices, 'orderRisk')).filter(x => x.order === n.order)).toEqual([]);
  });

  test('материал не пришёл — в час «не раньше» задания, которое так и ждёт материала; один раз', () => {
    const s = newPlant(db, { scenario: SC });
    // АФС на складе — на пять серий; задания сценария разобрали его: девятое ждёт
    const notBefore = s.t + HOUR + 30 * 60;
    apply(db, s, { kind: 'order', recipe: 'rcp.paracetamol500.wet.v1', notBefore, by: 'player' });
    const b = Object.values(s.batches).at(-1)!;
    expect(b.status).toBe('waiting');
    const hours = until(s, 'materialLate', 1);
    const last = hours.at(-1)!;
    const late = of(last.notices, 'materialLate');
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ batch: b.id, code: '', short: b.short });
    expect(late[0].short.map(x => x.material)).toContain('mat.api.paracetamol');
    // первый целый час не раньше срока
    expect(last.t).toBe(Math.ceil(notBefore / HOUR) * HOUR);
    const next = until(s, 'never' as Notice['kind'], 1);
    expect(next.flatMap(h => of(h.notices, 'materialLate')).filter(x => x.batch === b.id)).toEqual([]);
  });

  test('фура ждёт разгрузки — один раз, в час, на который пришлись 2 часа с прихода; без паллет и у покупателя — нет', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: HOUR });
    const po = Object.keys(s.pos)[0];
    const truck = (arrived: number, units: string[], buyer = false) => ({
      id: 'T99',
      dock: 'dock-in',
      ...(buyer ? { customer: 'cus.national' } : { po }),
      units,
      arrived,
      docked: true,
      open: true,
    });
    const run = (tr: ReturnType<typeof truck>) => {
      const c: PlantState = structuredClone(s);
      c.trucks[tr.id] = tr;
      const out: Notice[] = [];
      alertsHour(db, c, out);
      return of(out, 'truckWait');
    };
    expect(run(truck(s.t - TRUCK_WAIT - 30 * 60, ['U1']))).toEqual([{ kind: 'truckWait', truck: 'T99', po, supplier: s.pos[po].supplier }]);
    expect(run(truck(s.t - TRUCK_WAIT, ['U1']))).toHaveLength(1);
    // порог — час назад: о нём сказали прошлым часом; ещё не наступил — рано
    expect(run(truck(s.t - TRUCK_WAIT - HOUR, ['U1']))).toEqual([]);
    expect(run(truck(s.t - TRUCK_WAIT + 1, ['U1']))).toEqual([]);
    expect(run(truck(s.t - TRUCK_WAIT - 30 * 60, []))).toEqual([]);
    expect(run(truck(s.t - TRUCK_WAIT - 30 * 60, ['U1'], true))).toEqual([]);
  });

  test('у тревог нет состояния: час с ними и без них — один отпечаток', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: 3 * DAY });
    const before = fingerprint(s);
    alertsHour(db, s, []);
    expect(fingerprint(s)).toBe(before);
  });
});

describe('доживание встаёт на событии', () => {
  test('`more` после события: часы — на 08:00 планёрки, остальное — потом; итог тот же, что одним куском', () => {
    const a = newPlant(db, { scenario: SC });
    const b = newPlant(db, { scenario: SC });
    const target = a.t + 2 * DAY;
    a.until = target;
    const got = catchUp(db, a, list => !list.some(n => n.kind === 'morning'));
    expect(got.at(-1)?.kind).toBe('morning');
    expect(a.t % DAY).toBe(MORNING);
    expect(a.until).toBe(target);
    // недожитое доживается следующим разом
    catchUp(db, a);
    expect(a.t).toBe(target);
    expect(a.until).toBeUndefined();
    apply(db, b, { kind: 'advance', seconds: 2 * DAY });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });
});

describe('поток расчёта встаёт на автопаузе', () => {
  test('`tick` с видами стопа: часы — ровно 08:00 планёрки, отставания нет, недожитое пропало; дальше — та же жизнь', () => {
    const sim = createSim(db);
    sim.handle({ kind: 'start', scenario: SC });
    const r = sim.handle({ kind: 'tick', seconds: 3 * DAY, budgetMs: 60_000, stop: ['morning', 'failure'] });
    if (r.kind !== 'slice') throw new Error(r.kind);
    expect(r.stopped).toBe(true);
    expect(r.lag).toBe(0);
    expect(r.buf[H.t]).toBe(MORNING);
    expect(r.notices.at(-1)?.kind).toBe('morning');
    // пауза: кадр без секунд — часы стоят, и это не новая остановка
    const still = sim.handle({ kind: 'tick', seconds: 0, budgetMs: 60_000, stop: ['morning'] });
    if (still.kind !== 'slice') throw new Error(still.kind);
    expect(still.buf[H.t]).toBe(MORNING);
    expect(still.stopped).toBeUndefined();
    // час без стопа — тот же завод, что прожит до 09:00 одним куском
    const go = sim.handle({ kind: 'tick', seconds: HOUR, budgetMs: 60_000 });
    if (go.kind !== 'slice') throw new Error(go.kind);
    expect(go.buf[H.t]).toBe(MORNING + HOUR);
    const saved = sim.handle({ kind: 'save' });
    if (saved.kind !== 'saved') throw new Error(saved.kind);
    const back = fromSave(db, saved.json);
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: MORNING + HOUR - s.t });
    expect(back.t).toBe(s.t);
    expect(fingerprint(back)).toBe(fingerprint(s));
  });

  test('без стопа тот же кадр проживает всё; вид, которого не было, не останавливает', () => {
    const sim = createSim(db);
    const first = sim.handle({ kind: 'start', scenario: SC });
    if (first.kind !== 'slice') throw new Error(first.kind);
    const t0 = first.buf[H.t];
    const r = sim.handle({ kind: 'tick', seconds: 2 * DAY, budgetMs: 60_000, stop: ['concluded'] });
    if (r.kind !== 'slice') throw new Error(r.kind);
    expect(r.stopped).toBeUndefined();
    expect(r.buf[H.t]).toBe(t0 + 2 * DAY);
    expect(r.notices.filter(n => n.kind === 'morning')).toHaveLength(2);
  });
});
