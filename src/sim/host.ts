// из bolnitsa: src/sim/host.ts @ e0a3491 — изменено: завод вместо смены; без режима врача и мира больницы.
// Поток расчёта: разбирает сообщения `ToSim` и отвечает `FromSim`. Без привязки к виду потока: Web Worker окна Electron
// (src/sim/worker.ts), `worker_threads` Node/Bun в тестах — у каждого своя тонкая обёртка. Движок однопоточный и
// детерминированный: тот же порядок сообщений даёт то же состояние, что и в основном потоке.
import type { ContentDb } from '../content/types';
import { apply, catchUp, newPlant } from '../engine/engine';
import { fromSave, toSave } from '../engine/save';
import type { Command, Notice, PlantState } from '../engine/types';
import { Packer } from './pack';
import type { FromSim, ToSim } from './protocol';

/** Счёт до `ms` от сейчас; одно событие — всегда. */
function budget(ms: number): () => boolean {
  const end = performance.now() + ms;
  let first = true;
  return () => {
    if (first) {
      first = false;
      return true;
    }
    return performance.now() <= end;
  };
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
  const slice = (notices: Notice[]): FromSim => {
    const lag = owed + (s!.until !== undefined ? s!.until - s!.t : 0);
    return { kind: 'slice', buf: packer.pack(s!, lag), notices, lag };
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
            return slice([]);
          case 'load':
            s = fromSave(db, msg.json);
            owed = 0;
            packer.reset();
            return slice([]);
          case 'command':
            if (!s) return { kind: 'error', message: 'no plant' };
            return slice(run(msg.cmd));
          case 'tick': {
            if (!s) return { kind: 'error', message: 'no plant' };
            owed += msg.seconds;
            const more = budget(msg.budgetMs);
            const notices: Notice[] = [];
            if (s.until !== undefined) notices.push(...catchUp(db, s, more));
            if (s.until === undefined && owed > 0) {
              const seconds = owed;
              owed = 0;
              notices.push(...apply(db, s, { kind: 'advance', seconds }, more));
            }
            return slice(notices);
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
