// Двойник прогона плана (docs/specs/2026-10-plan-run.md, «Двойник не знает истины»): копия состояния забывает то, чего
// завод не знает, и разыгрывает это заново из того, что он знает, — истинные свойства партий и серий, причины, запас узлов
// до отказа, результат испытания до проверки вторым лицом, незаписанные заминки, следующую микроостановку. Ветви зерна —
// заново из номера зерна. Меняет только копию: его зовут на `structuredClone` состояния, а не на сам завод.
import { type Attr, type ContentDb, QUALITATIVE } from '../../content/types';
import { Rng } from '../core/rng';
import { lineRedraw } from '../line';
import { ONE_FAILURE } from '../maint';
import { clampAttr, stageRedraw } from '../mes';
import { attrsOf, lotProps } from '../quality';
import { expo, normal, roll, spread } from '../random';
import type { Batch, Lot, Notice, Part, PlantState } from '../types';

type Props = Partial<Record<Attr, number>>;
/** Измеренное значение свойства и погрешность методики. */
type Known = Partial<Record<Attr, { v: number; sd: number }>>;

/** Зерно прогона `k` — из зерна партии и номера: у двух вариантов при одном `k` одно и то же. */
export function seedOf(s: PlantState, k: number): number {
  return Rng.seeded(s.seed).fork(`plan/${k}`).u32();
}

/** Ветви зерна — заново: у каждой ветви — состояние из нового зерна и её имени, как у новой ветви в `roll`. */
function reseed(s: PlantState, seed: number) {
  s.seed = seed;
  for (const name of Object.keys(s.rng)) s.rng[name] = Rng.seeded(seed).fork(name).state();
}

/** МОК серии: по свойству — среднее замеров и погрешность методики. */
function ipcOf(db: ContentDb, b: Batch): Known {
  const sum = new Map<Attr, { n: number; v: number; sd: number }>();
  for (const rec of b.records) {
    for (const c of rec.ipc) {
      const m = db.tests[c.test];
      const x = sum.get(m.attr) ?? { n: 0, v: 0, sd: m.sd };
      x.n++;
      x.v += c.result;
      sum.set(m.attr, x);
    }
  }
  const out: Known = {};
  for (const [a, x] of sum) out[a] = { v: Math.round(x.v / x.n), sd: x.sd };
  return out;
}

/** Что завод измерил у партии: результаты испытаний, проверенные вторым лицом; у балка и ГП — сначала МОК их серии. */
function knownOf(db: ContentDb, s: PlantState, lot: Lot): Known {
  const out: Known = lot.batch && s.batches[lot.batch] ? ipcOf(db, s.batches[lot.batch]) : {};
  for (const id of (lot.sample ? s.samples[lot.sample]?.tests : undefined) ?? []) {
    const q = s.tests[id];
    if (q?.state !== 'done' || q.result === undefined) continue;
    const m = db.tests[q.method];
    out[m.attr] = { v: q.result, sd: m.sd };
  }
  return out;
}

/** Правдоподобное истинное рядом с измеренным: результат плюс погрешность методики; у качественного — сам результат. */
const near = (r: Rng, a: Attr, k: { v: number; sd: number }) => (QUALITATIVE.includes(a) || k.sd === 0 ? k.v : clampAttr(a, k.v + spread(k.sd, normal(r))));

/** Разброс серии без причин — то, что отличает её показатель от номинала карты (инвариант «номинал + разброс + вклады»). */
function noiseOf(db: ContentDb, b: Batch) {
  const q = db.recipes[b.recipe].quality;
  b.noise = {};
  for (const a of Object.keys(b.truth) as Attr[]) b.noise[a] = (b.truth[a] ?? 0) - (q[a]?.[0] ?? 0);
}

/**
 * Забыть истину на копии `s` и разыграть её заново для зерна `k` — из того, что завод знает. После этого прогон не читает
 * ничего, чего не знает завод: два завода, у которых различаются только истинные поля, дают один и тот же прогон.
 */
export function blind(db: ContentDb, s: PlantState, k: number) {
  reseed(s, seedOf(s, k));
  // партии поставщиков: измеренное — рядом с результатом, остальное — как у новой партии того же поставщика
  for (const lot of Object.values(s.lots)) {
    if (lot.batch) continue;
    const known = knownOf(db, s, lot);
    const prior = lotProps(db, s, lot.material, lot.supplier).truth;
    lot.truth = roll(s, `twin/${lot.id}`, r => {
      const t: Props = {};
      for (const a of attrsOf(db, lot.material)) t[a] = known[a] ? near(r, a, known[a]!) : (prior[a] ?? 0);
      return t;
    });
  }
  // серии: измеренное МОК — рядом со средним замеров, остальное — номинал карты с разбросом; причин двойник не знает
  for (const b of Object.values(s.batches)) {
    const q = db.recipes[b.recipe].quality;
    const known = ipcOf(db, b);
    b.truth = roll(s, `twin/${b.id}`, r => {
      const t: Props = {};
      for (const a of Object.keys(b.truth) as Attr[]) t[a] = known[a] ? near(r, a, known[a]!) : clampAttr(a, (q[a]?.[0] ?? 0) + spread(q[a]?.[1] ?? 0, normal(r)));
      return t;
    });
    b.causes = [];
    if (b.pack?.lost !== undefined) b.pack.lost = 0;
    noiseOf(db, b);
  }
  // балк и ГП: измеренное лабораторией — рядом с результатом, остальное — как у их серии в двойнике; серия — как её балк
  for (const lot of Object.values(s.lots)) {
    const b = lot.batch ? s.batches[lot.batch] : undefined;
    if (!b) continue;
    const known = knownOf(db, s, lot);
    lot.truth = roll(s, `twin/${lot.id}`, r => {
      const t: Props = {};
      for (const a of Object.keys(b.truth) as Attr[]) t[a] = known[a] ? near(r, a, known[a]!) : b.truth[a];
      return t;
    });
    if (lot.id === b.bulk) {
      b.truth = { ...lot.truth };
      noiseOf(db, b);
    }
  }
  // результат испытания, ещё не проверенный вторым лицом, — заново из истинного двойника
  for (const q of Object.values(s.tests)) {
    if (q.state !== 'review' || q.result === undefined) continue;
    const m = db.tests[q.method];
    const lot = s.lots[s.samples[q.sample].lot];
    q.result = roll(s, `twin/${q.id}`, r => (lot.truth[m.attr] ?? 0) + spread(m.sd, normal(r)));
  }
  // узлы: запас до отказа исправных — заново, без памяти; отказы в очереди идущей стадии и линии — по новому запасу
  const redraw = (pt: Part) => roll(s, `maint/${pt.id}`, r => expo(r, ONE_FAILURE));
  stageRedraw(db, s, redraw);
  const notices: Notice[] = [];
  for (const line of Object.values(s.lines)) lineRedraw(db, s, line, redraw, notices);
}
