# Картонажная машина в Blender (#112): части и размеры — из записи content/machines/cartoner.yaml (через сцену
# tools/blender/scene.ts), имена объектов — имена частей записи. По устройству машины (pack-line-vendors;
# docs/10-domain.md, §6): блистеры входят справа, цепь пачек идёт вдоль лицевой стороны; за ней — ход толкателя, который
# вводит продукт с инструкцией в пачку; над цепью у выхода — печать кода и камера, перед выходом — ящик сброса пачек, код
# которых не прочитан; у цепи — направляющие и закрыватели клапанов. Облик — «балкон», как на фото машин производителя
# (pack-photos; облик, не устройство): сзади — белая стенка с круглыми люками и кабель-каналом, перед ней — магазин пачек
# с наклонным лотком и круглым захватом и фальцовщик инструкций со стопкой сверху; цепь — под кожухом со стёклами спереди
# и сверху; пульт — на стойке у входа блистеров; под лампой состояния окна — стойка сигнальной колонны. Станина с
# дверцами.
#
# Нарисованы только постоянные части машины: ни пачек в магазине, ни инструкций в фальцовщике — их считает движок,
# а штуки на лентах рисует окно (docs/13-art.md, §2). Ленты входа и цепи пачек — кодом: их коридор свободен, у торцов
# кожуха внизу — щель. Размеры деталей — гипотеза картинки, не факт: сверить (docs/13-art.md, §8). Собирает
# blender/machines.py.
import math

import bmesh

import lib

# верх стола — как в записи (стол: 1,00…1,04 м); цепь пачек и вход блистеров — по z = 0,2 м
TOP = 1.04
LINE = 0.2


def _local(p, y):
    """Высота `y` м от пола — в осях части."""
    return y - p['y']


def body(p, M):
    """Станина: корпус над утопленным тёмным цоколем, по четыре дверцы спереди и сзади с ручками, решётки на торцах —
    корпус уже части на толщину решёток: вся модель — в следе записи."""
    w, d, h = p['w'], p['d'], p['h']
    bm = bmesh.new()
    plinth = 0.08
    cw = w - 0.012
    lib.box(bm, cw, d, h - plinth, (0, plinth / 2, 0), mat=0, bevel=0.015, segments=3, drop=('bottom',))
    lib.box(bm, cw - 0.08, d - 0.08, plinth, (0, -h / 2 + plinth / 2, 0), mat=1, drop=('bottom',))
    n, gap = 4, 0.012
    door_w = (cw - 0.16 - (n - 1) * gap) / n
    door_h = h - plinth - 0.16
    for side in (1, -1):
        for k in range(n):
            x = -cw / 2 + 0.08 + door_w / 2 + k * (door_w + gap)
            lib.box(bm, door_w, 0.006, door_h, (x, plinth / 2 - 0.01, side * (d / 2 + 0.003)), mat=0, bevel=0.002, segments=1)
            hx = x + (door_w / 2 - 0.07) * (1 if k % 2 == 0 else -1)
            lib.box(bm, 0.016, 0.016, 0.14, (hx, plinth / 2 + 0.04, side * (d / 2 + 0.014)), mat=2)
    for s in (-1, 1):
        for k in range(7):
            lib.box(bm, 0.006, 0.6, 0.022, (s * (cw / 2 + 0.003), -0.15 + k * 0.05, 0), mat=1)
    return bm, [M['white'], M['dark'], M['steel']]


def table(p, M):
    """Стол — стальная плита с фаской; на нём направляющие цепи пачек и входа блистеров, закрыватели клапанов над
    цепью перед выходом — на стойках по наружным направляющим и поперечинах над пачками, ход толкателя за цепью, ящик
    сброса перед выходом и стойка сигнальной колонны под лампой состояния."""
    w, d, h = p['w'], p['d'], p['h']
    bm = bmesh.new()
    lib.box(bm, w, d, h, (0, 0, 0), mat=0, bevel=0.006, segments=2)
    top = _local(p, TOP)
    rail = top + 0.025
    for z in (LINE - 0.142, LINE + 0.142):
        lib.box(bm, 3.0, 0.012, 0.05, (-0.3, rail, z), mat=0, bevel=0.002, segments=1)
    for z in (LINE - 0.116, LINE + 0.116):
        lib.box(bm, 0.6, 0.012, 0.05, (1.9, rail, z), mat=0, bevel=0.002, segments=1)
    # закрыватели клапанов — над пачками (верх пачки — 1,11 м от пола), перед выходом: прутки на поперечинах, поперечины —
    # на стойках по наружным направляющим; коридор пачек (|z − 0,2| < 0,14 м ниже 1,12 м) свободен
    bar = _local(p, 1.13)
    for z in (LINE - 0.07, LINE + 0.07):
        lib.box(bm, 0.7, 0.01, 0.01, (-0.85, bar, z), mat=0)
    arm = bar + 0.011
    for x in (-1.15, -0.55):
        lib.box(bm, 0.012, 0.296, 0.012, (x, arm, LINE), mat=0)
        for z in (LINE - 0.142, LINE + 0.142):
            lib.box(bm, 0.012, 0.012, arm - rail - 0.025, (x, (arm + rail + 0.025) / 2, z), mat=0)
    # ход толкателя — за цепью, под кожухом
    lib.box(bm, 2.6, 0.14, 0.06, (-0.1, top + 0.03, LINE - 0.29), mat=1, bevel=0.004, segments=1)
    # ящик сброса — перед выходом, у края стола
    lib.box(bm, 0.22, 0.2, 0.14, (-1.95, top + 0.07, LINE + 0.3), mat=1, bevel=0.006, segments=1)
    lib.box(bm, 0.18, 0.16, 0.004, (-1.95, top + 0.142, LINE + 0.3), mat=2)
    lib.pole(bm, p, TOP, mat_base=2, mat_rod=0)
    return bm, [M['steel'], M['grey'], M['dark']]


def wall(p, M):
    """Стенка «балкона» за магазином и фальцовщиком: белая плита со стальным поясом сверху, кабель-каналом по верху
    лицевой стороны и круглыми люками с тёмным ободом между узлами."""
    w, d, h = p['w'], p['d'], p['h']
    bm = bmesh.new()
    plate = 0.05
    back = -d / 2
    face = back + plate
    lib.box(bm, w, plate, h, (0, 0, back + plate / 2), mat=0, bevel=0.01, segments=2, drop=('bottom',))
    lib.box(bm, w, d, 0.03, (0, h / 2 - 0.015, 0), mat=1, bevel=0.004, segments=1)
    lib.box(bm, w - 0.1, 0.04, 0.05, (0, _local(p, 1.7), face + 0.02), mat=2, bevel=0.006, segments=1)
    for x in (-1.55, -0.95, -0.4):
        cx, cy, _ = lib.local(p, x, 1.4, 0)
        lib.cylinder(bm, 0.095, 0.095, 0.006, (cx, cy, face + 0.003), axis='z', sides=32, mat=3)
        lib.cylinder(bm, 0.085, 0.085, 0.012, (cx, cy, face + 0.006), axis='z', sides=32, mat=1, bevel=0.002)
    return bm, [M['white'], M['steel'], M['grey'], M['dark']]


def cover(p, M):
    """Кожух над цепью пачек у стенки: три створки со стёклами спереди и сверху, стёкла на торцах; внизу у торцов —
    щель для входа блистеров и выхода пачек (до 1,13 м от пола)."""
    bm = bmesh.new()
    lib.hood(bm, p['w'], p['d'], p['h'], 3, glass=0, frame=1, slot=1.13 - (p['y'] - p['h'] / 2))
    return bm, [M['glass'], M['steel-moving']]


def magazine(p, M):
    """Магазин пачек: корпус захвата, на его лицевой стороне (к цепи) — круглый захват с тремя присосками на плечах, над
    корпусом — наклонный лоток стопки пачек с бортами, упором внизу и стойками вверху. Пачек не видно: их считает
    движок."""
    w, d, h = p['w'], p['d'], p['h']
    bm = bmesh.new()
    top = _local(p, TOP)
    house = 0.42
    lib.box(bm, w - 0.04, 0.3, house, (0, top + house / 2, -0.03), mat=0, bevel=0.01, segments=2, drop=('bottom',))
    hi = top + house
    face = 0.12
    # захват: диск, ступица, плечи и присоски — по кругу через 120°
    cy = _local(p, 1.25)
    lib.cylinder(bm, 0.17, 0.17, 0.02, (0, cy, face + 0.01), axis='z', sides=48, mat=1, bevel=0.003)
    lib.cylinder(bm, 0.045, 0.045, 0.03, (0, cy, face + 0.035), axis='z', sides=24, mat=2)
    for k in range(3):
        a = math.radians(90 + 120 * k)
        lib.box(bm, 0.12, 0.012, 0.025, (0.06 * math.cos(a), cy + 0.06 * math.sin(a), face + 0.026), mat=0, turn=a)
        lib.cylinder(bm, 0.022, 0.022, 0.025, (0.12 * math.cos(a), cy + 0.12 * math.sin(a), face + 0.0325), axis='z', sides=16, mat=2)
    # лоток: от нижнего края над корпусом слева (к цепи — вход пачек) вверх вправо
    lo = (-w / 2 + 0.04, hi + 0.03)
    up = (w / 2 - 0.04, h / 2 - 0.05)
    a = math.atan2(up[1] - lo[1], up[0] - lo[0])
    length = math.hypot(up[0] - lo[0], up[1] - lo[1])
    mid = ((lo[0] + up[0]) / 2, (lo[1] + up[1]) / 2)
    tray_z = (-0.17 + 0.08) / 2
    lib.box(bm, length, 0.24, 0.008, (mid[0], mid[1], tray_z), mat=1, turn=a)
    off = (-math.sin(a) * 0.025, math.cos(a) * 0.025)
    for z in (-0.17, 0.08):
        lib.box(bm, length, 0.008, 0.05, (mid[0] + off[0], mid[1] + off[1], z), mat=1, turn=a)
    lib.box(bm, 0.008, 0.24, 0.07, (lo[0] - 0.004, lo[1] + 0.02, tray_z), mat=1)
    x = up[0] - 0.06
    under = mid[1] + (x - mid[0]) * math.tan(a) - 0.004
    for z in (-0.17, 0.08):
        lib.cylinder(bm, 0.01, 0.01, under - hi, (x, (under + hi) / 2, z), sides=12, mat=1)
    return bm, [M['grey'], M['steel'], M['dark']]


def leaflet(p, M):
    """Фальцовщик инструкций: корпус с валиками на лицевой стороне (к цепи), ручка — выдвигать вперёд; сверху — стойки
    стопки инструкций; лоток подачи — к ходу толкателя, перед ним он и кончается. Инструкций не видно: их считает
    движок."""
    w, d, h = p['w'], p['d'], p['h']
    bm = bmesh.new()
    top = _local(p, TOP)
    body_h = 0.4
    lib.box(bm, w - 0.02, d - 0.02, body_h, (0, top + body_h / 2, 0), mat=0, bevel=0.01, segments=2)
    face = d / 2 - 0.01
    for k in range(3):
        lib.cylinder(bm, 0.022, 0.022, w - 0.14, (0, top + 0.08 + k * 0.06, face), axis='x', sides=16, mat=1)
    lib.box(bm, 0.3, 0.02, 0.02, (0, top + body_h - 0.05, face + 0.02), mat=2)
    lib.box(bm, 0.3, 0.06, 0.04, (0, top + 0.05, face + 0.03), mat=0, bevel=0.003, segments=1)
    plate = top + body_h + 0.0075
    lib.box(bm, 0.36, 0.26, 0.015, (0, plate, 0), mat=2)
    hi = h / 2 - 0.02
    for sx in (-1, 1):
        for sz in (-1, 1):
            lib.cylinder(bm, 0.01, 0.01, hi - plate, (sx * 0.17, (plate + hi) / 2, sz * 0.12), sides=12, mat=2)
    return bm, [M['grey'], M['dark'], M['steel']]


def coder(p, M):
    """Печать кода и камера над цепью у выхода: тёмные корпуса, объектив и подсветка вниз, к пачкам; подвес — на
    кронштейне от стойки за цепью."""
    bm = bmesh.new()
    lib.box(bm, 0.12, 0.16, 0.18, (0.07, _local(p, 1.25), 0), mat=0, bevel=0.006, segments=2)
    lib.box(bm, 0.06, 0.1, 0.02, (0.07, _local(p, 1.15), 0), mat=1)
    lib.box(bm, 0.09, 0.12, 0.1, (-0.08, _local(p, 1.3), 0), mat=0, bevel=0.006, segments=2)
    lib.cylinder(bm, 0.022, 0.022, 0.03, (-0.08, _local(p, 1.235), 0), sides=16, mat=1)
    lib.cylinder(bm, 0.045, 0.045, 0.012, (-0.08, _local(p, 1.214), 0), sides=24, mat=1)
    arm = _local(p, 1.48)
    for x in (0.07, -0.08):
        lib.box(bm, 0.03, 0.03, arm - _local(p, 1.34), (x, (arm + _local(p, 1.34)) / 2, 0), mat=2)
    lib.box(bm, 0.2, 0.04, 0.04, (0, arm, 0), mat=2, bevel=0.003, segments=1)
    lib.box(bm, 0.04, 0.38, 0.04, (0, arm, -0.13), mat=2, bevel=0.003, segments=1)
    top = _local(p, TOP)
    lib.box(bm, 0.05, 0.05, arm + 0.02 - top, (0, (top + arm + 0.02) / 2, -0.3), mat=2, bevel=0.003, segments=1)
    return bm, [M['dark'], M['grey'], M['steel']]


def panel(p, M):
    """Пульт на кронштейне у края стола: тёмный корпус, экран и три кнопки на лицевой стороне (к оператору, +z) —
    корпус тоньше части на толщину кнопок: вся модель — в следе записи."""
    w, d, h = p['w'], p['d'], p['h']
    face = d / 2 - 0.008
    bm = bmesh.new()
    lib.box(bm, w, d - 0.008, h, (0, 0, -0.004), mat=0, bevel=0.006)
    lib.box(bm, 0.26, 0.004, 0.19, (0.05, 0.02, face + 0.002), mat=1)
    for k in (-1, 0, 1):
        lib.cylinder(bm, 0.012, 0.012, 0.008, (-0.14, k * 0.07, face + 0.004), axis='z', sides=12, mat=2)
    low = _local(p, TOP - 0.04)
    lib.box(bm, 0.04, 0.04, -h / 2 - low, (0, (low - h / 2) / 2, -0.004), mat=2, bevel=0.003, segments=1)
    lib.box(bm, 0.04, 0.1, 0.03, (0, low + 0.015, -0.055), mat=2, bevel=0.003, segments=1)
    return bm, [M['dark'], M['grey'], M['steel']]


# виды записей, которые строит этот скрипт, и построения их частей по именам
MACHINES = {'mach.cartoner'}
PARTS = {
    'body': body,
    'table': table,
    'wall': wall,
    'cover': cover,
    'magazine': magazine,
    'leaflet': leaflet,
    'coder': coder,
    'panel': panel,
}
# детали — узлы износа записи внутри своей части (у картонажной их нет)
WEAR = {}
