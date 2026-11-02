// Склад не встаёт на карантине (0.0.57; найдено замером для спецификации Б5г): паллета уходит из карантина в
// пробоотборную, её место занимает паллета из приёмки, и полный карантин ждёт пробоотборную, а пробоотборная — места в
// карантине. На зерне 2 сценария игры так стоял весь склад с апреля до конца года: сырьё не проходило входной контроль,
// серии не начинались. Теперь размещение из приёмки оставляет столько мест, сколько паллет в пробоотборной.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import { DAY } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { planOf } from '../../src/engine/plant';
import { freeSlots, heldForSampled } from '../../src/engine/stock';

const SC = 'scn.proto';

describe('карантин и пробоотборная не ждут друг друга', () => {
  test('зерно 2, 300 суток: задачи пробоотборной и размещения в карантин открыты недели, а не месяцы; места паллетам из пробоотборной есть', () => {
    const s = newPlant(db, { scenario: SC, seed: 2 });
    const plan = planOf(db, s.plant);
    // как долго открыта задача — раз в сутки: до 0.0.57 они висели по 78–95 суток
    const open = { fromSampling: 0, toSampling: 0, putaway: 0 };
    let reserve = Infinity;
    for (let d = 0; d < 300; d++) {
      apply(db, s, { kind: 'advance', seconds: DAY });
      for (const id of s.open) {
        const t = s.tasks[id];
        const age = s.t - t.created;
        if (t.kind === 'fromSampling' || t.kind === 'toSampling') open[t.kind] = Math.max(open[t.kind], age);
        if (t.kind === 'putaway' && (t.toKind === 'quarantine' || t.toKind === 'cold')) open.putaway = Math.max(open.putaway, age);
      }
      // в карантине свободно не меньше, чем паллет, которые туда вернутся из пробоотборной
      reserve = Math.min(reserve, freeSlots(s, plan, 'quarantine') - heldForSampled(db, s, plan, 'quarantine'));
    }
    expect(open.fromSampling).toBeLessThan(7 * DAY);
    expect(open.toSampling).toBeLessThan(40 * DAY);
    expect(open.putaway).toBeLessThan(40 * DAY);
    expect(reserve).toBeGreaterThanOrEqual(0);
  }, 90_000);
});
