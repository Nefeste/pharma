// Панель кассы (docs/specs/2026-10-panels.md, 3в): «Хватит ли денег и когда они уйдут». Остаток и кредитная линия;
// календарь счетов по сроку с остатком после каждого и самой низкой точкой; проводки за сутки — с «почему». Вид собирает
// поток расчёта (src/sim/report.ts), панель только показывает и просит страницу.
import { momentOf, type Ymd } from '../engine/core/calendar';
import { dayText, money, named, T, whenText } from '../i18n';
import type { CashRow, CashWhy } from '../sim/report';
import { assetClass } from './assets';
import { db } from './db';
import type { Actions, Hud } from './store';

function whyText(w: CashWhy | undefined): string {
  if (!w) return '';
  switch (w.k) {
    case 'po':
      return T.cash.why.po(named(db?.suppliers[w.supplier]?.name, w.supplier), w.po);
    case 'spare':
      return T.cash.why.spare(named(db?.spares[w.spare]?.name, w.spare), w.order);
    case 'shipment':
      return named(db?.customers[w.customer]?.name, w.customer);
    case 'month':
      return T.cash.why.month(T.cash.months[w.m - 1], w.y, w.half);
    case 'quarter':
      return T.cash.why.quarter(w.q, w.y);
    case 'batch':
      return T.cash.why.batch(w.code);
    case 'asset':
      return T.cash.why.asset(assetClass(w), T.assets.inv(w.inv));
  }
}

const sumClass = (n: number) => `num ${n < 0 ? 'bad' : ''}`;

export function Cash({ hud, actions }: { hud: Hud; actions: Actions }) {
  const v = hud.cash.view;
  const start: Ymd = hud.start;
  const date = (t: number) => dayText(momentOf(start, t).day);
  const row = (r: CashRow, i: number, after?: number) => (
    <tr key={i}>
      <td className="nowrap">{after === undefined ? whenText(start, r.t) : date(r.t)}</td>
      <td>{T.cash.items[r.item]}</td>
      <td>{whyText(r.why)}</td>
      <td className={sumClass(r.sum)}>{money(r.sum, true)}</td>
      {after !== undefined ? <td className={sumClass(after)}>{money(after)}</td> : null}
    </tr>
  );
  return (
    <div className="stock panel cashp" id="cash" role="dialog" aria-labelledby="cash-title" data-test="cash">
      <div className="phead">
        <b id="cash-title">{T.cash.title}</b>
        <span className="muted">{T.cash.question}</span>
        <button type="button" className="close" onClick={() => actions.toggleCash()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {!v ? (
        <div className="muted">{T.app.loading}</div>
      ) : (
        <>
          <dl className="cashsum">
            <div>
              <dt>{T.cash.balance}</dt>
              <dd className={sumClass(v.balance)} data-test="cash-balance">
                {money(v.balance)}
              </dd>
            </div>
            <div>
              <dt>{T.cash.day}</dt>
              <dd className={sumClass(v.day)}>{money(v.day, true)}</dd>
            </div>
          </dl>
          <div>{T.cash.credit(money(v.limit), money(Math.max(0, -v.balance)), money(Math.max(0, v.limit + Math.min(0, v.balance))))}</div>
          {v.below !== undefined ? <div className="bad">{T.cash.below(whenText(start, v.below))}</div> : null}
          {v.low ? <div className={v.low.balance < -v.limit ? 'bad' : ''}>{T.cash.low(money(v.low.balance), date(v.low.t))}</div> : null}
          <div className="csec">{T.cash.calendar}</div>
          {v.total === 0 ? (
            <div className="muted">{T.cash.noDues}</div>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>{T.cash.cols.date}</th>
                  <th>{T.cash.cols.item}</th>
                  <th>{T.cash.cols.why}</th>
                  <th>{T.cash.cols.sum}</th>
                  <th>{T.cash.cols.after}</th>
                </tr>
              </thead>
              <tbody>{v.dues.map((r, i) => row(r, i, r.after))}</tbody>
            </table>
          )}
          {v.pages > 1 ? (
            <div className="pager">
              <button type="button" disabled={v.page === 0} onClick={() => actions.setCashPage(Math.max(0, v.page - 1))}>
                {T.cash.prev}
              </button>
              <span>{T.cash.page(v.page + 1, v.pages)}</span>
              <button type="button" disabled={v.page >= v.pages - 1} onClick={() => actions.setCashPage(v.page + 1)}>
                {T.cash.next}
              </button>
            </div>
          ) : null}
          <div className="csec">{T.cash.entries}</div>
          {v.entries.length === 0 ? (
            <div className="muted">{T.cash.noEntries}</div>
          ) : (
            <table className="grid">
              <tbody>{v.entries.map((r, i) => row(r, i))}</tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
