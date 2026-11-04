// Отклонения и CAPA (Б5е; docs/specs/2026-10-vertical-slice.md, «Б5е», «Проверки Б5е»): класс при открытии — по виду;
// оценка «без влияния» — незначительное, повтор — до существенного и не выше; `classify` — пост «Качество», чужой пост —
// отказ, заданный класс правило не трогает; причина при оценке — по признаку в записях завода или «не установлена», у
// расследования — его вывод; срок — по классу, прошёл — извещение один раз; `capa` — действие каталога, исполнитель —
// руководитель отдела: отдел на посту игрока — предложение, иначе — в его час; начальник ООК — после вывода
// расследования и по повторам, в «советует» — предложение; проверка через срок процедуры — «эффективна» или повтор и
// следующее действие; автопауза — на критическом и существенном; образец прежней схемы — класс по правилу, CAPA нет.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db as game } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { capaKey, capaOptions, chainOf, lowerOf } from '../../src/engine/capa';
import { DAY, HOUR, momentOf } from '../../src/engine/core/calendar';
import { dueOf, openClass, ruleClass, sameDev, signsOf } from '../../src/engine/devclass';
import { apply, newPlant } from '../../src/engine/engine';
import { check } from '../../src/engine/invariants';
import { policyOf, POL } from '../../src/engine/policies';
import { fromSave } from '../../src/engine/save';
import type { Batch, Capa, Deviation, Notice, PlantState } from '../../src/engine/types';
import { invView } from '../../src/sim/inv';
import { journalView } from '../../src/sim/journal';
import { kpiView } from '../../src/sim/kpi';
import { stopKey } from '../../src/sim/protocol';
import { morningView } from '../../src/sim/report';
import { cardView } from '../../src/sim/views';
import { legacy } from './legacy';

const SC = 'scn.proto';
const RCP = 'rcp.paracetamol500.wet.v1';
const N20 = 'sku.paracetamol500.n20';
const PRESS = 'press-1/punches';
const HARD = 'test.ipc.hardness';

/** Завод без заданий сценария: серии в тесте заказываются вручную (как в assess.test.ts). */
const bare: ContentDb = { ...legacy, scenarios: { ...legacy.scenarios, [SC]: { ...legacy.scenarios[SC], batches: [] } } };
const SCN = bare.scenarios[SC];

/** Прожить до `days` суток часами с инвариантами; `until` — остановиться раньше. */
function live(s: PlantState, days: number, until?: () => boolean, base: ContentDb = bare): Notice[] {
  const out: Notice[] = [];
  const end = s.t + days * DAY;
  while (s.t < end && !until?.()) {
    out.push(...apply(base, s, { kind: 'advance', seconds: Math.min(HOUR, end - s.t) }));
    const bad = check(base, s);
    if (bad.length) throw new Error(`${s.t}: ${bad.slice(0, 5).join('; ')}`);
  }
  return out;
}

function order(s: PlantState): Batch {
  const n = Object.keys(s.batches).length;
  apply(bare, s, { kind: 'order', recipe: RCP, sku: N20 });
  return Object.values(s.batches)[n];
}

/** Серия с разрешённым балком: её отклонения можно оценивать. */
function ready(seats: ('production' | 'quality' | 'director')[] = ['production', 'quality']): { s: PlantState; b: Batch } {
  const s = newPlant(bare, { scenario: SC });
  // задание на серию — до мест: без мест всё своё
  const b = order(s);
  apply(bare, s, { kind: 'seat', seats });
  live(s, 14, () => b.bulk !== undefined && s.lots[b.bulk].status === 'released');
  expect(s.lots[b.bulk!].status).toBe('released');
  return { s, b };
}

/** МОК твёрдости при таблетировании серии — отклонение, как его открывает стадия: класс по правилу. */
function hard(s: PlantState, b: Batch, id: string, opened = s.t): Deviation {
  const d: Deviation = { id, opened, kind: 'ipc', batch: b.id, stage: 'compress', test: HARD, status: 'open', cls: openClass('ipc') };
  s.deviations[id] = d;
  return d;
}

/** Износ пуансонов в досье таблетирования серии — признак причины «износ пуансонов» при пороге процедуры. */
function worn(b: Batch, wear: number) {
  const rec = b.records.find(r => r.stage === 'compress')!;
  rec.wear = { ...(rec.wear ?? {}), [PRESS]: wear };
}

const refusals = (n: Notice[]) => n.flatMap(x => (x.kind === 'refused' ? [[x.cmd, x.why, x.detail]] : []));

describe('класс', () => {
  test('при открытии — по виду: выход ниже тревожного — незначительное, остальные — существенное', () => {
    for (const k of ['oos', 'ipc', 'param', 'recon'] as const) expect(openClass(k)).toBe('major');
    expect(openClass('yield')).toBe('minor');
  });

  test('«без влияния» — незначительное; второй такой же за 12 месяцев — существенное, третий — не выше', () => {
    const { s, b } = ready();
    const d1 = hard(s, b, 'D900');
    expect(apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'none', cause: 'none' })).toEqual([]);
    live(s, 1, () => d1.status !== 'open');
    expect(d1).toMatchObject({ status: 'assessed', cls: 'minor', cause: 'none' });
    // такой же — та же подпись: МОК, таблетирование, твёрдость; причина «не установлена» — сравнивают подписи
    const d2 = hard(s, b, 'D901');
    expect(sameDev(d1, d2)).toBe(true);
    apply(bare, s, { kind: 'assess', deviation: 'D901', verdict: 'none', cause: 'none' });
    live(s, 1, () => d2.status !== 'open');
    expect(d2).toMatchObject({ status: 'assessed', cls: 'major' });
    const d3 = hard(s, b, 'D902');
    apply(bare, s, { kind: 'assess', deviation: 'D902', verdict: 'none', cause: 'none' });
    live(s, 1, () => d3.status !== 'open');
    expect(d3.cls).toBe('major');
    expect(ruleClass(s, d3)).toBe('major');
    // повтор за 12 месяцев: годом позже такое же — уже не повтор
    const far = { ...d3, id: 'D903', opened: d1.opened + 366 * DAY - 3 * DAY };
    expect(sameDev(d1, far)).toBe(true);
  });

  test('`classify` — пост «Качество»: заданный класс правило не пересматривает; чужой пост, нет класса и тот же — отказ', () => {
    const { s, b } = ready();
    const d = hard(s, b, 'D900');
    expect(apply(bare, s, { kind: 'classify', deviation: 'D900', cls: 'critical', by: 'player' })).toEqual([]);
    expect(d).toMatchObject({ cls: 'critical', clsBy: true });
    expect(s.journal.at(-1)!.d).toEqual({ kind: 'classify', dev: 'D900', from: 'major', to: 'critical' });
    expect(refusals(apply(bare, s, { kind: 'classify', deviation: 'D900', cls: 'critical', by: 'player' }))).toEqual([['classify', 'same', 'D900']]);
    expect(refusals(apply(bare, s, { kind: 'classify', deviation: 'D999', cls: 'minor', by: 'player' }))).toEqual([['classify', 'noDev', 'D999']]);
    expect(refusals(apply(bare, s, { kind: 'classify', deviation: 'D900', cls: 'huge' as 'minor', by: 'player' }))).toEqual([['classify', 'noCls', 'huge']]);
    // срок — по новому классу: критическое короче
    expect(dueOf(bare, s, d)).toBe(d.opened + SCN.deviations.term.critical * DAY);
    apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'none', cause: 'none' });
    live(s, 1, () => d.status !== 'open');
    expect(d.cls).toBe('critical');
    // пост «Качество» не у игрока — отказ «не ваш пост»
    const p = ready(['production']);
    hard(p.s, p.b, 'D900');
    expect(refusals(apply(bare, p.s, { kind: 'classify', deviation: 'D900', cls: 'minor', by: 'player' }))).toEqual([['classify', 'notYours', 'quality']]);
  });
});

describe('вероятная причина', () => {
  test('по признаку в записях: износ пуансонов не ниже порога процедуры — «износ»; ниже — признаков нет', () => {
    const { s, b } = ready();
    const d = hard(s, b, 'D900');
    worn(b, SCN.deviations.wear - 1);
    expect(signsOf(bare, s, d).filter(c => bare.causes[c] && 'wear' in bare.causes[c].driver)).toEqual([]);
    worn(b, SCN.deviations.wear);
    const signs = signsOf(bare, s, d);
    const wear = signs.filter(c => 'wear' in bare.causes[c].driver);
    expect(wear.length).toBeGreaterThan(0);
    // причина без признака — отказ; с признаком — в отклонение, когда оценка сделана
    const other = Object.keys(bare.causes).find(c => !signs.includes(c))!;
    expect(refusals(apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'none', cause: other }))).toEqual([['assess', 'noSign', other]]);
    expect(apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'none', cause: wear[0] })).toEqual([]);
    live(s, 1, () => d.status !== 'open');
    expect(d.cause).toBe(wear[0]);
    // журнал: причина и признаки — в записи оценки
    const rec = s.journal.find(r => r.d.kind === 'assess' && r.d.dev === 'D900')!;
    expect(rec.d).toMatchObject({ cause: wear[0] });
  });

  test('не названа — по правилу: первая с признаком, нет признаков — «не установлена»', () => {
    const { s, b } = ready();
    const d = hard(s, b, 'D900');
    worn(b, 0);
    apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'none' });
    live(s, 1, () => d.status !== 'open');
    expect(d.cause).toBe(signsOf(bare, s, d)[0] ?? 'none');
  });
});

describe('срок', () => {
  test('по классу из записи сценария; прошёл — извещение один раз, у поста «Качество»', () => {
    const { s, b } = ready();
    const d = hard(s, b, 'D900', s.t - SCN.deviations.term.major * DAY + HOUR / 2);
    expect(dueOf(bare, s, d)).toBe(d.opened + SCN.deviations.term.major * DAY);
    const out = live(s, 0.2);
    expect(out.filter(n => n.kind === 'devLate' && n.id === 'D900')).toEqual([{ kind: 'devLate', id: 'D900', cls: 'major', code: expect.any(String) }]);
    expect(d.late).toBe(true);
    expect(live(s, 0.2).filter(n => n.kind === 'devLate')).toEqual([]);
  });
});

describe('CAPA', () => {
  test('`capa` поста «Качество»: обучить — люди стадии и её процедуры, исполнитель — начальник производства; отказы', () => {
    const { s, b } = ready(['quality']);
    const d = hard(s, b, 'D900');
    // причины ещё нет — подходят только действия по виду: калибровка прибора МОК
    expect(capaOptions(bare, s, d).map(o => o.action)).toEqual(['capa.calib']);
    apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'none', cause: 'none' });
    live(s, 1, () => d.status !== 'open');
    const opts = capaOptions(bare, s, d);
    const train = opts.find(o => o.action === 'capa.train')!;
    expect(train.head).toBe('mes');
    const rec = b.records.find(r => r.stage === 'compress')!;
    expect(train.people!.every(p => rec.people.includes(p))).toBe(true);
    expect(train.docs!.length).toBeGreaterThan(0);
    expect(train.learners).toBeGreaterThan(0);
    expect(refusals(apply(bare, s, { kind: 'capa', deviation: 'D999', action: 'capa.train', by: 'player' }))).toEqual([['capa', 'noDev', 'D999']]);
    expect(refusals(apply(bare, s, { kind: 'capa', deviation: 'D900', action: 'capa.none', by: 'player' }))).toEqual([['capa', 'noAction', 'capa.none']]);
    // оценка пары — к партии поставщика, а причины ещё нет
    expect(refusals(apply(bare, s, { kind: 'capa', deviation: 'D900', action: 'capa.pair', by: 'player' }))).toEqual([['capa', 'capaFit', 'capa.pair']]);
    const out = apply(bare, s, { kind: 'capa', deviation: 'D900', action: 'capa.train', by: 'player' });
    const c = Object.values(s.capas)[0];
    expect(out).toContainEqual({ kind: 'capa', id: c.id, dev: 'D900', action: 'capa.train', head: 'mes' });
    expect(c).toMatchObject({ dev: 'D900', action: 'capa.train', head: 'mes', by: 'player', t: s.t, due: s.t + SCN.deviations.term.major * DAY });
    expect(s.journal.at(-1)).toMatchObject({ by: 'player', seat: 'quality', d: { kind: 'capa', capa: c.id, dev: 'D900', action: 'capa.train' } });
    // то же действие цепочки ещё не проверено — второй раз нельзя
    expect(refusals(apply(bare, s, { kind: 'capa', deviation: 'D900', action: 'capa.train', by: 'player' }))).toEqual([['capa', 'capaOpen', 'capa.train']]);
    // пост «Производство» не у игрока: начальник производства выполняет в свой час — задачи обучения
    live(s, 1, () => c.done !== undefined);
    expect(c.done).toBeDefined();
    expect(c.doneBy).toBe('mes');
    expect(s.journal.some(r => r.by === 'mes' && r.d.kind === 'capaRun' && r.d.capa === c.id)).toBe(true);
    expect(Object.values(s.tasks).some(t => t.kind === 'train')).toBe(true);
    // CAPA — посту «Качество», а не чужому
    const p = ready(['production']);
    hard(p.s, p.b, 'D900');
    expect(refusals(apply(bare, p.s, { kind: 'capa', deviation: 'D900', action: 'capa.train', by: 'player' }))).toEqual([['capa', 'notYours', 'quality']]);
  });

  test('отдел исполнителя на посту игрока — предложение «Выполнить»; принято — CAPA выполнена с его места', () => {
    const { s, b } = ready(['production', 'quality']);
    const d = hard(s, b, 'D900');
    apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'none', cause: 'none' });
    live(s, 1, () => d.status !== 'open');
    expect(refusals(apply(bare, s, { kind: 'capa', deviation: 'D900', action: 'capa.train', by: 'player' }))).toEqual([]);
    const c = Object.values(s.capas)[0];
    live(s, 0.2);
    expect(c.done).toBeUndefined();
    const ask = s.journal.find(r => r.ask && r.d.kind === 'capaRun' && r.d.capa === c.id)!;
    expect(ask.by).toBe('mes');
    expect(s.heads.open?.[capaKey(c.id)]).toBe(ask.n);
    expect(apply(bare, s, { kind: 'accept', n: ask.n })).toEqual(expect.any(Array));
    expect(c.done).toBe(s.t);
    expect(c.doneBy).toBe('player');
  });

  test('«заменять раньше» — порог пуансонов опускается до порога признака, ниже — на шаг; в историю политик — по CAPA', () => {
    const { s, b } = ready(['quality']);
    const d = hard(s, b, 'D900');
    worn(b, SCN.deviations.wear + 500);
    const tool = signsOf(bare, s, d).find(c => 'wear' in bare.causes[c].driver)!;
    apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'none', cause: tool });
    live(s, 1, () => d.status !== 'open');
    const p = bare.policies[POL.replace];
    const was = policyOf(bare, s, POL.replace, PRESS)!;
    const low = lowerOf(bare, s, PRESS)!;
    const sign = Math.floor((SCN.deviations.wear - p.min!) / p.step!) * p.step! + p.min!;
    expect(low).toEqual({ from: was, to: sign });
    apply(bare, s, { kind: 'capa', deviation: 'D900', action: 'capa.earlier', by: 'player' });
    const c = Object.values(s.capas).find(x => x.action === 'capa.earlier')!;
    expect(c).toMatchObject({ part: PRESS, head: 'maint' });
    live(s, 1, () => c.done !== undefined);
    expect(policyOf(bare, s, POL.replace, PRESS)).toBe(sign);
    expect(s.journal.some(r => r.d.kind === 'capaRun' && r.d.capa === c.id && r.d.from === was && r.d.to === sign)).toBe(true);
    // у порога признака — на шаг ниже
    expect(lowerOf(bare, s, PRESS)).toEqual({ from: sign, to: sign - p.step! });
  });
});

describe('начальник ООК', () => {
  test('после второго такого же за 12 месяцев — CAPA по правилу с причиной; первый раз — нет', () => {
    const { s, b } = ready(['production']);
    const d1 = hard(s, b, 'D900');
    live(s, 2, () => d1.status !== 'open');
    expect(d1.status).not.toBe('open');
    expect(Object.values(s.capas)).toEqual([]);
    const d2 = hard(s, b, 'D901');
    live(s, 3, () => Object.keys(s.capas).length > 0);
    const c = Object.values(s.capas)[0];
    expect(c).toMatchObject({ dev: 'D901', by: 'qa' });
    const rec = s.journal.find(r => r.d.kind === 'capa' && r.d.capa === c.id)!;
    expect(rec.by).toBe('qa');
    expect(rec.d).toMatchObject({ kind: 'capa', dev: 'D901', why: { rule: 'repeat', n: 2, of: 2 } });
    expect(d2.capaDue).toBeUndefined();
  });

  test('режим ООК «советует» — предложение CAPA, принято — CAPA назначена с поста «Качество»', () => {
    const { s, b } = ready(['quality']);
    const d1 = hard(s, b, 'D900');
    apply(bare, s, { kind: 'assess', deviation: 'D900', verdict: 'none', cause: 'none' });
    live(s, 1, () => d1.status !== 'open');
    const d2 = hard(s, b, 'D901');
    apply(bare, s, { kind: 'assess', deviation: 'D901', verdict: 'none', cause: 'none' });
    live(s, 2, () => s.journal.some(r => r.ask && r.d.kind === 'capa'));
    const ask = s.journal.find(r => r.ask && r.d.kind === 'capa')!;
    expect(ask.d).toMatchObject({ dev: 'D901', why: { rule: 'repeat' } });
    expect(Object.values(s.capas)).toEqual([]);
    apply(bare, s, { kind: 'accept', n: ask.n });
    expect(Object.values(s.capas).map(c => [c.dev, c.by])).toEqual([['D901', 'player']]);
    expect(d2.capaDue).toBeUndefined();
  });

  test('после вывода расследования — CAPA по его причине (игра без мест)', () => {
    const s = newPlant(game, { scenario: SC });
    const end = s.t + 30 * DAY;
    while (s.t < end && !(Object.values(s.investigations).some(i => i.status === 'closed') && Object.keys(s.capas).length > 0)) apply(game, s, { kind: 'advance', seconds: 6 * HOUR });
    const inv = Object.values(s.investigations).find(i => i.status === 'closed')!;
    const d = s.deviations[inv.deviation];
    expect(d.cause).toBeDefined();
    const c = Object.values(s.capas).find(x => x.dev === d.id)!;
    expect(c).toBeDefined();
    expect(s.journal.find(r => r.d.kind === 'capa' && r.d.capa === c.id)!.d).toMatchObject({ why: { rule: 'inv' } });
  }, 60_000);
});

describe('проверка эффективности', () => {
  /** Выполненная CAPA по отклонению `d`: срок проверки придёт через `left` секунд. */
  function done(s: PlantState, d: Deviation, id: string, left: number): Capa {
    const c: Capa = { id, dev: d.id, action: 'capa.train', head: 'mes', t: s.t - 100 * DAY, by: 'qa', due: s.t - 70 * DAY, done: s.t - SCN.deviations.check * DAY + left, doneBy: 'mes' };
    s.capas[id] = c;
    return c;
  }

  test('через срок процедуры: такого же не было — «эффективна»; был — «не эффективна» с повтором, по нему — следующее', () => {
    const { s, b } = ready(['production']);
    const d = hard(s, b, 'D900', s.t - 120 * DAY);
    d.status = 'assessed';
    d.cause = 'none';
    const ok = done(s, d, 'G1', HOUR / 2);
    const out = live(s, 0.1);
    expect(ok.check).toEqual({ t: expect.any(Number), ok: true });
    expect(out).toContainEqual({ kind: 'capaCheck', id: 'G1', dev: 'D900', ok: true });
    expect(s.journal.at(-1)).toMatchObject({ by: 'qa', d: { kind: 'capaCheck', capa: 'G1', ok: true, days: SCN.deviations.check } });
    // повтор после выполнения
    const e = hard(s, b, 'D901', s.t - 120 * DAY);
    e.status = 'assessed';
    e.cause = 'none';
    const no = done(s, e, 'G2', HOUR / 2);
    const rep = hard(s, b, 'D902', no.done! + DAY);
    rep.status = 'assessed';
    rep.cause = 'none';
    live(s, 0.1);
    expect(no.check).toEqual({ t: expect.any(Number), ok: false, dev: 'D902' });
    expect(s.journal.some(r => r.d.kind === 'capaCheck' && r.d.capa === 'G2' && !r.d.ok && r.d.dev === 'D902')).toBe(true);
    // следующее действие — по повтору, без того, что не помогло
    live(s, 1, () => chainOf(s, rep).some(c => c.id !== 'G1' && c.id !== 'G2'));
    const next = chainOf(s, rep).filter(c => c.id !== 'G1' && c.id !== 'G2');
    expect(next.every(c => c.action !== 'capa.train')).toBe(true);
  });
});

describe('виды', () => {
  /** Ключи вида — без полей истины: причины серии, запас узла, корень происшествия. */
  const TRUTH = ['truth', 'causes', 'noise', 'budget', 'fired', 'root'];
  const clean = (v: unknown) => {
    const json = JSON.stringify(v);
    for (const k of TRUTH) expect(json.includes(`"${k}"`)).toBe(false);
  };

  test('карточка, журнал, планёрка, «Почему?» результативности и доска — CAPA игры без мест за полгода', () => {
    const s = newPlant(game, { scenario: SC });
    const end = s.t + 200 * DAY;
    while (s.t < end && !Object.values(s.capas).some(c => c.check)) apply(game, s, { kind: 'advance', seconds: DAY });
    const c = Object.values(s.capas).find(x => x.check)!;
    expect(c).toBeDefined();
    const n = Number(c.dev.slice(1));
    // карточка отклонения: класс, причина, CAPA с проверкой; узел и прибор — словами окна, ключи движка — как есть
    const card = cardView(game, s, { kind: 'dev', n }).card as Extract<ReturnType<typeof cardView>['card'], { kind: 'dev' }>;
    expect(card.cls).toBe(s.deviations[c.dev].cls);
    expect(card.cause).toBe(s.deviations[c.dev].cause);
    const row = card.capas.find(x => x.n === Number(c.id.slice(1)))!;
    expect(row).toMatchObject({ action: c.action, head: c.head, check: { ok: c.check!.ok } });
    expect(row.checkAt).toBe(c.done! + game.scenarios[SC].deviations.check * DAY);
    for (const x of card.capas) if (x.part) expect(x.unit).toEqual({ machine: s.parts[x.part].of, part: s.parts[x.part].type });
    clean(card);
    // журнал: CAPA, выполнение и проверка — записи с номером CAPA и отклонения
    const j = journalView(game, s, { view: 'journal', page: 0, focus: s.journal.find(r => r.d.kind === 'capaCheck')!.n });
    const rec = j.rows.find(r => r.d.kind === 'capaCheck')!;
    expect(rec.ref).toMatchObject({ capa: Number(c.id.slice(1)), dev: n });
    clean(j);
    // планёрка утра после проверки: она — в «проверках за сутки»
    const day = momentOf(s.start, c.check!.t).day + 1;
    const m = morningView(game, s, { view: 'morning', day });
    expect(m.capa?.checks.map(x => x.n)).toContain(Number(c.id.slice(1)));
    clean(m.capa);
    // показатели ООК: «результативность CAPA» и её «Почему?» — записи проверок
    const k = kpiView(game, s, { view: 'kpi', tab: 'quality', why: 'capaEff' });
    expect(k.why?.rows.some(r => r.k === 'capa' && r.n === Number(c.id.slice(1)) && r.ok === c.check!.ok)).toBe(true);
    // доска расследования: CAPA его отклонения
    const inv = Object.values(s.investigations).find(i => i.status === 'closed');
    if (inv) {
      const b = invView(game, s, { view: 'inv', inv: inv.id }).board!;
      expect(b.dev).toBe(Number(inv.deviation.slice(1)));
      expect(b.capas.map(x => x.n)).toEqual(Object.values(s.capas).filter(x => x.dev === inv.deviation).map(x => Number(x.id.slice(1))));
    }
  }, 120_000);
});

describe('автопауза', () => {
  test('мир встаёт на критическом и существенном; на незначительном — только извещение', () => {
    const n = (cls: 'critical' | 'major' | 'minor'): Notice => ({ kind: 'deviation', id: 'D1', what: 'ipc', code: '', cls });
    expect(stopKey(n('critical'))).toBe('deviation');
    expect(stopKey(n('major'))).toBe('deviation');
    expect(stopKey(n('minor'))).toBe('deviation/minor');
  });
});

describe('сохранение', () => {
  test('образец схемы 37: класс по правилу открытия, у решённых — «не установлена», CAPA нет; инварианты целы', () => {
    const raw = readFileSync(join(import.meta.dir, 'fixtures/save-v37.json'), 'utf8');
    const s = fromSave(game, raw);
    expect(s.capas).toEqual({});
    for (const d of Object.values(s.deviations)) {
      expect(d.cls).toBe(openClass(d.kind));
      if (d.status !== 'open') expect(d.cause).toBe('none');
    }
    apply(game, s, { kind: 'advance', seconds: DAY });
    expect(check(game, s)).toEqual([]);
  });

  test('образец схемы 38 — посреди CAPA: выполненная ждёт проверки, предложение калибровки открыто; принято — визит', () => {
    const raw = readFileSync(join(import.meta.dir, 'fixtures/save-v38.json'), 'utf8');
    const s = fromSave(game, raw);
    const done = Object.values(s.capas).find(c => c.done !== undefined && !c.check)!;
    const calib = Object.values(s.capas).find(c => c.action === 'capa.calib' && c.done === undefined)!;
    expect(done).toBeDefined();
    expect(Object.values(s.deviations).some(d => d.clsBy)).toBe(true);
    const n = s.heads.open[capaKey(calib.id)]!;
    expect(n).toBeDefined();
    expect(refusals(apply(game, s, { kind: 'accept', n }))).toEqual([]);
    expect(calib.done).toBe(s.t);
    expect(s.assets[calib.asset!].visit).toBeDefined();
    apply(game, s, { kind: 'advance', seconds: DAY });
    expect(check(game, s)).toEqual([]);
  });
});
