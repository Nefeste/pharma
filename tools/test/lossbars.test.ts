// Б1л: слой «Потери» в окне (src/app/losses.ts). Места столбиков — у каждого помещения, зоны, стеллажа, линии и рампы
// плана, на полу своего помещения, не на оборудовании и не на месте паллеты, не ближе друг к другу, чем нужно числам;
// вещь карточки зоны, стеллажа и рампы — помещение, где стоит столбик, линии — её первая машина. Столбики — у мест с
// потерями вида за окно, самое большое место — во всю высоту, высоты — доли его; части — по видам снизу вверх без «нет
// смены», у ожидания — по семьям причин; короба — вокруг столбика и часов над ним; места карточки и имена мест.
import { describe, expect, test } from 'bun:test';
import { FLOOR } from '../../src/app/floor';
import { ALL_KINDS, FAMILY_OF, LOSS_PICKS, lossBars, lossBoxes, lossSpotsOf, partsOfLoss, secOfLoss, spotName, spotsOfThing, WAIT_FAMILIES } from '../../src/app/losses';
import { db } from '../../src/content';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { CELL } from '../../src/engine/nav';
import { planOf } from '../../src/engine/plant';
import type { PlantState } from '../../src/engine/types';
import { setLang } from '../../src/i18n';
import { layoutOf } from '../../src/render/layout';
import { floorView } from '../../src/sim/floor';

const SC = 'scn.proto';
const plan = planOf(db, db.plants[db.scenarios[SC].plant]);
const l = layoutOf(plan);
const spots = lossSpotsOf(db, l);
setLang('ru');

/** Завод после 20 суток и ещё 10 часов: у мест — ожидание, перевозки, переходы, уборки. */
const s: PlantState = newPlant(db, { scenario: SC });
apply(db, s, { kind: 'advance', seconds: 20 * DAY + 10 * HOUR });

describe('места столбиков', () => {
  test('у каждого помещения, зоны, стеллажа, линии и рампы плана — одно место; у двора — нет', () => {
    const want = [...plan.plant.rooms.map(r => r.id), ...plan.plant.zones.map(z => `zone:${z.id}`), ...plan.plant.racks.map(r => `zone:${r.id}`), ...plan.plant.lines.map(x => `line:${x.id}`), ...plan.plant.docks.map(d => `dock:${d.id}`)];
    expect(spots.map(x => x.spot).sort()).toEqual(want.sort());
    expect(spots.some(x => x.spot === 'yard')).toBe(false);
  });

  test('столбик — на полу своего помещения, без стен, дверей, оборудования; не на месте паллеты; не ближе 1,6 м к другому', () => {
    const r = FLOOR.room / 2;
    const pallets = plan.slots.filter(x => x.level === 0 && plan.plant.zones.some(z => z.id === x.group)).map(x => [x.x / 100, x.z / 100]);
    for (const sp of spots) {
      const i = sp.thing.kind === 'room' ? sp.thing.i : l.rooms.findIndex(x => x.id === plan.plant.lines[(sp.thing as { line: number }).line].room);
      for (let cz = Math.floor(sp.z - r); cz <= Math.floor(sp.z + r - 1e-9); cz++)
        for (let cx = Math.floor(sp.x - r); cx <= Math.floor(sp.x + r - 1e-9); cx++) {
          const k = cz * l.nav.w + cx;
          expect([sp.spot, [CELL.floor, CELL.corridor].includes(l.nav.cells[k] as 1 | 2), l.nav.room[k], l.nav.blocked[k]]).toEqual([sp.spot, true, i, 0]);
        }
      for (const [px, pz] of pallets) expect([sp.spot, Math.abs(px - sp.x) >= 0.6 + r || Math.abs(pz - sp.z) >= 0.6 + r]).toEqual([sp.spot, true]);
      for (const o of spots) if (o !== sp) expect([sp.spot, o.spot, Math.hypot(o.x - sp.x, o.z - sp.z) >= 1.6 - 1e-9]).toEqual([sp.spot, o.spot, true]);
    }
  });

  test('зона, стеллаж и рампа — карточка помещения, где стоит столбик; линия — её первая машина, у её северной стороны', () => {
    for (const sp of spots) {
      if (sp.spot.startsWith('zone:') || sp.spot.startsWith('dock:')) {
        expect(sp.thing.kind).toBe('room');
        const room = sp.thing.kind === 'room' ? l.rooms[sp.thing.i] : undefined;
        expect(sp.x > room!.x && sp.x < room!.x + room!.w && sp.z > room!.z && sp.z < room!.z + room!.d).toBe(true);
      }
      if (sp.spot.startsWith('line:')) {
        expect(sp.thing).toEqual({ kind: 'machine', line: 0, k: 0 });
        const m = plan.plant.lines[0].machines[0];
        expect(Math.abs(sp.x - m.at[0] / 100)).toBeLessThan(1);
        expect(sp.z).toBeLessThan(m.at[1] / 100);
      }
    }
    // стеллаж — в проходе с его стороны, у середины ряда
    for (const rk of plan.plant.racks) {
      const sp = spots.find(x => x.spot === `zone:${rk.id}`)!;
      expect(rk.face === 'n' ? sp.z < rk.z / 100 : sp.z > (rk.z + 110) / 100).toBe(true);
    }
    // рампа — у ворот, внутри здания
    for (const dk of plan.plant.docks) {
      const sp = spots.find(x => x.spot === `dock:${dk.id}`)!;
      expect(Math.hypot(sp.x - dk.x / 100, sp.z - dk.z / 100)).toBeLessThan(4);
    }
  });

  test('места карточки: склад — он сам, его зоны, стеллажи и рампы; упаковка — и линия; машина линии — её линия', () => {
    const wh = l.rooms.findIndex(r => r.id === 'warehouse');
    const mine = spotsOfThing(l, spots, { kind: 'room', i: wh });
    expect(mine).toContain('warehouse');
    for (const id of ['zone:A', 'zone:D', 'zone:stage', 'zone:recv', 'dock:in', 'dock:out']) expect(mine).toContain(id);
    const pk = l.rooms.findIndex(r => r.id === 'packaging');
    expect(spotsOfThing(l, spots, { kind: 'room', i: pk })).toEqual(['packaging', `line:${plan.plant.lines[0].id}`]);
    expect(spotsOfThing(l, spots, { kind: 'machine', line: 0, k: 2 })).toEqual([`line:${plan.plant.lines[0].id}`]);
    expect(spotsOfThing(l, spots, { kind: 'unit', n: 1 })).toEqual([]);
  });

  test('имена мест: помещение — по типу, зона — словом на полу, стеллаж, линия, рампа, двор', () => {
    expect(spotName(l, 'lab')).toBe('Лаборатория');
    expect(spotName(l, 'zone:stage')).toBe('Зона «Комплектация»');
    expect(spotName(l, 'zone:C')).toBe('Стеллаж C');
    expect(spotName(l, `line:${plan.plant.lines[0].id}`)).toBe('Линия 1');
    expect(spotName(l, 'dock:in')).toBe('Рампа приёмки');
    expect(spotName(l, 'dock:out')).toBe('Рампа отгрузки');
    expect(spotName(l, 'yard')).toBe('Двор');
  });
});

describe('столбики', () => {
  const v = floorView(db, s, { view: 'floor', win: 'week' });

  test('у каждого места с потерями вида за окно; самое большое — во всю высоту, остальные — доли его; части снизу вверх', () => {
    for (const pick of LOSS_PICKS) {
      const bars = lossBars(spots, v, pick);
      const want = v.losses.filter(x => secOfLoss(x, pick) > 0 && spots.some(sp => sp.spot === x.spot)).map(x => x.spot);
      expect([pick, bars.map(b => b.spot)]).toEqual([pick, want]);
      const max = Math.max(...bars.map(b => b.sec));
      for (const b of bars) {
        const top = b.parts.reduce((y, p) => y + p.h, 0);
        expect(top).toBeCloseTo((FLOOR.full * b.sec) / max, 9);
        expect(b.parts.reduce((n, p) => n + p.sec, 0)).toBe(b.sec);
        let y = 0;
        for (const p of b.parts) {
          expect(p.y0).toBeCloseTo(y, 9);
          y += p.h;
        }
      }
      if (bars.length > 0) expect(Math.max(...bars.map(b => b.parts.reduce((n, p) => n + p.h, 0)))).toBeCloseTo(FLOOR.full, 9);
    }
  });

  test('«все» — виды по порядку без «нет смены»; ожидание — семьи причин; один вид — одна часть', () => {
    let fams = 0;
    for (const x of v.losses) {
      const all = partsOfLoss(x, 'all');
      expect(all.map(p => p.part)).toEqual(ALL_KINDS.filter(k => (x.sec[k] ?? 0) > 0));
      expect(all.reduce((n, p) => n + p.sec, 0)).toBe(x.total);
      const w = partsOfLoss(x, 'wait');
      expect(w.map(p => p.part)).toEqual(WAIT_FAMILIES.filter(f => Object.entries(x.wait).some(([c, sec]) => FAMILY_OF[c as keyof typeof FAMILY_OF] === f && (sec ?? 0) > 0)));
      expect(w.reduce((n, p) => n + p.sec, 0)).toBe(x.sec.wait ?? 0);
      fams = Math.max(fams, w.length);
      for (const k of ['shift', 'move', 'walk', 'setup', 'again', 'defect'] as const) expect(partsOfLoss(x, k)).toEqual((x.sec[k] ?? 0) > 0 ? [{ part: k, sec: x.sec[k]! }] : []);
    }
    // за неделю где-то ждали и людей, и приборов или мест
    expect(fams).toBeGreaterThan(1);
    // «нет смены» у кого-то есть, но в «все» не входит
    expect(v.losses.some(x => (x.sec.shift ?? 0) > 0)).toBe(true);
  });

  test('вид потерь меняет высоты: самое большое место «перевозок» — не то, что у «всех»', () => {
    const top = (pick: (typeof LOSS_PICKS)[number]) => lossBars(spots, v, pick).sort((a, b) => b.sec - a.sec)[0]?.spot;
    expect(top('all')).toBeDefined();
    expect(top('move')).toBeDefined();
    expect(top('move')).not.toBe(top('all'));
  });

  test('короб — основание столбика и до 0,5 м над его верхом: по малому столбику попасть легко', () => {
    const bars = lossBars(spots, v, 'all');
    const boxes = lossBoxes(bars);
    for (const [i, b] of bars.entries()) {
      const top = b.parts.reduce((y, p) => y + p.h, 0);
      expect(boxes[i].spot).toBe(b.spot);
      expect(boxes[i].thing).toEqual(b.thing);
      expect(boxes[i].min).toEqual([b.x - b.side / 2, 0, b.z - b.side / 2]);
      expect(boxes[i].max[1]).toBeCloseTo(top + 0.5, 9);
    }
  });
});
