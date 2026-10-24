// Значки работ (этап Б, Б1б; docs/specs/2026-10-vertical-slice.md; docs/13-art.md, §11): что делает человек — над головой
// на крупных планах, в «Сейчас» и в карточке, одними значками. Одной толщины линии, в одной сетке 14 × 14, как значки
// статусов (src/ui/icons.tsx), но на нейтральном кружке: цвет в игре занят статусами, лампами и тревогой (§5). Слово —
// рядом в панели и в карточке, на полу — в карточке по щелчку. Пути — в синтаксисе SVG: их рисует и SVG, и холст (Path2D).
import type { TaskKind } from '../engine/types';

export type IconKind = 'move' | 'back' | 'check' | 'sample' | 'lab' | 'decide' | 'process' | 'clean' | 'line' | 'repair' | 'inv' | 'truck' | 'learn';

/**
 * Значок каждого вида работы: перевозка, проверка, пробы, испытание, решение, стадия, уборка, линия, ремонт,
 * расследование, фура, обучение (Б3б); приёмка работы подрядчика (Б3в), аудит и оценка поставщика (Б3г) — проверка;
 * возврат остатка — свой, «обратно на склад» (Б1д): со значком доставки ходка за остатком казалась доставкой.
 */
export const ICON_OF: Record<TaskKind | 'pack' | 'test' | 'truck' | 'visit' | 'audit', IconKind> = {
  unload: 'move',
  receive: 'check',
  putaway: 'move',
  move: 'move',
  toSampling: 'move',
  sample: 'sample',
  fromSampling: 'move',
  handover: 'sample',
  prep: 'lab',
  review: 'lab',
  test: 'lab',
  decide: 'decide',
  pick: 'move',
  transfer: 'process',
  return: 'back',
  stage: 'process',
  clean: 'clean',
  roomClean: 'clean',
  crew: 'line',
  pack: 'line',
  changeover: 'line',
  clearance: 'clean',
  clearCheck: 'check',
  feed: 'move',
  fgCheck: 'check',
  qpDecide: 'decide',
  ship: 'move',
  casePick: 'move',
  load: 'move',
  repair: 'repair',
  truckCheck: 'check',
  truck: 'truck',
  invStep: 'inv',
  invFix: 'repair',
  train: 'learn',
  trainCheck: 'check',
  // работа подрядчика и её приёмка (Б3в) — проверка
  accept: 'check',
  vendorReview: 'check',
  // оценка влияния отклонения (Б1г) — проверка по досье и результатам
  devAssess: 'check',
  visit: 'check',
  audit: 'check',
};

/** Пути значков в сетке 14 × 14: тёмная линия 1,5 на светлом кружке радиуса 6,5. */
export const ICON_PATH: Record<IconKind, string> = {
  // стрелка вправо — везут
  move: 'M3.5 7h7M8 4.5l2.5 2.5L8 9.5',
  // стрелка с поворотом назад — остаток обратно на склад
  back: 'M10.5 9.5V6.5a2 2 0 0 0-2-2h-5M5.5 2.5l-2 2 2 2',
  // лист с двумя строками — проверка по записям
  check: 'M4.5 3.5h5v7h-5zM6 6h2M6 8.5h2',
  // пробоотборник — пробирка
  sample: 'M5.5 3.5v5a1.5 1.5 0 0 0 3 0v-5M5 3.5h4M5.5 7h3',
  // колба — испытание
  lab: 'M6 3.5v3l-2.5 4h7L8 6.5v-3M5.5 3.5h3',
  // печать — решение по партии или серии
  decide: 'M7 3.5v3.5M5 7h4l.5 2h-5zM4 10.5h6',
  // бункер — стадия серии
  process: 'M3.5 4h7l-2 4h-3zM6 8v2.5h2V8',
  // капля — уборка
  clean: 'M7 3.5c1.6 2.1 2.6 3.4 2.6 4.7a2.6 2.6 0 0 1-5.2 0c0-1.3 1-2.6 2.6-4.7z',
  // пачка — упаковочная линия
  line: 'M4 5.3L7 4l3 1.3v3.9L7 10.5 4 9.2zM4 5.3l3 1.3 3-1.3M7 6.6v3.9',
  // ключ — ремонт
  repair: 'M4.2 9.8L7.8 6.2M7.6 4.6a1.9 1.9 0 1 0 1.8 1.8',
  // лупа — расследование
  inv: 'M8.2 8.2l2.3 2.3M6.2 8.6a2.4 2.4 0 1 0 0-4.8a2.4 2.4 0 0 0 0 4.8z',
  // фура
  truck: 'M3.2 5.2h5v4h-5zM8.2 6.4h1.6l1 1.3v1.5H8.2M5 10.3v.2M9.4 10.3v.2',
  // раскрытая книга — изучает документ
  learn: 'M7 4.6C5.9 3.9 4.7 3.6 3.5 3.6v6.3c1.2 0 2.4.3 3.5 1 1.1-.7 2.3-1 3.5-1V3.6c-1.2 0-2.4.3-3.5 1zM7 4.6v6.3',
};

export const ICON_KINDS = Object.keys(ICON_PATH) as IconKind[];

/** Цвета значка: светлый кружок и тёмная линия — те же, что у значков статусов, но кружок нейтральный. */
export const ICON_FILL = '#dfe5e8';
export const ICON_LINE = '#10181b';
