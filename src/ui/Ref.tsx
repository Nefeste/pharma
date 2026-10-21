// Справочник завода (этап Б, Б1а и Б1в; docs/specs/2026-10-vertical-slice.md): большое окно поверх карты, как доска
// расследования, по F1 и кнопке. Вопрос окна — «Что и как делает завод, на чём, кем и с кем»: в каждой таблице слева — НСИ
// из базы, справа — что на заводе по факту и сейчас. Вид собирает поток расчёта (src/sim/ref.ts) — без скрытых параметров
// модели; здесь — слова и таблицы. Любую таблицу можно упорядочить по столбцу и сузить поиском по вкладке. Сколько идёт
// работа сейчас, окно считает по своим часам от мгновения её начала. Коды материалов и шапки документов (Б3а) — из базы,
// какая редакция действует сегодня — из вида.
import { type ReactNode, useState } from 'react';
import { DEPTS, type Dept, type OvertimeMode } from '../content/types';
import { daysFromCivil, weekday } from '../engine/core/calendar';
import type { DocKind } from '../engine/docs';
import { DEPT_SEAT } from '../engine/seats';
import { dayText, durText, hText, lang, money, named, num, pctText, priceText, qtyText, T, whenText } from '../i18n';
import type { RefContract, RefMaker, RefPair } from '../sim/partners';
import type { DocNow } from '../sim/people';
import type { AssetInfo, PlaceArea, PlaceCenter } from '../sim/places';
import type { RefCustomer, RefDoc, RefEquipment, RefInstrument, RefLine, RefMachine, RefMaterial, RefMethod, RefPart, RefPerson, RefRecipe, RefRole, RefShift, RefSku, RefStage, RefSupplier, RefView } from '../sim/ref';
import { assetClass, stateKey, untilText, unfitText, workName } from './assets';
import { admText } from './Card';
import { db, docText, headOf } from './db';
import { type Actions, type Hud, holds, REF_TABS } from './store';
import { attrNum, attrText, paramNum, paramText } from './units';

/**
 * Столбец таблицы: заголовок; текст ячейки — по нему ищет поиск и, если нет числа, упорядочивает столбец; что показать
 * вместо текста; число — порядок по числу (длительности, цены, штуки).
 */
export interface Col<X> {
  name: string;
  text: (x: X) => string;
  show?: (x: X) => ReactNode;
  num?: (x: X) => number;
}

/** Порядок таблицы: столбец и направление; нет — как в виде. */
export type By = { col: number; dir: 1 | -1 } | null;

/**
 * Строки таблицы по поиску и порядку: остаются строки, где набранное есть в тексте хоть одного столбца (без учёта
 * регистра); порядок — по числу столбца или по алфавиту языка, равные — как были.
 */
export function pickRows<X>(items: readonly X[], cols: readonly Col<X>[], q: string, by: By): X[] {
  const needle = q.trim().toLocaleLowerCase(lang);
  let rows = items.map((x, i) => ({ x, i }));
  if (needle) rows = rows.filter(({ x }) => cols.some(c => c.text(x).toLocaleLowerCase(lang).includes(needle)));
  if (by) {
    const c = cols[by.col];
    rows = [...rows].sort((a, b) => by.dir * (c.num ? c.num(a.x) - c.num(b.x) : c.text(a.x).localeCompare(c.text(b.x), lang)) || a.i - b.i);
  }
  return rows.map(r => r.x);
}

/** Таблица справочника: щелчок по заголовку — по возрастанию, ещё раз — по убыванию, третий — как было. */
function Table<X>({ cols, items, keyOf, q, test }: { cols: Col<X>[]; items: readonly X[]; keyOf: (x: X) => string; q: string; test?: string }) {
  const [by, setBy] = useState<By>(null);
  const rows = pickRows(items, cols, q, by);
  const click = (k: number) => setBy(p => (p?.col !== k ? { col: k, dir: 1 } : p.dir === 1 ? { col: k, dir: -1 } : null));
  return (
    <table className="rtable" data-test={test}>
      <thead>
        <tr>
          {cols.map((c, k) => (
            <th key={`${k}-${c.name}`} aria-sort={by?.col === k ? (by.dir === 1 ? 'ascending' : 'descending') : 'none'}>
              <button type="button" className={`sortbtn${by?.col === k ? ' on' : ''}`} onClick={() => click(k)} title={T.ref.sortHint} data-test="ref-sort">
                {c.name}
                {by?.col === k ? (by.dir === 1 ? ' ▲' : ' ▼') : ''}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(x => (
          <tr key={keyOf(x)}>
            {cols.map((c, k) => (
              <td key={`${k}-${c.name}`}>{c.show ? c.show(x) : c.text(x)}</td>
            ))}
          </tr>
        ))}
        {rows.length === 0 ? (
          <tr className="none">
            <td colSpan={cols.length} className="muted">
              {T.ref.notFound}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

const dash = () => T.ref.idle;
const unitOf = (material: string) => db?.materials[material]?.unit ?? 'mass';
/** Внутренний код материала или запчасти (Б3а). */
const codeOf = (material: string) => db?.materials[material]?.code ?? db?.spares[material]?.code ?? '';
/** Название документа: у инструкции по упаковке — имя позиции. */
const docName = (kind: DocKind, id: string) => named((db?.[kind] as Record<string, { name: { ru: string; en?: string } }> | undefined)?.[id]?.name, id);

function Products({ v, q }: { v: RefView; q: string }) {
  const c = T.ref.skuCols;
  const fg = (k: RefSku) => db?.skus[k.id]?.fg ?? '';
  const cols: Col<RefSku>[] = [
    { name: c.sku, text: k => named(db?.skus[k.id]?.name, k.id) },
    { name: c.code, text: k => codeOf(fg(k)), show: k => <span className="mono">{codeOf(fg(k))}</span> },
    { name: c.blister, text: k => T.ref.tablets(k.perBlister), num: k => k.perBlister },
    { name: c.blisters, text: k => num(k.blisters), num: k => k.blisters },
    { name: c.perCase, text: k => T.card.packs(k.perCase), show: k => <b>{T.card.packs(k.perCase)}</b>, num: k => k.perCase },
    { name: c.cases, text: k => num(k.cases), num: k => k.cases },
    { name: c.packs, text: k => num(k.perCase * k.cases), num: k => k.perCase * k.cases },
    { name: c.shelf, text: k => T.ref.months(k.shelf), num: k => k.shelf },
    { name: c.price, text: k => priceText(k.price), num: k => k.price },
    { name: c.regPrice, text: k => (k.regPrice !== undefined ? priceText(k.regPrice) : dash()), num: k => k.regPrice ?? -1 },
    { name: c.pi, text: k => docText('skus', k.id), show: k => <span className="mono nw">{docText('skus', k.id)}</span> },
  ];
  return (
    <>
      {v.products.map(p => (
        <section key={p.id} className="rsec">
          <div className="msec">{named(db?.products[p.id]?.name, p.id)}</div>
          <div className="muted">{T.ref.product(T.ref.forms[p.form] ?? p.form, num(db?.products[p.id]?.strength ?? 0), p.code)}</div>
          <Table test="ref-skus" cols={cols} items={p.skus} keyOf={k => k.id} q={q} />
        </section>
      ))}
    </>
  );
}

/** Пределы контроля: «97,0–103,0 %», «≥ 60 Н», «≤ 1,0 %». */
function ipcText(q: { test: string; min?: number; max?: number }): string {
  const attr = db?.tests[q.test]?.attr;
  if (!attr) return '';
  if (q.min !== undefined && q.max !== undefined) return `${attrNum(attr, q.min)}–${attrText(attr, q.max)}`;
  return q.min !== undefined ? `≥ ${attrText(attr, q.min)}` : q.max !== undefined ? `≤ ${attrText(attr, q.max)}` : '';
}

const rangeOf = (p: RefStage['params'][number]) => T.ref.range(paramText(p.unit, p.target), paramNum(p.unit, p.range[0]), paramText(p.unit, p.range[1]));
const paramLine = (p: RefStage['params'][number]) => `${T.ref.params[p.id] ?? p.id}: ${rangeOf(p)}`;
const ipcLine = (c: RefStage['ipc'][number]) => `${named(db?.tests[c.test]?.name, c.test)}: ${ipcText(c)}`;
const hasFact = (st: RefStage) => st.done > 0 && st.last !== undefined && st.mean !== undefined;

function Recipe({ r, t, q }: { r: RefRecipe; t: number; q: string }) {
  const c = T.ref.stageCols;
  const b = T.ref.bomCols;
  const order = new Map(r.stages.map((st, i) => [st.id, i + 1]));
  const head = headOf('recipes', r.id);
  const gone = (st: RefStage) => (st.now ? T.ref.now(durText(Math.max(0, t - st.now.from)), durText(st.now.nominal)) : '');
  const bom: Col<RefRecipe['bom'][number]>[] = [
    { name: b.code, text: l => codeOf(l.material), show: l => <span className="mono">{codeOf(l.material)}</span> },
    { name: b.material, text: l => named(db?.materials[l.material]?.name, l.material) },
    { name: b.qty, text: l => qtyText(l.qty, unitOf(l.material)), num: l => l.qty },
    { name: b.how, text: l => [l.potency ? T.ref.potency : '', l.qs ? T.ref.qs : ''].filter(Boolean).join(', ') },
  ];
  const stages: Col<RefStage>[] = [
    { name: c.n, text: st => num(order.get(st.id) ?? 0), num: st => order.get(st.id) ?? 0 },
    {
      name: c.stage,
      text: st => `${T.stages[st.id] ?? st.id}${st.mix ? ` ${T.ref.mix}` : ''}`,
      show: st => (
        <>
          {T.stages[st.id] ?? st.id}
          {st.mix ? <div className="muted small">{T.ref.mix}</div> : null}
        </>
      ),
    },
    { name: c.room, text: st => T.roomTypes[st.room] ?? st.room },
    { name: c.equipment, text: st => st.equipment.map(e => named(db?.equipment[e]?.name, e)).join(', ') },
    { name: c.staff, text: st => T.ref.staff(named(db?.roles[st.staff.role]?.name, st.staff.role), st.staff.n) },
    { name: c.plan, text: st => durText(st.nominal), show: st => <b className="nw">{durText(st.nominal)}</b>, num: st => st.nominal },
    {
      name: c.fact,
      text: st => (hasFact(st) ? `${T.ref.last(durText(st.last!))} ${T.ref.mean(durText(st.mean!), st.done)}` : T.ref.none),
      show: st =>
        hasFact(st) ? (
          <>
            <div className="nw">{T.ref.last(durText(st.last!))}</div>
            <div className="nw muted">{T.ref.mean(durText(st.mean!), st.done)}</div>
          </>
        ) : (
          <span className="muted">{T.ref.none}</span>
        ),
      num: st => st.mean ?? -1,
    },
    {
      name: c.now,
      text: st => (st.now ? `${st.now.batch} ${gone(st)}` : dash()),
      show: st =>
        st.now ? (
          <>
            <b>{st.now.batch}</b>
            <div className="nw">{gone(st)}</div>
          </>
        ) : (
          dash()
        ),
    },
    {
      name: c.params,
      text: st => st.params.map(paramLine).join('; ') || dash(),
      show: st =>
        st.params.length
          ? st.params.map(p => (
              <div key={p.id}>
                {T.ref.params[p.id] ?? p.id}: <span className="nw">{rangeOf(p)}</span>
              </div>
            ))
          : dash(),
    },
    {
      name: c.ipc,
      text: st => st.ipc.map(ipcLine).join('; ') || dash(),
      show: st =>
        st.ipc.length
          ? st.ipc.map(x => (
              <div key={x.test}>
                {named(db?.tests[x.test]?.name, x.test)}: <span className="nw">{ipcText(x)}</span>
              </div>
            ))
          : dash(),
    },
  ];
  return (
    <section className="rsec">
      <div className="msec">{named(db?.recipes[r.id]?.name, r.id)}</div>
      {head ? <div className="muted" data-test="ref-recipe-doc">{T.ref.recipeHead(docText('recipes', r.id), dayText(head.from), named(db?.roles[head.approved]?.name, head.approved))}</div> : null}
      <div className="muted">{T.ref.batch(qtyText(r.mass, 'mass'), T.ref.tablets(r.units))}</div>
      <Table cols={bom} items={r.bom} keyOf={l => l.material} q={q} />
      <Table test="ref-stages" cols={stages} items={r.stages} keyOf={st => st.id} q={q} />
    </section>
  );
}

function partsText(of: string, parts: RefPart[], item: string): string {
  const rec = db?.equipment[of] ?? db?.machines[of];
  return (
    parts
      .map(p => T.ref.part(named(rec?.parts.find(x => x.id === p.type)?.name, p.type), pctText(p.wear), T.ref.life(num(p.life), T.ref.lifeItems[item] ?? '')) + (p.failed ? `, ${T.card.failed}` : ''))
      .join('; ') || dash()
  );
}

/** Наибольший износ узлов — порядок столбца узлов: самые изношенные вверху или внизу. */
const worst = (parts: RefPart[]) => parts.reduce((m, p) => Math.max(m, p.wear), -1);

function Line({ l, n, q }: { l: RefLine; n: number; q: string }) {
  const c = T.ref.machineCols;
  const item = (m: RefMachine) => db?.machines[m.type]?.item ?? 'carton';
  const items = (m: RefMachine) => T.ref.items[item(m)] ?? '';
  const order = new Map(l.machines.map((m, i) => [m.id, i]));
  const cols: Col<RefMachine>[] = [
    { name: c.name, text: m => named(db?.machines[m.type]?.name, m.type), num: m => order.get(m.id) ?? 0 },
    { name: c.nominal, text: m => T.ref.perMin(num(m.nominal), items(m)), show: m => <b>{T.ref.perMin(num(m.nominal), items(m))}</b>, num: m => m.nominal },
    { name: c.buffer, text: m => (m.buffer !== undefined ? T.ref.buffer(num(m.buffer), items(m)) : dash()), num: m => m.buffer ?? -1 },
    { name: c.now, text: m => `${T.machine[m.state] ?? m.state}${m.rate > 0 ? ` · ${T.ref.perMin(num(m.rate), items(m))}` : ''}`, num: m => m.rate },
    { name: c.parts, text: m => partsText(m.type, m.parts, item(m)), num: m => worst(m.parts) },
  ];
  return (
    <section className="rsec">
      <div className="msec">{T.gantt.line(n)}</div>
      <div className="muted">{l.batch && l.sku ? T.ref.lineNow(l.batch, named(db?.skus[l.sku]?.name, l.sku)) : T.ref.lineIdle}</div>
      <Table test="ref-line" cols={cols} items={l.machines} keyOf={m => m.id} q={q} />
    </section>
  );
}

function Equipment({ v, q }: { v: RefView; q: string }) {
  const c = T.ref.eqCols;
  const cols: Col<RefEquipment>[] = [
    {
      name: c.name,
      text: e => `${named(db?.equipment[e.type]?.name, e.type)} ${e.id}`,
      show: e => (
        <>
          {named(db?.equipment[e.type]?.name, e.type)} <span className="muted mono">{e.id}</span>
        </>
      ),
    },
    { name: c.room, text: e => T.roomTypes[e.room] ?? e.room },
    { name: c.cleaning, text: e => `${durText(e.cleaning.minor)} · ${durText(e.cleaning.major)}`, num: e => e.cleaning.major },
    { name: c.parts, text: e => partsText(e.type, e.parts, 'equipment'), num: e => worst(e.parts) },
    { name: c.now, text: e => `${T.equipment[e.state]}${e.batch ? ` · ${T.ref.of(e.batch)}` : ''}` },
  ];
  return (
    <>
      <section className="rsec">
        <Table test="ref-equipment" cols={cols} items={v.equipment} keyOf={e => e.id} q={q} />
      </section>
      {v.lines.map((l, i) => (
        <Line key={l.id} l={l} n={i + 1} q={q} />
      ))}
    </>
  );
}

function Lab({ v, q }: { v: RefView; q: string }) {
  const i = T.ref.instCols;
  const m = T.ref.methodCols;
  const inst: Col<RefInstrument>[] = [
    {
      name: i.name,
      text: x => `${named(db?.instruments[x.type]?.name, x.type)} ${x.id}`,
      show: x => (
        <>
          {named(db?.instruments[x.type]?.name, x.type)} <span className="muted mono">{x.id}</span>
        </>
      ),
    },
    { name: i.room, text: x => T.roomTypes[x.room] ?? x.room },
    {
      name: i.now,
      text: x => (x.method ? named(db?.tests[x.method]?.name, x.method) : T.ref.instFree),
      show: x => (x.method ? named(db?.tests[x.method]?.name, x.method) : <span className="muted">{T.ref.instFree}</span>),
    },
  ];
  const methods: Col<RefMethod>[] = [
    { name: m.code, text: x => docText('tests', x.id), show: x => <span className="mono nw">{docText('tests', x.id)}</span> },
    { name: m.name, text: x => named(db?.tests[x.id]?.name, x.id) },
    {
      name: m.inst,
      text: x => (x.inst ? named(db?.instruments[x.inst]?.name, x.inst) : T.ref.noInst),
      show: x => (x.inst ? named(db?.instruments[x.inst]?.name, x.inst) : <span className="muted">{T.ref.noInst}</span>),
    },
    { name: m.prep, text: x => durText(x.prep), num: x => x.prep },
    { name: m.run, text: x => (x.run > 0 ? durText(x.run) : dash()), num: x => x.run },
    { name: m.alone, text: x => (x.unattended ? T.ref.yes : T.ref.no) },
    { name: m.queued, text: x => num(x.queued), num: x => x.queued },
    { name: m.running, text: x => num(x.running), num: x => x.running },
    { name: m.done, text: x => num(x.done), num: x => x.done },
  ];
  return (
    <>
      <section className="rsec">
        <Table test="ref-instruments" cols={inst} items={v.instruments} keyOf={x => x.id} q={q} />
      </section>
      <section className="rsec">
        <Table test="ref-methods" cols={methods} items={v.methods} keyOf={x => x.id} q={q} />
      </section>
    </>
  );
}

/** Производственный календарь (Б4а): месяц сеткой по дням недели, листать на год вперёд; норма часов месяца. */
function Calendar({ v }: { v: RefView }) {
  const [k, setK] = useState(0);
  const mo = v.calendar[Math.min(k, v.calendar.length - 1)];
  if (!mo) return null;
  const lead = weekday(daysFromCivil({ y: mo.y, m: mo.m, d: 1 }));
  return (
    <section className="rsec" data-test="ref-calendar" data-month={`${mo.y}-${mo.m}`}>
      <div className="phead">
        <b>{T.ref.calendar}</b>
        <span>{T.ref.calMonth(T.cash.months[mo.m - 1], mo.y, hText(mo.norm))}</span>
        <button type="button" disabled={k === 0} onClick={() => setK(k - 1)} data-test="cal-prev">
          {T.ref.calPrev}
        </button>
        <button type="button" disabled={k >= v.calendar.length - 1} onClick={() => setK(k + 1)} data-test="cal-next">
          {T.ref.calNext}
        </button>
      </div>
      <div className="cal">
        {T.date.weekdays.map(w => (
          <span key={w} className="wd">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {mo.days.map((d, i) => (
          <span key={i} className={d} title={T.ref.calKinds[d]} data-day={d}>
            {i + 1}
          </span>
        ))}
      </div>
      <div className="muted small">
        {(['work', 'short', 'off', 'holiday'] as const).map(d => (
          <span key={d} className={`calkey ${d}`}>
            {T.ref.calKinds[d]}: {num(mo.days.filter(x => x === d).length)}
          </span>
        ))}
      </div>
      <div className="muted small">{T.ref.calNote}</div>
    </section>
  );
}

/**
 * Политики отделов (Б4а): сверхурочные — «по потребности» или «только закончить начатое». Меняет пост отдела или
 * директор; места не выбраны — кто угодно (как команды других постов, 3е).
 */
function Policies({ v, hud, actions }: { v: RefView; hud: Hud; actions: Actions }) {
  const pc = T.ref.policyCols;
  const ot = v.overtime;
  const mine = (d: Dept) => holds(hud, DEPT_SEAT[d]);
  const cols: Col<Dept>[] = [
    { name: pc.dept, text: d => T.morning.depts[d] ?? d },
    { name: pc.overtime, text: d => T.ref.modes[v.policy[d]] ?? v.policy[d], show: d => <span data-test="policy-mode">{T.ref.modes[v.policy[d]] ?? v.policy[d]}</span> },
    {
      name: '',
      text: () => '',
      show: d => {
        const other: OvertimeMode = v.policy[d] === 'need' ? 'finish' : 'need';
        return (
          <button type="button" disabled={!mine(d)} onClick={() => actions.overtime(d, other)} title={mine(d) ? '' : T.seats.notYours(T.seats.names[DEPT_SEAT[d]])} data-test="policy-set" data-dept={d}>
            {T.ref.modeSet(T.ref.modes[other])}
          </button>
        );
      },
    },
    { name: pc.seat, text: d => T.seats.names[DEPT_SEAT[d]] ?? DEPT_SEAT[d] },
  ];
  return (
    <section className="rsec" data-test="ref-policy">
      <b>{T.ref.policy}</b>
      <Table cols={cols} items={[...DEPTS]} keyOf={d => d} q="" />
      <div className="muted small">{T.ref.policyNote(hText(ot.shift), hText(ot.year))}</div>
    </section>
  );
}

function People({ v, q, hud, actions }: { v: RefView; q: string; hud: Hud; actions: Actions }) {
  const r = T.ref.roleCols;
  const s = T.ref.shiftCols;
  const headcount = (x: RefRole) => x.shifts.reduce((n, sh) => n + sh.n, 0);
  const roles: Col<RefRole>[] = [
    { name: r.name, text: x => named(db?.roles[x.id]?.name, x.id) },
    { name: r.dept, text: x => T.morning.depts[x.dept] ?? x.dept },
    { name: r.salary, text: x => money(x.salary), num: x => x.salary },
    { name: r.shifts, text: x => x.shifts.map(sh => `${named(db?.shifts[sh.shift]?.name, sh.shift)} × ${sh.n}`).join('; '), num: headcount },
    { name: r.present, text: x => num(x.present), num: x => x.present },
    { name: r.busy, text: x => num(x.busy), num: x => x.busy },
  ];
  const shifts: Col<RefShift>[] = [
    { name: s.name, text: x => named(db?.shifts[x.id]?.name, x.id) },
    { name: s.days, text: x => x.days.map(d => T.date.weekdays[d]).join(', '), num: x => x.days.length },
    { name: s.hours, text: x => T.ref.hours(x.from, x.to), num: x => x.from },
    { name: s.break, text: x => (x.break > 0 ? durText(x.break) : T.ref.noBreak), num: x => x.break },
  ];
  // люди с допуском и матрица обучения (Б3б)
  const pc = T.ref.personCols;
  const ot = v.overtime;
  const admClass = (x: RefPerson) => (x.adm.k === 'no' ? 'bad' : x.adm.k === 'soon' ? 'warn' : '');
  const people: Col<RefPerson>[] = [
    { name: pc.tab, text: x => String(x.tab), show: x => <span className="mono">{x.tab}</span>, num: x => x.tab },
    { name: pc.role, text: x => named(db?.roles[x.role]?.name, x.role) },
    { name: pc.shift, text: x => named(db?.shifts[x.shift]?.name, x.shift) },
    { name: pc.skill, text: x => num(x.skill), num: x => x.skill },
    { name: pc.adm, text: x => admText(x.adm), show: x => <span className={admClass(x)}>{admText(x.adm)}</span> },
    // рабочее время (Б4а): по табелю месяца и за год
    { name: pc.month, text: x => T.ref.ofNorm(hText(x.hours.worked), hText(x.hours.norm)), num: x => x.hours.worked },
    { name: pc.over, text: x => (x.hours.over > 0 ? hText(x.hours.over) : '—'), num: x => x.hours.over },
    { name: pc.year, text: x => T.ref.ofNorm(hText(x.hours.year), hText(ot.year)), show: x => <span className={x.hours.year >= ot.year - ot.shift ? 'warn' : ''}>{T.ref.ofNorm(hText(x.hours.year), hText(ot.year))}</span>, num: x => x.hours.year },
  ];
  type Doc = { i: number; d: DocNow };
  const mc = T.ref.matrixCols;
  const cell = (x: Doc, j: number) => v.matrix.cells[x.i][j];
  const matrix: Col<Doc>[] = [
    { name: mc.doc, text: x => T.ref.doc(x.d.code, x.d.rev), show: x => <span className="mono">{T.ref.doc(x.d.code, x.d.rev)}</span> },
    { name: mc.name, text: x => docName(x.d.kind, x.d.id) },
    ...v.matrix.roles.map((r, j) => ({
      name: named(db?.roles[r]?.name, r),
      text: (x: Doc) => {
        const c = cell(x, j);
        return c ? T.ref.cell(c.ok, c.all) : '—';
      },
      show: (x: Doc) => {
        const c = cell(x, j);
        return c ? <span className={c.ok < c.all ? 'bad' : ''}>{T.ref.cell(c.ok, c.all)}</span> : <span className="muted">—</span>;
      },
      num: (x: Doc) => cell(x, j)?.ok ?? -1,
    })),
  ];
  return (
    <>
      <section className="rsec">
        <Table test="ref-roles" cols={roles} items={v.roles.filter(x => x.shifts.length > 0)} keyOf={x => x.id} q={q} />
      </section>
      <section className="rsec">
        <Table test="ref-people" cols={people} items={v.people} keyOf={x => String(x.person)} q={q} />
      </section>
      <section className="rsec">
        <Table cols={shifts} items={v.shifts} keyOf={x => x.id} q={q} />
      </section>
      <Policies v={v} hud={hud} actions={actions} />
      <Calendar v={v} />
      <section className="rsec">
        <Table test="ref-matrix" cols={matrix} items={v.matrix.docs.map((d, i) => ({ i, d }))} keyOf={x => x.d.code} q={q} />
      </section>
      <div className="muted small">{T.ref.matrixNote}</div>
    </>
  );
}

/** Название материала с кодом: «100001 Парацетамол». */
const matName = (m: string) => `${codeOf(m)} ${named(db?.materials[m]?.name, m)}`;
const supName = (id: string) => named(db?.suppliers[id]?.name, id);
const makerName = (id: string) => named(db?.makers[id]?.name, id);

/** Состояние одобрения пары словами (Б3г): «с 30.11.2026 до 29.11.2027»; приостановлена; идёт оценка. */
function pairState(x: RefPair, start: { y: number; m: number; d: number }): string {
  const base = x.until === undefined ? T.ref.pairNone : x.ok ? T.ref.pairOk(dayText(x.since!), dayText(x.until)) : T.ref.pairOff(dayText(x.until));
  const e = x.eval;
  const ev = !e ? '' : e.review ? T.ref.pairReview : e.how === 'audit' && e.to !== undefined ? T.ref.pairAudit(whenText(start, e.to)) : '';
  return [base, ev].filter(Boolean).join(' · ');
}

/** Строка договора: «100001 Парацетамол: 5,20 ₽/кг · обещано 13 029,6 кг · куплено 2 100,0 кг». */
function ctrLine(l: RefContract['lines'][number]): string {
  const unit = unitOf(l.material);
  const price = unit === 'mass' ? T.ref.perKg(priceText(l.price)) : T.ref.perPcs(priceText(l.price));
  return T.ref.ctrLine(matName(l.material), price, qtyText(l.volume, unit), qtyText(l.bought, unit));
}

function Partners({ v, q, start }: { v: RefView; q: string; start: { y: number; m: number; d: number } }) {
  const s = T.ref.supCols;
  const c = T.ref.cusCols;
  const p = v.partners;
  const mk = T.ref.makerCols;
  const makers: Col<RefMaker>[] = [
    { name: mk.name, text: x => makerName(x.id) },
    { name: mk.country, text: x => named(db?.makers[x.id]?.country) },
    { name: mk.site, text: x => named(db?.makers[x.id]?.site) },
    { name: mk.makes, text: x => x.makes.map(matName).join('; '), show: x => <>{x.makes.map(m => <div key={m}>{matName(m)}</div>)}</>, num: x => x.makes.length },
  ];
  const pc = T.ref.pairCols;
  const pairs: Col<RefPair>[] = [
    { name: pc.supplier, text: x => supName(x.supplier) },
    { name: pc.maker, text: x => makerName(x.maker) },
    { name: pc.materials, text: x => x.materials.map(matName).join('; '), show: x => <>{x.materials.map(m => <div key={m}>{matName(m)}</div>)}</>, num: x => x.materials.length },
    { name: pc.how, text: x => T.ref.how[x.how] },
    { name: pc.until, text: x => pairState(x, start), show: x => <span className={x.ok ? '' : 'bad'} data-test="ref-pair-state">{pairState(x, start)}</span>, num: x => x.until ?? -1 },
    { name: pc.agreement, text: x => (x.agreement ? docText('agreements', x.agreement) : T.ref.noAgreement), show: x => (x.agreement ? <span className="mono nw">{docText('agreements', x.agreement)}</span> : <span className="bad">{T.ref.noAgreement}</span>) },
  ];
  const cc = T.ref.ctrCols;
  const party = (x: RefContract) => (x.kind === 'frame' ? supName(x.party) : named(db?.customers[x.party]?.name, x.party));
  const contracts: Col<RefContract>[] = [
    { name: cc.no, text: x => x.id, show: x => <span className="mono">{x.id}</span> },
    { name: cc.party, text: party },
    { name: cc.kind, text: x => T.ref.ctrKinds[x.kind] },
    { name: cc.term, text: x => T.ref.term(dayText(x.from), dayText(x.to)), num: x => x.to },
    { name: cc.lines, text: x => x.lines.map(ctrLine).join('; '), show: x => <>{x.lines.map(l => <div key={l.material}>{ctrLine(l)}</div>)}</>, num: x => x.lines.length },
  ];
  const contractOf = (party: string) => p.contracts.find(x => x.party === party);
  const itemLine = (it: RefSupplier['items'][number]) => {
    const unit = unitOf(it.material);
    const price = unit === 'mass' ? T.ref.perKg(priceText(it.price)) : T.ref.perPcs(priceText(it.price));
    return `${codeOf(it.material)} ${named(db?.materials[it.material]?.name, it.material)}: ${price} · ${qtyText(it.moq, unit)}`;
  };
  const spareLine = (sp: RefSupplier['spares'][number]) => T.ref.spare(`${codeOf(sp.spare)} ${named(db?.spares[sp.spare]?.name, sp.spare)}`, priceText(sp.price), T.ref.dayRange(sp.lead[0], sp.lead[1]));
  const suppliers: Col<RefSupplier>[] = [
    { name: s.name, text: x => named(db?.suppliers[x.id]?.name, x.id) },
    {
      name: s.items,
      text: x => [...x.items.map(itemLine), ...x.spares.map(spareLine)].join('; '),
      show: x => (
        <>
          {x.items.map(it => (
            <div key={it.material}>{itemLine(it)}</div>
          ))}
          {x.spares.map(sp => (
            <div key={sp.spare}>{spareLine(sp)}</div>
          ))}
        </>
      ),
      num: x => x.items.length + x.spares.length,
    },
    { name: s.lead, text: x => T.ref.dayRange(x.lead[0], x.lead[1]), num: x => x.lead[1] },
    { name: s.prepay, text: x => pctText(x.prepay), num: x => x.prepay },
    { name: s.pay, text: x => T.ref.days(x.payDays), num: x => x.payDays },
    { name: s.maker, text: x => (x.maker ? T.ref.selfMaker : T.ref.distributor) },
  ];
  const customers: Col<RefCustomer>[] = [
    { name: c.name, text: x => named(db?.customers[x.id]?.name, x.id) },
    { name: c.pay, text: x => T.ref.days(x.payDays), num: x => x.payDays },
    { name: c.orders, text: x => T.ref.orders(x.days.map(d => T.date.weekdays[d]).join(', '), x.hour), num: x => x.days.length },
    { name: c.lead, text: x => T.ref.dayRange(x.lead[0], x.lead[1]), num: x => x.lead[1] },
    { name: c.shelf, text: x => pctText(x.minShelf), num: x => x.minShelf },
    { name: c.contract, text: x => (contractOf(x.id) ? `${contractOf(x.id)!.id} · ${T.ref.term(dayText(contractOf(x.id)!.from), dayText(contractOf(x.id)!.to))}` : dash()) },
  ];
  return (
    <>
      <section className="rsec">
        <div className="msec">{T.ref.partnerSecs.makers}</div>
        <Table test="ref-makers" cols={makers} items={p.makers} keyOf={x => x.id} q={q} />
      </section>
      <section className="rsec">
        <div className="msec">{T.ref.partnerSecs.suppliers}</div>
        <Table test="ref-suppliers" cols={suppliers} items={v.suppliers} keyOf={x => x.id} q={q} />
      </section>
      <section className="rsec">
        <div className="msec">{T.ref.partnerSecs.pairs}</div>
        <Table test="ref-pairs" cols={pairs} items={p.pairs} keyOf={x => x.id} q={q} />
      </section>
      <section className="rsec">
        <div className="msec">{T.ref.partnerSecs.contracts}</div>
        <Table test="ref-contracts" cols={contracts} items={p.contracts} keyOf={x => x.id} q={q} />
      </section>
      <section className="rsec">
        <div className="msec">{T.ref.partnerSecs.customers}</div>
        <Table test="ref-customers" cols={customers} items={v.customers} keyOf={x => x.id} q={q} />
      </section>
      <div className="muted small">{T.ref.partnersNote}</div>
    </>
  );
}

/** Режим хранения словами и числами (Б3в): «При контролируемой комнатной температуре: 15–25 °C, влажность не выше 65 %». */
function regimeText(id: string | undefined): string {
  const r = id ? db?.regimes[id] : undefined;
  return r ? T.assets.regime(named(r.name, id), num(r.temp[0] / 10), num(r.temp[1] / 10), num(r.rh / 100)) : '';
}

/**
 * Места (Б3в): площадка → участки → рабочие места → оборудование и приборы. У каждого актива — код места, инвентарный
 * номер, класс, критическое ли, квалификация и калибровка «до», состояние; у зоны хранения — режим и поверка её датчика.
 */
function Places({ v, q, actions }: { v: RefView; q: string; actions: Actions }) {
  const p = v.places;
  const c = T.assets.cols;
  const show = (a: AssetInfo) => (a.thing ? () => actions.show(a.thing!) : undefined);
  const rec = (a: AssetInfo, w: 'qual' | 'cal') => (a.needs.includes(w) ? untilText(w === 'qual' ? a.qual : a.cal, a.today) : dash());
  const cols: Col<AssetInfo>[] = [
    { name: c.place, text: a => a.place, show: a => <span className="mono">{a.place}</span> },
    { name: c.inv, text: a => T.assets.inv(a.inv), show: a => <span className="mono nw" data-test="places-inv">{T.assets.inv(a.inv)}</span>, num: a => a.inv },
    {
      name: c.what,
      text: a => assetClass(a),
      show: a =>
        a.thing ? (
          <button type="button" className="link" onClick={show(a)}>
            {assetClass(a)}
          </button>
        ) : (
          assetClass(a)
        ),
    },
    { name: c.family, text: a => T.assets.families[a.family] ?? a.family },
    { name: c.critical, text: a => (a.critical ? T.assets.critical : '') },
    { name: c.qual, text: a => rec(a, 'qual'), num: a => a.qual?.until ?? -1 },
    { name: c.cal, text: a => (a.needs.includes('cal') ? `${a.verify ? `${T.assets.work.verify}: ` : ''}${rec(a, 'cal')}` : dash()), num: a => a.cal?.until ?? -1 },
    {
      name: c.state,
      text: a => {
        const k = stateKey(a);
        const visit = a.visit ? ` · ${workName(a, a.visit.work)}` : '';
        return k === 'expired' ? `${T.assets.state.expired} — ${unfitText(a)}` : `${T.assets.state[k]}${k === 'visit' || k === 'working' || k === 'accepting' ? visit : ''}`;
      },
      show: a => {
        const k = stateKey(a);
        const visit = a.visit ? ` · ${workName(a, a.visit.work)}` : '';
        return (
          <span className={k === 'expired' ? 'bad' : k === 'ok' || k === 'none' ? 'muted' : ''} data-test="places-state" data-state={k}>
            {k === 'expired' ? `${T.assets.state.expired} — ${unfitText(a)}` : `${T.assets.state[k]}${k === 'visit' || k === 'working' || k === 'accepting' ? visit : ''}`}
          </span>
        );
      },
    },
  ];
  const rooms = (list: string[]) => list.map(t => T.roomTypes[t] ?? t).join(', ');
  const center = (x: PlaceCenter) => (
    <div key={x.code} className="rsub" data-test="places-center" data-code={x.code}>
      <div>
        <b className="mono">{x.code}</b> · {named(x.name, x.code)} <span className="muted">— {T.assets.centers[x.kind] ?? x.kind}</span>
      </div>
      {x.kind === 'storage' ? (
        <div className="muted" data-test="places-regime">
          {regimeText(x.regime)}
          {x.rooms.length ? ` · ${T.assets.rooms(rooms(x.rooms))}` : ''}
          {x.closed ? <b className="bad"> · {T.assets.closed}</b> : null}
        </div>
      ) : null}
      <Table test="ref-places" cols={cols} items={x.assets} keyOf={a => a.id} q={q} />
    </div>
  );
  const area = (a: PlaceArea) => (
    <section key={a.code} className="rsec" data-test="places-area" data-code={a.code}>
      <div className="msec">
        <span className="mono">{a.code}</span> · {named(a.name, a.code)}
      </div>
      {a.rooms.length ? <div className="muted">{T.assets.rooms(rooms(a.rooms))}</div> : null}
      {a.centers.map(center)}
      {a.vehicles.length ? (
        <div className="rsub">
          <div>{T.assets.vehicles}</div>
          <Table test="ref-places" cols={cols} items={a.vehicles} keyOf={x => x.id} q={q} />
        </div>
      ) : null}
    </section>
  );
  return (
    <>
      <div className="muted" data-test="places-site">
        <b className="mono">{p.site.code}</b> · {named(p.site.name, p.site.code)} · {T.assets.ahead(p.ahead)}
      </div>
      {p.areas.map(area)}
      {p.common.length ? <div className="muted small">{T.assets.common(rooms(p.common))}</div> : null}
    </>
  );
}

/** Номенклатура (Б3а): код, вид, единица учёта с кодом ОКЕИ, срок годности, спецификация, действующая сегодня. */
function Materials({ v, q }: { v: RefView; q: string }) {
  const c = T.ref.matCols;
  const name = (x: RefMaterial) => named(db?.materials[x.id]?.name ?? db?.spares[x.id]?.name, x.id);
  const shelf = (x: RefMaterial) => db?.materials[x.id]?.shelf;
  const cols: Col<RefMaterial>[] = [
    { name: c.code, text: x => codeOf(x.id), show: x => <span className="mono">{codeOf(x.id)}</span>, num: x => Number(codeOf(x.id)) },
    { name: c.name, text: name },
    { name: c.kind, text: x => T.ref.matKinds[x.kind] ?? x.kind },
    { name: c.unit, text: x => T.ref.okei(T.ref.unitNames[x.unit] ?? x.unit, x.okei), num: x => x.okei },
    { name: c.shelf, text: x => (shelf(x) !== undefined ? T.ref.months(shelf(x)!) : dash()), num: x => shelf(x) ?? -1 },
    // режим хранения, который материал требует (Б3в)
    { name: c.storage, text: x => (db?.materials[x.id] ? named(db?.regimes[db.materials[x.id].storage]?.name, db.materials[x.id].storage) : dash()) },
    { name: c.spec, text: x => (x.spec ? docText('specs', x.spec) : dash()), show: x => (x.spec ? <span className="mono nw">{docText('specs', x.spec)}</span> : dash()) },
    // одобренные пары действующей спецификации (Б3г)
    { name: c.pairs, text: x => (x.pairs ?? []).map(pr => T.ref.pair(supName(pr.supplier), makerName(pr.maker))).join('; ') || dash() },
  ];
  return (
    <section className="rsec">
      <Table test="ref-materials" cols={cols} items={v.materials} keyOf={x => x.id} q={q} />
    </section>
  );
}

/** Регламентирующие документы (Б3а): код, название, вид, редакция, день введения, кто утвердил, статус на сегодня. */
function Docs({ v, q }: { v: RefView; q: string }) {
  const c = T.ref.docCols;
  const head = (x: RefDoc) => headOf(x.kind, x.id);
  const cols: Col<RefDoc>[] = [
    { name: c.code, text: x => head(x)?.code ?? '', show: x => <span className="mono">{head(x)?.code}</span> },
    { name: c.name, text: x => docName(x.kind, x.id) },
    { name: c.kind, text: x => T.ref.docKinds[x.kind] ?? x.kind },
    { name: c.rev, text: x => num(head(x)?.rev ?? 0), num: x => head(x)?.rev ?? 0 },
    { name: c.from, text: x => (head(x) ? dayText(head(x)!.from) : ''), num: x => head(x)?.from ?? 0 },
    { name: c.approved, text: x => named(db?.roles[head(x)?.approved ?? '']?.name, head(x)?.approved) },
    { name: c.status, text: x => T.ref.docStatus[x.status] ?? x.status, show: x => <span className={x.status === 'active' ? '' : 'muted'}>{T.ref.docStatus[x.status] ?? x.status}</span> },
  ];
  return (
    <>
      <section className="rsec">
        <Table test="ref-docs" cols={cols} items={v.docs} keyOf={x => `${x.kind}/${x.id}`} q={q} />
      </section>
      <div className="muted small">{T.ref.docsNote}</div>
    </>
  );
}

export function Ref({ hud, actions }: { hud: Hud; actions: Actions }) {
  const v = hud.ref.view;
  const tab = hud.ref.tab;
  // поиск — по всем таблицам вкладки; живёт, пока окно открыто
  const [q, setQ] = useState('');
  return (
    <div className="ref panel" id="ref" role="dialog" aria-labelledby="ref-title" data-test="ref">
      <div className="phead">
        <b id="ref-title">{T.ref.title}</b>
        <span className="muted">{T.ref.question}</span>
        <span className="filters">
          {REF_TABS.map(k => (
            <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => actions.setRefTab(k)} data-test="ref-tab" data-tab={k}>
              {T.ref.tabs[k]}
            </button>
          ))}
        </span>
        <input type="search" className="rsearch" value={q} onChange={e => setQ(e.target.value)} placeholder={T.ref.search} aria-label={T.ref.search} data-test="ref-search" />
        <button type="button" className="close" onClick={() => actions.toggleRef()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {!v ? <div className="muted">{T.app.loading}</div> : null}
      {v ? (
        <div className="rbody" data-test="ref-body" data-tab={tab}>
          {tab === 'products' ? <Products v={v} q={q} /> : null}
          {tab === 'materials' ? <Materials v={v} q={q} /> : null}
          {tab === 'recipes' ? (
            <>
              {v.recipes.map(r => (
                <Recipe key={r.id} r={r} t={hud.t} q={q} />
              ))}
              <div className="muted small">{T.ref.planNote}</div>
            </>
          ) : null}
          {tab === 'equipment' ? <Equipment v={v} q={q} /> : null}
          {tab === 'places' ? <Places v={v} q={q} actions={actions} /> : null}
          {tab === 'lab' ? <Lab v={v} q={q} /> : null}
          {tab === 'people' ? <People v={v} q={q} hud={hud} actions={actions} /> : null}
          {tab === 'partners' ? <Partners v={v} q={q} start={hud.start} /> : null}
          {tab === 'docs' ? <Docs v={v} q={q} /> : null}
          <div className="muted small">{T.ref.noHidden}</div>
        </div>
      ) : null}
    </div>
  );
}
