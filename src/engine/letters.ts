// Письма сценария (Б9; docs/specs/2026-10-vertical-slice.md, «Б9»; геймдизайн, §17, §26.3): письмо приходит на старте,
// после другого письма, когда то кончилось, в час первого события вида или в день сценария к часу; показывает на вещь,
// которую движок находит в час прихода; кончается своим условием над записями завода или тем, что окно открыло его вещь
// (команда `letter` со словом `seen`), — и только им; письмо наставника можно пропустить. Кончилось — его отделы
// «советуют» (Б5б), письма после него приходят. Правило смотрит только открытые письма — их немного. Текст письма —
// шаблон окна по идентификатору, числа — из записей завода; истины в письмах нет.
import type { ContentDb, Id, Letter, LetterShows } from '../content/types';
import { schedule } from './core/agenda';
import { DAY } from './core/calendar';
import { staleAsks } from './heads';
import type { Command, LetterRec, Notice, PlantState } from './types';

const BY_SCN = new WeakMap<ContentDb['letters'], Map<Id, Letter[]>>();

/** Письма сценария по номеру. */
export function lettersOf(db: ContentDb, scenario: Id): readonly Letter[] {
  let m = BY_SCN.get(db.letters);
  if (!m) {
    m = new Map();
    for (const l of Object.values(db.letters).sort((a, b) => a.n - b.n)) {
      const list = m.get(l.scenario) ?? [];
      list.push(l);
      m.set(l.scenario, list);
    }
    BY_SCN.set(db.letters, m);
  }
  return m.get(scenario) ?? [];
}

/**
 * Письма на старте игрока, после прогрева: у сценария с письмами — список пришедших; письма старта — сразу, письма
 * дня — событием в свой час. `today` — полночь первого дня прогрева, `warm` — секунды прогрева.
 */
export function startLetters(db: ContentDb, s: PlantState, today: number, warm: number) {
  const all = lettersOf(db, s.scenario);
  if (all.length === 0) return;
  s.heads.letters = [];
  for (const l of all) {
    if ('start' in l.when) arrive(db, s, l, []);
    else if ('day' in l.when) {
      const at = today + warm + l.when.day * DAY + l.when.at;
      if (at >= s.t) schedule(s.agenda, at, { kind: 'letter', id: l.id });
    }
  }
}

const recOf = (s: PlantState, id: Id) => s.heads.letters?.find(r => r.id === id);

/** Письмо пришло: вещь — по `shows` в этот час (у письма события — вещь события); извещение. */
function arrive(db: ContentDb, s: PlantState, l: Letter, notices: Notice[], ev?: string) {
  if (!s.heads.letters || recOf(s, l.id)) return;
  const rec: LetterRec = { id: l.id, at: s.t };
  const thing = l.shows === 'event' ? ev : l.shows ? find(s, l.shows) : undefined;
  if (thing) rec.thing = thing;
  s.heads.letters.push(rec);
  notices.push({ kind: 'letter', id: l.id, from: l.from });
}

/** Письмо дня в свой час (событие `letter`). */
export function letterDue(db: ContentDb, s: PlantState, id: Id, notices: Notice[]) {
  const l = db.letters[id];
  if (l) arrive(db, s, l, notices);
}

/** Заказ поставщику сценария с часом: первый по прибытию. */
const scenarioPo = (s: PlantState) =>
  Object.values(s.pos)
    .filter(p => p.by === 'scenario' && p.status !== 'cancelled')
    .sort((a, b) => a.eta - b.eta || (a.id < b.id ? -1 : 1))[0]?.id;

const BEFORE_QA = ['fg', 'packing', 'bulk', 'process', 'kitting', 'reserved', 'waiting'];

/** Вещь письма по виду; нет такой вещи сейчас — нет (у условия о ней — найдётся позже). */
function find(s: PlantState, shows: LetterShows): string | undefined {
  switch (shows) {
    case 'scenarioPo':
      return scenarioPo(s);
    case 'poLot': {
      const po = scenarioPo(s);
      return po ? Object.values(s.lots).find(l => l.po === po)?.id : undefined;
    }
    case 'qaBatch': {
      const open = Object.values(s.batches).filter(b => b.decision === undefined && BEFORE_QA.includes(b.status));
      open.sort((a, b) => BEFORE_QA.indexOf(a.status) - BEFORE_QA.indexOf(b.status) || a.notBefore - b.notBefore);
      return open[0]?.id;
    }
    case 'playerBatch':
      return Object.values(s.batches)
        .filter(b => b.by === 'player' && b.status !== 'cancelled')
        .sort((a, b) => b.ordered - a.ordered)[0]?.id;
    case 'nextOrder':
      return Object.values(s.orders)
        .filter(o => o.status === 'open')
        .sort((a, b) => a.due - b.due || (a.id < b.id ? -1 : 1))[0]?.id;
    case 'event':
      return undefined;
  }
}

/** Кончилось ли письмо своим условием сейчас. */
function met(s: PlantState, l: Letter, r: LetterRec): boolean {
  // вещи ещё не было в час прихода — ищем её снова: условие о ней
  if (!r.thing && l.shows && l.shows !== 'event') {
    const t = find(s, l.shows);
    if (t) r.thing = t;
  }
  const id = r.thing;
  switch (l.done.kind) {
    case 'unloaded': {
      const po = id ? s.pos[id] : undefined;
      return !!po && po.status === 'arrived' && !Object.values(s.trucks).some(t => t.po === id);
    }
    case 'sampled': {
      const lot = id ? s.lots[id] : undefined;
      return !!lot && (lot.status !== 'quarantine' || (lot.sample !== undefined && s.samples[lot.sample]?.taken !== undefined));
    }
    case 'lotDecided': {
      const st = id ? s.lots[id]?.status : undefined;
      return st === 'released' || st === 'rejected';
    }
    case 'released': {
      const b = id ? s.batches[id] : undefined;
      return !!b && (b.decision !== undefined || b.status === 'released' || b.status === 'rejected');
    }
    case 'stageDone':
      return !!id && (s.batches[id]?.records.length ?? 0) > 0;
    case 'packed': {
      const b = id ? s.batches[id] : undefined;
      return !!b && (b.pack?.state === 'done' || b.status === 'fg' || b.status === 'released' || b.status === 'rejected');
    }
    case 'shipped':
      return Object.values(s.shipments).some(x => x.t >= r.at);
    case 'order':
      return Object.values(s.batches).some(b => b.by === 'player' && b.ordered >= r.at);
    case 'assessed': {
      const d = id ? s.deviations[id] : undefined;
      return !!d && d.status !== 'open';
    }
    case 'seen':
      return false;
  }
}

/** Письмо кончилось: как; отделы письма — «советуют», если игрок не выбрал им режим сам; письма после него приходят. */
function finish(db: ContentDb, s: PlantState, l: Letter, r: LetterRec, how: 'done' | 'skip', notices: Notice[]) {
  r.end = { t: s.t, how };
  give(s, l);
  for (const n of lettersOf(db, s.scenario)) if ('after' in n.when && n.when.after === l.id) arrive(db, s, n, notices);
}

function give(s: PlantState, l: Letter) {
  let changed = false;
  for (const h of l.gives ?? [])
    if (s.heads.mode[h] === undefined) {
      s.heads.mode[h] = 'advise';
      changed = true;
    }
  if (changed) staleAsks(s);
}

/** Вид первого события по извещению и его вещь. */
function firstOf(n: Notice): [Letter['when'] & { first: string }, string] | undefined {
  if (n.kind === 'deviation') return [{ first: n.what === 'oos' ? 'oos' : 'deviation' }, n.id];
  if (n.kind === 'orderRisk') return [{ first: 'risk' }, n.order];
  if (n.kind === 'poLate') return [{ first: 'late' }, n.po];
  return undefined;
}

/**
 * После события (и команды): извещения с `from` — письма первого события вида; затем условия открытых писем. Письма,
 * пришедшие сейчас, проверяются со следующим событием: игрок их увидит.
 */
export function lettersStep(db: ContentDb, s: PlantState, notices: Notice[], from: number) {
  const recs = s.heads.letters;
  if (!recs) return;
  const all = lettersOf(db, s.scenario);
  const open = recs.filter(r => !r.end);
  for (let i = from; i < notices.length; i++) {
    const f = firstOf(notices[i]);
    if (!f) continue;
    const l = all.find(x => 'first' in x.when && x.when.first === f[0].first);
    if (l && !recOf(s, l.id)) arrive(db, s, l, notices, f[1]);
  }
  for (const r of open) {
    const l = db.letters[r.id];
    if (l && !r.end && met(s, l, r)) finish(db, s, l, r, 'done', notices);
  }
}

/**
 * Команда `letter` (Б9): `seen` — окно открыло вещь: кончаются открытые письма с этим условием; `read` — прочитано;
 * `skip` — письмо наставника кончается без условия; `skipAll` — все письма наставника: открытые и непришедшие кончаются
 * пропуском, их отделы передаются. Отказы: письма нет или не пришло; кончилось; не наставника.
 */
export function letterCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'letter' }>, notices: Notice[]) {
  const recs = s.heads.letters;
  if (!recs) return notices.push({ kind: 'refused', cmd: 'letter', why: 'noLetter' });
  if (cmd.op === 'seen') {
    for (const r of recs.filter(x => !x.end)) {
      const l = db.letters[r.id];
      if (l?.done.kind === 'seen' && l.done.what === cmd.what) finish(db, s, l, r, 'done', notices);
    }
    return;
  }
  if (cmd.op === 'skipAll') {
    for (const l of lettersOf(db, s.scenario)) {
      if (l.from !== 'mentor') continue;
      let r = recOf(s, l.id);
      if (r?.end) continue;
      if (!r) {
        r = { id: l.id, at: s.t };
        recs.push(r);
      }
      r.end = { t: s.t, how: 'skip' };
      give(s, l);
    }
    return;
  }
  const r = recOf(s, cmd.id);
  const l = db.letters[cmd.id];
  if (!r || !l) return notices.push({ kind: 'refused', cmd: 'letter', why: 'noLetter', detail: cmd.id });
  if (cmd.op === 'read') {
    r.read ??= s.t;
    return;
  }
  if (r.end) return notices.push({ kind: 'refused', cmd: 'letter', why: 'letterDone', detail: cmd.id });
  if (l.from !== 'mentor') return notices.push({ kind: 'refused', cmd: 'letter', why: 'noSkip', detail: cmd.id });
  finish(db, s, l, r, 'skip', notices);
}
