// Автопаузы (этап Б, Б2а; геймдизайн, §2): на каких событиях мир встаёт сам. Каждую можно отключить — выбор живёт в окне,
// как стартовый пресет (preset.ts). Встаёт мир, только если событие — дело места игрока (§29.2): директор и «место ещё не
// выбрано» — всё; планёрка — у всех. Поток расчёта встаёт ровно на событии (src/sim/host.ts); здесь — какие извещения
// игроку стоп и куда ведёт щелчок по ним. Чистые функции без DOM — их проверяют тесты в Bun.
import type { Plant, SeatId } from '../content/types';
import { DAY } from '../engine/core/calendar';
import { DEPT_SEAT } from '../engine/seats';
import type { Notice } from '../engine/types';
import type { Thing } from '../sim/views';
import type { Keep } from './preset';

/**
 * Автопаузы прототипа — по порядку меню. Из событий сотрудника есть потеря допуска (Б3б), сверхурочные года на исходе
 * (Б4а) и заявление об увольнении (Б4в); срок квалификации или калибровки актива (Б3в); приостановленная пара поставщика
 * (Б3г); черновик графика отпусков (Б4г); жалобы, совещания S&OP и инспекции в прототипе нет.
 */
export const PAUSES = ['failure', 'oos', 'deviation', 'truckWait', 'orderRisk', 'materialLate', 'qualLost', 'overtimeLow', 'resign', 'assetExpired', 'pairSuspended', 'leaveDraft', 'morning'] as const;
export type Pause = (typeof PAUSES)[number];

/**
 * Ключи извещений движка каждой автопаузы (`stopKey`). Результат вне спецификации — расследование растворения и партия,
 * отклонённая лабораторией. Отклонения в прототипе не делятся на критические и прочие (геймдизайн, §6.4): встаёт на каждом.
 * Срок актива (Б3в) — по роду актива: чьё это дело, решает род.
 */
export const PAUSE_NOTICES: Record<Pause, readonly string[]> = {
  failure: ['failure'],
  oos: ['investigation', 'lotRejected'],
  deviation: ['deviation'],
  truckWait: ['truckWait'],
  orderRisk: ['orderRisk'],
  materialLate: ['materialLate'],
  qualLost: ['qualLost'],
  overtimeLow: ['overtimeLow/mes', 'overtimeLow/line', 'overtimeLow/maint', 'overtimeLow/qc', 'overtimeLow/qa', 'overtimeLow/wms'],
  resign: ['resign/mes', 'resign/line', 'resign/maint', 'resign/qc', 'resign/qa', 'resign/wms'],
  assetExpired: ['assetExpired/equipment', 'assetExpired/machine', 'assetExpired/ipc', 'assetExpired/lab', 'assetExpired/sensor'],
  pairSuspended: ['pairSuspended'],
  leaveDraft: ['leaveDraft'],
  morning: ['morning'],
};

/**
 * Чьё это дело (геймдизайн, §29.2): производство отвечает на поломку, OOS и опоздавшее сырьё; качество — на OOS,
 * отклонения и потерю допуска: обучение ведёт ООК (Б3б); снабжение меряют тревогами «материал не пришёл к серии»;
 * коммерцию — заказами в срок. Срок актива (Б3в) — у трёх постов, у каждого свой род (`KEY_SEATS`). Планёрка — у всех.
 */
export const PAUSE_SEATS: Record<Pause, readonly SeatId[] | 'all'> = {
  failure: ['production'],
  oos: ['quality', 'production'],
  deviation: ['quality'],
  truckWait: ['supply'],
  orderRisk: ['commerce'],
  materialLate: ['supply', 'production'],
  qualLost: ['quality'],
  // сверхурочные года (Б4а) — у поста отдела человека (`KEY_SEATS`)
  overtimeLow: ['production', 'quality', 'supply'],
  // заявление об увольнении (Б4в) — тоже у поста отдела человека: найм и увольнение — его команды
  resign: ['production', 'quality', 'supply'],
  assetExpired: ['production', 'quality', 'supply'],
  // пара поставщика (Б3г): оценку ведёт качество, заказывает снабжение
  pairSuspended: ['quality', 'supply'],
  // черновик графика отпусков (Б4г): строки своих постов правит каждый пост
  leaveDraft: 'all',
  morning: 'all',
};

/**
 * Чьё дело ключ, если не всей автопаузы (Б3в): срок оборудования таблеток, машины линии и прибора МОК — производства,
 * прибора лаборатории — качества и технологии, датчика склада — снабжения и склада. Сверхурочные года (Б4а) и заявление
 * об увольнении (Б4в) — пост отдела человека, как у политики отдела и команд найма (src/engine/seats.ts).
 */
export const KEY_SEATS: Partial<Record<string, readonly SeatId[]>> = {
  'assetExpired/equipment': ['production'],
  'assetExpired/machine': ['production'],
  'assetExpired/ipc': ['production'],
  'assetExpired/lab': ['quality'],
  'assetExpired/sensor': ['supply'],
  ...Object.fromEntries(Object.entries(DEPT_SEAT).flatMap(([d, seat]) => [[`overtimeLow/${d}`, [seat]], [`resign/${d}`, [seat]]])),
};

/** Ключ в хранилище окна: отключённые автопаузы — новая автопауза в следующей версии придёт включённой. */
export const PAUSE_KEY = 'pharma.pauses';

/** «До события» без события встаёт само через столько игровых секунд (гипотеза). */
export const EVENT_CAP = 30 * DAY;

/** Автопауза ключа извещения (`stopKey`); не автопауза — `undefined`. */
export function pauseOf(key: string): Pause | undefined {
  return PAUSES.find(p => PAUSE_NOTICES[p].includes(key));
}

/** Дело ли это места игрока: у всех, директор или место ещё не выбрано — да. */
export function mine(p: Pause, seats: readonly SeatId[] | undefined): boolean {
  const who = PAUSE_SEATS[p];
  return who === 'all' || !seats || seats.includes('director') || who.some(x => seats.includes(x));
}

/** Ключи извещений, на которых мир встаёт: автопауза включена и это дело места игрока; у ключа со своим делом — его. */
export function stopKinds(off: readonly Pause[], seats: readonly SeatId[] | undefined): string[] {
  const own = (k: string) => {
    const who = KEY_SEATS[k];
    return !who || !seats || seats.includes('director') || who.some(x => seats.includes(x));
  };
  return PAUSES.filter(p => !off.includes(p) && mine(p, seats)).flatMap(p => PAUSE_NOTICES[p].filter(own));
}

/** Отключённые автопаузы из хранилища окна; нет, не прочитать или чужое — ничего не отключено. */
export function keptOff(keep: Keep | undefined): Pause[] {
  try {
    const v: unknown = JSON.parse(keep?.getItem(PAUSE_KEY) ?? '[]');
    return Array.isArray(v) ? PAUSES.filter(p => v.includes(p)) : [];
  } catch {
    return [];
  }
}

/** Запомнить отключённые; не вышло — выбор живёт до перезапуска игры. */
export function keepOff(keep: Keep | undefined, off: readonly Pause[]) {
  try {
    keep?.setItem(PAUSE_KEY, JSON.stringify(PAUSES.filter(p => off.includes(p))));
  } catch {
    // хранилище окна недоступно
  }
}

/** Куда ведёт щелчок по извещению: вещь на полу, окно, справочник на своей вкладке или доска расследования. */
export type Go = { thing: Thing } | { panel: 'gantt' | 'morning' | 'lab' } | { panel: 'ref'; tab: 'places' | 'partners' | 'people' } | { inv: string };

/** Машина линии или оборудование участка по имени в плане — вещь для карточки. */
export function machineThing(plant: Plant, id: string): Thing | undefined {
  for (const [line, l] of plant.lines.entries()) {
    const k = l.machines.findIndex(m => m.id === id);
    if (k >= 0) return { kind: 'machine', line, k };
  }
  const i = plant.equipment.findIndex(e => e.id === id);
  return i >= 0 ? { kind: 'equipment', i } : undefined;
}

/**
 * Куда ведёт извещение (13-art.md, §11: «щелчок ведёт на место»): отказ — к машине, фура — к фуре, материал — к
 * расписанию, заказ — к планёрке с заказами под угрозой, отклонённая партия — к лаборатории, расследование — к доске,
 * потеря допуска и сверхурочные года на исходе — к человеку; отклонение и его оценка — к карточке отклонения (Б1г);
 * найм (Б4в): заявление, увольнение, уход и выход на работу — к человеку, вакансия и кандидаты — к вкладке «Люди»;
 * отпуска (Б4г): черновик и утверждение графика — к вкладке «Люди», извещение, уход в отпуск и выход — к человеку.
 */
export function goOf(plant: Plant, n: Notice): Go | undefined {
  switch (n.kind) {
    case 'failure': {
      const thing = machineThing(plant, n.machine);
      return thing ? { thing } : undefined;
    }
    case 'truckWait':
      return { thing: { kind: 'truck', n: Number(n.truck.slice(1)), customer: false } };
    case 'materialLate':
      return { panel: 'gantt' };
    case 'orderRisk':
      return { panel: 'morning' };
    case 'lotRejected':
      return { panel: 'lab' };
    case 'deviation':
    case 'assessed':
      return { thing: { kind: 'dev', n: Number(n.id.slice(1)) } };
    case 'investigation':
    case 'invStep':
    case 'concluded':
      return { inv: n.id };
    case 'qualLost':
    case 'overtimeLow':
    case 'resign':
    case 'dismissed':
    case 'left':
    case 'hired':
    case 'leaveNotice':
    case 'leaveStart':
    case 'leaveEnd':
      return { thing: { kind: 'person', n: Number(n.person.slice(1)) } };
    case 'vacancy':
    case 'candidates':
    case 'accepted':
    case 'leaveDraft':
    case 'leaveApproved':
      return { panel: 'ref', tab: 'people' };
    case 'assetExpired': {
      // машина и оборудование — к ним; прибор и датчик — к справочнику, вкладке «Места»
      const thing = machineThing(plant, n.asset);
      return thing ? { thing } : { panel: 'ref', tab: 'places' };
    }
    case 'pairSuspended':
      return { panel: 'ref', tab: 'partners' };
    default:
      return undefined;
  }
}
