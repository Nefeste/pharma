// Б1д: что в серии (docs/specs/2026-10-vertical-slice.md, «Проверки Б1д»). Порядок загрузки в карте и его проверки
// сборщиком базы; масса по стадиям — магния стеарат на опудривании, у стадии вход = выход + потери, баланс серии, одна
// функция массы для движка и прогона расписания; задание на упаковку записывает людей и очистку линии; досье серии — по
// записям завода, без истины; что в оборудовании, материалы машины линии, история партии, работы комплекта в «Сейчас»,
// значок возврата и справочник; сохранения до схемы 26 — баланс серии между отвешиванием и опудриванием, «не записано»
// у заданий на упаковку.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDb } from '../content/load';
import { db } from '../../src/content';
import { DAY, HOUR, MIN } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { RECON_LIMIT, usedByCount } from '../../src/engine/line';
import { nominal, stageMass } from '../../src/engine/mes';
import { forecast } from '../../src/engine/plan/schedule';
import { planOf } from '../../src/engine/plant';
import { fromSave } from '../../src/engine/save';
import type { Batch, PlantState } from '../../src/engine/types';
import { ICON_OF } from '../../src/render/taskicons';
import { dossierView, insideOf, lineMaterials } from '../../src/sim/dossier';
import { nowView } from '../../src/sim/now';
import { refView } from '../../src/sim/ref';
import { cardView } from '../../src/sim/views';

const SC = 'scn.proto';
const RCP = 'rcp.paracetamol500.wet.v1';
const r = db.recipes[RCP];
const plan = planOf(db, db.scenarios[SC].plant);
const at = (stage: string) => r.stages.findIndex(st => st.id === stage);
const num = (id: string) => Number(id.slice(1));
const MGST = 'mat.exc.mgst';

/** Прожить до условия минутами по `step` с инвариантами; `look` — после каждого шага. */
function until(s: PlantState, done: () => boolean, step = 10 * MIN, look?: () => void, limit = 20 * 24 * HOUR) {
  const end = s.t + limit;
  while (!done()) {
    if (s.t >= end) throw new Error('не дождались');
    apply(db, s, { kind: 'advance', seconds: step });
    look?.();
    const bad = check(db, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
}

const first = (s: PlantState): Batch => Object.values(s.batches).sort((a, b) => num(a.id) - num(b.id))[0];

describe('сборщик базы — порядок загрузки на испорченной копии content/', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const x of dirs) rmSync(x, { recursive: true, force: true });
  });
  function broken(edits: [string, string][]): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'pharma-content-'));
    dirs.push(dir);
    cpSync(join(import.meta.dir, '../../content'), dir, { recursive: true });
    const p = join(dir, 'recipes/paracetamol500.wet.v1.yaml');
    let text = readFileSync(p, 'utf8');
    for (const [a, b] of edits) {
      expect(text.includes(a)).toBe(true);
      text = text.replace(a, b);
    }
    writeFileSync(p, text);
    return buildDb(dir).errors;
  }
  const has = (errors: string[], part: string) => expect([part, errors.some(e => e.includes(part))]).toEqual([part, true]);

  test('строка без стадии, со стадией не из карты и на отвешивании — ошибки', () => {
    has(broken([['{ material: mat.exc.starch, kg: 12, stage: granulate }', '{ material: mat.exc.starch, kg: 12 }']]), 'stage');
    has(broken([['{ material: mat.exc.starch, kg: 12, stage: granulate }', '{ material: mat.exc.starch, kg: 12, stage: coat }']]), 'загружают на стадии coat, а её в карте нет');
    has(broken([['{ material: mat.exc.starch, kg: 12, stage: granulate }', '{ material: mat.exc.starch, kg: 12, stage: dispense }']]), 'загружают на отвешивании');
  });

  test('АФС — только на стадии первого смешивания и не одна', () => {
    has(broken([['potency: true, stage: granulate', 'potency: true, stage: blend']]), 'АФС загружают не на стадии первого смешивания');
    const alone = broken([
      ['{ material: mat.exc.starch, kg: 12, stage: granulate }', '{ material: mat.exc.starch, kg: 12, stage: dry }'],
      ['{ material: mat.exc.povidone, kg: 3, stage: granulate }', '{ material: mat.exc.povidone, kg: 3, stage: dry }'],
      ['{ material: mat.exc.mcc, kg: 4.2, qs: true, stage: granulate }', '{ material: mat.exc.mcc, kg: 4.2, qs: true, stage: dry }'],
    ]);
    has(alone, 'на стадии первого смешивания — АФС и хотя бы один другой компонент');
  });

  test('карты базы: магния стеарат — на опудривании, остальное — в гранулятор', () => {
    for (const id of Object.keys(db.recipes)) {
      const x = db.recipes[id];
      for (const l of x.bom) expect([id, l.material, l.stage]).toEqual([id, l.material, l.material === MGST ? 'blend' : 'granulate']);
    }
  });
});

describe('масса по стадиям и запись упаковки — первая серия на зерне игры', () => {
  const s = newPlant(db, { scenario: SC });
  // до отвешивания: резерв в досье и в карточке помещения — что взвешивают
  until(s, () => first(s).status === 'process' && Object.values(s.tasks).some(t => t.kind === 'stage' && t.batch === first(s).id && t.state === 'busy'));
  const b0 = first(s);
  const reserved = dossierView(db, s, { view: 'dossier', batch: num(b0.id) });
  const weighing = insideOf(db, s, plan.roomOf[r.stages[0].room]);
  // после отвешивания — ходка с остатком в «Сейчас»
  let trip: { material?: string; lot?: [number, number, number] } | undefined;
  until(s, () => !!trip, MIN, () => {
    const row = nowView(db, s).rows.find(x => x.kind === 'return' && x.bn === num(b0.id));
    if (row) trip = { material: row.material, lot: row.lot };
  });
  // идёт грануляция — что в грануляторе
  let granulating: ReturnType<typeof insideOf>;
  let blending: ReturnType<typeof insideOf>;
  let millNorm = 0;
  let millPlan: number | undefined;
  until(s, () => first(s).records.length >= r.stages.length, MIN, () => {
    const b = first(s);
    const busy = Object.values(s.tasks).some(t => t.kind === 'stage' && t.batch === b.id && t.state === 'busy');
    if (busy && b.stage === at('granulate') && !granulating) granulating = insideOf(db, s, b.room!);
    if (busy && b.stage === at('blend') && !blending) blending = insideOf(db, s, b.room!);
    // калибровка впереди: прогон расписания ставит её полосу по той же массе на входе, что движок
    if (b.stage === at('dry') && millPlan === undefined) {
      const bar = forecast(db, s).bars.find(x => x.kind === 'stage' && x.batch === b.id && x.stage === 'mill');
      if (bar) {
        millPlan = bar.to - bar.from;
        millNorm = nominal(db, b.recipe, r.stages[at('mill')], stageMass(db, b, at('mill')));
      }
    }
  });
  const made = structuredClone(first(s));
  // упаковка: материалы у блистерной машины по счёту, пока линия работает; в конце — сверка
  let mats: ReturnType<typeof lineMaterials>;
  let last = new Map<string, number>();
  let step = new Map<string, number>();
  until(
    s,
    () => first(s).pack?.state === 'done',
    MIN,
    () => {
      const b = first(s);
      const line = b.pack ? s.lines[b.pack.line] : undefined;
      if (!line || line.batch !== b.id || b.pack?.state !== 'running') return;
      if (!mats && line.made > 0) mats = lineMaterials(db, s, line.id, 0);
      const now = usedByCount(db, s, line, s.t);
      for (const [m, v] of now) step.set(m, Math.max(step.get(m) ?? 0, v - (last.get(m) ?? 0)));
      last = now;
    },
    10 * 24 * HOUR,
  );
  const packed = first(s);
  const done = dossierView(db, s, { view: 'dossier', batch: num(packed.id) });
  // следующее упакованное задание: перед ним, как и перед первым, — очистка и проверка мастера
  const cleared = () => Object.values(s.batches).find(b => b.id !== packed.id && b.pack?.state === 'done' && b.pack.clear?.check !== undefined);
  until(s, () => !!cleared(), 10 * MIN, undefined, 30 * 24 * HOUR);
  const next = cleared()!;
  const nextView = dossierView(db, s, { view: 'dossier', batch: num(next.id) });

  test('до отвешивания: в досье — резерв по FEFO; в помещении отвешивания — что взвешивают', () => {
    expect(reserved.weighed).toBe(false);
    expect(reserved.disp!.map(x => x.material)).toEqual(r.bom.map(l => l.material));
    for (const x of reserved.disp!) expect([x.material, x.lots.length > 0]).toEqual([x.material, true]);
    expect(weighing?.stage).toBe('dispense');
    expect(weighing!.load.map(x => x.material)).toEqual(r.bom.map(l => l.material));
  });

  test('магния стеарат — на опудривании: на входе грануляции, сушки и калибровки его нет, на входе опудривания — есть', () => {
    const rec = (id: string) => made.records.find(x => x.stage === id)!;
    const weighed = (m: string) => made.dispensed.filter(x => x.material === m).reduce((n, x) => n + x.qty, 0);
    const total = made.dispensed.reduce((n, x) => n + x.qty, 0);
    expect(rec('dispense').out).toBe(total);
    expect(rec('granulate').in).toBe(total - weighed(MGST));
    expect(rec('dry').in).toBe(rec('granulate').out);
    expect(rec('mill').in).toBe(rec('dry').out);
    expect(rec('blend').in).toBe(rec('mill').out + weighed(MGST));
    expect(rec('compress').in).toBe(rec('blend').out);
    for (const x of made.records.slice(1)) expect([x.stage, x.in]).toEqual([x.stage, x.out + x.loss]);
    expect(made.mass + made.records.reduce((n, x) => n + x.loss, 0)).toBe(total);
  });

  test('что в оборудовании: в грануляторе — четыре компонента с партиями; в смесителе — гранулят после калибровки и магния стеарат', () => {
    expect(granulating?.stage).toBe('granulate');
    expect(granulating!.load.map(x => x.material).sort()).toEqual(r.bom.filter(l => l.material !== MGST).map(l => l.material).sort());
    expect(granulating!.prev).toBeUndefined();
    expect(blending?.stage).toBe('blend');
    expect(blending!.prev).toEqual({ stage: 'mill', mass: made.records.find(x => x.stage === 'mill')!.out });
    expect(blending!.load.map(x => x.material)).toEqual([MGST]);
    expect(blending!.mass).toBe(made.records.find(x => x.stage === 'blend')!.in);
  });

  test('прогон расписания и движок: калибровка впереди — по массе на входе той же функцией', () => {
    expect(millPlan).toBeDefined();
    expect(millPlan).toBe(millNorm);
  });

  test('ходка с остатком: в «Сейчас» — материал и партия; значок возврата — свой', () => {
    expect(trip?.material).toBeDefined();
    expect(trip?.lot).toBeDefined();
    expect(ICON_OF.return).toBe('back');
    expect(ICON_OF.pick).toBe('move');
  });

  test('упаковка: люди линии — в записи задания; очистка и кто её проверил — у каждого задания, первого тоже (Б1е)', () => {
    const job = packed.pack!;
    expect(job.people!.length).toBeGreaterThanOrEqual(4);
    expect(job.issued!.length).toBeGreaterThan(0);
    for (const b of [packed, next]) {
      const c = b.pack!.clear!;
      expect(c.by.length).toBe(2);
      for (const id of c.by) expect(s.people[id]?.role ?? s.former[id]?.role).toBe('role.packer');
      expect(s.people[c.check!]?.role ?? s.former[c.check!]?.role).toBe('role.master');
      expect(c.from).toBeLessThan(c.to);
      expect(c.at!).toBeGreaterThanOrEqual(c.to);
      expect(c.at!).toBeLessThanOrEqual(b.pack!.start!);
    }
    expect(next.pack!.people!.length).toBeGreaterThanOrEqual(4);
  });

  test('материалы у блистерной: плёнка и фольга; израсходованное по счёту в конце сходится со списанием без испорченного при заминках', () => {
    const sku = db.skus[packed.pack!.sku];
    expect(mats!.materials.map(m => m.material)).toEqual(sku.blister.map(l => l.material));
    for (const m of mats!.materials) expect(m.left).toBe(m.issued - m.used);
    const job = packed.pack!;
    const used = (m: string) => job.used.filter(x => x.material === m).reduce((n, x) => n + x.qty, 0);
    for (const l of sku.blister) {
      const d = used(l.material) - last.get(l.material)!;
      expect([l.material, d >= 0 && d <= (step.get(l.material) ?? 0)]).toEqual([l.material, true]);
    }
    for (const l of sku.carton) {
      const d = used(l.material) - (job.jammed ?? 0) * l.qty - last.get(l.material)!;
      expect([l.material, d >= 0 && d <= (step.get(l.material) ?? 0)]).toEqual([l.material, true]);
    }
    const cases = used(sku.case.material) - last.get(sku.case.material)!;
    expect(cases >= 0 && cases <= Math.max(1, step.get(sku.case.material) ?? 0)).toBe(true);
  });

  test('досье: отвешено с партиями, кто взвешивал и кто проверял; загрузка по стадиям; упаковка со сверкой; решения', () => {
    expect(done.weighed).toBe(true);
    expect(done.weigh!.by!.n).not.toBe(done.weigh!.check!.n);
    expect(done.weigh!.scale!.inv).toBeDefined();
    const st = (id: string) => done.stages!.find(x => x.stage === id)!;
    expect(done.stages!.every(x => x.state === 'done')).toBe(true);
    expect(st('granulate').load.map(x => x.material)).not.toContain(MGST);
    expect(st('blend').load.map(x => x.material)).toEqual([MGST]);
    expect(st('dry').load).toEqual([]);
    expect(st('compress').ipc.every(x => x.n > 0)).toBe(true);
    const p = done.pack!;
    expect(p.state).toBe('done');
    expect(p.people!.length).toBeGreaterThanOrEqual(4);
    // очистка линии — перед каждым заданием, первым тоже (Б1е): кто очищал и кто проверил
    expect(p.clear!.check).toBeDefined();
    expect(p.clearNone).toBeUndefined();
    expect(nextView.pack!.clear!.check).toBeDefined();
    expect(nextView.pack!.clearNone).toBeUndefined();
    expect(p.result!.good + p.result!.scrap + p.result!.remainder).toBe(p.tablets);
    // сверка — с пределом, как у отклонения: расхождение в нём — не отклонение
    expect(p.reconLimit).toBe(RECON_LIMIT);
    const sku = db.skus[p.sku];
    for (const l of sku.carton) {
      const m = p.materials.find(x => x.material === l.material)!;
      expect(m.spoiled).toBeDefined();
      expect(p.recon!.some(x => x.material === l.material)).toBe(true);
    }
    for (const l of sku.blister) {
      const m = p.materials.find(x => x.material === l.material)!;
      expect(m.used! + m.returned!).toBe(m.issued!);
    }
    expect(done.produced).toBe(made.records.find(x => x.stage === 'granulate')!.start);
  });

  test('досье без истины: ключи — только описанные', () => {
    const keys = new Set<string>();
    const walk = (x: unknown) => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) keys.add(k), walk(v);
    };
    walk(reserved);
    walk(done);
    walk(nextView);
    const ALLOWED = new Set(
      ('view batch gone code recipe product sku status mass units issued produced weighed disp material stage norm potency qs qty lots assay unit ' +
        'weigh scale type i inv by check from to n role tab stages state room roomIx equipment people load in out loss params id target range value dev ipc test ' +
        'stops part devs bulkUnits yield pack line taken start end clear at tablets result good scrap remainder blisters blisterRejects cartons cartonRejects cases pallets ' +
        'materials machine k spoiled used returned recon reconLimit fg kind bulk since checked decision held released clearNone ' +
        // Б1ж: уставка режима стадии — её задал завод
        'sp').split(' '),
    );
    expect([...keys].filter(k => !ALLOWED.has(k))).toEqual([]);
    for (const k of ['truth', 'noise', 'causes', 'screen', 'budget', 'lost', 'jammed', 'wear']) expect(keys.has(k)).toBe(false);
  });

  test('история партии: отвешено на серию — и после отвешивания; на упаковку — выдано и списано', () => {
    const api = made.dispensed[0];
    const unit = Object.values(s.containers).find(c => c.lot === api.lot);
    if (unit) {
      const card = cardView(db, s, { kind: 'unit', n: num(unit.unit) }).card;
      if (card.kind === 'unit') expect(card.history.some(h => h.k === 'weighed' && h.qty > 0)).toBe(true);
    }
    const pk = packed.pack!.issued![0];
    const c = Object.values(s.containers).find(x => x.lot === pk.lot);
    if (c) {
      const card = cardView(db, s, { kind: 'unit', n: num(c.unit) }).card;
      if (card.kind === 'unit') expect(card.history.some(h => h.k === 'pack' && h.used !== undefined)).toBe(true);
    }
  });

  test('справочник: у строки состава — стадия загрузки, у стадии — что на ней загружают', () => {
    const rec = refView(db, s).recipes.find(x => x.id === RCP)!;
    expect(rec.bom.find(l => l.material === MGST)!.stage).toBe('blend');
    expect(rec.stages.find(x => x.id === 'blend')!.load).toEqual([MGST]);
    expect(rec.stages.find(x => x.id === 'dispense')!.load).toEqual([]);
  });
});

describe('сохранения до схемы 26', () => {
  const load = async (v: number) => fromSave(db, await Bun.file(new URL(`./fixtures/save-v${v}.json`, import.meta.url)).text());

  // в этих образцах серия — между отвешиванием и опудриванием: прежний движок вёл магния стеарат в массе с грануляции
  test.each([4, 7, 21, 24, 25])('образец схемы %d: серия доходит до опудривания, на его входе — калибровка и магния стеарат, баланс сходится', async v => {
    const s = await load(v);
    const b = Object.values(s.batches).find(x => x.status === 'process' && x.stage >= 1 && x.stage < at('blend') && x.dispensed.length > 0)!;
    expect(b).toBeDefined();
    until(s, () => s.batches[b.id].records.some(x => x.stage === 'blend'), 10 * MIN, undefined, 10 * DAY);
    const x = s.batches[b.id];
    const rec = (id: string) => x.records.find(y => y.stage === id)!;
    const mg = x.dispensed.filter(k => k.material === MGST).reduce((n, k) => n + k.qty, 0);
    expect(rec('blend').in).toBe(rec('mill').out + mg);
  });

  test('образец схемы 25: у сделанного задания на упаковку людей и очистки нет — «не записано»; выдано — по сверке у печатных, израсходовано — по списанию', async () => {
    const s = await load(25);
    const b = Object.values(s.batches).find(x => x.pack?.state === 'done')!;
    const p = dossierView(db, s, { view: 'dossier', batch: num(b.id) }).pack!;
    expect(p.people).toBeUndefined();
    expect(p.clear).toBeUndefined();
    const sku = db.skus[p.sku];
    expect(p.materials.length).toBe(sku.blister.length + sku.carton.length + 1);
    for (const m of p.materials) {
      const printed = sku.carton.some(l => l.material === m.material);
      expect([m.material, m.issued !== undefined, m.returned !== undefined, m.used! > 0, m.lots.length > 0]).toEqual([m.material, printed, printed, true, true]);
    }
  });

  test('образец схемы 11: задание посреди упаковки доупаковано, а людей в запись после загрузки не дописали', async () => {
    const s = await load(11);
    const b = Object.values(s.batches).find(x => x.pack?.state === 'running')!;
    expect(b.pack!.people).toBeUndefined();
    until(s, () => s.batches[b.id].pack!.state === 'done', 10 * MIN, undefined, 5 * DAY);
    expect(s.batches[b.id].pack!.people).toBeUndefined();
    expect(dossierView(db, s, { view: 'dossier', batch: num(b.id) }).pack!.people).toBeUndefined();
  });
});
