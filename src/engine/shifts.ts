// Графики сменности (Б4б; docs/specs/2026-10-vertical-slice.md, «Б4б»; docs/10-domain.md, §2): рисунок сменного графика
// по циклу — сутки по кругу от дня отсчёта со сдвигом бригады, ночная смена кончается на следующие сутки — и правила
// закона на нём: не две смены подряд (ст. 103 ТК РФ, ч. 5), еженедельный непрерывный отдых не меньше 42 часов (ст. 110).
// Смена человека в день — по графику, в котором он в этот день (переводы), а у сменного по циклу — без дополнительных
// выходных: график не планирует сверхурочных, к концу каждого месяца часов по нему без праздничных — не больше нормы с
// начала учётного периода (Роструд; ст. 104). Одна функция для раздатчика, прогона расписания, линии, табеля и оплаты.
import type { ContentDb, Cycle, CycleDay, Id, Shift } from '../content/types';
import { civilFromDays, DAY, daysFromCivil, isHoliday, isShort, isWorkday, lastOfMonth, momentOf, normOf } from './core/calendar';
import { P_ONE } from './core/rng';
import type { Command, Notice, Person, PlantState } from './types';
import { calOf, type Clock, shiftTo, worksOn } from './workdays';

/** Сутки рисунка в день `z` (номер дня от 1970-01-01). */
export function cycleDay(c: Cycle, z: number): CycleDay {
  const n = c.pattern.length;
  return c.pattern[(((z - c.from - c.offset) % n) + n) % n];
}

/** Смена рисунка вида `d` в сутках, часы от их полуночи: [начало, конец); ночная кончается на следующие сутки. */
export function cycleSpan(c: Cycle, d: Exclude<CycleDay, 'off'>): [number, number] {
  const [a, b] = d === 'day' ? c.day : c.night;
  return [a, b > a ? b : b + 24];
}

/** Смены `n` кругов рисунка с сутками сдвига, часы от полуночи первых суток круга: [начало, конец). */
export function cycleHours(c: Cycle, n = 1): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < n * c.pattern.length; k++) {
    const d = c.pattern[k % c.pattern.length];
    if (d === 'off') continue;
    const [a, b] = cycleSpan(c, d);
    out.push([k * 24 + a, k * 24 + b]);
  }
  return out;
}

/** Еженедельный непрерывный отдых не короче, ч (ст. 110 ТК РФ). */
export const WEEK_REST = 42;

/**
 * Ошибки рисунка (Б4б, сборщик базы): смена, которая начинается не позже конца предыдущей, и на переходе круга тоже, —
 * две смены подряд (ст. 103, ч. 5); в любых семи сутках, с любого часа, нет непрерывного отдыха в 42 часа (ст. 110).
 */
export function cycleErrors(c: Cycle): string[] {
  const out: string[] = [];
  const len = c.pattern.length * 24;
  if (!c.pattern.includes('off')) out.push('в рисунке нет выходных');
  if (c.pattern.every(d => d === 'off')) return [...out, 'в рисунке нет смен'];
  // кругов — столько, чтобы любое окно в 7 суток с часа первого круга лежало внутри
  const rounds = Math.ceil((len + 7 * 24) / len) + 1;
  const spans = cycleHours(c, rounds);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i][0] <= spans[i - 1][1]) {
      out.push(`смена с ${spans[i][0] % 24}:00 ${Math.floor(spans[i][0] / 24) % c.pattern.length + 1}-х суток рисунка — сразу после предыдущей: две смены подряд`);
      break;
    }
  }
  for (let w = 0; w < len; w++) {
    let free = 0;
    let at = w;
    for (const [a, b] of spans) {
      if (b <= w) continue;
      if (a >= w + 7 * 24) break;
      free = Math.max(free, Math.max(0, a - at));
      at = Math.max(at, b);
    }
    free = Math.max(free, w + 7 * 24 - at);
    if (free < WEEK_REST) {
      out.push(`в семи сутках с ${w % 24}:00 ${Math.floor(w / 24) + 1}-х суток рисунка непрерывный отдых — ${free} ч, меньше ${WEEK_REST}`);
      break;
    }
  }
  return out;
}

/** Длительности смен графика, с: у пятидневки — смена по графику (накануне праздника она на час короче), у сменного по
 * циклу — дневная и ночная, какие есть в рисунке. */
export function shiftLengths(sh: Shift): number[] {
  const c = sh.cycle;
  if (!c) return [(sh.to - sh.from) * 3600];
  const kinds = new Set(c.pattern.filter((d): d is Exclude<CycleDay, 'off'> => d !== 'off'));
  return [...kinds].map(d => {
    const [a, b] = cycleSpan(c, d);
    return (b - a) * 3600;
  });
}

// ---------------------------------------------------------------- смена человека

/** Графики человека: запись, с какого дня он в каком графике. */
type Rostered = Pick<Person, 'shift' | 'roster'>;

/** График человека в день `z` (номер дня от 1970-01-01): запись, начатая не позже; без записей — его график. */
export function scheduleOn(p: Rostered, z: number): Id {
  const r = p.roster;
  if (!r) return p.shift;
  for (let i = r.length - 1; i > 0; i--) if (r[i].from <= z) return r[i].shift;
  return r[0].shift;
}

/** День, с которого человек в графике дня `z`; с начала завода — его день. */
export function sinceOn(s: Clock, p: Rostered, z: number): number {
  const r = p.roster;
  const start = daysFromCivil(s.start);
  if (r) for (let i = r.length - 1; i > 0; i--) if (r[i].from <= z) return r[i].from;
  return Math.max(start, r?.[0].from ?? start);
}

/** Смена графика `sh`, начатая в день `z`, — часы от полуночи этого дня, без людей: пятидневка — по календарю (Б4а). */
function rawHours(db: ContentDb, s: Clock, sh: Shift, z: number): [number, number] | undefined {
  const c = sh.cycle;
  if (c) {
    const d = cycleDay(c, z);
    return d === 'off' ? undefined : cycleSpan(c, d);
  }
  const cal = calOf(db, s);
  if (!worksOn(cal, sh, z)) return undefined;
  return [sh.from, shiftTo(db, s, cal, sh, z) / 3600];
}

/** Учётный период дня `z` (Б4б): первый и последний дни; периоды — по `account` месяцев от января. */
export function periodOf(db: ContentDb, s: Clock, z: number): [number, number] {
  const n = db.scenarios[s.scenario].account;
  const { y, m } = civilFromDays(z);
  const m0 = m - ((m - 1) % n);
  return [daysFromCivil({ y, m: m0, d: 1 }), lastOfMonth(y, m0 + n - 1)];
}

/** Норма часов дня по Порядку 588н, с: рабочий день пятидневки — `day`, накануне праздника — на `short` меньше. */
export function dayNorm(db: ContentDb, s: Clock, z: number): number {
  const cal = calOf(db, s);
  if (!isWorkday(cal, z)) return 0;
  const c = db.profiles[db.scenarios[s.scenario].profile].calendar;
  return c.day - (isShort(cal, z) ? c.short : 0);
}

const offMemo = new WeakMap<ContentDb, Map<string, ReadonlySet<number>>>();

/**
 * Дни, с которых у сменного по циклу графика `id` снята смена (Б4б): кто пришёл в него в день `base` из графика `prev`
 * (тот же — продолжает) и в нём до конца учётного периода. Первая смена, которая начинается не позже конца последней
 * смены прежнего графика, — две смены подряд (ст. 103, ч. 5). Дополнительные выходные: к концу каждого месяца часы
 * смен без праздничных — не больше нормы дней с `base`; лишнее — целыми сменами, равномерно по месяцу, среди смен без
 * праздничных часов, которые кончаются в этом же месяце. Часы — своим календарным дням, как в табеле.
 */
export function offDays(db: ContentDb, s: Clock, id: Id, base: number, prev: Id): ReadonlySet<number> {
  let memo = offMemo.get(db);
  if (!memo) offMemo.set(db, (memo = new Map()));
  const key = `${s.scenario}|${id}|${base}|${prev}`;
  const got = memo.get(key);
  if (got) return got;
  const sh = db.shifts[id];
  const c = sh.cycle!;
  const cal = calOf(db, s);
  const out = new Set<number>();
  const carry = rawHours(db, s, db.shifts[prev], base - 1);
  if (prev !== id) {
    const first = rawHours(db, s, sh, base);
    if (first && carry && carry[1] - 24 >= first[0]) out.add(base);
  }
  const [, last] = periodOf(db, s, base);
  let planned = 0;
  let norm = 0;
  for (let m0 = base; m0 <= last; ) {
    const { y, m } = civilFromDays(m0);
    const m1 = Math.min(lastOfMonth(y, m), last);
    for (let z = m0; z <= m1; z++) norm += dayNorm(db, s, z);
    const cands: number[] = [];
    for (let z = m0 - 1; z <= m1; z++) {
      let span: [number, number] | undefined;
      if (z < base) span = z === base - 1 ? carry : undefined;
      else if (!out.has(z)) span = rawHours(db, s, sh, z);
      if (!span) continue;
      let whole = true;
      let hol = false;
      for (let h = span[0]; h < span[1]; ) {
        const day = z + Math.floor(h / 24);
        const end = Math.min(span[1], (Math.floor(h / 24) + 1) * 24);
        if (day < m0 || day > m1) whole = false;
        else if (isHoliday(cal, day)) hol = true;
        else planned += (end - h) * 3600;
        h = end;
      }
      if (z >= m0 && z >= base && whole && !hol) cands.push(z);
    }
    if (planned > norm && cands.length > 0) {
      const len = (z: number) => {
        const [a, b] = rawHours(db, s, sh, z)!;
        return (b - a) * 3600;
      };
      let k = Math.min(cands.length, Math.ceil((planned - norm) / len(cands[0])));
      // длины смен рисунка могут различаться: добирать, пока лишнее не снято
      for (;;) {
        const pick = Array.from({ length: k }, (_, j) => cands[Math.floor(((2 * j + 1) * cands.length) / (2 * k))]);
        const cut = pick.reduce((n, z) => n + len(z), 0);
        if (planned - cut <= norm || k === cands.length) {
          for (const z of pick) out.add(z);
          planned -= cut;
          break;
        }
        k++;
      }
    }
    m0 = m1 + 1;
  }
  memo.set(key, out);
  return out;
}

/**
 * Смена человека, начатая в день `z`, — мгновения [с, по) от полуночи дня начала завода; в этот день смены нет —
 * `undefined`. График — с переводами; у сменного по циклу — без дополнительных выходных; первая смена нового графика,
 * которая начинается не позже конца последней смены прежнего, снята (две смены подряд).
 */
export function spanOn(db: ContentDb, s: Clock, p: Rostered, z: number): [number, number] | undefined {
  const id = scheduleOn(p, z);
  const sh = db.shifts[id];
  const h = rawHours(db, s, sh, z);
  if (!h) return undefined;
  const since = sinceOn(s, p, z);
  if (sh.cycle) {
    const base = Math.max(periodOf(db, s, z)[0], since);
    const prev = base > since ? id : scheduleOn(p, base - 1);
    if (offDays(db, s, id, base, prev).has(z)) return undefined;
  } else if (z === since && p.roster && scheduleOn(p, z - 1) !== id) {
    const before = spanOn(db, s, p, z - 1);
    const at = (z - daysFromCivil(s.start)) * DAY;
    if (before && before[1] >= at + h[0] * 3600) return undefined;
  }
  const at = (z - daysFromCivil(s.start)) * DAY;
  return [at + h[0] * 3600, at + Math.round(h[1] * 3600)];
}

/** Смена человека, в которой мгновение `t`: её начало, конец и график; вне смены — `undefined`. */
export function shiftAt(db: ContentDb, s: Clock, p: Rostered, t: number): { from: number; to: number; shift: Id } | undefined {
  const day = daysFromCivil(s.start) + Math.floor(t / DAY);
  // смена вчерашнего дня ещё идёт — только ночная, у сменного по циклу
  if (db.shifts[scheduleOn(p, day - 1)].cycle) {
    const y = spanOn(db, s, p, day - 1);
    if (y && t >= y[0] && t < y[1]) return { from: y[0], to: y[1], shift: scheduleOn(p, day - 1) };
  }
  const x = spanOn(db, s, p, day);
  return x && t >= x[0] && t < x[1] ? { from: x[0], to: x[1], shift: scheduleOn(p, day) } : undefined;
}

// ---------------------------------------------------------------- переводы и учётный период

/**
 * День, с которого вступает в силу перевод, отданный в день `z` (Б4б): график сменности доводят до работника не позже
 * чем за месяц (ст. 103, ч. 4), графики — помесячные: 1-е число месяца, до которого не меньше месяца.
 */
export function rosterFrom(z: number): number {
  const { y, m, d } = civilFromDays(z);
  const k = d === 1 ? 1 : 2;
  return daysFromCivil({ y: y + Math.floor((m - 1 + k) / 12), m: ((m - 1 + k) % 12) + 1, d: 1 });
}

/** Ждущий перевод человека — запись в будущем: график и день; нет — `undefined`. */
export function pendingOf(s: PlantState, p: Person): { shift: Id; from: number } | undefined {
  const r = p.roster;
  const last = r && r.length > 1 ? r[r.length - 1] : undefined;
  return last && last.from > momentOf(s.start, s.t).day ? last : undefined;
}

/**
 * Команда «перевести на график» (Б4б): с 1-го числа месяца, до которого не меньше месяца; ждущий перевод она заменяет, а
 * график, в котором человек и так будет, — отменяет его. Согласие работника в игре есть всегда (ст. 72; гипотеза до
 * настроения, §8.2).
 */
export function rosterCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'roster' }>, notices: Notice[]) {
  const p = s.people[cmd.person];
  if (!p) return notices.push({ kind: 'refused', cmd: 'roster', why: 'noPerson', detail: cmd.person });
  if (!db.shifts[cmd.shift]) return notices.push({ kind: 'refused', cmd: 'roster', why: 'noShift', detail: cmd.shift });
  const today = momentOf(s.start, s.t).day;
  const r = (p.roster ??= [{ shift: p.shift, from: daysFromCivil(s.start) }]);
  const pending = pendingOf(s, p);
  if (pending) r.pop();
  if (r[r.length - 1].shift === cmd.shift) {
    if (!pending) notices.push({ kind: 'refused', cmd: 'roster', why: 'same', detail: cmd.shift });
    else notices.push({ kind: 'rostered', person: p.id, role: p.role, tab: p.tab, shift: cmd.shift, from: pending.from, cancel: true });
  } else {
    const from = rosterFrom(today);
    r.push({ shift: cmd.shift, from });
    notices.push({ kind: 'rostered', person: p.id, role: p.role, tab: p.tab, shift: cmd.shift, from });
  }
  if (r.length === 1 && r[0].from <= daysFromCivil(s.start)) delete p.roster;
}

/** Первое мгновение учётного периода дня `z` (Б4б): с него считают работу после смен. */
function periodStart(db: ContentDb, s: PlantState, z: number): number {
  return (periodOf(db, s, z)[0] - daysFromCivil(s.start)) * DAY;
}

/**
 * Работа после конца смены (Б4б, hours.ts `endTask`): если смена — сменного по циклу графика, отрезок идёт в учётный
 * период — не раньше его начала (что было раньше, посчитал итог прошлого периода).
 */
export function saAfter(db: ContentDb, s: PlantState, p: Person, until: number, to: number) {
  const at = shiftAt(db, s, p, until - 1);
  if (!at || !db.shifts[at.shift].cycle) return;
  const z = daysFromCivil(s.start) + Math.floor((to - 1) / DAY);
  const sa = (p.sa ??= { from: periodStart(db, s, z), segs: [] });
  const a = Math.max(until, sa.from);
  if (to > a) sa.segs.push([a, to]);
}

/** Сверхурочные учётного периода: первые часы дня — по первой ставке, дальше по второй (ст. 152, ч. 1). */
export interface SaResult {
  over: number;
  pay: number;
  back: number;
}

/**
 * Итог учётного периода `from`–`last` человека (Б4б; ст. 99, ч. 1; ст. 104; `mintrud-6854`): дни в сменном по циклу
 * графике; отработано без праздничных — смены по графику и работа после смен в эти дни — минус норма этих дней —
 * сверхурочные. Их часы — последние часы после смен, по дням: первые часы дня — по первой ставке, дальше — по второй;
 * ставка — оклад на норму месяца дня (Б4а). Работа после смен шла в счёт года сразу; что не стало сверхурочными
 * (праздничные часы — РВ, ст. 152, ч. 3; по графику вышло меньше нормы), — `back`. В периоде нет таких дней — `undefined`.
 */
export function saResult(db: ContentDb, s: PlantState, p: Person, from: number, last: number, now: number): SaResult | undefined {
  const base = daysFromCivil(s.start);
  // до начала завода дней периода нет
  const first = Math.max(from, base);
  const cal = calOf(db, s);
  const sa = (z: number) => !!db.shifts[scheduleOn(p, z)].cycle;
  let norm = 0;
  let any = false;
  for (let z = first; z <= last; z++) {
    if (!sa(z)) continue;
    any = true;
    norm += dayNorm(db, s, z);
  }
  if (!any) return undefined;
  const t0 = (first - base) * DAY;
  const t1 = Math.min(now, (last + 1 - base) * DAY);
  /** части отрезка [a, b) по календарным дням периода: день и секунды */
  const pieces = (a: number, b: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let x = Math.max(a, t0); x < Math.min(b, t1); ) {
      const d = Math.floor(x / DAY);
      const y = Math.min(b, t1, (d + 1) * DAY);
      out.push([base + d, y - x]);
      x = y;
    }
    return out;
  };
  let worked = 0;
  for (let z = first - 1; z <= last; z++) {
    const span = spanOn(db, s, p, z);
    if (span) for (const [d, sec] of pieces(span[0], span[1])) if (sa(d) && !isHoliday(cal, d)) worked += sec;
  }
  const segs = [...(p.sa?.segs ?? []), ...(p.until !== undefined && now > p.until ? [[p.until, now] as [number, number]] : [])];
  let all = 0;
  const after: [number, number][] = [];
  for (const [a, b] of segs)
    for (const [d, sec] of pieces(a, b)) {
      all += sec;
      if (sa(d) && !isHoliday(cal, d)) after.push([d, sec]);
    }
  worked += after.reduce((n, x) => n + x[1], 0);
  const over = Math.max(0, worked - norm);
  // часы сверхурочных — последние часы после смен, по дням; не хватило (по графику вышло больше нормы) — последнему дню
  const byDay = new Map<number, number>();
  let left = over;
  for (let i = after.length - 1; i >= 0 && left > 0; i--) {
    const take = Math.min(left, after[i][1]);
    byDay.set(after[i][0], (byDay.get(after[i][0]) ?? 0) + take);
    left -= take;
  }
  if (left > 0) byDay.set(last, (byDay.get(last) ?? 0) + left);
  const pr = db.profiles[db.scenarios[s.scenario].profile];
  const ot = pr.payroll.overtime;
  const salary = db.roles[p.role].salary;
  let pay = 0;
  for (const [d, sec] of byDay) {
    const { y, m } = civilFromDays(d);
    const mn = normOf(cal, y, m, pr.calendar.day, pr.calendar.short);
    if (mn <= 0) continue;
    const rate = (x: number, k: number) => Math.floor((Math.floor((salary * x) / mn) * k) / P_ONE);
    const f = Math.min(sec, ot.first);
    pay += rate(f, ot.rates[0]) + rate(sec - f, ot.rates[1]);
  }
  return { over, pay, back: Math.max(0, all - over) };
}

/**
 * Полночь (Б4б): переводы, которые вступают в силу сегодня, — график человека; 1-го числа нового учётного периода — итог
 * прошлого у каждого, кто был в нём в сменном по циклу графике: сверхурочные — в зарплату второй половины последнего
 * месяца (cash.ts), что не стало сверхурочными, — обратно в остаток года; работа после смен — с нового периода.
 */
export function rosterDay(db: ContentDb, s: PlantState, z: number) {
  const [first] = periodOf(db, s, z);
  const end = first === z && z > daysFromCivil(s.start) ? periodOf(db, s, z - 1) : undefined;
  for (const p of Object.values(s.people)) {
    const now = p.roster?.find(x => x.from === z);
    if (now) p.shift = now.shift;
    if (!end) continue;
    const res = saResult(db, s, p, end[0], end[1], s.t);
    delete p.sa;
    // задача, взятая в смену прошлого периода и идущая сейчас: её часы до полуночи посчитаны в итоге
    if (p.until !== undefined && s.t > p.until && db.shifts[scheduleOn(p, z - 1)].cycle) p.sa = { from: s.t, segs: [] };
    if (!res) continue;
    const { y, m } = civilFromDays(end[1]);
    p.saDone = { y, m, over: res.over, pay: res.pay };
    if (p.otYear.y === y) p.otYear.sec = Math.max(0, p.otYear.sec - res.back);
  }
}
