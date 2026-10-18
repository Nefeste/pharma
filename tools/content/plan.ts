// Проверки плана завода (docs/specs/2026-10-view.md, 2а, «План завода»; геймдизайн, §3.4; docs/10-domain.md, §4): двери —
// на стенах между двумя помещениями или помещением и улицей; зоны, оборудование и машины — на полу своего помещения; от
// входа люди доходят до каждой рабочей точки и места паллеты, от стоянки техника — до каждого места и рампы; в класс D —
// только через шлюз, а техника дальше шлюза не въезжает; комната отдыха не открывается в производство и склад. Ошибка
// останавливает сборку базы.
import type { ContentDb } from '../../src/content/types';
import { accessOf, buildNav, CELL, cellOf, fieldTo, type Nav } from '../../src/engine/nav';
import { planOf } from '../../src/engine/plant';

/** Помещения, которые открываются только во вспомогательное: санузел, комната отдыха, столовая (GMP ЕАЭС, ч. I, пп. 3.30, 3.31). */
const AMENITY = new Set(['amenities']);
/** Склад: санузел и комната отдыха не сообщаются с ним напрямую. */
const STORAGE = new Set(['warehouse', 'cold', 'rejected']);

export function planErrors(db: ContentDb, plantId: string): string[] {
  const out: string[] = [];
  const bad = (msg: string) => out.push(`план ${plantId}: ${msg}`);
  const plan = planOf(db, plantId);
  const { plant, nav } = plan;
  const bare: Nav = buildNav(db, { ...plant, doors: [] });
  const name = (i: number) => (i < 0 ? 'улица' : plant.rooms[i].id);
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
        bad(`дверь ${k + 1} (${x}, ${z}) — не на стене`);
        return;
      }
      const a = d.along === 'x' ? side(x, z - 1) : side(x - 1, z);
      const b = d.along === 'x' ? side(x, z + 1) : side(x + 1, z);
      if (a === undefined || b === undefined || a === b) {
        bad(`дверь ${k + 1} (${x}, ${z}) — не между двумя помещениями`);
        return;
      }
      sides.add(`${a}/${b}`);
    }
    if (sides.size !== 1) return bad(`дверь ${k + 1} — клетки ведут в разные помещения`);
    const [a, b] = [...sides][0].split('/').map(Number);
    const ra = a >= 0 ? plant.rooms[a] : undefined;
    const rb = b >= 0 ? plant.rooms[b] : undefined;
    if (d.kind === 'dock' && a >= 0 && b >= 0) bad(`рампа ${k + 1} — не в наружной стене`);
    if (d.kind === 'hatch') return;
    // в класс D — через шлюз: одна из сторон двери между разными классами — шлюз
    const gradeA = ra?.grade ?? 'cnc';
    const gradeB = rb?.grade ?? 'cnc';
    if (gradeA !== gradeB && !ra?.type.startsWith('airlock.') && !rb?.type.startsWith('airlock.')) {
      const [from, to] = gradeA === 'D' ? [b, a] : [a, b];
      bad(`дверь ${k + 1} ведёт из ${name(from)} в класс D ${name(to)} не через шлюз`);
    }
    for (const [r, o] of [
      [ra, rb],
      [rb, ra],
    ] as const) {
      if (r && AMENITY.has(r.type) && (o?.grade === 'D' || STORAGE.has(o?.type ?? ''))) bad(`${r.id} открывается в производство или склад`);
    }
  });
  // техника доезжает до шлюза, дальше — нет: деревянная паллета дальше шлюза не проходит (геймдизайн, §3.4)
  plant.rooms.forEach(r => {
    if (r.grade === 'D' && r.vehicles && !r.type.startsWith('airlock.')) bad(`техника въезжает в класс D дальше шлюза: ${r.id}`);
  });
  // зоны — на полу; оборудование и машины — в своём помещении
  for (const zn of plant.zones) {
    const [x0, z0, w, d] = zn.rect.map(v => v / 100);
    for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) if (nav.cells[z * nav.w + x] !== CELL.floor) bad(`зона ${zn.id}: клетка (${x}, ${z}) — не пол помещения`);
  }
  const inRoom = (id: string, room: string, at: [number, number]) => {
    const i = cellOf(nav, { x: at[0], z: at[1] });
    if (nav.cells[i] !== CELL.floor || plant.rooms[nav.room[i]]?.id !== room) bad(`${id} стоит не в помещении ${room}`);
  };
  for (const e of plant.equipment) inRoom(e.id, e.room, e.at);
  for (const ln of plant.lines) for (const m of ln.machines) inRoom(m.id, ln.room, m.at);
  // дойти и доехать
  const walk = fieldTo(nav, 'walk', accessOf(nav, plan.entrance, 'walk'));
  const drive = fieldTo(nav, 'drive', accessOf(nav, plan.park, 'drive'));
  const reach = (what: string, p: { x: number; z: number }, f: Int32Array, mover: 'walk' | 'drive') => {
    const c = accessOf(nav, p, mover);
    if (c < 0 || f[c] < 0) bad(`${mover === 'walk' ? 'от входа не дойти' : 'от стоянки не доехать'}: ${what}`);
  };
  if (accessOf(nav, plan.entrance, 'walk') < 0) bad('вход — не на полу');
  if (accessOf(nav, plan.park, 'drive') < 0) bad('стоянка техники — не там, куда технике можно');
  for (const [id, r] of Object.entries(plan.room)) reach(`помещение ${id}`, r, walk, 'walk');
  for (const sl of plan.slots) {
    reach(`место ${sl.id}`, sl, walk, 'walk');
    reach(`место ${sl.id}`, sl, drive, 'drive');
  }
  for (const [id, d] of Object.entries(plan.dock)) {
    const c = cellOf(nav, d);
    if (nav.cells[c] !== CELL.door || plant.doors[nav.door[c]].kind !== 'dock') bad(`рампа ${id} — не на воротах рампы`);
    reach(`рампа ${id}`, d, drive, 'drive');
  }
  return out;
}
