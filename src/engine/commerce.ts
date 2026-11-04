// События коммерции (Б6е; docs/specs/2026-10-vertical-slice.md, «Б6е»; геймдизайн, §9.2, §14): между совещаниями S&OP
// начальник отдела продаж приносит от одного до четырёх событий в месяц — в случайные рабочие дни месяца, в 12:00, по
// своей ветви зерна. Событие — серия позиции ± `size` % у покупателя: покупатель — по его доле спроса, позиция — по его
// спросу. Крупный заказ — заказ покупателя со сроком через `due` суток: дальше он идёт как все заказы — FEFO в день срока,
// «под угрозой», «без покрытия» (Б6а). Снятый спрос — столько ящиков покупатель не возьмёт в ближайших заказах позиции:
// их вычитает рынок (market.ts), а правило задания видит это в окне спроса. Что знает завод — извещение и запись
// начальника отдела продаж в журнале решений; правил, которые читали бы события, нет. Счёт — в целых.
import type { ContentDb, Customer, Id } from '../content/types';
import { DAY, daysFromCivil, HOUR, isWorkday, momentOf, workdayOnOrAfter } from './core/calendar';
import { addDemand, monthAt } from './forecast';
import { note } from './journal';
import { TRUCK_HOUR } from './market';
import { casesOf } from './planner';
import { roll } from './random';
import { nextId } from './stock';
import type { CommerceState, Notice, Order, PlantState } from './types';
import { calOf } from './workdays';

/** Час событий: после заказов покупателей (10:00 и 11:00) и правил планирования и снабжения утра. */
export const EVENT_HOUR = 12 * HOUR;

/** Ящиков в серии позиции по карте плана сценария; позиции нет в плане — нет. */
function batchCases(db: ContentDb, s: PlantState, sku: Id): number | undefined {
  const it = db.scenarios[s.scenario].plan?.items.find(x => x.sku === sku);
  return it ? casesOf(db.recipes[it.recipe], db.skus[sku]) : undefined;
}

/** Спрос покупателя по позициям плана: только их он может заказать крупно или снять. */
function planDemand(db: ContentDb, s: PlantState, c: Customer): [Id, number][] {
  return Object.entries(c.demand).filter(([sku, v]) => v > 0 && batchCases(db, s, sku) !== undefined);
}

/**
 * Дни событий месяца: в первый час событий месяца — сколько их, от и до записи сценария, и в какие рабочие дни с
 * сегодняшнего — разные, по ветви `commerce`. Сохранение посреди месяца — с первого же часа событий после загрузки.
 */
function drawMonth(db: ContentDb, s: PlantState, st: CommerceState, month: number) {
  const c = db.scenarios[s.scenario].commerce!;
  const cal = calOf(db, s);
  const today = momentOf(s.start, s.t).day;
  const days: number[] = [];
  for (let z = today; monthAt(s, (z - daysFromCivil(s.start)) * DAY) === month; z++) if (isWorkday(cal, z)) days.push(z);
  st.month = month;
  st.days = roll(s, 'commerce', r => {
    const n = Math.min(days.length, r.range(c.perMonth[0], c.perMonth[1]));
    // n разных дней: частичная перетасовка
    for (let i = 0; i < n; i++) {
      const j = i + r.int(days.length - i);
      [days[i], days[j]] = [days[j], days[i]];
    }
    return days.slice(0, n).sort((a, b) => a - b);
  });
}

/** Состояние событий: заводится с первым часом событий у сценария с записью `commerce`. */
export function commerceOf(s: PlantState): CommerceState {
  return (s.commerce ??= { month: -1, days: [], cut: {} });
}

/**
 * Каждый час: в 12:00 — дни событий нового месяца, а в рабочий день события — само событие. У сценария без записи
 * `commerce` или без плана — ничего.
 */
export function commerceHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  const sc = db.scenarios[s.scenario];
  const c = sc.commerce;
  if (!c || !sc.plan) return;
  const now = momentOf(s.start, s.t);
  if (now.sec !== EVENT_HOUR) return;
  const st = commerceOf(s);
  const month = monthAt(s, s.t);
  if (st.month !== month) drawMonth(db, s, st, month);
  if (!st.days.includes(now.day)) return;
  const customers = sc.customers.map(id => db.customers[id]).filter(x => planDemand(db, s, x).length > 0);
  if (customers.length === 0) return;
  const cal = calOf(db, s);
  const ev = roll(s, 'commerce', r => {
    const cus = r.weighted(customers, x => planDemand(db, s, x).reduce((a, [, v]) => a + v, 0));
    const [sku] = r.weighted(planDemand(db, s, cus), ([, v]) => v);
    const per = batchCases(db, s, sku)!;
    // серия ± size %: от (100 − size) % до (100 + size) % ящиков серии, хоть один ящик
    const cases = Math.max(1, Math.floor((per * (100 - c.size + r.int(2 * c.size + 1))) / 100));
    const big = r.int(100) < c.big;
    const dueDay = big ? workdayOnOrAfter(cal, now.day + r.range(c.due[0], c.due[1])) : 0;
    return { cus, sku, cases, big, dueDay };
  });
  if (ev.big) {
    const o: Order = {
      id: nextId(s, 'O'),
      customer: ev.cus.id,
      lines: [{ sku: ev.sku, cases: ev.cases, reserved: 0, shipped: 0 }],
      placed: s.t,
      due: (ev.dueDay - daysFromCivil(s.start)) * DAY + TRUCK_HOUR,
      minShelf: ev.cus.minShelf,
      status: 'open',
      cases: [],
      units: [],
      big: true,
    };
    s.orders[o.id] = o;
    addDemand(s, ev.sku, ev.cases);
    notices.push({ kind: 'bigOrder', order: o.id, customer: ev.cus.id, sku: ev.sku, cases: ev.cases, due: o.due });
    note(s, 'sales', { kind: 'bigOrder', order: o.id, customer: ev.cus.id, sku: ev.sku, cases: ev.cases, due: o.due });
    return;
  }
  const row = (st.cut[ev.cus.id] ??= {});
  row[ev.sku] = (row[ev.sku] ?? 0) + ev.cases;
  notices.push({ kind: 'demandCut', customer: ev.cus.id, sku: ev.sku, cases: ev.cases });
  note(s, 'sales', { kind: 'demandCut', customer: ev.cus.id, sku: ev.sku, cases: ev.cases });
}

/**
 * Снятый спрос в новом заказе покупателя (вызывает рынок): из `drawn` ящиков позиции покупатель не возьмёт столько,
 * сколько ещё снято, — ящиков в заказе.
 */
export function cutOrder(s: PlantState, customer: Id, sku: Id, drawn: number): number {
  const row = s.commerce?.cut[customer];
  const cut = row?.[sku] ?? 0;
  if (cut <= 0 || drawn <= 0) return drawn;
  const take = Math.min(cut, drawn);
  if (cut - take > 0) row![sku] = cut - take;
  else delete row![sku];
  return drawn - take;
}
