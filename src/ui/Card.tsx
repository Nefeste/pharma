// Карточка вещи (docs/specs/2026-10-panels.md, 3б; docs/13-art.md, §11): одного устройства для всех — что это → состояние
// → почему так → что можно сделать → история. Снизу экрана, как карточка выбранного в «Больнице» (её src/ui/App.tsx,
// `card`). Вид приходит из потока расчёта (src/sim/views.ts) без истины и без слов; слова — отсюда, из src/i18n/.
import { type ReactNode, useState } from 'react';
import type { PartType } from '../content/types';
import { civilFromDays, momentOf, weekday, type Ymd } from '../engine/core/calendar';
import { clock, dayText, hText, money, named, num, pctText, qtyText, T, whenText } from '../i18n';
import { DEPT_SEAT } from '../engine/seats';
import type { SaView, SheetView } from '../sim/hours';
import type { NowRow } from '../sim/now';
import type { Admission, DocNow } from '../sim/people';
import type { AssetInfo } from '../sim/places';
import { firstOf } from '../app/firsts';
import type { Inside, LineMaterial } from '../sim/dossier';
import type { CardView, Hist, Holds, RoomClean, Why } from '../sim/views';
import { assetName, untilText, unfitText, workName } from './assets';
import { db, docText } from './db';
import { DevBody, First, KnobsBlock, RegimesBlock, ReleaseBlock, SpeedBlock } from './Decide';
import { LeaveBlock } from './Leave';
import { AndonRows, BottleBlock, LoadBlock } from './Layers';
import { StatusIcon, TaskIcon } from './icons';
import { WhoList } from './Journal';
import { placeText, supplierText } from './Stock';
import { type Actions, type Hud, holds } from './store';
import { WasteBlock } from './Waste';

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

type PersonCard = Extract<CardView['card'], { kind: 'person' }>;

/**
 * График человека (Б4б): нынешний; ждущий перевод — с какого дня и «Отменить перевод»; «Перевести на график…» — список
 * графиков базы, кроме того, в котором он будет. Переводит пост отдела человека или директор (как политику, Б4а).
 */
function Roster({ c, hud, actions }: { c: PersonCard; hud: Hud; actions: Actions }) {
  const dept = db?.roles[c.role]?.dept;
  const mine = dept === undefined || holds(hud, DEPT_SEAT[dept]);
  const title = mine ? '' : T.seats.notYours(T.seats.names[DEPT_SEAT[dept!]] ?? '');
  const will = c.next?.shift ?? c.shift;
  const ids = Object.keys(db?.shifts ?? {}).filter(id => id !== will);
  return (
    <>
      <span data-test="card-shift">{named(db?.shifts[c.shift]?.name, c.shift)}</span>
      {c.next ? (
        <>
          {' · '}
          <span className="warn" data-test="card-next">
            {T.card.next(dayText(c.next.from), named(db?.shifts[c.next.shift]?.name, c.next.shift))}
          </span>{' '}
          <button type="button" className="link" disabled={!mine} title={title} onClick={() => actions.roster(c.person, c.shift)} data-test="card-roster-cancel">
            {T.card.rosterCancel}
          </button>
        </>
      ) : null}
      <div>
        <select
          value=""
          disabled={!mine}
          title={title}
          onChange={e => {
            if (e.target.value) actions.roster(c.person, e.target.value);
          }}
          data-test="card-roster"
        >
          <option value="">{T.card.rosterTo}</option>
          {ids.map(id => (
            <option key={id} value={id}>
              {named(db?.shifts[id]?.name, id)}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

/**
 * Увольнение (Б4в): по соглашению — последний день сегодня и выплата; не выдержал испытание — через срок
 * предупреждения, только в срок испытания; подавшего заявление — отпустить раньше. Каждое — со словами, что будет,
 * и подтверждением; чужой пост — кнопки погашены.
 */
function Dismiss({ c, hud, actions }: { c: PersonCard; hud: Hud; actions: Actions }) {
  const [ask, setAsk] = useState<'agree' | 'trial' | 'early' | undefined>();
  const dept = db?.roles[c.role]?.dept;
  const mine = dept === undefined || holds(hud, DEPT_SEAT[dept]);
  const title = mine ? '' : T.seats.notYours(T.seats.names[DEPT_SEAT[dept!]] ?? '');
  const t = c.terms!;
  const words =
    ask === 'agree' && t.agree
      ? T.card.dismissAgreeAsk(dayText(t.agree.last), money(t.agree.pay))
      : ask === 'trial' && t.trial
        ? T.card.dismissTrialAsk(dayText(t.trial.last))
        : ask === 'early' && t.early
          ? T.card.earlyAsk(dayText(t.early.last))
          : '';
  return (
    <div className="dismiss" data-test="card-dismiss">
      {t.agree ? (
        <button type="button" disabled={!mine} title={title} onClick={() => setAsk('agree')} data-test="dismiss-agree">
          {T.card.dismissAgree}
        </button>
      ) : null}{' '}
      {t.trial ? (
        <button type="button" disabled={!mine || !t.trial.ok} title={!mine ? title : t.trial.ok ? '' : (T.notices.why.tooLate ?? '')} onClick={() => setAsk('trial')} data-test="dismiss-trial">
          {T.card.dismissTrial}
        </button>
      ) : null}
      {t.early ? (
        <button type="button" disabled={!mine} title={title} onClick={() => setAsk('early')} data-test="dismiss-early">
          {T.card.early}
        </button>
      ) : null}
      {ask && words ? (
        <div className="hireask" data-test="dismiss-ask">
          <span>{words}</span>{' '}
          <button
            type="button"
            disabled={!mine}
            onClick={() => {
              actions.dismiss(c.person, ask);
              setAsk(undefined);
            }}
            data-test="dismiss-do"
          >
            {T.card.dismissDo}
          </button>{' '}
          <button type="button" className="link" onClick={() => setAsk(undefined)}>
            {T.card.dismissCancel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Учётный период сменного по циклу (Б4б): норма, по графику, отработано, после смен, снятые смены. */
function SaBlock({ v }: { v: SaView }) {
  return (
    <div title={T.card.saHint} data-test="card-sa">
      <div className="csec">{T.card.sa(dayText(v.first), dayText(v.last))}</div>
      <div className="small">{T.card.saLine(hText(v.norm), hText(v.plan), hText(v.worked), hText(v.after), v.off)}</div>
    </div>
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
    case 'room':
      return T.why.room(w.code);
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
    case 'weighed':
      return T.hist.weighed(h.batch, unit ? qtyText(h.qty, unit, 3) : num(h.qty));
    case 'pack':
      return T.hist.pack(h.batch, h.qty === undefined ? undefined : unit ? qtyText(h.qty, unit) : num(h.qty), h.used === undefined ? undefined : unit ? qtyText(h.used, unit) : num(h.used));
    case 'shipped':
      return T.hist.shipped(named(db?.customers[h.customer]?.name, h.customer), unit ? qtyText(h.qty, unit) : num(h.qty));
    case 'wasted':
      return T.hist.wasted(h.pallets, unit ? qtyText(h.qty, unit) : num(h.qty));
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

/** Кнопка досье серии (Б1д): из карточки помещения, оборудования, машины линии и партии своей продукции. */
function DossierButton({ n, actions }: { n: number | undefined; actions: Actions }) {
  if (n === undefined) return null;
  return (
    <button type="button" onClick={() => actions.openDossier(n)} title={T.dossier.hint} data-test="card-dossier">
      {T.dossier.button}
    </button>
  );
}

/** Чистота помещения (Б1е): чисто — для какого продукта и до какого часа годно; грязно — после чего и какая уборка нужна. */
function RoomCleanRows({ x, start }: { x: RoomClean; start: Ymd }) {
  const product = x.product ? named(db?.products[x.product]?.name, x.product) : undefined;
  return x.k === 'clean' ? (
    <>
      <Row k={T.card.cleanFor}>{product ?? T.card.anyProduct}</Row>
      <Row k={T.card.cleanUntil}>
        <span data-test="card-clean-until">{whenText(start, x.until)}</span>
        {x.expired ? <span className="muted"> · {T.card.cleanExpired}</span> : null}
      </Row>
    </>
  ) : (
    <>
      {product ? <Row k={T.card.product}>{product}</Row> : null}
      <Row k={T.card.cleaning}>{x.major ? T.card.majorClean : x.until !== undefined ? T.card.minorUntil(whenText(start, x.until)) : T.card.minorClean}</Row>
    </>
  );
}

/**
 * Что в оборудовании сейчас (Б1д; GMP ЕАЭС, ч. I, п. 5.12): продукт, серия и стадия; выход прошлой стадии по досье и что
 * загружено на этой — по партиям; на отвешивании — что взвешивают.
 */
function InsideBlock({ x }: { x: Inside }) {
  const unit = (m: string) => db?.materials[m]?.unit ?? 'mass';
  return (
    <>
      <div className="csec">{T.inside.title}</div>
      <div className="muted">
        {named(db?.products[x.product]?.name, x.product)} · {T.inside.stage(T.stages[x.stage] ?? x.stage, x.code)}
      </div>
      <ul className="why" data-test="card-inside" data-stage={x.stage}>
        {x.prev ? <li>{T.inside.prev(T.stages[x.prev.stage] ?? x.prev.stage, qtyText(x.prev.mass, 'mass', 3))}</li> : null}
        {x.load.map(l => (
          <li key={l.material} data-test="card-inside-item" data-material={l.material}>
            {named(db?.materials[l.material]?.name, l.material)} — {qtyText(l.qty, unit(l.material), unit(l.material) === 'pcs' ? 0 : 3)}
            {l.lots.length > 0 ? <span className="muted"> · {l.lots.map(c => T.lotCode(...c.code)).join(', ')}</span> : null}
          </li>
        ))}
      </ul>
      <div className="muted">{x.stage === 'dispense' ? T.inside.weighing : T.inside.mass(qtyText(x.mass, 'mass', 3))}</div>
    </>
  );
}

/** Материалы машины линии (Б1д): партия, выдано, израсходовано по счёту машины и на наладку, осталось у линии. */
function LineMaterials({ list }: { list: readonly LineMaterial[] }) {
  return (
    <>
      <div className="csec">{T.inside.lines}</div>
      <ul className="why" data-test="card-line-mats" title={T.inside.useHint}>
        {list.map(m => {
          const u = db?.materials[m.material]?.unit ?? 'pcs';
          const q = (v: number) => qtyText(v, u, u === 'pcs' ? 0 : 3);
          return (
            <li key={m.material} data-test="card-line-mat" data-material={m.material}>
              {T.inside.material(named(db?.materials[m.material]?.name, m.material), m.lots.map(c => T.lotCode(...c)).join(', '))}
              <div className="muted">{T.inside.use(q(m.issued), q(m.used), q(m.left))}</div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * `beside` — открыта панель справа: карточка уже, чтобы не заходить под неё; `watch` — работа вещи в «Сейчас» (Б1б);
 * `hud` — чьи посты у игрока и какие пояснения он уже понял (Б1г).
 */
export function Card({ v, start, plant, actions, hud, beside, watch }: { v: CardView; start: Ymd; plant: string; actions: Actions; hud: Hud; beside?: boolean; watch?: NowRow }) {
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
            ) : lot && mat?.kind === 'fg' ? (
              // готовая продукция — номер серии (Б1г): у склада на старте серии сделаны до игры
              <Row k={T.card.batch}>
                <span className="mono" data-test="card-fg-batch">
                  {lot.vendorLot}
                </span>
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
          <DossierButton n={c.lot?.batch} actions={actions} />
          {c.release ? (
            <ReleaseBlock r={c.release} hud={hud} actions={actions} />
          ) : (
            <>
              <div className="csec">{T.card.can}</div>
              <div className="muted">{T.card.nothing}</div>
            </>
          )}
          <WhoList rows={c.who} start={start} actions={actions} />
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
            {c.clean ? <RoomCleanRows x={c.clean} start={start} /> : null}
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
          {c.inside ? <InsideBlock x={c.inside} /> : null}
          {c.regimes ? <RegimesBlock g={c.regimes} start={start} actions={actions} /> : null}
          {c.knobs ? <KnobsBlock list={c.knobs} hud={hud} actions={actions} /> : null}
          {c.waste ? <WasteBlock w={c.waste} start={start} /> : null}
          <DossierButton n={c.bn} actions={actions} />
          <Why list={c.why} start={start} />
          {hud.selected ? <LoadBlock key={JSON.stringify(hud.selected)} hud={hud} thing={hud.selected} plant={plant} actions={actions} /> : null}
          {hud.selected ? <BottleBlock hud={hud} thing={hud.selected} actions={actions} /> : null}
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
          {c.kind === 'equipment' && c.inside ? <InsideBlock x={c.inside} /> : null}
          {c.kind === 'machine' && c.materials ? <LineMaterials list={c.materials} /> : null}
          {c.kind === 'machine' && c.speed ? <SpeedBlock v={c.speed} hud={hud} actions={actions} /> : null}
          {c.kind === 'machine' && hud.selected ? <LoadBlock key={JSON.stringify(hud.selected)} hud={hud} thing={hud.selected} plant={plant} actions={actions} /> : null}
          {c.kind === 'equipment' && c.regimes ? <RegimesBlock g={c.regimes} start={start} actions={actions} /> : null}
          {c.kind === 'equipment' && c.knobs ? <KnobsBlock list={c.knobs} hud={hud} actions={actions} /> : null}
          <DossierButton n={c.bn} actions={actions} />
          <Why list={c.why} start={start} />
          <WhoList rows={c.who} start={start} actions={actions} />
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
                  {c.doing.item ? (
                    <span data-test="card-item">
                      {' — '}
                      {named(db?.materials[c.doing.item.material]?.name, c.doing.item.material)}, {T.lotCode(...c.doing.item.lot)}
                    </span>
                  ) : null}
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
            <Row k={T.card.shift}>
              <Roster c={c} hud={hud} actions={actions} />
            </Row>
            <Row k={T.card.skill}>{num(c.skill)}</Row>
            <Row k={T.card.salary}>
              <span data-test="card-salary">{T.card.perMonth(money(c.salary))}</span>
            </Row>
            {c.hired !== undefined ? <Row k={T.card.hiredOn}>{dayText(c.hired)}</Row> : null}
            {c.trial !== undefined ? (
              <Row k={T.card.trialTo}>
                <span data-test="card-trial">{dayText(c.trial)}</span>
              </Row>
            ) : null}
            {c.quit ? (
              <Row k={c.gone ? T.card.goneOut : T.card.quit}>
                <span className="warn" data-test="card-quit">
                  {[T.card.quitLine(T.hire.why[c.quit.why] ?? c.quit.why, dayText(c.quit.last)), c.quit.why === 'own' ? T.card.quitDay(dayText(c.quit.day)) : '', c.quit.pay ? T.card.quitPay(money(c.quit.pay)) : ''].filter(Boolean).join(' · ')}
                </span>
              </Row>
            ) : null}
            <Row k={T.card.admission}>
              <span className={c.adm.k === 'no' ? 'bad' : ''} data-test="card-adm">
                {admText(c.adm)}
              </span>
            </Row>
          </dl>
          {c.terms ? <Dismiss c={c} hud={hud} actions={actions} /> : null}
          <WhoList rows={c.who} start={start} actions={actions} />
          <div className="csec">{T.card.training}</div>
          <ol className="hist" data-test="card-train">
            {c.train.map(r => (
              <li key={r.doc.code} className={r.ok ? '' : 'bad'}>
                {r.rec ? T.card.trained(T.ref.doc(r.doc.code, r.rec.rev), dayText(r.rec.day), dayText(r.rec.until)) : T.card.untrained(docName(r.doc))}
              </li>
            ))}
          </ol>
          {c.leave ? <LeaveBlock v={c.leave} also={c.also} hud={hud} actions={actions} /> : null}
          <Sheet v={c.sheet} start={start} />
          {c.sa ? <SaBlock v={c.sa} /> : null}
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
    case 'dev':
      // отклонение (Б1г): вид и номер в журнале отклонений
      title = (
        <>
          {T.morning.devKinds[c.what]} <span className="mono">{T.dev.no(c.dev)}</span>
        </>
      );
      body = <DevBody c={c} start={start} hud={hud} actions={actions} />;
      break;
    case 'order':
      // заказ покупателя (Б5ж): его открывают из «Почему?» показателей — на полу заказа нет
      title = T.card.orderTitle(c.order);
      body = (
        <dl data-test="card-order">
          <Row k={T.card.state}>{T.card.orderStatus[c.status] ?? c.status}</Row>
          <Row k={T.card.customer}>{named(db?.customers[c.customer]?.name, c.customer)}</Row>
          <Row k={T.card.placed}>{whenText(start, c.placed)}</Row>
          <Row k={T.card.due}>{whenText(start, c.due)}</Row>
          {c.shipped !== undefined ? <Row k={T.card.shippedAt}>{whenText(start, c.shipped)}</Row> : null}
          <Row k={T.card.minShelf}>{T.card.minShelfText(pctText(c.minShelf))}</Row>
          <Row k={T.card.orderLines}>
            {c.lines.map(l => (
              <div key={l.sku} className={l.shipped < l.cases && c.status !== 'open' ? 'bad' : undefined}>
                {T.card.orderLine(named(db?.skus[l.sku]?.name, l.sku), l.shipped, l.cases)}
              </div>
            ))}
          </Row>
        </dl>
      );
      break;
    case 'truck':
      title = T.card.truck(!!c.customer, !!c.waste);
      body = (
        <dl>
          <Row k={T.card.state}>{!c.docked ? T.card.truckState.yard : c.customer || c.waste ? T.card.truckState.load : c.open ? T.card.truckState.unload : T.card.truckState.check}</Row>
          {c.waste ? <Row k="">{T.waste.booked(whenText(start, c.waste.booked), c.waste.by === 'player')}</Row> : null}
          {c.customer ? <Row k={T.card.supplier}>{named(db?.customers[c.customer]?.name, c.customer)}</Row> : null}
          {c.supplier ? <Row k={T.card.supplier}>{supplierText(c.supplier)}</Row> : null}
          {c.po ? <Row k={T.card.order}>{c.po}</Row> : null}
          <Row k={T.card.arrived}>{whenText(start, c.arrived)}</Row>
          <Row k="">{T.card.units(c.units)}</Row>
        </dl>
      );
      break;
  }
  // со слоем «Проблемы» (Б1к) — то, что не работает у вещи сейчас, теми же словами, что у значка на полу
  const andon = hud.layer === 'andon' && hud.selected ? hud.andon.view?.items.find(x => JSON.stringify(x.thing) === JSON.stringify(hud.selected)) : undefined;
  return (
    <div className={`card panel${beside ? ' beside' : ''}`} id="card" data-test="card">
      <div className="cardhead">
        <b id="card-title">{title}</b>
        <button type="button" className="close" onClick={() => actions.select(undefined)} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      <First kind={firstOf(c)} hud={hud} actions={actions} />
      {andon ? (
        <div data-test="card-andon">
          <div className="csec">{T.andon.title}</div>
          <AndonRows item={andon} plant={plant} start={start} />
        </div>
      ) : null}
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
