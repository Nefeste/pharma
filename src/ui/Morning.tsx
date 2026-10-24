// Планёрка в 08:00 (docs/specs/2026-10-panels.md, 3в; docs/13-art.md, §11): страница, которую читают минуту, — ваше место
// за время на нём (3е), вчера в цифрах, одна главная потеря, одна подсказка; что было с прошлой планёрки; что ждёт сейчас. Большое окно поверх карты с
// вопросом в заголовке. Вид собирает поток расчёта (src/sim/report.ts) без слов и без истины; слова — отсюда.
import type { ReactNode } from 'react';
import { devLevers, heldLevers, mainLevers, resignLevers, riskLevers } from '../app/levers';
import type { PartType, Scenario } from '../content/types';
import { civilFromDays, momentOf, type Ymd } from '../engine/core/calendar';
import { planOf } from '../engine/plant';
import { DEPT_SEAT } from '../engine/seats';
import { dateText, dayText, durText, hText, kmText, money, named, num, pctText, qtyText, T, whenText } from '../i18n';
import type { LineSum, MainLoss, MorningView, SeatSum } from '../sim/report';
import type { Thing } from '../sim/views';
import { assetName, workName } from './assets';
import { db } from './db';
import { Levers } from './Levers';
import type { Actions, Hud } from './store';

/** Название машины или оборудования по виду; узлы — из той же записи. */
function machineOf(thing: Thing | undefined, type: string): { name: string; parts: readonly PartType[] } {
  const rec = thing?.kind === 'equipment' ? db?.equipment[type] : db?.machines[type];
  return { name: named(rec?.name, type), parts: rec?.parts ?? [] };
}

const partName = (parts: readonly PartType[], id: string) => named(parts.find(p => p.id === id)?.name, id);

/** Пара словами (Б3г): «Дистрибьютор АФС — Изготовитель парацетамола». */
const pairName = (supplier: string, maker: string) => T.ref.pair(named(db?.suppliers[supplier]?.name, supplier), named(db?.makers[maker]?.name, maker));

/** Вид машины линии по плану. */
function lineMachine(plant: string, line: number, k: number): { thing: Thing; name: string } {
  const type = db ? (planOf(db, plant).plant.lines[line]?.machines[k]?.type ?? '') : '';
  return { thing: { kind: 'machine', line, k }, name: named(db?.machines[type]?.name, type) };
}

function lineLossText(plant: string, l: LineSum): string {
  if (!l.loss || l.key === undefined) return '';
  const key = lineMachine(plant, l.line, l.key).name;
  const text = T.morning.lineLoss[l.loss.what](key, durText(l.loss.sec));
  if (!l.neighbour) return text;
  const nb = lineMachine(plant, l.line, l.neighbour.k).name;
  return `${text} — ${T.morning.neighbour[l.neighbour.what](nb, durText(l.neighbour.sec))}`;
}

function mainText(plant: string, m: MainLoss): string {
  switch (m.k) {
    case 'wait':
      return T.morning.main.wait(T.morning.depts[m.dept], T.wait[m.cause], durText(m.sec));
    case 'line':
      return `${T.morning.line(m.line + 1)}: ${lineLossText(plant, m)}`;
    case 'move':
      return T.morning.main.move(kmText(m.cm), durText(m.sec), m.cm > 0 ? pctText(Math.round((m.empty * 10000) / m.cm)) : pctText(0));
    case 'walk':
      return T.morning.main.walk(kmText(m.cm), durText(m.sec));
  }
}

const hintOf = (m: MainLoss): string => (m.k === 'wait' ? T.morning.hints[m.cause] : m.k === 'line' ? T.morning.hints[m.loss.what] : T.morning.hints[m.k]);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="msec">{title}</div>
      {children}
    </>
  );
}

/** Вчерашние уборки и переналадки (Б2г): генеральные, малые, переналадки линий — каких не было, тех строк нет. */
function cleanRows(v: MorningView): string[] {
  const rows: string[] = [];
  if (v.cleans?.major) rows.push(T.morning.cleanMajor(v.cleans.major, durText(v.cleans.majorSec)));
  if (v.cleans?.minor) rows.push(T.morning.cleanMinor(v.cleans.minor, durText(v.cleans.minorSec)));
  if (v.changes?.n) rows.push(T.morning.changes(v.changes.n, durText(v.changes.sec)));
  return rows;
}

/** Список строк; пустой не показываем — страницу читают минуту. */
function Rows({ title, rows }: { title: string; rows: ReactNode[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mblock">
      <div className="mhead">{title}</div>
      <ul className="mlist">{rows}</ul>
    </div>
  );
}

/**
 * Люди (Б4в): заявления за сутки — найм на место и карточка человека; кто выходит и кто уходит на неделе; испытания,
 * которые кончаются на неделе; новые кандидаты по вакансиям — найм. Отпуска (Б4г): кто в отпуске и кто замещает, кто
 * уходит в отпуск в ближайшие две недели и кто выходит на неделе; черновик графика до утверждения — рычаг «График
 * отпусков».
 */
function PeopleBlock({ v, hud, actions, close, go }: { v: MorningView; hud: Hud; actions: Actions; close: () => void; go: (t: Thing | undefined) => (() => void) | undefined }) {
  const p = v.people;
  const l = v.leave;
  const role = (id: string) => named(db?.roles[id]?.name, id);
  const who = (x: { role: string; tab: number }) => T.card.person(role(x.role), x.tab);
  const dept = (id: string) => db?.roles[id]?.dept ?? 'mes';
  const leaves = l ? l.away.length + l.going.length + l.back.length + (l.draft ? 1 : 0) : 0;
  const empty = p.resigned.length + p.coming.length + p.leaving.length + p.trials.length + p.candidates.length + leaves === 0;
  return (
    <div className="mblock" data-test="morning-people">
      <div className="mhead">{T.morning.people.title}</div>
      {empty ? <div className="muted">{T.morning.people.none}</div> : null}
      <ul className="mlist">
        {p.resigned.map(x => (
          <li key={`r${x.person}`} className="warn" data-test="morning-resign">
            {T.morning.people.resigned(who(x), dayText(x.last))}
            {x.vacancy ? <span className="muted"> · {T.morning.people.colleague}</span> : null}
            <Levers list={resignLevers(x, dept(x.role))} hud={hud} actions={actions} close={close} />
          </li>
        ))}
        {p.coming.map(x => (
          <li key={`c${x.id}`} data-test="morning-coming">
            {T.morning.people.coming(dayText(x.day), role(x.role), named(db?.shifts[x.shift]?.name, x.shift))}
          </li>
        ))}
        {p.leaving.map(x => (
          <li key={`l${x.person}`} className="go" onClick={go({ kind: 'person', n: x.person })} data-test="morning-leaving">
            {T.morning.people.leaving(dayText(x.last), who(x), T.hire.why[x.why] ?? x.why)}
          </li>
        ))}
        {p.trials.map(x => (
          <li key={`t${x.person}`} className="go" onClick={go({ kind: 'person', n: x.person })} data-test="morning-trial">
            {T.morning.people.trial(dayText(x.last), who(x))}
          </li>
        ))}
        {p.candidates.map(x => (
          <li key={`k${x.vacancy}`} data-test="morning-candidates">
            {T.morning.people.candidates(role(x.role), x.n)}
            <Levers list={[{ k: 'staff', seat: DEPT_SEAT[dept(x.role)] }]} hud={hud} actions={actions} close={close} />
          </li>
        ))}
        {l?.draft ? (
          <li className="warn" data-test="morning-leave-draft">
            {T.morning.people.draft(l.draft.y, dayText(l.draft.approve), l.draft.problems, l.draft.miss)}
            <Levers list={[{ k: 'leave', seat: 'director' }]} hud={hud} actions={actions} close={close} />
          </li>
        ) : null}
        {l?.away.map(x => (
          <li key={`a${x.n}`} className="go" onClick={go({ kind: 'person', n: x.n })} data-test="morning-away">
            {T.morning.people.away(who(x), dayText(x.to), x.deputy && who(x.deputy))}
          </li>
        ))}
        {l?.going.map(x => (
          <li key={`g${x.n}-${x.from}`} className="go" onClick={go({ kind: 'person', n: x.n })} data-test="morning-going">
            {T.morning.people.going(dayText(x.from), who(x), dayText(x.to), x.deputy && who(x.deputy))}
          </li>
        ))}
        {l?.back.map(x => (
          <li key={`b${x.n}-${x.day}`} className="go" onClick={go({ kind: 'person', n: x.n })} data-test="morning-back">
            {T.morning.people.back(dayText(x.day), who(x))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Итог места за время на нём (3е): мерило места строками. */
function SeatBlock({ x, start }: { x: SeatSum; start: Ymd }) {
  const rows: string[] = [];
  switch (x.seat) {
    case 'production': {
      const packs = (n: number) => T.morning.packs(num(n));
      rows.push(x.shifts === 0 ? T.morning.prod.noShifts : T.morning.prod.plan(packs(x.fact), packs(x.plan), pctText(Math.floor((x.fact * 10000) / x.plan))));
      if (x.rhythm !== undefined) rows.push(T.morning.prod.rhythm(pctText(x.rhythm)));
      for (const l of x.lines) rows.push(l.oee ? T.morning.prod.oee(T.morning.line(l.line + 1), pctText(Math.min(l.oee.oee, 10000))) : T.morning.prod.noOee(T.morning.line(l.line + 1)));
      rows.push(T.morning.prod.recleans(x.recleans));
      rows.push(T.morning.prod.switches(x.switches.major, durText(x.switches.majorSec), x.switches.changes, durText(x.switches.changeSec)));
      break;
    }
    case 'quality':
      rows.push(T.morning.qual.devs(x.deviations, x.open));
      rows.push(x.decided === 0 ? T.morning.qual.noDecisions : T.morning.qual.first(x.first, x.decided));
      if (x.toDecision !== undefined) rows.push(T.morning.qual.toDecision(durText(x.toDecision)));
      break;
    case 'director':
      rows.push(T.morning.dir.cash(money(x.balance), money(x.change, true)));
      rows.push(x.closed === 0 ? T.morning.dir.noOrders : T.morning.dir.orders(x.onTime, x.closed));
      rows.push(T.morning.dir.rejected(x.rejected));
      break;
    default:
      rows.push(T.morning.otherSeat);
  }
  return (
    <div className="mblock" data-test="morning-seat" data-seat={x.seat}>
      <div className="mhead">{T.morning.seatSince(T.seats.names[x.seat], dayText(momentOf(start, x.from).day))}</div>
      <ul className="mlist">
        {rows.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

export function Morning({ v, day, start, plant, pause, actions, hud, scenario }: { v?: MorningView; day: number; start: Ymd; plant: string; pause: boolean; actions: Actions; hud: Hud; scenario?: Scenario }) {
  const d = civilFromDays(day);
  const at = momentOf(d, 0);
  const yest = civilFromDays(day - 1);
  // щелчок по строке с машиной — камера к ней и её карточка; планёрка закрывается, пауза остаётся
  const go = (t: Thing | undefined) => (t ? () => {
    actions.closeMorning(false);
    actions.show(t);
  } : undefined);
  const when = (t: number) => whenText(start, t);
  // строка отклонения с расследованием — к его доске; планёрка закрывается, пауза остаётся
  const goInv = (id: string) => {
    actions.closeMorning(false);
    actions.openInv(id);
  };
  // рычаг (Б1г): планёрка закрывается раньше, чем откроется окно решения; пауза остаётся
  const close = () => actions.closeMorning(false);
  return (
    <div className="morning panel" id="morning" role="dialog" aria-labelledby="morning-title" data-test="morning">
      <div className="phead">
        <b id="morning-title">{T.morning.title(dateText(at))}</b>
        <span className="muted">{T.morning.question}</span>
        <button type="button" className="close" onClick={() => actions.closeMorning(false)} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {!v ? (
        <div className="muted">{T.app.loading}</div>
      ) : (
        <>
          {v.seats.length > 0 ? (
            <Section title={T.morning.seatsTitle}>
              {v.seats.map(x => (
                <SeatBlock key={x.seat} x={x} start={start} />
              ))}
            </Section>
          ) : null}
          <Section title={T.morning.yesterday(T.date.full(yest.d, T.date.months[yest.m - 1], yest.y))}>
            {v.first ? <div className="muted" data-test="morning-yesterday">{T.morning.first}</div> : null}
            {v.first ? null : (
              <>
                <div className="mblock" data-test="morning-yesterday">
                  <div className="mhead">{T.morning.output}</div>
                  {v.shifts.length === 0 ? (
                    <div className="muted">{T.morning.noShifts}</div>
                  ) : (
                    <ul className="mlist">
                      {v.shifts.map((s, i) => {
                        const shift = named(db?.shifts[s.shift]?.name, s.shift);
                        const packs = (n: number) => T.morning.packs(num(n));
                        return (
                          <li key={i}>
                            {s.fact === undefined
                              ? T.morning.shiftOpen(shift, packs(s.plan))
                              : s.plan > 0
                                ? T.morning.shift(shift, packs(s.fact), packs(s.plan), pctText(Math.floor((s.fact * 10000) / s.plan)))
                                : T.morning.noPlan(shift, packs(s.fact))}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {v.rhythm !== undefined ? <div>{T.morning.rhythm(pctText(v.rhythm))}</div> : null}
                </div>
                <div className="mblock">
                  <div className="mhead">{T.morning.oee}</div>
                  <ul className="mlist">
                    {v.lines.map(l => {
                      const name = T.morning.line(l.line + 1);
                      if (!l.oee || l.key === undefined) return <li key={l.line}>{T.morning.noJob(name)}</li>;
                      const key = lineMachine(plant, l.line, l.key);
                      return (
                        <li key={l.line} className="go" onClick={go(key.thing)}>
                          {T.morning.oeeRow(name, pctText(Math.min(l.oee.oee, 10000)), pctText(l.oee.a), pctText(Math.min(l.oee.p, 10000)), pctText(Math.min(l.oee.q, 10000)))}
                          {l.loss ? <div className="muted">{lineLossText(plant, l)}</div> : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="mblock" data-test="morning-cleans">
                  <div className="mhead">{T.morning.cleansTitle}</div>
                  {cleanRows(v).length === 0 ? (
                    <div className="muted">{T.morning.noCleans}</div>
                  ) : (
                    <ul className="mlist">
                      {cleanRows(v).map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="mblock main" data-test="morning-main">
                  <div className="mhead">{T.morning.mainTitle}</div>
                  {v.main ? (
                    <>
                      <div className={v.main.k === 'line' ? 'go' : ''} onClick={v.main.k === 'line' ? go(lineMachine(plant, v.main.line, v.main.key).thing) : undefined}>
                        <b>{mainText(plant, v.main)}</b>
                      </div>
                      <div className="hint">
                        <span className="muted">{T.morning.hintTitle}: </span>
                        {hintOf(v.main)}
                      </div>
                      <Levers list={mainLevers(v.main, v.policy)} hud={hud} actions={actions} close={close} />
                    </>
                  ) : (
                    <div className="muted">{T.morning.noMain}</div>
                  )}
                </div>
              </>
            )}
          </Section>
          <Section title={T.morning.since}>
            {v.deviations.length + v.decisions.length + v.maint.length + v.shipments.length + v.closed.length === 0 ? <div className="muted">{T.morning.nothing}</div> : null}
            <Rows
              title={T.morning.devTitle}
              rows={v.deviations.map((x, i) => (
                <li key={i} className="go" onClick={x.inv ? undefined : go({ kind: 'dev', n: x.dev })} data-test="morning-dev">
                  <span className="mono muted">{when(x.t)}</span> {T.morning.devKinds[x.kind]} <span className="mono">{T.dev.no(x.dev)}</span>
                  {x.lot ? ` · ${named(db?.materials[x.material ?? '']?.name, x.material)} ${T.lotCode(...x.lot)}` : ''}
                  {x.batch ? ` · ${T.card.batch} ${x.batch}` : ''}
                  {x.inv ? (
                    <>
                      {' · '}
                      <span className="go" role="link" tabIndex={0} onClick={() => goInv(x.inv!)} onKeyDown={e => e.key === 'Enter' && goInv(x.inv!)} data-test="morning-inv">
                        {T.inv.button}
                      </span>
                    </>
                  ) : null}
                </li>
              ))}
            />
            <Rows
              title={T.morning.decTitle}
              rows={v.decisions.map((x, i) => (
                <li key={i}>
                  <span className="mono muted">{when(x.t)}</span> {named(db?.materials[x.material]?.name, x.material)} {T.lotCode(...x.lot)}
                  {x.batch ? ` (${T.card.batch} ${x.batch})` : ''}: {T.status[x.status]}
                </li>
              ))}
            />
            <Rows
              title={T.morning.maintTitle}
              rows={v.maint.map((x, i) => {
                const m = machineOf(x.thing, x.type);
                return (
                  <li key={i} className={x.thing ? 'go' : ''} onClick={go(x.thing)}>
                    <span className="mono muted">{when(x.t)}</span> {m.name}: {T.hist.maint[x.what]} · {partName(m.parts, x.part)} · {T.hist.wear(pctText(x.wear))}
                  </li>
                );
              })}
            />
            <Rows
              title={T.morning.shipTitle}
              rows={[
                ...v.shipments.map((x, i) => (
                  <li key={`s${i}`}>
                    <span className="mono muted">{when(x.t)}</span> {T.morning.shipped(named(db?.customers[x.customer]?.name, x.customer), x.cases)}
                  </li>
                )),
                ...v.closed.map((x, i) => (
                  <li key={`c${i}`} className="bad">
                    <span className="mono muted">{when(x.t)}</span> {T.morning.closed(named(db?.customers[x.customer]?.name, x.customer), x.status === 'late', x.missing)}
                  </li>
                )),
              ]}
            />
          </Section>
          <Section title={T.morning.now}>
            <div className="mblock" data-test="morning-now">
              <div className="mhead">{T.morning.labTitle}</div>
              <div>{T.morning.lab(v.lab.queued, v.lab.prep + v.lab.run, v.lab.review)}</div>
              {v.lab.busy.length ? <div className="muted">{T.morning.busy(v.lab.busy.map(id => named(db?.instruments[id]?.name, id)).join(', '))}</div> : null}
              {v.lab.oldest ? (
                <div className="muted">{T.morning.oldest(T.tasks[v.lab.oldest.task] ?? v.lab.oldest.task, when(v.lab.oldest.since), v.lab.oldest.wait ? T.wait[v.lab.oldest.wait] : '')}</div>
              ) : null}
            </div>
            <Rows
              title={T.morning.shortTitle}
              rows={v.short.map((x, i) => {
                const mat = db?.materials[x.material];
                return (
                  <li key={i}>
                    {T.morning.short(x.orders, x.pack, named(mat?.name, x.material), mat ? qtyText(x.qty, mat.unit) : num(x.qty))}
                    <span className="muted"> — {x.po ? T.morning.po(x.po.id, dayText(momentOf(start, x.po.eta).day)) : T.morning.noPo}</span>
                  </li>
                );
              })}
            />
            <Rows
              title={T.morning.brokenTitle}
              rows={v.broken.map((x, i) => {
                const m = machineOf(x.thing, x.type);
                return (
                  <li key={i} className={x.thing ? 'go bad' : 'bad'} onClick={go(x.thing)}>
                    {T.morning.broken(m.name, partName(m.parts, x.part), when(x.since))}
                    <span className="muted">, {T.morning.repair[x.repair]}</span>
                  </li>
                );
              })}
            />
            <Rows
              title={T.morning.riskTitle}
              rows={v.risk.map((x, i) => (
                <li key={i} className="bad" data-test="morning-risk">
                  {T.morning.risk(named(db?.customers[x.customer]?.name, x.customer), dayText(momentOf(start, x.due).day), x.missing)}
                  {x.pending > 0 ? <span className="muted">; {T.morning.pending(x.pending)}</span> : null}
                  <Levers list={riskLevers(x, scenario ?? {}, v.held)} hud={hud} actions={actions} close={close} />
                </li>
              ))}
            />
            <Rows
              title={T.morning.pendingTitle}
              rows={[
                // что ждёт решения (Б1г): неоценённые отклонения — старшие первыми; удержанные серии
                ...v.pending.map(x => (
                  <li key={`d${x.dev}`} className={hud.t > x.due ? 'bad' : ''} data-test="morning-pending">
                    {T.morning.pendingDev(T.morning.devKinds[x.kind], T.dev.no(x.dev), x.batch ?? '', dayText(momentOf(start, x.due).day))}
                    {x.assessing ? <span className="muted"> · {T.morning.assessing}</span> : null}
                    {x.assessing ? null : <Levers list={devLevers(x)} hud={hud} actions={actions} close={close} />}
                  </li>
                )),
                ...v.held.map(x => (
                  <li key={`h${x.code}`} className="warn" data-test="morning-held">
                    {T.morning.heldRow(x.code)}
                    <Levers list={heldLevers(x)} hud={hud} actions={actions} close={close} />
                  </li>
                )),
              ]}
            />
            <Rows
              title={T.morning.trainTitle}
              rows={[
                ...v.training.no.map(x => (
                  <li key={`no${x.person}`} className="go bad" onClick={go({ kind: 'person', n: x.person })} data-test="morning-train">
                    {T.morning.trainNo(T.card.person(named(db?.roles[x.role]?.name, x.role), x.tab), T.ref.doc(x.doc.code, x.doc.rev))}
                  </li>
                )),
                ...v.training.soon.map(x => (
                  <li key={`soon${x.person}`} className="go" onClick={go({ kind: 'person', n: x.person })} data-test="morning-train">
                    {T.morning.trainSoon(T.card.person(named(db?.roles[x.role]?.name, x.role), x.tab), T.ref.doc(x.doc.code, x.doc.rev), dayText(x.last))}
                  </li>
                )),
              ]}
            />
            <div className="mblock" data-test="morning-hours">
              <div className="mhead">{T.morning.hours.title}</div>
              <div>{v.hours.people > 0 ? T.morning.hours.yesterday(v.hours.people, durText(v.hours.sec), money(v.hours.pay)) : T.morning.hours.none}</div>
              {v.hours.near.length > 0 ? (
                <div className="muted">
                  {T.morning.hours.near(
                    v.hours.near.map(x => T.card.person(named(db?.roles[x.role]?.name, x.role), x.tab)).join(', '),
                    v.hours.near.map(x => hText(x.sec)).join(', '),
                    hText(v.hours.limit),
                  )}
                </div>
              ) : null}
              {v.hours.week.map(x => (
                <div key={x.day} className="muted">
                  {x.kind === 'holiday' ? T.morning.hours.holiday(dayText(x.day)) : T.morning.hours.short(dayText(x.day))}
                </div>
              ))}
              {v.hours.moves.map(x => (
                <div key={`m${x.person}`} className="go" onClick={go({ kind: 'person', n: x.person })} data-test="morning-move">
                  {T.morning.hours.move(T.card.person(named(db?.roles[x.role]?.name, x.role), x.tab), named(db?.shifts[x.shift]?.name, x.shift), dayText(x.from))}
                </div>
              ))}
              {v.hours.extra.map(x => (
                <div key={`e${x.shift}${x.day}`} className="muted" data-test="morning-extra">
                  {T.morning.hours.extra(named(db?.shifts[x.shift]?.name, x.shift), dayText(x.day), x.n)}
                </div>
              ))}
            </div>
            <PeopleBlock v={v} hud={hud} actions={actions} close={close} go={go} />
            <Rows
              title={T.assets.morningTitle}
              rows={[
                ...v.assets.expired.map(x => (
                  <li key={`x${x.asset.id}${x.work}`} className={x.asset.thing ? 'go bad' : 'bad'} onClick={go(x.asset.thing)} data-test="morning-asset">
                    {T.assets.lapsed(workName(x.asset, x.work), assetName(x.asset))}
                  </li>
                )),
                ...v.assets.today.map(a => (
                  <li key={`t${a.id}`} className={a.thing ? 'go' : ''} onClick={go(a.thing)} data-test="morning-asset">
                    {T.assets.today(workName(a, a.visit!.work), assetName(a), a.working && a.visit?.to !== undefined ? T.assets.until(whenText(start, a.visit.to)) : whenText(start, a.visit!.from ?? a.visit!.at))}
                  </li>
                )),
                ...v.assets.soon.map(x => (
                  <li key={`s${x.asset.id}${x.work}`} className={x.asset.thing ? 'go' : ''} onClick={go(x.asset.thing)} data-test="morning-asset">
                    {T.assets.soon(workName(x.asset, x.work), assetName(x.asset), dayText(x.until))}
                  </li>
                )),
              ]}
            />
            <Rows
              title={T.morning.partnersTitle}
              rows={[
                // поставщики (Б3г): приостановленные пары, оценки в срок предупреждения и идущие, договоры, недобор
                ...v.partners.suspended.map(x => (
                  <li key={`ps${x.id}`} className="bad" data-test="morning-partner">
                    {T.morning.pairOff(pairName(x.supplier, x.maker), dayText((x.until ?? 0) + 1))}
                  </li>
                )),
                ...v.partners.soon.map(x => (
                  <li key={`pn${x.id}`} data-test="morning-partner">
                    {x.eval?.review
                      ? T.morning.pairReview(pairName(x.supplier, x.maker))
                      : x.eval?.how === 'audit' && x.eval.to !== undefined
                        ? T.morning.pairAudit(pairName(x.supplier, x.maker), whenText(start, x.eval.to))
                        : T.morning.pairSoon(pairName(x.supplier, x.maker), T.ref.how[x.how], dayText(x.until ?? 0))}
                  </li>
                )),
                ...v.partners.ending.map(x => (
                  <li key={`pe${x.id}`} data-test="morning-partner">
                    {T.morning.ctrEnds(x.id, named(db?.suppliers[x.party]?.name ?? db?.customers[x.party]?.name, x.party), dayText(x.to))}
                  </li>
                )),
                ...v.partners.short
                  .filter(x => x.need > 0)
                  .map(x => (
                    <li key={`pq${x.contract}${x.maker}`} data-test="morning-partner">
                      {T.morning.ctrShort(x.contract, pairName(x.supplier, x.maker), money(x.need), money(x.bought), money(x.volume))}
                    </li>
                  )),
              ]}
            />
            <div className="mblock">
              <div className="mhead">{T.morning.cashTitle}</div>
              <div>{T.morning.cash(money(v.cash.balance), money(v.cash.day, true))}</div>
              {v.cash.next ? (
                <div className="muted">{T.morning.next(dayText(momentOf(start, v.cash.next.due).day), T.cash.items[v.cash.next.item], money(v.cash.next.sum))}</div>
              ) : null}
            </div>
          </Section>
        </>
      )}
      <div className="mfoot">
        <label title={T.morning.pauseHint}>
          <input type="checkbox" checked={pause} onChange={e => actions.setPause('morning', e.currentTarget.checked)} /> {T.morning.pause}
        </label>
        <span className="grow" />
        <button type="button" onClick={() => actions.closeMorning(true)} data-test="morning-resume">
          {T.morning.resume}
        </button>
        <button type="button" onClick={() => actions.closeMorning(false)}>
          {T.morning.close}
        </button>
      </div>
    </div>
  );
}
