// Места и оборудование (Б3в; docs/specs/2026-10-vertical-slice.md, «Б3в»; геймдизайн, §7.2): физические активы — вещи
// плана на своих местах и техника — с инвентарными номерами; записи квалификации и калибровки (у датчика условий
// хранения — поверки) с днём и сроком «до»; просрочено — актив новых работ не берёт. Калибровку, поверку и повторную
// квалификацию ведёт подрядчик: визит назначает коллега техслужбы за срок предупреждения; с назначенного часа актив новых
// работ не берёт, идущая работа доходит до конца, подрядчик работает в свои часы, а не успевает в этот день — приходит на
// следующий рабочий; завод платит в день визита. Работу принимает начальник ОКК (калибровку) или специалист ООК
// (квалификацию) — запись появляется с днём приёмки. Записи — знание завода, а не истина: их видят окно и двойник.
import type { ContentDb, RecipeStage, Scenario } from '../content/types';
import { part, post } from './cash';
import { schedule } from './core/agenda';
import { addMonths, addWorkdays, DAY, daysFromCivil, HOUR, isWorkday, momentOf } from './core/calendar';
import { fnv1a } from './core/hash';
import { note } from './journal';
import { accepts, classOf, placesOf, roomAt } from './places';
import { type PlantPlan, planOf, type Slot } from './plant';
import { addTask } from './tasks';
import type { Asset, AssetRec, Notice, PlantState, Task } from './types';
import { calOf } from './workdays';

/** Работы подрядчика у актива: повторная квалификация и калибровка (у датчика — поверка). */
export const WORKS = ['qual', 'cal'] as const;
export type Work = (typeof WORKS)[number];

/** Кто принимает работу подрядчика (GMP ЕАЭС, ч. I, п. 6.7 iii; Б3в): калибровку — начальник ОКК, квалификацию — специалист ООК. */
export const ACCEPT: Record<Work, string> = { cal: 'role.qc-head', qual: 'role.qa' };

/** Приёмка — выше обычной работы ОКК и ООК, но ниже расследования: актив ждёт записи (гипотеза). */
export const ACCEPT_PRIO = 26;

/** Коллега техслужбы смотрит сроки в 09:00 рабочего дня, как коллега снабжения — заказы (гипотеза). */
export const BOOK_HOUR = 9 * HOUR;

/** Последняя запись работы актива. */
export function recOf(a: Asset, work: Work): AssetRec | undefined {
  for (let i = a.recs.length - 1; i >= 0; i--) if (a.recs[i].work === work) return a.recs[i];
  return undefined;
}

/** Действует ли запись работы в день `day`: принята не позже и срок не вышел. */
export function valid(a: Asset, work: Work, day: number): boolean {
  const r = recOf(a, work);
  return !!r && r.day <= day && day <= r.until;
}

/**
 * Активы на начало партии и в миграции старого сохранения (Б3в): вещи плана — по порядку кода места, за ними техника;
 * инвентарные номера — по этому порядку с номера сценария. Записи — в прошлом, у каждой свой день по хешу актива и работы,
 * а не по зерну, как у записей обучения (Б3б): жизнь до начала партии одна. Срок — не раньше, чем через срок предупреждения:
 * коллега успевает назначить визит, и на старте всё в сроке.
 */
export function seedAssets(db: ContentDb, sc: Scenario, s: Pick<PlantState, 'plant' | 'vehicles' | 'assets'>, day: number) {
  const plant = planOf(db, s.plant).plant;
  const P = placesOf(plant);
  let inv = sc.assets.inv;
  const add = (a: Omit<Asset, 'inv' | 'recs'>) => {
    const x: Asset = { ...a, inv: inv++, recs: [] };
    const cls = classOf(db, x);
    for (const work of WORKS) {
      const w = cls[work];
      if (!w) continue;
      const span = Math.max(0, addMonths(day, w.every) - day - sc.assets.ahead - 3);
      const d = day - (fnv1a(`${x.id}/${work}`) % (span + 1));
      x.recs.push({ work, day: d, until: addMonths(d, w.every) - 1 });
    }
    s.assets[x.id] = x;
  };
  for (const t of P.things) add({ id: t.id, family: t.family, type: t.type, place: t.place });
  // техника — участка, где её стоянка
  const park = roomAt(plant, plant.points.park[0], plant.points.park[1]);
  const area = (park && P.areaOf[park]) ?? plant.site.code;
  for (const v of Object.values(s.vehicles)) add({ id: v.id, family: 'vehicle', type: v.type, place: area });
}

/** Почему актив не годен к новой работе: квалификация, калибровка (поверка) — нет действующей записи; визит подрядчика. */
export type Unfit = Work | 'visit';

/**
 * Почему актив не берёт новую работу сейчас (Б3в): нет действующей записи квалификации или калибровки; с назначенного часа
 * визита подрядчика — до конца его работы. Вещь без актива и техника — пригодны.
 */
export function unfit(db: ContentDb, s: PlantState, id: string, day = daysFromCivil(s.start) + Math.floor(s.t / DAY)): Unfit | undefined {
  // в цепочке миграций шаги до схемы 19 видят завод без активов (save.ts): там всё пригодно
  const a = s.assets?.[id];
  if (!a) return undefined;
  const cls = classOf(db, a);
  if (cls.qual && !valid(a, 'qual', day)) return 'qual';
  if (cls.cal && !valid(a, 'cal', day)) return 'cal';
  const v = a.visit;
  return v && s.t >= v.at && v.task === undefined ? 'visit' : undefined;
}

/** Работает ли подрядчик у актива сейчас. */
export const contractor = (a: Asset, t: number) => !!a.visit && a.visit.from !== undefined && a.visit.task === undefined && t < a.visit.to!;

/**
 * Идёт ли у актива работа (Б3в): серия держит оборудование стадией; линия упаковывает; прибор лаборатории занят
 * испытанием; у прибора МОК в его помещении идёт стадия с испытанием его вида. Датчик всегда в работе, но поверку
 * подрядчик делает на месте.
 */
function busy(db: ContentDb, s: PlantState, a: Asset): boolean {
  switch (a.family) {
    case 'equipment':
      return !!s.equipment[a.id]?.batch;
    case 'machine': {
      const line = placesOf(planOf(db, s.plant).plant).thing[a.id]?.line;
      const ln = line ? s.lines[line] : undefined;
      return !!ln?.batch && s.batches[ln.batch]?.pack?.state === 'running';
    }
    case 'lab':
      return !!s.instruments[a.id]?.test;
    case 'ipc': {
      const plan = planOf(db, s.plant);
      const room = placesOf(plan.plant).thing[a.id]?.room;
      for (const t of Object.values(s.tasks)) {
        if (t.kind !== 'stage' || !t.batch) continue;
        const b = s.batches[t.batch];
        const st = db.recipes[b.recipe].stages[b.stage];
        if (st && plan.roomOf[st.room] === room && st.ipc.some(c => db.tests[c.test].inst === a.type)) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * После каждого события и каждый час (Б3в): у актива, чей визит настал и у кого нет идущей работы, подрядчик начинает —
 * в рабочий день и в свои часы, если успевает до их конца. Не успевает — приходит на следующий рабочий день: его будит
 * часовое событие.
 */
export function assetStep(db: ContentDb, s: PlantState) {
  let now: ReturnType<typeof momentOf> | undefined;
  for (const a of Object.values(s.assets)) {
    const v = a.visit;
    if (!v || v.from !== undefined || s.t < v.at) continue;
    now ??= momentOf(s.start, s.t);
    if (!isWorkday(calOf(db, s), now.day)) return;
    const [from, to] = db.scenarios[s.scenario].assets.hours;
    const w = classOf(db, a)[v.work];
    if (!w || now.sec < from || now.sec + w.work > to || busy(db, s, a)) continue;
    v.from = s.t;
    v.to = s.t + w.work;
    v.v++;
    schedule(s.agenda, v.to, { kind: 'visit', asset: a.id, v: v.v });
  }
}

/** Каждый час (Б3в): в полночь — у кого вышел срок; в 09:00 рабочего дня — коллега техслужбы назначает визиты; подрядчик. */
export function assetHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  const now = momentOf(s.start, s.t);
  if (now.sec === 0) expired(db, s, now.day, notices);
  if (now.sec === BOOK_HOUR && isWorkday(calOf(db, s), now.day)) book(db, s, now.day);
  assetStep(db, s);
}

/** Полночь: у актива с этого дня нет действующей записи работы, которая ему нужна, — извещение (автопауза в окне). */
function expired(db: ContentDb, s: PlantState, day: number, notices: Notice[]) {
  for (const a of Object.values(s.assets)) {
    const cls = classOf(db, a);
    for (const work of WORKS) if (cls[work] && valid(a, work, day - 1) && !valid(a, work, day)) notices.push({ kind: 'assetExpired', asset: a.id, family: a.family, type: a.type, inv: a.inv, work });
  }
}

/**
 * Коллега техслужбы (Б3в): у актива без визита, чья запись кончится в срок предупреждения сценария (или уже кончилась), —
 * визит на ближайший рабочий день, к началу часов подрядчика; из двух работ — та, что кончится раньше.
 */
function book(db: ContentDb, s: PlantState, today: number) {
  const sc = db.scenarios[s.scenario];
  const at = (addWorkdays(calOf(db, s), today, 1) - daysFromCivil(s.start)) * DAY + sc.assets.hours[0];
  for (const a of Object.values(s.assets)) {
    if (a.visit) continue;
    const cls = classOf(db, a);
    let due: { work: Work; until: number } | undefined;
    for (const work of WORKS) {
      if (!cls[work]) continue;
      const until = recOf(a, work)?.until ?? Number.NEGATIVE_INFINITY;
      if (until - today <= sc.assets.ahead && (!due || until < due.until)) due = { work, until };
    }
    if (!due) continue;
    a.visit = { work: due.work, at, booked: s.t, v: 0 };
    // журнал решений (Б5а): главный механик — до какого дня запись и срок предупреждения
    note(s, 'maint', { kind: 'visit', asset: a.id, work: due.work, at, why: { ...(Number.isFinite(due.until) ? { until: due.until } : {}), ahead: sc.assets.ahead } });
  }
}

/** Подрядчик кончил работу (событие `visit`): счёт — сегодня, НДС — к вычету; работу принимает человек завода — задача. */
export function visitDone(db: ContentDb, s: PlantState, id: string, v: number) {
  const a = s.assets[id];
  const vis = a?.visit;
  if (!vis || vis.v !== v || vis.task !== undefined) return;
  const w = classOf(db, a)[vis.work]!;
  const sc = db.scenarios[s.scenario];
  const vat = part(w.price, db.profiles[sc.profile].vat.general);
  post(s, -(w.price + vat), 'calqual', a.id);
  s.cash.vat.in += vat;
  const plan = planOf(db, s.plant);
  const room = placesOf(plan.plant).thing[a.id]?.room;
  const at = room ? plan.room[room] : plan.entrance;
  const t = addTask(s, { kind: 'accept', roles: [ACCEPT[vis.work]], from: { kind: 'point', x: at.x, z: at.z }, work: sc.assets.accept, prio: ACCEPT_PRIO, asset: a.id });
  vis.task = t.id;
}

/** Приёмка кончилась: запись — с днём приёмки, срок — через интервал класса; визита больше нет. Не приёмка — `false`. */
export function assetDone(db: ContentDb, s: PlantState, t: Task): boolean {
  if (t.kind !== 'accept') return false;
  const a = t.asset ? s.assets[t.asset] : undefined;
  const vis = a?.visit;
  if (!a || !vis) return true;
  const day = momentOf(s.start, s.t).day;
  a.recs.push({ work: vis.work, day, until: addMonths(day, classOf(db, a)[vis.work]!.every) - 1, by: t.people[0] });
  delete a.visit;
  return true;
}

/**
 * Места, куда паллету кладут на хранение (Б3в): у них проверяют режим зоны и её датчик. Приёмка, комплектовка, пробоотбор,
 * паллетирование и экспедиция — транзит: паллета там не хранится.
 */
export const STORE_KINDS: ReadonlySet<string> = new Set(['quarantine', 'cold', 'storage', 'rejected', 'fgQuarantine']);

/** Проверки места назначения задачи: `open` — зона принимает режим материала паллеты; `ok` — ещё и открыта. */
export interface SlotFit {
  open: (sl: Slot) => boolean;
  ok: (sl: Slot) => boolean;
}

/**
 * Чем проверять место назначения задачи (Б3в): паллету кладут только в зону, чей режим лежит внутри режима её материала, и
 * только в открытую — датчик которой пригоден (`closed` — закрытые зоны). Транзит и проверять нечего — `undefined`.
 */
export function slotFit(db: ContentDb, s: PlantState, plan: PlantPlan, t: Task, closed: ReadonlyMap<string, string>): SlotFit | undefined {
  if (!t.toKind || !STORE_KINDS.has(t.toKind)) return undefined;
  // зоны, где есть места этого вида: другие задаче не попадутся
  const stores = plan.storesOf[t.toKind] ?? [];
  const u = t.unit ? s.units[t.unit] : undefined;
  const c = u?.items[0] ? s.containers[u.items[0]] : undefined;
  const material = c ? s.lots[c.lot]?.material : undefined;
  const P = placesOf(plan.plant);
  const refused = new Set<string>();
  if (material) for (const code of stores) if (!accepts(db, P.center[code], material)) refused.add(code);
  if (refused.size === 0 && !stores.some(code => closed.has(code))) return undefined;
  const open = (sl: Slot) => !sl.store || !refused.has(sl.store);
  return { open, ok: sl => open(sl) && !(sl.store && closed.has(sl.store)) };
}

/**
 * Приборы МОК стадии (Б3в): в помещении стадии — по прибору вида каждого её испытания с прибором; первый пригодный, а нет
 * пригодного — первый по плану (сборщик базы проверяет, что прибор вида есть).
 */
export function stageMeters(db: ContentDb, s: PlantState, st: RecipeStage, roomId: string): string[] {
  const out: string[] = [];
  const meters = placesOf(planOf(db, s.plant).plant).ipcIn[roomId];
  if (!meters) return out;
  for (const c of st.ipc) {
    const inst = db.tests[c.test].inst;
    if (!inst) continue;
    let pick: string | undefined;
    for (const m of meters) {
      if (m.type !== inst) continue;
      pick ??= m.id;
      if (!unfit(db, s, m.id)) {
        pick = m.id;
        break;
      }
    }
    if (pick && !out.includes(pick)) out.push(pick);
  }
  return out;
}

/**
 * Что держит стадию серии (Б3в): оборудование стадии или прибор её МОК не пригоден — нет действующей квалификации или
 * калибровки, или у него подрядчик. Первое такое — с причиной; всё пригодно — `undefined`.
 */
export function stageUnfit(db: ContentDb, s: PlantState, st: RecipeStage, roomId: string): { asset: string; why: 'qual' | 'cal' | 'visit' } | undefined {
  const plant = planOf(db, s.plant).plant;
  for (const type of st.equipment) {
    for (const e of plant.equipment) {
      if (e.room !== roomId || e.type !== type) continue;
      const why = unfit(db, s, e.id);
      if (why) return { asset: e.id, why };
    }
  }
  for (const id of stageMeters(db, s, st, roomId)) {
    const why = unfit(db, s, id);
    if (why) return { asset: id, why };
  }
  return undefined;
}

/** Что держит упаковку на линии (Б3в): первая машина линии без действующей квалификации или с подрядчиком. */
export function lineUnfit(db: ContentDb, s: PlantState, line: string): { asset: string; why: Unfit } | undefined {
  for (const m of s.lines[line]?.machines ?? []) {
    const why = unfit(db, s, m.id);
    if (why) return { asset: m.id, why };
  }
  return undefined;
}
