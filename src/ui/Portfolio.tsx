// Окно «Портфель» (Б7д; docs/specs/2026-10-vertical-slice.md, «Б7д», «Окно»; геймдизайн, §13): продукты базы, которые
// завод не производит, и их проекты. У продукта — «Начать проект» (директор); у проекта — этап и с какого мгновения, чего
// он ждёт; на «готовности» — чего нет заводу с переходом туда, где это делают: стройка (Б7б) и её «Оборудование» (Б7в),
// «Контрагенты» справочника — «Одобрить пару» (Б6ж); решение протокола — продавать ли серии валидации; серии проекта с
// номером и состоянием; «Остановить». Вид собирает поток расчёта (src/sim/portfolio.ts); слова — здесь.
import { dayText, named, T, whenText } from '../i18n';
import type { Gap } from '../engine/project';
import type { PortfolioRow, ProjectRow } from '../sim/portfolio';
import { db } from './db';
import { type Actions, holds, type Hud } from './store';

const cls = (id: string) => named(db?.equipment[id]?.name ?? db?.instruments[id]?.name, id);
const roomName = (type: string) => T.roomTypes[type] ?? type;

function gapText(g: Gap): string {
  switch (g.kind) {
    case 'room':
      return T.project.gap.room(roomName(g.type));
    case 'unit':
      return T.project.gap.unit(cls(g.type), g.room);
    case 'inst':
      return T.project.gap.inst(cls(g.type));
    case 'pair':
      return T.project.gap.pair(named(db?.materials[g.material]?.name, g.material));
  }
}

/** Чего ждёт этап — словами. */
export function waitText(p: ProjectRow): string | undefined {
  const w = T.project.wait;
  switch (p.stage) {
    case 'ready':
      return w.ready;
    case 'methods':
      return w.methods(p.left);
    case 'docs':
      return p.until !== undefined ? w.docs(dayText(p.until)) : undefined;
    case 'clean':
      return w.clean(p.left);
    case 'trial':
      return w.trial;
    case 'protocol':
      return w.protocol(p.left);
    case 'validation':
      return w.validation(p.passed, p.need);
    case 'report':
      return w.report(p.left);
    case 'dossier':
      return p.dossier ? w.dossier(dayText(p.dossier.filed), dayText(p.dossier.decide)) : undefined;
    default:
      return undefined;
  }
}

function Gaps({ r, actions }: { r: PortfolioRow; actions: Actions }) {
  return (
    <div className="pgaps" data-test="portfolio-gaps" data-n={r.gaps.length}>
      <div className="msec">{T.project.gaps}</div>
      {r.gaps.length === 0 ? <div className="muted small">{T.project.gapsNone}</div> : null}
      {r.gaps.map(g => (
        <div key={`${g.kind}-${'type' in g ? g.type : g.material}`} className="small" data-test="portfolio-gap" data-kind={g.kind}>
          {gapText(g)}{' '}
          {g.kind === 'pair' ? (
            <button type="button" className="link" onClick={() => actions.go({ panel: 'ref', tab: 'partners' })} data-test="portfolio-go" data-kind={g.kind}>
              {T.project.goPairs}
            </button>
          ) : (
            <button
              type="button"
              className="link"
              onClick={() => {
                actions.togglePortfolio();
                actions.toggleBuild();
              }}
              data-test="portfolio-go"
              data-kind={g.kind}
            >
              {T.project.goBuild}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Project({ p, hud, actions, mine }: { p: ProjectRow; hud: Hud; actions: Actions; mine: boolean }) {
  const wait = waitText(p);
  return (
    <div className="pproj" data-test="portfolio-project" data-id={p.id} data-stage={p.stage}>
      <div>
        <b data-test="portfolio-stage">{T.project.since(T.project.stages[p.stage] ?? p.stage, whenText(hud.start, p.since))}</b>
        <span className="muted small"> · {T.project.started(whenText(hud.start, p.started))}</span>
      </div>
      {wait ? (
        <div className="muted small" data-test="portfolio-wait">
          {wait}
        </div>
      ) : null}
      {p.restarts > 0 ? <div className="warn small">{T.project.restarts(p.restarts)}</div> : null}
      <div className="small" data-test="portfolio-sell" data-sell={p.sell === undefined ? '' : String(p.sell)}>
        {T.project.sell}:{' '}
        {mine && p.open ? (
          <>
            <button type="button" className={p.sell === true ? 'on' : ''} onClick={() => actions.projectSell(p.id, true)} title={T.project.sellHint} data-test="portfolio-sell-yes">
              {T.project.sellYes}
            </button>{' '}
            <button type="button" className={p.sell === false ? 'on' : ''} onClick={() => actions.projectSell(p.id, false)} title={T.project.sellHint} data-test="portfolio-sell-no">
              {T.project.sellNo}
            </button>
          </>
        ) : (
          <b>{p.sell === undefined ? T.project.sellUnset : p.sell ? T.project.sellYes : T.project.sellNo}</b>
        )}
      </div>
      {p.batches.length > 0 ? (
        <div className="pbatches">
          <div className="msec">{T.project.batches}</div>
          {p.batches.map(b => (
            <div key={b.batch} className="small" data-test="portfolio-batch" data-role={b.role} data-state={b.state}>
              <button type="button" className="link" onClick={() => actions.openDossier(Number(b.batch.slice(1)))}>
                {b.code ?? T.project.noCode}
              </button>{' '}
              — {T.project.role[b.role]}, {T.project.state[b.state]}
            </div>
          ))}
        </div>
      ) : null}
      {p.live ? <div className="small">{T.project.live(dayText(p.live.day), p.live.ramp)}</div> : null}
      {mine && p.stage !== 'done' ? (
        <button type="button" onClick={() => actions.projectStop(p.id)} title={T.project.stopHint} data-test="portfolio-stop">
          {T.project.stop}
        </button>
      ) : null}
    </div>
  );
}

export function Portfolio({ hud, actions }: { hud: Hud; actions: Actions }) {
  const v = hud.portfolio.view;
  const mine = holds(hud, 'director');
  return (
    <div className="kpi panel pol" id="portfolio" role="dialog" aria-labelledby="pf-title" data-test="portfolio">
      <div className="phead">
        <b id="pf-title">{T.project.title}</b>
        <span className="muted">{T.project.question}</span>
        <button type="button" className="close" onClick={() => actions.togglePortfolio()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {!v ? <div className="muted">{T.app.loading}</div> : null}
      {v && !v.terms ? <div className="muted">{T.project.noTerms}</div> : null}
      {v && v.rows.length === 0 ? <div className="muted">{T.project.none}</div> : null}
      {!mine ? <div className="muted small">{T.project.notDirector}</div> : null}
      <div className="pbody">
        {v?.rows.map(r => (
          <div key={r.product} className="pfrow" data-test="portfolio-row" data-product={r.product} data-draft={String(r.draft)}>
            <div>
              <b>{named(db?.products[r.product]?.name, r.product)}</b>
              <span className="muted small"> · {r.draft ? T.project.draft : r.project && r.project.stage !== 'done' ? T.project.going : T.project.stages.done}</span>
              {r.stopped > 0 ? <span className="muted small"> · {T.project.stopped(r.stopped)}</span> : null}
            </div>
            <div className="muted small">{T.project.docs(r.docs.materials, r.docs.methods, r.docs.docs, r.docs.launch)}</div>
            {r.project ? <Project p={r.project} hud={hud} actions={actions} mine={mine} /> : null}
            {r.draft && (!r.project || r.project.stage === 'ready') ? <Gaps r={r} actions={actions} /> : null}
            {r.draft && !r.project && v.terms ? (
              <button type="button" className="on" disabled={!mine} onClick={() => actions.projectStart(r.product)} title={mine ? T.project.startHint : T.project.notDirector} data-test="portfolio-start">
                {T.project.start}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
