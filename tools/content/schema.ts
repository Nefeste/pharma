// Схема исходных записей базы (YAML в content/, docs/04-data-model.md, §3–4). Строгие объекты: опечатка в имени поля —
// ошибка сборки, а не молча пропущенное поле. Числа в записях — в единицах автора (проценты, сантиметры); в единицы
// движка их переводит load.ts.
import { z } from 'zod';

const text = z.strictObject({ ru: z.string().min(1), en: z.string().min(1).optional() });
const review = z.enum(['draft', 'checked']);
/** Ключи источников — из таблицы docs/10-domain.md, §9 (проверяет load.ts). */
const sources = z.array(z.string().regex(/^[a-z0-9-]+$/, 'ключ источника — латиница, цифры и дефис')).min(1);
const percent = z.number().min(0).max(100);

export const profile = z.strictObject({
  id: z.string(),
  name: text,
  currency: z.string().regex(/^[A-Z]{3}$/, 'код валюты ISO 4217, три заглавные буквы'),
  vat: z.strictObject({ medicines: percent, general: percent }),
  marking: z.strictObject({ packs: z.boolean(), aggregation: z.enum(['optional', 'required']) }),
  source: sources,
  review,
});

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата пишется как ГГГГ-ММ-ДД');

export const scenario = z.strictObject({
  id: z.string(),
  name: text,
  profile: z.string(),
  start: z.strictObject({ date, hour: z.number().int().min(0).max(23) }),
  seed: z.number().int().min(0).max(0xffffffff),
  site: z.strictObject({ w: z.number().int().min(20).max(300), h: z.number().int().min(20).max(300) }),
});

/**
 * Грузовая единица. Размеры стандартной паллеты — факт (с источником и `review`); размер своего гофроящика — выбор
 * геймдизайна, без источника.
 */
export const unit = z
  .strictObject({
    id: z.string(),
    name: text,
    kind: z.enum(['pallet', 'case']),
    /** см */
    size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
    /** кг */
    maxLoad: z.number().positive(),
    wood: z.boolean().optional(),
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(u => (u.source === undefined) === (u.review === undefined), { message: 'источник и review пишутся вместе' });

/** Папка в content/ → приставка идентификатора и схема. */
export const KINDS = {
  profiles: { prefix: 'prf', schema: profile },
  scenarios: { prefix: 'scn', schema: scenario },
  units: { prefix: 'unit', schema: unit },
} as const;

export type Kind = keyof typeof KINDS;
