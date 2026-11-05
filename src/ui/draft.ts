// Черновик расписания (docs/specs/2026-10-plan-run.md, «Черновик в расписании»; docs/02-architecture.md, §7): новые сроки
// «не раньше» заданий, которые игрок протянул в Ганте, — ещё не команды. Командами `shift` они станут, только когда игрок
// утвердит черновик. Чистые функции окна: движка здесь нет.
import type { Id } from '../content/types';
import type { Change } from '../engine/plan/schedule';
import type { Command } from '../engine/types';

/**
 * Срочное задание черновика (Б1г): позиция и карта плана выпуска. Командой `order` оно станет, когда игрок утвердит
 * черновик; «не раньше» — тогда же: комплектовка начнётся, как только будет весь комплект.
 */
export interface Urgent {
  recipe: Id;
  sku: Id;
  /** под заказ покупателя (Б6а): срок — срок заказа */
  for?: string;
}

/**
 * Отпустили задание: его строка черновика — новая или сменилась, порядок — порядок первых перетаскиваний. Вернули на
 * утверждённый срок `approved` — строка уходит: менять нечего.
 */
export function upsert(draft: readonly Change[], c: Change, approved?: number): Change[] {
  if (c.notBefore === approved) return draft.filter(x => x.batch !== c.batch);
  return draft.some(x => x.batch === c.batch) ? draft.map(x => (x.batch === c.batch ? c : x)) : [...draft, c];
}

/** Задания, которые тянуть уже нельзя (начали комплектовку или их нет), уходят из черновика сами; уходить некому — тот же. */
export function prune(draft: readonly Change[], gone: readonly string[]): readonly Change[] {
  return draft.some(x => gone.includes(x.batch)) ? draft.filter(x => !gone.includes(x.batch)) : draft;
}

/** Отмены черновика (Б6а): задание отметили «Отменить» — снова — отметку сняли; начатые уходят сами. */
export const toggleDrop = (drop: readonly string[], batch: string): string[] => (drop.includes(batch) ? drop.filter(x => x !== batch) : [...drop, batch]);
export const pruneDrop = (drop: readonly string[], gone: readonly string[]): readonly string[] => (drop.some(x => gone.includes(x)) ? drop.filter(x => !gone.includes(x)) : drop);

/** Утвердить отмены (Б6а): команды `cancel` по порядку отметок; от игрока. */
export function cancelsOf(drop: readonly string[]): Command[] {
  return drop.map(batch => ({ kind: 'cancel', batch, by: 'player' }));
}

/** Утвердить: команды `shift` по строкам черновика, по порядку; от игрока. */
export function commandsOf(draft: readonly Change[]): Command[] {
  return draft.map(c => ({ kind: 'shift', batch: c.batch, notBefore: c.notBefore, by: 'player' }));
}

/** Утвердить срочные задания (Б1г): команды `order` по порядку; от игрока, «не раньше» — сейчас. */
export function ordersOf(list: readonly Urgent[]): Command[] {
  return list.map(u => ({ kind: 'order', recipe: u.recipe, sku: u.sku, by: 'player', ...(u.for ? { for: u.for } : {}) }));
}

/** Ключ черновика для итога прогона: черновик изменился — итог говорит о прежнем. Без срочных заданий — как до Б1г. */
export const draftKey = (draft: readonly Change[], urgent: readonly Urgent[], drop: readonly string[] = []): string =>
  JSON.stringify(drop.length > 0 ? [draft, urgent, drop] : urgent.length > 0 ? [draft, urgent] : draft);
