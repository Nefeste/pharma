// Данные на полу в окне (Б1и; docs/specs/2026-10-vertical-slice.md, «Б1и»): слои слева — как в геймдизайне (§18), окно
// слоя, цвета частей словами; подсказка с часами частей у столбика под курсором; блок «Загрузка» в карточке помещения и
// машины — те же часы, у линии — OEE с множителями, «Почему?» — минуты остановок по машинам и видам. Вид — «Пол» из потока
// расчёта (src/sim/floor.ts), слова — из src/i18n/.
import { useState } from 'react';
import { colorOf, LAYERS, type Part } from '../app/floor';
import { planOf } from '../engine/plant';
import { durText, named, pctText, T } from '../i18n';
import { type FloorView, type FloorWin, MACHINE_PARTS, ROOM_PHASES } from '../sim/floor';
import type { Thing } from '../sim/views';
import { db } from './db';
import type { Actions, Hud } from './store';

const WINS: readonly FloorWin[] = ['today', 'yesterday', 'week'];
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const share = (sec: number, span: number) => (span > 0 ? Math.round((sec * 10000) / span) : 0);

/** Слои слева: обычный вид, «Загрузка и OEE», «Потоки — люди»; у слоя данных — окно и цвета частей словами. */
export function Layers({ hud, actions }: { hud: Hud; actions: Actions }) {
  return (
    <div className="layers panel" data-test="layers" title={T.floor.hint}>
      <div className="lhead">{T.floor.layers}</div>
      {LAYERS.map(l => (
        <button key={l} type="button" className={hud.layer === l ? 'on' : ''} onClick={() => actions.setLayer(l)} data-test={`layer-${l}`}>
          {T.floor.layer[l]}
        </button>
      ))}
      {hud.layer === 'load' ? (
        <>
          <WinPick win={hud.floor.win} actions={actions} />
          <ul className="legend" data-test="floor-legend">
            {(['run', 'slow', 'micro', 'fail', 'wait', 'setup'] as const).map(p => (
              <li key={p}>
                <span className="sw" style={{ background: hex(colorOf(p)) }} />
                {p === 'run' ? `${T.floor.part.work}, ${T.floor.part.run}` : p === 'wait' ? `${T.floor.part.held}, ${T.floor.part.wait}` : p === 'setup' ? T.floor.part.clean : T.floor.part[p]}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function WinPick({ win, actions }: { win: FloorWin; actions: Actions }) {
  return (
    <span className="lwin">
      {WINS.map(w => (
        <button key={w} type="button" className={win === w ? 'on' : ''} onClick={() => actions.setFloorWin(w)} data-test={`floor-win-${w}`}>
          {T.floor.win[w]}
        </button>
      ))}
    </span>
  );
}

/** Строки частей вещи: что, сколько, доля окна; у машины — и время без задания. */
interface Rows {
  title: string;
  rows: { part: Part | 'dirty' | 'free' | 'none'; sec: number }[];
  span: number;
}

/** Помещение или машина вида — строками; вещи в виде нет — `undefined`. */
function rowsOf(v: FloorView, t: Thing, plant: string): Rows | undefined {
  const plan = db ? planOf(db, plant) : undefined;
  if (t.kind === 'room') {
    const r = v.rooms.find(x => x.i === t.i);
    if (!r) return undefined;
    const type = plan?.plant.rooms[t.i]?.type ?? '';
    return { title: T.roomTypes[type] ?? type, rows: ROOM_PHASES.map(p => ({ part: p, sec: r.times[p] })), span: v.span };
  }
  if (t.kind === 'machine') {
    const m = v.lines.find(x => x.n === t.line)?.machines[t.k];
    if (!m) return undefined;
    const type = plan?.plant.lines[t.line]?.machines[t.k]?.type ?? '';
    const load = MACHINE_PARTS.reduce((n, p) => n + m[p], 0);
    return { title: named(db?.machines[type]?.name, type), rows: [...MACHINE_PARTS.map(p => ({ part: p as Part, sec: m[p] })), { part: 'none' as const, sec: Math.max(0, v.span - load) }], span: v.span };
  }
  return undefined;
}

const rowText = (part: Rows['rows'][number]['part'], sec: number, span: number) =>
  part === 'none' ? T.floor.noJob(durText(sec)) : T.floor.row(T.floor.part[part], durText(sec), pctText(share(sec, span)));

/** Подсказка у столбика под курсором: часы каждой части за окно — тех, что есть в столбике и вне его. */
export function FloorTip({ hud, plant }: { hud: Hud; plant: string }) {
  const h = hud.floor.hover;
  const v = hud.floor.view;
  if (!h || !v || hud.layer !== 'load') return null;
  const x = rowsOf(v, h.thing, plant);
  if (!x) return null;
  return (
    <div className="floortip panel" style={{ left: h.x + 14, top: h.y + 14 }} data-test="floor-tip">
      <b>{x.title}</b>
      <ul>
        {x.rows.filter(r => r.sec > 0).map(r => (
          <li key={r.part} data-test="floor-tip-row">
            <span className="sw" style={{ background: r.part === 'dirty' || r.part === 'free' || r.part === 'none' ? 'transparent' : hex(colorOf(r.part)) }} />
            {rowText(r.part, r.sec, x.span)}
          </li>
        ))}
      </ul>
      <div className="muted">{T.floor.span(T.floor.winOf[v.win], durText(x.span))}</div>
    </div>
  );
}

/**
 * Блок «Загрузка» в карточке помещения или машины (Б1и): часы по состояниям за окно слоя; у помещения — серия, которая его
 * держала; у машины линии — OEE линии с множителями по ключевой машине и «Почему?»: минуты остановок по машинам и видам.
 */
export function LoadBlock({ hud, thing, plant, actions }: { hud: Hud; thing: Thing; plant: string; actions: Actions }) {
  const [why, setWhy] = useState(false);
  const v = hud.floor.view;
  if (!v) return null;
  const x = rowsOf(v, thing, plant);
  if (!x) return null;
  const room = thing.kind === 'room' ? v.rooms.find(r => r.i === thing.i) : undefined;
  const line = thing.kind === 'machine' ? v.lines.find(l => l.n === thing.line) : undefined;
  const plan = db ? planOf(db, plant) : undefined;
  const machineName = (k: number) => {
    const type = line ? plan?.plant.lines[line.n]?.machines[k]?.type ?? '' : '';
    return named(db?.machines[type]?.name, type);
  };
  const o = line?.sum.oee;
  return (
    <div data-test="card-load">
      <div className="csec">
        {T.floor.load} · {T.floor.winOf[v.win]} <WinPick win={hud.floor.win} actions={actions} />
      </div>
      {x.span === 0 ? (
        <div className="muted">{T.floor.noData}</div>
      ) : (
        <ul className="loadrows">
          {x.rows.map(r => (
            <li key={r.part} data-test="card-load-row" data-part={r.part} data-sec={r.sec}>
              <span className="sw" style={{ background: r.part === 'dirty' || r.part === 'free' || r.part === 'none' ? 'transparent' : hex(colorOf(r.part)) }} />
              {rowText(r.part, r.sec, x.span)}
              {r.part === 'held' && r.sec > 0 && room?.bn !== undefined ? (
                <>
                  {' '}
                  <button type="button" className="link" onClick={() => actions.openDossier(room.bn!)} title={T.dossier.hint} data-test="card-load-held">
                    {T.floor.held(room.code ?? '')}
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {o && line ? (
        <>
          <div data-test="card-load-oee">
            {T.floor.oee(pctText(o.oee), pctText(o.a), pctText(o.p), pctText(o.q))}{' '}
            <button type="button" className="link" onClick={() => setWhy(!why)} data-test="card-load-why">
              {T.floor.why}
            </button>
          </div>
          <div className="muted">
            {T.floor.key}: {machineName(line.sum.key ?? 0)}
          </div>
          {why ? (
            <ul className="loadrows" data-test="card-load-stops">
              {line.machines.map((m, k) => {
                const parts = (['micro', 'fail', 'wait', 'setup', 'slow'] as const).filter(p => m[p] > 0);
                return (
                  <li key={k}>
                    {T.floor.stop(machineName(k), parts.length > 0 ? parts.map(p => `${T.floor.part[p]} ${durText(m[p])}`).join(' · ') : T.floor.nothingStopped)}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
