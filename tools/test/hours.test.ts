// Рабочее время по закону (Б4а; docs/specs/2026-10-vertical-slice.md, «Проверки Б4а»): производственный календарь 2027
// года, смены, коллеги и фуры по нему; правило задачи — «нет часов»; пределы сверхурочных за смену и за год; политика
// отдела и чужой пост; табель против задач; оплата ночных и сверхурочных часов на примере; сборщик базы.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacy } from './legacy';
import { db } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { extras } from '../../src/engine/cash';
import { DAY, daysFromCivil, HOUR, isShort, isWorkday, MIN, momentOf, normOf, workdaysIn } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { fitsIn, sheetDays } from '../../src/engine/hours';
import { check } from '../../src/engine/invariants';
import { planOf } from '../../src/engine/plant';
import { shiftEndAt } from '../../src/engine/staff';
import { addTask } from '../../src/engine/tasks';
import type { Notice, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { buildDb } from '../content/load';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const pr = db.profiles[sc.profile];
const ot = pr.payroll.overtime;
const cal = calOf(db, { start: sc.start.date, scenario: SC });
const z = (y: number, m: number, d: number) => daysFromCivil({ y, m, d });
const start = z(sc.start.date.y, sc.start.date.m, sc.start.date.d);
/** Игровые секунды от начала партии до часа `hour` дня `day`. */
const at = (day: number, hour: number) => (day - start) * DAY + hour * HOUR;
const dayOf = (s: PlantState, t = s.t) => momentOf(s.start, t).day;

function live(base: ContentDb, s: PlantState, until: number, step = HOUR, each?: (n: Notice[]) => void) {
  while (s.t < until) {
    const n = apply(base, s, { kind: 'advance', seconds: Math.min(step, until - s.t) });
    each?.(n);
    const bad = check(base, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
}

describe('производственный календарь', () => {
  test('2027 год: рабочие дни и норма часов по месяцам — как в календаре; короткие дни; переносы', () => {
    expect(Array.from({ length: 12 }, (_, i) => workdaysIn(cal, 2027, i + 1))).toEqual([15, 19, 22, 22, 19, 21, 22, 22, 22, 21, 20, 22]);
    expect(Array.from({ length: 12 }, (_, i) => normOf(cal, 2027, i + 1, pr.calendar.day, pr.calendar.short) / HOUR)).toEqual([120, 151, 176, 175, 152, 167, 176, 176, 176, 168, 159, 176]);
    const short: number[] = [];
    for (let d = z(2027, 1, 1); d <= z(2027, 12, 31); d++) if (isShort(cal, d)) short.push(d);
    expect(short).toEqual([z(2027, 2, 20), z(2027, 4, 30), z(2027, 6, 11), z(2027, 11, 3)]);
    // 5 ноября и 31 декабря — перенесённые выходные; суббота 20 февраля — рабочая, понедельник 22-го — выходной
    const days = [z(2027, 11, 4), z(2027, 11, 5), z(2027, 12, 31), z(2027, 12, 30), z(2027, 2, 20), z(2027, 2, 22)];
    expect(days.map(d => isWorkday(cal, d))).toEqual([false, false, false, true, true, false]);
  });

  test('год без постановления (2028): только перенос по ч. 2 ст. 112 — суббота 4 ноября на понедельник 6-го', () => {
    expect([isWorkday(cal, z(2028, 11, 3)), isWorkday(cal, z(2028, 11, 6)), isWorkday(cal, z(2028, 11, 7))]).toEqual([true, false, true]);
    expect(isShort(cal, z(2028, 11, 3))).toBe(true);
    // январские, совпавшие с выходными, не переносятся: 10 января 2028 года — рабочий понедельник
    expect(isWorkday(cal, z(2028, 1, 10))).toBe(true);
  });

  test('смены 5/2: 4 и 5 ноября 2027 года их нет, 3 ноября — на час короче', () => {
    const s = { start: sc.start.date, scenario: SC };
    expect(shiftEndAt(db, s, { shift: 'shift.a' }, at(z(2027, 11, 3), 8))).toBe(at(z(2027, 11, 3), 14));
    expect(shiftEndAt(db, s, { shift: 'shift.b' }, at(z(2027, 11, 3), 16))).toBe(at(z(2027, 11, 3), 22));
    expect(shiftEndAt(db, s, { shift: 'shift.day' }, at(z(2027, 11, 3), 9))).toBe(at(z(2027, 11, 3), 16));
    expect(shiftEndAt(db, s, { shift: 'shift.a' }, at(z(2027, 11, 4), 8))).toBeUndefined();
    expect(shiftEndAt(db, s, { shift: 'shift.day' }, at(z(2027, 11, 5), 9))).toBeUndefined();
    expect(shiftEndAt(db, s, { shift: 'shift.a' }, at(z(2027, 11, 8), 8))).toBe(at(z(2027, 11, 8), 15));
  });
});

describe('праздники на заводе', () => {
  // завод с 2 ноября 2027 года: 4 и 5 ноября коллеги не заказывают, фуры не приходят, заказов покупателей нет
  const nov: ContentDb = structuredClone(db);
  nov.scenarios[SC].start = { ...sc.start, date: { y: 2027, m: 11, d: 2 } };
  const s = newPlant(nov, { scenario: SC });
  live(nov, s, (z(2027, 11, 9) - z(2027, 11, 2)) * DAY);
  const holiday = (d: number) => d === z(2027, 11, 4) || d === z(2027, 11, 5);

  test('коллеги снабжения и планирования, фуры поставщиков и покупателей, заказы — не в праздник', () => {
    const pos = Object.values(s.pos).filter(po => po.by === 'head:supply');
    expect(pos.length).toBeGreaterThan(0);
    for (const po of Object.values(s.pos)) expect(holiday(dayOf(s, po.eta))).toBe(false);
    for (const po of pos) expect(holiday(dayOf(s, po.ordered))).toBe(false);
    const orders = Object.values(s.batches).filter(b => b.by === 'head:plan');
    expect(orders.length).toBeGreaterThan(0);
    for (const b of orders) expect(holiday(dayOf(s, b.ordered))).toBe(false);
    for (const o of Object.values(s.orders)) {
      expect(holiday(dayOf(s, o.placed))).toBe(false);
      expect(holiday(dayOf(s, o.due))).toBe(false);
    }
    for (const h of Object.values(s.shipments)) expect(holiday(dayOf(s, h.t))).toBe(false);
  });

  test('в праздник никто не работает в смену: в табеле — выходной', () => {
    for (const p of Object.values(s.people)) {
      for (const d of [z(2027, 11, 4), z(2027, 11, 5)]) {
        const row = sheetDays(nov, s, p, d, d)[0];
        expect(row.work - row.off).toBe(0);
      }
    }
  });
});

describe('правило задачи', () => {
  test('помещается ли: в остаток смены и сверхурочные; «только закончить начатое» — по норме в смену; учёба — в смену', () => {
    const h = HOUR;
    expect(fitsIn('clean', 'need', 2 * h, 3 * h, 3 * h, 4 * h)).toBe(true);
    expect(fitsIn('clean', 'need', 2 * h, 3 * h, 3 * h, 0)).toBe(false);
    expect(fitsIn('stage', 'finish', 2 * h, 2 * h, 3 * h, 4 * h)).toBe(true);
    expect(fitsIn('stage', 'finish', 2 * h, 2.5 * h, 3 * h, 4 * h)).toBe(false);
    expect(fitsIn('train', 'need', 2 * h, 3 * h, 3 * h, 4 * h)).toBe(false);
  });

  /** Тихий завод прежней жизни без серий и заказов: аппаратчики свободны; уборка — в помещении грануляции. */
  const quiet: ContentDb = structuredClone(legacy);
  quiet.scenarios[SC] = { ...quiet.scenarios[SC], batches: [], orders: [] };
  for (const c of Object.values(quiet.customers)) c.demand = {};
  const plan = planOf(quiet, sc.plant);
  const room = plan.plant.rooms.find(r => r.type === 'granulation')!.id;
  const clean = (s: PlantState) => addTask(s, { kind: 'clean', roles: ['role.operator'], from: { kind: 'point', ...plan.room[room] }, work: 3 * HOUR, prio: 0, room });

  test('работа не помещается ни у кого — ждёт «нет часов», в следующую смену её берут', () => {
    const s = newPlant(quiet, { scenario: SC });
    // 13:00 рабочего четверга: у первой смены 2 ч до конца, сверхурочных года не осталось
    const thu = z(2027, 9, 2);
    live(quiet, s, at(thu, 13));
    for (const p of Object.values(s.people)) if (p.role === 'role.operator') p.otYear = { y: 2027, sec: ot.year };
    const t = clean(s);
    live(quiet, s, at(thu, 14), MIN);
    expect(s.tasks[t.id]?.state).toBe('open');
    expect(s.tasks[t.id]?.why).toBe('hours');
    // в 15:00 приходит вторая смена: у неё 8 ч смены — работа помещается
    live(quiet, s, at(thu, 15) + 5 * MIN, MIN);
    expect(s.tasks[t.id]?.state).toBe('busy');
    expect(s.people[s.tasks[t.id]!.people[0]].shift).toBe('shift.b');
  });

  test('«только закончить начатое»: работа длиннее остатка смены ждёт, «по потребности» — её берут со сверхурочными', () => {
    for (const mode of ['finish', 'need'] as const) {
      const s = newPlant(quiet, { scenario: SC });
      const thu = z(2027, 9, 2);
      live(quiet, s, at(thu, 13));
      apply(quiet, s, { kind: 'overtime', dept: 'mes', mode });
      const t = clean(s);
      // раздатчик смотрит в начале часа: в 14:00 до конца смены час, сверхурочных можно 4 ч
      live(quiet, s, at(thu, 14) + 5 * MIN, MIN);
      expect(s.tasks[t.id]?.state).toBe(mode === 'finish' ? 'open' : 'busy');
      if (mode === 'need') {
        // кончил после смены — в табель отрезок сверхурочных, за год — столько же
        const p = s.people[s.tasks[t.id]!.people[0]];
        live(quiet, s, at(thu, 18), MIN);
        expect(p.ot.length).toBe(1);
        const [a, b] = p.ot[0];
        expect(a).toBe(at(thu, 15));
        expect(b - a).toBeGreaterThan(HOUR);
        expect(b - a).toBeLessThanOrEqual(ot.shift);
        expect(p.otYear).toEqual({ y: 2027, sec: b - a });
      }
    }
  });

  test('политика чужого поста — отказ; своего — меняется', () => {
    const s = newPlant(quiet, { scenario: SC });
    apply(quiet, s, { kind: 'seat', seats: ['quality'] });
    expect(apply(quiet, s, { kind: 'overtime', dept: 'mes', mode: 'finish', by: 'player' })).toEqual([{ kind: 'refused', cmd: 'overtime', why: 'notYours', detail: 'production' }]);
    expect(s.policy.mes).toBe('need');
    expect(apply(quiet, s, { kind: 'overtime', dept: 'qc', mode: 'finish', by: 'player' })).toEqual([]);
    expect(s.policy.qc).toBe('finish');
  });
});

describe('сверхурочные на заводе', () => {
  // золотой сценарий: 40 суток по минутам — после смены остаются, только кончая задачу, взятую в смену
  const s = newPlant(db, { scenario: SC });
  let sampled = 0;
  const seen = new Set<string>();
  const end = s.t + 40 * DAY;
  live(db, s, end, 10 * MIN, () => {
    for (const p of Object.values(s.people)) {
      if (p.task && p.until !== undefined && s.t > p.until) sampled++;
      for (const [a] of p.ot) seen.add(`${p.id}:${a}`);
    }
  });

  test('отрезок — не длиннее предела за смену, за год — не больше предела; табель сходится с задачами', () => {
    let recorded = 0;
    for (const p of Object.values(s.people)) {
      for (const [a, b] of p.ot) {
        expect(b - a).toBeLessThanOrEqual(ot.shift);
        recorded += b - a;
      }
      expect(p.otYear.sec).toBeLessThanOrEqual(ot.year);
    }
    // по пробам раз в 10 минут: занятые после конца смены — те же часы, что в табеле, с точностью до шага на отрезок
    expect(recorded).toBeGreaterThan(0);
    expect(Math.abs(sampled * 10 * MIN - recorded)).toBeLessThanOrEqual(seen.size * 10 * MIN);
  });

  test('«только закончить начатое»: после смены остаются лишь со стадией, которая длится дольше нормы', () => {
    const f = newPlant(db, { scenario: SC });
    for (const d of ['wms', 'qc', 'qa', 'mes', 'line', 'maint'] as const) apply(db, f, { kind: 'overtime', dept: d, mode: 'finish' });
    live(db, f, f.t + 30 * DAY, 10 * MIN, () => {
      for (const p of Object.values(f.people)) {
        if (!p.task || p.until === undefined || f.t <= p.until) continue;
        const t = f.tasks[p.task];
        expect(t.kind).toBe('stage');
        expect(t.times![4] - t.times![1]).toBeGreaterThan(t.norm![0]);
      }
    });
  }, 120_000);
});

describe('оплата по табелю на примере', () => {
  test('сверхурочные — первые 2 ч полуторные, дальше двойные (ст. 152); ночью — ещё 20 % ставки (ст. 154)', () => {
    const s = newPlant(db, { scenario: SC });
    const p = Object.values(s.people).find(x => x.role === 'role.operator' && x.shift === 'shift.b')!;
    const salary = db.roles[p.role].salary;
    const norm = normOf(cal, 2027, 9, pr.calendar.day, pr.calendar.short);
    // вторник 14 сентября: смена 15:00–23:00, после неё — до 02:30 в среду (рабочий день): 3,5 ч сверхурочно
    p.ot = [[at(z(2027, 9, 14), 23), at(z(2027, 9, 15), 2) + 30 * MIN]];
    const share = (sec: number, rate: number) => Math.floor((Math.floor((salary * sec) / norm) * rate) / 10000);
    const day14 = extras(db, s, p, 2027, 9, 14, 14);
    const day15 = extras(db, s, p, 2027, 9, 15, 15);
    // 14-го: час сверхурочно — первая ставка; ночью — час смены и час после неё
    expect(day14.over).toBe(share(HOUR, 15000));
    expect(day14.night).toBe(share(2 * HOUR, 2000));
    // 15-го: ещё час по первой ставке (первые 2 ч отрезка), полтора — по второй; ночью — 2,5 ч после полуночи и час
    // смены
    expect(day15.over).toBe(share(HOUR, 15000) + share(1.5 * HOUR, 20000));
    expect(day15.night).toBe(share(3.5 * HOUR, 2000));
    expect(day14.off + day15.off).toBe(0);
  });

  test('после смены в пятницу за полночь — работа в выходной (РВ, ст. 153): двойная ставка сверх месячной нормы', () => {
    const s = newPlant(db, { scenario: SC });
    const p = Object.values(s.people).find(x => x.role === 'role.operator' && x.shift === 'shift.b')!;
    const salary = db.roles[p.role].salary;
    const norm = normOf(cal, 2027, 9, pr.calendar.day, pr.calendar.short);
    p.ot = [[at(z(2027, 9, 17), 23), at(z(2027, 9, 18), 1)]];
    const share = (sec: number, rate: number) => Math.floor((Math.floor((salary * sec) / norm) * rate) / 10000);
    const sat = extras(db, s, p, 2027, 9, 18, 18);
    expect(sat.off).toBe(share(HOUR, pr.payroll.holiday.beyond));
    expect(sat.over).toBe(0);
    expect(extras(db, s, p, 2027, 9, 17, 17).over).toBe(share(HOUR, 15000));
  });
});

describe('сборщик базы — на испорченной копии content/', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  function broken(edits: Record<string, [string, string][]>): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'pharma-content-'));
    dirs.push(dir);
    cpSync(join(import.meta.dir, '../../content'), dir, { recursive: true });
    for (const [file, e] of Object.entries(edits)) {
      const p = join(dir, file);
      let text = readFileSync(p, 'utf8');
      for (const [a, b] of e) {
        expect(text.includes(a)).toBe(true);
        text = text.replace(a, b);
      }
      writeFileSync(p, text);
    }
    return buildDb(dir).errors;
  }
  const has = (errors: string[], part: string) => expect(errors.some(e => e.includes(part))).toBe(true);
  const PRF = 'profiles/eaeu.yaml';

  test('праздник, которого не бывает; перенос в другой год, не с выходного или на праздник', () => {
    has(broken({ [PRF]: [['[11, 4]]', '[11, 31]]']] }), 'праздника 31.11 не бывает');
    has(broken({ [PRF]: [['[2027-01-03, 2027-12-31]', '[2027-01-03, 2028-01-10]']] }), 'перенос 2027-01-03 → 2028-01-10 — в другой год');
    has(broken({ [PRF]: [['[2027-02-20, 2027-02-22]', '[2027-02-19, 2027-02-22]']] }), 'перенос 2027-02-19 → 2027-02-22 — не с выходного');
    has(broken({ [PRF]: [['[2027-02-20, 2027-02-22]', '[2027-02-20, 2027-02-23]']] }), 'перенос 2027-02-20 → 2027-02-23 — не на будний день или на праздник');
  });

  test('документ, который изучать дольше самой короткой смены графиков: учатся только в смену (Б4б — любой график)', () => {
    has(broken({ 'sops/gmp.yaml': [['hours: 4', 'hours: 9']] }), 'sop.gmp: изучение 9 ч длиннее самой короткой смены графиков (8 ч) — в таком графике обучение никто не начнёт');
  });

  test('стадия, которую по норме или наибольшей длительности не начать ни в одну смену её роли', () => {
    // сушка: 2 загрузки по 90 мин — по 300 мин, это 10 ч 10 мин по норме
    has(broken({ 'recipes/paracetamol500.wet.v1.yaml': [['perLoad: 90, loads: 2', 'perLoad: 300, loads: 2']] }), 'стадию никто не начнёт');
    // по норме 7 ч 10 мин — в смену, а с разбросом 30 % — 20 ч 10 мин, длиннее смены со сверхурочными
    has(broken({ 'recipes/paracetamol500.wet.v1.yaml': [['perLoad: 90, loads: 2, spread: 5', 'perLoad: 210, loads: 2, spread: 30']] }), 'наибольшая длительность');
  });
});
