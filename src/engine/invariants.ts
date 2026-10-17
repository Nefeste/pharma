// Инварианты завода (docs/02-architecture.md, §15; docs/specs/2026-10-engine.md, «Инварианты 1а»). Чистая проверка
// состояния: список нарушений, пустой — всё в порядке. Её зовут тесты и «виртуальный директор» на каждом шаге проверки.
import type { ContentDb } from '../content/types';
import { planOf } from './plant';
import { LOT_FLOW } from './stock';
import type { PlantState } from './types';

export function check(db: ContentDb, s: PlantState): string[] {
  const bad: string[] = [];
  const plan = planOf(db, s.plant);
  // баланс масс: принято = остаток в таре + израсходовано + в пробах + списано
  const left: Record<string, number> = {};
  for (const c of Object.values(s.containers)) {
    left[c.lot] = (left[c.lot] ?? 0) + c.qty;
    if (c.qty < 0) bad.push(`тара ${c.id}: остаток ${c.qty}`);
    const u = s.units[c.unit];
    if (!u) bad.push(`тара ${c.id}: нет паллеты ${c.unit}`);
    else if (!u.items.includes(c.id)) bad.push(`тара ${c.id}: паллета ${u.id} её не знает`);
    if (!s.lots[c.lot]) bad.push(`тара ${c.id}: нет партии ${c.lot}`);
  }
  for (const lot of Object.values(s.lots)) {
    const sum = (left[lot.id] ?? 0) + lot.used + lot.sampled + lot.written;
    if (sum !== lot.qty) bad.push(`партия ${lot.id}: принято ${lot.qty}, а в таре и расходе ${sum}`);
    if (!(lot.status in LOT_FLOW)) bad.push(`партия ${lot.id}: статус ${lot.status}`);
  }
  // паллета — ровно в одном месте; место — не больше одной паллеты
  for (const u of Object.values(s.units)) {
    for (const cid of u.items) if (s.containers[cid]?.unit !== u.id) bad.push(`паллета ${u.id}: тара ${cid} числится не здесь`);
    if (u.where.kind === 'slot') {
      if (!plan.slot[u.where.id]) bad.push(`паллета ${u.id}: нет места ${u.where.id}`);
      if (s.slots[u.where.id]?.unit !== u.id) bad.push(`паллета ${u.id}: место ${u.where.id} занято другим`);
    } else {
      const tr = s.trucks[u.where.id];
      if (!tr || !tr.units.includes(u.id)) bad.push(`паллета ${u.id}: фура ${u.where.id} её не везёт`);
    }
  }
  for (const [id, use] of Object.entries(s.slots)) {
    if (use.unit) {
      const u = s.units[use.unit];
      if (!u || u.where.kind !== 'slot' || u.where.id !== id) bad.push(`место ${id}: паллета ${use.unit} стоит не здесь`);
    }
    if (use.held) {
      const t = s.tasks[use.held];
      if (!t || t.to !== id) bad.push(`место ${id}: держит задача ${use.held}, которой нет или она везёт не сюда`);
      if (use.unit) bad.push(`место ${id}: занято и одновременно держится задачей`);
    }
  }
  for (const tr of Object.values(s.trucks)) {
    for (const uid of tr.units) {
      const u = s.units[uid];
      if (!u || u.where.kind !== 'truck' || u.where.id !== tr.id) bad.push(`фура ${tr.id}: паллета ${uid} не на ней`);
    }
  }
  // люди и техника — не больше одной задачи; задача знает своих людей
  for (const p of Object.values(s.people)) {
    if (p.task && !s.tasks[p.task]?.people.includes(p.id)) bad.push(`человек ${p.id}: задача ${p.task} его не знает`);
  }
  for (const v of Object.values(s.vehicles)) {
    if (v.task && s.tasks[v.task]?.vehicle !== v.id) bad.push(`техника ${v.id}: задача ${v.task} её не знает`);
  }
  const open = new Set(s.open);
  if (open.size !== s.open.length) bad.push('очередь задач: повторы');
  for (const t of Object.values(s.tasks)) {
    if (t.state === 'open' && !open.has(t.id)) bad.push(`задача ${t.id}: открыта, но не в очереди`);
    if (t.state === 'busy') {
      if (open.has(t.id)) bad.push(`задача ${t.id}: занята, но в очереди`);
      for (const pid of t.people) if (s.people[pid]?.task !== t.id) bad.push(`задача ${t.id}: ${pid} занят другим`);
      if (t.vehicle && s.vehicles[t.vehicle]?.task !== t.id) bad.push(`задача ${t.id}: техника ${t.vehicle} занята другим`);
    }
  }
  for (const id of s.open) if (!s.tasks[id]) bad.push(`очередь задач: нет задачи ${id}`);
  return bad;
}
