// Панели части 0 (геймдизайн, §18): верхняя полоса — дата и часы завода, сутки, скорости, «До утра», извещение;
// полоса отладки; состояние загрузки и ошибки. Панели только читают хранилище и зовут действия игры.
import { momentOf } from '../engine/core/calendar';
import { clock, dateText, T } from '../i18n';
import { QUALITIES } from '../render/view';
import { type Actions, type Speed, type Store, useHud } from './store';

const SPEEDS: Speed[] = [1, 2, 3, 4];

export function App({ store, actions }: { store: Store; actions: Actions }) {
  const s = useHud(store);
  if (s.error)
    return (
      <div className="status panel">
        {T.app.error}: {s.error}
      </div>
    );
  if (!s.ready) return <div className="status panel">{T.app.loading}</div>;
  const m = momentOf(s.start, s.t);
  return (
    <>
      <div className="top panel">
        <span className="clock" data-test="clock">
          {clock(m.sec)}
        </span>
        <span className="date" data-test="date">
          {dateText(m)}
        </span>
        <span className="stat">{T.top.day(s.day)}</span>
        <span className="group">
          <button className={s.speed === 0 && !s.ff ? 'on' : ''} onClick={() => actions.setSpeed(0)} title={T.top.pause}>
            ❚❚
          </button>
          {SPEEDS.map(k => (
            <button key={k} className={s.speed === k && !s.ff ? 'on' : ''} onClick={() => actions.setSpeed(k)} title={T.top.speedHint(T.top.perSecond[k - 1])}>
              {T.top.speed(k)}
            </button>
          ))}
          <button className={s.ff ? 'on' : ''} onClick={() => actions.untilMorning()} title={T.top.morningHint}>
            {T.top.morning}
          </button>
        </span>
        {s.lag >= 5 && <span className="warn">{T.top.lag(s.lag)}</span>}
        <span className="notice">{s.notices[0]?.text ?? T.app.stage}</span>
      </div>
      {s.debug && (
        <div className="debug panel">
          <b>{T.debug.title}</b>
          <span>
            {T.debug.fps(s.fps)} · {T.debug.cpu(s.cpuMs.toFixed(1))}
            {s.gpuMs !== null && <> · {T.debug.gpu(s.gpuMs.toFixed(1))}</>}
          </span>
          <span className="group">
            <span className="label">{T.debug.quality}</span>
            {QUALITIES.map(q => (
              <button key={q} className={s.quality === q ? 'on' : ''} onClick={() => actions.setQuality(q)}>
                {T.debug.qualities[q]}
              </button>
            ))}
          </span>
          <span className="muted">v{s.version}</span>
        </div>
      )}
    </>
  );
}
