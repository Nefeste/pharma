// Руководители — люди (Б5в; docs/specs/2026-10-vertical-slice.md, «Б5в», «Проверки Б5в»): руководитель — человек штата;
// решает в свою смену, вне смены решение ждёт; в отпуске и при свободной должности решает заместитель со своим навыком,
// запись журнала — «и. о.»; заместителя нет — решения ждут, извещение «Некому решить»; навык ограничивает правило по
// таблице §8.5; уполномоченное лицо замещает только уполномоченное лицо; команда `deputy`; найм переездом; деньги
// руководителей — с общими расходами; образец схемы 35 читается; виды без истины; у прежнего сценария — должности.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { HEAD_IDS, type HeadId } from '../../src/content/types';
import { coverBy, decider, deputyOf, FULL, HEAD_ROLE, headOf, hireMinBy, noOneFor, PAID_LATER, replacesBy, thresholdBy, whoDecides } from '../../src/engine/bosses';
import { addWorkdays, DAY, daysFromCivil, HOUR, MIN, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { BATCH_HOUR } from '../../src/engine/mes';
import { fromSave } from '../../src/engine/save';
import type { Notice, Person, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { bossMeeting, bossOfPerson, bossRows, limitOf } from '../../src/sim/bosses';
import { legacy } from './legacy';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const fresh = (): PlantState => newPlant(db, { scenario: SC });
const refusals = (n: Notice[]) => n.flatMap(x => (x.kind === 'refused' ? [[x.why, x.detail]] : []));
const until = (s: PlantState, t: number) => apply(db, s, { kind: 'advance', seconds: t - s.t });
/** Мгновение дня `d` от начала партии в час `h`. */
const at = (d: number, h: number) => d * DAY + h * HOUR;
const today = (s: PlantState) => momentOf(s.start, s.t).day;
/** Отпуск человека с дня `from` на `days` суток — запись графика, как у утверждённой части. */
function away(p: Person, from: number, days: number) {
  (p.away ??= []).push({ id: `A${900 + (p.away?.length ?? 0)}`, y: momentOf(sc.start.date, 0).date.y, from, to: from + days - 1, days });
}
const head = (s: PlantState, h: HeadId) => headOf(s, h)!;

describe('руководители сценария — люди штата', () => {
  const s = fresh();

  test('у каждого руководителя — человек его роли с навыком 4 и заместитель по сценарию', () => {
    for (const h of HEAD_IDS) {
      const p = head(s, h);
      expect([h, p.role, p.skill]).toEqual([h, HEAD_ROLE[h], 4]);
      expect([h, deputyOf(db, s, h)?.role]).toEqual([h, sc.heads![h]!.deputy]);
    }
    // начальника ОКК и уполномоченных лиц сценарий держит как прежде; новых — шесть
    expect(Object.values(s.people).filter(p => PAID_LATER.has(p.role)).map(p => p.role).sort()).toEqual([...PAID_LATER].sort());
  });

  test('решает в свою смену: начальник планирования — первая смена производства, вне её и в выходной — никто', () => {
    const p = head(s, 'plan');
    // 1 сентября 2027 года — среда
    expect(whoDecides(db, s, 'plan', at(0, 7))).toEqual({ p: p.id });
    expect(whoDecides(db, s, 'plan', at(0, 14) + 59 * MIN)).toEqual({ p: p.id });
    expect(whoDecides(db, s, 'plan', at(0, 16))).toBeUndefined();
    expect(whoDecides(db, s, 'plan', at(3, 10))).toBeUndefined();
    // вне смены — не «некому»: решение ждёт смены
    expect(noOneFor(db, s, 'plan')).toBe(false);
    // должности без людей до своих частей — решают в любой час
    expect(whoDecides(db, s, 'tech', at(3, 23))).toEqual({});
  });

  test('уполномоченное лицо замещает только уполномоченное лицо', () => {
    const t = fresh();
    const [a, b] = Object.values(t.people).filter(p => p.role === 'role.qp');
    const z = today(t);
    expect(whoDecides(db, t, 'qp', at(0, 10))).toEqual({ p: a.id });
    away(a, z, 14);
    expect(whoDecides(db, t, 'qp', at(0, 10))).toEqual({ p: b.id });
    away(b, z, 14);
    expect(whoDecides(db, t, 'qp', at(0, 10))).toBeUndefined();
    expect(noOneFor(db, t, 'qp')).toBe(true);
  });
});

describe('отпуск и свободная должность', () => {
  test('руководитель в отпуске — заместитель «и. о.» в свою смену; и он в отпуске — «Некому решить» один раз', () => {
    const s = fresh();
    const z = today(s);
    const p = head(s, 'plan');
    const d = deputyOf(db, s, 'plan')!;
    away(p, z, 14);
    expect(whoDecides(db, s, 'plan', at(0, 10))).toEqual({ p: d.id, io: true });
    away(d, z, 14);
    expect(whoDecides(db, s, 'plan', at(0, 10))).toBeUndefined();
    expect(noOneFor(db, s, 'plan')).toBe(true);
    const out: Notice[] = [];
    expect(decider(db, s, 'plan', out)).toBeUndefined();
    expect(decider(db, s, 'plan', out)).toBeUndefined();
    expect(out).toEqual([{ kind: 'noOne', head: 'plan', seat: 'production' }]);
    // вернулся заместитель — снова есть кому, и «некому» снято
    d.away = [];
    expect(decider(db, s, 'plan', out)).toEqual({ p: d.id, io: true });
    expect(s.heads.noOne?.plan).toBeUndefined();
  });

  test('задание на серию в отпуске начальника планирования — запись «и. о.»; некому — заданий нет, пока не вернутся', () => {
    const s = fresh();
    const z = today(s);
    const p = head(s, 'plan');
    const d = deputyOf(db, s, 'plan')!;
    away(p, z, 60);
    until(s, at(21, BATCH_HOUR / HOUR) + HOUR);
    const io = s.journal.filter(r => r.by === 'plan' && r.d.kind === 'order');
    expect(io.length).toBeGreaterThan(0);
    for (const r of io) expect([r.p, r.io]).toEqual([d.id, true]);
    // заместитель тоже уходит — задания ждут, у поста производства — «Некому решить»
    away(d, today(s) + 1, 30);
    const out = until(s, s.t + 14 * DAY);
    expect(out.filter(n => n.kind === 'noOne')).toEqual([{ kind: 'noOne', head: 'plan', seat: 'production' }]);
    expect(s.journal.filter(r => r.by === 'plan' && r.d.kind === 'order').length).toBe(io.length);
    expect(check(db, s)).toEqual([]);
  });

  test('решение уполномоченного лица — в его смену: ни одного после 17:00 и до 08:00, ни одного в выходной', () => {
    const s = fresh();
    until(s, at(60, 0));
    const qp = s.journal.filter(r => r.by === 'qp');
    expect(qp.length).toBeGreaterThan(5);
    for (const r of qp) {
      const m = momentOf(s.start, r.t);
      expect([r.n, m.sec >= 8 * HOUR && m.sec <= 17 * HOUR, m.weekday < 5]).toEqual([r.n, true, true]);
      expect(r.p).toBeDefined();
    }
  }, 120_000);
});

describe('навык ограничивает правило (геймдизайн, §8.5)', () => {
  test('таблица: 4 и 5 — целиком; ниже — горизонт, порог вывода, замена после отказа, кандидат слабее', () => {
    expect([5, 4, 3, 2, 1].map(k => coverBy(k, 21))).toEqual([21, 21, 14, 10, 7]);
    expect([5, 4, 3, 2, 1].map(k => thresholdBy(k, 9000))).toEqual([9000, 9000, 8000, 7000, 6000]);
    expect([5, 4, 3, 2, 1].map(replacesBy)).toEqual([true, true, true, false, false]);
    expect([5, 4, 3, 2, 1].map(k => hireMinBy(k, 3))).toEqual([3, 3, 3, 2, 1]);
    expect(FULL).toBe(4);
  });

  test('начальник планирования с навыком 3: задание по запасу на две трети политики, причина называет оба числа', () => {
    const d = structuredClone(db);
    for (const row of d.scenarios[SC].staff) if (row.role === HEAD_ROLE.plan) row.skill = 3;
    const s = newPlant(d, { scenario: SC });
    apply(d, s, { kind: 'advance', seconds: at(21, 8) - s.t });
    const orders = s.journal.filter(r => r.by === 'plan' && r.d.kind === 'order');
    expect(orders.length).toBeGreaterThan(0);
    for (const r of orders) {
      const why = r.d.kind === 'order' ? r.d.why : undefined;
      expect([why?.cover, why?.policy]).toEqual([14, 21]);
    }
    expect(limitOf(d, s, 'plan', 3)).toEqual({ cover: { days: 14, full: 21 } });
  });

  test('что ограничивает навык — по отделам: найм, порог ООК, замена узлов; у снабжения — ничего', () => {
    const s = fresh();
    const hire = { min: 3, full: 3 };
    expect(limitOf(db, s, 'qa', 4)).toEqual({ threshold: { at: 9000, full: 9000 }, hire });
    expect(limitOf(db, s, 'qa', 3)).toEqual({ threshold: { at: 8000, full: 9000 }, hire });
    expect(limitOf(db, s, 'maint', 2)).toEqual({ replace: { byWear: false }, hire: { min: 2, full: 3 } });
    expect(limitOf(db, s, 'supply', 1)).toEqual({});
  });
});

describe('заместитель — команда `deputy`', () => {
  test('назначить, снять, отказы; чужой пост — нет', () => {
    const s = fresh();
    const master = Object.values(s.people).find(p => p.role === 'role.master')!;
    const packer = Object.values(s.people).find(p => p.role === 'role.packer')!;
    const was = deputyOf(db, s, 'plan')!;
    const out = apply(db, s, { kind: 'deputy', head: 'plan', person: master.id, by: 'player' });
    expect(out).toContainEqual({ kind: 'deputy', head: 'plan', person: master.id, role: master.role, tab: master.tab });
    expect(deputyOf(db, s, 'plan')?.id).toBe(master.id);
    expect(s.journal.at(-1)).toMatchObject({ by: 'player', d: { kind: 'deputy', head: 'plan', person: master.id, was: was.id } });
    expect(refusals(apply(db, s, { kind: 'deputy', head: 'plan', person: master.id, by: 'player' }))).toEqual([['deputySame', master.id]]);
    expect(refusals(apply(db, s, { kind: 'deputy', head: 'plan', person: packer.id, by: 'player' }))).toEqual([['notDeputy', packer.role]]);
    expect(refusals(apply(db, s, { kind: 'deputy', head: 'plan', person: head(s, 'plan').id, by: 'player' }))).toEqual([['ownRole', head(s, 'plan').id]]);
    expect(refusals(apply(db, s, { kind: 'deputy', head: 'plan', person: 'E999', by: 'player' }))).toEqual([['noPerson', 'E999']]);
    // снять — в отсутствие руководителя решать некому
    apply(db, s, { kind: 'deputy', head: 'plan', person: null, by: 'player' });
    expect(deputyOf(db, s, 'plan')).toBeUndefined();
    expect(refusals(apply(db, s, { kind: 'deputy', head: 'plan', person: null, by: 'player' }))).toEqual([['deputySame', 'plan']]);
    away(head(s, 'plan'), today(s), 7);
    expect(noOneFor(db, s, 'plan')).toBe(true);
    // пост качества — заместитель начальника планирования не его дело
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    expect(refusals(apply(db, s, { kind: 'deputy', head: 'plan', person: master.id, by: 'player' }))).toEqual([['notYours', 'production']]);
  });
});

describe('график отпусков (Б4г) не ставит руководителя и заместителя в одни дни', () => {
  test('черновик следующего года: части руководителя и его заместителя по сценарию не пересекаются', () => {
    const s = fresh();
    until(s, at(91, 10));
    expect(s.leave[2028]?.st).toBe('draft');
    for (const h of HEAD_IDS) {
      const a = head(s, h).away?.filter(x => x.y === 2028) ?? [];
      const b = deputyOf(db, s, h)?.away?.filter(x => x.y === 2028) ?? [];
      expect(a.length).toBeGreaterThan(0);
      for (const x of a) for (const y of b) expect([h, x.from <= y.to && y.from <= x.to]).toEqual([h, false]);
    }
  }, 120_000);
});

describe('найм руководителя переездом (ст. 80, 169 ТК РФ)', () => {
  test('только тем, кого нет в городе; кандидат через срок; приезд после предупреждения и дороги; возмещение при приёме', () => {
    const s = fresh();
    const lab = sc.labor!;
    const mv = lab.move!;
    expect(refusals(apply(db, s, { kind: 'vacancy', role: 'role.packer', shift: 'shift.a', via: 'move', by: 'player' }))).toEqual([['noMove', 'role.packer']]);
    apply(db, s, { kind: 'vacancy', role: HEAD_ROLE.plan, shift: 'shift.a', via: 'move', by: 'player' });
    const v = Object.values(s.vacancies)[0];
    expect(v.via).toBe('move');
    const wait = Math.floor(v.next! / DAY) - Math.floor(s.t / DAY);
    expect(wait).toBeGreaterThanOrEqual(mv.days[0]);
    expect(wait).toBeLessThanOrEqual(mv.days[1]);
    until(s, v.next! + MIN);
    const c = Object.values(s.candidates).find(x => x.vacancy === v.id)!;
    expect(c.via).toBe('move');
    expect(c.skill).toBeGreaterThanOrEqual(mv.skill[0]);
    expect(c.skill).toBeLessThanOrEqual(mv.skill[1]);
    const cash = s.cash.balance;
    expect(refusals(apply(db, s, { kind: 'hire', candidate: c.id, trial: 3, by: 'player' }))).toEqual([]);
    const h = s.hires[c.id];
    expect(h.arrive).toBe(today(s) + mv.notice + mv.road);
    expect(h.exam).toBe(addWorkdays(calOf(db, s), h.arrive!, lab.medical.days));
    expect(h.day).toBeGreaterThan(h.exam);
    expect(s.cash.ledger.filter(e => e.ref === `move-${c.id}`).map(e => e.sum)).toEqual([-mv.pay]);
    expect(s.cash.balance).toBe(cash - mv.pay - lab.medical.price);
  });
});

describe('деньги руководителей — с общими расходами (решение владельца, #123)', () => {
  test('за два месяца зарплата начислена всем, кроме шести руководителей; оклад виден в карточке', () => {
    const s = fresh();
    until(s, at(62, 12));
    for (const p of Object.values(s.people)) expect([p.role, p.paid === undefined]).toEqual([p.role, PAID_LATER.has(p.role)]);
  }, 120_000);
});

describe('сохранения', () => {
  test('образец схемы 35: руководители приходят в день загрузки, правила дня второй раз не решают', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v35.json', import.meta.url)).text();
    const s = fromSave(db, json);
    const z = today(s);
    const heads = Object.values(s.people).filter(p => PAID_LATER.has(p.role));
    expect(heads.map(p => p.role).sort()).toEqual([...PAID_LATER].sort());
    for (const p of heads) {
      expect(p.hired).toBe(z);
      expect(Object.keys(p.train).length).toBeGreaterThan(0);
    }
    // сохранение — в 09:01: задание на серию и заказы поставщикам этого дня уже есть
    expect(s.heads.ruled?.plan).toBe(z);
    expect(s.heads.ruled?.supply).toBe(z);
    const before = s.journal.filter(r => r.by === 'plan' && momentOf(s.start, r.t).day === z).length;
    until(s, s.t + 12 * HOUR);
    expect(s.journal.filter(r => r.by === 'plan' && momentOf(s.start, r.t).day === z).length).toBe(before);
    expect(check(db, s)).toEqual([]);
  });
});

describe('виды (Б5в): без истины', () => {
  test('строки руководителей, карточка и планёрка: кто решает сегодня, заместитель, что ограничивает навык', () => {
    const s = fresh();
    const rows = bossRows(db, s);
    expect(rows.map(r => [r.head, r.now])).toEqual(HEAD_IDS.map(h => [h, 'head']));
    expect(bossMeeting(db, s)).toEqual([]);
    const plan = rows.find(r => r.head === 'plan')!;
    expect(plan.person?.limit).toEqual({ cover: { days: 21, full: 21 } });
    expect(plan.can.map(x => x.role)).toEqual(['role.master', 'role.master', 'role.production-head']);
    // руководитель в отпуске — «и. о.» на планёрке; заместитель — в карточке, «сейчас решает за него»
    const p = head(s, 'qc');
    const d = deputyOf(db, s, 'qc')!;
    away(p, today(s), 7);
    expect(bossMeeting(db, s).map(r => [r.head, r.now, r.deputy?.n])).toEqual([['qc', 'io', Number(d.id.slice(1))]]);
    expect(bossOfPerson(db, s, d).deputyFor).toEqual([{ head: 'qc', acting: true, limit: limitOf(db, s, 'qc', d.skill) }]);
    // ключи — только записи завода: ни истины, ни бюджетов
    const keys = new Set<string>();
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) keys.add(k), walk(v);
    };
    walk(bossRows(db, s));
    walk(bossOfPerson(db, s, p));
    const ALLOWED = new Set('head seat person deputy set none now can full n tab role skill away limit cover days threshold at replace byWear hire min boss deputyFor acting'.split(' '));
    expect([...keys].filter(k => !ALLOWED.has(k))).toEqual([]);
  });
});

describe('прежний сценарий тестов механики — руководители-должности', () => {
  test('без записи `heads` решают в любой час, «Некому решить» не бывает', () => {
    const s = newPlant(legacy, { scenario: SC });
    for (const h of HEAD_IDS) {
      expect(whoDecides(legacy, s, h, at(3, 23))).toEqual({});
      expect(noOneFor(legacy, s, h)).toBe(false);
    }
    expect(bossRows(legacy, s)).toEqual([]);
  });
});
