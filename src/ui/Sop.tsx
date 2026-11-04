// Окно совещания S&OP (Б6г; docs/specs/2026-10-vertical-slice.md, «Б6г»; геймдизайн, §9.2): одна страница на 6 месяцев
// по продуктам, большое окно поверх карты, как политики. Сверху — план: цели запаса по продуктам и месяцам из вариантов
// политики «запас позиций», у открытого совещания — лучший план рядом; цель плана, «до лучшего плана», «Утвердить» и
// «Сбросить». Ниже — спрос, мощности с линией резерва и узким местом, запас в сутках продаж по позициям — красный и
// жёлтый со словом, деньги на три месяца, люди под план с рычагами. Вид собирает поток расчёта (src/sim/sop.ts); слова и
// цвета — здесь.
import type { Id } from '../content/types';
import { hText, money, named, num, pctText, T, whenText } from '../i18n';
import type { SopFlag, SopResRow, SopView } from '../sim/sop';
import { db } from './db';
import { type Actions, holds, type Hud } from './store';

/** Строки кассы по порядку — как у движка (src/engine/plan/sop.ts, `SOP_CASH_ROWS`). */
const CASH_ROWS = ['dues', 'sales', 'materials', 'wages', 'energy', 'vat'] as const;

const monthWord = (n: number) => T.fc.month(Math.floor(n / 12), (n % 12) + 1);
const productName = (id: Id) => named(db?.products[id]?.name, id);
const skuName = (id: Id) => named(db?.skus[id]?.name, id);
const roleName = (id: Id) => named(db?.roles[id]?.name, id);

/** Доля нагрузки ресурса: сверх мощности — красный, сверх линии резерва — жёлтый. */
function resClass(r: SopResRow, i: number): string {
  if (r.load[i] > r.cap[i]) return 'bad';
  return r.load[i] > r.line[i] ? 'warn' : '';
}

/** Клетка ресурса: доля мощности; у заданий — серии против рабочих дней. */
function resCell(r: SopResRow, i: number): { text: string; title: string } {
  if (r.res === 'slot') return { text: T.sop.slots(r.load[i], r.cap[i]), title: T.sop.slotHint(r.load[i], r.cap[i]) };
  const share = r.cap[i] > 0 ? Math.floor((r.load[i] * 10000) / r.cap[i]) : 0;
  return { text: r.cap[i] > 0 ? pctText(share) : '—', title: T.sop.resHint(hText(r.load[i]), hText(r.cap[i]), hText(r.line[i])) };
}

const flagClass = (f: SopFlag | undefined) => (f === 'short' ? 'bad' : f ? 'warn' : '');

/** План: продукты строками, месяцы столбцами; в клетке — выбор цели; у открытого совещания — лучший план под ней. */
function Plan({ v, actions }: { v: SopView; actions: Actions }) {
  const months = Array.from({ length: v.cover[v.products[0]]?.length ?? 0 }, (_, i) => v.from + i);
  return (
    <table className="ptab sopgrid" data-test="sop-plan">
      <thead>
        <tr>
          <th>{T.sop.coverHead}</th>
          {months.map(m => (
            <th key={m}>{monthWord(m)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {v.products.map(p => (
          <tr key={p} data-test="sop-row" data-product={p}>
            <td>{productName(p)}</td>
            {v.cover[p].map((c, i) => {
              const best = v.open?.best[p]?.[i];
              return (
                <td key={i} className={v.shown === 'draft' && best !== undefined && best !== c ? 'drafted' : ''}>
                  <select value={c} onChange={e => actions.setSopCell(p, i, Number(e.target.value))} aria-label={T.sop.cellHint(productName(p), monthWord(months[i]))} title={T.sop.cellHint(productName(p), monthWord(months[i]))} data-test="sop-cell" data-product={p} data-i={i} data-v={c}>
                    {v.covers.map(x => (
                      <option key={x} value={x}>
                        {T.sop.days(x)}
                      </option>
                    ))}
                  </select>
                  {best !== undefined && best !== c ? (
                    <div className="muted small" data-test="sop-best" data-v={best}>
                      {T.sop.best(T.sop.days(best))}
                    </div>
                  ) : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Состояние совещания: идёт, утверждён план, плана нет; следующее совещание. */
function State({ v, hud }: { v: SopView; hud: Hud }) {
  const by = (x: string) => (x === 'player' ? T.journal.player('') : T.sop.colleague);
  const lines: string[] = [];
  if (v.open) lines.push(T.sop.open(whenText(hud.start, v.open.at)));
  else if (v.approved && v.shown !== 'policy') lines.push(T.sop.approved(whenText(hud.start, v.approved.at), by(v.approved.by)));
  else lines.push(T.sop.noPlan(T.sop.days(v.policy)));
  lines.push(T.sop.next(whenText(hud.start, v.next)));
  return (
    <div className="muted" data-test="sop-state" data-shown={v.shown} data-open={v.open ? 1 : 0}>
      {lines.join(' · ')}
    </div>
  );
}

/** Итог плана: цель, маржа и цена денег в запасе, не продано, «до лучшего плана»; «Утвердить» и «Сбросить». */
function Result({ v, hud, actions }: { v: SopView; hud: Hud; actions: Actions }) {
  const mine = holds(hud, 'production');
  return (
    <div className="sopres" data-test="sop-result" data-value={v.value} data-gap={v.gap ?? ''}>
      <div>
        <b>{T.sop.value(money(v.value))}</b> <span className="muted">{T.sop.valueWhat(money(v.margin), money(v.carry), pctText(v.err))}</span>
      </div>
      <div className={v.short > 0 ? 'warn' : 'muted'}>{T.sop.short(num(v.short), money(v.lost), pctText(v.err), num(v.high))}</div>
      {v.gap !== undefined ? (
        <div className={v.gap > 0 ? 'warn' : 'muted'} data-test="sop-gap">
          {T.sop.gap(money(v.gap))}
        </div>
      ) : null}
      {v.over !== undefined ? (
        <div className="warn" data-test="sop-over" data-v={v.over}>
          {T.sop.above(money(v.over))}
        </div>
      ) : null}
      <div className="cbtns">
        <button type="button" disabled={!v.open || !mine} onClick={() => actions.approveSop()} data-test="sop-approve" title={v.open ? (mine ? T.sop.approveHint : T.sop.notYours) : T.sop.closed}>
          {T.sop.approve}
        </button>
        <button type="button" disabled={!hud.sop.draft} onClick={() => actions.resetSop()} data-test="sop-reset">
          {T.sop.reset}
        </button>
        {v.shown === 'draft' ? <span className="muted small">{T.sop.drafted}</span> : null}
        {v.open && !mine ? <span className="muted small">{T.sop.notYours}</span> : null}
      </div>
    </div>
  );
}

/** Шапка месяцев блока. */
function Head({ v, n, first }: { v: SopView; n: number; first: string }) {
  return (
    <thead>
      <tr>
        <th>{first}</th>
        {Array.from({ length: n }, (_, i) => (
          <th key={i}>{monthWord(v.from + i)}</th>
        ))}
      </tr>
    </thead>
  );
}

function Demand({ v }: { v: SopView }) {
  const n = v.demand[0]?.plan.length ?? 0;
  const rows: { key: string; label: string; of: (r: SopView['demand'][number]) => (number | undefined)[]; f: (x: number) => string }[] = [
    { key: 'plan', label: T.sop.demand.plan, of: r => r.plan, f: x => num(x) },
    { key: 'sales', label: T.sop.demand.sales, of: r => r.sales, f: x => num(x) },
    { key: 'year', label: T.sop.demand.year, of: r => r.year, f: x => num(x) },
    { key: 'need', label: T.sop.demand.need, of: r => r.need, f: x => num(x / 10, 1) },
    { key: 'batches', label: T.sop.demand.batches, of: r => r.batches, f: x => num(x) },
  ];
  return (
    <table className="ptab sopgrid" data-test="sop-demand">
      <Head v={v} n={n} first={T.sop.demand.head} />
      <tbody>
        {v.demand.map(d => [
          <tr key={d.product} className="sopsub">
            <td colSpan={n + 1}>{productName(d.product)}</td>
          </tr>,
          ...rows.map(r => (
            <tr key={`${d.product}/${r.key}`} data-test="sop-demand-row" data-product={d.product} data-key={r.key}>
              <td>{r.label}</td>
              {r.of(d).map((x, i) => (
                <td key={i}>{x === undefined ? '—' : r.f(x)}</td>
              ))}
            </tr>
          )),
        ])}
      </tbody>
    </table>
  );
}

function Capacity({ v }: { v: SopView }) {
  const n = v.res[0]?.load.length ?? 0;
  return (
    <table className="ptab sopgrid" data-test="sop-capacity">
      <Head v={v} n={n} first={T.sop.resHead(pctText(Math.floor((v.reserve[0] * 10000) / v.reserve[1])))} />
      <tbody>
        {v.res.map(r => (
          <tr key={r.res} data-test="sop-res" data-res={r.res}>
            <td>{T.sop.res[r.res] ?? r.res}</td>
            {r.load.map((_, i) => {
              const c = resCell(r, i);
              const cls = resClass(r, i);
              return (
                // слова «сверх мощности» в узком столбце — переносом, а не многоточием
                <td key={i} className={cls ? `${cls} wrap` : undefined} title={c.title} data-test="sop-load" data-load={r.load[i]} data-cap={r.cap[i]} data-line={r.line[i]}>
                  {c.text}
                  {cls === 'bad' ? ` ${T.sop.over}` : cls === 'warn' ? ` ${T.sop.reserveWord}` : ''}
                </td>
              );
            })}
          </tr>
        ))}
        <tr data-test="sop-bottleneck">
          <td>{T.sop.bottleneck}</td>
          {v.bottleneck.map((b, i) => (
            <td key={i} data-res={b ?? ''}>
              {b ? (T.sop.res[b] ?? b) : '—'}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function Stock({ v }: { v: SopView }) {
  const n = v.stock[0]?.days.length ?? 0;
  return (
    <table className="ptab sopgrid" data-test="sop-stock">
      <Head v={v} n={n} first={T.sop.stockHead} />
      <tbody>
        {v.stock.map(r => (
          <tr key={r.sku} data-test="sop-stock-row" data-sku={r.sku}>
            <td>{skuName(r.sku)}</td>
            {r.days.map((d, i) => (
              <td key={i} className={flagClass(r.flag[i])} title={T.sop.stockHint(num(r.stock[i]), num(r.short[i]))} data-test="sop-days" data-v={d} data-flag={r.flag[i] ?? ''}>
                {T.sop.daysShort(num(d / 10, 0))}
                {r.flag[i] ? ` ${T.sop.flag[r.flag[i]!]}` : ''}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Cash({ v, hud }: { v: SopView; hud: Hud }) {
  const ms = v.cash.months;
  const below = v.cash.low.balance < -v.cash.limit;
  return (
    <>
      <table className="ptab sopgrid" data-test="sop-cash">
        <thead>
          <tr>
            <th>{T.sop.cashHead}</th>
            {ms.map(m => (
              <th key={m.m}>{monthWord(m.m)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{T.sop.cash.start}</td>
            {ms.map(m => (
              <td key={m.m}>{money(m.start)}</td>
            ))}
          </tr>
          {CASH_ROWS.map(r => (
            <tr key={r} data-test="sop-cash-row" data-row={r}>
              <td>{T.sop.cash[r]}</td>
              {ms.map(m => (
                <td key={m.m} data-v={m.flows[r]}>
                  {money(m.flows[r], true)}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td>
              <b>{T.sop.cash.end}</b>
            </td>
            {ms.map(m => (
              <td key={m.m} className={m.end < -v.cash.limit ? 'bad' : ''}>
                <b>{money(m.end)}</b>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <div className={below ? 'bad' : 'muted'} data-test="sop-low" data-v={v.cash.low.balance}>
        {T.sop.low(money(v.cash.low.balance), whenText(hud.start, v.cash.low.at), money(-v.cash.limit))}
      </div>
    </>
  );
}

function People({ v, actions }: { v: SopView; actions: Actions }) {
  const n = v.people[0]?.need.length ?? 0;
  const short = v.people.some(r => r.need.some((x, i) => x > r.have[i]));
  return (
    <>
      <table className="ptab sopgrid" data-test="sop-people">
        <Head v={v} n={n} first={T.sop.peopleHead} />
        <tbody>
          {v.people.map(r => (
            <tr key={r.role} data-test="sop-role" data-role={r.role}>
              <td>{roleName(r.role)}</td>
              {r.need.map((x, i) => (
                <td key={i} className={x > r.have[i] ? 'bad' : ''} data-need={x} data-have={r.have[i]}>
                  {T.sop.hours(hText(x), hText(r.have[i]))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cbtns">
        <span className={short ? 'warn small' : 'muted small'}>{short ? T.sop.peopleShort : T.sop.peopleOk}</span>
        <button type="button" className="small" onClick={() => actions.togglePolicies()} data-test="sop-overtime">
          {T.sop.overtime}
        </button>
        <button
          type="button"
          className="small"
          onClick={() => {
            actions.toggleRef();
            actions.setRefTab('people');
          }}
          data-test="sop-staff"
        >
          {T.sop.staff}
        </button>
      </div>
    </>
  );
}

export function Sop({ hud, actions }: { hud: Hud; actions: Actions }) {
  const v = hud.sop.view;
  return (
    <div className="kpi panel sop" id="sop" role="dialog" aria-labelledby="sop-title" data-test="sop">
      <div className="phead">
        <b id="sop-title">{T.sop.title}</b>
        {v && !v.none ? <span className="muted">{T.sop.span(monthWord(v.from), monthWord(v.from + 5))}</span> : null}
        <button type="button" className="close" onClick={() => actions.toggleSop()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {!v ? <div className="muted">{T.app.loading}</div> : null}
      {v?.none ? <div className="muted">{T.sop.none}</div> : null}
      {v && !v.none ? (
        <>
          <State v={v} hud={hud} />
          <div className="msec">{T.sop.planHead}</div>
          <Plan v={v} actions={actions} />
          <Result v={v} hud={hud} actions={actions} />
          <div className="msec">{T.sop.demandHead}</div>
          <Demand v={v} />
          <div className="msec">{T.sop.capacityHead}</div>
          <Capacity v={v} />
          <div className="msec">{T.sop.stockSec}</div>
          <Stock v={v} />
          <div className="msec">{T.sop.cashSec}</div>
          <Cash v={v} hud={hud} />
          <div className="msec">{T.sop.peopleSec}</div>
          <People v={v} actions={actions} />
          <div className="muted small">{T.sop.twin}</div>
        </>
      ) : null}
    </div>
  );
}
