// Цели сценария (Б9; геймдизайн, §15.1): цель, что видно сейчас, выполнена ли; в конце срока — итог и «Играть дальше».
// Числа — записи завода из потока (src/sim/goals.ts); итог не оценивает игрока (§26.1).
import { db } from './db';
import { momentOf } from '../engine/core/calendar';
import { dateText, named, T } from '../i18n';
import { goalText, goalValueText } from './goalwords';
import type { Actions, Hud } from './store';

export function Goals({ hud, actions }: { hud: Hud; actions: Actions }) {
  const v = hud.goals.view;
  if (!v) return null;
  const rows = (top: boolean) =>
    v.goals
      .filter(g => !!g.goal.top === top)
      .map((g, i) => (
        <li key={`${top}-${i}`} className={g.met ? 'ok' : ''} data-test="goal-row" data-met={g.met ? '1' : '0'}>
          {g.met ? '✓ ' : ''}
          {goalText(g.goal, (hud.scenario ? db?.scenarios[hud.scenario]?.start.date : undefined) ?? hud.start)} — {v.ended ? T.campaign.end(goalValueText(g.goal, g.v)) : T.campaign.now(goalValueText(g.goal, g.v))}
          {v.ended ? ` · ${g.met ? T.campaign.met : T.campaign.notMet}` : ''}
        </li>
      ));
  return (
    <div className="goals panel" role="dialog" aria-labelledby="goals-title" data-test="goals">
      <div className="phead">
        <b id="goals-title">{v.ended ? T.campaign.result : T.campaign.goals}</b>
        <span className="muted">{v.ended ? T.campaign.ended : v.to !== undefined ? T.campaign.left(dateText(momentOf(hud.start, v.to))) : ''}</span>
        <button type="button" className="close" onClick={() => actions.toggleGoals()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      <ul>{rows(false)}</ul>
      {v.goals.some(g => g.goal.top) ? (
        <>
          <b>{T.campaign.top}</b>
          <ul>{rows(true)}</ul>
        </>
      ) : null}
      {v.ended ? (
        <div className="row">
          <button type="button" className="take" onClick={() => actions.toggleGoals()} title={T.campaign.playHint} data-test="goals-play">
            {T.campaign.play}
          </button>
          {/* переход кампании (Б9, шаг 4): завод — в следующий сценарий; позже его начала — только с чистого листа */}
          {v.next && v.next.block !== 'tooLate' ? (
            <button type="button" className="take" onClick={() => actions.nextScenario()} title={T.campaign.nextHint} data-test="goals-next">
              {T.campaign.next(named(db?.scenarios[v.next.id]?.name, v.next.id))}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
