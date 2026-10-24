// Б1ж: режимы (docs/specs/2026-10-vertical-slice.md, «Б1ж»). Уставку режима стадии карты и скорости блистерной машины
// по инструкции по упаковке задаёт технолог — пост «Качество и технология», в пределах диапазона редакции в силе
// и шагом от цели; новый диапазон — не его решение. Стадия берёт уставки, когда начинается, задание — когда линия его
// берёт; аппаратчик ведёт режим у уставки с прежним разбросом. Скорость ротора меняет длительность таблетирования
// и наработку узлов в час, каталог причин — прочность, истираемость и разброс массы; сила выше цели — пуансоны
// изнашиваются быстрее; скорость блистерной — выпуск, микроостановки и брак камеры. Игрок ушёл с поста — коллега
// технологии держит цель.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacy as db } from './legacy';
import { db as game } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { DAY, HOUR } from '../../src/engine/core/calendar';
import { P_ONE } from '../../src/engine/core/rng';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { geo } from '../../src/engine/line';
import { nominal, stageMass } from '../../src/engine/mes';
import { paramKey, setpointOf, speedKey, speedOf, unitsPerHour } from '../../src/engine/modes';
import { fromSave, toSave } from '../../src/engine/save';
import { regimesAt } from '../../src/sim/devs';
import { dossierView } from '../../src/sim/dossier';
import { nowView } from '../../src/sim/now';
import { refView } from '../../src/sim/ref';
import { modeRows } from '../../src/sim/report';
import { cardView } from '../../src/sim/views';
import type { Batch, Notice, PlantState } from '../../src/engine/types';
import { buildDb } from '../content/load';

const SC = 'scn.proto';
const RCP = 'rcp.paracetamol500.wet.v1';
const N20 = 'sku.paracetamol500.n20';
const ROOM = db.plants[db.scenarios[SC].plant].rooms.find(r => r.type === 'compression')!.id;

/** Завод без заданий сценария: серии в тесте заказываются вручную. */
const bare: ContentDb = { ...db, scenarios: { ...db.scenarios, [SC]: { ...db.scenarios[SC], batches: [] } } };
const press = bare.recipes[RCP].stages.find(st => st.id === 'compress')!;
const SPEED = press.params.find(p => p.id === 'speed')!;
const FORCE = press.params.find(p => p.id === 'force')!;
const CODE = bare.recipes[RCP].doc.code;

function order(s: PlantState, notBefore = s.t): Batch {
  const n = Object.keys(s.batches).length;
  apply(bare, s, { kind: 'order', recipe: RCP, notBefore, sku: N20 });
  return Object.values(s.batches)[n];
}

/** Прожить до `until` (не дольше `days` суток) часами с инвариантами. */
function live(s: PlantState, days: number, until: () => boolean, each?: () => void) {
  const end = s.t + days * DAY;
  while (s.t < end && !until()) {
    apply(bare, s, { kind: 'advance', seconds: Math.min(HOUR, end - s.t) }, () => (each?.(), true));
    each?.();
    const bad = check(bare, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
}

const set = (s: PlantState, param: string, value: number, by?: string): Notice[] => apply(bare, s, { kind: 'setpoint', recipe: RCP, stage: 'compress', param, value, ...(by ? { by } : {}) });
const compressOf = (b: Batch) => b.records.find(r => r.stage === 'compress');

describe('команда уставки', () => {
  test('в диапазоне на шаге — принята; по цели — снята; вне диапазона, не на шаге, нет режима — отказ с причиной', () => {
    const s = newPlant(bare, { scenario: SC });
    expect(set(s, 'speed', SPEED.target + 2 * SPEED.step)).toEqual([]);
    expect(s.setpoints[paramKey(CODE, 'compress', 'speed')]).toEqual({ v: SPEED.target + 2 * SPEED.step, from: s.t });
    expect(setpointOf(bare, s, RCP, 'compress', SPEED)).toBe(SPEED.target + 2 * SPEED.step);
    expect(set(s, 'speed', SPEED.range[1] + SPEED.step)).toEqual([{ kind: 'refused', cmd: 'setpoint', why: 'outOfRange', detail: paramKey(CODE, 'compress', 'speed') }]);
    expect(set(s, 'speed', SPEED.target + 1)).toEqual([{ kind: 'refused', cmd: 'setpoint', why: 'offStep', detail: paramKey(CODE, 'compress', 'speed') }]);
    expect(set(s, 'nothing', 1)[0]).toMatchObject({ kind: 'refused', why: 'noParam' });
    expect(apply(bare, s, { kind: 'setpoint', recipe: 'rcp.none', stage: 'compress', param: 'speed', value: 1 })[0]).toMatchObject({ why: 'noRecipe' });
    expect(apply(bare, s, { kind: 'setpoint', sku: 'sku.none', value: 1 })[0]).toMatchObject({ why: 'noSku' });
    // уставка по цели — записи нет: держать нечего
    expect(set(s, 'speed', SPEED.target)).toEqual([]);
    expect(s.setpoints[paramKey(CODE, 'compress', 'speed')]).toBeUndefined();
    // скорость блистерной позиции — у кода инструкции по упаковке
    const k = bare.skus[N20];
    expect(apply(bare, s, { kind: 'setpoint', sku: N20, value: k.speed.target + k.speed.step })).toEqual([]);
    expect(s.setpoints[speedKey(k.doc.code)]?.v).toBe(k.speed.target + k.speed.step);
    expect(speedOf(bare, s, N20)).toBe(k.speed.target + k.speed.step);
  });

  test('пост «Качество и технология»: без него — отказ «не ваше»; уйти с поста — коллега вернёт цель', () => {
    const s = newPlant(bare, { scenario: SC });
    apply(bare, s, { kind: 'seat', seats: ['production'] });
    expect(set(s, 'speed', SPEED.target + SPEED.step * 2, 'player')).toEqual([{ kind: 'refused', cmd: 'setpoint', why: 'notYours', detail: 'quality' }]);
    apply(bare, s, { kind: 'seat', seats: ['quality'] });
    expect(set(s, 'speed', SPEED.target + SPEED.step * 2, 'player')).toEqual([]);
    expect(apply(bare, s, { kind: 'setpoint', sku: N20, value: bare.skus[N20].speed.range[0], by: 'player' })).toEqual([]);
    expect(Object.keys(s.setpoints).length).toBe(2);
    // ушёл с поста — коллега технологии держит цель карты
    expect(apply(bare, s, { kind: 'seat', seats: ['production'] })).toEqual([{ kind: 'setpoints', n: 2, by: 'colleague' }]);
    expect(s.setpoints).toEqual({});
    // директор держит и этот пост: уйти на директора — не уход
    apply(bare, s, { kind: 'seat', seats: ['quality'] });
    set(s, 'speed', SPEED.target - SPEED.step, 'player');
    expect(apply(bare, s, { kind: 'seat', seats: ['director'] })).toEqual([]);
    expect(Object.keys(s.setpoints).length).toBe(1);
  });
});

describe('стадия берёт уставки, когда начинается', () => {
  // две серии: у первой таблетирование идёт по цели, вторая начнёт его после смены уставки
  const s = newPlant(bare, { scenario: SC });
  const fast = SPEED.target + 4 * SPEED.step;
  const b1 = order(s);
  const b2 = order(s, s.t + 6 * HOUR);
  let changed = false;
  live(s, 25, () => !!compressOf(b1) && !!compressOf(b2), () => {
    // таблетирование первой серии началось — уставка скорости выше цели; начатую она не трогает
    if (!changed && b1.room === ROOM && b1.sp) {
      set(s, 'speed', fast);
      changed = true;
    }
  });
  const r1 = compressOf(b1)!;
  const r2 = compressOf(b2)!;

  test('начатая стадия — со своими уставками, следующая — с новыми; в записи — уставка и факт', () => {
    expect(changed).toBe(true);
    expect(r1.sp?.speed).toBe(SPEED.target);
    expect(r2.sp?.speed).toBe(fast);
    expect(r1.sp?.force).toBe(FORCE.target);
    // факт — у уставки с разбросом аппаратчика: не дальше шести его сигм
    const sd = (p: typeof SPEED) => Math.max(1, Math.floor((p.sd * 5) / 3));
    expect(Math.abs(r1.params.speed - SPEED.target)).toBeLessThanOrEqual(6 * sd(SPEED));
    expect(Math.abs(r2.params.speed - fast)).toBeLessThanOrEqual(6 * sd(SPEED));
    expect(b1.sp).toBeUndefined();
    expect(b2.sp).toBeUndefined();
  });

  test('скорость ротора — производительность карты вместе с ней: таблетирование второй серии короче', () => {
    const mass = (b: Batch) => compressOf(b)!.in;
    expect(unitsPerHour(press, { speed: fast })).toBe(Math.floor((press.time.unitsPerHour! * fast) / SPEED.target));
    expect(nominal(bare, RCP, press, mass(b2), { speed: fast })).toBeLessThan(nominal(bare, RCP, press, mass(b2)));
    // длительность — по норме на уставке с разбросом карты; у второй серии стадия короче нормы по цели
    expect(r2.end - r2.start).toBeLessThan(nominal(bare, RCP, press, mass(b2)));
    expect(r1.end - r1.start).toBeGreaterThan(nominal(bare, RCP, press, mass(b1), { speed: fast }));
  });

  test('каталог причин: скорость сверх цели — прочность ниже, истираемость выше; разброс массы — только выше цели', () => {
    const hit = (b: Batch, a: string) => b.causes.find(c => c.cause === 'cause.press.speed' && c.attr === a);
    const off = r2.params.speed - SPEED.target;
    expect(off).toBeGreaterThan(0);
    expect(hit(b2, 'hardness')!.delta).toBeLessThan(0);
    expect(hit(b2, 'friability')!.delta).toBeGreaterThan(0);
    expect(bare.causes['cause.press.speed'].scatter!.map(x => x.attr)).toEqual(['mass']);
  });
});

describe('сила выше цели — пуансоны изнашиваются быстрее', () => {
  /** Одна серия до конца таблетирования с силой `force`; на сколько наработали пуансоны и сколько таблеток. */
  function pressed(force: number) {
    const s = newPlant(bare, { scenario: SC });
    if (force !== FORCE.target) set(s, 'force', force);
    const pt = Object.values(s.parts).find(p => p.type === 'punches')!;
    const done0 = pt.done;
    const b = order(s);
    live(s, 15, () => !!compressOf(b));
    return { worn: s.parts[pt.id].done - done0, rec: compressOf(b)! };
  }

  test('на каждый кН сверх цели — наработка на таблетку больше на долю из записи узла', () => {
    const at = pressed(FORCE.target);
    const hi = pressed(FORCE.target + 2 * FORCE.step);
    const stress = bare.equipment['eq.press'].parts.find(p => p.id === 'punches')!.stress!;
    expect(stress.param).toBe('force');
    // по цели — по таблеткам; выше цели — больше на coef × отход уставки
    expect(at.worn).toBeGreaterThan(0);
    const k = P_ONE + stress.coef * 2 * FORCE.step;
    expect(Math.abs(hi.worn - Math.floor((at.worn * k) / P_ONE))).toBeLessThanOrEqual(Math.ceil(at.worn / 100));
    expect(hi.rec.sp?.force).toBe(FORCE.target + 2 * FORCE.step);
  });
});

describe('скорость блистерной машины — уставка у позиции', () => {
  test('ход — по уставке, паспорт — для OEE; быстрее цели — брак камеры и микроостановки на блистер чаще', () => {
    const s = newPlant(bare, { scenario: SC });
    const line = Object.values(s.lines)[0];
    const k = bare.skus[N20];
    const m = bare.machines['mach.blister'];
    const at = geo(bare, s, line, { sku: N20 });
    expect(at.speed[0]).toBe(k.speed.target * k.perBlister);
    expect(at.nominal[0]).toBe(m.nominal * k.perBlister);
    expect(at.stops[0]).toBe(P_ONE);
    expect(at.rej[0]).toBe(m.reject);
    const top = k.speed.range[1];
    const fast = geo(bare, s, line, { sku: N20, speed: top });
    const share = Math.round(((top - k.speed.target) * P_ONE) / k.speed.target);
    expect(fast.speed[0]).toBe(top * k.perBlister);
    expect(fast.stops[0]).toBe(P_ONE + Math.round((m.fast!.micro * share) / P_ONE));
    expect(fast.rej[0]).toBe(Math.floor((m.reject * (P_ONE + Math.round((m.fast!.reject * share) / P_ONE))) / P_ONE));
    const slow = geo(bare, s, line, { sku: N20, speed: k.speed.range[0] });
    expect(slow.rej[0]).toBeLessThan(m.reject);
    // картонажная и укладка — без уставки: ход — паспорт
    expect(fast.speed.slice(1)).toEqual(fast.nominal.slice(1));
  });

  test('задание идёт со скоростью, какая была, когда линия его взяла; следующее — с новой', () => {
    const s = newPlant(bare, { scenario: SC });
    const k = bare.skus[N20];
    const v = k.speed.target + k.speed.step;
    apply(bare, s, { kind: 'setpoint', sku: N20, value: v });
    const b = order(s);
    let then: number | undefined;
    live(s, 30, () => b.pack?.state === 'done', () => {
      if (b.pack?.taken !== undefined && then === undefined) {
        then = b.pack.speed;
        apply(bare, s, { kind: 'setpoint', sku: N20, value: k.speed.target });
      }
    });
    expect(then).toBe(v);
    expect(b.pack!.speed).toBe(v);
    expect(b.pack!.state).toBe('done');
    expect(speedOf(bare, s, N20)).toBe(k.speed.target);
  });
});

describe('сохранения', () => {
  test('схема 27: уставок нет — всё по цели; серия посреди стадии доводит её по цели; живёт дальше', async () => {
    const s = fromSave(game, await Bun.file(new URL('./fixtures/save-v27.json', import.meta.url)).text());
    expect(s.setpoints).toEqual({});
    for (const b of Object.values(s.batches)) {
      const st = game.recipes[b.recipe].stages[b.stage];
      if (b.status === 'process' && b.room && st?.params.length) expect(b.sp).toEqual(Object.fromEntries(st.params.map(p => [p.id, p.target])));
    }
    // у прежних записей таблетирования скорости ротора нет — читается с целью карты: в досье уставка — цель, факта нет
    const old = Object.values(s.batches).find(b => b.records.some(r => r.stage === 'compress'))!;
    const st = dossierView(game, s, { view: 'dossier', batch: Number(old.id.slice(1)) }).stages!.find(x => x.stage === 'compress')!;
    const sp = st.params.find(p => p.id === 'speed')!;
    expect(sp.sp).toBe(sp.target);
    expect(sp.value).toBeUndefined();
    const end = s.t + 3 * DAY;
    while (s.t < end) apply(game, s, { kind: 'advance', seconds: HOUR });
    expect(check(game, s)).toEqual([]);
  });

  test('уставки — в сохранении и обратно', () => {
    const s = newPlant(bare, { scenario: SC });
    set(s, 'speed', SPEED.target - SPEED.step);
    const back = fromSave(bare, toSave(s));
    expect(back.setpoints).toEqual(s.setpoints);
  });
});

describe('виды — по записям завода, без истины', () => {
  const s = newPlant(bare, { scenario: SC });
  const fast = SPEED.target + 2 * SPEED.step;
  set(s, 'speed', fast);
  const b = order(s);
  live(s, 15, () => b.room === ROOM && !!b.sp);

  test('карточка помещения: уставка начатой стадии; уставки на следующую — у каждой карты, чьи стадии идут здесь', () => {
    const g = regimesAt(bare, s, ROOM)!;
    expect(g.now).toBe(true);
    expect(g.list.find(p => p.id === 'speed')!.sp).toBe(fast);
    const i = bare.plants[bare.scenarios[SC].plant].rooms.findIndex(r => r.id === ROOM);
    const card = cardView(bare, s, { kind: 'room', i }).card;
    if (card.kind !== 'room') throw new Error(card.kind);
    expect(card.knobs!.map(k => `${k.recipe}/${k.stage}`).sort()).toEqual(Object.values(bare.recipes).map(r => `${r.id}/compress`).sort());
    const kn = card.knobs!.find(k => k.recipe === RCP)!.list.find(p => p.id === 'speed')!;
    expect(kn).toEqual({ id: 'speed', unit: 'rpm', target: SPEED.target, set: fast, step: SPEED.step, range: [SPEED.range[0], SPEED.range[1]] });
    expect(JSON.stringify(g)).not.toContain('truth');
    expect(JSON.stringify(card)).not.toContain('truth');
  });

  test('до первой серии в помещении — уставки уже видны', () => {
    const z = newPlant(bare, { scenario: SC });
    const i = bare.plants[bare.scenarios[SC].plant].rooms.findIndex(r => r.id === ROOM);
    const card = cardView(bare, z, { kind: 'room', i }).card;
    if (card.kind !== 'room') throw new Error(card.kind);
    expect(card.regimes).toBeUndefined();
    expect(card.knobs!.length).toBe(Object.keys(bare.recipes).length);
  });

  test('справочник, «Сейчас», планёрка: уставка рядом с целью, норма по ней, не по цели — с какого часа', () => {
    const st = refView(bare, s).recipes.find(r => r.id === RCP)!.stages.find(x => x.id === 'compress')!;
    expect(st.params.find(p => p.id === 'speed')!.set).toBe(fast);
    expect(st.atSet).toBeLessThan(st.nominal);
    const row = nowView(bare, s).rows.find(r => r.kind === 'stage' && r.stage === 'compress');
    if (row) {
      expect(row.speed).toBe(fast);
      expect(row.norm).toBe(nominal(bare, RCP, press, stageMass(bare, b, b.stage), b.sp));
    }
    expect(modeRows(bare, s)).toEqual([{ recipe: RCP, stage: 'compress', unit: 'rpm', param: 'speed', v: fast, target: SPEED.target, from: s.setpoints[paramKey(CODE, 'compress', 'speed')].from }]);
  });

  test('карточка блистерной: позиция задания, уставка, цель, диапазон, паспорт', () => {
    const plan = bare.plants[bare.scenarios[SC].plant];
    const card = cardView(bare, s, { kind: 'machine', line: 0, k: 0 }).card;
    expect(plan.lines[0].machines[0].type).toBe('mach.blister');
    if (card.kind !== 'machine') throw new Error(card.kind);
    expect(card.speed!.rated).toBe(bare.machines['mach.blister'].nominal);
    expect(card.speed!.list.map(x => x.sku).sort()).toEqual(Object.keys(bare.skus).sort());
    expect(card.speed!.list.find(x => x.sku === N20)).toEqual({ sku: N20, target: 120, range: [100, 135], step: 5, set: 120 });
  });
});

describe('сборщик базы — на испорченной копии content/', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
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
  const RF = 'recipes/paracetamol500.wet.v1.yaml';
  const SPD = '{ id: speed, unit: rpm, target: 50, range: [40, 60], sd: 1, step: 2 }';

  test('режим: цель в диапазоне, шагом от цели — до обоих краёв', () => {
    expect(broken({})).toEqual([]);
    expect(broken({ [RF]: [[SPD, '{ id: speed, unit: rpm, target: 50, range: [52, 60], sd: 1, step: 2 }']] })).toContain(`карта rcp.paracetamol500.wet.v1, стадия compress: цель режима speed вне диапазона`);
    expect(broken({ [RF]: [[SPD, '{ id: speed, unit: rpm, target: 50, range: [40, 60], sd: 1, step: 3 }']] })).toContain(`карта rcp.paracetamol500.wet.v1, стадия compress: от цели режима speed шагом 3 не дойти до краёв диапазона`);
  });

  test('скорость блистерной у позиции: в диапазоне, шагом до краёв, не быстрее паспорта машины', () => {
    const KF = 'skus/paracetamol500/n20.yaml';
    const SP = 'speed: { target: 120, range: [100, 135], step: 5 }';
    expect(broken({ [KF]: [[SP, 'speed: { target: 120, range: [100, 140], step: 5 }']] })).toContain('позиция sku.paracetamol500.n20: скорость 140 — быстрее паспорта машины mach.blister или у неё нет уставки');
    expect(broken({ [KF]: [[SP, 'speed: { target: 120, range: [100, 135], step: 7 }']] })).toContain('позиция sku.paracetamol500.n20: от цели скорости шагом 7 не дойти до краёв диапазона');
  });

  test('нагрузка узла — режим стадии на этом оборудовании; разброс причины — от режима', () => {
    expect(broken({ 'equipment/press.yaml': [['stress: { param: force, coef: 10 }', 'stress: { param: inletTemp, coef: 10 }']] })).toContain('оборудование eq.press, узел punches: режим inletTemp — не у стадии на этом оборудовании');
    expect(broken({ 'causes/press/mass.yaml': [['effects:', 'scatter:\n  - { attr: mass, coef: 0.1 }\neffects:']] })).toContain('причина cause.press.mass: разброс МОК — от отхода режима стадии');
  });
});
