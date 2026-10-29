# Общее для скриптов Blender «Фармзавода» (#109; устав, docs/11-new-games.md: Blender в фоновом режиме, скрипт в
# blender/, результат — .glb в assets/ с паспортом). Сцену пишет tools/blender/scene.ts из той же базы и того же кода
# раскладки, что окно игры; здесь — оси окна, отделка, части с фасками, запечка Cycles и PNG своим кодом. Только bpy,
# bmesh и стандартная библиотека: ставить в Blender ничего не нужно.
#
# Повторяемость байт в байт: пустая сцена фабричных настроек, имена — свои, порядок создания — один, у Cycles — одно зерно
# и одно число проб без подстройки и без шумодава; картинки запечки пишет `write_png` (zlib, уровень 9), а экспорт glTF
# кладёт в .glb байты этого файла как есть (картинка с диска, не изменена).
import json
import math
import struct
import sys
import zlib

import bmesh
import bpy
from mathutils import Matrix, Vector


def args():
    """Ключи после `--`: `--scene путь --out путь …` → словарь."""
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return {argv[i].lstrip('-'): argv[i + 1] for i in range(0, len(argv) - 1, 2)}


def load_scene(path):
    with open(path, encoding='utf-8') as f:
        scene = json.load(f)
    version = bpy.app.version_string.split(' ')[0]
    if version != scene['blender']:
        raise SystemExit(f'Blender {version}, а модели собираются на {scene["blender"]} (blender/README.md)')
    return scene


def reset(samples):
    """Пустая сцена фабричных настроек; Cycles на процессоре, одно зерно, ровное число проб."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.seed = 0
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 3
    world = bpy.data.worlds.new('world')
    sc.world = world
    return sc


def bl(x, y, z):
    """Оси окна (x, y вверх, z к зрителю) → оси Blender (x, y вглубь, z вверх); поворот окна вокруг y — поворот вокруг z."""
    return Vector((x, -z, y))


# ---------------------------------------------------------------- отделка

def material(name, f):
    """Отделка machines.ts: цвет уже линейный (сцену пишет THREE.Color), шероховатость, металл, прозрачность стекла."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    # сетки замкнуты: изнанку не рисуют (в glTF — doubleSided: false)
    m.use_backface_culling = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*f['color'], 1.0)
    bsdf.inputs['Roughness'].default_value = f['rough']
    bsdf.inputs['Metallic'].default_value = f['metal']
    if 'opacity' in f:
        bsdf.inputs['Alpha'].default_value = f['opacity']
        m.surface_render_method = 'BLENDED'
    return m


def gltf_output():
    """Группа «glTF Material Output» — по ней экспорт glTF находит затенение (Occlusion) материала."""
    g = bpy.data.node_groups.get('glTF Material Output')
    if g:
        return g
    g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    g.nodes.new('NodeGroupInput')
    return g


def image_node(m, image, occlusion=False):
    """Картинка в материале — активная (в неё запекают); `occlusion` — она же затенение для glTF."""
    nt = m.node_tree
    node = nt.nodes.new('ShaderNodeTexImage')
    node.image = image
    node.interpolation = 'Linear'
    nt.nodes.active = node
    if occlusion:
        group = nt.nodes.new('ShaderNodeGroup')
        group.node_tree = gltf_output()
        nt.links.new(node.outputs['Color'], group.inputs['Occlusion'])
    return node


# ---------------------------------------------------------------- части

def mesh_object(name, bm, mats, parent=None):
    """Сетка из bmesh — объект сцены; грани гладкие: где острое ребро, решают фаски и нормали по площади граней."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    wn = ob.modifiers.new('normals', 'WEIGHTED_NORMAL')
    wn.mode = 'FACE_AREA'
    wn.keep_sharp = True
    wn.weight = 50
    return ob


def _finish(bm, mat, bevel, segments, drop):
    """Грани — материалом `mat`; рёбра острее 30° — фаской `bevel` м или острыми; `drop` — грань низа (на полу или на
    другой части: её не видно, а место в развёртке затенения она бы заняла)."""
    for f in bm.faces:
        f.material_index = mat
        f.normal_update()
    if 'bottom' in drop:
        low = min(v.co.z for v in bm.verts)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.99 and f.calc_center_median().z <= low + 1e-6], context='FACES_ONLY')
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(30)]
    if bevel > 0 and edges:
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=segments, profile=0.5, affect='EDGES', clamp_overlap=True, material=mat)
    else:
        for e in edges:
            e.smooth = False


def _append(dst, src):
    """Деталь — в сетку части в одном порядке при каждом прогоне: фаска Blender отдаёт вершины и грани в разном порядке
    (от адресов в памяти), и .glb не повторялся бы. Вершины — по координатам на сетке 1 мкм, грань — от своей наименьшей
    вершины, грани — по материалу и вершинам."""
    src.verts.ensure_lookup_table()
    src.verts.index_update()
    cos = [tuple(round(c, 6) + 0.0 for c in v.co) for v in src.verts]
    order = sorted(range(len(cos)), key=lambda i: cos[i])
    at = {old: k for k, old in enumerate(order)}
    nv = [dst.verts.new(cos[old]) for old in order]
    faces = []
    for f in src.faces:
        idx = [at[loop.vert.index] for loop in f.loops]
        r = idx.index(min(idx))
        faces.append((f.material_index, idx[r:] + idx[:r]))
    for mat, idx in sorted(faces):
        dst.faces.new([nv[i] for i in idx]).material_index = mat
    for a, b in sorted({tuple(sorted(at[v.index] for v in e.verts)) for e in src.edges if not e.smooth}):
        e = dst.edges.get((nv[a], nv[b]))
        if e is not None:
            e.smooth = False
    src.free()


def box(bm, w, d, h, at=(0, 0, 0), mat=0, bevel=0.0, segments=2, drop=()):
    """Ящик w × d × h (оси окна: x, z, y) с серединой `at` (оси окна) — в bmesh части."""
    one = bmesh.new()
    bmesh.ops.create_cube(one, size=1.0)
    bmesh.ops.transform(one, matrix=Matrix.Translation(bl(*at)) @ Matrix.Diagonal((w, d, h, 1.0)), verts=one.verts[:])
    _finish(one, mat, bevel, segments, drop)
    _append(bm, one)


def cylinder(bm, r_bottom, r_top, h, at=(0, 0, 0), axis='y', sides=32, mat=0, bevel=0.0, segments=2, drop=()):
    """Цилиндр или конус по оси `axis` окна, высота `h`, середина `at`; `sides` — граней по кругу."""
    one = bmesh.new()
    bmesh.ops.create_cone(one, cap_ends=True, cap_tris=False, segments=sides, radius1=r_bottom, radius2=r_top, depth=h)
    turn = {'y': Matrix.Identity(4), 'x': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'z': Matrix.Rotation(math.pi / 2, 4, 'X')}[axis]
    bmesh.ops.transform(one, matrix=Matrix.Translation(bl(*at)) @ turn, verts=one.verts[:])
    _finish(one, mat, bevel, segments, drop)
    _append(bm, one)


def apply_modifiers(ob):
    """Модификаторы — в сетку: дальше её режут развёрткой и запекают."""
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


# ---------------------------------------------------------------- запечка

def float_image(name, w, h, fill):
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.generated_color = (fill, fill, fill, 1.0)
    return img


def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def bake(objs, kind, margin, passes=None):
    """Запечка Cycles в активные картинки материалов `objs`: AO или рассеянный свет без цвета (прямой и отражённый)."""
    select_only(objs)
    sc = bpy.context.scene
    sc.render.bake.margin = margin
    sc.render.bake.margin_type = 'EXTEND'
    if passes:
        bpy.ops.object.bake(type=kind, pass_filter=passes, margin=margin, margin_type='EXTEND', use_clear=False, target='IMAGE_TEXTURES')
    else:
        bpy.ops.object.bake(type=kind, margin=margin, margin_type='EXTEND', use_clear=False, target='IMAGE_TEXTURES')


def pixels(img):
    """Точки картинки — плоский список float RGBA снизу вверх, как хранит Blender."""
    buf = [0.0] * (img.size[0] * img.size[1] * 4)
    img.pixels.foreach_get(buf)
    return buf


def to_srgb(c):
    c = min(1.0, max(0.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def write_png(path, w, h, channels, values):
    """PNG своим кодом: `values` — 0…255 по строкам снизу вверх (как в Blender), в файле — сверху вниз; 1 канал — серый."""
    stride = w * channels
    rows = [bytes(values[(h - 1 - y) * stride:(h - y) * stride]) for y in range(h)]
    raw = b''.join(b'\x00' + r for r in rows)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    kind = {1: 0, 3: 2}[channels]
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, kind, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)
