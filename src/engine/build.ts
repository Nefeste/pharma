// Стройка (Б7б; docs/specs/2026-10-vertical-slice.md, «Б7б»; геймдизайн, §3.3, §3.4) — команда `site` места директора:
// правка плана, «Готово» и отмена; снос занятого — когда освободится, событием `siteFree`. Устройство — как у стройки
// «Больницы» (`Nefeste/bolnitsa` @ e804637, src/engine/shift/site.ts): начисления до этого мгновения (`apply`), чистая
// правка плана (site/edit.ts), проверка кассы, шаг отмены, новый объект плана, учёт помещений и мест по новому плану,
// деньги, извещение. Своё: НДС — как у закупок, к вычету; возврат за отложенный снос — тогда, когда вещь снесена, и в шаг
// её сноса: отмена заберёт и его; счётчики имён отмена не возвращает — имена не повторяются. Что не работает —
// site/down.ts: красные помещения плана, перестраиваемое и сносимое.
import type { BuildPrices, ContentDb } from '../content/types';
import { part, post } from './cash';
import { schedule } from './core/agenda';
import { CELL_CM } from './nav';
import { planOf } from './plant';
import { floorRoomAt, forgetDown } from './site/down';
import { type BuildError, type BuildOp, doorId, doorSides, editPlan, without } from './site/edit';
import { slotFree } from './stock';
import { taskRooms } from './tasks';
import { type BuildState, type Command, type Notice, type PlantState, planRev, type SitePlan, type SiteRefusal } from './types';

type Thing = BuildState['leaving'][number]['what'];

const no = (op: string, error: BuildError | SiteRefusal): Notice => ({ kind: 'site', op, ok: false, error });

/** НДС стройки — общая ставка профиля, как у работ подрядчика. */
const rateOf = (db: ContentDb, s: PlantState) => db.profiles[db.scenarios[s.scenario].profile].vat.general;

/**
 * Чем занята вещь плана — её снос ждёт, пока освободится: помещение — серией, паллетой или задачей; зона и ряд стеллажа —
 * паллетой, местом под паллету или задачей. Свободна — `undefined`.
 */
export function busyWith(db: ContentDb, s: PlantState, what: Thing, id: string): string | undefined {
  const plan = planOf(db, s.plan);
  if (what === 'room') {
    const batch = s.rooms[id]?.batch;
    if (batch) return batch;
    for (const u of Object.values(s.units)) {
      if (u.where.kind === 'room' && u.where.id === id) return u.id;
      const sl = u.where.kind === 'slot' ? plan.slot[u.where.id] : undefined;
      if (sl && floorRoomAt(plan, sl) === id) return u.id;
    }
    for (const t of Object.values(s.tasks)) if (taskRooms(db, plan, s, t).includes(id)) return t.id;
    return undefined;
  }
  const ids = new Set<string>();
  for (const sl of plan.slots) {
    if (sl.group !== id) continue;
    if (!slotFree(s, sl.id)) return s.slots[sl.id].unit ?? s.slots[sl.id].held;
    ids.add(sl.id);
  }
  for (const t of Object.values(s.tasks)) if ((t.from.kind === 'slot' && ids.has(t.from.id)) || (t.to !== undefined && ids.has(t.to))) return t.id;
  return undefined;
}

/** Помещения, зоны и ряды плана `now`, которых нет в плане `then`, — первое занятое из них; занятого нет — `undefined`. */
function lostBusy(db: ContentDb, s: PlantState, now: SitePlan, then: SitePlan): string | undefined {
  const gone = (a: readonly { id: string }[], b: readonly { id: string }[]) => a.filter(x => !b.some(y => y.id === x.id)).map(x => x.id);
  for (const id of gone(now.rooms, then.rooms)) if (busyWith(db, s, 'room', id)) return id;
  for (const id of gone(now.zones, then.zones)) if (busyWith(db, s, 'zone', id)) return id;
  for (const id of gone(now.racks, then.racks)) if (busyWith(db, s, 'rack', id)) return id;
  return undefined;
}

/** Сносимое не правят: дверь в сносимое помещение, его проезд, зона и ряд в нём, снос сносимого. Что сносится — или нет. */
function leavingOf(db: ContentDb, s: PlantState, op: BuildOp): string | undefined {
  const st = s.build;
  if (!st || st.leaving.length === 0) return undefined;
  const has = (what: Thing, id: string | undefined) => id !== undefined && st.leaving.some(l => l.what === what && l.id === id);
  const plan = planOf(db, s.plan);
  const sides = (d: Parameters<typeof doorSides>[2]) => (doorSides(db, s.plan, d) ?? []).map(i => s.plan.rooms[i]?.id).find(id => has('room', id));
  switch (op.op) {
    case 'demolish': {
      if (op.what !== 'door') return has(op.what, op.id) ? op.id : undefined;
      const d = s.plan.doors.find(x => doorId(x) === op.id);
      return d ? sides(d) : undefined;
    }
    case 'door':
      return sides({ cell: op.cell, len: op.len, along: op.along, kind: op.kind });
    case 'vehicles':
      return has('room', op.room) ? op.room : undefined;
    case 'zone':
    case 'rack': {
      const [x, z] = op.op === 'zone' ? op.rect : [op.x, op.z];
      const r = floorRoomAt(plan, { x: x * CELL_CM + CELL_CM / 2, z: z * CELL_CM + CELL_CM / 2 });
      return has('room', r) ? r : undefined;
    }
    default:
      return undefined;
  }
}

/** Проверить отложенный снос через шаг проверки сценария — одно событие в очереди. */
function checkLater(s: PlantState, b: BuildPrices) {
  if (!s.agenda.heap.some(d => d.e.kind === 'siteFree')) schedule(s.agenda, s.t + b.check, { kind: 'siteFree' });
}

/** Шаг отмены: план до шага, что шаг заплатил с НДС и его НДС, перестраиваемое до шага; шагов — не больше предела. */
function remember(st: BuildState, b: BuildPrices, plan: SitePlan, paid: number, vat: number) {
  st.undo.push({ n: st.step++, plan, paid, vat, ...(st.editing !== undefined ? { editing: st.editing } : {}) });
  if (st.undo.length > b.undo) st.undo.splice(0, st.undo.length - b.undo);
}

/**
 * Новый план в состоянии: учёт помещений — новое чисто с этого мгновения, снесённого нет; записей мест снесённых зон и
 * рядов нет (снесённое свободно).
 */
function commit(db: ContentDb, s: PlantState, plan: SitePlan) {
  s.plan = plan;
  const ids = new Set(plan.rooms.map(r => r.id));
  for (const r of plan.rooms) if (!s.rooms[r.id]) s.rooms[r.id] = { id: r.id, type: r.type, status: 'clean', since: s.t };
  for (const id of Object.keys(s.rooms)) if (!ids.has(id)) delete s.rooms[id];
  const slot = planOf(db, plan).slot;
  for (const id of Object.keys(s.slots)) if (!slot[id] && slotFree(s, id)) delete s.slots[id];
}

/** Деньги шага: из кассы статьёй «Стройка» (возврат — в кассу), НДС — к вычету, потрачено на стройку. */
function pay(s: PlantState, st: BuildState, paid: number, vat: number, ref: string) {
  post(s, -paid, 'build', ref);
  s.cash.vat.in += vat;
  st.spent += paid;
}

/**
 * Команда стройки: правка — новый план, деньги и шаг отмены, или отказ с причиной, и тогда ничего не меняется; снос
 * занятого — пометка «сносится»; «Готово» открывает перестраиваемое помещение; отмена — последний шаг назад.
 */
export function siteCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'site' }>, notices: Notice[]) {
  const op = cmd.op;
  const b = db.scenarios[s.scenario].build;
  if (!b) return void notices.push(no(op.op, { code: 'noBuild' }));
  if (op.op === 'done') {
    const st = s.build;
    if (st?.editing === undefined) return;
    const room = st.editing;
    delete st.editing;
    forgetDown(st);
    return void notices.push({ kind: 'site', op: 'done', ok: true, cost: 0, thing: room });
  }
  if (op.op === 'undo') return undo(db, s, notices);
  const leaving = leavingOf(db, s, op);
  if (leaving) return void notices.push(no(op.op, { code: 'leaving', thing: leaving }));
  const r = editPlan(db, b, s.plan, op, s.build?.next ?? {});
  if (!r.ok) return void notices.push(no(op.op, r.error));
  // снос занятого — когда освободится: шаг без денег, возврат — со сносом
  if (op.op === 'demolish' && op.what !== 'door' && busyWith(db, s, op.what, op.id)) {
    const st = (s.build ??= newBuild());
    remember(st, b, s.plan, 0, 0);
    st.leaving.push({ what: op.what, id: op.id, step: st.step - 1 });
    forgetDown(st);
    checkLater(s, b);
    return void notices.push({ kind: 'site', op: op.op, ok: true, cost: 0, thing: op.id, later: true });
  }
  const rate = rateOf(db, s);
  const vat = part(r.cost, rate) - part(r.refund, rate);
  const paid = r.cost - r.refund + vat;
  // касса: трата не уведёт её ниже предела кредитной линии
  const floor = -db.scenarios[s.scenario].credit.limit;
  if (paid > 0 && s.cash.balance - paid < floor) return void notices.push(no(op.op, { code: 'money', need: paid - (s.cash.balance - floor) }));
  const st = (s.build ??= newBuild());
  remember(st, b, s.plan, paid, vat);
  st.next = r.names;
  // перестраиваемое: новое помещение, правка зоны, ряда или проезда — оно; дверь и корпус его не меняют; снесено — нет его
  if (r.room !== undefined) st.editing = r.room;
  else if (st.editing !== undefined && !r.plan.rooms.some(x => x.id === st.editing)) delete st.editing;
  forgetDown(st);
  commit(db, s, r.plan);
  pay(s, st, paid, vat, r.thing);
  notices.push({ kind: 'site', op: op.op, ok: true, cost: paid, thing: r.thing });
}

const newBuild = (): BuildState => ({ undo: [], step: 1, leaving: [], next: {}, spent: 0 });

/**
 * Отмена: план и перестраиваемое — как до последнего шага, его отложенный снос — не нужен, деньги шага — назад целиком,
 * без проверки кассы. Исчезнет помещение, зона или ряд, на которые уже ссылаются серия, паллета или задача, — «занято».
 */
function undo(db: ContentDb, s: PlantState, notices: Notice[]) {
  const st = s.build;
  const step = st?.undo[st.undo.length - 1];
  if (!st || !step) return void notices.push(no('undo', { code: 'nothing' }));
  const busy = lostBusy(db, s, s.plan, step.plan);
  if (busy) return void notices.push(no('undo', { code: 'inUse', thing: busy }));
  st.undo.pop();
  st.leaving = st.leaving.filter(l => l.step !== step.n);
  if (step.editing !== undefined && step.plan.rooms.some(r => r.id === step.editing)) st.editing = step.editing;
  else delete st.editing;
  forgetDown(st);
  // прежний план — новым объектом с номером правки на один больше: номер правки только растёт
  if (step.plan !== s.plan) commit(db, s, { ...step.plan, rev: planRev(s.plan) + 1 });
  pay(s, st, -step.paid, -step.vat, 'undo');
  notices.push({ kind: 'site', op: 'undo', ok: true, cost: -step.paid || 0 });
}

/**
 * Событие `siteFree`: освободившееся из сносимого — снести, возврат — сейчас и в шаг его сноса, а из планов в шагах отмены
 * после него снесённое убрать: отмена поздней правки не вернёт его даром; больше не сносится (правка плана не пускает) —
 * извещение и пометку снять; занятое — проверить снова через шаг проверки.
 */
export function siteFree(db: ContentDb, s: PlantState, notices: Notice[]) {
  const st = s.build;
  const b = db.scenarios[s.scenario].build;
  if (!st || !b || st.leaving.length === 0) return;
  const rest: BuildState['leaving'] = [];
  const rate = rateOf(db, s);
  for (const l of st.leaving) {
    if (busyWith(db, s, l.what, l.id)) {
      rest.push(l);
      continue;
    }
    const r = editPlan(db, b, s.plan, { op: 'demolish', what: l.what, id: l.id }, st.next);
    if (!r.ok) {
      notices.push({ kind: 'siteKept', what: l.what, id: l.id, error: r.error });
      continue;
    }
    const vat = -part(r.refund, rate);
    const paid = -r.refund + vat;
    for (const u of st.undo) if (u.n > l.step) u.plan = without(db, u.plan, l.what, l.id);
    const mine = st.undo.find(u => u.n === l.step);
    if (mine) {
      mine.paid += paid;
      mine.vat += vat;
    }
    if (st.editing !== undefined && !r.plan.rooms.some(x => x.id === st.editing)) delete st.editing;
    commit(db, s, r.plan);
    pay(s, st, paid, vat, l.id);
    notices.push({ kind: 'siteGone', what: l.what, id: l.id, refund: -paid });
  }
  st.leaving = rest;
  forgetDown(st);
  if (rest.length > 0) checkLater(s, b);
}
