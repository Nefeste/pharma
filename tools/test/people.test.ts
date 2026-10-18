// из bolnitsa: tools/test/people.test.ts @ e0a3491 — изменено: без посадки и лёжа (на заводе не сидят и не лежат в 2б);
// своё — файлы моделей сверены с sources.json, у каждой роли базы — одежда, вид каждой работы есть в наборе.
// Люди (docs/specs/2026-10-view.md, 2б): ступни на полу в каждом кадре «стоит», «идёт», «бежит» — у полной и у упрощённой
// модели; рост — по таблице cast.ts; набор Quaternius — мультяшный, и это записано в cast.ts.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../../src/content';
import { CLIP_NAMES, skinnedY } from '../../src/render/bake';
import { dressOf, LOOKS, lookOf, lookSpec, ROLE_DRESS, statureOf } from '../../src/render/cast';
import { bakedPeople, index, MODELS } from './render-kit';

const sources = JSON.parse(readFileSync(join(MODELS, 'sources.json'), 'utf8')) as Record<string, { source: string; sha256: string; out: string }>;

describe('люди', () => {
  test('все виды набора — в таблице cast.ts; у каждого файла — строка в sources.json и тот же SHA-256', () => {
    expect(index.people.slice().sort()).toEqual(LOOKS.map(l => l.name).sort());
    for (const n of index.people) {
      const row = sources[`people/${n}.glb`];
      expect([n, !!row]).toEqual([n, true]);
      const sha = createHash('sha256').update(readFileSync(join(MODELS, `people/${n}.glb`))).digest('hex');
      expect([n, sha]).toEqual([n, row.out]);
    }
  });

  test('у каждой роли базы — одежда; вид каждой работы есть в наборе', () => {
    for (const role of Object.keys(db.roles)) {
      expect([role, !!ROLE_DRESS[role]]).toEqual([role, true]);
      const look = index.people[lookOf(index.people, role, 1)];
      expect([role, lookSpec(look)!.use]).toEqual([role, dressOf(role).use]);
    }
  });

  test('ступни на полу: в каждом кадре нижняя точка — у пола (полная и упрощённая модель)', async () => {
    const p = await bakedPeople();
    for (const look of p.looks) {
      for (const cn of CLIP_NAMES) {
        if (cn === 'SitDown' || cn === 'StandUp') continue;
        const c = look.clips[cn];
        for (let f = 0; f < c.frames; f++) {
          for (const g of [look.geometry, look.lod]) {
            const y = skinnedY(p, look, c.start + f, g).min;
            // шаг и бег отрывают ступню; в фазе полёта бега обе ноги в воздухе
            const [lo, hi] = cn === 'Run' && look.clips.Run.start !== look.clips.Walk.start ? [-0.06, 0.2] : cn === 'Walk' || cn === 'Run' ? [-0.02, 0.025] : [-0.012, 0.012];
            expect([look.name, cn, f, y >= lo && y <= hi]).toEqual([look.name, cn, f, true]);
          }
        }
      }
    }
  }, 120_000);

  test('рост — по таблице: мужчины, женщины, старшие', async () => {
    const p = await bakedPeople();
    for (const look of p.looks) {
      const s = lookSpec(look.name)!;
      expect(look.height).toBeCloseTo(statureOf(s), 3);
      const y = skinnedY(p, look, look.clips.Idle.start);
      expect(y.max - y.min).toBeCloseTo(statureOf(s), 2);
    }
  });

  test('пропорции набора — мультяшные, как записано в cast.ts', async () => {
    const p = await bakedPeople();
    for (const look of p.looks) {
      expect(lookSpec(look.name)!.proportions).toBe('cartoon');
      expect(look.headRatio).toBeLessThan(4);
    }
  });
});
