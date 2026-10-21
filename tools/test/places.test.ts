// Места и оборудование (Б3в; docs/specs/2026-10-vertical-slice.md, «Проверки Б3в»): площадка, участки и рабочие места с
// кодами; вещи плана — на местах своего рабочего места; у зон хранения — режим и датчик с поверкой. Сборщик базы ловит код
// не по формату и повторённый, помещение в двух участках, вещь вне рабочего места или в рабочем месте другого вида, класс
// средства измерений без калибровки и квалификацию без срока, МОК без прибора в помещении стадии, материал без зоны с его
// режимом и срок предупреждения не короче интервала. Движок: на старте — инвентарные номера по порядку мест и всё в
// сроке; коллега назначает визит за срок предупреждения; на время визита актив новых работ не берёт, занятый — подрядчик
// ждёт конца работы, не успевает — приходит в следующий рабочий день; счёт — в день визита; запись — с днём приёмки;
// просроченный актив не берёт работу, а задача и серия называют его; датчик не годен — зона не принимает паллет. Прогоны
// расписания и плана знают визиты; фон расследования — описка в журнале прибора; образец схемы 18 читается. Виды окна —
// учёт завода: места, записи, визиты, что держит работу.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import { ACCEPT, ACCEPT_PRIO, recOf, STORE_KINDS, unfit, WORKS } from '../../src/engine/assets';
import { batchNo } from '../../src/engine/batchno';
import { part } from '../../src/engine/cash';
import { addMonths, addWorkdays, DAY, daysFromCivil, HOUR, isWorkday, MIN, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { FAULT_NO, labProven } from '../../src/engine/investigation';
import { phaseOf } from '../../src/engine/lean';
import { classOf, placesOf } from '../../src/engine/places';
import { runSeed } from '../../src/engine/plan/run';
import { forecast } from '../../src/engine/plan/schedule';
import { planOf } from '../../src/engine/plant';
import { fromSave } from '../../src/engine/save';
import { INSTRUMENT_FAULTS, type PlantState, type Task } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { invView } from '../../src/sim/inv';
import { labView } from '../../src/sim/lab';
import { nowView } from '../../src/sim/now';
import { assetWaits } from '../../src/sim/places';
import { refView } from '../../src/sim/ref';
import { morningView } from '../../src/sim/report';
import { cardView } from '../../src/sim/views';
import { buildDb } from '../content/load';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const start = daysFromCivil(sc.start.date);
const plan = planOf(db, sc.plant);
const P = placesOf(plan.plant);
const ahead = sc.assets.ahead;
// начало партии — в среду: четверг и пятница рабочие, суббота — нет
const thu = start + 1;
const fri = start + 2;
const cal = calOf(db, { start: sc.start.date, scenario: SC });
const mon = addWorkdays(cal, fri, 1);

/** Игровые секунды от начала партии до часа `hour` суток `day` (номер дня от 1970-01-01). */
const at = (day: number, hour: number) => (day - start) * DAY + hour * HOUR;
const dayOf = (s: PlantState) => momentOf(s.start, s.t).day;
/** Ходить по `step`, пока `done()` не станет правдой или не наступит `until`; `each` — после каждого шага. */
function live(s: PlantState, done: () => boolean, until: number, step = MIN, each?: () => void) {
  while (!done() && s.t < until) {
    apply(db, s, { kind: 'advance', seconds: step });
    each?.();
  }
}

describe('места в базе', () => {
  test('площадка → участки → рабочие места → места: коды по формату; вещь — на рабочем месте своего вида в участке своего помещения', () => {
    const p = plan.plant;
    expect(p.site.code).toBe('S01');
    expect(p.areas.map(a => a.code)).toEqual(['WH', 'TB', 'PK', 'QC', 'MT']);
    const centers = Object.values(P.center);
    expect(centers.map(c => [c.code, c.kind, c.regime ?? null])).toEqual([
      ['WH-01', 'storage', 'reg.ccrt'],
      ['WH-02', 'storage', 'reg.fridge'],
      ['WH-03', 'storage', 'reg.ccrt'],
      ['TB-01', 'cell', null],
      ['TB-02', 'storage', 'reg.ccrt'],
      ['PK-01', 'line', null],
      ['QC-01', 'lab', null],
    ]);
    for (const t of P.things) {
      expect(t.place).toMatch(/^[A-Z]{2}-\d{2}\.\d{2}$/);
      const c = P.center[t.place.slice(0, 5)];
      expect([t.id, c.area]).toEqual([t.id, P.areaOf[t.room]]);
    }
    expect(new Set(P.things.map(t => t.place)).size).toBe(P.things.length);
    // у каждой зоны хранения — один датчик в её помещении, его калибровка — поверка
    for (const c of centers.filter(x => x.kind === 'storage')) {
      const th = P.thing[P.sensorOf[c.code]];
      expect([c.code, c.rooms?.includes(th.room), db.instruments[th.type].cal.verify]).toEqual([c.code, true, true]);
    }
    // у стадии с МОК на приборе — прибор этого вида в её помещении
    for (const r of Object.values(db.recipes))
      for (const st of r.stages)
        for (const q of st.ipc) {
          const inst = db.tests[q.test].inst;
          if (inst) expect([st.id, q.test, p.ipc.some(m => m.type === inst && m.room === plan.roomOf[st.room])]).toEqual([st.id, q.test, true]);
        }
  });

  test('у средства измерений — калибровка, у квалифицируемого — срок и часы подрядчика в его рабочем дне; режимы материалов — у зон', () => {
    const [h0, h1] = sc.assets.hours;
    for (const x of Object.values(db.instruments)) expect([x.id, x.cal.every > 0, x.review]).toEqual([x.id, true, 'draft']);
    for (const cls of [...Object.values(db.equipment), ...Object.values(db.machines), ...Object.values(db.instruments)])
      for (const w of WORKS) {
        const job = cls[w];
        if (!job) continue;
        expect(job.every).toBeGreaterThan(0);
        expect(job.work).toBeLessThanOrEqual(h1 - h0);
        expect(job.price).toBeGreaterThan(0);
      }
    // десятые доли градуса и доля влажности: «при контролируемой комнатной температуре» — от 15 до 25 °C
    expect(db.regimes['reg.ccrt']).toMatchObject({ temp: [150, 250] });
    expect(db.regimes['reg.fridge']).toMatchObject({ temp: [20, 80] });
    for (const m of Object.values(db.materials)) expect([m.id, !!db.regimes[m.storage]]).toEqual([m.id, true]);
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
  const PLANT = 'plants/proto.yaml';

  test('код участка, рабочего места или места не по формату; код повторён; помещение в двух участках', () => {
    has(broken({ [PLANT]: [['  - code: MT\n', '  - code: M1\n']] }), 'код участка — две заглавные латинские буквы');
    has(broken({ [PLANT]: [['code: WH-03, kind: storage', 'code: WH-3, kind: storage']] }), 'код рабочего места — участок, дефис и две цифры');
    has(broken({ [PLANT]: [['place: TB-01.07 }', 'place: TB-01.7 }']] }), 'код места — рабочее место, точка и две цифры');
    has(broken({ [PLANT]: [['place: TB-01.02 }', 'place: TB-01.01 }']] }), 'план plant.proto: код TB-01.01 повторяется (hsm-1)');
    has(broken({ [PLANT]: [['rooms: [packaging]', 'rooms: [packaging, lab]']] }), 'план plant.proto: помещение lab — в участках PK и QC');
  });

  test('вещь вне рабочего места или на рабочем месте другого вида; у зоны хранения — не один датчик или датчик без поверки', () => {
    has(broken({ [PLANT]: [['place: TB-01.07 }', 'place: TB-03.07 }']] }), 'план plant.proto: press-1 — нет рабочего места TB-03');
    has(broken({ [PLANT]: [['place: PK-01.01 }', 'place: TB-01.13 }']] }), 'план plant.proto: blister-1 — на рабочем месте TB-01 вида cell, а нужно line');
    has(broken({ [PLANT]: [['room: coldroom, place: WH-02.01 }', 'room: coldroom, place: WH-01.02 }']] }), 'план plant.proto: у зоны хранения WH-01 — не один датчик');
    has(broken({ 'instruments/thermohygrometer.yaml': [[', verify: true }', ' }']] }), 'план plant.proto: датчик th-1 — у вида inst.thermohygrometer нет поверки');
  });

  test('средство измерений без калибровки; квалификация без срока; работа длиннее рабочего дня подрядчика', () => {
    has(broken({ 'instruments/balance.yaml': [['cal: { every: 12, hours: 1, price: 4000, name: { ru: Калибровка весов, en: Balance calibration } }\n', '']] }), 'instruments/balance.yaml: cal:');
    has(broken({ 'equipment/press.yaml': [['qual: { every: 36, hours: 8,', 'qual: { hours: 8,']] }), 'equipment/press.yaml: qual.every:');
    has(broken({ 'equipment/press.yaml': [['qual: { every: 36, hours: 8,', 'qual: { every: 36, hours: 9,']] }), 'сценарий scn.proto: press-1 — работа «Квалификация пресса» длиннее рабочего дня подрядчика');
  });

  test('МОК стадии без прибора его вида в помещении стадии; материал без зоны с подходящим режимом; режима нет', () => {
    has(
      broken({ [PLANT]: [['{ id: hard-1, type: inst.hardness, room: compression,', '{ id: hard-1, type: inst.hardness, room: blending,']] }),
      'сценарий scn.proto: в помещении «compression» нет прибора inst.hardness для МОК test.ipc.hardness',
    );
    has(broken({ 'materials/api/paracetamol.yaml': [['storage: reg.ccrt', 'storage: reg.cool']] }), 'сценарий scn.proto: материалу mat.api.paracetamol (reg.cool) нет зоны хранения с подходящим режимом');
    // отклонённое холоднее, чем нужно материалам: отклонённой партии некуда лечь
    has(broken({ [PLANT]: [['rooms: [rejroom], regime: reg.ccrt', 'rooms: [rejroom], regime: reg.cool']] }), 'нет зоны хранения с подходящим режимом');
    has(broken({ 'materials/api/paracetamol.yaml': [['storage: reg.ccrt', 'storage: reg.nope']] }), 'материал mat.api.paracetamol: нет режима хранения reg.nope');
  });

  test('записи на старте моложе самого короткого интервала: срок предупреждения — короче него', () => {
    has(
      broken({ 'scenarios/proto.yaml': [['assets: { ahead: 14,', 'assets: { ahead: 30,']], 'instruments/balance.yaml': [['cal: { every: 12,', 'cal: { every: 1,']] }),
      'сценарий scn.proto: assets.ahead — срок предупреждения не короче самого короткого интервала, 1 мес.',
    );
    expect(broken({ 'instruments/balance.yaml': [['cal: { every: 12,', 'cal: { every: 1,']] })).toEqual([]);
  });
});

describe('активы на начало партии', () => {
  const s = newPlant(db, { scenario: SC });
  const list = Object.values(s.assets);

  test('инвентарные номера — с номера сценария по порядку мест: участки по плану, в участке — по коду места; техника — последней', () => {
    expect(list.map(a => a.id)).toEqual([...P.things.map(t => t.id), ...Object.keys(s.vehicles)]);
    expect(list.map(a => a.inv)).toEqual(list.map((_, i) => sc.assets.inv + i));
    for (const t of P.things) expect(s.assets[t.id]).toMatchObject({ family: t.family, type: t.type, place: t.place });
    // техника — участка, где её стоянка
    for (const v of Object.values(s.vehicles)) expect(s.assets[v.id]).toMatchObject({ family: 'vehicle', type: v.type, place: 'WH' });
    expect(list[0]).toMatchObject({ id: 'th-1', inv: 101, place: 'WH-01.01' });
  });

  test('записи — в прошлом, у каждой свой день по хешу актива; всё в сроке не меньше срока предупреждения; зерно их не меняет', () => {
    for (const a of list) {
      const cls = classOf(db, a);
      expect([a.id, a.recs.map(r => r.work)]).toEqual([a.id, WORKS.filter(w => cls[w])]);
      for (const r of a.recs) {
        expect(r.day).toBeLessThanOrEqual(start);
        expect(r.until).toBe(addMonths(r.day, cls[r.work]!.every) - 1);
        expect(r.until - start).toBeGreaterThanOrEqual(ahead);
        expect(r.by).toBeUndefined();
      }
      expect([a.id, unfit(db, s, a.id), a.visit]).toEqual([a.id, undefined, undefined]);
    }
    expect(new Set(list.flatMap(a => a.recs.map(r => r.day))).size).toBeGreaterThan(15);
    // технике и укладчику в короба квалификация и калибровка не нужны
    expect([s.assets.V1.recs, s.assets['casepack-1'].recs]).toEqual([[], []]);
    expect(newPlant(db, { scenario: SC, seed: 9 }).assets).toEqual(s.assets);
    expect(check(db, s)).toEqual([]);
  });
});

describe('визит подрядчика', () => {
  test('коллега техслужбы в 09:00 рабочего дня: запись кончится в срок предупреждения — визит на следующий рабочий день к началу часов', () => {
    expect([isWorkday(cal, thu), isWorkday(cal, fri), isWorkday(cal, fri + 1), mon - fri]).toEqual([true, true, false, 3]);
    const s = newPlant(db, { scenario: SC });
    const press = s.assets['press-1'];
    const hplc = s.assets['hplc-1'];
    recOf(press, 'qual')!.until = start + ahead + 1;
    // из двух работ — та, что кончится раньше
    recOf(hplc, 'qual')!.until = start + ahead;
    recOf(hplc, 'cal')!.until = start + ahead - 3;
    apply(db, s, { kind: 'advance', seconds: at(start, 9) + MIN - s.t });
    expect(press.visit).toBeUndefined();
    expect(hplc.visit).toEqual({ work: 'cal', at: at(thu, 9), booked: at(start, 9), v: 0 });
    apply(db, s, { kind: 'advance', seconds: at(thu, 9) - MIN - s.t });
    expect(press.visit).toBeUndefined();
    apply(db, s, { kind: 'advance', seconds: 2 * MIN });
    expect(press.visit).toEqual({ work: 'qual', at: at(fri, 9), booked: at(thu, 9), v: 0 });
    // в пятницу — на понедельник
    const th = s.assets['th-1'];
    recOf(th, 'cal')!.until = fri + ahead;
    apply(db, s, { kind: 'advance', seconds: at(fri, 9) + MIN - s.t });
    expect(th.visit).toEqual({ work: 'cal', at: at(mon, 9), booked: at(fri, 9), v: 0 });
  });

  test('занятый актив: подрядчик ждёт конца стадии; на время визита актив работы не берёт; счёт — в день визита; запись — с днём приёмки', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: at(thu, 9) - s.t });
    const scale = s.equipment['scale-1'];
    const a = s.assets['scale-1'];
    // отвес первой серии идёт
    expect(scale.batch).toBe('B1');
    a.visit = { work: 'cal', at: s.t, booked: s.t, v: 0 };
    expect(unfit(db, s, 'scale-1')).toBe('visit');
    live(s, () => a.visit?.from !== undefined, at(thu, 17));
    const end = s.batches.B1.records.find(r => r.stage === 'dispense')!.end;
    const w = db.equipment['eq.scale'].cal!;
    expect(a.visit).toMatchObject({ from: end, to: end + w.work, v: 1 });
    // «Сейчас»: работа подрядчика — у техслужбы, с начала его работы, норма — часы класса, людей завода в ней нет
    expect(nowView(db, s).rows.find(r => r.kind === 'visit')).toMatchObject({ dept: 'maint', asset: 'scale-1', inv: a.inv, work: 'cal', from: end, norm: w.work, people: [] });
    // подрядчик работает — весы стадий не берут; работа кончилась — счёт с НДС в тот же день, НДС — к вычету
    const to = a.visit!.to!;
    live(s, () => s.t + MIN >= to, to, MIN, () => expect(scale.batch).toBeUndefined());
    apply(db, s, { kind: 'advance', seconds: to - 1 - s.t });
    const vatIn = s.cash.vat.in;
    const n = s.cash.ledger.length;
    apply(db, s, { kind: 'advance', seconds: 1 });
    const vat = part(w.price, db.profiles[sc.profile].vat.general);
    expect(s.cash.ledger.slice(n).filter(e => e.item === 'calqual')).toEqual([{ t: end + w.work, sum: -(w.price + vat), item: 'calqual', ref: 'scale-1' }]);
    expect(s.cash.vat.in - vatIn).toBe(vat);
    expect(dayOf(s)).toBe(thu);
    // работу принимает начальник ОКК: задача приёмки; запись — с днём приёмки
    const task = s.tasks[a.visit!.task!];
    expect([task.kind, task.roles, task.prio, task.work, task.asset]).toEqual(['accept', [ACCEPT.cal], ACCEPT_PRIO, sc.assets.accept, 'scale-1']);
    // ждёт приёмки — старая запись в сроке: весы снова работают
    expect(unfit(db, s, 'scale-1')).toBeUndefined();
    // приёмку калибровки видно в «Сейчас» у лаборатории
    live(s, () => !a.visit || s.tasks[a.visit.task!]?.state === 'busy', at(fri, 17));
    expect(nowView(db, s).rows.find(r => r.kind === 'accept')).toMatchObject({ dept: 'qc', asset: 'scale-1', work: 'cal', norm: sc.assets.accept });
    live(s, () => !a.visit, at(fri, 17));
    const by = recOf(a, 'cal')!.by!;
    expect(recOf(a, 'cal')).toEqual({ work: 'cal', day: dayOf(s), until: addMonths(dayOf(s), w.every) - 1, by });
    expect(s.people[by].role).toBe(ACCEPT.cal);
    expect(check(db, s)).toEqual([]);
  });

  test('не успевает до конца своих часов — приходит в следующий рабочий день к их началу; выходные — не рабочие', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'advance', seconds: at(fri, 16) + 30 * MIN - s.t });
    const a = s.assets['th-1'];
    a.visit = { work: 'cal', at: s.t, booked: s.t, v: 0 };
    apply(db, s, { kind: 'advance', seconds: at(mon, 9) - MIN - s.t });
    expect(a.visit.from).toBeUndefined();
    apply(db, s, { kind: 'advance', seconds: 2 * MIN });
    expect(a.visit).toMatchObject({ from: at(mon, 9), to: at(mon, 9) + db.instruments['inst.thermohygrometer'].cal.work });
  });
});

describe('просрочено — не работает', () => {
  test('прибор без калибровки: в полночь — извещение; подготовка испытания ждёт актив и называет прибор; после приёмки — идёт', () => {
    const s = newPlant(db, { scenario: SC });
    // запись кончится в четверг, после обхода коллеги: визит он назначит только в пятницу — на понедельник
    apply(db, s, { kind: 'advance', seconds: at(thu, 10) - s.t });
    const a = s.assets['hplc-1'];
    recOf(a, 'cal')!.until = thu;
    const notices = apply(db, s, { kind: 'advance', seconds: at(fri, 0) + MIN - s.t }).filter(n => n.kind === 'assetExpired');
    expect(notices).toEqual([{ kind: 'assetExpired', asset: 'hplc-1', family: 'lab', type: 'inst.hplc', inv: a.inv, work: 'cal' }]);
    expect(unfit(db, s, 'hplc-1')).toBe('cal');
    apply(db, s, { kind: 'advance', seconds: at(fri, 10) - s.t });
    expect(a.visit).toMatchObject({ work: 'cal', at: at(mon, 9), booked: at(fri, 9) });
    const t = Object.values(s.tasks).find(x => x.kind === 'prep' && x.inst?.includes('inst.hplc'))!;
    expect([t.state, t.why, t.unfit]).toEqual(['open', 'asset', 'hplc-1']);
    // очередь лаборатории: прибор, его номер и почему
    const row = labView(db, s).rows.flatMap(r => r.tests).find(x => x.now?.wait === 'asset');
    expect(row?.now?.unfit).toEqual({ family: 'lab', type: 'inst.hplc', inv: a.inv, work: 'cal', verify: false });
    // до приёмки ВЭЖХ испытаний не берёт
    live(s, () => recOf(a, 'cal')!.day === mon, at(mon, 18), 5 * MIN, () => {
      if (recOf(a, 'cal')!.day !== mon) expect(s.instruments['hplc-1'].test).toBeUndefined();
    });
    expect(recOf(a, 'cal')).toMatchObject({ work: 'cal', day: mon });
    live(s, () => s.tasks[t.id]?.state !== 'open', at(mon, 18), 5 * MIN);
    expect(s.tasks[t.id]?.state ?? 'done').not.toBe('open');
    expect(check(db, s)).toEqual([]);
  });

  test('оборудование стадии без калибровки: стадия не начинается, серия ждёт актив — какой и почему; после приёмки — стадия идёт', () => {
    const s = newPlant(db, { scenario: SC });
    // вышла в полночь на четверг; визит коллега назначил в среду — на четверг
    recOf(s.assets['scale-1'], 'cal')!.until = start;
    apply(db, s, { kind: 'advance', seconds: at(thu, 9) - MIN - s.t });
    const b = s.batches.B1;
    expect([b.status, b.stage, phaseOf(db, s, b)]).toEqual(['process', 0, 'asset']);
    expect(assetWaits(db, s)).toEqual([{ batch: batchNo(b.code), asset: 'scale-1', why: 'cal', room: plan.roomOf.dispensing }]);
    expect(Object.values(s.tasks).some(t => t.kind === 'stage' && t.batch === b.id)).toBe(false);
    // в карточке весов — серия, которую они держат
    const card = cardView(db, s, { kind: 'equipment', i: plan.plant.equipment.findIndex(e => e.id === 'scale-1') }).card;
    expect(card.kind === 'equipment' && card.why.find(w => w.k === 'asset')).toMatchObject({ k: 'asset', batch: batchNo(b.code), asset: { id: 'scale-1', unfit: 'cal' } });
    // подрядчик — с 09:00 на часы калибровки; отвес — после приёмки
    let to = 0;
    live(s, () => b.records.length > 0, at(thu, 18), 5 * MIN, () => {
      to = s.assets['scale-1'].visit?.to ?? to;
    });
    expect(to).toBe(at(thu, 9) + db.equipment['eq.scale'].cal!.work);
    expect(recOf(s.assets['scale-1'], 'cal')).toMatchObject({ work: 'cal', day: thu });
    expect(b.records[0].start).toBeGreaterThan(to);
    expect(check(db, s)).toEqual([]);
  });

  test('поверка датчика вышла: зона хранения закрыта — паллеты на хранение в неё не кладут, перемещение ждёт датчик; после приёмки — кладут', () => {
    const s = newPlant(db, { scenario: SC });
    const th = s.assets['th-1'];
    recOf(th, 'cal')!.until = start - 1;
    const stored = (k: string) => plan.slot[k]?.store === 'WH-01' && STORE_KINDS.has(plan.slot[k].kind);
    const before = new Set(Object.keys(s.slots).filter(k => s.slots[k].unit || s.slots[k].held));
    let waiting: Task | undefined;
    live(
      s,
      () => th.recs.length > 1,
      at(fri, 0),
      5 * MIN,
      () => {
        for (const [k, u] of Object.entries(s.slots)) if ((u.unit || u.held) && !before.has(k)) expect([k, stored(k)]).toEqual([k, false]);
        for (const t of Object.values(s.tasks)) if (t.why === 'asset') expect([t.kind, t.unfit]).toEqual([t.kind, 'th-1']);
        waiting ??= Object.values(s.tasks).find(t => t.why === 'asset' && t.unit);
        if (waiting && s.tasks[waiting.id]?.why === 'asset') {
          // карточка паллеты: перемещение ждёт датчик — его номер и почему
          const c = cardView(db, s, { kind: 'unit', n: Number(waiting.unit!.slice(1)) }).card;
          expect(c.kind === 'unit' && c.why.find(w => w.k === 'task')).toMatchObject({ k: 'task', task: waiting.kind, wait: 'asset', unfit: { id: 'th-1', inv: th.inv, verify: true, unfit: 'cal' } });
        }
      },
    );
    expect(waiting?.kind).toBe('putaway');
    expect(recOf(th, 'cal')).toMatchObject({ day: thu, by: expect.any(String) });
    live(s, () => Object.entries(s.slots).some(([k, u]) => u.unit && !before.has(k) && stored(k)), at(fri, 0), 5 * MIN);
    expect(Object.entries(s.slots).some(([k, u]) => u.unit && !before.has(k) && stored(k))).toBe(true);
    expect(check(db, s)).toEqual([]);
  });
});

describe('прогоны знают визиты', () => {
  /** Четверг, 09:01: квалификация пресса кончится через срок предупреждения — коллега назначил визит на пятницу. */
  function booked(): PlantState {
    const s = newPlant(db, { scenario: SC });
    recOf(s.assets['press-1'], 'qual')!.until = thu + ahead;
    apply(db, s, { kind: 'advance', seconds: at(thu, 9) + MIN - s.t });
    expect(s.assets['press-1'].visit).toMatchObject({ work: 'qual', at: at(fri, 9) });
    return s;
  }
  const work = db.equipment['eq.press'].qual!.work;

  test('прогон расписания: полоса визита в строке помещения; стадия на прессе — не во время визита, причина — визит', () => {
    const s = booked();
    const f = forecast(db, s);
    const v = f.bars.filter(b => b.kind === 'visit');
    expect(v).toEqual([{ row: plan.roomOf.compression, kind: 'visit', from: at(fri, 9), to: at(fri, 9) + work, when: 'plan', asset: 'press-1', work: 'qual' }]);
    for (const b of f.bars) if (b.row === v[0].row && b.kind === 'stage') expect(b.to <= v[0].from || b.from >= v[0].to).toBe(true);
    expect(Object.values(f.why).flat()).toContainEqual({ why: 'visit', bar: 'compress', room: v[0].row, asset: 'press-1', work: 'qual', until: v[0].to });
  });

  test('прогон плана: двойник знает визит — в горизонте у пресса новая запись, стадии на нём — не во время визита; завод не меняется', () => {
    const s = booked();
    const before = structuredClone(s.assets);
    const c = runSeed(db, s, [], { days: 5, seeds: 1 }, 0);
    const rec = recOf(c.assets['press-1'], 'qual')!;
    expect(rec.day).toBeGreaterThanOrEqual(fri);
    expect(c.people[rec.by!].role).toBe(ACCEPT.qual);
    for (const b of Object.values(c.batches))
      for (const r of b.records) if (r.room === plan.roomOf.compression) expect(r.end <= at(fri, 9) || r.start >= at(fri, 9) + work).toBe(true);
    expect(s.assets).toEqual(before);
  });
});

describe('расследование и старое сохранение', () => {
  test('фон расследования — описка в журнале прибора: улика есть, а причиной не считается; на доске — срок калибровки прибора', () => {
    expect([INSTRUMENT_FAULTS.includes('typo'), FAULT_NO.typo]).toEqual([false, 4]);
    const s = newPlant(db, { scenario: SC });
    const def = sc.incident!;
    s.incident = { batch: `B${def.batch}`, inv: def.inv, root: 'lube', size: def.sizes.lube[1], fired: { lubeLong: 'lube', instrument: 'leak' } };
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    for (let i = 0; i < 80 && Object.keys(s.investigations).length === 0; i++) apply(db, s, { kind: 'advance', seconds: DAY / 4 });
    const inv = Object.values(s.investigations)[0];
    const first = s.tests[inv.test];
    expect(s.instruments[first.inst!].check).toBe('typo');
    const cal = recOf(s.assets[first.inst!], 'cal')!;
    expect(invView(db, s, { view: 'inv' }).board!.who.instCal).toBe(cal.until);
    // испытание шло на приборе в сроке
    expect(cal.day).toBeLessThanOrEqual(momentOf(s.start, first.done!).day);
    expect(cal.until).toBeGreaterThanOrEqual(momentOf(s.start, first.done!).day);
    apply(db, s, { kind: 'investigate', inv: inv.id, step: 'instrument', by: 'player' });
    live(s, () => inv.runs.find(r => r.step === 'instrument')?.to !== undefined, s.t + 3 * DAY, 10 * MIN);
    const o = inv.obs.find(x => x.f === 'instrument')!;
    expect(o.data).toEqual([FAULT_NO.typo]);
    expect(labProven(db, inv)).toBe(false);
  });

  test('образец схемы 18: активы по порядку мест от дня сохранения, всё в сроке; «просроченная калибровка» — описка; завод живёт дальше', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v18.json', import.meta.url)).text();
    const raw = JSON.parse(json) as { assets?: object; instruments: Record<string, { check?: string }> };
    expect(raw.assets).toBeUndefined();
    raw.instruments['diss-1'].check = 'overdue';
    const s = fromSave(db, JSON.stringify(raw));
    const day = dayOf(s);
    expect(Object.values(s.assets).map(a => [a.id, a.inv])).toEqual(Object.values(newPlant(db, { scenario: SC }).assets).map(a => [a.id, a.inv]));
    for (const a of Object.values(s.assets)) {
      for (const r of a.recs) {
        expect(r.day).toBeLessThanOrEqual(day);
        expect(r.until - day).toBeGreaterThanOrEqual(ahead);
      }
      expect([a.id, unfit(db, s, a.id)]).toEqual([a.id, undefined]);
    }
    expect(s.instruments['diss-1'].check).toBe('typo');
    expect(check(db, s)).toEqual([]);
    apply(db, s, { kind: 'advance', seconds: 2 * DAY });
    expect(check(db, s)).toEqual([]);
  });

  test('образец схемы 19 — посреди визита: подрядчик у весов кончает работу, счёт, приёмка — запись с днём приёмки', async () => {
    const s = fromSave(db, await Bun.file(new URL('./fixtures/save-v19.json', import.meta.url)).text());
    const a = s.assets['scale-1'];
    expect(a.visit).toMatchObject({ work: 'cal', from: expect.any(Number) });
    expect(a.visit!.to!).toBeGreaterThan(s.t);
    expect([unfit(db, s, 'scale-1'), s.equipment['scale-1'].batch]).toEqual(['visit', undefined]);
    const n = s.cash.ledger.length;
    live(s, () => !a.visit, s.t + DAY, 5 * MIN);
    expect(s.cash.ledger.slice(n).filter(e => e.item === 'calqual').map(e => e.ref)).toEqual(['scale-1']);
    expect(recOf(a, 'cal')).toMatchObject({ work: 'cal', day: dayOf(s), by: expect.any(String) });
    expect(check(db, s)).toEqual([]);
  });
});

describe('виды окна — учёт завода', () => {
  test('вкладка «Места»: площадка, участки, рабочие места с видом и режимом; активы — номер, место, записи; техника — у склада', () => {
    const s = newPlant(db, { scenario: SC });
    const v = refView(db, s).places;
    expect(v.site).toEqual(plan.plant.site);
    expect(v.ahead).toBe(ahead);
    expect(v.areas.map(a => [a.code, a.centers.map(c => c.code)])).toEqual(plan.plant.areas.map(a => [a.code, a.centers.map(c => c.code)]));
    const centers = v.areas.flatMap(a => a.centers);
    expect(centers.filter(c => c.kind === 'storage').map(c => [c.code, c.regime, c.rooms])).toEqual([
      ['WH-01', 'reg.ccrt', ['warehouse']],
      ['WH-02', 'reg.fridge', ['cold']],
      ['WH-03', 'reg.ccrt', ['rejected']],
      ['TB-02', 'reg.ccrt', ['bulk']],
    ]);
    const all = [...centers.flatMap(c => c.assets), ...v.areas.flatMap(a => a.vehicles)];
    expect(all.map(a => a.inv).sort((x, y) => x - y)).toEqual(Object.values(s.assets).map(a => a.inv));
    for (const a of all) {
      const x = s.assets[a.id];
      expect(a).toMatchObject({ inv: x.inv, place: x.place, needs: WORKS.filter(w => classOf(db, x)[w]), working: false, today: start });
      expect([a.qual, a.cal]).toEqual([recOf(x, 'qual'), recOf(x, 'cal')]);
      expect(a.unfit).toBeUndefined();
    }
    expect(v.areas.find(a => a.code === 'WH')!.vehicles.map(a => a.id)).toEqual(Object.keys(s.vehicles));
    // общие помещения площадки — коридоры, шлюз для людей, комната мастера, комната отдыха, гардероб
    expect(v.common).toContain('corridor.clean');
    expect(centers.some(c => c.closed)).toBe(false);
  });

  test('карточка: записи и визит, у подрядчика — работы не берёт; планёрка — визиты сегодня, что кончится в срок, что просрочено', () => {
    const s = newPlant(db, { scenario: SC });
    recOf(s.assets['press-1'], 'qual')!.until = thu + ahead;
    // калибровка влагомера кончится в четверг, после обхода коллеги в среду: визит — на пятницу, а в пятницу она уже вышла
    apply(db, s, { kind: 'advance', seconds: at(start, 10) - s.t });
    recOf(s.assets['lod-1'], 'cal')!.until = thu;
    apply(db, s, { kind: 'advance', seconds: at(fri, 9) + 30 * MIN - s.t });
    const card = cardView(db, s, { kind: 'equipment', i: plan.plant.equipment.findIndex(e => e.id === 'press-1') }).card;
    if (card.kind !== 'equipment') throw new Error(card.kind);
    expect(card.asset).toMatchObject({ id: 'press-1', inv: s.assets['press-1'].inv, place: 'TB-01.07', critical: true, visit: { work: 'qual', at: at(fri, 9), accepting: false } });
    expect(card.asset?.qual).toEqual(recOf(s.assets['press-1'], 'qual'));
    expect(card.history.filter(h => h.k === 'rec').length).toBe(s.assets['press-1'].recs.length);
    // подрядчик у пресса с 09:00 — пресс новых работ не берёт
    expect([card.asset?.working, card.asset?.unfit]).toEqual([true, 'visit']);
    // планёрка: визиты сегодня, что кончится в срок предупреждения, что просрочено
    const m = morningView(db, s, { view: 'morning', day: fri }).assets;
    expect(m.today.map(a => a.id).sort()).toEqual(['lod-1', 'press-1']);
    expect(m.expired.map(r => [r.asset.id, r.work])).toEqual([['lod-1', 'cal']]);
    expect(m.soon.map(r => [r.asset.id, r.work])).toContainEqual(['press-1', 'qual']);
    for (const r of m.soon) expect(r.until - fri).toBeLessThan(ahead);
    expect(m.ahead).toBe(ahead);
  });
});
