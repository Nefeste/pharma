// Движок завода (docs/02-architecture.md, §1, §3): `newPlant` и `apply`. Время идёт по событиям очереди, при равном
// времени — по номеру постановки. Ход времени срезами даёт то же состояние, что одним куском: это проверяют тесты.
//
// Устройство хода времени — как в «Больнице» (её src/engine/shift/engine.ts, `later` и `catchUp`): команда со временем
// ставит `until`, а `catchUp` проживает события по порядку, пока бюджет кадра `more()` позволяет. Недожитое
// доживается в следующих кадрах; любая следующая команда сначала доживает всё.
import type { ContentDb, Id } from '../content/types';
import { agenda, nextTime, popDue, schedule } from './core/agenda';
import { DAY, HOUR } from './core/calendar';
import { type Command, type Notice, type PlantEvent, type PlantState, SCHEMA } from './types';

/** Час планёрки (геймдизайн, §2). */
export const MORNING = 8 * HOUR;

export interface NewPlant {
  scenario: Id;
  /** зерно партии; нет — зерно сценария */
  seed?: number;
}

export function newPlant(db: ContentDb, o: NewPlant): PlantState {
  const sc = db.scenarios[o.scenario];
  if (!sc) throw new Error(`no scenario ${o.scenario}`);
  const s: PlantState = {
    schema: SCHEMA,
    content: db.hash,
    scenario: sc.id,
    seed: (o.seed ?? sc.seed) >>> 0,
    rng: {},
    start: sc.start.date,
    t: sc.start.hour * HOUR,
    agenda: agenda<PlantEvent>(),
    day: 0,
  };
  // первая планёрка — ближайшие 08:00
  const today = Math.floor(s.t / DAY) * DAY;
  schedule(s.agenda, s.t < today + MORNING ? today + MORNING : today + DAY + MORNING, { kind: 'morning' });
  return s;
}

export function apply(db: ContentDb, s: PlantState, cmd: Command, more?: () => boolean): Notice[] {
  // время прошлой команды, ещё не прожитое, — сначала всё: команда видит завод таким же, как игрок
  const before = catchUp(db, s);
  const out = command(db, s, cmd, more);
  return before.length > 0 ? [...before, ...out] : out;
}

function command(db: ContentDb, s: PlantState, cmd: Command, more?: () => boolean): Notice[] {
  switch (cmd.kind) {
    case 'advance':
      if (cmd.seconds <= 0) return [];
      s.until = s.t + cmd.seconds;
      return catchUp(db, s, more);
  }
}

/**
 * Дожить время команды: события по порядку, пока `more()` перед каждым, — остальное в следующий раз; без `more` — всё.
 * В конце часы стоят на том часе, до которого жили. Нечего доживать — ничего.
 */
export function catchUp(db: ContentDb, s: PlantState, more?: () => boolean): Notice[] {
  const notices: Notice[] = [];
  const target = s.until;
  if (target === undefined) return notices;
  for (;;) {
    const next = nextTime(s.agenda);
    if (next === undefined || next > target) break;
    if (more && !more()) return notices;
    const due = popDue(s.agenda, target)!;
    s.t = Math.max(s.t, due.t);
    handle(db, s, due.e, notices);
  }
  s.t = target;
  delete s.until;
  return notices;
}

function handle(_db: ContentDb, s: PlantState, ev: PlantEvent, notices: Notice[]) {
  switch (ev.kind) {
    case 'morning':
      s.day++;
      notices.push({ kind: 'morning', day: s.day });
      schedule(s.agenda, s.t + DAY, { kind: 'morning' });
      return;
  }
}
