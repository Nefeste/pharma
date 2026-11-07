// Что не работает (Б7б; docs/specs/2026-10-vertical-slice.md, «Б7б»; геймдизайн, §3.4): помещения — красные по проверкам
// планировки, перестраиваемое и сносимые, места паллет — в них и у сносимых зон и рядов стеллажа. В неработающем
// помещении новые задачи, стадии, упаковка и испытания не начинаются, место паллеты в нём не выбирают
// (src/engine/tasks.ts, mes.ts, line.ts, market.ts); идущие работы доходят. С сносимой зоны и ряда паллеты увозят как
// обычно — новых туда не кладут. Одно на объект плана и состояние стройки; стройки не было — не работает ничего.
import type { ContentDb, Plant } from '../../content/types';
import { CELL, CELL_CM } from '../nav';
import { planOf, type PlantPlan, type Point, type Slot } from '../plant';
import type { BuildState, PlantState } from '../types';
import { levelOf, redRoom, type SiteError } from './checks';
import { doorRoomOf, errorsOf } from './edit';

/** Почему помещение не работает: ошибка планировки красной ступени, закрыто на перестройку, сносится. */
export type DownWhy = { code: 'red'; error: SiteError } | { code: 'editing' } | { code: 'leaving' };

/**
 * Что не работает: помещение — с причиной (первая по порядку: красное, перестраиваемое, сносимое); место паллеты — с тем,
 * что не работает: помещение места или сносимая зона и ряд.
 */
export interface Down {
  rooms: ReadonlyMap<string, DownWhy>;
  slots: ReadonlyMap<string, string>;
}

const NONE: Down = { rooms: new Map(), slots: new Map() };

/** Помещение под точкой — пол или коридор; стена, дверь, «не застроено» и улица — `undefined`. */
export function roomAt(plan: PlantPlan, p: Point): string | undefined {
  const nav = plan.nav;
  const x = Math.floor(p.x / CELL_CM);
  const z = Math.floor(p.z / CELL_CM);
  if (x < 0 || z < 0 || x >= nav.w || z >= nav.h) return undefined;
  const c = nav.cells[z * nav.w + x];
  if (c !== CELL.floor && c !== CELL.corridor) return undefined;
  return plan.plant.rooms[nav.room[z * nav.w + x]]?.id;
}

const docks = new WeakMap<Plant, Record<string, string | undefined>>();

/** Помещение рампы — по эту сторону её ворот; одно на объект плана. */
export function dockRoom(db: ContentDb, plant: Plant, dock: string): string | undefined {
  let m = docks.get(plant);
  if (!m) {
    m = {};
    for (const d of plant.docks) {
      const i = doorRoomOf(db, plant, d);
      m[d.id] = i === undefined ? undefined : plant.rooms[i]?.id;
    }
    docks.set(plant, m);
  }
  return m[dock];
}

const downs = new WeakMap<BuildState, { plan: Plant; down: Down }>();

/** Состояние стройки изменилось — перестраиваемое или сносимое: что не работает, считать заново (src/engine/build.ts). */
export function forgetDown(st: BuildState) {
  downs.delete(st);
}

/** Что не работает сейчас: стройки не было — ничего; иначе — по плану и состоянию стройки, одно на них. */
export function downOf(db: ContentDb, s: PlantState): Down {
  const st = s.build;
  if (!st) return NONE;
  const hit = downs.get(st);
  if (hit && hit.plan === s.plan) return hit.down;
  const rooms = new Map<string, DownWhy>();
  for (const e of errorsOf(db, s.plan)) {
    if (levelOf(e) !== 'red') continue;
    const r = redRoom(e);
    if (r !== undefined && !rooms.has(r)) rooms.set(r, { code: 'red', error: e });
  }
  if (st.editing !== undefined && !rooms.has(st.editing)) rooms.set(st.editing, { code: 'editing' });
  for (const l of st.leaving) if (l.what === 'room' && !rooms.has(l.id)) rooms.set(l.id, { code: 'leaving' });
  const gone = new Set(st.leaving.filter(l => l.what !== 'room').map(l => l.id));
  const slots = new Map<string, string>();
  if (rooms.size > 0 || gone.size > 0) {
    const plan = planOf(db, s.plan);
    for (const sl of plan.slots) {
      if (gone.has(sl.group)) slots.set(sl.id, sl.group);
      else {
        const r = roomAt(plan, sl);
        if (r !== undefined && rooms.has(r)) slots.set(sl.id, r);
      }
    }
  }
  const down = rooms.size === 0 && slots.size === 0 ? NONE : { rooms, slots };
  downs.set(st, { plan: s.plan, down });
  return down;
}

/** Не работает ли помещение: стадия и упаковка в нём не начинаются. */
export function roomDown(db: ContentDb, s: PlantState, room: string): boolean {
  return s.build !== undefined && downOf(db, s).rooms.has(room);
}

/** Проверка места паллеты для выбора (`findSlot`): не в неработающем и не у сносимого; не работает ничего — `undefined`. */
export function slotOk(down: Down, ok?: (sl: Slot) => boolean): ((sl: Slot) => boolean) | undefined {
  if (down.slots.size === 0) return ok;
  return ok ? sl => !down.slots.has(sl.id) && ok(sl) : sl => !down.slots.has(sl.id);
}
