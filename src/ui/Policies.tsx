// Окно «Политики» (Б5г; docs/specs/2026-10-vertical-slice.md, «Б5г»; геймдизайн, §8.5): числа и правила руководителей.
// Большое окно поверх карты, как показатели: вкладки руководителей — сначала отделы взятых постов; строка — политика,
// значение с «−» и «+» или вариантами, пределы и шаг, кто и с какого дня её задал, сколько решений журнала за 30 суток её
// читали; у руководителя отдела — сверхурочные его отделов (Б4а). Новое значение — черновик окна: «Прогнать» — прогон
// плана «как сейчас» и с черновиком на 13 неделях и 5 зёрнах, ход по зёрнам; «Применить» — команды; «Сбросить». У
// чужого поста — без кнопок, с подписью, чей это пост. Вид собирает поток расчёта (src/sim/policies.ts); слова — здесь.
import type { OvertimeMode, Policy } from '../content/types';
import { DEPT_SEAT } from '../engine/seats';
import type { RunSum } from '../engine/plan/run';
import type { Head, PolicyValue } from '../engine/types';
import { hText, money, num, pctText, T, whenText } from '../i18n';
import type { PolicyRow, PolicyTab } from '../sim/policies';
import { USED_DAYS } from '../sim/policies';
import { db } from './db';
import { draftKey, overtimeKey, policyName, policyText, rangeText, sameValue, stepLevel, stepValue } from './policy';
import { type Actions, holds, type Hud, POLICY_RUN } from './store';

const WEEKS = Math.round(POLICY_RUN.days / 7);
const OVERTIME: readonly OvertimeMode[] = ['need', 'finish'];

/** Кто задал политику: вы с места и с какого мгновения или запись сценария. */
function setText(r: PolicyRow, hud: Hud): string {
  if (!r.set) return T.policies.scenario;
  return T.policies.setBy(T.journal.player(r.set.seat ? (T.seats.names[r.set.seat] ?? r.set.seat) : ''), whenText(hud.start, r.set.t));
}

/** Управление значением: «−» и «+» у суток, месяцев и износа; два у уровня ЗИП; кнопки у выбора и доли мест. */
function Control({ p, v, mine, set }: { p: Policy; v: PolicyValue; mine: boolean; set: (x: PolicyValue) => void }) {
  const step = (dir: -1 | 1) => stepValue(p, v, dir);
  const btn = (label: string, next: PolicyValue | undefined, test: string) => (
    <button type="button" className="small" disabled={!mine || next === undefined} onClick={() => next !== undefined && set(next)} aria-label={label} title={label} data-test={test}>
      {test.endsWith('less') ? '−' : '+'}
    </button>
  );
  if (p.kind === 'days' || p.kind === 'months' || p.kind === 'wear')
    return (
      <span className="pctl">
        {btn(T.policies.less, step(-1), 'policy-less')} <b data-test="policy-value">{policyText(p, v)}</b> {btn(T.policies.more, step(1), 'policy-more')}
      </span>
    );
  if (p.kind === 'level') {
    const [a, b] = Array.isArray(v) ? v : [0, 0];
    return (
      <span className="pctl" data-test="policy-value" data-v={`${a}:${b}`}>
        {T.policies.left} {btn(T.policies.less, stepLevel(p, v, 0, -1), 'policy-left-less')} <b>{num(a)}</b> {btn(T.policies.more, stepLevel(p, v, 0, 1), 'policy-left-more')} — {T.policies.upTo} {btn(T.policies.less, stepLevel(p, v, 1, -1), 'policy-up-less')} <b>{num(b)}</b> {btn(T.policies.more, stepLevel(p, v, 1, 1), 'policy-up-more')}
      </span>
    );
  }
  const options: PolicyValue[] = p.kind === 'choice' ? (p.options ?? []) : (p.shares ?? []).map(x => [x[0], x[1]] as [number, number]);
  return (
    <span className="filters pctl" data-test="policy-value" data-v={JSON.stringify(v)}>
      {options.map(o => (
        <button key={JSON.stringify(o)} type="button" className={sameValue(o, v) ? 'on' : ''} disabled={!mine} aria-pressed={sameValue(o, v)} onClick={() => set(o)} data-test="policy-option" data-v={JSON.stringify(o)}>
          {policyText(p, o)}
        </button>
      ))}
    </span>
  );
}

/** Строка политики: имя (у политики «у каждого» — с вещью), значение черновика или нынешнее, пределы, кто задал, решения. */
function Row({ r, hud, mine, actions }: { r: PolicyRow; hud: Hud; mine: boolean; actions: Actions }) {
  const p = db?.policies[r.policy];
  if (!p) return null;
  const draft = hud.policies.draft[draftKey(r.policy, r.of)];
  const v = draft ?? r.value;
  const facts = [rangeText(p), setText(r, hud), r.used !== undefined ? T.policies.used(r.used, USED_DAYS) : T.policies.noUsed].filter(Boolean);
  return (
    <div className={`prow${draft !== undefined ? ' drafted' : ''}`} data-test="policy-row" data-policy={r.policy} {...(r.of ? { 'data-of': r.of } : {})} data-value={JSON.stringify(r.value)}>
      <span className="pname">{policyName(p, r.policy, r)}</span>
      <Control p={p} v={v} mine={mine} set={x => actions.draftPolicy(r.policy, r.of, x)} />
      <span className="muted small">
        {draft !== undefined ? `${T.policies.was(policyText(p, r.value))} · ` : ''}
        {facts.join(' · ')}
      </span>
    </div>
  );
}

/** Сверхурочные отдела (Б4а): «по потребности» или «только закончить начатое» — тот же черновик. */
function Overtime({ tab, hud, actions }: { tab: PolicyTab; hud: Hud; actions: Actions }) {
  return (
    <>
      {tab.overtime.map(o => {
        const mine = holds(hud, DEPT_SEAT[o.dept]);
        const draft = hud.policies.draft[overtimeKey(o.dept)] as OvertimeMode | undefined;
        const v = draft ?? o.mode;
        return (
          <div key={o.dept} className={`prow${draft !== undefined ? ' drafted' : ''}`} data-test="policy-row" data-policy="overtime" data-of={o.dept} data-value={JSON.stringify(o.mode)}>
            <span className="pname">{T.policies.overtime(T.morning.depts[o.dept] ?? o.dept)}</span>
            <span className="filters pctl" data-test="policy-value" data-v={JSON.stringify(v)}>
              {OVERTIME.map(m => (
                <button key={m} type="button" className={m === v ? 'on' : ''} disabled={!mine} aria-pressed={m === v} onClick={() => actions.draftPolicy('overtime', o.dept, m)} data-test="policy-option" data-v={JSON.stringify(m)}>
                  {T.ref.modes[m] ?? m}
                </button>
              ))}
            </span>
            <span className="muted small">{draft !== undefined ? T.policies.was(T.ref.modes[o.mode] ?? o.mode) : ''}</span>
          </div>
        );
      })}
    </>
  );
}

/** Число итога: наименьшее, медиана, наибольшее по зёрнам — медиана и разброс. */
function cell(r: [number, number, number] | undefined, f: (n: number) => string): string {
  return r ? T.policies.cell(f(r[1]), f(r[0]), f(r[2])) : '—';
}

/** Строки итога прогона: заказы и ящики, серии, касса, OEE, уборки и переналадки, ГП и материалы в конце, сверхурочные. */
const METRICS: { key: string; of: (s: RunSum) => [number, number, number] | undefined; f: (n: number) => string }[] = [
  { key: 'failed', of: s => s.failed, f: n => num(n) },
  { key: 'short', of: s => s.short, f: n => num(n) },
  { key: 'released', of: s => s.released, f: n => num(n) },
  { key: 'cash', of: s => s.cash, f: n => money(n) },
  { key: 'oee', of: s => s.lines[0]?.oee, f: n => pctText(n, 1) },
  { key: 'major', of: s => s.switches.major, f: n => num(n) },
  { key: 'changes', of: s => s.switches.changes, f: n => num(n) },
  { key: 'fg', of: s => s.fg, f: n => num(n) },
  { key: 'stock', of: s => s.stock, f: n => money(n) },
  { key: 'ot', of: s => s.ot, f: n => hText(n) },
];

/** Ход и итог прогона: «как сейчас» и с черновиком на одних зёрнах; черновик сменился — итог о прежнем. */
function Run({ hud }: { hud: Hud }) {
  const run = hud.policies.run;
  if (!run.running && run.sums.length === 0 && !run.error) return null;
  const stale = run.key !== undefined && run.key !== JSON.stringify(hud.policies.draft);
  const variant = (i: number) => (i === 0 ? T.plan.now : T.plan.draftCol);
  return (
    <div className="prun" data-test="policy-run">
      <div className="msec">{T.policies.result}</div>
      {run.running && run.progress ? (
        <div className="muted" data-test="policy-progress" data-index={run.progress.index} data-k={run.progress.k}>
          {T.policies.running(variant(run.progress.index), run.progress.k, POLICY_RUN.seeds)}
        </div>
      ) : null}
      {run.error ? <div className="warn">{T.plan.error}</div> : null}
      {run.at !== undefined ? <div className="muted small">{T.policies.at(whenText(hud.start, run.at), WEEKS, POLICY_RUN.seeds)}</div> : null}
      {stale ? <div className="warn small">{T.policies.stale}</div> : null}
      {run.sums.length > 0 ? (
        <table className="ptab">
          <thead>
            <tr>
              <th />
              <th>{T.plan.now}</th>
              <th>{T.plan.draftCol}</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map(m => (
              <tr key={m.key} data-test="policy-metric" data-key={m.key}>
                <td>{T.policies.metric[m.key] ?? m.key}</td>
                {[0, 1].map(i => (
                  <td key={i} data-test="policy-cell" data-i={i} {...(run.sums[i] ? { 'data-mid': String(m.of(run.sums[i]!)?.[1] ?? '') } : {})}>
                    {run.sums[i] ? cell(m.of(run.sums[i]!), m.f) : '…'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="muted small">
        {T.plan.same} {T.plan.twin}
      </div>
    </div>
  );
}

export function Policies({ hud, actions }: { hud: Hud; actions: Actions }) {
  const v = hud.policies.view;
  const tabs = v?.tabs ?? [];
  const tab = tabs.find(x => x.head === hud.policies.tab) ?? tabs[0];
  const n = Object.keys(hud.policies.draft).length;
  const run = hud.policies.run;
  const busy = run.running || hud.plan.running;
  const headName = (h: Head) => T.journal.names[h] ?? h;
  return (
    <div className="kpi panel pol" id="policies" role="dialog" aria-labelledby="pol-title" data-test="policies">
      <div className="phead">
        <b id="pol-title">{T.policies.title}</b>
        <span className="muted">{T.policies.question}</span>
        <span className="filters">
          {tabs.map(x => (
            <button key={x.head} type="button" className={tab?.head === x.head ? 'on' : ''} onClick={() => actions.setPolicyTab(x.head)} data-test="policy-tab" data-head={x.head} title={T.seats.names[x.seat] ?? x.seat}>
              {headName(x.head)}
            </button>
          ))}
        </span>
        <button type="button" className="close" onClick={() => actions.togglePolicies()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {!v ? <div className="muted">{T.app.loading}</div> : null}
      {tab ? (
        <div className="pbody" data-test="policy-head" data-head={tab.head}>
          {!holds(hud, tab.seat) ? <div className="muted small" data-test="policy-foreign">{T.seats.notYours(T.seats.names[tab.seat] ?? tab.seat)}</div> : null}
          {tab.rows.map(r => (
            <Row key={draftKey(r.policy, r.of)} r={r} hud={hud} mine={holds(hud, tab.seat)} actions={actions} />
          ))}
          <Overtime tab={tab} hud={hud} actions={actions} />
        </div>
      ) : null}
      <div className="pfoot">
        <span className="muted" data-test="policy-draft" data-n={n}>
          {n > 0 ? T.policies.draft(n) : T.policies.noDraft}
        </span>
        {run.running ? (
          <button type="button" onClick={() => actions.stopPolicies()} data-test="policy-stop">
            {T.policies.stop}
          </button>
        ) : (
          <button type="button" className={n > 0 ? 'on' : ''} disabled={n === 0 || busy} onClick={() => actions.runPolicies()} title={T.policies.runHint(WEEKS, POLICY_RUN.seeds)} data-test="policy-run-go">
            {T.policies.run}
          </button>
        )}
        <button type="button" disabled={n === 0} onClick={() => actions.applyPolicies()} title={T.policies.applyHint} data-test="policy-apply">
          {T.policies.apply}
        </button>
        <button type="button" disabled={n === 0} onClick={() => actions.resetPolicies()} title={T.policies.resetHint} data-test="policy-reset">
          {T.policies.reset}
        </button>
      </div>
      <Run hud={hud} />
    </div>
  );
}
