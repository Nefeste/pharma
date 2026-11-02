// Панель склада (docs/specs/2026-10-panels.md, 3б): «что лежит на складе и в каком статусе». Строки — партии с тарой на
// заводе; фильтр по статусу и виду материала, сортировка по столбцу, страницы. Вид собирает поток расчёта (src/sim/views.ts),
// панель только показывает и просит: щелчок по строке — камера к паллете партии (мимо панели) и её карточка.
import { Fragment } from 'react';
import type { MaterialKind } from '../content/types';
import type { LotStatus } from '../engine/types';
import { planOf } from '../engine/plant';
import { dayText, named, qtyText, T } from '../i18n';
import type { PlaceRef, StockSort } from '../sim/views';
import { db } from './db';
import { StatusIcon } from './icons';
import type { Actions, Hud } from './store';

const STATUSES: LotStatus[] = ['quarantine', 'sampled', 'testing', 'released', 'rejected'];
const KINDS: MaterialKind[] = ['api', 'excipient', 'packaging', 'bulk', 'fg'];
const COLS: StockSort[] = ['code', 'material', 'supplier', 'status', 'left', 'expiry'];

/** Место паллеты словами: место стеллажа — его адрес, место зоны — зона и номер, помещение, фура. */
export function placeText(p: PlaceRef, plant: string): string {
  if (!db) return '';
  const plan = planOf(db, plant);
  if (p.k === 'slot') {
    const sl = plan.slots[p.i];
    if (!sl) return '';
    return sl.kind === 'storage' ? sl.id : `${T.zones[sl.kind] ?? sl.group} ${sl.id.slice(sl.group.length + 1)}`;
  }
  if (p.k === 'room') {
    const r = plan.plant.rooms[p.i];
    return r ? (T.roomTypes[r.type] ?? r.type) : '';
  }
  return T.place.truck(p.n, p.customer, p.waste);
}

/** Поставщик словами: свой завод и запас на старте — без записи поставщика. */
export function supplierText(id: string): string {
  if (id === 'start') return T.stock.start;
  if (id === 'plant') return T.stock.plant;
  return named(db?.suppliers[id]?.name, id);
}

export function Stock({ hud, actions, plant }: { hud: Hud; actions: Actions; plant: string }) {
  const { query: q, view } = hud.stock;
  const toggle = <K extends 'status' | 'kinds'>(key: K, v: K extends 'status' ? LotStatus : MaterialKind) => {
    const list = q[key] as string[];
    actions.setStock({ [key]: list.includes(v) ? list.filter(x => x !== v) : [...list, v], page: 0 });
  };
  const sortBy = (c: StockSort) => actions.setStock(q.sort === c ? { desc: !q.desc } : { sort: c, desc: false });
  return (
    <div className="stock panel" id="stock" role="dialog" aria-labelledby="stock-title">
      <div className="phead">
        <b id="stock-title">{T.stock.title}</b>
        <span className="muted">{T.stock.question}</span>
        <button type="button" className={`small${hud.po.open ? ' on' : ''}`} onClick={() => actions.togglePo()} title={T.po.hint} data-test="po-open">
          {T.po.button}
        </button>
        <button type="button" className="close" onClick={() => actions.toggleStock()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      <div className="filters">
        <button type="button" className={q.status.length === 0 ? 'on' : ''} onClick={() => actions.setStock({ status: [], page: 0 })}>
          {T.stock.all}
        </button>
        {STATUSES.map(st => (
          <button key={st} type="button" className={q.status.includes(st) ? 'on' : ''} onClick={() => toggle('status', st)} data-test={`stock-status-${st}`}>
            {T.status[st]}
          </button>
        ))}
      </div>
      <div className="filters">
        <button type="button" className={q.kinds.length === 0 ? 'on' : ''} onClick={() => actions.setStock({ kinds: [], page: 0 })}>
          {T.stock.all}
        </button>
        {KINDS.map(k => (
          <button key={k} type="button" className={q.kinds.includes(k) ? 'on' : ''} onClick={() => toggle('kinds', k)}>
            {T.kinds[k]}
          </button>
        ))}
      </div>
      <table className="grid">
        <thead>
          <tr>
            {COLS.map(c => (
              <th key={c} className={q.sort === c ? 'sorted' : ''} onClick={() => sortBy(c)} title={T.stock.sortHint}>
                {T.stock.cols[c]}
                {q.sort === c ? (q.desc ? ' ▾' : ' ▴') : ''}
              </th>
            ))}
            <th>{T.stock.cols.places}</th>
          </tr>
        </thead>
        <tbody>
          {view?.rows.map(r => {
            const mat = db?.materials[r.material];
            return (
              <tr key={r.lot} onClick={() => actions.showUnit(r.unit)} data-test="stock-row" data-unit={r.unit}>
                <td className="mono nowrap">{T.lotCode(...r.code)}</td>
                <td>{named(mat?.name, r.material)}</td>
                <td>{supplierText(r.supplier)}</td>
                <td className="nowrap">
                  <StatusIcon status={r.status} tag={r.tag} /> {T.status[r.status]}
                </td>
                <td className="num">{mat ? qtyText(r.left, mat.unit) : r.left}</td>
                <td className="num">{dayText(r.expiry)}</td>
                <td>
                  {/* адрес места не рвётся: перенос — только между местами */}
                  {r.places.map((p, i) => (
                    <Fragment key={i}>
                      {i > 0 ? ', ' : ''}
                      <span className="nowrap">{placeText(p, plant)}</span>
                    </Fragment>
                  ))}
                  {r.more > 0 ? ` ${T.stock.more(r.more)}` : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {view && view.total === 0 ? <div className="muted empty">{T.stock.empty}</div> : null}
      <div className="pager">
        <span className="muted">{view ? T.stock.total(view.total) : ''}</span>
        <button type="button" disabled={!view || view.page === 0} onClick={() => actions.setStock({ page: Math.max(0, (view?.page ?? 0) - 1) })}>
          {T.stock.prev}
        </button>
        <span>{view ? T.stock.page(view.page + 1, view.pages) : ''}</span>
        <button type="button" disabled={!view || view.page >= view.pages - 1} onClick={() => actions.setStock({ page: (view?.page ?? 0) + 1 })}>
          {T.stock.next}
        </button>
      </div>
    </div>
  );
}
