// Помещение отклонённого в карточке (Б1з; docs/specs/2026-10-vertical-slice.md, «Б1з», «Окно»): места зоны и партии на
// них, паллеты, которые ждут места, заказанный вывоз и журнал отходов — от новых к старым. Числа и номера — из вида
// потока расчёта (src/sim/waste.ts), слова — из src/i18n/.
import { momentOf, type Ymd } from '../engine/core/calendar';
import { dayText, money, named, qtyText, T, whenText } from '../i18n';
import type { WasteRoom } from '../sim/waste';
import { db } from './db';

const material = (id?: string) => (id ? named(db?.materials[id]?.name, id) : '');
const unitOf = (id?: string) => (id ? (db?.materials[id]?.unit ?? 'mass') : 'mass');
/** Где ждут места: вид места склада или помещение. */
const placeName = (where: string) => (T.zones as Record<string, string>)[where] ?? T.roomTypes[where] ?? where;

export function WasteBlock({ w, start }: { w: WasteRoom; start: Ymd }) {
  return (
    <>
      <div className="csec">{T.waste.places}</div>
      <ul className="why" data-test="card-waste-places">
        {w.places.map((p, i) => (
          <li key={p.slot} data-test="card-waste-place" data-busy={p.lot ? 'yes' : 'no'}>
            {T.waste.place(i + 1)}:{' '}
            {p.lot ? (
              <>
                {T.waste.lot(T.lotCode(...p.lot), material(p.material), dayText(momentOf(start, p.since ?? 0).day))}
                {p.batch ? <span className="muted"> · {T.now.batch(p.batch)}</span> : null}
              </>
            ) : (
              <span className="muted">{T.waste.free}</span>
            )}
          </li>
        ))}
      </ul>
      {w.waiting.length > 0 ? <div className="warn">{T.waste.waiting(w.waiting.map(x => T.waste.where(placeName(x.where), x.n)).join(', '))}</div> : null}
      <div className="muted" data-test="card-waste-order">
        {w.order ? T.waste.order(whenText(start, w.order.at), w.order.by === 'player') : T.waste.none}
        {w.order?.truck ? <span> · {T.waste[w.order.truck]}</span> : null}
      </div>
      <div className="csec">{T.waste.log}</div>
      {w.log.length === 0 ? (
        <div className="muted">{T.waste.noLog}</div>
      ) : (
        <ul className="why" data-test="card-waste-log">
          {w.log.map(e => (
            <li key={e.t} data-test="card-waste-entry">
              {T.waste.entry(whenText(start, e.t), e.pallets, money(e.sum), money(e.vat))}
              {e.lots.map((x, i) => (
                <div key={i} className="muted">
                  {T.waste.item(x.lot ? T.lotCode(...x.lot) : '—', material(x.material), x.pallets, x.containers, qtyText(x.qty, unitOf(x.material), unitOf(x.material) === 'pcs' ? 0 : 3))}
                  {x.batch ? ` · ${T.now.batch(x.batch)}` : ''}
                </div>
              ))}
              <div className="muted">
                {[e.signed ? T.waste.signed(T.card.person(named(db?.roles[e.signed.role]?.name, e.signed.role), e.signed.tab)) : '', T.waste.act(dayText(e.act))].filter(Boolean).join('; ')}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
