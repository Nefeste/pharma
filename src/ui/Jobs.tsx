// Вкладка «Задания» окна расписания (Б6а; docs/specs/2026-10-vertical-slice.md, «Б6а»): строка на задание — номер к
// досье, позиция, под что, срок, «не раньше», состояние словами, ожидаемый выпуск, опоздание к сроку и «Полосы» — его
// полосы в расписании; отбор — в плане, в работе, выпущены и отменены за 7 суток; у задания до комплектовки —
// «Отменить» в черновик, у чужого поста погашена. Под списком — заказы без покрытия со «Срочным заданием под заказ». Вид
// собран в потоке расчёта (src/sim/jobs.ts) — истины в нём нет.
import type { Id } from '../content/types';
import { DAY } from '../engine/core/calendar';
import { named, T, whenText } from '../i18n';
import type { JobRow, Jobs as JobsView } from '../sim/jobs';
import { db } from './db';
import { type Actions, holds, type Hud, type JobsFilter } from './store';

const FILTERS: JobsFilter[] = ['plan', 'work', 'done', 'cancelled'];

/** К какому отбору строка: до комплектовки — в плане; выпущена или отклонена — выпущены; отменена; остальное — в работе. */
export function filterOf(r: Pick<JobRow, 'status'>): JobsFilter {
  if (r.status === 'waiting' || r.status === 'reserved') return 'plan';
  if (r.status === 'released' || r.status === 'rejected') return 'done';
  return r.status === 'cancelled' ? 'cancelled' : 'work';
}

const sku = (id?: Id) => (id ? named(db?.skus[id]?.name, id) : '—');

export function Jobs({ hud, actions, jobs, mine, items }: { hud: Hud; actions: Actions; jobs: JobsView; mine: boolean; items: { recipe: Id; sku: Id }[] }) {
  const g = hud.gantt;
  const start = hud.start;
  const f = g.jobs ?? 'plan';
  const when = (t?: number) => (t === undefined ? '—' : whenText(start, t));
  const rows = jobs.rows.filter(r => filterOf(r) === f);
  const count = (x: JobsFilter) => jobs.rows.filter(r => filterOf(r) === x).length;
  // отменяет пост «Производство» или директор; у чужого поста записку об отмене не пишут — кнопка погашена (Б5б)
  const own = holds(hud, 'production');

  /** Состояние словами: ждёт своего дня или материала — какого, на стадии — какой; остальное — как в карточке. */
  const state = (r: JobRow): string => {
    if (r.status === 'waiting' && r.material) return T.jobs.material(named(db?.materials[r.material]?.name, r.material));
    if (r.status === 'reserved' && r.notBefore > hud.t) return T.jobs.day;
    if (r.status === 'process' && r.stage) return T.jobs.stage(T.stages[r.stage] ?? r.stage);
    if (r.status === 'cancelled' && r.cancelled !== undefined) return T.jobs.cancelledAt(when(r.cancelled));
    return T.dossier.status[r.status] ?? r.status;
  };
  const goal = (r: JobRow) => (!r.goal ? '—' : r.goal.kind === 'stock' ? T.jobs.stock : T.jobs.forOrder(r.goal.customer ? named(db?.customers[r.goal.customer]?.name, r.goal.customer) : r.goal.order));
  const late = (r: JobRow) => (r.late === undefined ? '' : T.jobs.late(Math.ceil(r.late / DAY)));

  return (
    <div className="jobs" data-test="jobs">
      <div className="filters" data-test="jobs-filters">
        {FILTERS.map(x => (
          <button type="button" key={x} className={f === x ? 'on' : ''} onClick={() => actions.jobsFilter(x)} data-test={`jobs-filter-${x}`}>
            {T.jobs.filters[x]} · {count(x)}
          </button>
        ))}
        {jobs.tail === undefined ? <span className="muted">{T.jobs.noTail}</span> : <span className="muted">{T.jobs.tail(Math.round((jobs.tail / DAY) * 10) / 10)}</span>}
      </div>
      {rows.length === 0 ? (
        <div className="muted">{T.jobs.empty}</div>
      ) : (
        <table className="grid jobs-grid" data-test="jobs-table">
          <thead>
            <tr>
              {T.jobs.cols.map(c => (
                <th key={c}>{c}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const dropped = g.drop.includes(r.id);
              return (
                <tr key={r.id} className={dropped ? 'muted' : undefined} data-test="jobs-row" data-batch={r.id} data-status={r.status} data-late={r.late !== undefined ? '1' : '0'} data-goal={r.goal?.kind ?? ''}>
                  <td>
                    <button type="button" className="link" onClick={() => actions.openDossier(r.n)} title={T.jobs.cardHint}>
                      {r.code ? T.now.batch(r.code) : T.jobs.order(r.n)}
                    </button>
                  </td>
                  <td>{sku(r.sku)}</td>
                  <td data-test="jobs-goal">{goal(r)}</td>
                  <td data-test="jobs-due">{when(r.due)}</td>
                  <td>{when(r.notBefore)}</td>
                  <td>{state(r)}</td>
                  <td data-test="jobs-expect">{r.status === 'released' ? when(r.expect) : r.expect === undefined ? '—' : when(r.expect)}</td>
                  <td className={r.late !== undefined ? 'bad' : undefined} data-test="jobs-late">
                    {late(r)}
                  </td>
                  <td>
                    <button type="button" className="small" onClick={() => actions.ganttBars(r.id, r.at)} title={T.jobs.showHint} data-test="jobs-bars">
                      {T.jobs.show}
                    </button>{' '}
                    {r.open ? (
                      <button
                        type="button"
                        className="small"
                        disabled={!own}
                        onClick={() => actions.dropJob(r.id)}
                        title={!own ? T.seats.notYours(T.seats.names.production) : dropped ? T.jobs.undoHint : T.jobs.cancelHint}
                        data-test="jobs-cancel"
                      >
                        {dropped ? T.jobs.undo : T.jobs.cancel}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="phead">
        <b>{T.jobs.uncovered}</b>
        <span className="muted">{T.jobs.uncoveredHint}</span>
      </div>
      {jobs.uncovered.length === 0 ? (
        <div className="muted" data-test="uncovered-none">
          {T.jobs.covered}
        </div>
      ) : (
        <ul className="plain" data-test="uncovered">
          {jobs.uncovered.map(u => {
            const it = items.find(x => x.sku === u.sku);
            return (
              <li key={`${u.order}/${u.sku}`} data-test="uncovered-row" data-order={u.order} data-sku={u.sku}>
                {T.jobs.short(named(db?.customers[u.customer]?.name, u.customer), sku(u.sku), u.short, u.cases, when(u.due))}{' '}
                {mine && it ? (
                  <button type="button" className="small" onClick={() => actions.urgent(it.recipe, u.sku, u.order)} title={T.jobs.urgentHint} data-test="uncovered-urgent">
                    {T.jobs.urgent}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
