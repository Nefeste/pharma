// Сохранение — снимок состояния со схемой и цепочкой миграций (ADR студии 0004; docs/02-architecture.md, §13). Забытая
// миграция стирает игру человека, поэтому каждый шаг закреплён образцом в tools/test/fixtures/.
import type { ContentDb } from '../content/types';
import { type Agenda, schedule } from './core/agenda';
import { HOUR } from './core/calendar';
import { planOf } from './plant';
import { type PlantEvent, type PlantState, SCHEMA } from './types';

type Raw = Record<string, unknown>;

/** Шаг миграции: снимок схемы N → снимок схемы N + 1. Индекс — схема, из которой шаг ведёт. */
const STEPS: Record<number, (raw: Raw, db: ContentDb) => Raw> = {
  // 1 → 2 (часть 1а): склад, закупки, люди и техника. Штат и техника — по сценарию, у входа и на стоянке; запаса и
  // заказов сценария нет: сохранение схемы 1 — завод без склада. Час — с ближайшего целого часа.
  1: (raw, db) => {
    const sc = db.scenarios[raw.scenario as string];
    if (!sc) throw new Error(`save: no scenario ${String(raw.scenario)}`);
    const plan = planOf(db, sc.plant);
    const next: Record<string, number> = {};
    const people: Raw = {};
    for (const row of sc.staff) {
      for (let i = 0; i < row.n; i++) {
        const id = `E${(next.E = (next.E ?? 0) + 1)}`;
        people[id] = { id, role: row.role, shift: row.shift, skill: row.skill, x: plan.entrance.x, z: plan.entrance.z };
      }
    }
    const vehicles: Raw = {};
    for (const row of sc.vehicles) {
      for (let i = 0; i < row.n; i++) {
        const id = `V${(next.V = (next.V ?? 0) + 1)}`;
        vehicles[id] = { id, type: row.type, x: plan.park.x, z: plan.park.z };
      }
    }
    const t = raw.t as number;
    schedule(raw.agenda as Agenda<PlantEvent>, Math.floor(t / HOUR) * HOUR + HOUR, { kind: 'hour' });
    return {
      ...raw,
      plant: sc.plant,
      cash: sc.cash,
      next,
      lots: {},
      containers: {},
      units: {},
      slots: {},
      pos: {},
      trucks: {},
      people,
      vehicles,
      tasks: {},
      open: [],
    };
  },
};

export function toSave(s: PlantState): string {
  return JSON.stringify(s);
}

export function fromSave(db: ContentDb, json: string): PlantState {
  let raw = JSON.parse(json) as Raw;
  let v = raw.schema;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error('save: no schema');
  if (v > SCHEMA) throw new Error(`save: schema ${v} is newer than ${SCHEMA}`);
  while (v < SCHEMA) {
    const step = STEPS[v];
    if (!step) throw new Error(`save: no migration from schema ${v}`);
    raw = step(raw, db);
    v++;
    raw.schema = v;
  }
  return raw as unknown as PlantState;
}
