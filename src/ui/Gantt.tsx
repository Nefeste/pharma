// Расписание (docs/specs/2026-10-panels.md, 3д; геймдизайн, §9.4): большое окно поверх карты — Гант по помещениям
// производства и линии: прошлое, идущее и прогон по правилам движка. Задание на серию, ещё не начавшее комплектовку,
// тянут мышью или стрелками — призрак показывает, где оно встанет и почему не там, куда тянут; отпустили (Enter) —
// команда `shift`, Esc — отмена. Щелчок по полосе — камера к помещению или линии. Виды собирает поток расчёта
// (src/sim/plan.ts); здесь — слова, рисунок и мышь.
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { HOUR, momentOf } from '../engine/core/calendar';
import type { Bar, Why } from '../engine/plan/schedule';
import { planOf } from '../engine/plant';
import { clock, dayText, durText, named, qtyText, T, whenText } from '../i18n';
import type { BatchLabel, GanttRow, GanttView } from '../sim/plan';
import type { Thing } from '../sim/views';
import { db } from './db';
import { type Actions, type GanttDays, type Hud, holds } from './store';

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
    const c = T.batchCode(...b.code);
    return kase === 'gen' ? T.gantt.batchGen(c) : kase === 'ins' ? T.gantt.batchIns(c) : T.gantt.batch(c);
  }
  return kase === 'gen' ? T.gantt.orderGen(b.n) : kase === 'ins' ? T.gantt.orderIns(b.n) : T.gantt.order(b.n);
}

/** Короткая подпись серии на полосе: номер серии или «задание N». */
const short = (l: Labels, id: string | undefined) => {
  const b = id ? l[id] : undefined;
  return b?.code ? T.batchCode(...b.code) : b ? T.gantt.order(b.n) : '';
};

export function Gantt({ hud, actions, plant }: { hud: Hud; actions: Actions; plant: string }) {
  const g = hud.gantt;
  const v = g.view;
  const start = hud.start;
  const ref = useRef<{ batch: string; x0: number; t0: number; perPx: number; moved: boolean; bar: Bar } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
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
      case 'room':
        return T.gantt.why.room(roomName(w.room), who(labels, w.batch, 'ins'), timeText(w.until));
      case 'clean':
        return w.cause === 'after' ? T.gantt.why.after(roomName(w.room), who(labels, w.batch, 'gen'), durText(w.work)) : w.cause === 'expired' ? T.gantt.why.expired(roomName(w.room), durText(w.work)) : T.gantt.why.product(roomName(w.room), durText(w.work));
      case 'repair':
        return T.gantt.why.repair(roomName(w.room));
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
      case 'setup':
        return `${T.gantt.bar.setup}: ${short(labels, b.batch)}`;
      case 'pack':
        return `${T.gantt.bar.pack}: ${short(labels, b.batch)}`;
    }
  };

  const titleOf = (b: Bar): string => {
    const lines = [barText(b), `${T.gantt.span(whenText(start, b.from), whenText(start, b.to))} · ${T.gantt.when[b.when]}`];
    if (b.kind === 'clean' && b.batch) lines[0] = `${lines[0]} · ${who(labels, b.batch)}`;
    if (b.material) lines.push(T.gantt.material);
    if (b.repair) lines.push(T.gantt.repair);
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
      // щелчок без протяжки — к вещи на полу: окно закрывается, мир остаётся
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
          <span className="gbar k-pack w-past">{T.gantt.bar.pack}</span>
          <span className="gbar k-stage w-past">{T.gantt.when.past}</span>
          <span className="gbar k-stage w-now">{T.gantt.when.now}</span>
          <span className="gbar k-stage w-plan">{T.gantt.when.plan}</span>
          <span className="goff-key">{T.gantt.off}</span>
        </span>
        <span className="muted" data-test="gantt-hint">
          {mine ? T.gantt.hintDrag : T.seats.gantt}
        </span>
        {v.stuck.length > 0 ? <span className="bad">{T.gantt.stuck(v.stuck.map(id => who(labels, id)).join(', '))}</span> : null}
      </div>
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
