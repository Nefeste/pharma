# Машины из Blender одним прогоном (#109; решение владельца #112 — деталь у машин, на которые смотрят вблизи): пресс,
# блистерная и картонажная — построения их частей в press.py, blister.py и cartoner.py, части и размеры — из записей
# сцены tools/blender/scene.ts. У всех машин общие материалы и одна карта затенения: в .glb один набор материалов, и
# окно сливает неподвижные части всех машин по материалу (src/render/machines.ts) — вызовов отрисовки столько же,
# сколько материалов, а не машин (отчёт пилота, находка 7). Затенение — только у неподвижных частей.
#
# На время запечки машины стоят врозь, каждая на своём полу (пол затеняет низ станины, в .glb его нет), кожухи скрыты:
# стекло не затеняет, а открытым кожух поднят. В .glb каждая машина — в нуле: узел с именем вида записи, части — внутри,
# с именами частей (lib.own_names).
#
#   blender --background --factory-startup --python-exit-code 1 --python blender/machines.py -- \
#     --scene tools/blender/out/scene.json --work tools/blender/out --out machines.glb [--blend путь]
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blister  # noqa: E402
import cartoner  # noqa: E402
import lib  # noqa: E402
import press  # noqa: E402

# точек карты затенения на сторону — на все машины; проб Cycles; длина лучей затенения, м: щели, швы и касание пола —
# без тени на всю нижнюю половину боковин (свет в игре мягкий и светлый, docs/13-art.md, §5; с 0,5 м станина пресса на
# низком пресете темнела)
AO_SIZE = 1536
AO_SAMPLES = 256
AO_DISTANCE = 0.2
# машины на время запечки — через столько метров по x: дальше лучей затенения
SPACING = 8.0

SCRIPTS = (press, blister, cartoner)


def main():
    a = lib.args()
    scene = lib.load_scene(a['scene'])
    lib.reset(AO_SAMPLES)
    bpy.context.scene.world.light_settings.distance = AO_DISTANCE
    M = lib.materials(scene)
    floor_mat = lib.material('floor', {'color': [0.74, 0.78, 0.78], 'rough': 0.6, 'metal': 0})
    roots, shaded, covers, floors = [], [], [], []
    for k, machine in enumerate(sorted(scene['machines'])):
        script = next((s for s in SCRIPTS if machine in s.MACHINES), None)
        if script is None:
            raise SystemExit(f'{machine}: нет скрипта в blender/')
        rec = scene['machines'][machine]
        root = lib.empty(machine)
        root.location = lib.bl(k * SPACING, 0, 0)
        objs = lib.build(scene, machine, M, script.PARTS, script.WEAR, root)
        # подвижные части с деталями внутри — без затенения и без развёртки
        moving = {p['id'] for p in rec['model'] if p.get('spin') or p.get('cover')}
        part = {o: n for n, o in objs.items()}
        shaded += [o for n, o in objs.items() if n not in moving and (o.parent is root or part[o.parent] not in moving)]
        covers += [objs[p['id']] for p in rec['model'] if p.get('cover')]
        bm = bmesh.new()
        w, d, _ = rec['size']
        lib.box(bm, w + 2, d + 2, 0.02, (0, -0.01, 0))
        floor = lib.mesh_object(f'{machine}/floor', bm, [floor_mat], root)
        floors.append(floor)
        roots.append(root)
    lib.unwrap(shaded)
    for ob in covers:
        ob.hide_render = True
    bake = lib.float_image('ao-bake', AO_SIZE, AO_SIZE, 1.0)
    for k in lib.SHADED:
        lib.image_node(M[k], bake)
    lib.bake(shaded, 'AO', 8)
    px = lib.pixels(bake)
    ao = [round(min(1.0, max(0.0, px[i])) * 255) for i in range(0, len(px), 4)]
    # карта затенения — рядом с рабочим файлом сборки: в .glb она войдёт целиком, в assets/ её отдельно нет
    png = os.path.join(a['work'], 'machines-ao.png')
    lib.write_png(png, AO_SIZE, AO_SIZE, 1, ao)
    # затенение — файл с диска: экспорт кладёт его байты в .glb как есть
    img = bpy.data.images.load(png)
    img.colorspace_settings.name = 'Non-Color'
    for k in lib.SHADED:
        nt = M[k].node_tree
        for n in [n for n in nt.nodes if n.type == 'TEX_IMAGE']:
            nt.nodes.remove(n)
        lib.image_node(M[k], img, occlusion=True)
    bpy.data.images.remove(bake)
    for ob in floors:
        bpy.data.objects.remove(ob)
    for ob in covers:
        ob.hide_render = False
    for root in roots:
        root.location = (0.0, 0.0, 0.0)
    bpy.ops.export_scene.gltf(
        filepath=a['out'],
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        use_selection=False,
    )
    lib.own_names(a['out'])
    if a.get('blend'):
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=a['blend'], compress=True)


if __name__ == '__main__':
    main()
