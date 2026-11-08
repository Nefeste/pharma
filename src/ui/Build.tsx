// Панель стройки (Б7б; docs/specs/2026-10-vertical-slice.md, «Окно»; геймдизайн, §3.3): слева, на месте слоёв — как у
// «Больницы» (`Nefeste/bolnitsa` @ e804637, src/ui/App.tsx, `Builder`): инструменты — помещение по типу и классу, корпус,
// дверь по виду, зона по виду, стеллаж, проезд, снос; «Отменить» с числом шагов, «Готово», потрачено на стройку; строка
// призрака — что, размер, цена, «нельзя: …», «не будет работать: …» или «замечание: …»; строка ответа движка; клавиши.
import { BUILD_DOORS, BUILD_TOOLS } from '../app/buildpick';
import { BUILD_ZONES } from '../engine/site/edit';
import { classRec } from '../engine/site/units';
import { money, named, T } from '../i18n';
import type { BuildPick } from '../app/buildpick';
import { db } from './db';
import type { Actions, Hud } from './store';

/** Кнопка «Стройка» над слоями: место директора — иначе погашена. */
export function BuildButton({ hud, actions, can }: { hud: Hud; actions: Actions; can: boolean }) {
  return (
    <button type="button" data-test="build" className={hud.build.on ? 'on' : ''} disabled={!can} onClick={actions.toggleBuild} title={can ? `${T.build.title} (B)` : T.build.director}>
      {T.build.button} (B)
    </button>
  );
}

export function Build({ hud, actions }: { hud: Hud; actions: Actions }) {
  const b = hud.build;
  const p = b.pick;
  const types = Object.values(db?.rooms ?? {}).filter(t => t.build);
  const type = p.type ? db?.rooms[p.type] : undefined;
  return (
    <div className="layers build panel" data-test="build-panel">
      <div className="lhead">{T.build.title}</div>
      <div className="row">
        {BUILD_TOOLS.map(t => (
          <button key={t} type="button" className={p.tool === t ? 'on' : ''} data-test={`tool-${t}`} onClick={() => actions.buildPick({ tool: p.tool === t ? undefined : t })}>
            {T.build.tools[t]}
          </button>
        ))}
      </div>
      {p.tool === 'room' ? (
        <>
          <select data-test="room-type" value={p.type ?? ''} onChange={e => actions.buildPick({ type: e.target.value || undefined })}>
            <option value="">—</option>
            {types.map(t => (
              <option key={t.type} value={t.type}>
                {T.roomTypes[t.type] ?? t.type}
              </option>
            ))}
          </select>
          {type ? (
            <div className="row">
              {type.grades.map(g => (
                <button key={g} type="button" className={p.grade === g ? 'on' : ''} data-test={`grade-${g}`} onClick={() => actions.buildPick({ grade: g })}>
                  {T.grade[g]}
                </button>
              ))}
              {type.vehicles ? (
                <label>
                  <input type="checkbox" checked={p.vehicles} data-test="room-vehicles" onChange={e => actions.buildPick({ vehicles: e.target.checked })} /> {T.build.vehicles}
                </label>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      {p.tool === 'door' ? (
        <>
          <div className="row">
            {BUILD_DOORS.map(k => (
              <button key={k} type="button" className={p.door === k ? 'on' : ''} data-test={`door-${k}`} onClick={() => actions.buildPick({ door: k })}>
                {T.build.doors[k]}
              </button>
            ))}
          </div>
          {p.door === 'gate' ? (
            <label>
              {T.build.gate}{' '}
              <input type="number" min={2} max={4} value={p.gate} data-test="gate" onChange={e => actions.buildPick({ gate: Math.max(2, Math.min(4, Number(e.target.value) || 2)) })} />
            </label>
          ) : null}
          <label>
            <input type="checkbox" checked={p.materials} data-test="door-materials" onChange={e => actions.buildPick({ materials: e.target.checked })} /> {T.build.materials}
          </label>
        </>
      ) : null}
      {p.tool === 'zone' ? (
        <select data-test="zone-kind" value={p.zone} onChange={e => actions.buildPick({ zone: e.target.value as typeof p.zone })}>
          {BUILD_ZONES.map(z => (
            <option key={z} value={z}>
              {T.zones[z]}
            </option>
          ))}
        </select>
      ) : null}
      {p.tool === 'rack' ? (
        <div className="row">
          <label>
            {T.build.bays} <input type="number" min={1} max={30} value={p.bays} data-test="rack-bays" onChange={e => actions.buildPick({ bays: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} />
          </label>
          <label>
            {T.build.levels} <input type="number" min={1} max={6} value={p.levels} data-test="rack-levels" onChange={e => actions.buildPick({ levels: Math.max(1, Math.min(6, Number(e.target.value) || 1)) })} />
          </label>
          <button type="button" data-test="rack-face" onClick={() => actions.buildPick({ face: p.face === 'n' ? 's' : 'n' })} title="R">
            {T.build.face[p.face]}
          </button>
        </div>
      ) : null}
      {p.tool === 'unit' ? <Units p={p} actions={actions} /> : null}
      {b.ghost ? (
        <div className={`ghost${b.ghost.ok ? (b.ghost.warn ? ' warn' : '') : ' bad'}`} data-test="build-ghost">
          {b.ghost.text}
        </div>
      ) : null}
      {b.result ? (
        <div className={b.result.ok ? 'muted' : 'bad'} data-test="build-result">
          {b.result.text}
        </div>
      ) : null}
      <div className="row">
        <button type="button" data-test="build-undo" disabled={b.undo === 0} onClick={actions.buildUndo} title="Ctrl+Z">
          {T.build.undo(b.undo)}
        </button>
        <button type="button" data-test="build-done" disabled={b.editing === undefined} onClick={actions.buildDone}>
          {T.build.done}
        </button>
        <button type="button" className="close" data-test="build-off" onClick={actions.toggleBuild} title="B">
          ✕
        </button>
      </div>
      <div className="muted" data-test="build-spent">
        {T.build.spent}: <b>{money(b.spent)}</b>
      </div>
      <div className="keys">{T.build.keys}</div>
    </div>
  );
}

/**
 * Оборудование (Б7в): класс — из тех, что ставят в строящиеся помещения каталога; поставщик — цена, срок поставки,
 * отказы и день инженера; переносимая единица — строка «Перенести: …».
 */
function Units({ p, actions }: { p: BuildPick; actions: Actions }) {
  const classes = [...new Set(Object.values(db?.rooms ?? {}).flatMap(t => t.things ?? []))];
  const cls = p.cls && db ? classRec(db, p.cls) : undefined;
  return (
    <>
      {p.moving ? <div className="muted" data-test="unit-moving">{T.equip.move(p.moving)}</div> : null}
      <select data-test="unit-class" value={p.cls ?? ''} onChange={e => actions.buildPick({ cls: e.target.value || undefined })} title={T.equip.pick}>
        <option value="">—</option>
        {classes.map(c => (
          <option key={c} value={c}>
            {named(db && classRec(db, c)?.name, c)}
          </option>
        ))}
      </select>
      {Object.values(db?.vendors ?? {}).map(v => (
        <button key={v.id} type="button" className={p.vendor === v.id ? 'on' : ''} data-test={`vendor-${v.region}`} onClick={() => actions.buildPick({ vendor: v.id })} title={T.equip.vendor}>
          {named(v.name, v.id)}
          {cls ? <div className="muted">{T.equip.offer(money(Math.floor((cls.price * v.price) / 100)), T.equip.lead(v.lead[0], v.lead[1]), T.equip.hazard(v.hazard), money(v.engineer))}</div> : null}
        </button>
      ))}
    </>
  );
}
