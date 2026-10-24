// Б1е: чистота линии (docs/specs/2026-10-vertical-slice.md, «Б1е»). Помещение упаковки живёт по правилам помещений
// производства (геймдизайн, §5.5): задание занимает его с первой таблетки, после — грязно и малая уборка сразу: мойка
// блистерной машины оператором линии, потом уборка помещения уборщиком; перед другим продуктом и после 24 часов
// грязным — генеральная; чистое дольше 72 часов — уборка снова. Переналадка идёт вместе с уборкой, очистка и проверка
// мастера — только в чистом помещении, перед каждым заданием, первым тоже; уборка после очистки — очистка снова.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacy as db } from './legacy';
import { db as game } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { batchNo } from '../../src/engine/batchno';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { CLEAN_HOLD, DIRTY_HOLD, MES, roomWork, washRoles, washWork } from '../../src/engine/mes';
import { planOf } from '../../src/engine/plant';
import { fromSave } from '../../src/engine/save';
import { dossierView } from '../../src/sim/dossier';
import { nowView } from '../../src/sim/now';
import { pastBars } from '../../src/sim/plan';
import { cardView } from '../../src/sim/views';
import type { Batch, PlantState, Task } from '../../src/engine/types';
import { buildDb } from '../content/load';

const SC = 'scn.proto';
const RCP = 'rcp.paracetamol500.wet.v1';
const N20 = 'sku.paracetamol500.n20';
const PRD = 'prd.paracetamol500';
const plan = planOf(db, db.scenarios[SC].plant);
const LINE = plan.plant.lines[0];
const ROOM = LINE.room;

/** Завод без заданий сценария: серии в тесте заказываются вручную. */
const bare: ContentDb = { ...db, scenarios: { ...db.scenarios, [SC]: { ...db.scenarios[SC], batches: [] } } };

/** Работы линии и её помещения по порядку появления: вид, серия (у уборки — без серии), когда заведена, роли, работа. */
interface Seen {
  kind: string;
  batch?: string;
  at: number;
  roles: readonly string[];
  work: number;
  /** когда работа кончится — по задаче, пока она идёт */
  end?: number;
}

function watch(s: PlantState): { seen: Seen[]; look: () => void } {
  const seen: Seen[] = [];
  const known = new Map<string, Seen>();
  const look = () => {
    for (const t of Object.values(s.tasks) as Task[]) {
      const was = known.get(t.id);
      if (was) {
        if (t.state === 'busy' && t.times) was.end = t.times[4];
        continue;
      }
      const mine = ['changeover', 'clearance', 'clearCheck'].includes(t.kind) || ((t.kind === 'clean' || t.kind === 'roomClean') && t.room === ROOM);
      if (!mine) continue;
      const x: Seen = { kind: t.kind, ...(t.batch ? { batch: t.batch } : {}), at: t.created, roles: t.roles, work: t.work };
      known.set(t.id, x);
      seen.push(x);
    }
  };
  return { seen, look };
}

/** Прожить до `until` (не дольше `days` суток) часами с инвариантами; `look` — перед каждым событием. */
function live(s: PlantState, days: number, look: () => void, until: () => boolean) {
  const end = s.t + days * DAY;
  while (s.t < end && !until()) {
    apply(bare, s, { kind: 'advance', seconds: Math.min(HOUR, end - s.t) }, () => (look(), true));
    look();
    const bad = check(bare, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
}

function order(s: PlantState, notBefore = s.t): Batch {
  const n = Object.keys(s.batches).length;
  apply(bare, s, { kind: 'order', recipe: RCP, notBefore, sku: N20 });
  return Object.values(s.batches)[n];
}

describe('кто моет и сколько', () => {
  test('блистерную машину моет оператор линии: 30 минут малой, 3 часа генеральной; помещение — уборщик', () => {
    const s = newPlant(bare, { scenario: SC });
    expect(washRoles(db, s.plant, ROOM)).toEqual([db.machines['mach.blister'].crew.role]);
    expect(washRoles(db, s.plant, plan.roomOf.granulation)).toEqual(MES.operators);
    expect(washWork(db, s, ROOM, false)).toBe(30 * 60);
    expect(washWork(db, s, ROOM, true)).toBe(180 * 60);
  });
});

describe('уборка линии и очистка перед каждым заданием', () => {
  test('первое задание: помещение чисто с начала игры дольше 72 часов — уборка снова, потом очистка и проверка; после задания — малая уборка сразу', () => {
    const s = newPlant(bare, { scenario: SC });
    const t0 = s.t;
    const { seen, look } = watch(s);
    // первая серия — не раньше чем через двое суток: к упаковке помещение упаковки чисто с начала игры дольше 72 часов
    const b1 = order(s, s.t + 2 * DAY);
    const b2 = order(s, s.t + 4 * DAY);
    live(s, 30, look, () => b1.status === 'released' && b2.status === 'released' && s.rooms[ROOM].status === 'clean');
    expect([b1.status, b2.status]).toEqual(['released', 'released']);
    const kinds = (b?: string) => seen.filter(x => x.batch === b || (b === undefined && !x.batch)).map(x => x.kind);
    // у каждого задания — очистка и проверка мастера, у первого — и наладка на формат
    expect(kinds(b1.id)).toEqual(['changeover', 'clearance', 'clearCheck']);
    expect(kinds(b2.id)).toEqual(['clearance', 'clearCheck']);
    for (const b of [b1, b2]) expect(b.pack!.clear?.check).toBeDefined();
    // уборки помещения упаковки: перед первым — после просрочки, после каждого задания — малая; моет оператор линии
    const cleans = seen.filter(x => !x.batch);
    expect(cleans.filter(x => x.kind === 'clean').every(x => x.roles.includes('role.line-operator') && !x.roles.includes('role.operator'))).toBe(true);
    expect(cleans.filter(x => x.kind === 'roomClean').every(x => x.roles.every(r => (MES.cleaners as readonly string[]).includes(r)))).toBe(true);
    const first = cleans.find(x => x.kind === 'clean')!;
    expect(first.at - t0).toBeGreaterThan(CLEAN_HOLD);
    expect(first.at).toBeLessThanOrEqual(b1.pack!.clear!.from);
    // очистка линии — только в чистом помещении: уборки, начатые до неё, к ней кончились
    for (const b of [b1, b2]) {
      const before = cleans.filter(x => x.at <= b.pack!.clear!.from);
      expect(before.length).toBeGreaterThan(0);
      for (const c of before) expect(c.end!).toBeLessThanOrEqual(b.pack!.clear!.from);
    }
    const after1 = cleans.filter(x => x.at >= b1.pack!.end!);
    expect(after1[0].at).toBe(b1.pack!.end!);
    expect(after1[0].work).toBe(washWork(db, s, ROOM, false));
    // после второго — чисто для того же продукта
    expect(s.rooms[ROOM].cleanFor).toBe(PRD);
    expect(s.lines[LINE.id].clear).toBe(false);
  });

  test('пока упаковывают — помещение занято серией задания; после — грязное, с её продуктом', () => {
    const s = newPlant(bare, { scenario: SC });
    const b = order(s);
    const { look } = watch(s);
    let busy = false;
    live(s, 20, () => {
      look();
      if (b.pack?.state === 'running') {
        busy = true;
        expect(s.rooms[ROOM].status).toBe('busy');
        expect(s.rooms[ROOM].batch).toBe(b.id);
      }
    }, () => b.pack?.state === 'done');
    expect(busy).toBe(true);
    expect(s.rooms[ROOM].batch).toBeUndefined();
    expect(s.rooms[ROOM].product).toBe(PRD);
    expect(s.rooms[ROOM].status).toBe('dirty');
  });

  test('чисто только для другого продукта — перед заданием генеральная; лишней обработки нет', () => {
    const s = newPlant(bare, { scenario: SC });
    const b = order(s);
    const { seen, look } = watch(s);
    let set = false;
    live(s, 20, () => {
      look();
      // за сутки до упаковки помещение убрали малой уборкой после другого продукта
      if (!set && b.status === 'packing') {
        Object.assign(s.rooms[ROOM], { status: 'clean', since: s.t, cleanFor: 'prd.loratadine10', product: 'prd.loratadine10' });
        set = true;
      }
    }, () => b.pack?.state === 'running');
    const wash = seen.find(x => x.kind === 'clean' && !x.batch)!;
    expect(wash.work).toBe(washWork(db, s, ROOM, true));
    expect(s.losses.reduce((n, d) => n + d.recleans, 0)).toBe(0);
  });

  test('грязное дольше суток — генеральная, как у помещений производства', () => {
    const s = newPlant(bare, { scenario: SC });
    // пятница, 23:00 — смены кончились, до понедельника мыть некому
    apply(bare, s, { kind: 'advance', seconds: 2 * DAY + 16 * HOUR });
    Object.assign(s.rooms[ROOM], { status: 'dirty', since: s.t, product: PRD });
    apply(bare, s, { kind: 'advance', seconds: DIRTY_HOLD + 2 * HOUR });
    const t = Object.values(s.tasks).find(x => x.kind === 'clean' && x.room === ROOM)!;
    expect(s.rooms[ROOM].major).toBe(true);
    expect(t.work).toBe(washWork(db, s, ROOM, true));
    expect(t.roles).toEqual([...washRoles(db, s.plant, ROOM)]);
    expect(check(bare, s)).toEqual([]);
  });

  test('чистота истекла, пока задание ждало после очистки, — уборка снова, лишняя обработка и очистка снова', () => {
    const s = newPlant(bare, { scenario: SC });
    const b = order(s);
    const { seen, look } = watch(s);
    let aged = false;
    live(s, 20, () => {
      look();
      // линию очистили и проверили, а задание ещё ждёт балк: чистоте помещения — больше 72 часов
      if (!aged && s.lines[LINE.id].clear && b.pack?.state !== 'running' && s.lines[LINE.id].batch === b.id) {
        s.rooms[ROOM].since = s.t - CLEAN_HOLD - HOUR;
        aged = true;
      }
    }, () => b.pack?.state === 'running');
    expect(aged).toBe(true);
    expect(seen.filter(x => x.batch === b.id && x.kind === 'clearance').length).toBe(2);
    expect(s.losses.reduce((n, d) => n + d.recleans, 0)).toBeGreaterThanOrEqual(1);
    expect(b.pack!.clear!.from).toBeGreaterThan(seen.filter(x => !x.batch).at(-1)!.at);
  });
});

describe('что видит окно', () => {
  test('машина линии — «ждёт уборки помещения»; «Сейчас» — уборки в упаковке; помещение — «грязно», потом «чисто для продукта» и до какого часа; расписание — на строке линии', () => {
    const s = newPlant(bare, { scenario: SC });
    // к упаковке помещение упаковки чисто с начала игры дольше 72 часов
    const b = order(s, s.t + 2 * DAY);
    const ix = plan.plant.rooms.findIndex(r => r.id === ROOM);
    const room = () => cardView(bare, s, { kind: 'room', i: ix }).card;
    let held = 0;
    const rows = new Set<string>();
    const look = () => {
      // первое задание на линии ждёт уборки: помещение чисто с начала игры дольше 72 часов
      if (s.lines[LINE.id].batch !== b.id || b.pack!.state === 'running' || !Object.values(s.tasks).some(t => t.room === ROOM)) return;
      const m = cardView(bare, s, { kind: 'machine', line: 0, k: 0 }).card;
      if (m?.kind === 'machine' && m.why.some(w => w.k === 'room' && w.code === batchNo(b.code))) held++;
      for (const r of nowView(bare, s).rows) {
        if ((r.kind !== 'clean' && r.kind !== 'roomClean') || r.thing?.kind !== 'room' || r.thing.i !== ix) continue;
        expect([r.dept, r.norm]).toEqual(['line', (r.kind === 'clean' ? washWork : roomWork)(db, s, ROOM, !!s.rooms[ROOM].major)]);
        rows.add(r.kind);
      }
    };
    live(s, 20, look, () => b.pack?.state === 'done');
    expect(held).toBeGreaterThan(0);
    expect([...rows].sort()).toEqual(['clean', 'roomClean']);
    // задание кончилось — грязно после его продукта, малой уборки хватит, если начать до суток
    const r = s.rooms[ROOM];
    expect(room()).toMatchObject({ kind: 'room', status: 'dirty', clean: { k: 'dirty', product: PRD, major: false, until: r.since + DIRTY_HOLD } });
    live(s, 3, () => {}, () => s.rooms[ROOM].status === 'clean');
    expect(room()).toMatchObject({ kind: 'room', status: 'clean', clean: { k: 'clean', product: PRD, until: s.rooms[ROOM].since + CLEAN_HOLD } });
    // прошедшая уборка помещения линии — на строке линии
    const bars = pastBars(bare, s).filter(x => x.kind === 'clean' || x.kind === 'roomClean');
    expect(bars.filter(x => x.row === LINE.id).map(x => x.kind).sort()).toEqual(['clean', 'roomClean']);
    expect(bars.some(x => x.row === ROOM)).toBe(false);
  });

  test('чистота просрочена — в карточке «просрочено»; грязно дольше суток — генеральная', () => {
    const s = newPlant(bare, { scenario: SC });
    const ix = plan.plant.rooms.findIndex(r => r.id === ROOM);
    apply(bare, s, { kind: 'advance', seconds: CLEAN_HOLD + HOUR });
    expect(cardView(bare, s, { kind: 'room', i: ix }).card).toMatchObject({ clean: { k: 'clean', until: s.rooms[ROOM].since + CLEAN_HOLD, expired: true } });
    Object.assign(s.rooms[ROOM], { status: 'dirty', since: s.t - DIRTY_HOLD - HOUR, product: PRD });
    expect(cardView(bare, s, { kind: 'room', i: ix }).card).toMatchObject({ clean: { k: 'dirty', product: PRD, major: true } });
  });
});

describe('сборщик базы — на испорченной копии content/', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  /** Копия content/ с правками: файл → что на что заменить. */
  function broken(edits: Record<string, [string, string][]>): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'pharma-content-'));
    dirs.push(dir);
    cpSync(join(import.meta.dir, '../../content'), dir, { recursive: true });
    for (const [file, e] of Object.entries(edits)) {
      const p = join(dir, file);
      let text = readFileSync(p, 'utf8');
      for (const [a, b] of e) {
        expect(text.includes(a)).toBe(true);
        text = text.replace(a, b);
      }
      writeFileSync(p, text);
    }
    return buildDb(dir).errors;
  }

  test('уборка машины: малая и генеральная — обе, генеральная не короче малой', () => {
    expect(broken({})).toEqual([]);
    expect(broken({ 'machines/blister.yaml': [['cleaning: { minor: 30, major: 180 }', 'cleaning: { minor: 30 }']] }).some(e => e.includes('machines/blister.yaml: cleaning.major'))).toBe(true);
    expect(broken({ 'machines/blister.yaml': [['cleaning: { minor: 30, major: 180 }', 'cleaning: { minor: 200, major: 180 }']] })).toContain('машина mach.blister: малая уборка дольше генеральной');
  });
});

describe('сохранение 0.0.43, схема 26', () => {
  test('у первого задания очистки не было — «не понадобилась»; операторы линии допущены к мойке; следующее задание — после уборки помещения и очистки', async () => {
    const s = fromSave(game, await Bun.file(new URL('./fixtures/save-v26.json', import.meta.url)).text());
    const jobs = Object.values(s.batches).filter(b => b.pack?.start !== undefined).sort((a, b) => a.pack!.start! - b.pack!.start!);
    const firstJob = jobs[0];
    expect(firstJob.pack!.clear).toBeUndefined();
    expect(dossierView(game, s, { view: 'dossier', batch: Number(firstJob.id.slice(1)) }).pack!.clearNone).toBe(true);
    // мойке оборудования учат и операторов линии: запись — как на старте
    const code = game.sops['sop.cleaning'].doc.code;
    const ops = Object.values(s.people).filter(p => p.role === 'role.line-operator');
    expect(ops.length).toBeGreaterThan(0);
    for (const p of ops) expect(p.train[code]).toBeDefined();
    // дальше: задание, начатое после загрузки, — после уборки помещения упаковки и очистки линии
    const before = new Set(jobs.map(b => b.id));
    const washes: number[] = [];
    const known = new Set<string>();
    const fresh = () => Object.values(s.batches).find(b => !before.has(b.id) && b.pack?.state === 'running');
    const end = s.t + 20 * DAY;
    while (!fresh() && s.t < end) {
      apply(game, s, { kind: 'advance', seconds: HOUR });
      for (const t of Object.values(s.tasks)) if (t.kind === 'clean' && t.room === ROOM && !known.has(t.id)) {
        known.add(t.id);
        washes.push(t.created);
      }
      const bad = check(game, s);
      if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
    }
    const b = fresh()!;
    expect(b).toBeDefined();
    expect(washes.some(x => x <= b.pack!.taken!)).toBe(true);
    expect(b.pack!.clear?.check).toBeDefined();
  });
});
