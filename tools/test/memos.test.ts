// Служебные записки и «Просят решить» (Б5д; docs/specs/2026-10-vertical-slice.md, «Б5д», «Проверки Б5д»): записка о
// команде чужого отдела — руководителю отдела, ответ в его час, запись «по записке», отказ с причиной движка, отзыв; о
// решениях ООК, политиках и своём — отказ. Вопрос — посту развилки или директору; не ответили — руководитель решает сам;
// ответ — команда руководителя от игрока; закрытый вопрос и чужой пост — отказ. Мест нет — ни записок, ни вопросов.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { visitLast } from '../../src/engine/assets';
import { addWorkdays, DAY, HOUR, isWorkday, MIN, momentOf } from '../../src/engine/core/calendar';
import { apply, catchUp, type More, newPlant } from '../../src/engine/engine';
import { ASK_WAIT } from '../../src/engine/forks';
import { check } from '../../src/engine/invariants';
import { MEMO_AFTER, memoAt, onDuty } from '../../src/engine/memos';
import { fromSave, toSave } from '../../src/engine/save';
import type { Command, Decision, Notice, PlantState } from '../../src/engine/types';
import { calOf } from '../../src/engine/workdays';

const SC = 'scn.proto';
const fresh = (): PlantState => newPlant(db, { scenario: SC });
const refusals = (n: Notice[]) => n.flatMap(x => (x.kind === 'refused' ? [[x.why, x.detail]] : []));
const memos = (s: PlantState) => s.journal.filter(r => r.memo);
const forks = (s: PlantState) => s.journal.filter(r => r.d.kind === 'fork');
const rec = (s: PlantState, n: number) => s.journal.find(r => r.n === n)!;
const copy = (s: PlantState) => fromSave(db, toSave(s));
const PRESS = 'press-1/punches';
const punches: Command = { kind: 'maintain', machine: 'press-1', part: 'punches' };

/** Пост «Производство» с отделами «сам» — завод живёт, как без мест. */
function production(seats: ('production' | 'director')[] = ['production']): PlantState {
  const s = fresh();
  apply(db, s, { kind: 'seat', seats });
  for (const head of ['plan', 'mes', 'maint'] as const) apply(db, s, { kind: 'mode', head, mode: 'auto' });
  return s;
}

/** Жить до извещения `kind` (не дальше `end`): мир встаёт на нём, доживание брошено — как у автопаузы окна. */
function until<K extends Notice['kind']>(s: PlantState, kind: K, end: number): Extract<Notice, { kind: K }> | undefined {
  const stop: More = list => !list.some(n => n.kind === kind);
  while (s.t < end) {
    const out = s.until !== undefined ? catchUp(db, s, stop) : apply(db, s, { kind: 'advance', seconds: end - s.t }, stop);
    const got = out.find((n): n is Extract<Notice, { kind: K }> => n.kind === kind);
    if (got) {
      delete s.until;
      return got;
    }
  }
  return undefined;
}

describe('мест не выбрано', () => {
  test('ни записок, ни вопросов: OOS и замена пуансонов проходят без записей развилок', () => {
    const s = fresh();
    // записка без мест — всё своё
    expect(refusals(apply(db, s, { kind: 'memo', cmds: [punches] }))).toEqual([['memoOwn', 'maintain']]);
    apply(db, s, { kind: 'advance', seconds: 11 * DAY });
    expect(Object.keys(s.investigations).length).toBeGreaterThan(0);
    expect(memos(s)).toEqual([]);
    expect(forks(s)).toEqual([]);
    expect(s.heads.memos).toBeUndefined();
    expect(s.heads.qs).toBeUndefined();
    expect(s.heads.asked).toBeUndefined();
  });
});

describe('служебная записка', () => {
  test('отказы: пустая, своя, решение ООК по процедуре, политика и режим, разным руководителям', () => {
    const q = fresh();
    apply(db, q, { kind: 'seat', seats: ['quality'] });
    expect(refusals(apply(db, q, { kind: 'memo', cmds: [] }))).toEqual([['empty', undefined]]);
    expect(refusals(apply(db, q, { kind: 'memo', cmds: [{ kind: 'rush', lot: 'L1' }] }))).toEqual([['memoOwn', 'rush']]);
    expect(refusals(apply(db, q, { kind: 'memo', cmds: [{ kind: 'release', batch: 'B1', decision: 'release' }] }))).toEqual([['memoOwn', 'release']]);
    // о режиме и политике отдела производства, о сверхурочных — не пишут
    expect(refusals(apply(db, q, { kind: 'memo', cmds: [{ kind: 'mode', head: 'maint', mode: 'manual' }] }))).toEqual([['memoNo', 'mode']]);
    expect(refusals(apply(db, q, { kind: 'memo', cmds: [{ kind: 'policy', policy: 'pol.plan.cover', value: 28 }] }))).toEqual([['memoNo', 'policy']]);
    expect(refusals(apply(db, q, { kind: 'memo', cmds: [{ kind: 'overtime', dept: 'mes', mode: 'finish' }] }))).toEqual([['memoNo', 'overtime']]);
    // замена узла — главному механику, задание на серию — начальнику планирования: одной запиской нельзя
    expect(refusals(apply(db, q, { kind: 'memo', cmds: [punches, { kind: 'shift', batch: 'B1', notBefore: DAY }] }))).toEqual([['memoMix', 'shift']]);
    const p = fresh();
    apply(db, p, { kind: 'seat', seats: ['production'] });
    for (const c of [
      { kind: 'release', batch: 'B1', decision: 'release' },
      { kind: 'assess', deviation: 'D1', verdict: 'none' },
      { kind: 'investigate', inv: 'I1', step: 'records' },
      { kind: 'conclude', inv: 'I1', cause: 'lab', fate: 'release' },
    ] as Command[])
      expect(refusals(apply(db, p, { kind: 'memo', cmds: [c] }))).toEqual([['memoQa', c.kind]]);
    expect(memos(q)).toEqual([]);
    expect(memos(p)).toEqual([]);
  });

  test('ответ — в час руководителя: запись главного механика «по записке», в записке — её номер', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    // сам — чужой пост
    expect(refusals(apply(db, s, punches))).toEqual([['notYours', 'production']]);
    const at = memoAt(db, s, 'maint')!;
    // старт в 07:00, до смены главного механика: ответ — через час после её начала
    const shift = Math.floor(at / HOUR) * HOUR - MEMO_AFTER;
    expect(momentOf(s.start, s.t).sec).toBe(7 * HOUR);
    expect(onDuty(db, s, 'maint', s.t)).toBeUndefined();
    expect(onDuty(db, s, 'maint', shift)).toBeDefined();
    expect(onDuty(db, s, 'maint', shift - MIN)).toBeUndefined();
    expect(at).toBe(shift + MEMO_AFTER);
    const out = apply(db, s, { kind: 'memo', cmds: [{ ...punches, by: 'player' } as Command] });
    const n = (out[0] as Extract<Notice, { kind: 'memo' }>).n;
    expect(out).toEqual([{ kind: 'memo', n, head: 'maint', at }]);
    // запись «вы» с местом, команды — без автора; ответ ещё не назначен — назначит час его прихода
    expect(rec(s, n)).toMatchObject({ by: 'player', seat: 'quality', d: { kind: 'memo', to: 'maint', cmds: [punches] }, memo: { v: 0 } });
    expect(rec(s, n).memo!.due).toBeUndefined();
    expect(s.heads.memos).toEqual([n]);
    apply(db, s, { kind: 'advance', seconds: shift - s.t });
    expect(rec(s, n).memo).toMatchObject({ v: 1, due: at });
    // до часа ответа — ничего
    expect(apply(db, s, { kind: 'advance', seconds: at - MIN - s.t }).filter(x => x.kind === 'memoDone')).toEqual([]);
    expect(s.parts[PRESS].plan).toBeUndefined();
    const done = apply(db, s, { kind: 'advance', seconds: MIN }).filter(x => x.kind === 'memoDone');
    expect(done).toEqual([{ kind: 'memoDone', n, head: 'maint', seat: 'quality', ok: 1, of: 1 }]);
    // сравнения без expect.any: toMatchObject у Bun 1.3.11 подменяет им поля проверяемого объекта
    const end = rec(s, n).memo!.end!;
    const by = (end.res![0] as { n: number }).n;
    expect(end).toEqual({ t: at, res: [{ n: by }], p: end.p! });
    expect(end.p).toBeDefined();
    const head = rec(s, by);
    expect(head).toMatchObject({ by: 'maint', via: n, p: end.p!, d: { kind: 'replace', part: PRESS } });
    expect(s.parts[PRESS].plan).toBe('player');
    expect(s.heads.memos).toBeUndefined();
    // отозвать отвеченную нельзя
    expect(refusals(apply(db, s, { kind: 'withdraw', n }))).toEqual([['memoDone', String(n)]]);
    expect(check(db, s)).toEqual([]);
  });

  test('не прошла — отказ с причиной движка, той же, что на посту; отозванная — без ответа', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    const at = memoAt(db, s, 'maint')!;
    // та же замена дважды: вторая — «узел уже в работе», как у поста «Производство»
    const post = copy(s);
    apply(db, post, { kind: 'seat', seats: ['production'] });
    apply(db, post, punches);
    const again = refusals(apply(db, post, punches));
    expect(again).toEqual([['busy', PRESS]]);
    const n = (apply(db, s, { kind: 'memo', cmds: [punches, punches] })[0] as Extract<Notice, { kind: 'memo' }>).n;
    // вторую — отозвать до ответа
    const m = (apply(db, s, { kind: 'memo', cmds: [{ kind: 'po', supplier: 'sup.api', lines: [] }] })[0] as Extract<Notice, { kind: 'memo' }>).n;
    expect(rec(s, m).d).toMatchObject({ kind: 'memo', to: 'supply' });
    expect(refusals(apply(db, s, { kind: 'withdraw', n: m }))).toEqual([]);
    expect(rec(s, m).memo!.end).toEqual({ t: s.t, off: true });
    expect(refusals(apply(db, s, { kind: 'withdraw', n: m }))).toEqual([['memoDone', String(m)]]);
    expect(refusals(apply(db, s, { kind: 'withdraw', n: 999_999 }))).toEqual([['noMemo', '999999']]);
    const got = apply(db, s, { kind: 'advance', seconds: at + DAY - s.t });
    const res = rec(s, n).memo!.end!.res!;
    // запись не записки — тоже «записки нет»
    const other = s.journal.find(r => !r.memo)!.n;
    expect(refusals(apply(db, s, { kind: 'withdraw', n: other }))).toEqual([['noMemo', String(other)]]);
    expect(got.filter(x => x.kind === 'memoDone')).toEqual([{ kind: 'memoDone', n, head: 'maint', seat: 'quality', ok: 1, of: 2 }]);
    expect(typeof (res[0] as { n: number }).n).toBe('number');
    expect(res.slice(1) as unknown).toEqual([{ why: again[0][0], detail: again[0][1] }]);
    // отозванная так и осталась без ответа, у руководителя снабжения записей «по записке» нет
    expect(rec(s, m).memo!.end).toEqual({ t: rec(s, m).memo!.end!.t, off: true });
    expect(s.journal.filter(r => r.via === m)).toEqual([]);
    expect(s.journal.filter(r => r.via === n)).toHaveLength(1);
  });

  test('сохранение посреди записки: ответ после загрузки тот же', () => {
    const s = fresh();
    apply(db, s, { kind: 'seat', seats: ['quality'] });
    const n = (apply(db, s, { kind: 'memo', cmds: [punches] })[0] as Extract<Notice, { kind: 'memo' }>).n;
    apply(db, s, { kind: 'advance', seconds: 2 * HOUR });
    const t = copy(s);
    const a = apply(db, s, { kind: 'advance', seconds: DAY }).filter(x => x.kind === 'memoDone');
    const b = apply(db, t, { kind: 'advance', seconds: DAY }).filter(x => x.kind === 'memoDone');
    expect(b).toEqual(a);
    expect(rec(t, n).memo).toEqual(rec(s, n).memo!);
  });
});

describe('«Просят решить»', () => {
  test('OOS — директору; чужой пост, вариант и закрытый — отказ; «Веду сам» — шагов ООК нет; без ответа — решил сам', () => {
    const s = production(['production', 'director']);
    const ask = until(s, 'ask', 12 * DAY)!;
    expect(ask).toMatchObject({ kind: 'ask', fork: 'oos', head: 'qa', seat: 'director' });
    const r = rec(s, ask.n);
    const inv = (r.d as Extract<Decision['d'], { kind: 'fork'; fork: 'oos' }>).inv;
    expect(r).toMatchObject({ by: 'qa', d: { kind: 'fork', fork: 'oos', inv }, q: { key: `oos/${inv}`, to: 'director', due: r.t + ASK_WAIT, v: 1 } });
    expect((r.d as { threshold: number }).threshold).toBeGreaterThan(0);
    expect(s.heads.qs).toEqual({ [`oos/${inv}`]: ask.n });
    // без ответа — через срок §29.4 «решил сам»: ООК ведёт
    const left = copy(s);
    apply(db, left, { kind: 'advance', seconds: ASK_WAIT });
    expect(rec(left, ask.n).q!.end).toEqual({ how: 'self', opt: 'lead', t: r.t + ASK_WAIT });
    expect(left.heads.qs).toBeUndefined();
    // отказы: вопроса нет, такого варианта нет, чужой пост
    expect(refusals(apply(db, s, { kind: 'answer', n: 999_999, opt: 'self' }))).toEqual([['noQ', '999999']]);
    expect(refusals(apply(db, s, { kind: 'answer', n: ask.n, opt: 'now' }))).toEqual([['qOpt', String(ask.n)]]);
    apply(db, s, { kind: 'seat', seats: ['production'] });
    expect(refusals(apply(db, s, { kind: 'answer', n: ask.n, opt: 'self' }))).toEqual([['notYours', 'director']]);
    apply(db, s, { kind: 'seat', seats: ['production', 'director'] });
    // «Веду сам»
    const runs = s.investigations[inv].runs.length;
    expect(refusals(apply(db, s, { kind: 'answer', n: ask.n, opt: 'self' }))).toEqual([]);
    expect(s.investigations[inv].lead).toBe('player');
    expect(rec(s, ask.n).q!.end).toEqual({ how: 'player', opt: 'self', t: s.t, seat: 'director' });
    expect(refusals(apply(db, s, { kind: 'answer', n: ask.n, opt: 'lead' }))).toEqual([['qDone', String(ask.n)]]);
    apply(db, s, { kind: 'advance', seconds: DAY });
    expect(s.investigations[inv].runs.length).toBe(runs);
    expect(s.investigations[inv].status).toBe('open');
    // а у оставленного без ответа ООК ведёт сам
    apply(db, left, { kind: 'advance', seconds: DAY });
    expect(left.investigations[inv].runs.length).toBeGreaterThan(runs);
    // игрок отпустил и директора — ведёт снова ООК
    apply(db, s, { kind: 'seat', seats: ['production'] });
    apply(db, s, { kind: 'advance', seconds: DAY });
    expect(s.investigations[inv].runs.length).toBeGreaterThan(runs);
    expect(check(db, s)).toEqual([]);
  });

  test('спрашивают только пост развилки или директора: у «Производства» без директора OOS — развилка в причине', () => {
    const s = production();
    apply(db, s, { kind: 'advance', seconds: 8 * DAY });
    const oos = forks(s).filter(r => r.d.kind === 'fork' && r.d.fork === 'oos');
    expect(oos).toHaveLength(1);
    const inv = (oos[0].d as { inv: string }).inv;
    expect(oos[0].q).toEqual({ key: `oos/${inv}`, v: 0, end: { how: 'self', opt: 'lead', t: oos[0].t } });
    expect(s.heads.qs).toBeUndefined();
    // у «Качества» OOS свой — развилки нет
    const q = fresh();
    apply(db, q, { kind: 'seat', seats: ['quality'] });
    apply(db, q, { kind: 'advance', seconds: 8 * DAY });
    expect(forks(q).filter(r => r.d.kind === 'fork' && r.d.fork === 'oos')).toEqual([]);
  });

  test('замена перед работой — «Производству» в смену главного механика; «Заменить сейчас» — команда maintain', () => {
    const s = production();
    const ask = until(s, 'ask', 14 * DAY)!;
    expect(ask).toMatchObject({ kind: 'ask', fork: 'replace', head: 'maint', seat: 'production' });
    const r = rec(s, ask.n);
    const d = r.d as Extract<Decision['d'], { kind: 'fork'; fork: 'replace' }>;
    // цены — знание завода: износ сейчас и после работы по норме, порог политики, таблица отказов и время ремонта
    expect(d.part).toBe(PRESS);
    expect(d.at).toBe(10_000);
    expect(d.repair[0]).toBeLessThan(d.repair[1]);
    expect(d.replace).toBeGreaterThan(0);
    expect(d.wear).toBeLessThan(d.at);
    expect(d.after).toBeGreaterThanOrEqual(d.at);
    expect(d.hz).toBeGreaterThan(0);
    expect(r.p).toBeDefined();
    expect(onDuty(db, s, 'maint', r.t)).toEqual({ p: r.p });
    expect(refusals(apply(db, s, { kind: 'answer', n: ask.n, opt: 'now' }))).toEqual([]);
    expect(s.parts[PRESS].plan).toBe('player');
    expect(rec(s, ask.n).q!.end).toEqual({ how: 'player', opt: 'now', t: s.t, seat: 'production' });
    expect(s.journal.find(x => x.by === 'player' && x.d.kind === 'replace')).toMatchObject({ seat: 'production', d: { part: PRESS } });
    expect(check(db, s)).toEqual([]);
  });

  test('визит держит серию: «Производству» с ценой подрядчика; «Перенести визит» — серия идёт; не тот день — отказ', () => {
    const s = production();
    // первое задание на упаковку с комплектом у линии; у картонажной — визит подрядчика с этого мгновения
    const end = 10 * DAY;
    while (s.t < end && !Object.values(s.batches).some(b => b.pack?.state === 'ready')) apply(db, s, { kind: 'advance', seconds: 10 * MIN });
    const b = Object.values(s.batches).find(x => x.pack?.state === 'ready')!;
    const now = momentOf(s.start, s.t);
    expect(now.sec).toBeGreaterThan(9 * HOUR);
    const a = s.assets['cartoner-1'];
    const was = s.t;
    a.visit = { work: 'qual', at: was, booked: was, v: 0 };
    const ask = until(s, 'ask', s.t + HOUR)!;
    expect(ask).toMatchObject({ kind: 'ask', fork: 'visit', head: 'maint', seat: 'production' });
    const d = rec(s, ask.n).d as Extract<Decision['d'], { kind: 'fork'; fork: 'visit' }>;
    // работа класса не влезает в часы подрядчика сегодня — завтра с начала его часов
    const cal = calOf(db, s);
    const next = addWorkdays(cal, now.day, 1);
    const [open] = db.scenarios[SC].assets.hours;
    const z0 = momentOf(s.start, 0).day;
    expect(d).toMatchObject({ asset: 'cartoner-1', work: 'qual', batches: [b.id], start: (next - z0) * DAY + open, last: visitLast(a, now.day) });
    expect(d.end).toBeGreaterThan(d.start);
    expect(s.batches[b.id].phase).toBe('asset');
    // день вне записи — отказ движка, вопрос открыт
    expect(refusals(apply(db, s, { kind: 'answer', n: ask.n, opt: 'move', day: d.last + 1 }))).toEqual([['visitDay', 'cartoner-1']]);
    expect(rec(s, ask.n).q!.end).toBeUndefined();
    let day = addWorkdays(cal, next, 1);
    while (!isWorkday(cal, day)) day++;
    expect(refusals(apply(db, s, { kind: 'answer', n: ask.n, opt: 'move', day }))).toEqual([]);
    expect(rec(s, ask.n).q!.end).toEqual({ how: 'player', opt: 'move', t: s.t, seat: 'production', day });
    expect(a.visit!.at).toBe((day - z0) * DAY + open);
    apply(db, s, { kind: 'advance', seconds: HOUR });
    expect(s.batches[b.id].phase).not.toBe('asset');
    // спросили о визите этого мгновения: о нём не спросят снова, о перенесённом — спросят, если серия снова его ждёт
    expect(s.heads.asked?.['visit/cartoner-1']).toBe(String(was));
    expect(s.heads.qs).toBeUndefined();
    expect(check(db, s)).toEqual([]);
  });
});

describe('сохранения', () => {
  test('образец схемы 36 читается: записок и вопросов нет, у расследований никто не ведёт сам', async () => {
    const s = fromSave(db, await Bun.file(new URL('./fixtures/save-v36.json', import.meta.url)).text());
    expect(s.heads.memos).toBeUndefined();
    expect(s.heads.qs).toBeUndefined();
    expect(s.heads.asked).toBeUndefined();
    expect(s.journal.filter(r => r.memo || r.q)).toEqual([]);
    for (const inv of Object.values(s.investigations)) expect(inv.lead).toBeUndefined();
    apply(db, s, { kind: 'advance', seconds: DAY });
    expect(check(db, s)).toEqual([]);
  });
});
