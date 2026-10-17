// Схема исходных записей базы (YAML в content/, docs/04-data-model.md, §3–4). Строгие объекты: опечатка в имени поля —
// ошибка сборки, а не молча пропущенное поле. Числа в записях — в единицах автора (килограммы, рубли, метры, проценты);
// в единицы движка их переводит load.ts.
import { z } from 'zod';

const text = z.strictObject({ ru: z.string().min(1), en: z.string().min(1).optional() });
const review = z.enum(['draft', 'checked']);
/** Ключи источников — из таблицы docs/10-domain.md, §9 (проверяет load.ts). */
const sources = z.array(z.string().regex(/^[a-z0-9-]+$/, 'ключ источника — латиница, цифры и дефис')).min(1);
const percent = z.number().min(0).max(100);
const id = z.string().regex(/^[a-z][a-zA-Z0-9.-]*$/, 'идентификатор — латиница, цифры, точка и дефис');
/** Источник и review пишутся вместе: запись с фактом — с источником; выбор геймдизайна — без. */
const paired = <T extends { source?: unknown; review?: unknown }>(o: T) => (o.source === undefined) === (o.review === undefined);
const pairedMsg = { message: 'источник и review пишутся вместе' };

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
/** Количество в единице материала: кг или штуки — load.ts сверяет с материалом. */
const qty = z.number().positive();

export const scenario = z.strictObject({
  id: z.string(),
  name: text,
  profile: id,
  plant: id,
  start: z.strictObject({ date, hour: z.number().int().min(0).max(23) }),
  seed: z.number().int().min(0).max(0xffffffff),
  site: z.strictObject({ w: z.number().int().min(20).max(300), h: z.number().int().min(20).max(300) }),
  /** ₽ */
  cash: z.number().int(),
  staff: z.array(z.strictObject({ role: id, shift: id, skill: z.number().int().min(1).max(5), n: z.number().int().min(1).max(50) })).min(1),
  vehicles: z.array(z.strictObject({ type: id, n: z.number().int().min(1).max(20) })),
  orders: z.array(z.strictObject({ supplier: id, lines: z.array(z.strictObject({ material: id, qty })).min(1) })).default([]),
  stock: z.array(z.strictObject({ material: id, qty })).default([]),
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
  .refine(paired, pairedMsg);

export const material = z
  .strictObject({
    id: z.string(),
    kind: z.enum(['api', 'excipient', 'packaging']),
    name: text,
    unit: z.enum(['kg', 'pcs']),
    container: id,
    storage: z.enum(['room', 'cold']),
    /** месяцев */
    shelf: z.number().int().min(1).max(120),
    potency: z.boolean().optional(),
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

export const container = z.strictObject({
  id: z.string(),
  name: text,
  kind: z.enum(['drum', 'bag', 'roll', 'box', 'bundle']),
  /** ровно одно: кг или штуки */
  capacity: z.union([z.strictObject({ kg: z.number().positive() }), z.strictObject({ pcs: z.number().int().positive() })]),
  perPallet: z.number().int().min(1).max(100),
  load: z.enum(['cases', 'drums', 'bags', 'rolls']),
});

export const supplier = z.strictObject({
  id: z.string(),
  name: text,
  /** дни «от — до» */
  lead: z.tuple([z.number().int().min(1), z.number().int().min(1)]).refine(([a, b]) => a <= b, { message: '«от» не больше «до»' }),
  prepay: percent,
  payDays: z.number().int().min(0).max(365),
  approved: z.boolean(),
  /** ₽ за кг или за штуку; минимальная партия — кг или штуки */
  items: z.record(id, z.strictObject({ price: z.number().positive(), moq: qty })),
});

export const role = z.strictObject({
  id: z.string(),
  name: text,
  dept: z.enum(['wms', 'qc', 'qa', 'mes', 'line', 'maint']),
  /** ₽ в месяц */
  salary: z.number().int().positive(),
  permits: z.array(z.enum(['forklift'])).default([]),
});

export const vehicle = z.strictObject({
  id: z.string(),
  name: text,
  /** м/с */
  speedEmpty: z.number().positive().max(5),
  speedLoaded: z.number().positive().max(5),
  levels: z.number().int().min(0).max(8),
  /** с */
  liftBase: z.number().int().min(0),
  liftPerLevel: z.number().int().min(0),
  permit: z.enum(['forklift']).optional(),
});

export const shift = z.strictObject({
  id: z.string(),
  name: text,
  /** 1 — понедельник … 7 — воскресенье */
  days: z.array(z.number().int().min(1).max(7)).min(1),
  from: z.number().int().min(0).max(23),
  to: z.number().int().min(1).max(24),
});

const rect = z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]);
const point = z.tuple([z.number(), z.number()]);

/** План завода: метры участка. */
export const plant = z.strictObject({
  id: z.string(),
  docks: z.array(z.strictObject({ id: z.string(), kind: z.enum(['in', 'out']), x: z.number(), z: z.number() })).min(1),
  zones: z.array(
    z.strictObject({
      id: z.string(),
      kind: z.enum(['receiving', 'quarantine', 'cold', 'rejected', 'fgQuarantine', 'shipping', 'staging']),
      rect,
      grid: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
    }),
  ),
  racks: z.array(z.strictObject({ id: z.string().regex(/^[A-Z]$/), x: z.number(), z: z.number(), bays: z.number().int().min(1).max(30), levels: z.number().int().min(1).max(6) })),
  rooms: z.array(z.strictObject({ id: z.string(), type: z.string(), rect, grade: z.enum(['D', 'cnc']) })),
  points: z.strictObject({ park: point, entrance: point }),
});

/** Папка в content/ → приставка идентификатора и схема. */
export const KINDS = {
  profiles: { prefix: 'prf', schema: profile },
  scenarios: { prefix: 'scn', schema: scenario },
  units: { prefix: 'unit', schema: unit },
  materials: { prefix: 'mat', schema: material },
  containers: { prefix: 'cnt', schema: container },
  suppliers: { prefix: 'sup', schema: supplier },
  roles: { prefix: 'role', schema: role },
  vehicles: { prefix: 'veh', schema: vehicle },
  shifts: { prefix: 'shift', schema: shift },
  plants: { prefix: 'plant', schema: plant },
} as const;

export type Kind = keyof typeof KINDS;
