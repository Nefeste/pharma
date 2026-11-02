// Руководители — люди в окне (Б5в; docs/specs/2026-10-vertical-slice.md, «Б5в»): блок карточки руководителя и его
// заместителя, строки планёрки «Руководители». Слабое место — словами: что навык ограничивает в правиле отдела (§8.5).
// Заместителя назначает и снимает пост отдела руководителя или директор — команда `deputy`; чужой пост — кнопки погашены.
import type { HeadId } from '../content/types';
import { dayText, named, pctText, T } from '../i18n';
import type { BossLimit, BossPerson, BossRow } from '../sim/bosses';
import type { Thing } from '../sim/views';
import { db } from './db';
import { type Actions, type Hud, holds } from './store';

/** Что навык ограничивает — словами (§8.5): горизонт планирования, порог вывода, замена узлов, навык при найме. */
export function limitWords(l: BossLimit | undefined): string[] {
  if (!l) return [];
  const out: string[] = [];
  if (l.cover) out.push(T.boss.cover(l.cover.days, l.cover.full));
  if (l.threshold) out.push(T.boss.threshold(pctText(l.threshold.at), l.threshold.at < l.threshold.full ? pctText(l.threshold.full) : undefined));
  if (l.replace) out.push(T.boss.replace(l.replace.byWear));
  if (l.hire) out.push(T.boss.hire(l.hire.min, l.hire.min < l.hire.full ? l.hire.full : undefined));
  return out;
}

const who = (x: Pick<BossPerson, 'role' | 'tab'>) => T.card.person(named(db?.roles[x.role]?.name, x.role), x.tab);

/** Пост руководителя у игрока или директор — да; подпись погашенной кнопки — чей это пост. */
function seatOf(hud: Hud, b: BossRow): { mine: boolean; title: string } {
  const mine = holds(hud, b.seat);
  return { mine, title: mine ? '' : T.seats.notYours(T.seats.names[b.seat] ?? b.seat) };
}

/**
 * Заместитель руководителя: кто, навык, в отпуске ли; «Назначить заместителя…» из ролей сценария и «Снять». В карточке
 * руководителя — с подписью, в таблице «Руководители» — без неё (`bare`): там должность может быть свободна.
 */
export function Deputy({ b, hud, actions, bare }: { b: BossRow; hud: Hud; actions: Actions; bare?: boolean }) {
  const { mine, title } = seatOf(hud, b);
  const d = b.deputy;
  const pick = b.can.filter(x => x.n !== d?.n);
  return (
    <div data-test="card-boss-deputy" data-head={b.head}>
      {bare ? null : <span>{T.boss.deputy}: </span>}
      {d ? (
        <>
          <button type="button" className="link" onClick={() => actions.show({ kind: 'person', n: d.n })} data-test="card-boss-deputy-who">
            {who(d)}
          </button>
          <span className="muted">
            {' · '}
            {T.boss.skill(d.skill)}
            {d.away !== undefined ? ` · ${T.boss.away(dayText(d.away))}` : ''}
            {b.set ? ` · ${T.boss.set}` : ''}
          </span>
        </>
      ) : (
        <span className="warn">{b.none ? T.boss.removed : T.boss.noDeputy}</span>
      )}
      <div>
        <select
          value=""
          disabled={!mine || pick.length === 0}
          title={title}
          onChange={e => {
            if (e.target.value) actions.deputy(b.head, Number(e.target.value));
          }}
          data-test="card-deputy-pick"
        >
          <option value="">{T.boss.appoint}</option>
          {pick.map(x => (
            <option key={x.n} value={x.n}>
              {`${who(x)} · ${T.boss.skill(x.skill)}`}
            </option>
          ))}
        </select>{' '}
        {d ? (
          <button type="button" className="link" disabled={!mine} title={title} onClick={() => actions.deputy(b.head, null)} data-test="card-deputy-remove">
            {T.boss.remove}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Карточка руководителя (Б5в): чей он руководитель, что его навык ограничивает, кто решает сегодня, заместитель,
 * показатели отдела; у заместителя — чей он заместитель и решает ли сейчас за руководителя, «и. о.», со своим навыком.
 */
export function BossBlock({ boss, deputyFor, hud, actions }: { boss?: BossRow; deputyFor?: { head: HeadId; acting: boolean; limit: BossLimit }[]; hud: Hud; actions: Actions }) {
  if (!boss && !deputyFor) return null;
  const words = boss ? limitWords(boss.person?.limit) : [];
  return (
    <div data-test="card-boss">
      {boss ? (
        <>
          <div className="csec">{T.boss.of(T.journal.names[boss.head] ?? boss.head)}</div>
          <div className="small" data-test="card-boss-limit">
            {words.length > 0 ? words.join(' · ') : T.boss.nothing}
          </div>
          <div className={boss.now === 'noOne' ? 'small bad' : 'small'} data-test="card-boss-now">
            {T.boss.now[boss.now]}
          </div>
          <Deputy b={boss} hud={hud} actions={actions} />
          <button type="button" className="link" onClick={() => (actions.setKpiTab(boss.seat), actions.openKpi())} data-test="card-boss-kpi">
            {T.boss.kpi}
          </button>
        </>
      ) : null}
      {deputyFor?.map(d => (
        <div key={d.head} className="small" data-test="card-deputy-for">
          <b>{T.boss.deputyOf(T.journal.namesOf[d.head] ?? d.head)}</b>
          {d.acting ? <span className="warn"> · {T.boss.acting}</span> : null}
          {limitWords(d.limit).length > 0 ? <div className="muted">{limitWords(d.limit).join(' · ')}</div> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Планёрка, «Руководители» (Б5в): где сегодня решает не руководитель — кто замещает и что его навык ограничивает, или
 * «некому решить»; щелчок — к карточке заместителя, а нет его — руководителя. Все на месте — блока нет.
 */
export function BossMeeting({ rows, go }: { rows: readonly BossRow[]; go: (t: Thing | undefined) => (() => void) | undefined }) {
  if (rows.length === 0) return null;
  return (
    <div className="mblock" data-test="morning-bosses">
      <div className="mhead">{T.boss.meeting}</div>
      <ul className="mlist">
        {rows.map(r => {
          const why = r.person?.away !== undefined ? T.boss.away(dayText(r.person.away)) : T.boss.vacant;
          const to = r.now === 'io' && r.deputy ? r.deputy : r.person;
          const limit = r.now === 'io' ? limitWords(r.deputy?.limit).join(' · ') : '';
          return (
            <li key={r.head} className={r.now === 'noOne' ? 'bad go' : 'warn go'} onClick={go(to ? { kind: 'person', n: to.n } : undefined)} data-test="morning-boss" data-head={r.head}>
              {r.now === 'io' && r.deputy ? T.boss.meetIo(T.journal.names[r.head] ?? r.head, why, who(r.deputy), limit) : T.boss.meetNoOne(T.journal.namesOf[r.head] ?? r.head, why)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
