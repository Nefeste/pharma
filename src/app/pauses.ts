// Автопаузы (этап Б, Б2а; геймдизайн, §2): на каких событиях мир встаёт сам. Каждую можно отключить — выбор живёт в окне,
// как стартовый пресет (preset.ts). Встаёт мир, только если событие — дело места игрока (§29.2): директор и «место ещё не
// выбрано» — всё; планёрка — у всех. Поток расчёта встаёт ровно на событии (src/sim/host.ts); здесь — какие извещения
// игроку стоп и куда ведёт щелчок по ним. Чистые функции без DOM — их проверяют тесты в Bun.
import type { Plant, SeatId } from '../content/types';
import { DAY } from '../engine/core/calendar';
import type { Notice } from '../engine/types';
import type { Thing } from '../sim/views';
import type { Keep } from './preset';

/**
 * Автопаузы прототипа — по порядку меню. Из событий сотрудника есть только потеря допуска (Б3б); срок квалификации или
 * калибровки актива (Б3в); приостановленная пара поставщика (Б3г); жалобы, совещания S&OP и инспекции в прототипе нет.
 */
export const PAUSES = ['failure', 'oos', 'deviation', 'truckWait', 'orderRisk', 'materialLate', 'qualLost', 'assetExpired', 'pairSuspended', 'morning'] as const;
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
  assetExpired: ['assetExpired/equipment', 'assetExpired/machine', 'assetExpired/ipc', 'assetExpired/lab', 'assetExpired/sensor'],
  pairSuspended: ['pairSuspended'],
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
  assetExpired: ['production', 'quality', 'supply'],
  // пара поставщика (Б3г): оценку ведёт качество, заказывает снабжение
  pairSuspended: ['quality', 'supply'],
  morning: 'all',
};

/**
 * Чьё дело ключ, если не всей автопаузы (Б3в): срок оборудования таблеток, машины линии и прибора МОК — производства,
 * прибора лаборатории — качества и технологии, датчика склада — снабжения и склада.
 */
export const KEY_SEATS: Partial<Record<string, readonly SeatId[]>> = {
  'assetExpired/equipment': ['production'],
  'assetExpired/machine': ['production'],
  'assetExpired/ipc': ['production'],
  'assetExpired/lab': ['quality'],
  'assetExpired/sensor': ['supply'],
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

/** Куда ведёт щелчок по извещению: вещь на полу, окно или доска расследования. */
export type Go = { thing: Thing } | { panel: 'gantt' | 'morning' | 'lab' | 'ref' } | { inv: string };

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
 * потеря допуска — к человеку.
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
    case 'investigation':
    case 'invStep':
    case 'concluded':
      return { inv: n.id };
    case 'qualLost':
      return { thing: { kind: 'person', n: Number(n.person.slice(1)) } };
    case 'assetExpired': {
      // машина и оборудование — к ним; прибор и датчик — к справочнику, вкладке «Места»
      const thing = machineThing(plant, n.asset);
      return thing ? { thing } : { panel: 'ref' };
    }
    case 'pairSuspended':
      // к справочнику, вкладке «Контрагенты»
      return { panel: 'ref' };
    default:
      return undefined;
  }
}
