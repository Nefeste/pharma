// Виды Б6б (docs/specs/2026-10-vertical-slice.md, «Б6б», «Проверки Б6б»): план запуска — позиции плана выпуска строками,
// 31 сутки с сегодняшних, задания по «не раньше» с черновиком, пунктир правила начальника отдела планирования, визиты
// подрядчика к оборудованию стадий и машинам линии, нерабочие дни; «Поставить сейчас» — строка черновика, после
// «Утвердить» — задание на этот день; блок планёрки — вчера по отделам с тем, кого ждали, и сегодня; строки суток у полосы
// и в карточке, «после суток» — по записям завода; полей истины нет.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR, isWorkday, momentOf } from '../../src/engine/core/calendar';
import { waitedFor } from '../../src/engine/daily';
import { apply, MORNING, newPlant } from '../../src/engine/engine';
import { planOf } from '../../src/engine/plant';
import { launchPlan } from '../../src/engine/planner';
import type { PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { dailyMarks, dailyMeeting, deptSum } from '../../src/sim/daily';
import { LAUNCH_DAYS, launchView } from '../../src/sim/launch';
import { ganttView } from '../../src/sim/plan';
import { morningView } from '../../src/sim/report';
import { type CardView, viewOf } from '../../src/sim/views';
import { freshOf, ordersOf } from '../../src/ui/draft';

const SC = 'scn.proto';

/** Завод игры в миг `day` суток и `sec` секунд. */
function at(day: number, sec: number): PlantState {
  const s = newPlant(db, { scenario: SC });
  apply(db, s, { kind: 'advance', seconds: day * DAY + sec - s.t });
  return s;
}

/** Ключи вида — все, на любой глубине. */
function keysOf(x: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) for (const y of x) keysOf(y, out);
  else if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) out.add(k), keysOf(y, out);
  return out;
}

const TRUTH = ['truth', 'noise', 'causes', 'budget', 'wear', 'size', 'root', 'done'];

describe('план запуска', () => {
  const s = at(30, 10 * HOUR);
  const v = launchView(db, s);
  const today = momentOf(s.start, s.t).day;

  test('строки — позиции плана; дни — 31 с сегодняшнего; нерабочие — по календарю; задания — по «не раньше»; пунктир — правило', () => {
    expect(v.skus.map(x => x.sku)).toEqual(db.scenarios[SC].plan!.items.map(i => i.sku));
    expect(v.from).toBe(today);
    expect(v.days).toBe(LAUNCH_DAYS);
    const cal = calOf(db, s);
    const off: number[] = [];
    for (let d = today; d < today + LAUNCH_DAYS; d++) if (!isWorkday(cal, d)) off.push(d);
    expect(v.off).toEqual(off);
    const want = Object.values(s.batches)
      .filter(b => b.status !== 'cancelled')
      .filter(b => momentOf(s.start, b.notBefore).day >= today && momentOf(s.start, b.notBefore).day < today + LAUNCH_DAYS)
      .map(b => b.id)
      .sort();
    expect(v.jobs.map(j => j.batch).sort()).toEqual(want);
    for (const j of v.jobs) expect(j.day).toBe(momentOf(s.start, s.batches[j.batch].notBefore).day);
    expect(v.rule).toEqual(launchPlan(db, s, (today + LAUNCH_DAYS - momentOf(s.start, 0).day) * DAY));
    expect(v.rule.length).toBeGreaterThan(5);
    for (const x of v.visits) {
      expect(['equipment', 'machine']).toContain(s.assets[x.asset].family);
      expect(x.day).toBeGreaterThanOrEqual(today);
      expect(x.day).toBeLessThan(today + LAUNCH_DAYS);
    }
  });

  test('черновик: срочное задание на день пунктира занимает его, отмена освобождает, сдвиг переносит', () => {
    const x = v.rule[0];
    const w = launchView(db, s, [], freshOf([{ recipe: x.recipe, sku: x.sku, at: x.at }]));
    expect(w.jobs.some(j => j.fresh && j.day === x.day && j.sku === x.sku && j.notBefore === x.at)).toBe(true);
    expect(w.rule.some(r => r.day === x.day)).toBe(false);
    // отмена задания на запас: его день свободен, а позиция держится до его «не раньше» (Б6а)
    const b = Object.values(s.batches).find(z => z.status === 'waiting' || z.status === 'reserved')!;
    const day = momentOf(s.start, b.notBefore).day;
    const d = launchView(db, s, [], [], [b.id]);
    expect(d.jobs.find(j => j.batch === b.id)?.drop).toBe(true);
    expect(d.rule).toEqual(launchPlan(db, s, (today + LAUNCH_DAYS - momentOf(s.start, 0).day) * DAY, { drop: [b.id] }));
    for (const r of d.rule.filter(z => z.sku === b.sku)) expect(r.on).toBeGreaterThanOrEqual(day);
    // сдвиг: день задания — новый
    const to = b.notBefore + 2 * DAY;
    const m = launchView(db, s, [{ batch: b.id, notBefore: to }]);
    const j = m.jobs.find(z => z.batch === b.id);
    if (momentOf(s.start, to).day < today + LAUNCH_DAYS) expect(j?.day).toBe(momentOf(s.start, to).day);
    expect(j?.moved).toBe(true);
  });

  test('«Поставить сейчас» и «Утвердить» — задание на этот день, его день правило больше не ставит', () => {
    const t: PlantState = structuredClone(s);
    apply(db, t, { kind: 'seat', seats: ['production'] });
    const x = launchView(db, t).rule.find(r => r.on > today + 1)!;
    const before = new Set(Object.keys(t.batches));
    for (const c of ordersOf([{ recipe: x.recipe, sku: x.sku, at: x.at }])) apply(db, t, c);
    const made = Object.values(t.batches).filter(b => !before.has(b.id));
    expect(made.map(b => [b.sku, b.notBefore, b.by])).toEqual([[x.sku, x.at, 'player']]);
    const after = launchView(db, t);
    expect(after.jobs.some(j => j.batch === made[0].id && j.day === x.day && !j.fresh)).toBe(true);
    expect(after.rule.some(r => r.day === x.day)).toBe(false);
  }, 60_000);

  test('отдел планирования «вручную» — пунктира нет', () => {
    const t: PlantState = structuredClone(s);
    apply(db, t, { kind: 'seat', seats: ['production'] });
    apply(db, t, { kind: 'mode', head: 'plan', mode: 'manual', by: 'player' });
    const w = launchView(db, t);
    expect(w.manual).toBe(true);
    expect(w.rule).toEqual([]);
    expect(w.jobs.length).toBe(v.jobs.length);
  });

  test('во вкладке — только с её флагом; без истины', () => {
    const q = { view: 'gantt' as const, from: s.t, to: s.t + 3 * DAY };
    expect(ganttView(db, s, q).launch).toBeUndefined();
    const g = ganttView(db, s, { ...q, launch: true });
    expect(g.launch).toEqual(v);
    for (const j of v.jobs) expect(g.batches[j.batch]).toBeDefined();
    const keys = keysOf(v);
    const ALLOWED = new Set('from days skus sku recipe jobs batch day notBefore due goal kind order customer status fresh moved drop rule on at manual visits asset work booked off'.split(' '));
    expect([...keys].filter(k => !ALLOWED.has(k))).toEqual([]);
    for (const k of TRUTH) expect(keys.has(k)).toBe(false);
  });
});

describe('задания на сутки в окне', () => {
  const s = at(45, MORNING + 20 * 60);
  const day = momentOf(s.start, s.t).day;
  const at8 = s.t - 20 * 60;

  test('планёрка: вчера — итог отделов и кого ждали, строки раскрываются; сегодня — строки задания', () => {
    const m = morningView(db, s, { view: 'morning', day });
    expect(m.daily).toEqual(dailyMeeting(db, s, at8));
    const y = s.planning.daily!.find(d => d.from === at8 - DAY)!;
    expect(m.daily.yday!.from).toBe(y.from);
    expect(m.daily.yday!.rows.length).toBe(y.rows.length);
    for (const x of m.daily.yday!.depts) {
      expect(x).toEqual(deptSum(y, x.dept));
      expect(x.done).toBe(x.ok + x.late);
      expect(x.ok + x.late + x.no).toBe(x.n);
    }
    const t = s.planning.daily!.find(d => d.from === at8)!;
    expect(m.daily.today!.rows.length).toBe(t.rows.length);
    expect(m.daily.today!.depts.reduce((n, x) => n + x.n, 0)).toBe(t.rows.length);
    // кого ждали — тот же отдел, что по строкам
    for (const r of m.daily.yday!.rows) if (r.why) expect(r.waited).toBe(waitedFor(r));
  });

  test('итог отдела: главное «ждали» — отдел с наибольшим ожиданием строк «позже» и «не сделано»', () => {
    let seen = 0;
    for (const d of s.planning.daily!.filter(x => x.closed)) {
      for (const dept of new Set(d.rows.map(r => r.dept))) {
        const x = deptSum(d, dept);
        if (!x.main) continue;
        seen++;
        const by = new Map<string, number>();
        for (const r of d.rows.filter(z => z.dept === dept && z.res !== 'ok' && z.why)) {
          const who = waitedFor(r) ?? 'own';
          by.set(who, (by.get(who) ?? 0) + Math.max(0, (r.res === 'late' ? r.done! : d.from + DAY) - r.at));
        }
        expect(x.main.sec).toBe(Math.max(...by.values()));
        expect(by.get(x.main.who)).toBe(x.main.sec);
      }
    }
    expect(seen).toBeGreaterThan(5);
  });

  test('у полосы — строка задания и итог; после суток — по записям завода', () => {
    const g = ganttView(db, s, { view: 'gantt', from: s.t - 3 * DAY, to: s.t + DAY });
    expect(g.daily).toEqual(dailyMarks(db, s, s.t - 3 * DAY, s.t + DAY));
    expect(g.daily.length).toBeGreaterThan(5);
    for (const mk of g.daily) {
      const task = s.planning.daily!.find(d => d.from === mk.from)!;
      const r = task.rows.find(x => x.batch === mk.batch && x.kind === mk.kind && x.stage === mk.stage && !!x.pack === !!mk.pack)!;
      expect(r).toBeDefined();
      expect(mk.res).toBe(r.res);
      if (mk.after !== undefined) {
        expect(r.res).toBe('no');
        expect(mk.after).toBeGreaterThanOrEqual(task.from + DAY);
      }
    }
    // «после суток»: не сделанная в сутки стадия, начатая позже, — со своим началом по досье
    const late = s.planning.daily!.filter(d => d.closed).flatMap(d => d.rows.map(r => ({ d, r }))).find(({ r }) => r.kind === 'stage' && r.res === 'no' && s.batches[r.batch!].records.some(x => x.stage === r.stage));
    if (late) {
      const mk = dailyMarks(db, s, late.d.from, late.d.from + DAY).find(x => x.batch === late.r.batch && x.stage === late.r.stage && x.from === late.d.from)!;
      expect(mk.after).toBe(s.batches[late.r.batch!].records.find(x => x.stage === late.r.stage)!.start);
    }
  });

  test('карточка помещения и машины линии — строки сегодняшнего задания', () => {
    const plan = planOf(db, s.plan).plant;
    const cur = s.planning.daily!.at(-1)!;
    const stage = cur.rows.find(r => r.kind === 'stage');
    if (stage) {
      const i = plan.rooms.findIndex(r => r.id === stage.room);
      const c = (viewOf(db, s, { id: 'c', view: 'card', thing: { kind: 'room', i } }) as CardView).card;
      expect(c.kind).toBe('room');
      if (c.kind === 'room') {
        expect(c.daily!.length).toBeGreaterThan(0);
        for (const r of c.daily!) expect(r.room === stage.room || r.kind === 'test').toBe(true);
      }
    }
    const c = (viewOf(db, s, { id: 'c', view: 'card', thing: { kind: 'machine', line: 0, k: 0 } }) as CardView).card;
    if (c.kind === 'machine') for (const r of c.daily ?? []) expect(r.line).toBe(plan.lines[0].id);
    // лаборатория: испытания на её приборах
    const lab = plan.rooms.findIndex(r => Object.values(s.instruments).some(x => x.room === r.id));
    const l = (viewOf(db, s, { id: 'c', view: 'card', thing: { kind: 'room', i: lab } }) as CardView).card;
    if (l.kind === 'room') expect((l.daily ?? []).length).toBe(cur.rows.filter(r => r.kind === 'test' && Object.values(s.instruments).some(x => x.room === plan.rooms[lab].id && x.type === db.tests[s.tests[r.test!].method].inst)).length);
  });

  test('без истины: ключи строк — только описанные', () => {
    const m = dailyMeeting(db, s, at8);
    const keys = keysOf([m, dailyMarks(db, s, s.t - 3 * DAY, s.t + DAY)]);
    const ALLOWED = new Set(
      'yday today from depts rows dept n ok late no main who why sec kind at res waited after batch code pack stage room line order customer po supplier test method lot part machine asset dev thing i k'.split(' '),
    );
    // начало строки — «done» записи суток: у вида это мгновение начала, не истина
    ALLOWED.add('done');
    expect([...keys].filter(k => !ALLOWED.has(k))).toEqual([]);
    for (const k of TRUTH.filter(x => x !== 'done')) expect(keys.has(k)).toBe(false);
  });
});
