// из bolnitsa: src/render/cast.ts @ e0a3491 — изменено: виды набора — по работе на заводе, цвет одежды — по роли
// (`docs/13-art.md`, §6), а не по должности больницы; палитры пациентов и «классика» в цилиндрах ушли.
//
// Кто как выглядит (docs/specs/2026-10-view.md, 2б): виды людей набора, рост, цвет одежды по роли, тон кожи. Одно место
// для этих чисел: запекание (bake.ts), люди на экране (people.ts) и тесты берут их отсюда.
import type { Id } from '../content/types';

/** Рост до макушки, м: средний взрослый — 1,76 и 1,64 (мужчины и женщины), старшие — на 4 см ниже. */
export const STATURE: Record<'m' | 'f', Record<'adult' | 'old', number>> = {
  m: { adult: 1.76, old: 1.72 },
  f: { adult: 1.64, old: 1.6 },
};

/** Какой вид набора на какую работу: халат (лаборатория, качество, чистые зоны), костюм (офис), рабочая одежда. */
export type Use = 'coat' | 'office' | 'work';

/**
 * Вид человека из набора: пол, возраст, на какую работу годится, какие материалы красятся на экземпляр (одежда), пропорции.
 * Пропорции набора Quaternius — мультяшные (голова — около трети роста), как в «Больнице».
 */
export interface LookSpec {
  name: string;
  sex: 'm' | 'f';
  age: 'adult' | 'old';
  use: Use;
  /** материалы одежды, которые красятся цветом экземпляра */
  tint: string[];
  proportions: 'cartoon' | 'normal';
}

const L = (name: string, sex: 'm' | 'f', age: 'adult' | 'old', use: Use, tint: string[]): LookSpec => ({ name, sex, age, use, tint, proportions: 'cartoon' });

export const LOOKS: LookSpec[] = [
  L('Doctor_Male_Young', 'm', 'adult', 'coat', ['Main']),
  L('Doctor_Female_Young', 'f', 'adult', 'coat', ['Main']),
  L('Doctor_Male_Old', 'm', 'old', 'coat', ['Main']),
  L('Doctor_Female_Old', 'f', 'old', 'coat', ['Main']),
  L('Suit_Male', 'm', 'adult', 'office', []),
  L('Suit_Female', 'f', 'adult', 'office', []),
  L('Casual_Male', 'm', 'adult', 'work', ['Shirt']),
  L('Casual_Female', 'f', 'adult', 'work', ['Shirt']),
  L('Casual2_Male', 'm', 'adult', 'work', ['Shirt']),
  L('Casual2_Female', 'f', 'adult', 'work', ['Shirt']),
  L('Casual3_Male', 'm', 'adult', 'work', ['Shirt']),
  L('Casual3_Female', 'f', 'adult', 'work', ['Shirt']),
  L('Casual_Bald', 'm', 'old', 'work', ['Shirt']),
];

export const lookSpec = (name: string): LookSpec | undefined => LOOKS.find(l => l.name === name);

/** Рост вида по таблице. */
export const statureOf = (s: Pick<LookSpec, 'sex' | 'age'>) => STATURE[s.sex][s.age];

/**
 * Одежда по роли (`docs/13-art.md`, §6; отраслевая практика, подтверждает владелец): склад — сигнальный жилет; производство
 * в классе D и лаборатория — белое; упаковка — своя форма; техслужба — рабочая куртка; начальник ОКК и уполномоченное лицо —
 * офисная одежда. Переодевания в шлюзе пока нет — одежда своей зоны весь день. Линейный RGB, как в материалах Three.js.
 */
export const ROLE_DRESS: Record<Id, { use: Use; color: number }> = {
  'role.storekeeper': { use: 'work', color: 0xe0782c },
  'role.driver': { use: 'work', color: 0xd9b52a },
  'role.mechanic': { use: 'work', color: 0x34507a },
  'role.setter': { use: 'work', color: 0x3f6a8a },
  'role.operator': { use: 'coat', color: 0xf2f4f4 },
  'role.master': { use: 'coat', color: 0xf2f4f4 },
  'role.line-operator': { use: 'coat', color: 0x9cc3d8 },
  'role.packer': { use: 'coat', color: 0x9cc3d8 },
  'role.analyst': { use: 'coat', color: 0xf2f4f4 },
  'role.sampler': { use: 'coat', color: 0xf2f4f4 },
  'role.qa': { use: 'coat', color: 0xf2f4f4 },
  'role.qc-head': { use: 'office', color: 0xffffff },
  'role.qp': { use: 'office', color: 0xffffff },
};
/** Кого нет в таблице — белый халат. */
const DEFAULT_DRESS = { use: 'coat' as Use, color: 0xf2f4f4 };

export const dressOf = (role: Id) => ROLE_DRESS[role] ?? DEFAULT_DRESS;

/** Тон кожи — по номеру человека. */
export const SKIN = [0xe8b896, 0xd9a07a, 0xf1c9a5, 0xc68863, 0xa86f4c, 0xeac0a0];

/** Перемешать номер человека: соседние номера — разные виды и тона. */
const mix = (n: number, salt: number) => {
  let h = (n * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
};

/** Вид человека (номер в `looks`) — из видов его работы, по номеру человека. */
export function lookOf(names: readonly string[], role: Id, person: number): number {
  const use = dressOf(role).use;
  const fit = names.map((n, i) => ({ i, s: lookSpec(n) })).filter(x => x.s?.use === use);
  if (!fit.length) return 0;
  return fit[mix(person, 1) % fit.length].i;
}

/** Тон кожи человека. */
export const skinOf = (person: number) => SKIN[mix(person, 2) % SKIN.length];
