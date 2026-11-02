// Б5а: журнал решений в окне (src/sim/journal.ts). Строки — от новых к старым, страницами, с отбором по посту и автору;
// «Почему?» открывает страницу записи; ссылки записи — номера и коды вещей, как в карточках; «Кто решил» у серии, партии,
// отклонения, актива, машины и человека ведёт к записям журнала; решения за сутки на планёрке — строка на руководителя;
// без истины: два завода, у которых различаются только истинные поля, дают одни и те же виды.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY } from '../../src/engine/core/calendar';
import { apply, MORNING, newPlant } from '../../src/engine/engine';
import { HEAD_SEAT } from '../../src/engine/journal';
import { planOf } from '../../src/engine/plant';
import type { PlantState } from '../../src/engine/types';
import { headDays, JOURNAL_PAGE, type JournalQuery, journalView, postOf, whoBatch, whoLot, whoMachine, whoPerson } from '../../src/sim/journal';
import { cardView } from '../../src/sim/views';
import { morningView } from '../../src/sim/report';
import { dossierView } from '../../src/sim/dossier';
import { momentOf } from '../../src/engine/core/calendar';

const SC = 'scn.proto';
const plan = planOf(db, db.scenarios[SC].plant);
const q = (o: Partial<JournalQuery> = {}): JournalQuery => ({ view: 'journal', page: 0, ...o });

/** Завод после 90 суток: задания, заказы, партии, выпуски, визиты, замена узла, найм и расследование уже были. */
const s: PlantState = newPlant(db, { scenario: SC });
apply(db, s, { kind: 'advance', seconds: 90 * DAY });

describe('журнал', () => {
  test('новые сверху, страницами; всего — по отбору', () => {
    const v = journalView(db, s, q());
    expect(v.total).toBe(s.journal.length);
    expect(v.pages).toBe(Math.ceil(s.journal.length / JOURNAL_PAGE));
    expect(v.rows).toHaveLength(Math.min(JOURNAL_PAGE, s.journal.length));
    expect(v.rows[0].n).toBe(s.journal.at(-1)!.n);
    for (let i = 1; i < v.rows.length; i++) expect(v.rows[i].n).toBeLessThan(v.rows[i - 1].n);
    const last = journalView(db, s, q({ page: v.pages - 1 }));
    expect(last.rows.at(-1)!.n).toBe(s.journal[0].n);
    expect(v.since).toBe(s.journal[0].t);
  });

  test('отбор по посту — пост руководителя; по автору — руководители или вы', () => {
    for (const seat of ['production', 'quality', 'supply', 'commerce', 'director'] as const) {
      const v = journalView(db, s, q({ seat, page: 0 }));
      expect(v.total).toBe(s.journal.filter(r => postOf(db, r) === seat).length);
      for (const r of v.rows) expect(r.post).toBe(seat);
    }
    expect(journalView(db, s, q({ who: 'heads' })).total).toBe(s.journal.filter(r => r.by !== 'player').length);
    expect(journalView(db, s, q({ who: 'player' })).total).toBe(0);
    // пост руководителя — по таблице спецификации
    expect(HEAD_SEAT).toMatchObject({ plan: 'production', mes: 'production', maint: 'production', qa: 'quality', qc: 'quality', qp: 'quality', tech: 'quality', supply: 'supply', wms: 'supply', sales: 'commerce', hr: 'director' });
  });

  test('«Почему?»: страница записи, запись — на ней', () => {
    const old = s.journal[3];
    const v = journalView(db, s, q({ focus: old.n, page: 0 }));
    expect(v.focus).toBe(old.n);
    expect(v.rows.some(r => r.n === old.n)).toBe(true);
    // записи нет — первая страница без раскрытой
    const none = journalView(db, s, q({ focus: -5 }));
    expect(none.focus).toBeUndefined();
    expect(none.page).toBe(0);
  });

  test('ссылки: задание — номер задания и серии, позиция; партия — код, материал, первая паллета; заказ — строки и срок', () => {
    const v = journalView(db, s, q({ page: 0 }));
    const all = [...v.rows];
    for (let p = 1; p < v.pages; p++) all.push(...journalView(db, s, q({ page: p })).rows);
    const order = all.find(r => r.d.kind === 'order')!;
    if (order.d.kind !== 'order') throw new Error('order');
    const b = s.batches[order.d.batch!];
    expect(order.ref.bn).toBe(Number(b.id.slice(1)));
    expect(order.ref.sku).toBe(b.sku);
    const lot = all.find(r => r.d.kind === 'lot')!;
    if (lot.d.kind !== 'lot') throw new Error('lot');
    const l = s.lots[lot.d.lot];
    expect(lot.ref.lot).toEqual([l.code.y, l.code.m, l.code.n]);
    expect(lot.ref.material).toBe(l.material);
    const po = all.find(r => r.d.kind === 'po')!;
    if (po.d.kind !== 'po') throw new Error('po');
    expect(po.ref.po).toEqual({ lines: s.pos[po.d.po!].lines.map(x => ({ material: x.material, qty: x.qty })), eta: s.pos[po.d.po!].eta });
    const visit = all.find(r => r.d.kind === 'visit');
    expect(visit).toBeDefined();
    if (visit?.d.kind === 'visit') expect(visit.ref.asset).toEqual({ family: s.assets[visit.d.asset].family, type: s.assets[visit.d.asset].type, inv: s.assets[visit.d.asset].inv });
  });
});

describe('«Кто решил»', () => {
  test('серия: задание, решение по балку и выпуск — в досье; ГП — в карточке её паллеты', () => {
    // выпущенная серия коллеги планирования, у которой ГП ещё на складе
    const onFloor = (fg?: string) => Object.values(s.units).some(u => s.containers[u.items[0]]?.lot === fg);
    const b = Object.values(s.batches).find(x => x.status === 'released' && x.by === 'head:plan' && onFloor(x.pack?.fg))!;
    const who = whoBatch(s, b);
    expect(who.map(r => r.kind)).toEqual(['order', 'lot', 'batch']);
    expect(who.map(r => r.by)).toEqual(['plan', 'qc', 'qp']);
    expect(dossierView(db, s, { view: 'dossier', batch: Number(b.id.slice(1)) }).who).toEqual(who);
    const fg = Object.values(s.units).find(u => s.containers[u.items[0]]?.lot === b.pack?.fg);
    expect(fg).toBeDefined();
    if (fg) {
      const c = cardView(db, s, { kind: 'unit', n: Number(fg.id.slice(1)) }).card;
      expect(c.kind === 'unit' && c.who).toEqual(who);
    }
  });

  test('партия поставщика: заказ поставщику и решение начальника ОКК', () => {
    const lot = Object.values(s.lots).find(l => l.po && (l.status === 'released' || l.status === 'rejected') && s.journal.some(r => r.d.kind === 'po' && r.d.po === l.po))!;
    const who = whoLot(s, lot);
    expect(who.map(r => [r.kind, r.by])).toEqual([
      ['po', 'supply'],
      ['lot', 'qc'],
    ]);
  });

  test('машина: замена узла по наработке и заказ ЗИП её запчастей; человек — вакансия и приём', () => {
    const rep = s.journal.find(r => r.d.kind === 'replace');
    expect(rep).toBeDefined();
    if (rep?.d.kind === 'replace') {
      const machine = s.parts[rep.d.part].machine;
      expect(whoMachine(db, s, machine).some(r => r.n === rep.n)).toBe(true);
      const i = plan.plant.equipment.findIndex(e => e.id === machine);
      if (i >= 0) {
        const c = cardView(db, s, { kind: 'equipment', i }).card;
        expect(c.kind === 'equipment' && c.who?.some(r => r.n === rep.n)).toBe(true);
      }
    }
    const hired = Object.values(s.people).find(p => p.cand);
    expect(hired).toBeDefined();
    if (hired) {
      const who = whoPerson(s, hired);
      expect(who.map(r => r.kind)).toEqual(['vacancy', 'hire']);
      const c = cardView(db, s, { kind: 'person', n: Number(hired.id.slice(1)) }).card;
      expect(c.kind === 'person' && c.who).toEqual(who);
    }
  });
});

describe('решения за сутки', () => {
  test('строка на руководителя: сколько, каких, предоплата заказов; последняя запись', () => {
    const day = momentOf(s.start, s.t).day;
    const at = (day - momentOf(s.start, 0).day) * DAY + MORNING;
    const from = at - DAY;
    const rows = headDays(s, from, at);
    const mine = s.journal.filter(r => r.by !== 'player' && r.t >= from && r.t < at);
    expect(rows.reduce((n, h) => n + h.n, 0)).toBe(mine.length);
    for (const h of rows) {
      const own = mine.filter(r => r.by === h.head);
      expect(h.n).toBe(own.length);
      expect(h.last).toBe(own.at(-1)!.n);
      expect(h.kinds.reduce((n, k) => n + k.n, 0)).toBe(h.n);
      const pre = own.reduce((n, r) => n + (r.d.kind === 'po' ? r.d.prepaid : 0), 0);
      if (own.some(r => r.d.kind === 'po')) expect(h.prepaid).toBe(pre);
    }
    expect(morningView(db, s, { view: 'morning', day }).heads).toEqual(rows);
  });
});

describe('без истины', () => {
  test('два завода с разными истинными свойствами партий и серий и запасом узлов — один и тот же журнал', () => {
    const b: PlantState = structuredClone(s);
    for (const lot of Object.values(b.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
    for (const bt of Object.values(b.batches)) for (const k of Object.keys(bt.truth) as (keyof typeof bt.truth)[]) bt.truth[k] = (bt.truth[k] ?? 0) + 777;
    for (const p of Object.values(b.parts)) p.budget += 12345;
    for (let page = 0; page < journalView(db, s, q()).pages; page++) expect(journalView(db, b, q({ page }))).toEqual(journalView(db, s, q({ page })));
  });
});
