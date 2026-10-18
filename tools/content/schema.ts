// Схема исходных записей базы (YAML в content/, docs/04-data-model.md, §3–4). Строгие объекты: опечатка в имени поля —
// ошибка сборки, а не молча пропущенное поле. Числа в записях — в единицах автора (килограммы, рубли, метры, проценты);
// в единицы движка их переводит load.ts.
import { z } from 'zod';

const text = z.strictObject({ ru: z.string().min(1), en: z.string().min(1).optional() });
const review = z.enum(['draft', 'checked']);
/** Ключи источников — из таблицы docs/10-domain.md, §9 (проверяет load.ts). */
const sources = z.array(z.string().regex(/^[a-z0-9-]+$/, 'ключ источника — латиница, цифры и дефис')).min(1);
const percent = z.number().min(0).max(100);
/** число месяца */
const day = z.number().int().min(1).max(28);
const id = z.string().regex(/^[a-z][a-zA-Z0-9.-]*$/, 'идентификатор — латиница, цифры, точка и дефис');
/** Свойство качества (src/content/types.ts, `Attr` и `ATTRS` — единицы). */
const attr = z.enum(['identity', 'assay', 'moisture', 'appearance', 'particle', 'mass', 'hardness', 'friability', 'disintegration', 'dissolution']);
/** Источник и review пишутся вместе: запись с фактом — с источником; выбор геймдизайна — без. */
const paired = <T extends { source?: unknown; review?: unknown }>(o: T) => (o.source === undefined) === (o.review === undefined);
const pairedMsg = { message: 'источник и review пишутся вместе' };

export const profile = z.strictObject({
  id: z.string(),
  name: text,
  currency: z.string().regex(/^[A-Z]{3}$/, 'код валюты ISO 4217, три заглавные буквы'),
  vat: z.strictObject({ medicines: percent, general: percent }),
  /** НДС за квартал — равными долями до этого числа каждого из трёх следующих месяцев */
  vatDue: day,
  /** маркировка; плата за код, ₽ без НДС; коды бесплатны, если зарегистрированная цена позиции не выше `free`, ₽ */
  marking: z.strictObject({ packs: z.boolean(), aggregation: z.enum(['optional', 'required']), fee: z.number().min(0), free: z.number().min(0) }),
  /**
   * труд: ночные часы и доплата за них, % часовой ставки; страховые взносы, % — до предельной базы (₽ с начала года) и
   * сверх неё, «на травматизм» — и до какого числа следующего месяца
   */
  payroll: z.strictObject({
    night: z.strictObject({ from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(23), extra: percent }),
    contrib: z.strictObject({ rate: percent, base: z.number().int().positive(), above: percent, injury: percent, due: day }),
  }),
  /** электроэнергия: авансы — число месяца и доля стоимости прошлого месяца, %; окончательный расчёт — число следующего */
  energy: z.strictObject({ advances: z.array(z.tuple([day, percent])), final: day }),
  /** ключевая ставка Банка России, % */
  key: percent,
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
  /** кредитная линия: предел минуса кассы, ₽, и надбавка к ключевой ставке, п. п. */
  credit: z.strictObject({ limit: z.number().int().min(0), spread: z.number().min(0).max(50) }),
  /** цена электроэнергии, ₽ за кВт·ч без НДС */
  energy: z.strictObject({ price: z.number().positive() }),
  /** покупатели сценария */
  customers: z.array(id).default([]),
  staff: z.array(z.strictObject({ role: id, shift: id, skill: z.number().int().min(1).max(5), n: z.number().int().min(1).max(50) })).min(1),
  vehicles: z.array(z.strictObject({ type: id, n: z.number().int().min(1).max(20) })),
  orders: z.array(z.strictObject({ supplier: id, lines: z.array(z.strictObject({ material: id, qty })).min(1) })).default([]),
  /** задания на серию: карта, день «не раньше» от начала партии и товарная позиция, в которую упаковать балк */
  batches: z.array(z.strictObject({ recipe: id, day: z.number().int().min(0).max(3650), sku: id.optional() })).default([]),
  stock: z.array(z.strictObject({ material: id, qty })).default([]),
  /** износ узлов на старте, %: `<машина>/<узел>` → износ; завод не новый */
  wear: z.record(z.string(), z.number().min(0).max(300)).default({}),
  /**
   * политика техслужбы: `<машина>/<узел>` → износ, %, на котором узел меняют по наработке, как только машина свободна;
   * узла нет — меняют по отказу
   */
  maint: z.record(z.string(), z.number().min(1).max(300)).default({}),
  /** мастер линии: сменное задание — такая доля номинала узкого места линии за смену, % */
  norm: percent.default(100),
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
    /** `bulk` — свой полупродукт: таблетки после производства, до упаковки; `fg` — готовая продукция, пачки в ящиках */
    kind: z.enum(['api', 'excipient', 'packaging', 'bulk', 'fg']),
    name: text,
    unit: z.enum(['kg', 'pcs']),
    container: id,
    storage: z.enum(['room', 'cold']),
    /** месяцев */
    shelf: z.number().int().min(1).max(120),
    potency: z.boolean().optional(),
    /** спецификация входного контроля */
    spec: id,
    /** истинные свойства партии: среднее и разброс между партиями, в единицах свойства — только количественные */
    props: z.partialRecord(attr, z.tuple([z.number(), z.number().min(0)])).default({}),
    /** брак у поставщика: свойство и сдвиг, %; у качественного свойства сдвига нет — «не соответствует» */
    bad: z.strictObject({ attr, shift: z.number().optional() }).optional(),
    /** проба с одной тары: граммы или штуки; у готовой продукции — архивные образцы серии, пачек */
    sample: z.number().positive(),
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

export const container = z.strictObject({
  id: z.string(),
  name: text,
  kind: z.enum(['drum', 'bag', 'roll', 'box', 'bundle', 'bin', 'case']),
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
  /** доля партий с браком, % */
  defects: percent,
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

/** Прибор лаборатории: вид; экземпляры с местом — в плане завода. */
export const instrument = z.strictObject({
  id: z.string(),
  name: text,
});

/** Методика испытания (геймдизайн, §6.2). */
export const test = z
  .strictObject({
    id: z.string(),
    name: text,
    attr,
    /** вид прибора; нет — без прибора */
    inst: id.optional(),
    /** минуты: работа аналитика (подготовка) и работа прибора */
    prep: z.number().int().min(0),
    run: z.number().int().min(0),
    /** прибор работает без человека, и ночью тоже */
    unattended: z.boolean(),
    /** погрешность — СКО, в единицах свойства */
    sd: z.number().min(0),
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

/** Спецификация: испытания и пределы в единицах свойства. У качественного свойства пределов нет: «соответствует» или нет. */
export const spec = z
  .strictObject({
    id: z.string(),
    tests: z.array(z.strictObject({ test: id, min: z.number().optional(), max: z.number().optional() })).min(1),
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

const rect = z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]);
const point = z.tuple([z.number(), z.number()]);
/** клетки плана — целые метры */
const cells = z.tuple([z.number().int().min(0), z.number().int().min(0), z.number().int().positive(), z.number().int().positive()]);
const cell = z.tuple([z.number().int().min(0), z.number().int().min(0)]);
const turn = z.number().int().min(0).max(3).default(0);

/** План завода: метры участка. */
export const plant = z.strictObject({
  id: z.string(),
  /** здание — прямоугольник клеток со стенами по краю */
  building: cells,
  docks: z.array(z.strictObject({ id: z.string(), kind: z.enum(['in', 'out']), x: z.number(), z: z.number() })).min(1),
  zones: z.array(
    z.strictObject({
      id: z.string(),
      kind: z.enum(['receiving', 'quarantine', 'cold', 'rejected', 'fgQuarantine', 'shipping', 'staging', 'sampling', 'palletizing']),
      rect,
      grid: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
    }),
  ),
  racks: z.array(
    z.strictObject({
      id: z.string().regex(/^[A-Z]$/),
      x: z.number(),
      z: z.number(),
      bays: z.number().int().min(1).max(30),
      levels: z.number().int().min(1).max(6),
      /** проход — с севера (меньше z) или с юга */
      face: z.enum(['n', 's']),
    }),
  ),
  /** помещение — прямоугольник клеток со стенами по краю; соседние делят стену; технике туда можно; рабочая точка */
  rooms: z.array(z.strictObject({ id: z.string(), type: z.string(), rect: cells, grade: z.enum(['D', 'cnc']), vehicles: z.boolean().default(false), at: point.optional() })),
  /** двери на стенах: первая клетка, сколько клеток, вдоль какой оси идёт стена, вид */
  doors: z.array(
    z.strictObject({
      at: cell,
      len: z.number().int().min(1).max(6),
      along: z.enum(['x', 'z']),
      kind: z.enum(['door', 'double', 'gate', 'dock', 'hatch']),
      /** только для материалов: люди через неё не ходят */
      materials: z.boolean().optional(),
    }),
  ),
  /** приборы лаборатории: вид и помещение */
  instruments: z.array(z.strictObject({ id: z.string(), type: id, room: z.string() })).default([]),
  /** оборудование производства: вид и помещение */
  equipment: z.array(z.strictObject({ id: z.string(), type: id, room: z.string(), at: point, turn })).default([]),
  /**
   * упаковочные линии: помещение, зона паллетирования на выходе и машины по порядку; после каждой машины, кроме
   * последней, — накопитель: сколько её штук (блистеров, пачек) он держит
   */
  lines: z
    .array(
      z.strictObject({
        id: z.string(),
        room: z.string(),
        out: z.string(),
        machines: z.array(z.strictObject({ id: z.string(), type: id, buffer: z.number().int().positive().optional(), at: point, turn })).min(2),
      }),
    )
    .default([]),
  points: z.strictObject({ park: point, entrance: point }),
  /** посты ожидания: роль → точка, где человек ждёт задачи (docs/specs/2026-10-panels.md, 3а) */
  posts: z.record(id, point).default({}),
  /** вентиляция круглые сутки — Вт на м² помещения по классу; постоянная база (свет, офис, склад) — кВт */
  energy: z.strictObject({ hvac: z.strictObject({ D: z.number().min(0), cnc: z.number().min(0) }), base: z.number().min(0) }),
});

/** Продукт: лекарство по МНН и форма; дозировка — в имени. */
export const product = z.strictObject({
  id: z.string(),
  name: text,
  /** МНН латиницей */
  inn: z.string().regex(/^[a-z][a-z-]*$/),
  form: z.enum(['tablet']),
  /** в перечне ЖНВЛП: цена позиции — не выше зарегистрированной */
  jnvlp: z.boolean().default(false),
  source: sources.optional(),
  review: review.optional(),
}).refine(paired, pairedMsg);

const minutes = z.number().min(0);
/** ширина, глубина, высота, м */
const size3 = z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]);
const days = z.tuple([z.number().int().min(1), z.number().int().min(1)]).refine(([a, b]) => a <= b, { message: '«от» не больше «до»' });

/**
 * Узел машины (геймдизайн, §7.1; docs/specs/2026-10-engine.md, 1е): средний ресурс — единиц наработки (у оборудования
 * — таблеток, у машины линии — её штук: блистеров или пачек); таблица отказов — ступени «от такого износа, %, — столько
 * отказов на миллион единиц наработки»; запчасть; замена по плану и ремонт после отказа — минуты. Числа — гипотезы.
 */
const part = z.strictObject({
  id: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  name: text,
  life: z.number().int().positive(),
  hazard: z.array(z.tuple([z.number().min(0), z.number().min(0)])).min(1),
  spare: id,
  replace: minutes,
  repair: z.tuple([minutes, minutes]).refine(([a, b]) => a <= b, { message: '«от» не больше «до»' }),
  /** разброс МОК по ходу стадии при износе 100 %, в единицах свойства (у оборудования стадии) */
  scatter: z.partialRecord(attr, z.number().min(0)).optional(),
  /** во сколько раз чаще микроостановки машины при износе 100 % (у машины линии) */
  micro: z.number().min(1).optional(),
});

/**
 * Часть модели кодом (docs/13-art.md, §8; docs/specs/2026-10-view.md, 2в), м: середина на полу относительно середины следа
 * (`x` — вдоль ширины записи, `z` — вдоль глубины), высота середины `y`; размеры `w` (по x), `d` (по z), `h` (высота).
 * Цилиндр — вдоль оси `axis`; конус (бункер) — сверху диаметр `w`, снизу `bottom`; лента — поток штук `item`. `spin` —
 * крутится со скоростью машины; `cover` — открывается на переналадке и уборке.
 */
const modelPart = z.strictObject({
  shape: z.enum(['box', 'cyl', 'cone', 'glass', 'belt']),
  x: z.number(),
  z: z.number(),
  y: z.number(),
  w: z.number().positive(),
  d: z.number().positive(),
  h: z.number().positive(),
  color: z.enum(['white', 'steel', 'grey', 'dark', 'blue', 'film', 'foil', 'card']).optional(),
  axis: z.enum(['x', 'y', 'z']).optional(),
  bottom: z.number().positive().optional(),
  item: z.enum(['blister', 'carton', 'case']).optional(),
  spin: z.enum(['x', 'y', 'z']).optional(),
  cover: z.boolean().optional(),
});
const model = z.array(modelPart).min(1);

/** Вид оборудования (геймдизайн, §5.2, §5.5, §7.1): уборка малая и большая, минуты; мощность; узлы с износом. */
export const equipment = z
  .strictObject({
    id: z.string(),
    name: text,
    /** ширина, глубина, высота, м — след на полу (docs/specs/2026-10-view.md, 2а; гипотеза) */
    size: size3,
    /** модель кодом из частей (2в) */
    model,
    cleaning: z.strictObject({ minor: minutes, major: minutes }),
    /** мощность, пока идёт стадия, кВт */
    kw: z.number().min(0).default(0),
    parts: z.array(part).default([]),
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

/**
 * Технологическая карта (docs/04-data-model.md, §4–5): состав на серию, стадии, показатели балка, выход. Количества,
 * времена, режимы и разбросы — гипотезы геймдизайна; устройство стадий — с источником.
 */
export const recipe = z
  .strictObject({
    id: z.string(),
    name: text,
    product: id,
    /** размер серии: кг и штук */
    batch: z.strictObject({ kg: z.number().positive(), units: z.number().int().positive() }),
    /**
     * состав на серию, кг; `potency` — навеска пересчитывается на содержание партии; `qs` — «до массы»: этой строкой
     * добирают массу серии, если навеска с пересчётом больше нормы
     */
    bom: z.array(z.strictObject({ material: id, kg: z.number().positive(), potency: z.boolean().optional(), qs: z.boolean().optional() })).min(1),
    stages: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z][a-zA-Z0-9-]*$/),
          /** тип помещения */
          room: z.string(),
          /** виды оборудования стадии: всё — в одном помещении */
          equipment: z.array(id).min(1),
          staff: z.strictObject({ role: id, n: z.number().int().min(1).max(5) }),
          /** минуты: подготовка, на загрузку, на компонент; скорость — кг или штук в час; разброс длительности, % */
          time: z.strictObject({
            setup: minutes,
            perLoad: minutes.optional(),
            loads: z.number().int().min(1).max(10).optional(),
            perComponent: minutes.optional(),
            kgPerHour: z.number().positive().optional(),
            unitsPerHour: z.number().positive().optional(),
            spread: percent.default(0),
          }),
          /** режимы: цель, допустимый диапазон и разброс от серии к серии, в единицах режима */
          params: z
            .array(
              z.strictObject({
                id: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
                unit: z.enum(['rpm', 'min', 'C', 'kN', 'kg']),
                target: z.number(),
                range: z.tuple([z.number(), z.number()]),
                sd: z.number().min(0),
              }),
            )
            .default([]),
          /** межоперационный контроль: методика, как часто (минуты; нет — раз в конце стадии), пределы */
          ipc: z.array(z.strictObject({ test: id, every: minutes.optional(), min: z.number().optional(), max: z.number().optional() })).default([]),
          /** потери стадии: среднее и разброс, % от массы на входе */
          loss: z.tuple([percent, percent]).default([0, 0]),
        }),
      )
      .min(1),
    /** балк — материал полупродукта */
    bulk: id,
    /** показатели балка: номинал и разброс серии, в единицах свойства */
    quality: z.partialRecord(attr, z.tuple([z.number(), z.number().min(0)])),
    /** выход, %: ожидаемый и тревожный — ниже тревожного отклонение */
    yield: z.strictObject({ expected: percent, alarm: percent }),
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

/**
 * Причина (docs/04-data-model.md, §4): откуда вклад и в какие показатели серии. Направление вклада — факт с источником;
 * величина коэффициента — гипотеза геймдизайна.
 */
export const cause = z
  .strictObject({
    id: z.string(),
    name: text,
    /**
     * отход режима стадии от цели; содержание АФС против измеренного; свойство отвешенных партий; другой показатель;
     * износ узла
     */
    driver: z.union([
      z.strictObject({ param: z.string() }),
      z.strictObject({ potency: z.literal(true) }),
      z.strictObject({ lots: z.enum(['api', 'excipient']), attr }),
      z.strictObject({ attr }),
      /** средний износ узла оборудования за стадию, % */
      z.strictObject({ wear: z.string().regex(/^[a-z][a-zA-Z0-9]*$/) }),
    ]),
    /** вклад: показатель серии и коэффициент — единиц показателя на единицу отхода */
    effects: z.array(z.strictObject({ attr, coef: z.number() })).min(1),
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

/**
 * Машина упаковочной линии (геймдизайн, §5.6; docs/specs/2026-10-engine.md, 1г): в чём считается её скорость, номинал,
 * люди, микроостановки, брак камеры, переналадка на другой формат. Числа — гипотезы старой линии кампании; что делает
 * машина — с источником.
 */
export const machine = z
  .strictObject({
    id: z.string(),
    name: text,
    /** ширина, глубина, высота, м — след на полу (гипотеза) */
    size: size3,
    /** модель кодом из частей (2в) */
    model,
    /** скорость — блистеров или пачек в минуту */
    item: z.enum(['blister', 'carton']),
    nominal: z.number().int().positive(),
    crew: z.strictObject({ role: id, n: z.number().int().min(1).max(5) }),
    /** микроостановки: в среднем раз в столько минут работы на номинале и столько минут длятся */
    micro: z.strictObject({ every: z.number().positive(), duration: z.number().positive() }).optional(),
    /** брак камеры, % выхода */
    reject: percent.default(0),
    /** переналадка на другой формат, минуты */
    changeover: minutes.default(0),
    /** мощность на ходу, кВт */
    kw: z.number().min(0).default(0),
    parts: z.array(part).default([]),
    /** заминка — микроостановка, которая портит столько пачек с вложениями; столько % испорченного не записывают */
    jam: z.strictObject({ cartons: z.number().int().min(1), uncounted: percent }).optional(),
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

/**
 * Товарная позиция (docs/04-data-model.md, §4): готовая продукция, формат линии, таблеток в блистере и блистеров в
 * пачке, упаковочные материалы на блистер, пачку и ящик, ящиков на паллете, брак на наладку. Числа — гипотезы.
 */
export const sku = z.strictObject({
  id: z.string(),
  name: text,
  product: id,
  /** готовая продукция — материал вида fg */
  fg: id,
  /** формат линии: у следующей позиции другой — переналадка */
  format: z.string().regex(/^[a-z0-9-]+$/),
  perBlister: z.number().int().min(1).max(100),
  blisters: z.number().int().min(1).max(10),
  /** на блистер — граммы */
  blister: z.array(z.strictObject({ material: id, g: z.number().positive() })).min(1),
  /** на пачку — штуки */
  carton: z.array(z.strictObject({ material: id, n: z.number().int().positive() })).min(1),
  /** гофроящик и сколько пачек в нём */
  case: z.strictObject({ material: id, per: z.number().int().positive() }),
  pallet: z.strictObject({ cases: z.number().int().positive() }),
  /** на наладку в начале серии: блистеров и пачек — в брак; пачек в запас на заминки картонажной */
  waste: z.strictObject({ blisters: z.number().int().min(0), cartons: z.number().int().min(0), jams: z.number().int().min(0).default(0) }),
  /** цена завода за пачку и зарегистрированная предельная цена (у ЖНВЛП), ₽ без НДС */
  price: z.number().positive(),
  regPrice: z.number().positive().optional(),
});

/**
 * Покупатель (геймдизайн, §10.2; docs/specs/2026-10-engine.md, 1д): отсрочка, дни и час заказа, через сколько дней
 * желаемая дата, наименьший остаточный срок годности и спрос по позициям — пачек в сутки. Числа — гипотезы; что
 * остаточный срок — условие договора, — с источником.
 */
export const customer = z
  .strictObject({
    id: z.string(),
    name: text,
    /** оплата через столько дней после отгрузки */
    payDays: z.number().int().min(0).max(365),
    /** дни недели (1 — понедельник), час заказа и через сколько дней «от — до» желаемая дата */
    order: z.strictObject({
      days: z.array(z.number().int().min(1).max(7)).min(1),
      hour: z.number().int().min(0).max(23),
      lead: z.tuple([z.number().int().min(1), z.number().int().min(1)]).refine(([a, b]) => a <= b, { message: '«от» не больше «до»' }),
    }),
    /** наименьший остаточный срок годности, % полного */
    minShelf: percent,
    /** спрос: позиция → пачек в сутки */
    demand: z.record(id, z.number().min(0)),
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

/**
 * Запасная часть на складе ЗИП (геймдизайн, §7.2; docs/specs/2026-10-engine.md, 1е): поставщик, цена, ₽ без НДС, срок
 * поставки, дни; неснижаемый и начальный уровни — пополнение «по уровню неснижаемого запаса». Числа — гипотезы.
 */
export const spare = z
  .strictObject({
    id: z.string(),
    name: text,
    supplier: id,
    price: z.number().positive(),
    lead: days,
    stock: z.strictObject({ min: z.number().int().min(0), max: z.number().int().min(1) }).refine(x => x.min < x.max, { message: 'неснижаемый уровень ниже начального' }),
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

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
  instruments: { prefix: 'inst', schema: instrument },
  tests: { prefix: 'test', schema: test },
  specs: { prefix: 'spec', schema: spec },
  products: { prefix: 'prd', schema: product },
  equipment: { prefix: 'eq', schema: equipment },
  recipes: { prefix: 'rcp', schema: recipe },
  causes: { prefix: 'cause', schema: cause },
  machines: { prefix: 'mach', schema: machine },
  skus: { prefix: 'sku', schema: sku },
  customers: { prefix: 'cus', schema: customer },
  spares: { prefix: 'spare', schema: spare },
} as const;

export type Kind = keyof typeof KINDS;
