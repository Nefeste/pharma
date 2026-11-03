// Вкладка «План запуска» окна расписания (Б6б; docs/specs/2026-10-vertical-slice.md, «Б6б»): дни на §9.4 вперёд —
// столбцы, позиции плана выпуска — строки. В клетке — задания на серию по «не раньше» (с черновиком: новые срочные,
// сдвинутые, отменённые), дальше пунктиром — что поставит начальник отдела планирования по своему правилу. Клетку
// выбирают щелчком: под сеткой — что в ней, у задания — «Досье» и «Полосы», у пунктира — «Поставить сейчас»: строка
// черновика расписания на её позицию и день, как срочное задание. Под позициями — визиты подрядчика к оборудованию
// стадий и машинам линии; нерабочие дни — серые. Вид собран в потоке расчёта (src/sim/launch.ts) — истины в нём нет.
import { useState } from 'react';
import type { Id } from '../content/types';
import { civilFromDays, weekday } from '../engine/core/calendar';
import { dayText, named, T, whenText } from '../i18n';
import type { LaunchJob, LaunchView } from '../sim/launch';
import type { BatchLabel } from '../sim/plan';
import type { AssetInfo } from '../sim/places';
import { assetName, workName } from './assets';
import { db } from './db';
import type { Actions, Hud } from './store';

/** Подпись задания: номер серии, если досье выдано, иначе номер задания. */
const label = (labels: Record<string, BatchLabel>, j: LaunchJob) => labels[j.batch]?.code ?? T.jobs.order(Number(j.batch.slice(1)));

export function Launch({ hud, actions, v, labels, assets, mine, title }: { hud: Hud; actions: Actions; v: LaunchView; labels: Record<string, BatchLabel>; assets: Record<string, AssetInfo>; mine: boolean; title?: string }) {
  const [sel, setSel] = useState<{ sku?: Id; day: number } | null>(null);
  const start = hud.start;
  const days = Array.from({ length: v.days }, (_, i) => v.from + i);
  const off = new Set(v.off);
  const skuName = (id: Id) => named(db?.skus[id]?.name, id);
  const goal = (j: LaunchJob) => (!j.goal ? '' : j.goal.kind === 'stock' ? T.jobs.stock : T.jobs.forOrder(j.goal.customer ? named(db?.customers[j.goal.customer]?.name, j.goal.customer) : j.goal.order));
  const draft = (j: LaunchJob) => (j.fresh ? T.launch.fresh : j.drop ? T.launch.drop : j.moved ? T.launch.moved : '');
  const head = (d: number) => {
    const c = civilFromDays(d);
    return [T.date.weekdays[weekday(d)], `${String(c.d).padStart(2, '0')}.${String(c.m).padStart(2, '0')}`];
  };
  const cellJobs = (sku: Id, d: number) => v.jobs.filter(j => j.sku === sku && j.day === d);
  const cellRule = (sku: Id, d: number) => v.rule.filter(x => x.sku === sku && x.day === d);
  const visitName = (id: string) => (assets[id] ? assetName(assets[id]) : id);
  const picked = sel && sel.sku !== undefined ? { jobs: cellJobs(sel.sku, sel.day), rule: cellRule(sel.sku, sel.day) } : undefined;
  const visits = sel && sel.sku === undefined ? v.visits.filter(x => x.day === sel.day) : [];

  return (
    <div className="launch" data-test="launch">
      <div className="muted" data-test="launch-legend">
        {v.manual ? T.launch.manual : T.launch.legend}
      </div>
      <div className="launch-scroll">
        <table className="grid launch-grid" data-test="launch-grid">
          <thead>
            <tr>
              <th>{T.launch.sku}</th>
              {days.map(d => {
                const [wd, dm] = head(d);
                return (
                  <th key={d} className={off.has(d) ? 'off' : undefined} data-day={d}>
                    {wd}
                    <br />
                    {dm}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {v.skus.map(row => (
              <tr key={row.sku} data-test="launch-row" data-sku={row.sku}>
                <th>{skuName(row.sku)}</th>
                {days.map(d => {
                  const jobs = cellJobs(row.sku, d);
                  const rule = cellRule(row.sku, d);
                  const on = sel?.sku === row.sku && sel.day === d;
                  return (
                    <td key={d} className={`${off.has(d) ? 'off' : ''}${on ? ' sel' : ''}`.trim() || undefined}>
                      {jobs.map(j => (
                        <button
                          type="button"
                          key={j.batch}
                          className={`lchip${j.drop ? ' drop' : ''}${j.moved || j.fresh ? ' moved' : ''}`}
                          onClick={() => setSel({ sku: row.sku, day: d })}
                          title={[label(labels, j), goal(j), j.due !== undefined ? T.launch.due(whenText(start, j.due)) : '', draft(j)].filter(Boolean).join(' · ')}
                          data-test="launch-job"
                          data-batch={j.batch}
                        >
                          {label(labels, j)}
                        </button>
                      ))}
                      {rule.map(x => (
                        <button type="button" key={`r${x.at}`} className="lchip rule" onClick={() => setSel({ sku: row.sku, day: d })} title={T.launch.ruleWhat(dayText(x.on), dayText(x.day))} data-test="launch-rule" data-day={d}>
                          {T.launch.ruleMark}
                        </button>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr data-test="launch-visits">
              <th>{T.launch.visits}</th>
              {days.map(d => {
                const list = v.visits.filter(x => x.day === d);
                const on = sel?.sku === undefined && sel?.day === d;
                return (
                  <td key={d} className={`${off.has(d) ? 'off' : ''}${on ? ' sel' : ''}`.trim() || undefined}>
                    {list.length > 0 ? (
                      <button type="button" className={`lchip visit${list.every(x => x.booked) ? '' : ' rule'}`} onClick={() => setSel({ day: d })} title={list.map(x => `${visitName(x.asset)}: ${assets[x.asset] ? workName(assets[x.asset], x.work) : x.work}`).join('; ')} data-test="launch-visit">
                        {list.length}
                      </button>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="launch-pick" data-test="launch-pick">
        {!sel ? (
          <span className="muted">{T.launch.pick}</span>
        ) : sel.sku === undefined ? (
          <ul className="mlist">
            {visits.map(x => (
              <li key={x.asset} data-test="launch-pick-visit">
                {visitName(x.asset)}: {assets[x.asset] ? workName(assets[x.asset], x.work) : x.work} — {whenText(start, x.at)} · {x.booked ? T.launch.booked : T.launch.byRule}
              </li>
            ))}
          </ul>
        ) : (
          <ul className="mlist">
            <li className="muted">
              {skuName(sel.sku)}, {dayText(sel.day)}
              {off.has(sel.day) ? ` · ${T.launch.offDay}` : ''}
            </li>
            {picked?.jobs.map(j => (
              <li key={j.batch} data-test="launch-pick-job" data-batch={j.batch}>
                {label(labels, j)}
                {goal(j) ? ` · ${goal(j)}` : ''}
                {j.due !== undefined ? ` · ${T.launch.due(whenText(start, j.due))}` : ''}
                {draft(j) ? ` · ${draft(j)}` : ''}{' '}
                {j.fresh ? null : (
                  <>
                    <button type="button" className="link" onClick={() => actions.openDossier(Number(j.batch.slice(1)))} data-test="launch-dossier">
                      {T.launch.dossier}
                    </button>{' '}
                    <button type="button" className="link" onClick={() => actions.ganttBars(j.batch, j.notBefore)} title={T.jobs.showHint} data-test="launch-bars">
                      {T.jobs.show}
                    </button>
                  </>
                )}
              </li>
            ))}
            {picked?.rule.map(x => (
              <li key={`r${x.at}`} data-test="launch-pick-rule">
                {T.launch.ruleWhat(dayText(x.on), dayText(x.day))}{' '}
                <button type="button" disabled={!mine} title={mine ? T.launch.nowHint : title} onClick={() => actions.urgent(x.recipe, x.sku, undefined, x.at)} data-test="launch-now">
                  {T.launch.now}
                </button>
              </li>
            ))}
            {picked && picked.jobs.length + picked.rule.length === 0 ? <li className="muted">{T.launch.empty}</li> : null}
          </ul>
        )}
      </div>
    </div>
  );
}
