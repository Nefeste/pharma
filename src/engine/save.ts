// Сохранение — снимок состояния со схемой и цепочкой миграций (ADR студии 0004; docs/02-architecture.md, §13). Забытая
// миграция стирает игру человека, поэтому каждый шаг закреплён образцом в tools/test/fixtures/.
import type { ContentDb } from '../content/types';
import { type Agenda, schedule } from './core/agenda';
import { HOUR } from './core/calendar';
import { newCash } from './cash';
import { newLines } from './line';
import { newParts } from './maint';
import { newCustomers } from './market';
import { planOf } from './plant';
import { nominal } from './quality';
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
  // 2 → 3 (часть 1б): лаборатория. Приборы — по плану завода. У партий — истинные свойства и паспорт, номинальные:
  // средние, качественные — «соответствует». Партии в карантине уходят на отбор проб в ближайший час.
  2: (raw, db) => {
    const plant = db.plants[raw.plant as string];
    if (!plant) throw new Error(`save: no plant ${String(raw.plant)}`);
    const instruments: Raw = {};
    for (const i of plant.instruments) instruments[i.id] = { id: i.id, type: i.type, room: i.room };
    for (const lot of Object.values(raw.lots as Record<string, Raw>)) {
      const props = nominal(db, lot.material as string);
      lot.truth = props;
      lot.coa = { ...props };
    }
    return { ...raw, instruments, samples: {}, tests: {}, deviations: {} };
  },
  // 3 → 4 (часть 1в): производство. Помещения — чистые с момента сохранения, оборудование — по плану; серий нет:
  // задания сценария в старое сохранение не добавляются, их даёт игрок.
  3: (raw, db) => {
    const plant = db.plants[raw.plant as string];
    if (!plant) throw new Error(`save: no plant ${String(raw.plant)}`);
    const rooms: Raw = {};
    for (const r of plant.rooms) rooms[r.id] = { id: r.id, type: r.type, status: 'clean', since: raw.t };
    const equipment: Raw = {};
    for (const e of plant.equipment) equipment[e.id] = { id: e.id, type: e.type, room: e.room };
    return { ...raw, rooms, equipment, batches: {} };
  },
  // 4 → 5 (часть 1г): упаковочные линии — по плану, свободны, не налажены. Балк старых серий ждёт команды «упаковать»:
  // позиции у них нет.
  4: (raw, db) => {
    if (!db.plants[raw.plant as string]) throw new Error(`save: no plant ${String(raw.plant)}`);
    return { ...raw, lines: newLines(db, raw.plant as string, raw.t as number) };
  },
  // 5 → 6 (часть 1д): касса — проводки и счета от остатка на момент сохранения (он уже в копейках); выпущенная раньше ГП —
  // в обороте с момента выпуска; покупатели сценария копят спрос с момента миграции; заказов и отгрузок нет.
  5: (raw, db) => {
    const sc = db.scenarios[raw.scenario as string];
    if (!sc) throw new Error(`save: no scenario ${String(raw.scenario)}`);
    const lots = raw.lots as Record<string, Raw>;
    for (const b of Object.values(raw.batches as Record<string, Raw>)) {
      const fg = (b.pack as Raw | undefined)?.fg as string | undefined;
      if (b.status === 'released' && fg && lots[fg]) lots[fg].circulation = b.released;
    }
    const t = raw.t as number;
    return { ...raw, cash: newCash(raw.cash as number, t), customers: newCustomers(sc, t), orders: {}, shipments: {} };
  },
  // 6 → 7 (часть 1е): узлы машин — с износом сценария и новым запасом до отказа; ЗИП — начальный уровень; заказов
  // запчастей и записей журнала нет. Помещения плана, которых не было (мастерская), — чистые. Аварий нет: у времени
  // машин — строка «авария», 0. Стадия, идущая при сохранении, наработку узлам не добавит.
  6: (raw, db) => {
    const plant = db.plants[raw.plant as string];
    if (!plant) throw new Error(`save: no plant ${String(raw.plant)}`);
    const rooms = raw.rooms as Record<string, Raw>;
    for (const r of plant.rooms) rooms[r.id] ??= { id: r.id, type: r.type, status: 'clean', since: raw.t };
    for (const l of Object.values(raw.lines as Record<string, { machines: { times: Raw }[] }>)) for (const m of l.machines) m.times.fail ??= 0;
    for (const b of Object.values(raw.batches as Record<string, Raw>)) {
      for (const o of ((b.pack as Raw | undefined)?.oee as { times: Raw }[] | undefined) ?? []) o.times.fail ??= 0;
    }
    const out = { ...raw, parts: {}, spares: {}, spareOrders: {}, maintLog: [] };
    newParts(db, out as unknown as PlantState);
    return out;
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
