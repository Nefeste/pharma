// Рычаги (Б1г; docs/specs/2026-10-vertical-slice.md, «Б1г»): у строки — кнопки решений и словами, что они изменят.
// Решение чужого поста — кнопка гаснет, рядом подпись, чей он; то, чего в игре ещё нет, — строка «Будет в …». Какие
// рычаги у строки — решают чистые функции src/app/levers.ts; здесь — слова и щелчок.
import type { Lever } from '../app/levers';
import { named, T } from '../i18n';
import { db } from './db';
import { actLabel, actOf } from './memo';
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
    case 'jobs':
      return [T.levers.jobs, T.levers.jobsWhat];
    case 'kpi':
      return [T.levers.kpi, T.levers.kpiWhat];
    case 'waste':
      return [T.levers.waste, T.levers.wasteWhat];
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
    case 'jobs':
      // вкладка «Задания» (Б6а): сначала вкладка, потом окно — оно откроется на ней
      actions.ganttTab('jobs');
      if (!hud.gantt.open) actions.toggleGantt();
      return;
    case 'kpi':
      actions.openKpi(l.month);
      return;
    case 'waste':
      // чужой пост (Б5д) — записка заведующему складом
      if (holds(hud, l.seat)) actions.waste();
      else actions.memo([{ kind: 'waste' }]);
      return;
    case 'later':
      return;
  }
}

/**
 * Рычаги, которые с чужого поста ведут к записке (Б5д): окна, где у кнопок команд — «Записка», и сама команда вывоза;
 * решения ООК и уполномоченного лица, политика сверхурочных — нет.
 */
const MEMO_LEVERS: ReadonlySet<Lever['k']> = new Set(['gantt', 'lab', 'urgent', 'staff', 'leave', 'person', 'waste']);

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
        // чужой пост (Б5д): окно с «Записками» у кнопок или записка заведующему складом
        const memo = !mine && hud.top?.seats !== undefined && MEMO_LEVERS.has(l.k);
        const act = l.k === 'waste' && seat ? actOf(hud, seat, { kind: 'waste' }) : undefined;
        // политика уже такая — нажимать нечего
        const done = l.k === 'overtime' && l.on;
        const [label, what] = words(l);
        return (
          <div key={i} className="lever" data-test={`lever-${l.k}`} {...(memo ? { 'data-memo': '1' } : {})}>
            <button
              type="button"
              disabled={(!mine && !memo) || done}
              onClick={() => {
                close?.();
                run(l, hud, actions);
              }}
              title={act && !act.mine ? act.title : undefined}
            >
              {act ? actLabel(act, label) : label}
            </button>
            <span className="muted"> — {what}</span>
            {!mine && seat ? <span className="warn"> · {memo ? (act?.title ?? T.levers.memo) : T.levers.seat(T.seats.names[seat] ?? seat)}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
