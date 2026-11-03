// Совещание S&OP для окна (Б6г; docs/specs/2026-10-vertical-slice.md, «Б6г»; геймдизайн, §9.2): одна страница на 6
// месяцев по продуктам — спрос, мощности, запас и деньги; план — цели запаса по продуктам и месяцам, лучший план и «до
// лучшего плана»; люди под план. Числа — прогон плана вперёд на прогнозе планирования (src/engine/plan/sop.ts) и записи
// завода: заказы, прогнозы, счета, люди и их графики; истины тут нет. Блок планёрки — в день совещания и после него.
import type { ContentDb, Id } from '../content/types';
import { DAY } from '../engine/core/calendar';
import { firstDay, monthAt } from '../engine/forecast';
import { casesOf } from '../engine/planner';
import {
  reserveLine,
  shelfRisk,
  SOP_COVERS,
  SOP_MONTHS,
  SOP_RES,
  SOP_ROLES,
  type SopCash,
  sopCash,
  sopCtx,
  sopEval,
  type SopRes,
  type SopTrace,
  reserveOf,
} from '../engine/plan/sop';
import { sopAt, sopCover } from '../engine/sop';
import { numOf, POL } from '../engine/policies';
import type { PlantState, SopRecord } from '../engine/types';

/** Запас больше стольких суток продаж — излишек, жёлтый (§9.2). */
export const SOP_OVER = 60;

export interface SopQuery {
  view: 'sop';
  /** черновик игрока: цели по продуктам на 6 месяцев; нет — план совещания, утверждённый или по политике */
  draft?: Record<Id, number[]>;
}

/** Спрос продукта по месяцам: прогноз планирования и отдела продаж, ящики; заказано год назад; серий — десятые; по плану. */
export interface SopDemandRow {
  product: Id;
  plan: number[];
  sales: number[];
  year: (number | undefined)[];
  need: number[];
  batches: number[];
}

/** Ресурс по месяцам: нагрузка плана, мощность и линия резерва, с (задания — штуки). */
export interface SopResRow {
  res: SopRes;
  load: number[];
  cap: number[];
  line: number[];
}

/** Почему клетка запаса цветная: не хватит на спрос месяца; излишек; ГП не продать со сроком, какого требует покупатель. */
export type SopFlag = 'short' | 'over' | 'shelf';

/** Запас позиции на конец месяца: в десятых суток продаж, ящики, не продано за месяц, почему цветная. */
export interface SopStockRow {
  sku: Id;
  product: Id;
  days: number[];
  stock: number[];
  short: number[];
  flag: (SopFlag | undefined)[];
}

/** Часы роли по плану против часов её людей по графику, по месяцам, с. */
export interface SopPeopleRow {
  role: Id;
  need: number[];
  have: number[];
}

export interface SopView {
  view: 'sop';
  /** у сценария нет прогноза или плана выпуска — совещания нет */
  none?: true;
  /** первый месяц — нынешний, номер прогноза */
  from: number;
  products: Id[];
  covers: readonly number[];
  /** цели показанного плана и откуда они: черновик игрока, лучший план открытого совещания, утверждённый, политика */
  cover: Record<Id, number[]>;
  shown: 'draft' | 'best' | 'approved' | 'policy';
  policy: number;
  /** совещание идёт и ждёт «Утвердить»: мгновение, лучший план и его цель */
  open?: { at: number; best: Record<Id, number[]>; value: number };
  /** последний утверждённый план */
  approved?: SopRecord;
  /** следующее совещание — мгновение */
  next: number;
  /** цель показанного плана — средняя трёх вариантов спроса; маржа, цена денег в запасе, не продано (прогноз и выше) */
  value: number;
  margin: number;
  carry: number;
  lost: number;
  short: number;
  high: number;
  /** «до лучшего плана», копейки: на открытом совещании — у показанного плана, иначе — у утверждённого на совещании */
  gap?: number;
  /** ошибка прогноза в прогоне, WAPE, 1/10 000; резерв мощности — доля */
  err: number;
  reserve: [number, number];
  demand: SopDemandRow[];
  res: SopResRow[];
  /** узкое место месяца: ресурс с наибольшей долей нагрузки */
  bottleneck: (SopRes | undefined)[];
  stock: SopStockRow[];
  cash: SopCash;
  people: SopPeopleRow[];
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** Черновик годен: все продукты, по 6 целей из вариантов политики; иначе — нет. */
function draftOk(products: readonly Id[], d: Record<Id, number[]> | undefined): d is Record<Id, number[]> {
  if (!d) return false;
  if (Object.keys(d).some(p => !products.includes(p))) return false;
  return products.every(p => d[p]?.length === SOP_MONTHS && d[p].every(c => (SOP_COVERS as readonly number[]).includes(c)));
}

/** Цели месяцев с `from` по утверждённым планам завода; месяц без плана — политика «запас позиций». */
function approvedCover(s: PlantState, products: readonly Id[], from: number, policy: number): Record<Id, number[]> {
  return Object.fromEntries(products.map(p => [p, Array.from({ length: SOP_MONTHS }, (_, i) => sopCover(s, p, firstDay(from + i)) ?? policy)]));
}

export function sopView(db: ContentDb, s: PlantState, q: SopQuery): SopView {
  const sc = db.scenarios[s.scenario];
  const now = monthAt(s, s.t);
  const products = sc.plan ? [...new Set(sc.plan.items.map(i => db.skus[i.sku].product))] : [];
  const policy = numOf(db, s, POL.cover) ?? 21;
  const open = s.sop?.open;
  // совещание, которое не утвердили до конца месяца, идёт, пока не начнётся следующее: его план — с его месяца
  const from = open?.from ?? now;
  const approved = s.sop?.plans.at(-1);
  const next = sopAt(db, s, s.sop?.held === now ? now + 1 : now);
  if (!s.forecast || !sc.plan) {
    const blank = { months: [], low: { day: 0, at: 0, balance: 0 }, limit: sc.credit.limit };
    return { view: 'sop', none: true, from, products, covers: SOP_COVERS, cover: {}, shown: 'policy', policy, next, value: 0, margin: 0, carry: 0, lost: 0, short: 0, high: 0, err: 0, reserve: [0, 1], demand: [], res: [], bottleneck: [], stock: [], cash: blank, people: [] };
  }
  const draft = draftOk(products, q.draft) ? q.draft : undefined;
  const fromApproved = approvedCover(s, products, from, policy);
  const cover = draft ?? (open ? open.best : fromApproved);
  const shown: SopView['shown'] = draft ? 'draft' : open ? 'best' : products.some(p => fromApproved[p].some((_, i) => sopCover(s, p, firstDay(from + i)) !== undefined)) ? 'approved' : 'policy';
  const ctx = sopCtx(db, s, from);
  const trace: SopTrace = { sold: new Map(), demand: new Map(), made: [] };
  const r = sopEval(ctx, cover, trace);
  const reserve = reserveOf(db, s);
  const f = s.forecast;
  const items = sc.plan.items;
  const months = r.months;
  const demand: SopDemandRow[] = products.map(p => {
    const of = items.filter(i => db.skus[i.sku].product === p);
    return {
      product: p,
      plan: months.map(m => sum(of.map(i => f.plan[i.sku]?.[m.m - f.at] ?? 0))),
      sales: months.map(m => sum(of.map(i => f.sales[i.sku]?.[m.m - f.at] ?? 0))),
      year: months.map(m => {
        const k = m.m - 12 - f.from;
        return k < 0 ? undefined : sum(of.map(i => f.demand[i.sku]?.[k] ?? 0));
      }),
      need: months.map(m => Math.floor(sum(of.map(i => Math.floor(((f.plan[i.sku]?.[m.m - f.at] ?? 0) * 10000) / casesOf(db.recipes[i.recipe], db.skus[i.sku])))) / 1000)),
      batches: months.map(m => m.batches[p] ?? 0),
    };
  });
  const res: SopResRow[] = SOP_RES.map(x => ({
    res: x,
    load: months.map(m => m.load[x]),
    cap: months.map(m => m.cap[x]),
    line: months.map(m => (x === 'slot' ? m.cap[x] : reserveLine(m.cap[x], reserve))),
  }));
  const bottleneck = months.map(m => {
    let best: SopRes | undefined;
    let share = -1;
    for (const x of SOP_RES) {
      if (m.cap[x] <= 0) continue;
      const v = Math.floor((m.load[x] * 10000) / m.cap[x]);
      if (v > share) {
        share = v;
        best = x;
      }
    }
    return best;
  });
  const risk = shelfRisk(ctx, trace);
  const stock: SopStockRow[] = items.map(i => ({
    sku: i.sku,
    product: db.skus[i.sku].product,
    days: months.map(m => m.days[i.sku]),
    stock: months.map(m => m.stock[i.sku]),
    short: months.map(m => m.short[i.sku]),
    flag: months.map(m => (m.short[i.sku] > 0 ? 'short' : risk.get(i.sku)?.has(m.m) ? 'shelf' : m.days[i.sku] > SOP_OVER * 10 ? 'over' : undefined)),
  }));
  const people: SopPeopleRow[] = SOP_ROLES.map(role => ({ role, need: months.map(m => m.hours[role]), have: months.map(m => m.have[role]) }));
  const gap = open ? (draft ? Math.max(0, open.value - r.mean) : 0) : approved && shown === 'approved' ? Math.max(0, approved.best - approved.value) : undefined;
  return {
    view: 'sop',
    from,
    products,
    covers: SOP_COVERS,
    cover,
    shown,
    policy,
    ...(open ? { open: { at: open.at, best: open.best, value: open.value } } : {}),
    ...(approved ? { approved } : {}),
    next,
    value: r.mean,
    margin: r.margin,
    carry: r.carry,
    lost: r.lost,
    short: r.short,
    high: r.high,
    ...(gap !== undefined ? { gap } : {}),
    err: ctx.err,
    reserve,
    demand,
    res,
    bottleneck,
    stock,
    cash: sopCash(ctx, r, trace),
    people,
  };
}

/**
 * Блок планёрки (Б6г): в день совещания до него — «В 10:00 — S&OP»; утверждён план за сутки до планёрки — до какого
 * месяца, цели нынешнего месяца по продуктам, кто утвердил и «до лучшего плана».
 */
export interface SopMeeting {
  /** совещание сегодня — его мгновение */
  today?: number;
  /** план, утверждённый за сутки до мгновения планёрки */
  plan?: { at: number; from: number; to: number; by: string; cover: { product: Id; days: number }[]; gap: number };
}

export function sopMeeting(db: ContentDb, s: PlantState, at: number): SopMeeting | undefined {
  if (!s.forecast || !db.scenarios[s.scenario].plan) return undefined;
  const n = monthAt(s, at);
  const meet = sopAt(db, s, n);
  const today = meet >= at && meet < Math.floor(at / DAY) * DAY + DAY ? meet : undefined;
  const p = s.sop?.plans.filter(x => x.at <= at && x.at > at - DAY).at(-1);
  if (today === undefined && !p) return undefined;
  return {
    ...(today !== undefined ? { today } : {}),
    ...(p ? { plan: { at: p.at, from: p.from, to: p.from + SOP_MONTHS - 1, by: p.by, cover: Object.entries(p.cover).map(([product, xs]) => ({ product, days: xs[0] })), gap: Math.max(0, p.best - p.value) } } : {}),
  };
}
