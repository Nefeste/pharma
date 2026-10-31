// Журнал решений (Б5а; docs/specs/2026-10-vertical-slice.md, «Б5а»): окно справа — кто что решил и почему. Строки — от
// новых к старым: время, кто — руководитель или вы с места, — что решено и о чём; у вещи — переход к её карточке;
// строка раскрывается причиной с числами завода. Отбор — по посту и по автору. «Кто решил» в карточках — строки с
// «Почему?», которое открывает журнал на записи. Вид собирает поток расчёта (src/sim/journal.ts); слова — здесь и в
// src/i18n/.
import { useState } from 'react';
import { SEATS, type SeatId } from '../content/types';
import { momentOf, type Ymd } from '../engine/core/calendar';
import { KEEP } from '../engine/journal';
import type { Decided, Head } from '../engine/types';
import { dayText, money, named, num, pctText, qtyText, T, whenText } from '../i18n';
import type { JournalRef, JournalRow, WhoRow } from '../sim/journal';
import { assetClass, workName } from './assets';
import { db } from './db';
import type { Actions, Hud } from './store';
import { attrNum, attrText, paramText } from './units';

const sku = (id?: string) => (id ? named(db?.skus[id]?.name, id) : '');
const product = (id?: string) => (id ? named(db?.products[id]?.name, id) : '');
const material = (id: string) => named(db?.materials[id]?.name, id);
const role = (id: string) => named(db?.roles[id]?.name, id);
const testName = (id: string) => named(db?.tests[id]?.name, id);
const unitOf = (m: string) => db?.materials[m]?.unit ?? 'mass';
const qty = (m: string, v: number) => qtyText(v, unitOf(m));
const machineName = (id?: string) => (id ? named(db?.equipment[id]?.name ?? db?.machines[id]?.name, id) : '');
const partName = (machine?: string, part?: string) => {
  const rec = machine ? (db?.equipment[machine] ?? db?.machines[machine]) : undefined;
  return named(rec?.parts.find(p => p.id === part)?.name, part ?? '');
};
const party = (id: string) => named(db?.suppliers[id]?.name ?? db?.customers[id]?.name, id);
/** Пара `поставщик|изготовитель` — словами. */
const pairName = (key: string) => {
  const [s, m] = key.split('|');
  return `${party(s)} — ${named(db?.makers[m]?.name, m)}`;
};
const batchCode = (r: JournalRef) => r.code ?? (r.bn !== undefined ? `B${r.bn}` : '');
const model = (r: JournalRef) => (r.model ? db?.investigations[r.model] : undefined);
const cause = (r: JournalRef, id: string) => named(model(r)?.candidates.find(c => c.id === id)?.name, id);
const p10k = (p: number) => pctText(p);

/** Кто решил: руководитель или «вы» с местом. */
export function whoText(by: Head | 'player', seat?: SeatId): string {
  return by === 'player' ? T.journal.player(seat ? (T.seats.names[seat] ?? seat) : '') : (T.journal.names[by] ?? by);
}

/** Уставка словами: режим стадии карты с единицей или скорость блистерной позиции — блистеров в минуту. */
function modeText(r: JournalRef, v: number): string {
  const m = r.mode;
  if (m?.sku) return T.ref.perMin(num(v), T.ref.items.blister ?? '');
  const p = m?.recipe ? db?.recipes[m.recipe]?.stages.find(st => st.id === m.stage)?.params.find(x => x.id === m.param) : undefined;
  return p ? paramText(p.unit, v) : num(v);
}

/** Что за уставка: скорость блистерной позиции или режим, стадия и карта — как на планёрке. */
function modeWhat(r: JournalRef): string {
  const m = r.mode;
  if (m?.sku) return `${T.speed.title} · ${sku(m.sku)}`;
  return [T.ref.params[m?.param ?? ''] ?? m?.param, T.stages[m?.stage ?? ''] ?? m?.stage, m?.recipe ? named(db?.recipes[m.recipe]?.name, m.recipe) : ''].filter(Boolean).join(' · ');
}

/** Что решено и о чём — одной строкой. */
export function whatText(d: Decided, r: JournalRef, start: Ymd): string {
  const J = T.journal.what;
  switch (d.kind) {
    case 'order':
      return `${J.order(sku(d.sku) || named(db?.recipes[d.recipe]?.name, d.recipe), whenText(start, d.notBefore))}${r.code ? ` · ${T.now.batch(r.code)}` : ''}`;
    case 'po':
      return J.po(party(d.supplier), (r.po?.lines ?? []).map(l => `${material(l.material)}, ${qty(l.material, l.qty)}`).join('; '));
    case 'step':
      return `${J.step(named(model(r)?.steps.find(s => s.id === d.step)?.name, d.step))}${batchCode(r) ? ` · ${T.now.batch(batchCode(r))}` : ''}`;
    case 'conclude':
      return `${J.conclude(cause(r, d.cause), d.fate === 'release')}${batchCode(r) ? ` · ${T.now.batch(batchCode(r))}` : ''}`;
    case 'assess':
      return `${J.assess(T.dev.no(r.dev ?? 0), d.verdict === 'none')}${batchCode(r) ? ` · ${T.now.batch(batchCode(r))}` : ''}`;
    case 'pairEval':
      return J.pairEval(pairName(d.pair), d.how === 'audit');
    case 'visit': {
      const a = r.asset;
      const what = a ? `${assetClass(a)}, ${T.assets.inv(a.inv)}` : d.asset;
      return J.visit(a ? workName(a, d.work).toLowerCase() : d.work, what, whenText(start, d.at));
    }
    case 'repair':
      return J.repair(partName(r.machine, r.part), machineName(r.machine));
    case 'replace':
      return J.replace(partName(r.machine, r.part), machineName(r.machine), !!d.why);
    case 'spare':
      return J.spare(named(db?.spares[d.spare]?.name, d.spare), d.qty);
    case 'vacancy':
      return J.vacancy(role(d.role), d.via === 'agency');
    case 'hire':
      return `${J.hire(role(d.role))}${r.person ? `, ${T.card.person(role(r.person.role), r.person.tab)}` : ''}`;
    case 'leaveDraft':
      return J.leaveDraft(d.y);
    case 'targets':
      return J.targets;
    case 'setpoint':
      return J.setpoint(modeWhat(r), modeText(r, d.value), modeText(r, d.target));
    case 'lot':
      return J.lot(`${r.lot ? T.lotCode(...r.lot) : d.lot}${r.material ? `, ${material(r.material)}` : ''}`, T.journal.verdict[d.verdict]);
    case 'batch':
      return J.batch(batchCode(r), T.journal.decision[d.decision]);
    case 'contract':
      return J.contract(d.contract, party(d.party), dayText(d.to));
    case 'extend':
      return J.extend(d.contract, party(d.party), dayText(d.to));
    case 'waste':
      return J.waste(whenText(start, d.at));
  }
}

/** Причина — строки с числами завода; у решения игрока её нет (кроме предоплаты заказа). */
export function whyLines(d: Decided, r: JournalRef, t: number, start: Ymd): string[] {
  const J = T.journal;
  const day = momentOf(start, t).day;
  switch (d.kind) {
    case 'order': {
      const w = d.why;
      if (!w) return [];
      if (w.rule === 'turn') return [J.order.turn(w.seen ?? 0)];
      const pos = (x: { cases: number; ordered: number; work: number }) => (x.ordered > 0 ? (x.cases * x.work) / x.ordered : Number.POSITIVE_INFINITY);
      const me = w.items.find(x => x.sku === d.sku);
      const head = me ? (me.ordered > 0 ? J.order.stock(me.cases, Math.round(pos(me) * 10) / 10, me.ordered, me.work) : J.order.noDemand(me.cases)) : '';
      const ahead = w.ahead / 1000;
      const rule =
        w.rule === 'campaign'
          ? J.order.campaign(product(w.prev), (w.soon ?? 0) / 1000)
          : w.rule === 'urgent'
            ? J.order.urgent(product(w.prev), (w.soon ?? 0) / 1000)
            : w.prev
              ? J.order.change(product(w.prev))
              : J.order.need;
      const below = w.items.filter(x => x.sku !== d.sku && x.ordered > 0 && x.cases * x.work * 1000 < x.ordered * w.ahead);
      const others = below.length > 0 ? J.order.others(below.map(x => J.order.other(sku(x.sku), Math.round(pos(x) * 10) / 10)).join('; ')) : J.order.alone;
      return [[head, J.order.threshold(Number.isInteger(ahead) ? ahead : Math.round(ahead * 10) / 10), rule].filter(Boolean).join('; '), others];
    }
    case 'po': {
      const out = (d.why ?? []).map(w => {
        const line = r.po?.lines.find(l => l.material === w.material);
        const c = db?.containers[db?.materials[w.material]?.container ?? ''];
        const n = line && c ? Math.round(line.qty / c.capacity) : 0;
        const parts = [
          J.po.line(material(w.material), qty(w.material, w.have), qty(w.material, w.point), qtyText(w.per / 1000, unitOf(w.material)), w.lead, w.qc, w.safety),
          w.want === w.moq ? J.po.moq(qty(w.material, w.moq)) : J.po.qty(w.every, qty(w.material, w.want)),
          ...(w.cut ? [J.po.cut] : []),
          ...(c && n > 0 ? [J.po.tare(n, c.kind, qtyText(c.capacity, unitOf(w.material), 0))] : []),
        ];
        return parts.join('; ');
      });
      return d.prepaid > 0 ? [...out, J.po.prepaid(money(d.prepaid))] : out;
    }
    case 'step': {
      const w = d.why;
      if (!w) return [];
      const top = cause(r, w.top);
      if (w.rule === 'lab') return [J.step.lab];
      if (w.rule === 'retest') return [J.step.retest(top, p10k(w.p))];
      return [J.step.gain(num((w.gain ?? 0) / 1000, 2), `${num(w.min ?? 0)} ${T.units.min}`, top, p10k(w.p))];
    }
    case 'conclude': {
      const w = d.why;
      if (!w) return [];
      const c = cause(r, d.cause);
      return [(w.p >= w.threshold ? J.conclude.top : J.conclude.none)(c, p10k(w.p), p10k(w.threshold)), d.fate === 'release' ? J.conclude.release : J.conclude.reject];
    }
    case 'assess': {
      const w = d.why;
      if (!w) return [];
      if (w.tests.length === 0) return [J.assess.empty];
      const list = w.tests.map(x => (x.kind === 'ipc' ? J.assess.ipc(testName(x.test), x.n ?? 0, x.out ?? 0) : J.assess.lab(testName(x.test), x.result !== undefined && db?.tests[x.test] ? attrText(db.tests[x.test].attr, x.result) : '—', (x.out ?? 0) > 0)));
      return [J.assess.tests(list.join('; ')), d.verdict === 'none' ? J.assess.none : J.assess.reject];
    }
    case 'pairEval':
      return [`${J.pair(J.until(dayText(d.why.until), d.why.until - day, d.why.ahead))}; ${d.how === 'audit' ? J.audit : J.docs}`];
    case 'visit':
      return [d.why.until === undefined ? J.noRec : J.rec(J.until(dayText(d.why.until), d.why.until - day, d.why.ahead))];
    case 'repair':
      return [J.repair(whenText(start, d.why.failed), named(db?.spares[d.why.spare]?.name, d.why.spare), d.why.free)];
    case 'replace':
      return d.why ? [J.replace(pctText(d.why.wear), pctText(d.why.at))] : [];
    case 'spare':
      return [J.spare(d.why.level, d.why.min, d.why.max)];
    case 'vacancy': {
      const w = d.why;
      if (!w) return [];
      const who = r.person ? T.card.person(role(r.person.role), r.person.tab) : T.journal.tab(w.tab);
      return [`${J.vacancy.instead(who, dayText(w.day))}; ${w.rule === 'city' ? J.vacancy.city : w.rule === 'late' ? J.vacancy.late(w.days ?? 0) : J.vacancy.ad}`];
    }
    case 'hire': {
      const w = d.why;
      return w ? [J.hire(w.skill, w.min, money(w.salary), money(w.price), pctText(w.over))] : [];
    }
    case 'leaveDraft':
      return [J.leaveDraft(d.why.people, d.why.miss)];
    case 'targets':
      return [J.targets(d.why.n)];
    case 'lot': {
      const list = d.why.tests.map(x => {
        const m = db?.tests[x.test];
        const result = x.result !== undefined && m ? attrText(m.attr, x.result) : '—';
        const lim = m && (x.min !== undefined || x.max !== undefined) ? T.dev.limits(x.min !== undefined ? attrNum(m.attr, x.min) : '', x.max !== undefined ? attrNum(m.attr, x.max) : '') : '';
        return J.lot.test(testName(x.test), result, lim, !!x.pass);
      });
      return [...list, d.verdict === 'release' ? J.lot.release : d.verdict === 'investigate' ? J.lot.investigate : J.lot.reject];
    }
    case 'batch': {
      const w = d.why;
      if (!w) return [];
      const devs = (w.devs ?? []).map(id => T.dev.no(Number(id.slice(1)))).join(', ');
      return [w.rule === 'player' ? J.batch.player : w.rule === 'assess' ? J.batch.assess(devs) : w.rule === 'open' ? J.batch.open(devs) : J.batch.clear];
    }
    case 'contract':
      return [d.why.prev ? J.contract(d.why.prev, dayText(d.why.end ?? 0)) : J.contractNew];
    case 'extend':
      return [J.extend(dayText(d.why.end))];
    case 'waste': {
      // коллега склада (Б1з): по заполнению зоны или по сроку; у игрока причины нет
      const w = d.why;
      if (!w) return [];
      return w.since !== undefined ? [J.waste.old(dayText(momentOf(start, w.since).day), w.months)] : [J.waste.full(w.used, w.places)];
    }
    default:
      return [];
  }
}

/** Переход к вещи решения: карточка на полу, досье серии, доска расследования. */
function goOf(r: JournalRef, actions: Actions): (() => void) | undefined {
  if (r.thing) return () => actions.show(r.thing!);
  if (r.unit !== undefined) return () => actions.showUnit(r.unit!);
  if (r.inv) return () => actions.openInv(r.inv!);
  if (r.bn !== undefined) return () => actions.openDossier(r.bn!);
  return undefined;
}

function Row({ row, start, open, toggle, actions }: { row: JournalRow; start: Ymd; open: boolean; toggle: () => void; actions: Actions }) {
  const why = whyLines(row.d, row.ref, row.t, start);
  const go = goOf(row.ref, actions);
  return (
    <li className={`jrow${open ? ' on' : ''}`} data-test="journal-row" data-n={row.n} data-kind={row.d.kind} data-by={row.by}>
      <div className="jline">
        <span className="muted">{whenText(start, row.t)}</span> <b>{whoText(row.by, row.seat)}</b>
      </div>
      <div className="jline">
        {why.length > 0 ? (
          <button type="button" className="link" aria-expanded={open} onClick={toggle} data-test="journal-more">
            {open ? '▾' : '▸'} {whatText(row.d, row.ref, start)}
          </button>
        ) : (
          <span>{whatText(row.d, row.ref, start)}</span>
        )}
        {go ? (
          <button type="button" className="small" onClick={go} title={T.journal.goHint} data-test="journal-go">
            {T.journal.go}
          </button>
        ) : null}
      </div>
      {open && why.length > 0 ? (
        <ul className="jwhy" data-test="journal-why">
          {why.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function Journal({ hud, actions }: { hud: Hud; actions: Actions }) {
  const j = hud.journal;
  const v = j.view;
  const [shown, setShown] = useState<number | undefined>(undefined);
  // запись, на которой открыли журнал («Почему?»), — раскрыта, пока игрок не раскроет другую
  const openN = shown ?? v?.focus;
  return (
    <div className="stock panel journal" id="journal" role="dialog" aria-labelledby="journal-title" data-test="journal">
      <div className="phead">
        <b id="journal-title">{T.journal.title}</b>
        <span className="muted">{T.journal.question}</span>
        <button type="button" className="close" onClick={() => actions.toggleJournal()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      <div className="filters" data-test="journal-seats">
        <span className="muted">{T.journal.seatFilter}:</span>
        <button type="button" className={!j.seat ? 'on' : ''} aria-pressed={!j.seat} onClick={() => actions.setJournal({ seat: null })}>
          {T.journal.all}
        </button>
        {SEATS.map(id => (
          <button type="button" key={id} className={j.seat === id ? 'on' : ''} aria-pressed={j.seat === id} onClick={() => actions.setJournal({ seat: id })} data-seat={id}>
            {T.seats.names[id]}
          </button>
        ))}
      </div>
      <div className="filters" data-test="journal-who">
        <span className="muted">{T.journal.whoFilter}:</span>
        <button type="button" className={!j.who ? 'on' : ''} aria-pressed={!j.who} onClick={() => actions.setJournal({ who: null })}>
          {T.journal.all}
        </button>
        <button type="button" className={j.who === 'heads' ? 'on' : ''} aria-pressed={j.who === 'heads'} onClick={() => actions.setJournal({ who: 'heads' })} data-who="heads">
          {T.journal.heads}
        </button>
        <button type="button" className={j.who === 'player' ? 'on' : ''} aria-pressed={j.who === 'player'} onClick={() => actions.setJournal({ who: 'player' })} data-who="player">
          {T.journal.you}
        </button>
      </div>
      {!v ? <div className="muted">{T.app.loading}</div> : null}
      {v && v.rows.length === 0 ? <div className="muted empty">{T.journal.empty}</div> : null}
      {v && v.rows.length > 0 ? (
        <ul className="jlist">
          {v.rows.map(r => (
            <Row key={r.n} row={r} start={hud.start} open={openN === r.n} toggle={() => setShown(openN === r.n ? -1 : r.n)} actions={actions} />
          ))}
        </ul>
      ) : null}
      {v && v.pages > 1 ? (
        <div className="pager">
          <button type="button" disabled={v.page === 0} onClick={() => actions.setJournal({ page: v.page - 1 })}>
            {T.journal.prev}
          </button>
          <span className="muted">{T.journal.page(v.page + 1, v.pages)}</span>
          <button type="button" disabled={v.page >= v.pages - 1} onClick={() => actions.setJournal({ page: v.page + 1 })}>
            {T.journal.next}
          </button>
        </div>
      ) : null}
      {v?.since !== undefined ? <div className="muted small">{T.journal.since(dayText(momentOf(hud.start, v.since).day), KEEP)}</div> : null}
    </div>
  );
}

/** «Кто решил» в карточке вещи: строка на решение — что, кто, когда — и «Почему?», которое открывает журнал на нём. */
export function WhoList({ rows, start, actions }: { rows: readonly WhoRow[] | undefined; start: Ymd; actions: Actions }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="who" data-test="who">
      <div className="msec">{T.journal.who}</div>
      <ul className="whol">
        {rows.map(r => (
          <li key={r.n} data-test="who-row" data-kind={r.kind} data-n={r.n}>
            <span>
              {T.journal.kinds[r.kind] ?? r.kind}: <b>{whoText(r.by, r.seat)}</b>
              {r.v ? ` — ${verdictWord(r)}` : ''} <span className="muted">· {whenText(start, r.t)}</span>
            </span>{' '}
            <button type="button" className="small" onClick={() => actions.openJournal(r.n)} title={T.journal.whyHint} data-test="who-why">
              {T.journal.why}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Вердикт строки «Кто решил»: решение по партии и серии, оценка, вывод, работа подрядчика, канал вакансии. */
function verdictWord(r: WhoRow): string {
  switch (r.kind) {
    case 'lot':
      return T.journal.verdict[r.v ?? ''] ?? '';
    case 'batch':
    case 'conclude':
      return T.journal.decision[r.v ?? ''] ?? '';
    case 'assess':
      return r.v === 'none' ? T.journal.none : T.journal.decision.reject;
    case 'visit':
      return r.v === 'qual' ? T.assets.work.qual : T.assets.work.cal;
    case 'vacancy':
      return T.journal.via[r.v ?? ''] ?? '';
    default:
      return '';
  }
}
