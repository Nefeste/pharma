// Сохранение — снимок состояния со схемой и цепочкой миграций (ADR студии 0004; docs/02-architecture.md, §13). Забытая
// миграция стирает игру человека, поэтому каждый шаг закреплён образцом в tools/test/fixtures/.
import type { ContentDb } from '../content/types';
import { seedAssets } from './assets';
import { batchNo } from './batchno';
import { type Agenda, schedule } from './core/agenda';
import { HOUR, momentOf } from './core/calendar';
import { newCash } from './cash';
import { inForce } from './docs';
import { newPolicy } from './hours';
import { leanStep, newLoss } from './lean';
import { newLines } from './line';
import { newParts } from './maint';
import { newCustomers } from './market';
import { stageTaskNorm } from './mes';
import { seedContracts, seedPairs, specPairs } from './partners';
import { planOf } from './plant';
import { nominal } from './quality';
import { shiftEndAt } from './staff';
import { rowsOf } from './quals';
import { seedTraining } from './train';
import type { Ymd } from './core/calendar';
import { type Batch, type Person, type PlantEvent, type PlantState, SCHEMA, type Task } from './types';

type Raw = Record<string, unknown>;

/** Шаг миграции: снимок схемы N → снимок схемы N + 1. Индекс — схема, из которой шаг ведёт. */
const STEPS: Record<number, (raw: Raw, db: ContentDb) => Raw> = {
  // 1 → 2 (часть 1а): склад, закупки, люди и техника. Штат и техника — по сценарию, у входа и на стоянке; запаса и
  // заказов сценария нет: сохранение схемы 1 — завод без склада. Час — с ближайшего целого часа.
  1: (raw, db) => {
    const sc = db.scenarios[raw.scenario as string];
    if (!sc) throw new Error(`save: no scenario ${String(raw.scenario)}`);
    const plan = planOf(db, sc.plant);
    const next: Record<string, number> = {};
    const people: Raw = {};
    for (const row of sc.staff) {
      for (let i = 0; i < row.n; i++) {
        const id = `E${(next.E = (next.E ?? 0) + 1)}`;
        people[id] = { id, role: row.role, shift: row.shift, skill: row.skill, x: plan.entrance.x, z: plan.entrance.z };
      }
    }
    const vehicles: Raw = {};
    for (const row of sc.vehicles) {
      for (let i = 0; i < row.n; i++) {
        const id = `V${(next.V = (next.V ?? 0) + 1)}`;
        vehicles[id] = { id, type: row.type, x: plan.park.x, z: plan.park.z };
      }
    }
    const t = raw.t as number;
    schedule(raw.agenda as Agenda<PlantEvent>, Math.floor(t / HOUR) * HOUR + HOUR, { kind: 'hour' });
    return {
      ...raw,
      plant: sc.plant,
      cash: sc.cash,
      next,
      lots: {},
      containers: {},
      units: {},
      slots: {},
      pos: {},
      trucks: {},
      people,
      vehicles,
      tasks: {},
      open: [],
    };
  },
  // 2 → 3 (часть 1б): лаборатория. Приборы — по плану завода. У партий — истинные свойства и паспорт, номинальные:
  // средние, качественные — «соответствует». Партии в карантине уходят на отбор проб в ближайший час.
  2: (raw, db) => {
    const plant = db.plants[raw.plant as string];
    if (!plant) throw new Error(`save: no plant ${String(raw.plant)}`);
    const instruments: Raw = {};
    for (const i of plant.instruments) instruments[i.id] = { id: i.id, type: i.type, room: i.room };
    for (const lot of Object.values(raw.lots as Record<string, Raw>)) {
      const props = nominal(db, lot.material as string);
      lot.truth = props;
      lot.coa = { ...props };
    }
    return { ...raw, instruments, samples: {}, tests: {}, deviations: {} };
  },
  // 3 → 4 (часть 1в): производство. Помещения — чистые с момента сохранения, оборудование — по плану; серий нет:
  // задания сценария в старое сохранение не добавляются, их даёт игрок.
  3: (raw, db) => {
    const plant = db.plants[raw.plant as string];
    if (!plant) throw new Error(`save: no plant ${String(raw.plant)}`);
    const rooms: Raw = {};
    for (const r of plant.rooms) rooms[r.id] = { id: r.id, type: r.type, status: 'clean', since: raw.t };
    const equipment: Raw = {};
    for (const e of plant.equipment) equipment[e.id] = { id: e.id, type: e.type, room: e.room };
    return { ...raw, rooms, equipment, batches: {} };
  },
  // 4 → 5 (часть 1г): упаковочные линии — по плану, свободны, не налажены. Балк старых серий ждёт команды «упаковать»:
  // позиции у них нет.
  4: (raw, db) => {
    if (!db.plants[raw.plant as string]) throw new Error(`save: no plant ${String(raw.plant)}`);
    return { ...raw, lines: newLines(db, raw.plant as string, raw.t as number) };
  },
  // 5 → 6 (часть 1д): касса — проводки и счета от остатка на момент сохранения (он уже в копейках); выпущенная раньше ГП —
  // в обороте с момента выпуска; покупатели сценария копят спрос с момента миграции; заказов и отгрузок нет.
  5: (raw, db) => {
    const sc = db.scenarios[raw.scenario as string];
    if (!sc) throw new Error(`save: no scenario ${String(raw.scenario)}`);
    const lots = raw.lots as Record<string, Raw>;
    for (const b of Object.values(raw.batches as Record<string, Raw>)) {
      const fg = (b.pack as Raw | undefined)?.fg as string | undefined;
      if (b.status === 'released' && fg && lots[fg]) lots[fg].circulation = b.released;
    }
    const t = raw.t as number;
    return { ...raw, cash: newCash(raw.cash as number, t), customers: newCustomers(sc, t), orders: {}, shipments: {} };
  },
  // 6 → 7 (часть 1е): узлы машин — с износом сценария и новым запасом до отказа; ЗИП — начальный уровень; заказов
  // запчастей и записей журнала нет. Помещения плана, которых не было (мастерская), — чистые. Аварий нет: у времени
  // машин — строка «авария», 0. Стадия, идущая при сохранении, наработку узлам не добавит.
  6: (raw, db) => {
    const plant = db.plants[raw.plant as string];
    if (!plant) throw new Error(`save: no plant ${String(raw.plant)}`);
    const rooms = raw.rooms as Record<string, Raw>;
    for (const r of plant.rooms) rooms[r.id] ??= { id: r.id, type: r.type, status: 'clean', since: raw.t };
    for (const l of Object.values(raw.lines as Record<string, { machines: { times: Raw }[] }>)) for (const m of l.machines) m.times.fail ??= 0;
    for (const b of Object.values(raw.batches as Record<string, Raw>)) {
      for (const o of ((b.pack as Raw | undefined)?.oee as { times: Raw }[] | undefined) ?? []) o.times.fail ??= 0;
    }
    const out = { ...raw, parts: {}, spares: {}, spareOrders: {}, maintLog: [] };
    newParts(db, out as unknown as PlantState);
    return out;
  },
  // 7 → 8 (часть 1ж): потери — с суток миграции; у серий время до миграции — «до миграции», дальше — по состояниям;
  // сменных заданий нет; счётчики пачек линий — с нуля; задание, которое линия уже взяла, сменного задания не получит.
  7: (raw, db) => {
    const t = raw.t as number;
    for (const b of Object.values(raw.batches as Record<string, Raw>)) {
      const until = (b.released as number | undefined) ?? t;
      b.spent = until > (b.ordered as number) ? { before: until - (b.ordered as number) } : {};
      b.phaseAt = t;
    }
    for (const l of Object.values(raw.lines as Record<string, Raw>)) {
      l.packs = 0;
      l.made = 0;
    }
    const out = { ...raw, losses: [newLoss(momentOf(raw.start as Ymd, t).day)], shiftTasks: [] };
    // чем занята каждая серия — с момента миграции
    leanStep(db, out as unknown as PlantState);
    return out;
  },
  // 8 → 9 (часть 3а): посты ожидания и проверка фуры у рампы. Фура у рампы открыта — её разгрузка или погрузка уже идёт;
  // фура во дворе закрыта и при постановке к рампе пройдёт проверку. Путей на пост нет: свободные в смене пойдут на пост
  // при ближайшей раздаче задач. Ожидание рампы в потерях — с миграции.
  8: raw => {
    for (const t of Object.values(raw.trucks as Record<string, Raw>)) t.open = t.docked === true;
    return raw;
  },
  // 9 → 10 (часть 3б): отметки для истории вещи — с какого мгновения партия в своём статусе и когда готов результат
  // испытания. У прежних партий и испытаний их нет: карточка пишет «время не записано».
  9: raw => raw,
  // 10 → 11 (часть 3в): сутки линий для OEE суток. В прежних сутках потерь их нет — линии там без записи, как без задания;
  // нынешние сутки копят с этой минуты.
  10: raw => {
    for (const d of (raw.losses as Raw[] | undefined) ?? []) d.lines ??= {};
    return raw;
  },
  // 11 → 12 (часть 3г): партия может быть поднята игроком. В прежних сохранениях поднятых нет.
  11: raw => raw,
  // 12 → 13 (часть 3е): журнал мест игрока. В прежних сохранениях мест не выбирали — разрешено всё, как раньше.
  12: raw => raw,
  // 13 → 14 (часть 4): расследования результатов вне спецификации и происшествие сценария. В прежних сохранениях
  // расследований не было, а результат вне спецификации уже отклонил партию; происшествия у прежней партии нет.
  13: raw => ({ ...raw, investigations: {} }),
  // 14 → 15 (номер серии PPNNNMMYY, решения владельца #50, #51): у выданных досье — код продукта и прежний порядковый
  // номер; месяц и год — начала первого смешивания, если оно уже было (запись стадии или назначенные на неё аппаратчики),
  // иначе номер короткий. У партий балка и ГП серии — тот же номер изготовителя. Счёт кода — с наибольшего прежнего
  // номера, год — миграции; прежний общий счётчик номеров уходит. Момента выдачи досье у прежних серий нет.
  14: (raw, db) => {
    const start = raw.start as Ymd;
    const year = momentOf(start, raw.t as number).date.y;
    const tasks = Object.values(raw.tasks as Record<string, Raw>);
    const lots = raw.lots as Record<string, Raw>;
    const nos: Record<string, { year: number; n: number }> = {};
    for (const b of Object.values(raw.batches as Record<string, Raw>)) {
      const old = b.code as { y: number; m: number; n: number };
      if (old.n === 0) {
        b.code = { pp: '', n: 0, m: 0, y: 0 };
        continue;
      }
      const pp = db.products[b.product as string].code;
      const stages = db.recipes[b.recipe as string].stages;
      const mix = stages.find(st => st.mix)!;
      const rec = (b.records as { stage: string; start: number }[]).find(r => r.stage === mix.id);
      const busy = b.stage === stages.indexOf(mix) ? tasks.find(t => t.kind === 'stage' && t.batch === b.id && t.state === 'busy') : undefined;
      const when = rec?.start ?? (busy ? (busy.times as number[])[1] : undefined);
      const at = when === undefined ? undefined : momentOf(start, when).date;
      const code = { pp, n: old.n, m: at ? at.m : 0, y: at ? at.y % 100 : 0 };
      b.code = code;
      for (const id of [b.bulk, (b.pack as Raw | undefined)?.fg]) if (typeof id === 'string' && lots[id]) lots[id].vendorLot = batchNo(code);
      nos[pp] = { year, n: Math.max(nos[pp]?.n ?? 0, old.n) };
    }
    const next = { ...(raw.next as Record<string, number>) };
    delete next.batchCode;
    return { ...raw, next, batchNos: nos };
  },
  // 15 → 16 (Б2г): уборки помещений и переналадки линий в сутках потерь. Прежние сутки их не записывали — там нули, как
  // будто уборок не было; нынешние сутки копят с этой минуты.
  15: raw => {
    for (const d of (raw.losses as Raw[] | undefined) ?? []) {
      d.cleans ??= { major: 0, majorSec: 0, minor: 0, minorSec: 0 };
      d.changes ??= { n: 0, sec: 0 };
    }
    return raw;
  },
  // 16 → 17 (Б3а): испытание помнит редакцию спецификации. Прежним — редакция, действовавшая при отборе пробы (в базе
  // прототипа она одна); у испытания шага расследования — только у повторного: у него пределы той же спецификации.
  16: (raw, db) => {
    const start = raw.start as Ymd;
    const samples = raw.samples as Record<string, Raw>;
    const lots = raw.lots as Record<string, Raw>;
    for (const q of Object.values(raw.tests as Record<string, Raw>)) {
      if (q.spec !== undefined || (q.inv !== undefined && q.min === undefined && q.max === undefined)) continue;
      const sm = samples[q.sample as string];
      const spec = db.materials[lots[sm?.lot as string]?.material as string]?.spec;
      if (spec) q.spec = inForce(db, 'specs', spec, momentOf(start, (sm.taken as number | undefined) ?? (raw.t as number)).day);
    }
    return raw;
  },
  // 17 → 18 (Б3б): у человека — табельный номер по порядку приёма и записи обучения. Записи — по правилу начала партии,
  // но от дня сохранения: при загрузке никто не теряет допуск.
  17: (raw, db) => {
    const sc = db.scenarios[raw.scenario as string];
    if (!sc) throw new Error(`save: no scenario ${String(raw.scenario)}`);
    const day = momentOf(raw.start as Ymd, raw.t as number).day;
    for (const p of Object.values(raw.people as Record<string, Person>)) {
      p.tab = sc.training.tab + Number(p.id.slice(1)) - 1;
      p.train = {};
      seedTraining(db, sc, p, day);
    }
    return raw;
  },
  // 18 → 19 (Б3в): физические активы — инвентарные номера по порядку мест, записи квалификации и калибровки (поверки) по
  // правилу начала партии, но от дня сохранения: при загрузке всё в сроке. Отметка прибора «просроченная калибровка» —
  // теперь описка в журнале прибора: просроченный прибор в работу не берут, доля фона та же.
  18: (raw, db) => {
    const sc = db.scenarios[raw.scenario as string];
    if (!sc) throw new Error(`save: no scenario ${String(raw.scenario)}`);
    raw.assets = {};
    seedAssets(db, sc, raw as unknown as PlantState, momentOf(raw.start as Ymd, raw.t as number).day);
    for (const i of Object.values((raw.instruments ?? {}) as Record<string, Raw>)) if (i.check === 'overdue') i.check = 'typo';
    return raw;
  },
  // 19 → 20 (Б3г): у партии и строки заказа — изготовитель: у купленной — из записи поставщика, у запаса на старте —
  // первой пары спецификации, у своей продукции его нет; одобрения пар — по правилу начала партии, но от дня
  // сохранения, всё в сроке; договоры — с дня сохранения на срок сценария, купленное — ноль.
  19: (raw, db) => {
    const sc = db.scenarios[raw.scenario as string];
    if (!sc) throw new Error(`save: no scenario ${String(raw.scenario)}`);
    const day = momentOf(raw.start as Ymd, raw.t as number).day;
    const makerOf = (supplier: string, material: string) => (supplier === 'start' ? specPairs(db, material, day)[0]?.maker : db.suppliers[supplier]?.items[material]?.maker);
    for (const l of Object.values(raw.lots as Record<string, Raw>)) {
      const mk = makerOf(l.supplier as string, l.material as string);
      if (mk) l.maker = mk;
    }
    for (const po of Object.values(raw.pos as Record<string, Raw>)) {
      for (const l of po.lines as Raw[]) {
        const mk = makerOf(po.supplier as string, l.material as string);
        if (mk) l.maker = mk;
      }
    }
    raw.pairs = {};
    raw.contracts = {};
    seedPairs(db, sc, raw as unknown as PlantState, day);
    seedContracts(db, sc, raw as unknown as PlantState, day);
    return raw;
  },
  // 20 → 21 (Б4а): табель — с мгновения сохранения: сверхурочных отрезков нет, за год — ноль; кто занят задачей — после
  // конца нынешней смены сверхурочно, а вне смены — с мгновения сохранения; у стадий — норма для раздатчика; политика
  // отделов — «по потребности»; частей прошлых зарплат нет.
  20: (raw, db) => {
    const sc = db.scenarios[raw.scenario as string];
    if (!sc) throw new Error(`save: no scenario ${String(raw.scenario)}`);
    const s = raw as unknown as PlantState;
    const y = momentOf(s.start, s.t).date.y;
    for (const p of Object.values(s.people)) {
      p.ot = [];
      p.otYear = { y, sec: 0 };
      if (p.task) p.until = shiftEndAt(db, s, p, s.t) ?? s.t;
    }
    for (const t of Object.values(raw.tasks as Record<string, Task>)) if (t.kind === 'stage' && t.batch) t.norm = stageTaskNorm(db, (raw.batches as Record<string, Batch>)[t.batch]);
    raw.policy = Object.fromEntries(Object.keys(newPolicy(db, sc.id)).map(d => [d, 'need']));
    (raw.cash as Raw).wages = {};
    return raw;
  },
  // 21 → 22 (Б1г): у отклонения — оценка влияния, у старых её нет: открытые — без оценки, как были, их оценит пост
  // качества или коллега, а удержанные серии ждут их решения. Отклонение отклонённой партии и открытые отклонения
  // отклонённой серии решены вместе с ней — так их теперь решает движок (lab.ts, qa.ts).
  21: raw => {
    const s = raw as unknown as PlantState;
    for (const d of Object.values(s.deviations)) {
      if (d.status !== 'open') continue;
      if ((d.lot && s.lots[d.lot]?.status === 'rejected') || (d.batch && s.batches[d.batch]?.status === 'rejected')) d.status = 'closed';
    }
    return raw;
  },
  // 22 → 23 (Б4б): у человека — графики с днями начала, часы после смен за учётный период и итог прошлого периода. В
  // прежних сохранениях их нет: каждый — в своём графике с начала завода, переводов нет, часы периода — ноль; это и
  // значит отсутствие полей, менять нечего. Схема новая, чтобы 0.0.39 не открыл сохранение с переводами и не потерял их.
  22: raw => raw,
  // 23 → 24 (Б4в): найм — вакансий, кандидатов, принятых и уволенных нет; оклад у людей — роли (поля нет). Уборщики
  // сценария (#80) — новыми людьми у входа, с табельными номерами по порядку и записями обучения на день сохранения, как
  // будто были с начала; уборка, которая уже идёт, — мойка оборудования, после неё помещение уберёт уборщик (mes.ts).
  23: (raw, db) => {
    const sc = db.scenarios[raw.scenario as string];
    if (!sc) throw new Error(`save: no scenario ${String(raw.scenario)}`);
    const s = raw as unknown as PlantState;
    s.vacancies = {};
    s.candidates = {};
    s.hires = {};
    s.former = {};
    const plan = planOf(db, s.plant);
    const day = momentOf(s.start, s.t).day;
    const { y, m, d } = momentOf(s.start, s.t).date;
    // зарплата до схемы 24 начислена людям партии за весь месяц: по 15-е этого или по конец прошлого; первая половина —
    // половина оклада роли; уборщикам сценария, новым, начислений ещё не было
    const first = day - d + 1;
    for (const p of Object.values(s.people)) {
      p.paid = d >= 16 ? first + 14 : first - 1;
      if (d >= 16) p.half = { y, m, base: Math.floor(db.roles[p.role].salary / 2) };
    }
    const have = new Set(Object.values(s.people).map(p => p.role));
    for (const row of sc.staff) {
      if (have.has(row.role)) continue;
      for (let i = 0; i < row.n; i++) {
        const n = (s.next.E = (s.next.E ?? 0) + 1);
        const p: Person = { id: `E${n}`, role: row.role, shift: row.shift, skill: row.skill, tab: sc.training.tab + n - 1, train: {}, x: plan.entrance.x, z: plan.entrance.z, ot: [], otYear: { y, sec: 0 } };
        s.people[p.id] = p;
        seedTraining(db, sc, p, day);
      }
    }
    return raw;
  },
  // 24 → 25 (Б4г): отпуска — графиков и частей нет, черновик кадры составят в ближайшие 09:00 рабочего дня, если его день
  // уже настал (leave.ts); дней отпуска использовано — ноль. Запас людей сценария — новыми людьми у входа, с записями
  // обучения на день сохранения, как будто были с начала: людей роли меньше, чем в штате сценария, — недостающие с
  // графиком последних строк этой роли. Смежные профессии строк штата — людям строки по порядку табельных номеров, с
  // записями обучения по её строке матрицы. Начисленного по месяцам нет — для среднего заработка это оклад (cash.ts).
  24: (raw, db) => {
    const sc = db.scenarios[raw.scenario as string];
    if (!sc) throw new Error(`save: no scenario ${String(raw.scenario)}`);
    const s = raw as unknown as PlantState;
    s.leave = {};
    const plan = planOf(db, s.plant);
    const day = momentOf(s.start, s.t).day;
    const { y } = momentOf(s.start, s.t).date;
    const want = new Map<string, number>();
    for (const row of sc.staff) want.set(row.role, (want.get(row.role) ?? 0) + row.n);
    for (const [role, n] of want) {
      const rows = sc.staff.filter(r => r.role === role);
      for (let k = Object.values(s.people).filter(p => p.role === role).length; k < n; k++) {
        const row = rows[rows.length - 1 - ((n - 1 - k) % rows.length)];
        const e = (s.next.E = (s.next.E ?? 0) + 1);
        const p: Person = { id: `E${e}`, role, shift: row.shift, skill: row.skill, tab: sc.training.tab + e - 1, train: {}, x: plan.entrance.x, z: plan.entrance.z, ot: [], otYear: { y, sec: 0 } };
        s.people[p.id] = p;
        seedTraining(db, sc, p, day);
      }
    }
    const used = new Set<string>();
    for (const row of sc.staff) {
      const mine = Object.values(s.people)
        .filter(p => p.role === row.role && p.shift === row.shift && !used.has(p.id))
        .sort((a, b) => a.tab - b.tab)
        .slice(0, row.n);
      for (const p of mine) {
        used.add(p.id);
        if (!row.also || p.also) continue;
        const had = new Set(rowsOf(db, p));
        p.also = [...row.also];
        seedTraining(db, sc, p, day, new Set(rowsOf(db, p).filter(c => !had.has(c))));
      }
    }
    return raw;
  },
  // 25 → 26 (Б1д): у задания на упаковку — кто работал у линии и очистка линии перед ним. У прежних заданий записей нет —
  // в досье «не записано»; это и значит отсутствие полей, менять нечего. Стадия загрузки компонента — в карте, масса
  // на входе стадии считается из массы серии и карты: у серии, которую уже отвесили, стадии впереди загружают своё
  // по карте. Схема новая, чтобы 0.0.42 не открыл сохранение с записями упаковки и не потерял их.
  25: raw => raw,
  // 26 → 27 (Б1е): процедуру мойки оборудования учат и те, кто моет машины линии, — операторы упаковочной линии.
  // У людей из прежних сохранений записи на неё нет — запись как на старте партии: по хешу человека и кода, на день
  // сохранения. Помещение упаковки из прежнего сохранения чисто с начала игры: перед следующим заданием его уберут
  // после просрочки, а линию очистят. Схема новая и затем, чтобы 0.0.43 не открыл сохранение с занятым помещением.
  26: (raw, db) => {
    const sc = db.scenarios[raw.scenario as string];
    if (!sc) throw new Error(`save: no scenario ${String(raw.scenario)}`);
    const s = raw as unknown as PlantState;
    const day = momentOf(s.start, s.t).day;
    const wash = new Set(Object.values(db.sops).flatMap(x => (x.for.tasks?.includes('clean') ? [x.doc.code] : [])));
    for (const p of Object.values(s.people)) {
      const lack = new Set(rowsOf(db, p).filter(c => wash.has(c) && !p.train[c]));
      if (lack.size > 0) seedTraining(db, sc, p, day, lack);
    }
    return raw;
  },
  // 27 → 28 (Б1ж): уставки режимов — в состоянии, в прежнем сохранении их нет: всё по цели карты. У записей стадий
  // уставок нет, у таблетирования нет и скорости ротора — запись читается с целью карты; серия, которая уже заняла
  // помещение стадии, идёт по цели. Задание, которое линия уже взяла, — со скоростью блистерной по цели инструкции.
  27: (raw, db) => {
    const s = raw as unknown as PlantState;
    s.setpoints = {};
    for (const b of Object.values(s.batches)) {
      const st = db.recipes[b.recipe]?.stages[b.stage];
      if (b.status === 'process' && b.room && st && st.params.length > 0) b.sp = Object.fromEntries(st.params.map(p => [p.id, p.target]));
    }
    return raw;
  },
  // 28 → 29 (Б5а): журнал решений — в состоянии; в прежнем сохранении он пуст: до этой версии решения не записывались
  28: raw => {
    (raw as unknown as PlantState).journal = [];
    return raw;
  },
  // 29 → 30 (Б1и): учёт помещений по суткам — с мгновения сохранения, у прошлых суток его нет; у сменных заданий,
  // открытых и закрытых, выпуска по часам нет
  29: (raw, db) => {
    const s = raw as unknown as PlantState;
    for (const d of s.losses) d.rooms ??= {};
    leanStep(db, s);
    return raw;
  },
};

export function toSave(s: PlantState): string {
  return JSON.stringify(s);
}

export function fromSave(db: ContentDb, json: string): PlantState {
  let raw = JSON.parse(json) as Raw;
  let v = raw.schema;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error('save: no schema');
  if (v > SCHEMA) throw new Error(`save: schema ${v} is newer than ${SCHEMA}`);
  while (v < SCHEMA) {
    const step = STEPS[v];
    if (!step) throw new Error(`save: no migration from schema ${v}`);
    raw = step(raw, db);
    v++;
    raw.schema = v;
  }
  // план из базы мог вырасти без смены схемы (план здания, docs/specs/2026-10-view.md, 2а): новые помещения — чистые
  const plant = db.plants[raw.plant as string];
  const rooms = raw.rooms as Record<string, Raw> | undefined;
  if (plant && rooms) for (const r of plant.rooms) rooms[r.id] ??= { id: r.id, type: r.type, status: 'clean', since: raw.t };
  return raw as unknown as PlantState;
}
