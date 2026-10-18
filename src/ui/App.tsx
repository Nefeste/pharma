// Панели (геймдизайн, §18): верхняя полоса — дата и часы завода, сутки, скорости, «До утра», стены, склад, планёрка,
// касса с изменением за сутки, извещение; панель склада и карточка выбранной вещи (docs/specs/2026-10-panels.md, 3б);
// планёрка и панель кассы (3в); лаборатория (3г); расписание (3д); полоса отладки; состояние загрузки и ошибки. Панели
// только читают хранилище и зовут действия игры.
import { useLayoutEffect, useRef } from 'react';
import { momentOf } from '../engine/core/calendar';
import { clock, dateText, money, T } from '../i18n';
import { QUALITIES } from '../render/view';
import type { WallMode } from '../render/world';
import { Card } from './Card';
import { Cash } from './Cash';
import { Gantt } from './Gantt';
import { Lab } from './Lab';
import { Morning } from './Morning';
import { Stock } from './Stock';
import { type Actions, LIVE, type Speed, type Store, useHud } from './store';

const SPEEDS: Speed[] = [1, 2, 3, 4];
const WALLS: WallMode[] = ['full', 'cut', 'down'];

export function App({ store, actions, plant }: { store: Store; actions: Actions; plant: string }) {
  const s = useHud(store);
  // низ верхней полосы — для панелей под ней: на узком окне полоса переносится во вторую строку
  const top = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = top.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${Math.ceil(el.getBoundingClientRect().bottom)}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [s.ready]);
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
      <div className="top panel" ref={top}>
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
          <button className={s.speed === LIVE && !s.ff ? 'on' : ''} onClick={() => actions.setSpeed(LIVE)} title={T.top.liveHint} data-test="live">
            {T.top.live}
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
        <span className="group" data-test="walls">
          <span className="label">{T.view.walls}</span>
          {WALLS.map(m => (
            <button key={m} className={s.walls === m ? 'on' : ''} onClick={() => actions.setWalls(m)}>
              {m === 'full' ? T.view.wallsFull : m === 'cut' ? T.view.wallsCut : T.view.wallsDown}
            </button>
          ))}
        </span>
        <span className="group">
          <button type="button" className={s.stock.open ? 'on' : ''} onClick={() => actions.toggleStock()} title={T.stock.hint} data-test="stock">
            {T.stock.button}
          </button>
          <button type="button" className={s.morning.open ? 'on' : ''} onClick={() => (s.morning.open ? actions.closeMorning(false) : actions.openMorning())} title={T.morning.hint} data-test="morning-open">
            {T.morning.button}
          </button>
          <button type="button" className={s.cash.open ? 'on' : ''} onClick={() => actions.toggleCash()} title={T.cash.hint} data-test="cash-open">
            {T.cash.button}
          </button>
          <button type="button" className={s.lab.open ? 'on' : ''} onClick={() => actions.toggleLab()} title={T.lab.hint} data-test="lab-open">
            {T.lab.button}
          </button>
          <button type="button" className={s.gantt.open ? 'on' : ''} onClick={() => actions.toggleGantt()} title={T.gantt.hint} data-test="gantt-open">
            {T.gantt.button}
          </button>
        </span>
        {s.top ? (
          <span className="stat" data-test="top-cash" title={T.cash.day}>
            {T.cash.top(money(s.top.balance))}
            {Math.round(s.top.day / 100) !== 0 ? <span className={s.top.day < 0 ? 'bad' : 'muted'}> {money(s.top.day, true)}</span> : null}
          </span>
        ) : null}
        {s.lag >= 5 && <span className="warn">{T.top.lag(s.lag)}</span>}
        <span className="notice">{s.notices[0]?.text ?? T.app.stage}</span>
      </div>
      {s.stock.open && <Stock hud={s} actions={actions} plant={plant} />}
      {s.cash.open && <Cash hud={s} actions={actions} />}
      {s.lab.open && <Lab hud={s} actions={actions} />}
      {s.morning.open && s.morning.day !== undefined && <Morning v={s.morning.view} day={s.morning.day} start={s.start} plant={plant} pause={s.morningPause} actions={actions} />}
      {s.gantt.open && <Gantt hud={s} actions={actions} plant={plant} />}
      {s.selected && s.card && <Card v={s.card} start={s.start} plant={plant} actions={actions} beside={s.stock.open || s.cash.open || s.lab.open} />}
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
          <span className="group">
            <button onClick={() => actions.bench(false)} data-test="bench">
              {T.debug.bench}
            </button>
            <button onClick={() => actions.bench(true)}>{T.debug.benchUncapped}</button>
          </span>
          <span className="muted">v{s.version}</span>
        </div>
      )}
      {s.status && (
        <div className="status panel" id="status">
          {s.status}
        </div>
      )}
    </>
  );
}
