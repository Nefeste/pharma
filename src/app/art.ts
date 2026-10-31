// Модели из Blender (#109; src/render/blender.ts): что лежит в assets/models/index.json — машины (.glb, узлы = части
// записи). Грузится один раз; «код» — без них: машины — как прежде, кодом (переключатель — в панели отладки, ключ
// адреса `?art=code`, у Electron — `--art code`). Свет помещений не запекается (решение владельца, #112).
import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ArtIndex } from '../render/blender';
import type { Art } from '../render/stage';

export type ArtMode = 'blender' | 'code';

let loading: Promise<Art> | undefined;

/** Модели из `index`; не загрузилась — предупреждение, и эта машина остаётся кодом. */
export function loadArt(loader: GLTFLoader, base: string, index: ArtIndex): Promise<Art> {
  loading ??= (async () => {
    const art: Art = { machines: new Map() };
    await Promise.all(
      Object.entries(index.machines ?? {}).map(async ([type, file]) => {
        try {
          const g = await loader.loadAsync(`${base}/${file}`);
          g.scene.updateMatrixWorld(true);
          shareMaps(g.scene);
          art.machines.set(type, g.scene);
        } catch (e) {
          console.warn(`art: ${file} not loaded, ${type} stays code`, e);
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
