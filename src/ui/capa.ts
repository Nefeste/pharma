// Отклонения и CAPA словами (Б5е; docs/specs/2026-10-vertical-slice.md, «Б5е»): класс, вероятная причина, действие
// каталога, его вещь и цена — одни слова для карточки отклонения, журнала, планёрки и показателей. Числа — из видов
// потока расчёта (src/sim/devs.ts); истины здесь нет: причина — та, что записал завод.
import type { CapaOption } from '../engine/capa';
import type { Head } from '../engine/types';
import { durText, money, named, pctText, T } from '../i18n';
import type { CapaRow } from '../sim/devs';
import { db } from './db';
import { policyText } from './policy';

/** Действие каталога словами: имя записи `content/capa/`. */
export const capaName = (id: string) => named(db?.capa[id]?.name, id);

/** Вероятная причина словами: «не установлена», ошибка лаборатории, партия поставщика или имя причины базы. */
export function causeText(cause: string | undefined): string {
  if (cause === undefined) return T.dev.causeWait;
  if (cause === 'none') return T.dev.causeNone;
  if (cause === 'lab') return T.dev.causeLab;
  if (cause === 'lot') return T.dev.causeLot;
  return named(db?.causes[cause]?.name, cause);
}

/** Класс словами: «Критическое», «Существенное», «Незначительное». */
export const clsText = (cls: string) => T.dev.cls[cls] ?? cls;

/** Кто исполняет — руководитель отдела действия, как в журнале. */
export const headText = (h: Head) => T.journal.names[h] ?? h;

/** Узел словами — узел и машина по ключу `<машина>/<узел>`. */
function partWords(key: string): string {
  const [machine, part] = key.split('/');
  const rec = db?.equipment[machine.replace(/-\d+$/, '')] ?? db?.machines[machine.replace(/-\d+$/, '')];
  const name = named(rec?.parts.find(x => x.id === part)?.name, part);
  return rec ? `${name} · ${named(rec.name, machine)}` : name;
}

/** Вещь действия словами: узел, сколько документов, прибор, пара. */
export function thingText(x: Pick<CapaRow, 'part' | 'docs' | 'asset' | 'pair'>): string {
  if (x.part) return partWords(x.part);
  if (x.docs) return T.dev.capaDocs(x.docs.length);
  if (x.asset) return x.asset;
  if (x.pair) {
    const [sup, mkr] = x.pair.split('|');
    return `${named(db?.suppliers[sup]?.name, sup)} — ${named(db?.makers[mkr]?.name, mkr)}`;
  }
  return '';
}

/** Цена действия словами: деньги и часы, у обучения — сколько людей, у «заменять раньше» — порог был и станет. */
export function priceText(o: CapaOption): string {
  if (o.to !== undefined && o.from !== undefined) {
    const p = db?.policies['pol.maint.replace'];
    return `${T.dev.capaFromTo(policyText(p, o.from), pctText(o.to))}; ${T.dev.capaFree}`;
  }
  const work = durText(o.work);
  if (o.learners !== undefined) return T.dev.capaPeople(o.learners, work);
  return o.cost > 0 ? T.dev.capaCost(money(o.cost), work) : T.dev.capaWork(work);
}
