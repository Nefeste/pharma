// Расписание (docs/specs/2026-10-panels.md, 3д; геймдизайн, §9.4): большое окно поверх карты — Гант по помещениям
// производства и линии: прошлое, идущее и прогон по правилам движка. Задание на серию, ещё не начавшее комплектовку,
// тянут мышью или стрелками — призрак показывает, где оно встанет и почему не там, куда тянут; отпустили (Enter) —
// строка черновика (часть 5, docs/specs/2026-10-plan-run.md): его полосы — в белой рамке, прежние — бледнее;
// «Утвердить» — команды `shift`, «Сбросить» — черновик пуст; Esc — отмена перетаскивания. «Прогнать план» — завод на 14
// суток вперёд на пяти зёрнах во втором потоке: «как сейчас» и черновик на одних и тех же зёрнах; итог — под расписанием.
// Щелчок по полосе — камера к помещению или линии. Виды собирает поток расчёта (src/sim/plan.ts), итог прогона — поток
// прогона (src/sim/planHost.ts); здесь — слова, рисунок и мышь.
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { HOUR, momentOf, type Ymd } from '../engine/core/calendar';
import type { Range, RunSum } from '../engine/plan/run';
import type { Bar, Why } from '../engine/plan/schedule';
import { planOf } from '../engine/plant';
import { clock, dayText, durText, money, named, pctText, qtyText, T, whenText } from '../i18n';
import type { BatchLabel, GanttRow, GanttView } from '../sim/plan';
import type { Thing } from '../sim/views';
import { assetClass, assetName, unfitText, workName } from './assets';
import { db } from './db';
import { draftKey } from './draft';
import { type Actions, type GanttDays, type Hud, holds, PLAN_RUN, type PlanRun } from './store';

/** Шаг срока, куда тянут: 15 минут; стрелка с Shift — час. */
const SNAP = 15 * 60;
const DAYS: GanttDays[] = [1, 3, 9];
/** Деления шкалы, часы: шаг и подпись. */
const TICK: Record<GanttDays, [number, number]> = { 1: [1, 2], 3: [3, 6], 9: [6, 24] };

const snap = (t: number) => Math.round(t / SNAP) * SNAP;

type Labels = Record<string, BatchLabel>;

/** Номер серии, если выдан, иначе номер задания; падеж — по месту во фразе. */
function who(l: Labels, id: string | undefined, kase: 'nom' | 'gen' | 'ins' = 'nom'): string {
  const b = id ? l[id] : undefined;
  if (!b) return '';
  if (b.code) {
    const c = b.code;
    return kase === 'gen' ? T.gantt.batchGen(c) : kase === 'ins' ? T.gantt.batchIns(c) : T.gantt.batch(c);
  }
  return kase === 'gen' ? T.gantt.orderGen(b.n) : kase === 'ins' ? T.gantt.orderIns(b.n) : T.gantt.order(b.n);
}

/** Короткая подпись серии на полосе: номер серии или «задание N». */
const short = (l: Labels, id: string | undefined) => {
  const b = id ? l[id] : undefined;
  return b?.code ?? (b ? T.gantt.order(b.n) : '');
};

export function Gantt({ hud, actions, plant }: { hud: Hud; actions: Actions; plant: string }) {
  const g = hud.gantt;
  const v = g.view;
  const start = hud.start;
  const ref = useRef<{ batch: string; x0: number; t0: number; perPx: number; moved: boolean; bar: Bar } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  // срочное задание (Б1г): открыт ли выбор позиции
  const [pick, setPick] = useState(false);
  const drag = useRef(g.drag);
  drag.current = g.drag;
  // конец перетаскивания — снять подсказку у курсора (Esc отменил его в игре)
  useEffect(() => {
    if (!g.drag) setTip(null);
  }, [g.drag]);

  if (!v) {
    return (
      <div className="gantt panel" id="gantt" data-test="gantt">
        <div className="muted">{T.app.loading}</div>
      </div>
    );
  }
  const span = v.to - v.from;
  const pct = (t: number) => ((Math.min(Math.max(t, v.from), v.to) - v.from) * 100) / span;
  const day = (t: number) => momentOf(start, t).day;
  const roomType = new Map(v.rows.map(r => [r.id, r.type]));
  const roomName = (id: string) => T.roomTypes[roomType.get(id) ?? ''] ?? id;
  // тянуть — только с постом производства (3е): расписание — его команда
  const mine = holds(hud, 'production');
  const movable = new Set(mine ? v.movable : []);
  const labels: Labels = { ...v.batches, ...(g.ghost?.batches ?? {}) };
  // черновик: полосы сдвинутых им серий — в белой рамке; прежние — бледнее
  const moved = new Set(v.moved);
  // срочное задание (Б1г) — по позициям плана выпуска сценария этого завода
  const items = Object.values(db?.scenarios ?? {}).find(sc => sc.plant === plant)?.plan?.items ?? [];

  /** Мгновение — словами для причин: сегодня — часы; в пределах недели — день недели и часы; дальше — дата и часы. */
  const timeText = (t: number) => {
    const d = day(t) - day(v.now);
    const m = momentOf(start, t);
    if (d === 0) return clock(m.sec);
    if (d > 0 && d < 7) return `${T.date.weekdays[m.weekday]} ${clock(m.sec)}`;
    return whenText(start, t);
  };
  const atText = (t: number) => {
    const m = momentOf(start, t);
    return T.gantt.at(day(t) === day(v.now) ? '' : T.date.weekdays[m.weekday], clock(m.sec)).trim();
  };

  const whyText = (w: Why): string => {
    switch (w.why) {
      case 'past':
        return T.gantt.why.past;
      case 'kitting':
        return T.gantt.why.kitting(timeText(w.until), w.pack ? T.gantt.packOf(who(labels, w.batch, 'gen')) : who(labels, w.batch));
      case 'material': {
        const m = db?.materials[w.material];
        const src = w.lab ? T.gantt.why.lab : w.po && w.eta !== undefined ? T.gantt.why.po(w.po, dayText(day(w.eta))) : T.gantt.why.noPo;
        return T.gantt.why.material(named(m?.name, w.material), m ? qtyText(w.qty, m.unit) : String(w.qty), src);
      }
      case 'shift':
        return T.gantt.why.shift(T.gantt.crew[w.role] ?? T.gantt.crewAny(named(db?.roles[w.role]?.name, w.role)), w.bar === 'kit' ? T.gantt.whatKit : T.gantt.whatStage, atText(w.at));
      case 'hours':
        return T.gantt.why.hours(T.gantt.crew[w.role] ?? T.gantt.crewAny(named(db?.roles[w.role]?.name, w.role)), w.bar === 'kit' ? T.gantt.whatKit : T.gantt.whatStage, atText(w.at));
      case 'room':
        return T.gantt.why.room(roomName(w.room), who(labels, w.batch, 'ins'), timeText(w.until));
      case 'clean':
        return w.cause === 'after' ? T.gantt.why.after(roomName(w.room), who(labels, w.batch, 'gen'), durText(w.work)) : w.cause === 'expired' ? T.gantt.why.expired(roomName(w.room), durText(w.work)) : T.gantt.why.product(roomName(w.room), durText(w.work));
      case 'repair':
        return T.gantt.why.repair(roomName(w.room));
      case 'visit': {
        const a = v.assets[w.asset];
        return T.gantt.why.visit(roomName(w.room), a ? `${workName(a, w.work)} — ${assetClass(a)}` : w.asset, timeText(w.until));
      }
      case 'unfit': {
        const a = v.assets[w.asset];
        return T.gantt.why.unfit(roomName(w.room), a ? `${unfitText(a)} — ${assetName(a)}` : w.asset);
      }
    }
  };

  /** Причины полосы: у комплектовки — `kit`, у стадии — её код. */
  const whyOf = (b: Bar, list: Why[] | undefined) => (b.batch && (b.kind === 'kit' || b.kind === 'stage') ? (list ?? []).filter(w => w.bar === (b.kind === 'kit' ? 'kit' : b.stage)) : []);

  const barText = (b: Bar): string => {
    switch (b.kind) {
      case 'kit':
        return `${b.pack ? T.gantt.bar.packKit : T.gantt.bar.kit}: ${short(labels, b.batch)}`;
      case 'stage':
        return `${short(labels, b.batch)} · ${T.stages[b.stage ?? ''] ?? b.stage}`;
      case 'clean':
        return b.major ? T.gantt.bar.major : T.gantt.bar.clean;
      case 'roomClean':
        return b.major ? T.gantt.bar.roomMajor : T.gantt.bar.room;
      case 'setup':
        return `${T.gantt.bar.setup}: ${short(labels, b.batch)}`;
      case 'pack':
        return `${T.gantt.bar.pack}: ${short(labels, b.batch)}`;
      case 'visit': {
        // визит подрядчика (Б3в): работа так, как она названа у класса, — «Калибровка весов», «Квалификация пресса»
        const a = b.asset ? v.assets[b.asset] : undefined;
        return a && b.work ? workName(a, b.work) : T.gantt.bar.visit;
      }
    }
  };

  const titleOf = (b: Bar): string => {
    const lines = [barText(b), `${T.gantt.span(whenText(start, b.from), whenText(start, b.to))} · ${T.gantt.when[b.when]}`];
    if ((b.kind === 'clean' || b.kind === 'roomClean') && b.batch) lines[0] = `${lines[0]} · ${who(labels, b.batch)}`;
    if (b.material) lines.push(T.gantt.material);
    if (b.repair) lines.push(T.gantt.repair);
    if (b.kind === 'visit') {
      const a = b.asset ? v.assets[b.asset] : undefined;
      if (a) lines.push(assetName(a));
      lines.push(T.gantt.visit);
    }
    if (b.batch && b.when === 'plan' && moved.has(b.batch)) lines.push(T.gantt.inDraft);
    lines.push(...whyOf(b, v.why[b.batch ?? '']).map(whyText));
    if (b.batch && movable.has(b.batch)) lines.push(T.gantt.hintDrag);
    return lines.join('\n');
  };

  /** Куда ведёт полоса: помещение плана, шлюз для материалов у комплектовки, первая машина у линии. */
  const thingOf = (row: GanttRow): Thing | undefined => {
    const p = db ? planOf(db, plant).plant : undefined;
    if (!p) return undefined;
    if (row.kind === 'line') return { kind: 'machine', line: p.lines.findIndex(l => l.id === row.id), k: 0 };
    const i = row.kind === 'kit' ? p.rooms.findIndex(r => r.type === 'airlock.material') : p.rooms.findIndex(r => r.id === row.id);
    return i >= 0 ? { kind: 'room', i } : undefined;
  };

  /** Комплектовка задания — начало, от которого тянут. */
  const kitFrom = (batch: string) => v.bars.find(b => b.batch === batch && b.kind === 'kit')?.from ?? labels[batch]?.notBefore ?? v.now;

  const down = (e: React.PointerEvent<HTMLDivElement>, b: Bar, row: GanttRow) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const track = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const can = !!b.batch && movable.has(b.batch);
    ref.current = { batch: b.batch ?? '', x0: e.clientX, t0: can ? kitFrom(b.batch!) : 0, perPx: span / Math.max(1, track.width), moved: false, bar: b };
    const move = (ev: PointerEvent) => {
      const d = ref.current;
      if (!d || !can) return;
      if (Math.abs(ev.clientX - d.x0) > 3) d.moved = true;
      if (!d.moved) return;
      setTip({ x: ev.clientX, y: ev.clientY });
      actions.drag(d.batch, snap(d.t0 + (ev.clientX - d.x0) * d.perPx));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = ref.current;
      ref.current = null;
      if (!d) return;
      if (d.moved) {
        // Esc мог отменить перетаскивание, пока кнопка была нажата
        if (drag.current) actions.drop();
        setTip(null);
        return;
      }
      // щелчок без протяжки по полосе серии — её досье поверх расписания (Б1д); по уборке или визиту — к вещи на полу:
      // окно закрывается, мир остаётся
      const label = d.bar.batch ? g.view?.batches[d.bar.batch] : undefined;
      if (label && !label.fresh) {
        actions.openDossier(label.n);
        return;
      }
      const t = thingOf(row);
      if (t) {
        actions.toggleGantt();
        actions.show(t);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const key = (e: React.KeyboardEvent<HTMLDivElement>, b: Bar) => {
    if (!b.batch || !movable.has(b.batch)) return;
    const step = e.shiftKey ? HOUR : SNAP;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const base = g.drag?.batch === b.batch ? g.drag.notBefore : snap(kitFrom(b.batch));
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ x: r.left, y: r.bottom });
      actions.drag(b.batch, base + (e.key === 'ArrowLeft' ? -step : step));
    } else if (e.key === 'Enter' && g.drag?.batch === b.batch) {
      e.preventDefault();
      actions.drop();
      setTip(null);
    }
  };

  const ghost = g.drag && g.ghost?.batch === g.drag.batch ? g.ghost : undefined;
  const [tickStep, labelStep] = TICK[g.days];
  const ticks: number[] = [];
  for (let t = Math.ceil(v.from / (tickStep * HOUR)) * tickStep * HOUR; t < v.to; t += tickStep * HOUR) ticks.push(t);

  const style = (b: Bar): CSSProperties => {
    const l = pct(b.from);
    return { left: `${l}%`, width: `${Math.max(0.15, pct(b.to) - l)}%` };
  };
  const lineNo = (id: string) => v.rows.filter(r => r.kind === 'line').findIndex(r => r.id === id) + 1;
  const rowName = (id: string) => (roomType.has(id) ? roomName(id) : T.gantt.line(lineNo(id)));
  const p = hud.plan;

  return (
    <div className="gantt panel" id="gantt" role="dialog" aria-labelledby="gantt-title" data-test="gantt">
      <div className="phead">
        <b id="gantt-title">{T.gantt.title}</b>
        <span className="muted">{T.gantt.question}</span>
        <span className="filters grow">
          {DAYS.map(d => (
            <button type="button" key={d} className={g.days === d ? 'on' : ''} onClick={() => actions.setGanttDays(d)} data-test={`gantt-days-${d}`}>
              {T.gantt.range(d)}
            </button>
          ))}
          <button type="button" onClick={() => actions.moveGantt(-1)} title={T.gantt.back}>
            ‹
          </button>
          <button type="button" className={g.from === undefined ? 'on' : ''} onClick={() => actions.moveGantt(0)}>
            {T.gantt.today}
          </button>
          <button type="button" onClick={() => actions.moveGantt(1)} title={T.gantt.forward}>
            ›
          </button>
        </span>
        <button type="button" className="close" onClick={() => actions.toggleGantt()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      <div className="gdraft" data-test="gantt-draft">
        {mine ? (
          <span className="upick">
            <button type="button" className={pick ? 'on' : ''} onClick={() => setPick(!pick)} title={T.urgent.hint} data-test="urgent-open">
              {T.urgent.button}
            </button>
            {pick ? (
              <span className="upick-list" data-test="urgent-list">
                <span className="muted">{T.urgent.pick}</span>
                {items.map(it => (
                  <button
                    type="button"
                    key={it.sku}
                    onClick={() => {
                      setPick(false);
                      actions.urgent(it.recipe, it.sku);
                    }}
                    data-test="urgent-sku"
                  >
                    {named(db?.skus[it.sku]?.name, it.sku)}
                  </button>
                ))}
              </span>
            ) : null}
          </span>
        ) : null}
        {g.draft.length + g.urgent.length > 0 ? (
          <>
            <span data-test="draft-list">{T.plan.draft([...g.draft.map(c => who(labels, c.batch) || c.batch), ...g.urgent.map(u => T.urgent.item(named(db?.skus[u.sku]?.name, u.sku)))].join(', '))}</span>
            <button type="button" onClick={() => actions.approveDraft()} disabled={!mine} title={T.plan.approveHint} data-test="draft-approve">
              {T.plan.approve}
            </button>
            <button type="button" onClick={() => actions.resetDraft()} title={T.plan.resetHint} data-test="draft-reset">
              {T.plan.reset}
            </button>
          </>
        ) : mine ? (
          <span className="muted">{T.plan.noDraft}</span>
        ) : null}
        <span className="grow" />
        {p.running ? (
          <>
            <span className="muted" data-test="plan-running">
              {T.plan.running}
            </span>
            <button type="button" onClick={() => actions.stopPlan()} data-test="plan-stop">
              {T.plan.stop}
            </button>
          </>
        ) : (
          <button type="button" className="on" onClick={() => actions.runPlan()} title={T.plan.runHint(PLAN_RUN.days, PLAN_RUN.seeds)} data-test="plan-run">
            {T.plan.run}
          </button>
        )}
      </div>
      <div className="grow-row gaxis">
        <div className="glabel" />
        <div className="gtrack">
          {ticks.map(t => {
            const m = momentOf(start, t);
            const midnight = m.sec === 0;
            const labelled = Math.floor(m.sec / HOUR) % labelStep === 0;
            return (
              <div key={t} className={`gtick${midnight ? ' day' : ''}`} style={{ left: `${pct(t)}%` }}>
                {labelled ? <span>{midnight ? `${T.date.weekdays[m.weekday]} ${dayText(m.day).slice(0, 5)}` : clock(m.sec)}</span> : null}
              </div>
            );
          })}
        </div>
      </div>
      {v.rows.map(row => (
        <div className="grow-row" key={row.id} data-test="gantt-row" data-row={row.id}>
          <div className="glabel" title={row.kind === 'room' ? roomName(row.id) : undefined}>
            {row.kind === 'kit' ? T.gantt.kit : row.kind === 'line' ? T.gantt.line(v.rows.filter(r => r.kind === 'line').indexOf(row) + 1) : roomName(row.id)}
          </div>
          <div className="gtrack">
            {v.off.map(([a, b]) => (
              <div key={a} className="goff" style={{ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` }} />
            ))}
            {ticks.filter(t => momentOf(start, t).sec === 0).map(t => (
              <div key={t} className="gday" style={{ left: `${pct(t)}%` }} />
            ))}
            {v.was
              .filter(b => b.row === row.id)
              .map((b, i) => (
                <div key={`w${i}`} className={`gbar was k-${b.kind} w-plan`} style={style(b)} title={`${barText(b)}\n${T.gantt.was}`} data-test="was">
                  {barText(b)}
                </div>
              ))}
            {v.bars
              .filter(b => b.row === row.id)
              .map((b, i) => {
                const can = !!b.batch && movable.has(b.batch);
                const cls = [
                  'gbar',
                  `k-${b.kind}`,
                  `w-${b.when}`,
                  b.material ? 'material' : '',
                  b.repair ? 'repair' : '',
                  b.major ? 'major' : '',
                  b.pack ? 'pk' : '',
                  can ? 'move' : '',
                  b.batch && b.when === 'plan' && moved.has(b.batch) ? 'draft' : '',
                  ghost && b.batch === ghost.batch && b.when === 'plan' ? 'dim' : '',
                ].filter(Boolean).join(' ');
                return (
                  <div
                    key={`${b.kind}-${b.batch ?? ''}-${b.stage ?? ''}-${i}`}
                    className={cls}
                    style={style(b)}
                    title={titleOf(b)}
                    tabIndex={can && b.kind === 'kit' ? 0 : -1}
                    onPointerDown={e => down(e, b, row)}
                    onKeyDown={e => key(e, b)}
                    data-test="gbar"
                    data-batch={b.batch}
                    data-kind={b.kind}
                    data-when={b.when}
                    data-movable={can ? '1' : undefined}
                    data-draft={b.batch && b.when === 'plan' && moved.has(b.batch) ? '1' : undefined}
                  >
                    {barText(b)}
                  </div>
                );
              })}
            {ghost?.bars
              .filter(b => b.row === row.id)
              .map((b, i) => (
                <div key={`g${i}`} className={`gbar ghost k-${b.kind}`} style={style(b)} data-test="ghost">
                  {barText(b)}
                </div>
              ))}
            <div className="gnow" style={{ left: `${pct(v.now)}%` }} />
          </div>
        </div>
      ))}
      <div className="gfoot">
        <span className="glegend">
          <span className="gbar k-kit w-plan">{T.gantt.bar.kit}</span>
          <span className="gbar k-stage w-plan">{T.gantt.bar.stage}</span>
          <span className="gbar k-clean w-plan">{T.gantt.bar.clean}</span>
          <span className="gbar k-roomClean w-plan">{T.gantt.bar.room}</span>
          <span className="gbar k-pack w-past">{T.gantt.bar.pack}</span>
          <span className="gbar k-visit w-plan">{T.gantt.bar.visit}</span>
          <span className="gbar k-stage w-past">{T.gantt.when.past}</span>
          <span className="gbar k-stage w-now">{T.gantt.when.now}</span>
          <span className="gbar k-stage w-plan">{T.gantt.when.plan}</span>
          <span className="gbar k-stage w-plan draft">{T.gantt.legendDraft}</span>
          <span className="goff-key">{T.gantt.off}</span>
        </span>
        <span className="muted" data-test="gantt-hint">
          {mine ? T.gantt.hintDrag : T.seats.gantt}
        </span>
        {v.stuck.length > 0 ? <span className="bad">{T.gantt.stuck(v.stuck.map(id => who(labels, id)).join(', '))}</span> : null}
      </div>
      {p.running || p.error || p.sums.some(Boolean) ? <PlanSum p={p} start={start} stale={p.key !== draftKey(g.draft, g.urgent)} rowName={rowName} lineNo={lineNo} /> : null}
      {g.drag && tip ? (
        <div className="gtip panel" style={{ left: Math.min(tip.x + 14, window.innerWidth - 380), top: tip.y + 14 }} data-test="gtip">
          <div>
            <b>{who(labels, g.drag.batch)}</b> · {T.gantt.notBefore(timeText(g.drag.notBefore))}
          </div>
          {ghost?.refused ? (
            <div className="bad">{T.notices.why[ghost.refused]}</div>
          ) : ghost ? (
            <>
              {ghost.bars.find(b => b.kind === 'kit') ? <div>{T.gantt.lands(timeText(ghost.bars.find(b => b.kind === 'kit')!.from))}</div> : null}
              <ul className="mlist">
                {ghost.why.map((w, i) => (
                  <li key={i}>{whyText(w)}</li>
                ))}
              </ul>
              {ghost.moved.length > 0 ? <div className="muted">{T.gantt.moved(ghost.moved.map(id => who(labels, id)).join(', '))}</div> : null}
            </>
          ) : (
            <div className="muted">{T.app.loading}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Мгновение — датой и часами; середина и разброс по зёрнам: одно — само, разные — «середина, от … до …». */
function spanOf(start: Ymd, r: Range): string {
  const w = (t: number) => whenText(start, t);
  return r[0] === r[2] ? w(r[1]) : T.plan.span(w(r[1]), w(r[0]), w(r[2]));
}

/** Число по зёрнам: «7» или «7 (5–8)». */
const countOf = (r: Range) => (r[0] === r[2] ? String(r[1]) : `${r[1]} (${r[0]}–${r[2]})`);

/** Насколько середина варианта раньше или позже середины «как сейчас»; меньше минуты — никак. */
function shiftOf(a: number | undefined, b: number | undefined): React.ReactNode {
  if (a === undefined || b === undefined || Math.abs(a - b) < 60) return null;
  return <span className="delta"> · {b < a ? T.plan.earlier(durText(a - b)) : T.plan.laterBy(durText(b - a))}</span>;
}

/** Балк к снимку уже сделан. */
const BULK_DONE = ['bulk', 'packing', 'fg'];

/**
 * Генеральные уборки или переналадки по зёрнам: сколько и часы работы — середина; у черновика — на сколько меньше или
 * больше, чем «как сейчас» (геймдизайн, §9.4). Направление — по часам, а если они те же — по числу; число против
 * направления не пишем.
 */
function switchCell(what: 'major' | 'changes', n: Range, sec: Range, was?: { n: Range; sec: Range }): React.ReactNode {
  const text = `${countOf(n)} — ${durText(sec[1])}`;
  if (!was) return text;
  const dn = n[1] - was.n[1];
  const ds = sec[1] - was.sec[1];
  // меньше минуты — часы те же
  const hours = Math.abs(ds) >= 60;
  const dir = Math.sign(hours ? ds : dn);
  if (dir === 0) return text;
  const k = Math.sign(dn) === dir ? Math.abs(dn) : 0;
  return (
    <>
      {text}
      <span className="delta"> · {T.plan.switchDelta(what, dir < 0, k, hours ? durText(Math.abs(ds)) : '')}</span>
    </>
  );
}

/**
 * Итог прогона (docs/specs/2026-10-plan-run.md, «Окно прогона»): по столбцу на вариант — заказы со сроком в горизонте, в
 * скольких зёрнах сорвутся; серии — балк и выпуск, середина и разброс; касса, OEE, узкое место. Подписан мгновением снимка.
 */
function PlanSum({ p, start, stale, rowName, lineNo }: { p: PlanRun; start: Ymd; stale: boolean; rowName: (id: string) => string; lineNo: (id: string) => number }) {
  const sums: (RunSum | undefined)[] = Array.from({ length: Math.max(1, p.variants) }, (_, i) => p.sums[i]);
  const first = sums.find((x): x is RunSum => !!x);
  const head = [T.plan.now, T.plan.draftCol].slice(0, sums.length);
  const label = (id: string) => {
    const b = p.batches[id];
    return b?.code ? T.gantt.batch(b.code) : b ? T.gantt.order(b.n) : id;
  };
  /** Ячейка варианта: итог ещё считается — «…». */
  const cells = (f: (s: RunSum, i: number) => React.ReactNode, cls?: (s: RunSum) => string) =>
    sums.map((s, i) =>
      s ? (
        <td key={i} className={cls?.(s)}>
          {f(s, i)}
        </td>
      ) : (
        <td key={i} className="muted">
          …
        </td>
      ),
    );
  const batchOf = (s: RunSum, id: string) => s.batches.find(b => b.batch === id);
  const ids = first?.batches.map(b => b.batch) ?? [];
  const active = ids.filter(id => sums.some(s => s && (batchOf(s, id)?.bulkIn || batchOf(s, id)?.releasedIn || batchOf(s, id)?.rejected)));
  const beyond = ids.filter(id => !active.includes(id));
  const base = sums[0];
  return (
    <div className="gplan" data-test="plan">
      <div className="phead">
        <b>{T.plan.title}</b>
        {p.at !== undefined && first ? <span className="muted">{T.plan.at(whenText(start, p.at), first.days, first.seeds)}</span> : null}
        {stale && first ? <span className="warn">{T.plan.stale}</span> : null}
      </div>
      {p.error ? (
        <div className="bad" title={p.error}>
          {T.plan.error}
        </div>
      ) : null}
      {!first && p.running ? <div className="muted">{T.plan.running}</div> : null}
      {first ? (
        <table className="grid gsum" data-test="plan-sum">
          <thead>
            <tr>
              <th />
              {head.map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="sec">
              <td colSpan={sums.length + 1}>{T.plan.orders}</td>
            </tr>
            {first.orders.length === 0 ? (
              <tr>
                <td colSpan={sums.length + 1} className="muted">
                  {T.plan.noOrders}
                </td>
              </tr>
            ) : null}
            {first.orders.map(o => (
              <tr key={o.order} data-test="plan-order">
                <td>{T.plan.order(named(db?.customers[o.customer]?.name, o.customer), dayText(momentOf(start, o.due).day))}</td>
                {cells(
                  s => {
                    const x = s.orders.find(r => r.order === o.order);
                    return x ? `${T.plan.fails(x.fails, s.seeds)}${x.fails > 0 && x.missing > 0 ? ` · ${T.plan.missing(x.missing)}` : ''}` : '—';
                  },
                  s => ((s.orders.find(r => r.order === o.order)?.fails ?? 0) > 0 ? 'bad' : ''),
                )}
              </tr>
            ))}
            <tr>
              <td>{T.plan.later}</td>
              {cells(s => T.plan.laterCell(countOf(s.later.placed), countOf(s.later.failed)))}
            </tr>
            <tr className="sec">
              <td colSpan={sums.length + 1}>{T.plan.batches}</td>
            </tr>
            {active.flatMap(id => [
              <tr key={`${id}b`} data-test="plan-batch" data-batch={id}>
                <td>
                  {label(id)} · {T.plan.bulk}
                </td>
                {cells((s, i) => {
                  const x = batchOf(s, id);
                  if (BULK_DONE.includes(p.batches[id]?.status ?? '')) return <span className="muted">{T.plan.done}</span>;
                  if (!x?.bulk) return <span className="muted">{T.plan.beyond}</span>;
                  const was = i > 0 && base ? batchOf(base, id)?.bulk?.[1] : undefined;
                  return (
                    <>
                      {spanOf(start, x.bulk)}
                      {x.bulkIn < s.seeds ? ` · ${T.plan.inSeeds(x.bulkIn, s.seeds)}` : ''}
                      {shiftOf(was, x.bulk[1])}
                    </>
                  );
                })}
              </tr>,
              <tr key={`${id}r`}>
                <td>
                  {label(id)} · {T.plan.release}
                </td>
                {cells(
                  (s, i) => {
                    const x = batchOf(s, id);
                    const rejected = x?.rejected ? T.plan.rejected(x.rejected, s.seeds) : '';
                    if (!x?.released) return rejected || <span className="muted">{T.plan.beyond}</span>;
                    const was = i > 0 && base ? batchOf(base, id)?.released?.[1] : undefined;
                    return (
                      <>
                        {spanOf(start, x.released)}
                        {x.releasedIn < s.seeds ? ` · ${T.plan.inSeeds(x.releasedIn, s.seeds)}` : ''}
                        {shiftOf(was, x.released[1])}
                        {rejected ? `; ${rejected}` : ''}
                      </>
                    );
                  },
                  s => (batchOf(s, id)?.rejected ? 'bad' : ''),
                )}
              </tr>,
            ])}
            {beyond.length > 0 ? (
              <tr>
                <td colSpan={sums.length + 1} className="muted">
                  {T.plan.beyondAll(beyond.map(label).join(', '))}
                </td>
              </tr>
            ) : null}
            <tr className="sec">
              <td colSpan={sums.length + 1}>{T.plan.plant}</td>
            </tr>
            <tr data-test="plan-cash">
              <td>{T.plan.cash}</td>
              {cells((s, i) => {
                const c = s.cash;
                const text = c[0] === c[2] ? money(c[1]) : T.plan.span(money(c[1]), money(c[0]), money(c[2]));
                const d = i > 0 && base ? Math.round((c[1] - base.cash[1]) / 100) : 0;
                return (
                  <>
                    {text}
                    {d !== 0 ? <span className="delta"> · {money(c[1] - base!.cash[1], true)}</span> : null}
                  </>
                );
              })}
            </tr>
            {first.lines.map(l => (
              <tr key={l.line}>
                <td>{T.plan.oee(lineNo(l.line))}</td>
                {cells(s => {
                  const o = s.lines.find(x => x.line === l.line)?.oee;
                  return o ? <span title={`${pctText(o[0])} – ${pctText(o[2])}`}>{pctText(o[1])}</span> : '—';
                })}
              </tr>
            ))}
            <tr data-test="plan-major">
              <td>{T.plan.major}</td>
              {cells((s, i) => switchCell('major', s.switches.major, s.switches.majorSec, i > 0 && base ? { n: base.switches.major, sec: base.switches.majorSec } : undefined))}
            </tr>
            <tr data-test="plan-changes">
              <td>{T.plan.changes}</td>
              {cells((s, i) => switchCell('changes', s.switches.changes, s.switches.changeSec, i > 0 && base ? { n: base.switches.changes, sec: base.switches.changeSec } : undefined))}
            </tr>
            <tr>
              <td>{T.plan.bottleneck}</td>
              {cells(s => {
                const top = [...s.busy].sort((a, b) => b.share[1] - a.share[1])[0];
                return top ? `${rowName(top.row)} · ${pctText(top.share[1])}` : '—';
              })}
            </tr>
          </tbody>
        </table>
      ) : null}
      {first ? (
        <div className="muted gnote">
          {sums.length > 1 ? <div>{T.plan.same}</div> : null}
          <div>{T.plan.twin}</div>
        </div>
      ) : null}
    </div>
  );
}
