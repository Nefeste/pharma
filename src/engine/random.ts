// Именованные ветви зерна в состоянии (docs/02-architecture.md, §4). Ветвь заводится не только на подсистему, но и на
// вещь: `maint/press-a/punches`, `market/customer-3/sku-12`. Новый бросок в одной ветви не сдвигает другие, поэтому
// изменение плана не перемешивает чужую случайность. На этом держится честное сравнение вариантов в прогоне плана (§11).
//
// Ветвь рождается из зерна партии и имени (`Rng.fork` ядра) и дальше живёт своим состоянием в `s.rng`.
import { Rng } from './core/rng';
import type { PlantState } from './types';

/** Бросок из ветви `name`: функция получает генератор ветви, состояние ветви сохраняется после. */
export function roll<T>(s: PlantState, name: string, f: (r: Rng) => T): T {
  const saved = s.rng[name];
  const r = saved ? Rng.fromState(saved) : Rng.seeded(s.seed).fork(name);
  const out = f(r);
  s.rng[name] = r.state();
  return out;
}
