// Меню автопауз (этап Б, Б2а; геймдизайн, §2): на чём мир встаёт сам. Каждую можно отключить — выбор запоминается в окне;
// рядом — чьё это дело. Автопауза не вашего места — строка бледнее: мир на ней не встанет, пока вы не возьмёте пост
// (src/app/pauses.ts).
import { mine, PAUSE_SEATS, PAUSES } from '../app/pauses';
import { T } from '../i18n';
import type { Actions, Hud } from './store';

export function Pauses({ hud, actions }: { hud: Hud; actions: Actions }) {
  const seats = hud.top?.seats;
  return (
    <div className="pauses panel" id="pauses" data-test="pauses">
      <b>{T.pauses.title}</b>
      <ul>
        {PAUSES.map(p => {
          const who = PAUSE_SEATS[p];
          const yours = mine(p, seats);
          return (
            <li key={p} className={yours ? '' : 'muted'} title={yours ? undefined : T.pauses.notYours}>
              <label>
                <input type="checkbox" checked={!hud.pauses.off.includes(p)} onChange={e => actions.setPause(p, e.currentTarget.checked)} data-test="pause" data-id={p} />{' '}
                {T.pauses.names[p]}
              </label>
              <span className="muted">
                {' '}
                · {who === 'all' ? T.pauses.all : who.map(x => T.seats.names[x]).join(', ')}
                {yours ? '' : ` · ${T.pauses.notYours}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
