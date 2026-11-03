// Движок завода (docs/02-architecture.md, §1, §3): `newPlant` и `apply`. Время идёт по событиям очереди, при равном
// времени — по номеру постановки. Ход времени срезами даёт то же состояние, что одним куском: это проверяют тесты.
//
// Устройство хода времени — как в «Больнице» (её src/engine/shift/engine.ts, `later` и `catchUp`): команда со временем
// ставит `until`, а `catchUp` проживает события по порядку, пока бюджет кадра `more()` позволяет. Недожитое
// доживается в следующих кадрах; любая следующая команда сначала доживает всё. `more` спрашивают после каждого события, и он
// видит извещения, уже данные этим доживанием: так поток расчёта встаёт ровно на событии автопаузы (Б2а).
import type { ContentDb, Id } from '../content/types';
import { alertsHour } from './alerts';
import { dailyHour, dailyMorning } from './daily';
import { assetDone, assetHour, assetStep, seedAssets, visitCommand, visitDone } from './assets';
import { cashHour, newCash } from './cash';
import { agenda, nextTime, popDue, schedule } from './core/agenda';
import { DAY, HOUR, momentOf } from './core/calendar';
import { deputyCommand } from './bosses';
import { capaCommand, capaHour, capaRunCommand, classifyCommand } from './capa';
import { answerFork, askDue, forksStep } from './forks';
import { answerCommand, headsDay, modeCommand, newHeads } from './heads';
import { hireCommand, hireHour } from './hire';
import { hoursHour, newPolicy, overtimeCommand } from './hours';
import { rosterCommand, rosterDay } from './shifts';
import { concludeCommand, invDone, investigateCommand, invStep, newIncident } from './investigation';
import { trimJournal } from './journal';
import { kpiHour, newKpi } from './kpi';
import { labDone, runDone, rushCommand, startSampling } from './lab';
import { leanHour, leanStep, newLoss } from './lean';
import { leaveCommand, leaveHour } from './leave';
import { lineDone, lineEvent, lineHour, lineStep, lineUpdate, newLines } from './line';
import { maintainCommand, maintDone, maintStep, newParts, spareArrives } from './maint';
import { forecastCommand, forecastHour, newForecast, replan, runForecast } from './forecast';
import { marketDone, marketHour, marketStep, newCustomers, rznPublished, seedFg } from './market';
import { memoCommand, memoDue, memoHour, withdrawCommand } from './memos';
import { BATCH_HOUR, cancelOrder, mesDone, mesHour, mesStep, packOrder, placeOrder, pressFail, shiftCommand, stageBegin } from './mes';
import { setpointCommand } from './modes';
import { auditDone, partnersDone, partnersHour, seedContracts, seedPairs, specPairs } from './partners';
import { coldOf } from './places';
import { planHour } from './planner';
import { planOf } from './plant';
import { newPolicies, POL, policyCommand } from './policies';
import { assessCommand, devHour, qaDone, qaStep, releaseCommand } from './qa';
import { foreign, seatCommand } from './seats';
import { goHome, LAST_CALL, postArrive, toPosts } from './staff';
import { createLot, findSlot } from './stock';
import { placePo, supplyDay } from './supply';
import { dispatch, release } from './tasks';
import { alsoCommand, seedTraining, trainDay, trainDone } from './train';
import { type Command, type Notice, type PlantEvent, type PlantState, SCHEMA } from './types';
import { wasteCommand, wasteDone, wasteHour } from './waste';
import { truckArrives, wmsDone } from './wms';

/** Час планёрки (геймдизайн, §2). */
export const MORNING = 8 * HOUR;

export interface NewPlant {
  scenario: Id;
  /** зерно партии; нет — зерно сценария */
  seed?: number;
}

export function newPlant(db: ContentDb, o: NewPlant): PlantState {
  const sc = db.scenarios[o.scenario];
  if (!sc) throw new Error(`no scenario ${o.scenario}`);
  const plan = planOf(db, sc.plant);
  const s: PlantState = {
    schema: SCHEMA,
    content: db.hash,
    scenario: sc.id,
    plant: sc.plant,
    seed: (o.seed ?? sc.seed) >>> 0,
    rng: {},
    start: sc.start.date,
    t: sc.start.hour * HOUR,
    agenda: agenda<PlantEvent>(),
    day: 0,
    cash: newCash(sc.cash, sc.start.hour * HOUR),
    next: {},
    lots: {},
    containers: {},
    units: {},
    slots: {},
    pos: {},
    trucks: {},
    people: {},
    vehicles: {},
    tasks: {},
    open: [],
    instruments: {},
    samples: {},
    tests: {},
    deviations: {},
    capas: {},
    investigations: {},
    batchNos: {},
    rooms: {},
    equipment: {},
    batches: {},
    lines: {},
    customers: newCustomers(sc, sc.start.hour * HOUR),
    orders: {},
    shipments: {},
    parts: {},
    spares: {},
    spareOrders: {},
    assets: {},
    pairs: {},
    contracts: {},
    policy: newPolicy(db, sc.id),
    policies: newPolicies(),
    setpoints: {},
    maintLog: [],
    losses: [],
    shiftTasks: [],
    vacancies: {},
    candidates: {},
    hires: {},
    former: {},
    leave: {},
    journal: [],
    daily: [],
    heads: newHeads(),
    waste: { log: [] },
    kpi: newKpi(sc.start.hour * HOUR),
  };
  s.losses.push(newLoss(momentOf(s.start, s.t).day));
  // люди — у входа, с табельными номерами по порядку приёма и записями обучения (Б3б); техника — на стоянке, приборы — в
  // лаборатории по плану
  const startDay = momentOf(s.start, s.t).day;
  for (const row of sc.staff) {
    for (let i = 0; i < row.n; i++) {
      const n = (s.next.E = (s.next.E ?? 0) + 1);
      const p = (s.people[`E${n}`] = { id: `E${n}`, role: row.role, shift: row.shift, skill: row.skill, tab: sc.training.tab + n - 1, train: {}, x: plan.entrance.x, z: plan.entrance.z, ot: [], otYear: { y: s.start.y, sec: 0 }, ...(row.also ? { also: [...row.also] } : {}) });
      seedTraining(db, sc, p, startDay);
    }
  }
  for (const row of sc.vehicles) {
    for (let i = 0; i < row.n; i++) {
      const id = `V${(s.next.V = (s.next.V ?? 0) + 1)}`;
      s.vehicles[id] = { id, type: row.type, x: plan.park.x, z: plan.park.z };
    }
  }
  for (const i of plan.plant.instruments) s.instruments[i.id] = { id: i.id, type: i.type, room: i.room };
  // физические активы (Б3в): вещи плана и техника — инвентарные номера и записи квалификации и калибровки
  seedAssets(db, sc, s, startDay);
  // пары «поставщик — изготовитель» (Б3г): одобрения на старте — в сроке
  seedPairs(db, sc, s, startDay);
  // помещения — чистые с начала партии; оборудование — по плану
  for (const r of plan.plant.rooms) s.rooms[r.id] = { id: r.id, type: r.type, status: 'clean', since: s.t };
  for (const e of plan.plant.equipment) s.equipment[e.id] = { id: e.id, type: e.type, room: e.room };
  s.lines = newLines(db, sc.plant, s.t);
  newParts(db, s);
  // запас на старте — разрешённые партии на стеллажах, ближе к шлюзу для материалов и ниже
  const near = plan.slot[plan.byKind.staging[0].id];
  for (const st of sc.stock) {
    // изготовитель запаса на старте (Б3г) — первой пары спецификации
    const maker = specPairs(db, st.material, startDay)[0]?.maker;
    createLot(db, s, {
      material: st.material,
      supplier: 'start',
      ...(maker ? { maker } : {}),
      qty: st.qty,
      status: 'released',
      where: () => {
        const sl = findSlot(s, plan, coldOf(db, sc.plant, st.material) ? 'cold' : 'storage', near, 99);
        if (!sl) throw new Error(`scenario ${sc.id}: no slot for start stock ${st.material}`);
        return { kind: 'slot', id: sl.id };
      },
    });
  }
  // склад ГП на старте (Б1г): завод уже работает — выпущенная ГП в обороте, ближе к экспедиции
  seedFg(db, sc, s, startDay);
  // прогноз продаж (Б6в): история спроса до старта и первый прогноз — в начале игры, без записи журнала
  s.forecast = newForecast(db, s);
  if (s.forecast) runForecast(db, s, s.forecast.at, { lag: true, journal: false });
  else delete s.forecast;
  // первая планёрка — ближайшие 08:00; часы — с ближайшего целого часа
  const today = Math.floor(s.t / DAY) * DAY;
  schedule(s.agenda, s.t < today + MORNING ? today + MORNING : today + DAY + MORNING, { kind: 'morning' });
  schedule(s.agenda, Math.floor(s.t / HOUR) * HOUR + HOUR, { kind: 'hour' });
  // договоры (Б3г): рамочные с поставщиками — объём по плану выпуска, поставки с покупателями; с первого дня партии
  seedContracts(db, sc, s, startDay);
  // заказы сценария — в первую секунду партии
  const out: Notice[] = [];
  for (const o of sc.orders) placePo(db, s, { kind: 'po', supplier: o.supplier, lines: o.lines, by: 'scenario' }, out);
  // задания на серию сценария: день от начала партии, с начала смены аппаратчиков
  for (const b of sc.batches) placeOrder(db, s, { kind: 'order', recipe: b.recipe, notBefore: today + b.day * DAY + BATCH_HOUR, by: 'scenario', ...(b.sku ? { sku: b.sku } : {}) }, out);
  // происшествие сценария (часть 4): корень по жребию зерна — скрытое
  newIncident(db, s);
  // кому пора учиться уже на старте (Б3б)
  trainDay(db, s, out);
  settle(db, s);
  return s;
}

/** Жить ли дальше после события: бюджет кадра и извещения, уже данные этим доживанием (автопауза, Б2а). */
export type More = (notices: readonly Notice[]) => boolean;

export function apply(db: ContentDb, s: PlantState, cmd: Command, more?: More): Notice[] {
  // время прошлой команды, ещё не прожитое, — сначала всё: команда видит завод таким же, как игрок
  const before = catchUp(db, s);
  const out = command(db, s, cmd, more);
  return before.length > 0 ? [...before, ...out] : out;
}

function command(db: ContentDb, s: PlantState, cmd: Command, more?: More): Notice[] {
  // своё и чужое (3е): команда игрока чужого поста — отказ с местом, чья она
  const own = foreign(s, cmd, db);
  if (own) return [{ kind: 'refused', cmd: cmd.kind, why: 'notYours', detail: own }];
  switch (cmd.kind) {
    case 'advance':
      if (cmd.seconds <= 0) return [];
      s.until = s.t + cmd.seconds;
      return catchUp(db, s, more);
    case 'po': {
      const notices: Notice[] = [];
      placePo(db, s, cmd, notices);
      return notices;
    }
    case 'order': {
      const notices: Notice[] = [];
      placeOrder(db, s, cmd, notices);
      settle(db, s, notices);
      return notices;
    }
    case 'pack': {
      const notices: Notice[] = [];
      packOrder(db, s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'release': {
      const notices: Notice[] = [];
      releaseCommand(db, s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'maintain': {
      const notices: Notice[] = [];
      maintainCommand(db, s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'rush': {
      const notices: Notice[] = [];
      rushCommand(s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'shift': {
      const notices: Notice[] = [];
      shiftCommand(s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'cancel': {
      const notices: Notice[] = [];
      cancelOrder(s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'forecast': {
      const notices: Notice[] = [];
      forecastCommand(db, s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'seat': {
      const notices: Notice[] = [];
      seatCommand(db, s, cmd, notices);
      // место качества отдали — коллега качества ведёт открытые расследования дальше и оценивает отклонения (Б1г); взяли —
      // предлагает (Б5б)
      const inv = invStep(db, s, notices);
      if (devHour(db, s, notices) || inv) settle(db, s, notices);
      return notices;
    }
    case 'investigate': {
      const notices: Notice[] = [];
      investigateCommand(db, s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'conclude': {
      const notices: Notice[] = [];
      concludeCommand(db, s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'assess': {
      const notices: Notice[] = [];
      assessCommand(db, s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'overtime': {
      // политика отдела (Б4а): задачи, которые ждали часов, раздаются по новой
      const notices: Notice[] = [];
      overtimeCommand(s, cmd, notices);
      settle(db, s, notices);
      return notices;
    }
    case 'roster': {
      // перевод на другой график (Б4б): с 1-го числа через месяц — сейчас раздавать нечего
      const notices: Notice[] = [];
      rosterCommand(db, s, cmd, notices);
      return notices;
    }
    case 'vacancy':
    case 'agency':
    case 'close':
    case 'hire':
    case 'dismiss': {
      // найм и увольнение (Б4в): по соглашению последний день — сегодня, а новую работу человек берёт только в смену
      const notices: Notice[] = [];
      hireCommand(db, s, cmd, notices);
      settle(db, s, notices);
      return notices;
    }
    case 'leave': {
      // часть отпуска (Б4г): начинается не раньше завтрашнего дня — сейчас раздавать нечего, кроме смены заместителя
      const notices: Notice[] = [];
      leaveCommand(db, s, cmd, notices);
      settle(db, s, notices);
      return notices;
    }
    case 'also': {
      // смежная профессия (Б4г): задачи изучить документы её строки — сразу в раздачу
      const notices: Notice[] = [];
      alsoCommand(db, s, cmd, notices);
      settle(db, s, notices);
      return notices;
    }
    case 'setpoint': {
      // уставка (Б1ж): её возьмёт ближайшая начатая стадия или задание — раздавать нечего
      const notices: Notice[] = [];
      setpointCommand(db, s, cmd, notices);
      return notices;
    }
    case 'waste': {
      // вывоз отклонённого (Б1з): подрядчик приедет на следующий рабочий день — раздавать нечего
      const notices: Notice[] = [];
      wasteCommand(db, s, cmd, notices);
      return notices;
    }
    case 'mode': {
      // режим отдела (Б5б): руководитель решит или предложит в свой час — сейчас раздавать нечего
      const notices: Notice[] = [];
      modeCommand(s, cmd, notices);
      return notices;
    }
    case 'policy': {
      // политика руководителя (Б5г): с ближайшего часа его правила — сейчас раздавать нечего
      const notices: Notice[] = [];
      policyCommand(db, s, cmd, notices);
      // способ прогноза (Б6в): прогноз планирования — сразу по новому способу
      if (cmd.policy === POL.method && notices.some(n => n.kind === 'policy')) replan(db, s);
      return notices;
    }
    case 'deputy': {
      // заместитель руководителя (Б5в): решит в свою смену, пока руководителя нет, — раздавать нечего
      const notices: Notice[] = [];
      deputyCommand(db, s, cmd, notices);
      return notices;
    }
    case 'visit': {
      // перенос визита подрядчика (Б5г): актив, чей визит отложен, снова берёт работу — раздать задачи
      const notices: Notice[] = [];
      visitCommand(db, s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
    case 'accept':
    case 'decline': {
      // ответ на предложение (Б5б): «Принять» — та же команда, что у игрока, со своей раздачей задач
      const notices: Notice[] = [];
      answerCommand(s, cmd, notices, c => command(db, s, c));
      return notices;
    }
    case 'memo': {
      // служебная записка (Б5д): руководитель ответит в свой час — сейчас раздавать нечего
      const notices: Notice[] = [];
      memoCommand(db, s, cmd, notices);
      return notices;
    }
    case 'withdraw': {
      // отозвать записку (Б5д): ответа не будет
      const notices: Notice[] = [];
      withdrawCommand(s, cmd, notices);
      return notices;
    }
    case 'answer': {
      // ответ на «Просят решить» (Б5д): другой вариант — та же команда, что у поста, со своей раздачей задач
      const notices: Notice[] = [];
      answerFork(s, cmd, notices, c => command(db, s, c));
      return notices;
    }
    case 'classify': {
      // класс отклонения (Б5е): срок по новому классу — раздавать нечего
      const notices: Notice[] = [];
      classifyCommand(s, cmd, notices);
      return notices;
    }
    case 'capa': {
      // CAPA назначена (Б5е): исполнитель выполнит её в свой час — раздавать нечего
      const notices: Notice[] = [];
      capaCommand(db, s, cmd, notices);
      return notices;
    }
    case 'capaRun': {
      // CAPA выполнена (Б5е): замена, обучение, визит или оценка — их задачи в раздачу
      const notices: Notice[] = [];
      capaRunCommand(db, s, cmd, notices);
      steps(db, s, notices);
      return notices;
    }
  }
}

/**
 * Раздать задачи; кому задачи не досталось — на пост (3а); затем у серий — чем занято их время (1ж): ждут они людей или
 * уже работают, видно после раздачи. С местами игрока — развилки «Просят решить» по тому, чего ждут серии (Б5д).
 */
function settle(db: ContentDb, s: PlantState, notices?: Notice[]) {
  dispatch(db, s);
  toPosts(db, s);
  leanStep(db, s);
  if (notices) forksStep(db, s, notices);
}

/**
 * После события: подрядчик и техслужба (раньше производства: свободный актив, к которому пришёл подрядчик, и свободную
 * машину, которой пора в замену узла, не займёт серия), производство, линии, качество, отгрузка, раздача задач.
 */
function steps(db: ContentDb, s: PlantState, notices: Notice[]) {
  assetStep(db, s);
  maintStep(db, s, notices);
  mesStep(db, s);
  lineStep(db, s, notices);
  qaStep(db, s);
  invStep(db, s, notices);
  marketStep(db, s, notices);
  settle(db, s, notices);
}

/**
 * Дожить время команды: события по порядку, после каждого — `more(извещения)`; нельзя — часы стоят на этом событии,
 * остальное в следующий раз. Без `more` — всё. Спрашивают после события, а не перед следующим: так и последнее событие до
 * цели может остановить доживание — извещение автопаузы держит часы ровно на своём событии (Б2а).
 * В конце часы стоят на том часе, до которого жили. Нечего доживать — ничего.
 */
export function catchUp(db: ContentDb, s: PlantState, more?: More): Notice[] {
  const notices: Notice[] = [];
  const target = s.until;
  if (target === undefined) return notices;
  for (;;) {
    const next = nextTime(s.agenda);
    if (next === undefined || next > target) break;
    const due = popDue(s.agenda, target)!;
    s.t = Math.max(s.t, due.t);
    handle(db, s, due.e, notices);
    if (more && !more(notices)) return notices;
  }
  s.t = target;
  delete s.until;
  return notices;
}

function handle(db: ContentDb, s: PlantState, ev: PlantEvent, notices: Notice[]) {
  switch (ev.kind) {
    case 'morning':
      s.day++;
      // сменно-суточное задание (Б6б): итог вчерашнего и строки на сутки — до планёрки, которую это событие открывает
      dailyMorning(db, s);
      notices.push({ kind: 'morning', day: s.day });
      schedule(s.agenda, s.t + DAY, { kind: 'morning' });
      return;
    case 'hour':
      // смены начинаются и кончаются в целые часы: раздать то, что ждало людей; партии, готовые к отбору проб, — в план
      schedule(s.agenda, s.t + HOUR, { kind: 'hour' });
      schedule(s.agenda, s.t + HOUR - LAST_CALL, { kind: 'leave' });
      for (const p of Object.values(s.people)) goHome(db, s, p);
      // полночь: кто потерял допуск, кому пора учиться (Б3б); переводы на другой график и итог учётного периода (Б4б) —
      // до зарплаты 1-го числа
      if (momentOf(s.start, s.t).sec === 0) {
        trainDay(db, s, notices);
        rosterDay(db, s, momentOf(s.start, s.t).day);
        // журнал решений (Б5а): записи старше срока уходят; отклонённое вчера руководитель может предложить снова (Б5б)
        trimJournal(s);
        headsDay(s);
      }
      // найм (Б4в): кандидаты, заявления, первые дни принятых, уход после последней смены — до раздачи задач часа
      hireHour(db, s, notices);
      // служебные записки (Б5д): руководитель снова в рабочем времени — ответ через час
      memoHour(db, s, notices);
      // отпуска (Б4г): кто ушёл в отпуск и вышел, черновик и утверждение графика, извещения; отпускные — в час банка
      leaveHour(db, s, notices);
      startSampling(db, s);
      cashHour(db, s, notices);
      // места и оборудование (Б3в): в полночь — у кого вышел срок; коллега техслужбы назначает визиты; подрядчик
      assetHour(db, s, notices);
      // контрагенты (Б3г): в полночь — приостановленные пары и договоры; коллега качества назначает оценки
      partnersHour(db, s, notices);
      maintStep(db, s, notices);
      mesHour(db, s);
      lineHour(db, s, notices);
      leanHour(db, s);
      // показатели руководителей (Б5ж): в полночь — срез суток, на 1-е — итог прошлого месяца; после учёта потерь часа
      kpiHour(db, s);
      // прогноз продаж (Б6в): в 00:00 1-го числа — после итога месяца, по которому показатель меряет прошлый прогноз
      forecastHour(db, s);
      // вывоз отклонённого (Б1з): коллега склада в 09:00, фура подрядчика в его час — к рампе её поставит шаг отгрузки
      wasteHour(db, s, notices);
      marketHour(db, s, notices);
      // коллеги планирования и снабжения (Б2в): задание через две недели, заказы поставщикам по расходу плана
      planHour(db, s, notices);
      supplyDay(db, s, notices);
      // коллега качества (Б1г): отклонения, которые уже можно оценить; расследование, которое ждало смены руководителя
      // (Б5в), — в первый час, когда есть кому решить
      devHour(db, s, notices);
      invStep(db, s, notices);
      // отклонения и CAPA (Б5е): срок отклонения, CAPA по правилу начальника ООК, исполнители в свой час, проверки
      capaHour(db, s, notices, c => command(db, s, c));
      lineStep(db, s, notices);
      qaStep(db, s);
      marketStep(db, s, notices);
      settle(db, s, notices);
      // сменно-суточное задание (Б6б): что начато и чего ждали; итог и новое задание — в событие 08:00
      dailyHour(db, s);
      // тревоги часа (Б2а) — по заводу, каким его оставил час; сверхурочные года на исходе (Б4а)
      alertsHour(db, s, notices);
      hoursHour(db, s, notices);
      return;
    case 'truck':
      truckArrives(db, s, ev.po, notices);
      settle(db, s, notices);
      return;
    case 'task': {
      const t = s.tasks[ev.id];
      if (!t || t.v !== ev.v || t.state !== 'busy') return;
      release(db, s, t);
      if (!labDone(db, s, t, notices) && !mesDone(db, s, t, notices) && !lineDone(db, s, t, notices) && !qaDone(db, s, t, notices) && !marketDone(db, s, t, notices) && !maintDone(db, s, t, notices) && !invDone(db, s, t, notices) && !trainDone(db, s, t) && !assetDone(db, s, t) && !partnersDone(db, s, t) && !wasteDone(db, s, t, notices)) wmsDone(db, s, t, notices);
      // паллета ГП уехала с места паллетирования — у линии освободилось место; машину линии починили — она снова в работе
      if ((t.kind === 'putaway' || t.kind === 'repair') && t.line) lineUpdate(db, s, s.lines[t.line], notices);
      if (t.kind === 'putaway' || t.kind === 'stage') startSampling(db, s);
      steps(db, s, notices);
      return;
    }
    case 'run':
      runDone(db, s, ev.test, ev.v);
      settle(db, s, notices);
      return;
    case 'batch':
      mesStep(db, s);
      settle(db, s, notices);
      return;
    case 'line':
      lineEvent(db, s, ev.id, ev.v, notices);
      steps(db, s, notices);
      return;
    case 'rzn':
      rznPublished(s, ev.lot);
      steps(db, s, notices);
      return;
    case 'begin':
      stageBegin(db, s, ev.task, ev.v);
      return;
    case 'fail':
      pressFail(db, s, ev, notices);
      steps(db, s, notices);
      return;
    case 'spare':
      spareArrives(db, s, ev.order);
      steps(db, s, notices);
      return;
    case 'post':
      // дошёл до поста: раздавать нечего — свободным он был и в пути
      postArrive(db, s, ev.person, ev.t);
      return;
    case 'leave':
      // последний зов перед концом смены: кому задачи не нашлось — к выходу
      settle(db, s, notices);
      return;
    case 'visit':
      // подрядчик кончил: счёт и приёмка; актив снова в работе, если его запись ещё действует
      visitDone(db, s, ev.asset, ev.v);
      steps(db, s, notices);
      return;
    case 'audit':
      // аудитор прислал отчёт (Б3г): счёт и задача специалисту ООК
      auditDone(db, s, ev.pair, ev.v);
      steps(db, s, notices);
      return;
    case 'memo':
      // час ответа на служебную записку (Б5д): команды руководителя — каждая со своей раздачей задач
      memoDue(db, s, ev.n, ev.v, notices, c => command(db, s, c));
      return;
    case 'ask':
      // срок ответа на «Просят решить» (Б5д): руководитель решает сам, как сейчас, — завод не меняется
      askDue(s, ev.n, ev.v);
      return;
  }
}
