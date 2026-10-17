// Сборка базы игры из content/ (docs/02-architecture.md, §12; docs/04-data-model.md, §3). Каждый файл — одна запись.
// Правила:
// - идентификатор вечный и совпадает с путём: content/units/pallet/euro.yaml → unit.pallet.euro (ADR студии 0004);
// - запись проходит строгую схему (schema.ts);
// - ссылки между записями разрешаются;
// - ключи источников есть в таблице docs/10-domain.md, §9;
// - числа переводятся в единицы движка (docs/04-data-model.md, §2): кг → мг, ₽ → копейки, м → см, % → доли 1/10 000.
// Ошибка любой записи останавливает сборку: база с битой ссылкой в игру не попадает.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import type { z } from 'zod';
import type {
  ContainerType,
  ContentDb,
  Material,
  Plant,
  Profile,
  Role,
  Scenario,
  Shift,
  Supplier,
  UnitType,
  VehicleType,
} from '../../src/content/types';
import { fnv1a, stableJson } from '../../src/engine/core/hash';
import { KINDS, type Kind } from './schema';

const ROOT = join(import.meta.dir, '../..');
const CONTENT = join(ROOT, 'content');

/** Единицы движка. */
const share = (pct: number) => Math.round(pct * 100);
const kop = (rub: number) => Math.round(rub * 100);
const mg = (kg: number) => Math.round(kg * 1_000_000);
const cm = (m: number) => Math.round(m * 100);

function files(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap(name => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? files(p) : name.endsWith('.yaml') ? [p] : [];
    });
}

/** Ключи источников из таблицы «## 9. Источники» в docs/10-domain.md. */
export function sourceKeys(): Set<string> {
  const doc = readFileSync(join(ROOT, 'docs/10-domain.md'), 'utf8');
  const at = doc.indexOf('## 9. Источники');
  const keys = new Set<string>();
  if (at < 0) return keys;
  for (const line of doc.slice(at).split('\n')) {
    const m = line.match(/^\|\s*`([a-z0-9-]+)`\s*\|/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

export interface Built {
  db: ContentDb;
  errors: string[];
  files: number;
}

type Raw = { [K in Kind]: Record<string, z.infer<(typeof KINDS)[K]['schema']>> };

export function buildDb(): Built {
  const errors: string[] = [];
  const known = sourceKeys();
  const raw = Object.fromEntries(Object.keys(KINDS).map(k => [k, {}])) as Raw;
  let count = 0;

  for (const kind of Object.keys(KINDS) as Kind[]) {
    const { prefix, schema } = KINDS[kind];
    const dir = join(CONTENT, kind);
    let list: string[] = [];
    try {
      list = files(dir);
    } catch {
      continue;
    }
    for (const file of list) {
      count++;
      const rel = relative(ROOT, file);
      let data: unknown;
      try {
        data = parse(readFileSync(file, 'utf8'));
      } catch (e) {
        errors.push(`${rel}: YAML не читается: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const r = schema.safeParse(data);
      if (!r.success) {
        for (const issue of r.error.issues) errors.push(`${rel}: ${issue.path.join('.') || '(запись)'}: ${issue.message}`);
        continue;
      }
      const rec = r.data as { id: string; source?: string[] };
      const path = relative(dir, file).replace(/\.yaml$/, '').split(/[\\/]/);
      const expect = [prefix, ...path].join('.');
      if (rec.id !== expect) errors.push(`${rel}: идентификатор ${rec.id} не совпадает с путём файла (ожидается ${expect})`);
      for (const key of rec.source ?? []) if (!known.has(key)) errors.push(`${rel}: источник ${key} не найден в docs/10-domain.md, §9`);
      const map = raw[kind] as Record<string, unknown>;
      if (map[rec.id]) {
        errors.push(`${rel}: идентификатор ${rec.id} уже есть`);
        continue;
      }
      map[rec.id] = r.data;
    }
  }

  const db = convert(raw, errors);
  const hash = fnv1a(stableJson(db)).toString(16).padStart(8, '0');
  return { db: { hash, ...db }, errors, files: count };
}

/** Перевод в единицы движка и проверка ссылок. */
function convert(raw: Raw, errors: string[]): Omit<ContentDb, 'hash'> {
  const need = (ok: unknown, msg: string) => {
    if (!ok) errors.push(msg);
  };
  const materials: Record<string, Material> = {};
  for (const m of Object.values(raw.materials)) {
    const c = raw.containers[m.container];
    need(c, `материал ${m.id}: нет тары ${m.container}`);
    if (c) need(('kg' in c.capacity) === (m.unit === 'kg'), `материал ${m.id}: тара ${c.id} в других единицах`);
    materials[m.id] = { ...m, unit: m.unit === 'kg' ? 'mass' : 'pcs' };
  }
  /** Количество материала в единицах движка: мг или штуки. */
  const amount = (material: string, q: number, where: string) => {
    const m = materials[material];
    need(m, `${where}: нет материала ${material}`);
    if (!m) return 0;
    if (m.unit === 'pcs') need(Number.isInteger(q), `${where}: ${material} считается штуками`);
    return m.unit === 'mass' ? mg(q) : Math.round(q);
  };
  const containers: Record<string, ContainerType> = {};
  for (const c of Object.values(raw.containers)) {
    containers[c.id] = { ...c, capacity: 'kg' in c.capacity ? mg(c.capacity.kg) : c.capacity.pcs };
  }
  const suppliers: Record<string, Supplier> = {};
  for (const s of Object.values(raw.suppliers)) {
    const items: Supplier['items'] = {};
    for (const [mid, it] of Object.entries(s.items)) items[mid] = { price: kop(it.price), moq: amount(mid, it.moq, `поставщик ${s.id}`) };
    suppliers[s.id] = { ...s, prepay: share(s.prepay), items };
  }
  const roles: Record<string, Role> = {};
  for (const r of Object.values(raw.roles)) roles[r.id] = { ...r, salary: kop(r.salary) };
  const vehicles: Record<string, VehicleType> = {};
  for (const v of Object.values(raw.vehicles)) vehicles[v.id] = { ...v, speedEmpty: cm(v.speedEmpty), speedLoaded: cm(v.speedLoaded) };
  const shifts: Record<string, Shift> = {};
  for (const sh of Object.values(raw.shifts)) {
    need(sh.from < sh.to, `график ${sh.id}: смена кончается раньше, чем начинается`);
    shifts[sh.id] = { ...sh, days: [...new Set(sh.days)].sort().map(d => d - 1) };
  }
  const plants: Record<string, Plant> = {};
  for (const p of Object.values(raw.plants)) {
    const r4 = (r: [number, number, number, number]): [number, number, number, number] => [cm(r[0]), cm(r[1]), cm(r[2]), cm(r[3])];
    plants[p.id] = {
      id: p.id,
      docks: p.docks.map(d => ({ ...d, x: cm(d.x), z: cm(d.z) })),
      zones: p.zones.map(zn => ({ ...zn, rect: r4(zn.rect) })),
      racks: p.racks.map(r => ({ ...r, x: cm(r.x), z: cm(r.z) })),
      rooms: p.rooms.map(r => ({ ...r, rect: r4(r.rect) })),
      points: { park: [cm(p.points.park[0]), cm(p.points.park[1])], entrance: [cm(p.points.entrance[0]), cm(p.points.entrance[1])] },
    };
    const ids = [...p.docks.map(d => d.id), ...p.zones.map(z => z.id), ...p.racks.map(r => r.id), ...p.rooms.map(r => r.id)];
    need(new Set(ids).size === ids.length, `план ${p.id}: имена рамп, зон, стеллажей и помещений повторяются`);
    for (const k of ['receiving', 'quarantine', 'rejected', 'staging'] as const) need(p.zones.some(z => z.kind === k), `план ${p.id}: нет зоны «${k}»`);
    need(p.docks.some(d => d.kind === 'in'), `план ${p.id}: нет рампы приёмки`);
  }
  const scenarios: Record<string, Scenario> = {};
  for (const s of Object.values(raw.scenarios)) {
    const where = `сценарий ${s.id}`;
    need(raw.profiles[s.profile], `${where}: нет профиля ${s.profile}`);
    need(plants[s.plant], `${where}: нет плана ${s.plant}`);
    for (const r of s.staff) {
      need(roles[r.role], `${where}: нет роли ${r.role}`);
      need(shifts[r.shift], `${where}: нет графика ${r.shift}`);
    }
    for (const v of s.vehicles) need(vehicles[v.type], `${where}: нет техники ${v.type}`);
    for (const o of s.orders) {
      const sup = suppliers[o.supplier];
      need(sup, `${where}: нет поставщика ${o.supplier}`);
      for (const l of o.lines) need(sup?.items[l.material], `${where}: ${o.supplier} не продаёт ${l.material}`);
    }
    const [y, m, d] = s.start.date.split('-').map(Number);
    scenarios[s.id] = {
      ...s,
      start: { date: { y, m, d }, hour: s.start.hour },
      cash: kop(s.cash),
      orders: s.orders.map(o => ({ supplier: o.supplier, lines: o.lines.map(l => ({ material: l.material, qty: amount(l.material, l.qty, where) })) })),
      stock: s.stock.map(x => ({ material: x.material, qty: amount(x.material, x.qty, where) })),
    };
  }
  const profiles: Record<string, Profile> = {};
  for (const p of Object.values(raw.profiles)) profiles[p.id] = { ...p, vat: { medicines: share(p.vat.medicines), general: share(p.vat.general) } };
  return {
    profiles,
    scenarios,
    units: raw.units as Record<string, UnitType>,
    materials,
    containers,
    suppliers,
    roles,
    vehicles,
    shifts,
    plants,
  };
}
