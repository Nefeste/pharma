// Отпуска в окне (Б4г; docs/specs/2026-10-vertical-slice.md, «Б4г»): части человека с заместителями и правкой — в карточке
// человека и под графиком справочника; график отпусков по неделям — справочник, «Люди»; смежные профессии — в карточке.
// Вид собирает поток расчёта (src/sim/leave.ts) из записей завода; части и смежные профессии правит пост отдела человека
// или директор — чужой пост видит кнопки погашенными.
import { type ReactNode, useState } from 'react';
import type { Id } from '../content/types';
import { civilFromDays, daysFromCivil, lastOfMonth, weekday } from '../engine/core/calendar';
import { DEPT_SEAT } from '../engine/seats';
import { dayText, daysText, money, named, T } from '../i18n';
import type { LeavePerson, LeaveView, PartRow, PersonLeave, Who } from '../sim/leave';
import { db } from './db';
import { type Actions, holds, type Hud } from './store';

/** Пост отдела роли: его части и смежные профессии правит он или директор. */
function seatOf(hud: Hud, role: Id): { mine: boolean; title: string } {
  const dept = db?.roles[role]?.dept;
  const seat = dept ? DEPT_SEAT[dept] : undefined;
  const mine = !seat || holds(hud, seat);
  return { mine, title: mine || !seat ? '' : T.seats.notYours(T.seats.names[seat] ?? seat) };
}

const roleName = (id: Id) => named(db?.roles[id]?.name, id);
const whoText = (w: Who) => T.card.person(roleName(w.role), w.tab);
/** Сотые дня — днями: «7 дней», «2,33 дня». */
const hundredths = (n: number) => daysText(n / 100);
/** День — для поля даты и обратно: «2028-01-10». */
const isoOf = (z: number) => {
  const { y, m, d } = civilFromDays(z);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const dayOf = (iso: string): number | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? daysFromCivil({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }) : undefined;
};

/** Одна часть: дни, заместитель, извещение, отпускные, что мешает; «Перенести…», «Убрать», «Заместитель…». */
function Part({ x, p, st, hud, actions }: { x: PartRow; p: LeavePerson; st?: string; hud: Hud; actions: Actions }) {
  const [move, setMove] = useState<string | undefined>();
  const { mine, title } = seatOf(hud, p.role);
  const words = [
    T.leave.part(dayText(x.from), dayText(x.to), daysText(x.days)),
    x.deputy ? T.leave.deputy(whoText(x.deputy)) : T.leave.noDeputy,
    st ? (T.leave.st[st] ?? st) : '',
    x.told ? T.leave.told : '',
    x.paid !== undefined ? T.leave.paid(money(x.paid)) : '',
    x.ended ? T.leave.ended : x.started ? T.leave.started : '',
  ].filter(Boolean);
  const free = x.can.length > 0 || x.deputy;
  return (
    <li data-test="leave-part" data-part={x.id} data-from={x.from}>
      <span>{words.join(' · ')}</span>
      {x.problems.length > 0 ? <span className="warn" data-test="leave-problems"> · {x.problems.map(k => T.leave.problems[k] ?? k).join(', ')}</span> : null}
      {!x.ended ? (
        <div className="small">
          {!x.started ? (
            <>
              <button type="button" className="link" disabled={!mine} title={title} onClick={() => setMove(isoOf(x.from))} data-test="leave-move">
                {T.leave.move}
              </button>{' '}
              {st !== 'approved' ? (
                <>
                  <button type="button" className="link" disabled={!mine} title={title} onClick={() => actions.leaveDrop(p.person, x.id)} data-test="leave-drop">
                    {T.leave.drop}
                  </button>{' '}
                </>
              ) : null}
            </>
          ) : null}
          {free ? (
            <select
              value=""
              disabled={!mine}
              title={title}
              onChange={e => {
                const v = e.target.value;
                if (v === 'none') actions.leaveDeputy(p.person, x.id);
                else if (v) actions.leaveDeputy(p.person, x.id, Number(v));
              }}
              data-test="leave-deputy"
            >
              <option value="">{T.leave.deputyPick}</option>
              {x.can.map(w => (
                <option key={w.n} value={w.n}>
                  {whoText(w)}
                </option>
              ))}
              {x.deputy ? <option value="none">{T.leave.deputyNone}</option> : null}
            </select>
          ) : null}
          {move !== undefined ? (
            <span className="hireask" data-test="leave-move-form">
              {' '}
              <input type="date" value={move} onChange={e => setMove(e.target.value)} data-test="leave-move-day" />{' '}
              <button
                type="button"
                disabled={!mine || dayOf(move) === undefined}
                onClick={() => {
                  const z = dayOf(move);
                  if (z !== undefined) actions.leaveMove(p.person, x.id, z);
                  setMove(undefined);
                }}
                data-test="leave-move-do"
              >
                {T.leave.moveDo}
              </button>{' '}
              <button type="button" className="link" onClick={() => setMove(undefined)}>
                {T.leave.cancel}
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** «Добавить часть…»: с какого дня и сколько дней — в год графика, где ещё есть дни. */
function AddPart({ p, years, today, hud, actions }: { p: LeavePerson; years: readonly { y: number; st?: string }[]; today: number; hud: Hud; actions: Actions }) {
  const [open, setOpen] = useState(false);
  const left = p.left.filter(([y, n]) => n > 0 && years.some(x => x.y === y));
  const first = left[0];
  const [from, setFrom] = useState(first ? isoOf(Math.max(today + 1, daysFromCivil({ y: first[0], m: 1, d: 1 }))) : '');
  const [days, setDays] = useState(first ? first[1] : 0);
  const { mine, title } = seatOf(hud, p.role);
  if (!first) return null;
  if (!open) {
    return (
      <div>
        <button type="button" className="link" disabled={!mine} title={title} onClick={() => setOpen(true)} data-test="leave-add">
          {T.leave.add}
        </button>
      </div>
    );
  }
  return (
    <div className="vform" data-test="leave-add-form">
      <label>
        {T.leave.from} <input type="date" value={from} onChange={e => setFrom(e.target.value)} data-test="leave-add-day" />
      </label>{' '}
      <label>
        {T.leave.length} <input type="number" min={1} value={days} onChange={e => setDays(Number(e.target.value))} data-test="leave-add-days" />
      </label>{' '}
      <button
        type="button"
        disabled={!mine || dayOf(from) === undefined || !(days > 0)}
        onClick={() => {
          const z = dayOf(from);
          if (z !== undefined) actions.leaveAdd(p.person, z, days);
          setOpen(false);
        }}
        data-test="leave-add-do"
      >
        {T.leave.addDo}
      </button>{' '}
      <button type="button" className="link" onClick={() => setOpen(false)}>
        {T.leave.cancel}
      </button>
    </div>
  );
}

/** Части человека: каждая со своей правкой; добавить — если в году графика остались дни. */
export function LeaveParts({ p, years, today, hud, actions }: { p: LeavePerson; years: readonly { y: number; st?: string }[]; today: number; hud: Hud; actions: Actions }) {
  const st = (y: number) => years.find(x => x.y === y)?.st;
  return (
    <>
      {p.parts.length === 0 ? <div className="muted small">{T.leave.noParts}</div> : null}
      <ol className="hist" data-test="leave-parts">
        {p.parts.map(x => (
          <Part key={x.id} x={x} p={p} st={st(x.y)} hud={hud} actions={actions} />
        ))}
      </ol>
      <AddPart key={p.left.map(x => x.join(':')).join(',')} p={p} years={years} today={today} hud={hud} actions={actions} />
    </>
  );
}

function Line({ k, children, test }: { k: string; children: ReactNode; test?: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd data-test={test}>{children}</dd>
    </>
  );
}

/**
 * Отпуск в карточке человека: дни — заработано, использовано, осталось; в отпуске сейчас и кто замещает; кого замещает
 * он; части; смежные профессии — «Обучить смежной профессии…» и «Снять».
 */
export function LeaveBlock({ v, also, hud, actions }: { v: PersonLeave; also?: readonly Id[]; hud: Hud; actions: Actions }) {
  const p = v.plan;
  const { today, years } = v;
  const { mine, title } = seatOf(hud, p.role);
  return (
    <div data-test="card-leave">
      <div className="csec">{T.leave.title}</div>
      <dl>
        <Line k={T.leave.days} test="leave-days">
          {T.leave.daysLine(hundredths(p.earned), hundredths(p.used), hundredths(p.earned - p.used))}
          {p.left
            .filter(([, n]) => n > 0)
            .map(([y, n]) => (
              <div key={y} className="muted small">
                {T.leave.rest(y, daysText(n))}
              </div>
            ))}
          {p.right !== undefined ? <div className="muted small">{T.leave.right(dayText(p.right))}</div> : null}
          {p.miss ? <div className="warn small">{T.leave.miss}</div> : null}
        </Line>
        {v.away ? (
          <Line k={T.leave.now} test="leave-away">
            <span className="warn">{T.leave.away(dayText(v.away.to), v.away.deputy && whoText(v.away.deputy))}</span>
          </Line>
        ) : null}
        {v.covers.map(c => (
          <Line key={c.n} k={T.leave.covers} test="leave-covers">
            {T.leave.coversLine(whoText(c), dayText(c.to))}
          </Line>
        ))}
      </dl>
      <div className="csec">{T.leave.parts}</div>
      <LeaveParts p={p} years={years} today={today} hud={hud} actions={actions} />
      <div className="csec" title={T.leave.alsoHint}>
        {T.leave.also}
      </div>
      <div data-test="card-also">
        {(also ?? []).length === 0 ? <span className="muted">{T.leave.alsoNone}</span> : null}
        {(also ?? []).map(r => (
          <span key={r} className="also">
            {roleName(r)}{' '}
            <button type="button" className="link" disabled={!mine} title={title} onClick={() => actions.also(p.person, r, false)} data-test="also-drop">
              {T.leave.alsoDrop}
            </button>{' '}
          </span>
        ))}
        {v.alsoCan.length > 0 ? (
          <div>
            <select
              value=""
              disabled={!mine}
              title={title}
              onChange={e => {
                if (e.target.value) actions.also(p.person, e.target.value, true);
              }}
              data-test="also-add"
            >
              <option value="">{T.leave.alsoAdd}</option>
              {v.alsoCan.map(r => (
                <option key={r} value={r}>
                  {roleName(r)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Понедельники года: недели графика — с понедельника, первая — с того, что не позже 1 января. */
function weeksOf(y: number): number[] {
  const first = daysFromCivil({ y, m: 1, d: 1 });
  const last = lastOfMonth(y, 12);
  const out: number[] = [];
  for (let z = first - weekday(first); z <= last; z += 7) out.push(z);
  return out;
}

/**
 * График отпусков справочника (Б4г): год — этот или следующий; черновик, утверждён или ещё не составлен; по людям —
 * осталось дней и недели года: в какой неделе человек в отпуске, с заместителем, что мешает; строка человека — его
 * части и правка ниже.
 */
export function LeavePlan({ v, hud, actions }: { v: LeaveView; hud: Hud; actions: Actions }) {
  const [yi, setYi] = useState(v.years.findIndex(x => x.st === 'draft') >= 0 ? v.years.findIndex(x => x.st === 'draft') : 0);
  const [pick, setPick] = useState<number | undefined>();
  const year = v.years[Math.min(yi, v.years.length - 1)];
  const weeks = weeksOf(year.y);
  const head = year.st === 'draft' ? T.leave.planDraft(dayText(year.approve)) : year.st === 'approved' ? T.leave.planApproved : T.leave.planNone(dayText(year.draft));
  const chosen = v.people.find(p => p.person === pick);
  const trouble = v.people.flatMap(p => p.parts.filter(x => x.y === year.y && x.problems.length > 0).map(x => ({ p, x })));
  const lens = `${v.rule.parts.join(' + ')} ${T.leave.dayWord(v.rule.parts[v.rule.parts.length - 1])}`;
  return (
    <section className="rsec" data-test="ref-leave">
      <b>{T.leave.plan(year.y)}</b> <span className={year.st === 'draft' ? 'warn' : 'muted'}>— {head}</span>{' '}
      {v.years.map((x, i) => (
        <button key={x.y} type="button" className={`link${i === yi ? ' on' : ''}`} onClick={() => setYi(i)} data-test="leave-year">
          {x.y}
        </button>
      ))}
      <table className="rtable leaveplan" data-test="leave-plan">
        <thead>
          <tr>
            <th>{T.leave.cols.tab}</th>
            <th>{T.leave.cols.role}</th>
            <th>{T.leave.cols.days}</th>
            <th>{T.leave.cols.weeks}</th>
          </tr>
        </thead>
        <tbody>
          {v.people.map(p => {
            const left = p.left.find(([y]) => y === year.y)?.[1];
            return (
              <tr key={p.person} className={p.person === pick ? 'on' : ''} onClick={() => setPick(p.person === pick ? undefined : p.person)} data-test="leave-row" data-tab={p.tab}>
                <td className="mono">
                  <button
                    type="button"
                    className="link mono"
                    onClick={e => {
                      e.stopPropagation();
                      actions.show({ kind: 'person', n: p.person });
                    }}
                    data-test="leave-card"
                  >
                    {p.tab}
                  </button>
                </td>
                <td>{roleName(p.role)}</td>
                <td className={p.miss ? 'warn' : ''}>{left !== undefined ? daysText(left) : '—'}</td>
                <td className="weeks">
                  {weeks.map(w => {
                    const x = p.parts.find(a => a.from <= w + 6 && a.to >= w);
                    const cls = !x ? 'wk' : x.problems.length > 0 ? 'wk bad' : year.st === 'approved' ? 'wk on' : 'wk draft';
                    return <span key={w} className={cls} title={x ? T.leave.week(dayText(x.from), dayText(x.to), x.deputy ? whoText(x.deputy) : '') : dayText(w)} />;
                  })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="muted small">{T.leave.pick}</div>
      {chosen ? (
        <div className="rsec" data-test="leave-person">
          <b>{T.card.person(roleName(chosen.role), chosen.tab)}</b> — {T.leave.daysLine(hundredths(chosen.earned), hundredths(chosen.used), hundredths(chosen.earned - chosen.used))}
          <LeaveParts p={chosen} years={v.years} today={v.today} hud={hud} actions={actions} />
        </div>
      ) : null}
      <div data-test="leave-trouble">
        <b>{T.leave.trouble}</b>
        {trouble.length === 0 ? <div className="muted">{T.leave.noTrouble}</div> : null}
        <ul>
          {trouble.map(({ p, x }) => (
            <li key={x.id} className="warn">
              {T.card.person(roleName(p.role), p.tab)}: {T.leave.part(dayText(x.from), dayText(x.to), daysText(x.days))} — {x.problems.map(k => T.leave.problems[k] ?? k).join(', ')}
            </li>
          ))}
        </ul>
      </div>
      <div className="muted small">{T.leave.note(lens, v.rule.dept, daysText(v.law.notice), daysText(v.law.pay))}</div>
    </section>
  );
}
