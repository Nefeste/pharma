// Модели из Blender (#109; src/render/blender.ts): что лежит в assets/models/index.json — машины (.glb: машина — узел с
// именем вида записи, внутри — узлы с именами частей). Все машины — в одном файле с общими материалами и одной картой
// затенения: файл грузится один раз, машина — его узел. Имена узлов загрузчик делает разными (`body`, `body_1`) и чистит
// от точек; имя из файла — в `userData.name`, по нему и ищем. «Код» — без них: машины — как прежде, кодом
// (переключатель — в панели отладки, ключ адреса `?art=code`, у Electron — `--art code`). Свет помещений не
// запекается (решение владельца, #112).
import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type ArtIndex, nodeName } from '../render/blender';
import type { Art } from '../render/stage';

export type ArtMode = 'blender' | 'code';

let loading: Promise<Art> | undefined;

/** Модели из `index`; файл не загрузился или в нём нет узла машины — предупреждение, и эта машина остаётся кодом. */
export function loadArt(loader: GLTFLoader, base: string, index: ArtIndex): Promise<Art> {
  loading ??= (async () => {
    const art: Art = { machines: new Map() };
    const byFile = new Map<string, string[]>();
    for (const [type, file] of Object.entries(index.machines ?? {})) byFile.set(file, [...(byFile.get(file) ?? []), type]);
    await Promise.all(
      [...byFile].map(async ([file, types]) => {
        try {
          const g = await loader.loadAsync(`${base}/${file}`);
          g.scene.updateMatrixWorld(true);
          shareMaps(g.scene);
          for (const type of types) {
            const root = g.scene.children.find(c => nodeName(c) === type);
            if (root) art.machines.set(type, root);
            else console.warn(`art: no ${type} in ${file}, it stays code`);
          }
        } catch (e) {
          console.warn(`art: ${file} not loaded, ${types.join(', ')} stay code`, e);
        }
      }),
    );
    return art;
  })();
  return loading;
}

/** У экспорта glTF своя текстура на каждый материал, картинка — одна: одна текстура на картинку — одна загрузка в видеокарту. */
function shareMaps(root: THREE.Object3D) {
  const bySource = new Map<THREE.Texture['source'], THREE.Texture>();
  root.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m?.aoMap) return;
    const first = bySource.get(m.aoMap.source);
    if (first) m.aoMap = first;
    else bySource.set(m.aoMap.source, m.aoMap);
  });
}
