// Величины в единицах движка — словами с единицей, для панелей: свойства партий и серий, режимы стадий.
import { type Attr, ATTR_SCALE, ATTRS, PARAM_SCALE, type ParamUnit } from '../content/types';
import { num, T } from '../i18n';

/** Значение свойства в единицах движка — словами с единицей: «71,8 %», «62 Н», «612 мкм». */
export function attrText(a: Attr, v: number): string {
  const unit = ATTRS[a].unit;
  if (unit === 'qual') return num(v);
  return `${attrNum(a, v)} ${T.units[unit]}`;
}

/** Значение свойства в единицах движка — одним числом, без единицы: начало диапазона «97,0–103,0 %». */
export function attrNum(a: Attr, v: number): string {
  const unit = ATTRS[a].unit;
  if (unit === 'qual') return num(v);
  return num(v / ATTR_SCALE[unit], unit === 'pct' || unit === 'min' ? 1 : 0);
}

/** Режим стадии в единицах движка — словами с единицей: «17,7 мин», «13,0 кН». */
export function paramText(unit: ParamUnit, v: number): string {
  return `${paramNum(unit, v)} ${T.units[unit]}`;
}

/** Режим стадии в единицах движка — одним числом, без единицы: начало диапазона «120–180 об/мин». */
export function paramNum(unit: ParamUnit, v: number): string {
  return num(v / PARAM_SCALE[unit], unit === 'min' || unit === 'kN' ? 1 : 0);
}
