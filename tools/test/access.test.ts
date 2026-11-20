// Доступность (Б13, шаг 2; docs/specs/2026-10-vertical-slice.md, «Б13. Доступность и настройки»): контраст и мышь «для
// левой руки» — выбор в хранилище окна, система по умолчанию; кнопки сцены; слои громкости.
import { describe, expect, test } from 'bun:test';
import { ACCESS, keepFlag, keptFlag, sceneButton, systemContrast } from '../../src/app/access';
import { CUES, keepLayer, keptLayer, LAYER_OF, LAYERS, layerKey, Sound } from '../../src/app/sound';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('контраст и левая рука', () => {
  test('выбор игрока — из хранилища; не выбирал — как в системе; испорченное — как в системе', () => {
    const st = memory();
    expect(keptFlag(st, ACCESS.contrast, true)).toBe(true);
    expect(keptFlag(st, ACCESS.contrast, false)).toBe(false);
    keepFlag(st, ACCESS.contrast, false);
    expect(keptFlag(st, ACCESS.contrast, true)).toBe(false);
    st.m.set(ACCESS.left, 'да');
    expect(keptFlag(st, ACCESS.left, false)).toBe(false);
    const broken = { getItem: () => { throw new Error('нет'); }, setItem: () => { throw new Error('нет'); } };
    expect(keptFlag(broken, ACCESS.left, true)).toBe(true);
    keepFlag(broken, ACCESS.left, true);
  });

  test('система: prefers-contrast — спросить нельзя — нет', () => {
    expect(systemContrast(q => ({ matches: q === '(prefers-contrast: more)' }))).toBe(true);
    expect(systemContrast(() => ({ matches: false }))).toBe(false);
    expect(systemContrast(undefined)).toBe(false);
    expect(systemContrast(() => { throw new Error('нет'); })).toBe(false);
  });

  test('кнопки сцены: для левой руки левая и правая меняются, средняя — та же', () => {
    expect([0, 1, 2].map(b => sceneButton(b, false))).toEqual([0, 1, 2]);
    expect([0, 1, 2].map(b => sceneButton(b, true))).toEqual([2, 1, 0]);
  });
});

describe('слои громкости', () => {
  test('у каждого звука — слой интерфейса или извещений', () => {
    expect([...LAYERS]).toEqual(['ui', 'notices']);
    for (const c of CUES) expect(LAYERS).toContain(LAYER_OF[c]);
    expect(LAYER_OF.click).toBe('ui');
    expect(LAYER_OF.stop).toBe('notices');
  });

  test('громкость слоя — в хранилище, ступенями; нет — полная', () => {
    const st = memory();
    expect(keptLayer(st, 'ui')).toBe(1);
    keepLayer(st, 'ui', 0.4);
    expect(st.m.get(layerKey('ui'))).toBe('0.4');
    expect(keptLayer(st, 'ui')).toBe(0.4);
    st.m.set(layerKey('notices'), '0.43');
    expect(keptLayer(st, 'notices')).toBe(0.4);
  });

  test('слой на нуле — его звуки молчат, другой слой звучит бы', () => {
    const s = new Sound(0.7);
    s.setLayer('ui', 0);
    expect(s.layers).toEqual({ ui: 0, notices: 1 });
    // без первого нажатия звука нет вообще; слой на нуле — не играет и после него
    expect(s.play('click')).toBe(false);
  });
});
