# Общее для скриптов Blender «Фармзавода» (#109; устав, docs/11-new-games.md: Blender в фоновом режиме, скрипт в
# blender/, результат — .glb в assets/ с паспортом). Сцену пишет tools/blender/scene.ts из той же базы и отделки
# machines.ts, что окно игры; здесь — оси окна, отделка на все машины, части с фасками, машина по частям записи, кожух
# у стенки, стойка лампы, развёртка, запечка Cycles, PNG своим кодом и имена узлов .glb. Только bpy, bmesh и стандартная
# библиотека: ставить в Blender ничего не нужно.
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


# отделка неподвижных частей — с затенением из общей карты; подвижных — та же, без него (`-moving`): тень, запечённая в
# одном положении, ехала бы вместе с частью (docs/13-art.md, §8). Плёнка прозрачна — у неподвижных частей её нет.
SHADED = ('white', 'steel', 'grey', 'dark', 'blue', 'foil', 'card')


def materials(scene):
    """Отделка записей (machines.ts) — один набор на все машины: в .glb у машин общие материалы, и окно сливает их
    неподвижные части по материалу. Материал без сетки в .glb не попадает."""
    f = scene['finish']
    m = {k: material(k, f[k]) for k in SHADED}
    for k in f:
        if k != 'glass':
            m[f'{k}-moving'] = material(f'{k}-moving', f[k])
    m['glass'] = material('glass', f['glass'])
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


def box(bm, w, d, h, at=(0, 0, 0), mat=0, bevel=0.0, segments=2, drop=(), turn=0.0):
    """Ящик w × d × h (оси окна: x, z, y) с серединой `at` (оси окна) — в bmesh части; `turn` — поворот, рад, вокруг оси
    z окна (от x к y: наклонный лоток, плечо захвата)."""
    one = bmesh.new()
    bmesh.ops.create_cube(one, size=1.0)
    # ось z окна — ось −y Blender: поворот окна на `turn` — поворот Blender вокруг y на −`turn`
    m = Matrix.Translation(bl(*at)) @ Matrix.Rotation(-turn, 4, 'Y') @ Matrix.Diagonal((w, d, h, 1.0))
    bmesh.ops.transform(one, matrix=m, verts=one.verts[:])
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


def lathe(bm, profile, at=(0, 0, 0), sides=32, mat=0):
    """Тело вращения вокруг оси y окна (чаша, воронка): `profile` — точки (r, y) от низа к верху, с серединой `at`;
    точка с r = 0 — на оси (дно или дно чаши изнутри). Сетка замкнута, нормали — наружу: внутренняя стенка чаши видна
    сверху, без изнанки."""
    one = bmesh.new()
    rings = []
    for r, y in profile:
        if r == 0:
            rings.append([one.verts.new(bl(at[0], at[1] + y, at[2]))])
            continue
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            ring.append(one.verts.new(bl(at[0] + r * math.cos(a), at[1] + y, at[2] + r * math.sin(a))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(sides):
            n = (k + 1) % sides
            if len(a) == 1:
                one.faces.new((a[0], b[n], b[k]))
            elif len(b) == 1:
                one.faces.new((a[k], a[n], b[0]))
            else:
                one.faces.new((a[k], a[n], b[n], b[k]))
    bmesh.ops.recalc_face_normals(one, faces=one.faces[:])
    _finish(one, mat, 0.0, 1, ())
    _append(bm, one)


def apply_modifiers(ob):
    """Модификаторы — в сетку: дальше её режут развёрткой и запекают."""
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def hood(bm, w, d, h, bays, glass=0, frame=1, slot=0.0):
    """Кожух у стенки машины («балкон», docs/10-domain.md, §6): стальная рама со стёклами спереди, сверху и по торцам;
    сзади кожух открыт — там стенка, по её верхнему ребру — пояс шарнира (кожух открывается вверх и наружу,
    src/render/machines.ts). Спереди — створки с ручками внизу; у торцов внизу — щель `slot` м: лента, полотно и пачки
    проходят под рамой. Оси части, середина — в нуле."""
    t = 0.03
    xs = [-w / 2 + t / 2 + k * (w - t) / bays for k in range(bays + 1)]
    fz, bz = d / 2 - t / 2, -d / 2 + t / 2
    top, low = h / 2 - t / 2, -h / 2 + t / 2
    ends = (-w / 2 + t / 2, w / 2 - t / 2)
    # стойки: спереди — по углам и между створками во всю высоту; сзади — по углам, над щелью
    for x in xs:
        box(bm, t, t, h, (x, 0, fz), mat=frame, bevel=0.003, segments=1)
    for x in ends:
        box(bm, t, t, h - slot, (x, slot / 2, bz), mat=frame, bevel=0.003, segments=1)
    # пояса: спереди — сверху и снизу, сзади — сверху (шарнир); поперёк — сверху у каждой стойки и на торцах над щелью
    for y, z in ((top, fz), (low, fz), (top, bz)):
        box(bm, w - 2 * t, t, t, (0, y, z), mat=frame, bevel=0.003, segments=1)
    for x in xs:
        box(bm, t, d - 2 * t, t, (x, top, 0), mat=frame, bevel=0.003, segments=1)
    for x in ends:
        box(bm, t, d - 2 * t, t, (x, low + slot, 0), mat=frame, bevel=0.003, segments=1)
    # стёкла створок спереди и сверху, ручки внизу створок
    for a, b in zip(xs, xs[1:]):
        x, bw = (a + b) / 2, b - a - t
        box(bm, bw, 0.006, h - 2 * t, (x, 0, fz), mat=glass)
        box(bm, bw, d - 2 * t, 0.006, (x, top, 0), mat=glass)
        box(bm, min(0.3, bw / 2), 0.02, 0.02, (x, -h / 2 + 0.1, d / 2 + 0.01), mat=frame)
    # стёкла торцов — над щелью
    for x in ends:
        box(bm, 0.006, d - 2 * t, h - 2 * t - slot, (x, slot / 2, 0), mat=glass)


def local(p, x, y, z):
    """Точка машины (x, y, z, м; оси окна) — в осях части `p`."""
    return (x - p['x'], y - p['y'], z - p['z'])


def part(p, name):
    """Часть записи машины по имени — построения видят всю запись (`p['rec']`, `build`)."""
    return next(q for q in p['rec']['model'] if q.get('id') == name)


def pole(bm, p, base, mat_base=0, mat_rod=1):
    """Стойка сигнальной колонны: от высоты `base` м до лампы состояния, которую рисует окно (`lamp` записи сцены,
    src/render/machines.ts `lampAt`) — лампа стоит на стойке, а не висит над машиной. Оси части `p`."""
    lx, ly, lz = p['rec']['lamp']
    x, y0, z = local(p, lx, base, lz)
    y1 = ly - p['y']
    box(bm, 0.07, 0.07, 0.012, (x, y0 + 0.006, z), mat=mat_base, bevel=0.003, segments=1)
    cylinder(bm, 0.014, 0.014, y1 - y0 - 0.012, (x, (y0 + 0.012 + y1) / 2, z), sides=12, mat=mat_rod)


def empty(name):
    """Пустышка — корень машины в .glb: узел с именем вида записи, части — внутри."""
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def build(scene, machine, M, parts, wear, root):
    """Объекты машины — по частям записи, в серединах частей (оси окна), внутри корня `root`; детали с именем — узлы
    износа записи (`parts`) внутри своей части. Построение части получает её запись с записью машины (`rec`): соседние
    части и лампу состояния. Лента — кодом (src/render/machines.ts): полотно и штуки на нём. Имя
    объекта — «вид/часть»: у разных машин части называются одинаково, а имена объектов Blender не повторяются;
    приставку снимает `own_names`."""
    rec = scene['machines'][machine]
    objs = {}
    for p in rec['model']:
        if p['shape'] == 'belt':
            continue
        make = parts.get(p.get('id'))
        if make is None:
            raise SystemExit(f'{machine}: у части {p.get("id") or p["shape"]} нет построения в blender/')
        bm, mats = make({**p, 'rec': rec}, M)
        ob = mesh_object(f'{machine}/{p["id"]}', bm, mats, root)
        ob.location = bl(p['x'], p['y'], p['z'])
        objs[p['id']] = ob
    for name, (part, make) in wear.items():
        if name not in rec['wear'] or part not in objs:
            continue
        p = next(q for q in rec['model'] if q.get('id') == part)
        bm, mats = make({**p, 'rec': rec}, M)
        objs[name] = mesh_object(f'{machine}/{name}', bm, mats, objs[part])
    for ob in objs.values():
        apply_modifiers(ob)
    return objs


def unwrap(objs):
    """Одна развёртка на все объекты: острова по углу граней, упакованы вместе — в одну картинку затенения."""
    select_only(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')


def own_names(path):
    """Узлы .glb — имена частей записи (устав: имя узла = идентификатор части): снять приставку «вид/» у узлов. JSON
    файла — заново, двоичная часть — та же, что у экспорта."""
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, _ = struct.unpack_from('<4sII', data, 0)
    size, kind = struct.unpack_from('<I4s', data, 12)
    gltf = json.loads(data[20:20 + size])
    for node in gltf.get('nodes', []):
        if '/' in node.get('name', ''):
            node['name'] = node['name'].split('/', 1)[1]
    text = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    text += b' ' * (-len(text) % 4)
    rest = data[20 + size:]
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', magic, version, 20 + len(text) + len(rest)) + struct.pack('<I4s', len(text), kind) + text + rest)


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


def bake(objs, kind, margin):
    """Запечка Cycles в активные картинки материалов `objs` (затенение — `AO`)."""
    select_only(objs)
    sc = bpy.context.scene
    sc.render.bake.margin = margin
    sc.render.bake.margin_type = 'EXTEND'
    bpy.ops.object.bake(type=kind, margin=margin, margin_type='EXTEND', use_clear=False, target='IMAGE_TEXTURES')


def pixels(img):
    """Точки картинки — плоский список float RGBA снизу вверх, как хранит Blender."""
    buf = [0.0] * (img.size[0] * img.size[1] * 4)
    img.pixels.foreach_get(buf)
    return buf


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
