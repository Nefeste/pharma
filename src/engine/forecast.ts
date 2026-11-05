// Прогноз продаж (Б6в; docs/specs/2026-10-vertical-slice.md, «Б6в»; геймдизайн, §9.1, §10.1). Сезон спроса — у группы
// товаров базы: спрос покупателя за сутки × индекс месяца, если у сценария есть прогноз. Ряд спроса позиции — ящики,
// заказанные покупателями, по месяцу заказа: история до старта тем же правилом, своей ветвью зерна, потом факт. В 00:00
// 1-го числа, после закрытия месяца показателей, — прогноз на 18 месяцев пятью способами на спросе за календарный день
// (fpp3, гл. 3, 5, 8; NIST, § 6.4.2.1; Bunn, Vassilopoulos, 1993); «лучший» — с наименьшей ошибкой за 12 месяцев по
// проверке на скользящем начале (fpp3, § 5.10); у планирования — способ политики с правками руками, у отдела продаж —
// сглаживание с оптимизмом сценария (fpp3, гл. 6; Fildes и др., 2009). Ошибка — факт минус прогноз с запаздыванием в
// месяц: WAPE и смещение (fpp3, § 5.8; GHSC-PSM, A06b). Только целые: ставки — тысячные ящика за сутки, доли — 1/10 000.
import type { ContentDb, FcMethod, Id } from '../content/types';
import { civilFromDays, DAY, daysFromCivil, HOUR, isWorkday, lastOfMonth, momentOf } from './core/calendar';
import { P_ONE } from './core/rng';
import { note, noteCmd } from './journal';
import { poisson } from './market';
import { POL, policyOf } from './policies';
import { roll } from './random';
import type { Command, FcCases, ForecastState, Notice, PlantState } from './types';
import { calOf } from './workdays';

/** Числа прогноза (геймдизайн, §9.1; гипотезы). */
export const HORIZON = 18;
export const HISTORY = 24;
export const LAG_KEEP = 24;
export const MA_N = 3;
export const ALPHA = 3000;
export const BETA = 1000;
export const PHI = 9000;
export const BEST_N = 12;
/** Способы §9.1 — в этом порядке; «лучший» при равной ошибке — первый. */
export const METHODS: readonly FcMethod[] = ['last-year', 'ma', 'ses', 'holt', 'group'];
/** Тысячные ящика за сутки — ставка способа. */
const MILLI = 1000;

// ---------------------------------------------------------------- месяцы

/** Номер месяца: год × 12 + месяц − 1. */
export const monthNo = (y: number, m: number) => y * 12 + m - 1;
/** Год и месяц по номеру. */
export const ymOf = (n: number) => ({ y: Math.floor(n / 12), m: (n % 12) + 1 });
/** Первый день месяца — номер дня от 1970-01-01. */
export const firstDay = (n: number) => {
  const { y, m } = ymOf(n);
  return daysFromCivil({ y, m, d: 1 });
};
/** Дней в месяце. */
export const daysIn = (n: number) => {
  const { y, m } = ymOf(n);
  return lastOfMonth(y, m) - daysFromCivil({ y, m, d: 1 }) + 1;
};
/** Месяц дня. */
export const monthOfDay = (z: number) => {
  const c = civilFromDays(z);
  return monthNo(c.y, c.m);
};
/** Месяц мгновения завода. */
export const monthAt = (s: PlantState, t: number) => monthOfDay(momentOf(s.start, t).day);
/** Мгновение начала месяца `n` — игровые секунды. */
const monthT = (s: PlantState, n: number) => (firstDay(n) - daysFromCivil(s.start)) * DAY;

// ---------------------------------------------------------------- сезон спроса

/** Индекс месяца `n` у позиции, % среднего месяца: сезон её продукта. */
export function seasonIndex(db: ContentDb, sku: Id, n: number): number {
  const sea = db.seasons[db.products[db.skus[sku].product].season];
  return sea.months[n % 12];
}

/**
 * Секунды спроса позиции с мгновения `a` по `b` с сезоном: у сценария с прогнозом — секунды каждого месяца × его индекс /
 * 100; без прогноза — просто секунды.
 */
export function seasonSec(db: ContentDb, s: PlantState, sku: Id, a: number, b: number): number {
  if (!db.scenarios[s.scenario].forecast || b <= a) return Math.max(0, b - a);
  let out = 0;
  for (let n = monthAt(s, a), t = a; t < b; n++) {
    const end = Math.min(b, monthT(s, n + 1));
    out += ((end - t) * seasonIndex(db, sku, n)) / 100;
    t = end;
  }
  return out;
}

// ---------------------------------------------------------------- ряд спроса

/** Позиции прогноза — план выпуска сценария. */
export const fcSkus = (db: ContentDb, s: PlantState): Id[] => [...new Set((db.scenarios[s.scenario].plan?.items ?? []).map(i => i.sku))];

/**
 * История спроса до старта (Б6в): по месяцам за `HISTORY` до месяца старта и часть месяца старта до старта — сумма
 * пуассоновских чисел ящиков покупателей сценария, со средним по их записи и сезону, ветвь `history/<покупатель>/<позиция>`.
 */
export function newForecast(db: ContentDb, s: PlantState): ForecastState | undefined {
  const sc = db.scenarios[s.scenario];
  if (!sc.forecast) return undefined;
  // от начала завода, а не от «сейчас»: у сохранения из прошлой схемы история — та же, что у новой игры
  const start = momentOf(s.start, sc.start.hour * HOUR);
  const M = monthOfDay(start.day);
  const from = M - HISTORY;
  const demand: Record<Id, number[]> = {};
  for (const sku of fcSkus(db, s)) {
    const per = db.skus[sku].case.per;
    const row: number[] = [];
    for (let n = from; n <= M; n++) {
      // месяц старта — его сутки до старта
      const sec = n < M ? daysIn(n) * DAY : (start.day - firstDay(n)) * DAY + start.sec;
      let cases = 0;
      for (const c of sc.customers) {
        const perDay = db.customers[c].demand[sku] ?? 0;
        const mean = (perDay * sec * seasonIndex(db, sku, n)) / (100 * DAY * per);
        cases += roll(s, `history/${c}/${sku}`, r => poisson(r, mean));
      }
      row.push(cases);
    }
    demand[sku] = row;
  }
  const f: ForecastState = { from, demand, at: M, method: 'ses', by: emptyBy(), plan: {}, sales: {}, edits: {}, lag: [] };
  return f;
}

const emptyBy = (): ForecastState['by'] => ({ 'last-year': {}, ma: {}, ses: {}, holt: {}, group: {} });

/** Заказ покупателя (market.ts): его ящики — в факт месяца заказа, мгновение `t` — сейчас или, в миграции, его. */
export function addDemand(s: PlantState, sku: Id, cases: number, t = s.t) {
  const f = s.forecast;
  const row = f?.demand[sku];
  if (!f || !row) return;
  const k = monthAt(s, t) - f.from;
  while (row.length <= k) row.push(0);
  row[k] += cases;
}

// ---------------------------------------------------------------- способы

/** Ставка месяца — тысячные ящика за сутки: ящики × 1000 / дней месяца, до целого. */
const rateOf = (cases: number, n: number) => Math.round((cases * MILLI) / daysIn(n));
/** Ящики месяца по ставке. */
const casesOf = (rate: number, n: number) => Math.max(0, Math.round((rate * daysIn(n)) / MILLI));
const mix = (a: number, x: number, prev: number) => Math.round((a * x + (P_ONE - a) * prev) / P_ONE);

/** Уровень простого сглаживания по ставкам `r`. */
function sesLevel(r: readonly number[]): number {
  if (r.length === 0) return 0;
  let l = r[0];
  for (let k = 1; k < r.length; k++) l = mix(ALPHA, r[k], l);
  return l;
}

/**
 * Индексы месяцев группы — 1/10 000, в среднем P_ONE: классическое мультипликативное разложение (fpp3, гл. 3) — ставка
 * к центрированному скользящему среднему 2 × 12, по каждому месяцу года — среднее; нет данных — 1.
 */
export function groupIndex(g: readonly number[], from: number): number[] {
  const sum = Array(12).fill(0);
  const cnt = Array(12).fill(0);
  for (let k = 6; k + 6 < g.length; k++) {
    let ma2 = g[k - 6] + g[k + 6];
    for (let j = k - 5; j <= k + 5; j++) ma2 += 2 * g[j];
    // 2 × 12: (половина крайних + средние) / 12 — в целых: сумма удвоенная / 24
    if (ma2 <= 0) continue;
    const c = (from + k) % 12;
    sum[c] += Math.round((g[k] * 24 * P_ONE) / ma2);
    cnt[c]++;
  }
  const raw = sum.map((x, c) => (cnt[c] > 0 ? Math.round(x / cnt[c]) : P_ONE));
  const mean = raw.reduce((a, b) => a + b, 0) / 12;
  return raw.map(x => Math.round((x * P_ONE) / mean));
}

/**
 * Прогноз ставки на месяцы `M`…`M + h − 1` способом `m` по ставкам `r` месяцев `from`…`M − 1`; `g` — ставки группы тех же
 * месяцев (для «с сезоном группы»). Нет данных — ноль.
 */
export function rates(m: FcMethod, r: readonly number[], g: readonly number[], from: number, h: number): number[] {
  const L = r.length;
  const M = from + L;
  const out: number[] = [];
  if (L === 0) return Array(h).fill(0);
  switch (m) {
    case 'last-year': {
      // тот же месяц последнего известного года; нет такого — сглаживание
      const l = sesLevel(r);
      for (let i = 0; i < h; i++) {
        let k = M + i - from - 12;
        while (k >= L) k -= 12;
        out.push(k >= 0 ? r[k] : l);
      }
      return out;
    }
    case 'ma': {
      const w = r.slice(Math.max(0, L - MA_N));
      const v = Math.round(w.reduce((a, b) => a + b, 0) / w.length);
      return Array(h).fill(v);
    }
    case 'ses':
      return Array(h).fill(sesLevel(r));
    case 'holt': {
      // Хольт с затуханием: ℓ = αy + (1 − α)(ℓ + φb), b = β(ℓ − ℓ′) + (1 − β)φb; прогноз — ℓ + (φ + … + φʰ)b
      let l = r[0];
      let b = L > 1 ? r[1] - r[0] : 0;
      for (let k = 1; k < L; k++) {
        const prev = l;
        const damp = Math.round((PHI * b) / P_ONE);
        l = mix(ALPHA, r[k], l + damp);
        b = mix(BETA, l - prev, damp);
      }
      let phi = P_ONE;
      let acc = 0;
      for (let i = 0; i < h; i++) {
        phi = Math.round((phi * PHI) / P_ONE);
        acc += phi;
        out.push(Math.max(0, l + Math.round((acc * b) / P_ONE)));
      }
      return out;
    }
    case 'group': {
      const idx = groupIndex(g, from);
      const de = r.map((x, k) => Math.round((x * P_ONE) / idx[(from + k) % 12]));
      const l = sesLevel(de);
      for (let i = 0; i < h; i++) out.push(Math.round((l * idx[(M + i) % 12]) / P_ONE));
      return out;
    }
  }
}

/** Ставки месяцев `from`…`from + n − 1` ряда ящиков. */
const ratesOfRow = (row: readonly number[], from: number, n: number) => row.slice(0, n).map((c, k) => rateOf(c, from + k));

/** Ставки группы — сумма ставок позиций одного сезона. */
function groupRates(db: ContentDb, f: ForecastState, skus: readonly Id[], sku: Id, n: number): number[] {
  const sea = db.products[db.skus[sku].product].season;
  const out = Array(n).fill(0);
  for (const x of skus) {
    if (db.products[db.skus[x].product].season !== sea) continue;
    const r = ratesOfRow(f.demand[x], f.from, n);
    for (let k = 0; k < n; k++) out[k] += r[k];
  }
  return out;
}

/**
 * Ошибка способа за `BEST_N` месяцев до месяца `M` с запаздыванием в месяц — проверка на скользящем начале (fpp3,
 * § 5.10): прогноз месяца `t` — по данным до `t − 2`, на второй месяц вперёд. Позиции `of` — из позиций плана `skus`
 * (группа — по ним всем). Суммы модулей ошибок, ошибок и факта, ящики; данных нет — `undefined`.
 */
export function backtest(db: ContentDb, f: ForecastState, skus: readonly Id[], m: FcMethod, M: number, n = BEST_N, of: readonly Id[] = skus): { abs: number; err: number; fact: number } | undefined {
  const L = M - f.from;
  if (L < n + 2) return undefined;
  let abs = 0;
  let err = 0;
  let fact = 0;
  for (const sku of of) {
    const row = f.demand[sku];
    for (let t = L - n; t < L; t++) {
      const r = ratesOfRow(row, f.from, t - 1);
      const g = groupRates(db, f, skus, sku, t - 1);
      const fc = casesOf(rates(m, r, g, f.from, 2)[1], f.from + t);
      const act = row[t] ?? 0;
      abs += Math.abs(act - fc);
      err += act - fc;
      fact += act;
    }
  }
  return { abs, err, fact };
}

/** «Лучший» способ к месяцу `M`: наименьшая WAPE проверки; поровну — первый; проверить нечем — сглаживание. */
export function bestMethod(db: ContentDb, f: ForecastState, skus: readonly Id[], M: number): FcMethod {
  let best: { m: FcMethod; w: number } | undefined;
  for (const m of METHODS) {
    const b = backtest(db, f, skus, m, M);
    if (!b || b.fact <= 0) continue;
    const w = Math.round((b.abs * P_ONE) / b.fact);
    if (!best || w < best.w) best = { m, w };
  }
  return best?.m ?? 'ses';
}

// ---------------------------------------------------------------- прогноз месяца

/**
 * Прогноз в начале месяца `M` (Б6в): по ряду до `M − 1` каждым способом на `HORIZON` месяцев; у планирования — способ
 * политики или «лучший», с правками руками; у отдела продаж — сглаживание с оптимизмом сценария; прогноз на следующий
 * месяц — в записи с запаздыванием (`lag`), запись журнала начальника отдела продаж (`journal`). Правки прошлых месяцев
 * уходят.
 */
export function runForecast(db: ContentDb, s: PlantState, M: number, o: { lag: boolean; journal: boolean }) {
  const f = s.forecast;
  const sc = db.scenarios[s.scenario];
  if (!f || !sc.forecast) return;
  const skus = fcSkus(db, s);
  const L = M - f.from;
  for (const sku of skus) while (f.demand[sku].length < L) f.demand[sku].push(0);
  const by = emptyBy();
  for (const sku of skus) {
    const r = ratesOfRow(f.demand[sku], f.from, L);
    const g = groupRates(db, f, skus, sku, L);
    for (const m of METHODS) by[m][sku] = rates(m, r, g, f.from, HORIZON).map((x, i) => casesOf(x, M + i));
  }
  for (const sku of Object.keys(f.edits)) {
    for (const k of Object.keys(f.edits[sku])) if (Number(k) < M) delete f.edits[sku][Number(k)];
    if (Object.keys(f.edits[sku]).length === 0) delete f.edits[sku];
  }
  const sales: Record<Id, number[]> = {};
  const up = P_ONE + sc.forecast.optimism;
  for (const sku of skus) sales[sku] = by.ses[sku].map(x => Math.round((x * up) / P_ONE));
  f.at = M;
  f.by = by;
  f.sales = sales;
  replan(db, s);
  const plan = f.plan;
  if (!o.lag) return;
  const next: FcCases = {};
  const salesNext: FcCases = {};
  for (const sku of skus) {
    next[sku] = plan[sku][1];
    salesNext[sku] = sales[sku][1];
  }
  f.lag.push({ m: M + 1, plan: next, sales: salesNext });
  while (f.lag.length > LAG_KEEP) f.lag.shift();
  if (o.journal) note(s, 'sales', { kind: 'forecast', m: M, cases: skus.reduce((a, x) => a + sales[x][0], 0), method: 'ses', optimism: sc.forecast.optimism });
}

/**
 * Прогноз планирования по способу политики «способ прогноза» (Б6в): способ или «лучший» — по проверке к нынешнему месяцу;
 * правки руками — вместо способа. 1-го числа — после прогноза способами; сменили политику — сразу, по тем же прогнозам
 * способов; записи с запаздыванием не меняются.
 */
export function replan(db: ContentDb, s: PlantState) {
  const f = s.forecast;
  if (!f) return;
  const skus = fcSkus(db, s);
  const pol = policyOf(db, s, POL.method);
  f.method = pol === undefined || pol === 'best' ? bestMethod(db, f, skus, f.at) : (pol as FcMethod);
  const plan: Record<Id, number[]> = {};
  for (const sku of skus) plan[sku] = f.by[f.method][sku].map((x, i) => f.edits[sku]?.[f.at + i] ?? x);
  f.plan = plan;
}

/** Каждый час, после показателей (Б5ж): в 00:00 1-го числа — прогноз нового месяца. */
export function forecastHour(db: ContentDb, s: PlantState) {
  if (!s.forecast) return;
  const now = momentOf(s.start, s.t);
  if (now.sec !== 0 || now.date.d !== 1) return;
  const M = monthNo(now.date.y, now.date.m);
  if (s.forecast.at >= M) return;
  runForecast(db, s, M, { lag: true, journal: true });
}

/** Прогноз планирования позиции на месяц `n`: из нынешнего прогноза; вне его — крайний месяц. */
export function planCases(s: PlantState, sku: Id, n: number): number {
  const f = s.forecast!;
  const row = f.plan[sku] ?? [];
  if (row.length === 0) return 0;
  return row[Math.max(0, Math.min(row.length - 1, n - f.at))];
}

/**
 * Спрос позиции по прогнозу планирования на `window` суток с сейчас (Б6в; политика «спрос — по прогнозу»): ящики — по
 * месяцам, по доле их секунд в окне, и рабочих дней в окне — так же, как окно по заказам считает заказанное и рабочие дни.
 */
export function forecastAhead(db: ContentDb, s: PlantState, sku: Id, window: number): { ordered: number; work: number } {
  const t1 = s.t + window * DAY;
  let ordered = 0;
  for (let n = monthAt(s, s.t), t = s.t; t < t1; n++) {
    const end = Math.min(t1, monthT(s, n + 1));
    ordered += (planCases(s, sku, n) * (end - t)) / (daysIn(n) * DAY);
    t = end;
  }
  const cal = calOf(db, s);
  const today = momentOf(s.start, s.t).day;
  let work = 0;
  for (let z = today; z < today + window; z++) if (isWorkday(cal, z)) work++;
  return { ordered: Math.round(ordered), work };
}

// ---------------------------------------------------------------- точность

/**
 * Ошибка прогноза с запаздыванием в месяц за закрытые месяцы `[a, b)` — до нынешнего — у планирования или отдела продаж:
 * суммы модулей ошибок, ошибок и факта, ящики, по месяцам, у которых есть запись, — всех позиций или позиций `of`; нет ни
 * одной — `undefined`.
 */
export function lagError(s: PlantState, who: 'plan' | 'sales', a: number, b: number, of?: readonly Id[]): { abs: number; err: number; fact: number } | undefined {
  const f = s.forecast;
  if (!f) return undefined;
  let abs = 0;
  let err = 0;
  let fact = 0;
  let any = false;
  const now = monthAt(s, s.t);
  for (const x of f.lag) {
    if (x.m < a || x.m >= b || x.m >= now) continue;
    for (const [k, fc] of Object.entries(x[who])) {
      if (of && !of.includes(k)) continue;
      const act = f.demand[k]?.[x.m - f.from] ?? 0;
      abs += Math.abs(act - fc);
      err += act - fc;
      fact += act;
      any = true;
    }
  }
  return any ? { abs, err, fact } : undefined;
}

/** WAPE и смещение — доли 1/10 000: сумма модулей ошибок и сумма ошибок к сумме факта; факта нет — `undefined`. */
export const shares = (e: { abs: number; err: number; fact: number } | undefined) => (e && e.fact > 0 ? { wape: Math.round((e.abs * P_ONE) / e.fact), bias: Math.round((e.err * P_ONE) / e.fact) } : undefined);

// ---------------------------------------------------------------- команда

/**
 * Команда «прогноз» (Б6в): правка прогноза планирования — ящики позиции плана выпуска на месяц нынешнего прогноза; без
 * ящиков — снять. Запись журнала «вы» с тем, что было по способу. Отказы: прогноза нет, позиции нет в плане, месяц не из
 * нынешнего прогноза, ящики — не целое число не меньше нуля.
 */
export function forecastCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'forecast' }>, notices: Notice[]) {
  const refuse = (why: Extract<Notice, { kind: 'refused' }>['why'], detail?: string) => notices.push({ kind: 'refused', cmd: 'forecast', why, ...(detail ? { detail } : {}) });
  const f = s.forecast;
  if (!f) return refuse('noForecast');
  if (!fcSkus(db, s).includes(cmd.sku)) return refuse('noSku', cmd.sku);
  if (!Number.isInteger(cmd.m) || cmd.m < f.at || cmd.m >= f.at + HORIZON) return refuse('fcMonth', String(cmd.m));
  if (cmd.cases !== undefined && (!Number.isInteger(cmd.cases) || cmd.cases < 0)) return refuse('fcCases', String(cmd.cases));
  const i = cmd.m - f.at;
  const was = f.by[f.method][cmd.sku][i];
  if (cmd.cases === undefined) {
    if (f.edits[cmd.sku]) {
      delete f.edits[cmd.sku][cmd.m];
      if (Object.keys(f.edits[cmd.sku]).length === 0) delete f.edits[cmd.sku];
    }
    f.plan[cmd.sku][i] = was;
  } else {
    (f.edits[cmd.sku] ??= {})[cmd.m] = cmd.cases;
    f.plan[cmd.sku][i] = cmd.cases;
  }
  // запись с запаздыванием не меняется: точность мерят по прогнозу, каким он был 1-го числа прошлого месяца
  noteCmd(s, cmd, { kind: 'fcEdit', sku: cmd.sku, m: cmd.m, ...(cmd.cases !== undefined ? { cases: cmd.cases } : {}), was });
}
