// Экран «Кем вы будете» (docs/specs/2026-10-panels.md, 3е; геймдизайн, §29.2): директор и четыре поста — что делаете вы,
// что делают коллеги, чем меряют. Можно отметить несколько мест; какие можно взять, говорит сценарий. В начале партии мир
// стоит, пока место не выбрано; потом экран открывает кнопка «Место», и мир на паузе. «Взять» — команда `seat`. У
// отмеченных мест — режимы их отделов (Б5б): выбор игрока, который завод помнит, или по умолчанию — «советует» у поста и
// «сам» у директора; изменённые здесь уходят командами `mode` с «Взять».
import { type SeatId, SEATS } from '../content/types';
import { MODED } from '../engine/heads';
import { HEAD_SEAT } from '../engine/journal';
import type { DeptMode, Head } from '../engine/types';
import { T } from '../i18n';
import { db } from './db';
import type { Actions, Hud } from './store';

const MODES: readonly DeptMode[] = ['auto', 'advise', 'manual'];

/** Отделы места с выбором (Б5б): у поста — его руководители, у директора — все. */
const headsOf = (seat: SeatId): Head[] => MODED.filter(h => seat === 'director' || HEAD_SEAT[h] === seat);

export function Seats({ hud, actions, scenario }: { hud: Hud; actions: Actions; scenario: string }) {
  const offered = new Set(db?.scenarios[scenario]?.seats ?? []);
  const pick = new Set(hud.seats.pick);
  // в начале партии закрыть нечем: место нужно выбрать
  const first = !hud.top?.seats;
  const names = SEATS.filter(id => pick.has(id)).map(id => T.seats.names[id]);
  return (
    <div className="seats panel" id="seats" role="dialog" aria-modal="true" aria-labelledby="seats-title" data-test="seats">
      <div className="phead">
        <b id="seats-title">{T.seats.title}</b>
        <span className="muted">{T.seats.question}</span>
        {first ? null : (
          <button type="button" className="close" onClick={() => actions.closeSeats()} title={T.card.closeHint}>
            ✕
          </button>
        )}
      </div>
      <div className="tiles">
        {SEATS.map(id => {
          const can = offered.has(id);
          const on = pick.has(id);
          return (
            <button
              type="button"
              key={id}
              className={`tile${on ? ' on' : ''}`}
              disabled={!can}
              aria-pressed={on}
              onClick={() => actions.pickSeat(id)}
              data-test="seat-tile"
              data-seat={id}
            >
              <b className="tname">
                {on ? '✓ ' : ''}
                {T.seats.names[id]}
              </b>
              {can ? null : <span className="tnote">{T.seats.scenario}</span>}
              <span>
                <span className="tkey">{T.seats.you}:</span> {T.seats.yours[id]}
              </span>
              <span>
                <span className="tkey">{T.seats.colleagues}:</span> {T.seats.theirs[id]}
              </span>
              <span>
                <span className="tkey">{T.seats.measure}:</span> {T.seats.measures[id]}
              </span>
            </button>
          );
        })}
      </div>
      <SeatModes hud={hud} actions={actions} />
      <div className="sfoot">
        <span className="muted">{names.length === 0 ? (first ? T.seats.first : T.seats.pickOne) : T.seats.picked(names.join(', '))}</span>
        <button type="button" className="on" disabled={names.length === 0} onClick={() => actions.takeSeats()} data-test="seats-take">
          {T.seats.take}
        </button>
      </div>
    </div>
  );
}

/**
 * Режимы отделов отмеченных мест (Б5б): выбранный здесь, иначе тот, что завод помнит, иначе по умолчанию места. Отдел
 * поста, который тоже отмечен, — у поста: пост решает раньше директора.
 */
function SeatModes({ hud, actions }: { hud: Hud; actions: Actions }) {
  const pick = SEATS.filter(id => hud.seats.pick.includes(id));
  const posts = new Set<SeatId>(pick.filter(x => x !== 'director'));
  const rows = pick.flatMap(seat => headsOf(seat).filter(h => seat !== 'director' || !posts.has(HEAD_SEAT[h])).map(h => ({ seat, h })));
  if (rows.length === 0) return null;
  return (
    <div className="modes" data-test="seat-modes" title={T.journal.modesHint}>
      <div className="msec">{T.journal.modesTitle}</div>
      {rows.map(({ seat, h }) => {
        const mode = hud.seats.modes?.[h] ?? hud.top?.modes[h] ?? (seat === 'director' ? 'auto' : 'advise');
        return (
          <div className="filters" key={h} data-head={h} data-mode={mode}>
            <span className="muted">{T.journal.names[h] ?? h}:</span>
            {MODES.map(x => (
              <button type="button" key={x} className={mode === x ? 'on' : ''} aria-pressed={mode === x} onClick={() => actions.pickMode(h, x)} title={T.journal.modeHint[x]} data-mode={x}>
                {T.journal.modes[x]}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
