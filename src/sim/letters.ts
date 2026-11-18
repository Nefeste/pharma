// Письма сценария для окна (Б9; docs/specs/2026-10-vertical-slice.md, «Б9»; геймдизайн, §17, §26.3): пришедшие письма —
// новые сверху, — что в них подставить из записей завода, куда ведёт «Показать», чего ждёт окно (`seen`), можно ли
// пропустить. Числа и имена — записи завода: номер заказа поставщику, поставщик, материал и сколько, код партии, номер
// серии, покупатель и срок, номер отклонения; истины нет (docs/02-architecture.md, §9). Слова — в окне.
import type { ContentDb, Id, Letter, LetterSeen } from '../content/types';
import { batchNo } from '../engine/batchno';
import { lettersOf } from '../engine/letters';
import type { LetterRec, PlantState } from '../engine/types';
import type { Thing } from './views';

export interface LettersQuery {
  view: 'letters';
}

/** Что подставить в шаблон письма — записи завода о его вещи. */
export interface LetterFacts {
  po?: string;
  supplier?: Id;
  material?: Id;
  qty?: number;
  lot?: [number, number, number];
  /** номер серии `PPNNNMMYY`; номера ещё нет — номер задания */
  batch?: string;
  order?: number;
  product?: Id;
  customer?: Id;
  due?: number;
  dev?: string;
}

/** Куда ведёт «Показать»: вещь на полу или карточка, панель окна, досье серии. */
export type LetterGo = { thing: Thing } | { panel: 'lab' | 'morning' | 'goals' } | { dossier: number };

export interface LetterRow {
  id: Id;
  from: Letter['from'];
  n: number;
  at: number;
  read?: number;
  end?: LetterRec['end'];
  facts: LetterFacts;
  go?: LetterGo;
  /** окно открыло это — письмо кончится */
  seen?: LetterSeen;
  skip: boolean;
}

export interface LettersView {
  view: 'letters';
  rows: LetterRow[];
  unread: number;
  /** писем наставника ещё не кончилось — пришедших и непришедших: «Пропустить обучение» */
  mentor: number;
}

function facts(s: PlantState, r: LetterRec): LetterFacts {
  const id = r.thing;
  if (!id) return {};
  const po = s.pos[id];
  if (po) return { po: po.id, supplier: po.supplier, ...(po.lines[0] ? { material: po.lines[0].material, qty: po.lines.reduce((a, l) => (l.material === po.lines[0].material ? a + l.qty : a), 0) } : {}) };
  const lot = s.lots[id];
  if (lot) return { lot: [lot.code.y, lot.code.m, lot.code.n], material: lot.material, qty: lot.qty, supplier: lot.supplier };
  const b = s.batches[id];
  if (b) return { ...(b.code.n > 0 ? { batch: batchNo(b.code) } : { order: Number(b.id.slice(1)) }), product: b.product };
  const o = s.orders[id];
  if (o) return { customer: o.customer, due: o.due };
  const d = s.deviations[id];
  if (d) return { dev: d.id };
  return {};
}

function goOf(s: PlantState, l: Letter, r: LetterRec): LetterGo | undefined {
  if (l.done.kind === 'seen' && l.done.what !== 'card' && l.done.what !== 'cash') {
    if (l.done.what === 'dossier') return r.thing && s.batches[r.thing] ? { dossier: Number(r.thing.slice(1)) } : undefined;
    return { panel: l.done.what };
  }
  const id = r.thing;
  if (!id) return undefined;
  if (s.pos[id]) {
    const tr = Object.values(s.trucks).find(t => t.po === id);
    return tr ? { thing: { kind: 'truck', n: Number(tr.id.slice(1)), customer: false } } : undefined;
  }
  if (s.lots[id]) return { panel: 'lab' };
  if (s.batches[id]) return { dossier: Number(id.slice(1)) };
  if (s.orders[id]) return { thing: { kind: 'order', n: Number(id.slice(1)) } };
  if (s.deviations[id]) return { thing: { kind: 'dev', n: Number(id.slice(1)) } };
  return undefined;
}

export function lettersView(db: ContentDb, s: PlantState): LettersView {
  const recs = s.heads.letters ?? [];
  const rows: LetterRow[] = [];
  for (const r of recs) {
    const l = db.letters[r.id];
    if (!l) continue;
    const go = goOf(s, l, r);
    rows.push({
      id: r.id,
      from: l.from,
      n: l.n,
      at: r.at,
      ...(r.read !== undefined ? { read: r.read } : {}),
      ...(r.end ? { end: r.end } : {}),
      facts: facts(s, r),
      ...(go ? { go } : {}),
      ...(!r.end && l.done.kind === 'seen' ? { seen: l.done.what } : {}),
      skip: !r.end && l.from === 'mentor',
    });
  }
  rows.sort((a, b) => b.at - a.at || b.n - a.n);
  const mentor = lettersOf(db, s.scenario).filter(l => l.from === 'mentor' && !recs.find(r => r.id === l.id)?.end).length;
  return { view: 'letters', rows, unread: rows.filter(r => r.read === undefined).length, mentor };
}
