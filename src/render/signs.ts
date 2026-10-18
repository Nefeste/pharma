// Таблички помещений производства (docs/specs/2026-10-view.md, 2а; docs/13-art.md, §8; docs/10-domain.md, §4: GMP ЕАЭС,
// ч. I, пп. 5.12, 5.13, 5.21): у двери со стороны коридора — статус чистоты значком, словом и цветом, под ним серия, стадия
// и продукт. С высоты цеха читаются цвет и значок, вблизи — надписи. Табличка срезается вместе со стеной. Каждая — своя
// маленькая текстура: их десяток, перерисовка — только когда статус или серия сменились.
import * as THREE from 'three';
import type { ContentDb } from '../content/types';
import { CELL } from '../engine/nav';
import { named, T } from '../i18n';
import type { RoomRow } from '../sim/pack';
import type { Layout } from './layout';
import { cutAt, type Walls, WALL_T } from './world';

/** Помещения с табличкой: где идут стадии, хранится балк, упаковывают, отбирают пробы и моют. */
const SIGNED = new Set(['sampling', 'dispensing', 'granulation', 'blending', 'compression', 'washing', 'bulk', 'packaging']);

/**
 * Цвет статуса чистоты: чисто — зелёный, занято — синий, грязно — янтарный; рядом всегда значок и слово. Пары различимы и
 * в имитации трёх видов цветовой слепоты (геймдизайн, §23; tools/test/palette.test.ts).
 */
export const ROOM_COLOR = { clean: 0x3d8b57, busy: 0x27457a, dirty: 0xb3812a } as const;
const COLOR = Object.fromEntries(Object.entries(ROOM_COLOR).map(([k, v]) => [k, `#${v.toString(16).padStart(6, '0')}`])) as Record<keyof typeof ROOM_COLOR, string>;

const W = 0.42;
const H = 0.3;
const PX = 256;

interface Sign {
  room: number;
  mesh: THREE.Mesh;
  tex: THREE.CanvasTexture;
  ctx: CanvasRenderingContext2D;
  key: string;
  at: { x: number; z: number; ox: number; oz: number };
}

/** Где висит табличка: на стене у двери помещения в коридор, со стороны коридора, справа от проёма (или слева). */
export function signSpot(l: Layout, room: number): { x: number; z: number; nx: number; nz: number } | undefined {
  const door = l.doors.find(d => d.rooms.includes(room) && d.kind !== 'hatch' && d.rooms.some(r => r >= 0 && r !== room && l.rooms[r].type.startsWith('corridor')));
  if (!door) return undefined;
  const side = door.rooms[0] === room ? 1 : -1;
  const [x0, z0] = door.cells[0];
  const [x1, z1] = door.cells[door.cells.length - 1];
  const off = WALL_T / 2 + 0.012;
  if (door.along === 'x') {
    const free = (x: number) => x >= 0 && x < l.w && l.nav.cells[z0 * l.w + x] === CELL.wall;
    const x = free(x1 + 1) ? x1 + 1.5 : x0 - 0.5;
    return { x, z: z0 + 0.5 + side * off, nx: 0, nz: side };
  }
  const free = (z: number) => z >= 0 && z < l.h && l.nav.cells[z * l.w + x0] === CELL.wall;
  const z = free(z1 + 1) ? z1 + 1.5 : z0 - 0.5;
  return { x: x0 + 0.5 + side * off, z, nx: side, nz: 0 };
}

export class Signs {
  readonly group = new THREE.Group();
  private signs: Sign[] = [];

  constructor(
    private l: Layout,
    private db: ContentDb,
  ) {
    l.rooms.forEach((r, i) => {
      if (!SIGNED.has(r.type)) return;
      const spot = signSpot(l, i);
      if (!spot) return;
      const c = document.createElement('canvas');
      c.width = PX;
      c.height = Math.round((PX * H) / W);
      const ctx = c.getContext('2d')!;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
      mesh.position.set(spot.x, 1.6, spot.z);
      mesh.rotation.y = Math.atan2(spot.nx, spot.nz);
      mesh.name = `sign ${r.id}`;
      this.group.add(mesh);
      this.signs.push({ room: i, mesh, tex, ctx, key: '', at: { x: spot.x, z: spot.z, ox: spot.nx, oz: spot.nz } });
    });
  }

  /** Новые статусы помещений из среза: перерисовать только сменившиеся таблички. */
  set(rows: readonly RoomRow[]) {
    const byRoom = new Map(rows.map(r => [r.room, r]));
    for (const s of this.signs) {
      const r = byRoom.get(s.room);
      const status = r?.status ?? 'clean';
      const key = `${status}|${r?.batch ?? -1}|${r?.recipe ?? -1}|${r?.stage ?? -1}`;
      if (key === s.key) continue;
      s.key = key;
      this.draw(s, status, r);
    }
  }

  private draw(s: Sign, status: RoomRow['status'], r: RoomRow | undefined) {
    const g = s.ctx;
    const w = g.canvas.width;
    const h = g.canvas.height;
    g.fillStyle = '#f4f5f3';
    g.fillRect(0, 0, w, h);
    g.fillStyle = COLOR[status];
    g.fillRect(0, 0, w, h * 0.46);
    // значок: галочка, треугольник «идёт», крест «убрать»
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    g.lineWidth = 9;
    g.lineCap = 'round';
    const cy = h * 0.23;
    g.beginPath();
    if (status === 'clean') {
      g.moveTo(22, cy);
      g.lineTo(38, cy + 16);
      g.lineTo(64, cy - 16);
      g.stroke();
    } else if (status === 'busy') {
      g.moveTo(26, cy - 20);
      g.lineTo(62, cy);
      g.lineTo(26, cy + 20);
      g.closePath();
      g.fill();
    } else {
      g.moveTo(26, cy - 18);
      g.lineTo(60, cy + 18);
      g.moveTo(60, cy - 18);
      g.lineTo(26, cy + 18);
      g.stroke();
    }
    g.font = '600 44px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(T.room.status[status], 80, cy + 2);
    g.fillStyle = '#23292c';
    g.font = '600 26px system-ui, sans-serif';
    if (r && r.batch >= 0) {
      const code = String(r.batch).padStart(6, '0');
      const recipe = Object.values(this.db.recipes)[r.recipe];
      const stage = recipe && r.stage >= 0 ? recipe.stages[r.stage] : undefined;
      g.fillText(`${T.room.batch(code)}${stage ? ` · ${T.stages[stage.id] ?? stage.id}` : ''}`, 14, h * 0.62);
      g.font = '22px system-ui, sans-serif';
      if (recipe) g.fillText(named(this.db.products[recipe.product]?.name), 14, h * 0.84);
    }
    s.tex.needsUpdate = true;
  }

  /** Срезать вместе со стенами; издалека таблички не видны. */
  update(walls: Walls['uniforms'], half: number) {
    for (const s of this.signs) s.mesh.visible = half < 26 && cutAt(walls, s.at.x, s.at.z, 0, 0) < 0.5;
  }
}
