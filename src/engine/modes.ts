// Режимы (Б1ж; docs/specs/2026-10-vertical-slice.md, «Б1ж»): уставки режимов стадий технологических карт и скорости
// блистерной машины по инструкции по упаковке позиции. Уставку в пределах диапазона редакции в силе задаёт технолог —
// пост «Качество и технология»; новый диапазон — только новой редакцией через управление изменениями (геймдизайн, §5.3,
// §6.4). Уставка — у кода документа, а не у редакции: новая редакция её не сбрасывает, пока уставка в её диапазоне.
// Стадия берёт уставки, когда начинается (mes.ts), задание на упаковку — когда линия его берёт (line.ts): начатое
// не меняется. Без игрока на посту коллега технологии держит цель карты (§29.3): игрок ушёл с поста — уставки к цели.
import type { ContentDb, Id, RecipeStage, StageParam } from '../content/types';
import { momentOf } from './core/calendar';
import { P_ONE } from './core/rng';
import { inForce } from './docs';
import type { Command, Notice, PlantState } from './types';

/** Ключ уставки режима стадии: код карты, стадия, режим; скорости блистерной — код инструкции по упаковке. */
export const paramKey = (doc: string, stage: string, param: string) => `${doc}/${stage}/${param}`;
export const speedKey = (doc: string) => `${doc}/speed`;

/** Уставка режима стадии карты: заданная и в диапазоне этой редакции — она, иначе цель. */
export function setpointOf(db: ContentDb, s: PlantState, recipe: Id, stage: string, p: StageParam): number {
  const v = s.setpoints[paramKey(db.recipes[recipe].doc.code, stage, p.id)]?.v;
  return v !== undefined && v >= p.range[0] && v <= p.range[1] ? v : p.target;
}

/** Уставки режимов стадии — с ними стадия начнётся сейчас. */
export function stageSetpoints(db: ContentDb, s: PlantState, recipe: Id, st: RecipeStage): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of st.params) out[p.id] = setpointOf(db, s, recipe, st.id, p);
  return out;
}

/** Скорость блистерной машины по уставке инструкции позиции, блистеров в минуту: в диапазоне — она, иначе цель. */
export function speedOf(db: ContentDb, s: PlantState, sku: Id): number {
  const k = db.skus[sku];
  const v = s.setpoints[speedKey(k.doc.code)]?.v;
  return v !== undefined && v >= k.speed.range[0] && v <= k.speed.range[1] ? v : k.speed.target;
}

/**
 * Ход машины линии, штук в минуту (Б1ж): у машины с уставкой скорости — скорость задания (её линия сняла, когда взяла
 * задание) или нынешняя уставка инструкции, у прочих — паспорт.
 */
export function machineSpeed(db: ContentDb, s: PlantState, type: Id, job: { sku: Id; speed?: number }): number {
  return db.machines[type].fast ? (job.speed ?? speedOf(db, s, job.sku)) : db.machines[type].nominal;
}

/**
 * Поправка к частоте микроостановок на штуку или к браку камеры при скорости `speed` против цели `target` (Б1ж): доли
 * 1/10 000 на 10 000; чувствительность — доли 1/10 000 на долю скорости.
 */
export function fastFactor(k: number, speed: number, target: number): number {
  return Math.max(0, P_ONE + Math.round((k * (speed - target)) / target));
}

/** Режим скорости ротора: производительность стадии по карте — при цели, с уставкой — вместе с ней. */
export const SPEED = 'speed';

/** Таблеток в час у стадии со скоростью ротора при уставках `sp`; без уставки скорости — по карте. */
export function unitsPerHour(st: RecipeStage, sp: Record<string, number> | undefined): number | undefined {
  const u = st.time.unitsPerHour;
  const p = st.params.find(x => x.id === SPEED);
  if (!u || !p || sp?.[SPEED] === undefined) return u;
  return Math.floor((u * sp[SPEED]) / p.target);
}

/**
 * Команда `setpoint`: уставка режима стадии карты или скорости блистерной позиции — в редакции, которая действует
 * сегодня. Отказ: нет такой карты или позиции; нет стадии или режима; значение вне диапазона редакции или не на шаге
 * от цели. Уставка по цели — снять запись: держать нечего.
 */
export function setpointCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'setpoint' }>, notices: Notice[]) {
  const day = momentOf(s.start, s.t).day;
  let key: string;
  let target: number;
  let range: [number, number];
  let step: number;
  if ('recipe' in cmd) {
    if (!db.recipes[cmd.recipe]) return notices.push({ kind: 'refused', cmd: 'setpoint', why: 'noRecipe', detail: cmd.recipe });
    const r = db.recipes[inForce(db, 'recipes', cmd.recipe, day)];
    const p = r.stages.find(st => st.id === cmd.stage)?.params.find(x => x.id === cmd.param);
    if (!p) return notices.push({ kind: 'refused', cmd: 'setpoint', why: 'noParam', detail: `${cmd.stage}/${cmd.param}` });
    key = paramKey(r.doc.code, cmd.stage, p.id);
    ({ target, range, step } = p);
  } else {
    if (!db.skus[cmd.sku]) return notices.push({ kind: 'refused', cmd: 'setpoint', why: 'noSku', detail: cmd.sku });
    const k = db.skus[inForce(db, 'skus', cmd.sku, day)];
    key = speedKey(k.doc.code);
    ({ target, range, step } = k.speed);
  }
  const v = cmd.value;
  if (!Number.isInteger(v) || v < range[0] || v > range[1]) return notices.push({ kind: 'refused', cmd: 'setpoint', why: 'outOfRange', detail: key });
  if ((v - target) % step !== 0) return notices.push({ kind: 'refused', cmd: 'setpoint', why: 'offStep', detail: key });
  if (v === target) delete s.setpoints[key];
  else if (s.setpoints[key]?.v !== v) s.setpoints[key] = { v, from: s.t };
}

/**
 * Коллега технологии держит цель (Б1ж; геймдизайн, §29.3): игрок ушёл с поста «Качество и технология» — уставки к цели;
 * начатые стадии и задания идут со своими.
 */
export function colleagueTargets(s: PlantState, notices: Notice[]) {
  const n = Object.keys(s.setpoints).length;
  if (n === 0) return;
  s.setpoints = {};
  notices.push({ kind: 'setpoints', n, by: 'colleague' });
}
