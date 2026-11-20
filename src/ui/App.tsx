// Панели (геймдизайн, §18): верхняя полоса — дата и часы завода, сутки, скорости, «До утра» и «До события» с меню
// автопауз (Б2а), стены, склад, планёрка, касса с изменением за сутки, извещение — на котором мир встал, помечено, и щелчок
// по нему ведёт на место; панель склада и карточка выбранной вещи (docs/specs/2026-10-panels.md, 3б); планёрка и панель
// кассы (3в); лаборатория (3г); расписание (3д); экран «Кем вы будете» и кнопка «Место» (3е); доска расследования (часть
// 4б) — кнопка со счётом идущих; журнал решений (Б5а); полоса отладки; состояние загрузки и ошибки. Панели только читают хранилище и зовут
// действия игры. Полоса и каждая панель — в своей ограде (Guard.tsx): ошибка одной панели остаётся на её месте.
import { useLayoutEffect, useRef } from 'react';
import { momentOf } from '../engine/core/calendar';
import { clock, dateText, money, named, T, whenText } from '../i18n';
import type { WallMode } from '../render/world';
import { Card } from './Card';
import { Cash } from './Cash';
import { db } from './db';
import { Gantt } from './Gantt';
import { Po } from './Po';
import { Guard } from './Guard';
import { Dossier } from './Dossier';
import { Inv } from './Inv';
import { Journal } from './Journal';
import { Kpi } from './Kpi';
import { Policies } from './Policies';
import { Portfolio } from './Portfolio';
import { Campaign } from './Campaign';
import { Goals } from './Goals';
import { Chronicle } from './Chronicle';
import { Letters } from './Letters';
import { Sop } from './Sop';
import { Build } from './Build';
import { FloorTip, Layers } from './Layers';
import { Lab } from './Lab';
import { Morning } from './Morning';
import { Now, rowTitle } from './Now';
import { Pauses } from './Pauses';
import { Ref } from './Ref';
import { Seats } from './Seats';
import { Settings } from './Settings';
import { uiK } from '../app/scale';
import { Stock } from './Stock';
import { watchFor } from '../app/watch';
import { type Actions, type Hud, LIVE, LOAD_STEPS, type Speed, type Store, useHud } from './store';

const SPEEDS: Speed[] = [1, 2, 3, 4];
const WALLS: WallMode[] = ['full', 'cut', 'down'];

export function App({ store, actions }: { store: Store; actions: Actions }) {
  const s = useHud(store);
  // сценарий завода (Б9) — из потока; до первого среза — прототип
  const scenario = s.scenario ?? 'scn.proto';
  // план здания — от потока расчёта (Б7а); до первого среза панелей плана нет
  const plant = s.world;
  // низ верхней полосы — для панелей под ней: на узком окне полоса переносится во вторую строку
  const top = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = top.current;
    if (!el) return;
    // низ — в точках экрана, а панели под ним — в точках `#ui`: под масштабом интерфейса (Б13) точка `#ui` — `k` точек экрана
    const put = () => document.documentElement.style.setProperty('--top-h', `${Math.ceil(el.getBoundingClientRect().bottom / uiK())}px`);
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    return () => ro.disconnect();
  }, [s.ready, s.settings.scale]);
  if (s.error)
    return (
      <div className="status panel">
        {T.app.error}: {s.error}
      </div>
    );
  if (!s.ready) return <FirstScreen load={s.load} version={s.version} />;
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
          {/* сутки — от старта игрока: прогрев сценария (Б9) не в счёт */}
          <span className="stat">{T.top.day(Math.max(0, s.day - Math.round((db?.scenarios[scenario]?.warm ?? 0) / 86_400)))}</span>
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
            <button className={s.ff && s.ffTo === 'morning' ? 'on' : ''} onClick={() => actions.untilMorning()} title={T.top.morningHint} data-test="until-morning">
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
            <button type="button" className={s.menu.open ? 'on' : ''} onClick={() => actions.toggleMenu()} title={T.saves.menuHint} data-test="menu-open">
              {T.saves.menu}
            </button>
            <button type="button" className={s.settings.open ? 'on' : ''} onClick={() => actions.toggleSettings()} title={T.settings.hint} data-test="settings-open">
              {T.settings.button(Math.round(s.sound.volume * 100))}
            </button>
          </span>
          <span className="group nav" data-test="nav">
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
            <button type="button" className={s.kpi.open ? 'on' : ''} onClick={() => actions.toggleKpi()} title={T.kpi.hint} data-test="kpi-open">
              {T.kpi.button}
            </button>
            <button type="button" className={s.policies.open ? 'on' : ''} onClick={() => actions.togglePolicies()} title={T.policies.hint} data-test="policies-open">
              {T.policies.button}
            </button>
            <button type="button" className={s.sop.open ? 'on' : ''} onClick={() => actions.toggleSop()} title={T.sop.hint} data-test="sop-open">
              {T.sop.button}
            </button>
            <button type="button" className={s.portfolio.open ? 'on' : ''} onClick={() => actions.togglePortfolio()} title={T.project.hint} data-test="portfolio-open">
              {T.project.button}
            </button>
            <button type="button" className={s.chronicle.open ? 'on' : ''} onClick={() => actions.toggleChronicle()} title={T.chronicle.hint} data-test="chronicle-open">
              {T.chronicle.button}
            </button>
            {s.letters.view ? (
              <button type="button" className={`goalbtn${s.letters.open ? ' on' : ''}${s.letters.view.unread > 0 ? ' new' : ''}`} onClick={() => actions.toggleLetters()} title={T.letters.hint} data-test="letters-open">
                ✉ {T.letters.button}
                {T.letters.count(s.letters.view.unread)}
              </button>
            ) : null}
            {s.goals.view && s.goals.view.goals.length > 0 ? (
              <button type="button" className={`goalbtn${s.goals.open ? ' on' : ''}`} onClick={() => actions.toggleGoals()} title={T.campaign.hint} data-test="goals-open">
                {T.campaign.button} {T.campaign.count(s.goals.view.goals.filter(g => g.met && !g.goal.top).length, s.goals.view.goals.filter(g => !g.goal.top).length)}
              </button>
            ) : null}
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
          <NoticeLine n={s.notices[0]} captions={s.sound.captions} actions={actions} />
        </div>
      </Guard>
      {/* слои слева (Б1и; геймдизайн, §18) и подсказка у столбика под курсором; пока выбирают место, слоёв нет — из-под
          экрана «Кем вы будете» они выглядывали обрезком (второй проход по снимкам) */}
      <Guard name={T.floor.layers}>
        {s.seats.open ? null : s.build.on ? <Build hud={s} actions={actions} /> : <Layers hud={s} actions={actions} />}
        {plant ? <FloorTip hud={s} plant={plant} /> : null}
      </Guard>
      {/* ограда — и вокруг закрытой панели: ошибку уборки при снятии панели React отдаёт той, что осталась на экране */}
      {s.gap ? <GapScreen hud={s} /> : null}
      <Guard name={T.saves.menu} close={s.menu.open ? actions.toggleMenu : undefined}>
        {s.menu.open && <GameMenu hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.settings.title} close={s.settings.open ? actions.toggleSettings : undefined}>
        {s.settings.open && <Settings hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.pauses.button} close={s.pauses.open ? actions.togglePauses : undefined}>
        {s.pauses.open && <Pauses hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.stock.button} close={s.stock.open ? actions.toggleStock : undefined}>
        {s.stock.open && plant && <Stock hud={s} actions={actions} plant={plant} />}
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
        {s.morning.open && s.morning.day !== undefined && plant && <Morning v={s.morning.view} day={s.morning.day} start={s.start} plant={plant} pause={!s.pauses.off.includes('morning')} actions={actions} hud={s} scenario={db?.scenarios[scenario]} />}
      </Guard>
      <Guard name={T.gantt.button} close={s.gantt.open ? actions.toggleGantt : undefined}>
        {s.gantt.open && plant && <Gantt hud={s} actions={actions} plant={plant} />}
      </Guard>
      <Guard name={T.inv.button} close={s.inv.open ? actions.toggleInv : undefined}>
        {s.inv.open && <Inv hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.ref.button} close={s.ref.open ? actions.toggleRef : undefined}>
        {s.ref.open && <Ref hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.kpi.button} close={s.kpi.open ? actions.toggleKpi : undefined}>
        {s.kpi.open && <Kpi hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.policies.button} close={s.policies.open ? actions.togglePolicies : undefined}>
        {s.policies.open && <Policies hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.sop.button} close={s.sop.open ? actions.toggleSop : undefined}>
        {s.sop.open && <Sop hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.project.button} close={s.portfolio.open ? actions.togglePortfolio : undefined}>
        {s.portfolio.open && <Portfolio hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.po.button} close={s.po.open ? actions.togglePo : undefined}>
        {s.po.open && <Po hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.campaign.title}>{s.campaign.open && <Campaign actions={actions} />}</Guard>
      <Guard name={T.chronicle.button} close={s.chronicle.open ? actions.toggleChronicle : undefined}>
        {s.chronicle.open && <Chronicle hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.letters.button} close={s.letters.open ? actions.toggleLetters : undefined}>
        {s.letters.open && <Letters hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.campaign.button} close={s.goals.open ? actions.toggleGoals : undefined}>
        {s.goals.open && <Goals hud={s} actions={actions} />}
      </Guard>
      <Guard name={T.seats.button} close={s.seats.open ? actions.closeSeats : undefined}>
        {s.seats.open && <Seats hud={s} actions={actions} scenario={scenario} />}
      </Guard>
      <Guard name={T.card.title} close={s.selected ? () => actions.select(undefined) : undefined}>
        {s.selected && s.card && plant && (
          <Card v={s.card} start={s.start} plant={plant} actions={actions} hud={s} beside={s.stock.open || s.cash.open || s.lab.open || s.now.open || s.journal.open} over={s.kpi.open || s.ref.open || s.inv.open} watch={watchFor(s.selected, s.card.card, s.now.view?.rows)} />
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
            <span className="label">{T.debug.art}</span>
            {(['blender', 'code'] as const).map(a => (
              <button key={a} className={s.art === a ? 'on' : ''} onClick={() => actions.setArt(a)} data-test={`art-${a}`}>
                {T.debug.arts[a]}
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
 * Первый экран (Б11, шаг 2): название игры, версия и загрузка по настоящим шагам `Game.create` — полоса растёт, когда шаг
 * прошёл; затем «Кампания».
 */
function FirstScreen({ load, version }: { load: Hud['load']; version: string | undefined }) {
  const pct = Math.round((100 * load.done) / LOAD_STEPS.length);
  return (
    <div className="boot" data-test="first">
      <div className="boot-name">{T.app.title}</div>
      <div className="boot-tag muted">{T.app.tagline}</div>
      <div className="boot-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={T.app.loading}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="boot-step muted" data-test="first-step" data-done={load.done}>
        {T.app.steps[load.step]} · {pct} %
      </div>
      {version && <div className="boot-ver muted">{T.app.version(version)}</div>}
    </div>
  );
}

/** Языки окна (Б12): порядок кнопок. */

/** Меню звука и языка (Б11, шаг 1; Б12, шаг 1): громкость ступенями по 10 % и «Подписи звуков»; запоминаются в окне. */
/**
 * Последнее извещение: на котором мир встал (автопауза, Б2а), — со знаком паузы, не только цветом (13-art.md, §14); щелчок
 * ведёт на место. Извещение о расследовании ведёт к его доске.
 */
function NoticeLine({ n, captions, actions }: { n: Hud['notices'][number] | undefined; captions: boolean; actions: Actions }) {
  if (!n) return <span className="notice">{T.app.stage}</span>;
  // подпись звука (Б11, шаг 1; 13-art.md, §14): ни одного сигнала только звуком
  const said = captions && n.sound ? `${T.sound.caption(T.sound.names[n.sound] ?? n.sound)} ` : '';
  const text = `${said}${n.stop ? `❚❚ ${n.text}` : n.text}`;
  const cls = `notice${n.stop ? ' stop' : ''}`;
  if (!n.go) return <span className={cls} data-test="notice">{text}</span>;
  const go = n.go;
  return (
    <button type="button" className={`${cls} link`} onClick={() => actions.go(go)} title={'inv' in go ? T.inv.hint : text} data-test={'inv' in go ? 'notice-inv' : 'notice-go'}>
      {text}
    </button>
  );
}

/**
 * Меню «Игра» (из bolnitsa: src/ui/App.tsx @ 15a7ad6, `GameMenu` и `SaveList`; docs/specs/2026-10-vertical-slice.md,
 * «Сохранения»): «Сохранить», сохранения — новые сверху, «Загрузить», «Удалить».
 */
function GameMenu({ hud, actions }: { hud: Hud; actions: Actions }) {
  const rows = hud.menu.rows;
  return (
    <div className="gamemenu panel" role="dialog" aria-labelledby="game-menu-title" data-test="game-menu">
      <div className="phead">
        <b id="game-menu-title">{T.saves.menu}</b>
        <button type="button" className="close" onClick={() => actions.toggleMenu()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      <button type="button" className="take" disabled={hud.menu.busy || hud.campaign.open || hud.seats.open} onClick={() => actions.saveGame()} title={T.saves.saveHint} data-test="save-new">
        {T.saves.save}
      </button>
      {rows.length === 0 ? (
        <p className="muted small">{T.saves.none}</p>
      ) : (
        <ul className="saves" data-test="save-list">
          {rows.map(r => (
            <li key={r.slot} data-test="save-row" data-slot={r.slot}>
              <div className="grow">
                <b>{r.meta ? `${named(db?.scenarios[r.meta.scenario]?.name, r.meta.scenario)} · ${whenText(r.meta.start, r.meta.t)}` : r.slot}</b>
                <div className="muted small">{r.meta ? `${T.saves.kind[r.meta.kind] ?? r.meta.kind} · ${T.saves.savedAt(r.meta.savedAt.slice(0, 16).replace('T', ' '))}` : T.saves.noMeta}</div>
              </div>
              <button type="button" className="small" disabled={hud.menu.busy} onClick={() => actions.loadGame(r.slot)} data-test="save-load">
                {T.saves.load}
              </button>
              <button type="button" className="small" disabled={hud.menu.busy} onClick={() => actions.deleteGame(r.slot)} data-test="save-remove">
                {T.saves.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Межсезонье (Б9, шаг 4): завод живёт сам до старта следующего сценария — докуда дошло и сколько осталось. */
function GapScreen({ hud }: { hud: Hud }) {
  const g = hud.gap!;
  const share = Math.min(1, Math.max(0, (g.t - g.from) / Math.max(1, g.to - g.from)));
  return (
    <div className="gapscreen panel" role="dialog" aria-live="polite" data-test="gap" data-share={share.toFixed(3)}>
      <b>{T.campaign.gap(dateText(momentOf(hud.start, g.to)))}</b>
      <div className="muted small">{T.campaign.gapHint}</div>
      <div className="boot-bar">
        <i style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <div className="muted small">{dateText(momentOf(hud.start, g.t))}</div>
    </div>
  );
}
