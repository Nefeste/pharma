// Политики руководителей для окна (Б5г; docs/specs/2026-10-vertical-slice.md, «Б5г»): вкладки руководителей — сначала
// отделы взятых постов; у политики — значение сейчас, кто и когда её задал и сколько решений журнала за 30 суток её
// читали; у руководителя отдела — ещё сверхурочные его отделов (Б4а). Имена, пределы и шаг — запись базы, окно читает её
// само; данные — без слов. Истины здесь нет (docs/02-architecture.md, §9): политики — знание завода.
import { type ContentDb, DEPTS, type Dept, type Id, type OvertimeMode, type SeatId } from '../content/types';
import { DAY } from '../engine/core/calendar';
import { DEPT_HEAD, HEAD_SEAT } from '../engine/journal';
import { eachOf, policyKey, policyOf } from '../engine/policies';
import { held } from '../engine/seats';
import type { Decided, Head, PlantState, PolicyValue } from '../engine/types';

export interface PoliciesQuery {
  view: 'policies';
}

/** Руководители окна по порядку: с политиками и те, у кого только сверхурочные отделов. */
export const POLICY_HEADS: readonly Head[] = ['plan', 'supply', 'maint', 'mes', 'wms', 'tech', 'qc', 'qa'];

/** Сколько суток назад окно считает решения, которые читали политику. */
export const USED_DAYS = 30;

/**
 * Строка политики: какая и у какой вещи (узел — вид машины и узла, запчасть — её номер), значение сейчас; кто задал — когда
 * и с какого места игрока, нет — с записи сценария; решений руководителя за `USED_DAYS` суток, которые её читали, — у
 * правила, чьи решения журнал не пишет, нет.
 */
export interface PolicyRow {
  policy: Id;
  of?: string;
  machine?: Id;
  part?: Id;
  value: PolicyValue;
  /** кто задал: игрок с места; с Б5е — по CAPA: её номер и кто её выполнил */
  set?: { t: number; seat?: SeatId; capa?: number; by?: Head | 'player' };
  used?: number;
}

export interface PolicyTab {
  head: Head;
  seat: SeatId;
  rows: PolicyRow[];
  /** сверхурочные отделов этого руководителя (Б4а) */
  overtime: { dept: Dept; mode: OvertimeMode }[];
}

export interface PoliciesView {
  view: 'policies';
  tabs: PolicyTab[];
}

/**
 * Какие решения журнала читали политику: задания на серию — запас, окно спроса и, у кампании, «срочно»; заказы поставщику
 * — страховой запас и сколько суток; замена узла по наработке и заказ ЗИП — своей вещи; визит — срок предупреждения;
 * вывоз — доля мест или срок; уставки к цели; с Б5е — CAPA по повтору и оценка пары; с Б6в — спрос и, когда спрос по
 * прогнозу, способ прогноза. Уборку журнал не пишет.
 */
const READS: Record<string, (d: Decided, of?: string) => boolean> = {
  'pol.plan.cover': d => d.kind === 'order' && !!d.why && d.why.rule !== 'turn',
  'pol.plan.window': d => d.kind === 'order' && !!d.why && d.why.rule !== 'turn',
  'pol.plan.urgent': d => d.kind === 'order' && (d.why?.rule === 'campaign' || d.why?.rule === 'urgent'),
  // прогноз продаж (Б6в): спрос правила — и по заказам окна, и по прогнозу; способ прогноза — когда спрос по нему
  'pol.plan.demand': d => d.kind === 'order' && !!d.why && d.why.rule !== 'turn',
  'pol.plan.method': d => d.kind === 'order' && !!d.why?.fc,
  'pol.supply.safety': d => d.kind === 'po' && (d.why?.length ?? 0) > 0,
  'pol.supply.every': d => d.kind === 'po' && (d.why?.length ?? 0) > 0,
  'pol.maint.replace': (d, of) => d.kind === 'replace' && !!d.why && d.part === of,
  'pol.maint.spare': (d, of) => d.kind === 'spare' && d.spare === of,
  'pol.maint.ahead': d => d.kind === 'visit' && !!d.why,
  'pol.wms.full': d => d.kind === 'waste' && !!d.why && d.why.since === undefined,
  'pol.wms.keep': d => d.kind === 'waste' && !!d.why && d.why.since !== undefined,
  'pol.tech.setpoints': d => d.kind === 'targets',
  'pol.qa.capa': d => d.kind === 'capa' && d.why?.rule === 'repeat',
  'pol.qa.ahead': d => d.kind === 'pairEval',
};

/** Политики руководителей и сверхурочные отделов: вкладки по порядку — сначала руководители взятых постов. */
export function policiesView(db: ContentDb, s: PlantState): PoliciesView {
  const from = s.t - USED_DAYS * DAY;
  const recent = s.journal.filter(r => r.t >= from && r.by !== 'player');
  // последняя смена каждой политики у каждой вещи
  const last = new Map<string, NonNullable<PolicyRow['set']>>();
  for (const x of s.policies.log) {
    const c = x.capa ? s.capas[x.capa] : undefined;
    last.set(policyKey(x.policy, x.of), { t: x.t, ...(x.seat ? { seat: x.seat } : {}), ...(c ? { capa: Number(c.id.slice(1)), ...(c.doneBy ? { by: c.doneBy } : {}) } : {}) });
  }
  const rowOf = (policy: Id, of?: string): PolicyRow | undefined => {
    const value = policyOf(db, s, policy, of);
    if (value === undefined) return undefined;
    const pt = of ? s.parts[of] : undefined;
    const set = last.get(policyKey(policy, of));
    const reads = READS[policy];
    const head = db.policies[policy].head;
    return {
      policy,
      ...(of ? { of } : {}),
      ...(pt ? { machine: pt.of, part: pt.type } : {}),
      value,
      ...(set ? { set } : {}),
      ...(reads ? { used: recent.filter(r => r.by === head && reads(r.d, of)).length } : {}),
    };
  };
  const h = held(s) ?? [];
  const mine = (head: Head) => h.includes(HEAD_SEAT[head]);
  const order = [...POLICY_HEADS.filter(mine), ...POLICY_HEADS.filter(x => !mine(x))];
  const tabs = order.map((head): PolicyTab => {
    const rows: PolicyRow[] = [];
    for (const p of Object.values(db.policies)) {
      if (p.head !== head) continue;
      const things = p.each ? eachOf(db, s, p) : [undefined];
      for (const of of things) {
        const r = rowOf(p.id, of);
        if (r) rows.push(r);
      }
    }
    const overtime = DEPTS.filter(d => DEPT_HEAD[d] === head).map(dept => ({ dept, mode: s.policy[dept] }));
    return { head, seat: HEAD_SEAT[head], rows, overtime };
  });
  return { view: 'policies', tabs: tabs.filter(t => t.rows.length > 0 || t.overtime.length > 0) };
}
