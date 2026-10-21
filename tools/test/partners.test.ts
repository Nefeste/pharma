// Контрагенты и договоры (Б3г; docs/specs/2026-10-vertical-slice.md, «Проверки Б3г»): изготовитель — своей записью,
// поставщик — сам изготовитель или дистрибьютор; одобренные пары «поставщик — изготовитель» — в спецификации материала;
// соглашения по качеству — документы `QAG-` с шапкой. Сборщик базы ловит материал без пары, пару, которой нет у
// поставщика, изготовителя или поставщика не из базы, изготовителя без страны, соглашение не на материал поставщика,
// пару без соглашения на начало и код соглашения не по формату. Движок: на старте всё в сроке; коллега снабжения
// заказывает только по одобренной паре, по цене договора, сверх обещанного — по прайсу; коллега качества назначает
// оценку за срок предупреждения — аудит у изготовителя со счётом или документы, рассматривает специалист ООК; срок
// вышел — пара приостановлена, по ней не заказывают; договор кончился — новый, недобор — счёт за разницу. Прогон плана
// знает одобрения и договоры, образец схемы 19 читается. Виды окна — записи и учёт завода.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import { part } from '../../src/engine/cash';
import { addMonths, addWorkdays, DAY, daysFromCivil, HOUR, isWorkday, MIN, momentOf } from '../../src/engine/core/calendar';
import { headOf } from '../../src/engine/docs';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { sampleCount } from '../../src/engine/lab';
import { agreementFor, BOOK_HOUR, costOf, listPrice, pairKey, pairsFor, pairValid, REVIEW_PRIO, REVIEWERS, specPairs, STARTING } from '../../src/engine/partners';
import { runSeed } from '../../src/engine/plan/run';
import { fromSave } from '../../src/engine/save';
import { SUPPLY_HOUR } from '../../src/engine/supply';
import type { Notice, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { nowView } from '../../src/sim/now';
import { refView } from '../../src/sim/ref';
import { cashView, morningView } from '../../src/sim/report';
import { cardView } from '../../src/sim/views';
import { buildDb } from '../content/load';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const start = daysFromCivil(sc.start.date);
const cal = calOf(db, { start: sc.start.date, scenario: SC });
const API = 'sup.api|mkr.api-par';
const EXC = 'sup.exc|mkr.exc';
const PACK = 'sup.pack|mkr.pack';

/** Игровые секунды от начала партии до часа `hour` суток `day` (номер дня от 1970-01-01). */
const at = (day: number, hour: number) => (day - start) * DAY + hour * HOUR;
const dayOf = (s: PlantState) => momentOf(s.start, s.t).day;
/** Ходить по `step`, пока `done()` не станет правдой или не наступит `until`; извещения — в `out`. */
function live(s: PlantState, done: () => boolean, until: number, step = MIN, out: Notice[] = []) {
  while (!done() && s.t < until) out.push(...apply(db, s, { kind: 'advance', seconds: step }));
}
/** Последний день одобрения пары — `until`: так оценка подходит к сроку предупреждения раньше, чем по хешу. */
function due(s: PlantState, key: string, until: number) {
  const p = s.pairs[key];
  const r = p.recs[p.recs.length - 1];
  p.recs[p.recs.length - 1] = { ...r, day: Math.min(r.day, until - 1), until };
}

describe('контрагенты в базе', () => {
  test('изготовители вымышленные, со страной и площадкой; у материала — пара спецификации, поставщик продаёт его от этого изготовителя', () => {
    expect(Object.keys(db.makers).sort()).toEqual(['mkr.api-lor', 'mkr.api-par', 'mkr.exc', 'mkr.pack']);
    for (const m of Object.values(db.makers)) expect([m.country.ru.length > 0, m.site.ru.length > 0]).toEqual([true, true]);
    expect(db.suppliers['sup.api'].maker).toBeUndefined();
    expect(db.suppliers['sup.api'].items['mat.api.paracetamol'].maker).toBe('mkr.api-par');
    for (const id of ['sup.api-lor', 'sup.exc', 'sup.pack']) for (const it of Object.values(db.suppliers[id].items)) expect(it.maker).toBe(db.suppliers[id].maker!);
    for (const m of Object.values(db.materials)) {
      const pairs = specPairs(db, m.id, start);
      if (!STARTING.has(m.kind)) {
        expect(pairs).toEqual([]);
        continue;
      }
      expect(pairs.length).toBeGreaterThan(0);
      for (const x of pairs) expect(db.suppliers[x.supplier].items[m.id].maker).toBe(x.maker);
    }
  });

  test('соглашения по качеству — QAG-NNNN, утверждает начальник ООК; у каждой пары на начало — действующее соглашение', () => {
    for (const a of Object.values(db.agreements)) {
      expect(a.doc.code).toMatch(/^QAG-\d{4}$/);
      expect(a.doc.approved).toBe('role.qa-head');
    }
    for (const m of Object.values(db.materials)) for (const x of specPairs(db, m.id, start)) expect(agreementFor(db, x.supplier, x.maker, m.id, start)).toBeDefined();
    // редакция соглашения с лактозой введена 01.03.2027: до неё лактоза не покрыта
    expect(agreementFor(db, 'sup.exc', 'mkr.exc', 'mat.exc.lactose', daysFromCivil({ y: 2027, m: 2, d: 28 }))).toBeUndefined();
    expect(headOf(db, 'agreements', agreementFor(db, 'sup.exc', 'mkr.exc', 'mat.exc.lactose', start)!)!.rev).toBe(2);
  });
});

describe('сборщик базы (Б3г)', () => {
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
  const has = (errors: string[], part: string) => expect(errors.some(e => e.includes(part))).toBe(true);
  const MCC = 'specs/mat/exc/mcc.yaml';
  const PAIR = 'pairs: [{ supplier: sup.exc, maker: mkr.exc }]';

  test('материал без одобренной пары; пары нет у поставщика; изготовителя или поставщика нет в базе', () => {
    has(broken({ [MCC]: [[PAIR, '']] }), 'нет одобренной пары «поставщик — изготовитель»');
    has(broken({ [MCC]: [[PAIR, 'pairs: [{ supplier: sup.exc, maker: mkr.pack }]']] }), 'у sup.exc нет mat.exc.mcc от mkr.pack');
    has(broken({ [MCC]: [[PAIR, 'pairs: [{ supplier: sup.exc, maker: mkr.none }]']] }), 'нет изготовителя mkr.none');
    has(broken({ [MCC]: [[PAIR, 'pairs: [{ supplier: sup.none, maker: mkr.exc }]']] }), 'нет поставщика sup.none');
  });

  test('изготовитель без страны; поставщик-изготовитель продаёт чужое; у дистрибьютора — без изготовителя', () => {
    has(broken({ 'makers/exc.yaml': [['country: { ru: Германия, en: Germany }\n', '']] }), 'makers/exc.yaml: country');
    has(broken({ 'suppliers/exc.yaml': [['mat.exc.mcc: { price: 320, moq: 100 }', 'mat.exc.mcc: { price: 320, moq: 100, maker: mkr.pack }']] }), 'поставщик-изготовитель продаёт своё');
    has(broken({ 'suppliers/api.yaml': [[', maker: mkr.api-par }', ' }']] }), 'у дистрибьютора изготовитель у каждого материала');
  });

  test('соглашение не на материал поставщика; пара без соглашения на начало; код не QAG-', () => {
    has(broken({ 'agreements/api.yaml': [['materials: [mat.api.paracetamol]', 'materials: [mat.exc.starch]']] }), 'sup.api не продаёт mat.exc.starch');
    has(broken({ 'agreements/api-lor.yaml': [['from: 2027-03-01', 'from: 2027-12-01']] }), 'нет действующего соглашения по качеству');
    has(broken({ 'agreements/api.yaml': [['code: QAG-0001', 'code: QA-0001']] }), 'код документа — QAG-NNNN');
  });

  test('срок предупреждения не короче самого короткого интервала оценки', () => {
    has(broken({ 'scenarios/proto.yaml': [['every: { api: 24, excipient: 36, packaging: 12 }', 'every: { api: 24, excipient: 36, packaging: 1 }']] }), 'partners.ahead — срок предупреждения не короче');
  });
});

describe('движок (Б3г)', () => {
  test('на старте: пары одобрены и в сроке, записи не раньше спецификации; договоры с первого дня на срок; у запаса — изготовитель пары', () => {
    const s = newPlant(db, { scenario: SC });
    expect(Object.keys(s.pairs).sort()).toEqual(['sup.api-lor|mkr.api-lor', API, EXC, PACK]);
    for (const p of Object.values(s.pairs)) {
      const r = p.recs[0];
      expect(p.recs.length).toBe(1);
      expect(r.day <= start && r.until - start > sc.partners.ahead).toBe(true);
      expect(r.how).toBe(p.supplier === 'sup.pack' ? 'docs' : 'audit');
      expect(r.by).toBeUndefined();
    }
    // лоратадин вошёл в спецификацию 01.03.2027 — одобрение не раньше
    expect(s.pairs['sup.api-lor|mkr.api-lor'].recs[0].day).toBeGreaterThanOrEqual(daysFromCivil({ y: 2027, m: 3, d: 1 }));
    const cs = Object.values(s.contracts);
    expect(cs.map(c => [c.id, c.party, c.kind])).toEqual([
      ['CTR-0001', 'sup.api', 'frame'],
      ['CTR-0002', 'sup.api-lor', 'frame'],
      ['CTR-0003', 'sup.exc', 'frame'],
      ['CTR-0004', 'sup.pack', 'frame'],
      ['CTR-0005', 'cus.national', 'supply'],
      ['CTR-0006', 'cus.regional', 'supply'],
    ]);
    for (const c of cs) expect([c.from, c.to]).toEqual([start, addMonths(start, sc.partners.months) - 1]);
    for (const l of cs[0].lines) expect([l.price, l.bought, l.volume > 0]).toEqual([db.suppliers['sup.api'].items[l.material].price, 0, true]);
    for (const l of Object.values(s.lots)) if (l.supplier === 'start') expect(l.maker).toBe(specPairs(db, l.material, start)[0].maker);
    expect(check(db, s)).toEqual([]);
  });

  test('коллега снабжения — по одобренной паре и цене договора, сверх обещанного — по прайсу; у партии — изготовитель пары', () => {
    const s = newPlant(db, { scenario: SC });
    // крахмала обещано столько, сколько уже куплено: следующий заказ — по прайсу
    const ctr = s.contracts['CTR-0003'];
    const starch = ctr.lines.find(l => l.material === 'mat.exc.starch')!;
    starch.volume = 0;
    live(s, () => Object.values(s.pos).some(p => p.supplier === 'sup.exc'), at(start + 20, 23), HOUR);
    const po = Object.values(s.pos).find(p => p.supplier === 'sup.exc')!;
    expect(po.by).toBe('head:supply');
    for (const l of po.lines) {
      expect([l.maker, l.contract]).toEqual(['mkr.exc', 'CTR-0003']);
      const price = db.suppliers['sup.exc'].items[l.material].price;
      const deal = ctr.lines.find(x => x.material === l.material)!;
      expect(deal.bought).toBe(l.qty);
      if (l.material === 'mat.exc.starch') expect(l.list).toBe(l.qty);
      else expect([l.list, costOf(db, l.material, price, l.qty)]).toEqual([undefined, costOf(db, l.material, price, l.qty)]);
    }
    const net = po.lines.reduce((n, l) => n + costOf(db, l.material, l.list ? listPrice(db, s, db.suppliers['sup.exc'].items[l.material].price) : db.suppliers['sup.exc'].items[l.material].price, l.qty), 0);
    expect(po.sum! - po.vat!).toBe(net);
    // приход: у партии — изготовитель пары, номер партии — с его кода
    live(s, () => Object.values(s.lots).some(l => l.po === po.id), po.eta + MIN, HOUR);
    const lot = Object.values(s.lots).find(l => l.po === po.id)!;
    expect(lot.maker).toBe('mkr.exc');
    expect(lot.vendorLot.startsWith('EXC-')).toBe(true);
    expect(check(db, s)).toEqual([]);
  });

  test('план отбора: у вспомогательного вещества одобренной по аудиту пары изготовителя — 1 + √N; у упаковки — тоже; у АФС — каждая тара', () => {
    const s = newPlant(db, { scenario: SC });
    const lot = (material: string, supplier: string, maker: string) => ({ material, supplier, maker }) as PlantState['lots'][string];
    expect(sampleCount(db, s, lot('mat.exc.mcc', 'sup.exc', 'mkr.exc'), 16)).toBe(5);
    expect(sampleCount(db, s, lot('mat.pk.pvc', 'sup.pack', 'mkr.pack'), 16)).toBe(5);
    expect(sampleCount(db, s, lot('mat.api.paracetamol', 'sup.api', 'mkr.api-par'), 16)).toBe(16);
    // вспомогательное вещество, одобренное по документам, — каждая тара: пробы не из всех тар — награда за аудит
    s.pairs[EXC].recs[0].how = 'docs';
    expect(sampleCount(db, s, lot('mat.exc.mcc', 'sup.exc', 'mkr.exc'), 16)).toBe(16);
  });

  test('оценка по документам: коллега качества — за срок предупреждения, рассматривает специалист ООК, запись — с днём рассмотрения', () => {
    const s = newPlant(db, { scenario: SC });
    // упаковке — 20 суток одобрения: в ближайшие 09:00 рабочего дня коллега назначит оценку
    due(s, PACK, start + 20);
    const book = isWorkday(cal, start) && sc.start.hour * HOUR < BOOK_HOUR ? start : addWorkdays(cal, start, 1);
    live(s, () => !!s.pairs[PACK].eval, at(book, 10));
    const e = s.pairs[PACK].eval!;
    expect([e.how, e.booked]).toEqual(['docs', at(book, 9)]);
    const t = s.tasks[e.task!];
    expect([t.kind, t.roles, t.work, t.prio, t.pair]).toEqual(['vendorReview', [...REVIEWERS], sc.partners.docs.review, REVIEW_PRIO, PACK]);
    live(s, () => !s.pairs[PACK].eval, at(book + 10, 0));
    const r = s.pairs[PACK].recs.at(-1)!;
    expect([r.how, s.people[r.by!].role]).toEqual(['docs', 'role.qa']);
    expect(r.until).toBe(addMonths(r.day, sc.partners.every.packaging) - 1);
    expect(r.day).toBeGreaterThanOrEqual(book);
    expect(check(db, s)).toEqual([]);
  });

  test('аудит: аудитор у изготовителя с 09:00 ближайшего рабочего дня, отчёт в 17:00 последнего — счёт с НДС; у пары дистрибьютора — и документы', () => {
    const s = newPlant(db, { scenario: SC });
    due(s, API, start + 20);
    const book = isWorkday(cal, start) && sc.start.hour * HOUR < BOOK_HOUR ? start : addWorkdays(cal, start, 1);
    live(s, () => !!s.pairs[API].eval, at(book, 10));
    const e = s.pairs[API].eval!;
    expect([e.how, e.from, e.to]).toEqual(['audit', at(addWorkdays(cal, book, 1), 9), at(addWorkdays(cal, book, sc.partners.audit.days), 17)]);
    // во время аудита — строка «Сейчас»: аудитор у изготовителя
    live(s, () => s.t >= e.from! + HOUR, e.from! + HOUR);
    const row = nowView(db, s).rows.find(x => x.kind === 'audit')!;
    expect([row.dept, row.supplier, row.maker, row.until, row.people]).toEqual(['qa', 'sup.api', 'mkr.api-par', e.to, []]);
    const n = s.cash.ledger.length;
    live(s, () => s.pairs[API].eval?.task !== undefined, e.to! + MIN);
    const price = sc.partners.audit.price;
    const vat = part(price, db.profiles[sc.profile].vat.general);
    expect(s.cash.ledger.slice(n).filter(x => x.item === 'audit')).toEqual([{ t: e.to!, sum: -(price + vat), item: 'audit', ref: API }]);
    // дистрибьютор: отчёт аудитора и его документы
    expect(s.tasks[s.pairs[API].eval!.task!].work).toBe(sc.partners.audit.review + sc.partners.docs.review);
    live(s, () => !s.pairs[API].eval, e.to! + 10 * DAY);
    const r = s.pairs[API].recs.at(-1)!;
    expect([r.how, r.until]).toEqual(['audit', addMonths(r.day, sc.partners.every.api) - 1]);
    expect(check(db, s)).toEqual([]);
  });

  test('срок вышел — пара приостановлена: извещение в полночь, коллега не заказывает, заказ игрока отклонён, партия прежнего заказа — проба из каждой тары', () => {
    const s = newPlant(db, { scenario: SC });
    // игрок заказал крахмал, пока пара одобрена
    const out = apply(db, s, { kind: 'po', supplier: 'sup.exc', lines: [{ material: 'mat.exc.starch', qty: 1000 * 1_000_000 }] });
    const po = out.find(x => x.kind === 'ordered')!;
    expect(po).toBeDefined();
    // одобрение — до сегодня, а оценку не назначить: срок вышел, коллега уже не успевает
    due(s, EXC, start);
    s.pairs[EXC].eval = { how: 'docs', booked: s.t, v: 0, task: 'T0' };
    s.tasks.T0 = { id: 'T0', kind: 'vendorReview', roles: ['role.nobody'], from: { kind: 'point', x: 0, z: 0 }, work: HOUR, prio: 0, count: 1, created: s.t, state: 'open', people: [], pair: EXC, v: 0 };
    s.open.push('T0');
    const seen: Notice[] = [];
    live(s, () => s.t >= at(start + 1, 1), at(start + 1, 1), HOUR, seen);
    expect(seen.filter(x => x.kind === 'pairSuspended')).toEqual([{ kind: 'pairSuspended', pair: EXC, supplier: 'sup.exc', maker: 'mkr.exc' }]);
    expect(pairValid(s.pairs[EXC], dayOf(s))).toBe(false);
    expect(pairsFor(db, s, 'mat.exc.starch', dayOf(s))).toEqual([]);
    expect(apply(db, s, { kind: 'po', supplier: 'sup.exc', lines: [{ material: 'mat.exc.mcc', qty: 200 * 1_000_000 }] })).toEqual([{ kind: 'refused', cmd: 'po', why: 'pair', detail: 'mat.exc.mcc' }]);
    // коллега снабжения в 09:00 — без заказов по приостановленной паре (в день начала она ещё действовала)
    live(s, () => s.t >= at(addWorkdays(cal, start, 3), 10), at(addWorkdays(cal, start, 3), 10), HOUR);
    expect(Object.values(s.pos).filter(p => p.supplier === 'sup.exc' && p.by === 'head:supply' && p.ordered >= at(start + 1, 0))).toEqual([]);
    // партия прежнего заказа — проба из каждой тары
    const id = (po as { po: string }).po;
    live(s, () => Object.values(s.lots).some(l => l.po === id && l.sample), s.pos[id].eta + 3 * DAY, HOUR);
    const lot = Object.values(s.lots).find(l => l.po === id)!;
    const containers = Object.values(s.containers).filter(c => c.lot === lot.id).length;
    expect(s.samples[lot.sample!].plan.length).toBe(containers);
  }, 30_000);

  test('договор кончился: новый на срок с новым номером, недобор по паре — счёт за разницу; поставки — продлены', () => {
    const s = newPlant(db, { scenario: SC });
    const exc = s.contracts['CTR-0003'];
    const cus = s.contracts['CTR-0005'];
    exc.to = start;
    cus.to = start;
    // крахмала купили на треть обещанного — меньше доли сценария
    for (const l of exc.lines) l.bought = l.material === 'mat.exc.starch' ? Math.floor(l.volume / 3) : 0;
    const n = s.cash.ledger.length;
    live(s, () => s.t >= at(start + 1, 1), at(start + 1, 1), HOUR);
    expect(exc.closed).toBe(true);
    const next = Object.values(s.contracts).find(c => c.party === 'sup.exc' && !c.closed)!;
    expect([next.id, next.from, next.to]).toEqual(['CTR-0007', start + 1, addMonths(start + 1, sc.partners.months) - 1]);
    expect(next.lines.map(l => l.price)).toEqual(exc.lines.map(l => l.price));
    // разница — за всё купленное по паре: и за то, что коллега докупил в первый день
    const diff = exc.lines.map(l => costOf(db, l.material, listPrice(db, s, l.price) - l.price, l.bought));
    const net = diff.reduce((a, b) => a + b, 0);
    const vat = diff.reduce((a, d) => a + part(d, db.profiles[sc.profile].vat.general), 0);
    expect(exc.lines.reduce((a, l) => a + costOf(db, l.material, l.price, l.bought), 0) * 2).toBeLessThan(exc.lines.reduce((a, l) => a + costOf(db, l.material, l.price, l.volume), 0));
    expect(s.cash.ledger.slice(n).filter(x => x.item === 'contract')).toEqual([{ t: at(start + 1, 0), sum: -(net + vat), item: 'contract', ref: 'CTR-0003' }]);
    expect([cus.closed, cus.to]).toEqual([undefined, addMonths(start + 1, sc.partners.months) - 1]);
    expect(check(db, s)).toEqual([]);
  });

  test('нет действующего рамочного договора, а пара одобрена, — в полночь новый, цена — записи поставщика', () => {
    const s = newPlant(db, { scenario: SC });
    s.contracts['CTR-0003'].closed = true;
    live(s, () => s.t >= at(start + 1, 1), at(start + 1, 1), HOUR);
    const next = Object.values(s.contracts).find(c => c.party === 'sup.exc' && !c.closed)!;
    expect([next.id, next.from]).toEqual(['CTR-0007', start + 1]);
    for (const l of next.lines) expect(l.price).toBe(db.suppliers['sup.exc'].items[l.material].price);
  });

  test('прогон плана: одобрения, оценки и договоры — как на заводе; дальше коллеги по тем же правилам', () => {
    const s = newPlant(db, { scenario: SC });
    due(s, PACK, start + 20);
    const c = runSeed(db, s, [], { days: 10, seeds: 1 }, 0);
    expect(Object.keys(c.pairs)).toEqual(Object.keys(s.pairs));
    expect(c.pairs[PACK].recs.length).toBe(2);
    expect(Object.keys(c.contracts)).toEqual(Object.keys(s.contracts));
    expect(s.pairs[PACK].recs.length).toBe(1);
  }, 30_000);

  test('образец схемы 19 читается: у партий — изготовители, пары в сроке, договоры с дня сохранения', async () => {
    const json = await Bun.file(new URL('./fixtures/save-v19.json', import.meta.url)).text();
    const s = fromSave(db, json);
    const day = dayOf(s);
    for (const l of Object.values(s.lots)) if (db.suppliers[l.supplier] && STARTING.has(db.materials[l.material].kind)) expect(l.maker).toBe(db.suppliers[l.supplier].items[l.material].maker);
    for (const p of Object.values(s.pairs)) expect(pairValid(p, day)).toBe(true);
    for (const c of Object.values(s.contracts)) expect([c.from, c.lines.every(l => l.bought === 0)]).toEqual([day, true]);
    expect(check(db, s)).toEqual([]);
  });
});

describe('виды окна (Б3г)', () => {
  test('справочник «Контрагенты»: изготовители, пары с одобрением и соглашением, действующие договоры; «Материалы» — пары', () => {
    const s = newPlant(db, { scenario: SC });
    const v = refView(db, s).partners;
    expect(v.makers.map(m => m.id).sort()).toEqual(Object.keys(db.makers).sort());
    const api = v.pairs.find(p => p.id === API)!;
    expect([api.how, api.ok, api.materials, api.agreement]).toEqual(['audit', true, ['mat.api.paracetamol'], 'qag.api']);
    expect(v.pairs.find(p => p.id === PACK)!.agreement).toBe('qag.pack-r3');
    expect(v.contracts.map(c => c.id)).toEqual(['CTR-0001', 'CTR-0002', 'CTR-0003', 'CTR-0004', 'CTR-0005', 'CTR-0006']);
    expect(refView(db, s).materials.find(m => m.id === 'mat.exc.mcc')!.pairs).toEqual([{ supplier: 'sup.exc', maker: 'mkr.exc' }]);
  });

  test('карточка партии — изготовитель, номер его партии, договор; планёрка «Поставщики»; касса «Аудит поставщиков»', () => {
    const s = newPlant(db, { scenario: SC });
    live(s, () => Object.values(s.lots).some(l => l.po), at(start + 25, 0), HOUR);
    const lot = Object.values(s.lots).find(l => l.po)!;
    const unit = Object.values(s.units).find(u => u.items.some(id => s.containers[id]?.lot === lot.id))!;
    const card = cardView(db, s, { kind: 'unit', n: Number(unit.id.slice(1)) }).card as { lot?: { maker?: string; contract?: string; vendorLot: string } };
    expect([card.lot?.maker, card.lot?.contract, card.lot?.vendorLot]).toEqual([lot.maker, s.pos[lot.po!].lines[0].contract, lot.vendorLot]);
    // планёрка: пара, чьё одобрение кончится в срок предупреждения, — в «Поставщиках»
    due(s, PACK, dayOf(s) + 5);
    const m = morningView(db, s, { view: 'morning', day: dayOf(s) }).partners;
    expect(m.soon.map(x => x.id)).toEqual([PACK]);
    expect(m.suspended).toEqual([]);
    // касса: счёт аудитора — с парой
    s.cash.ledger.push({ t: s.t, sum: -1, item: 'audit', ref: API });
    const rows = cashView(db, s, { view: 'cash', page: 0 }).entries.filter(r => r.item === 'audit');
    expect(rows.at(-1)?.why).toEqual({ k: 'audit', supplier: 'sup.api', maker: 'mkr.api-par' });
  }, 30_000);
});
