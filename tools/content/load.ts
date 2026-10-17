// Сборка базы игры из content/ (docs/02-architecture.md, §12; docs/04-data-model.md, §3). Каждый файл — одна запись.
// Правила:
// - идентификатор вечный и совпадает с путём: content/units/pallet/euro.yaml → unit.pallet.euro (ADR студии 0004);
// - запись проходит строгую схему (schema.ts);
// - ссылки между записями разрешаются;
// - ключи источников есть в таблице docs/10-domain.md, §9;
// - числа переводятся в единицы движка (docs/04-data-model.md, §2).
// Ошибка любой записи останавливает сборку: база с битой ссылкой в игру не попадает.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { parse } from 'yaml';
import type { ContentDb, Profile, Scenario, UnitType } from '../../src/content/types';
import { fnv1a, stableJson } from '../../src/engine/core/hash';
import { KINDS, type Kind } from './schema';

const ROOT = join(import.meta.dir, '../..');
const CONTENT = join(ROOT, 'content');

/** Доля в процентах → доли 1/10 000 (единицы движка). */
const share = (pct: number) => Math.round(pct * 100);

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

export function buildDb(): Built {
  const errors: string[] = [];
  const known = sourceKeys();
  const db: Omit<ContentDb, 'hash'> = { profiles: {}, scenarios: {}, units: {} };
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
      let raw: unknown;
      try {
        raw = parse(readFileSync(file, 'utf8'));
      } catch (e) {
        errors.push(`${rel}: YAML не читается: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const r = schema.safeParse(raw);
      if (!r.success) {
        for (const issue of r.error.issues) errors.push(`${rel}: ${issue.path.join('.') || '(запись)'}: ${issue.message}`);
        continue;
      }
      const rec = r.data as { id: string; source?: string[] };
      const path = relative(dir, file).replace(/\.yaml$/, '').split(/[\\/]/);
      const expect = [prefix, ...path].join('.');
      if (rec.id !== expect) errors.push(`${rel}: идентификатор ${rec.id} не совпадает с путём файла (ожидается ${expect})`);
      for (const key of rec.source ?? []) if (!known.has(key)) errors.push(`${rel}: источник ${key} не найден в docs/10-domain.md, §9`);
      const map = db[kind] as Record<string, unknown>;
      if (map[rec.id]) {
        errors.push(`${rel}: идентификатор ${rec.id} уже есть`);
        continue;
      }
      map[rec.id] = convert(kind, r.data, basename(file));
    }
  }

  // ссылки между записями
  for (const s of Object.values(db.scenarios)) {
    if (!db.profiles[s.profile]) errors.push(`сценарий ${s.id}: нет профиля ${s.profile}`);
  }

  const hash = fnv1a(stableJson(db)).toString(16).padStart(8, '0');
  return { db: { hash, ...db }, errors, files: count };
}

function convert(kind: Kind, rec: unknown, _file: string): Profile | Scenario | UnitType {
  switch (kind) {
    case 'profiles': {
      const p = rec as Profile;
      return { ...p, vat: { medicines: share(p.vat.medicines), general: share(p.vat.general) } };
    }
    case 'scenarios': {
      const s = rec as Omit<Scenario, 'start'> & { start: { date: string; hour: number } };
      const [y, m, d] = s.start.date.split('-').map(Number);
      return { ...s, start: { date: { y, m, d }, hour: s.start.hour } };
    }
    case 'units':
      return rec as UnitType;
  }
}
