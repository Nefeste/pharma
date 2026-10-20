// Автопаузы (этап Б, Б2а; геймдизайн, §2): на каких событиях мир встаёт сам. Каждую можно отключить — выбор живёт в окне,
// как стартовый пресет (preset.ts). Встаёт мир, только если событие — дело места игрока (§29.2): директор и «место ещё не
// выбрано» — всё; планёрка — у всех. Поток расчёта встаёт ровно на событии (src/sim/host.ts); здесь — какие извещения
// игроку стоп и куда ведёт щелчок по ним. Чистые функции без DOM — их проверяют тесты в Bun.
import type { Plant, SeatId } from '../content/types';
import { DAY } from '../engine/core/calendar';
import type { Notice } from '../engine/types';
import type { Thing } from '../sim/views';
import type { Keep } from './preset';

/** Автопаузы прототипа — по порядку меню. Сотрудника, жалобы, совещания S&OP и инспекции в прототипе нет. */
export const PAUSES = ['failure', 'oos', 'deviation', 'truckWait', 'orderRisk', 'materialLate', 'morning'] as const;
export type Pause = (typeof PAUSES)[number];

/**
 * Извещения движка каждой автопаузы. Результат вне спецификации — расследование растворения и партия, отклонённая
 * лабораторией. Отклонения в прототипе не делятся на критические и прочие (геймдизайн, §6.4): встаёт на каждом.
 */
export const PAUSE_NOTICES: Record<Pause, readonly Notice['kind'][]> = {
  failure: ['failure'],
  oos: ['investigation', 'lotRejected'],
  deviation: ['deviation'],
  truckWait: ['truckWait'],
  orderRisk: ['orderRisk'],
  materialLate: ['materialLate'],
  morning: ['morning'],
};

/**
 * Чьё это дело (геймдизайн, §29.2): производство отвечает на поломку, OOS и опоздавшее сырьё; качество — на OOS и
 * отклонения; снабжение меряют тревогами «материал не пришёл к серии»; коммерцию — заказами в срок. Планёрка — у всех.
 */
export const PAUSE_SEATS: Record<Pause, readonly SeatId[] | 'all'> = {
  failure: ['production'],
  oos: ['quality', 'production'],
  deviation: ['quality'],
  truckWait: ['supply'],
  orderRisk: ['commerce'],
  materialLate: ['supply', 'production'],
  morning: 'all',
};

/** Ключ в хранилище окна: отключённые автопаузы — новая автопауза в следующей версии придёт включённой. */
export const PAUSE_KEY = 'pharma.pauses';

/** «До события» без события встаёт само через столько игровых секунд (гипотеза). */
export const EVENT_CAP = 30 * DAY;

/** Автопауза извещения; не автопауза — `undefined`. */
export function pauseOf(kind: Notice['kind']): Pause | undefined {
  return PAUSES.find(p => PAUSE_NOTICES[p].includes(kind));
}

/** Дело ли это места игрока: у всех, директор или место ещё не выбрано — да. */
export function mine(p: Pause, seats: readonly SeatId[] | undefined): boolean {
  const who = PAUSE_SEATS[p];
  return who === 'all' || !seats || seats.includes('director') || who.some(x => seats.includes(x));
}

/** Виды извещений, на которых мир встаёт: автопауза включена и это дело места игрока. */
export function stopKinds(off: readonly Pause[], seats: readonly SeatId[] | undefined): Notice['kind'][] {
  return PAUSES.filter(p => !off.includes(p) && mine(p, seats)).flatMap(p => PAUSE_NOTICES[p]);
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
export type Go = { thing: Thing } | { panel: 'gantt' | 'morning' | 'lab' } | { inv: string };

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
 * расписанию, заказ — к планёрке с заказами под угрозой, отклонённая партия — к лаборатории, расследование — к доске.
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
    default:
      return undefined;
  }
}
