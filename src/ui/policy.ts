// Политики в окне (Б5г; docs/specs/2026-10-vertical-slice.md, «Б5г»): значение словами, пределы и шаг, вещь политики «у
// каждого», следующее значение на шаг и черновик — чистые правила окна «Политики» и журнала. Значение проверит движок
// заново (src/engine/policies.ts, `fits`): окно лишь не предлагает того, чего правило не примет.
import type { Dept, OvertimeMode, Policy } from '../content/types';
import type { Command, PolicyValue } from '../engine/types';
import { named, pctText, T } from '../i18n';
import { db } from './db';

/** «Без»: кампаний нет; узел меняют после отказа — как в движке. */
export const OFF = 'off';

/** Значение политики словами: сутки, месяцы, % ресурса, «без», уровень ЗИП, вариант, доля мест, число (Б5е). */
export function policyText(p: Policy | undefined, v: PolicyValue): string {
  if (!p) return Array.isArray(v) ? v.join('/') : String(v);
  if (v === OFF) return T.policies.off[p.id] ?? OFF;
  switch (p.kind) {
    case 'days':
      return T.policies.days(v as number);
    case 'months':
      return T.policies.months(v as number);
    case 'wear':
      return pctText(v as number);
    case 'level': {
      const [a, b] = v as [number, number];
      return T.policies.level(a, b);
    }
    case 'choice':
      return T.policies.options[v as string] ?? String(v);
    case 'share': {
      const [a, b] = v as [number, number];
      return T.policies.shares[`${a}/${b}`] ?? `${a}/${b}`;
    }
    case 'count':
      return T.policies.count(v as number);
  }
}

/** Пределы и шаг словами; у выбора и доли мест — пусто: их варианты — кнопки окна. */
export function rangeText(p: Policy): string {
  const at = (n: number) => policyText(p, n);
  const or = p.off ? ` ${T.policies.orOff(T.policies.off[p.id] ?? OFF)}` : '';
  if (p.kind === 'days' || p.kind === 'months' || p.kind === 'wear') return `${T.policies.range(at(p.min!), at(p.max!), p.kind === 'wear' ? pctText(p.step!) : p.kind === 'days' ? T.policies.days(p.step!) : T.policies.months(p.step!))}${or}`;
  if (p.kind === 'count') return T.policies.span(String(p.min), String(p.max));
  if (p.kind === 'level') return T.policies.span(String(p.min), String(p.max));
  return '';
}

/**
 * Следующее значение на шаг вниз (`-1`) или вверх: ниже нижнего у политики с «без» — «без», выше «без» — нижнее; за
 * пределами — нет. Только у суток, месяцев, износа и числа.
 */
export function stepValue(p: Policy, v: PolicyValue, dir: -1 | 1): PolicyValue | undefined {
  if (p.kind !== 'days' && p.kind !== 'months' && p.kind !== 'wear' && p.kind !== 'count') return undefined;
  if (v === OFF) return dir > 0 ? p.min : undefined;
  if (typeof v !== 'number') return undefined;
  const n = v + dir * p.step!;
  if (n < p.min!) return p.off ? OFF : undefined;
  return n > p.max! ? undefined : n;
}

/** Уровень ЗИП: «осталось» (`0`) или «до» (`1`) на единицу — в пределах политики и первое меньше второго; иначе нет. */
export function stepLevel(p: Policy, v: PolicyValue, i: 0 | 1, dir: -1 | 1): [number, number] | undefined {
  if (p.kind !== 'level' || !Array.isArray(v)) return undefined;
  const x: [number, number] = [v[0], v[1]];
  x[i] += dir;
  return x[0] >= p.min! && x[1] <= p.max! && x[0] < x[1] ? x : undefined;
}

/** Ключ черновика: политика и, у политики «у каждого», вещь — как в движке. */
export const draftKey = (policy: string, of?: string) => (of ? `${policy}:${of}` : policy);

/** Одно и то же значение. */
export const sameValue = (a: PolicyValue | undefined, b: PolicyValue | undefined) => JSON.stringify(a) === JSON.stringify(b);

/** Ключ черновика сверхурочных отдела (Б4а): та же команда `overtime`, место — окно политик. */
export const overtimeKey = (dept: Dept) => `overtime:${dept}`;

/** Команда черновика окна: политика руководителя или сверхурочные отдела. */
export type DraftCommand = Extract<Command, { kind: 'policy' }> | Extract<Command, { kind: 'overtime' }>;

/**
 * Черновик окна — команды по порядку ключей: `политика` или `политика:вещь` — команда `policy`; `overtime:отдел` —
 * команда `overtime`.
 */
export function draftCommands(draft: Readonly<Record<string, PolicyValue>>): DraftCommand[] {
  return Object.keys(draft)
    .sort()
    .map((key): DraftCommand => {
      const i = key.indexOf(':');
      const head = i < 0 ? key : key.slice(0, i);
      const of = i < 0 ? undefined : key.slice(i + 1);
      if (head === 'overtime') return { kind: 'overtime', dept: of as Dept, mode: draft[key] as OvertimeMode };
      return { kind: 'policy', policy: head, ...(of ? { of } : {}), value: draft[key] };
    });
}

/** Имя политики; у политики «у каждого» — с вещью: узел и машина, запчасть. */
export function policyName(p: Policy | undefined, id: string, thing?: { of?: string; machine?: string; part?: string }): string {
  const name = named(p?.name, id);
  if (!thing?.of) return name;
  if (p?.each === 'spare') return `${name} · ${named(db?.spares[thing.of]?.name, thing.of)}`;
  const rec = thing.machine ? (db?.equipment[thing.machine] ?? db?.machines[thing.machine]) : undefined;
  const part = named(rec?.parts.find(x => x.id === thing.part)?.name, thing.part ?? thing.of);
  return `${name} · ${part}${rec ? ` · ${named(rec.name, thing.machine)}` : ''}`;
}
