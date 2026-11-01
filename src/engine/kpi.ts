// Показатели руководителей (Б5ж; docs/specs/2026-10-vertical-slice.md, «Б5ж»; геймдизайн, §8.6; факты и формулы —
// docs/10-domain.md, §7, «Показатели работы служб»). Показатель — чистая функция записей завода за период: досье серий,
// испытания, отклонения, журнал оборудования, склад, заказы, касса, табель; полей истины она не читает. Той же функцией
// поток расчёта считает текущий месяц для окна и итог поста (3е) — одно определение на все места. Чего записи не хранят —
// остатки на конец суток, — то срез в полночь копит суммами за месяц (`kpiNight`); в полночь на 1-е итог месяца пишется в
// состояние и больше не меняется: серия, решённая позже, попадает в свой месяц.
import type { ContentDb } from '../content/types';
import { addMonths, civilFromDays, DAY, daysFromCivil, HOUR, momentOf } from './core/calendar';
import { P_ONE } from './core/rng';
import { baseLoad } from './cash';
import { yearOver } from './hours';
import { oee, type Oee, rhythm, roomsOf } from './lean';
import { planOf } from './plant';
import { admitted, rowsOf } from './quals';
import type { Batch, DayLoss, Head, KpiMonth, KpiSnap, KpiState, LineDay, Lot, MaintEntry, PlantState } from './types';

/** Руководитель показателя: директор или начальник отдела (журнал решений, Б5а). */
export type KpiHead = 'dir' | Head;

/**
 * Единица значения: копейки; доля — 1/10 000; секунды; сутки — 1/100 суток; на 1000 — 1/100 случая на тысячу; Вт·ч на
 * 1000 годных таблеток.
 */
export type KpiUnit = 'kop' | 'share' | 'sec' | 'day' | 'per' | 'wh';

/**
 * Определение показателя (ISO 22400-2, табл. 1, — имя, формула, единица, тренд): кто им измеряется, единица, направление
 * — 1 «выше — лучше», −1 «ниже — лучше»; окно — месяц или 12 месяцев скользящим окном (редкие события: отказы, OOS,
 * отклонения, текучесть; геймдизайн, §8.6); ключи источников формулы (`docs/10-domain.md`), пусто — определение наше;
 * противовес — показатель, который этот может испортить; у кого ещё в строке; сумма за месяц — копится с его начала:
 * неполный месяц с полным сравнивают в сутки.
 */
export interface KpiDef {
  id: string;
  head: KpiHead;
  unit: KpiUnit;
  dir: 1 | -1;
  win: 'm' | 'y';
  src: readonly string[];
  pair?: string;
  also?: readonly KpiHead[];
  acc?: true;
}

const ISO = 'gost-r-iso-22400-2-2019';

/** Показатели руководителей по порядку строк окна. */
export const KPIS: readonly KpiDef[] = [
  // директор: деньги — кассовым методом, без прибыли и рентабельности до себестоимости продаж (Б6)
  { id: 'flow', head: 'dir', unit: 'kop', dir: 1, win: 'm', src: ['cbr-714p'], pair: 'otifOrders', acc: true },
  { id: 'cashMin', head: 'dir', unit: 'kop', dir: 1, win: 'm', src: [], pair: 'flow' },
  { id: 'otifOrders', head: 'dir', unit: 'share', dir: 1, win: 'm', src: [], pair: 'fgDays' },
  // планирование
  { id: 'onDay', head: 'plan', unit: 'share', dir: 1, win: 'm', src: [], pair: 'fgDays' },
  { id: 'fgDays', head: 'plan', unit: 'day', dir: -1, win: 'm', src: ['fda-qm-2022'], pair: 'otif' },
  { id: 'switchH', head: 'plan', unit: 'sec', dir: -1, win: 'm', src: [], pair: 'fgDays', acc: true },
  // производство
  { id: 'oee', head: 'mes', unit: 'share', dir: 1, win: 'm', src: [ISO], pair: 'rft' },
  { id: 'setup', head: 'mes', unit: 'share', dir: -1, win: 'm', src: [ISO] },
  { id: 'shift', head: 'mes', unit: 'share', dir: 1, win: 'm', src: [], pair: 'ot' },
  { id: 'rhythm', head: 'mes', unit: 'share', dir: 1, win: 'm', src: ['bse-rhythm'] },
  { id: 'scrap', head: 'mes', unit: 'share', dir: -1, win: 'm', src: [ISO] },
  { id: 'massLoss', head: 'mes', unit: 'share', dir: -1, win: 'm', src: [ISO], also: ['tech'] },
  { id: 'ot', head: 'mes', unit: 'sec', dir: -1, win: 'm', src: ['tk-99'], pair: 'shift', acc: true },
  // главный механик
  { id: 'mtbf', head: 'maint', unit: 'sec', dir: 1, win: 'y', src: ['gost-27-102', 'gost-r-57330'] },
  { id: 'mttr', head: 'maint', unit: 'sec', dir: -1, win: 'y', src: ['gost-27-102', 'gost-r-57330'] },
  { id: 'unplanned', head: 'maint', unit: 'share', dir: -1, win: 'y', src: [ISO], pair: 'replH' },
  { id: 'replH', head: 'maint', unit: 'sec', dir: -1, win: 'y', src: [ISO], pair: 'unplanned' },
  { id: 'calDays', head: 'maint', unit: 'share', dir: 1, win: 'm', src: ['fda-qm-2022'] },
  { id: 'spares', head: 'maint', unit: 'share', dir: 1, win: 'y', src: ['gost-r-57330'] },
  { id: 'kwh', head: 'maint', unit: 'wh', dir: -1, win: 'm', src: [ISO, 'gost-r-57912'], pair: 'baseShare' },
  { id: 'baseShare', head: 'maint', unit: 'share', dir: -1, win: 'm', src: ['gost-r-57912', 'iso-50006'] },
  // начальник ОКК
  { id: 'testTime', head: 'qc', unit: 'sec', dir: -1, win: 'm', src: ['fda-qm-2022', 'who-qcl-2024'], pair: 'invalidOos' },
  { id: 'incoming', head: 'qc', unit: 'sec', dir: -1, win: 'm', src: ['fda-qm-2022'] },
  { id: 'invalidOos', head: 'qc', unit: 'per', dir: -1, win: 'y', src: ['ispe-qm-w2'], pair: 'testTime' },
  { id: 'labDays', head: 'qc', unit: 'share', dir: 1, win: 'm', src: ['fda-qm-2022', 'who-qcl-2024'] },
  // начальник ООК
  { id: 'devs', head: 'qa', unit: 'per', dir: -1, win: 'y', src: ['ispe-qm-w2'] },
  { id: 'repeat', head: 'qa', unit: 'share', dir: -1, win: 'y', src: ['ispe-qm-w1', 'fda-qm-2022'] },
  { id: 'assess', head: 'qa', unit: 'sec', dir: -1, win: 'm', src: ['ispe-qm-w2'], pair: 'repeat' },
  { id: 'supRej', head: 'qa', unit: 'share', dir: -1, win: 'y', src: ['fda-qm-2022'] },
  // уполномоченное лицо
  { id: 'release', head: 'qp', unit: 'sec', dir: -1, win: 'm', src: ['fda-qm-2022'] },
  { id: 'lar', head: 'qp', unit: 'share', dir: 1, win: 'm', src: ['ispe-qm-w2'] },
  // главный технолог
  { id: 'cpk', head: 'tech', unit: 'share', dir: 1, win: 'm', src: [ISO, 'fda-qm-2022'], pair: 'oee' },
  { id: 'rft', head: 'tech', unit: 'share', dir: 1, win: 'm', src: ['ispe-qm-w2', 'fda-qm-2022'], pair: 'oee', also: ['dir'] },
  // снабжение
  { id: 'matWait', head: 'supply', unit: 'sec', dir: -1, win: 'm', src: [], pair: 'matDays', acc: true },
  { id: 'matDays', head: 'supply', unit: 'day', dir: -1, win: 'm', src: ['gks-fhd-2002'], pair: 'matWait' },
  { id: 'framework', head: 'supply', unit: 'share', dir: 1, win: 'm', src: ['ghsc-fy2019'] },
  // склад
  { id: 'dockToStock', head: 'wms', unit: 'sec', dir: -1, win: 'm', src: [] },
  { id: 'dockWait', head: 'wms', unit: 'sec', dir: -1, win: 'm', src: [], pair: 'occupancy', acc: true },
  { id: 'occupancy', head: 'wms', unit: 'share', dir: -1, win: 'm', src: ['werc-dc-measures'], pair: 'dockWait' },
  { id: 'shelf', head: 'wms', unit: 'day', dir: 1, win: 'm', src: ['ghsc-fy2019'] },
  // продажи
  { id: 'otif', head: 'sales', unit: 'share', dir: 1, win: 'm', src: ['ghsc-fy2019'], pair: 'fgDays' },
  { id: 'revenue', head: 'sales', unit: 'kop', dir: 1, win: 'm', src: ['fsbu-4-2023'], pair: 'dso', acc: true },
  { id: 'dso', head: 'sales', unit: 'day', dir: -1, win: 'm', src: ['gks-fhd-2002'], pair: 'revenue' },
  // кадры
  { id: 'turnover', head: 'hr', unit: 'share', dir: -1, win: 'y', src: ['ispe-qm-w2'], pair: 'otLimit', also: ['dir'] },
  { id: 'vacancy', head: 'hr', unit: 'day', dir: -1, win: 'y', src: ['iso-30414'] },
  { id: 'noAdm', head: 'hr', unit: 'share', dir: -1, win: 'm', src: ['iso-30414'] },
  { id: 'otLimit', head: 'hr', unit: 'share', dir: -1, win: 'm', src: ['tk-99'], pair: 'turnover' },
];

export const KPI: Readonly<Record<string, KpiDef>> = Object.fromEntries(KPIS.map(k => [k.id, k]));

/** Порог воспроизводимости процесса: Cpk больше 1,33 (`gost-r-iso-22400-2-2019`, табл. 22–23), доли 1/10 000. */
export const CPK_MIN = 13300;

/** Cpk считаем по показателю МОК, у которого за период не меньше стольких результатов. */
export const CPK_N = 10;

/** Оценка σ по среднему скользящему размаху: σ = MR / d₂, d₂ = 1,128 для пар соседних значений — ×1000. */
const D2 = 1128;

export const emptySnap = (): KpiSnap => ({ n: 0, stock: 0, shelf: 0, fg: 0, recv: 0, pay: 0, slots: 0, places: 0, peak: 0, noAdm: 0, people: 0, ot: 0, otSec: 0 });

/** Учёт показателей с мгновения `t`; не полночь 1-го — первый месяц «неполный». */
export function newKpi(t: number): KpiState {
  return { from: t, snap: emptySnap(), months: [] };
}

// ---------------------------------------------------------------- период

/**
 * Период расчёта: с и по какое мгновение (по — не включая); суммы срезов и Вт·ч месяца — для показателей остатков и
 * энергии; начало окна 12 месяцев — для редких событий.
 */
export interface KpiPeriod {
  from: number;
  to: number;
  yFrom: number;
  snap: KpiSnap;
  wh: number;
}

/** Мгновение полуночи 1-го числа месяца, в который попадает мгновение `t`, со сдвигом на `n` месяцев. */
export function monthStart(s: PlantState, t: number, n = 0): number {
  const d = civilFromDays(momentOf(s.start, t).day);
  const z = addMonths(daysFromCivil({ y: d.y, m: d.m, d: 1 }), n);
  return (z - daysFromCivil(s.start)) * DAY;
}

/** Период текущего месяца — с начала учёта по сейчас: суммы срезов этого месяца, Вт·ч с начала месяца и базы с полуночи. */
export function currentPeriod(db: ContentDb, s: PlantState): KpiPeriod {
  const e = s.cash.energy;
  const wh = e.wh + Math.floor((baseLoad(db, s) * Math.max(0, s.t - e.at)) / HOUR);
  return { from: s.kpi.from, to: s.t, yFrom: monthStart(s, s.t, -11), snap: s.kpi.snap, wh };
}

/** Период закрытого месяца — для пересчёта: то же, что видел итог месяца. */
export function monthPeriod(s: PlantState, mo: KpiMonth): KpiPeriod {
  return { from: mo.from, to: mo.to, yFrom: monthStart(s, mo.from, -11), snap: mo.snap, wh: mo.wh };
}

/** Записи завода за период — что нужно расчёту, разобранное один раз. */
interface Ctx {
  db: ContentDb;
  s: PlantState;
  p: KpiPeriod;
  /** номера дней периода: с и по (не включая) — у суток потерь и учёта помещений */
  d0: number;
  d1: number;
  /** то же — окна 12 месяцев */
  y0: number;
  days: DayLoss[];
  yDays: DayLoss[];
  /** длина периода, сутки × 1000 — для «в сутки» */
  len: number;
}

const inside = (t: number | undefined, from: number, to: number): t is number => t !== undefined && t >= from && t < to;

function ctxOf(db: ContentDb, s: PlantState, p: KpiPeriod): Ctx {
  const day = (t: number) => momentOf(s.start, t).day;
  const d0 = day(p.from);
  const d1 = p.to > p.from ? day(p.to - 1) + 1 : d0;
  const y0 = day(p.yFrom);
  return {
    db,
    s,
    p,
    d0,
    d1,
    y0,
    days: s.losses.filter(d => d.day >= d0 && d.day < d1),
    yDays: s.losses.filter(d => d.day >= y0 && d.day < d1),
    len: Math.max(1, Math.floor(((p.to - p.from) * 1000) / DAY)),
  };
}

/** Медиана и 90-й процентиль, как в замере «как сейчас»: нижняя медиана, процентиль — по номеру. */
export function median(a: readonly number[]): number | undefined {
  if (a.length === 0) return undefined;
  const v = [...a].sort((x, y) => x - y);
  return v[v.length >> 1];
}

export function p90(a: readonly number[]): number | undefined {
  if (a.length === 0) return undefined;
  const v = [...a].sort((x, y) => x - y);
  return v[Math.min(v.length - 1, Math.floor(v.length * 0.9))];
}

const share = (x: number, of: number) => (of > 0 ? Math.round((x * P_ONE) / of) : undefined);

// ---------------------------------------------------------------- записи, общие с видами

/** Когда серию решили: выпуск — по записи серии, отклонение ГП — по статусу её партии; балк отклоняет лаборатория, не УЛ. */
export function decidedAt(s: PlantState, b: Batch): number | undefined {
  if (b.status === 'released') return b.released;
  const fg = b.pack?.fg ? s.lots[b.pack.fg] : undefined;
  return b.status === 'rejected' && fg?.status === 'rejected' ? fg.since : undefined;
}

/** Серия без отклонений: ни у неё, ни у её балка и ГП. */
export function cleanBatch(s: PlantState, b: Batch): boolean {
  return !Object.values(s.deviations).some(d => d.batch === b.id || (d.lot !== undefined && (d.lot === b.bulk || d.lot === b.pack?.fg)));
}

/** Отклонённой партии своей серии — когда; такой нет — `undefined`. */
export function rejectedAt(s: PlantState, b: Batch): number | undefined {
  if (b.status !== 'rejected') return undefined;
  for (const id of [b.bulk, b.pack?.fg]) if (id && s.lots[id]?.status === 'rejected') return s.lots[id].since;
  return undefined;
}

/**
 * OEE линии за сутки потерь: ключевая машина — с наименьшим номиналом, как у планёрки (3в); доступность, эффективность и
 * качество — множители OEE. Загрузки не было — `undefined`.
 */
export function lineOee(days: readonly LineDay[]): Oee | undefined {
  if (days.length === 0) return undefined;
  const n = days[0].ideal.length;
  const ideal = Array.from({ length: n }, (_, i) => days.reduce((x, d) => x + (d.ideal[i] ?? 0), 0));
  let key = 0;
  ideal.forEach((v, i) => {
    if (v < ideal[key]) key = i;
  });
  const run = days.reduce((x, d) => x + (d.run[key] ?? 0), 0);
  const out = days.reduce((x, d) => x + (d.times[key]?.out ?? 0), 0);
  return oee({ ideal: ideal[key], run, out }, days.reduce((x, d) => x + d.good, 0));
}

/** OEE каждой линии плана за сутки периода, по порядку плана. */
export function oeeOf(db: ContentDb, s: PlantState, days: readonly DayLoss[]): (Oee | undefined)[] {
  return planOf(db, s.plant).plant.lines.map(l => lineOee(days.flatMap(d => (d.lines[l.id] ? [d.lines[l.id]] : []))));
}

/** Когда заказ закрыт: фура покупателя ушла — по отгрузке; не отгружен ничего — в срок отгрузки. */
export function closedAt(s: PlantState, o: PlantState['orders'][string]): number | undefined {
  if (o.status === 'open') return undefined;
  return o.shipment && s.shipments[o.shipment] ? s.shipments[o.shipment].t : o.due;
}

/** Купленная партия материала: не запас старта, не своя продукция. */
const bought = (db: ContentDb, l: Lot) => l.supplier !== 'start' && l.batch === undefined && db.materials[l.material] !== undefined;

/** Партию решили: разрешена или отклонена — мгновение статуса. */
const lotDecided = (l: Lot) => (l.status === 'released' || l.status === 'rejected' ? l.since : undefined);

/**
 * Цена материала партии, копейки за кг или за штуку: по прайсу её поставщика; у запаса старта — наименьшая цена среди
 * поставщиков материала. Цены нет — 0.
 */
export function lotPrice(db: ContentDb, l: Pick<Lot, 'supplier' | 'material'>): number {
  const own = db.suppliers[l.supplier]?.items[l.material]?.price;
  if (own !== undefined) return own;
  let best = 0;
  for (const sup of Object.values(db.suppliers)) {
    const p = sup.items[l.material]?.price;
    if (p !== undefined && (best === 0 || p < best)) best = p;
  }
  return best;
}

/** Стоимость количества материала, копейки: мг — по цене за кг, штуки — по цене за штуку. */
export function valueOf(db: ContentDb, material: string, qty: number, price: number): number {
  return db.materials[material]?.unit === 'mass' ? Math.floor((qty * price) / 1_000_000) : qty * price;
}

/** Сколько партии на руках, мг или шт. */
const left = (l: Lot) => l.qty - l.used - l.sampled - l.written - (l.shipped ?? 0);

/** Отпечаток отклонения для повтора: вид, стадия и то, что вне пределов (ISPE — та же причина; причину запишет Б5е). */
export const devSig = (d: PlantState['deviations'][string]) => `${d.kind}/${d.stage ?? ''}/${d.param ?? d.test ?? d.material ?? ''}`;

// ---------------------------------------------------------------- срез суток

/**
 * Срез в полночь (Б5ж): то, чего записи не хранят, — в суммы месяца. Запас материалов — по цене партии, и он же на дни до
 * конца срока годности; ГП — разрешённые пачки на складе; дебиторская задолженность — счета покупателям, задолженность
 * поставщикам — их счета; места хранения — все места плана и занятые паллетой; люди без полного допуска по строкам своих
 * ролей; наибольшая доля предела сверхурочных года; сверхурочные, кончившиеся в прошедшие сутки, — с начала учёта, если он
 * начался в них.
 */
export function kpiSnapshot(db: ContentDb, s: PlantState): Omit<KpiSnap, 'n' | 'peak'> {
  const day = momentOf(s.start, s.t).day;
  const fgIds = new Set(Object.values(db.skus).map(k => k.fg));
  let stock = 0;
  let shelf = 0;
  let fg = 0;
  for (const l of Object.values(s.lots)) {
    const n = left(l);
    if (n <= 0) continue;
    if (fgIds.has(l.material)) {
      if (l.status === 'released') fg += n;
      continue;
    }
    if (l.batch !== undefined || !db.materials[l.material]) continue;
    const v = valueOf(db, l.material, n, lotPrice(db, l));
    stock += v;
    shelf += v * Math.max(0, l.expiry - day);
  }
  let recv = 0;
  let pay = 0;
  for (const d of s.cash.dues) {
    if (d.item === 'sale' && d.sum > 0) recv += d.sum;
    if (d.item === 'supplier' && d.sum < 0) pay -= d.sum;
  }
  const slots = Object.values(s.slots);
  const people = Object.values(s.people);
  const limit = db.profiles[db.scenarios[s.scenario].profile].payroll.overtime.year;
  const y = civilFromDays(day).y;
  return {
    stock,
    shelf,
    fg,
    recv,
    pay,
    slots: slots.filter(x => x.unit !== undefined).length,
    places: slots.length,
    noAdm: people.filter(p => !admitted(db, p, rowsOf(db, p), day)).length,
    people: people.length,
    ot: people.reduce((m, p) => Math.max(m, limit > 0 ? Math.floor((yearOver(p, y) * P_ONE) / limit) : 0), 0),
    otSec: otIn(s, Math.max(s.kpi.from, s.t - DAY), s.t),
  };
}

/**
 * Сверхурочные людей и ушедших, с: отрезки табеля, кончившиеся в [from, to), — целиком. Отрезок пишется, когда работа
 * кончилась, поэтому за сутки — то, что кончилось в них, а работа через полночь — в сутки своего конца.
 */
function otIn(s: PlantState, from: number, to: number): number {
  let sec = 0;
  for (const p of [...Object.values(s.people), ...Object.values(s.former)]) for (const [a, b] of p.ot) if (b >= from && b < to) sec += b - a;
  return sec;
}

/** Добавить срез в суммы месяца: средние — сумма на число срезов, у занятых мест — ещё наибольшее, у сверхурочных — наибольшая доля. */
function addSnap(sum: KpiSnap, x: Omit<KpiSnap, 'n' | 'peak'>) {
  sum.n++;
  sum.stock += x.stock;
  sum.shelf += x.shelf;
  sum.fg += x.fg;
  sum.recv += x.recv;
  sum.pay += x.pay;
  sum.slots += x.slots;
  sum.places += x.places;
  sum.peak = Math.max(sum.peak, x.slots);
  sum.noAdm += x.noAdm;
  sum.people += x.people;
  sum.ot = Math.max(sum.ot, x.ot);
  sum.otSec += x.otSec;
}

/**
 * Каждый час, после учёта потерь часа: в полночь — срез суток; в полночь на 1-е — сначала итог прошлого месяца (Вт·ч его
 * касса только что сняла со счётчика, сверхурочные его последних суток — из этого среза), потом срез — первый в новом.
 */
export function kpiHour(db: ContentDb, s: PlantState) {
  if (momentOf(s.start, s.t).sec !== 0) return;
  const k = s.kpi;
  const x = kpiSnapshot(db, s);
  if (s.t > k.from && monthStart(s, s.t) === s.t) {
    k.snap.otSec += x.otSec;
    x.otSec = 0;
    const p: KpiPeriod = { from: k.from, to: s.t, yFrom: monthStart(s, k.from, -11), snap: k.snap, wh: k.wh ?? 0 };
    const d = civilFromDays(momentOf(s.start, k.from).day);
    // начат не 1-го числа — сохранение до схемы 33, загруженное посреди месяца, — «неполный»
    k.months.push({ y: d.y, m: d.m, from: k.from, to: s.t, ...(k.from - monthStart(s, k.from) >= DAY ? { part: true as const } : {}), snap: k.snap, wh: p.wh, v: kpiValues(db, s, p) });
    k.from = s.t;
    k.snap = emptySnap();
    delete k.wh;
  }
  addSnap(k.snap, x);
}

// ---------------------------------------------------------------- расчёт

/** Что даёт расчёт показателя: значение в единице определения — нет, если считать не из чего. */
type Calc = (c: Ctx) => number | undefined;

/** Секунды отрезков [a, b) внутри [from, to). */
const overlap = (a: number, b: number, from: number, to: number) => Math.max(0, Math.min(b, to) - Math.max(a, from));

/** Время работ ремонта или замены журнала оборудования, с: от взятой работы до записи; без начала — нет. */
const workOf = (e: MaintEntry) => (e.from !== undefined ? e.t - e.from : undefined);

/** Доля дней, когда у актива рода `families` все его работы — с записью в силе, по дням периода, 1/10 000. */
function inForceShare(c: Ctx, families: readonly string[]): number | undefined {
  let all = 0;
  let ok = 0;
  for (const a of Object.values(c.s.assets)) {
    if (!families.includes(a.family)) continue;
    const works = [...new Set(a.recs.map(r => r.work))];
    if (works.length === 0) continue;
    for (let d = c.d0; d < c.d1; d++) {
      all++;
      if (works.every(w => a.recs.some(r => r.work === w && r.day <= d && d <= r.until))) ok++;
    }
  }
  return share(ok, all);
}

/** Отказы окна 12 месяцев и их ремонты: отказ, ремонт после него — время восстановления. */
export function failuresOf(s: PlantState, from: number, to: number): { f: MaintEntry; r?: MaintEntry }[] {
  const log = s.maintLog;
  return log.filter(e => e.what === 'failure' && inside(e.t, from, to)).map(f => ({ f, r: log.find(e => e.what === 'repair' && e.machine === f.machine && e.part === f.part && e.t >= f.t) }));
}

/** Значение показателя `id` за период. */
const CALC: Record<string, Calc> = {
  flow: c => c.s.cash.ledger.reduce((n, e) => n + (e.item !== 'start' && inside(e.t, c.p.from, c.p.to) ? e.sum : 0), 0),
  cashMin: c => {
    const led = c.s.cash.ledger;
    // остаток в начале периода — нынешний за вычетом всего, что пришло и ушло с того мгновения
    let bal = c.s.cash.balance - led.reduce((n, e) => n + (e.t >= c.p.from ? e.sum : 0), 0);
    let min = bal;
    for (const e of led) {
      if (!inside(e.t, c.p.from, c.p.to)) continue;
      bal += e.sum;
      if (bal < min) min = bal;
    }
    return min;
  },
  onDay: c => {
    const day = (t: number) => momentOf(c.s.start, t).day;
    const started = Object.values(c.s.batches).filter(b => inside(b.records[0]?.start, c.p.from, c.p.to));
    return share(started.filter(b => day(b.records[0].start) <= day(b.notBefore)).length, started.length);
  },
  fgDays: c => {
    if (c.p.snap.n === 0) return undefined;
    const packs = (o: PlantState['orders'][string]) => o.lines.reduce((n, l) => n + l.cases * (c.db.skus[l.sku]?.case.per ?? 0), 0);
    const demand = Object.values(c.s.orders).reduce((n, o) => n + (inside(o.due, c.p.from, c.p.to) ? packs(o) : 0), 0);
    // средний запас, пачки, к спросу в сутки: (запас / срезы) / (спрос / длина) — в 1/100 суток
    return demand > 0 ? Math.round((c.p.snap.fg * c.len * 100) / (c.p.snap.n * demand * 1000)) : undefined;
  },
  switchH: c => c.days.reduce((n, d) => n + d.cleans.majorSec + d.changes.sec, 0),
  oee: c => {
    const o = oeeOf(c.db, c.s, c.days).filter((x): x is Oee => x !== undefined);
    return o.length > 0 ? Math.round(o.reduce((n, x) => n + x.oee, 0) / o.length) : undefined;
  },
  setup: c => {
    const rooms = roomsOf(planOf(c.db, c.s.plant)).rooms;
    let clean = 0;
    let work = 0;
    for (const d of c.days)
      for (const id of rooms) {
        clean += d.rooms[id]?.clean ?? 0;
        work += d.rooms[id]?.work ?? 0;
      }
    return share(clean, clean + work);
  },
  shift: c => {
    const tasks = closedShifts(c.s, c.p.from, c.p.to).filter(t => t.plan > 0 && t.fact !== undefined);
    return share(
      tasks.reduce((n, t) => n + (t.fact ?? 0), 0),
      tasks.reduce((n, t) => n + t.plan, 0),
    );
  },
  rhythm: c => rhythm(closedShifts(c.s, c.p.from, c.p.to)),
  scrap: c => {
    const jobs = Object.values(c.s.batches).flatMap(b => (b.pack && inside(b.pack.end, c.p.from, c.p.to) ? [b.pack] : []));
    return share(
      jobs.reduce((n, j) => n + (j.scrap ?? 0), 0),
      jobs.reduce((n, j) => n + j.tablets, 0),
    );
  },
  massLoss: c => {
    let loss = 0;
    let base = 0;
    for (const b of Object.values(c.s.batches)) {
      if (b.bulk === undefined || !inside(b.records[b.records.length - 1]?.end, c.p.from, c.p.to)) continue;
      loss += b.records.reduce((n, r) => n + r.loss, 0);
      base += b.dispensed.reduce((n, k) => n + (c.db.materials[k.material]?.unit === 'mass' ? k.qty : 0), 0);
    }
    return share(loss, base);
  },
  // сверхурочные, кончившиеся в прошедшие сутки, — из срезов, в нынешние — из табеля: у закрытого месяца `to` — полночь
  ot: c => c.p.snap.otSec + otIn(c.s, Math.max(c.p.from, c.p.to - momentOf(c.s.start, c.p.to).sec), c.p.to),
  mtbf: c => {
    const fails = failuresOf(c.s, c.p.yFrom, c.p.to).length;
    if (fails === 0) return undefined;
    // наработка: машины линии — в ходе, на номинале и медленнее, с микроостановками; оборудование — стадии на нём
    let work = 0;
    for (const d of c.yDays) for (const ld of Object.values(d.lines)) for (const t of ld.times) work += t.run + t.slow + t.micro;
    for (const b of Object.values(c.s.batches)) for (const r of b.records) work += overlap(r.start, r.end, c.p.yFrom, c.p.to) * r.equipment.length;
    return Math.round(work / fails);
  },
  mttr: c => {
    const t = failuresOf(c.s, c.p.yFrom, c.p.to).flatMap(x => (x.r ? [x.r.t - x.f.t] : []));
    return t.length > 0 ? Math.round(t.reduce((a, b) => a + b, 0) / t.length) : undefined;
  },
  unplanned: c => {
    let cm = 0;
    let pm = 0;
    for (const e of c.s.maintLog) {
      if (!inside(e.t, c.p.yFrom, c.p.to)) continue;
      const w = workOf(e);
      if (w === undefined) continue;
      if (e.what === 'repair') cm += w;
      if (e.what === 'replace') pm += w;
    }
    return share(cm, cm + pm);
  },
  replH: c => c.s.maintLog.reduce((n, e) => n + (e.what === 'replace' && inside(e.t, c.p.yFrom, c.p.to) ? (workOf(e) ?? 0) : 0), 0),
  calDays: c => inForceShare(c, ['equipment', 'machine', 'sensor', 'vehicle']),
  spares: c => {
    const rep = c.s.maintLog.filter(e => e.what === 'repair' && inside(e.t, c.p.yFrom, c.p.to));
    return share(rep.filter(e => !e.spare).length, rep.length);
  },
  kwh: c => {
    const good = c.days.reduce((n, d) => n + Object.values(d.lines).reduce((x, l) => x + l.good, 0), 0);
    // годные — шестидесятые доли таблетки; Вт·ч на 1000 годных
    return good > 0 ? Math.round((c.p.wh * 60_000) / good) : undefined;
  },
  baseShare: c => share(Math.floor((baseLoad(c.db, c.s) * (c.p.to - c.p.from)) / HOUR), c.p.wh),
  testTime: c => median(sampleTimes(c).map(x => x.sec)),
  incoming: c => median(incomingTimes(c).map(x => x.sec)),
  invalidOos: c => {
    const tests = Object.values(c.s.tests).filter(t => t.state === 'done' && !t.inv && inside(t.done, c.p.yFrom, c.p.to));
    return tests.length > 0 ? Math.round((tests.filter(t => t.invalid).length * 100_000) / tests.length) : undefined;
  },
  labDays: c => inForceShare(c, ['lab', 'ipc']),
  devs: c => {
    const n = Object.values(c.s.deviations).filter(d => inside(d.opened, c.p.yFrom, c.p.to)).length;
    const decided = Object.values(c.s.batches).filter(b => inside(decidedAt(c.s, b), c.p.yFrom, c.p.to)).length;
    return decided > 0 ? Math.round((n * 100_000) / decided) : undefined;
  },
  repeat: c => {
    const r = repeats(c);
    return share(r.filter(x => x.prev).length, r.length);
  },
  assess: c => median(assessTimes(c).map(x => x.sec)),
  supRej: c => {
    const lots = Object.values(c.s.lots).filter(l => bought(c.db, l) && inside(lotDecided(l), c.p.yFrom, c.p.to));
    return share(lots.filter(l => l.status === 'rejected').length, lots.length);
  },
  release: c => median(releaseTimes(c).map(x => x.sec)),
  lar: c => {
    const decided = Object.values(c.s.batches).filter(b => inside(decidedAt(c.s, b), c.p.from, c.p.to));
    return share(decided.filter(b => b.status === 'released').length, decided.length);
  },
  cpk: c => {
    const k = cpkOf(c);
    return share(k.filter(x => x.cpk >= CPK_MIN).length, k.length);
  },
  rft: c => {
    const rel = Object.values(c.s.batches).filter(b => b.status === 'released' && inside(b.released, c.p.from, c.p.to));
    return share(rel.filter(b => cleanBatch(c.s, b)).length, rel.length);
  },
  matWait: c => c.days.reduce((n, d) => n + Object.values(d.waits).reduce((x, w) => x + (w.materials ?? 0), 0), 0),
  matDays: c => {
    if (c.p.snap.n === 0) return undefined;
    const used = usedValue(c);
    return used > 0 ? Math.round((c.p.snap.stock * c.len * 100) / (c.p.snap.n * used * 1000)) : undefined;
  },
  framework: c => {
    let all = 0;
    let deal = 0;
    for (const po of Object.values(c.s.pos)) {
      if (!inside(po.ordered, c.p.from, c.p.to)) continue;
      for (const ln of po.lines) {
        const v = valueOf(c.db, ln.material, ln.qty, lotPrice(c.db, { supplier: po.supplier, material: ln.material }));
        all += v;
        if (ln.contract && ln.qty > 0) deal += Math.floor((v * (ln.qty - (ln.list ?? 0))) / ln.qty);
      }
    }
    return share(deal, all);
  },
  dockToStock: c => median(dockTimes(c).map(x => x.sec)),
  dockWait: c => c.days.reduce((n, d) => n + Object.values(d.wait).reduce((x, w) => x + (w?.dock ?? 0), 0), 0),
  occupancy: c => share(c.p.snap.slots, c.p.snap.places),
  shelf: c => (c.p.snap.stock > 0 ? Math.round((c.p.snap.shelf * 100) / c.p.snap.stock) : undefined),
  otif: c => {
    const lines = otifLines(c);
    return share(lines.filter(x => x.ok).length, lines.length);
  },
  otifOrders: c => {
    const closed = Object.values(c.s.orders).filter(o => inside(closedAt(c.s, o), c.p.from, c.p.to));
    return share(closed.filter(o => o.status === 'shipped').length, closed.length);
  },
  revenue: c => Object.values(c.s.shipments).reduce((n, x) => n + (inside(x.t, c.p.from, c.p.to) ? x.sum : 0), 0),
  dso: c => {
    if (c.p.snap.n === 0) return undefined;
    const rev = CALC.revenue(c) ?? 0;
    return rev > 0 ? Math.round((c.p.snap.recv * c.len * 100) / (c.p.snap.n * rev * 1000)) : undefined;
  },
  turnover: c => {
    const people = [...Object.values(c.s.people), ...Object.values(c.s.former)];
    const at = (d: number) => people.filter(p => (p.hired ?? 0) <= d && d <= (p.quit?.last ?? Number.MAX_SAFE_INTEGER)).length;
    const gone = people.filter(p => p.quit !== undefined && p.quit.last >= c.y0 && p.quit.last < c.d1 && c.s.former[p.id] !== undefined).length;
    const avg = (at(c.y0) + at(c.d1 - 1)) / 2;
    return avg > 0 ? Math.round((gone * P_ONE) / avg) : undefined;
  },
  vacancy: c => median(vacancyDays(c).map(x => x.days)),
  noAdm: c => share(c.p.snap.noAdm, c.p.snap.people),
  otLimit: c => (c.p.snap.n > 0 ? c.p.snap.ot : undefined),
};

/** Пробы, у которых последний результат готов в периоде: от отбора до последнего результата, с. */
export function sampleTimes(c: Ctx): { sample: string; sec: number }[] {
  const out: { sample: string; sec: number }[] = [];
  for (const sm of Object.values(c.s.samples)) {
    if (sm.taken === undefined || sm.tests.length === 0) continue;
    const ts = sm.tests.map(id => c.s.tests[id]).filter(t => t && !t.inv);
    if (ts.length === 0 || ts.some(t => t.state !== 'done' || t.done === undefined)) continue;
    const last = Math.max(...ts.map(t => t.done!));
    if (inside(last, c.p.from, c.p.to)) out.push({ sample: sm.id, sec: last - sm.taken });
  }
  return out;
}

/** Купленные партии, решённые в периоде: от прихода до решения, с. */
export function incomingTimes(c: Ctx): { lot: string; sec: number }[] {
  return Object.values(c.s.lots).flatMap(l => {
    const at = lotDecided(l);
    return bought(c.db, l) && inside(at, c.p.from, c.p.to) ? [{ lot: l.id, sec: at - l.received }] : [];
  });
}

/** Оценки отклонений, сделанные в периоде: от открытия до конца оценки, с. */
export function assessTimes(c: Ctx): { dev: string; sec: number }[] {
  return Object.values(c.s.deviations).flatMap(d => (inside(d.assess?.done, c.p.from, c.p.to) ? [{ dev: d.id, sec: d.assess!.done! - d.opened }] : []));
}

/** Серии, выпущенные в периоде: от конца упаковки до решения, с. */
export function releaseTimes(c: Ctx): { batch: string; sec: number }[] {
  return Object.values(c.s.batches).flatMap(b =>
    b.status === 'released' && b.pack?.end !== undefined && inside(b.released, c.p.from, c.p.to) ? [{ batch: b.id, sec: b.released! - b.pack.end }] : [],
  );
}

/** Купленные партии, последняя паллета которых легла на место в периоде: от рампы до места, с. */
export function dockTimes(c: Ctx): { lot: string; sec: number }[] {
  return Object.values(c.s.lots).flatMap(l => (l.docked !== undefined && inside(l.placed, c.p.from, c.p.to) ? [{ lot: l.id, sec: l.placed - l.docked }] : []));
}

/** Принятые, у которых первый день — в окне 12 месяцев: от открытия вакансии до первого дня, сутки × 100. */
export function vacancyDays(c: Ctx): { person: string; days: number }[] {
  return [...Object.values(c.s.people), ...Object.values(c.s.former)].flatMap(p =>
    p.vac !== undefined && p.hired !== undefined && p.hired >= c.y0 && p.hired < c.d1 ? [{ person: p.id, days: (p.hired - p.vac) * 100 }] : [],
  );
}

/** Отклонения окна 12 месяцев и было ли за 12 месяцев до каждого такое же — по виду, стадии и тому, что вне пределов. */
export function repeats(c: Ctx): { dev: string; prev?: string }[] {
  const all = Object.values(c.s.deviations).sort((a, b) => a.opened - b.opened || (a.id < b.id ? -1 : 1));
  return all
    .filter(d => inside(d.opened, c.p.yFrom, c.p.to))
    .map(d => {
      const prev = all.find(x => x !== d && x.opened <= d.opened && d.opened - x.opened <= 365 * DAY && devSig(x) === devSig(d) && (x.opened < d.opened || x.id < d.id));
      return { dev: d.id, ...(prev ? { prev: prev.id } : {}) };
    });
}

/** Строки заказов, закрытых в периоде: полностью и в срок — `ok` (заказ не опоздал, строка отгружена вся). */
export function otifLines(c: Ctx): { order: string; sku: string; ok: boolean }[] {
  return Object.values(c.s.orders).flatMap(o =>
    inside(closedAt(c.s, o), c.p.from, c.p.to) ? o.lines.map(l => ({ order: o.id, sku: l.sku, ok: o.status !== 'late' && l.shipped >= l.cases })) : [],
  );
}

/**
 * Cpk показателей МОК за период — по карте и испытанию: границы карты, среднее и σ по среднему скользящему размаху
 * соседних результатов (ISO 22400-2, табл. 23); у показателя меньше `CPK_N` результатов — не считаем. Cpk — 1/10 000.
 */
export function cpkOf(c: Ctx): { recipe: string; test: string; n: number; cpk: number }[] {
  const pts = new Map<string, { t: number; v: number }[]>();
  for (const b of Object.values(c.s.batches))
    for (const r of b.records)
      for (const x of r.ipc) {
        if (!inside(x.t, c.p.from, c.p.to)) continue;
        const key = `${b.recipe}|${x.test}`;
        const a = pts.get(key) ?? [];
        a.push({ t: x.t, v: x.result });
        pts.set(key, a);
      }
  const out: { recipe: string; test: string; n: number; cpk: number }[] = [];
  for (const [key, a] of [...pts.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    if (a.length < CPK_N) continue;
    const [recipe, test] = key.split('|');
    const lim = c.db.recipes[recipe]?.stages.flatMap(st => st.ipc).find(x => x.test === test);
    if (!lim || (lim.min === undefined && lim.max === undefined)) continue;
    const v = a.sort((x, y) => x.t - y.t).map(x => x.v);
    const mean = v.reduce((x, y) => x + y, 0) / v.length;
    let mr = 0;
    for (let i = 1; i < v.length; i++) mr += Math.abs(v[i] - v[i - 1]);
    const sigma = (mr / (v.length - 1)) * (1000 / D2);
    if (sigma <= 0) continue;
    const up = lim.max !== undefined ? (lim.max - mean) / (3 * sigma) : Number.POSITIVE_INFINITY;
    const lo = lim.min !== undefined ? (mean - lim.min) / (3 * sigma) : Number.POSITIVE_INFINITY;
    out.push({ recipe, test, n: v.length, cpk: Math.round(Math.min(up, lo) * P_ONE) });
  }
  return out;
}

/** Расход материалов за период по цене партии, копейки: отвешенное на серии, отвешивание которых кончилось, и выданное на задания, упаковка которых кончилась. */
function usedValue(c: Ctx): number {
  let v = 0;
  const add = (lot: string, material: string, qty: number) => {
    const l = c.s.lots[lot];
    if (l) v += valueOf(c.db, material, qty, lotPrice(c.db, l));
  };
  for (const b of Object.values(c.s.batches)) {
    if (inside(b.records[0]?.end, c.p.from, c.p.to)) for (const k of b.dispensed) add(k.lot, k.material, k.qty);
    if (b.pack && inside(b.pack.end, c.p.from, c.p.to)) for (const k of b.pack.used) add(k.lot, k.material, k.qty);
  }
  return v;
}

/** Значения показателей за период — в единицах определений; посчитать не из чего — ключа нет. */
export function kpiValues(db: ContentDb, s: PlantState, p: KpiPeriod): Record<string, number> {
  return kpiPick(db, s, p, KPIS.map(k => k.id));
}

/** Значения только этих показателей за период — итог поста (3е) считает свои теми же функциями. */
export function kpiPick(db: ContentDb, s: PlantState, p: KpiPeriod, ids: readonly string[]): Record<string, number> {
  const c = ctxOf(db, s, p);
  const out: Record<string, number> = {};
  for (const id of ids) {
    const v = CALC[id]?.(c);
    if (v !== undefined && Number.isFinite(v)) out[id] = v;
  }
  return out;
}

/**
 * Период «с мгновения `from` по сейчас» — итог поста (3е): без сумм срезов и кВт·ч — его показатели их не читают; окно
 * 12 месяцев — как у текущего месяца.
 */
export function sincePeriod(s: PlantState, from: number): KpiPeriod {
  return { from, to: s.t, yFrom: monthStart(s, s.t, -11), snap: emptySnap(), wh: 0 };
}

/** Сменные задания, закрытые в [from, to), — у выполнения заданий и ритмичности. */
export function closedShifts(s: PlantState, from: number, to: number) {
  return s.shiftTasks.filter(t => inside(t.to, from, to));
}

/** Контекст расчёта за период — для видов: «Почему?» каждого показателя читает те же записи. */
export const kpiCtx = ctxOf;
export type KpiCtx = Ctx;
