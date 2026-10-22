// Что делать в карточке (Б1г; docs/specs/2026-10-vertical-slice.md, «Б1г»): карточка отклонения — что вышло за предел,
// что это значит, какие испытания покажут влияние, оценка и срок; решение по серии на выпуске — условия и три кнопки;
// режимы стадии в карточке помещения и оборудования; пояснение при первом событии. Виды — из потока расчёта
// (src/sim/devs.ts) без истины; здесь — слова и щелчок.
import type { ReactNode } from 'react';
import { type Ymd, momentOf } from '../engine/core/calendar';
import { dayText, named, num, qtyText, T, whenText } from '../i18n';
import type { DevCard, Regimes, ReleaseView } from '../sim/devs';
import { db } from './db';
import { type Actions, holds, type Hud } from './store';
import { attrText, paramNum, paramText } from './units';

type Param = { unit: Parameters<typeof paramText>[0]; target: number; range: [number, number] };

const rangeText = (p: Param) => `${paramNum(p.unit, p.range[0])}–${paramText(p.unit, p.range[1])}`;
const paramName = (id: string) => T.ref.params[id] ?? id;
const testName = (id: string) => named(db?.tests[id]?.name, id);
const devList = (ns: readonly number[]) => ns.map(n => T.dev.no(n)).join(', ');

/** Пределы МОК словами: «97,0–103,0 %», «не меньше 60 Н». */
function limitsText(test: string, min?: number, max?: number): string {
  const attr = db?.tests[test]?.attr;
  if (!attr) return '';
  return T.dev.limits(min !== undefined ? attrText(attr, min) : '', max !== undefined ? attrText(attr, max) : '');
}

/** Пояснение при первом событии вида `kind`: абзац и «Понятно»; понятое не показываем. */
export function First({ kind, hud, actions }: { kind: string | undefined; hud: Hud; actions: Actions }) {
  if (!kind || hud.firsts.includes(kind) || !T.first[kind]) return null;
  return (
    <div className="first" data-test="card-first">
      <div>{T.first[kind]}</div>
      <button type="button" onClick={() => actions.understood(kind)} data-test="first-ok">
        {T.first.ok}
      </button>
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

/** Что вышло за предел — строками по виду отклонения. */
function whatRows(c: DevCard): string[] {
  const out: string[] = [];
  if (c.param) out.push(T.dev.param(paramName(c.param.id), paramText(c.param.unit, c.param.value), paramText(c.param.unit, c.param.target), rangeText(c.param)));
  if (c.ipc) out.push(`${T.dev.ipc(testName(c.ipc.test), c.ipc.out, c.ipc.n)}; ${limitsText(c.ipc.test, c.ipc.min, c.ipc.max)}`);
  if (c.yield) out.push(T.dev.yield(num(c.yield.units), num(c.yield.nominal), `${num(c.yield.alarm / 100)} %`));
  if (c.recon) {
    const m = db?.materials[c.recon.material];
    const q = (n: number) => (m ? qtyText(n, m.unit) : num(n));
    out.push(T.dev.recon(named(m?.name, c.recon.material), q(c.recon.issued), q(c.recon.used), q(c.recon.spoiled), q(c.recon.returned)));
  }
  if (c.tests?.length) out.push(`${T.dev.oos}: ${c.tests.map(x => testName(x.method)).join(', ')}`);
  return out;
}

/** Связанное испытание словами: МОК — точки и сколько вне пределов; испытание балка — результат или «ещё не готово». */
function linkedText(x: DevCard['linked'][number]): string {
  if (!x.done) return T.dev.notYet(testName(x.test));
  if (x.kind === 'ipc') return T.dev.ipcTest(testName(x.test), x.n, x.out);
  return T.dev.labTest(testName(x.test), x.result !== undefined ? attrText(x.attr, x.result) : '', x.out === 0);
}

/** Карточка отклонения: тело. Решать — посту качества; чужой пост — кнопки гаснут, рядом подпись. */
export function DevBody({ c, start, hud, actions }: { c: DevCard; start: Ymd; hud: Hud; actions: Actions }) {
  const mine = holds(hud, 'quality');
  const late = c.status === 'open' && hud.t > c.due;
  const due = dayText(momentOf(start, c.due).day);
  const people = c.people.map(p => T.card.person(named(db?.roles[p.role]?.name, p.role), p.tab));
  const machines = c.equipment.map(id => named(db?.equipment[id]?.name ?? db?.machines[id]?.name, id));
  const means = c.status === 'assessed' ? T.dev.meansAssessed : c.status === 'closed' ? T.dev.meansClosed : c.block === 'devInv' ? T.dev.meansInv : T.dev.meansOpen;
  const why = (r: string) => T.notices.why[r] ?? r;
  const noneNo = c.block ? why(c.block) : c.none ? `${why(c.none.why)}: ${testName(c.none.test)}` : undefined;
  const who = (colleague: boolean) => (colleague ? T.dev.who_.colleague : T.dev.who_.player);
  return (
    <>
      <dl>
        <Row k={T.card.state}>
          <span className={c.status === 'open' ? 'warn' : ''} data-test="dev-state">
            {T.dev.state[c.status]}
          </span>
        </Row>
        <Row k={T.dev.opened}>{whenText(start, c.opened)}</Row>
        {c.batch ? (
          <Row k={T.card.batch}>
            <span data-test="dev-batch">{c.batch.code}</span>
            {c.batch.held ? <span className="warn"> · {T.dev.held}</span> : null}
          </Row>
        ) : null}
        {c.lot ? (
          <Row k={T.card.lot}>
            {named(db?.materials[c.lot.material]?.name, c.lot.material)} <span className="mono">{T.lotCode(...c.lot.code)}</span>
          </Row>
        ) : null}
        {c.stage ? (
          <Row k={T.dev.stage}>
            {T.stages[c.stage] ?? c.stage}
            {c.at ? <span className="muted"> · {whenText(start, c.at.from)}</span> : null}
          </Row>
        ) : null}
        {c.status === 'open' ? (
          <Row k={T.dev.due}>
            <span className={late ? 'bad' : ''} data-test="dev-due">
              {late ? T.dev.overdue(due) : T.dev.dueText(due)}
            </span>
          </Row>
        ) : null}
      </dl>
      <div className="csec">{T.dev.what}</div>
      <ul className="why" data-test="dev-what">
        {whatRows(c).map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      {people.length + machines.length > 0 ? (
        <>
          <div className="csec">{T.dev.who}</div>
          <div data-test="dev-who">{[...machines, ...people].join(', ')}</div>
        </>
      ) : null}
      <div className="csec">{T.dev.means}</div>
      <div data-test="dev-means">{means}</div>
      <div className="csec" title={T.dev.linkedHint}>
        {T.dev.linked}
      </div>
      {c.linked.length === 0 ? (
        <div className="muted">{T.dev.noLinked}</div>
      ) : (
        <ul className="why" data-test="dev-linked">
          {c.linked.map((x, i) => (
            <li key={i} className={x.done && x.out > 0 ? 'bad' : x.done ? '' : 'muted'}>
              {linkedText(x)}
            </li>
          ))}
        </ul>
      )}
      <div className="csec">{T.dev.assess}</div>
      {c.assess ? (
        <div data-test="dev-assess">{c.assess.done === undefined ? T.dev.assessing(c.assess.verdict, who(c.assess.colleague)) : T.dev.assessed(c.assess.verdict, who(c.assess.colleague), whenText(start, c.assess.done))}</div>
      ) : c.status === 'open' ? (
        <div className="cbtns" data-test="dev-buttons">
          <button type="button" disabled={!mine || noneNo !== undefined} title={noneNo ?? T.dev.noneWhat} onClick={() => actions.assess(`D${c.dev}`, 'none')} data-test="dev-none">
            {T.dev.none}
          </button>
          <button type="button" disabled={!mine || c.block !== undefined} title={c.block ? why(c.block) : T.dev.rejectWhat} onClick={() => actions.assess(`D${c.dev}`, 'reject')} data-test="dev-reject">
            {T.dev.reject}
          </button>
          {c.inv ? (
            <button type="button" onClick={() => actions.openInv(c.inv!)} data-test="dev-inv">
              {T.dev.board}
            </button>
          ) : null}
          <div className="muted">{noneNo ?? T.dev.work}</div>
          {!mine ? <div className="warn">{T.levers.seat(T.seats.names.quality)}</div> : null}
        </div>
      ) : null}
    </>
  );
}

/** Решение по серии на выпуске: условия выпуска галочками и три кнопки; «Выпустить» говорит, чего не хватает. */
export function ReleaseBlock({ r, hud, actions }: { r: ReleaseView; hud: Hud; actions: Actions }) {
  const mine = holds(hud, 'quality');
  const no = r.open.length > 0 ? T.notices.why.devOpen : r.reject.length > 0 ? T.notices.why.devReject : undefined;
  const mark = (ok: boolean) => (ok ? '✓' : '✗');
  const devLink = (ns: readonly number[]) =>
    ns.map((n, i) => (
      <span key={n}>
        {i > 0 ? ', ' : ''}
        <span className="go" role="link" tabIndex={0} onClick={() => actions.select({ kind: 'dev', n })} onKeyDown={e => e.key === 'Enter' && actions.select({ kind: 'dev', n })} data-test="release-dev">
          {T.dev.no(n)}
        </span>
      </span>
    ));
  return (
    <div className="release" data-test="card-release">
      <div className="csec">{T.release.title}</div>
      {r.held ? <div className="warn">{T.release.held}</div> : null}
      <ul className="checks">
        <li className={r.tests ? '' : 'bad'}>
          {mark(r.tests)} {r.tests ? T.release.tests : T.release.testsNo}
        </li>
        <li className={r.review === 'done' ? '' : 'muted'}>
          {r.review === 'done' ? '✓' : '…'} {T.release.review[r.review]}
        </li>
        <li className={r.open.length + r.reject.length > 0 ? 'bad' : ''} data-test="release-devs">
          {mark(r.open.length + r.reject.length === 0)}{' '}
          {r.open.length > 0 ? (
            <>
              {T.release.devsOpen('')}
              {devLink(r.open)}
            </>
          ) : r.reject.length > 0 ? (
            T.release.devsReject(devList(r.reject))
          ) : (
            T.release.devsOk
          )}
        </li>
        <li className={r.recon !== undefined ? 'bad' : ''}>
          {mark(r.recon === undefined)} {r.recon !== undefined ? T.release.reconDev(T.dev.no(r.recon)) : T.release.reconOk}
        </li>
      </ul>
      {T.release.qp[r.qp] ? <div className="muted">{T.release.qp[r.qp]}</div> : null}
      <div className="cbtns">
        <button type="button" disabled={!mine || no !== undefined} title={no ?? T.release.releaseWhat} onClick={() => actions.release(r.batch, 'release')} data-test="release-release">
          {T.release.release}
        </button>
        <button type="button" disabled={!mine} title={T.release.rejectWhat} onClick={() => actions.release(r.batch, 'reject')} data-test="release-reject">
          {T.release.reject}
        </button>
        <button type="button" disabled={!mine} title={T.release.holdWhat} onClick={() => actions.release(r.batch, 'hold')} data-test="release-hold">
          {T.release.hold}
        </button>
      </div>
      {no ? <div className="muted">{no}</div> : null}
      {r.review !== 'done' ? <div className="muted">{T.release.later}</div> : null}
      {!mine ? <div className="warn">{T.levers.seat(T.seats.names.quality)}</div> : null}
    </div>
  );
}

/** Режимы стадии: во время стадии — цель и диапазон по карте; после — факт из досье, вне диапазона — с отклонением. */
export function RegimesBlock({ g, start, actions }: { g: Regimes; start: Ymd; actions: Actions }) {
  const stage = T.stages[g.stage] ?? g.stage;
  return (
    <>
      <div className="csec">{T.regimes.title}</div>
      <div className="muted">{g.now ? T.regimes.now(stage, g.batch) : T.regimes.fact(stage, g.batch, whenText(start, g.end ?? 0))}</div>
      <ul className="why" data-test="card-regimes">
        {g.list.map(p => (
          <li key={p.id} className={p.dev !== undefined ? 'bad' : ''}>
            {p.value === undefined ? T.regimes.target(paramName(p.id), paramText(p.unit, p.target), rangeText(p)) : T.regimes.value(paramName(p.id), paramText(p.unit, p.value), paramText(p.unit, p.target), rangeText(p))}
            {p.dev !== undefined ? (
              <>
                {' · '}
                <span className="go" role="link" tabIndex={0} onClick={() => actions.select({ kind: 'dev', n: p.dev! })} onKeyDown={e => e.key === 'Enter' && actions.select({ kind: 'dev', n: p.dev! })} data-test="regime-dev">
                  {T.dev.no(p.dev)}
                </span>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="muted">{T.regimes.noKnobs}</div>
    </>
  );
}

