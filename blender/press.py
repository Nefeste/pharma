# Роторный таблеточный пресс в Blender (#109): части и размеры — из записи content/equipment/press.yaml (через сцену
# tools/blender/scene.ts), имена объектов — имена частей записи, поэтому окно находит ротор и кожух в .glb по имени, как
# сейчас — в части кода (src/render/machines.ts). Поверх силуэта записи — то, что код не рисует: фаски, утопленный
# цоколь, створки с ручками, решётка, кольца направляющих и стол матриц ротора, верхние и нижние пуансоны (у пресса они
# есть: natoli-wl, docs/10-domain.md, §6), рама и стёкла кожуха, шов и табличка головки, крышка бункера, экран и кнопки
# пульта. Затенение (AO) — запечено Cycles в одну картинку на неподвижные части и лежит в .glb как occlusionTexture;
# у ротора, пуансонов и кожуха его нет: они двигаются, и тень, запечённая в одном положении, ехала бы вместе с ними, а
# ротор под головкой вышел бы почти чёрным — не видно, крутится ли он (docs/13-art.md, §2, §8).
#
# Пуансоны — отдельный объект `punches` внутри ротора: имя — узел износа записи (`parts`), крутится вместе с ротором.
# Число станций, размеры деталей — гипотеза картинки, не факт: сверить (docs/13-art.md, §8).
#
#   blender --background --factory-startup --python-exit-code 1 --python blender/press.py -- \
#     --scene tools/blender/out/scene.json --machine eq.press --work tools/blender/out --out press.glb [--blend путь]
import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

# станций ротора — гипотеза картинки
STATIONS = 18
# точек картинки затенения на сторону, проб Cycles, длина лучей затенения, м: щели, швы и касание пола — без тени на
# всю нижнюю половину боковин (свет в игре мягкий и светлый, docs/13-art.md, §5; на низком пресете с 0,5 м станина темнела)
AO_SIZE = 512
AO_SAMPLES = 256
AO_DISTANCE = 0.2


# отделка неподвижных частей — с затенением; подвижных — та же, без него (`-moving`)
SHADED = ('white', 'steel', 'dark', 'grey', 'foil')


def materials(scene):
    """Отделка записей (machines.ts): неподвижных частей — с затенением; ротора, пуансонов и рамы кожуха — без него."""
    f = scene['finish']
    m = {k: lib.material(k, f[k]) for k in SHADED}
    for k in ('steel', 'foil'):
        m[f'{k}-moving'] = lib.material(f'{k}-moving', f[k])
    m['glass'] = lib.material('glass', f['glass'])
    return m


def body(p, M):
    """Станина: корпус над утопленным тёмным цоколем, две створки спереди с ручками, решётка сбоку."""
    w, d, h = p['w'], p['d'], p['h']
    bm = bmesh.new()
    plinth = 0.06
    lib.box(bm, w, d, h - plinth, (0, plinth / 2, 0), mat=0, bevel=0.012, segments=3, drop=('bottom',))
    lib.box(bm, w - 0.06, d - 0.06, plinth, (0, -h / 2 + plinth / 2, 0), mat=1, drop=('bottom',))
    door_w = (w - 2 * 0.04 - 0.01) / 2
    door_h = h - plinth - 0.1
    for s in (-1, 1):
        lib.box(bm, door_w, 0.006, door_h, (s * (0.005 + door_w / 2), plinth / 2, d / 2 + 0.003), mat=0, bevel=0.002, segments=1)
        lib.box(bm, 0.016, 0.016, 0.12, (s * 0.045, plinth / 2, d / 2 + 0.014), mat=2)
    for k in range(5):
        lib.box(bm, 0.006, 0.3, 0.02, (-w / 2 - 0.003, 0.05 + k * 0.045, 0), mat=1)
    return bm, [M['white'], M['dark'], M['steel']]


def rotor(p, M):
    """Ротор: ступица, верхняя и нижняя направляющие пуансонов, стол матриц посередине."""
    r = p['w'] / 2
    h = p['h']
    bm = bmesh.new()
    lib.cylinder(bm, 0.14, 0.14, h, (0, 0, 0), sides=24, mat=0)
    for s in (1, -1):
        lib.cylinder(bm, r - 0.05, r - 0.05, 0.055, (0, s * 0.0975, 0), mat=0, bevel=0.004)
    lib.cylinder(bm, r, r, 0.05, (0, 0, 0), mat=1, bevel=0.003)
    return bm, [M['steel-moving'], M['foil-moving']]


def punches(p, M):
    """Пуансоны: верхние и нижние стержни с головками по кругу станций — над и под столом матриц."""
    r = p['w'] / 2 - 0.085
    h = p['h']
    bm = bmesh.new()
    for k in range(STATIONS):
        a = 2 * math.pi * k / STATIONS
        x, z = r * math.cos(a), r * math.sin(a)
        for s in (1, -1):
            lib.cylinder(bm, 0.01, 0.01, h / 2 - 0.035, (x, s * (0.025 + (h / 2 - 0.035) / 2), z), sides=8, mat=0)
            lib.cylinder(bm, 0.014, 0.014, 0.022, (x, s * (h / 2 - 0.011), z), sides=8, mat=0)
    return bm, [M['foil-moving']]


def cover(p, M):
    """Кожух: стальная рама — стойки по углам и пояса сверху и снизу, четыре стекла, ручка спереди."""
    w, d, h = p['w'], p['d'], p['h']
    t = 0.03
    bm = bmesh.new()
    for sx in (-1, 1):
        for sz in (-1, 1):
            lib.box(bm, t, t, h, (sx * (w / 2 - t / 2), 0, sz * (d / 2 - t / 2)), mat=1, bevel=0.003, segments=1)
    for sy in (-1, 1):
        y = sy * (h / 2 - t / 2)
        for sz in (-1, 1):
            lib.box(bm, w - 2 * t, t, t, (0, y, sz * (d / 2 - t / 2)), mat=1, bevel=0.003, segments=1)
        for sx in (-1, 1):
            lib.box(bm, t, d - 2 * t, t, (sx * (w / 2 - t / 2), y, 0), mat=1, bevel=0.003, segments=1)
    for sz in (-1, 1):
        lib.box(bm, w - 2 * t, 0.006, h - 2 * t, (0, 0, sz * (d / 2 - t / 2)), mat=0)
    for sx in (-1, 1):
        lib.box(bm, 0.006, d - 2 * t, h - 2 * t, (sx * (w / 2 - t / 2), 0, 0), mat=0)
    lib.box(bm, 0.3, 0.02, 0.02, (0, -h / 2 + 0.1, d / 2 + 0.01), mat=1)
    return bm, [M['glass'], M['steel-moving']]


def head(p, M):
    """Головка: корпус, тёмный шов посередине, табличка спереди."""
    w, d, h = p['w'], p['d'], p['h']
    bm = bmesh.new()
    lib.box(bm, w, d, h, (0, 0, 0), mat=0, bevel=0.012, segments=3)
    lib.box(bm, w + 0.004, d + 0.004, 0.006, (0, -0.03, 0), mat=1)
    lib.box(bm, 0.22, 0.004, 0.07, (0, 0.06, d / 2 + 0.002), mat=2)
    return bm, [M['white'], M['dark'], M['grey']]


def hopper(p, M):
    """Бункер: конус и крышка по верхнему краю."""
    h = p['h']
    bm = bmesh.new()
    lib.cylinder(bm, p['bottom'] / 2, p['w'] / 2 - 0.015, h - 0.02, (0, -0.01, 0), mat=0, drop=('bottom',))
    lib.cylinder(bm, p['w'] / 2, p['w'] / 2, 0.02, (0, h / 2 - 0.01, 0), mat=0, bevel=0.004)
    return bm, [M['steel']]


def panel(p, M):
    """Пульт: тёмный корпус, экран и три кнопки на лицевой стороне (наружу по x) — корпус тоньше части на толщину
    кнопок: вся модель — в следе записи."""
    w, d, h = p['w'], p['d'], p['h']
    face = w / 2 - 0.008
    bm = bmesh.new()
    lib.box(bm, w - 0.008, d, h, (-0.004, 0, 0), mat=0, bevel=0.006)
    lib.box(bm, 0.004, 0.2, 0.15, (face + 0.002, 0.08, 0), mat=1)
    for k in (-1, 0, 1):
        lib.cylinder(bm, 0.012, 0.012, 0.008, (face + 0.004, -0.08, k * 0.06), axis='x', sides=12, mat=2)
    return bm, [M['dark'], M['grey'], M['steel']]


# виды записей, которые строит этот скрипт, и построения их частей по именам
MACHINES = {'eq.press'}
PARTS = {'body': body, 'rotor': rotor, 'cover': cover, 'head': head, 'hopper': hopper, 'panel': panel}
# детали — узлы износа записи внутри своей части
WEAR = {'punches': ('rotor', punches)}


def build(scene, machine, M, parent=None):
    """Объекты пресса — по частям записи, в серединах частей (оси окна); `parent` — пустышка места в помещении."""
    rec = scene['machines'][machine]
    objs = {}
    for p in rec['model']:
        make = PARTS.get(p.get('id'))
        if make is None:
            raise SystemExit(f'{machine}: у части {p.get("id") or p["shape"]} нет построения в blender/press.py')
        bm, mats = make(p, M)
        ob = lib.mesh_object(p['id'], bm, mats, parent)
        ob.location = lib.bl(p['x'], p['y'], p['z'])
        objs[p['id']] = ob
    for name, (part, make) in WEAR.items():
        if name not in rec['wear'] or part not in objs:
            continue
        p = next(q for q in rec['model'] if q.get('id') == part)
        bm, mats = make(p, M)
        objs[name] = lib.mesh_object(name, bm, mats, objs[part])
    for ob in objs.values():
        lib.apply_modifiers(ob)
    return objs


def unwrap(objs):
    """Одна развёртка на все объекты: острова по углу граней, упакованы вместе — в одну картинку затенения."""
    lib.select_only(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')


def main():
    a = lib.args()
    scene = lib.load_scene(a['scene'])
    lib.reset(AO_SAMPLES)
    bpy.context.scene.world.light_settings.distance = AO_DISTANCE
    M = materials(scene)
    objs = build(scene, a['machine'], M)
    rec = scene['machines'][a['machine']]
    moving = {p['id'] for p in rec['model'] if p.get('spin') or p.get('cover')}
    # подвижные части с деталями внутри — без затенения и без развёртки
    shaded = [o for n, o in objs.items() if n not in moving and (o.parent is None or o.parent.name not in moving)]
    unwrap(shaded)
    # пол под прессом: затеняет низ станины; в .glb его нет
    bm = bmesh.new()
    lib.box(bm, 4, 4, 0.02, (0, -0.01, 0))
    floor = lib.mesh_object('floor', bm, [lib.material('floor', {'color': [0.74, 0.78, 0.78], 'rough': 0.6, 'metal': 0})])
    # кожух не затеняет: стекло, а открытым он поднят
    objs['cover'].hide_render = True
    bake = lib.float_image('ao-bake', AO_SIZE, AO_SIZE, 1.0)
    for k in SHADED:
        lib.image_node(M[k], bake)
    lib.bake(shaded, 'AO', 8)
    px = lib.pixels(bake)
    ao = [round(min(1.0, max(0.0, px[i])) * 255) for i in range(0, len(px), 4)]
    out = a['out']
    # картинка затенения — рядом с рабочим файлом сборки: в .glb она войдёт целиком, в assets/ её отдельно нет
    png = os.path.join(a['work'], f'{a["machine"]}-ao.png')
    lib.write_png(png, AO_SIZE, AO_SIZE, 1, ao)
    # затенение — файл с диска: экспорт кладёт его байты в .glb как есть
    img = bpy.data.images.load(png)
    img.colorspace_settings.name = 'Non-Color'
    for k in SHADED:
        nt = M[k].node_tree
        for n in [n for n in nt.nodes if n.type == 'TEX_IMAGE']:
            nt.nodes.remove(n)
        lib.image_node(M[k], img, occlusion=True)
    bpy.data.images.remove(bake)
    bpy.data.objects.remove(floor)
    objs['cover'].hide_render = False
    bpy.ops.export_scene.gltf(
        filepath=out,
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
    if a.get('blend'):
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=a['blend'], compress=True)


if __name__ == '__main__':
    main()
