// Сменно-суточное задание и план запуска (Б6б; docs/specs/2026-10-vertical-slice.md, «Б6б», «Проверки Б6б»): в 08:00 у
// отделов — строки по прогону расписания, норме мастера линии и очередям этого мига, у ОКК — не больше часов аналитиков; в
// следующие 08:00 — итог по записям и чего ждали; правила задание не читают — жизнь завода та же; образец прежней схемы
// начинает задания с пустых; копия прогона плана их не ставит. План запуска: первая строка в 06:00 рабочего дня — то
// задание, что начальник отдела планирования поставит в 07:00; день с заданием правило пропускает; «вручную» — пусто.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../../src/content';
import { DAY, HOUR, isWorkday, momentOf } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { DAILY_KEEP, ON_TIME } from '../../src/engine/daily';
import { dueOf } from '../../src/engine/devclass';
import { apply, MORNING, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { QC } from '../../src/engine/lab';
import { forecast } from '../../src/engine/plan/schedule';
import { runSeed } from '../../src/engine/plan/run';
import { launchPlan } from '../../src/engine/planner';
import { fromSave } from '../../src/engine/save';
import { spanOn } from '../../src/engine/shifts';
import type { DailyRow, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';

const SC = 'scn.proto';

/** Завод игры в миг `day` суток и `sec` секунд. */
function at(day: number, sec: number): PlantState {
  const s = newPlant(db, { scenario: SC });
  apply(db, s, { kind: 'advance', seconds: day * DAY + sec - s.t });
  return s;
}

const DEPT: Record<DailyRow['kind'], DailyRow['dept']> = { kit: 'wms', ship: 'wms', truck: 'wms', stage: 'mes', pack: 'line', test: 'qc', repair: 'maint', visit: 'maint', release: 'qa', assess: 'qa' };

const PHASES = new Set(['plan', 'materials', 'kitting', 'people', 'room', 'cleaning', 'equipment', 'repair', 'work', 'lab', 'line', 'packing', 'decision', 'asset', 'before']);

describe('сменно-суточное задание', () => {
  test('в 08:00 — производство и комплектовка по прогону расписания на сутки, отгрузки и фуры дня', () => {
    const s = at(22, MORNING);
    const cur = s.planning.daily!.at(-1)!;
    expect(cur.from).toBe(s.t);
    expect(cur.closed).toBeUndefined();
    const t1 = s.t + DAY;
    const key = (b: { kind: string; batch?: string; stage?: string; from: number }) => `${b.kind}/${b.batch}/${b.kind === 'stage' ? b.stage : ''}/${b.from}`;
    const want = forecast(db, s, [], [], [], t1)
      .bars.filter(b => b.when === 'plan' && b.batch && b.from >= s.t && b.from < t1 && (b.kind === 'kit' || b.kind === 'stage'))
      .map(key)
      .sort();
    const got = cur.rows.filter(r => r.kind === 'kit' || r.kind === 'stage').map(r => key({ ...r, from: r.at })).sort();
    expect(got).toEqual(want);
    expect(got.length).toBeGreaterThan(0);
    for (const r of cur.rows) expect(r.dept).toBe(DEPT[r.kind]);
    // горизонт: прогон без него ставит то же в эти сутки
    const full = forecast(db, s).bars.filter(b => b.when === 'plan' && b.batch && b.from >= s.t && b.from < t1 && (b.kind === 'kit' || b.kind === 'stage'));
    expect(full.map(key).sort()).toEqual(want);
    // отгрузки — заказы со сроком в сутки; фуры — заказы поставщикам с приходом в сутки
    const ships = Object.values(s.orders).filter(o => o.status === 'open' && o.due >= s.t && o.due < t1).map(o => o.id).sort();
    expect(cur.rows.filter(r => r.kind === 'ship').map(r => r.order!).sort()).toEqual(ships);
    const trucks = Object.values(s.pos).filter(p => p.status === 'ordered' && p.eta >= s.t && p.eta < t1).map(p => p.id).sort();
    expect(cur.rows.filter(r => r.kind === 'truck').map(r => r.po!).sort()).toEqual(trucks);
  });

  test('упаковка — задания линии по её порядку и норме мастера; ООК — решения по сериям и оценки со сроком в сутки', () => {
    const s = newPlant(db, { scenario: SC });
    let packs = 0;
    for (let d = 10; d <= 40; d++) {
      apply(db, s, { kind: 'advance', seconds: d * DAY + MORNING - s.t });
      const cur = s.planning.daily!.at(-1)!;
      const rows = cur.rows.filter(r => r.kind === 'pack');
      packs += rows.length;
      // взятое линией задание — первое; дальше — по порядку серий, как их берёт линия
      const order = Object.values(s.batches).filter(b => b.status === 'packing').map(b => b.id);
      const taken = Object.values(s.lines).map(l => l.batch);
      let last = -1;
      for (const r of rows) {
        expect(s.batches[r.batch!].pack!.start).toBeUndefined();
        expect(r.at).toBeGreaterThanOrEqual(s.t);
        expect(r.at).toBeLessThan(s.t + DAY);
        expect(r.line).toBe(s.batches[r.batch!].pack!.line);
        const i = taken.includes(r.batch) ? -1 : order.indexOf(r.batch!);
        expect(i).toBeGreaterThanOrEqual(last);
        last = i;
      }
      for (let i = 1; i < rows.length; i++) expect(rows[i].at).toBeGreaterThan(rows[i - 1].at);
      for (const r of cur.rows.filter(x => x.kind === 'release')) expect(Object.values(s.tasks).some(t => t.kind === 'qpDecide' && t.batch === r.batch)).toBe(true);
      const due = Object.values(s.deviations).filter(x => x.status === 'open' && dueOf(db, s, x) >= s.t && dueOf(db, s, x) < s.t + DAY);
      expect(cur.rows.filter(r => r.kind === 'assess').map(r => r.dev!).sort()).toEqual(due.map(x => x.id).sort());
    }
    expect(packs).toBeGreaterThan(15);
  }, 60_000);

  test('ОКК: испытания очереди по её порядку и конечной производительности — аналитик в смене и прибор методики', () => {
    const s = newPlant(db, { scenario: SC });
    let n = 0;
    for (let day = 8; day <= 40; day++) {
      apply(db, s, { kind: 'advance', seconds: day * DAY + MORNING - s.t });
      const cur = s.planning.daily!.at(-1)!;
      const z = momentOf(s.start, s.t).day;
      const tests = cur.rows.filter(r => r.kind === 'test');
      n += tests.length;
      const byInst = new Map<string, [number, number][]>();
      for (const r of tests) {
        const q = s.tests[r.test!];
        const m = db.tests[q.method];
        const t = Object.values(s.tasks).find(x => x.kind === 'prep' && x.test === r.test)!;
        expect(r.at).toBeGreaterThanOrEqual(s.t);
        expect(r.at).toBeLessThan(s.t + DAY);
        // в начале — аналитик в смене
        const on = Object.values(s.people).some(p => (QC.analysts as readonly string[]).includes(p.role) && [z - 1, z, z + 1].some(d => {
          const sp = spanOn(db, s, p, d);
          return sp !== undefined && sp[0] <= r.at && r.at < sp[1];
        }));
        expect(on).toBe(true);
        if (m.inst) {
          const xs = byInst.get(m.inst) ?? [];
          xs.push([r.at, r.at + t.work + (m.unattended ? m.run : 0)]);
          byInst.set(m.inst, xs);
        }
      }
      // прибор один — пробы на нём не перекрываются: подготовка и работа без людей
      for (const [type, xs] of byInst) {
        if (Object.values(s.instruments).filter(i => i.type === type).length !== 1) continue;
        xs.sort((a, c) => a[0] - c[0]);
        for (let i = 1; i < xs.length; i++) expect(xs[i][0]).toBeGreaterThanOrEqual(xs[i - 1][1]);
      }
      // невзятые — в порядке очереди раздачи
      const open = s.open.filter(id => s.tasks[id].kind === 'prep').map(id => s.tasks[id].test!);
      const idx = tests.filter(r => open.includes(r.test!)).map(r => open.indexOf(r.test!));
      expect(idx).toEqual([...idx].sort((a, c) => a - c));
    }
    expect(n).toBeGreaterThan(5);
  }, 60_000);

  test('в следующие 08:00 — итог по записям: в срок, позже — в сутки, не сделано; чего ждали — состояние серии или причина', () => {
    const s = at(45, MORNING + HOUR);
    const closed = s.planning.daily!.filter(d => d.closed);
    expect(closed.length).toBeGreaterThan(20);
    expect(s.planning.daily!.length).toBeLessThanOrEqual(DAILY_KEEP);
    let late = 0;
    for (const d of closed)
      for (const r of d.rows) {
        expect(r.res).toBeDefined();
        const by = r.kind === 'release' ? d.from + DAY : r.kind === 'assess' ? r.at : r.at + ON_TIME;
        if (r.res === 'ok') expect(r.done!).toBeLessThanOrEqual(by);
        if (r.res === 'late') {
          late++;
          expect(r.done!).toBeGreaterThan(by);
          expect(r.done!).toBeLessThan(d.from + DAY);
        }
        if (r.res === 'no' && r.kind !== 'ship') expect(r.done === undefined || r.done >= d.from + DAY).toBe(true);
        if (r.why !== undefined && (r.kind === 'kit' || r.kind === 'stage' || r.kind === 'pack')) expect(PHASES.has(r.why)).toBe(true);
      }
    expect(late).toBeGreaterThan(0);
    // стадия в срок — начата не позже часа от плана по досье
    const ok = closed.flatMap(d => d.rows).find(r => r.kind === 'stage' && r.res === 'ok')!;
    const rec = s.batches[ok.batch!].records.find(x => x.stage === ok.stage);
    if (rec) expect(rec.start).toBe(ok.done!);
    expect(check(db, s)).toEqual([]);
  }, 60_000);

  test('правила задание не читают: без заданий — то же состояние завода', () => {
    const a = newPlant(db, { scenario: SC });
    const b = newPlant(db, { scenario: SC });
    delete b.planning.daily;
    apply(db, a, { kind: 'advance', seconds: 21 * DAY });
    apply(db, b, { kind: 'advance', seconds: 21 * DAY });
    const { daily, ...planning } = a.planning;
    expect(daily!.length).toBe(21);
    expect(fingerprint({ ...a, planning })).toBe(fingerprint(b));
  }, 60_000);

  test('образец схемы 39: задания — с первых 08:00 после загрузки; копия прогона плана их не ставит', () => {
    const s = fromSave(db, readFileSync(join(import.meta.dir, 'fixtures/save-v39.json'), 'utf8'));
    expect(s.planning.daily).toEqual([]);
    apply(db, s, { kind: 'advance', seconds: 2 * DAY });
    expect(s.planning.daily!.length).toBe(2);
    expect(check(db, s)).toEqual([]);
    const c = runSeed(db, s, [], { days: 2, seeds: 1 }, 0);
    expect(c.planning.daily).toBeUndefined();
    expect(s.planning.daily!.length).toBe(2);
  }, 60_000);
});

describe('план запуска', () => {
  test('в 06:00 рабочего дня первая строка — задание, которое начальник поставит в 07:00', () => {
    const s = newPlant(db, { scenario: SC });
    const cal = calOf(db, s);
    let same = 0;
    for (let d = 12; d <= 40; d++) {
      apply(db, s, { kind: 'advance', seconds: d * DAY + 6 * HOUR - s.t });
      const day = momentOf(s.start, s.t).day;
      if (!isWorkday(cal, day)) continue;
      const lp = launchPlan(db, s, s.t + 45 * DAY);
      const first = lp[0]?.on === day ? lp[0] : undefined;
      const before = new Set(Object.keys(s.batches));
      apply(db, s, { kind: 'advance', seconds: 90 * 60 });
      const placed = Object.values(s.batches).filter(b => !before.has(b.id) && b.by === 'head:plan');
      if (!first) expect(placed).toEqual([]);
      else {
        expect(placed.map(b => [b.sku, b.notBefore])).toEqual([[first.sku, first.at]]);
        same++;
      }
    }
    expect(same).toBeGreaterThan(10);
  }, 60_000);

  test('на день с заданием правило не ставит; дальше по рабочим дням; «вручную» — пусто', () => {
    const s = at(30, 10 * HOUR);
    const lp = launchPlan(db, s, s.t + 31 * DAY);
    expect(lp.length).toBeGreaterThan(5);
    const taken = new Set(Object.values(s.batches).filter(b => b.status !== 'cancelled').map(b => momentOf(s.start, b.notBefore).day));
    const cal = calOf(db, s);
    for (const x of lp) {
      expect(taken.has(x.day)).toBe(false);
      expect(isWorkday(cal, x.day)).toBe(true);
      expect(x.at).toBeLessThan(s.t + 31 * DAY);
    }
    // день правила — следующий рабочий: час уже прошёл
    expect(lp[0].on).toBeGreaterThan(momentOf(s.start, s.t).day);
    expect(new Set(lp.map(x => x.day)).size).toBe(lp.length);
    apply(db, s, { kind: 'seat', seats: ['production'] });
    apply(db, s, { kind: 'mode', head: 'plan', mode: 'manual', by: 'player' });
    expect(launchPlan(db, s, s.t + 31 * DAY)).toEqual([]);
  }, 60_000);

  test('без записи: состояние то же', () => {
    const s = at(25, 9 * HOUR);
    const was = fingerprint(s);
    launchPlan(db, s, s.t + 31 * DAY);
    expect(fingerprint(s)).toBe(was);
  });
});

