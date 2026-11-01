// Режимы отделов (Б5б; docs/specs/2026-10-vertical-slice.md, «Б5б», «Проверки Б5б»): «сам», «советует», «вручную»;
// предложения в журнале, «Принять» и «Отклонить», «устарело» и «не нужно», пост отпущен, команда `mode`, прогон плана.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, HOUR, isWorkday, MIN, momentOf } from '../../src/engine/core/calendar';
import { apply, catchUp, type More, newPlant } from '../../src/engine/engine';
import { MODED, modeOf } from '../../src/engine/heads';
import { check } from '../../src/engine/invariants';
import { BATCH_HOUR } from '../../src/engine/mes';
import { runHeads } from '../../src/engine/plan/run';
import { ORDER_KEY } from '../../src/engine/planner';
import { fromSave, toSave } from '../../src/engine/save';
import type { Decision, Notice, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';

const SC = 'scn.proto';
const fresh = (): PlantState => newPlant(db, { scenario: SC });
const refusals = (n: Notice[]) => n.flatMap(x => (x.kind === 'refused' ? [[x.why, x.detail]] : []));
const asks = (s: PlantState) => s.journal.filter(r => r.ask);
const open = (s: PlantState) => asks(s).filter(r => !r.ask!.end);
/** Ближайшее мгновение `sec` рабочего дня после нынешнего. */
function nextWork(s: PlantState, sec: number): number {
  const cal = calOf(db, s);
  let t = Math.floor(s.t / DAY) * DAY + sec;
  if (t <= s.t) t += DAY;
  while (!isWorkday(cal, momentOf(s.start, t).day)) t += DAY;
  return t;
}
const until = (s: PlantState, t: number) => apply(db, s, { kind: 'advance', seconds: t - s.t });

/** Жить до `end`, принимая каждое предложение в ту же минуту, когда оно появилось. */
function liveAccepting(s: PlantState, end: number) {
  const stop: More = list => !list.some(n => n.kind === 'proposal');
  let accepted = 0;
  while (s.t < end || s.until !== undefined) {
    const out = s.until !== undefined ? catchUp(db, s, stop) : apply(db, s, { kind: 'advance', seconds: end - s.t }, stop);
    const got = out.filter((n): n is Extract<Notice, { kind: 'proposal' }> => n.kind === 'proposal');
    if (got.length === 0) continue;
    const rest = s.until;
    delete s.until;
    for (const a of got) {
      expect(refusals(apply(db, s, { kind: 'accept', n: a.n }))).toEqual([]);
      accepted++;
    }
    if (rest !== undefined) s.until = rest;
  }
  return accepted;
}

/** То, по чему судят «тот же год»: касса, серии, заказы, заказы поставщикам, люди, журнал оборудования и решений. */
const life = (s: PlantState) => ({
  cash: s.cash.balance,
  batches: Object.values(s.batches).map(b => [b.id, b.status, b.recipe, b.sku, b.notBefore, b.code]),
  orders: Object.values(s.orders).map(o => [o.id, o.status]),
  pos: Object.values(s.pos).map(p => [p.id, p.supplier, p.status, p.eta, p.lines.map(l => [l.material, l.qty])]),
  people: Object.values(s.people).map(p => [p.id, p.role, p.shift]),
  vacancies: Object.values(s.vacancies).map(v => [v.id, v.role, v.via, v.by, v.instead]),
  maint: s.maintLog.map(e => [e.t, e.machine, e.part, e.what]),
  journal: s.journal.map(({ n, t, by, d }) => ({ n, t, by, d })),
});

describe('режим по умолчанию', () => {
  test('мест не выбрано — у всех «сам»; пост взят — его отделы «советует», прочие «сам»; директор — «сам»', () => {
    const s = fresh();
    for (const h of MODED) expect(modeOf(s, h)).toBe('auto');
    apply(db, s, { kind: 'seat', seats: ['production'] });
    expect(MODED.map(h => modeOf(s, h))).toEqual(['advise', 'advise', 'advise', 'auto', 'auto', 'auto', 'auto']);
    apply(db, s, { kind: 'seat', seats: ['director'] });
    for (const h of MODED) expect(modeOf(s, h)).toBe('auto');
    // руководители без выборов — всегда «сам»
    for (const h of ['qp', 'tech', 'sales', 'hr'] as const) expect(modeOf(s, h)).toBe('auto');
  });

  test('выбор игрока помнится: снова взяв пост, игрок получает свои режимы; у директора — тоже его выбор', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    expect(refusals(apply(db, s, { kind: 'mode', head: 'maint', mode: 'auto' }))).toEqual([]);
    expect(s.journal.at(-1)).toMatchObject({ by: 'player', seat: 'production', d: { kind: 'mode', head: 'maint', mode: 'auto' } });
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    expect(modeOf(s, 'maint')).toBe('auto');
    apply(db, s, { kind: 'seat', seats: ['production'] });
    expect([modeOf(s, 'plan'), modeOf(s, 'maint')]).toEqual(['advise', 'auto']);
    apply(db, s, { kind: 'seat', seats: ['director'] });
    expect(refusals(apply(db, s, { kind: 'mode', head: 'supply', mode: 'manual' }))).toEqual([]);
    expect([modeOf(s, 'supply'), modeOf(s, 'maint'), modeOf(s, 'plan')]).toEqual(['manual', 'auto', 'auto']);
  });

  test('команда `mode`: отказы — руководитель без выборов, нет такого режима, тот же выбор; чужой пост — не своё', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['director'] });
    expect(refusals(apply(db, s, { kind: 'mode', head: 'qp', mode: 'manual' }))).toEqual([['noDept', 'qp']]);
    apply(db, s, { kind: 'seat', seats: ['production'] });
    expect(refusals(apply(db, s, { kind: 'mode', head: 'plan', mode: 'often' as never }))).toEqual([['noDept', 'plan']]);
    apply(db, s, { kind: 'mode', head: 'plan', mode: 'manual' });
    expect(refusals(apply(db, s, { kind: 'mode', head: 'plan', mode: 'manual' }))).toEqual([['same', 'plan']]);
    expect(refusals(apply(db, s, { kind: 'mode', head: 'supply', mode: 'manual' }))).toEqual([['notYours', 'supply']]);
  });
});

describe('«советует»', () => {
  test('пост «Производство» и каждое предложение принято в ту же минуту — те же 90 суток, что «сам», до копейки', () => {
    const a = fresh();
    const end = a.t + 90 * DAY;
    apply(db, a, { kind: 'advance', seconds: end - a.t });
    const b = fresh();
    apply(db, b, { kind: 'seat', seats: ['production'] });
    const n = liveAccepting(b, end);
    // задания на серию, замена узла по наработке, вакансия и приём — все предложены и приняты
    const kinds = new Set(asks(b).map(r => r.d.kind));
    expect([...kinds].sort()).toEqual(['hire', 'order', 'replace', 'vacancy']);
    expect(asks(b).every(r => r.ask!.end?.how === 'ok' && r.ask!.end.seat === 'production')).toBe(true);
    expect(asks(b).length).toBe(n);
    // записи журнала — те же номера, мгновения, руководители и причины; номера вещей — те же
    expect(life(b)).toEqual(life(a));
    expect(check(db, b)).toEqual([]);
  }, 120_000);

  test('предложение — с той же причиной, что у решения «сам», без номеров вещей; командой становится, когда примут', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    const at = nextWork(s, BATCH_HOUR);
    const before = Object.keys(s.batches).length;
    const out = until(s, at + MIN);
    const r = open(s).find(x => x.ask!.key === ORDER_KEY)!;
    expect(r).toMatchObject({ by: 'plan', d: { kind: 'order' }, ask: { cmd: { kind: 'order' } } });
    expect(r.d.kind === 'order' && r.d.batch).toBeFalsy();
    expect(r.d.kind === 'order' && r.d.why?.rule).toBeTruthy();
    expect(out).toContainEqual({ kind: 'proposal', n: r.n, head: 'plan', seat: 'production', t: at });
    expect(Object.keys(s.batches).length).toBe(before);
    // «Принять» — задание; запись предложения — с номером задания и «принято вами»
    expect(refusals(apply(db, s, { kind: 'accept', n: r.n }))).toEqual([]);
    expect(Object.keys(s.batches).length).toBe(before + 1);
    expect(r.d.kind === 'order' && r.d.batch).toBe(`B${before + 1}`);
    expect(r.ask!.end).toEqual({ how: 'ok', t: s.t, seat: 'production' });
    // принятое — не дважды; чужой записи с предложением нет
    expect(refusals(apply(db, s, { kind: 'accept', n: r.n }))).toEqual([['askDone', String(r.n)]]);
    expect(refusals(apply(db, s, { kind: 'accept', n: 99_999 }))).toEqual([['noAsk', '99999']]);
  });

  test('«Отклонить» — команды нет; в следующий час руководителя — новое предложение, открытое старое «устарело»', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    until(s, nextWork(s, BATCH_HOUR) + MIN);
    const first = open(s).find(x => x.ask!.key === ORDER_KEY)!;
    const n = Object.keys(s.batches).length;
    expect(refusals(apply(db, s, { kind: 'decline', n: first.n }))).toEqual([]);
    expect(first.ask!.end).toMatchObject({ how: 'no', seat: 'production' });
    expect(Object.keys(s.batches).length).toBe(n);
    // следующий рабочий день — новое задание (другой день): предложение; без ответа его заменит третье — «устарело»
    until(s, nextWork(s, BATCH_HOUR) + MIN);
    const second = open(s).find(x => x.ask!.key === ORDER_KEY)!;
    expect(second.n).toBeGreaterThan(first.n);
    until(s, nextWork(s, BATCH_HOUR) + MIN);
    const third = open(s).find(x => x.ask!.key === ORDER_KEY)!;
    expect(third.n).toBeGreaterThan(second.n);
    expect(second.ask!.end).toMatchObject({ how: 'stale' });
    expect(refusals(apply(db, s, { kind: 'accept', n: second.n }))).toEqual([['askDone', String(second.n)]]);
    expect(open(s).filter(x => x.ask!.key === ORDER_KEY)).toHaveLength(1);
  });

  test('замена узла: отклонённую до следующих суток не предлагают снова; своё решение игрока — предложение «не нужно»', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    const key = 'replace/press-1/punches';
    // наработка пресса — выше порога политики сценария: в следующий час техслужбы пресс свободен — предложение
    s.parts['press-1/punches'].done *= 1000;
    const out = until(s, Math.floor(s.t / HOUR) * HOUR + HOUR + MIN);
    const r = open(s).find(x => x.ask!.key === key)!;
    expect(r).toMatchObject({ by: 'maint', d: { kind: 'replace', part: 'press-1/punches' }, ask: { cmd: { kind: 'maintain', machine: 'press-1', part: 'punches' } } });
    expect(r.d.kind === 'replace' && r.d.why!.wear).toBeGreaterThanOrEqual(r.d.kind === 'replace' ? r.d.why!.at : 0);
    expect(out.filter(n => n.kind === 'proposal')).toEqual([{ kind: 'proposal', n: r.n, head: 'maint', seat: 'production', t: r.t }]);
    expect(s.parts['press-1/punches'].plan).toBeUndefined();
    apply(db, s, { kind: 'decline', n: r.n });
    // до полуночи — не снова, хоть пресс и свободен
    const midnight = Math.floor(s.t / DAY) * DAY + DAY;
    until(s, midnight - MIN);
    expect(open(s).some(x => x.ask!.key === key)).toBe(false);
    // с новых суток — снова, как только пресс свободен
    let again: Decision | undefined;
    while (!again && s.t < midnight + 3 * DAY) {
      apply(db, s, { kind: 'advance', seconds: HOUR });
      again = open(s).find(x => x.ask!.key === key);
    }
    expect(again!.n).toBeGreaterThan(r.n);
    // игрок заменяет сам — правило больше не срабатывает: предложение «не нужно»
    expect(refusals(apply(db, s, { kind: 'maintain', machine: 'press-1', part: 'punches' }))).toEqual([]);
    expect(again!.ask!.end?.how).toBe('moot');
    expect(refusals(apply(db, s, { kind: 'accept', n: again!.n }))).toEqual([['askDone', String(again!.n)]]);
  });

  test('пост отпущен — режим «сам», открытые предложения «устарело»; руководитель решает в свой час', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    until(s, nextWork(s, BATCH_HOUR) + MIN);
    const r = open(s).find(x => x.ask!.key === ORDER_KEY)!;
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    expect(modeOf(s, 'plan')).toBe('auto');
    expect(r.ask!.end).toMatchObject({ how: 'stale' });
    const n = Object.keys(s.batches).length;
    until(s, nextWork(s, BATCH_HOUR) + MIN);
    expect(Object.keys(s.batches).length).toBe(n + 1);
    expect(s.journal.filter(x => x.by === 'plan' && !x.ask && x.d.kind === 'order').length).toBeGreaterThan(0);
  });

  test('смена режима на «сам» или «вручную» — открытые предложения руководителя «устарело»', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    until(s, nextWork(s, BATCH_HOUR) + MIN);
    const r = open(s).find(x => x.ask!.key === ORDER_KEY)!;
    apply(db, s, { kind: 'mode', head: 'plan', mode: 'manual' });
    expect(r.ask!.end).toMatchObject({ how: 'stale', t: s.t });
    expect(open(s)).toHaveLength(0);
  });

  test('решение ОКК, уполномоченного лица и ремонт после отказа — правилом в любом режиме', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['quality', 'production'] });
    apply(db, s, { kind: 'advance', seconds: 30 * DAY });
    const rule = (k: Decision['d']['kind']) => s.journal.filter(r => r.d.kind === k);
    expect(rule('lot').length).toBeGreaterThan(0);
    expect(rule('batch').length).toBeGreaterThan(0);
    expect([...rule('lot'), ...rule('batch'), ...rule('repair'), ...rule('spare'), ...rule('visit')].every(r => !r.ask && r.by !== 'player')).toBe(true);
  });
});

describe('«вручную»', () => {
  test('руководитель молчит: ни решений, ни предложений этого отдела', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    apply(db, s, { kind: 'mode', head: 'plan', mode: 'manual' });
    const n = Object.keys(s.batches).length;
    apply(db, s, { kind: 'advance', seconds: 10 * DAY });
    expect(Object.keys(s.batches).length).toBe(n);
    expect(s.journal.filter(r => r.by === 'plan')).toHaveLength(0);
  });

  test('снабжение «вручную» — заказов нет; «советует» — предложения тех же заказов, что «сам» в тот же час', () => {
    // пост «Снабжение и склад» сценарий прототипа не даёт: режим снабжения выбирает директор
    const auto = fresh();
    const advise = fresh();
    const manual = fresh();
    for (const s of [auto, advise, manual]) apply(db, s, { kind: 'seat', seats: ['director'] });
    expect(apply(db, advise, { kind: 'mode', head: 'supply', mode: 'advise' })).toEqual([]);
    expect(apply(db, manual, { kind: 'mode', head: 'supply', mode: 'manual' })).toEqual([]);
    const t = nextWork(auto, 9 * HOUR) + MIN;
    for (const s of [auto, advise, manual]) until(s, t);
    const placed = auto.journal.filter(r => r.by === 'supply' && r.d.kind === 'po');
    const asked = open(advise).filter(r => r.by === 'supply');
    expect(placed.length).toBeGreaterThan(0);
    const supplier = (r: Decision) => (r.d.kind === 'po' ? r.d.supplier : '');
    expect(asked.map(supplier)).toEqual(placed.map(supplier));
    expect(asked.map(r => r.d.kind === 'po' && r.d.why)).toEqual(placed.map(r => r.d.kind === 'po' && r.d.why));
    expect(asked.map(r => r.d.kind === 'po' && r.d.prepaid)).toEqual(placed.map(r => r.d.kind === 'po' && r.d.prepaid));
    expect(manual.journal.filter(r => r.by === 'supply')).toHaveLength(0);
    expect(Object.keys(manual.pos).length).toBe(Object.keys(advise.pos).length);
    // приняты — те же заказы, что «сам»: строки до целой тары, срок, предоплата
    const before = Object.keys(advise.pos).length;
    for (const r of asked) expect(refusals(apply(db, advise, { kind: 'accept', n: r.n }))).toEqual([]);
    const lines = (s: PlantState, ids: string[]) => ids.map(id => [s.pos[id].supplier, s.pos[id].eta, s.pos[id].prepaid, s.pos[id].lines.map(l => [l.material, l.qty, l.maker])]);
    expect(lines(advise, Object.keys(advise.pos).slice(before))).toEqual(lines(auto, placed.map(r => (r.d.kind === 'po' ? r.d.po! : ''))));
  });
});

describe('сохранение и прогон плана', () => {
  test('открытое предложение и выбор режимов переживают сохранение; «Принять» после загрузки — то же', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    apply(db, s, { kind: 'mode', head: 'maint', mode: 'manual' });
    until(s, nextWork(s, BATCH_HOUR) + MIN);
    const back = fromSave(db, toSave(s));
    expect(back.heads).toEqual(s.heads);
    const r = open(s).find(x => x.ask!.key === ORDER_KEY)!;
    apply(db, s, { kind: 'accept', n: r.n });
    apply(db, back, { kind: 'accept', n: r.n });
    expect(toSave(back)).toBe(toSave(s));
  });

  test('копия прогона плана: «советует» — «сам», «вручную» — как есть; предложений нет', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['production'] });
    apply(db, s, { kind: 'mode', head: 'maint', mode: 'manual' });
    until(s, nextWork(s, BATCH_HOUR) + MIN);
    const h = runHeads(s);
    expect(h.open).toEqual({});
    expect(h.mode).toEqual({ plan: 'auto', mes: 'auto', maint: 'manual' });
    const c = { ...s, heads: h };
    for (const x of MODED) expect(modeOf(c, x)).toBe(x === 'maint' ? 'manual' : 'auto');
  });
});
