// Панели (геймдизайн, §18): верхняя полоса — дата и часы завода, сутки, скорости, «До утра» и «До события» с меню
// автопауз (Б2а), стены, склад, планёрка, касса с изменением за сутки, извещение — на котором мир встал, помечено, и щелчок
// по нему ведёт на место; панель склада и карточка выбранной вещи (docs/specs/2026-10-panels.md, 3б); планёрка и панель
// кассы (3в); лаборатория (3г); расписание (3д); экран «Кем вы будете» и кнопка «Место» (3е); доска расследования (часть
// 4б) — кнопка со счётом идущих; журнал решений (Б5а); полоса отладки; состояние загрузки и ошибки. Панели только читают хранилище и зовут
// действия игры. Полоса и каждая панель — в своей ограде (Guard.tsx): ошибка одной панели остаётся на её месте.
import { useLayoutEffect, useRef } from 'react';
import { momentOf } from '../engine/core/calendar';
import { clock, dateText, money, T } from '../i18n';
import { QUALITIES } from '../render/view';
import type { WallMode } from '../render/world';
import { Card } from './Card';
import { Cash } from './Cash';
import { db } from './db';
import { Gantt } from './Gantt';
import { Guard } from './Guard';
import { Dossier } from './Dossier';
import { Inv } from './Inv';
import { Journal } from './Journal';
import { Lab } from './Lab';
import { Morning } from './Morning';
import { Now, rowTitle } from './Now';
import { Pauses } from './Pauses';
import { Ref } from './Ref';
import { Seats } from './Seats';
import { Stock } from './Stock';
import { watchFor } from '../app/watch';
import { type Actions, type Hud, LIVE, type Speed, type Store, useHud } from './store';

const SPEEDS: Speed[] = [1, 2, 3, 4];
const WALLS: WallMode[] = ['full', 'cut', 'down'];

export function App({ store, actions, plant, scenario }: { store: Store; actions: Actions; plant: string; scenario: string }) {
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
  const mine = s.top?.seats?.map(id => T.seats.names[id]).join(', ');
  return (
    <>
      <Guard name={T.app.title}>
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
            <button className={s.ff && s.ffTo === 'morning' ? 'on' : ''} onClick={() => actions.untilMorning()} title={T.top.morningHint}>
              {T.top.morning}
            </button>
            <button className={s.ff && s.ffTo === 'event' ? 'on' : ''} onClick={() => actions.untilEvent()} title={T.top.eventHint} data-test="until-event">
              {T.top.event}
            </button>
            <button type="button" className={s.pauses.open ? 'on' : ''} onClick={() => actions.togglePauses()} title={T.pauses.hint} data-test="pauses-open">
              {T.pauses.button}
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
            <button type="button" className={`seatbtn${s.seats.open ? ' on' : ''}`} onClick={() => actions.openSeats()} title={`${T.seats.hint}${mine ? ` · ${mine}` : ''}`} data-test="seats-open">
              {mine ? `${T.seats.button}: ${mine}` : T.seats.button}
            </button>
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
            <button type="button" className={s.now.open ? 'on' : ''} onClick={() => actions.toggleNow()} title={T.now.hint} data-test="now-open">
              {T.now.button}
            </button>
            <button type="button" className={s.journal.open ? 'on' : ''} onClick={() => actions.toggleJournal()} title={T.journal.hint} data-test="journal-open">
              {T.journal.button}
            </button>
            <button type="button" className={s.gantt.open ? 'on' : ''} onClick={() => actions.toggleGantt()} title={T.gantt.hint} data-test="gantt-open">
              {T.gantt.button}
            </button>
            <button type="button" className={s.inv.open ? 'on' : ''} onClick={() => actions.toggleInv()} title={T.inv.hint} data-test="inv-open">
              {T.inv.button}
              {s.top && s.top.inv > 0 ? <span className="badge"> {s.top.inv}</span> : null}
            </button>
            <button type="button" className={s.ref.open ? 'on' : ''} onClick={() => actions.toggleRef()} title={T.ref.hint} data-test="ref-open">
              {T.ref.button}
            </button>
          </span>
          {s.top ? (
            <span className="stat" data-test="top-cash" title={T.cash.day}>
              {T.cash.top(money(s.top.balance))}
              {Math.round(s.top.day / 100) !== 0 ? <span className={s.top.day < 0 ? 'bad' : 'muted'}> {money(s.top.day, true)}</span> : null}
            </span>
          ) : null}
          {s.lag >= 5 && <span className="warn">{T.top.lag(s.lag)}</span>}
          {s.watch ? (
            <span className="watching" data-test="watching">
              <span className="wtext" title={T.now.watching(rowTitle(s.watch))}>
                {T.now.watching(rowTitle(s.watch))}
              </span>
              <button type="button" onClick={() => actions.unwatch()} title={T.now.stopHint} data-test="unwatch">
                {T.now.stop}
              </button>
            </span>
          ) : null}
          {s.flows ? (
            <span className="watching" data-test="flows-on">
              <span className="wtext">{T.flows.people}</span>
              <button type="button" onClick={() => actions.toggleFlows()} data-test="flows-off">
                {T.flows.off}
              </button>
            </span>
          ) : null}
          <NoticeLine n={s.notices[0]} actions={actions} />
        </div>
      </Guard>
      {/* ограда — и вокруг закрытой панели: ошибку уборки при снятии панели React отдаёт той, что осталась на экране */}
      <Guard name={T.pauses.button} close={s.pauses.open ? actions.togglePauses : undefined}>
        {s.pauses.open && <Pauses hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.stock.button} close={s.stock.open ? actions.toggleStock : undefined}>
        {s.stock.open && <Stock hud={s} actions={actions} plant={plant} />}
      </Guard>
      <Guard name={T.cash.button} close={s.cash.open ? actions.toggleCash : undefined}>
        {s.cash.open && <Cash hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.lab.button} close={s.lab.open ? actions.toggleLab : undefined}>
        {s.lab.open && <Lab hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.now.button} close={s.now.open ? actions.toggleNow : undefined}>
        {s.now.open && <Now hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.journal.button} close={s.journal.open ? actions.toggleJournal : undefined}>
        {/* «Почему?» открывает журнал на новой записи — раскрыта она, а не та, что раскрывали раньше */}
        {s.journal.open && <Journal key={s.journal.focus ?? 'all'} hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.morning.button} close={s.morning.open ? () => actions.closeMorning(false) : undefined}>
        {s.morning.open && s.morning.day !== undefined && <Morning v={s.morning.view} day={s.morning.day} start={s.start} plant={plant} pause={!s.pauses.off.includes('morning')} actions={actions} hud={s} scenario={db?.scenarios[scenario]} />}
      </Guard>
      <Guard name={T.gantt.button} close={s.gantt.open ? actions.toggleGantt : undefined}>
        {s.gantt.open && <Gantt hud={s} actions={actions} plant={plant} />}
      </Guard>
      <Guard name={T.inv.button} close={s.inv.open ? actions.toggleInv : undefined}>
        {s.inv.open && <Inv hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.ref.button} close={s.ref.open ? actions.toggleRef : undefined}>
        {s.ref.open && <Ref hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.seats.button} close={s.seats.open ? actions.closeSeats : undefined}>
        {s.seats.open && <Seats hud={s} actions={actions} scenario={scenario} />}
      </Guard>
      <Guard name={T.card.title} close={s.selected ? () => actions.select(undefined) : undefined}>
        {s.selected && s.card && (
          <Card v={s.card} start={s.start} plant={plant} actions={actions} hud={s} beside={s.stock.open || s.cash.open || s.lab.open || s.now.open || s.journal.open} watch={watchFor(s.selected, s.card.card, s.now.view?.rows)} />
        )}
      </Guard>
      {/* досье серии (Б1д) — поверх остальных окон, и карточки тоже: его открывают из неё */}
      <Guard name={T.dossier.button} close={s.dossier.open ? actions.closeDossier : undefined}>
        {s.dossier.open && <Dossier hud={s} actions={actions} />}
      </Guard>
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
              <button key={q} className={s.quality === q ? 'on' : ''} onClick={() => actions.pickQuality(q)}>
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

/**
 * Последнее извещение: на котором мир встал (автопауза, Б2а), — со знаком паузы, не только цветом (13-art.md, §14); щелчок
 * ведёт на место. Извещение о расследовании ведёт к его доске.
 */
function NoticeLine({ n, actions }: { n: Hud['notices'][number] | undefined; actions: Actions }) {
  if (!n) return <span className="notice">{T.app.stage}</span>;
  const text = n.stop ? `❚❚ ${n.text}` : n.text;
  const cls = `notice${n.stop ? ' stop' : ''}`;
  if (!n.go) return <span className={cls} data-test="notice">{text}</span>;
  const go = n.go;
  return (
    <button type="button" className={`${cls} link`} onClick={() => actions.go(go)} title={'inv' in go ? T.inv.hint : text} data-test={'inv' in go ? 'notice-inv' : 'notice-go'}>
      {text}
    </button>
  );
}
