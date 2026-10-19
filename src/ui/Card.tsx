// Карточка вещи (docs/specs/2026-10-panels.md, 3б; docs/13-art.md, §11): одного устройства для всех — что это → состояние
// → почему так → что можно сделать → история. Снизу экрана, как карточка выбранного в «Больнице» (её src/ui/App.tsx,
// `card`). Вид приходит из потока расчёта (src/sim/views.ts) без истины и без слов; слова — отсюда, из src/i18n/.
import type { ReactNode } from 'react';
import type { PartType } from '../content/types';
import type { Ymd } from '../engine/core/calendar';
import { dayText, named, num, qtyText, T, whenText } from '../i18n';
import type { CardView, Hist, Why } from '../sim/views';
import { db } from './db';
import { StatusIcon } from './icons';
import { placeText, supplierText } from './Stock';
import type { Actions } from './store';

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const when = (start: Ymd, t: number | undefined) => (t === undefined ? T.card.noTime : whenText(start, t));

function whyText(w: Why, start: Ymd): string {
  switch (w.k) {
    case 'task': {
      const task = T.tasks[w.task] ?? w.task;
      if (w.busy) return T.why.taskBusy(task);
      return w.wait && w.since !== undefined ? T.why.taskWait(task, T.wait[w.wait], whenText(start, w.since)) : T.why.taskOpen(task);
    }
    case 'plan':
      return T.why.plan;
    case 'tests':
      return T.why.tests(w.done, w.all);
    case 'decided':
      return w.status === 'released' ? T.why.released(when(start, w.t)) : T.why.rejected(when(start, w.t));
    case 'batch':
      return T.why.batch(w.code);
    case 'start':
      return T.why.start;
  }
}

function histText(h: Hist, unit: 'mass' | 'pcs' | undefined, parts: readonly PartType[]): string {
  switch (h.k) {
    case 'arrived':
      return T.hist.arrived(h.po);
    case 'start':
      return T.hist.start;
    case 'reserved':
      return T.hist.reserved(h.orders, unit ? qtyText(h.qty, unit) : num(h.qty));
    case 'made':
      return T.hist.made(h.batch);
    case 'sampled':
      return T.hist.sampled(h.containers);
    case 'test':
      return T.hist.test(named(db?.tests[h.method]?.name, h.method), h.pass);
    case 'decided':
      return T.hist.decided(T.status[h.status]);
    case 'kit':
      return T.hist.kit(h.batch, unit ? qtyText(h.qty, unit) : num(h.qty));
    case 'shipped':
      return T.hist.shipped(named(db?.customers[h.customer]?.name, h.customer), unit ? qtyText(h.qty, unit) : num(h.qty));
    case 'maint':
      return `${T.hist.maint[h.what]} · ${named(parts.find(x => x.id === h.part)?.name, h.part)} · ${T.hist.wear(`${num(h.wear / 100)}\u00a0%`)}`;
  }
}

function Why({ list, start }: { list: Why[]; start: Ymd }) {
  if (list.length === 0) return null;
  return (
    <>
      <div className="csec">{T.card.why}</div>
      <ul className="why">
        {list.map((w, i) => (
          <li key={i}>{whyText(w, start)}</li>
        ))}
      </ul>
    </>
  );
}

function History({ list, start, unit, parts = [] }: { list: Hist[]; start: Ymd; unit?: 'mass' | 'pcs'; parts?: readonly PartType[] }) {
  return (
    <>
      <div className="csec">{T.card.history}</div>
      {list.length === 0 ? (
        <div className="muted">{T.card.noHistory}</div>
      ) : (
        <ol className="hist" data-test="card-history">
          {list.map((h, i) => (
            <li key={i}>
              <span className="mono muted">{h.k === 'reserved' || (h.k === 'kit' && h.t === undefined) ? '' : when(start, h.t)}</span> {histText(h, unit, parts)}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** `beside` — открыта панель склада: карточка уже, чтобы не заходить под панель справа. */
export function Card({ v, start, plant, actions, beside }: { v: CardView; start: Ymd; plant: string; actions: Actions; beside?: boolean }) {
  const c = v.card;
  let title: ReactNode = '';
  let body: ReactNode = null;
  switch (c.kind) {
    case 'gone':
      title = T.card.gone;
      break;
    case 'unit': {
      const lot = c.lot;
      const mat = lot ? db?.materials[lot.material] : undefined;
      title = lot ? (
        <>
          {named(mat?.name, lot.material)} <span className="mono">{T.lotCode(...lot.code)}</span>
        </>
      ) : (
        T.card.emptyPallet
      );
      body = (
        <>
          <dl>
            {lot ? (
              <Row k={T.card.supplier}>
                {supplierText(lot.supplier)}
                {lot.supplier !== 'start' ? ` · ${T.card.vendorLot} ${lot.vendorLot}` : ''}
              </Row>
            ) : null}
            <Row k={T.card.state}>
              {lot ? (
                <>
                  <StatusIcon status={lot.status} tag={lot.tag} /> {T.status[lot.status]}
                  {lot.since !== undefined ? <span className="muted"> {T.card.since(whenText(start, lot.since))}</span> : null}
                </>
              ) : (
                T.card.pallet(c.unit)
              )}
            </Row>
            <Row k={T.card.where}>
              {placeText(c.where, plant)} · {T.card.containers(c.containers)}
            </Row>
            {lot && mat ? (
              <>
                <Row k={T.card.left}>
                  {qtyText(lot.left, mat.unit)} <span className="muted">/ {qtyText(lot.qty, mat.unit)}</span>
                </Row>
                <Row k={T.card.expiry}>{dayText(lot.expiry)}</Row>
              </>
            ) : null}
          </dl>
          <Why list={c.why} start={start} />
          <div className="csec">{T.card.can}</div>
          <div className="muted">{T.card.nothing}</div>
          <History list={c.history} start={start} unit={mat?.unit} />
        </>
      );
      break;
    }
    case 'room':
      title = `${T.roomTypes[c.type] ?? c.type} · ${T.grade[c.grade]}`;
      body = (
        <>
          <dl>
            <Row k={T.card.state}>
              {T.room.status[c.status]} <span className="muted">{T.card.since(whenText(start, c.since))}</span>
            </Row>
            {c.batch ? <Row k={T.card.batch}>{c.batch}</Row> : null}
            {c.stage ? <Row k={T.card.stage}>{T.stages[c.stage] ?? c.stage}</Row> : null}
          </dl>
          <Why list={c.why} start={start} />
        </>
      );
      break;
    case 'equipment':
    case 'machine': {
      const rec = c.kind === 'equipment' ? db?.equipment[c.type] : db?.machines[c.type];
      title = named(rec?.name, c.type);
      body = (
        <>
          <dl>
            <Row k={T.card.state}>{c.kind === 'equipment' ? T.equipment[c.state] : T.machine[c.state]}</Row>
            {c.batch ? <Row k={T.card.batch}>{c.batch}</Row> : null}
            {c.kind === 'machine' && c.sku ? <Row k={T.card.sku}>{named(db?.skus[c.sku]?.name, c.sku)}</Row> : null}
            {c.parts.length ? (
              <Row k={T.card.parts}>
                {c.parts
                  .map(p => `${named(rec?.parts.find(x => x.id === p.type)?.name, p.type)}: ${T.hist.wear(`${num(p.wear / 100)}\u00a0%`)}${p.failed ? `, ${T.card.failed}` : ''}${p.repair ? `, ${T.card.repairing}` : ''}`)
                  .join('; ')}
              </Row>
            ) : null}
          </dl>
          <Why list={c.why} start={start} />
          <History list={c.history} start={start} parts={rec?.parts} />
        </>
      );
      break;
    }
    case 'person':
      title = named(db?.roles[c.role]?.name, c.role);
      body = (
        <dl>
          <Row k={T.card.state}>
            {c.doing.k === 'task' ? T.why.taskBusy(T.tasks[c.doing.task] ?? c.doing.task) : c.doing.k === 'walk' ? (c.doing.exit ? T.card.doing.exit : T.card.doing.walk) : T.card.doing[c.doing.k]}
          </Row>
          <Row k={T.card.shift}>{named(db?.shifts[c.shift]?.name, c.shift)}</Row>
        </dl>
      );
      break;
    case 'vehicle':
      title = named(db?.vehicles[c.type]?.name, c.type);
      body = (
        <dl>
          <Row k={T.card.state}>{c.task ? T.why.taskBusy(T.tasks[c.task] ?? c.task) : T.card.free}</Row>
        </dl>
      );
      break;
    case 'truck':
      title = T.card.truck(!!c.customer);
      body = (
        <dl>
          <Row k={T.card.state}>{!c.docked ? T.card.truckState.yard : c.customer ? T.card.truckState.load : c.open ? T.card.truckState.unload : T.card.truckState.check}</Row>
          {c.customer ? <Row k={T.card.supplier}>{named(db?.customers[c.customer]?.name, c.customer)}</Row> : null}
          {c.supplier ? <Row k={T.card.supplier}>{supplierText(c.supplier)}</Row> : null}
          {c.po ? <Row k={T.card.order}>{c.po}</Row> : null}
          <Row k={T.card.arrived}>{whenText(start, c.arrived)}</Row>
          <Row k="">{T.card.units(c.units)}</Row>
        </dl>
      );
      break;
  }
  return (
    <div className={`card panel${beside ? ' beside' : ''}`} id="card" data-test="card">
      <div className="cardhead">
        <b id="card-title">{title}</b>
        <button type="button" className="close" onClick={() => actions.select(undefined)} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {body}
    </div>
  );
}
