// Часть 3а: посты ожидания (docs/specs/2026-10-panels.md, 3а; развилка #36, вариант 2). У каждой роли сценария — пост на
// проходимом полу, до него дойти от входа; сборка базы ловит пост в стене и внутри машины. Человек без задачи в смене — на
// посту или в пути: на пост, а за 15 минут до конца смены — к выходу; вне смены его на заводе нет. Точка в пути — та же,
// что рисует окно; раздатчик берёт человека с пути, и путь к задаче — от точки, где его застала задача; пеший переход в
// потерях равен пройденному; снимок посреди пути продолжается тем же заводом.
import { describe, expect, test } from 'bun:test';
import { moversAt } from '../../src/app/movers';
import { db } from '../../src/content';
import type { ContentDb, Dept, Plant } from '../../src/content/types';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { fingerprint } from '../../src/engine/core/hash';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { CELL, cellOf, centerOf } from '../../src/engine/nav';
import { dist, planOf, travel } from '../../src/engine/plant';
import { fromSave, toSave } from '../../src/engine/save';
import { here, LAST_CALL, postOf, shiftEnd, WALK } from '../../src/engine/staff';
import { addTask, dispatch } from '../../src/engine/tasks';
import type { PlantState } from '../../src/engine/types';
import { Packer, unpack } from '../../src/sim/pack';
import { planErrors } from '../content/plan';

const SC = 'scn.proto';
const PLANT = db.scenarios[SC].plant;
const plan = planOf(db, PLANT);
const nav = plan.nav;

const withPlant = (change: (p: Plant) => void): ContentDb => {
  const p = structuredClone(db.plants[PLANT]);
  change(p);
  return { ...db, plants: { ...db.plants, [PLANT]: p } };
};

/** Пеший переход отдела за все сутки потерь, см и с. */
function walkOf(s: PlantState, dept: Dept) {
  return s.losses.reduce((n, d) => ({ cm: n.cm + (d.walk[dept]?.cm ?? 0), sec: n.sec + (d.walk[dept]?.sec ?? 0) }), { cm: 0, sec: 0 });
}

describe('посты в плане', () => {
  test('у каждой роли сценария — пост на проходимом полу, от входа до него дойти', () => {
    for (const row of db.scenarios[SC].staff) {
      const p = plan.posts[row.role];
      expect([row.role, p !== undefined]).toEqual([row.role, true]);
      expect(nav.walk[cellOf(nav, p)]).toBe(1);
      expect(dist(plan, plan.entrance, p)).toBeGreaterThan(0);
    }
  });

  test('сборка базы ловит пост в стене и внутри машины', () => {
    const wall = centerOf(nav, nav.cells.findIndex(c => c === CELL.wall));
    const inWall = withPlant(p => (p.posts['role.storekeeper'] = [wall.x, wall.z]));
    expect(planErrors(inWall, PLANT).some(e => e.includes('пост role.storekeeper — не на проходимом полу'))).toBe(true);
    const blocked = centerOf(nav, nav.blocked.findIndex(b => b === 1));
    const inMachine = withPlant(p => (p.posts['role.mechanic'] = [blocked.x, blocked.z]));
    expect(planErrors(inMachine, PLANT).some(e => e.includes('пост role.mechanic — не на проходимом полу'))).toBe(true);
    expect(planErrors(db, PLANT)).toEqual([]);
  });
});

describe('жизнь постов', () => {
  const s = newPlant(db, { scenario: SC });
  const packer = new Packer(db);
  let walking = 0;
  let toExit = 0;
  let compared = 0;
  const bad: string[] = [];
  // шесть суток по 5 минут: приход смен, задачи, конец смен
  for (let i = 0; i < 6 * 24 * 12; i++) {
    apply(db, s, { kind: 'advance', seconds: 300 });
    const sl = unpack(packer.pack(s, 0));
    const figs = moversAt(db, plan, sl.tasks, sl.people, sl.vehicles, sl.t);
    for (const p of Object.values(s.people)) {
      const end = shiftEnd(db, s, p);
      if (p.task) continue;
      if (end === undefined) {
        if (p.walk || p.x !== plan.entrance.x || p.z !== plan.entrance.z) bad.push(`${s.t} ${p.id}: вне смены не у входа`);
        continue;
      }
      const post = postOf(plan, p);
      const target = p.x === post.x && p.z === post.z ? 'post' : p.x === plan.entrance.x && p.z === plan.entrance.z ? 'exit' : 'other';
      if (target === 'other') bad.push(`${s.t} ${p.id}: свободен не на посту и не у входа`);
      if (!p.walk) continue;
      walking++;
      // куда идёт — по мгновению выхода: за 15 минут до конца смены и позже — к выходу, раньше — на пост
      const late = end - p.walk.t <= LAST_CALL;
      if (late) toExit++;
      if ((target === 'exit') !== late && !(post.x === plan.entrance.x && post.z === plan.entrance.z)) bad.push(`${s.t} ${p.id}: идёт не туда`);
      // точка в пути — та же, что рисует окно (начало и конец пути — на проходимом полу: окно не срезает хвостов): сейчас и
      // посреди пути; движок — в целых сантиметрах, окно — без округления
      if (nav.walk[cellOf(nav, p.walk)]) {
        const t1 = p.walk.t + travel(plan, p.walk, p, WALK);
        for (const t of [s.t, p.walk.t + (t1 - p.walk.t) * 0.3, p.walk.t + (t1 - p.walk.t) * 0.7].map(Math.floor)) {
          const at = here(plan, p, t);
          const fig = t === s.t ? figs : moversAt(db, plan, sl.tasks, sl.people, sl.vehicles, t);
          const f = fig.people.find(x => x.person === Number(p.id.slice(1)))!;
          if (Math.abs(f.x - at.x / 100) > 0.01 || Math.abs(f.z - at.z / 100) > 0.01) bad.push(`${t} ${p.id}: окно рисует не там`);
          if (t > p.walk.t && t < t1) compared++;
        }
      }
    }
    if (i % 12 === 0) bad.push(...check(db, s).map(e => `${s.t}: ${e}`));
  }

  test('свободный в смене — на посту или в пути; к выходу — только за 15 минут до конца смены; вне смены — у входа', () => {
    expect(bad.slice(0, 5)).toEqual([]);
    expect(walking).toBeGreaterThan(20);
    expect(toExit).toBeGreaterThan(0);
  });

  test('точка в пути — та же, что рисует окно', () => {
    expect(compared).toBeGreaterThan(10);
  });

  test('на шестые сутки в 12:00 у входа — не больше двух человек', () => {
    const t = newPlant(db, { scenario: SC });
    apply(db, t, { kind: 'advance', seconds: 5 * DAY + 12 * HOUR - t.t });
    const plan2 = planOf(db, t.plant);
    const near = Object.values(t.people).filter(p => shiftEnd(db, t, p) !== undefined && !p.task && dist(plan2, here(plan2, p, t.t), plan.entrance) < 300);
    expect(near.length).toBeLessThanOrEqual(2);
  });
});

describe('путь на пост', () => {
  /** Завод в начале дневной смены: кладовщики вышли от входа на свой пост. */
  function morning(): PlantState {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: 8 * HOUR + 20 - s.t });
    return s;
  }

  test('раздатчик берёт человека с пути: путь к задаче — от точки, где его застала задача; пройденное — в потери', () => {
    const s = morning();
    const p = Object.values(s.people).find(x => x.role === 'role.storekeeper' && x.walk)!;
    expect(p).toBeDefined();
    const at = here(plan, p, s.t);
    expect(at).not.toEqual(plan.entrance);
    expect(at).not.toEqual(postOf(plan, p));
    const walked = (s.t - p.walk!.t) * WALK;
    const before = walkOf(s, 'wms');
    const point = plan.posts['role.storekeeper'];
    const t = addTask(s, { kind: 'move', roles: ['role.storekeeper'], from: { kind: 'point', x: point.x, z: point.z }, work: 60, prio: 99 });
    dispatch(db, s);
    expect(t.people).toContain(p.id);
    expect(p.walk).toBeUndefined();
    expect({ x: p.x, z: p.z }).toEqual(at);
    expect(t.times![1] - t.times![0]).toBe(travel(plan, at, point, WALK));
    const after = walkOf(s, 'wms');
    // пройденное до задачи — путь на пост; путь к задаче — перемещение назначенной задачи (1ж)
    expect(after.cm - before.cm).toBe(walked + dist(plan, at, point));
  });

  test('дошёл — пеший переход равен пути: длина маршрута и его время', () => {
    const s = morning();
    const walkers = Object.values(s.people).filter(p => p.walk && db.roles[p.role].dept === 'wms');
    expect(walkers.length).toBeGreaterThan(0);
    const len = walkers.reduce((n, p) => n + dist(plan, p.walk!, p), 0);
    const sec = walkers.reduce((n, p) => n + travel(plan, p.walk!, p, WALK), 0);
    const until = Math.max(...walkers.map(p => p.walk!.t + travel(plan, p.walk!, p, WALK)));
    const before = walkOf(s, 'wms');
    apply(db, s, { kind: 'advance', seconds: until - s.t });
    // никто из них не взял задачи и не вышел снова: весь пеший переход склада — их пути
    for (const p of walkers) {
      expect(p.task).toBeUndefined();
      expect(p.walk).toBeUndefined();
      expect({ x: p.x, z: p.z }).toEqual(postOf(plan, p));
    }
    const after = walkOf(s, 'wms');
    expect([after.cm - before.cm, after.sec - before.sec]).toEqual([len, sec]);
  });

  test('снимок посреди пути — тот же завод дальше', () => {
    const s = morning();
    expect(Object.values(s.people).some(p => p.walk)).toBe(true);
    const copy = fromSave(db, toSave(s));
    apply(db, s, { kind: 'advance', seconds: DAY });
    apply(db, copy, { kind: 'advance', seconds: DAY });
    expect(fingerprint(copy)).toBe(fingerprint(s));
  });
});
