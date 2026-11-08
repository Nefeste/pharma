// Проверки плана завода при сборке базы (docs/specs/2026-10-view.md, 2а, «План завода»; геймдизайн, §3.4;
// docs/10-domain.md, §4): правила — функции движка (src/engine/site/checks.ts, Б7а), здесь — их слова. Ошибка
// останавливает сборку базы.
import type { ContentDb } from '../../src/content/types';
import { type SiteError, type SiteThing, siteErrors } from '../../src/engine/site/checks';

const thingText = (t: SiteThing) => (t.kind === 'room' ? `помещение ${t.id}` : t.kind === 'slot' ? `место ${t.id}` : t.kind === 'post' ? `пост ${t.id}` : `рампа ${t.id}`);

/** Ошибка планировки словами сборщика. */
export function siteErrorText(e: SiteError): string {
  switch (e.code) {
    case 'lot':
      return `корпус ${e.hull + 1} со стенами — не на участке`;
    case 'hullJoin':
      return 'внутренность корпуса — не один кусок';
    case 'roomType':
      return `помещение ${e.room}: типа ${e.type} нет в каталоге content/rooms/`;
    case 'outsideHull':
      return `помещение ${e.room} — не в корпусе`;
    case 'small':
      return `помещение ${e.room} меньше наименьшего размера типа — ${e.min[0]} × ${e.min[1]}`;
    case 'grade':
      return `помещение ${e.room}: класс, которого типу нельзя`;
    case 'vehicles':
      return `помещение ${e.room}: тип технику не пускает`;
    case 'twice':
      return `тип помещения ${e.type} повторяется — стадия не знает, куда идти`;
    case 'rackFloor':
      return `стеллаж ${e.rack}: клетка (${e.x}, ${e.z}) — не на полу своего помещения`;
    case 'rejectedShared':
      return `зона отклонённого ${e.zone} — не в отдельном помещении`;
    case 'washDoors':
      return `у мойки ${e.room} один проём на вход грязного и выход чистого`;
    case 'oneAirlock':
      return `сырьё и готовая продукция идут через один шлюз ${e.room}`;
    case 'doorWall':
      return `дверь ${e.door + 1} (${e.x}, ${e.z}) — не на стене`;
    case 'doorSides':
      return `дверь ${e.door + 1} (${e.x}, ${e.z}) — не между двумя помещениями`;
    case 'doorMixed':
      return `дверь ${e.door + 1} — клетки ведут в разные помещения`;
    case 'dockInner':
      return `рампа ${e.door + 1} — не в наружной стене`;
    case 'airlock':
      return `дверь ${e.door + 1} ведёт из ${e.from ?? 'улица'} в класс D ${e.to ?? 'улица'} не через шлюз`;
    case 'amenity':
      return `${e.room} открывается в производство или склад`;
    case 'vehicleD':
      return `техника въезжает в класс D дальше шлюза: ${e.room}`;
    case 'zoneFloor':
      return `зона ${e.zone}: клетка (${e.x}, ${e.z}) — не пол помещения`;
    case 'outOfRoom':
      return `${e.thing} стоит не в помещении ${e.room}`;
    case 'entrance':
      return 'вход — не на полу';
    case 'park':
      return 'стоянка техники — не там, куда технике можно';
    case 'walk':
      return `от входа не дойти: ${thingText(e.what)}`;
    case 'drive':
      return `от стоянки не доехать: ${thingText(e.what)}`;
    case 'post':
      return `пост ${e.role} — не на проходимом полу`;
    case 'dockGate':
      return `рампа ${e.dock} — не на воротах рампы`;
    case 'floor':
      return `${e.thing}: этаж ${e.floor} — в 1.0 этаж один, первый`;
    case 'need':
      return `помещению ${e.room} не хватает: ${e.type}`;
  }
}

export function planErrors(db: ContentDb, plantId: string): string[] {
  return siteErrors(db, db.plants[plantId]).map(e => `план ${plantId}: ${siteErrorText(e)}`);
}
