// Места и оборудование для окна (Б3в; docs/specs/2026-10-vertical-slice.md, «Б3в»): иерархия мест — площадка, участки,
// рабочие места, оборудование и приборы — и активы с инвентарными номерами, записями квалификации и калибровки (поверки),
// назначенным визитом подрядчика и пригодностью сейчас; у зоны хранения — режим и поверка её датчика. Записи и визиты —
// знание завода, а не истина: их и показывает окно. Для планёрки — сводка: визиты сегодня, что кончится в срок
// предупреждения, что просрочено.
import type { ContentDb, Id, Text } from '../content/types';
import { contractor, lineUnfit, recOf, stageUnfit, unfit, type Unfit, valid, type Work, WORKS } from '../engine/assets';
import { batchNo } from '../engine/batchno';
import { DAY, momentOf } from '../engine/core/calendar';
import { classOf, placesOf } from '../engine/places';
import { planOf } from '../engine/plant';
import type { AssetFamily, AssetRec, PlantState } from '../engine/types';
import type { Thing } from './views';

/** Актив для окна: номер, род, класс, место, критический ли; какие работы нужны классу; последние записи; визит; пригоден ли. */
export interface AssetInfo {
  id: string;
  inv: number;
  family: AssetFamily;
  type: Id;
  place: string;
  critical: boolean;
  needs: Work[];
  /** калибровка класса — поверка (датчик условий хранения) */
  verify: boolean;
  qual?: AssetRec;
  cal?: AssetRec;
  /** назначенный визит: работа, с какого мгновения актив не берёт новых работ, когда подрядчик работал, ждёт ли приёмки */
  visit?: { work: Work; at: number; from?: number; to?: number; accepting: boolean };
  /** почему не берёт новую работу сейчас */
  unfit?: Unfit;
  /** подрядчик работает сейчас */
  working: boolean;
  /** вещь на полу — камера и карточка: машина, оборудование, техника или помещение прибора */
  thing?: Thing;
  /** сегодня по часам завода — номер дня: от него окно пишет «до» и «вышла» */
  today: number;
}

export interface PlaceCenter {
  code: string;
  kind: 'cell' | 'line' | 'storage' | 'lab';
  name: Text;
  /** зона хранения: режим, который она держит, и её помещения — виды помещений плана */
  regime?: Id;
  rooms: string[];
  /** закрыта для новых паллет: датчик не пригоден */
  closed?: boolean;
  assets: AssetInfo[];
}

export interface PlaceArea {
  code: string;
  name: Text;
  /** виды помещений участка */
  rooms: string[];
  centers: PlaceCenter[];
  /** техника участка */
  vehicles: AssetInfo[];
}

/** Вкладка «Места» справочника: площадка, участки, общие помещения площадки; срок предупреждения коллеги техслужбы, сутки. */
export interface PlacesView {
  site: { code: string; name: Text };
  areas: PlaceArea[];
  common: string[];
  ahead: number;
}

const num = (id: string) => Number(id.slice(1));

/** Актив для окна: последние записи каждой работы. */
export function assetInfo(db: ContentDb, s: PlantState, id: string): AssetInfo | undefined {
  const a = s.assets[id];
  if (!a) return undefined;
  const plan = planOf(db, s.plant);
  const cls = classOf(db, a);
  const needs = WORKS.filter(w => cls[w]);
  const qual = recOf(a, 'qual');
  const cal = recOf(a, 'cal');
  const why = unfit(db, s, id);
  const v = a.visit;
  const thing = thingOf(db, s, id, plan);
  return {
    id,
    inv: a.inv,
    family: a.family,
    type: a.type,
    place: a.place,
    critical: !!cls.critical,
    needs,
    verify: !!cls.cal?.verify,
    ...(qual ? { qual } : {}),
    ...(cal ? { cal } : {}),
    ...(v ? { visit: { work: v.work, at: v.at, ...(v.from !== undefined ? { from: v.from, to: v.to } : {}), accepting: v.task !== undefined } } : {}),
    ...(why ? { unfit: why } : {}),
    working: contractor(a, s.t),
    ...(thing ? { thing } : {}),
    today: momentOf(s.start, s.t).day,
  };
}

/** Вещь на полу актива: машина линии, оборудование, техника; прибор — его помещение. */
export function thingOf(db: ContentDb, s: PlantState, id: string, plan = planOf(db, s.plant)): Thing | undefined {
  for (const [line, l] of plan.plant.lines.entries()) {
    const k = l.machines.findIndex(m => m.id === id);
    if (k >= 0) return { kind: 'machine', line, k };
  }
  const i = plan.plant.equipment.findIndex(e => e.id === id);
  if (i >= 0) return { kind: 'equipment', i };
  if (s.vehicles[id]) return { kind: 'vehicle', n: num(id) };
  const room = placesOf(plan.plant).thing[id]?.room;
  const r = room ? plan.plant.rooms.findIndex(x => x.id === room) : -1;
  return r >= 0 ? { kind: 'room', i: r } : undefined;
}

/** Вкладка «Места»: участки по порядку плана, рабочие места и их активы по порядку кода места, техника участка. */
export function placesView(db: ContentDb, s: PlantState): PlacesView {
  const plant = planOf(db, s.plant).plant;
  const P = placesOf(plant);
  const typeOf = (room: string) => plant.rooms.find(r => r.id === room)?.type ?? room;
  const inAreas = new Set(plant.areas.flatMap(a => a.rooms));
  const assets = Object.values(s.assets);
  return {
    site: plant.site,
    areas: plant.areas.map(a => ({
      code: a.code,
      name: a.name,
      rooms: a.rooms.map(typeOf),
      centers: a.centers.map(c => {
        const list = assets.filter(x => x.place.startsWith(`${c.code}.`)).sort((x, y) => (x.place < y.place ? -1 : 1));
        const sensor = P.sensorOf[c.code];
        return {
          code: c.code,
          kind: c.kind,
          name: c.name,
          ...(c.regime ? { regime: c.regime } : {}),
          rooms: (c.rooms ?? []).map(typeOf),
          ...(sensor && unfit(db, s, sensor) ? { closed: true } : {}),
          assets: list.map(x => assetInfo(db, s, x.id)!),
        };
      }),
      vehicles: assets.filter(x => x.family === 'vehicle' && x.place === a.code).map(x => assetInfo(db, s, x.id)!),
    })),
    common: plant.rooms.filter(r => !inAreas.has(r.id)).map(r => r.type),
    ahead: db.scenarios[s.scenario].assets.ahead,
  };
}

/** Срок записи: какая работа и последний день записи (номер дня от 1970-01-01). */
export interface DueRow {
  asset: AssetInfo;
  work: Work;
  until: number;
}

/**
 * Планёрка (Б3в): «Калибровка и квалификация» — визиты сегодня (идут или назначены на сегодня); что кончится в срок
 * предупреждения сценария; что уже просрочено.
 */
export interface AssetSum {
  today: AssetInfo[];
  soon: DueRow[];
  expired: DueRow[];
  ahead: number;
}

export function assetSum(db: ContentDb, s: PlantState): AssetSum {
  const day = momentOf(s.start, s.t).day;
  const dayStart = s.t - momentOf(s.start, s.t).sec;
  const ahead = db.scenarios[s.scenario].assets.ahead;
  const out: AssetSum = { today: [], soon: [], expired: [], ahead };
  for (const a of Object.values(s.assets)) {
    const v = a.visit;
    if (v && v.at < dayStart + DAY && (v.task === undefined || (v.to ?? 0) >= dayStart)) out.today.push(assetInfo(db, s, a.id)!);
    const cls = classOf(db, a);
    for (const work of WORKS) {
      if (!cls[work]) continue;
      const r = recOf(a, work);
      const until = r?.until ?? Number.NEGATIVE_INFINITY;
      if (!valid(a, work, day)) out.expired.push({ asset: assetInfo(db, s, a.id)!, work, until });
      else if (until - day < ahead) out.soon.push({ asset: assetInfo(db, s, a.id)!, work, until });
    }
  }
  out.soon.sort((x, y) => x.until - y.until || x.asset.inv - y.asset.inv);
  out.expired.sort((x, y) => x.until - y.until || x.asset.inv - y.asset.inv);
  out.today.sort((x, y) => (x.visit?.at ?? 0) - (y.visit?.at ?? 0) || x.inv - y.inv);
  return out;
}

/** Серия ждёт актив (Б3в): стадия — оборудование или прибор МОК в своём помещении; упаковка — машину линии. */
export interface AssetWait {
  batch: string;
  asset: string;
  why: Unfit;
  /** помещение стадии или линия */
  room?: string;
  line?: string;
}

/** Кого из серий держит непригодный актив: стадия без задачи, у которой актив не годен, и упаковка с комплектом у линии. */
export function assetWaits(db: ContentDb, s: PlantState): AssetWait[] {
  const plan = planOf(db, s.plant);
  const out: AssetWait[] = [];
  for (const b of Object.values(s.batches)) {
    if (b.status === 'process') {
      const st = db.recipes[b.recipe].stages[b.stage];
      if (!st || Object.values(s.tasks).some(t => t.kind === 'stage' && t.batch === b.id)) continue;
      const room = plan.roomOf[st.room];
      const u = stageUnfit(db, s, st, room);
      if (u) out.push({ batch: batchNo(b.code), asset: u.asset, why: u.why, room });
    } else if (b.status === 'packing' && b.pack?.state === 'ready') {
      const u = lineUnfit(db, s, b.pack.line);
      if (u) out.push({ batch: batchNo(b.code), asset: u.asset, why: u.why, line: b.pack.line });
    }
  }
  return out;
}
