// Часть Б7г, шаг 2: вакуумная перегрузка (docs/specs/2026-10-vertical-slice.md, «Б7г», «Проверки Б7г»; решение
// владельца по #170 — только перегрузка порошка и гранулята, таблетки — на тележке). Единицу ставят в помещение, откуда
// идёт продукт, вплотную к стене с помещением следующей стадии; пара типов — из записи класса. Годная перегрузка
// переносит полупродукт без тележки: аппаратчик пускает её на месте, дальше — масса на производительность; единица
// моется с оборудованием своего помещения. Путь единицы тест сокращает: запись квалификации — копия записи
// обеспыливателя старта.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR, MIN } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { CARRY_WORK, stageMass, washWork } from '../../src/engine/mes';
import { forecast } from '../../src/engine/plan/schedule';
import { transferTime, transferVia } from '../../src/engine/route';
import { fromSave, toSave } from '../../src/engine/save';
import { editPlan } from '../../src/engine/site/edit';
import { transferTo } from '../../src/engine/site/units';
import type { Notice, PlantState } from '../../src/engine/types';

const SC = 'scn.proto';
const B = db.scenarios[SC].build!;
const VAC = 'eq.vacuum';
const advance = (s: PlantState, seconds: number) => apply(db, s, { kind: 'advance', seconds });

/** Идти по пять минут, пока условие не сбудется; не дольше `days` суток. */
function until(s: PlantState, cond: () => boolean, days = 30): Notice[] {
  const out: Notice[] = [];
  const end = s.t + days * DAY;
  while (!cond() && s.t < end) out.push(...advance(s, 5 * MIN));
  expect(cond()).toBe(true);
  return out;
}

/** Места у стены: грануляция — у стены со смешиванием (x = 42), смешивание — у стены с таблетированием (x = 48). */
const AT_GRAN: [number, number] = [4150, 750];
const AT_BLEND: [number, number] = [4750, 800];

/** Завод с перегрузкой в помещении `room` на месте `at`: покупка командой, путь сокращён — запись как у обеспыливателя. */
function withVacuum(room = 'granulation', at = AT_GRAN): { s: PlantState; vac: string } {
  const s = newPlant(db, { scenario: SC });
  const ns = apply(db, s, { kind: 'equip', op: { op: 'buy', type: VAC, vendor: 'ven.ru', room, at, turn: 0 } });
  const n = ns.find(x => x.kind === 'equip') as Extract<Notice, { kind: 'equip' }> & { ok: true; thing: string };
  expect(n.ok).toBe(true);
  const a = s.assets[n.thing];
  const twin = Object.values(s.assets).find(x => x.type === 'eq.deduster')!;
  a.recs = structuredClone(twin.recs);
  delete a.path;
  return { s, vac: n.thing };
}

describe('место перегрузки', () => {
  test('у стены с помещением следующей стадии — ведёт туда; посреди помещения и не та пара — нельзя', () => {
    const s = newPlant(db, { scenario: SC });
    const plant = s.plan;
    expect(transferTo(db, plant, VAC, 'granulation', AT_GRAN, 0)).toBe('blending');
    expect(transferTo(db, plant, VAC, 'blending', AT_BLEND, 0)).toBe('compression');
    const unit = (room: string, at: [number, number]) => editPlan(db, B, plant, { op: 'unit', type: VAC, room, at, turn: 0, vendor: 'ven.ru' }, {});
    expect(unit('granulation', AT_GRAN).ok).toBe(true);
    expect(unit('blending', AT_BLEND).ok).toBe(true);
    // посреди грануляции стены рядом нет
    const mid = unit('granulation', [3650, 750]);
    expect(mid.ok ? 'ok' : mid.error.code).toBe('transferWall');
    // смешивание у стены с грануляцией: пары «смешивание — грануляция» у класса нет
    const back = unit('blending', [4350, 750]);
    expect(back.ok ? 'ok' : back.error.code).toBe('transferWall');
    // в таблетирование перегрузку не ставят: таблетки — на тележке (#170)
    const press = unit('compression', [4950, 750]);
    expect(press.ok ? 'ok' : press.error.code).toBe('notHere');
  });
});

describe('перенос через перегрузку', () => {
  test('без тележки: пуск аппаратчиком на месте, масса на производительность, единица держит серию до конца', () => {
    const { s, vac } = withVacuum();
    const carrying = () => Object.values(s.tasks).find(t => t.kind === 'carry' && t.room === 'blending');
    until(s, () => !!carrying());
    const t = carrying()!;
    const b = s.batches[t.batch!];
    expect(t.asset).toBe(vac);
    expect(t.work).toBe(db.equipment[VAC].transfer!.setup);
    expect(b.room).toBe('granulation');
    const run = transferTime(db, VAC, stageMass(db, b, b.stage));
    // 500 кг/ч: серия парацетамола — порядка десятков минут, не часы
    expect(run).toBeGreaterThan(5 * MIN);
    expect(run).toBeLessThan(HOUR);
    until(s, () => !s.tasks[t.id], 1);
    expect(s.equipment[vac].batch).toBe(b.id);
    expect(s.rooms.granulation.batch).toBe(b.id);
    const ev = s.agenda.heap.find(x => x.e.kind === 'transfer' && x.e.batch === b.id)!;
    expect(ev.t - s.t).toBeLessThanOrEqual(run);
    until(s, () => !s.equipment[vac].batch, 1);
    expect(b.room).toBe('blending');
    expect(s.rooms.granulation.batch).toBeUndefined();
    expect(check(db, s)).toEqual([]);
  });

  test('негодная перегрузка — тележка: до записи квалификации полупродукт везут, как раньше', () => {
    const { s, vac } = withVacuum();
    s.assets[vac].path = { step: 'iq' } as never;
    expect(transferVia(db, s, 'granulation', 'blending')).toBeUndefined();
    const carrying = () => Object.values(s.tasks).find(t => t.kind === 'carry' && t.room === 'blending');
    until(s, () => !!carrying());
    expect(carrying()!.asset).toBeUndefined();
    expect(carrying()!.work).toBe(CARRY_WORK);
  });

  test('моется с оборудованием своего помещения: мойка грануляции дольше на мойку перегрузки', () => {
    const s0 = newPlant(db, { scenario: SC });
    const { s } = withVacuum();
    const c = db.equipment[VAC].cleaning;
    expect(washWork(db, s, 'granulation', false) - washWork(db, s0, 'granulation', false)).toBe(c.minor);
    expect(washWork(db, s, 'granulation', true) - washWork(db, s0, 'granulation', true)).toBe(c.major);
  });
});

describe('расписание', () => {
  test('смешивание — не раньше пуска и перегрузки массы серии; аппаратчику — меньше работы, чем с тележкой', () => {
    const s0 = newPlant(db, { scenario: SC });
    const { s } = withVacuum();
    const tr = db.equipment[VAC].transfer!;
    expect(tr.setup).toBeLessThan(CARRY_WORK);
    const gap = (x: PlantState) => {
      const f = forecast(db, x);
      const gran = f.bars.find(r => r.kind === 'stage' && r.stage === 'granulate')!;
      const blend = f.bars.find(r => r.kind === 'stage' && r.batch === gran.batch && r.stage === 'blend')!;
      return { gap: blend.from - gran.to, b: x.batches[gran.batch!] };
    };
    const v = gap(s);
    const k = db.recipes[v.b.recipe].stages.findIndex(st => st.id === 'blend');
    expect(v.gap).toBeGreaterThanOrEqual(tr.setup + transferTime(db, VAC, stageMass(db, v.b, k)));
    expect(v.gap).not.toBe(gap(s0).gap);
  });
});

describe('сохранение', () => {
  test('перегрузка в пути — в сохранении, загрузка — тот же завод', () => {
    const { s, vac } = withVacuum();
    until(s, () => !!s.equipment[vac].batch);
    const back = fromSave(db, toSave(s));
    expect(JSON.stringify(back)).toBe(JSON.stringify(s));
    advance(back, DAY);
    advance(s, DAY);
    expect(toSave(back)).toBe(toSave(s));
  });
});
