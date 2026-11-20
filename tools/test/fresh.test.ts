// Новый завод в окне (по игре владельца 20.11.2026): после «Начать» на экране «Кампания» и после загрузки первый срез —
// `fresh`, и окно забывает паллеты прежнего завода. Иначе паллета прототипа за экраном «Кампания», которой у нового
// завода нет, оставалась на стеллаже, и её карточка — «Этого больше нет на заводе».
import { describe, expect, test } from 'bun:test';
import { SceneState } from '../../src/app/scene';
import { db } from '../../src/content';
import { HOUR } from '../../src/engine/core/calendar';
import { newPlant } from '../../src/engine/engine';
import { createSim } from '../../src/sim/host';
import { unpack } from '../../src/sim/pack';

describe('новый завод в окне', () => {
  test('первый срез после старта и загрузки — fresh; окно, забыв прежние паллеты, держит ровно паллеты нового завода', () => {
    const sim = createSim(db);
    const view = new SceneState();
    const take = (m: ReturnType<typeof sim.handle>) => {
      if (m.kind !== 'slice') throw new Error(m.kind);
      if (m.fresh) view.reset();
      view.apply(unpack(m.buf));
      return m;
    };
    expect(take(sim.handle({ kind: 'start', scenario: 'scn.proto' })).fresh).toBe(true);
    expect(take(sim.handle({ kind: 'tick', seconds: 6 * HOUR, budgetMs: 10_000 })).fresh).toBeUndefined();
    const proto = new Set(view.units.keys());
    expect(take(sim.handle({ kind: 'start', scenario: 'scn.c1' })).fresh).toBe(true);
    const c1 = Object.keys(newPlant(db, { scenario: 'scn.c1' }).units).map(id => Number(id.slice(1)));
    expect([...view.units.keys()].sort((a, b) => a - b)).toEqual(c1.sort((a, b) => a - b));
    // без забывания у окна остались бы паллеты прототипа с номерами, которых у сценария 1 нет
    expect([...proto].some(n => !c1.includes(n))).toBe(true);
    const saved = sim.handle({ kind: 'save' });
    if (saved.kind !== 'saved') throw new Error(saved.kind);
    expect(take(sim.handle({ kind: 'load', json: saved.json })).fresh).toBe(true);
    expect([...view.units.keys()].sort((a, b) => a - b)).toEqual(c1.sort((a, b) => a - b));
  });
});
