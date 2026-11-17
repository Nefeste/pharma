// Проект «Новый продукт» (Б7д; docs/specs/2026-10-vertical-slice.md, «Б7д»; геймдизайн, §13): продукт в базе, но не на
// заводе — его карта, спецификации, методики, процедуры, соглашения и инструкции по упаковке без дня «в силе», — завод
// вводит этапами по фазам переноса технологии (who-tt-2022, §12) и правилам валидации процесса (eaeu-65, пп. 38–61):
// готовность — чего нет заводу; перенос методик — ОКК; документы и обучение; оценка очистки — ООК; пробная серия «не для
// продажи»; протокол валидации и серии валидации подряд; отчёт; изменение досье — добавление площадки (reg-eaeu,
// Б.II.б.1 д)). Редакции вводит в силу проект: их дни — в состоянии (`portfolio.docs`), базу с ними собирает `liveOf`.
// Начинает проект игрок на месте директора; этапы ведут коллеги отделов задачами.
import { type ContentDb, DRAFT_DAY, type Id } from '../content/types';
import { stageUnfit, unfit } from './assets';
import { addWorkdays, DAY, HOUR, momentOf } from './core/calendar';
import { type DocDays, liveOf } from './docs';
import { noteCmd, note } from './journal';
import { placeOrder } from './mes';
import { bookEval, livePairs, pairKey, pairValid, specPairs, STARTING } from './partners';
import { planOf } from './plant';
import { roomDown } from './site/down';
import { addTask } from './tasks';
import type { Batch, Command, Notice, PlantState, Project, ProjectStage } from './types';
import { calOf } from './workdays';

/** Кто делает работы этапов: перенос методик — аналитик, оценку очистки и отчёт — специалист ООК, протокол — начальник ООК. */
const DOERS = { methods: ['role.analyst'], clean: ['role.qa'], protocol: ['role.qa-head'], report: ['role.qa'] } as const;
/** Работа задачи этапа: полдня — рабочий день делят на две задачи, чтобы задача укладывалась в смену. */
const PIECE = 4 * HOUR;
const PRIO = 30;

const today = (s: PlantState) => momentOf(s.start, s.t).day;
const live = (db: ContentDb, s: PlantState) => liveOf(db, s.portfolio?.docs);

/** Карта продукта: первая редакция его карты в базе. */
export const recipeOf = (db: ContentDb, product: Id): Id | undefined => Object.values(db.recipes).find(r => r.product === product)?.id;

/** Продукт — проект: его карта ещё ни разу не вводилась в силу (Б7д). */
export function isProject(db: ContentDb, s: PlantState, product: Id): boolean {
  const r = recipeOf(db, product);
  return !!r && live(db, s).recipes[r].doc.from === DRAFT_DAY;
}

/** Позиции продукта по базе. */
const skusOf = (db: ContentDb, product: Id) => Object.values(db.skus).filter(k => k.product === product);

/**
 * Редакции-проекты продукта по группам — в каком этапе их вводят: материалы (спецификации исходных и упаковочных и
 * соглашения по ним) — на старте; методики и спецификация балка — после переноса методик; карта и процедуры её
 * оборудования — с этапом «документы»; инструкции по упаковке и спецификации готовой продукции — с вводом продукта.
 */
export function projectDocs(db: ContentDb, product: Id): { materials: Id[]; methods: Id[]; docs: Id[]; launch: Id[] } {
  const draft = (x: { doc: { from: number } } | undefined) => !!x && x.doc.from === DRAFT_DAY;
  const r = db.recipes[recipeOf(db, product)!];
  const skus = skusOf(db, product);
  const mats = new Set<Id>([...r.bom.map(l => l.material), ...skus.flatMap(k => [...k.blister.map(x => x.material), ...k.carton.map(x => x.material)])]);
  const materials = [...mats].map(m => db.materials[m]?.spec).filter(id => draft(db.specs[id]));
  for (const [id, a] of Object.entries(db.agreements)) if (draft(a) && a.materials.some(m => mats.has(m))) materials.push(id);
  const bulk = db.materials[r.bulk]?.spec;
  const tests = new Set<Id>([...r.stages.flatMap(st => st.ipc.map(q => q.test)), ...(bulk ? db.specs[bulk].tests.map(t => t.test) : []), ...[...mats].flatMap(m => db.specs[db.materials[m]?.spec]?.tests.map(t => t.test) ?? [])]);
  const methods = [...[...tests].filter(t => draft(db.tests[t])), ...(bulk && draft(db.specs[bulk]) ? [bulk] : [])];
  const eq = new Set(r.stages.flatMap(st => st.equipment));
  const docs = [...(draft(r) ? [r.id] : []), ...Object.entries(db.sops).flatMap(([id, x]) => (draft(x) && (x.for.equipment ?? []).some(e => eq.has(e)) ? [id] : []))];
  const launch = [...skus.filter(k => draft(k)).map(k => k.id), ...[...new Set(skus.map(k => db.materials[k.fg]?.spec))].filter(id => draft(db.specs[id]))];
  return { materials, methods, docs, launch };
}

/**
 * Чего нет заводу для карты продукта (Б7д, этап «готовность»): помещения типа стадии; годной единицы класса стадии в
 * нём; годного прибора лаборатории под методику спецификаций; одобренной пары у исходного или упаковочного материала.
 * Пусто — завод готов. Только записи завода: план, записи активов и пар.
 */
export type Gap = { kind: 'room'; type: string } | { kind: 'unit'; type: Id; room: string } | { kind: 'inst'; type: Id } | { kind: 'pair'; material: Id };

export function gapsOf(db: ContentDb, s: PlantState, product: Id): Gap[] {
  const d = live(db, s);
  const r = d.recipes[recipeOf(d, product)!];
  const plant = planOf(d, s.plan).plant;
  const out: Gap[] = [];
  for (const st of r.stages) {
    const rooms = plant.rooms.filter(x => x.type === st.room && !roomDown(d, s, x.id));
    if (rooms.length === 0) {
      if (!out.some(g => g.kind === 'room' && g.type === st.room)) out.push({ kind: 'room', type: st.room });
      continue;
    }
    if (rooms.some(x => !stageUnfit(d, s, st, x.id) && st.equipment.every(t => plant.equipment.some(e => e.room === x.id && e.type === t)))) continue;
    for (const t of st.equipment) if (!plant.equipment.some(e => e.type === t && rooms.some(x => x.id === e.room) && !unfit(d, s, e.id))) out.push({ kind: 'unit', type: t, room: rooms[0].id });
  }
  // лаборатория: под каждую методику спецификации балка и материалов с прибором — годный прибор
  const bulk = d.materials[r.bulk]?.spec;
  const tests = new Set([...(bulk ? d.specs[bulk].tests.map(t => t.test) : [])]);
  for (const t of tests) {
    const inst = d.tests[t]?.inst;
    if (inst && !plant.instruments.some(i => i.type === inst && !unfit(d, s, i.id)) && !out.some(g => g.kind === 'inst' && g.type === inst)) out.push({ kind: 'inst', type: inst });
  }
  // поставщики исходных и упаковочных материалов — квалифицированы (eaeu-65, п. 51): одобренная пара в силе
  const day = today(s);
  const mats = new Set<Id>([...r.bom.map(l => l.material), ...skusOf(d, product).flatMap(k => [...k.blister.map(x => x.material), ...k.carton.map(x => x.material)])]);
  for (const m of mats) if (STARTING.has(d.materials[m].kind) && !livePairs(d, s, m, day).some(x => pairValid(s.pairs[pairKey(x.supplier, x.maker)], day))) out.push({ kind: 'pair', material: m });
  return out;
}

/** Ввести редакции в силу с дня `day`: новый объект дней — по нему кэш действующей базы. */
function setDays(s: PlantState, ids: readonly Id[], day: number) {
  if (ids.length === 0) return;
  const docs: DocDays = { ...(s.portfolio?.docs ?? {}) };
  for (const id of ids) docs[id] = day;
  s.portfolio = { projects: s.portfolio?.projects ?? {}, docs };
}

/** Команда `project` (Б7д) — место директора. */
export function projectCommand(db: ContentDb, s: PlantState, cmd: Extract<Command, { kind: 'project' }>, notices: Notice[]) {
  const refuse = (why: 'noProduct' | 'projectBusy' | 'noProject' | 'notStage', detail: string) => notices.push({ kind: 'refused', cmd: 'project', why, detail });
  if (cmd.op === 'start') {
    if (!db.products[cmd.product] || !isProject(db, s, cmd.product)) return refuse('noProduct', cmd.product);
    if (Object.values(s.portfolio?.projects ?? {}).some(p => p.product === cmd.product && p.stage !== 'stopped')) return refuse('projectBusy', cmd.product);
    const n = Object.keys(s.portfolio?.projects ?? {}).length + 1;
    const p: Project = { id: `P${n}`, product: cmd.product, recipe: recipeOf(db, cmd.product)!, started: s.t, stage: 'ready', since: s.t, batches: [], passed: 0, restarts: 0 };
    s.portfolio = { projects: { ...(s.portfolio?.projects ?? {}), [p.id]: p }, ...(s.portfolio?.docs ? { docs: s.portfolio.docs } : {}) };
    // материалы — в силе со старта: спецификации и соглашения, пары — на оценку (поставщиков квалифицируют до серий
    // валидации, eaeu-65, п. 51)
    const day = today(s);
    setDays(s, projectDocs(db, cmd.product).materials, day);
    const d = live(db, s);
    for (const m of Object.values(d.materials)) {
      if (!STARTING.has(m.kind)) continue;
      for (const x of specPairs(d, m.id, day)) {
        const key = pairKey(x.supplier, x.maker);
        if (s.pairs[key]) continue;
        s.pairs[key] = { id: key, supplier: x.supplier, maker: x.maker, recs: [] };
        bookEval(d, s, s.pairs[key], day);
      }
    }
    noteCmd(s, cmd, { kind: 'project', op: 'start', project: p.id, product: p.product });
    return;
  }
  const p = s.portfolio?.projects[cmd.id];
  if (!p || p.stage === 'done' || p.stage === 'stopped') return refuse('noProject', cmd.id);
  if (cmd.op === 'stop') {
    p.stage = 'stopped';
    p.since = s.t;
    for (const t of Object.values(s.tasks)) if (t.project === p.id && t.state !== 'busy') delete s.tasks[t.id];
    noteCmd(s, cmd, { kind: 'project', op: 'stop', project: p.id, product: p.product });
    return;
  }
  // протокол: решение — до первой серии валидации
  if (p.stage !== 'protocol' && !(p.stage === 'trial' || p.stage === 'ready' || p.stage === 'methods' || p.stage === 'docs' || p.stage === 'clean')) return refuse('notStage', p.id);
  p.sell = cmd.sell;
  noteCmd(s, cmd, { kind: 'project', op: 'protocol', project: p.id, product: p.product, sell: cmd.sell });
}

/** Задачи этапа: рабочих дней × две по полдня у поста первой роли. */
function work(db: ContentDb, s: PlantState, p: Project, stage: keyof typeof DOERS, days: number) {
  const plan = planOf(db, s.plan);
  const roles = DOERS[stage];
  const at = plan.posts[roles[0]] ?? plan.entrance;
  for (let i = 0; i < days * 2; i++) addTask(s, { kind: 'project', roles: [...roles], from: { kind: 'point', x: at.x, z: at.z }, work: PIECE, prio: PRIO, project: p.id });
}

const busy = (s: PlantState, p: Project) => Object.values(s.tasks).some(t => t.project === p.id);

function next(db: ContentDb, s: PlantState, p: Project, stage: ProjectStage, notices: Notice[]) {
  p.stage = stage;
  p.since = s.t;
  notices.push({ kind: 'project', project: p.id, product: p.product, stage });
  note(s, 'qa', { kind: 'project', op: 'stage', project: p.id, product: p.product, stage });
}

/** Серия проекта: задание на карту продукта сейчас — пробная или валидации. */
function order(db: ContentDb, s: PlantState, p: Project, role: 'trial' | 'validation', notices: Notice[]): Batch | undefined {
  const b = placeOrder(db, s, { kind: 'order', recipe: p.recipe, by: 'project' }, notices);
  if (!b) return undefined;
  b.for = { kind: 'project', project: p.id, role };
  if (role === 'trial') p.trial = b.id;
  else p.batches.push(b.id);
  return b;
}

/**
 * Итог лаборатории по серии проекта: разрешён — `pass`, отклонён (балк или серия) — `fail`, ещё нет — `undefined`.
 * Балк «не для продажи» после разрешения — в отклонённое: его выносят, как отклонённый (Б1з).
 */
function verdict(s: PlantState, b: Batch | undefined, keep: boolean): 'pass' | 'fail' | undefined {
  if (!b) return undefined;
  if (b.status === 'rejected' || b.status === 'cancelled') return 'fail';
  const lot = b.bulk ? s.lots[b.bulk] : undefined;
  if (!lot) return undefined;
  if (lot.status === 'rejected') return 'fail';
  if (lot.status !== 'released') return undefined;
  if (!keep) lot.status = 'rejected';
  return 'pass';
}

/** Час (Б7д): этапы проектов идут, когда их работа сделана и условие этапа выполнено. */
export function projectHour(db: ContentDb, s: PlantState, notices: Notice[]) {
  const sc = db.scenarios[s.scenario].project;
  if (!sc || !s.portfolio) return;
  for (const p of Object.values(s.portfolio.projects)) {
    if (p.stage === 'done' || p.stage === 'stopped') continue;
    const d = live(db, s);
    const day = today(s);
    switch (p.stage) {
      case 'ready':
        if (gapsOf(db, s, p.product).length > 0) break;
        next(d, s, p, 'methods', notices);
        work(d, s, p, 'methods', sc.method * Math.max(1, projectDocs(db, p.product).methods.length));
        break;
      case 'methods': {
        if (busy(s, p)) break;
        const ds = projectDocs(db, p.product);
        setDays(s, ds.methods, day);
        // карта и процедуры — в силе через срок предупреждения обучения: до того дня люди их учат (Б3б)
        p.until = day + db.scenarios[s.scenario].training.ahead;
        setDays(s, ds.docs, p.until);
        next(d, s, p, 'docs', notices);
        break;
      }
      case 'docs':
        if (day < p.until!) break;
        next(d, s, p, 'clean', notices);
        work(d, s, p, 'clean', sc.clean);
        break;
      case 'clean':
        if (busy(s, p)) break;
        next(d, s, p, 'trial', notices);
        order(live(db, s), s, p, 'trial', notices);
        break;
      case 'trial': {
        const v = verdict(s, p.trial ? s.batches[p.trial] : undefined, false);
        if (v === 'fail') {
          p.restarts++;
          order(d, s, p, 'trial', notices);
        } else if (v === 'pass') {
          next(d, s, p, 'protocol', notices);
          work(d, s, p, 'protocol', sc.protocol);
        }
        break;
      }
      case 'protocol':
        if (busy(s, p)) break;
        next(d, s, p, 'validation', notices);
        order(d, s, p, 'validation', notices);
        break;
      case 'validation': {
        const last = s.batches[p.batches[p.batches.length - 1]];
        const v = verdict(s, last, !!p.sell);
        if (v === undefined) break;
        if (v === 'fail') {
          // серия не прошла критерий — отклонение по Б5е; счёт серий подряд — заново
          p.passed = 0;
          p.restarts++;
        } else p.passed++;
        if (p.passed >= sc.batches) {
          next(d, s, p, 'report', notices);
          work(d, s, p, 'report', sc.report);
        } else order(d, s, p, 'validation', notices);
        break;
      }
      case 'report': {
        if (busy(s, p)) break;
        const v = db.scenarios[s.scenario].partners.variation;
        const days = v ? v.check + v.expert + v.decide : 0;
        p.dossier = { filed: day, decide: addWorkdays(calOf(d, s), day, days) };
        next(d, s, p, 'dossier', notices);
        break;
      }
      case 'dossier': {
        if (day < p.dossier!.decide) break;
        setDays(s, projectDocs(db, p.product).launch, day);
        p.live = day;
        // серии валидации на продажу (протокол): разрешённый балк — в позицию продукта, дальше — упаковка
        const sku = Object.values(db.skus).find(k => k.product === p.product)?.id;
        if (p.sell && sku) for (const id of p.batches) if (s.batches[id] && !s.batches[id].sku && s.lots[s.batches[id].bulk ?? '']?.status === 'released') s.batches[id].sku = sku;
        next(live(db, s), s, p, 'done', notices);
        break;
      }
    }
  }
}

/** Задача проекта кончилась: этап проверит час. */
export function projectDone(_db: ContentDb, _s: PlantState, t: { kind: string }): boolean {
  return t.kind === 'project';
}

/**
 * Разгон спроса позиции после ввода (Б7д), %: в день ввода — доля сценария, к концу срока — весь; позиция не из
 * проекта — 100. День ввода — день «в силе» её инструкции в действующей базе.
 */
export function rampOf(db: ContentDb, s: PlantState, sku: Id): number {
  const k = db.skus[sku];
  const r = db.scenarios[s.scenario].project?.ramp;
  if (!k?.launch || !r) return 100;
  const days = today(s) - k.doc.from;
  if (days < 0) return 0;
  const span = r.months * 30;
  return r.from + Math.floor(((100 - r.from) * Math.min(days, span)) / span);
}

/** Мгновение дня — для видов. */
export const dayT = (s: PlantState, day: number) => (day - momentOf(s.start, 0).day) * DAY;
