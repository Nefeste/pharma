// Инварианты завода (docs/02-architecture.md, §15; docs/specs/2026-10-engine.md, «Инварианты 1а», 1б). Чистая проверка
// состояния: список нарушений, пустой — всё в порядке. Её зовут тесты и «виртуальный директор» на каждом шаге проверки.
import type { Attr, ContentDb } from '../content/types';
import { clampAttr } from './mes';
import { planOf } from './plant';
import { LOT_FLOW, TAG } from './stock';
import type { LotStatus, PlantState } from './types';

/** Где может стоять паллета партии до решения: дальше карантина и пробоотборной — только после «разрешено». */
const BEFORE_DECISION = new Set(['receiving', 'quarantine', 'cold', 'sampling']);
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
    const sum = (left[lot.id] ?? 0) + lot.used + lot.sampled + lot.written;
    if (sum !== lot.qty) bad.push(`партия ${lot.id}: принято ${lot.qty}, а в таре и расходе ${sum}`);
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
  const kits = new Set(Object.values(s.batches).flatMap(b => (b.kitUnit ? [b.kitUnit] : [])));
  for (const u of Object.values(s.units)) {
    const lots = new Set(u.items.map(c => s.containers[c]?.lot));
    // комплект серии в помещении — тара разных партий, все разрешены
    if (kits.has(u.id)) {
      if (u.where.kind !== 'room') bad.push(`паллета ${u.id}: комплект серии не в помещении`);
      for (const id of lots) if (s.lots[id!]?.status !== 'released') bad.push(`паллета ${u.id}: в комплекте партия ${id} не разрешена`);
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
    if (!s.samples[q.sample]?.tests.includes(q.id)) bad.push(`испытание ${q.id}: пробы ${q.sample} его не знают`);
    if (q.inst && (q.state === 'prep' || q.state === 'run') && s.instruments[q.inst]?.test !== q.id) bad.push(`испытание ${q.id}: прибор ${q.inst} занят другим`);
    if (q.state === 'run' && !q.inst) bad.push(`испытание ${q.id}: прибор работает, а прибора нет`);
    if ((q.state === 'review' || q.state === 'done') && q.result === undefined) bad.push(`испытание ${q.id}: ${q.state} без результата`);
    if (q.state === 'done' && (q.pass === undefined || !q.checker || q.checker === q.by)) bad.push(`испытание ${q.id}: результат без проверки вторым лицом`);
  }
  for (const t of Object.values(s.tasks)) {
    if (t.instrument && s.instruments[t.instrument]?.test !== t.test) bad.push(`задача ${t.id}: прибор ${t.instrument} занят не её испытанием`);
  }
  production(db, s, bad);
  return bad;
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
  for (const c of Object.values(s.containers)) {
    if ((c.reserved ?? 0) !== (reserved[c.id] ?? 0)) bad.push(`тара ${c.id}: резерв ${c.reserved ?? 0}, а в комплектах ${reserved[c.id] ?? 0}`);
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
