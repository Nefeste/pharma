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
  type EquipmentType,
  type InstrumentType,
  type Machine,
  type Material,
  PARAM_SCALE,
  type ParamUnit,
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
  type Spec,
  type SpecLine,
  type Supplier,
  type TestMethod,
  type UnitType,
  type VehicleType,
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
const sec = (min: number) => Math.round(min * 60);
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
  const equipment: Record<string, EquipmentType> = {};
  for (const e of Object.values(raw.equipment)) {
    need(e.cleaning.minor <= e.cleaning.major, `оборудование ${e.id}: малая уборка дольше большой`);
    equipment[e.id] = { ...e, cleaning: { minor: sec(e.cleaning.minor), major: sec(e.cleaning.major) } };
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
    else per = scaleOf(d.attr);
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
      item: m.item,
      nominal: m.nominal,
      crew: m.crew,
      ...(m.micro ? { micro: { every: sec(m.micro.every), duration: sec(m.micro.duration) } } : {}),
      reject: share(m.reject),
      changeover: sec(m.changeover),
      ...(m.source ? { source: m.source, review: m.review } : {}),
    };
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
    skus[k.id] = {
      ...k,
      blister: k.blister.map(l => ({ material: l.material, qty: Math.round(l.g * 1000) })),
      carton: k.carton.map(l => ({ material: l.material, qty: l.n })),
    };
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
      instruments: p.instruments,
      equipment: p.equipment,
      lines: p.lines,
      points: { park: [cm(p.points.park[0]), cm(p.points.park[1])], entrance: [cm(p.points.entrance[0]), cm(p.points.entrance[1])] },
    };
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
    instruments,
    tests,
    specs,
    products,
    equipment,
    recipes,
    causes,
    machines,
    skus,
  };
}
