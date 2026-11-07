// Часть Б7б, шаг 2: участок, корпус, каталог типов помещений и проверки трёх ступеней (docs/specs/2026-10-vertical-slice.md,
// «Б7б»; геймдизайн, §3.1, §3.4). План прототипа — в углу участка «Завод»: корпус — прямоугольник внутренности, его стены
// — вокруг, клетка корпуса без помещения — «не застроено»; сетка — до стен корпуса, а не весь участок. Роль помещения в
// проверках — из каталога `content/rooms/`, а не из имени типа. Ступени: нельзя, красная — помещение не работает,
// жёлтая — замечание; сборщик базы не пускает план сценария ни с одной ошибкой ни одной ступени.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import type { ContentDb, Plant } from '../../src/content/types';
import { en } from '../../src/i18n/en';
import { ru } from '../../src/i18n/ru';
import { buildNav, CELL } from '../../src/engine/nav';
import { planOf } from '../../src/engine/plant';
import { levelOf, redRoom, type SiteError, siteErrors } from '../../src/engine/site/checks';
import { buildDb } from '../content/load';
import { siteErrorText } from '../content/plan';

const PLANT = db.scenarios['scn.proto'].plant;
const base = (): Plant => structuredClone(db.plants[PLANT]);
const codes = (p: Plant, d: ContentDb = db) => siteErrors(d, p).map(e => e.code);
/** Корпус «Цеха» и пристройка к востоку: её западная стена — прежняя восточная стена корпуса. */
const grown = (): Plant => {
  const p = base();
  p.hull.push([5900, 100, 2000, 3800]);
  return p;
};

describe('участок и корпус', () => {
  test('прототип — в углу участка «Завод»: корпус «Цеха», сетка та же 60 × 40, «не застроено» нет; ошибок нет', () => {
    const p = db.plants[PLANT];
    expect(p.lot).toEqual({ kind: 'plant', size: [12000, 8000] });
    expect(p.hull).toEqual([[100, 100, 5800, 3800]]);
    const nav = planOf(db, p).nav;
    expect([nav.w, nav.h]).toEqual([60, 40]);
    expect(nav.cells.includes(CELL.unbuilt)).toBe(false);
    // внутренность и стены корпуса: стены — по краю сетки
    for (let z = 0; z < nav.h; z++) for (let x = 0; x < nav.w; x++) expect(nav.hull[z * nav.w + x]).toBe(x === 0 || z === 0 || x === 59 || z === 39 ? 2 : 1);
    expect(siteErrors(db, p)).toEqual([]);
  });

  test('пристройка: сетка растёт до её стен; клетки без помещения — «не застроено», по ним не ходят и не ездят', () => {
    const p = grown();
    const nav = buildNav(db, p);
    expect([nav.w, nav.h]).toEqual([80, 40]);
    let unbuilt = 0;
    for (let i = 0; i < nav.w * nav.h; i++) {
      if (nav.cells[i] !== CELL.unbuilt) continue;
      unbuilt++;
      expect(nav.walk[i]).toBe(0);
      expect(nav.drive[i]).toBe(0);
      expect(nav.room[i]).toBe(-1);
    }
    // внутренность пристройки — 19 × 38 клеток с x = 60 по 78; прежняя стена x = 59 — стены помещений вдоль неё
    expect(unbuilt).toBe(19 * 38);
    for (let z = 1; z <= 38; z++) expect(nav.cells[z * nav.w + 59]).toBe(CELL.wall);
    for (let z = 0; z < 40; z++) expect(nav.hull[z * nav.w + 79]).toBe(2);
    // пристройка не меняет пути: прежние помещения, места и посты те же, ошибок нет
    expect(siteErrors(db, p)).toEqual([]);
  });

  test('корпус со стенами за участком и корпус не одним куском — нельзя', () => {
    const out = base();
    out.hull.push([5900, 100, 6100, 3800]);
    expect(siteErrors(db, out)).toContainEqual({ code: 'lot', hull: 1 });
    const apart = base();
    apart.hull.push([7000, 5000, 1000, 1000]);
    expect(codes(apart)).toContain('hullJoin');
    for (const e of siteErrors(db, apart).filter(x => x.code === 'lot' || x.code === 'hullJoin')) expect(levelOf(e)).toBe('no');
  });
});

describe('каталог типов помещений', () => {
  test('у каждого типа плана — запись каталога; у каждого типа каталога — имя на обоих языках', () => {
    for (const r of db.plants[PLANT].rooms) expect(db.rooms[r.type]?.type).toBe(r.type);
    for (const [type, t] of Object.entries(db.rooms)) {
      expect(t.id).toBe(`room.${type}`);
      expect(ru.roomTypes[type]?.length).toBeGreaterThan(0);
      expect(en.roomTypes[type]?.length).toBeGreaterThan(0);
    }
    // строят в Б7б помещения без оборудования: коридоры, шлюзы, офис, бытовое и гардероб
    expect(Object.values(db.rooms).filter(t => t.build).map(t => t.type).sort()).toEqual(['airlock.material', 'airlock.people', 'amenities', 'changing', 'corridor', 'corridor.clean', 'office']);
  });

  test('роль — из каталога, а не из имени типа: коридор — клетки коридора, шлюз — проход в класс D', () => {
    const p = db.plants[PLANT];
    const hall = p.rooms.findIndex(r => r.id === 'hall');
    const cellOfRoom = (d: ContentDb) => {
      const nav = buildNav(d, p);
      const [x, z] = [p.rooms[hall].rect[0] / 100 + 2, p.rooms[hall].rect[1] / 100 + 2];
      return nav.cells[z * nav.w + x];
    };
    expect(cellOfRoom(db)).toBe(CELL.corridor);
    const office: ContentDb = { ...db, rooms: { ...db.rooms, corridor: { ...db.rooms.corridor, role: 'office' } } };
    expect(cellOfRoom(office)).toBe(CELL.floor);
    // шлюз для людей перестал быть шлюзом — вход в класс D из коридора через него красный
    const people: ContentDb = { ...db, rooms: { ...db.rooms, 'airlock.people': { ...db.rooms['airlock.people'], role: 'office' } } };
    const red = siteErrors(people, p).filter(e => e.code === 'airlock');
    expect(red.length).toBeGreaterThan(0);
    for (const e of red) expect(levelOf(e)).toBe('red');
  });

  test('помещение: тип не из каталога, не в корпусе, меньше наименьшего, класс и проезд, которых типу нельзя, — нельзя', () => {
    const p = grown();
    // офис 4 × 5 в пристройке — можно; 4 × 4 — меньше наименьшего 4 × 5
    p.rooms.push({ id: 'office-1', type: 'office', rect: [6000, 100, 400, 500], grade: 'cnc', vehicles: false, floor: 1 });
    expect(siteErrors(db, p).filter(e => 'room' in e && e.room === 'office-1')).toEqual([]);
    const small = structuredClone(p);
    small.rooms.at(-1)!.rect = [6000, 100, 400, 400];
    expect(siteErrors(db, small)).toContainEqual({ code: 'small', room: 'office-1', min: [4, 5] });
    const grade = structuredClone(p);
    grade.rooms.at(-1)!.grade = 'D';
    expect(siteErrors(db, grade)).toContainEqual({ code: 'grade', room: 'office-1' });
    const veh = structuredClone(p);
    veh.rooms.at(-1)!.vehicles = true;
    expect(siteErrors(db, veh)).toContainEqual({ code: 'vehicles', room: 'office-1' });
    const odd = structuredClone(p);
    odd.rooms.at(-1)!.type = 'gym';
    expect(siteErrors(db, odd)).toContainEqual({ code: 'roomType', room: 'office-1', type: 'gym' });
    // за корпусом: стена на улице
    const out = structuredClone(p);
    out.rooms.at(-1)!.rect = [7700, 100, 400, 500];
    expect(siteErrors(db, out)).toContainEqual({ code: 'outsideHull', room: 'office-1' });
    for (const e of [...siteErrors(db, small), ...siteErrors(db, grade), ...siteErrors(db, veh), ...siteErrors(db, out)]) if ('room' in e && e.room === 'office-1') expect(levelOf(e)).toBe('no');
  });

  test('тип, который строят, повторяется; который не строят, — нельзя дважды: стадия ищет помещение по типу', () => {
    const p = grown();
    p.rooms.push({ id: 'corridor-1', type: 'corridor', rect: [6000, 100, 1000, 400], grade: 'cnc', vehicles: false, floor: 1 });
    expect(codes(p)).not.toContain('twice');
    // по типу — первое помещение плана: новое того же типа не меняет, куда идут прежние работы
    expect(planOf(db, p).roomOf.corridor).toBe('hall');
    const lab = grown();
    lab.rooms.push({ id: 'lab-1', type: 'lab', rect: [6000, 100, 700, 700], grade: 'cnc', vehicles: false, floor: 1 });
    expect(siteErrors(db, lab)).toContainEqual({ code: 'twice', type: 'lab' });
  });
});

describe('ступени проверок', () => {
  test('красные: вход в класс D не через шлюз, техника дальше шлюза, помещение без пути от входа — и помещение, которое не работает', () => {
    const cases: [SiteError, string | undefined][] = [
      [{ code: 'airlock', door: 3, from: 'hall', to: 'packaging' }, 'packaging'],
      [{ code: 'vehicleD', room: 'compression' }, 'compression'],
      [{ code: 'walk', what: { kind: 'room', id: 'lab' } }, 'lab'],
    ];
    for (const [e, room] of cases) {
      expect(levelOf(e)).toBe('red');
      expect(redRoom(e)).toBe(room);
    }
    // не дойти до места паллеты, поста или рампы — не красная, а нельзя
    for (const kind of ['slot', 'post', 'dock'] as const) expect(levelOf({ code: 'walk', what: { kind, id: 'x' } })).toBe('no');
    // техника в таблетировании — красная на плане
    const p = base();
    p.rooms.find(r => r.id === 'compression')!.vehicles = true;
    expect(siteErrors(db, p)).toContainEqual({ code: 'vehicleD', room: 'compression' });
  });

  test('жёлтые: бытовое в склад, отклонённое не в отдельном помещении, один проём у мойки', () => {
    const wash = base();
    wash.doors = wash.doors.filter(d => !(d.cell[0] === 58 && d.cell[1] === 9));
    expect(siteErrors(db, wash)).toContainEqual({ code: 'washDoors', room: 'washing' });
    // в помещение отклонённого — ещё зона: отклонённое уже не отдельно
    const rej = base();
    rej.zones.push({ id: 'extra', kind: 'quarantine', rect: [2100, 3700, 200, 100], grid: [1, 1] });
    expect(siteErrors(db, rej)).toContainEqual({ code: 'rejectedShared', zone: 'rej' });
    for (const e of [...siteErrors(db, wash), ...siteErrors(db, rej)].filter(x => x.code === 'washDoors' || x.code === 'rejectedShared')) expect(levelOf(e)).toBe('yellow');
    expect(levelOf({ code: 'amenity', room: 'amenities' })).toBe('yellow');
  });

  test('жёлтая: сырьё и готовая продукция — через один шлюз, если паллеты готовой продукции собирают в классе D', () => {
    // зона паллетирования — в упаковке: ящики идут к карантину готовой продукции тем же шлюзом для материалов, что и сырьё
    const p = base();
    p.zones.find(z => z.id === 'pal')!.rect = [4600, 1900, 300, 200];
    const e = siteErrors(db, p).filter(x => x.code === 'oneAirlock');
    expect(e).toEqual([{ code: 'oneAirlock', room: 'mal' }]);
    expect(levelOf(e[0])).toBe('yellow');
    // на плане прототипа ящики выходят в склад через проём ленты, а не через шлюз — замечания нет
    expect(codes(base())).not.toContain('oneAirlock');
  });

  test('стеллаж — на полу своего помещения: в стене или на чужой вещи — нельзя', () => {
    const p = base();
    p.racks[0].x = -100;
    expect(codes(p)).toContain('rackFloor');
    const onEq = base();
    // ряд A — поверх ряда B
    onEq.racks[0].z = onEq.racks[1].z;
    expect(codes(onEq)).toContain('rackFloor');
    expect(levelOf({ code: 'rackFloor', rack: 'A', x: 1, z: 1 })).toBe('no');
  });

  test('у каждой ошибки Б7б — слова сборщика без пустых мест', () => {
    const all: SiteError[] = [
      { code: 'lot', hull: 0 },
      { code: 'hullJoin' },
      { code: 'roomType', room: 'r', type: 'gym' },
      { code: 'outsideHull', room: 'r' },
      { code: 'small', room: 'r', min: [4, 5] },
      { code: 'grade', room: 'r' },
      { code: 'vehicles', room: 'r' },
      { code: 'twice', type: 'lab' },
      { code: 'rackFloor', rack: 'A', x: 1, z: 2 },
      { code: 'rejectedShared', zone: 'rej' },
      { code: 'washDoors', room: 'washing' },
      { code: 'oneAirlock', room: 'mal' },
    ];
    for (const e of all) {
      const text = siteErrorText(e);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('undefined');
    }
  });
});

describe('сборщик базы: каталог и участок на испорченной копии content/', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  function broken(file: string, edits: [string, string][]): ReturnType<typeof buildDb> {
    const dir = mkdtempSync(join(tmpdir(), 'pharma-content-'));
    dirs.push(dir);
    cpSync(join(import.meta.dir, '../../content'), dir, { recursive: true });
    const p = join(dir, file);
    let text = readFileSync(p, 'utf8');
    for (const [a, b] of edits) {
      expect(text.includes(a)).toBe(true);
      text = text.replace(a, b);
    }
    writeFileSync(p, text);
    return buildDb(dir);
  }

  test('тип помещения плана не из каталога, наименьший размер не по порядку, корпус за участком — ошибки сборщика', () => {
    const type = broken('plants/proto.yaml', [['{ id: office, type: office,', '{ id: office, type: gym,']]);
    expect(type.errors).toContain(`план ${PLANT}: помещение office: типа gym нет в каталоге content/rooms/`);
    const min = broken('rooms/office.yaml', [['min: [4, 5]', 'min: [5, 4]']]);
    expect(min.errors.some(e => e.includes('rooms/office.yaml') && e.includes('сначала меньшая сторона'))).toBe(true);
    const lot = broken('plants/proto.yaml', [['lot: { kind: plant, size: [120, 80] }', 'lot: { kind: plant, size: [59, 40] }']]);
    expect(lot.errors).toContain(`план ${PLANT}: корпус 1 со стенами — не на участке`);
  });
});
