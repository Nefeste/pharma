// Техслужба (docs/specs/2026-10-engine.md, 1е; геймдизайн, §7): узлы машин, наработка и износ, отказ по таблице
// интенсивности от износа, ремонт и замена — задачи слесаря с запчастью со склада ЗИП, пополнение ЗИП по уровню
// неснижаемого запаса, политика техслужбы и команда `maintain`. Когда отказывает узел пресса, решает стадия (mes.ts),
// узел машины линии — поток линии (line.ts); здесь — общее: запас до отказа, журнал, ремонт, запчасти.
//
// Отказ — неоднородный пуассоновский поток по наработке: при установке узел получает запас до отказа — показательную
// величину со средним «один отказ», а работа расходует его по ступеням таблицы. Кончился — отказ.
import type { ContentDb, Id, PartType } from '../content/types';
import { decider, replacesBy, skillOf, type Who, whoDecides } from './bosses';
import { dueIn, owe, part, post } from './cash';
import { schedule } from './core/agenda';
import { P_ONE } from './core/rng';
import { modeOf, moot, propose } from './heads';
import { note, noteCmd } from './journal';
import { planOf } from './plant';
import { numOf, pairOf, POL } from './policies';
import { expo, roll } from './random';
import { nextId } from './stock';
import { etaOf } from './supply';
import { addTask } from './tasks';
import type { Command, Notice, Part, PlantState, Refusal, Task } from './types';

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

/** Запас до отказа узла: у купленной единицы (Б7в) — по доле таблицы отказов её поставщика, у прочих — как есть. */
function partBudget(db: ContentDb, s: PlantState, id: string, machine: string): number {
  const vendor = s.assets?.[machine]?.vendor;
  const hz = vendor ? db.vendors[vendor].hazard : 100;
  return hz === 100 ? budgetOf(s, id) : Math.floor((budgetOf(s, id) * 100) / hz);
}

/** Узлы машин плана — износ на старте из сценария; на складе ЗИП — начальный уровень каждой их запчасти. */
export function newParts(db: ContentDb, s: PlantState) {
  const plan = planOf(db, s.plan);
  const wear = db.scenarios[s.scenario].wear;
  const add = (machine: string, of: Id, t: PartType, line?: string) => {
    const id = `${machine}/${t.id}`;
    // узел уже есть — его не трогают: новый план (Б7в) добавляет только узлы новых единиц
    if (s.parts[id]) return;
    const budget = partBudget(db, s, id, machine);
    s.parts[id] = { id, machine, of, type: t.id, ...(line ? { line } : {}), done: Math.floor((t.life * (wear[id] ?? 0)) / P_ONE), budget, state: 'ok', installed: s.t, mark: 0, v: 0 };
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

/** Вещь предложения главного механика (Б5б): замена узла по наработке. */
export const replaceKey = (part: string) => `replace/${part}`;

/**
 * Шаг техслужбы: отказавшим — ремонт, если есть запчасть; политика «по наработке» — замена, когда износ дошёл до порога
 * и машина свободна; решённая замена — как только машина свободна и есть запчасть. Нет запчасти — ремонт ждёт поставки, а
 * ЗИП пополняется. Замена по наработке — в режиме техслужбы (Б5б): «сам» — решает, «советует» — предлагает то же в тот же
 * миг, а замена больше не нужна — предложение «не нужно»; «вручную» — ничего. Ремонт после отказа — в любом режиме.
 * Порог у каждого узла — политика главного механика (Б5г): с чего начинает завод — запись сценария.
 */
export function maintStep(db: ContentDb, s: PlantState, notices: Notice[]) {
  // руководитель — человек (Б5в): замену по наработке решает главный механик, а без него — заместитель, в свою смену;
  // ремонт после отказа и пополнение ЗИП — процедура техслужбы, их не ждут: в журнал — тот, кто сейчас в смене за него
  let planner: Who | undefined | null = null;
  const plannerNow = () => (planner === null ? (planner = decider(db, s, 'maint', notices)) : planner);
  for (const pt of Object.values(s.parts)) {
    if (pt.task) continue;
    const t = partType(db, pt);
    if (pt.state === 'failed') {
      if (free(s, t.spare) > 0) {
        // журнал решений (Б5а): главный механик — ремонт после отказа, запчасть из мастерской
        note(s, 'maint', { kind: 'repair', part: pt.id, why: { failed: pt.failed ?? s.t, spare: t.spare, free: free(s, t.spare) } }, undefined, undefined, whoDecides(db, s, 'maint'));
        repairTask(db, s, pt, false);
      } else {
        // ремонт ждёт запчасть (Б5ж; EN 15341 O26 — запчасти по требованию): в запись журнала, когда его сделают
        pt.nospare = true;
        replenish(db, s, t.spare);
      }
      continue;
    }
    const at = numOf(db, s, POL.replace, pt.id);
    if (at !== undefined) {
      const need = !pt.plan && wearAt(t, pt.done) >= at;
      let mode = need && idle(s, pt) ? modeOf(s, 'maint') : undefined;
      // со слабым навыком главный механик меняет узлы только после отказа (геймдизайн, §8.5)
      const w = mode === 'auto' || mode === 'advise' ? plannerNow() : undefined;
      if ((mode === 'auto' || mode === 'advise') && (!w || !replacesBy(skillOf(s, w)))) mode = undefined;
      const why = { wear: wearAt(t, pt.done), at };
      if (mode === 'auto') {
        pt.plan = 'policy';
        note(s, 'maint', { kind: 'replace', part: pt.id, why }, undefined, undefined, w);
      } else if (mode === 'advise') propose(s, 'maint', replaceKey(pt.id), { kind: 'maintain', machine: pt.machine, part: pt.type }, { kind: 'replace', part: pt.id, why }, notices, undefined, w);
      else if (!need && s.heads.open[replaceKey(pt.id)] !== undefined) moot(s, replaceKey(pt.id));
    }
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
  const plan = planOf(db, s.plan);
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
 * неснижаемого — заказ до начального уровня. Оба уровня — политика главного механика (Б5г): с чего начинает завод — запись
 * запчасти.
 */
function replenish(db: ContentDb, s: PlantState, spare: Id) {
  const [min, max] = pairOf(db, s, POL.spare, spare)!;
  let level = free(s, spare);
  for (const o of Object.values(s.spareOrders)) if (o.spare === spare && o.status === 'ordered') level += o.qty;
  if (level > min) return;
  const id = orderSpare(db, s, spare, max - level);
  note(s, 'maint', { kind: 'spare', order: id, spare, qty: max - level, why: { level, min, max } }, undefined, undefined, whoDecides(db, s, 'maint'));
}

/**
 * Срок поставки запчасти (Б7в): у узлов купленных единиц — срок ЗИП их поставщика, если он есть, у прочих — запись ЗИП;
 * у единиц разных поставщиков — самый короткий.
 */
function spareLead(db: ContentDb, s: PlantState, spare: Id): [number, number] {
  let best: [number, number] | undefined;
  for (const pt of Object.values(s.parts)) {
    if (partType(db, pt).spare !== spare) continue;
    const v = s.assets?.[pt.machine]?.vendor;
    const lead = (v && db.vendors[v].spares) || db.spares[spare].lead;
    if (!best || lead[1] < best[1]) best = lead;
  }
  return best ?? db.spares[spare].lead;
}

/** Заказ запчасти — как заказ поставщику (1д): предоплата сейчас, остаток с НДС — через `payDays` после поставки. */
function orderSpare(db: ContentDb, s: PlantState, spare: Id, qty: number): string {
  const rec = db.spares[spare];
  const sup = db.suppliers[rec.supplier];
  const net = rec.price * qty;
  const vat = part(net, db.profiles[db.scenarios[s.scenario].profile].vat.general);
  const eta = etaOf(db, s, sup.id, spareLead(db, s, spare));
  const id = nextId(s, 'Z');
  s.spareOrders[id] = { id, spare, qty, ordered: s.t, eta, sum: net + vat, vat, prepaid: part(net + vat, sup.prepay), status: 'ordered', by: 'head:maint' };
  post(s, -s.spareOrders[id].prepaid, 'prepay', id);
  schedule(s.agenda, eta, { kind: 'spare', order: id });
  return id;
}

/** Запчасть пришла в мастерскую: на склад ЗИП; НДС — к вычету, остаток — в счета к оплате. */
export function spareArrives(db: ContentDb, s: PlantState, id: string) {
  const o = s.spareOrders[id];
  if (!o || o.status !== 'ordered') return;
  o.status = 'arrived';
  s.spares[o.spare].qty += o.qty;
  s.cash.vat.in += o.vat;
  owe(s, 'supplier', -(o.sum - o.prepaid), dueIn(db, s, db.suppliers[db.spares[o.spare].supplier].payDays), o.id);
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
  // когда слесарь взял работу и ждал ли ремонт запчасть (Б5ж) — время внепланового и планового обслуживания
  const from = t.times?.[0];
  s.maintLog.push({ t: s.t, machine: pt.machine, part: pt.type, what: t.planned ? 'replace' : 'repair', wear: wearAt(ty, pt.done), people: [...t.people], ...(from !== undefined ? { from } : {}), ...(pt.nospare ? { spare: true as const } : {}) });
  delete pt.nospare;
  pt.done = 0;
  pt.budget = partBudget(db, s, pt.id, pt.machine);
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
  const why = planReplace(db, s, pt, 'player');
  if (why) return notices.push({ kind: 'refused', cmd: 'maintain', why, detail: pt.id });
  noteCmd(s, cmd, { kind: 'replace', part: pt.id });
}

/**
 * Решить замену узла вне отказа — как только машина свободна (Б1е; с Б5е — и по CAPA «заменить узел»): узел цел, его не
 * чинят и замена ещё не решена, в мастерской есть свободная запчасть. Нельзя — причина.
 */
export function planReplace(db: ContentDb, s: PlantState, pt: Part, by: NonNullable<Part['plan']>): Refusal | undefined {
  if (pt.state !== 'ok' || pt.task || pt.plan) return 'busy';
  if (free(s, partType(db, pt).spare) <= 0) return 'noSpare';
  pt.plan = by;
  return undefined;
}
