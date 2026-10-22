// «Сейчас» (этап Б, Б1б; docs/specs/2026-10-vertical-slice.md): панель справа — что идёт на заводе одним списком, по
// разделам: что, где, кто, сколько прошло и сколько по норме. Щелчок по строке — камера к месту работы и её карточка;
// «Смотреть» — туда же и ×1, пока работа не кончится. Вид собирает поток расчёта (src/sim/now.ts), сколько прошло —
// окно по своим часам.
import { momentOf, type Ymd } from '../engine/core/calendar';
import { clock, durText, named, num, T, whenText } from '../i18n';
import { NOW_DEPTS, type NowRow } from '../sim/now';
import { assetClass, workName } from './assets';
import { db } from './db';
import { TaskIcon } from './icons';
import type { Actions, Hud } from './store';

const machineName = (id?: string) => (id ? named(db?.equipment[id]?.name ?? db?.machines[id]?.name, id) : '');
const partName = (machine?: string, part?: string) => {
  const rec = machine ? (db?.equipment[machine] ?? db?.machines[machine]) : undefined;
  return named(rec?.parts.find(p => p.id === part)?.name, part ?? '');
};

/** Что за работа: «Отвешивание · серия PA003», «Растворение · прибор работает · П-2709-0017». */
export function rowTitle(r: NowRow): string {
  const batch = r.batch ? T.now.batch(r.batch) : '';
  const lot = r.lot ? T.lotCode(...r.lot) : '';
  switch (r.kind) {
    case 'stage':
      return [T.stages[r.stage ?? ''] ?? r.stage, batch].filter(Boolean).join(' · ');
    case 'clean':
      return T.now.clean(!!r.major);
    case 'pack':
      return [T.now.pack, batch, r.sku ? named(db?.skus[r.sku]?.name, r.sku) : ''].filter(Boolean).join(' · ');
    case 'test':
      return [named(db?.tests[r.method ?? '']?.name, r.method), T.now.phase[r.phase ?? ''] ?? '', lot].filter(Boolean).join(' · ');
    case 'repair':
      return T.now.repair(!!r.planned, partName(r.machine, r.part), machineName(r.machine));
    case 'truck':
      return r.customer ? T.now.truckOut(named(db?.customers[r.customer]?.name, r.customer)) : T.now.truckIn(named(db?.suppliers[r.supplier ?? '']?.name, r.supplier));
    case 'visit':
    case 'accept': {
      // работа подрядчика и её приёмка (Б3в): «Калибровка весов · Весы с ламинарным боксом, инв. № 00000108»
      const a = r.family && r.machine ? { family: r.family, type: r.machine } : undefined;
      const what = a && r.inv !== undefined ? T.now.visit(r.work ? workName(a, r.work) : T.tasks.accept, assetClass(a), T.assets.inv(r.inv)) : '';
      return r.kind === 'accept' ? [T.tasks.accept, what].filter(Boolean).join(' · ') : what;
    }
    case 'audit':
    case 'vendorReview': {
      // оценка поставщика (Б3г): «Аудит изготовителя · Изготовитель лоратадина, Китай»; рассмотрение — отчёта или
      // документов
      const mk = r.maker ? db?.makers[r.maker] : undefined;
      const who = mk ? T.now.maker(named(mk.name, r.maker), named(mk.country)) : (r.maker ?? '');
      return r.kind === 'audit' ? [T.now.audit, who].join(' · ') : [T.tasks.vendorReview, r.how ? T.now.how[r.how] : '', who].filter(Boolean).join(' · ');
    }
    default:
      return [T.tasks[r.kind] ?? r.kind, batch || lot, r.line ? T.now.line(r.line) : ''].filter(Boolean).join(' · ');
  }
}

/** Где и кто: «Отвешивание · Аппаратчик × 2»; у прибора, который работает сам, — прибор. */
function rowWho(r: NowRow): string {
  const roles = new Map<string, number>();
  for (const p of r.people) roles.set(p.role, (roles.get(p.role) ?? 0) + 1);
  const who = [...roles].map(([role, n]) => `${named(db?.roles[role]?.name, role)} × ${n}`).join(', ');
  const where = r.room ? (T.roomTypes[r.room] ?? r.room) : r.inst ? named(db?.instruments[r.inst]?.name, r.inst) : '';
  const none = r.kind === 'test' && r.phase === 'run' ? '' : r.kind === 'visit' ? T.now.contractor : r.kind === 'audit' ? T.now.auditor : T.now.nobody;
  return [where, who || none].filter(Boolean).join(' · ');
}

/**
 * Сколько прошло и по норме — по часам окна; упаковка — пачки и скорость; люди ещё идут — «идут к месту работы»;
 * аудит — когда придёт отчёт.
 */
export function rowWhen(r: NowRow, t: number, start?: Ymd): string {
  if (r.kind === 'pack') return `${T.now.packs(num(r.done ?? 0), num(r.target ?? 0))} · ${T.now.rate(num(r.rate ?? 0), num(r.rated ?? 0))}`;
  if (t < r.from) return T.now.onWay;
  const gone = durText(t - r.from);
  if (r.kind === 'truck') return T.now.truckSince(gone);
  if (r.kind === 'audit' && r.until !== undefined && start) return T.now.auditUntil(gone, whenText(start, r.until));
  if (r.norm !== undefined) return T.now.gone(gone, durText(r.norm));
  if (r.range) return T.now.goneRange(gone, durText(r.range[0]), durText(r.range[1]));
  return T.now.goneOnly(gone);
}

export function Now({ hud, actions }: { hud: Hud; actions: Actions }) {
  const v = hud.now.view;
  return (
    <div className="stock panel nowp" id="now" role="dialog" aria-labelledby="now-title" data-test="now">
      <div className="phead">
        <b id="now-title">{T.now.title}</b>
        <span className="muted">{T.now.question}</span>
        <button type="button" className="close" onClick={() => actions.toggleNow()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {!v ? <div className="muted">{T.app.loading}</div> : null}
      {v && v.rows.length === 0 ? <div className="muted empty">{T.now.empty}</div> : null}
      {v
        ? NOW_DEPTS.filter(d => v.rows.some(r => r.dept === d)).map(d => (
            <section key={d} className="nsec">
              <div className="msec">{T.now.depts[d]}</div>
              <ul className="nlist">
                {v.rows
                  .filter(r => r.dept === d)
                  .map(r => (
                    <li key={r.key} data-test="now-row" data-key={r.key} data-kind={r.kind} className={hud.watch?.key === r.key ? 'on' : ''}>
                      <button type="button" className="nmain" onClick={() => r.thing && actions.show(r.thing)} disabled={!r.thing}>
                        <span className="ntitle">
                          <TaskIcon kind={r.kind} /> {rowTitle(r)}
                        </span>
                        <span className="muted small">
                          {rowWho(r)}
                          {r.crew ? (
                            <span data-test="now-crew">
                              {' · '}
                              {T.now.crew(named(db?.shifts[r.crew]?.name, r.crew))}
                            </span>
                          ) : null}
                          {r.over !== undefined ? (
                            <span className="warn" data-test="now-over">
                              {' · '}
                              {T.now.over(clock(momentOf(hud.start, r.over).sec))}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <span className="ntime small">{rowWhen(r, hud.t, hud.start)}</span>
                      <button type="button" onClick={() => actions.watch(r.key)} title={T.now.watchHint} data-test="now-watch">
                        {T.now.watch}
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ))
        : null}
    </div>
  );
}
