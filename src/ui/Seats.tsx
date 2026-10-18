// Экран «Кем вы будете» (docs/specs/2026-10-panels.md, 3е; геймдизайн, §29.2): директор и четыре поста — что делаете вы,
// что делают коллеги, чем меряют. Можно отметить несколько мест; какие можно взять, говорит сценарий. В начале партии мир
// стоит, пока место не выбрано; потом экран открывает кнопка «Место», и мир на паузе. «Взять» — команда `seat`.
import { SEATS } from '../content/types';
import { T } from '../i18n';
import { db } from './db';
import type { Actions, Hud } from './store';

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
      <div className="sfoot">
        <span className="muted">{names.length === 0 ? T.seats.pickOne : T.seats.picked(names.join(', '))}</span>
        <button type="button" className="on" disabled={names.length === 0} onClick={() => actions.takeSeats()} data-test="seats-take">
          {T.seats.take}
        </button>
      </div>
    </div>
  );
}
