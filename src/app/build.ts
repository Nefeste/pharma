// Стройка в окне (Б7б; docs/specs/2026-10-vertical-slice.md, «Б7б», «Окно»): инструменты, призрак, подписи помещений и
// команды движку. Устройство — как у стройки «Больницы» (`Nefeste/bolnitsa` @ e804637, src/app/build.ts): призрак
// проверяется той же чистой функцией правки плана, что и команда движка (src/engine/site/edit.ts, `editPlan`), над тем
// планом, что прислал поток расчёта, — что призрак пустил, команда примет, и наоборот; цена с НДС и проверка кассы — как у
// команды (src/engine/build.ts). Подписи помещений — те же проверки планировки и состояние стройки из вида потока
// (src/sim/build.ts). Команда уходит в поток (`site`), ответ — извещением и новым планом.
import type { BuildPrices, ContentDb, Plant } from '../content/types';
import { part } from '../engine/cash';
import { CELL, CELL_CM } from '../engine/nav';
import { planOf, RACK } from '../engine/plant';
import { levelOf, redRoom, type SiteError, type SiteThing } from '../engine/site/checks';
import { type BuildDoor, type BuildError, type BuildOp, DOOR_LEN, doorId, editPlan, errorsOf, thingRoom } from '../engine/site/edit';
import type { Notice, SitePlan, SiteRefusal } from '../engine/types';
import { money, named, T } from '../i18n';
import { GHOST_BAD, GHOST_OK, GHOST_WARN, type GhostRect, type Ghosts } from '../render/ghost';
import type { WallMode } from '../render/world';
import type { BuildView } from '../sim/build';
import { type BuildHud, type BuildPick, PICK } from './buildpick';

export type Cell = [number, number];
export { BUILD_DOORS, BUILD_TOOLS, type BuildHud, type BuildPick, type BuildTool, NO_BUILD, PICK } from './buildpick';

/** Прямоугольник по двум углам — клетки включительно. */
export const rectOf = (a: Cell, b: Cell): [number, number, number, number] => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]) + 1, Math.abs(a[1] - b[1]) + 1];

/** Помещение словами: тип каталога и номер у построенного стройкой — «Общий коридор 2» у `corridor-2`. */
export function roomName(plan: Plant, id: string): string {
  const r = plan.rooms.find(x => x.id === id);
  if (!r) return id;
  const base = T.roomTypes[r.type] ?? r.type;
  const n = id.startsWith(`${r.type}-`) ? id.slice(r.type.length + 1) : '';
  return n !== '' && Number.isInteger(Number(n)) ? `${base} ${n}` : base;
}

/** Вещь плана словами: помещение, зона, ряд стеллажа; остальное — как есть. */
export function thingName(plan: Plant, id: string): string {
  if (plan.rooms.some(r => r.id === id)) return roomName(plan, id);
  const z = plan.zones.find(x => x.id === id);
  if (z) return `${T.zones[z.kind] ?? z.kind} (${z.id})`;
  if (plan.racks.some(r => r.id === id)) return T.build.ghost.rackName(id);
  return id;
}

/** До чего не дойти — словами. */
function reachText(db: ContentDb, plan: Plant, w: SiteThing): string {
  if (w.kind === 'room') return roomName(plan, w.id);
  if (w.kind === 'slot') return T.build.thing.slot(w.id);
  if (w.kind === 'post') return T.build.thing.post(named(db.roles[w.id]?.name, w.id));
  return T.build.thing.dock(w.id);
}

/** Ошибка планировки словами игрока. */
export function siteText(db: ContentDb, plan: Plant, e: SiteError): string {
  const t = T.build.site;
  switch (e.code) {
    case 'small':
      return t.small(e.min[0], e.min[1]);
    case 'walk':
      return `${t.walk}: ${reachText(db, plan, e.what)}`;
    case 'drive':
      return `${t.drive}: ${reachText(db, plan, e.what)}`;
    default:
      return t[e.code];
  }
}

/** Почему правку не приняли — словами. */
export function whyText(db: ContentDb, plan: Plant, e: BuildError | SiteRefusal): string {
  const w = T.build.why;
  switch (e.code) {
    case 'site':
      return siteText(db, plan, e.error);
    case 'cutsOff':
      return w.cutsOff(reachText(db, plan, e.what));
    case 'doorLen':
      return w.doorLen(e.len[0], e.len[1]);
    case 'hasThings':
      return w.hasThings(e.thing);
    case 'money':
      return w.money(money(e.need));
    case 'inUse':
      return w.inUse(thingName(plan, e.thing));
    case 'leaving':
      return w.leaving(thingName(plan, e.thing));
    default:
      return w[e.code];
  }
}

const isOpen = (c: number) => c === CELL.floor || c === CELL.corridor;

/** Что снести под клеткой: дверь, ряд стеллажа, зона, помещение — по порядку; ничего — `undefined`. */
export function targetAt(db: ContentDb, plan: Plant, cell: Cell): Extract<BuildOp, { op: 'demolish' }> | undefined {
  const nav = planOf(db, plan).nav;
  const [x, z] = cell;
  if (x < 0 || z < 0 || x >= nav.w || z >= nav.h) return undefined;
  const i = z * nav.w + x;
  if (nav.door[i] >= 0) return { op: 'demolish', what: 'door', id: doorId(plan.doors[nav.door[i]]) };
  const cx = x * CELL_CM + CELL_CM / 2;
  const cz = z * CELL_CM + CELL_CM / 2;
  const rack = plan.racks.find(r => cx >= r.x && cx < r.x + r.bays * RACK.bay && cz >= r.z && cz < r.z + RACK.depth);
  if (rack) return { op: 'demolish', what: 'rack', id: rack.id };
  const zone = plan.zones.find(q => cx >= q.rect[0] && cx < q.rect[0] + q.rect[2] && cz >= q.rect[1] && cz < q.rect[1] + q.rect[3]);
  if (zone) return { op: 'demolish', what: 'zone', id: zone.id };
  const room = nav.room[i];
  return room >= 0 ? { op: 'demolish', what: 'room', id: plan.rooms[room].id } : undefined;
}

/**
 * Дверь в стене под клеткой: ось — вдоль стены (по обе стороны клетки пол — стена поперёк этой пары), R — поперёк;
 * длина — наименьшая у вида, у ворот — выбранная.
 */
export function doorAt(db: ContentDb, plan: Plant, cell: Cell, pick: BuildPick): Extract<BuildOp, { op: 'door' }> {
  const nav = planOf(db, plan).nav;
  const [x, z] = cell;
  const at = (cx: number, cz: number) => (cx < 0 || cz < 0 || cx >= nav.w || cz >= nav.h ? CELL.outside : nav.cells[cz * nav.w + cx]);
  const across = isOpen(at(x - 1, z)) && isOpen(at(x + 1, z));
  let along: 'x' | 'z' = across ? 'z' : 'x';
  if (pick.turn) along = along === 'x' ? 'z' : 'x';
  const len = pick.door === 'gate' ? pick.gate : DOOR_LEN[pick.door][0];
  return { op: 'door', cell: [x, z], len, along, kind: pick.door, ...(pick.materials ? { materials: true as const } : {}) };
}

/** Правка под курсором: инструмент, выбор, клетка и начало протяжки; нечего — `undefined`. */
export function opAt(db: ContentDb, plan: Plant, pick: BuildPick, cell: Cell, drag?: Cell): BuildOp | undefined {
  switch (pick.tool) {
    case 'room':
      return pick.type && drag ? { op: 'room', type: pick.type, grade: pick.grade, rect: rectOf(drag, cell), ...(pick.vehicles ? { vehicles: true } : {}) } : undefined;
    case 'hull':
      return drag ? { op: 'hull', rect: rectOf(drag, cell) } : undefined;
    case 'zone':
      return drag ? { op: 'zone', kind: pick.zone, rect: rectOf(drag, cell) } : undefined;
    case 'door':
      return doorAt(db, plan, cell, pick);
    case 'rack':
      return { op: 'rack', x: cell[0], z: cell[1], bays: pick.bays, levels: pick.levels, face: pick.face };
    case 'vehicles': {
      const t = targetAt(db, plan, cell);
      const room = t?.what === 'room' ? plan.rooms.find(r => r.id === t.id) : undefined;
      return room ? { op: 'vehicles', room: room.id, on: !room.vehicles } : undefined;
    }
    case 'demolish':
      return targetAt(db, plan, cell);
    default:
      return undefined;
  }
}

/** Клетки прямоугольника записи плана (см). */
const cellsOfCm = (r: readonly [number, number, number, number]): Cell[] => {
  const out: Cell[] = [];
  for (let z = Math.floor(r[1] / CELL_CM); z < Math.ceil((r[1] + r[3]) / CELL_CM); z++) for (let x = Math.floor(r[0] / CELL_CM); x < Math.ceil((r[0] + r[2]) / CELL_CM); x++) out.push([x, z]);
  return out;
};
const cellsOf = (r: readonly [number, number, number, number]): Cell[] => cellsOfCm([r[0] * CELL_CM, r[1] * CELL_CM, r[2] * CELL_CM, r[3] * CELL_CM]);
const doorCells = (d: { cell: [number, number]; len: number; along: 'x' | 'z' }): Cell[] => Array.from({ length: d.len }, (_, k) => (d.along === 'x' ? [d.cell[0] + k, d.cell[1]] : [d.cell[0], d.cell[1] + k]));

/** Что правка показывает призраком: прямоугольник со стенами, дверь или клетки на полу. */
export function shapeOf(plan: Plant, op: BuildOp): { rect?: GhostRect; door?: { cells: Cell[]; along: 'x' | 'z' }; cells?: Cell[] } {
  switch (op.op) {
    case 'room':
    case 'hull':
      return { rect: { x: op.rect[0], z: op.rect[1], w: op.rect[2], d: op.rect[3] } };
    case 'door':
      return { door: { cells: doorCells(op), along: op.along } };
    case 'zone':
      return { cells: cellsOf(op.rect) };
    case 'rack':
      return { cells: cellsOfCm([op.x * CELL_CM, op.z * CELL_CM, op.bays * RACK.bay, RACK.depth]) };
    case 'vehicles': {
      const r = plan.rooms.find(x => x.id === op.room);
      return { cells: r ? cellsOfCm(r.rect) : [] };
    }
    case 'demolish': {
      if (op.what === 'door') {
        const d = plan.doors.find(x => doorId(x) === op.id);
        return { cells: d ? doorCells(d) : [] };
      }
      if (op.what === 'room') {
        const r = plan.rooms.find(x => x.id === op.id);
        return { cells: r ? cellsOfCm(r.rect) : [] };
      }
      if (op.what === 'zone') {
        const q = plan.zones.find(x => x.id === op.id);
        return { cells: q ? cellsOfCm(q.rect) : [] };
      }
      const k = plan.racks.find(x => x.id === op.id);
      return { cells: k ? cellsOfCm([k.x, k.z, k.bays * RACK.bay, RACK.depth]) : [] };
    }
  }
}

/** Что правка делает — словами, без цены. */
function whatOf(db: ContentDb, plan: Plant, op: BuildOp): string {
  const g = T.build.ghost;
  switch (op.op) {
    case 'room':
      return `${T.roomTypes[op.type] ?? op.type} ${op.rect[2]} × ${op.rect[3]} ${T.units.m}`;
    case 'hull':
      return g.hullName(op.rect[2], op.rect[3]);
    case 'door':
      return T.build.doors[op.kind];
    case 'zone':
      return g.zoneName(T.zones[op.kind] ?? op.kind, op.rect[2], op.rect[3]);
    case 'rack':
      return g.rackSize(op.bays, op.levels);
    case 'vehicles':
      return g.vehicles(roomName(plan, op.room), op.on);
    case 'demolish':
      return op.what === 'door' ? T.build.doors[(plan.doors.find(d => doorId(d) === op.id)?.kind ?? 'door') as BuildDoor] ?? op.id : thingName(plan, op.id);
  }
}

/** Призрак правки: можно ли, есть ли «не будет работать» или замечание, строка — что, цена с НДС или почему нельзя. */
export interface GhostText {
  ok: boolean;
  warn: boolean;
  text: string;
  /** цена с НДС; у сноса — минус возврат */
  cost: number;
}

/**
 * Призрак — та же правка, что сделает движок (`editPlan`), над планом от потока: нельзя — почему; можно — цена с НДС, а
 * не хватит денег до края кредитной линии — «нельзя: не хватит»; снос занятого — «когда освободится»; правка даёт новую
 * красную ошибку — «не будет работать», жёлтую — «замечание».
 */
export function ghostOf(db: ContentDb, b: BuildPrices, vat: number, plan: SitePlan, view: BuildView | undefined, op: BuildOp): GhostText {
  const g = T.build.ghost;
  const what = whatOf(db, plan, op);
  const r = editPlan(db, b, plan, op, view?.next ?? {});
  if (!r.ok) return { ok: false, warn: false, text: g.no(what, whyText(db, plan, r.error)), cost: 0 };
  const cost = r.cost + part(r.cost, vat) - r.refund - part(r.refund, vat);
  if (view && cost > 0 && view.cash - cost < view.floor) return { ok: false, warn: false, text: g.no(what, T.build.why.money(money(cost - (view.cash - view.floor)))), cost };
  if (op.op === 'demolish' && op.what !== 'door' && view?.busy.includes(op.id)) return { ok: true, warn: true, text: g.later(what), cost: 0 };
  const priced = op.op === 'demolish' ? g.demolish(what, money(-cost)) : op.op === 'zone' ? g.zone(what, r.plan.zones.at(-1)!.grid[0] * r.plan.zones.at(-1)!.grid[1]) : op.op === 'vehicles' ? what : g.priced(what, money(cost));
  const had = new Set(errorsOf(db, plan).map(e => JSON.stringify(e)));
  const fresh = errorsOf(db, r.plan).filter(e => !had.has(JSON.stringify(e)));
  const red = fresh.find(e => levelOf(e) === 'red');
  if (red) return { ok: true, warn: true, text: g.red(priced, siteText(db, r.plan, red)), cost };
  const yellow = fresh.find(e => levelOf(e) === 'yellow');
  if (yellow) return { ok: true, warn: true, text: g.yellow(priced, siteText(db, r.plan, yellow)), cost };
  return { ok: true, warn: false, text: priced, cost };
}

/** Подпись помещения в стройке: середина на плане, имя, состояние; работает ли. */
export interface LabelRow {
  id: string;
  x: number;
  z: number;
  name: string;
  state: string;
  ok: boolean;
}

/**
 * Подписи помещений: не работает — первая красная ошибка его плана; закрыто на перестройку; сносится; замечание — первая
 * жёлтая; иначе — «работает».
 */
export function labelRows(db: ContentDb, plan: Plant, view: BuildView | undefined): LabelRow[] {
  const errs = errorsOf(db, plan);
  const red = new Map<string, SiteError>();
  const yellow = new Map<string, SiteError>();
  for (const e of errs) {
    const lv = levelOf(e);
    if (lv === 'red') {
      const r = redRoom(e);
      if (r !== undefined && !red.has(r)) red.set(r, e);
    } else if (lv === 'yellow') {
      const r = e.code === 'rejectedShared' ? plan.rooms[thingRoom(db, plan, 'zone', e.zone)]?.id : 'room' in e ? e.room : undefined;
      if (r !== undefined && !yellow.has(r)) yellow.set(r, e);
    }
  }
  const leaving = new Set((view?.leaving ?? []).filter(l => l.what === 'room').map(l => l.id));
  const s = T.build.state;
  return plan.rooms.map(r => {
    const e = red.get(r.id);
    const y = yellow.get(r.id);
    const state = e ? s.down(siteText(db, plan, e)) : view?.editing === r.id ? s.editing : leaving.has(r.id) ? s.leaving : y ? s.remark(siteText(db, plan, y)) : s.works;
    return { id: r.id, x: (r.rect[0] + r.rect[2] / 2) / CELL_CM, z: (r.rect[1] + r.rect[3] / 2) / CELL_CM, name: roomName(plan, r.id), state, ok: !e && view?.editing !== r.id && !leaving.has(r.id) };
  });
}

/** Ответ движка на стройку — строкой под инструментами. */
export function resultText(db: ContentDb, plan: Plant, n: Extract<Notice, { kind: 'site' }>): { ok: boolean; text: string } {
  const r = T.build.result;
  if (!n.ok) return { ok: false, text: r.no(whyText(db, plan, n.error)) };
  if (n.later) return { ok: true, text: r.later };
  if (n.op === 'undo') return { ok: true, text: r.undone(money(-n.cost, true)) };
  if (n.op === 'done') return { ok: true, text: r.done };
  return { ok: true, text: n.cost < 0 ? r.back(money(-n.cost)) : r.ok(money(n.cost)) };
}

/** Что инструменту нужно от игры: база, план от потока, цены, призраки, стены, команда в поток. */
export interface BuildHost {
  readonly db: ContentDb;
  plan(): SitePlan;
  prices(): BuildPrices | undefined;
  vat(): number;
  ghosts(): Ghosts;
  walls(mode?: WallMode): WallMode;
  send(op: BuildOp | { op: 'done' } | { op: 'undo' }): void;
}

export class Builder {
  on = false;
  pick: BuildPick = { ...PICK };
  hover?: Cell;
  drag?: Cell;
  view?: BuildView;
  ghost?: GhostText;
  result?: { ok: boolean; text: string };
  private walls?: WallMode;

  constructor(private g: BuildHost) {}

  hud(): BuildHud {
    return {
      on: this.on,
      pick: this.pick,
      ...(this.ghost ? { ghost: { ok: this.ghost.ok, warn: this.ghost.warn, text: this.ghost.text } } : {}),
      ...(this.result ? { result: this.result } : {}),
      undo: this.view?.undo ?? 0,
      spent: this.view?.spent ?? 0,
      ...(this.view?.editing !== undefined ? { editing: this.view.editing } : {}),
    };
  }

  /** B: стройка — стены вниз, план виден целиком; выход — «Готово» перестраиваемому и стены, какими были. */
  toggle() {
    this.on = !this.on;
    this.drag = undefined;
    this.result = undefined;
    if (this.on) {
      this.walls = this.g.walls();
      this.g.walls('down');
    } else {
      this.g.send({ op: 'done' });
      if (this.walls) this.g.walls(this.walls);
    }
    this.update();
  }

  /** Выбор в панели: инструмент, тип, класс, вид двери, зона, ряд. Сменили инструмент — протяжки нет. */
  set(patch: Partial<BuildPick>) {
    if (!this.on) this.toggle();
    if (patch.tool !== undefined && patch.tool !== this.pick.tool) this.drag = undefined;
    const next = { ...this.pick, ...patch };
    // класс — из тех, что типу можно: первый по каталогу
    if (patch.type !== undefined) {
      const t = this.g.db.rooms[patch.type];
      if (t && !t.grades.includes(next.grade)) next.grade = t.grades[0];
      if (t && !t.vehicles) next.vehicles = false;
    }
    this.pick = next;
    this.update();
  }

  /** Esc и правая кнопка: протяжка, затем инструмент, затем стройка. Отдаёт, отменилось ли что-то. */
  cancel(): boolean {
    if (!this.on) return false;
    if (this.drag) this.drag = undefined;
    else if (this.pick.tool) this.pick = { ...this.pick, tool: undefined };
    else this.toggle();
    this.update();
    return true;
  }

  /** R: дверь — поперёк, ряд стеллажа — проходом на другую сторону. */
  rotate() {
    if (!this.on) return;
    if (this.pick.tool === 'rack') this.pick = { ...this.pick, face: this.pick.face === 'n' ? 's' : 'n' };
    else this.pick = { ...this.pick, turn: !this.pick.turn };
    this.update();
  }

  move(cell: Cell | undefined) {
    this.hover = cell;
    this.update();
  }

  /** Левая кнопка нажата: прямоугольник — протянуть; остальное — правка сразу, если призрак её пускает. */
  down(cell: Cell | undefined) {
    if (!this.on || !cell) return;
    const t = this.pick.tool;
    if (t === 'room' || t === 'hull' || t === 'zone') {
      if (t !== 'room' || this.pick.type) this.drag = cell;
    } else this.commit(cell);
    this.update();
  }

  /** Левая кнопка отпущена: протянутое — правкой. */
  up(cell: Cell | undefined) {
    if (!this.on || !this.drag) return;
    this.commit(cell ?? this.hover ?? this.drag, this.drag);
    this.drag = undefined;
    this.update();
  }

  private commit(cell: Cell, drag?: Cell) {
    const b = this.g.prices();
    if (!b) return;
    const plan = this.g.plan();
    const op = opAt(this.g.db, plan, this.pick, cell, drag);
    if (!op) return;
    // что призрак не пустил, движок не примет: команда — только с правкой, которую пускает та же функция; денег не хватит —
    // ответит движок
    if (editPlan(this.g.db, b, plan, op, this.view?.next ?? {}).ok) this.g.send(op);
  }

  /** Ответ движка на правку. */
  onResult(n: Extract<Notice, { kind: 'site' }>) {
    if (n.op === 'done' && n.ok) return;
    this.result = resultText(this.g.db, this.g.plan(), n);
  }

  /** Вид стройки из потока: шаги отмены, перестраиваемое, сносимое, занятое, касса. */
  setView(v: BuildView) {
    this.view = v;
    this.update();
  }

  /** План новый — призрак проверяется заново. */
  refresh() {
    this.update();
  }

  /** Призрак и строка под инструментами — по инструменту и клетке под курсором. */
  update() {
    const gh = this.g.ghosts();
    gh.clear();
    this.ghost = undefined;
    const b = this.g.prices();
    if (!this.on || !b) return;
    const cell = this.hover;
    const t = this.pick.tool;
    if (!t || !cell) {
      this.ghost = { ok: true, warn: false, text: T.build.hint[t ?? 'none'], cost: 0 };
      if (cell) gh.cells([cell], GHOST_OK);
      return;
    }
    const plan = this.g.plan();
    const op = opAt(this.g.db, plan, this.pick, cell, this.drag);
    if (!op) {
      gh.cells([cell], GHOST_OK);
      this.ghost = { ok: true, warn: false, text: T.build.hint[t], cost: 0 };
      return;
    }
    const g = ghostOf(this.g.db, b, this.g.vat(), plan, this.view, op);
    this.ghost = g;
    const color = !g.ok ? GHOST_BAD : op.op === 'demolish' ? GHOST_BAD : g.warn ? GHOST_WARN : GHOST_OK;
    const shape = shapeOf(plan, op);
    if (shape.rect) gh.rect(shape.rect, color);
    if (shape.door) gh.door(shape.door.cells, shape.door.along, color);
    if (shape.cells) gh.cells(shape.cells, color);
  }

  /** Подписи помещений — в стройке. */
  labels(): LabelRow[] {
    return labelRows(this.g.db, this.g.plan(), this.view);
  }
}
