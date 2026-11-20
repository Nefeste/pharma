// Экран «Кампания» (Б9; геймдизайн, §15.1): сценарии кампании по номеру — чему учит, когда старт, срок, цели и цели «на
// отлично»; сценарии вне кампании — после. «Начать» — новый завод сценария, за ним экран «Кем вы будете».
import { DAY, HOUR, momentOf } from '../engine/core/calendar';
import { dateText, named, T } from '../i18n';
import { db } from './db';
import { goalText } from './goalwords';
import type { Actions } from './store';

export function Campaign({ actions }: { actions: Actions }) {
  const list = Object.values(db?.scenarios ?? {}).sort((a, b) => (a.campaign ?? 99) - (b.campaign ?? 99) || a.id.localeCompare(b.id));
  return (
    <div className="seats panel" id="campaign" role="dialog" aria-modal="true" aria-labelledby="campaign-title" data-test="campaign">
      <div className="phead">
        <b id="campaign-title">{T.campaign.title}</b>
        <span className="muted">{T.campaign.question}</span>
      </div>
      <div className="tiles">
        {list.map(sc => {
          const main = sc.goals.filter(g => !g.top);
          const top = sc.goals.filter(g => g.top);
          return (
            <div key={sc.id} className="tile" data-test="campaign-tile" data-scenario={sc.id}>
              <span className="tnote">{sc.campaign ? T.campaign.no(sc.campaign) : T.campaign.outside}</span>
              <b className="tname">{named(sc.name, sc.id)}</b>
              {sc.teaches ? (
                <span>
                  <span className="tkey">{T.campaign.teaches}:</span> {named(sc.teaches)}
                </span>
              ) : null}
              <span>{T.campaign.from(dateText(momentOf(sc.start.date, sc.start.hour * HOUR + sc.warm)))}</span>
              <span>{sc.days !== undefined ? T.campaign.span(Math.round(sc.days / DAY)) : T.campaign.open}</span>
              {main.length > 0 ? (
                <span>
                  <span className="tkey">{T.campaign.goals}:</span> {main.map(g => goalText(g, sc.start.date)).join('; ')}
                </span>
              ) : null}
              {top.length > 0 ? (
                <span>
                  <span className="tkey">{T.campaign.top}:</span> {top.map(g => goalText(g, sc.start.date)).join('; ')}
                </span>
              ) : null}
              {sc.campaign !== undefined && sc.campaign > 1 ? <span className="muted">{T.campaign.clean}</span> : null}
              <button type="button" className="take" onClick={() => actions.pickScenario(sc.id)} data-test="campaign-start">
                {T.campaign.start}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
