// Хронический корень сценария (Д1; docs/specs/2026-11-fill.md, «Д1»): причина, которая живёт в заводе и повторяется у
// каждой серии, которую задевает, пока её не убрали, — а не след у одной серии, как происшествие части 4. Корень — по
// жребию зерна: смещение партий материала у изготовителя с дня сценария, привычка одного человека роли — факт режима
// сверх уставки — или обе у края. Корень скрыт: окно его не видит, двойник прогона плана забывает.
import type { ContentDb, RecipeStage } from '../content/types';
import { momentOf } from './core/calendar';
import { roll } from './random';
import type { Lot, PlantState, StageRecord } from './types';

/**
 * Корень на старте сценария: вид, день смещения (номер дня), сдвиг свойства в единицах движка, человек привычки и шагов
 * уставки сверх неё. Человек — из людей роли по табельному номеру; нет — привычки нет. `zero` — сутки сценария от начала
 * партии, с (у перехода кампании — позже, Б9, шаг 4).
 */
export function newChronic(db: ContentDb, s: PlantState, zero = 0) {
  const def = db.scenarios[s.scenario].chronic;
  if (!def) return;
  const root = roll(s, 'chronic/root', r => r.weightedKey(def.roots)) as NonNullable<PlantState['chronic']>['root'];
  const sh = root === 'both' ? def.both.shift : def.drift.shift;
  const st = root === 'both' ? def.both.steps : def.habit.steps;
  const shift = roll(s, 'chronic/shift', r => r.range(sh[0], sh[1]));
  const steps = roll(s, 'chronic/steps', r => r.range(st[0], st[1]));
  const people = Object.values(s.people).filter(p => p.role === def.habit.role).sort((a, b) => a.tab - b.tab);
  const person = people.length > 0 ? people[roll(s, 'chronic/person', r => r.int(people.length))].id : undefined;
  const sc = db.scenarios[s.scenario];
  const day = momentOf(s.start, zero + sc.warm).day + def.drift.day;
  s.chronic = { root, day, shift, steps, ...(person ? { person } : {}) };
}

/** Смещение у новой партии (корень `api` или `both`): материал и изготовитель корня, с его дня — свойство сдвинуто. */
export function driftLot(db: ContentDb, s: PlantState, lot: Lot) {
  const c = s.chronic;
  const def = db.scenarios[s.scenario].chronic;
  if (!c || !def || c.root === 'lube' || c.fixed !== undefined) return;
  const d = def.drift;
  if (lot.material !== d.material || lot.maker !== d.maker || momentOf(s.start, s.t).day < c.day) return;
  // паспорт показывает правду: изготовитель измерил свою партию (спецификация завода размер частиц не проверяет)
  lot.truth[d.attr] = (lot.truth[d.attr] ?? 0) + c.shift;
  if (lot.coa[d.attr] !== undefined) lot.coa[d.attr] = lot.coa[d.attr]! + c.shift;
}

/**
 * Привычка (корень `lube` или `both`): у стадии, которую вёл человек корня, факт режима корня — сверх записанного на
 * столько шагов уставки. Прошла — после CAPA «обучить», что учила его (`until`).
 */
export function habitParams(db: ContentDb, s: PlantState, st: RecipeStage, rec: StageRecord, people: readonly string[]) {
  const c = s.chronic;
  const def = db.scenarios[s.scenario].chronic;
  if (!c || !def || c.root === 'api' || !c.person || c.until !== undefined || !people.includes(c.person)) return;
  const p = st.params.find(x => x.id === def.habit.param);
  if (!p || p.step === undefined || rec.params[p.id] === undefined) return;
  rec.params[p.id] += c.steps * p.step;
}

/** CAPA «обучить» выполнена и учит человека привычки — привычка проходит. */
export function habitCured(s: PlantState, people: readonly string[] | undefined) {
  const c = s.chronic;
  if (c?.person && c.until === undefined && people?.includes(c.person)) c.until = s.t;
}

/**
 * Оценка пары кончилась (Д1): у изготовителя смещения, после его дня, — изготовитель по замечанию вернул процесс, и
 * новые партии — как прежде (гипотеза: аудит или запрос документов называет изменение процесса у изготовителя).
 */
export function driftFixed(db: ContentDb, s: PlantState, maker: string) {
  const c = s.chronic;
  const def = db.scenarios[s.scenario].chronic;
  if (!c || !def || c.root === 'lube' || c.fixed !== undefined || def.drift.maker !== maker) return;
  if (momentOf(s.start, s.t).day < c.day) return;
  c.fixed = s.t;
}
