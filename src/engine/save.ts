// Сохранение — снимок состояния со схемой и цепочкой миграций (ADR студии 0004; docs/02-architecture.md, §13). Забытая
// миграция стирает игру человека, поэтому каждый шаг закреплён образцом в tools/test/fixtures/.
import { SCHEMA, type PlantState } from './types';

/** Шаг миграции: снимок схемы N → снимок схемы N + 1. Индекс — схема, из которой шаг ведёт. */
const STEPS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export function toSave(s: PlantState): string {
  return JSON.stringify(s);
}

export function fromSave(json: string): PlantState {
  let raw = JSON.parse(json) as Record<string, unknown>;
  let v = raw.schema;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error('save: no schema');
  if (v > SCHEMA) throw new Error(`save: schema ${v} is newer than ${SCHEMA}`);
  while (v < SCHEMA) {
    const step = STEPS[v];
    if (!step) throw new Error(`save: no migration from schema ${v}`);
    raw = step(raw);
    v++;
    raw.schema = v;
  }
  return raw as unknown as PlantState;
}
