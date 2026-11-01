// Данные на полу в окне (Б1и; docs/specs/2026-10-vertical-slice.md, «Б1и», «Б1к»): слои слева — как в геймдизайне
// (§18), окно слоя, цвета частей словами; подсказка с часами частей у столбика под курсором; блок «Загрузка» в карточке
// помещения и машины — те же часы, у линии — OEE с множителями, «Почему?» — минуты остановок по машинам и видам. С Б1к —
// подсказка у таблички «Узких мест» и у значка андона, блок «Узкие места» в карточке помещения, «держит линию» в блоке
// «Загрузка» машины. Виды — «Пол» и «Андон» из потока расчёта (src/sim/floor.ts, src/sim/andon.ts), слова — из src/i18n/.
import type { Ymd } from '../engine/core/calendar';
import { useState } from 'react';
import { colorOf, LAYERS, type Part } from '../app/floor';
import { planOf } from '../engine/plant';
import { durText, hText, named, num, pctText, T, whenText } from '../i18n';
import { ANDON_COLOR, ANDON_PATH, andonInk } from '../render/andonicons';
import { type AndonItem, type AndonKind, type AndonWhy, WEIGHT } from '../sim/andon';
import { type FloorView, type FloorWin, MACHINE_PARTS, ROOM_PHASES, WAIT_WHAT } from '../sim/floor';
import type { Thing } from '../sim/views';
import { assetName, unfitText } from './assets';
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
      {hud.layer === 'bottle' ? (
        <>
          <WinPick win={hud.floor.win} actions={actions} />
          <div className="legend muted" data-test="bottle-legend">
            {T.bottle.legend}
          </div>
        </>
      ) : null}
      {hud.layer === 'andon' ? (
        <ul className="legend" data-test="andon-legend">
          {(['stop', 'attention'] as const).map(w => (
            <li key={w}>
              <span className="sw" style={{ background: hex(ANDON_COLOR[w]) }} />
              {T.andon.weight[w]}
            </li>
          ))}
          <li className="muted">{T.andon.legend}</li>
        </ul>
      ) : null}
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

/**
 * Подсказка у метки слоя под курсором: у столбика — часы каждой части за окно, тех, что есть в столбике и вне его; у
 * таблички «Узких мест» и у значка андона — свои (Б1к).
 */
export function FloorTip({ hud, plant }: { hud: Hud; plant: string }) {
  const h = hud.floor.hover;
  const v = hud.floor.view;
  if (h && hud.layer === 'bottle') return <BottleTip hud={hud} plant={plant} />;
  if (h && hud.layer === 'andon') return <AndonTip hud={hud} plant={plant} />;
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
          {thing.kind === 'machine' ? <HoldsRows v={v} line={line.n} k={thing.k} plant={plant} /> : null}
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

// ---------------------------------------------------------------- узкие места и проблемы (Б1к)

/** Название вещи на полу: помещение — по типу, оборудование и машина — по виду, фура, паллета, техника. */
function thingName(t: Thing, plant: string): string {
  const plan = db ? planOf(db, plant) : undefined;
  switch (t.kind) {
    case 'room': {
      const type = plan?.plant.rooms[t.i]?.type ?? '';
      return T.roomTypes[type] ?? type;
    }
    case 'equipment': {
      const type = plan?.plant.equipment[t.i]?.type ?? '';
      return named(db?.equipment[type]?.name, type);
    }
    case 'machine': {
      const type = plan?.plant.lines[t.line]?.machines[t.k]?.type ?? '';
      return named(db?.machines[type]?.name, type);
    }
    case 'truck':
      return T.place.truck(t.n, t.customer, t.waste);
    case 'unit':
      return T.card.pallet(t.n);
    case 'vehicle':
      return `${t.n}`;
    default:
      return '';
  }
}

/** Часы ожидания у места за окно по словам — по убыванию; ход стадий и линии сюда не входит. */
function waitRows(w: FloorView['waits'][number]): { what: (typeof WAIT_WHAT)[number]; sec: number }[] {
  return WAIT_WHAT.map(k => ({ what: k, sec: w.sec[k] ?? 0 }))
    .filter(r => r.sec > 0)
    .sort((a, b) => b.sec - a.sec);
}

/** Подсказка у таблички «Узких мест»: место по порядку, часы по словам и серии, которые ждут сейчас; у машины — «держит линию». */
function BottleTip({ hud, plant }: { hud: Hud; plant: string }) {
  const h = hud.floor.hover;
  const v = hud.floor.view;
  if (!h || !v || !db) return null;
  const t = h.thing;
  const rank = t.kind === 'room' ? v.waits.filter(x => x.total > 0).findIndex(x => x.i === t.i) : -1;
  return (
    <div className="floortip panel" style={{ left: h.x + 14, top: h.y + 14 }} data-test="bottle-tip">
      <b>{thingName(t, plant)}</b>
      {t.kind === 'room' ? <WaitList v={v} i={t.i} rank={rank >= 0 && rank < 3 ? rank + 1 : undefined} /> : null}
      {t.kind === 'machine' ? <HoldsRows v={v} line={t.line} k={t.k} plant={plant} /> : null}
      <div className="muted">{T.floor.span(T.floor.winOf[v.win], '')}</div>
    </div>
  );
}

/** Ожидание серий у места за окно: строки по словам, всего и кто ждёт сейчас — к досье по щелчку в карточке. */
function WaitList({ v, i, rank, actions }: { v: FloorView; i: number; rank?: number; actions?: Actions }) {
  const w = v.waits.find(x => x.i === i);
  if (!w) return <div className="muted">{T.bottle.none}</div>;
  return (
    <>
      {rank !== undefined ? <div data-test="bottle-rank">{T.bottle.rank(rank)}</div> : null}
      {w.total > 0 ? (
        <ul className="loadrows">
          {waitRows(w).map(r => (
            <li key={r.what} data-test="bottle-row" data-what={r.what} data-sec={r.sec}>
              {T.bottle.row(T.bottle.what[r.what], hText(r.sec))}
            </li>
          ))}
        </ul>
      ) : (
        <div className="muted">{T.bottle.none}</div>
      )}
      {w.total > 0 ? <div>{T.bottle.total(hText(w.total))}</div> : null}
      {w.now.length > 0 ? (
        <>
          <div className="csec">{T.bottle.now}</div>
          <ul className="loadrows">
            {w.now.map(x => (
              <li key={x.bn} data-test="bottle-now">
                {actions ? (
                  <button type="button" className="link" onClick={() => actions.openDossier(x.bn)} title={T.dossier.hint}>
                    {T.bottle.nowRow(x.code, T.bottle.what[x.what])}
                  </button>
                ) : (
                  T.bottle.nowRow(x.code, T.bottle.what[x.what])
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

/** «Держит линию» у машины: её главная потеря за окно; ключевая машина ждала её остановок — какая. */
function HoldsRows({ v, line, k, plant }: { v: FloorView; line: number; k: number; plant: string }) {
  const h = v.lines.find(l => l.n === line)?.holds;
  if (!h || h.k !== k) return null;
  const name = (m: number) => thingName({ kind: 'machine', line, k: m }, plant);
  return (
    <div data-test="holds">
      <div>{T.bottle.holdsTip(name(k))}</div>
      {h.what && h.sec !== undefined ? <div>{T.bottle.holdsLoss(T.bottle.loss[h.what], durText(h.sec))}</div> : null}
      {h.key !== undefined ? <div className="muted">{T.bottle.holdsKey(name(h.key))}</div> : null}
    </div>
  );
}

/** Значок вида андона в панели — тот же, что на полу: круг цвета веса и пиктограмма. */
export function AndonIcon({ kind }: { kind: AndonKind }) {
  const w = WEIGHT[kind];
  return (
    <svg className="sicon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" data-andon={kind}>
      <circle cx="7" cy="7" r="6.6" fill={hex(ANDON_COLOR[w])} />
      <path d={ANDON_PATH[kind]} fill="none" stroke={hex(andonInk(w))} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Что именно не работает: подробность словами — узел, актив, задача и документ, серия и материалы, заказ, фура. */
export function whyText(why: AndonWhy, thing: Thing, plant: string, start: Ymd): string {
  const plan = db ? planOf(db, plant) : undefined;
  const parts: string[] = [];
  if (why.part) {
    const rec = thing.kind === 'equipment' ? db?.equipment[plan?.plant.equipment[thing.i]?.type ?? ''] : thing.kind === 'machine' ? db?.machines[plan?.plant.lines[thing.line]?.machines[thing.k]?.type ?? ''] : undefined;
    parts.push(T.andon.part(named(rec?.parts.find(p => p.id === why.part)?.name, why.part)));
  }
  if (why.asset) parts.push(`${assetName(why.asset)}: ${unfitText(why.asset)}`);
  if (why.kind === 'clean' && why.batch) parts.push(T.andon.clean(why.batch));
  else {
    if (why.task) parts.push(T.andon.task(T.tasks[why.task] ?? why.task));
    if (why.lack) parts.push(T.andon.lack(why.lack));
    if (why.batch) parts.push(T.andon.batch(why.batch));
  }
  if (why.short && why.short.length > 0) parts.push(T.andon.short(why.short.map(m => named(db?.materials[m]?.name, m)).join(', ')));
  if (why.po) parts.push(T.andon.po(why.po, named(db?.suppliers[why.supplier ?? '']?.name, why.supplier ?? '')));
  if (why.order) parts.push(T.andon.order(why.order, named(db?.customers[why.customer ?? '']?.name, why.customer ?? ''), whenText(start, why.due ?? 0), num(why.missing ?? 0)));
  if (why.since !== undefined) parts.push(T.andon.since(whenText(start, why.since)));
  return parts.join(' · ');
}

/** Строки проблем вещи: значок, слово и что именно — по тяжести. */
export function AndonRows({ item, plant, start }: { item: AndonItem; plant: string; start: Ymd }) {
  return (
    <ul className="loadrows">
      {item.why.map((w, n) => (
        <li key={n} data-test="andon-row" data-kind={w.kind}>
          <AndonIcon kind={w.kind} />
          <span>
            <b>{T.andon.word[w.kind]}</b>
            {(() => {
              const d = whyText(w, item.thing, plant, start);
              return d ? ` — ${d}` : '';
            })()}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Подсказка у значка андона: вещь и все её проблемы — что именно и с какого мгновения. */
function AndonTip({ hud, plant }: { hud: Hud; plant: string }) {
  const h = hud.floor.hover;
  const v = hud.andon.view;
  if (!h || !v) return null;
  const item = v.items.find(x => JSON.stringify(x.thing) === JSON.stringify(h.thing));
  if (!item) return null;
  return (
    <div className="floortip panel" style={{ left: h.x + 14, top: h.y + 14 }} data-test="andon-tip">
      <b>{thingName(item.thing, plant)}</b>
      <AndonRows item={item} plant={plant} start={hud.start} />
    </div>
  );
}

/**
 * Блок «Узкие места» в карточке помещения (Б1к): часы ожидания серий у места за окно слоя по словам и серии, которые ждут
 * у него сейчас, — к их досье.
 */
export function BottleBlock({ hud, thing, actions }: { hud: Hud; thing: Thing; actions: Actions }) {
  const v = hud.floor.view;
  if (!v || thing.kind !== 'room') return null;
  const w = v.waits.find(x => x.i === thing.i);
  const rank = v.waits.filter(x => x.total > 0).findIndex(x => x.i === thing.i);
  return (
    <div data-test="card-bottle">
      <div className="csec">
        {T.bottle.title} · {T.floor.winOf[v.win]} <WinPick win={hud.floor.win} actions={actions} />
      </div>
      {w ? <WaitList v={v} i={thing.i} rank={rank >= 0 && rank < 3 ? rank + 1 : undefined} actions={actions} /> : <div className="muted">{T.bottle.none}</div>}
    </div>
  );
}
