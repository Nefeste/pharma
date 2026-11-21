// «Найти» (Б13, шаг 4; docs/specs/2026-10-vertical-slice.md, «Б13. Доступность и настройки»): Ctrl+F — поле и найденное;
// Enter в поле — первое, Tab и Enter или пробел — любое: вещь — карточка и камера на ней, серия — её досье. Что искать
// и в каких записях — поток (src/sim/find.ts); названия — окно.
import { named, T } from '../i18n';
import type { FindRow } from '../sim/find';
import { db } from './db';
import { press } from './press';
import type { Actions, Hud } from './store';

/** Строка найденного словами: что это и его код. */
export function findText(r: FindRow): string {
  switch (r.kind) {
    case 'room':
      return `${(T.roomTypes as Record<string, string>)[r.type] ?? r.type} · ${r.code}`;
    case 'equipment':
      return `${named(db?.equipment[r.type]?.name, r.type)} · ${r.code}`;
    case 'machine':
      return `${named(db?.machines[r.type]?.name, r.type)} · ${r.code}`;
    case 'person':
      return T.find.person(named(db?.roles[r.role]?.name, r.role), r.tab);
    case 'unit':
      return r.lot && r.material ? T.find.unit(r.code, named(db?.materials[r.material]?.name, r.material), T.lotCode(r.lot.y, r.lot.m, r.lot.n)) : r.code;
    case 'batch':
      return T.find.batch(r.code, named(db?.products[r.product]?.name, r.product));
  }
}

export function Find({ hud, actions }: { hud: Hud; actions: Actions }) {
  const f = hud.find;
  const rows = f.view?.text === f.text ? f.view.rows : [];
  const open = (r: FindRow) => {
    if (r.kind === 'batch') actions.openDossier(r.batch);
    else actions.show(r.thing);
    actions.toggleFind();
  };
  return (
    <div className="find panel" role="dialog" aria-labelledby="find-title" data-test="find">
      <div className="phead">
        <b id="find-title">{T.find.title}</b>
        <button type="button" className="close" onClick={() => actions.toggleFind()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      <input
        type="search"
        autoFocus
        value={f.text}
        placeholder={T.find.hint}
        aria-label={T.find.hint}
        onChange={e => actions.findText(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && rows[0]) open(rows[0]);
        }}
        data-test="find-input"
      />
      {f.text.trim() && f.view?.text === f.text && rows.length === 0 ? <p className="muted small">{T.find.none}</p> : null}
      <ul className="frows">
        {rows.map((r, i) => (
          <li key={i} className="go" {...press(() => open(r))} data-test="find-row" data-kind={r.kind}>
            <span className="muted small">{T.find.kinds[r.kind]}</span> {findText(r)}
          </li>
        ))}
      </ul>
      {f.view?.more ? <p className="muted small">{T.find.more}</p> : null}
    </div>
  );
}
