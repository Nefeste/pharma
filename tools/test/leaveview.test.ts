// Отпуска в окне (Б4г; docs/specs/2026-10-vertical-slice.md, «Проверки Б4г»): справочник — график этого и следующего
// года по людям, черновик или утверждён, дни человека, части с заместителями и что мешает; карточка — в отпуске до,
// кто замещает и кого замещает он; планёрка — кто в отпуске, кто уходит, кто выходит, черновик до утверждения; касса —
// отпускные своей строкой; табель — «ОТ», праздник — «В»; «Сейчас» — работа заместителя «за» роль ушедшего. Всё — по
// записям завода.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { DAY, daysFromCivil, HOUR, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { approveDay, earnedDays } from '../../src/engine/leave';
import type { PlantState } from '../../src/engine/types';
import { sheetOf } from '../../src/sim/hours';
import { nowView } from '../../src/sim/now';
import { refView } from '../../src/sim/ref';
import { cashView, morningView } from '../../src/sim/report';
import { cardView } from '../../src/sim/views';

const SC = 'scn.proto';
const start = daysFromCivil(db.scenarios[SC].start.date);
const ymd = (y: number, m: number, d: number) => daysFromCivil({ y, m, d });
const at = (day: number, hour: number) => (day - start) * DAY + hour * HOUR;
const today = (s: PlantState) => momentOf(s.start, s.t).day;
const num = (id: string) => Number(id.slice(1));

/** Копия базы: никто не уходит сам — люди черновика те же. */
function calm(): ContentDb {
  const d = structuredClone(db) as ContentDb;
  for (const r of Object.values(d.scenarios[SC].labor!.roles)) r.quit = 0;
  return d;
}

function live(d: ContentDb, s: PlantState, until: number, each?: () => void) {
  while (s.t < until) {
    apply(d, s, { kind: 'advance', seconds: Math.min(HOUR, until - s.t) });
    each?.();
  }
}

function person(d: ContentDb, s: PlantState, id: string) {
  const c = cardView(d, s, { kind: 'person', n: num(id) }).card;
  if (c?.kind !== 'person') throw new Error(`нет карточки ${id}`);
  return c;
}

describe('график отпусков в окне', () => {
  const d = calm();
  const s = newPlant(d, { scenario: SC });
  const before = refView(d, s).leave!;
  live(d, s, at(ymd(2027, 12, 1), 10));
  const draft = refView(d, s).leave!;
  live(d, s, at(ymd(2027, 12, 2), 9));
  const m1 = morningView(d, s, { view: 'morning', day: today(s) }).leave!;
  live(d, s, at(ymd(2027, 12, 20), 9));
  const m2 = morningView(d, s, { view: 'morning', day: today(s) }).leave!;
  const approved = refView(d, s).leave!;
  // в отпуске водитель погрузчика с 10 января; за него — кладовщик
  live(d, s, at(ymd(2028, 1, 12), 10));
  const m3 = morningView(d, s, { view: 'morning', day: today(s) }).leave!;
  const jan12 = structuredClone(s);
  // с 24 января в отпуске кладовщик, за него — водитель погрузчика: работа склада у них общая, а возврат тары — только
  // кладовщика; в «Сейчас» у такой работы — «за» и роль ушедшего
  let covered: { kind: string; role: string; for?: string } | undefined;
  live(d, s, at(ymd(2028, 1, 24), 6));
  while (!covered && s.t < at(ymd(2028, 1, 27), 0)) {
    apply(d, s, { kind: 'advance', seconds: 600 });
    for (const r of nowView(d, s).rows) for (const x of r.people) if (x.n === 2 && x.for) covered = { kind: r.kind, role: x.role, for: x.for };
  }

  test('до черновика — годов нет; черновик 1 декабря: у людей по две части следующего года, дни — с начала завода', () => {
    expect(before.years.map(y => [y.y, y.st])).toEqual([
      [2027, undefined],
      [2028, undefined],
    ]);
    expect(before.people.every(p => p.parts.length === 0 && p.used === 0)).toBe(true);
    expect(draft.years.find(y => y.y === 2028)).toMatchObject({ st: 'draft', draft: ymd(2027, 12, 1), approve: approveDay(d, s, 2028), miss: [] });
    expect(draft.people).toHaveLength(Object.keys(s.people).length);
    for (const p of draft.people) {
      expect([p.person, p.parts.map(x => x.days)]).toEqual([p.person, [14, 14]]);
      expect([p.person, p.left]).toEqual([p.person, [[2028, 0]]]);
      expect(p.earned).toBe(earnedDays(d, s, { hired: undefined }, ymd(2027, 12, 1)));
      expect(p.parts.every(x => !x.told && !x.started && x.paid === undefined)).toBe(true);
    }
    // порядок — по отделам, ролям и табельным номерам: склад первым
    expect(draft.people[0].dept).toBe('wms');
    expect([draft.law, draft.rule]).toEqual([
      { days: 28, part: 14, notice: 14, pay: 3 },
      { parts: [14, 14], dept: 2, cover: d.scenarios[SC].leave!.cover },
    ]);
  });

  test('часть: заместитель и кто ещё годится; уполномоченное лицо — без заместителя и без выбора', () => {
    const e1 = draft.people.find(p => p.person === 1)!;
    expect(e1.parts.map(x => x.deputy)).toEqual([
      { n: 2, role: 'role.driver', tab: s.people.E2.tab },
      { n: 2, role: 'role.driver', tab: s.people.E2.tab },
    ]);
    const qp = draft.people.find(p => p.role === 'role.qp')!;
    expect(qp.parts.every(x => x.deputy === undefined && x.can.length === 0)).toBe(true);
    // что мешает: по черновику правило выполнено — люди одной роли не вместе, заместитель не в отпуске, отдел — в пределе
    const all = draft.people.flatMap(p => p.parts.map(x => x.problems));
    expect(all.filter(x => x.includes('role') || x.includes('deputyAway') || x.includes('dept'))).toEqual([]);
  });

  test('планёрка: черновик — до утверждения, с днём утверждения; после — нет; в январе — кто в отпуске с заместителем', () => {
    expect(m1.draft).toEqual({ y: 2028, approve: ymd(2027, 12, 17), problems: expect.any(Number), miss: 0 });
    expect(m2.draft).toBeUndefined();
    expect(approved.years.find(y => y.y === 2028)!.st).toBe('approved');
    const e2 = m3.away.find(x => x.n === 2)!;
    expect(e2).toEqual({ n: 2, role: 'role.driver', tab: s.people.E2.tab, to: ymd(2028, 1, 23), deputy: { n: 1, role: 'role.storekeeper', tab: s.people.E1.tab } });
    // уходит в ближайшие две недели — с началом и заместителем; выходит — на день после последнего дня части
    for (const x of m3.going) expect(x.from - today(jan12)).toBeLessThanOrEqual(14);
    for (const x of m3.back) expect(x.day - today(jan12)).toBeLessThan(8);
  });

  test('карточка: у ушедшего — «в отпуске по» и заместитель; у заместителя — кого замещает; смежные профессии', () => {
    const q = jan12;
    const e2 = person(d, q, 'E2');
    expect(e2.leave!.away).toEqual({ to: ymd(2028, 1, 23), deputy: { n: 1, role: 'role.storekeeper', tab: q.people.E1.tab } });
    expect(e2.leave!.plan.parts.find(x => x.from === ymd(2028, 1, 10))).toMatchObject({ told: true, started: true, ended: false, paid: q.people.E2.away!.find(a => a.from === ymd(2028, 1, 10))!.paid });
    const e1 = person(d, q, 'E1');
    expect(e1.also).toEqual(['role.driver']);
    expect(e1.leave!.covers).toEqual([{ n: 2, role: 'role.driver', tab: q.people.E2.tab, to: ymd(2028, 1, 23) }]);
    expect(e1.leave!.away).toBeUndefined();
    // смежной профессией не бывают своя роль, уполномоченное лицо и та, что уже есть
    expect(e1.leave!.alsoCan).not.toContain('role.storekeeper');
    expect(e1.leave!.alsoCan).not.toContain('role.qp');
    expect(e1.leave!.alsoCan).not.toContain('role.driver');
  });

  test('касса: отпускные — своей строкой, с ролью, табельным номером и днями части', () => {
    const e2 = s.people.E2.away!.find(a => a.from === ymd(2028, 1, 10))!;
    const row = s.cash.ledger.find(x => x.ref === `vac-${e2.id}`)!;
    const q = structuredClone(s);
    q.t = row.t;
    const v = cashView(d, q, { view: 'cash', page: 0 });
    const got = v.entries.find(x => x.item === 'vacation' && x.why?.k === 'vacation' && x.why.tab === s.people.E2.tab)!;
    expect(got).toEqual({ t: row.t, item: 'vacation', sum: -e2.paid!, why: { k: 'vacation', role: 'role.driver', tab: s.people.E2.tab, from: e2.from, to: e2.to }, parts: { salary: 0, night: 0, over: 0, off: 0, vac: e2.paid } });
  });

  test('табель: дни отпуска — «ОТ», праздник внутри части — «В»; «Сейчас»: водитель погрузчика — за кладовщика', () => {
    const rows = sheetOf(d, jan12, jan12.people.E2).rows;
    for (const r of rows.filter(x => x.day >= ymd(2028, 1, 10))) expect([r.day, r.marks]).toEqual([r.day, ['leave']]);
    // та же часть с 3 января: январские праздники в ней — выходные, а не отпуск
    const q = structuredClone(jan12);
    const a = q.people.E2.away!.find(x => x.from === ymd(2028, 1, 10))!;
    a.from = ymd(2028, 1, 3);
    const marks = sheetOf(d, q, q.people.E2).rows.filter(x => x.day >= ymd(2028, 1, 3)).map(x => x.marks.join());
    expect(marks).toEqual(['rest', 'rest', 'rest', 'rest', 'rest', 'rest', 'leave', 'leave', 'leave', 'leave']);
    expect(covered).toMatchObject({ role: 'role.driver', for: 'role.storekeeper' });
  });
});
