// Журнал решений (Б5а; docs/specs/2026-10-vertical-slice.md, «Б5а»): окно справа — кто что решил и почему. Строки — от
// новых к старым: время, кто — руководитель или вы с места, — что решено и о чём; у вещи — переход к её карточке;
// строка раскрывается причиной с числами завода. Отбор — по посту и по автору. «Кто решил» в карточках — строки с
// «Почему?», которое открывает журнал на записи. С Б5б — режимы отделов взятых постов полосой сверху, предложения
// руководителей — «Ждут вашего решения» с «Принять» и «Отклонить», у ответа — кто и когда ответил. Вид собирает поток
// расчёта (src/sim/journal.ts); слова — здесь и в src/i18n/.
import { useState } from 'react';
import { SEATS, type SeatId } from '../content/types';
import { momentOf, type Ymd } from '../engine/core/calendar';
import { KEEP } from '../engine/journal';
import { FORK_OPTS } from '../engine/forks';
import { ONE_FAILURE } from '../engine/maint';
import type { BatchFor, Command, Decided, DeptMode, Head } from '../engine/types';
import { dayText, durText, money, named, num, pctText, qtyText, T, whenText } from '../i18n';
import type { AskInfo, JournalAs, JournalRef, JournalRow, ModeInfo, WhoRow } from '../sim/journal';
import { assetClass, workName } from './assets';
import { capaName, causeText } from './capa';
import { db } from './db';
import { policyName, policyText } from './policy';
import type { Actions, Hud } from './store';
import { attrNum, attrText, paramText } from './units';

const sku = (id?: string) => (id ? named(db?.skus[id]?.name, id) : '');
/** Месяц прогноза (Б6в) словом: номер — год × 12 + месяц − 1. */
const monthWord = (n: number) => T.fc.month(Math.floor(n / 12), (n % 12) + 1);
const product = (id?: string) => (id ? named(db?.products[id]?.name, id) : '');
const material = (id: string) => named(db?.materials[id]?.name, id);
const role = (id: string) => named(db?.roles[id]?.name, id);
const testName = (id: string) => named(db?.tests[id]?.name, id);
const unitOf = (m: string) => db?.materials[m]?.unit ?? 'mass';
const qty = (m: string, v: number) => qtyText(v, unitOf(m));
const machineName = (id?: string) => (id ? named(db?.equipment[id]?.name ?? db?.machines[id]?.name, id) : '');
const partName = (machine?: string, part?: string) => {
  const rec = machine ? (db?.equipment[machine] ?? db?.machines[machine]) : undefined;
  return named(rec?.parts.find(p => p.id === part)?.name, part ?? '');
};
const party = (id: string) => named(db?.suppliers[id]?.name ?? db?.customers[id]?.name, id);
/** Пара `поставщик|изготовитель` — словами. */
const pairName = (key: string) => {
  const [s, m] = key.split('|');
  return `${party(s)} — ${named(db?.makers[m]?.name, m)}`;
};
const batchCode = (r: JournalRef) => r.code ?? (r.bn !== undefined ? `B${r.bn}` : '');
const model = (r: JournalRef) => (r.model ? db?.investigations[r.model] : undefined);
const cause = (r: JournalRef, id: string) => named(model(r)?.candidates.find(c => c.id === id)?.name, id);
const p10k = (p: number) => pctText(p);

/**
 * Кто решил: руководитель или «вы» с местом; с Б5в — человек штата за руководителя: сам руководитель — его роль и
 * табельный номер, заместитель — «и. о.» с его ролью и номером.
 */
export function whoText(by: Head | 'player', seat?: SeatId, as?: JournalAs): string {
  if (by === 'player') return T.journal.player(seat ? (T.seats.names[seat] ?? seat) : '');
  if (!as) return T.journal.names[by] ?? by;
  const person = T.card.person(role(as.role), as.tab);
  return as.io ? T.journal.acting(T.journal.namesOf[by] ?? by, person) : person;
}

/** Уставка словами: режим стадии карты с единицей или скорость блистерной позиции — блистеров в минуту. */
function modeText(r: JournalRef, v: number): string {
  const m = r.mode;
  if (m?.sku) return T.ref.perMin(num(v), T.ref.items.blister ?? '');
  const p = m?.recipe ? db?.recipes[m.recipe]?.stages.find(st => st.id === m.stage)?.params.find(x => x.id === m.param) : undefined;
  return p ? paramText(p.unit, v) : num(v);
}

/** Что за уставка: скорость блистерной позиции или режим, стадия и карта — как на планёрке. */
function modeWhat(r: JournalRef): string {
  const m = r.mode;
  if (m?.sku) return `${T.speed.title} · ${sku(m.sku)}`;
  return [T.ref.params[m?.param ?? ''] ?? m?.param, T.stages[m?.stage ?? ''] ?? m?.stage, m?.recipe ? named(db?.recipes[m.recipe]?.name, m.recipe) : ''].filter(Boolean).join(' · ');
}

/** Срок и под что задания (Б6а): « · срок 15.03 15:00 · под заказ Аптечной сети»; у прежних заданий — ничего. */
function goalText(due: number | undefined, goal: BatchFor | undefined, r: JournalRef, start: Ymd): string {
  const J = T.journal.what;
  const when = due !== undefined ? J.due(whenText(start, due)) : '';
  return `${when}${goal?.kind === 'order' ? J.forOrder(r.customer ? named(db?.customers[r.customer]?.name, r.customer) : goal.order) : ''}`;
}

/** Что решено и о чём — одной строкой. */
export function whatText(d: Decided, r: JournalRef, start: Ymd): string {
  const J = T.journal.what;
  switch (d.kind) {
    case 'order':
      return `${J.order(sku(d.sku) || named(db?.recipes[d.recipe]?.name, d.recipe), whenText(start, d.notBefore))}${goalText(d.due, d.for, r, start)}${r.code ? ` · ${T.now.batch(r.code)}` : ''}`;
    case 'cancel':
      return `${J.cancel(sku(d.sku) || T.now.batch(r.code || `B${r.bn ?? ''}`), whenText(start, d.notBefore))}${goalText(d.due, d.for, r, start)}`;
    case 'po':
      return J.po(party(d.supplier), (r.po?.lines ?? []).map(l => `${material(l.material)}, ${qty(l.material, l.qty)}`).join('; '));
    case 'step':
      return `${J.step(named(model(r)?.steps.find(s => s.id === d.step)?.name, d.step))}${batchCode(r) ? ` · ${T.now.batch(batchCode(r))}` : ''}`;
    case 'conclude':
      return `${J.conclude(cause(r, d.cause), d.fate === 'release')}${batchCode(r) ? ` · ${T.now.batch(batchCode(r))}` : ''}`;
    case 'assess':
      return `${J.assess(T.dev.no(r.dev ?? 0), d.verdict === 'none')}${batchCode(r) ? ` · ${T.now.batch(batchCode(r))}` : ''}`;
    case 'classify':
      // класс отклонения (Б5е): был и стал
      return `${J.classify(T.dev.no(r.dev ?? 0), T.dev.clsLow[d.from] ?? d.from, T.dev.clsLow[d.to] ?? d.to)}${batchCode(r) ? ` · ${T.now.batch(batchCode(r))}` : ''}`;
    case 'capa':
      return `${J.capa(capaName(d.action), T.dev.no(r.dev ?? 0))}${batchCode(r) ? ` · ${T.now.batch(batchCode(r))}` : ''}`;
    case 'capaRun':
      return J.capaRun(capaName(d.action), r.dev !== undefined ? T.dev.no(r.dev) : '');
    case 'capaCheck':
      return J.capaCheck(r.dev !== undefined ? T.dev.no(r.dev) : '', d.ok);
    case 'pairEval':
      return J.pairEval(pairName(d.pair), d.how === 'audit');
    case 'visit': {
      const a = r.asset;
      const what = a ? `${assetClass(a)}, ${T.assets.inv(a.inv)}` : d.asset;
      const work = a ? workName(a, d.work).toLowerCase() : d.work;
      // перенос игроком (Б5г): новое мгновение вместо прежнего
      return d.from !== undefined ? J.visitMoved(work, what, whenText(start, d.at), whenText(start, d.from)) : J.visit(work, what, whenText(start, d.at));
    }
    case 'repair':
      return J.repair(partName(r.machine, r.part), machineName(r.machine));
    case 'replace':
      return J.replace(partName(r.machine, r.part), machineName(r.machine), !!d.why);
    case 'spare':
      return J.spare(named(db?.spares[d.spare]?.name, d.spare), d.qty);
    case 'vacancy':
      return J.vacancy(role(d.role), d.via);
    case 'hire':
      return `${J.hire(role(d.role))}${r.person ? `, ${T.card.person(role(r.person.role), r.person.tab)}` : ''}`;
    case 'leaveDraft':
      return J.leaveDraft(d.y);
    case 'targets':
      return J.targets;
    case 'setpoint':
      return J.setpoint(modeWhat(r), modeText(r, d.value), modeText(r, d.target));
    case 'lot':
      return J.lot(`${r.lot ? T.lotCode(...r.lot) : d.lot}${r.material ? `, ${material(r.material)}` : ''}`, T.journal.verdict[d.verdict]);
    case 'batch':
      return J.batch(batchCode(r), T.journal.decision[d.decision]);
    case 'contract':
      return J.contract(d.contract, party(d.party), dayText(d.to));
    case 'extend':
      return J.extend(d.contract, party(d.party), dayText(d.to));
    case 'forecast':
      return J.forecast(monthWord(d.m), T.fc.cases(d.cases));
    case 'fcEdit':
      return J.fcEdit(sku(d.sku), monthWord(d.m), d.cases !== undefined ? T.fc.cases(d.cases) : undefined);
    case 'waste':
      return J.waste(d.at !== undefined ? whenText(start, d.at) : undefined);
    case 'mode':
      return J.mode(T.journal.names[d.head] ?? d.head, T.journal.modes[d.mode] ?? d.mode);
    case 'policy': {
      const p = db?.policies[d.policy];
      return J.policy(policyName(p, d.policy, { of: d.of, machine: r.machine, part: r.part }), policyText(p, d.to), policyText(p, d.from));
    }
    case 'deputy':
      return J.deputy(T.journal.namesOf[d.head] ?? d.head, r.person ? T.card.person(role(r.person.role), r.person.tab) : undefined);
    case 'memo':
      // служебная записка (Б5д): кому и о чём — команды по порядку
      return J.memo(T.journal.namesTo[d.to] ?? d.to, d.cmds.map((c, i) => cmdText(c, r.cmds?.[i] ?? {}, start)).join('; '));
    case 'fork':
      // «Просят решить» (Б5д): какая развилка и о чём
      return `${J.fork[d.fork] ?? d.fork}: ${forkWhat(d, r)}`;
  }
}

/** Команда записки словами (Б5д): то, о чём просят отдел, — с номерами вещей из ссылок. */
export function cmdText(c: Command, r: JournalRef, start: Ymd): string {
  const C = T.journal.memo.cmd;
  const who = r.person ? T.card.person(role(r.person.role), r.person.tab) : '';
  switch (c.kind) {
    case 'order':
      return C.order(sku(c.sku) || named(db?.recipes[c.recipe]?.name, c.recipe), c.notBefore !== undefined ? whenText(start, c.notBefore) : '—');
    case 'shift':
      return C.shift(T.now.batch(batchCode(r) || c.batch), whenText(start, c.notBefore));
    case 'cancel':
      return C.cancel(T.now.batch(batchCode(r) || c.batch));
    case 'pack':
      return C.pack(T.now.batch(batchCode(r) || c.batch), sku(c.sku));
    case 'maintain':
      return C.maintain(partName(r.machine, r.part), machineName(r.machine));
    case 'visit':
      return C.visit(r.asset ? `${assetClass(r.asset)}, ${T.assets.inv(r.asset.inv)}` : c.asset, dayText(c.day));
    case 'rush':
      return C.rush(r.lot ? T.lotCode(...r.lot) : c.lot);
    case 'setpoint':
      return C.setpoint(modeWhat(r), modeText(r, c.value));
    case 'po':
      return C.po(party(c.supplier), c.lines.map(l => `${material(l.material)}, ${qty(l.material, l.qty)}`).join('; '));
    case 'waste':
      return C.waste;
    case 'roster':
      return C.roster(who, named(db?.shifts[c.shift]?.name, c.shift));
    case 'vacancy':
      return C.vacancy(role(c.role));
    case 'agency':
      return C.agency(r.role ? role(r.role) : c.vacancy);
    case 'close':
      return C.close(r.role ? role(r.role) : c.vacancy);
    case 'hire':
      return C.hire(r.role ? role(r.role) : c.candidate, c.trial);
    case 'dismiss':
      return C.dismiss(who);
    case 'leave':
      return C.leave(who);
    case 'also':
      return C.also(who, role(c.role), c.on);
    default:
      return C.other;
  }
}

/** О чём развилка (Б5д): визит — работа, актив и ждущие серии; замена — узел, машина и следующая серия; OOS — серия. */
function forkWhat(d: Extract<Decided, { kind: 'fork' }>, r: JournalRef): string {
  const F = T.journal.fork;
  if (d.fork === 'visit') return F.visit(r.asset ? workName(r.asset, d.work).toLowerCase() : d.work, r.asset ? `${assetClass(r.asset)}, ${T.assets.inv(r.asset.inv)}` : d.asset, (r.batches ?? []).map(b => T.now.batch(b)).join(', '));
  if (d.fork === 'replace') return F.replace(partName(r.machine, r.part), machineName(r.machine), T.now.batch(batchCode(r) || d.batch));
  return F.oos(T.now.batch(batchCode(r)));
}

/** Риск отказа за работу по таблице узла (Б5д): ожидаемое число отказов — в вероятность, проценты 1/10 000. */
export const riskOf = (hz: number) => Math.round((1 - Math.exp(-hz / ONE_FAILURE)) * 10_000);

/**
 * Цены вариантов развилки (Б5д) — числа завода: визит — до какого мгновения ждут серии и сколько суток до конца записи
 * от сегодня; замена — износ, риск отказа и ремонт, время замены; OOS — порог вывода.
 */
export function forkPrices(d: Extract<Decided, { kind: 'fork' }>, t: number, start: Ymd): Record<string, string> {
  const P = T.journal.fork.price;
  if (d.fork === 'visit') {
    const left = d.last - momentOf(start, t).day;
    return { wait: P.wait(whenText(start, d.end), durText(Math.max(0, d.end - t))), move: P.move(Math.max(0, left)) };
  }
  if (d.fork === 'replace') return { wear: P.wear(pctText(d.wear), pctText(d.after), pctText(d.at)), after: P.after(pctText(riskOf(d.hz)), durText(d.repair[0]), durText(d.repair[1])), now: P.now(durText(d.replace)) };
  return { lead: P.lead(pctText(d.threshold)), self: P.self };
}

/** Причина — строки с числами завода; у решения игрока её нет (кроме предоплаты заказа). */
export function whyLines(d: Decided, r: JournalRef, t: number, start: Ymd): string[] {
  const J = T.journal;
  const day = momentOf(start, t).day;
  switch (d.kind) {
    case 'order': {
      const w = d.why;
      if (!w) return [];
      if (w.rule === 'turn') return [J.order.turn(w.seen ?? 0)];
      const pos = (x: { cases: number; ordered: number; work: number }) => (x.ordered > 0 ? (x.cases * x.work) / x.ordered : Number.POSITIVE_INFINITY);
      const me = w.items.find(x => x.sku === d.sku);
      const head = me ? (me.ordered > 0 ? J.order.stock(me.cases, Math.round(pos(me) * 10) / 10, me.ordered, me.work) : J.order.noDemand(me.cases)) : '';
      const ahead = w.ahead / 1000;
      const rule =
        w.rule === 'campaign'
          ? J.order.campaign(product(w.prev), (w.soon ?? 0) / 1000)
          : w.rule === 'urgent'
            ? J.order.urgent(product(w.prev), (w.soon ?? 0) / 1000)
            : w.prev
              ? J.order.change(product(w.prev))
              : J.order.need;
      const below = w.items.filter(x => x.sku !== d.sku && x.ordered > 0 && x.cases * x.work * 1000 < x.ordered * w.ahead);
      const others = below.length > 0 ? J.order.others(below.map(x => J.order.other(sku(x.sku), Math.round(pos(x) * 10) / 10)).join('; ')) : J.order.alone;
      // навык руководителя сократил горизонт (Б5в): запас — его, политика — какой была бы
      const limited = w.policy !== undefined && w.cover !== undefined ? J.order.limited(w.cover, w.policy) : '';
      // срок (Б6а): когда кончится запас позиции; отменённое на запас — до его «не раньше» позицию не ставят
      const due = d.due !== undefined && d.for?.kind !== 'order' ? J.order.due(whenText(start, d.due)) : '';
      const held = w.items.filter(x => x.held).map(x => J.order.held(sku(x.sku), whenText(start, x.held!.t), whenText(start, x.held!.until)));
      // спрос по прогнозу планирования (Б6в)
      const fc = w.fc ? [J.order.fc] : [];
      return [[head, J.order.threshold(Number.isInteger(ahead) ? ahead : Math.round(ahead * 10) / 10, w.cover), rule].filter(Boolean).join('; '), ...fc, ...(due ? [due] : []), others, ...held, ...(limited ? [limited] : [])];
    }
    case 'po': {
      const out = (d.why ?? []).map(w => {
        const line = r.po?.lines.find(l => l.material === w.material);
        const c = db?.containers[db?.materials[w.material]?.container ?? ''];
        const n = line && c ? Math.round(line.qty / c.capacity) : 0;
        const parts = [
          J.po.line(material(w.material), qty(w.material, w.have), qty(w.material, w.point), qtyText(w.per / 1000, unitOf(w.material)), w.lead, w.qc, w.safety),
          w.want === w.moq ? J.po.moq(qty(w.material, w.moq)) : J.po.qty(w.every, qty(w.material, w.want)),
          ...(w.cut ? [J.po.cut] : []),
          ...(c && n > 0 ? [J.po.tare(n, c.kind, qtyText(c.capacity, unitOf(w.material), 0))] : []),
        ];
        return parts.join('; ');
      });
      return d.prepaid > 0 ? [...out, J.po.prepaid(money(d.prepaid))] : out;
    }
    case 'step': {
      const w = d.why;
      if (!w) return [];
      const top = cause(r, w.top);
      if (w.rule === 'lab') return [J.step.lab];
      if (w.rule === 'retest') return [J.step.retest(top, p10k(w.p))];
      return [J.step.gain(num((w.gain ?? 0) / 1000, 2), `${num(w.min ?? 0)} ${T.units.min}`, top, p10k(w.p))];
    }
    case 'conclude': {
      const w = d.why;
      if (!w) return [];
      const c = cause(r, d.cause);
      return [(w.p >= w.threshold ? J.conclude.top : J.conclude.none)(c, p10k(w.p), p10k(w.threshold)), d.fate === 'release' ? J.conclude.release : J.conclude.reject, ...(w.model !== undefined ? [J.conclude.limited(p10k(w.threshold), p10k(w.model))] : [])];
    }
    case 'assess': {
      const w = d.why;
      if (!w) return [];
      // вероятная причина (Б5е): названная и признаки в записях завода
      const cause = [...(d.cause !== undefined ? [J.assess.cause(causeText(d.cause))] : []), ...(w.signs?.length ? [J.assess.signs(w.signs.map(causeText).join(', '))] : [])];
      if (w.tests.length === 0) return [J.assess.empty, ...cause];
      const list = w.tests.map(x => (x.kind === 'ipc' ? J.assess.ipc(testName(x.test), x.n ?? 0, x.out ?? 0) : J.assess.lab(testName(x.test), x.result !== undefined && db?.tests[x.test] ? attrText(db.tests[x.test].attr, x.result) : '—', (x.out ?? 0) > 0)));
      return [J.assess.tests(list.join('; ')), d.verdict === 'none' ? J.assess.none : J.assess.reject, ...cause];
    }
    case 'capa': {
      // правило начальника ООК (Б5е): вывод расследования, повторы с порогом политики, неэффективная CAPA цепочки
      const w = d.why;
      if (!w) return [];
      if (w.rule === 'inv') return [J.capa.inv];
      if (w.rule === 'next') return [J.capa.next(w.prev ? w.prev.slice(1) : '')];
      return [J.capa.repeat(w.n ?? 0, w.of ?? 0)];
    }
    case 'capaRun': {
      // «Заменять раньше» (Б5е): порог политики узла был и стал
      if (d.from === undefined || d.to === undefined) return [];
      const p = db?.policies['pol.maint.replace'];
      const at = r.machine && r.part ? `${partName(r.machine, r.part)} · ${machineName(r.machine)}: ` : '';
      return [`${at}${J.capa.from(policyText(p, d.from), policyText(p, d.to))}`];
    }
    case 'capaCheck':
      return [d.ok ? J.capa.ok(d.days) : J.capa.no(d.dev ? T.dev.no(Number(d.dev.slice(1))) : '')];
    case 'pairEval':
      return [`${J.pair(J.until(dayText(d.why.until), d.why.until - day, d.why.ahead))}; ${d.how === 'audit' ? J.audit : J.docs}`];
    case 'visit': {
      // у переноса игроком причины нет; срок предупреждения — политика главного механика (Б5г)
      const w = d.why;
      if (!w) return [];
      return [w.until === undefined ? J.noRec : J.rec(J.until(dayText(w.until), w.until - day, w.ahead, true))];
    }
    case 'repair':
      return [J.repair(whenText(start, d.why.failed), named(db?.spares[d.why.spare]?.name, d.why.spare), d.why.free)];
    case 'replace':
      return d.why ? [J.replace(pctText(d.why.wear), pctText(d.why.at))] : [];
    case 'spare':
      return [J.spare(d.why.level, d.why.min, d.why.max)];
    case 'vacancy': {
      const w = d.why;
      if (!w) return [];
      const who = r.person ? T.card.person(role(r.person.role), r.person.tab) : T.journal.tab(w.tab);
      return [`${J.vacancy.instead(who, dayText(w.day))}; ${w.rule === 'city' ? J.vacancy.city : w.rule === 'late' ? J.vacancy.late(w.days ?? 0) : J.vacancy.ad}`];
    }
    case 'hire': {
      const w = d.why;
      return w ? [J.hire(w.skill, w.min, money(w.salary), money(w.price), pctText(w.over))] : [];
    }
    case 'leaveDraft':
      return [J.leaveDraft(d.why.people, d.why.miss)];
    case 'targets':
      return [J.targets(d.why.n)];
    case 'lot': {
      const list = d.why.tests.map(x => {
        const m = db?.tests[x.test];
        const result = x.result !== undefined && m ? attrText(m.attr, x.result) : '—';
        const lim = m && (x.min !== undefined || x.max !== undefined) ? T.dev.limits(x.min !== undefined ? attrNum(m.attr, x.min) : '', x.max !== undefined ? attrNum(m.attr, x.max) : '') : '';
        return J.lot.test(testName(x.test), result, lim, !!x.pass);
      });
      return [...list, d.verdict === 'release' ? J.lot.release : d.verdict === 'investigate' ? J.lot.investigate : J.lot.reject];
    }
    case 'batch': {
      const w = d.why;
      if (!w) return [];
      const devs = (w.devs ?? []).map(id => T.dev.no(Number(id.slice(1)))).join(', ');
      return [w.rule === 'player' ? J.batch.player : w.rule === 'assess' ? J.batch.assess(devs) : w.rule === 'open' ? J.batch.open(devs) : J.batch.clear];
    }
    case 'contract':
      return [d.why.prev ? J.contract(d.why.prev, dayText(d.why.end ?? 0)) : J.contractNew];
    case 'extend':
      return [J.extend(dayText(d.why.end))];
    case 'forecast':
      return [J.forecast(T.fc.methods[d.method] ?? d.method, `+${pctText(d.optimism)}`)];
    case 'fcEdit':
      return [J.fcEdit(T.fc.cases(d.was))];
    case 'waste': {
      // коллега склада (Б1з): по заполнению зоны или по сроку; у игрока причины нет
      const w = d.why;
      if (!w) return [];
      const share = w.full ? policyText(db?.policies['pol.wms.full'], w.full) : undefined;
      return w.since !== undefined ? [J.waste.old(dayText(momentOf(start, w.since).day), w.months)] : [J.waste.full(w.used, w.places, share)];
    }
    case 'fork': {
      // «Просят решить» (Б5д): цена каждого ответа — «как сейчас» первым
      const p = forkPrices(d, t, start);
      return [...(p.wear ? [p.wear] : []), ...FORK_OPTS[d.fork].map(o => `${T.journal.fork.opt[o]}: ${p[o]}`)];
    }
    default:
      return [];
  }
}

/** Переход к вещи решения: карточка на полу, досье серии, доска расследования. */
function goOf(r: JournalRef, actions: Actions): (() => void) | undefined {
  if (r.thing) return () => actions.show(r.thing!);
  if (r.unit !== undefined) return () => actions.showUnit(r.unit!);
  if (r.inv) return () => actions.openInv(r.inv!);
  if (r.bn !== undefined) return () => actions.openDossier(r.bn!);
  return undefined;
}

/**
 * Ответ на предложение (Б5б): ждёт — «Принять» и «Отклонить», если ответить может игрок; ответили — кто и когда, устарело
 * или не нужно.
 */
export function AskLine({ n, ask, start, actions }: { n: number; ask: AskInfo; start: Ymd; actions: Actions }) {
  const A = T.journal.ask;
  if (ask.end) {
    return (
      <span className={`ask ${ask.end.how}`} data-test="ask-end" data-how={ask.end.how}>
        {A[ask.end.how](whenText(start, ask.end.t))}
      </span>
    );
  }
  return (
    <span className="ask open" data-test="ask-open">
      <span className="warn">{A.open}</span>
      {ask.can ? (
        <>
          {' '}
          <button type="button" className="small" onClick={() => actions.answer(n, true)} title={A.acceptHint} data-test="ask-accept">
            {A.accept}
          </button>{' '}
          <button type="button" className="small" onClick={() => actions.answer(n, false)} title={A.declineHint} data-test="ask-decline">
            {A.decline}
          </button>
        </>
      ) : null}
    </span>
  );
}

/**
 * Служебная записка (Б5д): без ответа — когда ответят и «Отозвать»; с ответом — когда и кто, по каждой команде —
 * выполнено (с записью руководителя) или отказ с причиной движка; отозвана — когда.
 */
export function MemoLine({ row, start, actions }: { row: JournalRow; start: Ymd; actions: Actions }) {
  const m = row.memo!;
  const M = T.journal.memo;
  if (!m.end)
    return (
      <span className="ask open" data-test="memo-open">
        <span className="warn">{m.at !== undefined ? M.at(whenText(start, m.at)) : M.never}</span>{' '}
        {m.can ? (
          <button type="button" className="small" onClick={() => actions.withdraw(row.n)} title={M.withdrawHint} data-test="memo-withdraw">
            {M.withdraw}
          </button>
        ) : null}
      </span>
    );
  if (m.end.off)
    return (
      <span className="ask stale" data-test="memo-end" data-how="off">
        {M.off(whenText(start, m.end.t))}
      </span>
    );
  const cmds = row.d.kind === 'memo' ? row.d.cmds : [];
  const who = whoText(row.d.kind === 'memo' ? row.d.to : 'plan', undefined, m.end.as);
  return (
    <span className="ask ok" data-test="memo-end" data-how="answered">
      {M.answered(whenText(start, m.end.t), who)}
      {(m.end.res ?? []).map((x, i) => (
        <span key={i} className={'why' in x ? 'warn' : ''} data-test="memo-res" data-ok={'why' in x ? 'no' : 'ok'}>
          {' · '}
          {cmds[i] ? `${cmdText(cmds[i], row.ref.cmds?.[i] ?? {}, start)} — ` : ''}
          {'why' in x ? M.no(T.notices.why[x.why] ?? x.why) : x.n !== undefined ? M.okRec(x.n) : M.ok}
        </span>
      ))}
    </span>
  );
}

/**
 * Вопрос «Просят решить» (Б5д): открыт — варианты кнопками с ценой у каждого и «решит сам в …», у переноса визита — день;
 * ответ — кто и что выбрал, «решил сам» или «решилось без ответа».
 */
export function QLine({ row, start, actions }: { row: JournalRow; start: Ymd; actions: Actions }) {
  const q = row.q!;
  const F = T.journal.fork;
  const d = row.d.kind === 'fork' ? row.d : undefined;
  const days = q.move ?? [];
  const [day, setDay] = useState(days[0]);
  if (!d) return null;
  const opts = FORK_OPTS[d.fork];
  if (q.end) {
    const opt = q.end.opt ? (F.opt[q.end.opt] ?? q.end.opt) : '';
    const text = q.end.how === 'player' ? F.end.player(opt, whenText(start, q.end.t)) : q.end.how === 'moot' ? F.end.moot(whenText(start, q.end.t)) : q.to ? F.end.self(opt, whenText(start, q.end.t)) : F.end.alone(opt);
    return (
      <span className={`ask ${q.end.how === 'player' ? 'ok' : 'stale'}`} data-test="q-end" data-how={q.end.how} {...(q.end.opt ? { 'data-opt': q.end.opt } : {})}>
        {text}
      </span>
    );
  }
  const prices = forkPrices(d, row.t, start);
  return (
    <span className="ask open" data-test="q-open" data-fork={d.fork}>
      {q.due !== undefined ? <span className="warn">{F.due(whenText(start, q.due))}</span> : null}
      {opts.map(o => (
        <span key={o} className="qopt" data-opt={o}>
          {' '}
          {o === 'move' ? (
            <select value={day} disabled={!q.can || days.length === 0} onChange={e => setDay(Number(e.target.value))} aria-label={F.day} data-test="q-day">
              {days.map(z => (
                <option key={z} value={z}>
                  {dayText(z)}
                </option>
              ))}
            </select>
          ) : null}{' '}
          <button type="button" className="small" disabled={!q.can || (o === 'move' && day === undefined)} onClick={() => actions.answerFork(row.n, o, o === 'move' ? day : undefined)} title={F.optHint[o]} data-test="q-answer">
            {F.opt[o]}
          </button>{' '}
          <span className="muted">{prices[o]}</span>
        </span>
      ))}
    </span>
  );
}

function Row({ row, start, open, toggle, actions }: { row: JournalRow; start: Ymd; open: boolean; toggle: () => void; actions: Actions }) {
  const why = whyLines(row.d, row.ref, row.t, start);
  const go = goOf(row.ref, actions);
  return (
    <li
      className={`jrow${open ? ' on' : ''}${(row.ask && !row.ask.end) || (row.q && !row.q.end) ? ' asking' : ''}`}
      data-test="journal-row"
      data-n={row.n}
      data-kind={row.d.kind}
      data-by={row.by}
      {...(row.ask ? { 'data-ask': row.ask.end?.how ?? 'open' } : {})}
      {...(row.q ? { 'data-q': row.q.end?.how ?? 'open' } : {})}
      {...(row.memo ? { 'data-memo': row.memo.end ? (row.memo.end.off ? 'off' : 'answered') : 'open' } : {})}
    >
      <div className="jline">
        <span className="muted">{whenText(start, row.t)}</span> <b>{whoText(row.by, row.seat, row.as)}</b>
        {row.ask ? <span className="muted"> · {T.journal.ask.proposes}</span> : null}
        {row.q?.to ? <span className="muted"> · {T.journal.fork.asks}</span> : null}
      </div>
      <div className="jline">
        {why.length > 0 ? (
          <button type="button" className="link" aria-expanded={open} onClick={toggle} data-test="journal-more">
            {open ? '▾' : '▸'} {whatText(row.d, row.ref, start)}
          </button>
        ) : (
          <span>{whatText(row.d, row.ref, start)}</span>
        )}
        {go ? (
          <button type="button" className="small" onClick={go} title={T.journal.goHint} data-test="journal-go">
            {T.journal.go}
          </button>
        ) : null}
      </div>
      {open && why.length > 0 ? (
        <ul className="jwhy" data-test="journal-why">
          {why.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      ) : null}
      {row.ask ? (
        <div className="jline">
          <AskLine n={row.n} ask={row.ask} start={start} actions={actions} />
        </div>
      ) : null}
      {row.via ? (
        <div className="jline muted" data-test="journal-via">
          {row.via.seat ? T.journal.memo.via(T.seats.names[row.via.seat] ?? row.via.seat, row.via.n) : T.journal.memo.viaYou(row.via.n)}
        </div>
      ) : null}
      {row.memo ? (
        <div className="jline">
          <MemoLine row={row} start={start} actions={actions} />
        </div>
      ) : null}
      {row.q ? (
        <div className="jline">
          <QLine row={row} start={start} actions={actions} />
        </div>
      ) : null}
    </li>
  );
}

/** Предложения руководителей (Б5б): строки журнала с причиной и ответом — в журнале сверху и на планёрке. */
export function AskRows({ rows, start, actions }: { rows: readonly JournalRow[]; start: Ymd; actions: Actions }) {
  const [shown, setShown] = useState<number | undefined>(undefined);
  return (
    <ul className="jlist asks" data-test="asks">
      {rows.map(r => (
        <Row key={r.n} row={r} start={start} open={shown === r.n} toggle={() => setShown(shown === r.n ? undefined : r.n)} actions={actions} />
      ))}
    </ul>
  );
}

const MODES: readonly DeptMode[] = ['auto', 'advise', 'manual'];

/** Режимы отделов взятых постов (Б5б): у каждого руководителя — три кнопки; нажатая — режим сейчас. */
export function ModeBar({ list, actions }: { list: readonly ModeInfo[]; actions: Actions }) {
  if (list.length === 0) return null;
  return (
    <div className="modes" data-test="journal-modes" title={T.journal.modesHint}>
      <div className="msec">{T.journal.modesTitle}</div>
      {list.map(m => (
        <div className="filters" key={m.head} data-head={m.head} data-mode={m.mode}>
          <span className="muted">{T.journal.names[m.head] ?? m.head}:</span>
          {MODES.map(x => (
            <button type="button" key={x} className={m.mode === x ? 'on' : ''} aria-pressed={m.mode === x} disabled={m.mode === x} onClick={() => actions.setMode(m.head, x)} title={T.journal.modeHint[x]} data-mode={x}>
              {T.journal.modes[x]}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Journal({ hud, actions }: { hud: Hud; actions: Actions }) {
  const j = hud.journal;
  const v = j.view;
  const [shown, setShown] = useState<number | undefined>(undefined);
  // запись, на которой открыли журнал («Почему?»), — раскрыта, пока игрок не раскроет другую
  const openN = shown ?? v?.focus;
  return (
    <div className="stock panel journal" id="journal" role="dialog" aria-labelledby="journal-title" data-test="journal">
      <div className="phead">
        <b id="journal-title">{T.journal.title}</b>
        <span className="muted">{T.journal.question}</span>
        <button type="button" className="close" onClick={() => actions.toggleJournal()} title={T.card.closeHint}>
          ✕
        </button>
      </div>
      {v ? <ModeBar list={v.modes} actions={actions} /> : null}
      {v && (v.asks.length > 0 || v.modes.length > 0) ? (
        <div className="jasks" data-test="journal-asks">
          <div className="msec">{T.journal.ask.title}</div>
          {v.asks.length > 0 ? <AskRows rows={v.asks} start={hud.start} actions={actions} /> : <div className="muted">{T.journal.ask.none}</div>}
        </div>
      ) : null}
      {v && v.memos.length > 0 ? (
        <div className="jasks" data-test="journal-memos">
          <div className="msec">{T.journal.memo.title}</div>
          <AskRows rows={v.memos} start={hud.start} actions={actions} />
        </div>
      ) : null}
      <div className="filters" data-test="journal-seats">
        <span className="muted">{T.journal.seatFilter}:</span>
        <button type="button" className={!j.seat ? 'on' : ''} aria-pressed={!j.seat} onClick={() => actions.setJournal({ seat: null })}>
          {T.journal.all}
        </button>
        {SEATS.map(id => (
          <button type="button" key={id} className={j.seat === id ? 'on' : ''} aria-pressed={j.seat === id} onClick={() => actions.setJournal({ seat: id })} data-seat={id}>
            {T.seats.names[id]}
          </button>
        ))}
      </div>
      <div className="filters" data-test="journal-who">
        <span className="muted">{T.journal.whoFilter}:</span>
        <button type="button" className={!j.who ? 'on' : ''} aria-pressed={!j.who} onClick={() => actions.setJournal({ who: null })}>
          {T.journal.all}
        </button>
        <button type="button" className={j.who === 'heads' ? 'on' : ''} aria-pressed={j.who === 'heads'} onClick={() => actions.setJournal({ who: 'heads' })} data-who="heads">
          {T.journal.heads}
        </button>
        <button type="button" className={j.who === 'player' ? 'on' : ''} aria-pressed={j.who === 'player'} onClick={() => actions.setJournal({ who: 'player' })} data-who="player">
          {T.journal.you}
        </button>
        <button type="button" className={j.who === 'memos' ? 'on' : ''} aria-pressed={j.who === 'memos'} onClick={() => actions.setJournal({ who: 'memos' })} data-who="memos">
          {T.journal.memos}
        </button>
      </div>
      {!v ? <div className="muted">{T.app.loading}</div> : null}
      {v && v.rows.length === 0 ? <div className="muted empty">{T.journal.empty}</div> : null}
      {v && v.rows.length > 0 ? (
        <ul className="jlist">
          {v.rows.map(r => (
            <Row key={r.n} row={r} start={hud.start} open={openN === r.n} toggle={() => setShown(openN === r.n ? -1 : r.n)} actions={actions} />
          ))}
        </ul>
      ) : null}
      {v && v.pages > 1 ? (
        <div className="pager">
          <button type="button" disabled={v.page === 0} onClick={() => actions.setJournal({ page: v.page - 1 })}>
            {T.journal.prev}
          </button>
          <span className="muted">{T.journal.page(v.page + 1, v.pages)}</span>
          <button type="button" disabled={v.page >= v.pages - 1} onClick={() => actions.setJournal({ page: v.page + 1 })}>
            {T.journal.next}
          </button>
        </div>
      ) : null}
      {v?.since !== undefined ? <div className="muted small">{T.journal.since(dayText(momentOf(hud.start, v.since).day), KEEP)}</div> : null}
    </div>
  );
}

/** «Кто решил» в карточке вещи: строка на решение — что, кто, когда — и «Почему?», которое открывает журнал на нём. */
export function WhoList({ rows, start, actions, title, test }: { rows: readonly WhoRow[] | undefined; start: Ymd; actions: Actions; title?: string; test?: string }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="who" data-test={test ?? 'who'}>
      <div className="msec">{title ?? T.journal.who}</div>
      <ul className="whol">
        {rows.map(r => (
          <li key={r.n} data-test="who-row" data-kind={r.kind} data-n={r.n} {...(r.ask ? { 'data-ask': r.ask.end?.how ?? 'open' } : {})}>
            <span>
              {T.journal.kinds[r.kind] ?? r.kind}: <b>{whoText(r.by, r.seat, r.as)}</b>
              {r.ask ? <span className="muted"> · {T.journal.ask.proposes}</span> : null}
              {r.v ? ` — ${verdictWord(r)}` : ''} <span className="muted">· {whenText(start, r.t)}</span>
            </span>{' '}
            <button type="button" className="small" onClick={() => actions.openJournal(r.n)} title={T.journal.whyHint} data-test="who-why">
              {T.journal.why}
            </button>
            {r.ask ? (
              <div>
                <AskLine n={r.n} ask={r.ask} start={start} actions={actions} />
              </div>
            ) : null}
            {r.via ? (
              <div className="muted" data-test="who-via">
                {r.via.seat ? T.journal.memo.via(T.seats.names[r.via.seat] ?? r.via.seat, r.via.n) : T.journal.memo.viaYou(r.via.n)}
              </div>
            ) : null}
            {r.q ? (
              <div className="muted" data-test="who-q" data-how={r.q.end?.how ?? 'open'}>
                {r.q.end ? (r.q.end.opt ? `${T.journal.fork.opt[r.q.end.opt] ?? r.q.end.opt}` : '') : T.journal.ask.open}
              </div>
            ) : null}
            {r.memo ? <WhoMemo n={r.n} memo={r.memo} start={start} actions={actions} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Записка в «Кто решил» вещи (Б5д): ждёт — когда ответят и «Отозвать»; отозвана; ответ — когда, кто ответил и причины
 * отказа, если команда не прошла.
 */
function WhoMemo({ n, memo, start, actions }: { n: number; memo: NonNullable<WhoRow['memo']>; start: Ymd; actions: Actions }) {
  const M = T.journal.memo;
  if (!memo.end)
    return (
      <div className="muted" data-test="who-memo" data-how="open">
        <span className="warn">{memo.at !== undefined ? M.at(whenText(start, memo.at)) : M.never}</span>{' '}
        {memo.can ? (
          <button type="button" className="small" onClick={() => actions.withdraw(n)} title={M.withdrawHint} data-test="memo-withdraw">
            {M.withdraw}
          </button>
        ) : null}
      </div>
    );
  if (memo.end.off)
    return (
      <div className="muted" data-test="who-memo" data-how="off">
        {M.off(whenText(start, memo.end.t))}
      </div>
    );
  return (
    <div className="muted" data-test="who-memo" data-how="answered">
      {M.answered(whenText(start, memo.end.t), whoText(memo.to, undefined, memo.end.as))}
      {(memo.end.res ?? []).flatMap((x, i) =>
        'why' in x ? [
          <span key={i} className="warn">
            {' · '}
            {M.no(T.notices.why[x.why] ?? x.why)}
          </span>,
        ] : [],
      )}
    </div>
  );
}

/**
 * Вердикт строки «Кто решил»: решение по партии и серии, оценка, вывод, работа подрядчика, канал вакансии; с Б5е — класс
 * отклонения, действие CAPA и итог её проверки.
 */
function verdictWord(r: WhoRow): string {
  switch (r.kind) {
    case 'lot':
      return T.journal.verdict[r.v ?? ''] ?? '';
    case 'batch':
    case 'conclude':
      return T.journal.decision[r.v ?? ''] ?? '';
    case 'assess':
      return r.v === 'none' ? T.journal.none : T.journal.decision.reject;
    case 'visit':
      return r.v === 'qual' ? T.assets.work.qual : T.assets.work.cal;
    case 'vacancy':
      return T.journal.via[r.v ?? ''] ?? '';
    case 'classify':
      return T.dev.clsLow[r.v ?? ''] ?? '';
    case 'capa':
    case 'capaRun':
      return r.v ? capaName(r.v) : '';
    case 'capaCheck':
      return T.journal.check[r.v ?? ''] ?? '';
    default:
      return '';
  }
}
