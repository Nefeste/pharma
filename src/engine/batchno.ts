// Номер серии `PPNNNMMYY` (docs/specs/2026-10-master-data.md, «Номер серии»; решения владельца 19.10.2026, #50, #51): код
// продукта, номер по порядку, месяц и год первого смешивания. С выдачи досье — короткий номер `PPNNN`, с начала
// смешивания — полный. Счёт — у каждого кода продукта: с 1 января и после 999 — снова с 001. Номер, который держит серия
// того же продукта до смешивания или со смешиванием в этом месяце, пропускается: так полный номер не повторяется никогда.
import type { ContentDb } from '../content/types';
import { momentOf } from './core/calendar';
import type { Batch, BatchNo, PlantState, Task } from './types';

/** Наибольший номер по порядку: дальше — снова с 001. */
export const NNN_MAX = 999;

/** Номер строкой: полный `PA0010927`, до смешивания — короткий `PA001`, до выдачи досье — пусто. */
export function batchNo(c: BatchNo): string {
  if (c.n === 0) return '';
  const short = `${c.pp}${String(c.n).padStart(3, '0')}`;
  return c.m === 0 ? short : `${short}${String(c.m).padStart(2, '0')}${String(c.y).padStart(2, '0')}`;
}

/** Знаки кода продукта по порядку: две буквы кода — число 0–1295. */
const SET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Номер одним целым — для среза (формат 6): ((код × 1000 + NNN) × 13 + месяц) × 100 + год; наибольшее — 1 684 799 999,
 * в `Int32Array` входит. Номера нет — −1.
 */
export function packNo(c: BatchNo): number {
  if (c.n === 0) return -1;
  const pp = SET.indexOf(c.pp[0]) * SET.length + SET.indexOf(c.pp[1]);
  return ((pp * 1000 + c.n) * 13 + c.m) * 100 + c.y;
}

/** Номер из целого среза; −1 — номера нет. */
export function unpackNo(v: number): BatchNo | undefined {
  if (v < 0) return undefined;
  const y = v % 100;
  const rest = Math.floor(v / 100);
  const m = rest % 13;
  const nn = Math.floor(rest / 13);
  const pp = Math.floor(nn / 1000);
  return { pp: SET[Math.floor(pp / SET.length)] + SET[pp % SET.length], n: nn % 1000, m, y };
}

/**
 * Номер по порядку для нового досье кода `pp` в момент `t`, без записи; заняты все — `undefined`: досье ждёт (запрет
 * владельца — больше 999 серий в месяц нельзя). Занят номер серии того же кода до смешивания и серии, смешанной в
 * месяце досье или позже: смешивание записывается, когда аппаратчиков назначили, с мгновением начала работы — оно может
 * прийтись на следующий месяц.
 */
export function freeNo(s: PlantState, pp: string, t: number): number | undefined {
  const at = momentOf(s.start, t).date;
  const month = (at.y % 100) * 100 + at.m;
  const held = new Set<number>();
  for (const b of Object.values(s.batches)) {
    const c = b.code;
    if (c.pp === pp && c.n > 0 && (c.m === 0 || c.y * 100 + c.m >= month)) held.add(c.n);
  }
  const last = s.batchNos[pp];
  let n = last && last.year === at.y ? last.n : 0;
  for (let k = 0; k < NNN_MAX; k++) {
    n = (n % NNN_MAX) + 1;
    if (!held.has(n)) return n;
  }
  return undefined;
}

/** Выдать досье: короткий номер серии и момент выдачи; номера нет — `false`, досье не выдано. */
export function issueNo(db: ContentDb, s: PlantState, b: Batch): boolean {
  const pp = db.products[b.product].code;
  const n = freeNo(s, pp, s.t);
  if (n === undefined) return false;
  s.batchNos[pp] = { year: momentOf(s.start, s.t).date.y, n };
  b.code = { pp, n, m: 0, y: 0 };
  b.issued = s.t;
  return true;
}

/** Аппаратчиков назначили на стадию: если это первое смешивание, к короткому номеру — месяц и год начала работы. */
export function mixStart(db: ContentDb, s: PlantState, t: Task) {
  const b = t.batch ? s.batches[t.batch] : undefined;
  if (!b || b.code.n === 0 || b.code.m !== 0 || !db.recipes[b.recipe].stages[b.stage]?.mix) return;
  const at = momentOf(s.start, t.times![1]).date;
  b.code.m = at.m;
  b.code.y = at.y % 100;
}
