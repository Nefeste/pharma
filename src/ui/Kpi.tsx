// Окно «Показатели» (Б5ж; docs/specs/2026-10-vertical-slice.md, «Б5ж»; геймдизайн, §8.6): как работают службы. Большое
// окно поверх карты, как справочник: вкладки — директор и четыре поста, взятые места первыми; строка — руководитель и его
// показатели плитками: число месяца, прошлый месяц со стрелкой «лучше» или «хуже», 12 закрытых месяцев столбиками,
// противовес; наведение — формула, направление и источник; «Почему?» — записи числа со ссылкой на карточку. Вид собирает
// поток расчёта (src/sim/kpi.ts) без слов и без истины; слова — отсюда.
import type { Ymd } from '../engine/core/calendar';
import type { KpiHead, KpiUnit } from '../engine/kpi';
import { dayText, hText, money, named, num, pctText, T, whenText } from '../i18n';
import type { KpiCell, KpiMonthRef, KpiView, KpiWhyRow } from '../sim/kpi';
import { db } from './db';
import type { Actions, Hud } from './store';

/** Число показателя в его единице; денежный поток — со знаком. */
export function kpiValue(unit: KpiUnit, v: number, signed = false): string {
  switch (unit) {
    case 'kop':
      return money(v, signed);
    case 'share':
      return pctText(v, 1);
    case 'sec':
      return hText(v);
    case 'day':
      return T.kpi.days(num(v / 100, 1));
    case 'per':
      return T.kpi.per(num(v / 100, 1));
    case 'wh':
      return T.kpi.kwh(num(v / 1000, 1));
  }
}

/** Число показателя `id`: у денежного потока — со знаком. */
export const kpiText = (id: string, unit: KpiUnit, v: number) => kpiValue(unit, v, id === 'flow');

export const kpiName = (id: string) => T.kpi.name[id] ?? id;

/** Руководитель словами: директор — сам, начальники — должностью журнала решений (Б5а). */
export const headName = (head: KpiHead) => (head === 'dir' ? T.kpi.dir : (T.journal.names[head] ?? head));

/** Месяц словами: «октябрь 2027». */
export const monthText = (m: KpiMonthRef) => T.kpi.month(T.cash.months[m.m - 1] ?? String(m.m), m.y);

/** Лучше, хуже, так же — ключ слов. */
const trendKey = (t: 1 | -1 | 0) => (t === 1 ? 'up' : t === -1 ? 'down' : 'same');

/** Подсказка плитки: формула, направление, окно, сравнение сумм и источник. */
function tipOf(c: KpiCell): string {
  return [
    T.kpi.formula[c.id] ?? '',
    c.dir === 1 ? T.kpi.up : T.kpi.down,
    ...(c.win === 'y' ? [T.kpi.winHint] : []),
    ...(c.acc ? [T.kpi.perDay] : []),
    c.src.length > 0 ? T.kpi.source(c.src.join(', ')) : T.kpi.ours,
  ]
    .filter(x => x !== '')
    .join('\n');
}

/** Подробности плитки: множители OEE, 90-й процентиль и сколько записей, пик, отказы, строки заказов, показатели МОК. */
function moreText(c: KpiCell): string | undefined {
  const m = c.more;
  if (!m) return undefined;
  switch (c.id) {
    case 'oee': {
      // эффективности без времени работы и качества без выпуска нет — прочерк, а не ноль
      const part = (x: number | undefined) => (x === undefined ? T.kpi.dash : pctText(x, 1));
      return T.kpi.oeeParts(part(m.a), part(m.p), part(m.q));
    }
    case 'occupancy':
      return T.kpi.peak(pctText(m.peak, 1));
    case 'mtbf':
    case 'mttr':
      return T.kpi.fails(m.n);
    case 'otif':
      return T.kpi.lines(m.n, m.bad);
    case 'cpk':
      return T.kpi.cpkN(m.n);
    default:
      return m.p90 !== undefined ? T.kpi.p90(hText(m.p90), m.n) : undefined;
  }
}

/** Ширина и зазор столбика, высота полосы, px: 12 столбиков во всю ширину плитки, между ними — зазор цвета фона. */
const BAR = 12;
const GAP = 3;
const H = 24;

/**
 * 12 закрытых месяцев столбиками от общей нулевой линии — отрицательные вниз; последний — цветом акцента: с ним сравнивают
 * число нынешнего месяца, у закрытого месяца это он сам. Наведение на столбик — месяц и число, щелчок — окно на этом месяце.
 */
function Spark({ c, months, actions }: { c: KpiCell; months: readonly (KpiMonthRef & { from: number })[]; actions: Actions }) {
  const vals = c.hist;
  const nums = vals.filter((x): x is number => x !== null);
  const W = vals.length * (BAR + GAP) - GAP;
  const hi = Math.max(0, ...nums);
  const lo = Math.min(0, ...nums);
  const span = hi - lo || 1;
  const y0 = Math.round((hi / span) * H);
  const off = vals.length - months.length;
  return (
    <svg className="kspark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={T.kpi.hist} data-test="kpi-spark">
      <line className="kbase" x1={0} x2={W} y1={y0} y2={y0} />
      {vals.map((v, i) => {
        if (v === null) return null;
        const h = Math.max(1, Math.round((Math.abs(v) / span) * H));
        const mo = months[i - off];
        return (
          <rect key={i} className={i === vals.length - 1 ? 'klast' : undefined} x={i * (BAR + GAP)} y={v >= 0 ? y0 - h : y0} width={BAR} height={h} rx={2} onClick={mo ? () => actions.setKpiMonth(mo.from) : undefined} data-test="kpi-bar" data-from={mo?.from}>
            <title>{`${T.kpi.bar(mo ? `${monthText(mo)}${mo.part ? ` (${T.kpi.part})` : ''}` : '', kpiText(c.id, c.unit, v))} · ${T.kpi.barHint}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function Cell({ c, months, open, actions }: { c: KpiCell; months: readonly (KpiMonthRef & { from: number })[]; open: boolean; actions: Actions }) {
  const t = c.trend !== undefined ? trendKey(c.trend) : undefined;
  // стрелка — куда сдвинулось число (у сумм месяца — в сутки), цвет и слово — лучше это или хуже
  const arrow = c.trend === undefined ? '' : c.trend * c.dir > 0 ? '▲' : c.trend * c.dir < 0 ? '▼' : '=';
  const more = moreText(c);
  return (
    <div className={`kcell${open ? ' on' : ''}`} data-test="kpi-cell" data-id={c.id}>
      <div className="kname" title={tipOf(c)} data-test="kpi-name">
        {kpiName(c.id)}
        {c.win === 'y' ? <span> · {T.kpi.win}</span> : null}
      </div>
      {c.now !== undefined ? (
        <div className="kvalue" data-test="kpi-now">
          {kpiText(c.id, c.unit, c.now)}
        </div>
      ) : (
        <div className="kvalue muted" title={T.kpi.noneHint} data-test="kpi-now">
          {T.kpi.none}
        </div>
      )}
      <Spark c={c} months={months} actions={actions} />
      <div className="ksub muted">
        {c.prev !== undefined ? `${T.kpi.prev}: ${kpiText(c.id, c.unit, c.prev)}` : null}
        {t ? (
          <span className={t === 'up' ? 'good' : t === 'down' ? 'bad' : ''} title={T.kpi.trend[t]} data-test="kpi-trend" data-trend={t}>
            {' '}
            {arrow} {T.kpi.trendShort[t]}
          </span>
        ) : null}
      </div>
      {more ? (
        <div className="ksub muted" data-test="kpi-more">
          {more}
        </div>
      ) : null}
      {c.pair ? (
        <div className="ksub muted" title={T.kpi.pairHint} data-test="kpi-pair">
          {T.kpi.pair(kpiName(c.pair))}
        </div>
      ) : null}
      {c.why ? (
        <button type="button" className="link kwhy" onClick={() => actions.kpiWhy(c.id)} title={T.kpi.whyHint} aria-expanded={open} data-test="kpi-why">
          {T.kpi.why}
        </button>
      ) : null}
    </div>
  );
}

const customerName = (id: string) => named(db?.customers[id]?.name, id);
const roleName = (id: string) => named(db?.roles[id]?.name, id);

/** Строка «Почему?»: слова и куда ведёт — досье серии или карточка вещи. */
function whyOf(r: KpiWhyRow, start: Ymd, actions: Actions): { text: string; go?: () => void } {
  const R = T.kpi.row;
  switch (r.k) {
    case 'batch':
      return {
        text: [R.batch(r.code), ...(r.sec !== undefined ? [hText(r.sec)] : []), ...(r.devs ? [R.devs(r.devs)] : []), ...(r.rejected ? [R.rejected] : [])].join(' · '),
        go: () => actions.openDossier(r.batch),
      };
    case 'order':
      return {
        text: [R.order(r.order, customerName(r.customer), whenText(start, r.due)), R.status[r.status] ?? r.status, ...(r.missing > 0 ? [R.missing(r.missing)] : [])].join(' · '),
        go: () => actions.select({ kind: 'order', n: r.order }),
      };
    case 'dev':
      return {
        text: [R.dev(T.dev.no(r.n), T.morning.devKinds[r.kind] ?? r.kind, whenText(start, r.opened)), ...(r.sec !== undefined ? [hText(r.sec)] : []), ...(r.prev !== undefined ? [R.repeat(T.dev.no(r.prev))] : [])].join(' · '),
        go: () => actions.select({ kind: 'dev', n: r.n }),
      };
    case 'lot': {
      const unit = r.unit;
      return {
        text: [R.lot(named(db?.materials[r.material]?.name, r.material), T.lotCode(...r.code)), ...(r.sec !== undefined ? [hText(r.sec)] : []), ...(r.rejected ? [R.rejected] : [])].join(' · '),
        ...(unit !== undefined ? { go: () => actions.showUnit(unit) } : {}),
      };
    }
    case 'fail': {
      const thing = r.thing;
      // вид машины и её узел — по записи вида: машины линии или оборудования
      const rec = r.type ? (thing?.kind === 'equipment' ? db?.equipment[r.type] : db?.machines[r.type]) : undefined;
      const part = named(rec?.parts?.find(p => p.id === r.part)?.name, r.part);
      return {
        text: [R.fail(named(rec?.name, r.type ?? ''), part, whenText(start, r.t)), r.sec !== undefined ? R.restored(hText(r.sec)) : R.open, ...(r.spare ? [R.spare] : [])].join(' · '),
        ...(thing ? { go: () => actions.show(thing) } : {}),
      };
    }
    case 'person': {
      const n = r.person;
      const when = r.days !== undefined && r.day !== undefined ? R.hired(dayText(r.day), T.kpi.days(num(r.days / 100, 0))) : r.day !== undefined ? R.left(dayText(r.day)) : '';
      return {
        text: [R.person(roleName(r.role), r.tab), when].filter(x => x !== '').join(' · '),
        ...(n !== undefined ? { go: () => actions.show({ kind: 'person', n }) } : {}),
      };
    }
    case 'cpk':
      return { text: R.cpk(named(db?.recipes[r.recipe]?.name, r.recipe), named(db?.tests[r.test]?.name, r.test), num(r.cpk / 10000, 2), r.n) };
  }
}

function WhyList({ why, start, actions }: { why: NonNullable<KpiView['why']>; start: Ymd; actions: Actions }) {
  return (
    <div className="kwhylist" data-test="kpi-whylist" data-id={why.id}>
      <div className="mhead">{T.kpi.whyTitle(kpiName(why.id))}</div>
      {why.rows.length === 0 ? (
        <div className="muted">{T.kpi.whyEmpty}</div>
      ) : (
        <ul className="mlist">
          {why.rows.map((r, i) => {
            const w = whyOf(r, start, actions);
            return (
              <li key={i} data-test="kpi-why-row" data-k={r.k}>
                {w.go ? (
                  <button type="button" className="link" onClick={w.go}>
                    {w.text}
                  </button>
                ) : (
                  w.text
                )}
              </li>
            );
          })}
        </ul>
      )}
      {why.all !== undefined ? <div className="muted">{T.kpi.whyMore(why.rows.length, why.all)}</div> : null}
    </div>
  );
}

export function Kpi({ hud, actions }: { hud: Hud; actions: Actions }) {
  const v = hud.kpi.view;
  const tab = hud.kpi.tab;
  const tabs = v?.tabs ?? [];
  return (
    <div className="kpi panel" id="kpi" role="dialog" aria-labelledby="kpi-title" data-test="kpi">
      <div className="phead">
        <b id="kpi-title">{T.kpi.title}</b>
        <span className="muted">{T.kpi.question}</span>
        <span className="filters">
          {tabs.map(k => (
            <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => actions.setKpiTab(k)} data-test="kpi-tab" data-tab={k}>
              {T.seats.names[k] ?? k}
            </button>
          ))}
        </span>
        {v ? (
          <span className="kmonth" data-test="kpi-month" data-from={v.month.from} data-closed={v.month.closed ? '1' : '0'}>
            <button type="button" disabled={v.older === undefined} onClick={() => actions.setKpiMonth(v.older)} title={T.kpi.older} aria-label={T.kpi.older} data-test="kpi-older">
              ‹
            </button>{' '}
            <b>{monthText(v.month)}</b>
            {v.month.part ? (
              <span className="warn" title={T.kpi.partHint}>
                {' '}
                · {T.kpi.part}
              </span>
            ) : null}
            {v.month.closed ? (
              <span className="muted" title={T.kpi.closedHint}>
                {' '}
                · {T.kpi.closed}
              </span>
            ) : (
              <span className="muted"> · {T.kpi.since(whenText(hud.start, v.month.from))}</span>
            )}{' '}
            <button type="button" disabled={v.newer === undefined} onClick={() => actions.setKpiMonth(v.newer ?? undefined)} title={T.kpi.newer} aria-label={T.kpi.newer} data-test="kpi-newer">
              ›
            </button>
          </span>
        ) : null}
        <button type="button" className="close" onClick={() => actions.toggleKpi()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {!v || v.tab !== tab ? <div className="muted">{T.app.loading}</div> : null}
      {v && v.tab === tab
        ? v.rows.map(row => (
            <div className="khead" key={row.head} data-test="kpi-head" data-head={row.head}>
              <div className="khname">{headName(row.head)}</div>
              <div className="kcells">
                {row.cells.map(c => (
                  <Cell key={c.id} c={c} months={v.months} open={v.why?.id === c.id} actions={actions} />
                ))}
              </div>
              {v.why && row.cells.some(c => c.id === v.why!.id) ? <WhyList why={v.why} start={hud.start} actions={actions} /> : null}
            </div>
          ))
        : null}
    </div>
  );
}
