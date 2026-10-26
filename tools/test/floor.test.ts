// Б1и: учёт помещений по суткам и выпуск сменного задания по часам (src/engine/lean.ts). У полных суток помещения сумма
// состояний — 86 400 с; состояние — по правилу спецификации, его проверяет срез каждую минуту своим кодом; работа
// упаковки — ход её заданий; часы смены в сумме — её выпуск; образец схемы 29 читается и живёт дальше — учёт с мгновения
// загрузки, у прошлых суток его нет; образец схемы 30 — как есть, отрезки и часы смены идут дальше.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR, MIN, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { NO_ROOM, roomsOf } from '../../src/engine/lean';
import { runSeed } from '../../src/engine/plan/run';
import { planOf } from '../../src/engine/plant';
import { fromSave } from '../../src/engine/save';
import type { PlantState, RoomPhase, RoomTimes, TaskKind } from '../../src/engine/types';

const SC = 'scn.proto';
const plan = planOf(db, db.scenarios[SC].plant);
const PHASES: RoomPhase[] = ['work', 'clean', 'held', 'dirty', 'free'];
const lineRoom: Record<string, string> = Object.fromEntries(plan.plant.lines.map(l => [l.id, l.room]));
const PREP = new Set<TaskKind>(['clean', 'roomClean', 'changeover', 'clearance', 'clearCheck']);

/** Правило спецификации своим кодом: работа, уборка и наладка, серия ждёт, грязно, свободно. */
function phase(s: PlantState, id: string): RoomPhase {
  const room = s.rooms[id];
  const busy = Object.values(s.tasks).filter(t => t.state === 'busy');
  if (room.batch && busy.some(t => t.kind === 'stage' && t.batch === room.batch)) return 'work';
  if (room.batch && s.batches[room.batch].pack?.state === 'running') return 'work';
  if (busy.some(t => PREP.has(t.kind) && (t.room === id || (t.line !== undefined && lineRoom[t.line] === id)))) return 'clean';
  if (room.batch) return 'held';
  return room.status === 'dirty' ? 'dirty' : 'free';
}

/** Учёт помещений по суткам — суммой, с отрезком, который ещё не закрыт. */
function accounted(s: PlantState): Record<string, RoomTimes> {
  const out: Record<string, RoomTimes> = {};
  for (const d of s.losses) for (const [id, x] of Object.entries(d.rooms)) for (const k of PHASES) (out[id] ??= { ...NO_ROOM })[k] += x[k];
  for (const id of roomsOf(plan).rooms) {
    const r = s.rooms[id];
    if (r.phase && r.phaseAt !== undefined) (out[id] ??= { ...NO_ROOM })[r.phase] += s.t - r.phaseAt;
  }
  return out;
}

describe('учёт помещений', () => {
  test('помещения учёта — где по плану оборудование или линия, по порядку плана', () => {
    expect(roomsOf(plan).rooms).toEqual(['dispensing', 'granulation', 'blending', 'compression', 'packaging']);
  });

  test('30 суток со срезом каждую минуту: состояние по правилу, часы — с точностью до минуты на смену состояния', () => {
    const s = newPlant(db, { scenario: SC });
    const ids = roomsOf(plan).rooms;
    const got: Record<string, RoomTimes> = Object.fromEntries(ids.map(id => [id, { ...NO_ROOM }]));
    const changes: Record<string, number> = Object.fromEntries(ids.map(id => [id, 0]));
    const prev: Record<string, RoomPhase | undefined> = {};
    const end = s.t + 30 * DAY;
    while (s.t < end) {
      for (const id of ids) {
        const p = phase(s, id);
        expect(s.rooms[id].phase).toBe(p);
        got[id][p] += MIN;
        if (prev[id] && prev[id] !== p) changes[id]++;
        prev[id] = p;
      }
      apply(db, s, { kind: 'advance', seconds: MIN });
    }
    const acc = accounted(s);
    for (const id of ids) {
      expect(changes[id]).toBeGreaterThan(20);
      for (const k of PHASES) expect(Math.abs(got[id][k] - acc[id][k])).toBeLessThanOrEqual(MIN * changes[id]);
    }
    // за месяц каждое помещение и работало, и стояло грязным, и убиралось
    for (const id of ids) for (const k of ['work', 'clean', 'dirty', 'free'] as const) expect(acc[id][k]).toBeGreaterThan(0);
  });

  describe('90 суток', () => {
    const s = newPlant(db, { scenario: SC });
    const t0 = s.t;
    apply(db, s, { kind: 'advance', seconds: 90 * DAY });
    const first = momentOf(s.start, t0).day;
    const last = momentOf(s.start, s.t).day;

    test('у полных суток каждого помещения сумма — 86 400 с; первые сутки — с начала игры', () => {
      let full = 0;
      for (const d of s.losses) {
        for (const id of roomsOf(plan).rooms) {
          const sum = PHASES.reduce((n, k) => n + (d.rooms[id]?.[k] ?? 0), 0);
          if (d.day > first && d.day < last) {
            expect(sum).toBe(DAY);
            full++;
          }
          if (d.day === first) expect(sum).toBe(DAY - (t0 % DAY));
        }
      }
      expect(full).toBe(5 * (last - first - 1));
      // в помещениях производства серия держит помещение между стадиями, в упаковке — нет: она там только упаковывает
      const acc = accounted(s);
      expect(acc.granulation.held).toBeGreaterThan(0);
      expect(acc.packaging.held).toBe(0);
    });

    test('работа упаковки — ход её заданий; работа помещений производства — не меньше записей стадий без простоев', () => {
      const acc = accounted(s);
      let pack = 0;
      for (const b of Object.values(s.batches)) if (b.pack?.start !== undefined) pack += (b.pack.end ?? s.t) - b.pack.start;
      expect(acc.packaging.work).toBe(pack);
      const rec: Record<string, number> = {};
      const n: Record<string, number> = {};
      for (const b of Object.values(s.batches)) {
        for (const r of b.records) {
          rec[r.room] = (rec[r.room] ?? 0) + r.end - r.start - (r.stops ?? []).reduce((m, x) => m + x.to - x.from, 0);
          n[r.room] = (n[r.room] ?? 0) + 1;
        }
      }
      // стадия в работе с назначения: аппаратчик ещё идёт к помещению — не больше пяти минут на стадию
      for (const id of ['dispensing', 'granulation', 'blending', 'compression']) {
        expect(acc[id].work).toBeGreaterThanOrEqual(rec[id]);
        expect(acc[id].work - rec[id]).toBeLessThanOrEqual(n[id] * 5 * MIN);
      }
    });

    test('выпуск сменного задания по часам: в сумме — его факт, часов — сколько в смене, конец — по графику', () => {
      const done = s.shiftTasks.filter(t => t.to !== undefined);
      expect(done.length).toBeGreaterThan(50);
      for (const t of done) {
        expect(t.hours!.reduce((m, x) => m + x, 0)).toBe(t.fact!);
        expect(t.hours!.length * HOUR).toBe(t.to! - t.from);
        expect(t.ends).toBe(t.to!);
      }
      // открытое задание: часы — до прошлого целого часа
      for (const t of s.shiftTasks.filter(x => x.to === undefined)) expect(t.hours!.length).toBe(Math.floor((s.t - t.from) / HOUR));
    });

    test('двойник прогона плана ведёт учёт, как движок; сам завод не тронут', () => {
      const before = structuredClone(s.losses.at(-1)!.rooms);
      const c = runSeed(db, s, [], { days: 3, seeds: 1 }, 0);
      const day = momentOf(c.start, c.t).day - 1;
      const d = c.losses.find(x => x.day === day)!;
      for (const id of roomsOf(plan).rooms) expect(PHASES.reduce((m, k) => m + d.rooms[id][k], 0)).toBe(DAY);
      expect(s.losses.at(-1)!.rooms).toEqual(before);
    });
  });
});

describe('сохранения', () => {
  test('образец схемы 29: учёт — с мгновения загрузки, у прошлых суток и прошлых сменных заданий его нет', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v29.json', import.meta.url)).text();
    const s = fromSave(db, json);
    const t0 = s.t;
    const day0 = momentOf(s.start, t0).day;
    const old = s.shiftTasks.length;
    for (const d of s.losses) expect(d.rooms).toEqual({});
    for (const id of roomsOf(plan).rooms) {
      expect(s.rooms[id].phase).toBeDefined();
      expect(s.rooms[id].phaseAt).toBe(t0);
    }
    expect(s.shiftTasks.every(t => t.hours === undefined && t.ends === undefined)).toBe(true);
    apply(db, s, { kind: 'advance', seconds: 3 * DAY });
    for (const d of s.losses) {
      for (const id of roomsOf(plan).rooms) {
        const sum = PHASES.reduce((n, k) => n + (d.rooms[id]?.[k] ?? 0), 0);
        if (d.day < day0) expect(sum).toBe(0);
        else if (d.day === day0) expect(sum).toBe(DAY - (t0 % DAY));
        else if (d.day < momentOf(s.start, s.t).day) expect(sum).toBe(DAY);
      }
    }
    const fresh = s.shiftTasks.slice(old);
    expect(fresh.length).toBeGreaterThan(0);
    for (const t of fresh.filter(x => x.to !== undefined)) expect(t.hours!.reduce((m, x) => m + x, 0)).toBe(t.fact!);
    // задание, открытое до загрузки, закрывается без часов
    expect(s.shiftTasks.slice(0, old).every(t => t.hours === undefined)).toBe(true);
  });

  test('образец схемы 30 читается как есть: отрезки, которые шли, и выпуск по часам идут дальше', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v30.json', import.meta.url)).text();
    const s = fromSave(db, json);
    const raw = JSON.parse(json) as PlantState;
    const ids = roomsOf(plan).rooms;
    const day0 = momentOf(s.start, s.t).day;
    const open = s.shiftTasks.filter(t => t.to === undefined && t.hours !== undefined);
    // посреди учёта: серия держит помещение без работы, другое убирают или налаживают, линия упаковывает
    const phases = new Set(ids.map(id => s.rooms[id].phase));
    for (const p of ['held', 'clean', 'work'] as const) expect(phases.has(p)).toBe(true);
    expect(open.some(t => t.hours!.length >= 2)).toBe(true);
    for (const id of ids) expect([s.rooms[id].phase, s.rooms[id].phaseAt]).toEqual([raw.rooms[id].phase, raw.rooms[id].phaseAt]);
    expect(s.losses.map(d => d.rooms)).toEqual(raw.losses.map(d => d.rooms));
    apply(db, s, { kind: 'advance', seconds: 2 * DAY });
    // сутки сохранения и следующие — полные: отрезок, который шёл при сохранении, закрыт в свои сутки
    for (const d of s.losses.filter(x => x.day >= day0 && x.day < momentOf(s.start, s.t).day)) {
      for (const id of ids) expect(PHASES.reduce((n, k) => n + d.rooms[id][k], 0)).toBe(DAY);
    }
    for (const t of open) {
      const x = s.shiftTasks.find(y => y.line === t.line && y.from === t.from)!;
      expect(x.hours!.slice(0, t.hours!.length)).toEqual(t.hours!);
      expect(x.hours!.reduce((m, h) => m + h, 0)).toBe(x.fact!);
    }
  });
});
