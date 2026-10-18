// Техслужба (docs/specs/2026-10-engine.md, 1е; геймдизайн, §7): узлы машин, наработка и износ, отказ по таблице
// интенсивности от износа, ремонт и замена — задачи слесаря с запчастью со склада ЗИП, пополнение ЗИП по уровню
// неснижаемого запаса, политика техслужбы и команда `maintain`. Когда отказывает узел пресса, решает стадия (mes.ts),
// узел машины линии — поток линии (line.ts); здесь — общее: запас до отказа, журнал, ремонт, запчасти.
//
// Отказ — неоднородный пуассоновский поток по наработке: при установке узел получает запас до отказа — показательную
// величину со средним «один отказ», а работа расходует его по ступеням таблицы. Кончился — отказ.
import type { ContentDb, Id, PartType } from '../content/types';
import { dueIn, owe, part, post } from './cash';
import { schedule } from './core/agenda';
import { P_ONE } from './core/rng';
import { planOf } from './plant';
import { expo, roll } from './random';
import { nextId } from './stock';
import { etaOf } from './supply';
import { addTask } from './tasks';
import type { Command, Notice, Part, PlantState, Task } from './types';

/** Запас до отказа считается в 10⁻¹² отказа: средний запас — один отказ. */
export const ONE_FAILURE = 1_000_000_000_000;

/** Ремонтирует и меняет узлы слесарь-ремонтник. */
export const MAINT = { mechanics: ['role.mechanic'] } as const;

/** Ремонт — раньше прочих задач того же человека (у слесаря других пока нет). */
export const MAINT_PRIO = 45;

/** Вид узла по записи машины. */
export function partType(db: ContentDb, pt: Part): PartType {
  const list = pt.line ? db.machines[pt.of].parts : db.equipment[pt.of].parts;
  return list.find(x => x.id === pt.type)!;
}

/** Износ при наработке `done`, доли 1/10 000. */
export const wearAt = (t: PartType, done: number) => Math.floor((done * P_ONE) / t.life);

/** Первая наработка `i`-й ступени таблицы — износ не меньше её порога; ступени нет — бесконечность. */
const edge = (t: PartType, i: number) => (i < t.hazard.length ? Math.ceil((t.hazard[i][0] * t.life) / P_ONE) : Infinity);

/** Сколько запаса до отказа съедят `n` единиц наработки после `done`. */
export function consume(t: PartType, done: number, n: number): number {
  let sum = 0;
  let d = done;
  const end = done + n;
  for (let i = 0; i < t.hazard.length && d < end; i++) {
    const hi = Math.min(end, edge(t, i + 1));
    if (hi <= d) continue;
    sum += (hi - d) * t.hazard[i][1];
    d = hi;
  }
  return sum;
}

/** Сколько единиц наработки после `done` до отказа при запасе `budget`: на последней из них запас кончится. Никогда — `Infinity`. */
export function untilFail(t: PartType, done: number, budget: number): number {
  let left = budget;
  let d = done;
  for (let i = 0; i < t.hazard.length; i++) {
    const hi = edge(t, i + 1);
    if (hi <= d) continue;
    const hz = t.hazard[i][1];
    if (hz > 0) {
      const need = Math.ceil(left / hz);
      if (d + need <= hi) return d + need - done;
      left -= (hi - d) * hz;
    }
    d = hi;
  }
  return Infinity;
}

/** Запас до отказа нового узла — из ветви узла. */
const budgetOf = (s: PlantState, id: string) => roll(s, `maint/${id}`, r => expo(r, ONE_FAILURE));

/** Узлы машин плана — износ на старте из сценария; на складе ЗИП — начальный уровень каждой их запчасти. */
export function newParts(db: ContentDb, s: PlantState) {
  const plan = planOf(db, s.plant);
  const wear = db.scenarios[s.scenario].wear;
  const add = (machine: string, of: Id, t: PartType, line?: string) => {
    const id = `${machine}/${t.id}`;
    s.parts[id] = { id, machine, of, type: t.id, ...(line ? { line } : {}), done: Math.floor((t.life * (wear[id] ?? 0)) / P_ONE), budget: budgetOf(s, id), state: 'ok', installed: s.t, mark: 0, v: 0 };
    s.spares[t.spare] ??= { qty: db.spares[t.spare].stock.max, reserved: 0 };
  };
  for (const e of plan.plant.equipment) for (const t of db.equipment[e.type].parts) add(e.id, e.type, t);
  for (const l of plan.plant.lines) for (const m of l.machines) for (const t of db.machines[m.type].parts) add(m.id, m.type, t, l.id);
}

/** Узлы машины. */
export const partsOf = (s: PlantState, machine: string) => Object.values(s.parts).filter(p => p.machine === machine);

/** Машину нельзя пускать: узел отказал или его чинят и меняют. */
export const blocked = (s: PlantState, machine: string) => partsOf(s, machine).some(p => p.state === 'failed' || p.task !== undefined);

/** Запчастей на складе ЗИП без резерва. */
const free = (s: PlantState, spare: Id) => s.spares[spare].qty - s.spares[spare].reserved;

/** Узел вот-вот уйдёт в замену по плану: она решена, запчасть есть — машину не пускать в новую работу. */
export const pending = (db: ContentDb, s: PlantState, machine: string) => partsOf(s, machine).some(p => p.plan !== undefined && free(s, partType(db, p).spare) > 0);

/** Свободна ли машина узла для замены: оборудование — без серии, машина линии — линия не упаковывает. */
function idle(s: PlantState, pt: Part): boolean {
  if (!pt.line) return !s.equipment[pt.machine].batch;
  const line = s.lines[pt.line];
  return !line.batch || s.batches[line.batch].pack?.state !== 'running';
}

/** Узел отказал: запас — 0, запись в журнал оборудования, извещение. Ремонт заведёт `maintStep`. */
export function failPart(db: ContentDb, s: PlantState, pt: Part, notices: Notice[], batch?: string) {
  pt.state = 'failed';
  pt.budget = 0;
  pt.failed = s.t;
  pt.v++;
  s.maintLog.push({ t: s.t, machine: pt.machine, part: pt.type, what: 'failure', wear: wearAt(partType(db, pt), pt.done), ...(batch ? { batch } : {}) });
  notices.push({ kind: 'failure', machine: pt.machine, part: pt.type });
}

/**
 * Шаг техслужбы: отказавшим — ремонт, если есть запчасть; политика «по наработке» — замена, когда износ дошёл до порога;
 * решённая замена — как только машина свободна и есть запчасть. Нет запчасти — ремонт ждёт поставки, а ЗИП пополняется.
 */
export function maintStep(db: ContentDb, s: PlantState) {
  const policy = db.scenarios[s.scenario].maint;
  for (const pt of Object.values(s.parts)) {
    if (pt.task) continue;
    const t = partType(db, pt);
    if (pt.state === 'failed') {
      if (free(s, t.spare) > 0) repairTask(db, s, pt, false);
      else replenish(db, s, t.spare);
      continue;
    }
    const at = policy[pt.id];
    if (!pt.plan && at !== undefined && idle(s, pt) && wearAt(t, pt.done) >= at) pt.plan = 'policy';
    if (!pt.plan || !idle(s, pt)) continue;
    if (free(s, t.spare) > 0) repairTask(db, s, pt, true);
    else replenish(db, s, t.spare);
  }
}

/**
 * Задача слесаря: взять запчасть в мастерской, дойти до машины, работать. Замена по плану — время замены из записи,
 * ремонт после отказа — от и до из ветви узла. Запчасть — в резерв.
 */
function repairTask(db: ContentDb, s: PlantState, pt: Part, planned: boolean) {
  const plan = planOf(db, s.plant);
  const t = partType(db, pt);
  const shop = plan.room[plan.roomOf.workshop];
  const room = pt.line ? plan.plant.lines.find(l => l.id === pt.line)!.room : s.equipment[pt.machine].room;
  const work = planned ? t.replace : roll(s, `maint/${pt.id}`, r => r.range(t.repair[0], t.repair[1]));
  s.spares[t.spare].reserved++;
  const task = addTask(s, { kind: 'repair', roles: [...MAINT.mechanics], from: { kind: 'point', x: shop.x, z: shop.z }, room, work, prio: MAINT_PRIO, part: pt.id, ...(pt.line ? { line: pt.line } : {}), ...(planned ? { planned: true } : {}) });
  pt.task = task.id;
  replenish(db, s, t.spare);
}

/**
 * Пополнение по уровню неснижаемого запаса (ГОСТ 27.507-2015, п. 7.3.4): «на складе − в резерве + в заказе» дошло до
 * неснижаемого — заказ до начального уровня.
 */
function replenish(db: ContentDb, s: PlantState, spare: Id) {
  const rec = db.spares[spare];
  let level = free(s, spare);
  for (const o of Object.values(s.spareOrders)) if (o.spare === spare && o.status === 'ordered') level += o.qty;
  if (level > rec.stock.min) return;
  orderSpare(db, s, spare, rec.stock.max - level);
}

/** Заказ запчасти — как заказ поставщику (1д): предоплата сейчас, остаток с НДС — через `payDays` после поставки. */
function orderSpare(db: ContentDb, s: PlantState, spare: Id, qty: number) {
  const rec = db.spares[spare];
  const sup = db.suppliers[rec.supplier];
  const net = rec.price * qty;
  const vat = part(net, db.profiles[db.scenarios[s.scenario].profile].vat.general);
  const eta = etaOf(s, sup.id, rec.lead);
  const id = nextId(s, 'Z');
  s.spareOrders[id] = { id, spare, qty, ordered: s.t, eta, sum: net + vat, vat, prepaid: part(net + vat, sup.prepay), status: 'ordered', by: 'head:maint' };
  post(s, -s.spareOrders[id].prepaid, 'prepay', id);
  schedule(s.agenda, eta, { kind: 'spare', order: id });
}

/** Запчасть пришла в мастерскую: на склад ЗИП; НДС — к вычету, остаток — в счета к оплате. */
export function spareArrives(db: ContentDb, s: PlantState, id: string) {
  const o = s.spareOrders[id];
  if (!o || o.status !== 'ordered') return;
  o.status = 'arrived';
  s.spares[o.spare].qty += o.qty;
  s.cash.vat.in += o.vat;
  owe(s, 'supplier', -(o.sum - o.prepaid), dueIn(s, db.suppliers[db.spares[o.spare].supplier].payDays), o.id);
}

/**
 * Ремонт или замена кончились: запчасть со склада ЗИП — в машину, узел новый (наработка 0, новый запас до отказа), запись
 * в журнал оборудования. Машину линии снова пускает поток линии (line.ts). Не задача техслужбы — `false`.
 */
export function maintDone(db: ContentDb, s: PlantState, t: Task, notices: Notice[]): boolean {
  if (t.kind !== 'repair') return false;
  const pt = s.parts[t.part!];
  const ty = partType(db, pt);
  const sp = s.spares[ty.spare];
  sp.qty--;
  sp.reserved--;
  s.maintLog.push({ t: s.t, machine: pt.machine, part: pt.type, what: t.planned ? 'replace' : 'repair', wear: wearAt(ty, pt.done), people: [...t.people] });
  pt.done = 0;
  pt.budget = budgetOf(s, pt.id);
  pt.state = 'ok';
  pt.installed = s.t;
  pt.v++;
  delete pt.failed;
  delete pt.plan;
  delete pt.task;
  if (pt.line) pt.mark = s.lines[pt.line].machines.find(m => m.id === pt.machine)!.pos;
  notices.push({ kind: 'repaired', machine: pt.machine, part: pt.type, planned: t.planned === true });
  return true;
}

/** Команда `maintain`: заменить узел вне отказа — как только машина свободна. */
export function maintainCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'maintain' }>, notices: Notice[]) {
  const pt = s.parts[`${cmd.machine}/${cmd.part}`];
  if (!pt) return notices.push({ kind: 'refused', cmd: 'maintain', why: 'noPart', detail: `${cmd.machine}/${cmd.part}` });
  if (pt.state !== 'ok' || pt.task || pt.plan) return notices.push({ kind: 'refused', cmd: 'maintain', why: 'busy', detail: pt.id });
  if (free(s, partType(db, pt).spare) <= 0) return notices.push({ kind: 'refused', cmd: 'maintain', why: 'noSpare', detail: pt.id });
  pt.plan = 'player';
}
