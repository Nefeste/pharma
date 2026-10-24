// Досье серии (Б1д; docs/specs/2026-10-vertical-slice.md, «Б1д»; геймдизайн, §18): большое окно поверх остальных с вопросом
// в заголовке — из чего сделана серия и кто её делал. Шапка, «Отвешено», стадии, упаковка, отклонения и решения — запись
// по производству и запись по упаковке серии (GMP ЕАЭС, ч. I, пп. 4.20, 4.21). Каждая строка ведёт к вещи: партия — к её
// паллете, оборудование и помещение — к ним, человек и отклонение — к их карточкам (docs/13-art.md, §11). Вид собирает
// поток расчёта без истины (src/sim/dossier.ts); здесь — слова и щелчок.
import type { ReactNode } from 'react';
import { momentOf, type Ymd } from '../engine/core/calendar';
import type { Thing } from '../sim/views';
import { dayText, named, num, pctText, qtyText, T, whenText } from '../i18n';
import type { DispRow, DossierView, LotQty, PackDossier, StageRow, Who } from '../sim/dossier';
import { db, docText } from './db';
import type { Actions, Hud } from './store';
import { paramNum, paramText } from './units';

/** Количество материала в его единице: масса — кг до граммов, штуки — штуками. */
function qty(material: string, v: number): string {
  return qtyText(v, db?.materials[material]?.unit ?? 'mass', db?.materials[material]?.unit === 'pcs' ? 0 : 3);
}
const kg = (mg: number) => qtyText(mg, 'mass', 3);
const matName = (id: string) => named(db?.materials[id]?.name, id);
const stageName = (id: string) => T.stages[id] ?? id;
const testName = (id: string) => named(db?.tests[id]?.name, id);

/** Ссылка на вещь: щелчок и Enter ведут к ней камеру или открывают её карточку. */
function Go({ to, actions, children, test }: { to: Thing | undefined; actions: Actions; children: ReactNode; test?: string }) {
  if (!to) return <>{children}</>;
  return (
    <span className="go" role="link" tabIndex={0} onClick={() => actions.show(to)} onKeyDown={e => e.key === 'Enter' && actions.show(to)} data-test={test}>
      {children}
    </span>
  );
}

function WhoText({ w, actions }: { w: Who; actions: Actions }) {
  return (
    <Go to={{ kind: 'person', n: w.n }} actions={actions} test="dossier-who">
      {T.card.person(named(db?.roles[w.role]?.name, w.role), w.tab)}
    </Go>
  );
}

function Whos({ list, actions }: { list: readonly Who[]; actions: Actions }) {
  return (
    <>
      {list.map((w, i) => (
        <span key={`${w.n}-${i}`}>
          {i > 0 ? ', ' : ''}
          <WhoText w={w} actions={actions} />
        </span>
      ))}
    </>
  );
}

function Lots({ material, list, actions }: { material: string; list: readonly LotQty[]; actions: Actions }) {
  return (
    <>
      {list.map((l, i) => (
        <span key={l.code.join('-')} data-test="dossier-lot">
          {i > 0 ? '; ' : ''}
          <Go to={l.unit !== undefined ? { kind: 'unit', n: l.unit } : undefined} actions={actions}>
            {T.lotCode(...l.code)}
          </Go>
          {list.length > 1 ? ` — ${qty(material, l.qty)}` : ''}
          {l.assay !== undefined ? <span className="muted"> · {T.dossier.assay(pctText(l.assay, 2))}</span> : null}
        </span>
      ))}
    </>
  );
}

function Disp({ v, start, actions }: { v: DossierView; start: Ymd; actions: Actions }) {
  const w = v.weigh;
  const rows = v.disp ?? [];
  const reserved = !v.weighed && rows.some(r => r.lots.length > 0);
  return (
    <div className="dsec" data-test="dossier-disp" data-weighed={v.weighed ? '1' : '0'}>
      <div className="msec">{T.dossier.weighed}</div>
      {!v.weighed ? <div className="muted">{reserved ? T.dossier.reserve : T.dossier.noReserve}</div> : null}
      <table className="dtab">
        <thead>
          <tr>
            <th>{T.dossier.material}</th>
            <th>{T.dossier.stageOf}</th>
            <th>{T.dossier.lots}</th>
            <th className="num">{T.dossier.norm}</th>
            <th className="num">{v.weighed ? T.dossier.qty : T.dossier.take}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: DispRow) => (
            <tr key={r.material} data-test="dossier-disp-row" data-material={r.material} data-stage={r.stage}>
              <td>
                {matName(r.material)}
                {r.qs ? <span className="muted"> · {T.dossier.qs}</span> : null}
              </td>
              <td>{stageName(r.stage)}</td>
              <td>
                <Lots material={r.material} list={r.lots} actions={actions} />
              </td>
              <td className="num">{qty(r.material, r.norm)}</td>
              <td className="num">{r.lots.length > 0 ? qty(r.material, r.qty) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {w ? (
        <div data-test="dossier-weigh">
          {T.dossier.weigh(whenText(start, w.from), whenText(start, w.to))}
          {w.scale ? (
            <>
              {' · '}
              <Go to={{ kind: 'equipment', i: w.scale.i }} actions={actions}>
                {w.scale.inv !== undefined ? T.dossier.scale(T.assets.inv(w.scale.inv)) : named(db?.equipment[w.scale.type]?.name, w.scale.type)}
              </Go>
            </>
          ) : null}
          {w.by ? (
            <>
              {' · '}
              {T.dossier.by} <WhoText w={w.by} actions={actions} />
            </>
          ) : null}
          {w.check ? (
            <>
              {' · '}
              {T.dossier.check} <WhoText w={w.check} actions={actions} />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Стадия досье; `first` — отвешивание: оно ничего не загружает, его итог — отвешенная масса, строки — в «Отвешено». */
function Stage({ st, first, start, actions }: { st: StageRow; first: boolean; start: Ymd; actions: Actions }) {
  const yieldPct = st.out !== undefined && st.in > 0 ? pctText(Math.round((st.out * 10000) / st.in), 1) : undefined;
  return (
    <li className={`dstage s-${st.state}`} data-test="dossier-stage" data-stage={st.stage} data-state={st.state}>
      <div>
        <b>{stageName(st.stage)}</b> <span className="muted">· {T.dossier.stageState[st.state]}</span>
        {st.from !== undefined ? <span className="muted"> · {st.to !== undefined ? T.dossier.packWhen(whenText(start, st.from), whenText(start, st.to)) : whenText(start, st.from)}</span> : null}
      </div>
      <div className="muted">
        <Go to={st.roomIx >= 0 ? { kind: 'room', i: st.roomIx } : undefined} actions={actions}>
          {T.roomTypes[st.room] ?? st.room}
        </Go>
        {st.equipment.map(e => (
          <span key={`${e.type}-${e.i}`}>
            {' · '}
            <Go to={e.i >= 0 ? { kind: 'equipment', i: e.i } : undefined} actions={actions}>
              {named(db?.equipment[e.type]?.name, e.type)}
              {e.inv !== undefined ? `, ${T.assets.inv(e.inv)}` : ''}
            </Go>
          </span>
        ))}
      </div>
      {st.people.length > 0 ? (
        <div>
          {T.dossier.people}: <Whos list={st.people} actions={actions} />
        </div>
      ) : null}
      {first ? null : (
        <div data-test="dossier-load">
          {st.state === 'plan' ? T.dossier.willLoad : T.dossier.loaded}:{' '}
          {st.load.length === 0
            ? T.dossier.nothingNew
            : st.load.map((l, i) => (
                <span key={l.material} data-test="dossier-load-item" data-material={l.material}>
                  {i > 0 ? '; ' : ''}
                  {matName(l.material)} {qty(l.material, l.qty)}
                  {l.lots.length > 0 ? (
                    <>
                      {' ('}
                      <Lots material={l.material} list={l.lots.map(x => ({ ...x, assay: undefined }))} actions={actions} />
                      {')'}
                    </>
                  ) : null}
                </span>
              ))}
        </div>
      )}
      {first ? (st.out !== undefined ? <div className="muted">{T.dossier.weighedTotal(kg(st.out))}</div> : null) : st.state !== 'plan' ? <div className="muted">{st.out !== undefined && yieldPct ? T.dossier.mass(kg(st.in), kg(st.out), yieldPct) : T.dossier.massIn(kg(st.in))}</div> : null}
      {st.params.length > 0 ? (
        <ul className="why">
          {st.params.map(p => (
            <li key={p.id} className={p.dev !== undefined ? 'bad' : ''} data-test="dossier-param" data-param={p.id}>
              {p.value === undefined
                ? T.regimes.target(T.ref.params[p.id] ?? p.id, paramText(p.unit, p.target), `${paramNum(p.unit, p.range[0])}–${paramText(p.unit, p.range[1])}`)
                : T.regimes.value(T.ref.params[p.id] ?? p.id, paramText(p.unit, p.value), paramText(p.unit, p.target), `${paramNum(p.unit, p.range[0])}–${paramText(p.unit, p.range[1])}`)}
              {p.sp !== undefined ? ` · ${T.regimes.sp(paramText(p.unit, p.sp))}` : null}
              {st.state === 'done' && p.value === undefined ? ` · ${T.regimes.noFact}` : null}
              {p.dev !== undefined ? (
                <>
                  {' · '}
                  <Go to={{ kind: 'dev', n: p.dev }} actions={actions}>
                    {T.dev.no(p.dev)}
                  </Go>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {st.state !== 'plan' && st.ipc.length > 0 ? (
        <ul className="why">
          {st.ipc.map(c => (
            <li key={c.test} className={c.out > 0 ? 'bad' : ''}>
              {T.dossier.ipc(testName(c.test), c.n, c.out)}
            </li>
          ))}
        </ul>
      ) : null}
      {st.stops.map(x => (
        <div key={`${x.part}-${x.from}`} className="muted">
          {T.dossier.stop(x.part, whenText(start, x.from), whenText(start, x.to))}
        </div>
      ))}
      {st.devs.length > 0 ? (
        <div>
          {T.dossier.devs}:{' '}
          {st.devs.map((n, i) => (
            <span key={n}>
              {i > 0 ? ', ' : ''}
              <Go to={{ kind: 'dev', n }} actions={actions}>
                {T.dev.no(n)}
              </Go>
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function Pack({ p, start, actions }: { p: PackDossier; start: Ymd; actions: Actions }) {
  const r = p.result;
  return (
    <div className="dsec" data-test="dossier-pack" data-state={p.state}>
      <div className="msec">{T.dossier.pack}</div>
      <div>
        {T.dossier.line(p.line)} · {named(db?.skus[p.sku]?.name, p.sku)} <span className="muted">· {T.card.packingOf(docText('skus', p.sku))}</span>
      </div>
      <div className="muted">
        {T.dossier.packState[p.state]}
        {p.start !== undefined ? ` · ${p.end !== undefined ? T.dossier.packWhen(whenText(start, p.start), whenText(start, p.end)) : whenText(start, p.start)}` : ''}
      </div>
      <div data-test="dossier-crew">
        {T.dossier.crew}: {p.people ? <Whos list={p.people} actions={actions} /> : <span className="muted">{T.dossier.notRecorded}</span>}
      </div>
      {p.clearNone ? <div className="muted" data-test="dossier-clear-none">{T.dossier.clearNone}</div> : null}
      {!p.clear && !p.people && p.state !== 'waiting' && p.state !== 'reserved' ? (
        <div data-test="dossier-clear-none">
          {T.dossier.clear}: <span className="muted">{T.dossier.notRecorded}</span>
        </div>
      ) : null}
      {p.clear ? (
        <div data-test="dossier-clear">
          {T.dossier.clear}: <Whos list={p.clear.by} actions={actions} />
          <span className="muted"> · {T.dossier.clearAt(whenText(start, p.clear.from), whenText(start, p.clear.to))}</span>
          {p.clear.check ? (
            <>
              {' · '}
              {T.dossier.checked_} <WhoText w={p.clear.check} actions={actions} />
              {p.clear.at !== undefined ? <span className="muted"> {whenText(start, p.clear.at)}</span> : null}
            </>
          ) : null}
        </div>
      ) : null}
      <div className="muted">{T.dossier.tablets(num(p.tablets))}</div>
      {r ? (
        <>
          <div>{T.dossier.result(num(r.good), num(r.scrap), num(r.remainder))}</div>
          <div className="muted">{T.dossier.counts(num(r.blisters), num(r.cartons), num(r.cases), num(r.pallets))}</div>
          <div className="muted">{T.dossier.rejects(num(r.blisterRejects), num(r.cartonRejects))}</div>
        </>
      ) : null}
      <div className="msec">{T.dossier.materials}</div>
      <table className="dtab" data-test="dossier-mats">
        <thead>
          <tr>
            <th>{T.dossier.material}</th>
            <th>{T.dossier.machine}</th>
            <th>{T.dossier.lots}</th>
            <th className="num">{T.dossier.issuedCol}</th>
            <th className="num">{T.dossier.usedCol}</th>
            <th className="num">{T.dossier.spoiledCol}</th>
            <th className="num">{T.dossier.returnedCol}</th>
          </tr>
        </thead>
        <tbody>
          {p.materials.map(m => (
            <tr key={m.material} data-test="dossier-mat" data-material={m.material}>
              <td>{matName(m.material)}</td>
              <td>{named(db?.machines[m.machine]?.name, m.machine)}</td>
              <td>
                <Lots material={m.material} list={m.lots} actions={actions} />
              </td>
              <td className="num">{m.issued !== undefined ? qty(m.material, m.issued) : '—'}</td>
              <td className="num" title={p.state === 'running' ? T.dossier.byCount : undefined}>
                {m.used !== undefined ? qty(m.material, m.used) : '—'}
              </td>
              <td className="num">{m.spoiled !== undefined ? qty(m.material, m.spoiled) : '—'}</td>
              <td className="num">{m.returned !== undefined ? qty(m.material, m.returned) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.recon ? (
        <div data-test="dossier-recon">
          <div className="msec">{T.dossier.recon}</div>
          {p.recon.map(x => {
            // расхождение в пределе — не отклонение, как и в решении по серии
            const gap = x.issued - x.used - x.spoiled - x.returned;
            const limit = p.reconLimit ?? 0;
            const over = Math.abs(gap) * 10000 > limit * x.issued;
            const text = gap === 0 ? T.dossier.reconOk(matName(x.material)) : (over ? T.dossier.reconOver : T.dossier.reconWithin)(matName(x.material), qty(x.material, Math.abs(gap)), pctText(limit, 1));
            return (
              <div key={x.material} className={over ? 'bad' : gap !== 0 ? 'muted' : ''}>
                {text}
              </div>
            );
          })}
        </div>
      ) : null}
      {p.fg ? <div className="muted">{T.dossier.fg(T.lotCode(...p.fg))}</div> : null}
    </div>
  );
}

function Decisions({ v, start, actions }: { v: DossierView; start: Ymd; actions: Actions }) {
  const rows: ReactNode[] = [];
  if (v.bulkUnits !== undefined && v.yield !== undefined) rows.push(<div key="y">{T.dossier.yieldText(num(v.bulkUnits), pctText(v.yield, 1))}</div>);
  if (v.bulk)
    rows.push(
      <div key="b">
        <Go to={v.bulk.unit !== undefined ? { kind: 'unit', n: v.bulk.unit } : undefined} actions={actions}>
          {T.dossier.bulk(T.lotCode(...v.bulk.code), T.status[v.bulk.status])}
        </Go>
      </div>,
    );
  if (v.checked !== undefined) rows.push(<div key="c">{T.dossier.checked(whenText(start, v.checked))}</div>);
  if (v.decision) rows.push(<div key="d">{T.dossier.decision[v.decision]}</div>);
  if (v.held) rows.push(<div key="h" className="bad">{T.dossier.held}</div>);
  if (v.released !== undefined) rows.push(<div key="r">{T.dossier.released(whenText(start, v.released))}</div>);
  const devs = v.devs ?? [];
  return (
    <div className="dsec" data-test="dossier-decisions">
      <div className="msec">{T.dossier.decisions}</div>
      {rows}
      {devs.length > 0 ? (
        <div data-test="dossier-devs">
          {T.dossier.devs}:{' '}
          {devs.map((d, i) => (
            <span key={d.n}>
              {i > 0 ? ', ' : ''}
              <Go to={{ kind: 'dev', n: d.n }} actions={actions}>
                {T.dev.no(d.n)}
              </Go>
              <span className="muted"> · {T.dev.state[d.status]}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Dossier({ hud, actions }: { hud: Hud; actions: Actions }) {
  const v = hud.dossier.view;
  const start = hud.start;
  const head = (k: string, val: ReactNode) => (
    <>
      <dt>{k}</dt>
      <dd>{val}</dd>
    </>
  );
  return (
    <div className="dossier panel" id="dossier" role="dialog" aria-labelledby="dossier-title" data-test="dossier" data-batch={hud.dossier.batch}>
      <div className="phead">
        <b id="dossier-title">{v?.code ? T.dossier.title(v.code) : T.dossier.button}</b>
        <span className="muted">{T.dossier.question}</span>
        <button type="button" className="close" onClick={() => actions.closeDossier()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {!v ? <div className="muted">{T.app.loading}</div> : null}
      {v?.gone ? <div className="muted empty">{T.dossier.gone}</div> : null}
      {v && !v.gone ? (
        <>
          <dl className="dhead" data-test="dossier-head">
            {v.product ? head(T.dossier.product, named(db?.products[v.product]?.name, v.product)) : null}
            {v.recipe ? head(T.dossier.recipe, docText('recipes', v.recipe)) : null}
            {v.sku ? head(T.dossier.sku, `${named(db?.skus[v.sku]?.name, v.sku)} · ${T.card.packingOf(docText('skus', v.sku))}`) : null}
            {v.mass !== undefined && v.units !== undefined ? head(T.dossier.size, T.dossier.sizeText(kg(v.mass), num(v.units))) : null}
            {v.status ? head(T.dossier.state, T.dossier.status[v.status]) : null}
            {v.issued !== undefined ? head(T.dossier.issued, whenText(start, v.issued)) : null}
            {v.produced !== undefined ? head(T.dossier.produced, <span title={T.dossier.producedHint}>{dayText(momentOf(start, v.produced).day)}</span>) : null}
          </dl>
          <Disp v={v} start={start} actions={actions} />
          <div className="dsec">
            <div className="msec">{T.dossier.stages}</div>
            <ol className="dstages">
              {(v.stages ?? []).map((st, i) => (
                <Stage key={st.stage} st={st} first={i === 0} start={start} actions={actions} />
              ))}
            </ol>
          </div>
          {v.pack ? <Pack p={v.pack} start={start} actions={actions} /> : null}
          <Decisions v={v} start={start} actions={actions} />
        </>
      ) : null}
    </div>
  );
}
