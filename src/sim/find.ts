// «Найти» (Б13, шаг 4; docs/specs/2026-10-vertical-slice.md, «Б13. Доступность и настройки»): вещь завода по названию или
// коду — помещение, оборудование, машина линии, человек, паллета, партия, серия. Текст сравнивается без регистра с кодом
// и с названием на обоих языках. Только записи завода: истины здесь нет — код партии, номер серии, роль, вид.
import type { ContentDb, Id, Text } from '../content/types';
import { batchNo } from '../engine/batchno';
import { planOf } from '../engine/plant';
import type { PlantState } from '../engine/types';
import type { Thing } from './views';

export interface FindQuery {
  view: 'find';
  text: string;
  /** названия типов помещений на языке окна: в базе их нет, их пишет окно (`T.roomTypes`) */
  rooms?: Record<string, string>;
}

/** Найденное: вещь на полу или серия (её досье); код и вид — окну для подписи, без названий: их окно берёт из базы. */
export type FindRow =
  | { kind: 'room'; thing: Thing; code: string; type: string }
  | { kind: 'equipment'; thing: Thing; code: string; type: Id }
  | { kind: 'machine'; thing: Thing; code: string; type: Id }
  | { kind: 'person'; thing: Thing; tab: number; role: Id }
  | { kind: 'unit'; thing: Thing; code: string; material?: Id; lot?: { y: number; m: number; n: number } }
  | { kind: 'batch'; batch: number; code: string; product: Id };

export interface FindView {
  view: 'find';
  text: string;
  rows: FindRow[];
  /** найдено больше, чем показано */
  more: boolean;
}

/** Сколько строк показать: дальше — уточнить. */
export const FIND_MAX = 20;

const norm = (x: string) => x.toLowerCase().replace(/\u0451/g, '\u0435').trim();
const hit = (q: string, ...xs: (string | Text | undefined)[]) =>
  xs.some(x => (typeof x === 'string' ? norm(x).includes(q) : !!x && (norm(x.ru).includes(q) || (!!x.en && norm(x.en).includes(q)))));

export function findView(db: ContentDb, s: PlantState, text: string, names: Record<string, string> = {}): FindView {
  const q = norm(text);
  const rows: FindRow[] = [];
  if (q.length === 0) return { view: 'find', text, rows, more: false };
  const plan = planOf(db, s.plan).plant;
  plan.rooms.forEach((r, i) => {
    if (hit(q, r.id, names[r.type])) rows.push({ kind: 'room', thing: { kind: 'room', i }, code: r.id, type: r.type });
  });
  plan.equipment.forEach((e, i) => {
    if (hit(q, e.id, e.place, db.equipment[e.type]?.name)) rows.push({ kind: 'equipment', thing: { kind: 'equipment', i }, code: e.place || e.id, type: e.type });
  });
  plan.lines.forEach((ln, line) =>
    ln.machines.forEach((m, k) => {
      if (hit(q, m.id, m.place, db.machines[m.type]?.name)) rows.push({ kind: 'machine', thing: { kind: 'machine', line, k }, code: m.place || m.id, type: m.type });
    }),
  );
  for (const p of Object.values(s.people).sort((a, b) => a.tab - b.tab))
    if (hit(q, String(p.tab), db.roles[p.role]?.name)) rows.push({ kind: 'person', thing: { kind: 'person', n: Number(p.id.slice(1)) }, tab: p.tab, role: p.role });
  for (const b of Object.values(s.batches)) {
    const code = batchNo(b.code);
    if (hit(q, code, db.products[b.product]?.name)) rows.push({ kind: 'batch', batch: Number(b.id.slice(1)), code, product: b.product });
  }
  for (const u of Object.values(s.units)) {
    const c = u.items.length ? s.containers[u.items[0]] : undefined;
    const lot = c ? s.lots[c.lot] : undefined;
    // номер партии — цифрами, как окно пишет его после буквы: «2709-0001»
    const digits = lot ? `${String(lot.code.y).padStart(2, '0')}${String(lot.code.m).padStart(2, '0')}-${String(lot.code.n).padStart(4, '0')}` : undefined;
    // с буквой окна впереди («П-2709-0001», «L-2709-0001») — без неё
    const qd = q.replace(/^[^\d-]+-/, '');
    if (hit(q, u.id, lot ? db.materials[lot.material]?.name : undefined) || (!!digits && qd.length > 0 && digits.includes(qd))) rows.push({ kind: 'unit', thing: { kind: 'unit', n: Number(u.id.slice(1)) }, code: u.id, ...(lot ? { material: lot.material, lot: lot.code } : {}) });
  }
  return { view: 'find', text, rows: rows.slice(0, FIND_MAX), more: rows.length > FIND_MAX };
}
