// Хроника завода для окна (Б10; docs/specs/2026-10-vertical-slice.md, «Б10»; геймдизайн, §26.1): главы — сутки от
// планёрки до планёрки, неделя с понедельника, месяц с первого числа — срезы ленты; записи главы новыми сверху с тем, что
// подставить в шаблон, и куда ведёт щелчок; итог главы — числа её записей. Только записи завода (src/engine/chronicle.ts),
// истины нет (docs/02-architecture.md, §9). Слова — в окне.
import type { ContentDb, Id } from '../content/types';
import { batchNo } from '../engine/batchno';
import { DAY, daysFromCivil, HOUR, momentOf } from '../engine/core/calendar';
import type { ChronEntry, PlantState } from '../engine/types';
import type { Thing } from './views';

export type ChronScale = 'day' | 'week' | 'month';

export interface ChronicleQuery {
  view: 'chronicle';
  scale: ChronScale;
  /** сколько глав назад: 0 — текущая */
  back: number;
}

/** Что подставить в шаблон записи — записи завода о её вещах. */
export interface ChronFacts {
  batch?: string;
  product?: Id;
  order?: number;
  customer?: Id;
  sku?: Id;
  dev?: number;
  po?: number;
  supplier?: Id;
  material?: Id;
  machine?: Id;
  part?: Id;
  role?: Id;
  tab?: number;
  asset?: Id;
}

/** Куда ведёт щелчок: карточка вещи или досье серии. */
export type ChronGo = { thing: Thing } | { dossier: number };

export interface ChronRow {
  e: ChronEntry;
  facts: ChronFacts;
  go?: ChronGo;
}

export interface ChronicleView {
  view: 'chronicle';
  scale: ChronScale;
  back: number;
  /** мгновения главы: от и до */
  from: number;
  to: number;
  rows: ChronRow[];
  /** итог главы: записей по видам */
  sum: Partial<Record<ChronEntry['k'], number>>;
  /** глав назад, в которых что-то есть: «раньше» возможно */
  older: boolean;
}

const MORNING = 8 * HOUR;

/** Начало главы, в которой мгновение `t`, и начало следующей. */
export function chapterOf(s: Pick<PlantState, 'start'>, scale: ChronScale, t: number, back: number): { from: number; to: number } {
  const z0 = daysFromCivil(s.start);
  const at = (day: number) => (day - z0) * DAY + MORNING;
  const m = momentOf(s.start, t - MORNING);
  let from: number;
  let to: number;
  if (scale === 'day') {
    from = at(m.day - back);
    to = from + DAY;
  } else if (scale === 'week') {
    from = at(m.day - m.weekday - 7 * back);
    to = from + 7 * DAY;
  } else {
    let { y, m: mo } = m.date;
    mo -= back;
    while (mo < 1) {
      mo += 12;
      y--;
    }
    from = at(daysFromCivil({ y, m: mo, d: 1 }));
    to = at(daysFromCivil({ y: mo === 12 ? y + 1 : y, m: mo === 12 ? 1 : mo + 1, d: 1 }));
  }
  return { from, to };
}

const num = (id: string) => Number(id.slice(1));

function rowOf(s: PlantState, e: ChronEntry): ChronRow {
  const f: ChronFacts = {};
  let go: ChronGo | undefined;
  const batch = (id: string) => {
    const b = s.batches[id];
    if (!b) return;
    f.batch = b.code.n > 0 ? batchNo(b.code) : undefined;
    f.product = b.product;
    if (b.sku) f.sku = b.sku;
    go = { dossier: num(id) };
  };
  switch (e.k) {
    case 'released':
    case 'rejected':
      batch(e.b);
      break;
    case 'missed': {
      const o = s.orders[e.o];
      f.order = num(e.o);
      if (o) f.customer = o.customer;
      if (e.sku) f.sku = e.sku;
      go = { thing: { kind: 'order', n: num(e.o) } };
      break;
    }
    case 'dev':
    case 'capa': {
      const id = e.d;
      const d = s.deviations[id];
      f.dev = num(id);
      if (d?.batch) f.batch = s.batches[d.batch] ? batchNo(s.batches[d.batch].code) : undefined;
      go = { thing: { kind: 'dev', n: num(id) } };
      break;
    }
    case 'concluded': {
      const inv = s.investigations[e.inv];
      if (inv) batch(inv.batch);
      break;
    }
    case 'poLate':
    case 'poCame': {
      const po = s.pos[e.po];
      f.po = num(e.po);
      if (po) {
        f.supplier = po.supplier;
        if (po.lines[0]) f.material = po.lines[0].material;
      }
      break;
    }
    case 'failure':
    case 'repaired':
      // вид машины — из узла; узел — номер в записи вида: имя — в окне
      f.machine = s.parts[`${e.m}/${e.part}`]?.of;
      f.part = e.part;
      break;
    case 'hired':
    case 'left': {
      const p = s.people[e.p] ?? s.hiring.former[e.p];
      if (p) {
        f.role = p.role;
        f.tab = p.tab;
      }
      if (s.people[e.p]) go = { thing: { kind: 'person', n: num(e.p) } };
      break;
    }
    case 'unit':
      f.asset = s.assets[e.a]?.type;
      break;
    case 'project':
      f.product = e.product;
      break;
    case 'goals':
      break;
  }
  return { e, facts: f, ...(go ? { go } : {}) };
}

export function chronicleView(db: ContentDb, s: PlantState, q: ChronicleQuery): ChronicleView {
  void db;
  const { from, to } = chapterOf(s, q.scale, s.t, q.back);
  const list = s.story.chronicle;
  const rows: ChronRow[] = [];
  const sum: ChronicleView['sum'] = {};
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e.t >= to) continue;
    if (e.t < from) break;
    rows.push(rowOf(s, e));
    sum[e.k] = (sum[e.k] ?? 0) + 1;
  }
  return { view: 'chronicle', scale: q.scale, back: q.back, from, to, rows, sum, older: list.length > 0 && list[0].t < from };
}
