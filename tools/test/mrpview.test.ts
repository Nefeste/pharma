// Б6д: вид вкладки «Материалы» и блок планёрки (src/sim/mrp.ts). Вид — расчёт потребности как есть: 12 месяцев,
// материалы по видам, плановые заказы и сообщения; заказы в пути — по сроку прихода, у каждого — что даст «Ускорить» и
// «Отменить» или почему нельзя; без истины — у двух заводов, различающихся только истинными полями, вид один; блок
// планёрки — плановые заказы с датой сегодня и раньше и заказы в пути, которые опоздают; дорогой вид не пересобирают на
// том же миге.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, daysFromCivil, HOUR, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { MRP_MONTHS, mrpPlan } from '../../src/engine/plan/mrp';
import { cancelQuote, fastQuote, supplyDay } from '../../src/engine/supply';
import type { PlantState } from '../../src/engine/types';
import { mrpMeeting, mrpView } from '../../src/sim/mrp';
import { morningView } from '../../src/sim/report';
import { VIEW_SLOW, ViewDesk, type ViewQuery } from '../../src/sim/views';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const start = daysFromCivil(sc.start.date);
const at = (y: number, m: number, d: number, hour = 0) => (daysFromCivil({ y, m, d }) - start) * DAY + hour * HOUR;

/** 2 сентября 2027 года, 08:00: заказы правила первого дня в пути. */
const s: PlantState = newPlant(db, { scenario: SC });
apply(db, s, { kind: 'advance', seconds: at(2027, 9, 2, 8) - s.t });

describe('вкладка «Материалы»', () => {
  test('расчёт потребности как есть: месяцы, строки, плановые заказы, сообщения; как заказывает снабжение и срок завоза', () => {
    const v = mrpView(db, s);
    const r = mrpPlan(db, s);
    expect([v.view, v.from, v.today, v.arrive, v.how]).toEqual(['mrp', r.from, r.today, 25, 'need']);
    expect(v.rows).toEqual(r.rows);
    expect(v.planned).toEqual(r.planned);
    expect(v.msgs).toEqual(r.msgs);
    for (const row of v.rows) expect(row.months.map(m => m.m)).toEqual(Array.from({ length: MRP_MONTHS }, (_, i) => v.from + i));
    // все материалы плана — АФС, вспомогательные вещества, упаковка; по виду, затем по коду
    const kinds = v.rows.map(x => db.materials[x.material].kind);
    expect(kinds).toEqual([...kinds].sort((a, b) => ['api', 'excipient', 'packaging'].indexOf(a) - ['api', 'excipient', 'packaging'].indexOf(b)));
    expect(new Set(kinds)).toEqual(new Set(['api', 'excipient', 'packaging']));
  });

  test('заказы в пути — по сроку прихода; «Ускорить» и «Отменить» — то, что даст команда, или причина отказа', () => {
    const v = mrpView(db, s);
    const ordered = Object.values(s.pos).filter(p => p.status === 'ordered');
    expect(v.pos.map(p => p.po).sort()).toEqual(ordered.map(p => p.id).sort());
    for (let i = 1; i < v.pos.length; i++) expect(v.pos[i].eta).toBeGreaterThanOrEqual(v.pos[i - 1].eta);
    for (const p of v.pos) {
      const f = fastQuote(db, s, p.po);
      const c = cancelQuote(s, p.po);
      expect(p.speed).toEqual('why' in f ? { why: f.why } : { eta: f.eta, fee: f.net + f.vat });
      expect(p.cancel).toEqual('why' in c ? { why: c.why } : c);
      expect(p.lines).toEqual(s.pos[p.po].lines.map(l => ({ material: l.material, qty: l.qty })));
    }
    // ускоренный — с меткой, второй раз ускорить нельзя
    const c = structuredClone(s);
    const p = [...v.pos].filter(x => !('why' in x.speed)).sort((a, b) => b.eta - a.eta)[0];
    apply(db, c, { kind: 'expedite', po: p.po });
    const after = mrpView(db, c).pos.find(x => x.po === p.po)!;
    expect([after.fast, after.speed]).toEqual([true, { why: 'fastAgain' }]);
    // отменённый — уходит из заказов в пути
    apply(db, c, { kind: 'cancelPo', po: p.po });
    expect(mrpView(db, c).pos.some(x => x.po === p.po)).toBe(false);
  });

  test('без истины: у двух заводов, различающихся только истинными полями, вид один', () => {
    const c = structuredClone(s);
    const bump = (t: object | undefined) => {
      const r = t as Record<string, number> | undefined;
      if (r) for (const k of Object.keys(r)) if (typeof r[k] === 'number') r[k] += 1;
    };
    for (const lot of Object.values(c.lots)) bump(lot.truth);
    for (const b of Object.values(c.batches)) bump(b.truth);
    expect(mrpView(db, c)).toEqual(mrpView(db, s));
  });
});

describe('планёрка', () => {
  test('блок «Материалы»: плановые заказы с датой сегодня и раньше, заказы в пути, которые опоздают', () => {
    // 1 сентября, 08:00: заказов ещё нет — лоратадин опаздывает, плановые заказы первого дня — к заказу сегодня
    const p = newPlant(db, { scenario: SC });
    apply(db, p, { kind: 'advance', seconds: at(2027, 9, 1, 8) - p.t });
    const r = mrpPlan(db, p);
    const x = mrpMeeting(db, p)!;
    expect(x.due).toEqual(r.planned.filter(o => o.orderBy <= r.today).map(o => ({ material: o.material, supplier: o.supplier, qty: o.qty, need: o.need, late: o.late })));
    expect(x.due.some(o => o.material === 'mat.api.loratadine' && o.late > 0)).toBe(true);
    expect(x.late).toEqual([]);
    const day = momentOf(p.start, p.t).day;
    expect(morningView(db, p, { view: 'morning', day }).materials).toEqual(x);
    // после заказов правила первого дня — заказ лоратадина в пути опоздает
    supplyDay(db, p, []);
    apply(db, p, { kind: 'advance', seconds: DAY });
    const y = mrpMeeting(db, p)!;
    expect(y.late.some(l => l.material === 'mat.api.loratadine' && l.days > 0)).toBe(true);
  });

  test('сценарий без прогноза — блока нет', () => {
    const legacy = Object.values(db.scenarios).find(x => x.supply && !x.forecast);
    if (!legacy) return;
    const p = newPlant(db, { scenario: legacy.id });
    expect(mrpMeeting(db, p)).toBeUndefined();
  });
});

describe('сборка вида', () => {
  test('дорогой вид «Материалы»: на том же миге завода не пересобирают; команда — сразу', () => {
    expect(VIEW_SLOW.mrp).toBe(1000);
    const c = structuredClone(s);
    const desk = new ViewDesk(db);
    const q: ViewQuery = { id: 'mrp', view: 'mrp' };
    desk.set([q]);
    expect(desk.out(c, 0)!.map(x => x.id)).toEqual(['mrp']);
    desk.set([q]);
    expect(desk.out(c, 200)).toBeUndefined();
    const po = Object.values(c.pos).find(x => x.status === 'ordered')!;
    apply(db, c, { kind: 'cancelPo', po: po.id });
    desk.touch();
    expect(desk.out(c, 300)!.map(x => x.id)).toEqual(['mrp']);
  });
});
