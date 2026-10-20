// База игры для панелей: названия материалов, поставщиков, ролей, машин и методик — из той же базы, что у потока расчёта
// (`content.json`). Её кладёт сюда игра при загрузке, панели только читают — как `db.ts` режима врача «Больницы» (её
// src/ui/doctor/db.ts).
import type { ContentDb, DocHead } from '../content/types';
import type { DocKind } from '../engine/docs';
import { T } from '../i18n';

export let db: ContentDb | undefined;

export function useDb(d: ContentDb) {
  db = d;
}

/** Шапка документа из базы (Б3а). */
export const headOf = (kind: DocKind, id: string): DocHead | undefined => (db?.[kind] as Record<string, { doc: DocHead }> | undefined)?.[id]?.doc;

/** Документ с редакцией: «MF-0001, ред. 1»; нет такого — пусто. */
export function docText(kind: DocKind, id: string | undefined): string {
  const h = id ? headOf(kind, id) : undefined;
  return h ? T.ref.doc(h.code, h.rev) : '';
}
