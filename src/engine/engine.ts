// Движок завода (docs/02-architecture.md, §1, §3): `newPlant` и `apply`. Время идёт по событиям очереди, при равном
// времени — по номеру постановки. Ход времени срезами даёт то же состояние, что одним куском: это проверяют тесты.
//
// Устройство хода времени — как в «Больнице» (её src/engine/shift/engine.ts, `later` и `catchUp`): команда со временем
// ставит `until`, а `catchUp` проживает события по порядку, пока бюджет кадра `more()` позволяет. Недожитое
// доживается в следующих кадрах; любая следующая команда сначала доживает всё.
import type { ContentDb, Id } from '../content/types';
import { agenda, nextTime, popDue, schedule } from './core/agenda';
import { DAY, HOUR } from './core/calendar';
import { planOf } from './plant';
import { createLot, findSlot } from './stock';
import { placePo } from './supply';
import { dispatch, release } from './tasks';
import { type Command, type Notice, type PlantEvent, type PlantState, SCHEMA } from './types';
import { truckArrives, wmsDone } from './wms';

/** Час планёрки (геймдизайн, §2). */
export const MORNING = 8 * HOUR;

export interface NewPlant {
  scenario: Id;
  /** зерно партии; нет — зерно сценария */
  seed?: number;
}

export function newPlant(db: ContentDb, o: NewPlant): PlantState {
  const sc = db.scenarios[o.scenario];
  if (!sc) throw new Error(`no scenario ${o.scenario}`);
  const plan = planOf(db, sc.plant);
  const s: PlantState = {
    schema: SCHEMA,
    content: db.hash,
    scenario: sc.id,
    plant: sc.plant,
    seed: (o.seed ?? sc.seed) >>> 0,
    rng: {},
    start: sc.start.date,
    t: sc.start.hour * HOUR,
    agenda: agenda<PlantEvent>(),
    day: 0,
    cash: sc.cash,
    next: {},
    lots: {},
    containers: {},
    units: {},
    slots: {},
    pos: {},
    trucks: {},
    people: {},
    vehicles: {},
    tasks: {},
    open: [],
  };
  // люди — у входа, техника — на стоянке
  for (const row of sc.staff) {
    for (let i = 0; i < row.n; i++) {
      const id = `E${(s.next.E = (s.next.E ?? 0) + 1)}`;
      s.people[id] = { id, role: row.role, shift: row.shift, skill: row.skill, x: plan.entrance.x, z: plan.entrance.z };
    }
  }
  for (const row of sc.vehicles) {
    for (let i = 0; i < row.n; i++) {
      const id = `V${(s.next.V = (s.next.V ?? 0) + 1)}`;
      s.vehicles[id] = { id, type: row.type, x: plan.park.x, z: plan.park.z };
    }
  }
  // запас на старте — разрешённые партии на стеллажах, ближе к шлюзу для материалов и ниже
  const near = plan.slot[plan.byKind.staging[0].id];
  for (const st of sc.stock) {
    createLot(db, s, {
      material: st.material,
      supplier: 'start',
      qty: st.qty,
      status: 'released',
      where: () => {
        const sl = findSlot(s, plan, db.materials[st.material].storage === 'cold' ? 'cold' : 'storage', near, 99);
        if (!sl) throw new Error(`scenario ${sc.id}: no slot for start stock ${st.material}`);
        return { kind: 'slot', id: sl.id };
      },
    });
  }
  // первая планёрка — ближайшие 08:00; часы — с ближайшего целого часа
  const today = Math.floor(s.t / DAY) * DAY;
  schedule(s.agenda, s.t < today + MORNING ? today + MORNING : today + DAY + MORNING, { kind: 'morning' });
  schedule(s.agenda, Math.floor(s.t / HOUR) * HOUR + HOUR, { kind: 'hour' });
  // заказы сценария — в первую секунду партии
  const out: Notice[] = [];
  for (const o of sc.orders) placePo(db, s, { kind: 'po', supplier: o.supplier, lines: o.lines, by: 'scenario' }, out);
  dispatch(db, s);
  return s;
}

export function apply(db: ContentDb, s: PlantState, cmd: Command, more?: () => boolean): Notice[] {
  // время прошлой команды, ещё не прожитое, — сначала всё: команда видит завод таким же, как игрок
  const before = catchUp(db, s);
  const out = command(db, s, cmd, more);
  return before.length > 0 ? [...before, ...out] : out;
}

function command(db: ContentDb, s: PlantState, cmd: Command, more?: () => boolean): Notice[] {
  switch (cmd.kind) {
    case 'advance':
      if (cmd.seconds <= 0) return [];
      s.until = s.t + cmd.seconds;
      return catchUp(db, s, more);
    case 'po': {
      const notices: Notice[] = [];
      placePo(db, s, cmd, notices);
      return notices;
    }
  }
}

/**
 * Дожить время команды: события по порядку, пока `more()` перед каждым, — остальное в следующий раз; без `more` — всё.
 * В конце часы стоят на том часе, до которого жили. Нечего доживать — ничего.
 */
export function catchUp(db: ContentDb, s: PlantState, more?: () => boolean): Notice[] {
  const notices: Notice[] = [];
  const target = s.until;
  if (target === undefined) return notices;
  for (;;) {
    const next = nextTime(s.agenda);
    if (next === undefined || next > target) break;
    if (more && !more()) return notices;
    const due = popDue(s.agenda, target)!;
    s.t = Math.max(s.t, due.t);
    handle(db, s, due.e, notices);
  }
  s.t = target;
  delete s.until;
  return notices;
}

function handle(db: ContentDb, s: PlantState, ev: PlantEvent, notices: Notice[]) {
  switch (ev.kind) {
    case 'morning':
      s.day++;
      notices.push({ kind: 'morning', day: s.day });
      schedule(s.agenda, s.t + DAY, { kind: 'morning' });
      return;
    case 'hour':
      // смены начинаются и кончаются в целые часы: раздать то, что ждало людей
      schedule(s.agenda, s.t + HOUR, { kind: 'hour' });
      dispatch(db, s);
      return;
    case 'truck':
      truckArrives(db, s, ev.po, notices);
      dispatch(db, s);
      return;
    case 'task': {
      const t = s.tasks[ev.id];
      if (!t || t.v !== ev.v || t.state !== 'busy') return;
      release(db, s, t);
      wmsDone(db, s, t, notices);
      dispatch(db, s);
      return;
    }
  }
}
