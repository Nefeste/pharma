// Политики руководителей (Б5г; docs/specs/2026-10-vertical-slice.md, «Б5г»; геймдизайн, §8.5): числа и правила, по
// которым руководитель решает в свой час. С чего начинает завод — запись сценария; что задают и в каких пределах —
// `content/policies/` (гипотезы). Правило руководителя читает политику завода: пока игрок её не трогал, жизнь завода та же.
// Игрок меняет политику с поста отдела руководителя или директором — команда `policy`: с ближайшего часа правила, начатое
// не меняется; смена — запись журнала с прежним значением, открытые предложения руководителя устаревают. Сверхурочные
// (Б4а) — своё поле и своя команда `overtime`.
import type { ContentDb, Id, Policy, PolicyHead, Scenario, SeatId } from '../content/types';
import { staleHead } from './heads';
import { noteCmd, seatOf } from './journal';
import type { Command, Notice, PlantState, PoliciesState, PolicyValue } from './types';

/** Политики, которые читают правила движка. */
export const POL = {
  cover: 'pol.plan.cover',
  window: 'pol.plan.window',
  urgent: 'pol.plan.urgent',
  method: 'pol.plan.method',
  demand: 'pol.plan.demand',
  safety: 'pol.supply.safety',
  every: 'pol.supply.every',
  replace: 'pol.maint.replace',
  spare: 'pol.maint.spare',
  ahead: 'pol.maint.ahead',
  clean: 'pol.mes.clean',
  full: 'pol.wms.full',
  keep: 'pol.wms.keep',
  setpoints: 'pol.tech.setpoints',
  capa: 'pol.qa.capa',
  pairAhead: 'pol.qa.ahead',
} as const;

/** «Без»: кампаний нет; узел меняют после отказа. */
export const OFF = 'off';

export const newPolicies = (): PoliciesState => ({ v: {}, log: [] });

/** Ключ значения в состоянии: политика, а у своей у каждого узла или запчасти — ещё и вещь. */
export const policyKey = (policy: Id, of?: string) => (of ? `${policy}:${of}` : policy);

/** Руководитель политики по её номеру: `pol.<руководитель>.<что>` — так его знает и пост команды (seats.ts). */
export const policyHead = (policy: Id): PolicyHead | undefined => {
  const h = policy.split('.')[1];
  return h === 'plan' || h === 'supply' || h === 'maint' || h === 'mes' || h === 'wms' || h === 'tech' || h === 'qa' ? h : undefined;
};

/**
 * С чего начинает завод — запись сценария: запас позиций, окно спроса и кампании планирования; страховой запас и заказ
 * снабжения; порог замены узла (нет — после отказа) и уровень ЗИП запчасти; срок визита подрядчика; уборка после серии;
 * порог вывоза отклонённого; уставки при уходе с поста; с Б5е — CAPA по повтору и срок оценки пары у начальника ООК;
 * с Б6в — способ прогноза и откуда спрос правила задания, если у сценария есть прогноз.
 * Сценарий правила не задаёт — `undefined`: политики нет.
 */
export function policyDefault(db: ContentDb, sc: Scenario, policy: Id, of?: string): PolicyValue | undefined {
  switch (policy) {
    case POL.cover:
      return sc.plan?.cover;
    case POL.window:
      return sc.plan?.window;
    case POL.urgent:
      return sc.plan ? (sc.plan.urgent ?? OFF) : undefined;
    // прогноз продаж (Б6в): только у сценария с прогнозом
    case POL.method:
      return sc.forecast ? sc.plan?.method : undefined;
    case POL.demand:
      return sc.forecast ? sc.plan?.demand : undefined;
    case POL.safety:
      return sc.supply?.safety;
    case POL.every:
      return sc.supply?.every;
    case POL.replace:
      return of === undefined ? undefined : (sc.maint[of] ?? OFF);
    case POL.spare: {
      const r = of === undefined ? undefined : db.spares[of];
      return r ? [r.stock.min, r.stock.max] : undefined;
    }
    case POL.ahead:
      return sc.assets.ahead;
    case POL.clean:
      return sc.policies.clean;
    case POL.full:
      return sc.waste?.full;
    case POL.keep:
      return sc.waste?.keep;
    case POL.setpoints:
      return sc.policies.setpoints;
    case POL.capa:
      return sc.deviations.capa;
    case POL.pairAhead:
      return sc.partners.ahead;
  }
  return undefined;
}

/**
 * Значение политики сейчас: заданное игроком, иначе с записи сценария. В цепочке миграций шаги до схемы 35 видят завод
 * без политик (save.ts): там все — с записи сценария.
 */
export function policyOf(db: ContentDb, s: PlantState, policy: Id, of?: string): PolicyValue | undefined {
  return s.policies?.v[policyKey(policy, of)] ?? policyDefault(db, db.scenarios[s.scenario], policy, of);
}

/** Сутки, месяцы, порог износа или число политики; «без» — `undefined`. */
export function numOf(db: ContentDb, s: PlantState, policy: Id, of?: string): number | undefined {
  const v = policyOf(db, s, policy, of);
  return typeof v === 'number' ? v : undefined;
}

/** Пара чисел политики — уровень ЗИП «осталось — до» или доля мест «числитель — знаменатель». */
export function pairOf(db: ContentDb, s: PlantState, policy: Id, of?: string): [number, number] | undefined {
  const v = policyOf(db, s, policy, of);
  return Array.isArray(v) ? v : undefined;
}

/** Годится ли значение политике: в пределах и на шаге от нижнего; «без», если оно есть; из вариантов. */
export function fits(p: Policy, v: PolicyValue): boolean {
  switch (p.kind) {
    case 'days':
    case 'months':
    case 'wear':
    case 'count':
      if (v === OFF) return !!p.off;
      return typeof v === 'number' && Number.isInteger(v) && v >= p.min! && v <= p.max! && (v - p.min!) % p.step! === 0;
    case 'level':
      return Array.isArray(v) && Number.isInteger(v[0]) && Number.isInteger(v[1]) && v[0] >= p.min! && v[1] <= p.max! && v[0] < v[1];
    case 'choice':
      return typeof v === 'string' && p.options!.includes(v);
    case 'share':
      return Array.isArray(v) && p.shares!.some(x => x[0] === v[0] && x[1] === v[1]);
  }
}

/** Одно и то же значение. */
export const sameValue = (a: PolicyValue | undefined, b: PolicyValue | undefined) => JSON.stringify(a) === JSON.stringify(b);

/** Вещи политики «у каждого»: узлы машин завода или запчасти базы. */
export function eachOf(db: ContentDb, s: PlantState, p: Policy): string[] {
  if (p.each === 'part') return Object.keys(s.parts).sort();
  if (p.each === 'spare') return Object.keys(db.spares).sort();
  return [];
}

/**
 * Команда `policy` (Б5г): новое значение — с ближайшего часа правила; запись журнала «вы» с прежним; в историю политик —
 * когда и с какого места; открытые предложения руководителя устаревают — он посчитает заново. Отказы: такой политики нет, у неё нет
 * такой вещи или сценарий её не задаёт; значение вне пределов, не на шаге или не из вариантов; то же, что сейчас.
 */
export function policyCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'policy' }>, notices: Notice[]) {
  const p = db.policies[cmd.policy];
  const thing = cmd.of;
  if (!p || (p.each ? !thing || !eachOf(db, s, p).includes(thing) : thing !== undefined)) return notices.push({ kind: 'refused', cmd: 'policy', why: 'noPolicy', detail: cmd.policy });
  const from = policyOf(db, s, p.id, thing);
  if (from === undefined) return notices.push({ kind: 'refused', cmd: 'policy', why: 'noPolicy', detail: cmd.policy });
  if (!fits(p, cmd.value)) return notices.push({ kind: 'refused', cmd: 'policy', why: 'policyRange', detail: cmd.policy });
  if (sameValue(from, cmd.value)) return notices.push({ kind: 'refused', cmd: 'policy', why: 'policySame', detail: cmd.policy });
  const seat = seatOf(s, cmd);
  setPolicy(s, p, thing, from, cmd.value, notices, seat ? { seat } : {});
  noteCmd(s, cmd, { kind: 'policy', policy: p.id, ...(thing ? { of: thing } : {}), from, to: cmd.value });
}

/**
 * Задать политику (Б5г; с Б5е — и по CAPA): новое значение; в историю политик — когда, с какого места игрока или по
 * какой CAPA, прежнее и новое; открытые предложения руководителя устаревают; извещение. Значение проверяет тот, кто зовёт.
 */
export function setPolicy(s: PlantState, p: Policy, thing: string | undefined, from: PolicyValue, value: PolicyValue, notices: Notice[], mark: { seat?: SeatId; capa?: string }) {
  s.policies.v[policyKey(p.id, thing)] = value;
  s.policies.log.push({ policy: p.id, ...(thing ? { of: thing } : {}), t: s.t, ...(mark.seat ? { seat: mark.seat } : {}), ...(mark.capa ? { capa: mark.capa } : {}), from, to: value });
  staleHead(s, p.head);
  notices.push({ kind: 'policy', policy: p.id, ...(thing ? { of: thing } : {}), head: p.head });
}

/**
 * Что читает правило движка у каждой политики (Б5г): вид значения, «у каждого» и «без»; у выбора — варианты движка. Запись
 * `content/policies/` задаёт имя, пределы и шаг.
 */
const SHAPE: Record<string, Pick<Policy, 'kind' | 'each' | 'off' | 'options'>> = {
  [POL.cover]: { kind: 'days' },
  [POL.window]: { kind: 'days' },
  [POL.urgent]: { kind: 'days', off: true },
  [POL.method]: { kind: 'choice', options: ['best', 'last-year', 'ma', 'ses', 'holt', 'group'] },
  [POL.demand]: { kind: 'choice', options: ['orders', 'forecast'] },
  [POL.safety]: { kind: 'days' },
  [POL.every]: { kind: 'days' },
  [POL.replace]: { kind: 'wear', each: 'part', off: true },
  [POL.spare]: { kind: 'level', each: 'spare' },
  [POL.ahead]: { kind: 'days' },
  [POL.clean]: { kind: 'choice', options: ['minor', 'major'] },
  [POL.full]: { kind: 'share' },
  [POL.keep]: { kind: 'months' },
  [POL.setpoints]: { kind: 'choice', options: ['target', 'keep'] },
  [POL.capa]: { kind: 'count' },
  [POL.pairAhead]: { kind: 'days' },
};

/**
 * Ошибки базы (Б5г): у каждой политики движка — запись, и записи — только политики движка, с тем видом, вещью, «без» и
 * вариантами, что читает правило, и руководителем из номера; уровень ЗИП каждой запчасти и число сценария — в пределах
 * политики, на шаге и из вариантов: иначе завод начал бы с того, чего игрок сам задать не может.
 */
export function policyErrors(db: ContentDb): string[] {
  const out: string[] = [];
  for (const id of Object.keys(SHAPE)) if (!db.policies[id]) out.push(`политика ${id}: нет записи в content/policies/`);
  for (const p of Object.values(db.policies)) {
    const want = SHAPE[p.id];
    if (!want) {
      out.push(`политика ${p.id}: её не читает ни одно правило движка`);
      continue;
    }
    if (p.head !== policyHead(p.id)) out.push(`политика ${p.id}: руководитель ${p.head}, а по номеру — ${policyHead(p.id)}`);
    if (p.kind !== want.kind || p.each !== want.each || !!p.off !== !!want.off) out.push(`политика ${p.id}: правило читает ${want.kind}${want.each ? ` у каждого ${want.each}` : ''}${want.off ? ' или «без»' : ''}`);
    if (want.options && JSON.stringify(p.options) !== JSON.stringify(want.options)) out.push(`политика ${p.id}: варианты правила — ${want.options.join(', ')}`);
  }
  if (out.length > 0) return out;
  for (const sc of Object.values(db.scenarios))
    for (const p of Object.values(db.policies)) {
      const things = p.each === 'spare' ? Object.keys(db.spares) : p.each === 'part' ? Object.keys(sc.maint) : [undefined];
      for (const of of things) {
        const v = policyDefault(db, sc, p.id, of);
        if (v !== undefined && !fits(p, v)) out.push(`сценарий ${sc.id}: ${p.id}${of ? ` (${of})` : ''} = ${JSON.stringify(v)} — вне пределов политики`);
      }
    }
  return out;
}
