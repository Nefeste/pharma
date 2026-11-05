// Заместители после текучести (0.0.65; docs/specs/2026-10-vertical-slice.md, «Б4г», «Заместитель и смежная профессия»):
// новый человек на место ушедшего — с его смежными профессиями и задачами изучить их строки; частям людей этих ролей без
// заместителя кадры ставят заместителя по правилу — и когда человек выходит на место ушедшего, и когда его обучили
// смежной профессии; часть с заместителем остаётся как есть. Кладовщик в отпуске — работу кладовщика берёт новый водитель.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { DAY, daysFromCivil, HOUR, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { WMS } from '../../src/engine/wms';
import { rowsOf } from '../../src/engine/quals';
import type { PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const P = 10000;
const start = daysFromCivil(db.scenarios[SC].start.date);
const ymd = (y: number, m: number, d: number) => daysFromCivil({ y, m, d });
const at = (day: number, hour: number) => (day - start) * DAY + hour * HOUR;
const today = (s: PlantState) => momentOf(s.start, s.t).day;
const people = db.scenarios[SC].staff.reduce((a, r) => a + r.n, 0);
const codeOf = (doc: string) => (db.sops[doc] ?? db.tests[doc]).doc.code;

/** Копия базы: сам никто не уходит; на объявление о водителе — отклики с навыком 3. */
function market(): ContentDb {
  const d = structuredClone(db) as ContentDb;
  const l = d.scenarios[SC].labor!;
  for (const r of Object.keys(l.roles)) l.roles[r].quit = 0;
  l.roles['role.driver'].ad = [0, 0, 0, P];
  l.roles['role.driver'].skill = [0, 0, P, 0, 0];
  return d;
}

describe('на место ушедшего', () => {
  test('новый водитель — со смежной профессией ушедшего: изучает и её строку, замещает кладовщика в отпуске', () => {
    const d = market();
    const s = newPlant(d, { scenario: SC });
    // части кладовщика: первая — без заместителя (так её поставил черновик, когда замещать было некому), вторая — с
    // водителем, который уходит
    s.people.E1.away = [
      { id: 'A1', y: 2027, from: ymd(2027, 10, 18), to: ymd(2027, 10, 31), days: 14, deputy: 'E2' },
      { id: 'A2', y: 2027, from: ymd(2027, 11, 15), to: ymd(2027, 11, 28), days: 14 },
    ];
    s.next.A = 2;
    expect(s.people.E2.also).toEqual(['role.storekeeper']);
    d.scenarios[SC].labor!.roles['role.driver'].quit = 365 * P;
    apply(d, s, { kind: 'advance', seconds: at(start + 1, 1) - s.t });
    d.scenarios[SC].labor!.roles['role.driver'].quit = 0;
    expect(s.people.E2.quit?.why).toBe('own');
    const id = `E${people + 1}`;
    while (!s.people[id]) apply(d, s, { kind: 'advance', seconds: HOUR });
    const p = s.people[id];
    expect(p.role).toBe('role.driver');
    expect(p.also).toEqual(['role.storekeeper']);
    // сразу — задачи изучить строки своей роли и смежной
    const studies = Object.values(s.tasks).filter(t => t.kind === 'train' && t.trainee === id);
    expect(studies.map(t => codeOf(t.doc!)).sort()).toEqual([...rowsOf(d, p)].sort());
    // часть без заместителя — новому по правилу; часть с уходящим — пока у него: он ещё работает
    expect(s.people.E1.away![1].deputy).toBe(id);
    expect(s.people.E1.away![0].deputy).toBe('E2');
    // ушёл — его часть следующему по правилу, теперь есть кому
    apply(d, s, { kind: 'advance', seconds: at(ymd(2027, 10, 1), 1) - s.t });
    expect(s.former.E2).toBeDefined();
    expect(s.people.E1.away![0].deputy).toBe(id);
    // в дни второй части работу кладовщика — проверку фуры, приёмку, передачу комплекта в шлюз — берёт новый водитель
    const keepers: string[] = [];
    let leave = 0;
    while (s.t < at(ymd(2027, 11, 29), 0)) {
      apply(d, s, { kind: 'advance', seconds: HOUR });
      if (today(s) < ymd(2027, 11, 15)) continue;
      for (const t of Object.values(s.tasks)) {
        if (t.roles.length !== WMS.keepers.length || t.roles[0] !== WMS.keepers[0]) continue;
        if (t.state === 'busy') keepers.push(...t.people);
        else if (t.why === 'leave') leave++;
      }
    }
    expect(check(d, s)).toEqual([]);
    expect(keepers.length).toBeGreaterThan(0);
    expect(new Set(keepers)).toEqual(new Set([id]));
    expect(leave).toBe(0);
  }, 120_000);
});

describe('обучить смежной профессии', () => {
  test('частям людей роли без заместителя — первый свободный по правилу с завтрашнего дня; часть с заместителем — как есть', () => {
    const d = structuredClone(db) as ContentDb;
    for (const r of Object.values(d.scenarios[SC].labor!.roles)) r.quit = 0;
    const s = newPlant(d, { scenario: SC });
    apply(d, s, { kind: 'advance', seconds: at(start + 2, 10) - s.t });
    const z = today(s);
    // кладовщик: идёт часть без заместителя, впереди — ещё одна без него и одна с водителем
    s.people.E1.away = [
      { id: 'A1', y: 2027, from: z - 1, to: z + 12, days: 14 },
      { id: 'A2', y: 2027, from: ymd(2027, 11, 15), to: ymd(2027, 11, 28), days: 14 },
      { id: 'A3', y: 2027, from: ymd(2027, 12, 6), to: ymd(2027, 12, 19), days: 14, deputy: 'E2' },
    ];
    // водитель в отпуске в дни второй части: заместитель ей — не он
    s.people.E2.away = [{ id: 'A4', y: 2027, from: ymd(2027, 11, 8), to: ymd(2027, 11, 21), days: 14 }];
    s.next.A = 4;
    expect(apply(d, s, { kind: 'also', person: 'E5', role: 'role.storekeeper', on: true })).toEqual([]);
    const [a1, a2, a3] = s.people.E1.away;
    // идёт: до сегодня — без заместителя (история для доплаты), с завтра — водитель: первый по табельному номеру
    expect(a1.deputy).toBe('E2');
    expect(a1.prev).toEqual([['', z]]);
    expect(a2.deputy).toBe('E5');
    expect(a2.prev).toBeUndefined();
    expect(a3.deputy).toBe('E2');
    // снять — части, где он заместитель этой роли, следующему по правилу; нет такого — без заместителя
    expect(apply(d, s, { kind: 'also', person: 'E5', role: 'role.storekeeper', on: false })).toEqual([]);
    expect(s.people.E1.away[1].deputy).toBeUndefined();
  });
});
