// Планёрка в 08:00 (docs/specs/2026-10-panels.md, 3в; docs/13-art.md, §11): страница, которую читают минуту, — ваше место
// за время на нём (3е), вчера в цифрах, одна главная потеря, одна подсказка; что было с прошлой планёрки; что ждёт сейчас. Большое окно поверх карты с
// вопросом в заголовке. Вид собирает поток расчёта (src/sim/report.ts) без слов и без истины; слова — отсюда.
import type { ReactNode } from 'react';
import { devLevers, heldLevers, mainLevers, resignLevers, riskLevers, uncoveredLevers, wasteLevers } from '../app/levers';
import { spotName } from '../app/losses';
import type { Id, PartType, Plant, Scenario } from '../content/types';
import { civilFromDays, DAY, HOUR, momentOf, type Ymd } from '../engine/core/calendar';
import { planOf } from '../engine/plant';
import { DEPT_SEAT } from '../engine/seats';
import { clock, dateText, daysText, dayText, durText, hText, kmText, money, named, num, pctText, qtyText, T, whenText } from '../i18n';
import { layoutOf } from '../render/layout';
import type { FcMeeting } from '../sim/forecast';
import type { EditsMeeting } from '../sim/edits';
import type { MrpMeeting } from '../sim/mrp';
import type { SopMeeting } from '../sim/sop';
import type { HeadDay } from '../sim/journal';
import type { MonthClose } from '../sim/kpi';
import type { CapaRow } from '../sim/devs';
import type { CapaMeeting, LineSum, MainLoss, ModeRow, MorningView, SeatSum, SessionSum } from '../sim/report';
import type { RejectSum } from '../sim/waste';
import type { Thing } from '../sim/views';
import { assetName, workName } from './assets';
import { BossMeeting } from './Bosses';
import { capaName, headText } from './capa';
import { overFact } from './fcchart';
import { signed } from './Forecast';
import { DailyMeet } from './Daily';
import { headName, kpiName, kpiText, kpiValue, monthText } from './Kpi';
import { db } from './db';
import { AskRows } from './Journal';
import { Levers } from './Levers';
import { priceParts } from './price';
import type { Actions, Hud } from './store';
import { paramText } from './units';

/** Уставка не по цели (Б1ж): режим стадии карты или скорость блистерной позиции, уставка и цель, с какого часа. */
function modeText(x: ModeRow, start: Ymd): string {
  const when = whenText(start, x.from);
  if (x.sku) {
    const per = (n: number) => T.ref.perMin(num(n), T.ref.items.blister ?? '');
    return T.morning.mode(`${T.speed.title} · ${named(db?.skus[x.sku]?.name, x.sku)}`, per(x.v), per(x.target), when);
  }
  const what = [T.ref.params[x.param] ?? x.param, T.stages[x.stage ?? ''] ?? x.stage, named(db?.recipes[x.recipe ?? '']?.name, x.recipe ?? '')].join(' · ');
  return T.morning.mode(what, paramText(x.unit!, x.v), paramText(x.unit!, x.target), when);
}

/** Название машины или оборудования по виду; узлы — из той же записи. */
function machineOf(thing: Thing | undefined, type: string): { name: string; parts: readonly PartType[] } {
  const rec = thing?.kind === 'equipment' ? db?.equipment[type] : db?.machines[type];
  return { name: named(rec?.name, type), parts: rec?.parts ?? [] };
}

const partName = (parts: readonly PartType[], id: string) => named(parts.find(p => p.id === id)?.name, id);

/** Пара словами (Б3г): «Дистрибьютор АФС — Изготовитель парацетамола». */
const pairName = (supplier: string, maker: string) => T.ref.pair(named(db?.suppliers[supplier]?.name, supplier), named(db?.makers[maker]?.name, maker));

/** Вид машины линии по плану. */
function lineMachine(plant: Plant, line: number, k: number): { thing: Thing; name: string } {
  const type = db ? (planOf(db, plant).plant.lines[line]?.machines[k]?.type ?? '') : '';
  return { thing: { kind: 'machine', line, k }, name: named(db?.machines[type]?.name, type) };
}

function lineLossText(plant: Plant, l: LineSum): string {
  if (!l.loss || l.key === undefined) return '';
  const key = lineMachine(plant, l.line, l.key).name;
  const text = T.morning.lineLoss[l.loss.what](key, durText(l.loss.sec));
  if (!l.neighbour) return text;
  const nb = lineMachine(plant, l.line, l.neighbour.k).name;
  return `${text} — ${T.morning.neighbour[l.neighbour.what](nb, durText(l.neighbour.sec))}`;
}

function mainText(plant: Plant, m: MainLoss): string {
  switch (m.k) {
    case 'wait': {
      // у ожидания — место, где его было больше всего (Б1л)
      const text = T.morning.main.wait(T.morning.depts[m.dept], T.wait[m.cause], durText(m.sec));
      return m.spot && db ? T.morning.main.at(text, spotName(layoutOf(planOf(db, plant)), m.spot)) : text;
    }
    case 'line':
      return `${T.morning.line(m.line + 1)}: ${lineLossText(plant, m)}`;
    case 'move':
      return T.morning.main.move(kmText(m.cm), durText(m.sec), m.cm > 0 ? pctText(Math.round((m.empty * 10000) / m.cm)) : pctText(0));
    case 'walk':
      return T.morning.main.walk(kmText(m.cm), durText(m.sec));
  }
}

const hintOf = (m: MainLoss): string => (m.k === 'wait' ? T.morning.hints[m.cause] : m.k === 'line' ? T.morning.hints[m.loss.what] : T.morning.hints[m.k]);

/**
 * Решения за сутки (Б5а): строка на руководителя — сколько решений каких видов, у заказов поставщикам — предоплата;
 * щелчок по строке — журнал на последнем решении этого руководителя; рычаг — «Журнал».
 */
function HeadsBlock({ list, hud, actions, close }: { list: readonly HeadDay[]; hud: Hud; actions: Actions; close: () => void }) {
  if (list.length === 0) return <div className="muted" data-test="morning-heads">{T.morning.headsNone}</div>;
  return (
    <div className="mblock" data-test="morning-heads">
      <ul className="mlist">
        {list.map(h => {
          const what = [...h.kinds.map(k => T.journal.count[k.kind]?.(k.n, k.v) ?? `${k.kind} ${k.n}`), ...(h.prepaid ? [T.journal.prepaid(money(h.prepaid))] : [])].join(', ');
          return (
            <li key={h.head} className="go" role="link" tabIndex={0} onClick={() => (close(), actions.openJournal(h.last))} onKeyDown={e => e.key === 'Enter' && (close(), actions.openJournal(h.last))} data-test="morning-head" data-head={h.head}>
              {T.morning.headRow(T.journal.names[h.head] ?? h.head, what)}
            </li>
          );
        })}
      </ul>
      <Levers list={[{ k: 'journal' }]} hud={hud} actions={actions} close={close} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="msec">{title}</div>
      {children}
    </>
  );
}

/** Вчерашние уборки и переналадки (Б2г): генеральные, малые, переналадки линий — каких не было, тех строк нет. */
function cleanRows(v: MorningView): string[] {
  const rows: string[] = [];
  if (v.cleans?.major) rows.push(T.morning.cleanMajor(v.cleans.major, durText(v.cleans.majorSec)));
  if (v.cleans?.minor) rows.push(T.morning.cleanMinor(v.cleans.minor, durText(v.cleans.minorSec)));
  if (v.changes?.n) rows.push(T.morning.changes(v.changes.n, durText(v.changes.sec)));
  return rows;
}

/** Список строк; пустой не показываем — страницу читают минуту. */
function Rows({ title, rows }: { title: string; rows: ReactNode[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mblock">
      <div className="mhead">{title}</div>
      <ul className="mlist">{rows}</ul>
    </div>
  );
}

/**
 * Люди (Б4в): заявления за сутки — найм на место и карточка человека; кто выходит и кто уходит на неделе; испытания,
 * которые кончаются на неделе; новые кандидаты по вакансиям — найм. Отпуска (Б4г): кто в отпуске и кто замещает, кто
 * уходит в отпуск в ближайшие две недели и кто выходит на неделе; черновик графика до утверждения — рычаг «График
 * отпусков».
 */
function PeopleBlock({ v, hud, actions, close, go }: { v: MorningView; hud: Hud; actions: Actions; close: () => void; go: (t: Thing | undefined) => (() => void) | undefined }) {
  const p = v.people;
  const l = v.leave;
  const role = (id: string) => named(db?.roles[id]?.name, id);
  const who = (x: { role: string; tab: number }) => T.card.person(role(x.role), x.tab);
  const dept = (id: string) => db?.roles[id]?.dept ?? 'mes';
  const leaves = l ? l.away.length + l.going.length + l.back.length + (l.draft ? 1 : 0) : 0;
  const empty = p.resigned.length + p.coming.length + p.leaving.length + p.trials.length + p.candidates.length + leaves === 0;
  return (
    <div className="mblock" data-test="morning-people">
      <div className="mhead">{T.morning.people.title}</div>
      {empty ? <div className="muted">{T.morning.people.none}</div> : null}
      <ul className="mlist">
        {p.resigned.map(x => (
          <li key={`r${x.person}`} className="warn" data-test="morning-resign">
            {T.morning.people.resigned(who(x), dayText(x.last))}
            {x.vacancy ? <span className="muted"> · {T.morning.people.colleague}</span> : null}
            <Levers list={resignLevers(x, dept(x.role))} hud={hud} actions={actions} close={close} />
          </li>
        ))}
        {p.coming.map(x => (
          <li key={`c${x.id}`} data-test="morning-coming">
            {T.morning.people.coming(dayText(x.day), role(x.role), named(db?.shifts[x.shift]?.name, x.shift))}
          </li>
        ))}
        {p.leaving.map(x => (
          <li key={`l${x.person}`} className="go" onClick={go({ kind: 'person', n: x.person })} data-test="morning-leaving">
            {T.morning.people.leaving(dayText(x.last), who(x), T.hire.why[x.why] ?? x.why)}
          </li>
        ))}
        {p.trials.map(x => (
          <li key={`t${x.person}`} className="go" onClick={go({ kind: 'person', n: x.person })} data-test="morning-trial">
            {T.morning.people.trial(dayText(x.last), who(x))}
          </li>
        ))}
        {p.candidates.map(x => (
          <li key={`k${x.vacancy}`} data-test="morning-candidates">
            {T.morning.people.candidates(role(x.role), x.n)}
            <Levers list={[{ k: 'staff', seat: DEPT_SEAT[dept(x.role)] }]} hud={hud} actions={actions} close={close} />
          </li>
        ))}
        {l?.draft ? (
          <li className="warn" data-test="morning-leave-draft">
            {T.morning.people.draft(l.draft.y, dayText(l.draft.approve), l.draft.problems, l.draft.miss)}
            <Levers list={[{ k: 'leave', seat: 'director' }]} hud={hud} actions={actions} close={close} />
          </li>
        ) : null}
        {l?.away.map(x => (
          <li key={`a${x.n}`} className="go" onClick={go({ kind: 'person', n: x.n })} data-test="morning-away">
            {T.morning.people.away(who(x), dayText(x.to), x.deputy && who(x.deputy))}
          </li>
        ))}
        {l?.going.map(x => (
          <li key={`g${x.n}-${x.from}`} className="go" onClick={go({ kind: 'person', n: x.n })} data-test="morning-going">
            {T.morning.people.going(dayText(x.from), who(x), dayText(x.to), x.deputy && who(x.deputy))}
          </li>
        ))}
        {l?.back.map(x => (
          <li key={`b${x.n}-${x.day}`} className="go" onClick={go({ kind: 'person', n: x.n })} data-test="morning-back">
            {T.morning.people.back(dayText(x.day), who(x))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Итог места за время на нём (3е): мерило места строками. */
function SeatBlock({ x, start }: { x: SeatSum; start: Ymd }) {
  const rows: string[] = [];
  switch (x.seat) {
    case 'production': {
      // числа — показатели окна «Показатели» (Б5ж) за время на месте: те же определения и та же запись
      const packs = (n: number) => T.morning.packs(num(n));
      rows.push(x.shift === undefined ? T.morning.prod.noShifts : T.morning.prod.plan(packs(x.fact), packs(x.plan), kpiValue('share', x.shift)));
      if (x.rhythm !== undefined) rows.push(T.morning.prod.rhythm(kpiValue('share', x.rhythm)));
      for (const l of x.lines) rows.push(l.oee ? T.morning.prod.oee(T.morning.line(l.line + 1), kpiValue('share', l.oee.oee)) : T.morning.prod.noOee(T.morning.line(l.line + 1)));
      rows.push(T.morning.prod.recleans(x.recleans));
      rows.push(T.morning.prod.switches(x.switches.major, durText(x.switches.majorSec), x.switches.changes, durText(x.switches.changeSec)));
      break;
    }
    case 'quality':
      rows.push(T.morning.qual.devs(x.deviations, x.open));
      rows.push(x.rft === undefined ? T.morning.qual.noDecisions : T.morning.qual.first(x.first, x.released, kpiValue('share', x.rft)));
      if (x.release !== undefined) rows.push(T.morning.qual.toDecision(kpiValue('sec', x.release)));
      break;
    case 'director':
      rows.push(T.morning.dir.cash(money(x.balance), kpiValue('kop', x.flow, true)));
      rows.push(x.otif === undefined ? T.morning.dir.noOrders : T.morning.dir.orders(x.onTime, x.closed, kpiValue('share', x.otif)));
      rows.push(T.morning.dir.rejected(x.rejected));
      break;
    default:
      rows.push(T.morning.otherSeat);
  }
  return (
    <div className="mblock" data-test="morning-seat" data-seat={x.seat}>
      <div className="mhead">{T.morning.seatSince(T.seats.names[x.seat], dayText(momentOf(start, x.from).day))}</div>
      <ul className="mlist">
        {rows.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Совещание S&OP (Б6г): в день совещания — его час; утверждён план за сутки — до какого месяца, запас позиций продуктов
 * в первом месяце, кто утвердил и «до лучшего плана». Рычаг — окно S&OP.
 */
function SopBlock({ x, hud, actions, close }: { x: SopMeeting; hud: Hud; actions: Actions; close: () => void }) {
  const p = x.plan;
  return (
    <div className="mblock" data-test="morning-sop">
      {x.today !== undefined ? <div data-test="morning-sop-today">{T.sop.today(clock(x.today % 86400))}</div> : null}
      {p ? (
        <div data-test="morning-sop-plan" data-gap={p.gap}>
          {T.sop.meetingText(T.sop.month(p.to), p.cover.map(c => T.sop.coverOf(named(db?.products[c.product]?.name, c.product), T.sop.days(c.days))).join(', '), p.by === 'player' ? T.journal.player('') : T.sop.colleague, money(p.gap))}
        </div>
      ) : null}
      <Levers list={[{ k: 'sop' }]} hud={hud} actions={actions} close={close} />
    </div>
  );
}

/**
 * Прогноз (Б6в) — в первые сутки после закрытия месяца: сколько в нём заказано и что ему прогнозировали месяц назад
 * планирование и отдел продаж — со знаком против факта, — и прогноз нынешнего месяца у обоих. Рычаг — вкладка «Прогноз».
 */
function FcBlock({ x, hud, actions, close }: { x: FcMeeting; hud: Hud; actions: Actions; close: () => void }) {
  const ym = (n: number) => ({ y: Math.floor(n / 12), m: (n % 12) + 1 });
  const was = ym(x.m);
  const now = ym(x.next.m);
  return (
    <div className="mblock" data-test="morning-forecast">
      <div>
        {T.fc.meetingText(T.fc.monthIn(was.y, was.m), T.fc.cases(x.fact), num(x.plan), signed(overFact(x.plan, x.fact), 0), num(x.sales), signed(overFact(x.sales, x.fact), 0), T.fc.month(now.y, now.m), num(x.next.plan), num(x.next.sales))}
      </div>
      <Levers list={[{ k: 'forecast' }]} hud={hud} actions={actions} close={close} />
    </div>
  );
}

/**
 * Правки плана (Б6е): события коммерции за сутки до планёрки — крупные заказы и снятый спрос — и правки в замороженном
 * горизонте с ценой. Рычаг — расписание.
 */
function EditsBlock({ x, hud, actions, close }: { x: EditsMeeting; hud: Hud; actions: Actions; close: () => void }) {
  const start = hud.start;
  const skuName = (id?: Id) => (id ? named(db?.skus[id]?.name, id) : '');
  const cus = (id: Id) => named(db?.customers[id]?.name, id);
  const label = (id: string) => T.jobs.order(Number(id.slice(1)));
  return (
    <div className="mblock" data-test="morning-edits">
      {x.events.length > 0 ? (
        <>
          <div>{T.edits.events}</div>
          <ul className="mlist">
            {x.events.map(e => (
              <li key={`${e.t}/${e.kind}/${e.customer}/${e.sku}`} data-test="morning-event" data-kind={e.kind}>
                {e.kind === 'big' ? T.journal.what.bigOrder(cus(e.customer), skuName(e.sku), e.cases, whenText(start, e.due ?? e.t)) : T.journal.what.demandCut(cus(e.customer), skuName(e.sku), e.cases)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {x.edits.length > 0 ? (
        <>
          <div>{T.edits.title}</div>
          <ul className="mlist">
            {x.edits.map(e => (
              <li key={`${e.t}/${e.kind}/${e.batch ?? ''}`} data-test="morning-edit" data-kind={e.kind}>
                {T.edits.line(T.edits.kind[e.kind] ?? e.kind, skuName(e.sku) || (e.batch ? label(e.batch) : ''), priceParts(e.price, id => (e.codes?.[id] ? T.gantt.batch(e.codes[id]) : label(id))).join('; '))}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Levers list={[{ k: 'gantt', seat: 'production' }]} hud={hud} actions={actions} close={close} />
    </div>
  );
}

/**
 * Материалы (Б6д): плановые заказы с датой сегодня и раньше — у поставщика, сколько, к какому дню, на сколько опоздают, —
 * и заказы в пути, которые опоздают; с Б6ж — заказы, что не пришли к обещанному дню, и одобрения пар в работе. Рычаг —
 * вкладка «Материалы» расписания.
 */
function MrpBlock({ x, hud, actions, close }: { x: MrpMeeting; hud: Hud; actions: Actions; close: () => void }) {
  const unitOf = (m: Id) => db?.materials[m]?.unit ?? 'mass';
  const mat = (m: Id) => named(db?.materials[m]?.name, m);
  const sup = (id: Id) => named(db?.suppliers[id]?.name, id);
  return (
    <div className="mblock" data-test="morning-materials">
      {x.due.length > 0 ? (
        <>
          <div>{T.mrp.due(x.due.length)}</div>
          <ul className="mlist">
            {x.due.map(o => (
              <li key={`${o.supplier}/${o.material}/${o.need}`} className={o.late > 0 ? 'bad' : undefined} data-test="morning-materials-due" data-material={o.material}>
                {T.mrp.dueLine(mat(o.material), sup(o.supplier), qtyText(o.qty, unitOf(o.material), 0), dayText(o.need).slice(0, 5), o.late)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {x.late.length > 0 ? (
        <>
          <div>{T.mrp.lateTitle}</div>
          <ul className="mlist">
            {x.late.map(l => (
              <li key={`${l.po}/${l.material}`} data-test="morning-materials-late" data-po={l.po}>
                {T.mrp.lateLine(l.po, mat(l.material), l.days)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {x.behind.length > 0 ? (
        <>
          <div>{T.mrp.behindTitle}</div>
          <ul className="mlist">
            {x.behind.map(l => (
              <li key={`${l.po}/${l.material}`} className="warn" data-test="morning-materials-behind" data-po={l.po}>
                {T.mrp.behindLine(l.po, sup(l.supplier), mat(l.material), l.days)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {x.apps.length > 0 ? (
        <>
          <div>{T.mrp.appsTitle}</div>
          <ul className="mlist">
            {x.apps.map(a => (
              <li key={a.pair} data-test="morning-materials-app" data-pair={a.pair} data-step={a.step}>
                {T.mrp.appLine(`${pairName(a.supplier, a.maker)}, ${mat(a.material)}`, [T.pairApp.steps[a.step] ?? a.step, ...(a.filed !== undefined ? [T.pairApp.filed(dayText(a.filed))] : []), ...(a.asked !== undefined ? [T.pairApp.asked(dayText(a.asked))] : []), ...(a.answered !== undefined ? [T.pairApp.answered(dayText(a.answered))] : [])].join(' · '))}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Levers list={[{ k: 'materials' }]} hud={hud} actions={actions} close={close} />
    </div>
  );
}

/**
 * Итоги месяца (Б5ж) — на первой планёрке месяца: у руководителя — показатели, сдвинувшиеся сильнее всего против месяца до
 * него, с противовесом; первый закрытый месяц — сравнивать не с чем. Рычаг — окно «Показатели». Это отчёт, а не событие:
 * без автопаузы и без извещения.
 */
function MonthBlock({ x, hud, actions, close }: { x: MonthClose; hud: Hud; actions: Actions; close: () => void }) {
  return (
    <div className="mblock" data-test="morning-month">
      {x.first ? <div className="muted">{T.kpi.close.first}</div> : null}
      {!x.first && x.heads.length === 0 ? <div className="muted">{T.kpi.close.none}</div> : null}
      {x.heads.map(h => (
        <div key={h.head} data-test="morning-month-head" data-head={h.head}>
          <div className="mhead">{headName(h.head)}</div>
          <ul className="mlist">
            {h.rows.map(r => (
              <li key={r.id} data-test="morning-month-row" data-id={r.id} data-trend={r.trend}>
                {/* стрелка — куда сдвинулось число, цвет и слово — лучше это или хуже, как у плитки окна */}
                <span className={r.trend === 1 ? 'good' : r.trend === -1 ? 'bad' : ''}>{r.v > r.was ? '▲ ' : r.v < r.was ? '▼ ' : '= '}</span>
                {T.kpi.close.row(kpiName(r.id), kpiText(r.id, r.unit, r.v), kpiText(r.id, r.unit, r.was), T.kpi.trendShort[r.trend === 1 ? 'up' : r.trend === -1 ? 'down' : 'same'])}
                {r.pair ? (
                  <div className="muted">
                    {r.pair.v !== undefined && r.pair.was !== undefined
                      ? T.kpi.close.pair(kpiName(r.pair.id), kpiText(r.pair.id, r.pair.unit, r.pair.v), kpiText(r.pair.id, r.pair.unit, r.pair.was))
                      : T.kpi.close.pairNone(kpiName(r.pair.id))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Levers list={[{ k: 'kpi', month: x.from }]} hud={hud} actions={actions} close={close} />
    </div>
  );
}

/**
 * Итог игры (обёртка): сколько вы играете — по часам окна, сколько прошло на заводе и что он за это время сделал. Минуты —
 * с первого кадра игры в этом окне.
 */
function SessionBlock({ x, real }: { x: SessionSum; real: number }) {
  const min = Math.max(1, Math.round((performance.now() - real) / 60_000));
  // на заводе — сутками и часами: «7 дней 1 ч»
  const span = x.to - x.from;
  const h = Math.round((span % DAY) / HOUR);
  const plant = `${daysText(Math.floor(span / DAY))}${h > 0 ? ` ${h}\u00a0${T.units.h}` : ''}`;
  const rows = [
    T.morning.session.batches(x.bulk, x.packed, x.released, x.rejected),
    ...(x.packs > 0 ? [T.morning.session.packs(num(x.packs))] : []),
    x.closed === 0 ? T.morning.session.noOrders : T.morning.session.orders(x.onTime, x.closed),
    T.morning.session.devs(x.deviations, x.open, x.concluded),
    T.morning.session.cash(money(x.balance), money(x.change, true)),
  ];
  return (
    <div className="mblock" data-test="morning-session">
      <div data-test="session-head">{T.morning.session.head(durText(min * 60), plant)}</div>
      <ul className="mlist">
        {rows.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

/** Где ждут места в зоне отклонённого: вид места склада или помещение — словами. */
const placeName = (where: string) => (T.zones as Record<string, string>)[where] ?? T.roomTypes[where] ?? where;

/**
 * Отклонённое (Б1з): сколько мест зоны занято из скольких, сколько паллет ждут места и где; вывоз — заказан, у рампы или
 * нет; вывозы с прошлой планёрки; у строки — «Заказать вывоз». Пусто и тихо — блока нет.
 */
function Rejects({ r, start, hud, actions, close }: { r: RejectSum; start: Ymd; hud: Hud; actions: Actions; close?: () => void }) {
  if (r.used === 0 && r.waiting.length === 0 && !r.order && r.out.length === 0) return null;
  const full = r.used >= r.places;
  return (
    <div className="mblock" data-test="morning-rejects">
      <div className="mhead">{T.waste.title}</div>
      <div className={full ? 'bad' : r.waiting.length > 0 ? 'warn' : ''} data-test="morning-rejects-zone">
        {T.waste.zone(r.used, r.places)}
        {r.waiting.length > 0 ? <span> · {T.waste.waiting(r.waiting.map(x => T.waste.where(placeName(x.where), x.n)).join(', '))}</span> : null}
      </div>
      <div className="muted" data-test="morning-rejects-order">
        {r.order ? T.waste.order(whenText(start, r.order.at), r.order.by === 'player') : T.waste.none}
        {r.order?.truck ? <span> · {T.waste[r.order.truck]}</span> : null}
      </div>
      {r.out.map(x => (
        <div key={x.t} data-test="morning-rejects-out">
          {T.waste.out(whenText(start, x.t), x.pallets, money(x.sum))}
        </div>
      ))}
      <Levers list={wasteLevers(r)} hud={hud} actions={actions} close={close} />
    </div>
  );
}

/**
 * CAPA (Б5е): назначенные и ждущие исполнения — с исполнителем и сроком; назначенные и выполненные за сутки; проверки
 * эффективности за сутки с итогом и те, что придутся на неделю после планёрки. Строка ведёт к карточке отклонения.
 */
function CapaMeet({ c, start, go }: { c: CapaMeeting; start: Ymd; go: (t: Thing | undefined) => (() => void) | undefined }) {
  const day = (t: number) => dayText(momentOf(start, t).day);
  const line = (x: CapaRow) => T.morning.capaLine(x.n, capaName(x.action), T.dev.no(x.dev), headText(x.head));
  const rows = (title: string, list: CapaRow[], tail: (x: CapaRow) => string, cls: (x: CapaRow) => string, test: string) =>
    list.length === 0 ? null : (
      <>
        <div className="muted">{title}</div>
        <ul className="mlist">
          {list.map(x => (
            <li key={`${test}${x.n}`} className={`go ${cls(x)}`} onClick={go({ kind: 'dev', n: x.dev })} data-test={test} data-capa={x.n}>
              {line(x)}
              {tail(x) ? <span className="muted"> · {tail(x)}</span> : null}
            </li>
          ))}
        </ul>
      </>
    );
  if (c.open.length + c.day.length + c.checks.length + c.soon.length === 0) return null;
  return (
    <div className="mblock" data-test="morning-capa">
      <div className="mhead">{T.morning.capaTitle}</div>
      {rows(T.morning.capaOpen, c.open, x => (x.why ? T.dev.capaWait(T.notices.why[x.why] ?? x.why) : T.dev.capaDue(day(x.due))), x => (x.why ? 'warn' : ''), 'morning-capa-open')}
      {rows(T.morning.capaDay, c.day, x => (x.done !== undefined ? T.dev.capaDone(whenText(start, x.done), headText(x.head)) : ''), () => '', 'morning-capa-day')}
      {rows(T.morning.capaChecks, c.checks, x => (x.check ? (x.check.ok ? T.journal.check.ok : T.dev.capaNo(day(x.check.t), x.check.dev !== undefined ? T.dev.no(x.check.dev) : '')) : ''), x => (x.check && !x.check.ok ? 'bad' : ''), 'morning-capa-check')}
      {rows(T.morning.capaSoon, c.soon, x => (x.checkAt !== undefined ? T.dev.capaCheckAt(day(x.checkAt)) : ''), () => '', 'morning-capa-soon')}
    </div>
  );
}

/** Часть OEE ключевой машины: без времени работы нет производительности, без выпуска — качества — прочерк, как в окне
 * «Показатели»; выше 100 % — 100 %. */
const part = (x?: number) => (x === undefined ? T.floor.none : pctText(Math.min(x, 10000)));

export function Morning({ v, day, start, plant, pause, actions, hud, scenario }: { v?: MorningView; day: number; start: Ymd; plant: Plant; pause: boolean; actions: Actions; hud: Hud; scenario?: Scenario }) {
  const d = civilFromDays(day);
  const at = momentOf(d, 0);
  const yest = civilFromDays(day - 1);
  // щелчок по строке с машиной — камера к ней и её карточка; планёрка закрывается, пауза остаётся
  const go = (t: Thing | undefined) => (t ? () => {
    actions.closeMorning(false);
    actions.show(t);
  } : undefined);
  // место главной потери (Б1л) — карточка его вещи с блоком «Потери» за вчера; планёрка закрывается
  const goSpot = (spot: string) => () => actions.showSpot(spot);
  const when = (t: number) => whenText(start, t);
  // строка отклонения с расследованием — к его доске; планёрка закрывается, пауза остаётся
  const goInv = (id: string) => {
    actions.closeMorning(false);
    actions.openInv(id);
  };
  // рычаг (Б1г): планёрка закрывается раньше, чем откроется окно решения; пауза остаётся
  const close = () => actions.closeMorning(false);
  return (
    <div className="morning panel" id="morning" role="dialog" aria-labelledby="morning-title" data-test="morning">
      <div className="phead">
        <b id="morning-title">{T.morning.title(dateText(at))}</b>
        <span className="muted">{T.morning.question}</span>
        <button type="button" className="close" onClick={() => actions.closeMorning(false)} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {!v ? (
        <div className="muted">{T.app.loading}</div>
      ) : (
        <>
          {v.session && hud.session ? (
            <Section title={T.morning.session.title}>
              <SessionBlock x={v.session} real={hud.session.real} />
            </Section>
          ) : null}
          {v.seats.length > 0 ? (
            <Section title={T.morning.seatsTitle}>
              {v.seats.map(x => (
                <SeatBlock key={x.seat} x={x} start={start} />
              ))}
            </Section>
          ) : null}
          {v.asks.length > 0 ? (
            <Section title={T.morning.asks}>
              <div className="mblock" data-test="morning-asks">
                <AskRows rows={v.asks} start={start} actions={actions} />
              </div>
            </Section>
          ) : null}
          {v.memos.length > 0 ? (
            <Section title={T.morning.memos}>
              <div className="mblock" data-test="morning-memos">
                <AskRows rows={v.memos} start={start} actions={actions} />
              </div>
            </Section>
          ) : null}
          {v.month ? (
            <Section title={T.kpi.close.title(`${monthText(v.month)}${v.month.part ? ` · ${T.kpi.part}` : ''}`)}>
              <MonthBlock x={v.month} hud={hud} actions={actions} close={close} />
            </Section>
          ) : null}
          {v.forecast ? (
            <Section title={T.fc.meeting}>
              <FcBlock x={v.forecast} hud={hud} actions={actions} close={close} />
            </Section>
          ) : null}
          {v.sop ? (
            <Section title={T.sop.title}>
              <SopBlock x={v.sop} hud={hud} actions={actions} close={close} />
            </Section>
          ) : null}
          {v.materials ? (
            <Section title={T.mrp.meeting}>
              <MrpBlock x={v.materials} hud={hud} actions={actions} close={close} />
            </Section>
          ) : null}
          {v.edits ? (
            <Section title={T.edits.meeting}>
              <EditsBlock x={v.edits} hud={hud} actions={actions} close={close} />
            </Section>
          ) : null}
          {v.modes.length > 0 ? (
            <Section title={T.morning.modesTitle}>
              <ul className="mlist" data-test="morning-modes">
                {v.modes.map(x => (
                  <li key={`${x.recipe ?? x.sku}/${x.stage ?? ''}/${x.param}`}>{modeText(x, start)}</li>
                ))}
              </ul>
            </Section>
          ) : null}
          <Section title={T.morning.yesterday(T.date.full(yest.d, T.date.months[yest.m - 1], yest.y))}>
            {v.first ? <div className="muted" data-test="morning-yesterday">{T.morning.first}</div> : null}
            {v.first ? null : (
              <>
                <div className="mblock" data-test="morning-yesterday">
                  <div className="mhead">{T.morning.output}</div>
                  {v.shifts.length === 0 ? (
                    <div className="muted">{T.morning.noShifts}</div>
                  ) : (
                    <ul className="mlist">
                      {v.shifts.map((s, i) => {
                        const shift = named(db?.shifts[s.shift]?.name, s.shift);
                        const packs = (n: number) => T.morning.packs(num(n));
                        return (
                          <li key={i}>
                            {s.fact === undefined
                              ? T.morning.shiftOpen(shift, packs(s.plan))
                              : s.plan > 0
                                ? T.morning.shift(shift, packs(s.fact), packs(s.plan), pctText(Math.floor((s.fact * 10000) / s.plan)))
                                : T.morning.noPlan(shift, packs(s.fact))}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {v.rhythm !== undefined ? <div>{T.morning.rhythm(pctText(v.rhythm))}</div> : null}
                </div>
                <div className="mblock">
                  <div className="mhead">{T.morning.oee}</div>
                  <ul className="mlist">
                    {v.lines.map(l => {
                      const name = T.morning.line(l.line + 1);
                      if (!l.oee || l.key === undefined) return <li key={l.line}>{T.morning.noJob(name)}</li>;
                      const key = lineMachine(plant, l.line, l.key);
                      return (
                        <li key={l.line} className="go" onClick={go(key.thing)}>
                          {T.morning.oeeRow(name, pctText(Math.min(l.oee.oee, 10000)), pctText(l.oee.a), part(l.oee.p), part(l.oee.q))}
                          {l.loss ? <div className="muted">{lineLossText(plant, l)}</div> : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="mblock" data-test="morning-cleans">
                  <div className="mhead">{T.morning.cleansTitle}</div>
                  {cleanRows(v).length === 0 ? (
                    <div className="muted">{T.morning.noCleans}</div>
                  ) : (
                    <ul className="mlist">
                      {cleanRows(v).map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="mblock main" data-test="morning-main">
                  <div className="mhead">{T.morning.mainTitle}</div>
                  {v.main ? (
                    <>
                      <div
                        className={v.main.k === 'line' || (v.main.k === 'wait' && v.main.spot) ? 'go' : ''}
                        onClick={v.main.k === 'line' ? go(lineMachine(plant, v.main.line, v.main.key).thing) : v.main.k === 'wait' && v.main.spot ? goSpot(v.main.spot) : undefined}
                        data-test="morning-main-go"
                      >
                        <b>{mainText(plant, v.main)}</b>
                      </div>
                      <div className="hint">
                        <span className="muted">{T.morning.hintTitle}: </span>
                        {hintOf(v.main)}
                      </div>
                      <Levers list={mainLevers(v.main, v.policy)} hud={hud} actions={actions} close={close} />
                    </>
                  ) : (
                    <div className="muted">{T.morning.noMain}</div>
                  )}
                </div>
              </>
            )}
          </Section>
          <Section title={T.morning.heads}>
            <HeadsBlock list={v.heads} hud={hud} actions={actions} close={close} />
          </Section>
          <Section title={T.morning.since}>
            {v.deviations.length + v.decisions.length + v.maint.length + v.shipments.length + v.closed.length === 0 ? <div className="muted">{T.morning.nothing}</div> : null}
            <Rows
              title={T.morning.devTitle}
              rows={v.deviations.map((x, i) => (
                <li key={i} className="go" onClick={x.inv ? undefined : go({ kind: 'dev', n: x.dev })} data-test="morning-dev">
                  <span className="mono muted">{when(x.t)}</span> {T.morning.devKinds[x.kind]} <span className="mono">{T.dev.no(x.dev)}</span>
                  <span className={x.cls === 'minor' ? 'muted' : 'warn'} data-test="morning-dev-cls">
                    {' · '}
                    {T.dev.clsLow[x.cls] ?? x.cls}
                  </span>
                  {x.lot ? ` · ${named(db?.materials[x.material ?? '']?.name, x.material)} ${T.lotCode(...x.lot)}` : ''}
                  {x.batch ? ` · ${T.card.batch} ${x.batch}` : ''}
                  {x.inv ? (
                    <>
                      {' · '}
                      <span className="go" role="link" tabIndex={0} onClick={() => goInv(x.inv!)} onKeyDown={e => e.key === 'Enter' && goInv(x.inv!)} data-test="morning-inv">
                        {T.inv.button}
                      </span>
                    </>
                  ) : null}
                </li>
              ))}
            />
            <Rows
              title={T.morning.decTitle}
              rows={v.decisions.map((x, i) => (
                <li key={i}>
                  <span className="mono muted">{when(x.t)}</span> {named(db?.materials[x.material]?.name, x.material)} {T.lotCode(...x.lot)}
                  {x.batch ? ` (${T.card.batch} ${x.batch})` : ''}: {T.status[x.status]}
                </li>
              ))}
            />
            <Rows
              title={T.morning.maintTitle}
              rows={v.maint.map((x, i) => {
                const m = machineOf(x.thing, x.type);
                return (
                  <li key={i} className={x.thing ? 'go' : ''} onClick={go(x.thing)}>
                    <span className="mono muted">{when(x.t)}</span> {m.name}: {T.hist.maint[x.what]} · {partName(m.parts, x.part)} · {T.hist.wear(pctText(x.wear))}
                  </li>
                );
              })}
            />
            <Rows
              title={T.morning.shipTitle}
              rows={[
                ...v.shipments.map((x, i) => (
                  <li key={`s${i}`}>
                    <span className="mono muted">{when(x.t)}</span> {T.morning.shipped(named(db?.customers[x.customer]?.name, x.customer), x.cases)}
                  </li>
                )),
                ...v.closed.map((x, i) => (
                  <li key={`c${i}`} className="bad">
                    <span className="mono muted">{when(x.t)}</span> {T.morning.closed(named(db?.customers[x.customer]?.name, x.customer), x.status === 'late', x.missing)}
                  </li>
                )),
              ]}
            />
          </Section>
          <Section title={T.daily.title}>
            <DailyMeet d={v.daily} plant={plant} start={start} hud={hud} actions={actions} close={close} />
          </Section>
          <Section title={T.morning.now}>
            <div className="mblock" data-test="morning-now">
              <div className="mhead">{T.morning.labTitle}</div>
              <div>{T.morning.lab(v.lab.queued, v.lab.prep + v.lab.run, v.lab.review)}</div>
              {v.lab.busy.length ? <div className="muted">{T.morning.busy(v.lab.busy.map(id => named(db?.instruments[id]?.name, id)).join(', '))}</div> : null}
              {v.lab.oldest ? (
                <div className="muted">{T.morning.oldest(T.tasks[v.lab.oldest.task] ?? v.lab.oldest.task, when(v.lab.oldest.since), v.lab.oldest.wait ? T.wait[v.lab.oldest.wait] : '')}</div>
              ) : null}
            </div>
            <Rows
              title={T.morning.shortTitle}
              rows={v.short.map((x, i) => {
                const mat = db?.materials[x.material];
                return (
                  <li key={i}>
                    {T.morning.short(x.orders, x.pack, named(mat?.name, x.material), mat ? qtyText(x.qty, mat.unit) : num(x.qty))}
                    <span className="muted"> — {x.po ? T.morning.po(x.po.id, dayText(momentOf(start, x.po.eta).day)) : T.morning.noPo}</span>
                  </li>
                );
              })}
            />
            <Rows
              title={T.morning.brokenTitle}
              rows={v.broken.map((x, i) => {
                const m = machineOf(x.thing, x.type);
                return (
                  <li key={i} className={x.thing ? 'go bad' : 'bad'} onClick={go(x.thing)}>
                    {T.morning.broken(m.name, partName(m.parts, x.part), when(x.since))}
                    <span className="muted">, {T.morning.repair[x.repair]}</span>
                  </li>
                );
              })}
            />
            <Rows
              title={T.morning.riskTitle}
              rows={v.risk.map((x, i) => (
                <li key={i} className="bad" data-test="morning-risk">
                  {T.morning.risk(named(db?.customers[x.customer]?.name, x.customer), dayText(momentOf(start, x.due).day), x.missing)}
                  {x.pending > 0 ? <span className="muted">; {T.morning.pending(x.pending)}</span> : null}
                  <Levers list={riskLevers(x, scenario ?? {}, v.held)} hud={hud} actions={actions} close={close} />
                </li>
              ))}
            />
            <Rows
              title={T.jobs.uncovered}
              rows={
                // заказы без покрытия (Б6а): число — построчно они во вкладке «Задания» расписания
                v.uncovered
                  ? [
                      <li key="u" className="bad" data-test="morning-uncovered">
                        {T.jobs.morning(v.uncovered.orders, v.uncovered.cases)}
                        <Levers list={uncoveredLevers()} hud={hud} actions={actions} close={close} />
                      </li>,
                    ]
                  : []
              }
            />
            <Rows
              title={T.morning.pendingTitle}
              rows={[
                // что ждёт решения (Б1г): неоценённые отклонения — старшие первыми; удержанные серии
                ...v.pending.map(x => (
                  <li key={`d${x.dev}`} className={hud.t > x.due ? 'bad' : ''} data-test="morning-pending">
                    {T.morning.pendingDev(T.morning.devKinds[x.kind], T.dev.no(x.dev), x.batch ?? '', dayText(momentOf(start, x.due).day))}
                    <span className={x.cls === 'minor' ? 'muted' : 'warn'}>
                      {' · '}
                      {T.dev.clsLow[x.cls] ?? x.cls}
                    </span>
                    {x.late ? <span className="bad" data-test="morning-late"> · {T.morning.late}</span> : null}
                    {x.assessing ? <span className="muted"> · {T.morning.assessing}</span> : null}
                    {x.assessing ? null : <Levers list={devLevers(x)} hud={hud} actions={actions} close={close} />}
                    {x.bn !== undefined ? (
                      <button type="button" onClick={() => actions.openDossier(x.bn!)} title={T.dossier.hint} data-test="morning-dossier">
                        {T.dossier.button}
                      </button>
                    ) : null}
                  </li>
                )),
                ...v.held.map(x => (
                  <li key={`h${x.code}`} className="warn" data-test="morning-held">
                    {T.morning.heldRow(x.code)}
                    <Levers list={heldLevers(x)} hud={hud} actions={actions} close={close} />
                    <button type="button" onClick={() => actions.openDossier(x.bn)} title={T.dossier.hint} data-test="morning-dossier">
                      {T.dossier.button}
                    </button>
                  </li>
                )),
              ]}
            />
            {v.capa ? <CapaMeet c={v.capa} start={start} go={go} /> : null}
            {v.rejects ? <Rejects r={v.rejects} start={start} hud={hud} actions={actions} close={close} /> : null}
            <Rows
              title={T.morning.trainTitle}
              rows={[
                ...v.training.no.map(x => (
                  <li key={`no${x.person}`} className="go bad" onClick={go({ kind: 'person', n: x.person })} data-test="morning-train">
                    {T.morning.trainNo(T.card.person(named(db?.roles[x.role]?.name, x.role), x.tab), T.ref.doc(x.doc.code, x.doc.rev))}
                  </li>
                )),
                ...v.training.soon.map(x => (
                  <li key={`soon${x.person}`} className="go" onClick={go({ kind: 'person', n: x.person })} data-test="morning-train">
                    {T.morning.trainSoon(T.card.person(named(db?.roles[x.role]?.name, x.role), x.tab), T.ref.doc(x.doc.code, x.doc.rev), dayText(x.last))}
                  </li>
                )),
              ]}
            />
            <div className="mblock" data-test="morning-hours">
              <div className="mhead">{T.morning.hours.title}</div>
              <div>{v.hours.people > 0 ? T.morning.hours.yesterday(v.hours.people, durText(v.hours.sec), money(v.hours.pay)) : T.morning.hours.none}</div>
              {v.hours.near.length > 0 ? (
                <div className="muted">
                  {T.morning.hours.near(
                    v.hours.near.map(x => T.card.person(named(db?.roles[x.role]?.name, x.role), x.tab)).join(', '),
                    v.hours.near.map(x => hText(x.sec)).join(', '),
                    hText(v.hours.limit),
                  )}
                </div>
              ) : null}
              {v.hours.week.map(x => (
                <div key={x.day} className="muted">
                  {x.kind === 'holiday' ? T.morning.hours.holiday(dayText(x.day)) : T.morning.hours.short(dayText(x.day))}
                </div>
              ))}
              {v.hours.moves.map(x => (
                <div key={`m${x.person}`} className="go" onClick={go({ kind: 'person', n: x.person })} data-test="morning-move">
                  {T.morning.hours.move(T.card.person(named(db?.roles[x.role]?.name, x.role), x.tab), named(db?.shifts[x.shift]?.name, x.shift), dayText(x.from))}
                </div>
              ))}
              {v.hours.extra.map(x => (
                <div key={`e${x.shift}${x.day}`} className="muted" data-test="morning-extra">
                  {T.morning.hours.extra(named(db?.shifts[x.shift]?.name, x.shift), dayText(x.day), x.n)}
                </div>
              ))}
            </div>
            <BossMeeting rows={v.bosses} go={go} />
            <PeopleBlock v={v} hud={hud} actions={actions} close={close} go={go} />
            <Rows
              title={T.assets.morningTitle}
              rows={[
                ...v.assets.expired.map(x => (
                  <li key={`x${x.asset.id}${x.work}`} className={x.asset.thing ? 'go bad' : 'bad'} onClick={go(x.asset.thing)} data-test="morning-asset">
                    {T.assets.lapsed(workName(x.asset, x.work), assetName(x.asset))}
                  </li>
                )),
                ...v.assets.today.map(a => (
                  <li key={`t${a.id}`} className={a.thing ? 'go' : ''} onClick={go(a.thing)} data-test="morning-asset">
                    {T.assets.today(workName(a, a.visit!.work), assetName(a), a.working && a.visit?.to !== undefined ? T.assets.until(whenText(start, a.visit.to)) : whenText(start, a.visit!.from ?? a.visit!.at))}
                  </li>
                )),
                ...v.assets.soon.map(x => (
                  <li key={`s${x.asset.id}${x.work}`} className={x.asset.thing ? 'go' : ''} onClick={go(x.asset.thing)} data-test="morning-asset">
                    {T.assets.soon(workName(x.asset, x.work), assetName(x.asset), dayText(x.until))}
                  </li>
                )),
              ]}
            />
            <Rows
              title={T.morning.partnersTitle}
              rows={[
                // поставщики (Б3г): приостановленные пары, оценки в срок предупреждения и идущие, договоры, недобор
                ...v.partners.suspended.map(x => (
                  <li key={`ps${x.id}`} className="bad" data-test="morning-partner">
                    {T.morning.pairOff(pairName(x.supplier, x.maker), dayText((x.until ?? 0) + 1))}
                  </li>
                )),
                ...v.partners.soon.map(x => (
                  <li key={`pn${x.id}`} data-test="morning-partner">
                    {x.eval?.review
                      ? T.morning.pairReview(pairName(x.supplier, x.maker))
                      : x.eval?.how === 'audit' && x.eval.to !== undefined
                        ? T.morning.pairAudit(pairName(x.supplier, x.maker), whenText(start, x.eval.to))
                        : T.morning.pairSoon(pairName(x.supplier, x.maker), T.ref.how[x.how], dayText(x.until ?? 0))}
                  </li>
                )),
                ...v.partners.ending.map(x => (
                  <li key={`pe${x.id}`} data-test="morning-partner">
                    {T.morning.ctrEnds(x.id, named(db?.suppliers[x.party]?.name ?? db?.customers[x.party]?.name, x.party), dayText(x.to))}
                  </li>
                )),
                ...v.partners.short
                  .filter(x => x.need > 0)
                  .map(x => (
                    <li key={`pq${x.contract}${x.maker}`} data-test="morning-partner">
                      {T.morning.ctrShort(x.contract, pairName(x.supplier, x.maker), money(x.need), money(x.bought), money(x.volume))}
                    </li>
                  )),
              ]}
            />
            <div className="mblock">
              <div className="mhead">{T.morning.cashTitle}</div>
              <div>{T.morning.cash(money(v.cash.balance), money(v.cash.day, true))}</div>
              {v.cash.build !== undefined ? (
                <div className="muted" data-test="morning-build">
                  {T.morning.build(money(v.cash.build))}
                </div>
              ) : null}
              {v.units.length > 0 ? (
                <div className="muted" data-test="morning-units">
                  {T.equip.morning.title}:{' '}
                  {v.units
                    .map(u => T.equip.morning.row(`${named(db && (db.equipment[u.type] ?? db.machines[u.type] ?? db.instruments[u.type])?.name, u.type)} ${u.id}`, u.step === 'ordered' && u.due !== undefined ? T.equip.due(dayText(u.due)) : u.step === 'ordered' || u.step === 'swap' || u.step === 'accept' ? T.equip.steps[u.step] : T.equip.day(T.equip.steps[u.step], u.day, u.days)))
                    .join('; ')}
                </div>
              ) : null}
              {v.cash.next ? (
                <div className="muted">{T.morning.next(dayText(momentOf(start, v.cash.next.due).day), T.cash.items[v.cash.next.item], money(v.cash.next.sum))}</div>
              ) : null}
            </div>
          </Section>
        </>
      )}
      <div className="mfoot">
        <label title={T.morning.pauseHint}>
          <input type="checkbox" checked={pause} onChange={e => actions.setPause('morning', e.currentTarget.checked)} /> {T.morning.pause}
        </label>
        <span className="grow" />
        <button type="button" onClick={() => actions.closeMorning(true)} data-test="morning-resume">
          {T.morning.resume}
        </button>
        <button type="button" onClick={() => actions.closeMorning(false)}>
          {T.morning.close}
        </button>
      </div>
    </div>
  );
}
