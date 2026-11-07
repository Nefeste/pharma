// Потребность в материалах (Б6д; docs/specs/2026-10-vertical-slice.md, «Б6д»; геймдизайн, §9.3) — расчёт без записи по
// образцу MRP (`eth-opess` § 12.3.2): валовая потребность, доступное, чистая и плановые заказы. План производства — серии
// прогона плана S&OP (src/engine/plan/sop.ts) на 12 месяцев и задания, которые уже стоят; доступное — свободное в
// партиях и заказанное в пути, через входной контроль: в производство идёт только разрешённое ОКК (`eu-gmp-5` п. 5.34).
// Его читают правило снабжения «по потребности» (src/engine/supply.ts) и вкладка «Материалы» (src/sim/mrp.ts). С Б6ж:
// приход заказа в пути — обещанный (настоящего завод не знает), заказ, что не пришёл к обещанному, — сообщение «не пришёл»
// и доступен не раньше сегодня с входным контролем; плановый заказ — поставщику по политике «кому заказывать»
// (src/engine/partners.ts, `choosePair`);
// запас аналога строки карты — доступное основного по коэффициенту: сначала основной, недостающее — аналогом
// (`d365-subst`, `oracle-opm`); плановый заказ — на основной.
import type { ContentDb, Id } from '../../content/types';
import { civilFromDays, daysFromCivil, isWorkday, momentOf, workdayOnOrAfter } from '../core/calendar';
import { inForce } from '../docs';
import { firstDay, monthOfDay } from '../forecast';
import { packNeeds } from '../mes';
import { choosePair, pairsFor, STARTING } from '../partners';
import { trialLot, trialPo, windowEnd } from '../supply';
import { numOf, POL } from '../policies';
import { sopCover } from '../sop';
import { containersByLot } from '../stock';
import type { PackJob, PlantState, PoPick } from '../types';
import { calOf } from '../workdays';
import { sopCtx, sopRun, type SopTrace } from './sop';

/** Горизонт потребности, месяцев (геймдизайн, §9.3). */
export const MRP_MONTHS = 12;
/** «Заказать до …» — когда до даты заказа столько суток и меньше (геймдизайн, §9.3). */
export const MRP_SOON = 7;

/** Задание на серию до упаковки: её упаковку резервируют только на упаковке — это ещё потребность. */
const BEFORE_PACK: ReadonlySet<string> = new Set(['waiting', 'reserved', 'kitting', 'process', 'bulk']);

/** Месяц строки материала: валовая потребность серий месяца и необеспеченная — мг или штуки. */
export interface MrpMonth {
  m: number;
  gross: number;
  net: number;
}

/** Строка материала: месяцы, что есть сейчас, что едет, страховой запас и пара, через которую его заказать. */
export interface MrpRow {
  material: Id;
  months: MrpMonth[];
  /** свободное разрешённое и в карантине или на испытаниях */
  free: number;
  quarantine: number;
  /** заказы в пути: количество и день, когда оно будет разрешено, — приход и входной контроль */
  transit: { po: string; qty: number; day: number }[];
  safety: number;
  /** первая одобренная пара спецификации; нет — заказать не у кого */
  supplier?: Id;
  maker?: Id;
}

/**
 * Плановый заказ (§ 5.1.2b): материал, поставщик и изготовитель пары; сколько хотели — дефицит и расход «на сколько
 * суток заказ», не меньше наименьшей партии, — и количество до целой тары; к какому дню он нужен разрешённым, когда
 * заказать и месяц первой серии, под которую он; дефицит, который он закрывает, и на сколько суток он опоздает, если
 * дефицит начался раньше, чем успевает новый заказ.
 */
export interface MrpOrder {
  material: Id;
  supplier: Id;
  maker: Id;
  want: number;
  qty: number;
  need: number;
  orderBy: number;
  month: number;
  deficit: number;
  late: number;
  /** почему не основной поставщик (Б6ж): у основного опоздает — этот быстрее; или баллы предложений */
  pick?: PoPick;
}

/**
 * Сообщения о действиях (§ 12.5.1, § 12.5.2): у планового заказа — «заказать до …» (через столько суток) и
 * «опаздывает» (придёт на столько суток позже нужного); у заказа в пути — «опоздает» на столько суток и «лишний»; с Б6ж —
 * «не пришёл»: обещанный день прошёл, фуры нет, — на столько суток позже обещанного.
 */
export type MrpMsg =
  | { kind: 'soon' | 'overdue'; material: Id; order: number; days: number }
  | { kind: 'late'; material: Id; po: string; days: number }
  | { kind: 'extra'; material: Id; po: string }
  | { kind: 'behind'; material: Id; po: string; days: number };

export interface MrpResult {
  from: number;
  today: number;
  /** срок завоза: число предыдущего месяца, 0 — к дню серии */
  arrive: number;
  rows: MrpRow[];
  planned: MrpOrder[];
  msgs: MrpMsg[];
}

/** Событие дня материала: сколько становится доступным (плюс) или нужно (минус); у заказа в пути — его номер. */
interface Ev {
  z: number;
  qty: number;
  po?: string;
}

/** Срок завоза — политика начальника отдела снабжения: число предыдущего месяца, 0 — к дню серии; нет политики — 0. */
export const arriveOf = (db: ContentDb, s: PlantState): number => numOf(db, s, POL.arrive) ?? 0;

/**
 * Потребность в материалах сейчас (Б6д). Серии — прогон утверждённого плана S&OP на 12 месяцев: за горизонтом плана —
 * цель политики; задания, которые уже стоят: состав — у ждущих без резерва, упаковка — у всех до упаковки и у задания
 * на упаковку, которому не хватило. Материал серии нужен разрешённым к сроку завоза: на складе к его числу предыдущего
 * месяца и через входной контроль, 0 — к дню серии; не раньше сегодня. Новый заказ успевает только к сегодня + верх
 * срока поставки до рабочего дня + входной контроль: дефицит раньше закрывает уже заказанное — это сообщение «опоздает»,
 * а не новый заказ (§ 12.5.1). Плановый заказ — дефицит до страхового запаса и ещё «на сколько суток заказ» расхода, до
 * целой тары, не меньше наименьшей партии; дата заказа — последний рабочий день, заказ которого успеет к нужному дню.
 */
export function mrpPlan(db: ContentDb, s: PlantState): MrpResult {
  const sc = db.scenarios[s.scenario];
  const today = momentOf(s.start, s.t).day;
  const from = monthOfDay(today);
  const arrive = arriveOf(db, s);
  const qc = sc.supply?.qc ?? 0;
  const cal = calOf(db, s);
  // следующий рабочий день: правило снабжения заказывает в 09:00 рабочего дня
  let nextDay = today + 1;
  while (!isWorkday(cal, nextDay)) nextDay++;
  const out: MrpResult = { from, today, arrive, rows: [], planned: [], msgs: [] };
  if (!sc.plan || !sc.supply || !s.planning.forecast) return out;
  const ctx = sopCtx(db, s, from, MRP_MONTHS, false);
  const plan: Record<Id, number[]> = {};
  for (const p of ctx.products) plan[p] = Array.from({ length: MRP_MONTHS }, (_, i) => sopCover(s, p, firstDay(from + i)) ?? ctx.policy);
  const trace: SopTrace = { sold: new Map(), demand: new Map(), made: [] };
  sopRun(ctx, plan, 0, trace);
  const recipeOf = new Map(sc.plan.items.map(it => [it.sku, it.recipe]));
  // к какому дню материал серии дня `z` нужен разрешённым: к сроку завоза и входному контролю, но не позже дня серии; срок
  // уже прошёл — к дню серии: на этот месяц правило опоздало, и важно одно — успеет ли материал к серии
  const needBy = (z: number) => {
    if (arrive === 0) return Math.max(today, z);
    const c = civilFromDays(z);
    const prev = c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 };
    const by = Math.min(z, daysFromCivil({ y: prev.y, m: prev.m, d: arrive }) + qc);
    return by >= today ? by : Math.max(today, z);
  };
  // валовая потребность: месяц серии — для строки, день нужды — для расчёта
  const gross = new Map<Id, { m: number; nb: number; qty: number }[]>();
  const need = (material: Id, z: number, qty: number) => {
    const xs = gross.get(material) ?? [];
    xs.push({ m: monthOfDay(z), nb: needBy(z), qty });
    gross.set(material, xs);
  };
  const forBatch = (sku: Id, recipe: Id, z: number, bom: boolean, pack: boolean) => {
    const r = db.recipes[inForce(db, 'recipes', recipe, z)];
    if (bom) for (const l of r.bom) need(l.material, z, l.qty);
    if (pack) for (const n of packNeeds(db, { sku, tablets: r.batch.units } as PackJob)) need(n.material, z, n.qty);
  };
  for (const x of trace.made) forBatch(x.sku, recipeOf.get(x.sku)!, x.day, true, true);
  for (const b of Object.values(s.batches)) {
    const z = momentOf(s.start, b.notBefore).day;
    const pack = BEFORE_PACK.has(b.status) && !b.pack && !!b.sku;
    if (b.status === 'waiting' || pack) forBatch(b.sku ?? '', b.recipe, z, b.status === 'waiting', pack);
    if (b.pack?.state === 'waiting') for (const n of packNeeds(db, b.pack)) need(n.material, today, n.qty);
  }
  // доступное: свободное в партиях — разрешённое сразу, остальное через входной контроль от приёмки; в пути — от прихода
  const avail = new Map<Id, Ev[]>();
  const add = (material: Id, e: Ev) => {
    const xs = avail.get(material) ?? [];
    xs.push(e);
    avail.set(material, xs);
  };
  const byLot = containersByLot(s);
  const free = new Map<Id, number>();
  const quarantine = new Map<Id, number>();
  for (const l of Object.values(s.lots)) {
    // пробная партия одобрения (Б6ж) — не запас под план, пока её не разрешили по решению о досье
    if (!STARTING.has(db.materials[l.material]?.kind) || l.status === 'rejected' || l.status === 'blocked' || trialLot(s, l)) continue;
    let n = 0;
    for (const c of byLot.get(l.id) ?? []) n += c.qty - (c.reserved ?? 0);
    if (n <= 0) continue;
    const ok = l.status === 'released';
    (ok ? free : quarantine).set(l.material, ((ok ? free : quarantine).get(l.material) ?? 0) + n);
    add(l.material, { z: ok ? today : Math.max(today, momentOf(s.start, l.received).day + qc), qty: n });
  }
  const transit = new Map<Id, MrpRow['transit']>();
  // заказ, что не пришёл к обещанному (Б6ж): на сколько суток позже обещанного — сообщение «не пришёл»
  const behind: { material: Id; po: string; days: number }[] = [];
  for (const po of Object.values(s.pos)) {
    if (po.status !== 'ordered') continue;
    // не пришёл к обещанному (Б6ж) — придёт не раньше сегодня и пройдёт входной контроль
    const past = s.t >= windowEnd(s, po.eta);
    const z = Math.max(past ? today + qc : today, momentOf(s.start, po.eta).day + qc);
    for (const l of po.lines) {
      if (past) behind.push({ material: l.material, po: po.id, days: Math.max(1, today - momentOf(s.start, po.eta).day) });
      // заказ пробной партии одобрения (Б6ж) — не приход под план
      if (trialPo(po)) continue;
      add(l.material, { z, qty: l.qty, po: po.id });
      const xs = transit.get(l.material) ?? [];
      xs.push({ po: po.id, qty: l.qty, day: z });
      transit.set(l.material, xs);
    }
  }
  // аналог строки карты (Б6ж): его доступное — доступное основного по коэффициенту; у аналога, что подходит нескольким
  // основным, — первому по коду
  const altOf = new Map<Id, { main: Id; factor: number }>();
  for (const it of sc.plan.items) {
    const r = db.recipes[inForce(db, 'recipes', it.recipe, today)];
    for (const l of r.bom) if (l.alt && !altOf.has(l.alt.material)) altOf.set(l.alt.material, { main: l.material, factor: l.alt.factor });
  }
  for (const [alt, x] of altOf) for (const e of avail.get(alt) ?? []) add(x.main, { z: e.z, qty: Math.floor((e.qty * 10_000) / x.factor) });
  const every = numOf(db, s, POL.every)!;
  const safetyDays = numOf(db, s, POL.safety)!;
  const horizon = Math.max(1, firstDay(from + MRP_MONTHS) - today);
  // материалы — по виду и коду: АФС, вспомогательные, упаковка
  const KIND = ['api', 'excipient', 'packaging'];
  const materials = [...new Set([...gross.keys(), ...avail.keys()])].filter(m => STARTING.has(db.materials[m]?.kind)).sort((a, b) => KIND.indexOf(db.materials[a].kind) - KIND.indexOf(db.materials[b].kind) || db.materials[a].code.localeCompare(db.materials[b].code));
  for (const b of behind) out.msgs.push({ kind: 'behind', material: b.material, po: b.po, days: b.days });
  for (const material of materials) {
    const gs = gross.get(material) ?? [];
    const as = avail.get(material) ?? [];
    const total = gs.reduce((n, g) => n + g.qty, 0);
    const safety = Math.ceil((total * safetyDays) / horizon);
    const pair = pairsFor(db, s, material, today)[0];
    const sup = pair ? db.suppliers[pair.supplier] : undefined;
    const row: MrpRow = { material, months: [], free: free.get(material) ?? 0, quarantine: quarantine.get(material) ?? 0, transit: transit.get(material) ?? [], safety, ...(pair ? { supplier: pair.supplier, maker: pair.maker } : {}) };
    out.rows.push(row);
    // месяцы строки: валовая потребность по месяцу серии; необеспеченная — сколько потребности месяца с страховым запасом
    // не покрывает то, что будет разрешено к её дню, сверх того, что не покрыто в прошлых месяцах
    let cg = 0;
    let worst = 0;
    const sortedA = [...as].sort((a, b) => a.z - b.z);
    for (let i = 0; i < MRP_MONTHS; i++) {
      const m = from + i;
      const mine = gs.filter(g => g.m === m);
      const g = mine.reduce((n, x) => n + x.qty, 0);
      cg += g;
      let net = 0;
      if (mine.length > 0) {
        const by = Math.max(...mine.map(x => x.nb));
        const av = sortedA.filter(a => a.z <= by).reduce((n, a) => n + a.qty, 0);
        const short = Math.max(0, cg + safety - av);
        net = Math.max(0, short - worst);
        worst = Math.max(worst, short);
      }
      row.months.push({ m, gross: g, net });
    }
    // у аналога своей потребности нет: его запас — доступное основного; плановый заказ — на основной (`d365-subst`)
    if (!sup || !pair || altOf.has(material)) continue;
    // события по дням: доступное плюс, потребность минус
    const ev = new Map<number, number>();
    const pos = new Map<number, string[]>();
    for (const a of as) {
      ev.set(a.z, (ev.get(a.z) ?? 0) + a.qty);
      if (a.po) pos.set(a.z, [...(pos.get(a.z) ?? []), a.po]);
    }
    for (const g of gs) ev.set(g.nb, (ev.get(g.nb) ?? 0) - g.qty);
    const days = [...ev.keys()].sort((a, b) => a - b);
    const lead = sup.lead[1];
    // к какому дню будет разрешён заказ дня `d` с верхом срока поставки: фура — в рабочий день, затем входной контроль
    const arriveBy = (d: number) => workdayOnOrAfter(cal, d + lead) + qc;
    // горизонт нового заказа: заказ сегодня придёт не позже верха срока поставки, сдвинутого на рабочий день, и пройдёт
    // входной контроль; раньше дефицит закрывает только уже заказанное
    const fence = arriveBy(today);
    const k = db.containers[db.materials[material].container];
    const moq = sup.items[material]?.moq ?? 0;
    // дефицит до горизонта нового заказа: с какого дня; заказы в пути, что придут в нём, опоздают
    let e0: number | undefined;
    let have = 0;
    let fenced = false;
    const late: { po: string; days: number }[] = [];
    // заказ к дню `z`: дефицит и потребность ещё «на сколько суток заказ» после этого дня; дата заказа — последний рабочий
    // день, заказ которого с верхом срока поставки придёт к `z`; опаздывающий — сегодня: раньше заказ — раньше фура
    const place = (z: number, deficit: number, overdue: number) => {
      let more = 0;
      for (const g of gs) if (g.nb > z && g.nb <= z + every) more += g.qty;
      // кому заказывать при двух поставщиках (Б6ж): на сколько суток опоздает заказ сегодня у поставщика — его верх срока
      // против начала дефицита
      const start = overdue > 0 ? fence - overdue : undefined;
      const ch = choosePair(db, s, material, today, sp => (start === undefined ? 0 : Math.max(0, workdayOnOrAfter(cal, today + db.suppliers[sp].lead[1]) + qc - start)), deficit + more) ?? { pair };
      const chosen = db.suppliers[ch.pair.supplier];
      const moqC = chosen.items[material]?.moq ?? moq;
      const want = Math.max(moqC, deficit + more);
      const qty = Math.ceil(want / k.capacity) * k.capacity;
      have += qty;
      const month = gs.filter(g => g.nb >= z).reduce((n, g) => Math.min(n, g.m), Number.POSITIVE_INFINITY);
      const leadC = chosen.lead[1];
      const late = ch.pair.supplier === pair.supplier || start === undefined ? overdue : Math.max(0, workdayOnOrAfter(cal, today + leadC) + qc - start);
      let by = late > 0 ? today : z - qc - leadC;
      while (by > today && (!isWorkday(cal, by) || workdayOnOrAfter(cal, by + leadC) + qc > z)) by--;
      out.planned.push({ material, supplier: ch.pair.supplier, maker: ch.pair.maker, want, qty, need: z, orderBy: Math.max(today, by), month: Number.isFinite(month) ? month : monthOfDay(z), deficit, late, ...(ch.pick ? { pick: ch.pick } : {}) });
    };
    for (const z of days) {
      // в самый день горизонта событий нет: заказ на горизонте — по остатку к нему
      if (!fenced && z > fence) {
        fenced = true;
        if (have < safety) place(fence, safety - have, e0 === undefined ? 0 : fence - e0);
      }
      have += ev.get(z)!;
      if (z <= fence) {
        if (have < safety && e0 === undefined) e0 = z;
        else if (e0 !== undefined) {
          for (const po of pos.get(z) ?? []) late.push({ po, days: z - e0 });
          if (have >= safety) e0 = undefined;
        }
        // на горизонте — с тем, что придёт в этот же день
        if (z === fence) {
          fenced = true;
          if (have < safety) place(fence, safety - have, e0 === undefined ? 0 : fence - e0);
        }
      } else if (have < safety) place(z, safety - have, 0);
    }
    if (!fenced && have < safety) place(fence, safety - have, e0 === undefined ? 0 : fence - e0);
    for (const l of late) out.msgs.push({ kind: 'late', material, po: l.po, days: l.days });
    // лишний заказ в пути (§ 12.1.3): потребность под него не наступает в пределах срока поставки — без него остаток
    // со дня его прихода уходит ниже страхового не раньше горизонта заказа следующего рабочего дня или не уходит вовсе;
    // его можно отменить и заказать позже
    const lateIds = new Set(late.map(l => l.po));
    const later = arriveBy(nextDay);
    for (const t of row.transit) {
      if (lateIds.has(t.po)) continue;
      let h = 0;
      let needed = false;
      for (const z of days) {
        if (z >= later) break;
        h += ev.get(z)! - ((pos.get(z) ?? []).includes(t.po) ? t.qty : 0);
        if (z >= t.day && h < safety) {
          needed = true;
          break;
        }
      }
      if (!needed) out.msgs.push({ kind: 'extra', material, po: t.po });
    }
  }
  out.planned.sort((a, b) => a.orderBy - b.orderBy || a.material.localeCompare(b.material));
  out.planned.forEach((o, i) => {
    if (o.late > 0) out.msgs.push({ kind: 'overdue', material: o.material, order: i, days: o.late });
    else if (o.orderBy - today <= MRP_SOON) out.msgs.push({ kind: 'soon', material: o.material, order: i, days: Math.max(0, o.orderBy - today) });
  });
  return out;
}
