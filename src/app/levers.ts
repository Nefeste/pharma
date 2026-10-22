// Рычаги (Б1г; docs/specs/2026-10-vertical-slice.md, «Б1г», таблица «Что можно сделать»): у строки планёрки — одно-три
// решения и словами, что они изменят; решение чужого места — с подписью, чьё оно; рычаг, которого в игре ещё нет, —
// строка «будет в …»: игрок видит, куда растёт его власть. Чистые функции окна: по строке вида — список рычагов. Их
// проверяют тесты в Bun.
import type { Dept, Id, OvertimeMode, Scenario, SeatId } from '../content/types';
import { DEPT_SEAT } from '../engine/seats';
import type { HeldRow, MainLoss, PendingDev, RiskRow } from '../sim/report';

/**
 * Что будет: аналитик во вторую смену и графики (Б4б), найм (Б4в), стройка (Б7), политики продаж и классификация
 * отклонений с CAPA (Б5), план под спрос — S&OP (Б6); часть и слова — в src/i18n/.
 */
export const LATERS = ['analyst', 'schedules', 'hire', 'build', 'sales', 'sop', 'capa'] as const;
export type Later = (typeof LATERS)[number];

/**
 * Рычаг: расписание — сдвинуть задание на серию; лаборатория — «Поднять» пробу партии; политика отдела «Сверхурочные» —
 * «по потребности» (`on` — уже так); слой «Потоки — люди»; справочник на вкладке; срочное задание позиции; решение по
 * удержанной серии — карточка её ГП; оценка отклонения — его карточка; доска расследования; будет позже.
 */
export type Lever =
  | { k: 'gantt'; seat: SeatId }
  | { k: 'lab'; seat: SeatId }
  | { k: 'overtime'; dept: Dept; seat: SeatId; on: boolean }
  | { k: 'flows' }
  | { k: 'ref'; tab: 'people' | 'places' }
  | { k: 'urgent'; recipe: Id; sku: Id; seat: SeatId }
  | { k: 'batch'; unit: number; code: string; seat: SeatId }
  | { k: 'dev'; n: number; seat: SeatId }
  | { k: 'inv'; id: string; seat: SeatId }
  | { k: 'later'; what: Later };

const later = (...what: Later[]): Lever[] => what.map(w => ({ k: 'later', what: w }));

/**
 * Главная потеря суток: ждали «людей нет в смене» — расписание и лаборатория, будет аналитик во вторую смену и найм;
 * «нет часов» — политика отдела и расписание, будут графики и найм; «нет допуска» — матрица обучения; калибровка или
 * квалификация — «Места»; люди заняты — расписание и найм; техника, прибор, место, рампа — стройка. Люди много ходили —
 * слой «Потоки — люди», переставить пост — стройка; перевозки — стройка. Потеря линии — строка ведёт к её машине.
 */
export function mainLevers(m: MainLoss, policy: Record<Dept, OvertimeMode>): Lever[] {
  switch (m.k) {
    case 'wait':
      switch (m.cause) {
        case 'shift':
          return [{ k: 'gantt', seat: 'production' }, { k: 'lab', seat: 'quality' }, ...later('analyst', 'hire')];
        case 'hours':
          return [{ k: 'overtime', dept: m.dept, seat: DEPT_SEAT[m.dept], on: policy[m.dept] === 'need' }, { k: 'gantt', seat: 'production' }, ...later('schedules', 'hire')];
        case 'qual':
          return [{ k: 'ref', tab: 'people' }, ...later('hire')];
        case 'asset':
          return [{ k: 'ref', tab: 'places' }];
        case 'people':
          return [{ k: 'gantt', seat: 'production' }, ...later('hire')];
        default:
          return later('build');
      }
    case 'walk':
      return [{ k: 'flows' }, ...later('build')];
    case 'move':
      return later('build');
    case 'line':
      return [];
  }
}

/**
 * Заказ под угрозой: срочное задание на каждую позицию, которой не хватит, — по карте плана выпуска; решение по
 * удержанной серии той же позиции; ящики ещё в лаборатории или на решении — «Поднять» пробы балка; будут политики
 * продаж и S&OP.
 */
export function riskLevers(r: RiskRow, sc: Pick<Scenario, 'plan'>, held: readonly HeldRow[]): Lever[] {
  const out: Lever[] = [];
  for (const sku of r.short) {
    const it = sc.plan?.items.find(x => x.sku === sku);
    if (it) out.push({ k: 'urgent', recipe: it.recipe, sku, seat: 'production' });
  }
  for (const h of held) if (r.short.includes(h.sku) && h.unit !== undefined) out.push({ k: 'batch', unit: h.unit, code: h.code, seat: 'quality' });
  if (r.pending > 0) out.push({ k: 'lab', seat: 'quality' });
  return [...out, ...later('sales', 'sop')];
}

/** Отклонение: оценить в его карточке, а решает расследование — его доска; будут классификация и CAPA. */
export function devLevers(d: Pick<PendingDev, 'dev' | 'inv'>): Lever[] {
  return [d.inv ? { k: 'inv', id: d.inv, seat: 'quality' } : { k: 'dev', n: d.dev, seat: 'quality' }, ...later('capa')];
}

/** Удержанная серия: решение по ней — в карточке её ГП. */
export function heldLevers(h: HeldRow): Lever[] {
  return h.unit === undefined ? [] : [{ k: 'batch', unit: h.unit, code: h.code, seat: 'quality' }];
}

/** Чей рычаг: у кнопки — пост; слой, справочник и «будет позже» — ничьи. */
export const seatOf = (l: Lever): SeatId | undefined => ('seat' in l ? l.seat : undefined);
