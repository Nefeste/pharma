// из bolnitsa: src/sim/host.ts @ e0a3491 — изменено: завод вместо смены; без режима врача и мира больницы; виды панелей
// (views.ts, 3б); ответ на `tick` помечен — клиент держит в пути не больше одного `tick` (перенести в «Больницу»);
// автопауза (Б2а): `tick` несёт виды извещений, на которых встать, — доживание встаёт сразу за таким событием, а часы игры,
// ушедшие дальше, не доживаются; бюджет кадра без «одно событие — всегда»: событие до вопроса проживает сам `catchUp`.
// Поток расчёта: разбирает сообщения `ToSim` и отвечает `FromSim`. Без привязки к виду потока: Web Worker окна Electron
// (src/sim/worker.ts), `worker_threads` Node/Bun в тестах — у каждого своя тонкая обёртка. Движок однопоточный и
// детерминированный: тот же порядок сообщений даёт то же состояние, что и в основном потоке.
import type { ContentDb } from '../content/types';
import { apply, catchUp, type More, newPlant } from '../engine/engine';
import { fromSave, toSave } from '../engine/save';
import type { Command, Notice, PlantState } from '../engine/types';
import { Packer } from './pack';
import type { FromSim, ToSim } from './protocol';
import { ViewDesk } from './views';

/** Счёт до `ms` от сейчас: после события, на котором время вышло, кадр кончается (одно событие — всегда, `catchUp`). */
function budget(ms: number): () => boolean {
  const end = performance.now() + ms;
  return () => performance.now() <= end;
}

export interface SimHost {
  handle(msg: ToSim): FromSim;
}

export function createSim(db: ContentDb): SimHost {
  let s: PlantState | undefined;
  /** игровые секунды, которые часы игры уже прошли, а движок ещё не начал */
  let owed = 0;
  /** помнит, какие паллеты окно уже знает: в срезе — только изменённые */
  const packer = new Packer(db);
  /** виды панелей (3б): что окно уже получило */
  const desk = new ViewDesk(db);
  const slice = (notices: Notice[], tick = false, stopped = false): FromSim => {
    const lag = owed + (s!.until !== undefined ? s!.until - s!.t : 0);
    const views = desk.out(s!, performance.now());
    return {
      kind: 'slice',
      buf: packer.pack(s!, lag),
      notices,
      lag,
      ...(views ? { views } : {}),
      ...(tick ? { tick: true as const } : {}),
      ...(stopped ? { stopped: true as const } : {}),
    };
  };
  /** Дожить время, которое часы игры уже прошли: команда видит завод таким, как игрок. */
  const settle = (): Notice[] => {
    const before = owed > 0 ? apply(db, s!, { kind: 'advance', seconds: owed }) : [];
    owed = 0;
    return before;
  };
  const run = (cmd: Command): Notice[] => [...settle(), ...apply(db, s!, cmd)];
  return {
    handle(msg) {
      try {
        switch (msg.kind) {
          case 'start':
            s = newPlant(db, { scenario: msg.scenario, seed: msg.seed });
            owed = 0;
            packer.reset();
            desk.reset();
            return slice([]);
          case 'load':
            s = fromSave(db, msg.json);
            owed = 0;
            packer.reset();
            desk.reset();
            return slice([]);
          case 'command':
            if (!s) return { kind: 'error', message: 'no plant' };
            desk.touch();
            return slice(run(msg.cmd));
          case 'views':
            if (!s) return { kind: 'error', message: 'no plant' };
            desk.set(msg.views);
            return slice([]);
          case 'tick': {
            if (!s) return { kind: 'error', message: 'no plant' };
            owed += msg.seconds;
            const fine = budget(msg.budgetMs);
            // автопауза (Б2а): извещение вида из `stop` — и дальше этого события не жить
            const stop = new Set(msg.stop ?? []);
            const hit = (list: readonly Notice[]) => stop.size > 0 && list.some(n => stop.has(n.kind));
            const more: More = list => !hit(list) && fine();
            const notices: Notice[] = [];
            if (s.until !== undefined) notices.push(...catchUp(db, s, more));
            if (s.until === undefined && owed > 0 && !hit(notices)) {
              const seconds = owed;
              owed = 0;
              notices.push(...apply(db, s, { kind: 'advance', seconds }, more));
            }
            // встали: часы завода — на событии; время, которое часы игры ушли дальше, пропадает — мир на паузе
            const stopped = hit(notices);
            if (stopped) {
              owed = 0;
              delete s.until;
            }
            return slice(notices, true, stopped);
          }
          case 'save':
            if (!s) return { kind: 'error', message: 'no plant' };
            // сохранение — всё прожитое: недожитое время сначала доживается
            if (s.until !== undefined) catchUp(db, s);
            if (owed > 0) settle();
            return { kind: 'saved', json: toSave(s) };
        }
      } catch (e) {
        return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
