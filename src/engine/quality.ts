// Свойства партий и результаты испытаний (docs/specs/2026-10-engine.md, 1б; геймдизайн, §4.2, §6.1). Истинные свойства
// рождаются с партией и живут только в движке; лаборатория видит пробу и прибор: результат = истинное + погрешность
// методики × нормальная величина. Значения — доли 1/10 000 (src/content/types.ts, `Attr`).
import { type Attr, type ContentDb, type Id, QUALITATIVE, type SpecLine } from '../content/types';
import { P_ONE } from './core/rng';
import { normal, roll, spread } from './random';
import type { PlantState } from './types';

export type Props = Partial<Record<Attr, number>>;

/** Какие свойства есть у партии материала: испытываемые спецификацией и заданные средним. */
export function attrsOf(db: ContentDb, material: Id): Attr[] {
  const m = db.materials[material];
  const out = new Set<Attr>();
  for (const line of db.specs[m.spec].tests) out.add(db.tests[line.test].attr);
  for (const a of Object.keys(m.props) as Attr[]) out.add(a);
  return [...out];
}

/** Номинальные свойства: средние; качественные — «соответствует». */
export function nominal(db: ContentDb, material: Id): Props {
  const m = db.materials[material];
  const out: Props = {};
  for (const a of attrsOf(db, material)) out[a] = QUALITATIVE.includes(a) ? P_ONE : (m.props[a]?.[0] ?? 0);
  return out;
}

const clamp = (v: number) => Math.max(0, Math.min(P_ONE, v));

/**
 * Свойства новой партии из ветви `lots/<поставщик>`: истинные — среднее + разброс между партиями; с долей брака
 * поставщика — партия брака, у неё одно свойство сдвинуто (у качественного — «не соответствует»). Паспорт — те же
 * свойства без брака: изготовитель его не заметил (упрощение прототипа).
 */
export function lotProps(db: ContentDb, s: PlantState, material: Id, supplier: Id): { truth: Props; coa: Props } {
  const m = db.materials[material];
  const defects = db.suppliers[supplier]?.defects ?? 0;
  return roll(s, `lots/${supplier}`, r => {
    const truth: Props = {};
    for (const a of attrsOf(db, material)) {
      const p = m.props[a];
      truth[a] = QUALITATIVE.includes(a) ? P_ONE : p ? clamp(p[0] + spread(p[1], normal(r))) : 0;
    }
    const coa = { ...truth };
    if (m.bad && defects > 0 && r.chance(defects)) {
      const a = m.bad.attr;
      truth[a] = m.bad.shift === undefined ? 0 : clamp((truth[a] ?? 0) + m.bad.shift);
    }
    return { truth, coa };
  });
}

/** Результат испытания: истинное + СКО методики × нормальная величина из ветви `branch` (свой прибор — своя ветвь). */
export function measure(s: PlantState, branch: string, truth: number, sd: number): number {
  if (sd === 0) return truth;
  return roll(s, branch, r => truth + spread(sd, normal(r)));
}

/** В пределах ли строки спецификации. Без пределов — качественное свойство: «соответствует». */
export function within(line: SpecLine, result: number): boolean {
  if (line.min === undefined && line.max === undefined) return result === P_ONE;
  return (line.min === undefined || result >= line.min) && (line.max === undefined || result <= line.max);
}
