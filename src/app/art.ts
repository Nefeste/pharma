// Модели и запечённый свет из Blender (#109; src/render/blender.ts): что лежит в assets/models/index.json — машины (.glb,
// узлы = части записи) и запечка помещений (карта света и затенения пола, PNG). Грузится один раз; «код» — без них:
// машины и пол — как прежде, кодом (переключатель — в панели отладки, ключ адреса `?art=code`, у Electron — `--art code`).
import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ArtIndex } from '../render/blender';
import type { Art } from '../render/stage';

export type ArtMode = 'blender' | 'code';

let loading: Promise<Art> | undefined;

/** Модели и картинки из `index`; не загрузилось — предупреждение, и эта вещь остаётся кодом. */
export function loadArt(loader: GLTFLoader, base: string, index: ArtIndex): Promise<Art> {
  loading ??= (async () => {
    const art: Art = { machines: new Map(), rooms: new Map() };
    const tex = new THREE.TextureLoader();
    await Promise.all([
      ...Object.entries(index.machines ?? {}).map(async ([type, file]) => {
        try {
          const g = await loader.loadAsync(`${base}/${file}`);
          g.scene.updateMatrixWorld(true);
          shareMaps(g.scene);
          art.machines.set(type, g.scene);
        } catch (e) {
          console.warn(`art: ${file} not loaded, ${type} stays code`, e);
        }
      }),
      ...Object.entries(index.rooms ?? {}).map(async ([room, files]) => {
        try {
          const [light, ao] = await Promise.all([tex.loadAsync(`${base}/${files.light}`), tex.loadAsync(`${base}/${files.ao}`)]);
          // свет — sRGB, как карта света холста (lamps.ts); затенение — как есть; оба — по второму набору координат пола
          light.colorSpace = THREE.SRGBColorSpace;
          light.channel = 1;
          ao.channel = 1;
          art.rooms.set(room, { light, ao });
        } catch (e) {
          console.warn(`art: bake of ${room} not loaded, its floor stays code`, e);
        }
      }),
    ]);
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
