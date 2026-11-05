// «Просят решить» (Б5д; docs/specs/2026-10-vertical-slice.md, «Б5д»; геймдизайн, §29.4): руководитель упирается в выбор,
// у которого обе стороны чего-то стоят, и спрашивает того, чей это выбор, — игрока, если пост развилки у него или он
// директор, — с ценой каждого ответа. Цены — знание завода: нормы стадий, часы подрядчика и записи актива, таблица
// отказов узла из его записи и его наработка, — а не разыгранная длительность и не запас узла до отказа (архитектура, §9).
// В срезе три развилки: визит подрядчика держит серию и замена узла перед работой машины (главный механик →
// «Производство»), кто ведёт расследование OOS (начальник ООК → директор). Пока вопрос открыт, завод живёт как сейчас:
// подрядчик ждёт, ООК ведёт, работа на машине ответа не ждёт. Не ответили за срок §29.4 или развилка решилась сама —
// руководитель решает «как сейчас». Спросить некого — развилка с обеими ценами в журнале, решено сразу. Спрашивает тот,
// кто сейчас решает за руководителя (Б5в): он сам или «и. о.» в свою смену; вне смены развилку увидят в смену. Мест не
// выбрано — ни вопросов, ни записей: золотой прогон тот же.
import type { ContentDb, PartType, SeatId } from '../content/types';
import { lineUnfit, stageUnfit, visitLast } from './assets';
import { replacesBy, skillOf, thresholdBy, type Who, whoDecides } from './bosses';
import { schedule } from './core/agenda';
import { addWorkdays, DAY, daysFromCivil, HOUR, isWorkday, momentOf } from './core/calendar';
import { P_ONE } from './core/rng';
import { modeOf } from './heads';
import { note, recordOf } from './journal';
import { consume, partType, wearAt } from './maint';
import { nominal, stageMass, stageWear } from './mes';
import { classOf } from './places';
import { planOf } from './plant';
import { numOf, POL } from './policies';
import { held } from './seats';
import type { Batch, Command, Decided, Decision, Fork, ForkOpt, Head, Notice, Part, PlantState } from './types';
import { calOf } from './workdays';

/** Сколько вопрос «Просят решить» ждёт ответа (геймдизайн, §29.4, гипотеза): 2 игровых часа. */
export const ASK_WAIT = 2 * HOUR;

/** Варианты развилки: первый — «как сейчас», им руководитель решает сам. */
export const FORK_OPTS: Record<Fork, readonly [ForkOpt, ForkOpt]> = { visit: ['wait', 'move'], replace: ['after', 'now'], oos: ['lead', 'self'] };

/** Кто спрашивает о развилке. */
export const FORK_HEAD: Record<Fork, Head> = { visit: 'maint', replace: 'maint', oos: 'qa' };

/** Пост развилки (§29.4): визит и замена — «Производство», расследование при «Качестве» не у игрока — директор. */
export const FORK_SEAT: Record<Fork, SeatId> = { visit: 'production', replace: 'production', oos: 'director' };

type ForkD = Extract<Decided, { kind: 'fork' }>;

/** Кого спросить: пост развилки у игрока или игрок — директор; иначе — никого. */
function askTo(s: PlantState, fork: Fork): SeatId | undefined {
  const h = held(s);
  if (!h) return undefined;
  if (h.includes(FORK_SEAT[fork])) return FORK_SEAT[fork];
  return h.includes('director') ? 'director' : undefined;
}

/**
 * Спросить (Б5д): запись руководителя с развилкой и обеими ценами, случай `sig` у вещи `key` — помнится, чтобы не спросить
 * дважды. Кого спросить есть — вопрос со сроком и извещение с автопаузой посту; нет — руководитель решил сам, сразу.
 */
function ask(s: PlantState, head: Head, key: string, sig: string, d: ForkD, notices: Notice[], who?: Who) {
  (s.heads.asked ??= {})[key] = sig;
  const to = askTo(s, d.fork);
  const r = note(s, head, d, undefined, undefined, who);
  if (!to) {
    r.q = { key, v: 0, end: { how: 'self', opt: FORK_OPTS[d.fork][0], t: s.t } };
    return;
  }
  r.q = { key, to, due: s.t + ASK_WAIT, v: 1 };
  schedule(s.agenda, r.q.due!, { kind: 'ask', n: r.n, v: 1 });
  (s.heads.qs ??= {})[key] = r.n;
  notices.push({ kind: 'ask', n: r.n, fork: d.fork, head, seat: to });
}

/** Вопрос закрыт: ответ — в запись; из открытых. */
function end(s: PlantState, r: Decision, how: NonNullable<NonNullable<Decision['q']>['end']>['how'], opt?: ForkOpt, seat?: SeatId, day?: number) {
  const q = r.q!;
  q.end = { how, ...(opt ? { opt } : {}), t: s.t, ...(seat ? { seat } : {}), ...(day !== undefined ? { day } : {}) };
  delete q.due;
  if (s.heads.qs?.[q.key] === r.n) delete s.heads.qs[q.key];
  if (s.heads.qs && Object.keys(s.heads.qs).length === 0) delete s.heads.qs;
}

// ---------------------------------------------------------------- визит держит серию

/** Что держит серию у пригодности актива сейчас — актив и причина; серия ждёт не актива — нет. */
function holdOf(db: ContentDb, s: PlantState, b: Batch): { asset: string; why: string } | undefined {
  if (b.status === 'process') {
    const st = db.recipes[b.recipe].stages[b.stage];
    return st ? stageUnfit(db, s, st, planOf(db, s.plan).roomOf[st.room]) : undefined;
  }
  return b.status === 'packing' && b.pack?.state === 'ready' ? lineUnfit(db, s, b.pack.line) : undefined;
}

/**
 * Когда актив освободится по норме идущей работы (Б5д): стадия на оборудовании — от её начала по норме карты на массу
 * серии; упаковка на линии — оставшиеся пачки задания по паспорту картонажной; свободен — сейчас.
 */
export function freeAt(db: ContentDb, s: PlantState, asset: string): number {
  const a = s.assets[asset];
  if (a?.family === 'equipment') {
    const id = s.equipment[a.id]?.batch;
    const b = id ? s.batches[id] : undefined;
    const st = b ? db.recipes[b.recipe].stages[b.stage] : undefined;
    return b && st ? Math.max(s.t, (b.run?.start ?? s.t) + nominal(db, b.recipe, st, stageMass(db, b, b.stage), b.sp)) : s.t;
  }
  if (a?.family === 'machine') {
    const plan = planOf(db, s.plan);
    const def = plan.plant.lines.find(l => l.machines.some(m => m.id === a.id));
    const line = def ? s.lines[def.id] : undefined;
    const b = line?.batch ? s.batches[line.batch] : undefined;
    if (!def || !line || !b?.pack || b.pack.state !== 'running') return s.t;
    const sku = db.skus[b.pack.sku];
    const left = Math.max(0, Math.floor(b.pack.tablets / (sku.perBlister * sku.blisters)) - line.made);
    const carton = def.machines.find(m => db.machines[m.type].item === 'carton');
    const rate = carton ? db.machines[carton.type].nominal : 0;
    return rate > 0 ? s.t + Math.ceil((left * 60) / rate) : s.t;
  }
  return s.t;
}

/**
 * Когда подрядчик начнёт и кончит (Б5д): когда актив освободится по норме идущей работы, — в первое окно его часов
 * рабочего дня, куда влезает работа класса, не раньше мгновения визита; за 60 суток не нашлось — нет. Так и `assetStep`
 * берёт работу.
 */
export function contractorSpan(db: ContentDb, s: PlantState, asset: string, from = freeAt(db, s, asset)): { start: number; end: number } | undefined {
  const a = s.assets[asset];
  const w = a?.visit ? classOf(db, a)[a.visit.work] : undefined;
  if (!a?.visit || !w) return undefined;
  const [open, shut] = db.scenarios[s.scenario].assets.hours;
  const cal = calOf(db, s);
  const z0 = daysFromCivil(s.start);
  let day = momentOf(s.start, Math.max(from, a.visit.at)).day;
  for (let k = 0; k < 60; k++, day = addWorkdays(cal, day, 1)) {
    if (!isWorkday(cal, day)) continue;
    const base = (day - z0) * DAY;
    const start = Math.max(base + open, from, a.visit.at);
    if (start - base + w.work <= shut) return { start, end: start + w.work };
  }
  return undefined;
}

/**
 * Визит держит серию (Б5д): серия ждёт актив, у которого визит, а подрядчик ещё не начал, — главный механик спрашивает
 * «Производство»: ждать подрядчика — серии ждут до конца его работы; перенести визит — на рабочий день до конца записи в
 * силе. Один раз на мгновение визита: перенесли — новый визит, новый вопрос. Вне смены главного механика и его «и. о.» —
 * не сейчас.
 */
function visitForks(db: ContentDb, s: PlantState, notices: Notice[], live: () => Batch[]) {
  // визита, которого подрядчик ещё не начал, нет ни у одного актива — спрашивать не о чем (почти всегда)
  if (!Object.values(s.assets).some(a => a.visit && a.visit.from === undefined)) return;
  let waits: Map<string, string[]> | undefined;
  for (const b of live()) {
    if (b.phase !== 'asset') continue;
    const u = holdOf(db, s, b);
    if (!u || u.why !== 'visit') continue;
    waits ??= new Map();
    waits.set(u.asset, [...(waits.get(u.asset) ?? []), b.id]);
  }
  if (!waits) return;
  const who = whoDecides(db, s, 'maint');
  if (!who) return;
  const today = momentOf(s.start, s.t).day;
  for (const [asset, batches] of waits) {
    const a = s.assets[asset];
    const v = a?.visit;
    if (!v || v.from !== undefined) continue;
    const key = `visit/${asset}`;
    if (s.heads.asked?.[key] === String(v.at)) continue;
    const span = contractorSpan(db, s, asset);
    if (!span) continue;
    const d: ForkD = { kind: 'fork', fork: 'visit', asset, work: v.work, batches, start: span.start, end: span.end, last: visitLast(a, today) };
    ask(s, 'maint', key, String(v.at), d, notices, who);
  }
}

// ---------------------------------------------------------------- замена перед работой

/** Свободна ли машина узла: у оборудования нет серии, линия не упаковывает. */
function idle(s: PlantState, pt: Part): boolean {
  if (!pt.line) return !s.equipment[pt.machine]?.batch;
  const line = s.lines[pt.line];
  return !line.batch || s.batches[line.batch].pack?.state !== 'running';
}

/**
 * Серии в работе и на упаковке — только у них бывает следующая работа машины и только их держит актив (Б5д): один проход
 * по сериям на шаг развилок, а не на каждый узел; порядок — тот же, что у всех серий.
 */
function liveOf(s: PlantState): Batch[] {
  const out: Batch[] = [];
  for (const b of Object.values(s.batches)) if (b.status === 'process' || b.status === 'packing') out.push(b);
  return out;
}

const bounds = new WeakMap<PartType, number>();

/**
 * Больше какой наработки узла вида `ty` одна работа не даст (Б5д) — граница сверху, а не цена: таблеток самой большой
 * карты базы при нагрузке уставки у верха диапазона любой стадии, вдвое — масса на входе стадии с поправкой на содержание
 * бывает больше массы карты, а штука машины линии — не меньше таблетки. Пока и с ней износ не дойдёт до порога, вопроса
 * не будет — серии не перебираем.
 */
function workBound(db: ContentDb, ty: PartType): number {
  let n = bounds.get(ty);
  if (n !== undefined) return n;
  let units = 0;
  let k = P_ONE;
  for (const r of Object.values(db.recipes)) {
    units = Math.max(units, r.batch.units);
    const p = ty.stress?.param;
    for (const st of p ? r.stages : [])
      for (const x of st.params) if (x.id === p && x.range[1] > x.target) k = Math.max(k, P_ONE + ty.stress!.coef * (x.range[1] - x.target));
  }
  n = 2 * Math.ceil((units * k) / P_ONE);
  bounds.set(ty, n);
  return n;
}

/**
 * Следующая работа на машине узла по норме (Б5д): у оборудования — серия, чья нынешняя стадия ждёт его в его помещении,
 * без начатой задачи, — наработка стадии по массе на входе и уставкам; у машины линии — задание на упаковку линии, ещё не
 * начатое, — штук машины из таблеток балка. Из нескольких — с самым ранним «не раньше». Нет — `undefined`. `live` — серии
 * в работе и на упаковке (`liveOf`).
 */
function nextWork(db: ContentDb, s: PlantState, pt: Part, live: Batch[]): { batch: string; units: number } | undefined {
  let best: Batch | undefined;
  if (!pt.line) {
    const eq = s.equipment[pt.machine];
    if (!eq || eq.batch) return undefined;
    const plan = planOf(db, s.plan);
    for (const b of live) {
      if (b.status !== 'process') continue;
      const st = db.recipes[b.recipe].stages[b.stage];
      if (!st || plan.roomOf[st.room] !== eq.room || !st.equipment.includes(eq.type)) continue;
      if (Object.values(s.tasks).some(t => t.kind === 'stage' && t.batch === b.id)) continue;
      if (!best || b.notBefore < best.notBefore || (b.notBefore === best.notBefore && b.id < best.id)) best = b;
    }
    return best ? { batch: best.id, units: stageWear(db, s, best, partType(db, pt)) } : undefined;
  }
  for (const b of live) {
    if (b.status !== 'packing' || b.pack?.line !== pt.line || b.pack.state === 'running' || !b.units) continue;
    if (!best || b.notBefore < best.notBefore || (b.notBefore === best.notBefore && b.id < best.id)) best = b;
  }
  if (!best) return undefined;
  const sku = db.skus[best.pack!.sku];
  const unit = db.machines[pt.of].item === 'blister' ? sku.perBlister : sku.perBlister * sku.blisters;
  return { batch: best.id, units: Math.floor(best.units! / unit) };
}

/**
 * Замена перед работой (Б5д): машина свободна, а следующая работа на ней по норме доведёт износ узла до порога политики, —
 * главный механик спрашивает «Производство»: заменить после работы — риск отказа посреди неё по таблице узла и время
 * ремонта; заменить сейчас — работа ждёт замены. Не спрашивает «вручную», вне смены — своей и «и. о.», как и замену по
 * наработке (maint.ts), со слабым навыком (меняет только после отказа) и без свободной запчасти. Один раз на узел и работу.
 */
function replaceForks(db: ContentDb, s: PlantState, notices: Notice[], live: () => Batch[]) {
  if (modeOf(s, 'maint') === 'manual') return;
  let who: Who | undefined | null = null;
  for (const pt of Object.values(s.parts)) {
    if (pt.state !== 'ok' || pt.plan || pt.task || !idle(s, pt)) continue;
    const at = numOf(db, s, POL.replace, pt.id);
    if (at === undefined) continue;
    const ty = partType(db, pt);
    const wear = wearAt(ty, pt.done);
    if (wear >= at || wearAt(ty, pt.done + workBound(db, ty)) < at) continue;
    const next = nextWork(db, s, pt, live());
    if (!next) continue;
    const after = wearAt(ty, pt.done + next.units);
    if (after < at) continue;
    const key = `replace/${pt.id}`;
    const sig = `${pt.installed}/${next.batch}`;
    if (s.heads.asked?.[key] === sig) continue;
    const sp = s.spares[ty.spare];
    if (!sp || sp.qty - sp.reserved <= 0) continue;
    if (who === null) who = whoDecides(db, s, 'maint');
    if (!who || !replacesBy(skillOf(s, who))) return;
    const d: ForkD = { kind: 'fork', fork: 'replace', part: pt.id, batch: next.batch, wear, after, at, hz: consume(ty, pt.done, next.units), repair: ty.repair, replace: ty.replace };
    ask(s, 'maint', key, sig, d, notices, who);
  }
}

// ---------------------------------------------------------------- кто ведёт OOS

/**
 * Кто ведёт OOS (Б5д): открыто расследование, «Качество» не у игрока, а начальник ООК — «сам», — он спрашивает
 * директора: «Ведите» — по правилу, лаборатория первой, затем наибольшее знание за час, вывод от порога; «Веду сам» —
 * расследование на доске игрока. Один раз на расследование; вне смены начальника ООК и его «и. о.» — не сейчас.
 */
function oosForks(db: ContentDb, s: PlantState, notices: Notice[], seats: SeatId[]) {
  if (seats.includes('quality') || modeOf(s, 'qa') !== 'auto') return;
  let who: Who | undefined | null = null;
  for (const inv of Object.values(s.investigations)) {
    if (inv.status !== 'open' || inv.lead) continue;
    const key = `oos/${inv.id}`;
    if (s.heads.asked?.[key] === inv.id) continue;
    if (who === null) who = whoDecides(db, s, 'qa');
    if (!who) return;
    const d: ForkD = { kind: 'fork', fork: 'oos', inv: inv.id, threshold: thresholdBy(skillOf(s, who), db.investigations[inv.model].threshold) };
    ask(s, 'qa', key, inv.id, d, notices, who);
  }
}

// ---------------------------------------------------------------- открытые вопросы

/** Не решилась ли развилка сама: подрядчик начал или визит перенесли; работа на машине началась; расследование закрыто. */
function settled(db: ContentDb, s: PlantState, r: Decision, live: () => Batch[]): boolean {
  const d = r.d as ForkD;
  switch (d.fork) {
    case 'visit': {
      const v = s.assets[d.asset]?.visit;
      return !v || v.from !== undefined || String(v.at) !== s.heads.asked?.[r.q!.key];
    }
    case 'replace': {
      const pt = s.parts[d.part];
      if (!pt || pt.state !== 'ok' || pt.plan || pt.task || !idle(s, pt)) return true;
      return nextWork(db, s, pt, live())?.batch !== d.batch;
    }
    case 'oos': {
      const inv = s.investigations[d.inv];
      return !inv || inv.status !== 'open' || !!held(s)?.includes('quality') || modeOf(s, 'qa') !== 'auto';
    }
  }
}

/**
 * После раздачи задач (Б5д): развилки, решившиеся сами, — «не нужно»; новые развилки — вопрос или запись «решил сам».
 * Мест не выбрано — ничего. Шаг идёт после каждого события: серии в работе — один проход за шаг и только если
 * понадобились; вопрос и запись не меняют ни серий, ни задач.
 */
export function forksStep(db: ContentDb, s: PlantState, notices: Notice[]) {
  const seats = held(s);
  if (!seats) return;
  let all: Batch[] | undefined;
  const live = () => (all ??= liveOf(s));
  if (s.heads.qs)
    for (const n of Object.values(s.heads.qs)) {
      const r = recordOf(s, n);
      if (r?.q && !r.q.end && settled(db, s, r, live)) end(s, r, 'moot');
    }
  visitForks(db, s, notices, live);
  replaceForks(db, s, notices, live);
  oosForks(db, s, notices, seats);
}

/** Срок ответа (событие `ask`, Б5д): вопрос открыт — руководитель решает сам, как сейчас: «решил сам: ответа нет». */
export function askDue(s: PlantState, n: number, v: number) {
  const r = recordOf(s, n);
  if (!r?.q || r.q.end || r.q.v !== v || r.d.kind !== 'fork') return;
  end(s, r, 'self', FORK_OPTS[r.d.fork][0]);
}

/**
 * Ответ на вопрос (команда `answer`, Б5д): «как сейчас» — завод живёт, как жил; другой — команда руководителя от имени
 * игрока, с его места, проверенная движком заново (`run` — та же команда, что у поста): перенос визита на день `day`,
 * замена узла сейчас или «Веду сам» — расследование на доске игрока. Не прошла — отказ с причиной, вопрос открыт. Отказы:
 * вопроса нет; он закрыт; такого варианта у развилки нет. Чей пост — проверено в seats.ts.
 */
export function answerFork(s: PlantState, cmd: Extract<Command, { kind: 'answer' }>, notices: Notice[], run: (c: Command) => Notice[]) {
  const refuse = (why: 'noQ' | 'qDone' | 'qOpt') => notices.push({ kind: 'refused', cmd: 'answer', why, detail: String(cmd.n) });
  const r = recordOf(s, cmd.n);
  if (!r?.q || r.d.kind !== 'fork') return refuse('noQ');
  if (r.q.end) return refuse('qDone');
  const d = r.d;
  const opts = FORK_OPTS[d.fork];
  if (!opts.includes(cmd.opt)) return refuse('qOpt');
  const h = held(s);
  const seat = h?.includes(r.q.to!) ? r.q.to : 'director';
  if (cmd.opt === opts[0]) return end(s, r, 'player', cmd.opt, seat);
  if (d.fork === 'oos') {
    const inv = s.investigations[d.inv];
    if (!inv || inv.status !== 'open') {
      end(s, r, 'moot');
      return refuse('qDone');
    }
    inv.lead = 'player';
    return end(s, r, 'player', cmd.opt, seat);
  }
  const c: Command = d.fork === 'visit' ? { kind: 'visit', asset: d.asset, day: cmd.day ?? -1 } : { kind: 'maintain', machine: s.parts[d.part]?.machine ?? '', part: s.parts[d.part]?.type ?? '' };
  const out = run(c);
  notices.push(...out);
  if (out.some(x => x.kind === 'refused')) return;
  end(s, r, 'player', cmd.opt, seat, d.fork === 'visit' ? cmd.day : undefined);
}
