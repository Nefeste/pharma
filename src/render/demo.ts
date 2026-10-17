// Показательный склад части 0 (docs/specs/2026-10-prototype.md, часть 0): три ряда стеллажей, зона карантина на полу и
// паллеты всех видов груза со всеми статусами. Движок о нём не знает — это проверка отрисовки до части 2, где склад
// придёт из среза. Случайность — своя, из зерна (rng.ts): сцена одинакова на любой машине, снимки сравнимы.
import { BAY, type Load, type PalletView, type RackRow, slotsOf, type Tag } from './loads';
import { rng } from './rng';

export interface DemoWarehouse {
  racks: RackRow[];
  lanes: [number, number, number, number][];
  pallets: PalletView[];
}

export function demoWarehouse(w: number, h: number): DemoWarehouse {
  const r = rng(20271001);
  const x0 = 6;
  const rows = 3;
  const bays = 6;
  // ряды стеллажей через проезд ричтрака в 3 м
  const racks: RackRow[] = Array.from({ length: rows }, (_, i) => ({ x: x0, z: 6 + i * (BAY.d * 2 + 3), bays, levels: 4 }));
  const lanes: [number, number, number, number][] = [
    // проезд вдоль фронта стеллажей и зона карантина у ворот
    [x0 - 1, 4, bays * BAY.w + 2, rows * (BAY.d * 2 + 3)],
    [x0 + bays * BAY.w + 4, 6, 10, 8],
  ];
  const loads: Load[] = ['cases', 'drums', 'bags', 'rolls'];
  const full: Record<Load, number> = { cases: 40, drums: 4, bags: 32, rolls: 24 };
  const pallets: PalletView[] = [];
  for (const s of slotsOf(racks)) {
    if (r() < 0.18) continue; // пустые места
    const load = loads[Math.floor(r() * loads.length)];
    // часть паллет начата: сколько в учёте, столько и видно
    const fill = r() < 0.3 ? Math.max(1, Math.floor(full[load] * r())) : full[load];
    pallets.push({ ...s, turn: 1, load, fill, tag: r() < 0.9 ? 'released' : 'blocked' });
  }
  // зона карантина: жёлтые и отмеченные «пробы отобраны», одна отклонённая
  const qx = x0 + bays * BAY.w + 5;
  const tags: Tag[] = ['quarantine', 'quarantine', 'sampled', 'quarantine', 'rejected', 'quarantine'];
  for (let i = 0; i < tags.length; i++) {
    const load = loads[i % loads.length];
    pallets.push({ x: qx + (i % 3) * 2.5 + 0.8, z: 7.5 + Math.floor(i / 3) * 3, y: 0, turn: 0, load, fill: full[load], tag: tags[i] });
  }
  // пластиковая паллета у будущего шлюза для материалов
  pallets.push({ x: Math.min(w - 3, qx + 9), z: Math.min(h - 3, 16), y: 0, turn: 0, load: 'drums', fill: 2, tag: 'released', plastic: true });
  return { racks, lanes, pallets };
}
