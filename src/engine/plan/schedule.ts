// Прогон расписания (docs/specs/2026-10-panels.md, 3д; docs/02-architecture.md, §8): что, где и когда будет делаться, —
// чистая функция из состояния; состояние не меняется. Правила — те же, что у движка, и из тех же его функций: готово ли
// помещение для продукта (`readyFor`), номинальная длительность стадии (`nominal`), время уборки (`cleanWork`), может ли
// человек смены взять задачу (`takesAt`) и помещается ли она у него в часы (Б4а, `fitsIn`: с остатком сверхурочных на
// начало прогона); людей считают только допущенных к работе сейчас (Б3б, `admitted`) — обучение,
// которое завод ещё проведёт, прогон не предсказывает. Назначенные визиты подрядчика (Б3в) прогон знает: с их часа актив
// новых работ не берёт, идущая работа доходит до конца, подрядчик работает в свои часы; визиты, которые коллега
// техслужбы ещё не назначил, — нет. Разброса нет: жизнь отличается от прогона на разброс длительностей, на людей, занятых
// другим, на отказы и ремонты и на комплекты упаковки, которые появятся позже, — их прогон не предсказывает.
import type { ContentDb, Id, TaskKind } from '../../content/types';
import { stageMeters, unfit } from '../assets';
import { DAY, daysFromCivil, HOUR, isWorkday, momentOf } from '../core/calendar';
import { fitsIn, overLeft } from '../hours';
import { coverWindows } from '../leave';
import { blocked } from '../maint';
import { DIRTY_HOLD, kitPlan, MES, newBatch, nominal, readyFor, roomWork, stageMass, stageNorm, stageTaskNorm, TRANSFER_WORK, washWork } from '../mes';
import { classOf, placesOf } from '../places';
import { planOf } from '../plant';
import { admitted, needFor } from '../quals';
import { LAST_CALL, shiftEndAt } from '../staff';
import type { Batch, KitLine, Person, PlantState, Room, Task } from '../types';
import { WMS } from '../wms';
import { calOf } from '../workdays';

/**
 * Полоса Ганта: строка — `kit` (комплектовка у шлюза для материалов), помещение или линия плана. Уборка помещения после
 * серии — две полосы (Б4в): мойка оборудования (`clean`) и уборка помещения уборщиком (`roomClean`).
 */
export interface Bar {
  row: string;
  kind: 'kit' | 'stage' | 'clean' | 'roomClean' | 'setup' | 'pack' | 'visit';
  /** чья: серия стадии и комплектовки; у уборки — серия, после которой или перед которой убирают, если она известна */
  batch?: string;
  stage?: Id;
  from: number;
  to: number;
  /** прошлое — по записям; сейчас — идёт по задаче; план — прогон */
  when: 'past' | 'now' | 'plan';
  major?: true;
  /** комплект упаковочных материалов, а не серии */
  pack?: true;
  /** задание ждёт материал: полосы — не раньше его прихода */
  material?: true;
  /** оборудование стадии ждёт ремонта: когда он кончится, прогон не знает */
  repair?: true;
  /** визит подрядчика (Б3в): у какого актива и какая работа */
  asset?: string;
  work?: 'qual' | 'cal';
}

/** Полоса, к которой относится причина: комплектовка или стадия карты. */
export type BarRef = 'kit' | Id;

/** Почему полоса серии не раньше: что отодвинуло её начало. */
export type Why =
  /** раньше нынешней минуты нельзя */
  | { why: 'past'; bar: 'kit' }
  /** комплектовка одна на завод: до `until` — комплект другой серии или комплект упаковки */
  | { why: 'kitting'; bar: 'kit'; batch: string; pack: boolean; until: number }
  /** не хватает материала: партия уже в лаборатории или у рампы; придёт с заказом поставщику; заказа нет */
  | { why: 'material'; bar: 'kit'; material: Id; qty: number; lab?: true; po?: string; eta?: number }
  /** людей роли нет в смене или до её конца меньше 15 минут: начнётся в `at` */
  | { why: 'shift'; bar: BarRef; role: Id; at: number }
  /** люди роли в смене есть, но работа не помещается у них в остаток смены и сверхурочные (Б4а): начнётся в `at` */
  | { why: 'hours'; bar: BarRef; role: Id; at: number }
  /** помещение занято другой серией до `until` */
  | { why: 'room'; bar: Id; room: string; batch?: string; until: number }
  /** помещение убирают: после серии, чистота просрочена, чисто только для другого продукта */
  | { why: 'clean'; bar: Id; room: string; work: number; major: boolean; cause: 'after' | 'expired' | 'product'; batch?: string }
  /** оборудование стадии ждёт ремонта */
  | { why: 'repair'; bar: Id; room: string }
  /** у оборудования или прибора МОК стадии — визит подрядчика до `until` (Б3в) */
  | { why: 'visit'; bar: Id; room: string; asset: string; work: 'qual' | 'cal'; until: number }
  /** у оборудования или прибора МОК стадии вышел срок, а визит не назначен: когда он будет, прогон не знает (Б3в) */
  | { why: 'unfit'; bar: Id; room: string; asset: string; work: 'qual' | 'cal' };

export interface Forecast {
  /** полосы сейчас и по плану; прошлое — у вида (src/sim/plan.ts) */
  bars: Bar[];
  /** причины по сериям, в порядке их полос */
  why: Record<string, Why[]>;
  /** задания без полос: материала не хватает, а заказа нет, или людей роли нет ни в одной смене */
  stuck: string[];
}

/** Новый срок «не раньше» у задания — черновик и призрак. */
export interface Change {
  batch: string;
  notBefore: number;
}

/** Новое задание черновика (0.0.39): срочное задание на серию — карта и позиция; «не раньше» — сейчас. */
export interface Fresh {
  recipe: Id;
  sku?: Id;
}

/**
 * Новые задания черновика — какими их поставят команды `order` в это мгновение, одна за другой: номера, которые они
 * получат, карта, действующая сегодня, и резерв по FEFO — тот же, что сделает движок, с тарой, которую уже взяли задания
 * раньше в черновике; не хватает материала — задание ждёт его. Состояние не меняется.
 */
export function freshBatches(db: ContentDb, s: PlantState, fresh: readonly Fresh[]): Batch[] {
  const out: Batch[] = [];
  let taken = new Map<string, number>();
  for (const f of fresh) {
    if (!db.recipes[f.recipe]) continue;
    const b = newBatch(db, s, `B${(s.next.B ?? 0) + out.length + 1}`, f.recipe, s.t, 'player', f.sku);
    const k = kitPlan(db, s, b.recipe, taken);
    if (k.short.length > 0) b.short = k.short;
    else {
      b.kit = k.kit;
      b.status = 'reserved';
      taken = k.taken;
    }
    out.push(b);
  }
  return out;
}

/** Дальше этого смену с людьми роли не ищут: людей роли нет. */
const LOOK = 31 * DAY;

const idNum = (id: string) => Number(id.slice(1));

/**
 * Люди по ролям: роль → люди и сколько сверхурочных ещё можно каждому на начало прогона, с (Б4а). Смена — у человека: его
 * график с переводами, дополнительными выходными (Б4б) и отпусками (Б4г). Заместитель — и в роли ушедшего, в дни
 * замещения (`days`, номера дней с и по).
 */
type Crew = Map<Id, { p: Person; left: number; days?: [number, number] }[]>;

/** Люди, допущенные сейчас к работе с документами `need`; заместители — и в ролях тех, кого замещают (как раздатчик). */
function crewOf(db: ContentDb, s: PlantState, need: readonly string[]): Crew {
  const day = momentOf(s.start, s.t).day;
  const c: Crew = new Map();
  const cover = coverWindows(s, day);
  for (const p of Object.values(s.people)) {
    if (!admitted(db, p, need, day)) continue;
    const left = overLeft(db, s, p, s.t);
    c.set(p.role, [...(c.get(p.role) ?? []), { p, left }]);
    for (const w of cover.get(p.id) ?? []) c.set(w.role, [...(c.get(w.role) ?? []), { p, left, days: [w.from, w.to] }]);
  }
  return c;
}

/** Задача для прогона (Б4а): вид, норма и наибольшая длительность, с. */
interface Job {
  kind: TaskKind;
  nom: number;
  max: number;
}

/**
 * Первое мгновение не раньше `t`, когда `n` человек ролей могут взять задачу — в смене, до её конца не меньше 15 минут
 * и задача помещается у них в часы (`fitsIn`), — и сколько их тогда; `hours` — в мгновение `t` люди в смене были, но
 * работа у них не помещалась. Смены начинаются в целые часы: если не сейчас — то в начале какого-то часа.
 */
function firstTake(db: ContentDb, s: PlantState, crew: Crew, roles: readonly Id[], n: number, t: number, job: Job): { t: number; n: number; hours: boolean } | undefined {
  const people = roles.flatMap(r => crew.get(r) ?? []);
  const base = daysFromCivil(s.start);
  let hours = false;
  for (let at = t; at <= t + LOOK; at = Math.floor(at / HOUR) * HOUR + HOUR) {
    let k = 0;
    let on = 0;
    const day = base + Math.floor(at / DAY);
    const seen = new Set<string>();
    for (const { p, left, days } of people) {
      if (seen.has(p.id) || (days && (day < days[0] || day > days[1]))) continue;
      seen.add(p.id);
      const end = shiftEndAt(db, s, p, at);
      if (end === undefined || end - at < LAST_CALL) continue;
      on++;
      if (fitsIn(job.kind, s.policy[db.roles[p.role].dept], end - at, job.nom, job.max, left)) k++;
    }
    if (k >= n) return { t: at, n: k, hours };
    if (at === t) hours = on >= n;
  }
  return undefined;
}

/**
 * Паллет с тарой комплекта, которых ещё нет на пластиковой паллете комплекта; у комплекта упаковки — и не в помещении
 * линии `room`: та тара на месте (Б4г, mes.ts).
 */
function palletsOf(s: PlantState, kit: KitLine[], kitUnit: string | undefined, room?: string): number {
  const units = new Set<string>();
  for (const k of kit) {
    const c = s.containers[k.container];
    if (!c || c.unit === kitUnit) continue;
    const w = s.units[c.unit]?.where;
    if (room && w?.kind === 'room' && w.id === room) continue;
    units.add(c.unit);
  }
  return units.size;
}

/** Помещение в прогоне: копия учёта; когда свободно и убрано; какая серия ушла последней, когда, и уборка после неё. */
interface Proj {
  room: Room;
  free: number;
  last?: string;
  left?: number;
  work: number;
  major: boolean;
}

/**
 * Прогон: идущие задачи — до их конца; дальше — по правилам движка. Комплектовка — одна на завод: когда она свободна,
 * берёт первое по порядку создания задание, чей срок настал, а нет такого — чей настанет раньше; работа — в смене
 * кладовщиков: по паллетам комплекта, кладовщики перекладывают параллельно (гипотеза: перевозки к шлюзу быстрее
 * перекладки). Стадия — когда кончилась прошлая, помещение свободно, убрано и готово (`readyFor`) и в смене есть люди
 * её роли. Ушла серия из помещения — уборка, как только аппаратчик в смене; генеральная — если грязно дольше суток.
 * `fresh` — новые задания черновика (0.0.39): прогон ставит их после существующих, как поставят команды.
 */
export function forecast(db: ContentDb, s: PlantState, changes: readonly Change[] = [], fresh: readonly Fresh[] = []): Forecast {
  const asked = new Map(changes.map(c => [c.batch, c.notBefore]));
  const plan = planOf(db, s.plant);
  const now = s.t;
  const crews = new Map<string, Crew>();
  const out: Forecast = { bars: [], why: {}, stuck: [] };
  const note = (b: string, w: Why) => (out.why[b] ??= []).push(w);
  const take = (roles: readonly Id[], n: number, t: number, need: readonly string[], job: Job) => {
    const key = need.join(' ');
    let crew = crews.get(key);
    if (!crew) crews.set(key, (crew = crewOf(db, s, need)));
    return firstTake(db, s, crew, roles, n, t, job);
  };
  const lineRoom = (id: string) => plan.plant.lines.find(l => l.id === id)?.room;
  const cleanNeed = needFor(db, 'clean');
  const roomNeed = needFor(db, 'roomClean');
  const kitNeed = needFor(db, 'transfer');

  // визиты подрядчика (Б3в): у начатого — его часы; у назначенного — с какого мгновения актив новых работ не берёт; окно
  // работы встаёт, когда прогон знает, чем актив занят до неё. Работу, которую уже ждут с приёмкой, прогон не держит
  const hours = db.scenarios[s.scenario].assets.hours;
  const places = placesOf(plan.plant);
  interface Vis {
    asset: string;
    work: 'qual' | 'cal';
    at: number;
    len: number;
    from?: number;
    to?: number;
    now: boolean;
  }
  const visits = new Map<string, Vis>();
  for (const a of Object.values(s.assets)) {
    const v = a.visit;
    if (!v || v.task !== undefined) continue;
    const len = classOf(db, a)[v.work]?.work ?? 0;
    visits.set(a.id, { asset: a.id, work: v.work, at: v.at, len, ...(v.from !== undefined ? { from: v.from, to: v.to, now: true } : { now: false }) });
  }
  /** Первое мгновение не раньше `t`, когда подрядчик может начать работу длиной `len`: рабочий день, его часы. */
  const contractorAt = (t: number, len: number): number => {
    for (let at = t, i = 0; i < 400; i++) {
      const m = momentOf(s.start, at);
      const day = at - m.sec;
      if (isWorkday(calOf(db, s), m.day) && m.sec <= hours[1] - len) return Math.max(at, day + hours[0]);
      at = day + DAY + hours[0];
    }
    return t;
  };
  /** Окно визита, если работа подрядчика может начаться не раньше `free`. */
  const fix = (v: Vis, free: number) => {
    if (v.from !== undefined) return;
    v.from = contractorAt(Math.max(v.at, now, free), v.len);
    v.to = v.from + v.len;
  };
  // актив занят идущей стадией — подрядчик после её конца
  const held = new Map<string, number>();
  const taskOf = (f: (t: Task) => boolean) => Object.values(s.tasks).find(f);
  const order = [...Object.values(s.batches), ...freshBatches(db, s, fresh)];

  // последняя серия в помещении по записям — для причины «убрать после серии» у грязного сейчас помещения
  const lastIn = new Map<string, { batch: string; end: number }>();
  for (const b of order) for (const r of b.records) if ((lastIn.get(r.room)?.end ?? -1) < r.end) lastIn.set(r.room, { batch: b.id, end: r.end });

  const rooms = new Map<string, Proj>();
  for (const r of Object.values(s.rooms)) rooms.set(r.id, { room: { ...r }, free: now, work: 0, major: false });

  /**
   * Уборка помещения (Б4в): мойка оборудования — как только аппаратчик в смене не раньше `at`, потом уборка помещения —
   * как только уборщик в смене после мойки; полосы обеих. Генеральная — если помечено или грязно дольше суток к началу
   * мойки, а без оборудования — к началу уборки помещения (mesHour). Мойка уже идёт или кончилась — `wash`: её конец.
   * Помещение чистое — для продукта прошлой серии или, после генеральной, для любого; не предсказать — `undefined`.
   */
  const cleanFrom = (p: Proj, at: number, dirtySince: number, when: Bar['when'], batch?: string, force?: boolean, wash?: { from: number; to: number; work: number }) => {
    const r = p.room;
    let major = !!r.major || !!force;
    let end = at;
    let work = 0;
    const washes = !!wash || washWork(db, s, r.id, major) > 0;
    if (wash) {
      if (wash.to > wash.from) out.bars.push({ row: r.id, kind: 'clean', ...(batch ? { batch } : {}), from: wash.from, to: wash.to, when: 'now', ...(major ? { major: true as const } : {}) });
      end = wash.to;
      work += wash.work;
    } else {
      const w = washWork(db, s, r.id, major);
      if (w > 0) {
        const c = take(MES.operators, 1, at, cleanNeed, { kind: 'clean', nom: w, max: w });
        if (!c) return undefined;
        if (!major && c.t - dirtySince > DIRTY_HOLD) major = true;
        const sec = washWork(db, s, r.id, major);
        out.bars.push({ row: r.id, kind: 'clean', ...(batch ? { batch } : {}), from: c.t, to: c.t + sec, when, ...(major ? { major: true as const } : {}) });
        end = c.t + sec;
        work += sec;
      }
    }
    let rw = roomWork(db, s, r.id, major);
    if (rw > 0) {
      const c = take(MES.cleaners, 1, end, roomNeed, { kind: 'roomClean', nom: rw, max: rw });
      if (!c) return undefined;
      if (!washes && !major && c.t - dirtySince > DIRTY_HOLD) {
        major = true;
        rw = roomWork(db, s, r.id, major);
      }
      out.bars.push({ row: r.id, kind: 'roomClean', ...(batch ? { batch } : {}), from: c.t, to: c.t + rw, when, ...(major ? { major: true as const } : {}) });
      end = c.t + rw;
      work += rw;
    }
    r.status = 'clean';
    r.since = end;
    if (major) delete r.cleanFor;
    else if (r.product) r.cleanFor = r.product;
    delete r.major;
    delete r.washed;
    p.free = end;
    p.work = work;
    p.major = major;
    return end;
  };

  /** Серия ушла из помещения в `at`: грязное; уборка — как только аппаратчик в смене (политика мастера по умолчанию). */
  const leave = (roomId: string, b: Batch, at: number) => {
    const p = rooms.get(roomId)!;
    const r = p.room;
    r.status = 'dirty';
    delete r.batch;
    r.since = at;
    r.product = b.product;
    p.last = b.id;
    p.left = at;
    if (cleanFrom(p, at, at, 'plan', b.id) === undefined) p.free = Number.POSITIVE_INFINITY;
  };

  // грязные сейчас: мойка или уборка помещения идёт по задаче или начнётся, как только люди в смене
  for (const p of rooms.values()) {
    const r = p.room;
    if (r.status !== 'dirty') continue;
    const was = lastIn.get(r.id);
    p.left = r.since;
    if (was) p.last = was.batch;
    const w = taskOf(x => x.kind === 'clean' && x.room === r.id);
    const rc = taskOf(x => x.kind === 'roomClean' && x.room === r.id);
    let end: number | undefined;
    if (rc?.state === 'busy') {
      // уборка помещения идёт — оборудование уже вымыто
      out.bars.push({ row: r.id, kind: 'roomClean', ...(p.last ? { batch: p.last } : {}), from: rc.times![1], to: rc.times![4], when: 'now', ...(r.major ? { major: true as const } : {}) });
      end = rc.times![4];
      r.status = 'clean';
      r.since = end;
      if (r.major) delete r.cleanFor;
      else if (r.product) r.cleanFor = r.product;
      p.free = end;
      p.work = rc.times![4] - rc.times![1];
      p.major = !!r.major;
      delete r.major;
      delete r.washed;
    } else if (w?.state === 'busy') end = cleanFrom(p, now, r.since, 'plan', p.last, false, { from: w.times![1], to: w.times![4], work: w.times![4] - w.times![1] });
    else if (r.washed) end = cleanFrom(p, now, r.since, 'plan', p.last, false, { from: now, to: now, work: 0 });
    else end = cleanFrom(p, now, r.since, 'plan', p.last);
    if (end === undefined) p.free = Number.POSITIVE_INFINITY;
  }

  /** Стадии серии с `k0`, если серия готова к ним в `t0`. */
  const stages = (b: Batch, k0: number, t0: number, flags: { material?: true }) => {
    const r = db.recipes[b.recipe];
    let t = t0;
    for (let k = k0; k < r.stages.length; k++) {
      const st = r.stages[k];
      const roomId = plan.roomOf[st.room];
      const p = rooms.get(roomId)!;
      if (p.room.batch !== b.id) {
        // в помещении серия, которая в прогоне из него не уходит, — дальше не предсказать
        if (p.room.batch || p.free === Number.POSITIVE_INFINITY) return;
        if (p.free > t) {
          if (p.left !== undefined && p.left > t) note(b.id, { why: 'room', bar: st.id, room: roomId, ...(p.last ? { batch: p.last } : {}), until: p.left });
          note(b.id, { why: 'clean', bar: st.id, room: roomId, work: p.work, major: p.major, cause: 'after', ...(p.last ? { batch: p.last } : {}) });
          t = p.free;
        }
        if (!readyFor(p.room, b.product, t)) {
          // чисто только для другого продукта — генеральная уборка; чистота просрочена — убрать снова (tryStart)
          const cause = p.room.cleanFor !== undefined && p.room.cleanFor !== b.product ? 'product' : 'expired';
          const end = cleanFrom(p, t, t, 'plan', b.id, cause === 'product');
          if (end === undefined) return;
          note(b.id, { why: 'clean', bar: st.id, room: roomId, work: p.work, major: p.major, cause });
          t = end;
        }
        p.room.status = 'busy';
        p.room.batch = b.id;
      }
      const repair = Object.values(s.equipment).some(e => e.room === roomId && st.equipment.includes(e.type) && blocked(s, e.id));
      if (repair) note(b.id, { why: 'repair', bar: st.id, room: roomId });
      const work = nominal(db, b.recipe, st, stageMass(db, b, k));
      // активы стадии (Б3в): срок вышел, а визита нет — дальше не предсказать; с часа визита — после его конца
      const mine = assetsOf(st, roomId);
      // срок вышел сейчас: стадия — только после визита, когда бы он ни был назначен
      const expired = new Set(mine.filter(id => (unfit(db, s, id) ?? 'visit') !== 'visit'));
      const dead = [...expired].find(id => !visits.has(id));
      if (dead) {
        note(b.id, { why: 'unfit', bar: st.id, room: roomId, asset: dead, work: unfit(db, s, dead) as 'qual' | 'cal' });
        return;
      }
      const [nom, max] = stageNorm(db, b.recipe, st, stageMass(db, b, k));
      const job: Job = { kind: 'stage', nom, max };
      let c = take([st.staff.role], st.staff.n, t, needFor(db, 'stage', { stage: st }), job);
      if (!c) return;
      for (let i = 0; i < 8; i++) {
        let at = c.t;
        for (const id of mine) {
          const v = visits.get(id);
          if (!v || (at < v.at && !expired.has(id))) continue;
          fix(v, held.get(id) ?? now);
          if (at < v.to! && at + work > v.from!) {
            note(b.id, { why: 'visit', bar: st.id, room: roomId, asset: id, work: v.work, until: v.to! });
            at = v.to!;
          }
        }
        if (at === c.t) break;
        c = take([st.staff.role], st.staff.n, at, needFor(db, 'stage', { stage: st }), job);
        if (!c) return;
      }
      if (c.t > t && !(out.why[b.id] ?? []).some(w => w.why === 'visit' && w.bar === st.id)) note(b.id, { why: c.hours ? 'hours' : 'shift', bar: st.id, role: st.staff.role, at: c.t });
      out.bars.push({ row: roomId, kind: 'stage', batch: b.id, stage: st.id, from: c.t, to: c.t + work, when: 'plan', ...flags, ...(repair ? { repair: true as const } : {}) });
      // визит, чей час ещё не настал: подрядчик — после этой стадии
      for (const id of mine) {
        held.set(id, Math.max(held.get(id) ?? now, c.t + work));
        const v = visits.get(id);
        if (v && v.from === undefined && c.t < v.at) fix(v, c.t + work);
      }
      t = c.t + work;
      const next = r.stages[k + 1];
      if (!next || plan.roomOf[next.room] !== roomId) leave(roomId, b, t);
    }
  };

  /** Активы стадии в её помещении: оборудование её видов и приборы её МОК (Б3в). */
  const assetsOf = (st: (typeof db.recipes)[string]['stages'][number], roomId: string): string[] => [
    ...Object.values(s.equipment).filter(e => e.room === roomId && st.equipment.includes(e.type)).map(e => e.id),
    ...stageMeters(db, s, st, roomId),
  ];

  /** Серия на стадиях: идущая стадия — до конца задачи; ждущая людей — когда они в смене; после отказа — остаток работы. */
  const inProcess = (b: Batch) => {
    const r = db.recipes[b.recipe];
    if (b.stage >= r.stages.length) return;
    const st = r.stages[b.stage];
    const roomId = plan.roomOf[st.room];
    const t = taskOf(x => x.kind === 'stage' && x.batch === b.id);
    let end: number;
    if (t?.state === 'busy') {
      out.bars.push({ row: roomId, kind: 'stage', batch: b.id, stage: st.id, from: t.times![1], to: t.times![4], when: 'now' });
      end = t.times![4];
      for (const id of assetsOf(st, roomId)) held.set(id, Math.max(held.get(id) ?? now, end));
    } else if (t || b.run?.rest !== undefined) {
      const work = t ? t.work : b.run!.rest!;
      const repair = !t;
      if (repair) note(b.id, { why: 'repair', bar: st.id, room: roomId });
      const [nom, max] = t?.norm ?? stageTaskNorm(db, b);
      const c = take([st.staff.role], st.staff.n, now, needFor(db, 'stage', { stage: st }), { kind: 'stage', nom, max });
      if (!c) return;
      if (c.t > now) note(b.id, { why: c.hours ? 'hours' : 'shift', bar: st.id, role: st.staff.role, at: c.t });
      out.bars.push({ row: roomId, kind: 'stage', batch: b.id, stage: st.id, from: c.t, to: c.t + work, when: 'plan', ...(repair ? { repair: true as const } : {}) });
      end = c.t + work;
    } else return stages(b, b.stage, now, {});
    const next = r.stages[b.stage + 1];
    if (!next || plan.roomOf[next.room] !== roomId) leave(roomId, b, end);
    stages(b, b.stage + 1, end, {});
  };

  /** Работа комплектовки с `from`: паллеты — по кладовщикам смены, по перекладке на каждую. */
  const kitWork = (batch: string | undefined, pallets: number, from: number): number | undefined => {
    if (pallets === 0) return from;
    const c = take(WMS.keepers, 1, from, kitNeed, { kind: 'transfer', nom: TRANSFER_WORK, max: TRANSFER_WORK });
    if (!c) return undefined;
    if (batch && c.t > from) note(batch, { why: c.hours ? 'hours' : 'shift', bar: 'kit', role: WMS.keepers[0], at: c.t });
    return c.t + Math.ceil(pallets / c.n) * TRANSFER_WORK;
  };

  // комплектовка сейчас — одна: комплект упаковки или серии; держит её до конца
  let slot = now;
  let holder: { batch: string; pack: boolean } | undefined;
  for (const b of order) {
    const job = b.status === 'packing' ? b.pack : undefined;
    if (job?.state !== 'kitting') continue;
    const end = kitWork(undefined, palletsOf(s, job.kit, job.kitUnit, lineRoom(job.line)), now) ?? now;
    out.bars.push({ row: 'kit', kind: 'kit', batch: b.id, from: now, to: end, when: 'now', pack: true });
    slot = Math.max(slot, end);
    holder = { batch: b.id, pack: true };
  }
  // серии в работе — по порядку комплектации (выдачи досье): кто раньше в помещениях, тот раньше и дальше. У досье до
  // схемы 15 момента выдачи нет — они раньше всех, между собой — по прежнему порядковому номеру
  const active = order.filter(b => b.status === 'kitting' || b.status === 'process').sort((a, c) => (a.issued ?? 0) - (c.issued ?? 0) || a.code.n - c.code.n);
  for (const b of active) {
    if (b.status === 'process') {
      inProcess(b);
      continue;
    }
    const end = kitWork(b.id, palletsOf(s, b.kit, b.kitUnit), now);
    if (end === undefined) {
      out.stuck.push(b.id);
      continue;
    }
    out.bars.push({ row: 'kit', kind: 'kit', batch: b.id, from: now, to: end, when: 'now' });
    slot = Math.max(slot, end);
    holder = { batch: b.id, pack: false };
    stages(b, 0, end, {});
  }

  /** Когда задание с нехваткой получит материал: партия уже в лаборатории или у рампы — не раньше сейчас; иначе — ближайший заказ поставщику; заказа нет — `undefined`. */
  const materialAt = (b: Batch): number | undefined => {
    let at: number | undefined = now;
    for (const sh of b.short ?? []) {
      const lab =
        Object.values(s.lots).some(l => l.material === sh.material && (l.status === 'quarantine' || l.status === 'sampled' || l.status === 'testing')) ||
        Object.values(s.trucks).some(tr => tr.po && s.pos[tr.po]?.lines.some(l => l.material === sh.material));
      if (lab) {
        note(b.id, { why: 'material', bar: 'kit', material: sh.material, qty: sh.qty, lab: true });
        continue;
      }
      const po = Object.values(s.pos)
        .filter(p => p.status === 'ordered' && p.lines.some(l => l.material === sh.material))
        .sort((x, y) => x.eta - y.eta || idNum(x.id) - idNum(y.id))[0];
      note(b.id, { why: 'material', bar: 'kit', material: sh.material, qty: sh.qty, ...(po ? { po: po.id, eta: po.eta } : {}) });
      at = po && at !== undefined ? Math.max(at, po.eta) : undefined;
    }
    return at;
  };

  // очередь комплектовки: задания, ещё не начавшие её, и зарезервированные комплекты упаковки — в порядке создания
  const queue: { b: Batch; at: number; pallets: number; pack: boolean; material: boolean }[] = [];
  for (const b of order) {
    if (b.status === 'packing' && b.pack?.state === 'reserved') queue.push({ b, at: now, pallets: palletsOf(s, b.pack.kit, b.pack.kitUnit, lineRoom(b.pack.line)), pack: true, material: false });
    if (b.status !== 'waiting' && b.status !== 'reserved') continue;
    const want = asked.get(b.id) ?? b.notBefore;
    if (asked.has(b.id) && want < now) note(b.id, { why: 'past', bar: 'kit' });
    let at = Math.max(now, want);
    if (b.status === 'waiting') {
      const m = materialAt(b);
      if (m === undefined) {
        out.stuck.push(b.id);
        continue;
      }
      at = Math.max(at, m);
    }
    queue.push({ b, at, pallets: b.status === 'reserved' ? palletsOf(s, b.kit, b.kitUnit) : db.recipes[b.recipe].bom.length, pack: false, material: b.status === 'waiting' });
  }
  while (queue.length > 0) {
    // когда комплектовка свободна — первое по порядку задание, чей срок настал; нет такого — чей настанет раньше
    let i = queue.findIndex(c => c.at <= slot);
    if (i < 0) {
      i = 0;
      for (let j = 1; j < queue.length; j++) if (queue[j].at < queue[i].at) i = j;
    }
    const c = queue.splice(i, 1)[0];
    const from = Math.max(slot, c.at);
    if (holder && slot > c.at && !c.pack) note(c.b.id, { why: 'kitting', bar: 'kit', batch: holder.batch, pack: holder.pack, until: slot });
    const end = kitWork(c.pack ? undefined : c.b.id, c.pallets, from);
    if (end === undefined) {
      // кладовщиков нет ни в одной смене — дальше комплектовку не предсказать
      for (const x of [c, ...queue]) if (!x.pack) out.stuck.push(x.b.id);
      break;
    }
    out.bars.push({ row: 'kit', kind: 'kit', batch: c.b.id, from, to: end, when: 'plan', ...(c.pack ? { pack: true as const } : {}), ...(c.material ? { material: true as const } : {}) });
    slot = end;
    holder = { batch: c.b.id, pack: c.pack };
    if (!c.pack) stages(c.b, 0, end, c.material ? { material: true } : {});
  }
  // полосы визитов подрядчика (Б3в): в строке помещения — у оборудования и приборов МОК, в строке линии — у её машин
  for (const v of visits.values()) {
    const th = places.thing[v.asset];
    const row = th?.family === 'machine' ? th.line : th?.family === 'equipment' || th?.family === 'ipc' ? th.room : undefined;
    if (!row) continue;
    fix(v, held.get(v.asset) ?? now);
    out.bars.push({ row, kind: 'visit', from: v.from!, to: v.to!, when: v.now ? 'now' : 'plan', asset: v.asset, work: v.work });
  }
  return out;
}
