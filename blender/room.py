# Свет и затенение пола помещения производства в Blender (#109): помещение — из сцены tools/blender/scene.ts (пол между
# осями стен, стены и закрытые двери — треугольники стен окна, потолок на высоте стен, светильники — квадратные панели
# под потолком, оборудование — по плану: пресс — тем же построением, что .glb (blender/press.py), остальное — частями
# записи, как в коде). Cycles запекает в картинку пола рассеянный свет светильников — прямой и отражённый, без цвета пола
# (в игре это карта света, `lightMap`), и затенение (AO, `aoMap`).
#
# Свет приводится к средней яркости пятен холста на том же полу (`pool` сцены): помещение светит в среднем так же, как
# соседние, а различие — в рисунке: тени машин, мягкий край у стен, отражённый свет. Солнце и небо в игре свои, живые —
# здесь их нет. Картинки — sRGB для света, линейная — для затенения; пишет их `lib.write_png`.
#
#   blender --background --factory-startup --python-exit-code 1 --python blender/room.py -- \
#     --scene tools/blender/out/scene.json --room compression --out tools/blender/out [--blend путь]
import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import press  # noqa: E402

# проб Cycles: свет и затенение; длина лучей затенения, м — у стен и под машинами, не на полкомнаты; мощность панели,
# Вт — масштаб не важен, свет приводится к `pool`
LIGHT_SAMPLES = 1024
AO_SAMPLES = 256
AO_DISTANCE = 0.6
LAMP_W = 60
MARGIN = 4


def soup(name, tris, mat):
    """Треугольники окна (x, y, z подряд) → сетка Blender."""
    verts = [tuple(lib.bl(tris[i], tris[i + 1], tris[i + 2])) for i in range(0, len(tris), 3)]
    faces = [(i, i + 1, i + 2) for i in range(0, len(verts), 3)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def plane(name, rect, y, mat, uv=None):
    """Прямоугольник окна x, z, ширина, глубина на высоте y; `uv` — второй набор координат запечки (blender.ts, bakeUv)."""
    x0, z0, w, d = rect
    corners = [(x0, z0), (x0, z0 + d), (x0 + w, z0 + d), (x0 + w, z0)]
    bm = bmesh.new()
    vs = [bm.verts.new(lib.bl(x, y, z)) for x, z in corners]
    f = bm.faces.new(vs)
    # нормаль — к свету: пол — вверх, потолок — вниз
    f.normal_update()
    if (f.normal.z < 0) == (uv is not None):
        f.normal_flip()
    if uv is not None:
        layer = bm.loops.layers.uv.new('bake')
        for loop in f.loops:
            co = loop.vert.co
            x, z = co.x, -co.y
            loop[layer].uv = ((x - x0) / w, 1 - (z - z0) / d)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def generic(scene, kind, M, parent):
    """Оборудование частями записи, как machines.ts: ящик, цилиндр, бункер, стекло — без деталей."""
    rec = scene['machines'][kind]
    bm = bmesh.new()
    mats = []
    for p in rec['model']:
        key = 'glass' if p['shape'] == 'glass' else p.get('color', 'steel')
        if key not in M:
            M[key] = lib.material(key, scene['finish'][key])
        if M[key] not in mats:
            mats.append(M[key])
        k = mats.index(M[key])
        at = (p['x'], p['y'], p['z'])
        if p['shape'] == 'cyl':
            axis = p.get('axis', 'y')
            length = p['h'] if axis == 'y' else p['w'] if axis == 'x' else p['d']
            dia = p['w'] if axis in ('y', 'z') else p['h']
            lib.cylinder(bm, dia / 2, dia / 2, length, at, axis=axis, segments=24, mat=k)
        elif p['shape'] == 'cone':
            lib.cylinder(bm, p['bottom'] / 2, p['w'] / 2, p['h'], at, segments=24, mat=k)
        else:
            lib.box(bm, p['w'], p['d'], p['h'], at, mat=k)
    return lib.mesh_object(kind, bm, mats, parent)


def main():
    a = lib.args()
    scene = lib.load_scene(a['scene'])
    room = scene['rooms'][a['room']]
    sc = lib.reset(LIGHT_SAMPLES)
    sc.world.color = (0.0, 0.0, 0.0)
    sc.world.light_settings.distance = AO_DISTANCE
    M = press.materials(scene)
    wall = lib.material('wall', {'color': room['panel'], 'rough': 0.85, 'metal': 0})
    soup('walls', room['walls'], wall)
    x0, z0, w, d = room['rect']
    plane('ceiling', (x0 - 0.5, z0 - 0.5, w + 1, d + 1), room['height'], wall)
    floor_mat = lib.material('floor', {'color': room['floor'], 'rough': 0.35, 'metal': 0})
    floor = plane('floor', room['rect'], 0.0, floor_mat, uv=True)
    for k, lp in enumerate(room['lamps']):
        light = bpy.data.lights.new(f'lamp-{k}', 'AREA')
        light.shape = 'SQUARE'
        light.size = room['glow']
        light.energy = LAMP_W
        light.color = room['tint']
        ob = bpy.data.objects.new(f'lamp-{k}', light)
        ob.location = lib.bl(lp['x'], lp['y'], lp['z'])
        sc.collection.objects.link(ob)
    for k, e in enumerate(room['equipment']):
        place = bpy.data.objects.new(f'place-{k}', None)
        place.location = lib.bl(e['x'], 0.0, e['z'])
        place.rotation_euler = (0.0, 0.0, e['turn'] * math.pi / 2)
        sc.collection.objects.link(place)
        if e['type'] in press.MACHINES:
            press.build(scene, e['type'], M, place)
        else:
            generic(scene, e['type'], M, place)
    W, H = round(w * room['px']), round(d * room['px'])
    out = a['out']
    # свет: рассеянный, прямой и отражённый, без цвета пола
    light = lib.float_image('light-bake', W, H, 0.0)
    node = lib.image_node(floor_mat, light)
    lib.bake([floor], 'DIFFUSE', MARGIN, {'DIRECT', 'INDIRECT'})
    px = lib.pixels(light)
    n = W * H
    mean = sum(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] for i in range(0, 4 * n, 4)) / n
    k = room['pool'] / mean
    rgb = [round(lib.to_srgb(px[i + c] * k) * 255) for i in range(0, 4 * n, 4) for c in range(3)]
    lib.write_png(os.path.join(out, f'{a["room"]}-light.png'), W, H, 3, rgb)
    # затенение
    sc.cycles.samples = AO_SAMPLES
    ao = lib.float_image('ao-bake', W, H, 1.0)
    node.image = ao
    lib.bake([floor], 'AO', MARGIN)
    px = lib.pixels(ao)
    lib.write_png(os.path.join(out, f'{a["room"]}-ao.png'), W, H, 1, [round(min(1.0, max(0.0, px[i])) * 255) for i in range(0, 4 * n, 4)])
    print(f'запечка {a["room"]}: {W}×{H}, средний свет {mean:.5f} → {room["pool"]} (×{k:.4f})')
    if a.get('blend'):
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=a['blend'], compress=True)


if __name__ == '__main__':
    main()
