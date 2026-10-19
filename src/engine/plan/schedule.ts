// Прогон расписания (docs/specs/2026-10-panels.md, 3д; docs/02-architecture.md, §8): что, где и когда будет делаться, —
// чистая функция из состояния; состояние не меняется. Правила — те же, что у движка, и из тех же его функций: готово ли
// помещение для продукта (`readyFor`), номинальная длительность стадии (`nominal`), время уборки (`cleanWork`), может ли
// человек смены взять задачу (`takesAt`). Разброса нет: жизнь отличается от прогона на разброс длительностей, на людей,
// занятых другим, на отказы и ремонты и на комплекты упаковки, которые появятся позже, — их прогон не предсказывает.
import type { ContentDb, Id } from '../../content/types';
import { DAY, HOUR } from '../core/calendar';
import { blocked } from '../maint';
import { cleanWork, DIRTY_HOLD, MES, nominal, readyFor, TRANSFER_WORK } from '../mes';
import { planOf } from '../plant';
import { takesAt } from '../staff';
import type { Batch, KitLine, PlantState, Room, Task } from '../types';
import { WMS } from '../wms';

/** Полоса Ганта: строка — `kit` (комплектовка у шлюза для материалов), помещение или линия плана. */
export interface Bar {
  row: string;
  kind: 'kit' | 'stage' | 'clean' | 'setup' | 'pack';
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
  /** помещение занято другой серией до `until` */
  | { why: 'room'; bar: Id; room: string; batch?: string; until: number }
  /** помещение убирают: после серии, чистота просрочена, чисто только для другого продукта */
  | { why: 'clean'; bar: Id; room: string; work: number; major: boolean; cause: 'after' | 'expired' | 'product'; batch?: string }
  /** оборудование стадии ждёт ремонта */
  | { why: 'repair'; bar: Id; room: string };

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

/** Дальше этого смену с людьми роли не ищут: людей роли нет. */
const LOOK = 31 * DAY;

const idNum = (id: string) => Number(id.slice(1));

/** Люди по ролям и графикам: роль → график → сколько человек. */
type Crew = Map<Id, Map<Id, number>>;

function crewOf(s: PlantState): Crew {
  const c: Crew = new Map();
  for (const p of Object.values(s.people)) {
    const m = c.get(p.role) ?? new Map<Id, number>();
    m.set(p.shift, (m.get(p.shift) ?? 0) + 1);
    c.set(p.role, m);
  }
  return c;
}

/**
 * Первое мгновение не раньше `t`, когда `n` человек ролей могут взять задачу (`takesAt`: в смене и до её конца не меньше
 * 15 минут), и сколько их тогда. Смены начинаются в целые часы: если не сейчас — то в начале какого-то часа.
 */
function firstTake(db: ContentDb, s: PlantState, crew: Crew, roles: readonly Id[], n: number, t: number): { t: number; n: number } | undefined {
  const shifts = new Map<Id, number>();
  for (const r of roles) for (const [sh, k] of crew.get(r) ?? []) shifts.set(sh, (shifts.get(sh) ?? 0) + k);
  for (let at = t; at <= t + LOOK; at = Math.floor(at / HOUR) * HOUR + HOUR) {
    let k = 0;
    for (const [sh, c] of shifts) if (takesAt(db, s.start, sh, at)) k += c;
    if (k >= n) return { t: at, n: k };
  }
  return undefined;
}

/** Паллет с тарой комплекта, которых ещё нет на пластиковой паллете комплекта. */
function palletsOf(s: PlantState, kit: KitLine[], kitUnit: string | undefined): number {
  const units = new Set<string>();
  for (const k of kit) {
    const c = s.containers[k.container];
    if (c && c.unit !== kitUnit) units.add(c.unit);
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
 * её роли. Ушла серия из помещения — уборка, как только аппаратчик в смене; большая — если грязно дольше суток.
 */
export function forecast(db: ContentDb, s: PlantState, changes: readonly Change[] = []): Forecast {
  const asked = new Map(changes.map(c => [c.batch, c.notBefore]));
  const plan = planOf(db, s.plant);
  const now = s.t;
  const crew = crewOf(s);
  const out: Forecast = { bars: [], why: {}, stuck: [] };
  const note = (b: string, w: Why) => (out.why[b] ??= []).push(w);
  const take = (roles: readonly Id[], n: number, t: number) => firstTake(db, s, crew, roles, n, t);
  const taskOf = (f: (t: Task) => boolean) => Object.values(s.tasks).find(f);
  const order = Object.values(s.batches);

  // последняя серия в помещении по записям — для причины «убрать после серии» у грязного сейчас помещения
  const lastIn = new Map<string, { batch: string; end: number }>();
  for (const b of order) for (const r of b.records) if ((lastIn.get(r.room)?.end ?? -1) < r.end) lastIn.set(r.room, { batch: b.id, end: r.end });

  const rooms = new Map<string, Proj>();
  for (const r of Object.values(s.rooms)) rooms.set(r.id, { room: { ...r }, free: now, work: 0, major: false });

  /** Уборка помещения с `from`: полоса; помещение чистое — для продукта прошлой серии или, после большой, для любого. */
  const clean = (p: Proj, from: number, work: number, major: boolean, when: Bar['when'], batch?: string) => {
    out.bars.push({ row: p.room.id, kind: 'clean', ...(batch ? { batch } : {}), from, to: from + work, when, ...(major ? { major: true as const } : {}) });
    const r = p.room;
    r.status = 'clean';
    r.since = from + work;
    if (major) delete r.cleanFor;
    else if (r.product) r.cleanFor = r.product;
    delete r.major;
    p.free = from + work;
    p.work = work;
    p.major = major;
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
    const c = take(MES.operators, 1, at);
    if (!c) {
      p.free = Number.POSITIVE_INFINITY;
      return;
    }
    // грязное ждёт уборки дольше суток — большая (mesHour)
    const major = !!r.major || c.t - at > DIRTY_HOLD;
    clean(p, c.t, cleanWork(db, s, roomId, major), major, 'plan', b.id);
  };

  // грязные сейчас: уборка идёт по задаче или начнётся, как только аппаратчик в смене
  for (const p of rooms.values()) {
    const r = p.room;
    if (r.status !== 'dirty') continue;
    const was = lastIn.get(r.id);
    p.left = r.since;
    if (was) p.last = was.batch;
    const t = taskOf(x => x.kind === 'clean' && x.room === r.id);
    if (t?.state === 'busy') {
      clean(p, t.times![1], t.times![4] - t.times![1], !!r.major, 'now', p.last);
      continue;
    }
    const c = take(MES.operators, 1, now);
    if (!c) {
      p.free = Number.POSITIVE_INFINITY;
      continue;
    }
    const major = !!r.major || c.t - r.since > DIRTY_HOLD;
    clean(p, c.t, major && !r.major ? cleanWork(db, s, r.id, true) : (t?.work ?? cleanWork(db, s, r.id, major)), major, 'plan', p.last);
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
          // чисто только для другого продукта — большая уборка; чистота просрочена — убрать снова (tryStart)
          const cause = p.room.cleanFor !== undefined && p.room.cleanFor !== b.product ? 'product' : 'expired';
          const c = take(MES.operators, 1, t);
          if (!c) return;
          const major = cause === 'product' || c.t - t > DIRTY_HOLD;
          const work = cleanWork(db, s, roomId, major);
          note(b.id, { why: 'clean', bar: st.id, room: roomId, work, major, cause });
          clean(p, c.t, work, major, 'plan', b.id);
          t = c.t + work;
        }
        p.room.status = 'busy';
        p.room.batch = b.id;
      }
      const repair = Object.values(s.equipment).some(e => e.room === roomId && st.equipment.includes(e.type) && blocked(s, e.id));
      if (repair) note(b.id, { why: 'repair', bar: st.id, room: roomId });
      const c = take([st.staff.role], st.staff.n, t);
      if (!c) return;
      if (c.t > t) note(b.id, { why: 'shift', bar: st.id, role: st.staff.role, at: c.t });
      const work = nominal(db, b.recipe, st, b.mass > 0 ? b.mass : r.batch.mass);
      out.bars.push({ row: roomId, kind: 'stage', batch: b.id, stage: st.id, from: c.t, to: c.t + work, when: 'plan', ...flags, ...(repair ? { repair: true as const } : {}) });
      t = c.t + work;
      const next = r.stages[k + 1];
      if (!next || plan.roomOf[next.room] !== roomId) leave(roomId, b, t);
    }
  };

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
    } else if (t || b.run?.rest !== undefined) {
      const work = t ? t.work : b.run!.rest!;
      const repair = !t;
      if (repair) note(b.id, { why: 'repair', bar: st.id, room: roomId });
      const c = take([st.staff.role], st.staff.n, now);
      if (!c) return;
      if (c.t > now) note(b.id, { why: 'shift', bar: st.id, role: st.staff.role, at: c.t });
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
    const c = take(WMS.keepers, 1, from);
    if (!c) return undefined;
    if (batch && c.t > from) note(batch, { why: 'shift', bar: 'kit', role: WMS.keepers[0], at: c.t });
    return c.t + Math.ceil(pallets / c.n) * TRANSFER_WORK;
  };

  // комплектовка сейчас — одна: комплект упаковки или серии; держит её до конца
  let slot = now;
  let holder: { batch: string; pack: boolean } | undefined;
  for (const b of order) {
    const job = b.status === 'packing' ? b.pack : undefined;
    if (job?.state !== 'kitting') continue;
    const end = kitWork(undefined, palletsOf(s, job.kit, job.kitUnit), now) ?? now;
    out.bars.push({ row: 'kit', kind: 'kit', batch: b.id, from: now, to: end, when: 'now', pack: true });
    slot = Math.max(slot, end);
    holder = { batch: b.id, pack: true };
  }
  // серии в работе — по порядку комплектации (номер серии): кто раньше в помещениях, тот раньше и дальше
  const active = order.filter(b => b.status === 'kitting' || b.status === 'process').sort((a, c) => a.code.n - c.code.n);
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
    if (b.status === 'packing' && b.pack?.state === 'reserved') queue.push({ b, at: now, pallets: palletsOf(s, b.pack.kit, b.pack.kitUnit), pack: true, material: false });
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
  return out;
}
