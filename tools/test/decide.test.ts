// Часть Б1г: что делать — виды и рычаги окна (docs/specs/2026-10-vertical-slice.md, «Б1г», «Проверки Б1г»). У каждой
// строки планёрки — решения из таблицы спецификации; рычаг чужого поста помечен постом, рычаг, которого ещё нет, —
// «будет в …». Карточка отклонения — без истины: досье, карта и результаты испытаний; заводы, у которых различаются
// только скрытые поля, дают один вид; ключи видов — только описанные. Решение по серии — условия выпуска; режимы — цель
// и диапазон по карте, факт по досье. Пояснение при первом событии — по виду события, понятые помнит окно.
import { describe, expect, test } from 'bun:test';
import { legacy as db } from './legacy';
import { db as game } from '../../src/content';
import type { ContentDb } from '../../src/content/types';
import { firstOf, keepFirsts, keptFirsts } from '../../src/app/firsts';
import { devLevers, heldLevers, type Lever, mainLevers, riskLevers } from '../../src/app/levers';
import { DAY, HOUR, momentOf } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import type { Batch, PlantState } from '../../src/engine/types';
import { devCard, regimesAt, releaseOf } from '../../src/sim/devs';
import { morningView } from '../../src/sim/report';
import { cardView } from '../../src/sim/views';

const SC = 'scn.proto';
const RCP = 'rcp.paracetamol500.wet.v1';
const N20 = 'sku.paracetamol500.n20';
const bare: ContentDb = { ...db, scenarios: { ...db.scenarios, [SC]: { ...db.scenarios[SC], batches: [] } } };
const policy = { wms: 'need', qc: 'need', qa: 'need', mes: 'need', line: 'need', maint: 'need' } as const;

const kinds = (l: Lever[]) => l.map(x => (x.k === 'later' ? `later:${x.what}` : x.k));

/** Все ключи объектов вида, на любой глубине. */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keysOf(x, out);
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysOf(x, out);
    }
  return out;
}

/** Поля видов src/sim/devs.ts и строк планёрки: новое поле — сначала сюда, с вопросом, знает ли его завод по досье. */
const ALLOWED = new Set(
  (
    'kind dev what opened status batch code held unit lot material recipe stage at from to param id value target range ' +
    'ipc test n out min max yield units nominal alarm recon issued used spoiled returned tests method result equipment ' +
    'people role tab linked attr done assess verdict colleague t block none why inv due ' +
    'review qp open reject now end list sku assessing'
  ).split(' '),
);

function live(s: PlantState, days: number, until: () => boolean) {
  const end = s.t + days * DAY;
  while (s.t < end && !until()) apply(bare, s, { kind: 'advance', seconds: HOUR });
}

function order(s: PlantState): Batch {
  const n = Object.keys(s.batches).length;
  apply(bare, s, { kind: 'order', recipe: RCP, sku: N20 });
  return Object.values(s.batches)[n];
}

describe('рычаги планёрки — по таблице спецификации', () => {
  test('ждали «людей нет в смене»: расписание и лаборатория; будут аналитик во вторую смену и найм', () => {
    const l = mainLevers({ k: 'wait', dept: 'qc', cause: 'shift', sec: 3600 }, policy);
    expect(kinds(l)).toEqual(['gantt', 'lab', 'later:analyst', 'later:hire']);
    expect(l.filter(x => 'seat' in x).map(x => ('seat' in x ? x.seat : ''))).toEqual(['production', 'quality']);
  });

  test('ждали «нет часов»: политика отдела и расписание; будут графики и найм; политика уже такая — помечена', () => {
    const l = mainLevers({ k: 'wait', dept: 'mes', cause: 'hours', sec: 3600 }, { ...policy, mes: 'finish' });
    expect(kinds(l)).toEqual(['overtime', 'gantt', 'later:schedules', 'later:hire']);
    expect(l[0]).toEqual({ k: 'overtime', dept: 'mes', seat: 'production', on: false });
    expect(mainLevers({ k: 'wait', dept: 'qc', cause: 'hours', sec: 1 }, policy)[0]).toEqual({ k: 'overtime', dept: 'qc', seat: 'quality', on: true });
  });

  test('люди много ходили: слой «Потоки — люди»; будет стройка', () => {
    expect(kinds(mainLevers({ k: 'walk', sec: 3600, cm: 100000 }, policy))).toEqual(['flows', 'later:build']);
  });

  test('заказ под угрозой: срочное задание по позиции, удержанная серия той же позиции, «Поднять»; будут политики продаж и S&OP', () => {
    const sc = game.scenarios[SC];
    const risk = { order: 'O1', customer: 'cus.national', due: 0, missing: 5, pending: 3, short: [N20] };
    const held = [
      { code: 'PA0070927', sku: N20, unit: 7, open: [1], reject: [] },
      { code: 'LO0040927', sku: 'sku.loratadine10.n10', unit: 9, open: [2], reject: [] },
    ];
    const l = riskLevers(risk, sc, held);
    expect(kinds(l)).toEqual(['urgent', 'batch', 'lab', 'later:sales', 'later:sop']);
    expect(l[0]).toEqual({ k: 'urgent', recipe: RCP, sku: N20, seat: 'production' });
    expect(l[1]).toEqual({ k: 'batch', unit: 7, code: 'PA0070927', seat: 'quality' });
    // ящиков на решении нет — «Поднять» не нужно
    expect(kinds(riskLevers({ ...risk, pending: 0 }, sc, []))).toEqual(['urgent', 'later:sales', 'later:sop']);
  });

  test('отклонение: оценить в карточке, а с расследованием — его доска; будут классификация и CAPA', () => {
    expect(devLevers({ dev: 3 })).toEqual([{ k: 'dev', n: 3, seat: 'quality' }, { k: 'later', what: 'capa' }]);
    expect(devLevers({ dev: 3, inv: 'I1' })[0]).toEqual({ k: 'inv', id: 'I1', seat: 'quality' });
    expect(heldLevers({ code: 'PA0070927', sku: N20, unit: 7, open: [1], reject: [] })).toEqual([{ k: 'batch', unit: 7, code: 'PA0070927', seat: 'quality' }]);
  });
});

describe('карточка отклонения', () => {
  // серия, опудривание которой вышло за диапазон: лаборатория решила балк
  const s = newPlant(bare, { scenario: SC });
  apply(bare, s, { kind: 'seat', seats: ['production', 'quality'] });
  const b = order(s);
  live(s, 12, () => b.bulk !== undefined && s.lots[b.bulk].status === 'released');
  const rec = b.records.find(r => r.stage === 'blend')!;
  rec.params.lubeTime = 8 * 60;
  s.deviations.D900 = { id: 'D900', opened: rec.end, kind: 'param', batch: b.id, stage: 'blend', param: 'lubeTime', status: 'open' };

  test('режим из досье, цель и диапазон по карте; кто и на чём; связанные испытания готовы; можно «без влияния»', () => {
    const c = devCard(bare, s, 900)!;
    const st = bare.recipes[b.recipe].stages.find(x => x.id === 'blend')!;
    const p = st.params.find(x => x.id === 'lubeTime')!;
    expect(c.param).toEqual({ id: 'lubeTime', unit: 'min', value: 8 * 60, target: p.target, range: p.range });
    expect(c.batch).toMatchObject({ status: b.status, held: false });
    expect(c.equipment.length).toBeGreaterThan(0);
    expect(c.people.length).toBeGreaterThan(0);
    expect(c.linked.map(x => x.test)).toContain('test.dissolution');
    expect(c.linked.every(x => x.done)).toBe(true);
    expect(c.block).toBeUndefined();
    expect(c.none).toBeUndefined();
    expect(c.due).toBe(rec.end + bare.scenarios[SC].deviations.term * DAY);
  });

  test('без истины: полей истины нет; заводы, у которых различаются только скрытые поля, дают один вид', () => {
    const json = JSON.stringify(cardView(bare, s, { kind: 'dev', n: 900 }));
    for (const k of ['truth', 'causes', 'noise', 'budget', 'fired', 'root']) expect(json.includes(`"${k}"`)).toBe(false);
    const o: PlantState = structuredClone(s);
    for (const lot of Object.values(o.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
    for (const x of Object.values(o.batches)) {
      for (const k of Object.keys(x.truth) as (keyof typeof x.truth)[]) x.truth[k] = (x.truth[k] ?? 0) + 777;
      x.causes = [{ cause: 'cause.blend.lube', attr: 'dissolution', delta: -999, stage: 'blend' }];
    }
    expect(JSON.stringify(cardView(bare, o, { kind: 'dev', n: 900 }))).toBe(json);
  });

  test('связанное испытание вне пределов — «без влияния» нельзя, называется испытание; нет отклонения — карточки нет', () => {
    const pt = b.records.find(r => r.stage === 'compress')!.ipc.find(x => x.test === 'test.ipc.hardness')!;
    pt.pass = false;
    expect(devCard(bare, s, 900)!.none).toEqual({ why: 'outOfSpec', test: 'test.ipc.hardness' });
    pt.pass = true;
    expect(cardView(bare, s, { kind: 'dev', n: 999 }).card).toEqual({ kind: 'gone' });
  });

  test('режимы в карточке помещения: после стадии — факт по досье, вне диапазона — с отклонением', () => {
    const g = regimesAt(bare, s, rec.room)!;
    expect(g.now).toBe(false);
    expect(g.stage).toBe('blend');
    expect(g.list.find(x => x.id === 'lubeTime')).toMatchObject({ value: 8 * 60, dev: 900 });
  });

  test('решение по серии: условия выпуска; неоценённое отклонение — номером', () => {
    live(s, 10, () => b.status === 'fg');
    const r = releaseOf(s, b);
    expect(r).toMatchObject({ batch: b.id, tests: true, open: [900], reject: [] });
    expect(r.recon).toBeUndefined();
  });

  test('ключи видов — только описанные', () => {
    const views = [devCard(bare, s, 900), releaseOf(s, b), regimesAt(bare, s, rec.room)];
    expect(views.every(x => x !== undefined)).toBe(true);
    expect([...keysOf(views)].filter(k => !ALLOWED.has(k))).toEqual([]);
  });
});

describe('планёрка: что ждёт решения', () => {
  test('неоценённые отклонения со сроком и удержанные серии с первой паллетой; политика отделов', () => {
    const s = newPlant(bare, { scenario: SC });
    apply(bare, s, { kind: 'seat', seats: ['production', 'quality'] });
    const b = order(s);
    live(s, 12, () => b.status === 'fg');
    s.deviations.D900 = { id: 'D900', opened: s.t, kind: 'ipc', batch: b.id, stage: 'compress', test: 'test.ipc.mass', status: 'open' };
    live(s, 5, () => b.held === true);
    const v = morningView(bare, s, { view: 'morning', day: momentOf(s.start, s.t).day });
    expect(v.pending).toEqual([{ dev: 900, kind: 'ipc', batch: expect.any(String), opened: s.deviations.D900.opened, due: s.deviations.D900.opened + 30 * DAY }]);
    expect(v.held).toEqual([{ code: expect.any(String), sku: N20, unit: expect.any(Number), open: [900], reject: [] }]);
    expect(v.policy).toEqual(s.policy);
    expect([...keysOf([v.pending, v.held])].filter(k => !ALLOWED.has(k))).toEqual([]);
    // карточка первой паллеты ГП — решение по серии, держат
    const card = cardView(bare, s, { kind: 'unit', n: v.held[0].unit! }).card;
    expect(card.kind === 'unit' && card.release?.held).toBe(true);
  });
});

describe('пояснение при первом событии', () => {
  test('вид — по карточке: отклонение по виду, ГП удержанной серии; понятые помнит окно, сломанное хранилище — ничего', () => {
    expect(firstOf({ kind: 'gone' })).toBeUndefined();
    const mem = new Map<string, string>();
    const keep = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    keepFirsts(keep, ['dev:param', 'held']);
    expect(keptFirsts(keep)).toEqual(['dev:param', 'held']);
    mem.set('pharma.firsts', '{oops');
    expect(keptFirsts(keep)).toEqual([]);
    expect(keptFirsts(undefined)).toEqual([]);
  });
});
