// Слой «Потери» в окне (Б1л; docs/specs/2026-10-vertical-slice.md, «Б1л»): в меню слоёв — окно, вид потерь и цвета
// частей словами; подсказка у столбика — часы частей места за окно; блок «Потери» в карточке помещения и машины линии —
// места карточки с часами, у раскрытого — часы по видам и причинам ожидания и вещи каждой части, щелчок по вещи — её
// карточка или досье. Вид — «Пол» из потока расчёта (src/sim/floor.ts), слова — из src/i18n/.
import { ALL_KINDS, FAMILY_OF, lossColor, type LossPart, LOSS_PICKS, lossSpotsOf, partsOfLoss, secOfLoss, spotName, spotsOfThing, WAIT_FAMILIES } from '../app/losses';
import type { LossKind, WaitCause } from '../engine/types';
import { planOf } from '../engine/plant';
import { durText, named, T } from '../i18n';
import { layoutOf } from '../render/layout';
import type { FloorLoss, FloorThing, FloorView } from '../sim/floor';
import type { JournalRef } from '../sim/journal';
import type { Thing } from '../sim/views';
import { db } from './db';
import { WinPick } from './Layers';
import type { Actions, Hud } from './store';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Раскладка завода: имена мест и места карточки — по ней. */
const layoutAt = (plant: string) => (db ? layoutOf(planOf(db, plant)) : undefined);

/** Слово части столбика: вид или семья причин ожидания. */
const partWord = (p: LossPart): string => (p in T.losses.family ? T.losses.family[p as keyof typeof T.losses.family] : T.losses.kind[p as LossKind]);

/** Меню слоя «Потери»: окно, вид потерь и цвета частей вида словами. */
export function LossMenu({ hud, actions }: { hud: Hud; actions: Actions }) {
  const pick = hud.floor.pick;
  const parts: LossPart[] = pick === 'all' ? [...ALL_KINDS] : pick === 'wait' ? [...WAIT_FAMILIES] : [pick];
  return (
    <>
      <WinPick win={hud.floor.win} actions={actions} />
      <div className="lhead">{T.losses.pickTitle}</div>
      <span className="lwin" data-test="loss-picks">
        {LOSS_PICKS.map(p => (
          <button key={p} type="button" className={pick === p ? 'on' : ''} onClick={() => actions.setLossPick(p)} data-test={`loss-pick-${p}`}>
            {T.losses.pick[p]}
          </button>
        ))}
      </span>
      <ul className="legend" data-test="loss-legend">
        {parts.map(p => (
          <li key={p} title={pick === 'wait' ? T.losses.familyOf[p as keyof typeof T.losses.familyOf] : undefined}>
            <span className="sw" style={{ background: hex(lossColor(p)) }} />
            {partWord(p)}
          </li>
        ))}
        <li className="muted">{T.losses.legend}</li>
        {pick === 'all' || pick === 'shift' ? <li className="muted">{T.losses.shiftApart}</li> : null}
      </ul>
    </>
  );
}

/** Строки ожидания по причинам — по убыванию секунд, при равных — по слову. */
function causeRows(x: FloorLoss): { cause: Exclude<WaitCause, 'shift'>; sec: number }[] {
  return (Object.entries(x.wait) as [Exclude<WaitCause, 'shift'>, number][])
    .filter(([c, sec]) => c !== ('shift' as string) && sec > 0)
    .map(([cause, sec]) => ({ cause, sec }))
    .sort((a, b) => b.sec - a.sec || (a.cause < b.cause ? -1 : 1));
}

/**
 * Подсказка у столбика «Потерь»: место, часы частей вида слоя, у ожидания — по причинам, «нет смены» отдельно, окно.
 */
export function LossTip({ hud, plant }: { hud: Hud; plant: string }) {
  const h = hud.floor.hover;
  const v = hud.floor.view;
  const l = layoutAt(plant);
  if (!h?.spot || !v || !l) return null;
  const x = v.losses.find(r => r.spot === h.spot);
  if (!x) return null;
  const pick = hud.floor.pick;
  return (
    <div className="floortip panel" style={{ left: h.x + 14, top: h.y + 14 }} data-test="loss-tip">
      <b>{spotName(l, x.spot)}</b>
      <ul>
        {pick === 'wait'
          ? causeRows(x).map(r => (
              <li key={r.cause} data-test="loss-tip-row">
                <span className="sw" style={{ background: hex(lossColor(FAMILY_OF[r.cause])) }} />
                {T.losses.row(T.wait[r.cause], durText(r.sec))}
              </li>
            ))
          : partsOfLoss(x, pick).map(p => (
              <li key={p.part} data-test="loss-tip-row">
                <span className="sw" style={{ background: hex(lossColor(p.part)) }} />
                {T.losses.row(partWord(p.part), durText(p.sec))}
              </li>
            ))}
      </ul>
      {pick === 'all' ? <div>{T.losses.total(durText(secOfLoss(x, pick)))}</div> : null}
      {pick === 'all' && (x.sec.shift ?? 0) > 0 ? <div className="muted">{T.losses.shiftRow(durText(x.sec.shift ?? 0))}</div> : null}
      <div className="muted">{T.floor.span(T.floor.winOf[v.win], '')}</div>
    </div>
  );
}

/** Вещь потерь словами: партия, серия, паллета, заказ, поставка, вывоз, покупатель, человек, помещение, машина. */
export function refText(r: JournalRef, plant: string): string {
  const L = T.losses.thing;
  if (r.lot) return `${L.lot(T.lotCode(...r.lot))}${r.material ? `, ${named(db?.materials[r.material]?.name, r.material)}` : ''}`;
  if (r.code || r.bn !== undefined) return L.batch(r.code ?? `B${r.bn}`);
  if (r.unit !== undefined) return L.unit(r.unit);
  if (r.order !== undefined) return L.order(r.order);
  if (r.po) return L.po(r.po.lines.map(x => named(db?.materials[x.material]?.name, x.material)).join(', '));
  if (r.waste !== undefined) return L.waste(r.waste);
  if (r.customer) return named(db?.customers[r.customer]?.name, r.customer);
  if (r.person) return T.card.person(named(db?.roles[r.person.role]?.name, r.person.role), r.person.tab);
  if (r.room) {
    const type = db?.plants[plant]?.rooms.find(x => x.id === r.room)?.type;
    return type ? (T.roomTypes[type] ?? type) : r.room;
  }
  if (r.machine) return named(db?.equipment[r.machine]?.name ?? db?.machines[r.machine]?.name, r.machine);
  return T.floor.none;
}

/** Переход к вещи потерь: её карточка на полу, паллета, досье серии; вещи уже нет — перехода нет. */
function goOf(r: JournalRef, actions: Actions): (() => void) | undefined {
  if (r.thing) return () => actions.show(r.thing!);
  if (r.unit !== undefined) return () => actions.showUnit(r.unit!);
  if (r.bn !== undefined) return () => actions.openDossier(r.bn!);
  return undefined;
}

/** Вещи части: по убыванию часов, щелчок — к вещи. */
function Things({ list, plant, actions }: { list: readonly FloorThing[] | undefined; plant: string; actions: Actions }) {
  if (!list || list.length === 0) return null;
  return (
    <ul className="loadrows things" data-test="loss-things">
      {list.map((t, i) => {
        const go = goOf(t.ref, actions);
        const text = T.losses.row(refText(t.ref, plant), durText(t.sec));
        return (
          <li key={i} data-test="loss-thing" data-sec={t.sec}>
            {go ? (
              <button type="button" className="link" onClick={go} data-test="loss-thing-go">
                {text}
              </button>
            ) : (
              <span className="muted">{text}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Потери места за окно: виды по порядку столбика, у ожидания — причины, у каждой части — её вещи; «нет смены» — в
 * конце.
 */
function SpotRows({ x, plant, actions }: { x: FloorLoss; plant: string; actions: Actions }) {
  const kinds = ([...ALL_KINDS, 'shift'] as LossKind[]).filter(k => (x.sec[k] ?? 0) > 0);
  return (
    <ul className="loadrows" data-test="card-loss-rows">
      {kinds.map(k => (
        <li key={k} className="lossrow" data-test="card-loss-row" data-kind={k} data-sec={x.sec[k]}>
          <span className="lossline">
            <span className="sw" style={{ background: hex(lossColor(k)) }} />
            <span className={k === 'shift' ? 'muted' : ''}>{k === 'shift' ? T.losses.shiftRow(durText(x.sec[k] ?? 0)) : T.losses.row(T.losses.kind[k], durText(x.sec[k] ?? 0))}</span>
          </span>
          {k === 'wait' ? (
            <ul className="loadrows causes">
              {causeRows(x).map(r => (
                <li key={r.cause} data-test="card-loss-cause" data-cause={r.cause} data-sec={r.sec}>
                  <span className="sw" style={{ background: hex(lossColor(FAMILY_OF[r.cause])) }} />
                  {T.losses.row(T.wait[r.cause], durText(r.sec))}
                </li>
              ))}
            </ul>
          ) : null}
          <Things list={x.things[k]} plant={plant} actions={actions} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Блок «Потери» в карточке помещения или машины линии (Б1л): места карточки с потерями за окно слоя — по убыванию;
 * раскрыто место столбика, по которому щёлкнули, или первое; щелчок по месту — раскрыть его.
 */
export function LossBlock({ hud, thing, plant, actions }: { hud: Hud; thing: Thing; plant: string; actions: Actions }) {
  const v: FloorView | undefined = hud.floor.view;
  const l = layoutAt(plant);
  if (!v || !l || !db) return null;
  const mine = new Set(spotsOfThing(l, lossSpotsOf(db!, l), thing));
  const list = v.losses.filter(x => mine.has(x.spot) && (x.total > 0 || (x.sec.shift ?? 0) > 0)).sort((a, b) => b.total - a.total || (a.spot < b.spot ? -1 : 1));
  const open = list.find(x => x.spot === hud.floor.spot) ?? list[0];
  return (
    <div data-test="card-loss">
      <div className="csec">
        {T.losses.title} · {T.floor.winOf[v.win]} <WinPick win={hud.floor.win} actions={actions} />
      </div>
      {list.length === 0 ? (
        <div className="muted">{T.losses.none}</div>
      ) : (
        <>
          {list.length > 1 ? (
            <ul className="loadrows" data-test="card-loss-spots">
              {list.map(x => (
                <li key={x.spot} data-test="card-loss-spot" data-spot={x.spot}>
                  {x === open ? (
                    <b>{T.losses.row(spotName(l, x.spot), durText(x.total))}</b>
                  ) : (
                    <button type="button" className="link" onClick={() => actions.setLossSpot(x.spot)}>
                      {T.losses.row(spotName(l, x.spot), durText(x.total))}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {open ? (
            <div data-test="card-loss-open" data-spot={open.spot}>
              {list.length > 1 ? <div className="csec">{spotName(l, open.spot)}</div> : null}
              <SpotRows x={open} plant={plant} actions={actions} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
