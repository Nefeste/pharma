// Часть 2б: люди и техника на полу (docs/specs/2026-10-view.md, 2б). Срез формата 3 несёт задачи в работе, людей и технику;
// где они сейчас — чистая функция задач и часов (src/app/movers.ts). Проверки: люди — только на проходимых клетках, техника —
// там, куда ей можно, или у стеллажа; к грузу человек приходит ровно к началу работы, техника — к месту ровно к его
// времени; конец задачи и то, что движок записал после неё, — одно и то же место; паллету на вилах везёт её техника.
import { describe, expect, test } from 'bun:test';
import { moversAt, standPoint } from '../../src/app/movers';
import { db } from '../../src/content';
import { DAY } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { cellOf } from '../../src/engine/nav';
import { planOf } from '../../src/engine/plant';
import { here } from '../../src/engine/staff';
import type { PlantState } from '../../src/engine/types';
import { Packer, unpack } from '../../src/sim/pack';

const plan = planOf(db, 'plant.proto');
const nav = plan.nav;
const at = (x: number, z: number) => cellOf(nav, { x: x * 100, z: z * 100 });

/** Кадры прогона: срез и движущиеся в момент среза. */
function* frames(days: number, step: number) {
  const s: PlantState = newPlant(db, { scenario: 'scn.proto' });
  const packer = new Packer(db);
  const end = s.t + days * DAY;
  while (s.t < end) {
    apply(db, s, { kind: 'advance', seconds: step });
    const sl = unpack(packer.pack(s, 0));
    yield { s, sl, mv: moversAt(db, plan, sl.tasks, sl.people, sl.vehicles, sl.t) };
  }
}

describe('срез движущихся', () => {
  test('все люди и техника; задачи — те, что в работе; на заводе — в смене или с задачей', () => {
    for (const { s, sl } of frames(1, 600)) {
      expect(sl.people).toHaveLength(Object.keys(s.people).length);
      expect(sl.vehicles).toHaveLength(Object.keys(s.vehicles).length);
      const busy = Object.values(s.tasks).filter(t => t.state === 'busy');
      expect(sl.tasks.map(t => t.task).sort((a, b) => a - b)).toEqual(busy.map(t => Number(t.id.slice(1))).sort((a, b) => a - b));
      for (const p of sl.people) {
        const e = s.people[`E${p.person}`];
        expect([p.x, p.z]).toEqual([e.x, e.z]);
        if (e.task) expect(sl.tasks[p.task].task).toBe(Number(e.task.slice(1)));
        else expect(p.task).toBe(-1);
        if (e.task) expect(p.present).toBe(true);
      }
      for (const t of sl.tasks) expect(t.times).toEqual(s.tasks[`T${t.task}`].times!);
    }
  });
});

describe('где люди и техника', () => {
  test('люди — на проходимых клетках, вне завода — не видны; техника — где ей можно ехать или у стеллажа', () => {
    let seen = 0;
    for (const { sl, mv } of frames(3, 97)) {
      const present = new Set(sl.people.filter(p => p.present).map(p => p.person));
      expect(mv.people.map(f => f.person).sort((a, b) => a - b)).toEqual([...present].sort((a, b) => a - b));
      for (const f of mv.people) {
        if (f.doing === 'ride') continue;
        expect([f.person, f.x, f.z, nav.walk[at(f.x, f.z)]]).toEqual([f.person, f.x, f.z, 1]);
        seen++;
      }
      for (const v of mv.vehicles) {
        const c = at(v.x, v.z);
        expect([v.vehicle, v.x, v.z, nav.drive[c] === 1 || nav.blocked[c] === 1]).toEqual([v.vehicle, v.x, v.z, true]);
      }
    }
    expect(seen).toBeGreaterThan(1000);
  });

  test('к грузу — ровно к началу работы; техника у места — к его времени; паллета на вилах — там же, где техника', () => {
    let checked = 0;
    for (const { sl } of frames(2, 301)) {
      sl.tasks.forEach((tk, ti) => {
        const crew = sl.people.filter(p => p.task === ti);
        const v = sl.vehicles.find(x => x.task === ti);
        const atStart = moversAt(db, plan, sl.tasks, sl.people, sl.vehicles, tk.times[1]);
        if (!v) {
          const sp = standPoint(plan, tk.from);
          for (const p of crew) {
            const f = atStart.people.find(x => x.person === p.person)!;
            expect(Math.hypot(f.x - sp.x / 100, f.z - sp.z / 100)).toBeLessThan(0.36);
            expect(f.doing).toBe('stand');
          }
          checked++;
          return;
        }
        const mv = atStart.vehicles.find(x => x.vehicle === v.vehicle)!;
        expect([mv.x, mv.z]).toEqual([tk.from.x / 100, tk.from.z / 100]);
        const dest = tk.dest ?? tk.from;
        const atDrop = moversAt(db, plan, sl.tasks, sl.people, sl.vehicles, tk.times[3]);
        const md = atDrop.vehicles.find(x => x.vehicle === v.vehicle)!;
        expect([md.x, md.z]).toEqual([dest.x / 100, dest.z / 100]);
        // в пути с грузом паллета — на вилах своей техники
        const mid = moversAt(db, plan, sl.tasks, sl.people, sl.vehicles, (tk.times[2] + tk.times[3]) / 2);
        if (tk.unit >= 0 && tk.times[3] > tk.times[2]) {
          const c = mid.carried.find(x => x.unit === tk.unit)!;
          const mm = mid.vehicles.find(x => x.vehicle === v.vehicle)!;
          expect([c.x, c.z, c.placed]).toEqual([mm.x, mm.z, false]);
        }
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(50);
  });

  test('конец задачи — то же место, куда движок ставит человека и технику после неё', () => {
    let checked = 0;
    for (const { s, sl } of frames(2, 301)) {
      // первая кончающаяся задача с одним человеком: копию завода — ровно к её концу
      const ti = sl.tasks.reduce((best, tk, i) => (sl.people.filter(p => p.task === i).length === 1 && tk.kind !== 'crew' && (best < 0 || tk.times[4] < sl.tasks[best].times[4]) ? i : best), -1);
      if (ti < 0) continue;
      const tk = sl.tasks[ti];
      const person = sl.people.find(p => p.task === ti)!.person;
      const copy = structuredClone(s);
      apply(db, copy, { kind: 'advance', seconds: tk.times[4] - copy.t });
      const e = copy.people[`E${person}`];
      // где он в мгновение конца задачи: свободный идёт на пост и ещё не сделал ни шага (3а)
      const at = here(plan, e, copy.t);
      // кончил после смены — ушёл через вход
      if (at.x === plan.entrance.x && at.z === plan.entrance.z) continue;
      const end = moversAt(db, plan, sl.tasks, sl.people, sl.vehicles, tk.times[4]);
      const f = end.people.find(x => x.person === person)!;
      if (f.doing === 'ride') {
        const v = copy.vehicles[`V${f.vehicle}`];
        const mv = end.vehicles.find(x => x.vehicle === f.vehicle)!;
        expect([mv.x, mv.z]).toEqual([v.x / 100, v.z / 100]);
        expect([at.x, at.z]).toEqual([v.x, v.z]);
      } else {
        const sp = standPoint(plan, at);
        expect([tk.kind, Math.hypot(f.x - sp.x / 100, f.z - sp.z / 100) < 1e-9]).toEqual([tk.kind, true]);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });
});
