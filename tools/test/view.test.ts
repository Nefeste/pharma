// Часть 2а: план здания, маршруты и срез (docs/specs/2026-10-view.md, 2а). План — стены, двери, шлюзы, проверки сборки базы;
// маршрут — длина нарисованного пути равна длине в движке, путь — только по проходимым клеткам; срез — после старта все
// паллеты, дальше только изменённые и ушедшие; упаковка не читает истины: завод с другими истинными свойствами даёт тот же
// срез.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { ContentDb, Plant } from '../../src/content/types';
import { DAY } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { CELL, cellOf, pathLength, polylineLength, route } from '../../src/engine/nav';
import { dist, planOf, type Point } from '../../src/engine/plant';
import type { PlantState } from '../../src/engine/types';
import { Packer, unpack } from '../../src/sim/pack';
import { planErrors } from '../content/plan';

const PLANT = 'plant.proto';
const plan = planOf(db, PLANT);
const nav = plan.nav;

/** Точки плана: места паллет, рабочие точки помещений, рампы, вход, стоянка. */
const points: Point[] = [...plan.slots, ...Object.values(plan.room), ...Object.values(plan.dock), plan.entrance, plan.park];

/** База с изменённым планом — для проверок сборки. */
const withPlant = (change: (p: Plant) => Plant): ContentDb => ({ ...db, plants: { ...db.plants, [PLANT]: change(structuredClone(db.plants[PLANT])) } });

describe('план здания', () => {
  test('план прототипа проходит проверки сборки базы', () => {
    expect(planErrors(db, PLANT)).toEqual([]);
  });

  test('проверки ловят: дверь не на стене, технику в классе D, комнату отдыха в производство, вход в класс D без шлюза', () => {
    const roomAt = (p: Plant, id: string) => p.rooms.find(r => r.id === id)!;
    const door = withPlant(p => ({ ...p, doors: [...p.doors, { cell: [10, 30], len: 1, along: 'x', kind: 'door' }] }));
    expect(planErrors(door, PLANT).some(e => e.includes('не на стене'))).toBe(true);
    const truck = withPlant(p => {
      roomAt(p, 'compression').vehicles = true;
      return p;
    });
    expect(planErrors(truck, PLANT).some(e => e.includes('техника въезжает в класс D'))).toBe(true);
    // комната отдыха — в чистый коридор: дверь в её северной стене ведёт в общий коридор, поэтому меняем класс коридора
    const rest = withPlant(p => {
      roomAt(p, 'hall').grade = 'D';
      return p;
    });
    const errs = planErrors(rest, PLANT);
    expect(errs.some(e => e.includes('amenities открывается в производство'))).toBe(true);
    expect(errs.some(e => e.includes('не через шлюз'))).toBe(true);
  });

  test('клетки: стены — по краю помещений, двери — проходимы, стеллажи и машины — нет', () => {
    for (const r of plan.plant.rooms) {
      const [x0, z0] = [r.rect[0] / 100, r.rect[1] / 100];
      const c = nav.cells[z0 * nav.w + x0];
      expect(c === CELL.wall || c === CELL.door).toBe(true);
    }
    for (const d of plan.plant.doors) {
      const i = d.cell[1] * nav.w + d.cell[0];
      expect(nav.cells[i]).toBe(CELL.door);
      expect(nav.walk[i]).toBe(d.kind === 'hatch' || d.materials ? 0 : 1);
    }
    for (const sl of plan.slots.filter(s => s.kind === 'storage')) expect(nav.blocked[cellOf(nav, sl)]).toBe(1);
    for (const ln of plan.plant.lines) for (const m of ln.machines) expect(nav.blocked[cellOf(nav, { x: m.at[0], z: m.at[1] })]).toBe(1);
  });

  test('техника — только по складу: ни одной клетки класса D, кроме шлюза пробоотборной', () => {
    for (let i = 0; i < nav.w * nav.h; i++) {
      if (!nav.drive[i] || nav.room[i] < 0) continue;
      const r = plan.plant.rooms[nav.room[i]];
      if (r.grade === 'D') expect(r.type).toBe('airlock.sampling');
    }
  });
});

describe('маршруты', () => {
  // пары точек — с шагом, чтобы покрыть склад, производство и вспомогательное
  const pairs: [Point, Point][] = [];
  for (let i = 0; i < points.length; i += 7) for (let k = 3; k < points.length; k += 29) pairs.push([points[i], points[k]]);

  test('длина нарисованного пути = длина в движке; путь — вдоль осей и по проходимым клеткам', () => {
    for (const [a, b] of pairs) {
      const pts = route(nav, a, b, 'walk');
      expect(polylineLength(pts)).toBe(pathLength(nav, a, b, 'walk'));
      expect(pts[0]).toEqual({ x: a.x, z: a.z });
      expect(pts.at(-1)).toEqual({ x: b.x, z: b.z });
      for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].z === pts[i - 1].z).toBe(true);
      // середины клеток пути — проходимы (концы — места паллет на стеллаже и точки у машин — нет)
      for (let i = 2; i < pts.length - 2; i++) expect(nav.walk[cellOf(nav, pts[i])]).toBe(1);
    }
  });

  test('путь одинаков при повторе; длина не зависит от направления и не короче прямой', () => {
    for (const [a, b] of pairs) {
      expect(route(nav, a, b, 'walk')).toEqual(route(nav, a, b, 'walk'));
      expect(pathLength(nav, a, b, 'walk')).toBe(pathLength(nav, b, a, 'walk'));
      expect(dist(plan, a, b)).toBeGreaterThanOrEqual(Math.abs(a.x - b.x) + Math.abs(a.z - b.z));
    }
  });

  test('в одной клетке — по прямой; техника ездит только там, куда ей можно', () => {
    const a = { x: 250, z: 2050 };
    const b = { x: 210, z: 2010 };
    expect(cellOf(nav, a)).toBe(cellOf(nav, b));
    expect(pathLength(nav, a, b, 'walk')).toBe(80);
    for (const sl of plan.slots) {
      const pts = route(nav, plan.park, sl, 'drive');
      expect(polylineLength(pts)).toBe(pathLength(nav, plan.park, sl, 'drive'));
      for (let i = 2; i < pts.length - 2; i++) expect(nav.drive[cellOf(nav, pts[i])]).toBe(1);
    }
  });

  test('в чистую зону — через шлюз для людей: от входа до таблетирования путь идёт через шлюз', () => {
    const pts = route(nav, plan.entrance, plan.room.compression, 'walk');
    const gowning = plan.plant.rooms.findIndex(r => r.type === 'airlock.people');
    expect(pts.some(p => nav.room[cellOf(nav, p)] === gowning)).toBe(true);
    // через шлюз для материалов люди в чистую зону не проходят: от места у шлюза до отвешивания — через шлюз для людей
    const mal = plan.plant.rooms.findIndex(r => r.type === 'airlock.material');
    const kit = route(nav, plan.byKind.staging[0], plan.room.dispensing, 'walk');
    expect(kit.some(p => nav.room[cellOf(nav, p)] === mal)).toBe(false);
    expect(kit.some(p => nav.room[cellOf(nav, p)] === gowning)).toBe(true);
  });
});

describe('срез', () => {
  const s = newPlant(db, { scenario: 'scn.proto' });
  apply(db, s, { kind: 'advance', seconds: 2 * DAY });

  test('после старта — все паллеты; без изменений — ни одной; после хода — только изменённые и ушедшие', () => {
    const p = new Packer(db);
    const first = unpack(p.pack(s, 0));
    expect(first.units.map(u => u.unit).sort((a, b) => a - b)).toEqual(Object.keys(s.units).map(id => Number(id.slice(1))).sort((a, b) => a - b));
    expect(first.rooms).toHaveLength(plan.plant.rooms.length);
    expect(unpack(p.pack(s, 0)).units).toEqual([]);
    const copy = structuredClone(s);
    const before = new Set(Object.keys(copy.units));
    apply(db, copy, { kind: 'advance', seconds: DAY });
    const next = unpack(p.pack(copy, 0));
    for (const n of next.gone) expect(copy.units[`U${n}`]).toBeUndefined();
    for (const id of before) if (!copy.units[id]) expect(next.gone).toContain(Number(id.slice(1)));
    p.reset();
    expect(unpack(p.pack(copy, 0)).units).toHaveLength(Object.keys(copy.units).length);
  });

  test('правда вещи: у паллеты в срезе столько тары, сколько в учёте, тот же ярлык и то же место', () => {
    const rows = unpack(new Packer(db).pack(s, 0)).units;
    for (const r of rows) {
      const u = s.units[`U${r.unit}`];
      expect(r.fill).toBe(u.items.length);
      expect(r.tag).toBe(u.tag);
      expect(r.where).toBe(u.where.kind);
      if (u.where.kind === 'slot') expect(plan.slots[r.ref].id).toBe(u.where.id);
      if (u.where.kind === 'room') expect(plan.plant.rooms[r.ref].id).toBe(u.where.id);
    }
  });

  test('окно не видит истины: завод с другими истинными свойствами и запасом узлов даёт тот же срез', () => {
    const other: PlantState = structuredClone(s);
    for (const l of Object.values(other.lots)) for (const k of Object.keys(l.truth)) l.truth[k as keyof typeof l.truth] = 1;
    for (const b of Object.values(other.batches)) {
      b.truth = {};
      b.noise = {};
      b.causes = [];
    }
    for (const pt of Object.values(other.parts)) pt.budget = 1;
    for (const ln of Object.values(other.lines)) for (const m of ln.machines) m.next = 1;
    expect(new Packer(db).pack(other, 0)).toEqual(new Packer(db).pack(s, 0));
  });
});
