// Проверки плана завода при сборке базы (docs/specs/2026-10-view.md, 2а, «План завода»; геймдизайн, §3.4;
// docs/10-domain.md, §4): правила — функции движка (src/engine/site/checks.ts, Б7а), здесь — их слова. Ошибка
// останавливает сборку базы.
import type { ContentDb } from '../../src/content/types';
import { type SiteError, type SiteThing, siteErrors } from '../../src/engine/site/checks';

const thingText = (t: SiteThing) => (t.kind === 'room' ? `помещение ${t.id}` : t.kind === 'slot' ? `место ${t.id}` : t.kind === 'post' ? `пост ${t.id}` : `рампа ${t.id}`);

/** Ошибка планировки словами сборщика. */
export function siteErrorText(e: SiteError): string {
  switch (e.code) {
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
  }
}

export function planErrors(db: ContentDb, plantId: string): string[] {
  return siteErrors(db, db.plants[plantId]).map(e => `план ${plantId}: ${siteErrorText(e)}`);
}
