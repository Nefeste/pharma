// Регламентирующие документы (Б3а; docs/specs/2026-10-vertical-slice.md; GMP ЕАЭС, ч. I, пп. 4.3, 4.5): у спецификации,
// методики испытания, технологической карты, инструкции по упаковке, процедуры (Б3б) и соглашения по качеству (Б3г) —
// код, редакция, день введения в действие и кто утвердил. Редакции одного документа — записи базы с одним кодом.
// Статус — по дате завода: до дня введения — проект; с него — действует, пока не введена следующая редакция того же
// кода; потом — в архиве. Ссылка в базе — на любую редакцию, то есть на код: движок берёт редакцию, действующую в
// нужный день.
import type { ContentDb, DocHead, Id } from '../content/types';

/**
 * Виды регламентирующих документов — разделы базы: спецификации, методики, карты, инструкции по упаковке (позиции),
 * процедуры (СОП, с Б3б), соглашения по качеству (с Б3г).
 */
export type DocKind = 'specs' | 'tests' | 'recipes' | 'skus' | 'sops' | 'agreements';
export const DOC_KINDS: readonly DocKind[] = ['specs', 'tests', 'recipes', 'skus', 'sops', 'agreements'];

export type DocStatus = 'draft' | 'active' | 'archive';

type Docs = Record<Id, { doc: DocHead }>;

export const headOf = (db: Pick<ContentDb, DocKind>, kind: DocKind, id: Id): DocHead | undefined => (db[kind] as Docs)[id]?.doc;

/** Редакции по коду — на каждую базу один раз: база не меняется, пока идёт игра. */
const cache = new WeakMap<object, Map<string, Id[]>>();

/** Все редакции документа, к которому относится запись `id`, — по дню введения; записи нет — пусто. */
export function revisions(db: Pick<ContentDb, DocKind>, kind: DocKind, id: Id): Id[] {
  const head = headOf(db, kind, id);
  if (!head) return [];
  let byCode = cache.get(db[kind]);
  if (!byCode) {
    byCode = new Map();
    cache.set(db[kind], byCode);
  }
  let list = byCode.get(head.code);
  if (!list) {
    list = Object.entries(db[kind] as Docs)
      .filter(([, r]) => r.doc.code === head.code)
      .sort(([a, x], [b, y]) => x.doc.from - y.doc.from || (a < b ? -1 : 1))
      .map(([k]) => k);
    byCode.set(head.code, list);
  }
  return list;
}

/**
 * Редакция документа `id`, действующая в день `day` (номер дня от 1970-01-01): последняя введённая не позже него. Не
 * введена ещё ни одна — первая: сборщик базы следит, чтобы на начало сценария нужное уже действовало.
 */
export function inForce(db: Pick<ContentDb, DocKind>, kind: DocKind, id: Id, day: number): Id {
  const list = revisions(db, kind, id);
  let out = list[0] ?? id;
  for (const r of list) if (headOf(db, kind, r)!.from <= day) out = r;
  return out;
}

/** Дни «в силе» редакций-проектов, которые назначил проект «Новый продукт» (Б7д): id редакции → номер дня. */
export type DocDays = Record<Id, number>;

const lived = new WeakMap<ContentDb, WeakMap<DocDays, ContentDb>>();

/**
 * База, по которой живёт завод (Б7д): у редакций, которые проект ввёл в силу, — их день из состояния вместо дня, который
 * не наступает. Дней нет — та же база, тем же объектом, и все кэши по базе живут как раньше. Копия — на объект дней:
 * проект не правит дни на месте, а кладёт новый объект.
 */
export function liveOf(db: ContentDb, days: DocDays | undefined): ContentDb {
  if (!days) return db;
  let byDays = lived.get(db);
  if (!byDays) {
    byDays = new WeakMap();
    lived.set(db, byDays);
  }
  const hit = byDays.get(days);
  if (hit) return hit;
  const out: ContentDb = { ...db };
  for (const kind of DOC_KINDS) {
    const recs = db[kind] as Docs;
    if (!Object.keys(days).some(id => recs[id])) continue;
    const copy: Docs = { ...recs };
    for (const [id, day] of Object.entries(days)) if (recs[id]) copy[id] = { ...recs[id], doc: { ...recs[id].doc, from: day } };
    (out as unknown as Record<DocKind, Docs>)[kind] = copy;
  }
  // позиция, которую проект ввёл (Б7д): её спрос после ввода — у покупателей, сама она — в позициях плана сценария с
  // картой своего продукта
  const launched = Object.keys(days).filter(id => db.skus[id]?.launch);
  if (launched.length > 0) {
    const customers = { ...db.customers };
    for (const id of launched)
      for (const [c, perDay] of Object.entries(db.skus[id].launch!)) if (customers[c]) customers[c] = { ...customers[c], demand: { ...customers[c].demand, [id]: perDay } };
    out.customers = customers;
    const scenarios = { ...db.scenarios };
    for (const [k, sc] of Object.entries(db.scenarios)) {
      if (!sc.plan) continue;
      const items = [...sc.plan.items];
      for (const id of launched) {
        const recipe = Object.values(db.recipes).find(r => r.product === db.skus[id].product)?.id;
        if (recipe && !items.some(it => it.sku === id)) items.push({ recipe, sku: id });
      }
      scenarios[k] = { ...sc, plan: { ...sc.plan, items } };
    }
    out.scenarios = scenarios;
  }
  byDays.set(days, out);
  return out;
}

/** Статус редакции в день `day`: проект — до дня введения; действует; в архиве — когда введена следующая. */
export function statusOf(db: Pick<ContentDb, DocKind>, kind: DocKind, id: Id, day: number): DocStatus {
  const head = headOf(db, kind, id);
  if (!head || head.from > day) return 'draft';
  return inForce(db, kind, id, day) === id ? 'active' : 'archive';
}
