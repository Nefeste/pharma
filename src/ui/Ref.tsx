// Справочник завода (этап Б, Б1а; docs/specs/2026-10-vertical-slice.md): большое окно поверх карты, как доска
// расследования, по F1 и кнопке. Вопрос окна — «Как должно быть и как есть»: слева в каждой таблице — НСИ из базы, справа —
// что на заводе по факту и сейчас. Вид собирает поток расчёта (src/sim/ref.ts) — без скрытых параметров модели; здесь —
// слова и таблицы. Сколько идёт работа сейчас, окно считает по своим часам от мгновения её начала.
import type { ReactNode } from 'react';
import { durText, money, named, num, pctText, priceText, qtyText, T } from '../i18n';
import type { RefLine, RefPart, RefRecipe, RefView } from '../sim/ref';
import { db } from './db';
import { type Actions, type Hud, REF_TABS } from './store';
import { attrNum, attrText, paramNum, paramText } from './units';

function Table({ cols, rows, test }: { cols: string[]; rows: ReactNode[][]; test?: string }) {
  return (
    <table className="rtable" data-test={test}>
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={`${i}-${c}`}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: строки таблицы не переставляются
          <tr key={i}>
            {r.map((c, k) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: столбцы постоянны
              <td key={k}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const dash = T.ref.idle;
const unitOf = (material: string) => db?.materials[material]?.unit ?? 'mass';

function Products({ v }: { v: RefView }) {
  const c = T.ref.skuCols;
  return (
    <>
      {v.products.map(p => (
        <section key={p.id} className="rsec">
          <div className="msec">{named(db?.products[p.id]?.name, p.id)}</div>
          <div className="muted">{T.ref.product(T.ref.forms[p.form] ?? p.form, p.code)}</div>
          <Table
            test="ref-skus"
            cols={[c.sku, c.blister, c.blisters, c.perCase, c.cases, c.packs, c.shelf, c.price, c.regPrice]}
            rows={p.skus.map(k => [
              named(db?.skus[k.id]?.name, k.id),
              T.ref.tablets(k.perBlister),
              num(k.blisters),
              <b key="case">{T.card.packs(k.perCase)}</b>,
              num(k.cases),
              num(k.perCase * k.cases),
              T.ref.months(k.shelf),
              priceText(k.price),
              k.regPrice !== undefined ? priceText(k.regPrice) : dash,
            ])}
          />
        </section>
      ))}
    </>
  );
}

function Recipe({ r, t }: { r: RefRecipe; t: number }) {
  const c = T.ref.stageCols;
  const b = T.ref.bomCols;
  return (
    <section className="rsec">
      <div className="msec">{named(db?.recipes[r.id]?.name, r.id)}</div>
      <div className="muted">{T.ref.batch(qtyText(r.mass, 'mass'), T.ref.tablets(r.units))}</div>
      <Table
        cols={[b.material, b.qty, b.how]}
        rows={r.bom.map(l => [named(db?.materials[l.material]?.name, l.material), qtyText(l.qty, unitOf(l.material)), [l.potency ? T.ref.potency : '', l.qs ? T.ref.qs : ''].filter(Boolean).join(', ')])}
      />
      <Table
        test="ref-stages"
        cols={[c.n, c.stage, c.room, c.equipment, c.staff, c.plan, c.fact, c.now, c.params, c.ipc]}
        rows={r.stages.map((st, i) => [
          num(i + 1),
          <>
            {T.stages[st.id] ?? st.id}
            {st.mix ? <div className="muted small">{T.ref.mix}</div> : null}
          </>,
          T.roomTypes[st.room] ?? st.room,
          st.equipment.map(e => named(db?.equipment[e]?.name, e)).join(', '),
          T.ref.staff(named(db?.roles[st.staff.role]?.name, st.staff.role), st.staff.n),
          <b key="plan" className="nw">
            {durText(st.nominal)}
          </b>,
          st.done > 0 && st.last !== undefined && st.mean !== undefined ? (
            <>
              <div className="nw">{T.ref.last(durText(st.last))}</div>
              <div className="nw muted">{T.ref.mean(durText(st.mean), st.done)}</div>
            </>
          ) : (
            <span className="muted">{T.ref.none}</span>
          ),
          st.now ? (
            <>
              <b>{st.now.batch}</b>
              <div className="nw">{T.ref.now(durText(Math.max(0, t - st.now.from)), durText(st.now.nominal))}</div>
            </>
          ) : (
            dash
          ),
          st.params.length ? (
            <>
              {st.params.map(p => (
                <div key={p.id}>
                  {T.ref.params[p.id] ?? p.id}: <span className="nw">{T.ref.range(paramText(p.unit, p.target), paramNum(p.unit, p.range[0]), paramText(p.unit, p.range[1]))}</span>
                </div>
              ))}
            </>
          ) : (
            dash
          ),
          st.ipc.length ? (
            <>
              {st.ipc.map(q => (
                <div key={q.test}>
                  {named(db?.tests[q.test]?.name, q.test)}: <span className="nw">{ipcText(q)}</span>
                </div>
              ))}
            </>
          ) : (
            dash
          ),
        ])}
      />
    </section>
  );
}

/** Пределы контроля: «97,0–103,0 %», «≥ 60 Н», «≤ 1,0 %». */
function ipcText(q: { test: string; min?: number; max?: number }): string {
  const attr = db?.tests[q.test]?.attr;
  if (!attr) return '';
  if (q.min !== undefined && q.max !== undefined) return `${attrNum(attr, q.min)}–${attrText(attr, q.max)}`;
  return q.min !== undefined ? `≥ ${attrText(attr, q.min)}` : q.max !== undefined ? `≤ ${attrText(attr, q.max)}` : '';
}

function partsText(of: string, parts: RefPart[], item: string): string {
  const rec = db?.equipment[of] ?? db?.machines[of];
  return (
    parts
      .map(p => T.ref.part(named(rec?.parts.find(x => x.id === p.type)?.name, p.type), pctText(p.wear), T.ref.life(num(p.life), T.ref.lifeItems[item] ?? '')) + (p.failed ? `, ${T.card.failed}` : ''))
      .join('; ') || dash
  );
}

function Line({ l, n }: { l: RefLine; n: number }) {
  const c = T.ref.machineCols;
  return (
    <section className="rsec">
      <div className="msec">{T.gantt.line(n)}</div>
      <div className="muted">{l.batch && l.sku ? T.ref.lineNow(l.batch, named(db?.skus[l.sku]?.name, l.sku)) : T.ref.lineIdle}</div>
      <Table
        test="ref-line"
        cols={[c.name, c.nominal, c.buffer, c.now, c.parts]}
        rows={l.machines.map(m => {
          const item = db?.machines[m.type]?.item ?? 'carton';
          const items = T.ref.items[item] ?? '';
          return [
            named(db?.machines[m.type]?.name, m.type),
            <b key="nom">{T.ref.perMin(num(m.nominal), items)}</b>,
            m.buffer !== undefined ? T.ref.buffer(num(m.buffer), items) : dash,
            `${T.machine[m.state] ?? m.state}${m.rate > 0 ? ` · ${T.ref.perMin(num(m.rate), items)}` : ''}`,
            partsText(m.type, m.parts, item),
          ];
        })}
      />
    </section>
  );
}

function Equipment({ v }: { v: RefView }) {
  const c = T.ref.eqCols;
  return (
    <>
      <section className="rsec">
        <Table
          test="ref-equipment"
          cols={[c.name, c.room, c.cleaning, c.parts, c.now]}
          rows={v.equipment.map(e => [
            <>
              {named(db?.equipment[e.type]?.name, e.type)} <span className="muted mono">{e.id}</span>
            </>,
            T.roomTypes[e.room] ?? e.room,
            `${durText(e.cleaning.minor)} · ${durText(e.cleaning.major)}`,
            partsText(e.type, e.parts, 'equipment'),
            `${T.equipment[e.state]}${e.batch ? ` · ${T.ref.of(e.batch)}` : ''}`,
          ])}
        />
      </section>
      {v.lines.map((l, i) => (
        <Line key={l.id} l={l} n={i + 1} />
      ))}
    </>
  );
}

function Lab({ v }: { v: RefView }) {
  const i = T.ref.instCols;
  const m = T.ref.methodCols;
  return (
    <>
      <section className="rsec">
        <Table
          test="ref-instruments"
          cols={[i.name, i.room, i.now]}
          rows={v.instruments.map(x => [
            <>
              {named(db?.instruments[x.type]?.name, x.type)} <span className="muted mono">{x.id}</span>
            </>,
            T.roomTypes[x.room] ?? x.room,
            x.method ? named(db?.tests[x.method]?.name, x.method) : <span className="muted">{T.ref.instFree}</span>,
          ])}
        />
      </section>
      <section className="rsec">
        <Table
          test="ref-methods"
          cols={[m.name, m.inst, m.prep, m.run, m.alone, m.queued, m.running, m.done]}
          rows={v.methods.map(x => [
            named(db?.tests[x.id]?.name, x.id),
            x.inst ? named(db?.instruments[x.inst]?.name, x.inst) : <span className="muted">{T.ref.noInst}</span>,
            durText(x.prep),
            x.run > 0 ? durText(x.run) : dash,
            x.unattended ? T.ref.yes : T.ref.no,
            num(x.queued),
            num(x.running),
            num(x.done),
          ])}
        />
      </section>
    </>
  );
}

function People({ v }: { v: RefView }) {
  const r = T.ref.roleCols;
  const s = T.ref.shiftCols;
  return (
    <>
      <section className="rsec">
        <Table
          test="ref-roles"
          cols={[r.name, r.dept, r.salary, r.shifts, r.present, r.busy]}
          rows={v.roles
            .filter(x => x.shifts.length > 0)
            .map(x => [
              named(db?.roles[x.id]?.name, x.id),
              T.morning.depts[x.dept] ?? x.dept,
              money(x.salary),
              x.shifts.map(sh => `${named(db?.shifts[sh.shift]?.name, sh.shift)} × ${sh.n}`).join('; '),
              num(x.present),
              num(x.busy),
            ])}
        />
      </section>
      <section className="rsec">
        <Table
          cols={[s.name, s.days, s.hours]}
          rows={v.shifts.map(x => [named(db?.shifts[x.id]?.name, x.id), x.days.map(d => T.date.weekdays[d]).join(', '), T.ref.hours(x.from, x.to)])}
        />
      </section>
    </>
  );
}

function Partners({ v }: { v: RefView }) {
  const s = T.ref.supCols;
  const c = T.ref.cusCols;
  return (
    <>
      <section className="rsec">
        <Table
          test="ref-suppliers"
          cols={[s.name, s.items, s.lead, s.prepay, s.pay, s.approved]}
          rows={v.suppliers.map(x => [
            named(db?.suppliers[x.id]?.name, x.id),
            <>
              {x.items.map(it => {
                const unit = unitOf(it.material);
                const price = unit === 'mass' ? T.ref.perKg(priceText(it.price)) : T.ref.perPcs(priceText(it.price));
                return <div key={it.material}>{`${named(db?.materials[it.material]?.name, it.material)}: ${price} · ${qtyText(it.moq, unit)}`}</div>;
              })}
              {x.spares.map(sp => (
                <div key={sp.spare}>{T.ref.spare(named(db?.spares[sp.spare]?.name, sp.spare), priceText(sp.price), T.ref.dayRange(sp.lead[0], sp.lead[1]))}</div>
              ))}
            </>,
            T.ref.dayRange(x.lead[0], x.lead[1]),
            pctText(x.prepay),
            T.ref.days(x.payDays),
            x.approved ? T.ref.yes : T.ref.no,
          ])}
        />
      </section>
      <section className="rsec">
        <Table
          test="ref-customers"
          cols={[c.name, c.pay, c.orders, c.lead, c.shelf]}
          rows={v.customers.map(x => [
            named(db?.customers[x.id]?.name, x.id),
            T.ref.days(x.payDays),
            T.ref.orders(x.days.map(d => T.date.weekdays[d]).join(', '), x.hour),
            T.ref.dayRange(x.lead[0], x.lead[1]),
            pctText(x.minShelf),
          ])}
        />
      </section>
    </>
  );
}

export function Ref({ hud, actions }: { hud: Hud; actions: Actions }) {
  const v = hud.ref.view;
  const tab = hud.ref.tab;
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
        <button type="button" className="close" onClick={() => actions.toggleRef()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {!v ? <div className="muted">{T.app.loading}</div> : null}
      {v ? (
        <div className="rbody" data-test="ref-body" data-tab={tab}>
          {tab === 'products' ? <Products v={v} /> : null}
          {tab === 'recipes' ? (
            <>
              {v.recipes.map(r => (
                <Recipe key={r.id} r={r} t={hud.t} />
              ))}
              <div className="muted small">{T.ref.planNote}</div>
            </>
          ) : null}
          {tab === 'equipment' ? <Equipment v={v} /> : null}
          {tab === 'lab' ? <Lab v={v} /> : null}
          {tab === 'people' ? <People v={v} /> : null}
          {tab === 'partners' ? <Partners v={v} /> : null}
          <div className="muted small">{T.ref.noHidden}</div>
        </div>
      ) : null}
    </div>
  );
}
