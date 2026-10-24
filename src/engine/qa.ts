// Обеспечение качества (docs/specs/2026-10-engine.md, 1г; геймдизайн, §6.4–6.5): проверка упакованной серии — ГП и
// досье — специалистом ООК с архивными образцами, затем решение уполномоченного лица: выпустить, держать, отклонить.
// Выпущенное — на стеллажи, отклонённое — в зону отклонённого. Команда `release` — решение игрока вместо УЛ. Оценка
// влияния отклонения (Б1г; docs/specs/2026-10-vertical-slice.md, «Б1г»): пост качества решает «без влияния» или
// «отклонить серию», специалист ООК делает работу; выпуск — только с оценёнными отклонениями (прил. 16, п. 6.1); пока
// пост качества не у игрока, оценивает коллега качества — по тому же правилу.
import type { Attr, ContentDb, Id } from '../content/types';
import { batchNo } from './batchno';
import { part, post } from './cash';
import { MIN, momentOf } from './core/calendar';
import { inForce } from './docs';
import { playerLeads } from './investigation';
import { defect } from './lean';
import { fgExpiry, prodDay } from './line';
import { toRzn } from './market';
import { planOf } from './plant';
import { addTask } from './tasks';
import { containersByLot, FG_FLOW, setLotStatus, stockChanged, unitsOfLot } from './stock';
import type { Batch, Command, Container, Deviation, Lot, Notice, PlantState, Refusal, Task, Unit } from './types';
import { PRIO, WMS } from './wms';

export const QA = { specialists: ['role.qa'], qps: ['role.qp'] } as const;

/**
 * Проверка ГП и досье серии — 2 часа специалиста ООК; решение уполномоченного лица — 45 минут; оценка влияния
 * отклонения — час специалиста ООК по досье и результатам серии (гипотезы, §6.4–6.5).
 */
export const FG_CHECK_WORK = 120 * MIN;
export const QP_WORK = 45 * MIN;
export const DEV_WORK = 60 * MIN;

export const QA_PRIO = { fgCheck: 26, qpDecide: 26, devAssess: 26 } as const;

const busy = (s: PlantState, uid: string) => Object.values(s.tasks).some(t => t.unit === uid);

/** Упакованные серии, все паллеты которых стоят в карантине ГП, — на проверку ООК. Зовётся после каждого события. */
export function qaStep(db: ContentDb, s: PlantState) {
  const plan = planOf(db, s.plant);
  for (const b of Object.values(s.batches)) {
    if (b.status !== 'fg' || b.checked !== undefined) continue;
    if (Object.values(s.tasks).some(t => t.batch === b.id && (t.kind === 'fgCheck' || t.kind === 'qpDecide'))) continue;
    const lot = s.lots[b.pack!.fg!];
    const units = unitsOfLot(s, lot.id);
    if (!units.every(u => u.where.kind === 'slot' && plan.slot[u.where.id].kind === 'fgQuarantine' && !busy(s, u.id))) continue;
    const at = plan.byKind.fgQuarantine[0];
    addTask(s, { kind: 'fgCheck', roles: [...QA.specialists], from: { kind: 'point', x: at.x, z: at.z }, work: FG_CHECK_WORK, prio: QA_PRIO.fgCheck, batch: b.id, lot: lot.id });
  }
}

/** Что сделала задача качества, когда кончилась. Не задача качества — `false`. */
export function qaDone(db: ContentDb, s: PlantState, t: Task, notices: Notice[]): boolean {
  switch (t.kind) {
    case 'fgCheck': {
      const b = s.batches[t.batch!];
      retain(db, s, b);
      b.checked = s.t;
      decideTask(db, s, b);
      return true;
    }
    case 'qpDecide':
      decide(db, s, s.batches[t.batch!], notices);
      return true;
    case 'devAssess':
      assessed(db, s, s.deviations[t.dev!], notices);
      return true;
    default:
      return false;
  }
}

function decideTask(db: ContentDb, s: PlantState, b: Batch) {
  const plan = planOf(db, s.plant);
  addTask(s, { kind: 'qpDecide', roles: [...QA.qps], from: { kind: 'point', x: plan.lab.x, z: plan.lab.z }, work: QP_WORK, prio: QA_PRIO.qpDecide, batch: b.id, lot: b.pack!.fg });
}

/**
 * Архивные образцы серии (GMP ЕАЭС, прил. 19) — пачки из последних ящиков: код уходит в «архив», пачка — из ящика,
 * партия ГП их отбирает.
 */
function retain(db: ContentDb, s: PlantState, b: Batch) {
  const job = b.pack!;
  const lot = s.lots[job.fg!];
  let left = db.materials[lot.material].sample;
  const cases = (containersByLot(s).get(lot.id) ?? []).slice().reverse();
  for (const c of cases) {
    if (left <= 0) break;
    const q = Math.min(left, c.qty);
    job.retained.push(...takeCodes(c, q));
    c.qty -= q;
    lot.sampled += q;
    left -= q;
    if (c.qty === 0) {
      // ящик опустел — из учёта; опустела и паллета (последний неполный ящик) — с места тоже
      const u = s.units[c.unit];
      u.items = u.items.filter(id => id !== c.id);
      delete s.containers[c.id];
      if (u.items.length === 0) {
        if (u.where.kind === 'slot') delete s.slots[u.where.id].unit;
        delete s.units[u.id];
      }
    }
  }
}

/** Снять `q` последних кодов ящика. */
function takeCodes(c: Container, q: number): number[] {
  const out: number[] = [];
  const codes = c.codes!;
  while (q > 0) {
    const r = codes[codes.length - 1];
    out.push(r[0] + r[1] - 1);
    r[1]--;
    if (r[1] === 0) codes.pop();
    q--;
  }
  return out;
}

/**
 * Решение уполномоченного лица (прил. 16, п. 6.1; §6.5): решение игрока или оценки отклонения, если оно есть; иначе
 * политика — неоценённые отклонения серии, её балка или ГП — «держать», иначе — «выпустить». Выпустить при неоценённом
 * отклонении нельзя никому (Б1г): до подтверждения серии отклонения должны быть утверждены.
 */
function decide(db: ContentDb, s: PlantState, b: Batch, notices: Notice[]) {
  const lot = s.lots[b.pack!.fg!];
  const open = openDevs(s, b);
  let decision = b.decision ?? (open.length > 0 ? 'hold' : 'release');
  if (decision === 'release' && open.length > 0) decision = 'hold';
  const mine = b.decision === 'hold' && open.length === 0;
  delete b.decision;
  if (decision === 'hold') {
    b.held = true;
    // удержанная ГП ждёт нового решения на стеллаже, заблокированной (Б2в): иначе три удержанные серии займут всю зону
    // карантина ГП, и линии некуда будет ставить новые паллеты
    if (lot.status === 'quarantine') setLotStatus(s, lot, 'blocked', FG_FLOW);
    for (const u of unitsOfLot(s, lot.id)) settle(db, s, lot, u);
    notices.push({ kind: 'batchHeld', batch: b.id, ...(mine ? { mine: true as const } : {}) });
    return;
  }
  delete b.held;
  if (decision === 'release') {
    setLotStatus(s, lot, 'released', FG_FLOW);
    // срок годности — от выпуска, если он не позже 30 дней от производства (Рекомендация Коллегии ЕЭК № 2)
    lot.expiry = fgExpiry(prodDay(db, s, b), momentOf(s.start, s.t).day, db.materials[lot.material].shelf);
    b.status = 'released';
    b.released = s.t;
    toRzn(db, s, lot.id);
    codesFee(db, s, b);
    stockChanged(s);
    notices.push({ kind: 'batchReleased', batch: b.id, lot: lot.id });
  } else {
    // серию отклонили — с ней решены и её открытые отклонения, как у расследования (часть 4)
    for (const d of open) d.status = 'closed';
    setLotStatus(s, lot, 'rejected', FG_FLOW);
    b.status = 'rejected';
    defect(s, 'batches');
    notices.push({ kind: 'batchRejected', batch: b.id, lot: lot.id });
  }
  for (const u of unitsOfLot(s, lot.id)) settle(db, s, lot, u);
}

/**
 * Плата за коды маркировки серии (`pp-577`): за каждый напечатанный код, кроме позиций ЖНВЛП с зарегистрированной ценой не
 * выше порога профиля; платим в день выпуска — не позже ввода в оборот (`mdlp`, п. 9.1). НДС — по общей ставке.
 */
function codesFee(db: ContentDb, s: PlantState, b: Batch) {
  const sku = db.skus[b.pack!.sku];
  const pr = db.profiles[db.scenarios[s.scenario].profile];
  if (db.products[sku.product].jnvlp && sku.regPrice !== undefined && sku.regPrice <= pr.marking.free) return;
  const net = (b.pack!.cartons ?? 0) * pr.marking.fee;
  const tax = part(net, pr.vat.general);
  s.cash.vat.in += tax;
  post(s, -(net + tax), 'codes', b.id);
}

/**
 * Паллета решённой ГП: выпущенная — на стеллаж ближе к экспедиции, удержанная (заблокированная) — тоже на стеллаж, ждать
 * нового решения; отклонённая — в зону отклонённого.
 */
export function settle(db: ContentDb, s: PlantState, lot: Lot, u: Unit) {
  if (u.where.kind !== 'slot' || busy(s, u.id)) return;
  const plan = planOf(db, s.plant);
  const at = plan.slot[u.where.id];
  const from = { kind: 'slot' as const, id: at.id };
  if ((lot.status === 'released' || lot.status === 'blocked') && at.kind !== 'storage') {
    const ship = plan.byKind.shipping?.[0] ?? at;
    addTask(s, { kind: 'putaway', roles: [...WMS.movers], veh: [...WMS.floor], unit: u.id, from, toKind: 'storage', near: { x: ship.x, z: ship.z }, work: 0, prio: PRIO.putaway, lot: lot.id });
  } else if (lot.status === 'rejected' && at.kind !== 'rejected') {
    addTask(s, { kind: 'move', roles: [...WMS.movers], veh: [...WMS.floor], unit: u.id, from, toKind: 'rejected', work: 0, prio: PRIO.putaway, lot: lot.id });
  }
}

/**
 * Команда `release`: решение игрока по упакованной серии вместо уполномоченного лица. «Выпустить» при неоценённом
 * отклонении серии или после оценки «отклонить серию» — отказ с этим отклонением (Б1г).
 */
export function releaseCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'release' }>, notices: Notice[]) {
  const b = s.batches[cmd.batch];
  if (!b) return notices.push({ kind: 'refused', cmd: 'release', why: 'noBatch', detail: cmd.batch });
  if (b.status !== 'fg') return notices.push({ kind: 'refused', cmd: 'release', why: 'notReady', detail: cmd.batch });
  if (cmd.decision === 'release') {
    const open = openDevs(s, b).find(d => d.assess?.verdict !== 'reject');
    if (open) return notices.push({ kind: 'refused', cmd: 'release', why: 'devOpen', detail: open.id });
    const no = devsOf(s, b).find(d => d.assess?.verdict === 'reject');
    if (no) return notices.push({ kind: 'refused', cmd: 'release', why: 'devReject', detail: no.id });
  }
  b.decision = cmd.decision;
  // проверка ООК уже была (серию держат) — сразу к уполномоченному лицу; иначе решение дождётся проверки
  redecide(db, s, b);
}

/**
 * Проверка ООК уже была и решения уполномоченного лица ещё не ждут — к нему снова: серию держат, а решение изменилось.
 */
function redecide(db: ContentDb, s: PlantState, b: Batch) {
  if (b.status === 'fg' && b.checked !== undefined && !Object.values(s.tasks).some(t => t.kind === 'qpDecide' && t.batch === b.id)) decideTask(db, s, b);
}

// ---------------------------------------------------------------- оценка влияния отклонения (Б1г)

/** Отклонения серии: её самой, её балка и её ГП. */
export function devsOf(s: PlantState, b: Batch): Deviation[] {
  const fg = b.pack?.fg;
  return Object.values(s.deviations).filter(d => d.batch === b.id || (d.lot !== undefined && (d.lot === b.bulk || d.lot === fg)));
}

/** Неоценённые отклонения серии: с ними её не выпускают. */
export const openDevs = (s: PlantState, b: Batch): Deviation[] => devsOf(s, b).filter(d => d.status === 'open');

/** Открытое расследование результата вне спецификации у серии: её отклонения решает оно (часть 4). */
export const invOpen = (s: PlantState, b: Batch): boolean => Object.values(s.investigations).some(i => i.batch === b.id && i.status === 'open');

/**
 * Испытание, которое покажет влияние отклонения: МОК стадии — сколько точек и сколько вне пределов, готово, когда
 * стадия записана в досье; испытание балка по спецификации — последнее годное (без признанных ошибкой лаборатории),
 * готово, когда результат проверен вторым лицом, и его результат.
 */
export interface LinkedTest {
  kind: 'ipc' | 'lab';
  test: Id;
  attr: Attr;
  n: number;
  out: number;
  done: boolean;
  result?: number;
}

/**
 * Какие испытания серии покажут влияние отклонения — по знаниям завода (записи причин с источниками): режим вне
 * диапазона — показатели, на которые он влияет, в МОК своей и следующих стадий и в испытаниях балка; МОК вне пределов и
 * низкий выход — все испытания балка; сверка — никакие: её объясняют по досье (п. 5.61). У результата вне спецификации
 * оценки нет — его решает расследование.
 */
export function linkedTests(db: ContentDb, s: PlantState, d: Deviation): LinkedTest[] {
  const b = d.batch ? s.batches[d.batch] : undefined;
  if (!b || d.kind === 'oos' || d.kind === 'recon') return [];
  const r = db.recipes[b.recipe];
  let attrs: Set<Attr> | undefined;
  if (d.kind === 'param') attrs = new Set(Object.values(db.causes).flatMap(c => ('param' in c.driver && c.driver.param === d.param ? [...c.effects, ...(c.scatter ?? [])].map(e => e.attr) : [])));
  const out: LinkedTest[] = [];
  if (attrs) {
    const from = Math.max(0, r.stages.findIndex(st => st.id === d.stage));
    for (const st of r.stages.slice(from)) {
      for (const line of st.ipc ?? []) {
        const attr = db.tests[line.test].attr;
        if (!attrs.has(attr)) continue;
        const rec = b.records.find(x => x.stage === st.id);
        const pts = rec ? rec.ipc.filter(x => x.test === line.test) : [];
        out.push({ kind: 'ipc', test: line.test, attr, n: pts.length, out: pts.filter(x => !x.pass).length, done: !!rec });
      }
    }
  }
  // испытания балка: по пробе — последние годные; пробы ещё нет — по действующей спецификации, не готовы
  const lot = b.bulk ? s.lots[b.bulk] : undefined;
  const sm = lot?.sample ? s.samples[lot.sample] : undefined;
  const day = momentOf(s.start, s.t).day;
  const lines = db.specs[inForce(db, 'specs', db.materials[r.bulk].spec, day)].tests;
  const methods = sm ? [...new Set(sm.tests.map(id => s.tests[id].method))] : lines.map(x => x.test);
  for (const m of methods) {
    const attr = db.tests[m].attr;
    if (attrs && !attrs.has(attr)) continue;
    const qs = sm ? Object.values(s.tests).filter(q => q.sample === sm.id && q.method === m && !q.invalid && q.state === 'done') : [];
    const last = qs.reduce<(typeof qs)[number] | undefined>((a, q) => (!a || q.done! > a.done! ? q : a), undefined);
    out.push({ kind: 'lab', test: m, attr, n: qs.length, out: last && !last.pass ? 1 : 0, done: !!last, ...(last ? { result: last.result! } : {}) });
  }
  return out;
}

/**
 * Можно ли оценивать отклонение: оно открыто и оценки не было; это не результат вне спецификации и у серии нет
 * открытого расследования; у серии есть балк и лаборатория его решила — испытания балка кончились. Иначе — отказ.
 */
export function assessBlock(s: PlantState, d: Deviation | undefined): Refusal | undefined {
  const b = d?.batch ? s.batches[d.batch] : undefined;
  if (!d || !b) return 'noDev';
  if (d.status !== 'open' || d.assess || b.status === 'released' || b.status === 'rejected') return 'devDone';
  if (d.kind === 'oos' || invOpen(s, b)) return 'devInv';
  const lot = b.bulk ? s.lots[b.bulk] : undefined;
  if (!lot || lot.status === 'quarantine' || lot.status === 'sampled' || lot.status === 'testing') return 'bulkPending';
  return undefined;
}

/**
 * Команда «оценить» (Б1г, пост качества): «без влияния на качество» — только когда связанные испытания серии готовы и в
 * пределах; «отклонить серию» — когда лаборатория решила балк. Работу делает специалист ООК — час по досье.
 */
export function assessCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'assess' }>, notices: Notice[]) {
  const d = s.deviations[cmd.deviation];
  const why = assessBlock(s, d);
  if (why) return notices.push({ kind: 'refused', cmd: 'assess', why, detail: cmd.deviation });
  if (cmd.verdict === 'none') {
    const tests = linkedTests(db, s, d);
    const pending = tests.find(x => !x.done);
    if (pending) return notices.push({ kind: 'refused', cmd: 'assess', why: 'testPending', detail: pending.test });
    const bad = tests.find(x => x.out > 0);
    if (bad) return notices.push({ kind: 'refused', cmd: 'assess', why: 'outOfSpec', detail: bad.test });
  }
  startAssess(db, s, d, cmd.verdict, cmd.by ?? 'player');
}

function startAssess(db: ContentDb, s: PlantState, d: Deviation, verdict: 'none' | 'reject', by: string) {
  const plan = planOf(db, s.plant);
  const t = addTask(s, { kind: 'devAssess', roles: [...QA.specialists], from: { kind: 'point', x: plan.lab.x, z: plan.lab.z }, work: DEV_WORK, prio: QA_PRIO.devAssess, dev: d.id, batch: d.batch });
  d.assess = { verdict, by, t: s.t, task: t.id };
}

/**
 * Оценка сделана: «без влияния» — отклонение оценено, и серию, которую держат, уполномоченное лицо решает снова;
 * «отклонить» — отклонение закрыто, серию отклоняет уполномоченное лицо, а балк, который не пойдёт на упаковку, —
 * сразу. Отклонение, которое за этот час решили иначе (расследование, решение по серии), остаётся как решено.
 */
function assessed(db: ContentDb, s: PlantState, d: Deviation, notices: Notice[]) {
  const a = d.assess!;
  delete a.task;
  a.done = s.t;
  if (d.status !== 'open') return;
  const b = s.batches[d.batch!];
  notices.push({ kind: 'assessed', id: d.id, verdict: a.verdict, code: batchNo(b.code) });
  if (a.verdict === 'none') {
    d.status = 'assessed';
    redecide(db, s, b);
    return;
  }
  d.status = 'closed';
  b.decision = 'reject';
  if (b.status === 'bulk') {
    // балк разрешён, а упаковки у серии нет: отклонить партию балка — серия отклонится шагом производства
    const lot = s.lots[b.bulk!];
    if (lot.status === 'released') setLotStatus(s, lot, 'blocked');
    if (lot.status === 'blocked') setLotStatus(s, lot, 'rejected');
    for (const x of openDevs(s, b)) x.status = 'closed';
    defect(s, 'batches');
    return;
  }
  redecide(db, s, b);
}

/**
 * Коллега качества (Б1г; геймдизайн, §29.3): пока пост качества не у игрока, каждый час оценивает отклонения, которые
 * уже можно оценить, по тому же правилу, что и игрок: связанные испытания готовы и в пределах — «без влияния», хоть
 * одно вне — «отклонить серию». Своего состояния у коллеги нет.
 */
export function devHour(db: ContentDb, s: PlantState): boolean {
  if (playerLeads(s)) return false;
  let acted = false;
  for (const d of Object.values(s.deviations)) {
    if (d.status !== 'open' || assessBlock(s, d)) continue;
    const tests = linkedTests(db, s, d);
    if (tests.some(x => !x.done)) continue;
    startAssess(db, s, d, tests.some(x => x.out > 0) ? 'reject' : 'none', 'head:quality');
    acted = true;
  }
  return acted;
}
