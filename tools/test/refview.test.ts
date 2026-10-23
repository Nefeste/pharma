// Б1а: вид справочника завода (docs/specs/2026-10-vertical-slice.md). Как должно быть — из базы, и только то, что завод
// знает по своим документам: базы и заводы, у которых различаются лишь скрытые параметры модели и истина, дают один и тот
// же вид, а ключей сверх описанных в src/sim/ref.ts в нём нет. По карте — та же функция, что у движка и прогона расписания;
// по факту — записи стадий серий; люди по ролям и сменам — как в состоянии. Карточка паллеты: тара и сколько в ней — по учёту.
import { describe, expect, test } from 'bun:test';
import { db } from '../../src/content';
import type { Attr, ContentDb, Recipe } from '../../src/content/types';
import { momentOf } from '../../src/engine/core/calendar';
import { apply } from '../../src/engine/engine';
import { nominal } from '../../src/engine/mes';
import { fromSave } from '../../src/engine/save';
import type { PlantState } from '../../src/engine/types';
import { ru } from '../../src/i18n/ru';
import { type RefStage, refView } from '../../src/sim/ref';
import { cardView } from '../../src/sim/views';

/** Образец дня 15: две серии прошли все стадии, третья комплектуется (tools/test/make-save-fixture.ts). */
const s = fromSave(db, await Bun.file(new URL('./fixtures/save-v15.json', import.meta.url)).text());
const v = refView(db, s);

/** База, в которой другим всё, чего настоящий завод по своим документам не знает. */
function mangleDb(d: ContentDb): ContentDb {
  const o: ContentDb = structuredClone(d);
  for (const su of Object.values(o.suppliers)) su.defects += 777;
  for (const c of Object.values(o.customers)) for (const k of Object.keys(c.demand)) c.demand[k] += 777;
  for (const m of Object.values(o.tests)) m.sd += 7;
  for (const r of Object.values(o.recipes)) {
    for (const k of Object.keys(r.quality) as Attr[]) r.quality[k] = [r.quality[k]![0] + 7, r.quality[k]![1] + 7];
    r.yield = { expected: r.yield.expected - 7, alarm: r.yield.alarm - 7 };
    for (const st of r.stages) {
      st.time.spread += 77;
      st.loss = [st.loss[0] + 7, st.loss[1] + 7];
      for (const p of st.params) p.sd += 7;
    }
  }
  for (const rec of [...Object.values(o.equipment), ...Object.values(o.machines)])
    for (const p of rec.parts) {
      p.hazard = p.hazard.map(([w, h]) => [w, h + 777] as [number, number]);
      if (p.scatter) for (const k of Object.keys(p.scatter) as Attr[]) p.scatter[k] = (p.scatter[k] ?? 0) + 7;
      if (p.micro !== undefined) p.micro += 7;
    }
  for (const m of Object.values(o.machines)) {
    m.reject += 7;
    if (m.micro) m.micro = { every: m.micro.every + 7, duration: m.micro.duration + 7 };
    if (m.jam) m.jam = { cartons: m.jam.cartons + 1, uncounted: m.jam.uncounted + 7 };
  }
  return o;
}

/** Завод, в котором другим всё, чего завод не знает: истинные свойства, причины, запас узлов до отказа, происшествие. */
function mangleState(s: PlantState): PlantState {
  const o: PlantState = structuredClone(s);
  for (const lot of Object.values(o.lots)) for (const k of Object.keys(lot.truth) as (keyof typeof lot.truth)[]) lot.truth[k] = (lot.truth[k] ?? 0) + 777;
  for (const b of Object.values(o.batches)) {
    for (const k of Object.keys(b.truth) as (keyof typeof b.truth)[]) b.truth[k] = (b.truth[k] ?? 0) + 777;
    b.causes = [{ cause: 'cause.mill.screen', attr: 'dissolution', delta: -999, stage: 'mill' }];
  }
  for (const p of Object.values(o.parts)) p.budget += 12_345;
  if (o.incident) o.incident = { ...o.incident, root: o.incident.root === 'screen' ? 'lube' : 'screen', size: o.incident.size + 77 };
  return o;
}

/** Все ключи объектов вида, на любой глубине. */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keysOf(x, out);
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysOf(x, out);
    }
  return out;
}

/** Поля вида по src/sim/ref.ts: новое поле — сначала сюда, с вопросом, знает ли его завод по своим документам. */
const ALLOWED = new Set(
  (
    'view products recipes equipment lines methods instruments roles shifts suppliers customers ' +
    'id code form skus perBlister blisters perCase cases shelf price regPrice ' +
    'product mass units bom material qty potency qs stages room staff role n nominal params unit target range ipc test min max mix done last mean now batch from ' +
    'type cleaning minor major parts life wear failed state machines buffer rate sku ' +
    'inst prep run unattended queued running method ' +
    'dept salary shift present busy days to hour lead prepay payDays approved items moq spares spare minShelf ' +
    // Б3а: номенклатура и регламентирующие документы — по НСИ и дате завода
    'materials docs kind okei spec status ' +
    // Б3б: люди с табельными номерами и допуском, матрица обучения — записи завода
    'people person tab skill adm k doc rev matrix cells ok all ' +
    // Б3в: места по плану, активы с инвентарными номерами, записи квалификации и калибровки, визиты — учёт завода
    'places site name ru en areas rooms centers regime assets inv family place critical needs verify qual cal work day until by ' +
    'visit at accepting unfit working thing i line today vehicles common ahead closed ' +
    // Б3г: изготовители, пары с одобрением и оценкой, соглашения, действующие договоры — записи и учёт завода
    'partners makers makes pairs supplier maker how since agreement eval review contracts party volume bought ' +
    // Б4а: перерыв смены, табель людей за месяц и год, производственный календарь, политики отделов и пределы
    // сверхурочных — учёт завода и профиль
    'break hours worked norm over year calendar y m policy wms qc qa mes maint overtime ' +
    // Б4б: рисунок сменного графика, учётный период, люди в графике сейчас и с нового месяца, ждущий перевод, календарь
    // бригад — записи базы и учёт завода
    'cycle pattern night account next shiftCal rows of ' +
    // Б4в: штат по сценарию и сейчас, вакансии, кандидаты рынка, принятые до первого дня, уволенные; оклад, испытание
    // и увольнение — записи завода; уровни оплаты, сроки закона и цены найма — база и профиль
    'hiring plan coming leaving vacancies via candidates exam first fee instead hires former levels probation law agree ' +
    'costs ad medical agency trial why hired quit ' +
    // Б4г: график отпусков — годы, черновик и утверждение, кто не поместился; дни человека — заработано, использовано,
    // осталось; у части — заместитель, кто ещё годится, извещён ли, отпускные, началась, кончилась, что мешает; смежные
    // профессии — записи завода; числа закона и правило черновика — профиль и сценарий
    'leave years draft approve miss earned used left deputy can told paid started ended problems right also law part ' +
    'notice pay rule cover'
  ).split(' '),
);

describe('справочник: только то, что завод знает', () => {

  test('ключи вида — только описанные', () => {
    expect([...keysOf(v)].filter(k => !ALLOWED.has(k))).toEqual([]);
  });

  test('скрытые параметры базы не меняют вид', () => {
    expect(refView(mangleDb(db), s)).toEqual(v);
  });

  test('истина завода не меняет вид', () => {
    expect(refView(db, mangleState(s))).toEqual(v);
  });
});

describe('справочник: как должно быть и как есть', () => {

  test('по карте — длительность стадии движка и прогона расписания, на размер серии', () => {
    for (const r of v.recipes) {
      const rec = db.recipes[r.id];
      expect(r.stages.map(x => x.id)).toEqual(rec.stages.map(x => x.id));
      for (const [i, st] of r.stages.entries()) expect(st.nominal).toBe(nominal(db, r.id, rec.stages[i], rec.batch.mass));
      expect(r.stages.filter(x => x.mix).map(x => x.id)).toEqual(rec.stages.filter(x => x.mix).map(x => x.id));
    }
  });

  test('по факту — записи стадий сделанных серий: число, последняя, средняя', () => {
    let seen = 0;
    for (const r of v.recipes)
      for (const st of r.stages) {
        const recs = Object.values(s.batches)
          .filter(b => b.recipe === r.id)
          .flatMap(b => b.records.filter(x => x.stage === st.id))
          .sort((a, b) => a.end - b.end);
        expect(st.done).toBe(recs.length);
        if (!recs.length) continue;
        seen++;
        expect(st.last).toBe(recs[recs.length - 1].end - recs[recs.length - 1].start);
        expect(st.mean).toBe(Math.round(recs.reduce((n, x) => n + x.end - x.start, 0) / recs.length));
      }
    // в образце дня 15 две серии прошли все шесть стадий
    expect(seen).toBe(6);
  });

  test('сейчас на стадии — серия с идущей задачей, от её начала и по карте на её массу', () => {
    const t = structuredClone(s);
    // дожить до работы на стадии
    let st: RefStage | undefined;
    for (let i = 0; i < 200 && !st; i++) {
      apply(db, t, { kind: 'advance', seconds: 600 });
      st = refView(db, t).recipes.flatMap(r => r.stages).find(x => x.now);
    }
    expect(st?.now).toBeDefined();
    const b = Object.values(t.batches).find(x => x.code.n > 0 && st!.now!.batch.startsWith(`${x.code.pp}${String(x.code.n).padStart(3, '0')}`))!;
    const rec = db.recipes[b.recipe];
    expect(st!.now!.from).toBeLessThanOrEqual(t.t);
    expect(st!.now!.nominal).toBe(nominal(db, b.recipe, rec.stages.find(x => x.id === st!.id)!, b.mass));
  });

  test('люди по ролям и сменам — как в состоянии', () => {
    const people = Object.values(s.people);
    for (const r of v.roles) {
      const mine = people.filter(p => p.role === r.id);
      expect(r.shifts.reduce((n, x) => n + x.n, 0)).toBe(mine.length);
      expect(r.busy).toBe(mine.filter(p => p.task !== undefined).length);
      expect(r.present).toBeGreaterThanOrEqual(r.busy);
      expect(r.present).toBeLessThanOrEqual(mine.length);
    }
  });

  test('приборы и методики — испытания по учёту лаборатории', () => {
    const tests = Object.values(s.tests);
    for (const m of v.methods) expect(m.queued + m.running + m.done).toBe(tests.filter(q => q.method === m.id).length);
    for (const i of v.instruments) {
      const q = s.instruments[i.id]?.test;
      expect(i.method).toBe(q ? s.tests[q].method : undefined);
    }
  });

  test('позиция — 120 пачек в ящике у № 20, 40 ящиков на паллете', () => {
    const k = v.products.flatMap(p => p.skus).find(x => x.id === 'sku.paracetamol500.n20')!;
    expect([k.perBlister, k.blisters, k.perCase, k.cases]).toEqual([10, 2, 120, 40]);
  });
});

describe('справочник: номенклатура и документы (Б3а)', () => {
  const today = momentOf(s.start, s.t).day;

  test('материалы и запчасти — единица учёта с кодом ОКЕИ, спецификация на сегодня', () => {
    expect(v.materials.map(m => m.id)).toEqual([...Object.keys(db.materials), ...Object.keys(db.spares)]);
    const by = Object.fromEntries(v.materials.map(m => [m.id, m]));
    expect(by['mat.api.paracetamol']).toEqual({ id: 'mat.api.paracetamol', kind: 'api', unit: 'kg', okei: 166, spec: 'spec.mat.api.paracetamol', pairs: [{ supplier: 'sup.api', maker: 'mkr.api-par' }] });
    expect(by['mat.pk.carton-n20']).toMatchObject({ unit: 'pcs', okei: 796 });
    expect(by['mat.fg.paracetamol500-n20']).toMatchObject({ kind: 'fg', unit: 'pack', okei: 778 });
    expect(by['spare.punches']).toEqual({ id: 'spare.punches', kind: 'spare', unit: 'pcs', okei: 796 });
  });

  test('документы — все редакции базы; в прототипе каждая действует, кроме новой редакции уборки до её дня (Б3б) и прежних редакций соглашений (Б3г)', () => {
    const all = (['specs', 'tests', 'recipes', 'skus', 'sops', 'agreements'] as const).flatMap(kind => Object.keys(db[kind]).map(id => `${kind}/${id}`));
    expect(v.docs.map(d => `${d.kind}/${d.id}`)).toEqual(all);
    const draft = v.docs.filter(d => d.status !== 'active').map(d => `${d.kind}/${d.id}:${d.status}`);
    // соглашения по качеству (Б3г): прежние редакции — в архиве, на начало партии действует последняя
    const qag = ['agreements/qag.exc:archive', 'agreements/qag.pack-r2:archive', 'agreements/qag.pack:archive'];
    expect(draft).toEqual([...(today < db.sops['sop.cleaning-r2'].doc.from ? ['sops/sop.cleaning-r2:draft'] : ['sops/sop.cleaning:archive']), ...qag]);
  });

  test('новая редакция карты: до своего дня — проект, карты — прежняя; с него — действует, прежняя — в архиве', () => {
    const V1 = 'rcp.paracetamol500.wet.v1';
    const at = (from: number): ContentDb => {
      const r2: Recipe = { ...structuredClone(db.recipes[V1]), id: 'rcp.paracetamol500.wet.v2', doc: { ...db.recipes[V1].doc, rev: 2, from } };
      return { ...db, recipes: { ...db.recipes, [r2.id]: r2 } };
    };
    const status = (x: ReturnType<typeof refView>, id: string) => x.docs.find(d => d.kind === 'recipes' && d.id === id)?.status;
    const later = refView(at(today + 1), s);
    expect([status(later, V1), status(later, 'rcp.paracetamol500.wet.v2')]).toEqual(['active', 'draft']);
    expect(later.recipes.map(r => r.id)).toEqual(v.recipes.map(r => r.id));
    const now = refView(at(today), s);
    expect([status(now, V1), status(now, 'rcp.paracetamol500.wet.v2')]).toEqual(['archive', 'active']);
    expect(now.recipes.map(r => r.id)).toEqual(v.recipes.map(r => (r.id === V1 ? 'rcp.paracetamol500.wet.v2' : r.id)));
  });

  test('карточки: серия в помещении и на оборудовании — с редакцией карты; своя продукция — с картой и инструкцией по упаковке', async () => {
    // образец схемы 17 — посреди работы: стадии идут, балк и ГП уже есть
    const w = fromSave(db, await Bun.file(new URL('./fixtures/save-v17.json', import.meta.url)).text());
    const rooms = db.plants[w.plant].rooms.map((_, i) => cardView(db, w, { kind: 'room', i }).card).filter(c => c.kind === 'room' && c.batch);
    const eqs = db.plants[w.plant].equipment.map((_, i) => cardView(db, w, { kind: 'equipment', i }).card).filter(c => c.kind === 'equipment' && c.batch);
    expect(rooms.length + eqs.length).toBeGreaterThan(0);
    for (const c of [...rooms, ...eqs]) if (c.kind === 'room' || c.kind === 'equipment') expect(db.recipes[c.recipe!]?.doc.code).toMatch(/^MF-/);
    let own = 0;
    for (const u of Object.values(w.units)) {
      const c = cardView(db, w, { kind: 'unit', n: Number(u.id.slice(1)) }).card;
      if (c.kind !== 'unit' || !c.lot) continue;
      const lot = w.lots[c.lot.id];
      expect(c.lot.recipe).toBe(lot.batch ? w.batches[lot.batch].recipe : undefined);
      if (c.lot.sku) expect(w.batches[lot.batch!].pack?.fg).toBe(lot.id);
      if (lot.batch) own++;
    }
    expect(own).toBeGreaterThan(0);
  });
});

describe('карточка паллеты: что лежит', () => {

  test('тара по виду и сколько в ней — по учёту; у готовой продукции — полный ящик позиции', () => {
    let fg = 0;
    for (const u of Object.values(s.units)) {
      const c = cardView(db, s, { kind: 'unit', n: Number(u.id.slice(1)) }).card;
      if (c.kind !== 'unit') continue;
      if (!u.items.length) {
        expect(c.holds).toBeUndefined();
        continue;
      }
      const list = u.items.map(id => s.containers[id]);
      expect(c.holds!.container).toBe(list[0].type);
      expect(c.holds!.by.reduce((n, g) => n + g.n, 0)).toBe(list.length);
      expect(c.holds!.by.reduce((n, g) => n + g.n * g.qty, 0)).toBe(list.reduce((n, x) => n + x.qty, 0));
      expect(c.holds!.by.map(g => g.qty)).toEqual([...new Set(list.map(x => x.qty))].sort((a, b) => b - a));
      const sku = Object.values(db.skus).find(k => k.fg === s.lots[list[0].lot].material);
      expect(c.holds!.full).toBe(sku?.case.per);
      if (sku) fg++;
    }
    expect(fg).toBeGreaterThan(0);
  });

  test('слова: «40 гофроящиков по 120 пачек», «4 бочки: 3 по 50 кг, 1 по 12 кг»', () => {
    expect(ru.card.holds(40, 'case', ru.card.packs(120))).toBe('40 гофроящиков по 120 пачек');
    expect(ru.card.holds(1, 'bag', '25 кг')).toBe('1 мешок по 25 кг');
    expect(ru.card.holdsBy(4, 'drum', [ru.card.holdsGroup(3, '50 кг'), ru.card.holdsGroup(1, '12 кг')])).toBe('4 бочки: 3 по 50 кг, 1 по 12 кг');
  });
});
