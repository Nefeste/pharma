// База игры для панелей: названия материалов, поставщиков, ролей, машин и методик — из той же базы, что у потока расчёта
// (`content.json`). Её кладёт сюда игра при загрузке, панели только читают — как `db.ts` режима врача «Больницы» (её
// src/ui/doctor/db.ts).
import type { ContentDb } from '../content/types';

export let db: ContentDb | undefined;

export function useDb(d: ContentDb) {
  db = d;
}
