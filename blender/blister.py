# Блистерная машина в Blender (#112): части и размеры — из записи content/machines/blister.yaml (через сцену
# tools/blender/scene.ts), имена объектов — имена частей записи. Станции — по ходу плёнки справа налево, как у машины
# (pilchik-2000, pack-line-vendors; docs/10-domain.md, §6): размотка плёнки ПВХ, нагрев и формование, питатель, камера,
# запайка плитой с охлаждением, тиснение с перфорацией и вырубкой. Облик — «балкон», как на фото машин производителя
# (pack-photos; облик, не устройство): за запайкой и вырубкой — белая стенка с фольгой на размотке и валиками, перед
# ними — кожух со стёклами спереди и сверху; у входа плёнки стол открыт: стойка размотки, станция формования, питатель —
# коробка над полотном и чаша бункера на колонке с гибкими трубками к коробке; пульт — на стойке у входа; под лампой
# состояния окна — стойка сигнальной колонны. У станций — плиты инструмента, направляющие колонки, траверса и привод; у
# станины — цоколь и дверцы с ручками.
#
# Нарисованы только постоянные части машины: ни полотна плёнки и фольги, ни таблеток в питателе, ни блистеров — их считает
# движок, а штуки на ленте рисует окно (docs/13-art.md, §2). Лента выхода — кодом: под станцией вырубки её коридор
# свободен, у торцов кожуха внизу — щель. Плита запайки — объект `sealplate` внутри станции запайки: имя — узел износа
# записи (`parts`). Размеры деталей — гипотеза картинки, не факт: сверить (docs/13-art.md, §8). Собирает
# blender/machines.py.
import bmesh

import lib

# высота полотна плёнки между плитами инструмента, м, и верх стола — как в записи (стол: 0,90…0,94 м)
WEB = 1.05
TOP = 0.94


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
    door_h = h - plinth - 0.14
    for side in (1, -1):
        for k in range(n):
            x = -cw / 2 + 0.08 + door_w / 2 + k * (door_w + gap)
            lib.box(bm, door_w, 0.006, door_h, (x, plinth / 2 - 0.01, side * (d / 2 + 0.003)), mat=0, bevel=0.002, segments=1)
            hx = x + (door_w / 2 - 0.07) * (1 if k % 2 == 0 else -1)
            lib.box(bm, 0.016, 0.016, 0.14, (hx, plinth / 2 + 0.03, side * (d / 2 + 0.014)), mat=2)
    for s in (-1, 1):
        for k in range(6):
            lib.box(bm, 0.006, 0.6, 0.022, (s * (cw / 2 + 0.003), -0.12 + k * 0.05, 0), mat=1)
    return bm, [M['white'], M['dark'], M['steel']]


def table(p, M):
    """Стол — стальная плита с фаской; на нём стойка размотки плёнки (сзади, с валом к середине рулона) и стойка
    сигнальной колонны под лампой состояния."""
    w, d, h = p['w'], p['d'], p['h']
    bm = bmesh.new()
    lib.box(bm, w, d, h, (0, 0, 0), mat=0, bevel=0.006, segments=2)
    top = _local(p, TOP)
    # размотка плёнки: середина рулона — как у части film записи, рулон — вдоль z
    film = lib.part(p, 'film')
    fx, fy, fz = lib.local(p, film['x'], film['y'], film['z'])
    back = fz - film['d'] / 2 - 0.1
    lib.box(bm, 0.2, 0.04, fy - top + 0.09, (fx, (top + fy + 0.09) / 2, back), mat=1, bevel=0.004, segments=1)
    lib.cylinder(bm, 0.03, 0.03, 0.08, (fx, fy, back + 0.06), axis='z', sides=16, mat=0)
    lib.box(bm, 0.12, 0.12, 0.03, (fx, top + 0.015, back), mat=2)
    lib.pole(bm, p, TOP, mat_base=2, mat_rod=0)
    return bm, [M['steel'], M['grey'], M['dark']]


def wall(p, M):
    """Стенка «балкона» за запайкой и вырубкой: белая плита во всю высоту кожуха со стальным поясом сверху и кабель-каналом
    понизу; на лицевой стороне — вал фольги со ступицей и тормозом, валики хода фольги и полотна — стальные, с тёмными
    торцами. Всё — за станциями (у них |z| ≤ 0,35 м)."""
    w, d, h = p['w'], p['d'], p['h']
    bm = bmesh.new()
    plate = 0.05
    back = -d / 2
    face = back + plate
    lib.box(bm, w, plate, h, (0, 0, back + plate / 2), mat=0, bevel=0.01, segments=2, drop=('bottom',))
    lib.box(bm, w, d, 0.03, (0, h / 2 - 0.015, 0), mat=1, bevel=0.004, segments=1)
    lib.box(bm, w - 0.1, 0.04, 0.06, (0, _local(p, 1.0), face + 0.02), mat=2, bevel=0.006, segments=1)
    # вал фольги: от стенки до задней грани рулона, ступица и тормоз — на стенке
    foil = lib.part(p, 'foil')
    gx, gy, gz = lib.local(p, foil['x'], foil['y'], foil['z'])
    rear = gz - foil['d'] / 2
    lib.cylinder(bm, 0.025, 0.025, rear - face + 0.02, (gx, gy, (face + rear + 0.02) / 2), axis='z', sides=16, mat=1)
    lib.cylinder(bm, 0.07, 0.07, 0.012, (gx, gy, face + 0.006), axis='z', sides=32, mat=3, bevel=0.002)
    lib.box(bm, 0.06, 0.03, 0.08, (gx + 0.12, gy - 0.1, face + 0.015), mat=3, bevel=0.004, segments=1)
    # валики — по ходу фольги вниз к запайке и полотна к вырубке; высоты — над станциями
    for x, y in ((0.32, 1.47), (-0.32, 1.52), (-0.55, 1.72), (-1.35, 1.58), (-1.7, 1.42)):
        rx, ry, _ = lib.local(p, x, y, 0)
        lib.cylinder(bm, 0.022, 0.022, 0.11, (rx, ry, face + 0.055), axis='z', sides=16, mat=1)
        lib.cylinder(bm, 0.03, 0.03, 0.01, (rx, ry, face + 0.115), axis='z', sides=16, mat=3)
    return bm, [M['white'], M['steel'], M['grey'], M['dark']]


def cover(p, M):
    """Кожух у стенки: три створки со стёклами спереди и сверху, стёкла на торцах; внизу у торцов — щель для ленты выхода
    и полотна (до 1,08 м от пола)."""
    bm = bmesh.new()
    lib.hood(bm, p['w'], p['d'], p['h'], 3, glass=0, frame=1, slot=1.08 - (p['y'] - p['h'] / 2))
    return bm, [M['glass'], M['steel-moving']]


def _station(bm, p, lower, upper, M_idx):
    """Станция на четырёх колонках: нижняя плита инструмента под полотном, верхняя над ним, траверса и привод сверху.
    `lower`, `upper` — (высота низа, высота верха) от пола или None."""
    steel, grey, dark = M_idx
    w, d, h = p['w'], p['d'], p['h']
    top = _local(p, TOP)
    lib.box(bm, w - 0.02, d - 0.04, 0.03, (0, top + 0.015, 0), mat=grey, bevel=0.004, segments=1)
    for sx in (-1, 1):
        for sz in (-1, 1):
            lib.cylinder(bm, 0.022, 0.022, h - 0.08, (sx * 0.16, top + 0.03 + (h - 0.08) / 2, sz * 0.27), sides=16, mat=steel)
    if lower:
        a, b = (_local(p, y) for y in lower)
        lib.box(bm, 0.28, 0.54, b - a, (0, (a + b) / 2, 0), mat=steel, bevel=0.004, segments=1)
    if upper:
        a, b = (_local(p, y) for y in upper)
        lib.box(bm, 0.28, 0.54, b - a, (0, (a + b) / 2, 0), mat=steel, bevel=0.004, segments=1)
    lib.box(bm, w, d, 0.05, (0, h / 2 - 0.025, 0), mat=steel, bevel=0.006, segments=2)
    lib.cylinder(bm, 0.06, 0.06, 0.11, (0, h / 2 + 0.055, 0), sides=24, mat=grey, bevel=0.004)
    lib.cylinder(bm, 0.03, 0.03, 0.03, (0, h / 2 + 0.125, 0), sides=12, mat=dark)


def forming(p, M):
    """Нагрев и формование: нижний инструмент под полотном, плита нагрева и формующий инструмент над ним с тёмной
    изоляцией и вводом кабеля; колонки, траверса, привод."""
    bm = bmesh.new()
    _station(bm, p, (0.97, WEB - 0.01), (WEB + 0.02, 1.17), (0, 1, 2))
    lib.box(bm, 0.28, 0.54, 0.025, (0, _local(p, 1.1825), 0), mat=2)
    lib.cylinder(bm, 0.018, 0.018, 0.12, (0.1, _local(p, 1.255), -0.2), sides=12, mat=2)
    return bm, [M['steel'], M['grey'], M['dark']]


def hopper(p, M):
    """Чаша бункера на колонке, как у машин на фото (pack-photos — облик): стальная чаша с ободом и крышкой с тёмной
    кнопкой, под ней — колонка дозатора на блоке, от блока к коробке питателя — две гибкие трубки в кольцах."""
    w, h = p['w'], p['h']
    bm = bmesh.new()
    lo, hi = 1.62, p['y'] + h / 2
    a, b = _local(p, lo), _local(p, hi)
    lib.cylinder(bm, 0.07, w / 2 - 0.012, b - a - 0.02, (0, (a + b - 0.02) / 2, 0), sides=32, mat=0, drop=('bottom',))
    lib.cylinder(bm, w / 2, w / 2, 0.02, (0, b - 0.01, 0), sides=32, mat=0, bevel=0.003)
    lib.cylinder(bm, w / 2 - 0.02, w / 2 - 0.02, 0.01, (0, b + 0.005, 0), sides=32, mat=0, bevel=0.002)
    lib.cylinder(bm, 0.02, 0.016, 0.018, (0, b + 0.019, 0), sides=12, mat=1)
    # колонка и блок дозатора
    col_lo = 1.54
    lib.cylinder(bm, 0.045, 0.045, lo - col_lo, (0, _local(p, (lo + col_lo) / 2), 0), sides=20, mat=0)
    lib.box(bm, 0.16, 0.2, 0.06, (0, _local(p, col_lo - 0.03), 0), mat=0, bevel=0.006, segments=2)
    # трубки — от блока вниз к коробке питателя (её верх — низ части)
    feed = p['y'] - h / 2
    t_hi = col_lo - 0.06
    for z in (-0.06, 0.06):
        lib.cylinder(bm, 0.022, 0.022, t_hi - feed, (0, _local(p, (t_hi + feed) / 2), z), sides=16, mat=2)
        for k in range(4):
            y = feed + 0.02 + k * (t_hi - feed - 0.04) / 3
            lib.cylinder(bm, 0.027, 0.027, 0.008, (0, _local(p, y), z), sides=16, mat=2)
    return bm, [M['steel'], M['dark'], M['grey']]


def feeder(p, M):
    """Питатель: щёточная коробка на полотне, над ней — тёмная коробка питателя с белой крышкой спереди и стальной плитой
    сверху (к ней приходят трубки от чаши); мотор — сзади."""
    w, d, h = p['w'], p['d'], p['h']
    bm = bmesh.new()
    box_lo, box_hi = WEB + 0.01, WEB + 0.11
    lib.box(bm, 0.24, 0.46, box_hi - box_lo, (0, _local(p, (box_lo + box_hi) / 2), 0), mat=1, bevel=0.008, segments=2)
    head_lo, head_hi = box_hi, p['y'] + h / 2 - 0.02
    lib.box(bm, 0.26, 0.42, head_hi - head_lo, (0, _local(p, (head_lo + head_hi) / 2), -0.01), mat=2, bevel=0.01, segments=2)
    lib.box(bm, 0.24, 0.012, head_hi - head_lo - 0.04, (0, _local(p, (head_lo + head_hi) / 2), 0.206), mat=3, bevel=0.003, segments=1)
    lib.box(bm, w, 0.46, 0.02, (0, h / 2 - 0.01, -0.01), mat=0, bevel=0.003, segments=1)
    lib.cylinder(bm, 0.05, 0.05, 0.03, (0, _local(p, (head_lo + head_hi) / 2), -d / 2 + 0.015), axis='z', sides=20, mat=2, bevel=0.003)
    return bm, [M['steel'], M['grey'], M['dark'], M['white']]


def camera(p, M):
    """Камера: тёмный корпус, объектив и кольцо подсветки вниз, к полотну; кронштейн к стойке за полотном."""
    w, d, h = p['w'], p['d'], p['h']
    bm = bmesh.new()
    lib.box(bm, w - 0.01, d - 0.01, h - 0.01, (0, 0, 0), mat=0, bevel=0.006, segments=2)
    lib.cylinder(bm, 0.022, 0.022, 0.03, (0, -h / 2 - 0.015, 0), sides=16, mat=1)
    lib.cylinder(bm, 0.045, 0.045, 0.012, (0, -h / 2 - 0.036, 0), sides=24, mat=1)
    top = _local(p, TOP)
    lib.box(bm, 0.03, 0.36, 0.03, (0, 0.035, -0.26), mat=2, bevel=0.003, segments=1)
    lib.box(bm, 0.04, 0.04, 0.05 - top, (0, (top + 0.05) / 2, -0.46), mat=2, bevel=0.003, segments=1)
    return bm, [M['dark'], M['grey'], M['steel']]


def sealing(p, M):
    """Запайка плитой: нижний инструмент с вводами охлаждения, держатель плиты с тёмной изоляцией над полотном;
    колонки, траверса, привод. Сама плита — узел износа `sealplate`."""
    bm = bmesh.new()
    _station(bm, p, (0.97, WEB - 0.01), (WEB + 0.06, 1.17), (0, 1, 2))
    lib.box(bm, 0.28, 0.54, 0.02, (0, _local(p, 1.18), 0), mat=2)
    for x in (-0.12, 0.12):
        lib.cylinder(bm, 0.012, 0.012, 0.03, (x, _local(p, 1.0), 0.285), axis='z', sides=12, mat=2)
    return bm, [M['steel'], M['grey'], M['dark']]


def sealplate(p, M):
    """Плита запайки — под держателем, над полотном (sepha-seal: её снимают и переанодируют)."""
    bm = bmesh.new()
    lib.box(bm, 0.27, 0.52, 0.04, (0, _local(p, WEB + 0.04), 0), mat=0, bevel=0.003, segments=1)
    return bm, [M['steel']]


def punching(p, M):
    """Тиснение, перфорация и вырубка: портал над лентой выхода — боковины по краям, матрица над лентой, пуансонная
    плита и траверса; сбоку — узел тиснения номера серии и срока. Коридор ленты (|z| < 0,15 м ниже 1 м) свободен."""
    w, d, h = p['w'], p['d'], p['h']
    bm = bmesh.new()
    top = _local(p, TOP)
    for sz in (-1, 1):
        lib.box(bm, w - 0.04, 0.05, h - 0.06, (0, top + (h - 0.06) / 2 - 0.01, sz * 0.28), mat=0, bevel=0.005, segments=1)
    lib.box(bm, 0.3, 0.46, 0.04, (0, _local(p, 1.03), 0), mat=0, bevel=0.003, segments=1)
    lib.box(bm, 0.3, 0.46, 0.09, (0, _local(p, 1.155), 0), mat=0, bevel=0.004, segments=1)
    lib.box(bm, w, d, 0.05, (0, h / 2 - 0.025, 0), mat=0, bevel=0.006, segments=2)
    lib.cylinder(bm, 0.06, 0.06, 0.11, (0, h / 2 + 0.055, 0), sides=24, mat=1, bevel=0.004)
    lib.box(bm, 0.07, 0.3, 0.08, (0.16, _local(p, 1.25), 0), mat=2, bevel=0.004, segments=1)
    lib.cylinder(bm, 0.02, 0.02, 0.06, (0.16, _local(p, 1.32), 0.08), sides=12, mat=1)
    return bm, [M['steel'], M['grey'], M['dark']]


def film(p, M):
    """Рулон плёнки ПВХ на размотке: прозрачная намотка на гильзе."""
    bm = bmesh.new()
    r, length = p['w'] / 2, p['d']
    lib.cylinder(bm, r - 0.01, r - 0.01, length - 0.04, (0, 0, 0), axis='z', sides=48, mat=0)
    lib.cylinder(bm, 0.055, 0.055, length, (0, 0, 0), axis='z', sides=24, mat=0)
    return bm, [M['film-moving']]


def foil(p, M):
    """Рулон фольги на валу стенки: намотка на гильзе."""
    bm = bmesh.new()
    r, length = p['w'] / 2, p['d']
    lib.cylinder(bm, r - 0.01, r - 0.01, length - 0.06, (0, 0, 0), axis='z', sides=40, mat=0, bevel=0.004)
    lib.cylinder(bm, 0.04, 0.04, length, (0, 0, 0), axis='z', sides=20, mat=0)
    return bm, [M['foil-moving']]


def panel(p, M):
    """Пульт на стойке у края стола: тёмный корпус, экран и три кнопки на лицевой стороне (к оператору, +z) — корпус
    тоньше части на толщину кнопок: вся модель — в следе записи; стойка — на плите на столе."""
    w, d, h = p['w'], p['d'], p['h']
    face = d / 2 - 0.008
    bm = bmesh.new()
    lib.box(bm, w, d - 0.008, h, (0, 0, -0.004), mat=0, bevel=0.006)
    lib.box(bm, 0.26, 0.004, 0.19, (0.05, 0.02, face + 0.002), mat=1)
    for k in (-1, 0, 1):
        lib.cylinder(bm, 0.012, 0.012, 0.008, (-0.14, k * 0.07, face + 0.004), axis='z', sides=12, mat=2)
    top = _local(p, TOP)
    lib.box(bm, 0.04, 0.04, -h / 2 - top, (0, (top - h / 2) / 2, -0.004), mat=2, bevel=0.003, segments=1)
    lib.box(bm, 0.1, 0.1, 0.012, (0, top + 0.006, -0.004), mat=1, bevel=0.003, segments=1)
    return bm, [M['dark'], M['grey'], M['steel']]


# виды записей, которые строит этот скрипт, и построения их частей по именам
MACHINES = {'mach.blister'}
PARTS = {
    'body': body,
    'table': table,
    'wall': wall,
    'cover': cover,
    'forming': forming,
    'hopper': hopper,
    'feeder': feeder,
    'camera': camera,
    'sealing': sealing,
    'punching': punching,
    'film': film,
    'foil': foil,
    'panel': panel,
}
# детали — узлы износа записи внутри своей части
WEAR = {'sealplate': ('sealing', sealplate)}
