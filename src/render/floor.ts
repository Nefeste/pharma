// Слой «Загрузка и OEE» (Б1и; docs/specs/2026-10-vertical-slice.md, «Б1и»; docs/13-art.md, §11): столбики загрузки в
// помещениях и у машин линии с рамкой полной высоты, число над каждым (columns.ts) и доска «План — факт» в конце линии,
// по одной на линию, лицом к камере: сверху вертикальную доску не прочесть. Тени не отбрасывают; неосвещённые — цвет
// части тот же днём и ночью, какой проверен в четырёх видах зрения. Текстуры перерисовываются, только когда вид
// изменился. Где стоят столбики и что на них — src/app/floor.ts.
import * as THREE from 'three';
import { type Bar, barsOf, boardRows, colorOf, FLOOR, type Label, type Spots, spotsOf } from '../app/floor';
import type { ContentDb } from '../content/types';
import { HOUR } from '../engine/core/calendar';
import { clock, named, num, pctText, T } from '../i18n';
import type { FloorBoard, FloorView } from '../sim/floor';
import { canvasTex, Columns } from './columns';
import type { Layout } from './layout';

/** Над столбиком, м. */
const LABEL_GAP = 0.12;
/** Доска: точек на метр. */
const BOARD_PX = 320;
/** Частей на столбике — не больше шести (машина линии). */
const PARTS = 6;
/** Доска перерисовывается не чаще, мс: годные пачки часа меняются с каждым срезом; смена и час — сразу. */
const BOARD_MS = 500;

/** Число над столбиком словами: крупно — доля или OEE, мелко — что это. */
export function labelLines(l: Label): [string, string] {
  // без времени работы нет производительности, без выпуска — качества: прочерк, а не ноль (как в окне «Показатели»)
  const part = (x?: number) => (x === undefined ? T.floor.none : pctText(x));
  if (l.k === 'key') return [`OEE ${pctText(l.oee)}`, T.floor.apq(pctText(l.a), part(l.p), part(l.q))];
  const big = l.share === undefined ? T.floor.none : pctText(l.share);
  return [big, l.k === 'room' ? T.floor.work : T.floor.run];
}

interface BoardMesh {
  line: number;
  mesh: THREE.Mesh;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  key: string;
  /** что нарисовать, когда подойдёт срок, и с чем нарисовано — смена, начало, час */
  next?: FloorBoard;
  shape: string;
  at: number;
}

export class FloorLayer {
  readonly group = new THREE.Group();
  readonly spots: Spots;
  private cols: Columns;
  private boards: BoardMesh[] = [];
  private shown: Bar[] = [];

  constructor(
    private db: ContentDb,
    l: Layout,
    rooms: readonly string[],
    private lineName: (n: number) => string,
  ) {
    this.spots = spotsOf(db, l, rooms);
    this.cols = new Columns(this.spots.bars.length, PARTS, 'floor', FLOOR.digits, { spots: this.spots.bars, full: FLOOR.full });
    this.group.add(this.cols.group);
    for (const sp of this.spots.boards) {
      const bc = document.createElement('canvas');
      bc.width = FLOOR.board.w * BOARD_PX;
      bc.height = FLOOR.board.h * BOARD_PX;
      const tex = canvasTex(bc);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.board.w, FLOOR.board.h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      mesh.position.set(sp.x, FLOOR.board.y + FLOOR.board.h / 2, sp.z);
      mesh.name = `floor board ${sp.line}`;
      mesh.visible = false;
      this.group.add(mesh);
      this.boards.push({ line: sp.line, mesh, ctx: bc.getContext('2d')!, tex, key: '', shape: '', at: Number.NEGATIVE_INFINITY });
    }
    this.group.visible = false;
  }

  /** Столбики, числа и доски вида; `undefined` — вида ещё нет: пусто. */
  set(v: FloorView | undefined) {
    const bars = v ? barsOf(this.spots, v) : [];
    this.shown = bars;
    this.cols.set(bars.map(b => ({ n: b.n, x: b.x, z: b.z, side: b.side, parts: b.parts.map(p => ({ color: colorOf(p.part), y0: p.y0, h: p.h })), label: FLOOR.full + LABEL_GAP, lines: labelLines(b.label) })));
    for (const bm of this.boards) {
      const b = v?.lines.find(x => x.n === bm.line)?.board;
      bm.mesh.visible = !!b;
      if (!b) continue;
      const key = JSON.stringify(b);
      if (key === bm.key) continue;
      bm.key = key;
      bm.next = b;
    }
    this.drawBoards();
  }

  /** Доски, которым есть что рисовать: смена или час сменились — сразу, иначе — не чаще `BOARD_MS`. */
  private drawBoards() {
    const now = performance.now();
    for (const bm of this.boards) {
      const b = bm.next;
      if (!b) continue;
      const shape = `${b.shift}|${b.from}|${b.now ?? -1}|${b.to ?? -1}`;
      if (shape === bm.shape && now - bm.at < BOARD_MS) continue;
      bm.shape = shape;
      bm.at = now;
      bm.next = undefined;
      this.drawBoard(bm, b);
    }
  }

  /** Столбики, которые сейчас на полу, — для наведения и сценария в браузере. */
  get bars(): readonly Bar[] {
    return this.shown;
  }

  /** Сколько досок «План — факт» видно — для сценария в браузере. */
  get boardsShown(): number {
    return this.group.visible ? this.boards.filter(b => b.mesh.visible).length : 0;
  }

  setShown(on: boolean) {
    this.group.visible = on;
  }

  /** Каждый кадр: доски — лицом к камере; числа — цифрами высотой `FLOOR.digits`, с высоты участка — вдвое крупнее. */
  update(cam: THREE.Camera, site: number) {
    if (!this.group.visible) return;
    this.drawBoards();
    for (const bm of this.boards) bm.mesh.quaternion.copy(cam.quaternion);
    this.cols.update(site);
  }

  /** Доска «План — факт»: смена, по часам — план и годные; час ниже плана — выделен и отмечен; итог и ритмичность. */
  private drawBoard(bm: BoardMesh, b: FloorBoard) {
    const g = bm.ctx;
    const w = g.canvas.width;
    const h = g.canvas.height;
    g.fillStyle = '#f4f5f3';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#23292c';
    g.fillRect(0, 0, w, 78);
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = '700 30px system-ui, sans-serif';
    g.fillText(T.floor.board.title(this.lineName(bm.line)), 18, 26);
    g.font = '22px system-ui, sans-serif';
    g.fillStyle = '#c9d3d7';
    g.fillText(T.floor.board.shift(named(this.db.shifts[b.shift]?.name, b.shift), clock(b.from), clock(b.ends)), 18, 60);
    const rows = boardRows(b);
    const top = 86;
    const foot = 56;
    const rh = Math.min(34, (h - top - foot - 30) / Math.max(1, rows.length));
    const cols = [24, w * 0.52, w - 24];
    g.fillStyle = '#5a666c';
    g.font = '600 20px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(T.floor.board.hour, cols[0], top + 12);
    g.textAlign = 'right';
    g.fillText(T.floor.board.plan, cols[1], top + 12);
    g.fillText(T.floor.board.fact, cols[2], top + 12);
    const fs = Math.max(14, Math.min(24, Math.floor(rh * 0.72)));
    rows.forEach((r, i) => {
      const y = top + 30 + i * rh;
      if (r.now) {
        g.fillStyle = '#dce9f5';
        g.fillRect(8, y, w - 16, rh);
      } else if (r.low) {
        g.fillStyle = '#f8e1dc';
        g.fillRect(8, y, w - 16, rh);
      }
      const cy = y + rh / 2;
      g.font = `${fs}px system-ui, sans-serif`;
      g.fillStyle = '#23292c';
      g.textAlign = 'left';
      g.fillText(T.floor.board.span(clock(r.from).slice(0, 2), clock(r.from + HOUR).slice(0, 2)), cols[0], cy);
      g.textAlign = 'right';
      g.fillText(num(r.plan), cols[1], cy);
      if (r.fact !== undefined) {
        g.font = `${r.low ? 700 : 400} ${fs}px system-ui, sans-serif`;
        g.fillStyle = r.low ? '#a3261b' : '#23292c';
        g.fillText(r.now ? `${num(r.fact)}…` : r.low ? `▼ ${num(r.fact)}` : num(r.fact), cols[2], cy);
      }
    });
    g.fillStyle = '#23292c';
    g.fillRect(0, h - foot, w, 2);
    g.textAlign = 'left';
    g.font = '700 24px system-ui, sans-serif';
    g.fillText(b.plan > 0 ? T.floor.board.total(num(b.fact), num(b.plan)) : T.floor.board.noPlan(num(b.fact)), 18, h - foot / 2);
    if (b.rhythm !== undefined) {
      g.textAlign = 'right';
      g.font = '24px system-ui, sans-serif';
      g.fillText(T.floor.board.rhythm(pctText(b.rhythm)), w - 18, h - foot / 2);
    }
    bm.tex.needsUpdate = true;
  }
}
