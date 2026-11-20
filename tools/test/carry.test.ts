// Переход кампании (Б9, шаг 4; docs/specs/2026-10-vertical-slice.md, «Шаг 4. Переход кампании»): завод сценария 1 после
// конца срока — в сценарий 2; остаётся всё, достроено крыло покрытия, выданы ибупрофен, покупатели, люди, касса; места
// освобождены; межсезонье живёт само; со старта игрока — письма и цели сценария 2 от его даты.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY, daysFromCivil, HOUR, momentOf } from '../../src/engine/core/calendar';
import { liveOf } from '../../src/engine/docs';
import { contractOf, pairsFor } from '../../src/engine/partners';
import { recipeOf } from '../../src/engine/project';
import { carryBlock, nextScenario, playerStart, scnZero } from '../../src/engine/carry';
import { apply, newPlant } from '../../src/engine/engine';
import { goalSpan } from '../../src/engine/goals';
import { fromSave, toSave } from '../../src/engine/save';
import type { Notice, PlantState } from '../../src/engine/types';

const ended = (): PlantState => {
  const s = newPlant(db, { scenario: 'scn.c1' });
  apply(db, s, { kind: 'seat', seats: ['director'] });
  const sc = db.scenarios['scn.c1'];
  apply(db, s, { kind: 'advance', seconds: playerStart(db, s) + sc.days! - s.t + HOUR });
  return s;
};

describe('переход кампании', () => {
  test('следующий — сценарий 2; до конца срока — отказ; у свежего завода сутки сценария — от его даты', () => {
    expect(nextScenario(db, 'scn.c1')?.id).toBe('scn.c2');
    expect(nextScenario(db, 'scn.c2')).toBeUndefined();
    const s = newPlant(db, { scenario: 'scn.c1' });
    expect(scnZero(db, s)).toBe(0);
    expect(carryBlock(db, s)).toBe('notEnded');
    const r = apply(db, s, { kind: 'next' });
    expect(r.some(n => n.kind === 'refused' && n.why === 'notEnded')).toBe(true);
  });

  test('после конца срока: завод тот же — в сценарии 2; крыло покрытия достроено, ибупрофен в силе, касса, люди, места свободны', () => {
    const s = ended();
    const people = Object.keys(s.people).length;
    const lots = Object.keys(s.lots).length;
    const story = s.story.chronicle.length;
    const notes = apply(db, s, { kind: 'next' });
    const c = notes.find(n => n.kind === 'carried') as Extract<Notice, { kind: 'carried' }> | undefined;
    expect(c).toBeDefined();
    expect([c!.from, c!.to, c!.built]).toEqual(['scn.c1', 'scn.c2', true]);
    expect(s.scenario).toBe('scn.c2');
    expect(s.story.campaign?.from).toEqual(['scn.c1']);
    expect(s.plan.rooms.some(r => r.type === 'coating')).toBe(true);
    expect(s.plan.equipment.some(e => e.type === 'eq.coater')).toBe(true);
    expect(s.rooms.coating?.status).toBe('clean');
    expect(s.assets['coater-1']).toBeDefined();
    expect(Object.keys(s.portfolio?.docs ?? {}).length).toBeGreaterThan(0);
    expect(s.customers['cus.chain'] && s.customers['cus.oblast'] && s.customers['cus.district']).toBeTruthy();
    // материалы ибупрофена — пары одобрены и договор с поставщиком: снабжение их закажет
    const d = liveOf(db, s.portfolio?.docs);
    const today = momentOf(s.start, s.t).day;
    for (const l of d.recipes[recipeOf(d, 'prd.ibuprofen200')!].bom) expect(pairsFor(d, s, l.material, today).length).toBeGreaterThan(0);
    const api = pairsFor(d, s, 'mat.api.ibuprofen', today)[0];
    expect(contractOf(s, api.supplier, today)).toBeDefined();
    expect(Object.keys(s.people).length).toBeGreaterThanOrEqual(people);
    expect(Object.keys(s.lots).length).toBeGreaterThanOrEqual(lots);
    expect(s.cash.balance).toBeGreaterThanOrEqual(db.scenarios['scn.c2'].cash);
    expect((s.seats ?? []).every(x => x.to !== undefined)).toBe(true);
    expect(s.story.chronicle.length).toBeGreaterThanOrEqual(story);
    // сутки сценария 2 — от его даты; цели — от старта игрока после прогрева
    const zero = (daysFromCivil(db.scenarios['scn.c2'].start.date) - daysFromCivil(s.start)) * DAY;
    expect(scnZero(db, s)).toBe(zero);
    expect(goalSpan(db, s).from).toBe(c!.start);
    // места свободны — игрок снова выбирает их; у сценария 2 следующего нет
    expect(apply(db, s, { kind: 'next' }).some(n => n.kind === 'refused' && n.why === 'notYours')).toBe(true);
    apply(db, s, { kind: 'seat', seats: ['director'] });
    expect(apply(db, s, { kind: 'next' }).some(n => n.kind === 'refused' && n.why === 'noNext')).toBe(true);
  });

  test('межсезонье: завод живёт сам до старта игрока — письма сценария 2 приходят, сохранение то же', () => {
    const s = ended();
    const c = apply(db, s, { kind: 'next' }).find(n => n.kind === 'carried') as Extract<Notice, { kind: 'carried' }>;
    const notes = apply(db, s, { kind: 'advance', seconds: c.start - s.t + HOUR });
    expect(notes.some(n => n.kind === 'scenarioStart')).toBe(true);
    expect((s.heads.letters ?? []).length).toBeGreaterThan(0);
    const back = fromSave(db, toSave(s));
    expect(back.story.campaign).toEqual(s.story.campaign);
    expect(back.scenario).toBe('scn.c2');
  }, 120_000);

  test('тот же конец на зерне — тот же старт сценария 2', () => {
    const a = ended();
    const b = ended();
    apply(db, a, { kind: 'next' });
    apply(db, b, { kind: 'next' });
    expect(toSave(a)).toBe(toSave(b));
  }, 120_000);
});
