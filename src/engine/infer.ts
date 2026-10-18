// из anamnez: src/engine/med/infer.ts @ 1581ec7 — изменено: версии расследования вместо болезней, шаги расследования
// вместо обследований, улики вместо признаков; без сочетаний скрытых параметров, неизвестного, профосмотра и
// запоминания — у завода пять версий и дюжина улик (docs/specs/2026-10-investigation.md, «Вывод — копия «Анамнеза»»).
// Уверенность так, как её считал бы идеальный специалист на месте игрока, — только по открытому. Нужна коллеге качества,
// доске и разбору.
//
// По пользе шага решает коллега качества — а это меняет состояние завода, поэтому логарифм здесь свой, из `core/math.ts`
// (docs/02-architecture.md, §4): одинаковый в Bun и V8.
import type { InvModel } from '../content/types';
import { log2 } from './core/math';
import { P_ONE } from './core/rng';

/** Что шаг показал об улике: «есть» или «нет» (может быть ошибкой шага). */
export interface Observation {
  f: string;
  step: string;
  shown: boolean;
}

export interface Belief {
  id: string;
  p: number;
}

/**
 * P(улика есть | версия) — noisy-OR (`anamnez: docs/adr/0009-noisy-or-model.md`): версия независимо «пытается» вызвать
 * улику, ещё есть фон — то, что бывает и без неё.
 */
export function findingProbability(m: InvModel, f: string, c: string): number {
  const x = m.findings.find(y => y.id === f);
  if (!x) return 0;
  return 1 - (1 - x.leak / P_ONE) * (1 - (x.by[c] ?? 0) / P_ONE);
}

/** Чувствительность и специфичность, с которыми наблюдение получено: как шаг проверяет эту улику. */
function accuracy(m: InvModel, o: Observation): { sens: number; spec: number } {
  const check = m.steps.find(s => s.id === o.step)?.checks.find(c => c.f === o.f);
  return check ? { sens: check.sens / P_ONE, spec: check.spec / P_ONE } : { sens: 1, spec: 1 };
}

/** Наблюдения одной улики: насколько они вероятны, если она есть и если её нет, — от версии не зависит. */
interface Evidence {
  ifPresent: number;
  ifAbsent: number;
}

function evidenceOf(m: InvModel, obs: readonly Observation[]): Evidence {
  let ifPresent = 1;
  let ifAbsent = 1;
  for (const o of obs) {
    const { sens, spec } = accuracy(m, o);
    ifPresent *= o.shown ? sens : 1 - sens;
    ifAbsent *= o.shown ? 1 - spec : spec;
  }
  return { ifPresent, ifAbsent };
}

const mix = (e: Evidence, p: number) => p * e.ifPresent + (1 - p) * e.ifAbsent;

function byFinding(observations: readonly Observation[]): Map<string, Observation[]> {
  const out = new Map<string, Observation[]>();
  for (const o of observations) {
    const list = out.get(o.f);
    if (list) list.push(o);
    else out.set(o.f, [o]);
  }
  return out;
}

/**
 * Апостериорные вероятности версий. Предположение — одна причина (как у «Анамнеза» — одно основное заболевание).
 * Наблюдения собираются по улике: ошибки двух шагов независимы, только когда известно, есть ли улика на самом деле, поэтому
 * скрытое «есть/нет» суммируется один раз на улику — иначе два совпавших ответа об одной улике считались бы двумя уликами.
 */
export function posterior(m: InvModel, observations: readonly Observation[]): Belief[] {
  const grouped = [...byFinding(observations)].map(([f, obs]) => ({ f, e: evidenceOf(m, obs) }));
  const scored = m.candidates.map(c => {
    let w = c.prior / P_ONE;
    for (const { f, e } of grouped) {
      if (w === 0) break;
      w *= mix(e, findingProbability(m, f, c.id));
    }
    return { id: c.id, p: w };
  });
  const total = scored.reduce((a, b) => a + b.p, 0);
  return scored.map(b => ({ id: b.id, p: total > 0 ? b.p / total : 0 })).sort((a, b) => b.p - a.p || (a.id < b.id ? -1 : 1));
}

export function entropy(beliefs: readonly Belief[]): number {
  let h = 0;
  for (const b of beliefs) if (b.p > 0) h -= b.p * log2(b.p);
  return h;
}

/**
 * Ожидаемая польза шага в битах. Приближение среза, как у «Анамнеза»: сумма пользы каждой проверяемой улики по отдельности
 * при нынешних версиях; улики, о которых уже есть наблюдение, пользы не дают.
 */
export function expectedGain(m: InvModel, stepId: string, beliefs: readonly Belief[], observed: ReadonlySet<string>): number {
  const step = m.steps.find(s => s.id === stepId);
  if (!step) return 0;
  const h0 = entropy(beliefs);
  // версии с уверенностью ровно 0 ничего не прибавляют — их и не перебирать
  const live = beliefs.filter(b => b.p > 0);
  let gain = 0;
  for (const check of step.checks) {
    if (observed.has(check.f)) continue;
    const sens = check.sens / P_ONE;
    const fp = 1 - check.spec / P_ONE;
    const yes = live.map(b => {
      const p = findingProbability(m, check.f, b.id);
      return sens * p + fp * (1 - p);
    });
    let pYes = 0;
    live.forEach((b, i) => (pYes += b.p * yes[i]));
    const hGiven = (shown: boolean) => {
      const norm = shown ? pYes : 1 - pYes;
      if (norm <= 0) return 0;
      let h = 0;
      live.forEach((b, i) => {
        const p = (b.p * (shown ? yes[i] : 1 - yes[i])) / norm;
        if (p > 0) h -= p * log2(p);
      });
      return h;
    };
    gain += h0 - (pYes * hGiven(true) + (1 - pYes) * hGiven(false));
  }
  return Math.max(0, gain);
}

/**
 * Пользу сравниваем после округления: в ней логарифм, а его последний бит в разных движках может разниться. Разница
 * порядка 1e-16 не должна менять выбор коллеги (как у «Анамнеза», его `policy.ts`).
 */
export const quantize = (x: number) => Math.round(x * 1e9);
