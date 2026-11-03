// Прогноз продаж для окна (Б6в; docs/specs/2026-10-vertical-slice.md, «Б6в»): четвёртая вкладка расписания — позиции
// плана выпуска строками, 18 месяцев столбцами; в клетке — прогноз планирования, под ним — отдела продаж, правка руками
// с тем, что было по способу. «Прогноз против факта» позиции или продукта: 24 месяца назад — факт и прогнозы с
// запаздыванием в месяц, 18 месяцев вперёд — прогнозы; ошибка за 12 месяцев — у планирования, отдела продаж и каждого
// способа (проверка на скользящем начале). Блок планёрки — в первые сутки после закрытия месяца. Всё — записи завода:
// заказы покупателей и прогнозы; истины тут нет.
import type { ContentDb, FcMethod, Id } from '../content/types';
import { DAY } from '../engine/core/calendar';
import { backtest, BEST_N, fcSkus, HORIZON, HISTORY, lagError, METHODS, monthAt, shares } from '../engine/forecast';
import { POL, policyOf } from '../engine/policies';
import type { PlantState } from '../engine/types';

/** Доля ошибки: WAPE и смещение, 1/10 000; смещение со знаком «факт минус прогноз»: минус — прогноз выше факта. */
export interface FcShare {
  wape: number;
  bias: number;
}

/**
 * Ошибка за 12 месяцев с запаздыванием в месяц: у планирования, отдела продаж и каждого способа; нечем мерить — нет.
 * `months` — сколько из 12 закрытых месяцев завод прогнозировал: на остальные записи с запаздыванием нет.
 */
export interface FcErrs {
  plan?: FcShare;
  sales?: FcShare;
  months: number;
  by: Partial<Record<FcMethod, FcShare>>;
}

/** Клетка сетки: прогноз планирования и отдела продаж; правка руками — и сколько было по способу. */
export interface FcCell {
  plan: number;
  sales: number;
  edit?: true;
  was: number;
}

export interface FcRowView {
  sku: Id;
  product: Id;
  cells: FcCell[];
}

/** Месяц «прогноза против факта»: факт — заказано ящиков; прогнозы — с запаздыванием в месяц (прошлое) или нынешние. */
export interface FcPoint {
  m: number;
  fact?: number;
  plan?: number;
  sales?: number;
}

export interface ForecastView {
  /** нынешний месяц — первый столбец; номер — год × 12 + месяц − 1 */
  at: number;
  /** способ планирования сейчас и политика «способ прогноза»: способ или «лучший» */
  method: FcMethod;
  policy: string;
  /** политика «спрос»: правило задания — по заказам окна или по прогнозу */
  demand: string;
  rows: FcRowView[];
  /** всех позиций */
  err: FcErrs;
  /** «прогноз против факта»: позиция или продукт */
  key: Id;
  past: FcPoint[];
  ahead: FcPoint[];
  keyErr: FcErrs;
}

/** Позиции ключа: позиция — она, продукт — его позиции плана; ключа нет — все. */
function skusOf(db: ContentDb, all: readonly Id[], key: Id): Id[] {
  if (all.includes(key)) return [key];
  const of = all.filter(x => db.skus[x].product === key);
  return of.length > 0 ? of : [...all];
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** Ошибка за 12 закрытых месяцев до `at` у позиций `of`. */
function errsOf(db: ContentDb, s: PlantState, all: readonly Id[], of: readonly Id[]): FcErrs {
  const f = s.forecast!;
  const plan = shares(lagError(s, 'plan', f.at - BEST_N, f.at, of));
  const sales = shares(lagError(s, 'sales', f.at - BEST_N, f.at, of));
  const by: FcErrs['by'] = {};
  for (const m of METHODS) {
    const x = shares(backtest(db, f, all, m, f.at, BEST_N, of));
    if (x) by[m] = x;
  }
  const months = f.lag.filter(x => x.m >= f.at - BEST_N && x.m < f.at).length;
  return { ...(plan ? { plan } : {}), ...(sales ? { sales } : {}), months, by };
}

/** Вкладка «Прогноз»: сетка и «прогноз против факта» ключа `key` — позиции или продукта; нет — первого продукта плана. */
export function forecastView(db: ContentDb, s: PlantState, key?: Id): ForecastView | undefined {
  const f = s.forecast;
  if (!f) return undefined;
  const all = fcSkus(db, s);
  const rows = all.map(sku => ({
    sku,
    product: db.skus[sku].product,
    cells: f.plan[sku].map((plan, i) => {
      const edit = f.edits[sku]?.[f.at + i] !== undefined;
      return { plan, sales: f.sales[sku][i], ...(edit ? { edit: true as const } : {}), was: f.by[f.method][sku][i] };
    }),
  }));
  const k = key && (all.includes(key) || all.some(x => db.skus[x].product === key)) ? key : db.skus[all[0]].product;
  const of = skusOf(db, all, k);
  const lag = new Map(f.lag.map(x => [x.m, x]));
  const past: FcPoint[] = [];
  for (let m = f.at - HISTORY; m < f.at; m++) {
    if (m < f.from) continue;
    const x = lag.get(m);
    past.push({ m, fact: sum(of.map(sku => f.demand[sku][m - f.from] ?? 0)), ...(x ? { plan: sum(of.map(sku => x.plan[sku] ?? 0)), sales: sum(of.map(sku => x.sales[sku] ?? 0)) } : {}) });
  }
  const ahead: FcPoint[] = [];
  for (let i = 0; i < HORIZON; i++) ahead.push({ m: f.at + i, plan: sum(of.map(sku => f.plan[sku][i])), sales: sum(of.map(sku => f.sales[sku][i])) });
  return {
    at: f.at,
    method: f.method,
    policy: String(policyOf(db, s, POL.method) ?? 'best'),
    demand: String(policyOf(db, s, POL.demand) ?? 'orders'),
    rows,
    err: errsOf(db, s, all, all),
    key: k,
    past,
    ahead,
    keyErr: errsOf(db, s, all, of),
  };
}

/**
 * Блок планёрки (Б6в): в первые сутки после закрытия месяца — сколько в нём заказано ящиков всех позиций и что ему
 * прогнозировали месяц назад планирование и отдел продаж; прогноз нынешнего месяца — у обоих. Прогноза на закрытый месяц
 * завод не делал — в месяц старта игры или после загрузки старого сохранения — блока нет.
 */
export interface FcMeeting {
  /** закрытый месяц */
  m: number;
  fact: number;
  plan: number;
  sales: number;
  /** нынешний месяц и его прогноз */
  next: { m: number; plan: number; sales: number };
}

export function fcMeeting(db: ContentDb, s: PlantState, at: number): FcMeeting | undefined {
  const f = s.forecast;
  if (!f) return undefined;
  const now = monthAt(s, at);
  // первые сутки месяца, и прогноз уже на него
  if (f.at !== now || monthAt(s, at - DAY) === now) return undefined;
  const all = fcSkus(db, s);
  const m = now - 1;
  const x = f.lag.find(r => r.m === m);
  if (!x) return undefined;
  return {
    m,
    fact: sum(all.map(sku => f.demand[sku][m - f.from] ?? 0)),
    plan: sum(all.map(sku => x.plan[sku] ?? 0)),
    sales: sum(all.map(sku => x.sales[sku] ?? 0)),
    next: { m: now, plan: sum(all.map(sku => f.plan[sku][0])), sales: sum(all.map(sku => f.sales[sku][0])) },
  };
}
