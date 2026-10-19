// Движок завода (docs/02-architecture.md, §1, §3): `newPlant` и `apply`. Время идёт по событиям очереди, при равном
// времени — по номеру постановки. Ход времени срезами даёт то же состояние, что одним куском: это проверяют тесты.
//
// Устройство хода времени — как в «Больнице» (её src/engine/shift/engine.ts, `later` и `catchUp`): команда со временем
// ставит `until`, а `catchUp` проживает события по порядку, пока бюджет кадра `more()` позволяет. Недожитое
// доживается в следующих кадрах; любая следующая команда сначала доживает всё. `more` спрашивают после каждого события, и он
// видит извещения, уже данные этим доживанием: так поток расчёта встаёт ровно на событии автопаузы (Б2а).
import type { ContentDb, Id } from '../content/types';
import { alertsHour } from './alerts';
import { cashHour, newCash } from './cash';
import { agenda, nextTime, popDue, schedule } from './core/agenda';
import { DAY, HOUR, momentOf } from './core/calendar';
import { concludeCommand, invDone, investigateCommand, invStep, newIncident } from './investigation';
import { labDone, runDone, rushCommand, startSampling } from './lab';
import { leanHour, leanStep, newLoss } from './lean';
import { lineDone, lineEvent, lineHour, lineStep, lineUpdate, newLines } from './line';
import { maintainCommand, maintDone, maintStep, newParts, spareArrives } from './maint';
import { marketDone, marketHour, marketStep, newCustomers, rznPublished } from './market';
import { BATCH_HOUR, mesDone, mesHour, mesStep, packOrder, placeOrder, pressFail, shiftCommand, stageBegin } from './mes';
import { planOf } from './plant';
import { qaDone, qaStep, releaseCommand } from './qa';
import { foreign, seatCommand } from './seats';
import { goHome, LAST_CALL, postArrive, toPosts } from './staff';
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
    cash: newCash(sc.cash, sc.start.hour * HOUR),
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
    instruments: {},
    samples: {},
    tests: {},
    deviations: {},
    investigations: {},
    batchNos: {},
    rooms: {},
    equipment: {},
    batches: {},
    lines: {},
    customers: newCustomers(sc, sc.start.hour * HOUR),
    orders: {},
    shipments: {},
    parts: {},
    spares: {},
    spareOrders: {},
    maintLog: [],
    losses: [],
    shiftTasks: [],
  };
  s.losses.push(newLoss(momentOf(s.start, s.t).day));
  // люди — у входа, техника — на стоянке, приборы — в лаборатории по плану
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
  for (const i of plan.plant.instruments) s.instruments[i.id] = { id: i.id, type: i.type, room: i.room };
  // помещения — чистые с начала партии; оборудование — по плану
  for (const r of plan.plant.rooms) s.rooms[r.id] = { id: r.id, type: r.type, status: 'clean', since: s.t };
  for (const e of plan.plant.equipment) s.equipment[e.id] = { id: e.id, type: e.type, room: e.room };
  s.lines = newLines(db, sc.plant, s.t);
  newParts(db, s);
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
  // задания на серию сценария: день от начала партии, с начала смены аппаратчиков
  for (const b of sc.batches) placeOrder(db, s, { kind: 'order', recipe: b.recipe, notBefore: today + b.day * DAY + BATCH_HOUR, by: 'scenario', ...(b.sku ? { sku: b.sku } : {}) }, out);
  // происшествие сценария (часть 4): корень по жребию зерна — скрытое
  newIncident(db, s);
  settle(db, s);
  return s;
}

/** Жить ли дальше после события: бюджет кадра и извещения, уже данные этим доживанием (автопауза, Б2а). */
export type More = (notices: readonly Notice[]) => boolean;

export function apply(db: ContentDb, s: PlantState, cmd: Command, more?: More): Notice[] {
  // время прошлой команды, ещё не прожитое, — сначала всё: команда видит завод таким же, как игрок
  const before = catchUp(db, s);
  const out = command(db, s, cmd, more);
  return before.length > 0 ? [...before, ...out] : out;
}

function command(db: ContentDb, s: PlantState, cmd: Command, more?: More): Notice[] {
  // своё и чужое (3е): команда игрока чужого поста — отказ с местом, чья она
  const own = foreign(s, cmd);
  if (own) return [{ kind: 'refused', cmd: cmd.kind, why: 'notYours', detail: own }];
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
    case 'order': {
      const notices: Notice[] = [];
      placeOrder(db, s, cmd, notices);
      settle(db, s);
      return notices;
    }
    case 'pack': {
      const notices: Notice[] = [];
      packOrder(db, s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'release': {
      const notices: Notice[] = [];
      releaseCommand(db, s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'maintain': {
      const notices: Notice[] = [];
      maintainCommand(db, s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'rush': {
      const notices: Notice[] = [];
      rushCommand(s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'shift': {
      const notices: Notice[] = [];
      shiftCommand(s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'seat': {
      const notices: Notice[] = [];
      seatCommand(db, s, cmd, notices);
      // место качества отдали — коллега качества ведёт открытые расследования дальше
      if (invStep(db, s, notices)) settle(db, s);
      return notices;
    }
    case 'investigate': {
      const notices: Notice[] = [];
      investigateCommand(db, s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'conclude': {
      const notices: Notice[] = [];
      concludeCommand(db, s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
  }
}

/**
 * Раздать задачи; кому задачи не досталось — на пост (3а); затем у серий — чем занято их время (1ж): ждут они людей или
 * уже работают, видно после раздачи.
 */
function settle(db: ContentDb, s: PlantState) {
  dispatch(db, s);
  toPosts(db, s);
  leanStep(db, s);
}

/**
 * После события: техслужба (раньше производства: свободную машину, которой пора в замену узла, не займёт серия),
 * производство, линии, качество, отгрузка, раздача задач.
 */
function steps(db: ContentDb, s: PlantState, notices: Notice[]) {
  maintStep(db, s);
  mesStep(db, s);
  lineStep(db, s, notices);
  qaStep(db, s);
  invStep(db, s, notices);
  marketStep(db, s, notices);
  settle(db, s);
}

/**
 * Дожить время команды: события по порядку, после каждого — `more(извещения)`; нельзя — часы стоят на этом событии,
 * остальное в следующий раз. Без `more` — всё. Спрашивают после события, а не перед следующим: так и последнее событие до
 * цели может остановить доживание — извещение автопаузы держит часы ровно на своём событии (Б2а).
 * В конце часы стоят на том часе, до которого жили. Нечего доживать — ничего.
 */
export function catchUp(db: ContentDb, s: PlantState, more?: More): Notice[] {
  const notices: Notice[] = [];
  const target = s.until;
  if (target === undefined) return notices;
  for (;;) {
    const next = nextTime(s.agenda);
    if (next === undefined || next > target) break;
    const due = popDue(s.agenda, target)!;
    s.t = Math.max(s.t, due.t);
    handle(db, s, due.e, notices);
    if (more && !more(notices)) return notices;
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
      // смены начинаются и кончаются в целые часы: раздать то, что ждало людей; партии, готовые к отбору проб, — в план
      schedule(s.agenda, s.t + HOUR, { kind: 'hour' });
      schedule(s.agenda, s.t + HOUR - LAST_CALL, { kind: 'leave' });
      for (const p of Object.values(s.people)) goHome(db, s, p);
      startSampling(db, s);
      cashHour(db, s, notices);
      maintStep(db, s);
      mesHour(db, s);
      lineHour(db, s, notices);
      leanHour(db, s);
      marketHour(db, s, notices);
      lineStep(db, s, notices);
      qaStep(db, s);
      marketStep(db, s, notices);
      settle(db, s);
      // тревоги часа (Б2а) — по заводу, каким его оставил час
      alertsHour(db, s, notices);
      return;
    case 'truck':
      truckArrives(db, s, ev.po, notices);
      settle(db, s);
      return;
    case 'task': {
      const t = s.tasks[ev.id];
      if (!t || t.v !== ev.v || t.state !== 'busy') return;
      release(db, s, t);
      if (!labDone(db, s, t, notices) && !mesDone(db, s, t, notices) && !lineDone(db, s, t, notices) && !qaDone(db, s, t, notices) && !marketDone(db, s, t, notices) && !maintDone(db, s, t, notices) && !invDone(db, s, t, notices)) wmsDone(db, s, t, notices);
      // паллета ГП уехала с места паллетирования — у линии освободилось место; машину линии починили — она снова в работе
      if ((t.kind === 'putaway' || t.kind === 'repair') && t.line) lineUpdate(db, s, s.lines[t.line], notices);
      if (t.kind === 'putaway' || t.kind === 'stage') startSampling(db, s);
      steps(db, s, notices);
      return;
    }
    case 'run':
      runDone(db, s, ev.test, ev.v);
      settle(db, s);
      return;
    case 'batch':
      mesStep(db, s);
      settle(db, s);
      return;
    case 'line':
      lineEvent(db, s, ev.id, ev.v, notices);
      steps(db, s, notices);
      return;
    case 'rzn':
      rznPublished(s, ev.lot);
      steps(db, s, notices);
      return;
    case 'begin':
      stageBegin(db, s, ev.task, ev.v);
      return;
    case 'fail':
      pressFail(db, s, ev, notices);
      steps(db, s, notices);
      return;
    case 'spare':
      spareArrives(db, s, ev.order);
      steps(db, s, notices);
      return;
    case 'post':
      // дошёл до поста: раздавать нечего — свободным он был и в пути
      postArrive(db, s, ev.person, ev.t);
      return;
    case 'leave':
      // последний зов перед концом смены: кому задачи не нашлось — к выходу
      settle(db, s);
      return;
  }
}
