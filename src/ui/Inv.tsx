// Доска расследования (docs/specs/2026-10-investigation.md, 4б; геймдизайн, §6.6): большое окно поверх карты, как
// расписание. Слева — что случилось и участники; в середине — шаги и улики словами с числами из записей; справа — версии
// со столбиками вероятностей; снизу — решение, после решения — разбор. Шаг и решение — команды поста качества: без него
// кнопки погашены, с причиной словами (3е). Вид собирает поток расчёта (src/sim/inv.ts); здесь — слова и рисунок.
import { useEffect, useRef, useState } from 'react';
import { type Attr, ATTR_SCALE, ATTRS, type InvFinding, type InvModel, type InvStep, PARAM_SCALE, type ParamUnit } from '../content/types';
import type { Ymd } from '../engine/core/calendar';
import type { InvObs } from '../engine/types';
import { durText, named, num, pctText, T, whenText } from '../i18n';
import type { InvBoard } from '../sim/inv';
import type { TaskNow } from '../sim/lab';
import { db } from './db';
import { type Actions, type Hud, holds } from './store';

/** Значение свойства в единицах движка — словами с единицей: «71,8 %», «62 Н», «612 мкм». */
function attrText(a: Attr, v: number): string {
  const unit = ATTRS[a].unit;
  if (unit === 'qual') return num(v);
  const digits = unit === 'pct' || unit === 'min' ? 1 : 0;
  return `${num(v / ATTR_SCALE[unit], digits)} ${T.units[unit]}`;
}

/** Режим стадии в единицах движка — словами с единицей: «17,7 мин», «13,0 кН». */
function paramText(unit: ParamUnit, v: number): string {
  const digits = unit === 'min' || unit === 'kN' ? 1 : 0;
  return `${num(v / PARAM_SCALE[unit], digits)} ${T.units[unit]}`;
}

/** Вклад причины в показатель — процентными пунктами со знаком: «−19,0 п. п.». */
const ppText = (delta: number) => `${delta < 0 ? '−' : '+'}${num(Math.abs(delta) / 100, 1)} ${T.units.pp}`;

/** Числа улики для слов: из записей, в единицах движка (src/engine/investigation.ts, `readFinding`). */
function detail(o: InvObs, f: InvFinding, b: InvBoard, start: Ymd): string {
  const r = f.read;
  const d = o.data;
  if (!d || d.length === 0) return '';
  const attr = db?.tests[b.what.method]?.attr;
  if ('mark' in r) return r.mark === 'calc' ? T.inv.calc(d[0] === 1) : (T.inv.faults[d[0]] ?? '');
  if ('retest' in r) return attr ? T.inv.retest(attrText(attr, d[0])) : '';
  if ('param' in r) {
    const p = db?.recipes[b.what.recipe]?.stages.flatMap(st => st.params).find(x => x.id === r.param);
    return p ? T.inv.param(paramText(p.unit, d[0]), paramText(p.unit, d[1]), paramText(p.unit, d[2])) : '';
  }
  if ('ipc' in r) {
    const a = db?.tests[r.ipc]?.attr;
    return a ? T.inv.ipc(attrText(a, d[0])) : '';
  }
  if ('journal' in r) return T.inv.journal(whenText(start, d[0]));
  if ('coa' in r) return T.inv.coa(attrText(r.coa, d[0]));
  if ('peers' in r) return attr ? T.inv.peers(d.map(v => attrText(attr, v)).join(', ')) : '';
  if ('measure' in r) return T.inv.measure(attrText(r.measure, d[0]));
  return '';
}

/** Кто делает шаг: роль — по имени из базы; испытание — лаборатория и методика. */
function whoOf(st: InvStep): string {
  if (st.test) return `${T.inv.lab}: ${named(db?.tests[st.test]?.name, st.test)}`;
  return named(st.role ? db?.roles[st.role]?.name : undefined, st.role ?? '');
}

/** Сколько работы у шага: роль — работа, испытание — подготовка и работа прибора. */
function workOf(st: InvStep): number {
  const m = st.test ? db?.tests[st.test] : undefined;
  return m ? m.prep + m.run : (st.work ?? 0);
}

function nowText(n: TaskNow | undefined, start: Ymd): string {
  if (!n) return T.inv.running;
  const task = T.tasks[n.task] ?? n.task;
  if (n.busy) return T.why.taskBusy(task);
  return n.wait ? T.why.taskWait(task, T.wait[n.wait], whenText(start, n.since)) : T.why.taskOpen(task);
}

function What({ b, start }: { b: InvBoard; start: Ymd }) {
  const w = b.what;
  const attr = db?.tests[w.method]?.attr;
  const method = named(db?.tests[w.method]?.name, w.method);
  const value = attr ? attrText(attr, w.result) : num(w.result);
  return (
    <div className="isec" data-test="inv-what">
      <div className="msec">{T.inv.what}</div>
      <div className="bad">
        {w.min !== undefined && attr ? T.inv.result(method, value, attrText(attr, w.min)) : w.max !== undefined && attr ? T.inv.resultMax(method, value, attrText(attr, w.max)) : `${method}: ${value}`}
      </div>
      <div>{T.inv.lot(T.lotCode(...w.lot), named(db?.materials[w.material]?.name, w.material))}</div>
      <div>{T.inv.batch(w.batch, named(db?.recipes[w.recipe]?.name, w.recipe))}</div>
      <div className="muted">
        {w.t !== undefined ? `${T.inv.checked(whenText(start, w.t))}; ` : ''}
        {T.inv.opened(whenText(start, b.opened))}
      </div>
      <div className="msec">{T.inv.who}</div>
      <div className="muted">{T.inv.lots}</div>
      <ul className="iplain">
        {b.who.lots.map(l => (
          <li key={T.lotCode(...l.code)}>
            <span className="mono">{T.lotCode(...l.code)}</span> {named(db?.materials[l.material]?.name, l.material)}
          </li>
        ))}
      </ul>
      <div className="muted">{T.inv.stages}</div>
      <ul className="iplain">
        {b.who.stages.map(x => {
          const stage = T.stages[x.stage] ?? x.stage;
          const room = T.roomTypes[x.room] ?? x.room;
          // помещение — если его имя не повторяет стадию
          const more = [...(room !== stage ? [room] : []), ...x.roles.map(r => named(db?.roles[r]?.name, r))];
          return (
            <li key={x.stage}>
              {stage}: {x.equipment.map(e => named(db?.equipment[e]?.name, e)).join(', ')}
              {more.length > 0 ? <span className="muted"> · {more.join(' · ')}</span> : null}
            </li>
          );
        })}
      </ul>
      {b.who.inst ? (
        <>
          <div className="muted">{T.inv.inst}</div>
          <ul className="iplain">
            <li>{named(db?.instruments[b.who.inst]?.name, b.who.inst)}</li>
          </ul>
        </>
      ) : null}
    </div>
  );
}

function Steps({ b, m, start, actions, mine }: { b: InvBoard; m: InvModel; start: Ymd; actions: Actions; mine: boolean }) {
  const open = b.status === 'open';
  return (
    <div className="isec" data-test="inv-steps">
      <div className="msec">{T.inv.steps}</div>
      {b.obs.length === 0 ? <div className="muted">{T.inv.noObs}</div> : null}
      <ol className="isteps">
        {b.steps.map(row => {
          const st = m.steps.find(x => x.id === row.id);
          if (!st) return null;
          const obs = b.obs.filter(o => o.step === row.id);
          return (
            <li key={row.id} data-test="inv-step" data-step={row.id} data-state={row.state}>
              <div className="ihead">
                <span className="grow">
                  {named(st.name, st.id)}
                  <span className="muted">
                    {' '}
                    · {whoOf(st)} · {T.inv.work(durText(workOf(st)))}
                  </span>
                </span>
                {row.state === 'can' ? (
                  <button type="button" disabled={!mine || !open} onClick={() => actions.investigate(b.id, row.id)} title={mine ? '' : T.seats.notYours(T.seats.names.quality)} data-test="inv-do">
                    {T.inv.do}
                  </button>
                ) : row.state === 'running' ? (
                  <span className="muted nowrap">{nowText(row.now, start)}</span>
                ) : (
                  <span className="muted nowrap">{T.inv.done(whenText(start, row.to!))}</span>
                )}
              </div>
              {row.by ? <div className="muted small">{row.by === 'player' ? T.inv.byYou : T.inv.byColleague}</div> : null}
              {obs.length > 0 ? (
                <ul className="iobs">
                  {obs.map(o => {
                    const f = m.findings.find(x => x.id === o.f);
                    if (!f) return null;
                    const more = detail(o, f, b, start);
                    return (
                      <li key={o.f} className={o.shown ? 'yes' : 'no'} data-test="inv-obs" data-f={o.f} data-shown={o.shown ? '1' : '0'}>
                        <b>{o.shown ? T.inv.shown : T.inv.notShown}</b> — {named(f.name, f.id)}
                        {more ? <span className="muted"> ({more})</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Versions({ b, m }: { b: InvBoard; m: InvModel }) {
  return (
    <div className="isec" data-test="inv-versions">
      <div className="msec">{T.inv.versions}</div>
      <div className="muted small">{T.inv.versionsHint}</div>
      <ul className="ivers">
        {b.beliefs.map(x => {
          const c = m.candidates.find(y => y.id === x.id);
          return (
            <li key={x.id} data-test="inv-version" data-id={x.id} data-p={x.p}>
              <span className="vname">{named(c?.name, x.id)}</span>
              <span className="vbar" aria-hidden="true">
                <span style={{ width: `${Math.max(0, Math.min(100, x.p / 100))}%` }} />
              </span>
              <span className="num">{pctText(x.p, x.p < 100 || x.p > 9900 ? 1 : 0)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Decide({ b, m, actions, mine }: { b: InvBoard; m: InvModel; actions: Actions; mine: boolean }) {
  const [cause, setCause] = useState<string | undefined>();
  const [fate, setFate] = useState<'reject' | 'release' | undefined>();
  // другое расследование — отметки заново
  useEffect(() => {
    setCause(undefined);
    setFate(undefined);
  }, [b.id]);
  const ready = mine && cause !== undefined && fate !== undefined && (fate === 'reject' || b.release);
  return (
    <div className="isec idecide" data-test="inv-decide">
      <div className="msec">{T.inv.decision}</div>
      <div className="irow">
        <span className="label">{T.inv.cause}</span>
        {m.candidates.map(c => (
          <button key={c.id} type="button" className={cause === c.id ? 'on' : ''} disabled={!mine} onClick={() => setCause(c.id)} aria-pressed={cause === c.id} data-test="inv-cause" data-id={c.id}>
            {named(c.name, c.id)}
          </button>
        ))}
      </div>
      <div className="irow">
        <span className="label">{T.inv.fate}</span>
        <button type="button" className={fate === 'reject' ? 'on' : ''} disabled={!mine} onClick={() => setFate('reject')} aria-pressed={fate === 'reject'} data-test="inv-fate" data-id="reject">
          {T.inv.reject}
        </button>
        <button type="button" className={fate === 'release' ? 'on' : ''} disabled={!mine || !b.release} onClick={() => setFate('release')} aria-pressed={fate === 'release'} title={b.release ? '' : T.inv.releaseNo} data-test="inv-fate" data-id="release">
          {T.inv.release}
        </button>
        <button type="button" className="go-on" disabled={!ready} onClick={() => cause && fate && actions.conclude(b.id, cause, fate)} data-test="inv-conclude">
          {T.inv.conclude}
        </button>
      </div>
      <div className="muted small">{!mine ? `${T.seats.notYours(T.seats.names.quality)}. ${T.inv.colleague}` : !b.release ? T.inv.releaseNo : T.inv.pickCause}</div>
    </div>
  );
}

function Debrief({ b, m, start }: { b: InvBoard; m: InvModel; start: Ymd }) {
  const d = b.debrief!;
  const c = b.conclusion!;
  const nameOf = (id: string) => named(m.candidates.find(x => x.id === id)?.name, id);
  const attr = db?.tests[b.what.method]?.attr;
  const method = named(db?.tests[b.what.method]?.name, b.what.method);
  const fateText = d.fate ? (d.good && !d.provable && c.fate === 'reject' ? T.inv.fateRules : T.inv.fateRight) : T.inv.fateLost;
  const who = c.by === 'player' ? T.inv.whoDecided.player : T.inv.whoDecided.colleague;
  // решили — разбор на виду
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), []);
  return (
    <div className="isec idebrief" ref={ref} data-test="inv-debrief" data-root={d.root} data-cause={d.cause ? '1' : '0'} data-fate={d.fate ? '1' : '0'}>
      <div className="msec">{T.inv.debrief}</div>
      <div>{T.inv.concluded(nameOf(c.cause), T.inv.fates[c.fate], who, whenText(start, c.t))}</div>
      <div className="ihead2">{T.inv.truth(nameOf(d.root))}</div>
      <div className={d.cause ? '' : 'bad'}>{d.cause ? T.inv.causeRight : T.inv.causeWrong(nameOf(c.cause))}</div>
      <div className={d.fate && !(d.good && c.fate === 'reject') ? '' : 'bad'}>{fateText}</div>
      {attr ? <div>{T.inv.truthValue(method, attrText(attr, d.truth), attrText(attr, d.result))}</div> : null}
      <div className="muted">{T.inv.contributions}</div>
      {d.causes.length === 0 ? <div className="muted">{T.inv.noContributions}</div> : null}
      <ul className="iplain">
        {d.causes.map(x => (
          <li key={x.cause}>
            {named(db?.causes[x.cause]?.name, x.cause)} <span className="num">{ppText(x.delta)}</span>
          </li>
        ))}
      </ul>
      <div className="muted">{T.inv.steps}</div>
      <ul className="iplain">
        {d.steps.map(x => (
          <li key={x.step} className={x.idle ? 'bad' : ''} data-test="inv-gain" data-step={x.step} data-idle={x.idle ? '1' : '0'}>
            {named(m.steps.find(y => y.id === x.step)?.name, x.step)}: {x.idle ? T.inv.idle(num(x.gain, 2)) : T.inv.gain(num(x.gain, 2))}
          </li>
        ))}
      </ul>
      <ul className="iplain">
        {d.obs.map(o => {
          const f = m.findings.find(x => x.id === o.f);
          const word = o.was === 'none' ? (o.shown ? T.inv.falseSign : T.inv.was.none) : o.shown ? T.inv.was[o.was] : `${T.inv.was[o.was]}; ${T.inv.missed}`;
          return (
            <li key={`${o.step}/${o.f}`} data-test="inv-was" data-f={o.f} data-was={o.was}>
              <b>{o.shown ? T.inv.shown : T.inv.notShown}</b> — {named(f?.name, o.f)}: <span className="muted">{word}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Inv({ hud, actions }: { hud: Hud; actions: Actions }) {
  const v = hud.inv.view;
  const start = hud.start;
  const mine = holds(hud, 'quality');
  const b = v?.board;
  const m = b ? db?.investigations[b.model] : undefined;
  return (
    <div className="inv panel" id="inv" role="dialog" aria-labelledby="inv-title" data-test="inv">
      <div className="phead">
        <b id="inv-title">{T.inv.title}</b>
        <span className="muted">{T.inv.question}</span>
        {v && v.list.length > 1 ? (
          <span className="filters">
            {v.list.map(x => (
              <button key={x.id} type="button" className={b?.id === x.id ? 'on' : ''} onClick={() => actions.openInv(x.id)} data-test="inv-tab">
                {T.inv.tab(x.batch, x.status === 'open')}
              </button>
            ))}
          </span>
        ) : null}
        <button type="button" className="close" onClick={() => actions.toggleInv()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {!v ? <div className="muted">{T.app.loading}</div> : null}
      {v && !b ? <div className="muted empty">{T.inv.empty}</div> : null}
      {b && m ? (
        <>
          <div className="icols" data-test="inv-board" data-id={b.id} data-status={b.status}>
            <What b={b} start={start} />
            <Steps b={b} m={m} start={start} actions={actions} mine={mine} />
            <Versions b={b} m={m} />
          </div>
          {b.status === 'open' ? <Decide b={b} m={m} actions={actions} mine={mine} /> : b.debrief && b.conclusion ? <Debrief b={b} m={m} start={start} /> : null}
        </>
      ) : null}
    </div>
  );
}
