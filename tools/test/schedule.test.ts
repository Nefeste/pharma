// Часть 3д: прогон расписания, сдвиг задания и призрак (docs/specs/2026-10-panels.md, 3д). Прогон — по правилам движка и
// его функциями: прошлое — ровно записи стадий; в помещении полосы не перекрываются, между сериями — уборка; стадии
// начинаются в смене, не позже чем за 15 минут до её конца; комплектовка одна; состояние не меняется; прогон с начала
// партии близок к тому, как серии потом прошли на деле. Сдвиг меняет срок только у задания, не начавшего комплектовку.
// Призрак называет, почему не там, куда тянут. Черновик (часть 5, docs/specs/2026-10-plan-run.md): отпустили — строка
// черновика, команды нет; план — с черновиком, прежние полосы сдвинутых серий — рядом; «Утвердить» — сроки как в
// черновике и план как показан; «Сбросить» — ничего не изменилось; начатое задание из черновика уходит. Новое задание
// черновика (0.0.39): его полосы и причины до «Утвердить» — те же, что после, с номером, который оно получит.
import { describe, expect, test } from 'bun:test';
import { legacy as db } from './legacy';
import { db as game } from '../../src/content';
import { DAY, HOUR, MIN } from '../../src/engine/core/calendar';
import { apply, newPlant } from '../../src/engine/engine';
import { readyFor, TRANSFER_WORK } from '../../src/engine/mes';
import { type Bar, forecast, freshBatches } from '../../src/engine/plan/schedule';
import { planOf } from '../../src/engine/plant';
import { takesAt } from '../../src/engine/staff';
import type { Notice, PlantState } from '../../src/engine/types';
import { ganttView, ghostView, pastBars } from '../../src/sim/plan';
import { commandsOf, prune, upsert } from '../../src/ui/draft';

const SC = 'scn.proto';
const at = (day: number, hour: number) => day * DAY + hour * HOUR;
const fresh = (): PlantState => newPlant(db, { scenario: SC });
const live = (s: PlantState, until: number) => apply(db, s, { kind: 'advance', seconds: until - s.t });
const recipe = Object.values(db.recipes)[0];

/** Полосы одной строки по времени. */
const rowBars = (bars: Bar[], row: string) => bars.filter(b => b.row === row).sort((a, b) => a.from - b.from || a.to - b.to);

/** Мгновения жизни, на которых проверяют прогон: начало, комплектовка, стадии, ночь, выходные. */
const MOMENTS = [0, at(1, 7.5), at(1, 9), at(1, 14), at(1, 20), at(2, 3), at(5, 12), at(8, 8.25), at(8, 12), at(9, 1), at(15, 16), at(16, 12)];

describe('прогон', () => {
  const s = fresh();
  const shots: { t: number; s: PlantState }[] = [];
  for (const m of MOMENTS) {
    if (m > s.t) live(s, m);
    shots.push({ t: s.t, s: structuredClone(s) });
  }

  test('прошлое — ровно записи стадий', () => {
    const st = shots[shots.length - 1].s;
    const past = pastBars(db, st).filter(b => b.kind === 'stage');
    const want = Object.values(st.batches).flatMap(b => b.records.map(r => ({ row: r.room, batch: b.id, stage: r.stage, from: r.start, to: r.end })));
    expect(past.map(b => ({ row: b.row, batch: b.batch, stage: b.stage, from: b.from, to: b.to }))).toEqual(want);
    expect(want.length).toBeGreaterThan(10);
  });

  test('в помещении полосы не перекрываются, между сериями — уборка; комплектовка — одна в мгновение', () => {
    for (const { s: st } of shots) {
      const bars = [...pastBars(db, st), ...forecast(db, st).bars];
      for (const r of [...Object.keys(st.rooms), 'kit']) {
        const list = rowBars(bars, r);
        for (let i = 1; i < list.length; i++) expect(list[i].from).toBeGreaterThanOrEqual(list[i - 1].to);
        // соседние стадии разных серий — через уборку; в прошлом учёт помнит только последнюю уборку помещения
        const stg = list.filter(b => b.kind === 'stage');
        for (let i = 1; i < stg.length; i++) {
          if (stg[i].batch === stg[i - 1].batch || stg[i].when === 'past') continue;
          expect(list.some(b => b.kind === 'clean' && b.from >= stg[i - 1].to && b.to <= stg[i].from)).toBe(true);
        }
      }
    }
  });

  test('стадии по плану начинаются в смене людей их роли, не позже чем за 15 минут до её конца', () => {
    let n = 0;
    for (const { s: st } of shots) {
      for (const b of forecast(db, st).bars.filter(x => x.kind === 'stage' && x.when === 'plan')) {
        const stage = recipe.stages.find(x => x.id === b.stage)!;
        const ready = Object.values(st.people).filter(p => p.role === stage.staff.role && takesAt(db, st, p, b.from)).length;
        expect(ready).toBeGreaterThanOrEqual(stage.staff.n);
        n++;
      }
    }
    expect(n).toBeGreaterThan(30);
  });

  test('прогон не меняет состояние', () => {
    for (const { s: st } of shots) {
      const before = JSON.stringify(st);
      forecast(db, st);
      ganttView(db, st, { view: 'gantt', from: st.t - DAY, to: st.t + 7 * DAY });
      for (const b of Object.values(st.batches)) ghostView(db, st, { view: 'ghost', batch: b.id, notBefore: st.t + 3 * HOUR });
      expect(JSON.stringify(st)).toBe(before);
    }
  });

  test('прогон с начала партии близок к жизни: стадии первых трёх серий начались не дальше часа от плана', () => {
    const plan = forecast(db, fresh()).bars.filter(b => b.kind === 'stage');
    const st = shots[shots.length - 1].s;
    let n = 0;
    for (const id of ['B1', 'B2', 'B3']) {
      for (const r of st.batches[id].records) {
        const p = plan.find(b => b.batch === id && b.stage === r.stage)!;
        expect(Math.abs(p.from - r.start)).toBeLessThanOrEqual(HOUR);
        n++;
      }
    }
    expect(n).toBe(3 * recipe.stages.length);
  });

  test('одна функция на двоих: чистота помещения просрочена для движка — и прогон убирает его снова перед серией', () => {
    // за час до второй серии: отвешивание убрано после первой больше 72 часов назад
    const st = fresh();
    live(st, at(8, 6));
    const room = planOf(db, st.plant).roomOf.dispensing;
    expect(readyFor(st.rooms[room], recipe.product, st.t)).toBe(false);
    const f = forecast(db, st);
    expect(f.why.B2).toContainEqual(expect.objectContaining({ why: 'clean', bar: 'dispense', room, cause: 'expired' }));
    const kit = f.bars.find(b => b.batch === 'B2' && b.kind === 'kit')!;
    const clean = f.bars.find(b => b.row === room && b.kind === 'clean' && b.from >= kit.to)!;
    const disp = f.bars.find(b => b.batch === 'B2' && b.stage === 'dispense')!;
    expect(clean.to).toBeLessThanOrEqual(disp.from);
    // и движок: перед отвешиванием второй серии помещение убирают снова
    live(st, at(8, 12));
    const rec = st.batches.B2.records.find(r => r.stage === 'dispense')!;
    expect(rec.start).toBeGreaterThanOrEqual(at(8, 7));
    expect(st.losses.some(d => d.recleans > 0)).toBe(true);
  });

  test('задание без материала — полосы не раньше прихода заказа; без заказа — без полос', () => {
    const st = fresh();
    // шестая серия ждёт АФС: запаса хватает на пять, остальное — из заказа сценария
    const waiting = Object.values(st.batches).filter(b => b.status === 'waiting');
    expect(waiting.length).toBeGreaterThan(0);
    const f = forecast(db, st);
    for (const b of waiting) {
      const kit = f.bars.find(x => x.batch === b.id && x.kind === 'kit');
      const po = Object.values(st.pos).find(p => p.lines.some(l => b.short!.some(x => x.material === l.material)));
      if (!po) {
        expect(f.stuck).toContain(b.id);
        continue;
      }
      expect(kit?.material).toBe(true);
      expect(kit!.from).toBeGreaterThanOrEqual(po.eta);
      expect(f.why[b.id]).toContainEqual(expect.objectContaining({ why: 'material', po: po.id, eta: po.eta }));
    }
    // заказа нет — полос нет, задание — в списке «без полос»
    const nopo = structuredClone(st);
    nopo.pos = {};
    const g = forecast(db, nopo);
    for (const b of waiting) {
      expect(g.stuck).toContain(b.id);
      expect(g.bars.some(x => x.batch === b.id)).toBe(false);
    }
  });
});

describe('сдвиг', () => {
  test('срок меняется только у ждущего и зарезервированного задания; отказы', () => {
    const s = fresh();
    live(s, at(1, 9));
    const out: Notice[] = [];
    out.push(...apply(db, s, { kind: 'shift', batch: 'B99', notBefore: s.t, by: 'player' }));
    out.push(...apply(db, s, { kind: 'shift', batch: 'B1', notBefore: s.t + DAY, by: 'player' }));
    expect(out.filter(n => n.kind === 'refused').map(n => (n as { why: string }).why)).toEqual(['noBatch', 'started']);
    expect(s.batches.B1.status).not.toBe('reserved');
    const was = s.batches.B2.notBefore;
    apply(db, s, { kind: 'shift', batch: 'B2', notBefore: was + 2 * HOUR, by: 'player' });
    expect(s.batches.B2.notBefore).toBe(was + 2 * HOUR);
    // раньше нынешней минуты — нынешняя минута
    apply(db, s, { kind: 'shift', batch: 'B3', notBefore: s.t - 5 * HOUR, by: 'player' });
    expect(s.batches.B3.notBefore).toBe(s.t);
  });

  test('позже — комплектовка не раньше нового срока; раньше — серия идёт раньше', () => {
    // позже: вторая серия — на сутки позже, в четверг 10:00
    const late = fresh();
    live(late, at(5, 12));
    const want = at(9, 10);
    apply(db, late, { kind: 'shift', batch: 'B2', notBefore: want, by: 'player' });
    live(late, want - MIN);
    expect(late.batches.B2.status).toBe('reserved');
    live(late, want + 1);
    expect(late.batches.B2.status).not.toBe('reserved');
    // раньше: вторая серия — в пятницу первой недели, 10:00, вместо среды второй
    const base = fresh();
    live(base, at(12, 0));
    const early = fresh();
    live(early, at(2, 6));
    apply(db, early, { kind: 'shift', batch: 'B2', notBefore: at(2, 10), by: 'player' });
    live(early, at(12, 0));
    const d0 = base.batches.B2.records[0].start;
    const d1 = early.batches.B2.records[0].start;
    expect(d1).toBeLessThan(d0 - 4 * DAY);
    expect(d1).toBeGreaterThanOrEqual(at(2, 10));
  });

  test('прогон после сдвига — новый срок: полосы задания там, где показал призрак', () => {
    const s = fresh();
    live(s, at(5, 12));
    const want = at(7, 13);
    const g = ghostView(db, s, { view: 'ghost', batch: 'B2', notBefore: want });
    apply(db, s, { kind: 'shift', batch: 'B2', notBefore: want, by: 'player' });
    const f = forecast(db, s);
    expect(JSON.stringify(f.bars.filter(b => b.batch === 'B2'))).toBe(JSON.stringify(g.bars));
  });
});

describe('призрак', () => {
  test('на занятое помещение — «занято до» и уборка после той серии', () => {
    const s = fresh();
    live(s, at(1, 7.5));
    const f = forecast(db, s);
    const b1 = f.bars.find(b => b.batch === 'B1' && b.stage === 'dispense')!;
    // вторую серию тянут так, чтобы её комплект был готов посреди отвешивания первой
    const g = ghostView(db, s, { view: 'ghost', batch: 'B2', notBefore: b1.from + 15 * MIN });
    const room = planOf(db, s.plant).roomOf.dispensing;
    expect(g.why).toContainEqual(expect.objectContaining({ why: 'room', bar: 'dispense', room, batch: 'B1', until: b1.to }));
    expect(g.why).toContainEqual(expect.objectContaining({ why: 'clean', bar: 'dispense', room, cause: 'after', batch: 'B1' }));
    const d2 = g.bars.find(b => b.stage === 'dispense')!;
    expect(d2.from).toBeGreaterThan(b1.to);
    expect(g.batches.B1.code).toBeDefined();
  });

  test('на ночь — «нет в смене»: комплектовка с 08:00; раньше нынешней минуты — «нельзя»', () => {
    const s = fresh();
    live(s, at(1, 7.5));
    // в ночь на пятницу: кладовщики — с 08:00
    const night = ghostView(db, s, { view: 'ghost', batch: 'B2', notBefore: at(2, 2) });
    expect(night.why).toContainEqual({ why: 'shift', bar: 'kit', role: 'role.storekeeper', at: at(2, 8) });
    const kit = night.bars.find(b => b.kind === 'kit')!;
    expect(kit.from).toBe(at(2, 2));
    expect(kit.to).toBeGreaterThanOrEqual(at(2, 8) + TRANSFER_WORK);
    const past = ghostView(db, s, { view: 'ghost', batch: 'B2', notBefore: s.t - 3 * HOUR });
    expect(past.why[0]).toEqual({ why: 'past', bar: 'kit' });
    // комплектовка одна: первая серия ещё комплектуется
    expect(past.why).toContainEqual(expect.objectContaining({ why: 'kitting', batch: 'B1' }));
  });

  test('начатое задание тянуть нельзя; нет задания — отказ', () => {
    const s = fresh();
    live(s, at(1, 9));
    expect(ghostView(db, s, { view: 'ghost', batch: 'B1', notBefore: s.t + DAY }).refused).toBe('started');
    expect(ghostView(db, s, { view: 'ghost', batch: 'B99', notBefore: s.t }).refused).toBe('noBatch');
    const v = ganttView(db, s, { view: 'gantt', from: at(0, 0), to: at(8, 0) });
    expect(v.movable).not.toContain('B1');
    expect(v.movable).toContain('B2');
  });
});

describe('вид расписания', () => {
  test('строки — комплектовка, помещения стадий по плану, линии; полосы — те, что задевают окно', () => {
    const s = fresh();
    live(s, at(8, 12));
    const from = at(7, 0);
    const to = at(15, 0);
    const v = ganttView(db, s, { view: 'gantt', from, to });
    const plan = planOf(db, s.plant);
    expect(v.rows.map(r => r.id)).toEqual(['kit', 'dispensing', 'granulation', 'blending', 'compression', ...plan.plant.lines.map(l => l.id)]);
    expect(v.bars.every(b => b.to > from && b.from < to)).toBe(true);
    expect(v.bars.some(b => b.when === 'past')).toBe(true);
    expect(v.bars.some(b => b.when === 'plan')).toBe(true);
    for (const b of v.bars) if (b.batch) expect(v.batches[b.batch]).toBeDefined();
  });

  test('без истины: два завода с разными истинными полями — одни и те же Гант и призрак', () => {
    const a = fresh();
    live(a, at(8, 9));
    const b: PlantState = structuredClone(a);
    for (const lot of Object.values(b.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
    for (const bt of Object.values(b.batches)) {
      for (const k of Object.keys(bt.truth) as (keyof typeof bt.truth)[]) bt.truth[k] = (bt.truth[k] ?? 0) + 777;
      bt.causes = [];
    }
    for (const p of Object.values(b.parts)) p.budget += 12345;
    const q = { view: 'gantt' as const, from: at(7, 0), to: at(15, 0) };
    expect(JSON.stringify(ganttView(db, b, q))).toBe(JSON.stringify(ganttView(db, a, q)));
    const gq = { view: 'ghost' as const, batch: 'B3', notBefore: at(10, 9) };
    expect(JSON.stringify(ghostView(db, b, gq))).toBe(JSON.stringify(ghostView(db, a, gq)));
  });
});

describe('черновик', () => {
  test('строки: новая, та же — сменилась, на утверждённый срок — ушла; уходит начатое; команды — по порядку', () => {
    const a = upsert([], { batch: 'B2', notBefore: 100 }, 50);
    expect(a).toEqual([{ batch: 'B2', notBefore: 100 }]);
    const b = upsert(a, { batch: 'B3', notBefore: 200 }, 300);
    const c = upsert(b, { batch: 'B2', notBefore: 120 }, 50);
    expect(c).toEqual([{ batch: 'B2', notBefore: 120 }, { batch: 'B3', notBefore: 200 }]);
    expect(upsert(c, { batch: 'B2', notBefore: 50 }, 50)).toEqual([{ batch: 'B3', notBefore: 200 }]);
    expect(prune(c, [])).toBe(c);
    expect(prune(c, ['B9'])).toBe(c);
    expect(prune(c, ['B2'])).toEqual([{ batch: 'B3', notBefore: 200 }]);
    expect(commandsOf(c)).toEqual([
      { kind: 'shift', batch: 'B2', notBefore: 120, by: 'player' },
      { kind: 'shift', batch: 'B3', notBefore: 200, by: 'player' },
    ]);
  });

  test('вид с черновиком: команды нет, план — с черновиком, прежние полосы — рядом; утвердить — план как показан', () => {
    const s = fresh();
    live(s, at(1, 9));
    const q = { view: 'gantt' as const, from: at(0, 0), to: at(14, 0) };
    const plain = ganttView(db, s, q);
    expect(plain.moved).toEqual([]);
    expect(plain.was).toEqual([]);
    const want = s.batches.B2.notBefore + DAY;
    const draft = [{ batch: 'B2', notBefore: want }];
    const before = JSON.stringify(s);
    const v = ganttView(db, s, { ...q, draft });
    // черновик — не команда: завод тот же
    expect(JSON.stringify(s)).toBe(before);
    expect(v.moved).toContain('B2');
    expect(v.gone).toEqual([]);
    const kit = v.bars.find(b => b.batch === 'B2' && b.kind === 'kit')!;
    expect(kit.from).toBeGreaterThanOrEqual(want);
    // прежние полосы — по утверждённому плану, только у сдвинутых серий
    expect(v.was.length).toBeGreaterThan(0);
    expect(v.was.every(b => v.moved.includes(b.batch!) && b.when === 'plan')).toBe(true);
    expect(JSON.stringify(v.was.filter(b => b.batch === 'B2'))).toBe(JSON.stringify(plain.bars.filter(b => b.batch === 'B2' && b.when === 'plan')));
    // призрак тянет B3 поверх черновика: его основа — план с черновиком
    const g = ghostView(db, s, { view: 'ghost', batch: 'B3', notBefore: s.batches.B3.notBefore, draft });
    expect(g.moved).toEqual([]);
    // утвердили — сроки как в черновике, а план — как показал вид с черновиком
    for (const cmd of commandsOf(draft)) apply(db, s, cmd);
    expect(s.batches.B2.notBefore).toBe(want);
    const after = ganttView(db, s, q);
    expect(JSON.stringify(after.bars)).toBe(JSON.stringify(v.bars));
    expect(after.moved).toEqual([]);
  });

  test('сбросить — ничего не изменилось; начатое задание из черновика уходит само', () => {
    const s = fresh();
    live(s, at(1, 6));
    const q = { view: 'gantt' as const, from: at(0, 0), to: at(9, 0) };
    const plain = ganttView(db, s, q);
    // «Сбросить» — пустой черновик: тот же вид, что без него
    expect(JSON.stringify(ganttView(db, s, { ...q, draft: [] }))).toBe(JSON.stringify(plain));
    // первую серию положили в черновик до того, как она начала комплектовку; началась — тянуть нельзя
    const draft = [{ batch: 'B1', notBefore: s.batches.B1.notBefore + DAY }];
    expect(ganttView(db, s, { ...q, draft }).gone).toEqual([]);
    live(s, at(1, 9));
    expect(s.batches.B1.status).not.toBe('waiting');
    expect(s.batches.B1.status).not.toBe('reserved');
    const v = ganttView(db, s, { ...q, draft });
    expect(v.gone).toEqual(['B1']);
    expect(prune(draft, v.gone)).toEqual([]);
    expect(ganttView(db, s, { ...q, draft: [...prune(draft, v.gone)] }).moved).toEqual([]);
  });
});

describe('новое задание черновика (0.0.39)', () => {
  test('полосы и причины до «Утвердить» — те же, что после; номер — тот, что оно получит; резерв — вслед за прошлым', () => {
    const s = newPlant(game, { scenario: SC });
    apply(game, s, { kind: 'seat', seats: ['production'] });
    apply(game, s, { kind: 'advance', seconds: at(1, 20) - s.t });
    const q = { view: 'gantt' as const, from: 0, to: at(60, 0) };
    const fresh = [
      { recipe: 'rcp.paracetamol500.wet.v1', sku: 'sku.paracetamol500.n20' },
      { recipe: 'rcp.paracetamol500.wet.v1', sku: 'sku.paracetamol500.n20' },
    ];
    const before = JSON.stringify(s);
    const v = ganttView(game, s, { ...q, fresh });
    const kits = freshBatches(game, s, fresh).map(b => b.kit);
    // черновик — не команда: завод тот же
    expect(JSON.stringify(s)).toBe(before);
    const ids = [1, 2].map(i => `B${(s.next.B ?? 0) + i}`);
    for (const id of ids) {
      expect(v.moved).toContain(id);
      expect(v.batches[id]).toMatchObject({ n: Number(id.slice(1)), status: 'reserved', notBefore: s.t });
      expect(v.bars.filter(b => b.batch === id && b.kind === 'kit')).toHaveLength(1);
    }
    // второе задание берёт то, что осталось после первого: из тары вместе — не больше свободного в ней
    const want = new Map<string, number>();
    for (const k of [...kits[0], ...kits[1]]) want.set(k.container, (want.get(k.container) ?? 0) + k.qty);
    for (const [c, n] of want) expect(n).toBeLessThanOrEqual(s.containers[c].qty - (s.containers[c].reserved ?? 0));
    // утвердили — у заданий тот же резерв, а расписание — как показал черновик
    for (const f of fresh) apply(game, s, { kind: 'order', ...f });
    expect(ids.map(id => s.batches[id].kit)).toEqual(kits);
    const after = ganttView(game, s, q);
    expect(JSON.stringify(after.bars)).toBe(JSON.stringify(v.bars));
    expect(JSON.stringify(after.why)).toBe(JSON.stringify(v.why));
    expect(after.moved).toEqual([]);
  }, 60_000);
});
