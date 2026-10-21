// Карточка вещи (docs/specs/2026-10-panels.md, 3б; docs/13-art.md, §11): одного устройства для всех — что это → состояние
// → почему так → что можно сделать → история. Снизу экрана, как карточка выбранного в «Больнице» (её src/ui/App.tsx,
// `card`). Вид приходит из потока расчёта (src/sim/views.ts) без истины и без слов; слова — отсюда, из src/i18n/.
import type { ReactNode } from 'react';
import type { PartType } from '../content/types';
import { civilFromDays, momentOf, weekday, type Ymd } from '../engine/core/calendar';
import { clock, dayText, hText, named, num, qtyText, T, whenText } from '../i18n';
import type { SheetView } from '../sim/hours';
import type { NowRow } from '../sim/now';
import type { Admission, DocNow } from '../sim/people';
import type { AssetInfo } from '../sim/places';
import type { CardView, Hist, Holds, Why } from '../sim/views';
import { assetName, untilText, unfitText, workName } from './assets';
import { db, docText } from './db';
import { StatusIcon, TaskIcon } from './icons';
import { placeText, supplierText } from './Stock';
import type { Actions } from './store';

/**
 * Табель месяца (Б4а): по дням с 1-го по сегодня — отметки формы Т-13 и часы, сеткой по дням недели; итоги — отработано
 * против нормы, сверхурочно за месяц и за год; работает после смены сейчас — с какого часа.
 */
function Sheet({ v, start }: { v: SheetView; start: Ymd }) {
  const lead = v.rows.length > 0 ? weekday(v.rows[0].day) : 0;
  return (
    <>
      <div className="csec">{T.card.sheet(T.cash.months[v.m - 1], v.y)}</div>
      <div className="sheet" title={T.card.marksHint} data-test="card-sheet">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {v.rows.map(r => (
          <span key={r.day} className={`sd${r.over + r.off > 0 ? ' over' : ''}${r.work === 0 ? ' rest' : ''}`} data-test="sheet-day">
            <b>{civilFromDays(r.day).d}</b>
            {r.marks.map(m => T.card.marks[m]).join(' ')}
            {r.work > 0 ? <span className="sh">{hText(r.work)}</span> : null}
          </span>
        ))}
      </div>
      <dl>
        <Row k={T.card.worked(hText(v.worked), hText(v.norm))}>{T.card.overMonth(hText(v.over))}</Row>
        <Row k={T.card.overYear(hText(v.year), hText(v.limit))}>
          {v.since !== undefined ? <span className="warn" data-test="card-overnow">{T.card.overNow(clock(momentOf(start, v.since).sec))}</span> : null}
        </Row>
      </dl>
    </>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const when = (start: Ymd, t: number | undefined) => (t === undefined ? T.card.noTime : whenText(start, t));

const docName = (d: DocNow) => T.ref.doc(d.code, d.rev);

/** Допуск словами (Б3б): допущен; до какого дня и по чему; не допущен — по чему. */
export function admText(a: Admission): string {
  return a.k === 'ok' ? T.ref.adm.ok : a.k === 'soon' ? T.ref.adm.soon(dayText(a.last), docName(a.doc)) : T.ref.adm.no(docName(a.doc));
}

function whyText(w: Why, start: Ymd): string {
  switch (w.k) {
    case 'task': {
      const task = T.tasks[w.task] ?? w.task;
      if (w.busy) return T.why.taskBusy(task);
      // ждёт допуска — называет документ (Б3б), ждёт актив — называет его (Б3в)
      const cause = w.wait === 'qual' && w.lack ? T.why.lack(docName(w.lack)) : w.wait === 'asset' && w.unfit ? `${unfitText(w.unfit)} — ${assetName(w.unfit)}` : w.wait ? T.wait[w.wait] : '';
      return w.wait && w.since !== undefined ? T.why.taskWait(task, cause, whenText(start, w.since)) : T.why.taskOpen(task);
    }
    case 'asset':
      return T.assets.waits(w.batch, unfitText(w.asset), assetName(w.asset));
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

/**
 * Что лежит на паллете: тара по виду и сколько в ней — по учёту; у готовой продукции — пачки и сколько в полном ящике.
 * Масса — с таким числом знаков, чтобы разная тара не читалась одинаковой: 25,00 и 24,98 кг, а не дважды 25,0.
 */
function holdsText(h: Holds, n: number, unit: 'mass' | 'pcs' | undefined): string {
  const kind = db?.containers[h.container]?.kind ?? '';
  let digits = 1;
  const per = (q: number) => (h.full !== undefined ? T.card.packs(q) : unit ? qtyText(q, unit, digits) : num(q));
  while (digits < 6 && new Set(h.by.map(g => per(g.qty))).size < h.by.length) digits++;
  const text = h.by.length === 1 ? T.card.holds(n, kind, per(h.by[0].qty)) : T.card.holdsBy(n, kind, h.by.map(g => T.card.holdsGroup(g.n, per(g.qty))));
  return h.full !== undefined && h.by[0].qty !== h.full ? `${text}; ${T.card.full(per(h.full))}` : text;
}

function histText(h: Hist, unit: 'mass' | 'pcs' | undefined, parts: readonly PartType[], asset?: AssetInfo): string {
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
    case 'rec': {
      // запись квалификации или калибровки (Б3в): на старте игры — без того, кто принял
      const work = asset ? workName(asset, h.work) : T.assets.work[h.work];
      if (h.by) return T.assets.recBy(work, dayText(h.day), dayText(h.until), T.card.person(named(db?.roles[h.by.role]?.name, h.by.role), h.by.tab));
      return `${T.assets.rec(work, dayText(h.day), dayText(h.until))} · ${T.assets.startRec}`;
    }
  }
}

/** Актив в карточке (Б3в): инвентарный номер, код места, срок каждой нужной работы, визит подрядчика, не работает ли. */
function AssetRows({ a, start }: { a: AssetInfo; start: Ymd }) {
  const visit = a.visit;
  return (
    <>
      <Row k={T.assets.invLabel}>
        <span className="mono" data-test="card-inv">
          {T.assets.inv(a.inv)}
        </span>
        {a.critical ? <span className="muted"> · {T.assets.critical}</span> : null}
      </Row>
      <Row k={T.assets.place}>
        <span className="mono">{a.place}</span>
      </Row>
      {a.needs.map(w => (
        <Row key={w} k={workName(a, w)}>
          <span data-test={`card-${w}`}>{untilText(w === 'qual' ? a.qual : a.cal, a.today)}</span>
        </Row>
      ))}
      {visit ? (
        <Row k="">
          <span data-test="card-visit">
            {visit.accepting
              ? T.assets.accepting(workName(a, visit.work))
              : a.working && visit.to !== undefined
                ? T.assets.working(workName(a, visit.work), whenText(start, visit.to))
                : visit.from === undefined && a.unfit === 'visit'
                  ? T.assets.waiting(workName(a, visit.work))
                  : T.assets.visitAt(workName(a, visit.work), whenText(start, visit.at))}
          </span>
        </Row>
      ) : null}
      {a.unfit === 'qual' || a.unfit === 'cal' ? (
        <Row k="">
          <b data-test="card-stopped">
            {T.assets.stopped} — {unfitText(a)}
          </b>
        </Row>
      ) : null}
    </>
  );
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

function History({ list, start, unit, parts = [], asset }: { list: Hist[]; start: Ymd; unit?: 'mass' | 'pcs'; parts?: readonly PartType[]; asset?: AssetInfo }) {
  return (
    <>
      <div className="csec">{T.card.history}</div>
      {list.length === 0 ? (
        <div className="muted">{T.card.noHistory}</div>
      ) : (
        <ol className="hist" data-test="card-history">
          {list.map((h, i) => (
            <li key={i}>
              <span className="mono muted">{h.k === 'reserved' || (h.k === 'kit' && h.t === undefined) ? '' : h.k === 'rec' ? dayText(h.day) : when(start, h.t)}</span> {histText(h, unit, parts, asset)}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** `beside` — открыта панель справа: карточка уже, чтобы не заходить под неё; `watch` — работа вещи в «Сейчас» (Б1б). */
export function Card({ v, start, plant, actions, beside, watch }: { v: CardView; start: Ymd; plant: string; actions: Actions; beside?: boolean; watch?: NowRow }) {
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
                {lot.contract ? ` · ${lot.list ? T.card.byContractList(lot.contract) : T.card.byContract(lot.contract)}` : ''}
              </Row>
            ) : null}
            {lot?.maker ? (
              <Row k={T.card.maker}>
                <span data-test="card-maker">
                  {T.now.maker(named(db?.makers[lot.maker]?.name, lot.maker), named(db?.makers[lot.maker]?.country))} · {T.card.vendorLot} {lot.vendorLot}
                </span>
              </Row>
            ) : lot && lot.supplier !== 'start' && lot.supplier !== 'plant' ? (
              <Row k={T.card.vendorLot}>{lot.vendorLot}</Row>
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
              {placeText(c.where, plant)}
              {c.holds ? '' : ` · ${T.card.containers(c.containers)}`}
            </Row>
            {c.holds ? <Row k={T.card.holdsLabel}>{holdsText(c.holds, c.containers, mat?.unit)}</Row> : null}
            {lot && mat ? (
              <>
                <Row k={T.card.left}>
                  {qtyText(lot.left, mat.unit)} <span className="muted">/ {qtyText(lot.qty, mat.unit)}</span>
                </Row>
                <Row k={T.card.expiry}>{dayText(lot.expiry)}</Row>
                {lot.recipe ? (
                  <Row k={T.card.recipe}>
                    <span className="mono" data-test="card-recipe">
                      {docText('recipes', lot.recipe)}
                    </span>
                  </Row>
                ) : null}
                {lot.sku ? (
                  <Row k={T.card.packing}>
                    <span className="mono">{docText('skus', lot.sku)}</span>
                  </Row>
                ) : null}
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
            {c.batch ? (
              <Row k={T.card.batch}>
                {c.batch}
                {c.recipe ? (
                  <span className="muted" data-test="card-recipe">
                    {' '}
                    · {T.card.recipeOf(docText('recipes', c.recipe))}
                  </span>
                ) : null}
              </Row>
            ) : null}
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
            {c.batch ? (
              <Row k={T.card.batch}>
                {c.batch}
                {c.kind === 'equipment' && c.recipe ? (
                  <span className="muted" data-test="card-recipe">
                    {' '}
                    · {T.card.recipeOf(docText('recipes', c.recipe))}
                  </span>
                ) : null}
              </Row>
            ) : null}
            {c.kind === 'machine' && c.sku ? (
              <Row k={T.card.sku}>
                {named(db?.skus[c.sku]?.name, c.sku)}
                <span className="muted"> · {T.card.packingOf(docText('skus', c.sku))}</span>
              </Row>
            ) : null}
            {c.parts.length ? (
              <Row k={T.card.parts}>
                {c.parts
                  .map(p => `${named(rec?.parts.find(x => x.id === p.type)?.name, p.type)}: ${T.hist.wear(`${num(p.wear / 100)}\u00a0%`)}${p.failed ? `, ${T.card.failed}` : ''}${p.repair ? `, ${T.card.repairing}` : ''}`)
                  .join('; ')}
              </Row>
            ) : null}
            {c.asset ? <AssetRows a={c.asset} start={start} /> : null}
          </dl>
          <Why list={c.why} start={start} />
          <History list={c.history} start={start} parts={rec?.parts} asset={c.asset} />
        </>
      );
      break;
    }
    case 'person':
      title = T.card.person(named(db?.roles[c.role]?.name, c.role), c.tab);
      body = (
        <>
          <dl>
            <Row k={T.card.state}>
              {c.doing.k === 'task' ? (
                <>
                  <TaskIcon kind={c.doing.task} /> {T.why.taskBusy(T.tasks[c.doing.task] ?? c.doing.task)}
                  {c.learning ? <span data-test="card-learning"> — {T.card.learning(docName(c.learning))}</span> : null}
                </>
              ) : c.doing.k === 'walk' ? (
                c.doing.exit ? (
                  T.card.doing.exit
                ) : (
                  T.card.doing.walk
                )
              ) : (
                T.card.doing[c.doing.k]
              )}
            </Row>
            <Row k={T.card.shift}>{named(db?.shifts[c.shift]?.name, c.shift)}</Row>
            <Row k={T.card.skill}>{num(c.skill)}</Row>
            <Row k={T.card.admission}>
              <span className={c.adm.k === 'no' ? 'bad' : ''} data-test="card-adm">
                {admText(c.adm)}
              </span>
            </Row>
          </dl>
          <div className="csec">{T.card.training}</div>
          <ol className="hist" data-test="card-train">
            {c.train.map(r => (
              <li key={r.doc.code} className={r.ok ? '' : 'bad'}>
                {r.rec ? T.card.trained(T.ref.doc(r.doc.code, r.rec.rev), dayText(r.rec.day), dayText(r.rec.until)) : T.card.untrained(docName(r.doc))}
              </li>
            ))}
          </ol>
          <Sheet v={c.sheet} start={start} />
        </>
      );
      break;
    case 'vehicle':
      title = named(db?.vehicles[c.type]?.name, c.type);
      body = (
        <dl>
          <Row k={T.card.state}>
            {c.task ? (
              <>
                <TaskIcon kind={c.task} /> {T.why.taskBusy(T.tasks[c.task] ?? c.task)}
              </>
            ) : (
              T.card.free
            )}
          </Row>
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
      {watch ? (
        <div className="cwatch">
          <button type="button" onClick={() => actions.watch(watch.key)} title={T.now.watchHint} data-test="card-watch">
            {T.now.watch}
          </button>
        </div>
      ) : null}
    </div>
  );
}
