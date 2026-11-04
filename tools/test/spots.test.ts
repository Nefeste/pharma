// Б1л: потери у мест по суткам (src/engine/lean.ts). Место задачи — линия, помещение задачи, зона или стеллаж паллеты,
// рампа фуры, помещение точки работы, иначе двор; ожидание — у места задачи с причиной раздатчика, «нет смены» тоже там;
// перевозки — у места, откуда везли; переходы — у места задачи, к посту и выходу — у помещения, куда шли; уборки и
// переналадки, повторные уборки и брак — их часы. Место проверяет срез каждую минуту своим кодом; по всем местам в
// сумме — учёт отделов (1ж); вещи — до пяти у прошлых суток, у суток старше восьми их нет; образец схемы 34 читается и
// живёт дальше — учёт с мгновения загрузки, образец схемы 47 — как есть (с 0.0.72 Б1л — поверх 0.0.71, схема 47).
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, MIN, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { batchLost, THINGS_DAYS, THINGS_TOP, YARD } from '../../src/engine/lean';
import { geo } from '../../src/engine/line';
import { roomAt } from '../../src/engine/places';
import { planOf } from '../../src/engine/plant';
import { fromSave } from '../../src/engine/save';
import type { DayLoss, PlantState, Task } from '../../src/engine/types';

const SC = 'scn.proto';
const plan = planOf(db, db.plants[db.scenarios[SC].plant]);
const PLANNED = new Set(['train', 'trainCheck']);

/** Место задачи своим кодом. */
function spotOf(s: PlantState, t: Task): string {
  if (t.line) return `line:${t.line}`;
  if (t.room) return t.room;
  if (t.from.kind === 'slot') return `zone:${plan.slot[t.from.id].group}`;
  if (t.from.kind === 'truck') return `dock:${s.trucks[t.from.id].dock}`;
  return roomAt(plan.plant, t.from.x, t.from.z) ?? YARD;
}

/** Ожидание у мест — суммой по суткам, с отрезками, которые ещё идут: `место/причина` → секунды. */
function waited(s: PlantState): Map<string, number> {
  const out = new Map<string, number>();
  const add = (k: string, sec: number) => out.set(k, (out.get(k) ?? 0) + sec);
  for (const d of s.losses)
    for (const [spot, x] of Object.entries(d.spots)) for (const w of Object.values(x.wait ?? {})) for (const [c, sec] of Object.entries(w ?? {})) if (c !== 'dock') add(`${spot}/${c}`, sec ?? 0);
  for (const id of s.open) {
    const t = s.tasks[id];
    if (t.why && t.since !== undefined && !PLANNED.has(t.kind)) add(`${spotOf(s, t)}/${t.why}`, s.t - t.since);
  }
  return out;
}

const sumOf = (o: Partial<Record<string, number>> | undefined) => Object.values(o ?? {}).reduce<number>((n, x) => n + (x ?? 0), 0);

describe('учёт у мест', () => {
  test('30 суток со срезом каждую минуту: место задачи — по правилу, часы ожидания — с точностью до минуты на смену причины', () => {
    const s = newPlant(db, { scenario: SC });
    const got = new Map<string, number>();
    const changes = new Map<string, number>();
    const prev = new Map<string, string>();
    const start = waited(s);
    const end = s.t + 30 * DAY;
    // работа линии — переналадка, очистка и её проверка — в сутки конца задачи (очисток у задания бывает две: вторая —
    // после уборки помещения линии, Б1е)
    const lineWork = new Map<number, number>();
    const busy = new Set<string>();
    while (s.t < end) {
      for (const t of Object.values(s.tasks))
        if (t.state === 'busy' && t.times && !busy.has(t.id) && (t.kind === 'changeover' || t.kind === 'clearance' || t.kind === 'clearCheck')) {
          busy.add(t.id);
          const day = momentOf(s.start, t.times[4]).day;
          lineWork.set(day, (lineWork.get(day) ?? 0) + t.work);
        }
      const seen = new Set<string>();
      for (const id of s.open) {
        const t = s.tasks[id];
        if (!t.why || PLANNED.has(t.kind)) continue;
        const k = `${spotOf(s, t)}/${t.why}`;
        got.set(k, (got.get(k) ?? 0) + MIN);
        seen.add(t.id);
        const was = prev.get(t.id);
        if (was !== k) for (const x of [was, k]) if (x) changes.set(x, (changes.get(x) ?? 0) + 1);
        prev.set(t.id, k);
      }
      for (const [id, k] of prev)
        if (!seen.has(id)) {
          changes.set(k, (changes.get(k) ?? 0) + 1);
          prev.delete(id);
        }
      apply(db, s, { kind: 'advance', seconds: MIN });
    }
    const acc = waited(s);
    const keys = new Set([...got.keys(), ...acc.keys()]);
    for (const k of keys) {
      const sec = (acc.get(k) ?? 0) - (start.get(k) ?? 0);
      expect(Math.abs((got.get(k) ?? 0) - sec)).toBeLessThanOrEqual(MIN * ((changes.get(k) ?? 0) + 1));
    }
    // у линии за сутки — работа её переналадок, очисток и проверок очистки
    const today = momentOf(s.start, s.t).day;
    for (const d of s.losses.filter(x => x.day < today)) {
      const sec = Object.entries(d.spots).filter(([k]) => k.startsWith('line:')).reduce((n, [, x]) => n + (x.setup ?? 0), 0);
      expect(sec).toBe(lineWork.get(d.day) ?? 0);
    }
    expect([...lineWork.values()].some(x => x > 0)).toBe(true);
    // за месяц ждали у помещений, у линии, у зон и стеллажей склада и у лаборатории — и «нет смены», и с другими причинами
    for (const p of ['lab', 'line:', 'zone:', 'compression']) expect([...keys].some(k => k.startsWith(p))).toBe(true);
    expect([...keys].some(k => k.endsWith('/shift'))).toBe(true);
    expect([...keys].some(k => k.endsWith('/people'))).toBe(true);
  });

  describe('90 суток', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: 90 * DAY });
    const today = momentOf(s.start, s.t).day;
    const past = s.losses.filter(d => d.day < today);

    test('по всем местам за сутки — учёт отделов: ожидание по отделу и причине, перевозки, переходы; инварианты целы', () => {
      expect(check(db, s)).toEqual([]);
      for (const d of past) {
        // по отделу и причине — до секунды
        const dept: Record<string, number> = {};
        for (const [k, w] of Object.entries(d.wait)) for (const [c, sec] of Object.entries(w ?? {})) dept[`${k}/${c}`] = (dept[`${k}/${c}`] ?? 0) + (sec ?? 0);
        const spots: Record<string, number> = {};
        for (const x of Object.values(d.spots)) for (const [k, w] of Object.entries(x.wait ?? {})) for (const [c, sec] of Object.entries(w ?? {})) spots[`${k}/${c}`] = (spots[`${k}/${c}`] ?? 0) + (sec ?? 0);
        expect(spots).toEqual(dept);
        const xs = Object.values(d.spots);
        expect(xs.reduce((n, x) => n + (x.move ?? 0), 0)).toBe(sumOf(Object.fromEntries(Object.entries(d.move).map(([k, v]) => [k, v?.sec]))));
        expect(xs.reduce((n, x) => n + (x.walk ?? 0), 0)).toBe(sumOf(Object.fromEntries(Object.entries(d.walk).map(([k, v]) => [k, v?.sec]))));
      }
    });

    test('уборки помещений — часы уборок суток, у линии — не меньше переналадок; повторные — отдельно', () => {
      let again = 0;
      for (const d of past) {
        const rooms = Object.entries(d.spots).filter(([k]) => !k.startsWith('line:'));
        const line = Object.entries(d.spots).filter(([k]) => k.startsWith('line:'));
        expect(rooms.reduce((n, [, x]) => n + (x.setup ?? 0) + (x.again ?? 0), 0)).toBe(d.cleans.majorSec + d.cleans.minorSec);
        // очистка линии и её проверка — сверх переналадок: их сверяет срез 30 суток
        expect(line.reduce((n, [, x]) => n + (x.setup ?? 0), 0)).toBeGreaterThanOrEqual(d.changes.sec);
        again += rooms.reduce((n, [, x]) => n + (x.again ?? 0), 0);
        // вещь повторной уборки — серия, для которой убирали
        for (const [, x] of rooms) for (const r of Object.keys(x.things?.again ?? {})) expect(r.startsWith('b:')).toBe(true);
      }
      // число повторных уборок пишется, когда чистоту нашли просроченной, часы — когда уборка кончилась: за 90 суток есть и то,
      // и другое
      expect(again).toBeGreaterThan(0);
      expect(past.reduce((n, d) => n + d.recleans, 0)).toBeGreaterThan(0);
    });

    test('брак камер — у линии, время машин на номинале на отбракованное, в сутки конца задания', () => {
      const lost = new Map<number, number>();
      for (const b of Object.values(s.batches)) {
        const j = b.pack;
        if (j?.state !== 'done' || j.end === undefined) continue;
        const g = geo(db, s, s.lines[j.line], j);
        const sec = [j.blisterRejects ?? 0, j.cartonRejects ?? 0].reduce((n, x, i) => n + Math.floor((x * g.unit[i] * 60) / g.nominal[i]), 0);
        const day = momentOf(s.start, j.end).day;
        lost.set(day, (lost.get(day) ?? 0) + sec);
      }
      let total = 0;
      for (const d of past) {
        const sec = Object.entries(d.spots).filter(([k]) => k.startsWith('line:')).reduce((n, [, x]) => n + (x.defect ?? 0), 0);
        if (!s.losses.some(x => x.day === d.day && x.defects.batches > 0)) expect(sec).toBe(lost.get(d.day) ?? 0);
        total += sec;
      }
      expect(total).toBeGreaterThan(0);
    });

    test('вещи: у прошлых суток — до пяти у вида, у суток старше восьми — нет; у нынешних — все', () => {
      for (const d of s.losses) {
        for (const x of Object.values(d.spots)) {
          if (d.day <= today - THINGS_DAYS) {
            expect(x.things).toBeUndefined();
            continue;
          }
          for (const m of Object.values(x.things ?? {})) {
            const n = Object.keys(m ?? {}).length;
            if (d.day < today) expect(n).toBeLessThanOrEqual(THINGS_TOP);
            // у вещей — только свои секунды: сумма не больше часов вида
            expect(n).toBeGreaterThan(0);
          }
          for (const k of ['move', 'walk', 'setup', 'again', 'defect'] as const) expect(sumOf(x.things?.[k])).toBeLessThanOrEqual(x[k] ?? 0);
        }
      }
      // у нынешних суток переходы — у людей все: сумма вещей — часы переходов
      const now = s.losses.at(-1)!;
      for (const x of Object.values(now.spots)) expect(sumOf(x.things?.walk)).toBe(x.walk ?? 0);
      // вещи — по видам: серии, партии, паллеты, заказы, люди, помещения
      const refs = new Set(s.losses.flatMap(d => Object.values(d.spots).flatMap(x => Object.values(x.things ?? {}).flatMap(m => Object.keys(m ?? {}).map(r => r.split(':')[0])))));
      for (const r of refs) expect(['b', 'l', 'u', 'o', 'po', 'w', 'c', 'p', 'r', 'm']).toContain(r);
      expect(refs.has('b') && refs.has('p')).toBe(true);
    });
  });

  test('отклонённая серия — часы её стадий у помещений и упаковки у линии, в сутки решения', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: 20 * DAY });
    const b = Object.values(s.batches).find(x => x.records.length > 0 && x.pack?.end !== undefined)!;
    expect(b).toBeDefined();
    const before = structuredClone(s.losses.at(-1)!.spots);
    batchLost(s, b);
    const d: DayLoss = s.losses.at(-1)!;
    const add = new Map<string, number>();
    for (const r of b.records) add.set(r.room, (add.get(r.room) ?? 0) + r.end - r.start);
    add.set(`line:${b.pack!.line}`, b.pack!.end! - b.pack!.start!);
    for (const [spot, sec] of add) {
      expect((d.spots[spot].defect ?? 0) - (before[spot]?.defect ?? 0)).toBe(sec);
      expect(d.spots[spot].things?.defect?.[`b:${b.id}`]).toBeGreaterThanOrEqual(sec);
    }
  });
});

describe('сохранения', () => {
  test('образец схемы 34: учёт у мест — с мгновения загрузки, у прошлых суток его нет', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v34.json', import.meta.url)).text();
    const s = fromSave(db, json);
    const day0 = momentOf(s.start, s.t).day;
    for (const d of s.losses) expect(d.spots).toEqual({});
    expect(check(db, s)).toEqual([]);
    apply(db, s, { kind: 'advance', seconds: 3 * DAY });
    expect(check(db, s)).toEqual([]);
    for (const d of s.losses) if (d.day < day0) expect(d.spots).toEqual({});
    expect(s.losses.some(d => d.day >= day0 && Object.keys(d.spots).length > 0)).toBe(true);
  });

  test('образец схемы 47 читается как есть: у грязного помещения — серия, учёт нынешних суток копится дальше', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v47.json', import.meta.url)).text();
    const s = fromSave(db, json);
    const raw = JSON.parse(json) as PlantState;
    expect(s.losses.map(d => d.spots)).toEqual(raw.losses.map(d => d.spots));
    expect(Object.values(s.rooms).some(r => r.after !== undefined && r.status === 'dirty')).toBe(true);
    const at = s.losses.at(-1)!.day;
    const before = sumOf(Object.fromEntries(Object.entries(s.losses.at(-1)!.spots).map(([k, x]) => [k, x.walk])));
    apply(db, s, { kind: 'advance', seconds: 2 * DAY });
    expect(check(db, s)).toEqual([]);
    const after = s.losses.find(d => d.day === at)!;
    expect(sumOf(Object.fromEntries(Object.entries(after.spots).map(([k, x]) => [k, x.walk])))).toBeGreaterThanOrEqual(before);
  });
});
