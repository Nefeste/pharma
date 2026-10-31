// Модели из Blender в фоновом режиме (#109; устав, docs/11-new-games.md: скрипт в blender/, результат — .glb в assets/
// с паспортом). Чистые правила без Three.js и DOM — их делят окно (src/app/art.ts, game.ts), сцена для Blender
// (tools/blender/scene.ts) и тесты: что лежит в assets/models/index.json. Свет помещений не запекается (решение
// владельца, #112): у пола — карта света холста (lamps.ts), как у всех помещений.

/** Что из Blender грузит окно (assets/models/index.json): машина — по виду записи. */
export interface ArtIndex {
  machines?: Record<string, string>;
}

/**
 * Имя узла .glb, как в файле: загрузчик glTF делает имена неповторимыми (`body`, `body_1` — части у машин называются
 * одинаково) и чистит их от точек (`eq.press`), а исходное кладёт в `userData.name`.
 */
export const nodeName = (o: { name: string; userData: Record<string, unknown> }): string => (typeof o.userData.name === 'string' ? o.userData.name : o.name);
