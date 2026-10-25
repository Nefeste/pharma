// Сборка базы игры из content/ (docs/02-architecture.md, §12; docs/04-data-model.md, §3). Каждый файл — одна запись.
// Правила:
// - идентификатор вечный и совпадает с путём: content/units/pallet/euro.yaml → unit.pallet.euro (ADR студии 0004);
// - запись проходит строгую схему (schema.ts);
// - ссылки между записями разрешаются;
// - ключи источников есть в таблице docs/10-domain.md, §9;
// - коды материалов и документов уникальны и по формату, у редакций документа — разные дни введения, и на начало
//   сценария действует всё, что ему нужно (Б3а);
// - кто делает работу, тот и учится по её процедурам и методикам: каждая роль, которой движок даёт работу с требованием,
//   есть в матрице обучения документа (Б3б);
// - места (Б3в): коды участков, рабочих мест и мест — по формату и не повторяются; помещение — не больше чем в одном
//   участке; вещь плана — на рабочем месте своего вида, в помещении его участка; у зоны хранения — режим и один датчик;
//   у стадии с МОК — прибор каждого испытания в её помещении; каждому материалу есть зона хранения по режиму;
// - числа переводятся в единицы движка (docs/04-data-model.md, §2): кг → мг, г → мг, ₽ → копейки, м → см, % → доли
//   1/10 000, минуты → секунды.
// Ошибка любой записи останавливает сборку: база с битой ссылкой в игру не попадает.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import type { z } from 'zod';
import {
  type Agreement,
  ATTR_SCALE,
  ATTRS,
  type AssetWork,
  type Attr,
  type Cause,
  type ContainerType,
  type ContentDb,
  type Customer,
  type DocHead,
  type EquipmentType,
  type FindingRead,
  type IncidentDef,
  type Labor,
  type LeaveRule,
  type InstrumentType,
  type InvModel,
  type Machine,
  type Maker,
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
  type Regime,
  type Role,
  type Scenario,
  type Shift,
  type Sku,
  type Sop,
  type Spare,
  type Spec,
  type SpecLine,
  type Supplier,
  type TaskKind,
  type TestMethod,
  type UnitType,
  type VehicleType,
} from '../../src/content/types';
import { ACCEPT } from '../../src/engine/assets';
import { civilFromDays, daysFromCivil, weekday } from '../../src/engine/core/calendar';
import { fnv1a, stableJson } from '../../src/engine/core/hash';
import { DOC_KINDS, type DocKind, headOf, inForce, revisions } from '../../src/engine/docs';
import { QC } from '../../src/engine/lab';
import { LINE } from '../../src/engine/line';
import { MAINT } from '../../src/engine/maint';
import { MES, stageNorm } from '../../src/engine/mes';
import { agreementFor, REVIEWERS, STARTING } from '../../src/engine/partners';
import { accepts, areaCode, CENTER_OF, centerCode, classOf, coldOf, placesOf, rackStore, roomAt } from '../../src/engine/places';
import { type DraftPerson, placeDraft } from '../../src/engine/leave';
import { QA } from '../../src/engine/qa';
import { cycleErrors, shiftLengths } from '../../src/engine/shifts';
import { CHECKERS } from '../../src/engine/train';
import { WMS } from '../../src/engine/wms';
import { KINDS, type Kind, WORKS } from './schema';
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
/** Номер дня от 1970-01-01 по дате `ГГГГ-ММ-ДД`; такой даты нет в календаре — −1. */
function dayOf(text: string): number {
  const [y, m, d] = text.split('-').map(Number);
  const z = daysFromCivil({ y, m, d });
  const back = civilFromDays(z);
  return back.y === y && back.m === m && back.d === d ? z : -1;
}
/** Первая цифра внутреннего кода материала — его вид (Б3а); у запчасти — 6. */
const CODE_KIND: Record<Material['kind'] | 'spare', string> = { api: '1', excipient: '2', packaging: '3', bulk: '4', fg: '5', spare: '6' };
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

/** Сборка из `content/` — или из другой папки того же устройства: так тесты проверяют ошибки на испорченной копии. */
export function buildDb(content = CONTENT): Built {
  const errors: string[] = [];
  const known = sourceKeys();
  const raw = Object.fromEntries(Object.keys(KINDS).map(k => [k, {}])) as Raw;
  let count = 0;

  for (const kind of Object.keys(KINDS) as Kind[]) {
    const { prefix, schema } = KINDS[kind];
    const dir = join(content, kind);
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
  // план — когда ссылки целы: сетка, двери, шлюзы, что достижимо (plan.ts); стадии — в смены своих ролей (Б4а)
  if (errors.length === 0) {
    for (const id of Object.keys(db.plants)) {
      try {
        errors.push(...planErrors({ hash: '', ...db }, id));
      } catch (e) {
        errors.push(`план ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    errors.push(...stageErrors({ hash: '', ...db }));
    errors.push(...leaveErrors({ hash: '', ...db }));
  }
  const hash = fnv1a(stableJson(db)).toString(16).padStart(8, '0');
  return { db: { hash, ...db }, errors, files: count };
}

/** Перевод в единицы движка и проверка ссылок. */
function convert(raw: Raw, errors: string[]): Omit<ContentDb, 'hash'> {
  const need = (ok: unknown, msg: string) => {
    if (!ok) errors.push(msg);
  };
  /** Шапка документа: день введения — номером дня; утвердил — роль из базы. */
  const headDoc = (d: { code: string; rev: number; from: string; approved: string }, where: string): DocHead => {
    const from = dayOf(d.from);
    need(from >= 0, `${where}: даты ${d.from} нет в календаре`);
    need(raw.roles[d.approved], `${where}: утвердил ${d.approved} — нет такой роли`);
    return { code: d.code, rev: d.rev, from, approved: d.approved };
  };
  /** Работа подрядчика (Б3в): часы — в секунды, рубли — в копейки. */
  const workOf = (w: { every: number; hours: number; price: number; name: InstrumentType['name']; verify?: true } | undefined): AssetWork | undefined =>
    w && { every: w.every, work: Math.round(w.hours * 3600), price: kop(w.price), name: w.name, ...(w.verify ? { verify: true as const } : {}) };
  const works = (x: { qual?: Parameters<typeof workOf>[0]; cal?: Parameters<typeof workOf>[0]; critical?: true }) => ({
    ...(x.qual ? { qual: workOf(x.qual)! } : {}),
    ...(x.cal ? { cal: workOf(x.cal)! } : {}),
    ...(x.critical ? { critical: true as const } : {}),
  });
  const instruments: Record<string, InstrumentType> = {};
  for (const i of Object.values(raw.instruments)) instruments[i.id] = { id: i.id, name: i.name, ...works(i), cal: workOf(i.cal)!, ...(i.source ? { source: i.source, review: i.review } : {}) };
  // режимы хранения (Б3в): °C — в десятые, % — в доли 1/10 000
  const regimes: Record<string, Regime> = {};
  for (const r of Object.values(raw.regimes)) regimes[r.id] = { ...r, temp: [Math.round(r.temp[0] * 10), Math.round(r.temp[1] * 10)], rh: share(r.rh) };
  const tests: Record<string, TestMethod> = {};
  for (const t of Object.values(raw.tests)) {
    if (t.inst) need(raw.instruments[t.inst], `методика ${t.id}: нет прибора ${t.inst}`);
    need(!t.unattended || t.inst, `методика ${t.id}: без прибора сама не работает`);
    need(!qual(t.attr) || t.sd === 0, `методика ${t.id}: ${t.attr} — качественное свойство, погрешности у него нет`);
    const { hours, ...rest } = t;
    for (const r of t.roles) need(raw.roles[r], `методика ${t.id}: учится роль ${r} — нет такой роли`);
    tests[t.id] = { ...rest, doc: headDoc(t.doc, `методика ${t.id}`), prep: sec(t.prep), run: sec(t.run), sd: attrVal(t.attr, t.sd), study: sec(hours * 60) };
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
    specs[sp.id] = { ...sp, doc: headDoc(sp.doc, `спецификация ${sp.id}`), tests: lines };
  }
  const materials: Record<string, Material> = {};
  /** методики, которые нужны входному контролю: под них в плане завода должны быть приборы */
  const needed = new Set<string>();
  for (const m of Object.values(raw.materials)) {
    const c = raw.containers[m.container];
    need(c, `материал ${m.id}: нет тары ${m.container}`);
    need(raw.regimes[m.storage], `материал ${m.id}: нет режима хранения ${m.storage}`);
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
  // изготовители (Б3г): выпускают исходные и упаковочные материалы из базы
  const makers: Record<string, Maker> = {};
  for (const x of Object.values(raw.makers)) {
    for (const m of x.makes) need(STARTING.has(materials[m]?.kind), `изготовитель ${x.id}: ${m} — не исходный и не упаковочный материал из базы`);
    makers[x.id] = { ...x };
  }
  // поставщики (Б3г): изготовитель материала — у поставщика-изготовителя он сам; изготовитель его выпускает
  const suppliers: Record<string, Supplier> = {};
  for (const s of Object.values(raw.suppliers)) {
    const where = `поставщик ${s.id}`;
    if (s.maker) need(makers[s.maker], `${where}: нет изготовителя ${s.maker}`);
    const items: Supplier['items'] = {};
    for (const [mid, it] of Object.entries(s.items)) {
      const mk = it.maker ?? s.maker ?? '';
      need(mk, `${where}: у ${mid} не сказано, кто изготовил, — у дистрибьютора изготовитель у каждого материала`);
      if (s.maker && it.maker) need(it.maker === s.maker, `${where}: поставщик-изготовитель продаёт своё, а ${mid} — от ${it.maker}`);
      if (mk) need(makers[mk]?.makes.includes(mid), `${where}: ${mk} не выпускает ${mid}`);
      items[mid] = { price: kop(it.price), moq: amount(mid, it.moq, where), maker: mk };
    }
    suppliers[s.id] = { ...s, prepay: share(s.prepay), defects: share(s.defects), items };
  }
  const roles: Record<string, Role> = {};
  for (const r of Object.values(raw.roles)) roles[r.id] = { ...r, salary: kop(r.salary) };
  const vehicles: Record<string, VehicleType> = {};
  for (const v of Object.values(raw.vehicles)) vehicles[v.id] = { ...v, speedEmpty: cm(v.speedEmpty), speedLoaded: cm(v.speedLoaded) };
  // график — пятидневка или сменный по циклу (Б4б): рисунок — по правилам закона (shifts.ts, `cycleErrors`)
  const shifts: Record<string, Shift> = {};
  for (const sh of Object.values(raw.shifts)) {
    const c = sh.cycle;
    if (c) {
      need(sh.days === undefined && sh.from === undefined && sh.to === undefined && sh.break === undefined, `график ${sh.id}: у сменного по циклу нет дней недели, часов пятидневки и перерыва — рисунок и часы смен`);
      const from = dayOf(c.from);
      need(from >= 0, `график ${sh.id}: даты ${c.from} нет в календаре`);
      need(c.offset < c.pattern.length, `график ${sh.id}: сдвиг бригады ${c.offset} — не меньше длины рисунка`);
      need(c.day[0] < c.day[1], `график ${sh.id}: дневная смена кончается раньше, чем начинается`);
      need(c.night[1] < c.night[0], `график ${sh.id}: ночная смена кончается не на следующие сутки`);
      const cycle = { from, offset: c.offset, pattern: [...c.pattern], day: [c.day[0], c.day[1]] as [number, number], night: [c.night[0], c.night[1]] as [number, number] };
      for (const e of cycleErrors(cycle)) need(false, `график ${sh.id}: ${e}`);
      shifts[sh.id] = { id: sh.id, name: sh.name, days: [], from: c.day[0], to: c.day[1], break: 0, cycle };
      continue;
    }
    if (sh.days === undefined || sh.from === undefined || sh.to === undefined) {
      need(false, `график ${sh.id}: у пятидневки — дни недели и часы смены, у сменного по циклу — рисунок`);
      continue;
    }
    need(sh.from < sh.to, `график ${sh.id}: смена кончается раньше, чем начинается`);
    need((sh.break ?? 0) < sh.to - sh.from, `график ${sh.id}: перерыв не короче смены`);
    shifts[sh.id] = { id: sh.id, name: sh.name, days: [...new Set(sh.days)].sort().map(d => d - 1), from: sh.from, to: sh.to, break: Math.round((sh.break ?? 0) * 3600) };
  }
  const products: Record<string, Product> = Object.fromEntries(Object.values(raw.products).map(pr => [pr.id, { ...pr, strength: pr.strength.mg }]));
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
        need(!p.stress, `${at}: нагрузка от режима — у оборудования стадии, не у машины линии`);
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
        // нагрузка — пока в % на единицу режима: единицу режима дают карты, ниже
        ...(p.stress ? { stress: { param: p.stress.param, coef: p.stress.coef } } : {}),
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
      ...works(e),
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
    // порядок загрузки (Б1д): каждый компонент — на стадии карты после отвешивания; АФС и хотя бы один другой компонент —
    // на стадии первого смешивания: дата производства — первое смешивание субстанции с другими ингредиентами
    for (const l of r.bom) {
      const k = r.stages.findIndex(st => st.id === l.stage);
      need(k >= 0, `${where}: ${l.material} загружают на стадии ${l.stage}, а её в карте нет`);
      need(k !== 0, `${where}: ${l.material} загружают на отвешивании — компонент загружают на стадии после него`);
    }
    const mixId = r.stages.find(st => st.mix)?.id;
    const atMix = r.bom.filter(l => l.stage === mixId);
    need(r.bom.filter(l => l.potency).every(l => l.stage === mixId), `${where}: АФС загружают не на стадии первого смешивания`);
    need(atMix.some(l => l.potency) && atMix.some(l => !l.potency), `${where}: на стадии первого смешивания — АФС и хотя бы один другой компонент`);
    const stages: RecipeStage[] = r.stages.map(st => {
      const at = `${where}, стадия ${st.id}`;
      for (const e of st.equipment) need(raw.equipment[e], `${at}: нет оборудования ${e}`);
      need(raw.roles[st.staff.role], `${at}: нет роли ${st.staff.role}`);
      const t = st.time;
      need(t.loads === undefined || t.perLoad !== undefined, `${at}: загрузки без времени на загрузку`);
      need(!(t.kgPerHour && t.unitsPerHour), `${at}: скорость — либо кг, либо штуки в час`);
      for (const p of st.params) {
        need(p.range[0] <= p.target && p.target <= p.range[1], `${at}: цель режима ${p.id} вне диапазона`);
        // уставка ходит шагом от цели и доходит до обоих краёв диапазона (Б1ж)
        const steps = (a: number, b: number) => Math.round((b - a) * PARAM_SCALE[p.unit]) % Math.round(p.step * PARAM_SCALE[p.unit]) === 0;
        need(Math.round(p.step * PARAM_SCALE[p.unit]) > 0 && steps(p.range[0], p.target) && steps(p.target, p.range[1]), `${at}: от цели режима ${p.id} шагом ${p.step} не дойти до краёв диапазона`);
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
        params: st.params.map(p => ({ id: p.id, unit: p.unit, target: sc(p.unit, p.target), range: [sc(p.unit, p.range[0]), sc(p.unit, p.range[1])] as [number, number], sd: sc(p.unit, p.sd), step: sc(p.unit, p.step) })),
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
      doc: headDoc(r.doc, where),
      product: r.product,
      batch: { mass: mg(r.batch.kg), units: r.batch.units },
      bom: r.bom.map(l => ({ material: l.material, qty: mg(l.kg), ...(l.potency ? { potency: true } : {}), ...(l.qs ? { qs: true } : {}), stage: l.stage })),
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
    for (const e of c.scatter ?? []) need(!qual(e.attr), `${where}: ${e.attr} — качественное свойство`);
    need(!c.scatter || 'param' in d, `${where}: разброс МОК — от отхода режима стадии`);
    causes[c.id] = {
      ...c,
      effects: c.effects.map(e => ({ attr: e.attr, coef: (e.coef * scaleOf(e.attr)) / per })),
      ...(c.scatter ? { scatter: c.scatter.map(e => ({ attr: e.attr, coef: (e.coef * scaleOf(e.attr)) / per })) } : {}),
    };
  }
  // нагрузка узла (Б1ж): режим — в картах, у оборудования стадии, где он есть; % на единицу режима → доли 1/10 000
  // на единицу движка
  for (const e of Object.values(equipment)) {
    for (const pt of e.parts) {
      if (!pt.stress) continue;
      const at = `оборудование ${e.id}, узел ${pt.id}`;
      const unit = paramUnits[pt.stress.param];
      need(unit, `${at}: режима ${pt.stress.param} нет ни в одной карте`);
      need(
        Object.values(recipes).some(r => r.stages.some(st => st.equipment.includes(e.id) && st.params.some(x => x.id === pt.stress!.param))),
        `${at}: режим ${pt.stress.param} — не у стадии на этом оборудовании`,
      );
      pt.stress = { param: pt.stress.param, coef: Math.round((pt.stress.coef * 100) / PARAM_SCALE[unit ?? 'rpm']) };
    }
  }
  // машины линии: секунды и доли
  const machines: Record<string, Machine> = {};
  for (const m of Object.values(raw.machines)) {
    need(raw.roles[m.crew.role], `машина ${m.id}: нет роли ${m.crew.role}`);
    if (m.micro) need(m.micro.duration < m.micro.every, `машина ${m.id}: микроостановка дольше промежутка между ними`);
    if (m.cleaning) need(m.cleaning.minor <= m.cleaning.major, `машина ${m.id}: малая уборка дольше генеральной`);
    need(!m.fast || m.item === 'blister', `машина ${m.id}: уставка скорости — у блистерной машины`);
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
      ...(m.fast ? { fast: { micro: share(m.fast.micro * 100), reject: share(m.fast.reject * 100) } } : {}),
      changeover: sec(m.changeover),
      ...(m.cleaning ? { cleaning: { minor: sec(m.cleaning.minor), major: sec(m.cleaning.major) } } : {}),
      kw: watt(m.kw),
      parts: partsOf(m.parts, `машина ${m.id}`, { micro: m.micro !== undefined }),
      ...(m.jam ? { jam: { cartons: m.jam.cartons, uncounted: share(m.jam.uncounted) } } : {}),
      ...works(m),
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
    // скорость блистерной (Б1ж): цель в диапазоне, шагом от цели — до обоих краёв, не быстрее паспорта блистерной машины
    const sp = k.speed;
    need(sp.range[0] <= sp.target && sp.target <= sp.range[1], `${where}: цель скорости вне диапазона`);
    need((sp.target - sp.range[0]) % sp.step === 0 && (sp.range[1] - sp.target) % sp.step === 0, `${where}: от цели скорости шагом ${sp.step} не дойти до краёв диапазона`);
    for (const m of Object.values(raw.machines)) {
      if (m.item === 'blister') need(m.fast && sp.range[1] <= m.nominal, `${where}: скорость ${sp.range[1]} — быстрее паспорта машины ${m.id} или у неё нет уставки`);
    }
    skus[k.id] = {
      ...k,
      doc: headDoc(k.doc, where),
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
      site: p.site,
      areas: p.areas.map(a => ({ code: a.code, name: a.name, rooms: a.rooms, centers: a.centers.map(c => ({ ...c })) })),
      building: r4(p.building),
      docks: p.docks.map(d => ({ ...d, x: cm(d.x), z: cm(d.z) })),
      zones: p.zones.map(zn => ({ ...zn, rect: r4(zn.rect) })),
      racks: p.racks.map(r => ({ ...r, x: cm(r.x), z: cm(r.z) })),
      rooms: p.rooms.map(r => ({ id: r.id, type: r.type, rect: r4(r.rect), grade: r.grade, vehicles: r.vehicles, ...(r.at ? { at: at2(r.at) } : {}) })),
      doors: p.doors.map(d => ({ cell: d.at, len: d.len, along: d.along, kind: d.kind, ...(d.materials ? { materials: true } : {}) })),
      instruments: p.instruments,
      ipc: p.ipc,
      sensors: p.sensors,
      equipment: p.equipment.map(e => ({ ...e, at: at2(e.at) })),
      lines: p.lines.map(ln => ({ ...ln, machines: ln.machines.map(m => ({ ...m, at: at2(m.at) })) })),
      points: { park: [cm(p.points.park[0]), cm(p.points.park[1])], entrance: [cm(p.points.entrance[0]), cm(p.points.entrance[1])] },
      posts: Object.fromEntries(Object.entries(p.posts).map(([role, at]) => [role, at2(at)])),
      energy: { hvac: p.energy.hvac, base: watt(p.energy.base) },
      cleaning: p.cleaning,
    };
    need(p.docks.some(d => d.kind === 'out') === p.zones.some(z => z.kind === 'shipping'), `план ${p.id}: рампа отгрузки и зона экспедиции бывают только вместе`);
    const ids = [
      ...p.docks.map(d => d.id),
      ...p.zones.map(z => z.id),
      ...p.racks.map(r => r.id),
      ...p.rooms.map(r => r.id),
      ...p.instruments.map(i => i.id),
      ...p.ipc.map(i => i.id),
      ...p.sensors.map(i => i.id),
      ...p.equipment.map(e => e.id),
      ...p.lines.flatMap(l => [l.id, ...l.machines.map(m => m.id)]),
    ];
    need(new Set(ids).size === ids.length, `план ${p.id}: имена рамп, зон, стеллажей, помещений, приборов, датчиков, оборудования, линий и машин повторяются`);
    placeErrors(p.id, plants[p.id], need, (t: string) => raw.equipment[t] ?? raw.machines[t] ?? raw.instruments[t], regimes);
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
    // уборка помещения после серии (Б4в): у класса помещений с оборудованием — секунды на м²
    for (const r of p.rooms) if (p.equipment.some(e => e.room === r.id)) need(p.cleaning[r.grade], `план ${p.id}: в помещении ${r.id} оборудование, а у класса ${r.grade} нет времени уборки (cleaning)`);
    for (const i of [...p.instruments, ...p.ipc, ...p.sensors]) {
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
  // рынок труда (Б4в): доли откликов и навыков складываются в целое; строка — у каждой роли штата и только у ролей базы;
  // испытание по умолчанию — не длиннее предела профиля
  const laborOf = (x: NonNullable<RawScenario['labor']>, sc: RawScenario, where: string): Labor => {
    const sum = (a: readonly number[]) => a.reduce((n, v) => n + v, 0);
    for (const [role, r] of Object.entries(x.roles)) {
      need(raw.roles[role], `${where}: рынок труда — нет роли ${role}`);
      need(Math.abs(sum(r.ad) - 100) < 1e-6, `${where}: рынок труда, ${role} — доли откликов на объявление не складываются в 100 %`);
      need(Math.abs(sum(r.skill) - 100) < 1e-6, `${where}: рынок труда, ${role} — доли навыков не складываются в 100 %`);
    }
    for (const row of sc.staff) need(x.roles[row.role], `${where}: рынок труда — нет строки роли ${row.role}`);
    const pr = raw.profiles[sc.profile];
    if (pr) need(x.probation <= pr.labor.probation, `${where}: рынок труда — испытание ${x.probation} мес. длиннее предела профиля, ${pr.labor.probation} мес.`);
    return {
      ad: kop(x.ad),
      agency: { share: share(x.agency.share), days: x.agency.days, skill: x.agency.skill },
      medical: { days: x.medical.days, price: kop(x.medical.price) },
      wait: x.wait,
      step: share(x.step),
      spread: share(x.spread),
      agree: share(x.agree * 100),
      probation: x.probation,
      trial: share(x.trial * 100),
      colleague: { skill: x.colleague.skill, over: share(x.colleague.over), ad: x.colleague.ad },
      roles: Object.fromEntries(
        Object.entries(x.roles).map(([role, r]) => [
          role,
          { ad: r.ad.map(share) as [number, number, number, number], skill: r.skill.map(share) as [number, number, number, number, number], quit: share(r.quit) },
        ]),
      ),
    };
  };
  // отпуска (Б4г): части складываются в дни года профиля, одна не короче части профиля; сроки частей — настоящие числа
  // года, «с» не позже «по»; утверждение — не позже чем за срок профиля до года, черновик — не позже утверждения
  const leaveRuleOf = (x: NonNullable<RawScenario['leave']>, sc: RawScenario, where: string): LeaveRule => {
    const pr = raw.profiles[sc.profile];
    const z = ([m, d]: [number, number]) => daysFromCivil({ y: 2027, m, d });
    const real = (md: [number, number], what: string) => {
      const c = civilFromDays(z(md));
      need(c.m === md[0] && c.d === md[1], `${where}: отпуска — ${what} ${md[1]}.${md[0]} нет в году`);
    };
    for (const [k, w] of [['summer', x.summer], ['rest', x.rest]] as const) {
      real(w[0], `${k}: с`);
      real(w[1], `${k}: по`);
      need(z(w[0]) <= z(w[1]), `${where}: отпуска — у ${k} «с» позже «по»`);
    }
    real(x.draft, 'черновик');
    real(x.approve, 'утверждение');
    need(z(x.draft) <= z(x.approve), `${where}: отпуска — черновик позже утверждения`);
    if (pr) {
      const sum = x.parts.reduce((n, d) => n + d, 0);
      need(sum === pr.leave.days, `${where}: отпуска — части дают ${sum} дн., а за год — ${pr.leave.days}`);
      need(x.parts.some(d => d >= pr.leave.part), `${where}: отпуска — нет части не короче ${pr.leave.part} дн. (ст. 125 ТК РФ)`);
      need(daysFromCivil({ y: 2028, m: 1, d: 1 }) - z(x.approve) >= pr.leave.approve, `${where}: отпуска — график утверждают позже чем за ${pr.leave.approve} дн. до года`);
    }
    return { draft: x.draft, approve: x.approve, parts: x.parts, summer: x.summer, rest: x.rest, dept: x.dept, cover: share(x.cover) };
  };
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
      // смежная профессия (Б4г): роль базы, не своя; роль, которую заменяет только человек той же роли, — не смежная
      for (const a of r.also ?? []) {
        need(roles[a], `${where}: у ${r.role} смежная профессия ${a} — нет такой роли`);
        need(a !== r.role, `${where}: у ${r.role} смежная профессия — своя роль`);
        need(!raw.roles[a]?.same, `${where}: у ${r.role} смежная профессия ${a} — её заменяет только человек той же роли`);
      }
    }
    for (const v of s.vehicles) need(vehicles[v.type], `${where}: нет техники ${v.type}`);
    // учётный период суммированного учёта (Б4б): не длиннее года (ст. 104, ч. 1), делитель года — периоды встают в год
    need(12 % s.account === 0, `${where}: учётный период ${s.account} мес. — не делитель года`);
    for (const c of s.customers) need(raw.customers[c], `${where}: нет покупателя ${c}`);
    if (s.customers.length > 0) need(raw.plants[s.plant]?.docks.some(d => d.kind === 'out'), `${where}: покупатели есть, а рампы отгрузки в плане нет`);
    // задания на серию: у каждой стадии карты в плане — помещение этого типа, оборудование в нём и прибор каждого её МОК
    // (Б3в)
    const pl = raw.plants[s.plant];
    const stageNeeds = (st: (typeof raw.recipes)[string]['stages'][number]) => {
      const room = pl?.rooms.find(x => x.type === st.room);
      need(room, `${where}: для стадии ${st.id} нет помещения «${st.room}»`);
      for (const e of st.equipment) need(room && pl.equipment.some(x => x.room === room.id && x.type === e), `${where}: в помещении «${st.room}» нет ${e}`);
      for (const c of st.ipc) {
        const inst = raw.tests[c.test]?.inst;
        if (inst) need(room && pl.ipc.some(x => x.room === room.id && x.type === inst), `${where}: в помещении «${st.room}» нет прибора ${inst} для МОК ${c.test}`);
      }
    };
    for (const b of s.batches) {
      const r = raw.recipes[b.recipe];
      need(r, `${where}: нет карты ${b.recipe}`);
      for (const st of r?.stages ?? []) stageNeeds(st);
      // товарная позиция: того же продукта, что карта, и линия в плане, где её упаковать
      if (b.sku) {
        const k = raw.skus[b.sku];
        need(k, `${where}: нет товарной позиции ${b.sku}`);
        if (k && r) need(k.product === r.product, `${where}: позиция ${b.sku} — не того продукта, что карта ${b.recipe}`);
        need(pl && pl.lines.length > 0, `${where}: в плане нет упаковочной линии для ${b.sku}`);
      }
    }
    // план выпуска: карта — та же проверка помещений и оборудования, позиция — того же продукта; у каждого материала
    // карты и упаковки позиции — одобренная пара в спецификации (Б3г, pairErrors), иначе коллеге снабжения не у кого
    // заказать
    for (const it of s.plan?.items ?? []) {
      const r = raw.recipes[it.recipe];
      const k = raw.skus[it.sku];
      need(r, `${where}: в плане нет карты ${it.recipe}`);
      need(k, `${where}: в плане нет товарной позиции ${it.sku}`);
      if (k && r) need(k.product === r.product, `${where}: в плане позиция ${it.sku} — не того продукта, что карта ${it.recipe}`);
      for (const st of r?.stages ?? []) stageNeeds(st);
      if (s.supply) {
        const mats = [...(r?.bom ?? []).map(l => l.material), ...(k ? [...k.blister, ...k.carton].map(l => l.material) : []), ...(k ? [k.case.material] : [])];
        for (const m of mats) need(STARTING.has(materials[m]?.kind), `${where}: ${m} — не исходный и не упаковочный материал: его не купить`);
      }
    }
    // заказы на старте (Б3г) — тоже только по одобренной паре спецификации, действующей в день начала
    for (const o of s.orders) {
      const sup = suppliers[o.supplier];
      need(sup, `${where}: нет поставщика ${o.supplier}`);
      for (const l of o.lines) {
        need(sup?.items[l.material], `${where}: ${o.supplier} не продаёт ${l.material}`);
        const sp = materials[l.material] && specs[inForce({ specs } as Pick<ContentDb, DocKind>, 'specs', materials[l.material].spec, dayOf(s.start.date))];
        if (sup?.items[l.material]) need(sp?.pairs?.some(x => x.supplier === o.supplier && x.maker === sup.items[l.material].maker), `${where}: заказ на старте у ${o.supplier} — ${l.material} не по одобренной паре спецификации`);
      }
    }
    // износ и политика техслужбы — по узлам машин плана: `<машина>/<узел>`
    const parts = new Set<string>();
    for (const e of pl?.equipment ?? []) for (const pt of raw.equipment[e.type]?.parts ?? []) parts.add(`${e.id}/${pt.id}`);
    for (const l of pl?.lines ?? []) for (const mc of l.machines) for (const pt of raw.machines[mc.type]?.parts ?? []) parts.add(`${mc.id}/${pt.id}`);
    for (const k of [...Object.keys(s.wear), ...Object.keys(s.maint)]) need(parts.has(k), `${where}: в плане нет узла ${k}`);
    need(new Set(s.seats).size === s.seats.length, `${where}: место повторяется в seats`);
    // места и оборудование (Б3в): каждому материалу — зона хранения по режиму; срок предупреждения короче самого короткого
    // интервала — иначе запись на старте сразу ждёт визита; работа подрядчика — в его рабочий день
    if (plants[s.plant]) {
      const plant = plants[s.plant];
      const part = { regimes, materials, plants } as unknown as ContentDb;
      const P = placesOf(plant);
      const bulkRoom = plant.rooms.find(r => r.type === 'bulk')?.id;
      for (const m of Object.values(materials)) {
        if (!regimes[m.storage]) continue;
        // путь материала по зонам хранения: балк — промежуточный склад; холод — камера; остальное — карантин или ГП, стеллажи;
        // отклонённое — зона отклонённого. Зона вне зон хранения режима не держит — её не спрашивают
        const cold = coldOf(part, s.plant, m.id);
        const path = m.kind === 'bulk' ? [] : cold ? ['cold', 'rejected'] : [m.kind === 'fg' ? 'fgQuarantine' : 'quarantine', 'storage', 'rejected'];
        const stores = m.kind === 'bulk' ? [bulkRoom ? P.storeOf[bulkRoom] : undefined] : path.map(k => storeOfKind(plant, k));
        const ok = (m.kind === 'bulk' || !cold || coldStore(plant) !== undefined) && stores.every((st, i) => (st === undefined ? m.kind !== 'bulk' && path[i] !== 'storage' : accepts(part, P.center[st], m.id)));
        need(ok, `${where}: материалу ${m.id} (${m.storage}) нет зоны хранения с подходящим режимом`);
      }
      const day = s.assets.hours[1] - s.assets.hours[0];
      let shortest = Infinity;
      for (const t of P.things) {
        const cls = classOf({ equipment, machines, instruments } as unknown as ContentDb, t);
        for (const w of [cls?.qual, cls?.cal]) {
          if (!w) continue;
          shortest = Math.min(shortest, w.every);
          need(w.work <= day * 3600, `${where}: ${t.id} — работа «${w.name.ru}» длиннее рабочего дня подрядчика`);
        }
      }
      need(s.assets.ahead + 3 < shortest * 28, `${where}: assets.ahead — срок предупреждения не короче самого короткого интервала, ${shortest} мес.`);
    }
    // склад ГП на старте (Б1г): у каждой позиции, которую заказывают покупатели, — карта в плане выпуска: по ней
    // считают ящики серии
    if (s.fg) {
      const planned = new Set((s.plan?.items ?? []).map(it => it.sku));
      for (const c of s.customers) for (const k of Object.keys(raw.customers[c]?.demand ?? {})) need(planned.has(k), `${where}: склад ГП на старте — у позиции ${k} нет карты в плане выпуска`);
    }
    // контрагенты (Б3г): срок предупреждения короче самого короткого интервала оценки — иначе на старте пара сразу ждёт
    // оценки; аудит с рассмотрением отчёта укладывается в срок предупреждения
    const every = Math.min(s.partners.every.api, s.partners.every.excipient, s.partners.every.packaging);
    need(s.partners.ahead + 3 < every * 28, `${where}: partners.ahead — срок предупреждения не короче самого короткого интервала оценки, ${every} мес.`);
    need(s.partners.audit.days + 2 < s.partners.ahead, `${where}: partners — аудит в ${s.partners.audit.days} рабочих дней не уложится в срок предупреждения`);
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
      training: { ...s.training, check: sec(s.training.check) },
      assets: { ...s.assets, hours: [s.assets.hours[0] * 3600, s.assets.hours[1] * 3600], accept: sec(s.assets.accept) },
      partners: {
        ...s.partners,
        audit: { days: s.partners.audit.days, review: sec(s.partners.audit.review * 60), price: kop(s.partners.audit.price) },
        docs: { review: sec(s.partners.docs.review * 60) },
        markup: share(s.partners.markup),
        share: share(s.partners.share),
      },
      ...(s.incident ? { incident: incidentOf(s.incident, s.batches.length, where) } : {}),
      ...(s.labor ? { labor: laborOf(s.labor, s, where) } : {}),
      ...(s.leave ? { leave: leaveRuleOf(s.leave, s, where) } : {}),
    };
  }
  const profiles: Record<string, Profile> = {};
  for (const p of Object.values(raw.profiles)) {
    need(p.payroll.night.from !== p.payroll.night.to, `профиль ${p.id}: у ночных часов нет длины`);
    const ot = p.payroll.overtime;
    need(ot.first <= ot.shift, `профиль ${p.id}: payroll.overtime.first — больше предела за смену`);
    need(p.leave.part <= p.leave.days, `профиль ${p.id}: leave.part — часть длиннее отпуска`);
    profiles[p.id] = {
      ...p,
      vat: { medicines: share(p.vat.medicines), general: share(p.vat.general) },
      marking: { ...p.marking, fee: kop(p.marking.fee), free: kop(p.marking.free) },
      payroll: {
        night: { ...p.payroll.night, extra: share(p.payroll.night.extra) },
        overtime: { shift: Math.round(ot.shift * 3600), year: ot.year * 3600, first: Math.round(ot.first * 3600), rates: [share(ot.rates[0]), share(ot.rates[1])] },
        holiday: { within: share(p.payroll.holiday.within), beyond: share(p.payroll.holiday.beyond) },
        contrib: { ...p.payroll.contrib, rate: share(p.payroll.contrib.rate), base: kop(p.payroll.contrib.base), above: share(p.payroll.contrib.above), injury: share(p.payroll.contrib.injury) },
      },
      calendar: calendarOf(p.calendar, `профиль ${p.id}`, need),
      energy: { advances: p.energy.advances.map(([d, pct]) => [d, share(pct)] as [number, number]), final: p.energy.final },
      key: share(p.key),
      labor: p.labor,
      leave: { ...p.leave, avg: Math.round(p.leave.avg * 1000) },
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
  // процедуры (Б3б): шапка документа, роли матрицы и работы — из базы; часы — в секунды
  const sops: Record<string, Sop> = {};
  for (const x of Object.values(raw.sops)) {
    const where = `процедура ${x.id}`;
    for (const r of x.roles) need(roles[r], `${where}: учится роль ${r} — нет такой роли`);
    for (const e of x.for.equipment ?? []) need(equipment[e], `${where}: нет оборудования ${e}`);
    for (const m of x.for.machines ?? []) need(machines[m], `${where}: нет машины ${m}`);
    for (const v of x.for.vehicles ?? []) need(vehicles[v], `${where}: нет техники ${v}`);
    const { hours, ...rest } = x;
    sops[x.id] = { ...rest, doc: headDoc(x.doc, where), study: sec(hours * 60) };
  }
  learnErrors(raw, sops, tests, need);
  // соглашения по качеству (Б3г): шапка документа; поставщик, изготовители и материалы — из базы, и поставщик продаёт
  // эти материалы этих изготовителей
  const agreements: Record<string, Agreement> = {};
  for (const x of Object.values(raw.agreements)) {
    const where = `соглашение ${x.id}`;
    const sup = suppliers[x.supplier];
    need(sup, `${where}: нет поставщика ${x.supplier}`);
    for (const mk of x.makers) need(makers[mk], `${where}: нет изготовителя ${mk}`);
    for (const m of x.materials) need(sup?.items[m] && x.makers.includes(sup.items[m].maker), `${where}: ${x.supplier} не продаёт ${m} изготовителей ${x.makers.join(', ')}`);
    agreements[x.id] = { ...x, doc: headDoc(x.doc, where) };
  }
  pairErrors(materials, specs, suppliers, makers, need);
  // коды (Б3а): у материала и запчасти — внутренний, первая цифра — вид; у каждого свой
  const matCodes = new Map<string, string>();
  const coded = [...Object.values(materials).map(m => ({ id: m.id, code: m.code, kind: m.kind as keyof typeof CODE_KIND })), ...Object.values(spares).map(sp => ({ id: sp.id, code: sp.code, kind: 'spare' as const }))];
  for (const x of coded) {
    need(x.code[0] === CODE_KIND[x.kind], `${x.id}: код ${x.code} — первая цифра у вида ${x.kind} — ${CODE_KIND[x.kind]}`);
    const other = matCodes.get(x.code);
    need(!other, `${x.id}: код ${x.code} уже у ${other}`);
    matCodes.set(x.code, x.id);
  }
  // документы: у редакций одного кода — разные дни введения и номер растёт с днём, поэтому в любой день действует не
  // больше одной; у редакций карты — один продукт; инструкция по упаковке — у каждой позиции своя, пока она часть
  // позиции
  const docDb = { specs, tests, recipes, skus, sops, agreements };
  for (const kind of DOC_KINDS) {
    const byCode = new Map<string, string[]>();
    for (const [id, r] of Object.entries(docDb[kind] as Record<string, { doc: DocHead }>)) byCode.set(r.doc.code, [...(byCode.get(r.doc.code) ?? []), id]);
    for (const [code, ids] of byCode) {
      const heads = ids.map(id => ({ id, h: headOf(docDb, kind, id)! })).sort((a, b) => a.h.from - b.h.from);
      need(new Set(heads.map(x => x.h.from)).size === heads.length, `документ ${code}: у редакций ${ids.join(', ')} один день введения`);
      need(new Set(heads.map(x => x.h.rev)).size === heads.length, `документ ${code}: у редакций ${ids.join(', ')} номер повторяется`);
      heads.forEach((x, i) => {
        if (i > 0 && x.h.rev !== heads[i - 1].h.rev) need(x.h.rev > heads[i - 1].h.rev, `документ ${code}: редакция ${x.h.rev} (${x.id}) введена позже редакции ${heads[i - 1].h.rev}`);
      });
      if (kind === 'recipes') need(new Set(ids.map(id => recipes[id].product)).size === 1, `карта ${code}: редакции ${ids.join(', ')} — разных продуктов`);
      if (kind === 'skus') need(ids.length === 1, `инструкция по упаковке ${code}: одна у позиций ${ids.join(', ')}, а у каждой — своя`);
      // матрица обучения и требования — у документа, а не у редакции (Б3б)
      if (kind === 'sops' || kind === 'tests') {
        const scope = (id: string) => {
          const r = (docDb[kind] as Record<string, Sop | TestMethod>)[id];
          return stableJson({ roles: [...r.roles].sort(), for: 'for' in r ? r.for : null });
        };
        need(new Set(ids.map(scope)).size === 1, `документ ${code}: у редакций ${ids.join(', ')} разные роли или работы — матрица обучения у документа одна`);
      }
    }
  }
  // на начало сценария действует всё, что ему нужно: спецификация каждого материала — по ней примут первую партию; карты
  // его заданий и плана; инструкции по упаковке его позиций
  for (const sc of Object.values(scenarios)) {
    const where = `сценарий ${sc.id}`;
    const day = daysFromCivil(sc.start.date);
    const date = raw.scenarios[sc.id].start.date;
    const active = (kind: DocKind, id: string) => headOf(docDb, kind, inForce(docDb, kind, id, day))!.from <= day;
    for (const m of Object.values(materials)) if (specs[m.spec]) need(active('specs', m.spec), `${where}: у материала ${m.id} на ${date} нет действующей спецификации`);
    for (const r of [...sc.batches.map(b => b.recipe), ...(sc.plan?.items.map(it => it.recipe) ?? [])]) if (recipes[r]) need(active('recipes', r), `${where}: у карты ${r} на ${date} нет действующей редакции`);
    const used = [...sc.batches.flatMap(b => (b.sku ? [b.sku] : [])), ...(sc.plan?.items.map(it => it.sku) ?? []), ...sc.customers.flatMap(c => Object.keys(customers[c]?.demand ?? {}))];
    for (const k of new Set(used)) if (skus[k]) need(active('skus', k), `${where}: инструкция по упаковке позиции ${k} на ${date} ещё не действует`);
    // соглашения по качеству (Б3г): у каждой пары спецификации, действующей на начало, — соглашение, действующее на
    // начало
    for (const m of Object.values(materials)) {
      const sp = specs[m.spec] && specs[inForce(docDb, 'specs', m.spec, day)];
      for (const pr of sp?.pairs ?? []) need(agreementFor(docDb, pr.supplier, pr.maker, m.id, day), `${where}: у пары ${pr.supplier} — ${pr.maker} для ${m.id} на ${date} нет действующего соглашения по качеству`);
    }
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
    sops,
    regimes,
    makers,
    agreements,
  };
}

/**
 * Стадии в часы (Б4а; docs/specs/2026-10-vertical-slice.md, «Проверки Б4а»): человек берёт стадию, только если она с
 * запасом на разброс помещается в остаток его смены и в сверхурочные. Человека можно перевести в любой график базы (Б4б),
 * поэтому у каждой стадии карты норма — не длиннее самой короткой смены всех графиков, а наибольшая длительность — не
 * длиннее этой смены с пределом сверхурочных за смену в каждом сценарии: иначе в каком-то графике стадию никто не
 * начнёт. Учатся только в смену: часы изучения документа — не длиннее самой короткой смены.
 */
function stageErrors(db: ContentDb): string[] {
  const out: string[] = [];
  const h = (sec: number) => Math.round(sec / 360) / 10;
  const len = Math.min(...Object.values(db.shifts).flatMap(shiftLengths));
  if (!Number.isFinite(len)) return out;
  for (const d of [...Object.values(db.sops), ...Object.values(db.tests)]) {
    if (d.roles.length > 0 && d.study > len) out.push(`${d.id}: изучение ${d.study / 3600} ч длиннее самой короткой смены графиков (${h(len)} ч) — в таком графике обучение никто не начнёт`);
  }
  for (const sc of Object.values(db.scenarios)) {
    const over = db.profiles[sc.profile].payroll.overtime.shift;
    for (const r of Object.values(db.recipes)) {
      for (const st of r.stages) {
        const [nom, max] = stageNorm(db, r.id, st, r.batch.mass);
        if (nom > len) out.push(`карта ${r.id}, стадия ${st.id}: норма ${h(nom)} ч длиннее самой короткой смены графиков (${h(len)} ч) — в таком графике стадию никто не начнёт`);
        else if (max > len + over) out.push(`сценарий ${sc.id}, карта ${r.id}, стадия ${st.id}: наибольшая длительность ${h(max)} ч длиннее самой короткой смены графиков со сверхурочными (${h(len + over)} ч) — в таком графике стадию никто не начнёт`);
      }
    }
  }
  return out;
}

/**
 * Черновик графика отпусков стартового штата (Б4г; docs/specs/2026-10-vertical-slice.md, «Проверки Б4г»): на первый год
 * после начала партии правило сценария ставит все части всех людей — без «не помещается» (leave.ts, `placeDraft`).
 */
function leaveErrors(db: ContentDb): string[] {
  const out: string[] = [];
  for (const sc of Object.values(db.scenarios)) {
    if (!sc.leave) continue;
    const days = db.profiles[sc.profile].leave.days;
    const people: DraftPerson[] = [];
    for (const row of sc.staff) for (let i = 0; i < row.n; i++) people.push({ id: `E${people.length + 1}`, role: row.role, shift: row.shift, tab: sc.training.tab + people.length, ...(row.also ? { also: row.also } : {}), right: 0, days });
    const y = sc.start.date.y + 1;
    const d = placeDraft(db, { start: sc.start.date, scenario: sc.id }, y, people, people, []);
    for (const id of d.miss) {
      const p = people.find(x => x.id === id)!;
      out.push(`сценарий ${sc.id}: черновик графика отпусков ${y} года — ${p.role} (${p.shift}, таб. № ${p.tab}): не всем частям нашлось место по правилу`);
    }
  }
  return out;
}

/**
 * Производственный календарь профиля (Б4а; docs/specs/2026-10-vertical-slice.md, «Проверки Б4а»): праздник — настоящая
 * дата; январские праздники — отрезок месяца; перенос — с субботы или воскресенья на будний день того же года, который
 * не праздник. Даты переносов — номера дней от 1970-01-01; часы — секунды.
 */
function calendarOf(c: z.infer<(typeof KINDS)['profiles']['schema']>['calendar'], where: string, need: (ok: unknown, msg: string) => void): Profile['calendar'] {
  const real = ([m, d]: readonly [number, number]) => {
    const z = daysFromCivil({ y: 2001, m, d });
    const back = civilFromDays(z);
    return back.m === m && back.d === d;
  };
  for (const h of c.holidays) need(real(h), `${where}: праздника ${h[1]}.${h[0]} не бывает`);
  need(c.january[0] <= c.january[1], `${where}: calendar.january — начало позже конца`);
  const holiday = (z: number) => {
    const { m, d } = civilFromDays(z);
    return c.holidays.some(h => h[0] === m && h[1] === d);
  };
  const transfers = c.transfers.map(([a, b]): [number, number] => {
    const [from, to] = [a, b].map(x => {
      const [y, m, d] = x.split('-').map(Number);
      return daysFromCivil({ y, m, d });
    });
    need(civilFromDays(from).y === civilFromDays(to).y, `${where}: перенос ${a} → ${b} — в другой год`);
    need(weekday(from) >= 5, `${where}: перенос ${a} → ${b} — не с выходного`);
    need(weekday(to) < 5 && !holiday(to), `${where}: перенос ${a} → ${b} — не на будний день или на праздник`);
    return [from, to];
  });
  return { holidays: c.holidays.map(([m, d]) => [m, d]), january: [c.january[0], c.january[1]], transfers, short: c.short * 3600, day: Math.round((c.week * 3600) / 5) };
}

/**
 * Одобренные пары (Б3г; docs/specs/2026-10-vertical-slice.md, «Проверки Б3г»): у каждой редакции спецификации исходного
 * и упаковочного материала — хоть одна пара, и поставщик пары продаёт этот материал от этого изготовителя; у своей
 * продукции пар нет.
 */
function pairErrors(materials: Record<string, Material>, specs: Record<string, Spec>, suppliers: Record<string, Supplier>, makers: Record<string, Maker>, need: (ok: unknown, msg: string) => void) {
  for (const m of Object.values(materials)) {
    if (!specs[m.spec]) continue;
    for (const id of revisions({ specs } as unknown as Pick<ContentDb, DocKind>, 'specs', m.spec)) {
      const where = `спецификация ${id} (${m.id})`;
      const pairs = specs[id].pairs ?? [];
      if (!STARTING.has(m.kind)) {
        need(pairs.length === 0, `${where}: у своей продукции одобренных пар нет`);
        continue;
      }
      need(pairs.length > 0, `${where}: нет одобренной пары «поставщик — изготовитель» — материал не у кого купить`);
      need(new Set(pairs.map(x => `${x.supplier}|${x.maker}`)).size === pairs.length, `${where}: пара повторяется`);
      for (const pr of pairs) {
        need(makers[pr.maker], `${where}: нет изготовителя ${pr.maker}`);
        const it = suppliers[pr.supplier]?.items[m.id];
        need(suppliers[pr.supplier], `${where}: нет поставщика ${pr.supplier}`);
        if (suppliers[pr.supplier]) need(it?.maker === pr.maker, `${where}: у ${pr.supplier} нет ${m.id} от ${pr.maker}`);
      }
    }
  }
}

/** Зона хранения, где лежат места паллет вида `kind`: помещение зоны плана этого вида; стеллажи — `storage`. */
function storeOfKind(plant: Plant, kind: string): string | undefined {
  if (kind === 'storage') return rackStore(plant);
  const z = plant.zones.find(x => x.kind === kind);
  const room = z ? roomAt(plant, z.rect[0] + Math.floor(z.rect[2] / 2), z.rect[1] + Math.floor(z.rect[3] / 2)) : undefined;
  return room ? placesOf(plant).storeOf[room] : undefined;
}
const coldStore = (plant: Plant) => storeOfKind(plant, 'cold');

/**
 * Места плана (Б3в; docs/specs/2026-10-vertical-slice.md, «Проверки Б3в»): коды участков, рабочих мест и мест не
 * повторяются; рабочее место — своего участка; помещение — не больше чем в одном участке и в одной зоне хранения; у зоны
 * хранения — её помещения в участке, режим и ровно один датчик с поверкой; у других рабочих мест помещений и режима нет;
 * вещь плана — на рабочем месте своего вида, в помещении его участка; машины линии — на одном рабочем месте, и на нём
 * только они.
 */
function placeErrors(pid: string, plant: Plant, need: (ok: unknown, msg: string) => void, cls: (type: string) => { cal?: { verify?: true } } | undefined, regimes: Record<string, Regime>) {
  const where = `план ${pid}`;
  const codes = new Set<string>();
  const uniq = (code: string, what: string) => {
    need(!codes.has(code), `${where}: код ${code} повторяется (${what})`);
    codes.add(code);
  };
  const roomIds = new Set(plant.rooms.map(r => r.id));
  const roomArea = new Map<string, string>();
  const stored = new Map<string, string>();
  for (const a of plant.areas) {
    uniq(a.code, `участок ${a.code}`);
    for (const r of a.rooms) {
      need(roomIds.has(r), `${where}: участок ${a.code} — нет помещения ${r}`);
      const other = roomArea.get(r);
      need(!other, `${where}: помещение ${r} — в участках ${other} и ${a.code}`);
      roomArea.set(r, a.code);
    }
    for (const c of a.centers) {
      uniq(c.code, `рабочее место ${c.code}`);
      need(areaCode(c.code) === a.code, `${where}: рабочее место ${c.code} — не участка ${a.code}`);
      if (c.kind !== 'storage') {
        need(!c.rooms && !c.regime, `${where}: рабочее место ${c.code} — помещения и режим бывают только у зоны хранения`);
        continue;
      }
      need(c.rooms, `${where}: зона хранения ${c.code} — нет помещений`);
      need(c.regime && regimes[c.regime], `${where}: зона хранения ${c.code} — нет режима ${c.regime ?? ''}`);
      for (const r of c.rooms ?? []) {
        need(a.rooms.includes(r), `${where}: зона хранения ${c.code} — помещение ${r} не участка ${a.code}`);
        need(!stored.has(r), `${where}: помещение ${r} — в зонах хранения ${stored.get(r)} и ${c.code}`);
        stored.set(r, c.code);
      }
    }
  }
  const P = placesOf(plant);
  const lineAt = new Map<string, string>();
  const atLine = new Map<string, string>();
  const sensors = new Map<string, number>();
  for (const t of P.things) {
    uniq(t.place, t.id);
    const c = P.center[centerCode(t.place)];
    need(c, `${where}: ${t.id} — нет рабочего места ${centerCode(t.place)}`);
    if (!c) continue;
    need(c.kind === CENTER_OF[t.family], `${where}: ${t.id} — на рабочем месте ${c.code} вида ${c.kind}, а нужно ${CENTER_OF[t.family]}`);
    need(roomArea.get(t.room) === c.area, `${where}: ${t.id} — в помещении ${t.room}, а оно не участка ${c.area}`);
    if (t.family === 'sensor') {
      need(c.rooms?.includes(t.room), `${where}: датчик ${t.id} — не в помещении зоны ${c.code}`);
      need(cls(t.type)?.cal?.verify, `${where}: датчик ${t.id} — у вида ${t.type} нет поверки`);
      sensors.set(c.code, (sensors.get(c.code) ?? 0) + 1);
    }
    if (t.line) {
      need((lineAt.get(t.line) ?? c.code) === c.code, `${where}: машины линии ${t.line} — на разных рабочих местах`);
      need((atLine.get(c.code) ?? t.line) === t.line, `${where}: на рабочем месте ${c.code} — машины разных линий`);
      lineAt.set(t.line, c.code);
      atLine.set(c.code, t.line);
    }
  }
  for (const c of Object.values(P.center)) if (c.kind === 'storage') need(sensors.get(c.code) === 1, `${where}: у зоны хранения ${c.code} — не один датчик`);
}

/**
 * Кто делает работу, тот по ней и учится (Б3б): каждая роль сценария, которой движок даёт работу с требованием процедуры
 * или методики, есть в матрице обучения этого документа — иначе её никто не учит, и работа ждёт «нет допуска» всегда.
 * Роли работ — по правилам модулей движка: новая задача — строка `DOERS`. Техника — исключение: на ней ездят только роли
 * из матрицы её процедуры, остальные берут другую технику. Ещё: дни обучения на старте моложе самого короткого срока.
 */
function learnErrors(raw: Raw, sops: Record<string, Sop>, tests: Record<string, TestMethod>, need: (ok: unknown, msg: string) => void) {
  const staffed = new Set(Object.values(raw.scenarios).flatMap(sc => sc.staff.map(r => r.role)));
  const uniq = (list: string[]) => [...new Set(list)];
  const stageRoles = (pick: (st: (typeof raw.recipes)[string]['stages'][number]) => boolean) =>
    uniq(Object.values(raw.recipes).flatMap(r => r.stages.filter(pick).map(st => st.staff.role)));
  const crewOf = (ids: string[]) => uniq(ids.flatMap(m => (raw.machines[m]?.crew ? [raw.machines[m].crew.role] : [])));
  const DOERS: Record<TaskKind, readonly string[]> = {
    unload: WMS.movers,
    receive: WMS.keepers,
    putaway: WMS.movers,
    move: WMS.movers,
    toSampling: WMS.movers,
    sample: QC.samplers,
    fromSampling: WMS.movers,
    handover: QC.samplers,
    prep: QC.analysts,
    review: QC.reviewers,
    decide: QC.heads,
    pick: WMS.movers,
    transfer: WMS.keepers,
    return: WMS.keepers,
    stage: stageRoles(() => true),
    // мойка: аппаратчики, а машины линии, которые касаются таблеток, — их смена (Б1е; washRoles в mes.ts)
    clean: uniq([...MES.operators, ...crewOf(Object.keys(raw.machines).filter(m => raw.machines[m].cleaning))]),
    roomClean: MES.cleaners,
    crew: crewOf(Object.keys(raw.machines)),
    changeover: LINE.setters,
    clearance: LINE.cleaners,
    clearCheck: LINE.checkers,
    feed: LINE.feeders,
    fgCheck: QA.specialists,
    qpDecide: QA.qps,
    ship: WMS.movers,
    casePick: WMS.movers,
    load: WMS.movers,
    repair: MAINT.mechanics,
    truckCheck: WMS.keepers,
    invStep: uniq(Object.values(raw.investigations).flatMap(m => m.steps.flatMap(st => (st.role ? [st.role] : [])))),
    invFix: MAINT.mechanics,
    train: [],
    trainCheck: CHECKERS,
    accept: Object.values(ACCEPT),
    vendorReview: REVIEWERS,
    devAssess: QA.specialists,
  };
  const LINE_WORK: TaskKind[] = ['crew', 'feed', 'changeover', 'clearance', 'clearCheck'];
  const check = (where: string, has: string[], doers: Iterable<string>) => {
    for (const r of doers) if (staffed.has(r)) need(has.includes(r), `${where}: нужна работе роли ${r}, а в матрице обучения её нет`);
  };
  for (const x of Object.values(sops)) {
    const kinds = x.for.any ? WORKS : (x.for.tasks ?? []);
    const doers = new Set(kinds.flatMap(k => DOERS[k]));
    const eqs = x.for.equipment ?? [];
    if (eqs.length > 0) for (const r of stageRoles(st => st.equipment.some(e => eqs.includes(e)))) doers.add(r);
    if (x.for.machines) {
      for (const r of crewOf(x.for.machines)) doers.add(r);
      for (const k of LINE_WORK) for (const r of DOERS[k]) doers.add(r);
    }
    check(`процедура ${x.id}`, x.roles, doers);
  }
  // методики: испытание и его проверка — лаборатория, если по методике испытывают по спецификации или в расследовании; МОК
  // — кто ведёт стадию с этой методикой
  const lab = new Set([...Object.values(raw.specs).flatMap(sp => sp.tests.map(l => l.test)), ...Object.values(raw.investigations).flatMap(m => [m.test, ...m.steps.flatMap(st => (st.test ? [st.test] : []))])]);
  for (const t of Object.values(tests)) {
    const doers = new Set<string>(lab.has(t.id) ? [...QC.analysts, ...QC.reviewers] : []);
    for (const r of stageRoles(st => st.ipc.some(c => c.test === t.id))) doers.add(r);
    check(`методика ${t.id}`, t.roles, doers);
  }
  const shortest = Math.min(...[...Object.values(sops), ...Object.values(tests)].map(x => x.every));
  for (const sc of Object.values(raw.scenarios)) need(sc.training.spread < shortest * 28, `сценарий ${sc.id}: training.spread — на старте записи старше самого короткого срока обучения, ${shortest} мес.`);
}
