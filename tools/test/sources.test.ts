// Б6ж: второй источник, аналоги и запросы предложений (src/engine/supply.ts, src/engine/partners.ts,
// src/engine/plan/mrp.ts, src/engine/mes.ts; docs/specs/2026-10-vertical-slice.md, «Б6ж»; геймдизайн, §11). Поставщик
// опаздывает по своей ветви — завод знает обещанный приход; заказ, что не пришёл к обещанному, — извещение и «не пришёл»;
// пара-кандидат одобряется по шагам — документы, пробная партия, аудит, изменение досье; кому заказывать при двух
// поставщиках — по политике; предложения с баллами; аналог в карте — строка целиком аналогом; двойник тянет приход
// заново; показатель «Поставки вовремя»; виды без истины; образец схемы 44; сборщик базы.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/content';
import { addWorkdays, DAY, daysFromCivil, HOUR, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { kpiPick, sincePeriod } from '../../src/engine/kpi';
import { kitPlan, stageMass } from '../../src/engine/mes';
import { approved, choosePair, contractOf, livePairs, offersFor, pairKey, pairsFor } from '../../src/engine/partners';
import { mrpPlan } from '../../src/engine/plan/mrp';
import { forecast } from '../../src/engine/plan/schedule';
import { blind } from '../../src/engine/plan/twin';
import { POL } from '../../src/engine/policies';
import { fromSave } from '../../src/engine/save';
import { arriveAt, cancelQuote, lateOf, quotePo, supplyPosition, trialLot, windowEnd } from '../../src/engine/supply';
import { type Notice, type PlantState, SCHEMA } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';
import { mrpMeeting, mrpView } from '../../src/sim/mrp';
import { sopView } from '../../src/sim/sop';
import { partnersView } from '../../src/sim/partners';
import { refView } from '../../src/sim/ref';
import { buildDb } from '../content/load';

const SC = 'scn.proto';
const sc = db.scenarios[SC];
const start = daysFromCivil(sc.start.date);
const cal = calOf(db, { start: sc.start.date, scenario: SC });
const PAR2 = pairKey('sup.api-par2', 'mkr.api-par2');
const PAR = 'mat.api.paracetamol';
const dayOf = (s: PlantState, t = s.t) => momentOf(s.start, t).day;

/** Прожить `days` суток часами и собрать извещения; `stop` — встать раньше. */
function live(s: PlantState, days: number, stop?: () => boolean): Notice[] {
  const out: Notice[] = [];
  for (let h = 0; h < days * 24; h++) {
    out.push(...apply(db, s, { kind: 'advance', seconds: HOUR }));
    if (stop?.()) break;
  }
  return out;
}

/** Пара-кандидат в спецификации с сегодня: одобрение как после положительного решения — для правил выбора. */
function approve(s: PlantState, key = PAR2) {
  const p = s.pairs[key];
  const day = dayOf(s);
  p.spec = day;
  p.recs.push({ day, until: day + 700, how: 'audit' });
}

// год сценария — один на несколько проверок: опоздания, извещения, показатель
const year = newPlant(db, { scenario: SC });
const yearNotes = live(year, 365);

describe('опоздания поставщиков', () => {
  test('завод знает обещанный приход; опаздывающий заказ придёт позже — на дни записи поставщика, рабочим днём', () => {
    let late = 0;
    let all = 0;
    for (const po of Object.values(year.pos)) {
      if (po.status === 'cancelled') continue;
      all++;
      const L = db.suppliers[po.supplier].late;
      if (po.truth === undefined) continue;
      late++;
      expect(L).toBeDefined();
      expect(po.truth).toBeGreaterThan(po.eta);
      const d = dayOf(year, po.truth) - dayOf(year, po.eta);
      // до рабочего дня — ещё до трёх суток праздников и выходных
      expect(d).toBeGreaterThanOrEqual(L!.days[0]);
      expect(d).toBeLessThanOrEqual(L!.days[1] + 4);
      if (po.came !== undefined && !po.fast) expect(po.came).toBe(po.truth);
    }
    expect(all).toBeGreaterThan(50);
    // доля опоздавших — между долями записей поставщиков: десятая часть и четверть
    expect(late / all).toBeGreaterThan(0.03);
    expect(late / all).toBeLessThan(0.35);
    // вовремя — к обещанному: фура в обещанный миг
    for (const po of Object.values(year.pos)) if (po.truth === undefined && po.came !== undefined && !po.fast) expect(po.came).toBe(po.eta);
    expect(check(db, year)).toEqual([]);
  });

  test('опоздание — по своей ветви поставщика: доля и дни записи; без записи — не опаздывает', () => {
    const s = newPlant(db, { scenario: SC });
    const eta = 30 * DAY + 10 * HOUR;
    const xs = Array.from({ length: 400 }, () => lateOf(db, s, 'sup.api', eta));
    const n = xs.filter(x => x !== undefined).length;
    // четверть заказов дистрибьютора АФС
    expect(n).toBeGreaterThan(70);
    expect(n).toBeLessThan(130);
    for (const x of xs) if (x !== undefined) expect(momentOf(s.start, x).sec).toBe(momentOf(s.start, eta).sec);
    expect(lateOf(db, s, 'sup.parts', eta)).toBeUndefined();
  });

  test('не пришёл к обещанному: извещение в конце окна прихода; в потребности — «не пришёл» и приход не раньше сегодня', () => {
    const lateNotes = yearNotes.filter(n => n.kind === 'poLate');
    const lateArrived = Object.values(year.pos).filter(p => p.truth !== undefined && dayOf(year, p.truth) > dayOf(year, p.eta));
    expect(lateNotes.length).toBeGreaterThan(0);
    expect(lateNotes.length).toBe(lateArrived.length);
    // заказ в пути, обещанный день которого прошёл, — как в потребности
    const s = newPlant(db, { scenario: SC });
    let po: PlantState['pos'][string] | undefined;
    live(s, 200, () => {
      po = Object.values(s.pos).find(p => p.status === 'ordered' && p.truth !== undefined && s.t >= windowEnd(s, p.eta));
      return !!po;
    });
    expect(po).toBeDefined();
    const r = mrpPlan(db, s);
    const msg = r.msgs.find(m => m.kind === 'behind' && m.po === po!.id);
    expect(msg).toBeDefined();
    const row = r.rows.find(x => x.material === po!.lines[0].material)!;
    const t = row.transit.find(x => x.po === po!.id)!;
    expect(t.day).toBeGreaterThanOrEqual(dayOf(s) + sc.supply!.qc);
    // ускорить опаздывающий можно: обещан новый приход, настоящий — не позже нового
    const n = apply(db, s, { kind: 'expedite', po: po!.id });
    expect(n.some(x => x.kind === 'refused')).toBe(false);
    expect(arriveAt(po!)).toBeLessThanOrEqual(po!.eta);
  });

  test('расписание, потребность и S&OP — по обещанному приходу: настоящий приход их не меняет', () => {
    const s = newPlant(db, { scenario: SC });
    // утро, когда задание ждёт материал заказа в пути: расписание тогда читает его приход
    const waits = () => Object.values(forecast(db, s).why).some(ws => ws.some(w => w.why === 'material' && w.po !== undefined));
    live(s, 400, () => momentOf(s.start, s.t).sec === 8 * HOUR && waits());
    expect(waits()).toBe(true);
    const a = structuredClone(s);
    const b = structuredClone(s);
    let n = 0;
    for (const p of Object.values(b.pos)) {
      if (p.status !== 'ordered') continue;
      p.truth = p.eta + 40 * DAY;
      n++;
    }
    expect(n).toBeGreaterThan(0);
    expect(JSON.stringify(forecast(db, b))).toBe(JSON.stringify(forecast(db, a)));
    expect(JSON.stringify(mrpPlan(db, b))).toBe(JSON.stringify(mrpPlan(db, a)));
    expect(JSON.stringify(sopView(db, b, { view: 'sop' }))).toBe(JSON.stringify(sopView(db, a, { view: 'sop' })));
  }, 60_000);

  test('двойник прогона плана тянет приход заново: от зерна прогона, обещанный — тот же; истина завода в прогон не идёт', () => {
    const s = newPlant(db, { scenario: SC });
    live(s, 60);
    const transit = Object.values(s.pos).filter(p => p.status === 'ordered');
    expect(transit.length).toBeGreaterThan(0);
    const a = structuredClone(s);
    const b = structuredClone(s);
    // два завода, у которых различается только настоящий приход
    for (const p of Object.values(b.pos)) if (p.status === 'ordered') p.truth = p.eta + 40 * DAY;
    blind(db, a, 1);
    blind(db, b, 1);
    for (const p of transit) {
      expect(a.pos[p.id].eta).toBe(p.eta);
      expect(a.pos[p.id].truth).toEqual(b.pos[p.id].truth);
    }
    const c = structuredClone(s);
    blind(db, c, 2);
    expect(Object.values(c.pos).every(p => p.status !== 'ordered' || p.eta === s.pos[p.id].eta)).toBe(true);
  });
});

describe('пара-кандидат и «Одобрить пару»', () => {
  test('на старте кандидат без одобрения: по нему не заказать; в справочнике — «кандидат»', () => {
    const s = newPlant(db, { scenario: SC });
    expect(s.pairs[PAR2].recs).toEqual([]);
    expect(approved(db, s, 'sup.api-par2', 'mkr.api-par2', PAR, dayOf(s))).toBe(false);
    expect(pairsFor(db, s, PAR, dayOf(s)).map(x => x.supplier)).toEqual(['sup.api']);
    const q = quotePo(db, s, 'sup.api-par2', [{ material: PAR, qty: 500_000_000 }]);
    expect('why' in q && q.why).toBe('pair');
    const row = partnersView(db, s).pairs.find(x => x.id === PAR2)!;
    expect(row.cand?.material).toBe(PAR);
    expect(row.cand?.step).toBeUndefined();
    expect(row.ok).toBe(false);
  });

  test('шаги: документы — пробная партия наименьшей партией — аудит — изменение досье — решение; партия заблокирована до решения', () => {
    const s = newPlant(db, { scenario: SC });
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    const n0 = apply(db, s, { kind: 'pairApprove', pair: PAR2 });
    expect(n0.some(n => n.kind === 'refused')).toBe(false);
    expect(s.pairs[PAR2].app?.step).toBe('docs');
    expect(s.journal.some(r => r.by === 'player' && r.d.kind === 'pairApprove')).toBe(true);
    // второй раз — отказ: одобрение идёт
    expect(apply(db, s, { kind: 'pairApprove', pair: PAR2 }).some(n => n.kind === 'refused' && n.why === 'pairBusy')).toBe(true);
    const app = () => s.pairs[PAR2].app!;
    live(s, 30, () => app().step !== 'docs');
    expect(app().step).toBe('trial');
    const po = s.pos[app().po!];
    expect(po.trial).toBe(PAR2);
    expect(po.lines[0].qty).toBe(Math.ceil(db.suppliers['sup.api-par2'].items[PAR].moq / db.containers[db.materials[PAR].container].capacity) * db.containers[db.materials[PAR].container].capacity);
    // рамочного договора с новым поставщиком нет — по прайсу
    expect(po.lines[0].contract).toBeUndefined();
    // пробная партия — не запас под план: ни в правиле снабжения, ни в потребности; её заказ не отменить
    const without = structuredClone(s);
    delete without.pos[po.id];
    expect(supplyPosition(db, s, PAR)).toBe(supplyPosition(db, without, PAR));
    expect(mrpPlan(db, s).rows.find(r => r.material === PAR)!.transit.some(t => t.po === po.id)).toBe(false);
    expect(cancelQuote(s, po.id)).toEqual({ why: 'poTrial' });
    // отменить его не может и директор — заказ в пути, как был
    const boss = structuredClone(s);
    apply(db, boss, { kind: 'seat', seats: ['director'] });
    expect(apply(db, boss, { kind: 'cancelPo', po: po.id }).some(n => n.kind === 'refused' && n.why === 'poTrial')).toBe(true);
    expect(boss.pos[po.id].status).toBe('ordered');
    // партия в карантине и на испытаниях — тоже не запас
    live(s, 120, () => Object.values(s.lots).some(l => l.po === po.id));
    const fresh = Object.values(s.lots).find(l => l.po === po.id)!;
    expect(fresh.status).not.toBe('released');
    expect(trialLot(s, fresh)).toBe(true);
    expect(supplyPosition(db, s, PAR)).toBe(supplyPosition(db, (() => {
      const x = structuredClone(s);
      delete x.lots[fresh.id];
      return x;
    })(), PAR));
    live(s, 120, () => app().step !== 'trial');
    expect(app().step).toBe('audit');
    const lot = s.lots[app().lot!];
    expect(lot.status).toBe('blocked');
    live(s, 60, () => app().step !== 'audit');
    expect(app().step).toBe('dossier');
    const filed = app().filed!;
    const v = sc.partners.variation!;
    expect(app().truth!.decide).toBeGreaterThanOrEqual(addWorkdays(cal, filed, v.check + v.expert + v.decide));
    // пока решения нет — пара не в спецификации, партия заблокирована, по паре не заказать
    expect(livePairs(db, s, PAR, dayOf(s)).some(x => x.supplier === 'sup.api-par2')).toBe(false);
    const notes = live(s, 300, () => app().step === 'done');
    expect(app().step).toBe('done');
    expect(s.pairs[PAR2].spec).toBe(app().decided);
    expect(s.lots[lot.id].status).toBe('released');
    expect(approved(db, s, 'sup.api-par2', 'mkr.api-par2', PAR, dayOf(s))).toBe(true);
    expect(pairsFor(db, s, PAR, dayOf(s)).map(x => x.supplier)).toEqual(['sup.api', 'sup.api-par2']);
    // шаги — записи начальника ООК и извещения; от подачи до решения — не меньше сроков прил. 19
    expect(s.journal.filter(r => r.by === 'qa' && r.d.kind === 'pairStep').map(r => (r.d as { step: string }).step)).toContain('done');
    expect(notes.some(n => n.kind === 'pairStep' && n.step === 'done')).toBe(true);
    expect(app().decided! - filed).toBeGreaterThanOrEqual(v.check + v.expert + v.decide);
    // в полночь после решения — нового рамочного договора с ним нет
    live(s, 2);
    expect(contractOf(s, 'sup.api-par2', dayOf(s))).toBeUndefined();
    expect(check(db, s)).toEqual([]);
  }, 300_000);

  test('отказы: не кандидат; нет одобрения в сценарии; чужой пост', () => {
    const s = newPlant(db, { scenario: SC });
    expect(apply(db, s, { kind: 'pairApprove', pair: 'sup.api|mkr.api-par' }).some(n => n.kind === 'refused' && n.why === 'notCandidate')).toBe(true);
    expect(apply(db, s, { kind: 'pairApprove', pair: 'nope' }).some(n => n.kind === 'refused' && n.why === 'notCandidate')).toBe(true);
    apply(db, s, { kind: 'seat', seats: ['production'] });
    expect(apply(db, s, { kind: 'pairApprove', pair: PAR2 }).some(n => n.kind === 'refused')).toBe(true);
    expect(s.pairs[PAR2].app).toBeUndefined();
  });
});

describe('кому заказывать при двух поставщиках и предложения', () => {
  test('основному — первому в спецификации; быстрее — когда основной опоздает; по оценке — наибольший балл', () => {
    const s = newPlant(db, { scenario: SC });
    approve(s);
    const day = dayOf(s);
    expect(choosePair(db, s, PAR, day, () => 10)?.pair.supplier).toBe('sup.api');
    apply(db, s, { kind: 'seat', seats: ['director'] });
    expect(apply(db, s, { kind: 'policy', policy: POL.who, value: 'fast' }).some(n => n.kind === 'refused')).toBe(true);
    expect(apply(db, s, { kind: 'policy', policy: POL.who, value: 'main' }).some(n => n.kind === 'refused')).toBe(false);
    expect(choosePair(db, s, PAR, day, sup => (sup === 'sup.api' ? 20 : 5))).toEqual({ pair: { supplier: 'sup.api', maker: 'mkr.api-par' } });
    apply(db, s, { kind: 'policy', policy: POL.who, value: 'fast' });
    const fast = choosePair(db, s, PAR, day, sup => (sup === 'sup.api' ? 20 : 5))!;
    expect(fast.pair.supplier).toBe('sup.api-par2');
    expect(fast.pick).toEqual({ by: 'fast', main: 'sup.api', late: 20 });
    // основной не опоздает — основному
    expect(choosePair(db, s, PAR, day, () => 0)?.pair.supplier).toBe('sup.api');
    apply(db, s, { kind: 'policy', policy: POL.who, value: 'rfq' });
    const rfq = choosePair(db, s, PAR, day, () => 0, 500_000_000)!;
    expect(rfq.pick?.by).toBe('rfq');
    const offers = offersFor(db, s, PAR, 500_000_000, day);
    const best = offers.reduce((b, o) => (o.score > b.score ? o : b), offers[0]);
    expect(rfq.pair.supplier).toBe(best.supplier);
  });

  test('баллы предложений: от 0 до 100 по весам; лучшая цена — полный вес цены; доля вовремя — по записям завода', () => {
    const s = newPlant(db, { scenario: SC });
    approve(s);
    const offers = offersFor(db, s, PAR, 500_000_000);
    expect(offers.map(o => o.supplier)).toEqual(['sup.api', 'sup.api-par2']);
    const w = sc.supply!.rfq!;
    for (const o of offers) {
      expect(o.score).toBeGreaterThanOrEqual(0);
      expect(o.score).toBeLessThanOrEqual(10_000);
      // записей нет — по всем заказам завода, а их нет — всё вовремя
      expect(o.onTime).toBe(10_000);
    }
    const cheap = offers.reduce((b, o) => (o.cost < b.cost ? o : b));
    const fast = offers.reduce((b, o) => (o.lead[1] < b.lead[1] ? o : b));
    expect(cheap.supplier).toBe('sup.api');
    expect(fast.supplier).toBe('sup.api-par2');
    expect(cheap.score - (w.lead * 100 * fast.lead[1]) / cheap.lead[1] - w.rel * 100 - (w.terms * (10_000 - cheap.prepay)) / 100).toBeCloseTo(w.price * 100, -1);
  });

  test('потребность: плановый заказ «быстрее» — второму поставщику, когда у основного опоздает; иначе — основному', () => {
    const s = newPlant(db, { scenario: SC });
    approve(s);
    const r = mrpPlan(db, s);
    for (const o of r.planned.filter(x => x.material === PAR)) {
      if (o.pick?.by === 'fast') {
        expect(o.supplier).toBe('sup.api-par2');
        expect(o.pick.late).toBeGreaterThan(0);
      } else expect(o.supplier).toBe('sup.api');
    }
    // политика «основному» — все плановые заказы основному
    apply(db, s, { kind: 'seat', seats: ['director'] });
    apply(db, s, { kind: 'policy', policy: POL.who, value: 'main' });
    expect(mrpPlan(db, s).planned.filter(x => x.material === PAR).every(o => o.supplier === 'sup.api' && !o.pick)).toBe(true);
  });
});

describe('аналоги', () => {
  const STARCH = 'mat.exc.starch';
  const MAIZE = 'mat.exc.starch-maize';
  const recipe = 'rcp.paracetamol500.wet.v1';

  test('основного хватает — строка основным; не хватает на строку — строка аналогом целиком; нет и аналога — ждёт основного', () => {
    const s = newPlant(db, { scenario: SC });
    const line = db.recipes[recipe].bom.find(l => l.material === STARCH)!;
    expect(line.alt).toEqual({ material: MAIZE, factor: 10_000 });
    const k1 = kitPlan(db, s, recipe);
    expect(k1.short).toEqual([]);
    expect(k1.kit.some(k => k.material === STARCH)).toBe(true);
    expect(k1.kit.some(k => k.material === MAIZE)).toBe(false);
    // картофельного крахмала меньше строки — отклонили почти всё
    const potato = Object.values(s.lots).filter(l => l.material === STARCH);
    for (const l of potato) l.status = 'rejected';
    const k2 = kitPlan(db, s, recipe);
    expect(k2.short).toEqual([]);
    const maize = k2.kit.filter(k => k.material === MAIZE);
    expect(maize.reduce((n, k) => n + k.qty, 0)).toBe(line.qty);
    expect(k2.kit.some(k => k.material === STARCH)).toBe(false);
    for (const l of Object.values(s.lots)) if (l.material === MAIZE) l.status = 'rejected';
    const k3 = kitPlan(db, s, recipe);
    expect(k3.short).toEqual([{ material: STARCH, qty: line.qty }]);
    // масса на входе стадии: аналог грузят на стадии основного — на отвешивании его в массе серии нет
    expect(stageMass(db, { recipe, mass: 12_000_000, dispensed: [{ container: 'C1', lot: 'L1', material: MAIZE, qty: 12_000_000 }] }, 0)).toBe(0);
  });

  test('потребность: запас аналога — доступное основного; планового заказа на аналог нет; справочник показывает аналог', () => {
    const s = newPlant(db, { scenario: SC });
    const r = mrpPlan(db, s);
    expect(r.planned.some(o => o.material === MAIZE)).toBe(false);
    const row = r.rows.find(x => x.material === MAIZE);
    expect(row?.months.every(m => m.gross === 0)).toBe(true);
    const ref = refView(db, s);
    expect(ref.recipes.find(x => x.id === recipe)!.bom.find(l => l.material === STARCH)!.alt).toEqual({ material: MAIZE, factor: 10_000 });
  });
});

describe('показатель и виды', () => {
  test('«Поставки вовремя»: пришедшие за месяц не позже обещанного к пришедшим', () => {
    const p = sincePeriod(year, year.t - 30 * DAY);
    const v = kpiPick(db, year, p, ['onTime']).onTime;
    let n = 0;
    let ok = 0;
    for (const po of Object.values(year.pos)) {
      if (po.came === undefined || po.came < p.from || po.came >= p.to) continue;
      n++;
      if (dayOf(year, po.came) <= dayOf(year, po.eta)) ok++;
    }
    expect(n).toBeGreaterThan(0);
    expect(v).toBe(Math.round((ok * 10_000) / n));
  });

  test('виды без истины: настоящего прихода и дней решения наперёд нет; у планового заказа — предложения', () => {
    const s = structuredClone(year);
    approve(s);
    s.pairs[PAR2].app = { t: 0, material: PAR, step: 'dossier', filed: dayOf(s) - 3, truth: { decide: dayOf(s) + 77 } };
    const views = [mrpView(db, s), partnersView(db, s), refView(db, s), mrpMeeting(db, s)];
    const text = JSON.stringify(views);
    expect(text.includes('"truth"')).toBe(false);
    expect(text.includes(String(dayOf(s) + 77))).toBe(false);
    for (const po of Object.values(s.pos)) if (po.truth !== undefined) expect(text.includes(`"eta":${po.truth}`)).toBe(false);
    const mv = mrpView(db, s);
    expect(mv.offers.length).toBe(mv.planned.length);
  });
});

describe('сохранение и сборщик базы', () => {
  test('образец схемы 44 открывается нынешней схемой: пары-кандидаты без одобрения, заказы в пути — как были', () => {
    const raw = readFileSync(join(import.meta.dir, 'fixtures/save-v44.json'), 'utf8');
    const s = fromSave(db, raw);
    expect(s.schema).toBe(SCHEMA);
    expect(s.pairs[PAR2]).toEqual({ id: PAR2, supplier: 'sup.api-par2', maker: 'mkr.api-par2', recs: [] });
    expect(Object.values(s.pos).every(p => p.truth === undefined)).toBe(true);
    live(s, 30);
    expect(check(db, s)).toEqual([]);
  });

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

  test('опоздания — доля от 0 до 100 %, «от» не больше «до»; аналог — другой материал той же единицы; кандидат — с соглашением; веса — 100', () => {
    expect(broken({})).toEqual([]);
    expect(broken({ 'suppliers/api.yaml': [['late: { share: 25,', 'late: { share: 125,']] }).length).toBeGreaterThan(0);
    expect(broken({ 'suppliers/api.yaml': [['days: [7, 28]', 'days: [28, 7]']] }).some(e => e.includes('«от» не больше «до»'))).toBe(true);
    expect(broken({ 'recipes/paracetamol500.wet.v1.yaml': [['alt: { material: mat.exc.starch-maize, factor: 1 }', 'alt: { material: mat.exc.starch, factor: 1 }']] }).some(e => e.includes('сам основной'))).toBe(true);
    // аналог — не вспомогательное вещество: плёнка ПВХ вместо крахмала
    expect(broken({ 'recipes/paracetamol500.wet.v1.yaml': [['alt: { material: mat.exc.starch-maize, factor: 1 }', 'alt: { material: mat.pk.pvc, factor: 1 }']] }).some(e => e.includes('только у вспомогательного вещества'))).toBe(true);
    // аналог другой единицы учёта: крахмал кукурузный — в штуках
    expect(broken({ 'materials/exc/starch-maize.yaml': [['unit: kg', 'unit: pcs']] }).some(e => e.includes('другая единица учёта'))).toBe(true);
    expect(broken({ 'recipes/paracetamol500.wet.v1.yaml': [['alt: { material: mat.exc.starch-maize, factor: 1 }', 'alt: { material: mat.exc.starch-maize, factor: 0 }']] }).length).toBeGreaterThan(0);
    expect(broken({ 'agreements/api-par2.yaml': [['materials: [mat.api.paracetamol]', 'materials: [mat.api.loratadine]']] }).some(e => e.includes('пары-кандидата'))).toBe(true);
    expect(broken({ 'scenarios/proto.yaml': [['rfq: { price: 40,', 'rfq: { price: 50,']] }).some(e => e.includes('supply.rfq'))).toBe(true);
  });
});
