// Вкладка «Прогноз» окна расписания (Б6в; docs/specs/2026-10-vertical-slice.md, «Б6в»): над сеткой — способ планирования
// (политика «способ прогноза»: «лучший» или один из пяти), спрос правила задания (политика «спрос») и ошибка за 12
// месяцев; сетка — позиции плана выпуска строками, 18 месяцев столбцами: в клетке прогноз планирования, под ним мельче —
// отдела продаж; правка руками помечена, в подсказке — сколько было по способу. Клетку выбирают щелчком: под сеткой —
// ящики, «Поставить» и «Снять правку». Ниже — «прогноз против факта» позиции, продукта или всех: заказано — столбцами,
// прогнозы с запаздыванием в месяц — линиями, вперёд — пунктиром; одна ось — ящики; рядом — ошибка у планирования,
// отдела продаж и каждого способа; «Таблицей» — те же числа строками. Вид собран в потоке расчёта (src/sim/forecast.ts) —
// истины в нём нет.
import { useState } from 'react';
import type { FcMethod, Id } from '../content/types';
import { named, num, pctText, T } from '../i18n';
import type { FcErrs, FcPoint, FcShare, ForecastView } from '../sim/forecast';
import { actLabel, actOf, actOn } from './memo';
import { css, FC_COLOR, FC_H, FC_PAD, FC_W, fcGeom, runs } from './fcchart';
import { db } from './db';
import type { Actions, Hud } from './store';

const METHOD_OPTS = ['best', 'last-year', 'ma', 'ses', 'holt', 'group'] as const;
const DEMAND_OPTS = ['orders', 'forecast'] as const;
const ym = (n: number) => ({ y: Math.floor(n / 12), m: (n % 12) + 1 });
const monthShort = (n: number) => T.fc.short(ym(n).y, ym(n).m);
const monthLong = (n: number) => T.fc.month(ym(n).y, ym(n).m);
/** Доля со знаком: «+13 %», «−3 %». */
export const signed = (share: number, digits = 1) => `${share > 0 ? '+' : share < 0 ? '−' : ''}${pctText(Math.abs(share), digits)}`;
const shareText = (x?: FcShare) => (x ? T.fc.share(pctText(x.wape, 1), signed(x.bias)) : T.fc.noErr);

export function Forecast({ hud, actions, v }: { hud: Hud; actions: Actions; v: ForecastView }) {
  const [sel, setSel] = useState<{ sku: Id; i: number } | null>(null);
  const [cases, setCases] = useState('');
  const [table, setTable] = useState(false);
  const skuName = (id: Id) => named(db?.skus[id]?.name, id);
  const prodName = (id: Id) => named(db?.products[id]?.name, id);
  const methodName = (m: string) => T.fc.methods[m] ?? m;
  // правка — пост «Производство» или записка начальнику отдела планирования; политики — только свой пост
  const edit = actOf(hud, 'production', { kind: 'forecast', sku: '', m: 0 });
  const pol = actOf(hud, 'production', { kind: 'policy', policy: 'pol.plan.method', value: 'best' });
  const months = v.rows[0]?.cells.map((_, i) => v.at + i) ?? [];
  const row = sel ? v.rows.find(r => r.sku === sel.sku) : undefined;
  const cell = row && sel ? row.cells[sel.i] : undefined;
  const pick = (sku: Id, i: number) => {
    setSel({ sku, i });
    const c = v.rows.find(r => r.sku === sku)?.cells[i];
    setCases(c ? String(c.plan) : '');
  };
  const n = Number(cases);
  const ok = cases.trim() !== '' && Number.isInteger(n) && n >= 0;
  const products = [...new Set(v.rows.map(r => r.product))];
  const keys: { id: Id; name: string }[] = [...products.map(p => ({ id: p, name: prodName(p) })), ...v.rows.map(r => ({ id: r.sku, name: skuName(r.sku) }))];

  return (
    <div className="fc" data-test="fc">
      <div className="fc-head">
        <span className="filters" title={T.fc.methodHint} data-test="fc-method">
          <span className="muted">{T.fc.method}:</span>
          {METHOD_OPTS.map(m => (
            <button type="button" key={m} className={v.policy === m ? 'on' : ''} disabled={!pol.mine} title={pol.mine ? T.fc.methodHint : pol.title} onClick={() => v.policy !== m && actions.fcPolicy('pol.plan.method', m)} data-test="fc-method-opt" data-method={m}>
              {methodName(m)}
            </button>
          ))}
          {v.policy === 'best' ? <span className="muted" data-test="fc-method-now">{T.fc.methodNow(methodName(v.method))}</span> : null}
        </span>
        <span className="filters" title={T.fc.demandHint} data-test="fc-demand">
          <span className="muted">{T.fc.demand}:</span>
          {DEMAND_OPTS.map(d => (
            <button type="button" key={d} className={v.demand === d ? 'on' : ''} disabled={!pol.mine} title={pol.mine ? T.fc.demandHint : pol.title} onClick={() => v.demand !== d && actions.fcPolicy('pol.plan.demand', d)} data-test="fc-demand-opt" data-demand={d}>
              {T.fc.demands[d]}
            </button>
          ))}
        </span>
      </div>
      <div className="muted" data-test="fc-err">
        {T.fc.err(shareText(v.err.plan), shareText(v.err.sales))}
      </div>
      <div className="fc-scroll">
        <table className="grid fc-grid" data-test="fc-grid">
          <thead>
            <tr>
              <th>{T.fc.sku}</th>
              {months.map(m => (
                <th key={m} data-month={m}>
                  {monthShort(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.rows.map(r => (
              <tr key={r.sku} data-test="fc-row" data-sku={r.sku}>
                <th title={skuName(r.sku)}>{skuName(r.sku)}</th>
                {r.cells.map((c, i) => {
                  const on = sel?.sku === r.sku && sel.i === i;
                  const tip = [T.fc.cellHint(T.fc.cases(c.plan), T.fc.cases(c.sales)), c.edit ? T.fc.edited(methodName(v.method), T.fc.cases(c.was)) : ''].filter(Boolean).join('\n');
                  return (
                    <td key={i} className={`${c.edit ? 'edit' : ''}${on ? ' sel' : ''}`.trim() || undefined} title={tip} onClick={() => pick(r.sku, i)} data-test="fc-cell" data-month={v.at + i} data-edit={c.edit ? '1' : undefined}>
                      <b>{num(c.plan)}</b>
                      {c.edit ? <span className="fc-mark">✎</span> : null}
                      <br />
                      <small className="muted">{num(c.sales)}</small>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fc-pick" data-test="fc-pick">
        {!sel || !cell ? (
          <span className="muted">{T.fc.pick}</span>
        ) : (
          <>
            <span>{T.fc.at(skuName(sel.sku), monthLong(v.at + sel.i))}</span>{' '}
            <span className="muted">{T.fc.cellHint(T.fc.cases(cell.plan), T.fc.cases(cell.sales))}</span>
            {cell.edit ? <span className="muted"> · {T.fc.edited(methodName(v.method), T.fc.cases(cell.was))}</span> : null}{' '}
            <label>
              {T.fc.input}{' '}
              <input type="number" min={0} step={1} value={cases} onChange={e => setCases(e.target.value)} data-test="fc-input" />
            </label>{' '}
            <button type="button" disabled={!actOn(edit) || !ok} title={edit.mine ? T.fc.setHint : edit.title} onClick={() => actions.fcEdit(sel.sku, v.at + sel.i, n, !edit.mine)} data-test="fc-set" data-memo={edit.memo ?? undefined}>
              {actLabel(edit, T.fc.set)}
            </button>{' '}
            {cell.edit ? (
              <button type="button" disabled={!actOn(edit)} title={edit.mine ? T.fc.unsetHint : edit.title} onClick={() => actions.fcEdit(sel.sku, v.at + sel.i, undefined, !edit.mine)} data-test="fc-unset">
                {actLabel(edit, T.fc.unset)}
              </button>
            ) : null}
          </>
        )}
      </div>
      <div className="fc-chart-head">
        <b>{T.fc.chart}</b>
        <span className="filters" data-test="fc-keys">
          {keys.map(k => (
            <button type="button" key={k.id} className={v.key === k.id ? 'on' : ''} onClick={() => actions.fcKey(k.id)} data-test="fc-key" data-key={k.id}>
              {k.name}
            </button>
          ))}
        </span>
        <button type="button" className={table ? 'on' : ''} onClick={() => setTable(!table)} data-test="fc-table-toggle">
          {T.fc.table}
        </button>
      </div>
      <div className="fc-chart-row">
        <div className="fc-chart-box">
          {table ? <FcTable past={v.past} ahead={v.ahead} /> : <FcChart past={v.past} ahead={v.ahead} />}
          <div className="fc-legend muted" title={T.fc.chartHint}>
            <span>
              <i className="sw bar" style={{ background: css(FC_COLOR.fact) }} />
              {T.fc.fact}
            </span>
            <span>
              <i className="sw dot" style={{ background: css(FC_COLOR.plan) }} />
              {T.fc.plan}
            </span>
            <span>
              <i className="sw sq" style={{ background: css(FC_COLOR.sales) }} />
              {T.fc.sales}
            </span>
            <span>{T.fc.chartHint}</span>
          </div>
        </div>
        <ErrTable e={v.keyErr} method={v.method} />
      </div>
    </div>
  );
}

/** Ошибка за 12 месяцев: планирование, отдел продаж — чей ближе, — и каждый способ по проверке на скользящем начале. */
function ErrTable({ e, method }: { e: FcErrs; method: FcMethod }) {
  const closer = e.plan && e.sales ? (e.plan.wape <= e.sales.wape ? 'plan' : 'sales') : undefined;
  const row = (key: string, name: string, x: FcShare | undefined, mark?: string) => (
    <tr key={key} data-test="fc-err-row" data-who={key}>
      <th>
        {name}
        {mark ? <span className="muted"> · {mark}</span> : null}
      </th>
      <td>{x ? pctText(x.wape, 1) : '—'}</td>
      <td>{x ? signed(x.bias) : '—'}</td>
    </tr>
  );
  return (
    <table className="grid fc-errs" data-test="fc-errs">
      <thead>
        <tr>
          <th>{T.fc.who}</th>
          <th>{T.fc.wape}</th>
          <th>{T.fc.bias}</th>
        </tr>
      </thead>
      <tbody>
        {row('plan', T.fc.plan, e.plan, closer === 'plan' ? T.fc.closer : undefined)}
        {row('sales', T.fc.sales, e.sales, closer === 'sales' ? T.fc.closer : undefined)}
        {(['last-year', 'ma', 'ses', 'holt', 'group'] as const).map(m => row(m, `${T.fc.byMethod} «${T.fc.methods[m]}»`, e.by[m], m === method ? T.fc.methodNow(T.fc.methods[m]) : undefined))}
      </tbody>
    </table>
  );
}

/** Подсказка месяца: заказано и прогнозы, что есть. */
const tipOf = (p: FcPoint) =>
  T.fc.tip(
    monthLong(p.m),
    [p.fact !== undefined ? `${T.fc.fact} ${T.fc.cases(p.fact)}` : '', p.plan !== undefined ? `${T.fc.plan} ${T.fc.cases(p.plan)}` : '', p.sales !== undefined ? `${T.fc.sales} ${T.fc.cases(p.sales)}` : ''].filter(Boolean).join('; '),
  );

/** График: столбики факта, линии прогнозов — сплошные в прошлом, пунктир вперёд; кружок — планирование, квадрат — продажи. */
function FcChart({ past, ahead }: { past: readonly FcPoint[]; ahead: readonly FcPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const g = fcGeom(past, ahead);
  const bw = Math.max(2, g.slot - 2);
  const every = Math.max(1, Math.ceil(g.n / 12));
  return (
    <svg className="chart fc-chart" viewBox={`0 0 ${FC_W} ${FC_H}`} width="100%" role="img" aria-label={T.fc.chart} data-test="fc-chart" onMouseLeave={() => setHover(null)}>
      {g.ticks.map(t => (
        <g key={t} className="grid-y">
          <line x1={FC_PAD.l} x2={FC_W - FC_PAD.r} y1={g.y(t)} y2={g.y(t)} />
          <text x={FC_PAD.l - 4} y={g.y(t) + 3} textAnchor="end">
            {num(t)}
          </text>
        </g>
      ))}
      <text className="axis" x={4} y={FC_PAD.t + 8}>
        {T.fc.axis}
      </text>
      {g.split > 0 && g.split < g.n ? <line className="fc-now" x1={FC_PAD.l + g.slot * g.split} x2={FC_PAD.l + g.slot * g.split} y1={FC_PAD.t} y2={FC_H - FC_PAD.b} /> : null}
      {g.points.map((p, i) =>
        p.fact !== undefined && p.fact > 0 ? <rect key={`b${i}`} x={g.x(i) - bw / 2} y={g.y(p.fact)} width={bw} height={Math.max(0, g.y(0) - g.y(p.fact))} rx={2} fill={css(FC_COLOR.fact)} data-test="fc-bar" /> : null,
      )}
      {(['plan', 'sales'] as const).map(k => (
        <g key={k}>
          {runs(g, k, 0, g.split).map((pts, j) => (
            <polyline key={`p${j}`} points={pts} fill="none" stroke={css(FC_COLOR[k])} strokeWidth={2} data-test={`fc-line-${k}`} />
          ))}
          {runs(g, k, Math.max(0, g.split - 1), g.n).map((pts, j) => (
            <polyline key={`a${j}`} points={pts} fill="none" stroke={css(FC_COLOR[k])} strokeWidth={2} strokeDasharray="5 4" data-test={`fc-ahead-${k}`} />
          ))}
          {g.points.map((p, i) => {
            const val = p[k];
            if (val === undefined) return null;
            return k === 'plan' ? <circle key={i} cx={g.x(i)} cy={g.y(val)} r={hover === i ? 4.5 : 3} fill={css(FC_COLOR.plan)} /> : <rect key={i} x={g.x(i) - (hover === i ? 4 : 3)} y={g.y(val) - (hover === i ? 4 : 3)} width={hover === i ? 8 : 6} height={hover === i ? 8 : 6} fill={css(FC_COLOR.sales)} />;
          })}
        </g>
      ))}
      {g.points.map((p, i) =>
        i % every === 0 ? (
          <text key={`x${i}`} className="axis" x={g.x(i)} y={FC_H - 6} textAnchor="middle">
            {monthShort(p.m)}
          </text>
        ) : null,
      )}
      {hover !== null ? <line className="fc-cross" x1={g.x(hover)} x2={g.x(hover)} y1={FC_PAD.t} y2={g.y(0)} /> : null}
      {g.points.map((p, i) => (
        <rect key={`h${i}`} className="fc-hit" x={FC_PAD.l + g.slot * i} y={FC_PAD.t} width={g.slot} height={g.y(0) - FC_PAD.t} onMouseEnter={() => setHover(i)} data-test="fc-month" data-month={p.m}>
          <title>{tipOf(p)}</title>
        </rect>
      ))}
      {hover !== null ? (
        <text className="fc-tip" x={Math.min(FC_W - FC_PAD.r - 4, Math.max(FC_PAD.l + 4, g.x(hover)))} y={FC_PAD.t + 10} textAnchor={g.x(hover) > FC_W / 2 ? 'end' : 'start'}>
          {tipOf(g.points[hover])}
        </text>
      ) : null}
    </svg>
  );
}

/** Те же числа строками: месяц, заказано, планирование, отдел продаж. */
function FcTable({ past, ahead }: { past: readonly FcPoint[]; ahead: readonly FcPoint[] }) {
  return (
    <div className="fc-table">
      <table className="grid" data-test="fc-table">
        <thead>
          <tr>
            <th />
            <th>{T.fc.fact}</th>
            <th>{T.fc.plan}</th>
            <th>{T.fc.sales}</th>
          </tr>
        </thead>
        <tbody>
          {[...past, ...ahead].map(p => (
            <tr key={p.m}>
              <th>{monthLong(p.m)}</th>
              <td>{p.fact !== undefined ? num(p.fact) : '—'}</td>
              <td>{p.plan !== undefined ? num(p.plan) : '—'}</td>
              <td>{p.sales !== undefined ? num(p.sales) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
