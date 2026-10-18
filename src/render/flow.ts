// Лампы машин и поток на лентах (docs/specs/2026-10-view.md, 2в; docs/13-art.md, §5, §9, §12): чистые функции без Three.js
// и DOM — их проверяют тесты в Bun; рисует machines.ts.
import type { EqState, MachineRow } from '../sim/pack';

/** Что показывает лампа над машиной: работает, ждёт, стоит, авария, переналадка, уборка, без дела. */
export type Lamp = 'run' | 'wait' | 'stop' | 'fail' | 'setup' | 'clean' | 'off';

/**
 * Цвет лампы (`13-art.md`, §5: состояния машин — цвет и значок): зелёный — работает, синий — ждёт, жёлтый — стоит,
 * красный — авария, фиолетовый — переналадка, бирюзовый — уборка, серый — без дела. Значок — всегда рядом с цветом.
 * Оттенки подобраны так, чтобы каждая пара различалась и в имитации трёх видов цветовой слепоты (геймдизайн, §23;
 * проверка — tools/test/palette.test.ts).
 */
export const LAMP_COLOR: Record<Lamp, number> = {
  run: 0x6aaf58,
  wait: 0x284b99,
  stop: 0xebd233,
  fail: 0xeb2019,
  setup: 0xdc3feb,
  clean: 0x3cd9d4,
  off: 0x7c7c7d,
};

/**
 * Лампа машины линии: на ходу и медленнее — работает; ждёт соседей или людей — ждёт; микроостановка — стоит; авария;
 * переналадка и очистка линии — по задачам линии; без задания — без дела.
 */
export function lampOfMachine(m: MachineRow, line: { changeover: boolean; clearance: boolean }): Lamp {
  if (m.state === 'fail') return 'fail';
  if (line.changeover) return 'setup';
  if (line.clearance) return 'clean';
  if (m.state === 'run' || m.state === 'slow') return 'run';
  if (m.state === 'micro') return 'stop';
  if (m.state === 'wait') return 'wait';
  if (m.state === 'setup') return 'setup';
  return 'off';
}

/** Лампа оборудования участка: держит стадию серии — работает; уборка помещения; авария; иначе — без дела. */
export function lampOfEquipment(s: EqState): Lamp {
  return s === 'run' ? 'run' : s === 'clean' ? 'clean' : s === 'fail' ? 'fail' : 'off';
}

/** Шаг штук на ленте, м: блистер, пачка, гофроящик (гипотеза картинки). */
export const PITCH = { blister: 0.13, carton: 0.2, case: 0.45 } as const;

/** Самая большая скорость ленты на экране, м/с: на ×1 и быстрее лента не мелькает, а течёт. */
export const BELT_MAX = 0.45;

/**
 * Скорость ленты на экране, м/с: штук в минуту машины × игровых секунд в секунду × шаг — не быстрее `BELT_MAX`. В «живом
 * времени» блистерная на 120 блистерах в минуту — 0,26 м/с, как в жизни.
 */
export function beltSpeed(rate: number, gameRate: number, pitch: number): number {
  return Math.min(BELT_MAX, (rate / 60) * gameRate * pitch);
}

/** Где штуки на ленте длиной `length`: от входа к выходу, с шагом `pitch`, сдвинуты на `phase` (0 ≤ phase < pitch). */
export function beltOffsets(length: number, pitch: number, phase: number): number[] {
  const out: number[] = [];
  const n = Math.max(0, Math.floor(length / pitch));
  const p = ((phase % pitch) + pitch) % pitch;
  for (let k = 0; k < n; k++) {
    const d = k * pitch + p;
    if (d <= length) out.push(d);
  }
  return out;
}

/**
 * Сколько штук рисовать в накопителе на `slots` местах: та же доля, что в движке (`13-art.md`, §9: накопитель полон ровно
 * настолько, насколько в движке); непустой — хотя бы одна.
 */
export function bufferCount(fill: number, cap: number, slots: number): number {
  if (fill <= 0 || cap <= 0 || slots <= 0) return 0;
  return Math.min(slots, Math.max(1, Math.round((fill / cap) * slots)));
}
