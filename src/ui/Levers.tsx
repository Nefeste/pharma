// Рычаги (Б1г; docs/specs/2026-10-vertical-slice.md, «Б1г»): у строки — кнопки решений и словами, что они изменят.
// Решение чужого поста — кнопка гаснет, рядом подпись, чей он; то, чего в игре ещё нет, — строка «Будет в …». Какие
// рычаги у строки — решают чистые функции src/app/levers.ts; здесь — слова и щелчок.
import type { Lever } from '../app/levers';
import { named, T } from '../i18n';
import { db } from './db';
import { type Actions, holds, type Hud } from './store';

/** Кнопка и что она изменит. */
function words(l: Exclude<Lever, { k: 'later' }>): [string, string] {
  switch (l.k) {
    case 'gantt':
      return [T.levers.gantt, T.levers.ganttWhat];
    case 'lab':
      return [T.levers.lab, T.levers.labWhat];
    case 'overtime':
      return [T.levers.overtime, l.on ? T.levers.overtimeOn(T.morning.depts[l.dept]) : T.levers.overtimeWhat(T.morning.depts[l.dept])];
    case 'flows':
      return [T.levers.flows, T.levers.flowsWhat];
    case 'ref':
      return [T.levers.ref[l.tab], T.levers.refWhat[l.tab]];
    case 'urgent':
      return [T.levers.urgent(named(db?.skus[l.sku]?.name, l.sku)), T.levers.urgentWhat];
    case 'batch':
      return [T.levers.batch(l.code), T.levers.batchWhat];
    case 'dev':
      return [T.levers.dev(T.dev.no(l.n)), T.levers.devWhat];
    case 'inv':
      return [T.levers.inv, T.levers.invWhat];
    case 'staff':
      return [T.levers.staff, T.levers.staffWhat];
    case 'leave':
      return [T.levers.leave, T.levers.leaveWhat];
    case 'person':
      return [T.levers.person(T.card.person(named(db?.roles[l.role]?.name, l.role), l.tab)), T.levers.personWhat];
    case 'journal':
      return [T.levers.journal, T.levers.journalWhat];
  }
}

/** Щелчок: команда или окно. */
function run(l: Lever, hud: Hud, actions: Actions) {
  switch (l.k) {
    case 'gantt':
      if (!hud.gantt.open) actions.toggleGantt();
      return;
    case 'lab':
      if (!hud.lab.open) actions.toggleLab();
      return;
    case 'overtime':
      actions.overtime(l.dept, 'need');
      return;
    case 'flows':
      actions.toggleFlows();
      return;
    case 'ref':
      if (!hud.ref.open) actions.toggleRef();
      actions.setRefTab(l.tab);
      return;
    case 'urgent':
      actions.urgent(l.recipe, l.sku);
      return;
    case 'batch':
      actions.show({ kind: 'unit', n: l.unit });
      return;
    case 'dev':
      actions.select({ kind: 'dev', n: l.n });
      return;
    case 'inv':
      actions.openInv(l.id);
      return;
    case 'staff':
    case 'leave':
      if (!hud.ref.open) actions.toggleRef();
      actions.setRefTab('people');
      return;
    case 'person':
      actions.show({ kind: 'person', n: l.n });
      return;
    case 'journal':
      actions.openJournal(l.n);
      return;
    case 'later':
      return;
  }
}

/** Рычаги строки; `close` — закрыть панель, из которой щёлкнули, раньше, чем откроется другая. */
export function Levers({ list, hud, actions, close }: { list: readonly Lever[]; hud: Hud; actions: Actions; close?: () => void }) {
  if (list.length === 0) return null;
  return (
    <div className="levers" data-test="levers">
      {list.map((l, i) => {
        if (l.k === 'later') {
          return (
            <div key={i} className="lever muted" data-test="lever-later">
              {T.levers.later[l.what]}
            </div>
          );
        }
        const seat = 'seat' in l ? l.seat : undefined;
        const mine = !seat || holds(hud, seat);
        // политика уже такая — нажимать нечего
        const done = l.k === 'overtime' && l.on;
        const [label, what] = words(l);
        return (
          <div key={i} className="lever" data-test={`lever-${l.k}`}>
            <button
              type="button"
              disabled={!mine || done}
              onClick={() => {
                close?.();
                run(l, hud, actions);
              }}
            >
              {label}
            </button>
            <span className="muted"> — {what}</span>
            {!mine && seat ? <span className="warn"> · {T.levers.seat(T.seats.names[seat] ?? seat)}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
