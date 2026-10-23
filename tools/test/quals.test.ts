// Люди и допуски (Б3б; docs/specs/2026-10-vertical-slice.md, «Проверки Б3б»): у процедур — шапка, матрица обучения и
// работы, которым они нужны; сборщик базы ловит роль работы вне матрицы, разные матрицы у редакций одного документа и
// записи на старте старше самого короткого срока. Допуск — запись на действующую редакцию или новее, срок не истёк;
// раздатчик даёт задачу только допущенному, а нет таких — задача ждёт «нет допуска» с документом; ричтрак водит только
// допущенный к нему. Обучение — за срок предупреждения до конца записи или до новой редакции; знания проверяет не тот,
// кто учился; запись — с днём проверки; потерял допуск — извещение. Прогон расписания считает только допущенных сейчас.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import { addMonths, DAY, daysFromCivil, HOUR, MIN, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { MES, MES_PRIO } from '../../src/engine/mes';
import { forecast } from '../../src/engine/plan/schedule';
import { planOf } from '../../src/engine/plant';
import { dueRev, knows, learnCodes, matrixOf, needFor, rowsOf, vehicleNeed } from '../../src/engine/quals';
import { fromSave } from '../../src/engine/save';
import { addTask, dispatch, dropTask } from '../../src/engine/tasks';
import { CHECKERS, TRAIN_PRIO, trainDay } from '../../src/engine/train';
import type { Notice, PlantState, Task } from '../../src/engine/types';
import { morningView } from '../../src/sim/report';
import { refView } from '../../src/sim/ref';
import { cardView } from '../../src/sim/views';
import { buildDb } from '../content/load';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const start = daysFromCivil(sc.start.date);
const plan = planOf(db, sc.plant);
const R1 = 'sop.cleaning';
const R2 = 'sop.cleaning-r2';
const CLEAN = 'SOP-0015';
const r2from = db.sops[R2].doc.from;

const dayOf = (s: PlantState) => momentOf(s.start, s.t).day;
/** Игровые секунды от начала партии до часа `hour` суток `day` (номер дня от 1970-01-01). */
const at = (day: number, hour: number) => (day - start) * DAY + hour * HOUR;
const post = (role: string): Task['from'] => ({ kind: 'point', ...plan.posts[role] });
const by = (s: PlantState, role: string) => Object.values(s.people).filter(p => p.role === role);

describe('процедуры и матрица обучения в базе', () => {
  test('процедуры — с шапкой SOP-NNNN, источником и проверкой «черновик»; у процедур и методик — роли, часы и срок', () => {
    for (const x of Object.values(db.sops)) {
      expect(x.doc.code).toMatch(/^SOP-\d{4}$/);
      expect([x.id, x.review, (x.source ?? []).length > 0]).toEqual([x.id, 'draft', true]);
    }
    for (const x of [...Object.values(db.sops), ...Object.values(db.tests)]) {
      expect(x.roles.length).toBeGreaterThan(0);
      expect(x.study).toBeGreaterThan(0);
      expect(x.every).toBeGreaterThan(0);
    }
    // новая редакция уборки — в первом месяце сценария, у неё та же строка матрицы
    expect([db.sops[R1].doc.code, db.sops[R2].doc.code, db.sops[R2].doc.rev]).toEqual([CLEAN, CLEAN, 2]);
    expect(r2from - start).toBe(19);
    expect(db.sops[R2].roles).toEqual(db.sops[R1].roles);
  });

  test('у каждой роли штата — строка матрицы с основами GMP; ричтрак — только у водителя; проверяют знания ООК и ОКК', () => {
    for (const row of sc.staff) expect([row.role, matrixOf(db, row.role).includes('SOP-0001')]).toEqual([row.role, true]);
    expect(vehicleNeed(db, 'veh.reach')).toEqual(['SOP-0005']);
    expect(vehicleNeed(db, 'veh.jack')).toEqual(['SOP-0006']);
    expect(matrixOf(db, 'role.driver')).toContain('SOP-0005');
    expect(matrixOf(db, 'role.storekeeper')).not.toContain('SOP-0005');
    expect(matrixOf(db, 'role.storekeeper')).toContain('SOP-0006');
    for (const r of CHECKERS) expect(sc.staff.some(row => row.role === r)).toBe(true);
    // в справочнике — все коды по порядку: процедуры, потом методики
    const codes = learnCodes(db);
    expect(codes).toEqual([...codes].sort());
    expect(codes.length).toBe(new Set([...Object.values(db.sops), ...Object.values(db.tests)].map(x => x.doc.code)).size);
  });

  test('что нужно для работы: вид задачи и «любая работа»; у стадии — оборудование и МОК; у испытания — методика; обучению — ничего', () => {
    expect(needFor(db, 'clean')).toEqual(['SOP-0001', 'SOP-0002', CLEAN]);
    expect(needFor(db, 'move')).toEqual(['SOP-0001', 'SOP-0004']);
    expect(needFor(db, 'prep', { method: 'test.lod' })).toEqual(['SOP-0001', 'TM-0003']);
    const dry = db.recipes['rcp.paracetamol500.wet.v1'].stages.find(st => st.id === 'dry')!;
    expect(needFor(db, 'stage', { stage: dry })).toEqual(['SOP-0001', 'SOP-0002', 'SOP-0011', 'TM-0003']);
    const machines = plan.plant.lines[0].machines.map(m => m.type);
    expect(needFor(db, 'crew', { machines })).toEqual(['SOP-0001', 'SOP-0002', 'SOP-0016']);
    expect([needFor(db, 'train'), needFor(db, 'trainCheck')]).toEqual([[], []]);
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
  const has = (errors: string[], part: string) => expect(errors.some(e => e.includes(part))).toBe(true);

  test('роль, которой движок даёт работу, — вне матрицы её процедуры или методики', () => {
    has(broken({ 'sops/cleanzone.yaml': [['role.driver, ', '']] }), 'процедура sop.cleanzone: нужна работе роли role.driver, а в матрице обучения её нет');
    has(broken({ 'sops/press.yaml': [['roles: [role.operator]', 'roles: [role.master]']] }), 'процедура sop.press: нужна работе роли role.operator');
    // методика: испытание ведёт аналитик, МОК при сушке — аппаратчик
    has(broken({ 'tests/lod.yaml': [['roles: [role.analyst, role.qc-head, role.operator]', 'roles: [role.qc-head, role.operator]']] }), 'методика test.lod: нужна работе роли role.analyst');
    has(broken({ 'tests/lod.yaml': [['roles: [role.analyst, role.qc-head, role.operator]', 'roles: [role.analyst, role.qc-head]']] }), 'методика test.lod: нужна работе роли role.operator');
    // техника — исключение: на ричтраке ездят роли его матрицы, остальные берут рохлю
    expect(broken({ 'sops/reach.yaml': [['roles: [role.driver]', 'roles: [role.storekeeper]']] })).toEqual([]);
  });

  test('редакции одного документа — одна строка матрицы и одни работы; роль и машина — из базы; обучению процедура не нужна', () => {
    has(broken({ 'sops/cleaning-r2.yaml': [['roles: [role.operator]', 'roles: [role.operator, role.master]']] }), 'разные роли или работы — матрица обучения у документа одна');
    has(broken({ 'sops/cleaning-r2.yaml': [['tasks: [clean]', 'tasks: [clean, repair]']] }), 'документ SOP-0015: у редакций');
    has(broken({ 'sops/cleaning.yaml': [['roles: [role.operator]', 'roles: [role.operator, role.nobody]']] }), 'процедура sop.cleaning: учится роль role.nobody — нет такой роли');
    has(broken({ 'sops/cleanzone.yaml': [['for: {', 'for: { machines: [mch.nobody],']] }), 'процедура sop.cleanzone: нет машины mch.nobody');
    has(broken({ 'sops/receiving.yaml': [['tasks: [', 'tasks: [train, ']] }), 'sops/receiving.yaml: for.tasks.0:');
    has(broken({ 'sops/gmp.yaml': [['code: SOP-0001', 'code: SP-0001']] }), 'код документа — SOP-NNNN');
  });

  test('записи на старте — моложе самого короткого срока обучения', () => {
    has(broken({ 'scenarios/proto.yaml': [['spread: 330', 'spread: 336']] }), 'сценарий scn.proto: training.spread — на старте записи старше самого короткого срока обучения, 12 мес.');
    expect(broken({ 'scenarios/proto.yaml': [['spread: 330', 'spread: 335']] })).toEqual([]);
  });
});

describe('допуск по записи', () => {
  const s = newPlant(db, { scenario: SC });
  const p = s.people.E9;

  test('запись на прежнюю редакцию — до дня новой; на новую — и до её дня; срок кончился — не допущен; записи нет — не допущен', () => {
    expect(p.role).toBe('role.operator');
    p.train[CLEAN] = { rev: R1, day: start - 10, until: start + 100 };
    expect([knows(db, p, CLEAN, start), knows(db, p, CLEAN, r2from - 1), knows(db, p, CLEAN, r2from)]).toEqual([true, true, false]);
    const until = addMonths(start + 5, 12) - 1;
    p.train[CLEAN] = { rev: R2, day: start + 5, until };
    expect([knows(db, p, CLEAN, start + 5), knows(db, p, CLEAN, r2from), knows(db, p, CLEAN, until), knows(db, p, CLEAN, until + 1)]).toEqual([true, true, true, false]);
    delete p.train[CLEAN];
    expect(knows(db, p, CLEAN, start)).toBe(false);
  });

  test('пора учиться: за срок предупреждения до новой редакции или до конца записи; записи нет — сразу', () => {
    const ahead = sc.training.ahead;
    p.train[CLEAN] = { rev: R1, day: start - 10, until: start + 100 };
    expect(dueRev(db, p, CLEAN, r2from - ahead - 1, ahead)).toBeUndefined();
    expect(dueRev(db, p, CLEAN, r2from - ahead, ahead)).toBe(R2);
    const until = addMonths(start + 5, 12) - 1;
    p.train[CLEAN] = { rev: R2, day: start + 5, until };
    expect(dueRev(db, p, CLEAN, until - ahead - 1, ahead)).toBeUndefined();
    expect(dueRev(db, p, CLEAN, until - ahead, ahead)).toBe(R2);
    delete p.train[CLEAN];
    expect(dueRev(db, p, CLEAN, start, ahead)).toBe(R1);
    expect(dueRev(db, p, 'SOP-9999', start, ahead)).toBeUndefined();
  });
});

describe('раздатчик даёт задачу только допущенному', () => {
  /** Утро первого дня: люди дневной смены пришли и идут на посты — свободны. */
  function morning(): PlantState {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: 8 * HOUR + 20 - s.t });
    return s;
  }

  test('нет записи — задачу не дают; допущенных в смене нет — «нет допуска» и документ; запись появилась — дают', () => {
    const s = morning();
    const [keeper] = by(s, 'role.storekeeper');
    expect(keeper.task).toBeUndefined();
    const rec = keeper.train['SOP-0004'];
    delete keeper.train['SOP-0004'];
    const t = addTask(s, { kind: 'move', roles: ['role.storekeeper'], from: post('role.storekeeper'), work: 60, prio: 99 });
    dispatch(db, s);
    expect([t.state, t.why, t.lack]).toEqual(['open', 'qual', 'SOP-0004']);
    // вид окна: в причине — документ и редакция, действующая сегодня
    const why = cardView(db, s, { kind: 'person', n: Number(keeper.id.slice(1)) }).card;
    expect(why?.kind === 'person' && why.adm).toEqual({ k: 'no', doc: { code: 'SOP-0004', kind: 'sops', id: 'sop.storage', rev: 1 } });
    keeper.train['SOP-0004'] = rec;
    dispatch(db, s);
    expect([t.state, t.people, t.lack]).toEqual(['busy', [keeper.id], undefined]);
    expect(check(db, s)).toEqual([]);
  });

  test('задаче нужны двое, допущен один — «нет допуска»; допущены оба — оба на задаче', () => {
    const s = morning();
    const [a, b] = by(s, 'role.analyst');
    const rec = b.train['SOP-0001'];
    delete b.train['SOP-0001'];
    // шаг расследования: аналитикам нужны только основы GMP
    expect(needFor(db, 'invStep')).toEqual(['SOP-0001']);
    const t = addTask(s, { kind: 'invStep', roles: ['role.analyst'], from: post('role.analyst'), work: 60, prio: 99, count: 2 });
    dispatch(db, s);
    expect([t.state, t.why, t.lack]).toEqual(['open', 'qual', 'SOP-0001']);
    b.train['SOP-0001'] = rec;
    dispatch(db, s);
    expect([t.state, [...t.people].sort()]).toEqual(['busy', [a.id, b.id].sort()]);
    dropTask(db, s, t);
  });

  test('ричтрак водит только допущенный к нему: кладовщику без записи его не дают, водитель без записи — «нет допуска» к технике', () => {
    const s = morning();
    const [driver] = by(s, 'role.driver');
    const [keeper] = by(s, 'role.storekeeper');
    // кладовщик со смежной профессией водителя (Б4г) знает и ричтрак — здесь его записи нет
    expect(keeper.also).toEqual(['role.driver']);
    delete keeper.train['SOP-0005'];
    expect([driver.task, keeper.task]).toEqual([undefined, undefined]);
    const rec = driver.train['SOP-0005'];
    delete driver.train['SOP-0005'];
    const t = addTask(s, { kind: 'move', roles: ['role.driver', 'role.storekeeper'], veh: ['veh.reach'], from: post('role.driver'), work: 60, prio: 99 });
    dispatch(db, s);
    expect([t.state, t.why, t.lack]).toEqual(['open', 'qual', 'SOP-0005']);
    driver.train['SOP-0005'] = rec;
    dispatch(db, s);
    expect([t.state, t.people, s.vehicles[t.vehicle!].type]).toEqual(['busy', [driver.id], 'veh.reach']);
    expect(check(db, s)).toEqual([]);
  });
});

describe('обучение и проверка знаний', () => {
  test('на старте: табельные номера по порядку, записи по строкам матрицы роли и смежных профессий — не старше срока сценария, все допущены', () => {
    const s = newPlant(db, { scenario: SC });
    const days = new Set<number>();
    for (const p of Object.values(s.people)) {
      expect(p.tab).toBe(sc.training.tab + Number(p.id.slice(1)) - 1);
      expect(Object.keys(p.train).sort()).toEqual([...rowsOf(db, p)].sort());
      for (const [code, rec] of Object.entries(p.train)) {
        const x = db.sops[rec.rev] ?? db.tests[rec.rev];
        expect(x.doc.code).toBe(code);
        expect(rec.day).toBeLessThanOrEqual(start);
        expect(rec.day).toBeGreaterThanOrEqual(Math.max(start - sc.training.spread, x.doc.from));
        expect(rec.until).toBe(addMonths(rec.day, x.every) - 1);
        expect(knows(db, p, code, start)).toBe(true);
        days.add(rec.day);
      }
    }
    // у каждой записи свой день — по хешу человека и кода
    expect(days.size).toBeGreaterThan(50);
    // та же партия — те же записи
    expect(newPlant(db, { scenario: SC, seed: 9 }).people.E9.train).toEqual(s.people.E9.train);
  });

  test('срок записи кончается: задача обучения у своего поста, проверка знаний — у ООК, не у себя; запись — с днём проверки', () => {
    const s = newPlant(db, { scenario: SC });
    const [keeper] = by(s, 'role.storekeeper');
    // запись кончится через срок предупреждения от завтра: задача — в полночь
    keeper.train['SOP-0004'] = { ...keeper.train['SOP-0004'], until: start + 1 + sc.training.ahead };
    const seen = new Map<string, Task>();
    const notices: Notice[] = [];
    while (keeper.train['SOP-0004'].day < start && s.t < 5 * DAY) {
      notices.push(...apply(db, s, { kind: 'advance', seconds: 5 * MIN }));
      for (const t of Object.values(s.tasks)) if (t.trainee === keeper.id) seen.set(t.kind, structuredClone(t));
    }
    const train = seen.get('train')!;
    const exam = seen.get('trainCheck')!;
    expect(train.created).toBe(DAY);
    expect([train.roles, train.prio, train.work, train.doc, train.people]).toEqual([['role.storekeeper'], TRAIN_PRIO.train, db.sops['sop.storage'].study, 'sop.storage', [keeper.id]]);
    expect(train.from).toEqual(post('role.storekeeper'));
    expect([exam.roles, exam.not, exam.prio, exam.work, exam.doc]).toEqual([[...CHECKERS], [keeper.id], TRAIN_PRIO.trainCheck, sc.training.check, 'sop.storage']);
    expect(CHECKERS.map(String)).toContain(s.people[exam.people[0]].role);
    const day = dayOf(s);
    expect(keeper.train['SOP-0004']).toEqual({ rev: 'sop.storage', day, until: addMonths(day, 12) - 1 });
    // допуск не терял
    expect(notices.filter(n => n.kind === 'qualLost')).toEqual([]);
    expect(check(db, s)).toEqual([]);
  });

  test('новой редакции учат до её дня; кто учился, с её дня работает по ней', () => {
    const s = newPlant(db, { scenario: SC });
    const ops = by(s, 'role.operator');
    const waits: string[] = [];
    while (dayOf(s) <= r2from) {
      apply(db, s, { kind: 'advance', seconds: HOUR });
      for (const t of Object.values(s.tasks)) if (t.why === 'qual') waits.push(`${t.kind}:${t.lack}`);
    }
    for (const p of ops) {
      const rec = p.train[CLEAN];
      expect([p.id, rec.rev]).toEqual([p.id, R2]);
      // задача обучения — не раньше срока предупреждения до дня редакции
      expect(rec.day).toBeGreaterThanOrEqual(r2from - sc.training.ahead);
      expect(rec.day).toBeLessThan(r2from);
      expect(knows(db, p, CLEAN, r2from)).toBe(true);
    }
    expect(waits).toEqual([]);
  });

  test('не выучил новую редакцию — с её дня не допущен: извещение, уборка ждёт «нет допуска», пока аппаратчик не выучится', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: at(r2from - 1, 23) - s.t });
    // никто из аппаратчиков не учился: записи — на прежнюю редакцию, задач обучения нет
    const ops = by(s, 'role.operator');
    for (const p of ops) p.train[CLEAN] = { rev: R1, day: start - 30, until: start + 300 };
    for (const t of Object.values(s.tasks)) if (t.doc === R2) dropTask(db, s, t);
    const lost = apply(db, s, { kind: 'advance', seconds: HOUR }).filter(n => n.kind === 'qualLost');
    expect(lost.map(n => n.kind === 'qualLost' && `${n.person}:${n.doc}:${n.tab}`).sort()).toEqual(ops.map(p => `${p.id}:${CLEAN}:${p.tab}`).sort());
    // в полночь — задачи обучения новой редакции
    expect(Object.values(s.tasks).filter(t => t.kind === 'train' && t.doc === R2).map(t => t.trainee).sort()).toEqual(ops.map(p => p.id).sort());
    // уборка в начале первой смены: аппаратчики в смене, но не допущены
    apply(db, s, { kind: 'advance', seconds: at(r2from, 6) + 59 * MIN - s.t });
    const room = Object.values(s.rooms).find(r => r.status === 'clean' && !r.batch && !Object.values(s.tasks).some(x => x.room === r.id))!;
    Object.assign(room, { status: 'dirty', since: s.t });
    const t = addTask(s, { kind: 'clean', roles: [...MES.operators], from: { kind: 'point', ...plan.room[room.id] }, work: 10 * MIN, prio: MES_PRIO.clean, room: room.id });
    apply(db, s, { kind: 'advance', seconds: 2 * MIN });
    expect([t.state, t.why, t.lack]).toEqual(['open', 'qual', CLEAN]);
    const card = cardView(db, s, { kind: 'person', n: Number(ops[0].id.slice(1)) }).card;
    expect(card?.kind === 'person' && card.adm).toEqual({ k: 'no', doc: { code: CLEAN, kind: 'sops', id: R2, rev: 2 } });
    // выучились — уборки дают тем, кто выучил новую редакцию в этот день, и только им
    const took = new Set<string>();
    while (s.t < at(r2from, 15)) {
      apply(db, s, { kind: 'advance', seconds: 5 * MIN });
      for (const x of Object.values(s.tasks)) if (x.kind === 'clean' && x.state === 'busy') for (const id of x.people) took.add(id);
    }
    expect(took.size).toBeGreaterThan(0);
    for (const id of took) expect([id, s.people[id].train[CLEAN].rev, s.people[id].train[CLEAN].day]).toEqual([id, R2, r2from]);
    expect(check(db, s)).toEqual([]);
  });

  test('срок записи кончился без обучения — извещение «потерял допуск» с табельным номером и документом', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: at(start + 1, 23) - s.t });
    const [keeper] = by(s, 'role.storekeeper');
    keeper.train['SOP-0004'] = { ...keeper.train['SOP-0004'], until: start + 1 };
    const lost = apply(db, s, { kind: 'advance', seconds: HOUR }).filter(n => n.kind === 'qualLost');
    expect(lost).toEqual([{ kind: 'qualLost', person: keeper.id, role: 'role.storekeeper', tab: keeper.tab, doc: 'SOP-0004' }]);
    expect(Object.values(s.tasks).some(t => t.kind === 'train' && t.trainee === keeper.id && t.doc === 'sop.storage')).toBe(true);
  });
});

describe('старое сохранение', () => {
  test('образец схемы 17: у людей — табельные номера и записи от дня сохранения, все допущены; завод живёт дальше', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v17.json', import.meta.url)).text();
    const raw = JSON.parse(json) as { people: Record<string, object> };
    expect(Object.values(raw.people).some(p => 'tab' in p || 'train' in p)).toBe(false);
    const s = fromSave(db, json);
    const day = dayOf(s);
    for (const p of Object.values(s.people)) {
      expect(p.tab).toBe(sc.training.tab + Number(p.id.slice(1)) - 1);
      expect(Object.keys(p.train).sort()).toEqual([...rowsOf(db, p)].sort());
      for (const [code, rec] of Object.entries(p.train)) {
        expect(rec.day).toBeLessThanOrEqual(day);
        expect(rec.day).toBeGreaterThanOrEqual(day - sc.training.spread);
        expect(knows(db, p, code, day)).toBe(true);
      }
    }
    apply(db, s, { kind: 'advance', seconds: 2 * DAY });
    expect(check(db, s)).toEqual([]);
  });
});

describe('прогон расписания и виды окна', () => {
  test('прогон расписания считает только допущенных сейчас: без допуска к уборке уборок в плане нет', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: 3 * DAY });
    const cleans = (x: PlantState) => forecast(db, x).bars.filter(b => b.kind === 'clean' && b.when === 'plan').length;
    expect(cleans(s)).toBeGreaterThan(0);
    const copy = structuredClone(s);
    for (const p of Object.values(copy.people)) delete p.train[CLEAN];
    expect(cleans(copy)).toBe(0);
  });

  test('справочник: люди с табельными номерами и допуском; матрица — в клетке допущено из скольких и по смежной профессии', () => {
    const s = newPlant(db, { scenario: SC });
    const v = refView(db, s);
    expect(v.people.map(p => p.tab)).toEqual(Object.values(s.people).map(p => p.tab));
    expect(new Set(v.people.map(p => p.adm.k))).toEqual(new Set(['ok']));
    expect(v.matrix.docs.map(d => d.code)).toEqual(learnCodes(db));
    expect(v.matrix.roles).toEqual(Object.keys(db.roles).filter(r => sc.staff.some(row => row.role === r)));
    v.matrix.docs.forEach((d, i) =>
      v.matrix.roles.forEach((r, j) => {
        const cell = v.matrix.cells[i][j];
        if (!matrixOf(db, r).includes(d.code)) expect(cell).toBeNull();
        else expect(cell).toEqual({ ok: by(s, r).length, all: by(s, r).length, also: Object.values(s.people).filter(p => p.also?.includes(r)).length });
      }),
    );
    // до дня новой редакции в клетке — действующая сегодня
    expect(v.matrix.docs.find(d => d.code === CLEAN)).toEqual({ code: CLEAN, kind: 'sops', id: R1, rev: 1 });
  });

  test('карточка человека и планёрка: «потеряет допуск» за срок предупреждения, «не допущен»; что изучает сейчас', () => {
    const s = newPlant(db, { scenario: SC });
    const [keeper] = by(s, 'role.storekeeper');
    const [driver] = by(s, 'role.driver');
    keeper.train['SOP-0004'] = { ...keeper.train['SOP-0004'], until: start + 10 };
    delete driver.train['SOP-0005'];
    const card = (n: string) => cardView(db, s, { kind: 'person', n: Number(n.slice(1)) }).card;
    const k = card(keeper.id);
    expect(k?.kind === 'person' && [k.tab, k.skill, k.adm]).toEqual([keeper.tab, keeper.skill, { k: 'soon', last: start + 10, doc: { code: 'SOP-0004', kind: 'sops', id: 'sop.storage', rev: 1 } }]);
    const rows = k?.kind === 'person' ? k.train : [];
    // строки — своей роли и смежной профессии водителя (Б4г)
    expect(rows.map(r => r.doc.code)).toEqual([...rowsOf(db, keeper)]);
    expect(rows.map(r => r.doc.code)).toContain('SOP-0005');
    expect(rows.find(r => r.doc.code === 'SOP-0004')).toEqual({ doc: { code: 'SOP-0004', kind: 'sops', id: 'sop.storage', rev: 1 }, rec: { rev: 1, day: keeper.train['SOP-0004'].day, until: start + 10 }, ok: true });
    const d = card(driver.id);
    expect(d?.kind === 'person' && d.train.find(r => r.doc.code === 'SOP-0005')).toEqual({ doc: { code: 'SOP-0005', kind: 'sops', id: 'sop.reach', rev: 1 }, ok: false });
    const m = morningView(db, s, { view: 'morning', day: start });
    expect(m.training.soon).toEqual([{ person: Number(keeper.id.slice(1)), tab: keeper.tab, role: 'role.storekeeper', last: start + 10, doc: { code: 'SOP-0004', kind: 'sops', id: 'sop.storage', rev: 1 } }]);
    expect(m.training.no).toEqual([{ person: Number(driver.id.slice(1)), tab: driver.tab, role: 'role.driver', doc: { code: 'SOP-0005', kind: 'sops', id: 'sop.reach', rev: 1 } }]);
    // задачи обучения ставят в полночь — здесь сразу; водитель свободен — в карточке то, что он изучает
    trainDay(db, s, []);
    while (s.tasks[driver.task ?? '']?.kind !== 'train' && s.t < 2 * DAY) apply(db, s, { kind: 'advance', seconds: 5 * MIN });
    const w = card(driver.id);
    expect(w?.kind === 'person' && w.learning).toEqual({ code: 'SOP-0005', kind: 'sops', id: 'sop.reach', rev: 1 });
  });
});
