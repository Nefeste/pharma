// Окно «Заказ поставщику» (Б5б; docs/specs/2026-10-vertical-slice.md, «Б5б»): снабжение вручную из панели склада.
// Поставщик — из тех, у кого есть одобренная пара; строки — материал его одобренных пар и количество: у строки —
// наименьшая партия, тара, цена договора с остатком обещанного или прайса, и как завод её примет — до целой тары и
// стоимость. «Предложить» — строки правила снабжения у этого поставщика; «Отправить» — команда `po` поста «Снабжение и
// склад» или директора, у чужого поста погашено; отказ — причиной у строки. Вид собирает поток расчёта (src/sim/po.ts);
// слова — здесь и в src/i18n/.
import type { Id } from '../content/types';
import { money, named, pctText, qtyText, T } from '../i18n';
import type { PoItem, PoSupplier } from '../sim/po';
import { db } from './db';
import { type Actions, type Hud, holds } from './store';

const material = (id: Id) => named(db?.materials[id]?.name, id);
const unitOf = (m: Id) => db?.materials[m]?.unit ?? 'mass';
/** Количество окна — в кг у материала по массе и в штуках у прочих; движок считает в мг и штуках. */
const toInput = (m: Id, qty: number) => (unitOf(m) === 'mass' ? qty / 1e6 : qty);
const fromInput = (m: Id, v: number) => Math.max(0, Math.round(unitOf(m) === 'mass' ? v * 1e6 : v));

/** Цена строки: договор с остатком обещанного или прайс — за кг или за штуку. */
function priceText(it: PoItem): string {
  const per = unitOf(it.material) === 'mass' ? T.po.perKg : T.po.perPcs;
  return it.contract ? T.po.contract(money(it.contract.price), per, qtyText(it.contract.left, unitOf(it.material)), money(it.list)) : T.po.list(money(it.list), per);
}

export function Po({ hud, actions }: { hud: Hud; actions: Actions }) {
  const po = hud.po;
  // заказ — команда поста «Снабжение и склад» (или директора): чужой пост — «Отправить» погашено
  const mine = holds(hud, 'supply');
  const v = po.view;
  const sup: PoSupplier | undefined = v?.suppliers.find(x => x.id === (po.supplier ?? v.supplier));
  const items = sup?.items.filter(i => i.ok) ?? [];
  const answer = v?.answer;
  const bad = answer && 'why' in answer ? answer : undefined;
  const good = answer && !('why' in answer) ? answer : undefined;
  const plan = v?.plan.find(x => x.supplier === sup?.id);
  const set = (lines: { material: Id; qty: number }[]) => actions.setPo({ lines });
  const lines = po.lines;
  // новая строка — материал, которого в черновике ещё нет, с наименьшей партией
  const next = items.find(x => !lines.some(l => l.material === x.material)) ?? items[0];
  return (
    <div className="dossier poform panel" id="po" role="dialog" aria-labelledby="po-title" data-test="po">
      <div className="phead">
        <b id="po-title">{T.po.title}</b>
        <span className="muted">{T.po.question}</span>
        <button type="button" className="close" onClick={() => actions.togglePo()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {!v ? <div className="muted">{T.app.loading}</div> : null}
      {v && v.suppliers.length === 0 ? <div className="muted">{T.po.noSuppliers}</div> : null}
      {v && v.suppliers.length > 0 ? (
        <>
          <div className="filters" data-test="po-suppliers">
            <span className="muted">{T.po.supplier}:</span>
            {v.suppliers.map(x => (
              <button type="button" key={x.id} className={x.id === sup?.id ? 'on' : ''} aria-pressed={x.id === sup?.id} onClick={() => actions.setPo({ supplier: x.id })} data-supplier={x.id}>
                {named(db?.suppliers[x.id]?.name, x.id)}
              </button>
            ))}
          </div>
          {sup ? (
            <div className="muted" data-test="po-terms">
              {T.po.terms(sup.lead[0], sup.lead[1], pctText(sup.prepay))}
            </div>
          ) : null}
          <table className="dtab" data-test="po-lines">
            <thead>
              <tr>
                <th>{T.po.material}</th>
                <th>{T.po.qty}</th>
                <th>{T.po.moq}</th>
                <th>{T.po.price}</th>
                <th>{T.po.will}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const it = items.find(x => x.material === l.material);
                const got = good?.lines[i];
                const wrong = bad?.detail === l.material;
                return (
                  <tr key={i} className={wrong ? 'bad' : ''} data-test="po-line" data-material={l.material}>
                    <td>
                      <select value={l.material} onChange={e => set(lines.map((x, k) => (k === i ? { material: e.target.value, qty: x.qty } : x)))} data-test="po-material">
                        {items.map(x => (
                          <option key={x.material} value={x.material}>
                            {material(x.material)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input type="number" min={0} step="any" value={toInput(l.material, l.qty)} onChange={e => set(lines.map((x, k) => (k === i ? { material: x.material, qty: fromInput(x.material, Number(e.target.value)) } : x)))} data-test="po-qty" />{' '}
                      {unitOf(l.material) === 'mass' ? T.units.kg : T.units.pcs}
                    </td>
                    <td className="muted">{it ? `${qtyText(it.moq, unitOf(it.material))} · ${T.po.tare(qtyText(it.cap, unitOf(it.material)))}` : ''}</td>
                    <td className="muted">{it ? priceText(it) : ''}</td>
                    <td data-test="po-will">{got ? `${qtyText(got.qty, unitOf(got.material))} · ${money(got.cost)}` : wrong ? <span className="bad">{T.notices.why[bad!.why] ?? bad!.why}</span> : ''}</td>
                    <td>
                      <button type="button" className="small" onClick={() => set(lines.filter((_, k) => k !== i))} title={T.po.dropHint}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {bad && !lines.some(l => l.material === bad.detail) ? <div className="bad">{T.notices.why[bad.why] ?? bad.why}</div> : null}
          <div className="filters">
            <button type="button" disabled={!next} onClick={() => next && set([...lines, { material: next.material, qty: next.moq }])} data-test="po-add">
              {T.po.add}
            </button>
            <button type="button" onClick={() => actions.suggestPo()} disabled={!plan} title={plan ? T.po.suggestHint : T.po.noPlan} data-test="po-suggest">
              {T.po.suggest}
            </button>
            <button type="button" className="go" onClick={() => actions.sendPo()} disabled={!good || !mine} title={mine ? '' : T.seats.notYours(T.seats.names.supply)} data-test="po-send">
              {T.po.send}
            </button>
          </div>
          {good ? (
            <div data-test="po-sum">
              {T.po.sum(money(good.net), money(good.vat), money(good.prepaid))}
            </div>
          ) : null}
          {!plan ? <div className="muted small">{T.po.noPlan}</div> : null}
        </>
      ) : null}
    </div>
  );
}
