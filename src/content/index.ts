// Собранная база игры для тестов и инструментов. Файл собирает `npm run content`; в репозитории его нет. Окно и поток
// расчёта берут ту же базу из dist/content.json (tools/app/build.mjs).
import type { ContentDb } from './types';
import bundle from './generated/bundle.json';

export const db = bundle as unknown as ContentDb;
