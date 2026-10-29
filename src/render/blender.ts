// Модели и запечённый свет из Blender в фоновом режиме (#109; устав, docs/11-new-games.md: скрипт в blender/, результат —
// .glb в assets/ с паспортом). Чистые правила без Three.js и DOM — их делят окно (machines.ts, world.ts), сцена для Blender
// (tools/blender/scene.ts) и тесты: что лежит в assets/models/index.json, где на полу запечка помещения и как пол берёт
// её второй набор координат.
import type { RoomBox } from './layout';

/** Что из Blender грузит окно (assets/models/index.json): машина — по виду записи, помещение — по своему id в плане. */
export interface ArtIndex {
  machines?: Record<string, string>;
  rooms?: Record<string, { light: string; ao: string }>;
}

/** Точек запечки на метр пола. */
export const BAKE_PX = 32;

/**
 * Пол помещения в запечке: между осями его стен — прямоугольник плана без половин стеновых клеток, м: x, z, ширина,
 * глубина. Половина стеновой клетки под стеной — пол того помещения, к которому она обращена (world.ts, `buildFloors`).
 */
export function bakeRect(r: RoomBox): [number, number, number, number] {
  return [r.x + 0.5, r.z + 0.5, r.w - 1, r.d - 1];
}

/** Квадрат пола с серединой (x, z) — в запечке ли помещения: строго внутри её прямоугольника. */
export function inBake(rect: readonly number[], x: number, z: number): boolean {
  return x > rect[0] && x < rect[0] + rect[2] && z > rect[1] && z < rect[1] + rect[3];
}

/** Второй набор координат пола в запечке: x — слева направо, z — сверху вниз картинки (v = 1 у края z = rect.z). */
export function bakeUv(rect: readonly number[], x: number, z: number): [number, number] {
  return [(x - rect[0]) / rect[2], 1 - (z - rect[1]) / rect[3]];
}
