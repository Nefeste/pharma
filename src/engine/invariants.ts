// Инварианты завода (docs/02-architecture.md, §15; docs/specs/2026-10-engine.md, «Инварианты 1а», 1б–1е). Чистая
// проверка состояния: список нарушений, пустой — всё в порядке. Её зовут тесты и «виртуальный директор» на каждом шаге
// проверки.
import type { Attr, ContentDb } from '../content/types';
import { batchNo } from './batchno';
import { geo, good, SIXTY } from './line';
import { partsOf, partType } from './maint';
import { orderReserved } from './market';
import { clampAttr } from './mes';
import { classOf, placesOf } from './places';
import { planOf } from './plant';
import { shiftEnd } from './staff';
import { containersByLot, LOT_FLOW, TAG } from './stock';
import type { LotStatus, PlantState } from './types';

/**
 * Где может стоять паллета партии до решения: дальше карантина и пробоотборной — только после «разрешено»; готовая
 * продукция — на месте паллетирования или в карантине ГП.
 */
const BEFORE_DECISION = new Set(['receiving', 'quarantine', 'cold', 'sampling', 'palletizing', 'fgQuarantine']);
const UNDECIDED: ReadonlySet<LotStatus> = new Set(['quarantine', 'sampled', 'testing']);

export function check(db: ContentDb, s: PlantState): string[] {
  const bad: string[] = [];
  const plan = planOf(db, s.plant);
  // баланс масс: принято = остаток в таре + израсходовано + в пробах + списано
  const left: Record<string, number> = {};
  for (const c of Object.values(s.containers)) {
    left[c.lot] = (left[c.lot] ?? 0) + c.qty;
    if (c.qty < 0) bad.push(`тара ${c.id}: остаток ${c.qty}`);
    const u = s.units[c.unit];
    if (!u) bad.push(`тара ${c.id}: нет паллеты ${c.unit}`);
    else if (!u.items.includes(c.id)) bad.push(`тара ${c.id}: паллета ${u.id} её не знает`);
    if (!s.lots[c.lot]) bad.push(`тара ${c.id}: нет партии ${c.lot}`);
  }
  for (const lot of Object.values(s.lots)) {
    const sum = (left[lot.id] ?? 0) + lot.used + lot.sampled + lot.written + (lot.shipped ?? 0);
    if (sum !== lot.qty) bad.push(`партия ${lot.id}: принято ${lot.qty}, а в таре, расходе и отгрузках ${sum}`);
    if (!(lot.status in LOT_FLOW)) bad.push(`партия ${lot.id}: статус ${lot.status}`);
  }
  // паллета — ровно в одном месте; место — не больше одной паллеты
  for (const u of Object.values(s.units)) {
    for (const cid of u.items) if (s.containers[cid]?.unit !== u.id) bad.push(`паллета ${u.id}: тара ${cid} числится не здесь`);
    if (u.where.kind === 'slot') {
      if (!plan.slot[u.where.id]) bad.push(`паллета ${u.id}: нет места ${u.where.id}`);
      if (s.slots[u.where.id]?.unit !== u.id) bad.push(`паллета ${u.id}: место ${u.where.id} занято другим`);
    } else if (u.where.kind === 'room') {
      if (!plan.room[u.where.id]) bad.push(`паллета ${u.id}: нет помещения ${u.where.id}`);
    } else {
      const tr = s.trucks[u.where.id];
      if (!tr || !tr.units.includes(u.id)) bad.push(`паллета ${u.id}: фура ${u.where.id} её не везёт`);
    }
  }
  for (const [id, use] of Object.entries(s.slots)) {
    if (use.unit) {
      const u = s.units[use.unit];
      if (!u || u.where.kind !== 'slot' || u.where.id !== id) bad.push(`место ${id}: паллета ${use.unit} стоит не здесь`);
    }
    if (use.held) {
      const t = s.tasks[use.held];
      if (!t || t.to !== id) bad.push(`место ${id}: держит задача ${use.held}, которой нет или она везёт не сюда`);
      if (use.unit) bad.push(`место ${id}: занято и одновременно держится задачей`);
    }
  }
  // паллета — одной партии; ярлык — по её статусу; до решения — не дальше карантина; на стеллаже хранения — только
  // разрешённое (или заблокированное после разрешения)
  const kits = new Set(Object.values(s.batches).flatMap(b => [b.kitUnit, b.pack?.kitUnit].filter((u): u is string => u !== undefined)));
  for (const u of Object.values(s.units)) {
    const lots = new Set(u.items.map(c => s.containers[c]?.lot));
    // комплект серии в помещении — тара разных партий, все разрешены
    if (kits.has(u.id)) {
      if (u.where.kind !== 'room') bad.push(`паллета ${u.id}: комплект серии не в помещении`);
      for (const id of lots) if (s.lots[id!]?.status !== 'released') bad.push(`паллета ${u.id}: в комплекте партия ${id} не разрешена`);
      continue;
    }
    // паллета заказа — серии в обороте; в экспедиции или в фуре покупателя заказа
    if (u.order) {
      const o = s.orders[u.order];
      if (!o || o.status !== 'open' || !o.units.includes(u.id)) bad.push(`паллета ${u.id}: заказ ${u.order} её не знает`);
      for (const id of lots) if (s.lots[id!]?.status !== 'released' || s.lots[id!]?.circulation === undefined) bad.push(`паллета ${u.id}: в заказе партия ${id} не в обороте`);
      const where = u.where.kind === 'slot' ? plan.slot[u.where.id]?.kind : u.where.kind === 'truck' ? 'truck' : u.where.kind;
      if (where !== 'shipping' && !(where === 'truck' && s.trucks[u.where.id]?.customer === o?.customer)) bad.push(`паллета ${u.id}: паллета заказа не в экспедиции и не в его фуре`);
      continue;
    }
    if (lots.size !== 1) {
      bad.push(`паллета ${u.id}: партий на ней ${lots.size}`);
      continue;
    }
    const lot = s.lots[[...lots][0]!];
    if (!lot) continue;
    if (u.tag !== TAG[lot.status]) bad.push(`паллета ${u.id}: ярлык ${u.tag}, а партия ${lot.id} — ${lot.status}`);
    if (u.where.kind !== 'slot') continue;
    const kind = plan.slot[u.where.id]?.kind;
    if (!kind) continue;
    if (UNDECIDED.has(lot.status) && !BEFORE_DECISION.has(kind)) bad.push(`паллета ${u.id}: партия ${lot.id} (${lot.status}) уже в «${kind}»`);
    if (kind === 'storage' && lot.status !== 'released' && lot.status !== 'blocked') bad.push(`паллета ${u.id}: партия ${lot.id} (${lot.status}) на стеллаже хранения`);
  }
  for (const tr of Object.values(s.trucks)) {
    for (const uid of tr.units) {
      const u = s.units[uid];
      if (!u || u.where.kind !== 'truck' || u.where.id !== tr.id) bad.push(`фура ${tr.id}: паллета ${uid} не на ней`);
    }
  }
  // люди и техника — не больше одной задачи; задача знает своих людей
  for (const p of Object.values(s.people)) {
    if (p.task && !s.tasks[p.task]?.people.includes(p.id)) bad.push(`человек ${p.id}: задача ${p.task} его не знает`);
    // путь на пост или к выходу — только у свободного в смене (3а)
    if (p.walk && p.task) bad.push(`человек ${p.id}: идёт на пост с задачей ${p.task}`);
    if (p.walk && shiftEnd(db, s, p) === undefined) bad.push(`человек ${p.id}: идёт на пост вне смены`);
  }
  for (const v of Object.values(s.vehicles)) {
    if (v.task && s.tasks[v.task]?.vehicle !== v.id) bad.push(`техника ${v.id}: задача ${v.task} её не знает`);
  }
  const open = new Set(s.open);
  if (open.size !== s.open.length) bad.push('очередь задач: повторы');
  for (const t of Object.values(s.tasks)) {
    if (t.state === 'open' && !open.has(t.id)) bad.push(`задача ${t.id}: открыта, но не в очереди`);
    if (t.state === 'busy') {
      if (open.has(t.id)) bad.push(`задача ${t.id}: занята, но в очереди`);
      for (const pid of t.people) if (s.people[pid]?.task !== t.id) bad.push(`задача ${t.id}: ${pid} занят другим`);
      if (t.vehicle && s.vehicles[t.vehicle]?.task !== t.id) bad.push(`задача ${t.id}: техника ${t.vehicle} занята другим`);
    }
  }
  for (const id of s.open) if (!s.tasks[id]) bad.push(`очередь задач: нет задачи ${id}`);
  // пробы: партия их знает, тара из плана — этой партии, отобранное сходится с партией
  for (const sm of Object.values(s.samples)) {
    const lot = s.lots[sm.lot];
    if (!lot || lot.sample !== sm.id) bad.push(`пробы ${sm.id}: партия ${sm.lot} их не знает`);
    // тара плана — этой партии; израсходованную до дна тару учёт уже забыл, а план отбора — история
    for (const cid of sm.plan) if (s.containers[cid] && s.containers[cid].lot !== sm.lot) bad.push(`пробы ${sm.id}: тара ${cid} не этой партии`);
    for (const uid of sm.left) if (!s.units[uid]?.items.some(c => sm.plan.includes(c))) bad.push(`пробы ${sm.id}: на паллете ${uid} нет тары из плана`);
    if (lot && sm.qty !== lot.sampled) bad.push(`пробы ${sm.id}: отобрано ${sm.qty}, а у партии ${lot.sampled}`);
    if (lot && lot.status !== 'quarantine' && (sm.left.length > 0 || sm.taken === undefined)) bad.push(`пробы ${sm.id}: партия ${lot.status}, а отбор не кончен`);
    for (const qid of sm.tests) if (s.tests[qid]?.sample !== sm.id) bad.push(`пробы ${sm.id}: испытание ${qid} не их`);
  }
  for (const lot of Object.values(s.lots)) {
    if (lot.sample && !s.samples[lot.sample]) bad.push(`партия ${lot.id}: нет проб ${lot.sample}`);
    if ((lot.status === 'sampled' || lot.status === 'testing') && !lot.sample) bad.push(`партия ${lot.id}: ${lot.status} без проб`);
    if (lot.status === 'testing' && s.samples[lot.sample!]?.tests.length === 0) bad.push(`партия ${lot.id}: на испытаниях без испытаний`);
  }
  // приборы и испытания знают друг друга; результат проверен не тем, кто его получил
  for (const i of Object.values(s.instruments)) {
    if (!i.test) continue;
    const q = s.tests[i.test];
    if (!q || q.inst !== i.id || (q.state !== 'prep' && q.state !== 'run')) bad.push(`прибор ${i.id}: занят испытанием ${i.test}, которое на нём не идёт`);
  }
  for (const q of Object.values(s.tests)) {
    // испытание шага расследования (часть 4) — той же пробы, но в решение по партии не входит: его знает расследование
    if (q.inv) {
      if (!s.samples[q.sample]) bad.push(`испытание ${q.id}: пробы ${q.sample} нет`);
      if (!s.investigations[q.inv]?.runs.some(r => r.test === q.id)) bad.push(`испытание ${q.id}: расследование ${q.inv} его не знает`);
    } else if (!s.samples[q.sample]?.tests.includes(q.id)) bad.push(`испытание ${q.id}: пробы ${q.sample} его не знают`);
    if (q.inst && (q.state === 'prep' || q.state === 'run') && s.instruments[q.inst]?.test !== q.id) bad.push(`испытание ${q.id}: прибор ${q.inst} занят другим`);
    if (q.state === 'run' && !q.inst) bad.push(`испытание ${q.id}: прибор работает, а прибора нет`);
    if ((q.state === 'review' || q.state === 'done') && q.result === undefined) bad.push(`испытание ${q.id}: ${q.state} без результата`);
    if (q.state === 'done' && (q.pass === undefined || !q.checker || q.checker === q.by)) bad.push(`испытание ${q.id}: результат без проверки вторым лицом`);
  }
  for (const t of Object.values(s.tasks)) {
    if (t.instrument && s.instruments[t.instrument]?.test !== t.test) bad.push(`задача ${t.id}: прибор ${t.instrument} занят не её испытанием`);
  }
  production(db, s, bad);
  packing(db, s, bad);
  market(db, s, bad);
  maint(db, s, bad);
  lean(s, bad);
  assets(db, s, bad);
  // номер серии (batchno.ts): досье выдано — номер есть; смешивание начато — номер полный; полный номер не повторяется,
  // короткий — среди серий до смешивания
  const full = new Map<string, string>();
  const short = new Map<string, string>();
  for (const b of Object.values(s.batches)) {
    const c = b.code;
    if (b.status !== 'waiting' && b.status !== 'reserved' && c.n === 0) bad.push(`серия ${b.id}: досье выдано без номера`);
    if (c.n === 0) continue;
    if (c.pp !== db.products[b.product].code) bad.push(`серия ${b.id}: код ${c.pp} — не код продукта`);
    const mix = db.recipes[b.recipe].stages.findIndex(st => st.mix);
    if (b.stage > mix && c.m === 0) bad.push(`серия ${b.id}: смешивание было, номер короткий`);
    const no = batchNo(c);
    const seen = c.m === 0 ? short : full;
    if (seen.has(no)) bad.push(`номер серии ${no} — у ${seen.get(no)} и ${b.id}`);
    seen.set(no, b.id);
  }
  return bad;
}

/**
 * Инварианты мест и оборудования (Б3в): у каждой вещи плана и техники — актив, инвентарные номера разные; записи — день не
 * позже срока, по порядку; визит подрядчика — работа, которая нужна классу, начатый — с концом позже начала, ждущий приёмки —
 * с её задачей; приёмка — только у актива с законченной работой.
 */
function assets(db: ContentDb, s: PlantState, bad: string[]) {
  const P = placesOf(planOf(db, s.plant).plant);
  for (const t of P.things) if (!s.assets[t.id]) bad.push(`вещь ${t.id}: нет актива`);
  for (const v of Object.values(s.vehicles)) if (!s.assets[v.id]) bad.push(`техника ${v.id}: нет актива`);
  const invs = new Set<number>();
  for (const a of Object.values(s.assets)) {
    if (invs.has(a.inv)) bad.push(`актив ${a.id}: инвентарный номер ${a.inv} повторяется`);
    invs.add(a.inv);
    const last: Partial<Record<string, number>> = {};
    for (const r of a.recs) {
      if (r.day > r.until) bad.push(`актив ${a.id}: запись ${r.work} кончается раньше, чем принята`);
      if ((last[r.work] ?? r.day) > r.day) bad.push(`актив ${a.id}: записи ${r.work} не по порядку`);
      last[r.work] = r.day;
    }
    const v = a.visit;
    if (!v) continue;
    if (!classOf(db, a)[v.work]) bad.push(`актив ${a.id}: визит ${v.work}, а классу она не нужна`);
    if (v.from !== undefined && (v.to === undefined || v.to <= v.from)) bad.push(`актив ${a.id}: визит без конца работы`);
    if (v.task !== undefined && s.tasks[v.task]?.kind !== 'accept') bad.push(`актив ${a.id}: приёмки ${v.task} нет`);
  }
  for (const t of Object.values(s.tasks)) {
    if (t.kind !== 'accept') continue;
    const a = t.asset ? s.assets[t.asset] : undefined;
    if (!a?.visit || a.visit.task !== t.id) bad.push(`задача ${t.id}: приёмка без законченной работы подрядчика`);
  }
}

/**
 * Инварианты потерь и ритма (docs/specs/2026-10-engine.md, 1ж): время серии с задания разложено по состояниям без
 * остатка; ждёт только открытая задача, и не дольше, чем есть; сутки потерь — по порядку; у сменного задания выпуск не
 * меньше нуля, открытое — одно на линию и смену.
 */
function lean(s: PlantState, bad: string[]) {
  for (const b of Object.values(s.batches)) {
    if (b.status === 'released' || b.status === 'rejected') {
      if (b.phase) bad.push(`серия ${b.id}: ${b.status}, а время ещё идёт (${b.phase})`);
      continue;
    }
    const sum = Object.values(b.spent).reduce((n, x) => n + x, 0) + (b.phase ? s.t - b.phaseAt : 0);
    if (sum !== s.t - b.ordered) bad.push(`серия ${b.id}: по состояниям ${sum} с, а с задания ${s.t - b.ordered}`);
  }
  for (const t of Object.values(s.tasks)) {
    if (t.why && (t.state !== 'open' || t.since === undefined || t.since > s.t)) bad.push(`задача ${t.id}: ждёт (${t.why}), а она ${t.state}`);
  }
  for (let i = 1; i < s.losses.length; i++) if (s.losses[i].day <= s.losses[i - 1].day) bad.push(`потери: сутки ${s.losses[i].day} не по порядку`);
  const open = new Set<string>();
  for (const st of s.shiftTasks) {
    if (st.plan < 0 || (st.fact !== undefined && st.fact < 0)) bad.push(`сменное задание ${st.line}, ${st.shift}, ${st.from}: задание ${st.plan}, выпуск ${st.fact}`);
    if (st.to !== undefined) continue;
    const key = `${st.line}/${st.shift}`;
    if (open.has(key)) bad.push(`сменное задание ${key}: открыто два`);
    open.add(key);
  }
}

/**
 * Инварианты техслужбы (docs/specs/2026-10-engine.md, 1е): исправный узел — с запасом до отказа, отказавший — без; задача
 * ремонта и узел знают друг друга; в резерве ЗИП — столько запчастей, сколько задач ремонта, и не больше, чем на складе;
 * машина линии в аварии — пока её узел не исправен; на отказавшем узле стадия не идёт; стадия с остановкой — ждёт ремонта.
 */
function maint(db: ContentDb, s: PlantState, bad: string[]) {
  const reserved: Record<string, number> = {};
  for (const pt of Object.values(s.parts)) {
    if (pt.done < 0) bad.push(`узел ${pt.id}: наработка ${pt.done}`);
    if (pt.state === 'ok' && pt.budget <= 0) bad.push(`узел ${pt.id}: исправен, а запаса до отказа нет`);
    if (pt.state === 'failed' && (pt.budget !== 0 || pt.failed === undefined)) bad.push(`узел ${pt.id}: отказал, а запас ${pt.budget}`);
    if (pt.task) {
      const t = s.tasks[pt.task];
      if (!t || t.kind !== 'repair' || t.part !== pt.id) bad.push(`узел ${pt.id}: задачи ремонта ${pt.task} нет`);
      const spare = partType(db, pt).spare;
      reserved[spare] = (reserved[spare] ?? 0) + 1;
    }
    if (pt.state === 'failed' && !pt.line && Object.values(s.tasks).some(t => t.kind === 'stage' && t.state === 'busy' && t.batch === s.equipment[pt.machine].batch)) bad.push(`узел ${pt.id}: отказал, а стадия на нём идёт`);
  }
  for (const t of Object.values(s.tasks)) if (t.kind === 'repair' && s.parts[t.part!]?.task !== t.id) bad.push(`задача ${t.id}: узел ${t.part} её не знает`);
  for (const [id, st] of Object.entries(s.spares)) {
    if (st.reserved !== (reserved[id] ?? 0)) bad.push(`ЗИП ${id}: в резерве ${st.reserved}, а задач ремонта ${reserved[id] ?? 0}`);
    if (st.reserved < 0 || st.reserved > st.qty) bad.push(`ЗИП ${id}: на складе ${st.qty}, в резерве ${st.reserved}`);
  }
  for (const line of Object.values(s.lines)) {
    for (const mc of line.machines) {
      const down = partsOf(s, mc.id).some(p => p.state === 'failed' || p.task !== undefined);
      const failed = partsOf(s, mc.id).some(p => p.state === 'failed');
      if (mc.broken && !down) bad.push(`линия ${line.id}, ${mc.id}: авария, а узлы исправны`);
      if (failed && !mc.broken) bad.push(`линия ${line.id}, ${mc.id}: узел отказал, а машина работает`);
    }
  }
  for (const b of Object.values(s.batches)) {
    if (!b.run) continue;
    const working = Object.values(s.tasks).some(t => t.kind === 'stage' && t.batch === b.id);
    if (b.status !== 'process' || (!working && b.run.rest === undefined)) bad.push(`серия ${b.id}: стадия с узлами не идёт и не ждёт ремонта`);
    if (b.run.left < 0 || b.run.left > b.run.units) bad.push(`серия ${b.id}: таблеток стадии осталось ${b.run.left} из ${b.run.units}`);
  }
}

/**
 * Инварианты рынка и кассы (docs/specs/2026-10-engine.md, 1д): касса = начальная + проводки; счета — по сроку;
 * отгружено и зарезервировано — не больше заказанного; резерв открытого заказа — его ящики; отгрузка — по цене позиций.
 */
function market(db: ContentDb, s: PlantState, bad: string[]) {
  const c = s.cash;
  const sum = c.ledger.reduce((n, e) => n + e.sum, c.start);
  if (sum !== c.balance) bad.push(`касса: ${c.balance}, а начальная и проводки дают ${sum}`);
  for (let i = 1; i < c.dues.length; i++) if (c.dues[i - 1].due > c.dues[i].due) bad.push(`касса: счёт ${c.dues[i].id} не по сроку`);
  for (const o of Object.values(s.orders)) {
    for (const l of o.lines) if (l.reserved > l.cases || l.shipped > l.cases) bad.push(`заказ ${o.id}: по ${l.sku} заказано ${l.cases}, резерв ${l.reserved}, отгружено ${l.shipped}`);
    if (o.status !== 'open' && (o.cases.length > 0 || o.units.length > 0)) bad.push(`заказ ${o.id}: закрыт, а ящики или паллеты ещё за ним`);
    for (const cid of o.cases) {
      const ct = s.containers[cid];
      if (!ct || ct.reserved !== ct.qty) bad.push(`заказ ${o.id}: ящик ${cid} не в резерве`);
    }
    for (const uid of o.units) if (s.units[uid]?.order !== o.id) bad.push(`заказ ${o.id}: паллета ${uid} не его`);
  }
  const fgSku = new Map(Object.values(db.skus).map(k => [k.fg, k]));
  for (const sh of Object.values(s.shipments)) {
    const money = sh.cases.reduce((n, x) => n + x.qty * fgSku.get(s.lots[x.lot].material)!.price, 0);
    if (money !== sh.sum) bad.push(`отгрузка ${sh.id}: сумма ${sh.sum}, а по ящикам ${money}`);
    const lines = sh.orders.reduce((n, id) => n + s.orders[id].lines.reduce((k, l) => k + l.shipped, 0), 0);
    if (lines !== sh.cases.length) bad.push(`отгрузка ${sh.id}: ящиков ${sh.cases.length}, а в заказах отгружено ${lines}`);
  }
}

/**
 * Инварианты производства (docs/specs/2026-10-engine.md, 1в): резерв сходится с комплектами; стадия идёт только в
 * помещении, занятом этой серией, на её оборудовании; масса сходится по стадиям; израсходованное у партий — это
 * отвешенное в серии; истинный показатель — номинал + разброс + записанные вклады причин.
 */
function production(db: ContentDb, s: PlantState, bad: string[]) {
  const reserved: Record<string, number> = {};
  const used: Record<string, number> = {};
  for (const b of Object.values(s.batches)) {
    const r = db.recipes[b.recipe];
    for (const k of b.kit) reserved[k.container] = (reserved[k.container] ?? 0) + k.qty;
    if (b.kit.length > 0 && b.status !== 'reserved' && b.status !== 'kitting' && b.status !== 'process') bad.push(`серия ${b.id}: ${b.status}, а комплект ещё в резерве`);
    let dispensed = 0;
    for (const x of b.dispensed) {
      dispensed += x.qty;
      used[x.lot] = (used[x.lot] ?? 0) + x.qty;
    }
    // упаковка: материалы — по факту, балк — весь, когда серия упакована
    const job = b.pack;
    if (job) {
      for (const k of job.kit) reserved[k.container] = (reserved[k.container] ?? 0) + k.qty;
      for (const x of job.used) used[x.lot] = (used[x.lot] ?? 0) + x.qty;
      if (job.state === 'done') used[b.bulk!] = (used[b.bulk!] ?? 0) + job.tablets;
      if (job.kit.length > 0 && !['reserved', 'kitting', 'ready', 'running'].includes(job.state)) bad.push(`серия ${b.id}: упаковка ${job.state}, а комплект ещё в резерве`);
    }
    // масса: отвешено = полупродукт + потери по стадиям; у каждой стадии вход = выход + потери
    const loss = b.records.reduce((n, rec) => n + rec.loss, 0);
    if (dispensed !== b.mass + loss) bad.push(`серия ${b.id}: отвешено ${dispensed}, а в работе и потерях ${b.mass + loss}`);
    for (const rec of b.records.slice(1)) if (rec.in !== rec.out + rec.loss) bad.push(`серия ${b.id}, ${rec.stage}: вход ${rec.in} ≠ выход ${rec.out} + потери ${rec.loss}`);
    // причины: показатель — это номинал, разброс и вклады, без остатка
    for (const [a, v] of Object.entries(b.truth) as [Attr, number][]) {
      const sum = (r.quality[a]?.[0] ?? 0) + (b.noise[a] ?? 0) + b.causes.filter(c => c.attr === a).reduce((n, c) => n + c.delta, 0);
      if (clampAttr(a, sum) !== v) bad.push(`серия ${b.id}: ${a} = ${v}, а номинал, разброс и причины дают ${sum}`);
    }
    if (b.room && b.status === 'process' && s.rooms[b.room]?.batch !== b.id && Object.values(s.tasks).some(t => t.kind === 'stage' && t.batch === b.id)) bad.push(`серия ${b.id}: стадия идёт, а помещение ${b.room} не её`);
    if (b.bulk && !s.lots[b.bulk]) bad.push(`серия ${b.id}: нет партии балка ${b.bulk}`);
  }
  for (const [cid, qty] of orderReserved(s)) reserved[cid] = (reserved[cid] ?? 0) + qty;
  for (const c of Object.values(s.containers)) {
    if ((c.reserved ?? 0) !== (reserved[c.id] ?? 0)) bad.push(`тара ${c.id}: резерв ${c.reserved ?? 0}, а в комплектах и заказах ${reserved[c.id] ?? 0}`);
    if ((c.reserved ?? 0) > c.qty) bad.push(`тара ${c.id}: резерв ${c.reserved} больше остатка ${c.qty}`);
  }
  for (const lot of Object.values(s.lots)) if (lot.used !== (used[lot.id] ?? 0)) bad.push(`партия ${lot.id}: израсходовано ${lot.used}, а отвешено в серии ${used[lot.id] ?? 0}`);
  // помещение занято серией — только «занято»; оборудование занято — только серией, которая в этом помещении
  for (const room of Object.values(s.rooms)) {
    if ((room.status === 'busy') !== (room.batch !== undefined)) bad.push(`помещение ${room.id}: ${room.status}, серия ${room.batch ?? '—'}`);
    if (room.batch && s.batches[room.batch]?.room !== room.id) bad.push(`помещение ${room.id}: серия ${room.batch} числится не здесь`);
  }
  for (const e of Object.values(s.equipment)) {
    if (e.batch && s.batches[e.batch]?.room !== e.room) bad.push(`оборудование ${e.id}: занято серией ${e.batch}, а она не в этом помещении`);
  }
  for (const t of Object.values(s.tasks)) {
    if (t.kind !== 'stage') continue;
    const b = s.batches[t.batch!];
    const room = b?.room ? s.rooms[b.room] : undefined;
    if (!room || room.batch !== b.id || room.status !== 'busy') bad.push(`задача ${t.id}: стадия серии ${t.batch} не в её помещении`);
  }
}

/**
 * Инварианты линии и упаковки (docs/specs/2026-10-engine.md, 1г): позиции машин — по порядку потока, накопители в
 * пределах; проход машины = номинал × время на номинале + проход «медленнее», время состояний = время задания; каждый
 * код — ровно в одном ящике, в браке или в архиве; таблетки = пачки × таблеток в пачке + брак + остаток; сверка сходится.
 */
function packing(db: ContentDb, s: PlantState, bad: string[]) {
  const byLot = containersByLot(s);
  // отгруженные ящики — коды ушли к покупателю, но остаются кодами серии
  const shippedCodes = new Map<string, [number, number][]>();
  for (const sh of Object.values(s.shipments)) for (const x of sh.cases) shippedCodes.set(x.lot, [...(shippedCodes.get(x.lot) ?? []), ...x.codes]);
  const containersOf = (lotId: string) => byLot.get(lotId) ?? [];
  for (const line of Object.values(s.lines)) {
    const b = line.batch ? s.batches[line.batch] : undefined;
    const crew = Object.values(s.tasks).filter(t => t.kind === 'crew' && t.line === line.id);
    if (crew.length > 0 && b?.pack?.state !== 'running') bad.push(`линия ${line.id}: смена у линии без упаковки`);
    if (line.t > s.t) bad.push(`линия ${line.id}: поток посчитан вперёд часов`);
    if (!b) continue;
    const job = b.pack;
    if (!job || b.status !== 'packing' || job.taken === undefined) {
      bad.push(`линия ${line.id}: серия ${b.id} не на упаковке`);
      continue;
    }
    const g = geo(db, s, line, job.sku);
    const m = line.machines;
    m.forEach((mc, i) => {
      const t = mc.times;
      const spent = t.run + t.slow + t.micro + t.fail + t.wait + t.setup + t.off;
      if (spent !== line.t - job.taken!) bad.push(`линия ${line.id}, ${mc.id}: время состояний ${spent}, а задание идёт ${line.t - job.taken!}`);
      if (t.out !== mc.pos) bad.push(`линия ${line.id}, ${mc.id}: проход ${t.out}, а позиция ${mc.pos}`);
      if (t.out !== g.nominal[i] * t.run + t.slowOut) bad.push(`линия ${line.id}, ${mc.id}: проход ${t.out} ≠ номинал × ${t.run} + ${t.slowOut}`);
      if (i > 0 && mc.pos > m[i - 1].pos) bad.push(`линия ${line.id}, ${mc.id}: обогнала машину перед собой`);
      if (i < m.length - 1 && mc.pos - m[i + 1].pos > g.cap[i]) bad.push(`линия ${line.id}, ${mc.id}: накопитель переполнен`);
    });
    if (m[0].pos > job.tablets * SIXTY) bad.push(`линия ${line.id}: таблеток больше, чем в балке`);
    // коды до текущей позиции: брак камеры — по счёту, в ящиках — не больше годных
    const rejects = job.checked - good(job.checked, g.rej[1]);
    if (job.rejected.length !== rejects) bad.push(`серия ${b.id}: кодов брака ${job.rejected.length}, а по счёту ${rejects}`);
    const inCases = job.fg ? containersOf(job.fg).reduce((n, c) => n + c.qty, 0) : 0;
    if (inCases > good(job.checked, g.rej[1])) bad.push(`серия ${b.id}: в ящиках ${inCases} пачек, а годных сделано меньше`);
  }
  for (const b of Object.values(s.batches)) {
    const job = b.pack;
    if (!job || job.state !== 'done') continue;
    const sku = db.skus[job.sku];
    // таблетки = блистеров в годных пачках × таблеток в блистере + брак + остаток
    const goodCartons = job.cartons! - job.cartonRejects!;
    const tablets = goodCartons * sku.blisters * sku.perBlister + job.scrap! + job.remainder!;
    if (tablets !== job.tablets) bad.push(`серия ${b.id}: таблеток ${job.tablets}, а в пачках, браке и остатке ${tablets}`);
    // каждый код 1…пачек — ровно один раз: в ящике, в браке или в архиве. Отрезки по порядку должны сложиться встык
    const parts: [number, number][] = [...(shippedCodes.get(job.fg!) ?? [])];
    for (const c of containersOf(job.fg!)) {
      let n = 0;
      for (const r of c.codes ?? []) {
        parts.push(r);
        n += r[1];
      }
      if (n !== c.qty) bad.push(`ящик ${c.id}: пачек ${c.qty}, а кодов ${n}`);
    }
    for (const code of [...job.rejected, ...job.retained]) parts.push([code, 1]);
    parts.sort((x, y) => x[0] - y[0]);
    let at = 1;
    for (const [first, count] of parts) {
      if (first !== at) break;
      at += count;
    }
    if (at !== job.cartons! + 1) bad.push(`серия ${b.id}: коды пачек — не каждый ровно в одном месте`);
    // сверка сходится с точностью до испорченного при заминках, но не записанного
    for (const r of job.recon ?? []) {
      const lost = (job.lost ?? 0) * (sku.carton.find(l => l.material === r.material)?.qty ?? 0);
      if (r.issued !== r.used + r.spoiled + r.returned + lost) bad.push(`серия ${b.id}: сверка ${r.material} не сходится на незаписанное`);
    }
  }
}

