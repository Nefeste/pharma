// Цели сценария для окна (Б9; docs/specs/2026-10-vertical-slice.md, «Б9»; геймдизайн, §15.1): цель, порог, что видно
// сейчас, выполнена ли; срок сценария. Числа — из записей завода (src/engine/goals.ts), истины тут нет
// (docs/02-architecture.md, §9). Слова — в окне.
import type { ContentDb, Goal } from '../content/types';
import { carryBlock, nextScenario } from '../engine/carry';
import { goalSpan, goalsNow } from '../engine/goals';
import type { PlantState } from '../engine/types';

export interface GoalsQuery {
  view: 'goals';
}

export interface GoalsView {
  view: 'goals';
  goals: { goal: Goal; v?: number; met: boolean }[];
  /** старт игрока и конец срока; `ended` — срок прошёл, числа — итог */
  from: number;
  to?: number;
  ended: boolean;
  /** следующий сценарий кампании (Б9, шаг 4) и почему перейти нельзя — срок идёт или следующий уже начался */
  next?: { id: string; block?: string };
}

export function goalsView(db: ContentDb, s: PlantState): GoalsView {
  const { from, to } = goalSpan(db, s);
  const nx = nextScenario(db, s.scenario);
  const block = nx ? carryBlock(db, s) : undefined;
  return { view: 'goals', ...goalsNow(db, s), from, ...(to !== undefined ? { to } : {}), ...(nx ? { next: { id: nx.id, ...(block ? { block } : {}) } } : {}) };
}
