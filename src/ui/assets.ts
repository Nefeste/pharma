// Слова об активах (Б3в; docs/specs/2026-10-vertical-slice.md, «Б3в»): название класса и инвентарный номер, работа
// подрядчика — как она названа у класса («калибровка весов», «квалификация пресса», «поверка датчика»), срок записи, почему
// актив не берёт работу и его состояние. Вид приходит из потока расчёта (src/sim/places.ts) без слов; слова — отсюда.
import type { AssetWork, Id, Text } from '../content/types';
import type { AssetFamily, AssetRec } from '../engine/types';
import { dayText, named, T } from '../i18n';
import type { AssetInfo } from '../sim/places';
import { db } from './db';

/** Класс актива из базы окна: название, квалификация и калибровка. */
export function classOf(a: { family: AssetFamily; type: Id }): { name?: Text; qual?: AssetWork; cal?: AssetWork } | undefined {
  if (!db) return undefined;
  if (a.family === 'equipment') return db.equipment[a.type];
  if (a.family === 'machine') return db.machines[a.type];
  if (a.family === 'vehicle') return db.vehicles[a.type];
  return db.instruments[a.type];
}

/** Название класса: «Роторный таблеточный пресс». */
export const assetClass = (a: { family: AssetFamily; type: Id }) => named(classOf(a)?.name, a.type);

/** Класс и инвентарный номер: «Роторный таблеточный пресс, инв. № 00000114». */
export const assetName = (a: AssetInfo) => T.assets.named(assetClass(a), T.assets.inv(a.inv));

/** Работа подрядчика у класса — её название из базы: «Калибровка весов»; нет названия — общее слово. */
export function workName(a: { family: AssetFamily; type: Id }, work: 'qual' | 'cal'): string {
  const w = classOf(a)?.[work];
  return w ? named(w.name) : work === 'qual' ? T.assets.work.qual : T.assets.work.cal;
}

/** Почему актив не берёт работу словами: «квалификация просрочена», «прибор не откалиброван», «у подрядчика». */
export function unfitText(a: AssetInfo): string {
  if (a.unfit === 'qual') return T.assets.unfit.qual;
  if (a.unfit === 'cal') return a.verify ? T.assets.unfit.verify : a.family === 'lab' || a.family === 'ipc' ? T.assets.unfit.calInst : T.assets.unfit.cal;
  return a.unfit === 'visit' ? T.assets.unfit.visit : '';
}

/** Срок записи: «до 14.05.2028»; вышла — «вышла 14.05.2028»; нет — «записи нет». */
export function untilText(r: AssetRec | undefined, today: number): string {
  if (!r) return T.assets.none;
  return r.until < today ? T.assets.expired(dayText(r.until + 1)) : T.assets.until(dayText(r.until));
}

/** Состояние актива для таблицы и карточки: в сроке, визит назначен, подрядчик работает, ждёт приёмки, не работает. */
export function stateKey(a: AssetInfo): keyof typeof T.assets.state {
  if (a.needs.length === 0) return 'none';
  if (a.working) return 'working';
  if (a.visit?.accepting) return 'accepting';
  if (a.unfit === 'qual' || a.unfit === 'cal') return 'expired';
  return a.visit ? 'visit' : 'ok';
}
