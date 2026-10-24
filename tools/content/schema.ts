// Схема исходных записей базы (YAML в content/, docs/04-data-model.md, §3–4). Строгие объекты: опечатка в имени поля —
// ошибка сборки, а не молча пропущенное поле. Числа в записях — в единицах автора (килограммы, рубли, метры, проценты);
// в единицы движка их переводит load.ts.
import { z } from 'zod';
import { SEATS, TASK_KINDS } from '../../src/content/types';

const text = z.strictObject({ ru: z.string().min(1), en: z.string().min(1).optional() });
const review = z.enum(['draft', 'checked']);
/** Ключи источников — из таблицы docs/10-domain.md, §9 (проверяет load.ts). */
const sources = z.array(z.string().regex(/^[a-z0-9-]+$/, 'ключ источника — латиница, цифры и дефис')).min(1);
const percent = z.number().min(0).max(100);
/** число месяца */
const day = z.number().int().min(1).max(28);
const id = z.string().regex(/^[a-z][a-zA-Z0-9.-]*$/, 'идентификатор — латиница, цифры, точка и дефис');
/** Свойство качества (src/content/types.ts, `Attr` и `ATTRS` — единицы). */
const attr = z.enum(['identity', 'assay', 'moisture', 'appearance', 'particle', 'mass', 'hardness', 'friability', 'disintegration', 'dissolution', 'granule', 'uniformity']);
/** Источник и review пишутся вместе: запись с фактом — с источником; выбор геймдизайна — без. */
const paired = <T extends { source?: unknown; review?: unknown }>(o: T) => (o.source === undefined) === (o.review === undefined);
const pairedMsg = { message: 'источник и review пишутся вместе' };
/** код единицы по ОКЕИ — три цифры */
const okeiCode = z.number().int().min(1).max(999);
/**
 * Внутренний код материала (Б3а; GMP ЕАЭС, ч. I, п. 4.14): шесть цифр, первая — вид (1 — АФС, 2 — вспомогательное
 * вещество, 3 — упаковочный материал, 4 — балк, 5 — готовая продукция, 6 — запчасть), дальше — номер по порядку. В YAML —
 * числом; в базе — строкой. Коды вымышленные; вид и уникальность сверяет load.ts.
 */
const matCode = z.coerce.string().regex(/^[1-6]\d{5}$/, 'внутренний код — шесть цифр, первая — вид материала');

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
    /** сверхурочные (Б4а): предел за смену и за год, ч; первые `first` ч — по первой ставке, дальше — по второй, % часовой */
    overtime: z.strictObject({ shift: z.number().positive().max(12), year: z.number().int().positive().max(1000), first: z.number().positive().max(12), rates: z.tuple([z.number().min(100).max(1000), z.number().min(100).max(1000)]) }),
    /** работа в выходной или праздник (Б4а): сверх оклада, % часовой ставки — в пределах месячной нормы и сверх неё */
    holiday: z.strictObject({ within: z.number().min(0).max(1000), beyond: z.number().min(0).max(1000) }),
    contrib: z.strictObject({ rate: percent, base: z.number().int().positive(), above: percent, injury: percent, due: day }),
  }),
  /**
   * производственный календарь (Б4а): нерабочие праздники — месяц и число; январские праздники (с, по), выходные на
   * которых по ч. 2 ст. 112 не переносятся; переносы постановлением — с какого дня на какой; на сколько часов короче
   * день накануне праздника; часов в неделю — норма по расчётной пятидневке
   */
  calendar: z.strictObject({
    holidays: z.array(z.tuple([z.number().int().min(1).max(12), z.number().int().min(1).max(31)])),
    january: z.tuple([z.number().int().min(1).max(31), z.number().int().min(1).max(31)]),
    transfers: z.array(z.tuple([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата пишется как ГГГГ-ММ-ДД'), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата пишется как ГГГГ-ММ-ДД')])).default([]),
    short: z.number().int().min(0).max(4),
    week: z.number().int().min(1).max(60),
  }),
  /** электроэнергия: авансы — число месяца и доля стоимости прошлого месяца, %; окончательный расчёт — число следующего */
  energy: z.strictObject({ advances: z.array(z.tuple([day, percent])), final: day }),
  /** ключевая ставка Банка России, % */
  key: percent,
  /** коды единиц по ОКЕИ (Б3а): миллиграмм, грамм, килограмм, штука, упаковка — для справочника и обмена */
  okei: z.strictObject({ mg: okeiCode, g: okeiCode, kg: okeiCode, pcs: okeiCode, pack: okeiCode }),
  /**
   * найм и увольнение (Б4в): испытание при приёме — не дольше стольких месяцев; предупреждение об уходе по собственному
   * желанию, дней; на испытании — дней; не выдержавшего испытание предупреждают не позже чем за столько дней
   */
  labor: z.strictObject({ probation: z.number().int().min(0).max(12), notice: z.number().int().min(1).max(60), trial: z.number().int().min(1).max(30) }),
  /**
   * отпуска (Б4г): календарных дней за рабочий год; одна часть — не меньше `part` дней; право за первый год — через
   * `first` месяцев работы; график утверждают не позже чем за `approve` дней до года, о начале отпуска извещают не позже
   * чем за `notice` дней, отпускные платят не позже чем за `pay` дней; средний заработок — за `months` месяцев,
   * среднемесячное число дней — `avg`; при увольнении `full` месяцев рабочего года и больше — полная компенсация
   */
  leave: z.strictObject({
    days: z.number().int().min(1).max(60),
    part: z.number().int().min(1).max(60),
    first: z.number().int().min(0).max(12),
    approve: z.number().int().min(1).max(60),
    notice: z.number().int().min(1).max(60),
    pay: z.number().int().min(1).max(30),
    months: z.number().int().min(1).max(24),
    avg: z.number().positive().max(31),
    full: z.number().int().min(1).max(12),
  }),
  source: sources,
  review,
});

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата пишется как ГГГГ-ММ-ДД');
/**
 * Шапка регламентирующего документа (Б3а; GMP ЕАЭС, ч. I, пп. 4.3, 4.5): код — вид и номер латиницей (`SP` —
 * спецификация, `TM` — методика испытания, `MF` — технологическая карта, `PI` — инструкция по упаковке, `SOP` —
 * процедура, с Б3б, `QAG` — соглашение по качеству, с Б3г), номер редакции, дата введения в действие и кто утвердил —
 * роль. Редакции одного документа — записи с одним кодом; статус — по дате завода (src/engine/docs.ts).
 */
const doc = (kind: 'SP' | 'TM' | 'MF' | 'PI' | 'SOP' | 'QAG') =>
  z.strictObject({
    code: z.string().regex(new RegExp(`^${kind}-\\d{4}$`), `код документа — ${kind}-NNNN`),
    rev: z.number().int().min(1).max(99),
    from: date,
    approved: id,
  });
/** Количество в единице материала: кг или штуки — load.ts сверяет с материалом. */
const qty = z.number().positive();
/**
 * Обучение по документу (Б3б): роли, которые по нему учатся, — строка матрицы обучения; часы на изучение; через сколько
 * месяцев учиться снова.
 */
const learn = {
  roles: z.array(id).min(1),
  hours: z.number().positive().max(40),
  every: z.number().int().min(1).max(60),
};

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
  staff: z.array(z.strictObject({ role: id, shift: id, skill: z.number().int().min(1).max(5), n: z.number().int().min(1).max(50), also: z.array(id).min(1).optional() })).min(1),
  vehicles: z.array(z.strictObject({ type: id, n: z.number().int().min(1).max(20) })),
  orders: z.array(z.strictObject({ supplier: id, lines: z.array(z.strictObject({ material: id, qty })).min(1) })).default([]),
  /** задания на серию: карта, день «не раньше» от начала партии и товарная позиция, в которую упаковать балк */
  batches: z.array(z.strictObject({ recipe: id, day: z.number().int().min(0).max(3650), sku: id.optional() })).default([]),
  /**
   * план выпуска (Б2в): что может поставить коллега планирования — карта и позиция; запас позиции в сутках спроса сверх
   * двух замороженных недель; за сколько суток считать средний спрос
   */
  plan: z
    .strictObject({
      items: z.array(z.strictObject({ recipe: id, sku: id })).min(1),
      cover: z.number().int().min(1).max(365),
      window: z.number().int().min(7).max(365),
      urgent: z.number().int().min(0).max(365).optional(),
    })
    .optional(),
  /** снабжение (Б2в): страховой запас и заказ — в сутках расхода, входной контроль — в сутках */
  supply: z
    .strictObject({
      safety: z.number().int().min(0).max(365),
      every: z.number().int().min(1).max(365),
      qc: z.number().int().min(0).max(60),
    })
    .optional(),
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
  /** места, которые игрок может взять (геймдизайн, §29.5); остальные ведёт сценарий; нет — все */
  seats: z.array(z.enum(SEATS)).min(1).default([...SEATS]),
  /**
   * обучение (Б3б): за сколько суток до введения новой редакции или конца срока записи — задача обучения; проверка
   * знаний, минуты; на старте дни обучения — до стольких суток назад; табельные номера — с этого номера
   */
  training: z.strictObject({
    ahead: z.number().int().min(1).max(90),
    check: z.number().int().min(1).max(240),
    spread: z.number().int().min(0).max(3650),
    tab: z.number().int().min(1).max(9000),
  }),
  /**
   * места и оборудование (Б3в): за сколько суток до конца записи коллега техслужбы назначает визит подрядчика; рабочие
   * часы подрядчика, с и до; приёмка его работы, минуты; инвентарные номера — по порядку мест с этого номера
   */
  assets: z.strictObject({
    ahead: z.number().int().min(1).max(90),
    hours: z.tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)]).refine(([a, b]) => a < b, { message: 'рабочий день подрядчика кончается раньше, чем начинается' }),
    accept: z.number().int().min(1).max(240),
    inv: z.number().int().min(1).max(99_999_999),
  }),
  /**
   * контрагенты и договоры (Б3г): за сколько суток до конца одобрения пары коллега качества назначает оценку; через
   * сколько месяцев оценивать снова — по виду материала; аудит — рабочих дней у изготовителя, рассмотрение отчёта, ч,
   * цена без НДС, ₽; оценка по документам, ч; прайс дороже цены договора, %; обещанная доля объёма, %; срок договора,
   * месяцев; номера договоров — по порядку с `ctr`
   */
  partners: z.strictObject({
    ahead: z.number().int().min(1).max(120),
    every: z.strictObject({ api: z.number().int().min(1).max(60), excipient: z.number().int().min(1).max(60), packaging: z.number().int().min(1).max(60) }),
    audit: z.strictObject({ days: z.number().int().min(1).max(10), review: z.number().positive().max(40), price: z.number().positive() }),
    docs: z.strictObject({ review: z.number().positive().max(40) }),
    markup: percent,
    share: percent,
    months: z.number().int().min(1).max(36),
    ctr: z.number().int().min(1).max(9999),
  }),
  /**
   * политики отделов на старте (Б4а): сверхурочные — «по потребности» (задачу ставят и тогда, когда она кончится после
   * смены, в пределах закона) или «только закончить начатое»
   */
  policies: z.strictObject({ overtime: z.enum(['need', 'finish']) }),
  /**
   * учётный период суммированного учёта сменных графиков по циклу (Б4б; ст. 104 ТК РФ), месяцев: делитель года, не
   * длиннее года — load.ts
   */
  account: z.number().int().min(1).max(12),
  /**
   * склад ГП на старте (Б1г): выпущенная ГП позиций плана выпуска в обороте — на столько суток спроса покупателей;
   * серии произведены от `age[1]` до `age[0]` суток до начала
   */
  fg: z
    .strictObject({
      days: z.number().int().min(1).max(120),
      age: z.tuple([z.number().int().min(1).max(365), z.number().int().min(1).max(365)]).refine(([a, b]) => a <= b, { message: 'age: младшая серия старше самой старой' }),
    })
    .optional(),
  /** отклонения (Б1г): срок расследования по процедуре завода, сутки */
  deviations: z.strictObject({ term: z.number().int().min(1).max(365) }),
  /**
   * рынок труда города (Б4в): объявление — ₽ в неделю; кадровое агентство — % годового оклада принятого, опытный
   * кандидат с навыком от и до через столько-то суток от и до; медосмотр при приёме — рабочих дней и ₽; кандидат ищет
   * работу столько суток; ожидание оклада — уровень роли, выше на `step` % за ступень навыка выше 3 (ниже — за ступень
   * ниже), с разбросом `spread` %; выплата по соглашению сторон — окладов; испытание по умолчанию, месяцев, — не длиннее
   * предела профиля (load.ts); на испытании уходят чаще во столько раз;
   * коллега берёт кандидата с навыком не ниже `skill` и ожиданием не выше уровня роли на `over` %, через агентство — если
   * по объявлению `ad` суток никого. По ролям: доли недель с 0, 1, 2 и 3 откликами на объявление, %; доли навыков 1–5,
   * %; уходят по собственному желанию — % людей роли в год. Нет записи — ни кандидатов, ни заявлений
   */
  labor: z
    .strictObject({
      ad: z.number().min(0),
      agency: z.strictObject({
        share: percent,
        days: z.tuple([z.number().int().min(1).max(120), z.number().int().min(1).max(120)]).refine(([a, b]) => a <= b, { message: '«от» не больше «до»' }),
        skill: z.tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)]).refine(([a, b]) => a <= b, { message: '«от» не больше «до»' }),
      }),
      medical: z.strictObject({ days: z.number().int().min(1).max(30), price: z.number().min(0) }),
      wait: z.number().int().min(1).max(90),
      step: percent,
      spread: percent,
      agree: z.number().min(0).max(24),
      probation: z.number().int().min(0).max(12),
      trial: z.number().min(1).max(20),
      colleague: z.strictObject({ skill: z.number().int().min(1).max(5), over: percent, ad: z.number().int().min(1).max(90) }),
      roles: z.record(
        id,
        z.strictObject({
          ad: z.tuple([percent, percent, percent, percent]),
          skill: z.tuple([percent, percent, percent, percent, percent]),
          quit: percent,
        }),
      ),
    })
    .optional(),
  /**
   * отпуска (Б4г): черновик графика на следующий год — в первый рабочий день не раньше этого месяца и числа, в 09:00;
   * утверждение — в последний рабочий день не позже этого; части у каждого — дней по порядку, первая летом (`summer`,
   * месяц и число с и по), остальные — в `rest`; из отдела в отпуске — не больше `dept` человек сразу; доплата
   * заместителю — % оклада ушедшего за дни замещения. Нет записи — отпусков нет
   */
  leave: z
    .strictObject({
      draft: z.tuple([z.number().int().min(1).max(12), z.number().int().min(1).max(31)]),
      approve: z.tuple([z.number().int().min(1).max(12), z.number().int().min(1).max(31)]),
      parts: z.array(z.number().int().min(1).max(60)).min(1).max(4),
      summer: z.tuple([z.tuple([z.number().int().min(1).max(12), z.number().int().min(1).max(31)]), z.tuple([z.number().int().min(1).max(12), z.number().int().min(1).max(31)])]),
      rest: z.tuple([z.tuple([z.number().int().min(1).max(12), z.number().int().min(1).max(31)]), z.tuple([z.number().int().min(1).max(12), z.number().int().min(1).max(31)])]),
      dept: z.number().int().min(1).max(20),
      cover: percent,
    })
    .optional(),
  /**
   * происшествие прототипа (docs/specs/2026-10-investigation.md): задание на серию по номеру с 1, модель расследования,
   * веса корней, %, и величина неисправности — от и до: ошибка лаборатории — % ниже истинного, опудривание — мин сверх
   * цели, сила прессования — кН сверх цели, сито — мм крупнее карты
   */
  incident: z
    .strictObject({
      batch: z.number().int().min(1),
      inv: id,
      roots: z.partialRecord(z.enum(['lab', 'lube', 'force', 'screen']), percent),
      sizes: z.strictObject({
        lab: z.tuple([z.number().positive(), z.number().positive()]),
        lube: z.tuple([z.number().positive(), z.number().positive()]),
        force: z.tuple([z.number().positive(), z.number().positive()]),
        screen: z.tuple([z.number().positive(), z.number().positive()]),
      }),
    })
    .optional(),
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
    code: matCode,
    name: text,
    unit: z.enum(['kg', 'pcs']),
    container: id,
    /** режим хранения, который материал требует (Б3в): запись content/regimes/ */
    storage: id,
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

/**
 * Поставщик (Б3г): сам изготовитель — ссылка на его запись — или дистрибьютор; у материала — цена рамочного договора, ₽
 * за кг или за штуку, минимальная партия — кг или штуки, и изготовитель (у поставщика-изготовителя — он сам).
 */
export const supplier = z.strictObject({
  id: z.string(),
  name: text,
  maker: id.optional(),
  /** дни «от — до» */
  lead: z.tuple([z.number().int().min(1), z.number().int().min(1)]).refine(([a, b]) => a <= b, { message: '«от» не больше «до»' }),
  prepay: percent,
  payDays: z.number().int().min(0).max(365),
  /** доля партий с браком, % */
  defects: percent,
  items: z.record(id, z.strictObject({ price: z.number().positive(), moq: qty, maker: id.optional() })),
});

/** Изготовитель (Б3г): вымышленный — название и площадка; страна — настоящая; что выпускает. */
export const maker = z.strictObject({
  id: z.string(),
  name: text,
  country: text,
  site: text,
  makes: z.array(id).min(1),
});

/** Что фиксирует соглашение по качеству (GMP ЕАЭС, ч. I, п. 5.28). */
export const AGREEMENT_TERMS = ['handling', 'labelling', 'packaging', 'shipping', 'complaints', 'recall'] as const;

/**
 * Соглашение по качеству (Б3г): документ `QAG-NNNN` с шапкой Б3а; поставщик, изготовители и материалы, которые оно
 * покрывает, и что в нём зафиксировано.
 */
export const agreement = z
  .strictObject({
    id: z.string(),
    name: text,
    doc: doc('QAG'),
    supplier: id,
    makers: z.array(id).min(1),
    materials: z.array(id).min(1),
    terms: z.array(z.enum(AGREEMENT_TERMS)).min(1),
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

export const role = z.strictObject({
  id: z.string(),
  name: text,
  dept: z.enum(['wms', 'qc', 'qa', 'mes', 'line', 'maint']),
  /** ₽ в месяц */
  salary: z.number().int().positive(),
  /** заменить может только человек той же роли (Б4г): смежной профессией эта роль не бывает */
  same: z.literal(true).optional(),
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
});

/** Часы смены по циклу (Б4б): с и до, целые часы от полуночи; ночная кончается на следующие сутки. */
const hours = z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(24)]);

/**
 * График (геймдизайн, §8.3): пятидневка — дни недели и часы смены; сменный по циклу (Б4б) — рисунок по суткам от дня
 * отсчёта со сдвигом бригады, часы дневной и ночной смены. Одно из двух — load.ts.
 */
export const shift = z.strictObject({
  id: z.string(),
  name: text,
  /** 1 — понедельник … 7 — воскресенье */
  days: z.array(z.number().int().min(1).max(7)).min(1).optional(),
  from: z.number().int().min(0).max(23).optional(),
  to: z.number().int().min(1).max(24).optional(),
  /**
   * перерыв для отдыха и питания, ч (Б4а): от 30 минут до 2 часов, в рабочее время не входит (ст. 108 ТК РФ); нет —
   * отдых и еда в рабочее время, где перерыв невозможен по условиям производства (ст. 108, ч. 3)
   */
  break: z.number().min(0.5).max(2).optional(),
  /** сменный по циклу (Б4б): день отсчёта рисунка, сдвиг бригады в сутках, рисунок, часы дневной и ночной смены */
  cycle: z
    .strictObject({
      from: date,
      offset: z.number().int().min(0).max(60),
      pattern: z.array(z.enum(['day', 'night', 'off'])).min(2).max(28),
      day: hours,
      night: hours,
    })
    .optional(),
});

/**
 * Работа подрядчика по классу (Б3в; геймдизайн, §7.2): через сколько месяцев снова, часов работы, цена — ₽ без НДС; как
 * она называется в окне. Калибровка у датчика условий хранения называется поверкой (`verify`).
 */
const qualWork = z.strictObject({
  every: z.number().int().min(1).max(120),
  hours: z.number().positive().max(24),
  price: z.number().positive(),
  name: text,
});
const calWork = qualWork.extend({ verify: z.literal(true).optional() });
/** класс критический — для перечня основного оборудования в досье площадки (GMP ЕАЭС, ч. III, прил. 8) */
const critical = z.literal(true).optional();

/** Прибор: вид — лаборатории, МОК или датчик; экземпляры с местом — в плане завода. Средство измерений: калибровка — всегда. */
export const instrument = z
  .strictObject({
    id: z.string(),
    name: text,
    cal: calWork,
    qual: qualWork.optional(),
    critical,
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

/**
 * Режим хранения ГФ XV (Б3в; ОФС.1.1.0010): слова этикетки; диапазон температуры, °C, — от и до; наибольшая средняя
 * относительная влажность, %.
 */
export const regime = z.strictObject({
  id: z.string(),
  name: text,
  temp: z.tuple([z.number().min(-40).max(60), z.number().min(-40).max(60)]).refine(([a, b]) => a < b, { message: '«от» меньше «до»' }),
  rh: percent,
  source: sources,
  review,
});

/** Методика испытания (геймдизайн, §6.2). */
export const test = z
  .strictObject({
    id: z.string(),
    name: text,
    doc: doc('TM'),
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
    ...learn,
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

/** Работы, которым нужны процедуры: все виды задач, кроме самого обучения — оно допуска не требует. */
export const WORKS = TASK_KINDS.filter(k => k !== 'train' && k !== 'trainCheck');

/**
 * Процедура (СОП, Б3б): шапка документа, обучение и каким работам она нужна — видам задач, стадиям на классах
 * оборудования, работам у линии с этими машинами, работе на технике; `any` — любой работе, кроме обучения.
 */
export const sop = z
  .strictObject({
    id: z.string(),
    name: text,
    doc: doc('SOP'),
    ...learn,
    for: z
      .strictObject({
        any: z.literal(true).optional(),
        tasks: z.array(z.enum(WORKS)).min(1).optional(),
        equipment: z.array(id).min(1).optional(),
        machines: z.array(id).min(1).optional(),
        vehicles: z.array(id).min(1).optional(),
      })
      .refine(f => Object.keys(f).length > 0, { message: 'процедура нужна хоть одной работе' }),
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

/**
 * Спецификация: что она описывает, шапка документа, испытания и пределы в единицах свойства. У качественного свойства
 * пределов нет: «соответствует» или нет.
 */
export const spec = z
  .strictObject({
    id: z.string(),
    name: text,
    doc: doc('SP'),
    tests: z.array(z.strictObject({ test: id, min: z.number().optional(), max: z.number().optional() })).min(1),
    /** одобренные пары «поставщик — изготовитель» (Б3г; GMP ЕАЭС, ч. I, п. 4.14) — у исходного и упаковочного материала */
    pairs: z.array(z.strictObject({ supplier: id, maker: id })).min(1).optional(),
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

/**
 * Коды мест (Б3в): участок — две латинские буквы; рабочее место — код участка, дефис и две цифры; рабочий блок — код
 * рабочего места, точка и две цифры (`TB-01.03`). Формат — гипотеза.
 */
const areaCode = z.string().regex(/^[A-Z]{2}$/, 'код участка — две заглавные латинские буквы');
const centerCode = z.string().regex(/^[A-Z]{2}-\d{2}$/, 'код рабочего места — участок, дефис и две цифры');
const placeCode = z.string().regex(/^[A-Z]{2}-\d{2}\.\d{2}$/, 'код места — рабочее место, точка и две цифры');
/** прибор вне лаборатории: прибор МОК или датчик условий хранения — вид, помещение, код места */
const meter = z.strictObject({ id: z.string(), type: id, room: z.string(), place: placeCode });

/** План завода: метры участка. */
export const plant = z.strictObject({
  id: z.string(),
  /** площадка (Б3в): код и название */
  site: z.strictObject({ code: z.string().regex(/^[A-Z0-9]{2,6}$/, 'код площадки — от двух до шести латинских букв и цифр'), name: text }),
  /**
   * участки (Б3в): помещения, которым участок служит, и рабочие места — технологическая ячейка, производственная линия,
   * зона хранения (её помещения и режим, который она держит) и лаборатория
   */
  areas: z
    .array(
      z.strictObject({
        code: areaCode,
        name: text,
        rooms: z.array(z.string()).default([]),
        centers: z
          .array(
            z.strictObject({
              code: centerCode,
              kind: z.enum(['cell', 'line', 'storage', 'lab']),
              name: text,
              rooms: z.array(z.string()).min(1).optional(),
              regime: id.optional(),
            }),
          )
          .default([]),
      }),
    )
    .min(1),
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
  /** приборы лаборатории: вид, помещение и код места */
  instruments: z.array(z.strictObject({ id: z.string(), type: id, room: z.string(), place: placeCode })).default([]),
  /** приборы МОК у оборудования стадий и датчики системы мониторинга условий хранения (Б3в) */
  ipc: z.array(meter).default([]),
  sensors: z.array(meter).default([]),
  /** оборудование производства: вид, помещение и код места */
  equipment: z.array(z.strictObject({ id: z.string(), type: id, room: z.string(), at: point, turn, place: placeCode })).default([]),
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
        machines: z.array(z.strictObject({ id: z.string(), type: id, buffer: z.number().int().positive().optional(), at: point, turn, place: placeCode })).min(2),
      }),
    )
    .default([]),
  points: z.strictObject({ park: point, entrance: point }),
  /** посты ожидания: роль → точка, где человек ждёт задачи (docs/specs/2026-10-panels.md, 3а) */
  posts: z.record(id, point).default({}),
  /** вентиляция круглые сутки — Вт на м² помещения по классу; постоянная база (свет, офис, склад) — кВт */
  energy: z.strictObject({ hvac: z.strictObject({ D: z.number().min(0), cnc: z.number().min(0) }), base: z.number().min(0) }),
  /**
   * уборка помещения после серии (Б4в): уборщик — после мойки оборудования, секунды на м² пола по классу чистоты, малая и
   * генеральная; у класса помещений со стадиями — обязательно (load.ts)
   */
  cleaning: z.partialRecord(z.enum(['D', 'cnc']), z.strictObject({ minor: z.number().int().min(1).max(600), major: z.number().int().min(1).max(600) })).default({}),
});

/** Продукт: лекарство по МНН, форма и дозировка. */
export const product = z.strictObject({
  id: z.string(),
  name: text,
  /** МНН латиницей */
  inn: z.string().regex(/^[a-z][a-z-]*$/),
  /**
   * код в номере серии `PPNNNMMYY` (docs/specs/2026-10-master-data.md, «Номер серии»): две заглавные латинские буквы или
   * цифры — в наборе знаков GS1 нет кириллицы; у каждого продукта свой, и его не меняют — по нему записаны номера серий
   */
  code: z.string().regex(/^[A-Z0-9]{2}$/),
  form: z.enum(['tablet']),
  /** дозировка (Б3а): действующего вещества в единице формы, мг */
  strength: z.strictObject({ mg: z.number().positive() }),
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

/** Вид оборудования (геймдизайн, §5.2, §5.5, §7.1): уборка малая и генеральная, минуты; мощность; узлы с износом. */
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
    /** повторная квалификация и калибровка подрядчиком (Б3в) */
    qual: qualWork.optional(),
    cal: calWork.optional(),
    critical,
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
    doc: doc('MF'),
    product: id,
    /** размер серии: кг и штук */
    batch: z.strictObject({ kg: z.number().positive(), units: z.number().int().positive() }),
    /**
     * состав на серию, кг; `potency` — навеска пересчитывается на содержание партии; `qs` — «до массы»: этой строкой
     * добирают массу серии, если навеска с пересчётом больше нормы; `stage` — стадия, на которой компонент загружают
     * (Б1д): порядок загрузки сырья — часть технологической инструкции (GMP ЕАЭС, ч. I, п. 4.18 d)
     */
    bom: z
      .array(z.strictObject({ material: id, kg: z.number().positive(), potency: z.boolean().optional(), qs: z.boolean().optional(), stage: z.string() }))
      .min(1),
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
          /** ячейка сита калибратора по карте, мм */
          screen: z.number().positive().optional(),
          /** первое смешивание субстанции с другими ингредиентами: дата производства и месяц и год в номере серии */
          mix: z.literal(true).optional(),
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
      /** сито калибратора крупнее карты, мм (часть 4) */
      z.strictObject({ screen: z.literal(true) }),
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
    /** малая и генеральная уборка машины, которая касается таблеток, минуты (Б1е); прочим хватает очистки линии */
    cleaning: z.strictObject({ minor: minutes, major: minutes }).optional(),
    /** мощность на ходу, кВт */
    kw: z.number().min(0).default(0),
    parts: z.array(part).default([]),
    /** заминка — микроостановка, которая портит столько пачек с вложениями; столько % испорченного не записывают */
    jam: z.strictObject({ cartons: z.number().int().min(1), uncounted: percent }).optional(),
    /** повторная квалификация и калибровка подрядчиком (Б3в) */
    qual: qualWork.optional(),
    cal: calWork.optional(),
    critical,
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
  /** шапка инструкции по упаковке (Б3а): блистер, пачка, ящик, паллета и отходы на наладку — её содержание */
  doc: doc('PI'),
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
    code: matCode,
    name: text,
    supplier: id,
    price: z.number().positive(),
    lead: days,
    stock: z.strictObject({ min: z.number().int().min(0), max: z.number().int().min(1) }).refine(x => x.min < x.max, { message: 'неснижаемый уровень ниже начального' }),
    source: sources.optional(),
    review: review.optional(),
  })
  .refine(paired, pairedMsg);

/**
 * Модель расследования (docs/specs/2026-10-investigation.md, «Вывод — копия «Анамнеза»»): какое испытание её открывает;
 * версии с априорными весами, %; улики — доля фона и вероятность от версий, %, и как улику читают из состояния завода;
 * шаги — кто, минуты работы или испытание, что проверяют — чувствительность и специфичность, %. Уверенность, при которой
 * коллега решает, %, и польза шага, ниже которой он ему не нужен, биты. Доли — гипотезы геймдизайна; направление каждой
 * связи — факт с источником.
 */
const short = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'имя в модели — латиница и цифры');
export const investigation = z
  .strictObject({
    id: z.string(),
    name: text,
    test: id,
    threshold: percent,
    minGain: z.number().min(0),
    candidates: z.array(z.strictObject({ id: short, name: text, cause: id.optional(), prior: percent })).min(2),
    findings: z
      .array(
        z.strictObject({
          id: short,
          name: text,
          leak: percent,
          by: z.record(short, percent),
          read: z.union([
            z.strictObject({ mark: z.enum(['calc', 'instrument']) }),
            z.strictObject({ retest: z.literal(true) }),
            z.strictObject({ param: short }),
            z.strictObject({ ipc: id, below: z.number().optional(), above: z.number().optional() }),
            z.strictObject({ journal: z.literal('screen') }),
            z.strictObject({ coa: attr, above: z.number() }),
            z.strictObject({ peers: z.literal(true) }),
            z.strictObject({ screen: z.literal(true) }),
            z.strictObject({ measure: attr, above: z.number() }),
          ]),
        }),
      )
      .min(1),
    steps: z
      .array(
        z.strictObject({
          id: short,
          name: text,
          role: id.optional(),
          work: minutes.optional(),
          at: id.optional(),
          test: id.optional(),
          retest: z.literal(true).optional(),
          checks: z.array(z.strictObject({ f: short, sens: percent, spec: percent })).min(1),
        }),
      )
      .min(1),
    source: sources,
    review,
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
  instruments: { prefix: 'inst', schema: instrument },
  tests: { prefix: 'test', schema: test },
  specs: { prefix: 'spec', schema: spec },
  products: { prefix: 'prd', schema: product },
  equipment: { prefix: 'eq', schema: equipment },
  recipes: { prefix: 'rcp', schema: recipe },
  causes: { prefix: 'cause', schema: cause },
  investigations: { prefix: 'inv', schema: investigation },
  machines: { prefix: 'mach', schema: machine },
  skus: { prefix: 'sku', schema: sku },
  customers: { prefix: 'cus', schema: customer },
  spares: { prefix: 'spare', schema: spare },
  sops: { prefix: 'sop', schema: sop },
  regimes: { prefix: 'reg', schema: regime },
  makers: { prefix: 'mkr', schema: maker },
  agreements: { prefix: 'qag', schema: agreement },
} as const;

export type Kind = keyof typeof KINDS;
