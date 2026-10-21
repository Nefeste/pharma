// Часть 2в: оборудование и линия (docs/specs/2026-10-view.md, 2в). Модели кодом — у каждого вида оборудования и машины, в
// своём следе; лампа — у каждого состояния машины и оборудования, у каждой лампы свой цвет; лента — штуки с шагом от входа к
// выходу, на экране не быстрее `BELT_MAX`; накопитель — та же доля, что в движке. Срез формата 4: строка линии — тот же
// поток, что движок насчитает к следующему событию; окно не видит истины.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { batchNo, packNo, unpackNo } from '../../src/engine/batchno';
import type { ModelPart } from '../../src/content/types';
import { MIN } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { flowAt, SIXTY } from '../../src/engine/line';
import { planOf } from '../../src/engine/plant';
import type { Line, PlantState } from '../../src/engine/types';
import { BELT_MAX, beltOffsets, beltSpeed, bufferCount, type Lamp, LAMP_COLOR, lampOfEquipment, lampOfMachine, PITCH } from '../../src/render/flow';
import { EQ_STATES, MACHINE_STATES, type MachineRow, Packer, unpack } from '../../src/sim/pack';
import { modelErrors } from '../content/load';

const plan = planOf(db, 'plant.proto');
const LAMPS = Object.keys(LAMP_COLOR) as Lamp[];

describe('модели кодом', () => {
  const kinds = [...Object.values(db.equipment), ...Object.values(db.machines)];

  test('у каждого вида оборудования и машины — модель в своём следе, от пола и не выше', () => {
    for (const k of kinds) {
      expect(k.model.length).toBeGreaterThan(0);
      expect(modelErrors(k.model, k.size.map(v => v / 100) as [number, number, number], k.id)).toEqual([]);
    }
  });

  test('у машины линии — лента с тем, что машина считает; у оборудования участка лент нет', () => {
    for (const m of Object.values(db.machines)) expect(m.model.some(p => p.shape === 'belt' && p.item === m.item)).toBe(true);
    for (const e of Object.values(db.equipment)) expect(e.model.some(p => p.shape === 'belt')).toBe(false);
  });

  test('сборка ловит: часть за следом и выше машины, цилиндр не круглый, бункер не вертикальный, штуки не у ленты', () => {
    const box: ModelPart = { shape: 'box', x: 0, z: 0, y: 0.5, w: 1, d: 1, h: 1 };
    const foot: [number, number, number] = [2, 2, 2];
    const bad = (p: Partial<ModelPart>) => modelErrors([{ ...box, ...p }], foot, 'проба');
    expect(bad({})).toEqual([]);
    expect(bad({ x: 0.6 })[0]).toContain('выходит за след');
    expect(bad({ y: 1.8 })[0]).toContain('выше 2 м');
    expect(bad({ y: 0.4 })[0]).toContain('ниже пола');
    expect(bad({ shape: 'cyl', d: 0.5 })[0]).toContain('не круг');
    expect(bad({ shape: 'cyl', axis: 'x', h: 0.5, d: 0.5 })).toEqual([]);
    expect(bad({ shape: 'cone', axis: 'x', bottom: 0.5 })[0]).toContain('бункер');
    expect(bad({ shape: 'cone' })[0]).toContain('бункер');
    expect(bad({ shape: 'belt', h: 0.04, y: 0.9 })[0]).toContain('штуки');
    expect(bad({ item: 'carton' })[0]).toContain('штуки');
  });
});

describe('лампы', () => {
  const row = (state: MachineRow['state'], check = false): MachineRow => ({ state, rate: 0, items: 0, fill: -1, check });
  const plain = { changeover: false, clearance: false };

  test('у каждого состояния машины — своя лампа; авария видна и на переналадке', () => {
    const want: Record<MachineRow['state'], Lamp> = { run: 'run', slow: 'run', micro: 'stop', fail: 'fail', wait: 'wait', setup: 'setup', off: 'off', idle: 'off' };
    for (const st of MACHINE_STATES) {
      expect(lampOfMachine(row(st), plain)).toBe(want[st]);
      expect(lampOfMachine(row(st), { changeover: true, clearance: false })).toBe(st === 'fail' ? 'fail' : 'setup');
      expect(lampOfMachine(row(st), { changeover: false, clearance: true })).toBe(st === 'fail' ? 'fail' : 'clean');
      // не годна к работе (Б3в): у подрядчика или срок вышел — «калибровка или квалификация», пока она не на ходу
      expect(lampOfMachine(row(st, true), plain)).toBe(st === 'fail' ? 'fail' : st === 'run' || st === 'slow' ? 'run' : st === 'micro' ? 'stop' : 'check');
    }
  });

  test('у оборудования участка: работает, уборка, авария, калибровка или квалификация, без дела; у каждой лампы свой цвет', () => {
    expect(EQ_STATES.map(lampOfEquipment)).toEqual(['off', 'run', 'clean', 'fail', 'check']);
    expect(new Set(LAMPS.map(l => LAMP_COLOR[l])).size).toBe(LAMPS.length);
  });
});

describe('лента и накопитель', () => {
  test('штуки — с шагом, от входа к выходу, только на ленте; фаза сдвигает все', () => {
    const at = beltOffsets(1.6, PITCH.blister, 0);
    expect(at).toHaveLength(Math.floor(1.6 / PITCH.blister));
    expect(at[0]).toBe(0);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeCloseTo(PITCH.blister, 9);
    const moved = beltOffsets(1.6, PITCH.blister, 0.05);
    for (let i = 0; i < moved.length; i++) expect(moved[i]).toBeCloseTo(at[i] + 0.05, 9);
    for (const d of [...at, ...moved, ...beltOffsets(3, PITCH.carton, 0.7)]) expect(d >= 0 && d <= 3).toBe(true);
    expect(beltOffsets(1.6, PITCH.blister, PITCH.blister + 0.05)).toEqual(moved);
    expect(beltOffsets(0.1, PITCH.carton, 0)).toEqual([]);
  });

  test('скорость на экране: в «живом времени» — как у машины; на ×1 и быстрее — не больше BELT_MAX', () => {
    expect(beltSpeed(120, 1, PITCH.blister)).toBeCloseTo(0.26, 9);
    expect(beltSpeed(120, 60, PITCH.blister)).toBe(BELT_MAX);
    expect(beltSpeed(70, 7200, PITCH.carton)).toBe(BELT_MAX);
    expect(beltSpeed(0, 60, PITCH.carton)).toBe(0);
  });

  test('накопитель — та же доля, что в движке; непустой — хотя бы одна штука', () => {
    const cap = 600;
    const slots = 12;
    for (let fill = 0; fill <= cap; fill++) {
      const k = bufferCount(fill, cap, slots);
      if (fill === 0) expect(k).toBe(0);
      else expect(k).toBeGreaterThanOrEqual(1);
      if (fill / cap >= 1 / (2 * slots)) expect(Math.abs(k / slots - fill / cap)).toBeLessThanOrEqual(1 / (2 * slots) + 1e-9);
    }
    expect(bufferCount(cap, cap, slots)).toBe(slots);
    expect(bufferCount(-1, cap, slots)).toBe(0);
  });
});

describe('срез линий и оборудования (формат 4)', () => {
  const s: PlantState = newPlant(db, { scenario: 'scn.proto' });
  const line = (): Line => s.lines[plan.plant.lines[0].id];
  // до первого задания на линии: в сценарии прототипа — на седьмые сутки
  while (s.batches[line().batch ?? '']?.pack?.state !== 'running') apply(db, s, { kind: 'advance', seconds: 10 * MIN });
  const packer = new Packer(db);

  /** В штуке машины — таблеток × 60: блистер у блистерной, пачка у остальных. */
  const per = (k: number) => {
    const sku = db.skus[s.batches[line().batch!].pack!.sku];
    const m = db.machines[line().machines[k].type];
    return (m.item === 'blister' ? sku.perBlister : sku.perBlister * sku.blisters) * SIXTY;
  };

  test('все линии и оборудование плана; машина — состояние движка, скорость и штуки — из его потока; накопитель — в ёмкости', () => {
    let rows = 0;
    let last: number[] = [];
    for (let i = 0; i < 80; i++) {
      apply(db, s, { kind: 'advance', seconds: 97 });
      const sl = unpack(packer.pack(s, 0));
      expect(sl.lines).toHaveLength(plan.plant.lines.length);
      expect(sl.equipment.map(e => e.eq)).toEqual(plan.plant.equipment.map((_, k) => k));
      const ln = line();
      const r = sl.lines[0];
      if (s.batches[ln.batch ?? '']?.pack?.state !== 'running') break;
      // номер серии — одним целым: в упаковке он уже полный (src/engine/batchno.ts)
      expect(r.batch).toBe(packNo(s.batches[ln.batch!].code));
      expect(batchNo(unpackNo(r.batch)!)).toMatch(/^PA\d{7}$/);
      const pos = flowAt(db, s, ln, s.t);
      ln.machines.forEach((mc, k) => {
        const m = r.machines[k];
        expect(m.state).toBe(mc.state);
        expect(m.rate).toBe(Math.round((mc.rate * 60) / per(k)));
        expect(m.items).toBe(Math.floor(pos[k] / per(k)));
        const cap = plan.plant.lines[0].machines[k].buffer;
        if (cap === undefined) expect(m.fill).toBe(-1);
        else {
          expect(m.fill).toBe(Math.floor((pos[k] - pos[k + 1]) / per(k)));
          expect(m.fill >= 0 && m.fill <= cap).toBe(true);
        }
      });
      // прошло штук — не меньше, чем в прошлом срезе
      const items = r.machines.map(m => m.items);
      if (last.length) items.forEach((n, k) => expect(n).toBeGreaterThanOrEqual(last[k]));
      last = items;
      rows++;
    }
    expect(rows).toBeGreaterThan(10);
  });

  test('между событиями — прямая: к событию линии движок насчитывает то же, что обещал срез', () => {
    let met = 0;
    for (let i = 0; i < 1800 && s.batches[line().batch ?? '']?.pack?.state === 'running'; i++) {
      const promised = flowAt(db, s, line(), s.t + 1);
      const before = line().t;
      apply(db, s, { kind: 'advance', seconds: 1 });
      if (line().t === before) continue;
      expect(line().machines.map(mc => mc.pos)).toEqual(promised);
      met++;
    }
    expect(met).toBeGreaterThan(3);
  });

  test('окно не видит истины: линия с другой следующей микроостановкой и другим запасом узлов даёт тот же срез', () => {
    const other: PlantState = structuredClone(s);
    for (const ln of Object.values(other.lines)) for (const m of ln.machines) m.next = 1;
    for (const pt of Object.values(other.parts)) pt.budget = 1;
    expect(new Packer(db).pack(other, 0)).toEqual(new Packer(db).pack(s, 0));
  });
});
