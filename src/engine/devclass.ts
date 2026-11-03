// Класс и повтор отклонения (Б5е; docs/specs/2026-10-vertical-slice.md, «Б5е»; геймдизайн, §6.4): класс по определениям
// PI 040-1, перенесённым на отклонения (отраслевая практика); повтор — одно правило для класса, CAPA и показателя
// «повторяющиеся» (Б5ж): то же отклонение за 12 месяцев — та же подпись, а когда причина записана у обоих — та же
// причина; вероятная причина — причина базы, чей признак есть в записях завода (GMP ЕАЭС, ч. I, п. 1.4 (xiv)); срок по
// классу — процедура завода. Истины здесь нет: причины серии (`b.causes`) правило не читает — только досье стадий и
// записи узлов. Лёгкий модуль без зависимостей от правил завода: его читают производство, лаборатория, расследование,
// оценка, CAPA и показатели.
import type { CauseClass, ContentDb, DevClass } from '../content/types';
import { DAY } from './core/calendar';
import type { Deviation, PlantState } from './types';

/** Повтор — то же отклонение за столько (Б5ж, §8.6): 12 месяцев. */
export const REPEAT = 365 * DAY;

/** Номер по порядку: `D12` → 12. */
const seq = (id: string) => Number(id.slice(1));

/** Раньше ли отклонение `a`, чем `b`: по мгновению открытия, в одну минуту — по номеру. */
export const before = (a: Deviation, b: Deviation) => a.opened < b.opened || (a.opened === b.opened && seq(a.id) < seq(b.id));

/**
 * Класс при открытии (Б5е): результат вне спецификации, МОК вне пределов, режим вне диапазона и расхождение при сверке —
 * существенное: продукт может не соответствовать спецификации или досье, мера GMP не сработала; выход ниже тревожного —
 * незначительное (`pics-pi040`, перенос на отклонения — `gmpv-dev-2020`, отраслевая практика).
 */
export const openClass = (kind: Deviation['kind']): DevClass => (kind === 'yield' ? 'minor' : 'major');

/** Подпись отклонения для повтора: вид, стадия и то, что вне пределов, — режим, испытание МОК, материал или испытание. */
export const devSig = (d: Deviation) => `${d.kind}/${d.stage ?? ''}/${d.param ?? d.test ?? d.material ?? d.tests?.[0] ?? ''}`;

/** Причина для повтора: причина базы; «не установлена», ошибка лаборатории и партия поставщика — не она. */
export const causeKey = (d: Deviation): string | undefined => (d.cause?.startsWith('cause.') ? d.cause : undefined);

/** То же ли отклонение (Б5е): причина записана у обоих — та же причина, иначе — та же подпись. */
export function sameDev(a: Deviation, b: Deviation): boolean {
  const ka = causeKey(a);
  const kb = causeKey(b);
  return ka && kb ? ka === kb : devSig(a) === devSig(b);
}

/** Такие же отклонения за 12 месяцев до `d` вместе с ним — по порядку открытия. */
export function sameBefore(s: PlantState, d: Deviation): Deviation[] {
  return Object.values(s.deviations)
    .filter(x => (x === d || (before(x, d) && sameDev(x, d))) && d.opened - x.opened <= REPEAT)
    .sort((a, b) => (before(a, b) ? -1 : 1));
}

/**
 * Класс по правилу ООК (Б5е): при открытии — по виду; оценено «без влияния на качество» — незначительное; повтор за 12
 * месяцев поднимает незначительное до существенного, и после оценки «без влияния» тоже (фактор риска PI 040-1); выше
 * существенного правило не поднимает: «критическое» — продукт мог уйти пациенту, его ставит только игрок.
 */
export function ruleClass(s: PlantState, d: Deviation): DevClass {
  let c = openClass(d.kind);
  if (d.status === 'assessed' && d.assess?.verdict === 'none') c = 'minor';
  if (c === 'minor' && sameBefore(s, d).length > 1) c = 'major';
  return c;
}

/** Пересмотреть класс, когда узнали больше: заданный командой — остаётся. */
export function reclass(s: PlantState, d: Deviation) {
  if (!d.clsBy) d.cls = ruleClass(s, d);
}

/** Мгновение, когда кончается срок отклонения: от открытия — срок процедуры по его классу. */
export const dueOf = (db: ContentDb, s: PlantState, d: Deviation) => d.opened + db.scenarios[s.scenario].deviations.term[d.cls] * DAY;

/** Род причины: износ узла, режим, партия поставщика, ошибка лаборатории или «не установлена» — у сита и прочего. */
export function causeClass(db: ContentDb, cause: string | undefined): CauseClass {
  if (cause === 'lab') return 'lab';
  if (cause === 'lot') return 'lots';
  const dr = cause ? db.causes[cause]?.driver : undefined;
  if (!dr) return 'none';
  if ('wear' in dr) return 'wear';
  if ('lots' in dr || 'potency' in dr) return 'lots';
  if ('param' in dr) return 'param';
  return 'none';
}

/**
 * Причины с признаком в записях завода (Б5е): у режима вне диапазона — причина этого режима; у МОК вне пределов — причины,
 * что сдвигают показатель испытания: режим этой или прежней стадии вне диапазона карты по досье серии, износ узла стадии
 * не ниже порога процедуры по её записи. У выхода, сверки и результата вне спецификации признаков нет — у последнего
 * причину называет расследование. По порядку: режимы по стадиям, потом износ; в каждом — по номеру причины.
 */
export function signsOf(db: ContentDb, s: PlantState, d: Deviation): string[] {
  const b = d.batch ? s.batches[d.batch] : undefined;
  if (!b) return [];
  const causes = Object.values(db.causes).sort((x, y) => (x.id < y.id ? -1 : 1));
  if (d.kind === 'param') return causes.filter(c => 'param' in c.driver && c.driver.param === d.param).map(c => c.id);
  if (d.kind !== 'ipc' || !d.test) return [];
  const attr = db.tests[d.test].attr;
  const r = db.recipes[b.recipe];
  const upTo = r.stages.findIndex(st => st.id === d.stage);
  const moves = causes.filter(c => [...c.effects, ...(c.scatter ?? [])].some(e => e.attr === attr));
  const out: string[] = [];
  for (const c of moves) {
    const dr = c.driver;
    if (!('param' in dr)) continue;
    const hit = r.stages.slice(0, upTo + 1).some(st => {
      const p = st.params.find(x => x.id === dr.param);
      const rec = p && b.records.find(x => x.stage === st.id);
      const v = rec?.params[dr.param];
      return p !== undefined && v !== undefined && (v < p.range[0] || v > p.range[1]);
    });
    if (hit) out.push(c.id);
  }
  const rec = b.records.find(x => x.stage === d.stage);
  const at = db.scenarios[s.scenario].deviations.wear;
  for (const c of moves) {
    const dr = c.driver;
    if (!('wear' in dr) || !rec?.wear) continue;
    if (Object.entries(rec.wear).some(([k, w]) => w >= at && (s.parts[k]?.type ?? k.split('/').pop()) === dr.wear)) out.push(c.id);
  }
  return out;
}

/** Вероятная причина по правилу (GMP ЕАЭС, ч. I, п. 1.4 (xiv)): первая с признаком, нет — «не установлена». */
export const probable = (db: ContentDb, s: PlantState, d: Deviation): string => signsOf(db, s, d)[0] ?? 'none';
