// Панель лаборатории (docs/specs/2026-10-panels.md, 3г): очередь — партии на пути через лабораторию, их испытания и чего
// они ждут, «Поднять пробу» — команда игрока; контрольная карта X–Rm средней массы таблеток по МОК — точки, границы,
// признаки особых причин, допуск пунктиром. Виды собирает поток расчёта (src/sim/lab.ts); здесь — слова и рисунок.
import type { Ymd } from '../engine/core/calendar';
import { named, num, T, whenText } from '../i18n';
import type { ChartView, LabLotRow, Limits, Signal, TaskNow } from '../sim/lab';
import { db } from './db';
import { type Actions, type Hud, holds } from './store';

function nowText(n: TaskNow | undefined, start: Ymd): string {
  if (!n) return '';
  const task = T.tasks[n.task] ?? n.task;
  if (n.busy) return T.why.taskBusy(task);
  return n.wait ? T.why.taskWait(task, T.wait[n.wait], whenText(start, n.since)) : T.why.taskOpen(task);
}

/** Доли 1/10 000 номинала — процентами с двумя знаками. */
const pct = (v: number) => `${num(v / 100, 2)} %`;

function Queue({ rows, start, actions, mine }: { rows: LabLotRow[]; start: Ymd; actions: Actions; mine: boolean }) {
  if (rows.length === 0) return <div className="muted empty">{T.lab.empty}</div>;
  return (
    <table className="grid lab" data-test="lab-queue">
      <thead>
        <tr>
          <th>{T.lab.cols.lot}</th>
          <th>{T.lab.cols.stage}</th>
          <th>{T.lab.cols.waits}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <LotRows key={r.lot} r={r} start={start} actions={actions} mine={mine} />
        ))}
      </tbody>
    </table>
  );
}

function LotRows({ r, start, actions, mine }: { r: LabLotRow; start: Ymd; actions: Actions; mine: boolean }) {
  return (
    <>
      <tr className="lot" data-test="lab-row" data-lot={r.lot}>
        <td>
          {r.rush ? <span className="rush" title={T.lab.rushed}>▲ </span> : null}
          <span className="mono">{T.lotCode(...r.code)}</span> {named(db?.materials[r.material]?.name, r.material)}
        </td>
        <td>{r.stage === 'tests' ? T.lab.stageTests(r.done, r.all) : T.lab.stage[r.stage]}</td>
        <td className="muted">{nowText(r.now, start)}</td>
        <td className="nowrap">
          <button
            type="button"
            disabled={r.rush || !mine}
            onClick={() => actions.rush(r.lot)}
            title={mine ? T.lab.rushHint : T.seats.notYours(T.seats.names.quality)}
            data-test="lab-rush"
          >
            {r.rush ? T.lab.rushed : T.lab.rush}
          </button>
        </td>
      </tr>
      {r.tests.map((q, i) => {
        const m = db?.tests[q.method];
        return (
          <tr key={i} className="test">
            <td className="sub">
              {named(m?.name, q.method)}
              {q.inv ? <span className="muted"> · {T.lab.invTest}</span> : null}
            </td>
            <td>
              {T.lab.state[q.state]}
              {q.inst ? <span className="muted"> · {named(db?.instruments[q.inst]?.name, q.inst)}</span> : null}
            </td>
            <td className="muted">{nowText(q.now, start)}</td>
            <td className={q.pass === false ? 'bad' : ''}>{q.result !== undefined ? T.lab.result(q.pass !== false) : ''}</td>
          </tr>
        );
      })}
    </>
  );
}

const W = 720;
const HX = 210;
const HM = 90;
const PAD = { l: 64, r: 12, t: 10, b: 18 };

/** Карта X–Rm: значения сверху, скользящие размахи снизу; линии — центральная, границы, допуск. */
function Chart({ v, start }: { v: ChartView; start: Ymd }) {
  const pts = v.points;
  if (pts.length === 0) return <div className="muted empty">{T.lab.noPoints}</div>;
  const l: Limits | undefined = v.limits;
  const ys = [...pts.map(p => p.v), ...(l ? [l.ucl, l.lcl] : []), ...(v.spec?.min !== undefined ? [v.spec.min] : []), ...(v.spec?.max !== undefined ? [v.spec.max] : [])];
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const x = (i: number) => PAD.l + (pts.length === 1 ? 0 : (i * (W - PAD.l - PAD.r)) / (pts.length - 1));
  const y = (val: number) => PAD.t + ((hi + span * 0.05 - val) * (HX - PAD.t - PAD.b)) / (span * 1.1);
  const mrs = pts.map((p, i) => (i > 0 ? Math.abs(p.v - pts[i - 1].v) : undefined));
  const mrHi = Math.max(1, ...mrs.filter((m): m is number => m !== undefined), ...(l ? [l.mrUcl] : []));
  const ym = (val: number) => HX + PAD.t + ((mrHi * 1.1 - val) * (HM - PAD.t - PAD.b)) / (mrHi * 1.1);
  const line = (val: number, cls: string, label: string, f: (n: number) => number) => (
    <g className={cls}>
      <line x1={PAD.l} x2={W - PAD.r} y1={f(val)} y2={f(val)} />
      <text x={PAD.l - 4} y={f(val) + 3} textAnchor="end">
        {label}
      </text>
    </g>
  );
  const flagged = pts.map((p, i) => ({ p, i })).filter(({ p }) => p.signals.length > 0);
  return (
    <>
      <div className="chartsum">
        {l ? T.lab.limits(pct(l.mean), pct(l.lcl), pct(l.ucl), pts.length) : T.lab.fewPoints}
        {l && v.preliminary ? <span className="muted"> · {T.lab.preliminary}</span> : null}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${HX + HM}`} width="100%" role="img" aria-label={T.lab.chartTitle} data-test="lab-chart">
        {v.spec?.min !== undefined ? line(v.spec.min, 'spec', T.lab.spec, y) : null}
        {v.spec?.max !== undefined ? line(v.spec.max, 'spec', T.lab.spec, y) : null}
        {l ? (
          <>
            {line(l.ucl, 'lim', pct(l.ucl), y)}
            {line(l.mean, 'cl', pct(l.mean), y)}
            {line(l.lcl, 'lim', pct(l.lcl), y)}
            {line(l.mrUcl, 'lim', num(l.mrUcl / 100, 2), ym)}
            {line(l.mr, 'cl', num(l.mr / 100, 2), ym)}
          </>
        ) : null}
        <polyline className="trace" points={pts.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')} />
        <polyline className="trace" points={mrs.map((m, i) => (m === undefined ? '' : `${x(i)},${ym(m)}`)).filter(Boolean).join(' ')} />
        {pts.map((p, i) => {
          const bad = p.signals.some(s => s !== 'mr');
          const tip = `${T.card.batch} ${T.batchCode(...p.batch)} · ${whenText(start, p.t)} · ${pct(p.v)}`;
          return bad ? (
            <rect key={i} className="pt bad" x={x(i) - 4} y={y(p.v) - 4} width={8} height={8} transform={`rotate(45 ${x(i)} ${y(p.v)})`}>
              <title>{tip}</title>
            </rect>
          ) : (
            <circle key={i} className="pt" cx={x(i)} cy={y(p.v)} r={3}>
              <title>{tip}</title>
            </circle>
          );
        })}
        {mrs.map((m, i) =>
          m === undefined ? null : (
            <circle key={`m${i}`} className={pts[i].signals.includes('mr') ? 'pt bad' : 'pt'} cx={x(i)} cy={ym(m)} r={2.5} />
          ),
        )}
        <text className="axis" x={PAD.l} y={HX - 2}>
          {T.lab.xAxis}
        </text>
        <text className="axis" x={PAD.l} y={HX + HM - 2}>
          {T.lab.mrAxis}
        </text>
      </svg>
      {flagged.length > 0 ? (
        <ul className="mlist" data-test="lab-signals">
          {flagged.slice(-8).map(({ p, i }) => (
            <li key={i} className="bad">
              {T.lab.point(i + 1, T.batchCode(...p.batch), whenText(start, p.t))}: {p.signals.map((s: Signal) => T.lab.signal[s]).join(', ')}
            </li>
          ))}
        </ul>
      ) : (
        <div className="muted">{T.lab.noSignals}</div>
      )}
    </>
  );
}

export function Lab({ hud, actions }: { hud: Hud; actions: Actions }) {
  const { tab, view, chart } = hud.lab;
  return (
    <div className="stock panel labp" id="lab" role="dialog" aria-labelledby="lab-title" data-test="lab">
      <div className="phead">
        <b id="lab-title">{T.lab.title}</b>
        <span className="muted">{tab === 'queue' ? T.lab.question : T.lab.chartQuestion}</span>
        <button type="button" className="close" onClick={() => actions.toggleLab()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      <div className="filters">
        <button type="button" className={tab === 'queue' ? 'on' : ''} onClick={() => actions.setLabTab('queue')} data-test="lab-tab-queue">
          {T.lab.queue}
        </button>
        <button type="button" className={tab === 'chart' ? 'on' : ''} onClick={() => actions.setLabTab('chart')} data-test="lab-tab-chart">
          {T.lab.chartTitle}
        </button>
      </div>
      {tab === 'queue' ? (
        view ? (
          <>
            <div className="muted">
              {T.lab.instruments}:{' '}
              {view.instruments
                .map(i => `${named(db?.instruments[i.type]?.name, i.type)} — ${i.method ? T.lab.busyWith(named(db?.tests[i.method]?.name, i.method)) : T.lab.free}`)
                .join('; ')}
            </div>
            <Queue rows={view.rows} start={hud.start} actions={actions} mine={holds(hud, 'quality')} />
          </>
        ) : (
          <div className="muted">{T.app.loading}</div>
        )
      ) : chart ? (
        <Chart v={chart} start={hud.start} />
      ) : (
        <div className="muted">{T.app.loading}</div>
      )}
    </div>
  );
}
