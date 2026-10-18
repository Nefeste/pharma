// из bolnitsa: src/render/textures.ts @ e0a3491 — изменено: полы завода (наливной пол склада и чистых зон, линолеум, плитка
// коридора, пол лаборатории) вместо полов больницы; двор — асфальт, плитка, газон.
// Материалы пола и земли — нарисованы кодом в 2D-холст (своё, без чужих текстур). Повтор по миру: один период текстуры —
// `meters` метров. Палитра — приглушённая, чтобы цвета статусов читались поверх неё (docs/13-art.md, §5).
import * as THREE from 'three';
import { rng } from './rng';

export type FloorKind = 'concrete' | 'epoxy' | 'lab' | 'linoleum' | 'corridor' | 'grass' | 'asphalt' | 'paving';

export interface FloorTex {
  texture: THREE.Texture;
  meters: number;
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function speckle(g: CanvasRenderingContext2D, size: number, n: number, colors: string[], seed: number, r = 1.2) {
  const rnd = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    g.globalAlpha = 0.25 + rnd() * 0.35;
    g.beginPath();
    g.arc(rnd() * size, rnd() * size, r * (0.5 + rnd()), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function tiles(g: CanvasRenderingContext2D, size: number, count: number, base: string, alt: string | null, grout: string, seed: number) {
  const step = size / count;
  const rnd = rng(seed);
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      g.fillStyle = alt && (x + y) % 2 ? alt : base;
      g.fillRect(x * step, y * step, step, step);
      // лёгкий разнобой плиток
      g.fillStyle = `rgba(0,0,0,${rnd() * 0.035})`;
      g.fillRect(x * step, y * step, step, step);
    }
  }
  g.strokeStyle = grout;
  g.lineWidth = Math.max(1.5, size / 256);
  for (let i = 0; i <= count; i++) {
    g.beginPath();
    g.moveTo(i * step, 0);
    g.lineTo(i * step, size);
    g.moveTo(0, i * step);
    g.lineTo(size, i * step);
    g.stroke();
  }
}

export function makeFloor(kind: FloorKind, anisotropy: number): FloorTex {
  const S = 512;
  const [c, g] = canvas(S);
  let meters = 2;
  switch (kind) {
    case 'concrete':
      // наливной пол склада: светло-серый, ровный, с еле заметным крапом и швами усадки через 6 м
      g.fillStyle = '#a3a8aa';
      g.fillRect(0, 0, S, S);
      speckle(g, S, 3500, ['#959a9c', '#b2b6b8', '#8c9193'], 21, 1.2);
      g.strokeStyle = 'rgba(70,74,76,0.35)';
      g.lineWidth = 2;
      g.strokeRect(1, 1, S - 2, S - 2);
      meters = 6;
      break;
    case 'epoxy':
      // чистая зона: светлый бесшовный полимерный пол
      g.fillStyle = '#dfe5e4';
      g.fillRect(0, 0, S, S);
      speckle(g, S, 1500, ['#d2d9d8', '#eef2f1'], 22, 1);
      meters = 3;
      break;
    case 'lab':
      tiles(g, S, 8, '#eef0ef', null, '#cdd3d3', 23);
      meters = 2;
      break;
    case 'linoleum':
      g.fillStyle = '#c9c3b6';
      g.fillRect(0, 0, S, S);
      speckle(g, S, 2500, ['#b8b2a5', '#ddd8cc', '#a9a396'], 24, 1.4);
      meters = 3;
      break;
    case 'corridor':
      tiles(g, S, 4, '#e3e0d8', null, '#c3beb2', 1);
      speckle(g, S, 900, ['#b9b2a3', '#f2efe8'], 2);
      meters = 2;
      break;
    case 'paving': {
      // плитка двора: прямоугольные камни вразбежку
      g.fillStyle = '#9da3a2';
      g.fillRect(0, 0, S, S);
      const rows = 8;
      const h = S / rows;
      const rnd = rng(14);
      for (let y = 0; y < rows; y++) {
        const off = (y % 2) * h;
        for (let x = -off; x < S; x += h * 2) {
          const l = 58 + rnd() * 8;
          g.fillStyle = `hsl(200, 4%, ${l}%)`;
          g.fillRect(x + 2, y * h + 2, h * 2 - 4, h - 4);
        }
      }
      speckle(g, S, 1500, ['#8a908f', '#b5bbba'], 15, 1);
      meters = 2;
      break;
    }
    case 'grass':
      g.fillStyle = '#7f9b5c';
      g.fillRect(0, 0, S, S);
      speckle(g, S, 6000, ['#6b8a4b', '#93ad6c', '#5f7d43', '#a3b878'], 10, 2);
      meters = 6;
      break;
    case 'asphalt':
      g.fillStyle = '#7d8183';
      g.fillRect(0, 0, S, S);
      speckle(g, S, 5000, ['#6b6f71', '#929698', '#5f6365'], 11, 1.3);
      meters = 4;
      break;
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return { texture: t, meters };
}
