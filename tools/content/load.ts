// Сборка базы игры из content/ (docs/02-architecture.md, §12; docs/04-data-model.md, §3). Каждый файл — одна запись.
// Правила:
// - идентификатор вечный и совпадает с путём: content/units/pallet/euro.yaml → unit.pallet.euro (ADR студии 0004);
// - запись проходит строгую схему (schema.ts);
// - ссылки между записями разрешаются;
// - ключи источников есть в таблице docs/10-domain.md, §9;
// - числа переводятся в единицы движка (docs/04-data-model.md, §2): кг → мг, г → мг, ₽ → копейки, м → см, % → доли
//   1/10 000, минуты → секунды.
// Ошибка любой записи останавливает сборку: база с битой ссылкой в игру не попадает.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import type { z } from 'zod';
import {
  ATTR_SCALE,
  ATTRS,
  type Attr,
  type Cause,
  type ContainerType,
  type ContentDb,
  type Customer,
  type EquipmentType,
  type FindingRead,
  type IncidentDef,
  type InstrumentType,
  type InvModel,
  type Machine,
  type ModelPart,
  type Material,
  PARAM_SCALE,
  type ParamUnit,
  type PartType,
  type Plant,
  type Product,
  type Profile,
  QUALITATIVE,
  type Recipe,
  type RecipeStage,
  type Role,
  type Scenario,
  type Shift,
  type Sku,
  type Spare,
  type Spec,
  type SpecLine,
  type Supplier,
  type TestMethod,
  type UnitType,
  type VehicleType,
} from '../../src/content/types';
import { fnv1a, stableJson } from '../../src/engine/core/hash';
import { KINDS, type Kind } from './schema';
import { planErrors } from './plan';

const ROOT = join(import.meta.dir, '../..');
const CONTENT = join(ROOT, 'content');

/** Единицы движка. */
const share = (pct: number) => Math.round(pct * 100);
const kop = (rub: number) => Math.round(rub * 100);
const mg = (kg: number) => Math.round(kg * 1_000_000);
const cm = (m: number) => Math.round(m * 100);
const size = (s: [number, number, number]): [number, number, number] => [cm(s[0]), cm(s[1]), cm(s[2])];
const at2 = (p: [number, number]): [number, number] => [cm(p[0]), cm(p[1])];
const sec = (min: number) => Math.round(min * 60);
const watt = (kw: number) => Math.round(kw * 1000);
const qual = (a: Attr) => QUALITATIVE.includes(a);
/** Значение свойства в единицах движка (src/content/types.ts, `ATTRS`). */
const scaleOf = (a: Attr) => ATTR_SCALE[ATTRS[a].unit];
const attrVal = (a: Attr, v: number) => Math.round(v * scaleOf(a));

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

/**
 * Ошибки модели кодом (docs/specs/2026-10-view.md, 2в). Модель — в метрах и только для окна: части внутри следа записи
 * [ширина, глубина, высота] и не ниже пола; у цилиндра поперёк оси — круг; у бункера ось — вертикаль, сверху круг, снизу
 * диаметр; у ленты — что на ней едет, у других частей — ничего.
 */
export function modelErrors(list: readonly ModelPart[], foot: [number, number, number], where: string): string[] {
  const [W, D, H] = foot;
  const eps = 1e-6;
  const out: string[] = [];
  const need = (ok: unknown, msg: string) => {
    if (!ok) out.push(msg);
  };
  list.forEach((p, i) => {
    const at = `${where}: часть ${i + 1} (${p.shape})`;
    need(Math.abs(p.x) + p.w / 2 <= W / 2 + eps && Math.abs(p.z) + p.d / 2 <= D / 2 + eps, `${at}: выходит за след ${W} × ${D} м`);
    need(p.y - p.h / 2 >= -eps && p.y + p.h / 2 <= H + eps, `${at}: ниже пола или выше ${H} м`);
    if (p.shape === 'cyl') {
      const axis = p.axis ?? 'y';
      const across = axis === 'y' ? [p.w, p.d] : axis === 'x' ? [p.h, p.d] : [p.w, p.h];
      need(Math.abs(across[0] - across[1]) < eps, `${at}: поперёк оси ${axis} — не круг`);
    }
    if (p.shape === 'cone') need((p.axis ?? 'y') === 'y' && Math.abs(p.w - p.d) < eps && p.bottom !== undefined, `${at}: бункер — вертикальный, сверху круг, снизу диаметр`);
    need((p.shape === 'belt') === (p.item !== undefined), `${at}: штуки — только у ленты, и у ленты — обязательно`);
  });
  return out;
}

export interface Built {
  db: ContentDb;
  errors: string[];
  files: number;
}

type Raw = { [K in Kind]: Record<string, z.infer<(typeof KINDS)[K]['schema']>> };
type RawScenario = z.infer<(typeof KINDS)['scenarios']['schema']>;

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
  // план — когда ссылки целы: сетка, двери, шлюзы, что достижимо (plan.ts)
  if (errors.length === 0) {
    for (const id of Object.keys(db.plants)) {
      try {
        errors.push(...planErrors({ hash: '', ...db }, id));
      } catch (e) {
        errors.push(`план ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  const hash = fnv1a(stableJson(db)).toString(16).padStart(8, '0');
  return { db: { hash, ...db }, errors, files: count };
}

/** Перевод в единицы движка и проверка ссылок. */
function convert(raw: Raw, errors: string[]): Omit<ContentDb, 'hash'> {
  const need = (ok: unknown, msg: string) => {
    if (!ok) errors.push(msg);
  };
  const instruments: Record<string, InstrumentType> = { ...raw.instruments };
  const tests: Record<string, TestMethod> = {};
  for (const t of Object.values(raw.tests)) {
    if (t.inst) need(raw.instruments[t.inst], `методика ${t.id}: нет прибора ${t.inst}`);
    need(!t.unattended || t.inst, `методика ${t.id}: без прибора сама не работает`);
    need(!qual(t.attr) || t.sd === 0, `методика ${t.id}: ${t.attr} — качественное свойство, погрешности у него нет`);
    tests[t.id] = { ...t, prep: sec(t.prep), run: sec(t.run), sd: attrVal(t.attr, t.sd) };
  }
  const specs: Record<string, Spec> = {};
  for (const sp of Object.values(raw.specs)) {
    const lines: SpecLine[] = [];
    for (const l of sp.tests) {
      const t = raw.tests[l.test];
      need(t, `спецификация ${sp.id}: нет методики ${l.test}`);
      if (!t) continue;
      const limited = l.min !== undefined || l.max !== undefined;
      need(qual(t.attr) !== limited, `спецификация ${sp.id}: ${l.test} — ${qual(t.attr) ? 'у качественного свойства пределов нет' : 'нужен предел'}`);
      if (l.min !== undefined && l.max !== undefined) need(l.min <= l.max, `спецификация ${sp.id}: у ${l.test} нижний предел выше верхнего`);
      lines.push({ test: l.test, ...(l.min !== undefined ? { min: attrVal(t.attr, l.min) } : {}), ...(l.max !== undefined ? { max: attrVal(t.attr, l.max) } : {}) });
    }
    need(new Set(sp.tests.map(l => l.test)).size === sp.tests.length, `спецификация ${sp.id}: методика повторяется`);
    specs[sp.id] = { ...sp, tests: lines };
  }
  const materials: Record<string, Material> = {};
  /** методики, которые нужны входному контролю: под них в плане завода должны быть приборы */
  const needed = new Set<string>();
  for (const m of Object.values(raw.materials)) {
    const c = raw.containers[m.container];
    need(c, `материал ${m.id}: нет тары ${m.container}`);
    if (c) need(('kg' in c.capacity) === (m.unit === 'kg'), `материал ${m.id}: тара ${c.id} в других единицах`);
    const sp = raw.specs[m.spec];
    need(sp, `материал ${m.id}: нет спецификации ${m.spec}`);
    // у каждого количественного свойства спецификации — истинное среднее и разброс; у балка они — от серии (карта)
    for (const l of sp?.tests ?? []) {
      needed.add(l.test);
      const a = raw.tests[l.test]?.attr;
      if (a && !qual(a) && m.kind !== 'bulk') need(m.props[a], `материал ${m.id}: спецификация испытывает ${a}, а свойства нет`);
    }
    for (const a of Object.keys(m.props) as Attr[]) need(!qual(a), `материал ${m.id}: ${a} — качественное свойство, среднего у него нет`);
    if (m.bad) {
      const q = qual(m.bad.attr);
      need(q === (m.bad.shift === undefined), `материал ${m.id}: брак по ${m.bad.attr} — ${q ? 'без сдвига' : 'нужен сдвиг'}`);
      if (!q) need(m.props[m.bad.attr], `материал ${m.id}: брак по ${m.bad.attr}, а свойства нет`);
    }
    // проба: граммы → мг; штуки — целые
    const sample = m.unit === 'kg' ? Math.round(m.sample * 1000) : m.sample;
    if (m.unit === 'pcs') need(Number.isInteger(m.sample), `материал ${m.id}: проба — целые штуки`);
    if (c) need(sample <= ('kg' in c.capacity ? mg(c.capacity.kg) : c.capacity.pcs), `материал ${m.id}: проба больше тары`);
    const props: Material['props'] = {};
    for (const [a, v] of Object.entries(m.props) as [Attr, [number, number]][]) props[a] = [attrVal(a, v[0]), attrVal(a, v[1])];
    materials[m.id] = {
      ...m,
      unit: m.unit === 'kg' ? 'mass' : 'pcs',
      props,
      ...(m.bad ? { bad: { attr: m.bad.attr, ...(m.bad.shift !== undefined ? { shift: attrVal(m.bad.attr, m.bad.shift) } : {}) } } : {}),
      sample,
    };
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
    suppliers[s.id] = { ...s, prepay: share(s.prepay), defects: share(s.defects), items };
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
  const products: Record<string, Product> = { ...raw.products };
  for (const pr of Object.values(raw.products)) if (pr.jnvlp) need(pr.source, `продукт ${pr.id}: «в перечне ЖНВЛП» — факт, нужен источник`);
  // код продукта в номере серии — у каждого свой: иначе номера двух продуктов совпадут
  const codes = new Map<string, string>();
  for (const pr of Object.values(raw.products)) {
    const other = codes.get(pr.code);
    need(!other, `продукт ${pr.id}: код ${pr.code} уже у ${other}`);
    codes.set(pr.code, pr.id);
  }
  // модель кодом (2в): проверка — `modelErrors`
  type RawModel = z.infer<(typeof KINDS)['equipment']['schema']>['model'];
  const modelOf = (list: RawModel, foot: [number, number, number], where: string): ModelPart[] => {
    errors.push(...modelErrors(list, foot, where));
    return list.map(p => ({ ...p }));
  };
  // узлы: ресурс, ступени отказов (износ % → доли, отказов на миллион → 10⁻¹² отказа на единицу), запчасть, времена
  type RawPart = z.infer<(typeof KINDS)['equipment']['schema']>['parts'][number];
  const partsOf = (list: RawPart[], where: string, line: { micro: boolean } | undefined): PartType[] => {
    need(new Set(list.map(p => p.id)).size === list.length, `${where}: узлы повторяются`);
    return list.map(p => {
      const at = `${where}, узел ${p.id}`;
      need(raw.spares[p.spare], `${at}: нет запчасти ${p.spare}`);
      need(p.hazard[0][0] === 0, `${at}: таблица отказов начинается с износа 0 %`);
      p.hazard.forEach(([w, hz], i) => {
        if (i === 0) return;
        need(w > p.hazard[i - 1][0], `${at}: износ в таблице отказов — по возрастанию`);
        need(hz >= p.hazard[i - 1][1], `${at}: интенсивность отказов с износом не убывает (ветвь износовых отказов)`);
      });
      if (line) {
        need(!p.scatter, `${at}: разброс МОК — у оборудования стадии, не у машины линии`);
        need(!p.micro || line.micro, `${at}: у машины нет микроостановок — им нечего учащаться`);
      } else need(!p.micro, `${at}: микроостановки — у машины линии, не у оборудования стадии`);
      const scatter: PartType['scatter'] = {};
      for (const [a, v] of Object.entries(p.scatter ?? {}) as [Attr, number][]) {
        need(!qual(a), `${at}: ${a} — качественное свойство`);
        scatter[a] = attrVal(a, v);
      }
      return {
        id: p.id,
        name: p.name,
        life: p.life,
        hazard: p.hazard.map(([w, hz]) => [share(w), Math.round(hz * 1_000_000)] as [number, number]),
        spare: p.spare,
        replace: sec(p.replace),
        repair: [sec(p.repair[0]), sec(p.repair[1])] as [number, number],
        ...(p.scatter ? { scatter } : {}),
        ...(p.micro !== undefined ? { micro: share(p.micro * 100) } : {}),
      };
    });
  };
  const equipment: Record<string, EquipmentType> = {};
  for (const e of Object.values(raw.equipment)) {
    need(e.cleaning.minor <= e.cleaning.major, `оборудование ${e.id}: малая уборка дольше генеральной`);
    equipment[e.id] = {
      id: e.id,
      name: e.name,
      size: size(e.size),
      model: modelOf(e.model, e.size, `оборудование ${e.id}`),
      cleaning: { minor: sec(e.cleaning.minor), major: sec(e.cleaning.major) },
      kw: watt(e.kw),
      parts: partsOf(e.parts, `оборудование ${e.id}`, undefined),
      ...(e.source ? { source: e.source, review: e.review } : {}),
    };
  }
  // единица каждого режима — одна во всех картах: на неё считаются коэффициенты причин
  const paramUnits: Record<string, ParamUnit> = {};
  const recipes: Record<string, Recipe> = {};
  for (const r of Object.values(raw.recipes)) {
    const where = `карта ${r.id}`;
    need(raw.products[r.product], `${where}: нет продукта ${r.product}`);
    const bulk = raw.materials[r.bulk];
    need(bulk?.kind === 'bulk', `${where}: балк ${r.bulk} — не материал вида bulk`);
    for (const l of r.bom) {
      const m = raw.materials[l.material];
      need(m && (m.kind === 'api' || m.kind === 'excipient'), `${where}: в составе ${l.material} — не АФС и не вспомогательное вещество`);
      if (l.potency) need(m?.kind === 'api', `${where}: пересчёт на содержание — только у АФС`);
    }
    need(r.bom.filter(l => l.qs).length <= 1, `${where}: «до массы» — не больше одной строки`);
    need(Math.abs(r.bom.reduce((n, l) => n + l.kg, 0) - r.batch.kg) < 0.0005, `${where}: состав не сходится с массой серии`);
    need(new Set(r.stages.map(st => st.id)).size === r.stages.length, `${where}: стадии повторяются`);
    // первое смешивание — одна стадия, и не отвешивание: от неё дата производства и месяц и год в номере серии
    need(r.stages.filter(st => st.mix).length === 1, `${where}: нужна ровно одна стадия первого смешивания (mix)`);
    need(!r.stages[0].mix, `${where}: первое смешивание — не отвешивание`);
    const stages: RecipeStage[] = r.stages.map(st => {
      const at = `${where}, стадия ${st.id}`;
      for (const e of st.equipment) need(raw.equipment[e], `${at}: нет оборудования ${e}`);
      need(raw.roles[st.staff.role], `${at}: нет роли ${st.staff.role}`);
      const t = st.time;
      need(t.loads === undefined || t.perLoad !== undefined, `${at}: загрузки без времени на загрузку`);
      need(!(t.kgPerHour && t.unitsPerHour), `${at}: скорость — либо кг, либо штуки в час`);
      for (const p of st.params) {
        need(p.range[0] <= p.target && p.target <= p.range[1], `${at}: цель режима ${p.id} вне диапазона`);
        need(!paramUnits[p.id] || paramUnits[p.id] === p.unit, `${at}: режим ${p.id} в других единицах, чем в другой карте`);
        paramUnits[p.id] = p.unit;
      }
      need(new Set(st.params.map(p => p.id)).size === st.params.length, `${at}: режимы повторяются`);
      const ipc = st.ipc.map(c => {
        const m = raw.tests[c.test];
        need(m, `${at}: нет методики ${c.test}`);
        need(m && !qual(m.attr) && (c.min !== undefined || c.max !== undefined), `${at}: МОК ${c.test} — нужен предел`);
        const a = m?.attr ?? 'assay';
        return {
          test: c.test,
          ...(c.every !== undefined ? { every: sec(c.every) } : {}),
          ...(c.min !== undefined ? { min: attrVal(a, c.min) } : {}),
          ...(c.max !== undefined ? { max: attrVal(a, c.max) } : {}),
        };
      });
      const sc = (u: ParamUnit, v: number) => Math.round(v * PARAM_SCALE[u]);
      return {
        id: st.id,
        room: st.room,
        equipment: st.equipment,
        staff: st.staff,
        time: {
          setup: sec(t.setup),
          ...(t.perLoad !== undefined ? { perLoad: sec(t.perLoad), loads: t.loads ?? 1 } : {}),
          ...(t.perComponent !== undefined ? { perComponent: sec(t.perComponent) } : {}),
          ...(t.kgPerHour !== undefined ? { mgPerHour: mg(t.kgPerHour) } : {}),
          ...(t.unitsPerHour !== undefined ? { unitsPerHour: Math.round(t.unitsPerHour) } : {}),
          spread: share(t.spread),
        },
        params: st.params.map(p => ({ id: p.id, unit: p.unit, target: sc(p.unit, p.target), range: [sc(p.unit, p.range[0]), sc(p.unit, p.range[1])] as [number, number], sd: sc(p.unit, p.sd) })),
        ipc,
        loss: [share(st.loss[0]), share(st.loss[1])] as [number, number],
        // сито калибратора по карте: мм → мкм
        ...(st.screen !== undefined ? { screen: Math.round(st.screen * 1000) } : {}),
        ...(st.mix ? { mix: true as const } : {}),
      };
    });
    // показатели балка: всё, что испытывает его спецификация, — с номиналом
    const quality: Recipe['quality'] = {};
    for (const [a, v] of Object.entries(r.quality) as [Attr, [number, number]][]) {
      need(!qual(a), `${where}: ${a} — качественное свойство, номинала у него нет`);
      quality[a] = [attrVal(a, v[0]), attrVal(a, v[1])];
    }
    for (const l of (bulk && raw.specs[bulk.spec]?.tests) ?? []) {
      const a = raw.tests[l.test]?.attr;
      if (a && !qual(a)) need(r.quality[a], `${where}: спецификация балка испытывает ${a}, а номинала нет`);
    }
    recipes[r.id] = {
      id: r.id,
      name: r.name,
      product: r.product,
      batch: { mass: mg(r.batch.kg), units: r.batch.units },
      bom: r.bom.map(l => ({ material: l.material, qty: mg(l.kg), ...(l.potency ? { potency: true } : {}), ...(l.qs ? { qs: true } : {}) })),
      stages,
      bulk: r.bulk,
      quality,
      yield: { expected: share(r.yield.expected), alarm: share(r.yield.alarm) },
      ...(r.source ? { source: r.source, review: r.review } : {}),
    };
  }
  // причины: коэффициент — из «единиц показателя на единицу отхода» записи в единицы движка
  const causes: Record<string, Cause> = {};
  for (const c of Object.values(raw.causes)) {
    const where = `причина ${c.id}`;
    const d = c.driver;
    let per = 1;
    if ('param' in d) {
      need(paramUnits[d.param], `${where}: режима ${d.param} нет ни в одной карте`);
      per = PARAM_SCALE[paramUnits[d.param] ?? 'rpm'];
    } else if ('potency' in d) per = 100;
    else if ('wear' in d) {
      need(Object.values(raw.equipment).some(e => e.parts.some(p => p.id === d.wear)), `${where}: узла ${d.wear} нет ни у одного оборудования`);
      per = 100;
    } else if ('screen' in d) {
      need(Object.values(raw.recipes).some(r => r.stages.some(st => st.screen !== undefined)), `${where}: сита нет ни в одной карте`);
      // коэффициент — на мм сита крупнее карты, отход в движке — мкм
      per = 1000;
    } else per = scaleOf(d.attr);
    for (const e of c.effects) need(!qual(e.attr), `${where}: ${e.attr} — качественное свойство`);
    causes[c.id] = { ...c, effects: c.effects.map(e => ({ attr: e.attr, coef: (e.coef * scaleOf(e.attr)) / per })) };
  }
  // машины линии: секунды и доли
  const machines: Record<string, Machine> = {};
  for (const m of Object.values(raw.machines)) {
    need(raw.roles[m.crew.role], `машина ${m.id}: нет роли ${m.crew.role}`);
    if (m.micro) need(m.micro.duration < m.micro.every, `машина ${m.id}: микроостановка дольше промежутка между ними`);
    machines[m.id] = {
      id: m.id,
      name: m.name,
      size: size(m.size),
      model: modelOf(m.model, m.size, `машина ${m.id}`),
      item: m.item,
      nominal: m.nominal,
      crew: m.crew,
      ...(m.micro ? { micro: { every: sec(m.micro.every), duration: sec(m.micro.duration) } } : {}),
      reject: share(m.reject),
      changeover: sec(m.changeover),
      kw: watt(m.kw),
      parts: partsOf(m.parts, `машина ${m.id}`, { micro: m.micro !== undefined }),
      ...(m.jam ? { jam: { cartons: m.jam.cartons, uncounted: share(m.jam.uncounted) } } : {}),
      ...(m.source ? { source: m.source, review: m.review } : {}),
    };
    if (m.jam) need(m.micro && m.item === 'carton', `машина ${m.id}: заминка — микроостановка машины, которая работает с пачками`);
  }
  // товарные позиции: готовая продукция, материалы на блистер (г → мг) и на пачку, ящик и паллета
  const skus: Record<string, Sku> = {};
  for (const k of Object.values(raw.skus)) {
    const where = `позиция ${k.id}`;
    need(raw.products[k.product], `${where}: нет продукта ${k.product}`);
    const fg = raw.materials[k.fg];
    need(fg?.kind === 'fg' && fg.unit === 'pcs', `${where}: ${k.fg} — не готовая продукция в пачках (вид fg)`);
    for (const l of k.blister) {
      const m = raw.materials[l.material];
      need(m?.kind === 'packaging' && m.unit === 'kg', `${where}: на блистер ${l.material} — не упаковочный материал по массе`);
    }
    for (const l of [...k.carton, { material: k.case.material }]) {
      const m = raw.materials[l.material];
      need(m?.kind === 'packaging' && m.unit === 'pcs', `${where}: ${l.material} — не упаковочный материал в штуках`);
    }
    need(new Set([...k.blister, ...k.carton].map(l => l.material)).size === k.blister.length + k.carton.length, `${where}: материал повторяется`);
    const ct = fg && raw.containers[fg.container];
    if (ct) {
      need('pcs' in ct.capacity && ct.capacity.pcs >= k.case.per, `${where}: в ящик ${ct.id} не входит ${k.case.per} пачек`);
      need(k.pallet.cases <= ct.perPallet, `${where}: на паллету ${ct.id} не входит ${k.pallet.cases} ящиков`);
    }
    // цена ЖНВЛП — не выше зарегистрированной предельной (61-ФЗ, ст. 61, ч. 8)
    if (raw.products[k.product]?.jnvlp) need(k.regPrice !== undefined, `${where}: продукт в перечне ЖНВЛП — нужна зарегистрированная цена`);
    if (k.regPrice !== undefined) need(k.price <= k.regPrice, `${where}: цена ${k.price} ₽ выше зарегистрированной ${k.regPrice} ₽`);
    skus[k.id] = {
      ...k,
      blister: k.blister.map(l => ({ material: l.material, qty: Math.round(l.g * 1000) })),
      carton: k.carton.map(l => ({ material: l.material, qty: l.n })),
      price: kop(k.price),
      ...(k.regPrice !== undefined ? { regPrice: kop(k.regPrice) } : {}),
    };
  }
  const plants: Record<string, Plant> = {};
  for (const p of Object.values(raw.plants)) {
    const r4 = (r: [number, number, number, number]): [number, number, number, number] => [cm(r[0]), cm(r[1]), cm(r[2]), cm(r[3])];
    plants[p.id] = {
      id: p.id,
      building: r4(p.building),
      docks: p.docks.map(d => ({ ...d, x: cm(d.x), z: cm(d.z) })),
      zones: p.zones.map(zn => ({ ...zn, rect: r4(zn.rect) })),
      racks: p.racks.map(r => ({ ...r, x: cm(r.x), z: cm(r.z) })),
      rooms: p.rooms.map(r => ({ id: r.id, type: r.type, rect: r4(r.rect), grade: r.grade, vehicles: r.vehicles, ...(r.at ? { at: at2(r.at) } : {}) })),
      doors: p.doors.map(d => ({ cell: d.at, len: d.len, along: d.along, kind: d.kind, ...(d.materials ? { materials: true } : {}) })),
      instruments: p.instruments,
      equipment: p.equipment.map(e => ({ ...e, at: at2(e.at) })),
      lines: p.lines.map(ln => ({ ...ln, machines: ln.machines.map(m => ({ ...m, at: at2(m.at) })) })),
      points: { park: [cm(p.points.park[0]), cm(p.points.park[1])], entrance: [cm(p.points.entrance[0]), cm(p.points.entrance[1])] },
      posts: Object.fromEntries(Object.entries(p.posts).map(([role, at]) => [role, at2(at)])),
      energy: { hvac: p.energy.hvac, base: watt(p.energy.base) },
    };
    need(p.docks.some(d => d.kind === 'out') === p.zones.some(z => z.kind === 'shipping'), `план ${p.id}: рампа отгрузки и зона экспедиции бывают только вместе`);
    const ids = [
      ...p.docks.map(d => d.id),
      ...p.zones.map(z => z.id),
      ...p.racks.map(r => r.id),
      ...p.rooms.map(r => r.id),
      ...p.instruments.map(i => i.id),
      ...p.equipment.map(e => e.id),
      ...p.lines.flatMap(l => [l.id, ...l.machines.map(m => m.id)]),
    ];
    need(new Set(ids).size === ids.length, `план ${p.id}: имена рамп, зон, стеллажей, помещений, приборов, оборудования, линий и машин повторяются`);
    // линия: помещение, зона паллетирования на выходе; первая машина делает блистеры, остальные работают с пачками;
    // накопитель — после каждой машины, кроме последней
    for (const ln of p.lines) {
      need(p.rooms.some(r => r.id === ln.room), `план ${p.id}: линия ${ln.id} — нет помещения ${ln.room}`);
      need(p.zones.some(z => z.id === ln.out && z.kind === 'palletizing'), `план ${p.id}: линия ${ln.id} — нет зоны паллетирования ${ln.out}`);
      ln.machines.forEach((m, i) => {
        const mt = raw.machines[m.type];
        need(mt, `план ${p.id}: машина ${m.id} — нет вида ${m.type}`);
        const last = i === ln.machines.length - 1;
        need(last === (m.buffer === undefined), `план ${p.id}: машина ${m.id} — ${last ? 'после последней машины накопителя нет' : 'после машины нужен накопитель'}`);
        if (mt) need((i === 0) === (mt.item === 'blister'), `план ${p.id}: линия ${ln.id} — первая машина делает блистеры, остальные работают с пачками`);
      });
    }
    need(new Set(p.rooms.map(r => r.type)).size === p.rooms.length, `план ${p.id}: тип помещения повторяется — стадия не знает, куда идти`);
    for (const e of p.equipment) {
      need(raw.equipment[e.type], `план ${p.id}: оборудование ${e.id} — нет вида ${e.type}`);
      need(p.rooms.some(r => r.id === e.room), `план ${p.id}: оборудование ${e.id} — нет помещения ${e.room}`);
    }
    for (const k of ['receiving', 'quarantine', 'rejected', 'staging', 'sampling'] as const) need(p.zones.some(z => z.kind === k), `план ${p.id}: нет зоны «${k}»`);
    need(p.docks.some(d => d.kind === 'in'), `план ${p.id}: нет рампы приёмки`);
    need(p.rooms.some(r => r.type === 'lab'), `план ${p.id}: нет лаборатории`);
    // узлы с износом чинит слесарь: запчасти — в мастерской, она вне чистой зоны (GMP ЕАЭС, ч. I, п. 3.32)
    const worn = p.equipment.some(e => raw.equipment[e.type]?.parts.length) || p.lines.some(l => l.machines.some(m => raw.machines[m.type]?.parts.length));
    if (worn) need(p.rooms.some(r => r.type === 'workshop' && r.grade === 'cnc'), `план ${p.id}: у машин есть узлы — нужна мастерская вне чистой зоны (тип workshop, класс cnc)`);
    for (const role of Object.keys(p.posts)) need(raw.roles[role], `план ${p.id}: пост у неизвестной роли ${role}`);
    for (const i of p.instruments) {
      need(raw.instruments[i.type], `план ${p.id}: прибор ${i.id} — нет вида ${i.type}`);
      need(p.rooms.some(r => r.id === i.room), `план ${p.id}: прибор ${i.id} — нет помещения ${i.room}`);
    }
    // входной контроль: под каждую нужную методику с прибором — прибор этого вида
    for (const tid of needed) {
      const inst = raw.tests[tid]?.inst;
      if (inst) need(p.instruments.some(i => i.type === inst), `план ${p.id}: нет прибора ${inst} для ${tid}`);
    }
  }
  // модели расследования: доли — 1/10 000, минуты — секунды; версии, улики, шаги и их ссылки — сверены
  const investigations: Record<string, InvModel> = {};
  for (const m of Object.values(raw.investigations)) {
    const where = `расследование ${m.id}`;
    need(tests[m.test], `${where}: нет методики ${m.test}`);
    const ids = new Set(m.candidates.map(c => c.id));
    need(ids.size === m.candidates.length, `${where}: версии повторяются`);
    for (const c of m.candidates) if (c.cause) need(causes[c.cause], `${where}: нет причины ${c.cause}`);
    const fids = new Set(m.findings.map(f => f.id));
    need(fids.size === m.findings.length, `${where}: улики повторяются`);
    for (const f of m.findings) {
      for (const c of Object.keys(f.by)) need(ids.has(c), `${where}: улика ${f.id} — нет версии ${c}`);
      const r = f.read;
      if ('ipc' in r) need(tests[r.ipc], `${where}: улика ${f.id} — нет методики ${r.ipc}`);
      if ('param' in r) need(paramUnits[r.param], `${where}: улика ${f.id} — режима ${r.param} нет ни в одной карте`);
    }
    need(new Set(m.steps.map(st => st.id)).size === m.steps.length, `${where}: шаги повторяются`);
    for (const st of m.steps) {
      const at = `${where}, шаг ${st.id}`;
      need((st.test !== undefined) !== (st.role !== undefined && st.work !== undefined), `${at}: шаг — либо испытание, либо работа роли с её временем`);
      if (st.role) need(roles[st.role], `${at}: нет роли ${st.role}`);
      if (st.test) need(tests[st.test], `${at}: нет методики ${st.test}`);
      if (st.retest) need(st.test === m.test, `${at}: повторное испытание — той же методикой, что открыла расследование`);
      if (st.at) need(raw.equipment[st.at], `${at}: нет оборудования ${st.at}`);
      for (const c of st.checks) need(fids.has(c.f), `${at}: нет улики ${c.f}`);
    }
    // пределы улик — в единицах движка свойства или методики МОК
    const findings = m.findings.map(f => {
      const r = f.read;
      const read: FindingRead =
        'ipc' in r
          ? { ipc: r.ipc, ...(r.below !== undefined ? { below: attrVal(tests[r.ipc].attr, r.below) } : {}), ...(r.above !== undefined ? { above: attrVal(tests[r.ipc].attr, r.above) } : {}) }
          : 'coa' in r
            ? { coa: r.coa, above: attrVal(r.coa, r.above) }
            : 'measure' in r
              ? { measure: r.measure, above: attrVal(r.measure, r.above) }
              : r;
      return { id: f.id, name: f.name, leak: share(f.leak), by: Object.fromEntries(Object.entries(f.by).map(([c, v]) => [c, share(v)])), read };
    });
    investigations[m.id] = {
      id: m.id,
      name: m.name,
      test: m.test,
      threshold: share(m.threshold),
      minGain: m.minGain,
      candidates: m.candidates.map(c => ({ id: c.id, name: c.name, ...(c.cause ? { cause: c.cause } : {}), prior: share(c.prior) })),
      findings,
      steps: m.steps.map(st => ({
        id: st.id,
        name: st.name,
        ...(st.role ? { role: st.role } : {}),
        ...(st.work !== undefined ? { work: sec(st.work) } : {}),
        ...(st.at ? { at: st.at } : {}),
        ...(st.test ? { test: st.test } : {}),
        ...(st.retest ? { retest: true as const } : {}),
        checks: st.checks.map(c => ({ f: c.f, sens: share(c.sens), spec: share(c.spec) })),
      })),
      source: m.source,
      review: m.review,
    };
  }
  /** Происшествие: номер задания — в пределах сценария; величины — в единицы движка. */
  const incidentOf = (x: NonNullable<RawScenario['incident']>, batches: number, where: string): IncidentDef => {
    need(investigations[x.inv], `${where}: нет модели расследования ${x.inv}`);
    need(x.batch <= batches, `${where}: в сценарии нет задания на серию ${x.batch}`);
    const range = ([a, b]: [number, number], k: number): [number, number] => [Math.round(a * k), Math.round(b * k)];
    for (const [k, [a, b]] of Object.entries(x.sizes)) need(a <= b, `${where}: величина ${k} — «от» больше «до»`);
    return {
      batch: x.batch,
      inv: x.inv,
      roots: Object.fromEntries(Object.entries(x.roots).map(([k, v]) => [k, share(v)])),
      sizes: { lab: range(x.sizes.lab, 100), lube: range(x.sizes.lube, PARAM_SCALE.min), force: range(x.sizes.force, PARAM_SCALE.kN), screen: range(x.sizes.screen, 1000) },
    };
  };
  const scenarios: Record<string, Scenario> = {};
  for (const s of Object.values(raw.scenarios)) {
    const where = `сценарий ${s.id}`;
    need(raw.profiles[s.profile], `${where}: нет профиля ${s.profile}`);
    need(plants[s.plant], `${where}: нет плана ${s.plant}`);
    for (const r of s.staff) {
      need(roles[r.role], `${where}: нет роли ${r.role}`);
      need(shifts[r.shift], `${where}: нет графика ${r.shift}`);
      need(raw.plants[s.plant]?.posts[r.role], `${where}: у роли ${r.role} нет поста в плане ${s.plant}`);
    }
    for (const v of s.vehicles) need(vehicles[v.type], `${where}: нет техники ${v.type}`);
    for (const c of s.customers) need(raw.customers[c], `${where}: нет покупателя ${c}`);
    if (s.customers.length > 0) need(raw.plants[s.plant]?.docks.some(d => d.kind === 'out'), `${where}: покупатели есть, а рампы отгрузки в плане нет`);
    // задания на серию: у каждой стадии карты в плане — помещение этого типа и оборудование в нём
    const pl = raw.plants[s.plant];
    for (const b of s.batches) {
      const r = raw.recipes[b.recipe];
      need(r, `${where}: нет карты ${b.recipe}`);
      for (const st of r?.stages ?? []) {
        const room = pl?.rooms.find(x => x.type === st.room);
        need(room, `${where}: для стадии ${st.id} нет помещения «${st.room}»`);
        for (const e of st.equipment) need(room && pl.equipment.some(x => x.room === room.id && x.type === e), `${where}: в помещении «${st.room}» нет ${e}`);
      }
      // товарная позиция: того же продукта, что карта, и линия в плане, где её упаковать
      if (b.sku) {
        const k = raw.skus[b.sku];
        need(k, `${where}: нет товарной позиции ${b.sku}`);
        if (k && r) need(k.product === r.product, `${where}: позиция ${b.sku} — не того продукта, что карта ${b.recipe}`);
        need(pl && pl.lines.length > 0, `${where}: в плане нет упаковочной линии для ${b.sku}`);
      }
    }
    // план выпуска: карта — та же проверка помещений и оборудования, позиция — того же продукта; у каждого материала
    // карты и упаковки позиции — одобренный поставщик, иначе коллеге снабжения не у кого заказать
    for (const it of s.plan?.items ?? []) {
      const r = raw.recipes[it.recipe];
      const k = raw.skus[it.sku];
      need(r, `${where}: в плане нет карты ${it.recipe}`);
      need(k, `${where}: в плане нет товарной позиции ${it.sku}`);
      if (k && r) need(k.product === r.product, `${where}: в плане позиция ${it.sku} — не того продукта, что карта ${it.recipe}`);
      for (const st of r?.stages ?? []) {
        const room = pl?.rooms.find(x => x.type === st.room);
        need(room, `${where}: для стадии ${st.id} нет помещения «${st.room}»`);
        for (const e of st.equipment) need(room && pl.equipment.some(x => x.room === room.id && x.type === e), `${where}: в помещении «${st.room}» нет ${e}`);
      }
      if (s.supply) {
        const mats = [...(r?.bom ?? []).map(l => l.material), ...(k ? [...k.blister, ...k.carton].map(l => l.material) : []), ...(k ? [k.case.material] : [])];
        for (const m of mats) need(Object.values(raw.suppliers).some(x => x.approved && x.items[m]), `${where}: ${m} никто из одобренных поставщиков не продаёт`);
      }
    }
    for (const o of s.orders) {
      const sup = suppliers[o.supplier];
      need(sup, `${where}: нет поставщика ${o.supplier}`);
      for (const l of o.lines) need(sup?.items[l.material], `${where}: ${o.supplier} не продаёт ${l.material}`);
    }
    // износ и политика техслужбы — по узлам машин плана: `<машина>/<узел>`
    const parts = new Set<string>();
    for (const e of pl?.equipment ?? []) for (const pt of raw.equipment[e.type]?.parts ?? []) parts.add(`${e.id}/${pt.id}`);
    for (const l of pl?.lines ?? []) for (const mc of l.machines) for (const pt of raw.machines[mc.type]?.parts ?? []) parts.add(`${mc.id}/${pt.id}`);
    for (const k of [...Object.keys(s.wear), ...Object.keys(s.maint)]) need(parts.has(k), `${where}: в плане нет узла ${k}`);
    need(new Set(s.seats).size === s.seats.length, `${where}: место повторяется в seats`);
    const [y, m, d] = s.start.date.split('-').map(Number);
    scenarios[s.id] = {
      ...s,
      start: { date: { y, m, d }, hour: s.start.hour },
      cash: kop(s.cash),
      credit: { limit: kop(s.credit.limit), spread: share(s.credit.spread) },
      energy: { price: kop(s.energy.price) },
      orders: s.orders.map(o => ({ supplier: o.supplier, lines: o.lines.map(l => ({ material: l.material, qty: amount(l.material, l.qty, where) })) })),
      stock: s.stock.map(x => ({ material: x.material, qty: amount(x.material, x.qty, where) })),
      wear: Object.fromEntries(Object.entries(s.wear).map(([k, v]) => [k, share(v)])),
      maint: Object.fromEntries(Object.entries(s.maint).map(([k, v]) => [k, share(v)])),
      norm: share(s.norm),
      ...(s.incident ? { incident: incidentOf(s.incident, s.batches.length, where) } : {}),
    };
  }
  const profiles: Record<string, Profile> = {};
  for (const p of Object.values(raw.profiles)) {
    need(p.payroll.night.from !== p.payroll.night.to, `профиль ${p.id}: у ночных часов нет длины`);
    profiles[p.id] = {
      ...p,
      vat: { medicines: share(p.vat.medicines), general: share(p.vat.general) },
      marking: { ...p.marking, fee: kop(p.marking.fee), free: kop(p.marking.free) },
      payroll: {
        night: { ...p.payroll.night, extra: share(p.payroll.night.extra) },
        contrib: { ...p.payroll.contrib, rate: share(p.payroll.contrib.rate), base: kop(p.payroll.contrib.base), above: share(p.payroll.contrib.above), injury: share(p.payroll.contrib.injury) },
      },
      energy: { advances: p.energy.advances.map(([d, pct]) => [d, share(pct)] as [number, number]), final: p.energy.final },
      key: share(p.key),
    };
  }
  // запчасти: поставщик из базы, цена — копейки
  const spares: Record<string, Spare> = {};
  for (const sp of Object.values(raw.spares)) {
    need(suppliers[sp.supplier], `запчасть ${sp.id}: нет поставщика ${sp.supplier}`);
    spares[sp.id] = { ...sp, price: kop(sp.price) };
  }
  // покупатели: дни недели — с нуля (0 — понедельник), спрос — только по позициям из базы
  const customers: Record<string, Customer> = {};
  for (const c of Object.values(raw.customers)) {
    for (const sku of Object.keys(c.demand)) need(skus[sku], `покупатель ${c.id}: нет позиции ${sku}`);
    customers[c.id] = { ...c, order: { ...c.order, days: [...new Set(c.order.days)].sort().map(d => d - 1) }, minShelf: share(c.minShelf) };
  }
  return {
    profiles,
    scenarios,
    investigations,
    units: raw.units as Record<string, UnitType>,
    materials,
    containers,
    suppliers,
    roles,
    vehicles,
    shifts,
    plants,
    instruments,
    tests,
    specs,
    products,
    equipment,
    recipes,
    causes,
    machines,
    skus,
    customers,
    spares,
  };
}
