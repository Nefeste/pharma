// Хроника завода (Б10; геймдизайн, §26.1): панель — масштаб главы (сутки, неделя, месяц), «Раньше» и «Позже», итог главы
// числами её записей и записи новыми сверху; щелчок — карточка вещи или досье серии. Слова — шаблоны `src/i18n/` по виду
// записи, числа и имена — записи завода из потока (src/sim/chronicle.ts). Хроника не оценивает игрока.
import { DAY } from '../engine/core/calendar';
import type { ChronEntry } from '../engine/types';
import { durText, named, num, T, whenText } from '../i18n';
import type { ChronFacts, ChronRow, ChronScale } from '../sim/chronicle';
import { causeText, clsText } from './capa';
import { db } from './db';
import type { Actions, Hud } from './store';

/** Длительность словами: от двух суток — сутками с десятой, короче — часами и минутами. */
export function spanText(sec: number): string {
  if (sec < 2 * DAY) return durText(sec);
  const d = Math.round((sec / DAY) * 10) / 10;
  return T.chronicle.days(num(d, Number.isInteger(d) ? 0 : 1));
}

const nm = (rec: { name?: unknown } | undefined, id: string | undefined) => (id ? named(rec?.name as never, id) : '');

/** Запись словами — по её виду и тому, что о её вещах записал завод. */
export function entryText(e: ChronEntry, f: ChronFacts): string {
  const C = T.chronicle;
  const batch = f.batch ?? C.batchNone;
  const product = nm(db?.products[f.product ?? ''], f.product);
  const by = (who: string | undefined) => (who === undefined ? '' : who === 'player' ? C.by.player : C.byHead(T.journal.namesIn[who] ?? who));
  const machine = db?.equipment[f.machine ?? ''] ?? db?.machines[f.machine ?? ''];
  const part = () => nm(machine?.parts.find(x => x.id === f.part), f.part);
  switch (e.k) {
    case 'released': {
      const tail = [e.ph && e.phSec !== undefined ? C.waited(spanText(e.phSec), T.daily.what[e.ph] ?? e.ph) : '', e.late !== undefined ? C.late(spanText(e.late)) : '', by(e.by)].filter(Boolean);
      return `${C.released(batch, product, spanText(e.sec))}${tail.length ? `: ${tail.join('; ')}` : ''}`;
    }
    case 'rejected': {
      const b = by(e.by);
      return `${C.rejected(batch, product)}${b ? `: ${b}` : ''}`;
    }
    case 'missed':
      return C.missed(f.order ?? 0, nm(db?.customers[f.customer ?? ''], f.customer), e.cases, nm(db?.skus[f.sku ?? ''], f.sku));
    case 'dev':
      return C.dev(f.dev ?? 0, clsText(e.cls).toLowerCase(), f.batch ?? '');
    case 'concluded':
      return C.concluded(batch, causeText(e.cause), C.fate[e.fate] ?? e.fate);
    case 'capa':
      return C.capa(Number(e.c.slice(1)), f.dev ?? 0, e.ok);
    case 'poLate':
      return C.poLate(f.po ?? 0, nm(db?.suppliers[f.supplier ?? ''], f.supplier), nm(db?.materials[f.material ?? ''], f.material).toLowerCase());
    case 'poCame':
      return C.poCame(f.po ?? 0, nm(db?.suppliers[f.supplier ?? ''], f.supplier), spanText(e.late));
    case 'failure':
      return C.failure(nm(machine, f.machine), part());
    case 'repaired':
      return C.repaired(nm(machine, f.machine), part(), spanText(e.sec));
    case 'hired':
      return C.hired(nm(db?.roles[f.role ?? ''], f.role), f.tab ?? 0);
    case 'left':
      return C.left(nm(db?.roles[f.role ?? ''], f.role), f.tab ?? 0, T.hire.why[e.why] ?? e.why);
    case 'unit':
      return C.unit(nm(db?.equipment[f.asset ?? ''] ?? db?.machines[f.asset ?? ''] ?? db?.instruments[f.asset ?? ''], f.asset));
    case 'project':
      return C.project(product, T.project.stages[e.stage] ?? e.stage);
    case 'goals':
      return C.goals(e.met.filter(Boolean).length, e.met.length);
  }
}

const SCALES: ChronScale[] = ['day', 'week', 'month'];

export function Chronicle({ hud, actions }: { hud: Hud; actions: Actions }) {
  const c = hud.chronicle;
  const v = c.view;
  const C = T.chronicle;
  const row = (r: ChronRow, i: number) => (
    <li key={`${r.e.t}-${i}`} data-test="chron-row" data-kind={r.e.k}>
      <span className="muted">{whenText(hud.start, r.e.t)}</span>{' '}
      {r.go ? (
        <button type="button" className="link" onClick={() => actions.chronicleGo(r.go!)} data-test="chron-go">
          {entryText(r.e, r.facts)}
        </button>
      ) : (
        <span>{entryText(r.e, r.facts)}</span>
      )}
    </li>
  );
  return (
    <div className="chronicle panel" role="dialog" aria-labelledby="chron-title" data-test="chronicle">
      <div className="phead">
        <b id="chron-title">{C.title}</b>
        <span className="tabs">
          {SCALES.map(sc => (
            <button key={sc} type="button" className={c.scale === sc ? 'on' : ''} onClick={() => actions.chronicleAt(sc, 0)} data-test="chron-scale" data-scale={sc}>
              {C.scale[sc]}
            </button>
          ))}
        </span>
        <button type="button" className="close" onClick={() => actions.toggleChronicle()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {v ? (
        <>
          <div className="lacts">
            <button type="button" disabled={!v.older} onClick={() => actions.chronicleAt(c.scale, c.back + 1)} data-test="chron-earlier">
              {C.earlier}
            </button>
            <span className="muted" data-test="chron-span">
              {C.span(whenText(hud.start, v.from), whenText(hud.start, v.to))}
            </span>
            <button type="button" disabled={c.back === 0} onClick={() => actions.chronicleAt(c.scale, c.back - 1)} data-test="chron-later">
              {C.later}
            </button>
          </div>
          <p className="muted" data-test="chron-sum">
            {C.sum(v.sum.released ?? 0, v.sum.rejected ?? 0, v.sum.missed ?? 0, v.sum.dev ?? 0)}
          </p>
          {v.rows.length === 0 ? <p className="muted">{C.none}</p> : <ul className="crows">{v.rows.map(row)}</ul>}
        </>
      ) : null}
    </div>
  );
}
