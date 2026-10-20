// Регламентирующие документы (Б3а; docs/specs/2026-10-vertical-slice.md; GMP ЕАЭС, ч. I, пп. 4.3, 4.5): у спецификации,
// методики испытания, технологической карты, инструкции по упаковке и процедуры (Б3б) — код, редакция, день введения в
// действие и кто утвердил. Редакции одного документа — записи базы с одним кодом. Статус — по дате завода: до дня
// введения — проект; с него — действует, пока не введена следующая редакция того же кода; потом — в архиве. Ссылка в
// базе — на любую редакцию, то есть на код: движок берёт редакцию, действующую в нужный день.
import type { ContentDb, DocHead, Id } from '../content/types';

/**
 * Виды регламентирующих документов — разделы базы: спецификации, методики, карты, инструкции по упаковке (позиции),
 * процедуры (СОП, с Б3б).
 */
export type DocKind = 'specs' | 'tests' | 'recipes' | 'skus' | 'sops';
export const DOC_KINDS: readonly DocKind[] = ['specs', 'tests', 'recipes', 'skus', 'sops'];

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

/** Статус редакции в день `day`: проект — до дня введения; действует; в архиве — когда введена следующая. */
export function statusOf(db: Pick<ContentDb, DocKind>, kind: DocKind, id: Id, day: number): DocStatus {
  const head = headOf(db, kind, id);
  if (!head || head.from > day) return 'draft';
  return inForce(db, kind, id, day) === id ? 'active' : 'archive';
}
