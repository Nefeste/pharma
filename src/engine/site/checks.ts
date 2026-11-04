// Проверки планировки (Б7а; docs/specs/2026-10-vertical-slice.md, «Б7а»; геймдизайн, §3.4; docs/10-domain.md, §4) —
// чистые функции движка над планом здания: двери — на стенах между двумя помещениями или помещением и улицей; рампа — в
// наружной стене и на воротах рампы; в класс D — только через шлюз, а техника дальше шлюза не въезжает; бытовые не
// открываются в производство и склад; зоны, оборудование и машины — на полу своего помещения; от входа люди доходят до
// каждой рабочей точки, места паллеты и поста ожидания (пост — на проходимом полу), от стоянки техника — до каждого места
// и рампы; этаж — первый. Сборщик базы зовёт их для плана сценария (tools/content/plan.ts — слова ошибок), стройка (Б7б)
// — для призрака и команды. Ошибка — код и вещь, без слов: слова — у того, кто показывает.
import type { ContentDb, Plant } from '../../content/types';
import { accessOf, buildNav, CELL, cellOf, fieldTo, type Nav } from '../nav';
import { planOf } from '../plant';

/** Помещения, которые открываются только во вспомогательное: санузел, комната отдыха, столовая (GMP ЕАЭС, ч. I, пп. 3.30, 3.31). */
const AMENITY = new Set(['amenities']);
/** Склад: санузел и комната отдыха не сообщаются с ним напрямую. */
const STORAGE = new Set(['warehouse', 'cold', 'rejected']);

/** Что не дойти или не доехать: рабочая точка помещения, место паллеты, пост роли, рампа. */
export type SiteThing = { kind: 'room' | 'slot' | 'post' | 'dock'; id: string };

/**
 * Ошибка планировки: `door` — номер двери в плане с нуля, `x`, `z` — клетка; `from`, `to` — помещения по сторонам двери
 * (`undefined` — улица).
 */
export type SiteError =
  | { code: 'doorWall'; door: number; x: number; z: number }
  | { code: 'doorSides'; door: number; x: number; z: number }
  | { code: 'doorMixed'; door: number }
  | { code: 'dockInner'; door: number }
  | { code: 'airlock'; door: number; from?: string; to?: string }
  | { code: 'amenity'; room: string }
  | { code: 'vehicleD'; room: string }
  | { code: 'zoneFloor'; zone: string; x: number; z: number }
  | { code: 'outOfRoom'; thing: string; room: string }
  | { code: 'entrance' }
  | { code: 'park' }
  | { code: 'walk'; what: SiteThing }
  | { code: 'drive'; what: SiteThing }
  | { code: 'post'; role: string }
  | { code: 'dockGate'; dock: string }
  | { code: 'floor'; thing: string; floor: number };

/** В 1.0 этаж один (решение по #82): у помещения, рампы и точек плана — первый. */
export const FLOOR = 1;

/** Ошибки планировки плана здания — по порядку правил; нет ошибок — пустой список. */
export function siteErrors(db: ContentDb, plant: Plant): SiteError[] {
  const out: SiteError[] = [];
  for (const r of plant.rooms) if (r.floor !== FLOOR) out.push({ code: 'floor', thing: r.id, floor: r.floor });
  for (const d of plant.docks) if (d.floor !== FLOOR) out.push({ code: 'floor', thing: d.id, floor: d.floor });
  if (plant.points.floor !== FLOOR) out.push({ code: 'floor', thing: 'points', floor: plant.points.floor });
  const plan = planOf(db, plant);
  const { nav } = plan;
  const bare: Nav = buildNav(db, { ...plant, doors: [] });
  const idOf = (i: number) => (i < 0 ? undefined : plant.rooms[i].id);
  // помещение по ту сторону стены: клетка за ней — пол, коридор или улица (стены и двери не в счёт)
  const side = (x: number, z: number): number | undefined => {
    if (x < 0 || z < 0 || x >= nav.w || z >= nav.h) return -1;
    const i = z * nav.w + x;
    const c = bare.cells[i];
    if (c === CELL.outside) return -1;
    if (c === CELL.floor || c === CELL.corridor) return bare.room[i];
    return undefined;
  };
  plant.doors.forEach((d, k) => {
    const sides = new Set<string>();
    for (let j = 0; j < d.len; j++) {
      const [x, z] = d.along === 'x' ? [d.cell[0] + j, d.cell[1]] : [d.cell[0], d.cell[1] + j];
      if (x >= nav.w || z >= nav.h || bare.cells[z * nav.w + x] !== CELL.wall) {
        out.push({ code: 'doorWall', door: k, x, z });
        return;
      }
      const a = d.along === 'x' ? side(x, z - 1) : side(x - 1, z);
      const b = d.along === 'x' ? side(x, z + 1) : side(x + 1, z);
      if (a === undefined || b === undefined || a === b) {
        out.push({ code: 'doorSides', door: k, x, z });
        return;
      }
      sides.add(`${a}/${b}`);
    }
    if (sides.size !== 1) {
      out.push({ code: 'doorMixed', door: k });
      return;
    }
    const [a, b] = [...sides][0].split('/').map(Number);
    const ra = a >= 0 ? plant.rooms[a] : undefined;
    const rb = b >= 0 ? plant.rooms[b] : undefined;
    if (d.kind === 'dock' && a >= 0 && b >= 0) out.push({ code: 'dockInner', door: k });
    if (d.kind === 'hatch') return;
    // в класс D — через шлюз: одна из сторон двери между разными классами — шлюз
    const gradeA = ra?.grade ?? 'cnc';
    const gradeB = rb?.grade ?? 'cnc';
    if (gradeA !== gradeB && !ra?.type.startsWith('airlock.') && !rb?.type.startsWith('airlock.')) {
      const [from, to] = gradeA === 'D' ? [b, a] : [a, b];
      out.push({ code: 'airlock', door: k, ...(idOf(from) ? { from: idOf(from) } : {}), ...(idOf(to) ? { to: idOf(to) } : {}) });
    }
    for (const [r, o] of [
      [ra, rb],
      [rb, ra],
    ] as const) {
      if (r && AMENITY.has(r.type) && (o?.grade === 'D' || STORAGE.has(o?.type ?? ''))) out.push({ code: 'amenity', room: r.id });
    }
  });
  // техника доезжает до шлюза, дальше — нет: деревянная паллета дальше шлюза не проходит (геймдизайн, §3.4)
  for (const r of plant.rooms) if (r.grade === 'D' && r.vehicles && !r.type.startsWith('airlock.')) out.push({ code: 'vehicleD', room: r.id });
  // зоны — на полу; оборудование и машины — в своём помещении
  for (const zn of plant.zones) {
    const [x0, z0, w, d] = zn.rect.map(v => v / 100);
    for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) if (nav.cells[z * nav.w + x] !== CELL.floor) out.push({ code: 'zoneFloor', zone: zn.id, x, z });
  }
  const inRoom = (id: string, room: string, at: [number, number]) => {
    const i = cellOf(nav, { x: at[0], z: at[1] });
    if (nav.cells[i] !== CELL.floor || plant.rooms[nav.room[i]]?.id !== room) out.push({ code: 'outOfRoom', thing: id, room });
  };
  for (const e of plant.equipment) inRoom(e.id, e.room, e.at);
  for (const ln of plant.lines) for (const m of ln.machines) inRoom(m.id, ln.room, m.at);
  // дойти и доехать
  const walk = fieldTo(nav, 'walk', accessOf(nav, plan.entrance, 'walk'));
  const drive = fieldTo(nav, 'drive', accessOf(nav, plan.park, 'drive'));
  const reach = (what: SiteThing, p: { x: number; z: number }, f: Int32Array, mover: 'walk' | 'drive') => {
    const c = accessOf(nav, p, mover);
    if (c < 0 || f[c] < 0) out.push({ code: mover, what });
  };
  if (accessOf(nav, plan.entrance, 'walk') < 0) out.push({ code: 'entrance' });
  if (accessOf(nav, plan.park, 'drive') < 0) out.push({ code: 'park' });
  for (const [id, r] of Object.entries(plan.room)) reach({ kind: 'room', id }, r, walk, 'walk');
  for (const sl of plan.slots) {
    reach({ kind: 'slot', id: sl.id }, sl, walk, 'walk');
    reach({ kind: 'slot', id: sl.id }, sl, drive, 'drive');
  }
  // пост ожидания — на полу, где можно стоять, не в стене и не внутри машины или стеллажа; от входа до него дойти
  for (const [role, p] of Object.entries(plan.posts)) {
    if (!nav.walk[cellOf(nav, p)]) out.push({ code: 'post', role });
    reach({ kind: 'post', id: role }, p, walk, 'walk');
  }
  for (const [id, d] of Object.entries(plan.dock)) {
    const c = cellOf(nav, d);
    if (nav.cells[c] !== CELL.door || plant.doors[nav.door[c]].kind !== 'dock') out.push({ code: 'dockGate', dock: id });
    reach({ kind: 'dock', id }, d, drive, 'drive');
  }
  return out;
}
