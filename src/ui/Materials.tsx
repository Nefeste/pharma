// Вкладка «Материалы» окна расписания (Б6д; docs/specs/2026-10-vertical-slice.md, «Б6д»; геймдизайн, §9.3): над сеткой —
// как заказывает снабжение и срок завоза; сетка — материалы по видам строками (АФС, вспомогательные, упаковка), 12 месяцев
// столбцами: в клетке — потребность месяца, необеспеченная — красным числом со знаком «−», а слово — у материала: «не
// хватит с …»; подсказка клетки — есть, в пути с днями, когда будет разрешено, и плановый заказ. Ниже — плановые заказы по
// поставщикам на два месяца вперёд с датой заказа и «Заказать» — окно «Заказ поставщику» со строками тех, чья дата заказа —
// в пределах недели, по материалу, — и заказы в пути с сообщениями, «Ускорить» и «Отменить». Вид собран в потоке расчёта
// (src/sim/mrp.ts) — истины в нём нет.
import type { Id } from '../content/types';
import { MRP_SOON, type MrpMsg, type MrpOrder, type MrpRow } from '../engine/plan/mrp';
import { dayText, money, named, num, T, whenText } from '../i18n';
import type { MrpPoRow, MrpView } from '../sim/mrp';
import { db } from './db';
import { actLabel, actOf, actOn } from './memo';
import type { Actions, Hud } from './store';

const KINDS = ['api', 'excipient', 'packaging'] as const;
/** Плановые заказы у поставщика — с датой заказа на столько суток вперёд; дальше — числом. */
const AHEAD = 62;
const ym = (n: number) => ({ y: Math.floor(n / 12), m: (n % 12) + 1 });
const material = (id: Id) => named(db?.materials[id]?.name, id);
const party = (id: Id) => named(db?.suppliers[id]?.name, id);
const unitOf = (m: Id) => db?.materials[m]?.unit ?? 'mass';
/** Число клетки — в единице строки: масса — кг (меньше 10 — с десятой), штуки — штуками. */
const cellQty = (m: Id, q: number) => (unitOf(m) === 'mass' ? num(q / 1e6, q > 0 && q < 1e7 ? 1 : 0) : num(q));
/** Количество со своей единицей: «120 кг», «40 000 шт». */
const qty = (m: Id, q: number) => `${cellQty(m, q)} ${unitOf(m) === 'mass' ? T.units.kg : T.units.pcs}`;
const day = (z: number) => dayText(z).slice(0, 5);

/** Подсказка клетки: потребность месяца, есть, в пути, страховой запас и плановый заказ материала к этому месяцу. */
function cellTip(r: MrpRow, m: number, gross: number, net: number, planned: MrpOrder[]): string {
  const o = planned.find(x => x.material === r.material && x.month === m);
  return [
    T.mrp.cell(qty(r.material, gross)),
    ...(net > 0 ? [T.mrp.short(qty(r.material, net))] : []),
    T.mrp.have(qty(r.material, r.free), qty(r.material, r.quarantine)),
    ...r.transit.map(t => T.mrp.transit(t.po, qty(r.material, t.qty), day(t.day))),
    T.mrp.safety(qty(r.material, r.safety)),
    ...(o ? [T.mrp.plannedCell(qty(r.material, o.qty), day(o.need), day(o.orderBy))] : []),
  ].join('\n');
}

/** Сообщения заказа в пути: опоздает — по материалу; лишний — по материалу. */
function poMsgs(p: MrpPoRow, msgs: MrpMsg[]): string[] {
  const out: string[] = [];
  for (const m of msgs) {
    if (m.kind === 'late' && m.po === p.po) out.push(T.mrp.late(material(m.material), m.days));
    if (m.kind === 'extra' && m.po === p.po) out.push(T.mrp.extra(material(m.material)));
  }
  return out;
}

export function Materials({ hud, actions, v }: { hud: Hud; actions: Actions; v: MrpView }) {
  // заказ, ускорение и отмена — команды поста «Снабжение и склад» или директора; чужой пост — записка начальнику отдела
  // снабжения (Б5д)
  const order = actOf(hud, 'supply', { kind: 'po', supplier: '', lines: [] });
  const fast = actOf(hud, 'supply', { kind: 'expedite', po: '' });
  const drop = actOf(hud, 'supply', { kind: 'cancelPo', po: '' });
  const months = Array.from({ length: v.rows[0]?.months.length ?? 0 }, (_, i) => v.from + i);
  const msgOf = (i: number) => v.msgs.find(m => (m.kind === 'overdue' || m.kind === 'soon') && m.order === i);
  const bySupplier = new Map<Id, { o: MrpOrder; i: number }[]>();
  v.planned.forEach((o, i) => bySupplier.set(o.supplier, [...(bySupplier.get(o.supplier) ?? []), { o, i }]));
  return (
    <div className="mrp" data-test="mrp">
      <div className="muted" data-test="mrp-how">
        {T.mrp.how(T.mrp.hows[v.how] ?? v.how, v.arrive)}
      </div>
      <div className="fc-scroll">
        <table className="grid mrp-grid" data-test="mrp-grid">
          <thead>
            <tr>
              <th>{T.mrp.material}</th>
              {months.map(m => (
                <th key={m} data-month={m}>
                  {T.fc.short(ym(m).y, ym(m).m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KINDS.map(k => {
              const rows = v.rows.filter(r => db?.materials[r.material]?.kind === k);
              if (rows.length === 0) return null;
              return [
                <tr key={k} className="mrp-kind">
                  <th colSpan={months.length + 1}>{T.mrp.kinds[k]}</th>
                </tr>,
                ...rows.map(r => (
                  <tr key={r.material} data-test="mrp-row" data-material={r.material}>
                    <th title={material(r.material)}>
                      {material(r.material)}, {unitOf(r.material) === 'mass' ? T.units.kg : T.units.pcs}
                      {(() => {
                        const m = r.months.find(c => c.net > 0)?.m;
                        return m !== undefined ? (
                          <small className="bad" data-test="mrp-short-from">
                            <br />
                            {T.mrp.shortFrom(T.fc.short(ym(m).y, ym(m).m))}
                          </small>
                        ) : null;
                      })()}
                    </th>
                    {r.months.map(c => (
                      <td key={c.m} className={c.net > 0 ? 'bad' : undefined} title={cellTip(r, c.m, c.gross, c.net, v.planned)} data-test="mrp-cell" data-month={c.m} data-net={c.net > 0 ? c.net : undefined}>
                        {c.gross > 0 ? cellQty(r.material, c.gross) : '·'}
                        {c.net > 0 ? (
                          <>
                            <br />
                            <b>−{cellQty(r.material, c.net)}</b>
                          </>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="mrp-part" data-test="mrp-planned">
        <b>{T.mrp.planned}</b>
        {v.planned.length === 0 ? <div className="muted">{T.mrp.noPlanned}</div> : null}
        {[...bySupplier].map(([supplier, xs]) => {
          // «Заказать» — то, что начальник снабжения закажет в ближайшую неделю: строки по материалу
          const soon = new Map<Id, number>();
          for (const { o } of xs) if (o.orderBy - v.today <= MRP_SOON) soon.set(o.material, (soon.get(o.material) ?? 0) + o.qty);
          const first = xs.reduce((z, x) => Math.min(z, x.o.orderBy), Number.POSITIVE_INFINITY);
          const near = xs.filter(x => x.o.orderBy - v.today <= AHEAD);
          const far = xs.filter(x => x.o.orderBy - v.today > AHEAD);
          return (
          <div key={supplier} className="mrp-sup" data-test="mrp-supplier" data-supplier={supplier} data-soon={soon.size}>
            <span>{party(supplier)}</span>{' '}
            <button type="button" disabled={!actOn(order) || soon.size === 0} title={soon.size === 0 ? T.mrp.orderNone(day(first)) : order.mine ? T.mrp.orderHint : order.title} onClick={() => actions.mrpOrder(supplier, [...soon].map(([material, qty]) => ({ material, qty })))} data-test="mrp-order" data-memo={order.memo ?? undefined}>
              {actLabel(order, T.mrp.order)}
            </button>
            <ul className="mlist">
              {near.map(({ o, i }) => {
                const m = msgOf(i);
                return (
                  <li key={i} data-test="mrp-planned-row" data-material={o.material} data-msg={m?.kind} data-soon={o.orderBy - v.today <= MRP_SOON ? '1' : undefined}>
                    {T.mrp.plannedLine(material(o.material), qty(o.material, o.qty), day(o.need))}
                    {' · '}
                    <span className={m?.kind === 'overdue' ? 'bad' : m?.kind === 'soon' ? 'warn' : 'muted'}>{m?.kind === 'overdue' ? T.mrp.overdue(m.days) : T.mrp.orderBy(day(o.orderBy))}</span>
                  </li>
                );
              })}
              {far.length > 0 ? (
                <li className="muted" data-test="mrp-planned-more">
                  {T.mrp.more(far.length, day(far[far.length - 1].o.orderBy))}
                </li>
              ) : null}
            </ul>
          </div>
          );
        })}
      </div>
      <div className="mrp-part" data-test="mrp-transit">
        <b>{T.mrp.transitTitle}</b>
        {v.pos.length === 0 ? <div className="muted">{T.mrp.noTransit}</div> : null}
        {v.pos.length > 0 ? (
          <table className="grid">
            <thead>
              <tr>
                <th>{T.mrp.cols.po}</th>
                <th>{T.mrp.cols.supplier}</th>
                <th>{T.mrp.cols.lines}</th>
                <th>{T.mrp.cols.eta}</th>
                <th>{T.mrp.cols.msgs}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {v.pos.map(p => {
                const msgs = poMsgs(p, v.msgs);
                const sp = p.speed;
                const cc = p.cancel;
                const fastTip = 'why' in sp ? (T.notices.why[sp.why] ?? sp.why) : fast.mine ? T.mrp.expediteHint(whenText(hud.start, sp.eta), money(sp.fee)) : fast.title;
                const dropTip = 'why' in cc ? (T.notices.why[cc.why] ?? cc.why) : drop.mine ? (cc.back >= 0 ? T.mrp.cancelHint(money(cc.fee), money(cc.back)) : T.mrp.cancelOver(money(cc.fee), money(-cc.back))) : drop.title;
                return (
                  <tr key={p.po} data-test="mrp-po" data-po={p.po}>
                    <td>{p.po}</td>
                    <td>{party(p.supplier)}</td>
                    <td>{p.lines.map(l => `${material(l.material)} — ${qty(l.material, l.qty)}`).join('; ')}</td>
                    <td>
                      {whenText(hud.start, p.eta)}
                      {p.fast ? <small className="muted"> · {T.mrp.fast}</small> : null}
                    </td>
                    <td className={msgs.length > 0 ? 'warn' : 'muted'} data-test="mrp-po-msgs">
                      {msgs.length > 0 ? msgs.join('; ') : '—'}
                    </td>
                    <td>
                      <button type="button" disabled={'why' in sp || !actOn(fast)} title={fastTip} onClick={() => actions.expedite(p.po, !fast.mine)} data-test="mrp-expedite" data-memo={fast.memo ?? undefined}>
                        {actLabel(fast, T.mrp.expedite)}
                      </button>{' '}
                      <button type="button" disabled={'why' in cc || !actOn(drop)} title={dropTip} onClick={() => actions.cancelPo(p.po, !drop.mine)} data-test="mrp-cancel" data-memo={drop.memo ?? undefined}>
                        {actLabel(drop, T.mrp.cancel)}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
