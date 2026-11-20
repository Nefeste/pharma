/**
 * Переход кампании (Б9, шаг 4; docs/specs/2026-10-vertical-slice.md, «Шаг 4. Переход кампании»; решение владельца
 * 18.11.2026, #184): завод сценария переходит в следующий по номеру кампании. Остаётся всё — план и его вещи, люди,
 * партии, серии, касса и книга, журнал, политики и режимы игрока, хроника. Чего следующему не хватает, он достраивает и
 * выдаёт: помещения и единицы своего плана, которых у завода нет, — если их место на участке свободно и план проходит
 * проверки, иначе деньги на постройку; продукты, введённые до его старта; покупателей; людей до штата по ролям; кассу до
 * своей стартовой; материалы запаса, которых на складе нет. Места игрока освобождаются: межсезонье завод живёт сам, а со
 * старта следующего сценария игрок снова выбирает места. Время завода — по-прежнему от первой даты кампании; сутки
 * следующего сценария — от его даты (`scnZero`).
 */
import type { ContentDb, Plant, Scenario } from '../content/types';
import { seedAssets } from './assets';
import { post } from './cash';
import { DAY, daysFromCivil, HOUR, momentOf } from './core/calendar';
import { schedule } from './core/agenda';
import { projectDocs, recipeOf } from './project';
import { newParts } from './maint';
import { carryPairs, seedContracts, specPairs } from './partners';
import { liveOf } from './docs';
import { coldOf } from './places';
import { planOf } from './plant';
import { levelOf, siteErrors } from './site/checks';
import { hullPrice, roomPrice } from './site/edit';
import { unitPrice } from './site/units';
import { createLot, findSlot } from './stock';
import { seedTraining } from './train';
import type { Notice, PlantState, SitePlan } from './types';

/** Полночь первого дня сценария завода в секундах завода: у завода, начатого этим сценарием, — 0. */
export function scnZero(db: ContentDb, s: Pick<PlantState, 'scenario' | 'start'>): number {
  return (daysFromCivil(db.scenarios[s.scenario].start.date) - daysFromCivil(s.start)) * DAY;
}

/** Мгновение старта игрока в сценарии завода: после его прогрева. */
export const playerStart = (db: ContentDb, s: Pick<PlantState, 'scenario' | 'start'>): number => {
  const sc = db.scenarios[s.scenario];
  return scnZero(db, s) + sc.start.hour * HOUR + sc.warm;
};

/** Следующий сценарий кампании: номер на один больше; нет — нет. */
export function nextScenario(db: ContentDb, id: string): Scenario | undefined {
  const n = db.scenarios[id]?.campaign;
  if (n === undefined) return undefined;
  return Object.values(db.scenarios).find(x => x.campaign === n + 1);
}

/** Почему перейти нельзя; можно — `undefined`. */
export function carryBlock(db: ContentDb, s: PlantState): 'noNext' | 'notEnded' | 'tooLate' | undefined {
  const next = nextScenario(db, s.scenario);
  if (!next) return 'noNext';
  const sc = db.scenarios[s.scenario];
  if (sc.days === undefined || s.t < playerStart(db, s) + sc.days) return 'notEnded';
  const zero = (daysFromCivil(next.start.date) - daysFromCivil(s.start)) * DAY;
  if (s.t >= zero + next.start.hour * HOUR) return 'tooLate';
  return undefined;
}

/** Строки плана, которых у завода нет: по id. */
const missing = <T extends { id: string }>(have: readonly T[], want: readonly T[]) => want.filter(x => !have.some(h => h.id === x.id));

/**
 * План завода с тем, чего у него нет из плана следующего сценария: прямоугольники корпуса, помещения, двери, оборудование,
 * приборы и их места на участках. Уже есть помещение каждого нового типа с единицами нужных видов — ничего. Не встало —
 * пересеклось с тем, что построил игрок, или план не проходит проверки, — `undefined`.
 */
export function wingOf(db: ContentDb, plan: SitePlan, want: Plant): { plan?: SitePlan; rooms: Plant['rooms']; equipment: Plant['equipment']; instruments: Plant['instruments']; hull: Plant['hull'] } {
  const rooms = missing(plan.rooms, want.rooms);
  const equipment = missing(plan.equipment, want.equipment);
  const instruments = missing(plan.instruments, want.instruments);
  const hull = want.hull.filter(h => !plan.hull.some(x => x.every((v, i) => v === h[i])));
  const empty = { rooms: [], equipment: [], instruments: [], hull: [] };
  if (rooms.length === 0 && equipment.length === 0 && instruments.length === 0) return empty;
  // игрок уже построил своё: помещение того же типа и единицы тех же видов в помещениях этого типа
  const typesHere = (type: string) => plan.rooms.filter(r => r.type === type).map(r => r.id);
  const built =
    rooms.every(r => typesHere(r.type).length > 0) &&
    equipment.every(e => {
      const type = want.rooms.find(r => r.id === e.room)?.type;
      return plan.equipment.some(x => x.type === e.type && (!type || typesHere(type).includes(x.room)));
    });
  if (built) return empty;
  const doors = want.doors.filter(d => !plan.doors.some(x => x.cell[0] === d.cell[0] && x.cell[1] === d.cell[1]));
  const ids = new Set(rooms.map(r => r.id));
  const areas = plan.areas.map(a => {
    const w = want.areas.find(x => x.code === a.code);
    if (!w) return a;
    return { ...a, rooms: [...a.rooms, ...w.rooms.filter(r => ids.has(r) && !a.rooms.includes(r))], centers: [...a.centers, ...w.centers.filter(c => !a.centers.some(x => x.code === c.code))] };
  });
  const ipc = missing(plan.ipc, want.ipc);
  const sensors = missing(plan.sensors, want.sensors);
  const next: SitePlan = {
    ...plan,
    rev: (plan.rev ?? 0) + 1,
    hull: [...plan.hull, ...hull],
    rooms: [...plan.rooms, ...rooms],
    doors: [...plan.doors, ...doors],
    equipment: [...plan.equipment, ...equipment],
    instruments: [...plan.instruments, ...instruments],
    ipc: [...plan.ipc, ...ipc],
    sensors: [...plan.sensors, ...sensors],
    areas,
  };
  // место занято тем, что построил игрок: новое помещение на клетках прежнего — не встало
  const cells = (r: { rect: [number, number, number, number] }) => {
    const [x, z, w, d] = r.rect;
    return { x0: x + 100, z0: z + 100, x1: x + w - 100, z1: z + d - 100 };
  };
  const overlap = rooms.some(r => {
    const a = cells(r);
    return plan.rooms.some(o => {
      const b = cells(o);
      return a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
    });
  });
  const errors = overlap ? ['overlap'] : siteErrors(db, next).filter(e => levelOf(e) !== 'yellow');
  return errors.length === 0 ? { plan: next, rooms, equipment, instruments, hull } : { rooms, equipment, instruments, hull };
}

/**
 * Перейти в следующий сценарий: завод тот же. Пишет извещение `carried` — что достроено, сколько выдано денег и людей.
 * Межсезонье и старт игрока — событием `scenarioStart` следующего сценария.
 */
export function carry(db: ContentDb, s: PlantState, notices: Notice[]) {
  const why = carryBlock(db, s);
  if (why) return notices.push({ kind: 'refused', cmd: 'next', why });
  const from = s.scenario;
  const next = nextScenario(db, from)!;
  const day = momentOf(s.start, s.t).day;
  s.story.campaign = { from: [...(s.story.campaign?.from ?? []), from], at: s.t };
  s.scenario = next.id;
  // места игрока — освобождены: межсезонье ведут коллеги, места игрок выберет к старту
  for (const x of s.seats ?? []) if (x.to === undefined) x.to = s.t;
  // продукты, введённые до старта следующего: их редакции — в силе с сегодня
  for (const p of next.launched ?? []) {
    if (!recipeOf(db, p)) continue;
    const g = projectDocs(db, p);
    s.portfolio ??= { projects: {} };
    const docs = { ...(s.portfolio.docs ?? {}) };
    for (const id of [...g.materials, ...g.methods, ...g.docs, ...g.launch]) docs[id] ??= day;
    s.portfolio.docs = docs;
  }
  // их материалы — пары одобрены и договоры с поставщиками, как у старта: иначе снабжение их не закажет
  const d = liveOf(db, s.portfolio?.docs);
  const mats = new Set<string>();
  for (const p of next.launched ?? []) {
    const r = recipeOf(d, p);
    if (!r) continue;
    for (const l of d.recipes[r].bom) mats.add(l.material);
    for (const k of Object.values(d.skus)) if (k.product === p) for (const x of [...k.blister, ...k.carton]) mats.add(x.material);
  }
  carryPairs(d, s, day, mats);
  // план: крыло следующего сценария — если встало; иначе деньги на постройку
  const want = db.plants[next.plant];
  const wing = want ? wingOf(db, s.plan, want) : { rooms: [], equipment: [], instruments: [], hull: [] };
  let paid = 0;
  let built = false;
  if (wing.plan) {
    s.plan = wing.plan;
    built = true;
    for (const r of wing.rooms) s.rooms[r.id] ??= { id: r.id, type: r.type, status: 'clean', since: s.t };
    for (const e of wing.equipment) s.equipment[e.id] ??= { id: e.id, type: e.type, room: e.room };
    for (const i of wing.instruments) s.instruments[i.id] ??= { id: i.id, type: i.type, room: i.room };
    newParts(db, s);
    // активы новых вещей — с записями квалификации в силе, как у старта; инвентарные номера — после последнего
    const tmp = { vehicles: {}, assets: {} } as Pick<PlantState, 'vehicles' | 'assets'>;
    seedAssets(db, next, s.plan, tmp, day);
    let inv = Math.max(0, ...Object.values(s.assets).map(a => a.inv));
    for (const [id, a] of Object.entries(tmp.assets)) if (!s.assets[id]) s.assets[id] = { ...a, inv: ++inv };
  } else if (next.build && (wing.rooms.length > 0 || wing.equipment.length > 0)) {
    const b = next.build;
    const cells = (r: [number, number, number, number]): [number, number, number, number] => [r[0] / 100 - 1, r[1] / 100 - 1, r[2] / 100 + 2, r[3] / 100 + 2];
    paid += wing.hull.reduce((n, h) => n + hullPrice(b, cells(h)), 0);
    paid += wing.rooms.reduce((n, r) => n + roomPrice(db, b, r), 0);
    paid += [...wing.equipment, ...wing.instruments].reduce((n, u) => n + unitPrice(db, u.type, u.vendor), 0);
    post(s, paid, 'grant', 'build');
  }
  // покупатели следующего — к прежним, со своими договорами
  const fresh = next.customers.filter(c => !s.customers[c]);
  for (const c of fresh) s.customers[c] = { last: s.t };
  if (fresh.length) seedContracts(db, { ...next, customers: fresh }, s, day);
  // люди — до штата следующего по ролям: новые номера, записи обучения, как у старта
  const plan = planOf(db, s.plan);
  let hired = 0;
  for (const row of next.staff) {
    const have = Object.values(s.people).filter(p => p.role === row.role).length;
    const want2 = next.staff.filter(r => r.role === row.role).reduce((n, r) => n + r.n, 0);
    const need = Math.max(0, want2 - have);
    const mine = Math.min(need, row.n);
    for (let i = 0; i < mine; i++) {
      const n = (s.next.E = (s.next.E ?? 0) + 1);
      const tab = Math.max(0, ...Object.values(s.people).map(p => p.tab)) + 1;
      const p = (s.people[`E${n}`] = { id: `E${n}`, role: row.role, shift: row.shift, skill: row.skill, tab, train: {}, x: plan.entrance.x, z: plan.entrance.z, ot: [], otYear: { y: momentOf(s.start, s.t).date.y, sec: 0 }, ...(row.also ? { also: [...row.also] } : {}) });
      seedTraining(db, next, p, day);
      hired++;
    }
  }
  // касса — до стартовой следующего
  const grant = Math.max(0, next.cash - s.cash.balance);
  if (grant > 0) post(s, grant, 'grant');
  // материалы запаса, которых на складе нет, — его количеством
  const near = plan.slot[plan.byKind.staging[0].id];
  for (const st of next.stock) {
    if (Object.values(s.lots).some(l => l.material === st.material && (l.status === 'released' || l.status === 'quarantine'))) continue;
    const maker = specPairs(d, st.material, day)[0]?.maker;
    try {
      createLot(db, s, {
        material: st.material,
        supplier: 'start',
        ...(maker ? { maker } : {}),
        qty: st.qty,
        status: 'released',
        where: () => {
          const sl = findSlot(s, plan, coldOf(db, s.plan, st.material) ? 'cold' : 'storage', near, 99);
          if (!sl) throw new Error('no slot');
          return { kind: 'slot', id: sl.id };
        },
      });
    } catch {
      // места нет — материал купят коллеги снабжения в межсезонье
    }
  }
  // старт игрока следующего сценария — его письма, цели и конец срока
  const start = playerStart(db, s);
  schedule(s.agenda, start, { kind: 'scenarioStart' });
  if (next.days !== undefined) schedule(s.agenda, start + next.days, { kind: 'scenarioEnd' });
  notices.push({ kind: 'carried', from, to: next.id, built, paid, hired, grant, start });
}
