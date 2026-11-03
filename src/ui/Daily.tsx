// Сменно-суточные задания в окне (Б6б; docs/specs/2026-10-vertical-slice.md, «Б6б»): блок планёрки — вчера по отделам
// «сделано 9 из 11, в срок 7; позже 1; не сделано 1 — ждали ОКК, 6 ч» и сегодня — сколько строк и первые по времени;
// строка отдела раскрывается до строк задания; рычаги — окно отдела. Строки суток вещи — в её карточке. Вид собран в
// потоке расчёта (src/sim/daily.ts) — истины в нём нет; здесь — слова.
import { useState } from 'react';
import { dailyLevers } from '../app/levers';
import type { Dept } from '../content/types';
import type { Ymd } from '../engine/core/calendar';
import { planOf } from '../engine/plant';
import { hText, named, T, whenText } from '../i18n';
import type { DailyDeptSum, DailyMeeting, DailyRowView } from '../sim/daily';
import { db } from './db';
import { Levers } from './Levers';
import type { Actions, Hud } from './store';

/** Что за строка: вещь и место словами. */
export function rowText(r: DailyRowView, plant: string): string {
  const plan = db ? planOf(db, plant) : undefined;
  const code = r.code ?? (r.batch ? T.jobs.order(Number(r.batch.slice(1))) : '');
  const room = (id?: string) => {
    const type = id ? plan?.plant.rooms.find(x => x.id === id)?.type : undefined;
    return type ? (T.roomTypes[type] ?? type) : (id ?? '');
  };
  const line = (id?: string) => T.gantt.line((plan?.plant.lines.findIndex(l => l.id === id) ?? -1) + 1);
  switch (r.kind) {
    case 'kit':
      return r.pack ? T.daily.kind.kitPack(code) : T.daily.kind.kit(code);
    case 'stage':
      return T.daily.kind.stage(T.stages[r.stage ?? ''] ?? r.stage ?? '', code, room(r.room));
    case 'pack':
      return T.daily.kind.pack(code, line(r.line));
    case 'ship':
      return T.daily.kind.ship(r.customer ? named(db?.customers[r.customer]?.name, r.customer) : (r.order ?? ''));
    case 'truck':
      return T.daily.kind.truck(r.supplier ? named(db?.suppliers[r.supplier]?.name, r.supplier) : (r.po ?? ''));
    case 'test':
      return T.daily.kind.test(r.method ? named(db?.tests[r.method]?.name, r.method) : (r.test ?? ''), r.lot ?? '');
    case 'repair':
      return T.daily.kind.repair(r.machine ?? r.part ?? '');
    case 'visit':
      return T.daily.kind.visit(r.asset ?? '');
    case 'release':
      return T.daily.kind.release(code);
    case 'assess':
      return T.daily.kind.assess(r.dev ? T.dev.no(Number(r.dev.slice(1))) : '');
  }
}

/** Итог строки словами: в срок; позже — когда начато; не сделано — чего ждали; начато после суток — когда. */
export function resText(r: DailyRowView, start: Ymd): string {
  const parts: string[] = [T.daily.plan(whenText(start, r.at))];
  if (r.res) parts.push(T.daily.res[r.res] ?? r.res);
  if (r.done !== undefined && r.res !== 'ok') parts.push(T.daily.started(whenText(start, r.done)));
  if (r.res && r.res !== 'ok' && r.why) parts.push(T.daily.why(r.waited ? T.daily.who[r.waited] : (T.daily.what[r.why] ?? r.why)));
  if (r.after !== undefined) parts.push(T.daily.after(whenText(start, r.after)));
  if (!r.res && r.done !== undefined) parts.push(T.daily.started(whenText(start, r.done)));
  return parts.join(' · ');
}

/** Итог отдела: «сделано 9 из 11, в срок 7; позже 1; не сделано 1 — ждали ОКК, 6 ч». */
export function sumText(x: DailyDeptSum): string {
  const parts = [T.daily.sum(x.done, x.n, x.ok)];
  if (x.late > 0) parts.push(T.daily.late(x.late));
  if (x.no > 0) parts.push(T.daily.no(x.no));
  const main = x.main ? T.daily.waited(x.main.who === 'own' ? (T.daily.what[x.main.why] ?? x.main.why) : T.daily.who[x.main.who], hText(x.main.sec)) : '';
  return `${parts.join('; ')}${main ? ` — ${main}` : ''}`;
}

/** Строки отдела списком. */
function Rows({ rows, plant, start }: { rows: DailyRowView[]; plant: string; start: Ymd }) {
  return (
    <ul className="mlist daily-rows" data-test="daily-rows">
      {rows.map((r, i) => (
        <li key={i} className={r.res === 'no' ? 'bad' : r.res === 'late' ? 'warn' : undefined} data-test="daily-row" data-kind={r.kind} data-res={r.res ?? ''}>
          {rowText(r, plant)} <span className="muted">— {resText(r, start)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Блок планёрки «Сменно-суточные задания». */
export function DailyMeet({ d, plant, start, hud, actions, close }: { d: DailyMeeting; plant: string; start: Ymd; hud: Hud; actions: Actions; close: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const dept = (x: Dept) => T.morning.depts[x] ?? x;
  const toggle = (k: string) => setOpen(open === k ? null : k);
  if (!d.yday && !d.today) return <div className="muted" data-test="morning-daily">{T.daily.none}</div>;
  return (
    <div className="mblock" data-test="morning-daily">
      {d.yday ? (
        <>
          <div className="mhead">{T.daily.yday}</div>
          <ul className="mlist">
            {d.yday.depts.map(x => {
              const rows = d.yday!.rows.filter(r => r.dept === x.dept);
              const thing = rows.find(r => r.res !== 'ok' && r.thing)?.thing ?? rows.find(r => r.thing)?.thing;
              return (
                <li key={x.dept} className={x.no > 0 ? 'bad' : x.late > 0 ? 'warn' : undefined} data-test="daily-yday" data-dept={x.dept}>
                  <b>{dept(x.dept)}</b>: {sumText(x)}{' '}
                  <button type="button" className="link" onClick={() => toggle(`y/${x.dept}`)} data-test="daily-open">
                    {open === `y/${x.dept}` ? T.daily.hide : T.daily.rows}
                  </button>
                  {open === `y/${x.dept}` ? <Rows rows={rows} plant={plant} start={start} /> : null}
                  <Levers list={dailyLevers(x.dept, thing)} hud={hud} actions={actions} close={close} />
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {d.today ? (
        <>
          <div className="mhead">{T.daily.today}</div>
          <ul className="mlist">
            {d.today.depts.map(x => {
              const rows = d.today!.rows.filter(r => r.dept === x.dept);
              return (
                <li key={x.dept} data-test="daily-today" data-dept={x.dept}>
                  <b>{dept(x.dept)}</b>: {T.daily.count(x.n)}
                  {rows.length > 0 ? (
                    <span className="muted">
                      {' '}
                      — {T.daily.first}: {rows
                        .slice(0, 2)
                        .map(r => `${rowText(r, plant)} ${whenText(start, r.at).split(' ').at(-1)}`)
                        .join('; ')}
                    </span>
                  ) : null}{' '}
                  <button type="button" className="link" onClick={() => toggle(`t/${x.dept}`)} data-test="daily-open">
                    {open === `t/${x.dept}` ? T.daily.hide : T.daily.rows}
                  </button>
                  {open === `t/${x.dept}` ? <Rows rows={rows} plant={plant} start={start} /> : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** Строки задания на сутки у вещи карточки: помещения, линии, прибора. */
export function DailyCard({ rows, plant, start }: { rows: DailyRowView[]; plant: string; start: Ymd }) {
  if (rows.length === 0) return null;
  return (
    <div className="csec" data-test="card-daily">
      <div className="mhead">{T.daily.card}</div>
      <Rows rows={rows} plant={plant} start={start} />
    </div>
  );
}
